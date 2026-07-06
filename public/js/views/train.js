// Train: start/resume workouts, live set logger with rest timer + PR detection,
// routines, quick cardio/sport logging, history and PRs.
import { h, todayStr, fmtDay, fmtInt, fmtClock, fmtElapsed, wDisp, wUnit, wParse, vibrate, round1, cssVar } from '../util.js';
import { api } from '../api.js';
import { ico, toast, sheet, confirmSheet, confetti, emptyState, spinner, stepperInput } from '../ui.js';
import { buildBodySvg } from '../body-svg.js';
import { renderScheduleSection } from './schedule.js';
import { App } from '../main.js';

const ACTIVE_KEY = 'ascend_active_wo';
const PENDING_KEY = 'ascend_pending_ex';

const activeWorkoutId = () => +localStorage.getItem(ACTIVE_KEY) || null;

// ── Train home ───────────────────────────────────────────────
export async function renderTrain(root) {
  const view = h('div', { class: 'view' });
  root.replaceChildren(view);
  view.append(h('div', { class: 'vhead' },
    h('div', {}, h('h1', {}, 'Train'), h('div', { class: 'sub' }, 'Lift, run, play — log it all')),
    h('div', { class: 'vhead-actions' },
      h('button', { class: 'btn btn--icon', title: 'Form check', onclick: () => App.go('#/formcheck') }, ico('video')))));

  if (activeWorkoutId()) {
    view.append(h('button', { class: 'card card--accent', style: { width: '100%', textAlign: 'left', display: 'flex', alignItems: 'center', gap: '12px' },
      onclick: () => App.go('#/workout') },
      h('div', { class: 'row-ico', style: { background: 'var(--accent-soft)', color: 'var(--accent)' } }, ico('play')),
      h('div', { class: 'grow' }, h('div', { style: { fontWeight: 750 } }, 'Workout in progress'), h('div', { class: 'hint' }, 'Tap to jump back in')),
      ico('chevR')));
  }

  view.append(h('div', { class: 'quick-actions', style: { gridTemplateColumns: '1fr 1fr 1fr', marginBottom: '4px' } },
    h('button', { class: 'qa qa--volt', onclick: () => startWorkout() }, h('span', { class: 'qa-ico' }, ico('barbell')), 'Empty workout'),
    h('button', { class: 'qa qa--orange', onclick: () => openQuickLog(() => renderTrain(root)) }, h('span', { class: 'qa-ico' }, ico('run')), 'Quick log'),
    h('button', { class: 'qa qa--violet', onclick: () => App.go('#/formcheck') }, h('span', { class: 'qa-ico' }, ico('video')), 'Form check'),
  ));

  let prs = { prs: [] }, history = { workouts: [] }, muscles = null;
  try {
    [prs, history, muscles] = await Promise.all([
      api('/prs'), api('/workouts?limit=12'), api(`/muscles?today=${todayStr()}`),
    ]);
  } catch (e) { toast(e.message, 'bad'); }

  // Muscle map hero
  if (muscles) {
    const keys = Object.keys(muscles.muscles);
    const trained = keys.filter((k) => muscles.muscles[k].sets > 0);
    const statusFor = (k) => (muscles.muscles[k].sets > 0 ? 'on' : 'off');
    view.append(h('button', { class: 'card', style: { width: '100%', textAlign: 'left', marginTop: '12px' }, onclick: () => App.go('#/body') },
      h('div', { class: 'flex', style: { marginBottom: '6px' } },
        h('div', { class: 'grow' },
          h('h3', {}, 'Muscle map'),
          h('div', { class: 'hint' }, trained.length
            ? `${trained.length} of ${keys.length} groups trained this week`
            : 'Fresh week — everything is waiting')),
        ico('chevR')),
      h('div', { class: 'body-mini-wrap' },
        buildBodySvg('front', statusFor, { mini: true }),
        buildBodySvg('back', statusFor, { mini: true }))));
  }

  // Workout schedule calendar (plans are managed from inside it)
  renderScheduleSection(view);

  // PRs
  if (prs.prs.length) {
    view.append(h('div', { class: 'section-label' }, 'Personal records',
      h('button', { class: 'lnk', style: { color: 'var(--accent)', fontWeight: 600 }, onclick: () => openAllPrs(prs.prs) }, 'All')));
    const prCard = h('div', { class: 'card card--flush' });
    for (const p of prs.prs.slice(0, 4)) {
      prCard.append(h('div', { class: 'row' },
        h('div', { class: 'row-ico', style: { background: 'color-mix(in srgb, var(--c-carbs) 16%, transparent)', color: 'var(--c-carbs)' } }, ico('trophy')),
        h('div', { class: 'grow' }, h('div', { class: 't' }, p.name), h('div', { class: 's' }, `est. 1RM ${wDisp(p.best_est)} ${wUnit()}`)),
        h('div', { class: 'v' }, `${wDisp(p.best_weight)}`, h('span', { class: 'u' }, `${wUnit()} × ${p.best_reps}`))));
    }
    view.append(prCard);
  }

  // History
  view.append(h('div', { class: 'section-label' }, 'History'));
  if (!history.workouts.length) {
    view.append(h('div', { class: 'card' }, emptyState({ icon: 'barbell', title: 'No workouts yet', sub: 'Start your first session — the mountain isn’t going to climb itself.' })));
  } else {
    const hCard = h('div', { class: 'card card--flush' });
    for (const w of history.workouts) {
      const bits = [];
      if (w.set_count) bits.push(`${w.set_count} sets`);
      if (w.volume_kg > 0) bits.push(`${fmtInt(wDisp(w.volume_kg, 0))} ${wUnit()} volume`);
      if (w.duration_min) bits.push(`${Math.round(w.duration_min)} min`);
      hCard.append(h('button', { class: 'row', onclick: () => openWorkoutDetail(w.id, () => renderTrain(root)) },
        h('div', { class: 'grow' },
          h('div', { class: 't' }, w.name || (w.type === 'strength' ? 'Workout' : w.type)),
          h('div', { class: 's' }, `${fmtDay(w.date)}${bits.length ? ' · ' + bits.join(' · ') : ''}`)),
        ico('chevR')));
    }
    view.append(hCard);
  }
}

