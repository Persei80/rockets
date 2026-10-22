// Portfolio: what I own, what it's worth now, how the whole thing grew,
// and how far each rocket has flown.

import { data, prefs, savePrefs } from './store.js';
import { live } from './live.js';
import { fetchBars, fxSeries } from './api.js';
import { positions, valuePositions, totals, rocketPos, rocketStage, capClass, portfolioHistory, historyApi, sortedTxs, netIfSold } from './calc.js';
import { createChart } from './chart.js';
import { fmtMine, fmtPct, fmtMult, fmtShares, fmtUsd, fmtYears, fmtDate, fmtIlsShort, dirOf, esc, parseIso, privacy } from './format.js';
import { t, tp } from './i18n.js';
import { $, icon, logo } from './ui.js';
import { countUp } from './effects.js';
import { actions } from './bus.js';

export const ROCKET = '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M12 2.5c3.2 2.2 5 5.8 5 10.2l-2 2.8H9l-2-2.8c0-4.4 1.8-8 5-10.2z" fill="currentColor"/><circle cx="12" cy="9.5" r="1.8" fill="var(--surface)"/><path d="M9 15.5l-2.6 3.3L9 18.3zM15 15.5l2.6 3.3-2.6-.5z" fill="currentColor"/><path class="flame" d="M10.4 16.5h3.2L12 22z" fill="#f59e0b"/></svg>';

export function capBadge(cap) {
  const c = capClass(cap);
  return c ? `<span class="badge cap-${c.key}" title="${esc(c.hint)}">${esc(c.label)}</span>` : '';
}

export function rocketMeter(mult) {
  const pos = rocketPos(mult);
  return `
    <div class="rocket-meter" style="--pos:${pos.toFixed(4)}" data-dir="${mult == null ? 'flat' : mult >= 1 ? 'up' : 'down'}" role="img" aria-label="${esc(fmtMult(mult) + ' ' + rocketStage(mult))}">
      <div class="track">
        <div class="fill"></div>
        <span class="tick" style="left:33.333%"><i></i>×1</span>
        <span class="tick" style="left:66.667%"><i></i>×10</span>
        <span class="tick last" style="left:100%"><i></i>×100</span>
        <div class="ship">${ROCKET}</div>
      </div>
    </div>`;
}

const yearsSince = (iso) => (Date.now() - parseIso(iso).getTime()) / (365.25 * 86_400_000);

// ---------- pieces ----------

function card(p) {
  const dir = dirOf(p.gainIls ?? 0);
  return `
    <article class="card pos" data-symbol="${esc(p.symbol)}" tabindex="0" role="button" aria-label="${esc(p.symbol)}">
      <div class="card-head">
        ${logo(p.symbol)}
        <div class="ident">
          <div class="symbol">${esc(p.symbol)} ${capBadge(p.quote?.cap)}</div>
          <div class="name muted">${esc(data.names[p.symbol] || '')}</div>
        </div>
        ${p.todayPct != null ? `<div class="today small" data-dir="${dirOf(p.todayPct)}" title="${esc(t('pf.todayTip'))}">${fmtPct(p.todayPct, 2)}</div>` : ''}
      </div>
      <div class="pos-value">
        <span class="big">${fmtMine(p.valueIls)}</span>
        <span class="gain" data-dir="${dir}">${p.gainIls == null ? '' : (privacy.on ? '' : fmtMine(p.gainIls, { signed: true }) + ' ') + '(' + fmtPct(p.gainPct) + ')'}</span>
      </div>
      ${rocketMeter(p.mult)}
      <div class="meter-label small"><b>${fmtMult(p.mult)}</b> <span class="muted">${rocketStage(p.mult)}</span></div>
      <dl class="mini small">
        <div><dt class="muted">${t('pf.invested')}</dt><dd>${fmtMine(p.costIls)}</dd></div>
        <div><dt class="muted">${t('pf.shares')}</dt><dd>${fmtShares(p.shares)}</dd></div>
        <div><dt class="muted">${t('pf.priceNow')}</dt><dd>${fmtUsd(p.price)}</dd></div>
        <div><dt class="muted">${t('pf.held')}</dt><dd>${fmtYears(yearsSince(p.firstDate))}</dd></div>
      </dl>
    </article>`;
}

