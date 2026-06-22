'use strict';

// End-to-end smoke test: create -> ping (up) -> go overdue (down) -> ping (recovery).
// Run: npm run smoke   (uses a throwaway DB + fast worker interval)

const fs = require('fs');
const path = require('path');
const assert = require('assert');

// Configure BEFORE requiring the app (config reads env at load time).
const TEST_DB = path.resolve(__dirname, '..', 'data', 'smoke-test.sqlite');
process.env.DB_PATH = 'data/smoke-test.sqlite';
process.env.PORT = '3999';
process.env.BASE_URL = 'http://localhost:3999';
process.env.WORKER_INTERVAL_SECONDS = '1';
for (const f of [TEST_DB, TEST_DB + '-wal', TEST_DB + '-shm']) { try { fs.unlinkSync(f); } catch {} }

const { start } = require('../src/server');
const notify = require('../src/notify');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const j = (res) => res.json();
const base = process.env.BASE_URL;

(async () => {
  const server = start();
  await sleep(300);
  try {
    // 1. create a check: period 1s, grace 1s
    const created = await j(await fetch(`${base}/api/checks`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'smoke-job', period_seconds: 1, grace_seconds: 1 }),
    }));
    assert.ok(created.id, 'check created');
    assert.ok(created.ping_url, 'has ping_url');
    console.log('  ✓ create check', created.id);

    // 2. ping -> up
    await fetch(created.ping_url);
    let detail = await j(await fetch(`${base}/api/checks/${created.id}`));
    assert.strictEqual(detail.status, 'up', 'up after ping');
    console.log('  ✓ ping -> up');

    // 3. stop pinging; wait past period+grace+worker tick -> down
    await sleep(4000);
    detail = await j(await fetch(`${base}/api/checks/${created.id}`));
    assert.strictEqual(detail.status, 'down', 'down after overdue');
    console.log('  ✓ overdue -> down');

    // 4. ping again -> recovery (up)
    await fetch(created.ping_url);
    detail = await j(await fetch(`${base}/api/checks/${created.id}`));
    assert.strictEqual(detail.status, 'up', 'recovered to up');
    console.log('  ✓ recovery -> up');

    // 5. events recorded
    assert.ok(detail.events.length >= 2, 'events recorded');
    console.log('  ✓ events recorded:', detail.events.length);

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

    console.log('\nSMOKE PASS ✅');
    server.close();
    process.exit(0);
  } catch (err) {
    console.error('\nSMOKE FAIL ❌', err.message);
    server.close();
    process.exit(1);
  }
})();
