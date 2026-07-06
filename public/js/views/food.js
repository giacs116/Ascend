// Nutrition: day log, food library search, manual entry, and AI estimation (text + photo).
import { h, todayStr, shiftDateStr, fmtDay, fmtInt, cssVar, vibrate, debounce } from '../util.js';
import { api } from '../api.js';
import { ico, toast, sheet, spinner, emptyState, confirmSheet } from '../ui.js';
import { imageFileToJpeg } from '../media.js';
import { App } from '../main.js';

const MEALS = [
  ['breakfast', '🌅', 'Breakfast', 'amber'],
  ['lunch', '🥪', 'Lunch', 'teal'],
  ['dinner', '🍽', 'Dinner', 'violet'],
  ['snacks', '🍿', 'Snacks', 'pink'],
];

function autoMeal() {
  const hr = new Date().getHours() + new Date().getMinutes() / 60;
  return hr < 10.5 ? 'breakfast' : hr < 15 ? 'lunch' : hr < 20.5 ? 'dinner' : 'snacks';
}

export async function renderFood(root, params = {}) {
  const date = params.date || todayStr();
  const view = h('div', { class: 'view' });
  root.replaceChildren(view);
  view.append(h('p', { class: 'muted center', style: { padding: '40px 0' } }, 'Loading…'));

  let day;
  try { day = await api(`/day/${date}`); }
  catch (e) { view.replaceChildren(h('p', { class: 'muted' }, e.message)); return; }
  const t = day.targets || {};
  const s = day.summary;
  view.replaceChildren();

  // Day switcher
  view.append(h('div', { class: 'vhead' }, h('h1', {}, 'Food')));
  view.append(h('div', { class: 'day-switch' },
    h('button', { class: 'btn btn--icon', onclick: () => renderFood(root, { date: shiftDateStr(date, -1) }) }, ico('chevL')),
    h('div', { class: 'ds-date' }, fmtDay(date), h('span', { class: 's' }, date)),
    h('button', { class: 'btn btn--icon', disabled: date >= todayStr(), onclick: () => renderFood(root, { date: shiftDateStr(date, 1) }) }, ico('chevR')),
  ));

  // Summary
  const remaining = (t.calories || 0) - s.calories;
  const meter = (label, val, max, color) => {
    const pct = max ? Math.min(1, val / max) : 0;
    return h('div', { class: 'macro-meter' },
      h('div', { class: 'mm-top' },
        h('div', { class: 'mm-name' }, h('span', { class: 'dot', style: { background: color } }), label),
        h('div', { class: 'mm-val', style: max && val > max ? { color: 'var(--c-fat)' } : {} }, String(Math.round(val)), h('span', {}, ` / ${Math.round(max)} g`))),
      h('div', { class: 'mm-track', style: { background: `color-mix(in srgb, ${color} 14%, transparent)` } },
        h('div', { class: 'mm-fill', style: { width: `${pct * 100}%`, background: color } })));
  };
  view.append(h('div', { class: 'card' },
    h('div', { class: 'flex', style: { marginBottom: '8px' } },
      h('div', { class: 'grow' },
        h('div', { style: { fontSize: '30px', fontWeight: 800, letterSpacing: '-0.02em' } }, fmtInt(s.calories), h('span', { style: { fontSize: '14px', color: 'var(--text-3)', fontWeight: 650 } }, ` / ${fmtInt(t.calories || 0)} kcal`)),
        h('div', { class: 'small', style: { color: remaining < 0 ? 'var(--c-fat)' : 'var(--text-3)', fontWeight: 600 } },
          remaining < 0 ? `${fmtInt(-remaining)} over target` : `${fmtInt(remaining)} left`)),
    ),
    meter('Protein', s.protein_g, t.protein_g || 0, cssVar('--c-protein')),
    meter('Carbs', s.carbs_g, t.carbs_g || 0, cssVar('--c-carbs')),
    meter('Fat', s.fat_g, t.fat_g || 0, cssVar('--c-fat')),
    meter('Sugar', s.sugar_g, t.sugar_g || 0, cssVar('--c-sugar')),
  ));

  // Meals
  for (const [key, em, label, tint] of MEALS) {
    const items = day.entries.filter((e) => e.meal === key);
    const cal = items.reduce((a, e) => a + e.calories, 0);
    const group = h('div', { class: 'meal-group' },
      h('div', { class: 'meal-head' },
        h('div', { class: 'mh-t' }, h('span', { class: `mh-em tint-${tint}` }, em), label),
        h('div', { class: 'mh-cal' }, items.length ? `${fmtInt(cal)} kcal` : '')),
    );
    const card = h('div', { class: 'card card--flush mb-0' });
    for (const e of items) {
      card.append(h('button', { class: 'row', onclick: () => openEditEntry(e, () => renderFood(root, { date })) },
        h('div', { class: 'grow' },
          h('div', { class: 't' }, e.name, e.source?.startsWith('ai') ? h('span', { class: 'ai-badge', style: { marginLeft: '7px' } }, ico('sparkles', 11), 'AI') : null),
          h('div', { class: 'food-row-macros' },
            e.qty ? h('span', {}, e.qty) : null,
            h('span', {}, h('b', {}, `${Math.round(e.protein_g)}P`)), h('span', {}, `${Math.round(e.carbs_g)}C`), h('span', {}, `${Math.round(e.fat_g)}F`))),
        h('div', { class: 'v' }, fmtInt(e.calories), h('span', { class: 'u' }, 'kcal'))));
    }
    card.append(h('button', { class: 'row', style: { color: 'var(--text-3)' }, onclick: () => openAddFood({ date, meal: key, onDone: () => renderFood(root, { date }) }) },
      h('span', { style: { display: 'flex' } }, ico('plus', 18)), h('span', { class: 'grow', style: { fontSize: '14px', fontWeight: 600 } }, `Add to ${key}`)));
    group.append(card);
    view.append(group);
  }

  view.append(h('button', { class: 'btn--fab', onclick: () => openAddFood({ date, onDone: () => renderFood(root, { date }) }) }, ico('plus')));
}

