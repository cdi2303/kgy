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
`);

const now = () => Date.now();
const uid = () => crypto.randomUUID();
const token = () => crypto.randomBytes(16).toString('hex');

// ---- prepared statements ----
const stmt = {
  insertCheck: db.prepare(`
    INSERT INTO checks (id, name, ping_token, period_seconds, grace_seconds, status, created_at, webhook_url)
    VALUES (@id, @name, @ping_token, @period_seconds, @grace_seconds, 'new', @created_at, @webhook_url)
  `),
  listChecks: db.prepare(`SELECT * FROM checks ORDER BY created_at DESC`),
  getCheck: db.prepare(`SELECT * FROM checks WHERE id = ?`),
  getByToken: db.prepare(`SELECT * FROM checks WHERE ping_token = ?`),
  deleteCheck: db.prepare(`DELETE FROM checks WHERE id = ?`),
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
};

module.exports = {
  raw: db,
  now,

  createCheck({ name, period_seconds, grace_seconds = 60, webhook_url = null }) {
    const row = {
      id: uid(),
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

  listChecks: () => stmt.listChecks.all(),
  getCheck: (id) => stmt.getCheck.get(id),
  getByToken: (t) => stmt.getByToken.get(t),
  deleteCheck: (id) => stmt.deleteCheck.run(id),
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
};
