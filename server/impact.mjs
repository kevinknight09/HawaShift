export const INDIA_MODE_FACTORS = Object.freeze({
  // Vehicle-level CO2 g/km factors from Government of India metro appraisal guidance.
  car: 139.52,
  twoWheeler: 25.52,
  bus: 787.72,
  // Occupancy defaults are explicit model assumptions, not measured local averages.
  occupants: Object.freeze({ car: 1.5, twoWheeler: 1.2, bus: 25 }),
  source: "https://rb.indianrailways.gov.in/uploads/directorate/works/pdf/2023/13_12_2023-%20Proforma%20for%20submission%20of%20Detailed%20Project%20Report.pdf",
});

function localHour(value, timezone) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return NaN;
  try {
    const hour = new Intl.DateTimeFormat("en-GB", { timeZone: timezone || "UTC", hour: "2-digit", hourCycle: "h23" })
      .formatToParts(date)
      .find((part) => part.type === "hour")?.value;
    return Number(hour);
  } catch {
    return date.getUTCHours();
  }
}

function localDate(value, timezone) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: timezone || "UTC", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
  } catch {
    return date.toISOString().slice(0, 10);
  }
}

function dateOrdinal(dateKey) {
  return Date.parse(dateKey + "T00:00:00Z");
}

export function formatClockTime(value, timezone) {
  const date = new Date(value);
  return new Intl.DateTimeFormat("en-IN", { timeZone: timezone || "UTC", hour: "numeric", minute: "2-digit" }).format(date);
}

export function formatPlanTime(value, timezone) {
  const date = new Date(value);
  const time = formatClockTime(value, timezone);
  const today = localDate(Date.now(), timezone);
  const target = localDate(date, timezone);
  const dayDifference = (dateOrdinal(target) - dateOrdinal(today)) / 86400000;
  if (dayDifference === 0) return "today at " + time;
  if (dayDifference === 1) return "tomorrow at " + time;
  return new Intl.DateTimeFormat("en-IN", { timeZone: timezone || "UTC", weekday: "short", hour: "numeric", minute: "2-digit" }).format(date);
}

function hourlyAt(hourly, hour, timezone) {
  if (!Array.isArray(hourly) || hourly.length === 0) return null;
  const candidates = hourly.map((point) => ({
    value: Number(point.value),
    hour: localHour(point.time, timezone),
    time: Date.parse(point.time),
  })).filter((point) => Number.isFinite(point.value) && Number.isFinite(point.time) && point.time >= Date.now());
  const matching = candidates.filter((point) => point.hour === hour).sort((a, b) => a.time - b.time);
  return matching[0] || candidates.sort((a, b) => a.time - b.time)[0] || null;
}

function bestDaylightWindow(hourly, timezone, targetDate) {
  if (!Array.isArray(hourly) || hourly.length < 2) return null;
  const daytime = hourly.map((point) => ({
    time: point.time,
    value: Number(point.value),
    hour: localHour(point.time, timezone),
    timestamp: Date.parse(point.time),
  })).filter((point) => Number.isFinite(point.value) && Number.isFinite(point.timestamp) && point.timestamp >= Date.now() && point.hour >= 10 && point.hour <= 17 && (!targetDate || localDate(point.timestamp, timezone) === targetDate));
  if (daytime.length < 3) return null;

  let best = null;
  for (let index = 0; index < daytime.length - 2; index += 1) {
    const first = daytime[index];
    const second = daytime[index + 1];
    const third = daytime[index + 2];
    const firstTime = Date.parse(first.time);
    const secondTime = Date.parse(second.time);
    const thirdTime = Date.parse(third.time);
    const oneHour = 60 * 60 * 1000;
    if (!Number.isFinite(firstTime) || !Number.isFinite(secondTime) || !Number.isFinite(thirdTime) ||
      secondTime - firstTime > oneHour + 1000 || thirdTime - secondTime > oneHour + 1000) continue;
    const mean = (first.value + second.value + third.value) / 3;
    if (!best || mean < best.mean) {
      best = { start: first.time, end: third.time, mean, hour: first.hour };
    }
  }
  return best;
}

function summarizeUpcomingDay(hourly) {
  if (!Array.isArray(hourly) || hourly.length === 0) return null;
  const now = Date.now();
  const future = hourly
    .map((point) => ({ time: point.time, value: Number(point.value), timestamp: Date.parse(point.time) }))
    .filter((point) => Number.isFinite(point.value) && Number.isFinite(point.timestamp) && point.timestamp >= now)
    .slice(0, 24);
  if (future.length === 0) return null;

  let min = future[0];
  let max = future[0];
  for (const point of future) {
    if (point.value < min.value) min = point;
    if (point.value > max.value) max = point;
  }
  return {
    minPm25: Math.round(min.value * 10) / 10,
    minTime: min.time,
    maxPm25: Math.round(max.value * 10) / 10,
    peakTime: max.time,
  };
}

function privateVehicleMode(mode) {
  if (mode === "car") return "car";
  if (mode === "scooter") return "twoWheeler";
  return null;
}

export function calculateImpact(air, profile) {
  const walkStart = Number(profile.walkTime);
  const timezone = air?.city?.timezone || "UTC";
  const baseline = hourlyAt(air?.hourly, walkStart, timezone);
  const window = bestDaylightWindow(air?.hourly, timezone, baseline ? localDate(baseline.time, timezone) : "");
  let exposurePercent = null;
  let exposureDelta = null;
  if (baseline && window && baseline.value > 0) {
    exposureDelta = Math.max(0, baseline.value - window.mean);
    exposurePercent = Math.round((exposureDelta / baseline.value) * 100);
  }

  let emissionsKg = null;
  let privateKg = null;
  let busKg = null;
  let emissionsNote = "Choose a private motor commute to compare with the bus estimate.";
  const mode = privateVehicleMode(profile.commuteMode);
  const distance = Number(profile.commuteKm);
  const isIndia = String(air?.city?.country || "").toLocaleLowerCase("en") === "india";
  if (mode && Number.isFinite(distance) && distance > 0 && isIndia) {
    const factor = INDIA_MODE_FACTORS;
    const privatePerPassengerKm = factor[mode] / factor.occupants[mode];
    const busPerPassengerKm = factor.bus / factor.occupants.bus;
    privateKg = Math.round(((privatePerPassengerKm * distance) / 1000) * 1000) / 1000;
    busKg = Math.round(((busPerPassengerKm * distance) / 1000) * 1000) / 1000;
    const savedGrams = (privatePerPassengerKm - busPerPassengerKm) * distance;
    emissionsKg = Math.round((savedGrams / 1000) * 1000) / 1000;
    emissionsNote = "One-way comparison; default occupancy: 1.5 people per car, 1.2 per two-wheeler, 25 per bus.";
  } else if (mode && Number.isFinite(distance) && distance > 0 && !isIndia) {
    emissionsNote = "Commute estimate unavailable: the published mode factors in this prototype are specific to India.";
  }

  const range24h = summarizeUpcomingDay(air?.hourly);

  return {
    baselinePm25: baseline ? baseline.value : null,
    bestWindow: window ? {
      start: window.start,
      end: window.end,
      meanPm25: Math.round(window.mean * 10) / 10,
    } : null,
    range24h,
    exposurePercent,
    exposureDelta: exposureDelta === null ? null : Math.round(exposureDelta * 10) / 10,
    emissionsKg,
    privateKg,
    busKg,
    emissionsNote,
    emissionsSource: INDIA_MODE_FACTORS.source,
    walkMinutes: 20,
  };
}
