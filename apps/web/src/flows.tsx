import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { latLngToCell } from "h3-js";
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
import { advisoryNote, briefFallback, briefForLang, groupAdvice, rememberTrack } from "./advice";
import { t } from "./i18n";
import { useLang } from "./lang";
import { mapStyleUrl, retryLabel } from "./mapStyle";
import { formatWhen, PageHead, Status } from "./uiBits";
import "./flows.css";

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
const BAND_FROM_API: Record<string, string> = {
  Good: "bandGood",
  Satisfactory: "bandSatisfactory",
  Moderate: "bandModerate",
  Poor: "bandPoor",
  "Very Poor": "bandVeryPoor",
  Severe: "bandSevere",
  good: "bandGood",
  sat: "bandSatisfactory",
  mod: "bandModerate",
  poor: "bandPoor",
  vp: "bandVeryPoor",
  severe: "bandSevere",
  off: "bandUnknown",
};

const ENUM_LABEL: Record<string, Record<string, string>> = {
  en: {
    pending_upload: "Waiting for photo",
    received: "Received",
    classified: "Classified",
    promoted: "Sent to operators",
    resolved: "Resolved",
    open: "Open",
    dispatched: "Dispatched",
    false_positive: "False alarm",
    disputed: "Disputed",
    low: "Low",
    medium: "Medium",
    high: "High",
    queue_empty: "No open incidents.",
  },
  hi: {
    pending_upload: "फ़ोटो की प्रतीक्षा",
    received: "प्राप्त",
    classified: "वर्गीकृत",
    promoted: "ऑपरेटर को भेजा",
    resolved: "सुलझ गया",
    open: "खुला",
    dispatched: "भेजा गया",
    false_positive: "गलत चेतावनी",
    disputed: "विवादित",
    low: "कम",
    medium: "मध्यम",
    high: "अधिक",
    queue_empty: "कोई खुली घटना नहीं।",
  },
  mr: {
    pending_upload: "फोटोची वाट",
    received: "मिळाले",
    classified: "वर्गीकृत",
    promoted: "ऑपरेटरकडे पाठवले",
    resolved: "सोडवले",
    open: "खुले",
    dispatched: "पाठवले",
    false_positive: "चुकीचा इशारा",
    disputed: "वादग्रस्त",
    low: "कमी",
    medium: "मध्यम",
    high: "जास्त",
    queue_empty: "कोणतीही खुली घटना नाही.",
  },
  bn: {
    pending_upload: "ছবির অপেক্ষা",
    received: "পাওয়া গেছে",
    classified: "শ্রেণিবদ্ধ",
    promoted: "অপারেটরের কাছে পাঠানো",
    resolved: "সমাধান হয়েছে",
    open: "খোলা",
    dispatched: "পাঠানো",
    false_positive: "ভুল সতর্কতা",
    disputed: "বিতর্কিত",
    low: "কম",
    medium: "মাঝারি",
    high: "বেশি",
    queue_empty: "কোনো খোলা ঘটনা নেই।",
  },
  ta: {
    pending_upload: "படத்துக்காக காத்திருப்பு",
    received: "பெறப்பட்டது",
    classified: "வகைப்படுத்தப்பட்டது",
    promoted: "இயக்குநருக்கு அனுப்பப்பட்டது",
    resolved: "தீர்க்கப்பட்டது",
    open: "திறந்தது",
    dispatched: "அனுப்பப்பட்டது",
    false_positive: "தவறான எச்சரிக்கை",
    disputed: "சர்ச்சை",
    low: "குறைவு",
    medium: "நடுத்தரம்",
    high: "அதிகம்",
    queue_empty: "திறந்த சம்பவங்கள் இல்லை.",
  },
  kn: {
    pending_upload: "ಫೋಟೋಗಾಗಿ ಕಾಯುವಿಕೆ",
    received: "ಸ್ವೀಕರಿಸಲಾಗಿದೆ",
    classified: "ವರ್ಗೀಕರಿಸಲಾಗಿದೆ",
    promoted: "ನಿರ್ವಾಹಕರಿಗೆ ಕಳುಹಿಸಲಾಗಿದೆ",
    resolved: "ಪರಿಹರಿಸಲಾಗಿದೆ",
    open: "ತೆರೆದಿದೆ",
    dispatched: "ಕಳುಹಿಸಲಾಗಿದೆ",
    false_positive: "ತಪ್ಪು ಎಚ್ಚರಿಕೆ",
    disputed: "ವಿವಾದಿತ",
    low: "ಕಡಿಮೆ",
    medium: "ಮಧ್ಯಮ",
    high: "ಹೆಚ್ಚು",
    queue_empty: "ತೆರೆದ ಘಟನೆಗಳಿಲ್ಲ.",
  },
  te: {
    pending_upload: "ఫోటో కోసం వేచి",
    received: "అందింది",
    classified: "వర్గీకరించబడింది",
    promoted: "ఆపరేటర్‌కు పంపబడింది",
    resolved: "పరిష్కారమైంది",
    open: "తెరిచి ఉంది",
    dispatched: "పంపబడింది",
    false_positive: "తప్పుడు హెచ్చరిక",
    disputed: "వివాదాస్పదం",
    low: "తక్కువ",
    medium: "మధ్యస్థం",
    high: "ఎక్కువ",
    queue_empty: "తెరిచిన ఘటనలు లేవు.",
  },
  zh: {
    pending_upload: "等待照片",
    received: "已收到",
    classified: "已分类",
    promoted: "已交给操作员",
    resolved: "已解决",
    open: "未关闭",
    dispatched: "已派出",
    false_positive: "误报",
    disputed: "有争议",
    low: "低",
    medium: "中",
    high: "高",
    queue_empty: "没有未关闭的事件。",
  },
  ru: {
    pending_upload: "Ждём фото",
    received: "Получено",
    classified: "Классифицировано",
    promoted: "Передано операторам",
    resolved: "Закрыто",
    open: "Открыто",
    dispatched: "Направлено",
    false_positive: "Ложная тревога",
    disputed: "Оспорено",
    low: "Низкая",
    medium: "Средняя",
    high: "Высокая",
    queue_empty: "Нет открытых инцидентов.",
  },
  ar: {
    pending_upload: "بانتظار الصورة",
    received: "تم الاستلام",
    classified: "مصنّف",
    promoted: "أُرسل إلى المشغّلين",
    resolved: "تم الحل",
    open: "مفتوح",
    dispatched: "تم الإرسال",
    false_positive: "إنذار خاطئ",
    disputed: "محل خلاف",
    low: "منخفض",
    medium: "متوسط",
    high: "مرتفع",
    queue_empty: "لا حوادث مفتوحة.",
  },
  id: {
    pending_upload: "Menunggu foto",
    received: "Diterima",
    classified: "Terklasifikasi",
    promoted: "Dikirim ke operator",
    resolved: "Selesai",
    open: "Terbuka",
    dispatched: "Dikirim",
    false_positive: "Alarm palsu",
    disputed: "Disengketakan",
    low: "Rendah",
    medium: "Sedang",
    high: "Tinggi",
    queue_empty: "Tidak ada insiden terbuka.",
  },
  pt: {
    pending_upload: "À espera da foto",
    received: "Recebido",
    classified: "Classificado",
    promoted: "Enviado aos operadores",
    resolved: "Resolvido",
    open: "Aberto",
    dispatched: "Enviado",
    false_positive: "Alarme falso",
    disputed: "Contestado",
    low: "Baixa",
    medium: "Média",
    high: "Alta",
    queue_empty: "Nenhum incidente aberto.",
  },
};

const OTHER_STATUS: Record<string, string> = {
  en: "Other status", hi: "अन्य स्थिति", mr: "इतर स्थिती", bn: "অন্য অবস্থা", ta: "வேறு நிலை", kn: "ಬೇರೆ ಸ್ಥಿತಿ", te: "ఇతర స్థితి", zh: "其他状态", ru: "Другой статус", ar: "حالة أخرى", id: "Status lain", pt: "Outro estado",
};

export function enumText(lang: string, value: string | undefined): string {
  if (!value) return "—";
  const local = ENUM_LABEL[lang]?.[value];
  if (local) return local;
  if (lang === "en") return ENUM_LABEL.en[value] ?? value.replaceAll("_", " ");
  return OTHER_STATUS[lang] ?? OTHER_STATUS.en;
}

const NO_REASON: Record<string, string> = {
  en: "Other reason", hi: "अन्य कारण", mr: "इतर कारण", bn: "অন্য কারণ", ta: "வேறு காரணம்", kn: "ಬೇರೆ ಕಾರಣ", te: "ఇతర కారణం", zh: "其他原因", ru: "Другая причина", ar: "سبب آخر", id: "Alasan lain", pt: "Outro motivo",
};

