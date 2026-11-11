# Zephyr — architecture and GCP deployment

This document describes the Zephyr product, the code layout, the Terraform module, and the Google Cloud resources that `terraform apply` creates. It is complete without the repository README.

The module in this document is the tree under `infra/terraform`. Current values in `terraform.tfvars` target project `zephyr-512319` in region `asia-south1`. Resource names use the prefix `zephyr` unless this document gives a full name.

**Status of the cloud path:** the module matches the Compose layout: Cloud SQL for Postgres, a GCS bucket for photos, Cloud Run, Scheduler, and Pub/Sub. Do not run `terraform apply` until Artifact Registry images are pushed and any third-party API-key secret you mount has a version. The database password secret is created by the module. `FIREBASE_SERVICE_ACCOUNT_KEY` is not required on Cloud Run.

**Live product scope:** the twelve monitored cities. Worldwide model tiles and wind may still render; OpenAQ station ingest is not required to finish a planetary catalog.

---

## 1. What the product is

Zephyr is a community air-quality and environmental-health dashboard. Residents see city AQI, ward burden, a map, and neighbourhood (H3) detail. They submit photo reports of visible hazards. Operators dispatch and resolve incidents, switch demo and live ingest, and inspect a dead-letter queue.

The product covers twelve cities:

| Group                   | Cities                                                    |
| ----------------------- | --------------------------------------------------------- |
| India (India NAAQS AQI) | New Delhi, Mumbai, Kolkata, Chennai, Bengaluru, Hyderabad |
| Other capitals (US AQI) | Beijing, Moscow, Pretoria, Abu Dhabi, Jakarta, Brasília   |

India cities merge OpenAQ, WAQI, and CPCB when keys exist. BRICS cities use OpenAQ plus WAQI.

Two data modes exist:

- **Demo** — the worker reads week-long station series and ward GeoJSON from `fixtures/`.
- **Live** — the worker calls OpenAQ, WAQI, and CPCB (and optional satellite and fire sources).

The HTTP contract is path-versioned under `/api/v1`. A breaking change adds `/api/v2` on the same API process.

---

## 2. What the application already does

This section is the implemented product, not a roadmap.

### Resident UI (`apps/web`)

The UI is a Vite + React single-page app. MapLibre draws maps from OpenFreeMap. The UI stores language in `localStorage` (`zephyr.lang`). Supported languages: English, Hindi, Marathi, Bengali, Tamil, Kannada, Telugu, Chinese, Russian, Arabic, Indonesian, Portuguese.

| Route        | Behavior                                                                                                          |
| ------------ | ----------------------------------------------------------------------------------------------------------------- |
| `/`          | City AQI band, people in Poor+ air, uncovered population, equity ratio, monitored wards, last ingest time         |
| `/map`       | Live and offline stations, fires, incidents, uncovered wards, optional 3D buildings                               |
| `/report`    | Pin on the map, hazard type, note, required photo, optional voice. Submit creates a report and opens `/track/:id` |
| `/track/:id` | Report status, classification, linked incident. Closure answers FIXED or STILL when a token exists                |
| `/zones/:h3` | Nearest station, zone brief, group advisory, 24 h forecast, upwind sources, subscribe, read-aloud                 |
| `/diary`     | Home pin and hours in each AQI band for seven days. Sign-in is required                                           |

Auth roles are `resident` and `operator`. Permissions are derived from role (`me.*`, `incidents.*`, `copilot`, `dlq.*`, `system.*`, `api_keys.create`). Operator status is only the stored account flag `users.role = operator`.

Local sign-in when `ZEPHYR_DEV_AUTH=1` uses `demo:<email>` or `operator:<email>`. Neither prefix grants operator. With Firebase client config, the web app signs in with email/password or Google and sends the Firebase ID token. The API verifies Firebase ID tokens against the project audience (Auth emulator lookup when `FIREBASE_AUTH_EMULATOR_HOST` is set). Role is the stored account flag. `GET /auth/whoami` returns `{ email, role, operator, permissions }`.

