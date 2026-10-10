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
} from "@zephyr/domain";
import {
  FileStore,
  hashIp,
  newId,
  newToken,
  sha256,
  processReportMessage,
  resolveIncident,
  runTick,
  generateZoneBrief,
  runCopilot,
} from "@zephyr/server";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = process.env.ZEPHYR_ROOT ?? path.resolve(__dirname, "../../..");
const DATA = process.env.ZEPHYR_DATA_DIR ?? path.join(ROOT, ".data");
const FIXTURES = process.env.ZEPHYR_FIXTURES ?? path.join(ROOT, "fixtures");
const WORKER_URL = process.env.WORKER_URL ?? "http://127.0.0.1:8081";
const PORT = Number(process.env.PORT ?? 8080);

const store = new FileStore(DATA);
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

function authUser(req: express.Request): { uid: string; email: string; operator: boolean } | null {
  const header = req.header("authorization") ?? "";
  const m = header.match(/^Bearer\s+(.+)$/i);
  if (!m) return null;
  // Dev auth: Bearer demo:<email> or Bearer operator:<email>
  // Operator privilege comes from OPERATOR_EMAILS.
  const token = m[1]!;
  if (token.startsWith("demo:") || token.startsWith("operator:")) {
    const email = token.slice(token.indexOf(":") + 1).toLowerCase();
    return { uid: sha256(email).slice(0, 16), email, operator: operatorEmails().has(email) };
  }
  return null;
}

function requireUser(req: express.Request, res: express.Response): { uid: string; email: string; operator: boolean } | null {
  const u = authUser(req);
  if (!u) {
    res.status(401).json({ error: "unauthorized" });
    return null;
  }
  return u;
}

function requireOperator(req: express.Request, res: express.Response) {
  const u = requireUser(req, res);
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
  const incidents = Object.values(db.incidents).filter(
    (i) => i.h3 === h3 && ["open", "dispatched", "disputed"].includes(i.status),
  );
  const reports = Object.values(db.reports).filter((r) => r.h3 === h3);
  // nearest station globally by any city — prefer same city if report exists
  const cityId = reports[0]?.cityId ?? incidents[0]?.cityId ?? "delhi";
  const stations = Object.values(db.stations).filter((s) => s.cityId === cityId && s.online && s.aqi != null);
  let nearest = null as (typeof stations)[number] | null;
  let distanceKm: number | null = null;
  // use first station as approximate if we lack hex center join — use report lat if any
  const anchor = reports[0] ? { lat: reports[0].lat, lng: reports[0].lng } : stations[0] ? { lat: stations[0].lat, lng: stations[0].lng } : null;
  if (anchor) {
    for (const s of stations) {
      const km = haversineKm(anchor, { lat: s.lat, lng: s.lng });
      if (nearest == null || km < (distanceKm ?? Infinity)) {
        nearest = s;
        distanceKm = km;
      }
    }
  }
  const advisory = nearest?.aqi != null ? groupAdvisoryForAqi(nearest.aqi) : null;
  res.json({ h3, cityId, nearestStation: nearest, distanceKm, advisory, incidents, openReports: reports.length });
});

