import Anthropic from '@anthropic-ai/sdk';
import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db, getSetting, setSetting, getProfile, latestWeight, now } from './db.js';
import { computeTargets, bmi, est1RM } from './calc.js';

const ENV_PATH = path.join(path.dirname(path.dirname(fileURLToPath(import.meta.url))), '.env');

export const DEFAULT_MODEL = 'claude-opus-4-8';
export const MODELS = [
  { id: 'claude-opus-4-8', label: 'Claude Opus 4.8 — smartest (default)' },
  { id: 'claude-sonnet-5', label: 'Claude Sonnet 5 — fast & smart' },
  { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5 — fastest, cheapest' },
];

class NoKeyError extends Error {}

// The .env file is the primary home for the key. It's re-read whenever the file
// changes, so pasting a key takes effect immediately — no server restart needed.
let envCache = { mtime: -1, key: null };
function keyFromEnvFile() {
  try {
    const mtime = statSync(ENV_PATH).mtimeMs;
    if (mtime !== envCache.mtime) {
      const text = readFileSync(ENV_PATH, 'utf8');
      const m = /^\s*ANTHROPIC_API_KEY\s*=\s*("?)([^"\r\n]+)\1\s*$/m.exec(text);
      envCache = { mtime, key: m ? m[2].trim() : null };
    }
    return envCache.key;
  } catch {
    return null;
  }
}

function getApiKey() {
  return keyFromEnvFile() || process.env.ANTHROPIC_API_KEY || getSetting('api_key') || null;
}

export function aiStatus() {
  const key = getApiKey();
  const usage = JSON.parse(getSetting('ai_usage') || '{"requests":0,"input":0,"output":0}');
  return {
    hasKey: !!key,
    last4: key ? key.slice(-4) : null,
    fromEnv: !!(keyFromEnvFile() || process.env.ANTHROPIC_API_KEY),
    model: getSetting('ai_model') || DEFAULT_MODEL,
    usage,
  };
}

function client() {
  const key = getApiKey();
  if (!key) throw new NoKeyError();
  return new Anthropic({ apiKey: key });
}

function model() {
  return getSetting('ai_model') || DEFAULT_MODEL;
}

function trackUsage(usage) {
  if (!usage) return;
  const u = JSON.parse(getSetting('ai_usage') || '{"requests":0,"input":0,"output":0}');
  u.requests += 1;
  u.input += usage.input_tokens || 0;
  u.output += usage.output_tokens || 0;
  setSetting('ai_usage', JSON.stringify(u));
}

// Friendly, actionable error mapping for the UI
export function mapAiError(e) {
  if (e instanceof NoKeyError) {
    return { status: 428, code: 'no_key', message: 'Add your Anthropic API key in Settings to unlock AI features.' };
  }
  if (e instanceof Anthropic.AuthenticationError) {
    return { status: 401, code: 'bad_key', message: 'That API key was rejected — double-check it in Settings.' };
  }
  if (e instanceof Anthropic.PermissionDeniedError) {
    return { status: 403, code: 'forbidden', message: 'Your API key doesn’t have access to this model. Try another model in Settings.' };
  }
  if (e instanceof Anthropic.NotFoundError) {
    return { status: 400, code: 'bad_model', message: 'That model isn’t available on your key. Pick a different one in Settings.' };
  }
  if (e instanceof Anthropic.RateLimitError) {
    return { status: 429, code: 'rate_limited', message: 'Hit the rate limit — wait a few seconds and try again.' };
  }
  if (e instanceof Anthropic.BadRequestError) {
    return { status: 400, code: 'bad_request', message: e.message || 'The AI request was rejected.' };
  }
  if (e instanceof Anthropic.APIConnectionError) {
    return { status: 502, code: 'offline', message: 'Couldn’t reach the AI service — check this PC’s internet connection.' };
  }
  if (e instanceof Anthropic.APIError) {
    return { status: e.status || 500, code: 'api_error', message: e.message || 'AI service error.' };
  }
  return { status: 500, code: 'error', message: e.message || 'Something went wrong.' };
}

