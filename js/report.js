// The automatic report: a scheduled Claude run writes claude/report.json into
// this site (weekly verdicts, monthly picks). On start the app files the
// verdicts under each company and offers the new candidates.

import { data, save, prefs, savePrefs } from './store.js';
import { live, poll } from './live.js';
import { fetchQuotes, lastPrice } from './api.js';
import { riskLabel } from './calc.js';
import { fmtDate, esc, todayIso } from './format.js';
import { t } from './i18n.js';
import { $, icon, logo, toast } from './ui.js';
import { VERDICTS } from './opinions.js';
import { actions } from './bus.js';

export const report = { current: null };

const ISO = /^\d{4}-\d\d-\d\d$/;
const SYMBOL = /^[A-Z][A-Z0-9.]{0,9}$/;
const str = (v, max = 800) => String(v ?? '').trim().slice(0, max);
let lastFetch = 0;

// Text written by the model carries class "ut" (it is in whatever language
// the report was written in). The file is written by a model; keep only what has the expected shape.
function clean(raw) {
  if (!raw || typeof raw !== 'object' || !ISO.test(raw.date)) return null;
  const list = (v) => (Array.isArray(v) ? v : []);
  const sym = (v) => str(v, 12).toUpperCase();
  return {
    date: raw.date,
    kind: raw.kind === 'monthly' ? 'monthly' : 'weekly',
    summary: str(raw.summary),
    plan: str(raw.plan),
    creative: str(raw.creative),
    bitcoin: str(raw.bitcoin),
    opinions: list(raw.opinions)
      .map((o) => ({ symbol: sym(o?.symbol), verdict: o?.verdict, text: str(o?.text, 600) }))
      .filter((o) => SYMBOL.test(o.symbol) && VERDICTS.includes(o.verdict) && o.text),
    candidates: list(raw.candidates)
      .map((c) => ({
        symbol: sym(c?.symbol),
        name: str(c?.name, 120),
        why: str(c?.why),
        risk: ['high', 'vhigh', 'lottery'].includes(c?.risk) ? c.risk : '',
        amount: Number.isFinite(+c?.amount) && +c.amount > 0 ? Math.round(+c.amount) : null,
        creative: !!c?.creative,
      }))
      .filter((c) => SYMBOL.test(c.symbol)),
    // The full watchlist Claude keeps; null when the report doesn't carry one.
    watch: Array.isArray(raw.watch)
      ? raw.watch
        .map((w) => ({
          symbol: sym(w?.symbol),
          name: str(w?.name, 120),
          why: str(w?.why),
          risk: ['high', 'vhigh', 'lottery'].includes(w?.risk) ? w.risk : '',
        }))
        .filter((w) => SYMBOL.test(w.symbol))
        .slice(0, 40)
      : null,
    sources: list(raw.sources)
      .map((s) => ({ title: str(s?.title, 120), url: str(s?.url, 500) }))
      .filter((s) => /^https:\/\//.test(s.url))
      .slice(0, 20),
  };
}

// A verdict pasted by hand on the same or a later date wins over the report;
// a report rewritten the same day replaces its own earlier verdicts.
export async function loadReport() {
  lastFetch = Date.now();
  let raw;
  try {
    const res = await fetch('claude/report.json', { cache: 'no-store' });
    if (!res.ok) return;
    raw = await res.json();
  } catch {
    return;
  }
  const r = clean(raw);
  if (!r) return;
  report.current = r;
  let changed = false;
  for (const o of r.opinions) {
    const old = data.opinions[o.symbol];
    if (old && (old.date > r.date || (old.date === r.date && old.hand))) continue;
    if (old && old.date === r.date && old.verdict === o.verdict && old.text === o.text) continue;
    data.opinions[o.symbol] = { verdict: o.verdict, text: o.text, date: r.date };
    changed = true;
  }
  for (const c of r.candidates) if (c.name && !data.names[c.symbol]) data.names[c.symbol] = c.name;
  if (r.watch && syncWatch(r)) changed = true;
  if (changed) save();
  actions.refresh();
}

// The report's watchlist is the list Claude keeps: its companies are added (or
// taken over if already there) with Claude's text, and the ones Claude dropped
// go away. Companies added by hand and never in the list stay untouched.
function syncWatch(r) {
  const keep = new Map(r.watch.map((w) => [w.symbol, w]));
  const source = t('rp.source', { d: fmtDate(r.date) });
  const before = data.watch.length;
  data.watch = data.watch.filter((w) => w.by !== 'claude' || keep.has(w.symbol));
  let changed = data.watch.length !== before;
  const fresh = [];
  for (const c of r.watch) {
    if (c.name && !data.names[c.symbol]) data.names[c.symbol] = c.name;
    const w = data.watch.find((x) => x.symbol === c.symbol);
    const why = c.why || w?.why || '';
    if (!w) fresh.push({ symbol: c.symbol, added: todayIso(), addedPrice: null, why, risk: c.risk, source, by: 'claude' });
    else if (w.by !== 'claude' || w.why !== why || w.risk !== c.risk) {
      Object.assign(w, { why, risk: c.risk, source, by: 'claude' });
      changed = true;
    }
  }
  if (fresh.length) {
    data.watch.unshift(...fresh);
    changed = true;
  }
  // Also retries the ones whose price couldn't be fetched earlier the same day.
  const unpriced = data.watch.filter((w) => w.by === 'claude' && w.addedPrice == null && w.added === todayIso());
  if (unpriced.length) fillPrices(unpriced.map((w) => w.symbol));
  return changed;
}

// Price on the day Claude added a company, for "since added".
async function fillPrices(symbols) {
  const need = symbols.filter((s) => !live.quotes[s]);
  if (need.length) {
    try { Object.assign(live.quotes, await fetchQuotes(need)); } catch { /* filled on a later start */ }
  }
  let got = false;
  for (const s of symbols) {
    const w = data.watch.find((x) => x.symbol === s);
    const price = lastPrice(live.quotes[s]);
    if (w && w.addedPrice == null && price != null) { w.addedPrice = price; got = true; }
  }
  if (!got) return;
  save();
  actions.refresh();
  poll();
}

export function setupReport() {
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-report]');
    if (!b) return;
    if (b.dataset.report === 'open') openReport();
    else if (b.dataset.report === 'dismiss') markSeen();
    else if (b.dataset.report === 'add') addCandidate(b.dataset.symbol, b);
  });
  $('#report-dialog').addEventListener('close', () => actions.refresh());
  // The app may stay open for days in the Dock; look again now and then.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && Date.now() - lastFetch > 3_600_000) loadReport();
  });
}

