import { readFile } from "node:fs/promises";
import type { ObjectStore } from "./objectStore.js";

const WIND_KEY = "wind/latest.json";

export const WIND_TTL_MS = 6 * 60 * 60 * 1000;

export type WindCell = { lat: number; lng: number; u: number; v: number };
export type WindGrid = { at: string; source: "sample" | "open-meteo" | "cached"; cells: WindCell[] };

/** Meteorological direction is where the wind comes from. u is eastward, v is northward, m/s. */
export function uvFromSpeedDirection(speed: number, fromDeg: number): { u: number; v: number } {
  const rad = (fromDeg * Math.PI) / 180;
  return { u: -speed * Math.sin(rad), v: -speed * Math.cos(rad) };
}

export function sampleWind(grid: WindGrid, lat: number, lng: number): { u: number; v: number } {
  let best = grid.cells[0];
  let bestD = Infinity;
  const wrapped = ((lng + 180) % 360 + 360) % 360 - 180;
  for (const cell of grid.cells) {
    const dLat = cell.lat - lat;
    let dLng = cell.lng - wrapped;
    if (dLng > 180) dLng -= 360;
    if (dLng < -180) dLng += 360;
    const d = dLat * dLat + dLng * dLng;
    if (d < bestD) {
      best = cell;
      bestD = d;
    }
  }
  return { u: best?.u ?? 0, v: best?.v ?? 0 };
}

export async function readWindGrid(objects: ObjectStore, samplePath: string): Promise<WindGrid> {
  const saved = await objects.get(WIND_KEY);
  if (saved) return JSON.parse(saved.toString("utf8")) as WindGrid;
  return JSON.parse(await readFile(samplePath, "utf8")) as WindGrid;
}

type LiveFetch = () => Promise<WindCell[]>;

type OpenMeteoRow = { current?: { wind_speed_10m?: number; wind_direction_10m?: number } };

async function fetchChunk(chunk: Array<{ lat: number; lng: number }>): Promise<OpenMeteoRow[]> {
  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.searchParams.set("latitude", chunk.map((cell) => cell.lat).join(","));
  url.searchParams.set("longitude", chunk.map((cell) => cell.lng).join(","));
  url.searchParams.set("current", "wind_speed_10m,wind_direction_10m");
  url.searchParams.set("wind_speed_unit", "ms");
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, { signal: AbortSignal.timeout(25_000) });
    if (res.ok) {
      const body = (await res.json()) as unknown;
      return (Array.isArray(body) ? body : [body]) as OpenMeteoRow[];
    }
    if (attempt >= 2) throw new Error(`open-meteo wind ${res.status}`);
    await new Promise((resolve) => setTimeout(resolve, 2_000 * (attempt + 1)));
  }
}

export async function fetchOpenMeteoWind(): Promise<WindCell[]> {
  const cells: Array<{ lat: number; lng: number }> = [];
  // 10° grid, 540 points: under Open-Meteo's 600 locations/min free tier, dense enough
  // for the client to interpolate a smooth flow. Poles clamp to the outermost row.
  for (let lat = -70; lat <= 70; lat += 10) {
    for (let lng = -180; lng < 180; lng += 10) cells.push({ lat, lng });
  }
  const out: WindCell[] = [];
  const CHUNK = 90;
  for (let i = 0; i < cells.length; i += CHUNK) {
    const chunk = cells.slice(i, i + CHUNK);
    const rows = await fetchChunk(chunk);
    chunk.forEach((cell, index) => {
      const current = rows[index]?.current ?? {};
      const speed = typeof current.wind_speed_10m === "number" ? current.wind_speed_10m : 0;
      const from = typeof current.wind_direction_10m === "number" ? current.wind_direction_10m : 0;
      out.push({ ...cell, ...uvFromSpeedDirection(speed, from) });
    });
  }
  return out;
}

export async function refreshWindGrid(opts: {
  objects: ObjectStore;
  samplePath: string;
  now?: number;
  fetchGrid?: LiveFetch;
}): Promise<{ source: WindGrid["source"]; cells: number }> {
  const now = opts.now ?? Date.now();
  const info = await opts.objects.stat(WIND_KEY);
  if (info && now - info.updatedAt.getTime() < WIND_TTL_MS) {
    const saved = JSON.parse((await opts.objects.get(WIND_KEY))!.toString("utf8")) as WindGrid;
    return { source: "cached", cells: saved.cells.length };
  }
  let grid: WindGrid;
  try {
    const cells = await (opts.fetchGrid ?? fetchOpenMeteoWind)();
    if (cells.length === 0) throw new Error("empty wind");
    grid = { at: new Date(now).toISOString(), source: "open-meteo", cells };
  } catch {
    grid = JSON.parse(await readFile(opts.samplePath, "utf8")) as WindGrid;
    grid = { ...grid, at: new Date(now).toISOString(), source: "sample" };
  }
  await opts.objects.put(WIND_KEY, Buffer.from(JSON.stringify(grid)), "application/json");
  return { source: grid.source, cells: grid.cells.length };
}
