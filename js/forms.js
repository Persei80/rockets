// Dialogs that change data: buy/sell records, watchlist entries, settings, welcome.

import { data, save, uid, exportJson, importJson, resetAll, prefs, savePrefs } from './store.js';
import { live, poll } from './live.js';
import { fetchQuotes, priceOn, fxOn, lastPrice } from './api.js';
import { positions, spentByMonth, sortedTxs } from './calc.js';
import { fmtIls, fmtShares, fmtDate, todayIso, monthName, esc } from './format.js';
import { t, getLang } from './i18n.js';
import { $, attachSearch, toast, download } from './ui.js';
import { unlockFlag, checkAchievements } from './achievements.js';
import { actions } from './bus.js';

const EPS = 1e-7;

// Checks a ticker typed by hand and learns its name.
async function lookup(symbol) {
  if (live.quotes[symbol]) return live.quotes[symbol];
  const q = (await fetchQuotes([symbol]))[symbol];
  if (q) {
    live.quotes[symbol] = q;
    if (q.name) data.names[symbol] = q.name;
  }
  return q || null;
}

const parse = (el) => {
  const n = parseFloat(String(el.value).replace(',', '.'));
  return Number.isFinite(n) ? n : null;
};
const setNum = (el, v, digits) => { el.value = v == null ? '' : String(+v.toFixed(digits)); };

// ---------- buy / sell ----------

const tx = { id: null, type: 'buy', symbol: '', mode: 'ils', priceManual: false, fxManual: false, seq: 0 };

export function setupTx() {
  const dlg = $('#tx-dialog');
  const input = $('#tx-symbol');
  attachSearch(input, (r) => {
    input.value = r.symbol;
    data.names[r.symbol] = data.names[r.symbol] || r.name;
    setSymbol(r.symbol, r.name);
  });
  input.addEventListener('change', async () => {
    const s = input.value.trim().toUpperCase();
    if (!s || s === tx.symbol) return;
    input.value = s;
    setSymbol(s, '');
    try {
      const q = await lookup(s);
      if (tx.symbol !== s) return;
      $('#tx-symbol-name').textContent = q ? q.name : t('f.notFound', { s });
      if (q) autoFill();
    } catch { $('#tx-symbol-name').textContent = t('f.cantCheck'); }
  });

  $('#tx-type').addEventListener('click', (e) => {
    const b = e.target.closest('[data-type]');
    if (b) { tx.type = b.dataset.type; paintTx(); }
  });
  $('#tx-mode').addEventListener('click', (e) => {
    const b = e.target.closest('[data-mode]');
    if (!b) return;
    tx.mode = b.dataset.mode;
    paintTx();
  });
  $('#tx-date').addEventListener('change', () => autoFill());
  $('#tx-price').addEventListener('input', () => { tx.priceManual = true; $('#tx-price-hint').textContent = ''; preview(); });
  $('#tx-fx').addEventListener('input', () => { tx.fxManual = true; $('#tx-fx-hint').textContent = ''; preview(); });
  for (const id of ['#tx-amount', '#tx-shares', '#tx-fee']) $(id).addEventListener('input', preview);

  $('#tx-form').addEventListener('submit', (e) => { e.preventDefault(); submitTx(); });
  $('#tx-delete').addEventListener('click', deleteTx);
  dlg.addEventListener('close', () => { tx.seq++; });
}

function setSymbol(symbol, name) {
  tx.symbol = symbol;
  tx.priceManual = false;
  $('#tx-symbol-name').textContent = name || data.names[symbol] || '';
  autoFill();
}

