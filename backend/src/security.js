/**
 * Security primitives: password hashing, signed tokens, request validation,
 * sanitisation and a small in-memory rate limiter.
 *
 * Rules enforced here (see spec §29, §47):
 *  - passwords are never stored in plain text (scrypt + per-user salt)
 *  - tokens are HMAC-signed and expire; the payload is never trusted blindly
 *  - role and vendor-tenant checks happen on the server for every request
 *  - free text is stripped of markup before it is persisted
 */
const crypto = require('crypto');
const config = require('./config');

/* ------------------------------------------------------------------ passwords */

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };

function hashPassword(plain) {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(String(plain), salt, SCRYPT.keylen, SCRYPT).toString('hex');
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt}$${derived}`;
}

function verifyPassword(plain, stored) {
  try {
    const [scheme, N, r, p, salt, hash] = String(stored).split('$');
    if (scheme !== 'scrypt') return false;
    const derived = crypto.scryptSync(String(plain), salt, Number(hash.length / 2), {
      N: Number(N),
      r: Number(r),
      p: Number(p),
    });
    return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), derived);
  } catch {
    return false;
  }
}

/* --------------------------------------------------------------------- tokens */

const b64u = (buf) => Buffer.from(buf).toString('base64url');
const unb64u = (str) => Buffer.from(str, 'base64url').toString('utf8');

function signToken(payload, ttlSeconds = config.token.accessTtlSeconds) {
  const now = Math.floor(Date.now() / 1000);
  const body = { ...payload, iss: config.token.issuer, iat: now, exp: now + ttlSeconds };
  const head = b64u(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const data = `${head}.${b64u(JSON.stringify(body))}`;
  const sig = crypto.createHmac('sha256', config.appSecret).update(data).digest('base64url');
  return `${data}.${sig}`;
}

function verifyToken(token) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [head, body, sig] = parts;
  const expected = crypto.createHmac('sha256', config.appSecret).update(`${head}.${body}`).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(unb64u(body));
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;
    if (payload.iss !== config.token.issuer) return null;
    return payload;
  } catch {
    return null;
  }
}

const randomToken = (bytes = 24) => crypto.randomBytes(bytes).toString('base64url');

/* --------------------------------------------------------------- sanitisation */

/** Removes markup from free text so stored data can never carry a script. */
function sanitizeText(value, max = 2000) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/<\s*(script|style|iframe|object|embed|link|meta)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/javascript:/gi, '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

/** Allows simple http(s) URLs only — used for logos, banners and social links. */
function sanitizeUrl(value, max = 500) {
  const v = sanitizeText(value, max);
  if (!v) return '';
  if (!/^https?:\/\/[^\s]+$/i.test(v)) return '';
  return v;
}

const slugify = (value) =>
  String(value)
    .toLowerCase()
    .trim()
    .replace(/['"]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);

/* ----------------------------------------------------------------- validation */

const RE = {
  email: /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i,
  phone: /^[0-9+\-\s]{8,15}$/,
  pincode: /^[1-9][0-9]{5}$/,
  password: /^.{8,72}$/,
  slug: /^[a-z0-9](?:[a-z0-9-]{1,46})[a-z0-9]$/,
};

class ApiError extends Error {
  constructor(status, message, code = undefined, details = undefined) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

const badRequest = (msg, details) => new ApiError(400, msg, 'bad_request', details);
const unauthorized = (msg = 'Please sign in to continue.') => new ApiError(401, msg, 'unauthorized');
const forbidden = (msg = "You don't have permission to perform this action.") => new ApiError(403, msg, 'forbidden');
const notFound = (msg = 'Not found.') => new ApiError(404, msg, 'not_found');
const conflict = (msg) => new ApiError(409, msg, 'conflict');

function assert(cond, message, details) {
  if (!cond) throw badRequest(message, details);
}

/* -------------------------------------------------------------- rate limiting */

const buckets = new Map();

/** Sliding-window limiter keyed by `${scope}:${ip}`. */
function rateLimit(scope, max = config.limits.authMaxAttempts, windowMs = config.limits.authWindowMs) {
  return (req, res, next) => {
    const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'local').toString().split(',')[0].trim();
    const key = `${scope}:${ip}`;
    const now = Date.now();
    const hits = (buckets.get(key) || []).filter((t) => now - t < windowMs);
    if (hits.length >= max) {
      const retry = Math.ceil((windowMs - (now - hits[0])) / 1000);
      res.set('Retry-After', String(retry));
      return next(new ApiError(429, `Too many attempts. Please try again in ${retry}s.`, 'rate_limited'));
    }
    hits.push(now);
    buckets.set(key, hits);
    if (buckets.size > 5000) {
      for (const [k, v] of buckets) if (!v.length || now - v[v.length - 1] > windowMs) buckets.delete(k);
    }
    next();
  };
}

/* ------------------------------------------------------------------- helpers */

/** Strips fields a client must never set (balances, roles, statuses…). */
function pick(source, keys) {
  const out = {};
  for (const k of keys) if (source && source[k] !== undefined) out[k] = source[k];
  return out;
}

function publicUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    phone: user.phone,
    role: user.role,
    vendorId: user.vendorId || null,
    emailVerified: !!user.emailVerified,
    avatarColor: user.avatarColor || '#6D5EF6',
    createdAt: user.createdAt,
  };
}

module.exports = {
  hashPassword,
  verifyPassword,
  signToken,
  verifyToken,
  randomToken,
  sanitizeText,
  sanitizeUrl,
  slugify,
  RE,
  ApiError,
  badRequest,
  unauthorized,
  forbidden,
  notFound,
  conflict,
  assert,
  rateLimit,
  pick,
  publicUser,
};
