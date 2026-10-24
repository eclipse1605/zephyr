import path from "node:path";

export function resolveFromRoot(root: string, p: string | undefined, fallback: string): string {
  if (!p) return fallback;
  return path.isAbsolute(p) ? p : path.join(root, p);
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
