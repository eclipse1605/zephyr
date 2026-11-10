import type { FileStore } from "./store.js";
import { sha256 } from "./store.js";
import {
  devSession,
  lookupEmulatorAccount,
  lookupGoogleTokenInfo,
  sessionFromAccount,
  sessionFromClaims,
  verifyFirebaseIdToken,
  type SessionUser,
} from "./firebaseAuth.js";
import { hasPermission, parseOperatorEmails, rolePermissions, type Permission, type Role } from "./rbac.js";

export type AuthStore = Pick<FileStore, "read" | "update">;

async function upsertUser(store: AuthStore, session: SessionUser): Promise<SessionUser> {
  let role: Role = session.role;
  await store.update((db) => {
    const previous = db.users[session.uid];
    const kept: Role = previous?.role === "operator" || session.role === "operator" ? "operator" : "resident";
    db.users[session.uid] = { uid: session.uid, email: session.email, role: kept };
    role = kept;
  });
  return { ...session, role, operator: role === "operator" };
}

export async function authenticateBearer(
  authorization: string | undefined,
  store: AuthStore,
  env: {
    devAuth?: boolean;
    operatorEmails?: string;
    emulatorHost?: string;
    apiKey?: string;
  } = {},
): Promise<SessionUser | null> {
  const header = authorization ?? "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) return null;
  const token = match[1]!;
  const operators = parseOperatorEmails(env.operatorEmails ?? process.env.OPERATOR_EMAILS);
  const devEnabled = env.devAuth ?? process.env.ZEPHYR_DEV_AUTH === "1";
  const dev = devSession(token, devEnabled, operators);
  if (dev) {
    const uid = sha256(dev.email).slice(0, 16);
    return upsertUser(store, { ...dev, uid });
  }

  const emulator = (env.emulatorHost ?? process.env.FIREBASE_AUTH_EMULATOR_HOST)?.trim();
  if (emulator) {
    const account = await lookupEmulatorAccount(
      emulator,
      token,
      env.apiKey ?? (process.env.FIREBASE_API_KEY?.trim() || "demo-key"),
    );
    if (!account) return null;
    const db = await store.read();
    const session = sessionFromAccount(account, db.users[account.localId]?.role, operators);
    if (!session) return null;
    return upsertUser(store, session);
  }

  const claims = await verifyFirebaseIdToken(token);
  if (claims) {
    const db = await store.read();
    const uid = (claims.user_id || claims.sub || "").trim();
    const session = sessionFromClaims(claims, db.users[uid]?.role, operators);
    if (!session) return null;
    return upsertUser(store, session);
  }

  const google = await lookupGoogleTokenInfo(token);
  if (!google) return null;
  const db = await store.read();
  const role = operators.has(google.email) || db.users[google.sub]?.role === "operator" ? "operator" : "resident";
  return upsertUser(store, { uid: google.sub, email: google.email, role, operator: role === "operator" });
}

export function whoamiPayload(user: SessionUser) {
  return {
    email: user.email,
    role: user.role,
    operator: user.operator,
    permissions: [...rolePermissions(user.role)],
  };
}

export function userHasPermission(user: SessionUser, permission: Permission): boolean {
  return hasPermission(user.role, permission) || (user.operator && hasPermission("operator", permission));
}
