import { createHash } from "node:crypto";
import {
  CITIES,
  getCity,
  mergeStations,
  median,
  joinWardToStation,
  summarizeWardBurden,
  decidePromotion,
  incidentDedupeKey,
  utcDayKey,
  stationOverLimit,
  shouldNotifyAlert,
  latLngToH3,
  h3ToLatLng,
  nextSensorStreak,
  unhealthyThreshold,
  bandForScale,
  rankUpwind,
  type StationReading,
  type DataMode,
} from "@zephyr/domain";
import { FileStore, newId, type Db, type IngestJob, type StoredIncident, type StoredStation } from "./store.js";
import { publishedCityAqi, refreshCitySurface } from "./surface.js";
import { anomalyForPoint, fetchCityStations, fetchOsmPlaces, fetchWind, loadSatelliteContext } from "./live.js";
import { refreshWindGrid } from "./windGrid.js";
import { readFile } from "node:fs/promises";
import path from "node:path";

export type IngestRunOptions = {
  store: FileStore;
  fixturesRoot: string;
  dataDir?: string;
  now?: Date;
  workerId?: string;
  leaseMs?: number;
  pageSize?: number;
  sampleWindPath?: string;
};

type FixtureStation = {
  id: string;
  name: string;
  lat: number;
  lng: number;
  owner?: string;
  sourceFeed: "openaq" | "waqi" | "cpcb";
  series: Array<{ at: string; pm25: number; pm10?: number }>;
};

type FixtureFile = { week: string; stations: FixtureStation[] };

type WardGeo = {
  type: "FeatureCollection";
  features: Array<{
    type: "Feature";
    properties: { id: string; name: string; population: number };
    geometry: { type: "Point"; coordinates: [number, number] } | { type: "Polygon"; coordinates: number[][][] };
  }>;
};

function centroidOf(feature: WardGeo["features"][number]): { lat: number; lng: number } {
  if (feature.geometry.type === "Point") {
    const [lng, lat] = feature.geometry.coordinates;
    return { lat, lng };
  }
  const ring = feature.geometry.coordinates[0] ?? [];
  let lat = 0;
  let lng = 0;
  for (const [x, y] of ring) {
    lng += x;
    lat += y;
  }
  const n = Math.max(1, ring.length);
  return { lat: lat / n, lng: lng / n };
}

async function loadFixture(fixturesRoot: string, cityId: string): Promise<FixtureFile | null> {
  try {
    return JSON.parse(await readFile(path.join(fixturesRoot, "stations", `${cityId}.json`), "utf8")) as FixtureFile;
  } catch {
    return null;
  }
}

async function loadWards(fixturesRoot: string, cityId: string): Promise<WardGeo | null> {
  try {
    return JSON.parse(await readFile(path.join(fixturesRoot, "geo", `${cityId}-wards.geojson`), "utf8")) as WardGeo;
  } catch {
    return null;
  }
}

export function stationContentHash(station: {
  name: string;
  lat: number;
  lng: number;
  sourceFeed: string;
  online: boolean;
  pollutants: Record<string, number | null | undefined>;
  aqi: number | null;
  dominantPollutant: string | null;
  band: string | null;
}): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        name: station.name,
        lat: station.lat,
        lng: station.lng,
        sourceFeed: station.sourceFeed,
        online: station.online,
        pollutants: station.pollutants,
        aqi: station.aqi,
        dominantPollutant: station.dominantPollutant,
        band: station.band,
      }),
    )
    .digest("hex");
}

function pageSize(opts: IngestRunOptions): number {
  const n = opts.pageSize ?? Number(process.env.INGEST_PAGE_SIZE ?? 50);
  return Number.isFinite(n) ? Math.max(1, Math.floor(n)) : 50;
}

function leaseMs(opts: IngestRunOptions): number {
  return opts.leaseMs ?? 60_000;
}

function nowIso(now: Date): string {
  return now.toISOString();
}

