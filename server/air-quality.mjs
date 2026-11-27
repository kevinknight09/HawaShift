const GEOCODING_URL = "https://geocoding-api.open-meteo.com/v1/search";
const REVERSE_GEOCODING_URL = "https://nominatim.openstreetmap.org/reverse";
const AIR_URL = "https://air-quality-api.open-meteo.com/v1/air-quality";
const CACHE_TTL_MS = 10 * 60 * 1000;
const airCache = new Map();

export const MAJOR_INDIA_LOCATIONS = Object.freeze([
  Object.freeze({ name: "New Delhi", region: "Delhi", country: "India", latitude: 28.6139, longitude: 77.209, timezone: "Asia/Kolkata" }),
  Object.freeze({ name: "Mumbai", region: "Maharashtra", country: "India", latitude: 19.076, longitude: 72.8777, timezone: "Asia/Kolkata" }),
  Object.freeze({ name: "Bengaluru", region: "Karnataka", country: "India", latitude: 12.9716, longitude: 77.5946, timezone: "Asia/Kolkata" }),
  Object.freeze({ name: "Kolkata", region: "West Bengal", country: "India", latitude: 22.5726, longitude: 88.3639, timezone: "Asia/Kolkata" }),
  Object.freeze({ name: "Chennai", region: "Tamil Nadu", country: "India", latitude: 13.0827, longitude: 80.2707, timezone: "Asia/Kolkata" }),
  Object.freeze({ name: "Hyderabad", region: "Telangana", country: "India", latitude: 17.385, longitude: 78.4867, timezone: "Asia/Kolkata" }),
  Object.freeze({ name: "Pune", region: "Maharashtra", country: "India", latitude: 18.5204, longitude: 73.8567, timezone: "Asia/Kolkata" }),
  Object.freeze({ name: "Ahmedabad", region: "Gujarat", country: "India", latitude: 23.0225, longitude: 72.5714, timezone: "Asia/Kolkata" }),
  Object.freeze({ name: "Jaipur", region: "Rajasthan", country: "India", latitude: 26.9124, longitude: 75.7873, timezone: "Asia/Kolkata" }),
  Object.freeze({ name: "Lucknow", region: "Uttar Pradesh", country: "India", latitude: 26.8467, longitude: 80.9462, timezone: "Asia/Kolkata" }),
  Object.freeze({ name: "Kanpur", region: "Uttar Pradesh", country: "India", latitude: 26.4499, longitude: 80.3319, timezone: "Asia/Kolkata" }),
  Object.freeze({ name: "Patna", region: "Bihar", country: "India", latitude: 25.5941, longitude: 85.1376, timezone: "Asia/Kolkata" }),
  Object.freeze({ name: "Chandigarh", region: "Chandigarh", country: "India", latitude: 30.7333, longitude: 76.7794, timezone: "Asia/Kolkata" }),
  Object.freeze({ name: "Gurugram", region: "Haryana", country: "India", latitude: 28.4595, longitude: 77.0266, timezone: "Asia/Kolkata" }),
  Object.freeze({ name: "Varanasi", region: "Uttar Pradesh", country: "India", latitude: 25.3176, longitude: 82.9739, timezone: "Asia/Kolkata" }),
  Object.freeze({ name: "Bhopal", region: "Madhya Pradesh", country: "India", latitude: 23.2599, longitude: 77.4126, timezone: "Asia/Kolkata" }),
]);

export function listMajorIndiaLocations() {
  return MAJOR_INDIA_LOCATIONS.map(({ name, region, country }) => ({ name, region, country }));
}

export function clearAirCache() {
  airCache.clear();
}

function cleanCity(value) {
  if (typeof value !== "string") throw new Error("Enter a city or nearby area.");
  const city = value.trim().replace(/\s+/g, " ");
  if (city.length < 2 || city.length > 60) throw new Error("Enter a city name between 2 and 60 characters.");
  return city;
}

