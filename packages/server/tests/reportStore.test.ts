import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { FileStore, emptyDb, type StoredReport } from "../src/store.js";

function sampleReport(id: string): StoredReport {
  return {
    id,
    cityId: "delhi",
    h3: "882a100d2dfffff",
    lat: 28.61,
    lng: 77.21,
    hazardType: "smoke",
    note: "test",
    photoPath: null,
    photoSha256: null,
    voicePath: null,
    status: "pending_upload",
    classification: null,
    authenticity: null,
    countsTowardPromotion: false,
    createdAt: "2026-01-01T00:00:00.000Z",
    reporterUid: null,
    reporterKey: "test",
    channel: "web",
    ipHash: "abc",
    incidentId: null,
    closureTokenHash: null,
    uploadTokenHash: "upload",
  };
}

describe("report store patches", () => {
  test("saveReport writes reports.json without rewriting db.json", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "zephyr-report-"));
    const store = new FileStore(root);
    const db = emptyDb();
    db.stations.st1 = {
      id: "st1",
      name: "Demo",
      cityId: "delhi",
      lat: 28.6,
      lng: 77.2,
      sourceFeed: "fixture",
      lastSeen: "2026-01-01T00:00:00.000Z",
      online: true,
      pollutants: {},
      aqi: 120,
      dominantPollutant: "pm25",
      band: "poor",
    };
    await store.write(db);
    const before = await stat(path.join(root, "db.json"));
    const report = sampleReport("rep-1");
    await store.saveReport(report);
    await Bun.sleep(5);
    const after = await stat(path.join(root, "db.json"));
    expect(after.mtimeMs).toBe(before.mtimeMs);
    const reportsFile = JSON.parse(await readFile(path.join(root, "reports.json"), "utf8")) as Record<string, StoredReport>;
    expect(reportsFile["rep-1"]?.status).toBe("pending_upload");
    const loaded = await store.read();
    expect(loaded.stations.st1?.aqi).toBe(120);
    expect(loaded.reports["rep-1"]?.id).toBe("rep-1");
    report.status = "received";
    await store.saveReport(report);
    expect((await store.read()).reports["rep-1"]?.status).toBe("received");
  });
});