### Operator UI

Visible only after `/auth/whoami` confirms `role === "operator"`.

| Route       | Behavior                                                                                          |
| ----------- | ------------------------------------------------------------------------------------------------- |
| `/operator` | Open, dispatched, and disputed incidents. Dispatch, resolve, false-positive. Copilot question box |
| `/pipeline` | Demo/live switch, force a tick, create a public API key, list and replay dead-letter items        |

### HTTP API (`apps/api`, prefix `/api/v1`)

Public reads:

- `GET /health` — mode, integration flags, last ingest error, station counts, forecast-training status
- `GET /cities`, `GET /cities/:cityId/summary`, `/stations`, `/wards`, `/fires`
- `GET /zones/:h3`, `/forecast`, `/brief`, `/health`
- `POST /reports`, `/reports/:id/photo`, `/reports/:id/voice`, `/reports/:id/commit`, `GET /reports/:id`
- `POST /reports/:id/closure`
- `POST /whatsapp/inbound` — Twilio signature check when `TWILIO_AUTH_TOKEN` is set

Signed-in resident:

- `GET /auth/whoami`, `GET /me`, `/me/diary`, `PUT /me/diary`
- `GET/POST /me/subscriptions`, `DELETE /me/subscriptions/:h3`

Operator:

- `GET /operator/incidents`, `POST /operator/incidents/:id/{dispatch,resolve,false-positive}`
- `POST /operator/copilot`
- `GET /operator/dlq`, `POST /operator/dlq/:id/replay`
- `POST /system/data-mode`, `POST /system/tick`
- `POST /api-keys`

Rate limits exist on report create (10 per IP per hour) and on public API keys (60 per minute).

### Worker (`apps/worker`)

| Path                            | Role                                                                                                       |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `POST /internal/tick`           | Enqueues catalog, wind, and ops ingest jobs and returns                                                    |
| `POST /internal/jobs/run`       | Claims one ingest job (cursor + lease), runs a page, dead-letters after five failures                      |
| `POST /internal/catalog`        | Enqueues the twelve-city catalog shards                                                                    |
| `POST /internal/wind`           | Writes a 10 m U/V grid into object storage (or the data dir). Uses the sample grid when the live fetch fails |
| `POST /internal/pubsub/reports` | Decode a Pub/Sub push and classify the report                                                              |
| `POST /internal/pubsub/dlq`     | Record a dead-lettered payload for the operator pipeline                                                   |
| `POST /internal/tasks/notify`   | Log a Cloud Tasks delivery                                                                                 |

On boot the worker drains one full job set so demo fixtures load before the first Scheduler job. Model tiles from the API set `Cache-Control: public, max-age=3600`. The air-quality key stays on the server; the web bundle never sees it.

### Domain rules (`packages/domain`, unit-tested)

- India NAAQS and US AQI from pollutant concentrations
- Station merge, 24 h online window, 250 m dedupe
- H3 resolution 8 for reports and zones
- Ward join: a ward is uncovered if no live station is within 15 km

Promotion table. Flagged photos do not count. A null sensor or satellite is absent evidence, not a zero vote.

| Evidence                                                     | Result              |
| ------------------------------------------------------------ | ------------------- |
| 3 distinct counting reports                                  | `citizens`          |
| 1+ report and sensor over limit                              | `citizen_sensor`    |
| 1+ report and satellite anomaly                              | `citizen_satellite` |
| Sensor over limit and satellite anomaly                      | `sensor_satellite`  |
| Immediate unhealthy AQI, or two consecutive over-limit ticks | `sensor_only`       |

- Closure: FIXED closes the window. STILL reopens the incident as disputed. A bad token is rejected
- Persistence forecast (needs 12 hourly points). ARIMA_PLUS is a later hook and needs 168 hourly points
- Alert debounce of 6 hours on an upward band cross
- Upwind ranking of OSM industrial / landfill / terminal points
- Twilio request-signature check

### Server package (`packages/server`)

