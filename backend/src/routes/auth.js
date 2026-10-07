/**
 * Authentication routes for the MAIN PLATFORM (custom backend).
 * Firebase Auth is used only by the separate "other apps" — see frontend/js/firebase.js.
 * The two systems are never mixed (spec §27).
 */
const express = require('express');
const db = require('../db');
const config = require('../config');
const {
  hashPassword,
  verifyPassword,
  signToken,
  randomToken,
  sanitizeText,
  sanitizeUrl,
  slugify,
  assert,
  badRequest,
  unauthorized,
  conflict,
  notFound,
  RE,
  publicUser,
  rateLimit,
  pick,
} = require('../security');
const { asyncHandler, requireAuth } = require('../middleware/auth');
const { ok, notify, audit } = require('../respond');
const { VENDOR_STATUSES } = require('../domain');

const router = express.Router();

const BUSINESS_TYPES = [
  'Electronics Retail',
  'Fashion & Apparel',
  'Grocery & Organics',
  'Home & Living',
  'Beauty & Wellness',
  'Sports & Fitness',
  'Books & Stationery',
  'Handmade & Crafts',
  'Services',
  'Other',
];

function issueSession(user) {
  const session = db.insert('sessions', {
    userId: user.id,
    token: randomToken(16),
    userAgent: '',
    ip: '',
    revokedAt: null,
  });
  const token = signToken({ sub: user.id, sid: session.id, role: user.role, vendorId: user.vendorId || null });
  db.update('sessions', session.id, { tokenHash: randomToken(8) });
  return token;
}

/** Where the SPA should send a user once they are signed in (spec §30). */
function homeForRole(user, vendor) {
  if (user.role === 'super_admin') return '/admin/index.html';
  if (user.role === 'vendor') {
    if (!vendor || vendor.status === 'pending_deposit') return '/deposit.html';
    if (vendor.status === 'pending_activation') return '/activation.html';
    return '/admin/dashboard.html';
  }
  return '/vendor/account.html';
}

function authPayload(user, vendor) {
  return {
    user: publicUser(user),
    vendor: vendor ? vendorSnapshot(vendor) : null,
    redirectTo: homeForRole(user, vendor),
  };
}

function vendorSnapshot(vendor) {
  if (!vendor) return null;
  return {
    id: vendor.id,
    slug: vendor.slug,
    name: vendor.name,
    status: vendor.status,
    logo: vendor.logo,
    theme: vendor.theme,
    storefrontUrl: `/vendor/index.html?vendor=${vendor.slug}`,
    activationDueAt: vendor.activationDueAt || null,
    depositPaidAt: vendor.depositPaidAt || null,
    productCount: vendor.productCount || 0,
    orderCount: vendor.orderCount || 0,
  };
}

function uniqueSlug(desired) {
  const base = slugify(desired) || 'store';
  let slug = base;
  let n = 2;
  while (db.find('vendors', (v) => v.slug === slug)) slug = `${base}${n++}`;
  return slug;
}

/* ------------------------------------------------------------------ register */