// ── Coach context ────────────────────────────────────────────
const KG_TO_LB = 2.2046226218;
const fmtLb = (kg) => `${Math.round(kg * KG_TO_LB * 10) / 10} lb`;

function coachContext(today) {
  const profile = getProfile();
  if (!profile) return 'The user has not completed onboarding yet.';
  const w = latestWeight();
  const weightKg = w?.weight_kg ?? 70;
  const t = computeTargetsWithOverride(profile, weightKg);
  const weightUnit = getSetting('weight_unit') || 'lb';
  const showW = (kg) => (weightUnit === 'kg' ? `${Math.round(kg * 10) / 10} kg` : fmtLb(kg));

  const lines = [];
  lines.push(`## Profile`);
  lines.push(
    `Name: ${profile.name} · Sex: ${profile.sex} · Age: ${t.age} · Height: ${profile.height_cm} cm · ` +
    `Weight: ${showW(weightKg)} (${weightKg} kg) · BMI: ${bmi(weightKg, profile.height_cm)} · ` +
    `Activity: ${profile.activity} · Goal: ${profile.goal} weight`
  );
  lines.push(`Preferred units: body weight & lifting in ${weightUnit === 'kg' ? 'kilograms' : 'pounds'}, height in cm.`);
  lines.push(`## Daily targets`);
  lines.push(
    `${t.calories} kcal · ${t.protein_g} g protein · ${t.carbs_g} g carbs · ${t.fat_g} g fat · ` +
    `added sugar limit ${t.sugar_g} g · water ${t.water_ml} ml (BMR ${t.bmr}, TDEE ${t.tdee})`
  );

  // Today so far
  const foods = db.prepare(
    `SELECT COALESCE(SUM(calories),0) cal, COALESCE(SUM(protein_g),0) p, COALESCE(SUM(carbs_g),0) c,
            COALESCE(SUM(fat_g),0) f, COALESCE(SUM(sugar_g),0) s, COUNT(*) n
     FROM food_entries WHERE date = ?`
  ).get(today);
  const water = db.prepare('SELECT COALESCE(SUM(ml),0) ml FROM water_log WHERE date = ?').get(today);
  lines.push(`## Today (${today}) so far`);
  lines.push(
    `Eaten: ${Math.round(foods.cal)} kcal, ${Math.round(foods.p)} g protein, ${Math.round(foods.c)} g carbs, ` +
    `${Math.round(foods.f)} g fat, ${Math.round(foods.s)} g sugar across ${foods.n} entries · Water: ${water.ml} ml`
  );
  const todayMeals = db.prepare('SELECT meal, name, calories, protein_g FROM food_entries WHERE date = ? ORDER BY id').all(today);
  if (todayMeals.length) {
    lines.push('Logged: ' + todayMeals.map((m) => `${m.name} (${m.meal}, ${Math.round(m.calories)} kcal/${Math.round(m.protein_g)}g P)`).join('; '));
  }

  // Last 7 days averages
  const week = db.prepare(
    `SELECT COUNT(DISTINCT date) days, COALESCE(SUM(calories),0) cal, COALESCE(SUM(protein_g),0) p
     FROM food_entries WHERE date < ? AND date >= date(?, '-7 days')`
  ).get(today, today);
  if (week.days > 0) {
    lines.push(`## Last 7 days`);
    lines.push(`Averaged ${Math.round(week.cal / week.days)} kcal and ${Math.round(week.p / week.days)} g protein across ${week.days} logged days.`);
  }

  // Recent workouts
  const workouts = db.prepare(
    `SELECT w.id, w.date, w.name, w.type, w.duration_min,
            (SELECT COUNT(*) FROM sets s WHERE s.workout_id = w.id) set_count,
            (SELECT COALESCE(SUM(s.reps * s.weight_kg),0) FROM sets s WHERE s.workout_id = w.id) volume
     FROM workouts w ORDER BY w.date DESC, w.id DESC LIMIT 6`
  ).all();
  if (workouts.length) {
    lines.push(`## Recent workouts`);
    for (const wo of workouts) {
      const bits = [`${wo.date}: ${wo.name || wo.type}`];
      if (wo.set_count) bits.push(`${wo.set_count} sets`);
      if (wo.volume) bits.push(`${showW(wo.volume)} total volume`);
      if (wo.duration_min) bits.push(`${Math.round(wo.duration_min)} min`);
      lines.push('- ' + bits.join(' · '));
    }
  }

  // Top lifts (est 1RM)
  const prRows = db.prepare(
    `SELECT e.name, s.weight_kg, s.reps FROM sets s JOIN exercises e ON e.id = s.exercise_id
     WHERE s.weight_kg IS NOT NULL AND s.reps IS NOT NULL`
  ).all();
  const best = new Map();
  for (const r of prRows) {
    const est = est1RM(r.weight_kg, r.reps);
    const cur = best.get(r.name);
    if (!cur || est > cur.est) best.set(r.name, { est, w: r.weight_kg, reps: r.reps });
  }
  const top = [...best.entries()].sort((a, b) => b[1].est - a[1].est).slice(0, 6);
  if (top.length) {
    lines.push(`## Best lifts (est. 1RM)`);
    lines.push(top.map(([name, v]) => `${name}: ${showW(v.w)} × ${v.reps} (≈${showW(v.est)})`).join(' · '));
  }

  // Weight trend
  const weights = db.prepare('SELECT date, weight_kg FROM weight_log ORDER BY date DESC LIMIT 30').all();
  if (weights.length >= 2) {
    const newest = weights[0], oldest = weights[weights.length - 1];
    const diff = newest.weight_kg - oldest.weight_kg;
    lines.push(`## Weight trend`);
    lines.push(`${oldest.date}: ${showW(oldest.weight_kg)} → ${newest.date}: ${showW(newest.weight_kg)} (${diff >= 0 ? '+' : ''}${showW(Math.abs(diff)).replace(' ', ' ')} ${diff >= 0 ? 'gained' : 'lost'})`);
  }

  return lines.join('\n');
}

