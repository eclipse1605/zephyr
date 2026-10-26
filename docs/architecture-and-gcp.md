# Zephyr — architecture and GCP deployment

This document describes the Zephyr product, the code layout, the Terraform module, and the Google Cloud resources that `terraform apply` creates. It is complete without the repository README.

The module in this document is the tree under `infra/terraform`. Current values in `terraform.tfvars` target project `zephyr-512319` in region `asia-south1`. Resource names use the prefix `zephyr` unless this document gives a full name.

**Status of the cloud path:** Terraform can create the Google Cloud objects listed below. The application does not yet use all of them at runtime. The last section lists the gaps. A first apply on an empty project will still fail unless you fix those gaps first.

---

## 1. What the product is

Zephyr is a community air-quality and environmental-health dashboard. Residents see city AQI, ward burden, a map, and neighbourhood (H3) detail. They submit photo reports of visible hazards. Operators dispatch and resolve incidents, switch demo and live ingest, and inspect a dead-letter queue.

The product covers twelve cities:

| Group                   | Cities                                                    |
| ----------------------- | --------------------------------------------------------- |
| India (India NAAQS AQI) | New Delhi, Mumbai, Kolkata, Chennai, Bengaluru, Hyderabad |
| Other capitals (US AQI) | Beijing, Moscow, Pretoria, Abu Dhabi, Jakarta, Brasília   |

India cities merge OpenAQ, WAQI, and CPCB when keys exist. The other cities use WAQI only.

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

Local sign-in is a Bearer token. Resident tokens use `demo:<email>`. Operator tokens use `operator:<email>`. The API accepts those tokens only when `ZEPHYR_DEV_AUTH=1`. Without that flag, the API checks a Google ID token at `oauth2.googleapis.com/tokeninfo`. An operator email must appear in `OPERATOR_EMAILS`.

### Operator UI

Visible only after the API marks the session as operator.

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
| `POST /internal/tick`           | Ingest stations, fuse evidence, promote incidents, send pending notifications, sync optional BigQuery rows |
| `POST /internal/pubsub/reports` | Decode a Pub/Sub push and classify the report                                                              |
| `POST /internal/pubsub/dlq`     | Record a dead-lettered payload                                                                             |
| `POST /internal/tasks/notify`   | Log a Cloud Tasks delivery                                                                                 |

On boot the worker runs one tick so demo fixtures load before the first Scheduler job.

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

File store (default) or Firestore + GCS when `ZEPHYR_STORE=gcp`. Report photos go to the file store or to `gs://<bucket>/photos/<id>`. Live ingest talks to OpenAQ, WAQI, CPCB, Open-Meteo wind, OpenStreetMap Overpass, Earth Engine, and Google Air Quality when keys exist. Gemini classifies photos, drafts work orders, writes zone briefs, and runs the operator copilot. If Gemini is missing or the call fails, a heuristic or offline answer is used. The code now calls `gemini-3.8-flash`.

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

| File               | Role                                                                                                                  |
| ------------------ | --------------------------------------------------------------------------------------------------------------------- |
| `versions.tf`      | Terraform `>= 1.5`, provider `hashicorp/google ~> 6.0`, project and region on the provider                            |
| `variables.tf`     | Inputs                                                                                                                |
| `terraform.tfvars` | Current values for `zephyr-512319`                                                                                    |
| `main.tf`          | APIs, buckets, Firestore, BigQuery, Pub/Sub, service accounts, Cloud Run, IAM, Scheduler, Tasks, secrets, optional VM |
| `lb.tf`            | Global HTTP load balancer, CDN backend bucket, uptime check                                                           |
| `outputs.tf`       | `lb_ip`, `api_url`, `worker_url`, bucket names, topic, dataset                                                        |

There is no remote state backend. `terraform apply` writes `terraform.tfstate` in `infra/terraform`.

### Inputs

