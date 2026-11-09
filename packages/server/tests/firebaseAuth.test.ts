import { describe, expect, test } from "bun:test";
import { devSession, sessionFromAccount } from "../src/firebaseAuth.js";

describe("firebase sessions", () => {
  test("demo tokens are rejected when dev auth is off", () => {
    expect(devSession("demo:resident@zephyr.local", false, new Set(["resident@zephyr.local"]))).toBeNull();
    expect(devSession("operator:op@zephyr.local", false, new Set(["op@zephyr.local"]))).toBeNull();
  });

  test("a resident claim cannot open operator actions", () => {
    const session = sessionFromAccount({ localId: "abc12345", email: "Resident@Zephyr.local" }, "resident");
    expect(session).toEqual({ uid: "abc12345", email: "resident@zephyr.local", operator: false });
  });

  test("an operator claim or stored role can open operator actions", () => {
    const fromClaim = sessionFromAccount(
      { localId: "abc12345", email: "op@zephyr.local", customAttributes: JSON.stringify({ operator: true }) },
      undefined,
    );
    const fromStore = sessionFromAccount({ localId: "abc12345", email: "op@zephyr.local" }, "operator");
    expect(fromClaim?.operator).toBe(true);
    expect(fromStore?.operator).toBe(true);
  });
});
