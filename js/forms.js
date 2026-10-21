// Dialogs that change data: buy/sell records, watchlist entries, settings.

import { data, save, uid, exportJson, importJson, resetAll } from './store.js';
import { live, poll } from './live.js';
import { fetchQuotes, priceOn, fxOn, lastPrice } from './api.js';
import { positions, spentByMonth } from './calc.js';
import { fmtIls, fmtShares, fmtDate, todayIso, monthName, esc } from './format.js';
import { $, attachSearch, toast, download } from './ui.js';
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
      $('#tx-symbol-name').textContent = q ? q.name : 'Такой тикер не найден';
      if (q) autoFill();
    } catch { $('#tx-symbol-name').textContent = 'Нет связи — не могу проверить тикер'; }
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
  const existing = id ? data.txs.find((t) => t.id === id) : null;
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
  $('#tx-title').textContent = (tx.id ? 'Исправить ' : 'Записать ') + (buy ? 'покупку' : 'продажу');
  $('#tx-type').querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', b.dataset.type === tx.type));
  $('#tx-mode').querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', b.dataset.mode === tx.mode));
  $('#f-amount').hidden = tx.mode !== 'ils';
  $('#f-shares').hidden = tx.mode !== 'shares';
  $('#tx-amount-label').textContent = buy ? 'Сумма покупки, ₪ (без комиссии)' : 'Сумма продажи, ₪ (до комиссии)';
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
      $('#tx-fx-hint').textContent = 'сегодняшний курс';
    } else {
      $('#tx-fx-hint').textContent = 'узнаю курс…';
      const r = await fxOn(today ? null : date);
      if (my !== tx.seq) return;
      if (r) { setNum($('#tx-fx'), r, 4); $('#tx-fx-hint').textContent = today ? 'сегодняшний курс' : 'курс Банка Европы на эту дату'; }
      else $('#tx-fx-hint').textContent = 'не удалось узнать — введите сами';
    }
    preview();
  }

  if (symbol && !tx.priceManual) {
    $('#tx-price-hint').textContent = 'узнаю цену…';
    let price = null, hint = '';
    try {
      if (today) {
        const q = await lookup(symbol);
        price = lastPrice(q);
        hint = 'текущая цена';
      } else {
        const r = await priceOn(symbol, date);
        if (r) { price = r.price; hint = 'цена закрытия ' + fmtDate(r.date, { day: 'numeric', month: 'short' }); }
      }
    } catch {}
    if (my !== tx.seq) return;
    if (price != null) { setNum($('#tx-price'), price, price < 1 ? 4 : 2); $('#tx-price-hint').textContent = hint + ' — исправьте, если у брокера была другая'; }
    else $('#tx-price-hint').textContent = 'не удалось узнать — введите сами';
    preview();
  }
}

function heldShares(symbol, exceptId) {
  const p = positions(data.txs.filter((t) => t.id !== exceptId)).find((x) => x.symbol === symbol);
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
  if (tx.type === 'buy') {
    el.innerHTML = `
      <div>${tx.mode === 'ils' ? `Это <b>${fmtShares(shares)}</b> акции` : `Это <b>${fmtIls(ils)}</b>`}.
      Всего спишется <b>${fmtIls(ils + fee)}</b>${fee ? ` (включая комиссию ${fmtIls(fee)})` : ''}.</div>
      ${budgetHint(ils + fee)}`;
  } else {
    const held = heldShares(tx.symbol, tx.id);
    el.innerHTML = `
      <div>${tx.mode === 'ils' ? `Это <b>${fmtShares(shares)}</b> акции` : `Это <b>${fmtIls(ils)}</b>`}.
      Получите на счёт <b>${fmtIls(ils - fee)}</b>.</div>
      <div class="small muted">У вас ${fmtShares(held)} акций ${esc(tx.symbol)}.</div>`;
  }
}

function budgetHint(adding = 0) {
  const budget = data.settings.budget;
  if (!budget) return '';
  const date = $('#tx-date').value || todayIso();
  const ym = date.slice(0, 7);
  const spent = (spentByMonth(data.txs.filter((t) => t.id !== tx.id))[ym] || 0);
  const after = spent + adding;
  const over = after > budget + 0.005;
  return `<div class="small ${over ? 'warn-text' : 'muted'}">Бюджет на ${monthName(ym)}: ${adding ? `после этой покупки ${fmtIls(after)}` : `уже ${fmtIls(spent)}`} из ${fmtIls(budget)}${over ? ' — больше плана' : ''}.</div>`;
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
  if (!symbol) return fail('Выберите компанию.');
  if (!date) return fail('Укажите дату.');
  if (date > todayIso()) return fail('Дата не может быть в будущем.');
  if (!(price > 0)) return fail('Укажите цену одной акции в долларах.');
  if (!(fx > 0)) return fail('Укажите курс доллара.');
  if (fx < 1 || fx > 10) return fail('Курс выглядит странно: обычно $1 стоит 3–4 шекеля.');
  if (!(shares > 0)) return fail(tx.mode === 'ils' ? 'Укажите сумму.' : 'Укажите количество акций.');
  if (fee < 0) return fail('Комиссия не может быть отрицательной.');
  if (tx.type === 'sell') {
    const held = heldShares(symbol, tx.id);
    if (shares > held + EPS) return fail(`Нельзя продать больше, чем есть: у вас ${fmtShares(held)} акций ${symbol}.`);
  }
  if (!data.names[symbol]) {
    try {
      const q = await lookup(symbol);
      if (!q) return fail(`Тикер ${symbol} не найден.`);
    } catch {}
  }

  const note = tx.type === 'buy' ? $('#tx-note').value.trim() : '';
  const record = {
    id: tx.id || uid(), symbol, type: tx.type, date,
    shares: tx.type === 'sell' ? Math.min(shares, heldShares(symbol, tx.id)) : shares,
    price, fx, fee, note,
    created: tx.id ? data.txs.find((t) => t.id === tx.id).created : Date.now(),
  };
  const i = data.txs.findIndex((t) => t.id === record.id);
  if (i >= 0) data.txs[i] = record; else data.txs.push(record);
  if (note && !data.notes[symbol]) data.notes[symbol] = note;
  save();
  $('#tx-dialog').close();
  toast(`${i >= 0 ? 'Исправлено' : 'Записано'}: ${tx.type === 'buy' ? 'покупка' : 'продажа'} ${symbol}`);
  actions.refresh();
  poll();
}

