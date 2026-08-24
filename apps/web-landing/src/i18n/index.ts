import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import es from './locales/es.json';

/**
 * Spanish is the only locale in scope: the product sells to Colombian
 * drugstores. Add a resource bundle here before registering a new language.
 */
void i18n.use(initReactI18next).init({
  lng: 'es',
  fallbackLng: 'es',
  resources: { es: { translation: es } },
  // FAQ items, pillars and legal sections are structured arrays — read them
  // with `t('key', { returnObjects: true })`.
  returnObjects: true,
  interpolation: { escapeValue: false },
});

export default i18n;
