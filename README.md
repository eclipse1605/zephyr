# Zephyr — Community Air Quality & Environmental Health Dashboard

Community air quality and environmental health dashboard: citizen reports, station readings, neighbourhood hotspots, ward burden, group advisories, exposure diary, subscriptions, equity ranking, a public API, and dead-letter replay.

Upgrade work for the worldwide map, wind, world ingest, and cloud mapping goes on `upgrade/worldwide-earth`, which includes `gcp-terraform` and the current `main`. Security fixes stay on `main`.

## Layout

| Path | Role |
|------|------|
| `packages/domain` | Pure AQI, H3, fusion, promotion, wards, forecast, closure (unit-tested) |
| `packages/server` | File-backed store, tick ingest, report processing, Gemini helpers |
| `apps/api` | Public HTTP `/api/v1/*` |
| `apps/worker` | `/internal/tick`, Pub/Sub push handlers |
| `apps/web` | Resident + operator UI |
| `infra/terraform` | Cloud Run, LB/CDN, Pub/Sub+DLQ, Firestore, BigQuery, GCS, Scheduler, Tasks, secrets, IAM |
| `fixtures/` | Demo station week + ward GeoJSON |

## Local development

```bash
bun install
cp .env.example .env
bun run dev
```

That starts the worker on :8081, the API on :8080, and the web app on :5173. Open http://127.0.0.1:5173. Demo fixtures load on worker startup. The home page can load a city summary after that first tick.

Copy `.env.example` to `.env.local` as well if you want local overrides. Both files are gitignored. API and worker load them via dotenv. Prefer `ZEPHYR_DATA_DIR=/tmp/zephyr-data` when the repo lives on a slow disk.

### Auth (local)

- Resident: `Authorization: Bearer demo:<email>`
- Operator: `Authorization: Bearer operator:<email>` and the email must be in `OPERATOR_EMAILS` from the env file

### Useful curls

```bash
curl localhost:8080/api/v1/health
curl localhost:8080/api/v1/cities/delhi/summary
curl -H "Authorization: Bearer $CRON_SECRET" -X POST localhost:8081/internal/tick
```

## Docker

```bash
docker compose up --build
```

Web on :5173, API :8080, worker :8081, Pub/Sub emulator :8085.

## Feeds

Demo fixtures are the legal default. Live mode may store OpenAQ and CPCB. It does not store WAQI. See `docs/feeds.md`.

## GCP

1. Copy `infra/terraform/terraform.tfvars.example` → `terraform.tfvars`
2. Build and push `api` / `worker` images to Artifact Registry
3. `cd infra/terraform && terraform init && terraform apply`
4. Upload `fixtures/` to the data bucket under `fixtures/` and `geo/`
5. Set secrets with Secret Manager; set `OPERATOR_EMAILS`

HTTP contract is path-versioned under `/api/v1`. Breaking changes add `/api/v2` in the same API service.

## Demo script

1. Open the site (demo badge). Check the city AQI and open the map.
2. Submit a photo report → track page moves through classified / promoted.
3. Operator queue → dispatch → resolve.
4. Reporter answers STILL → incident returns as disputed.
5. Pipeline → force a bad Pub/Sub body → DLQ → replay.
6. Switch to live mode; with no OpenAQ key the last summary and `lastError` remain.
