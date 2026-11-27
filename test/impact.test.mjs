import test from "node:test";
import assert from "node:assert/strict";
import { calculateImpact, formatPlanTime } from "../server/impact.mjs";

function tomorrowUtcHourly(valuesByHour, offsetMinutes = 330) {
  const tomorrow = new Date(Date.now() + 36 * 60 * 60 * 1000);
  const year = tomorrow.getUTCFullYear();
  const month = tomorrow.getUTCMonth();
  const day = tomorrow.getUTCDate();
  return valuesByHour.map((value, hour) => ({
    time: new Date(Date.UTC(year, month, day, hour) - offsetMinutes * 60 * 1000).toISOString(),
    value,
  }));
}

function makeHourlyCurve(overrides = {}) {
  const base = Array.from({ length: 24 }, (_, hour) => overrides[hour] ?? 120);
  return tomorrowUtcHourly(base);
}

test("calculateImpact picks lowest 2-hour daytime window and computes exposure reduction", () => {
  const hourly = makeHourlyCurve({
    7: 160,
    10: 110,
    11: 90,
    12: 70,
    13: 60,
    14: 70,
    15: 95,
    16: 110,
    17: 120,
  });
  const air = {
    city: { name: "New Delhi", country: "India", timezone: "Asia/Kolkata" },
    current: 150,
    hourly,
  };
  const profile = {
    city: "New Delhi",
    householdSize: 4,
    walkTime: 7,
    commuteMode: "car",
    commuteKm: 10,
    budget: "zero",
    schoolFixed: true,
    sensitiveNeeds: ["children"],
  };

  const impact = calculateImpact(air, profile);
  assert.equal(impact.baselinePm25, 160);
  assert.ok(impact.bestWindow);
  // Hours 12, 13, 14 have mean (70 + 60 + 70) / 3 = 66.7
  assert.equal(impact.bestWindow.meanPm25, 66.7);
  assert.equal(impact.exposurePercent, 58);
  assert.equal(impact.exposureDelta, 93.3);
  assert.equal(impact.walkMinutes, 20);
  // Car (139.52 / 1.5 = 93.0133) - Bus (787.72 / 25 = 31.5088) = 61.5045 g/km * 10 km = 0.615 kg
  assert.equal(impact.emissionsKg, 0.615);
});

test("calculateImpact shows negative CO2 difference when switching two-wheeler to bus", () => {
  const air = {
    city: { name: "Pune", country: "India", timezone: "Asia/Kolkata" },
    current: 80,
    hourly: makeHourlyCurve(),
  };
  const impact = calculateImpact(air, {
    walkTime: 7,
    commuteMode: "scooter",
    commuteKm: 10,
  });

  // Two-wheeler (25.52 / 1.2 = 21.2667) - Bus (31.5088) = -10.2421 g/km * 10 = -0.102 kg
  assert.equal(impact.emissionsKg, -0.102);
});

test("calculateImpact omits India commute factors for non-India cities", () => {
  const air = {
    city: { name: "Lahore", country: "Pakistan", timezone: "Asia/Karachi" },
    current: 140,
    hourly: tomorrowUtcHourly(Array.from({ length: 24 }, () => 140), 300),
  };
  const impact = calculateImpact(air, {
    walkTime: 7,
    commuteMode: "car",
    commuteKm: 8,
  });

  assert.equal(impact.emissionsKg, null);
  assert.match(impact.emissionsNote, /specific to India/i);
});

test("calculateImpact ignores daytime windows spanning gaps larger than one hour", () => {
  const full = makeHourlyCurve({ 7: 150, 10: 40, 11: 40, 14: 40, 15: 40 });
  const gapped = full.filter((_, hour) => ![12, 13, 16, 17].includes(hour));
  const air = {
    city: { name: "New Delhi", country: "India", timezone: "Asia/Kolkata" },
    current: 150,
    hourly: gapped,
  };
  const impact = calculateImpact(air, {
    walkTime: 7,
    commuteMode: "remote",
    commuteKm: 0,
  });

  assert.equal(impact.bestWindow, null);
  assert.equal(impact.exposurePercent, null);
});

test("formatPlanTime formats today and tomorrow relative to city timezone", () => {
  const now = Date.now();
  const formattedToday = formatPlanTime(new Date(now).toISOString(), "Asia/Kolkata");
  assert.match(formattedToday, /^today at /);
});
