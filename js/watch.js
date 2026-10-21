// "Наблюдаю": candidates I'm keeping an eye on before (or instead of) buying.

import { data, save, prefs, savePrefs } from './store.js';
import { live, poll } from './live.js';
import { lastPrice } from './api.js';
import { RISKS, positions } from './calc.js';
import { fmtUsd, fmtPct, fmtCap, fmtDate, dirOf, esc } from './format.js';
import { icon, logoLetter, toast } from './ui.js';
import { capBadge } from './portfolio.js';
import { actions } from './bus.js';

const expanded = new Set();

const SORTS = {
  added: 'по порядку добавления',
  since: 'по росту с добавления',
  cap: 'сначала самые маленькие',
};

function sinceAdded(w) {
  const price = lastPrice(live.quotes[w.symbol]);
  return w.addedPrice && price != null ? ((price - w.addedPrice) / w.addedPrice) * 100 : null;
}

function row(w, owned) {
  const q = live.quotes[w.symbol];
  const since = sinceAdded(w);
  const today = q ? (q.ext ? q.ext.dp : q.dp) : null;
  const long = w.why.length > 180 || w.why.split('\n').length > 3;
  const open = expanded.has(w.symbol);
  const grown = q?.cap != null && q.cap >= 2e9;
  return `
    <article class="card cand" data-symbol="${esc(w.symbol)}">
      <div class="cand-top" data-open>
        <div class="logo">${logoLetter(w.symbol)}</div>
        <div class="ident">
          <div class="symbol">${esc(w.symbol)} ${capBadge(q?.cap)} ${w.risk ? `<span class="badge risk-${w.risk}">${RISKS[w.risk]}</span>` : ''} ${owned ? '<span class="badge owned">в портфеле</span>' : ''}</div>
          <div class="name muted">${esc(data.names[w.symbol] || '')}</div>
        </div>
        <div class="cand-price">
          <div class="price">${fmtUsd(lastPrice(q))}</div>
          <div class="small" data-dir="${dirOf(today ?? 0)}">${today == null ? '' : fmtPct(today, 2) + ' сегодня'}</div>
        </div>
      </div>
      <div class="cand-facts small">
        <span>${w.added ? `С ${fmtDate(w.added)}:` : 'С добавления:'} <b data-dir="${dirOf(since ?? 0)}">${fmtPct(since)}</b></span>
        <span class="muted">Стоимость компании: <b>${fmtCap(q?.cap)}</b></span>
        ${w.source ? `<span class="muted">Источник: ${esc(w.source)}</span>` : ''}
      </div>
      ${grown ? '<div class="note-warn small">Компания уже стоит больше $2 млрд. Вырасти в 100 раз ей будет труднее, чем маленькой.</div>' : ''}
      ${w.why ? `<div class="why ${long && !open ? 'clamped' : ''}">${esc(w.why)}</div>
        ${long ? `<button type="button" class="link-btn small" data-act="more">${open ? 'Свернуть' : 'Читать дальше'}</button>` : ''}` : ''}
      <div class="cand-actions">
        <button type="button" class="btn primary" data-act="buy">${icon('cart', 16)} Купил</button>
        <button type="button" class="btn" data-act="chart">${icon('chart', 16)} График</button>
        <button type="button" class="btn ghost" data-act="edit" title="Изменить" aria-label="Изменить">${icon('edit', 16)}</button>
        <button type="button" class="btn ghost" data-act="remove" title="Убрать из списка" aria-label="Убрать из списка">${icon('trash', 16)}</button>
      </div>
    </article>`;
}

function sorted() {
  const list = [...data.watch];
  const sort = prefs.watchSort || 'added';
  if (sort === 'since') list.sort((a, b) => (sinceAdded(b) ?? -1e9) - (sinceAdded(a) ?? -1e9));
  else if (sort === 'cap') list.sort((a, b) => (live.quotes[a.symbol]?.cap ?? 1e15) - (live.quotes[b.symbol]?.cap ?? 1e15));
  return list;
}

export function renderWatch(el) {
  const owned = new Set(positions(data.txs).filter((p) => p.open).map((p) => p.symbol));
  const list = sorted();
  el.innerHTML = `
    <div class="section-head">
      <div>
        <h2>Наблюдаю</h2>
        <p class="muted small">Кандидаты в ракеты. Видно, как менялась цена с того дня, как вы начали следить.</p>
      </div>
      <button type="button" class="btn primary" data-act="add">${icon('plus')} Добавить компанию</button>
    </div>
    ${list.length ? `
      <div class="list-tools small muted">
        <label>Сортировка
          <select id="watch-sort">${Object.entries(SORTS).map(([k, v]) => `<option value="${k}"${(prefs.watchSort || 'added') === k ? ' selected' : ''}>${v}</option>`).join('')}</select>
        </label>
      </div>
      <div class="cand-list">${list.map((w) => row(w, owned.has(w.symbol))).join('')}</div>` : `
      <div class="empty-hero card">
        <h2>Список пока пуст</h2>
        <p class="muted">В первую субботу каждого месяца приходит отчёт с 3–5 молодыми компаниями. Понравившиеся добавляйте сюда: вставьте в заметку, чем они интересны, и через пару месяцев будет видно, какие идеи сработали.</p>
        <div class="btn-row center"><button type="button" class="btn primary" data-act="add">${icon('plus')} Добавить компанию</button></div>
      </div>`}`;
}

export function setupWatch(el) {
  el.addEventListener('change', (e) => {
    if (e.target.id === 'watch-sort') {
      prefs.watchSort = e.target.value;
      savePrefs();
      renderWatch(el);
    }
  });
  el.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-act]');
    const card = e.target.closest('[data-symbol]');
    const symbol = card?.dataset.symbol;
    if (btn?.dataset.act === 'add') { actions.openWatch({}); return; }
    if (!symbol) return;
    if (!btn) {
      if (e.target.closest('[data-open]')) actions.openDetail(symbol);
      return;
    }
    const act = btn.dataset.act;
    if (act === 'buy') actions.openTx({ type: 'buy', symbol });
    else if (act === 'chart') actions.openDetail(symbol);
    else if (act === 'edit') actions.openWatch({ symbol });
    else if (act === 'more') {
      if (expanded.has(symbol)) expanded.delete(symbol); else expanded.add(symbol);
      renderWatch(el);
    } else if (act === 'remove') removeFromWatch(symbol);
  });
}

export function removeFromWatch(symbol) {
  const i = data.watch.findIndex((w) => w.symbol === symbol);
  if (i < 0) return;
  const [item] = data.watch.splice(i, 1);
  save();
  actions.refresh();
  toast(`${symbol} убрана из наблюдения`, () => {
    if (!data.watch.some((w) => w.symbol === symbol)) data.watch.splice(Math.min(i, data.watch.length), 0, item);
    save();
    actions.refresh();
    poll();
  });
}
