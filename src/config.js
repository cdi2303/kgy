'use strict';

// Central config. PoC pulls from process.env with safe defaults.
// No secrets live here — credentials (SMTP, etc.) come from .env later.

const path = require('path');

const ROOT = path.resolve(__dirname, '..');

module.exports = {
  ROOT,
  PORT: parseInt(process.env.PORT || '3000', 10),
  BASE_URL: process.env.BASE_URL || `http://localhost:${process.env.PORT || '3000'}`,
  WORKER_INTERVAL_SECONDS: parseInt(process.env.WORKER_INTERVAL_SECONDS || '15', 10),
  DB_PATH: path.resolve(ROOT, process.env.DB_PATH || 'data/cronwatch.sqlite'),
};
