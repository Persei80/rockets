// Market data. CNBC's public endpoints need no key and allow browser requests;
// exchange rates come from CNBC too, with the ECB (via Frankfurter) as a fallback
// and for historical dates.

const QUOTE_URL = 'https://quote.cnbc.com/quote-html-webservice/restQuote/symbolType/symbol';
const SEARCH_URL = 'https://symlookup.cnbc.com/symservice/symlookup.do';
const CHART_URL = 'https://ts-api.cnbc.com/harmony/app/charts/';
const FX_URLS = [
  (date) => `https://api.frankfurter.dev/v1/${date || 'latest'}?base=USD&symbols=ILS`,
  (date) => `https://api.frankfurter.app/${date || 'latest'}?from=USD&to=ILS`,
];
export const FX_SYMBOL = 'ILS=';
const QUOTE_CHUNK = 25;

// CNBC sends numbers as display strings: "1,677.96", "+2.35%".
export function num(s) {
  if (s == null || s === '') return null;
  const n = parseFloat(String(s).replace(/[,%+\s$]/g, ''));
  return Number.isFinite(n) ? n : null;
}

// "1.23B", "512.4M", "2.1T", "75,206.5K" -> dollars.
export function parseCap(s) {
  if (s == null) return null;
  const m = String(s).replace(/[,$\s]/g, '').match(/^(-?[\d.]+)([KMBT])?$/i);
  if (!m) return null;
  const mult = { K: 1e3, M: 1e6, B: 1e9, T: 1e12 }[(m[2] || '').toUpperCase()] || 1;
  const n = parseFloat(m[1]) * mult;
  return Number.isFinite(n) && n > 0 ? n : null;
}

function parseQuote(raw) {
  if (!raw || String(raw.code) !== '0' || num(raw.last) == null) return null;
  // Tel Aviv prices arrive in agorot although labelled ILS.
  const scale = /-IL$/.test(raw.symbol) && raw.currencyCode === 'ILS' ? 0.01 : 1;
  const price = (s) => { const n = num(s); return n == null ? null : n * scale; };
  const q = {
    symbol: raw.symbol,
    c: price(raw.last),
    d: price(raw.change) ?? 0,
    dp: num(raw.change_pct) ?? 0,
    o: price(raw.open),
    h: price(raw.high),
    l: price(raw.low),
    pc: price(raw.previous_day_closing),
    name: raw.name || raw.shortName || '',
    currency: raw.currencyCode || 'USD',
    realTime: raw.realTime === 'true',
    status: raw.curmktstatus || '',
    exchange: raw.exchange || '',
    ext: null,
    yrhi: price(raw.yrhiprice),
    yrlo: price(raw.yrloprice),
    cap: scale === 1 ? parseCap(raw.mktcapView) : null,
    capView: scale === 1 ? raw.mktcapView || '' : '',
    pe: raw.pe || '',
    vol: raw.volume_alt || '',
  };
  const ext = raw.ExtendedMktQuote;
  if (ext && (q.status === 'PRE_MKT' || q.status === 'POST_MKT') && num(ext.last) != null) {
    q.ext = { type: ext.type, c: price(ext.last), d: price(ext.change) ?? 0, dp: num(ext.change_pct) ?? 0 };
  }
  return q;
}

// The most recent price, counting pre-market and after-hours trading.
export const lastPrice = (q) => (q ? (q.ext ? q.ext.c : q.c) : null);

export async function fetchQuotes(symbols) {
  const out = {};
  for (let i = 0; i < symbols.length; i += QUOTE_CHUNK) {
    const url = new URL(QUOTE_URL);
    url.search = new URLSearchParams({
      symbols: symbols.slice(i, i + QUOTE_CHUNK).join('|'),
      requestMethod: 'itv', noform: '1', partnerId: '2', fund: '1', exthrs: '1', output: 'json',
    });
    const res = await fetch(url);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    let list = data?.FormattedQuoteResult?.FormattedQuote || [];
    if (!Array.isArray(list)) list = [list];
    for (const raw of list) if (raw && raw.symbol) out[raw.symbol] = parseQuote(raw);
  }
  return out;
}

