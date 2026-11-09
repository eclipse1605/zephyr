import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test } from "bun:test";
import type { Server } from "node:http";
import type { Express } from "express";
import { openStore, runTick, type StoredReport } from "../src/index.js";

const repoRoot = path.resolve(import.meta.dir, "../../..");

function report(id: string): StoredReport {
  return {
    id,
    cityId: "delhi",
    h3: "883da114abfffff",
    lat: 28.6139,
    lng: 77.209,
    hazardType: "smoke",
    note: "",
    photoPath: null,
    photoSha256: null,
    voicePath: null,
    status: "pending_upload",
    classification: null,
    authenticity: null,
    countsTowardPromotion: false,
    createdAt: "2026-11-09T00:00:00.000Z",
    reporterUid: null,
    reporterKey: "reporter",
    channel: "web",
    ipHash: "hash",
    incidentId: null,
    closureTokenHash: null,
    uploadTokenHash: null,
  };
}

async function withServer(app: Express, run: (base: string) => Promise<void>) {
  const server: Server = await new Promise((resolve) => {
    const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  try {
    await run(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
}

describe("file store and demo tick", () => {
  test("openStore keeps a report and a photo, and rejects a path escape", async () => {
    const previous = process.env.ZEPHYR_STORE;
    process.env.ZEPHYR_STORE = "file";
    const dir = await mkdtemp(path.join(tmpdir(), "zephyr-store-"));
    const store = await openStore(dir);
    await store.update((db) => {
      db.reports["abcd1234"] = report("abcd1234");
    });
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
    await store.savePhoto("abcd1234", jpeg);
    const saved = await store.read();
    expect(saved.reports["abcd1234"]?.cityId).toBe("delhi");
    expect((await store.readPhoto("abcd1234")).equals(jpeg)).toBe(true);
    await expect(store.savePhoto("../pwned-by-id", jpeg)).rejects.toThrow("bad_id");
    if (previous === undefined) delete process.env.ZEPHYR_STORE;
    else process.env.ZEPHYR_STORE = previous;
  });

  test("a demo tick publishes a Delhi summary from fixtures", async () => {
    const previousPause = process.env.TICK_CITY_PAUSE_MS;
    const previousStore = process.env.ZEPHYR_STORE;
    process.env.TICK_CITY_PAUSE_MS = "0";
    process.env.ZEPHYR_STORE = "file";
    const dir = await mkdtemp(path.join(tmpdir(), "zephyr-tick-"));
    const store = await openStore(dir);
    await store.ensure();
    const result = await runTick({ store, fixturesRoot: path.join(repoRoot, "fixtures") });
    expect(result.ok).toBe(true);
    const db = await store.read();
    expect(db.citySummaries.delhi?.cityAqi).toEqual(expect.any(Number));
    expect(Object.values(db.stations).some((station) => station.cityId === "delhi" && station.online)).toBe(true);
    if (previousPause === undefined) delete process.env.TICK_CITY_PAUSE_MS;
    else process.env.TICK_CITY_PAUSE_MS = previousPause;
    if (previousStore === undefined) delete process.env.ZEPHYR_STORE;
    else process.env.ZEPHYR_STORE = previousStore;
  });
});

describe("report validation and worker auth", () => {
  test("POST /reports rejects an unknown city, bad coordinates, and a point outside the city", async () => {
    process.env.ZEPHYR_NO_LISTEN = "1";
    process.env.ZEPHYR_STORE = "file";
    process.env.ZEPHYR_DATA_DIR = await mkdtemp(path.join(tmpdir(), "zephyr-api-"));
    const { app } = await import("../../../apps/api/src/index.ts");
    await withServer(app, async (base) => {
      const post = (body: unknown) =>
        fetch(`${base}/api/v1/reports`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
      expect((await post({ cityId: "atlantis", lat: 0, lng: 0 })).status).toBe(400);
      expect((await (await post({ cityId: "atlantis", lat: 0, lng: 0 })).json()).error).toBe("unknown_city");
      expect((await (await post({ cityId: "delhi", lat: "28", lng: 77 })).json()).error).toBe("bad_coords");
      expect((await (await post({ cityId: "delhi", lat: 0, lng: 0 })).json()).error).toBe("outside_city");
    });
  });

  test("WhatsApp inbound stays off without Twilio", async () => {
    process.env.ZEPHYR_NO_LISTEN = "1";
    process.env.ZEPHYR_STORE = "file";
    process.env.ZEPHYR_DATA_DIR = await mkdtemp(path.join(tmpdir(), "zephyr-wa-"));
    const previous = {
      sid: process.env.TWILIO_ACCOUNT_SID,
      token: process.env.TWILIO_AUTH_TOKEN,
      from: process.env.TWILIO_WHATSAPP_FROM,
    };
    delete process.env.TWILIO_ACCOUNT_SID;
    delete process.env.TWILIO_AUTH_TOKEN;
    delete process.env.TWILIO_WHATSAPP_FROM;
    try {
      const { app } = await import("../../../apps/api/src/index.ts");
      await withServer(app, async (base) => {
        const res = await fetch(`${base}/api/v1/whatsapp/inbound`, {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: "Body=smoke&Latitude=28.61&Longitude=77.21&From=whatsapp%3A%2B10000000000",
        });
        expect(res.status).toBe(200);
        expect(await res.text()).toContain("not enabled");
      });
    } finally {
      if (previous.sid === undefined) delete process.env.TWILIO_ACCOUNT_SID;
      else process.env.TWILIO_ACCOUNT_SID = previous.sid;
      if (previous.token === undefined) delete process.env.TWILIO_AUTH_TOKEN;
      else process.env.TWILIO_AUTH_TOKEN = previous.token;
      if (previous.from === undefined) delete process.env.TWILIO_WHATSAPP_FROM;
      else process.env.TWILIO_WHATSAPP_FROM = previous.from;
    }
  });

  test("worker tick is unauthorized without the cron secret", async () => {
    process.env.ZEPHYR_NO_LISTEN = "1";
    process.env.ZEPHYR_STORE = "file";
    process.env.ZEPHYR_DATA_DIR ??= await mkdtemp(path.join(tmpdir(), "zephyr-worker-"));
    const { app } = await import("../../../apps/worker/src/index.ts");
    const secret = process.env.CRON_SECRET;
    const emulator = process.env.PUBSUB_EMULATOR_HOST;
    delete process.env.CRON_SECRET;
    delete process.env.PUBSUB_EMULATOR_HOST;
    try {
      await withServer(app, async (base) => {
        const res = await fetch(`${base}/internal/tick`, { method: "POST" });
        expect(res.status).toBe(401);
      });
    } finally {
      if (secret === undefined) delete process.env.CRON_SECRET;
      else process.env.CRON_SECRET = secret;
      if (emulator === undefined) delete process.env.PUBSUB_EMULATOR_HOST;
      else process.env.PUBSUB_EMULATOR_HOST = emulator;
    }
  });
});