const REASON_TEXT: Record<string, Record<string, string>> = {
  citizens: { en: "Citizen reports", hi: "नागरिक रिपोर्ट", mr: "नागरिक अहवाल", bn: "নাগরিক রিপোর্ট", ta: "குடிமக்கள் அறிக்கை", kn: "ನಾಗರಿಕ ವರದಿ", te: "పౌర నివేదికలు", zh: "市民报告", ru: "Сообщения жителей", ar: "بلاغات السكان", id: "Laporan warga", pt: "Relatos de moradores" },
  citizen_sensor: { en: "Citizen report and sensor", hi: "नागरिक रिपोर्ट और सेंसर", mr: "नागरिक अहवाल आणि सेन्सर", bn: "নাগরিক রিপোর্ট ও সেন্সর", ta: "குடிமக்கள் அறிக்கையும் உணரியும்", kn: "ನಾಗರಿಕ ವರದಿ ಮತ್ತು ಸಂವೇದಕ", te: "పౌర నివేదిక మరియు సెన్సార్", zh: "市民报告和传感器", ru: "Сообщение и датчик", ar: "بلاغ ومستشعر", id: "Laporan warga dan sensor", pt: "Relato e sensor" },
  citizen_satellite: { en: "Citizen report and satellite", hi: "नागरिक रिपोर्ट और उपग्रह", mr: "नागरिक अहवाल आणि उपग्रह", bn: "নাগরিক রিপোর্ট ও স্যাটেলাইট", ta: "குடிமக்கள் அறிக்கையும் செயற்கைக்கோளும்", kn: "ನಾಗರಿಕ ವರದಿ ಮತ್ತು ಉಪಗ್ರಹ", te: "పౌర నివేదిక మరియు ఉపగ్రహం", zh: "市民报告和卫星", ru: "Сообщение и спутник", ar: "بلاغ وقمر", id: "Laporan warga dan satelit", pt: "Relato e satélite" },
  sensor_satellite: { en: "Sensor and satellite", hi: "सेंसर और उपग्रह", mr: "सेन्सर आणि उपग्रह", bn: "সেন্সর ও স্যাটেলাইট", ta: "உணரியும் செயற்கைக்கோளும்", kn: "ಸಂವೇದಕ ಮತ್ತು ಉಪಗ್ರಹ", te: "సెన్సార్ మరియు ఉపగ్రహం", zh: "传感器和卫星", ru: "Датчик и спутник", ar: "مستشعر وقمر", id: "Sensor dan satelit", pt: "Sensor e satélite" },
  sensor_only: { en: "Sensor only", hi: "केवल सेंसर", mr: "फक्त सेन्सर", bn: "শুধু সেন্সর", ta: "உணரி மட்டும்", kn: "ಸಂವೇದಕ ಮಾತ್ರ", te: "సెన్సార్ మాత్రమే", zh: "仅传感器", ru: "Только датчик", ar: "المستشعر فقط", id: "Hanya sensor", pt: "Só o sensor" },
};

function reasonText(lang: string, reason: string | undefined): string {
  if (!reason) return "—";
  const row = REASON_TEXT[reason];
  if (row) return row[lang] ?? row.en;
  return NO_REASON[lang] ?? NO_REASON.en;
}

const KIND_TEXT: Record<string, Record<string, string>> = {
  landfill: { en: "Landfill", hi: "कचरा स्थल", mr: "कचराभूमी", bn: "বর্জ্যভূমি", ta: "குப்பைக்கிடங்கு", kn: "ತ್ಯಾಜ್ಯ ನೆಲ", te: "చెత్త క్షేత్రం", zh: "填埋场", ru: "Свалка", ar: "مكب", id: "TPA", pt: "Aterro" },
  industrial: { en: "Industrial", hi: "औद्योगिक", mr: "औद्योगिक", bn: "শিল্প", ta: "தொழிற்சாலை", kn: "ಕೈಗಾರಿಕಾ", te: "పారిశ్రామిక", zh: "工业", ru: "Промышленный", ar: "صناعي", id: "Industri", pt: "Industrial" },
  terminal: { en: "Terminal", hi: "टर्मिनल", mr: "टर्मिनल", bn: "টার্মিনাল", ta: "முனையம்", kn: "ಟರ್ಮಿನಲ್", te: "టెర్మినల్", zh: "枢纽", ru: "Терминал", ar: "محطة", id: "Terminal", pt: "Terminal" },
  incident: { en: "Incident", hi: "घटना", mr: "घटना", bn: "ঘটনা", ta: "சம்பவம்", kn: "ಘಟನೆ", te: "ఘటన", zh: "事件", ru: "Инцидент", ar: "حادث", id: "Insiden", pt: "Incidente" },
};

const TOOL_TEXT: Record<string, Record<string, string>> = {
  incidents: { en: "Incidents", hi: "घटनाएँ", mr: "घटना", bn: "ঘটনা", ta: "சம்பவங்கள்", kn: "ಘಟನೆಗಳು", te: "ఘటనలు", zh: "事件", ru: "Инциденты", ar: "حوادث", id: "Insiden", pt: "Incidentes" },
  stations: { en: "Stations", hi: "स्टेशन", mr: "स्टेशन", bn: "স্টেশন", ta: "நிலையங்கள்", kn: "ಕೇಂದ್ರಗಳು", te: "స్టేషన్లు", zh: "站点", ru: "Станции", ar: "محطات", id: "Stasiun", pt: "Estações" },
  fires: { en: "Fires", hi: "आग", mr: "आग", bn: "আগুন", ta: "தீ", kn: "ಬೆಂಕಿ", te: "మంటలు", zh: "火点", ru: "Пожары", ar: "حرائق", id: "Kebakaran", pt: "Incêndios" },
  forecasts: { en: "Forecasts", hi: "पूर्वानुमान", mr: "अंदाज", bn: "পূর্বাভাস", ta: "முன்னறிவிப்பு", kn: "ಮುನ್ಸೂಚನೆ", te: "అంచనాలు", zh: "预报", ru: "Прогнозы", ar: "توقعات", id: "Prakiraan", pt: "Previsões" },
  upwind: { en: "Upwind", hi: "हवा की दिशा", mr: "वाऱ्याची दिशा", bn: "বায়ুমুখ", ta: "காற்றுத்திசை", kn: "ಗಾಳಿಯ ದಿಕ್ಕು", te: "గాలి దిశ", zh: "上风向", ru: "Наветренная сторона", ar: "اتجاه الريح", id: "Arah angin", pt: "Barlavento" },
  wind: { en: "Wind", hi: "हवा", mr: "वारा", bn: "বাতাস", ta: "காற்று", kn: "ಗಾಳಿ", te: "గాలి", zh: "风", ru: "Ветер", ar: "رياح", id: "Angin", pt: "Vento" },
};

const WORK_MISSING: Record<string, string> = {
  en: "No local summary",
  hi: "स्थानीय सार नहीं",
  mr: "स्थानिक सार नाही",
  bn: "স্থানীয় সারাংশ নেই",
  ta: "உள்ளூர் சுருக்கம் இல்லை",
  kn: "ಸ್ಥಳೀಯ ಸಾರಾಂಶವಿಲ್ಲ",
  te: "స్థానిక సారాంశం లేదు",
  zh: "没有本地摘要",
  ru: "Нет местного описания",
  ar: "لا يوجد ملخص محلي",
  id: "Tidak ada ringkasan lokal",
  pt: "Sem resumo local",
};

const LOCAL_SCRIPT: Record<string, RegExp> = {
  hi: /\p{Script=Devanagari}/u,
  mr: /\p{Script=Devanagari}/u,
  bn: /\p{Script=Bengali}/u,
  ta: /\p{Script=Tamil}/u,
  kn: /\p{Script=Kannada}/u,
  te: /\p{Script=Telugu}/u,
  zh: /\p{Script=Han}/u,
  ru: /\p{Script=Cyrillic}/u,
  ar: /\p{Script=Arabic}/u,
};

function localText(lang: string, text: string): boolean {
  if (lang === "id") return /\b(yang|dan|untuk|dengan|tidak|ini|dari|atau)\b/i.test(text);
  if (lang === "pt") return /[ãõçáéíóúâêô]/i.test(text) || /\b(não|para|qualidade|está|uma|dos)\b/i.test(text);
  const script = LOCAL_SCRIPT[lang];
  if (!script) return false;
  return script.test(text);
}

function workNote(lang: string, order: { summaryEn?: string; summaryLocal?: string | null } | null | undefined): string {
  if (!order) return "";
  if (lang !== "en") {
    if (order.summaryLocal && localText(lang, order.summaryLocal)) return order.summaryLocal;
    return WORK_MISSING[lang] ?? WORK_MISSING.en;
  }
  return order.summaryEn || "";
}

function toolText(lang: string, tool: string): string {
  const row = TOOL_TEXT[tool];
  if (!row) return lang === "en" ? tool : tool;
  return row[lang] ?? row.en;
}

function bandText(lang: string, band: string): string {
  const key = BAND_FROM_API[band];
  return key ? t(lang, key) : band;
}

const ACTION_FROM_BAND: Record<string, string> = {
  Good: "actionGood",
  Satisfactory: "actionSatisfactory",
  Moderate: "actionModerate",
  Poor: "actionPoor",
  "Very Poor": "actionVeryPoor",
  Severe: "actionSevere",
  good: "actionGood",
  sat: "actionSatisfactory",
  mod: "actionModerate",
  poor: "actionPoor",
  vp: "actionVeryPoor",
  severe: "actionSevere",
};

