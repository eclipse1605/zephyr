import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, type CitySummary, type Health } from "./api";
import { t } from "./i18n";
import { useLang } from "./lang";
import { sourceLabel } from "./flows";
import { medicalLink, medicalNote } from "./legal";
import { retryLabel } from "./mapStyle";
import { AqiDial, aqiTone, formatWhen, HomeSkeleton, PageHead } from "./uiBits";
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

const INGEST_NOTE: Record<string, string> = {
  en: "The upstream feed failed. These numbers may not match the current air.",
  hi: "अपस्ट्रीम फ़ीड विफल रहा। ये संख्याएँ मौजूदा हवा से मेल नहीं खा सकतीं।",
  mr: "अपस्ट्रीम फीड अयशस्वी. या संख्या सध्याच्या हवेशी जुळणार नाहीत.",
  bn: "আপস্ট্রিম ফিড ব্যর্থ। এই সংখ্যা বর্তমান বাতাসের সঙ্গে নাও মিলতে পারে।",
  ta: "மேல்நிலை ஊட்டம் தோல்வி. இந்த எண்கள் தற்போதைய காற்றுடன் பொருந்தாமல் இருக்கலாம்.",
  kn: "ಮೇಲಿನ ಫೀಡ್ ವಿಫಲ. ಈ ಸಂಖ್ಯೆಗಳು ಈಗಿನ ಗಾಳಿಗೆ ಹೊಂದದಿರಬಹುದು.",
  te: "అప్‌స్ట్రీమ్ ఫీడ్ విఫలమైంది. ఈ సంఖ్యలు ప్రస్తుత గాలితో పోలకపోవచ్చు.",
  zh: "上游数据源失败。这些数字可能不符合当前空气。",
  ru: "Источник данных не сработал. Числа могут не соответствовать текущему воздуху.",
  ar: "فشل مصدر البيانات. قد لا تطابق هذه الأرقام الهواء الحالي.",
  id: "Umpan data gagal. Angka ini mungkin tidak sesuai dengan udara saat ini.",
  pt: "A fonte de dados falhou. Estes números podem não bater com o ar atual.",
};

function ingestNote(lang: string): string {
  return INGEST_NOTE[lang] ?? INGEST_NOTE.en;
}

const OLD_NOTE: Record<string, string> = {
  en: "These numbers are old. They are not a live reading.",
  hi: "ये संख्याएँ पुरानी हैं। यह लाइव रीडिंग नहीं है।",
  mr: "ही संख्या जुनी आहेत. हा थेट वाचन नाही.",
  bn: "এই সংখ্যা পুরনো। এটা লাইভ রিডিং নয়।",
  ta: "இந்த எண்கள் பழையவை. இது நேரடி அளவு அல்ல.",
  kn: "ಈ ಸಂಖ್ಯೆಗಳು ಹಳೆಯವು. ಇದು ಲೈವ್ ಓದಲ್ಲ.",
  te: "ఈ సంఖ్యలు పాతవి. ఇది లైవ్ రీడింగ్ కాదు.",
  zh: "这些数字已过时，不是实时读数。",
  ru: "Эти числа устарели. Это не текущие показания.",
  ar: "هذه الأرقام قديمة. ليست قراءة مباشرة.",
  id: "Angka ini sudah lama. Ini bukan bacaan langsung.",
  pt: "Estes números estão velhos. Não são uma leitura ao vivo.",
};

function oldNote(lang: string): string {
  return OLD_NOTE[lang] ?? OLD_NOTE.en;
}

