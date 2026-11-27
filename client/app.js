const FALLBACK_INDIA_LOCATIONS = [
  { name: "New Delhi", region: "Delhi", country: "India" },
  { name: "Mumbai", region: "Maharashtra", country: "India" },
  { name: "Bengaluru", region: "Karnataka", country: "India" },
  { name: "Kolkata", region: "West Bengal", country: "India" },
  { name: "Chennai", region: "Tamil Nadu", country: "India" },
  { name: "Hyderabad", region: "Telangana", country: "India" },
  { name: "Pune", region: "Maharashtra", country: "India" },
  { name: "Ahmedabad", region: "Gujarat", country: "India" },
  { name: "Jaipur", region: "Rajasthan", country: "India" },
  { name: "Lucknow", region: "Uttar Pradesh", country: "India" },
  { name: "Kanpur", region: "Uttar Pradesh", country: "India" },
  { name: "Patna", region: "Bihar", country: "India" },
  { name: "Chandigarh", region: "Chandigarh", country: "India" },
  { name: "Gurugram", region: "Haryana", country: "India" },
  { name: "Varanasi", region: "Uttar Pradesh", country: "India" },
  { name: "Bhopal", region: "Madhya Pradesh", country: "India" },
];

const state = {
  air: null,
  profile: null,
  plan: null,
  impact: null,
  geminiConfigured: false,
  loading: false,
  forecastLoading: false,
};

const byId = (id) => document.getElementById(id);
const numberFormat = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 1 });

function formatTime(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "later";
  return new Intl.DateTimeFormat("en-IN", { timeZone: state.air?.city?.timezone || "UTC", hour: "numeric", minute: "2-digit" }).format(date);
}

function formatHour(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-IN", { timeZone: state.air?.city?.timezone || "UTC", hour: "numeric" }).format(date);
}

function formatSelectedHour(hour) {
  const date = new Date(Date.UTC(2000, 0, 1, Number(hour)));
  return new Intl.DateTimeFormat("en-IN", { timeZone: "UTC", hour: "numeric" }).format(date);
}

function formatWindowTime(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return formatTime(value);
  const timezone = state.air?.city?.timezone || "UTC";
  const key = (item) => new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit",
  }).format(item);
  const difference = (Date.parse(key(date) + "T00:00:00Z") - Date.parse(key(new Date()) + "T00:00:00Z")) / 86400000;
  const time = formatTime(value);
  if (difference === 0) return "today at " + time;
  if (difference === 1) return "tomorrow at " + time;
  return new Intl.DateTimeFormat("en-IN", { timeZone: timezone, weekday: "short", hour: "numeric", minute: "2-digit" }).format(date);
}

function localHour(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return NaN;
  try {
    const hour = new Intl.DateTimeFormat("en-GB", {
      timeZone: state.air?.city?.timezone || "UTC", hour: "2-digit", hourCycle: "h23",
    }).formatToParts(date).find((part) => part.type === "hour")?.value;
    return Number(hour);
  } catch {
    return date.getUTCHours();
  }
}

function setStatus(text, mode) {
  const status = byId("planStatus");
  status.textContent = text;
  status.dataset.state = mode || "ready";
}

function toast(message) {
  const node = byId("toast");
  node.textContent = message;
  node.classList.add("visible");
  window.clearTimeout(toast.timer);
  toast.timer = window.setTimeout(() => node.classList.remove("visible"), 3100);
}

function pmBand(value) {
  if (value < 20) return { label: "Lower model value", className: "level-lower" };
  if (value < 40) return { label: "Moderate model value", className: "level-moderate" };
  if (value < 80) return { label: "Elevated model value", className: "level-elevated" };
  if (value < 130) return { label: "High model value", className: "level-high" };
  return { label: "Very high model value", className: "level-very-high" };
}

function scaledHeight(value, maximum) {
  return Math.max(1, Math.min(10, Math.round((value / Math.max(maximum, 1)) * 9) + 1));
}

