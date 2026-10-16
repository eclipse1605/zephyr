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
  [0, 50, "#009966"],
  [50, 100, "#8fbf1f"],
  [100, 200, "#e0b000"],
  [200, 300, "#e07a1f"],
  [300, 400, "#d64532"],
  [400, 500, "#7a1f1f"],
];

function dialPoint(value: number, radius: number) {
  const angle = Math.PI * (1 - Math.min(Math.max(value, 0), 500) / 500);
  return { x: 100 + radius * Math.cos(angle), y: 108 - radius * Math.sin(angle) };
}

function dialArc(from: number, to: number): string {
  const start = dialPoint(from, 72);
  const end = dialPoint(to, 72);
  return `M ${start.x.toFixed(2)} ${start.y.toFixed(2)} A 72 72 0 0 1 ${end.x.toFixed(2)} ${end.y.toFixed(2)}`;
}

export function AqiDial({ aqi, caption }: { aqi: number | null; caption: string }) {
  const shown = aqi == null ? null : Math.round(aqi);
  return (
    <figure className="dial">
      <div className="dial-meter" role="meter" aria-valuemin={0} aria-valuemax={500} aria-valuenow={shown ?? undefined} aria-valuetext={shown == null ? caption : `${shown}. ${caption}`}>
        <svg viewBox="0 0 200 118" aria-hidden="true">
          {DIAL_BANDS.map(([from, to, color]) => (
            <path key={from} d={dialArc(from + (from === 0 ? 0 : 1), to - (to === 500 ? 0 : 1))} stroke={color} strokeWidth="14" fill="none" strokeLinecap="butt" opacity={1} />
          ))}
          {shown != null ? (
            <g className="dial-needle" transform={`rotate(${(Math.min(shown, 500) / 500) * 180} 100 108)`}>
              <line x1="100" y1="108" x2="36" y2="108" stroke="#101a15" strokeWidth="3" strokeLinecap="round" />
            </g>
          ) : null}
          <circle cx="100" cy="108" r="5" className="dial-pivot" />
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

export function Status({ children }: { children: ReactNode }) {
  return (
    <p className="status" role="status">
      {children}
    </p>
  );
}
