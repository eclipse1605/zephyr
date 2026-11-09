import { mkdir, readFile, stat, utimes, writeFile } from "node:fs/promises";
import path from "node:path";
import { deflateSync } from "node:zlib";
import { crc32 } from "node:zlib";
import { PM25_BREAKPOINTS, concentrationToUsAqi, usAqiFromReadings } from "@zephyr/domain";

export const RASTER_MAX_ZOOM = 8;
export const MODEL_TTL_MS = 60 * 60 * 1000;

export type ModelReading = {
  pm25: number | null;
  pm10: number | null;
  no2: number | null;
  ozone: number | null;
  so2: number | null;
  co: number | null;
};

export type RasterLayer = "aqi" | "pm25";
export type GridFetch = (samples: Array<{ lat: number; lng: number }>) => Promise<ModelReading[]>;

const EMPTY: ModelReading = { pm25: null, pm10: null, no2: null, ozone: null, so2: null, co: null };

export function tileLng(z: number, x: number): number {
  return (x / 2 ** z) * 360 - 180;
}

export function tileLat(z: number, y: number): number {
  const n = Math.PI - (2 * Math.PI * y) / 2 ** z;
  return (180 / Math.PI) * Math.atan(Math.sinh(n));
}

export function tileSamples(z: number, x: number, y: number, cells = 4): Array<{ lat: number; lng: number }> {
  const west = tileLng(z, x);
  const east = tileLng(z, x + 1);
  const north = tileLat(z, y);
  const south = tileLat(z, y + 1);
  const samples: Array<{ lat: number; lng: number }> = [];
  for (let row = 0; row < cells; row++) {
    for (let col = 0; col < cells; col++) {
      samples.push({
        lng: west + ((col + 0.5) / cells) * (east - west),
        lat: north + ((row + 0.5) / cells) * (south - north),
      });
    }
  }
  return samples;
}

export function modelAqi(reading: ModelReading): number | null {
  return usAqiFromReadings({
    pm25: reading.pm25,
    pm10: reading.pm10,
    no2: reading.no2,
    so2: reading.so2,
    co: reading.co,
    ozone: reading.ozone,
  })?.aqi ?? null;
}

export function rasterColor(layer: RasterLayer, reading: ModelReading): [number, number, number, number] {
  const aqi = layer === "pm25"
    ? concentrationToUsAqi(reading.pm25, PM25_BREAKPOINTS)
    : modelAqi(reading);
  if (aqi == null) return [40, 48, 56, 0];
  if (aqi <= 50) return [0, 180, 70, 150];
  if (aqi <= 100) return [230, 200, 40, 160];
  if (aqi <= 150) return [230, 120, 20, 170];
  if (aqi <= 200) return [210, 40, 40, 180];
  if (aqi <= 300) return [140, 50, 150, 185];
  return [110, 0, 40, 190];
}

function pngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body) >>> 0);
  return Buffer.concat([len, body, crc]);
}

export function encodeRgbaPng(width: number, height: number, rgba: Buffer): Buffer {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(raw)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

function paintTile(layer: RasterLayer, readings: ModelReading[], cells = 4): Buffer {
  const size = 256;
  const block = size / cells;
  const rgba = Buffer.alloc(size * size * 4);
  for (let row = 0; row < cells; row++) {
    for (let col = 0; col < cells; col++) {
      const [r, g, b, a] = rasterColor(layer, readings[row * cells + col] ?? EMPTY);
      for (let py = 0; py < block; py++) {
        for (let px = 0; px < block; px++) {
          const i = ((row * block + py) * size + col * block + px) * 4;
          rgba[i] = r;
          rgba[i + 1] = g;
          rgba[i + 2] = b;
          rgba[i + 3] = a;
        }
      }
    }
  }
  return encodeRgbaPng(size, size, rgba);
}

async function fresh(file: string, now: number): Promise<boolean> {
  try {
    const info = await stat(file);
    return now - info.mtimeMs < MODEL_TTL_MS;
  } catch {
    return false;
  }
}

export async function fetchOpenMeteoGrid(samples: Array<{ lat: number; lng: number }>): Promise<ModelReading[]> {
  const url = new URL("https://air-quality-api.open-meteo.com/v1/air-quality");
  url.searchParams.set("latitude", samples.map((sample) => sample.lat.toFixed(3)).join(","));
  url.searchParams.set("longitude", samples.map((sample) => sample.lng.toFixed(3)).join(","));
  url.searchParams.set("current", "pm2_5,pm10,nitrogen_dioxide,ozone,sulphur_dioxide,carbon_monoxide");
  const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`open-meteo ${res.status}`);
  const body = (await res.json()) as unknown;
  const rows = Array.isArray(body) ? body : [body];
  return samples.map((_, index) => readingFrom(rows[index]));
}

function readingFrom(row: unknown): ModelReading {
  const current = (row as { current?: Record<string, number | null> } | undefined)?.current ?? {};
  const num = (key: string) => (typeof current[key] === "number" ? current[key] : null);
  return {
    pm25: num("pm2_5"),
    pm10: num("pm10"),
    no2: num("nitrogen_dioxide"),
    ozone: num("ozone"),
    so2: num("sulphur_dioxide"),
    co: num("carbon_monoxide"),
  };
}

export async function cachedModelTile(opts: {
  layer: RasterLayer;
  z: number;
  x: number;
  y: number;
  cacheDir: string;
  now?: number;
  fetchGrid?: GridFetch;
}): Promise<{ png: Buffer; cached: boolean }> {
  if (!Number.isInteger(opts.z) || opts.z < 0 || opts.z > RASTER_MAX_ZOOM) throw new Error("zoom");
  const limit = 2 ** opts.z;
  if (!Number.isInteger(opts.x) || !Number.isInteger(opts.y) || opts.x < 0 || opts.y < 0 || opts.x >= limit || opts.y >= limit) {
    throw new Error("tile");
  }
  const now = opts.now ?? Date.now();
  const file = path.join(opts.cacheDir, opts.layer, String(opts.z), String(opts.x), `${opts.y}.png`);
  if (await fresh(file, now)) return { png: await readFile(file), cached: true };
  const samples = tileSamples(opts.z, opts.x, opts.y);
  const readings = await (opts.fetchGrid ?? fetchOpenMeteoGrid)(samples);
  const png = paintTile(opts.layer, readings);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, png);
  await utimes(file, now / 1000, now / 1000);
  return { png, cached: false };
}

export async function cachedModelPoint(opts: {
  lat: number;
  lng: number;
  cacheDir: string;
  now?: number;
  fetchGrid?: GridFetch;
}): Promise<ModelReading & { aqi: number | null; cached: boolean }> {
  if (!Number.isFinite(opts.lat) || !Number.isFinite(opts.lng) || Math.abs(opts.lat) > 90 || Math.abs(opts.lng) > 180) {
    throw new Error("point");
  }
  const now = opts.now ?? Date.now();
  const key = `${opts.lat.toFixed(1)},${opts.lng.toFixed(1)}`;
  const file = path.join(opts.cacheDir, "points", `${key}.json`);
  if (await fresh(file, now)) {
    const saved = JSON.parse(await readFile(file, "utf8")) as ModelReading;
    return { ...saved, aqi: modelAqi(saved), cached: true };
  }
  const [reading] = await (opts.fetchGrid ?? fetchOpenMeteoGrid)([{ lat: opts.lat, lng: opts.lng }]);
  const value = reading ?? EMPTY;
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(value));
  await utimes(file, now / 1000, now / 1000);
  return { ...value, aqi: modelAqi(value), cached: false };
}
