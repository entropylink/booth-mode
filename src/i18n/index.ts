// i18next wiring. es-MX is the default — this app is used at Mexican fairs
// (plan.md §8). EN is complete at every release; no hardcoded UI strings.

import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import en from "./locales/en.json";
import es from "./locales/es.json";

const LANG_KEY = "booth-mode.lang";

export const SUPPORTED_LANGS = ["es", "en"] as const;
export type Lang = (typeof SUPPORTED_LANGS)[number];

function initialLang(): Lang {
  if (typeof localStorage !== "undefined") {
    const saved = localStorage.getItem(LANG_KEY);
    if (saved === "es" || saved === "en") return saved;
  }
  return "es";
}

void i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    es: { translation: es },
  },
  lng: initialLang(),
  fallbackLng: "es",
  interpolation: { escapeValue: false },
});

export function setLang(lang: Lang): void {
  void i18n.changeLanguage(lang);
  if (typeof localStorage !== "undefined") localStorage.setItem(LANG_KEY, lang);
  if (typeof document !== "undefined") document.documentElement.lang = lang;
}

export function toggleLang(): void {
  setLang(i18n.language === "es" ? "en" : "es");
}

export default i18n;