const UNCONFIRMED: Record<string, string> = {
  en: "These numbers are not confirmed current.",
  hi: "ये संख्याएँ ताज़ा पुष्टि नहीं हैं।",
  mr: "या संख्या ताज्या आहेत हे निश्चित नाही.",
  bn: "এই সংখ্যা সাম্প্রতিক বলে নিশ্চিত নয়।",
  ta: "இந்த எண்கள் தற்போதையவை என்று உறுதி இல்லை.",
  kn: "ಈ ಸಂಖ್ಯೆಗಳು ಪ್ರಸ್ತುತ ಎಂದು ದೃಢವಿಲ್ಲ.",
  te: "ఈ సంఖ్యలు ప్రస్తుతం అని నిర్ధారణ లేదు.",
  zh: "这些数字未经确认为实时。",
  ru: "Актуальность этих чисел не подтверждена.",
  ar: "هذه الأرقام غير مؤكدة كقراءة حالية.",
  id: "Angka ini belum dipastikan terkini.",
  pt: "Estes números não estão confirmados como atuais.",
};

function unconfirmedNote(lang: string): string {
  return UNCONFIRMED[lang] ?? UNCONFIRMED.en;
}

const HEALTH_DOWN: Record<string, string> = {
  en: "The health check failed, so these numbers are not confirmed.",
  hi: "स्वास्थ्य जाँच विफल रही, इसलिए ये संख्याएँ पुष्टि नहीं हैं।",
  mr: "आरोग्य तपासणी अयशस्वी, त्यामुळे या संख्या निश्चित नाहीत.",
  bn: "স্বাস্থ্য পরীক্ষা ব্যর্থ, তাই এই সংখ্যা নিশ্চিত নয়।",
  ta: "ஆரோக்கிய சோதனை தோல்வி. இந்த எண்கள் உறுதி செய்யப்படவில்லை.",
  kn: "ಆರೋಗ್ಯ ಪರಿಶೀಲನೆ ವಿಫಲ. ಈ ಸಂಖ್ಯೆಗಳು ದೃಢವಾಗಿಲ್ಲ.",
  te: "హెల్త్ చెక్ విఫలమైంది, కాబట్టి ఈ సంఖ్యలు నిర్ధారించబడలేదు.",
  zh: "健康检查失败，因此这些数字未经确认。",
  ru: "Проверка состояния не удалась, поэтому числа не подтверждены.",
  ar: "فشل فحص الحالة، لذا هذه الأرقام غير مؤكدة.",
  id: "Pemeriksaan kesehatan gagal, jadi angka ini belum terkonfirmasi.",
  pt: "A verificação de saúde falhou, então estes números não estão confirmados.",
};

function healthDownNote(lang: string): string {
  return HEALTH_DOWN[lang] ?? HEALTH_DOWN.en;
}

function readingIsOld(iso: string | null | undefined): boolean {
  if (!iso) return false;
  const at = Date.parse(iso);
  if (Number.isNaN(at)) return false;
  return Date.now() - at > 3 * 60 * 60 * 1000;
}

const HOME_MISS: Record<string, string> = {
  en: "Couldn’t load",
  hi: "लोड नहीं हो सका",
  mr: "लोड झाले नाही",
  bn: "লোড হয়নি",
  ta: "ஏற்ற முடியவில்லை",
  kn: "ಲೋಡ್ ಆಗಲಿಲ್ಲ",
  te: "లోడ్ కాలేదు",
  zh: "未能加载",
  ru: "Не удалось загрузить",
  ar: "تعذّر التحميل",
  id: "Gagal memuat",
  pt: "Não foi possível carregar",
};

function missLabel(lang: string): string {
  return HOME_MISS[lang] ?? HOME_MISS.en;
}

const FEED_KEYS = ["openaq", "cpcb", "waqi", "demo"];

function isConfigMissing(error: string | null | undefined): boolean {
  const text = (error ?? "").toLowerCase();
  return text.includes("not configured") || (text.includes("api_key") && text.includes("missing"));
}

