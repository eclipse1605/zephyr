import { googleAccessToken } from "./live.js";
import { resolveProjectId } from "./gcp.js";
import { FileStore } from "./store.js";

type Db = Awaited<ReturnType<FileStore["read"]>>;

type FsValue = { stringValue?: string };
type FsDoc = { name: string; fields?: { json?: FsValue } };
type FsWrite =
  | { update: { name: string; fields: { json: { stringValue: string } } } }
  | { delete: string };

const RECORD_COLLECTIONS = [
  "stations",
  "citySummaries",
  "wards",
  "reports",
  "incidents",
  "diaries",
  "subscriptions",
  "apiKeys",
  "rateLimits",
  "dlqItems",
] as const;

const ARRAY_COLLECTIONS = ["incidentEvents", "notifications"] as const;

const SYSTEM_DOCS = [
  "config",
  "ingest",
  "exposure",
  "hourly",
  "previousHexAqi",
  "pendingMessages",
  "satelliteCells",
  "fires",
  "osmPlaces",
  "pendingTasks",
  "modelledHistory",
  "sensorStreak",
] as const;

const PHOTO_LIMIT = 5 * 1024 * 1024;

function defaults(): Db {
  return {
    stations: {},
    citySummaries: {},
    wards: {},
    reports: {},
    incidents: {},
    incidentEvents: [],
    diaries: {},
    subscriptions: {},
    notifications: [],
    apiKeys: {},
    rateLimits: {},
    dlqItems: {},
    config: { dataMode: "demo", fixtureWeek: "2026-09-22" },
    ingest: {
      lastSuccessAt: null,
      lastError: null,
      stationCounts: {},
      satelliteStatus: "not_configured",
      feeds: {},
    },
    exposure: [],
    hourly: [],
    previousHexAqi: {},
    pendingMessages: [],
    satelliteCells: {},
    fires: [],
    osmPlaces: {},
    pendingTasks: [],
    modelledHistory: [],
    sensorStreak: {},
  };
}

function hydrate(partial: Partial<Db>): Db {
  const base = defaults();
  const clean = Object.fromEntries(Object.entries(partial).filter(([, value]) => value !== undefined)) as Partial<Db>;
  return {
    ...base,
    ...clean,
    ingest: { ...base.ingest, ...clean.ingest },
    config: { ...base.config, ...clean.config },
    satelliteCells: clean.satelliteCells ?? {},
    fires: clean.fires ?? [],
    osmPlaces: clean.osmPlaces ?? {},
    pendingTasks: clean.pendingTasks ?? [],
    modelledHistory: clean.modelledHistory ?? [],
  };
}

function docId(key: string): string {
  return `d${Buffer.from(key, "utf8").toString("hex")}`;
}

function keyFromId(id: string): string {
  return Buffer.from(id.startsWith("d") ? id.slice(1) : id, "hex").toString("utf8");
}

function jsonFields(value: unknown): { json: { stringValue: string } } {
  return { json: { stringValue: JSON.stringify(value) } };
}

function parseJson(fields: FsDoc["fields"]): unknown {
  const raw = fields?.json?.stringValue;
  if (typeof raw !== "string") return undefined;
  return JSON.parse(raw) as unknown;
}

function itemKey(item: unknown, index: number): string {
  if (item && typeof item === "object" && "id" in item && typeof item.id === "string" && item.id) return item.id;
  return `i${index}`;
}

function sortRows<T>(rows: T[]): T[] {
  const stamp = (row: T) => {
    if (!row || typeof row !== "object") return "";
    const rec = row as Record<string, unknown>;
    const value = rec.at ?? rec.createdAt ?? rec.observedAt ?? "";
    return typeof value === "string" ? value : "";
  };
  const idOf = (row: T) => {
    if (!row || typeof row !== "object") return "";
    const value = (row as Record<string, unknown>).id;
    return typeof value === "string" ? value : "";
  };
  return [...rows].sort((a, b) => stamp(a).localeCompare(stamp(b)) || idOf(a).localeCompare(idOf(b)));
}

let fallbackLogged = false;

export class GcpStore extends FileStore {
  private token = "";
  private tokenAt = 0;

  private project(): string {
    const project = resolveProjectId();
    if (!project) throw new Error("missing project id");
    return project;
  }

  private rootUrl(): string {
    return `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(this.project())}/databases/(default)/documents`;
  }

  private docName(collection: string, id: string): string {
    return `projects/${this.project()}/databases/(default)/documents/${collection}/${id}`;
  }

