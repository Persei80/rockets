// Portfolio math. Money is tracked in shekels at the rate of each purchase,
// so the result includes what the dollar did, as on a real Israeli account.

import { lastPrice, barIso } from './api.js';
import { t } from './i18n.js';
import { todayIso } from './format.js';

const EPS = 1e-9;

export function sortedTxs(txs) {
  return [...txs].sort((a, b) => a.date.localeCompare(b.date) || a.created - b.created);
}

const buyCost = (tx) => tx.shares * tx.price * tx.fx + tx.fee;
const sellProceeds = (tx) => tx.shares * tx.price * tx.fx - tx.fee;

// One entry per company, with average-cost accounting for sales.
export function positions(txs) {
  const by = new Map();
  for (const tx of sortedTxs(txs)) {
    let p = by.get(tx.symbol);
    if (!p) {
      p = { symbol: tx.symbol, shares: 0, costIls: 0, costUsd: 0, investedIls: 0, proceedsIls: 0, realizedIls: 0, firstDate: tx.date, txs: [] };
      by.set(tx.symbol, p);
    }
    p.txs.push(tx);
    if (tx.type === 'buy') {
      const ils = buyCost(tx);
      p.shares += tx.shares;
      p.costIls += ils;
      p.costUsd += tx.shares * tx.price + tx.fee / tx.fx;
      p.investedIls += ils;
    } else {
      const frac = p.shares > EPS ? Math.min(1, tx.shares / p.shares) : 0;
      const costPart = p.costIls * frac;
      const proceeds = sellProceeds(tx);
      p.realizedIls += proceeds - costPart;
      p.proceedsIls += proceeds;
      p.costIls -= costPart;
      p.costUsd -= p.costUsd * frac;
      p.shares = Math.max(0, p.shares - tx.shares);
    }
  }
  for (const p of by.values()) {
    if (p.shares < 1e-7) { p.shares = 0; p.costIls = 0; p.costUsd = 0; }
    p.open = p.shares > 0;
    p.avgUsd = p.open ? p.costUsd / p.shares : null;
  }
  return [...by.values()];
}

// Adds live values to positions; fields stay null until a quote arrives.
export function valuePositions(list, quotes, fx) {
  for (const p of list) {
    const q = quotes[p.symbol];
    const price = lastPrice(q);
    p.quote = q || null;
    p.price = price;
    p.valueIls = p.open && price != null && fx ? p.shares * price * fx : p.open ? null : 0;
    p.gainIls = p.valueIls != null ? p.valueIls - p.costIls : null;
    p.gainPct = p.gainIls != null && p.costIls > 0 ? (p.gainIls / p.costIls) * 100 : null;
    p.mult = p.open && p.valueIls != null && p.costIls > 0 ? p.valueIls / p.costIls : null;
    // Today's move: against yesterday's close, in shekels at today's rate.
    p.todayIls = p.open && q && q.pc && fx && price != null ? p.shares * (price - q.pc) * fx : null;
    p.todayPct = q ? (q.ext ? q.ext.dp : q.dp) : null;
  }
  return list;
}

export function totals(list) {
  const r = { invested: 0, value: 0, proceeds: 0, cost: 0, today: 0, missing: false, open: 0 };
  for (const p of list) {
    r.invested += p.investedIls;
    r.proceeds += p.proceedsIls;
    if (p.open) {
      r.open += 1;
      r.cost += p.costIls;
      if (p.valueIls == null) r.missing = true;
      else r.value += p.valueIls;
      if (p.todayIls != null) r.today += p.todayIls;
    }
  }
  r.result = r.value + r.proceeds - r.invested;
  r.resultPct = r.invested > 0 ? (r.result / r.invested) * 100 : null;
  r.mult = r.invested > 0 ? (r.value + r.proceeds) / r.invested : null;
  const base = r.value - r.today;
  r.todayPct = base > 0 ? (r.today / base) * 100 : null;
  return r;
}

// What selling now would leave in hand: the broker's dollar-to-shekel spread
// (about 1.5% at Blink) and Israel's 25% capital gains tax on the profit only.
export const FX_SPREAD = 0.015;
export const GAINS_TAX = 0.25;
export function netIfSold(valueIls, costIls) {
  if (valueIls == null || !(valueIls > 0)) return null;
  const fxCost = valueIls * FX_SPREAD;
  const gain = valueIls - fxCost - costIls;
  const tax = gain > 0 ? gain * GAINS_TAX : 0;
  return { net: valueIls - fxCost - tax, tax, fxCost };
}

// Shekels spent on purchases per 'YYYY-MM'.
export function spentByMonth(txs) {
  const out = {};
  for (const tx of txs) {
    if (tx.type !== 'buy') continue;
    const ym = tx.date.slice(0, 7);
    out[ym] = (out[ym] || 0) + buyCost(tx);
  }
  return out;
}

// Months in a row with at least one purchase, ending this month or last.
export function streak(spent) {
  const d = new Date();
  d.setDate(1);
  const ym = () => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  if (!spent[ym()]) d.setMonth(d.getMonth() - 1);
  let n = 0;
  while (spent[ym()]) { n++; d.setMonth(d.getMonth() - 1); }
  return n;
}

// ---------- portfolio over time ----------

// Which chart history covers a span starting at iso.
export function historyApi(iso) {
  const days = (Date.now() - new Date(iso + 'T12:00:00').getTime()) / 86_400_000;
  return days <= 25 ? '1M' : days <= 340 ? '1Y' : days <= 1780 ? '5Y' : 'ALL';
}

