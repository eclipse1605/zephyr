import { createHash } from "node:crypto";
import { COLLECTIONS, type CollectionName, type CollectionSpec } from "./schema.js";
import { emptyDb, type Db } from "./store.js";

export type RowSnap = { rev: number; hash: string };

export type Snapshot = {
  loaded: Set<CollectionName>;
  rows: Map<CollectionName, Map<string, RowSnap>>;
};

export type Change =
  | { op: "upsert"; collection: CollectionName; key: string; doc: unknown; expectedRev: number }
  | { op: "delete"; collection: CollectionName; key: string; expectedRev: number };

const snaps = new WeakMap<Db, Snapshot>();

export function attachSnapshot(db: Db, snapshot: Snapshot): void {
  snaps.set(db, snapshot);
}

export function snapshotOf(db: Db): Snapshot | undefined {
  return snaps.get(db);
}

export function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableJson(item)).join(",")}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(obj[key])}`)
    .join(",")}}`;
}

export function docHash(doc: unknown): string {
  return createHash("sha256").update(stableJson(doc)).digest("hex");
}

function entries(spec: CollectionSpec, db: Db): Array<{ key: string; doc: unknown }> {
  const value = db[spec.name];
  if (spec.kind === "singleton") return [{ key: spec.name, doc: value }];
  if (spec.kind === "record") {
    return Object.entries(value as Record<string, unknown>).map(([key, doc]) => ({ key, doc }));
  }
  const out: Array<{ key: string; doc: unknown }> = [];
  for (const item of value as unknown[]) {
    const key = spec.keyOf?.(item) ?? "";
    if (!key) continue;
    out.push({ key, doc: item });
  }
  return out;
}

export function emptySnapshot(loaded: CollectionName[] = COLLECTIONS.map((spec) => spec.name)): Snapshot {
  const rows = new Map<CollectionName, Map<string, RowSnap>>();
  for (const name of loaded) rows.set(name, new Map());
  return { loaded: new Set(loaded), rows };
}

/** Diff a Db against the snapshot taken when it was read. No snapshot means insert-only. */
export function diffDb(db: Db, snapshot?: Snapshot): Change[] {
  const changes: Change[] = [];
  const loaded = snapshot?.loaded ?? new Set(COLLECTIONS.map((spec) => spec.name));
  for (const spec of COLLECTIONS) {
    if (snapshot && !loaded.has(spec.name)) continue;
    const current = new Map(entries(spec, db).map((row) => [row.key, row.doc]));
    const previous = snapshot?.rows.get(spec.name) ?? new Map<string, RowSnap>();
    if (snapshot) {
      for (const [key, snap] of previous) {
        if (!current.has(key)) changes.push({ op: "delete", collection: spec.name, key, expectedRev: snap.rev });
      }
    }
    for (const [key, doc] of current) {
      const prev = previous.get(key);
      const hash = docHash(doc);
      if (prev && prev.hash === hash) continue;
      changes.push({ op: "upsert", collection: spec.name, key, doc, expectedRev: prev?.rev ?? 0 });
    }
  }
  return changes;
}

export function materialize(rows: Map<CollectionName, Array<{ key: string; rev: number; doc: unknown }>>, loaded: CollectionName[]): Db {
  const db = emptyDb();
  const snapshot = emptySnapshot(loaded);
  for (const name of loaded) {
    const spec = COLLECTIONS.find((item) => item.name === name)!;
    const list = rows.get(name) ?? [];
    const snap = snapshot.rows.get(name)!;
    if (spec.kind === "singleton") {
      const row = list[0];
      if (row) {
        (db as Record<string, unknown>)[name] = row.doc;
        snap.set(row.key, { rev: row.rev, hash: docHash(row.doc) });
      }
      continue;
    }
    if (spec.kind === "record") {
      const target = db[name] as Record<string, unknown>;
      for (const row of list) {
        target[row.key] = row.doc;
        snap.set(row.key, { rev: row.rev, hash: docHash(row.doc) });
      }
      continue;
    }
    const target = db[name] as unknown[];
    for (const row of list) {
      target.push(row.doc);
      snap.set(row.key, { rev: row.rev, hash: docHash(row.doc) });
    }
  }
  attachSnapshot(db, snapshot);
  return db;
}
