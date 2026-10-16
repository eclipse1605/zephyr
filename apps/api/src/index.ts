import { config as loadEnv } from "dotenv";
import express from "express";
import cors from "cors";
import multer from "multer";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __envDir = path.dirname(fileURLToPath(import.meta.url));
const __repoRoot = path.resolve(__envDir, "../../..");
loadEnv({ path: path.join(__repoRoot, ".env.local") });
loadEnv({ path: path.join(__repoRoot, ".env") });
import {
  CITIES,
  getCity,
  pointInBounds,
  latLngToH3,
  groupAdvisoryForAqi,
  persistenceForecast,
  applyClosureAnswer,
  isOverdue,
  isRepeatHotspot,
  haversineKm,
  exposureGaps,
  verifyTwilioSignature,
  h3ToLatLng,
} from "@zephyr/domain";
import {
  hashIp,
  newId,
  newToken,
  sha256,
  processReportMessage,
  resolveIncident,
  runTick,
  generateZoneBrief,
  runCopilot,
  arimaForecast,
  fetchModelledPm25,
  publishReport,
  openStore,
  forecastTrainingStatus,
} from "@zephyr/server";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = process.env.ZEPHYR_ROOT ?? path.resolve(__dirname, "../../..");
const DATA = process.env.ZEPHYR_DATA_DIR ?? path.join(ROOT, ".data");
const FIXTURES = process.env.ZEPHYR_FIXTURES ?? path.join(ROOT, "fixtures");
const WORKER_URL = process.env.WORKER_URL ?? "http://127.0.0.1:8081";
const PORT = Number(process.env.PORT ?? 8080);

const store = await openStore(DATA);
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });
const app = express();
app.use(cors());
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));

