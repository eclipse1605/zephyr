#!/usr/bin/env bun
/**
 * Enable Firebase Authentication → Google for project cleanair-abcf0 (or FIREBASE_PROJECT_ID).
 *
 * Firebase needs a Web OAuth client id + secret. Create one at:
 *   https://console.cloud.google.com/apis/credentials?project=cleanair-abcf0
 * Application type: Web application
 * Authorized JavaScript origins:
 *   http://localhost
 *   http://localhost:5173
 *   https://cleanair-abcf0.firebaseapp.com
 *   https://cleanair-abcf0.web.app
 * Authorized redirect URIs:
 *   https://cleanair-abcf0.firebaseapp.com/__/auth/handler
 *
 * Or flip Google on in the Firebase console (it can mint the client for you):
 *   https://console.firebase.google.com/project/cleanair-abcf0/authentication/providers
 *
 * Then run:
 *   GOOGLE_OAUTH_CLIENT_ID=... GOOGLE_OAUTH_CLIENT_SECRET=... bun scripts/enable-google-auth.ts
 *
 * With no args, only reports whether Google sign-in is already configured.
 */
import { createSign } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

function loadEnvFile(file: string) {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const text = line.trim();
    if (!text || text.startsWith("#") || !text.includes("=")) continue;
    const cut = text.indexOf("=");
    const key = text.slice(0, cut).trim();
    const value = text.slice(cut + 1).trim().replace(/^['"]|['"]$/g, "");
    if (!(key in process.env)) process.env[key] = value;
  }
}

const root = path.resolve(import.meta.dir, "..");
loadEnvFile(path.join(root, ".env.local"));
loadEnvFile(path.join(root, ".env"));

function serviceAccount(): { project_id: string; client_email: string; private_key: string } {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_KEY?.trim();
  if (!raw) throw new Error("FIREBASE_SERVICE_ACCOUNT_KEY missing");
  let json: { project_id: string; client_email: string; private_key: string };
  try {
    json = JSON.parse(raw);
  } catch {
    json = JSON.parse(Buffer.from(raw, "base64").toString("utf8"));
  }
  json.private_key = json.private_key.replace(/\\n/g, "\n");
  return json;
}

async function accessToken(sa: { client_email: string; private_key: string }): Promise<string> {
  const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const claim = Buffer.from(
    JSON.stringify({
      iss: sa.client_email,
      sub: sa.client_email,
      aud: "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600,
      scope: "https://www.googleapis.com/auth/identitytoolkit https://www.googleapis.com/auth/firebase https://www.googleapis.com/auth/cloud-platform",
    }),
  ).toString("base64url");
  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${claim}`);
  signer.end();
  const jwt = `${header}.${claim}.${signer.sign(sa.private_key).toString("base64url")}`;
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });
  const body = (await res.json()) as { access_token?: string; error?: string };
  if (!body.access_token) throw new Error(`token exchange failed: ${JSON.stringify(body)}`);
  return body.access_token;
}

async function googleConfigured(apiKey: string): Promise<boolean> {
  const res = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:createAuthUri?key=${encodeURIComponent(apiKey)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ providerId: "google.com", continueUri: "http://localhost:5173" }),
  });
  if (!res.ok) return false;
  const body = (await res.json()) as { authUri?: string };
  return Boolean(body.authUri);
}

async function main() {
  const sa = serviceAccount();
  const projectId =
    process.env.FIREBASE_PROJECT_ID?.trim() ||
    process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID?.trim() ||
    sa.project_id;
  const apiKey =
    process.env.NEXT_PUBLIC_FIREBASE_API_KEY?.trim() ||
    process.env.VITE_FIREBASE_API_KEY?.trim() ||
    process.env.FIREBASE_API_KEY?.trim() ||
    "";
  if (!apiKey) throw new Error("Firebase API key missing");

  const already = await googleConfigured(apiKey);
  if (already) {
    console.log(JSON.stringify({ ok: true, projectId, googleSignIn: true, action: "noop" }));
    return;
  }

  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID?.trim() || "";
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET?.trim() || "";
  if (!clientId || !clientSecret) {
    console.log(
      JSON.stringify(
        {
          ok: false,
          projectId,
          googleSignIn: false,
          error: "provider_missing",
          enableInConsole: `https://console.firebase.google.com/project/${projectId}/authentication/providers`,
          orRunWith: "GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET",
        },
        null,
        2,
      ),
    );
    process.exit(2);
  }

  const token = await accessToken(sa);
  const uri = `https://identitytoolkit.googleapis.com/admin/v2/projects/${projectId}/defaultSupportedIdpConfigs?idpId=google.com`;
  const res = await fetch(uri, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name: `projects/${projectId}/defaultSupportedIdpConfigs/google.com`,
      enabled: true,
      clientId,
      clientSecret,
    }),
  });
  const body = await res.json();
  if (!res.ok && res.status !== 409) {
    console.error(JSON.stringify({ ok: false, status: res.status, body }, null, 2));
    process.exit(1);
  }
  if (res.status === 409) {
    const patch = await fetch(
      `https://identitytoolkit.googleapis.com/admin/v2/projects/${projectId}/defaultSupportedIdpConfigs/google.com?updateMask=enabled,clientId,clientSecret`,
      {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ enabled: true, clientId, clientSecret }),
      },
    );
    const patched = await patch.json();
    if (!patch.ok) {
      console.error(JSON.stringify({ ok: false, status: patch.status, body: patched }, null, 2));
      process.exit(1);
    }
  }

  const enabled = await googleConfigured(apiKey);
  console.log(JSON.stringify({ ok: enabled, projectId, googleSignIn: enabled, action: "enabled" }));
  if (!enabled) process.exit(1);
}

await main();
