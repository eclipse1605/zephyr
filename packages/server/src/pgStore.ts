import { Client } from "minio";
import postgres from "postgres";
import { containedPhotoPath } from "./uploads.js";
import { FileStore, emptyDb, type StoredReport } from "./store.js";

type Db = Awaited<ReturnType<FileStore["read"]>>;

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`missing ${name}`);
  return value;
}

export class PostgresStore extends FileStore {
  private sql = postgres(required("DATABASE_URL"), { max: 4, onnotice: () => {} });
  private s3: Client | null;
  private bucket: string;

  constructor() {
    super("/tmp/zephyr-pg-unused");
    const endpoint = process.env.S3_ENDPOINT?.trim();
    const gcs = process.env.ZEPHYR_BUCKET?.trim();
    if (endpoint) {
      this.s3 = new Client({
        endPoint: endpoint,
        port: Number(process.env.S3_PORT ?? 9000),
        useSSL: process.env.S3_USE_SSL === "1",
        accessKey: required("S3_ACCESS_KEY"),
        secretKey: required("S3_SECRET_KEY"),
      });
      this.bucket = required("S3_BUCKET");
      return;
    }
    if (!gcs) throw new Error("missing S3_ENDPOINT or ZEPHYR_BUCKET");
    this.s3 = null;
    this.bucket = gcs;
  }

  override async ensure() {
    await this.sql`
      create table if not exists zephyr_state (
        id int primary key,
        doc jsonb not null
      )
    `;
    const exists = this.s3 ? await this.s3.bucketExists(this.bucket).catch(() => false) : true;
    if (this.s3 && !exists) await this.s3.makeBucket(this.bucket);
  }

  override async read(): Promise<Db> {
    await this.ensure();
    const rows = await this.sql<{ doc: Db }[]>`select doc from zephyr_state where id = 1`;
    const parsed = rows[0]?.doc;
    return { ...emptyDb(), ...(parsed ?? {}) };
  }

  override async write(db: Db) {
    await this.ensure();
    await this.sql`
      insert into zephyr_state (id, doc)
      values (1, ${this.sql.json(db as never)})
      on conflict (id) do update set doc = excluded.doc
    `;
  }

  override async saveReport(report: StoredReport): Promise<void> {
    await this.ensure();
    const rows = await this.sql`select 1 from zephyr_state where id = 1`;
    if (!rows.length) {
      const db = emptyDb();
      db.reports[report.id] = report;
      await this.write(db);
      return;
    }
    await this.sql`
      update zephyr_state
      set doc = jsonb_set(doc, array['reports', ${report.id}], ${this.sql.json(report as never)}::jsonb, true)
      where id = 1
    `;
  }

  override async pushPendingMessage(message: { id: string; type: string; body: unknown }): Promise<void> {
    await this.ensure();
    const rows = await this.sql`select 1 from zephyr_state where id = 1`;
    if (!rows.length) {
      const db = emptyDb();
      db.pendingMessages.push(message);
      await this.write(db);
      return;
    }
    await this.sql`
      update zephyr_state
      set doc = jsonb_set(
        doc,
        '{pendingMessages}',
        coalesce(doc->'pendingMessages', '[]'::jsonb) || ${this.sql.json([message] as never)}::jsonb
      )
      where id = 1
    `;
  }

  private objectName(reportId: string): string {
    containedPhotoPath("/tmp/zephyr-pg-unused", reportId);
    return `photos/${reportId}`;
  }

  private gcsName(reportId: string): string {
    return encodeURIComponent(this.objectName(reportId));
  }

  private async gcsToken(): Promise<string> {
    const { googleAccessToken } = await import("./live.js");
    return googleAccessToken(process.env.FIREBASE_SERVICE_ACCOUNT_KEY);
  }

  override async savePhoto(reportId: string, bytes: Buffer) {
    const name = this.objectName(reportId);
    if (!this.s3) {
      const token = await this.gcsToken();
      const url = `https://storage.googleapis.com/upload/storage/v1/b/${encodeURIComponent(this.bucket)}/o?uploadType=media&name=${this.gcsName(reportId)}`;
      const res = await fetch(url, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/octet-stream" }, body: new Uint8Array(bytes) });
      if (!res.ok) throw new Error(`gcs put ${res.status}`);
      return `gs://${this.bucket}/${name}`;
    }
    await this.s3.putObject(this.bucket, name, bytes);
    return `s3://${this.bucket}/${name}`;
  }

  override async photoExists(reportId: string) {
    if (!this.s3) {
      const token = await this.gcsToken();
      const res = await fetch(`https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(this.bucket)}/o/${this.gcsName(reportId)}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return false;
      const body = (await res.json()) as { size?: string };
      const size = Number(body.size ?? 0);
      return size > 0 && size <= 5 * 1024 * 1024;
    }
    try {
      const stat = await this.s3.statObject(this.bucket, this.objectName(reportId));
      return stat.size > 0 && stat.size <= 5 * 1024 * 1024;
    } catch {
      return false;
    }
  }

  override async readPhoto(reportId: string) {
    if (!this.s3) {
      const token = await this.gcsToken();
      const res = await fetch(`https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(this.bucket)}/o/${this.gcsName(reportId)}?alt=media`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(`gcs get ${res.status}`);
      return Buffer.from(await res.arrayBuffer());
    }
    const stream = await this.s3.getObject(this.bucket, this.objectName(reportId));
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(Buffer.from(chunk));
    return Buffer.concat(chunks);
  }

  override async deleteStalePhotos(maxAgeMs: number) {
    if (!this.s3) return this.deleteStaleGcsPhotos(maxAgeMs);
    const s3 = this.s3;
    const db = await this.read();
    const cutoff = Date.now() - maxAgeMs;
    const names: string[] = [];
    await new Promise<void>((resolve, reject) => {
      const stream = s3.listObjects(this.bucket, "photos/", true);
      stream.on("data", (item) => {
        if (item.name) names.push(item.name);
      });
      stream.on("error", reject);
      stream.on("end", () => resolve());
    });
    for (const name of names) {
      const id = name.replace(/^photos\//, "");
      const committed = Object.values(db.reports).some((report) => report.id === id && report.status !== "pending_upload");
      if (committed) continue;
      const stat = await s3.statObject(this.bucket, name);
      if (stat.lastModified.getTime() < cutoff) await s3.removeObject(this.bucket, name);
    }
  }

  private async deleteStaleGcsPhotos(maxAgeMs: number) {
    const db = await this.read();
    const cutoff = Date.now() - maxAgeMs;
    const token = await this.gcsToken();
    const list = await fetch(`https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(this.bucket)}/o?prefix=photos/`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!list.ok) return;
    const body = (await list.json()) as { items?: Array<{ name?: string; updated?: string }> };
    for (const item of body.items ?? []) {
      if (!item.name) continue;
      const id = item.name.replace(/^photos\//, "");
      const committed = Object.values(db.reports).some((report) => report.id === id && report.status !== "pending_upload");
      if (committed || !item.updated || Date.parse(item.updated) >= cutoff) continue;
      await fetch(`https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(this.bucket)}/o/${encodeURIComponent(item.name)}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
    }
  }

  async close() {
    await this.sql.end({ timeout: 2 });
  }
}
