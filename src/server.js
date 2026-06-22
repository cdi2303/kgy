'use strict';

// App entrypoint: wires Express, mounts routes, serves the dashboard,
// and starts the background worker.

const path = require('path');
const express = require('express');
const config = require('./config');
const worker = require('./worker');
const db = require('./db');

const app = express();
app.use(express.json());

// Always public: landing page + waitlist (Stage 1 market validation).
app.use('/api/waitlist', require('./routes/waitlist'));
app.get('/', (req, res) => {
  db.bumpStat('landing_views'); // rough denominator for conversion (incl. bots)
  res.sendFile(path.join(config.ROOT, 'public', 'landing.html'));
});
// Validation metrics: views vs signups. Numbers only, no PII.
app.get('/api/stats', (req, res) => {
  const views = db.statValue('landing_views');
  const signups = db.waitlistCount();
  res.json({ landing_views: views, signups, conversion: views ? +(signups / views).toFixed(4) : 0 });
});
app.use(express.static(path.join(config.ROOT, 'public')));
app.get('/health', (req, res) => res.json({ ok: true }));

// Full product (dashboard + monitoring). Disabled in LANDING_ONLY mode so a
// public Stage 1 deploy doesn't expose the unauthenticated checks API.
if (!config.LANDING_ONLY) {
  app.use('/api/checks', require('./routes/checks'));
  app.use('/ping', require('./routes/ping')); // short URLs for cron scripts
  app.get('/app', (req, res) => res.sendFile(path.join(config.ROOT, 'public', 'index.html')));
}

function start() {
  if (!config.LANDING_ONLY) worker.start();
  return app.listen(config.PORT, () => {
    const mode = config.LANDING_ONLY ? 'LANDING_ONLY' : 'full';
    console.log(`[server] CronWatch (${mode}) listening on ${config.BASE_URL}`);
  });
}

// Only auto-start when run directly (so tests/smoke can import the app).
if (require.main === module) start();

module.exports = { app, start };