Postgres holds app state in per-collection tables (row revisions, scoped reads). Object storage holds photos, the wind grid, and model tiles: MinIO in dev, GCS (`ZEPHYR_BUCKET`) in production. There is no file store and no Firestore. Cloud Run uses Cloud SQL and the data bucket. Live ingest talks to OpenAQ, WAQI, CPCB, Open-Meteo wind, OpenStreetMap Overpass, Earth Engine, and Google Air Quality when keys exist. Gemini classifies photos, drafts work orders, writes zone briefs, and runs the operator copilot. If Gemini is missing or the call fails, a heuristic or offline answer is used. The code now calls `gemini-3.8-flash`.

---

## 3. Repository layout

```
apps/api          Express public API
apps/worker       Express internal worker
apps/web          React UI
packages/domain   Pure rules (no I/O)
packages/server   Store, tick, live feeds, Gemini
fixtures/         Demo station weeks and ward GeoJSON
infra/terraform   Google Cloud module
```

Local process graph:

```
browser  -->  Vite :5173  -- /api proxy -->  API :8080
                                               |
                                               +--> worker :8081  (HTTP and optional Pub/Sub)
worker boot and each tick  ------------------>  worker :8081
store = files under ZEPHYR_DATA_DIR (default .data)
```

The API and the worker share one store directory in local and Docker setups. That is how a report created on the API becomes visible to the worker without Pub/Sub.

Docker Compose builds the same three images, shares a data volume, and can start a Pub/Sub emulator on port 8085. The file queue still works if the emulator is off.

---

## 4. How Terraform is structured

| File               | Role                                                                                          |
| ------------------ | --------------------------------------------------------------------------------------------- |
| `versions.tf`      | Terraform `>= 1.5`, Google and Google Beta `~> 6.0`, random provider                         |
| `variables.tf`     | Inputs, including `db_tier` and optional `lb_domain`                                          |
| `terraform.tfvars` | Current values for `zephyr-512319`                                                            |
| `main.tf`          | APIs, Cloud SQL, buckets, Artifact Registry, BigQuery, Pub/Sub, Cloud Run, IAM, Scheduler     |
| `lb.tf`            | Global HTTP load balancer, optional HTTPS certificate, CDN, SPA 404 rewrite, uptime check     |
| `outputs.tf`       | Load balancer address, service URLs, buckets, topic, dataset, SQL connection, image registry  |

There is no remote state backend. Do not run `terraform apply` on the empty project until the images exist in Artifact Registry and you have added versions for any third-party key you intend to mount. The module creates a `DATABASE_URL` version. It does not mount the empty API-key shells.

### Chosen mapping

| Local | Google Cloud |
| --- | --- |
| Docker Postgres | Cloud SQL for Postgres 16. Cloud Run reaches it through the Cloud SQL socket. `ZEPHYR_STORE=postgres`. |
| Object storage for report photos | GCS data bucket (`ZEPHYR_BUCKET`). The web bucket is separate and sits behind Cloud CDN. |
| Firebase Auth emulator | Identity Platform email/password on this project. Cloud Run does not receive a service-account JSON key. |
| API and worker | Cloud Run. The API is public. The worker is internal. |
| Compose tick | Cloud Scheduler `zephyr-tick` every 30 minutes, `POST /internal/tick` (enqueue only). |
| Job drain | Cloud Scheduler `zephyr-jobs-run` every 2 minutes, `POST /internal/jobs/run`. |
| Catalog | Cloud Scheduler `zephyr-catalog` hourly, `POST /internal/catalog` (enqueue city shards). |
| Wind | Cloud Scheduler `zephyr-wind` every 6 hours, `POST /internal/wind`. The worker stores a 10 m U/V grid. The map reads it. |
| Ingest dead letters | Pub/Sub DLQ topic, push to `/internal/pubsub/dlq`, operator replay on `/pipeline`. |
| API keys | Secret Manager shells. They are not mounted until a version exists. The database URL is the exception. |

Firestore is not created. Do not run Cloud SQL and a Firestore database together.

