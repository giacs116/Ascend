// Hand-rolled SVG charts following the dataviz spec:
// thin marks, 4px rounded data-ends, 2px surface gaps/rings, solid hairline grids,
// text in text-tokens (never series colors), tooltips with generous hit targets.
import { h, cssVar, fmtShort, fmtInt, debounce } from './util.js';

const NS = 'http://www.w3.org/2000/svg';
function sv(tag, attrs = {}, ...children) {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined) continue;
    el.setAttribute(k, v);
  }
  el.append(...children);
  return el;
}

const alpha = (hex, a) => {
  // hex #RRGGBB + alpha 0..1 → rgba()
  const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${a})`;
};

function niceMax(v) {
  if (v <= 0) return 10;
  const pow = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / pow;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10;
  return step * pow;
}

function makeTip(wrap) {
  const tip = h('div', { class: 'chart-tip' });
  wrap.append(tip);
  return {
    show(px, py, buildContent) {
      tip.replaceChildren();
      buildContent(tip);
      tip.classList.add('show');
      const ww = wrap.clientWidth;
      const tw = tip.offsetWidth, th = tip.offsetHeight;
      let x = px - tw / 2;
      x = Math.max(4, Math.min(ww - tw - 4, x));
      let y = py - th - 12;
      if (y < 0) y = py + 14;
      tip.style.left = `${x}px`;
      tip.style.top = `${y}px`;
    },
    hide() { tip.classList.remove('show'); },
  };
}

const tipDate = (label) => h('div', { class: 'tt-date' }, label);
const tipRow = (color, valueText, labelText) =>
  h('div', { class: 'tt-row' },
    color ? h('span', { class: 'k', style: { background: color } }) : null,
    h('b', {}, valueText), labelText ? h('span', {}, labelText) : null);

// Charts render after mount (need real width); rebuild on resize.
function responsive(host, build) {
  let built = false;
  const run = () => {
    if (!host.isConnected) return;
    host.replaceChildren();
    build(Math.max(280, host.clientWidth || 320));
    built = true;
  };
  requestAnimationFrame(run);
  const ro = new ResizeObserver(debounce(() => { if (built) run(); }, 150));
  ro.observe(host);
  return host;
}

// ── Ring meter (dashboard) ───────────────────────────────────
export function ringMeter({ size = 96, stroke = 10, pct = 0, color, value, sub, label }) {
  const r = (size - stroke) / 2;
  const C = 2 * Math.PI * r;
  const p = Math.max(0, Math.min(1, pct));
  const arc = sv('circle', {
    cx: size / 2, cy: size / 2, r,
    fill: 'none', stroke: color, 'stroke-width': stroke, 'stroke-linecap': 'round',
    'stroke-dasharray': C, 'stroke-dashoffset': C,
    transform: `rotate(-90 ${size / 2} ${size / 2})`,
    style: 'transition: stroke-dashoffset 0.9s cubic-bezier(0.2, 0.8, 0.2, 1)',
  });
  const svg = sv('svg', { width: size, height: size, viewBox: `0 0 ${size} ${size}` },
    sv('circle', { cx: size / 2, cy: size / 2, r, fill: 'none', stroke: alpha(color, 0.16), 'stroke-width': stroke }),
    arc,
    sv('text', { x: size / 2, y: size / 2 - 1, 'text-anchor': 'middle', 'font-size': size * 0.19, class: 'ring-center' }, value),
    sv('text', { x: size / 2, y: size / 2 + size * 0.14, 'text-anchor': 'middle', class: 'ring-sub' }, sub || '')
  );
  requestAnimationFrame(() => requestAnimationFrame(() => {
    arc.setAttribute('stroke-dashoffset', C * (1 - p));
  }));
  return h('div', { class: 'ringbox' }, svg, label ? h('div', { class: 'ring-label' }, label) : null);
}

// ── Bar chart with optional target line ─────────────────────
export function barChart(host, { data, color, target, targetLabel, yFmt = fmtInt, height = 190, xLabel }) {
  host.classList.add('chart-wrap');
  return responsive(host, (W) => {
    const H = height;
    const padL = 40, padR = 8, padT = 16, padB = 20;
    const plotW = W - padL - padR, plotH = H - padT - padB;
    const n = data.length;
    const ymax = niceMax(Math.max(...data.map((d) => d.value), target || 0, 1) * 1.05);
    const yPix = (v) => padT + plotH * (1 - v / ymax);
    const slotW = plotW / n;
    const bw = Math.max(3, Math.min(24, slotW - 2));

    const svg = sv('svg', { width: W, height: H, viewBox: `0 0 ${W} ${H}` });
    // grid: hairline, solid, recessive
    for (const gv of [0, ymax / 2, ymax]) {
      svg.append(sv('line', { x1: padL, x2: W - padR, y1: yPix(gv), y2: yPix(gv), class: 'chart-grid' }));
      svg.append(sv('text', { x: padL - 6, y: yPix(gv) + 3.5, 'text-anchor': 'end', class: 'chart-axis' }, yFmt(gv)));
    }
    const bars = [];
    data.forEach((d, i) => {
      const x = padL + slotW * i + (slotW - bw) / 2;
      if (d.value > 0) {
        const y = yPix(d.value);
        const hgt = plotH + padT - y;
        const rr = Math.min(4, bw / 2, hgt);
        // 4px rounded data-end, square at the baseline
        const path = `M ${x} ${padT + plotH} L ${x} ${y + rr} Q ${x} ${y} ${x + rr} ${y} L ${x + bw - rr} ${y} Q ${x + bw} ${y} ${x + bw} ${y + rr} L ${x + bw} ${padT + plotH} Z`;
        const bar = sv('path', { d: path, fill: color });
        svg.append(bar);
        bars[i] = bar;
      }
      if (d.xTick) {
        svg.append(sv('text', { x: padL + slotW * i + slotW / 2, y: H - 5, 'text-anchor': 'middle', class: 'chart-axis' }, d.xTick));
      }
    });
    // target: dashed = threshold semantics
    if (target) {
      svg.append(sv('line', { x1: padL, x2: W - padR, y1: yPix(target), y2: yPix(target), class: 'chart-target' }));
      svg.append(sv('text', { x: W - padR, y: yPix(target) - 5, 'text-anchor': 'end', class: 'chart-axis' }, targetLabel || `goal ${yFmt(target)}`));
    }
    host.append(svg);

    const tip = makeTip(host);
    // full-height hit targets (wider than the mark)
    data.forEach((d, i) => {
      const hit = sv('rect', {
        x: padL + slotW * i, y: 0, width: slotW, height: H, fill: 'transparent',
      });
      const show = () => {
        bars.forEach((b, j) => b && b.setAttribute('opacity', j === i ? '1' : '0.45'));
        tip.show(padL + slotW * i + slotW / 2, yPix(d.value || 0), (t) => {
          t.append(tipDate(d.label || fmtShort(d.date)));
          t.append(tipRow(color, yFmt(d.value), xLabel));
          if (target) {
            const diff = d.value - target;
            t.append(tipRow(null, `${diff >= 0 ? '+' : ''}${yFmt(Math.abs(diff) * Math.sign(diff))}`, 'vs goal'));
          }
        });
      };
      const hide = () => { bars.forEach((b) => b && b.setAttribute('opacity', '1')); tip.hide(); };
      hit.addEventListener('pointerenter', show);
      hit.addEventListener('pointerdown', show);
      hit.addEventListener('pointerleave', hide);
      svg.append(hit);
    });
    svg.addEventListener('pointerleave', () => { bars.forEach((b) => b && b.setAttribute('opacity', '1')); tip.hide(); });
  });
}

// ── Line chart (dots + trend line + crosshair) ───────────────
export function lineChart(host, { dots = [], line = [], dotColor, lineColor, yFmt = (v) => v, height = 210, unit = '' }) {
  host.classList.add('chart-wrap');
  return responsive(host, (W) => {
    const H = height;
    const padL = 42, padR = 14, padT = 12, padB = 20;
    const plotW = W - padL - padR, plotH = H - padT - padB;
    const all = [...dots, ...line];
    if (!all.length) return;
    const xs = all.map((p) => new Date(p.x + 'T12:00:00').getTime());
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    const ys = all.map((p) => p.y);
    let lo = Math.min(...ys), hi = Math.max(...ys);
    const span = Math.max(hi - lo, 1);
    lo -= span * 0.25; hi += span * 0.25;
    const xPix = (dstr) => {
      const t = new Date(dstr + 'T12:00:00').getTime();
      return maxX === minX ? padL + plotW / 2 : padL + ((t - minX) / (maxX - minX)) * plotW;
    };
    const yPix = (v) => padT + plotH * (1 - (v - lo) / (hi - lo));

    const svg = sv('svg', { width: W, height: H, viewBox: `0 0 ${W} ${H}` });
    const gridVals = [lo + (hi - lo) * 0.12, (lo + hi) / 2, hi - (hi - lo) * 0.12];
    for (const gv of gridVals) {
      svg.append(sv('line', { x1: padL, x2: W - padR, y1: yPix(gv), y2: yPix(gv), class: 'chart-grid' }));
      svg.append(sv('text', { x: padL - 6, y: yPix(gv) + 3.5, 'text-anchor': 'end', class: 'chart-axis' }, yFmt(gv)));
    }
    // x ticks: first / middle / last
    const tickIdx = [...new Set([0, Math.floor((dots.length - 1) / 2), dots.length - 1])].filter((i) => i >= 0 && dots[i]);
    for (const i of tickIdx) {
      svg.append(sv('text', { x: xPix(dots[i].x), y: H - 4, 'text-anchor': 'middle', class: 'chart-axis' }, fmtShort(dots[i].x)));
    }
    // trend line: 2px, round joins
    if (line.length > 1) {
      const dAttr = line.map((p, i) => `${i ? 'L' : 'M'} ${xPix(p.x).toFixed(1)} ${yPix(p.y).toFixed(1)}`).join(' ');
      svg.append(sv('path', { d: dAttr, fill: 'none', stroke: lineColor, 'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));
    }
    // raw dots: ≥8px marker with 2px surface ring
    const surface = cssVar('--surface');
    for (const p of dots) {
      svg.append(sv('circle', { cx: xPix(p.x), cy: yPix(p.y), r: 4, fill: dotColor, stroke: surface, 'stroke-width': 2 }));
    }
    // end label (text token, never series color)
    const last = line.length ? line[line.length - 1] : dots[dots.length - 1];
    if (last) {
      svg.append(sv('text', {
        x: Math.min(xPix(last.x) + 6, W - 2), y: yPix(last.y) - 8,
        'text-anchor': 'end', 'font-size': 11.5, 'font-weight': 750, fill: cssVar('--text'),
      }, `${yFmt(last.y)}${unit}`));
    }

    // crosshair + tooltip: aim at a date, not a 2px line
    const vline = sv('line', { y1: padT, y2: padT + plotH, class: 'chart-grid', opacity: 0 });
    svg.append(vline);
    const tip = makeTip(host);
    const hover = (clientX) => {
      const rect = svg.getBoundingClientRect();
      const px = clientX - rect.left;
      let best = null, bd = Infinity;
      for (const p of dots) {
        const d = Math.abs(xPix(p.x) - px);
        if (d < bd) { bd = d; best = p; }
      }
      if (!best) return;
      const bx = xPix(best.x);
      vline.setAttribute('x1', bx); vline.setAttribute('x2', bx);
      vline.setAttribute('opacity', 1);
      const maAt = line.filter((p) => p.x <= best.x).pop();
      tip.show(bx, yPix(best.y), (t) => {
        t.append(tipDate(fmtShort(best.x)));
        t.append(tipRow(dotColor, `${yFmt(best.y)}${unit}`, 'logged'));
        if (maAt) t.append(tipRow(lineColor, `${yFmt(maAt.y)}${unit}`, 'trend'));
      });
    };
    svg.addEventListener('pointermove', (e) => hover(e.clientX));
    svg.addEventListener('pointerdown', (e) => hover(e.clientX));
    svg.addEventListener('pointerleave', () => { vline.setAttribute('opacity', 0); tip.hide(); });
    host.append(svg);
  });
}

// ── Year heatmap (workouts) ──────────────────────────────────
export function heatmap(host, { days }) {
  // days: ascending [{date, count}] — rendered as week columns, Sunday-first
  const wrap = h('div', { class: 'chart-wrap' });
  const scroll = h('div', { class: 'hm-scroll' });
  const grid = h('div', { class: 'hm-grid' });
  scroll.append(grid);
  wrap.append(scroll);
  const tip = makeTip(wrap);

  const level = (c) => (c <= 0 ? 0 : c === 1 ? 2 : c === 2 ? 3 : 4);
  const byDow = new Date(days[0].date + 'T12:00:00').getDay();
  const cells = [...Array(byDow).fill(null), ...days];
  let lastMonth = -1;

  for (let wk = 0; wk < Math.ceil(cells.length / 7); wk++) {
    const col = cells.slice(wk * 7, wk * 7 + 7);
    const firstReal = col.find(Boolean);
    let monthLabel = '';
    if (firstReal) {
      const d = new Date(firstReal.date + 'T12:00:00');
      if (d.getMonth() !== lastMonth && d.getDate() <= 10) {
        monthLabel = d.toLocaleString('en-US', { month: 'short' });
        lastMonth = d.getMonth();
      }
    }
    grid.append(h('div', { class: 'hm-month' }, monthLabel));
    for (let i = 0; i < 7; i++) {
      const day = col[i];
      if (!day) { grid.append(h('div', {})); continue; }
      const lv = level(day.count);
      const cell = h('div', { class: `hm-cell${lv ? ` l${lv}` : ''}` });
      cell.addEventListener('pointerdown', (e) => {
        const r = wrap.getBoundingClientRect();
        tip.show(e.clientX - r.left, e.clientY - r.top - 6, (t) => {
          t.append(tipDate(fmtShort(day.date)));
          t.append(tipRow(cssVar('--hm-3'), String(day.count), day.count === 1 ? 'workout' : 'workouts'));
        });
        setTimeout(() => tip.hide(), 1800);
      });
      grid.append(cell);
    }
  }
  wrap.append(h('div', { class: 'hm-legend' },
    'Less', h('div', { class: 'hm-cell' }), h('div', { class: 'hm-cell l2' }),
    h('div', { class: 'hm-cell l3' }), h('div', { class: 'hm-cell l4' }), 'More'));
  host.append(wrap);
  requestAnimationFrame(() => { scroll.scrollLeft = scroll.scrollWidth; });
  return host;
}

// ── Donut (macro split, ≤4 segments, 2px surface gaps) ───────
export function donut(host, { segments, centerValue, centerLabel, size = 168, stroke = 24 }) {
  const total = segments.reduce((a, s) => a + s.value, 0) || 1;
  const r = (size - stroke) / 2;
  const C = 2 * Math.PI * r;
  const gap = 2.5;
  const svg = sv('svg', { width: size, height: size, viewBox: `0 0 ${size} ${size}` });
  let acc = 0;
  const wrap = h('div', { class: 'chart-wrap', style: { width: `${size}px`, margin: '0 auto' } });
  const tip = makeTip(wrap);
  for (const s of segments) {
    const frac = s.value / total;
    const len = Math.max(0, frac * C - gap);
    if (len <= 0.5) { acc += frac * C; continue; }
    const startAngle = (acc / C) * 360 - 90 + (gap / 2 / C) * 360;
    const seg = sv('circle', {
      cx: size / 2, cy: size / 2, r, fill: 'none',
      stroke: s.color, 'stroke-width': stroke,
      'stroke-dasharray': `${len} ${C - len}`,
      transform: `rotate(${startAngle} ${size / 2} ${size / 2})`,
    });
    seg.addEventListener('pointerdown', () => {
      tip.show(size / 2, 10, (t) => {
        t.append(tipRow(s.color, `${Math.round(s.value)} g`, `${s.label} · ${Math.round(frac * 100)}%`));
      });
      setTimeout(() => tip.hide(), 1800);
    });
    svg.append(seg);
    acc += frac * C;
  }
  svg.append(
    sv('text', { x: size / 2, y: size / 2 - 2, 'text-anchor': 'middle', 'font-size': 24, 'font-weight': 800, fill: cssVar('--text') }, centerValue),
    sv('text', { x: size / 2, y: size / 2 + 17, 'text-anchor': 'middle', 'font-size': 11, 'font-weight': 600, fill: cssVar('--text-3') }, centerLabel)
  );
  wrap.append(svg);
  host.append(wrap);
  return host;
}

// ── Sparkline (stat tiles) ───────────────────────────────────
export function sparkline({ points, color, w = 78, h = 26 }) {
  if (points.length < 2) return sv('svg', { width: w, height: h });
  const lo = Math.min(...points), hi = Math.max(...points);
  const span = hi - lo || 1;
  const x = (i) => 2 + (i / (points.length - 1)) * (w - 6);
  const y = (v) => 2 + (1 - (v - lo) / span) * (h - 6);
  const d = points.map((p, i) => `${i ? 'L' : 'M'} ${x(i).toFixed(1)} ${y(p).toFixed(1)}`).join(' ');
  return sv('svg', { width: w, height: h, viewBox: `0 0 ${w} ${h}` },
    sv('path', { d, fill: 'none', stroke: cssVar('--c-muted'), 'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }),
    sv('circle', { cx: x(points.length - 1), cy: y(points[points.length - 1]), r: 3, fill: color })
  );
}
