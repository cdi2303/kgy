'use strict';

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
    const payload = isKakaoWork(check.webhook_url)
      ? { text: kakaoworkText(check, state) }
      : {
          event: state === 'down' ? 'check.down' : 'check.up',
          check_id: check.id,
          name: check.name,
          status: state,
          at: new Date().toISOString(),
        };
    await fireWebhook(check.webhook_url, payload);
  }
}

module.exports = { alert, isKakaoWork, kakaoworkText };
