// "Машина времени": what a past purchase (once or every month) would be worth today.

import { prefs, savePrefs, data } from './store.js';
import { live } from './live.js';
import { fetchBars, barIso, fxOn } from './api.js';
import { simulate } from './calc.js';
import { createChart } from './chart.js';
import { fmtIls, fmtMult, fmtPct, fmtUsd, fmtDate, fmtYears, fmtNum, todayIso, esc, plural, LOCALE } from './format.js';
import { $, attachSearch, icon } from './ui.js';
import { actions } from './bus.js';

const PRESETS = [
  { symbol: 'AAPL', name: 'Apple', date: '1980-12-12', label: 'Apple, 1980' },
  { symbol: 'MSFT', name: 'Microsoft', date: '1986-03-13', label: 'Microsoft, 1986' },
  { symbol: 'AMZN', name: 'Amazon', date: '1997-05-15', label: 'Amazon, 1997' },
  { symbol: 'NVDA', name: 'NVIDIA', date: '1999-01-22', label: 'Nvidia, 1999' },
  { symbol: 'NFLX', name: 'Netflix', date: '2002-05-23', label: 'Netflix, 2002' },
  { symbol: 'TSLA', name: 'Tesla', date: '2010-06-29', label: 'Tesla, 2010' },
];

const MAX_POINTS = 1200;
const INDEX = '.SPX';

const form = () => ({
  symbol: 'AAPL', name: 'Apple', date: '1980-12-12', amount: 1000, monthly: false,
  ...(prefs.machine || {}),
});

let chart = null;
let seq = 0;

