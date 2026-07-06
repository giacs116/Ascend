import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { EXERCISES, FOODS, DEFAULT_ROUTINES } from './seeds.js';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
export const DATA_DIR = path.join(ROOT, 'data');
mkdirSync(DATA_DIR, { recursive: true });

export const db = new DatabaseSync(path.join(DATA_DIR, 'ascend.db'));

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS profile (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    name TEXT NOT NULL,
    sex TEXT NOT NULL,
    birthdate TEXT NOT NULL,
    height_cm REAL NOT NULL,
    activity TEXT NOT NULL,
    goal TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);

  CREATE TABLE IF NOT EXISTS weight_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL UNIQUE,
    weight_kg REAL NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS measurements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL,
    kind TEXT NOT NULL,
    value_cm REAL NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS foods (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    serving TEXT NOT NULL,
    calories REAL NOT NULL,
    protein_g REAL NOT NULL DEFAULT 0,
    carbs_g REAL NOT NULL DEFAULT 0,
    fat_g REAL NOT NULL DEFAULT 0,
    sugar_g REAL NOT NULL DEFAULT 0,
    is_custom INTEGER NOT NULL DEFAULT 0,
    use_count INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS food_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL,
    meal TEXT NOT NULL,
    name TEXT NOT NULL,
    qty TEXT,
    calories REAL NOT NULL,
    protein_g REAL NOT NULL DEFAULT 0,
    carbs_g REAL NOT NULL DEFAULT 0,
    fat_g REAL NOT NULL DEFAULT 0,
    sugar_g REAL NOT NULL DEFAULT 0,
    source TEXT NOT NULL DEFAULT 'manual',
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_food_entries_date ON food_entries(date);

  CREATE TABLE IF NOT EXISTS water_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL,
    ml REAL NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_water_date ON water_log(date);

  CREATE TABLE IF NOT EXISTS exercises (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    category TEXT NOT NULL,
    muscle TEXT,
    equipment TEXT,
    is_custom INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS workouts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL,
    name TEXT,
    type TEXT NOT NULL DEFAULT 'strength',
    started_at TEXT,
    ended_at TEXT,
    duration_min REAL,
    notes TEXT,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_workouts_date ON workouts(date);

  CREATE TABLE IF NOT EXISTS sets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    workout_id INTEGER NOT NULL REFERENCES workouts(id) ON DELETE CASCADE,
    exercise_id INTEGER NOT NULL REFERENCES exercises(id),
    set_index INTEGER NOT NULL,
    reps INTEGER,
    weight_kg REAL,
    duration_sec REAL,
    distance_m REAL,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_sets_workout ON sets(workout_id);
  CREATE INDEX IF NOT EXISTS idx_sets_exercise ON sets(exercise_id);

  CREATE TABLE IF NOT EXISTS routines (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    items TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS chat_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS form_checks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL,
    exercise TEXT NOT NULL,
    score INTEGER,
    summary TEXT,
    feedback TEXT NOT NULL,
    thumb TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS muscle_recs (
    muscle TEXT NOT NULL,
    week TEXT NOT NULL,
    data TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (muscle, week)
  );

  CREATE TABLE IF NOT EXISTS schedule_days (
    date TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    label TEXT,
    routine_id INTEGER,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS schedule_weekly (
    dow INTEGER PRIMARY KEY,
    kind TEXT NOT NULL,
    label TEXT,
    routine_id INTEGER,
    created_at TEXT NOT NULL
  );
`);

export const now = () => new Date().toISOString();

export function getSetting(key, fallback = null) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : fallback;
}

export function setSetting(key, value) {
  if (value === null || value === undefined) {
    db.prepare('DELETE FROM settings WHERE key = ?').run(key);
  } else {
    db.prepare(
      'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
    ).run(key, String(value));
  }
}

export function getProfile() {
  return db.prepare('SELECT * FROM profile WHERE id = 1').get() ?? null;
}

export function latestWeight(onOrBefore = null) {
  if (onOrBefore) {
    return db.prepare('SELECT * FROM weight_log WHERE date <= ? ORDER BY date DESC LIMIT 1').get(onOrBefore) ?? null;
  }
  return db.prepare('SELECT * FROM weight_log ORDER BY date DESC LIMIT 1').get() ?? null;
}

// ── One-time seeding ─────────────────────────────────────────
function seed() {
  const exCount = db.prepare('SELECT COUNT(*) AS c FROM exercises').get().c;
  if (exCount === 0) {
    const ins = db.prepare('INSERT INTO exercises (name, category, muscle, equipment) VALUES (?, ?, ?, ?)');
    for (const [name, category, muscle, equipment] of EXERCISES) ins.run(name, category, muscle, equipment);
  }
  const foodCount = db.prepare('SELECT COUNT(*) AS c FROM foods').get().c;
  if (foodCount === 0) {
    const ins = db.prepare(
      'INSERT INTO foods (name, serving, calories, protein_g, carbs_g, fat_g, sugar_g) VALUES (?, ?, ?, ?, ?, ?, ?)'
    );
    for (const [name, serving, cal, p, c, f, s] of FOODS) ins.run(name, serving, cal, p, c, f, s);
  }
  const routineCount = db.prepare('SELECT COUNT(*) AS c FROM routines').get().c;
  if (routineCount === 0) {
    const findEx = db.prepare('SELECT id FROM exercises WHERE name = ?');
    const ins = db.prepare('INSERT INTO routines (name, items, created_at) VALUES (?, ?, ?)');
    for (const r of DEFAULT_ROUTINES) {
      const items = r.items
        .map((n) => findEx.get(n))
        .filter(Boolean)
        .map((row) => ({ exercise_id: row.id, target_sets: 3, target_reps: '8-12' }));
      ins.run(r.name, JSON.stringify(items), now());
    }
  }
}
seed();

// Keep seed exercises in sync with the current taxonomy (idempotent — user data untouched).
function migrateExerciseMuscles() {
  const upd = db.prepare('UPDATE exercises SET muscle = ?, category = ?, equipment = ? WHERE name = ? AND is_custom = 0');
  const ins = db.prepare('INSERT OR IGNORE INTO exercises (name, category, muscle, equipment) VALUES (?, ?, ?, ?)');
  for (const [name, category, muscle, equipment] of EXERCISES) {
    upd.run(muscle, category, equipment, name);
    ins.run(name, category, muscle, equipment);
  }
}
migrateExerciseMuscles();
