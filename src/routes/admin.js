'use strict';

// Owner-only validation signal view. Token-protected; 404s when ADMIN_TOKEN
// is unset so the surface doesn't exist unless the owner enabled it.
// Emails are masked in output (org privacy rule) — counts + channel mix +
// "are these real humans or @example.com bots" is what the owner needs.

const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const db = require('../db');
const config = require('../config');

const router = express.Router();

// Constant-time token compare (hash first so unequal lengths don't throw/leak).
function tokenOk(provided) {
  if (!config.ADMIN_TOKEN || !provided) return false;
  const a = crypto.createHash('sha256').update(String(provided)).digest();
  const b = crypto.createHash('sha256').update(config.ADMIN_TOKEN).digest();
  return crypto.timingSafeEqual(a, b);
}

router.use((req, res, next) => {
  if (!config.ADMIN_TOKEN) return res.status(404).json({ error: 'not found' });
  const provided = req.get('x-admin-token') || req.query.token;
  if (!tokenOk(provided)) return res.status(401).json({ error: 'unauthorized' });
  next();
});

function maskEmail(email) {
  const [user, domain] = String(email).split('@');
  if (!domain) return '***';
  const head = user.slice(0, 2);
  return `${head}${'*'.repeat(Math.max(1, user.length - 2))}@${domain}`;
}

// DB snapshot download — disaster recovery (volumes can vanish; it happened).
// Pulled nightly by .github/workflows/backup.yml, encrypted before storage.
router.get('/backup', async (req, res) => {
  const tmp = path.join(os.tmpdir(), `cronwatch-backup-${Date.now()}.sqlite`);
  try {
    await db.backupTo(tmp);
    res.download(tmp, 'cronwatch.sqlite', () => fs.unlink(tmp, () => {}));
  } catch (err) {
    fs.unlink(tmp, () => {});
    console.error(`[admin] backup failed: ${err.message}`);
    res.status(500).json({ error: 'backup failed' });
  }
});

router.get('/signal', (req, res) => {
  const views = db.statValue('landing_views');
  const signups = db.waitlistCount();

  // Product usage (Stage 3): who's actually using the monitor.
  const toMap = (rows, key) => Object.fromEntries(rows.map((r) => [r[key], r.n]));
  const pingsOf = (m) => (m.success || 0) + (m.start || 0) + (m.fail || 0);
  const nowMs = db.now();
  const e24 = toMap(db.eventCountsSince(nowMs - 24 * 3600 * 1000), 'type');
  const e7d = toMap(db.eventCountsSince(nowMs - 7 * 24 * 3600 * 1000), 'type');

  res.json({
    views,
    signups,
    conversion: views ? +(signups / views).toFixed(4) : 0,
    by_channel: db.waitlistByChannel(),
    recent: db.waitlistRecent(50).map((r) => ({
      email: maskEmail(r.email),
      source: r.source,
      created_at: r.created_at,
    })),
    usage: {
      users: db.countUsers(),
      checks: toMap(db.checksByStatus(), 'status'), // {up: n, down: n, new: n, paused: n}
      pings_24h: pingsOf(e24),
      pings_7d: pingsOf(e7d),
      alerts: {
        down: db.statValue('alert_down'),
        repeat: db.statValue('alert_repeat'),
        up: db.statValue('alert_up'),
      },
      email: { sent: db.statValue('email_sent'), failed: db.statValue('email_failed') },
    },
  });
});

module.exports = router;
