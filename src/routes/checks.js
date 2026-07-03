'use strict';

// CRUD API for monitors (checks). JSON in/out. Consumed by the dashboard.
// All routes are user-scoped: mounted behind requireAuth, every query keys
// on req.user.id so one account can never see/touch another's checks.

const express = require('express');
const db = require('../db');
const config = require('../config');

const router = express.Router();

// Per-plan check limits.
const PLAN_LIMITS = { free: 3, pro: 20, team: Infinity };

function pingUrl(check) {
  return `${config.BASE_URL}/ping/${check.ping_token}`;
}

function present(check) {
  if (!check) return null;
  const { user_id, ...rest } = check; // don't leak internal owner id
  return { ...rest, ping_url: pingUrl(check) };
}

// List (own checks only)
router.get('/', (req, res) => {
  res.json(db.listChecks(req.user.id).map(present));
});

// Create (enforces plan limit)
router.post('/', (req, res) => {
  const { name, period_seconds, grace_seconds, webhook_url } = req.body || {};

  if (!name || typeof name !== 'string') {
    return res.status(400).json({ error: 'name is required' });
  }
  const period = parseInt(period_seconds, 10);
  if (!Number.isInteger(period) || period <= 0) {
    return res.status(400).json({ error: 'period_seconds must be a positive integer' });
  }
  const grace = grace_seconds === undefined ? 60 : parseInt(grace_seconds, 10);
  if (!Number.isInteger(grace) || grace < 0) {
    return res.status(400).json({ error: 'grace_seconds must be a non-negative integer' });
  }
  let webhook = null;
  if (webhook_url) {
    if (typeof webhook_url !== 'string' || !/^https?:\/\//.test(webhook_url)) {
      return res.status(400).json({ error: 'webhook_url must be an http(s) URL' });
    }
    webhook = webhook_url;
  }

  const limit = PLAN_LIMITS[req.user.plan] ?? PLAN_LIMITS.free;
  if (db.countChecks(req.user.id) >= limit) {
    return res.status(402).json({ error: `현재 플랜(${req.user.plan}) 한도(${limit}개)를 초과했습니다. 업그레이드가 필요합니다.` });
  }

  const check = db.createCheck({
    user_id: req.user.id,
    name,
    period_seconds: period,
    grace_seconds: grace,
    webhook_url: webhook,
  });
  res.status(201).json(present(check));
});

// Uptime fraction over the trailing window, from 'down'/'up' transition
// events. Unknown periods (before any transition was recorded) count as up.
const UPTIME_WINDOW_MS = 7 * 24 * 3600 * 1000;
function uptime(check, windowMs = UPTIME_WINDOW_MS) {
  const nowMs = db.now();
  const start = Math.max(nowMs - windowMs, check.created_at);
  const total = nowMs - start;
  if (total <= 0) return null;
  let state = db.lastTransitionBefore(check.id, start) || 'up';
  let at = start;
  let downMs = 0;
  for (const ev of db.transitionsSince(check.id, start)) {
    if (state === 'down') downMs += ev.received_at - at;
    state = ev.type;
    at = ev.received_at;
  }
  if (state === 'down') downMs += nowMs - at;
  return (total - downMs) / total;
}

// Detail (+ recent events + uptime)
router.get('/:id', (req, res) => {
  const check = db.getCheck(req.params.id, req.user.id);
  if (!check) return res.status(404).json({ error: 'not found' });
  res.json({
    ...present(check),
    uptime_7d: uptime(check),
    events: db.recentEvents(check.id, 50),
  });
});

// Pause / resume
router.post('/:id/pause', (req, res) => {
  const check = db.getCheck(req.params.id, req.user.id);
  if (!check) return res.status(404).json({ error: 'not found' });
  db.setStatus(check.id, 'paused');
  res.json(present(db.getCheck(check.id, req.user.id)));
});

router.post('/:id/resume', (req, res) => {
  const check = db.getCheck(req.params.id, req.user.id);
  if (!check) return res.status(404).json({ error: 'not found' });
  // Resume = start watching from now: reset the clock so the deadline is
  // computed fresh, otherwise an old created_at would trip instantly.
  db.recordPing(check.id);
  res.json(present(db.getCheck(check.id, req.user.id)));
});

// Delete
router.delete('/:id', (req, res) => {
  const check = db.getCheck(req.params.id, req.user.id);
  if (!check) return res.status(404).json({ error: 'not found' });
  db.deleteCheck(check.id, req.user.id);
  res.json({ ok: true });
});

module.exports = router;
