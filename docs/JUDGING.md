# Challenge 6 reviewer walkthrough

## Problem statement alignment

HawaShift combines a location-specific outdoor PM₂.₅ forecast, household schedule, budget, commute mode, and selected extra-care constraints into a usable day plan. It includes low-emission routine suggestions, indoor source-control and ventilation steps, sustainable alternatives, and a plain-language impact explanation.

## Walkthrough

1. Open the page and observe that the first chart is explicitly illustrative, not live.
2. Enter a city and select **Refresh local forecast**. Check the city label, retrieval time, selected time zone, source, and regional-grid limitation.
3. Change the fixed school-run toggle, walk start, budget, commute mode, and household considerations. Build the plan and check that fixed commitments persist and the action copy changes with the profile.
4. Open **Show how we calculate it**. Check the forecast comparison, activity-proxy limits, Government of India factor citation, occupancy assumptions, and savings/increase direction.
5. Try a city outside India. The air plan remains available while the app explains that it does not have locally applicable commute factors.
6. Ask a follow-up with Gemini consent off. The local response should explain the consent boundary. If a server key is configured, opt in and verify the tailored path; remove the key or simulate provider failure to see the local fallback.
7. Use keyboard navigation, the skip link, mobile menu, form labels, and live status messages at desktop and narrow screen widths.

## Criteria map

| Judging parameter | Evidence in this project |
| --- | --- |
| Code Quality | Small dependency-free server modules, named impact calculations, input bounds, and architecture/methodology documentation. |
| Security | Server-only Gemini key, explicit opt-in, CSP/security headers, strict JSON bounds, safe DOM text insertion, bounded in-memory rate limiting, no persistence. |
| Efficiency | No client framework or runtime dependencies, one forecast cache per city for ten minutes, bounded forecast payloads, local deterministic fallback. |
| Testing | `npm run check` provides Node syntax checks. The walkthrough above is the manual acceptance path for data, consent, location, fallback, and responsive keyboard use. |
| Accessibility | Semantic sections and headings, skip link, labels, keyboard focus styles, live feedback, chart text alternatives, reduced-motion support, and responsive layout. |
| Problem Statement Alignment | Location-aware forecast, routines, indoor actions, alternatives, household adaptation, community invite, and transparent impact estimates. |

The walkthrough is a reviewer guide, not a claim that every scenario has been run. Automated behavioral test coverage is a follow-on improvement.
