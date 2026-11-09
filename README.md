# Zephyr — Community Air Quality & Environmental Health Dashboard

Twelve-city community air quality dashboard: citizen photo reports, station readings, neighbourhood fused readings, a MapLibre globe with an Open-Meteo / CAMS model field and wind particles, operator dispatch, and dead-letter replay.

Live ingest is scoped to the **twelve monitored cities**. The map may show worldwide model tiles and wind; OpenAQ station refresh does not try to finish a planetary catalog on a free key.

## Layout

| Path | Role |
|------|------|
| `packages/domain` | Pure AQI, H3, fusion, promotion, wards, forecast, closure (unit-tested) |
| `packages/server` | File or Postgres store, ingest jobs, report processing, Gemini helpers |
| `apps/api` | Public HTTP `/api/v1/*` |
| `apps/worker` | Internal tick enqueue, job drain, Pub/Sub push, wind refresh |
| `apps/web` | Resident + operator UI |
| `infra/terraform` | Cloud SQL, Cloud Run, LB/CDN, Pub/Sub+DLQ, GCS, Scheduler, secrets, IAM (no Firestore) |
| `fixtures/` | Demo station week + ward GeoJSON |

## Local development

```bash
bun install
cp .env.example .env
bun run dev
```

That starts the worker on :8081, the API on :8080, and the web app on :5173. Open http://127.0.0.1:5173. Demo fixtures load on worker startup.

Copy `.env.example` to `.env.local` for overrides. Both files are gitignored. Prefer `ZEPHYR_DATA_DIR=/tmp/zephyr-data` when the repo lives on a slow disk. Set a non-empty `CRON_SECRET` so worker internal routes stay locked.

### Auth (local)

With `ZEPHYR_DEV_AUTH=1`:

- Resident: `Authorization: Bearer demo:<email>`
- Operator: `Authorization: Bearer operator:<email>` (email in `OPERATOR_EMAILS`)

With the Auth emulator (`FIREBASE_AUTH_EMULATOR_HOST`), use real emulator ID tokens instead.

### Useful curls

```bash
curl localhost:8080/api/v1/health
curl localhost:8080/api/v1/cities/delhi/summary
curl -H "Authorization: Bearer $CRON_SECRET" -X POST localhost:8081/internal/tick
curl -H "Authorization: Bearer $CRON_SECRET" -X POST localhost:8081/internal/jobs/run
```

## Docker (Postgres stack)

```bash
docker compose up --build
```

Web on :5173, API :8080, worker :8081, Postgres :5432, MinIO-compatible object storage, Auth emulator :9099. Services use `ZEPHYR_STORE=postgres`.

## Feeds

Demo fixtures are the legal default. Live mode may store OpenAQ (and CPCB when keyed). It does not store WAQI. Model raster and wind use Open-Meteo. See `docs/feeds.md`.

WhatsApp inbound stays off until Twilio and `WHATSAPP_CLOSURE_SECRET` are set. Text-only WhatsApp reports never count toward promotion.

## GCP

1. Copy `infra/terraform/terraform.tfvars.example` → `terraform.tfvars`
2. Build and push `api` / `worker` images to Artifact Registry
3. `cd infra/terraform && terraform init && terraform apply`
4. Upload `fixtures/` to the data bucket under `fixtures/` and `geo/`
5. Add Secret Manager versions for any third-party keys you mount; set `OPERATOR_EMAILS`

Do not apply until images exist and keyed secrets have versions. HTTP contract is path-versioned under `/api/v1`.

## Demo script

1. Open the site. Check the city AQI and open the map (model field + optional wind).
2. Submit a photo report → track page moves through received / classified / promoted.
3. Operator queue → dispatch → resolve.
4. Reporter answers STILL → incident returns as disputed.
5. Pipeline → force a bad Pub/Sub body → DLQ → replay.
6. Switch to live mode when OpenAQ keys are set; summaries refresh for the twelve cities.
