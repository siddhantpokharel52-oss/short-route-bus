import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import LanguageDetector from 'i18next-browser-languagedetector'

// English
import enCommon from './en/common.json'
import enPlatform from './en/platform.json'
import enTenant from './en/tenant.json'
import enPublic from './en/public.json'

// Nepali
import neCommon from './ne/common.json'
import nePublic from './ne/public.json'
import nePlatform from './ne/platform.json'
import neTenant from './ne/tenant.json'

const resources = {
  en: {
    common: enCommon,
    platform: enPlatform,
    tenant: enTenant,
    public: enPublic,
  },
  ne: {
    common: neCommon,
    public: nePublic,
    platform: nePlatform,
    tenant: neTenant,
  },
}

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources,
    fallbackLng: 'en',
    defaultNS: 'common',
    fallbackNS: 'common',
    ns: ['common', 'platform', 'tenant', 'public'],
    detection: {
      order: ['localStorage', 'navigator'],
      caches: ['localStorage'],
      lookupLocalStorage: 'kvbms_language',
    },
    interpolation: {
      escapeValue: false, // React already escapes
    },
  })

export default i18n
