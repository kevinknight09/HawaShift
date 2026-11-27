import test from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { createRequestHandler } from "../server/index.mjs";

async function invoke(handler, { method = "GET", url = "/", headers = {}, body = null, remoteAddress = "127.0.0.1" } = {}) {
  const chunks = body === null ? [] : [Buffer.from(typeof body === "string" ? body : JSON.stringify(body))];
  const request = Readable.from(chunks);
  request.method = method;
  request.url = url;
  request.headers = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  request.socket = { remoteAddress };

  const responseHeaders = {};
  let statusCode = 200;
  let responseBody = Buffer.alloc(0);

  const response = {
    setHeader(name, value) {
      responseHeaders[name.toLowerCase()] = value;
    },
    getHeader(name) {
      return responseHeaders[name.toLowerCase()];
    },
    writeHead(status, extraHeaders = {}) {
      statusCode = status;
      for (const [k, v] of Object.entries(extraHeaders)) {
        responseHeaders[k.toLowerCase()] = v;
      }
    },
    end(chunk) {
      if (chunk !== undefined && chunk !== null) {
        responseBody = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
      }
    },
  };

  await handler(request, response);
  return {
    status: statusCode,
    headers: responseHeaders,
    text: () => responseBody.toString("utf8"),
    json: () => JSON.parse(responseBody.toString("utf8")),
  };
}

function samplePayload() {
  const tomorrow = new Date(Date.now() + 36 * 60 * 60 * 1000);
  const year = tomorrow.getUTCFullYear();
  const month = tomorrow.getUTCMonth();
  const day = tomorrow.getUTCDate();
  return {
    profile: {
      city: "New Delhi",
      householdSize: 4,
      walkTime: 7,
      commuteKm: 6,
      budget: "zero",
      commuteMode: "car",
      schoolFixed: true,
      sensitiveNeeds: ["children"],
    },
    air: {
      city: { name: "New Delhi", region: "Delhi", country: "India", timezone: "Asia/Kolkata" },
      current: 116,
      hourly: Array.from({ length: 24 }, (_, hour) => ({
        time: new Date(Date.UTC(year, month, day, hour) - 330 * 60 * 1000).toISOString(),
        value: hour >= 12 && hour <= 14 ? 60 : 120,
      })),
      demo: true,
    },
    useGemini: false,
  };
}

test("HTTP handler serves health, static pages, security headers, and blocks path traversal", async () => {
  const handler = createRequestHandler();

  const health = await invoke(handler, { url: "/api/health" });
  assert.equal(health.status, 200);
  assert.equal(health.headers["x-frame-options"], "DENY");
  assert.equal(health.headers["x-content-type-options"], "nosniff");
  assert.match(health.headers["content-security-policy"] || "", /default-src 'self'/);
  assert.equal(health.json().status, "ok");

  const home = await invoke(handler, { url: "/" });
  assert.equal(home.status, 200);
  assert.match(home.text(), /HawaShift/);

  const traversal = await invoke(handler, { url: "/%2e%2e/package.json" });
  assert.ok(traversal.status === 403 || traversal.status === 404);
  assert.doesNotMatch(traversal.text(), /"hawashift"/);

  const backslashTraversal = await invoke(handler, { url: "/%2e%2e%5cpackage.json" });
  assert.ok(backslashTraversal.status === 403 || backslashTraversal.status === 404);
  assert.doesNotMatch(backslashTraversal.text(), /"hawashift"/);

  const unknownApi = await invoke(handler, { url: "/api/unknown" });
  assert.equal(unknownApi.status, 404);

  const badMethod = await invoke(handler, { method: "DELETE", url: "/" });
  assert.equal(badMethod.status, 405);
});

test("POST /api/plan and POST /api/refine validate payloads and return local guidance", async () => {
  const handler = createRequestHandler();

  const planResponse = await invoke(handler, {
    method: "POST",
    url: "/api/plan",
    headers: { "content-type": "application/json" },
    body: samplePayload(),
  });
  assert.equal(planResponse.status, 200);
  const planBody = planResponse.json();
  assert.equal(planBody.mode, "local");
  assert.equal(planBody.plan.actions.length, 4);

  const badType = await invoke(handler, {
    method: "POST",
    url: "/api/plan",
    headers: { "content-type": "text/plain" },
    body: "{}",
  });
  assert.equal(badType.status, 400);

  const refineNoConsent = await invoke(handler, {
    method: "POST",
    url: "/api/refine",
    headers: { "content-type": "application/json" },
    body: {
      ...samplePayload(),
      plan: planBody.plan,
      question: "Can we still do the school run?",
    },
  });
  assert.equal(refineNoConsent.status, 200);
  const refineBody = refineNoConsent.json();
  assert.equal(refineBody.mode, "local");
  assert.match(refineBody.answer, /Select the Gemini option/i);
});

test("API rate limiter enforces 16 requests per minute", async () => {
  const handler = createRequestHandler();
  const payload = samplePayload();

  let lastStatus = 200;
  for (let i = 0; i < 17; i += 1) {
    const res = await invoke(handler, {
      method: "POST",
      url: "/api/plan",
      headers: { "content-type": "application/json" },
      body: payload,
    });
    lastStatus = res.status;
  }
  assert.equal(lastStatus, 429);
});
