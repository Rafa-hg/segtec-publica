const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');

function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

const COOKIE_NAME = 'segtec_pub_session';
const SESSION_HOURS = 12;

function parseCookies(header) {
  const out = {};
  (header || '').split(';').forEach((pair) => {
    const idx = pair.indexOf('=');
    if (idx === -1) return;
    const k = pair.slice(0, idx).trim();
    const v = pair.slice(idx + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  });
  return out;
}

function serializeCookie(name, value, { maxAge } = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`];
  if (maxAge !== undefined) parts.push(`Max-Age=${maxAge}`);
  parts.push('Path=/');
  parts.push('HttpOnly');
  parts.push('Secure');
  parts.push('SameSite=Strict');
  return parts.join('; ');
}

function getSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('Falta configurar la variable de entorno JWT_SECRET.');
  return secret;
}

async function hashPassword(plain) {
  return bcrypt.hash(plain, 10);
}

async function verifyPassword(plain, hash) {
  return bcrypt.compare(plain, hash);
}

function signSession(payload) {
  return jwt.sign(payload, getSecret(), { expiresIn: `${SESSION_HOURS}h` });
}

function readSession(event) {
  const cookies = parseCookies(event.headers && (event.headers.cookie || event.headers.Cookie));
  const token = cookies[COOKIE_NAME];
  if (!token) return null;
  try {
    return jwt.verify(token, getSecret());
  } catch (e) {
    return null;
  }
}

function setSessionCookieHeader(payload) {
  const token = signSession(payload);
  return serializeCookie(COOKIE_NAME, token, { maxAge: SESSION_HOURS * 60 * 60 });
}

function clearSessionCookieHeader() {
  return serializeCookie(COOKIE_NAME, '', { maxAge: 0 });
}

function requireRole(event, role) {
  const session = readSession(event);
  if (!session || session.role !== role) return null;
  return session;
}

function json(statusCode, body, extraHeaders) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json', ...(extraHeaders || {}) },
    body: JSON.stringify(body),
  };
}

module.exports = {
  hashPassword,
  verifyPassword,
  signSession,
  readSession,
  setSessionCookieHeader,
  clearSessionCookieHeader,
  requireRole,
  json,
  generateToken,
};