export async function enqueueIngestJobs(store: FileStore, now = new Date()): Promise<{ enqueued: number; jobIds: string[] }> {
  const db = await store.read();
  const jobIds: string[] = [];
  const stamp = nowIso(now);
  for (const city of CITIES) {
    const id = newId();
    db.ingestJobs[id] = {
      id,
      kind: "catalog",
      shard: `city:${city.id}`,
      cursor: "0",
      leaseOwner: null,
      leaseUntil: null,
      failures: 0,
      status: "queued",
      lastError: null,
      createdAt: stamp,
      updatedAt: stamp,
      finishedAt: null,
    };
    jobIds.push(id);
  }
  for (const kind of ["wind", "ops"] as const) {
    const id = newId();
    db.ingestJobs[id] = {
      id,
      kind,
      shard: kind,
      cursor: null,
      leaseOwner: null,
      leaseUntil: null,
      failures: 0,
      status: "queued",
      lastError: null,
      createdAt: stamp,
      updatedAt: stamp,
      finishedAt: null,
    };
    jobIds.push(id);
  }
  await store.write(db);
  return { enqueued: jobIds.length, jobIds };
}

function claimable(job: IngestJob, now: Date): boolean {
  if (job.status === "dead" || job.status === "done") return false;
  if (job.status === "queued") return true;
  if (job.status === "running") {
    if (!job.leaseUntil) return true;
    return Date.parse(job.leaseUntil) <= now.getTime();
  }
  return false;
}

export async function claimNextJob(store: FileStore, opts: IngestRunOptions): Promise<IngestJob | null> {
  const now = opts.now ?? new Date();
  const owner = opts.workerId ?? `worker-${process.pid}`;
  const db = await store.read();
  const next = Object.values(db.ingestJobs)
    .filter((job) => claimable(job, now))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
  if (!next) return null;
  next.status = "running";
  next.leaseOwner = owner;
  next.leaseUntil = new Date(now.getTime() + leaseMs(opts)).toISOString();
  next.updatedAt = nowIso(now);
  await store.write(db);
  return { ...next };
}

async function loadCityReadings(db: Db, cityId: string, fixturesRoot: string, mode: DataMode, now: Date): Promise<StationReading[]> {
  const city = getCity(cityId);
  if (!city) return [];
  if (mode === "demo") {
    const fixture = await loadFixture(fixturesRoot, cityId);
    if (!fixture) return [];
    db.config.fixtureWeek = fixture.week;
    const readings: StationReading[] = [];
    const existingHourly = new Set(db.hourly.map((h) => `${h.stationId}:${h.observedAt}`));
    for (const s of fixture.stations) {
      const seriesTip = [...s.series].sort((a, b) => Date.parse(a.at) - Date.parse(b.at)).at(-1);
      if (!seriesTip) continue;
      readings.push({
        id: s.id,
        name: s.name,
        cityId,
        lat: s.lat,
        lng: s.lng,
        owner: s.owner,
        sourceFeed: s.sourceFeed,
        lastSeen: now.toISOString(),
        pollutants: { pm25: seriesTip.pm25, pm10: seriesTip.pm10 ?? null },
      });
      const tipMs = Date.parse(seriesTip.at);
      const historyCutoff = tipMs - 48 * 3600_000;
      for (const point of s.series) {
        const t = Date.parse(point.at);
        if (!Number.isFinite(t) || t < historyCutoff || t > tipMs) continue;
        const key = `${s.id}:${point.at}`;
        if (existingHourly.has(key)) continue;
        existingHourly.add(key);
        db.hourly.push({
          stationId: s.id,
          cityId,
          observedAt: point.at,
          pm25: point.pm25,
          aqi: null,
          source: "demo",
        });
      }
    }
    return readings;
  }
  const live = await fetchCityStations(city);
  for (const feed of live.feeds) {
    db.ingest.feeds[`${cityId}:${feed.source}`] = { ok: feed.ok, error: feed.error, count: feed.count };
  }
  // Drop stale CPCB failures left from earlier runs when the key is still unset.
  if (!process.env.CPCB_API_KEY?.trim()) {
    delete db.ingest.feeds[`${cityId}:cpcb`];
  }
  return live.readings.filter((reading) => reading.sourceFeed !== "waqi");
}

