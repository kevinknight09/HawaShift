const GEOCODING_URL = "https://geocoding-api.open-meteo.com/v1/search";
const AIR_URL = "https://air-quality-api.open-meteo.com/v1/air-quality";
const CACHE_TTL_MS = 10 * 60 * 1000;
const airCache = new Map();

export function clearAirCache() {
  airCache.clear();
}

function cleanCity(value) {
  if (typeof value !== "string") throw new Error("Enter a city or nearby area.");
  const city = value.trim().replace(/\s+/g, " ");
  if (city.length < 2 || city.length > 60) throw new Error("Enter a city name between 2 and 60 characters.");
  return city;
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(9000),
  });
  if (!response.ok) throw new Error("The air data provider is unavailable.");
  return response.json();
}

function toForecast(data, city) {
  const times = data?.hourly?.time;
  const values = data?.hourly?.pm2_5;
  if (!Array.isArray(times) || !Array.isArray(values) || times.length !== values.length || times.length === 0) {
    throw new Error("The air data provider returned an incomplete forecast.");
  }

  const hourly = times.slice(0, 48).flatMap((time, index) => {
    const value = Number(values[index]);
    const timestamp = typeof time === "number" && Number.isFinite(time)
      ? new Date(time * 1000).toISOString()
      : typeof time === "string" && Number.isFinite(Date.parse(time))
        ? new Date(time).toISOString()
        : null;
    if (!timestamp || !Number.isFinite(value) || value < 0) return [];
    return [{ time: timestamp, value: Math.round(value * 10) / 10 }];
  });

  if (hourly.length < 8) throw new Error("The air data provider returned too few forecast hours.");

  const currentFromProvider = Number(data?.current?.pm2_5);
  const now = Date.now();
  const currentIndex = hourly.findIndex((point) => Date.parse(point.time) >= now - 60 * 60 * 1000);
  const current = Number.isFinite(currentFromProvider) && currentFromProvider >= 0
    ? Math.round(currentFromProvider * 10) / 10
    : hourly[Math.max(0, currentIndex)]?.value;

  return {
    city: {
      name: city.name,
      region: city.admin1 || "",
      country: city.country || "",
      timezone: data.timezone || city.timezone || "auto",
    },
    current,
    hourly,
    source: "Open-Meteo · CAMS model forecast",
    sourceUrl: "https://open-meteo.com/en/docs/air-quality-api",
    fetchedAt: new Date().toISOString(),
    demo: false,
    coverageNote: "Regional model grid; not a street-level monitor.",
  };
}

export async function fetchAirForCity(cityInput) {
  const name = cleanCity(cityInput);
  const cacheKey = name.toLocaleLowerCase("en");
  const cached = airCache.get(cacheKey);
  if (cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) return cached.value;

  const params = new URLSearchParams({ name, count: "1", language: "en", format: "json" });
  const geocoding = await fetchJson(GEOCODING_URL + "?" + params.toString());
  const place = geocoding?.results?.[0];
  if (!place || !Number.isFinite(Number(place.latitude)) || !Number.isFinite(Number(place.longitude))) {
    throw new Error("We couldn’t find that city. Try a nearby larger city.");
  }

  const airParams = new URLSearchParams({
    latitude: String(place.latitude),
    longitude: String(place.longitude),
    current: "pm2_5",
    hourly: "pm2_5",
    forecast_days: "2",
    timezone: "auto",
    timeformat: "unixtime",
  });
  const data = await fetchJson(AIR_URL + "?" + airParams.toString());
  const forecast = toForecast(data, {
    name: place.name,
    admin1: place.admin1,
    country: place.country,
    timezone: place.timezone,
  });
  airCache.set(cacheKey, { cachedAt: Date.now(), value: forecast });
  if (airCache.size > 60) {
    for (const [key, entry] of airCache) {
      if (Date.now() - entry.cachedAt >= CACHE_TTL_MS || airCache.size > 60) airCache.delete(key);
    }
  }
  return forecast;
}
