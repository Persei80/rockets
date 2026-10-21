// Number, money and date formatting for the Russian interface.

export const LOCALE = 'ru-RU';

const nf = (opts) => new Intl.NumberFormat(LOCALE, opts);

export function fmtNum(v, digits = 2, minDigits = digits) {
  if (v == null || !Number.isFinite(v)) return '—';
  return nf({ minimumFractionDigits: minDigits, maximumFractionDigits: digits }).format(v);
}

// Dollars: cents for normal prices, more digits for sub-dollar ones.
export function fmtUsd(v) {
  if (v == null || !Number.isFinite(v)) return '—';
  const digits = Math.abs(v) < 1 ? 4 : 2;
  return '$' + fmtNum(v, digits, 2);
}

// Shekels: agorot for small sums, whole shekels for big ones.
export function fmtIls(v, { signed = false } = {}) {
  if (v == null || !Number.isFinite(v)) return '—';
  const digits = Math.abs(v) >= 10_000 ? 0 : 2;
  const body = fmtNum(Math.abs(v), digits, digits === 0 ? 0 : 2) + ' ₪';
  if (!signed) return (v < 0 ? '−' : '') + body;
  return (v > 0 ? '+' : v < 0 ? '−' : '') + body;
}

export function fmtPct(v, digits = 1) {
  if (v == null || !Number.isFinite(v)) return '—';
  return (v > 0 ? '+' : v < 0 ? '−' : '') + fmtNum(Math.abs(v), digits, digits) + ' %';
}

export function fmtSigned(v, digits = 2) {
  if (v == null || !Number.isFinite(v)) return '—';
  return (v > 0 ? '+' : v < 0 ? '−' : '') + fmtNum(Math.abs(v), digits, digits);
}

// ×1,35 / ×12,4 / ×2 346
export function fmtMult(m) {
  if (m == null || !Number.isFinite(m)) return '—';
  const digits = m < 10 ? 2 : m < 100 ? 1 : 0;
  return '×' + fmtNum(m, digits, digits === 2 ? 2 : 0);
}

export function fmtShares(n) {
  if (n == null || !Number.isFinite(n)) return '—';
  const digits = n >= 100 ? 2 : n >= 1 ? 4 : 6;
  return nf({ maximumFractionDigits: digits }).format(n);
}

// $540 млн / $1,2 млрд / $2,1 трлн
export function fmtCap(v) {
  if (v == null || !Number.isFinite(v)) return '—';
  if (v >= 1e12) return '$' + fmtNum(v / 1e12, 1, 1) + ' трлн';
  if (v >= 1e9) return '$' + fmtNum(v / 1e9, v >= 1e10 ? 0 : 1, v >= 1e10 ? 0 : 1) + ' млрд';
  if (v >= 1e6) return '$' + fmtNum(v / 1e6, 0, 0) + ' млн';
  return '$' + fmtNum(v, 0, 0);
}

export const dirOf = (d) => (d > 0 ? 'up' : d < 0 ? 'down' : 'flat');

// Dates are stored as local 'YYYY-MM-DD' strings.
export function todayIso() {
  const d = new Date();
  return isoDate(d);
}
export function isoDate(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
export function parseIso(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d || 1);
}

export function fmtDate(iso, opts = { day: 'numeric', month: 'short', year: 'numeric' }) {
  if (!iso) return '—';
  return parseIso(iso).toLocaleDateString(LOCALE, opts).replace(/\s?г\.$/, '');
}

const MONTHS = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];
const MONTHS_SHORT = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
export const monthName = (ym) => MONTHS[+ym.slice(5, 7) - 1] + ' ' + ym.slice(0, 4);
export const monthShort = (ym) => MONTHS_SHORT[+ym.slice(5, 7) - 1];

// "год", "года", "лет"
export function plural(n, one, few, many) {
  const a = Math.abs(n) % 100, b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b > 1 && b < 5) return few;
  if (b === 1) return one;
  return many;
}

export function fmtYears(years) {
  if (years < 1) {
    const m = Math.max(1, Math.round(years * 12));
    return m + ' ' + plural(m, 'месяц', 'месяца', 'месяцев');
  }
  const y = Math.round(years * 10) / 10;
  const whole = Number.isInteger(y);
  return fmtNum(y, whole ? 0 : 1, whole ? 0 : 1) + ' ' + (whole ? plural(y, 'год', 'года', 'лет') : 'года');
}

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);
