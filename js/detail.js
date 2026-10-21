// The company window: chart with Google-style ranges, my purchases on it,
// my position, my note, and the key facts about the company.

import { data, save, prefs, savePrefs } from './store.js';
import { live, trackSymbol } from './live.js';
import { fetchBars, barIso, lastPrice } from './api.js';
import { positions, valuePositions, capClass, riskLabel, rocketStage } from './calc.js';
import { createChart } from './chart.js';
import { fmtUsd, fmtMine, fmtPct, fmtMult, fmtShares, fmtCap, fmtDate, fmtNum, dirOf, esc, dateFmt, privacy } from './format.js';
import { t } from './i18n.js';
import { $, icon, logo } from './ui.js';
import { capBadge, rocketMeter } from './portfolio.js';
import { removeFromWatch } from './watch.js';
import { actions } from './bus.js';

// CNBC returns more history than the range name says, so each range is
// trimmed: by trading sessions for intraday data, by calendar otherwise.
const RANGES = [
  { key: '1D', api: '1D', sessions: 1, axis: { hour: '2-digit', minute: '2-digit' }, tip: { hour: '2-digit', minute: '2-digit' }, live: true },
  { key: '5D', api: '5D', sessions: 5, axis: { day: 'numeric', month: 'short' }, tip: { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }, live: true, dayTicks: true },
  { key: '1M', api: '1M', months: 1 },
  { key: '6M', api: '6M', months: 6 },
  { key: 'YTD', api: '1Y', ytd: true },
  { key: '1Y', api: '1Y', months: 12 },
  { key: '5Y', api: '5Y', months: 60, axis: { year: 'numeric' }, tip: { day: 'numeric', month: 'short', year: 'numeric' } },
  { key: 'MAX', api: 'ALL', axis: { year: 'numeric' }, tip: { month: 'short', year: 'numeric' } },
];
const DEFAULT_AXIS = { day: 'numeric', month: 'short' };
const DEFAULT_TIP = { day: 'numeric', month: 'short', year: 'numeric' };

const st = { symbol: null, range: '1Y', view: null, seq: 0, timer: 0, chart: null, noteTimer: 0 };

export const detailSymbol = () => st.symbol;

function sliceRange(all, range) {
  if (!all.length) return { bars: [], base: null };
  let start = 0;
  if (range.sessions) {
    const days = [...new Set(all.map((b) => b.d.slice(0, 8)))].slice(-range.sessions);
    start = all.findIndex((b) => b.d.slice(0, 8) === days[0]);
  } else if (range.ytd) {
    const year = all[all.length - 1].d.slice(0, 4);
    start = all.findIndex((b) => b.d.slice(0, 4) === year);
  } else if (range.months) {
    const cut = new Date(all[all.length - 1].t);
    cut.setMonth(cut.getMonth() - range.months);
    start = all.findIndex((b) => b.t >= cut.getTime());
  }
  if (start < 0) start = 0;
  const bars = all.slice(start);
  return { bars, base: start > 0 ? all[start - 1].p : bars[0].p };
}

// tradeTime is the exchange's wall-clock time; format it as such.
const barDate = (d) => new Date(Date.UTC(+d.slice(0, 4), +d.slice(4, 6) - 1, +d.slice(6, 8), +d.slice(8, 10), +d.slice(10, 12)));
const utcFmt = (opts) => dateFmt({ timeZone: 'UTC', ...opts });
const clean = (s) => s.replace(/\s?г\.$/, '');

export function setupDetail() {
  const dlg = $('#detail');
  st.range = RANGES.some((r) => r.key === prefs.range) ? prefs.range : '1Y';
  paintRanges();
  $('.ranges', dlg).addEventListener('click', (e) => {
    const b = e.target.closest('[data-range]');
    if (!b) return;
    st.range = b.dataset.range;
    prefs.range = st.range;
    savePrefs();
    loadRange();
  });
  st.chart = createChart($('#d-chart'));

  $('.d-actions', dlg).addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]');
    if (!b || !st.symbol) return;
    const act = b.dataset.act;
    if (act === 'buy' || act === 'sell') actions.openTx({ type: act, symbol: st.symbol });
    else if (act === 'watch') {
      if (data.watch.some((w) => w.symbol === st.symbol)) removeFromWatch(st.symbol);
      else actions.openWatch({ symbol: st.symbol });
    }
  });

  $('#d-position').addEventListener('click', (e) => {
    const li = e.target.closest('[data-tx]');
    if (li) actions.openTx({ id: li.dataset.tx });
  });
  $('#d-position').addEventListener('keydown', (e) => {
    const li = e.target.closest('[data-tx]');
    if (li && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); actions.openTx({ id: li.dataset.tx }); }
  });
  $('#d-watch-info').addEventListener('click', (e) => {
    if (e.target.closest('[data-act="edit-watch"]')) actions.openWatch({ symbol: st.symbol });
  });

  const note = $('#d-note');
  note.addEventListener('input', () => {
    clearTimeout(st.noteTimer);
    $('#d-note-status').textContent = t('d.saving');
    st.noteTimer = setTimeout(saveNote, 500);
  });
  note.addEventListener('blur', saveNote);

  dlg.addEventListener('close', () => {
    saveNote();
    st.symbol = null;
    clearInterval(st.timer);
    actions.refresh();
  });
}

