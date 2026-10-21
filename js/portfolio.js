// "Портфель": what I own, what it's worth now, and how far each rocket has flown.

import { data } from './store.js';
import { live } from './live.js';
import { positions, valuePositions, totals, rocketPos, rocketStage, capClass } from './calc.js';
import { fmtIls, fmtPct, fmtMult, fmtShares, fmtUsd, fmtYears, dirOf, esc, parseIso } from './format.js';
import { icon, logoLetter } from './ui.js';
import { actions } from './bus.js';

const ROCKET = '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M12 2.5c3.2 2.2 5 5.8 5 10.2l-2 2.8H9l-2-2.8c0-4.4 1.8-8 5-10.2z" fill="currentColor"/><circle cx="12" cy="9.5" r="1.8" fill="var(--surface)"/><path d="M9 15.5l-2.6 3.3L9 18.3zM15 15.5l2.6 3.3-2.6-.5z" fill="currentColor"/><path d="M10.4 16.5h3.2L12 22z" fill="#f59e0b"/></svg>';

export function capBadge(cap) {
  const c = capClass(cap);
  return c ? `<span class="badge cap-${c.key}" title="${esc(c.hint)}">${c.label}</span>` : '';
}

export function rocketMeter(mult) {
  const pos = rocketPos(mult);
  return `
    <div class="rocket-meter" style="--pos:${pos.toFixed(4)}" data-dir="${mult == null ? 'flat' : mult >= 1 ? 'up' : 'down'}">
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

function card(p) {
  const q = p.quote;
  const dir = dirOf(p.gainIls ?? 0);
  return `
    <article class="card pos" data-symbol="${esc(p.symbol)}" tabindex="0" role="button" aria-label="${esc(p.symbol)}: подробнее">
      <div class="card-head">
        <div class="logo">${logoLetter(p.symbol)}</div>
        <div class="ident">
          <div class="symbol">${esc(p.symbol)} ${capBadge(q?.cap)}</div>
          <div class="name muted">${esc(data.names[p.symbol] || '')}</div>
        </div>
        ${q ? `<div class="today small" data-dir="${dirOf(q.ext ? q.ext.dp : q.dp)}" title="Изменение за сегодня">${fmtPct(q.ext ? q.ext.dp : q.dp, 2)}</div>` : ''}
      </div>
      <div class="pos-value">
        <span class="big">${fmtIls(p.valueIls)}</span>
        <span class="gain" data-dir="${dir}">${p.gainIls == null ? '' : fmtIls(p.gainIls, { signed: true }) + ' (' + fmtPct((p.gainIls / p.costIls) * 100) + ')'}</span>
      </div>
      ${rocketMeter(p.mult)}
      <div class="meter-label small"><b>${fmtMult(p.mult)}</b> <span class="muted">${rocketStage(p.mult)}</span></div>
      <dl class="mini small">
        <div><dt class="muted">Вложено</dt><dd>${fmtIls(p.costIls)}</dd></div>
        <div><dt class="muted">Акций</dt><dd>${fmtShares(p.shares)}</dd></div>
        <div><dt class="muted">Цена сейчас</dt><dd>${fmtUsd(p.price)}</dd></div>
        <div><dt class="muted">Держу</dt><dd>${fmtYears(yearsSince(p.firstDate))}</dd></div>
      </dl>
    </article>`;
}

function closedRow(p) {
  const dir = dirOf(p.realizedIls);
  return `
    <li class="closed-row" data-symbol="${esc(p.symbol)}" tabindex="0" role="button">
      <strong>${esc(p.symbol)}</strong>
      <span class="muted">${esc(data.names[p.symbol] || '')}</span>
      <span>вложено ${fmtIls(p.investedIls)} → получено ${fmtIls(p.proceedsIls)}</span>
      <span class="gain" data-dir="${dir}">${fmtIls(p.realizedIls, { signed: true })}</span>
    </li>`;
}

function emptyState() {
  return `
    <div class="empty-hero card">
      <div class="hero-ship">${ROCKET}</div>
      <h2>Здесь будут ваши ракеты</h2>
      <p class="muted">Когда купите у брокера первую акцию, запишите покупку сюда. Программа будет показывать, сколько она стоит сейчас в шекелях и во сколько раз выросла.</p>
      <div class="btn-row center">
        <button type="button" class="btn primary" data-go="buy">${icon('plus')} Записать покупку</button>
        <button type="button" class="btn" data-go="watch">${icon('eye')} Добавить кандидатов</button>
        <button type="button" class="btn" data-go="machine">${icon('clock')} Машина времени</button>
      </div>
    </div>`;
}

export function renderPortfolio(el) {
  if (!data.txs.length) {
    el.innerHTML = emptyState();
    return;
  }
  const list = valuePositions(positions(data.txs), live.quotes, live.fx);
  const open = list.filter((p) => p.open).sort((a, b) => (b.valueIls ?? -1) - (a.valueIls ?? -1));
  const closed = list.filter((p) => !p.open);
  const t = totals(list);
  const best = open.filter((p) => p.mult != null).sort((a, b) => b.mult - a.mult)[0];
  const resultDir = dirOf(t.result);

  el.innerHTML = `
    <div class="summary card">
      <div class="sum-main">
        <div class="muted small">Портфель стоит сейчас</div>
        <div class="sum-value">${t.missing && !t.value ? '…' : fmtIls(t.value)}</div>
        <div class="gain" data-dir="${resultDir}">
          ${t.missing ? '' : `${fmtIls(t.result, { signed: true })} (${fmtPct(t.resultPct)}) за всё время`}
        </div>
      </div>
      <dl class="sum-stats">
        <div><dt class="muted">Вложено всего</dt><dd>${fmtIls(t.invested)}</dd></div>
        <div><dt class="muted">Сегодня</dt><dd class="gain" data-dir="${dirOf(t.today)}">${t.missing ? '…' : fmtIls(t.today, { signed: true })}</dd></div>
        <div><dt class="muted">Лучшая ракета</dt><dd>${best ? `${esc(best.symbol)} <span class="gain" data-dir="${dirOf(best.mult - 1)}">${fmtMult(best.mult)}</span>` : '—'}</dd></div>
        <div><dt class="muted">Компаний</dt><dd>${t.open}</dd></div>
      </dl>
    </div>
    <div class="section-head">
      <h2>Мои ракеты</h2>
      <button type="button" class="btn primary" data-go="buy">${icon('plus')} Записать покупку</button>
    </div>
    ${open.length ? `<div class="grid">${open.map(card).join('')}</div>` : '<p class="muted">Открытых позиций нет.</p>'}
    ${closed.length ? `
      <details class="closed card">
        <summary>Проданные (${closed.length})</summary>
        <ul>${closed.map(closedRow).join('')}</ul>
      </details>` : ''}
    <p class="small muted footnote">Стоимость в шекелях считается по сегодняшнему курсу, вложения — по курсу дня покупки. Дивиденды не учитываются.${live.updated ? '' : ' Загружаю цены…'}</p>`;
  const det = el.querySelector('details.closed');
  if (det && renderPortfolio.closedOpen) det.open = true;
}
renderPortfolio.closedOpen = false;

export function setupPortfolio(el) {
  el.addEventListener('click', (e) => {
    const go = e.target.closest('[data-go]');
    if (go) {
      if (go.dataset.go === 'buy') actions.openTx({ type: 'buy' });
      else if (go.dataset.go === 'watch') { actions.show('watch'); actions.openWatch({}); }
      else actions.show(go.dataset.go);
      return;
    }
    const item = e.target.closest('[data-symbol]');
    if (item) actions.openDetail(item.dataset.symbol);
  });
  el.addEventListener('keydown', (e) => {
    const item = e.target.closest('[data-symbol]');
    if (item && (e.key === 'Enter' || e.key === ' ') && e.target === item) { e.preventDefault(); actions.openDetail(item.dataset.symbol); }
  });
  el.addEventListener('toggle', (e) => {
    if (e.target.matches('details.closed')) renderPortfolio.closedOpen = e.target.open;
  }, true);
}

