import { POOR_THRESHOLD } from "./indiaAqi.js";

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
  now?: Date;
}): AlertDecision {
  if (args.currentAqi == null) return { notify: false, reason: "missing_aqi" };
  const now = args.now ?? new Date();
  if (args.currentAqi < POOR_THRESHOLD) return { notify: false, reason: "below_threshold" };

  const wasBelow = args.previousAqi == null || args.previousAqi < POOR_THRESHOLD;
  if (!wasBelow) return { notify: false, reason: "flat_poor" };

  if (args.lastNotifiedAt) {
    const last = Date.parse(args.lastNotifiedAt);
    if (Number.isFinite(last) && now.getTime() - last < ALERT_DEBOUNCE_MS) {
      return { notify: false, reason: "debounced" };
    }
  }
  return { notify: true, reason: "upward_cross" };
}
