import { extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { secureHeaders } from "hono/secure-headers";
import { serve } from "@hono/node-server";
import { getConnInfo } from "@hono/node-server/conninfo";
import { serveStatic } from "@hono/node-server/serve-static";
import { fetchAirForCity, fetchAirForCoords, listMajorIndiaLocations } from "./air-quality.mjs";
import { checkRefineQuestion, createPlan, refinePlan, validateAir, validateProfile } from "./plan.mjs";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const CLIENT_DIR = resolve(ROOT, "client");
const DEFAULT_PORT = Number(process.env.PORT || 4173);
const MAX_BODY = 18 * 1024;

function validatePlanContext(input) {
  const plan = input?.plan;
  if (!plan || typeof plan.summary !== "string" || !Array.isArray(plan.actions) || plan.actions.length > 4) {
    throw new Error("Generate a plan before asking a follow-up.");
  }
  return {
    summary: plan.summary.slice(0, 160),
    intro: String(plan.intro || "").slice(0, 340),
    actions: plan.actions.map((action) => ({
      category: String(action.category || "").slice(0, 20),
      headline: String(action.headline || "").slice(0, 100),
      detail: String(action.detail || "").slice(0, 600),
      tip: String(action.tip || "").slice(0, 260),
    })),
  };
}

function getClientKey(c) {
  if (c.env?.incoming) {
    try {
      return getConnInfo(c).remote.address || "unknown";
    } catch {
      return c.env.incoming.socket?.remoteAddress || "unknown";
    }
  }
  const forwarded = c.req.header("x-real-ip") || c.req.header("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || "local-test";
}

function createRateLimiter(maxRequests = 16, windowMs = 60_000) {
  const requestCounts = new Map();
  return async (c, next) => {
    const now = Date.now();
    const key = getClientKey(c);
    const current = requestCounts.get(key);
    if (!current || now - current.start > windowMs) {
      requestCounts.set(key, { start: now, count: 1 });
      if (requestCounts.size > 500) {
        for (const [entry, value] of requestCounts) {
          if (now - value.start > windowMs) requestCounts.delete(entry);
        }
      }
      return next();
    }
    current.count += 1;
    if (current.count > maxRequests) {
      return c.json(
        { error: { code: "RATE_LIMITED", message: "Please wait a moment before trying again." } },
        429,
      );
    }
    return next();
  };
}

async function readJsonBody(c) {
  const contentType = c.req.header("content-type") || "";
  if (!contentType.toLowerCase().includes("application/json")) {
    throw new Error("Send household details as JSON.");
  }
  try {
    return await c.req.json();
  } catch {
    throw new Error("The request could not be read.");
  }
}

export function createApp({ serveClient = true } = {}) {
  const app = new Hono();
  const apiRateLimit = createRateLimiter();

  app.use("*", secureHeaders({
    strictTransportSecurity: false,
    xFrameOptions: "DENY",
    xContentTypeOptions: "nosniff",
    referrerPolicy: "no-referrer",
    crossOriginOpenerPolicy: "same-origin",
    permissionsPolicy: {
      camera: [],
      microphone: [],
      geolocation: ["self"],
    },
    contentSecurityPolicy: {
      defaultSrc: ["'self'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      frameAncestors: ["'none'"],
      objectSrc: ["'none'"],
      imgSrc: ["'self'", "data:"],
      styleSrc: ["'self'"],
      scriptSrc: ["'self'"],
      connectSrc: ["'self'"],
    },
  }));

  app.use("/api/*", async (c, next) => {
    await next();
    c.header("cache-control", "no-store");
  });

  app.get("/api/health", (c) => {
    return c.json({
      status: "ok",
      geminiConfigured: Boolean(process.env.GEMINI_API_KEY),
      model: (process.env.GEMINI_MODEL || "").trim() || "gemini-3.1-flash-lite",
    });
  });

  app.get("/api/locations", (c) => {
    return c.json({ locations: listMajorIndiaLocations() });
  });

  app.get("/api/air", apiRateLimit, async (c) => {
    try {
      const lat = c.req.query("lat");
      const lon = c.req.query("lon");
      const air = lat !== undefined && lon !== undefined
        ? await fetchAirForCoords(lat, lon)
        : await fetchAirForCity(c.req.query("city"));
      return c.json(air);
    } catch (error) {
      return c.json({
        error: {
          code: "AIR_DATA_UNAVAILABLE",
          message: error instanceof Error ? error.message : "Air data is unavailable right now.",
        },
      }, 502);
    }
  });

  const jsonBodyGuard = bodyLimit({
    maxSize: MAX_BODY,
    onError: (c) => c.json(
      { error: { code: "INVALID_REQUEST", message: "That request is too large." } },
      400,
    ),
  });

  app.post("/api/plan", apiRateLimit, jsonBodyGuard, async (c) => {
    try {
      const input = await readJsonBody(c);
      const profile = validateProfile(input.profile);
      const air = validateAir(input.air);
      const result = await createPlan(air, profile, input.useGemini === true);
      return c.json(result);
    } catch (error) {
      return c.json({
        error: {
          code: "INVALID_REQUEST",
          message: error instanceof Error ? error.message : "That request could not be processed.",
        },
      }, 400);
    }
  });

  app.post("/api/refine", apiRateLimit, jsonBodyGuard, async (c) => {
    try {
      const input = await readJsonBody(c);
      const profile = validateProfile(input.profile);
      const air = validateAir(input.air);
      const plan = validatePlanContext(input);
      const question = typeof input.question === "string" ? input.question.slice(0, 280) : "";

      if (input.useGemini !== true) {
        return c.json({
          mode: "local",
          answer: "Select the Gemini option in your household setup to send this question and plan context for a tailored response. Your profile stays in this browser session.",
        });
      }
      if (question.trim().length < 3) {
        throw new Error("Add a little more detail about what cannot change.");
      }

      const guardrail = checkRefineQuestion(question);
      if (!guardrail.allowed) {
        return c.json({ mode: "local", answer: guardrail.reason });
      }

      let answer;
      try {
        answer = await refinePlan(question, air, profile, plan);
      } catch {
        return c.json({
          mode: "local",
          answer: "Gemini is temporarily unavailable. Your local plan is still ready; try the question again later.",
        });
      }

      if (!answer) {
        const message = process.env.GEMINI_API_KEY
          ? "Gemini could not return a usable answer. Your local plan is still available; try a simpler question."
          : "Gemini is not configured on this server yet. The plan above is still available from the local guide; add a Gemini key on the server to ask it follow-up questions.";
        return c.json({ mode: "local", answer: message });
      }
      return c.json({ mode: "gemini", answer });
    } catch (error) {
      return c.json({
        error: {
          code: "INVALID_REQUEST",
          message: error instanceof Error ? error.message : "That request could not be processed.",
        },
      }, 400);
    }
  });

  app.all("/api/*", (c) => {
    return c.json({ error: { code: "NOT_FOUND", message: "That API route was not found." } }, 404);
  });

  if (serveClient) {
    app.use("*", async (c, next) => {
      if (c.req.method !== "GET" && c.req.method !== "HEAD") {
        return c.json({ error: { code: "METHOD_NOT_ALLOWED", message: "Use GET for pages." } }, 405);
      }
      await next();
      const ext = extname(c.req.path).toLowerCase();
      c.header("cache-control", !ext || ext === ".html" || ext === ".css" || ext === ".js" ? "no-cache" : "public, max-age=300");
    });

    app.use("*", serveStatic({ root: CLIENT_DIR }));

    // SPA fallback for extensionless GET routes.
    app.get("*", async (c, next) => {
      if (extname(c.req.path) !== "") return next();
      return serveStatic({ path: join(CLIENT_DIR, "index.html") })(c, next);
    });
  }

  app.notFound((c) => {
    return c.json({ error: { code: "NOT_FOUND", message: "That page was not found." } }, 404);
  });

  return app;
}

const isEntrypoint = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isEntrypoint) {
  const app = createApp();
  const server = serve({
    fetch: app.fetch,
    port: DEFAULT_PORT,
    hostname: "0.0.0.0",
  }, (info) => {
    console.log("HawaShift running on http://localhost:" + info.port);
    console.log("Gemini planning: " + (process.env.GEMINI_API_KEY ? "configured" : "local guide fallback"));
  });

  server.on("error", (error) => {
    if (error && typeof error === "object" && "code" in error && error.code === "EADDRINUSE") {
      console.error(`Port ${DEFAULT_PORT} is already in use. Stop the existing server or change PORT in .env.`);
      process.exit(1);
    }
    throw error;
  });

  function shutdown() {
    server.close(() => process.exit(0));
  }
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
