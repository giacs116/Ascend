// Today: rings, macros, water, quick actions, meals, workout, weight.
import { h, todayStr, fmtDay, fmtInt, cssVar, wDisp, wUnit, wParse, waterDisp, waterUnit, waterSteps, vibrate, round1 } from '../util.js';
import { api } from '../api.js';
import { ico, toast, sheet, stepperInput } from '../ui.js';
import { ringMeter, sparkline } from '../charts.js';
import { App } from '../main.js';
import { openAddFood } from './food.js';
import { startWorkout } from './train.js';

export async function renderToday(root) {
  const date = todayStr();
  root.append(h('div', { class: 'view' }, h('p', { class: 'muted center', style: { padding: '40px 0' } }, 'Loading…')));

  let day, weights;
  try {
    [day, weights] = await Promise.all([
      api(`/day/${date}`),
      api('/weight?limit=14'),
    ]);
  } catch (e) {
    root.replaceChildren(h('div', { class: 'view' }, h('p', { class: 'muted' }, e.message)));
    return;
  }
  const t = day.targets || {};
  const s = day.summary;
  const boot = App.boot;
  const name = (boot.profile?.name || '').split(' ')[0];
  const hour = new Date().getHours();
  const greet = hour < 5 ? 'Night owl' : hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

  const view = h('div', { class: 'view' });
  root.replaceChildren(view);

  // ── Header ─────────────────────────────────────────────────
  view.append(h('div', { class: 'vhead' },
    h('div', {},
      h('h1', {}, `${greet}, ${name}`),
      h('div', { class: 'sub' }, fmtDay(date) === 'Today' ? new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }) : fmtDay(date))),
    h('div', { class: 'vhead-actions' },
      h('button', { class: 'btn btn--icon', onclick: () => App.go('#/settings') }, ico('settings')))
  ));

  if (boot.streak > 0 || boot.workoutsThisWeek > 0) {
    view.append(h('div', { class: 'flex', style: { marginBottom: '14px', gap: '8px', flexWrap: 'wrap' } },
      boot.streak > 0 ? h('span', { class: 'streak-pill streak-pill--orange' }, ico('flame', 15), `${boot.streak}-day streak`) : null,
      boot.workoutsThisWeek > 0 ? h('span', { class: 'streak-pill' }, ico('barbell', 15), `${boot.workoutsThisWeek} workout${boot.workoutsThisWeek > 1 ? 's' : ''} this week`) : null,
    ));
  }

  // ── Rings ──────────────────────────────────────────────────
  const calPct = t.calories ? s.calories / t.calories : 0;
  const rings = h('div', { class: 'card card--rings rings-card' },
    ringMeter({ pct: calPct, color: cssVar('--c-accent'), value: fmtInt(s.calories), sub: `/ ${fmtInt(t.calories || 0)} kcal`, label: 'Calories' }),
    ringMeter({ pct: t.protein_g ? s.protein_g / t.protein_g : 0, color: cssVar('--c-protein'), value: `${Math.round(s.protein_g)}g`, sub: `/ ${t.protein_g || 0} g`, label: 'Protein' }),
    ringMeter({ pct: t.water_ml ? s.water_ml / t.water_ml : 0, color: cssVar('--c-water'), value: String(waterDisp(s.water_ml)), sub: `/ ${waterDisp(t.water_ml || 0)} ${waterUnit()}`, label: 'Water' }),
  );
  view.append(rings);

  const over = t.calories && s.calories > t.calories;
  const remaining = Math.max(0, (t.calories || 0) - s.calories);
  view.append(h('p', { class: 'center small', style: { margin: '-4px 0 14px', color: over ? 'var(--c-fat)' : 'var(--text-3)', fontWeight: 600 } },
    over ? `${fmtInt(s.calories - t.calories)} kcal over target` : `${fmtInt(remaining)} kcal left today`));

  // ── Macro meters ───────────────────────────────────────────
  const meter = (name_, val, max, color, unit = 'g') => {
    const pct = max ? Math.min(1, val / max) : 0;
    const overCap = max && val > max;
    return h('div', { class: 'macro-meter' },
      h('div', { class: 'mm-top' },
        h('div', { class: 'mm-name' }, h('span', { class: 'dot', style: { background: color } }), name_),
        h('div', { class: 'mm-val', style: overCap ? { color: 'var(--c-fat)' } : {} }, `${Math.round(val)}`, h('span', {}, ` / ${Math.round(max)} ${unit}`))),
      h('div', { class: 'mm-track', style: { background: `color-mix(in srgb, ${color} 14%, transparent)` } },
        h('div', { class: 'mm-fill', style: { width: '0%', background: color } }))
    );
  };
  const macros = h('div', { class: 'card' },
    meter('Carbs', s.carbs_g, t.carbs_g || 0, cssVar('--c-carbs')),
    meter('Fat', s.fat_g, t.fat_g || 0, cssVar('--c-fat')),
    meter('Added sugar', s.sugar_g, t.sugar_g || 0, cssVar('--c-sugar')),
  );
  view.append(macros);
  requestAnimationFrame(() => requestAnimationFrame(() => {
    const fills = macros.querySelectorAll('.mm-fill');
    const vals = [[s.carbs_g, t.carbs_g], [s.fat_g, t.fat_g], [s.sugar_g, t.sugar_g]];
    fills.forEach((f, i) => { f.style.width = `${Math.min(100, (vals[i][1] ? (vals[i][0] / vals[i][1]) : 0) * 100)}%`; });
  }));

  // ── Quick actions ──────────────────────────────────────────
  view.append(h('div', { class: 'quick-actions', style: { marginBottom: '12px' } },
    h('button', { class: 'qa qa--amber', onclick: () => openAddFood({ date, onDone: () => renderTodayFresh(root) }) }, h('span', { class: 'qa-ico' }, ico('utensils')), 'Log food'),
    h('button', { class: 'qa qa--volt', onclick: () => startWorkout() }, h('span', { class: 'qa-ico' }, ico('barbell')), 'Workout'),
    h('button', { class: 'qa qa--teal', onclick: () => openWeighIn({ onDone: () => renderTodayFresh(root) }) }, h('span', { class: 'qa-ico' }, ico('scale')), 'Weigh in'),
    h('button', { class: 'qa qa--violet', onclick: () => App.go('#/coach') }, h('span', { class: 'qa-ico' }, ico('sparkles')), 'Ask Coach'),
  ));

  // ── Water card ─────────────────────────────────────────────
  const waterCard = h('div', { class: 'card water-card' });
  const renderWater = (summary) => {
    waterCard.replaceChildren(
      h('div', { class: 'water-viz row-ico tint-blue', style: { color: 'var(--c-water)', width: '46px', height: '46px', borderRadius: '14px' } }, ico('droplet', 24)),
      h('div', { class: 'water-main' },
        h('div', { class: 'wv' }, `${waterDisp(summary.water_ml)} `, h('span', { class: 'u' }, `/ ${waterDisp(t.water_ml || 0)} ${waterUnit()}`)),
        h('div', { class: 'water-btns' },
          ...waterSteps().map((st) => h('button', {
            class: 'btn btn--soft btn--sm',
            onclick: async () => {
              vibrate(8);
              const r = await api('/water', { method: 'POST', body: { date, ml: st.ml } });
              renderWater(r.summary);
              if (r.summary.water_ml >= (t.water_ml || Infinity) && summary.water_ml < t.water_ml) toast('Hydration goal hit 💧', 'good');
            },
          }, st.label)),
          h('button', { class: 'btn btn--icon', title: 'Undo', onclick: async () => {
            const r = await api(`/water/last?date=${date}`, { method: 'DELETE' });
            renderWater(r.summary);
          } }, ico('undo')),
        ))
    );
  };
  renderWater(s);
  view.append(waterCard);

  // ── Coach nudge ────────────────────────────────────────────
  const proteinLeft = Math.max(0, (t.protein_g || 0) - s.protein_g);
  let nudge = null;
  if (s.entries === 0) nudge = 'Nothing logged yet today. Want ideas for a strong first meal?';
  else if (over) nudge = `You’re ${fmtInt(s.calories - t.calories)} kcal over — want a plan to balance the rest of the week?`;
  else if (proteinLeft > 25 && hour >= 14) nudge = `${Math.round(proteinLeft)} g of protein to go — want dinner ideas that get you there?`;
  else if (s.protein_g >= (t.protein_g || Infinity)) nudge = 'Protein target: crushed 💪 Ask me anything else.';
  if (nudge) {
    view.append(h('button', { class: 'card card--accent', style: { width: '100%', textAlign: 'left', display: 'flex', gap: '12px', alignItems: 'center' },
      onclick: () => App.go('#/coach') },
      h('div', { class: 'row-ico', style: { background: 'var(--accent-soft)', color: 'var(--accent)' } }, ico('sparkles')),
      h('div', { class: 'grow' },
        h('div', { style: { fontWeight: 700, fontSize: '14px' } }, 'Coach'),
        h('div', { class: 'hint', style: { fontSize: '13px' } }, nudge)),
      ico('chevR')
    ));
  }

  // ── Meals ──────────────────────────────────────────────────
  view.append(h('div', { class: 'section-label' }, 'Meals',
    h('a', { class: 'lnk', href: '#/food' }, 'See all')));
  const MEALS = [
    ['breakfast', '🌅', 'Breakfast', 'amber'],
    ['lunch', '🥪', 'Lunch', 'teal'],
    ['dinner', '🍽', 'Dinner', 'violet'],
    ['snacks', '🍿', 'Snacks', 'pink'],
  ];
  const mealsCard = h('div', { class: 'card card--flush' });
  for (const [key, em, label, tint] of MEALS) {
    const items = day.entries.filter((e) => e.meal === key);
    const cal = items.reduce((a, e) => a + e.calories, 0);
    mealsCard.append(h('button', { class: 'row', onclick: () => openAddFood({ date, meal: key, onDone: () => renderTodayFresh(root) }) },
      h('span', { class: `mh-em tint-${tint}` }, em),
      h('div', { class: 'grow' },
        h('div', { class: 't' }, label),
        h('div', { class: 's' }, items.length ? items.map((i) => i.name).join(', ') : 'Nothing yet')),
      items.length ? h('div', { class: 'v' }, fmtInt(cal), h('span', { class: 'u' }, 'kcal')) : h('span', { style: { color: 'var(--text-3)' } }, ico('plus', 18))
    ));
  }
  view.append(mealsCard);

  // ── Training + weight tiles ────────────────────────────────
  view.append(h('div', { class: 'section-label' }, 'Body & training'));
  const wt = weights.weights;
  const lastW = wt[wt.length - 1];
  const prevW = wt.length > 1 ? wt[wt.length - 2] : null;
  const deltaKg = prevW ? lastW.weight_kg - prevW.weight_kg : 0;
  const goal = boot.profile?.goal;
  const deltaGood = goal === 'gain' ? deltaKg > 0 : goal === 'lose' ? deltaKg < 0 : Math.abs(deltaKg) < 0.2;

  view.append(h('div', { class: 'tiles' },
    h('button', { class: 'tile', style: { textAlign: 'left' }, onclick: () => openWeighIn({ onDone: () => renderTodayFresh(root) }) },
      h('div', { class: 'label' }, h('span', { class: 'tile-ico tint-teal', style: { color: 'var(--c-protein)' } }, ico('scale', 14)), 'Weight'),
      h('div', { class: 'value' }, lastW ? String(wDisp(lastW.weight_kg)) : '—', h('span', { class: 'u' }, wUnit())),
      prevW ? h('div', { class: `delta ${deltaGood ? 'up' : 'down'}` }, `${deltaKg >= 0 ? '+' : ''}${wDisp(Math.abs(deltaKg)) * Math.sign(deltaKg) || 0} ${wUnit()} vs last`) : h('div', { class: 'delta' }, 'Tap to weigh in'),
      wt.length > 1 ? h('div', { class: 'mt-8' }, sparkline({ points: wt.map((p) => p.weight_kg), color: cssVar('--c-accent') })) : null,
    ),
    (() => {
      const sched = boot.schedule_today;
      const vStyle = { fontSize: '17px', lineHeight: 1.25, marginTop: '6px' };
      let valueText, deltaEl, onTap;
      if (day.workouts.length) {
        valueText = day.workouts.map((w) => w.name || w.type).join(', ');
        deltaEl = h('div', { class: 'delta up' }, 'Done ✓');
        onTap = () => App.go('#/train');
      } else if (sched?.kind === 'rest') {
        valueText = 'Rest day 😌';
        deltaEl = h('div', { class: 'delta' }, 'On the schedule — recover well');
        onTap = () => App.go('#/train');
      } else if (sched?.kind === 'workout') {
        valueText = `Planned: ${sched.label || 'Workout'}`;
        deltaEl = h('div', { class: 'delta up' }, 'Tap to start it');
        onTap = async () => {
          if (sched.routine_id) {
            try {
              const { routines } = await api('/routines');
              const planned = routines.find((r) => r.id === sched.routine_id);
              if (planned) return startWorkout({ routine: planned });
            } catch {}
          }
          startWorkout();
        };
      } else {
        valueText = 'Nothing planned';
        deltaEl = h('div', { class: 'delta' }, 'Tap to start a session');
        onTap = () => startWorkout();
      }
      return h('button', { class: 'tile', style: { textAlign: 'left' }, onclick: onTap },
        h('div', { class: 'label' }, h('span', { class: 'tile-ico', style: { background: 'var(--accent-soft)', color: 'var(--accent)' } }, ico('barbell', 14)), 'Today’s training'),
        h('div', {}, h('div', { class: 'value', style: vStyle }, valueText), deltaEl));
    })(),
  ));
}

async function renderTodayFresh(root) {
  await App.refresh();
  root.replaceChildren();
  renderToday(root);
}

// ── Weigh-in sheet (shared) ──────────────────────────────────
export function openWeighIn({ onDone }) {
  const last = App.boot?.weight?.weight_kg ?? 70;
  const start = wDisp(last);
  sheet({
    title: 'Weigh in',
    build: (body, { close }) => {
      const st = stepperInput({ value: start, step: wUnit() === 'kg' ? 0.1 : 0.2, min: 20, max: 900, decimals: 1 });
      body.append(
        h('p', { class: 'muted small', style: { marginBottom: '12px' } }, `Best measured in the morning, before food. Unit: ${wUnit()}.`),
        st,
        h('button', { class: 'btn btn--primary btn--block mt-14', onclick: async () => {
          try {
            const r = await api('/weight', { method: 'POST', body: { date: todayStr(), weight_kg: round1(wParse(st.getValue())) } });
            toast(r.bmi ? `Logged. BMI ${r.bmi}` : 'Logged.', 'good');
            close();
            onDone?.();
          } catch (e) { toast(e.message, 'bad'); }
        } }, 'Save weight'),
      );
    },
  });
}
