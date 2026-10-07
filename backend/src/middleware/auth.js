/**
 * Auth + tenancy middleware.
 *
 * Spec §29/§30/§47: hiding a button is not security. Every request that touches
 * vendor data is checked against the *authenticated user's* vendorId, never
 * against anything the browser sent.
 */
const db = require('../db');
const config = require('../config');
const { verifyToken, unauthorized, forbidden, notFound, ApiError, publicUser } = require('../security');

const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function securityHeaders(req, res, next) {
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('X-Frame-Options', 'SAMEORIGIN');
  res.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  if (config.isProd) res.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
}

function readToken(req) {
  const header = req.headers.authorization || '';
  if (header.startsWith('Bearer ')) return header.slice(7).trim();
  return null;
}

/** Populates req.user / req.session when a valid token is present (never throws). */
function attachUser(req, _res, next) {
  req.user = null;
  req.session = null;
  const token = readToken(req);
  if (!token) return next();
  const payload = verifyToken(token);
  if (!payload) return next();
  const session = db.find('sessions', (s) => s.id === payload.sid && s.revokedAt === null);
  if (!session) return next();
  const user = db.findOneBy('users', 'id', session.userId);
  if (!user || user.disabled) return next();
  req.session = session;
  req.user = publicUser(user);
  req.userRecord = user;
  next();
}

function requireAuth(req, _res, next) {
  if (!req.user) return next(unauthorized());
  next();
}

function requireRole(...roles) {
  return (req, _res, next) => {
    if (!req.user) return next(unauthorized());
    if (!roles.includes(req.user.role)) return next(forbidden());
    next();
  };
}

const requireVendor = requireRole('vendor', 'super_admin');
const requireAdmin = requireRole('super_admin');
const requireCustomer = requireRole('customer', 'vendor', 'super_admin', 'staff');

/**
 * Returns the vendor row owned by the current user.
 * A vendor can only ever resolve to their own tenant.
 */
function ownVendor(req) {
  if (!req.user) throw unauthorized();
  if (req.user.role === 'super_admin') return null; // admin routes handle this explicitly
  if (!req.user.vendorId) throw forbidden('Your account is not linked to a store yet.');
  const vendor = db.findOneBy('vendors', 'id', req.user.vendorId);
  if (!vendor) throw notFound('Store not found.');
  return vendor;
}

/** Hard tenant isolation check — the single defence against IDOR. */
function assertTenant(req, resourceVendorId) {
  if (req.user?.role === 'super_admin') return;
  if (!req.user?.vendorId) throw unauthorized();
  if (String(resourceVendorId) !== String(req.user.vendorId)) {
    throw forbidden("This record belongs to another store, so it can't be accessed from your account.");
  }
}

/** Resolves the vendor for public storefront routes (by slug, never by trust). */
function publicVendorBySlug(req, _res, next) {
  const slug = String(req.params.slug || req.query.vendor || '').toLowerCase().trim();
  if (!slug) return next(notFound('Store not specified.'));
  const vendor = db.find('vendors', (v) => v.slug === slug);
  if (!vendor) return next(notFound(`No store found for "${slug}".`));
  if (vendor.status === 'suspended') return next(forbidden('This store is temporarily unavailable.'));
  if (vendor.status !== 'active' && !req.query.preview) return next(notFound('This store is not live yet.'));
  req.vendor = vendor;
  next();
}

function notFoundHandler(req, _res, next) {
  next(new ApiError(404, `No API route for ${req.method} ${req.originalUrl}`, 'route_not_found'));
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, _next) {
  const status = err instanceof ApiError ? err.status : err.status || 500;
  const payload = {
    ok: false,
    error: {
      code: err.code || (status >= 500 ? 'server_error' : 'error'),
      // Never leak internals for 5xx — show a friendly message instead (spec §35)
      message: status >= 500 ? 'Something went wrong on our side. Please try again.' : err.message,
      details: err.details,
    },
  };
  if (status >= 500) console.error(`[api] ${req.method} ${req.originalUrl} →`, err);
  res.status(status).json(payload);
}

module.exports = {
  asyncHandler,
  securityHeaders,
  attachUser,
  requireAuth,
  requireRole,
  requireVendor,
  requireAdmin,
  requireCustomer,
  ownVendor,
  assertTenant,
  publicVendorBySlug,
  notFoundHandler,
  errorHandler,
};
