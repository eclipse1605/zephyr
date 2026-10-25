import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import maplibregl from "maplibre-gl";
import {
  api,
  type Auth,
  type City,
  type DiaryView,
  type ForecastBlock,
  type ForecastView,
  type Health,
  type OperatorIncident,
  type ReportView,
  type UpwindSource,
  type ZoneView,
} from "./api";
import { t } from "./i18n";
import { useLang } from "./lang";
import { formatWhen, PageHead, Status } from "./uiBits";
import "./flows.css";

const MAP_STYLE = "https://tiles.openfreemap.org/styles/liberty";
const HAZARDS = ["smoke", "dust", "haze", "fire", "trash_fire", "construction", "other"] as const;
const HAZARD_KEY: Record<(typeof HAZARDS)[number], string> = {
  smoke: "smoke",
  dust: "dust",
  haze: "haze",
  fire: "fireHazard",
  trash_fire: "trashFire",
  construction: "construction",
  other: "other",
};
const GROUP_KEY: Record<string, string> = {
  children: "groupChildren",
  elderly: "groupElderly",
  asthma_heart: "groupAsthmaHeart",
  outdoor_workers: "groupOutdoorWorkers",
  everyone_else: "groupEveryoneElse",
};

function groupLabel(lang: string, key: string): string {
  const mapped = GROUP_KEY[key];
  return mapped ? t(lang, mapped) : key;
}

function sampleHour(at: string, lang: string): string {
  const date = new Date(at);
  if (Number.isNaN(date.getTime())) return at;
  return new Intl.DateTimeFormat(lang, { hour: "numeric", minute: "2-digit" }).format(date);
}

function satelliteAbsent(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const body = value as Record<string, unknown>;
  if (body.satelliteMissing === true || body.satelliteAvailable === false) return true;
  if ("satellite" in body && body.satellite == null) return true;
  const nested = body.satellite;
  const nestedStatus =
    nested && typeof nested === "object" ? (nested as { status?: unknown; missing?: unknown }).status : undefined;
  const nestedMissing = nested && typeof nested === "object" ? (nested as { missing?: unknown }).missing : undefined;
  if (nestedMissing === true) return true;
  const status = [body.satelliteStatus, nestedStatus].find((item) => typeof item === "string") as string | undefined;
  return Boolean(status && /missing|not_configured|absent|unavailable|empty|none/i.test(status));
}

function voiceFor(lang: string): SpeechSynthesisVoice | null {
  const synth = window.speechSynthesis;
  if (!synth?.getVoices) return null;
  const prefix = lang.toLowerCase();
  return synth.getVoices().find((voice) => voice.lang.toLowerCase().startsWith(prefix)) ?? null;
}

function useSpeechReady(lang: string): boolean {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const synth = window.speechSynthesis;
    if (!synth?.getVoices) {
      setReady(false);
      return;
    }
    const check = () => setReady(Boolean(voiceFor(lang)));
    check();
    synth.addEventListener("voiceschanged", check);
    return () => synth.removeEventListener("voiceschanged", check);
  }, [lang]);
  return ready;
}

function upwindLabel(item: UpwindSource): string {
  const name = item.name ?? item.id ?? item.kind ?? "source";
  const kind = item.kind ? ` (${item.kind})` : "";
  const distance = item.distanceKm != null ? ` · ${item.distanceKm} km` : "";
  return `${name}${kind}${distance}`;
}

function forecastSamples(hours: Array<{ at: string; pm25: number }> | undefined) {
  if (!hours?.length) return null;
  const finite = hours
    .map((hour, index) => ({ hour, index }))
    .filter((item) => Number.isFinite(item.hour.pm25));
  if (!finite.length) return null;
  const seen = new Set<number>();
  const points: Array<{ at: string; pm25: number }> = [];
  for (const target of [0, 6, 12, hours.length - 1]) {
    let best = finite[0];
    for (const item of finite) {
      if (Math.abs(item.index - target) < Math.abs(best.index - target)) best = item;
    }
    if (seen.has(best.index)) continue;
    seen.add(best.index);
    points.push(best.hour);
  }
  const values = finite.map((item) => item.hour.pm25);
  return {
    low: Math.round(Math.min(...values)),
    high: Math.round(Math.max(...values)),
    points,
  };
}