const MISS_LABEL: Record<string, string> = {
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

const AREA_LABEL: Record<string, string> = {
  en: "Area detail",
  hi: "क्षेत्र विवरण",
  mr: "क्षेत्र तपशील",
  bn: "এলাকার বিবরণ",
  ta: "பகுதி விவரம்",
  kn: "ಪ್ರದೇಶದ ವಿವರ",
  te: "ప్రాంత వివరం",
  zh: "区域详情",
  ru: "Данные района",
  ar: "تفاصيل المنطقة",
  id: "Detail wilayah",
  pt: "Detalhe da área",
};

function missLabel(lang: string): string {
  return MISS_LABEL[lang] ?? MISS_LABEL.en;
}

const SEND_FAIL: Record<string, string> = {
  en: "The report didn’t send. Try again.",
  hi: "रिपोर्ट नहीं भेजी जा सकी। फिर कोशिश करें।",
  mr: "अहवाल पाठवला गेला नाही. पुन्हा प्रयत्न करा.",
  bn: "রিপোর্ট পাঠানো যায়নি। আবার চেষ্টা করুন।",
  ta: "அறிக்கை அனுப்பப்படவில்லை. மீண்டும் முயலவும்.",
  kn: "ವರದಿ ಕಳುಹಿಸಲಾಗಲಿಲ್ಲ. ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ.",
  te: "నివేదిక పంపబడలేదు. మళ్లీ ప్రయత్నించండి.",
  zh: "报告没有发出。请再试一次。",
  ru: "Сообщение не отправилось. Попробуйте ещё раз.",
  ar: "لم يُرسل البلاغ. حاول مرة أخرى.",
  id: "Laporan tidak terkirim. Coba lagi.",
  pt: "O relato não foi enviado. Tente de novo.",
};

function sendFail(lang: string): string {
  return SEND_FAIL[lang] ?? SEND_FAIL.en;
}

const SUBMIT_CODE: Record<string, Record<string, string>> = {
  photo_missing: {
    en: "Add a photo before sending.",
    hi: "भेजने से पहले फ़ोटो जोड़ें।",
    mr: "पाठवण्यापूर्वी फोटो जोडा.",
    bn: "পাঠানোর আগে ছবি যোগ করুন।",
    ta: "அனுப்பும் முன் புகைப்படம் சேர்க்கவும்.",
    kn: "ಕಳುಹಿಸುವ ಮೊದಲು ಫೋಟೋ ಸೇರಿಸಿ.",
    te: "పంపే ముందు ఫోటో జోడించండి.",
    zh: "发送前请添加照片。",
    ru: "Добавьте фото перед отправкой.",
    ar: "أضف صورة قبل الإرسال.",
    id: "Tambahkan foto sebelum mengirim.",
    pt: "Adicione uma foto antes de enviar.",
  },
  outside_city: {
    en: "That pin is outside the selected city.",
    hi: "वह पिन चुने हुए शहर के बाहर है।",
    mr: "तो पिन निवडलेल्या शहराबाहेर आहे.",
    bn: "ওই পিন নির্বাচিত শহরের বাইরে।",
    ta: "அந்த ஊசி தேர்ந்தெடுத்த நகருக்கு வெளியே உள்ளது.",
    kn: "ಆ ಪಿನ್ ಆಯ್ಕೆಮಾಡಿದ ನಗರದ ಹೊರಗಿದೆ.",
    te: "ఆ పిన్ ఎంచుకున్న నగరానికి బయట ఉంది.",
    zh: "该钉在所选城市之外。",
    ru: "Метка вне выбранного города.",
    ar: "الدبوس خارج المدينة المختارة.",
    id: "Pin itu di luar kota yang dipilih.",
    pt: "Esse pino está fora da cidade escolhida.",
  },
  photo_required: {
    en: "A photo is required before the report can be sent.",
    hi: "रिपोर्ट भेजने से पहले फ़ोटो ज़रूरी है।",
    mr: "अहवाल पाठवण्यापूर्वी फोटो आवश्यक आहे.",
    bn: "রিপোর্ট পাঠাতে ছবি লাগবে।",
    ta: "அறிக்கை அனுப்ப புகைப்படம் தேவை.",
    kn: "ವರದಿ ಕಳುಹಿಸಲು ಫೋಟೋ ಬೇಕು.",
    te: "నివేదిక పంపడానికి ఫోటో అవసరం.",
    zh: "发送报告前需要照片。",
    ru: "Перед отправкой нужно фото.",
    ar: "الصورة مطلوبة قبل إرسال البلاغ.",
    id: "Foto wajib sebelum laporan dikirim.",
    pt: "A foto é obrigatória antes de enviar o relato.",
  },
  not_found: {
    en: "That report could not be found.",
    hi: "वह रिपोर्ट नहीं मिली।",
    mr: "तो अहवाल सापडला नाही.",
    bn: "সেই রিপোর্ট পাওয়া যায়নি।",
    ta: "அந்த அறிக்கை கிடைக்கவில்லை.",
    kn: "ಆ ವರದಿ ಸಿಗಲಿಲ್ಲ.",
    te: "ఆ నివేదిక దొరకలేదు.",
    zh: "找不到该报告。",
    ru: "Сообщение не найдено.",
    ar: "لم يُعثر على ذلك البلاغ.",
    id: "Laporan itu tidak ditemukan.",
    pt: "Esse relato não foi encontrado.",
  },
  unauthorized: {
    en: "You are not signed in for this action.",
    hi: "इस काम के लिए आप साइन इन नहीं हैं।",
    mr: "या कामासाठी तुम्ही साइन इन नाही.",
    bn: "এই কাজের জন্য আপনি সাইন ইন করেননি।",
    ta: "இந்தச் செயலுக்கு நீங்கள் உள்நுழையவில்லை.",
    kn: "ಈ ಕೆಲಸಕ್ಕೆ ನೀವು ಸೈನ್ ಇನ್ ಆಗಿಲ್ಲ.",
    te: "ఈ పనికి మీరు సైన్ ఇన్ కాలేదు.",
    zh: "此操作需要先登录。",
    ru: "Для этого действия нужен вход.",
    ar: "يلزم تسجيل الدخول لهذا الإجراء.",
    id: "Anda belum masuk untuk tindakan ini.",
    pt: "É preciso entrar para esta ação.",
  },
  rate_limited: {
    en: "Too many reports. Wait a moment and try again.",
    hi: "बहुत अधिक रिपोर्ट। थोड़ी देर रुककर फिर कोशिश करें।",
    mr: "खूप अहवाल. थोडा थांबून पुन्हा प्रयत्न करा.",
    bn: "অনেক বেশি রিপোর্ট। একটু অপেক্ষা করে আবার চেষ্টা করুন।",
    ta: "அதிக அறிக்கைகள். சிறிது காத்திருந்து மீண்டும் முயலவும்.",
    kn: "ತುಂಬಾ ವರದಿಗಳು. ಸ್ವಲ್ಪ ಕಾದು ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ.",
    te: "చాలా నివేదికలు. కాసేపు ఆగి మళ్లీ ప్రయత్నించండి.",
    zh: "报告太多。请稍等再试。",
    ru: "Слишком много сообщений. Подождите и попробуйте снова.",
    ar: "بلاغات كثيرة. انتظر قليلاً ثم أعد المحاولة.",
    id: "Terlalu banyak laporan. Tunggu sebentar lalu coba lagi.",
    pt: "Relatos demais. Espere um pouco e tente de novo.",
  },
};

function submitReason(lang: string, error: string): string | null {
  if (["photoRequired", "locationFailed"].some((key) => error === key || error === t(lang, key) || error === t("en", key))) {
    return shownError(lang, error);
  }
  for (const code of ["photo_missing", "photo_required", "outside_city", "rate_limited", "not_found", "unauthorized"]) {
    if (error === code || error.includes(code)) return SUBMIT_CODE[code][lang] ?? SUBMIT_CODE[code].en;
  }
  return null;
}

const PIN_CENTER: Record<string, string> = {
  en: "Move the report pin to the city center",
  hi: "रिपोर्ट पिन को शहर के केंद्र पर ले जाएँ",
  mr: "अहवाल पिन शहर केंद्रावर न्या",
  bn: "রিপোর্ট পিন শহরের কেন্দ্রে সরান",
  ta: "அறிக்கை ஊசியை நகர மையத்துக்கு நகர்த்து",
  kn: "ವರದಿ ಪಿನ್ ಅನ್ನು ನಗರ ಕೇಂದ್ರಕ್ಕೆ ಸರಿಸಿ",
  te: "నివేదిక పిన్‌ను నగర కేంద్రానికి జరపండి",
  zh: "把报告钉移到市中心",
  ru: "Переместить метку сообщения в центр города",
  ar: "انقل دبوس البلاغ إلى وسط المدينة",
  id: "Pindahkan pin laporan ke pusat kota",
  pt: "Mover o pino do relato para o centro da cidade",
};

function pinCenter(lang: string): string {
  return PIN_CENTER[lang] ?? PIN_CENTER.en;
}

const MODE_FAIL: Record<string, string> = {
  en: "Couldn’t switch data mode",
  hi: "डेटा मोड नहीं बदला जा सका",
  mr: "डेटा मोड बदलला नाही",
  bn: "ডেটা মোড বদলানো যায়নি",
  ta: "தரவு முறையை மாற்ற முடியவில்லை",
  kn: "ದತ್ತಾಂಶ ಸ್ಥಿತಿ ಬದಲಾಯಿಸಲಾಗಲಿಲ್ಲ",
  te: "డేటా మోడ్ మార్చలేకపోయాం",
  zh: "未能切换数据模式",
  ru: "Не удалось переключить режим данных",
  ar: "تعذّر تبديل وضع البيانات",
  id: "Tidak bisa mengganti mode data",
  pt: "Não foi possível mudar o modo de dados",
};

function modeFail(lang: string): string {
  return MODE_FAIL[lang] ?? MODE_FAIL.en;
}

const ZONE_OPEN: Record<string, string> = {
  en: "Station reading is not confirmed.",
  hi: "स्टेशन रीडिंग पुष्टि नहीं है।",
  mr: "स्टेशन वाचन निश्चित नाही.",
  bn: "স্টেশন রিডিং নিশ্চিত নয়।",
  ta: "நிலைய அளவு உறுதி இல்லை.",
  kn: "ಕೇಂದ್ರ ಓದು ದೃಢವಿಲ್ಲ.",
  te: "స్టేషన్ రీడింగ్ నిర్ధారణ కాలేదు.",
  zh: "站点读数未经确认。",
  ru: "Показание станции не подтверждено.",
  ar: "قراءة المحطة غير مؤكدة.",
  id: "Pembacaan stasiun belum terkonfirmasi.",
  pt: "A leitura da estação não está confirmada.",
};

const FEED_FAIL: Record<string, string> = {
  en: "The upstream feed failed.",
  hi: "अपस्ट्रीम फ़ीड विफल रहा।",
  mr: "अपस्ट्रीम फीड अयशस्वी.",
  bn: "আপস্ট্রিম ফিড ব্যর্থ।",
  ta: "மேல்நிலை ஊட்டம் தோல்வி.",
  kn: "ಮೇಲಿನ ಫೀಡ್ ವಿಫಲ.",
  te: "అప్‌స్ట్రీమ్ ఫీడ్ విఫలమైంది.",
  zh: "上游数据源失败。",
  ru: "Источник данных не сработал.",
  ar: "فشل مصدر البيانات.",
  id: "Umpan data gagal.",
  pt: "A fonte de dados falhou.",
};

function zoneUnconfirmed(lang: string): string {
  return ZONE_OPEN[lang] ?? ZONE_OPEN.en;
}

function dlqBody(item: Record<string, unknown>): Record<string, unknown> | null {
  const body = item.body;
  if (body && typeof body === "object") return body as Record<string, unknown>;
  if (typeof body !== "string" || !body.trim()) return null;
  try {
    const parsed = JSON.parse(body) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function dlqField(item: Record<string, unknown>, key: string): string {
  const own = item[key];
  if (typeof own === "string" && own) return own;
  const inner = dlqBody(item);
  const nested = inner?.[key];
  return typeof nested === "string" ? nested : "";
}

function dlqPlace(item: Record<string, unknown>, lang: string) {
  const h3 = dlqField(item, "h3");
  if (h3) return <Link className="mono" to={`/zones/${h3}`}>{h3}</Link>;
  const reportId = dlqField(item, "reportId");
  if (reportId) return <Link to={`/track/${reportId}`}>{reportId}</Link>;
  if (item.messageId != null && String(item.messageId)) return String(item.messageId);
  return NO_HEX[lang] ?? NO_HEX.en;
}

const DLQ_NO_DETAIL: Record<string, string> = {
  en: "This message failed. No detail was stored.",
  hi: "यह संदेश विफल रहा। कोई विवरण सहेजा नहीं गया।",
  mr: "हा संदेश अयशस्वी. तपशील जतन नाही.",
  bn: "এই বার্তা ব্যর্থ। কোনো বিবরণ নেই।",
  ta: "இந்தச் செய்தி தோல்வி. விவரம் இல்லை.",
  kn: "ಈ ಸಂದೇಶ ವಿಫಲ. ವಿವರ ಉಳಿಸಿಲ್ಲ.",
  te: "ఈ సందేశం విఫలమైంది. వివరాలు లేవు.",
  zh: "这条消息失败了。没有保存详情。",
  ru: "Сообщение не прошло. Подробностей нет.",
  ar: "فشلت هذه الرسالة. لا توجد تفاصيل.",
  id: "Pesan ini gagal. Tidak ada detail.",
  pt: "Esta mensagem falhou. Nenhum detalhe foi gravado.",
};

function ingestFail(lang: string): string {
  return FEED_FAIL[lang] ?? FEED_FAIL.en;
}

function failedFeedNames(health: Health | null): string[] {
  const feeds = health?.ingest?.feeds;
  const fromFeeds = feeds
    ? Object.entries(feeds).flatMap(([key, item]) => {
        if (item?.ok !== false) return [];
        const cut = key.lastIndexOf(":");
        return [cut >= 0 ? key.slice(cut + 1) : key];
      })
    : [];
  const err = health?.ingest?.lastError?.toLowerCase() ?? "";
  const named = ["openaq", "cpcb", "waqi", "demo"].filter((key) => err.includes(key) && !fromFeeds.includes(key));
  return [...fromFeeds, ...named];
}

function ingestBanner(health: Health | null, lang: string): string {
  const names = failedFeedNames(health).map((key) => sourceLabel(lang, key)).join(", ");
  const raw = health?.ingest?.lastError?.trim() ?? "";
  const detail = !raw || raw === "feedError" ? "" : raw;
  return [ingestFail(lang), names, detail].filter(Boolean).join(": ");
}

const REPLAY_FAIL: Record<string, string> = {
  en: "Replay failed. The server did not say why.",
  hi: "रीप्ले विफल। सर्वर ने कारण नहीं बताया।",
  mr: "रीप्ले अयशस्वी. सर्व्हरने कारण सांगितले नाही.",
  bn: "রিপ্লে ব্যর্থ। সার্ভার কারণ জানায়নি।",
  ta: "மீண்டும் இயக்கல் தோல்வி. சேவையகம் காரணம் சொல்லவில்லை.",
  kn: "ಮರುಪ್ಲೇ ವಿಫಲ. ಸರ್ವರ್ ಕಾರಣ ಹೇಳಲಿಲ್ಲ.",
  te: "రిప్లే విఫలమైంది. సర్వర్ కారణం చెప్పలేదు.",
  zh: "重放失败。服务器没有说明原因。",
  ru: "Повтор не удался. Сервер не назвал причину.",
  ar: "فشلت إعادة التشغيل. لم يذكر الخادم السبب.",
  id: "Pemutaran ulang gagal. Server tidak memberi alasan.",
  pt: "A repetição falhou. O servidor não disse por quê.",
};

const SOURCE_LABEL: Record<string, Record<string, string>> = {
  openaq: { en: "OpenAQ", hi: "ओपनएक्यू", mr: "ओपनएक्यू", bn: "ওপেনএকিউ", ta: "ஓபன்ஏக்யூ", kn: "ಓಪನ್‌ಎಕ್ಯೂ", te: "ఓపెన్ఏక్యూ", zh: "OpenAQ", ru: "OpenAQ", ar: "أوبن إيه كيو", id: "OpenAQ", pt: "OpenAQ" },
  cpcb: { en: "Pollution board", hi: "प्रदूषण बोर्ड", mr: "प्रदूषण मंडळ", bn: "দূষণ বোর্ড", ta: "மாசு வாரியம்", kn: "ಮಾಲಿನ್ಯ ಮಂಡಳಿ", te: "కాలుష్య బోర్డు", zh: "污染委员会", ru: "Совет по загрязнению", ar: "هيئة التلوث", id: "Dewan polusi", pt: "Conselho de poluição" },
  demo: { en: "Demo feed", hi: "डेमो फ़ीड", mr: "डेमो फीड", bn: "ডেমো ফিড", ta: "டெமோ ஊட்டம்", kn: "ಡೆಮೊ ಫೀಡ್", te: "డెమో ఫీడ్", zh: "演示数据", ru: "Демопоток", ar: "تغذية تجريبية", id: "Umpan demo", pt: "Fonte de demonstração" },
  waqi: { en: "World Air Quality Index", hi: "विश्व वायु गुणवत्ता सूचकांक", mr: "जागतिक हवा गुणवत्ता निर्देशांक", bn: "বিশ্ব বায়ুমান সূচক", ta: "உலக காற்றுத் தரச் சுட்டெண்", kn: "ವಿಶ್ವ ವಾಯು ಗುಣಮಟ್ಟ ಸೂಚ್ಯಂಕ", te: "ప్రపంచ వాయు నాణ్యత సూచిక", zh: "世界空气质量指数", ru: "Мировой индекс качества воздуха", ar: "مؤشر جودة الهواء العالمي", id: "Indeks Kualitas Udara Dunia", pt: "Índice Mundial de Qualidade do Ar" },
  gemini: { en: "Model", hi: "मॉडल", mr: "मॉडेल", bn: "মডেল", ta: "மாதிரி", kn: "ಮಾದರಿ", te: "మోడల్", zh: "模型", ru: "Модель", ar: "نموذج", id: "Model", pt: "Modelo" },
  heuristic: { en: "Rules", hi: "नियम", mr: "नियम", bn: "নিয়ম", ta: "விதிகள்", kn: "ನಿಯಮಗಳು", te: "నియమాలు", zh: "规则", ru: "Правила", ar: "قواعد", id: "Aturan", pt: "Regras" },
};

const UNKNOWN_FEED: Record<string, string> = {
  en: "Unknown feed", hi: "अज्ञात फ़ीड", mr: "अज्ञात फीड", bn: "অজানা ফিড", ta: "தெரியாத ஊட்டம்", kn: "ಅಜ್ಞಾತ ಫೀಡ್", te: "తెలియని ఫీడ్", zh: "未知数据源", ru: "Неизвестный источник", ar: "مصدر غير معروف", id: "Umpan tidak dikenal", pt: "Fonte desconhecida",
};

const NO_HEX: Record<string, string> = {
  en: "No grid cell", hi: "कोई ग्रिड सेल नहीं", mr: "ग्रिड सेल नाही", bn: "গ্রিড সেল নেই", ta: "கட்டம் இல்லை", kn: "ಗ್ರಿಡ್ ಸೆಲ್ ಇಲ್ಲ", te: "గ్రిడ్ సెల్ లేదు", zh: "没有网格", ru: "Нет ячейки сетки", ar: "لا توجد خلية", id: "Tidak ada sel grid", pt: "Sem célula",
};

export function sourceLabel(lang: string, source: string, hideRaw = false): string {
  const key = source.trim().toLowerCase();
  if (!key) return UNKNOWN_FEED[lang] ?? UNKNOWN_FEED.en;
  const row = SOURCE_LABEL[key];
  if (row) return row[lang] ?? row.en;
  return hideRaw ? (UNKNOWN_FEED[lang] ?? UNKNOWN_FEED.en) : source.trim();
}

const MODE_OK: Record<string, string> = {
  en: "Data mode switched.",
  hi: "डेटा मोड बदल गया।",
  mr: "डेटा मोड बदलला.",
  bn: "ডেটা মোড বদলেছে।",
  ta: "தரவு முறை மாறியது.",
  kn: "ದತ್ತಾಂಶ ಸ್ಥಿತಿ ಬದಲಾಯಿತು.",
  te: "డేటా మోడ్ మారింది.",
  zh: "数据模式已切换。",
  ru: "Режим данных переключён.",
  ar: "تم تبديل وضع البيانات.",
  id: "Mode data sudah diganti.",
  pt: "O modo de dados foi mudado.",
};

const REFRESH_FAIL: Record<string, string> = {
  en: "That action ran. The page did not refresh.",
  hi: "काम हो गया। पेज रिफ्रेश नहीं हुआ।",
  mr: "काम झाले. पान रिफ्रेश झाले नाही.",
  bn: "কাজ হয়েছে। পাতা রিফ্রেশ হয়নি।",
  ta: "செயல் முடிந்தது. பக்கம் புதுப்பிக்கவில்லை.",
  kn: "ಕೆಲಸ ಆಯಿತು. ಪುಟ ರಿಫ್ರೆಶ್ ಆಗಲಿಲ್ಲ.",
  te: "పని అయింది. పేజీ రిఫ్రెష్ కాలేదు.",
  zh: "操作已完成。页面没有刷新。",
  ru: "Действие выполнено. Страница не обновилась.",
  ar: "تم الإجراء. لم تتحدث الصفحة.",
  id: "Tindakan berjalan. Halaman tidak disegarkan.",
  pt: "A ação correu. A página não atualizou.",
};

const TRACK_LEAD: Record<string, string> = {
  en: "This page follows one report. It is not the form for a new report.",
  hi: "यह पेज एक रिपोर्ट का पालन करता है। यह नई रिपोर्ट का फ़ॉर्म नहीं है।",
  mr: "हे पान एका अहवालाचे आहे. हा नव्या अहवालाचा फॉर्म नाही.",
  bn: "এই পাতা একটি রিপোর্ট অনুসরণ করে। এটি নতুন রিপোর্টের ফর্ম নয়।",
  ta: "இந்தப் பக்கம் ஒரு அறிக்கையைப் பின்தொடரும். இது புதிய அறிக்கை படிவம் அல்ல.",
  kn: "ಈ ಪುಟ ಒಂದು ವರದಿಯನ್ನು ಹಿಂಬಾಲಿಸುತ್ತದೆ. ಇದು ಹೊಸ ವರದಿಯ ಫಾರ್ಮ್ ಅಲ್ಲ.",
  te: "ఈ పేజీ ఒక నివేదికను అనుసరిస్తుంది. ఇది కొత్త నివేదిక ఫారం కాదు.",
  zh: "此页跟踪一份报告，不是新报告的表单。",
  ru: "Эта страница следит за одним сообщением. Это не форма нового.",
  ar: "هذه الصفحة تتابع بلاغاً واحداً. ليست نموذج بلاغ جديد.",
  id: "Halaman ini mengikuti satu laporan. Ini bukan formulir laporan baru.",
  pt: "Esta página acompanha um relato. Não é o formulário de um relato novo.",
};

function modeOk(lang: string): string {
  return MODE_OK[lang] ?? MODE_OK.en;
}

function refreshFail(lang: string): string {
  return REFRESH_FAIL[lang] ?? REFRESH_FAIL.en;
}

function PageExits({ lang }: { lang: string }) {
  return (
    <div className="row">
      <Link to="/">{t(lang, "home")}</Link>
      <Link to="/map">{t(lang, "map")}</Link>
      <Link to="/report">{t(lang, "report")}</Link>
    </div>
  );
}

function OperatorSignIn({ lang, login }: { lang: string; login: (email: string, operator: boolean) => void }) {
  return (
    <form
      className="card"
      onSubmit={(event) => {
        event.preventDefault();
        const email = String(new FormData(event.currentTarget).get("email") ?? "").trim();
        if (email) login(email, true);
      }}
    >
      <p>{t(lang, "signInOperator")}</p>
      <label>
        {t(lang, "operatorEmail")}
        <input type="email" name="email" required autoComplete="email" />
      </label>
      <button type="submit" className="primary">{t(lang, "submit")}</button>
    </form>
  );
}

function trackLead(lang: string): string {
  return TRACK_LEAD[lang] ?? TRACK_LEAD.en;
}

function areaLabel(lang: string): string {
  return AREA_LABEL[lang] ?? AREA_LABEL.en;
}

function shownError(lang: string, message: string): string {
  for (const key of ["photoRequired", "locationFailed", "summaryHint", "feedError"]) {
    if (message === key || message === t(lang, key) || message === t("en", key)) return t(lang, key);
  }
  return message;
}

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

function kindText(lang: string, kind: string): string {
  if (kind === "fire") return t(lang, "fire");
  const row = KIND_TEXT[kind];
  return row ? (row[lang] ?? row.en) : kind;
}

const UNNAMED_UPWIND: Record<string, string> = {
  en: "Unnamed upwind source", hi: "अनाम हवा-स्रोत", mr: "निनावी वारा-स्रोत", bn: "নামহীন বায়ু উৎস", ta: "பெயரில்லா காற்று மூலம்", kn: "ಹೆಸರಿಲ್ಲದ ಗಾಳಿ ಮೂಲ", te: "పేరులేని గాలి మూలం", zh: "未命名上风向来源", ru: "Безымянный источник с наветра", ar: "مصدر رياح بلا اسم", id: "Sumber angin tanpa nama", pt: "Fonte de barlavento sem nome",
};

function upwindLabel(item: UpwindSource, lang: string): string {
  const name = item.name ?? item.id ?? (item.kind ? kindText(lang, item.kind) : (UNNAMED_UPWIND[lang] ?? UNNAMED_UPWIND.en));
  const kind = item.kind && item.name ? ` (${kindText(lang, item.kind)})` : "";
  const distance = item.distanceKm != null ? ` · ${item.distanceKm} ${t(lang, "km")}` : "";
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
      style: mapStyleUrl(),
      center: [startLng, startLat],
      zoom: 12,
    });
    const pin = document.createElement("button");
    pin.type = "button";
    pin.className = "pin report-pin";
    pin.setAttribute("aria-label", t(lang, "movePin"));
    const marker = new maplibregl.Marker({ element: pin, draggable: true }).setLngLat([startLng, startLat]).addTo(map);
    marker.on("dragend", () => {
      const next = marker.getLngLat();
      setLocationError(false);
      setLat(next.lat);
      setLng(next.lng);
    });
    mapObj.current = map;
    markerRef.current = marker;
    const root = document.documentElement;
    let current = mapStyleUrl();
    const observer = new MutationObserver(() => {
      const next = mapStyleUrl();
      if (next === current) return;
      current = next;
      map.setStyle(next);
    });
    observer.observe(root, { attributes: true, attributeFilter: ["data-theme"] });
    return () => {
      observer.disconnect();
      marker.remove();
      map.remove();
      mapObj.current = null;
      markerRef.current = null;
    };
  }, [city?.id, lang]);

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
      rememberTrack(created.reportId, { hazard: HAZARD_KEY[hazardType], city: city?.id });
      localStorage.setItem(`zephyr.closure.${created.reportId}`, created.closureToken);
      await api.uploadPhoto(created.reportId, file, created.uploadToken);
      if (voice) await api.uploadVoice(created.reportId, voice, created.uploadToken);
      await api.commitReport(created.reportId);
      onPhoto(null);
      setVoice(null);
      setNote("");
      setHazardType("smoke");
      setError(null);
      if (city) {
        setLat(city.center.lat);
        setLng(city.center.lng);
      }
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
        <p className="form-kicker">{t(lang, "citizenReport")}</p>
        <div className="report-map-col">
          <div ref={mapRef} className="report-map" />
          <p className="muted">{t(lang, "movePin")}</p>
          <Link to={`/zones/${latLngToCell(lat, lng, 8)}`}>{t(lang, "zoneLink")}</Link>
          <button type="button" onClick={locate} disabled={locating}>
            {locating ? t(lang, "locating") : t(lang, "useMyLocation")}
          </button>
          {locationError ? (
            <>
              <p className="error">{t(lang, "locationFailed")}</p>
              {city ? (
                <button type="button" onClick={() => { setLocationError(false); setLat(city.center.lat); setLng(city.center.lng); }}>
                  {pinCenter(lang)}
                </button>
              ) : null}
            </>
          ) : null}
          <details>
            <summary>{t(lang, "coordinates")}</summary>
            <label>
              {t(lang, "lat")}
              <input type="number" step="any" value={lat} onChange={(e) => { setLocationError(false); setLat(Number(e.target.value)); }} required />
            </label>
            <label>
              {t(lang, "lng")}
              <input type="number" step="any" value={lng} onChange={(e) => { setLocationError(false); setLng(Number(e.target.value)); }} required />
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
            {photoUrl ? <img className="report-preview" src={photoUrl} alt={file?.name || t(lang, "photo")} /> : null}
          </label>
          <label>
            {t(lang, "voiceOptional")}
            <input type="file" accept="audio/*" onChange={(e) => setVoice(e.target.files?.[0] ?? null)} />
          </label>
          {error ? <p className="error">{submitReason(lang, error) ?? sendFail(lang)}</p> : null}
          <button className="primary" type="submit" disabled={busy}>
            {busy ? t(lang, "submitting") : t(lang, "submit")}
          </button>
        </div>
      </form>
    </div>
  );
}

