import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { fetchAirForCity } from "./air-quality.mjs";
import { createPlan, refinePlan, validateAir, validateProfile } from "./plan.mjs";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const CLIENT_DIR = resolve(ROOT, "client");
const DEFAULT_PORT = Number(process.env.PORT || 4173);
const MAX_BODY = 18 * 1024;
const MIME = Object.freeze({
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json; charset=utf-8",
});

function sendJson(response, status, payload) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(JSON.stringify(payload));
}

function setSecurityHeaders(response) {
  response.setHeader("x-content-type-options", "nosniff");
  response.setHeader("x-frame-options", "DENY");
  response.setHeader("referrer-policy", "no-referrer");
  response.setHeader("permissions-policy", "camera=(), microphone=(), geolocation=()");
  response.setHeader("content-security-policy", "default-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; object-src 'none'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'");
  response.setHeader("cross-origin-opener-policy", "same-origin");
}

function limited(request, response, requestCounts) {
  const now = Date.now();
  const key = request.socket.remoteAddress || "unknown";
  const current = requestCounts.get(key);
  if (!current || now - current.start > 60_000) {
    requestCounts.set(key, { start: now, count: 1 });
    if (requestCounts.size > 500) {
      for (const [entry, value] of requestCounts) {
        if (now - value.start > 60_000) requestCounts.delete(entry);
      }
    }
    return false;
  }
  current.count += 1;
  if (current.count > 16) {
    sendJson(response, 429, { error: { code: "RATE_LIMITED", message: "Please wait a moment before trying again." } });
    return true;
  }
  return false;
}

async function readJson(request) {
  const contentType = request.headers["content-type"] || "";
  if (!contentType.toLowerCase().includes("application/json")) throw new Error("Send household details as JSON.");
  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY) throw new Error("That request is too large.");
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new Error("The request could not be read.");
  }
}

function validatePlanContext(input) {
  const plan = input?.plan;
  if (!plan || typeof plan.summary !== "string" || !Array.isArray(plan.actions) || plan.actions.length > 4) {
    throw new Error("Generate a plan before asking a follow-up.");
  }
  return {
    summary: plan.summary.slice(0, 150),
    intro: String(plan.intro || "").slice(0, 320),
    actions: plan.actions.map((action) => ({
      category: String(action.category || "").slice(0, 20),
      headline: String(action.headline || "").slice(0, 100),
      detail: String(action.detail || "").slice(0, 360),
    })),
  };
}

async function serveStatic(request, response, pathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    sendJson(response, 400, { error: { code: "BAD_PATH", message: "Invalid path." } });
    return;
  }
  const cleanPath = decoded === "/" ? "/index.html" : decoded;
  const target = resolve(CLIENT_DIR, "." + cleanPath);
  if (target !== CLIENT_DIR && !target.startsWith(CLIENT_DIR + sep)) {
    sendJson(response, 403, { error: { code: "FORBIDDEN", message: "That path is not available." } });
    return;
  }
  try {
    const file = await readFile(target);
    response.writeHead(200, {
      "content-type": MIME[extname(target).toLowerCase()] || "application/octet-stream",
      "cache-control": extname(target) === ".html" ? "no-cache" : "public, max-age=300",
    });
    response.end(file);
  } catch {
    if (request.method === "GET" && !pathname.startsWith("/api/") && extname(pathname) === "") {
      try {
        const index = await readFile(resolve(CLIENT_DIR, "index.html"));
        response.writeHead(200, { "content-type": MIME[".html"], "cache-control": "no-cache" });
        response.end(index);
        return;
      } catch {
        sendJson(response, 404, { error: { code: "NOT_FOUND", message: "That page was not found." } });
        return;
      }
    }
    sendJson(response, 404, { error: { code: "NOT_FOUND", message: "That page was not found." } });
  }
}

export function createRequestHandler() {
  const requestCounts = new Map();
  return async (request, response) => {
    setSecurityHeaders(response);
    const url = new URL(request.url || "/", "http://localhost");
    const method = request.method || "GET";

    if (url.pathname === "/api/health" && method === "GET") {
      sendJson(response, 200, {
        status: "ok",
        geminiConfigured: Boolean(process.env.GEMINI_API_KEY),
        model: process.env.GEMINI_MODEL || "gemini-3.8-flash",
      });
      return;
    }

    if (url.pathname === "/api/air" && method === "GET") {
      if (limited(request, response, requestCounts)) return;
      try {
        const air = await fetchAirForCity(url.searchParams.get("city"));
        sendJson(response, 200, air);
      } catch (error) {
        sendJson(response, 502, {
          error: {
            code: "AIR_DATA_UNAVAILABLE",
            message: error instanceof Error ? error.message : "Air data is unavailable right now.",
          },
        });
      }
      return;
    }

    if ((url.pathname === "/api/plan" || url.pathname === "/api/refine") && method === "POST") {
      if (limited(request, response, requestCounts)) return;
      try {
        const input = await readJson(request);
        const profile = validateProfile(input.profile);
        const air = validateAir(input.air);

        if (url.pathname === "/api/plan") {
          const result = await createPlan(air, profile, input.useGemini === true);
          sendJson(response, 200, result);
          return;
        }

        const plan = validatePlanContext(input);
        const question = typeof input.question === "string" ? input.question.slice(0, 280) : "";
        if (input.useGemini !== true) {
          sendJson(response, 200, {
            mode: "local",
            answer: "Select the Gemini option in your household setup to send this question and plan context for a tailored response. Your profile stays in this browser session.",
          });
          return;
        }
        if (question.trim().length < 3) throw new Error("Add a little more detail about what cannot change.");
        let answer;
        try {
          answer = await refinePlan(question, air, profile, plan);
        } catch {
          sendJson(response, 200, {
            mode: "local",
            answer: "Gemini is temporarily unavailable. Your local plan is still ready; try the question again later.",
          });
          return;
        }
        if (!answer) {
          const message = process.env.GEMINI_API_KEY
            ? "Gemini could not return a usable answer. Your local plan is still available; try a simpler question."
            : "Gemini is not configured on this server yet. The plan above is still available from the local guide; add a Gemini key on the server to ask it follow-up questions.";
          sendJson(response, 200, { mode: "local", answer: message });
          return;
        }
        sendJson(response, 200, { mode: "gemini", answer });
      } catch (error) {
        sendJson(response, 400, {
          error: {
            code: "INVALID_REQUEST",
            message: error instanceof Error ? error.message : "That request could not be processed.",
          },
        });
      }
      return;
    }

    if (url.pathname.startsWith("/api/")) {
      sendJson(response, 404, { error: { code: "NOT_FOUND", message: "That API route was not found." } });
      return;
    }

    if (method !== "GET" && method !== "HEAD") {
      sendJson(response, 405, { error: { code: "METHOD_NOT_ALLOWED", message: "Use GET for pages." } });
      return;
    }
    await serveStatic(request, response, url.pathname);
  };
}

export function createAppServer() {
  return createServer(createRequestHandler());
}

const isEntrypoint = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isEntrypoint) {
  const server = createAppServer();
  server.listen(DEFAULT_PORT, "0.0.0.0", () => {
    console.log("HawaShift running on http://localhost:" + DEFAULT_PORT);
    console.log("Gemini planning: " + (process.env.GEMINI_API_KEY ? "configured" : "local guide fallback"));
  });

  function shutdown() {
    server.close(() => process.exit(0));
  }
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
