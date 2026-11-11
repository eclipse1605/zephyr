import postgres, { type Sql, type TransactionSql } from "postgres";
import { diffDb, materialize, snapshotOf } from "./diff.js";
import { openObjectStore, type ObjectStore } from "./objectStore.js";
import { COLLECTIONS, createStatements, specFor, WINDOW_ROW_CAP, type CollectionName, type CollectionSpec } from "./schema.js";
import {
  StoreConflictError,
  emptyDb,
  type BBox,
  type Db,
  type HourlyReading,
  type IngestJob,
  type ReadScope,
  type Store,
  type StoredReport,
  type StoredStation,
} from "./store.js";
import { safeObjectId } from "./uploads.js";

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`missing ${name}`);
  return value;
}

function photoKey(id: string): string {
  if (!safeObjectId(id)) throw new Error("bad_id");
  return `photos/${id}`;
}

function isUnique(err: unknown): boolean {
  return Boolean(err && typeof err === "object" && "code" in err && (err as { code?: string }).code === "23505");
}

type Tx = TransactionSql<Record<string, never>>;

export class PostgresStore implements Store {
  private sql: Sql;
  objects: ObjectStore;
  private ready = false;
  private migrating = false;

  constructor(objects?: ObjectStore) {
    this.sql = postgres(required("DATABASE_URL"), { max: 4, onnotice: () => {} });
    this.objects = objects ?? (null as unknown as ObjectStore);
  }

  private async blobs(): Promise<ObjectStore> {
    if (this.objects) return this.objects;
    this.objects = await openObjectStore();
    return this.objects;
  }

  async ensure(): Promise<void> {
    if (this.ready || this.migrating) return;
    this.migrating = true;
    await this.sql`select pg_advisory_lock(8142011)`;
    try {
      const reg = await this.sql<{ reg: string | null }[]>`select to_regclass('public.schema_migrations') as reg`;
      const applied = reg[0]?.reg
        ? await this.sql<{ version: number }[]>`select version from schema_migrations order by version`
        : [];
      const have = new Set(applied.map((row) => row.version));
      if (!have.has(1)) {
        await this.sql.begin(async (tx) => {
          for (const statement of createStatements()) await tx.unsafe(statement);
          await tx`insert into schema_migrations (version) values (1) on conflict do nothing`;
        });
      }
      if (!have.has(2)) {
        await this.importLegacy();
        await this.sql`insert into schema_migrations (version) values (2) on conflict do nothing`;
      }
      if (!this.objects) this.objects = await openObjectStore();
      this.ready = true;
    } finally {
      this.migrating = false;
      await this.sql`select pg_advisory_unlock(8142011)`;
    }
  }

  private async importLegacy(): Promise<void> {
    const exists = await this.sql<{ reg: string | null }[]>`select to_regclass('public.zephyr_state') as reg`;
    if (!exists[0]?.reg) return;
    const count = await this.sql<{ n: string }[]>`select count(*)::text as n from stations`;
    if (Number(count[0]?.n ?? 0) > 0) return;
    const rows = await this.sql<{ doc: Db }[]>`select doc from zephyr_state where id = 1`;
    const doc = rows[0]?.doc;
    if (doc) {
      const db = { ...emptyDb(), ...doc };
      await this.write(db);
    }
    await this.sql.unsafe(`alter table if exists zephyr_state rename to zephyr_state_legacy`);
  }

  private async selectRows(name: CollectionName, scope?: ReadScope): Promise<Array<{ key: string; rev: number; doc: unknown }>> {
    const spec = specFor(name);
    const where: string[] = [];
    const params: unknown[] = [];
    if (spec.kind === "singleton") {
      params.push(spec.name);
      where.push(`key = $${params.length}`);
    }
    if (scope?.cityId && spec.columns.some((col) => col.name === "city_id")) {
      params.push(scope.cityId);
      where.push(`city_id = $${params.length}`);
    }
    let order = "";
    if (spec.retentionDays && spec.timeColumn) {
      params.push(new Date(Date.now() - spec.retentionDays * 86_400_000).toISOString());
      where.push(`${spec.timeColumn} >= $${params.length}::timestamptz`);
      order = ` order by ${spec.timeColumn} desc limit ${WINDOW_ROW_CAP}`;
    }
    const sql = `select key, rev, doc from ${spec.table}${where.length ? ` where ${where.join(" and ")}` : ""}${order}`;
    const rows = await this.sql.unsafe(sql, params as never[]);
    return rows.map((row) => ({ key: String(row.key), rev: Number(row.rev), doc: row.doc }));
  }

