// Boot: tabs, live updates, install prompt.

import { prefs, savePrefs, storageOk } from './store.js';
import { live, onLive, poll } from './live.js';
import { fmtNum } from './format.js';
import { $, $$, setupDialogs } from './ui.js';
import { actions } from './bus.js';
import { renderPortfolio, setupPortfolio } from './portfolio.js';
import { renderWatch, setupWatch } from './watch.js';
import { renderMachine } from './machine.js';
import { renderPlan, setupPlan, planIsEditing } from './plan.js';
import { setupDetail, openDetail, renderDetail, refreshDetail } from './detail.js';
import { setupTx, openTx, setupWatchForm, openWatch, setupSettings } from './forms.js';

const VIEWS = {
  portfolio: { render: renderPortfolio, setup: setupPortfolio, title: 'Портфель' },
  watch: { render: renderWatch, setup: setupWatch, title: 'Наблюдаю' },
  machine: { render: renderMachine, title: 'Машина времени', static: true },
  plan: { render: renderPlan, setup: setupPlan, title: 'План' },
};

let current = null;
const viewEl = (name) => $('#view-' + name);

function show(name) {
  if (!VIEWS[name]) name = 'portfolio';
  const first = current !== name;
  current = name;
  prefs.tab = name;
  savePrefs();
  for (const [k] of Object.entries(VIEWS)) viewEl(k).hidden = k !== name;
  $$('#tabs button').forEach((b) => b.setAttribute('aria-current', b.dataset.view === name ? 'page' : 'false'));
  document.title = VIEWS[name].title + ' · Мои ракеты';
  if (location.hash.slice(1) !== name) history.replaceState(null, '', '#' + name);
  // The time machine keeps its form; it only rebuilds when you come back to it.
  if (first || !VIEWS[name].static) VIEWS[name].render(viewEl(name));
  if (first) window.scrollTo(0, 0);
}

// Re-draws whatever depends on the data, after an edit.
function refresh() {
  if (current && !VIEWS[current].static) VIEWS[current].render(viewEl(current));
  refreshDetail();
}

function renderTop() {
  const pill = $('#fx-pill');
  pill.dataset.kind = live.conn;
  $('.fx-text', pill).textContent = live.fx ? `$1 = ${fmtNum(live.fx, 3, 3)} ₪` : live.conn === 'offline' ? 'нет связи' : '$1 = … ₪';
  const when = live.updated ? new Date(live.updated).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) : '';
  pill.title = live.conn === 'offline'
    ? 'Нет связи с биржевыми данными. Попробую снова через минуту.'
    : `Курс доллара${live.fxSource ? ' (' + live.fxSource + ')' : ''}${when ? ', обновлено в ' + when : ''}`;
}

function setupInstall() {
  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('sw.js').catch((err) => console.warn(err));
  }
  const btn = $('#install');
  let deferred = null;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e;
    btn.hidden = false;
  });
  btn.addEventListener('click', async () => {
    if (!deferred) return;
    deferred.prompt();
    await deferred.userChoice;
    deferred = null;
    btn.hidden = true;
  });
  window.addEventListener('appinstalled', () => { btn.hidden = true; });
}

// A live update must not wipe out something the user is in the middle of.
function busy() {
  const a = document.activeElement;
  if (current === 'plan' && planIsEditing()) return true;
  return a && viewEl(current)?.contains(a) && a.matches('input, textarea, select');
}

Object.assign(actions, { openDetail, openTx, openWatch, show, refresh });

setupDialogs();
for (const [name, v] of Object.entries(VIEWS)) v.setup?.(viewEl(name));
$('#tabs').addEventListener('click', (e) => {
  const b = e.target.closest('[data-view]');
  if (b) show(b.dataset.view);
});
$('#help-btn').addEventListener('click', () => $('#help-dialog').showModal());
window.addEventListener('hashchange', () => show(location.hash.slice(1)));
setupDetail();
setupTx();
setupWatchForm();
setupSettings();
setupInstall();
$('#storage-warning').hidden = storageOk;

onLive(() => {
  renderTop();
  if (current && !VIEWS[current].static && !busy()) VIEWS[current].render(viewEl(current));
  renderDetail();
});

show(location.hash.slice(1) || prefs.tab);
renderTop();
poll();
