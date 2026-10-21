// Number, money and date formatting in the current interface language.

import { locale, t, tp } from './i18n.js';

// "Hide amounts" mode: my own shekel sums are masked, percentages stay.
export const privacy = { on: false };

const cache = new Map();
function nf(opts) {
  const key = locale() + JSON.stringify(opts);
  let f = cache.get(key);
  if (!f) { f = new Intl.NumberFormat(locale(), opts); cache.set(key, f); }
  return f;
}

const ok = (v) => v != null && Number.isFinite(v);
const sign = (v) => (v > 0 ? '+' : v < 0 ? '−' : '');

export function fmtNum(v, digits = 2, minDigits = digits) {
  if (!ok(v)) return '—';
  return nf({ minimumFractionDigits: minDigits, maximumFractionDigits: digits }).format(v);
}

// Dollars: cents for normal prices, more digits for sub-dollar ones.
export function fmtUsd(v, { signed = false } = {}) {
  if (!ok(v)) return '—';
  const digits = Math.abs(v) < 1 && v !== 0 ? 4 : 2;
  const s = nf({ style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: digits }).format(Math.abs(v));
  return (signed ? sign(v) : v < 0 ? '−' : '') + s;
}

// Shekels: agorot for small sums, whole shekels for big ones.
export function fmtIls(v, { signed = false } = {}) {
  if (!ok(v)) return '—';
  const digits = Math.abs(v) >= 10_000 ? 0 : 2;
  const s = nf({ style: 'currency', currency: 'ILS', minimumFractionDigits: digits, maximumFractionDigits: digits }).format(Math.abs(v));
  return (signed ? sign(v) : v < 0 ? '−' : '') + s;
}

// My real money: hidden in privacy mode.
export function fmtMine(v, opts) {
  if (privacy.on && ok(v)) return (opts?.signed ? sign(v) : '') + t('mask');
  return fmtIls(v, opts);
}

export function fmtPct(v, digits = 1) {
  if (!ok(v)) return '—';
  return sign(v) + nf({ style: 'percent', minimumFractionDigits: digits, maximumFractionDigits: digits }).format(Math.abs(v) / 100);
}

// ×1.35 / ×12.4 / ×2,346
export function fmtMult(m) {
  if (!ok(m)) return '—';
  const digits = m < 10 ? 2 : m < 100 ? 1 : 0;
  return '×' + fmtNum(m, digits, digits === 2 ? 2 : 0);
}

export function fmtShares(n) {
  if (!ok(n)) return '—';
  if (privacy.on) return '•••';
  const digits = n >= 100 ? 2 : n >= 1 ? 4 : 6;
  return nf({ maximumFractionDigits: digits }).format(n);
}

// $540M / $1.2B / $2.1T in the reader's language.
export function fmtCap(v) {
  if (!ok(v)) return '—';
  return nf({ style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: v >= 1e10 && v < 1e12 ? 0 : 1 }).format(v);
}

// Axis labels: 950 ₪, 12K ₪ / 12 тыс. ₪, 2.3M ₪
export function fmtIlsShort(v, mine = false) {
  if (mine && privacy.on) return '';
  return nf({ style: 'currency', currency: 'ILS', notation: 'compact', maximumFractionDigits: v >= 1e3 && v < 1e4 ? 1 : 0 }).format(v);
}

export const dirOf = (d) => (d > 0 ? 'up' : d < 0 ? 'down' : 'flat');

// ---------- dates (stored as local 'YYYY-MM-DD') ----------

export function isoDate(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
export const todayIso = () => isoDate(new Date());
export function parseIso(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d || 1);
}

const dfCache = new Map();
export function dateFmt(opts) {
  const key = locale() + JSON.stringify(opts);
  let f = dfCache.get(key);
  if (!f) { f = new Intl.DateTimeFormat(locale(), opts); dfCache.set(key, f); }
  return f;
}
const clean = (s) => s.replace(/\s?г\.$/, '');

export function fmtDate(iso, opts = { day: 'numeric', month: 'short', year: 'numeric' }) {
  if (!iso) return '—';
  return clean(dateFmt(opts).format(parseIso(iso)));
}

// 'YYYY-MM' -> "October 2026" / "октябрь 2026"
export function monthName(ym) {
  const s = clean(dateFmt({ month: 'long', year: 'numeric' }).format(parseIso(ym + '-01')));
  return s;
}
export const monthShort = (ym) => dateFmt({ month: 'short' }).format(parseIso(ym + '-01')).replace('.', '');

export function fmtYears(years) {
  if (years < 1) {
    const m = Math.max(1, Math.round(years * 12));
    return tp('months', m);
  }
  const y = Math.round(years * 10) / 10;
  return tp('years', y, { nText: fmtNum(y, Number.isInteger(y) ? 0 : 1, Number.isInteger(y) ? 0 : 1) });
}

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);