// ── Edit an entry ────────────────────────────────────────────
function openEditEntry(entry, onDone) {
  sheet({
    title: 'Edit entry',
    build: (body, { close }) => {
      const f = {};
      const field = (label, key, val, type = 'number') => h('div', { class: 'field', style: { flex: 1 } },
        h('label', {}, label),
        f[key] = h('input', { class: 'input', type, inputmode: type === 'number' ? 'decimal' : 'text', value: String(val ?? '') }));
      body.append(
        field('Name', 'name', entry.name, 'text'),
        h('div', { class: 'input-row' }, field('Amount', 'qty', entry.qty || '', 'text'), field('Calories', 'calories', entry.calories)),
        h('div', { class: 'input-row' }, field('Protein (g)', 'protein_g', entry.protein_g), field('Carbs (g)', 'carbs_g', entry.carbs_g)),
        h('div', { class: 'input-row' }, field('Fat (g)', 'fat_g', entry.fat_g), field('Sugar (g)', 'sugar_g', entry.sugar_g)),
        h('button', { class: 'btn btn--primary btn--block mt-8', onclick: async () => {
          try {
            await api(`/food/${entry.id}`, { method: 'PUT', body: {
              name: f.name.value.trim() || entry.name, qty: f.qty.value.trim(),
              calories: +f.calories.value || 0, protein_g: +f.protein_g.value || 0,
              carbs_g: +f.carbs_g.value || 0, fat_g: +f.fat_g.value || 0, sugar_g: +f.sugar_g.value || 0,
            }});
            close(); onDone();
          } catch (e) { toast(e.message, 'bad'); }
        } }, 'Save changes'),
        h('button', { class: 'btn btn--danger btn--block mt-8', onclick: async () => {
          await api(`/food/${entry.id}`, { method: 'DELETE' });
          close(); onDone(); toast('Deleted');
        } }, 'Delete entry'),
      );
    },
  });
}

