import { randomUUID } from "node:crypto";
import path from "node:path";

const ID_RE = /^[a-zA-Z0-9-]{8,64}$/;

export function safeObjectId(id: string): boolean {
  return ID_RE.test(id) && !id.includes("..");
}

export function containedPhotoPath(root: string, reportId: string): string {
  if (!safeObjectId(reportId)) throw new Error("bad_id");
  const dir = path.resolve(root, "photos");
  const file = path.resolve(dir, reportId);
  if (!file.startsWith(dir + path.sep)) throw new Error("bad_id");
  return file;
}

export function takeReportId(
  existing: Record<string, unknown>,
  requested: unknown,
): { ok: true; id: string } | { ok: false; status: 400 | 409; error: string } {
  if (requested !== undefined && requested !== null && requested !== "") {
    if (typeof requested === "string" && Object.prototype.hasOwnProperty.call(existing, requested)) {
      return { ok: false, status: 409, error: "exists" };
    }
    return { ok: false, status: 400, error: "client_id" };
  }
  const id = randomUUID();
  if (existing[id]) return { ok: false, status: 409, error: "exists" };
  return { ok: true, id };
}

export function authorizeInternal(opts: {
  authorization?: string | null;
  cronHeader?: string | null;
  secret?: string | null;
  emulator?: boolean;
}): boolean {
  if (opts.emulator) return true;
  const secret = opts.secret?.trim() ?? "";
  if (!secret) return false;
  const bearer = (opts.authorization ?? "").replace(/^Bearer\s+/i, "").trim();
  return bearer === secret || (opts.cronHeader ?? "").trim() === secret;
}

export function sniffImage(bytes: Buffer): "jpeg" | "png" | "webp" | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpeg";
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "png";
  if (bytes.length >= 12 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP") return "webp";
  return null;
}

export function sniffAudio(bytes: Buffer): boolean {
  if (bytes.length >= 4 && bytes.toString("ascii", 0, 4) === "OggS") return true;
  if (bytes.length >= 12 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WAVE") return true;
  if (bytes.length >= 4 && bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) return true;
  if (bytes.length >= 3 && bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) return true;
  if (bytes.length >= 2 && bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0) return true;
  if (bytes.length >= 8 && bytes.toString("ascii", 4, 8) === "ftyp") return true;
  return false;
}
