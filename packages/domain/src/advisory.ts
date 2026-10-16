import type { AqiBand, AqiScale } from "./types.js";
import { bandForScale } from "./indiaAqi.js";

export type VulnerableGroup =
  | "children"
  | "elderly"
  | "asthma_heart"
  | "outdoor_workers"
  | "everyone_else";

const ADVISORY: Record<AqiBand, Record<VulnerableGroup, string>> = {
  Good: {
    children: "Normal outdoor activity is fine.",
    elderly: "Normal outdoor activity is fine.",
    asthma_heart: "Normal outdoor activity is fine; keep medication nearby.",
    outdoor_workers: "Normal outdoor work is fine.",
    everyone_else: "Air quality is satisfactory for most people.",
  },
  Satisfactory: {
    children: "Sensitive children may prefer shorter outdoor play.",
    elderly: "Sensitive elders may prefer shorter outdoor time.",
    asthma_heart: "Limit prolonged outdoor exertion if symptoms appear.",
    outdoor_workers: "Take short breaks during heavy exertion.",
    everyone_else: "Acceptable air for most people.",
  },
  Moderate: {
    children: "Reduce prolonged outdoor play, especially for sensitive children.",
    elderly: "Reduce prolonged outdoor activity.",
    asthma_heart: "Avoid heavy outdoor exertion; watch for symptoms.",
    outdoor_workers: "Schedule heavy tasks for cleaner hours if possible.",
    everyone_else: "Sensitive people should reduce prolonged outdoor exertion.",
  },
  Poor: {
    children: "Avoid outdoor play; stay indoors with cleaner air if available.",
    elderly: "Avoid outdoor activity; stay indoors.",
    asthma_heart: "Stay indoors; use prescribed medication if needed.",
    outdoor_workers: "Limit outdoor work; use a suitable mask if work continues.",
    everyone_else: "Reduce outdoor activity; sensitive groups should stay indoors.",
  },
  "Very Poor": {
    children: "Stay indoors. Avoid outdoor school sports.",
    elderly: "Stay indoors. Avoid outdoor errands.",
    asthma_heart: "Stay indoors. Seek care if breathing worsens.",
    outdoor_workers: "Postpone non-essential outdoor work; use protection if essential.",
    everyone_else: "Avoid outdoor activity. Keep windows closed when outdoor air is worse.",
  },
  Severe: {
    children: "Remain indoors. Emergency care if breathing is difficult.",
    elderly: "Remain indoors. Emergency care if breathing is difficult.",
    asthma_heart: "Remain indoors. Seek emergency care if symptoms worsen.",
    outdoor_workers: "Stop outdoor work unless life-critical and protected.",
    everyone_else: "Remain indoors. Avoid all outdoor exertion.",
  },
};

export type GroupAdvisory = {
  band: AqiBand;
  aqi: number;
  attribution: string;
  groups: Record<VulnerableGroup, string>;
};

export function groupAdvisoryForAqi(aqi: number, scale: AqiScale = "india"): GroupAdvisory {
  const band = bandForScale(aqi, scale);
  return {
    band,
    aqi,
    attribution:
      scale === "us"
        ? "US EPA AQI bands mapped onto the same health actions."
        : "Paraphrase of CPCB National AQI health statements for each band.",
    groups: ADVISORY[band],
  };
}
