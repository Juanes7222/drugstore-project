/**
 * i18n configuration — Pharmacy POS Terminal.
 * Spanish by default, English available.
 */
import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import es from "./locales/es.json";
import en from "./locales/en.json";

const resources = {
  es: { translation: es },
  en: { translation: en },
};

i18n.use(initReactI18next).init({
  resources,
  lng: "es",
  fallbackLng: "es",
  interpolation: {
    escapeValue: false, // React already escapes output
  },
  react: {
    useSuspense: false,
  },
});

export default i18n;
