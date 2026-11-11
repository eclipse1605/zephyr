import { crc32, deflateSync, inflateSync } from "node:zlib";
import { usAqiFromReadings } from "@zephyr/domain";
import type { ObjectStore } from "./objectStore.js";

export const RASTER_MAX_ZOOM = 8;
export const MODEL_TTL_MS = 60 * 60 * 1000;
/** Keep serving a painted tile this long after TTL when Open-Meteo is rate-limiting. */
export const MODEL_STALE_MS = 7 * 24 * 60 * 60 * 1000;

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
/** Bump when paint algorithm changes so disk cache does not keep blocky tiles. */
export const TILE_PAINT_VERSION = "smooth-v11";
/** Prefer recent paints; older versions still fill continents when quota is exhausted. */
const PRIOR_PAINT_VERSIONS = [
  "smooth-v10",
  "smooth-v9",
  "smooth-v8",
  "smooth-v7",
  "smooth-v5",
  "smooth-v3",
  "smooth-v2",
  "smooth-v1",
] as const;
/** Transparent / near-empty tiles — never treat as a warm cache hit. */
export const BLANK_TILE_MAX_BYTES = 4096;

const pngLru = new Map<string, Buffer>();

function rememberPng(key: string, png: Buffer): void {
  if (pngLru.has(key)) pngLru.delete(key);
  pngLru.set(key, png);
  while (pngLru.size > 256) {
    const oldest = pngLru.keys().next().value;
    if (oldest === undefined) break;
    pngLru.delete(oldest);
  }
}

function tilePngKey(version: string, layer: string, z: number, x: number, y: number): string {
  return `model-tiles/${version}/${layer}/${z}/${x}/${y}.png`;
}

function samplesKey(z: number, x: number, y: number): string {
  return `model-tiles/${TILE_PAINT_VERSION}/_samples/${z}/${x}/${y}.json`;
}

function pointKey(key: string): string {
  return `model-tiles/points/${key}.json`;
}

async function objectAge(objects: ObjectStore, key: string, now: number): Promise<number | null> {
  const info = await objects.stat(key);
  if (!info) return null;
  return now - info.updatedAt.getTime();
}

const inflight = new Map<string, Promise<{ png: Buffer; cached: boolean; stale?: boolean; blank?: boolean }>>();
const sampleMemory = new Map<string, { at: number; reading: ModelReading }>();
let upstreamChain: Promise<void> = Promise.resolve();

export function tileLng(z: number, x: number): number {
  return (x / 2 ** z) * 360 - 180;
}

export function tileLat(z: number, y: number): number {
  const n = Math.PI - (2 * Math.PI * y) / 2 ** z;
  return (180 / Math.PI) * Math.atan(Math.sinh(n));
}

export function sampleCellsForZoom(z: number): number {
  // Edge-inclusive grid is (n+1)² samples. Denser at low z so globe overzoom stays smooth.
  if (z <= 2) return 5;
  if (z <= 5) return 6;
  return 7;
}

