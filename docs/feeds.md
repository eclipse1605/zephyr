# Live feeds

The twelve monitored cities are the ingest list and the live-product scope. Demo mode reads `fixtures/` and does not call these feeds. Catalog job shards may exist for later worldwide work; on a free OpenAQ key they are best-effort only and are not required for a finished twelve-city live loop.

| Feed | Limit | What we store | Attribution |
| --- | --- | --- | --- |
| OpenAQ v3 | 60 requests per minute and 2,000 per hour on one key. A 429 can lead to a ban. | Station rows and hourly points. | OpenAQ and the origin agency. |
| CPCB / data.gov.in | The resource key's own quota. | India station rows. | Pollution board. |
| WAQI | Their terms forbid selling the data and forbid redistributing it as a cache or archive. | Nothing. Live mode may attach the current bounds response to the map response and then drop it. | World Air Quality Index and the originating network, on that live pin only. |
| Google Air Quality | Current and hourly values may be kept for one hour, then deleted. | Not stored. `fetchModelledPm25` is a point lookup. | Only next to a value that came from Google. |
| Open-Meteo wind | Hosted API is non-commercial. Refreshed about every 6 hours. | A 10 m U/V grid in `wind/latest.json`, or the checked-in sample when that file is absent. | Open-Meteo, on the particle layer. |
| Open-Meteo / CAMS raster | No key. Zoom stops at 8. | Tile PNG and point readings for one hour. | Open-Meteo and CAMS, on the model layer only. |
| OpenStreetMap Overpass | Do not call it on every tick. | Places already saved are reused. | OpenStreetMap. |

`OPENAQ_API_KEYS` is not a way to multiply the 60-per-minute budget. The tick uses one key. `OPENAQ_LOCATION_LIMIT` defaults to 4 locations per city. A shared counter stops the feed at 60 requests in a rolling minute. A 429 is stored on that city's feed error, including `Retry-After` when the server sends it. `GET /api/v1/health` includes `openAq.used`, `openAq.limit`, and `openAq.last429`.
