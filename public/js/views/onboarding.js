// Onboarding: a friendly 6-step wizard that ends with a targets reveal.
import { h, svgEl, todayStr, lb2kg, cssVar, vibrate, fmtInt } from '../util.js';
import { api } from '../api.js';
import { ico, toast } from '../ui.js';
import { App } from '../main.js';

const state = {
  name: '', sex: null, birthdate: '2000-06-15',
  height_cm: 175, weight_kg: null,
  weightUnit: 'lb', heightUnit: 'cm',
  activity: null, goal: null,
};

export function renderOnboarding(root) {
  root.replaceChildren();
  let step = 0;
  const TOTAL = 6;

  const dots = h('div', { class: 'ob-dots' });
  const body = h('div', { class: 'ob-body' });
  const wrap = h('div', { class: 'ob' }, dots, body);
  root.append(wrap);

  const steps = [stepWelcome, stepAbout, stepBody, stepActivity, stepGoal, stepReveal];

  function renderDots() {
    dots.replaceChildren(...Array.from({ length: TOTAL }, (_, i) => h('i', { class: i <= step ? 'on' : '' })));
    dots.style.visibility = step === 0 ? 'hidden' : 'visible';
  }
  function go(n) {
    step = n;
    renderDots();
    body.replaceChildren();
    steps[step]({ body, next: () => go(Math.min(step + 1, TOTAL - 1)), back: () => go(Math.max(step - 1, 0)) });
    window.scrollTo(0, 0);
  }
  go(0);
}

function footer({ next, back, nextLabel = 'Continue', canNext = () => true }) {
  const nextBtn = h('button', { class: 'btn btn--primary btn--block', onclick: () => { if (canNext()) { vibrate(8); next(); } } }, nextLabel);
  const el = h('div', { class: 'ob-foot' },
    nextBtn,
    back ? h('button', { class: 'btn btn--ghost btn--block mt-8', onclick: back }, 'Back') : null,
  );
  el.nextBtn = nextBtn;
  return el;
}

function choiceList(options, selected, onPick) {
  const el = h('div', { class: 'ob-choices' });
  const render = (sel) => {
    el.replaceChildren(...options.map((o) =>
      h('button', { class: `ob-choice${o.value === sel ? ' on' : ''}`, onclick: () => { vibrate(8); render(o.value); onPick(o.value); } },
        h('span', { class: 'em' }, o.em),
        h('span', {}, h('div', { class: 't' }, o.label), o.sub ? h('div', { class: 's' }, o.sub) : null)
      )
    ));
  };
  render(selected);
  return el;
}

