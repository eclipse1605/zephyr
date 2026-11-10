import { describe, expect, test } from "bun:test";
import { devSession, sessionFromAccount, sessionFromClaims } from "../src/firebaseAuth.js";
import { resolveRole } from "../src/rbac.js";

describe("firebase sessions", () => {
  test("demo tokens are rejected when dev auth is off", () => {
    expect(devSession("demo:resident@zephyr.local", false, new Set(["resident@zephyr.local"]))).toBeNull();
    expect(devSession("operator:op@zephyr.local", false, new Set(["op@zephyr.local"]))).toBeNull();
  });

  test("demo tokens never grant operator even when email is allowlisted", () => {
    const session = devSession("demo:op@zephyr.local", true, new Set(["op@zephyr.local"]));
    expect(session).toEqual({
      uid: "op@zephyr.local",
      email: "op@zephyr.local",
      role: "resident",
      operator: false,
    });
  });

  test("operator tokens require the allowlist", () => {
    expect(devSession("operator:op@zephyr.local", true, new Set(["op@zephyr.local"]))?.operator).toBe(true);
    expect(devSession("operator:stranger@zephyr.local", true, new Set(["op@zephyr.local"]))?.operator).toBe(false);
  });

  test("a resident claim cannot open operator actions", () => {
    const session = sessionFromAccount({ localId: "abc12345", email: "Resident@Zephyr.local" }, "resident");
    expect(session).toEqual({
      uid: "abc12345",
      email: "resident@zephyr.local",
      role: "resident",
      operator: false,
    });
  });

  test("an operator claim or stored role can open operator actions", () => {
    const fromClaim = sessionFromAccount(
      { localId: "abc12345", email: "op@zephyr.local", customAttributes: JSON.stringify({ operator: true }) },
      undefined,
    );
    const fromStore = sessionFromAccount({ localId: "abc12345", email: "op@zephyr.local" }, "operator");
    expect(fromClaim?.operator).toBe(true);
    expect(fromClaim?.role).toBe("operator");
    expect(fromStore?.operator).toBe(true);
  });

  test("operator email allowlist elevates emulator accounts without a claim", () => {
    const session = sessionFromAccount(
      { localId: "abc12345", email: "op@zephyr.local" },
      "resident",
      new Set(["op@zephyr.local"]),
    );
    // stored resident wins over allowlist only when stored is checked first — resolveRole
    // prefers storedRole === operator, then claim, then allowlist. resident stored does not block allowlist.
    expect(resolveRole({
      email: "op@zephyr.local",
      storedRole: "resident",
      operatorEmails: new Set(["op@zephyr.local"]),
    })).toBe("operator");
    expect(session?.operator).toBe(true);
  });

  test("sessionFromClaims maps custom operator claim", () => {
    const session = sessionFromClaims(
      { sub: "uid1", email: "op@zephyr.local", operator: true },
      undefined,
      new Set(),
    );
    expect(session).toEqual({
      uid: "uid1",
      email: "op@zephyr.local",
      role: "operator",
      operator: true,
    });
  });
});