  async read(scope?: ReadScope): Promise<Db> {
    await this.ensure();
    const loaded = scope?.only ?? COLLECTIONS.map((spec) => spec.name);
    const rows = new Map<CollectionName, Array<{ key: string; rev: number; doc: unknown }>>();
    for (const name of loaded) rows.set(name, await this.selectRows(name, scope));
    return materialize(rows, loaded);
  }

  private async apply(tx: Tx, spec: CollectionSpec, op: "insert" | "update" | "delete", key: string, doc: unknown, expectedRev: number): Promise<void> {
    const names = spec.columns.map((col) => col.name);
    const values = spec.columns.map((col) => col.value(doc, key));
    if (op === "delete") {
      const result = await tx.unsafe(`delete from ${spec.table} where key = $1 and rev = $2`, [key, expectedRev]);
      if (result.count === 0) throw new StoreConflictError();
      return;
    }
    if (op === "insert") {
      const cols = ["key", ...names, "doc", "rev", "updated_at"];
      const params = [key, ...values, tx.json(doc as never)];
      const slots = params.map((_, index) => `$${index + 1}`);
      const statement = `insert into ${spec.table} (${cols.join(", ")}) values (${slots.join(", ")}, 1, now())`;
      try {
        await tx.unsafe(statement, params as never[]);
      } catch (err) {
        if (isUnique(err)) throw new StoreConflictError();
        throw err;
      }
      return;
    }
    const sets = names.map((name, index) => `${name} = $${index + 1}`);
    const params = [...values, tx.json(doc as never), key, expectedRev];
    const docSlot = names.length + 1;
    const statement = `update ${spec.table} set ${sets.length ? `${sets.join(", ")}, ` : ""}doc = $${docSlot}, rev = rev + 1, updated_at = now() where key = $${docSlot + 1} and rev = $${docSlot + 2}`;
    const result = await tx.unsafe(statement, params as never[]);
    if (result.count === 0) throw new StoreConflictError();
  }

  async write(db: Db): Promise<void> {
    await this.ensure();
    const changes = diffDb(db, snapshotOf(db));
    if (changes.length === 0) return;
    await this.sql.begin(async (tx) => {
      for (const change of changes) {
        const spec = specFor(change.collection);
        if (change.op === "delete") {
          await this.apply(tx, spec, "delete", change.key, null, change.expectedRev);
        } else if (change.expectedRev === 0) {
          await this.apply(tx, spec, "insert", change.key, change.doc, 0);
        } else {
          await this.apply(tx, spec, "update", change.key, change.doc, change.expectedRev);
        }
      }
    });
  }

  async update(fn: (db: Db) => void | Promise<void>, scope?: ReadScope): Promise<Db> {
    for (let attempt = 0; attempt < 3; attempt++) {
      const db = await this.read(scope);
      await fn(db);
      try {
        await this.write(db);
        return db;
      } catch (err) {
        if (!(err instanceof StoreConflictError) || attempt === 2) throw err;
        await new Promise((resolve) => setTimeout(resolve, 20 + Math.floor(Math.random() * 40)));
      }
    }
    throw new StoreConflictError();
  }

  private async putDoc(spec: CollectionSpec, key: string, doc: unknown): Promise<void> {
    await this.ensure();
    const names = spec.columns.map((col) => col.name);
    const values = spec.columns.map((col) => col.value(doc, key));
    const params = [key, ...values, this.sql.json(doc as never)];
    const inserts = ["key", ...names, "doc", "rev", "updated_at"];
    const slots = params.map((_, index) => `$${index + 1}`);
    const updates = [...names.map((name) => `${name} = excluded.${name}`), "doc = excluded.doc", "rev = " + spec.table + ".rev + 1", "updated_at = now()"];
    const statement = `insert into ${spec.table} (${inserts.join(", ")}) values (${slots.join(", ")}, 1, now()) on conflict (key) do update set ${updates.join(", ")}`;
    await this.sql.unsafe(statement, params as never[]);
  }

  async saveReport(report: StoredReport): Promise<void> {
    await this.putDoc(specFor("reports"), report.id, report);
  }

