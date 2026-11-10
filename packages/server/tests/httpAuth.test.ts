import { describe, expect, test } from "bun:test";
import { authenticateBearer, whoamiPayload } from "../src/httpAuth.js";
import { emptyDb, type Db } from "../src/store.js";

function memoryStore(seed: Db = emptyDb()) {
  let db = seed;
  return {
    read: async () => db,
    update: async (fn: (next: Db) => void) => {
      fn(db);
      return db;
    },
  };
}

describe("authenticateBearer", () => {
  test("dev resident tokens never become operator", async () => {
    const store = memoryStore();
    const user = await authenticateBearer("Bearer demo:op@zephyr.local", store, {
      devAuth: true,
      operatorEmails: "op@zephyr.local",
    });
    expect(user?.operator).toBe(false);
    expect(user?.role).toBe("resident");
    expect(whoamiPayload(user!).permissions).toEqual(["me.read", "me.write", "report.auth"]);
  });

  test("dev operator tokens require allowlist and upsert the store role", async () => {
    const store = memoryStore();
    const user = await authenticateBearer("Bearer operator:op@zephyr.local", store, {
      devAuth: true,
      operatorEmails: "op@zephyr.local",
    });
    expect(user?.operator).toBe(true);
    expect(user?.role).toBe("operator");
    const db = await store.read();
    expect(Object.values(db.users)[0]?.role).toBe("operator");
    expect(whoamiPayload(user!).permissions).toContain("incidents.act");
  });

  test("missing bearer is rejected", async () => {
    const store = memoryStore();
    expect(await authenticateBearer(undefined, store, { devAuth: true })).toBeNull();
  });
});
