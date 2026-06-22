'use strict';

// Data layer. All SQL lives here so the storage engine can be swapped
// (SQLite -> Postgres) without touching routes/worker.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Database = require('better-sqlite3');
const config = require('./config');

// Ensure data dir exists before opening the file.
fs.mkdirSync(path.dirname(config.DB_PATH), { recursive: true });

const db = new Database(config.DB_PATH);
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS checks (
    id              TEXT PRIMARY KEY,
    name            TEXT NOT NULL,
    ping_token      TEXT NOT NULL UNIQUE,
    period_seconds  INTEGER NOT NULL,
    grace_seconds   INTEGER NOT NULL DEFAULT 60,
    status          TEXT NOT NULL DEFAULT 'new',  -- new | up | down | paused
    last_ping_at    INTEGER,                      -- unix ms
    webhook_url     TEXT,
    created_at      INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS events (
    id           TEXT PRIMARY KEY,
    check_id     TEXT NOT NULL,
    type         TEXT NOT NULL,                   -- success | start | fail
    received_at  INTEGER NOT NULL,
    source_ip    TEXT,
    FOREIGN KEY (check_id) REFERENCES checks(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_events_check ON events(check_id, received_at);

  -- Stage 1 market validation: waitlist signups from the landing page.
  CREATE TABLE IF NOT EXISTS waitlist (
    id          TEXT PRIMARY KEY,
    email       TEXT NOT NULL UNIQUE,
    source      TEXT,
    created_at  INTEGER NOT NULL
  );

  -- Simple named counters (e.g. landing_views) for conversion measurement.
  -- No PII, no external tracker — just a denominator for the go/no-go call.
  CREATE TABLE IF NOT EXISTS stats (
    key  TEXT PRIMARY KEY,
    n    INTEGER NOT NULL DEFAULT 0
  );

  -- Stage 2: accounts + sessions (multitenancy).
  CREATE TABLE IF NOT EXISTS users (
    id          TEXT PRIMARY KEY,
    email       TEXT NOT NULL UNIQUE,
    pass_hash   TEXT NOT NULL,           -- scrypt: salt:hash (hex)
    plan        TEXT NOT NULL DEFAULT 'free',
    created_at  INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token       TEXT PRIMARY KEY,
    user_id     TEXT NOT NULL,
    created_at  INTEGER NOT NULL,
    expires_at  INTEGER NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
`);

// Migration: add checks.user_id for multitenancy (older DBs lack it).
const hasUserId = db.prepare(`PRAGMA table_info(checks)`).all().some((c) => c.name === 'user_id');
if (!hasUserId) {
  db.exec(`ALTER TABLE checks ADD COLUMN user_id TEXT`);
}
db.exec(`CREATE INDEX IF NOT EXISTS idx_checks_user ON checks(user_id)`);

const now = () => Date.now();
const uid = () => crypto.randomUUID();
const token = () => crypto.randomBytes(16).toString('hex');

// ---- prepared statements ----
const stmt = {
  insertCheck: db.prepare(`
    INSERT INTO checks (id, user_id, name, ping_token, period_seconds, grace_seconds, status, created_at, webhook_url)
    VALUES (@id, @user_id, @name, @ping_token, @period_seconds, @grace_seconds, 'new', @created_at, @webhook_url)
  `),
  listChecksByUser: db.prepare(`SELECT * FROM checks WHERE user_id = ? ORDER BY created_at DESC`),
  getCheck: db.prepare(`SELECT * FROM checks WHERE id = ?`),
  getCheckOwned: db.prepare(`SELECT * FROM checks WHERE id = ? AND user_id = ?`),
  countChecksByUser: db.prepare(`SELECT COUNT(*) AS n FROM checks WHERE user_id = ?`),
  getByToken: db.prepare(`SELECT * FROM checks WHERE ping_token = ?`),
  deleteCheckOwned: db.prepare(`DELETE FROM checks WHERE id = ? AND user_id = ?`),
  updateStatus: db.prepare(`UPDATE checks SET status = @status WHERE id = @id`),
  recordPing: db.prepare(`UPDATE checks SET last_ping_at = @ts, status = 'up' WHERE id = @id`),
  setPaused: db.prepare(`UPDATE checks SET status = @status WHERE id = @id`),
  activeChecks: db.prepare(`SELECT * FROM checks WHERE status IN ('new','up','down')`),
  insertEvent: db.prepare(`
    INSERT INTO events (id, check_id, type, received_at, source_ip)
    VALUES (@id, @check_id, @type, @received_at, @source_ip)
  `),
  recentEvents: db.prepare(`SELECT * FROM events WHERE check_id = ? ORDER BY received_at DESC LIMIT ?`),
  insertWaitlist: db.prepare(`INSERT OR IGNORE INTO waitlist (id, email, source, created_at) VALUES (@id, @email, @source, @created_at)`),
  countWaitlist: db.prepare(`SELECT COUNT(*) AS n FROM waitlist`),
  bumpStat: db.prepare(`INSERT INTO stats (key, n) VALUES (?, 1) ON CONFLICT(key) DO UPDATE SET n = n + 1`),
  getStat: db.prepare(`SELECT n FROM stats WHERE key = ?`),
  waitlistRecent: db.prepare(`SELECT email, source, created_at FROM waitlist ORDER BY created_at DESC LIMIT ?`),
  waitlistByChannel: db.prepare(`SELECT COALESCE(source,'?') AS source, COUNT(*) AS n FROM waitlist GROUP BY source ORDER BY n DESC`),

  insertUser: db.prepare(`INSERT INTO users (id, email, pass_hash, plan, created_at) VALUES (@id, @email, @pass_hash, 'free', @created_at)`),
  getUserByEmail: db.prepare(`SELECT * FROM users WHERE email = ?`),
  getUserById: db.prepare(`SELECT * FROM users WHERE id = ?`),
  setUserPlan: db.prepare(`UPDATE users SET plan = @plan WHERE id = @id`),
  insertSession: db.prepare(`INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (@token, @user_id, @created_at, @expires_at)`),
  getSession: db.prepare(`SELECT * FROM sessions WHERE token = ?`),
  deleteSession: db.prepare(`DELETE FROM sessions WHERE token = ?`),
  deleteExpiredSessions: db.prepare(`DELETE FROM sessions WHERE expires_at < ?`),
};

module.exports = {
  raw: db,
  now,

  createCheck({ user_id, name, period_seconds, grace_seconds = 60, webhook_url = null }) {
    const row = {
      id: uid(),
      user_id,
      name,
      ping_token: token(),
      period_seconds,
      grace_seconds,
      webhook_url,
      created_at: now(),
    };
    stmt.insertCheck.run(row);
    return stmt.getCheck.get(row.id);
  },

  // User-scoped (multitenancy). getCheck without user is internal-only.
  listChecks: (user_id) => stmt.listChecksByUser.all(user_id),
  getCheck: (id, user_id) => (user_id ? stmt.getCheckOwned.get(id, user_id) : stmt.getCheck.get(id)),
  countChecks: (user_id) => stmt.countChecksByUser.get(user_id).n,
  getByToken: (t) => stmt.getByToken.get(t),
  deleteCheck: (id, user_id) => stmt.deleteCheckOwned.run(id, user_id),
  activeChecks: () => stmt.activeChecks.all(),
  recentEvents: (checkId, limit = 20) => stmt.recentEvents.all(checkId, limit),

  setStatus: (id, status) => stmt.updateStatus.run({ id, status }),

  // Mark a successful ping: stamp time, flip to up.
  recordPing(id, ts = now()) {
    stmt.recordPing.run({ id, ts });
  },

  addEvent({ check_id, type, source_ip = null }) {
    stmt.insertEvent.run({ id: uid(), check_id, type, received_at: now(), source_ip });
  },

  // Returns true if newly added, false if email already on the list.
  addWaitlist(email, source = null) {
    const res = stmt.insertWaitlist.run({ id: uid(), email, source, created_at: now() });
    return res.changes > 0;
  },

  waitlistCount: () => stmt.countWaitlist.get().n,

  bumpStat: (key) => stmt.bumpStat.run(key),
  statValue: (key) => (stmt.getStat.get(key) || { n: 0 }).n,

  waitlistRecent: (limit = 50) => stmt.waitlistRecent.all(limit),
  waitlistByChannel: () => stmt.waitlistByChannel.all(),

  // ---- users / sessions ----
  createUser({ email, pass_hash }) {
    const row = { id: uid(), email, pass_hash, created_at: now() };
    stmt.insertUser.run(row);
    return stmt.getUserById.get(row.id);
  },
  getUserByEmail: (email) => stmt.getUserByEmail.get(email),
  getUserById: (id) => stmt.getUserById.get(id),
  setUserPlan: (id, plan) => stmt.setUserPlan.run({ id, plan }),

  createSession(user_id, sessionToken, ttlMs) {
    const ts = now();
    stmt.insertSession.run({ token: sessionToken, user_id, created_at: ts, expires_at: ts + ttlMs });
  },
  getSession: (t) => stmt.getSession.get(t),
  deleteSession: (t) => stmt.deleteSession.run(t),
  purgeExpiredSessions: () => stmt.deleteExpiredSessions.run(now()),

  newSessionToken: () => crypto.randomBytes(32).toString('hex'),
};
