import { Router } from 'express';
import { db, getSetting, setSetting, getProfile, latestWeight, now } from './db.js';
import { computeTargets, bmi, est1RM } from './calc.js';
import { MUSCLES, MUSCLE_RECS } from './seeds.js';
import {
  aiStatus, mapAiError, streamChat, estimateMeal, formCheck, testKey, muscleRecs,
  computeTargetsWithOverride, MODELS, DEFAULT_MODEL,
} from './ai.js';

export const api = Router();

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const isDate = (s) => typeof s === 'string' && DATE_RE.test(s);
const num = (v, fallback = 0) => (Number.isFinite(+v) ? +v : fallback);
const bad = (res, message) => res.status(400).json({ error: message });

// Wrap an async handler so a rejected promise becomes a clean JSON 500 (via the
// error middleware) instead of an unhandled rejection.
const h = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// A workout only counts once something real happened in it: it was finished, has a
// duration (quick logs), or has at least one set. A session someone started and
// abandoned ("paused") must never show up as a logged workout. Requires alias `w`.
const REAL_WORKOUT =
  '(w.ended_at IS NOT NULL OR w.duration_min IS NOT NULL OR EXISTS (SELECT 1 FROM sets s WHERE s.workout_id = w.id))';

async function settingsPayload() {
  return {
    weight_unit: (await getSetting('weight_unit')) || 'lb',
    height_unit: (await getSetting('height_unit')) || 'cm',
    water_unit: (await getSetting('water_unit')) || 'oz',
    theme: (await getSetting('theme')) || 'dark',
    ai: { ...(await aiStatus()), models: MODELS },
  };
}

async function targetsPayload() {
  const profile = await getProfile();
  if (!profile) return null;
  const w = await latestWeight();
  return computeTargetsWithOverride(profile, w?.weight_kg ?? 70);
}

async function daySummary(date) {
  const f = await db.prepare(
    `SELECT COALESCE(SUM(calories),0) calories, COALESCE(SUM(protein_g),0) protein_g,
            COALESCE(SUM(carbs_g),0) carbs_g, COALESCE(SUM(fat_g),0) fat_g,
            COALESCE(SUM(sugar_g),0) sugar_g, COUNT(*) entries
     FROM food_entries WHERE date = ?`
  ).get(date);
  const water = (await db.prepare('SELECT COALESCE(SUM(ml),0) ml FROM water_log WHERE date = ?').get(date)).ml;
  const workouts = (await db.prepare(`SELECT COUNT(*) c FROM workouts w WHERE w.date = ? AND ${REAL_WORKOUT}`).get(date)).c;
  return { ...f, water_ml: water, workouts };
}

async function activeDates(limit = 500) {
  const rows = await db.prepare(
    `SELECT DISTINCT date FROM (
       SELECT date FROM food_entries UNION SELECT date FROM water_log
       UNION SELECT date FROM workouts w WHERE ${REAL_WORKOUT}
       UNION SELECT date FROM weight_log
     ) ORDER BY date DESC LIMIT ?`
  ).all(limit);
  return new Set(rows.map((r) => r.date));
}

