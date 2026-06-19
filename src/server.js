'use strict';

// App entrypoint: wires Express, mounts routes, serves the dashboard,
// and starts the background worker.

const path = require('path');
const express = require('express');
const config = require('./config');
const worker = require('./worker');

const app = express();
app.use(express.json());

// Always public: landing page + waitlist (Stage 1 market validation).
app.use('/api/waitlist', require('./routes/waitlist'));
app.get('/', (req, res) => res.sendFile(path.join(config.ROOT, 'public', 'landing.html')));
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
