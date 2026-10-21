// Everything the user enters lives in one JSON document in localStorage.
// The "rk." prefix keeps it apart from other apps on the same github.io origin.

const KEY = 'rk.data';
const PREFS = 'rk.prefs';

// The Russian defaults, as saved by the first version; such a list means
// "never edited", so it follows the interface language.
const OLD_DEFAULT_RULES = [
  'Вкладываю только деньги, которые не жалко потерять.',
  'Не кладу больше 30% всех денег в одну компанию.',
  'Держу минимум 2 года и не продаю в панике, когда акция падает.',
  'Перед покупкой записываю, почему верю в эту компанию.',
  'Раз в квартал перечитываю свои причины. Если они больше не верны, продаю.',
];

function defaults() {
  return {
    version: 1,
    settings: { budget: 150, maxShare: 30, fee: 0 },
    txs: [],      // { id, symbol, type: 'buy'|'sell', date, shares, price, fx, fee, note, created }
    watch: [],    // { symbol, added, addedPrice, why, risk, source }
    names: {},    // symbol -> company name
    notes: {},    // symbol -> "why I believe in it"
    rules: null,  // null = the default rules in the current language
    achievements: {}, // id -> 'YYYY-MM-DD' unlocked
  };
}

export let storageOk = true;

function read(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    storageOk = false;
    return null;
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    storageOk = false;
    return false;
  }
}

// Fills in anything missing so older or hand-edited backups still load.
function normalize(raw) {
  const d = defaults();
  if (!raw || typeof raw !== 'object') return d;
  const settings = { ...d.settings, ...(raw.settings || {}) };
  for (const k of Object.keys(d.settings)) {
    const n = Number(settings[k]);
    settings[k] = Number.isFinite(n) && n >= 0 ? n : d.settings[k];
  }
  const txs = (Array.isArray(raw.txs) ? raw.txs : [])
    .filter((t) => t && t.symbol && (t.type === 'buy' || t.type === 'sell') && /^\d{4}-\d\d-\d\d$/.test(t.date))
    .map((t) => ({
      id: String(t.id || uid()),
      symbol: String(t.symbol).toUpperCase(),
      type: t.type,
      date: t.date,
      shares: +t.shares || 0,
      price: +t.price || 0,
      fx: +t.fx || 0,
      fee: +t.fee || 0,
      note: String(t.note || ''),
      created: +t.created || 0,
    }))
    .filter((t) => t.shares > 0 && t.price > 0 && t.fx > 0);
  const seen = new Set();
  const watch = (Array.isArray(raw.watch) ? raw.watch : [])
    .filter((w) => w && w.symbol && !seen.has(w.symbol) && seen.add(w.symbol))
    .map((w) => ({
      symbol: String(w.symbol).toUpperCase(),
      added: /^\d{4}-\d\d-\d\d$/.test(w.added) ? w.added : '',
      addedPrice: +w.addedPrice || null,
      why: String(w.why || ''),
      risk: ['high', 'vhigh', 'lottery'].includes(w.risk) ? w.risk : '',
      source: String(w.source || ''),
    }));
  return {
    version: 1,
    settings,
    txs,
    watch,
    names: raw.names && typeof raw.names === 'object' ? { ...raw.names } : {},
    notes: raw.notes && typeof raw.notes === 'object' ? { ...raw.notes } : {},
    rules: Array.isArray(raw.rules) && JSON.stringify(raw.rules) !== JSON.stringify(OLD_DEFAULT_RULES)
      ? raw.rules.map(String).filter((r) => r.trim())
      : null,
    achievements: raw.achievements && typeof raw.achievements === 'object' ? { ...raw.achievements } : {},
  };
}

export const data = normalize(read(KEY));
// Per-device interface choices; not part of the backup.
export const prefs = {
  tab: 'portfolio', range: '1Y', machine: null, lang: null, theme: 'auto', privacy: false,
  pfView: 'cards', pfSort: 'value', histRange: 'ALL', welcomed: false,
  ...(read(PREFS) || {}),
};

// Check once that writes actually stick (Safari private mode etc.).
try {
  localStorage.setItem('rk.test', '1');
  localStorage.removeItem('rk.test');
} catch {
  storageOk = false;
}

export function save() { return write(KEY, data); }
export function savePrefs() { write(PREFS, prefs); }

export function uid() {
  return (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
}

export function exportJson() {
  return JSON.stringify({ app: 'rockets', exported: new Date().toISOString(), ...data }, null, 2);
}

// Replaces all data with a backup. Throws on files that aren't ours.
export function importJson(text) {
  const raw = JSON.parse(text);
  if (!raw || typeof raw !== 'object' || (!Array.isArray(raw.txs) && !Array.isArray(raw.watch))) {
    throw new Error('not a backup');
  }
  const next = normalize(raw);
  for (const k of Object.keys(data)) delete data[k];
  Object.assign(data, next);
  save();
}

export function resetAll() {
  const next = defaults();
  for (const k of Object.keys(data)) delete data[k];
  Object.assign(data, next);
  save();
}
