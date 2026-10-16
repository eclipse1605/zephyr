import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, type CitySummary, type Health } from "./api";
import { t } from "./i18n";
import { useLang } from "./lang";
import { AqiDial, aqiTone, formatWhen, Status } from "./uiBits";
import "./home.css";

const BAND_KEY: Record<string, string> = {
  good: "bandGood",
  sat: "bandSatisfactory",
  mod: "bandModerate",
  poor: "bandPoor",
  vp: "bandVeryPoor",
  severe: "bandSevere",
  off: "bandUnknown",
};

const ACTION_KEY: Record<string, string> = {
  good: "actionGood",
  sat: "actionSatisfactory",
  mod: "actionModerate",
  poor: "actionPoor",
  vp: "actionVeryPoor",
  severe: "actionSevere",
};

function ingestError(health: Health | null): string | null {
  const err = health?.ingest?.lastError;
  return typeof err === "string" && err.trim() ? err : null;
}

function sameWardNames(
  top: Array<{ name: string }>,
  bottom: Array<{ name: string }>,
): boolean {
  const left = new Set(top.map((ward) => ward.name));
  const right = new Set(bottom.map((ward) => ward.name));
  if (left.size !== right.size) return false;
  for (const name of left) if (!right.has(name)) return false;
  return true;
}

function WardTable({ title, wards, lang }: { title: string; wards: Array<{ name: string; aqi: number }>; lang: string }) {
  return (
    <div className="card">
      <h3>{title}</h3>
      <table>
        <tbody>
          {wards.map((w) => {
            const tone = aqiTone(w.aqi);
            return (
              <tr key={w.name}>
                <td>{w.name}</td>
                <td className={`tone-${tone}`}>
                  {w.aqi} <span className="ward-band">{t(lang, BAND_KEY[tone] ?? "bandUnknown")}</span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function Home({ cityId, cityName }: { cityId: string; cityName: string }) {
  const lang = useLang();
  const [summary, setSummary] = useState<CitySummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [health, setHealth] = useState<Health | null>(null);

  useEffect(() => {
    setError(null);
    setSummary(null);
    api.summary(cityId).then(setSummary).catch((e: Error) => setError(e.message));
    api.health().then(setHealth).catch(() => setHealth(null));
  }, [cityId]);

  const feed = ingestError(health);
  const mode = summary?.dataMode === "demo" ? "demo" : "live";

  if (error) {
    return (
      <div className="card">
        <p className="error">{error}</p>
        <p className="muted">{t(lang, "summaryHint")}</p>
        {feed ? (
          <p className="error">
            {t(lang, "feedError")}: {feed}
          </p>
        ) : null}
      </div>
    );
  }
  if (!summary) return <Status>{t(lang, "loading")}</Status>;

  const share = summary.shareInPoor == null ? "—" : `${Math.round(summary.shareInPoor * 100)}%`;
  const ratio = summary.equity?.ratio == null ? "—" : summary.equity.ratio.toFixed(2);
  const tone = aqiTone(summary.cityAqi);
  const band = t(lang, BAND_KEY[tone] ?? "bandUnknown");
  const numericAqi = summary.cityAqi != null && !Number.isNaN(summary.cityAqi);
  const action = numericAqi ? ACTION_KEY[tone] : undefined;
  const monitored = new Set([...summary.topWards, ...summary.bottomWards].map((ward) => ward.name)).size;
  const oneList = sameWardNames(summary.topWards, summary.bottomWards);
  const monitoredRows = [...summary.topWards]
    .sort((a, b) => b.aqi - a.aqi)
    .filter((ward, index, rows) => rows.findIndex((item) => item.name === ward.name) === index);

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <p className="eyebrow">{cityName || t(lang, "home")}</p>
          <h1 className={numericAqi ? `tone-${tone}` : undefined}>{band}</h1>
          {action ? <p className="aqi-action">{t(lang, action)}</p> : null}
        </div>
        <div className="row">
          <span className={`badge ${mode}`}>{t(lang, mode)}</span>
          <span className="muted">
            {t(lang, "lastIngest")}: {formatWhen(summary.computedAt, lang)}
          </span>
          {feed ? <span className="badge bad">{t(lang, "feedError")}: {feed}</span> : null}
        </div>
      </div>
      <div className="bento">
        <div className="card card-feature">
          <AqiDial aqi={summary.cityAqi} caption={t(lang, "medianNote", { n: summary.liveStationCount })} />
        </div>
        <div className="card">
          <h2>{t(lang, "people")}</h2>
          <div className="big">{Number(summary.peopleInPoor).toLocaleString(lang)}</div>
          <p className="muted">
            {t(lang, "shareOf", { share })} · {t(lang, "uncovered", { n: Number(summary.uncoveredPopulation).toLocaleString(lang) })}
          </p>
        </div>
        {monitored >= 8 ? (
          <div className="card">
            <h2>{t(lang, "equity")}</h2>
            <p className="big">{ratio}</p>
            <p className="muted">
              {t(lang, "equityRatioShown", { n: monitored })} · {t(lang, "equityNote")}
            </p>
          </div>
        ) : null}
        <div className="card">
          <h2>{t(lang, "hotspots")}</h2>
          <div className="big">
            <span>{summary.openIncidentCount}</span>
          </div>
          <p>
            <Link to="/map">{t(lang, "openMap")}</Link>
          </p>
        </div>
      </div>
      <div className="grid">
        {oneList ? (
          <WardTable title={t(lang, "monitoredWards")} wards={monitoredRows} lang={lang} />
        ) : (
          <>
            <WardTable title={t(lang, "highestWards")} wards={summary.topWards} lang={lang} />
            <WardTable title={t(lang, "lowestWards")} wards={summary.bottomWards} lang={lang} />
          </>
        )}
      </div>
    </div>
  );
}