function renderEmptyAir(subtitle = "Allow location or enter a city") {
  state.air = null;
  byId("cityName").textContent = "Your location";
  byId("cityCountry").textContent = subtitle;
  byId("sourceBadge").textContent = "LIVE MODEL";
  byId("pmValue").textContent = "—";
  const level = byId("pmLevel");
  level.className = "air-level";
  const levelDot = document.createElement("span");
  levelDot.className = "level-dot";
  levelDot.setAttribute("aria-hidden", "true");
  level.replaceChildren(levelDot, document.createTextNode(subtitle));
  byId("forecastStamp").textContent = "No forecast loaded yet";
  byId("timelineSource").textContent = "CAMS forecast · waiting for location";
  byId("airChart").setAttribute("aria-label", "Hourly PM2.5 forecast chart, waiting for location or city");
  byId("airBars").replaceChildren();
  const timesHost = document.querySelector(".chart-times");
  if (timesHost) {
    timesHost.replaceChildren(...Array.from({ length: 4 }, () => {
      const span = document.createElement("span");
      span.textContent = "—";
      return span;
    }));
  }
  byId("timeline").replaceChildren();
  byId("bestTimeLabel").textContent = "Forecast needed to find a lower window";
  byId("bestTimeDetail").textContent = "Allow location access or enter a city below to load live hourly PM₂.₅.";
}

function renderAir(air, preferredWindow = null, usePlanWindow = false) {
  state.air = air;
  const city = air.city?.name || "Selected city";
  byId("cityName").textContent = city;
  byId("cityCountry").textContent = [air.city?.region, air.city?.country].filter(Boolean).join(", ");
  byId("sourceBadge").textContent = "CAMS MODEL";
  byId("pmValue").textContent = numberFormat.format(air.current);
  const band = pmBand(air.current);
  const level = byId("pmLevel");
  level.className = "air-level " + band.className;
  const levelDot = document.createElement("span");
  levelDot.className = "level-dot";
  levelDot.setAttribute("aria-hidden", "true");
  level.replaceChildren(levelDot, document.createTextNode(band.label));
  byId("forecastStamp").textContent = "Retrieved " + formatTime(air.fetchedAt);
  byId("timelineSource").textContent = "CAMS forecast · regional model grid";
  byId("airChart").setAttribute(
    "aria-label",
    "Regional model PM2.5 forecast for " + city + ". Lower values indicate less modeled particulate pollution. Not a street-level monitor."
  );
  renderBars(air.hourly);
  renderChartTimes(air.hourly);
  renderTimeline(air.hourly, usePlanWindow ? preferredWindow : undefined);
  updateBestWindow(preferredWindow, !usePlanWindow);
}

function renderBars(hourly) {
  const host = byId("airBars");
  host.replaceChildren();
  const points = hourly.slice(0, 24);
  const maximum = Math.max(1, ...points.map((point) => Number(point.value) || 0));
  let lowestIndex = -1;
  let lowestValue = Infinity;
  const currentIndex = points.reduce((bestIndex, point, index) => {
    if (bestIndex === -1) return index;
    return Math.abs(Date.parse(point.time) - Date.now()) < Math.abs(Date.parse(points[bestIndex].time) - Date.now()) ? index : bestIndex;
  }, -1);
  points.forEach((point, index) => {
    const hour = localHour(point.time);
    if (hour >= 10 && hour <= 17 && Number(point.value) < lowestValue) {
      lowestValue = Number(point.value);
      lowestIndex = index;
    }
  });
  points.forEach((point, index) => {
    const value = Number(point.value) || 0;
    const bar = document.createElement("span");
    bar.className = "forecast-bar bar-height-" + scaledHeight(value, maximum) + (index === lowestIndex ? " bar-low" : "");
    if (index === currentIndex) bar.classList.add("bar-current");
    bar.setAttribute("aria-hidden", "true");
    host.append(bar);
  });
}

function renderChartTimes(hourly) {
  const host = document.querySelector(".chart-times");
  host.replaceChildren();
  [0, 6, 12, 18].forEach((index) => {
    const item = document.createElement("span");
    item.textContent = formatHour(hourly[index]?.time || hourly[0]?.time || "");
    host.append(item);
  });
}

