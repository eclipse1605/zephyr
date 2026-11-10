import { initializeApp, type FirebaseApp } from "firebase/app";
import {
  connectAuthEmulator,
  createUserWithEmailAndPassword,
  getAuth,
  getRedirectResult,
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signInWithPopup,
  signInWithRedirect,
  signOut,
  type Auth as FirebaseAuth,
  type User,
} from "firebase/auth";

export type FirebaseClientConfig = {
  apiKey: string;
  authDomain: string;
  projectId: string;
  appId?: string;
};

let app: FirebaseApp | null = null;
let auth: FirebaseAuth | null = null;
let emulatorConnected = false;

function envConfig(): FirebaseClientConfig | null {
  const apiKey = import.meta.env.VITE_FIREBASE_API_KEY?.trim() || "";
  const projectId = import.meta.env.VITE_FIREBASE_PROJECT_ID?.trim() || "";
  if (!apiKey || !projectId) return null;
  const authDomain = import.meta.env.VITE_FIREBASE_AUTH_DOMAIN?.trim() || `${projectId}.firebaseapp.com`;
  return {
    apiKey,
    authDomain,
    projectId,
    appId: import.meta.env.VITE_FIREBASE_APP_ID?.trim() || "",
  };
}

export function firebaseConfigured(config?: FirebaseClientConfig | null): boolean {
  const cfg = config ?? envConfig();
  return Boolean(cfg?.apiKey && cfg?.projectId);
}

export function initFirebase(config?: FirebaseClientConfig | null, emulatorHost?: string | null): FirebaseAuth | null {
  const cfg = config?.apiKey && config.projectId ? config : envConfig();
  if (!cfg) return null;
  if (!app) {
    app = initializeApp({
      apiKey: cfg.apiKey,
      authDomain: cfg.authDomain || `${cfg.projectId}.firebaseapp.com`,
      projectId: cfg.projectId,
      ...(cfg.appId ? { appId: cfg.appId } : {}),
    });
    auth = getAuth(app);
  }
  if (emulatorHost && auth && !emulatorConnected) {
    const host = emulatorHost.includes("://") ? emulatorHost : `http://${emulatorHost}`;
    connectAuthEmulator(auth, host, { disableWarnings: true });
    emulatorConnected = true;
  }
  return auth;
}

export function firebaseAuth(): FirebaseAuth | null {
  return auth;
}

export async function signInEmail(email: string, password: string): Promise<{ idToken: string; email: string }> {
  const client = auth ?? initFirebase();
  if (!client) throw new Error("firebase_unconfigured");
  let credential;
  try {
    credential = await signInWithEmailAndPassword(client, email, password);
  } catch {
    credential = await createUserWithEmailAndPassword(client, email, password);
  }
  const idToken = await credential.user.getIdToken();
  return { idToken, email: credential.user.email ?? email };
}

function authErrorMessage(err: unknown): string {
  const code = typeof err === "object" && err && "code" in err ? String((err as { code?: string }).code || "") : "";
  const message = err instanceof Error ? err.message : String(err || "sign_in_failed");
  if (code === "auth/operation-not-allowed" || /identity provider configuration is not found/i.test(message)) {
    return "Google sign-in is not enabled for this Firebase project. Enable Google under Authentication → Sign-in method, then try again.";
  }
  if (code === "auth/unauthorized-domain" || /unauthorized.?domain/i.test(message)) {
    return "This domain is not authorized for Firebase Auth. Use http://localhost:5173 or add the host under Authentication → Settings → Authorized domains.";
  }
  if (code === "auth/popup-blocked") {
    return "The Google sign-in popup was blocked. Allow popups for this site, or try again.";
  }
  if (code === "auth/popup-closed-by-user" || code === "auth/cancelled-popup-request") {
    return "Google sign-in was cancelled.";
  }
  if (message.includes("localhost:5173") || message.includes("127.0.0.1")) return message;
  return code ? `Google sign-in failed (${code}).` : message;
}

export async function completeGoogleRedirect(): Promise<{ idToken: string; email: string } | null> {
  const client = auth ?? initFirebase();
  if (!client) return null;
  const credential = await getRedirectResult(client);
  if (!credential?.user) return null;
  const idToken = await credential.user.getIdToken();
  return { idToken, email: credential.user.email ?? "" };
}

export async function signInGoogle(): Promise<{ idToken: string; email: string }> {
  const client = auth ?? initFirebase();
  if (!client) throw new Error("firebase_unconfigured");
  // Firebase Authorizes `localhost` by default; `127.0.0.1` is a different host and
  // the auth handler rejects it with "The requested action is invalid."
  if (typeof location !== "undefined" && location.hostname === "127.0.0.1") {
    throw new Error("Open http://localhost:5173 for Google sign-in (or add 127.0.0.1 under Firebase Authentication → Settings → Authorized domains).");
  }
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });
  try {
    const credential = await signInWithPopup(client, provider);
    const idToken = await credential.user.getIdToken();
    return { idToken, email: credential.user.email ?? "" };
  } catch (err) {
    const code = typeof err === "object" && err && "code" in err ? String((err as { code?: string }).code || "") : "";
    if (code === "auth/popup-blocked" || code === "auth/popup-closed-by-user") {
      await signInWithRedirect(client, provider);
      return new Promise(() => undefined);
    }
    throw new Error(authErrorMessage(err));
  }
}

export async function firebaseSignOut(): Promise<void> {
  if (!auth) return;
  await signOut(auth);
}

export function watchFirebaseUser(onUser: (user: User | null) => void): () => void {
  const client = auth ?? initFirebase();
  if (!client) {
    onUser(null);
    return () => undefined;
  }
  return onAuthStateChanged(client, onUser);
}

export async function refreshIdToken(user?: User | null): Promise<string | null> {
  const current = user ?? auth?.currentUser ?? null;
  if (!current) return null;
  return current.getIdToken();
}
