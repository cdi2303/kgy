'use strict';

// App entrypoint: wires Express, mounts routes, serves the dashboard,
// and starts the background worker.

const path = require('path');
const express = require('express');
const config = require('./config');
const worker = require('./worker');

const app = express();
app.use(express.json());

// API
app.use('/api/checks', require('./routes/checks'));
app.use('/api/waitlist', require('./routes/waitlist'));
// Heartbeat ingestion (no /api prefix: short URLs for cron scripts)
app.use('/ping', require('./routes/ping'));

// Landing page (market validation) at root; dashboard at /app.
app.get('/', (req, res) => res.sendFile(path.join(config.ROOT, 'public', 'landing.html')));
app.get('/app', (req, res) => res.sendFile(path.join(config.ROOT, 'public', 'index.html')));

// Static assets
app.use(express.static(path.join(config.ROOT, 'public')));

app.get('/health', (req, res) => res.json({ ok: true }));

function start() {
  worker.start();
  return app.listen(config.PORT, () => {
    console.log(`[server] CronWatch listening on ${config.BASE_URL}`);
  });
}

// Only auto-start when run directly (so tests/smoke can import the app).
if (require.main === module) start();

module.exports = { app, start };