const QUEUE_STALE: Record<string, string> = {
  en: "Couldn’t refresh. The queue below may be out of date.",
  hi: "रिफ्रेश नहीं हो सका। नीचे की कतार पुरानी हो सकती है।",
  mr: "रिफ्रेश झाले नाही. खालील रांग जुनी असू शकते.",
  bn: "রিফ্রেশ হয়নি। নিচের সারি পুরনো হতে পারে।",
  ta: "புதுப்பிக்க முடியவில்லை. கீழுள்ள வரிசை பழையதாக இருக்கலாம்.",
  kn: "ರಿಫ್ರೆಶ್ ಆಗಲಿಲ್ಲ. ಕೆಳಗಿನ ಸರತಿ ಹಳೆಯದಾಗಿರಬಹುದು.",
  te: "రిఫ్రెష్ కాలేదు. కింది క్యూ పాతది కావచ్చు.",
  zh: "未能刷新。下面的队列可能已过期。",
  ru: "Не удалось обновить. Очередь ниже может быть устаревшей.",
  ar: "تعذّر التحديث. قد يكون الطابور أدناه قديماً.",
  id: "Tidak bisa menyegarkan. Antrean di bawah mungkin sudah lama.",
  pt: "Não foi possível atualizar. A fila abaixo pode estar desatualizada.",
};