function cleanCoord(value, min, max, label) {
  if (value === null || value === undefined || String(value).trim() === "") {
    throw new Error("Provide valid " + label + " coordinates.");
  }
  const num = Number(value);
  if (!Number.isFinite(num) || num < min || num > max) {
    throw new Error("Provide valid " + label + " coordinates.");
  }
  return Math.round(num * 100) / 100;
}

async function fetchJson(url, headers = {}) {
  const response = await fetch(url, {
    headers: { accept: "application/json", ...headers },
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
    coverageNote: "Regional model grid; not a street-level monitor.",
  };
}

function setCachedForecast(cacheKey, forecast) {
  airCache.set(cacheKey, { cachedAt: Date.now(), value: forecast });
  if (airCache.size > 60) {
    for (const [key, entry] of airCache) {
      if (Date.now() - entry.cachedAt >= CACHE_TTL_MS || airCache.size > 60) airCache.delete(key);
    }
  }
}

async function fetchForecastAt(latitude, longitude, place) {
  const airParams = new URLSearchParams({
    latitude: String(latitude),
    longitude: String(longitude),
    current: "pm2_5",
    hourly: "pm2_5",
    forecast_days: "2",
    timezone: "auto",
    timeformat: "unixtime",
  });
  const data = await fetchJson(AIR_URL + "?" + airParams.toString());
  return toForecast(data, {
    name: place.name,
    admin1: place.admin1,
    country: place.country,
    timezone: place.timezone,
  });
}

async function reverseGeocode(latitude, longitude) {
  const params = new URLSearchParams({
    format: "jsonv2",
    lat: String(latitude),
    lon: String(longitude),
    zoom: "10",
    "accept-language": "en",
  });
  try {
    const place = await fetchJson(REVERSE_GEOCODING_URL + "?" + params.toString(), {
      "user-agent": "HawaShift/0.1 (urban air quality planner)",
    });
    const address = place?.address || {};
    const name = address.city || address.town || address.village || address.suburb || address.county || address.state_district || place?.name || "Your area";
    return {
      name: String(name).trim().slice(0, 60) || "Your area",
      admin1: String(address.state || address.region || "").trim().slice(0, 80),
      country: String(address.country || "").trim().slice(0, 80),
      timezone: "auto",
    };
  } catch {
    return { name: "Your area", admin1: "", country: "", timezone: "auto" };
  }
}

export async function fetchAirForCity(cityInput) {
  const name = cleanCity(cityInput);
  const normalized = name.toLocaleLowerCase("en");
  const cacheKey = "city:" + normalized;
  const cached = airCache.get(cacheKey);
  if (cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) return cached.value;

  const known = MAJOR_INDIA_LOCATIONS.find((entry) => entry.name.toLocaleLowerCase("en") === normalized);
  let place = known;
  if (!place) {
    const params = new URLSearchParams({ name, count: "1", language: "en", format: "json" });
    const geocoding = await fetchJson(GEOCODING_URL + "?" + params.toString());
    place = geocoding?.results?.[0];
  }
  if (!place || !Number.isFinite(Number(place.latitude)) || !Number.isFinite(Number(place.longitude))) {
    throw new Error("We couldn’t find that city. Try a nearby larger city.");
  }

  const forecast = await fetchForecastAt(place.latitude, place.longitude, {
    name: place.name,
    admin1: place.region ?? place.admin1,
    country: place.country,
    timezone: place.timezone,
  });
  setCachedForecast(cacheKey, forecast);
  return forecast;
}

export async function fetchAirForCoords(latInput, lonInput) {
  const latitude = cleanCoord(latInput, -90, 90, "latitude");
  const longitude = cleanCoord(lonInput, -180, 180, "longitude");
  const cacheKey = "coords:" + latitude.toFixed(2) + "," + longitude.toFixed(2);
  const cached = airCache.get(cacheKey);
  if (cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) return cached.value;

  const place = await reverseGeocode(latitude, longitude);
  const forecast = await fetchForecastAt(latitude, longitude, place);
  setCachedForecast(cacheKey, forecast);
  return forecast;
}