export function computeTargetsWithOverride(profile, weightKg) {
  const auto = computeTargets(profile, weightKg);
  const override = getSetting('targets_override');
  if (!override) return { ...auto, custom: false };
  try {
    return { ...auto, ...JSON.parse(override), custom: true };
  } catch {
    return { ...auto, custom: false };
  }
}

const COACH_SYSTEM = `You are Coach, the built-in AI trainer inside Ascend — a personal fitness app. You can see the user's live stats below; use them naturally, like a coach who knows their athlete.

Style:
- Warm, direct, and encouraging — a knowledgeable friend, not a drill sergeant or a textbook.
- Keep answers tight. Lead with the answer, then at most a few supporting points. Use short lists when they genuinely help.
- Use the user's preferred units for body weight and lifting.
- Ground advice in their actual data (targets, what they ate today, recent training). Point out real wins.
- For training questions, give concrete sets/reps/exercise suggestions they can do today.
- For nutrition questions, suggest specific foods with rough calories/protein that fit what's LEFT of today's targets.
- You are not a doctor. For pain, injury, or medical conditions, give sensible general guidance and recommend a professional when it matters. Never guilt-trip; never encourage under-eating below their targets.`;

export async function streamChat({ message, today, res }) {
  const c = client();
  const history = db.prepare('SELECT role, content FROM chat_messages ORDER BY id DESC LIMIT 24').all().reverse();
  const messages = [...history.map((m) => ({ role: m.role, content: m.content })), { role: 'user', content: message }];

  db.prepare('INSERT INTO chat_messages (role, content, created_at) VALUES (?, ?, ?)').run('user', message, now());

  const send = (obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`);

  const stream = c.messages.stream({
    model: model(),
    max_tokens: 16000,
    thinking: { type: 'adaptive' },
    system: `${COACH_SYSTEM}\n\n# Athlete data (live from the app)\n${coachContext(today)}`,
    messages,
  });

  stream.on('text', (delta) => send({ type: 'delta', text: delta }));

  const final = await stream.finalMessage();
  trackUsage(final.usage);
  const text = final.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  if (final.stop_reason === 'refusal') {
    send({ type: 'error', message: 'The coach declined to answer that one.' });
  } else {
    db.prepare('INSERT INTO chat_messages (role, content, created_at) VALUES (?, ?, ?)').run('assistant', text, now());
  }
  send({ type: 'done' });
}

