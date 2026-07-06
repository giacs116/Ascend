// AI Form Check: record/upload a set, frames are extracted on-device, Claude coaches your technique.
import { h, todayStr, cssVar, fmtDay } from '../util.js';
import { api } from '../api.js';
import { ico, toast, sheet, spinner, emptyState } from '../ui.js';
import { ringMeter } from '../charts.js';
import { extractVideoFrames, imageFileToJpeg } from '../media.js';
import { App } from '../main.js';

const COMMON = ['Squat', 'Deadlift', 'Bench Press', 'Overhead Press', 'Barbell Row', 'Push-Up', 'Pull-Up', 'Hip Thrust'];

export async function renderFormCheck(root) {
  const view = h('div', { class: 'view' });
  root.replaceChildren(view);
  view.append(h('div', { class: 'vhead' },
    h('div', {}, h('h1', {}, 'Form Check'), h('div', { class: 'sub' }, 'Film a set — get coached on your technique')),
    h('div', { class: 'vhead-actions' }, h('button', { class: 'btn btn--icon', onclick: () => App.go('#/train') }, ico('chevL')))));

  if (!App.boot.settings.ai.hasKey) {
    view.append(h('div', { class: 'card card--accent center', style: { padding: '28px 18px' } },
      h('div', { style: { color: 'var(--accent)', display: 'flex', justifyContent: 'center', marginBottom: '10px' } }, ico('sparkles', 32)),
      h('h3', {}, 'The AI form coach needs a key'),
      h('p', { class: 'hint', style: { margin: '8px 0 16px' } },
        'Add your Anthropic API key in Settings, then film any lift and get specific, frame-by-frame technique feedback.'),
      h('button', { class: 'btn btn--primary', onclick: () => App.go('#/settings') }, 'Set up AI')));
    await renderHistory(view);
    return;
  }

  // ── Input form ─────────────────────────────────────────────
  const state = { exercise: '', frames: [], isVideo: false, busy: false };
  const exInput = h('input', { class: 'input', placeholder: 'Which exercise? e.g. Squat', maxlength: 60,
    oninput: (e) => { state.exercise = e.target.value; } });
  const chips = h('div', { class: 'chips', style: { marginTop: '10px' } },
    ...COMMON.map((c) => h('button', { class: 'chip', onclick: () => { state.exercise = c; exInput.value = c; } }, c)));
  const notes = h('input', { class: 'input', placeholder: 'Anything to flag? (optional — “knees cave on rep 3”)', maxlength: 200 });

  const mediaZone = h('div', {});
  const resultWrap = h('div', {});
  const fileInput = h('input', { type: 'file', accept: 'video/*,image/*', style: { display: 'none' } });

  const analyzeBtn = h('button', { class: 'btn btn--primary btn--block mt-14', disabled: true, onclick: analyze }, 'Analyze my form ✨');

  function renderMediaZone() {
    mediaZone.replaceChildren();
    if (!state.frames.length) {
      mediaZone.append(h('button', { class: 'photo-drop', style: { width: '100%' }, onclick: () => fileInput.click() },
        ico('video'), 'Record or choose a video (best) — or a photo',
        h('span', { class: 'small', style: { fontWeight: 500 } }, 'Tip: film from the side, whole body in frame, 1 set')));
    } else {
      mediaZone.append(
        h('div', { style: { display: 'flex', gap: '6px', overflowX: 'auto', padding: '4px 0' } },
          ...state.frames.map((f) => h('img', { src: f, style: { height: '84px', borderRadius: '10px', flexShrink: 0 } }))),
        h('div', { class: 'flex mt-8' },
          h('span', { class: 'small muted grow' }, `${state.frames.length} frame${state.frames.length > 1 ? 's' : ''} ready — nothing leaves your network except these small stills`),
          h('button', { class: 'btn btn--ghost btn--sm', onclick: () => { state.frames = []; analyzeBtn.disabled = true; renderMediaZone(); } }, 'Clear')));
    }
  }

  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    mediaZone.replaceChildren(h('div', { class: 'card center', style: { padding: '26px' } }, spinner(22), h('p', { class: 'muted small mt-8' }, 'Reading frames on your phone…')));
    try {
      if (file.type.startsWith('video/')) {
        state.frames = await extractVideoFrames(file, 6, 900);
        state.isVideo = true;
      } else {
        state.frames = [await imageFileToJpeg(file, 1024)];
        state.isVideo = false;
      }
      analyzeBtn.disabled = false;
    } catch (e) {
      toast(e.message, 'bad');
      state.frames = [];
    }
    fileInput.value = '';
    renderMediaZone();
  });

  async function analyze() {
    if (state.busy) return;
    if (!state.exercise.trim()) return toast('Tell me which exercise this is.', 'bad');
    state.busy = true;
    analyzeBtn.disabled = true;
    analyzeBtn.replaceChildren(spinner(), ' Coach is watching your set…');
    try {
      const result = await api('/ai/formcheck', { method: 'POST', body: {
        exercise: state.exercise.trim(), notes: notes.value.trim(),
        frames: state.frames, isVideo: state.isVideo, date: todayStr(),
      }});
      resultWrap.replaceChildren();
      renderResult(resultWrap, result);
      resultWrap.scrollIntoView({ behavior: 'smooth', block: 'start' });
      state.frames = [];
      renderMediaZone();
    } catch (e) { toast(e.message, 'bad', 3500); }
    state.busy = false;
    analyzeBtn.disabled = state.frames.length === 0;
    analyzeBtn.replaceChildren('Analyze my form ✨');
  }

  view.append(
    h('div', { class: 'card' },
      h('div', { class: 'field' }, h('label', {}, 'Exercise'), exInput, chips),
      h('div', { class: 'field', style: { marginTop: '14px' } }, h('label', {}, 'Media'), mediaZone, fileInput),
      h('div', { class: 'field' }, h('label', {}, 'Notes'), notes),
      analyzeBtn),
    resultWrap);
  renderMediaZone();
  await renderHistory(view);
}

