import { mkdtemp, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test } from "bun:test";
import { FileStore } from "../src/store.js";
import { authorizeInternal, sniffImage, takeReportId } from "../src/uploads.js";

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

  test("internal routes reject a missing secret", () => {
    expect(authorizeInternal({ authorization: undefined, secret: "cron", emulator: false })).toBe(false);
    expect(authorizeInternal({ authorization: "Bearer cron", secret: "cron", emulator: false })).toBe(true);
    expect(authorizeInternal({ authorization: undefined, secret: "", emulator: false })).toBe(false);
    expect(authorizeInternal({ secret: "", emulator: true })).toBe(true);
  });
});
