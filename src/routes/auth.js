'use strict';

// Account endpoints: register, login, logout, me.

const express = require('express');
const db = require('../db');
const auth = require('../auth');
const { rateLimit } = require('../ratelimit');

const router = express.Router();
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Throttle credential endpoints (brute-force / spam).
const limit = rateLimit({ max: 20, windowMs: 10 * 60 * 1000 });

function publicUser(u) {
  return { id: u.id, email: u.email, plan: u.plan };
}

function startSession(res, userId) {
  const token = db.newSessionToken();
  db.createSession(userId, token, auth.SESSION_TTL_MS);
  auth.setSessionCookie(res, token);
}

router.post('/register', limit, (req, res) => {
  const email = (req.body && req.body.email || '').toString().trim().toLowerCase();
  const password = (req.body && req.body.password || '').toString();

  if (!EMAIL_RE.test(email) || email.length > 254) {
    return res.status(400).json({ error: '올바른 이메일을 입력해주세요.' });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: '비밀번호는 8자 이상이어야 합니다.' });
  }
  if (db.getUserByEmail(email)) {
    return res.status(409).json({ error: '이미 가입된 이메일입니다.' });
  }

  const user = db.createUser({ email, pass_hash: auth.hashPassword(password) });
  startSession(res, user.id);
  res.status(201).json({ user: publicUser(user) });
});

router.post('/login', limit, (req, res) => {
  const email = (req.body && req.body.email || '').toString().trim().toLowerCase();
  const password = (req.body && req.body.password || '').toString();

  const user = db.getUserByEmail(email);
  if (!user || !auth.verifyPassword(password, user.pass_hash)) {
    return res.status(401).json({ error: '이메일 또는 비밀번호가 올바르지 않습니다.' });
  }
  startSession(res, user.id);
  res.json({ user: publicUser(user) });
});

router.post('/logout', (req, res) => {
  const cookie = (req.headers.cookie || '').split(';').map((s) => s.trim()).find((s) => s.startsWith(auth.COOKIE + '='));
  if (cookie) db.deleteSession(cookie.slice(auth.COOKIE.length + 1));
  auth.clearSessionCookie(res);
  res.json({ ok: true });
});

router.get('/me', (req, res) => {
  if (!req.user) return res.status(401).json({ error: '로그인이 필요합니다.' });
  res.json({ user: publicUser(req.user) });
});

module.exports = router;
