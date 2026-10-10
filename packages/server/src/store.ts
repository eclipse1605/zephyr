import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile, readdir, unlink, stat } from "node:fs/promises";
import path from "node:path";
import type {
  DataMode,
  IncidentStatus,
  PromotionReason,
  HazardType,
} from "@zephyr/domain";

export type StoredStation = {
  id: string;
  name: string;
  cityId: string;
  lat: number;
  lng: number;
  owner?: string;
  sourceFeed: string;
  lastSeen: string;
  online: boolean;
  pollutants: Record<string, number | null | undefined>;
  aqi: number | null;
  dominantPollutant: string | null;
  band: string | null;
};

export type CitySummary = {
  cityId: string;
  computedAt: string;
  dataMode: DataMode;
  cityAqi: number | null;
  liveStationCount: number;
  offlineStationCount: number;
  peopleInPoor: number;
  coveredPopulation: number;
  uncoveredPopulation: number;
  shareInPoor: number | null;
  openIncidentCount: number;
  equity: { p90: number | null; p10: number | null; ratio: number | null };
  topWards: Array<{ id: string; name: string; aqi: number }>;
  bottomWards: Array<{ id: string; name: string; aqi: number }>;
};

export type StoredWard = {
  id: string;
  cityId: string;
  name: string;
  population: number;
  centroid: { lat: number; lng: number };
  nearestStationId: string | null;
  distanceKm: number | null;
  aqi: number | null;
  covered: boolean;
  unhealthy: boolean;
};

export type StoredReport = {
  id: string;
  cityId: string;
  h3: string;
  lat: number;
  lng: number;
  hazardType: HazardType;
  note: string;
  photoPath: string | null;
  photoSha256: string | null;
  voicePath: string | null;
  status: string;
  classification: Record<string, unknown> | null;
  authenticity: { ok: boolean; reasons: string[] } | null;
  countsTowardPromotion: boolean;
  createdAt: string;
  reporterUid: string | null;
  reporterKey: string;
  channel: "web" | "whatsapp";
  ipHash: string;
  incidentId: string | null;
  closureTokenHash: string | null;
};

export type StoredIncident = {
  id: string;
  cityId: string;
  h3: string;
  status: IncidentStatus;
  reason: PromotionReason;
  openedAt: string;
  reportIds: string[];
  stationId: string | null;
  fusion: Record<string, unknown> | null;
  assignee: string | null;
  workOrder: Record<string, unknown> | null;
  resolvedAt: string | null;
  closure: {
    open: boolean;
    expiresAt: string | null;
    answer: string | null;
  } | null;
  dedupeKey: string;
  priority: "immediate" | "within_24h" | "routine";
};

export type SystemConfig = {
  dataMode: DataMode;
  fixtureWeek: string;
};

export type IngestStatus = {
  lastSuccessAt: string | null;
  lastError: string | null;
  stationCounts: Record<string, number>;
  satelliteStatus: string;
};

export type DlqItem = {
  messageId: string;
  body: unknown;
  error: string;
  failedAt: string;
  replayedAt: string | null;
};

export type Diary = { uid: string; h3: string; lat: number; lng: number; cityId: string };
export type Subscription = {
  uid: string;
  h3: string;
  cityId: string;
  channels: Array<"in_app" | "email" | "whatsapp">;
  createdAt: string;
  lastNotifiedAt: string | null;
};
export type Notification = {
  id: string;
  uid: string;
  h3: string;
  aqi: number;
  channel: string;
  createdAt: string;
  read: boolean;
};
export type ApiKeyRecord = { keyHash: string; uid: string; prefix: string; createdAt: string };
export type ExposureSnap = {
  uid: string;
  h3: string;
  cityId: string;
  observedAt: string;
  aqi: number | null;
  band: string | null;
};
export type HourlyReading = {
  stationId: string;
  cityId: string;
  observedAt: string;
  pm25: number | null;
  aqi: number | null;
  source: DataMode;
};
export type IncidentEvent = {
  id: string;
  incidentId: string;
  type: string;
  at: string;
  actor: string | null;
  h3: string;
};

type Db = {
  stations: Record<string, StoredStation>;
  citySummaries: Record<string, CitySummary>;
  wards: Record<string, StoredWard>;
  reports: Record<string, StoredReport>;
  incidents: Record<string, StoredIncident>;
  incidentEvents: IncidentEvent[];
  diaries: Record<string, Diary>;
  subscriptions: Record<string, Subscription>;
  notifications: Notification[];
  apiKeys: Record<string, ApiKeyRecord>;
  rateLimits: Record<string, { count: number; windowStart: string }>;
  dlqItems: Record<string, DlqItem>;
  config: SystemConfig;
  ingest: IngestStatus;
  exposure: ExposureSnap[];
  hourly: HourlyReading[];
  previousHexAqi: Record<string, number | null>;
  pendingMessages: Array<{ id: string; type: string; body: unknown }>;
};

const DEFAULT_DB = (): Db => ({
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
  },
  exposure: [],
  hourly: [],
  previousHexAqi: {},
  pendingMessages: [],
});

export class FileStore {
  constructor(private root: string) {}

  private dbPath() {
    return path.join(this.root, "db.json");
  }

  async ensure() {
    await mkdir(this.root, { recursive: true });
    await mkdir(path.join(this.root, "photos"), { recursive: true });
    await mkdir(path.join(this.root, "voice"), { recursive: true });
    try {
      await readFile(this.dbPath(), "utf8");
    } catch {
      await this.write(DEFAULT_DB());
    }
  }

  async read(): Promise<Db> {
    await this.ensure();
    const raw = await readFile(this.dbPath(), "utf8");
    return { ...DEFAULT_DB(), ...JSON.parse(raw) } as Db;
  }

  async write(db: Db) {
    await this.ensure();
    await writeFile(this.dbPath(), JSON.stringify(db, null, 2));
  }

  async update(fn: (db: Db) => void | Promise<void>): Promise<Db> {
    const db = await this.read();
    await fn(db);
    await this.write(db);
    return db;
  }

  photoPath(reportId: string) {
    return path.join(this.root, "photos", reportId);
  }

  async savePhoto(reportId: string, bytes: Buffer) {
    await this.ensure();
    const p = this.photoPath(reportId);
    await writeFile(p, bytes);
    return p;
  }

  async photoExists(reportId: string) {
    try {
      const s = await stat(this.photoPath(reportId));
      return s.isFile() && s.size > 0 && s.size <= 5 * 1024 * 1024;
    } catch {
      return false;
    }
  }

  async readPhoto(reportId: string) {
    return readFile(this.photoPath(reportId));
  }

  async deleteStalePhotos(maxAgeMs: number) {
    const dir = path.join(this.root, "photos");
    await mkdir(dir, { recursive: true });
    const names = await readdir(dir);
    const now = Date.now();
    const db = await this.read();
    for (const name of names) {
      const committed = Object.values(db.reports).some((r) => r.id === name && r.status !== "pending_upload");
      if (committed) continue;
      const p = path.join(dir, name);
      const s = await stat(p);
      if (now - s.mtimeMs > maxAgeMs) await unlink(p);
    }
  }
}

export function sha256(input: string | Buffer): string {
  return createHash("sha256").update(input).digest("hex");
}

export function newId(): string {
  return randomUUID();
}

export function newToken(): { raw: string; hash: string } {
  const raw = randomBytes(24).toString("hex");
  return { raw, hash: sha256(raw) };
}

export function hashIp(ip: string): string {
  return sha256(`ip:${ip}`);
}
