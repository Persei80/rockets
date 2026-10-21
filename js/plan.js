// Plan: the monthly budget, the habit, how the money is spread, my rules
// and achievements.

import { data, save } from './store.js';
import { live } from './live.js';
import { positions, valuePositions, spentByMonth, streak } from './calc.js';
import { ACHIEVEMENTS } from './achievements.js';
import { fmtMine, fmtNum, monthName, monthShort, fmtDate, isoDate, todayIso, esc } from './format.js';
import { t, tp } from './i18n.js';
import { icon } from './ui.js';
import { actions } from './bus.js';

let editingRules = false;

const ym = (d) => isoDate(d).slice(0, 7);
const rules = () => data.rules || t('rules.default').split('\n');

function lastMonths(n) {
  const out = [];
  const d = new Date();
  d.setDate(1);
  for (let i = 0; i < n; i++) {
    out.unshift(ym(d));
    d.setMonth(d.getMonth() - 1);
  }
  return out;
}

// The monthly report goes out on the first Saturday of each month.
function nextReport() {
  const firstSat = (y, m) => { const d = new Date(y, m, 1); d.setDate(1 + ((6 - d.getDay() + 7) % 7)); return d; };
  const now = new Date();
  let d = firstSat(now.getFullYear(), now.getMonth());
  if (isoDate(d) < todayIso()) d = firstSat(now.getFullYear(), now.getMonth() + 1);
  return isoDate(d);
}

function monthBars(spent, budget) {
  const months = lastMonths(12);
  const vals = months.map((m) => spent[m] || 0);
  const max = Math.max(budget * 1.25, ...vals, 1);
  const h = (v) => ((v / max) * 100).toFixed(1) + '%';
  return `
    <div class="mbars" role="img" aria-label="${esc(t('plan.byMonth'))}">
      <div class="mbars-area">
        ${budget > 0 ? `<div class="mbudget" style="bottom:${h(budget)}"><span>${t('plan.budgetLine', { b: fmtMine(budget) })}</span></div>` : ''}
        ${vals.map((v, i) => `<div class="mcol" title="${esc(monthName(months[i]))}: ${esc(fmtMine(v))}">
          <span class="mbar${v && budget > 0 && v > budget * 1.001 ? ' over' : ''}${v ? '' : ' zero'}" style="height:${v ? h(v) : '2px'}"></span></div>`).join('')}
      </div>
      <div class="mlabels">${months.map((m) => `<span>${esc(monthShort(m))}</span>`).join('')}</div>
    </div>`;
}

function spread() {
  const list = valuePositions(positions(data.txs), live.quotes, live.fx).filter((p) => p.open);
  if (!list.length) return '';
  const val = (p) => p.valueIls ?? p.costIls;
  const total = list.reduce((s, p) => s + val(p), 0) || 1;
  list.sort((a, b) => val(b) - val(a));
  const max = data.settings.maxShare || 30;
  const heavy = list.filter((p) => (val(p) / total) * 100 > max);
  return `
    <div class="card">
      <h3>${t('plan.spread')}</h3>
      <div class="spread">
        ${list.map((p) => {
          const pct = (val(p) / total) * 100;
          return `<div class="spread-row${pct > max ? ' heavy' : ''}" data-symbol="${esc(p.symbol)}" tabindex="0" role="button">
            <span class="sym">${esc(p.symbol)}</span>
            <span class="bar-track"><span class="bar-fill" style="width:${pct.toFixed(1)}%"></span><span class="bar-limit" style="left:${max}%" title="${esc(t('plan.limit', { p: max }))}"></span></span>
            <span class="pct">${fmtNum(pct, 0, 0)}%</span>
          </div>`;
        }).join('')}
      </div>
      ${heavy.length
        ? `<p class="note-warn small">${t(heavy.length > 1 ? 'plan.heavyMany' : 'plan.heavy', { p: max, s: heavy.map((p) => esc(p.symbol)).join(', ') })}</p>`
        : `<p class="small muted">${t('plan.balanced', { p: max })}</p>`}
      ${list.length < 5 ? `<p class="small muted">${t('plan.fewCompanies', { n: tp('companies', list.length) })}</p>` : ''}
    </div>`;
}

