export type Role = "resident" | "operator";

export type Permission =
  | "me.read"
  | "me.write"
  | "report.auth"
  | "incidents.read"
  | "incidents.act"
  | "copilot"
  | "dlq.read"
  | "dlq.replay"
  | "system.mode"
  | "system.tick"
  | "api_keys.create";

const RESIDENT_PERMS: readonly Permission[] = ["me.read", "me.write", "report.auth"];

const OPERATOR_PERMS: readonly Permission[] = [
  ...RESIDENT_PERMS,
  "incidents.read",
  "incidents.act",
  "copilot",
  "dlq.read",
  "dlq.replay",
  "system.mode",
  "system.tick",
  "api_keys.create",
];

export function rolePermissions(role: Role): readonly Permission[] {
  return role === "operator" ? OPERATOR_PERMS : RESIDENT_PERMS;
}

export function hasPermission(role: Role, permission: Permission): boolean {
  return rolePermissions(role).includes(permission);
}

/** Operator is a flag on the stored account. Nothing in the environment grants it. */
export function resolveRole(input: { storedRole?: Role }): Role {
  return input.storedRole === "operator" ? "operator" : "resident";
}