// ── Add food sheet (Search / AI / Photo / Manual) ────────────
export function openAddFood({ date = todayStr(), meal, onDone }) {
  let currentMeal = meal || autoMeal();
  let tab = 'search';

  sheet({
    title: 'Add food',
    build: (body) => {
      const mealChips = h('div', { class: 'chips', style: { marginBottom: '14px' } });
      const renderMeals = () => mealChips.replaceChildren(...MEALS.map(([k, em, label]) =>
        h('button', { class: `chip${k === currentMeal ? ' on' : ''}`, onclick: () => { currentMeal = k; renderMeals(); } }, `${em} ${label}`)));
      renderMeals();

      const tabs = h('div', { class: 'seg', style: { marginBottom: '16px' } });
      const content = h('div', {});
      const TABS = [
        ['search', 'Search'],
        ['ai', '✨ Describe'],
        ['photo', '📷 Photo'],
        ['manual', 'Manual'],
      ];
      const renderTabs = () => tabs.replaceChildren(...TABS.map(([k, label]) =>
        h('button', { class: k === tab ? 'on' : '', onclick: () => { tab = k; renderTabs(); renderContent(); } }, label)));

      const added = () => { vibrate(10); onDone?.(); };

      function renderContent() {
        content.replaceChildren();
        if (tab === 'search') buildSearch(content, () => currentMeal, date, added);
        else if (tab === 'ai') buildAiText(content, () => currentMeal, date, added);
        else if (tab === 'photo') buildAiPhoto(content, () => currentMeal, date, added);
        else buildManual(content, () => currentMeal, date, added);
      }
      renderTabs();
      renderContent();
      body.append(mealChips, tabs, content);
    },
  });
}

