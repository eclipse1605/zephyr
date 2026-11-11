import type { ReactNode } from "react";

export function aqiTone(aqi: number | null | undefined): string {
  if (aqi == null || Number.isNaN(aqi)) return "off";
  if (aqi <= 50) return "good";
  if (aqi <= 100) return "sat";
  if (aqi <= 200) return "mod";
  if (aqi <= 300) return "poor";
  if (aqi <= 400) return "vp";
  return "severe";
}

const DIAL_BANDS: Array<[number, number, string]> = [
  [0, 50, "var(--fill-good)"],
  [50, 100, "var(--fill-sat)"],
  [100, 200, "var(--fill-mod)"],
  [200, 300, "var(--fill-poor)"],
  [300, 400, "var(--fill-vp)"],
  [400, 500, "var(--fill-severe)"],
];

export function AqiDial({ aqi, caption }: { aqi: number | null; caption: string }) {
  const shown = aqi == null ? null : Math.round(aqi);
  const marker = shown == null ? null : (Math.min(shown, 500) / 500) * 500;
  return (
    <figure className="dial">
      <div className="dial-meter" role="meter" aria-label={caption} aria-valuemin={0} aria-valuemax={500} aria-valuenow={shown ?? undefined} aria-valuetext={shown == null ? caption : `${shown}. ${caption}`}>
        <svg viewBox="0 0 500 28" aria-hidden="true">
          <defs>
            <clipPath id="aqi-band-clip">
              <rect x="0" y="8" width="500" height="12" rx="6" />
            </clipPath>
          </defs>
          <g clipPath="url(#aqi-band-clip)">
            {DIAL_BANDS.map(([from, to, color]) => (
              <rect key={from} x={from} y="8" width={to - from} height="12" fill={color} />
            ))}
          </g>
          {marker != null ? <line className="dial-needle" x1={marker} y1="2" x2={marker} y2="26" strokeLinecap="round" /> : null}
        </svg>
      </div>
      <figcaption>
        <strong className={shown == null ? "" : `tone-${aqiTone(shown)}`}>{shown ?? "—"}</strong>
        <span>{caption}</span>
      </figcaption>
    </figure>
  );
}

export function formatWhen(iso: string | null | undefined, lang: string): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat(lang, { dateStyle: "medium", timeStyle: "short" }).format(date);
}

export function PageHead({ kicker, title, children }: { kicker: string; title: string; children?: ReactNode }) {
  return (
    <div className="page-head">
      <div>
        <p className="eyebrow">{kicker}</p>
        <h1>{title}</h1>
      </div>
      {children}
    </div>
  );
}

export function SkeletonBlock({ className }: { className?: string }) {
  return <span className={`skeleton${className ? ` ${className}` : ""}`} aria-hidden="true" />;
}

export function HomeSkeleton() {
  return (
    <div className="stack" aria-busy="true">
      <SkeletonBlock className="skeleton-title" />
      <SkeletonBlock className="skeleton-hero" />
      <div className="stat-strip">
        <SkeletonBlock className="skeleton-card" />
        <SkeletonBlock className="skeleton-card" />
      </div>
      <SkeletonBlock className="skeleton-board" />
    </div>
  );
}

export function PanelSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="skeleton-stack" aria-busy="true">
      {Array.from({ length: rows }, (_, index) => (
        <SkeletonBlock key={index} className={index === 0 ? "skeleton-line is-wide" : "skeleton-line"} />
      ))}
    </div>
  );
}

export function Status({ children }: { children: ReactNode }) {
  return (
    <p className="status" role="status">
      {children}
    </p>
  );
}