// ── Start / resume ───────────────────────────────────────────
export async function startWorkout({ routine } = {}) {
  if (activeWorkoutId()) { App.go('#/workout'); return; }
  try {
    const r = await api('/workouts', { method: 'POST', body: { date: todayStr(), name: routine?.name || null, type: 'strength' } });
    localStorage.setItem(ACTIVE_KEY, String(r.id));
    localStorage.setItem(PENDING_KEY, JSON.stringify(routine ? routine.items.map((i) => ({ id: i.exercise_id, name: i.name, target: `${i.target_sets}×${i.target_reps}` })) : []));
    App.go('#/workout');
  } catch (e) { toast(e.message, 'bad'); }
}

// ── Live workout logger ──────────────────────────────────────
export async function renderWorkout(root) {
  const id = activeWorkoutId();
  if (!id) { App.go('#/train'); return; }
  const view = h('div', { class: 'view' });
  root.replaceChildren(view);

  let data;
  try { data = await api(`/workouts/${id}`); }
  catch { localStorage.removeItem(ACTIVE_KEY); App.go('#/train'); return; }

  const pending = JSON.parse(localStorage.getItem(PENDING_KEY) || '[]');
  // blocks: [{id, name, category, target?, sets: [loggedSet...]}]
  const blocks = [];
  const blockFor = (exId, name, category, target) => {
    let b = blocks.find((x) => x.id === exId);
    if (!b) { b = { id: exId, name, category, target, sets: [] }; blocks.push(b); }
    return b;
  };
  for (const s of data.sets) blockFor(s.exercise_id, s.exercise_name, s.exercise_category).sets.push(s);
  for (const p of pending) blockFor(p.id, p.name, 'strength', p.target);

  let prCount = 0; // PRs are detected as sets are logged
  const startedAt = new Date(data.workout.started_at || data.workout.created_at).getTime();

  // Sticky bar
  const elapsedEl = h('span', { class: 'elapsed' }, '0:00');
  const timerInt = setInterval(() => {
    if (!document.body.contains(elapsedEl)) return clearInterval(timerInt);
    elapsedEl.textContent = fmtElapsed((Date.now() - startedAt) / 1000);
  }, 1000);
  view.append(h('div', { class: 'wo-live-bar' },
    h('button', { class: 'btn btn--icon', onclick: async () => {
      const ok = await confirmSheet({ title: 'Discard workout?', message: 'This deletes the session and its sets.', confirmLabel: 'Discard', danger: true });
      if (ok) { await api(`/workouts/${id}`, { method: 'DELETE' }); cleanup(); App.go('#/train'); }
    } }, ico('trash')),
    h('div', { class: 't' }, data.workout.name || 'Workout'),
    elapsedEl,
    h('button', { class: 'btn btn--primary btn--sm', onclick: finish }, 'Finish')));

  const blocksWrap = h('div', {});
  view.append(blocksWrap);
  view.append(h('button', { class: 'btn btn--ghost btn--block mt-8', onclick: () => openExercisePicker((ex) => { blockFor(ex.id, ex.name, ex.category); renderBlocks(); }) },
    ico('plus'), 'Add exercise'));

  function cleanup() {
    clearInterval(timerInt);
    localStorage.removeItem(ACTIVE_KEY);
    localStorage.removeItem(PENDING_KEY);
    stopRest();
  }

  async function finish() {
    const durMin = Math.max(1, Math.round((Date.now() - startedAt) / 60000));
    const volume = blocks.flatMap((b) => b.sets).reduce((a, s) => a + (s.reps && s.weight_kg ? s.reps * s.weight_kg : 0), 0);
    const setCount = blocks.reduce((a, b) => a + b.sets.length, 0);
    if (!setCount) {
      const ok = await confirmSheet({ title: 'No sets logged', message: 'Finish anyway? The empty session will be discarded.', confirmLabel: 'Discard session', danger: true });
      if (ok) { await api(`/workouts/${id}`, { method: 'DELETE' }); cleanup(); App.go('#/train'); }
      return;
    }
    await api(`/workouts/${id}`, { method: 'PUT', body: { ended_at: new Date().toISOString(), duration_min: durMin } });
    cleanup();
    sheet({
      title: 'Workout complete 🎉',
      onClose: () => App.go('#/train'),
      build: (body, { close }) => {
        body.append(
          h('div', { class: 'tiles', style: { marginBottom: '14px' } },
            statTile('Duration', `${durMin}`, 'min'),
            statTile('Sets', `${setCount}`, ''),
            statTile('Volume', `${fmtInt(wDisp(volume, 0))}`, wUnit()),
            statTile('PRs', `${prCount}`, prCount ? '🏆' : '')),
          h('button', { class: 'btn btn--primary btn--block', onclick: () => close() }, 'Done'));
      },
    });
    if (prCount > 0) confetti();
  }

  const statTile = (label, value, unit) => h('div', { class: 'tile' },
    h('div', { class: 'label' }, label),
    h('div', { class: 'value' }, value, unit ? h('span', { class: 'u' }, ` ${unit}`) : null));

  function renderBlocks() {
    blocksWrap.replaceChildren();
    if (!blocks.length) {
      blocksWrap.append(h('div', { class: 'card' }, emptyState({ icon: 'barbell', title: 'Add your first exercise', sub: 'Search the library or create your own.' })));
    }
    for (const b of blocks) blocksWrap.append(renderBlock(b));
  }

  function renderBlock(b) {
    const isCardio = b.category === 'cardio' || b.category === 'sport' || b.category === 'mobility';
    const card = h('div', { class: 'card ex-block' });
    card.append(h('div', { class: 'exb-head' },
      h('div', {}, h('div', { class: 'exb-name' }, b.name), b.target ? h('div', { class: 'exb-sub' }, `target ${b.target}`) : null),
      h('div', { class: 'exb-sub' }, b.sets.length ? `${b.sets.length} set${b.sets.length > 1 ? 's' : ''}` : '')));
    card.append(h('div', { class: 'set-cols' },
      h('span', {}, 'Set'),
      h('span', {}, isCardio ? 'Min' : wUnit()),
      h('span', {}, isCardio ? (wUnit() === 'kg' ? 'Km' : 'Mi') : 'Reps'),
      h('span', {}, '✓')));

    // logged sets (read-only rows)
    b.sets.forEach((s, i) => {
      card.append(h('div', { class: 'set-row' },
        h('div', { class: `sn${s._pr ? ' pr' : ''}` }, s._pr ? '★' : String(i + 1)),
        h('input', { value: isCardio ? (s.duration_sec ? String(Math.round(s.duration_sec / 60)) : '—') : String(wDisp(s.weight_kg ?? 0)), disabled: true }),
        h('input', { value: isCardio ? (s.distance_m ? String(round1(s.distance_m / (wUnit() === 'kg' ? 1000 : 1609.34))) : '—') : String(s.reps ?? 0), disabled: true }),
        h('div', { class: 'done-btn on' }, ico('check'))));
    });

    // entry row
    const prev = b.sets[b.sets.length - 1];
    const in1 = h('input', { type: 'number', inputmode: 'decimal', placeholder: isCardio ? '30' : (prev?.weight_kg != null ? String(wDisp(prev.weight_kg)) : '0') });
    const in2 = h('input', { type: 'number', inputmode: 'decimal', placeholder: isCardio ? (wUnit() === 'kg' ? 'km' : 'mi') : (prev?.reps != null ? String(prev.reps) : '10') });
    const logBtn = h('button', { class: 'done-btn', onclick: async () => {
      const v1 = in1.value !== '' ? +in1.value : +in1.placeholder || 0;
      const v2 = in2.value !== '' ? +in2.value : (isCardio ? 0 : +in2.placeholder || 0);
      const body = { exercise_id: b.id };
      if (isCardio) {
        if (!v1) return toast('How many minutes?', 'bad');
        body.duration_sec = v1 * 60;
        if (v2) body.distance_m = v2 * (wUnit() === 'kg' ? 1000 : 1609.34);
      } else {
        if (!v2) return toast('How many reps?', 'bad');
        body.reps = v2;
        body.weight_kg = v1 ? wParse(v1) : null;
      }
      logBtn.replaceChildren(spinner(16));
      try {
        const r = await api(`/workouts/${id}/sets`, { method: 'POST', body });
        vibrate(12);
        b.sets.push({ ...body, id: r.id, _pr: r.is_pr, exercise_name: b.name });
        if (r.is_pr) { prCount++; confetti(); toast(`New ${b.name} PR — est. 1RM ${wDisp(r.est_1rm)} ${wUnit()} 🏆`, 'good', 3200); }
        if (!isCardio) startRest();
        renderBlocks();
      } catch (e) { toast(e.message, 'bad'); logBtn.replaceChildren(ico('check')); }
    } }, ico('check'));
    card.append(h('div', { class: 'set-row' },
      h('div', { class: 'sn' }, String(b.sets.length + 1)), in1, in2, logBtn));
    return card;
  }

  renderBlocks();

  // ── Rest timer ─────────────────────────────────────────────
  let restInt = null, restLeft = 0, restPill = null;
  function stopRest() { clearInterval(restInt); restPill?.remove(); restPill = null; }
  function startRest(sec = 90) {
    stopRest();
    restLeft = sec;
    const timeEl = h('span', { class: 'rt' }, fmtClock(restLeft));
    restPill = h('div', { class: 'rest-pill' },
      h('div', {}, h('div', { class: 'rl' }, 'Rest'), timeEl),
      h('button', { onclick: () => { restLeft += 30; timeEl.textContent = fmtClock(restLeft); } }, '+30'),
      h('button', { onclick: stopRest }, ico('x')));
    document.body.append(restPill);
    restInt = setInterval(() => {
      restLeft--;
      if (restLeft <= 0) { stopRest(); vibrate([80, 60, 80, 60, 160]); toast('Rest over — next set 💪', 'good'); return; }
      timeEl.textContent = fmtClock(restLeft);
    }, 1000);
  }

  // stop the timer if we navigate away
  const onHash = () => { if (!location.hash.startsWith('#/workout')) { clearInterval(timerInt); stopRest(); removeEventListener('hashchange', onHash); } };
  addEventListener('hashchange', onHash);
}

