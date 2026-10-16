import { unhealthyThreshold } from "./indiaAqi.js";

export const ALERT_DEBOUNCE_MS = 6 * 60 * 60 * 1000;

export type AlertDecision = {
  notify: boolean;
  reason: "upward_cross" | "flat_poor" | "below_threshold" | "debounced" | "missing_aqi";
};

/** Notify only on an upward cross into Poor, with a 6h debounce. */
export function shouldNotifyAlert(args: {
  previousAqi: number | null;
  currentAqi: number | null;
  lastNotifiedAt: string | null;
  /** AQI at which the alert band starts. India Poor is 201. US Unhealthy is 151. */
  threshold?: number;
  now?: Date;
}): AlertDecision {
  const threshold = args.threshold ?? unhealthyThreshold("india");
  if (args.currentAqi == null) return { notify: false, reason: "missing_aqi" };
  const now = args.now ?? new Date();
  if (args.currentAqi < threshold) return { notify: false, reason: "below_threshold" };

  const wasBelow = args.previousAqi == null || args.previousAqi < threshold;
  if (!wasBelow) return { notify: false, reason: "flat_poor" };

  if (args.lastNotifiedAt) {
    const last = Date.parse(args.lastNotifiedAt);
    if (Number.isFinite(last) && now.getTime() - last < ALERT_DEBOUNCE_MS) {
      return { notify: false, reason: "debounced" };
    }
  }
  return { notify: true, reason: "upward_cross" };
}

export type ExposurePoint = { observedAt: string; aqi: number | null; band: string | null };

/** A gap is a missing tick: more than 45 minutes between snapshots. */
export function exposureGaps(points: ExposurePoint[], stepMs = 30 * 60 * 1000): Array<{ after: string; before: string }> {
  const sorted = [...points].sort((a, b) => Date.parse(a.observedAt) - Date.parse(b.observedAt));
  const gaps: Array<{ after: string; before: string }> = [];
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1]!;
    const cur = sorted[i]!;
    if (Date.parse(cur.observedAt) - Date.parse(prev.observedAt) > stepMs * 1.5) {
      gaps.push({ after: prev.observedAt, before: cur.observedAt });
    }
  }
  return gaps;
}