export function tileSamples(z: number, x: number, y: number, cells = sampleCellsForZoom(z)): Array<{ lat: number; lng: number }> {
  const west = tileLng(z, x);
  const east = tileLng(z, x + 1);
  const north = tileLat(z, y);
  const south = tileLat(z, y + 1);
  const samples: Array<{ lat: number; lng: number }> = [];
  // Include edges so adjacent tiles share the same sample coordinates (seamless field).
  for (let row = 0; row <= cells; row++) {
    for (let col = 0; col <= cells; col++) {
      samples.push({
        lng: west + (col / cells) * (east - west),
        lat: north + (row / cells) * (south - north),
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

/** IQAir-like AQI stops — continuous lerp, not flat band fills. */
const AQI_STOPS: Array<{ aqi: number; rgb: [number, number, number] }> = [
  { aqi: 0, rgb: [86, 214, 90] },
  { aqi: 50, rgb: [255, 222, 51] },
  { aqi: 100, rgb: [255, 152, 52] },
  { aqi: 150, rgb: [245, 64, 64] },
  { aqi: 200, rgb: [168, 94, 189] },
  { aqi: 300, rgb: [142, 28, 72] },
  { aqi: 500, rgb: [110, 16, 48] },
];

export function readingScalar(layer: RasterLayer, reading: ModelReading): number | null {
  // PM2.5 stays in µg/m³. Converting it to US AQI made the toggle a no-op wherever
  // PM2.5 was already the dominant pollutant (the usual case).
  if (layer === "pm25") return reading.pm25;
  return modelAqi(reading);
}

export function aqiToRgba(aqi: number): [number, number, number, number] {
  const clamped = Math.max(0, Math.min(500, aqi));
  let i = 0;
  while (i < AQI_STOPS.length - 2 && clamped > AQI_STOPS[i + 1]!.aqi) i += 1;
  const a = AQI_STOPS[i]!;
  const b = AQI_STOPS[i + 1]!;
  const t = (clamped - a.aqi) / Math.max(1, b.aqi - a.aqi);
  const mix = (lo: number, hi: number) => Math.round(lo + (hi - lo) * t);
  // Soft veil so roads/labels stay readable — close to IQAir's overlay weight.
  const alpha = Math.round(118 + Math.min(52, clamped * 0.12));
  return [mix(a.rgb[0], b.rgb[0]), mix(a.rgb[1], b.rgb[1]), mix(a.rgb[2], b.rgb[2]), alpha];
}

/** µg/m³ stops. Starts blue, not green, so it cannot be mistaken for the AQI ramp. */
const PM25_STOPS: Array<{ value: number; rgb: [number, number, number] }> = [
  { value: 0, rgb: [64, 156, 214] },
  { value: 12, rgb: [86, 214, 140] },
  { value: 35, rgb: [255, 214, 64] },
  { value: 55, rgb: [255, 140, 48] },
  { value: 150, rgb: [214, 48, 48] },
  { value: 250, rgb: [120, 24, 64] },
  { value: 500, rgb: [36, 12, 28] },
];

function ramp(stops: Array<{ value: number; rgb: [number, number, number] }>, value: number, alphaFor: (v: number) => number): [number, number, number, number] {
  const clamped = Math.max(stops[0]!.value, Math.min(stops[stops.length - 1]!.value, value));
  let i = 0;
  while (i < stops.length - 2 && clamped > stops[i + 1]!.value) i += 1;
  const a = stops[i]!;
  const b = stops[i + 1]!;
  const t = (clamped - a.value) / Math.max(1, b.value - a.value);
  const mix = (lo: number, hi: number) => Math.round(lo + (hi - lo) * t);
  return [mix(a.rgb[0], b.rgb[0]), mix(a.rgb[1], b.rgb[1]), mix(a.rgb[2], b.rgb[2]), alphaFor(clamped)];
}

export function scalarToRgba(layer: RasterLayer, value: number): [number, number, number, number] {
  if (layer === "pm25") return ramp(PM25_STOPS, value, (v) => Math.round(130 + Math.min(70, v * 0.3)));
  return aqiToRgba(value);
}

export function rasterColor(layer: RasterLayer, reading: ModelReading): [number, number, number, number] {
  const value = readingScalar(layer, reading);
  if (value == null) return [40, 48, 56, 0];
  return scalarToRgba(layer, value);
}

function sampleScalarGrid(grid: Array<number | null>, side: number, u: number, v: number): number | null {
  if (side <= 1) return grid[0] ?? null;
  const x = Math.max(0, Math.min(side - 1, u));
  const y = Math.max(0, Math.min(side - 1, v));
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(side - 1, x0 + 1);
  const y1 = Math.min(side - 1, y0 + 1);
  const tx = x - x0;
  const ty = y - y0;
  const c00 = grid[y0 * side + x0];
  const c10 = grid[y0 * side + x1];
  const c01 = grid[y1 * side + x0];
  const c11 = grid[y1 * side + x1];
  const parts: Array<{ w: number; v: number }> = [];
  if (c00 != null) parts.push({ w: (1 - tx) * (1 - ty), v: c00 });
  if (c10 != null) parts.push({ w: tx * (1 - ty), v: c10 });
  if (c01 != null) parts.push({ w: (1 - tx) * ty, v: c01 });
  if (c11 != null) parts.push({ w: tx * ty, v: c11 });
  if (parts.length === 0) return null;
  const weight = parts.reduce((sum, part) => sum + part.w, 0);
  if (weight <= 0) return null;
  return parts.reduce((sum, part) => sum + part.v * part.w, 0) / weight;
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

export function paintTile(layer: RasterLayer, readings: ModelReading[], cells?: number): Buffer {
  // `cells` is the sampleCellsForZoom spacing count; grid side is cells+1 (inclusive edges).
  // When omitted, infer side from readings length (must be a perfect square).
  const side =
    cells != null
      ? cells + 1
      : Math.max(1, Math.round(Math.sqrt(readings.length)));
  const size = 256;
  const grid: Array<number | null> = Array.from({ length: side * side }, (_, index) =>
    readingScalar(layer, readings[index] ?? EMPTY),
  );
  const rgba = Buffer.alloc(size * size * 4);
  // Samples sit on inclusive corners 0…side-1. Map edge pixels onto those corners
  // so adjacent tiles share an identical border color.
  const extent = Math.max(1, side - 1);
  const last = size - 1;
  for (let py = 0; py < size; py++) {
    const v = (py / last) * extent;
    for (let px = 0; px < size; px++) {
      const u = (px / last) * extent;
      const aqi = sampleScalarGrid(grid, side, u, v);
      const [r, g, b, a] = aqi == null ? [40, 48, 56, 0] : scalarToRgba(layer, aqi);
      const i = (py * size + px) * 4;
      rgba[i] = r;
      rgba[i + 1] = g;
      rgba[i + 2] = b;
      rgba[i + 3] = a;
    }
  }
  // No post-blur: blur reintroduces seams. Shared edge samples + bilinear stay continuous.
  return encodeRgbaPng(size, size, rgba);
}

const EMPTY_TILE = paintTile("aqi", Array.from({ length: 36 }, () => EMPTY));

export function isBlankPng(png: Buffer): boolean {
  // Uniform haze tiles compress small — never use byte length alone.
  try {
    const { rgba } = decodePngRgba(png);
    let opaque = 0;
    for (let i = 3; i < rgba.length; i += 16) {
      if (rgba[i]! > 8) {
        opaque += 1;
        if (opaque >= 8) return false;
      }
    }
    return true;
  } catch {
    return png.length < 512;
  }
}

export function decodePngRgba(png: Buffer): { w: number; h: number; rgba: Buffer } {
  let i = 8;
  let w = 0;
  let h = 0;
  const idats: Buffer[] = [];
  while (i < png.length) {
    const ln = png.readUInt32BE(i);
    i += 4;
    const typ = png.subarray(i, i + 4).toString("utf8");
    i += 4;
    const chunk = png.subarray(i, i + ln);
    i += ln + 4;
    if (typ === "IHDR") {
      w = chunk.readUInt32BE(0);
      h = chunk.readUInt32BE(4);
    } else if (typ === "IDAT") {
      idats.push(chunk);
    } else if (typ === "IEND") {
      break;
    }
  }
  const raw = inflateSync(Buffer.concat(idats));
  const rgba = Buffer.alloc(w * h * 4);
  const stride = w * 4;
  for (let y = 0; y < h; y++) {
    const start = y * (stride + 1);
    if (raw[start] !== 0) throw new Error("png_filter");
    raw.copy(rgba, y * stride, start + 1, start + 1 + stride);
  }
  return { w, h, rgba };
}

/** Separable box blur for stitched field mosaics (large radius OK). */
export function blurRgba(rgba: Buffer, w: number, h: number, radius: number): Buffer {
  const r = Math.max(1, Math.min(32, radius | 0));
  const tmp = Buffer.alloc(rgba.length);
  const out = Buffer.alloc(rgba.length);
  const pass = (src: Buffer, dst: Buffer, horizontal: boolean) => {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let rs = 0;
        let gs = 0;
        let bs = 0;
        let as = 0;
        let n = 0;
        for (let k = -r; k <= r; k++) {
          const xx = horizontal ? Math.min(w - 1, Math.max(0, x + k)) : x;
          const yy = horizontal ? y : Math.min(h - 1, Math.max(0, y + k));
          const i = (yy * w + xx) * 4;
          rs += src[i]!;
          gs += src[i + 1]!;
          bs += src[i + 2]!;
          as += src[i + 3]!;
          n += 1;
        }
        const o = (y * w + x) * 4;
        dst[o] = Math.round(rs / n);
        dst[o + 1] = Math.round(gs / n);
        dst[o + 2] = Math.round(bs / n);
        dst[o + 3] = Math.round(as / n);
      }
    }
  };
  pass(rgba, tmp, true);
  pass(tmp, out, false);
  return out;
}

/**
 * Soften blocky paint interiors while restoring the outer ring so shared tile edges stay seam-free.
 * Used when Open-Meteo is unavailable and we must promote older disk tiles.
 */
export function softenTileInterior(png: Buffer, radius = 2): Buffer {
  const { w, h, rgba } = decodePngRgba(png);
  if (w < 8 || h < 8) return png;
  const out = Buffer.alloc(rgba.length);
  const r = Math.max(1, Math.min(4, radius));
  const border = r + 1;
  const idx = (x: number, y: number) => (y * w + x) * 4;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = idx(x, y);
      if (x < border || y < border || x >= w - border || y >= h - border) {
        rgba.copy(out, i, i, i + 4);
        continue;
      }
      let rs = 0;
      let gs = 0;
      let bs = 0;
      let as = 0;
      let n = 0;
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          const j = idx(x + dx, y + dy);
          const wgt = 1 + (r - Math.abs(dx)) + (r - Math.abs(dy));
          rs += rgba[j]! * wgt;
          gs += rgba[j + 1]! * wgt;
          bs += rgba[j + 2]! * wgt;
          as += rgba[j + 3]! * wgt;
          n += wgt;
        }
      }
      out[i] = Math.round(rs / n);
      out[i + 1] = Math.round(gs / n);
      out[i + 2] = Math.round(bs / n);
      out[i + 3] = Math.round(as / n);
    }
  }
  return encodeRgbaPng(w, h, out);
}