router.post(
  '/register',
  rateLimit('register', 8),
  asyncHandler(async (req, res) => {
    const b = req.body || {};
    const name = sanitizeText(b.name, 80);
    const email = sanitizeText(b.email, 120).toLowerCase();
    const phone = sanitizeText(b.phone, 20);
    const password = String(b.password || '');
    const businessName = sanitizeText(b.businessName, 120);
    const businessType = sanitizeText(b.businessType, 60);
    const address = sanitizeText(b.address, 200);
    const city = sanitizeText(b.city, 60);
    const state = sanitizeText(b.state, 60);
    const country = sanitizeText(b.country || 'India', 60);
    const pincode = sanitizeText(b.pincode, 10);

    assert(RE.email.test(email), 'Enter a valid email address.');
    assert(RE.phone.test(phone.replace(/\s/g, '')), 'Enter a valid mobile number.');
    assert(name.length >= 3, 'Enter your full name.');
    assert(password.length >= 8, 'Password must be at least 8 characters.');
    assert(password === String(b.confirmPassword || ''), 'Password and confirm password do not match.');
    assert(businessName.length >= 3, 'Enter your business name.');
    assert(BUSINESS_TYPES.includes(businessType), 'Choose a valid business type.', { businessTypes: BUSINESS_TYPES });
    assert(city && state, 'City and state are required.');
    assert(RE.pincode.test(pincode), 'Enter a valid 6 digit pincode.');
    assert(b.agree === true || b.agree === 'true', 'You must accept the Terms & Conditions to continue.');

    if (db.find('users', (u) => u.email === email)) throw conflict('An account with this email already exists. Try signing in.');
    if (db.find('vendors', (v) => v.email === email)) throw conflict('This email is already registered as a store.');

    const slug = uniqueSlug(businessName);
    const vendorId = db.uid('vnd');
    const avatarColor = ['#6D5EF6', '#0EA5E9', '#16A34A', '#F59E0B', '#EC4899'][Math.floor(Math.random() * 5)];

    const vendor = db.insert('vendors', {
      id: vendorId,
      slug,
      name: businessName,
      legalName: businessName,
      ownerName: name,
      email,
      phone,
      tagline: '',
      description: '',
      businessType,
      address,
      city,
      state,
      country,
      pincode,
      status: 'pending_deposit',
      logo: '',
      favicon: '',
      banner: '',
      gallery: [],
      theme: { primary: '#6D5EF6', secondary: '#0EA5E9', accent: '#22D3EE', mode: 'light', cardStyle: 'soft' },
      hours: {},
      social: {},
      rating: 0,
      reviewCount: 0,
      orderCount: 0,
      productCount: 0,
      joinedAt: db.nowIso(),
      depositPaidAt: null,
      activationDueAt: null,
      activatedAt: null,
      commissionPercent: config.commissionPercent,
      deliveryFeePaise: config.deliveryFeePaise,
      freeDeliveryAbovePaise: config.freeDeliveryAbovePaise,
      balance: { availablePaise: 0, pendingPaise: 0, earnedPaise: 0, commissionPaise: 0, withdrawnPaise: 0 },
      seo: { title: '', description: '', ogImage: '' },
      codEnabled: true,
      onlinePaymentEnabled: true,
    });

    const user = db.insert('users', {
      name,
      email,
      phone,
      passwordHash: hashPassword(password),
      role: 'vendor',
      vendorId,
      emailVerified: false,
      avatarColor,
      disabled: false,
      lastLoginAt: null,
    });

    db.insert('deposits', {
      vendorId,
      userId: user.id,
      amountPaise: config.depositPaise,
      status: 'pending',
      method: null,
      reference: null,
      initiatedAt: null,
      confirmedAt: null,
      note: 'Awaiting payment',
    });

    const verifyTokenValue = randomToken(24);
    db.insert('emailVerifications', { userId: user.id, token: verifyTokenValue, usedAt: null });

    notify({
      userId: user.id,
      vendorId,
      type: 'system',
      title: 'Welcome to GrowBusiness Online 👋',
      body: 'Your account is created. Pay the ₹1,000 refundable security deposit to start your 48 hour store activation.',
      link: 'deposit.html',
    });

    audit('vendor.registered', user.id, { vendorId, slug });
    const token = issueSession(user);
    db.update('users', user.id, { lastLoginAt: db.nowIso() });

    res.status(201).json({
      ok: true,
      data: {
        ...authPayload(user, vendor),
        token,
        nextStep: 'security_deposit',
        deposit: { amountPaise: config.depositPaise, status: 'pending' },
      },
    });
  })
);

/* --------------------------------------------------------------------- login */

router.post(
  '/login',
  rateLimit('login', 15),
  asyncHandler(async (req, res) => {
    const identifier = sanitizeText(req.body?.identifier || req.body?.email, 120).toLowerCase();
    const password = String(req.body?.password || '');
    assert(identifier && password, 'Enter your email and password.');

    const user = db.find('users', (u) => u.email === identifier || u.phone === identifier);
    // Same message for both failures so accounts cannot be enumerated.
    if (!user || !verifyPassword(password, user.passwordHash)) throw unauthorized('Incorrect email or password.');
    if (user.disabled) throw unauthorized('This account has been disabled. Contact support.');

    const vendor = user.vendorId ? db.findOneBy('vendors', 'id', user.vendorId) : null;
    db.update('users', user.id, { lastLoginAt: db.nowIso() });
    const token = issueSession(user);
    audit('auth.login', user.id, { role: user.role });
    ok(res, { ...authPayload(user, vendor), token });
  })
);