// ── Exercise picker ──────────────────────────────────────────
export function openExercisePicker(onPick, { categories = null } = {}) {
  sheet({
    title: 'Pick exercise',
    build: (body, { close }) => {
      const input = h('input', { class: 'input', placeholder: 'Search exercises…' });
      const cats = categories || ['strength', 'bodyweight', 'cardio', 'sport', 'mobility'];
      let cat = '';
      const chips = h('div', { class: 'chips', style: { margin: '12px 0' } });
      const list = h('div', { class: 'card card--flush', style: { maxHeight: '48dvh', overflowY: 'auto' } });
      const renderChips = () => chips.replaceChildren(
        h('button', { class: `chip${cat === '' ? ' on' : ''}`, onclick: () => { cat = ''; renderChips(); load(); } }, 'All'),
        ...cats.map((c) => h('button', { class: `chip${cat === c ? ' on' : ''}`, onclick: () => { cat = c; renderChips(); load(); } }, c[0].toUpperCase() + c.slice(1))));
      async function load() {
        const q = input.value.trim();
        const r = await api(`/exercises?${q ? `q=${encodeURIComponent(q)}` : `category=${cat}`}`);
        let rows = r.exercises;
        if (q && cat) rows = rows.filter((e) => e.category === cat);
        if (!categories && !q && !cat) rows = r.exercises;
        list.replaceChildren();
        for (const ex of rows) {
          list.append(h('button', { class: 'row', onclick: () => { close(); onPick(ex); } },
            h('div', { class: 'grow' }, h('div', { class: 't' }, ex.name), h('div', { class: 's' }, [ex.category, ex.muscle, ex.equipment].filter(Boolean).join(' · '))),
            ico('plus', 18)));
        }
        if (q) {
          list.append(h('button', { class: 'row', style: { color: 'var(--accent)' }, onclick: async () => {
            const created = await api('/exercises', { method: 'POST', body: { name: q, category: cat || 'strength' } });
            close(); onPick({ id: created.id, name: q, category: cat || 'strength' });
          } }, h('span', { style: { display: 'flex' } }, ico('plus', 18)), h('span', { class: 'grow', style: { fontWeight: 650 } }, `Create “${q}”`)));
        }
      }
      let deb;
      input.addEventListener('input', () => { clearTimeout(deb); deb = setTimeout(load, 200); });
      renderChips();
      body.append(input, chips, list);
      load();
    },
  });
}