function failedSources(health: Health | null): string[] {
  const feeds = health?.ingest?.feeds;
  const fromFeeds = feeds
    ? Object.entries(feeds).flatMap(([key, item]) => {
        if (item?.ok !== false || isConfigMissing(item.error)) return [];
        const cut = key.lastIndexOf(":");
        return [cut >= 0 ? key.slice(cut + 1) : key];
      })
    : [];
  const unique = [...new Set(fromFeeds)];
  if (unique.length) return unique;
  const err = health?.ingest?.lastError?.toLowerCase() ?? "";
  if (isConfigMissing(err)) return [];
  return FEED_KEYS.filter((key) => err.includes(key));
}

/** Hard feed failures only — missing optional API keys are not treated as stale. */
function ingestError(health: Health | null): string | null {
  const feeds = health?.ingest?.feeds;
  if (feeds) {
    const failed = Object.entries(feeds).filter(([, feed]) => feed?.ok === false && !isConfigMissing(feed.error));
    if (failed.length) {
      const unique = [...new Set(failed.map(([, feed]) => feed.error?.trim() || "feedError").filter(Boolean))];
      return unique.join("; ");
    }
    // Only config-missing failures remain — not an upstream outage.
    if (Object.values(feeds).some((feed) => feed?.ok === false)) return null;
  }
  const err = health?.ingest?.lastError;
  if (typeof err === "string" && err.trim() && !isConfigMissing(err)) return err.trim();
  return null;
}

function optionalFeedNote(health: Health | null, lang: string): string | null {
  const feeds = health?.ingest?.feeds;
  if (!feeds) return null;
  const skipped = [...new Set(
    Object.entries(feeds)
      .filter(([, feed]) => feed?.ok === false && isConfigMissing(feed.error))
      .map(([key]) => {
        const cut = key.lastIndexOf(":");
        return cut >= 0 ? key.slice(cut + 1) : key;
      }),
  )];
  if (!skipped.length) return null;
  const names = skipped.map((name) => sourceLabel(lang, name)).join(", ");
  return OPTIONAL_FEED[lang]?.replace("{names}", names) ?? OPTIONAL_FEED.en.replace("{names}", names);
}

const OPTIONAL_FEED: Record<string, string> = {
  en: "{names} feed is not configured.",
  hi: "{names} फ़ीड कॉन्फ़िगर नहीं है।",
  mr: "{names} फीड कॉन्फिगर नाही.",
  bn: "{names} ফিড কনফিগার করা নেই।",
  ta: "{names} ஊட்டம் அமைக்கப்படவில்லை.",
  kn: "{names} ಫೀಡ್ ಸಂರಚಿಸಿಲ್ಲ.",
  te: "{names} ఫీడ్ కాన్ఫిగర్ కాలేదు.",
  zh: "未配置 {names} 数据源。",
  ru: "Канал {names} не настроен.",
  ar: "تغذية {names} غير مُعدّة.",
  id: "Umpan {names} belum dikonfigurasi.",
  pt: "A fonte {names} não está configurada.",
};

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

function compact(n: number | null | undefined, lang: string): string {
  if (n == null || Number.isNaN(n)) return "—";
  return new Intl.NumberFormat(lang, { notation: "compact", maximumFractionDigits: 1 }).format(n);
}

function Spread({ p10, p90, mid }: { p10: number | null; p90: number | null; mid: number | null }) {
  const top = Math.max(p10 ?? 0, p90 ?? 0, mid ?? 0, 1);
  const at = (n: number | null) => (n == null ? null : `${Math.min(100, (n / top) * 100)}%`);
  const left = at(p10);
  const right = at(p90);
  return (
    <div className="spread">
      <div className="spread-track">
        {left && right ? <span className="spread-range" style={{ left, width: `max(4px, calc(${right} - ${left}))` }} /> : null}
        {at(mid) ? <span className="spread-mark" style={{ left: at(mid)! }} /> : null}
      </div>
      <div className="spread-labels">
        <span>p10 {p10 == null ? "—" : Math.round(p10)}</span>
        <span>p90 {p90 == null ? "—" : Math.round(p90)}</span>
      </div>
    </div>
  );
}

