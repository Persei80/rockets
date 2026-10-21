// Time machine: what a past purchase (once or every month) would be worth today.

import { prefs, savePrefs, data } from './store.js';
import { live } from './live.js';
import { fetchBars, barIso, fxOn } from './api.js';
import { simulate } from './calc.js';
import { createChart } from './chart.js';
import { fmtIls, fmtIlsShort, fmtMult, fmtPct, fmtUsd, fmtDate, fmtYears, fmtNum, todayIso, esc } from './format.js';
import { t, tp } from './i18n.js';
import { $, attachSearch, icon, toast } from './ui.js';
import { unlockFlag } from './achievements.js';
import { actions } from './bus.js';

const PRESETS = [
  { symbol: 'AAPL', name: 'Apple', date: '1980-12-12' },
  { symbol: 'MSFT', name: 'Microsoft', date: '1986-03-13' },
  { symbol: 'AMZN', name: 'Amazon', date: '1997-05-15' },
  { symbol: 'NVDA', name: 'NVIDIA', date: '1999-01-22' },
  { symbol: 'NFLX', name: 'Netflix', date: '2002-05-23' },
  { symbol: 'TSLA', name: 'Tesla', date: '2010-06-29' },
];

const MAX_POINTS = 1200;
const INDEX = '.SPX';

const form = () => ({
  symbol: 'AAPL', name: 'Apple', date: '1980-12-12', amount: 1000, monthly: false, log: false,
  ...(prefs.machine || {}),
});

let seq = 0;
let lastText = '';

export function renderMachine(el) {
  const f = form();
  el.innerHTML = `
    <div class="section-head">
      <div>
        <h2>${t('tab.machine')}</h2>
        <p class="muted small">${t('tm.subtitle')}</p>
      </div>
    </div>
    <div class="card tm-form">
      <div class="chips" id="tm-presets">
        ${PRESETS.map((p, i) => `<button type="button" class="chip" data-preset="${i}">${esc(p.name)}, ${p.date.slice(0, 4)}</button>`).join('')}
        ${data.watch.slice(0, 4).map((w) => `<button type="button" class="chip mine" data-watch="${esc(w.symbol)}" title="${esc(t('tm.fromWatch'))}">${esc(w.symbol)}</button>`).join('')}
      </div>
      <form id="tm" class="tm-fields" novalidate>
        <label class="field grow">
          <span>${t('f.company')}</span>
          <div class="search-wrap">
            <input id="tm-symbol" type="text" value="${esc(f.symbol)}" autocomplete="off" spellcheck="false" placeholder="${esc(t('f.companyPh'))}">
            <ul class="suggestions" role="listbox" hidden></ul>
          </div>
          <small class="muted" id="tm-name">${esc(f.name || data.names[f.symbol] || '')}</small>
        </label>
        <label class="field">
          <span>${t('tm.when')}</span>
          <input id="tm-date" type="date" value="${esc(f.date)}" max="${todayIso()}" min="1970-01-01">
        </label>
        <label class="field">
          <span>${t('tm.amount')}</span>
          <input id="tm-amount" type="number" min="1" step="10" value="${esc(f.amount)}" inputmode="decimal">
        </label>
        <div class="field">
          <span>${t('tm.how')}</span>
          <div class="seg" id="tm-mode">
            <button type="button" data-monthly="0" aria-pressed="${!f.monthly}">${t('tm.once')}</button>
            <button type="button" data-monthly="1" aria-pressed="${f.monthly}">${t('tm.monthly')}</button>
          </div>
        </div>
        <button type="submit" class="btn primary tm-go">${icon('clock')} ${t('tm.go')}</button>
      </form>
    </div>
    <div id="tm-result"></div>`;

  const input = $('#tm-symbol', el);
  attachSearch(input, (r) => {
    input.value = r.symbol;
    $('#tm-name', el).textContent = r.name;
    remember({ symbol: r.symbol, name: r.name });
    run(el);
  });
  input.addEventListener('change', () => { $('#tm-name', el).textContent = ''; });

  $('#tm-presets', el).addEventListener('click', (e) => {
    const b = e.target.closest('[data-preset], [data-watch]');
    if (!b) return;
    if (b.dataset.watch) {
      // A candidate: what if I had bought it five years ago (or at its listing)?
      const d = new Date();
      d.setFullYear(d.getFullYear() - 5);
      input.value = b.dataset.watch;
      $('#tm-name', el).textContent = data.names[b.dataset.watch] || '';
      $('#tm-date', el).value = d.toISOString().slice(0, 10);
    } else {
      const p = PRESETS[+b.dataset.preset];
      input.value = p.symbol;
      $('#tm-name', el).textContent = p.name;
      $('#tm-date', el).value = p.date;
    }
    run(el);
  });

  $('#tm-mode', el).addEventListener('click', (e) => {
    const b = e.target.closest('[data-monthly]');
    if (!b) return;
    $('#tm-mode', el).querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', x === b));
    const monthly = b.dataset.monthly === '1';
    const amount = $('#tm-amount', el);
    const budget = data.settings.budget || 150;
    // Switching modes swaps between a lump sum and a budget-sized monthly amount.
    if (monthly && +amount.value === 1000) amount.value = budget;
    if (!monthly && +amount.value === budget) amount.value = 1000;
    run(el);
  });

  $('#tm', el).addEventListener('submit', (e) => { e.preventDefault(); run(el); });
  run(el);
}