/** Scale one parent quadrant into a child 256² tile so missing zoom levels stay filled. */
export function upscaleParentQuadrant(parentPng: Buffer, childX: number, childY: number): Buffer {
  const { w, h, rgba } = decodePngRgba(parentPng);
  if (w !== 256 || h !== 256) throw new Error("parent_size");
  const qx = childX & 1;
  const qy = childY & 1;
  const half = 128;
  const size = 256;
  const out = Buffer.alloc(size * size * 4);
  const sample = (px: number, py: number): [number, number, number, number] => {
    const x = Math.max(0, Math.min(w - 1, px));
    const y = Math.max(0, Math.min(h - 1, py));
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const x1 = Math.min(w - 1, x0 + 1);
    const y1 = Math.min(h - 1, y0 + 1);
    const tx = x - x0;
    const ty = y - y0;
    const idx = (yy: number, xx: number) => (yy * w + xx) * 4;
    const mix = (a: number, b: number, t: number) => a + (b - a) * t;
    const i00 = idx(y0, x0);
    const i10 = idx(y0, x1);
    const i01 = idx(y1, x0);
    const i11 = idx(y1, x1);
    return [0, 1, 2, 3].map((c) =>
      Math.round(
        mix(
          mix(rgba[i00 + c]!, rgba[i10 + c]!, tx),
          mix(rgba[i01 + c]!, rgba[i11 + c]!, tx),
          ty,
        ),
      ),
    ) as [number, number, number, number];
  };
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // Slight jitter-free bilinear already; keep continuous with parent.
      const px = qx * half + ((x + 0.5) * half) / size - 0.5;
      const py = qy * half + ((y + 0.5) * half) / size - 0.5;
      const [r, g, b, a] = sample(px, py);
      const i = (y * size + x) * 4;
      out[i] = r;
      out[i + 1] = g;
      out[i + 2] = b;
      out[i + 3] = a;
    }
  }
  return softenTileInterior(encodeRgbaPng(size, size, out), 2);
}