// Range tab labels follow the language.
export function paintRanges() {
  $('#detail .ranges').innerHTML = RANGES.map((r) => `<button type="button" role="tab" data-range="${r.key}" aria-selected="${r.key === st.range}">${t('range.' + r.key)}</button>`).join('');
}

function saveNote() {
  clearTimeout(st.noteTimer);
  if (!st.symbol) return;
  const text = $('#d-note').value.trim();
  if ((data.notes[st.symbol] || '') === text) { $('#d-note-status').textContent = t('d.noteAuto'); return; }
  if (text) data.notes[st.symbol] = text; else delete data.notes[st.symbol];
  save();
  $('#d-note-status').textContent = t('d.saved');
}

export function openDetail(symbol) {
  const dlg = $('#detail');
  st.symbol = symbol;
  st.view = null;
  trackSymbol(symbol);
  $('#d-symbol').textContent = symbol;
  $('#d-logo').innerHTML = logo(symbol);
  $('.d-name', dlg).textContent = data.names[symbol] || '';
  $('#d-note').value = data.notes[symbol] || '';
  $('#d-note-status').textContent = t('d.noteAuto');
  const enc = encodeURIComponent(symbol);
  $('#d-link-yahoo').href = 'https://finance.yahoo.com/quote/' + enc;
  $('#d-link-cnbc').href = 'https://www.cnbc.com/quotes/' + enc;
  $('#d-link-news').href = 'https://www.google.com/search?tbm=nws&q=' + encodeURIComponent(symbol + ' stock');
  renderDetail();
  if (!dlg.open) dlg.showModal();
  $('.sheet-body', dlg).scrollTop = 0;
  loadRange();
  clearInterval(st.timer);
  st.timer = setInterval(() => {
    const r = RANGES.find((x) => x.key === st.range);
    if (r.live && document.visibilityState === 'visible') loadRange(true);
  }, 60_000);
}

async function loadRange(quiet) {
  const symbol = st.symbol;
  if (!symbol) return;
  const range = RANGES.find((r) => r.key === st.range);
  const my = ++st.seq;
  $('#detail').querySelectorAll('.ranges button').forEach((b) => b.setAttribute('aria-selected', b.dataset.range === range.key));
  if (!quiet) st.chart.message(t('loading'));
  let all;
  try {
    all = await fetchBars(symbol, range.api);
  } catch (err) {
    console.warn(err);
    if (my === st.seq) st.chart.message(t('d.noConn'));
    return;
  }
  if (my !== st.seq || symbol !== st.symbol) return;
  const { bars, base } = sliceRange(all, range);
  const pc = live.quotes[symbol]?.pc;
  st.view = { bars, base: range.key === '1D' && pc != null ? pc : base, range };
  drawChart();
  renderDetail();
}