function bestWindowFrom(hourly) {
  if (!Array.isArray(hourly) || hourly.length < 2) return null;
  const daytime = hourly.map((point) => ({
    time: point.time,
    value: Number(point.value),
    hour: localHour(point.time),
    timestamp: Date.parse(point.time),
  })).filter((point) => Number.isFinite(point.value) && Number.isFinite(point.timestamp) && point.timestamp >= Date.now() && point.hour >= 10 && point.hour <= 17);
  let best = null;
  for (let index = 0; index < daytime.length - 2; index += 1) {
    const current = daytime[index];
    const next = daytime[index + 1];
    const third = daytime[index + 2];
    const oneHour = 60 * 60 * 1000;
    if (Date.parse(next.time) - Date.parse(current.time) > oneHour + 1000 || Date.parse(third.time) - Date.parse(next.time) > oneHour + 1000) continue;
    const mean = (current.value + next.value + third.value) / 3;
    if (!best || mean < best.mean) best = { start: current.time, end: third.time, mean };
  }
  return best;
}

function renderTimeline(hourly, preferredWindow = undefined) {
  const host = byId("timeline");
  host.replaceChildren();
  const firstFuture = hourly.findIndex((point) => Date.parse(point.time) >= Date.now());
  const rollingDay = firstFuture >= 0 ? hourly.slice(firstFuture, firstFuture + 24) : hourly.slice(0, 24);
  const points = rollingDay.filter((point, index) => index % 2 === 0);
  const maximum = Math.max(1, ...points.map((point) => Number(point.value) || 0));
  const window = preferredWindow === undefined ? bestWindowFrom(hourly) : preferredWindow;
  points.forEach((point, index) => {
    const slot = document.createElement("div");
    slot.className = "timeline-slot";
    slot.setAttribute("role", "listitem");
    const value = Number(point.value) || 0;
    const top = document.createElement("span");
    top.className = "timeline-value";
    top.textContent = Math.round(value);
    const wrap = document.createElement("span");
    wrap.className = "timeline-bar-wrap";
    const bar = document.createElement("span");
    const slotStart = Date.parse(point.time);
    const slotEnd = Date.parse(points[index + 1]?.time || new Date(slotStart + 2 * 60 * 60 * 1000).toISOString());
    const inWindow = window && slotStart <= Date.parse(window.end) && slotEnd >= Date.parse(window.start);
    bar.className = "timeline-bar level-" + scaledHeight(value, maximum) + (inWindow ? " lower-period" : "");
    bar.setAttribute("aria-hidden", "true");
    wrap.append(bar);
    const hour = document.createElement("span");
    hour.className = "timeline-hour";
    hour.textContent = formatHour(point.time);
    slot.setAttribute("aria-label", formatHour(point.time) + ", model PM2.5 " + numberFormat.format(value) + " micrograms per cubic metre");
    slot.append(top, wrap, hour);
    host.append(slot);
  });
}

function updateBestWindow(window, allowFallback = true) {
  const selected = window || (allowFallback && state.air?.hourly ? bestWindowFrom(state.air.hourly) : null);
  if (!selected) {
    byId("bestTimeLabel").textContent = "No clear lower period in this forecast";
    byId("bestTimeDetail").textContent = "Keep flexible outdoor time short while conditions remain elevated.";
    return;
  }
  byId("bestTimeLabel").textContent = "Try " + formatWindowTime(selected.start) + "–" + formatTime(selected.end) + " for a flexible activity";
  byId("bestTimeDetail").textContent = "Two-hour modeled mean: " + numberFormat.format(selected.meanPm25 ?? selected.mean) + " µg/m³. Lower forecast, not a safe-air guarantee.";
}

function currentProfile() {
  const commuteKm = Number(byId("commuteKm").value);
  const fixedCommitment = byId("fixedCommitment").value;
  return {
    city: byId("cityInput").value.trim(),
    householdSize: Number(byId("householdSize").value),
    budget: byId("budget").value,
    walkTime: Number(byId("walkTime").value),
    commuteMode: byId("commuteMode").value,
    commuteKm: Number.isFinite(commuteKm) ? commuteKm : 0,
    fixedCommitment,
    schoolFixed: fixedCommitment === "school",
    sensitiveNeeds: [
      byId("hasChildren").checked ? "children" : null,
      byId("hasOlderAdult").checked ? "olderAdult" : null,
      byId("hasRespiratory").checked ? "respiratory" : null,
    ].filter(Boolean),
  };
}

