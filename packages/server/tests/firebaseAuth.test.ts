import { describe, expect, test } from "bun:test";
import { devSession, sessionFromAccount, sessionFromClaims } from "../src/firebaseAuth.js";
import { resolveRole } from "../src/rbac.js";

describe("firebase sessions", () => {
  test("demo tokens are rejected when dev auth is off", () => {
    expect(devSession("demo:resident@zephyr.local", false)).toBeNull();
    expect(devSession("operator:op@zephyr.local", false)).toBeNull();
  });

  test("demo tokens never grant operator", () => {
    const session = devSession("demo:op@zephyr.local", true);
    expect(session).toEqual({
      uid: "op@zephyr.local",
      email: "op@zephyr.local",
      role: "resident",
      operator: false,
    });
  });

  test("the operator prefix does not grant operator", () => {
    expect(devSession("operator:op@zephyr.local", true)?.operator).toBe(false);
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

  test("only a stored operator role opens operator actions", () => {
    const fromClaim = sessionFromAccount(
      { localId: "abc12345", email: "op@zephyr.local", customAttributes: JSON.stringify({ operator: true }) },
      undefined,
    );
    const fromStore = sessionFromAccount({ localId: "abc12345", email: "op@zephyr.local" }, "operator");
    expect(fromClaim?.operator).toBe(false);
    expect(fromStore?.operator).toBe(true);
  });

  test("a stored resident stays a resident", () => {
    const session = sessionFromAccount({ localId: "abc12345", email: "op@zephyr.local" }, "resident");
    expect(resolveRole({ storedRole: "resident" })).toBe("resident");
    expect(session?.operator).toBe(false);
  });

  test("sessionFromClaims ignores a custom operator claim without a stored flag", () => {
    const session = sessionFromClaims({ sub: "uid1", email: "op@zephyr.local", operator: true }, undefined);
    expect(session?.role).toBe("resident");
    expect(sessionFromClaims({ sub: "uid1", email: "op@zephyr.local" }, "operator")?.role).toBe("operator");
  });
});
