import { describe, expect, test } from "bun:test";
import { hasPermission, parseOperatorEmails, resolveRole, rolePermissions } from "../src/rbac.js";

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

  test("resolveRole prefers stored operator, then claim, then allowlist", () => {
    const emails = new Set(["op@zephyr.local"]);
    expect(resolveRole({ email: "a@x.com", storedRole: "operator", operatorEmails: emails })).toBe("operator");
    expect(resolveRole({ email: "a@x.com", claimOperator: true, operatorEmails: emails })).toBe("operator");
    expect(resolveRole({ email: "op@zephyr.local", operatorEmails: emails })).toBe("operator");
    expect(resolveRole({ email: "a@x.com", operatorEmails: emails })).toBe("resident");
  });

  test("parseOperatorEmails trims and lowercases", () => {
    expect([...parseOperatorEmails(" Op@Zephyr.local , other@x.com ")].sort()).toEqual([
      "op@zephyr.local",
      "other@x.com",
    ]);
  });
});