function readingsAreBlank(layer: RasterLayer, readings: ModelReading[]): boolean {
  return readings.every((reading) => readingScalar(layer, reading) == null);
}

async function writeTileSamples(
  objects: ObjectStore,
  z: number,
  x: number,
  y: number,
  readings: ModelReading[],
  now: number,
): Promise<void> {
  await objects.put(samplesKey(z, x, y), Buffer.from(JSON.stringify(readings)), "application/json", new Date(now));
}

async function readTileSamples(
  objects: ObjectStore,
  z: number,
  x: number,
  y: number,
  now: number,
): Promise<ModelReading[] | null> {
  const key = samplesKey(z, x, y);
  const age = await objectAge(objects, key, now);
  if (age == null || age > MODEL_STALE_MS) return null;
  try {
    const raw = await objects.get(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw.toString("utf8")) as ModelReading[];
    return Array.isArray(parsed) && parsed.length > 0 ? parsed : null;
  } catch {
    return null;
  }
}

/** Copy shared edges from already-painted neighbours so N/S seams disappear. */
export function alignTileEdges(
  png: Buffer,
  neighbors: { north?: Buffer | null; south?: Buffer | null; east?: Buffer | null; west?: Buffer | null },
): Buffer {
  const { w, h, rgba } = decodePngRgba(png);
  if (w < 2 || h < 2) return png;
  const out = Buffer.from(rgba);
  const take = (edge: Buffer, fromBottom: boolean, toTop: boolean) => {
    try {
      const n = decodePngRgba(edge);
      if (n.w !== w || n.h !== h) return;
      const srcY = fromBottom ? h - 1 : 0;
      const dstY = toTop ? 0 : h - 1;
      for (let x = 0; x < w; x++) {
        const si = (srcY * w + x) * 4;
        const di = (dstY * w + x) * 4;
        out[di] = n.rgba[si]!;
        out[di + 1] = n.rgba[si + 1]!;
        out[di + 2] = n.rgba[si + 2]!;
        out[di + 3] = n.rgba[si + 3]!;
      }
    } catch {
      // neighbour unreadable — leave edge alone
    }
  };
  const takeVertical = (edge: Buffer, fromRight: boolean, toLeft: boolean) => {
    try {
      const n = decodePngRgba(edge);
      if (n.w !== w || n.h !== h) return;
      const srcX = fromRight ? w - 1 : 0;
      const dstX = toLeft ? 0 : w - 1;
      for (let y = 0; y < h; y++) {
        const si = (y * w + srcX) * 4;
        const di = (y * w + dstX) * 4;
        out[di] = n.rgba[si]!;
        out[di + 1] = n.rgba[si + 1]!;
        out[di + 2] = n.rgba[si + 2]!;
        out[di + 3] = n.rgba[si + 3]!;
      }
    } catch {
      // neighbour unreadable
    }
  };
  if (neighbors.north) take(neighbors.north, true, true);
  if (neighbors.south) take(neighbors.south, false, false);
  if (neighbors.west) takeVertical(neighbors.west, true, true);
  if (neighbors.east) takeVertical(neighbors.east, false, false);
  return encodeRgbaPng(w, h, out);
}

async function loadNeighborPng(
  objects: ObjectStore,
  layer: RasterLayer,
  z: number,
  x: number,
  y: number,
  now: number,
): Promise<Buffer | null> {
  const limit = 2 ** z;
  if (x < 0 || y < 0 || x >= limit || y >= limit) return null;
  return findPaintedTile(objects, layer, z, x, y, now);
}

