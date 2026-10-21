// Interface language: Russian (default) and English.

import { STRINGS } from './strings.js';

export const LANGS = {
  ru: { locale: 'ru-RU', label: 'RU', name: 'Русский' },
  en: { locale: 'en-US', label: 'EN', name: 'English' },
};

let lang = 'ru';

export const getLang = () => lang;
export const locale = () => LANGS[lang].locale;

export function setLang(next) {
  lang = LANGS[next] ? next : 'ru';
  document.documentElement.lang = lang;
}

export function detectLang() {
  const nav = (navigator.languages || [navigator.language || 'ru']).map((l) => l.slice(0, 2));
  // Russian speakers get Russian; Hebrew, English and everyone else get English.
  return nav.includes('ru') || nav.includes('uk') || nav.includes('be') ? 'ru' : 'en';
}

function lookup(key) {
  const s = STRINGS[lang][key] ?? STRINGS.ru[key];
  if (s == null) console.warn('missing string', key);
  return s ?? key;
}

const fill = (s, vars) => (vars ? s.replace(/\{(\w+)\}/g, (m, k) => (vars[k] ?? m)) : s);

export function t(key, vars) {
  const s = lookup(key);
  return typeof s === 'function' ? s(vars || {}) : fill(String(s), vars);
}

// Plural forms: { one, few, many, other } with {n} inside.
const rules = {};
export function tp(key, n, vars) {
  const forms = lookup(key);
  if (typeof forms !== 'object') return fill(String(forms), { n, ...vars });
  const pr = rules[lang] || (rules[lang] = new Intl.PluralRules(locale()));
  const form = Number.isInteger(n) ? pr.select(n) : 'other';
  const s = forms[form] ?? forms.other ?? forms.many;
  return fill(s, { n: vars?.nText ?? n, ...vars });
}

// Static markup: data-i18n (text), data-i18n-html (trusted strings), -ph, -title, -aria.
export function translateDom(root = document) {
  root.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = t(el.dataset.i18n); });
  root.querySelectorAll('[data-i18n-html]').forEach((el) => { el.innerHTML = t(el.dataset.i18nHtml); });
  root.querySelectorAll('[data-i18n-ph]').forEach((el) => { el.placeholder = t(el.dataset.i18nPh); });
  root.querySelectorAll('[data-i18n-title]').forEach((el) => { el.title = t(el.dataset.i18nTitle); });
  root.querySelectorAll('[data-i18n-aria]').forEach((el) => { el.setAttribute('aria-label', t(el.dataset.i18nAria)); });
}
