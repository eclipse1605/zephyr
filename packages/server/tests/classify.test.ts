import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { classifyPhoto, countsAsEvidence } from "../src/gemini.js";

const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
const savedKey = process.env.GEMINI_API_KEY;
const savedFetch = globalThis.fetch;

beforeEach(() => {
  delete process.env.GEMINI_API_KEY;
  globalThis.fetch = savedFetch;
});

afterEach(() => {
  if (savedKey === undefined) delete process.env.GEMINI_API_KEY;
  else process.env.GEMINI_API_KEY = savedKey;
  globalThis.fetch = savedFetch;
});

describe("photo authenticity", () => {
  test("a non-image never counts as evidence", async () => {
    const result = await classifyPhoto(Buffer.alloc(9000), "smoke");
    expect(result.authenticityFlags).toContain("undecodable");
    expect(countsAsEvidence(result)).toBe(false);
  });

  test("the size heuristic never clears authenticity", async () => {
    const result = await classifyPhoto(jpeg, "smoke");
    expect(result.source).toBe("heuristic");
    expect(countsAsEvidence(result)).toBe(false);
  });

  test("a gemini timeout does not count as evidence", async () => {
    process.env.GEMINI_API_KEY = "test-key";
    const original = globalThis.fetch;
    globalThis.fetch = (async () => {
      throw new DOMException("timed out", "TimeoutError");
    }) as typeof fetch;
    let result;
    try {
      result = await classifyPhoto(jpeg, "smoke");
    } finally {
      globalThis.fetch = original;
    }
    expect(result.authenticityFlags).toContain("gemini_unavailable");
    expect(countsAsEvidence(result)).toBe(false);
  });
});
