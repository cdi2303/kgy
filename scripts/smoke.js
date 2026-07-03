'use strict';

// End-to-end smoke test: create -> ping (up) -> go overdue (down) -> ping (recovery).
// Run: npm run smoke   (uses a throwaway DB + fast worker interval)

const fs = require('fs');
const path = require('path');
const http = require('http');
const assert = require('assert');

// Configure BEFORE requiring the app (config reads env at load time).
const TEST_DB = path.resolve(__dirname, '..', 'data', 'smoke-test.sqlite');
process.env.DB_PATH = 'data/smoke-test.sqlite';
process.env.PORT = '3999';
process.env.BASE_URL = 'http://localhost:3999';
process.env.WORKER_INTERVAL_SECONDS = '1';
process.env.REALERT_INTERVAL_SECONDS = '1'; // fast still-down reminders for the test
process.env.ADMIN_TOKEN = 'smoke-admin-token';
// Telegram owner-alert path pointed at a local capture server.
process.env.TELEGRAM_BOT_TOKEN = 'smoketoken';
process.env.TELEGRAM_CHAT_ID = '12345';
process.env.TELEGRAM_API_BASE = 'http://localhost:3998';
process.env.RESEND_API_KEY = 'test-key'; // Resend HTTP path → local capture
process.env.RESEND_API_BASE = 'http://localhost:3997';
process.env.EMAIL_FROM = 'CronWatch <test@cronwatch.test>';
for (const f of [TEST_DB, TEST_DB + '-wal', TEST_DB + '-shm']) { try { fs.unlinkSync(f); } catch {} }

const { start } = require('../src/server');
const notify = require('../src/notify');
const { assertPublicUrl } = require('../src/ssrf');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const j = (res) => res.json();
const base = process.env.BASE_URL;