  private async auth(): Promise<string> {
    if (this.token && Date.now() - this.tokenAt < 45 * 60 * 1000) return this.token;
    const key = process.env.FIREBASE_SERVICE_ACCOUNT_KEY?.trim();
    if (!key) throw new Error("missing FIREBASE_SERVICE_ACCOUNT_KEY");
    this.project();
    this.token = await googleAccessToken(key);
    this.tokenAt = Date.now();
    return this.token;
  }

  private async headers(): Promise<Record<string, string>> {
    return { Authorization: `Bearer ${await this.auth()}`, "Content-Type": "application/json" };
  }

  private bucket(): string {
    return process.env.ZEPHYR_BUCKET?.trim() ?? "";
  }

  private async list(collection: string): Promise<FsDoc[]> {
    const out: FsDoc[] = [];
    let pageToken = "";
    do {
      const url = new URL(`${this.rootUrl()}/${collection}`);
      url.searchParams.set("pageSize", "300");
      if (pageToken) url.searchParams.set("pageToken", pageToken);
      const res = await fetch(url, { headers: await this.headers() });
      if (!res.ok) throw new Error(`firestore list ${collection} ${res.status}`);
      const body = (await res.json()) as { documents?: FsDoc[]; nextPageToken?: string };
      out.push(...(body.documents ?? []));
      pageToken = body.nextPageToken ?? "";
    } while (pageToken);
    return out;
  }

  private async commit(writes: FsWrite[]): Promise<void> {
    if (writes.length === 0) return;
    const headers = await this.headers();
    for (let i = 0; i < writes.length; i += 400) {
      const res = await fetch(`${this.rootUrl()}:commit`, {
        method: "POST",
        headers,
        body: JSON.stringify({ writes: writes.slice(i, i + 400) }),
      });
      if (!res.ok) throw new Error(`firestore commit ${res.status}`);
    }
  }

  private async readMap(collection: string): Promise<Record<string, unknown>> {
    const docs = await this.list(collection);
    const out: Record<string, unknown> = {};
    for (const doc of docs) {
      const value = parseJson(doc.fields);
      if (value === undefined) continue;
      const id = doc.name.slice(doc.name.lastIndexOf("/") + 1);
      out[keyFromId(id)] = value;
    }
    return out;
  }

  private async readList(collection: string): Promise<unknown[]> {
    const docs = await this.list(collection);
    const rows = docs.map((doc) => parseJson(doc.fields)).filter((value) => value !== undefined);
    return sortRows(rows);
  }

  private async readSystem(id: string): Promise<unknown> {
    const res = await fetch(`${this.rootUrl()}/system/${id}`, { headers: await this.headers() });
    if (res.status === 404) return undefined;
    if (!res.ok) throw new Error(`firestore get system/${id} ${res.status}`);
    const body = (await res.json()) as FsDoc;
    return parseJson(body.fields);
  }

  private mapWrites(collection: string, value: Record<string, unknown>, existing: FsDoc[]): FsWrite[] {
    const keep = new Set<string>();
    const writes: FsWrite[] = [];
    for (const [key, item] of Object.entries(value)) {
      const id = docId(key);
      keep.add(id);
      writes.push({ update: { name: this.docName(collection, id), fields: jsonFields(item) } });
    }
    for (const doc of existing) {
      const id = doc.name.slice(doc.name.lastIndexOf("/") + 1);
      if (!keep.has(id)) writes.push({ delete: doc.name });
    }
    return writes;
  }

  private listWrites(collection: string, rows: unknown[], existing: FsDoc[]): FsWrite[] {
    const keep = new Set<string>();
    const writes: FsWrite[] = [];
    rows.forEach((item, index) => {
      const id = docId(itemKey(item, index));
      keep.add(id);
      writes.push({ update: { name: this.docName(collection, id), fields: jsonFields(item) } });
    });
    for (const doc of existing) {
      const id = doc.name.slice(doc.name.lastIndexOf("/") + 1);
      if (!keep.has(id)) writes.push({ delete: doc.name });
    }
    return writes;
  }

  async ensure() {
    const res = await fetch(`${this.rootUrl()}/stations?pageSize=1`, { headers: await this.headers() });
    if (!res.ok) throw new Error(`firestore ${res.status}`);
  }

  async read(): Promise<Db> {
    const maps = await Promise.all(RECORD_COLLECTIONS.map((name) => this.readMap(name)));
    const lists = await Promise.all(ARRAY_COLLECTIONS.map((name) => this.readList(name)));
    const system = await Promise.all(SYSTEM_DOCS.map((name) => this.readSystem(name)));
    const partial: Partial<Db> = {};
    RECORD_COLLECTIONS.forEach((name, i) => {
      (partial as Record<string, unknown>)[name] = maps[i];
    });
    ARRAY_COLLECTIONS.forEach((name, i) => {
      (partial as Record<string, unknown>)[name] = lists[i];
    });
    SYSTEM_DOCS.forEach((name, i) => {
      if (system[i] !== undefined) (partial as Record<string, unknown>)[name] = system[i];
    });
    return hydrate(partial);
  }

