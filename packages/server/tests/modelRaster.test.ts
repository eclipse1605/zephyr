import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test } from "bun:test";
import { cachedModelPoint, cachedModelTile, encodeRgbaPng, type ModelReading } from "../src/modelRaster.js";

const reading: ModelReading = { pm25: 20, pm10: 40, no2: 30, ozone: 50, so2: 4, co: 200 };

describe("model raster", () => {
  test("a tile is cached for an hour and zoom stops at 8", async () => {
    const cacheDir = await mkdtemp(path.join(tmpdir(), "zephyr-raster-"));
    let calls = 0;
    const fetchGrid = async (samples: Array<{ lat: number; lng: number }>) => {
      calls += 1;
      return samples.map(() => reading);
    };
    const first = await cachedModelTile({ layer: "aqi", z: 1, x: 0, y: 0, cacheDir, fetchGrid, now: 1_000 });
    const second = await cachedModelTile({ layer: "aqi", z: 1, x: 0, y: 0, cacheDir, fetchGrid, now: 1_000 + 30 * 60_000 });
    expect(first.cached).toBe(false);
    expect(second.cached).toBe(true);
    expect(calls).toBe(1);
    expect(first.png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))).toBe(true);
    const later = await cachedModelTile({ layer: "aqi", z: 1, x: 0, y: 0, cacheDir, fetchGrid, now: 1_000 + 61 * 60_000 });
    expect(later.cached).toBe(false);
    expect(calls).toBe(2);
    await expect(cachedModelTile({ layer: "pm25", z: 9, x: 0, y: 0, cacheDir, fetchGrid })).rejects.toThrow("zoom");
  });

  test("a point click returns the other pollutants without a second vendor call", async () => {
    const cacheDir = await mkdtemp(path.join(tmpdir(), "zephyr-point-"));
    let calls = 0;
    const fetchGrid = async () => {
      calls += 1;
      return [reading];
    };
    const point = await cachedModelPoint({ lat: 28.61, lng: 77.21, cacheDir, fetchGrid, now: 5_000 });
    const again = await cachedModelPoint({ lat: 28.62, lng: 77.22, cacheDir, fetchGrid, now: 6_000 });
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