function WardBoard({ title, wards, lang, stale }: { title: string; wards: Array<{ name: string; aqi: number }>; lang: string; stale: boolean }) {
  const max = Math.max(1, ...wards.map((ward) => ward.aqi));
  return (
    <section className={`card ward-board${stale ? " is-stale" : ""}`}>
      <h2>{title}</h2>
      <ol>
        {wards.map((w) => {
          const tone = aqiTone(w.aqi);
          return (
            <li key={w.name}>
              <div className="ward-row">
                <span className="ward-name">{w.name}</span>
                <span className={`ward-aqi tone-${tone}`}>
                  {w.aqi}
                  <span className="ward-band">{t(lang, BAND_KEY[tone] ?? "bandUnknown")}</span>
                </span>
              </div>
              <div className="ward-track" aria-hidden="true">
                <span className={`ward-fill fill-${tone}`} style={{ width: `${Math.max(6, (w.aqi / max) * 100)}%` }} />
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

export function Home({ cityId, cityName }: { cityId: string; cityName: string }) {
  const lang = useLang();
  const [summary, setSummary] = useState<CitySummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const [healthDown, setHealthDown] = useState(false);
  const [healthReady, setHealthReady] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [shownCity, setShownCity] = useState(cityId);
  if (cityId !== shownCity) {
    setShownCity(cityId);
    setSummary(null);
    setError(null);
    setHealth(null);
    setHealthDown(false);
    setHealthReady(false);
  }

  useEffect(() => {
    let stop = false;
    setError(null);
    setHealthDown(false);
    setHealthReady(false);
    api.summary(cityId).then((next) => {
      if (!stop && next.cityId === cityId) setSummary(next);
    }).catch((e: Error) => {
      if (!stop) setError(e.message);
    });
    api.health().then((next) => {
      if (stop) return;
      setHealth(next);
      setHealthDown(false);
      setHealthReady(true);
    }).catch(() => {
      if (stop) return;
      setHealth(null);
      setHealthDown(true);
      setHealthReady(true);
    });
    return () => {
      stop = true;
    };
  }, [cityId, attempt]);

  const current = shownCity === cityId && summary?.cityId === cityId ? summary : null;
  const feed = ingestError(health);
  const optionalNote = optionalFeedNote(health, lang);
  // Wait for health before treating the reading as stale (avoids a false "unconfirmed" flash).
  const stale = healthReady && (Boolean(feed) || healthDown || readingIsOld(current?.computedAt));
  const mode = current?.dataMode === "demo" ? "demo" : "live";

  if (error || !current) {
    return (
      <div className="stack">
        <PageHead kicker={t(lang, "home")} title={cityName || t(lang, "home")} />
        {error ? (
          <div className="card">
            <p className="error">{error.includes("summary_missing") ? t(lang, "summaryHint") : missLabel(lang)}</p>
            {error.includes("summary_missing") ? null : <p className="muted">{t(lang, "summaryHint")}</p>}
            <div className="row">
              <button type="button" onClick={() => setAttempt((n) => n + 1)}>{retryLabel(lang)}</button>
              <Link to="/pipeline">{t(lang, "pipeline")}</Link>
            </div>
          </div>
        ) : (
          <HomeSkeleton />
        )}
      </div>
    );
  }

  const tone = aqiTone(current.cityAqi);
  const band = t(lang, BAND_KEY[tone] ?? "bandUnknown");
  const numericAqi = current.cityAqi != null && !Number.isNaN(current.cityAqi);
  const action = numericAqi ? ACTION_KEY[tone] : undefined;
  const monitored = new Set([...current.topWards, ...current.bottomWards].map((ward) => ward.name)).size;
  const oneList = sameWardNames(current.topWards, current.bottomWards);
  const monitoredRows = [...current.topWards]
    .sort((a, b) => b.aqi - a.aqi)
    .filter((ward, index, rows) => rows.findIndex((item) => item.name === ward.name) === index);
  const shownAqi = numericAqi ? Math.round(current.cityAqi as number) : null;

  return (
    <div className="stack">
      <PageHead kicker={t(lang, "home")} title={cityName || t(lang, "home")} />
      <section className={`hero hero-${tone}${stale ? " is-stale" : ""}`}>
        <div className="hero-copy">
          <div className="hero-figure">
            {shownAqi != null ? <p className={`hero-aqi tone-${tone}`}>{shownAqi}</p> : null}
            <div className="hero-aside">
              <p className="hero-band">{band}</p>
              {action ? <p className="aqi-action">{t(lang, action)}</p> : null}
              <p className="muted medical-note">
                {medicalNote(lang)}{" "}
                <Link to="/disclaimer">{medicalLink(lang)}</Link>
              </p>
            </div>
          </div>
          <div className="row">
            {stale ? (
              <span className="badge bad">
                {[
                  healthDown ? healthDownNote(lang) : null,
                  feed
                    ? [ingestNote(lang), failedSources(health).map((name) => sourceLabel(lang, name)).join(", ")].filter(Boolean).join(" ")
                    : null,
                  readingIsOld(current.computedAt) ? oldNote(lang) : null,
                ]
                  .filter(Boolean)
                  .join(" ") || unconfirmedNote(lang)}
              </span>
            ) : (
              <span className={`badge ${mode}`}>{t(lang, mode)}</span>
            )}
            {optionalNote && !feed ? <span className="muted">{optionalNote}</span> : null}
            <span className="muted">
              {t(lang, "lastIngest")}: {formatWhen(current.computedAt, lang)}
            </span>
          </div>
        </div>
        <AqiDial aqi={current.cityAqi} caption={t(lang, "medianNote", { n: current.liveStationCount })} />
      </section>
      <ul className="stat-strip">
        <li>
          <span className="stat-k">{t(lang, "live")}</span>
          <strong>{current.liveStationCount}</strong>
          <span className="muted">{t(lang, "offline")} {current.offlineStationCount}</span>
        </li>
        <li>
          <span className="stat-k">{t(lang, "hotspots")}</span>
          <strong>{current.openIncidentCount}</strong>
          <Link to="/map">{t(lang, "openMap")}</Link>
        </li>
        {current.peopleInPoor != null ? (
          <li>
            <span className="stat-k">{t(lang, "people")}</span>
            <strong>{compact(current.peopleInPoor, lang)}</strong>
            {current.shareInPoor != null ? (
              <span className="muted">{t(lang, "shareOf", { share: `${Math.round(current.shareInPoor * 100)}%` })}</span>
            ) : null}
          </li>
        ) : null}
        {current.equity.ratio != null || current.uncoveredPopulation != null ? (
          <li>
            <span className="stat-k">{t(lang, "equity")}</span>
            <strong>{current.equity.ratio == null ? "—" : current.equity.ratio.toFixed(1)}</strong>
            <span className="muted">{t(lang, "uncovered", { n: compact(current.uncoveredPopulation, lang) })}</span>
          </li>
        ) : null}
      </ul>
      {current.equity.p10 != null || current.equity.p90 != null ? (
        <section className="card spread-card">
          <h2>{t(lang, "equityRatio")}</h2>
          <Spread p10={current.equity.p10} p90={current.equity.p90} mid={current.cityAqi} />
          <p className="muted">{t(lang, "equityNote")}</p>
        </section>
      ) : null}
      <div className="grid">
        {oneList ? (
          <WardBoard title={t(lang, "monitoredWards")} wards={monitoredRows} lang={lang} stale={stale} />
        ) : (
          <>
            <WardBoard title={t(lang, "highestWards")} wards={current.topWards} lang={lang} stale={stale} />
            <WardBoard title={t(lang, "lowestWards")} wards={current.bottomWards} lang={lang} stale={stale} />
          </>
        )}
      </div>
    </div>
  );
}