function updateProfileSummary(profile) {
  const size = profile.householdSize >= 6 ? "6+" : String(profile.householdSize);
  const householdSummary = byId("householdSummary");
  if (householdSummary) {
    householdSummary.textContent = profile.householdSize === 1
      ? "1 person, personal plan"
      : size + " people, one shared plan";
  }
  byId("walkSchedule").textContent = "Flexible · " + formatSelectedHour(profile.walkTime);
  const fixedLabels = {
    school: ["School run", "Fixed daily anchor"],
    work: ["Work / shift", "Fixed daily anchor"],
    errands: ["Essential errands", "Fixed daily anchor"],
    none: ["Schedule", "All trips flexible"],
  };
  const [fixedTitle, fixedText] = fixedLabels[profile.fixedCommitment] || fixedLabels.school;
  if (byId("fixedTitle")) byId("fixedTitle").textContent = fixedTitle;
  if (byId("fixedSchedule")) byId("fixedSchedule").textContent = fixedText;
  const modeNames = {
    car: "Car",
    scooter: "Two-wheeler",
    bus: "Bus",
    metro: "Metro",
    walk: "Walk / cycle",
    remote: "At home",
  };
  if (byId("commuteSchedule")) {
    byId("commuteSchedule").textContent = profile.commuteMode === "remote"
      ? "At home · 0 km"
      : (modeNames[profile.commuteMode] || "Commute") + " · " + profile.commuteKm + " km";
  }
  const planStyles = {
    zero: "Free changes first",
    low: "Low-cost, practical changes",
    mid: "Balanced, budget-aware",
    flex: "Flexible budget options",
  };
  byId("planStyle").textContent = planStyles[profile.budget] || "Practical, low-cost changes";
  const budgetNudges = {
    zero: "No purchase needed first",
    low: "Check existing filters first",
    mid: "Compare filter running costs",
    flex: "Size equipment to your room",
  };
  byId("budgetNudge").textContent = budgetNudges[profile.budget] || budgetNudges.zero;
  const commuteDistances = byId("commuteKm");
  if (commuteDistances) commuteDistances.setAttribute("aria-label", "One-way commute distance in kilometres");
}

function makeActionCard(action, impact) {
  const icons = { routine: "◷", fixed: "⌁", commute: "⌖", home: "⌂" };
  const tones = { routine: "icon-clock", fixed: "icon-route", commute: "icon-route", home: "icon-home" };
  const card = document.createElement("article");
  card.className = "action-card" + (action.category === "routine" ? " action-card-featured" : "");

  const time = document.createElement("div");
  time.className = "action-time";
  const icon = document.createElement("span");
  icon.className = "action-icon " + (tones[action.category] || "icon-route");
  icon.textContent = icons[action.category] || "✦";
  const tag = document.createElement("span");
  tag.textContent = action.tag || action.category.toUpperCase();
  time.append(icon, tag);

  const body = document.createElement("div");
  body.className = "action-body";
  const heading = document.createElement("h4");
  heading.textContent = action.headline;
  const detail = document.createElement("p");
  detail.textContent = action.detail;
  const meta = document.createElement("div");
  meta.className = "action-meta";
  const cost = document.createElement("span");
  cost.className = "meta-tag";
  cost.textContent = action.category === "home" ? "No-cost first" : action.category === "commute" ? "If practical" : "Fits your routine";
  const source = document.createElement("span");
  source.className = "meta-tag meta-muted";
  source.textContent = "Regional forecast";
  meta.append(cost, source);
  body.append(heading, detail, meta);

  const badge = document.createElement("span");
  badge.className = "action-impact " + (action.category === "fixed" ? "impact-neutral" : action.category === "home" ? "impact-home" : "");
  if (action.category === "routine" && impact?.exposurePercent > 0) {
    badge.textContent = "≈" + impact.exposurePercent + "% LOWER PROXY";
  } else if (action.category === "commute" && impact?.emissionsKg !== null && impact?.emissionsKg !== undefined) {
    badge.textContent = impact.emissionsKg > 0
      ? "≈" + impact.emissionsKg.toFixed(2) + " KG CO₂ SAVED"
      : impact.emissionsKg < 0
        ? "≈" + Math.abs(impact.emissionsKg).toFixed(2) + " KG CO₂ MORE"
        : "NO MODELED DIFFERENCE";
  } else {
    badge.textContent = action.badge || "ACTION";
  }
  card.append(time, body, badge);
  return card;
}

