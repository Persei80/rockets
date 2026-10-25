// Claude's take: once a month the report ends with a block of lines like
// "AMPX | временно | why the price moves". Pasting it here files one short
// verdict per company, shown on the cards and in the company window.

import { data, save } from './store.js';
import { fmtDate, esc, todayIso, parseIso } from './format.js';
import { t, tp } from './i18n.js';
import { $, toast } from './ui.js';
import { actions } from './bus.js';
import { reportLink } from './report.js';

export const VERDICTS = ['ok', 'watch', 'broken'];
const STALE_DAYS = 45;

// Checked in this order: "не восстановится" must not read as "временно".
const WORDS = [
  ['broken', /слом|не восстанов|broken|sell/i],
  ['watch', /вопрос|следить|осторож|watch|unclear|uncertain|question/i],
  ['ok', /временн|в порядке|цела|temporar|intact|fine|\bok\b/i],
];

function verdictOf(word) {
  const hit = WORDS.find(([, re]) => re.test(word));
  return hit ? hit[0] : null;
}

function dateOf(text) {
  let m = text.match(/(\d{4})-(\d\d)-(\d\d)/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = text.match(/\b(\d\d?)[./](\d\d?)[./](\d{4})\b/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return todayIso();
}

// Lines whose middle part isn't a known verdict (table headers, prose) are skipped.
export function parseOpinions(text) {
  const items = new Map();
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.replace(/\*\*|`/g, '').replace(/^\s*\|/, '').replace(/\|\s*$/, '');
    const m = line.match(/^\s*(?:[-*•]\s*)?\$?([A-Za-z][A-Za-z0-9.]{0,9})\s*[|｜]\s*([^|｜]+?)\s*[|｜]\s*(.+?)\s*$/);
    if (!m) continue;
    const verdict = verdictOf(m[2]);
    if (!verdict) continue;
    items.set(m[1].toUpperCase(), { verdict, text: m[3].slice(0, 600) });
  }
  return { date: dateOf(text), items: [...items].map(([symbol, v]) => ({ symbol, ...v })) };
}

const isStale = (op) => (Date.now() - parseIso(op.date).getTime()) / 86_400_000 > STALE_DAYS;

// Compact line for cards; full version for the company window.
export function opinionLine(symbol, { full = false } = {}) {
  const op = data.opinions[symbol];
  if (!op) return '';
  const stale = isStale(op);
  return `
    <div class="opinion op-${op.verdict}${stale ? ' stale' : ''}" title="${esc(t('op.vh.' + op.verdict))}">
      <div class="op-head"><span class="op-dot"></span><b>${t('op.v.' + op.verdict)}</b>
        <span class="muted">· ${t('op.by', { d: fmtDate(op.date) })}</span></div>
      <div class="op-text${full ? '' : ' clamped'}" dir="auto">${esc(op.text)}</div>
      ${full ? `<div class="small muted">${t('op.vh.' + op.verdict)}</div>` : ''}
      ${stale ? `<div class="small muted">${t('op.old')}</div>` : ''}
    </div>`;
}

// A dot for the table view, with the reason on hover.
export function opinionDot(symbol) {
  const op = data.opinions[symbol];
  return op ? `<span class="op-dot op-${op.verdict}" title="${esc(t('op.v.' + op.verdict) + ': ' + op.text)}"></span>` : '';
}

function preview() {
  const { date, items } = parseOpinions($('#op-text').value);
  const known = (s) => data.txs.some((x) => x.symbol === s) || data.watch.some((w) => w.symbol === s);
  $('#op-submit').disabled = !items.length;
  $('#op-preview').innerHTML = !$('#op-text').value.trim() ? ''
    : !items.length ? `<p class="muted">${t('op.none')}</p>`
      : `<p>${tp('op.found', items.length)} <span class="muted">${t('op.date', { d: fmtDate(date) })}</span></p>
        <ul class="op-list">${items.map((it) => `
          <li><span class="op-dot op-${it.verdict}"></span><b>${esc(it.symbol)}</b> ${t('op.v.' + it.verdict)}
            ${known(it.symbol) ? '' : `<span class="muted">(${t('op.notInApp')})</span>`}</li>`).join('')}</ul>`;
}

export function setupOpinions() {
  $('#op-text').addEventListener('input', preview);
  $('#op-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const { date, items } = parseOpinions($('#op-text').value);
    if (!items.length) return;
    for (const it of items) data.opinions[it.symbol] = { verdict: it.verdict, text: it.text, date };
    save();
    $('#op-dialog').close();
    toast(tp('op.saved', items.length));
    actions.refresh();
  });
}

export function openOpinions() {
  $('#op-text').value = '';
  $('#op-latest').innerHTML = reportLink();
  preview();
  $('#op-dialog').showModal();
  $('#op-text').focus();
}
