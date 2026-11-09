import { Client } from "minio";
import postgres from "postgres";
import { containedPhotoPath } from "./uploads.js";
import { FileStore, emptyDb } from "./store.js";

type Db = Awaited<ReturnType<FileStore["read"]>>;

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`missing ${name}`);
  return value;
}

export class PostgresStore extends FileStore {
  private sql = postgres(required("DATABASE_URL"), { max: 4, onnotice: () => {} });
  private s3 = new Client({
    endPoint: required("S3_ENDPOINT"),
    port: Number(process.env.S3_PORT ?? 9000),
    useSSL: process.env.S3_USE_SSL === "1",
    accessKey: required("S3_ACCESS_KEY"),
    secretKey: required("S3_SECRET_KEY"),
  });
  private bucket = required("S3_BUCKET");

  constructor() {
    super("/tmp/zephyr-pg-unused");
  }

  override async ensure() {
    await this.sql`
      create table if not exists zephyr_state (
        id int primary key,
        doc jsonb not null
      )
    `;
    const exists = await this.s3.bucketExists(this.bucket).catch(() => false);
    if (!exists) await this.s3.makeBucket(this.bucket);
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

  private objectName(reportId: string): string {
    containedPhotoPath("/tmp/zephyr-pg-unused", reportId);
    return `photos/${reportId}`;
  }

  override async savePhoto(reportId: string, bytes: Buffer) {
    const name = this.objectName(reportId);
    await this.s3.putObject(this.bucket, name, bytes);
    return `s3://${this.bucket}/${name}`;
  }

  override async photoExists(reportId: string) {
    try {
      const stat = await this.s3.statObject(this.bucket, this.objectName(reportId));
      return stat.size > 0 && stat.size <= 5 * 1024 * 1024;
    } catch {
      return false;
    }
  }

  override async readPhoto(reportId: string) {
    const stream = await this.s3.getObject(this.bucket, this.objectName(reportId));
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(Buffer.from(chunk));
    return Buffer.concat(chunks);
  }

  override async deleteStalePhotos(maxAgeMs: number) {
    const db = await this.read();
    const cutoff = Date.now() - maxAgeMs;
    const names: string[] = [];
    await new Promise<void>((resolve, reject) => {
      const stream = this.s3.listObjects(this.bucket, "photos/", true);
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
      const stat = await this.s3.statObject(this.bucket, name);
      if (stat.lastModified.getTime() < cutoff) await this.s3.removeObject(this.bucket, name);
    }
  }

  async close() {
    await this.sql.end({ timeout: 2 });
  }
}
