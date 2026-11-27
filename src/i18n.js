import { ref } from 'vue';
import { translations, getPageMetadata, getPageURL, getPageMetaTags, getApplicationMetadata } from './locales.js';

export const LOCALE_KEY = 'web-tja-studio-locale';
export const languages = [
  { code: 'zh-CN', name: '简体中文' },
  { code: 'en', name: 'English' },
  { code: 'ja', name: '日本語' },
  { code: 'zh-TW', name: '繁體中文' },
  { code: 'ko', name: '한국어' }
];
export const locale = ref('zh-CN');
export const localePreference = ref('auto');

export function matchLocale(value) {
  const tag = String(value).replaceAll('_', '-').toLowerCase();
  if (/^zh(?:-|$)/.test(tag)) return /^zh-(?:tw|hk|mo|hant)(?:-|$)/.test(tag) ? 'zh-TW' : 'zh-CN';
  return languages.find(item => item.code !== 'zh-CN' && item.code !== 'zh-TW' && (tag === item.code || tag.startsWith(`${item.code}-`)))?.code;
}

export function detectLocale(preferred = []) {
  for (const value of preferred) {
    const matched = matchLocale(value);
    if (matched) return matched;
  }
  return 'zh-CN';
}

export function message(key, params = {}) { return { key, params }; }

export function formatMessage(value) {
  if (value instanceof Error) return value.message;
  return typeof value === 'string' ? t(value) : t(value.key, value.params);
}

export function t(key, params = {}) {
  const index = languages.findIndex(item => item.code === locale.value) - 1;
  const text = index < 0 ? key : translations[key]?.[index] ?? key;
  return text.replace(/\{(\w+)\}/g, (placeholder, name) => {
    if (!Object.hasOwn(params, name)) return placeholder;
    const value = params[name];
    return String(value instanceof Error || value && typeof value === 'object' && typeof value.key === 'string' ? formatMessage(value) : value);
  });
}

export class LocalizedError extends Error {
  constructor(key, params = {}) {
    super(typeof key === 'string' ? key : key.key);
    Object.defineProperty(this, 'message', { get: () => typeof key === 'string' ? t(key, params) : formatMessage(key), configurable: true });
  }
}

export function initializeLocale(storage, browserLanguages = globalThis.navigator?.languages || [globalThis.navigator?.language], root = globalThis.document?.documentElement) {
  let saved, error;
  try { saved = (storage ?? globalThis.localStorage)?.getItem(LOCALE_KEY); } catch (cause) { error = cause; }
  const pageLocale = languages.find(item => root?.ownerDocument?.location?.pathname.endsWith(`/index.${item.code}.html`))?.code;
  localePreference.value = pageLocale ?? (languages.some(item => item.code === saved) ? saved : 'auto');
  locale.value = localePreference.value === 'auto' ? detectLocale(browserLanguages) : localePreference.value;
  if (root) { root.lang = locale.value; updateDocumentMetadata(root); }
  return error;
}

export function setLocale(code, storage, root = globalThis.document?.documentElement) {
  if (code !== 'auto' && !languages.some(item => item.code === code)) throw new RangeError(`Unsupported locale: ${code}`);
  localePreference.value = code;
  locale.value = code === 'auto' ? detectLocale(globalThis.navigator?.languages || [globalThis.navigator?.language]) : code;
  if (root) { root.lang = locale.value; updateDocumentMetadata(root); }
  try { (storage ?? globalThis.localStorage)?.setItem(LOCALE_KEY, code); } catch (error) { return error; }
}

export function updateDocumentMetadata(root) {
  const document = root?.ownerDocument;
  if (!document) return;
  const metadata = getPageMetadata(locale.value);
  document.title = metadata.title;
  for (const [key, value] of Object.entries(getPageMetaTags(locale.value))) {
    const attribute = key.startsWith('og:') ? 'property' : 'name';
    document.querySelector(`meta[${attribute}="${key}"]`)?.setAttribute('content', value);
  }
  const canonicalURL = getPageURL(locale.value);
  document.querySelector('link[rel="canonical"]')?.setAttribute('href', canonicalURL);
  const structuredData = document.querySelector('script[type="application/ld+json"]');
  if (structuredData) {
    const application = JSON.parse(structuredData.textContent);
    Object.assign(application, getApplicationMetadata(locale.value));
    structuredData.textContent = JSON.stringify(application);
  }
  if (document.defaultView && /\/(?:index(?:\.(?:en|ja|zh-TW|ko))?\.html)?$/.test(document.location.pathname)) {
    const address = new URL(document.location.href);
    const localized = new URL(localePreference.value === 'auto' || locale.value === 'zh-CN' ? './' : `index.${locale.value}.html`, address);
    address.pathname = localized.pathname;
    document.defaultView.history.replaceState(document.defaultView.history.state, '', address);
  }
}