function deleteTx() {
  const i = data.txs.findIndex((t) => t.id === tx.id);
  if (i < 0) return;
  if (!confirm('Удалить эту запись?')) return;
  const [removed] = data.txs.splice(i, 1);
  save();
  $('#tx-dialog').close();
  actions.refresh();
  toast(`Запись ${removed.symbol} удалена`, () => {
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
  $('#w-title').textContent = existing ? `Изменить: ${symbol}` : 'Добавить в наблюдение';
  $('#w-submit').textContent = existing ? 'Сохранить' : 'Добавить';
  $('#w-symbol').value = symbol;
  $('#w-symbol').disabled = !!existing;
  $('#w-symbol-name').textContent = data.names[symbol] || '';
  $('#w-why').value = existing ? existing.why : '';
  $('#w-risk').value = existing ? existing.risk : '';
  $('#w-source').value = existing ? existing.source : '';
  $('#w-source').placeholder = 'Отчёт за ' + monthName(todayIso().slice(0, 7));
  $('#w-error').hidden = true;
  $('#watch-dialog').showModal();
  (symbol ? $('#w-why') : $('#w-symbol')).focus();
}

async function submitWatch() {
  const err = $('#w-error');
  err.hidden = true;
  const symbol = (w.editing || $('#w-symbol').value.trim()).toUpperCase();
  const fields = { why: $('#w-why').value.trim(), risk: $('#w-risk').value, source: $('#w-source').value.trim() };
  if (!symbol) { err.textContent = 'Выберите компанию.'; err.hidden = false; return; }

  if (w.editing) {
    Object.assign(data.watch.find((x) => x.symbol === symbol), fields);
  } else {
    if (data.watch.some((x) => x.symbol === symbol)) { err.textContent = `${symbol} уже в списке.`; err.hidden = false; return; }
    let q = null;
    try { q = await lookup(symbol); } catch {
      err.textContent = 'Нет связи — не могу проверить тикер. Попробуйте позже.';
      err.hidden = false;
      return;
    }
    if (!q) { err.textContent = `Тикер ${symbol} не найден.`; err.hidden = false; return; }
    data.watch.unshift({ symbol, added: todayIso(), addedPrice: lastPrice(q), ...fields });
  }
  save();
  $('#watch-dialog').close();
  toast(w.editing ? 'Сохранено' : `${symbol} добавлена в наблюдение`);
  actions.refresh();
  poll();
}

// ---------- settings ----------

export function setupSettings() {
  const dlg = $('#settings-dialog');
  $('#settings-btn').addEventListener('click', () => {
    $('#s-budget').value = data.settings.budget;
    $('#s-max').value = data.settings.maxShare;
    $('#s-fee').value = data.settings.fee || '';
    dlg.showModal();
  });
  $('#settings-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const budget = parse($('#s-budget')), max = parse($('#s-max')), fee = parse($('#s-fee'));
    if (budget != null && budget >= 0) data.settings.budget = budget;
    if (max != null && max >= 5 && max <= 100) data.settings.maxShare = max;
    data.settings.fee = fee != null && fee >= 0 ? fee : 0;
    save();
    dlg.close();
    toast('Настройки сохранены');
    actions.refresh();
  });
  $('#s-export').addEventListener('click', () => {
    download(`rockets-backup-${todayIso()}.json`, exportJson());
    toast('Файл с копией сохранён');
  });
  $('#s-import').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    if (!confirm('Заменить все текущие записи данными из файла?')) return;
    try {
      importJson(await file.text());
    } catch {
      toast('Это не похоже на файл копии «Моих ракет»');
      return;
    }
    dlg.close();
    toast('Данные загружены из файла');
    actions.refresh();
    poll();
  });
  $('#s-reset').addEventListener('click', () => {
    if (!confirm('Стереть все покупки, список наблюдения и заметки? Это нельзя отменить.')) return;
    if (!confirm('Точно? Советую сначала сохранить копию в файл.')) return;
    resetAll();
    dlg.close();
    toast('Все данные стёрты');
    actions.refresh();
  });
}

