// Small DOM helpers shared by all screens.

import { searchSymbols, logoUrl } from './api.js';
import { esc } from './format.js';
import { t } from './i18n.js';

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export const ICONS = {
  rocket: '<path d="M12 2.5c3.2 2.2 5 5.8 5 10.2l-2 2.8H9l-2-2.8c0-4.4 1.8-8 5-10.2z"/><circle cx="12" cy="9.5" r="1.8"/><path d="M9 15.5l-2.6 3.3L9 18.3M15 15.5l2.6 3.3-2.6-.5M10.6 18.6L12 21.6l1.4-3"/>',
  eye: '<path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  clock: '<path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1"/><path d="M3 4v4h4"/><path d="M12 7.5V12l3 2"/>',
  target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.3"/>',
  chart: '<path d="M3 17l5-6 4 3 8-9"/><path d="M3 21h18"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  table: '<path d="M3 5h18v14H3z"/><path d="M3 10h18M3 15h18M9 5v14"/>',
  cards: '<rect x="3" y="4" width="8" height="7" rx="1.5"/><rect x="13" y="4" width="8" height="7" rx="1.5"/><rect x="3" y="13" width="8" height="7" rx="1.5"/><rect x="13" y="13" width="8" height="7" rx="1.5"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/>',
  download: '<path d="M12 4v11M7 10l5 5 5-5"/><path d="M4 20h16"/>',
  trash: '<path d="M4 7h16M9 7V4.5h6V7M6.5 7l1 13h9l1-13"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16v4z"/><path d="M13.5 6.5l4 4"/>',
  cart: '<path d="M3 4h2.5l2.2 10.5h10.6L20.5 7H7"/><circle cx="9.5" cy="19" r="1.4"/><circle cx="17" cy="19" r="1.4"/>',
};

export const icon = (name, size = 18) =>
  `<svg class="ico" viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS[name]}</svg>`;

const letter = (symbol) => esc((symbol.replace(/^[\d.]+/, '')[0] || symbol[0] || '?').toUpperCase());

// Logo images that loaded or failed, so re-renders don't flicker or retry.
const logoOk = new Set(), logoBad = new Set();

// A letter tile, with the company's logo over it once (and if) it loads.
export function logo(symbol) {
  const img = logoBad.has(symbol) ? ''
    : `<img class="logo-img${logoOk.has(symbol) ? ' ok' : ''}" src="${esc(logoUrl(symbol))}" alt="" loading="lazy" data-logo="${esc(symbol)}">`;
  return `<div class="logo"><span>${letter(symbol)}</span>${img}</div>`;
}

export function setupLogos() {
  document.addEventListener('load', (e) => {
    const img = e.target;
    if (!img.dataset || !img.dataset.logo) return;
    // Some services answer unknown tickers with a 1×1 placeholder.
    if (img.naturalWidth < 8) { logoBad.add(img.dataset.logo); img.remove(); return; }
    logoOk.add(img.dataset.logo);
    img.classList.add('ok');
  }, true);
  document.addEventListener('error', (e) => {
    const img = e.target;
    if (!img.dataset || !img.dataset.logo) return;
    logoBad.add(img.dataset.logo);
    img.remove();
  }, true);
}

// ---------- toast ----------

let toastTimer = 0;
export function toast(message, undo) {
  const el = $('#toast');
  $('.msg', el).textContent = message;
  const btn = $('.undo', el);
  btn.textContent = t('undo');
  btn.hidden = !undo;
  btn.onclick = undo ? () => { undo(); el.hidden = true; } : null;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, undo ? 7_000 : 3_500);
}

// ---------- dialogs ----------

// Every [data-close] button closes its dialog; a click on the backdrop does too.
export function setupDialogs() {
  for (const dlg of $$('dialog')) {
    // Only a press that starts on the backdrop counts, so selecting text in
    // a field and releasing outside doesn't close a half-filled form.
    let downOnBackdrop = false;
    dlg.addEventListener('pointerdown', (e) => { downOnBackdrop = e.target === dlg; });
    dlg.addEventListener('click', (e) => {
      if (e.target === dlg && downOnBackdrop) dlg.close();
      if (e.target.closest('[data-close]')) dlg.close();
    });
  }
}

// ---------- company search with suggestions ----------

// input sits in .search-wrap next to a ul.suggestions. onPick({symbol, name}).
export function attachSearch(input, onPick, { exclude = () => false } = {}) {
  const list = input.parentElement.querySelector('.suggestions');
  let timer = 0, seq = 0, active = -1, items = [];

  const hide = () => { list.hidden = true; active = -1; };
  const pick = (r) => { hide(); onPick(r); };

  input.addEventListener('input', () => {
    clearTimeout(timer);
    const q = input.value.trim();
    if (!q) { hide(); return; }
    timer = setTimeout(() => run(q), 280);
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      if (!list.hidden && active >= 0) { e.preventDefault(); pick(items[active]); }
      return;
    }
    if (list.hidden || !items.length) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      active = (active + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
      [...list.children].forEach((li, i) => li.setAttribute('aria-selected', i === active));
    } else if (e.key === 'Escape') {
      e.stopPropagation();
      hide();
    }
  });
  input.addEventListener('blur', () => setTimeout(hide, 150));

  async function run(q) {
    const my = ++seq;
    let found;
    try { found = await searchSymbols(q); } catch (err) { console.warn(err); return; }
    if (my !== seq) return;
    items = found.slice(0, 8);
    active = -1;
    list.innerHTML = items.map((r, i) => `
      <li role="option" data-i="${i}" class="${exclude(r.symbol) ? 'in-list' : ''}">
        <strong>${esc(r.symbol)}</strong><span class="muted">${esc(r.name)}</span><small class="muted exch">${esc(r.exchange)}</small>
      </li>`).join('');
    list.hidden = !items.length;
  }

  list.addEventListener('mousedown', (e) => {
    const li = e.target.closest('li');
    if (!li) return;
    e.preventDefault();
    pick(items[+li.dataset.i]);
  });

  return { hide };
}

// Saves a text file through a download link.
export function download(name, text, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5_000);
}
