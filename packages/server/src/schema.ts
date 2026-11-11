import type { Db } from "./store.js";

export type CollectionName = keyof Db;

export type ColumnSpec = {
  name: string;
  sql: string;
  index?: boolean;
  value: (doc: unknown, key: string) => string | number | boolean | null;
};

export type CollectionSpec = {
  name: CollectionName;
  table: string;
  kind: "record" | "array" | "singleton";
  keyOf?: (item: unknown) => string;
  columns: ColumnSpec[];
  /** Drop rows older than this many days. Windowed reads only load this span. */
  retentionDays?: number;
  timeColumn?: string;
};

const city = (doc: unknown): string | null => {
  const value = (doc as { cityId?: string } | null)?.cityId;
  return typeof value === "string" ? value : null;
};
const text = (doc: unknown, field: string): string | null => {
  const value = (doc as Record<string, unknown> | null)?.[field];
  return typeof value === "string" ? value : null;
};
const num = (doc: unknown, field: string): number | null => {
  const value = (doc as Record<string, unknown> | null)?.[field];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
};
const bool = (doc: unknown, field: string): boolean | null => {
  const value = (doc as Record<string, unknown> | null)?.[field];
  return typeof value === "boolean" ? value : null;
};

function cols(...items: ColumnSpec[]): ColumnSpec[] {
  return items;
}

export const COLLECTIONS: CollectionSpec[] = [
  {
    name: "stations",
    table: "stations",
    kind: "record",
    columns: cols(
      { name: "city_id", sql: "text", index: true, value: city },
      { name: "lat", sql: "double precision", value: (doc) => num(doc, "lat") },
      { name: "lng", sql: "double precision", value: (doc) => num(doc, "lng") },
      { name: "source_feed", sql: "text", value: (doc) => text(doc, "sourceFeed") },
      { name: "online", sql: "boolean", value: (doc) => bool(doc, "online") },
      { name: "aqi", sql: "double precision", value: (doc) => num(doc, "aqi") },
      { name: "last_seen", sql: "timestamptz", value: (doc) => text(doc, "lastSeen") },
    ),
  },
  {
    name: "citySummaries",
    table: "city_summaries",
    kind: "record",
    columns: [],
  },
  {
    name: "wards",
    table: "wards",
    kind: "record",
    columns: cols({ name: "city_id", sql: "text", index: true, value: city }),
  },
  {
    name: "reports",
    table: "reports",
    kind: "record",
    columns: cols(
      { name: "city_id", sql: "text", index: true, value: city },
      { name: "h3", sql: "text", index: true, value: (doc) => text(doc, "h3") },
      { name: "status", sql: "text", value: (doc) => text(doc, "status") },
      { name: "reporter_key", sql: "text", index: true, value: (doc) => text(doc, "reporterKey") },
      { name: "reporter_uid", sql: "text", value: (doc) => text(doc, "reporterUid") },
      { name: "created_at", sql: "timestamptz", value: (doc) => text(doc, "createdAt") },
    ),
  },
  {
    name: "incidents",
    table: "incidents",
    kind: "record",
    columns: cols(
      { name: "city_id", sql: "text", value: city },
      { name: "h3", sql: "text", index: true, value: (doc) => text(doc, "h3") },
      { name: "status", sql: "text", value: (doc) => text(doc, "status") },
      { name: "dedupe_key", sql: "text", value: (doc) => text(doc, "dedupeKey") },
      { name: "opened_at", sql: "timestamptz", value: (doc) => text(doc, "openedAt") },
    ),
  },
  {
    name: "incidentEvents",
    table: "incident_events",
    kind: "array",
    keyOf: (item) => text(item, "id") ?? "",
    columns: cols(
      { name: "incident_id", sql: "text", index: true, value: (doc) => text(doc, "incidentId") },
      { name: "at", sql: "timestamptz", value: (doc) => text(doc, "at") },
    ),
  },
  {
    name: "diaries",
    table: "diaries",
    kind: "record",
    columns: cols({ name: "city_id", sql: "text", value: city }),
  },
  {
    name: "subscriptions",
    table: "subscriptions",
    kind: "record",
    columns: cols({ name: "city_id", sql: "text", value: city }),
  },
  {
    name: "notifications",
    table: "notifications",
    kind: "array",
    keyOf: (item) => text(item, "id") ?? "",
    retentionDays: 30,
    timeColumn: "created_at",
    columns: cols(
      { name: "uid", sql: "text", index: true, value: (doc) => text(doc, "uid") },
      { name: "created_at", sql: "timestamptz", value: (doc) => text(doc, "createdAt") },
    ),
  },
  {
    name: "apiKeys",
    table: "api_keys",
    kind: "record",
    columns: cols({ name: "uid", sql: "text", index: true, value: (doc) => text(doc, "uid") }),
  },
  {
    name: "rateLimits",
    table: "rate_limits",
    kind: "record",
    columns: [],
  },
  {
    name: "dlqItems",
    table: "dlq_items",
    kind: "record",
    columns: [],
  },
  {
    name: "exposure",
    table: "exposure",
    kind: "array",
    keyOf: (item) => `${text(item, "uid")}|${text(item, "h3")}|${text(item, "observedAt")}`,
    retentionDays: 30,
    timeColumn: "observed_at",
    columns: cols(
      { name: "uid", sql: "text", value: (doc) => text(doc, "uid") },
      { name: "observed_at", sql: "timestamptz", value: (doc) => text(doc, "observedAt") },
    ),
  },
  {
    name: "hourly",
    table: "hourly",
    kind: "array",
    keyOf: (item) => `${text(item, "stationId")}|${text(item, "observedAt")}`,
    retentionDays: 14,
    timeColumn: "observed_at",
    columns: cols(
      { name: "station_id", sql: "text", index: true, value: (doc) => text(doc, "stationId") },
      { name: "city_id", sql: "text", value: city },
      { name: "observed_at", sql: "timestamptz", value: (doc) => text(doc, "observedAt") },
    ),
  },
  {
    name: "previousHexAqi",
    table: "previous_hex_aqi",
    kind: "record",
    columns: [],
  },
  {
    name: "pendingMessages",
    table: "pending_messages",
    kind: "array",
    keyOf: (item) => text(item, "id") ?? "",
    columns: cols({ name: "created_at", sql: "timestamptz", value: () => null }),
  },
  {
    name: "satelliteCells",
    table: "satellite_cells",
    kind: "record",
    columns: cols({ name: "city_id", sql: "text", value: city }),
  },
  {
    name: "fires",
    table: "fires",
    kind: "array",
    keyOf: (item) => text(item, "id") ?? "",
    columns: cols({ name: "city_id", sql: "text", index: true, value: city }),
  },
  {
    name: "osmPlaces",
    table: "osm_places",
    kind: "record",
    columns: [],
  },
  {
    name: "pendingTasks",
    table: "pending_tasks",
    kind: "array",
    keyOf: (item) => text(item, "id") ?? "",
    columns: cols({ name: "created_at", sql: "timestamptz", value: (doc) => text(doc, "createdAt") }),
  },
  {
    name: "modelledHistory",
    table: "modelled_history",
    kind: "array",
    keyOf: (item) => `${text(item, "stationId")}|${text(item, "at")}`,
    retentionDays: 7,
    timeColumn: "at",
    columns: cols(
      { name: "station_id", sql: "text", index: true, value: (doc) => text(doc, "stationId") },
      { name: "at", sql: "timestamptz", value: (doc) => text(doc, "at") },
    ),
  },
  {
    name: "sensorStreak",
    table: "sensor_streak",
    kind: "record",
    columns: [],
  },
  {
    name: "users",
    table: "users",
    kind: "record",
    columns: cols({ name: "email", sql: "text", index: true, value: (doc) => text(doc, "email") }),
  },
  {
    name: "surfaceCells",
    table: "surface_cells",
    kind: "record",
    columns: cols(
      { name: "city_id", sql: "text", index: true, value: city },
      { name: "basis", sql: "text", value: (doc) => text(doc, "basis") },
    ),
  },
  {
    name: "ingestJobs",
    table: "ingest_jobs",
    kind: "record",
    columns: cols(
      { name: "kind", sql: "text", value: (doc) => text(doc, "kind") },
      { name: "shard", sql: "text", value: (doc) => text(doc, "shard") },
      { name: "status", sql: "text", index: true, value: (doc) => text(doc, "status") },
      { name: "lease_until", sql: "timestamptz", value: (doc) => text(doc, "leaseUntil") },
      { name: "created_at", sql: "timestamptz", value: (doc) => text(doc, "createdAt") },
    ),
  },
  { name: "config", table: "kv", kind: "singleton", columns: [] },
  { name: "ingest", table: "kv", kind: "singleton", columns: [] },
];

