import type { AqiBand, PollutantReadings } from "./types.js";

type Band = readonly [cLow: number, cHigh: number, iLow: number, iHigh: number];

const BANDS = {
  pm25: [
    [0, 30, 0, 50],
    [30, 60, 50, 100],
    [60, 90, 100, 200],
    [90, 120, 200, 300],
    [120, 250, 300, 400],
    [250, 380, 400, 500],
  ],
  pm10: [
    [0, 50, 0, 50],
    [50, 100, 50, 100],
    [100, 250, 100, 200],
    [250, 350, 200, 300],
    [350, 430, 300, 400],
    [430, 510, 400, 500],
  ],
  no2: [
    [0, 40, 0, 50],
    [40, 80, 50, 100],
    [80, 180, 100, 200],
    [180, 280, 200, 300],
    [280, 400, 300, 400],
    [400, 800, 400, 500],
  ],
  so2: [
    [0, 40, 0, 50],
    [40, 80, 50, 100],
    [80, 380, 100, 200],
    [380, 800, 200, 300],
    [800, 1600, 300, 400],
    [1600, 2400, 400, 500],
  ],
  co: [
    [0, 1, 0, 50],
    [1, 2, 50, 100],
    [2, 10, 100, 200],
    [10, 17, 200, 300],
    [17, 34, 300, 400],
    [34, 50, 400, 500],
  ],
  ozone: [
    [0, 50, 0, 50],
    [50, 100, 50, 100],
    [100, 168, 100, 200],
    [168, 208, 200, 300],
    [208, 748, 300, 400],
    [748, 1000, 400, 500],
  ],
  nh3: [
    [0, 200, 0, 50],
    [200, 400, 50, 100],
    [400, 800, 100, 200],
    [800, 1200, 200, 300],
    [1200, 1800, 300, 400],
    [1800, 2400, 400, 500],
  ],
} satisfies Record<string, readonly Band[]>;

export type AqiPollutant = keyof typeof BANDS;

export const POLLUTANT_LABELS: Record<AqiPollutant, string> = {
  pm25: "PM2.5",
  pm10: "PM10",
  no2: "NO₂",
  so2: "SO₂",
  co: "CO",
  ozone: "O₃",
  nh3: "NH₃",
};

export const AQI_MAX = 500;
export const POOR_THRESHOLD = 201;
/** US EPA "Unhealthy" starts here. India's Poor band starts at 201. */
export const US_UNHEALTHY_THRESHOLD = 151;

export function unhealthyThreshold(scale: "india" | "us"): number {
  return scale === "us" ? US_UNHEALTHY_THRESHOLD : POOR_THRESHOLD;
}

/** Map a US AQI onto the advisory bands. Names stay the India set the UI already prints. */
export function bandForScale(aqi: number, scale: "india" | "us"): AqiBand {
  if (scale === "india") return aqiBand(aqi);
  if (aqi <= 50) return "Good";
  if (aqi <= 100) return "Satisfactory";
  if (aqi <= 150) return "Moderate";
  if (aqi <= 200) return "Poor";
  if (aqi <= 300) return "Very Poor";
  return "Severe";
}

export function aqiBand(aqi: number): AqiBand {
  if (aqi <= 50) return "Good";
  if (aqi <= 100) return "Satisfactory";
  if (aqi <= 200) return "Moderate";
  if (aqi <= 300) return "Poor";
  if (aqi <= 400) return "Very Poor";
  return "Severe";
}

function subIndex(concentration: number | null | undefined, bands: readonly Band[]): number | null {
  if (concentration == null || !Number.isFinite(concentration) || concentration < 0) return null;
  for (const [cLow, cHigh, iLow, iHigh] of bands) {
    if (concentration <= cHigh) {
      return Math.round(iLow + ((concentration - cLow) * (iHigh - iLow)) / (cHigh - cLow));
    }
  }
  return AQI_MAX;
}

export type IndiaAqi = {
  aqi: number;
  dominant: string;
  band: AqiBand;
  pollutants: string[];
  estimate: true;
};

export function indiaAqiFromReadings(readings: PollutantReadings): IndiaAqi | null {
  let best: { pollutant: AqiPollutant; value: number } | null = null;
  const used: string[] = [];
  for (const pollutant of Object.keys(BANDS) as AqiPollutant[]) {
    const value = subIndex(readings[pollutant], BANDS[pollutant]);
    if (value === null) continue;
    used.push(POLLUTANT_LABELS[pollutant]);
    if (!best || value > best.value) best = { pollutant, value };
  }
  if (!best) return null;
  return {
    aqi: best.value,
    dominant: POLLUTANT_LABELS[best.pollutant],
    band: aqiBand(best.value),
    pollutants: used,
    estimate: true,
  };
}