function remember(patch) {
  prefs.machine = { ...form(), ...patch };
  savePrefs();
}

function readForm(el) {
  return {
    symbol: $('#tm-symbol', el).value.trim().toUpperCase(),
    name: $('#tm-name', el).textContent,
    date: $('#tm-date', el).value,
    amount: +$('#tm-amount', el).value,
    monthly: $('#tm-mode [aria-pressed="true"]', el)?.dataset.monthly === '1',
    log: form().log,
  };
}

function downsample(n) {
  if (n <= MAX_POINTS) return Array.from({ length: n }, (_, i) => i);
  const step = (n - 1) / (MAX_POINTS - 1);
  const idx = Array.from({ length: MAX_POINTS }, (_, i) => Math.round(i * step));
  idx[idx.length - 1] = n - 1;
  return [...new Set(idx)];
}

const fail = (out, key, vars) => { out.innerHTML = `<div class="card muted tm-msg">${t(key, vars)}</div>`; };

async function run(el) {
  const f = readForm(el);
  const out = $('#tm-result', el);
  if (!f.symbol || !f.date || !(f.amount > 0)) { out.innerHTML = `<p class="form-error">${t('tm.needAll')}</p>`; return; }
  remember(f);
  const my = ++seq;
  out.innerHTML = `<div class="card tm-loading muted"><span class="spin"></span> ${t('tm.loading')}</div>`;

  let bars, index, fx = live.fx;
  try {
    [bars, fx, index] = await Promise.all([
      fetchBars(f.symbol, 'ALL'),
      fx ? fx : fxOn(null),
      // The index comparison is a bonus; never let it break the main result.
      f.symbol === INDEX ? null : fetchBars(INDEX, 'ALL').catch(() => null),
    ]);
  } catch (err) {
    console.warn(err);
    if (my === seq) fail(out, 'tm.noHistory');
    return;
  }
  if (my !== seq) return;
  if (!bars.length) return fail(out, 'tm.noTicker', { s: esc(f.symbol) });
  if (!fx) return fail(out, 'tm.noFx');

  const sim = simulate(bars, f.date, f.amount / fx, f.monthly);
  if (!sim || sim.bars.length < 2) return fail(out, 'tm.tooRecent');
  unlockFlag('timetravel');

  const firstIso = barIso(sim.bars[0].d);
  const late = barIso(bars[0].d) > f.date;
  const ils = (usd) => usd * fx;
  const name = f.name || data.names[f.symbol] || f.symbol;
  const up = sim.end >= sim.put;
  const dd = sim.drawdown;
  const ddFrom = barIso(sim.bars[dd.peak].d), ddTo = barIso(sim.bars[dd.low].d);
  const recoverYears = dd.recover != null ? (sim.bars[dd.recover].t - sim.bars[dd.peak].t) / (365.25 * 86_400_000) : null;
  const months = f.monthly ? Math.round(sim.put / (f.amount / fx)) : 0;
  const my2 = { month: 'short', year: 'numeric' };

  // Same plan in the S&P 500, over exactly the same dates.
  let idx = null;
  if (index && index.length && barIso(index[0].d) <= firstIso) {
    idx = simulate(index, firstIso, f.amount / fx, f.monthly);
    if (idx && idx.bars.length < 2) idx = null;
  }

  const headline = f.monthly
    ? t('tm.headMonthly', { d: fmtDate(firstIso), a: fmtIls(f.amount), name: esc(name), count: tp('tm.contributions', months), total: fmtIls(ils(sim.put)) })
    : t('tm.headOnce', { d: fmtDate(firstIso), a: fmtIls(f.amount), name: esc(name) });
  lastText = t('tm.shareText', {
    head: headline.replace(/<[^>]+>/g, ''), v: fmtIls(ils(sim.end)), m: fmtMult(sim.mult), y: fmtYears(sim.years),
  });

  out.innerHTML = `
    <div class="card tm-result">
      <div class="tm-headline">
        <p>${headline}</p>
        <div class="tm-big" data-dir="${up ? 'up' : 'down'}">${t('tm.todayWould')} <span>${fmtIls(ils(sim.end))}</span></div>
        <div class="tm-mult"><b data-dir="${up ? 'up' : 'down'}">${fmtMult(sim.mult)}</b> ${t('tm.inYears', { y: fmtYears(sim.years) })}</div>
      </div>
      <dl class="tm-stats">
        <div><dt class="muted">${t('tm.priceThenNow')}</dt><dd>${fmtUsd(sim.startPrice)} → ${fmtUsd(sim.endPrice)}</dd></div>
        ${sim.cagr != null ? `<div><dt class="muted">${t('tm.perYear')}</dt><dd data-dir="${sim.cagr >= 0 ? 'up' : 'down'}">${fmtPct(sim.cagr)}</dd></div>` : ''}
        <div><dt class="muted">${t('tm.worstFall')}</dt><dd data-dir="down">${dd.pct > 0.5 ? fmtPct(-dd.pct, 0) : t('tm.none')}</dd>
          ${dd.pct > 0.5 ? `<small class="muted">${fmtDate(ddFrom, my2)} → ${fmtDate(ddTo, my2)}</small>` : ''}</div>
        <div><dt class="muted">${t('tm.recovered')}</dt><dd>${dd.pct <= 0.5 ? '—' : recoverYears != null ? t('tm.after', { y: fmtYears(recoverYears) }) : t('tm.notYet')}</dd></div>
        ${idx ? `<div><dt class="muted">${t('tm.index')}</dt><dd>${fmtIls(ils(idx.end))} <span class="muted">(${fmtMult(idx.mult)})</span></dd>
          <small class="muted">${t('tm.indexHint')}</small></div>` : ''}
      </dl>
      <div class="tm-chart-head">
        <label class="switch small"><input type="checkbox" id="tm-log"${f.log ? ' checked' : ''}><span></span>${t('tm.log')}</label>
      </div>
      <div class="chart-wrap tm-chart" id="tm-chart">
        <svg aria-hidden="true"></svg>
        <div class="chart-tip" hidden><span class="tip-main"></span><span class="tip-sub muted"></span></div>
        <p class="chart-msg muted" hidden></p>
      </div>
      <div class="chart-legend small muted">
        <span><i class="lg val"></i>${t('tm.legendValue')}</span>
        <span><i class="lg put"></i>${t('tm.legendPut')}</span>
        ${idx ? `<span><i class="lg idx"></i>S&amp;P 500</span>` : ''}
      </div>
      ${dd.pct >= 40 ? `<p class="tm-lesson">${t('tm.lesson', { p: fmtNum(dd.pct, 0, 0) })}</p>` : ''}
      ${late ? `<p class="small muted">${t('tm.late', { s: esc(f.symbol), d: fmtDate(barIso(bars[0].d)) })}</p>` : ''}
      <p class="small muted">${t('tm.note', { fx: fmtNum(fx, 3, 3) })}${up ? ' ' + t('tm.hindsight') : ''}</p>
      <div class="btn-row">
        <button type="button" class="btn" id="tm-open">${icon('chart', 16)} ${t('tm.openChart', { s: esc(f.symbol) })}</button>
        <button type="button" class="btn" id="tm-copy">${icon('copy', 16)} ${t('tm.copy')}</button>
      </div>
    </div>`;

  $('#tm-open', out).addEventListener('click', () => actions.openDetail(f.symbol));
  $('#tm-copy', out).addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(lastText); toast(t('tm.copied')); }
    catch { toast(t('tm.copyFail')); }
  });

  const keep = downsample(sim.bars.length);
  const pts = keep.map((i) => ({ b: sim.bars[i], v: ils(sim.value[i]), put: ils(sim.invested[i]) }));
  // The index line, matched to the same dates.
  let idxVals = null;
  if (idx) {
    let j = 0;
    idxVals = pts.map((p) => {
      const d = barIso(p.b.d);
      while (j + 1 < idx.bars.length && barIso(idx.bars[j + 1].d) <= d) j++;
      return ils(idx.value[j]);
    });
  }
  const xOpts = sim.years > 2 ? { year: 'numeric' } : { month: 'short', year: '2-digit' };
  const chart = createChart($('#tm-chart', out));
  const draw = (log) => chart.draw({
    n: pts.length,
    log,
    series: [
      { values: pts.map((p) => p.v), color: up ? 'var(--up)' : 'var(--down)', fill: true },
      { values: pts.map((p) => p.put), color: 'var(--muted)', dashed: true, width: 1.5 },
      ...(idxVals ? [{ values: idxVals, color: 'var(--idx)', width: 1.5 }] : []),
    ],
    yFmt: (v) => fmtIlsShort(v),
    xLabel: (i) => fmtDate(barIso(pts[i].b.d), xOpts),
    tip: (i) => [fmtIls(pts[i].v), `${fmtDate(barIso(pts[i].b.d))} · ${t('tm.put')} ${fmtIls(pts[i].put)}${idxVals ? ' · S&P ' + fmtIls(idxVals[i]) : ''}`],
  });
  draw(f.log);
  $('#tm-log', out).addEventListener('change', (e) => {
    remember({ log: e.target.checked });
    draw(e.target.checked);
  });
}
