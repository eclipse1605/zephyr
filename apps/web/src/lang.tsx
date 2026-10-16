import { createContext, useContext } from "react";

export const LangContext = createContext<{ lang: string; setLang: (lang: string) => void }>({
  lang: "en",
  setLang: () => {},
});

export function useLang(): string {
  return useContext(LangContext).lang;
}