function shiftDate(dateStr, days) {
  const d = new Date(dateStr + 'T12:00:00');
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

async function computeStreak(today) {
  const active = await activeDates();
  let streak = 0;
  let cursor = active.has(today) ? today : shiftDate(today, -1); // today doesn't break the streak until it's over
  while (active.has(cursor)) {
    streak++;
    cursor = shiftDate(cursor, -1);
  }
  return streak;
}

// ── Bootstrap ────────────────────────────────────────────────
api.get('/bootstrap', h(async (req, res) => {
  const today = isDate(req.query.today) ? req.query.today : new Date().toISOString().slice(0, 10);
  const profile = await getProfile();
  const w = await latestWeight();
  res.json({
    onboarded: !!profile,
    profile,
    settings: await settingsPayload(),
    targets: await targetsPayload(),
    weight: w,
    today: profile ? await daySummary(today) : null,
    streak: profile ? await computeStreak(today) : 0,
    workoutsThisWeek: profile
      ? (await db.prepare(`SELECT COUNT(*) c FROM workouts w WHERE w.date > ? AND w.date <= ? AND ${REAL_WORKOUT}`).get(shiftDate(today, -7), today)).c
      : 0,
    schedule_today: profile ? await effectiveScheduleFor(today) : null,
  });
}));

// ── Profile & targets ────────────────────────────────────────
api.post('/profile', h(async (req, res) => {
  const { name, sex, birthdate, height_cm, activity, goal, weight_kg } = req.body || {};
  if (!name || !['male', 'female'].includes(sex) || !isDate(birthdate)) return bad(res, 'Missing profile fields.');
  if (!(num(height_cm) > 80 && num(height_cm) < 260)) return bad(res, 'Height looks off.');
  if (!(num(weight_kg) > 25 && num(weight_kg) < 400)) return bad(res, 'Weight looks off.');
  await db.prepare(
    `INSERT INTO profile (id, name, sex, birthdate, height_cm, activity, goal, created_at)
     VALUES (1, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET name=excluded.name, sex=excluded.sex, birthdate=excluded.birthdate,
       height_cm=excluded.height_cm, activity=excluded.activity, goal=excluded.goal`
  ).run(name.trim(), sex, birthdate, num(height_cm), activity || 'moderate', goal || 'maintain', now());
  const date = isDate(req.body.date) ? req.body.date : new Date().toISOString().slice(0, 10);
  await db.prepare(
    `INSERT INTO weight_log (date, weight_kg, created_at) VALUES (?, ?, ?)
     ON CONFLICT(date) DO UPDATE SET weight_kg = excluded.weight_kg`
  ).run(date, num(weight_kg), now());
  res.json({ profile: await getProfile(), targets: await targetsPayload() });
}));

api.put('/profile', h(async (req, res) => {
  const profile = await getProfile();
  if (!profile) return bad(res, 'No profile yet.');
  const merged = { ...profile, ...req.body };
  await db.prepare(
    'UPDATE profile SET name=?, sex=?, birthdate=?, height_cm=?, activity=?, goal=? WHERE id=1'
  ).run(merged.name, merged.sex, merged.birthdate, num(merged.height_cm), merged.activity, merged.goal);
  res.json({ profile: await getProfile(), targets: await targetsPayload() });
}));

api.put('/targets', h(async (req, res) => {
  const allowed = ['calories', 'protein_g', 'carbs_g', 'fat_g', 'sugar_g', 'water_ml'];
  const override = {};
  for (const k of allowed) if (req.body[k] !== undefined) override[k] = Math.max(0, num(req.body[k]));
  await setSetting('targets_override', JSON.stringify(override));
  res.json({ targets: await targetsPayload() });
}));

api.delete('/targets', h(async (req, res) => {
  await setSetting('targets_override', null);
  res.json({ targets: await targetsPayload() });
}));

// ── Settings ─────────────────────────────────────────────────
api.get('/settings', h(async (req, res) => res.json(await settingsPayload())));

api.put('/settings', h(async (req, res) => {
  const { weight_unit, height_unit, water_unit, theme, ai_model } = req.body || {};
  if (weight_unit) await setSetting('weight_unit', weight_unit === 'kg' ? 'kg' : 'lb');
  if (height_unit) await setSetting('height_unit', height_unit === 'ftin' ? 'ftin' : 'cm');
  if (water_unit) await setSetting('water_unit', water_unit === 'ml' ? 'ml' : 'oz');
  if (theme) await setSetting('theme', theme === 'light' ? 'light' : 'dark');
  if (ai_model) await setSetting('ai_model', MODELS.some((m) => m.id === ai_model) ? ai_model : DEFAULT_MODEL);
  res.json(await settingsPayload());
}));

api.put('/settings/key', h(async (req, res) => {
  const key = (req.body?.api_key || '').trim();
  if (!key.startsWith('sk-ant-') || key.length < 20) return bad(res, 'That doesn’t look like an Anthropic API key (they start with sk-ant-).');
  await setSetting('api_key', key);
  res.json({ ai: await aiStatus() });
}));

api.delete('/settings/key', h(async (req, res) => {
  await setSetting('api_key', null);
  res.json({ ai: await aiStatus() });
}));

api.post('/settings/key/test', async (req, res) => {
  try {
    res.json(await testKey());
  } catch (e) {
    const m = mapAiError(e);
    res.status(m.status).json({ error: m.message, code: m.code });
  }
});

// ── Day view ─────────────────────────────────────────────────
api.get('/day/:date', h(async (req, res) => {
  const { date } = req.params;
  if (!isDate(date)) return bad(res, 'Bad date.');
  const entries = await db.prepare('SELECT * FROM food_entries WHERE date = ? ORDER BY id').all(date);
  const waterRows = await db.prepare('SELECT * FROM water_log WHERE date = ? ORDER BY id').all(date);
  const workouts = await db.prepare(`SELECT * FROM workouts w WHERE w.date = ? AND ${REAL_WORKOUT} ORDER BY w.id`).all(date);
  const weight = (await db.prepare('SELECT * FROM weight_log WHERE date = ?').get(date)) ?? null;
  res.json({ date, entries, water: waterRows, workouts, weight, summary: await daySummary(date), targets: await targetsPayload() });
}));

// ── Food ─────────────────────────────────────────────────────
api.post('/food', h(async (req, res) => {
  const { date, meal, name, qty, calories, protein_g, carbs_g, fat_g, sugar_g, source, food_id } = req.body || {};
  if (!isDate(date) || !name) return bad(res, 'Missing date or name.');
  const mealSafe = ['breakfast', 'lunch', 'dinner', 'snacks'].includes(meal) ? meal : 'snacks';
  const info = await db.prepare(
    `INSERT INTO food_entries (date, meal, name, qty, calories, protein_g, carbs_g, fat_g, sugar_g, source, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(date, mealSafe, String(name).slice(0, 120), qty ? String(qty).slice(0, 60) : null,
        num(calories), num(protein_g), num(carbs_g), num(fat_g), num(sugar_g), source || 'manual', now());
  if (food_id) await db.prepare('UPDATE foods SET use_count = use_count + 1 WHERE id = ?').run(num(food_id));
  res.json({ id: info.lastInsertRowid, summary: await daySummary(date) });
}));

api.put('/food/:id', h(async (req, res) => {
  const row = await db.prepare('SELECT * FROM food_entries WHERE id = ?').get(+req.params.id);
  if (!row) return bad(res, 'Entry not found.');
  const m = { ...row, ...req.body };
  await db.prepare(
    'UPDATE food_entries SET meal=?, name=?, qty=?, calories=?, protein_g=?, carbs_g=?, fat_g=?, sugar_g=? WHERE id=?'
  ).run(m.meal, m.name, m.qty, num(m.calories), num(m.protein_g), num(m.carbs_g), num(m.fat_g), num(m.sugar_g), row.id);
  res.json({ summary: await daySummary(row.date) });
}));

api.delete('/food/:id', h(async (req, res) => {
  const row = await db.prepare('SELECT date FROM food_entries WHERE id = ?').get(+req.params.id);
  await db.prepare('DELETE FROM food_entries WHERE id = ?').run(+req.params.id);
  res.json({ summary: row ? await daySummary(row.date) : null });
}));

api.get('/foods', h(async (req, res) => {
  const q = (req.query.q || '').trim();
  const rows = q
    ? await db.prepare('SELECT * FROM foods WHERE name LIKE ? ORDER BY use_count DESC, name LIMIT 40').all(`%${q}%`)
    : await db.prepare('SELECT * FROM foods ORDER BY use_count DESC, is_custom DESC, name LIMIT 40').all();
  res.json({ foods: rows });
}));

api.post('/foods', h(async (req, res) => {
  const { name, serving, calories, protein_g, carbs_g, fat_g, sugar_g } = req.body || {};
  if (!name) return bad(res, 'Name required.');
  const info = await db.prepare(
    'INSERT INTO foods (name, serving, calories, protein_g, carbs_g, fat_g, sugar_g, is_custom) VALUES (?, ?, ?, ?, ?, ?, ?, 1)'
  ).run(String(name).slice(0, 120), serving || '1 serving', num(calories), num(protein_g), num(carbs_g), num(fat_g), num(sugar_g));
  res.json({ id: info.lastInsertRowid });
}));

// ── Water ────────────────────────────────────────────────────
api.post('/water', h(async (req, res) => {
  const { date, ml } = req.body || {};
  if (!isDate(date) || !(num(ml) > 0)) return bad(res, 'Bad water entry.');
  await db.prepare('INSERT INTO water_log (date, ml, created_at) VALUES (?, ?, ?)').run(date, num(ml), now());
  res.json({ summary: await daySummary(date) });
}));

api.delete('/water/last', h(async (req, res) => {
  const date = req.query.date;
  if (!isDate(date)) return bad(res, 'Bad date.');
  const last = await db.prepare('SELECT id FROM water_log WHERE date = ? ORDER BY id DESC LIMIT 1').get(date);
  if (last) await db.prepare('DELETE FROM water_log WHERE id = ?').run(last.id);
  res.json({ summary: await daySummary(date) });
}));

// ── Weight & measurements ────────────────────────────────────
api.get('/weight', h(async (req, res) => {
  const limit = Math.min(num(req.query.limit, 400), 2000);
  res.json({ weights: (await db.prepare('SELECT * FROM weight_log ORDER BY date DESC LIMIT ?').all(limit)).reverse() });
}));

api.post('/weight', h(async (req, res) => {
  const { date, weight_kg } = req.body || {};
  if (!isDate(date) || !(num(weight_kg) > 25 && num(weight_kg) < 400)) return bad(res, 'Bad weight entry.');
  await db.prepare(
    `INSERT INTO weight_log (date, weight_kg, created_at) VALUES (?, ?, ?)
     ON CONFLICT(date) DO UPDATE SET weight_kg = excluded.weight_kg`
  ).run(date, num(weight_kg), now());
  const profile = await getProfile();
  res.json({
    weight: await db.prepare('SELECT * FROM weight_log WHERE date = ?').get(date),
    targets: await targetsPayload(),
    bmi: profile ? bmi(num(weight_kg), profile.height_cm) : null,
  });
}));

api.delete('/weight/:id', h(async (req, res) => {
  await db.prepare('DELETE FROM weight_log WHERE id = ?').run(+req.params.id);
  res.json({ ok: true });
}));

api.get('/measurements', h(async (req, res) => {
  res.json({ measurements: await db.prepare('SELECT * FROM measurements ORDER BY date DESC, id DESC LIMIT 200').all() });
}));

api.post('/measurements', h(async (req, res) => {
  const { date, kind, value_cm } = req.body || {};
  if (!isDate(date) || !kind || !(num(value_cm) > 0)) return bad(res, 'Bad measurement.');
  await db.prepare('INSERT INTO measurements (date, kind, value_cm, created_at) VALUES (?, ?, ?, ?)')
    .run(date, String(kind).slice(0, 40), num(value_cm), now());
  res.json({ ok: true });
}));

// ── Exercises ────────────────────────────────────────────────
api.get('/exercises', h(async (req, res) => {
  const q = (req.query.q || '').trim();
  const cat = (req.query.category || '').trim();
  let rows;
  if (q) rows = await db.prepare('SELECT * FROM exercises WHERE name LIKE ? ORDER BY name LIMIT 60').all(`%${q}%`);
  else if (cat) rows = await db.prepare('SELECT * FROM exercises WHERE category = ? ORDER BY name').all(cat);
  else rows = await db.prepare('SELECT * FROM exercises ORDER BY category, name').all();
  res.json({ exercises: rows });
}));

api.post('/exercises', h(async (req, res) => {
  const { name, category, muscle, equipment } = req.body || {};
  if (!name) return bad(res, 'Name required.');
  const clean = String(name).slice(0, 80);
  const existing = await db.prepare('SELECT id FROM exercises WHERE name = ?').get(clean);
  if (existing) return res.json({ id: existing.id });
  const info = await db.prepare(
    'INSERT INTO exercises (name, category, muscle, equipment, is_custom) VALUES (?, ?, ?, ?, 1)'
  ).run(clean, category || 'strength', muscle || null, equipment || null);
  res.json({ id: info.lastInsertRowid });
}));

// ── Workouts & sets ──────────────────────────────────────────
async function workoutAgg(id) {
  return {
    set_count: (await db.prepare('SELECT COUNT(*) c FROM sets WHERE workout_id = ?').get(id)).c,
    volume_kg: (await db.prepare('SELECT COALESCE(SUM(reps * weight_kg),0) v FROM sets WHERE workout_id = ? AND reps IS NOT NULL AND weight_kg IS NOT NULL').get(id)).v,
    exercises: (await db.prepare('SELECT COUNT(DISTINCT exercise_id) c FROM sets WHERE workout_id = ?').get(id)).c,
  };
}

api.get('/workouts', h(async (req, res) => {
  const limit = Math.min(num(req.query.limit, 20), 100);
  const offset = num(req.query.offset, 0);
  const rows = await db.prepare(`SELECT * FROM workouts w WHERE ${REAL_WORKOUT} ORDER BY w.date DESC, w.id DESC LIMIT ? OFFSET ?`).all(limit, offset);
  const out = [];
  for (const w of rows) out.push({ ...w, ...(await workoutAgg(w.id)) });
  res.json({ workouts: out });
}));

api.get('/workouts/:id', h(async (req, res) => {
  const w = await db.prepare('SELECT * FROM workouts WHERE id = ?').get(+req.params.id);
  if (!w) return bad(res, 'Workout not found.');
  const sets = await db.prepare(
    `SELECT s.*, e.name AS exercise_name, e.category AS exercise_category
     FROM sets s JOIN exercises e ON e.id = s.exercise_id WHERE s.workout_id = ? ORDER BY s.id`
  ).all(w.id);
  res.json({ workout: { ...w, ...(await workoutAgg(w.id)) }, sets });
}));

api.post('/workouts', h(async (req, res) => {
  const { date, name, type } = req.body || {};
  if (!isDate(date)) return bad(res, 'Bad date.');
  const info = await db.prepare(
    'INSERT INTO workouts (date, name, type, started_at, duration_min, notes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(date, name || null, type || 'strength', req.body.started_at || now(),
        req.body.duration_min ? num(req.body.duration_min) : null, req.body.notes || null, now());
  res.json({ id: info.lastInsertRowid });
}));

api.put('/workouts/:id', h(async (req, res) => {
  const w = await db.prepare('SELECT * FROM workouts WHERE id = ?').get(+req.params.id);
  if (!w) return bad(res, 'Workout not found.');
  const m = { ...w, ...req.body };
  await db.prepare('UPDATE workouts SET name=?, type=?, started_at=?, ended_at=?, duration_min=?, notes=? WHERE id=?')
    .run(m.name, m.type, m.started_at, m.ended_at ?? w.ended_at, m.duration_min != null ? num(m.duration_min) : null, m.notes, w.id);
  res.json({ workout: await db.prepare('SELECT * FROM workouts WHERE id = ?').get(w.id) });
}));

api.delete('/workouts/:id', h(async (req, res) => {
  const id = +req.params.id;
  await db.prepare('DELETE FROM sets WHERE workout_id = ?').run(id); // explicit — not relying on FK cascade
  await db.prepare('DELETE FROM workouts WHERE id = ?').run(id);
  res.json({ ok: true });
}));

async function bestBefore(exerciseId, excludeSetId = null) {
  const rows = excludeSetId
    ? await db.prepare('SELECT weight_kg, reps FROM sets WHERE exercise_id = ? AND id != ? AND weight_kg IS NOT NULL AND reps IS NOT NULL').all(exerciseId, excludeSetId)
    : await db.prepare('SELECT weight_kg, reps FROM sets WHERE exercise_id = ? AND weight_kg IS NOT NULL AND reps IS NOT NULL').all(exerciseId);
  let best = 0;
  for (const r of rows) best = Math.max(best, est1RM(r.weight_kg, r.reps));
  return best;
}

api.post('/workouts/:id/sets', h(async (req, res) => {
  const w = await db.prepare('SELECT * FROM workouts WHERE id = ?').get(+req.params.id);
  if (!w) return bad(res, 'Workout not found.');
  const { exercise_id, reps, weight_kg, duration_sec, distance_m } = req.body || {};
  const ex = await db.prepare('SELECT * FROM exercises WHERE id = ?').get(num(exercise_id));
  if (!ex) return bad(res, 'Exercise not found.');
  const prBefore = await bestBefore(ex.id);
  const idx = (await db.prepare('SELECT COUNT(*) c FROM sets WHERE workout_id = ? AND exercise_id = ?').get(w.id, ex.id)).c + 1;
  const info = await db.prepare(
    'INSERT INTO sets (workout_id, exercise_id, set_index, reps, weight_kg, duration_sec, distance_m, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(w.id, ex.id, idx, reps != null ? num(reps) : null, weight_kg != null ? num(weight_kg) : null,
        duration_sec != null ? num(duration_sec) : null, distance_m != null ? num(distance_m) : null, now());
  const estNow = est1RM(num(weight_kg), num(reps));
  res.json({
    id: info.lastInsertRowid,
    set_index: idx,
    // a PR means beating a previous best — the first-ever set doesn't count
    is_pr: prBefore > 0 && estNow > prBefore,
    est_1rm: estNow || null,
  });
}));

api.put('/sets/:id', h(async (req, res) => {
  const s = await db.prepare('SELECT * FROM sets WHERE id = ?').get(+req.params.id);
  if (!s) return bad(res, 'Set not found.');
  const m = { ...s, ...req.body };
  await db.prepare('UPDATE sets SET reps=?, weight_kg=?, duration_sec=?, distance_m=? WHERE id=?')
    .run(m.reps != null ? num(m.reps) : null, m.weight_kg != null ? num(m.weight_kg) : null,
         m.duration_sec != null ? num(m.duration_sec) : null, m.distance_m != null ? num(m.distance_m) : null, s.id);
  res.json({ ok: true });
}));

api.delete('/sets/:id', h(async (req, res) => {
  await db.prepare('DELETE FROM sets WHERE id = ?').run(+req.params.id);
  res.json({ ok: true });
}));

// ── Routines ─────────────────────────────────────────────────
api.get('/routines', h(async (req, res) => {
  const rows = await db.prepare('SELECT * FROM routines ORDER BY id').all();
  const exName = db.prepare('SELECT name FROM exercises WHERE id = ?');
  const routines = [];
  for (const r of rows) {
    const items = [];
    for (const it of JSON.parse(r.items)) {
      items.push({ ...it, name: (await exName.get(it.exercise_id))?.name || '?' });
    }
    routines.push({ ...r, items });
  }
  res.json({ routines });
}));

api.post('/routines', h(async (req, res) => {
  const { name, items } = req.body || {};
  if (!name || !Array.isArray(items)) return bad(res, 'Name and items required.');
  const info = await db.prepare('INSERT INTO routines (name, items, created_at) VALUES (?, ?, ?)')
    .run(String(name).slice(0, 80), JSON.stringify(items), now());
  res.json({ id: info.lastInsertRowid });
}));

api.put('/routines/:id', h(async (req, res) => {
  const row = await db.prepare('SELECT * FROM routines WHERE id = ?').get(+req.params.id);
  if (!row) return bad(res, 'Routine not found.');
  const { name, items } = req.body || {};
  await db.prepare('UPDATE routines SET name = ?, items = ? WHERE id = ?')
    .run(name ? String(name).slice(0, 80) : row.name, Array.isArray(items) ? JSON.stringify(items) : row.items, row.id);
  res.json({ ok: true });
}));

api.delete('/routines/:id', h(async (req, res) => {
  await db.prepare('DELETE FROM routines WHERE id = ?').run(+req.params.id);
  res.json({ ok: true });
}));

// ── Workout schedule (calendar) ──────────────────────────────
async function effectiveScheduleFor(date) {
  const d = await db.prepare('SELECT * FROM schedule_days WHERE date = ?').get(date);
  if (d) return { kind: d.kind, label: d.label, routine_id: d.routine_id, source: 'date' };
  const dow = new Date(date + 'T12:00:00').getDay();
  const w = await db.prepare('SELECT * FROM schedule_weekly WHERE dow = ?').get(dow);
  if (w) return { kind: w.kind, label: w.label, routine_id: w.routine_id, source: 'weekly' };
  return null;
}

api.get('/schedule', h(async (req, res) => {
  const { from, to } = req.query;
  if (!isDate(from) || !isDate(to) || to < from) return bad(res, 'Bad range.');
  const span = Math.round((new Date(to + 'T12:00:00') - new Date(from + 'T12:00:00')) / 86400000) + 1;
  if (span > 70) return bad(res, 'Range too large.');
  const days = {};
  for (let i = 0; i < span; i++) {
    const d = shiftDate(from, i);
    const entry = await effectiveScheduleFor(d);
    if (entry) days[d] = entry;
  }
  const weekly = {};
  for (const w of await db.prepare('SELECT * FROM schedule_weekly').all()) {
    weekly[w.dow] = { kind: w.kind, label: w.label, routine_id: w.routine_id };
  }
  const workouts = Object.fromEntries(
    (await db.prepare(`SELECT w.date, COUNT(*) c FROM workouts w WHERE w.date >= ? AND w.date <= ? AND ${REAL_WORKOUT} GROUP BY w.date`)
      .all(from, to)).map((r) => [r.date, r.c])
  );
  res.json({ from, to, days, weekly, workouts });
}));

api.put('/schedule/day', h(async (req, res) => {
  const { date, kind, label, routine_id } = req.body || {};
  if (!isDate(date) || !['workout', 'rest'].includes(kind)) return bad(res, 'Bad schedule entry.');
  await db.prepare(
    `INSERT INTO schedule_days (date, kind, label, routine_id, created_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(date) DO UPDATE SET kind = excluded.kind, label = excluded.label, routine_id = excluded.routine_id`
  ).run(date, kind, label ? String(label).slice(0, 80) : null, routine_id ? num(routine_id) : null, now());
  res.json({ day: await effectiveScheduleFor(date) });
}));

api.delete('/schedule/day', h(async (req, res) => {
  if (!isDate(req.query.date)) return bad(res, 'Bad date.');
  await db.prepare('DELETE FROM schedule_days WHERE date = ?').run(req.query.date);
  res.json({ day: await effectiveScheduleFor(req.query.date) });
}));

api.put('/schedule/weekly', h(async (req, res) => {
  const { dow, kind, label, routine_id } = req.body || {};
  const d = num(dow, -1);
  if (!(d >= 0 && d <= 6) || !['workout', 'rest'].includes(kind)) return bad(res, 'Bad weekly entry.');
  await db.prepare(
    `INSERT INTO schedule_weekly (dow, kind, label, routine_id, created_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(dow) DO UPDATE SET kind = excluded.kind, label = excluded.label, routine_id = excluded.routine_id`
  ).run(d, kind, label ? String(label).slice(0, 80) : null, routine_id ? num(routine_id) : null, now());
  res.json({ ok: true });
}));

api.delete('/schedule/weekly', h(async (req, res) => {
  const d = num(req.query.dow, -1);
  if (!(d >= 0 && d <= 6)) return bad(res, 'Bad day of week.');
  await db.prepare('DELETE FROM schedule_weekly WHERE dow = ?').run(d);
  res.json({ ok: true });
}));

// ── Muscle map (week runs Sunday → Saturday) ─────────────────
function weekBounds(today) {
  const d = new Date(today + 'T12:00:00');
  const start = shiftDate(today, -d.getDay());
  return { start, end: shiftDate(start, 6) };
}

api.get('/muscles', h(async (req, res) => {
  const today = isDate(req.query.today) ? req.query.today : new Date().toISOString().slice(0, 10);
  const { start, end } = weekBounds(today);
  const rows = await db.prepare(
    `SELECT e.muscle, e.name, COUNT(*) AS sets, MAX(w.date) AS last_date
     FROM sets s JOIN workouts w ON w.id = s.workout_id JOIN exercises e ON e.id = s.exercise_id
     WHERE w.date >= ? AND w.date <= ? AND e.muscle IS NOT NULL
     GROUP BY e.muscle, e.name`
  ).all(start, end);
  const muscles = {};
  for (const [key, label] of MUSCLES) muscles[key] = { key, label, sets: 0, exercises: [], last_date: null };
  for (const r of rows) {
    if (muscles[r.muscle]) {
      muscles[r.muscle].sets += r.sets;
      muscles[r.muscle].exercises.push(r.name);
      if (!muscles[r.muscle].last_date || r.last_date > muscles[r.muscle].last_date) muscles[r.muscle].last_date = r.last_date;
    }
  }
  const cw = await db.prepare(
    `SELECT COUNT(*) AS c, COALESCE(SUM(COALESCE(w.duration_min, 0)), 0) AS m FROM workouts w
     WHERE w.date >= ? AND w.date <= ? AND w.type IN ('cardio', 'sport', 'mobility') AND ${REAL_WORKOUT}`
  ).get(start, end);
  res.json({ week_start: start, week_end: end, muscles, cardio: { sessions: cw.c, minutes: Math.round(cw.m) } });
}));

// Curated exercise recommendations (no AI needed)
api.get('/recs/:muscle', h(async (req, res) => {
  const key = req.params.muscle;
  const recs = MUSCLE_RECS[key];
  if (!recs) return bad(res, 'Unknown muscle group.');
  const findEx = db.prepare('SELECT id, equipment, category FROM exercises WHERE name = ?');
  const exercises = [];
  for (const [name, scheme, why] of recs) {
    const ex = await findEx.get(name);
    exercises.push({ name, scheme, why, exercise_id: ex?.id ?? null, equipment: ex?.equipment ?? null });
  }
  res.json({ muscle: key, source: 'curated', exercises });
}));

// ── PRs ──────────────────────────────────────────────────────
api.get('/prs', h(async (req, res) => {
  const rows = await db.prepare(
    `SELECT s.exercise_id, e.name, e.category, s.weight_kg, s.reps, s.duration_sec, s.distance_m, w.date
     FROM sets s JOIN exercises e ON e.id = s.exercise_id JOIN workouts w ON w.id = s.workout_id`
  ).all();
  const best = new Map();
  for (const r of rows) {
    const cur = best.get(r.exercise_id) || { name: r.name, category: r.category, best_est: 0, best_weight: 0, best_reps: 0, best_distance: 0, date: r.date };
    const est = est1RM(r.weight_kg, r.reps);
    if (est > cur.best_est) { cur.best_est = est; cur.best_weight = r.weight_kg; cur.best_reps = r.reps; cur.date = r.date; }
    if ((r.reps || 0) > cur.best_reps && !r.weight_kg) cur.best_reps = r.reps;
    if ((r.distance_m || 0) > cur.best_distance) cur.best_distance = r.distance_m;
    best.set(r.exercise_id, cur);
  }
  res.json({ prs: [...best.values()].sort((a, b) => b.best_est - a.best_est) });
}));

// ── Stats (charts) ───────────────────────────────────────────
api.get('/stats', h(async (req, res) => {
  const today = isDate(req.query.today) ? req.query.today : new Date().toISOString().slice(0, 10);
  const range = Math.min(Math.max(num(req.query.range, 7), 7), 366);
  const start = shiftDate(today, -(range - 1));

  const foodRows = await db.prepare(
    `SELECT date, SUM(calories) calories, SUM(protein_g) protein_g, SUM(sugar_g) sugar_g
     FROM food_entries WHERE date >= ? AND date <= ? GROUP BY date`
  ).all(start, today);
  const waterRows = await db.prepare(
    'SELECT date, SUM(ml) ml FROM water_log WHERE date >= ? AND date <= ? GROUP BY date'
  ).all(start, today);
  const workoutRows = await db.prepare(
    `SELECT w.date, COUNT(*) c,
            COALESCE(SUM((SELECT SUM(s.reps * s.weight_kg) FROM sets s WHERE s.workout_id = w.id AND s.reps IS NOT NULL AND s.weight_kg IS NOT NULL)), 0) volume
     FROM workouts w WHERE w.date >= ? AND w.date <= ? AND ${REAL_WORKOUT} GROUP BY w.date`
  ).all(start, today);

  const byDate = (rows) => Object.fromEntries(rows.map((r) => [r.date, r]));
  const fm = byDate(foodRows), wm = byDate(waterRows), om = byDate(workoutRows);

  const days = [];
  for (let i = 0; i < range; i++) {
    const d = shiftDate(start, i);
    days.push({
      date: d,
      calories: Math.round(fm[d]?.calories || 0),
      protein_g: Math.round(fm[d]?.protein_g || 0),
      sugar_g: Math.round(fm[d]?.sugar_g || 0),
      water_ml: Math.round(wm[d]?.ml || 0),
      workouts: om[d]?.c || 0,
      volume_kg: Math.round(om[d]?.volume || 0),
    });
  }

  const weights = await db.prepare(
    'SELECT date, weight_kg FROM weight_log WHERE date >= ? AND date <= ? ORDER BY date'
  ).all(start, today);

  res.json({
    start, end: today, days, weights,
    streak: await computeStreak(today),
    targets: await targetsPayload(),
    totals: {
      workouts: days.reduce((a, d) => a + d.workouts, 0),
      volume_kg: days.reduce((a, d) => a + d.volume_kg, 0),
      logged_days: days.filter((d) => d.calories > 0 || d.workouts > 0 || d.water_ml > 0).length,
    },
  });
}));

// ── Export & reset ───────────────────────────────────────────
api.get('/export', h(async (req, res) => {
  const dump = {
    exported_at: now(),
    app: 'Ascend',
    profile: await getProfile(),
    settings: Object.fromEntries(
      (await db.prepare("SELECT key, value FROM settings WHERE key != 'api_key'").all()).map((r) => [r.key, r.value])
    ),
    weight_log: await db.prepare('SELECT * FROM weight_log ORDER BY date').all(),
    measurements: await db.prepare('SELECT * FROM measurements ORDER BY date').all(),
    food_entries: await db.prepare('SELECT * FROM food_entries ORDER BY date, id').all(),
    water_log: await db.prepare('SELECT * FROM water_log ORDER BY date, id').all(),
    custom_foods: await db.prepare('SELECT * FROM foods WHERE is_custom = 1').all(),
    workouts: await db.prepare('SELECT * FROM workouts ORDER BY date, id').all(),
    sets: await db.prepare('SELECT * FROM sets ORDER BY id').all(),
    routines: await db.prepare('SELECT * FROM routines').all(),
    schedule_days: await db.prepare('SELECT * FROM schedule_days').all(),
    schedule_weekly: await db.prepare('SELECT * FROM schedule_weekly').all(),
    form_checks: await db.prepare('SELECT id, date, exercise, score, summary, feedback, created_at FROM form_checks ORDER BY id').all(),
  };
  res.setHeader('Content-Disposition', `attachment; filename="ascend-export-${new Date().toISOString().slice(0, 10)}.json"`);
  res.json(dump);
}));

api.post('/reset', h(async (req, res) => {
  if (req.body?.confirm !== 'RESET') return bad(res, 'Type RESET to confirm.');
  await db.exec(`
    DELETE FROM food_entries; DELETE FROM water_log; DELETE FROM sets; DELETE FROM workouts;
    DELETE FROM weight_log; DELETE FROM measurements; DELETE FROM chat_messages; DELETE FROM form_checks;
    DELETE FROM muscle_recs; DELETE FROM schedule_days; DELETE FROM schedule_weekly;
    DELETE FROM foods WHERE is_custom = 1; DELETE FROM exercises WHERE is_custom = 1;
    UPDATE foods SET use_count = 0;
    DELETE FROM profile; DELETE FROM settings WHERE key NOT IN ('api_key', 'ai_model');
  `);
  res.json({ ok: true });
}));

// ── AI endpoints ─────────────────────────────────────────────
api.post('/ai/chat', async (req, res) => {
  const message = (req.body?.message || '').trim().slice(0, 4000);
  const today = isDate(req.body?.today) ? req.body.today : new Date().toISOString().slice(0, 10);
  if (!message) return bad(res, 'Empty message.');
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();
  try {
    await streamChat({ message, today, res });
  } catch (e) {
    const m = mapAiError(e);
    res.write(`data: ${JSON.stringify({ type: 'error', code: m.code, message: m.message })}\n\n`);
  }
  res.end();
});

api.get('/ai/history', h(async (req, res) => {
  const rows = (await db.prepare('SELECT * FROM chat_messages ORDER BY id DESC LIMIT 80').all()).reverse();
  res.json({ messages: rows });
}));

api.delete('/ai/history', h(async (req, res) => {
  await db.exec('DELETE FROM chat_messages');
  res.json({ ok: true });
}));

api.post('/ai/estimate', async (req, res) => {
  try {
    const { text, image } = req.body || {};
    if (!text && !image) return bad(res, 'Describe the meal or attach a photo.');
    res.json(await estimateMeal({ text: (text || '').slice(0, 1000), image }));
  } catch (e) {
    const m = mapAiError(e);
    res.status(m.status).json({ error: m.message, code: m.code });
  }
});

api.post('/ai/formcheck', async (req, res) => {
  try {
    const { exercise, notes, frames, isVideo, date } = req.body || {};
    if (!Array.isArray(frames) || !frames.length) return bad(res, 'No frames received.');
    res.json(await formCheck({
      exercise: (exercise || '').slice(0, 80),
      notes: (notes || '').slice(0, 500),
      frames, isVideo: !!isVideo,
      date: isDate(date) ? date : new Date().toISOString().slice(0, 10),
    }));
  } catch (e) {
    const m = mapAiError(e);
    res.status(m.status).json({ error: m.message, code: m.code });
  }
});

api.post('/ai/muscle-recs', async (req, res) => {
  try {
    const muscle = req.body?.muscle;
    if (!MUSCLE_RECS[muscle]) return bad(res, 'Unknown muscle group.');
    const today = isDate(req.body?.today) ? req.body.today : new Date().toISOString().slice(0, 10);
    const { start } = weekBounds(today);
    if (!req.body?.refresh) {
      const cached = await db.prepare('SELECT data FROM muscle_recs WHERE muscle = ? AND week = ?').get(muscle, start);
      if (cached) return res.json({ ...JSON.parse(cached.data), source: 'ai', cached: true });
    }
    const result = await muscleRecs({ muscle, today });
    await db.prepare(
      'INSERT INTO muscle_recs (muscle, week, data, created_at) VALUES (?, ?, ?, ?) ON CONFLICT(muscle, week) DO UPDATE SET data = excluded.data'
    ).run(muscle, start, JSON.stringify(result), now());
    res.json({ ...result, source: 'ai', cached: false });
  } catch (e) {
    const m = mapAiError(e);
    res.status(m.status).json({ error: m.message, code: m.code });
  }
});

api.get('/ai/formchecks', h(async (req, res) => {
  const rows = await db.prepare('SELECT * FROM form_checks ORDER BY id DESC LIMIT 30').all();
  res.json({ checks: rows.map((r) => ({ ...r, feedback: JSON.parse(r.feedback) })) });
}));

api.delete('/ai/formchecks/:id', h(async (req, res) => {
  await db.prepare('DELETE FROM form_checks WHERE id = ?').run(+req.params.id);
  res.json({ ok: true });
}));

api.get('/health', (req, res) => res.json({ ok: true, app: 'Ascend' }));
