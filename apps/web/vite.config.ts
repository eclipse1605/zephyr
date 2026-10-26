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
const apiPort = process.env.API_PORT || repoEnv.API_PORT || "8090";
const apiProxy = process.env.API_PROXY || repoEnv.API_PROXY || `http://127.0.0.1:${apiPort}`;

export default defineConfig({
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 5173,
    proxy: {
      "/api": {
        target: apiProxy,
        changeOrigin: true,
      },
    },
  },
});
