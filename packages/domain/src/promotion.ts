import type { AqiScale, CityStandards, PromotionReason } from "./types.js";
import { unhealthyThreshold } from "./indiaAqi.js";

export type ReportEvidence = {
  countsTowardPromotion: boolean;
  reporterKey: string;
};

export type PromotionInput = {
  reports: ReportEvidence[];
  sensorOverLimit: boolean | null;
  satelliteAnomaly: boolean | null;
  consecutiveSensorOverLimit: number;
  sensorAqi: number | null;
  aqiScale: AqiScale;
  standards: CityStandards;
};

export type PromotionDecision = {
  promote: boolean;
  reason: PromotionReason | null;
};

/**
 * Promotion truth table. A null satellite/sensor is absent evidence, not a zero vote.
 * Flagged reports (countsTowardPromotion=false) never count.
 */
export function decidePromotion(input: PromotionInput): PromotionDecision {
  const counting = input.reports.filter((r) => r.countsTowardPromotion);
  const distinct = new Set(counting.map((r) => r.reporterKey)).size;

  if (distinct >= 3) {
    return { promote: true, reason: "citizens" };
  }
  if (distinct >= 1 && input.sensorOverLimit === true) {
    return { promote: true, reason: "citizen_sensor" };
  }
  if (distinct >= 1 && input.satelliteAnomaly === true) {
    return { promote: true, reason: "citizen_satellite" };
  }
  if (input.sensorOverLimit === true && input.satelliteAnomaly === true) {
    return { promote: true, reason: "sensor_satellite" };
  }

  // Ambient sensor-only path
  const immediate =
    input.sensorAqi != null && input.sensorAqi >= unhealthyThreshold(input.aqiScale);

  if (immediate || input.consecutiveSensorOverLimit >= 2) {
    return { promote: true, reason: "sensor_only" };
  }

  return { promote: false, reason: null };
}

export function nextSensorStreak(previous: number, overLimit: boolean): number {
  if (!overLimit) return 0;
  return Math.max(0, previous) + 1;
}

export function incidentDedupeKey(h3: string, reason: PromotionReason, dayIso: string): string {
  return `${h3}:${reason}:${dayIso}`;
}

export function utcDayKey(date: Date = new Date()): string {
  return date.toISOString().slice(0, 10);
}