const FIRST_NOTE: Record<string, string> = {
  en: "The status check hasn’t come back yet.",
  hi: "स्थिति जाँच अभी वापस नहीं आई।",
  mr: "स्थिती तपासणी अजून आली नाही.",
  bn: "অবস্থা যাচাই এখনও ফেরেনি।",
  ta: "நிலை சோதனை இன்னும் வரவில்லை.",
  kn: "ಸ್ಥಿತಿ ಪರಿಶೀಲನೆ ಇನ್ನೂ ಬಂದಿಲ್ಲ.",
  te: "స్థితి తనిఖీ ఇంకా రాలేదు.",
  zh: "状态检查还没返回。",
  ru: "Проверка статуса ещё не вернулась.",
  ar: "لم يعد فحص الحالة بعد.",
  id: "Pemeriksaan status belum kembali.",
  pt: "A verificação do estado ainda não voltou.",
};

const REFRESH_NOTE: Record<string, string> = {
  en: "Checking this report paused. The status below is still the last one saved.",
  hi: "इस रिपोर्ट की जाँच रुकी है। नीचे की स्थिति आखिरी सहेजी हुई है।",
  mr: "या अहवालाची तपासणी थांबली. खालील स्थिती शेवटची जतन केलेली आहे.",
  bn: "এই রিপোর্টের যাচাই থেমেছে। নিচের অবস্থা শেষ সংরক্ষিত অবস্থা।",
  ta: "இந்த அறிக்கையின் சோதனை நின்றது. கீழுள்ள நிலை கடைசியாக சேமித்தது.",
  kn: "ಈ ವರದಿಯ ಪರಿಶೀಲನೆ ನಿಂತಿದೆ. ಕೆಳಗಿನ ಸ್ಥಿತಿ ಕೊನೆಯದಾಗಿ ಉಳಿಸಿದ್ದು.",
  te: "ఈ నివేదిక తనిఖీ ఆగింది. కింది స్థితి చివరిగా సేవ్ అయినది.",
  zh: "这份报告的检查暂停了。下面仍是上次保存的状态。",
  ru: "Проверка этого сообщения на паузе. Статус ниже — последний сохранённый.",
  ar: "توقف فحص هذا البلاغ. الحالة أدناه هي آخر حالة محفوظة.",
  id: "Pemeriksaan laporan ini jeda. Status di bawah masih yang terakhir tersimpan.",
  pt: "A verificação deste relato pausou. O estado abaixo ainda é o último gravado.",
};

