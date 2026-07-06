// Body: a spinnable muscle map. Green = trained this week (Sun–Sat), red = not yet.
// Tap any muscle for status + recommended exercises (curated, or AI-personalized).
import { h, todayStr, fmtShort, vibrate, cssVar } from '../util.js';
import { api } from '../api.js';
import { ico, toast, sheet, spinner } from '../ui.js';
import { buildBodyStack, pictogram } from '../body-svg.js';
import { App } from '../main.js';

export async function renderBody(root) {
  const view = h('div', { class: 'view' });
  root.replaceChildren(view);
  view.append(h('p', { class: 'muted center', style: { padding: '40px 0' } }, 'Loading…'));

  let data;
  try { data = await api(`/muscles?today=${todayStr()}`); }
  catch (e) { view.replaceChildren(h('p', { class: 'muted' }, e.message)); return; }

  const muscles = data.muscles;
  const keys = Object.keys(muscles);
  const trained = keys.filter((k) => muscles[k].sets > 0);
  const statusFor = (k) => (muscles[k].sets > 0 ? 'on' : 'off');

  view.replaceChildren();
  view.append(h('div', { class: 'vhead' },
    h('div', {},
      h('h1', {}, 'Body'),
      h('div', { class: 'sub' }, `This week · ${fmtShort(data.week_start)} – ${fmtShort(data.week_end)}`)),
    h('div', { class: 'vhead-actions' },
      h('button', { class: 'btn btn--icon', onclick: () => App.go('#/train') }, ico('chevL')))));

  // Legend (status colors always ride with labels)
  view.append(h('div', { class: 'flex', style: { gap: '8px', flexWrap: 'wrap', marginBottom: '10px' } },
    h('span', { class: 'legend-pill legend-pill--on' }, ico('check', 13), 'Trained'),
    h('span', { class: 'legend-pill legend-pill--off' }, ico('clock', 13), 'Not yet'),
    data.cardio.sessions > 0
      ? h('span', { class: 'legend-pill legend-pill--cardio' }, ico('run', 13), `Cardio ×${data.cardio.sessions}${data.cardio.minutes ? ` · ${data.cardio.minutes} min` : ''}`)
      : null));

  // ── Spinnable 3D stage ─────────────────────────────────────
  const frontStack = buildBodyStack('front', statusFor);
  const backStack = buildBodyStack('back', statusFor);
  backStack.classList.add('body-stack--back');
  const card = h('div', { class: 'body-card' }, frontStack, backStack);
  const hint = h('div', { class: 'body-hint' }, '↔ Drag to spin · tap a muscle');
  const shadow = h('div', { class: 'body-shadow' });
  const stage = h('div', { class: 'body-stage' }, shadow, card, hint);
  view.append(h('div', { class: 'card card--stage', style: { padding: '10px 6px 6px' } }, stage));

  // rotation state: baseDeg (settled) + dragOff (live drag) + tween (snap/momentum) + idle sway
  let baseDeg = 0, dragOff = 0, dragging = false, tween = null, hinted = false;
  let startX = 0, moved = 0, downMuscle = null, lastX = 0, lastT = 0, vel = 0;

  const spinTo = (target, dur = 650) => { tween = { from: baseDeg, to: target, t0: performance.now(), dur }; };

  (function loop(now) {
    if (!stage.isConnected) return;
    if (tween) {
      const p = Math.min(1, (now - tween.t0) / tween.dur);
      baseDeg = tween.from + (tween.to - tween.from) * (1 - Math.pow(1 - p, 3));
      if (p >= 1) { baseDeg = tween.to; tween = null; }
    }
    const idle = !dragging && !tween;
    const sway = idle ? Math.sin(now / 950) * 5 : 0;
    const bob = Math.sin(now / 1350) * 3;
    card.style.transform = `translateY(${bob.toFixed(1)}px) rotateY(${(baseDeg + dragOff + sway).toFixed(2)}deg)`;
    const edge = Math.abs(Math.sin(((baseDeg + dragOff + sway) * Math.PI) / 180));
    shadow.style.transform = `translateX(-50%) scaleX(${(1 - edge * 0.45).toFixed(2)})`;
    requestAnimationFrame(loop);
  })(performance.now());

  stage.addEventListener('pointerdown', (e) => {
    dragging = true; moved = 0; vel = 0;
    startX = lastX = e.clientX; lastT = performance.now();
    if (tween) { baseDeg = tween.to; tween = null; }
    downMuscle = e.target.closest?.('[data-muscle]')?.dataset.muscle || null;
    stage.setPointerCapture?.(e.pointerId);
  });
  stage.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const nowT = performance.now();
    const dx = e.clientX - startX;
    moved = Math.max(moved, Math.abs(dx));
    if (moved > 4 && !hinted) { hinted = true; hint.classList.add('fade'); }
    if (nowT - lastT > 12) { vel = (e.clientX - lastX) / (nowT - lastT); lastX = e.clientX; lastT = nowT; }
    dragOff = dx * 0.55;
  });
  const release = () => {
    if (!dragging) return;
    dragging = false;
    if (moved < 8 && downMuscle) {
      dragOff = 0;
      vibrate(8);
      openMuscleSheet(muscles[downMuscle], data);
    } else {
      baseDeg += dragOff;
      dragOff = 0;
      // momentum: a real flick carries the spin onward in its direction
      const flick = Math.abs(vel) > 0.45 ? Math.sign(vel) * 180 : 0;
      spinTo(Math.round((baseDeg + flick * 0.75) / 180) * 180, flick ? 750 : 550);
    }
    downMuscle = null;
  };
  stage.addEventListener('pointerup', release);
  stage.addEventListener('pointercancel', release);

  // spin button for discoverability
  view.append(h('div', { class: 'flex', style: { justifyContent: 'center', marginBottom: '4px' } },
    h('button', { class: 'btn btn--ghost btn--sm', onclick: () => {
      hinted = true; hint.classList.add('fade');
      spinTo(Math.round(baseDeg / 180) * 180 + 180, 750);
    } }, ico('repeat', 15), 'Spin around')));

  // ── Summary + chips (the readable twin of the picture) ─────
  view.append(h('p', { class: 'center small', style: { margin: '8px 0 12px', color: 'var(--text-2)', fontWeight: 650 } },
    trained.length === 0
      ? 'Nothing trained yet this week — pick a red muscle to see where to start.'
      : trained.length === keys.length
        ? 'Full sweep — every muscle group trained this week 👑'
        : `${trained.length} of ${keys.length} muscle groups trained this week`));

  const grid = h('div', { class: 'mgrid' });
  for (const k of keys) {
    const m = muscles[k];
    const on = m.sets > 0;
    grid.append(h('button', { class: `mchip${on ? ' on' : ''}`, onclick: () => openMuscleSheet(m, data) },
      h('span', { class: 'mchip-dot' }),
      h('span', { class: 'grow', style: { textAlign: 'left' } }, m.label),
      h('span', { class: 'mchip-sets' }, on ? `${m.sets} set${m.sets > 1 ? 's' : ''}` : '—')));
  }
  view.append(grid);
}