// ── Quick log (cardio / sport) ───────────────────────────────
function openQuickLog(onDone) {
  sheet({
    title: 'Quick log',
    build: (body, { close }) => {
      let picked = null;
      const pickedEl = h('button', { class: 'input', style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' }, onclick: () =>
        openExercisePicker((ex) => { picked = ex; pickedEl.firstChild.textContent = ex.name; }, { categories: ['cardio', 'sport', 'mobility'] }) },
        h('span', { class: 'muted' }, 'Choose activity…'), ico('chevD', 17));
      const dur = h('input', { class: 'input', type: 'number', inputmode: 'numeric', placeholder: '30' });
      const dist = h('input', { class: 'input', type: 'number', inputmode: 'decimal', placeholder: wUnit() === 'kg' ? 'optional km' : 'optional miles' });
      body.append(
        h('div', { class: 'field' }, h('label', {}, 'Activity'), pickedEl),
        h('div', { class: 'input-row' },
          h('div', { class: 'field' }, h('label', {}, 'Minutes'), dur),
          h('div', { class: 'field' }, h('label', {}, `Distance (${wUnit() === 'kg' ? 'km' : 'mi'})`), dist)),
        h('button', { class: 'btn btn--primary btn--block', onclick: async () => {
          if (!picked) return toast('Pick an activity.', 'bad');
          const minutes = +dur.value;
          if (!minutes) return toast('How long did you go?', 'bad');
          const w = await api('/workouts', { method: 'POST', body: { date: todayStr(), name: picked.name, type: picked.category, duration_min: minutes } });
          const setBody = { exercise_id: picked.id, duration_sec: minutes * 60 };
          if (+dist.value) setBody.distance_m = +dist.value * (wUnit() === 'kg' ? 1000 : 1609.34);
          await api(`/workouts/${w.id}/sets`, { method: 'POST', body: setBody });
          await api(`/workouts/${w.id}`, { method: 'PUT', body: { ended_at: new Date().toISOString() } });
          toast(`${picked.name} logged 🔥`, 'good');
          close(); onDone?.();
        } }, 'Log it'));
    },
  });
}