export function openTx({ id, type = 'buy', symbol = '' } = {}) {
  const existing = id ? data.txs.find((x) => x.id === id) : null;
  tx.id = existing ? existing.id : null;
  tx.type = existing ? existing.type : type;
  tx.symbol = existing ? existing.symbol : symbol;
  tx.mode = existing ? 'shares' : 'ils';
  tx.priceManual = !!existing;
  tx.fxManual = !!existing;
  tx.seq++;

  $('#tx-symbol').value = tx.symbol;
  $('#tx-symbol-name').textContent = data.names[tx.symbol] || '';
  $('#tx-date').value = existing ? existing.date : todayIso();
  $('#tx-date').max = todayIso();
  $('#tx-amount').value = '';
  $('#tx-shares').value = existing ? existing.shares : '';
  $('#tx-price').value = existing ? existing.price : '';
  $('#tx-fx').value = existing ? existing.fx : '';
  $('#tx-fee').value = existing ? existing.fee || '' : data.settings.fee || '';
  $('#tx-note').value = existing ? existing.note : '';
  $('#tx-price-hint').textContent = '';
  $('#tx-fx-hint').textContent = '';
  $('#tx-error').hidden = true;
  $('#tx-delete').hidden = !existing;
  paintTx();
  $('#tx-dialog').showModal();
  if (!tx.symbol) $('#tx-symbol').focus();
  else if (!existing) $('#tx-amount').focus();
  if (!existing) autoFill();
}

function paintTx() {
  const buy = tx.type === 'buy';
  $('#tx-title').textContent = t(tx.id ? (buy ? 'tx.editBuy' : 'tx.editSell') : (buy ? 'tx.newBuy' : 'tx.newSell'));
  $('#tx-type').querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', b.dataset.type === tx.type));
  $('#tx-mode').querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', b.dataset.mode === tx.mode));
  $('#f-amount').hidden = tx.mode !== 'ils';
  $('#f-shares').hidden = tx.mode !== 'shares';
  $('#tx-amount-label').textContent = t(buy ? 'tx.amountBuy' : 'tx.amountSell');
  $('#f-why').hidden = !buy;
  preview();
}

// Fills in the price and the dollar rate for the chosen date.
async function autoFill() {
  const symbol = tx.symbol;
  const date = $('#tx-date').value;
  if (!date) return;
  const my = ++tx.seq;
  const today = date === todayIso();

  if (!tx.fxManual) {
    if (today && live.fx) {
      setNum($('#tx-fx'), live.fx, 4);
      $('#tx-fx-hint').textContent = t('tx.fxToday');
    } else {
      $('#tx-fx-hint').textContent = t('tx.fxLoading');
      const r = await fxOn(today ? null : date);
      if (my !== tx.seq) return;
      if (r) { setNum($('#tx-fx'), r, 4); $('#tx-fx-hint').textContent = t(today ? 'tx.fxToday' : 'tx.fxPast'); }
      else $('#tx-fx-hint').textContent = t('tx.enterYourself');
    }
    preview();
  }

  if (symbol && !tx.priceManual) {
    $('#tx-price-hint').textContent = t('tx.priceLoading');
    let price = null, hint = '';
    try {
      if (today) {
        const q = await lookup(symbol);
        price = lastPrice(q);
        hint = t('tx.priceNow');
      } else {
        const r = await priceOn(symbol, date);
        if (r) { price = r.price; hint = t('tx.priceClose', { d: fmtDate(r.date, { day: 'numeric', month: 'short' }) }); }
      }
    } catch {}
    if (my !== tx.seq) return;
    if (price != null) { setNum($('#tx-price'), price, price < 1 ? 4 : 2); $('#tx-price-hint').textContent = hint + ' ' + t('tx.priceFix'); }
    else $('#tx-price-hint').textContent = t('tx.enterYourself');
    preview();
  }
}

function heldShares(symbol, exceptId) {
  const p = positions(data.txs.filter((x) => x.id !== exceptId)).find((x) => x.symbol === symbol);
  return p ? p.shares : 0;
}

