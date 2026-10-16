import { haversineKm, percentile } from "./geo.js";
import { POOR_THRESHOLD } from "./indiaAqi.js";
import type { LatLng } from "./types.js";

export const WARD_JOIN_MAX_KM = 15;

export type WardInput = {
  id: string;
  name: string;
  population: number;
  centroid: LatLng;
};

export type StationForJoin = {
  id: string;
  lat: number;
  lng: number;
  aqi: number | null;
  online: boolean;
};

export type JoinedWard = WardInput & {
  nearestStationId: string | null;
  distanceKm: number | null;
  aqi: number | null;
  covered: boolean;
  unhealthy: boolean;
};

export type WardBurdenSummary = {
  peopleInPoor: number;
  coveredPopulation: number;
  uncoveredPopulation: number;
  shareInPoor: number | null;
  topWards: Array<{ id: string; name: string; aqi: number }>;
  bottomWards: Array<{ id: string; name: string; aqi: number }>;
  equity: { p90: number | null; p10: number | null; ratio: number | null };
};

export function joinWardToStation(
  ward: WardInput,
  stations: StationForJoin[],
  unhealthyAt = POOR_THRESHOLD,
): JoinedWard {
  const live = stations.filter((s) => s.online && s.aqi != null);
  let best: { station: StationForJoin; km: number } | null = null;
  for (const s of live) {
    const km = haversineKm(ward.centroid, { lat: s.lat, lng: s.lng });
    if (km > WARD_JOIN_MAX_KM) continue;
    if (!best || km < best.km) best = { station: s, km };
  }
  if (!best) {
    return {
      ...ward,
      nearestStationId: null,
      distanceKm: null,
      aqi: null,
      covered: false,
      unhealthy: false,
    };
  }
  const aqi = best.station.aqi!;
  return {
    ...ward,
    nearestStationId: best.station.id,
    distanceKm: Number(best.km.toFixed(2)),
    aqi,
    covered: true,
    unhealthy: aqi >= unhealthyAt,
  };
}

export function summarizeWardBurden(wards: JoinedWard[]): WardBurdenSummary {
  let peopleInPoor = 0;
  let coveredPopulation = 0;
  let uncoveredPopulation = 0;
  const covered = wards.filter((w) => w.covered && w.aqi != null);

  for (const w of wards) {
    if (!w.covered) {
      uncoveredPopulation += w.population;
      continue;
    }
    coveredPopulation += w.population;
    if (w.unhealthy) peopleInPoor += w.population;
  }

  const byAqi = [...covered].sort((a, b) => (b.aqi ?? 0) - (a.aqi ?? 0));
  const topWards = byAqi.slice(0, 5).map((w) => ({ id: w.id, name: w.name, aqi: w.aqi! }));
  const bottomWards = [...byAqi]
    .reverse()
    .slice(0, 5)
    .map((w) => ({ id: w.id, name: w.name, aqi: w.aqi! }));

  const aqis = covered.map((w) => w.aqi!);
  const p90 = percentile(aqis, 90);
  const p10 = percentile(aqis, 10);
  const ratio = p90 != null && p10 != null && p10 > 0 ? Number((p90 / p10).toFixed(2)) : null;

  return {
    peopleInPoor,
    coveredPopulation,
    uncoveredPopulation,
    shareInPoor: coveredPopulation > 0 ? peopleInPoor / coveredPopulation : null,
    topWards,
    bottomWards,
    equity: { p90, p10, ratio },
  };
}