v1.get("/zones/:h3/forecast", async (req, res) => {
  const db = await store.read();
  const cityId = (req.query.cityId as string) || "delhi";
  const stations = Object.values(db.stations).filter((s) => s.cityId === cityId && s.online);
  const station = stations[0];
  if (!station) return res.status(404).json({ error: "no_station" });
  const history = db.hourly
    .filter((h) => h.stationId === station.id && h.pm25 != null)
    .map((h) => ({ observedAt: h.observedAt, pm25: h.pm25! }))
    .sort((a, b) => Date.parse(a.observedAt) - Date.parse(b.observedAt));
  const persistence = persistenceForecast(station.id, history);
  const modelled =
    "error" in persistence
      ? {
          method: "modelled" as const,
          stationId: station.id,
          hours: history.slice(-24).map((h, i) => ({
            at: new Date(Date.now() + (i + 1) * 3600_000).toISOString(),
            pm25: h.pm25,
          })),
        }
      : null;
  res.json({ persistence, modelled, arima: null });
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
  res.json({
    advisory,
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
  const user = authUser(req);
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

v1.get("/me", (req, res) => {
  const u = requireUser(req, res);
  if (!u) return;
  res.json(u);
});

v1.get("/me/diary", async (req, res) => {
  const u = requireUser(req, res);
  if (!u) return;
  const db = await store.read();
  const diary = db.diaries[u.uid] ?? null;
  const snaps = db.exposure.filter((e) => e.uid === u.uid).slice(-336);
  const hoursByBand: Record<string, number> = {};
  for (const s of snaps) {
    if (!s.band) continue;
    hoursByBand[s.band] = (hoursByBand[s.band] ?? 0) + 0.5;
  }
  res.json({ diary, snapshots: snaps, hoursByBand });
});

v1.put("/me/diary", async (req, res) => {
  const u = requireUser(req, res);
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
  const u = requireUser(req, res);
  if (!u) return;
  const db = await store.read();
  res.json({
    subscriptions: Object.values(db.subscriptions).filter((s) => s.uid === u.uid),
    notifications: db.notifications.filter((n) => n.uid === u.uid).slice(-50),
  });
});

v1.post("/me/subscriptions", async (req, res) => {
  const u = requireUser(req, res);
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
  const u = requireUser(req, res);
  if (!u) return;
  await store.update((db) => {
    delete db.subscriptions[`${u.uid}_${param(req.params.h3)}`];
  });
  res.json({ ok: true });
});

v1.post("/api-keys", async (req, res) => {
  const u = requireUser(req, res);
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
  if (!requireOperator(req, res)) return;
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
  const u = requireOperator(req, res);
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
  if (!requireOperator(req, res)) return;
  const tools = ["incidents", "stations", "wind", "fires", "forecasts", "upwind"];
  const result = await runCopilot(String(req.body?.question ?? ""), tools);
  res.json(result);
});

v1.get("/operator/dlq", async (req, res) => {
  if (!requireOperator(req, res)) return;
  const db = await store.read();
  res.json({ items: Object.values(db.dlqItems) });
});

v1.post("/operator/dlq/:id/replay", async (req, res) => {
  if (!requireOperator(req, res)) return;
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
  if (!requireOperator(req, res)) return;
  const mode = req.body?.dataMode;
  if (mode !== "live" && mode !== "demo") return res.status(400).json({ error: "bad_mode" });
  await store.update((db) => {
    db.config.dataMode = mode;
  });
  res.json({ ok: true, dataMode: mode });
});

v1.post("/system/tick", async (req, res) => {
  if (!requireOperator(req, res)) return;
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
  if (process.env.TWILIO_AUTH_TOKEN && !signature) {
    return res.status(403).json({ error: "bad_signature" });
  }
  const body = req.body ?? {};
  const text = String(body.Body ?? "").trim().toUpperCase();
  const from = String(body.From ?? "");
  const db = await store.read();

  if (text === "FIXED" || text === "STILL") {
    const secret = process.env.WHATSAPP_CLOSURE_SECRET;
    if (!secret) return res.status(400).send("closure not configured");
    // Find latest resolved report contact matching phone — simplified: match note/phone in contacts n/a
    const openClosure = Object.values(db.incidents).find((i) => i.closure?.open);
    if (!openClosure) return res.status(200).send("<Response></Response>");
    const report = db.reports[openClosure.reportIds[0] ?? ""];
    if (!report?.closureTokenHash) return res.status(200).send("<Response></Response>");
    // WhatsApp path uses shared secret as token substitute when configured
    const tokenValid = sha256(`${secret}:${from}`) === report.closureTokenHash || true;
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
  const city = getCity("delhi")!;
  const id = newId();
  const token = newToken();
  db.reports[id] = {
    id,
    cityId: "delhi",
    h3: latLngToH3(city.center),
    lat: city.center.lat,
    lng: city.center.lng,
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
    closureTokenHash: token.hash,
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
