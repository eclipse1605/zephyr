import { usAqiToConcentration, PM25_BREAKPOINTS, PM10_BREAKPOINTS } from "./usAqi.js";
import type { PollutantReadings, StationReading, StationSource } from "./types.js";

export type OpenAqSensorRow = {
  id?: number;
  parameter?: { name?: string };
  latest?: { value?: number; datetime?: { utc?: string } };
  datetimeLast?: { utc?: string };
};

export type OpenAqLatestRow = {
  sensorsId?: number;
  value?: number;
  datetime?: { utc?: string };
};

/** Map OpenAQ parameter name → Zephyr pollutant fields (µg/m³ or ppm as returned). */
export function applyOpenAqParameterName(pollutants: PollutantReadings, parameterName: string, value: number): void {
  const name = parameterName.toLowerCase();
  if (name === "pm25" || name === "pm2.5") pollutants.pm25 = value;
  else if (name === "pm10") pollutants.pm10 = value;
  else if (name === "no2") pollutants.no2 = value;
  else if (name === "so2") pollutants.so2 = value;
  else if (name === "co") pollutants.co = value;
  else if (name === "o3" || name === "ozone") pollutants.ozone = value;
}

export function openAqPollutantsUsable(pollutants: PollutantReadings): boolean {
  return (
    pollutants.pm25 != null ||
    pollutants.pm10 != null ||
    pollutants.no2 != null ||
    pollutants.so2 != null ||
    pollutants.co != null ||
    pollutants.ozone != null
  );
}

function maxIso(a: string | null, b: string | undefined): string | null {
  if (!b) return a;
  if (!a) return b;
  return Date.parse(b) > Date.parse(a) ? b : a;
}

/** Sensors from GET /v3/locations/{id}/sensors (each row may include `latest`). */
export function pollutantsFromOpenAqSensors(sensors: OpenAqSensorRow[]): {
  pollutants: PollutantReadings;
  lastSeen: string | null;
} {
  const pollutants: PollutantReadings = {};
  let lastSeen: string | null = null;
  for (const sensor of sensors) {
    const paramName = sensor.parameter?.name;
    const value = sensor.latest?.value;
    if (!paramName || value == null || !Number.isFinite(value)) continue;
    applyOpenAqParameterName(pollutants, paramName, value);
    lastSeen = maxIso(lastSeen, sensor.latest?.datetime?.utc ?? sensor.datetimeLast?.utc);
  }
  return { pollutants, lastSeen };
}

/** Latest rows plus sensor id → parameter map from the sensors list. */
export function pollutantsFromOpenAqLatestRows(
  latestRows: OpenAqLatestRow[],
  parameterBySensorId: Map<number, string>,
): { pollutants: PollutantReadings; lastSeen: string | null } {
  const pollutants: PollutantReadings = {};
  let lastSeen: string | null = null;
  for (const row of latestRows) {
    const sensorId = row.sensorsId;
    const value = row.value;
    if (sensorId == null || value == null || !Number.isFinite(value)) continue;
    const paramName = parameterBySensorId.get(sensorId);
    if (!paramName) continue;
    applyOpenAqParameterName(pollutants, paramName, value);
    lastSeen = maxIso(lastSeen, row.datetime?.utc);
  }
  return { pollutants, lastSeen };
}

export type FeedResult = {
  source: StationSource;
  readings: StationReading[];
  error: string | null;
};

/** WAQI map/bounds or city payload → station readings. AQI is converted to PM concentrations. */
export function parseWaqiStations(
  body: unknown,
  cityId: string,
  nowIso: string = new Date().toISOString(),
): StationReading[] {
  const data = (body as { data?: unknown })?.data;
  const rows = Array.isArray(data) ? data : [];
  const out: StationReading[] = [];
  for (const row of rows) {
    const rec = row as {
      uid?: number | string;
      aqi?: string | number;
      lat?: number;
      lon?: number;
      station?: { name?: string };
    };
    const lat = rec.lat;
    const lng = rec.lon;
    if (typeof lat !== "number" || typeof lng !== "number") continue;
    const aqiNum = typeof rec.aqi === "number" ? rec.aqi : Number(rec.aqi);
    const pollutants: PollutantReadings = {};
    if (Number.isFinite(aqiNum)) {
      pollutants.pm25 = usAqiToConcentration(aqiNum, PM25_BREAKPOINTS);
      pollutants.pm10 = usAqiToConcentration(aqiNum, PM10_BREAKPOINTS);
    }
    out.push({
      id: `waqi-${rec.uid ?? `${lat},${lng}`}`,
      name: rec.station?.name ?? `WAQI ${lat},${lng}`,
      cityId,
      lat,
      lng,
      sourceFeed: "waqi",
      lastSeen: nowIso,
      pollutants,
    });
  }
  return out;
}

