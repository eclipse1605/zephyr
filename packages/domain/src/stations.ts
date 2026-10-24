import { haversineKm } from "./geo.js";
import { aqiBand, indiaAqiFromReadings, unhealthyThreshold } from "./indiaAqi.js";
import { usAqiFromReadings } from "./usAqi.js";
import type { AqiScale, StationReading, StationSource } from "./types.js";

export const STATION_FRESHNESS_MS = 24 * 60 * 60 * 1000;
export const STATION_DEDUPE_KM = 0.25;

const FEED_RANK: Record<StationSource, number> = {
  openaq: 0,
  waqi: 1,
  cpcb: 2,
};

export function isStationOnline(lastSeenIso: string, now: Date = new Date()): boolean {
  const t = Date.parse(lastSeenIso);
  if (!Number.isFinite(t)) return false;
  return now.getTime() - t <= STATION_FRESHNESS_MS;
}

export type MergedStation = StationReading & {
  online: boolean;
  aqi: number | null;
  dominantPollutant: string | null;
  band: string | null;
};

export function enrichStation(
  reading: StationReading,
  scale: AqiScale,
  now: Date = new Date(),
): MergedStation {
  const online = isStationOnline(reading.lastSeen, now);
  const computed =
    scale === "india" ? indiaAqiFromReadings(reading.pollutants) : usAqiFromReadings(reading.pollutants);
  const fromSource =
    online &&
    !computed &&
    reading.sourceAqi != null &&
    Number.isFinite(reading.sourceAqi) &&
    reading.sourceFeed === "cpcb"
      ? {
          aqi: Math.round(reading.sourceAqi),
          dominant: reading.sourceDominant?.trim() || "CPCB",
          band: scale === "india" ? aqiBand(Math.round(reading.sourceAqi)) : null,
        }
      : null;
  const resolved = computed ?? fromSource;
  return {
    ...reading,
    online,
    aqi: online && resolved ? resolved.aqi : null,
    dominantPollutant: online && resolved ? resolved.dominant : null,
    band: online && resolved ? resolved.band : null,
  };
}

/** Collapse stations within 250 m; prefer newer live, then OpenAQ → WAQI → CPCB. */
export function mergeStations(readings: StationReading[], scale: AqiScale, now: Date = new Date()): MergedStation[] {
  const enriched = readings.map((r) => enrichStation(r, scale, now));
  const kept: MergedStation[] = [];

  for (const candidate of enriched) {
    const matchIdx = kept.findIndex(
      (k) => haversineKm({ lat: k.lat, lng: k.lng }, { lat: candidate.lat, lng: candidate.lng }) <= STATION_DEDUPE_KM,
    );
    if (matchIdx < 0) {
      kept.push(candidate);
      continue;
    }
    const existing = kept[matchIdx]!;
    kept[matchIdx] = preferStation(existing, candidate);
  }
  return kept;
}

function preferStation(a: MergedStation, b: MergedStation): MergedStation {
  if (a.online !== b.online) return a.online ? a : b;
  const aHas = a.aqi != null;
  const bHas = b.aqi != null;
  if (aHas !== bHas) return aHas ? a : b;
  const aTime = Date.parse(a.lastSeen);
  const bTime = Date.parse(b.lastSeen);
  const aOk = Number.isFinite(aTime);
  const bOk = Number.isFinite(bTime);
  if (aOk !== bOk) return aOk ? a : b;
  if (aOk && aTime !== bTime) return bTime > aTime ? b : a;
  return FEED_RANK[a.sourceFeed] <= FEED_RANK[b.sourceFeed] ? a : b;
}

export function stationOverLimit(
  pollutants: StationReading["pollutants"],
  standards: { pm25: number; pm10: number },
  aqi?: number | null,
  scale?: AqiScale,
): boolean {
  if (pollutants.pm25 != null && pollutants.pm25 > standards.pm25) return true;
  if (pollutants.pm10 != null && pollutants.pm10 > standards.pm10) return true;
  if (aqi != null && scale && aqi >= unhealthyThreshold(scale)) return true;
  return false;
}