function drawChart() {
  const view = st.view;
  if (!view) return;
  if (view.bars.length < 2) {
    st.chart.message(t('d.noData'));
    $('#d-legend').hidden = true;
    return;
  }
  const { bars, base, range } = view;
  const prices = bars.map((b) => b.p);
  const up = prices[prices.length - 1] >= (base ?? prices[0]);

  // My purchases and sales that fall inside the drawn period.
  const firstDay = barIso(bars[0].d);
  const markers = [];
  for (const tx of data.txs) {
    if (tx.symbol !== st.symbol || tx.date < firstDay) continue;
    // Weekly bars may end before a recent purchase; pin it to the last point.
    let i = bars.findIndex((b) => barIso(b.d) >= tx.date);
    if (i < 0) i = bars.length - 1;
    markers.push({ i, v: tx.price, kind: tx.type });
  }
  const pos = positions(data.txs).find((p) => p.symbol === st.symbol && p.open);
  const series = [{ values: prices, color: up ? 'var(--up)' : 'var(--down)', fill: true }];
  if (pos && pos.avgUsd) series.push({ values: prices.map(() => pos.avgUsd), color: 'var(--accent)', dashed: true, width: 1.5 });

  const axisFmt = utcFmt(range.axis || DEFAULT_AXIS);
  const tipFmt = utcFmt(range.tip || DEFAULT_TIP);
  let xTicks;
  if (range.dayTicks) {
    xTicks = [];
    bars.forEach((b, i) => { if (i === 0 || b.d.slice(0, 8) !== bars[i - 1].d.slice(0, 8)) xTicks.push(i); });
  }
  st.chart.draw({
    n: bars.length,
    series,
    markers,
    xTicks,
    baseline: range.key === '1D' ? base : null,
    yFmt: (v) => fmtUsd(v).replace(/[.,]00(?=\D*$)/, ''),
    xLabel: (i) => clean(axisFmt.format(barDate(bars[i].d))),
    tip: (i) => [fmtUsd(bars[i].p), clean(tipFmt.format(barDate(bars[i].d)))],
  });
  $('#d-legend').hidden = !markers.length && !(pos && pos.avgUsd);
  $('#d-legend').querySelectorAll('span').forEach((s, k) => {
    s.hidden = k === 0 ? !markers.some((m) => m.kind === 'buy') : k === 1 ? !markers.some((m) => m.kind === 'sell') : !(pos && pos.avgUsd);
  });
}

// Everything except the chart; cheap enough to redo on each quote.
export function renderDetail() {
  const symbol = st.symbol;
  if (!symbol) return;
  const dlg = $('#detail');
  const q = live.quotes[symbol];
  if (data.names[symbol]) $('.d-name', dlg).textContent = data.names[symbol];

  const range = RANGES.find((r) => r.key === st.range);
  if (q) {
    $('.d-price', dlg).textContent = fmtUsd(q.c);
    let d = q.d, dp = q.dp;
    if (range.key !== '1D' && st.view && st.view.base) {
      d = q.c - st.view.base;
      dp = (d / st.view.base) * 100;
    }
    const ch = $('.d-change', dlg);
    ch.textContent = `${fmtUsd(d, { signed: true })} (${fmtPct(dp, 2)})`;
    ch.dataset.dir = dirOf(d);
    $('.d-period', dlg).textContent = t('period.' + range.key);
    const ext = $('.d-ext', dlg);
    ext.hidden = !q.ext;
    if (q.ext) {
      ext.innerHTML = `${t(q.ext.type === 'PRE_MKT' ? 'd.pre' : 'd.post')}: <b>${fmtUsd(q.ext.c)}</b> <span data-dir="${dirOf(q.ext.d)}">${fmtPct(q.ext.dp, 2)}</span>`;
    }
  } else {
    $('.d-price', dlg).textContent = '…';
    $('.d-change', dlg).textContent = '';
    $('.d-period', dlg).textContent = '';
  }

  const watched = data.watch.find((w) => w.symbol === symbol);
  const cls = capClass(q?.cap);
  $('.d-badges', dlg).innerHTML = [
    capBadge(q?.cap),
    cls ? `<span class="small muted">${esc(cls.hint)}</span>` : '',
    watched?.risk ? `<span class="badge risk-${watched.risk}">${esc(riskLabel(watched.risk))}</span>` : '',
    q && !q.realTime ? `<span class="badge">${t('d.delayed')}</span>` : '',
  ].join(' ');
  $('[data-act="watch"]', dlg).innerHTML = `${icon('eye', 16)} ${watched ? t('d.unwatch') : t('d.watch')}`;

  renderPosition(symbol);
  renderWatchInfo(watched, q);

  const rows = [
    [t('d.cap'), q?.cap ? fmtCap(q.cap) : q?.capView],
    [t('d.yrhi'), q?.yrhi != null ? fmtUsd(q.yrhi) : null],
    [t('d.yrlo'), q?.yrlo != null ? fmtUsd(q.yrlo) : null],
    [t('d.open'), q?.o != null ? fmtUsd(q.o) : null],
    [t('d.prevClose'), q?.pc != null ? fmtUsd(q.pc) : null],
    [t('d.volume'), q?.vol],
    ['P/E', q?.pe],
    [t('d.exchange'), q?.exchange],
  ].filter(([, v]) => v && v !== '—');
  $('#d-stats').innerHTML = rows.map(([k, v]) => `<div><dt class="muted">${k}</dt><dd>${esc(v)}</dd></div>`).join('');
}