| Variable             | Current value                                                | Meaning                                                         |
| -------------------- | ------------------------------------------------------------ | --------------------------------------------------------------- |
| `project_id`         | `zephyr-512319`                                              | Target project                                                  |
| `region`             | `asia-south1`                                                | Mumbai. Firestore, Cloud Run, Tasks, buckets, BigQuery use this |
| `name_prefix`        | `zephyr`                                                     | Name stem for most resources                                    |
| `operator_emails`    | set in tfvars                                                | Passed into the API as `OPERATOR_EMAILS`                        |
| `api_image`          | `asia-south1-docker.pkg.dev/zephyr-512319/zephyr/api:latest` | Cloud Run API image                                             |
| `worker_image`       | same repo, `worker:latest`                                   | Cloud Run worker image                                          |
| `enable_optional_vm` | `false` (default)                                            | Create an `e2-micro` that curls `/internal/tick`                |

The module does not create the Artifact Registry repository named `zephyr`. You create that repository and push images before the Cloud Run services run Zephyr code. Until then the default image is `gcr.io/cloudrun/hello`.

`disable_on_destroy` is false on `google_project_service`. A later destroy leaves the Google APIs enabled.

---

## 5. What `terraform apply` creates

All names below assume the current tfvars.

### Enabled Google APIs

Cloud Run, Pub/Sub, Firestore, BigQuery, Cloud Storage, Cloud Scheduler, Cloud Tasks, Secret Manager, Compute, IAM, Artifact Registry, Cloud Logging, Cloud Monitoring.

### Storage

| Resource    | Name                 | Notes                                                                                                                               |
| ----------- | -------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Data bucket | `zephyr-512319-data` | Uniform access. `force_destroy = false`. Intended for photos and uploaded fixtures                                                  |
| Web bucket  | `zephyr-512319-web`  | Uniform access. Public `roles/storage.objectViewer` for `allUsers`. Website index and 404 are `index.html`. Destroy deletes objects |

### Datastores

| Resource         | Name                               | Notes                                                     |
| ---------------- | ---------------------------------- | --------------------------------------------------------- |
| Firestore        | `(default)`, native, `asia-south1` | Apply fails if the project already has a default database |
| BigQuery dataset | `air`                              | Same region                                               |
| Table            | `air.station_readings`             | Day partition on `observed_at`, cluster `city_id`         |
| Table            | `air.exposure_snapshots`           | Day partition, cluster `uid`                              |
| Table            | `air.ward_burden_hourly`           | Day partition                                             |
| Table            | `air.google_aq_history`            | Day partition                                             |

### Messaging and jobs

| Resource            | Name                        | Notes                                                                                                                       |
| ------------------- | --------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Topic               | `zephyr-report-events`      | API publishes `{ reportId }`                                                                                                |
| Topic               | `zephyr-report-events-dlq`  | Dead-letter topic                                                                                                           |
| Push subscription   | `zephyr-report-events-push` | Worker `/internal/pubsub/reports`. Ack 60 s. Retry 10 s–600 s. Dead-letter after 5 attempts. OIDC from `zephyr-pubsub-push` |
| Push subscription   | `zephyr-dlq-record`         | Worker `/internal/pubsub/dlq`                                                                                               |
| Cloud Tasks queue   | `zephyr-alerts`             | Default retry settings                                                                                                      |
| Cloud Scheduler job | `zephyr-tick`               | `*/30 * * * *` in `Asia/Kolkata`. `POST` worker `/internal/tick` with OIDC from `zephyr-scheduler`. Attempt deadline 320 s  |

### Identity

| Service account      | Used by                         |
| -------------------- | ------------------------------- |
| `zephyr-api`         | Cloud Run API                   |
| `zephyr-worker`      | Cloud Run worker                |
| `zephyr-scheduler`   | Scheduler (and the optional VM) |
| `zephyr-pubsub-push` | Pub/Sub OIDC tokens             |

API IAM: Firestore user, object admin on the data bucket, publisher on the report topic, Secret Manager accessor, Cloud Tasks enqueuer.

Worker IAM: Firestore user, BigQuery data editor and job user, object viewer on the data bucket, publisher on the report topic, Secret Manager accessor, Cloud Tasks enqueuer.

### Cloud Run

| Service         | Ingress       | Scale | Port | Invokers                             |
| --------------- | ------------- | ----- | ---- | ------------------------------------ |
| `zephyr-api`    | All traffic   | 0–10  | 8080 | `allUsers`                           |
| `zephyr-worker` | Internal only | 0–20  | 8080 | scheduler SA, pubsub-push SA, API SA |