// ── Detail & PRs ─────────────────────────────────────────────
function openWorkoutDetail(id, onChange) {
  sheet({
    title: 'Workout',
    build: async (body, { close }) => {
      const d = await api(`/workouts/${id}`);
      const w = d.workout;
      body.append(h('p', { class: 'muted small', style: { marginBottom: '12px' } },
        `${fmtDay(w.date)} · ${w.set_count} sets${w.volume_kg ? ` · ${fmtInt(wDisp(w.volume_kg, 0))} ${wUnit()} volume` : ''}${w.duration_min ? ` · ${Math.round(w.duration_min)} min` : ''}`));
      const groups = new Map();
      for (const s of d.sets) {
        if (!groups.has(s.exercise_name)) groups.set(s.exercise_name, []);
        groups.get(s.exercise_name).push(s);
      }
      for (const [name, sets] of groups) {
        const card = h('div', { class: 'card', style: { padding: '12px 14px' } }, h('h3', { style: { marginBottom: '6px' } }, name));
        for (const s of sets) {
          const desc = s.duration_sec
            ? `${Math.round(s.duration_sec / 60)} min${s.distance_m ? ` · ${round1(s.distance_m / (wUnit() === 'kg' ? 1000 : 1609.34))} ${wUnit() === 'kg' ? 'km' : 'mi'}` : ''}`
            : `${s.weight_kg != null ? `${wDisp(s.weight_kg)} ${wUnit()} × ` : ''}${s.reps} reps`;
          card.append(h('div', { class: 'small', style: { padding: '3px 0', color: 'var(--text-2)', fontVariantNumeric: 'tabular-nums' } }, `Set ${s.set_index} — ${desc}`));
        }
        body.append(card);
      }
      body.append(h('button', { class: 'btn btn--danger btn--block mt-8', onclick: async () => {
        const ok = await confirmSheet({ title: 'Delete workout?', confirmLabel: 'Delete', danger: true });
        if (ok) { await api(`/workouts/${id}`, { method: 'DELETE' }); close(); onChange?.(); toast('Deleted'); }
      } }, 'Delete workout'));
    },
  });
}