// Value of the holdings on each trading day vs what they cost.
// barsBy: symbol -> bars; fxBy: iso -> rate (may be null); live: symbol -> price now.
export function portfolioHistory(txs, barsBy, fxBy, fxNow, live) {
  const list = sortedTxs(txs);
  if (!list.length) return null;
  const start = list[0].date;
  const today = todayIso();
  const dateSet = new Set([start, today]);
  for (const bars of Object.values(barsBy)) for (const b of bars) { const d = barIso(b.d); if (d >= start && d <= today) dateSet.add(d); }
  const dates = [...dateSet].sort();

  const fxDates = fxBy ? Object.keys(fxBy).sort() : [];
  let fi = 0, fx = fxDates.length && fxDates[0] <= start ? fxBy[fxDates[0]] : (list[0].fx || fxNow);
  const ptr = {}, price = {}, shares = {}, cost = {};
  let ti = 0;
  const value = [], costs = [];
  for (const date of dates) {
    while (ti < list.length && list[ti].date <= date) {
      const tx = list[ti++];
      const s = tx.symbol;
      shares[s] = shares[s] || 0;
      cost[s] = cost[s] || 0;
      if (price[s] == null) price[s] = tx.price;
      if (tx.type === 'buy') { shares[s] += tx.shares; cost[s] += buyCost(tx); }
      else {
        const frac = shares[s] > EPS ? Math.min(1, tx.shares / shares[s]) : 0;
        cost[s] -= cost[s] * frac;
        shares[s] = Math.max(0, shares[s] - tx.shares);
      }
    }
    for (const s of Object.keys(shares)) {
      const bars = barsBy[s] || [];
      let p = ptr[s] || 0;
      while (p < bars.length && barIso(bars[p].d) <= date) { price[s] = bars[p].p; p++; }
      ptr[s] = p;
    }
    while (fi < fxDates.length && fxDates[fi] <= date) { fx = fxBy[fxDates[fi]]; fi++; }
    const rate = date === today && fxNow ? fxNow : fx || fxNow;
    let v = 0, c = 0;
    for (const s of Object.keys(shares)) {
      const p = date === today && live[s] != null ? live[s] : price[s];
      v += shares[s] * p * rate;
      c += cost[s];
    }
    value.push(v);
    costs.push(c);
  }
  return { dates, value, cost: costs };
}

// ---------- the rocket scale ----------

// Where a multiple sits on a log scale from ×0.1 to ×100 (0..1).
export function rocketPos(mult) {
  if (mult == null || !(mult > 0)) return 0;
  return Math.max(0, Math.min(1, (Math.log10(mult) + 1) / 3));
}

export function rocketStage(mult) {
  if (mult == null) return '';
  if (mult < 0.5) return t('stage.crash');
  if (mult < 0.95) return t('stage.below');
  if (mult < 1.5) return t('stage.pad');
  if (mult < 3) return t('stage.liftoff');
  if (mult < 10) return t('stage.climb');
  if (mult < 100) return t('stage.space');
  return t('stage.moon');
}

// ---------- company size ----------

export function capClass(cap) {
  if (cap == null) return null;
  const key = cap < 300e6 ? 'micro' : cap < 2e9 ? 'small' : cap < 10e9 ? 'mid' : 'large';
  return { key, label: t('cap.' + key), hint: t('cap.' + key + '.hint') };
}

export const riskLabel = (risk) => (risk ? t('risk.' + risk) : '');

// ---------- time machine ----------

// What a lump sum or a monthly amount (in dollars) would have become.
// bars must be chronological; start is 'YYYY-MM-DD'.
export function simulate(bars, startIso, amountUsd, monthly) {
  const first = bars.findIndex((b) => barIso(b.d) >= startIso);
  if (first < 0) return null;
  const used = bars.slice(first);
  const value = [], invested = [];
  let shares = 0, put = 0, lastMonth = '';
  used.forEach((b, i) => {
    const ym = barIso(b.d).slice(0, 7);
    if (i === 0 || (monthly && ym !== lastMonth)) {
      shares += amountUsd / b.p;
      put += amountUsd;
    }
    lastMonth = ym;
    value.push(shares * b.p);
    invested.push(put);
  });

  // The worst fall of the share price from a previous high.
  let peak = used[0].p, peakI = 0, dd = 0, ddPeak = 0, ddLow = 0;
  used.forEach((b, i) => {
    if (b.p > peak) { peak = b.p; peakI = i; }
    const fall = 1 - b.p / peak;
    if (fall > dd) { dd = fall; ddPeak = peakI; ddLow = i; }
  });
  // How long it took to climb back above the old high.
  let recover = null;
  if (dd > 0) {
    const top = used[ddPeak].p;
    for (let i = ddLow; i < used.length; i++) if (used[i].p >= top) { recover = i; break; }
  }

  const end = value[value.length - 1];
  const years = (used[used.length - 1].t - used[0].t) / (365.25 * 86_400_000);
  return {
    bars: used,
    value,
    invested,
    shares,
    put,
    end,
    mult: put > 0 ? end / put : null,
    years,
    cagr: !monthly && years >= 1 ? (Math.pow(end / put, 1 / years) - 1) * 100 : null,
    drawdown: { pct: dd * 100, peak: ddPeak, low: ddLow, recover },
    startPrice: used[0].p,
    endPrice: used[used.length - 1].p,
  };
}
