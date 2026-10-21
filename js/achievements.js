// Achievements: small rewards for good habits (and for lucky rockets).

import { data, save } from './store.js';
import { live } from './live.js';
import { positions, valuePositions, spentByMonth, streak } from './calc.js';
import { t, tp } from './i18n.js';
import { todayIso, parseIso } from './format.js';
import { toast } from './ui.js';

const years = (iso) => (Date.now() - parseIso(iso).getTime()) / (365.25 * 86_400_000);

// Each test gets a snapshot of the portfolio; flags are set by actions elsewhere.
export const ACHIEVEMENTS = [
  { id: 'first', icon: '🚀', test: (c) => c.txCount > 0 },
  { id: 'three', icon: '🛸', test: (c) => c.companies >= 3 },
  { id: 'fleet', icon: '🌌', test: (c) => c.companies >= 10 },
  { id: 'streak3', icon: '📅', test: (c) => c.streak >= 3 },
  { id: 'streak6', icon: '🔥', test: (c) => c.streak >= 6 },
  { id: 'streak12', icon: '🏆', test: (c) => c.streak >= 12 },
  { id: 'double', icon: '✌️', test: (c) => c.best >= 2 },
  { id: 'x5', icon: '🛰️', test: (c) => c.best >= 5 },
  { id: 'x10', icon: '🌠', test: (c) => c.best >= 10 },
  { id: 'x100', icon: '🌕', test: (c) => c.best >= 100 },
  { id: 'hold1', icon: '⏳', test: (c) => c.longest >= 1 },
  { id: 'hold2', icon: '🧘', test: (c) => c.longest >= 2 },
  { id: 'scout', icon: '🔭', test: (c) => c.watch >= 5 },
  { id: 'reasons', icon: '📝', test: (c) => c.notes >= 3 },
  { id: 'balanced', icon: '⚖️', test: (c) => c.open >= 5 && c.maxShare <= data.settings.maxShare },
  { id: 'backup', icon: '💾', flag: true },
  { id: 'timetravel', icon: '⏱️', flag: true },
];

function snapshot() {
  const list = valuePositions(positions(data.txs), live.quotes, live.fx);
  const open = list.filter((p) => p.open);
  const total = open.reduce((s, p) => s + (p.valueIls ?? p.costIls), 0);
  return {
    txCount: data.txs.length,
    companies: list.length,
    open: open.length,
    streak: streak(spentByMonth(data.txs)),
    best: Math.max(0, ...open.map((p) => p.mult ?? 0)),
    longest: Math.max(0, ...open.map((p) => years(p.firstDate))),
    watch: data.watch.length,
    notes: Object.values(data.notes).filter((n) => n && n.trim()).length,
    maxShare: total > 0 ? Math.max(...open.map((p) => ((p.valueIls ?? p.costIls) / total) * 100)) : 100,
  };
}

let celebrate = () => {};
export const onCelebrate = (fn) => { celebrate = fn; };

function announce(ids) {
  if (!ids.length) return;
  if (ids.length === 1) {
    const a = ACHIEVEMENTS.find((x) => x.id === ids[0]);
    toast(`${a.icon} ${t('ach.unlocked')}: ${t('ach.' + a.id)}`);
  } else {
    toast('🎉 ' + tp('ach.many', ids.length));
  }
  celebrate();
}

// Unlocks whatever is now true. Quiet on the very first check after loading
// a backup, so restoring data doesn't fire a cascade of confetti.
export function checkAchievements({ quiet = false } = {}) {
  const c = snapshot();
  const fresh = [];
  for (const a of ACHIEVEMENTS) {
    if (a.flag || data.achievements[a.id]) continue;
    // Multiples need live prices; don't judge them before quotes arrive.
    if (['double', 'x5', 'x10', 'x100', 'balanced'].includes(a.id) && !live.updated) continue;
    if (a.test(c)) { data.achievements[a.id] = todayIso(); fresh.push(a.id); }
  }
  if (fresh.length) {
    save();
    if (!quiet) announce(fresh);
  }
  return fresh;
}

export function unlockFlag(id) {
  if (data.achievements[id]) return;
  data.achievements[id] = todayIso();
  save();
  announce([id]);
}