function upsertStation(db: Db, station: StoredStation): boolean {
  const hash = stationContentHash(station);
  const prev = db.stations[station.id];
  if (prev?.contentHash === hash) return false;
  db.stations[station.id] = { ...station, contentHash: hash };
  return true;
}

async function finishCityCatalog(db: Db, cityId: string, fixturesRoot: string, mode: DataMode, now: Date, merged: ReturnType<typeof mergeStations>) {
  const city = getCity(cityId);
  if (!city) return;
  const satellite = await loadSatelliteContext(city, fixturesRoot, mode);
  db.ingest.satelliteStatus = satellite.status;
  for (const cell of satellite.cells) {
    db.satelliteCells[cell.h3] = { ...cell, cityId };
  }
  db.fires = db.fires.filter((f) => f.cityId !== cityId).concat(satellite.fires);
  if (mode === "live" && (!db.osmPlaces[cityId]?.length || now.getUTCDay() === 1)) {
    try {
      db.osmPlaces[cityId] = await fetchOsmPlaces(city);
    } catch {
      db.osmPlaces[cityId] = db.osmPlaces[cityId] ?? [];
    }
  }
  const liveAqis = merged.filter((s) => s.online && s.aqi != null).map((s) => s.aqi!);
  refreshCitySurface(db, cityId, now);
  const cityAqi = publishedCityAqi(db, cityId, median(liveAqis));
  const geo = await loadWards(fixturesRoot, cityId);
  const joined = [];
  if (geo) {
    for (const f of geo.features) {
      const ward = joinWardToStation(
        { id: f.properties.id, name: f.properties.name, population: f.properties.population, centroid: centroidOf(f) },
        merged.map((s) => ({ id: s.id, lat: s.lat, lng: s.lng, aqi: s.aqi, online: s.online })),
        unhealthyThreshold(city.aqiScale),
      );
      joined.push(ward);
      db.wards[`${cityId}_${ward.id}`] = {
        id: ward.id,
        cityId,
        name: ward.name,
        population: ward.population,
        centroid: ward.centroid,
        nearestStationId: ward.nearestStationId,
        distanceKm: ward.distanceKm,
        aqi: ward.aqi,
        covered: ward.covered,
        unhealthy: ward.unhealthy,
      };
    }
  }
  const burden = summarizeWardBurden(joined);
  const openIncidentCount = Object.values(db.incidents).filter(
    (i) => i.cityId === cityId && (i.status === "open" || i.status === "dispatched" || i.status === "disputed"),
  ).length;
  db.citySummaries[cityId] = {
    cityId,
    computedAt: now.toISOString(),
    dataMode: mode,
    cityAqi,
    liveStationCount: merged.filter((s) => s.online).length,
    offlineStationCount: merged.filter((s) => !s.online).length,
    peopleInPoor: null,
    coveredPopulation: null,
    uncoveredPopulation: null,
    shareInPoor: null,
    openIncidentCount,
    equity: { p90: null, p10: null, ratio: null },
    topWards: burden.topWards,
    bottomWards: burden.bottomWards,
  };
  db.ingest.stationCounts[cityId] = merged.length;

  for (const s of merged.filter((x) => x.online && x.aqi != null)) {
    const over = stationOverLimit(s.pollutants, city.standards, s.aqi, city.aqiScale);
    const streak = nextSensorStreak(db.sensorStreak[s.id] ?? 0, over);
    db.sensorStreak[s.id] = streak;
    const satelliteAnomaly = anomalyForPoint(satellite.cells, s.lat, s.lng);
    const decision = decidePromotion({
      reports: [],
      sensorOverLimit: over,
      satelliteAnomaly,
      consecutiveSensorOverLimit: streak,
      sensorAqi: s.aqi,
      aqiScale: city.aqiScale,
      standards: city.standards,
    });
    if (!(decision.promote && decision.reason)) continue;
    const h3 = latLngToH3({ lat: s.lat, lng: s.lng });
    const dedupeKey = incidentDedupeKey(h3, decision.reason, utcDayKey(now));
    if (Object.values(db.incidents).some((i) => i.dedupeKey === dedupeKey)) continue;
    const id = newId();
    const incident: StoredIncident = {
      id,
      cityId,
      h3,
      status: "open",
      reason: decision.reason,
      openedAt: now.toISOString(),
      reportIds: [],
      stationId: s.id,
      fusion: { sensorScore: 80, satelliteScore: satelliteAnomaly ? 70 : null, visualScore: null, corroborationScore: null },
      upwind: [],
      assignee: null,
      workOrder: {
        priority: s.aqi! >= 301 ? "immediate" : "within_24h",
        summary: `Ambient exceedance near ${s.name}`,
        language: city.localLanguage?.code ?? "en",
      },
      resolvedAt: null,
      closure: null,
      dedupeKey,
      priority: s.aqi! >= 301 ? "immediate" : "within_24h",
    };
    db.incidents[id] = incident;
    db.incidentEvents.push({ id: newId(), incidentId: id, type: "promoted", at: now.toISOString(), actor: "system", h3 });
  }
}

