import { Link } from "react-router-dom";
import { useLang } from "./lang";
import { PageHead } from "./uiBits";

const LINK: Record<string, { privacy: string; terms: string; medical: string }> = {
  en: { privacy: "Privacy", terms: "Terms", medical: "Not medical advice" },
  hi: { privacy: "गोपनीयता", terms: "शर्तें", medical: "चिकित्सकीय सलाह नहीं" },
  mr: { privacy: "गोपनीयता", terms: "अटी", medical: "वैद्यकीय सल्ला नाही" },
  bn: { privacy: "গোপনীয়তা", terms: "শর্তাবলী", medical: "চিকিৎসা পরামর্শ নয়" },
  ta: { privacy: "தனியுரிமை", terms: "விதிமுறைகள்", medical: "மருத்துவ ஆலோசனை அல்ல" },
  kn: { privacy: "ಗೌಪ್ಯತೆ", terms: "ನಿಯಮಗಳು", medical: "ವೈದ್ಯಕೀಯ ಸಲಹೆ ಅಲ್ಲ" },
  te: { privacy: "గోప్యత", terms: "నిబంధనలు", medical: "వైద్య సలహా కాదు" },
  zh: { privacy: "隐私", terms: "条款", medical: "非医疗建议" },
  ru: { privacy: "Конфиденциальность", terms: "Условия", medical: "Не медицинский совет" },
  ar: { privacy: "الخصوصية", terms: "الشروط", medical: "ليست نصيحة طبية" },
  id: { privacy: "Privasi", terms: "Ketentuan", medical: "Bukan nasihat medis" },
  pt: { privacy: "Privacidade", terms: "Termos", medical: "Não é conselho médico" },
};

const NOTE: Record<string, string> = {
  en: "This line paraphrases an official air-quality band. It is not a diagnosis.",
  hi: "यह आधिकारिक वायु-गुणवत्ता बैंड का संक्षेप है। यह निदान नहीं है।",
  zh: "这是官方空气质量等级的转述，不是诊断。",
  ru: "Это пересказ официальной категории качества воздуха, а не диагноз.",
  ar: "هذا تلخيص لفئة رسمية لجودة الهواء، وليس تشخيصاً.",
  id: "Ini parafrase pita kualitas udara resmi, bukan diagnosis.",
  pt: "Isto é uma paráfrase da faixa oficial de qualidade do ar, não um diagnóstico.",
};

export function medicalNote(lang: string): string {
  return NOTE[lang] ?? NOTE.en;
}

export function medicalLink(lang: string): string {
  return (LINK[lang] ?? LINK.en).medical;
}

export function LegalFooter({ lang }: { lang: string }) {
  const labels = LINK[lang] ?? LINK.en;
  return (
    <footer className="legal-foot">
      <Link to="/privacy">{labels.privacy}</Link>
      <Link to="/terms">{labels.terms}</Link>
      <Link to="/disclaimer">{labels.medical}</Link>
    </footer>
  );
}

export function PrivacyPage() {
  const lang = useLang();
  const labels = LINK[lang] ?? LINK.en;
  return (
    <div className="stack legal-page">
      <PageHead kicker="Zephyr" title={labels.privacy} />
      <section className="card stack">
        <p>The operator of this Zephyr instance decides who can see reports. This demo does not name a separate legal entity.</p>
        <p>A report stores a precise latitude and longitude, an IP hash, and a reporter key. A diary stores the home pin you set. A photo can show faces and places. Before the file is saved, EXIF and XMP are removed so GPS in the file is not kept. The worker deletes photos older than 24 hours.</p>
        <p>A WhatsApp report stores the sender number only as a hash. The closure check uses a keyed hash of that number, not the number in the clear.</p>
        <p>This browser keeps <code>zephyr.lang</code>, <code>zephyr.auth</code>, <code>zephyr.theme</code>, <code>zephyr.tracks</code> (recent report ids), and <code>zephyr.closure.&lt;id&gt;</code> (the token that closes your own report). There is no other cookie.</p>
      </section>
    </div>
  );
}

export function TermsPage() {
  const lang = useLang();
  const labels = LINK[lang] ?? LINK.en;
  return (
    <div className="stack legal-page">
      <PageHead kicker="Zephyr" title={labels.terms} />
      <section className="card stack">
        <p>Zephyr shows community air reports for twelve monitored cities. Demo mode uses fixtures. Live mode may store OpenAQ and CPCB readings. WAQI may appear on the live map and is not stored. Limits and attribution are in the feed note.</p>
        <p>Google Air Quality is a point lookup only. This map does not draw Google heat tiles. A value that comes from Google must say “Includes air quality data from Google” next to that value. Google’s terms and privacy policy apply to that value: <a href="https://policies.google.com/terms">terms</a> and <a href="https://policies.google.com/privacy">privacy</a>.</p>
        <p>Open-Meteo supplies wind direction. OpenStreetMap data is reused from saved places. Do not treat the dashboard as an official bulletin.</p>
      </section>
    </div>
  );
}

export function DisclaimerPage() {
  const lang = useLang();
  const labels = LINK[lang] ?? LINK.en;
  return (
    <div className="stack legal-page">
      <PageHead kicker="Zephyr" title={labels.medical} />
      <section className="card stack">
        <p>{medicalNote(lang)}</p>
        <p>The action line (“avoid outdoor activity” and the rest) repeats a CPCB or US EPA band in plain language. It is not a clinician and not a personal medical instruction.</p>
        <p>
          Official bulletins: <a href="https://cpcb.nic.in/AQI_Bulletin.php">CPCB AQI bulletin</a>
          {" · "}
          <a href="https://www.airnow.gov/">AirNow</a>
        </p>
      </section>
    </div>
  );
}
