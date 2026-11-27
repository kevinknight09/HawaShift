# HawaShift

**A practical air plan for today, built around a real household schedule.** HawaShift helps families decide when flexible outdoor time can move, how to reduce indoor pollution sources, and when a lower-emission commute is a reasonable option. It explains the estimate behind each recommendation and keeps fixed commitments in place.

## Run locally

Requirements: Node.js 20.11 or newer.

```powershell
npm install
Copy-Item .env.example .env
# Optional: add a Google Gemini API key to .env to enable consent-based AI wording and follow-up answers.
npm run dev
```

Open [http://localhost:4173](http://localhost:4173). Without a Gemini key, the complete local planning guide still works. On load, the app checks for your location (or lets you click **Enter my location manually** to pick from major Indian cities or type any city) to fetch your regional PM₂.₅ forecast—no demo forecast is shown.

For a production start, use `npm start`. The Gemini key must stay on the server and must never be placed in client code. See [`.env.example`](.env.example).

## Verify and test

```powershell
npm run check
npm test
```

- `npm run check` runs Node syntax validation across all server, client, and Vercel handler files.
- `npm test` runs the `node --test` suite (`21` unit, API, and Vercel serverless handler tests).

## Deploy on Vercel

[`vercel.json`](vercel.json) serves `client/` as static output and routes `/api/*` to [`api/[...route].mjs`](api/[...route].mjs) via `hono/vercel`.

1. Push your branch to GitHub and import the repository in Vercel.
2. Keep the default project settings picked up from `vercel.json` (`outputDirectory: client`, `buildCommand: npm run check`).
3. Add `GEMINI_API_KEY` (and optionally `GEMINI_MODEL`) in Vercel **Project Settings → Environment Variables**, then deploy.

## What is built

- A responsive, keyboard-friendly dashboard with a local-time PM₂.₅ forecast and a household day planner.
- Schedule-aware recommendations that preserve fixed daily commitments (school run, work/shift, errands, or none) and adapt to household size, budget, commute, and selected extra-care needs.
- Indoor steps ordered from free source control to equipment guidance; ventilation advice accounts for outdoor pollution.
- A transparent modeled outdoor-time comparison and an India-only commute CO₂ estimate that can show savings or an increase.
- Optional Gemini personalization with explicit consent, deterministic calculations, validated model output, and a local fallback.
- A copyable neighbor invite without accounts, location tracking, or invented community totals.

## How the app is organized

```text
api/
  [...route].mjs   Vercel serverless entrypoint wrapping Hono via hono/vercel
client/
  index.html       Accessible page structure
  styles.css       Responsive visual system
  app.js           Browser state and API interactions
server/
  index.mjs        Hono HTTP server, security headers, body limits, rate limits
  air-quality.mjs  Major India presets, geocoding, Open-Meteo forecast, cache
  impact.mjs       Time-window and transport impact calculations
  plan.mjs         Local planning rules and optional Gemini calls
test/
  *.test.mjs       Automated unit, Hono app, and Vercel handler tests
docs/
  ARCHITECTURE.md  Request flow, privacy, and security boundaries
  METHODOLOGY.md   Data, time-zone handling, and estimate assumptions
  JUDGING.md       Challenge criteria map and reviewer walkthrough
vercel.json        Vercel static output and security headers config
```

More detail: [architecture](docs/ARCHITECTURE.md) · [methodology and sources](docs/METHODOLOGY.md) · [prompt design](docs/PROMPT_DESIGN.md) · [judging walkthrough](docs/JUDGING.md).

## Source and limitations

Live air values come from the Open-Meteo Air Quality API and CAMS model forecast. The values represent a regional model grid, not a street-level monitor, and may miss neighborhood spikes. HawaShift displays PM₂.₅ in µg/m³; its descriptive bands are interface labels, not an official AQI or health thresholds.

The outdoor-time number compares forecast concentration at the next occurrence of the chosen walk hour with the lowest forecast mean over a two-hour daytime window on the same local date. It is a 20-minute activity proxy, not an inhaled dose or health outcome. Commute factors are published for India and shown only for Indian locations; default occupancies are explicit assumptions, not observed local averages.

The app is a planning aid, not medical advice. Follow local public-health guidance and personal care plans. See [METHODOLOGY.md](docs/METHODOLOGY.md) for sources and calculation details.