// Works out shares from shekels (or the other way round).
function figures() {
  const price = parse($('#tx-price')), fx = parse($('#tx-fx'));
  const fee = parse($('#tx-fee')) || 0;
  let shares = null, ils = null;
  if (tx.mode === 'ils') {
    ils = parse($('#tx-amount'));
    if (ils > 0 && price > 0 && fx > 0) shares = ils / fx / price;
  } else {
    shares = parse($('#tx-shares'));
    if (shares > 0 && price > 0 && fx > 0) ils = shares * price * fx;
  }
  return { price, fx, fee, shares, ils };
}

function preview() {
  const el = $('#tx-preview');
  const { fee, shares, ils } = figures();
  if (!(shares > 0) || !(ils > 0)) {
    el.innerHTML = tx.type === 'buy' ? budgetHint() : '';
    return;
  }
  const what = tx.mode === 'ils' ? t('tx.thatShares', { n: fmtShares(shares) }) : t('tx.thatIls', { v: fmtIls(ils) });
  if (tx.type === 'buy') {
    el.innerHTML = `<div>${what} ${t('tx.charged', { v: fmtIls(ils + fee) })}${fee ? ' ' + t('tx.inclFee', { v: fmtIls(fee) }) : ''}.</div>${budgetHint(ils + fee)}`;
  } else {
    el.innerHTML = `<div>${what} ${t('tx.receive', { v: fmtIls(ils - fee) })}</div>
      <div class="small muted">${t('tx.youHave', { n: fmtShares(heldShares(tx.symbol, tx.id)), s: esc(tx.symbol) })}</div>`;
  }
}

function budgetHint(adding = 0) {
  const budget = data.settings.budget;
  if (!budget) return '';
  const ym = ($('#tx-date').value || todayIso()).slice(0, 7);
  const spent = spentByMonth(data.txs.filter((x) => x.id !== tx.id))[ym] || 0;
  const after = spent + adding;
  const over = after > budget + 0.005;
  return `<div class="small ${over ? 'warn-text' : 'muted'}">${t(adding ? 'tx.budgetAfter' : 'tx.budgetSoFar', { m: monthName(ym), v: fmtIls(adding ? after : spent), b: fmtIls(budget) })}${over ? ' ' + t('tx.overPlan') : ''}</div>`;
}

function fail(msg) {
  const el = $('#tx-error');
  el.textContent = msg;
  el.hidden = false;
}

async function submitTx() {
  $('#tx-error').hidden = true;
  const symbol = $('#tx-symbol').value.trim().toUpperCase();
  const date = $('#tx-date').value;
  const { price, fx, fee, shares } = figures();
  if (!symbol) return fail(t('err.company'));
  if (!date) return fail(t('err.date'));
  if (date > todayIso()) return fail(t('err.future'));
  if (!(price > 0)) return fail(t('err.price'));
  if (!(fx > 0)) return fail(t('err.fx'));
  if (fx < 1 || fx > 10) return fail(t('err.fxOdd'));
  if (!(shares > 0)) return fail(t(tx.mode === 'ils' ? 'err.amount' : 'err.shares'));
  if (fee < 0) return fail(t('err.fee'));
  if (tx.type === 'sell') {
    const held = heldShares(symbol, tx.id);
    if (shares > held + EPS) return fail(t('err.tooMany', { n: fmtShares(held), s: symbol }));
  }
  if (!data.names[symbol]) {
    try {
      const q = await lookup(symbol);
      if (!q) return fail(t('f.notFound', { s: symbol }));
    } catch {}
  }

  const note = tx.type === 'buy' ? $('#tx-note').value.trim() : '';
  const record = {
    id: tx.id || uid(), symbol, type: tx.type, date,
    shares: tx.type === 'sell' ? Math.min(shares, heldShares(symbol, tx.id)) : shares,
    price, fx, fee, note,
    created: tx.id ? data.txs.find((x) => x.id === tx.id).created : Date.now(),
  };
  const i = data.txs.findIndex((x) => x.id === record.id);
  if (i >= 0) data.txs[i] = record; else data.txs.push(record);
  if (note && !data.notes[symbol]) data.notes[symbol] = note;
  save();
  $('#tx-dialog').close();
  toast(t(i >= 0 ? 'tx.fixed' : 'tx.saved', { what: t(tx.type === 'buy' ? 'tx.buyLower' : 'tx.sellLower'), s: symbol }));
  actions.refresh();
  checkAchievements();
  poll();
}