function renderPosition(symbol) {
  const el = $('#d-position');
  const p = valuePositions(positions(data.txs).filter((x) => x.symbol === symbol), live.quotes, live.fx)[0];
  if (!p) { el.hidden = true; el.innerHTML = ''; return; }
  el.hidden = false;
  const txs = [...p.txs].reverse();
  el.innerHTML = `
    <h3>${t('d.myPosition')}</h3>
    ${p.open ? `
      <dl class="pos-grid">
        <div><dt class="muted">${t('pf.shares')}</dt><dd>${fmtShares(p.shares)}</dd></div>
        <div><dt class="muted">${t('d.avgPrice')}</dt><dd>${fmtUsd(p.avgUsd)}</dd></div>
        <div><dt class="muted">${t('pf.invested')}</dt><dd>${fmtMine(p.costIls)}</dd></div>
        <div><dt class="muted">${t('d.worth')}</dt><dd>${fmtMine(p.valueIls)}</dd></div>
        <div><dt class="muted">${t('d.result')}</dt><dd data-dir="${dirOf(p.gainIls ?? 0)}">${p.gainIls == null ? '—' : privacy.on ? fmtPct(p.gainPct) : fmtMine(p.gainIls, { signed: true })}</dd></div>
        <div><dt class="muted">${t('d.mult')}</dt><dd><b>${fmtMult(p.mult)}</b></dd></div>
      </dl>
      ${rocketMeter(p.mult)}
      <div class="meter-label small muted">${rocketStage(p.mult)}</div>` : `
      <p class="small">${t('d.closed', { a: fmtMine(p.investedIls), b: fmtMine(p.proceedsIls) })}
        <b data-dir="${dirOf(p.realizedIls)}">${fmtMine(p.realizedIls, { signed: true })}</b>.</p>`}
    ${p.open && p.realizedIls ? `<p class="small muted">${t('d.realized')} <span data-dir="${dirOf(p.realizedIls)}">${fmtMine(p.realizedIls, { signed: true })}</span></p>` : ''}
    <h4>${t('d.records')} <span class="muted small">${t('d.recordsHint')}</span></h4>
    <ul class="tx-list">
      ${txs.map((x) => {
        const ils = x.shares * x.price * x.fx;
        return `<li data-tx="${esc(x.id)}" tabindex="0" role="button">
          <span class="tx-kind ${x.type}">${t(x.type === 'buy' ? 'tx.buy' : 'tx.sell')}</span>
          <span>${fmtDate(x.date)}</span>
          <span class="muted">${t('d.txLine', { n: fmtShares(x.shares), p: fmtUsd(x.price), fx: fmtNum(x.fx, 3, 2) })}</span>
          <b>${fmtMine(x.type === 'buy' ? ils + x.fee : ils - x.fee)}</b>
          ${x.note ? `<span class="tx-note muted" dir="auto">${esc(x.note)}</span>` : ''}
        </li>`;
      }).join('')}
    </ul>`;
}

function renderWatchInfo(w, q) {
  const el = $('#d-watch-info');
  if (!w) { el.hidden = true; el.innerHTML = ''; return; }
  const price = lastPrice(q);
  const since = w.addedPrice && price != null ? ((price - w.addedPrice) / w.addedPrice) * 100 : null;
  el.hidden = false;
  el.innerHTML = `
    <div class="rules-head">
      <h3>${t('d.watching')}</h3>
      <button type="button" class="btn ghost small-btn" data-act="edit-watch">${icon('edit', 16)} ${t('edit')}</button>
    </div>
    <p class="small">${w.added ? t('w.since', { d: fmtDate(w.added) }) : t('w.sinceAdded')}${w.addedPrice ? ' ' + t('d.wasPrice', { p: fmtUsd(w.addedPrice) }) : ''}
      <b data-dir="${dirOf(since ?? 0)}">${fmtPct(since)}</b>${w.source ? ` · <span class="muted">${esc(w.source)}</span>` : ''}</p>
    ${w.why ? `<div class="why" dir="auto">${esc(w.why)}</div>` : ''}`;
}

export function refreshDetail() {
  if (!st.symbol) return;
  renderDetail();
  if (st.view) drawChart();
}