// ── Routine builder (create / edit your own plan) ────────────
export function openRoutineBuilder(routine, onDone) {
  const items = routine ? routine.items.map((i) => ({ ...i })) : [];
  sheet({
    title: routine ? 'Edit plan' : 'New workout plan',
    build: (body, { close }) => {
      const nameInput = h('input', { class: 'input', placeholder: 'Plan name — e.g. Upper A', value: routine?.name || '', maxlength: 60 });
      const list = h('div', {});

      const render = () => {
        list.replaceChildren();
        if (!items.length) {
          list.append(h('p', { class: 'muted small center', style: { padding: '14px 0' } }, 'Add exercises to build your plan.'));
        }
        items.forEach((it, i) => {
          const setsIn = h('input', { class: 'rb-num', type: 'number', inputmode: 'numeric', value: String(it.target_sets || 3),
            oninput: (e) => { it.target_sets = Math.max(1, +e.target.value || 3); } });
          const repsIn = h('input', { class: 'rb-num rb-num--wide', type: 'text', value: it.target_reps || '8-12', maxlength: 8,
            oninput: (e) => { it.target_reps = e.target.value; } });
          list.append(h('div', { class: 'rb-row' },
            h('div', { class: 'rb-move' },
              h('button', { disabled: i === 0, onclick: () => { [items[i - 1], items[i]] = [items[i], items[i - 1]]; render(); } }, '▲'),
              h('button', { disabled: i === items.length - 1, onclick: () => { [items[i + 1], items[i]] = [items[i], items[i + 1]]; render(); } }, '▼')),
            h('div', { class: 'grow', style: { minWidth: 0 } },
              h('div', { style: { fontWeight: 700, fontSize: '14px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, it.name),
              h('div', { class: 'flex', style: { gap: '6px', marginTop: '5px' } }, setsIn, h('span', { class: 'small muted' }, '×'), repsIn)),
            h('button', { class: 'btn btn--icon', style: { width: '36px', height: '36px' }, onclick: () => { items.splice(i, 1); render(); } }, ico('x', 15))));
        });
      };
      render();

      body.append(
        h('div', { class: 'field' }, nameInput),
        list,
        h('button', { class: 'btn btn--ghost btn--block mt-8', onclick: () =>
          openExercisePicker((ex) => { items.push({ exercise_id: ex.id, name: ex.name, target_sets: 3, target_reps: '8-12' }); render(); }) },
          ico('plus'), 'Add exercise'),
        h('button', { class: 'btn btn--primary btn--block mt-8', onclick: async () => {
          const name = nameInput.value.trim();
          if (!name) return toast('Give the plan a name.', 'bad');
          if (!items.length) return toast('Add at least one exercise.', 'bad');
          const payload = { name, items: items.map((i) => ({ exercise_id: i.exercise_id, target_sets: i.target_sets || 3, target_reps: i.target_reps || '8-12' })) };
          if (routine) await api(`/routines/${routine.id}`, { method: 'PUT', body: payload });
          else await api('/routines', { method: 'POST', body: payload });
          toast(routine ? 'Plan updated' : 'Plan created 💪', 'good');
          close(); onDone?.();
        } }, routine ? 'Save changes' : 'Create plan'),
      );
      if (routine) {
        body.append(h('button', { class: 'btn btn--danger btn--block mt-8', onclick: async () => {
          const ok = await confirmSheet({ title: `Delete “${routine.name}”?`, confirmLabel: 'Delete plan', danger: true });
          if (ok) { await api(`/routines/${routine.id}`, { method: 'DELETE' }); close(); onDone?.(); toast('Plan deleted'); }
        } }, 'Delete plan'));
      }
    },
  });
}

function openAllPrs(prs) {
  sheet({
    title: 'Personal records',
    build: (body) => {
      const card = h('div', { class: 'card card--flush' });
      for (const p of prs) {
        card.append(h('div', { class: 'row' },
          h('div', { class: 'grow' }, h('div', { class: 't' }, p.name), h('div', { class: 's' }, p.date)),
          h('div', { class: 'v' }, p.best_est ? `${wDisp(p.best_est)}` : `${p.best_reps || '—'}`,
            h('span', { class: 'u' }, p.best_est ? `${wUnit()} est 1RM` : 'reps'))));
      }
      body.append(card);
    },
  });
}
