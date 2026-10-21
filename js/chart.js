// A small SVG line chart with a hover crosshair. Points are spaced by index,
// so nights and weekends don't leave gaps (like Google Finance).
//
// opts: {
//   n,                                   number of points
//   series: [{ values, color, dashed, fill, width }],   values[i] may be null
//   yFmt(v), xLabel(i), tip(i) -> [main, sub],
//   xTicks: indexes for x labels (optional), baseline: value (optional),
//   markers: [{ i, v, kind: 'buy'|'sell' }]
// }

const $ = (sel, root) => root.querySelector(sel);

function niceTicks(min, max, count) {
  const span = max - min || Math.abs(max) || 1;
  const raw = span / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw);
  const ticks = [];
  for (let v = Math.ceil(min / step) * step; v <= max + step * 1e-6; v += step) ticks.push(Math.abs(v) < step * 1e-6 ? 0 : v);
  return ticks;
}

// wrap contains: <svg>, .chart-tip (.tip-main, .tip-sub), .chart-msg
export function createChart(wrap) {
  const svg = $('svg', wrap);
  const tip = $('.chart-tip', wrap);
  const msg = $('.chart-msg', wrap);
  let opts = null;
  let geom = null;

  function message(text) {
    msg.textContent = text || '';
    msg.hidden = !text;
    if (text) { svg.innerHTML = ''; geom = null; opts = null; hideTip(); }
  }

  function draw(next) {
    if (next) opts = next;
    if (!opts || opts.n < 2) return;
    message('');
    const W = wrap.clientWidth, H = wrap.clientHeight;
    if (!W || !H) return;
    const m = { top: 12, right: 66, bottom: 26, left: 4 };
    const n = opts.n;

    // On a log scale equal steps mean equal multiples (×2, ×10…).
    const log = !!opts.log;
    const tv = log ? (v) => (v > 0 ? Math.log10(v) : null) : (v) => v;
    let min = Infinity, max = -Infinity;
    const see = (v) => { const u = tv(v); if (u != null) { if (u < min) min = u; if (u > max) max = u; } };
    for (const s of opts.series) for (const v of s.values) if (v != null) see(v);
    for (const mk of opts.markers || []) see(mk.v);
    if (opts.baseline != null) see(opts.baseline);
    const pad = (max - min) * 0.07 || Math.abs(max) * 0.02 || 1;
    min = log ? min - pad : Math.max(0, min - pad);
    max += pad;

    let yTicks;
    if (log) {
      const cand = [];
      for (let k = Math.floor(min); k <= Math.ceil(max); k++) for (const m of [1, 2, 5]) cand.push(m * 10 ** k);
      yTicks = cand.filter((v) => Math.log10(v) >= min && Math.log10(v) <= max);
      if (yTicks.length > 6) yTicks = yTicks.filter((v) => /^1/.test(v.toExponential()));
      if (yTicks.length < 2) yTicks = niceTicks(10 ** min, 10 ** max, 3).filter((v) => v > 0);
    } else {
      yTicks = niceTicks(min, max, H < 240 ? 3 : 4);
    }
    const yLabels = yTicks.map(opts.yFmt);
    // Leave room on the right for the longest price label.
    m.right = Math.max(44, Math.ceil(Math.max(...yLabels.map((l) => l.length)) * 7.2) + 10);
    const iw = W - m.left - m.right, ih = H - m.top - m.bottom;
    const x = (i) => m.left + (i / (n - 1)) * iw;
    const y = (v) => m.top + (1 - (tv(v) - min) / (max - min)) * ih;

    let out = yTicks.map((v, k) => `
      <line class="gl" x1="${m.left}" x2="${m.left + iw}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}"></line>
      <text class="ylab" x="${W - 4}" y="${(y(v) + 4).toFixed(1)}" text-anchor="end">${yLabels[k]}</text>`).join('');

    if (opts.baseline != null) {
      out += `<line class="baseline" x1="${m.left}" x2="${m.left + iw}" y1="${y(opts.baseline).toFixed(1)}" y2="${y(opts.baseline).toFixed(1)}"></line>`;
    }

    opts.series.forEach((s, k) => {
      const segs = [];
      let cur = [];
      s.values.forEach((v, i) => {
        if (v == null || tv(v) == null) { if (cur.length) segs.push(cur); cur = []; return; }
        cur.push([x(i), y(v)]);
      });
      if (cur.length) segs.push(cur);
      for (const seg of segs) {
        const d = seg.map(([a, b]) => `${a.toFixed(1)},${b.toFixed(1)}`).join(' L');
        if (s.fill) {
          const id = 'fill' + k + Math.random().toString(36).slice(2, 7);
          out += `<defs><linearGradient id="${id}" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0" stop-color="${s.color}" stop-opacity="0.22"></stop>
              <stop offset="1" stop-color="${s.color}" stop-opacity="0"></stop></linearGradient></defs>
            <path d="M${seg[0][0].toFixed(1)},${(m.top + ih).toFixed(1)} L${d} L${seg[seg.length - 1][0].toFixed(1)},${(m.top + ih).toFixed(1)} Z" fill="url(#${id})"></path>`;
        }
        out += `<path d="M${d}" fill="none" stroke="${s.color}" stroke-width="${s.width || 2}" stroke-linejoin="round"${s.dashed ? ' stroke-dasharray="5 5"' : ''}></path>`;
      }
    });

    for (const mk of opts.markers || []) {
      out += `<circle class="marker ${mk.kind}" cx="${x(mk.i).toFixed(1)}" cy="${y(mk.v).toFixed(1)}" r="5"></circle>`;
    }

    // X labels: given ticks or evenly spaced, skipping repeats.
    let xIdx = opts.xTicks;
    if (!xIdx) {
      const k = Math.max(2, Math.min(5, Math.floor(iw / 105)));
      xIdx = Array.from({ length: k }, (_, j) => Math.round((j / (k - 1)) * (n - 1)));
    }
    let last = '';
    for (const i of xIdx) {
      const label = opts.xLabel(i);
      if (label === last) continue;
      last = label;
      const anchor = opts.xTicks || i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle';
      out += `<text class="xlab" x="${x(i).toFixed(1)}" y="${H - 7}" text-anchor="${anchor}">${label}</text>`;
    }

    out += `<g class="hover" visibility="hidden"><line class="cross" y1="${m.top}" y2="${m.top + ih}"></line>
      ${opts.series.map((s) => `<circle r="4.5" fill="${s.color}" stroke="var(--surface)" stroke-width="2"></circle>`).join('')}</g>`;

    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.setAttribute('width', W);
    svg.setAttribute('height', H);
    svg.innerHTML = out;
    geom = { x, y, m, iw };
  }

  function showTip(e) {
    if (!opts || !geom) return;
    const rect = wrap.getBoundingClientRect();
    const { x, y, m, iw } = geom;
    const i = Math.max(0, Math.min(opts.n - 1, Math.round(((e.clientX - rect.left - m.left) / iw) * (opts.n - 1))));
    const g = $('.hover', svg);
    if (!g) return;
    g.setAttribute('visibility', 'visible');
    const cx = x(i);
    const line = $('line', g);
    line.setAttribute('x1', cx);
    line.setAttribute('x2', cx);
    [...g.querySelectorAll('circle')].forEach((c, k) => {
      const v = opts.series[k].values[i];
      c.setAttribute('visibility', v == null || (opts.log && !(v > 0)) ? 'hidden' : 'visible');
      if (v != null) { c.setAttribute('cx', cx); c.setAttribute('cy', y(v)); }
    });
    const [main, sub] = opts.tip(i);
    $('.tip-main', tip).textContent = main;
    $('.tip-sub', tip).textContent = sub;
    tip.hidden = false;
    const tw = tip.offsetWidth;
    tip.style.left = Math.max(0, Math.min(rect.width - tw, cx - tw / 2)) + 'px';
  }

  function hideTip() {
    const g = $('.hover', svg);
    if (g) g.setAttribute('visibility', 'hidden');
    tip.hidden = true;
  }

  wrap.addEventListener('pointermove', showTip);
  wrap.addEventListener('pointerdown', showTip);
  wrap.addEventListener('pointerleave', hideTip);
  new ResizeObserver(() => { if (opts) draw(); }).observe(wrap);

  return { draw, message, hideTip };
}