function buildSearch(el, getMeal, date, onAdded) {
  const results = h('div', { class: 'card card--flush', style: { maxHeight: '46dvh', overflowY: 'auto' } });
  const input = h('input', { class: 'input', placeholder: 'Search foods… (e.g. chicken, rice)', autocomplete: 'off' });
  const load = async (q) => {
    const r = await api(`/foods?q=${encodeURIComponent(q)}`);
    results.replaceChildren();
    if (!r.foods.length) {
      results.append(emptyState({ icon: 'search', title: 'No matches', sub: 'Try the ✨ Describe tab — the AI can estimate anything.' }));
      return;
    }
    for (const food of r.foods) {
      results.append(h('button', { class: 'row', onclick: () => pickServings(food) },
        h('div', { class: 'grow' },
          h('div', { class: 't' }, food.name, food.is_custom ? h('span', { class: 'ai-badge', style: { marginLeft: '7px' } }, 'mine') : null),
          h('div', { class: 's' }, `${food.serving} · ${Math.round(food.protein_g)}g protein`)),
        h('div', { class: 'v' }, fmtInt(food.calories), h('span', { class: 'u' }, 'kcal'))));
    }
  };
  input.addEventListener('input', debounce(() => load(input.value.trim()), 220));
  el.append(input, h('div', { style: { height: '12px' } }), results);
  load('');

  function pickServings(food) {
    // If the serving mentions grams (e.g. "100 g" or "1 scoop (30 g)"), offer direct gram entry.
    const gramBase = (() => {
      const m = /(\d+(?:\.\d+)?)\s*g\b/.exec(food.serving || '');
      return m ? +m[1] : null;
    })();
    let mode = 'servings';           // 'servings' | 'grams'
    let servings = 1;
    let grams = gramBase || 100;
    const mult = () => (mode === 'grams' && gramBase ? grams / gramBase : servings);

    const panel = h('div', {});
    const render = () => {
      const m = mult();
      const macro = (label, v, color) => h('div', { class: 'qty-macro' },
        h('b', { style: m > 0 ? {} : {} }, `${Math.round(v * m)}g`),
        h('span', { class: 'qm-dot', style: { background: color } }),
        h('span', {}, label));

      const qtyInput = h('input', {
        class: 'input', type: 'number', inputmode: 'decimal', style: { textAlign: 'center', fontWeight: 800, fontSize: '19px' },
        value: mode === 'grams' ? String(Math.round(grams)) : String(servings),
        oninput: (e) => {
          const v = Math.max(0, +e.target.value || 0);
          if (mode === 'grams') grams = v; else servings = v;
          refreshNumbers();
        },
      });
      const step = (delta) => {
        if (mode === 'grams') grams = Math.max(0, grams + delta * 10);
        else servings = Math.max(0, Math.round((servings + delta * 0.25) * 100) / 100);
        render();
      };

      const totalsEl = h('div', {});
      const refreshNumbers = () => {
        const k = mult();
        totalsEl.replaceChildren(
          h('div', { class: 'center', style: { fontSize: '26px', fontWeight: 800, letterSpacing: '-0.02em', margin: '10px 0 2px' } },
            fmtInt(food.calories * k), h('span', { class: 'muted', style: { fontSize: '13px', fontWeight: 650 } }, ' kcal')),
          h('div', { class: 'qty-macros' },
            macro('protein', food.protein_g, cssVar('--c-protein')),
            macro('carbs', food.carbs_g, cssVar('--c-carbs')),
            macro('fat', food.fat_g, cssVar('--c-fat')),
            macro('sugar', food.sugar_g, cssVar('--c-sugar'))),
        );
        // rebuild macro amounts with current multiplier
        const bs = totalsEl.querySelectorAll('.qty-macro b');
        const vals = [food.protein_g, food.carbs_g, food.fat_g, food.sugar_g];
        bs.forEach((b, i) => { b.textContent = `${Math.round(vals[i] * k)}g`; });
      };

      panel.replaceChildren(h('div', { class: 'card', style: { marginTop: '12px' } },
        h('div', { class: 'flex' },
          h('div', { class: 'grow' },
            h('h3', {}, food.name),
            h('div', { class: 'hint' }, `1 serving = ${food.serving} · ${fmtInt(food.calories)} kcal`)),
        ),
        gramBase ? h('div', { class: 'seg', style: { margin: '12px 0 4px' } },
          h('button', { class: mode === 'servings' ? 'on' : '', onclick: () => { mode = 'servings'; render(); } }, 'Servings'),
          h('button', { class: mode === 'grams' ? 'on' : '', onclick: () => { mode = 'grams'; render(); } }, 'Grams')) : null,
        h('div', { class: 'stepper mt-8' },
          h('button', { type: 'button', onclick: () => step(-1) }, '−'),
          qtyInput,
          h('button', { type: 'button', onclick: () => step(1) }, '+')),
        h('div', { class: 'chips', style: { justifyContent: 'center', marginTop: '10px' } },
          ...(mode === 'grams'
            ? [50, 100, 150, 200, 250].map((g) => h('button', { class: `chip${grams === g ? ' on' : ''}`, onclick: () => { grams = g; render(); } }, `${g}g`))
            : [0.5, 1, 1.5, 2, 3].map((s) => h('button', { class: `chip${servings === s ? ' on' : ''}`, onclick: () => { servings = s; render(); } }, `${s}×`)))),
        totalsEl,
        h('button', { class: 'btn btn--primary btn--block mt-14', onclick: async () => {
          const k = mult();
          if (!(k > 0)) return toast('Enter an amount first.', 'bad');
          const qty = mode === 'grams' ? `${Math.round(grams)} g` : `${servings} × ${food.serving}`;
          await api('/food', { method: 'POST', body: {
            date, meal: getMeal(), name: food.name, qty,
            calories: food.calories * k, protein_g: food.protein_g * k,
            carbs_g: food.carbs_g * k, fat_g: food.fat_g * k, sugar_g: food.sugar_g * k,
            source: 'library', food_id: food.id,
          }});
          toast(`Added ${food.name}`, 'good');
          panel.replaceChildren();
          onAdded();
        } }, `Add to ${getMeal()}`),
      ));
      refreshNumbers();
      panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    };
    render();
    el.append(panel);
  }
}