export function specFor(name: CollectionName): CollectionSpec {
  const spec = COLLECTIONS.find((item) => item.name === name);
  if (!spec) throw new Error(`unknown collection ${name}`);
  return spec;
}

const WINDOW_CAP = 5000;

export function createStatements(): string[] {
  const statements: string[] = [
    `create table if not exists schema_migrations (version int primary key, applied_at timestamptz not null default now())`,
  ];
  const seen = new Set<string>();
  for (const spec of COLLECTIONS) {
    if (seen.has(spec.table)) continue;
    seen.add(spec.table);
    const extra = spec.table === "kv" ? "" : COLLECTIONS.filter((item) => item.table === spec.table)[0]!.columns.map((col) => `${col.name} ${col.sql}`).join(", ");
    const cols = extra ? `, ${extra}` : "";
    statements.push(
      `create table if not exists ${spec.table} (
        key text primary key,
        rev bigint not null default 1,
        updated_at timestamptz not null default now()${cols},
        doc jsonb not null
      )`,
    );
  }
  for (const spec of COLLECTIONS) {
    for (const col of spec.columns) {
      if (!col.index) continue;
      statements.push(`create index if not exists ${spec.table}_${col.name}_idx on ${spec.table} (${col.name})`);
    }
  }
  statements.push(`create index if not exists stations_lat_lng_idx on stations (lat, lng)`);
  statements.push(`create index if not exists incidents_city_status_idx on incidents (city_id, status)`);
  statements.push(`create index if not exists reports_city_status_idx on reports (city_id, status)`);
  statements.push(`create index if not exists ingest_jobs_status_created_idx on ingest_jobs (status, created_at)`);
  statements.push(`create index if not exists hourly_station_time_idx on hourly (station_id, observed_at desc)`);
  return statements;
}

export const WINDOW_ROW_CAP = WINDOW_CAP;

export function legacyImportSql(): string {
  return `
    do $$
    declare doc jsonb;
    begin
      if to_regclass('public.zephyr_state') is null then
        return;
      end if;
      if (select count(*) from stations) > 0 then
        return;
      end if;
      select s.doc into doc from zephyr_state s where s.id = 1;
      if doc is null then
        return;
      end if;
      alter table zephyr_state rename to zephyr_state_legacy;
    end $$;
  `;
}
