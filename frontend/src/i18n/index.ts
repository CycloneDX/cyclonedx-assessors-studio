import { createI18n } from 'vue-i18n'
import enUS from './locales/en-US.json'

export const AVAILABLE_LOCALES = [
  { code: 'en-US', name: 'English', nativeName: 'English', direction: 'ltr' as const },
  { code: 'fr-FR', name: 'French', nativeName: 'Français', direction: 'ltr' as const },
  { code: 'de-DE', name: 'German', nativeName: 'Deutsch', direction: 'ltr' as const },
  { code: 'es-ES', name: 'Spanish', nativeName: 'Español', direction: 'ltr' as const },
  { code: 'zh-CN', name: 'Chinese', nativeName: '简体中文', direction: 'ltr' as const },
  { code: 'ja-JP', name: 'Japanese', nativeName: '日本語', direction: 'ltr' as const },
  { code: 'ru-RU', name: 'Russian', nativeName: 'Русский', direction: 'ltr' as const },
]

type LocaleCode = typeof AVAILABLE_LOCALES[number]['code']

const VALID_LOCALE_CODES = new Set<string>(AVAILABLE_LOCALES.map((l) => l.code))

/**
 * Sprint 6 F10: static import map for locale bundles.
 *
 * The previous implementation did `await import(./locales/${locale}.json)`
 * with a template literal interpolation, which puts the cookie value into
 * a module path at runtime. Even though `loadLocaleMessages` now rejects
 * unknown codes before calling the importer, leaving a dynamic path on
 * the sink was a standing footgun: one future edit that forgets the
 * allowlist brings it straight back. Vite also had to fall back to a
 * wider bundle match on the template form.
 *
 * The static map below is explicit, enumerable, and turns each bundle
 * into a separate Vite chunk so we still get lazy loading. Adding a
 * language means adding a row here and an entry in AVAILABLE_LOCALES,
 * and only codes listed in both can be loaded.
 */
const LOCALE_LOADERS: Record<LocaleCode, () => Promise<{ default: unknown }>> = {
  'en-US': () => import('./locales/en-US.json'),
  'fr-FR': () => import('./locales/fr-FR.json'),
  'de-DE': () => import('./locales/de-DE.json'),
  'es-ES': () => import('./locales/es-ES.json'),
  'zh-CN': () => import('./locales/zh-CN.json'),
  'ja-JP': () => import('./locales/ja-JP.json'),
  'ru-RU': () => import('./locales/ru-RU.json'),
}

/**
 * Sprint 6 F11: validate the locale cookie on read.
 *
 * `document.cookie` is attacker-influenceable. If an attacker can set
 * the `ui_locale` cookie (through a subdomain takeover, a same-site
 * CSRF against a sibling app, or a cookie-injection gadget) they
 * previously got the raw value back from here. Every downstream caller
 * had to remember to allowlist it on its own. We centralize the check:
 * if the cookie is missing, malformed, or names an unknown locale, we
 * return the default. This keeps `getStoredLocale` total and safe to
 * feed into any sink, including the initial vue-i18n `locale`.
 */
function getStoredLocale(): LocaleCode {
  const match = document.cookie.match(/(?:^|;\s*)ui_locale=([^;]*)/)
  if (!match) return 'en-US'
  let decoded: string
  try {
    decoded = decodeURIComponent(match[1])
  } catch {
    // Malformed percent-encoding yields URIError. Treat as absent.
    return 'en-US'
  }
  return VALID_LOCALE_CODES.has(decoded) ? (decoded as LocaleCode) : 'en-US'
}

const i18n = createI18n({
  legacy: false,
  locale: getStoredLocale(),
  fallbackLocale: 'en-US',
  messages: { 'en-US': enUS },
  missingWarn: false,
  fallbackWarn: false,
  globalInjection: true,
})

export async function loadLocaleMessages(locale: string): Promise<void> {
  // Validate locale against known supported locales before touching the
  // import map. Double gate: getStoredLocale is also validated, but
  // loadLocaleMessages is called from other call sites (language
  // switcher, deep links) and must not trust its argument either.
  if (!VALID_LOCALE_CODES.has(locale)) {
    console.warn(`Locale "${locale}" is not supported`);
    return;
  }
  const code = locale as LocaleCode

  if ((i18n.global.availableLocales as string[]).includes(code)) {
    const localeRef = i18n.global.locale as unknown;
    if (typeof localeRef === 'object' && localeRef !== null && 'value' in localeRef) {
      (localeRef as Record<string, unknown>).value = code;
    }
    return;
  }
  try {
    const loader = LOCALE_LOADERS[code];
    const messages = await loader();
    // Translations are intentionally allowed to be partial; vue-i18n
    // falls back to en-US for missing keys. Cast through typeof enUS
    // so setLocaleMessage accepts the payload without requiring every
    // locale JSON to match the canonical shape one-for-one.
    i18n.global.setLocaleMessage(code, messages.default as typeof enUS);
    const localeRef = i18n.global.locale as unknown;
    if (typeof localeRef === 'object' && localeRef !== null && 'value' in localeRef) {
      (localeRef as Record<string, unknown>).value = code;
    }
  } catch (e) {
    console.warn(`Failed to load locale ${code}`, e);
  }
}

export default i18n