function aiLockedNotice(el) {
  el.append(h('div', { class: 'card card--accent center', style: { padding: '24px 18px' } },
    h('div', { style: { color: 'var(--accent)', display: 'flex', justifyContent: 'center', marginBottom: '10px' } }, ico('sparkles', 30)),
    h('h3', {}, 'AI estimation is one step away'),
    h('p', { class: 'hint', style: { margin: '6px 0 14px' } }, 'Add your Anthropic API key in Settings and Ascend will estimate calories from a description or a photo of your plate.'),
    h('button', { class: 'btn btn--primary', onclick: () => { App.go('#/settings'); } }, 'Set up AI'),
  ));
}

function estimateResults(el, est, { date, getMeal, source, onAdded }) {
  el.replaceChildren();
  if (!est.items.length) {
    el.append(h('div', { class: 'card' }, h('p', { class: 'hint' }, est.notes || 'No food detected.')));
    return;
  }
  const kept = new Set(est.items.map((_, i) => i));
  const list = h('div', {});
  const render = () => {
    list.replaceChildren();
    est.items.forEach((it, i) => {
      if (!kept.has(i)) return;
      list.append(h('div', { class: 'est-item' },
        h('div', { class: 'ei-head' },
          h('div', { class: 'ei-name' }, it.name, h('span', { class: 'muted', style: { fontWeight: 500 } }, ` · ${it.qty}`)),
          h('div', { class: 'flex', style: { gap: '8px' } },
            h('b', {}, fmtInt(it.calories)),
            h('button', { class: 'btn btn--icon', style: { width: '32px', height: '32px' }, onclick: () => { kept.delete(i); render(); } }, ico('x', 15)))),
        h('div', { class: 'ei-macros' },
          h('span', {}, `${Math.round(it.protein_g)}g protein`), h('span', {}, `${Math.round(it.carbs_g)}g carbs`),
          h('span', {}, `${Math.round(it.fat_g)}g fat`), h('span', {}, `${Math.round(it.sugar_g)}g sugar`))));
    });
    const totalCal = est.items.filter((_, i) => kept.has(i)).reduce((a, it) => a + it.calories, 0);
    addBtn.textContent = kept.size ? `Add ${kept.size} item${kept.size > 1 ? 's' : ''} · ${fmtInt(totalCal)} kcal` : 'Nothing to add';
    addBtn.disabled = !kept.size;
  };
  const addBtn = h('button', { class: 'btn btn--primary btn--block mt-8', onclick: async () => {
    for (const [i, it] of est.items.entries()) {
      if (!kept.has(i)) continue;
      await api('/food', { method: 'POST', body: { date, meal: getMeal(), name: it.name, qty: it.qty,
        calories: it.calories, protein_g: it.protein_g, carbs_g: it.carbs_g, fat_g: it.fat_g, sugar_g: it.sugar_g, source }});
    }
    toast('Logged ✨', 'good');
    el.replaceChildren(h('p', { class: 'muted center small', style: { padding: '10px' } }, 'Added! Estimate something else or close the sheet.'));
    onAdded();
  } }, 'Add');
  el.append(
    h('div', { class: 'flex', style: { margin: '4px 0 10px' } },
      h('span', { class: 'ai-badge' }, ico('sparkles', 11), `${est.confidence} confidence`),
      est.notes ? h('span', { class: 'small muted grow' }, est.notes) : null),
    list, addBtn);
  render();
}

function buildAiText(el, getMeal, date, onAdded) {
  if (!App.boot.settings.ai.hasKey) return aiLockedNotice(el);
  const ta = h('textarea', { class: 'input', placeholder: 'e.g. "2 scrambled eggs, 2 slices of buttered toast and a glass of orange juice"' });
  const out = h('div', { class: 'mt-14' });
  const btn = h('button', { class: 'btn btn--primary btn--block mt-14', onclick: async () => {
    const text = ta.value.trim();
    if (!text) return toast('Describe what you ate first.', 'bad');
    btn.disabled = true;
    btn.replaceChildren(spinner(), ' Estimating…');
    try {
      const est = await api('/ai/estimate', { method: 'POST', body: { text } });
      estimateResults(out, est, { date, getMeal, source: 'ai_text', onAdded });
    } catch (e) { toast(e.message, 'bad'); }
    btn.disabled = false;
    btn.replaceChildren('Estimate with AI ✨');
  } }, 'Estimate with AI ✨');
  el.append(ta, btn, out);
}