function tableRow(p) {
  return `
    <tr data-symbol="${esc(p.symbol)}" tabindex="0">
      <td><div class="t-co">${logo(p.symbol)}<div><b>${esc(p.symbol)}</b><div class="muted small">${esc(data.names[p.symbol] || '')}</div></div></div></td>
      <td class="num">${fmtMine(p.valueIls)}</td>
      <td class="num">${fmtMine(p.costIls)}</td>
      <td class="num" data-dir="${dirOf(p.gainIls ?? 0)}">${privacy.on ? '' : fmtMine(p.gainIls, { signed: true }) + '<br>'}<small>${fmtPct(p.gainPct)}</small></td>
      <td class="num"><b>${fmtMult(p.mult)}</b></td>
      <td class="num" data-dir="${dirOf(p.todayPct ?? 0)}">${fmtPct(p.todayPct, 2)}</td>
      <td class="num">${fmtYears(yearsSince(p.firstDate))}</td>
    </tr>`;
}

function closedRow(p) {
  return `
    <li class="closed-row" data-symbol="${esc(p.symbol)}" tabindex="0" role="button">
      <strong>${esc(p.symbol)}</strong>
      <span class="muted">${esc(data.names[p.symbol] || '')}</span>
      <span>${t('pf.closedLine', { a: fmtMine(p.investedIls), b: fmtMine(p.proceedsIls) })}</span>
      <span class="gain" data-dir="${dirOf(p.realizedIls)}">${fmtMine(p.realizedIls, { signed: true })}</span>
    </li>`;
}

function emptyState() {
  return `
    <div class="empty-hero card">
      <div class="hero-ship">${ROCKET}</div>
      <h2>${t('pf.emptyTitle')}</h2>
      <p class="muted">${t('pf.emptyText')}</p>
      <div class="btn-row center">
        <button type="button" class="btn primary" data-go="buy">${icon('plus')} ${t('pf.addBuy')}</button>
        <button type="button" class="btn" data-go="watch">${icon('eye')} ${t('pf.addCandidates')}</button>
        <button type="button" class="btn" data-go="machine">${icon('clock')} ${t('tab.machine')}</button>
      </div>
    </div>`;
}

const SORTS = ['value', 'gain', 'mult', 'today', 'name', 'date'];
function sortList(list) {
  const by = prefs.pfSort;
  const num = (v) => (v == null ? -Infinity : v);
  const cmp = {
    value: (a, b) => num(b.valueIls) - num(a.valueIls),
    gain: (a, b) => num(b.gainPct) - num(a.gainPct),
    mult: (a, b) => num(b.mult) - num(a.mult),
    today: (a, b) => num(b.todayPct) - num(a.todayPct),
    name: (a, b) => a.symbol.localeCompare(b.symbol),
    date: (a, b) => a.firstDate.localeCompare(b.firstDate),
  }[by] || ((a, b) => num(b.valueIls) - num(a.valueIls));
  return list.sort(cmp);
}

// ---------- history chart ----------

const HIST_RANGES = [
  { key: '1M', months: 1 }, { key: '6M', months: 6 }, { key: '1Y', months: 12 }, { key: 'ALL' },
];
const hist = { key: '', data: null, loading: false, chart: null, seq: 0 };

async function loadHistory() {
  const key = JSON.stringify(data.txs.map((x) => [x.symbol, x.type, x.date, x.shares]));
  if (hist.key === key && (hist.data || hist.loading)) return;
  hist.key = key;
  hist.loading = true;
  hist.data = null;
  const my = ++hist.seq;
  const txs = sortedTxs(data.txs);
  const api = historyApi(txs[0].date);
  const symbols = [...new Set(txs.map((x) => x.symbol))];
  const [bars, fx] = await Promise.all([
    Promise.all(symbols.map((s) => fetchBars(s, api).catch(() => []))),
    fxSeries(txs[0].date),
  ]);
  if (my !== hist.seq) return;
  hist.data = { barsBy: Object.fromEntries(symbols.map((s, i) => [s, bars[i]])), fx };
  hist.loading = false;
  drawHistory();
}