API environment: `ZEPHYR_PROJECT_ID`, `ZEPHYR_BUCKET`, `ZEPHYR_REPORT_TOPIC`, `OPERATOR_EMAILS`, `WORKER_URL`.

Worker environment: same project, bucket, and topic, plus `ZEPHYR_BQ_DATASET=air`.

Neither service sets `ZEPHYR_STORE`, `ZEPHYR_FIXTURES`, `ZEPHYR_DEV_AUTH`, or Secret Manager volume mounts.

### Edge

Global external Application Load Balancer, HTTP only (port 80):

```
http://<zephyr-lb-ip>/
    /api/*  → serverless NEG → Cloud Run zephyr-api
    /*      → backend bucket zephyr-512319-web + Cloud CDN
```

Reserved address: `zephyr-lb-ip`. Uptime check every 60 s: `GET http://<lb_ip>/api/v1/health`. No SSL certificate. No HTTPS proxy. No alert policy on the check.

The API `run.app` URL is also public because ingress is `INGRESS_TRAFFIC_ALL` and `allUsers` can invoke it.

### Secrets (empty shells)

Secret Manager entries with no versions:

`OPENAQ_API_KEY`, `WAQI_API_TOKEN`, `CPCB_API_KEY`, `GEMINI_API_KEY`, `GOOGLE_AIR_QUALITY_API_KEY`, `GOOGLE_PLACES_API_KEY`, `GOOGLE_SPEECH_API_KEY`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_WHATSAPP_FROM`, `WHATSAPP_CLOSURE_SECRET`, `FIREBASE_SERVICE_ACCOUNT_KEY`.

### Optional VM

Off unless `enable_optional_vm = true`. Then Terraform creates `zephyr-tick-vm` (`e2-micro`, Debian 12, `asia-south1-a`, default VPC, external IP). A cron job curls the worker tick every 30 minutes. The VM is a rubric IaaS checkbox. Scheduler already does the same call.

---

## 6. Intended runtime on Google Cloud

```
                    :80  zephyr-lb-ip
                   /                  \
              /api/*                   /*
                 │                     │
         Cloud Run API            GCS web bucket + CDN
                 │
                 │ publish reportId
                 ▼
         Pub/Sub zephyr-report-events
                 │  (5 failures)
                 ▼
         zephyr-report-events-dlq
                 │
                 ▼
         Cloud Run worker (internal)
              ▲        ▲
              │        │
     Scheduler tick    Cloud Tasks notify (queue exists)
```

Same-project Cloud Scheduler, Pub/Sub, and Cloud Tasks may call a Cloud Run service that has internal ingress on the default `run.app` URL. That is why the worker can stay internal.

After a healthy apply and image push, this is the intended loop:

1. A user opens `http://<lb_ip>/` and gets the static UI from the web bucket.
2. The UI calls `/api/v1/...`. The load balancer sends those paths to the API.
3. A committed report publishes to `zephyr-report-events`. Pub/Sub pushes the envelope to the worker. The worker classifies the photo and may promote an incident.
4. Every 30 minutes (India time) Scheduler posts `/internal/tick`. The worker refreshes stations, ward burden, fusion, and alerts.
5. Failed report deliveries move to the DLQ topic. The second subscription records them. An operator can replay from `/pipeline`.

---

## 7. How this differs from local run

| Topic             | Local / Docker                                | After Terraform apply (as written)                                                                                                                                                             |
| ----------------- | --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Store             | Shared files (`ZEPHYR_STORE=file`)            | `ZEPHYR_STORE` is unset, so each Cloud Run instance uses its own empty disk and falls back to files                                                                                            |
| Fixtures          | `fixtures/` on disk                           | Not copied into the image. Upload to the data bucket does not feed `readFile`                                                                                                                  |
| Report handoff    | Shared store plus optional HTTP to the worker | Pub/Sub push is the path that can reach the internal worker                                                                                                                                    |
| API → worker HTTP | Same Docker network or localhost              | Worker ingress is internal. Another Cloud Run service is not treated as internal unless egress goes through a VPC. The API has no VPC connector, so `WORKER_URL` fetch from the API is dropped |
| Secrets           | `.env`                                        | Secret shells exist. Processes still read `process.env`. Nothing mounts the secrets                                                                                                            |
| Auth              | `ZEPHYR_DEV_AUTH=1` demo tokens               | That flag is unset. The UI still mints `demo:` / `operator:` tokens. The API will reject them                                                                                                  |
| Web hosting       | Vite or nginx in Compose                      | Public GCS bucket + HTTP load balancer. Client routes such as `/map` 404 on the backend bucket unless you add a Cloud CDN rewrite or host the UI elsewhere                                     |

`packages/server` authenticates to Firestore, GCS, Pub/Sub, and BigQuery with `FIREBASE_SERVICE_ACCOUNT_KEY` (a JSON key), not with the Cloud Run service account. The IAM bindings on `zephyr-api` and `zephyr-worker` stay unused until that code path changes.

---

## 8. Apply blockers and deploy gaps

Fix these before you treat the project as deploy-ready.

1. **Dead-letter IAM.** Grant the Pub/Sub service agent `service-<PROJECT_NUMBER>@gcp-sa-pubsub.iam.gserviceaccount.com` `roles/pubsub.publisher` on `zephyr-report-events-dlq` before you create the push subscription, and `roles/pubsub.subscriber` on `zephyr-report-events-push` so it can acknowledge after a forward. The module does not create those bindings. Subscription create is often rejected without the publisher binding.

2. **Artifact Registry repository.** Create `asia-south1-docker.pkg.dev/zephyr-512319/zephyr`, then build and push `api:latest` and `worker:latest`. Bake `fixtures/` into the worker image or change the tick to read them from GCS.

3. **Environment on Cloud Run.** Set `ZEPHYR_STORE=gcp` if you want Firestore. Mount the Secret Manager secrets as environment variables. Set `ZEPHYR_FIXTURES` if fixtures live in the image. Set `ZEPHYR_DEV_AUTH` only if you still want demo tokens in production (do not do that for a public URL).

4. **API to worker.** Keep report processing on Pub/Sub, or give the API Direct VPC egress / a connector so `WORKER_URL` works. Scheduler and Pub/Sub do not need that change.

5. **HTTPS and SPA routing.** Add a certificate and an HTTPS proxy if you want TLS. Add a URL-map path that serves `index.html` for client routes, or serve the UI from Cloud Run.

6. **Secret versions.** Add versions for the keys you will use. Minimum for a live tick: OpenAQ and/or WAQI. Gemini for classification and copilot. Firebase JSON key if the store stays on the current GCP client. CPCB, Places, Air Quality, Speech, Twilio, and WhatsApp are optional.

7. **Firestore location.** Create the database only if the project has none. Location cannot change later.

8. **State.** Add a GCS backend if more than one machine will run Terraform.

---

## 9. Outputs after apply

| Output         | Content                                      |
| -------------- | -------------------------------------------- |
| `lb_ip`        | Global HTTP address                          |
| `api_url`      | Cloud Run API URI                            |
| `worker_url`   | Cloud Run worker URI (internal callers only) |
| `data_bucket`  | `zephyr-512319-data`                         |
| `web_bucket`   | `zephyr-512319-web`                          |
| `report_topic` | `zephyr-report-events`                       |
| `bq_dataset`   | `air`                                        |

---

## 10. Commands (after the gaps above)

```bash
# Images (repository must exist)
docker build -f apps/api/Dockerfile -t asia-south1-docker.pkg.dev/zephyr-512319/zephyr/api:latest .
docker build -f apps/worker/Dockerfile -t asia-south1-docker.pkg.dev/zephyr-512319/zephyr/worker:latest .
docker push asia-south1-docker.pkg.dev/zephyr-512319/zephyr/api:latest
docker push asia-south1-docker.pkg.dev/zephyr-512319/zephyr/worker:latest

cd infra/terraform
terraform init
terraform apply
```

Upload the web `dist/` tree to `zephyr-512319-web`. Add Secret Manager versions. Confirm `/api/v1/health` on port 80 of `lb_ip`.

Local development (not Google Cloud):

```bash
bun install
bun test
bun run dev:worker
bun run dev:api
bun run dev:web
```

Open `http://localhost:5173`.
