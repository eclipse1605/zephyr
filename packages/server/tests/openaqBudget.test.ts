import { describe, expect, test } from "bun:test";
import { openAqRequestKey, resetOpenAqBudget, takeOpenAqSlot } from "../src/openaqBudget.js";

describe("OpenAQ budget", () => {
  test("one minute stays within 60 calls on one key", () => {
    resetOpenAqBudget();
    expect(openAqRequestKey(["primary", "second", "third"])).toBe("primary");
    for (let i = 0; i < 60; i++) expect(takeOpenAqSlot(1_000)).toBe(true);
    expect(takeOpenAqSlot(1_000)).toBe(false);
    expect(takeOpenAqSlot(61_001)).toBe(true);
    resetOpenAqBudget();
  });
});
