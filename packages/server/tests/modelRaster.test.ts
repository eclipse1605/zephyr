import { describe, expect, test } from "bun:test";
import { MemoryObjectStore } from "../src/objectStore.js";
import {
  aqiToRgba,
  cachedModelPoint,
  cachedModelTile,
  encodeRgbaPng,
  isBlankPng,
  sampleCellsForZoom,
  softenTileInterior,
  composeModelField,
  downsampleChildrenToParent,
  paintTile,
  upscaleParentQuadrant,
  type ModelReading,
} from "../src/modelRaster.js";

const reading: ModelReading = { pm25: 20, pm10: 40, no2: 30, ozone: 50, so2: 4, co: 200 };

describe("model raster", () => {
  test("a tile is cached for an hour and zoom stops at 8", async () => {
    const objects = new MemoryObjectStore();
    let calls = 0;
    const fetchGrid = async (samples: Array<{ lat: number; lng: number }>) => {
      calls += 1;
      return samples.map(() => reading);
    };
    const first = await cachedModelTile({ layer: "aqi", z: 1, x: 0, y: 0, objects, fetchGrid, now: 1_000 });
    const second = await cachedModelTile({ layer: "aqi", z: 1, x: 0, y: 0, objects, fetchGrid, now: 1_000 + 30 * 60_000 });
    expect(first.cached).toBe(false);
    expect(second.cached).toBe(true);
    expect(calls).toBe(1);
    expect(first.png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))).toBe(true);
    const later = await cachedModelTile({ layer: "aqi", z: 1, x: 0, y: 0, objects, fetchGrid, now: 1_000 + 61 * 60_000 });
    expect(later.cached).toBe(false);
    expect(calls).toBe(2);
    await expect(cachedModelTile({ layer: "pm25", z: 9, x: 0, y: 0, objects, fetchGrid })).rejects.toThrow("zoom");
  });

  test("painting AQI also persists PM2.5 so the toggle is not blank after a warm AQI fetch", async () => {
    const objects = new MemoryObjectStore();
    let calls = 0;
    const fetchGrid = async (samples: Array<{ lat: number; lng: number }>) => {
      calls += 1;
      return samples.map(() => reading);
    };
    const aqi = await cachedModelTile({ layer: "aqi", z: 2, x: 1, y: 1, objects, fetchGrid, now: 2_000 });
    expect(isBlankPng(aqi.png)).toBe(false);
    const boom = async () => {
      throw new Error("open-meteo 429");
    };
    const pm = await cachedModelTile({ layer: "pm25", z: 2, x: 1, y: 1, objects, fetchGrid: boom, now: 2_500 });
    expect(pm.blank).toBeFalsy();
    expect(isBlankPng(pm.png)).toBe(false);
    expect(calls).toBe(1);
  });

  test("vendor failures serve stale paint or a soft empty tile", async () => {
    const objects = new MemoryObjectStore();
    let calls = 0;
    const ok = async (samples: Array<{ lat: number; lng: number }>) => {
      calls += 1;
      return samples.map(() => reading);
    };
    const first = await cachedModelTile({ layer: "aqi", z: 2, x: 1, y: 1, objects, fetchGrid: ok, now: 1_000 });
    expect(first.cached).toBe(false);
    const boom = async () => {
      calls += 1;
      throw new Error("open-meteo 429");
    };
    const afterQuota = await cachedModelTile({ layer: "aqi", z: 2, x: 1, y: 1, objects, fetchGrid: boom, now: 1_000 + 61 * 60_000 });
    // Prefer repainting from saved samples over a blank hole when Open-Meteo 429s.
    expect(isBlankPng(afterQuota.png)).toBe(false);
    const empty = await cachedModelTile({ layer: "aqi", z: 2, x: 2, y: 2, objects, fetchGrid: boom, now: 1_000 });
    expect(empty.png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))).toBe(true);
    // Cold tile with no upstream: blank+stale, unless overlapping sample-memory from the warm neighbour lets us paint.
    if (empty.blank) expect(empty.stale).toBe(true);
    else expect(isBlankPng(empty.png)).toBe(false);
    expect(sampleCellsForZoom(1)).toBe(5);
    expect(sampleCellsForZoom(8)).toBe(7);
    expect(calls).toBeGreaterThanOrEqual(2);
  });

  test("downsampleChildrenToParent keeps a non-blank parent", () => {
    const mk = (pm25: number) =>
      paintTile(
        "aqi",
        Array.from({ length: 36 }, () => ({ ...reading, pm25 })),
        5,
      );
    const parent = downsampleChildrenToParent([mk(20), mk(40), mk(80), mk(120)]);
    expect(isBlankPng(parent)).toBe(false);
  });

  test("composeModelField stitches a seamless multi-tile PNG", async () => {
    const objects = new MemoryObjectStore();
    const fetchGrid = async (samples: Array<{ lat: number; lng: number }>) =>
      samples.map((_, i) => ({ ...reading, pm25: 20 + (i % 5) * 8 }));
    const field = await composeModelField({
      layer: "aqi",
      z: 2,
      x0: 0,
      x1: 1,
      y0: 0,
      y1: 1,
      objects,
      fetchGrid,
      now: 1_000,
    });
    expect(field.png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))).toBe(true);
    expect(field.east).toBeGreaterThan(field.west);
    expect(field.north).toBeGreaterThan(field.south);
    expect(isBlankPng(field.png)).toBe(false);
  });

  test("interior soften keeps opaque coverage and PNG shape", () => {
    const rgba = Buffer.alloc(256 * 256 * 4, 0);
    for (let i = 0; i < rgba.length; i += 4) {
      rgba[i] = 200;
      rgba[i + 1] = 80;
      rgba[i + 2] = 40;
      rgba[i + 3] = 140;
    }
    const soft = softenTileInterior(encodeRgbaPng(256, 256, rgba), 2);
    expect(isBlankPng(soft)).toBe(false);
    expect(soft.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))).toBe(true);
  });

  test("AQI colors lerp continuously like IQAir stops", () => {
    const low = aqiToRgba(25);
    const mid = aqiToRgba(75);
    const high = aqiToRgba(175);
    expect(low[1]).toBeGreaterThan(180); // green-leaning
    expect(mid[0]).toBeGreaterThan(200); // orange-leaning
    expect(high[0]).toBeGreaterThan(140); // red/purple
    expect(low[3]).toBeGreaterThan(100);
    expect(high[3]).toBeGreaterThan(low[3]);
  });

  test("missing child tiles synthesize from a painted parent instead of a blank hole", async () => {
    const objects = new MemoryObjectStore();
    const fetchGrid = async (samples: Array<{ lat: number; lng: number }>) => samples.map(() => reading);
    const parent = await cachedModelTile({ layer: "aqi", z: 1, x: 0, y: 0, objects, fetchGrid, now: 1_000 });
    expect(isBlankPng(parent.png)).toBe(false);
    const boom = async () => {
      throw new Error("open-meteo 429");
    };
    const child = await cachedModelTile({ layer: "aqi", z: 2, x: 0, y: 0, objects, fetchGrid: boom, now: 1_000 });
    // Child may paint from sample-memory overlap, or synthesize from parent — never blank.
    expect(child.blank).toBeFalsy();
    expect(isBlankPng(child.png)).toBe(false);
    expect(child.png.length).toBeGreaterThan(parent.png.length / 4);
    const scaled = upscaleParentQuadrant(parent.png, 0, 0);
    expect(isBlankPng(scaled)).toBe(false);
  });

  test("a point click returns the other pollutants without a second vendor call", async () => {
    const objects = new MemoryObjectStore();
    let calls = 0;
    const fetchGrid = async () => {
      calls += 1;
      return [reading];
    };
    const point = await cachedModelPoint({ lat: 28.61, lng: 77.21, objects, fetchGrid, now: 5_000 });
    const again = await cachedModelPoint({ lat: 28.6104, lng: 77.2104, objects, fetchGrid, now: 6_000 });
    expect(point.pm25).toBe(20);
    expect(point.no2).toBe(30);
    expect(point.ozone).toBe(50);
    expect(point.so2).toBe(4);
    expect(point.co).toBe(200);
    expect(point.aqi).toEqual(expect.any(Number));
    expect(again.cached).toBe(true);
    expect(calls).toBe(1);
    expect(encodeRgbaPng(1, 1, Buffer.from([1, 2, 3, 4])).length).toBeGreaterThan(8);
  });
});