// ── Per-muscle detail + recommendations ──────────────────────
function openMuscleSheet(m, weekData) {
  sheet({
    title: m.label,
    build: async (body) => {
      const on = m.sets > 0;
      body.append(h('div', { class: `card ${on ? '' : ''}`, style: {
        background: on ? 'var(--accent-soft)' : 'var(--danger-soft)', border: 'none',
        display: 'flex', gap: '12px', alignItems: 'center', padding: '13px 15px',
      } },
        h('span', { style: { color: on ? 'var(--accent)' : 'var(--danger)', display: 'flex' } }, ico(on ? 'check' : 'clock', 22)),
        h('div', { class: 'grow' },
          h('div', { style: { fontWeight: 750, fontSize: '14.5px' } }, on ? 'Trained this week' : 'Not trained yet this week'),
          h('div', { class: 'small', style: { color: 'var(--text-2)' } },
            on ? `${m.sets} sets · ${[...new Set(m.exercises)].slice(0, 3).join(', ')}` : `Week ends ${fmtShort(weekData.week_end)} — there’s time.`))));

      const recsWrap = h('div', {});
      const aiRow = h('div', {});
      body.append(h('div', { class: 'section-label', style: { marginTop: '16px' } }, 'Recommended exercises'), recsWrap, aiRow);

      const renderRecs = (recs, aiSource) => {
        recsWrap.replaceChildren();
        if (aiSource && recs.note) {
          recsWrap.append(h('p', { class: 'small', style: { color: 'var(--text-2)', margin: '0 0 10px', lineHeight: 1.5 } },
            h('span', { class: 'ai-badge', style: { marginRight: '7px' } }, ico('sparkles', 11), 'Coach'), recs.note));
        }
        for (const r of recs.exercises) {
          recsWrap.append(h('div', { class: 'rec-card' },
            h('div', { class: 'rec-picto' }, pictogram(r.name, 40)),
            h('div', { class: 'grow' },
              h('div', { class: 'flex', style: { gap: '8px' } },
                h('span', { style: { fontWeight: 750, fontSize: '14.5px' } }, r.name),
                h('span', { class: 'rec-scheme' }, r.scheme)),
              h('div', { class: 'small', style: { color: 'var(--text-2)', lineHeight: 1.45, marginTop: '2px' } }, r.why))));
        }
      };

      // curated immediately…
      try {
        const curated = await api(`/recs/${m.key}`);
        renderRecs(curated, false);
      } catch { recsWrap.append(h('p', { class: 'muted small' }, 'No recommendations for this group yet.')); }

      // …AI personalization on demand
      if (App.boot.settings.ai.hasKey) {
        const aiBtn = h('button', { class: 'btn btn--soft btn--block mt-8', onclick: async () => {
          aiBtn.disabled = true;
          aiBtn.replaceChildren(spinner(), ' Coach is thinking…');
          try {
            const recs = await api('/ai/muscle-recs', { method: 'POST', body: { muscle: m.key, today: todayStr() } });
            renderRecs(recs, true);
            aiBtn.remove();
          } catch (e) {
            toast(e.message, 'bad', 3500);
            aiBtn.disabled = false;
            aiBtn.replaceChildren('Personalize with AI ✨');
          }
        } }, 'Personalize with AI ✨');
        aiRow.append(aiBtn);
      }
    },
  });
}
