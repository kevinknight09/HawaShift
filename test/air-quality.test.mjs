import test from "node:test";
import assert from "node:assert/strict";
import { clearAirCache, fetchAirForCity } from "../server/air-quality.mjs";

test("fetchAirForCity geocodes, normalizes forecast, and caches responses", async (t) => {
  clearAirCache();
  let calls = 0;
  const nowSec = Math.floor(Date.now() / 1000);

  t.mock.method(globalThis, "fetch", async (url) => {
    calls += 1;
    const href = String(url);
    if (href.includes("geocoding-api.open-meteo.com")) {
      return {
        ok: true,
        json: async () => ({
          results: [{
            name: "New Delhi",
            admin1: "Delhi",
            country: "India",
            latitude: 28.6139,
            longitude: 77.209,
            timezone: "Asia/Kolkata",
          }],
        }),
      };
    }
    return {
      ok: true,
      json: async () => ({
        timezone: "Asia/Kolkata",
        current: { pm2_5: 132.46 },
        hourly: {
          time: Array.from({ length: 12 }, (_, index) => nowSec + index * 3600),
          pm2_5: Array.from({ length: 12 }, (_, index) => 120 + index),
        },
      }),
    };
  });

  const first = await fetchAirForCity("New Delhi");
  assert.equal(first.city.name, "New Delhi");
  assert.equal(first.city.timezone, "Asia/Kolkata");
  assert.equal(first.current, 132.5);
  assert.equal(first.hourly.length, 12);
  assert.equal(first.demo, false);
  assert.equal(calls, 2);

  // Second call for same city (case-insensitive) should hit the cache.
  const second = await fetchAirForCity("  new   delhi ");
  assert.equal(second.current, 132.5);
  assert.equal(calls, 2);
});

test("fetchAirForCity rejects invalid names and unknown cities", async (t) => {
  clearAirCache();
  await assert.rejects(() => fetchAirForCity("A"), /between 2 and 60/);

  t.mock.method(globalThis, "fetch", async () => ({
    ok: true,
    json: async () => ({ results: [] }),
  }));
  await assert.rejects(() => fetchAirForCity("NoSuchCityAnywhere"), /couldn’t find that city/i);
});
