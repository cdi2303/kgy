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
  // While a check stays down, re-alert at most once per this interval
  // (dup suppression + reminder). 0 = only the down transition alerts.
  REALERT_INTERVAL_SECONDS: parseInt(process.env.REALERT_INTERVAL_SECONDS || '3600', 10),
  DB_PATH: path.resolve(ROOT, process.env.DB_PATH || 'data/cronwatch.sqlite'),

  // Stage 1 production: serve ONLY the landing page + waitlist API.
  // Hides the unauthenticated checks/ping API and the worker, so a public
  // deploy can't be abused (SSRF via webhook_url, junk checks). Full app
  // (dashboard + monitoring) runs locally with this unset/false.
  LANDING_ONLY: process.env.LANDING_ONLY === 'true',

  // Owner-only token to view the validation signal (/admin). When unset the
  // admin endpoint 404s entirely. Secret — set via env, never hardcode.
  ADMIN_TOKEN: process.env.ADMIN_TOKEN || '',

  // Optional owner signup alerts. Two channels (Telegram takes precedence):
  //  - Telegram: set TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID
  //  - any {text} webhook (KakaoWork/Slack): set SIGNUP_ALERT_WEBHOOK
  // All unset = no owner alerts.
  SIGNUP_ALERT_WEBHOOK: process.env.SIGNUP_ALERT_WEBHOOK || '',
  TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN || '',
  TELEGRAM_CHAT_ID: process.env.TELEGRAM_CHAT_ID || '',
  TELEGRAM_API_BASE: process.env.TELEGRAM_API_BASE || 'https://api.telegram.org',

  // Email alerts (down/recovery → check owner). All unset = email disabled.
  // PREFERRED on Railway: Resend HTTP API (port 443) — PaaS block outbound SMTP.
  RESEND_API_KEY: process.env.RESEND_API_KEY || '',
  RESEND_API_BASE: process.env.RESEND_API_BASE || 'https://api.resend.com',
  EMAIL_FROM: process.env.EMAIL_FROM || 'CronWatch <onboarding@resend.dev>',
  // SMTP fallback (works off-Railway). SMTP_HOST='json' = jsonTransport (tests).
  SMTP_HOST: process.env.SMTP_HOST || '',
  SMTP_PORT: parseInt(process.env.SMTP_PORT || '587', 10),
  SMTP_USER: process.env.SMTP_USER || '',
  SMTP_PASS: process.env.SMTP_PASS || '',
  SMTP_FROM: process.env.SMTP_FROM || '',
};
