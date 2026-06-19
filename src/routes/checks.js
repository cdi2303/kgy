'use strict';

// CRUD API for monitors (checks). JSON in/out. Consumed by the dashboard.

const express = require('express');
const db = require('../db');
const config = require('../config');

const router = express.Router();

function pingUrl(check) {
  return `${config.BASE_URL}/ping/${check.ping_token}`;
}

function present(check) {
  if (!check) return null;
  return { ...check, ping_url: pingUrl(check) };
}

// List
router.get('/', (req, res) => {
  res.json(db.listChecks().map(present));
});

// Create
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

  const check = db.createCheck({ name, period_seconds: period, grace_seconds: grace, webhook_url: webhook });
  res.status(201).json(present(check));
});

// Detail (+ recent events)
router.get('/:id', (req, res) => {
  const check = db.getCheck(req.params.id);
  if (!check) return res.status(404).json({ error: 'not found' });
  res.json({ ...present(check), events: db.recentEvents(check.id, 20) });
});

// Pause / resume
router.post('/:id/pause', (req, res) => {
  const check = db.getCheck(req.params.id);
  if (!check) return res.status(404).json({ error: 'not found' });
  db.setStatus(check.id, 'paused');
  res.json(present(db.getCheck(check.id)));
});

router.post('/:id/resume', (req, res) => {
  const check = db.getCheck(req.params.id);
  if (!check) return res.status(404).json({ error: 'not found' });
  // Resume = start watching from now: reset the clock so the deadline is
  // computed fresh, otherwise an old created_at would trip instantly.
  db.recordPing(check.id);
  res.json(present(db.getCheck(check.id)));
});

// Delete
router.delete('/:id', (req, res) => {
  const check = db.getCheck(req.params.id);
  if (!check) return res.status(404).json({ error: 'not found' });
  db.deleteCheck(check.id);
  res.json({ ok: true });
});

module.exports = router;
