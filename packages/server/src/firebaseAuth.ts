import { createPublicKey, createVerify } from "node:crypto";
import { resolveRole, type Role } from "./rbac.js";

export type SessionUser = { uid: string; email: string; role: Role; operator: boolean };

export type EmulatorAccount = {
  localId: string;
  email?: string;
  customAttributes?: string;
};

type TokenClaims = {
  sub?: string;
  user_id?: string;
  email?: string;
  email_verified?: boolean;
  aud?: string;
  iss?: string;
  exp?: number;
  iat?: number;
  operator?: boolean;
};

let cachedCerts: { at: number; map: Map<string, string> } | null = null;

function session(uid: string, email: string, role: Role): SessionUser {
  return { uid, email, role, operator: role === "operator" };
}

/** Dev bearer tokens. Both prefixes sign in as a resident until the stored account says operator. */
export function devSession(token: string, enabled: boolean): SessionUser | null {
  if (!enabled) return null;
  const prefix = token.startsWith("demo:") ? "demo:" : token.startsWith("operator:") ? "operator:" : null;
  if (!prefix) return null;
  const email = token.slice(prefix.length).trim().toLowerCase();
  if (!email) return null;
  return session(email, email, "resident");
}

export function sessionFromAccount(account: EmulatorAccount, storedRole: Role | undefined): SessionUser | null {
  const email = account.email?.trim().toLowerCase();
  if (!account.localId || !email) return null;
  return session(account.localId, email, resolveRole({ storedRole }));
}

export async function lookupEmulatorAccount(host: string, idToken: string, apiKey: string): Promise<EmulatorAccount | null> {
  const response = await fetch(`http://${host}/identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(apiKey)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ idToken }),
  });
  if (!response.ok) return null;
  const body = (await response.json()) as { users?: EmulatorAccount[] };
  return body.users?.[0] ?? null;
}

function b64urlJson(part: string): Record<string, unknown> | null {
  try {
    const padded = part.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (part.length % 4)) % 4);
    return JSON.parse(Buffer.from(padded, "base64").toString("utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function googleSecureTokenCerts(): Promise<Map<string, string>> {
  const now = Date.now();
  if (cachedCerts && now - cachedCerts.at < 60 * 60 * 1000) return cachedCerts.map;
  const res = await fetch("https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com");
  if (!res.ok) throw new Error("cert_fetch_failed");
  const body = (await res.json()) as Record<string, string>;
  const map = new Map(Object.entries(body));
  cachedCerts = { at: now, map };
  return map;
}

function verifyRs256(token: string, pem: string): boolean {
  const [header, payload, signature] = token.split(".");
  if (!header || !payload || !signature) return false;
  const verifier = createVerify("RSA-SHA256");
  verifier.update(`${header}.${payload}`);
  verifier.end();
  const key = createPublicKey(pem);
  const sig = Buffer.from(signature.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (signature.length % 4)) % 4), "base64");
  return verifier.verify(key, sig);
}

function projectId(): string {
  return (
    process.env.FIREBASE_PROJECT_ID?.trim() ||
    process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID?.trim() ||
    process.env.VITE_FIREBASE_PROJECT_ID?.trim() ||
    process.env.ZEPHYR_PROJECT_ID?.trim() ||
    ""
  );
}

/** Verify a Firebase ID token with Google's securetoken certs. */
export async function verifyFirebaseIdToken(token: string): Promise<TokenClaims | null> {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const header = b64urlJson(parts[0]!);
  const payload = b64urlJson(parts[1]!) as TokenClaims | null;
  if (!header || !payload) return null;
  const kid = typeof header.kid === "string" ? header.kid : "";
  const alg = typeof header.alg === "string" ? header.alg : "";
  if (alg !== "RS256" || !kid) return null;
  const pid = projectId();
  if (!pid) return null;
  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp !== "number" || payload.exp < now) return null;
  if (typeof payload.iat === "number" && payload.iat > now + 60) return null;
  if (payload.aud !== pid) return null;
  if (payload.iss !== `https://securetoken.google.com/${pid}`) return null;
  try {
    const certs = await googleSecureTokenCerts();
    const pem = certs.get(kid);
    if (!pem || !verifyRs256(token, pem)) return null;
  } catch {
    return null;
  }
  return payload;
}

/** True when Firebase Auth has a Google provider config (createAuthUri succeeds). */
export async function probeGoogleSignIn(apiKey: string, continueUri = "http://localhost:5173"): Promise<boolean> {
  const key = apiKey.trim();
  if (!key) return false;
  try {
    const res = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:createAuthUri?key=${encodeURIComponent(key)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ providerId: "google.com", continueUri }),
      signal: AbortSignal.timeout(2_500),
    });
    if (!res.ok) return false;
    const body = (await res.json()) as { authUri?: string };
    return Boolean(body.authUri);
  } catch {
    return false;
  }
}

/** Last-resort Google ID token check (no audience binding). Role comes from the stored account. */
export async function lookupGoogleTokenInfo(token: string): Promise<{ sub: string; email: string } | null> {
  try {
    const res = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(token)}`);
    if (!res.ok) return null;
    const info = (await res.json()) as { sub?: string; email?: string };
    if (!info.email || !info.sub) return null;
    return { sub: info.sub, email: info.email.toLowerCase() };
  } catch {
    return null;
  }
}

export function sessionFromClaims(claims: TokenClaims, storedRole: Role | undefined): SessionUser | null {
  const email = claims.email?.trim().toLowerCase();
  const uid = (claims.user_id || claims.sub || "").trim();
  if (!email || !uid) return null;
  return session(uid, email, resolveRole({ storedRole }));
}
