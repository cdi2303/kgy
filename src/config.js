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

  // Stage 1 production: serve ONLY the landing page + waitlist API.
  // Hides the unauthenticated checks/ping API and the worker, so a public
  // deploy can't be abused (SSRF via webhook_url, junk checks). Full app
  // (dashboard + monitoring) runs locally with this unset/false.
  LANDING_ONLY: process.env.LANDING_ONLY === 'true',

  // Owner-only token to view the validation signal (/admin). When unset the
  // admin endpoint 404s entirely. Secret — set via env, never hardcode.
  ADMIN_TOKEN: process.env.ADMIN_TOKEN || '',

  // Optional: webhook the owner gets pinged on for each new signup (KakaoWork
  // incoming webhook, or any {text}-style webhook). Unset = no owner alerts.
  SIGNUP_ALERT_WEBHOOK: process.env.SIGNUP_ALERT_WEBHOOK || '',
};