// ── Structured helpers ───────────────────────────────────────
function dataUrlToImageBlock(dataUrl) {
  const m = /^data:(image\/(?:jpeg|png|webp));base64,(.+)$/.exec(dataUrl || '');
  if (!m) return null;
  return { type: 'image', source: { type: 'base64', media_type: m[1], data: m[2] } };
}

async function structuredRequest({ content, system, schema, maxTokens }) {
  const c = client();
  const resp = await c.messages.create({
    model: model(),
    max_tokens: maxTokens,
    thinking: { type: 'adaptive' },
    system,
    output_config: { format: { type: 'json_schema', schema } },
    messages: [{ role: 'user', content }],
  });
  trackUsage(resp.usage);
  if (resp.stop_reason === 'refusal') throw new Error('The AI declined this request.');
  if (resp.stop_reason === 'max_tokens') throw new Error('The AI response was cut short — try again.');
  const text = resp.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  return JSON.parse(text);
}

const MEAL_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['items', 'confidence', 'notes'],
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'qty', 'calories', 'protein_g', 'carbs_g', 'fat_g', 'sugar_g'],
        properties: {
          name: { type: 'string' },
          qty: { type: 'string' },
          calories: { type: 'number' },
          protein_g: { type: 'number' },
          carbs_g: { type: 'number' },
          fat_g: { type: 'number' },
          sugar_g: { type: 'number' },
        },
      },
    },
    confidence: { type: 'string', enum: ['low', 'medium', 'high'] },
    notes: { type: 'string' },
  },
};

export async function estimateMeal({ text, image }) {
  const content = [];
  const img = image ? dataUrlToImageBlock(image) : null;
  if (img) content.push(img);
  content.push({
    type: 'text',
    text:
      `Estimate the nutrition of this meal${img ? ' from the photo' : ''}${text ? ` — the user describes it as: "${text}"` : ''}.\n` +
      `Break it into separate items with realistic typical portions. For each item give calories, protein_g, carbs_g, fat_g and sugar_g (sugar must be ≤ carbs). ` +
      `Round calories to the nearest 5 and grams to whole numbers. Use "qty" for a short portion description like "1 cup" or "2 slices". ` +
      `If a portion is ambiguous, assume a normal single serving and mention the assumption in notes. ` +
      `If ${img ? 'the photo shows no food' : 'the description contains no food'}, return an empty items array and explain in notes.`,
  });
  return structuredRequest({
    content,
    system: 'You are a meticulous nutritionist. You estimate realistic calorie and macro values for meals the way a good nutrition-tracking app would.',
    schema: MEAL_SCHEMA,
    maxTokens: 8000,
  });
}

const FORMCHECK_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['exercise_detected', 'score', 'summary', 'strengths', 'improvements', 'injury_flags', 'next_step'],
  properties: {
    exercise_detected: { type: 'string' },
    score: { type: 'integer' },
    summary: { type: 'string' },
    strengths: { type: 'array', items: { type: 'string' } },
    improvements: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['issue', 'why', 'cue'],
        properties: {
          issue: { type: 'string' },
          why: { type: 'string' },
          cue: { type: 'string' },
        },
      },
    },
    injury_flags: { type: 'array', items: { type: 'string' } },
    next_step: { type: 'string' },
  },
};