function renderPlan(result) {
  state.plan = result.plan;
  state.impact = result.impact;
  byId("planSummary").textContent = result.plan.summary;
  byId("planIntro").textContent = result.plan.intro;
  const mode = byId("aiMode");
  mode.dataset.mode = result.mode;
  const spark = document.createElement("span");
  spark.className = "ai-spark";
  spark.setAttribute("aria-hidden", "true");
  spark.textContent = "✦";
  mode.replaceChildren(spark, document.createTextNode(result.mode === "gemini" ? "Gemini tailored" : "Local guide"));

  const list = byId("actionList");
  list.replaceChildren(...result.plan.actions.map((action) => makeActionCard(action, result.impact)));
  renderImpact(result.impact);
  if (result.air) renderAir(result.air, result.impact.bestWindow, true);
  else updateBestWindow(result.impact.bestWindow, false);
  if (result.notice) {
    setStatus(result.notice, "ready");
  } else {
    setStatus(result.mode === "gemini" ? "Gemini tailored the language; the calculations stay deterministic." : "Local guide ready. No profile or routine was saved.", "ready");
  }
}

function renderImpact(impact) {
  const exposure = byId("impactExposure");
  const exposureLabel = byId("impactExposureLabel");
  const carbon = byId("impactCarbon");
  const carbonLabel = byId("impactCarbonLabel");
  if (impact.exposurePercent !== null && impact.exposurePercent > 0) {
    exposure.textContent = String(impact.exposurePercent);
    const unit = document.createElement("small");
    unit.textContent = "%";
    exposure.append(unit);
    exposureLabel.textContent = "lower modeled PM₂.₅ exposure proxy for a 20-min walk";
  } else {
    exposure.textContent = "—";
    const unit = document.createElement("small");
    unit.textContent = "%";
    exposure.append(unit);
    exposureLabel.textContent = "no lower window found versus your usual time";
  }
  if (impact.emissionsKg !== null) {
    carbon.textContent = impact.emissionsKg.toFixed(2);
    const unit = document.createElement("small");
    unit.textContent = "kg";
    carbon.append(unit);
    carbonLabel.textContent = "kg CO₂ saved (+) or added (−) by switching to bus, one way";
  } else {
    carbon.textContent = "—";
    const unit = document.createElement("small");
    unit.textContent = "kg";
    carbon.append(unit);
    carbonLabel.textContent = impact.emissionsNote.startsWith("Commute estimate unavailable")
      ? "India mode factors are not available for this location"
      : "choose a private motor commute to compare";
  }
  byId("impactFoot").textContent = impact.emissionsNote + " Outdoor proxy uses a 20-minute walk and model values; it is not an inhaled dose or health outcome.";
}

function markPlanStale() {
  if (!state.plan) return;
  state.plan = null;
  state.impact = null;
  byId("planSummary").textContent = "Forecast refreshed. Rebuild your day plan.";
  byId("planIntro").textContent = "The previous recommendations were cleared. Build a new plan to compare this updated forecast and household schedule.";
  byId("actionList").replaceChildren();
  byId("impactExposure").replaceChildren(document.createTextNode("—"), Object.assign(document.createElement("small"), { textContent: "%" }));
  byId("impactExposureLabel").textContent = "rebuild the plan to update this estimate";
  byId("impactCarbon").replaceChildren(document.createTextNode("—"), Object.assign(document.createElement("small"), { textContent: "kg" }));
  byId("impactCarbonLabel").textContent = "rebuild the plan to update this estimate";
  byId("impactFoot").textContent = "The forecast changed. Rebuild the plan to recalculate the comparison.";
  byId("refineResult").textContent = "Build a fresh plan before asking a follow-up question.";
  setStatus("Forecast refreshed. Build your day plan to update the recommendations.", "ready");
}

async function getJson(url, options) {
  const response = await fetch(url, options);
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const message = payload?.error?.message || "That request could not be completed.";
    throw new Error(message);
  }
  return payload;
}

