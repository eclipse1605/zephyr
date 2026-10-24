import { readFile } from "node:fs/promises";
import path from "node:path";
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
  type StationReading,
  type DataMode,
} from "@zephyr/domain";
import { FileStore, newId, type StoredIncident } from "./store.js";
import { anomalyForPoint, fetchCityStations, fetchOsmPlaces, fetchWind, loadSatelliteContext } from "./live.js";
import { sleep } from "./util.js";
import { rankUpwind } from "@zephyr/domain";

export type TickOptions = {
  fixturesRoot: string;
  store: FileStore;
  now?: Date;
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

type FixtureFile = {
  week: string;
  stations: FixtureStation[];
};

type WardGeo = {
  type: "FeatureCollection";
  features: Array<{
    type: "Feature";
    properties: { id: string; name: string; population: number; source?: string; year?: number };
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
    const raw = await readFile(path.join(fixturesRoot, "stations", `${cityId}.json`), "utf8");
    return JSON.parse(raw) as FixtureFile;
  } catch {
    return null;
  }
}

async function loadWards(fixturesRoot: string, cityId: string): Promise<WardGeo | null> {
  try {
    const raw = await readFile(path.join(fixturesRoot, "geo", `${cityId}-wards.geojson`), "utf8");
    return JSON.parse(raw) as WardGeo;
  } catch {
    return null;
  }
}

function pickLatest(series: FixtureStation["series"], now: Date) {
  const sorted = [...series].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const past = sorted.filter((s) => Date.parse(s.at) <= now.getTime());
  return past[past.length - 1] ?? sorted[sorted.length - 1];
}

function tickCityPauseMs(): number {
  const n = Number(process.env.TICK_CITY_PAUSE_MS ?? 4000);
  return Number.isFinite(n) ? Math.min(60_000, Math.max(0, Math.floor(n))) : 4000;
}

export async function runTick(opts: TickOptions) {
  const now = opts.now ?? new Date();
  const db = await opts.store.read();
  const mode: DataMode = db.config.dataMode;

  try {
    for (let cityIndex = 0; cityIndex < CITIES.length; cityIndex++) {
      const city = CITIES[cityIndex]!;
      let readings: StationReading[] = [];

      if (mode === "demo") {
        const fixture = await loadFixture(opts.fixturesRoot, city.id);
        if (!fixture) continue;
        db.config.fixtureWeek = fixture.week;
        const existingHourly = new Set(db.hourly.map((h) => `${h.stationId}:${h.observedAt}`));
        for (const s of fixture.stations) {
          // Fixture weeks can be older than wall-clock "now"; use the series tip as reference.
          const seriesTip = [...s.series].sort((a, b) => Date.parse(a.at) - Date.parse(b.at)).at(-1);
          const latest = seriesTip ?? pickLatest(s.series, now);
          if (!latest) continue;
          readings.push({
            id: s.id,
            name: s.name,
            cityId: city.id,
            lat: s.lat,
            lng: s.lng,
            owner: s.owner,
            sourceFeed: s.sourceFeed,
            // Treat fixture tip as fresh so demo stations stay online.
            lastSeen: now.toISOString(),
            pollutants: { pm25: latest.pm25, pm10: latest.pm10 ?? null },
          });
          // Keep the last 48 fixture hours for forecasts (avoid rewriting a full week every tick).
          const tipMs = Date.parse(latest.at);
          const historyCutoff = tipMs - 48 * 3600_000;
          for (const point of s.series) {
            const t = Date.parse(point.at);
            if (!Number.isFinite(t) || t < historyCutoff || t > tipMs) continue;
            const key = `${s.id}:${point.at}`;
            if (existingHourly.has(key)) continue;
            existingHourly.add(key);
            db.hourly.push({
              stationId: s.id,
              cityId: city.id,
              observedAt: point.at,
              pm25: point.pm25,
              aqi: null,
              source: "demo",
            });
          }
        }
      } else {
        const live = await fetchCityStations(city);
        for (const feed of live.feeds) {
          db.ingest.feeds[`${city.id}:${feed.source}`] = { ok: feed.ok, error: feed.error, count: feed.count };
        }
        if (live.readings.length === 0 && live.feeds.every((f) => !f.ok)) {
          db.ingest.lastError = live.feeds.map((f) => `${f.source}: ${f.error}`).join("; ");
          continue;
        }
        readings = live.readings;
      }

      const satellite = await loadSatelliteContext(city, opts.fixturesRoot, mode);
      db.ingest.satelliteStatus = satellite.status;
      for (const cell of satellite.cells) {
        db.satelliteCells[cell.h3] = { ...cell, cityId: city.id };
      }
      db.fires = db.fires.filter((f) => f.cityId !== city.id).concat(satellite.fires);
      if (mode === "live" && (!db.osmPlaces[city.id]?.length || now.getUTCDay() === 1)) {
        try {
          db.osmPlaces[city.id] = await fetchOsmPlaces(city);
        } catch {
          db.osmPlaces[city.id] = db.osmPlaces[city.id] ?? [];
        }
      }

      const merged = mergeStations(readings, city.aqiScale, now);
      for (const s of Object.keys(db.stations)) {
        if (db.stations[s]?.cityId === city.id) delete db.stations[s];
      }
      for (const s of merged) {
        db.stations[s.id] = {
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
        };
      }

      const liveAqis = merged.filter((s) => s.online && s.aqi != null).map((s) => s.aqi!);
      const cityAqi = median(liveAqis);

      const geo = await loadWards(opts.fixturesRoot, city.id);
      const joined = [];
      if (geo) {
        for (const f of geo.features) {
          const ward = joinWardToStation(
            {
              id: f.properties.id,
              name: f.properties.name,
              population: f.properties.population,
              centroid: centroidOf(f),
            },
            merged.map((s) => ({
              id: s.id,
              lat: s.lat,
              lng: s.lng,
              aqi: s.aqi,
              online: s.online,
            })),
            unhealthyThreshold(city.aqiScale),
          );
          joined.push(ward);
          db.wards[`${city.id}_${ward.id}`] = {
            id: ward.id,
            cityId: city.id,
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
        (i) => i.cityId === city.id && (i.status === "open" || i.status === "dispatched" || i.status === "disputed"),
      ).length;

      db.citySummaries[city.id] = {
        cityId: city.id,
        computedAt: now.toISOString(),
        dataMode: mode,
        cityAqi,
        liveStationCount: merged.filter((s) => s.online).length,
        offlineStationCount: merged.filter((s) => !s.online).length,
        peopleInPoor: burden.peopleInPoor,
        coveredPopulation: burden.coveredPopulation,
        uncoveredPopulation: burden.uncoveredPopulation,
        shareInPoor: burden.shareInPoor,
        openIncidentCount,
        equity: burden.equity,
        topWards: burden.topWards,
        bottomWards: burden.bottomWards,
      };
      db.ingest.stationCounts[city.id] = merged.length;

      // Ambient sensor-only promotion per station hex
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
        if (decision.promote && decision.reason) {
          const h3 = latLngToH3({ lat: s.lat, lng: s.lng });
          const dedupeKey = incidentDedupeKey(h3, decision.reason, utcDayKey(now));
          if (!Object.values(db.incidents).some((i) => i.dedupeKey === dedupeKey)) {
            const id = newId();
            const incident: StoredIncident = {
              id,
              cityId: city.id,
              h3,
              status: "open",
              reason: decision.reason,
              openedAt: now.toISOString(),
              reportIds: [],
              stationId: s.id,
              fusion: {
                sensorScore: 80,
                satelliteScore: satelliteAnomaly ? 70 : null,
                visualScore: null,
                corroborationScore: null,
              },
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
            db.incidentEvents.push({
              id: newId(),
              incidentId: id,
              type: "promoted",
              at: now.toISOString(),
              actor: "system",
              h3,
            });
          }
        }
      }

      if (mode === "live" && cityIndex < CITIES.length - 1) {
        const pause = tickCityPauseMs();
        if (pause > 0) await sleep(pause);
      }
    }

    // Exposure diaries
    for (const diary of Object.values(db.diaries)) {
      const stations = Object.values(db.stations).filter((s) => s.cityId === diary.cityId && s.online && s.aqi != null);
      const joined = joinWardToStation(
        { id: diary.uid, name: "diary", population: 1, centroid: { lat: diary.lat, lng: diary.lng } },
        stations.map((s) => ({ id: s.id, lat: s.lat, lng: s.lng, aqi: s.aqi, online: s.online })),
      );
      db.exposure.push({
        uid: diary.uid,
        h3: diary.h3,
        cityId: diary.cityId,
        observedAt: now.toISOString(),
        aqi: joined.covered ? joined.aqi : null,
        band: joined.aqi != null ? bandForScale(joined.aqi, getCity(diary.cityId)?.aqiScale ?? "india") : null,
      });
    }

    // Subscriptions
    for (const sub of Object.values(db.subscriptions)) {
      const stations = Object.values(db.stations).filter((s) => s.cityId === sub.cityId && s.online && s.aqi != null);
      const city = getCity(sub.cityId);
      if (!city) continue;
      const center = h3ToLatLng(sub.h3);
      const joined = joinWardToStation(
        { id: sub.h3, name: sub.h3, population: 1, centroid: center },
        stations.map((s) => ({ id: s.id, lat: s.lat, lng: s.lng, aqi: s.aqi, online: s.online })),
        unhealthyThreshold(city.aqiScale),
      );
      const current = joined.covered ? joined.aqi : null;
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
      const origin = station
        ? { lat: station.lat, lng: station.lng }
        : places[0]
          ? { lat: places[0].lat, lng: places[0].lng }
          : null;
      if (!origin) continue;
      if (!windByCity.has(incident.cityId)) {
        const wind = mode === "demo" ? 180 : await fetchWind(origin.lat, origin.lng).catch(() => 0);
        windByCity.set(incident.cityId, wind);
      }
      incident.upwind = rankUpwind(origin, windByCity.get(incident.cityId) ?? 0, [
        ...places,
        ...db.fires
          .filter((f) => f.cityId === incident.cityId)
          .map((f) => ({
            id: f.id,
            name: "fire",
            kind: "fire" as const,
            lat: f.lat,
            lng: f.lng,
          })),
      ]);
    }

    db.ingest.lastSuccessAt = now.toISOString();
    db.ingest.lastError = null;
    await opts.store.write(db);
    await opts.store.deleteStalePhotos(24 * 3600_000);
    return { ok: true as const, mode };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    db.ingest.lastError = message;
    await opts.store.write(db);
    return { ok: false as const, error: message };
  }
}
