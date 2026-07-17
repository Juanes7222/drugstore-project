/**
 * i18n configuration — Pharmacy POS Terminal.
 * Spanish by default, English available.
 *
 * Single translation namespace. All keys are accessed through the
 * full path — e.g. t('config.tabs.company'), t('common.cancel').
 * Components never use a custom namespace (no useTranslation('config')).
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
