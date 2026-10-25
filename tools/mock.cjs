// Fake CNBC / Frankfurter responses for browser tests (the sandbox has no access
// to the real endpoints). Shapes follow what the app's parsers read.

const DAY = 86_400_000;
const COMPANIES = {
  AAPL: { name: 'Apple Inc', ipo: '1980-12-12', p0: 0.1, p1: 252.3, cap: '3.75T', exch: 'NASDAQ' },
  MSFT: { name: 'Microsoft Corp', ipo: '1986-03-13', p0: 0.07, p1: 512.4, cap: '3.81T', exch: 'NASDAQ' },
  AMZN: { name: 'Amazon.com Inc', ipo: '1997-05-15', p0: 0.075, p1: 221.5, cap: '2.36T', exch: 'NASDAQ' },
  NVDA: { name: 'NVIDIA Corp', ipo: '1999-01-22', p0: 0.04, p1: 181.2, cap: '4.41T', exch: 'NASDAQ' },
  NFLX: { name: 'Netflix Inc', ipo: '2002-05-23', p0: 1.1, p1: 1190, cap: '506.3B', exch: 'NASDAQ' },
  TSLA: { name: 'Tesla Inc', ipo: '2010-06-29', p0: 1.6, p1: 430.1, cap: '1.39T', exch: 'NASDAQ' },
  IONQ: { name: 'IonQ Inc', ipo: '2021-10-01', p0: 9.8, p1: 46.2, cap: '13.62B', exch: 'NYSE' },
  RKLB: { name: 'Rocket Lab Corp', ipo: '2021-08-25', p0: 10.4, p1: 52.8, cap: '25.4B', exch: 'NASDAQ' },
  NNE: { name: 'Nano Nuclear Energy Inc', ipo: '2024-05-08', p0: 4.2, p1: 38.4, cap: '1.6B', exch: 'NASDAQ' },
  SERV: { name: 'Serve Robotics Inc', ipo: '2024-04-18', p0: 4.0, p1: 11.6, cap: '684.2M', exch: 'NASDAQ' },
  '.SPX': { name: 'S&P 500 Index', ipo: '1957-03-04', p0: 44, p1: 6650, cap: '', exch: 'INDEX' },
  KULR: { name: 'KULR Technology Group Inc', ipo: '2021-06-01', p0: 2.1, p1: 3.9, cap: '171.5M', exch: 'NYSE American' },
};

function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; };
}
const seedOf = (s) => [...s].reduce((a, c) => a * 31 + c.charCodeAt(0), 7);

// Log-linear drift from p0 to p1 plus a Brownian bridge, with one deep slump.
function path(symbol, n, p0, p1, vol) {
  const r = rng(seedOf(symbol) + n);
  const w = [0];
  for (let i = 1; i < n; i++) w.push(w[i - 1] + (r() - 0.5) * vol);
  const out = [];
  for (let i = 0; i < n; i++) {
    const t = n > 1 ? i / (n - 1) : 1;
    const bridge = w[i] - t * w[n - 1];
    const slump = -1.2 * Math.exp(-(((t - 0.55) / 0.08) ** 2));
    out.push(Math.exp(Math.log(p0) * (1 - t) + Math.log(p1) * t + bridge + slump * (1 - Math.abs(2 * t - 1)) * 0.9));
  }
  out[n - 1] = p1;
  return out;
}

const pad = (n) => String(n).padStart(2, '0');
const tradeTime = (d) => `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}00`;

function times(api, ipo) {
  const now = new Date();
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const weekday = (ms) => { const g = new Date(ms).getUTCDay(); return g !== 0 && g !== 6; };
  const out = [];
  if (api === '1D' || api === '5D') {
    const days = [];
    for (let d = today; days.length < (api === '1D' ? 1 : 5); d -= DAY) if (weekday(d)) days.unshift(d);
    const step = api === '1D' ? 5 : 15;
    for (const d of days) for (let m = 9 * 60 + 30; m <= 16 * 60; m += step) out.push(d + m * 60_000);
    return out;
  }
  const spanDays = { '1M': 31, '6M': 190, '1Y': 380, '5Y': 1850 }[api];
  const start = api === 'ALL' ? Date.parse(ipo + 'T00:00:00Z') : Math.max(Date.parse(ipo + 'T00:00:00Z'), today - spanDays * DAY);
  const step = api === 'ALL' || api === '5Y' ? 7 * DAY : DAY;
  for (let d = start; d <= today; d += step) if (step > DAY || weekday(d)) out.push(d + 16 * 3_600_000);
  return out;
}

function bars(symbol, api) {
  const c = COMPANIES[symbol];
  if (!c) return { barData: { priceBars: [] } };
  const ts = times(api, c.ipo);
  const full = Date.now() - Date.parse(c.ipo);
  const startFrac = Math.max(0, 1 - (Date.now() - ts[0]) / full);
  // Price at the start of the window, read off the long-run path.
  const longRun = path(symbol, 400, c.p0, c.p1, 0.35);
  const p0 = longRun[Math.min(399, Math.round(startFrac * 399))];
  const vol = api === '1D' ? 0.01 : api === '5D' ? 0.02 : api === 'ALL' ? 0.08 : 0.04;
  const ps = path(symbol + api, ts.length, p0, c.p1, vol);
  return {
    barData: {
      priceBars: ts.map((t, i) => ({ tradeTimeinMills: String(t), tradeTime: tradeTime(new Date(t)), close: ps[i].toFixed(4) })),
    },
  };
}

