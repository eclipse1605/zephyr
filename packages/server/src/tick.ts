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
  aqiBand,
  latLngToH3,
  type StationReading,
  type DataMode,
} from "@zephyr/domain";
import { FileStore, newId, type StoredIncident } from "./store.js";

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

export async function runTick(opts: TickOptions) {
  const now = opts.now ?? new Date();
  const db = await opts.store.read();
  const mode: DataMode = db.config.dataMode;

  try {
    for (const city of CITIES) {
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
        // Live path: OpenAQ when key present; otherwise leave previous summary.
        const key = process.env.OPENAQ_API_KEY;
        if (!key) {
          throw new Error("OPENAQ_API_KEY not configured for live mode");
        }
        readings = await fetchOpenAq(city.id, city.center.lat, city.center.lng, key);
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
        const over = stationOverLimit(s.pollutants, city.standards);
        const decision = decidePromotion({
          reports: [],
          sensorOverLimit: over,
          satelliteAnomaly: null,
          consecutiveSensorOverLimit: over ? 2 : 0,
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
              fusion: { sensorScore: 80, satelliteScore: null, visualScore: null, corroborationScore: null },
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
        band: joined.aqi != null ? aqiBand(joined.aqi) : null,
      });
    }

    // Subscriptions
    for (const sub of Object.values(db.subscriptions)) {
      const stations = Object.values(db.stations).filter((s) => s.cityId === sub.cityId && s.online && s.aqi != null);
      const city = getCity(sub.cityId);
      if (!city) continue;
      // Approximate hex AQI from nearest station to hex center — use first live station for demo simplicity
      // Prefer joining via diary-like centroid from previousHexAqi key
      const live = stations[0];
      const current = live?.aqi ?? null;
      const previous = db.previousHexAqi[sub.h3] ?? null;
      const decision = shouldNotifyAlert({
        previousAqi: previous,
        currentAqi: current,
        lastNotifiedAt: sub.lastNotifiedAt,
        now,
      });
      if (current != null) db.previousHexAqi[sub.h3] = current;
      if (decision.notify && current != null) {
        db.notifications.push({
          id: newId(),
          uid: sub.uid,
          h3: sub.h3,
          aqi: current,
          channel: sub.channels[0] ?? "in_app",
          createdAt: now.toISOString(),
          read: false,
        });
        sub.lastNotifiedAt = now.toISOString();
      }
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

async function fetchOpenAq(
  cityId: string,
  lat: number,
  lng: number,
  apiKey: string,
): Promise<StationReading[]> {
  const url = new URL("https://api.openaq.org/v3/locations");
  url.searchParams.set("coordinates", `${lat},${lng}`);
  url.searchParams.set("radius", "25000");
  url.searchParams.set("limit", "100");
  const res = await fetch(url, { headers: { "X-API-Key": apiKey }, signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`OpenAQ ${res.status}`);
  const body = (await res.json()) as {
    results?: Array<{
      id: number;
      name: string;
      coordinates?: { latitude: number; longitude: number };
      datetimeLast?: { utc?: string };
      sensors?: Array<{ parameter?: { name?: string }; latest?: { value?: number } }>;
    }>;
  };
  const out: StationReading[] = [];
  for (const loc of body.results ?? []) {
    if (!loc.coordinates) continue;
    const pollutants: StationReading["pollutants"] = {};
    for (const sensor of loc.sensors ?? []) {
      const name = sensor.parameter?.name?.toLowerCase();
      const value = sensor.latest?.value;
      if (value == null) continue;
      if (name === "pm25" || name === "pm2.5") pollutants.pm25 = value;
      if (name === "pm10") pollutants.pm10 = value;
      if (name === "no2") pollutants.no2 = value;
      if (name === "so2") pollutants.so2 = value;
      if (name === "co") pollutants.co = value;
      if (name === "o3" || name === "ozone") pollutants.ozone = value;
    }
    out.push({
      id: `openaq-${loc.id}`,
      name: loc.name,
      cityId,
      lat: loc.coordinates.latitude,
      lng: loc.coordinates.longitude,
      sourceFeed: "openaq",
      lastSeen: loc.datetimeLast?.utc ?? new Date().toISOString(),
      pollutants,
    });
  }
  return out;
}