export function TrackPage({ cityId }: { cityId: string }) {
  const lang = useLang();
  const { id } = useParams();
  const [data, setData] = useState<ReportView | null>(null);
  const [trackError, setTrackError] = useState<string | null>(null);
  const [closureError, setClosureError] = useState<string | null>(null);
  const [trackAttempt, setTrackAttempt] = useState(0);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  void cityId;

  useEffect(() => {
    setData(null);
    setTrackError(null);
    setClosureError(null);
    if (!id) return;
    let timer = 0;
    const load = () =>
      api
        .getReport(id)
        .then((view) => {
          setLoadedFor(id);
          setData(view);
          setTrackError(null);
          const hazard = view.report.classification?.hazardType;
          const hazardKey = hazard && hazard in HAZARD_KEY ? HAZARD_KEY[hazard as (typeof HAZARDS)[number]] : undefined;
          if (id) rememberTrack(id, { hazard: hazardKey, city: view.report.cityId });
        })
        .catch((err: Error) => {
          setTrackError(err.message || "paused");
        });
    load();
    timer = window.setInterval(load, 2000);
    return () => window.clearInterval(timer);
  }, [id, lang, trackAttempt]);

  const view = loadedFor === id ? data : null;

  if (!id) return <Status>{t(lang, "loading")}</Status>;
  if (!view) {
    return (
      <div className="stack">
        <PageHead kicker={t(lang, "status")} title={t(lang, "trackTitle", { id: id.slice(0, 8) })} />
        <div className="row">
          <Link to="/">{t(lang, "home")}</Link>
          <Link to="/map">{t(lang, "map")}</Link>
          <Link to="/report">{t(lang, "report")}</Link>
        </div>
        {trackError ? (
          <div className="card">
            <p className="status">{submitReason(lang, trackError) ?? (FIRST_NOTE[lang] ?? FIRST_NOTE.en)}</p>
            <button type="button" onClick={() => setTrackAttempt((n) => n + 1)}>{retryLabel(lang)}</button>
          </div>
        ) : (
          <Status>{t(lang, "loading")}</Status>
        )}
      </div>
    );
  }
  const token = localStorage.getItem(`zephyr.closure.${id}`);
  const closure = view.incident?.closure;
  const classification = view.report.classification;

  return (
    <div className="stack">
      <PageHead kicker={t(lang, "status")} title={id ? t(lang, "trackTitle", { id: id.slice(0, 8) }) : t(lang, "status")} />
      <div className="row">
        <Link to="/">{t(lang, "home")}</Link>
        <Link to="/map">{t(lang, "map")}</Link>
        <Link to="/report">{t(lang, "report")}</Link>
      </div>
      <p className="track-banner" role="status">{trackLead(lang)}</p>
      <div className="card track-status-card">
        {trackError ? <p className="status" role="status">{REFRESH_NOTE[lang] ?? REFRESH_NOTE.en}</p> : null}
        <p className="track-status">{enumText(lang, view.report.status)}</p>
        <p className="muted">{t(lang, "report")}: {view.report.id ?? id}</p>
        <p>
          <Link to={`/zones/${view.report.h3}`}>{t(lang, "zoneLink")}</Link>
        </p>
        {classification ? (
          <div>
            <h3>{t(lang, "classification")}</h3>
            <ul className="facts">
              {classification.hazardType ? (
                <li>
                  {t(lang, "hazard")}: {HAZARD_KEY[classification.hazardType as (typeof HAZARDS)[number]]
                    ? t(lang, HAZARD_KEY[classification.hazardType as (typeof HAZARDS)[number]])
                    : t(lang, "other")}
                </li>
              ) : null}
              {classification.severity ? (
                <li>
                  {t(lang, "severity")}: {enumText(lang, classification.severity)}
                </li>
              ) : null}
              {classification.confidence != null ? (
                <li>
                  {t(lang, "confidence")}: {Math.round(classification.confidence * 100)}%
                </li>
              ) : null}
              {classification.source ? (
                <li>
                  {t(lang, "source")}: {sourceLabel(lang, classification.source, true)}
                </li>
              ) : null}
            </ul>
          </div>
        ) : null}
        {view.incident ? (
          <p>
            {t(lang, "incident")} <Link to={`/zones/${view.incident.h3}`}>{enumText(lang, view.incident.status)}</Link>
            {view.incident.reason ? ` · ${reasonText(lang, view.incident.reason)}` : null}
          </p>
        ) : null}
      </div>
      {closure?.open && token ? (
        <div className="card row">
          <span>{t(lang, "isFixed")}</span>
          <button
            type="button"
            className="primary"
            onClick={() => {
              setClosureError(null);
              api.closure(id, token, "FIXED").then(() => api.getReport(id).then(setData)).catch((err: Error) => setClosureError(submitReason(lang, err.message) ?? sendFail(lang)));
            }}
          >
            {t(lang, "fixedDone")}
          </button>
          <button
            type="button"
            className="danger"
            onClick={() => {
              setClosureError(null);
              api.closure(id, token, "STILL").then(() => api.getReport(id).then(setData)).catch((err: Error) => setClosureError(submitReason(lang, err.message) ?? sendFail(lang)));
            }}
          >
            {t(lang, "stillThereLabel")}
          </button>
          {closureError ? <p className="error">{closureError}</p> : null}
        </div>
      ) : null}
    </div>
  );
}