async function fetchForecast(url, labelText, commit = true, { quietError = false } = {}) {
  if (state.forecastLoading) return null;
  state.forecastLoading = true;
  const refreshButton = byId("refreshAir");
  const locationButton = byId("useLocation");
  const refreshLabel = refreshButton.lastChild;
  refreshButton.disabled = true;
  locationButton.disabled = true;
  refreshButton.setAttribute("aria-busy", "true");
  locationButton.setAttribute("aria-busy", "true");
  if (refreshLabel && refreshLabel.nodeType === Node.TEXT_NODE) refreshLabel.textContent = " Finding forecast…";
  try {
    const result = await getJson(url, { signal: AbortSignal.timeout(11000) });
    if (commit) {
      renderAir(result);
      markPlanStale();
    }
    if (result.city?.name) {
      byId("cityInput").value = result.city.name;
      const manualInput = byId("manualCityInput");
      if (manualInput) manualInput.value = result.city.name;
      const select = byId("majorCitySelect");
      if (select) {
        const match = Array.from(select.options).find((opt) => sameCity(opt.value, result.city.name));
        select.value = match ? match.value : "";
      }
    }
    toast("Regional forecast loaded for " + (result.city?.name || labelText) + ".");
    return result;
  } catch (error) {
    if (!quietError) {
      toast(error instanceof Error ? error.message : "Forecast unavailable right now.");
    }
    return null;
  } finally {
    state.forecastLoading = false;
    refreshButton.disabled = state.loading;
    locationButton.disabled = state.loading;
    refreshButton.removeAttribute("aria-busy");
    locationButton.removeAttribute("aria-busy");
    if (refreshLabel && refreshLabel.nodeType === Node.TEXT_NODE) refreshLabel.textContent = " Refresh local forecast";
  }
}

async function refreshAir(city, commit = true) {
  const clean = String(city || "").trim();
  if (clean.length < 2) {
    toast("Enter a city name or click Use my location.");
    byId("cityInput").focus();
    return null;
  }
  return fetchForecast("/api/air?city=" + encodeURIComponent(clean), clean, commit);
}

function getBrowserPosition() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error("Location access is not supported in this browser."));
      return;
    }
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: false,
      timeout: 8000,
      maximumAge: 300_000,
    });
  });
}

async function refreshAirFromLocation({ auto = false } = {}) {
  if (state.forecastLoading || state.loading) return null;
  if (!navigator.geolocation) {
    if (!auto) toast("Location access is not supported in this browser. Enter your city below.");
    return null;
  }
  if (auto) setStatus("Checking your location for a live forecast…", "loading");
  try {
    const position = await getBrowserPosition();
    const { latitude, longitude } = position.coords;
    const result = await fetchForecast(
      "/api/air?lat=" + encodeURIComponent(latitude) + "&lon=" + encodeURIComponent(longitude),
      "your area",
      true,
      { quietError: auto },
    );
    if (result) {
      if (result.city?.name) byId("cityInput").value = result.city.name;
      setStatus("Live forecast loaded for " + (result.city?.name || "your location") + ". Ready to build your plan.", "ready");
    } else if (auto) {
      setStatus("Could not load forecast automatically. Enter your city and refresh.", "ready");
    }
    return result;
  } catch (error) {
    const denied = error && typeof error === "object" && "code" in error && error.code === 1;
    const message = denied
      ? "Location access was declined. Enter your city below to load a live forecast."
      : "Couldn’t detect your location. Enter your city below to load a live forecast.";
    if (!auto) toast(message);
    if (!state.air) renderEmptyAir("Enter a city below to load a forecast");
    setStatus(message, "ready");
    return null;
  }
}

function sameCity(first, second) {
  return String(first || "").trim().toLocaleLowerCase() === String(second || "").trim().toLocaleLowerCase();
}

