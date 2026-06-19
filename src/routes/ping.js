'use strict';

// Heartbeat ingestion. The cron job calls this URL when it runs.
//   GET/POST /ping/:token          -> success heartbeat
//   GET/POST /ping/:token/start    -> job started (optional, for runtime tracking)
//   GET/POST /ping/:token/fail     -> job failed explicitly
//
// Kept dead-simple so a one-line `curl` at the end of a cron script works.

const express = require('express');
const db = require('../db');
const notify = require('../notify');

const router = express.Router();

function clientIp(req) {
  return (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').toString().split(',')[0].trim();
}

function handle(type) {
  return async (req, res) => {
    const check = db.getByToken(req.params.token);
    if (!check) return res.status(404).json({ error: 'unknown token' });

    db.addEvent({ check_id: check.id, type, source_ip: clientIp(req) });

    if (type === 'fail') {
      if (check.status !== 'down') {
        db.setStatus(check.id, 'down');
        notify.alert(check, 'down');
      }
      return res.json({ ok: true, status: 'down' });
    }

    if (type === 'success') {
      const wasDown = check.status === 'down';
      db.recordPing(check.id);          // stamps time + flips to 'up'
      if (wasDown) notify.alert(check, 'up');
      return res.json({ ok: true, status: 'up' });
    }

    // 'start' is informational only; does not change up/down state.
    return res.json({ ok: true });
  };
}

router.all('/:token/start', handle('start'));
router.all('/:token/fail', handle('fail'));
router.all('/:token', handle('success'));

module.exports = router;