// ── Steps ────────────────────────────────────────────────────
function stepWelcome({ body, next }) {
  body.append(
    h('div', { style: { flex: '1', display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', textAlign: 'center', gap: '18px' } },
      svgEl('<svg viewBox="0 0 100 100" width="92" height="92"><polygon points="64,34 34,80 96,80" fill="#71911B" opacity="0.85"/><polygon points="36,24 4,80 68,80" fill="#C8F542"/><circle cx="81.5" cy="18.5" r="5.5" fill="#F3F5F7"/></svg>'),
      h('h1', { style: { fontSize: '34px' } }, 'Ascend'),
      h('p', { class: 'muted', style: { fontSize: '16px', maxWidth: '300px', lineHeight: '1.55' } },
        'Track your food, water, training and progress — with an AI coach in your corner.'),
    ),
    footer({ next, nextLabel: 'Get started' })
  );
}

function stepAbout({ body, next, back }) {
  const foot = footer({ next, back, canNext: () => {
    if (!state.name.trim()) { toast('What should we call you?', 'bad'); return false; }
    if (!state.sex) { toast('Pick a body type — it drives the calorie math.', 'bad'); return false; }
    return true;
  }});
  body.append(
    h('h1', {}, 'First things first'),
    h('p', { class: 'lede' }, 'A couple of basics so the numbers fit you.'),
    h('div', { class: 'field' },
      h('label', {}, 'Your name'),
      h('input', { class: 'input', placeholder: 'e.g. David', value: state.name, maxlength: 40,
        oninput: (e) => { state.name = e.target.value; } })
    ),
    h('div', { class: 'field' },
      h('label', {}, 'Biological sex (for the calorie formula)'),
      choiceList([
        { value: 'male', em: '♂', label: 'Male' },
        { value: 'female', em: '♀', label: 'Female' },
      ], state.sex, (v) => { state.sex = v; })
    ),
    h('div', { class: 'field' },
      h('label', {}, 'Birthday'),
      h('input', { class: 'input', type: 'date', value: state.birthdate, max: todayStr(),
        oninput: (e) => { state.birthdate = e.target.value; } })
    ),
    h('div', { style: { flex: 1 } }),
    foot
  );
}

function stepBody({ body, next, back }) {
  const hField = h('div', {});
  const wField = h('div', {});

  const renderHeight = () => {
    hField.replaceChildren();
    if (state.heightUnit === 'cm') {
      hField.append(h('div', { class: 'input-suffix' },
        h('input', { class: 'input', type: 'number', inputmode: 'decimal', value: String(Math.round(state.height_cm)),
          oninput: (e) => { state.height_cm = +e.target.value || 0; } }),
        h('span', { class: 'sfx' }, 'cm')));
    } else {
      const totalIn = state.height_cm / 2.54;
      let ft = Math.floor(totalIn / 12), inch = Math.round(totalIn % 12);
      const sync = () => { state.height_cm = (ft * 12 + inch) * 2.54; };
      hField.append(h('div', { class: 'input-row' },
        h('div', { class: 'input-suffix' },
          h('input', { class: 'input', type: 'number', inputmode: 'numeric', value: String(ft), oninput: (e) => { ft = +e.target.value || 0; sync(); } }),
          h('span', { class: 'sfx' }, 'ft')),
        h('div', { class: 'input-suffix' },
          h('input', { class: 'input', type: 'number', inputmode: 'numeric', value: String(inch), oninput: (e) => { inch = +e.target.value || 0; sync(); } }),
          h('span', { class: 'sfx' }, 'in')),
      ));
    }
  };
  const renderWeight = () => {
    wField.replaceChildren();
    const isKg = state.weightUnit === 'kg';
    const shown = state.weight_kg == null ? '' : String(Math.round((isKg ? state.weight_kg : state.weight_kg * 2.20462) * 10) / 10);
    wField.append(h('div', { class: 'input-suffix' },
      h('input', { class: 'input', type: 'number', inputmode: 'decimal', placeholder: isKg ? 'e.g. 75' : 'e.g. 165', value: shown,
        oninput: (e) => { const v = +e.target.value; state.weight_kg = v ? (isKg ? v : lb2kg(v)) : null; } }),
      h('span', { class: 'sfx' }, state.weightUnit)));
  };

  const segH = seg([{ label: 'cm', value: 'cm' }, { label: 'ft / in', value: 'ftin' }], state.heightUnit, (v) => { state.heightUnit = v; renderHeight(); });
  const segW = seg([{ label: 'lb', value: 'lb' }, { label: 'kg', value: 'kg' }], state.weightUnit, (v) => { state.weightUnit = v; renderWeight(); });
  renderHeight(); renderWeight();

  body.append(
    h('h1', {}, 'Your measurements'),
    h('p', { class: 'lede' }, 'These power your calorie, protein and water targets.'),
    h('div', { class: 'field' }, h('label', {}, 'Height'), h('div', { class: 'flex' }, h('div', { class: 'grow' }, hField), h('div', { style: { width: '128px' } }, segH))),
    h('div', { class: 'field' }, h('label', {}, 'Current weight'), h('div', { class: 'flex' }, h('div', { class: 'grow' }, wField), h('div', { style: { width: '128px' } }, segW))),
    h('div', { style: { flex: 1 } }),
    footer({ next, back, canNext: () => {
      if (!(state.height_cm > 80 && state.height_cm < 260)) { toast('That height looks off.', 'bad'); return false; }
      if (!(state.weight_kg > 25 && state.weight_kg < 400)) { toast('Add your current weight.', 'bad'); return false; }
      return true;
    }})
  );

  function seg(options, value, onChange) {
    const el = h('div', { class: 'seg' });
    const render = (val) => el.replaceChildren(...options.map((o) =>
      h('button', { class: o.value === val ? 'on' : '', onclick: () => { render(o.value); onChange(o.value); } }, o.label)));
    render(value);
    return el;
  }
}

function stepActivity({ body, next, back }) {
  body.append(
    h('h1', {}, 'How active are you?'),
    h('p', { class: 'lede' }, 'Day-to-day, outside of intentional workouts too.'),
    choiceList([
      { value: 'sedentary', em: '🪑', label: 'Mostly sitting', sub: 'Desk job, little movement' },
      { value: 'light', em: '🚶', label: 'Lightly active', sub: 'Walks, training 1–3× a week' },
      { value: 'moderate', em: '🏃', label: 'Active', sub: 'Training 3–5× a week' },
      { value: 'very', em: '🔥', label: 'Very active', sub: 'Hard training 6–7× a week' },
      { value: 'extreme', em: '⚡', label: 'Athlete mode', sub: 'Physical job + hard training' },
    ], state.activity, (v) => { state.activity = v; }),
    h('div', { style: { flex: 1 } }),
    footer({ next, back, canNext: () => state.activity ? true : (toast('Pick your activity level.', 'bad'), false) })
  );
}

function stepGoal({ body, next, back }) {
  body.append(
    h('h1', {}, 'What’s the mission?'),
    h('p', { class: 'lede' }, 'This sets your calorie direction. You can change it anytime.'),
    choiceList([
      { value: 'lose', em: '📉', label: 'Lose fat', sub: 'Steady cut, roughly 1 lb a week' },
      { value: 'maintain', em: '⚖️', label: 'Maintain & recomp', sub: 'Hold weight, build strength' },
      { value: 'gain', em: '📈', label: 'Build muscle', sub: 'Lean bulk with a small surplus' },
    ], state.goal, (v) => { state.goal = v; }),
    h('div', { style: { flex: 1 } }),
    footer({ next, back, nextLabel: 'Calculate my targets', canNext: () => state.goal ? true : (toast('Pick a goal.', 'bad'), false) })
  );
}

async function stepReveal({ body, back }) {
  body.append(h('div', { class: 'center', style: { padding: '60px 0' } }, h('p', { class: 'muted' }, 'Crunching your numbers…')));
  let resp;
  try {
    resp = await api('/profile', { method: 'POST', body: {
      name: state.name.trim(), sex: state.sex, birthdate: state.birthdate,
      height_cm: Math.round(state.height_cm * 10) / 10, activity: state.activity, goal: state.goal,
      weight_kg: Math.round(state.weight_kg * 10) / 10, date: todayStr(),
    }});
    await api('/settings', { method: 'PUT', body: { weight_unit: state.weightUnit, height_unit: state.heightUnit } });
  } catch (e) {
    body.replaceChildren(h('p', { class: 'muted' }, e.message), footer({ next: () => stepReveal({ body, back }), back, nextLabel: 'Retry' }));
    return;
  }
  const t = resp.targets;
  const item = (emoji, label, value, sub, color) =>
    h('div', { class: 'card reveal-card', style: { display: 'flex', alignItems: 'center', gap: '14px' } },
      h('div', { class: 'row-ico', style: { background: `color-mix(in srgb, ${color} 16%, transparent)`, fontSize: '19px' } }, emoji),
      h('div', { class: 'grow' },
        h('div', { style: { fontSize: '13px', color: 'var(--text-2)', fontWeight: 650 } }, label),
        h('div', { style: { fontSize: '21px', fontWeight: 800, letterSpacing: '-0.02em' } }, value),
        sub ? h('div', { class: 'hint' }, sub) : null)
    );

  body.replaceChildren(
    h('h1', {}, `Here’s your plan, ${state.name.trim().split(' ')[0]}`),
    h('p', { class: 'lede' }, 'Computed with the Mifflin-St Jeor formula from your stats. Tune any of these later in Settings.'),
    h('div', {},
      item('🔥', 'Daily calories', `${fmtInt(t.calories)} kcal`, `Burn ≈${fmtInt(t.tdee)} · ${state.goal === 'lose' ? 'eat in a deficit' : state.goal === 'gain' ? 'small surplus' : 'hold steady'}`, cssVar('--c-carbs')),
      item('🥩', 'Protein', `${t.protein_g} g`, 'The muscle lever — hit this daily', cssVar('--c-protein')),
      item('💧', 'Water', `${Math.round(t.water_ml / 29.5735)} oz (${(t.water_ml / 1000).toFixed(1)} L)`, null, cssVar('--c-water')),
      item('🍬', 'Added sugar cap', `${t.sugar_g} g`, 'Try to stay under', cssVar('--c-sugar')),
      item('🧈', 'Carbs & fat', `${t.carbs_g} g · ${t.fat_g} g`, 'Flexible — protein and calories come first', cssVar('--c-fat')),
    ),
    h('div', { class: 'ob-foot' },
      h('button', { class: 'btn btn--primary btn--block', onclick: async () => { await App.start(); } }, 'Let’s climb ▲'))
  );
}