// A report counts as seen per date and candidate list, so candidates added to
// the same day's report announce themselves again.
const seenKey = (r) => `${r.date} ${r.candidates.map((c) => c.symbol).join(',')}`;
const isNew = () => !!report.current && seenKey(report.current) !== (prefs.reportSeen || '');

function markSeen() {
  if (!report.current) return;
  prefs.reportSeen = seenKey(report.current);
  savePrefs();
  actions.refresh();
}

export function reportBanner() {
  if (!isNew()) return '';
  const r = report.current;
  return `
    <div class="report-banner card">
      <div class="rb-icon">${icon('spark', 20)}</div>
      <div class="rb-text">
        <b>${t(r.kind === 'monthly' ? 'rp.newMonthly' : 'rp.newWeekly', { d: fmtDate(r.date) })}</b>
        ${r.summary ? `<div class="small muted ut" dir="auto">${esc(r.summary)}</div>` : ''}
      </div>
      <button type="button" class="btn primary small-btn" data-report="open">${t('rp.open')}</button>
      <button type="button" class="close-btn" data-report="dismiss" aria-label="${esc(t('close'))}">&times;</button>
    </div>`;
}

// One line for the paste dialog, so the latest report can always be reopened.
export function reportLink() {
  const r = report.current;
  return r ? `<p class="small">${t('rp.latest', { d: fmtDate(r.date) })} <button type="button" class="link-btn" data-report="open">${t('rp.open')}</button></p>` : '';
}

