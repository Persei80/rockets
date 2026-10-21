// Live quotes and the dollar rate, polled while the app is open.

import { fetchQuotes, fxOn, FX_SYMBOL } from './api.js';
import { data, save } from './store.js';

const POLL_FAST_MS = 10_000;  // a US session (incl. pre/after hours) is on
const POLL_SLOW_MS = 60_000;  // markets closed or the window hidden
const FX_FALLBACK_MS = 30 * 60_000;

export const live = {
  quotes: {},          // symbol -> quote
  fx: null,            // shekels per dollar
  fxSource: '',
  conn: 'connecting',  // 'live' | 'offline' | 'connecting'
  updated: 0,
};

const listeners = new Set();
export const onLive = (fn) => listeners.add(fn);
const emit = () => listeners.forEach((fn) => fn());

// Everything on screen: holdings, watchlist and whatever is open right now.
const extra = new Set();
export function trackSymbol(symbol) {
  if (extra.has(symbol)) return;
  extra.add(symbol);
  poll();
}

function symbols() {
  const set = new Set(extra);
  for (const t of data.txs) set.add(t.symbol);
  for (const w of data.watch) set.add(w.symbol);
  return [...set];
}

let timer = 0, running = false, again = false, fxFallbackAt = 0;

export async function poll() {
  if (running) { again = true; return; }
  running = true;
  again = false;
  clearTimeout(timer);
  try {
    const quotes = await fetchQuotes([FX_SYMBOL, ...symbols()]);
    const fxq = quotes[FX_SYMBOL];
    delete quotes[FX_SYMBOL];
    Object.assign(live.quotes, Object.fromEntries(Object.entries(quotes).filter(([, q]) => q)));
    if (fxq && fxq.c > 1 && fxq.c < 10) {
      live.fx = fxq.c;
      live.fxSource = 'CNBC';
    } else if (!live.fx || Date.now() > fxFallbackAt) {
      const r = await fxOn(null);
      if (r) { live.fx = r; live.fxSource = 'ECB'; fxFallbackAt = Date.now() + FX_FALLBACK_MS; }
    }
    let renamed = false;
    for (const [s, q] of Object.entries(quotes)) {
      if (q && q.name && data.names[s] !== q.name) { data.names[s] = q.name; renamed = true; }
    }
    if (renamed) save();
    live.conn = 'live';
    live.updated = Date.now();
  } catch (err) {
    console.warn(err);
    live.conn = 'offline';
    if (!live.fx) {
      const r = await fxOn(null).catch(() => null);
      if (r) { live.fx = r; live.fxSource = 'ECB'; }
    }
  }
  running = false;
  emit();
  if (again) { poll(); return; }
  const active = Object.values(live.quotes).some((q) => q.realTime && q.status && q.status !== 'CLOSED' && q.status !== 'AFTER_MKT_CLOSED');
  timer = setTimeout(poll, document.visibilityState === 'visible' && active ? POLL_FAST_MS : POLL_SLOW_MS);
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && Date.now() - live.updated > POLL_FAST_MS) poll();
});
