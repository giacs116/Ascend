// Progress: trends over week / month / year — weight, calories, protein, sugar,
// workout heatmap, records and body measurements.
import { h, todayStr, fmtInt, cssVar, wDisp, wUnit, movingAverage, waterDisp, waterUnit, fmtShort } from '../util.js';
import { api } from '../api.js';
import { ico, toast, sheet, confirmSheet, emptyState } from '../ui.js';
import { lineChart, barChart, heatmap } from '../charts.js';
import { openWeighIn } from './today.js';
import { App } from '../main.js';

let range = 30;

export async function renderProgress(root) {
  const view = h('div', { class: 'view' });
  root.replaceChildren(view);
  view.append(h('div', { class: 'vhead' },
    h('div', {}, h('h1', {}, 'Progress'), h('div', { class: 'sub' }, 'The long game, visualized'))));

  const chips = h('div', { class: 'range-chips' },
    ...[[7, 'Week'], [30, 'Month'], [365, 'Year']].map(([r, label]) =>
      h('button', { class: `chip${range === r ? ' on' : ''}`, onclick: () => { range = r; renderProgress(root); } }, label)));
  view.append(chips);

  let stats;
  try { stats = await api(`/stats?range=${range}&today=${todayStr()}`); }
  catch (e) { view.append(h('p', { class: 'muted' }, e.message)); return; }
  const t = stats.targets || {};

  // ── Stat tiles ─────────────────────────────────────────────
  const loggedFoodDays = stats.days.filter((d) => d.calories > 0);
  const avgCal = loggedFoodDays.length ? loggedFoodDays.reduce((a, d) => a + d.calories, 0) / loggedFoodDays.length : 0;
  const avgPro = loggedFoodDays.length ? loggedFoodDays.reduce((a, d) => a + d.protein_g, 0) / loggedFoodDays.length : 0;
  view.append(h('div', { class: 'tiles', style: { marginBottom: '12px' } },
    tile('Workouts', String(stats.totals.workouts), '', 'barbell'),
    tile('Volume lifted', fmtInt(wDisp(stats.totals.volume_kg, 0)), wUnit(), 'trend'),
    tile('Avg calories', avgCal ? fmtInt(avgCal) : '—', avgCal ? 'kcal' : '', 'flame'),
    tile('Avg protein', avgPro ? String(Math.round(avgPro)) : '—', avgPro ? 'g' : '', 'utensils'),
  ));

  // ── Year: heatmap ──────────────────────────────────────────
  if (range === 365) {
    const hmCard = h('div', { class: 'card chart-card' },
      h('h3', {}, 'Training days'),
      h('p', { class: 'hint' }, `${stats.totals.workouts} workouts in the last year · ${stats.streak}-day streak`));
    const host = h('div', { class: 'mt-8' });
    hmCard.append(host);
    heatmap(host, { days: stats.days.map((d) => ({ date: d.date, count: d.workouts })) });
    view.append(hmCard);
  }

  // ── Weight ─────────────────────────────────────────────────
  const wCard = h('div', { class: 'card chart-card' });
  const weights = stats.weights.map((w) => ({ x: w.date, y: +wDisp(w.weight_kg) }));
  wCard.append(
    h('div', { class: 'flex' },
      h('div', { class: 'grow' }, h('h3', {}, 'Weight'), h('p', { class: 'hint' }, weights.length ? `${weights.length} weigh-ins · trend is the 7-day average` : 'Log weigh-ins to see your trend')),
      h('button', { class: 'btn btn--soft btn--sm', onclick: () => openWeighIn({ onDone: () => renderProgress(root) }) }, 'Weigh in')));
  if (weights.length >= 2) {
    const host = h('div', {});
    wCard.append(host);
    lineChart(host, {
      dots: weights,
      line: movingAverage(weights, 7),
      dotColor: cssVar('--c-muted'),
      lineColor: cssVar('--c-accent'),
      yFmt: (v) => String(Math.round(v * 10) / 10),
      unit: ` ${wUnit()}`,
    });
    wCard.append(h('div', { class: 'legend' },
      h('span', { class: 'lg' }, h('span', { class: 'key-line', style: { background: cssVar('--c-accent') } }), '7-day trend'),
      h('span', { class: 'lg' }, h('span', { class: 'key-rect', style: { background: cssVar('--c-muted'), borderRadius: '50%' } }), 'daily weigh-in')));
  } else {
    wCard.append(emptyState({ icon: 'scale', title: 'Not enough data yet', sub: 'Two weigh-ins and the chart appears. Morning-you is the most consistent you.' }));
  }
  view.append(wCard);

  // ── Nutrition charts (week / month) ────────────────────────
  if (range !== 365) {
    const xEvery = range === 7 ? 1 : 5;
    const mkBars = (title, key, color, target, yFmt, unitLabel) => {
      const card = h('div', { class: 'card chart-card' }, h('h3', {}, title),
        target ? h('p', { class: 'hint' }, `dashed line = your ${fmtInt(target)}${unitLabel} goal`) : null);
      const anyData = stats.days.some((d) => d[key] > 0);
      if (!anyData) { card.append(emptyState({ icon: 'chart', title: 'Nothing logged in this range' })); return card; }
      const host = h('div', {});
      card.append(host);
      barChart(host, {
        data: stats.days.map((d, i) => ({
          date: d.date, value: d[key],
          xTick: range === 7 ? 'SMTWTFS'[new Date(d.date + 'T12:00:00').getDay()] : (i % xEvery === 0 ? fmtShort(d.date).replace(' ', ' ') : null),
        })),
        color, target, yFmt,
      });
      return card;
    };
    view.append(mkBars('Calories', 'calories', cssVar('--c-carbs'), t.calories, fmtInt, ' kcal'));
    view.append(mkBars('Protein', 'protein_g', cssVar('--c-protein'), t.protein_g, (v) => `${Math.round(v)}`, 'g'));
    view.append(mkBars('Added sugar', 'sugar_g', cssVar('--c-sugar'), t.sugar_g, (v) => `${Math.round(v)}`, 'g'));
    view.append(mkBars(`Water (${waterUnit()})`, 'water_ml', cssVar('--c-water'), t.water_ml,
      (v) => String(waterDisp(v)), ` ${waterUnit()}`));
  }

  // ── Body measurements ──────────────────────────────────────
  view.append(h('div', { class: 'section-label' }, 'Body measurements',
    h('button', { class: 'lnk', style: { color: 'var(--accent)', fontWeight: 600 }, onclick: () => openMeasure(() => renderProgress(root)) }, '+ Add')));
  let meas = { measurements: [] };
  try { meas = await api('/measurements'); } catch {}
  if (!meas.measurements.length) {
    view.append(h('div', { class: 'card' }, h('p', { class: 'hint' }, 'Track waist, chest, arms and more — tape doesn’t lie, and neither does the mirror in eight weeks.')));
  } else {
    const mCard = h('div', { class: 'card card--flush' });
    for (const m of meas.measurements.slice(0, 8)) {
      mCard.append(h('div', { class: 'row' },
        h('div', { class: 'grow' }, h('div', { class: 't' }, m.kind), h('div', { class: 's' }, m.date)),
        h('div', { class: 'v' }, String(Math.round(m.value_cm * 10) / 10), h('span', { class: 'u' }, 'cm'))));
    }
    view.append(mCard);
  }

  // ── Weigh-in history ───────────────────────────────────────
  if (stats.weights.length) {
    view.append(h('div', { class: 'section-label' }, 'Weigh-ins'));
    const list = h('div', { class: 'card card--flush' });
    for (const w of [...stats.weights].reverse().slice(0, 10)) {
      list.append(h('div', { class: 'row' },
        h('div', { class: 'grow' }, h('div', { class: 't' }, fmtShort(w.date)), h('div', { class: 's' }, w.date)),
        h('div', { class: 'v' }, String(wDisp(w.weight_kg)), h('span', { class: 'u' }, wUnit()))));
    }
    view.append(list);
  }

  function tile(label, value, unit, icon) {
    return h('div', { class: 'tile' },
      h('div', { class: 'label' }, ico(icon, 14), label),
      h('div', { class: 'value' }, value, unit ? h('span', { class: 'u' }, ` ${unit}`) : null));
  }
}

function openMeasure(onDone) {
  const KINDS = ['Waist', 'Chest', 'Hips', 'Left arm', 'Right arm', 'Left thigh', 'Right thigh', 'Neck', 'Calves'];
  sheet({
    title: 'Add measurement',
    build: (body, { close }) => {
      let kind = 'Waist';
      const chips = h('div', { class: 'chips', style: { marginBottom: '14px' } });
      const renderChips = () => chips.replaceChildren(...KINDS.map((k) =>
        h('button', { class: `chip${k === kind ? ' on' : ''}`, onclick: () => { kind = k; renderChips(); } }, k)));
      renderChips();
      const val = h('input', { class: 'input', type: 'number', inputmode: 'decimal', placeholder: 'e.g. 84' });
      body.append(
        chips,
        h('div', { class: 'field' }, h('label', {}, 'Value (cm)'), val),
        h('button', { class: 'btn btn--primary btn--block', onclick: async () => {
          if (!+val.value) return toast('Enter a value in cm.', 'bad');
          await api('/measurements', { method: 'POST', body: { date: todayStr(), kind, value_cm: +val.value } });
          toast('Saved', 'good'); close(); onDone?.();
        } }, 'Save'));
    },
  });
}
