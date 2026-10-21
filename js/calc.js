// Portfolio math. Money is tracked in shekels at the rate of each purchase,
// so the result includes what the dollar did, as on a real Israeli account.

import { lastPrice } from './api.js';

const EPS = 1e-9;

export function sortedTxs(txs) {
  return [...txs].sort((a, b) => a.date.localeCompare(b.date) || a.created - b.created);
}

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
      const ils = tx.shares * tx.price * tx.fx + tx.fee;
      p.shares += tx.shares;
      p.costIls += ils;
      p.costUsd += tx.shares * tx.price + tx.fee / tx.fx;
      p.investedIls += ils;
    } else {
      const frac = p.shares > EPS ? Math.min(1, tx.shares / p.shares) : 0;
      const costPart = p.costIls * frac;
      const proceeds = tx.shares * tx.price * tx.fx - tx.fee;
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
    p.mult = p.open && p.valueIls != null && p.costIls > 0 ? p.valueIls / p.costIls : null;
    // Today's move: against yesterday's close, in shekels at today's rate.
    p.todayIls = p.open && q && q.pc && fx ? p.shares * (price - q.pc) * fx : null;
    p.totalMult = p.investedIls > 0 && p.valueIls != null ? (p.valueIls + p.proceedsIls) / p.investedIls : null;
  }
  return list;
}

export function totals(list) {
  const t = { invested: 0, value: 0, proceeds: 0, cost: 0, today: 0, missing: false, open: 0 };
  for (const p of list) {
    t.invested += p.investedIls;
    t.proceeds += p.proceedsIls;
    if (p.open) {
      t.open += 1;
      t.cost += p.costIls;
      if (p.valueIls == null) t.missing = true;
      else t.value += p.valueIls;
      if (p.todayIls != null) t.today += p.todayIls;
    }
  }
  t.result = t.value + t.proceeds - t.invested;
  t.resultPct = t.invested > 0 ? (t.result / t.invested) * 100 : null;
  t.mult = t.invested > 0 ? (t.value + t.proceeds) / t.invested : null;
  const base = t.value - t.today;
  t.todayPct = base > 0 ? (t.today / base) * 100 : null;
  return t;
}

// Shekels spent on purchases per 'YYYY-MM'.
export function spentByMonth(txs) {
  const out = {};
  for (const tx of txs) {
    if (tx.type !== 'buy') continue;
    const ym = tx.date.slice(0, 7);
    out[ym] = (out[ym] || 0) + tx.shares * tx.price * tx.fx + tx.fee;
  }
  return out;
}

// ---------- the rocket scale ----------

// Where a multiple sits on a log scale from ×0.1 to ×100 (0..1).
export function rocketPos(mult) {
  if (mult == null || !(mult > 0)) return 0;
  return Math.max(0, Math.min(1, (Math.log10(mult) + 1) / 3));
}

export function rocketStage(mult) {
  if (mult == null) return '';
  if (mult < 0.5) return 'Сильно упала';
  if (mult < 0.95) return 'Пока ниже покупки';
  if (mult < 1.5) return 'На старте';
  if (mult < 3) return 'Отрывается от земли';
  if (mult < 10) return 'Набирает высоту';
  if (mult < 100) return 'В космосе';
  return 'На Луне!';
}

// ---------- company size ----------

export function capClass(cap) {
  if (cap == null) return null;
  if (cap < 300e6) return { key: 'micro', label: 'Микро', hint: 'Совсем маленькая: самый высокий риск' };
  if (cap < 2e9) return { key: 'small', label: 'Маленькая', hint: 'Подходит под «ракету»: есть куда расти' };
  if (cap < 10e9) return { key: 'mid', label: 'Средняя', hint: 'Уже выросла: ×100 отсюда маловероятно' };
  return { key: 'large', label: 'Крупная', hint: 'Большая компания: не «ракета»' };
}

export const RISKS = {
  high: 'Высокий риск',
  vhigh: 'Очень высокий риск',
  lottery: 'Лотерея',
};

// ---------- time machine ----------

// What a lump sum or a monthly amount (in dollars) would have become.
// bars must be chronological; start is 'YYYY-MM-DD'.
export function simulate(bars, startIso, amountUsd, monthly, isoOf) {
  const first = bars.findIndex((b) => isoOf(b.d) >= startIso);
  if (first < 0) return null;
  const used = bars.slice(first);
  const value = [], invested = [];
  let shares = 0, put = 0, lastMonth = '';
  used.forEach((b, i) => {
    const ym = isoOf(b.d).slice(0, 7);
    if (i === 0 || (monthly && ym !== lastMonth)) {
      shares += amountUsd / b.p;
      put += amountUsd;
    }
    lastMonth = ym;
    value.push(shares * b.p);
    invested.push(put);
  });

  // The worst fall of the holding from a previous high.
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
