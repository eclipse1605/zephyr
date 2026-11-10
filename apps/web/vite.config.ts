import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

function readRepoEnv(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of [".env", ".env.local"]) {
    const file = path.join(dir, name);
    if (!existsSync(file)) continue;
    for (const line of readFileSync(file, "utf8").split("\n")) {
      const text = line.trim();
      if (!text || text.startsWith("#") || !text.includes("=")) continue;
      const cut = text.indexOf("=");
      const key = text.slice(0, cut).trim();
      const value = text.slice(cut + 1).trim().replace(/^['"]|['"]$/g, "");
      out[key] = value;
    }
  }
  return out;
}

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const repoEnv = readRepoEnv(repoRoot);
const apiPort = process.env.API_PORT || repoEnv.API_PORT || "8080";
const apiProxy = process.env.API_PROXY || repoEnv.API_PROXY || `http://127.0.0.1:${apiPort}`;

function firebaseEnv(key: string, fallback = ""): string {
  return process.env[`VITE_${key}`] || repoEnv[`VITE_${key}`] || process.env[`NEXT_PUBLIC_${key}`] || repoEnv[`NEXT_PUBLIC_${key}`] || repoEnv[key] || fallback;
}

export default defineConfig({
  plugins: [react()],
  define: {
    "import.meta.env.VITE_FIREBASE_API_KEY": JSON.stringify(firebaseEnv("FIREBASE_API_KEY", repoEnv.FIREBASE_API_KEY || "")),
    "import.meta.env.VITE_FIREBASE_AUTH_DOMAIN": JSON.stringify(firebaseEnv("FIREBASE_AUTH_DOMAIN")),
    "import.meta.env.VITE_FIREBASE_PROJECT_ID": JSON.stringify(firebaseEnv("FIREBASE_PROJECT_ID", repoEnv.FIREBASE_PROJECT_ID || "")),
    "import.meta.env.VITE_FIREBASE_APP_ID": JSON.stringify(firebaseEnv("FIREBASE_APP_ID")),
  },
  server: {
    // localhost (not 127.0.0.1): Firebase Authorized domains include localhost by default;
    // Google popup sign-in fails on 127.0.0.1 with "The requested action is invalid."
    host: "localhost",
    port: 5173,
    // Keep the Google/Firebase auth popup able to talk back to this page.
    headers: {
      "Cross-Origin-Opener-Policy": "same-origin-allow-popups",
    },
    proxy: {
      "/api": {
        target: apiProxy,
        changeOrigin: true,
      },
    },
  },
});
