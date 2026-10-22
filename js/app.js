// Boot: language, theme, tabs, live updates, install prompt.

import { data, prefs, savePrefs, storageOk } from './store.js';
import { live, onLive, poll } from './live.js';
import { fmtNum, privacy } from './format.js';
import { t, setLang, detectLang, translateDom, getLang } from './i18n.js';
import { $, $$, setupDialogs, setupLogos } from './ui.js';
import { actions } from './bus.js';
import { renderPortfolio, setupPortfolio } from './portfolio.js';
import { renderWatch, setupWatch } from './watch.js';
import { renderMachine } from './machine.js';
import { renderPlan, setupPlan, planIsEditing } from './plan.js';
import { setupDetail, openDetail, renderDetail, refreshDetail, paintRanges } from './detail.js';
import { setupTx, openTx, setupWatchForm, openWatch, setupSettings, setupWelcome, showWelcome } from './forms.js';
import { checkAchievements, onCelebrate } from './achievements.js';
import { setupOpinions, openOpinions } from './opinions.js';
import { confetti } from './effects.js';

const VIEWS = {
  portfolio: { render: renderPortfolio, setup: setupPortfolio },
  watch: { render: renderWatch, setup: setupWatch },
  machine: { render: renderMachine, static: true },
  plan: { render: renderPlan, setup: setupPlan },
};

let current = null;
const viewEl = (name) => $('#view-' + name);

function show(name, { force = false } = {}) {
  if (!VIEWS[name]) name = 'portfolio';
  const first = current !== name;
  current = name;
  prefs.tab = name;
  savePrefs();
  for (const k of Object.keys(VIEWS)) viewEl(k).hidden = k !== name;
  $$('#tabs button').forEach((b) => b.setAttribute('aria-current', b.dataset.view === name ? 'page' : 'false'));
  document.title = t('tab.' + name) + ' · ' + t('app.name');
  if (location.hash.slice(1) !== name) history.replaceState(null, '', '#' + name);
  if (first && name === 'portfolio') renderPortfolio.reset();
  // The time machine keeps its form; it only rebuilds when you come back to it.
  if (first || force || !VIEWS[name].static) VIEWS[name].render(viewEl(name), { force: first || force });
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
  $('.fx-text', pill).textContent = live.fx ? `$1 = ${fmtNum(live.fx, 3, 3)} ₪` : live.conn === 'offline' ? t('top.offline') : '$1 = … ₪';
  const when = live.updated ? new Date(live.updated).toLocaleTimeString(getLang() === 'ru' ? 'ru-RU' : 'en-US', { hour: '2-digit', minute: '2-digit' }) : '';
  pill.title = live.conn === 'offline' ? t('top.offlineTip') : t('top.fxTip', { src: live.fxSource || '—', time: when || '—' });
  const pb = $('#privacy-btn');
  pb.setAttribute('aria-pressed', privacy.on);
  pb.title = t(privacy.on ? 'top.showAmounts' : 'top.hideAmounts');
  pb.setAttribute('aria-label', pb.title);
  $('#lang-btn').textContent = getLang() === 'ru' ? 'EN' : 'RU';
  $('#lang-btn').title = t('top.switchLang');
}

// Language and theme; re-renders every screen in place.
function applyAppearance() {
  setLang(prefs.lang || detectLang());
  const theme = ['light', 'dark'].includes(prefs.theme) ? prefs.theme : null;
  if (theme) document.documentElement.dataset.theme = theme;
  else delete document.documentElement.dataset.theme;
  const dark = theme === 'dark' || (!theme && matchMedia('(prefers-color-scheme: dark)').matches);
  $('meta[name="theme-color"]').content = dark ? '#0d0b1e' : '#f5f4fb';
  translateDom();
  paintRanges();
  $('#toast').hidden = true; // a message in the old language would linger
  renderTop();
  if (current) show(current, { force: true });
  refreshDetail();
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

Object.assign(actions, { openDetail, openTx, openWatch, openOpinions, show, refresh });
privacy.on = !!prefs.privacy;
setLang(prefs.lang || detectLang());

setupDialogs();
setupLogos();
for (const [name, v] of Object.entries(VIEWS)) v.setup?.(viewEl(name));
$('#tabs').addEventListener('click', (e) => {
  const b = e.target.closest('[data-view]');
  if (b) show(b.dataset.view);
});
$('#help-btn').addEventListener('click', () => $('#help-dialog').showModal());
$('#privacy-btn').addEventListener('click', () => {
  privacy.on = !privacy.on;
  prefs.privacy = privacy.on;
  savePrefs();
  document.body.classList.toggle('private', privacy.on);
  renderTop();
  refresh();
  if (current === 'machine') show('machine', { force: true });
});
$('#lang-btn').addEventListener('click', () => {
  prefs.lang = getLang() === 'ru' ? 'en' : 'ru';
  savePrefs();
  applyAppearance();
});
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { if (prefs.theme === 'auto') applyAppearance(); });
window.addEventListener('hashchange', () => show(location.hash.slice(1)));
setupDetail();
setupTx();
setupWatchForm();
setupOpinions();
setupSettings({ onAppearance: applyAppearance });
setupWelcome({ onAppearance: applyAppearance });
setupInstall();
onCelebrate(confetti);
$('#storage-warning').hidden = storageOk;
document.body.classList.toggle('private', privacy.on);

let firstLive = true;
onLive(() => {
  renderTop();
  if (current && !VIEWS[current].static && !busy()) VIEWS[current].render(viewEl(current));
  renderDetail();
  // Restored or older data shouldn't greet you with a burst of confetti.
  checkAchievements({ quiet: firstLive });
  firstLive = false;
});

applyAppearance();
show(location.hash.slice(1) || prefs.tab);
poll();
if (!prefs.welcomed && !data.txs.length && !data.watch.length) showWelcome();