/** Parse CPCB `last_update` (often `DD-MM-YYYY HH:mm:ss`, IST) to ISO UTC. */
export function parseCpcbLastUpdate(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed || trimmed === "NA" || trimmed === "N/A" || trimmed === "-") return null;
  const dmy = trimmed.match(/^(\d{2})-(\d{2})-(\d{4})\s+(\d{2}):(\d{2}):(\d{2})$/);
  if (dmy) {
    const [, dd, mm, yyyy, hh, min, sec] = dmy;
    const iso = new Date(`${yyyy}-${mm}-${dd}T${hh}:${min}:${sec}+05:30`);
    return Number.isFinite(iso.getTime()) ? iso.toISOString() : null;
  }
  const parsed = Date.parse(trimmed);
  if (Number.isFinite(parsed)) return new Date(parsed).toISOString();
  return null;
}

type CpcbAggregate = {
  station: string;
  lat: number;
  lng: number;
  lastSeen: string | null;
  sourceAqi: number;
  sourceDominant: string | null;
};

function cpcbPollutantName(rec: Record<string, string | number | undefined>): string | null {
  const raw = rec.pollutant_id ?? rec.pollutant_name ?? rec.pollutant;
  if (raw == null) return null;
  const name = String(raw).trim();
  return name && name !== "NA" && name !== "N/A" && name !== "-" ? name : null;
}

/**
 * data.gov.in CPCB AQI API: one row per station × pollutant.
 * `pollutant_avg` is an AQI sub-index (not µg/m³); station AQI = max sub-index.
 */
export function parseCpcbRecords(body: unknown, cityId: string): StationReading[] {
  const records =
    (body as { records?: unknown[] })?.records ??
    (body as { data?: unknown[] })?.data ??
    [];
  const byStation = new Map<string, CpcbAggregate>();

  for (const row of records) {
    const rec = row as Record<string, string | number | undefined>;
    const lat = num(rec.latitude ?? rec.lat);
    const lng = num(rec.longitude ?? rec.lng ?? rec.lon);
    if (lat == null || lng == null) continue;
    const station = String(rec.station ?? rec.station_name ?? "CPCB");
    const key = `${station}|${lat}|${lng}`;
    const subIndex = recordNum(rec, "pollutant_avg", "avg_value", "pollutant_max", "max_value");
    const stamp = parseCpcbLastUpdate(String(rec.last_update ?? rec.lastUpdate ?? ""));
    const dominant = cpcbPollutantName(rec);
    const existing = byStation.get(key);
    if (!existing) {
      byStation.set(key, {
        station,
        lat,
        lng,
        lastSeen: stamp,
        sourceAqi: subIndex ?? 0,
        sourceDominant: subIndex != null ? dominant : null,
      });
      continue;
    }
    if (stamp && (!existing.lastSeen || Date.parse(stamp) > Date.parse(existing.lastSeen))) {
      existing.lastSeen = stamp;
    }
    if (subIndex != null && subIndex > existing.sourceAqi) {
      existing.sourceAqi = subIndex;
      existing.sourceDominant = dominant ?? existing.sourceDominant;
    }
  }

  return [...byStation.values()].map((agg) => ({
    id: `cpcb-${agg.station}-${agg.lat.toFixed(4)}-${agg.lng.toFixed(4)}`,
    name: agg.station,
    cityId,
    lat: agg.lat,
    lng: agg.lng,
    owner: "CPCB",
    sourceFeed: "cpcb",
    lastSeen: agg.lastSeen ?? "",
    pollutants: {},
    sourceAqi: agg.sourceAqi > 0 ? agg.sourceAqi : null,
    sourceDominant: agg.sourceDominant,
  }));
}

function num(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed || trimmed === "NA" || trimmed === "N/A" || trimmed === "-") return null;
    if (Number.isFinite(Number(trimmed))) return Number(trimmed);
  }
  return null;
}

function recordNum(rec: Record<string, string | number | undefined>, ...keys: string[]): number | null {
  const lower = new Map(Object.entries(rec).map(([k, v]) => [k.toLowerCase(), v]));
  for (const key of keys) {
    const n = num(lower.get(key.toLowerCase()));
    if (n != null) return n;
  }
  return null;
}
