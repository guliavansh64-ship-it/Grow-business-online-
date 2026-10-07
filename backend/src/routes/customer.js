/**
 * CUSTOMER account API — powers /vendor/account.html, orders, addresses and wishlist.
 */
const express = require('express');
const db = require('../db');
const config = require('../config');
const { sanitizeText, sanitizeUrl, assert, badRequest, notFound, RE, publicUser } = require('../security');
const { requireAuth, requireCustomer } = require('../middleware/auth');
const { ok } = require('../respond');
const { paginate, clampInt } = require('../domain');

const router = express.Router();
router.use(requireAuth, requireCustomer);

const orderBrief = (o) => {
  const vendor = db.findOneBy('vendors', 'id', o.vendorId);
  return {
    id: o.id,
    orderNumber: o.orderNumber,
    vendor: vendor ? { name: vendor.name, slug: vendor.slug, logo: vendor.logo, theme: vendor.theme } : null,
    itemCount: o.lines.reduce((a, l) => a + l.qty, 0),
    items: o.lines.map((l) => ({ name: l.name, image: l.image, qty: l.qty, unitPricePaise: l.unitPricePaise })),
    totalPaise: o.totalPaise,
    status: o.status,
    paymentStatus: o.paymentStatus,
    paymentMethod: o.paymentMethod,
    placedAt: o.placedAt,
    deliveryEta: o.deliveryEta,
    shipping: o.shipping,
  };
};

router.get('/profile', (req, res) => {
  const addresses = db.filter('addresses', (a) => a.userId === req.user.id);
  const orders = db.filter('orders', (o) => o.userId === req.user.id);
  ok(res, {
    user: publicUser(req.userRecord),
    stats: {
      orders: orders.length,
      delivered: orders.filter((o) => o.status === 'delivered').length,
      spentPaise: orders.filter((o) => !['cancelled', 'refunded'].includes(o.status)).reduce((a, o) => a + o.totalPaise, 0),
      wishlist: db.filter('wishlists', (w) => w.userId === req.user.id).length,
    },
    addresses,
  });
});

router.put('/profile', (req, res) => {
  const b = req.body || {};
  const patch = {};
  if (b.name !== undefined) {
    const name = sanitizeText(b.name, 80);
    assert(name.length >= 3, 'Enter your full name.');
    patch.name = name;
  }
  if (b.phone !== undefined) {
    const phone = sanitizeText(b.phone, 20);
    assert(RE.phone.test(phone.replace(/\s/g, '')), 'Enter a valid mobile number.');
    patch.phone = phone;
  }
  // Password change: the current password is always re-verified server side and
  // every other session for this user is revoked (spec §27).
  let passwordChanged = false;
  if (b.password) {
    const { hashPassword, verifyPassword } = require('../security');
    assert(String(b.password).length >= 8, 'Password must be at least 8 characters.');
    assert(String(b.password) === String(b.confirmPassword || ''), 'Passwords do not match.');
    assert(verifyPassword(String(b.currentPassword || ''), req.userRecord.passwordHash), 'Your current password is incorrect.');
    patch.passwordHash = hashPassword(String(b.password));
    passwordChanged = true;
  }
  db.update('users', req.user.id, patch);
  if (passwordChanged) {
    const current = req.session?.id;
    for (const s of db.filter('sessions', (x) => x.userId === req.user.id && !x.revokedAt && x.id !== current)) {
      db.update('sessions', s.id, { revokedAt: db.nowIso() });
    }
  }
  ok(res, {
    user: publicUser(db.findOneBy('users', 'id', req.user.id)),
    message: passwordChanged ? 'Password updated. Other devices have been signed out.' : 'Profile saved.',
  });
});

router.get('/orders', (req, res) => {
  const q = sanitizeText(req.query.q, 40).toLowerCase();
  const status = sanitizeText(req.query.status, 30);
  let list = db.filter('orders', (o) => o.userId === req.user.id || (req.user.email && o.customer.email === req.user.email));
  if (status && status !== 'all') list = list.filter((o) => o.status === status);
  if (q) list = list.filter((o) => `${o.orderNumber} ${o.vendorSlug}`.toLowerCase().includes(q));
  list.sort((a, b) => new Date(b.placedAt) - new Date(a.placedAt));
  const page = paginate(list.map(orderBrief), req.query, 10);
  ok(res, page.items, { pagination: page });
});

router.get('/orders/:id', (req, res) => {
  const o = db.find('orders', (x) => (x.id === req.params.id || x.orderNumber === req.params.id) && (x.userId === req.user.id || x.customer.email === req.user.email));
  if (!o) throw notFound('Order not found.');
  const vendor = db.findOneBy('vendors', 'id', o.vendorId);
  ok(res, {
    order: { ...o, vendor: vendor ? { name: vendor.name, slug: vendor.slug, logo: vendor.logo, phone: vendor.phone, theme: vendor.theme } : null },
    timeline: o.timeline,
    steps: ['pending', 'confirmed', 'processing', 'shipped', 'out_for_delivery', 'delivered'],
    commissionNote: `A ${config.commissionPercent}% platform commission on this order is settled directly with the store.`,
  });
});

