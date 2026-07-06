// Workout schedule: a month calendar where you plan sessions and rest days.
// Markers show the full story — planned, done, missed, rest — and weekly rules
// (e.g. "every Sunday = rest") fill in automatically.
import { h, todayStr, localDateStr, fmtDay, vibrate } from '../util.js';
import { api } from '../api.js';
import { ico, toast, sheet, confirmSheet } from '../ui.js';
import { App } from '../main.js';
import { openRoutineBuilder, startWorkout } from './train.js';

const DOW_FULL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
let cursor = null; // {y, m} — remembered while the app is open

export function renderScheduleSection(view) {
  const today = todayStr();
  if (!cursor) {
    const d = new Date(today + 'T12:00:00');
    cursor = { y: d.getFullYear(), m: d.getMonth() };
  }

  view.append(h('div', { class: 'section-label' }, 'Schedule',
    h('button', { class: 'lnk', style: { color: 'var(--accent)', fontWeight: 600 }, onclick: () => openPlansManager() }, 'My plans')));
  const card = h('div', { class: 'card' });
  view.append(card);

  async function load() {
    const first = new Date(cursor.y, cursor.m, 1);
    const startPad = first.getDay();
    const daysInMonth = new Date(cursor.y, cursor.m + 1, 0).getDate();
    const rows = Math.ceil((startPad + daysInMonth) / 7);
    const cells = [];
    for (let i = 0; i < rows * 7; i++) {
      cells.push(localDateStr(new Date(cursor.y, cursor.m, 1 - startPad + i)));
    }
    const from = cells[0], to = cells[cells.length - 1];

    let data;
    try { data = await api(`/schedule?from=${from}&to=${to}`); }
    catch (e) { card.replaceChildren(h('p', { class: 'muted small' }, e.message)); return; }

    const monthTitle = first.toLocaleString('en-US', { month: 'long', year: 'numeric' });
    const grid = h('div', { class: 'cal-grid' });
    for (const d of cells) {
      const inMonth = d.slice(0, 7) === `${cursor.y}-${String(cursor.m + 1).padStart(2, '0')}`;
      const entry = data.days[d];
      const done = (data.workouts[d] || 0) > 0;
      const isToday = d === today;
      const past = d < today;

      let mark = null;
      if (done) mark = h('span', { class: 'cal-check' }, ico('check', 12));
      else if (entry?.kind === 'rest') mark = h('span', { class: 'cal-rest' }, ico('moon', 10));
      else if (entry?.kind === 'workout') mark = h('span', { class: `cal-dot ${past ? 'missed' : 'planned'}` });

      grid.append(h('button', {
        class: `cal-cell${inMonth ? '' : ' other'}${isToday ? ' today' : ''}`,
        onclick: () => { vibrate(6); openDaySheet(d, load); },
      },
        h('span', {}, String(+d.slice(8, 10))),
        h('span', { class: 'cal-mark' }, mark)));
    }

    card.replaceChildren(
      h('div', { class: 'cal-head' },
        h('button', { class: 'btn btn--icon', onclick: () => { cursor.m--; if (cursor.m < 0) { cursor.m = 11; cursor.y--; } load(); } }, ico('chevL')),
        h('div', { class: 'cal-title' }, monthTitle),
        h('button', { class: 'btn btn--icon', onclick: () => { cursor.m++; if (cursor.m > 11) { cursor.m = 0; cursor.y++; } load(); } }, ico('chevR'))),
      h('div', { class: 'cal-dow' }, ...['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((s) => h('span', {}, s))),
      grid,
      h('div', { class: 'cal-legend' },
        h('span', { class: 'lg' }, h('span', { class: 'cal-dot planned' }), 'planned'),
        h('span', { class: 'lg' }, h('span', { class: 'cal-check' }, ico('check', 11)), 'done'),
        h('span', { class: 'lg' }, h('span', { class: 'cal-dot missed' }), 'missed'),
        h('span', { class: 'lg' }, h('span', { class: 'cal-rest' }, ico('moon', 10)), 'rest')),
      h('p', { class: 'small muted', style: { marginTop: '10px', lineHeight: 1.5 } },
        'Tap a day to plan a workout or mark it as rest. Turn on “repeat weekly” to set your routine — like rest every Sunday.'));
  }
  load();
}

// ── Day editor ───────────────────────────────────────────────
async function openDaySheet(date, onChanged) {
  const today = todayStr();
  const dow = new Date(date + 'T12:00:00').getDay();
  let routines = [];
  try { routines = (await api('/routines')).routines; } catch {}
  let dayData = null;
  try {
    const r = await api(`/schedule?from=${date}&to=${date}`);
    dayData = { entry: r.days[date] || null, done: (r.workouts[date] || 0) > 0 };
  } catch { dayData = { entry: null, done: false }; }

  sheet({
    title: fmtDay(date, { withYear: true }),
    build: (body, { close }) => {
      // selection state
      let sel = null; // {kind, label, routine_id}
      if (dayData.entry) sel = { kind: dayData.entry.kind, label: dayData.entry.label, routine_id: dayData.entry.routine_id };
      let weekly = dayData.entry?.source === 'weekly';

      if (dayData.done) {
        body.append(h('div', { class: 'card', style: { background: 'var(--accent-soft)', border: 'none', padding: '12px 15px', display: 'flex', gap: '10px', alignItems: 'center' } },
          h('span', { style: { color: 'var(--accent)', display: 'flex' } }, ico('check', 19)),
          h('span', { class: 'small', style: { fontWeight: 650 } }, 'Workout logged on this day 💪')));
      }

      const options = h('div', { class: 'chips', style: { marginBottom: '6px' } });
      const customInput = h('input', { class: 'input', placeholder: 'Or type your own… e.g. “5k easy run”', maxlength: 60,
        oninput: () => { if (customInput.value.trim()) { sel = { kind: 'workout', label: customInput.value.trim(), routine_id: null }; renderChips(); } } });

      const renderChips = () => {
        options.replaceChildren(
          ...routines.map((r) => h('button', {
            class: `chip${sel?.routine_id === r.id ? ' on' : ''}`,
            onclick: () => { sel = { kind: 'workout', label: r.name, routine_id: r.id }; customInput.value = ''; renderChips(); },
          }, `💪 ${r.name}`)),
          h('button', {
            class: `chip${sel?.kind === 'rest' ? ' on' : ''}`,
            onclick: () => { sel = { kind: 'rest', label: null, routine_id: null }; customInput.value = ''; renderChips(); },
          }, '😌 Rest day'),
        );
        weeklyChip.classList.toggle('on', weekly);
        saveBtn.disabled = !sel;
        saveBtn.textContent = !sel ? 'Pick an option above'
          : sel.kind === 'rest' ? (weekly ? `Rest every ${DOW_FULL[dow]}` : 'Set as rest day')
          : weekly ? `Every ${DOW_FULL[dow]}: ${sel.label || 'Workout'}` : `Plan: ${sel.label || 'Workout'}`;
      };

      const weeklyChip = h('button', { class: 'chip', onclick: () => { weekly = !weekly; renderChips(); } }, `🔁 Repeat every ${DOW_FULL[dow]}`);

      const saveBtn = h('button', { class: 'btn btn--primary btn--block mt-14', onclick: async () => {
        if (!sel) return;
        if (customInput.value.trim()) sel = { kind: 'workout', label: customInput.value.trim(), routine_id: null };
        try {
          if (weekly) {
            await api('/schedule/weekly', { method: 'PUT', body: { dow, ...sel } });
            await api(`/schedule/day?date=${date}`, { method: 'DELETE' }); // let the weekly rule show through
          } else {
            await api('/schedule/day', { method: 'PUT', body: { date, ...sel } });
          }
          toast('Schedule updated 📅', 'good');
          close(); onChanged?.();
        } catch (e) { toast(e.message, 'bad'); }
      } }, 'Save');

      const parts = [
        h('div', { class: 'field' }, h('label', {}, 'What’s the plan?'), options, customInput),
        h('div', { style: { margin: '10px 0 2px' } }, weeklyChip),
      ];
      if (dayData.entry?.source === 'weekly') {
        parts.push(h('p', { class: 'small muted', style: { marginTop: '8px' } },
          `Currently set by your weekly rule for ${DOW_FULL[dow]}s.`));
      }
      parts.push(saveBtn);
      body.append(...parts);
      if (sel?.label && !sel.routine_id) customInput.value = sel.label;
      renderChips();

      // start now (today + a saved plan)
      const routineFor = routines.find((r) => r.id === dayData.entry?.routine_id);
      if (date === today && routineFor && !dayData.done) {
        body.append(h('button', { class: 'btn btn--soft btn--block mt-8', onclick: () => { close(); startWorkout({ routine: routineFor }); } },
          ico('play', 17), `Start ${routineFor.name} now`));
      }

      // clear
      if (dayData.entry) {
        body.append(h('button', { class: 'btn btn--ghost btn--block mt-8', onclick: async () => {
          if (dayData.entry.source === 'weekly') {
            const ok = await confirmSheet({ title: `Remove the weekly ${DOW_FULL[dow]} rule?`, message: 'This clears it for every week, not just this date.', confirmLabel: 'Remove weekly rule', danger: true });
            if (!ok) return;
            await api(`/schedule/weekly?dow=${dow}`, { method: 'DELETE' });
          } else {
            await api(`/schedule/day?date=${date}`, { method: 'DELETE' });
          }
          toast('Cleared', 'good');
          close(); onChanged?.();
        } }, dayData.entry.source === 'weekly' ? `Remove weekly ${DOW_FULL[dow]} rule` : 'Clear this day'));
      }
    },
  });
}

// ── Plans manager (create / edit / start saved plans) ────────
export function openPlansManager() {
  sheet({
    title: 'My plans',
    build: async (body, { close }) => {
      const list = h('div', {});
      const load = async () => {
        const { routines } = await api('/routines');
        list.replaceChildren();
        if (!routines.length) {
          list.append(h('p', { class: 'muted small center', style: { padding: '12px 0' } }, 'No plans yet — create your first below.'));
        }
        const card = h('div', { class: 'card card--flush' });
        for (const r of routines) {
          card.append(h('div', { class: 'row', style: { padding: '9px 10px 9px 16px' } },
            h('div', { class: 'grow', style: { minWidth: 0 } },
              h('div', { class: 't' }, r.name),
              h('div', { class: 's', style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, r.items.map((i) => i.name).join(' · '))),
            h('button', { class: 'btn btn--icon', style: { width: '38px', height: '38px', flexShrink: 0 }, onclick: () => openRoutineBuilder(r, load) }, ico('edit', 16)),
            h('button', { class: 'btn btn--icon', style: { width: '38px', height: '38px', flexShrink: 0 }, onclick: () => { close(); startWorkout({ routine: r }); } }, ico('play', 16))));
        }
        if (routines.length) list.append(card);
      };
      await load();
      body.append(
        h('p', { class: 'small muted', style: { marginBottom: '12px', lineHeight: 1.5 } }, 'Plans are reusable workouts you can schedule on the calendar or start any time.'),
        list,
        h('button', { class: 'btn btn--ghost btn--block mt-8', onclick: () => openRoutineBuilder(null, load) }, ico('plus'), 'New plan'));
    },
  });
}
