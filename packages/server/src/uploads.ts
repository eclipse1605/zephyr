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
  cloudRun?: boolean;
}): boolean {
  if (opts.emulator || opts.cloudRun) return true;
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

/** Drop EXIF and XMP segments so a stored photo does not keep GPS. */
export function stripImageLocation(bytes: Buffer): Buffer {
  const kind = sniffImage(bytes);
  if (kind === "jpeg") return stripJpegApp1(bytes);
  if (kind === "png") return stripPngExif(bytes);
  if (kind === "webp") return stripWebpExif(bytes);
  return bytes;
}

function stripJpegApp1(bytes: Buffer): Buffer {
  const out: Buffer[] = [bytes.subarray(0, 2)];
  let i = 2;
  while (i < bytes.length) {
    if (bytes[i] !== 0xff) {
      out.push(bytes.subarray(i));
      break;
    }
    const markerStart = i;
    while (i < bytes.length && bytes[i] === 0xff) i += 1;
    if (i >= bytes.length) break;
    const marker = bytes[i];
    i += 1;
    if (marker === 0x00 || marker === 0x01 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) {
      out.push(bytes.subarray(markerStart, i));
      if (marker === 0xd9) break;
      continue;
    }
    if (i + 1 >= bytes.length) {
      out.push(bytes.subarray(markerStart));
      break;
    }
    const len = bytes.readUInt16BE(i);
    if (len < 2 || i + len > bytes.length) {
      out.push(bytes.subarray(markerStart));
      break;
    }
    if (marker === 0xda) {
      out.push(bytes.subarray(markerStart));
      break;
    }
    if (marker !== 0xe1) out.push(bytes.subarray(markerStart, i + len));
    i += len;
  }
  return Buffer.concat(out);
}

function stripPngExif(bytes: Buffer): Buffer {
  const parts: Buffer[] = [bytes.subarray(0, 8)];
  let i = 8;
  while (i + 12 <= bytes.length) {
    const len = bytes.readUInt32BE(i);
    const type = bytes.toString("ascii", i + 4, i + 8);
    const chunkEnd = i + 12 + len;
    if (chunkEnd > bytes.length) {
      parts.push(bytes.subarray(i));
      break;
    }
    if (type !== "eXIf") parts.push(bytes.subarray(i, chunkEnd));
    i = chunkEnd;
    if (type === "IEND") break;
  }
  return Buffer.concat(parts);
}

function stripWebpExif(bytes: Buffer): Buffer {
  const chunks: Buffer[] = [];
  let i = 12;
  while (i + 8 <= bytes.length) {
    const fourcc = bytes.toString("ascii", i, i + 4);
    const size = bytes.readUInt32LE(i + 4);
    const padded = i + 8 + size + (size % 2);
    if (i + 8 + size > bytes.length) break;
    if (fourcc !== "EXIF" && fourcc !== "XMP ") chunks.push(bytes.subarray(i, Math.min(padded, bytes.length)));
    i = padded;
  }
  const body = Buffer.concat(chunks);
  const header = Buffer.alloc(12);
  bytes.copy(header, 0, 0, 4);
  header.writeUInt32LE(body.length + 4, 4);
  bytes.copy(header, 8, 8, 12);
  return Buffer.concat([header, body]);
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