  async write(db: Db) {
    const existing = await Promise.all(
      [...RECORD_COLLECTIONS, ...ARRAY_COLLECTIONS].map(async (name) => [name, await this.list(name)] as const),
    );
    const have = new Map(existing);
    const writes: FsWrite[] = [];
    for (const name of RECORD_COLLECTIONS) {
      writes.push(...this.mapWrites(name, db[name] as Record<string, unknown>, have.get(name) ?? []));
    }
    for (const name of ARRAY_COLLECTIONS) {
      writes.push(...this.listWrites(name, db[name] as unknown[], have.get(name) ?? []));
    }
    for (const name of SYSTEM_DOCS) {
      writes.push({ update: { name: this.docName("system", name), fields: jsonFields(db[name]) } });
    }
    await this.commit(writes);
  }

  photoPath(reportId: string) {
    const bucket = this.bucket();
    return bucket ? `gs://${bucket}/photos/${reportId}` : `photos/${reportId}`;
  }

  private objectUrl(reportId: string, upload = false): string {
    const bucket = this.bucket();
    if (!bucket) throw new Error("missing ZEPHYR_BUCKET");
    const name = encodeURIComponent(`photos/${reportId}`);
    if (upload) {
      const url = new URL(`https://storage.googleapis.com/upload/storage/v1/b/${encodeURIComponent(bucket)}/o`);
      url.searchParams.set("uploadType", "media");
      url.searchParams.set("name", `photos/${reportId}`);
      return url.toString();
    }
    return `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(bucket)}/o/${name}`;
  }

  async savePhoto(reportId: string, bytes: Buffer) {
    const payload = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(payload).set(bytes);
    const res = await fetch(this.objectUrl(reportId, true), {
      method: "POST",
      headers: { Authorization: `Bearer ${await this.auth()}`, "Content-Type": "application/octet-stream" },
      body: new Blob([payload]),
    });
    if (!res.ok) throw new Error(`storage upload ${res.status}`);
    return this.photoPath(reportId);
  }

  async photoExists(reportId: string) {
    if (!this.bucket()) return false;
    const res = await fetch(this.objectUrl(reportId), { headers: { Authorization: `Bearer ${await this.auth()}` } });
    if (!res.ok) return false;
    const meta = (await res.json()) as { size?: string };
    const size = Number(meta.size ?? 0);
    return size > 0 && size <= PHOTO_LIMIT;
  }

  async readPhoto(reportId: string) {
    const res = await fetch(`${this.objectUrl(reportId)}?alt=media`, {
      headers: { Authorization: `Bearer ${await this.auth()}` },
    });
    if (!res.ok) throw new Error(`storage read ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  }

  async deleteStalePhotos(maxAgeMs: number) {
    const bucket = this.bucket();
    if (!bucket) return;
    const token = await this.auth();
    const names: Array<{ name: string; updated?: string }> = [];
    let pageToken = "";
    do {
      const url = new URL(`https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(bucket)}/o`);
      url.searchParams.set("prefix", "photos/");
      if (pageToken) url.searchParams.set("pageToken", pageToken);
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error(`storage list ${res.status}`);
      const body = (await res.json()) as { items?: Array<{ name: string; updated?: string }>; nextPageToken?: string };
      names.push(...(body.items ?? []));
      pageToken = body.nextPageToken ?? "";
    } while (pageToken);
    const db = await this.read();
    const now = Date.now();
    for (const item of names) {
      const reportId = item.name.slice("photos/".length);
      const committed = Object.values(db.reports).some((report) => report.id === reportId && report.status !== "pending_upload");
      if (committed || !item.updated) continue;
      if (now - Date.parse(item.updated) > maxAgeMs) {
        const del = await fetch(
          `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(bucket)}/o/${encodeURIComponent(item.name)}`,
          { method: "DELETE", headers: { Authorization: `Bearer ${token}` } },
        );
        if (!del.ok && del.status !== 404) throw new Error(`storage delete ${del.status}`);
      }
    }
  }
}

export async function openStore(dataDir: string): Promise<FileStore> {
  if (process.env.ZEPHYR_STORE !== "gcp") return new FileStore(dataDir);
  try {
    const store = new GcpStore(dataDir);
    await store.ensure();
    return store;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (!fallbackLogged) {
      fallbackLogged = true;
      console.error("gcp store unavailable, using file store:", message);
    }
    const file = new FileStore(dataDir);
    (file as FileStore & { fallbackError: string }).fallbackError = message;
    return file;
  }
}