router.post(
  '/logout',
  requireAuth,
  asyncHandler(async (req, res) => {
    if (req.session) db.update('sessions', req.session.id, { revokedAt: db.nowIso() });
    ok(res, { loggedOut: true });
  })
);

router.get(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    const vendor = req.user.vendorId ? db.findOneBy('vendors', 'id', req.user.vendorId) : null;
    ok(res, authPayload(req.userRecord, vendor));
  })
);

/* --------------------------------------------------------- password recovery */

router.post(
  '/forgot-password',
  rateLimit('forgot', 6),
  asyncHandler(async (req, res) => {
    const email = sanitizeText(req.body?.email, 120).toLowerCase();
    assert(RE.email.test(email), 'Enter a valid email address.');
    const user = db.findOneBy('users', 'email', email);
    if (user) {
      const token = randomToken(24);
      db.insert('passwordResets', { userId: user.id, token, usedAt: null });
      // In production this is emailed. In dev we return it so the flow is testable.
      audit('auth.reset_requested', user.id, {});
      return ok(res, {
        sent: true,
        message: `If ${email} is registered, a reset link is on its way.`,
        devToken: config.devTools ? token : undefined,
      });
    }
    ok(res, { sent: true, message: `If ${email} is registered, a reset link is on its way.` });
  })
);

router.post(
  '/reset-password',
  rateLimit('reset', 8),
  asyncHandler(async (req, res) => {
    const token = sanitizeText(req.body?.token, 80);
    const password = String(req.body?.password || '');
    assert(password.length >= 8, 'Password must be at least 8 characters.');
    assert(password === String(req.body?.confirmPassword || ''), 'Password and confirm password do not match.');

    const record = db.find('passwordResets', (r) => r.token === token && !r.usedAt);
    if (!record) throw badRequest('This reset link is invalid or has already been used.');
    const age = Date.now() - new Date(record.createdAt).getTime();
    if (age > config.token.resetTtlSeconds * 1000) throw badRequest('This reset link has expired. Please request a new one.');

    const user = db.findOneBy('users', 'id', record.userId);
    if (!user) throw notFound('Account not found.');
    db.update('users', user.id, { passwordHash: hashPassword(password) });
    db.update('passwordResets', record.id, { usedAt: db.nowIso() });
    // Invalidate every existing session after a password change.
    for (const s of db.filter('sessions', (x) => x.userId === user.id && !x.revokedAt)) {
      db.update('sessions', s.id, { revokedAt: db.nowIso() });
    }
    notify({
      userId: user.id,
      type: 'security',
      title: 'Password changed',
      body: 'Your password was updated and all other devices were signed out.',
    });
    audit('auth.reset_used', user.id, {});
    ok(res, { reset: true, message: 'Password updated. Please sign in again.' });
  })
);

/* ------------------------------------------------------- email verification */

router.post(
  '/verify-email',
  asyncHandler(async (req, res) => {
    const token = sanitizeText(req.body?.token, 80);
    const record = db.find('emailVerifications', (r) => r.token === token && !r.usedAt);
    if (!record) throw badRequest('This verification link is invalid or already used.');
    db.update('emailVerifications', record.id, { usedAt: db.nowIso() });
    db.update('users', record.userId, { emailVerified: true });
    ok(res, { verified: true, message: 'Email verified successfully.' });
  })
);

router.post(
  '/resend-verification',
  requireAuth,
  rateLimit('resend', 4),
  asyncHandler(async (req, res) => {
    const token = randomToken(24);
    db.insert('emailVerifications', { userId: req.user.id, token, usedAt: null });
    ok(res, { sent: true, devToken: config.devTools ? token : undefined });
  })
);

router.get(
  '/password-rules',
  asyncHandler(async (_req, res) => {
    ok(res, { minLength: 8, requireMixedCase: false, businessTypes: BUSINESS_TYPES });
  })
);

module.exports = router;
module.exports.BUSINESS_TYPES = BUSINESS_TYPES;
module.exports.vendorSnapshot = vendorSnapshot;
module.exports.homeForRole = homeForRole;
module.exports.pick = pick;
module.exports.sanitizeUrl = sanitizeUrl;
module.exports.VENDOR_STATUSES = VENDOR_STATUSES;
