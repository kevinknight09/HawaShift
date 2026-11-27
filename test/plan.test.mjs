import test from "node:test";
import assert from "node:assert/strict";
import {
  createPlan,
  makeLocalPlan,
  refinePlan,
  validateAir,
  validateProfile,
  validModelPlan,
} from "../server/plan.mjs";

function makeFutureAir(valuesByHour = {}, current = 110, defaultValue = 100) {
  const tomorrow = new Date(Date.now() + 36 * 60 * 60 * 1000);
  const year = tomorrow.getUTCFullYear();
  const month = tomorrow.getUTCMonth();
  const day = tomorrow.getUTCDate();
  const hourly = Array.from({ length: 24 }, (_, hour) => ({
    time: new Date(Date.UTC(year, month, day, hour) - 330 * 60 * 1000).toISOString(),
    value: valuesByHour[hour] ?? defaultValue,
  }));
  return {
    city: { name: "New Delhi", region: "Delhi", country: "India", timezone: "Asia/Kolkata" },
    current,
    hourly,
    demo: false,
  };
}

const baseProfile = {
  city: "New Delhi",
  householdSize: 4,
  walkTime: 7,
  commuteKm: 8,
  budget: "zero",
  commuteMode: "car",
  schoolFixed: true,
  sensitiveNeeds: ["children"],
};

test("validateProfile enforces allowed bounds and options", () => {
  const valid = validateProfile({ ...baseProfile, sensitiveNeeds: ["children", "invalid"] });
  assert.deepEqual(valid.sensitiveNeeds, ["children"]);

  assert.throws(() => validateProfile({ ...baseProfile, householdSize: 20 }), /household size/i);
  assert.throws(() => validateProfile({ ...baseProfile, walkTime: 11 }), /walk time/i);
  assert.throws(() => validateProfile({ ...baseProfile, commuteKm: 120 }), /commute distance/i);
  assert.throws(() => validateProfile({ ...baseProfile, budget: "unlimited" }), /budget/i);
  assert.throws(() => validateProfile({ ...baseProfile, commuteMode: "plane" }), /commute mode/i);
});

test("validateAir normalizes invalid timezone to UTC and rejects unusable data", () => {
  const valid = validateAir({
    city: { name: "Delhi", country: "India", timezone: "Invalid/Zone" },
    current: 95.24,
    hourly: makeFutureAir().hourly,
    demo: true,
  });
  assert.equal(valid.city.timezone, "UTC");
  assert.equal(valid.current, 95.2);
  assert.match(valid.source, /Illustrative sample/);

  assert.throws(() => validateAir({ current: 50, hourly: [] }), /Refresh the forecast/);
  assert.throws(() => validateAir({ current: -5, hourly: makeFutureAir().hourly }), /current forecast/i);
});

test("createPlan recommends lower window for moderate air and indoor-first for severe smog", async () => {
  const moderateAir = makeFutureAir({ 7: 120, 12: 50, 13: 45, 14: 50 }, 120);
  const moderateResult = await createPlan(moderateAir, baseProfile, false);
  assert.equal(moderateResult.mode, "local");
  assert.equal(moderateResult.plan.actions[0].tone, "green");
  assert.equal(moderateResult.plan.actions[0].badge, "LOWER MODEL WINDOW");
  assert.equal(moderateResult.plan.actions[1].category, "fixed");
  assert.match(moderateResult.plan.actions[1].headline, /school run/i);
  assert.match(moderateResult.plan.actions[3].detail, /need no purchase/i);

  const severeAir = makeFutureAir({ 7: 260, 12: 170, 13: 165, 14: 170 }, 240, 210);
  const severeResult = await createPlan(severeAir, baseProfile, false);
  assert.equal(severeResult.plan.actions[0].tone, "amber");
  assert.equal(severeResult.plan.actions[0].badge, "VERY HIGH · INDOORS FIRST");
  assert.match(severeResult.plan.actions[0].headline, /indoors/i);
});

test("validModelPlan rejects unsafe medical claims, digits, and mismatched categories", () => {
  const air = makeFutureAir({ 7: 120, 12: 50, 13: 45, 14: 50 }, 120);
  const local = makeLocalPlan(air, baseProfile, {
    baselinePm25: 120,
    bestWindow: { start: air.hourly[12].time, end: air.hourly[14].time, meanPm25: 48.3 },
    exposurePercent: 60,
    emissionsKg: 0.5,
    emissionsNote: "test",
  });

  const cleanCandidate = {
    summary: "Keep the morning fixed and shift the walk later.",
    intro: "Here is a practical household schedule based on your city forecast.",
    actions: [
      { category: "routine", headline: "Shift the family walk toward the calmer afternoon" },
      { category: "fixed", headline: "Keep the school run steady and avoid idling" },
      { category: "commute", headline: "Try one bus trip if transit works today" },
      { category: "home", headline: "Focus on indoor source control first" },
    ],
  };
  const accepted = validModelPlan(cleanCandidate, local);
  assert.ok(accepted);
  assert.equal(accepted.actions[0].detail, local.actions[0].detail);

  assert.equal(
    validModelPlan({ ...cleanCandidate, summary: "This window is safe for kids." }, local),
    null,
  );
  assert.equal(
    validModelPlan({ ...cleanCandidate, intro: "PM2.5 is 45 today." }, local),
    null,
  );
  assert.equal(
    validModelPlan({
      ...cleanCandidate,
      actions: [cleanCandidate.actions[1], cleanCandidate.actions[0], cleanCandidate.actions[2], cleanCandidate.actions[3]],
    }, local),
    null,
  );
});

test("createPlan falls back cleanly when Gemini fails or returns invalid output", async (t) => {
  const previousKey = process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY = "test-key";
  try {
    t.mock.method(globalThis, "fetch", async () => ({
      ok: true,
      json: async () => ({
        candidates: [{
          content: {
            parts: [{
              text: JSON.stringify({
                summary: "Guaranteed safe air at 40 today!",
                intro: "Bad output",
                actions: [],
              }),
            }],
          },
        }],
      }),
    }));

    const air = makeFutureAir({ 7: 120, 12: 50, 13: 45, 14: 50 });
    const result = await createPlan(air, baseProfile, true);
    assert.equal(result.mode, "local");
    assert.match(result.notice, /temporarily unavailable/i);
  } finally {
    if (previousKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = previousKey;
  }
});

test("refinePlan accepts valid Gemini answer and blocks unsafe medical wording", async (t) => {
  const previousKey = process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY = "test-key";
  try {
    const air = makeFutureAir();
    const local = makeLocalPlan(air, baseProfile, {
      baselinePm25: 100,
      bestWindow: null,
      exposurePercent: null,
      emissionsKg: 0.4,
      emissionsNote: "test",
    });

    t.mock.method(globalThis, "fetch", async () => ({
      ok: true,
      json: async () => ({
        candidates: [{
          content: { parts: [{ text: JSON.stringify({ answer: "Keep the school pickup short and switch the engine off while waiting." }) }] },
        }],
      }),
    }));

    const good = await refinePlan("How do we handle pickup?", air, baseProfile, local);
    assert.match(good, /engine off/i);

    t.mock.method(globalThis, "fetch", async () => ({
      ok: true,
      json: async () => ({
        candidates: [{
          content: { parts: [{ text: JSON.stringify({ answer: "This will cure asthma symptoms." }) }] },
        }],
      }),
    }));

    const blocked = await refinePlan("Will this help?", air, baseProfile, local);
    assert.equal(blocked, null);
  } finally {
    if (previousKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = previousKey;
  }
});
