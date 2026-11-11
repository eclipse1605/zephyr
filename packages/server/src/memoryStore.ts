import { attachSnapshot, diffDb, docHash, emptySnapshot, materialize, snapshotOf, type Snapshot } from "./diff.js";
import { MemoryObjectStore, type ObjectStore } from "./objectStore.js";
import { COLLECTIONS, specFor, WINDOW_ROW_CAP, type CollectionName } from "./schema.js";
import {
  StoreConflictError,
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

type Row = { rev: number; doc: unknown; updatedAt: number };

function photoKey(id: string): string {
  if (!safeObjectId(id)) throw new Error("bad_id");
  return `photos/${id}`;
}

function inBox(station: StoredStation, box: BBox): boolean {
  const west = Math.min(box.west, box.east);
  const east = Math.max(box.west, box.east);
  const south = Math.min(box.south, box.north);
  const north = Math.max(box.south, box.north);
  return station.lng >= west && station.lng <= east && station.lat >= south && station.lat <= north;
}

function timeOf(doc: unknown, field: string): number {
  const value = (doc as Record<string, unknown> | null)?.[field];
  const parsed = typeof value === "string" ? Date.parse(value) : NaN;
  return Number.isFinite(parsed) ? parsed : 0;
}

export class MemoryStore implements Store {
  readonly objects: ObjectStore = new MemoryObjectStore();
  private tables = new Map<CollectionName, Map<string, Row>>();

  constructor() {
    for (const spec of COLLECTIONS) this.tables.set(spec.name, new Map());
  }

  async ensure(): Promise<void> {}

  private table(name: CollectionName): Map<string, Row> {
    return this.tables.get(name)!;
  }

  async read(scope?: ReadScope): Promise<Db> {
    const loaded = scope?.only ?? COLLECTIONS.map((spec) => spec.name);
    const rows = new Map<CollectionName, Array<{ key: string; rev: number; doc: unknown }>>();
    for (const name of loaded) {
      const spec = specFor(name);
      let list = [...this.table(name).entries()].map(([key, row]) => ({ key, rev: row.rev, doc: row.doc, updatedAt: row.updatedAt }));
      if (scope?.cityId && spec.columns.some((col) => col.name === "city_id")) {
        list = list.filter((row) => spec.columns.find((col) => col.name === "city_id")!.value(row.doc, row.key) === scope.cityId);
      }
      if (spec.retentionDays && spec.timeColumn) {
        const cutoff = Date.now() - spec.retentionDays * 86_400_000;
        const field = spec.timeColumn === "observed_at" ? "observedAt" : spec.timeColumn === "created_at" ? "createdAt" : "at";
        list = list.filter((row) => timeOf(row.doc, field) >= cutoff);
        list.sort((a, b) => timeOf(b.doc, field) - timeOf(a.doc, field));
        list = list.slice(0, WINDOW_ROW_CAP);
      }
      rows.set(name, list);
    }
    return materialize(rows, loaded);
  }

  async write(db: Db): Promise<void> {
    const changes = diffDb(db, snapshotOf(db));
    for (const change of changes) {
      const table = this.table(change.collection);
      if (change.op === "delete") {
        const row = table.get(change.key);
        if (!row || row.rev !== change.expectedRev) throw new StoreConflictError();
        table.delete(change.key);
        continue;
      }
      const current = table.get(change.key);
      if (change.expectedRev === 0) {
        if (current) throw new StoreConflictError();
        table.set(change.key, { rev: 1, doc: change.doc, updatedAt: Date.now() });
        continue;
      }
      if (!current || current.rev !== change.expectedRev) throw new StoreConflictError();
      table.set(change.key, { rev: current.rev + 1, doc: change.doc, updatedAt: Date.now() });
    }
    const loaded = snapshotOf(db)?.loaded ?? new Set(COLLECTIONS.map((spec) => spec.name));
    const next = emptySnapshot([...loaded]);
    for (const name of loaded) {
      const snap = next.rows.get(name)!;
      for (const [key, row] of this.table(name)) snap.set(key, { rev: row.rev, hash: docHash(row.doc) });
    }
    const fresh: Snapshot = next;
    attachSnapshot(db, fresh);
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

  async saveReport(report: StoredReport): Promise<void> {
    const table = this.table("reports");
    const current = table.get(report.id);
    table.set(report.id, { rev: (current?.rev ?? 0) + 1, doc: report, updatedAt: Date.now() });
  }

  async pushPendingMessage(message: { id: string; type: string; body: unknown }): Promise<void> {
    const table = this.table("pendingMessages");
    table.set(message.id, { rev: 1, doc: message, updatedAt: Date.now() });
  }

  async savePhoto(reportId: string, bytes: Buffer): Promise<string> {
    const key = photoKey(reportId);
    await this.objects.put(key, bytes);
    return `mem://${key}`;
  }

  async photoExists(reportId: string): Promise<boolean> {
    const info = await this.objects.stat(photoKey(reportId));
    return Boolean(info && info.size > 0 && info.size <= 5 * 1024 * 1024);
  }

  async readPhoto(reportId: string): Promise<Buffer> {
    const bytes = await this.objects.get(photoKey(reportId));
    if (!bytes) throw new Error("photo_missing");
    return bytes;
  }

  async deleteStalePhotos(maxAgeMs: number): Promise<void> {
    const db = await this.read({ only: ["reports"] });
    const cutoff = Date.now() - maxAgeMs;
    for (const item of await this.objects.list("photos/")) {
      const id = item.key.slice("photos/".length);
      const committed = Object.values(db.reports).some((report) => report.id === id && report.status !== "pending_upload");
      if (committed) continue;
      if (item.updatedAt.getTime() < cutoff) await this.objects.delete(item.key);
    }
  }

  async stationsInBounds(box: BBox): Promise<StoredStation[]> {
    const out: StoredStation[] = [];
    for (const row of this.table("stations").values()) {
      const station = row.doc as StoredStation;
      if (station.sourceFeed === "waqi") continue;
      if (inBox(station, box)) out.push(station);
    }
    return out;
  }

  async stationsByCity(cityId: string): Promise<StoredStation[]> {
    const out: StoredStation[] = [];
    for (const row of this.table("stations").values()) {
      const station = row.doc as StoredStation;
      if (station.cityId === cityId && station.sourceFeed !== "waqi") out.push(station);
    }
    return out;
  }

  async claimNextIngestJob(owner: string, leaseMs: number, now = new Date()): Promise<IngestJob | null> {
    const table = this.table("ingestJobs");
    const jobs = [...table.values()]
      .map((row) => row.doc as IngestJob)
      .filter((job) => job.status === "queued" || (job.status === "running" && (!job.leaseUntil || Date.parse(job.leaseUntil) <= now.getTime())))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const next = jobs[0];
    if (!next) return null;
    const row = table.get(next.id)!;
    const claimed: IngestJob = {
      ...next,
      status: "running",
      leaseOwner: owner,
      leaseUntil: new Date(now.getTime() + leaseMs).toISOString(),
      updatedAt: now.toISOString(),
    };
    table.set(next.id, { rev: row.rev + 1, doc: claimed, updatedAt: Date.now() });
    return claimed;
  }

  async recentHourly(stationId: string, hours: number, now = new Date()): Promise<HourlyReading[]> {
    const cutoff = now.getTime() - hours * 3_600_000;
    const out: HourlyReading[] = [];
    for (const row of this.table("hourly").values()) {
      const item = row.doc as HourlyReading;
      if (item.stationId === stationId && Date.parse(item.observedAt) >= cutoff) out.push(item);
    }
    out.sort((a, b) => a.observedAt.localeCompare(b.observedAt));
    return out;
  }

  async purgeExpired(now = new Date()): Promise<void> {
    for (const spec of COLLECTIONS) {
      if (!spec.retentionDays) continue;
      const field = spec.timeColumn === "observed_at" ? "observedAt" : spec.timeColumn === "created_at" ? "createdAt" : "at";
      const cutoff = now.getTime() - spec.retentionDays * 86_400_000;
      for (const [key, row] of this.table(spec.name)) {
        if (timeOf(row.doc, field) < cutoff) this.table(spec.name).delete(key);
      }
    }
  }
}
