import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  parseCpcbRecords,
  parseWaqiStations,
  latLngToH3,
  type CityConfig,
  type StationReading,
  type StationSource,
} from "@zephyr/domain";

export type FeedStatus = { source: StationSource; ok: boolean; error: string | null; count: number };

export async function fetchCityStations(city: CityConfig): Promise<{ readings: StationReading[]; feeds: FeedStatus[] }> {
  const readings: StationReading[] = [];
  const feeds: FeedStatus[] = [];
  for (const source of city.stations.sources) {
    try {
      const batch =
        source === "openaq"
          ? await fetchOpenAq(city)
          : source === "waqi"
            ? await fetchWaqi(city)
            : await fetchCpcb(city);
      readings.push(...batch);
      feeds.push({ source, ok: true, error: null, count: batch.length });
    } catch (err) {
      feeds.push({
        source,
        ok: false,
        error: err instanceof Error ? err.message : String(err),
        count: 0,
      });
    }
  }
  return { readings, feeds };
}

async function fetchOpenAq(city: CityConfig): Promise<StationReading[]> {
  const apiKey = process.env.OPENAQ_API_KEY?.trim();
  if (!apiKey) throw new Error("OPENAQ_API_KEY not configured");
  const url = new URL("https://api.openaq.org/v3/locations");
  url.searchParams.set("coordinates", `${city.center.lat},${city.center.lng}`);
  url.searchParams.set("radius", "25000");
  url.searchParams.set("limit", "100");
  const res = await fetch(url, { headers: { "X-API-Key": apiKey }, signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`OpenAQ ${res.status}`);
  const body = (await res.json()) as {
    results?: Array<{
      id: number;
      name: string;
      coordinates?: { latitude: number; longitude: number };
      datetimeLast?: { utc?: string };
      sensors?: Array<{ parameter?: { name?: string }; latest?: { value?: number } }>;
    }>;
  };
  const out: StationReading[] = [];
  for (const loc of body.results ?? []) {
    if (!loc.coordinates) continue;
    const pollutants: StationReading["pollutants"] = {};
    for (const sensor of loc.sensors ?? []) {
      const name = sensor.parameter?.name?.toLowerCase();
      const value = sensor.latest?.value;
      if (value == null) continue;
      if (name === "pm25" || name === "pm2.5") pollutants.pm25 = value;
      if (name === "pm10") pollutants.pm10 = value;
      if (name === "no2") pollutants.no2 = value;
      if (name === "so2") pollutants.so2 = value;
      if (name === "co") pollutants.co = value;
      if (name === "o3" || name === "ozone") pollutants.ozone = value;
    }
    out.push({
      id: `openaq-${loc.id}`,
      name: loc.name,
      cityId: city.id,
      lat: loc.coordinates.latitude,
      lng: loc.coordinates.longitude,
      sourceFeed: "openaq",
      lastSeen: loc.datetimeLast?.utc ?? new Date().toISOString(),
      pollutants,
    });
  }
  return out;
}

async function fetchWaqi(city: CityConfig): Promise<StationReading[]> {
  const token = process.env.WAQI_API_TOKEN?.trim();
  if (!token) throw new Error("WAQI_API_TOKEN not configured");
  const { minLat, maxLat, minLng, maxLng } = city.bounds;
  const url = `https://api.waqi.info/map/bounds/?latlng=${minLat},${minLng},${maxLat},${maxLng}&token=${token}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`WAQI ${res.status}`);
  return parseWaqiStations(await res.json(), city.id);
}

async function fetchCpcb(city: CityConfig): Promise<StationReading[]> {
  const key = process.env.CPCB_API_KEY?.trim();
  if (!key) throw new Error("CPCB_API_KEY not configured");
  const url = new URL("https://api.data.gov.in/resource/3b01bcb8-0b14-4abf-b6f2-c1bfd384ba69");
  url.searchParams.set("api-key", key);
  url.searchParams.set("format", "json");
  url.searchParams.set("limit", "100");
  url.searchParams.set("filters[city]", city.name.replace("New ", ""));
  const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`CPCB ${res.status}`);
  return parseCpcbRecords(await res.json(), city.id);
}

export type SatelliteCell = { h3: string; anomaly: boolean; no2: number | null };
export type FirePoint = { id: string; cityId: string; lat: number; lng: number; at: string };

type EeValue =
  | { constantValue: string | number | boolean | Array<string | number> }
  | { arrayValue: { values: EeValue[] } }
  | { functionInvocationValue: { functionName: string; arguments: Record<string, EeValue> } };

function eeLit(value: string | number | boolean | Array<string | number>): EeValue {
  return { constantValue: value };
}

function eeList(values: EeValue[]): EeValue {
  return { arrayValue: { values } };
}

function eeCall(functionName: string, args: Record<string, EeValue>): EeValue {
  return { functionInvocationValue: { functionName, arguments: args } };
}

function utcDay(offsetDays: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

function eeRectangle(minLng: number, minLat: number, maxLng: number, maxLat: number): EeValue {
  return eeCall("GeometryConstructors.Rectangle", {
    coords: eeLit([minLng, minLat, maxLng, maxLat]),
  });
}

function aggregate(collection: EeValue, property: string): EeValue {
  return eeCall("FeatureCollection.aggregate_array", {
    collection,
    property: eeLit(property),
  });
}

function latestNo2(start: string, end: string): EeValue {
  const filtered = eeCall("ImageCollection.filterDate", {
    collection: eeCall("ImageCollection.load", { id: eeLit("COPERNICUS/S5P/OFFL/L3_NO2") }),
    start: eeLit(start),
    end: eeLit(end),
  });
  const sorted = eeCall("ImageCollection.sort", {
    collection: filtered,
    property: eeLit("system:time_start"),
    ascending: eeLit(false),
  });
  const selected = eeCall("Image.select", {
    input: eeCall("ImageCollection.first", { imagecollection: sorted }),
    bandSelectors: eeLit(["tropospheric_NO2_column_number_density"]),
  });
  return eeCall("Image.regexpRename", {
    input: selected,
    regex: eeLit(".*"),
    replacement: eeLit("no2"),
  });
}

function meanNo2(start: string, end: string, bandName: string): EeValue {
  const loaded = eeCall("ImageCollection.load", { id: eeLit("COPERNICUS/S5P/OFFL/L3_NO2") });
  const filtered = eeCall("ImageCollection.filterDate", {
    collection: loaded,
    start: eeLit(start),
    end: eeLit(end),
  });
  const mean = eeCall("reduce.mean", { collection: filtered });
  const selected = eeCall("Image.select", {
    input: mean,
    bandSelectors: eeLit(["tropospheric_NO2_column_number_density"]),
  });
  return eeCall("Image.regexpRename", {
    input: selected,
    regex: eeLit(".*"),
    replacement: eeLit(bandName),
  });
}

/** Latest Sentinel-5P NO2 against a 90-day baseline, plus FIRMS centroids in the fire region. */
function satelliteExpression(city: CityConfig): EeValue {
  const end = utcDay(1);
  const latest = latestNo2(utcDay(-14), end);
  const baseline = meanNo2(utcDay(-90), end, "baseline");
  const stacked = eeCall("Image.addBands", {
    dstImg: latest,
    srcImg: eeCall("Image.addBands", {
      dstImg: baseline,
      srcImg: eeCall("Image.pixelLonLat", {}),
    }),
  });
  const { minLat, maxLat, minLng, maxLng } = city.bounds;
  const latKm = Math.abs(maxLat - minLat) * 111;
  const lngKm = Math.abs(maxLng - minLng) * 111;
  const numPixels = Math.min(80, Math.max(12, Math.round((latKm * lngKm) / 49)));
  const samples = eeCall("Image.sample", {
    image: stacked,
    region: eeRectangle(minLng, minLat, maxLng, maxLat),
    scale: eeLit(7000),
    numPixels: eeLit(numPixels),
    seed: eeLit(1),
    dropNulls: eeLit(true),
    geometries: eeLit(false),
  });
  const [fMinLng, fMinLat, fMaxLng, fMaxLat] = city.fireRegion.bounds;
  const firms = eeCall("ImageCollection.filterDate", {
    collection: eeCall("ImageCollection.load", { id: eeLit("FIRMS") }),
    start: eeLit(utcDay(-2)),
    end: eeLit(end),
  });
  const hot = eeCall("Image.selfMask", {
    image: eeCall("Image.gt", {
      image1: eeCall("Image.select", {
        input: eeCall("ImageCollection.mosaic", { collection: firms }),
        bandSelectors: eeLit(["T21"]),
      }),
      image2: eeCall("Image.constant", { value: eeLit(0) }),
    }),
  });
  const vectors = eeCall("Image.reduceToVectors", {
    image: hot,
    geometry: eeRectangle(fMinLng, fMinLat, fMaxLng, fMaxLat),
    scale: eeLit(2000),
    geometryType: eeLit("centroid"),
    eightConnected: eeLit(true),
    bestEffort: eeLit(true),
    maxPixels: eeLit(5_000_000),
    tileScale: eeLit(4),
  });
  const fireCoords = eeCall("Geometry.coordinates", {
    geometry: eeCall("FeatureCollection.geometry", { collection: vectors }),
  });
  return eeCall("Dictionary.fromLists", {
    keys: eeLit(["lng", "lat", "no2", "baseline", "fires"]),
    values: eeList([
      aggregate(samples, "longitude"),
      aggregate(samples, "latitude"),
      aggregate(samples, "no2"),
      aggregate(samples, "baseline"),
      fireCoords,
    ]),
  });
}

function finiteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function cellsFromSamples(lngs: unknown[], lats: unknown[], no2s: unknown[], baselines: unknown[]): SatelliteCell[] {
  const byHex = new Map<string, SatelliteCell>();
  const n = Math.min(lngs.length, lats.length, no2s.length, baselines.length);
  for (let i = 0; i < n; i++) {
    const lng = finiteNumber(lngs[i]);
    const lat = finiteNumber(lats[i]);
    const no2 = finiteNumber(no2s[i]);
    const baseline = finiteNumber(baselines[i]);
    if (lng == null || lat == null || no2 == null) continue;
    const anomaly = baseline != null && no2 > baseline;
    const h3 = latLngToH3({ lat, lng });
    const prev = byHex.get(h3);
    if (!prev) {
      byHex.set(h3, { h3, anomaly, no2 });
      continue;
    }
    byHex.set(h3, { h3, anomaly: prev.anomaly || anomaly, no2: Math.max(prev.no2 ?? no2, no2) });
  }
  return [...byHex.values()];
}

function firesFromCoords(cityId: string, coords: unknown, at: string): FirePoint[] {
  const points: Array<{ lat: number; lng: number }> = [];
  const push = (lng: unknown, lat: unknown) => {
    const x = finiteNumber(lng);
    const y = finiteNumber(lat);
    if (x == null || y == null) return;
    points.push({ lng: x, lat: y });
  };
  if (!Array.isArray(coords)) return [];
  const first = coords[0];
  if (coords.length >= 2 && !Array.isArray(first)) {
    push(coords[0], coords[1]);
  } else {
    for (const item of coords) {
      if (!Array.isArray(item) || item.length < 2) continue;
      if (!Array.isArray(item[0])) push(item[0], item[1]);
    }
  }
  return points.slice(0, 300).map((p, i) => ({
    id: `firms-${cityId}-${i}`,
    cityId,
    lat: p.lat,
    lng: p.lng,
    at,
  }));
}

async function earthEngineError(res: Response): Promise<string> {
  const text = await res.text();
  try {
    const body = JSON.parse(text) as { error?: { message?: string } };
    if (body.error?.message) return body.error.message;
  } catch {
    /* response was not JSON */
  }
  const trimmed = text.trim();
  return trimmed ? trimmed.slice(0, 500) : `earth_engine_${res.status}`;
}

export async function loadSatelliteContext(
  city: CityConfig,
  fixturesRoot: string,
  mode: "live" | "demo",
): Promise<{ cells: SatelliteCell[]; fires: FirePoint[]; status: string }> {
  if (mode === "demo") {
    try {
      const raw = await readFile(path.join(fixturesRoot, "satellite", `${city.id}.json`), "utf8");
      const parsed = JSON.parse(raw) as { cells?: SatelliteCell[]; fires?: FirePoint[] };
      return {
        cells: parsed.cells ?? [],
        fires: (parsed.fires ?? []).map((f) => ({ ...f, cityId: city.id })),
        status: "fixture",
      };
    } catch {
      return { cells: [], fires: [], status: "fixture_empty" };
    }
  }

  const key = process.env.FIREBASE_SERVICE_ACCOUNT_KEY?.trim();
  const project =
    process.env.EARTH_ENGINE_PROJECT_ID?.trim() || process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID?.trim();
  if (!key || !project) return { cells: [], fires: [], status: "not_configured" };

  try {
    const token = await googleAccessToken(key);
    const res = await fetch(`https://earthengine.googleapis.com/v1/projects/${project}/value:compute`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ expression: { result: "0", values: { "0": satelliteExpression(city) } } }),
      signal: AbortSignal.timeout(45_000),
    });
    if (!res.ok) return { cells: [], fires: [], status: await earthEngineError(res) };
    const body = (await res.json()) as { result?: unknown };
    const result = body.result;
    if (!result || typeof result !== "object" || Array.isArray(result)) {
      return { cells: [], fires: [], status: "earth_engine_empty" };
    }
    const record = result as Record<string, unknown>;
    const list = (value: unknown) => (Array.isArray(value) ? value : []);
    return {
      cells: cellsFromSamples(list(record.lng), list(record.lat), list(record.no2), list(record.baseline)),
      fires: firesFromCoords(city.id, record.fires, new Date().toISOString()),
      status: "ok",
    };
  } catch (err) {
    return { cells: [], fires: [], status: err instanceof Error ? err.message : "earth_engine_error" };
  }
}