(async () => {
  // Capture server stands in for the owner's KakaoWork webhook.
  const captured = [];
  const capSrv = http.createServer((req, res) => {
    let b = ''; req.on('data', (c) => (b += c));
    req.on('end', () => { try { captured.push(JSON.parse(b)); } catch {} res.end('ok'); });
  }).listen(3998);

  // Separate capture for the Resend email HTTP API.
  const emailCaptured = [];
  const emailSrv = http.createServer((req, res) => {
    let b = ''; req.on('data', (c) => (b += c));
    req.on('end', () => { try { emailCaptured.push(JSON.parse(b)); } catch {} res.writeHead(200, {'Content-Type':'application/json'}); res.end('{"id":"test"}'); });
  }).listen(3997);

  const server = start();
  await sleep(300);
  try {
    // 0. auth: checks API requires login now
    const unauth = await fetch(`${base}/api/checks`);
    assert.strictEqual(unauth.status, 401, 'checks require auth');
    const reg = await fetch(`${base}/api/auth/register`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'smoke@user.test', password: 'password123' }),
    });
    assert.strictEqual(reg.status, 201, 'register ok');
    const cookie = (reg.headers.get('set-cookie') || '').split(';')[0];
    assert.ok(cookie.startsWith('cw_session='), 'session cookie set');
    const AJ = { 'Content-Type': 'application/json', Cookie: cookie };
    const A = { Cookie: cookie };
    console.log('  ✓ register + session');

    // 1. create a check: period 1s, grace 1s
    const created = await j(await fetch(`${base}/api/checks`, {
      method: 'POST', headers: AJ,
      body: JSON.stringify({ name: 'smoke-job', period_seconds: 1, grace_seconds: 1 }),
    }));
    assert.ok(created.id, 'check created');
    assert.ok(created.ping_url, 'has ping_url');
    console.log('  ✓ create check', created.id);

    // 2. ping -> up
    await fetch(created.ping_url);
    let detail = await j(await fetch(`${base}/api/checks/${created.id}`, { headers: A }));
    assert.strictEqual(detail.status, 'up', 'up after ping');
    console.log('  ✓ ping -> up');

    // 3. stop pinging; wait past period+grace+worker tick -> down
    // (long enough for the still-down re-alert to fire at least once too)
    await sleep(6000);
    detail = await j(await fetch(`${base}/api/checks/${created.id}`, { headers: A }));
    assert.strictEqual(detail.status, 'down', 'down after overdue');
    console.log('  ✓ overdue -> down');

    // 4. ping again -> recovery (up)
    await fetch(created.ping_url);
    detail = await j(await fetch(`${base}/api/checks/${created.id}`, { headers: A }));
    assert.strictEqual(detail.status, 'up', 'recovered to up');
    console.log('  ✓ recovery -> up');

    // 5. events recorded, incl. down/up transitions; uptime computed
    assert.ok(detail.events.length >= 2, 'events recorded');
    assert.ok(detail.events.some((e) => e.type === 'down'), 'down transition event logged');
    assert.ok(detail.events.some((e) => e.type === 'up'), 'up transition event logged');
    assert.ok(detail.uptime_7d > 0 && detail.uptime_7d < 1, `uptime reflects downtime (got ${detail.uptime_7d})`);
    console.log(`  ✓ events (${detail.events.length}) + transitions + uptime ${(detail.uptime_7d * 100).toFixed(1)}%`);

    // 6. waitlist: signup, dedupe, count
    const w1 = await j(await fetch(`${base}/api/waitlist`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'tester@example.com', source: 'smoke' }),
    }));
    assert.strictEqual(w1.already, false, 'first signup is new');
    const w2 = await j(await fetch(`${base}/api/waitlist`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'tester@example.com' }),
    }));
    assert.strictEqual(w2.already, true, 'duplicate detected');
    const bad = await fetch(`${base}/api/waitlist`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'not-an-email' }),
    });
    assert.strictEqual(bad.status, 400, 'invalid email rejected');
    const { count } = await j(await fetch(`${base}/api/waitlist/count`));
    assert.strictEqual(count, 1, 'waitlist count = 1');
    console.log('  ✓ waitlist signup/dedupe/validation/count');

    // 7. KakaoWork webhook adapter (pure-function checks, no network)
    assert.strictEqual(notify.isKakaoWork('https://api.kakaowork.com/v1/incoming/xyz'), true, 'kakaowork host detected');
    assert.strictEqual(notify.isKakaoWork('https://kakaowork.com/abc'), true, 'apex kakaowork detected');
    assert.strictEqual(notify.isKakaoWork('https://hooks.slack.com/services/x'), false, 'slack is not kakaowork');
    assert.strictEqual(notify.isKakaoWork('https://notkakaowork.com/x'), false, 'lookalike host rejected');
    assert.strictEqual(notify.isKakaoWork('https://kakaowork.com.evil.net/x'), false, 'suffix-spoof host rejected');
    assert.match(notify.kakaoworkText({ name: 'backup' }, 'down'), /신호 끊김/, 'down text');
    assert.match(notify.kakaoworkText({ name: 'backup' }, 'up'), /정상 복구/, 'up text');
    console.log('  ✓ kakaowork adapter (detect + spoof-reject + text)');

    // 8. landing views + stats (conversion denominator)
    await fetch(`${base}/`); await fetch(`${base}/`);
    const stats = await j(await fetch(`${base}/api/stats`));
    assert.ok(stats.landing_views >= 2, 'landing views counted');
    assert.strictEqual(stats.signups, 1, 'signups in stats');
    assert.ok(stats.conversion > 0, 'conversion computed');
    console.log('  ✓ stats:', JSON.stringify(stats));

    // 9. waitlist rate limit (max 10 / IP) — keep POSTing until a 429 appears
    let saw429 = false;
    for (let k = 0; k < 14; k++) {
      const r = await fetch(`${base}/api/waitlist`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: `rl${k}@example.com` }),
      });
      if (r.status === 429) { saw429 = true; break; }
    }
    assert.ok(saw429, 'rate limit returns 429 past the cap');
    console.log('  ✓ waitlist rate limit (429 enforced)');

    // 10. admin signal: auth + masking
    const noAuth = await fetch(`${base}/api/admin/signal`);
    assert.strictEqual(noAuth.status, 401, 'admin requires token');
    const wrong = await fetch(`${base}/api/admin/signal`, { headers: { 'x-admin-token': 'nope' } });
    assert.strictEqual(wrong.status, 401, 'wrong token rejected');
    const sig = await j(await fetch(`${base}/api/admin/signal`, { headers: { 'x-admin-token': 'smoke-admin-token' } }));
    assert.ok(Array.isArray(sig.by_channel) && Array.isArray(sig.recent), 'signal shape');
    assert.ok(sig.recent.length >= 1, 'has recent signups');
    assert.ok(sig.recent.every((r) => r.email.includes('*')), 'emails masked');
    assert.ok(!sig.recent.some((r) => r.email === 'tester@example.com'), 'no raw email leaked');
    console.log('  ✓ admin signal (auth + masking)');

    // 10a. usage metrics (Stage 3): counts reflect the up->down->up cycle above
    const u = sig.usage;
    assert.ok(u && u.users >= 1, 'users counted');
    assert.ok((u.checks.up || 0) >= 1, 'recovered check counted as up');
    assert.ok(u.pings_24h >= 2 && u.pings_7d >= u.pings_24h, 'pings counted');
    assert.ok(u.alerts.down >= 1 && u.alerts.up >= 1, 'alert transitions counted');
    assert.ok(u.alerts.repeat >= 1, 'repeat alerts counted');
    assert.ok(u.email.sent >= 2, 'emails counted');
    console.log(`  ✓ usage metrics (users=${u.users}, pings24h=${u.pings_24h}, alerts=${JSON.stringify(u.alerts)}, email=${JSON.stringify(u.email)})`);

    // 10b. admin backup: auth-gated, returns a real SQLite snapshot
    const bkNo = await fetch(`${base}/api/admin/backup`);
    assert.strictEqual(bkNo.status, 401, 'backup requires token');
    const bk = await fetch(`${base}/api/admin/backup`, { headers: { 'x-admin-token': 'smoke-admin-token' } });
    assert.strictEqual(bk.status, 200, 'backup ok');
    const buf = Buffer.from(await bk.arrayBuffer());
    assert.ok(buf.subarray(0, 16).toString('latin1').startsWith('SQLite format 3'), 'backup is a sqlite file');
    assert.ok(buf.length > 4096, 'backup non-trivial size');
    console.log(`  ✓ admin backup (${buf.length} bytes, sqlite magic ok)`);

    // 11. owner signup alert via Telegram path (fire-and-forget → settle delay)
    await sleep(400);
    assert.ok(captured.length >= 1, 'owner alert fired on new signup');
    assert.strictEqual(captured[0].chat_id, '12345', 'telegram chat_id sent');
    assert.match(captured[0].text, /새 대기자/, 'alert text shape');
    assert.ok(captured[0].text.includes('*'), 'email masked in alert');
    console.log(`  ✓ owner signup alert via telegram (${captured.length} captured)`);

    // 12. multitenancy: a second user cannot see the first user's check
    const reg2 = await fetch(`${base}/api/auth/register`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'smoke2@user.test', password: 'password123' }),
    });
    const cookie2 = (reg2.headers.get('set-cookie') || '').split(';')[0];
    const cross = await fetch(`${base}/api/checks/${created.id}`, { headers: { Cookie: cookie2 } });
    assert.strictEqual(cross.status, 404, 'cross-tenant check hidden');
    const ownList = await j(await fetch(`${base}/api/checks`, { headers: { Cookie: cookie2 } }));
    assert.strictEqual(ownList.length, 0, 'new user sees no checks');
    console.log('  ✓ multitenancy (cross-tenant 404, isolated list)');

    // 13. SSRF guard on user webhook URLs
    const blocked = ['http://169.254.169.254/latest/meta-data/', 'http://127.0.0.1/', 'http://10.1.2.3/', 'ftp://x/'];
    for (const u of blocked) {
      let threw = false;
      try { await assertPublicUrl(u); } catch { threw = true; }
      assert.ok(threw, `blocked: ${u}`);
    }
    await assertPublicUrl('https://8.8.8.8/'); // public IP literal allowed
    console.log('  ✓ ssrf guard (private/metadata blocked, public allowed)');

    // 14. email channel via Resend HTTP API (captured locally)
    assert.ok(notify.emailEnabled(), 'email enabled');
    const ok = await notify.sendEmail('owner@test', '⛔ [job] 다운', '본문');
    assert.strictEqual(ok, true, 'resend send ok');
    const m = emailCaptured.find((e) => e.to === 'owner@test');
    assert.ok(m, 'email POSTed to resend');
    assert.ok(m.subject.includes('job') && m.from, 'subject+from');
    // down/recovery alerts (sections 3-4) also emailed the check owner via Resend
    assert.ok(emailCaptured.some((e) => e.to === 'smoke@user.test'), 'alert emails sent to owner');
    console.log('  ✓ email channel (Resend HTTP API + alert path)');

    // 15. alert policy: still-down re-alert throttled by interval, recovery only once
    const ownerMails = emailCaptured.filter((e) => e.to === 'smoke@user.test');
    const downMails = ownerMails.filter((e) => e.subject.includes('다운'));
    assert.ok(downMails.length >= 2, `re-alert while still down (got ${downMails.length})`);
    assert.ok(downMails.some((e) => e.subject.includes('여전히')), 'repeat alert labeled');
    const upMails = ownerMails.filter((e) => e.subject.includes('복구'));
    assert.strictEqual(upMails.length, 1, 'recovery alerts exactly once');
    console.log(`  ✓ alert policy (${downMails.length} down alerts incl. repeats, 1 recovery)`);

    console.log('\nSMOKE PASS ✅');
    server.close(); capSrv.close(); emailSrv.close();
    process.exit(0);
  } catch (err) {
    console.error('\nSMOKE FAIL ❌', err.message);
    server.close(); capSrv.close(); emailSrv.close();
    process.exit(1);
  }
})();
