import { latLngToCell, cellToLatLng, gridDisk, isValidCell } from "h3-js";
import type { LatLng } from "./types.js";

/** Neighbourhood hex resolution (~0.7 km²). */
export const H3_RESOLUTION = 8;

export function latLngToH3(point: LatLng, resolution = H3_RESOLUTION): string {
  return latLngToCell(point.lat, point.lng, resolution);
}

export function h3ToLatLng(h3: string): LatLng {
  if (!isValidCell(h3)) throw new Error("bad_h3");
  const [lat, lng] = cellToLatLng(h3);
  return { lat, lng };
}

export function h3Neighbors(h3: string, k = 1): string[] {
  return gridDisk(h3, k);
}
