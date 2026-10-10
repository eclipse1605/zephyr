import type { AqiBand, PollutantReadings } from "./types.js";
import { aqiBand, AQI_MAX } from "./indiaAqi.js";

export type Breakpoint = readonly [number, number, number, number];

export const PM25_BREAKPOINTS: Breakpoint[] = [
  [0, 50, 0, 12.0],
  [51, 100, 12.1, 35.4],
  [101, 150, 35.5, 55.4],
  [151, 200, 55.5, 150.4],
  [201, 300, 150.5, 250.4],
  [301, 400, 250.5, 350.4],
  [401, 500, 350.5, 500.4],
];

export const PM10_BREAKPOINTS: Breakpoint[] = [
  [0, 50, 0, 54],
  [51, 100, 55, 154],
  [101, 150, 155, 254],
  [151, 200, 255, 354],
  [201, 300, 355, 424],
  [301, 400, 425, 504],
  [401, 500, 505, 604],
];

export function concentrationToUsAqi(
  concentration: number | null | undefined,
  table: Breakpoint[],
): number | null {
  if (concentration == null || !Number.isFinite(concentration) || concentration < 0) return null;
  const row = table.find(([, , , cHigh]) => concentration <= cHigh);
  if (!row) return AQI_MAX;
  const [aqiLow, aqiHigh, cLow, cHigh] = row;
  const clamped = Math.max(concentration, cLow);
  return Math.round(((clamped - cLow) / (cHigh - cLow)) * (aqiHigh - aqiLow) + aqiLow);
}

export function usAqiToConcentration(aqi: number | undefined, table: Breakpoint[]): number | null {
  if (typeof aqi !== "number" || !Number.isFinite(aqi) || aqi < 0) return null;
  let row = table.find(([, aqiHigh]) => aqi <= aqiHigh);
  row ??= table[table.length - 1];
  const [aqiLow, aqiHigh, cLow, cHigh] = row!;
  const value = aqi <= aqiLow ? cLow : ((aqi - aqiLow) / (aqiHigh - aqiLow)) * (cHigh - cLow) + cLow;
  return Number(value.toFixed(1));
}

export type UsAqi = {
  aqi: number;
  dominant: string;
  band: AqiBand;
  pollutants: string[];
  estimate: true;
};

/** US EPA AQI from PM concentrations (BRICS stations via WAQI). */
export function usAqiFromReadings(readings: PollutantReadings): UsAqi | null {
  const candidates: { name: string; value: number }[] = [];
  const pm25 = concentrationToUsAqi(readings.pm25, PM25_BREAKPOINTS);
  if (pm25 != null) candidates.push({ name: "PM2.5", value: pm25 });
  const pm10 = concentrationToUsAqi(readings.pm10, PM10_BREAKPOINTS);
  if (pm10 != null) candidates.push({ name: "PM10", value: pm10 });
  if (candidates.length === 0) return null;
  const best = candidates.reduce((a, b) => (b.value > a.value ? b : a));
  return {
    aqi: best.value,
    dominant: best.name,
    band: aqiBand(best.value),
    pollutants: candidates.map((c) => c.name),
    estimate: true,
  };
}