/* ---------------------------------------------------------------- addresses */

function addressPayload(b, existing = null) {
  const label = sanitizeText(b.label, 30) || existing?.label || 'Address';
  const name = sanitizeText(b.name, 80) || existing?.name;
  const phone = sanitizeText(b.phone, 20) || existing?.phone;
  const line1 = sanitizeText(b.line1 || b.address, 200);
  const city = sanitizeText(b.city, 60);
  const state = sanitizeText(b.state, 60);
  const pincode = sanitizeText(b.pincode, 10);
  const country = sanitizeText(b.country || 'India', 60);
  assert(name && name.length >= 3, 'Enter the recipient name.');
  assert(RE.phone.test(String(phone).replace(/\s/g, '')), 'Enter a valid mobile number.');
  assert(line1.length >= 8, 'Enter a complete address.');
  assert(city && state, 'City and state are required.');
  assert(RE.pincode.test(pincode), 'Enter a valid 6 digit pincode.');
  return { label, name, phone, line1, city, state, pincode, country, isDefault: !!b.isDefault };
}

router.get('/addresses', (req, res) => ok(res, db.filter('addresses', (a) => a.userId === req.user.id)));

router.post('/addresses', (req, res) => {
  const data = addressPayload(req.body || {});
  const list = db.filter('addresses', (a) => a.userId === req.user.id);
  assert(list.length < 10, 'You can save up to 10 addresses.');
  if (data.isDefault) for (const a of list) db.update('addresses', a.id, { isDefault: false });
  if (!list.length) data.isDefault = true;
  const row = db.insert('addresses', { ...data, userId: req.user.id });
  ok(res, { address: row, message: 'Address saved.' }, { status: 201 });
});

router.put('/addresses/:id', (req, res) => {
  const row = db.findOneBy('addresses', 'id', req.params.id);
  if (!row || row.userId !== req.user.id) throw notFound('Address not found.');
  const data = addressPayload(req.body || {}, row);
  if (data.isDefault) for (const a of db.filter('addresses', (x) => x.userId === req.user.id)) db.update('addresses', a.id, { isDefault: false });
  ok(res, { address: db.update('addresses', row.id, data), message: 'Address updated.' });
});

router.delete('/addresses/:id', (req, res) => {
  const row = db.findOneBy('addresses', 'id', req.params.id);
  if (!row || row.userId !== req.user.id) throw notFound('Address not found.');
  db.remove('addresses', row.id);
  ok(res, { removed: true, message: 'Address deleted.' });
});

/* ----------------------------------------------------------------- wishlist */

router.get('/wishlist', (req, res) => {
  const items = db.filter('wishlists', (w) => w.userId === req.user.id).map((w) => {
    const p = db.findOneBy('products', 'id', w.productId);
    const v = p ? db.findOneBy('vendors', 'id', p.vendorId) : null;
    return p ? { id: w.id, addedAt: w.createdAt, product: p, vendor: v ? { name: v.name, slug: v.slug, logo: v.logo, theme: v.theme } : null } : null;
  }).filter(Boolean);
  ok(res, items);
});

router.post('/wishlist', (req, res) => {
  const productId = sanitizeText(req.body?.productId, 60);
  const p = db.findOneBy('products', 'id', productId);
  if (!p || p.status !== 'active') throw notFound('Product not found.');
  if (db.find('wishlists', (w) => w.userId === req.user.id && w.productId === productId)) throw badRequest('This product is already in your wishlist.');
  const row = db.insert('wishlists', { userId: req.user.id, productId, vendorId: p.vendorId });
  ok(res, { id: row.id, message: 'Added to wishlist.' }, { status: 201 });
});

router.delete('/wishlist/:id', (req, res) => {
  const row = db.findOneBy('wishlists', 'id', req.params.id);
  if (!row || row.userId !== req.user.id) throw notFound('Wishlist item not found.');
  db.remove('wishlists', row.id);
  ok(res, { removed: true, message: 'Removed from wishlist.' });
});

/* ------------------------------------------------------------ notifications */

router.get('/notifications', (req, res) => {
  const list = db
    .filter('notifications', (n) => n.userId === req.user.id || (!n.userId && !n.vendorId))
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  const page = paginate(list, req.query, 20);
  ok(res, page.items, { pagination: page, unread: list.filter((n) => !n.readAt).length });
});

router.post('/notifications/read', (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(String) : [];
  let marked = 0;
  for (const n of db.filter('notifications', (x) => x.userId === req.user.id && !x.readAt)) {
    if (!ids.length || ids.includes(n.id)) {
      db.update('notifications', n.id, { readAt: db.nowIso() });
      marked++;
    }
  }
  ok(res, { marked });
});

module.exports = router;