function buildAiPhoto(el, getMeal, date, onAdded) {
  if (!App.boot.settings.ai.hasKey) return aiLockedNotice(el);
  const input = h('input', { type: 'file', accept: 'image/*', capture: 'environment', style: { display: 'none' } });
  const mediaBox = h('div', {});
  const out = h('div', { class: 'mt-14' });
  let imageData = null;

  const showZone = () => {
    imageData = null;
    mediaBox.replaceChildren(h('button', { class: 'photo-drop', style: { width: '100%' }, onclick: () => input.click() },
      ico('camera'), 'Snap or choose a photo of your plate'));
  };

  const showPreview = () => {
    const analyzeBtn = h('button', { class: 'btn btn--primary btn--block mt-14', onclick: async () => {
      analyzeBtn.disabled = true;
      analyzeBtn.replaceChildren(spinner(), ' Looking at your plate…');
      try {
        const est = await api('/ai/estimate', { method: 'POST', body: { image: imageData } });
        estimateResults(out, est, { date, getMeal, source: 'ai_photo', onAdded });
      } catch (e) { toast(e.message, 'bad'); }
      analyzeBtn.disabled = false;
      analyzeBtn.replaceChildren('Analyze photo ✨');
    } }, 'Analyze photo ✨');
    mediaBox.replaceChildren(
      h('div', { class: 'photo-preview' },
        h('img', { src: imageData, alt: 'Meal photo' }),
        h('button', { class: 'btn btn--icon pp-x', onclick: () => { out.replaceChildren(); showZone(); } }, ico('x'))),
      analyzeBtn);
  };

  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    if (!file) return;
    try {
      imageData = await imageFileToJpeg(file, 1024, 0.82);
      showPreview();
    } catch (e) { toast(e.message, 'bad'); }
    input.value = '';
  });
  showZone();
  el.append(mediaBox, input, out);
}

function buildManual(el, getMeal, date, onAdded) {
  const f = {};
  const field = (label, key, ph = '', type = 'number') => h('div', { class: 'field', style: { flex: 1 } },
    h('label', {}, label),
    f[key] = h('input', { class: 'input', type, inputmode: type === 'number' ? 'decimal' : 'text', placeholder: ph }));
  let saveToLib = false;
  const libToggle = h('button', { class: 'chip', onclick: () => { saveToLib = !saveToLib; libToggle.classList.toggle('on', saveToLib); } }, '💾 Save to my foods');
  el.append(
    field('Name', 'name', 'e.g. Mom’s lasagna', 'text'),
    h('div', { class: 'input-row' }, field('Amount', 'qty', '1 plate', 'text'), field('Calories', 'calories', '450')),
    h('div', { class: 'input-row' }, field('Protein (g)', 'protein_g', '25'), field('Carbs (g)', 'carbs_g', '40')),
    h('div', { class: 'input-row' }, field('Fat (g)', 'fat_g', '18'), field('Sugar (g)', 'sugar_g', '6')),
    h('div', { style: { margin: '4px 0 14px' } }, libToggle),
    h('button', { class: 'btn btn--primary btn--block', onclick: async () => {
      const name = f.name.value.trim();
      if (!name) return toast('Give it a name.', 'bad');
      const macros = {
        calories: +f.calories.value || 0, protein_g: +f.protein_g.value || 0,
        carbs_g: +f.carbs_g.value || 0, fat_g: +f.fat_g.value || 0, sugar_g: +f.sugar_g.value || 0,
      };
      await api('/food', { method: 'POST', body: { date, meal: getMeal(), name, qty: f.qty.value.trim(), ...macros, source: 'manual' } });
      if (saveToLib) await api('/foods', { method: 'POST', body: { name, serving: f.qty.value.trim() || '1 serving', ...macros } });
      toast(`Added ${name}`, 'good');
      onAdded();
      for (const k of Object.keys(f)) f[k].value = '';
    } }, 'Add food'),
  );
}