function scoreColor(score) {
  return score >= 8 ? cssVar('--c-accent') : score >= 5 ? cssVar('--c-carbs') : cssVar('--c-fat');
}

function renderResult(el, r) {
  const color = scoreColor(r.score);
  el.append(h('div', { class: 'card pop' },
    h('div', { class: 'score-hero' },
      ringMeter({ size: 92, stroke: 9, pct: r.score / 10, color, value: r.score ? `${r.score}` : '—', sub: '/ 10' }),
      h('div', { class: 'grow' },
        h('h3', {}, r.exercise_detected || 'Form report'),
        h('p', { class: 'small', style: { color: 'var(--text-2)', marginTop: '4px', lineHeight: 1.5 } }, r.summary))),
    r.strengths?.length ? h('div', {},
      h('div', { class: 'section-label', style: { margin: '16px 2px 6px' } }, 'What’s working'),
      h('div', { class: 'fc-list' }, ...r.strengths.map((s) =>
        h('div', { class: 'fc-item' }, h('span', { style: { color: 'var(--c-accent)' } }, ico('check', 18)), h('span', {}, s))))) : null,
    r.improvements?.length ? h('div', {},
      h('div', { class: 'section-label', style: { margin: '16px 2px 6px' } }, 'Level up'),
      h('div', { class: 'fc-list' }, ...r.improvements.map((imp) =>
        h('div', { class: 'fc-item' }, h('span', { style: { color: 'var(--c-carbs)' } }, ico('trend', 18)),
          h('span', {}, imp.issue, h('span', { class: 'muted' }, ` — ${imp.why}`),
            h('span', { class: 'cue' }, 'Cue: ', h('b', {}, imp.cue))))))) : null,
    r.injury_flags?.length ? h('div', { class: 'card', style: { background: 'var(--danger-soft)', border: 'none', marginTop: '14px', marginBottom: 0 } },
      ...r.injury_flags.map((f) => h('div', { class: 'fc-item' }, h('span', { style: { color: 'var(--danger)' } }, ico('alert', 18)), h('span', { style: { fontSize: '13.5px' } }, f)))) : null,
    r.next_step ? h('div', { class: 'fc-item', style: { marginTop: '14px' } },
      h('span', { style: { color: 'var(--c-water)' } }, ico('zap', 18)),
      h('span', {}, h('b', {}, 'Next session: '), r.next_step)) : null,
  ));
}

async function renderHistory(view) {
  let data;
  try { data = await api('/ai/formchecks'); } catch { return; }
  view.append(h('div', { class: 'section-label' }, 'Past checks'));
  if (!data.checks.length) {
    view.append(h('div', { class: 'card' }, emptyState({ icon: 'video', title: 'No form checks yet', sub: 'Your analyses will be saved here so you can track technique over time.' })));
    return;
  }
  const card = h('div', { class: 'card card--flush' });
  for (const c of data.checks) {
    card.append(h('button', { class: 'row', onclick: () => {
      sheet({ title: `${c.exercise}`, build: (body) => { const wrap = h('div', {}); renderResult(wrap, c.feedback); body.append(wrap); } });
    } },
      c.thumb ? h('img', { src: c.thumb, style: { width: '44px', height: '44px', objectFit: 'cover', borderRadius: '10px', flexShrink: 0 } })
              : h('div', { class: 'row-ico', style: { background: 'var(--surface-2)' } }, ico('video')),
      h('div', { class: 'grow' }, h('div', { class: 't' }, c.exercise), h('div', { class: 's' }, fmtDay(c.date))),
      h('div', { class: 'v', style: { color: scoreColor(c.score) } }, c.score ? `${c.score}/10` : '—')));
  }
  view.append(card);
}
