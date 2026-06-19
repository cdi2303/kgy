'use strict';

// Background evaluator. Periodically scans active checks and decides
// whether each is overdue (DOWN). This is the core "dead man's switch":
// a check that stops pinging eventually trips, even though nothing called us.

const db = require('./db');
const notify = require('./notify');
const config = require('./config');

// Deadline = (last ping, or creation if never pinged) + period + grace.
function deadlineOf(check) {
  const base = check.last_ping_at || check.created_at;
  return base + (check.period_seconds + check.grace_seconds) * 1000;
}

function evaluate() {
  const nowMs = db.now();
  for (const check of db.activeChecks()) {
    const overdue = nowMs > deadlineOf(check);

    if (overdue && check.status !== 'down') {
      db.setStatus(check.id, 'down');
      notify.alert(check, 'down');
    }
    // Recovery (up) is handled at ping time in routes/ping.js, where we
    // know a check was down and just received a heartbeat.
  }
}

let timer = null;

function start() {
  if (timer) return;
  const ms = config.WORKER_INTERVAL_SECONDS * 1000;
  evaluate();
  timer = setInterval(evaluate, ms);
  console.log(`[worker] scanning every ${config.WORKER_INTERVAL_SECONDS}s`);
}

function stop() {
  if (timer) clearInterval(timer);
  timer = null;
}

module.exports = { start, stop, evaluate };