export async function searchSymbols(q) {
  const url = new URL(SEARCH_URL);
  url.search = new URLSearchParams({ prefix: q, partnerid: '20064', pgok: '1', pgsize: '10' });
  const res = await fetch(url);
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const data = await res.json();
  return (Array.isArray(data) ? data : [])
    .filter((r) => r && r.symbolName && (r.issueType === 'STOCK' || r.issueType === 'ETF'))
    .map((r) => ({ symbol: r.symbolName, name: r.companyName || '', exchange: r.exchangeName || '' }));
}

// ---------- price history ----------

const barCache = new Map(); // `${symbol}|${api}` -> { at, bars }
const BAR_TTL = { '1D': 60_000, '5D': 60_000 };

// Bars: { t: ms, d: 'YYYYMMDDHHMMSS' exchange-local, p: close }.
export async function fetchBars(symbol, api) {
  const key = symbol + '|' + api;
  const hit = barCache.get(key);
  if (hit && Date.now() - hit.at < (BAR_TTL[api] ?? 10 * 60_000)) return hit.bars;
  const res = await fetch(CHART_URL + api + '.json?symbol=' + encodeURIComponent(symbol));
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const data = await res.json();
  const scale = /-IL$/.test(symbol) ? 0.01 : 1;
  const bars = (data?.barData?.priceBars || [])
    .map((b) => ({ t: +b.tradeTimeinMills, d: String(b.tradeTime), p: parseFloat(b.close) * scale }))
    .filter((b) => Number.isFinite(b.p) && b.p > 0 && b.d.length >= 12);
  barCache.set(key, { at: Date.now(), bars });
  return bars;
}

// 'YYYYMMDD...' -> 'YYYY-MM-DD'
export const barIso = (d) => `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;

// Closing price on a past date (or the last trading day before it).
export async function priceOn(symbol, iso) {
  const ageDays = (Date.now() - new Date(iso + 'T12:00:00').getTime()) / 86_400_000;
  const apis = ageDays <= 28 ? ['1M', '1Y'] : ageDays <= 360 ? ['1Y', '5Y'] : ageDays <= 1800 ? ['5Y', 'ALL'] : ['ALL'];
  for (const api of apis) {
    let bars;
    try { bars = await fetchBars(symbol, api); } catch { continue; }
    if (!bars.length || barIso(bars[0].d) > iso) continue;
    let best = null;
    for (const b of bars) {
      if (barIso(b.d) <= iso) best = b;
      else break;
    }
    if (best) return { price: best.p, date: barIso(best.d) };
  }
  return null;
}

// ---------- USD/ILS ----------

const fxCache = new Map(); // iso|'latest' -> rate

// Shekels per dollar on a date (ECB reference rate), or the latest one.
export async function fxOn(iso) {
  const key = iso || 'latest';
  if (fxCache.has(key)) return fxCache.get(key);
  for (const make of FX_URLS) {
    try {
      const res = await fetch(make(iso));
      if (!res.ok) continue;
      const data = await res.json();
      const rate = +data?.rates?.ILS;
      if (rate > 0) {
        fxCache.set(key, rate);
        return rate;
      }
    } catch {}
  }
  return null;
}

// Daily USD/ILS for a span of dates: { 'YYYY-MM-DD': rate } (business days only).
const seriesCache = new Map();
export async function fxSeries(fromIso) {
  if (seriesCache.has(fromIso)) return seriesCache.get(fromIso);
  const urls = [
    `https://api.frankfurter.dev/v1/${fromIso}..?base=USD&symbols=ILS`,
    `https://api.frankfurter.app/${fromIso}..?from=USD&to=ILS`,
  ];
  for (const url of urls) {
    try {
      const res = await fetch(url);
      if (!res.ok) continue;
      const data = await res.json();
      const out = {};
      for (const [d, r] of Object.entries(data?.rates || {})) if (+r?.ILS > 0) out[d] = +r.ILS;
      if (Object.keys(out).length) {
        seriesCache.set(fromIso, out);
        return out;
      }
    } catch {}
  }
  return null;
}

// Company logos from a free public image service; the app falls back to a letter.
export const logoUrl = (symbol) => `https://financialmodelingprep.com/image-stock/${encodeURIComponent(symbol)}.png`;
