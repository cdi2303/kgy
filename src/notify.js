'use strict';

const config = require('./config');
const db = require('./db');
const { assertPublicUrl } = require('./ssrf');
const nodemailer = require('nodemailer');

// Lazy SMTP transport. SMTP_HOST='json' = jsonTransport (no real send, tests).
let _transport;
function transport() {
  if (_transport !== undefined) return _transport;
  if (!config.SMTP_HOST) { _transport = null; return null; }
  _transport = config.SMTP_HOST === 'json'
    ? nodemailer.createTransport({ jsonTransport: true })
    : nodemailer.createTransport({
        host: config.SMTP_HOST,
        port: config.SMTP_PORT,
        secure: config.SMTP_PORT === 465,
        auth: config.SMTP_USER ? { user: config.SMTP_USER, pass: config.SMTP_PASS } : undefined,
      });
  return _transport;
}

function emailEnabled() {
  return !!(config.RESEND_API_KEY || config.SMTP_HOST);
}

// Resend HTTP API (works through Railway; SMTP ports are blocked there).
async function sendViaResend(to, subject, text) {
  try {
    const res = await fetch(`${config.RESEND_API_BASE}/emails`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: config.EMAIL_FROM, to, subject, text }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      console.error(`[notify] resend email failed to ${to}: HTTP ${res.status}`);
      return false;
    }
    return true;
  } catch (err) {
    console.error(`[notify] resend email failed to ${to}: ${err.message}`);
    return false;
  }
}

async function sendEmail(to, subject, text) {
  let ok;
  if (config.RESEND_API_KEY) {
    ok = await sendViaResend(to, subject, text);
  } else {
    const t = transport();
    if (!t) return false; // not configured — not a delivery failure
    try {
      ok = !!(await t.sendMail({ from: config.SMTP_FROM || config.EMAIL_FROM, to, subject, text }));
    } catch (err) {
      console.error(`[notify] email failed to ${to}: ${err.message}`);
      ok = false;
    }
  }
  db.bumpStat(ok ? 'email_sent' : 'email_failed'); // usage metrics (/admin)
  return ok;
}

// Alert delivery. PoC: log to console + optional per-check webhook (POST JSON).
// If the webhook URL is a KakaoWork incoming webhook, send its expected
// { text } chat format instead of the generic event payload.
// TODO(MVP): email (SMTP), AlimTalk (Solapi). See ALIMTALK.md.

// KakaoWork incoming webhooks live on the kakaowork.com domain. Detect by
// host so generic/programmatic webhooks keep receiving the structured payload.
function isKakaoWork(url) {
  try {
    return /(^|\.)kakaowork\.com$/i.test(new URL(url).hostname);
  } catch {
    return false;
  }
}

// Human-readable line for a chat channel (KakaoWork expects { text }).
function kakaoworkText(check, state) {
  return state === 'down'
    ? `⛔ [${check.name}] 신호 끊김 — 배치 점검 필요`
    : `✅ [${check.name}] 정상 복구`;
}

async function fireWebhook(url, payload) {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      redirect: 'manual', // don't let a 30x bounce us to an internal host
      signal: AbortSignal.timeout(5000),
    });
    return res.ok;
  } catch (err) {
    console.error(`[notify] webhook failed for ${url}: ${err.message}`);
    return false;
  }
}

// For USER-supplied webhook URLs (check.webhook_url): SSRF-guard first.
// Owner-config URLs (Telegram/SIGNUP_ALERT_WEBHOOK) are operator-trusted and
// use fireWebhook directly.
async function fireUserWebhook(url, payload) {
  try {
    await assertPublicUrl(url);
  } catch (err) {
    console.error(`[notify] blocked user webhook ${url}: ${err.message}`);
    return false;
  }
  return fireWebhook(url, payload);
}

// state: 'down' | 'up' (recovery). opts.repeat = still-down reminder
// (worker re-alert), not a fresh transition.
async function alert(check, state, { repeat = false } = {}) {
  const label = state === 'down' ? (repeat ? 'STILL DOWN ⛔' : 'DOWN ⛔') : 'RECOVERED ✅';
  console.log(`[ALERT] ${label}  "${check.name}" (${check.id})`);
  db.bumpStat(state === 'down' ? (repeat ? 'alert_repeat' : 'alert_down') : 'alert_up'); // usage metrics

  if (check.webhook_url) {
    const payload = isKakaoWork(check.webhook_url)
      ? { text: kakaoworkText(check, state) }
      : {
          event: state === 'down' ? 'check.down' : 'check.up',
          check_id: check.id,
          name: check.name,
          status: state,
          repeat,
          at: new Date().toISOString(),
        };
    await fireUserWebhook(check.webhook_url, payload);
  }

  // Email the check's owner (if SMTP configured and the check has one).
  if (emailEnabled() && check.user_id) {
    const owner = db.getUserById(check.user_id);
    if (owner) {
      const subject = state === 'down'
        ? (repeat ? `⛔ [${check.name}] 모니터 여전히 다운` : `⛔ [${check.name}] 모니터 다운`)
        : `✅ [${check.name}] 복구됨`;
      const body = state === 'down'
        ? `"${check.name}" 작업의 신호가 끊겼습니다. 배치/크론을 점검하세요.\n\n${config.BASE_URL}/app`
        : `"${check.name}" 작업이 정상 복구되었습니다.\n\n${config.BASE_URL}/app`;
      await sendEmail(owner.email, subject, body);
    }
  }
}

// Owner ping (e.g. new signup). Telegram if configured, else a {text} webhook
// (KakaoWork/Slack). No-op when neither is set.
async function notifyOwner(text) {
  if (config.TELEGRAM_BOT_TOKEN && config.TELEGRAM_CHAT_ID) {
    const url = `${config.TELEGRAM_API_BASE}/bot${config.TELEGRAM_BOT_TOKEN}/sendMessage`;
    return fireWebhook(url, { chat_id: config.TELEGRAM_CHAT_ID, text });
  }
  if (config.SIGNUP_ALERT_WEBHOOK) {
    return fireWebhook(config.SIGNUP_ALERT_WEBHOOK, { text });
  }
  return false;
}

module.exports = { alert, isKakaoWork, kakaoworkText, notifyOwner, sendEmail, emailEnabled };
