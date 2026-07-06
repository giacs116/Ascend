// Settings: profile, targets, units, theme, AI key & model, data export/reset.
import { h, fmtInt, heightDisp, wDisp, wUnit, waterDisp, waterUnit } from '../util.js';
import { api } from '../api.js';
import { ico, toast, sheet, segmented, confirmSheet, spinner, stepperInput } from '../ui.js';
import { App } from '../main.js';

export async function renderSettings(root) {
  const view = h('div', { class: 'view' });
  root.replaceChildren(view);
  const boot = App.boot;
  const p = boot.profile;
  const t = boot.targets;
  const ai = boot.settings.ai;

  view.append(h('div', { class: 'vhead' },
    h('div', {}, h('h1', {}, 'Settings')),
    h('div', { class: 'vhead-actions' }, h('button', { class: 'btn btn--icon', onclick: () => App.go('#/today') }, ico('x')))));

  const rerender = async () => { await App.refresh(); renderSettings(root); };

  // ── Profile ────────────────────────────────────────────────
  view.append(h('div', { class: 'section-label' }, 'Profile'));
  const profCard = h('div', { class: 'card card--flush' });
  const profRow = (label, value, onEdit) => h('button', { class: 'row', onclick: onEdit },
    h('div', { class: 'grow' }, h('div', { class: 's' }, label), h('div', { class: 't' }, value)), ico('chevR'));
  profCard.append(
    profRow('Name', p.name, () => editText('Name', p.name, async (v) => { await api('/profile', { method: 'PUT', body: { name: v } }); rerender(); })),
    profRow('Height', heightDisp(p.height_cm), () => editNumber('Height (cm)', p.height_cm, 1, async (v) => { await api('/profile', { method: 'PUT', body: { height_cm: v } }); rerender(); })),
    profRow('Weight', `${wDisp(boot.weight?.weight_kg)} ${wUnit()}`, () => toast('Log weight from the Today screen — it keeps your history.', 'info', 3000)),
    profRow('Activity level', cap(p.activity), () => pickOne('Activity level', [
      ['sedentary', 'Mostly sitting'], ['light', 'Lightly active'], ['moderate', 'Active'], ['very', 'Very active'], ['extreme', 'Athlete mode'],
    ], p.activity, async (v) => { await api('/profile', { method: 'PUT', body: { activity: v } }); rerender(); })),
    profRow('Goal', p.goal === 'lose' ? 'Lose fat' : p.goal === 'gain' ? 'Build muscle' : 'Maintain', () => pickOne('Goal', [
      ['lose', 'Lose fat'], ['maintain', 'Maintain & recomp'], ['gain', 'Build muscle'],
    ], p.goal, async (v) => { await api('/profile', { method: 'PUT', body: { goal: v } }); rerender(); toast('Targets recalculated', 'good'); })),
  );
  view.append(profCard);

  // ── Targets ────────────────────────────────────────────────
  view.append(h('div', { class: 'section-label' }, 'Daily targets',
    t?.custom ? h('span', { class: 'ai-badge' }, 'custom') : h('span', { class: 'ai-badge' }, 'auto')));
  const tgtCard = h('div', { class: 'card' });
  tgtCard.append(h('p', { class: 'small muted', style: { marginBottom: '10px' } },
    t?.custom ? 'You’ve customized these. Auto-mode recalculates from your profile and latest weight.'
              : `Auto-calculated from your stats (BMR ≈${fmtInt(t?.bmr || 0)}, burn ≈${fmtInt(t?.tdee || 0)} kcal/day).`),
    h('div', { class: 'small', style: { lineHeight: 2 } },
      row2('Calories', `${fmtInt(t?.calories || 0)} kcal`),
      row2('Protein', `${t?.protein_g || 0} g`),
      row2('Carbs / Fat', `${t?.carbs_g || 0} g / ${t?.fat_g || 0} g`),
      row2('Added sugar cap', `${t?.sugar_g || 0} g`),
      row2('Water', `${waterDisp(t?.water_ml || 0)} ${waterUnit()}`)),
    h('div', { class: 'flex mt-14' },
      h('button', { class: 'btn btn--ghost btn--sm grow', onclick: () => customizeTargets(t, rerender) }, 'Customize'),
      t?.custom ? h('button', { class: 'btn btn--soft btn--sm', onclick: async () => { await api('/targets', { method: 'DELETE' }); rerender(); toast('Back to auto targets', 'good'); } }, 'Reset to auto') : null));
  view.append(tgtCard);

  // ── Units & appearance ─────────────────────────────────────
  view.append(h('div', { class: 'section-label' }, 'Units & appearance'));
  const unitCard = h('div', { class: 'card' });
  const unitRow = (label, seg) => h('div', { class: 'field' }, h('label', {}, label), seg);
  unitCard.append(
    unitRow('Body weight & lifting', segmented([{ label: 'Pounds (lb)', value: 'lb' }, { label: 'Kilograms (kg)', value: 'kg' }], boot.settings.weight_unit,
      async (v) => { await api('/settings', { method: 'PUT', body: { weight_unit: v } }); rerender(); })),
    unitRow('Height', segmented([{ label: 'Centimeters', value: 'cm' }, { label: 'Feet & inches', value: 'ftin' }], boot.settings.height_unit,
      async (v) => { await api('/settings', { method: 'PUT', body: { height_unit: v } }); rerender(); })),
    unitRow('Water', segmented([{ label: 'Fluid oz', value: 'oz' }, { label: 'Milliliters', value: 'ml' }], boot.settings.water_unit,
      async (v) => { await api('/settings', { method: 'PUT', body: { water_unit: v } }); rerender(); })),
    unitRow('Theme', segmented([{ label: '🌙 Dark', value: 'dark' }, { label: '☀️ Light', value: 'light' }], boot.settings.theme,
      async (v) => { App.applyTheme(v); await api('/settings', { method: 'PUT', body: { theme: v } }); rerender(); })),
  );
  view.append(unitCard);

  // ── AI ─────────────────────────────────────────────────────
  view.append(h('div', { class: 'section-label' }, 'AI coach & vision'));
  const aiCard = h('div', { class: 'card' });
  if (ai.hasKey) {
    aiCard.append(
      h('div', { class: 'flex', style: { marginBottom: '12px' } },
        h('div', { class: 'row-ico', style: { background: 'var(--accent-soft)', color: 'var(--accent)' } }, ico('key')),
        h('div', { class: 'grow' },
          h('div', { style: { fontWeight: 700, fontSize: '14.5px' } }, 'API key connected'),
          h('div', { class: 'hint' }, ai.fromEnv
            ? `loaded from the .env file on your PC (…${ai.last4})`
            : `saved in the app (…${ai.last4}) — tip: move it to the .env file`)),
        !ai.fromEnv ? h('button', { class: 'btn btn--ghost btn--sm', onclick: async () => {
          const ok = await confirmSheet({ title: 'Remove API key?', confirmLabel: 'Remove', danger: true });
          if (ok) { await api('/settings/key', { method: 'DELETE' }); rerender(); }
        } }, 'Remove') : null),
      h('div', { class: 'field' }, h('label', {}, 'Model'),
        modelSelect(ai, async (v) => { await api('/settings', { method: 'PUT', body: { ai_model: v } }); toast('Model updated', 'good'); App.refresh(); })),
      h('div', { class: 'flex' },
        testButton(),
        h('div', { class: 'small muted grow', style: { textAlign: 'right' } },
          `${ai.usage.requests} requests · ${fmtInt(ai.usage.input + ai.usage.output)} tokens used`)),
    );
  } else {
    const step = (n, ...content) => h('div', { class: 'flex', style: { alignItems: 'flex-start', gap: '10px', marginBottom: '10px' } },
      h('span', { style: { width: '22px', height: '22px', borderRadius: '8px', background: 'var(--accent-soft)', color: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '12px', fontWeight: 800, flexShrink: 0, marginTop: '1px' } }, String(n)),
      h('div', { class: 'small', style: { color: 'var(--text-2)', lineHeight: 1.55 } }, ...content));
    aiCard.append(
      h('p', { class: 'small', style: { lineHeight: 1.6, marginBottom: '14px', color: 'var(--text-2)' } },
        'The coach chat, photo calorie estimates, form checks and AI exercise recs run on Anthropic’s Claude. The key lives in a file on your PC — set it up once:'),
      step(1, 'Get an API key at ', h('b', {}, 'console.anthropic.com'), ' (pay-as-you-go).'),
      step(2, 'On your PC, open ', h('span', { class: 'kbd-key' }, '.env'), ' in the ', h('span', { class: 'kbd-key' }, 'Ascend'), ' folder with Notepad.'),
      step(3, 'Fill in the line: ', h('span', { class: 'kbd-key' }, 'ANTHROPIC_API_KEY=sk-ant-…')),
      step(4, 'Save the file, come back here and tap the button below — no restart needed.'),
      h('button', { class: 'btn btn--soft btn--block mt-8', onclick: async () => {
        await App.refresh();
        renderSettings(root);
        toast(App.boot.settings.ai.hasKey ? 'Key found ✓' : 'No key found in .env — the line should read ANTHROPIC_API_KEY=sk-ant-… (then save the file).', App.boot.settings.ai.hasKey ? 'good' : 'bad', 4000);
      } }, 'I’ve added it — check again'),
    );
  }
  view.append(aiCard);

  // ── Data ───────────────────────────────────────────────────
  view.append(h('div', { class: 'section-label' }, 'Your data'));
  const dataCard = h('div', { class: 'card card--flush' });
  dataCard.append(
    h('a', { class: 'row', href: '/api/export', download: '' },
      h('div', { class: 'row-ico', style: { background: 'var(--surface-2)' } }, ico('download')),
      h('div', { class: 'grow' }, h('div', { class: 't' }, 'Export everything'), h('div', { class: 's' }, 'One JSON file with all your logs (never includes your API key)')),
      ico('chevR')),
    h('button', { class: 'row', onclick: async () => {
      const ok = await confirmSheet({ title: 'Erase all data?', message: 'Profile, meals, workouts, weights, chats — gone. Your API key is kept. This cannot be undone.', confirmLabel: 'Erase everything', danger: true });
      if (!ok) return;
      const really = await confirmSheet({ title: 'Last chance', message: 'Absolutely sure?', confirmLabel: 'Yes, erase it all', danger: true });
      if (!really) return;
      await api('/reset', { method: 'POST', body: { confirm: 'RESET' } });
      location.hash = '';
      location.reload();
    } },
      h('div', { class: 'row-ico', style: { background: 'var(--danger-soft)', color: 'var(--danger)' } }, ico('trash')),
      h('div', { class: 'grow' }, h('div', { class: 't', style: { color: 'var(--danger)' } }, 'Start over'), h('div', { class: 's' }, 'Erase all data on this PC')),
    ));
  view.append(dataCard);

  view.append(h('p', { class: 'center small muted', style: { padding: '10px 0 4px' } },
    '▲ Ascend · runs entirely on your PC · data in ', h('span', { class: 'kbd-key' }, 'data/ascend.db')));

  function row2(k, v) {
    return h('div', { class: 'flex' }, h('span', { class: 'grow muted' }, k), h('b', {}, v));
  }
  function testButton() {
    const btn = h('button', { class: 'btn btn--soft btn--sm', onclick: async () => {
      btn.disabled = true;
      btn.replaceChildren(spinner(15), ' Testing…');
      try { const r = await api('/settings/key/test', { method: 'POST' }); toast(`Connected — ${r.model} answered ✓`, 'good'); }
      catch (e) { toast(e.message, 'bad', 4000); }
      btn.disabled = false;
      btn.replaceChildren('Test connection');
    } }, 'Test connection');
    return btn;
  }
}

