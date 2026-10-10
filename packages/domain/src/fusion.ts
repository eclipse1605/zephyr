export type FusionSources = {
  visualScore: number | null;
  sensorScore: number | null;
  satelliteScore: number | null;
  corroborationScore: number | null;
};

export type FusionResult = {
  finalConfidence: number;
  visualWeight: number;
  sensorWeight: number;
  satelliteWeight: number;
  corroborationWeight: number;
};

const BASE_WEIGHT = {
  visual: 0.45,
  sensor: 0.2,
  satellite: 0.2,
  corroboration: 0.15,
} as const;

/** Weighted fusion; missing sources are excluded and weights renormalized. */
export function computeFusionConfidence(sources: FusionSources): FusionResult {
  const present: Array<{ key: keyof typeof BASE_WEIGHT; score: number }> = [];
  if (sources.visualScore !== null) present.push({ key: "visual", score: sources.visualScore });
  if (sources.sensorScore !== null) present.push({ key: "sensor", score: sources.sensorScore });
  if (sources.satelliteScore !== null) present.push({ key: "satellite", score: sources.satelliteScore });
  if (sources.corroborationScore !== null) {
    present.push({ key: "corroboration", score: sources.corroborationScore });
  }

  const weights = { visual: 0, sensor: 0, satellite: 0, corroboration: 0 };
  if (present.length === 0) {
    return { finalConfidence: 0, visualWeight: 0, sensorWeight: 0, satelliteWeight: 0, corroborationWeight: 0 };
  }

  const totalBaseWeight = present.reduce((sum, p) => sum + BASE_WEIGHT[p.key], 0);
  let weightedSum = 0;
  for (const p of present) {
    const normalized = BASE_WEIGHT[p.key] / totalBaseWeight;
    weights[p.key] = normalized;
    weightedSum += p.score * normalized;
  }

  return {
    finalConfidence: Math.round(Math.min(99, Math.max(0, weightedSum))),
    visualWeight: weights.visual,
    sensorWeight: weights.sensor,
    satelliteWeight: weights.satellite,
    corroborationWeight: weights.corroboration,
  };
}

/** Distinct reporters → 0–100 corroboration score, capped at 3. */
export function corroborationScore(distinctReporters: number): number {
  if (distinctReporters <= 0) return 0;
  return Math.min(100, Math.round((Math.min(distinctReporters, 3) / 3) * 100));
}

/** Sensor score from % above the city's 24h reference limit. */
export function sensorScoreFromExceedance(pctAboveLimit: number): number {
  if (pctAboveLimit <= 0) return 0;
  return Math.min(100, Math.round(40 + pctAboveLimit * 0.6));
}
