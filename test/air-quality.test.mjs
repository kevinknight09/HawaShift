import test from "node:test";
import assert from "node:assert/strict";
import { clearAirCache, fetchAirForCity, fetchAirForCoords, listMajorIndiaLocations } from "../server/air-quality.mjs";

test("listMajorIndiaLocations returns curated Indian cities", () => {
  const locations = listMajorIndiaLocations();
  assert.ok(locations.length >= 10);
  assert.ok(locations.some((loc) => loc.name === "New Delhi" && loc.country === "India"));
  assert.ok(locations.some((loc) => loc.name === "Mumbai" && loc.country === "India"));
});

test("fetchAirForCity uses direct lookup for major Indian cities and caches responses", async (t) => {
  clearAirCache();
  let calls = 0;
  const nowSec = Math.floor(Date.now() / 1000);

  t.mock.method(globalThis, "fetch", async () => {
    calls += 1;
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
  assert.equal(calls, 1);

  // Second call for same city (case-insensitive) should hit the cache.
  const second = await fetchAirForCity("  new   delhi ");
  assert.equal(second.current, 132.5);
  assert.equal(calls, 1);
});

test("fetchAirForCity geocodes other cities via Open-Meteo and caches responses", async (t) => {
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
            name: "Nagpur",
            admin1: "Maharashtra",
            country: "India",
            latitude: 21.1458,
            longitude: 79.0882,
            timezone: "Asia/Kolkata",
          }],
        }),
      };
    }
    return {
      ok: true,
      json: async () => ({
        timezone: "Asia/Kolkata",
        current: { pm2_5: 88.4 },
        hourly: {
          time: Array.from({ length: 12 }, (_, index) => nowSec + index * 3600),
          pm2_5: Array.from({ length: 12 }, (_, index) => 80 + index),
        },
      }),
    };
  });

  const first = await fetchAirForCity("Nagpur");
  assert.equal(first.city.name, "Nagpur");
  assert.equal(first.current, 88.4);
  assert.equal(calls, 2);

  const second = await fetchAirForCity("nagpur");
  assert.equal(second.current, 88.4);
  assert.equal(calls, 2);
});

test("fetchAirForCoords reverse-geocodes coordinates, caches by rounded grid, and falls back when reverse lookup fails", async (t) => {
  clearAirCache();
  let calls = 0;
  const nowSec = Math.floor(Date.now() / 1000);

  t.mock.method(globalThis, "fetch", async (url) => {
    calls += 1;
    const href = String(url);
    if (href.includes("nominatim.openstreetmap.org")) {
      return {
        ok: true,
        json: async () => ({
          address: {
            city: "Bengaluru",
            state: "Karnataka",
            country: "India",
          },
        }),
      };
    }
    return {
      ok: true,
      json: async () => ({
        timezone: "Asia/Kolkata",
        current: { pm2_5: 44.2 },
        hourly: {
          time: Array.from({ length: 12 }, (_, index) => nowSec + index * 3600),
          pm2_5: Array.from({ length: 12 }, (_, index) => 40 + index),
        },
      }),
    };
  });

  const first = await fetchAirForCoords(12.9716, 77.5946);
  assert.equal(first.city.name, "Bengaluru");
  assert.equal(first.city.region, "Karnataka");
  assert.equal(first.city.country, "India");
  assert.equal(first.current, 44.2);
  assert.equal(calls, 2);

  // Nearby rounded coordinates hit the same cache entry.
  const second = await fetchAirForCoords("12.974", "77.591");
  assert.equal(second.city.name, "Bengaluru");
  assert.equal(calls, 2);

  clearAirCache();
  t.mock.method(globalThis, "fetch", async (url) => {
    if (String(url).includes("nominatim.openstreetmap.org")) {
      throw new Error("reverse lookup down");
    }
    return {
      ok: true,
      json: async () => ({
        timezone: "UTC",
        current: { pm2_5: 30 },
        hourly: {
          time: Array.from({ length: 12 }, (_, index) => nowSec + index * 3600),
          pm2_5: Array.from({ length: 12 }, () => 30),
        },
      }),
    };
  });

  const fallback = await fetchAirForCoords(19.07, 72.87);
  assert.equal(fallback.city.name, "Your area");
  assert.equal(fallback.current, 30);

  await assert.rejects(() => fetchAirForCoords(120, 77), /latitude/i);
  await assert.rejects(() => fetchAirForCoords(12, 200), /longitude/i);
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