function parseServiceAccount(raw: string): { client_email: string; private_key: string } {
  const trimmed = raw.trim().replace(/^["']|["']$/g, "");
  const json = trimmed.startsWith("{") ? trimmed : Buffer.from(trimmed, "base64").toString("utf8");
  const sa = JSON.parse(json) as { client_email?: string; private_key?: string };
  if (!sa.client_email || !sa.private_key) throw new Error("service account json missing client_email or private_key");
  return { client_email: sa.client_email, private_key: sa.private_key.replace(/\\n/g, "\n") };
}

export async function googleAccessToken(serviceAccountJson: string): Promise<string> {
  const sa = parseServiceAccount(serviceAccountJson);
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
  const claim = Buffer.from(
    JSON.stringify({
      iss: sa.client_email,
      scope: "https://www.googleapis.com/auth/earthengine https://www.googleapis.com/auth/cloud-platform",
      aud: "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600,
    }),
  ).toString("base64url");
  const { createSign } = await import("node:crypto");
  const sign = createSign("RSA-SHA256");
  sign.update(`${header}.${claim}`);
  const sig = sign.sign(sa.private_key).toString("base64url");
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${header}.${claim}.${sig}`,
    }),
  });
  if (!res.ok) throw new Error(`token ${res.status}`);
  const body = (await res.json()) as { access_token: string };
  return body.access_token;
}

export type OsmPlace = {
  id: string;
  name: string;
  kind: "landfill" | "industrial" | "terminal";
  lat: number;
  lng: number;
};

export async function fetchOsmPlaces(city: CityConfig): Promise<OsmPlace[]> {
  const { minLat, maxLat, minLng, maxLng } = city.bounds;
  const query = `[out:json][timeout:25];(node["landuse"="landfill"](${minLat},${minLng},${maxLat},${maxLng});node["landuse"="industrial"](${minLat},${minLng},${maxLat},${maxLng});node["amenity"="bus_station"](${minLat},${minLng},${maxLat},${maxLng}););out center 40;`;
  const res = await fetch("https://overpass-api.de/api/interpreter", {
    method: "POST",
    body: query,
    signal: AbortSignal.timeout(25_000),
  });
  if (!res.ok) throw new Error(`OSM ${res.status}`);
  const body = (await res.json()) as { elements?: Array<{ id: number; lat?: number; lon?: number; tags?: Record<string, string> }> };
  return (body.elements ?? [])
    .filter((el) => el.lat != null && el.lon != null)
    .map((el) => ({
      id: `osm-${el.id}`,
      name: el.tags?.name ?? el.tags?.landuse ?? "place",
      kind: el.tags?.landuse === "landfill" ? "landfill" : el.tags?.amenity === "bus_station" ? "terminal" : "industrial",
      lat: el.lat!,
      lng: el.lon!,
    }));
}

export async function fetchWind(lat: number, lng: number): Promise<number> {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current=wind_direction_10m`;
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) return 0;
  const body = (await res.json()) as { current?: { wind_direction_10m?: number } };
  return body.current?.wind_direction_10m ?? 0;
}

export function anomalyForPoint(
  cells: SatelliteCell[],
  lat: number,
  lng: number,
): boolean | null {
  if (cells.length === 0) return null;
  const h3 = latLngToH3({ lat, lng });
  const hit = cells.find((c) => c.h3 === h3);
  if (!hit) return false;
  return hit.anomaly;
}

export async function fetchModelledPm25(lat: number, lng: number): Promise<Array<{ at: string; pm25: number }>> {
  const key = process.env.GOOGLE_AIR_QUALITY_API_KEY?.trim();
  if (!key) return [];
  const res = await fetch(`https://airquality.googleapis.com/v1/history:lookup?key=${key}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      location: { latitude: lat, longitude: lng },
      hours: 24,
      pageSize: 24,
      universalAqi: true,
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) return [];
  const body = (await res.json()) as {
    hoursInfo?: Array<{ dateTime?: string; pollutants?: Array<{ code?: string; concentration?: { value?: number } }> }>;
  };
  const hours: Array<{ at: string; pm25: number }> = [];
  for (const hour of body.hoursInfo ?? []) {
    const pm = hour.pollutants?.find((p) => p.code === "pm25")?.concentration?.value;
    if (pm == null || !hour.dateTime) continue;
    hours.push({ at: hour.dateTime, pm25: pm });
  }
  return hours;
}

export type ArimaPoint = { at: string; pm25: number };

const ARIMA_MIN_POINTS = 24 * 7;

function bigQueryProject(): string | null {
  const project = process.env.BIGQUERY_PROJECT_ID?.trim() || process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID?.trim() || "";
  return /^[A-Za-z0-9][A-Za-z0-9_-]{0,62}$/.test(project) ? project : null;
}

function safeModelId(stationId: string): string {
  const cleaned = stationId.replace(/[^a-zA-Z0-9_]/g, "_").replace(/^([0-9])/, "m_$1");
  return (cleaned || "station").slice(0, 200);
}

/** Whether a station series can be sent to BigQuery ARIMA_PLUS. */
export function forecastTrainingStatus(historyLength: number): { eligible: boolean; reason: string } {
  if (historyLength < ARIMA_MIN_POINTS) {
    return { eligible: false, reason: "need_at_least_168_hourly_points" };
  }
  const project = bigQueryProject();
  const key = process.env.FIREBASE_SERVICE_ACCOUNT_KEY?.trim();
  if (!project || !key) return { eligible: false, reason: "missing_project_or_service_account" };
  return { eligible: true, reason: "ready" };
}

type BqBody = {
  jobComplete?: boolean;
  jobReference?: { jobId?: string; location?: string };
  schema?: { fields?: Array<{ name?: string }> };
  rows?: Array<{ f?: Array<{ v?: string | null }> }>;
  errors?: Array<{ message?: string }>;
};

async function bigQuery(project: string, token: string, query: string): Promise<BqBody | null> {
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  const res = await fetch(`https://bigquery.googleapis.com/bigquery/v2/projects/${project}/queries`, {
    method: "POST",
    headers,
    body: JSON.stringify({ query, useLegacySql: false, timeoutMs: 20000 }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) return null;
  let body = (await res.json()) as BqBody;
  const jobId = body.jobReference?.jobId;
  const location = body.jobReference?.location;
  for (let attempt = 0; attempt < 2 && body.jobComplete === false && jobId; attempt++) {
    const params = new URLSearchParams({ timeoutMs: "20000" });
    if (location) params.set("location", location);
    const poll = await fetch(
      `https://bigquery.googleapis.com/bigquery/v2/projects/${project}/queries/${jobId}?${params}`,
      { headers, signal: AbortSignal.timeout(30_000) },
    );
    if (!poll.ok) return null;
    body = (await poll.json()) as BqBody;
  }
  if (body.jobComplete === false || (body.errors?.length ?? 0) > 0) return null;
  return body;
}

function bqTimestamp(value: string | null | undefined, fallback: string): string {
  if (!value) return fallback;
  if (/^\d{4}-\d{2}-\d{2}/.test(value)) {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? new Date(parsed).toISOString() : fallback;
  }
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return new Date(n > 1e12 ? n : n * 1000).toISOString();
}

function forecastRows(body: BqBody): ArimaPoint[] | null {
  const fields = body.schema?.fields ?? [];
  const valueIdx = fields.findIndex((field) => field.name === "forecast_value");
  const timeIdx = fields.findIndex((field) => field.name === "forecast_timestamp");
  const points = (body.rows ?? []).flatMap((row, i) => {
    const cells = row.f ?? [];
    const pm25 = Number(valueIdx >= 0 ? cells[valueIdx]?.v : cells[0]?.v);
    if (!Number.isFinite(pm25)) return [];
    const fallback = new Date(Date.now() + (i + 1) * 3600_000).toISOString();
    return [{ at: bqTimestamp(timeIdx >= 0 ? cells[timeIdx]?.v : null, fallback), pm25 }];
  });
  return points.length ? points : null;
}

/** Train/predict is a BigQuery job. A short series or a failed job returns null. */
export async function arimaForecast(
  stationId: string,
  history: Array<{ observedAt: string; pm25: number }>,
): Promise<ArimaPoint[] | null> {
  if (!forecastTrainingStatus(history.length).eligible) return null;
  const project = bigQueryProject();
  const key = process.env.FIREBASE_SERVICE_ACCOUNT_KEY?.trim();
  if (!project || !key) return null;
  const rows = history
    .flatMap((point) => {
      const t = Date.parse(point.observedAt);
      if (!Number.isFinite(t) || !Number.isFinite(point.pm25)) return [];
      return [{ at: new Date(t).toISOString(), pm25: point.pm25 }];
    })
    .sort((a, b) => a.at.localeCompare(b.at));
  if (rows.length < ARIMA_MIN_POINTS) return null;
  const model = `${project}.air.arima_${safeModelId(stationId)}`;
  const structs = rows
    .map((row) => `STRUCT(TIMESTAMP('${row.at}') AS time_series_timestamp, ${row.pm25} AS time_series_data)`)
    .join(",");
  const createSql = `CREATE OR REPLACE MODEL \`${model}\` OPTIONS(model_type='ARIMA_PLUS') AS SELECT time_series_timestamp, time_series_data FROM UNNEST([${structs}]) ORDER BY time_series_timestamp`;
  const forecastSql = `SELECT * FROM ML.FORECAST(MODEL \`${model}\`, STRUCT(24 AS horizon))`;
  try {
    const token = await googleAccessToken(key);
    const created = await bigQuery(project, token, createSql);
    if (!created) return null;
    const forecast = await bigQuery(project, token, forecastSql);
    if (!forecast) return null;
    return forecastRows(forecast);
  } catch {
    return null;
  }
}
