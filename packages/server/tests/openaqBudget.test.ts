import { describe, expect, test } from "bun:test";
import { openAqRequestKey, resetOpenAqBudget, takeOpenAqSlot } from "../src/live.js";

describe("OpenAQ budget", () => {
  test("one minute stays within 60 calls on one key", () => {
    resetOpenAqBudget();
    process.env.OPENAQ_API_KEY = "primary";
    process.env.OPENAQ_API_KEYS = "second,third";
    expect(openAqRequestKey()).toBe("primary");
    for (let i = 0; i < 60; i++) expect(takeOpenAqSlot(1_000)).toBe(true);
    expect(takeOpenAqSlot(1_000)).toBe(false);
    expect(takeOpenAqSlot(61_001)).toBe(true);
    resetOpenAqBudget();
    delete process.env.OPENAQ_API_KEY;
    delete process.env.OPENAQ_API_KEYS;
  });
});