function drawHistory() {
  const wrap = document.getElementById('pf-hist-chart');
  if (!wrap) return;
  if (!hist.chart || hist.chart.wrap !== wrap) hist.chart = Object.assign(createChart(wrap), { wrap });
  if (!hist.data) { hist.chart.message(t('loading')); return; }
  const liveNow = Object.fromEntries(Object.entries(live.quotes).map(([s, q]) => [s, q.ext ? q.ext.c : q.c]));
  const h = portfolioHistory(data.txs, hist.data.barsBy, hist.data.fx, live.fx, liveNow);
  if (!h || h.dates.length < 2) { hist.chart.message(t('pf.histSoon')); return; }
  const range = HIST_RANGES.find((r) => r.key === prefs.histRange) || HIST_RANGES[3];
  let start = 0;
  if (range.months) {
    const cut = new Date();
    cut.setMonth(cut.getMonth() - range.months);
    const iso = cut.toISOString().slice(0, 10);
    start = Math.max(0, h.dates.findIndex((d) => d >= iso));
  }
  const dates = h.dates.slice(start), value = h.value.slice(start), cost = h.cost.slice(start);
  if (dates.length < 2) { hist.chart.message(t('pf.histSoon')); return; }
  const up = value[value.length - 1] >= cost[cost.length - 1];
  const span = (parseIso(dates[dates.length - 1]) - parseIso(dates[0])) / 86_400_000;
  const xOpts = span > 400 ? { month: 'short', year: '2-digit' } : { day: 'numeric', month: 'short' };
  hist.chart.draw({
    n: dates.length,
    series: [
      { values: value, color: up ? 'var(--up)' : 'var(--down)', fill: true },
      { values: cost, color: 'var(--muted)', dashed: true, width: 1.5 },
    ],
    yFmt: (v) => fmtIlsShort(v, true),
    xLabel: (i) => fmtDate(dates[i], xOpts),
    tip: (i) => {
      const g = cost[i] > 0 ? ((value[i] - cost[i]) / cost[i]) * 100 : 0;
      return privacy.on
        ? [fmtPct(g), fmtDate(dates[i])]
        : [fmtMine(value[i]), `${fmtDate(dates[i])} · ${t('pf.histCost')} ${fmtMine(cost[i])} · ${fmtPct(g)}`];
    },
  });
}

// ---------- render ----------

function skeleton(el) {
  el.innerHTML = `
    <div class="summary card" id="pf-summary"></div>
    <div class="card hist">
      <div class="hist-head">
        <h3>${t('pf.history')}</h3>
        <div class="seg small" id="pf-hist-ranges">
          ${HIST_RANGES.map((r) => `<button type="button" data-hist="${r.key}" aria-pressed="${prefs.histRange === r.key}">${t('hist.' + r.key)}</button>`).join('')}
        </div>
      </div>
      <div class="chart-wrap hist-chart" id="pf-hist-chart">
        <svg aria-hidden="true"></svg>
        <div class="chart-tip" hidden><span class="tip-main"></span><span class="tip-sub muted"></span></div>
        <p class="chart-msg muted" hidden></p>
      </div>
      <div class="chart-legend small muted">
        <span><i class="lg val"></i>${t('pf.histValue')}</span>
        <span><i class="lg put"></i>${t('pf.histCostLegend')}</span>
      </div>
    </div>
    <div class="section-head">
      <h2>${t('pf.title')}</h2>
      <div class="head-tools">
        <label class="sort small muted">${t('sort')}
          <select id="pf-sort">${SORTS.map((k) => `<option value="${k}"${prefs.pfSort === k ? ' selected' : ''}>${t('pf.sort.' + k)}</option>`).join('')}</select>
        </label>
        <div class="seg small" id="pf-view" role="group" aria-label="${esc(t('pf.viewAria'))}">
          <button type="button" data-pfview="cards" aria-pressed="${prefs.pfView !== 'table'}" title="${esc(t('pf.viewCards'))}">${icon('cards', 16)}</button>
          <button type="button" data-pfview="table" aria-pressed="${prefs.pfView === 'table'}" title="${esc(t('pf.viewTable'))}">${icon('table', 16)}</button>
        </div>
        <button type="button" class="btn primary" data-go="buy">${icon('plus')} ${t('pf.addBuy')}</button>
      </div>
    </div>
    <div id="pf-list"></div>
    <div id="pf-closed"></div>
    <p class="small muted footnote">${t('pf.footnote')}</p>`;
  el.dataset.built = '1';
}

let counted = false;

