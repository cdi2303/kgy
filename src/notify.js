'use strict';

// Alert delivery. PoC: log to console + optional per-check webhook (POST JSON).
// TODO(MVP): email (SMTP), Slack, Telegram. Keep channel logic isolated here.

async function fireWebhook(url, payload) {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(5000),
    });
    return res.ok;
  } catch (err) {
    console.error(`[notify] webhook failed for ${url}: ${err.message}`);
    return false;
  }
}

// state: 'down' | 'up' (recovery)
async function alert(check, state) {
  const label = state === 'down' ? 'DOWN ⛔' : 'RECOVERED ✅';
  console.log(`[ALERT] ${label}  "${check.name}" (${check.id})`);

  if (check.webhook_url) {
    await fireWebhook(check.webhook_url, {
      event: state === 'down' ? 'check.down' : 'check.up',
      check_id: check.id,
      name: check.name,
      status: state,
      at: new Date().toISOString(),
    });
  }
}

module.exports = { alert };
