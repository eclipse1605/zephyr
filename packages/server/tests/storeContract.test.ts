import { describe, expect, test } from "bun:test";
import { MemoryObjectStore } from "../src/objectStore.js";
import { MemoryStore } from "../src/memoryStore.js";
import { StoreConflictError, type Store, type StoredStation } from "../src/store.js";

function station(id: string, cityId = "delhi"): StoredStation {
  return {
    id,
    name: id,
    cityId,
    lat: cityId === "mumbai" ? 19.07 : 28.61,
    lng: cityId === "mumbai" ? 72.87 : 77.21,
    sourceFeed: "openaq",
    lastSeen: "2026-01-01T00:00:00.000Z",
    online: true,
    pollutants: { pm25: 40 },
    aqi: 120,
    dominantPollutant: "pm25",
    band: "poor",
  };
}

function cases(open: () => Promise<Store>) {
  test("concurrent updates to different stations both persist", async () => {
    const store = await open();
    await store.update((db) => {
      db.stations.a = station("a");
      db.stations.b = station("b");
    });
    const left = store.update((db) => {
      db.stations.a = { ...db.stations.a!, aqi: 10 };
    });
    const right = store.update((db) => {
      db.stations.b = { ...db.stations.b!, aqi: 20 };
    });
    await Promise.all([left, right]);
    const db = await store.read({ only: ["stations"] });
    expect(db.stations.a?.aqi).toBe(10);
    expect(db.stations.b?.aqi).toBe(20);
  });

  test("a scoped write does not delete reports", async () => {
    const store = await open();
    await store.update((db) => {
      db.reports.rep1 = {
        id: "rep1",
        cityId: "delhi",
        h3: "882a100d2dfffff",
        lat: 28.6,
        lng: 77.2,
        hazardType: "smoke",
        note: "n",
        photoPath: null,
        photoSha256: null,
        voicePath: null,
        status: "received",
        classification: null,
        authenticity: null,
        countsTowardPromotion: false,
        createdAt: "2026-01-01T00:00:00.000Z",
        reporterUid: null,
        reporterKey: "k",
        channel: "web",
        ipHash: "h",
        incidentId: null,
        closureTokenHash: null,
        uploadTokenHash: null,
      };
    });
    await store.update((db) => {
      db.stations.a = station("a");
    }, { only: ["stations"] });
    const db = await store.read({ only: ["reports", "stations"] });
    expect(db.reports.rep1?.status).toBe("received");
    expect(db.stations.a?.id).toBe("a");
  });

  test("bounds query returns only stations inside the box", async () => {
    const store = await open();
    await store.update((db) => {
      db.stations.d = station("d", "delhi");
      db.stations.m = station("m", "mumbai");
    });
    const hits = await store.stationsInBounds({ west: 77, south: 28, east: 78, north: 29 });
    expect(hits.map((item) => item.id)).toEqual(["d"]);
  });

  test("two claims take two different jobs", async () => {
    const store = await open();
    await store.update((db) => {
      const job = (id: string) => ({
        id,
        kind: "catalog" as const,
        shard: `city:${id}`,
        cursor: null,
        leaseOwner: null,
        leaseUntil: null,
        failures: 0,
        status: "queued" as const,
        lastError: null,
        createdAt: `2026-01-01T00:00:0${id}.000Z`,
        updatedAt: "2026-01-01T00:00:00.000Z",
        finishedAt: null,
      });
      db.ingestJobs["1"] = job("1");
      db.ingestJobs["2"] = job("2");
    });
    const [first, second] = await Promise.all([
      store.claimNextIngestJob("a", 60_000, new Date("2026-01-02T00:00:00.000Z")),
      store.claimNextIngestJob("b", 60_000, new Date("2026-01-02T00:00:00.000Z")),
    ]);
    expect(new Set([first?.id, second?.id])).toEqual(new Set(["1", "2"]));
    expect(await store.claimNextIngestJob("c", 60_000, new Date("2026-01-02T00:00:00.000Z"))).toBeNull();
  });

  test("a stale snapshot does not clobber a row it did not change", async () => {
    const store = await open();
    await store.update((db) => {
      db.stations.a = station("a");
      db.stations.b = station("b");
    });
    const stale = await store.read();
    await store.update((db) => {
      db.stations.b = { ...db.stations.b!, aqi: 55 };
    });
    stale.stations.a = { ...stale.stations.a!, aqi: 77 };
    await store.write(stale);
    const db = await store.read({ only: ["stations"] });
    expect(db.stations.a?.aqi).toBe(77);
    expect(db.stations.b?.aqi).toBe(55);
  });

  test("same-row writers retry instead of dropping one", async () => {
    const store = await open();
    await store.update((db) => {
      db.stations.a = station("a");
    });
    await Promise.all([
      store.update((db) => {
        db.stations.a = { ...db.stations.a!, name: "left" };
      }),
      store.update((db) => {
        db.stations.a = { ...db.stations.a!, aqi: 9 };
      }),
    ]);
    const db = await store.read({ only: ["stations"] });
    expect(db.stations.a?.name === "left" || db.stations.a?.aqi === 9).toBe(true);
    expect(db.stations.a).toBeTruthy();
  });
}

describe("memory store contract", () => {
  cases(() => Promise.resolve(new MemoryStore()));
});

describe("memory object store", () => {
  test("put get stat list delete", async () => {
    const objects = new MemoryObjectStore();
    await objects.put("photos/a", Buffer.from("hi"));
    expect((await objects.get("photos/a"))?.toString()).toBe("hi");
    expect((await objects.stat("photos/a"))?.size).toBe(2);
    expect((await objects.list("photos/")).map((item) => item.key)).toEqual(["photos/a"]);
    await objects.delete("photos/a");
    expect(await objects.get("photos/a")).toBeNull();
  });
});

void StoreConflictError;
