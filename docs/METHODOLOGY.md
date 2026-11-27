# Data and impact methodology

## Outdoor air

- Provider: [Open-Meteo Air Quality API](https://open-meteo.com/en/docs/air-quality-api), using its PM₂.₅ current value and hourly forecast.
- The response uses CAMS forecast fields and an automatically resolved city time zone. The provider documents the product as a forecast on a regional model grid; it is not an on-street measurement.
- The server requests Unix timestamps, then stores ISO UTC instants. The UI formats forecast hours in the selected location's time zone. This avoids interpreting a city's local timestamps in the server's or viewer's time zone.
- Forecast values are in µg/m³. The app does not translate them into a national or local AQI. Display labels such as “elevated” are descriptive UI bands only.
- On startup, no demo curve is displayed; live forecast values load once location permission is granted or a city is requested.

## Flexible outdoor-time comparison

1. Find the next forecast hour matching the selected usual walk start time.
2. On that same local date, consider future daytime forecast points from 10:00 through 17:00.
3. Find the lowest mean across three hourly values spanning a two-hour window; gaps over one hour are not treated as adjacent.
4. Compare that mean with the modeled concentration at the usual hour. `lowerPercent = round(max(0, baseline - windowMean) / baseline × 100)`.
5. Show the difference only as a modeled PM₂.₅ / 20-minute activity proxy. Equal activity duration makes the duration factor cancel in the percentage. It is not a personal inhaled dose or a health benefit estimate.

If the selected hour has already passed, its next forecast occurrence is used, so a proposed window and its baseline remain on the same local date. If the forecast has no usable daytime window, the app avoids claiming a lower period.

## Commute CO₂ comparison

Factors are from the Government of India / MoHUA mode-wise emissions table reproduced in an [Indian Railways project appraisal workbook](https://rb.indianrailways.gov.in/uploads/directorate/works/pdf/2023/13_12_2023-%20Proforma%20for%20submission%20of%20Detailed%20Project%20Report.pdf): car 139.52 g CO₂/km, two-wheeler 25.52 g CO₂/km, bus 787.72 g CO₂/km. The cited table is vehicle-level.

For a directional one-way comparison, the app divides each vehicle factor by a declared occupancy assumption (car 1.5, two-wheeler 1.2, bus 25), then multiplies the difference by the user's one-way distance. `estimated saved kg CO₂ = (private g/passenger-km − bus g/passenger-km) × km / 1000`. Positive means modeled savings; negative means modeled emissions increase. A negative result is retained and shown plainly.

These occupancy assumptions are prototype defaults, not local observed averages or a personal carbon audit. The comparison is shown only for Indian locations because the factors are India-specific. It does not include access legs, vehicle age, traffic, fuel, or occupancy variation.

## Indoor air guidance

The guide prioritizes source control, then ventilation when outdoor air permits, then filtration. This follows the U.S. EPA's overview of [source control, ventilation, and filtration](https://www.epa.gov/air-quality/indoor-air-quality) and its guidance to [avoid outdoor-air ventilation when outdoor pollution is high](https://www.epa.gov/indoor-air-quality-iaq/biological-contaminants-and-indoor-air-quality). Guidance remains general and does not claim a measured indoor benefit.