async function submitPlan(event) {
  event.preventDefault();
  if (state.loading || state.forecastLoading) {
    if (state.forecastLoading) setStatus("Let the forecast refresh finish before building the plan.", "loading");
    return;
  }
  const profile = currentProfile();
  if (profile.city.length < 2) {
    setStatus("Allow location access or enter a city first.", "error");
    byId("cityInput").focus();
    return;
  }
  updateProfileSummary(profile);
  state.loading = true;
  const button = byId("planButton");
  const refreshButton = byId("refreshAir");
  const locationButton = byId("useLocation");
  button.disabled = true;
  refreshButton.disabled = true;
  locationButton.disabled = true;
  button.querySelector(".button-label").textContent = "Preparing your plan…";
  let planAir = state.air;

  try {
    if (!planAir || !sameCity(profile.city, planAir.city?.name)) {
      setStatus("Loading the forecast for " + profile.city + "…", "loading");
      const refreshed = await refreshAir(profile.city, false);
      if (!refreshed) {
        setStatus("Couldn’t load that location. Check the city name and try again.", "error");
        return;
      }
      planAir = refreshed;
    }

    button.querySelector(".button-label").textContent = "Building your plan…";
    setStatus("Keeping fixed commitments in place and comparing the flexible hours…", "loading");
    const result = await getJson("/api/plan", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        profile,
        air: planAir,
        useGemini: byId("aiConsent").checked && state.geminiConfigured,
      }),
      signal: AbortSignal.timeout(18000),
    });
    state.profile = profile;
    renderPlan(result);
  } catch (error) {
    setStatus(error instanceof Error ? error.message : "The plan could not be built. Please try again.", "error");
  } finally {
    state.loading = false;
    button.disabled = false;
    refreshButton.disabled = false;
    locationButton.disabled = false;
    button.querySelector(".button-label").textContent = "Build our day plan";
  }
}

async function submitRefinement(event) {
  event.preventDefault();
  const question = byId("refineQuestion").value.trim();
  const resultNode = byId("refineResult");
  if (question.length < 3) {
    resultNode.textContent = "Add a little more detail about what cannot change.";
    byId("refineQuestion").focus();
    return;
  }
  if (!state.plan || !state.profile) {
    resultNode.textContent = "Build your day plan first so HawaShift can answer from your forecast and schedule.";
    return;
  }
  const button = byId("refineButton");
  button.disabled = true;
  resultNode.textContent = "Thinking through that constraint…";
  try {
    const response = await getJson("/api/refine", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        question,
        profile: state.profile,
        air: state.air,
        plan: state.plan,
        useGemini: byId("aiConsent").checked && state.geminiConfigured,
      }),
      signal: AbortSignal.timeout(18000),
    });
    resultNode.textContent = response.answer + (response.mode === "local" ? " (Local guide)" : "");
  } catch (error) {
    resultNode.textContent = error instanceof Error ? error.message : "The follow-up could not be answered right now.";
  } finally {
    button.disabled = false;
  }
}

async function copyInvite() {
  const city = byId("cityInput").value.trim() || "our neighborhood";
  const invite = "Want to try a small clean-air routine with us in " + city + "? We’re keeping school pickup moving, switching engines off while waiting, and combining errands where it works. Join in only if it fits your day.";
  try {
    await navigator.clipboard.writeText(invite);
    byId("communityStatus").textContent = "Invite copied. Share it only if you choose.";
    toast("Neighbor invite copied.");
  } catch {
    byId("communityStatus").textContent = invite;
  }
}

function toggleMethod() {
  const details = byId("methodDetails");
  const button = byId("methodButton");
  const expanded = button.getAttribute("aria-expanded") === "true";
  button.setAttribute("aria-expanded", String(!expanded));
  details.hidden = expanded;
  button.lastChild.textContent = expanded ? " +" : " −";
}

function initializeNavigation() {
  const button = byId("menuButton");
  const nav = document.querySelector(".main-nav");
  button.addEventListener("click", () => {
    const expanded = button.getAttribute("aria-expanded") === "true";
    button.setAttribute("aria-expanded", String(!expanded));
    button.setAttribute("aria-label", expanded ? "Open menu" : "Close menu");
    nav.classList.toggle("open", !expanded);
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && button.getAttribute("aria-expanded") === "true") {
      button.setAttribute("aria-expanded", "false");
      button.setAttribute("aria-label", "Open menu");
      nav.classList.remove("open");
      button.focus();
    }
  });
  nav.addEventListener("click", (event) => {
    if (event.target.closest("a")) {
      button.setAttribute("aria-expanded", "false");
      button.setAttribute("aria-label", "Open menu");
      nav.classList.remove("open");
    }
  });
  document.querySelectorAll("[data-scroll-to]").forEach((link) => {
    link.addEventListener("click", () => {
      const target = link.getAttribute("data-scroll-to");
      if (target === "profile") byId("cityInput").focus({ preventScroll: true });
      document.querySelector("#profileForm").scrollIntoView({ behavior: "smooth", block: "center" });
    });
  });
}