function sampleKey(lat: number, lng: number): string {
  // Precision must keep tile-edge samples distinct from nearby interiors.
  return `${lat.toFixed(3)},${lng.toFixed(3)}`;
}

async function queuedFetch(samples: Array<{ lat: number; lng: number }>, fetchGrid: GridFetch): Promise<ModelReading[]> {
  const run = upstreamChain.then(() => fetchGrid(samples));
  upstreamChain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

async function resolveSamples(
  samples: Array<{ lat: number; lng: number }>,
  now: number,
  fetchGrid: GridFetch,
  objects?: ObjectStore,
): Promise<ModelReading[]> {
  const readings: ModelReading[] = samples.map(() => EMPTY);
  const missing: Array<{ index: number; lat: number; lng: number; key: string }> = [];
  for (let i = 0; i < samples.length; i++) {
    const key = sampleKey(samples[i].lat, samples[i].lng);
    const hit = sampleMemory.get(key);
    if (hit && now - hit.at < MODEL_TTL_MS) {
      readings[i] = hit.reading;
      continue;
    }
    if (objects) {
      try {
        const keyName = pointKey(key);
        const age = await objectAge(objects, keyName, now);
        if (age != null && age < MODEL_STALE_MS) {
          const raw = await objects.get(keyName);
          if (!raw) continue;
          const saved = JSON.parse(raw.toString("utf8")) as ModelReading;
          sampleMemory.set(key, { at: now - age, reading: saved });
          readings[i] = saved;
          continue;
        }
      } catch {
        // fall through to upstream fetch
      }
    }
    missing.push({ index: i, lat: samples[i].lat, lng: samples[i].lng, key });
  }
  if (missing.length === 0) return readings;

  const unique = new Map<string, { lat: number; lng: number }>();
  for (const item of missing) {
    if (!unique.has(item.key)) unique.set(item.key, { lat: item.lat, lng: item.lng });
  }
  const points = [...unique.values()];
  try {
    const fetched = await queuedFetch(points, fetchGrid);
    points.forEach((point, index) => {
      const key = sampleKey(point.lat, point.lng);
      const reading = fetched[index] ?? EMPTY;
      sampleMemory.set(key, { at: now, reading });
    });
  } catch {
    // Rate-limit / upstream failure: keep any in-memory hits already copied above.
  }
  for (const item of missing) {
    readings[item.index] = sampleMemory.get(item.key)?.reading ?? EMPTY;
  }
  return readings;
}

/** One CAMS image for the whole globe. Per-tile paints left hard squares and empty oceans. */
export async function renderWorldField(opts: {
  layer: RasterLayer;
  objects: ObjectStore;
  now?: number;
  fetchGrid?: GridFetch;
}): Promise<Buffer> {
  const now = opts.now ?? Date.now();
  const key = `model-tiles/world/${opts.layer}-v2.png`;
  const cached = await opts.objects.get(key);
  const age = await objectAge(opts.objects, key, now);
  if (cached && age != null && age < MODEL_TTL_MS && !isBlankPng(cached)) return cached;

  const latStep = 15;
  const lngStep = 15;
  const lats: number[] = [];
  for (let lat = -60; lat <= 60; lat += latStep) lats.push(lat);
  const lngs: number[] = [];
  for (let lng = -180; lng < 180; lng += lngStep) lngs.push(lng);
  const samples: Array<{ lat: number; lng: number }> = [];
  for (const lat of lats) for (const lng of lngs) samples.push({ lat, lng });

  let scalars: Array<number | null>;
  try {
    const readings = await (opts.fetchGrid ?? fetchOpenMeteoGrid)(samples);
    scalars = readings.map((reading) => readingScalar(opts.layer, reading));
  } catch (err) {
    if (cached && !isBlankPng(cached)) return cached;
    throw err;
  }

  const width = 720;
  const height = 360;
  const rgba = Buffer.alloc(width * height * 4);
  const at = (latIndex: number, lngIndex: number) => scalars[latIndex * lngs.length + (lngIndex % lngs.length)] ?? null;
  for (let y = 0; y < height; y++) {
    const lat = 85 - (y / (height - 1)) * 170;
    const latPos = (Math.max(-60, Math.min(60, lat)) + 60) / latStep;
    const lat0 = Math.min(lats.length - 2, Math.max(0, Math.floor(latPos)));
    const ty = latPos - lat0;
    for (let x = 0; x < width; x++) {
      const lng = -180 + (x / (width - 1)) * 360;
      const wrapped = ((lng + 180) % 360 + 360) % 360;
      const lngPos = wrapped / lngStep;
      const lng0 = Math.floor(lngPos) % lngs.length;
      const tx = lngPos - Math.floor(lngPos);
      const corners = [at(lat0, lng0), at(lat0, lng0 + 1), at(lat0 + 1, lng0), at(lat0 + 1, lng0 + 1)];
      const weights = [(1 - tx) * (1 - ty), tx * (1 - ty), (1 - tx) * ty, tx * ty];
      let sum = 0;
      let weight = 0;
      for (let i = 0; i < 4; i++) {
        const value = corners[i];
        if (value == null) continue;
        sum += value * weights[i]!;
        weight += weights[i]!;
      }
      const aqi = weight > 0 ? sum / weight : null;
      const [r, g, b, a] = aqi == null ? [0, 0, 0, 0] : scalarToRgba(opts.layer, aqi);
      const i = (y * width + x) * 4;
      rgba[i] = r;
      rgba[i + 1] = g;
      rgba[i + 2] = b;
      rgba[i + 3] = a;
    }
  }
  const png = encodeRgbaPng(width, height, rgba);
  await opts.objects.put(key, png, "image/png", new Date(now));
  return png;
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

async function loadTileFile(objects: ObjectStore, key: string, now: number): Promise<{ png: Buffer; age: number } | null> {
  const cached = pngLru.get(key);
  const age = await objectAge(objects, key, now);
  if (cached && age != null && age <= MODEL_STALE_MS && !isBlankPng(cached)) return { png: cached, age };
  if (age == null || age > MODEL_STALE_MS) return null;
  try {
    const png = await objects.get(key);
    if (!png || isBlankPng(png)) return null;
    rememberPng(key, png);
    return { png, age };
  } catch {
    return null;
  }
}

async function findPaintedTile(
  objects: ObjectStore,
  layer: RasterLayer,
  z: number,
  x: number,
  y: number,
  now: number,
): Promise<Buffer | null> {
  const candidates = [
    tilePngKey(TILE_PAINT_VERSION, layer, z, x, y),
    ...PRIOR_PAINT_VERSIONS.map((ver) => tilePngKey(ver, layer, z, x, y)),
  ];
  for (const key of candidates) {
    const hit = await loadTileFile(objects, key, now);
    if (hit) return hit.png;
  }
  return null;
}

async function synthesizeFromParent(opts: {
  layer: RasterLayer;
  z: number;
  x: number;
  y: number;
  objects: ObjectStore;
  now: number;
  depth?: number;
}): Promise<Buffer | null> {
  if (opts.z <= 0 || (opts.depth ?? 0) > 6) return null;
  const parent = {
    layer: opts.layer,
    z: opts.z - 1,
    x: Math.floor(opts.x / 2),
    y: Math.floor(opts.y / 2),
    objects: opts.objects,
    now: opts.now,
  };
  let parentPng = await findPaintedTile(parent.objects, parent.layer, parent.z, parent.x, parent.y, parent.now);
  if (!parentPng) {
    // Recurse: build/load parent (may itself synthesize), without vendor fetch here.
    parentPng = await synthesizeFromParent({ ...parent, depth: (opts.depth ?? 0) + 1 });
  }
  if (!parentPng || isBlankPng(parentPng)) return null;
  try {
    const child = upscaleParentQuadrant(parentPng, opts.x, opts.y);
    return isBlankPng(child) ? null : child;
  } catch {
    return null;
  }
}

/**
 * Build a parent tile by averaging its four children (when children are richer than
 * the flat low-zoom paints left after Open-Meteo rate limits).
 */
export function downsampleChildrenToParent(children: [Buffer, Buffer, Buffer, Buffer]): Buffer {
  const decoded = children.map((png) => decodePngRgba(png));
  for (const part of decoded) {
    if (part.w !== 256 || part.h !== 256) throw new Error("child_size");
  }
  const size = 256;
  const out = Buffer.alloc(size * size * 4);
  // children order: [NW, NE, SW, SE] relative to parent
  const places: Array<{ png: Buffer; ox: number; oy: number }> = [
    { png: decoded[0]!.rgba, ox: 0, oy: 0 },
    { png: decoded[1]!.rgba, ox: 128, oy: 0 },
    { png: decoded[2]!.rgba, ox: 0, oy: 128 },
    { png: decoded[3]!.rgba, ox: 128, oy: 128 },
  ];
  for (const place of places) {
    for (let y = 0; y < 128; y++) {
      for (let x = 0; x < 128; x++) {
        // Average a 2×2 block from the child into one parent pixel.
        const cx = x * 2;
        const cy = y * 2;
        const idx = (yy: number, xx: number) => (yy * 256 + xx) * 4;
        const i00 = idx(cy, cx);
        const i10 = idx(cy, cx + 1);
        const i01 = idx(cy + 1, cx);
        const i11 = idx(cy + 1, cx + 1);
        const o = ((place.oy + y) * size + (place.ox + x)) * 4;
        for (let c = 0; c < 4; c++) {
          out[o + c] = Math.round(
            (place.png[i00 + c]! + place.png[i10 + c]! + place.png[i01 + c]! + place.png[i11 + c]!) / 4,
          );
        }
      }
    }
  }
  return softenTileInterior(encodeRgbaPng(size, size, out), 2);
}

/** Stitch a rectangular window of tiles into one PNG for seam-free globe overlays. */
export async function composeModelField(opts: {
  layer: RasterLayer;
  z: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  objects: ObjectStore;
  now?: number;
  fetchGrid?: GridFetch;
}): Promise<{ png: Buffer; west: number; east: number; north: number; south: number }> {
  const z = opts.z;
  if (!Number.isInteger(z) || z < 0 || z > RASTER_MAX_ZOOM) throw new Error("zoom");
  const x0 = Math.min(opts.x0, opts.x1);
  const x1 = Math.max(opts.x0, opts.x1);
  const y0 = Math.min(opts.y0, opts.y1);
  const y1 = Math.max(opts.y0, opts.y1);
  const cols = x1 - x0 + 1;
  const rows = y1 - y0 + 1;
  if (cols < 1 || rows < 1 || cols * rows > 64) throw new Error("field");
  const size = 256;
  const rgba = Buffer.alloc(cols * size * rows * size * 4);
  const now = opts.now ?? Date.now();
  for (let ty = y0; ty <= y1; ty++) {
    for (let tx = x0; tx <= x1; tx++) {
      const tile = await cachedModelTile({
        layer: opts.layer,
        z,
        x: tx,
        y: ty,
        objects: opts.objects,
        now,
        fetchGrid: opts.fetchGrid,
      });
      const decoded = decodePngRgba(tile.png);
      const ox = (tx - x0) * size;
      const oy = (ty - y0) * size;
      for (let row = 0; row < size; row++) {
        const src = row * size * 4;
        const dst = ((oy + row) * cols * size + ox) * 4;
        decoded.rgba.copy(rgba, dst, src, src + size * 4);
      }
    }
  }
  // Wide blur across the whole mosaic — scale kernel with field size so world
  // z2 seams soften as much as the tighter South-Asia mosaic did.
  const w = cols * size;
  const h = rows * size;
  const radius = Math.max(24, Math.min(48, Math.round(Math.min(w, h) / 32)));
  const blurred = blurRgba(rgba, w, h, radius);
  return {
    png: encodeRgbaPng(w, h, blurred),
    west: tileLng(z, x0),
    east: tileLng(z, x1 + 1),
    north: tileLat(z, y0),
    south: tileLat(z, y1 + 1),
  };
}

export async function cachedModelTile(opts: {
  layer: RasterLayer;
  z: number;
  x: number;
  y: number;
  objects: ObjectStore;
  now?: number;
  fetchGrid?: GridFetch;
}): Promise<{ png: Buffer; cached: boolean; stale?: boolean; blank?: boolean }> {
  if (!Number.isInteger(opts.z) || opts.z < 0 || opts.z > RASTER_MAX_ZOOM) throw new Error("zoom");
  const limit = 2 ** opts.z;
  if (!Number.isInteger(opts.x) || !Number.isInteger(opts.y) || opts.x < 0 || opts.y < 0 || opts.x >= limit || opts.y >= limit) {
    throw new Error("tile");
  }
  const now = opts.now ?? Date.now();
  const file = tilePngKey(TILE_PAINT_VERSION, opts.layer, opts.z, opts.x, opts.y);
  const key = `${TILE_PAINT_VERSION}/${opts.layer}/${opts.z}/${opts.x}/${opts.y}`;
  const existing = inflight.get(key);
  if (existing) return existing;

  const work = (async () => {
    const fresh = await loadTileFile(opts.objects, file, now);
    if (fresh && fresh.age < MODEL_TTL_MS) return { png: fresh.png, cached: true };

    const finish = async (png: Buffer, meta: { cached: boolean; stale?: boolean; blank?: boolean }, layer = opts.layer) => {
      if (meta.blank || isBlankPng(png)) {
        return meta.blank ? { ...meta, png, blank: true as const } : { ...meta, png };
      }
      const aligned = alignTileEdges(png, {
        north: await loadNeighborPng(opts.objects, layer, opts.z, opts.x, opts.y - 1, now),
        south: await loadNeighborPng(opts.objects, layer, opts.z, opts.x, opts.y + 1, now),
        west: await loadNeighborPng(opts.objects, layer, opts.z, opts.x - 1, opts.y, now),
        east: await loadNeighborPng(opts.objects, layer, opts.z, opts.x + 1, opts.y, now),
      });
      const outFile = tilePngKey(TILE_PAINT_VERSION, layer, opts.z, opts.x, opts.y);
      await opts.objects.put(outFile, aligned, "image/png", new Date(now));
      rememberPng(outFile, aligned);
      return { ...meta, png: aligned };
    };

    const paintFromReadings = async (layer: RasterLayer, readings: ModelReading[], cells: number, stale: boolean) => {
      if (readingsAreBlank(layer, readings)) return null;
      const png = paintTile(layer, readings, cells);
      if (isBlankPng(png)) return null;
      return finish(png, { cached: false, stale: stale || undefined }, layer);
    };

    // City zooms reuse a painted parent. Fetching a new Open-Meteo grid per tile
    // is what made cells appear late or not at all when the browser aborted them.
    if (opts.z > 2) {
      const parentTile = await synthesizeFromParent({
        layer: opts.layer,
        z: opts.z,
        x: opts.x,
        y: opts.y,
        objects: opts.objects,
        now,
      });
      if (parentTile) return finish(parentTile, { cached: true, stale: true });
      return { png: EMPTY_TILE, cached: false, stale: true, blank: true };
    }

    const cells = sampleCellsForZoom(opts.z);
    const samples = tileSamples(opts.z, opts.x, opts.y, cells);
    let readings: ModelReading[] | null = null;
    try {
      readings = await resolveSamples(samples, now, opts.fetchGrid ?? fetchOpenMeteoGrid, opts.objects);
    } catch {
      readings = null;
    }
    if (!readings || readingsAreBlank(opts.layer, readings)) {
      readings = (await readTileSamples(opts.objects, opts.z, opts.x, opts.y, now)) ?? readings;
    }
    if (readings && (!readingsAreBlank("aqi", readings) || !readingsAreBlank("pm25", readings))) {
      await writeTileSamples(opts.objects, opts.z, opts.x, opts.y, readings, now);
      const sibling: RasterLayer = opts.layer === "aqi" ? "pm25" : "aqi";
      const primary = await paintFromReadings(opts.layer, readings, cells, false);
      // Co-paint the other layer from the same samples so PM2.5 is not blank after AQI warms.
      await paintFromReadings(sibling, readings, cells, false);
      if (primary) return primary;
    }

    if (fresh) return { png: fresh.png, cached: true, stale: true };

    // Promote older paints into the current version with an interior soften so globe
    // overzoom looks less blocky when Open-Meteo is rate-limited.
    const prior = await findPaintedTile(opts.objects, opts.layer, opts.z, opts.x, opts.y, now);
    if (prior) {
      try {
        return finish(softenTileInterior(prior, 2), { cached: true, stale: true });
      } catch {
        return { png: prior, cached: true, stale: true };
      }
    }

    const fromParent = await synthesizeFromParent({
      layer: opts.layer,
      z: opts.z,
      x: opts.x,
      y: opts.y,
      objects: opts.objects,
      now,
    });
    if (fromParent) return finish(fromParent, { cached: false, stale: true });

    // Last resort under vendor 429: reuse the sibling layer's paint so the map
    // toggle is not a hole. PM2.5 and combined AQI usually track closely.
    const siblingLayer: RasterLayer = opts.layer === "aqi" ? "pm25" : "aqi";
    const sibling = await findPaintedTile(opts.objects, siblingLayer, opts.z, opts.x, opts.y, now);
    if (sibling && !isBlankPng(sibling)) {
      return finish(sibling, { cached: true, stale: true });
    }

    return { png: EMPTY_TILE, cached: false, stale: true, blank: true };
  })();

  inflight.set(key, work);
  try {
    return await work;
  } finally {
    inflight.delete(key);
  }
}

export async function cachedModelPoint(opts: {
  lat: number;
  lng: number;
  objects: ObjectStore;
  now?: number;
  fetchGrid?: GridFetch;
}): Promise<ModelReading & { aqi: number | null; cached: boolean }> {
  if (!Number.isFinite(opts.lat) || !Number.isFinite(opts.lng) || Math.abs(opts.lat) > 90 || Math.abs(opts.lng) > 180) {
    throw new Error("point");
  }
  const now = opts.now ?? Date.now();
  const key = sampleKey(opts.lat, opts.lng);
  const mem = sampleMemory.get(key);
  if (mem && now - mem.at < MODEL_TTL_MS) {
    return { ...mem.reading, aqi: modelAqi(mem.reading), cached: true };
  }
  const file = pointKey(key);
  const age = await objectAge(opts.objects, file, now);
  if (age != null && age < MODEL_TTL_MS) {
    const raw = await opts.objects.get(file);
    if (raw) {
      const saved = JSON.parse(raw.toString("utf8")) as ModelReading;
      sampleMemory.set(key, { at: now - age, reading: saved });
      return { ...saved, aqi: modelAqi(saved), cached: true };
    }
  }
  try {
    const [reading] = await queuedFetch([{ lat: opts.lat, lng: opts.lng }], opts.fetchGrid ?? fetchOpenMeteoGrid);
    const value = reading ?? EMPTY;
    sampleMemory.set(key, { at: now, reading: value });
    await opts.objects.put(file, Buffer.from(JSON.stringify(value)), "application/json", new Date(now));
    return { ...value, aqi: modelAqi(value), cached: false };
  } catch (err) {
    if (age != null && age < MODEL_STALE_MS) {
      const raw = await opts.objects.get(file);
      if (raw) {
        const saved = JSON.parse(raw.toString("utf8")) as ModelReading;
        return { ...saved, aqi: modelAqi(saved), cached: true };
      }
    }
    throw err;
  }
}
