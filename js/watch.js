// Watchlist: candidates I'm keeping an eye on before (or instead of) buying.

import { data, save, prefs, savePrefs } from './store.js';
import { live, poll } from './live.js';
import { lastPrice } from './api.js';
import { riskLabel, positions } from './calc.js';
import { fmtUsd, fmtPct, fmtCap, fmtDate, dirOf, esc } from './format.js';
import { t } from './i18n.js';
import { icon, logo, toast } from './ui.js';
import { capBadge } from './portfolio.js';
import { actions } from './bus.js';
import { opinionLine } from './opinions.js';

const expanded = new Set();
const SORTS = ['added', 'since', 'cap', 'today'];

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
      <div class="cand-top" data-open tabindex="0" role="button">
        ${logo(w.symbol)}
        <div class="ident">
          <div class="symbol">${esc(w.symbol)} ${capBadge(q?.cap)} ${w.risk ? `<span class="badge risk-${w.risk}">${esc(riskLabel(w.risk))}</span>` : ''} ${owned ? `<span class="badge owned">${t('w.owned')}</span>` : ''}</div>
          <div class="name muted">${esc(data.names[w.symbol] || '')}</div>
        </div>
        <div class="cand-price">
          <div class="price">${fmtUsd(lastPrice(q))}</div>
          <div class="small" data-dir="${dirOf(today ?? 0)}">${today == null ? '' : t('w.todayChange', { p: fmtPct(today, 2) })}</div>
        </div>
      </div>
      <div class="cand-facts small">
        <span>${w.added ? t('w.since', { d: fmtDate(w.added) }) : t('w.sinceAdded')} <b data-dir="${dirOf(since ?? 0)}">${fmtPct(since)}</b></span>
        <span class="muted">${t('w.cap')} <b>${fmtCap(q?.cap)}</b></span>
        ${w.source ? `<span class="muted">${t('w.source')} ${esc(w.source)}</span>` : ''}
      </div>
      ${grown ? `<div class="note-warn small">${t('w.grown')}</div>` : ''}
      ${opinionLine(w.symbol)}
      ${w.why ? `<div class="why ${long && !open ? 'clamped' : ''}" dir="auto">${esc(w.why)}</div>
        ${long ? `<button type="button" class="link-btn small" data-act="more">${open ? t('w.less') : t('w.more')}</button>` : ''}` : ''}
      <div class="cand-actions">
        <button type="button" class="btn primary" data-act="buy">${icon('cart', 16)} ${t('w.bought')}</button>
        <button type="button" class="btn" data-act="chart">${icon('chart', 16)} ${t('w.chart')}</button>
        <button type="button" class="btn ghost" data-act="edit" title="${esc(t('edit'))}" aria-label="${esc(t('edit'))}">${icon('edit', 16)}</button>
        <button type="button" class="btn ghost" data-act="remove" title="${esc(t('w.remove'))}" aria-label="${esc(t('w.remove'))}">${icon('trash', 16)}</button>
      </div>
    </article>`;
}

function sorted() {
  const list = [...data.watch];
  const sort = prefs.watchSort || 'added';
  const num = (v) => (v == null ? -1e15 : v);
  if (sort === 'since') list.sort((a, b) => num(sinceAdded(b)) - num(sinceAdded(a)));
  else if (sort === 'cap') list.sort((a, b) => (live.quotes[a.symbol]?.cap ?? 1e15) - (live.quotes[b.symbol]?.cap ?? 1e15));
  else if (sort === 'today') list.sort((a, b) => num(live.quotes[b.symbol]?.dp) - num(live.quotes[a.symbol]?.dp));
  return list;
}

export function renderWatch(el) {
  const owned = new Set(positions(data.txs).filter((p) => p.open).map((p) => p.symbol));
  const list = sorted();
  el.innerHTML = `
    <div class="section-head">
      <div>
        <h2>${t('tab.watch')}</h2>
        <p class="muted small">${t('w.subtitle')}</p>
      </div>
      <div class="head-tools">
        ${list.length ? `<label class="sort small muted">${t('sort')}
          <select id="watch-sort">${SORTS.map((k) => `<option value="${k}"${(prefs.watchSort || 'added') === k ? ' selected' : ''}>${t('w.sort.' + k)}</option>`).join('')}</select>
        </label>` : ''}
        ${list.length ? `<button type="button" class="btn" data-act="opinions">${icon('spark', 16)} ${t('op.btn')}</button>` : ''}
        <button type="button" class="btn primary" data-act="add">${icon('plus')} ${t('w.add')}</button>
      </div>
    </div>
    ${list.length ? `<div class="cand-list">${list.map((w) => row(w, owned.has(w.symbol))).join('')}</div>` : `
      <div class="empty-hero card">
        <div class="hero-ship">${icon('eye', 22)}</div>
        <h2>${t('w.emptyTitle')}</h2>
        <p class="muted">${t('w.emptyText')}</p>
        <div class="btn-row center"><button type="button" class="btn primary" data-act="add">${icon('plus')} ${t('w.add')}</button></div>
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
  el.addEventListener('keydown', (e) => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('[data-open]')) {
      e.preventDefault();
      actions.openDetail(e.target.closest('[data-symbol]').dataset.symbol);
    }
  });
  el.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-act]');
    const card = e.target.closest('[data-symbol]');
    const symbol = card?.dataset.symbol;
    if (btn?.dataset.act === 'add') { actions.openWatch({}); return; }
    if (btn?.dataset.act === 'opinions') { actions.openOpinions(); return; }
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
  toast(t('w.removed', { s: symbol }), () => {
    if (!data.watch.some((w) => w.symbol === symbol)) data.watch.splice(Math.min(i, data.watch.length), 0, item);
    save();
    actions.refresh();
    poll();
  });
}
