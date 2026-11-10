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

That starts the worker on :8081, the API on :8080, and the web app on :5173. Open http://localhost:5173 (use `localhost`, not `127.0.0.1`, so Firebase Google sign-in works). Demo fixtures load on worker startup.

Copy `.env.example` to `.env.local` for overrides. Both files are gitignored. Prefer `ZEPHYR_DATA_DIR=/tmp/zephyr-data` when the repo lives on a slow disk. Set a non-empty `CRON_SECRET` so worker internal routes stay locked.

### Auth (local)

Roles: `resident` | `operator`. Operators get the incident queue, copilot, pipeline, data-mode, tick, and API keys. `GET /auth/whoami` returns `{ email, role, operator, permissions }`.

With `ZEPHYR_DEV_AUTH=1` (no Firebase client):

- Resident: `Authorization: Bearer demo:<email>` (never operator)
- Operator: `Authorization: Bearer operator:<email>` and email in `OPERATOR_EMAILS` (default `operator@zephyr.local`)

With Firebase / Auth emulator configured (`FIREBASE_*` or `VITE_FIREBASE_*` / `NEXT_PUBLIC_FIREBASE_*`):

- Web sign-in: email/password or Google (open `http://localhost:5173`, not `127.0.0.1`)
- Enable Google once in [Firebase Authentication → Sign-in method](https://console.firebase.google.com/project/cleanair-abcf0/authentication/providers), or run `bun scripts/enable-google-auth.ts` with `GOOGLE_OAUTH_CLIENT_ID` / `GOOGLE_OAUTH_CLIENT_SECRET`
- API verifies Firebase ID tokens (emulator lookup when `FIREBASE_AUTH_EMULATOR_HOST` is set)
- Seed an emulator operator: `bun run bootstrap:operator`
- `GET /api/v1/health` reports `googleSignIn` when the Google provider is configured

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
