// The company window: chart with Google-style ranges, my purchases on it,
// my position, my note, and the key facts about the company.

import { data, save, prefs, savePrefs } from './store.js';
import { live, trackSymbol } from './live.js';
import { fetchBars, barIso, lastPrice } from './api.js';
import { positions, valuePositions, capClass, RISKS, rocketStage } from './calc.js';
import { createChart } from './chart.js';
import { fmtUsd, fmtIls, fmtPct, fmtSigned, fmtMult, fmtShares, fmtCap, fmtDate, fmtNum, dirOf, esc, LOCALE } from './format.js';
import { $, icon } from './ui.js';
import { capBadge, rocketMeter } from './portfolio.js';
import { removeFromWatch } from './watch.js';
import { actions } from './bus.js';

// CNBC returns more history than the range name says, so each range is
// trimmed: by trading sessions for intraday data, by calendar otherwise.
const RANGES = [
  { key: '1D', label: '1 д', period: 'сегодня', api: '1D', sessions: 1, axis: { hour: '2-digit', minute: '2-digit' }, tip: { hour: '2-digit', minute: '2-digit' }, live: true },
  { key: '5D', label: '5 д', period: 'за 5 дней', api: '5D', sessions: 5, axis: { day: 'numeric', month: 'short' }, tip: { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }, live: true, dayTicks: true },
  { key: '1M', label: '1 м', period: 'за месяц', api: '1M', months: 1 },
  { key: '6M', label: '6 м', period: 'за полгода', api: '6M', months: 6 },
  { key: 'YTD', label: 'С янв.', period: 'с начала года', api: '1Y', ytd: true },
  { key: '1Y', label: '1 г', period: 'за год', api: '1Y', months: 12 },
  { key: '5Y', label: '5 л', period: 'за 5 лет', api: '5Y', months: 60, axis: { year: 'numeric' }, tip: { day: 'numeric', month: 'short', year: 'numeric' } },
  { key: 'MAX', label: 'Всё', period: 'за всё время', api: 'ALL', axis: { year: 'numeric' }, tip: { month: 'short', year: 'numeric' } },
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
const dateFmt = (opts) => new Intl.DateTimeFormat(LOCALE, { timeZone: 'UTC', ...opts });

export function setupDetail() {
  const dlg = $('#detail');
  st.range = RANGES.some((r) => r.key === prefs.range) ? prefs.range : '1Y';
  $('.ranges', dlg).innerHTML = RANGES.map((r) => `<button type="button" role="tab" data-range="${r.key}">${r.label}</button>`).join('');
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
  $('#d-watch-info').addEventListener('click', (e) => {
    if (e.target.closest('[data-act="edit-watch"]')) actions.openWatch({ symbol: st.symbol });
  });

  const note = $('#d-note');
  note.addEventListener('input', () => {
    clearTimeout(st.noteTimer);
    $('#d-note-status').textContent = 'Сохраняю…';
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

function saveNote() {
  clearTimeout(st.noteTimer);
  if (!st.symbol) return;
  const text = $('#d-note').value.trim();
  if ((data.notes[st.symbol] || '') === text) { $('#d-note-status').textContent = 'Заметка сохраняется сама'; return; }
  if (text) data.notes[st.symbol] = text; else delete data.notes[st.symbol];
  save();
  $('#d-note-status').textContent = 'Сохранено';
}

export function openDetail(symbol) {
  const dlg = $('#detail');
  st.symbol = symbol;
  st.view = null;
  trackSymbol(symbol);
  $('#d-symbol').textContent = symbol;
  $('.d-name', dlg).textContent = data.names[symbol] || '';
  $('#d-note').value = data.notes[symbol] || '';
  $('#d-note-status').textContent = 'Заметка сохраняется сама';
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
  if (!quiet) st.chart.message('Загружаю…');
  let all;
  try {
    all = await fetchBars(symbol, range.api);
  } catch (err) {
    console.warn(err);
    if (my === st.seq) st.chart.message('Нет связи. Попробуйте ещё раз чуть позже.');
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
    st.chart.message('Нет данных за этот период');
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

  const axisFmt = dateFmt(range.axis || DEFAULT_AXIS);
  const tipFmt = dateFmt(range.tip || DEFAULT_TIP);
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
    yFmt: (v) => fmtUsd(v).replace(/,00$/, ''),
    xLabel: (i) => axisFmt.format(barDate(bars[i].d)).replace(/\s?г\.$/, ''),
    tip: (i) => [fmtUsd(bars[i].p), tipFmt.format(barDate(bars[i].d)).replace(/\s?г\.$/, '')],
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
    ch.textContent = `${fmtSigned(d)} (${fmtPct(dp, 2)})`;
    ch.dataset.dir = dirOf(d);
    $('.d-period', dlg).textContent = range.period;
    const ext = $('.d-ext', dlg);
    ext.hidden = !q.ext;
    if (q.ext) {
      ext.innerHTML = `${q.ext.type === 'PRE_MKT' ? 'До открытия' : 'После закрытия'}: <b>${fmtUsd(q.ext.c)}</b> <span data-dir="${dirOf(q.ext.d)}">${fmtPct(q.ext.dp, 2)}</span>`;
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
    watched?.risk ? `<span class="badge risk-${watched.risk}">${RISKS[watched.risk]}</span>` : '',
    q && !q.realTime ? '<span class="badge">с задержкой</span>' : '',
  ].join(' ');
  $('[data-act="watch"]', dlg).innerHTML = watched ? `${icon('eye', 16)} Убрать из наблюдения` : `${icon('eye', 16)} В наблюдение`;

  renderPosition(symbol);
  renderWatchInfo(watched, q);

  const rows = [
    ['Стоимость компании', q?.cap ? fmtCap(q.cap) : q?.capView],
    ['Макс. за год', q?.yrhi != null ? fmtUsd(q.yrhi) : null],
    ['Мин. за год', q?.yrlo != null ? fmtUsd(q.yrlo) : null],
    ['Открытие', q?.o != null ? fmtUsd(q.o) : null],
    ['Вчера закрылась', q?.pc != null ? fmtUsd(q.pc) : null],
    ['Объём торгов', q?.vol],
    ['P/E', q?.pe],
    ['Биржа', q?.exchange],
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
    <h3>Моя позиция</h3>
    ${p.open ? `
      <dl class="pos-grid">
        <div><dt class="muted">Акций</dt><dd>${fmtShares(p.shares)}</dd></div>
        <div><dt class="muted">Средняя цена</dt><dd>${fmtUsd(p.avgUsd)}</dd></div>
        <div><dt class="muted">Вложено</dt><dd>${fmtIls(p.costIls)}</dd></div>
        <div><dt class="muted">Стоит сейчас</dt><dd>${fmtIls(p.valueIls)}</dd></div>
        <div><dt class="muted">Результат</dt><dd data-dir="${dirOf(p.gainIls ?? 0)}">${p.gainIls == null ? '—' : fmtIls(p.gainIls, { signed: true })}</dd></div>
        <div><dt class="muted">Множитель</dt><dd><b>${fmtMult(p.mult)}</b></dd></div>
      </dl>
      ${rocketMeter(p.mult)}
      <div class="meter-label small muted">${rocketStage(p.mult)}</div>` : `
      <p class="small">Позиция закрыта. Вложено ${fmtIls(p.investedIls)}, получено ${fmtIls(p.proceedsIls)}:
        <b data-dir="${dirOf(p.realizedIls)}">${fmtIls(p.realizedIls, { signed: true })}</b>.</p>`}
    ${p.open && p.realizedIls ? `<p class="small muted">Уже зафиксировано от продаж: <span data-dir="${dirOf(p.realizedIls)}">${fmtIls(p.realizedIls, { signed: true })}</span></p>` : ''}
    <h4>Записи <span class="muted small">(нажмите, чтобы исправить)</span></h4>
    <ul class="tx-list">
      ${txs.map((t) => {
        const ils = t.shares * t.price * t.fx;
        return `<li data-tx="${esc(t.id)}" tabindex="0" role="button">
          <span class="tx-kind ${t.type}">${t.type === 'buy' ? 'Покупка' : 'Продажа'}</span>
          <span>${fmtDate(t.date)}</span>
          <span class="muted">${fmtShares(t.shares)} акц. × ${fmtUsd(t.price)} · $1 = ${fmtNum(t.fx, 3, 2)} ₪</span>
          <b>${fmtIls(t.type === 'buy' ? ils + t.fee : ils - t.fee)}</b>
          ${t.note ? `<span class="tx-note muted">${esc(t.note)}</span>` : ''}
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
      <h3>В наблюдении</h3>
      <button type="button" class="btn ghost small-btn" data-act="edit-watch">${icon('edit', 16)} Изменить</button>
    </div>
    <p class="small">${w.added ? `С ${fmtDate(w.added)}` : 'С добавления'}${w.addedPrice ? ` (цена была ${fmtUsd(w.addedPrice)})` : ''}:
      <b data-dir="${dirOf(since ?? 0)}">${fmtPct(since)}</b>${w.source ? ` · <span class="muted">${esc(w.source)}</span>` : ''}</p>
    ${w.why ? `<div class="why">${esc(w.why)}</div>` : ''}`;
}

export function refreshDetail() {
  if (!st.symbol) return;
  renderDetail();
  if (st.view) drawChart();
}
