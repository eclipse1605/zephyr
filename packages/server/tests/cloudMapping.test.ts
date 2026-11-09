import { describe, expect, test } from "bun:test";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dir, "../../..");

describe("cloud mapping checks", () => {
  test("model tile responses declare an hour-long cache", async () => {
    const api = await readFile(path.join(root, "apps/api/src/index.ts"), "utf8");
    expect(api.includes('Cache-Control", "public, max-age=3600"') || api.includes("Cache-Control\", \"public, max-age=3600\"")).toBe(true);
    expect(api.includes("max-age=3600")).toBe(true);
  });

  test("the web sources do not embed the air-quality key", async () => {
    const webSrc = path.join(root, "apps/web/src");
    const files = await readdir(webSrc, { recursive: true });
    for (const name of files) {
      if (typeof name !== "string" || !/\.(ts|tsx|js|css)$/.test(name)) continue;
      const text = await readFile(path.join(webSrc, name), "utf8");
      expect(text.includes("GOOGLE_AIR_QUALITY_API_KEY")).toBe(false);
      expect(text.includes("airquality.googleapis.com")).toBe(false);
    }
  });

  test("terraform schedules job drain and a dlq push", async () => {
    const tf = await readFile(path.join(root, "infra/terraform/main.tf"), "utf8");
    expect(tf.includes("/internal/jobs/run")).toBe(true);
    expect(tf.includes("/internal/pubsub/dlq")).toBe(true);
    expect(tf.includes("/internal/wind")).toBe(true);
  });
});
