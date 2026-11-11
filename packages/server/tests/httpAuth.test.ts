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
    const user = await authenticateBearer("Bearer demo:op@zephyr.local", store, { devAuth: true });
    expect(user?.operator).toBe(false);
    expect(user?.role).toBe("resident");
    expect(whoamiPayload(user!).permissions).toEqual(["me.read", "me.write", "report.auth"]);
  });

  test("a stored operator flag is kept on the next sign-in", async () => {
    const store = memoryStore();
    const first = await authenticateBearer("Bearer demo:op@zephyr.local", store, { devAuth: true });
    expect(first?.role).toBe("resident");
    const db = await store.read();
    const row = Object.values(db.users)[0]!;
    row.role = "operator";
    const again = await authenticateBearer("Bearer demo:op@zephyr.local", store, { devAuth: true });
    expect(again?.role).toBe("operator");
    expect(again?.operator).toBe(true);
    expect(whoamiPayload(again!).permissions).toContain("incidents.act");
  });

  test("missing bearer is rejected", async () => {
    const store = memoryStore();
    expect(await authenticateBearer(undefined, store, { devAuth: true })).toBeNull();
  });
});
