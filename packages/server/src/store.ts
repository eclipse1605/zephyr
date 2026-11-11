import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { ObjectStore } from "./objectStore.js";
import type { CollectionName } from "./schema.js";
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
  contentHash?: string | null;
};

export type IngestJobKind = "catalog" | "wind" | "ops";
export type IngestJobStatus = "queued" | "running" | "done" | "dead";

export type IngestJob = {
  id: string;
  kind: IngestJobKind;
  shard: string;
  cursor: string | null;
  leaseOwner: string | null;
  leaseUntil: string | null;
  failures: number;
  status: IngestJobStatus;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
  finishedAt: string | null;
};

export type CitySummary = {
  cityId: string;
  computedAt: string;
  dataMode: DataMode;
  cityAqi: number | null;
  liveStationCount: number;
  offlineStationCount: number;
  peopleInPoor: number | null;
  coveredPopulation: number | null;
  uncoveredPopulation: number | null;
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
  uploadTokenHash: string | null;
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
  upwind: Array<Record<string, unknown>>;
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
  feeds: Record<string, { ok: boolean; error: string | null; count: number }>;
};

export type StoredFire = { id: string; cityId: string; lat: number; lng: number; at: string };
export type StoredPlace = { id: string; name: string; kind: "landfill" | "industrial" | "terminal"; lat: number; lng: number };
export type StoredTask = { id: string; kind: "email" | "whatsapp"; payload: Record<string, unknown>; createdAt: string };

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

export type Db = {
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
  satelliteCells: Record<string, { h3: string; anomaly: boolean; no2: number | null; cityId: string }>;
  fires: StoredFire[];
  osmPlaces: Record<string, StoredPlace[]>;
  pendingTasks: StoredTask[];
  modelledHistory: Array<{ stationId: string; at: string; pm25: number }>;
  sensorStreak: Record<string, number>;
  users: Record<string, { uid: string; email: string; role: "resident" | "operator" }>;
  surfaceCells: Record<string, {
    h3: string;
    cityId: string;
    stationAqi: number | null;
    modelAqi: number | null;
    reportCount: number;
    publishedAqi: number | null;
    basis: "station" | "reports" | "model";
    computedAt: string;
  }>;
  ingestJobs: Record<string, IngestJob>;
};

export const emptyDb = (): Db => ({
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
  users: {},
  surfaceCells: {},
  ingestJobs: {},
});

export class StoreConflictError extends Error {
  constructor() {
    super("store_conflict");
    this.name = "StoreConflictError";
  }
}

export type ReadScope = {
  only?: CollectionName[];
  cityId?: string;
};

export type BBox = { west: number; south: number; east: number; north: number };

export interface Store {
  ensure(): Promise<void>;
  read(scope?: ReadScope): Promise<Db>;
  write(db: Db): Promise<void>;
  update(fn: (db: Db) => void | Promise<void>, scope?: ReadScope): Promise<Db>;
  saveReport(report: StoredReport): Promise<void>;
  pushPendingMessage(message: { id: string; type: string; body: unknown }): Promise<void>;
  savePhoto(reportId: string, bytes: Buffer): Promise<string>;
  photoExists(reportId: string): Promise<boolean>;
  readPhoto(reportId: string): Promise<Buffer>;
  deleteStalePhotos(maxAgeMs: number): Promise<void>;
  objects: ObjectStore;
  stationsInBounds(box: BBox): Promise<StoredStation[]>;
  stationsByCity(cityId: string): Promise<StoredStation[]>;
  claimNextIngestJob(owner: string, leaseMs: number, now?: Date): Promise<IngestJob | null>;
  recentHourly(stationId: string, hours: number, now?: Date): Promise<HourlyReading[]>;
  purgeExpired(now?: Date): Promise<void>;
  close?(): Promise<void>;
}

const memorySingletons = new Map<string, Store>();

export async function openStore(): Promise<Store> {
  if (process.env.ZEPHYR_TEST_MEMORY === "1") {
    const existing = memorySingletons.get("test");
    if (existing) return existing;
    const { MemoryStore } = await import("./memoryStore.js");
    const store = new MemoryStore();
    await store.ensure();
    memorySingletons.set("test", store);
    return store;
  }
  const url = process.env.DATABASE_URL?.trim();
  if (!url) throw new Error("DATABASE_URL is required (run: docker compose up -d postgres minio)");
  const { PostgresStore } = await import("./pgStore.js");
  const store = new PostgresStore();
  await store.ensure();
  return store;
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
