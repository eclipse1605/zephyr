import { openStore } from "./store.js";

const host = process.env.FIREBASE_AUTH_EMULATOR_HOST?.trim();
const apiKey = process.env.FIREBASE_API_KEY?.trim() || "demo-key";
const projectId = process.env.FIREBASE_PROJECT_ID?.trim() || "zephyr-local";
const email = process.env.BOOTSTRAP_OPERATOR_EMAIL?.trim().toLowerCase();
const password = process.env.BOOTSTRAP_OPERATOR_PASSWORD ?? "";

async function emulator(pathName: string, body: unknown, privileged = false) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (privileged) headers.authorization = "Bearer owner";
  const response = await fetch(`http://${host}${pathName}?key=${encodeURIComponent(apiKey)}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));
  return { ok: response.ok, payload: payload as Record<string, unknown> };
}

if (!host || !email || password.length < 6) {
  console.error("set FIREBASE_AUTH_EMULATOR_HOST, BOOTSTRAP_OPERATOR_EMAIL, and a password of at least 6 characters");
  process.exit(1);
}

const signed = await emulator("/identitytoolkit.googleapis.com/v1/accounts:signUp", { email, password, returnSecureToken: true });
const account = signed.ok
  ? signed.payload
  : (await emulator("/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword", { email, password, returnSecureToken: true })).payload;
const localId = String(account.localId ?? "");
if (!localId) {
  console.error("emulator did not return a user");
  process.exit(1);
}
const updated = await emulator(
  `/identitytoolkit.googleapis.com/v1/projects/${projectId}/accounts:update`,
  { localId, customAttributes: JSON.stringify({ operator: true }) },
  true,
);
if (!updated.ok) {
  console.error("could not set the operator claim");
  process.exit(1);
}
const store = await openStore();
await store.update((db) => {
  db.users[localId] = { uid: localId, email, role: "operator" };
});
if ("close" in store && typeof store.close === "function") await store.close();
console.log(JSON.stringify({ email, uid: localId, role: "operator" }));
