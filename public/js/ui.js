// UI kit: icons, toasts, sheets, confirm, confetti.
import { h, vibrate, cssVar } from './util.js';

// ── Icons (24px, stroke=currentColor) ────────────────────────
const P = (paths, extra = '') =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}${extra}</svg>`;

export const icons = {
  flame: P('<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/>'),
  utensils: P('<path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2"/><path d="M7 2v20"/><path d="M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3zm0 0v7"/>'),
  barbell: P('<path d="M2 12h2.5"/><path d="M19.5 12H22"/><path d="M6 8.5v7"/><path d="M9.5 6v12"/><path d="M14.5 6v12"/><path d="M18 8.5v7"/><path d="M9.5 12h5"/>'),
  chart: P('<path d="M18 20V10"/><path d="M12 20V4"/><path d="M6 20v-6"/>'),
  sparkles: P('<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3z"/><path d="M19 15l.7 1.8L21.5 17.5l-1.8.7L19 20l-.7-1.8-1.8-.7 1.8-.7L19 15z"/>'),
  chat: P('<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>'),
  plus: P('<path d="M12 5v14"/><path d="M5 12h14"/>'),
  x: P('<path d="M18 6L6 18"/><path d="M6 6l12 12"/>'),
  check: P('<path d="M20 6L9 17l-5-5"/>'),
  chevL: P('<path d="M15 18l-6-6 6-6"/>'),
  chevR: P('<path d="M9 18l6-6-6-6"/>'),
  chevD: P('<path d="M6 9l6 6 6-6"/>'),
  search: P('<circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/>'),
  trash: P('<path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/>'),
  edit: P('<path d="M17 3a2.828 2.828 0 1 1 4 4L7 21H3v-4L17 3z"/>'),
  clock: P('<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>'),
  timer: P('<path d="M10 2h4"/><path d="M12 14l3-3"/><circle cx="12" cy="14" r="8"/>'),
  send: P('<path d="M22 2L11 13"/><path d="M22 2l-7 20-4-9-9-4 20-7z"/>'),
  settings: P('<path d="M4 21v-7"/><path d="M4 10V3"/><path d="M12 21v-9"/><path d="M12 8V3"/><path d="M20 21v-5"/><path d="M20 12V3"/><path d="M1 14h6"/><path d="M9 8h6"/><path d="M17 16h6"/>'),
  droplet: P('<path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z"/>'),
  camera: P('<path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/>'),
  video: P('<path d="M23 7l-7 5 7 5V7z"/><rect x="1" y="5" width="15" height="14" rx="2"/>'),
  trophy: P('<path d="M8 21h8"/><path d="M12 17v4"/><path d="M7 4h10v6a5 5 0 0 1-10 0V4z"/><path d="M7 4H4v2a3 3 0 0 0 3 3"/><path d="M17 4h3v2a3 3 0 0 1-3 3"/>'),
  gauge: P('<circle cx="12" cy="12" r="9"/><path d="M12 12l3.5-3.5"/>'),
  zap: P('<path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/>'),
  sun: P('<circle cx="12" cy="12" r="5"/><path d="M12 1v2"/><path d="M12 21v2"/><path d="M4.22 4.22l1.42 1.42"/><path d="M18.36 18.36l1.42 1.42"/><path d="M1 12h2"/><path d="M21 12h2"/><path d="M4.22 19.78l1.42-1.42"/><path d="M18.36 5.64l1.42-1.42"/>'),
  moon: P('<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>'),
  download: P('<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M7 10l5 5 5-5"/><path d="M12 15V3"/>'),
  key: P('<path d="M21 2l-2 2"/><path d="M13.39 11.61a5.5 5.5 0 1 1-7.78 7.78 5.5 5.5 0 0 1 7.78-7.78zm0 0L15.5 9.5m0 0l3 3L22 8.5 19.5 6m-4 3.5L19 5"/>'),
  undo: P('<path d="M1 4v6h6"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/>'),
  play: P('<path d="M5 3l14 9-14 9V3z"/>'),
  info: P('<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>'),
  alert: P('<path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><path d="M12 9v4"/><path d="M12 17h.01"/>'),
  calendar: P('<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4"/><path d="M8 2v4"/><path d="M3 10h18"/>'),
  repeat: P('<path d="M17 1l4 4-4 4"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><path d="M7 23l-4-4 4-4"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/>'),
  history: P('<path d="M3 3v5h5"/><path d="M3.05 13A9 9 0 1 0 6 5.3L3 8"/><path d="M12 7v5l4 2"/>'),
  trend: P('<path d="M23 6l-9.5 9.5-5-5L1 18"/><path d="M17 6h6v6"/>'),
  scale: P('<circle cx="12" cy="12" r="9"/><path d="M12 12l2.6-4"/><path d="M8 21h8"/>'),
  run: P('<circle cx="13" cy="4.5" r="2"/><path d="M6 21l3-6 2-3.5"/><path d="M17.5 21l-2.5-6-3-2 1-5"/><path d="M13 7.5l-4 2-1.5 3.5"/><path d="M13 7.5l3 2.5 3.5.5"/>'),
};

export const ico = (name, size) => {
  const t = document.createElement('span');
  t.innerHTML = icons[name] || icons.info;
  const svg = t.firstChild;
  if (size) { svg.setAttribute('width', size); svg.setAttribute('height', size); }
  return svg;
};

// ── Toast ────────────────────────────────────────────────────
let toastEl = null;
export function toast(msg, kind = 'info', ms = 2400) {
  toastEl?.remove();
  toastEl = h('div', { class: `toast ${kind === 'good' ? 'toast--good' : kind === 'bad' ? 'toast--bad' : ''}` }, msg);
  document.body.append(toastEl);
  const el = toastEl;
  setTimeout(() => { el.classList.add('hide'); setTimeout(() => el.remove(), 260); }, ms);
}

// ── Bottom sheet ─────────────────────────────────────────────
export function sheet({ title, build, onClose }) {
  const backdrop = h('div', { class: 'backdrop' });
  const body = h('div', { class: 'sheet-body' });
  const closeBtn = h('button', { class: 'btn btn--icon', onclick: () => close() }, ico('x'));
  const el = h('div', { class: 'sheet' },
    h('div', { class: 'sheet-grab' }),
    h('div', { class: 'sheet-head' }, h('h2', {}, title), closeBtn),
    body
  );
  let closed = false;
  function close(result) {
    if (closed) return;
    closed = true;
    el.classList.add('closing');
    backdrop.classList.add('closing');
    setTimeout(() => { el.remove(); backdrop.remove(); }, 220);
    onClose?.(result);
  }
  backdrop.addEventListener('click', () => close());
  document.body.append(backdrop, el);
  build(body, { close, el });
  return { close, body };
}

export function confirmSheet({ title = 'Are you sure?', message, confirmLabel = 'Confirm', danger = false }) {
  return new Promise((resolve) => {
    let choice = false;
    sheet({
      title,
      onClose: () => resolve(choice),
      build: (body, { close }) => {
        if (message) body.append(h('p', { class: 'muted', style: { marginBottom: '18px', fontSize: '14px' } }, message));
        body.append(
          h('button', {
            class: `btn btn--block ${danger ? 'btn--danger' : 'btn--primary'}`,
            onclick: () => { choice = true; close(); },
          }, confirmLabel),
          h('button', { class: 'btn btn--ghost btn--block mt-8', onclick: () => close() }, 'Cancel')
        );
      },
    });
  });
}

// ── Confetti (PR celebrations) ───────────────────────────────
export function confetti() {
  vibrate([20, 60, 30]);
  const canvas = h('canvas', { class: 'confetti-canvas' });
  document.body.append(canvas);
  const ctx = canvas.getContext('2d');
  const dpr = Math.min(devicePixelRatio || 1, 2);
  canvas.width = innerWidth * dpr;
  canvas.height = innerHeight * dpr;
  ctx.scale(dpr, dpr);
  const colors = [cssVar('--accent'), cssVar('--c-protein'), cssVar('--c-water'), '#F3F5F7', cssVar('--c-sugar')];
  const parts = Array.from({ length: 110 }, () => ({
    x: innerWidth / 2 + (Math.random() - 0.5) * 120,
    y: innerHeight * 0.42,
    vx: (Math.random() - 0.5) * 11,
    vy: -Math.random() * 13 - 5,
    w: 5 + Math.random() * 5,
    r: Math.random() * Math.PI,
    vr: (Math.random() - 0.5) * 0.3,
    c: colors[(Math.random() * colors.length) | 0],
  }));
  const t0 = performance.now();
  (function frame(t) {
    const dt = (t - t0) / 1000;
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    for (const p of parts) {
      p.x += p.vx; p.y += p.vy; p.vy += 0.42; p.r += p.vr;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.r);
      ctx.fillStyle = p.c;
      ctx.globalAlpha = Math.max(0, 1 - dt / 1.6);
      ctx.fillRect(-p.w / 2, -p.w / 2, p.w, p.w * 0.6);
      ctx.restore();
    }
    if (dt < 1.7) requestAnimationFrame(frame);
    else canvas.remove();
  })(t0);
}

// ── Small builders ───────────────────────────────────────────
export function segmented(options, value, onChange) {
  const el = h('div', { class: 'seg' });
  const render = (val) => {
    el.replaceChildren(...options.map((o) =>
      h('button', {
        class: o.value === val ? 'on' : '',
        onclick: () => { vibrate(6); render(o.value); onChange(o.value); },
      }, o.label)
    ));
  };
  render(value);
  return el;
}

export function stepperInput({ value = 0, step = 1, min = 0, max = 9999, suffix = '', onInput, decimals = 0 }) {
  const input = h('input', { type: 'number', inputmode: 'decimal', value: String(value) });
  const set = (v) => {
    const nv = Math.min(max, Math.max(min, v));
    input.value = decimals ? nv.toFixed(decimals).replace(/\.0+$/, '') : String(Math.round(nv * 100) / 100);
    onInput?.(+input.value);
  };
  input.addEventListener('input', () => onInput?.(+input.value || 0));
  const el = h('div', { class: 'stepper' },
    h('button', { type: 'button', onclick: () => { vibrate(6); set((+input.value || 0) - step); } }, '−'),
    input,
    h('button', { type: 'button', onclick: () => { vibrate(6); set((+input.value || 0) + step); } }, '+')
  );
  el.getValue = () => +input.value || 0;
  el.setValue = set;
  el.input = input;
  return el;
}

export function spinner(size = 18) {
  const s = ico('undo', size);
  s.classList.add('spin');
  return s;
}

export function emptyState({ icon = 'info', title, sub }) {
  return h('div', { class: 'empty' }, ico(icon), h('div', { class: 'e-t' }, title), sub ? h('div', { class: 'e-s' }, sub) : null);
}
