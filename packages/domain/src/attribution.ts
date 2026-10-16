import { haversineKm } from "./geo.js";
import type { LatLng } from "./types.js";

export type UpwindCandidate = {
  id: string;
  name: string;
  kind: "landfill" | "industrial" | "terminal" | "fire" | "incident";
  lat: number;
  lng: number;
};

export type RankedSource = UpwindCandidate & {
  distanceKm: number;
  alignment: number;
};

/**
 * Wind direction is meteorological (where the wind comes from, degrees).
 * Alignment is 1 when the candidate sits directly upwind of the hotspot.
 */
export function rankUpwind(
  hotspot: LatLng,
  windFromDeg: number,
  candidates: UpwindCandidate[],
): RankedSource[] {
  const from = (windFromDeg * Math.PI) / 180;
  const ranked: RankedSource[] = [];
  for (const c of candidates) {
    const distanceKm = haversineKm(hotspot, { lat: c.lat, lng: c.lng });
    if (distanceKm < 0.05 || distanceKm > 30) continue;
    const bearing = bearingRad(hotspot, { lat: c.lat, lng: c.lng });
    const diff = Math.atan2(Math.sin(bearing - from), Math.cos(bearing - from));
    const alignment = Math.max(0, Math.cos(diff));
    ranked.push({ ...c, distanceKm: Number(distanceKm.toFixed(2)), alignment: Number(alignment.toFixed(3)) });
  }
  return ranked.sort((a, b) => b.alignment - a.alignment || a.distanceKm - b.distanceKm).slice(0, 8);
}

function bearingRad(from: LatLng, to: LatLng): number {
  const φ1 = (from.lat * Math.PI) / 180;
  const φ2 = (to.lat * Math.PI) / 180;
  const Δλ = ((to.lng - from.lng) * Math.PI) / 180;
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return Math.atan2(y, x);
}
