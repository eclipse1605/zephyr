export type HourlyPm25 = { observedAt: string; pm25: number };

export type ForecastPoint = { at: string; pm25: number };

export type PersistenceForecast =
  | { method: "persistence"; stationId: string; hours: ForecastPoint[] }
  | { method: "persistence"; stationId: string; hours: []; error: "insufficient_history" };

const MIN_HOURS = 12;

/** Persistence forecast: each future hour copies the value from 24h earlier. */
export function persistenceForecast(
  stationId: string,
  history: HourlyPm25[],
  from: Date = new Date(),
  horizonHours = 24,
): PersistenceForecast {
  if (history.length < MIN_HOURS) {
    return { method: "persistence", stationId, hours: [], error: "insufficient_history" };
  }

  const byHour = new Map<string, number>();
  for (const h of history) {
    byHour.set(h.observedAt.slice(0, 13), h.pm25); // YYYY-MM-DDTHH
  }
  const last = history[history.length - 1]!.pm25;
  const hours: ForecastPoint[] = [];
  for (let i = 1; i <= horizonHours; i++) {
    const at = new Date(from.getTime() + i * 3600_000);
    const lookback = new Date(at.getTime() - 24 * 3600_000);
    const key = lookback.toISOString().slice(0, 13);
    const pm25 = byHour.get(key) ?? last;
    hours.push({ at: at.toISOString(), pm25 });
  }
  return { method: "persistence", stationId, hours };
}

export type ModelledLabel = { method: "modelled"; stationId: string; hours: ForecastPoint[] };

export function modelledForecast(
  stationId: string,
  history: HourlyPm25[],
  from: Date = new Date(),
  horizonHours = 24,
): ModelledLabel {
  const last = history.length > 0 ? history[history.length - 1]!.pm25 : null;
  const hours: ForecastPoint[] = [];
  for (let i = 1; i <= horizonHours; i++) {
    const at = new Date(from.getTime() + i * 3600_000);
    hours.push({ at: at.toISOString(), pm25: last ?? 0 });
  }
  return { method: "modelled", stationId, hours };
}
