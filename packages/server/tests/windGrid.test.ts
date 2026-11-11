import path from "node:path";
import { describe, expect, test } from "bun:test";
import { MemoryObjectStore } from "../src/objectStore.js";
import { readWindGrid, refreshWindGrid, sampleWind, uvFromSpeedDirection } from "../src/windGrid.js";

const sample = path.resolve(import.meta.dir, "../../../fixtures/wind/sample.json");

describe("wind grid", () => {
  test("a fresh grid is kept for six hours and the sample still has flow", async () => {
    const objects = new MemoryObjectStore();
    let calls = 0;
    const fetchGrid = async () => {
      calls += 1;
      return [{ lat: 0, lng: 0, u: 3, v: -1 }];
    };
    const first = await refreshWindGrid({ objects, samplePath: sample, now: 10_000, fetchGrid });
    const second = await refreshWindGrid({ objects, samplePath: sample, now: 10_000 + 60 * 60_000, fetchGrid });
    expect(first.source).toBe("open-meteo");
    expect(second.source).toBe("cached");
    expect(calls).toBe(1);
    const stored = JSON.parse((await objects.get("wind/latest.json"))!.toString("utf8")) as { cells: Array<{ u: number }> };
    expect(stored.cells[0]?.u).toBe(3);
    const empty = new MemoryObjectStore();
    const fallback = await readWindGrid(empty, sample);
    expect(fallback.source).toBe("sample");
    expect(fallback.cells.length).toBeGreaterThan(10);
    const here = sampleWind(fallback, 28, 77);
    expect(Math.hypot(here.u, here.v)).toBeGreaterThan(0);
    const east = uvFromSpeedDirection(10, 270);
    expect(east.u).toBeCloseTo(10, 5);
    expect(east.v).toBeCloseTo(0, 5);
  });
});