async function runCatalogPage(job: IngestJob, opts: IngestRunOptions): Promise<void> {
  const now = opts.now ?? new Date();
  const cityId = job.shard.replace(/^city:/, "");
  const db = await opts.store.read();
  const mode: DataMode = db.config.dataMode;
  const readings = await loadCityReadings(db, cityId, opts.fixturesRoot, mode, now);
  const city = getCity(cityId);
  if (!city) {
    job.status = "done";
    job.finishedAt = nowIso(now);
    job.updatedAt = nowIso(now);
    db.ingestJobs[job.id] = job;
    await opts.store.write(db);
    return;
  }
  const openaqFeed = db.ingest.feeds[`${cityId}:openaq`];
  const openaqFailed = Boolean(openaqFeed && !openaqFeed.ok);
  // Keep the previous catalog when live OpenAQ returns nothing — do not zero stationCounts.
  if (mode === "live" && readings.length === 0 && openaqFailed) {
    db.ingest.stationCounts[cityId] = Object.values(db.stations).filter((s) => s.cityId === cityId).length;
    job.cursor = null;
    job.status = "done";
    job.finishedAt = nowIso(now);
    job.updatedAt = nowIso(now);
    db.ingestJobs[job.id] = job;
    await opts.store.write(db);
    return;
  }
  const merged = mergeStations(readings, city.aqiScale, now);
  const start = Number(job.cursor ?? "0") || 0;
  const size = pageSize(opts);
  const slice = merged.slice(start, start + size);
  for (const s of slice) {
    upsertStation(db, {
      id: s.id,
      name: s.name,
      cityId: s.cityId,
      lat: s.lat,
      lng: s.lng,
      owner: s.owner,
      sourceFeed: s.sourceFeed,
      lastSeen: s.lastSeen,
      online: s.online,
      pollutants: s.pollutants,
      aqi: s.aqi,
      dominantPollutant: s.dominantPollutant,
      band: s.band,
      contentHash: null,
    });
  }
  const next = start + slice.length;
  if (next >= merged.length) {
    await finishCityCatalog(db, cityId, opts.fixturesRoot, mode, now, merged);
    job.cursor = null;
    job.status = "done";
    job.finishedAt = nowIso(now);
  } else {
    job.cursor = String(next);
    job.status = "queued";
    job.leaseOwner = null;
    job.leaseUntil = null;
  }
  job.updatedAt = nowIso(now);
  db.ingestJobs[job.id] = job;
  await opts.store.write(db);
}