function deleteTx() {
  const i = data.txs.findIndex((x) => x.id === tx.id);
  if (i < 0) return;
  if (!confirm(t('tx.deleteConfirm'))) return;
  const [removed] = data.txs.splice(i, 1);
  save();
  $('#tx-dialog').close();
  actions.refresh();
  toast(t('tx.deleted', { s: removed.symbol }), () => {
    data.txs.push(removed);
    save();
    actions.refresh();
  });
}

// ---------- watchlist entry ----------

const w = { editing: null, symbol: '' };

export function setupWatchForm() {
  const input = $('#w-symbol');
  attachSearch(input, (r) => {
    input.value = r.symbol;
    w.symbol = r.symbol;
    data.names[r.symbol] = data.names[r.symbol] || r.name;
    $('#w-symbol-name').textContent = r.name;
  }, { exclude: (s) => data.watch.some((x) => x.symbol === s) });
  input.addEventListener('change', () => {
    w.symbol = input.value.trim().toUpperCase();
    input.value = w.symbol;
    $('#w-symbol-name').textContent = data.names[w.symbol] || '';
  });
  $('#watch-form').addEventListener('submit', (e) => { e.preventDefault(); submitWatch(); });
}

export function openWatch({ symbol = '' } = {}) {
  const existing = data.watch.find((x) => x.symbol === symbol);
  w.editing = existing ? existing.symbol : null;
  w.symbol = symbol;
  $('#w-title').textContent = existing ? t('w.editTitle', { s: symbol }) : t('w.addTitle');
  $('#w-submit').textContent = existing ? t('save') : t('w.addBtn');
  $('#w-symbol').value = symbol;
  $('#w-symbol').disabled = !!existing;
  $('#w-symbol-name').textContent = data.names[symbol] || '';
  $('#w-why').value = existing ? existing.why : '';
  $('#w-risk').value = existing ? existing.risk : '';
  $('#w-source').value = existing ? existing.source : '';
  $('#w-source').placeholder = t('w.sourcePh', { m: monthName(todayIso().slice(0, 7)) });
  $('#w-error').hidden = true;
  $('#watch-dialog').showModal();
  (symbol ? $('#w-why') : $('#w-symbol')).focus();
}

async function submitWatch() {
  const err = $('#w-error');
  const show = (msg) => { err.textContent = msg; err.hidden = false; };
  err.hidden = true;
  const symbol = (w.editing || $('#w-symbol').value.trim()).toUpperCase();
  const fields = { why: $('#w-why').value.trim(), risk: $('#w-risk').value, source: $('#w-source').value.trim() };
  if (!symbol) return show(t('err.company'));

  if (w.editing) {
    Object.assign(data.watch.find((x) => x.symbol === symbol), fields);
  } else {
    if (data.watch.some((x) => x.symbol === symbol)) return show(t('w.exists', { s: symbol }));
    let q = null;
    try { q = await lookup(symbol); } catch { return show(t('f.cantCheckLater')); }
    if (!q) return show(t('f.notFound', { s: symbol }));
    data.watch.unshift({ symbol, added: todayIso(), addedPrice: lastPrice(q), ...fields });
  }
  save();
  $('#watch-dialog').close();
  toast(w.editing ? t('saved') : t('w.added', { s: symbol }));
  actions.refresh();
  checkAchievements();
  poll();
}

// ---------- settings ----------

