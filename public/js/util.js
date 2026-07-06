// Shared helpers: DOM, dates, units, formatting.

export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k in el && k !== 'list' && typeof v !== 'string') el[k] = v;
    else el.setAttribute(k, v);
  }
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return el;
}

export const svgEl = (html) => {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstChild;
};

export const cssVar = (name) =>
  getComputedStyle(document.documentElement).getPropertyValue(name).trim();

export const vibrate = (pattern = 10) => { try { navigator.vibrate?.(pattern); } catch {} };

// ── Dates (always the phone's local day) ────────────────────
export function todayStr(offsetDays = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return localDateStr(d);
}
export function localDateStr(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
export function shiftDateStr(dateStr, days) {
  const d = new Date(dateStr + 'T12:00:00');
  d.setDate(d.getDate() + days);
  return localDateStr(d);
}
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function fmtDay(dateStr, { withYear = false } = {}) {
  if (dateStr === todayStr()) return 'Today';
  if (dateStr === todayStr(-1)) return 'Yesterday';
  if (dateStr === todayStr(1)) return 'Tomorrow';
  const d = new Date(dateStr + 'T12:00:00');
  return `${DOW[d.getDay()]}, ${MON[d.getMonth()]} ${d.getDate()}${withYear ? ' ' + d.getFullYear() : ''}`;
}
export function fmtShort(dateStr) {
  const d = new Date(dateStr + 'T12:00:00');
  return `${MON[d.getMonth()]} ${d.getDate()}`;
}
export const monthName = (i) => MON[i];
export const dowLetter = (i) => DOW[i][0];

export function fmtClock(totalSec) {
  const m = Math.floor(totalSec / 60);
  const s = Math.floor(totalSec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}
export function fmtElapsed(totalSec) {
  const hh = Math.floor(totalSec / 3600);
  const mm = Math.floor((totalSec % 3600) / 60);
  const ss = Math.floor(totalSec % 60);
  return hh ? `${hh}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}` : `${mm}:${String(ss).padStart(2, '0')}`;
}

// ── Units ────────────────────────────────────────────────────
export const KG_LB = 2.2046226218;
export const ML_OZ = 29.5735;

export const units = {
  weight: 'lb',   // 'lb' | 'kg'  (body weight & lifting)
  height: 'cm',   // 'cm' | 'ftin'
  water: 'oz',    // 'oz' | 'ml'
};

export function setUnits(settings) {
  units.weight = settings.weight_unit || 'lb';
  units.height = settings.height_unit || 'cm';
  units.water = settings.water_unit || 'oz';
}

export const kg2lb = (kg) => kg * KG_LB;
export const lb2kg = (lb) => lb / KG_LB;

export function wDisp(kg, digits = 1) {
  if (kg == null) return '—';
  const v = units.weight === 'kg' ? kg : kg2lb(kg);
  return +v.toFixed(digits);
}
export const wUnit = () => units.weight;
export const wParse = (val) => (units.weight === 'kg' ? +val : lb2kg(+val));

export function waterDisp(ml) {
  return units.water === 'ml' ? Math.round(ml) : Math.round(ml / ML_OZ);
}
export const waterUnit = () => (units.water === 'ml' ? 'ml' : 'oz');
export const waterSteps = () => (units.water === 'ml' ? [{ label: '+250 ml', ml: 250 }, { label: '+500 ml', ml: 500 }] : [{ label: '+8 oz', ml: 237 }, { label: '+16 oz', ml: 473 }]);

export function heightDisp(cm) {
  if (units.height === 'cm') return `${Math.round(cm)} cm`;
  const totalIn = cm / 2.54;
  const ft = Math.floor(totalIn / 12);
  const inch = Math.round(totalIn % 12);
  return inch === 12 ? `${ft + 1}′0″` : `${ft}′${inch}″`;
}

export const round1 = (v) => Math.round(v * 10) / 10;
export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const fmtInt = (v) => Math.round(v).toLocaleString('en-US');

export function movingAverage(points, windowSize = 7) {
  // points: [{x: dateStr, y}] sorted ascending — trailing average
  const out = [];
  for (let i = 0; i < points.length; i++) {
    const from = Math.max(0, i - windowSize + 1);
    const slice = points.slice(from, i + 1);
    out.push({ x: points[i].x, y: slice.reduce((a, p) => a + p.y, 0) / slice.length });
  }
  return out;
}

export function countUp(el, to, { dur = 700, fmt = fmtInt } = {}) {
  const start = performance.now();
  const from = 0;
  const tick = (t) => {
    const p = clamp((t - start) / dur, 0, 1);
    const eased = 1 - Math.pow(1 - p, 3);
    el.textContent = fmt(from + (to - from) * eased);
    if (p < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

export const debounce = (fn, ms) => {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
};