async function runOpsJob(job: IngestJob, opts: IngestRunOptions): Promise<void> {
  const now = opts.now ?? new Date();
  const db = await opts.store.read();
  const mode: DataMode = db.config.dataMode;
  for (const diary of Object.values(db.diaries)) {
    const stations = Object.values(db.stations).filter((s) => s.cityId === diary.cityId && s.online && s.aqi != null);
    if (!stations.length) continue;
    const joined = joinWardToStation(
      { id: diary.uid, name: "diary", population: 1, centroid: { lat: diary.lat, lng: diary.lng } },
      stations.map((s) => ({ id: s.id, lat: s.lat, lng: s.lng, aqi: s.aqi, online: s.online })),
    );
    const surface = db.surfaceCells[diary.h3];
    const aqi = surface?.publishedAqi ?? (joined.covered ? joined.aqi : null);
    db.exposure.push({
      uid: diary.uid,
      h3: diary.h3,
      cityId: diary.cityId,
      observedAt: now.toISOString(),
      aqi,
      band: aqi != null ? bandForScale(aqi, getCity(diary.cityId)?.aqiScale ?? "india") : null,
    });
  }
  for (const sub of Object.values(db.subscriptions)) {
    const stations = Object.values(db.stations).filter((s) => s.cityId === sub.cityId && s.online && s.aqi != null);
    if (!stations.length) continue;
    const city = getCity(sub.cityId);
    if (!city) continue;
    const center = h3ToLatLng(sub.h3);
    const joined = joinWardToStation(
      { id: sub.h3, name: sub.h3, population: 1, centroid: center },
      stations.map((s) => ({ id: s.id, lat: s.lat, lng: s.lng, aqi: s.aqi, online: s.online })),
      unhealthyThreshold(city.aqiScale),
    );
    const surface = db.surfaceCells[sub.h3];
    const current = surface?.publishedAqi ?? (joined.covered ? joined.aqi : null);
    const previous = db.previousHexAqi[sub.h3] ?? null;
    const decision = shouldNotifyAlert({
      previousAqi: previous,
      currentAqi: current,
      lastNotifiedAt: sub.lastNotifiedAt,
      threshold: unhealthyThreshold(city.aqiScale),
      now,
    });
    if (current != null) db.previousHexAqi[sub.h3] = current;
    if (decision.notify && current != null) {
      for (const channel of sub.channels.length ? sub.channels : ["in_app" as const]) {
        db.notifications.push({
          id: newId(),
          uid: sub.uid,
          h3: sub.h3,
          aqi: current,
          channel,
          createdAt: now.toISOString(),
          read: false,
        });
        if (channel === "email" || channel === "whatsapp") {
          db.pendingTasks.push({
            id: newId(),
            kind: channel,
            payload: { uid: sub.uid, h3: sub.h3, aqi: current, cityId: sub.cityId },
            createdAt: now.toISOString(),
          });
        }
      }
      sub.lastNotifiedAt = now.toISOString();
    }
  }
  const windByCity = new Map<string, number>();
  for (const incident of Object.values(db.incidents)) {
    if (!["open", "dispatched", "disputed"].includes(incident.status)) continue;
    const places = db.osmPlaces[incident.cityId] ?? [];
    const station = incident.stationId ? db.stations[incident.stationId] : undefined;
    if (!station && !places.length) continue;
    const origin = station ? { lat: station.lat, lng: station.lng } : { lat: places[0]!.lat, lng: places[0]!.lng };
    if (!windByCity.has(incident.cityId)) {
      const wind = mode === "demo" ? 180 : await fetchWind(origin.lat, origin.lng).catch(() => 0);
      windByCity.set(incident.cityId, wind);
    }
    incident.upwind = rankUpwind(origin, windByCity.get(incident.cityId) ?? 0, [
      ...places,
      ...db.fires
        .filter((f) => f.cityId === incident.cityId)
        .map((f) => ({ id: f.id, name: "fire", kind: "fire" as const, lat: f.lat, lng: f.lng })),
    ]);
  }
  db.ingest.lastSuccessAt = now.toISOString();
  db.ingest.lastError = null;
  job.status = "done";
  job.finishedAt = nowIso(now);
  job.updatedAt = nowIso(now);
  db.ingestJobs[job.id] = job;
  await opts.store.write(db);
  await opts.store.deleteStalePhotos(24 * 3600_000);
}

