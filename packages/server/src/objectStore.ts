import { Client } from "minio";

export type ObjectInfo = { size: number; updatedAt: Date };

export interface ObjectStore {
  put(key: string, bytes: Buffer, contentType?: string, updatedAt?: Date): Promise<void>;
  get(key: string): Promise<Buffer | null>;
  stat(key: string): Promise<ObjectInfo | null>;
  list(prefix: string): Promise<Array<{ key: string } & ObjectInfo>>;
  delete(key: string): Promise<void>;
}

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`missing ${name}`);
  return value;
}

export class MemoryObjectStore implements ObjectStore {
  private rows = new Map<string, { bytes: Buffer; updatedAt: Date; contentType?: string }>();

  async put(key: string, bytes: Buffer, _contentType?: string, updatedAt?: Date): Promise<void> {
    this.rows.set(key, { bytes: Buffer.from(bytes), updatedAt: updatedAt ?? new Date() });
  }

  async get(key: string): Promise<Buffer | null> {
    const row = this.rows.get(key);
    return row ? Buffer.from(row.bytes) : null;
  }

  async stat(key: string): Promise<ObjectInfo | null> {
    const row = this.rows.get(key);
    return row ? { size: row.bytes.length, updatedAt: row.updatedAt } : null;
  }

  async list(prefix: string): Promise<Array<{ key: string } & ObjectInfo>> {
    const out: Array<{ key: string } & ObjectInfo> = [];
    for (const [key, row] of this.rows) {
      if (!key.startsWith(prefix)) continue;
      out.push({ key, size: row.bytes.length, updatedAt: row.updatedAt });
    }
    return out;
  }

  async delete(key: string): Promise<void> {
    this.rows.delete(key);
  }
}

export class S3ObjectStore implements ObjectStore {
  constructor(
    private client: Client,
    private bucket: string,
  ) {}

  async ensure(): Promise<void> {
    const exists = await this.client.bucketExists(this.bucket).catch(() => false);
    if (exists) return;
    try {
      await this.client.makeBucket(this.bucket);
    } catch (err) {
      const code = err && typeof err === "object" && "code" in err ? String((err as { code?: string }).code) : "";
      if (code !== "BucketAlreadyOwnedByYou" && code !== "BucketAlreadyExists") throw err;
    }
  }

  async put(key: string, bytes: Buffer, contentType?: string): Promise<void> {
    await this.client.putObject(this.bucket, key, bytes, bytes.length, contentType ? { "Content-Type": contentType } : {});
  }

  async get(key: string): Promise<Buffer | null> {
    try {
      const stream = await this.client.getObject(this.bucket, key);
      const chunks: Buffer[] = [];
      for await (const chunk of stream) chunks.push(Buffer.from(chunk));
      return Buffer.concat(chunks);
    } catch (err) {
      const code = err && typeof err === "object" && "code" in err ? String((err as { code?: string }).code) : "";
      if (code === "NoSuchKey" || code === "NotFound") return null;
      return null;
    }
  }

  async stat(key: string): Promise<ObjectInfo | null> {
    try {
      const stat = await this.client.statObject(this.bucket, key);
      return { size: stat.size, updatedAt: stat.lastModified };
    } catch {
      return null;
    }
  }

  async list(prefix: string): Promise<Array<{ key: string } & ObjectInfo>> {
    const out: Array<{ key: string } & ObjectInfo> = [];
    await new Promise<void>((resolve, reject) => {
      const stream = this.client.listObjects(this.bucket, prefix, true);
      stream.on("data", (item) => {
        if (!item.name) return;
        out.push({ key: item.name, size: item.size ?? 0, updatedAt: item.lastModified ?? new Date(0) });
      });
      stream.on("error", reject);
      stream.on("end", () => resolve());
    });
    return out;
  }

  async delete(key: string): Promise<void> {
    await this.client.removeObject(this.bucket, key).catch(() => undefined);
  }
}

export class GcsObjectStore implements ObjectStore {
  constructor(private bucket: string) {}

  private async token(): Promise<string> {
    const { googleAccessToken } = await import("./live.js");
    return googleAccessToken(process.env.FIREBASE_SERVICE_ACCOUNT_KEY);
  }

  private objectUrl(key: string, query = ""): string {
    const name = encodeURIComponent(key);
    return `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(this.bucket)}/o/${name}${query}`;
  }

  async put(key: string, bytes: Buffer, contentType = "application/octet-stream"): Promise<void> {
    const token = await this.token();
    const url = `https://storage.googleapis.com/upload/storage/v1/b/${encodeURIComponent(this.bucket)}/o?uploadType=media&name=${encodeURIComponent(key)}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": contentType },
      body: new Uint8Array(bytes),
    });
    if (!res.ok) throw new Error(`gcs put ${res.status}`);
  }

  async get(key: string): Promise<Buffer | null> {
    const token = await this.token();
    const res = await fetch(`${this.objectUrl(key)}?alt=media`, { headers: { Authorization: `Bearer ${token}` } });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`gcs get ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  }

  async stat(key: string): Promise<ObjectInfo | null> {
    const token = await this.token();
    const res = await fetch(this.objectUrl(key), { headers: { Authorization: `Bearer ${token}` } });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`gcs stat ${res.status}`);
    const body = (await res.json()) as { size?: string; updated?: string };
    return { size: Number(body.size ?? 0), updatedAt: new Date(body.updated ?? 0) };
  }

  async list(prefix: string): Promise<Array<{ key: string } & ObjectInfo>> {
    const token = await this.token();
    const out: Array<{ key: string } & ObjectInfo> = [];
    let page = "";
    do {
      const url = `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(this.bucket)}/o?prefix=${encodeURIComponent(prefix)}${page ? `&pageToken=${encodeURIComponent(page)}` : ""}`;
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error(`gcs list ${res.status}`);
      const body = (await res.json()) as { items?: Array<{ name?: string; size?: string; updated?: string }>; nextPageToken?: string };
      for (const item of body.items ?? []) {
        if (!item.name) continue;
        out.push({ key: item.name, size: Number(item.size ?? 0), updatedAt: new Date(item.updated ?? 0) });
      }
      page = body.nextPageToken ?? "";
    } while (page);
    return out;
  }

  async delete(key: string): Promise<void> {
    const token = await this.token();
    const res = await fetch(this.objectUrl(key), { method: "DELETE", headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok && res.status !== 404) throw new Error(`gcs delete ${res.status}`);
  }
}

export async function openObjectStore(): Promise<ObjectStore> {
  const endpoint = process.env.S3_ENDPOINT?.trim();
  if (endpoint) {
    const store = new S3ObjectStore(
      new Client({
        endPoint: endpoint,
        port: Number(process.env.S3_PORT ?? 9000),
        useSSL: process.env.S3_USE_SSL === "1",
        accessKey: required("S3_ACCESS_KEY"),
        secretKey: required("S3_SECRET_KEY"),
      }),
      required("S3_BUCKET"),
    );
    await store.ensure();
    return store;
  }
  const bucket = process.env.ZEPHYR_BUCKET?.trim();
  if (!bucket) throw new Error("missing S3_ENDPOINT or ZEPHYR_BUCKET");
  return new GcsObjectStore(bucket);
}