// Spreadsheet of all records, for taxes or Excel. Opens in Excel thanks to the BOM.
function csv() {
  const head = ['date', 'type', 'symbol', 'company', 'shares', 'price_usd', 'usd_ils', 'fee_ils', 'total_ils', 'note'];
  const q = (v) => {
    const s = String(v ?? '');
    return /[",\n;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const rows = sortedTxs(data.txs).map((x) => {
    const total = x.shares * x.price * x.fx + (x.type === 'buy' ? x.fee : -x.fee);
    return [x.date, x.type, x.symbol, data.names[x.symbol] || '', x.shares, x.price, x.fx, x.fee, total.toFixed(2), x.note].map(q).join(',');
  });
  return '﻿' + [head.join(','), ...rows].join('\r\n');
}

export function setupSettings({ onAppearance }) {
  const dlg = $('#settings-dialog');
  $('#settings-btn').addEventListener('click', () => {
    $('#s-lang').value = getLang();
    $('#s-theme').value = prefs.theme;
    $('#s-budget').value = data.settings.budget;
    $('#s-max').value = data.settings.maxShare;
    $('#s-fee').value = data.settings.fee || '';
    dlg.showModal();
  });
  // Language and theme apply at once, so you can see the change.
  $('#s-lang').addEventListener('change', (e) => { prefs.lang = e.target.value; savePrefs(); onAppearance(); });
  $('#s-theme').addEventListener('change', (e) => { prefs.theme = e.target.value; savePrefs(); onAppearance(); });

  $('#settings-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const budget = parse($('#s-budget')), max = parse($('#s-max')), fee = parse($('#s-fee'));
    if (budget != null && budget >= 0) data.settings.budget = budget;
    if (max != null && max >= 5 && max <= 100) data.settings.maxShare = max;
    data.settings.fee = fee != null && fee >= 0 ? fee : 0;
    save();
    dlg.close();
    toast(t('s.saved'));
    actions.refresh();
  });
  $('#s-export').addEventListener('click', () => {
    download(`rockets-backup-${todayIso()}.json`, exportJson());
    toast(t('s.exported'));
    unlockFlag('backup');
  });
  $('#s-csv').addEventListener('click', () => {
    if (!data.txs.length) { toast(t('s.csvEmpty')); return; }
    download(`rockets-${todayIso()}.csv`, csv(), 'text/csv;charset=utf-8');
  });
  $('#s-import').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    if (!confirm(t('s.importConfirm'))) return;
    try {
      importJson(await file.text());
    } catch {
      toast(t('s.importBad'));
      return;
    }
    dlg.close();
    toast(t('s.imported'));
    checkAchievements({ quiet: true });
    actions.refresh();
    poll();
  });
  $('#s-reset').addEventListener('click', () => {
    if (!confirm(t('s.reset1'))) return;
    if (!confirm(t('s.reset2'))) return;
    resetAll();
    dlg.close();
    toast(t('s.wiped'));
    actions.refresh();
  });
}

// ---------- first run ----------

export function setupWelcome({ onAppearance }) {
  const dlg = $('#welcome');
  dlg.addEventListener('click', (e) => {
    const b = e.target.closest('[data-lang]');
    if (!b) return;
    prefs.lang = b.dataset.lang;
    savePrefs();
    onAppearance();
    dlg.querySelectorAll('[data-lang]').forEach((x) => x.setAttribute('aria-pressed', x === b));
    b.focus();
  });
  $('#welcome-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const budget = parse($('#wl-budget'));
    if (budget != null && budget >= 0) { data.settings.budget = budget; save(); }
    prefs.welcomed = true;
    savePrefs();
    dlg.close();
    actions.refresh();
  });
  dlg.addEventListener('cancel', () => { prefs.welcomed = true; savePrefs(); });
}

export function showWelcome() {
  const dlg = $('#welcome');
  dlg.querySelectorAll('[data-lang]').forEach((x) => x.setAttribute('aria-pressed', x.dataset.lang === getLang()));
  $('#wl-budget').value = data.settings.budget;
  dlg.showModal();
  // Otherwise the browser focuses the first language button, and with the
  // other one selected both look highlighted.
  dlg.querySelector('[data-lang][aria-pressed="true"]')?.focus();
}
