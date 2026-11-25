# HawaShift

**A practical air plan for today, built around a real household schedule.** HawaShift helps families decide when flexible outdoor time can move, how to reduce indoor pollution sources, and when a lower-emission commute is a reasonable option. It explains the estimate behind each recommendation and keeps fixed commitments in place.

## Run locally

Requirements: Node.js 20.11 or newer. There are no third-party runtime packages.

```powershell
Copy-Item .env.example .env
# Optional: add a Google Gemini API key to .env to enable consent-based AI wording and follow-up answers.
npm run dev
```

Open [http://localhost:4173](http://localhost:4173). Without a Gemini key, the complete local planning guide still works. The first screen uses clearly labeled illustrative sample data; press **Refresh local forecast** to load the selected city’s regional PM₂.₅ forecast.

For a production start, use `npm start`. The Gemini key must stay on the server and must never be placed in client code. See [`.env.example`](.env.example).

## What is built

- A responsive, keyboard-friendly dashboard with a local-time PM₂.₅ forecast and a household day planner.
- Schedule-aware recommendations that preserve a fixed school run and adapt to budget, commute, and selected extra-care needs.
- Indoor steps ordered from free source control to equipment guidance; ventilation advice accounts for outdoor pollution.
- A transparent modeled outdoor-time comparison and an India-only commute CO₂ estimate that can show savings or an increase.
- Optional Gemini personalization with explicit consent, deterministic calculations, validated model output, and a local fallback.
- A copyable neighbor invite without accounts, location tracking, or invented community totals.

## How the app is organized

```text
client/
  index.html       Accessible page structure
  styles.css       Responsive visual system
  app.js           Browser state and API interactions
server/
  index.mjs        HTTP server, security headers, validation, rate limits
  air-quality.mjs  Geocoding, Open-Meteo forecast, short-lived cache
  impact.mjs       Time-window and transport impact calculations
  plan.mjs         Local planning rules and optional Gemini calls
docs/
  ARCHITECTURE.md  Request flow, privacy, and security boundaries
  METHODOLOGY.md   Data, time-zone handling, and estimate assumptions
  JUDGING.md       Challenge criteria map and reviewer walkthrough
```

More detail: [architecture](docs/ARCHITECTURE.md) · [methodology and sources](docs/METHODOLOGY.md) · [prompt design](docs/PROMPT_DESIGN.md) · [judging walkthrough](docs/JUDGING.md).

## Source and limitations

Live air values come from the Open-Meteo Air Quality API and CAMS model forecast. The values represent a regional model grid, not a street-level monitor, and may miss neighborhood spikes. HawaShift displays PM₂.₅ in µg/m³; its descriptive bands are interface labels, not an official AQI or health thresholds.

The outdoor-time number compares forecast concentration at the next occurrence of the chosen walk hour with the lowest forecast mean over a two-hour daytime window on the same local date. It is a 20-minute activity proxy, not an inhaled dose or health outcome. Commute factors are published for India and shown only for Indian locations; default occupancies are explicit assumptions, not observed local averages.

The app is a planning aid, not medical advice. Follow local public-health guidance and personal care plans. See [METHODOLOGY.md](docs/METHODOLOGY.md) for sources and calculation details.