  async pushPendingMessage(message: { id: string; type: string; body: unknown }): Promise<void> {
    await this.putDoc(specFor("pendingMessages"), message.id, message);
  }

  async savePhoto(reportId: string, bytes: Buffer): Promise<string> {
    const objects = await this.blobs();
    const key = photoKey(reportId);
    await objects.put(key, bytes, "application/octet-stream");
    const bucket = process.env.S3_BUCKET?.trim() || process.env.ZEPHYR_BUCKET?.trim() || "bucket";
    return process.env.S3_ENDPOINT?.trim() ? `s3://${bucket}/${key}` : `gs://${bucket}/${key}`;
  }

  async photoExists(reportId: string): Promise<boolean> {
    const info = await (await this.blobs()).stat(photoKey(reportId));
    return Boolean(info && info.size > 0 && info.size <= 5 * 1024 * 1024);
  }

  async readPhoto(reportId: string): Promise<Buffer> {
    const bytes = await (await this.blobs()).get(photoKey(reportId));
    if (!bytes) throw new Error("photo_missing");
    return bytes;
  }

  async deleteStalePhotos(maxAgeMs: number): Promise<void> {
    const objects = await this.blobs();
    const db = await this.read({ only: ["reports"] });
    const cutoff = Date.now() - maxAgeMs;
    for (const item of await objects.list("photos/")) {
      const id = item.key.slice("photos/".length);
      const committed = Object.values(db.reports).some((report) => report.id === id && report.status !== "pending_upload");
      if (committed) continue;
      if (item.updatedAt.getTime() < cutoff) await objects.delete(item.key);
    }
  }

  async stationsInBounds(box: BBox): Promise<StoredStation[]> {
    await this.ensure();
    const west = Math.min(box.west, box.east);
    const east = Math.max(box.west, box.east);
    const south = Math.min(box.south, box.north);
    const north = Math.max(box.south, box.north);
    const rows = await this.sql<{ doc: StoredStation }[]>`
      select doc from stations
      where lat between ${south} and ${north}
        and lng between ${west} and ${east}
        and coalesce(source_feed, '') <> 'waqi'
    `;
    return rows.map((row) => row.doc);
  }

  async stationsByCity(cityId: string): Promise<StoredStation[]> {
    await this.ensure();
    const rows = await this.sql<{ doc: StoredStation }[]>`
      select doc from stations where city_id = ${cityId} and coalesce(source_feed, '') <> 'waqi'
    `;
    return rows.map((row) => row.doc);
  }

  async claimNextIngestJob(owner: string, leaseMs: number, now = new Date()): Promise<IngestJob | null> {
    await this.ensure();
    return this.sql.begin(async (tx) => {
      const rows = await tx<{ key: string; rev: number; doc: IngestJob }[]>`
        select key, rev, doc from ingest_jobs
        where status = 'queued'
           or (status = 'running' and (lease_until is null or lease_until <= ${now.toISOString()}::timestamptz))
        order by created_at asc nulls last
        limit 1
        for update skip locked
      `;
      const row = rows[0];
      if (!row) return null;
      const claimed: IngestJob = {
        ...row.doc,
        status: "running",
        leaseOwner: owner,
        leaseUntil: new Date(now.getTime() + leaseMs).toISOString(),
        updatedAt: now.toISOString(),
      };
      await this.apply(tx, specFor("ingestJobs"), "update", row.key, claimed, Number(row.rev));
      return claimed;
    });
  }

  async recentHourly(stationId: string, hours: number, now = new Date()): Promise<HourlyReading[]> {
    await this.ensure();
    const cutoff = new Date(now.getTime() - hours * 3_600_000).toISOString();
    const rows = await this.sql<{ doc: HourlyReading }[]>`
      select doc from hourly
      where station_id = ${stationId} and observed_at >= ${cutoff}::timestamptz
      order by observed_at asc
    `;
    return rows.map((row) => row.doc);
  }

  async purgeExpired(now = new Date()): Promise<void> {
    await this.ensure();
    for (const spec of COLLECTIONS) {
      if (!spec.retentionDays || !spec.timeColumn) continue;
      const cutoff = new Date(now.getTime() - spec.retentionDays * 86_400_000).toISOString();
      await this.sql.unsafe(`delete from ${spec.table} where ${spec.timeColumn} < $1::timestamptz`, [cutoff]);
    }
  }

  async close(): Promise<void> {
    await this.sql.end({ timeout: 2 });
  }
}