function param(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

function operatorEmails(): Set<string> {
  return new Set(
    (process.env.OPERATOR_EMAILS ?? "")
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
  );
}

async function authUser(req: express.Request): Promise<{ uid: string; email: string; operator: boolean } | null> {
  const header = req.header("authorization") ?? "";
  const m = header.match(/^Bearer\s+(.+)$/i);
  if (!m) return null;
  const token = m[1]!;
  if (process.env.ZEPHYR_DEV_AUTH === "1" && (token.startsWith("demo:") || token.startsWith("operator:"))) {
    const email = token.slice(token.indexOf(":") + 1).toLowerCase();
    return { uid: sha256(email).slice(0, 16), email, operator: operatorEmails().has(email) };
  }
  try {
    const res = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(token)}`);
    if (!res.ok) return null;
    const info = (await res.json()) as { sub?: string; email?: string };
    if (!info.email || !info.sub) return null;
    const email = info.email.toLowerCase();
    return { uid: info.sub, email, operator: operatorEmails().has(email) };
  } catch {
    return null;
  }
}

async function requireUser(req: express.Request, res: express.Response): Promise<{ uid: string; email: string; operator: boolean } | null> {
  const u = await authUser(req);
  if (!u) {
    res.status(401).json({ error: "unauthorized" });
    return null;
  }
  return u;
}

async function requireOperator(req: express.Request, res: express.Response) {
  const u = await requireUser(req, res);
  if (!u) return null;
  if (!u.operator && !operatorEmails().has(u.email)) {
    res.status(403).json({ error: "operator_required" });
    return null;
  }
  return u;
}

async function checkApiKey(req: express.Request): Promise<boolean> {
  const key = req.header("x-api-key");
  if (!key) return false;
  const db = await store.read();
  const hash = sha256(key);
  const rec = db.apiKeys[hash];
  if (!rec) return false;
  const bucket = `apikey:${hash}:${new Date().toISOString().slice(0, 16)}`;
  const rl = db.rateLimits[bucket] ?? { count: 0, windowStart: new Date().toISOString() };
  if (rl.count >= 60) return false;
  rl.count += 1;
  db.rateLimits[bucket] = rl;
  await store.write(db);
  return true;
}

async function enqueueReport(reportId: string) {
  // Local: push to shared pending queue; also try HTTP to worker.
  await store.update((db) => {
    db.pendingMessages.push({ id: newId(), type: "report.submitted", body: { reportId } });
  });
  await publishReport(reportId).catch(() => false);
  try {
    await fetch(`${WORKER_URL}/internal/pubsub/reports`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: { data: Buffer.from(JSON.stringify({ reportId })).toString("base64") } }),
    });
  } catch {
    // worker may process pendingMessages on its tick
  }
}

const v1 = express.Router();

v1.get("/health", async (_req, res) => {
  const db = await store.read();
  res.json({
    ok: true,
    service: "api",
    version: "v1",
    dataMode: db.config.dataMode,
    integrations: {
      openaq: Boolean(process.env.OPENAQ_API_KEY?.trim()),
      waqi: Boolean(process.env.WAQI_API_TOKEN?.trim()),
      gemini: Boolean(process.env.GEMINI_API_KEY?.trim()),
      twilio: Boolean(process.env.TWILIO_ACCOUNT_SID?.trim()),
      cpcb: Boolean(process.env.CPCB_API_KEY?.trim()),
      places: Boolean(process.env.GOOGLE_PLACES_API_KEY?.trim()),
      airQuality: Boolean(process.env.GOOGLE_AIR_QUALITY_API_KEY?.trim()),
      firebase: Boolean(process.env.FIREBASE_SERVICE_ACCOUNT_KEY?.trim()),
    },
    ingest: db.ingest,
    forecastTraining: forecastTrainingStatus(
      Math.max(0, ...Object.values(
        db.hourly.reduce<Record<string, number>>((counts, row) => {
          counts[row.stationId] = (counts[row.stationId] ?? 0) + 1;
          return counts;
        }, {}),
      )),
    ),
  });
});

v1.get("/cities", (_req, res) => {
  res.json({
    cities: CITIES.map((c) => ({
      id: c.id,
      name: c.name,
      region: c.region,
      group: c.group,
      aqiScale: c.aqiScale,
      center: c.center,
      zoom: c.zoom,
    })),
  });
});

async function citySummaryHandler(req: express.Request, res: express.Response) {
  const db = await store.read();
  const summary = db.citySummaries[param(req.params.cityId)];
  if (!summary) return res.status(404).json({ error: "summary_missing", hint: "run tick in demo mode" });
  res.setHeader("Cache-Control", "public, max-age=60");
  res.json(summary);
}

v1.get("/cities/:cityId/summary", citySummaryHandler);
v1.get("/cities/:cityId/stations", async (req, res) => {
  const db = await store.read();
  const stations = Object.values(db.stations).filter((s) => s.cityId === param(req.params.cityId));
  res.json({ stations });
});
v1.get("/cities/:cityId/wards", async (req, res) => {
  const db = await store.read();
  const wards = Object.values(db.wards).filter((w) => w.cityId === param(req.params.cityId));
  res.setHeader("Cache-Control", "public, max-age=60");
  res.json({ wards });
});

v1.get("/zones/:h3", async (req, res) => {
  const db = await store.read();
  const h3 = param(req.params.h3);
  let center: { lat: number; lng: number };
  try {
    center = h3ToLatLng(h3);
  } catch {
    return res.status(400).json({ error: "bad_h3" });
  }
  const city = CITIES.find((c) => pointInBounds(center, c.bounds));
  const cityId = (req.query.cityId as string) || city?.id || "delhi";
  const stations = Object.values(db.stations).filter((s) => s.cityId === cityId && s.online && s.aqi != null);
  let nearest = null as (typeof stations)[number] | null;
  let distanceKm: number | null = null;
  for (const s of stations) {
    const km = haversineKm(center, { lat: s.lat, lng: s.lng });
    if (nearest == null || km < (distanceKm ?? Infinity)) {
      nearest = s;
      distanceKm = km;
    }
  }
  const incidents = Object.values(db.incidents).filter(
    (i) => i.h3 === h3 && ["open", "dispatched", "disputed"].includes(i.status),
  );
  const reports = Object.values(db.reports).filter((r) => r.h3 === h3);
  const scale = getCity(cityId)?.aqiScale ?? "india";
  const advisory = nearest?.aqi != null ? groupAdvisoryForAqi(nearest.aqi, scale) : null;
  res.json({ h3, cityId, center, nearestStation: nearest, distanceKm, advisory, incidents, openReports: reports.length });
});

v1.get("/zones/:h3/forecast", async (req, res) => {
  const db = await store.read();
  const cityId = (req.query.cityId as string) || "delhi";
  let center: { lat: number; lng: number } | null = null;
  try {
    center = h3ToLatLng(param(req.params.h3));
  } catch {
    center = null;
  }
  const stations = Object.values(db.stations).filter((s) => s.cityId === cityId && s.online);
  let station = stations[0];
  if (center && stations.length) {
    let best = Infinity;
    for (const s of stations) {
      const km = haversineKm(center, { lat: s.lat, lng: s.lng });
      if (km < best) {
        best = km;
        station = s;
      }
    }
  }
  if (!station) return res.status(404).json({ error: "no_station" });
  const history = db.hourly
    .filter((h) => h.stationId === station.id && h.pm25 != null)
    .map((h) => ({ observedAt: h.observedAt, pm25: h.pm25! }))
    .sort((a, b) => Date.parse(a.observedAt) - Date.parse(b.observedAt));
  const persistence = persistenceForecast(station.id, history);
  let modelled: { method: "modelled"; stationId: string; hours: Array<{ at: string; pm25: number }> } | null = null;
  if ("error" in persistence) {
    let hours = db.modelledHistory.filter((h) => h.stationId === station.id);
    if (hours.length === 0) {
      const fetched = await fetchModelledPm25(station.lat, station.lng);
      hours = fetched.map((h) => ({ stationId: station.id, at: h.at, pm25: h.pm25 }));
      if (hours.length) {
        db.modelledHistory.push(...hours);
        await store.write(db);
      }
    }
    modelled = {
      method: "modelled",
      stationId: station.id,
      hours: hours.map((h) => ({ at: h.at, pm25: h.pm25 })),
    };
  }
  const arimaHours = await arimaForecast(station.id, history);
  res.json({
    persistence,
    modelled,
    arima: arimaHours ? { method: "arima_plus", stationId: station.id, hours: arimaHours } : null,
  });
});

v1.get("/zones/:h3/brief", async (req, res) => {
  const lang = (req.query.lang as string) || "en";
  const db = await store.read();
  const h3 = param(req.params.h3);
  const evidence = {
    incidents: Object.values(db.incidents).filter((i) => i.h3 === h3).slice(0, 5),
    summary: db.citySummaries[Object.values(db.incidents).find((i) => i.h3 === h3)?.cityId ?? "delhi"],
  };
  const text = await generateZoneBrief(evidence, lang);
  res.json({ h3, lang, text });
});

v1.get("/zones/:h3/health", async (req, res) => {
  const db = await store.read();
  const h3 = param(req.params.h3);
  const incident = Object.values(db.incidents).find((i) => i.h3 === h3);
  const station = incident
    ? Object.values(db.stations).find((s) => s.id === incident.stationId)
    : null;
  const advisory = station?.aqi != null ? groupAdvisoryForAqi(station.aqi) : null;
  const placesKey = process.env.GOOGLE_PLACES_API_KEY?.trim();
  let sensitiveSites: Array<{ name: string; kind: string }> = [];
  if (placesKey && incident) {
    const station = Object.values(db.stations).find((s) => s.id === incident.stationId);
    if (station) {
      const url = "https://places.googleapis.com/v1/places:searchNearby";
      const resPlaces = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": placesKey,
          "X-Goog-FieldMask": "places.displayName,places.primaryType",
        },
        body: JSON.stringify({
          includedTypes: ["school", "hospital"],
          maxResultCount: 8,
          locationRestriction: {
            circle: { center: { latitude: station.lat, longitude: station.lng }, radius: 1000 },
          },
        }),
      }).catch(() => null);
      if (resPlaces?.ok) {
        const body = (await resPlaces.json()) as { places?: Array<{ displayName?: { text?: string }; primaryType?: string }> };
        sensitiveSites = (body.places ?? []).map((p) => ({
          name: p.displayName?.text ?? "site",
          kind: p.primaryType ?? "place",
        }));
      }
    }
  }
  res.json({
    advisory,
    sensitiveSites,
    googleHealthAdvice: process.env.GOOGLE_AIR_QUALITY_API_KEY
      ? { configured: true, text: "See Google Air Quality API for sensitive-group advice." }
      : { configured: false, text: null },
  });
});

v1.post("/reports", async (req, res) => {
  const { cityId, lat, lng, hazardType, note } = req.body ?? {};
  const city = getCity(cityId);
  if (!city) return res.status(400).json({ error: "unknown_city" });
  if (typeof lat !== "number" || typeof lng !== "number") return res.status(400).json({ error: "bad_coords" });
  if (!pointInBounds({ lat, lng }, city.bounds)) return res.status(400).json({ error: "outside_city" });

  const ip = req.ip ?? "0.0.0.0";
  const ipHash = hashIp(ip);
  const db = await store.read();
  const bucket = `report:${ipHash}:${new Date().toISOString().slice(0, 13)}`;
  const rl = db.rateLimits[bucket] ?? { count: 0, windowStart: new Date().toISOString() };
  if (rl.count >= 10) return res.status(429).json({ error: "rate_limited" });
  rl.count += 1;
  db.rateLimits[bucket] = rl;

  const id = typeof req.body.reportId === "string" ? req.body.reportId : newId();
  const user = await authUser(req);
  const token = newToken();
  db.reports[id] = {
    id,
    cityId,
    h3: latLngToH3({ lat, lng }),
    lat,
    lng,
    hazardType: hazardType ?? "other",
    note: note ?? "",
    photoPath: null,
    photoSha256: null,
    voicePath: null,
    status: "pending_upload",
    classification: null,
    authenticity: null,
    countsTowardPromotion: false,
    createdAt: new Date().toISOString(),
    reporterUid: user?.uid ?? null,
    reporterKey: user?.uid ?? ipHash,
    channel: "web",
    ipHash,
    incidentId: null,
    closureTokenHash: token.hash,
  };
  await store.write(db);
  res.json({
    reportId: id,
    uploadUrl: `/api/v1/reports/${id}/photo`,
    closureToken: token.raw,
    h3: db.reports[id]!.h3,
  });
});

v1.post("/reports/:id/photo", upload.single("photo"), async (req, res) => {
  const id = param(req.params.id);
  const db = await store.read();
  if (!db.reports[id]) return res.status(404).json({ error: "not_found" });
  if (!req.file) return res.status(400).json({ error: "photo_required" });
  const p = await store.savePhoto(id, req.file.buffer);
  db.reports[id]!.photoPath = p;
  await store.write(db);
  res.json({ ok: true });
});

v1.post("/reports/:id/commit", async (req, res) => {
  const id = param(req.params.id);
  const db = await store.read();
  const report = db.reports[id];
  if (!report) return res.status(404).json({ error: "not_found" });
  if (!(await store.photoExists(id))) return res.status(400).json({ error: "photo_missing" });
  report.status = "received";
  if (req.body?.sha256) report.photoSha256 = req.body.sha256;
  await store.write(db);
  await enqueueReport(id);
  res.json({ ok: true, reportId: id, status: report.status });
});

v1.get("/reports/:id", async (req, res) => {
  const db = await store.read();
  const report = db.reports[param(req.params.id)];
  if (!report) return res.status(404).json({ error: "not_found" });
  const incident = report.incidentId ? db.incidents[report.incidentId] : null;
  res.json({
    report: { ...report, closureTokenHash: undefined, ipHash: undefined },
    incident,
  });
});

v1.post("/reports/:id/closure", async (req, res) => {
  const { token, answer } = req.body ?? {};
  if (answer !== "FIXED" && answer !== "STILL") return res.status(400).json({ error: "bad_answer" });
  const db = await store.read();
  const report = db.reports[param(req.params.id)];
  if (!report?.incidentId) return res.status(404).json({ error: "not_found" });
  const incident = db.incidents[report.incidentId];
  if (!incident?.closure) return res.status(400).json({ error: "no_closure_window" });
  const tokenValid = typeof token === "string" && sha256(token) === report.closureTokenHash;
  const result = applyClosureAnswer({ closure: incident.closure as never, answer, tokenValid });
  if (!result.ok) return res.status(400).json(result);
  incident.status = result.incidentStatus;
  incident.closure = result.closure;
  if (result.incidentStatus === "disputed") incident.assignee = null;
  db.incidentEvents.push({
    id: newId(),
    incidentId: incident.id,
    type: result.event,
    at: new Date().toISOString(),
    actor: "reporter",
    h3: incident.h3,
  });
  await store.write(db);
  res.json(result);
});

v1.get("/me", async (req, res) => {
  const u = await requireUser(req, res);
  if (!u) return;
  res.json(u);
});

v1.get("/me/diary", async (req, res) => {
  const u = await requireUser(req, res);
  if (!u) return;
  const db = await store.read();
  const diary = db.diaries[u.uid] ?? null;
  const snaps = db.exposure.filter((e) => e.uid === u.uid).slice(-336);
  const hoursByBand: Record<string, number> = {};
  for (const s of snaps) {
    if (!s.band) continue;
    hoursByBand[s.band] = (hoursByBand[s.band] ?? 0) + 0.5;
  }
  const gaps = exposureGaps(snaps);
  res.json({ diary, snapshots: snaps, hoursByBand, gaps });
});

v1.put("/me/diary", async (req, res) => {
  const u = await requireUser(req, res);
  if (!u) return;
  const { cityId, lat, lng } = req.body ?? {};
  const city = getCity(cityId);
  if (!city || typeof lat !== "number" || typeof lng !== "number") {
    return res.status(400).json({ error: "bad_request" });
  }
  await store.update((db) => {
    db.diaries[u.uid] = {
      uid: u.uid,
      cityId,
      lat,
      lng,
      h3: latLngToH3({ lat, lng }),
    };
  });
  res.json({ ok: true });
});

v1.get("/me/subscriptions", async (req, res) => {
  const u = await requireUser(req, res);
  if (!u) return;
  const db = await store.read();
  res.json({
    subscriptions: Object.values(db.subscriptions).filter((s) => s.uid === u.uid),
    notifications: db.notifications.filter((n) => n.uid === u.uid).slice(-50),
  });
});

v1.post("/me/subscriptions", async (req, res) => {
  const u = await requireUser(req, res);
  if (!u) return;
  const { h3, cityId, channels } = req.body ?? {};
  if (!h3 || !cityId) return res.status(400).json({ error: "bad_request" });
  const key = `${u.uid}_${h3}`;
  await store.update((db) => {
    db.subscriptions[key] = {
      uid: u.uid,
      h3,
      cityId,
      channels: channels ?? ["in_app"],
      createdAt: new Date().toISOString(),
      lastNotifiedAt: null,
    };
  });
  res.json({ ok: true, id: key });
});

v1.delete("/me/subscriptions/:h3", async (req, res) => {
  const u = await requireUser(req, res);
  if (!u) return;
  await store.update((db) => {
    delete db.subscriptions[`${u.uid}_${param(req.params.h3)}`];
  });
  res.json({ ok: true });
});

v1.post("/api-keys", async (req, res) => {
  const u = await requireUser(req, res);
  if (!u) return;
  const raw = `zph_${newToken().raw}`;
  const hash = sha256(raw);
  await store.update((db) => {
    db.apiKeys[hash] = {
      keyHash: hash,
      uid: u.uid,
      prefix: raw.slice(0, 10),
      createdAt: new Date().toISOString(),
    };
  });
  res.json({ apiKey: raw, prefix: raw.slice(0, 10) });
});

v1.get("/operator/incidents", async (req, res) => {
  if (!await requireOperator(req, res)) return;
  const db = await store.read();
  const items = Object.values(db.incidents)
    .filter((i) => ["open", "dispatched", "disputed"].includes(i.status))
    .map((i) => {
      const events = db.incidentEvents.filter((e) => e.incidentId === i.id);
      return {
        ...i,
        repeat: isRepeatHotspot(events.map((e) => ({ type: e.type as never, at: e.at, h3: e.h3 }))),
        overdue: isOverdue({ openedAt: i.openedAt, priority: i.priority }),
      };
    });
  res.json({ incidents: items });
});

v1.post("/operator/incidents/:id/:action", async (req, res) => {
  const u = await requireOperator(req, res);
  if (!u) return;
  const action = param(req.params.action) as "dispatch" | "resolve" | "false-positive";
  const mapped = action === "false-positive" ? "false_positive" : action;
  if (!["dispatch", "resolve", "false_positive"].includes(mapped)) {
    return res.status(400).json({ error: "bad_action" });
  }
  await resolveIncident(store, param(req.params.id), u.email, mapped as "dispatch" | "resolve" | "false_positive");
  res.json({ ok: true });
});

v1.post("/operator/copilot", async (req, res) => {
  if (!await requireOperator(req, res)) return;
  const result = await runCopilot(String(req.body?.question ?? ""), {
    incidents: async (args) => {
      const db = await store.read();
      return Object.values(db.incidents)
        .filter((i) => !args?.cityId || i.cityId === args.cityId)
        .filter((i) => !args?.h3 || i.h3 === args.h3)
        .slice(0, 12)
        .map((i) => ({ id: i.id, status: i.status, h3: i.h3, cityId: i.cityId, reason: i.reason }));
    },
    stations: async (args) => {
      const db = await store.read();
      return Object.values(db.stations)
        .filter((s) => !args?.cityId || s.cityId === args.cityId)
        .slice(0, 12)
        .map((s) => ({ name: s.name, aqi: s.aqi, cityId: s.cityId, lat: s.lat, lng: s.lng }));
    },
    fires: async (args) => {
      const db = await store.read();
      return db.fires.filter((f) => !args?.cityId || f.cityId === args.cityId).slice(0, 12);
    },
    forecasts: async (args) => {
      const db = await store.read();
      return Object.values(db.citySummaries)
        .filter((c) => !args?.cityId || c.cityId === args.cityId)
        .map((c) => ({ cityId: c.cityId, aqi: c.cityAqi }));
    },
    upwind: async (args) => {
      const db = await store.read();
      return Object.values(db.incidents)
        .filter((i) => !args?.cityId || i.cityId === args.cityId)
        .filter((i) => !args?.h3 || i.h3 === args.h3)
        .flatMap((i) => i.upwind ?? [])
        .slice(0, 12);
    },
    wind: async () => ({ source: "open-meteo", note: "direction is attached on each incident upwind list" }),
  });
  res.json(result);
});

v1.get("/cities/:cityId/fires", async (req, res) => {
  const db = await store.read();
  res.json({ fires: db.fires.filter((f) => f.cityId === param(req.params.cityId)) });
});

v1.post("/reports/:id/voice", upload.single("voice"), async (req, res) => {
  const id = param(req.params.id);
  const db = await store.read();
  if (!db.reports[id]) return res.status(404).json({ error: "not_found" });
  if (!req.file) return res.status(400).json({ error: "voice_required" });
  const p = await store.savePhoto(`${id}-voice`, req.file.buffer);
  db.reports[id]!.voicePath = p;
  await store.write(db);
  res.json({ ok: true });
});

v1.get("/operator/dlq", async (req, res) => {
  if (!await requireOperator(req, res)) return;
  const db = await store.read();
  res.json({ items: Object.values(db.dlqItems) });
});

v1.post("/operator/dlq/:id/replay", async (req, res) => {
  if (!await requireOperator(req, res)) return;
  const db = await store.read();
  const item = db.dlqItems[param(req.params.id)];
  if (!item) return res.status(404).json({ error: "not_found" });
  const body = item.body as { reportId?: string };
  item.replayedAt = new Date().toISOString();
  await store.write(db);
  if (body.reportId) {
    try {
      await processReportMessage(store, body.reportId);
    } catch (err) {
      return res.status(500).json({ error: String(err) });
    }
  }
  res.json({ ok: true });
});

v1.post("/system/data-mode", async (req, res) => {
  if (!await requireOperator(req, res)) return;
  const mode = req.body?.dataMode;
  if (mode !== "live" && mode !== "demo") return res.status(400).json({ error: "bad_mode" });
  await store.update((db) => {
    db.config.dataMode = mode;
  });
  res.json({ ok: true, dataMode: mode });
});

v1.post("/system/tick", async (req, res) => {
  if (!await requireOperator(req, res)) return;
  try {
    await fetch(`${WORKER_URL}/internal/tick`, { method: "POST" });
  } catch {
    const result = await runTick({ store, fixturesRoot: FIXTURES });
    return res.json(result);
  }
  res.json({ ok: true, via: "worker" });
});

v1.post("/whatsapp/inbound", async (req, res) => {
  const signature = req.header("x-twilio-signature");
  const authToken = process.env.TWILIO_AUTH_TOKEN?.trim() ?? "";
  const params = Object.fromEntries(Object.entries(req.body ?? {}).map(([k, v]) => [k, String(v)]));
  const url = `${req.protocol}://${req.get("host")}${req.originalUrl}`;
  if (authToken && !verifyTwilioSignature(url, params, authToken, signature)) {
    return res.status(403).json({ error: "bad_signature" });
  }
  const body = req.body ?? {};
  const text = String(body.Body ?? "").trim().toUpperCase();
  const from = String(body.From ?? "");
  const db = await store.read();

  if (text === "FIXED" || text === "STILL") {
    const secret = process.env.WHATSAPP_CLOSURE_SECRET?.trim();
    if (!secret) return res.status(400).send("closure not configured");
    const openClosure = Object.values(db.incidents).find((i) => i.closure?.open);
    if (!openClosure) return res.status(200).send("<Response></Response>");
    const report = db.reports[openClosure.reportIds[0] ?? ""];
    if (!report?.closureTokenHash) return res.status(200).send("<Response></Response>");
    const tokenValid = sha256(`${secret}:${from}`) === report.closureTokenHash;
    const result = applyClosureAnswer({
      closure: openClosure.closure as never,
      answer: text as "FIXED" | "STILL",
      tokenValid,
    });
    if (result.ok) {
      openClosure.status = result.incidentStatus;
      openClosure.closure = result.closure;
      if (result.incidentStatus === "disputed") openClosure.assignee = null;
      await store.write(db);
    }
    return res.type("text/xml").send("<Response></Response>");
  }

  // New WhatsApp report with media URL would be fetched here; create a text-only report for demo.
  const lat = Number(body.Latitude);
  const lng = Number(body.Longitude);
  const point = Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
  const city = point ? CITIES.find((c) => pointInBounds(point, c.bounds)) : undefined;
  if (!city || !point) {
    return res.type("text/xml").send("<Response><Message>Send a location pin inside a monitored city.</Message></Response>");
  }
  const id = newId();
  const secret = process.env.WHATSAPP_CLOSURE_SECRET?.trim();
  const token = newToken();
  db.reports[id] = {
    id,
    cityId: city.id,
    h3: latLngToH3(point),
    lat: point.lat,
    lng: point.lng,
    hazardType: "smoke",
    note: String(body.Body ?? "whatsapp report"),
    photoPath: null,
    photoSha256: null,
    voicePath: null,
    status: "received",
    classification: null,
    authenticity: { ok: true, reasons: [] },
    countsTowardPromotion: true,
    createdAt: new Date().toISOString(),
    reporterUid: null,
    reporterKey: hashIp(from || "whatsapp"),
    channel: "whatsapp",
    ipHash: hashIp(from || "whatsapp"),
    incidentId: null,
    closureTokenHash: secret ? sha256(`${secret}:${from}`) : token.hash,
  };
  await store.write(db);
  await enqueueReport(id);
  res.type("text/xml").send("<Response><Message>Report received. Track on the web app.</Message></Response>");
});

// Programmatic GETs with API key (same handlers)
app.use("/api/v1", async (req, res, next) => {
  if (req.method === "GET" && req.header("x-api-key")) {
    const ok = await checkApiKey(req);
    if (!ok) return res.status(429).json({ error: "api_key_rejected" });
  }
  next();
});

app.use("/api/v1", v1);

await store.ensure();
app.listen(PORT, () => {
  console.log(`zephyr api listening on :${PORT}`);
});
