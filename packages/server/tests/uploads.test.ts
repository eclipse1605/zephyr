import { mkdtemp, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test } from "bun:test";
import { FileStore } from "../src/store.js";
import { authorizeInternal, sniffImage, stripImageLocation, takeReportId } from "../src/uploads.js";

describe("report ids and photo paths", () => {
  test("rejects a client id and a repeat of an existing id", () => {
    const existing = { "already-there": {} };
    expect(takeReportId(existing, "../pwned-by-id")).toEqual({ ok: false, status: 400, error: "client_id" });
    expect(takeReportId(existing, "already-there")).toEqual({ ok: false, status: 409, error: "exists" });
    const created = takeReportId(existing, undefined);
    expect(created.ok).toBe(true);
  });

  test("a traversal id cannot write outside photos", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "zephyr-photos-"));
    const store = new FileStore(root);
    await expect(store.savePhoto("../pwned-by-id", Buffer.from("nope"))).rejects.toThrow("bad_id");
    await expect(stat(path.join(root, "..", "pwned-by-id"))).rejects.toThrow();
    const outside = path.resolve(root, "..", "pwned-by-id");
    await expect(stat(outside)).rejects.toThrow();
  });

  test("zeros are not an image", () => {
    expect(sniffImage(Buffer.alloc(9000))).toBeNull();
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0x00]);
    expect(sniffImage(jpeg)).toBe("jpeg");
  });

  test("a jpeg loses its exif gps segment", () => {
    const gps = Buffer.from("Exif\0\0GPSLatitude", "ascii");
    const app1 = Buffer.alloc(4 + gps.length);
    app1[0] = 0xff;
    app1[1] = 0xe1;
    app1.writeUInt16BE(2 + gps.length, 2);
    gps.copy(app1, 4);
    const rest = Buffer.from([0xff, 0xda, 0x00, 0x02, 0x00, 0xff, 0xd9]);
    const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8]), app1, rest]);
    const stored = stripImageLocation(jpeg);
    expect(stored.includes(Buffer.from("GPSLatitude"))).toBe(false);
    expect(sniffImage(stored)).toBe("jpeg");
    expect(stored.subarray(stored.length - 2).equals(Buffer.from([0xff, 0xd9]))).toBe(true);
  });

  test("internal routes reject a missing secret", () => {
    expect(authorizeInternal({ authorization: undefined, secret: "cron", emulator: false })).toBe(false);
    expect(authorizeInternal({ authorization: "Bearer cron", secret: "cron", emulator: false })).toBe(true);
    expect(authorizeInternal({ authorization: undefined, secret: "", emulator: false })).toBe(false);
    expect(authorizeInternal({ secret: "", emulator: true })).toBe(true);
  });
});
