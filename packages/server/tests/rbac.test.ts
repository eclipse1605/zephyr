import { describe, expect, test } from "bun:test";
import { hasPermission, resolveRole, rolePermissions } from "../src/rbac.js";

describe("rbac", () => {
  test("resident permissions are the me/report set", () => {
    expect([...rolePermissions("resident")]).toEqual(["me.read", "me.write", "report.auth"]);
  });

  test("operator permissions include queue and pipeline", () => {
    const perms = rolePermissions("operator");
    expect(hasPermission("operator", "incidents.act")).toBe(true);
    expect(hasPermission("operator", "dlq.replay")).toBe(true);
    expect(hasPermission("operator", "system.tick")).toBe(true);
    expect(hasPermission("resident", "incidents.act")).toBe(false);
    expect(perms).toContain("api_keys.create");
  });

  test("resolveRole is only the stored account flag", () => {
    expect(resolveRole({ storedRole: "operator" })).toBe("operator");
    expect(resolveRole({ storedRole: "resident" })).toBe("resident");
    expect(resolveRole({})).toBe("resident");
  });
});