export function renderMachine(el) {
  const f = form();
  el.innerHTML = `
    <div class="section-head">
      <div>
        <h2>Машина времени</h2>
        <p class="muted small">Что было бы, если бы тогда… Цены учитывают дробления акций; шекели — по сегодняшнему курсу.</p>
      </div>
    </div>
    <div class="card tm-form">
      <div class="chips" id="tm-presets">
        ${PRESETS.map((p, i) => `<button type="button" class="chip" data-preset="${i}">${p.label}</button>`).join('')}
      </div>
      <form id="tm" class="tm-fields" novalidate>
        <label class="field grow">
          <span>Компания</span>
          <div class="search-wrap">
            <input id="tm-symbol" type="text" value="${esc(f.symbol)}" autocomplete="off" spellcheck="false" placeholder="Тикер или название">
            <ul class="suggestions" role="listbox" hidden></ul>
          </div>
          <small class="muted" id="tm-name">${esc(f.name || data.names[f.symbol] || '')}</small>
        </label>
        <label class="field">
          <span>Когда</span>
          <input id="tm-date" type="date" value="${esc(f.date)}" max="${todayIso()}" min="1970-01-01">
        </label>
        <label class="field">
          <span>Сколько, ₪</span>
          <input id="tm-amount" type="number" min="1" step="10" value="${esc(f.amount)}" inputmode="decimal">
        </label>
        <div class="field">
          <span>Как</span>
          <div class="seg" id="tm-mode">
            <button type="button" data-monthly="0" aria-pressed="${!f.monthly}">один раз</button>
            <button type="button" data-monthly="1" aria-pressed="${f.monthly}">каждый месяц</button>
          </div>
        </div>
        <button type="submit" class="btn primary tm-go">${icon('clock')} Посчитать</button>
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
    const b = e.target.closest('[data-preset]');
    if (!b) return;
    const p = PRESETS[+b.dataset.preset];
    input.value = p.symbol;
    $('#tm-name', el).textContent = p.name;
    $('#tm-date', el).value = p.date;
    remember({ symbol: p.symbol, name: p.name, date: p.date });
    run(el);
  });

  $('#tm-mode', el).addEventListener('click', (e) => {
    const b = e.target.closest('[data-monthly]');
    if (!b) return;
    $('#tm-mode', el).querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', x === b));
    const monthly = b.dataset.monthly === '1';
    const amount = $('#tm-amount', el);
    // Switching modes swaps between a lump sum and a monthly budget-sized amount.
    if (monthly && +amount.value === 1000) amount.value = data.settings.budget || 150;
    if (!monthly && +amount.value === (data.settings.budget || 150)) amount.value = 1000;
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
  };
}

function downsample(n) {
  if (n <= MAX_POINTS) return Array.from({ length: n }, (_, i) => i);
  const step = (n - 1) / (MAX_POINTS - 1);
  const idx = Array.from({ length: MAX_POINTS }, (_, i) => Math.round(i * step));
  idx[idx.length - 1] = n - 1;
  return [...new Set(idx)];
}

async function run(el) {
  const f = readForm(el);
  const out = $('#tm-result', el);
  if (!f.symbol || !f.date || !(f.amount > 0)) {
    out.innerHTML = '<p class="form-error">Укажите компанию, дату и сумму.</p>';
    return;
  }
  remember(f);
  const my = ++seq;
  out.innerHTML = '<div class="card tm-loading muted">Летим в прошлое…</div>';

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
    if (my === seq) out.innerHTML = '<div class="card muted">Не удалось загрузить историю цен. Проверьте интернет и попробуйте ещё раз.</div>';
    return;
  }
  if (my !== seq) return;
  if (!bars.length) {
    out.innerHTML = `<div class="card muted">Для «${esc(f.symbol)}» нет истории цен. Проверьте тикер.</div>`;
    return;
  }
  if (!fx) {
    out.innerHTML = '<div class="card muted">Не удалось узнать курс доллара. Попробуйте чуть позже.</div>';
    return;
  }

  const sim = simulate(bars, f.date, f.amount / fx, f.monthly, barIso);
  if (!sim || sim.bars.length < 2) {
    out.innerHTML = `<div class="card muted">Эта дата слишком близко к сегодняшнему дню — пока нечего считать. Выберите дату раньше.</div>`;
    return;
  }
  const firstIso = barIso(sim.bars[0].d);
  const late = barIso(bars[0].d) > f.date;
  const ils = (usd) => usd * fx;
  const name = f.name || data.names[f.symbol] || f.symbol;
  const up = sim.end >= sim.put;
  const dd = sim.drawdown;
  const ddFrom = barIso(sim.bars[dd.peak].d), ddTo = barIso(sim.bars[dd.low].d);
  const recoverYears = dd.recover != null ? (sim.bars[dd.recover].t - sim.bars[dd.peak].t) / (365.25 * 86_400_000) : null;
  // Same plan in the S&P 500, over exactly the same dates.
  let idx = null;
  if (index && index.length && barIso(index[0].d) <= firstIso) {
    idx = simulate(index, firstIso, f.amount / fx, f.monthly, barIso);
    if (idx && idx.bars.length < 2) idx = null;
  }
  const months = f.monthly ? Math.round(sim.put / (f.amount / fx)) : 0;

  out.innerHTML = `
    <div class="card tm-result">
      <div class="tm-headline">
        <p>${f.monthly
          ? `Если бы начиная с <b>${fmtDate(firstIso)}</b> каждый месяц вкладывали <b>${fmtIls(f.amount)}</b> в <b>${esc(name)}</b> (${months} ${plural(months, 'взнос', 'взноса', 'взносов')}, всего ${fmtIls(ils(sim.put))}),`
          : `Если бы <b>${fmtDate(firstIso)}</b> вы вложили <b>${fmtIls(f.amount)}</b> в <b>${esc(name)}</b>,`}</p>
        <div class="tm-big" data-dir="${up ? 'up' : 'down'}">сегодня было бы <span>${fmtIls(ils(sim.end))}</span></div>
        <div class="tm-mult"><b data-dir="${up ? 'up' : 'down'}">${fmtMult(sim.mult)}</b> за ${fmtYears(sim.years)}</div>
      </div>
      <dl class="tm-stats">
        <div><dt class="muted">Цена акции тогда → сейчас</dt><dd>${fmtUsd(sim.startPrice)} → ${fmtUsd(sim.endPrice)}</dd></div>
        ${sim.cagr != null ? `<div><dt class="muted">В среднем в год</dt><dd data-dir="${sim.cagr >= 0 ? 'up' : 'down'}">${fmtPct(sim.cagr)}</dd></div>` : ''}
        <div><dt class="muted">Самое страшное падение</dt><dd data-dir="down">${dd.pct > 0.5 ? fmtPct(-dd.pct, 0) : 'не было'}</dd>
          ${dd.pct > 0.5 ? `<small class="muted">${fmtDate(ddFrom, { month: 'short', year: 'numeric' })} → ${fmtDate(ddTo, { month: 'short', year: 'numeric' })}</small>` : ''}</div>
        <div><dt class="muted">Вернулась к прежнему максимуму</dt><dd>${dd.pct <= 0.5 ? '—' : recoverYears != null ? 'через ' + fmtYears(recoverYears) : 'ещё не вернулась'}</dd></div>
        ${idx ? `<div><dt class="muted">А если бы в индекс S&amp;P 500</dt><dd>${fmtIls(ils(idx.end))} <span class="muted">(${fmtMult(idx.mult)})</span></dd>
          <small class="muted">500 крупнейших компаний США — спокойный вариант для сравнения</small></div>` : ''}
      </dl>
      <div class="chart-wrap tm-chart" id="tm-chart">
        <svg aria-hidden="true"></svg>
        <div class="chart-tip" hidden><span class="tip-main"></span><span class="tip-sub muted"></span></div>
        <p class="chart-msg muted" hidden></p>
      </div>
      <div class="chart-legend small muted">
        <span><i class="lg val"></i>стоимость вложений</span>
        <span><i class="lg put"></i>сколько вложено</span>
      </div>
      ${dd.pct >= 40 ? `<p class="tm-lesson">Чтобы получить этот результат, нужно было пережить падение на ${fmtNum(dd.pct, 0, 0)} % и не продать. Это самое трудное в «ракетах».</p>` : ''}
      ${late ? `<p class="small muted">История цен для ${esc(f.symbol)} есть только с ${fmtDate(barIso(bars[0].d))}, поэтому расчёт начинается с этой даты.</p>` : ''}
      <p class="small muted">Без учёта дивидендов, налогов и комиссий. Курс: $1 = ${fmtNum(fx, 3, 3)} ₪. ${!up ? '' : 'Помните: такие истории видны только задним числом — рядом были сотни компаний, которые исчезли.'}</p>
      <div class="btn-row">
        <button type="button" class="btn" id="tm-open">${icon('chart', 16)} График ${esc(f.symbol)}</button>
      </div>
    </div>`;

  $('#tm-open', out).addEventListener('click', () => actions.openDetail(f.symbol));

  const keep = downsample(sim.bars.length);
  const pts = keep.map((i) => ({ b: sim.bars[i], v: ils(sim.value[i]), put: ils(sim.invested[i]) }));
  const yearFmt = new Intl.DateTimeFormat(LOCALE, { year: 'numeric', timeZone: 'UTC' });
  const spanYears = sim.years;
  const xFmt = spanYears > 2 ? yearFmt : new Intl.DateTimeFormat(LOCALE, { month: 'short', year: '2-digit', timeZone: 'UTC' });
  const when = (b) => new Date(Date.UTC(+b.d.slice(0, 4), +b.d.slice(4, 6) - 1, +b.d.slice(6, 8)));
  chart = createChart($('#tm-chart', out));
  chart.draw({
    n: pts.length,
    series: [
      { values: pts.map((p) => p.v), color: up ? 'var(--up)' : 'var(--down)', fill: true },
      { values: pts.map((p) => p.put), color: 'var(--muted)', dashed: true, width: 1.5 },
    ],
    yFmt: (v) => shortIls(v),
    xLabel: (i) => xFmt.format(when(pts[i].b)).replace(/\s?г\.$/, ''),
    tip: (i) => [fmtIls(pts[i].v), fmtDate(barIso(pts[i].b.d)) + ' · вложено ' + fmtIls(pts[i].put)],
  });
}

// Axis labels: 950 ₪, 12 тыс. ₪, 2,3 млн ₪
function shortIls(v) {
  if (v >= 1e6) return fmtNum(v / 1e6, v >= 1e7 ? 0 : 1, 0) + ' млн ₪';
  if (v >= 1e4) return fmtNum(v / 1e3, 0, 0) + ' тыс. ₪';
  return fmtNum(v, 0, 0) + ' ₪';
}