export function ZonePage({ cityId, auth, login }: { cityId: string; auth: Auth | null; login: (email: string, operator: boolean) => void }) {
  const lang = useLang();
  const { h3 = "" } = useParams();
  const canSpeak = useSpeechReady(lang);
  const [zone, setZone] = useState<ZoneView | null>(null);
  const [forecast, setForecast] = useState<ForecastView | null>(null);
  const [forecastFailed, setForecastFailed] = useState(false);
  const [healthFailed, setHealthFailed] = useState(false);
  const [brief, setBrief] = useState("");
  const [health, setHealth] = useState<Record<string, unknown> | null>(null);
  const [subscribed, setSubscribed] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [zoneError, setZoneError] = useState<string | null>(null);
  const [zoneAttempt, setZoneAttempt] = useState(0);
  const [shownH3, setShownH3] = useState(h3);
  if (h3 !== shownH3) {
    setShownH3(h3);
    setZone(null);
    setBrief("");
    setForecast(null);
    setHealth(null);
    setForecastFailed(false);
    setHealthFailed(false);
  }

  useEffect(() => {
    if (!h3) return;
    setZone(null);
    setZoneError(null);
    setSubscribed(false);
    setForecast(null);
    setHealth(null);
    setBrief("");
    setForecastFailed(false);
    setHealthFailed(false);
    let stop = false;
    api.zone(h3).then((next) => { if (!stop) setZone(next); }).catch((err: Error) => { if (!stop) setZoneError(err.message); });
    api.forecast(h3, cityId).then((next) => {
      if (stop) return;
      setForecast(next);
      setForecastFailed(false);
    }).catch(() => {
      if (!stop) setForecastFailed(true);
    });
    api.brief(h3, lang).then((b) => { if (!stop) setBrief(briefForLang(lang, b.text || "")); }).catch(() => { if (!stop) setBrief(briefFallback(lang)); });
    api.zoneHealth(h3, lang).then((next) => {
      if (stop) return;
      setHealth(next);
      setHealthFailed(false);
    }).catch(() => {
      if (!stop) setHealthFailed(true);
    });
    return () => {
      stop = true;
    };
  }, [h3, cityId, lang, zoneAttempt]);

  if (h3 !== shownH3 || zoneError || !zone) {
    return (
      <div className="stack">
        <PageHead kicker={t(lang, "map")} title={t(lang, "thisArea")} />
        <PageExits lang={lang} />
        {zoneError ? (
          <div className="card">
            <p className="error">{missLabel(lang)}</p>
            <button type="button" onClick={() => setZoneAttempt((n) => n + 1)}>{retryLabel(lang)}</button>
          </div>
        ) : (
          <Status>{t(lang, "loading")}</Status>
        )}
      </div>
    );
  }

  const station = zone.nearestStation;
  const distance =
    zone.distanceKm == null
      ? null
      : `${station?.name ?? t(lang, "nearest")} · ${t(lang, "aqi")} ${station?.aqi ?? "—"} · ${zone.distanceKm.toFixed(1)} ${t(lang, "km")}`;
  const upwind = (zone.incidents ?? []).flatMap((i) => i.upwind ?? []);
  const advisory = zone.advisory;
  const missingSatellite = satelliteAbsent(zone) || satelliteAbsent(health);

  return (
    <div className="stack">
      <PageHead
        kicker={t(lang, "map")}
        title={station?.name ? t(lang, "areaNear", { name: station.name }) : t(lang, "thisArea")}
      />
      <div className="card">
        {zone.surface?.publishedAqi != null ? (
          <p>
            {t(lang, "aqi")} {Math.round(zone.surface.publishedAqi)}
            {" · "}
            {sourceLabel(lang, "gemini")} {zone.surface.modelAqi == null ? "—" : Math.round(zone.surface.modelAqi)}
          </p>
        ) : null}
        <p className={forecastFailed || healthFailed ? "status" : undefined}>
          {forecastFailed || healthFailed
            ? `${station?.name ?? t(lang, "nearest")}: ${zoneUnconfirmed(lang)}`
            : `${t(lang, "nearest")}: ${distance ?? t(lang, "noStation")}`}
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
              onClick={() => {
                setActionError(null);
                api.subscribe(auth, { h3, cityId, channels: ["in_app", "email"] }).then(() => setSubscribed(true)).catch(() => setActionError(missLabel(lang)));
              }}
            >
              {subscribed ? t(lang, "subscribed") : t(lang, "subscribe")}
            </button>
          ) : (
            <div className="stack">
              <p className="muted">{t(lang, "signInToSubscribe")}</p>
              <button type="button" onClick={() => login("resident@zephyr.local", false)}>{t(lang, "signInAction")}</button>
            </div>
          )}
        </div>
        {subscribed ? <p className="subscribe-line">{t(lang, "subscribedLine")}</p> : null}
        {actionError ? <p className="error">{actionError}</p> : null}
        {healthFailed || forecastFailed ? (
          <p className="error">
            {missLabel(lang)}: {[healthFailed ? areaLabel(lang) : null, forecastFailed ? t(lang, "forecast") : null].filter(Boolean).join(", ")}{" "}
            <button
              type="button"
              onClick={() => {
                setForecastFailed(false);
                setHealthFailed(false);
                api.forecast(h3, cityId).then((next) => {
                  setForecast(next);
                  setForecastFailed(false);
                }).catch(() => {
                  setForecastFailed(true);
                });
                api.zoneHealth(h3, lang).then((next) => {
                  setHealth(next);
                  setHealthFailed(false);
                }).catch(() => {
                  setHealthFailed(true);
                });
              }}
            >
              {retryLabel(lang)}
            </button>
          </p>
        ) : null}
        {missingSatellite ? <p className="muted">{t(lang, "satelliteMissing")}</p> : null}
      </div>
      <div className="card">
        <h3>{t(lang, "upwind")}</h3>
        {upwind.length ? (
          <ul className="facts">
            {upwind.map((item, i) => (
              <li key={`${item.id ?? item.name ?? "src"}-${i}`}>{upwindLabel(item, lang)}</li>
            ))}
          </ul>
        ) : (
          <p className="muted">—</p>
        )}
      </div>
      {advisory ? (
        <div className="card">
          <h3>
            {advisory.band ? `${t(lang, "groupAdvisory")} · ${bandText(lang, advisory.band)}` : t(lang, "groupAdvisory")}
          </h3>
          {advisory.band && ACTION_FROM_BAND[advisory.band] ? <p>{t(lang, ACTION_FROM_BAND[advisory.band])}</p> : null}
          <ul className="facts">
            {Object.entries(advisory.groups ?? {}).map(([k, v]) => (
              <li key={k}>
                {groupLabel(lang, k)}: {groupAdvice(lang, advisory.band ?? "", k, String(v ?? ""))}
              </li>
            ))}
          </ul>
          {advisory.attribution ? <p className="muted">{advisoryNote(lang, advisory.attribution)}</p> : null}
        </div>
      ) : null}
      <div className="card">
        <h3>{t(lang, "forecast")}</h3>
        <div className="methods">
          {forecast ? (
            <>
          <MethodChip lang={lang} name={t(lang, "forecastPersistence")} block={forecast.persistence} />
          <MethodChip lang={lang} name={t(lang, "forecastModelled")} block={forecast.modelled} />
          <MethodChip lang={lang} name={t(lang, "forecastArima")} block={forecast.arima} />
            </>
          ) : null}
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
  const [diaryState, setDiaryState] = useState<"loading" | "ready" | "error">("loading");
  const [diaryError, setDiaryError] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);
  const [geoFailed, setGeoFailed] = useState(false);
  const city = cities.find((item) => item.id === cityId);

  const [diaryAttempt, setDiaryAttempt] = useState(0);

  useEffect(() => {
    if (!auth) return;
    setDiaryState("loading");
    setDiaryError(null);
    api.diary(auth).then((view) => {
      setData(view);
      setDiaryState("ready");
    }).catch(() => {
      setDiaryError(missLabel(lang));
      setDiaryState("error");
    });
  }, [auth, lang, diaryAttempt]);

  if (!auth) {
    return (
      <div className="stack">
        <PageHead kicker={city?.name ?? ""} title={t(lang, "diary")} />
        <div className="card diary-gate">
          <p>{t(lang, "signInDiary")}</p>
          <button type="button" onClick={() => login("resident@zephyr.local", false)}>
            {t(lang, "signInAction")}
          </button>
        </div>
      </div>
    );
  }

  const bands = Object.entries(data?.hoursByBand ?? {});
  const gaps = data?.gaps ?? [];

  const saveHome = (lat: number, lng: number) => {
    setGeoFailed(false);
    setDiaryState("loading");
    setDiaryError(null);
    api.setDiary(auth, { cityId, lat, lng }).then(() => api.diary(auth).then((view) => {
      setData(view);
      setDiaryState("ready");
    })).catch(() => {
      setDiaryError(missLabel(lang));
      setDiaryState("error");
    });
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
        {diaryState === "loading" ? <Status>{t(lang, "loading")}</Status> : diaryState === "error" ? (
          <p className="error">
            {missLabel(lang)}{" "}
            <button type="button" onClick={() => setDiaryAttempt((n) => n + 1)}>{retryLabel(lang)}</button>
          </p>
        ) : (
          <>
            <h3>{t(lang, "hoursTitle")}</h3>
            {bands.length ? (
              <table>
                <tbody>
                  {bands.map(([band, hours]) => (
                    <tr key={band}>
                      <td>{bandText(lang, band)}</td>
                      <td className="num">{hours}</td>
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
          </>
        )}
      </div>
    </div>
  );
}

export function OperatorPage({ auth, cityId, cities, login }: { auth: Auth | null; cityId: string; cities: City[]; login: (email: string, operator: boolean) => void }) {
  const lang = useLang();
  const [incidents, setIncidents] = useState<OperatorIncident[]>([]);
  const [queueState, setQueueState] = useState<"loading" | "ready" | "error">("loading");
  const [queueError, setQueueError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [pending, setPending] = useState<{ id: string; action: string; message: string } | null>(null);
  const [question, setQuestion] = useState("");
  const [lastQuestion, setLastQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [toolsUsed, setToolsUsed] = useState<string[]>([]);
  const [copilotOpen, setCopilotOpen] = useState(false);
  const [copilotBusy, setCopilotBusy] = useState(false);
  const reload = () => {
    if (!auth?.operator) return Promise.resolve();
    return api.incidents(auth).then((r) => {
      setIncidents(r.incidents);
      setQueueError(null);
      setQueueState("ready");
    }).catch(() => {
      setQueueError(missLabel(lang));
      setQueueState((state) => (state === "ready" ? "ready" : "error"));
    });
  };

  useEffect(() => {
    if (!auth?.operator) return;
    reload().catch(console.error);
  }, [auth]);

  useEffect(() => {
    if (!copilotOpen) return;
    const panel = document.getElementById("operator-copilot-panel");
    const focusable = () => {
      if (!panel) return [];
      return [...panel.querySelectorAll<HTMLElement>("button, [href], input, textarea, select")].filter((el) => !el.hasAttribute("disabled"));
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setCopilotOpen(false);
      if (event.key !== "Tab") return;
      const items = focusable();
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    focusable()[0]?.focus();
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
      const r = await api.copilot(auth, text, lang);
      setAnswer(r.answer);
      setToolsUsed(r.toolsUsed);
    } catch (err) {
      setAnswer(missLabel(lang));
      setToolsUsed([]);
    } finally {
      setCopilotBusy(false);
    }
  };

  if (!auth?.operator) {
    return (
      <div className="stack">
        <PageHead kicker={t(lang, "queue")} title={t(lang, "operator")} />
        <PageExits lang={lang} />
        <OperatorSignIn lang={lang} login={login} />
      </div>
    );
  }

  const cityQueue = incidents.filter((i) => i.cityId === cityId);

  const confirmAction = (id: string, action: string, message: string) => {
    setPending({ id, action, message });
  };
  const runPending = () => {
    if (!pending) return;
    const next = pending;
    setPending(null);
    setActionError(null);
    void api.incidentAction(auth, next.id, next.action).then(reload).catch(() => setActionError(missLabel(lang)));
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
        {queueState === "loading" ? <Status>{t(lang, "loading")}</Status> : null}
        {queueError ? (
          <p className={queueState === "ready" ? "muted" : "error"}>
            {queueState === "ready" ? (QUEUE_STALE[lang] ?? QUEUE_STALE.en) : missLabel(lang)}{" "}
            <button type="button" onClick={() => { setQueueState((state) => (state === "ready" ? "ready" : "loading")); void reload(); }}>{retryLabel(lang)}</button>
          </p>
        ) : null}
        {pending ? (
          <div className="row">
            <p>{pending.message}</p>
            <button type="button" className="primary" onClick={runPending}>{t(lang, "submit")}</button>
            <button type="button" onClick={() => setPending(null)}>{t(lang, "close")}</button>
          </div>
        ) : null}
        {actionError ? <p className="error">{actionError}</p> : null}
        {queueState === "ready" && cityQueue.length === 0 ? <p className="muted">{enumText(lang, "queue_empty")}</p> : null}
        {queueState === "ready" && cityQueue.length > 0 ? <div className="table-wrap">
          <table className="incident-table">
            <thead>
              <tr>
                <th>{t(lang, "city")}</th>
                <th>{t(lang, "hex")}</th>
                <th>{t(lang, "status")}</th>
                <th>{t(lang, "reason")}</th>
                <th>{t(lang, "flags")}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {cityQueue.map((i) => (
                <tr key={i.id}>
                  <td data-label={t(lang, "city")}>{cities.find((city) => city.id === i.cityId)?.name ?? i.cityId ?? "—"}</td>
                  <td data-label={t(lang, "hex")}>
                    {i.h3 ? <Link className="mono" to={`/zones/${i.h3}`}>{i.h3}</Link> : (NO_HEX[lang] ?? NO_HEX.en)}
                  </td>
                  <td data-label={t(lang, "status")}><span className="badge">{enumText(lang, i.status)}</span></td>
                  <td data-label={t(lang, "reason")}>
                    {reasonText(lang, i.reason)}
                    {workNote(lang, i.workOrder) ? <div className="muted">{workNote(lang, i.workOrder)}</div> : null}
                  </td>
                  <td data-label={t(lang, "flags")}>
                    {i.repeat ? <span className="badge warn">{t(lang, "repeat")}</span> : null}
                    {i.overdue ? <span className="badge bad">{t(lang, "overdue")}</span> : null}
                    {i.status === "disputed" ? <span className="badge bad">{t(lang, "disputed")}</span> : null}
                  </td>
                  <td className="row-actions">
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
        </div> : null}
      </div>
      {copilotOpen ? (
        <>
          <button
            type="button"
            className="copilot-scrim"
            tabIndex={-1}
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
                          <span key={tool} className="badge demo">{toolText(lang, tool)}</span>
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

export function PipelinePage({ auth, cityId, cities, login }: { auth: Auth | null; cityId: string; cities: City[]; login: (email: string, operator: boolean) => void }) {
  const lang = useLang();
  const [items, setItems] = useState<Array<Record<string, unknown>>>([]);
  const [health, setHealth] = useState<Health | null>(null);
  const [modeBusy, setModeBusy] = useState(false);
  const [tickBusy, setTickBusy] = useState(false);
  const [tickNote, setTickNote] = useState<string | null>(null);
  const [modeNote, setModeNote] = useState<string | null>(null);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [tickError, setTickError] = useState<string | null>(null);
  const [modeError, setModeError] = useState<string | null>(null);
  const [pipeState, setPipeState] = useState<"loading" | "ready" | "error">("loading");
  const [pipeError, setPipeError] = useState<string | null>(null);
  const [replayError, setReplayError] = useState<string | null>(null);
  void cityId;

  const reload = async () => {
    if (!auth?.operator) return;
    const [dlq, nextHealth] = await Promise.all([api.dlq(auth), api.health()]);
    setItems(dlq.items);
    setHealth(nextHealth);
    setPipeState("ready");
  };

  useEffect(() => {
    if (!auth?.operator) return;
    reload().catch((err: Error) => {
      setPipeError(err.message);
      setPipeState("error");
    });
  }, [auth]);

  if (!auth?.operator) {
    return (
      <div className="stack">
        <PageHead kicker={t(lang, "live")} title={t(lang, "pipeline")} />
        <PageExits lang={lang} />
        {auth && !auth.operator ? <p className="status">{t(lang, "operatorNotAllowed")}</p> : null}
        <OperatorSignIn lang={lang} login={login} />
      </div>
    );
  }

  const mode = health?.dataMode === "live" || health?.dataMode === "demo" ? health.dataMode : null;

  const setDataMode = async (next: "demo" | "live") => {
    if (!mode || next === mode || modeBusy) return;
    setTickError(null);
    setModeError(null);
    setModeNote(null);
    setRefreshError(null);
    setModeBusy(true);
    try {
      await api.setMode(auth, next);
    } catch (err) {
      setModeError("failed");
      setModeBusy(false);
      return;
    }
    try {
      await reload();
      setModeNote(modeOk(lang));
      setRefreshError(null);
    } catch (err) {
      setModeNote(modeOk(lang));
      setRefreshError("failed");
    } finally {
      setModeBusy(false);
    }
  };

  const runTick = async () => {
    setTickError(null);
    setModeError(null);
    setTickNote(null);
    setModeNote(null);
    setRefreshError(null);
    setTickBusy(true);
    try {
      await api.tick(auth);
    } catch (err) {
      setTickError("failed");
      setTickBusy(false);
      return;
    }
    try {
      await reload();
      setTickNote(t(lang, "tickDone"));
      setRefreshError(null);
    } catch (err) {
      setTickNote(t(lang, "tickDone"));
      setRefreshError("failed");
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
      {tickNote ? <p className="status">{refreshError ? `${tickNote} ${refreshFail(lang)}` : tickNote}</p> : null}
      {modeNote ? <p className="status">{refreshError ? `${modeNote} ${refreshFail(lang)}` : modeNote}</p> : null}
      {tickError ? <p className="error">{t(lang, "tickFailed")}</p> : null}
      {modeError ? <p className="error">{modeFail(lang)}</p> : null}
      {health?.ingest?.lastSuccessAt ? (
        <p className="muted">
          {t(lang, "lastIngest")}: {formatWhen(health.ingest.lastSuccessAt, lang)}
        </p>
      ) : null}
      {health?.ingest?.lastError ? (
        <p className="error">{ingestBanner(health, lang)}</p>
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
                      <td>{cities.find((city) => city.id === cityId)?.name ?? cityId}</td>
                      <td className="num">{count}</td>
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
                        <td>{cities.find((city) => city.id === feedCity)?.name ?? feedCity}</td>
                        <td>{sourceLabel(lang, source)}</td>
                        <td><span className={feed.ok ? "badge live" : "badge bad"}>{feed.ok ? t(lang, "ingestFeedOk") : t(lang, "ingestFeedFail")}</span></td>
                        <td className="num">{feed.count}</td>
                        <td>{feed.ok ? "" : (feed.error?.trim() || (DLQ_NO_DETAIL[lang] ?? DLQ_NO_DETAIL.en))}</td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
      {pipeState === "loading" ? <Status>{t(lang, "loading")}</Status> : null}
      {pipeState === "error" ? (
        <p className="error">
          {pipeError && pipeError !== "failed" ? `${ingestFail(lang)}: ${pipeError}` : ingestFail(lang)}{" "}
          <button type="button" onClick={() => { setPipeState("loading"); void reload().catch((err: Error) => { setPipeError(err.message); setPipeState("error"); }); }}>{retryLabel(lang)}</button>
        </p>
      ) : null}
      {pipeState === "ready" ? <div className="card">
        <h2>{t(lang, "dlq")}</h2>
        <p className="muted">{t(lang, "dlqHint")}</p>
        {replayError ? <p className="error">{replayError === "failed" ? (REPLAY_FAIL[lang] ?? REPLAY_FAIL.en) : replayError}</p> : null}
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
                  <td>{dlqPlace(i, lang)}</td>
                  <td>{i.error ? String(i.error) : (DLQ_NO_DETAIL[lang] ?? DLQ_NO_DETAIL.en)}</td>
                  <td>{formatWhen(typeof i.failedAt === "string" ? i.failedAt : null, lang)}</td>
                  <td>
                    <button type="button" onClick={() => {
                      setReplayError(null);
                      api.replay(auth, String(i.messageId)).then(reload).catch((err: Error) => setReplayError(err.message || "failed"));
                    }}>
                      {t(lang, "replay")}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div> : null}
    </div>
  );
}
