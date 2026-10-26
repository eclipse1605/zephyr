import path from "node:path";

export function resolveFromRoot(root: string, p: string | undefined, fallback: string): string {
  if (!p) return fallback;
  return path.isAbsolute(p) ? p : path.join(root, p);
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function envPort(name: string): number | undefined {
  const raw = process.env[name]?.trim();
  if (!raw) return undefined;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

/** Cloud Run sets PORT=8080 on every service. A shared .env PORT must not pin api and worker to the same local port. */
export function resolveListenPort(role: "api" | "worker"): number {
  const cloud = Boolean(process.env.K_SERVICE);
  if (role === "worker") {
    return envPort("WORKER_PORT") ?? (cloud ? envPort("PORT") : undefined) ?? 8081;
  }
  return envPort("API_PORT") ?? envPort("PORT") ?? 8080;
}