export async function formCheck({ exercise, notes, frames, isVideo, date }) {
  const content = [];
  for (const f of (frames || []).slice(0, 8)) {
    const img = dataUrlToImageBlock(f);
    if (img) content.push(img);
  }
  if (!content.length) throw new Error('No usable frames were provided.');
  content.push({
    type: 'text',
    text:
      `${isVideo ? `These ${content.length} images are sequential frames from a short video, in order.` : 'This is a photo.'} ` +
      `The user says the exercise is: ${exercise || 'unspecified'}.${notes ? ` Their note: "${notes}".` : ''}\n` +
      `Analyze the exercise form like an experienced strength coach: setup, joint alignment, range of motion, bar/limb path, and control. ` +
      `Score overall form 1-10 (10 = textbook). Use 0 ONLY if the images don't show enough to assess, and say why in summary. ` +
      `List genuine strengths, then the highest-impact improvements (max 4) — each with the issue, why it matters, and one short coaching cue to fix it. ` +
      `Only add injury_flags for patterns that meaningfully raise injury risk. Finish with one next_step drill or focus for their next session. ` +
      `Be encouraging but honest — this person wants to get better.`,
  });
  const result = await structuredRequest({
    content,
    system: 'You are an expert strength and conditioning coach who analyzes exercise technique from photos and video frames.',
    schema: FORMCHECK_SCHEMA,
    maxTokens: 10000,
  });

  const thumb = (frames && frames[0] && frames[0].length < 200_000) ? frames[0] : null;
  const saved = db.prepare(
    'INSERT INTO form_checks (date, exercise, score, summary, feedback, thumb, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(date, result.exercise_detected || exercise, result.score, result.summary, JSON.stringify(result), thumb, now());
  return { id: Number(saved.lastInsertRowid), ...result };
}

const MUSCLE_RECS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['exercises', 'note'],
  properties: {
    exercises: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'scheme', 'why'],
        properties: {
          name: { type: 'string' },
          scheme: { type: 'string' },
          why: { type: 'string' },
        },
      },
    },
    note: { type: 'string' },
  },
};

export async function muscleRecs({ muscle, today }) {
  const profile = getProfile();
  const library = db.prepare('SELECT name, equipment, category FROM exercises WHERE muscle = ?').all(muscle);
  const recentEquip = db.prepare(
    `SELECT DISTINCT e.equipment FROM sets s JOIN exercises e ON e.id = s.exercise_id
     JOIN workouts w ON w.id = s.workout_id WHERE w.date >= date(?, '-60 days') AND e.equipment IS NOT NULL`
  ).all(today).map((r) => r.equipment);
  const recentForMuscle = db.prepare(
    `SELECT e.name, COUNT(*) c FROM sets s JOIN exercises e ON e.id = s.exercise_id
     JOIN workouts w ON w.id = s.workout_id
     WHERE e.muscle = ? AND w.date >= date(?, '-28 days') GROUP BY e.name ORDER BY c DESC LIMIT 8`
  ).all(muscle, today);

  const result = await structuredRequest({
    system: 'You are an expert strength coach recommending exercises inside the Ascend fitness app.',
    content: [{
      type: 'text',
      text:
        `Recommend exactly 4 exercises for the "${muscle}" muscle group for this user.\n` +
        `User: goal = ${profile?.goal || 'maintain'}, activity = ${profile?.activity || 'moderate'}.\n` +
        `Equipment they've actually used in the last 60 days: ${recentEquip.length ? recentEquip.join(', ') : 'none logged yet — assume gym + bodyweight'}.\n` +
        `What they've done for this muscle in the last 4 weeks: ${recentForMuscle.length ? recentForMuscle.map((r) => `${r.name} (${r.c} sets)`).join(', ') : 'nothing'}.\n` +
        `Prefer exercise names from this app library so they can be logged directly: ${library.map((l) => l.name).join(', ')}.\n` +
        `Pick a smart mix (a main compound, then complements; vary from what they've been repeating; respect their equipment). ` +
        `"scheme" is sets × reps like "3 × 8-12". "why" is one short, motivating sentence specific to them. ` +
        `"note" is one sentence of overall guidance for this muscle group for this user.`,
    }],
    schema: MUSCLE_RECS_SCHEMA,
    maxTokens: 6000,
  });
  return result;
}

export async function testKey() {
  const c = client();
  const resp = await c.messages.create({
    model: model(),
    max_tokens: 32,
    messages: [{ role: 'user', content: 'Reply with exactly: ok' }],
  });
  trackUsage(resp.usage);
  return { ok: true, model: resp.model };
}