function quote(symbol) {
  if (symbol === 'ILS=') {
    return { symbol, code: 0, last: '3.6812', change: '-0.0120', change_pct: '-0.33%', name: 'USD/ILS', currencyCode: 'ILS', realTime: 'true', curmktstatus: 'REG_MKT' };
  }
  const c = COMPANIES[symbol];
  if (!c) return { symbol, code: 1 };
  const pc = c.p1 / 1.0213;
  return {
    symbol, code: 0, name: c.name, exchange: c.exch, currencyCode: 'USD', realTime: 'true', curmktstatus: 'REG_MKT',
    last: c.p1.toFixed(2), change: '+' + (c.p1 - pc).toFixed(2), change_pct: '+2.13%',
    open: (pc * 1.004).toFixed(2), high: (c.p1 * 1.01).toFixed(2), low: (pc * 0.99).toFixed(2), previous_day_closing: pc.toFixed(2),
    yrhiprice: (c.p1 * 1.4).toFixed(2), yrloprice: (c.p1 * 0.45).toFixed(2), mktcapView: c.cap, pe: '—', volume_alt: '12.4M',
  };
}

function search(prefix) {
  const q = prefix.toLowerCase();
  return Object.entries(COMPANIES)
    .filter(([s, c]) => s.toLowerCase().startsWith(q) || c.name.toLowerCase().includes(q))
    .map(([s, c]) => ({ symbolName: s, companyName: c.name, exchangeName: c.exch, issueType: 'STOCK' }));
}

// Frankfurter time series: '/v1/2026-03-01..' -> { rates: { date: { ILS } } }
function fxRange(from) {
  const rates = {};
  for (let d = Date.parse(from + 'T00:00:00Z'); d <= Date.now(); d += DAY) {
    const g = new Date(d).getUTCDay();
    if (g === 0 || g === 6) continue;
    rates[new Date(d).toISOString().slice(0, 10)] = { ILS: +(3.55 + 0.2 * Math.sin(d / (90 * DAY))).toFixed(4) };
  }
  return { amount: 1, base: 'USD', start_date: from, rates };
}

function fx(dateOrLatest) {
  if (dateOrLatest.endsWith('..')) return fxRange(dateOrLatest.slice(0, -2));
  const d = dateOrLatest === 'latest' ? Date.now() : Date.parse(dateOrLatest);
  return { amount: 1, base: 'USD', date: dateOrLatest, rates: { ILS: +(3.55 + 0.2 * Math.sin(d / (90 * DAY))).toFixed(4) } };
}

// Hooks every data request of a Playwright page.
async function install(page, { offline = false, report = null } = {}) {
  const json = (route, body) => route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) });
  // The scheduled report lives next to the app; an empty object means "none yet".
  await page.route('**/claude/report.json', (route) => json(route, report || {}));
  await page.route('https://quote.cnbc.com/**', (route) => {
    if (offline) return route.abort();
    const syms = new URL(route.request().url()).searchParams.get('symbols').split('|');
    json(route, { FormattedQuoteResult: { FormattedQuote: syms.map(quote) } });
  });
  await page.route('https://symlookup.cnbc.com/**', (route) => json(route, search(new URL(route.request().url()).searchParams.get('prefix'))));
  await page.route('https://ts-api.cnbc.com/**', (route) => {
    const u = new URL(route.request().url());
    const api = u.pathname.split('/').pop().replace('.json', '');
    json(route, bars(u.searchParams.get('symbol'), api));
  });
  // Logos: a small coloured square for known tickers, 404 otherwise.
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAABd0lEQVR4nO2bwRGDMAwEIZMGaIqyeFAWTVECeemTwUYSkk8G7T/x6pBtMo7H4ziGN/NBC6DJANACaDIAtACab8vBpm1lbzn7vIyeLsTovQ1Kii7hGYZLABZFl7AOwzQAz8L/sQrCbBFsWbzleCYBtC7ectxbUwBV+BnaKaHugEjFD4PeRxVAtOIJjZc4gKjFE1K/178KiwKI/vQJiSc7gF6KJ7i+rAB6K57geLv/Gtzn5fZ3TNtqYHLOZQf0+vSJK//cBdACaKoB9N7+RK2O7AC0AJpiAE9pf6JUT3YAWgBNBoAWQJMBoAXQZABoATQZAFoATTGAVufzrSjVkx2AFkBTDeAp06BWR3YAWgDNZQC9T4Mrf/eDEc9DDQtYU6DXLuB4s9eA3kLg+ooWwV5CkHjmLiD9QPQukPqpOiBqCBov9RSIFoLWx+S/wshTpLsPwmQRRHWDxbhmu0DrEKzGy/sCeWOk4c3RV94Zik6+CqMF0GQAaAE0P4NFnqzYHz6eAAAAAElFTkSuQmCC', 'base64');
  await page.route('https://financialmodelingprep.com/**', (route) => {
    const sym = decodeURIComponent(new URL(route.request().url()).pathname.split('/').pop().replace('.png', ''));
    if (COMPANIES[sym] && !sym.startsWith('.')) route.fulfill({ status: 200, contentType: 'image/png', body: png });
    else route.fulfill({ status: 404, body: '' });
  });
  await page.route('https://api.frankfurter.dev/**', (route) => json(route, fx(new URL(route.request().url()).pathname.split('/').pop())));
  await page.route('https://api.frankfurter.app/**', (route) => json(route, fx(new URL(route.request().url()).pathname.split('/').pop())));
}

module.exports = { install, COMPANIES };
