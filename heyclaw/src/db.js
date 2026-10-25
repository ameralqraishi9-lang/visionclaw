/**
 * SQLite persistence. One file, no external services.
 *
 * The whole app talks to SQLite through the handful of helpers below so the
 * storage layer stays swappable (swap for Postgres when a single box stops
 * being enough). `node:sqlite` ships with Node 22 — the app has no npm
 * dependencies at all.
 */
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

const here = dirname(fileURLToPath(import.meta.url));
export const ROOT = join(here, "..");

const DB_PATH = process.env.HEYCLAW_DB || join(ROOT, "data", "heyclaw.db");

mkdirSync(dirname(DB_PATH), { recursive: true });

export const db = new DatabaseSync(DB_PATH);

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  PRAGMA busy_timeout = 5000;

  CREATE TABLE IF NOT EXISTS users (
    id             TEXT PRIMARY KEY,
    email          TEXT NOT NULL UNIQUE COLLATE NOCASE,
    name           TEXT NOT NULL,
    password_hash  TEXT NOT NULL,
    wake_word      TEXT NOT NULL DEFAULT 'Hey Claw',
    voice          TEXT NOT NULL DEFAULT 'Sol · warm',
    language       TEXT NOT NULL DEFAULT 'en-US',
    autonomy       TEXT NOT NULL DEFAULT 'balanced',
    proactive      INTEGER NOT NULL DEFAULT 1,
    retention_days INTEGER NOT NULL DEFAULT 30,
    created_at     TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS auth_tokens (
    token_hash TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    last_used  TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS devices (
    id         TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name       TEXT NOT NULL,
    kind       TEXT NOT NULL,
    model      TEXT NOT NULL,
    firmware   TEXT NOT NULL,
    battery    INTEGER NOT NULL,
    status     TEXT NOT NULL,
    last_seen  TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sessions (
    id               TEXT PRIMARY KEY,
    user_id          TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title            TEXT NOT NULL,
    mode             TEXT NOT NULL DEFAULT 'glasses',
    device_id        TEXT,
    started_at       TEXT NOT NULL,
    ended_at         TEXT,
    duration_seconds INTEGER NOT NULL DEFAULT 0,
    summary          TEXT NOT NULL DEFAULT '',
    actions_count    INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS events (
    id         TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role       TEXT NOT NULL,
    text       TEXT NOT NULL,
    meta       TEXT NOT NULL DEFAULT '{}',
    ts         TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS memories (
    id           TEXT PRIMARY KEY,
    user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    fact         TEXT NOT NULL,
    detail       TEXT NOT NULL DEFAULT '',
    category     TEXT NOT NULL DEFAULT 'preference',
    source       TEXT NOT NULL DEFAULT 'learned',
    confidence   INTEGER NOT NULL DEFAULT 80,
    pinned       INTEGER NOT NULL DEFAULT 0,
    last_used_at TEXT,
    created_at   TEXT NOT NULL,
    updated_at   TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS nudges (
    id            TEXT PRIMARY KEY,
    user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title         TEXT NOT NULL,
    trigger_kind  TEXT NOT NULL DEFAULT 'place',
    condition     TEXT NOT NULL,
    action        TEXT NOT NULL,
    priority      TEXT NOT NULL DEFAULT 'normal',
    active        INTEGER NOT NULL DEFAULT 1,
    fire_count    INTEGER NOT NULL DEFAULT 0,
    last_fired_at TEXT,
    created_at    TEXT NOT NULL,
    updated_at    TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS nudge_events (
    id       TEXT PRIMARY KEY,
    nudge_id TEXT NOT NULL REFERENCES nudges(id) ON DELETE CASCADE,
    user_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    message  TEXT NOT NULL,
    kind     TEXT NOT NULL DEFAULT 'spoken',
    fired_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS connections (
    id            TEXT PRIMARY KEY,
    user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    slug          TEXT NOT NULL,
    status        TEXT NOT NULL DEFAULT 'connected',
    account_label TEXT NOT NULL DEFAULT '',
    scopes        TEXT NOT NULL DEFAULT '',
    connected_at  TEXT NOT NULL,
    UNIQUE (user_id, slug)
  );

  CREATE TABLE IF NOT EXISTS activity (
    id         TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind       TEXT NOT NULL,
    message    TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_events_session ON events (session_id, ts);
  CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions (user_id, started_at DESC);
  CREATE INDEX IF NOT EXISTS idx_memories_user ON memories (user_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_nudges_user ON nudges (user_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_nudge_events_user ON nudge_events (user_id, fired_at DESC);
`);

/** Short, URL-safe id. Random enough for a pilot, sortable enough to debug. */
export function uid(prefix = "") {
  const raw = randomUUID().replaceAll("-", "").slice(0, 12);
  return prefix ? `${prefix}_${raw}` : raw;
}

export const nowIso = () => new Date().toISOString();

export const DAY = 86_400_000;

export function daysAgo(n, hour = 12, minute = 0) {
  const d = new Date(Date.now() - n * DAY);
  d.setHours(hour, minute, 0, 0);
  return d.toISOString();
}

/** SELECT many rows. */
export function all(sql, ...params) {
  return db.prepare(sql).all(...params);
}

/** SELECT one row (or undefined). */
export function get(sql, ...params) {
  return db.prepare(sql).get(...params);
}

/** INSERT / UPDATE / DELETE. */
export function run(sql, ...params) {
  return db.prepare(sql).run(...params);
}

/** Run a function inside a transaction; rolls back on throw. */
export function tx(fn) {
  db.exec("BEGIN");
  try {
    const out = fn();
    db.exec("COMMIT");
    return out;
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

export function bool(value) {
  return value ? 1 : 0;
}

export function parseJson(value, fallback = {}) {
  try {
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

/** Append to the account activity feed. */
export function logActivity(userId, kind, message, at = nowIso()) {
  run(
    "INSERT INTO activity (id, user_id, kind, message, created_at) VALUES (?, ?, ?, ?, ?)",
    uid("act"),
    userId,
    kind,
    message,
    at
  );
}
