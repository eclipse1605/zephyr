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

`OPENAQ_API_KEY` plus optional comma-separated `OPENAQ_API_KEYS` form a pool. Each key gets its own 60 requests per rolling minute; requests round-robin ready keys, wait for rolling quota when the pool is empty (up to ~90s per call), retry other keys on 429, and cool only the hot key (`Retry-After` when present). Location limit and fetch concurrency scale with the key count (override with `OPENAQ_LOCATION_LIMIT`, `OPENAQ_CONCURRENCY`). A failed empty OpenAQ city fetch does not wipe prior station counts. Local `/internal/tick` enqueues and drains; on Cloud Run it only enqueues and Scheduler hits `/internal/jobs/run` (`INGEST_DRAIN_BATCH`, default 16). `GET /api/v1/health` includes `openAq.used`, `openAq.limit` (60 × key count), `openAq.keys`, `openAq.cooling`, and `openAq.last429`.
