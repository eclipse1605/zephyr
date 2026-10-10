export type IncidentEventType =
  | "promoted"
  | "reopened"
  | "dispatched"
  | "resolved"
  | "fix_confirmed"
  | "disputed";

export type IncidentEvent = {
  type: IncidentEventType;
  at: string;
  h3: string;
};

const WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
const RETURN_MS = 7 * 24 * 60 * 60 * 1000;

/** Repeat hotspot: 3+ confirmed episodes in 30 days, or a fix that did not hold. */
export function isRepeatHotspot(events: IncidentEvent[], now: Date = new Date()): boolean {
  const since = now.getTime() - WINDOW_MS;
  const recent = events.filter((e) => Date.parse(e.at) >= since);
  const promotions = recent.filter((e) => e.type === "promoted" || e.type === "reopened");
  if (promotions.length >= 3) return true;

  const disputed = recent.some((e) => e.type === "disputed");
  if (disputed) return true;

  const confirmed = recent
    .filter((e) => e.type === "fix_confirmed")
    .map((e) => Date.parse(e.at))
    .sort((a, b) => a - b);
  const reopened = recent
    .filter((e) => e.type === "reopened" || e.type === "promoted")
    .map((e) => Date.parse(e.at));

  for (const c of confirmed) {
    if (reopened.some((r) => r > c && r - c <= RETURN_MS)) return true;
  }
  return false;
}
