# Architecture and trust boundaries

## Request flow

1. The browser starts with an illustrative Delhi curve. It is labeled as sample data and is not presented as current.
2. A forecast refresh calls `GET /api/air?city=…`. The server geocodes the place, fetches the Open-Meteo air forecast, normalizes times to UTC timestamps, and returns the provider's city time zone.
3. Submitting the household form sends the profile and forecast to `POST /api/plan`. Deterministic server code calculates the window and impact figures and generates a complete local plan.
4. Only when the user checks the Gemini consent box does the request ask Gemini to personalize summary/headline wording. Action details and calculations remain local and deterministic.
5. Follow-up questions go to `POST /api/refine`. The server returns a local explanation unless consent is present and the Gemini key is configured.

## Privacy

- There is no account, database, analytics, cookie, or browser storage in this prototype.
- Household settings remain in browser memory and are sent to this server only when the user builds or refines a plan.
- The consent disclosure lists the city, forecast, schedule, budget, selected extra-care needs, and follow-up question sent to Gemini.
- The Gemini key is read only by the server from `.env`; `.env` is excluded from Git.
- The Gemini path is off by default. If the key is absent or the model call fails, the local plan remains available.

## Security controls

- Built on Node's HTTP server with no third-party runtime packages.
- Content Security Policy and browser security headers; client scripts/styles are same-origin and generated strings are placed with `textContent`.
- JSON request size capped at 18 KB; profiles, forecast points, time zone, plan shape, and user-provided question are bounded and validated server-side.
- A per-IP in-memory request limit applies to air and planning endpoints. Air results are cached for ten minutes to reduce repeated upstream calls.
- Gemini output is limited to a strict JSON schema; plan headlines are checked and deterministic action details are retained.
- No geolocation permission is requested. The user enters a city or nearby area.

## Deliberate boundaries

This prototype has no shared deployment, persistent profile, device sensor reading, location-level monitoring station integration, or health triage. IP-based rate limiting is process-local and is suitable for a single-instance demo, not a horizontally scaled service. Production hosting should add HTTPS, centralized limits, operational logging that excludes household payloads, and a reviewed privacy notice.