function candidate(c) {
  const watched = data.watch.some((w) => w.symbol === c.symbol);
  return `
    <li class="rp-cand">
      <div class="rp-cand-head">
        ${logo(c.symbol)}
        <div class="ident">
          <div class="symbol">${esc(c.symbol)} ${c.risk ? `<span class="badge risk-${c.risk}">${esc(riskLabel(c.risk))}</span>` : ''} ${c.creative ? `<span class="badge">${t('rp.creative')}</span>` : ''}</div>
          <div class="name muted small">${esc(c.name)}</div>
        </div>
        ${c.amount ? `<div class="rp-amount">${t('rp.amount', { a: c.amount })}</div>` : ''}
      </div>
      ${c.why ? `<div class="why ut" dir="auto">${esc(c.why)}</div>` : ''}
      <button type="button" class="btn small-btn" data-report="add" data-symbol="${esc(c.symbol)}"${watched ? ' disabled' : ''}>
        ${watched ? t('rp.watching') : `${icon('eye', 16)} ${t('rp.add')}`}</button>
    </li>`;
}

function render() {
  const r = report.current;
  const body = $('#report-body');
  if (!r) { body.innerHTML = ''; return; }
  $('#rp-title').textContent = t(r.kind === 'monthly' ? 'rp.titleMonthly' : 'rp.titleWeekly', { d: fmtDate(r.date) });
  body.innerHTML = `
    ${r.summary ? `<p class="ut" dir="auto">${esc(r.summary)}</p>` : ''}
    ${r.plan ? `<div class="rp-plan" dir="auto"><b>${t('rp.plan')}</b> <span class="ut">${esc(r.plan)}</span></div>` : ''}
    ${r.opinions.length ? `<h3>${t('rp.mine')}</h3>
      <ul class="rp-ops">${r.opinions.map((o) => `
        <li><div class="op-head"><span class="op-dot op-${o.verdict}"></span><b>${esc(o.symbol)}</b> <span class="op-${o.verdict} op-word">${t('op.v.' + o.verdict)}</span></div>
          <div class="small ut" dir="auto">${esc(o.text)}</div></li>`).join('')}</ul>` : ''}
    ${r.candidates.length ? `<h3>${t('rp.cands')}</h3><ul class="rp-cands">${r.candidates.map(candidate).join('')}</ul>` : ''}
    ${r.creative ? `<p class="small" dir="auto"><b>${t('rp.creativeLine')}</b> <span class="ut">${esc(r.creative)}</span></p>` : ''}
    ${r.bitcoin ? `<div class="note-warn small ut" dir="auto">${esc(r.bitcoin)}</div>` : ''}
    ${r.sources.length ? `<details class="small rp-sources"><summary>${t('rp.sources')}</summary><ul>${r.sources.map((s) => `<li><a href="${esc(s.url)}" target="_blank" rel="noopener"><span class="ut">${esc(s.title || s.url)}</span></a></li>`).join('')}</ul></details>` : ''}
    <p class="small muted">${t('rp.note')}</p>`;
}

export function openReport() {
  if (!report.current) return;
  render();
  const dlg = $('#report-dialog');
  if (!dlg.open) dlg.showModal();
  $('.sheet-body', dlg).scrollTop = 0;
  if (isNew()) { prefs.reportSeen = seenKey(report.current); savePrefs(); }
}

async function addCandidate(symbol, btn) {
  const r = report.current;
  const c = r?.candidates.find((x) => x.symbol === symbol);
  if (!c || data.watch.some((w) => w.symbol === symbol)) return;
  btn.disabled = true;
  let q = live.quotes[symbol];
  if (!q) {
    try { q = (await fetchQuotes([symbol]))[symbol]; } catch { q = null; }
    if (q) live.quotes[symbol] = q;
  }
  if (data.watch.some((w) => w.symbol === symbol)) return;
  data.watch.unshift({
    symbol, added: todayIso(), addedPrice: lastPrice(q), why: c.why, risk: c.risk,
    source: t('rp.source', { d: fmtDate(r.date) }),
  });
  save();
  toast(t('w.added', { s: symbol }));
  render();
  actions.refresh();
  poll();
}
