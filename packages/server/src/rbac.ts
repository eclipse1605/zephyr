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

export function resolveRole(input: {
  email: string;
  claimOperator?: boolean;
  storedRole?: Role;
  operatorEmails: Set<string>;
}): Role {
  const email = input.email.trim().toLowerCase();
  if (input.storedRole === "operator") return "operator";
  if (input.claimOperator) return "operator";
  if (email && input.operatorEmails.has(email)) return "operator";
  return "resident";
}

export function parseOperatorEmails(raw: string | undefined): Set<string> {
  return new Set(
    (raw ?? "")
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
  );
}