### Inputs

| Variable | Default | Meaning |
| --- | --- | --- |
| `project_id` | required | Target project |
| `region` | `asia-south1` | Cloud SQL, Cloud Run, buckets, BigQuery |
| `name_prefix` | `zephyr` | Name stem |
| operator accounts | none | `users.role = operator` in Postgres |
| `api_image` / `worker_image` | hello image | Replace with Artifact Registry tags before a real apply |
| `db_tier` | `db-f1-micro` | Cloud SQL tier |
| `lb_domain` | empty | When set, Terraform adds a managed certificate and an HTTPS forwarding rule |
| `enable_optional_vm` | `false` | Optional e2-micro that curls the tick |

---

## 5. What `terraform apply` creates

### Runtime

Cloud SQL instance `zephyr-pg`, database `zephyr`, user `zephyr`. The password is random and stored only in the `DATABASE_URL` secret. Public IP is on so the Cloud SQL connector can attach, with encrypted connections and no authorized networks.

API and worker Cloud Run services mount that socket, set `ZEPHYR_STORE=postgres`, read `DATABASE_URL` from Secret Manager, and set `ZEPHYR_BUCKET` to the data bucket. `ZEPHYR_DEV_AUTH` is `0`. Neither service has `FIREBASE_SERVICE_ACCOUNT_KEY`. On Cloud Run, Google API calls use the attached service account. The metadata server issues the token. Worker ingress stays internal. Scheduler, Pub/Sub push, and the API service account can invoke it. The API sends a Cloud Run identity token when `K_SERVICE` is set.

Artifact Registry repository `zephyr` in the same region. The Cloud Run service agent can read it.

Identity Platform email/password sign-in is enabled.

### Edge

HTTP load balancer on the reserved address. `/api/*` goes to the API. Other paths go to the web bucket with Cloud CDN. A 404 from that bucket is rewritten to `/index.html` so client routes such as `/map` load the app. HTTPS is created only when `lb_domain` is set.

### Secrets

Mounted: `DATABASE_URL`.

Empty shells, not mounted: `OPENAQ_API_KEY`, `WAQI_API_TOKEN`, `CPCB_API_KEY`, `GEMINI_API_KEY`, `GOOGLE_AIR_QUALITY_API_KEY`, `GOOGLE_PLACES_API_KEY`, `GOOGLE_SPEECH_API_KEY`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_WHATSAPP_FROM`, `WHATSAPP_CLOSURE_SECRET`.

### IAM

API and worker: `roles/cloudsql.client`, object admin on the data bucket, Secret Manager accessor, Pub/Sub publisher on the report topic. Worker also has BigQuery data editor and job user. The Pub/Sub service agent can publish to the dead-letter topic and subscribe to the report push subscription.

---

## 6. Apply blockers

1. Push `api` and `worker` images to the Artifact Registry repository this module creates before Cloud Run can serve Zephyr.
2. Add a secret version, then an env reference, for each third-party key you want live. An empty shell cannot be mounted.
3. Set `lb_domain` and point DNS at `lb_ip` before expecting HTTPS.
4. Do not apply this module and a second stack that also creates Firestore `(default)`.

```bash
docker build -f apps/api/Dockerfile -t asia-south1-docker.pkg.dev/zephyr-512319/zephyr/api:latest .
docker build -f apps/worker/Dockerfile -t asia-south1-docker.pkg.dev/zephyr-512319/zephyr/worker:latest .
docker push asia-south1-docker.pkg.dev/zephyr-512319/zephyr/api:latest
docker push asia-south1-docker.pkg.dev/zephyr-512319/zephyr/worker:latest

cd infra/terraform
terraform init
terraform plan
```

`terraform apply` stays a manual step after that plan is the one you want.

Local development:

```bash
bun install
cp .env.example .env
bun run dev
```

Open `http://localhost:5173` (not `127.0.0.1` — Firebase Google sign-in requires an authorized domain). Worker `:8081`, API `:8080`.
