import test from "node:test";
import assert from "node:assert/strict";
import { clearAirCache } from "../server/air-quality.mjs";
import { createApp } from "../server/index.mjs";
import { GET as vercelGet, POST as vercelPost } from "../api/[...route].mjs";

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
    },
    useGemini: false,
  };
}

test("Hono app serves health, locations, static pages, security headers, and blocks path traversal", async () => {
  const app = createApp();

  const health = await app.request("/api/health");
  assert.equal(health.status, 200);
  assert.equal(health.headers.get("x-frame-options"), "DENY");
  assert.equal(health.headers.get("x-content-type-options"), "nosniff");
  assert.equal(health.headers.get("cache-control"), "no-store");
  assert.match(health.headers.get("permissions-policy") || "", /geolocation=\(self\)/);
  assert.match(health.headers.get("content-security-policy") || "", /default-src 'self'/);
  assert.equal((await health.json()).status, "ok");

  const locations = await app.request("/api/locations");
  assert.equal(locations.status, 200);
  const locationsBody = await locations.json();
  assert.ok(Array.isArray(locationsBody.locations));
  assert.ok(locationsBody.locations.some((item) => item.name === "New Delhi" && item.country === "India"));

  const home = await app.request("/");
  assert.equal(home.status, 200);
  assert.match(await home.text(), /HawaShift/);

  const traversal = await app.request("/%2e%2e/package.json");
  assert.ok(traversal.status === 403 || traversal.status === 404);
  assert.doesNotMatch(await traversal.text(), /"hawashift"/);

  const backslashTraversal = await app.request("/%2e%2e%5cpackage.json");
  assert.ok(backslashTraversal.status === 403 || backslashTraversal.status === 404);
  assert.doesNotMatch(await backslashTraversal.text(), /"hawashift"/);

  const unknownApi = await app.request("/api/unknown");
  assert.equal(unknownApi.status, 404);

  const badMethod = await app.request("/", { method: "DELETE" });
  assert.equal(badMethod.status, 405);
});

test("POST /api/plan and POST /api/refine validate payloads, enforce body limit, and return local guidance", async () => {
  const app = createApp();

  const planResponse = await app.request("/api/plan", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(samplePayload()),
  });
  assert.equal(planResponse.status, 200);
  const planBody = await planResponse.json();
  assert.equal(planBody.mode, "local");
  assert.equal(planBody.plan.actions.length, 4);

  const badType = await app.request("/api/plan", {
    method: "POST",
    headers: { "content-type": "text/plain" },
    body: "{}",
  });
  assert.equal(badType.status, 400);

  const oversized = await app.request("/api/plan", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ pad: "x".repeat(20 * 1024) }),
  });
  assert.equal(oversized.status, 400);

  const refineNoConsent = await app.request("/api/refine", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      ...samplePayload(),
      plan: planBody.plan,
      question: "Can we still do the school run?",
    }),
  });
  assert.equal(refineNoConsent.status, 200);
  const refineBody = await refineNoConsent.json();
  assert.equal(refineBody.mode, "local");
  assert.match(refineBody.answer, /Select the Gemini option/i);

  const refineOffTopic = await app.request("/api/refine", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      ...samplePayload(),
      plan: planBody.plan,
      useGemini: true,
      question: "Write a Python script to sort numbers",
    }),
  });
  assert.equal(refineOffTopic.status, 200);
  const offTopicBody = await refineOffTopic.json();
  assert.equal(offTopicBody.mode, "local");
  assert.match(offTopicBody.answer, /only answer questions about today’s air-quality plan/i);
});

test("GET /api/air supports coordinate lookups", async (t) => {
  clearAirCache();
  const app = createApp();
  const nowSec = Math.floor(Date.now() / 1000);

  t.mock.method(globalThis, "fetch", async (url) => {
    if (String(url).includes("nominatim.openstreetmap.org")) {
      return {
        ok: true,
        json: async () => ({ address: { city: "Mumbai", state: "Maharashtra", country: "India" } }),
      };
    }
    return {
      ok: true,
      json: async () => ({
        timezone: "Asia/Kolkata",
        current: { pm2_5: 72, pm10: 110.3, us_aqi: 160 },
        hourly: {
          time: Array.from({ length: 12 }, (_, index) => nowSec + index * 3600),
          pm2_5: Array.from({ length: 12 }, () => 70),
        },
      }),
    };
  });

  const airRes = await app.request("/api/air?lat=19.076&lon=72.8777");
  assert.equal(airRes.status, 200);
  const body = await airRes.json();
  assert.equal(body.city.name, "Mumbai");
  assert.equal(body.current, 72);
  assert.equal(body.currentPm10, 110.3);
  assert.equal(body.currentUsAqi, 160);
});

test("API rate limiter enforces 16 requests per minute", async () => {
  const app = createApp();
  const body = JSON.stringify(samplePayload());

  let lastStatus = 200;
  for (let i = 0; i < 17; i += 1) {
    const res = await app.request("/api/plan", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
    });
    lastStatus = res.status;
  }
  assert.equal(lastStatus, 429);
});

test("Vercel serverless handler serves /api/health, /api/locations, and /api/plan", async () => {
  const healthRes = await vercelGet(new Request("https://example.vercel.app/api/health"));
  assert.equal(healthRes.status, 200);
  assert.equal((await healthRes.json()).status, "ok");

  const locationsRes = await vercelGet(new Request("https://example.vercel.app/api/locations"));
  assert.equal(locationsRes.status, 200);
  assert.ok((await locationsRes.json()).locations.length > 0);

  const planRes = await vercelPost(new Request("https://example.vercel.app/api/plan", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-real-ip": "203.0.113.10",
    },
    body: JSON.stringify(samplePayload()),
  }));
  assert.equal(planRes.status, 200);
  assert.equal((await planRes.json()).mode, "local");

  // Non-API routes are served by Vercel CDN (not the API handler)
  const staticFallback = await vercelGet(new Request("https://example.vercel.app/"));
  assert.equal(staticFallback.status, 404);
});