export function renderPortfolio(el, { force = false } = {}) {
  if (!data.txs.length) {
    el.innerHTML = emptyState();
    delete el.dataset.built;
    return;
  }
  if (force || !el.dataset.built) skeleton(el);

  const list = valuePositions(positions(data.txs), live.quotes, live.fx);
  const open = sortList(list.filter((p) => p.open));
  const closed = list.filter((p) => !p.open);
  const tt = totals(list);
  const best = open.filter((p) => p.mult != null).sort((a, b) => b.mult - a.mult)[0];
  const known = !tt.missing && live.fx;

  $('#pf-summary', el).innerHTML = `
    <div class="sum-main">
      <div class="muted small">${t('pf.worthNow')}</div>
      <div class="sum-value" id="pf-total">${known ? fmtMine(tt.value) : '…'}</div>
      <div class="gain" data-dir="${dirOf(tt.result)}">
        ${known ? `${privacy.on ? '' : fmtMine(tt.result, { signed: true }) + ' '}(${fmtPct(tt.resultPct)}) ${t('pf.allTime')}` : ''}
      </div>
      ${known && tt.value > 0 && !privacy.on ? `<div class="small muted if-sold-sum" title="${esc(t('pf.ifSoldTip'))}">${t('pf.ifSold', { v: fmtMine(netIfSold(tt.value, tt.cost).net) })}</div>` : ''}
    </div>
    <dl class="sum-stats">
      <div><dt class="muted">${t('pf.investedTotal')}</dt><dd>${fmtMine(tt.invested)}</dd></div>
      <div><dt class="muted">${t('pf.today')}</dt><dd class="gain" data-dir="${dirOf(tt.today)}">${known ? (privacy.on ? fmtPct(tt.todayPct, 2) : fmtMine(tt.today, { signed: true })) : '…'}</dd></div>
      <div><dt class="muted">${t('pf.best')}</dt><dd>${best ? `${esc(best.symbol)} <span class="gain" data-dir="${dirOf(best.mult - 1)}">${fmtMult(best.mult)}</span>` : '—'}</dd></div>
      <div><dt class="muted">${t('pf.companies')}</dt><dd>${tt.open}</dd></div>
    </dl>`;
  // The big number counts up once per visit, when the real value is known.
  if (known && !counted && !privacy.on) {
    counted = true;
    countUp($('#pf-total', el), tt.value, (v) => fmtMine(v));
  }

  $('#pf-list', el).innerHTML = !open.length ? `<p class="muted">${t('pf.noOpen')}</p>`
    : prefs.pfView === 'table'
      ? `<div class="table-wrap card"><table class="pf-table">
          <thead><tr><th>${t('pf.col.company')}</th><th class="num">${t('pf.col.value')}</th><th class="num">${t('pf.col.invested')}</th><th class="num">${t('pf.col.result')}</th><th class="num">×</th><th class="num">${t('pf.col.today')}</th><th class="num">${t('pf.col.held')}</th></tr></thead>
          <tbody>${open.map(tableRow).join('')}</tbody></table></div>`
      : `<div class="grid">${open.map(card).join('')}</div>`;

  const closedEl = $('#pf-closed', el);
  const wasOpen = closedEl.querySelector('details')?.open;
  closedEl.innerHTML = closed.length ? `
    <details class="closed card"${wasOpen ? ' open' : ''}>
      <summary>${tp('pf.closed', closed.length)}</summary>
      <ul>${closed.map(closedRow).join('')}</ul>
    </details>` : '';

  loadHistory();
  const wrap = $('#pf-hist-chart', el);
  if (!wrap.matches(':hover')) drawHistory();
}
renderPortfolio.reset = () => { counted = false; };

export function setupPortfolio(el) {
  el.addEventListener('click', (e) => {
    const go = e.target.closest('[data-go]');
    if (go) {
      if (go.dataset.go === 'buy') actions.openTx({ type: 'buy' });
      else if (go.dataset.go === 'watch') { actions.show('watch'); actions.openWatch({}); }
      else actions.show(go.dataset.go);
      return;
    }
    const hb = e.target.closest('[data-hist]');
    if (hb) {
      prefs.histRange = hb.dataset.hist;
      savePrefs();
      el.querySelectorAll('[data-hist]').forEach((b) => b.setAttribute('aria-pressed', b === hb));
      drawHistory();
      return;
    }
    const vb = e.target.closest('[data-pfview]');
    if (vb) {
      prefs.pfView = vb.dataset.pfview;
      savePrefs();
      el.querySelectorAll('[data-pfview]').forEach((b) => b.setAttribute('aria-pressed', b === vb));
      renderPortfolio(el);
      return;
    }
    const item = e.target.closest('[data-symbol]');
    if (item) actions.openDetail(item.dataset.symbol);
  });
  el.addEventListener('change', (e) => {
    if (e.target.id === 'pf-sort') {
      prefs.pfSort = e.target.value;
      savePrefs();
      renderPortfolio(el);
    }
  });
  el.addEventListener('keydown', (e) => {
    const item = e.target.closest('[data-symbol]');
    if (item && (e.key === 'Enter' || e.key === ' ') && e.target === item) { e.preventDefault(); actions.openDetail(item.dataset.symbol); }
  });
}
