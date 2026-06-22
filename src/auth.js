'use strict';

// Auth: scrypt password hashing + cookie-based sessions (DB-backed).
// No external deps; cookies parsed/set manually.

const crypto = require('crypto');
const db = require('./db');
const config = require('./config');

const COOKIE = 'cw_session';
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(pw, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(pw, stored) {
  const [salt, hash] = String(stored).split(':');
  if (!salt || !hash) return false;
  const test = crypto.scryptSync(pw, salt, 64);
  const known = Buffer.from(hash, 'hex');
  return test.length === known.length && crypto.timingSafeEqual(test, known);
}

function parseCookies(req) {
  const out = {};
  const raw = req.headers.cookie;
  if (!raw) return out;
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i > -1) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function setSessionCookie(res, token) {
  const secure = config.BASE_URL.startsWith('https') ? '; Secure' : '';
  const maxAge = Math.floor(SESSION_TTL_MS / 1000);
  res.append('Set-Cookie', `${COOKIE}=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${maxAge}${secure}`);
}

function clearSessionCookie(res) {
  res.append('Set-Cookie', `${COOKIE}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0`);
}

// Populate req.user from the session cookie when valid (no-op otherwise).
function attachUser(req, res, next) {
  const token = parseCookies(req)[COOKIE];
  if (token) {
    const sess = db.getSession(token);
    if (sess && sess.expires_at > db.now()) {
      const user = db.getUserById(sess.user_id);
      if (user) req.user = user;
    } else if (sess) {
      db.deleteSession(token); // expired
    }
  }
  next();
}

function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: '로그인이 필요합니다.' });
  next();
}

module.exports = {
  COOKIE,
  SESSION_TTL_MS,
  hashPassword,
  verifyPassword,
  setSessionCookie,
  clearSessionCookie,
  attachUser,
  requireAuth,
};