function toggleManualLocationPanel(forceOpen) {
  const panel = byId("manualLocationPanel");
  const button = byId("manualLocationBtn");
  if (!panel || !button) return;
  const shouldOpen = typeof forceOpen === "boolean" ? forceOpen : panel.hidden;
  panel.hidden = !shouldOpen;
  button.setAttribute("aria-expanded", String(shouldOpen));
  if (shouldOpen) {
    byId("majorCitySelect")?.focus();
  }
}

function renderLocationOptions(locations) {
  const select = byId("majorCitySelect");
  const datalist = byId("majorCitiesList");
  if (select) {
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = "Select a major Indian city…";
    const items = locations.map((loc) => {
      const option = document.createElement("option");
      option.value = loc.name;
      option.textContent = loc.region && loc.region !== loc.name
        ? loc.name + ", " + loc.region
        : loc.name;
      return option;
    });
    select.replaceChildren(placeholder, ...items);
  }
  if (datalist) {
    datalist.replaceChildren(...locations.map((loc) => {
      const option = document.createElement("option");
      option.value = loc.name;
      return option;
    }));
  }
}

async function loadMajorLocations() {
  renderLocationOptions(FALLBACK_INDIA_LOCATIONS);
  try {
    const payload = await getJson("/api/locations", { signal: AbortSignal.timeout(5000) });
    if (Array.isArray(payload?.locations) && payload.locations.length > 0) {
      renderLocationOptions(payload.locations);
    }
  } catch {
    // Keep fallback list when server is offline.
  }
}

async function selectManualCity(city) {
  const clean = String(city || "").trim();
  if (clean.length < 2) return;
  byId("cityInput").value = clean;
  const manualInput = byId("manualCityInput");
  if (manualInput) manualInput.value = clean;
  setStatus("Loading the forecast for " + clean + "…", "loading");
  const result = await refreshAir(clean);
  if (result) {
    setStatus("Live forecast loaded for " + (result.city?.name || clean) + ". Ready to build your plan.", "ready");
  }
}

async function initialize() {
  renderEmptyAir();
  initializeNavigation();
  byId("profileForm").addEventListener("submit", submitPlan);
  byId("refineForm").addEventListener("submit", submitRefinement);
  byId("useLocation").addEventListener("click", () => {
    if (!state.loading) refreshAirFromLocation({ auto: false });
  });
  byId("manualLocationBtn")?.addEventListener("click", () => toggleManualLocationPanel());
  byId("majorCitySelect")?.addEventListener("change", (event) => {
    const city = event.target.value;
    if (city && !state.loading) selectManualCity(city);
  });
  byId("manualCityForm")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const city = byId("manualCityInput").value.trim();
    if (city.length < 2) {
      toast("Select a city from the list or enter at least 2 characters.");
      byId("manualCityInput").focus();
      return;
    }
    if (!state.loading) selectManualCity(city);
  });
  byId("refreshAir").addEventListener("click", () => {
    if (state.loading) return;
    const city = byId("cityInput").value.trim();
    if (city.length >= 2) refreshAir(city);
    else toggleManualLocationPanel(true);
  });
  byId("copyPledge").addEventListener("click", copyInvite);
  byId("methodButton").addEventListener("click", toggleMethod);
  byId("profileForm").addEventListener("change", () => updateProfileSummary(currentProfile()));
  byId("aiConsent").addEventListener("change", () => {
    if (byId("aiConsent").checked && !state.geminiConfigured) {
      setStatus("Gemini key is not set on this server yet. The local planning guide remains available.", "ready");
    }
  });
  updateProfileSummary(currentProfile());

  let serverAvailable = false;
  try {
    const health = await getJson("/api/health");
    serverAvailable = true;
    state.geminiConfigured = health.geminiConfigured === true;
    if (state.geminiConfigured) {
      byId("aiConsent").nextElementSibling.nextElementSibling.textContent = "Send my setup and questions to Gemini for tailored help";
    } else {
      byId("aiConsent").nextElementSibling.nextElementSibling.textContent = "Send my setup and questions to Gemini (server key not set)";
    }
  } catch {
    renderLocationOptions(FALLBACK_INDIA_LOCATIONS);
    setStatus("Local page preview. Start the Node server for live air data and Gemini.", "ready");
  }
  if (serverAvailable) {
    await loadMajorLocations();
    await refreshAirFromLocation({ auto: true });
  }
}

initialize();
