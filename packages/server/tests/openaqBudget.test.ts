import { describe, expect, test } from "bun:test";
import {
  msUntilOpenAqKey,
  noteOpenAq429,
  openAqBudgetStatus,
  resetOpenAqBudget,
  takeOpenAqKey,
  takeOpenAqKeyOrWait,
  takeOpenAqSlot,
} from "../src/openaqBudget.js";

describe("OpenAQ budget", () => {
  test("one minute stays within 60 calls on the legacy single-slot helper", () => {
    resetOpenAqBudget();
    for (let i = 0; i < 60; i++) expect(takeOpenAqSlot(1_000)).toBe(true);
    expect(takeOpenAqSlot(1_000)).toBe(false);
    expect(takeOpenAqSlot(61_001)).toBe(true);
    resetOpenAqBudget();
  });

  test("multiple keys each get a 60/min budget and rotate", () => {
    resetOpenAqBudget();
    const keys = ["a", "b", "c"];
    const seen: string[] = [];
    for (let i = 0; i < 6; i++) {
      const key = takeOpenAqKey(keys, 5_000);
      expect(key).toBeTruthy();
      seen.push(key!);
    }
    expect(new Set(seen).size).toBe(3);
    expect(seen.filter((k) => k === "a").length).toBe(2);
    expect(openAqBudgetStatus(5_000, keys.length)).toEqual({
      used: 6,
      limit: 180,
      keys: 3,
      cooling: 0,
      last429: null,
    });

    for (let i = 0; i < 174; i++) expect(takeOpenAqKey(keys, 5_000)).toBeTruthy();
    expect(takeOpenAqKey(keys, 5_000)).toBeNull();
    expect(openAqBudgetStatus(5_000, keys.length).used).toBe(180);
    resetOpenAqBudget();
  });

  test("a 429 cools only that key", () => {
    resetOpenAqBudget();
    noteOpenAq429({ key: "hot", retryAfterSec: 30, at: 10_000 });
    expect(takeOpenAqKey(["hot", "cold"], 10_000)).toBe("cold");
    expect(takeOpenAqKey(["hot"], 10_000)).toBeNull();
    expect(takeOpenAqKey(["hot"], 10_000 + 31_000)).toBe("hot");
    expect(openAqBudgetStatus(10_000, 2).cooling).toBe(1);
    resetOpenAqBudget();
  });

  test("msUntilOpenAqKey reports when the oldest slot ages out", () => {
    resetOpenAqBudget();
    const keys = ["only"];
    for (let i = 0; i < 60; i++) expect(takeOpenAqKey(keys, 1_000)).toBeTruthy();
    expect(takeOpenAqKey(keys, 1_000)).toBeNull();
    expect(msUntilOpenAqKey(keys, 1_000)).toBe(60_000);
    expect(msUntilOpenAqKey(keys, 1_000 + 60_000)).toBe(0);
    resetOpenAqBudget();
  });

  test("takeOpenAqKeyOrWait succeeds after slot age-out", async () => {
    resetOpenAqBudget();
    const keys = ["only"];
    const clock = { now: 1_000 };
    for (let i = 0; i < 60; i++) expect(takeOpenAqKey(keys, clock.now)).toBeTruthy();
    expect(takeOpenAqKey(keys, clock.now)).toBeNull();

    const key = await takeOpenAqKeyOrWait(keys, {
      clock,
      maxWaitMs: 70_000,
      sleep: async () => undefined,
    });
    expect(key).toBe("only");
    expect(clock.now).toBeGreaterThanOrEqual(1_000 + 60_000);
    resetOpenAqBudget();
  });

  test("takeOpenAqKeyOrWait times out when capped", async () => {
    resetOpenAqBudget();
    const keys = ["only"];
    const clock = { now: 1_000 };
    for (let i = 0; i < 60; i++) expect(takeOpenAqKey(keys, clock.now)).toBeTruthy();

    await expect(
      takeOpenAqKeyOrWait(keys, {
        clock,
        maxWaitMs: 5_000,
        sleep: async () => undefined,
      }),
    ).rejects.toThrow("OpenAQ budget");
    resetOpenAqBudget();
  });
});