function MethodChip({ lang, name, block }: { lang: string; name: string; block?: ForecastBlock | null }) {
  const samples = block?.error ? null : forecastSamples(block?.hours);
  let detail = t(lang, "unavailable");
  if (block?.error) detail = t(lang, "insufficient");
  else if (samples) detail = t(lang, "forecastRange", { low: samples.low, high: samples.high });
  else if (block?.hours?.length) detail = t(lang, "hours", { n: block.hours.length });
  return (
    <div className="method">
      <strong>{name}</strong>
      <span className="muted">{detail}</span>
      {samples ? (
        <small className="muted">
          {samples.points.map((point, index) => (
            <span key={`${point.at}-${index}`}>
              {t(lang, "forecastSample", { hour: sampleHour(point.at, lang), value: Math.round(point.pm25) })}
            </span>
          ))}
        </small>
      ) : null}
    </div>
  );
}

export function ReportPage({ cityId, cities, auth }: { cityId: string; cities: City[]; auth: Auth | null }) {
  const lang = useLang();
  const navigate = useNavigate();
  const city = cities.find((c) => c.id === cityId);
  const [lat, setLat] = useState(city?.center.lat ?? 28.6139);
  const [lng, setLng] = useState(city?.center.lng ?? 77.209);
  const [hazardType, setHazardType] = useState<(typeof HAZARDS)[number]>("smoke");
  const [note, setNote] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const photoUrlRef = useRef<string | null>(null);
  const [voice, setVoice] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [locating, setLocating] = useState(false);
  const [locationError, setLocationError] = useState(false);
  const mapRef = useRef<HTMLDivElement>(null);
  const mapObj = useRef<maplibregl.Map | null>(null);
  const markerRef = useRef<maplibregl.Marker | null>(null);

  useEffect(() => {
    if (!city) return;
    setLat(city.center.lat);
    setLng(city.center.lng);
  }, [city]);

  useEffect(() => {
    const el = mapRef.current;
    if (!el) return;
    const startLat = city?.center.lat ?? lat;
    const startLng = city?.center.lng ?? lng;
    const map = new maplibregl.Map({
      container: el,
      style: MAP_STYLE,
      center: [startLng, startLat],
      zoom: 12,
    });
    const marker = new maplibregl.Marker({ draggable: true }).setLngLat([startLng, startLat]).addTo(map);
    marker.on("dragend", () => {
      const next = marker.getLngLat();
      setLat(next.lat);
      setLng(next.lng);
    });
    mapObj.current = map;
    markerRef.current = marker;
    return () => {
      marker.remove();
      map.remove();
      mapObj.current = null;
      markerRef.current = null;
    };
  }, [city?.id]);

  useEffect(() => {
    const marker = markerRef.current;
    const map = mapObj.current;
    if (!marker || !map) return;
    const current = marker.getLngLat();
    if (Math.abs(current.lat - lat) < 1e-6 && Math.abs(current.lng - lng) < 1e-6) return;
    marker.setLngLat([lng, lat]);
    map.easeTo({ center: [lng, lat], duration: 300 });
  }, [lat, lng]);

  useEffect(() => {
    return () => {
      if (photoUrlRef.current) URL.revokeObjectURL(photoUrlRef.current);
    };
  }, []);

  const onPhoto = (next: File | null) => {
    if (photoUrlRef.current) URL.revokeObjectURL(photoUrlRef.current);
    const url = next ? URL.createObjectURL(next) : null;
    photoUrlRef.current = url;
    setFile(next);
    setPhotoUrl(url);
  };

  const locate = () => {
    if (!navigator.geolocation) {
      setLocationError(true);
      return;
    }
    setLocating(true);
    setLocationError(false);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLat(pos.coords.latitude);
        setLng(pos.coords.longitude);
        setLocating(false);
      },
      () => {
        setLocating(false);
        setLocationError(true);
      },
    );
  };

  const submit = async () => {
    try {
      setError(null);
      if (!file) throw new Error(t(lang, "photoRequired"));
      setBusy(true);
      const created = await api.createReport({ cityId, lat, lng, hazardType, note }, auth);
      localStorage.setItem(`zephyr.closure.${created.reportId}`, created.closureToken);
      await api.uploadPhoto(created.reportId, file);
      if (voice) await api.uploadVoice(created.reportId, voice);
      await api.commitReport(created.reportId);
      navigate(`/track/${created.reportId}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="stack">
      <PageHead kicker={city?.name ?? ""} title={t(lang, "report")} />
      <form
        className="card report-form"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <h2>{t(lang, "citizenReport")}</h2>
        <div className="report-map-col">
          <div ref={mapRef} className="report-map" />
          <p className="muted">{t(lang, "movePin")}</p>
          <button type="button" onClick={locate} disabled={locating}>
            {locating ? t(lang, "locating") : t(lang, "useMyLocation")}
          </button>
          {locationError ? <p className="error">{t(lang, "locationFailed")}</p> : null}
          <details>
            <summary>{t(lang, "coordinates")}</summary>
            <label>
              {t(lang, "lat")}
              <input type="number" step="any" value={lat} onChange={(e) => setLat(Number(e.target.value))} required />
            </label>
            <label>
              {t(lang, "lng")}
              <input type="number" step="any" value={lng} onChange={(e) => setLng(Number(e.target.value))} required />
            </label>
          </details>
        </div>
        <div className="report-fields">
          <label>
            {t(lang, "hazard")}
            <select value={hazardType} onChange={(e) => setHazardType(e.target.value as (typeof HAZARDS)[number])}>
              {HAZARDS.map((h) => (
                <option key={h} value={h}>
                  {t(lang, HAZARD_KEY[h])}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t(lang, "note")}
            <textarea value={note} onChange={(e) => setNote(e.target.value)} />
          </label>
          <label>
            {t(lang, "photo")}
            <input type="file" accept="image/*" required onChange={(e) => onPhoto(e.target.files?.[0] ?? null)} />
            {file ? <span className="muted">{file.name}</span> : null}
            {photoUrl ? <img className="report-preview" src={photoUrl} alt="" /> : null}
          </label>
          <label>
            {t(lang, "voiceOptional")}
            <input type="file" accept="audio/*" onChange={(e) => setVoice(e.target.files?.[0] ?? null)} />
          </label>
          {error ? <p className="error">{error}</p> : null}
          <button className="primary" type="submit" disabled={busy}>
            {busy ? t(lang, "submitting") : t(lang, "submit")}
          </button>
        </div>
      </form>
    </div>
  );
}

export function TrackPage({ cityId }: { cityId: string }) {
  const lang = useLang();
  const { id } = useParams();
  const [data, setData] = useState<ReportView | null>(null);
  void cityId;

  useEffect(() => {
    if (!id) return;
    const load = () => api.getReport(id).then(setData).catch(console.error);
    load();
    const timer = setInterval(load, 2000);
    return () => clearInterval(timer);
  }, [id]);

  if (!data || !id) return <Status>{t(lang, "loading")}</Status>;
  const token = localStorage.getItem(`zephyr.closure.${id}`);
  const closure = data.incident?.closure;
  const classification = data.report.classification;

  return (
    <div className="stack">
      <div className="card">
        <h2>{t(lang, "trackTitle", { id })}</h2>
        <p>
          {t(lang, "status")}: <strong>{data.report.status}</strong>
        </p>
        <p className="muted">
          {t(lang, "hex")} {data.report.h3}
        </p>
        {classification ? (
          <div>
            <h3>{t(lang, "classification")}</h3>
            <ul className="facts">
              {classification.hazardType ? (
                <li>
                  {t(lang, "hazard")}: {classification.hazardType}
                </li>
              ) : null}
              {classification.severity ? (
                <li>
                  {t(lang, "severity")}: {classification.severity}
                </li>
              ) : null}
              {classification.confidence != null ? (
                <li>
                  {t(lang, "confidence")}: {Math.round(classification.confidence * 100)}%
                </li>
              ) : null}
              {classification.source ? (
                <li>
                  {t(lang, "source")}: {classification.source}
                </li>
              ) : null}
            </ul>
          </div>
        ) : null}
        {data.incident ? (
          <p>
            {t(lang, "incident")} <Link to={`/zones/${data.incident.h3}`}>{data.incident.id}</Link> · {data.incident.status} ·{" "}
            {data.incident.reason}
          </p>
        ) : null}
      </div>
      {closure?.open && token ? (
        <div className="card row">
          <span>{t(lang, "isFixed")}</span>
          <button
            type="button"
            className="primary"
            onClick={() => api.closure(id, token, "FIXED").then(() => api.getReport(id).then(setData))}
          >
            {t(lang, "fixedDone")}
          </button>
          <button
            type="button"
            className="danger"
            onClick={() => api.closure(id, token, "STILL").then(() => api.getReport(id).then(setData))}
          >
            {t(lang, "stillThereLabel")}
          </button>
        </div>
      ) : null}
    </div>
  );
}

export function ZonePage({ cityId, auth }: { cityId: string; auth: Auth | null }) {
  const lang = useLang();
  const { h3 = "" } = useParams();
  const canSpeak = useSpeechReady(lang);
  const [zone, setZone] = useState<ZoneView | null>(null);
  const [forecast, setForecast] = useState<ForecastView | null>(null);
  const [brief, setBrief] = useState("");
  const [health, setHealth] = useState<Record<string, unknown> | null>(null);
  const [subscribed, setSubscribed] = useState(false);

  useEffect(() => {
    if (!h3) return;
    setZone(null);
    setSubscribed(false);
    api.zone(h3).then(setZone).catch(console.error);
    api.forecast(h3, cityId).then(setForecast).catch(() => setForecast(null));
    api.brief(h3, lang).then((b) => setBrief(b.text)).catch(() => setBrief(""));
    api.zoneHealth(h3, lang).then(setHealth).catch(() => setHealth(null));
  }, [h3, cityId, lang]);

  if (!zone) return <Status>{t(lang, "loading")}</Status>;

  const station = zone.nearestStation;
  const distance =
    zone.distanceKm == null
      ? null
      : `${station?.name ?? t(lang, "nearest")} · AQI ${station?.aqi ?? "—"} · ${zone.distanceKm.toFixed(1)} ${t(lang, "km")}`;
  const upwind = (zone.incidents ?? []).flatMap((i) => i.upwind ?? []);
  const advisory = zone.advisory;
  const missingSatellite = satelliteAbsent(zone) || satelliteAbsent(health);

  return (
    <div className="stack">
      <div className="card">
        <h1>{station?.name ? t(lang, "areaNear", { name: station.name }) : t(lang, "thisArea")}</h1>
        <p className="muted">{h3}</p>
        <p>
          {t(lang, "nearest")}: {distance ?? t(lang, "noStation")}
        </p>
        <p className="brief">{brief}</p>
        <div className="row">
          {canSpeak && brief ? (
            <button
              type="button"
              onClick={() => {
                const voice = voiceFor(lang);
                if (!voice || !brief) return;
                const synth = window.speechSynthesis;
                synth.cancel();
                const utterance = new SpeechSynthesisUtterance(brief);
                utterance.voice = voice;
                utterance.lang = voice.lang;
                synth.speak(utterance);
              }}
            >
              {t(lang, "readAloud")}
            </button>
          ) : null}
          {auth ? (
            <button
              type="button"
              className="primary"
              disabled={subscribed}
              onClick={() =>
                api.subscribe(auth, { h3, cityId, channels: ["in_app", "email"] }).then(() => setSubscribed(true))
              }
            >
              {subscribed ? t(lang, "subscribed") : t(lang, "subscribe")}
            </button>
          ) : (
            <p className="muted">{t(lang, "signInToSubscribe")}</p>
          )}
        </div>
        {subscribed ? <p className="subscribe-line">{t(lang, "subscribedLine")}</p> : null}
        {missingSatellite ? <p className="muted">{t(lang, "satelliteMissing")}</p> : null}
      </div>
      <div className="card">
        <h3>{t(lang, "upwind")}</h3>
        {upwind.length ? (
          <ul className="facts">
            {upwind.map((item, i) => (
              <li key={`${item.id ?? item.name ?? "src"}-${i}`}>{upwindLabel(item)}</li>
            ))}
          </ul>
        ) : (
          <p className="muted">—</p>
        )}
      </div>
      {advisory ? (
        <div className="card">
          <h3>
            {t(lang, "groupAdvisory")} · {advisory.band}
          </h3>
          <ul className="facts">
            {Object.entries(advisory.groups ?? {}).map(([k, v]) => (
              <li key={k}>
                <strong>{groupLabel(lang, k)}</strong>: {v}
              </li>
            ))}
          </ul>
          {advisory.attribution ? <p className="muted">{advisory.attribution}</p> : null}
        </div>
      ) : null}
      <div className="card">
        <h3>{t(lang, "forecast")}</h3>
        <div className="methods">
          <MethodChip lang={lang} name={t(lang, "forecastPersistence")} block={forecast?.persistence} />
          <MethodChip lang={lang} name={t(lang, "forecastModelled")} block={forecast?.modelled} />
          <MethodChip lang={lang} name={t(lang, "forecastArima")} block={forecast?.arima} />
        </div>
      </div>
    </div>
  );
}

export function DiaryPage({
  cityId,
  cities,
  auth,
  login,
}: {
  cityId: string;
  cities: City[];
  auth: Auth | null;
  login: (email: string, operator: boolean) => void;
}) {
  const lang = useLang();
  const [data, setData] = useState<DiaryView | null>(null);
  const [locating, setLocating] = useState(false);
  const [geoFailed, setGeoFailed] = useState(false);

  useEffect(() => {
    if (!auth) return;
    api.diary(auth).then(setData).catch(console.error);
  }, [auth]);

  if (!auth) {
    return (
      <div className="card diary-gate">
        <p>{t(lang, "signInDiary")}</p>
        <button type="button" onClick={() => login("resident@zephyr.local", false)}>
          {t(lang, "signInAction")}
        </button>
      </div>
    );
  }

  const bands = Object.entries(data?.hoursByBand ?? {});
  const gaps = data?.gaps ?? [];
  const city = cities.find((item) => item.id === cityId);

  const saveHome = (lat: number, lng: number) => {
    api.setDiary(auth, { cityId, lat, lng }).then(() => api.diary(auth).then(setData));
  };

  return (
    <div className="stack">
      <PageHead kicker={city?.name ?? ""} title={t(lang, "diary")} />
      <div className="card row">
        <button
          type="button"
          className="primary"
          disabled={locating}
          onClick={() => {
            if (!navigator.geolocation) {
              setGeoFailed(true);
              return;
            }
            setLocating(true);
            navigator.geolocation.getCurrentPosition(
              (pos) => {
                setLocating(false);
                setGeoFailed(false);
                saveHome(pos.coords.latitude, pos.coords.longitude);
              },
              () => {
                setLocating(false);
                setGeoFailed(true);
              },
            );
          }}
        >
          {locating ? t(lang, "locating") : t(lang, "setHomeLocation")}
        </button>
        {geoFailed && city ? (
          <button type="button" onClick={() => saveHome(city.center.lat, city.center.lng)}>
            {t(lang, "setHome")}
          </button>
        ) : null}
      </div>
      {geoFailed ? <p className="error">{t(lang, "locationFailed")}</p> : null}
      <div className="card">
        <h3>{t(lang, "hoursTitle")}</h3>
        {bands.length ? (
          <table>
            <tbody>
              {bands.map(([band, hours]) => (
                <tr key={band}>
                  <td>{band}</td>
                  <td>{hours}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="muted">—</p>
        )}
        <h3>{t(lang, "gapsTitle")}</h3>
        {gaps.length ? (
          <ul className="facts">
            {gaps.map((gap) => (
              <li key={`${gap.after}-${gap.before}`}>
                {formatWhen(gap.after, lang)} → {formatWhen(gap.before, lang)}
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">{t(lang, "noGaps")}</p>
        )}
      </div>
    </div>
  );
}

export function OperatorPage({ auth, cityId }: { auth: Auth | null; cityId: string }) {
  const lang = useLang();
  const [incidents, setIncidents] = useState<OperatorIncident[]>([]);
  const [question, setQuestion] = useState("");
  const [lastQuestion, setLastQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [toolsUsed, setToolsUsed] = useState<string[]>([]);
  const [copilotOpen, setCopilotOpen] = useState(false);
  const [copilotBusy, setCopilotBusy] = useState(false);
  void cityId;

  const reload = () => {
    if (!auth?.operator) return Promise.resolve();
    return api.incidents(auth).then((r) => setIncidents(r.incidents));
  };

  useEffect(() => {
    if (!auth?.operator) return;
    reload().catch(console.error);
  }, [auth]);

  useEffect(() => {
    if (!copilotOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setCopilotOpen(false);
    };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [copilotOpen]);

  const askCopilot = async () => {
    const text = question.trim();
    if (!auth?.operator || copilotBusy || !text) return;
    setLastQuestion(text);
    setCopilotBusy(true);
    setAnswer("");
    setToolsUsed([]);
    try {
      const r = await api.copilot(auth, text);
      setAnswer(r.answer);
      setToolsUsed(r.toolsUsed);
    } catch (err) {
      setAnswer(err instanceof Error ? err.message : String(err));
      setToolsUsed([]);
    } finally {
      setCopilotBusy(false);
    }
  };

  if (!auth?.operator) return <Status>{t(lang, "signInOperator")}</Status>;

  const confirmAction = (id: string, action: string, message: string) => {
    if (!window.confirm(message)) return;
    void api.incidentAction(auth, id, action).then(reload);
  };

  return (
    <div className="stack">
      <PageHead kicker={t(lang, "queue")} title={t(lang, "operator")}>
        <div className="row head-actions">
          <button
            type="button"
            className={copilotOpen ? "primary" : undefined}
            aria-expanded={copilotOpen}
            aria-controls="operator-copilot-panel"
            onClick={() => setCopilotOpen((open) => !open)}
          >
            {t(lang, "copilot")}
          </button>
        </div>
      </PageHead>
      <div className="card">
        <h2>{t(lang, "queue")}</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{t(lang, "hex")}</th>
                <th>{t(lang, "status")}</th>
                <th>{t(lang, "reason")}</th>
                <th>{t(lang, "flags")}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {incidents.map((i) => (
                <tr key={i.id}>
                  <td>
                    <Link to={`/zones/${i.h3}`}>{i.h3.slice(0, 10)}…</Link>
                  </td>
                  <td>{i.status}</td>
                  <td>
                    {i.reason}
                    {i.workOrder?.summaryEn ? <div className="muted">{i.workOrder.summaryEn}</div> : null}
                  </td>
                  <td>
                    {i.repeat ? <span className="badge warn">{t(lang, "repeat")}</span> : null}
                    {i.overdue ? <span className="badge bad">{t(lang, "overdue")}</span> : null}
                    {i.status === "disputed" ? <span className="badge bad">{t(lang, "disputed")}</span> : null}
                  </td>
                  <td className="row">
                    <button type="button" onClick={() => confirmAction(i.id, "dispatch", t(lang, "confirmDispatch"))}>
                      {t(lang, "dispatch")}
                    </button>
                    <button type="button" onClick={() => confirmAction(i.id, "resolve", t(lang, "confirmResolve"))}>
                      {t(lang, "resolve")}
                    </button>
                    <button
                      type="button"
                      onClick={() => confirmAction(i.id, "false-positive", t(lang, "confirmFalse"))}
                    >
                      {t(lang, "falsePositive")}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      {copilotOpen ? (
        <>
          <button
            type="button"
            className="copilot-scrim"
            aria-label={t(lang, "close")}
            onClick={() => setCopilotOpen(false)}
          />
          <aside
            id="operator-copilot-panel"
            className="copilot-panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby="operator-copilot-title"
          >
            <header className="copilot-panel-head">
              <div className="copilot-panel-title">
                <p className="copilot-eyebrow">{t(lang, "queue")}</p>
                <h2 id="operator-copilot-title">{t(lang, "copilot")}</h2>
              </div>
              <button
                type="button"
                className="copilot-panel-close"
                aria-label={t(lang, "close")}
                onClick={() => setCopilotOpen(false)}
              >
                ×
              </button>
            </header>
            <div className="copilot-panel-body">
              <div className="copilot-thread" aria-live="polite">
                {!lastQuestion && !copilotBusy ? (
                  <div className="copilot-empty">
                    <p className="copilot-empty-title">{t(lang, "copilot")}</p>
                    <p className="muted">{t(lang, "copilotHint")}</p>
                  </div>
                ) : null}
                {lastQuestion ? (
                  <div className="copilot-bubble copilot-bubble-user">
                    <span className="copilot-bubble-label">{t(lang, "operator")}</span>
                    <p>{lastQuestion}</p>
                  </div>
                ) : null}
                {copilotBusy ? (
                  <div className="copilot-bubble copilot-bubble-assistant copilot-bubble-pending" aria-busy="true">
                    <span className="copilot-bubble-label">{t(lang, "copilot")}</span>
                    <p className="muted">{t(lang, "loading")}</p>
                  </div>
                ) : null}
                {!copilotBusy && answer ? (
                  <div className="copilot-bubble copilot-bubble-assistant">
                    <span className="copilot-bubble-label">{t(lang, "copilot")}</span>
                    <p className="copilot-answer">{answer}</p>
                    {toolsUsed.length > 0 ? (
                      <div className="copilot-tools">
                        <span className="copilot-tools-label">{t(lang, "tools")}</span>
                        {toolsUsed.map((tool) => (
                          <span key={tool} className="badge demo">{tool}</span>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
              <form
                className="copilot-composer"
                onSubmit={(event) => {
                  event.preventDefault();
                  void askCopilot();
                }}
              >
                <label className="sr" htmlFor="operator-copilot-question">{t(lang, "copilotHint")}</label>
                <textarea
                  id="operator-copilot-question"
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                  placeholder={t(lang, "copilotHint")}
                  rows={3}
                  disabled={copilotBusy}
                />
                <button type="submit" className="primary copilot-send" disabled={copilotBusy || !question.trim()}>
                  {copilotBusy ? t(lang, "loading") : t(lang, "ask")}
                </button>
              </form>
            </div>
          </aside>
        </>
      ) : null}
    </div>
  );
}

export function PipelinePage({ auth, cityId }: { auth: Auth | null; cityId: string }) {
  const lang = useLang();
  const [items, setItems] = useState<Array<Record<string, unknown>>>([]);
  const [health, setHealth] = useState<Health | null>(null);
  const [modeBusy, setModeBusy] = useState(false);
  const [tickBusy, setTickBusy] = useState(false);
  const [tickNote, setTickNote] = useState<string | null>(null);
  const [tickError, setTickError] = useState<string | null>(null);
  void cityId;

  const reload = async () => {
    if (!auth?.operator) return;
    setItems((await api.dlq(auth)).items);
    setHealth(await api.health());
  };

  useEffect(() => {
    if (!auth?.operator) return;
    reload().catch(console.error);
  }, [auth]);

  if (!auth) return <Status>{t(lang, "signInOperator")}</Status>;
  if (!auth.operator) {
    return (
      <div className="card">
        <p>{t(lang, "operatorNotAllowed")}</p>
      </div>
    );
  }

  const mode = health?.dataMode === "live" || health?.dataMode === "demo" ? health.dataMode : null;

  const setDataMode = async (next: "demo" | "live") => {
    if (!mode || next === mode || modeBusy) return;
    setTickError(null);
    setModeBusy(true);
    try {
      await api.setMode(auth, next);
      await reload();
    } catch (err) {
      setTickError(err instanceof Error ? err.message : String(err));
    } finally {
      setModeBusy(false);
    }
  };

  const runTick = async () => {
    setTickError(null);
    setTickNote(null);
    setTickBusy(true);
    try {
      await api.tick(auth);
      await reload();
      setTickNote(t(lang, "tickDone"));
    } catch (err) {
      setTickError(err instanceof Error ? err.message : String(err));
    } finally {
      setTickBusy(false);
    }
  };

  return (
    <div className="stack">
      <PageHead kicker={t(lang, "live")} title={t(lang, "pipeline")}>
        <div className="row head-actions">
          <button
            type="button"
            role="switch"
            className={`mode-toggle${mode ? ` ${mode}` : ""}`}
            aria-checked={mode === "live"}
            aria-label={mode === "live" ? t(lang, "liveMode") : t(lang, "demoMode")}
            disabled={!mode || modeBusy || tickBusy}
            onClick={() => void setDataMode(mode === "live" ? "demo" : "live")}
          >
            <span className={mode === "demo" ? "is-active" : undefined}>{t(lang, "demoMode")}</span>
            <span className="mode-switch" aria-hidden="true" />
            <span className={mode === "live" ? "is-active" : undefined}>{t(lang, "liveMode")}</span>
          </button>
          <button type="button" className="primary" disabled={tickBusy || modeBusy} onClick={() => void runTick()}>
            {tickBusy ? t(lang, "tickRunning") : t(lang, "runTick")}
          </button>
        </div>
      </PageHead>
      {tickBusy ? <p className="status">{t(lang, "tickRunning")}</p> : null}
      {tickNote ? <p className="status">{tickNote}</p> : null}
      {tickError ? (
        <p className="error">
          {t(lang, "tickFailed")}: {tickError}
        </p>
      ) : null}
      {health?.ingest?.lastSuccessAt ? (
        <p className="muted">
          {t(lang, "lastIngest")}: {formatWhen(health.ingest.lastSuccessAt, lang)}
        </p>
      ) : null}
      {health?.ingest?.lastError ? (
        <p className="error">
          {t(lang, "feedError")}: {health.ingest.lastError}
        </p>
      ) : null}
      {health?.ingest?.stationCounts && Object.keys(health.ingest.stationCounts).length > 0 ? (
        <div className="card">
          <h2>{t(lang, "ingestSummary")}</h2>
          <p className="muted">{t(lang, "ingestSummaryHint")}</p>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{t(lang, "city")}</th>
                  <th>{t(lang, "ingestStations")}</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(health.ingest.stationCounts)
                  .sort(([a], [b]) => a.localeCompare(b))
                  .map(([cityId, count]) => (
                    <tr key={cityId}>
                      <td>{cityId}</td>
                      <td>{count}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
      {health?.ingest?.feeds && Object.keys(health.ingest.feeds).length > 0 ? (
        <div className="card">
          <h2>{t(lang, "ingestFeeds")}</h2>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{t(lang, "city")}</th>
                  <th>{t(lang, "source")}</th>
                  <th>{t(lang, "status")}</th>
                  <th>{t(lang, "ingestStations")}</th>
                  <th>{t(lang, "colError")}</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(health.ingest.feeds)
                  .sort(([a], [b]) => a.localeCompare(b))
                  .map(([key, feed]) => {
                    const split = key.indexOf(":");
                    const feedCity = split >= 0 ? key.slice(0, split) : key;
                    const source = split >= 0 ? key.slice(split + 1) : "";
                    return (
                      <tr key={key}>
                        <td>{feedCity}</td>
                        <td>{source}</td>
                        <td>{feed.ok ? t(lang, "ingestFeedOk") : t(lang, "ingestFeedFail")}</td>
                        <td>{feed.count}</td>
                        <td>{feed.error ?? ""}</td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
      <div className="card">
        <h2>{t(lang, "dlq")}</h2>
        <p className="muted">{t(lang, "dlqHint")}</p>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{t(lang, "colId")}</th>
                <th>{t(lang, "colError")}</th>
                <th>{t(lang, "failed")}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {items.length === 0 ? (
                <tr>
                  <td colSpan={4} className="muted">{t(lang, "dlqEmpty")}</td>
                </tr>
              ) : null}
              {items.map((i) => (
                <tr key={String(i.messageId)}>
                  <td>{String(i.messageId).slice(0, 8)}</td>
                  <td>{String(i.error)}</td>
                  <td>{String(i.failedAt)}</td>
                  <td>
                    <button type="button" onClick={() => api.replay(auth, String(i.messageId)).then(reload)}>
                      {t(lang, "replay")}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
