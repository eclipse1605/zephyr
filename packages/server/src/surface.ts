import {
  getCity,
  h3ToLatLng,
  haversineKm,
  latLngToH3,
  median,
  publishSurface,
} from "@zephyr/domain";
import type { FileStore } from "./store.js";

type Db = Awaited<ReturnType<FileStore["read"]>>;
const REPORT_WINDOW_MS = 6 * 60 * 60 * 1000;
const STATION_KM = 15;

export function refreshCitySurface(db: Db, cityId: string, now: Date) {
  const city = getCity(cityId);
  if (!city) return;
  for (const key of Object.keys(db.surfaceCells)) {
    if (db.surfaceCells[key]?.cityId === cityId) delete db.surfaceCells[key];
  }
  const stations = Object.values(db.stations).filter((station) => station.cityId === cityId && station.online && station.aqi != null);
  const reports = Object.values(db.reports).filter(
    (report) => report.cityId === cityId && report.countsTowardPromotion && now.getTime() - Date.parse(report.createdAt) <= REPORT_WINDOW_MS,
  );
  const cells = new Set<string>();
  for (const station of stations) cells.add(latLngToH3({ lat: station.lat, lng: station.lng }));
  for (const report of reports) cells.add(report.h3);

  for (const h3 of cells) {
    let center: { lat: number; lng: number };
    try {
      center = h3ToLatLng(h3);
    } catch {
      continue;
    }
    let stationAqi: number | null = null;
    let nearest = Infinity;
    for (const station of stations) {
      const km = haversineKm(center, { lat: station.lat, lng: station.lng });
      if (km <= STATION_KM && km < nearest && station.aqi != null) {
        nearest = km;
        stationAqi = station.aqi;
      }
    }
    const reporters = new Set(reports.filter((report) => report.h3 === h3).map((report) => report.reporterKey));
    const reading = publishSurface({
      stationAqi,
      modelAqi: null,
      reportCount: reporters.size,
      scale: city.aqiScale,
    });
    if (!reading.visible || reading.publishedAqi == null) continue;
    db.surfaceCells[h3] = {
      h3,
      cityId,
      stationAqi: reading.stationAqi,
      modelAqi: reading.modelAqi,
      reportCount: reading.reportCount,
      publishedAqi: reading.publishedAqi,
      basis: reading.basis,
      computedAt: now.toISOString(),
    };
  }
}

export function publishedCityAqi(db: Db, cityId: string, stationMedian: number | null): number | null {
  const values = Object.values(db.surfaceCells)
    .filter((cell) => cell.cityId === cityId && cell.publishedAqi != null)
    .map((cell) => cell.publishedAqi as number);
  return median(values) ?? stationMedian;
}
