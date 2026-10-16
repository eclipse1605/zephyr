import { usAqiToConcentration, PM25_BREAKPOINTS, PM10_BREAKPOINTS } from "./usAqi.js";
import type { PollutantReadings, StationReading, StationSource } from "./types.js";

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

/** data.gov.in CPCB records → station readings. Concentrations are already µg/m³. */
export function parseCpcbRecords(body: unknown, cityId: string): StationReading[] {
  const records =
    (body as { records?: unknown[] })?.records ??
    (body as { data?: unknown[] })?.data ??
    [];
  const out: StationReading[] = [];
  for (const row of records) {
    const rec = row as Record<string, string | number | undefined>;
    const lat = num(rec.latitude ?? rec.lat);
    const lng = num(rec.longitude ?? rec.lng ?? rec.lon);
    if (lat == null || lng == null) continue;
    const pollutants: PollutantReadings = {
      pm25: num(rec.pm25 ?? rec.pm2_5 ?? rec["pollutant_avg"]),
      pm10: num(rec.pm10),
      no2: num(rec.no2),
      so2: num(rec.so2),
    };
    const stamp = String(rec.last_update ?? rec.lastUpdate ?? new Date().toISOString());
    out.push({
      id: `cpcb-${rec.station ?? rec.id ?? `${lat},${lng}`}`,
      name: String(rec.station ?? rec.station_name ?? "CPCB"),
      cityId,
      lat,
      lng,
      owner: "CPCB",
      sourceFeed: "cpcb",
      lastSeen: stamp,
      pollutants,
    });
  }
  return out;
}

function num(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return null;
}