function achievements() {
  const got = ACHIEVEMENTS.filter((a) => data.achievements[a.id]).length;
  return `
    <div class="card">
      <div class="rules-head"><h3>${t('ach.title')}</h3><span class="small muted">${got} / ${ACHIEVEMENTS.length}</span></div>
      <div class="ach-grid">
        ${ACHIEVEMENTS.map((a) => {
          const when = data.achievements[a.id];
          return `<div class="ach${when ? ' got' : ''}" title="${esc(t('ach.' + a.id + '.how'))}">
            <span class="ach-icon">${a.icon}</span>
            <span class="ach-name">${t('ach.' + a.id)}</span>
            <span class="ach-how small muted">${when ? fmtDate(when) : t('ach.' + a.id + '.how')}</span>
          </div>`;
        }).join('')}
      </div>
    </div>`;
}

export function renderPlan(el) {
  const budget = data.settings.budget || 0;
  const spent = spentByMonth(data.txs);
  const thisMonth = ym(new Date());
  const now = spent[thisMonth] || 0;
  const pct = budget > 0 ? Math.min(100, (now / budget) * 100) : 0;
  const left = budget - now;
  const s = streak(spent);
  const totalMonths = Object.keys(spent).length;
  const month = monthName(thisMonth);

  el.innerHTML = `
    <div class="section-head">
      <div>
        <h2>${t('tab.plan')}</h2>
        <p class="muted small">${t('plan.subtitle')}</p>
      </div>
    </div>
    <div class="plan-grid">
      <div class="card budget-card">
        <div class="muted small">${esc(month[0].toUpperCase() + month.slice(1))}</div>
        <div class="budget-line-text"><span class="sum-value">${fmtMine(now)}</span> <span class="muted">${t('plan.of', { b: fmtMine(budget) })}</span></div>
        <div class="progress${now > budget && budget > 0 ? ' over' : ''}"><span style="width:${pct.toFixed(1)}%"></span></div>
        <p class="small">${budget <= 0 ? t('plan.noBudget')
          : left > 0.005 ? t('plan.left', { v: fmtMine(left) })
          : left < -0.005 ? t('plan.over', { v: fmtMine(-left) })
          : t('plan.done')}</p>
        <div class="btn-row">
          <button type="button" class="btn primary" data-go="buy">${icon('plus')} ${t('pf.addBuy')}</button>
          <button type="button" class="btn" data-go="settings">${t('plan.changeBudget')}</button>
        </div>
      </div>
      <div class="card habit-card">
        <div class="muted small">${t('plan.habit')}</div>
        <div class="sum-value">${tp('months', s)}</div>
        <p class="small muted">${s ? t('plan.inARow') : t('plan.zeroStreak')}${totalMonths > s ? ' ' + t('plan.totalMonths', { n: totalMonths }) : ''}</p>
        <div class="muted small habit-next">${t('plan.nextReport')}</div>
        <div><b>${fmtDate(nextReport(), { weekday: 'long', day: 'numeric', month: 'long' })}</b></div>
        <p class="small muted">${t('plan.reportHint')}</p>
      </div>
    </div>
    <div class="card">
      <h3>${t('plan.byMonth')}</h3>
      ${monthBars(spent, budget)}
    </div>
    ${spread()}
    ${achievements()}
    <div class="card rules">
      <div class="rules-head">
        <h3>${t('plan.rules')}</h3>
        <button type="button" class="btn ghost small-btn" data-go="rules">${editingRules ? t('done') : icon('edit', 16) + ' ' + t('edit')}</button>
      </div>
      ${editingRules
        ? `<textarea id="rules-text" rows="7" dir="auto">${esc(rules().join('\n'))}</textarea><p class="small muted">${t('plan.rulesHint')}</p>`
        : `<ol>${rules().map((r) => `<li dir="auto">${esc(r)}</li>`).join('')}</ol>`}
    </div>`;
}

export function setupPlan(el) {
  el.addEventListener('click', (e) => {
    const go = e.target.closest('[data-go]');
    if (go) {
      const what = go.dataset.go;
      if (what === 'buy') actions.openTx({ type: 'buy' });
      else if (what === 'settings') document.getElementById('settings-btn').click();
      else if (what === 'rules') {
        if (editingRules) {
          const text = el.querySelector('#rules-text').value;
          const list = text.split('\n').map((r) => r.trim()).filter(Boolean);
          data.rules = list.join('\n') === t('rules.default') ? null : list;
          save();
        }
        editingRules = !editingRules;
        renderPlan(el);
        if (editingRules) el.querySelector('#rules-text').focus();
      }
      return;
    }
    const row = e.target.closest('[data-symbol]');
    if (row) actions.openDetail(row.dataset.symbol);
  });
}

export const planIsEditing = () => editingRules;
