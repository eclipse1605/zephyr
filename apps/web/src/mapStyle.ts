const LIGHT = "https://tiles.openfreemap.org/styles/positron";
const DARK = "https://tiles.openfreemap.org/styles/dark";

export const MAP_DARK = DARK;

export function mapStyleUrl(): string {
  return document.documentElement.dataset.theme === "dark" ? DARK : LIGHT;
}

const RETRY_LABEL: Record<string, string> = {
  en: "Retry",
  hi: "फिर कोशिश करें",
  mr: "पुन्हा प्रयत्न",
  bn: "আবার চেষ্টা",
  ta: "மீண்டும் முயலவும்",
  kn: "ಮತ್ತೆ ಪ್ರಯತ್ನ",
  te: "మళ్లీ ప్రయత్నించండి",
  zh: "重试",
  ru: "Повторить",
  ar: "إعادة المحاولة",
  id: "Coba lagi",
  pt: "Tentar de novo",
};

export function retryLabel(lang: string): string {
  return RETRY_LABEL[lang] ?? RETRY_LABEL.en;
}
