import { mkdir, readFile, stat, utimes, writeFile } from "node:fs/promises";
import path from "node:path";

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

export function windPath(dataDir: string): string {
  return path.join(dataDir, "wind", "latest.json");
}

async function ageMs(file: string, now: number): Promise<number | null> {
  try {
    const info = await stat(file);
    return now - info.mtimeMs;
  } catch {
    return null;
  }
}

export async function readWindGrid(dataDir: string, samplePath: string): Promise<WindGrid> {
  try {
    return JSON.parse(await readFile(windPath(dataDir), "utf8")) as WindGrid;
  } catch {
    return JSON.parse(await readFile(samplePath, "utf8")) as WindGrid;
  }
}

type LiveFetch = () => Promise<WindCell[]>;

export async function fetchOpenMeteoWind(): Promise<WindCell[]> {
  const cells: Array<{ lat: number; lng: number }> = [];
  // 20° grid (~126 points) balances flow detail against Open-Meteo request size.
  for (let lat = -60; lat <= 60; lat += 20) {
    for (let lng = -180; lng < 180; lng += 20) cells.push({ lat, lng });
  }
  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.searchParams.set("latitude", cells.map((cell) => cell.lat).join(","));
  url.searchParams.set("longitude", cells.map((cell) => cell.lng).join(","));
  url.searchParams.set("current", "wind_speed_10m,wind_direction_10m");
  const res = await fetch(url, { signal: AbortSignal.timeout(25_000) });
  if (!res.ok) throw new Error(`open-meteo wind ${res.status}`);
  const body = (await res.json()) as unknown;
  const rows = Array.isArray(body) ? body : [body];
  return cells.map((cell, index) => {
    const current = (rows[index] as { current?: { wind_speed_10m?: number; wind_direction_10m?: number } } | undefined)?.current ?? {};
    const speed = typeof current.wind_speed_10m === "number" ? current.wind_speed_10m : 0;
    const from = typeof current.wind_direction_10m === "number" ? current.wind_direction_10m : 0;
    return { ...cell, ...uvFromSpeedDirection(speed, from) };
  });
}

export async function refreshWindGrid(opts: {
  dataDir: string;
  samplePath: string;
  now?: number;
  fetchGrid?: LiveFetch;
}): Promise<{ source: WindGrid["source"]; cells: number }> {
  const now = opts.now ?? Date.now();
  const file = windPath(opts.dataDir);
  const age = await ageMs(file, now);
  if (age != null && age < WIND_TTL_MS) {
    const saved = JSON.parse(await readFile(file, "utf8")) as WindGrid;
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
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(grid));
  await utimes(file, now / 1000, now / 1000);
  return { source: grid.source, cells: grid.cells.length };
}