function cap(s) { return s ? s[0].toUpperCase() + s.slice(1) : s; }

function modelSelect(ai, onChange) {
  const sel = h('select', { class: 'input', onchange: (e) => onChange(e.target.value) });
  for (const m of ai.models) {
    sel.append(h('option', { value: m.id, selected: m.id === ai.model }, m.label));
  }
  return sel;
}

function editText(title, value, onSave) {
  sheet({ title, build: (body, { close }) => {
    const input = h('input', { class: 'input', value });
    body.append(h('div', { class: 'field' }, input),
      h('button', { class: 'btn btn--primary btn--block', onclick: async () => { if (input.value.trim()) { await onSave(input.value.trim()); close(); } } }, 'Save'));
  }});
}

function editNumber(title, value, step, onSave) {
  sheet({ title, build: (body, { close }) => {
    const st = stepperInput({ value, step, min: 0, max: 400, decimals: 1 });
    body.append(st, h('button', { class: 'btn btn--primary btn--block mt-14', onclick: async () => { await onSave(st.getValue()); close(); } }, 'Save'));
  }});
}

function pickOne(title, options, current, onSave) {
  sheet({ title, build: (body, { close }) => {
    body.append(h('div', { class: 'ob-choices' }, ...options.map(([v, label]) =>
      h('button', { class: `ob-choice${v === current ? ' on' : ''}`, onclick: async () => { await onSave(v); close(); } },
        h('span', {}, h('div', { class: 't' }, label))))));
  }});
}

function customizeTargets(t, onDone) {
  sheet({ title: 'Customize targets', build: (body, { close }) => {
    const fields = [
      ['calories', 'Calories (kcal)', 50], ['protein_g', 'Protein (g)', 5],
      ['carbs_g', 'Carbs (g)', 5], ['fat_g', 'Fat (g)', 5],
      ['sugar_g', 'Sugar cap (g)', 5], ['water_ml', 'Water (ml)', 250],
    ];
    const steppers = {};
    for (const [key, label, step] of fields) {
      body.append(h('div', { class: 'field' }, h('label', {}, label),
        steppers[key] = stepperInput({ value: t?.[key] || 0, step, min: 0, max: 20000 })));
    }
    body.append(h('button', { class: 'btn btn--primary btn--block mt-8', onclick: async () => {
      const bodyObj = {};
      for (const [key] of fields) bodyObj[key] = steppers[key].getValue();
      await api('/targets', { method: 'PUT', body: bodyObj });
      toast('Targets saved', 'good');
      close(); onDone?.();
    } }, 'Save targets'));
  }});
}
