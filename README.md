# Zephyr — Community Air Quality & Environmental Health Dashboard

Community air quality and environmental health dashboard: citizen reports, station readings, neighbourhood hotspots, ward burden, group advisories, exposure diary, subscriptions, equity ranking, a public API, and dead-letter replay.

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
bun test
bun run build

# terminal 1
bun run dev:worker

# terminal 2
bun run dev:api

# terminal 3
bun run dev:web
```

Copy `.env.example` to `.env` and `.env.local` (both gitignored) and fill in the keys. API and worker load them via dotenv. Prefer `ZEPHYR_DATA_DIR=/tmp/zephyr-data` when the repo lives on a slow disk.

Open http://localhost:5173. Sign in as **Resident** or **Operator** (use an email listed in `OPERATOR_EMAILS`). Demo fixtures load on worker startup.

### Auth (local)

- Resident: `Authorization: Bearer demo:<email>`
- Operator: `Authorization: Bearer operator:<email>` and the email must be in `OPERATOR_EMAILS` from the env file

### Useful curls

```bash
curl localhost:8080/api/v1/health
curl localhost:8080/api/v1/cities/delhi/summary
curl -X POST localhost:8081/internal/tick
```

## Docker

```bash
docker compose up --build
```

Web on :5173, API :8080, worker :8081, Pub/Sub emulator :8085.

## GCP

1. Copy `infra/terraform/terraform.tfvars.example` → `terraform.tfvars`
2. Build and push `api` / `worker` images to Artifact Registry
3. `cd infra/terraform && terraform init && terraform apply`
4. Upload `fixtures/` to the data bucket under `fixtures/` and `geo/`
5. Set secrets with Secret Manager; set `OPERATOR_EMAILS`

HTTP contract is path-versioned under `/api/v1`. Breaking changes add `/api/v2` in the same API service.

## Demo script

1. Open the site (demo badge). Check people-in-Poor and an uncovered ward on the map.
2. Submit a photo report → track page moves through classified / promoted.
3. Operator queue → dispatch → resolve.
4. Reporter answers STILL → incident returns as disputed.
5. Pipeline → force a bad Pub/Sub body → DLQ → replay.
6. Switch to live mode; with no OpenAQ key the last summary and `lastError` remain.