async function failJob(store: FileStore, job: IngestJob, error: string, now: Date): Promise<void> {
  const db = await store.read();
  const current = db.ingestJobs[job.id];
  if (!current) return;
  current.failures += 1;
  current.lastError = error;
  current.leaseOwner = null;
  current.leaseUntil = null;
  current.updatedAt = nowIso(now);
  if (current.failures >= 5) {
    current.status = "dead";
    current.finishedAt = nowIso(now);
    db.dlqItems[current.id] = {
      messageId: current.id,
      body: { kind: "ingest_job", jobId: current.id, shard: current.shard, ingestKind: current.kind },
      error,
      failedAt: nowIso(now),
      replayedAt: null,
    };
  } else {
    current.status = "queued";
  }
  db.ingestJobs[current.id] = current;
  await store.write(db);
}

export async function runClaimedJob(job: IngestJob, opts: IngestRunOptions): Promise<void> {
  const now = opts.now ?? new Date();
  try {
    if (job.kind === "catalog") {
      await runCatalogPage(job, opts);
      return;
    }
    if (job.kind === "wind") {
      const dataDir = opts.dataDir ?? process.env.ZEPHYR_DATA_DIR?.trim();
      if (dataDir) {
        await refreshWindGrid({
          dataDir,
          samplePath: opts.sampleWindPath ?? path.join(opts.fixturesRoot, "wind", "sample.json"),
        }).catch(() => undefined);
      }
      const db = await opts.store.read();
      job.status = "done";
      job.finishedAt = nowIso(now);
      job.updatedAt = nowIso(now);
      db.ingestJobs[job.id] = job;
      await opts.store.write(db);
      return;
    }
    if (job.kind === "ops") {
      await runOpsJob(job, opts);
    }
  } catch (err) {
    await failJob(opts.store, job, err instanceof Error ? err.message : String(err), now);
  }
}

export async function drainIngestJobs(opts: IngestRunOptions, limit = 500): Promise<{ ran: number }> {
  let ran = 0;
  for (let i = 0; i < limit; i++) {
    const job = await claimNextJob(opts.store, opts);
    if (!job) break;
    await runClaimedJob(job, opts);
    ran += 1;
  }
  return { ran };
}

export async function replayIngestJob(store: FileStore, jobId: string, now = new Date()): Promise<boolean> {
  const db = await store.read();
  const job = db.ingestJobs[jobId];
  if (!job) return false;
  job.status = "queued";
  job.failures = 0;
  job.lastError = null;
  job.leaseOwner = null;
  job.leaseUntil = null;
  job.finishedAt = null;
  job.updatedAt = nowIso(now);
  if (job.kind === "catalog" && !job.cursor) job.cursor = "0";
  const dlq = db.dlqItems[jobId];
  if (dlq) dlq.replayedAt = nowIso(now);
  await store.write(db);
  return true;
}

/** Bootstrap helper: enqueue and process until idle (demo seed / tests). */
export async function runTickViaJobs(opts: IngestRunOptions) {
  try {
    await enqueueIngestJobs(opts.store, opts.now);
    await drainIngestJobs(opts);
    return { ok: true as const, mode: (await opts.store.read()).config.dataMode };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await opts.store.update((db) => {
      db.ingest.lastError = message;
    });
    return { ok: false as const, error: message };
  }
}
