'use strict';

// Minimal in-memory fixed-window rate limiter middleware.
// Single-instance only (counts reset on restart, not shared across replicas)
// — fine for a Stage 1 validation deploy. Protects public endpoints from
// spam that would pollute the waitlist data the go/no-go call relies on.

function clientIp(req) {
  return (req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown')
    .toString().split(',')[0].trim();
}

function rateLimit({ max = 10, windowMs = 10 * 60 * 1000 } = {}) {
  const hits = new Map(); // ip -> { count, resetAt }

  return function (req, res, next) {
    const now = Date.now();
    const ip = clientIp(req);
    let e = hits.get(ip);

    if (!e || now > e.resetAt) {
      e = { count: 0, resetAt: now + windowMs };
      hits.set(ip, e);
    }
    e.count += 1;

    if (e.count > max) {
      const retry = Math.ceil((e.resetAt - now) / 1000);
      res.set('Retry-After', String(retry));
      return res.status(429).json({ error: '요청이 너무 많습니다. 잠시 후 다시 시도해주세요.' });
    }

    // Opportunistic cleanup so the map can't grow unbounded.
    if (hits.size > 5000) {
      for (const [k, v] of hits) if (now > v.resetAt) hits.delete(k);
    }
    next();
  };
}

module.exports = { rateLimit };
