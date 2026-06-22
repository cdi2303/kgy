'use strict';

// Stage 1 market-validation: landing-page waitlist signups.
//   POST /api/waitlist  { email, source? }
//   GET  /api/waitlist/count   -> { count }  (social proof on the page)
// Emails are PII: stored only, never echoed back in responses or logs.

const express = require('express');
const db = require('../db');
const { rateLimit } = require('../ratelimit');

const router = express.Router();

// Conservative email shape check (not full RFC; good enough to reject junk).
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Cap signups per IP so bots/spam can't pollute the validation data.
router.post('/', rateLimit({ max: 10, windowMs: 10 * 60 * 1000 }), (req, res) => {
  const email = (req.body && req.body.email || '').toString().trim().toLowerCase();
  const source = req.body && req.body.source ? req.body.source.toString().slice(0, 64) : null;

  if (!EMAIL_RE.test(email) || email.length > 254) {
    return res.status(400).json({ error: '올바른 이메일을 입력해주세요.' });
  }

  const added = db.addWaitlist(email, source);
  // Same response whether new or duplicate — avoids leaking who is registered.
  return res.status(201).json({ ok: true, already: !added });
});

router.get('/count', (req, res) => {
  res.json({ count: db.waitlistCount() });
});

module.exports = router;
