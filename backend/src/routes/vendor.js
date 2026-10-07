/**
 * VENDOR DASHBOARD API — everything behind admin.growbusinessonline.com.
 *
 * Every handler resolves the vendor from the *session*, never from the request
 * body or URL (spec §29). Financial fields are read-only here; only
 * finance.js / admin.js may change money.
 */
const express = require('express');
const db = require('../db');
const config = require('../config');
const {
  sanitizeText,
  sanitizeUrl,
  slugify,
  assert,
  badRequest,
  notFound,
  forbidden,
  RE,
  pick,
} = require('../security');
const { asyncHandler, requireVendor, ownVendor, assertTenant } = require('../middleware/auth');
const { ok, notify } = require('../respond');
const { paginate, clampInt, toPaise, sum, commissionSplit, TRACKING_STEPS, ORDER_STATUSES } = require('../domain');

const router = express.Router();
router.use(requireVendor);

/** Loads req.vendor for the signed-in vendor (or an explicit vendor for super admins). */
function loadVendor(req, _res, next) {
  try {
    if (req.user.role === 'super_admin') {
      const id = req.query.vendorId || req.body?.vendorId || req.user.vendorId;
      req.vendor = id ? db.findOneBy('vendors', 'id', id) : db.col('vendors')[0];
      if (!req.vendor) throw notFound('No store selected.');
    } else {
      req.vendor = ownVendor(req);
    }
    next();
  } catch (err) {
    next(err);
  }
}
router.use(loadVendor);

/* ------------------------------------------------------------------- helpers */

const dayKey = (iso) => new Date(iso).toISOString().slice(0, 10);

function series(days, orders, valueFn) {
  const out = [];
  const today = new Date();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today.getTime() - i * 86400000);
    const key = d.toISOString().slice(0, 10);
    const dayOrders = orders.filter((o) => dayKey(o.placedAt) === key);
    out.push({ date: key, label: d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }), orders: dayOrders.length, value: valueFn(dayOrders) });
  }
  return out;
}

const vendorOrders = (vendorId) => db.filter('orders', (o) => o.vendorId === vendorId);

function orderBrief(o) {
  return {
    id: o.id,
    orderNumber: o.orderNumber,
    customer: o.customer,
    shipping: o.shipping,
    itemCount: o.lines.reduce((a, l) => a + l.qty, 0),
    items: o.lines.map((l) => ({ name: l.name, image: l.image, qty: l.qty })),
    totalPaise: o.totalPaise,
    commissionPaise: o.commissionPaise,
    vendorPaise: o.vendorPaise,
    status: o.status,
    paymentStatus: o.paymentStatus,
    paymentMethod: o.paymentMethod,
    placedAt: o.placedAt,
    updatedAt: o.updatedAt,
  };
}

/* --------------------------------------------------------------- store & me */

router.get('/me', (req, res) => {
  const v = req.vendor;
  const deposit = db.find('deposits', (d) => d.vendorId === v.id);
  const dueAt = v.activationDueAt ? new Date(v.activationDueAt).getTime() : null;
  const remaining = dueAt ? Math.max(0, dueAt - Date.now()) : 0;
  ok(res, {
    vendor: v,
    deposit: deposit ? { id: deposit.id, status: deposit.status, amountPaise: deposit.amountPaise, reference: deposit.reference, confirmedAt: deposit.confirmedAt } : null,
    activation: {
      status: v.status,
      serverTime: db.nowIso(),
      dueAt: v.activationDueAt || null,
      activatedAt: v.activatedAt || null,
      remainingMs: remaining,
      ready: v.status === 'active',
      activationHours: config.activationHours,
    },
    storefrontUrl: `https://${v.slug}.${config.rootDomain}`,
    previewUrl: `/vendor/index.html?vendor=${v.slug}`,
  });
});

router.get('/dashboard', (req, res) => {
  const v = req.vendor;
  const orders = vendorOrders(v.id);
  const delivered = orders.filter((o) => o.status === 'delivered');
  const cancelled = orders.filter((o) => ['cancelled', 'refunded'].includes(o.status));
  const products = db.filter('products', (p) => p.vendorId === v.id);
  const customers = db.filter('customers', (c) => c.vendorId === v.id);
  const lowStock = products.filter((p) => p.stock <= (p.lowStockAt || 10));

  const kpis = {
    totalSalesPaise: sum(delivered, (o) => o.totalPaise),
    totalRevenuePaise: sum(orders.filter((o) => !cancelled.includes(o)), (o) => o.totalPaise),
    totalOrders: orders.length,
    pendingOrders: orders.filter((o) => o.status === 'pending').length,
    processingOrders: orders.filter((o) => ['confirmed', 'processing'].includes(o.status)).length,
    shippedOrders: orders.filter((o) => ['shipped', 'out_for_delivery'].includes(o.status)).length,
    completedOrders: delivered.length,
    cancelledOrders: cancelled.length,
    customers: customers.length,
    products: products.length,
    activeProducts: products.filter((p) => p.status === 'active').length,
    outOfStock: products.filter((p) => p.stock === 0).length,
    lowStock: lowStock.length,
    availableBalancePaise: v.balance.availablePaise,
    pendingBalancePaise: v.balance.pendingPaise,
    earnedPaise: v.balance.earnedPaise,
    commissionPaidPaise: v.balance.commissionPaise,
    withdrawnPaise: v.balance.withdrawnPaise,
    avgOrderValuePaise: delivered.length ? Math.round(sum(delivered, (o) => o.totalPaise) / delivered.length) : 0,
    rating: v.rating,
    reviewCount: v.reviewCount,
  };

  const days = clampInt(req.query.days, 7, 90, 14);
  const recent = orders.slice().sort((a, b) => new Date(b.placedAt) - new Date(a.placedAt));
  const windowStart = Date.now() - days * 86400000;
  const windowOrders = orders.filter((o) => new Date(o.placedAt).getTime() >= windowStart);
  const prevStart = windowStart - days * 86400000;
  const prevOrders = orders.filter((o) => {
    const t = new Date(o.placedAt).getTime();
    return t >= prevStart && t < windowStart;
  });
  const growth = prevOrders.length ? Math.round(((windowOrders.length - prevOrders.length) / prevOrders.length) * 100) : windowOrders.length ? 100 : 0;

  // Top products across all time
  const byProduct = new Map();
  for (const o of orders) {
    if (['cancelled', 'refunded'].includes(o.status)) continue;
    for (const l of o.lines) {
      const cur = byProduct.get(l.productId) || { productId: l.productId, name: l.name, image: l.image, units: 0, revenuePaise: 0 };
      cur.units += l.qty;
      cur.revenuePaise += l.grossPaise;
      byProduct.set(l.productId, cur);
    }
  }
  const topProducts = [...byProduct.values()].sort((a, b) => b.revenuePaise - a.revenuePaise).slice(0, 6);

  const statusBreakdown = ORDER_STATUSES.map((s) => ({ status: s, count: orders.filter((o) => o.status === s).length })).filter((x) => x.count > 0);

  ok(res, {
    vendor: { id: v.id, name: v.name, slug: v.slug, logo: v.logo, theme: v.theme, status: v.status },
    kpis,
    growth: { ordersPercent: growth, windowDays: days },
    charts: {
      sales: series(days, orders, (list) => sum(list, (o) => o.totalPaise)),
      orders: series(days, orders, (list) => list.length),
      statusBreakdown,
      paymentSplit: ['upi', 'card', 'netbanking', 'cod'].map((m) => ({
        method: m,
        count: orders.filter((o) => o.paymentMethod === m).length,
      })).filter((x) => x.count),
    },
    topProducts,
    recentOrders: recent.slice(0, 8).map(orderBrief),
    alerts: [
      ...(v.status !== 'active' ? [{ level: 'warning', title: 'Store not live yet', body: 'Complete activation to start receiving orders.', link: 'activation.html' }] : []),
      ...(products.length === 0 ? [{ level: 'info', title: 'Add your first product', body: 'Your store needs at least one product before customers can order.', link: 'products.html' }] : []),
      ...(lowStock.length ? [{ level: 'warning', title: `${lowStock.length} product(s) running low`, body: lowStock.slice(0, 3).map((p) => p.name).join(', '), link: 'products.html?filter=low' }] : []),
      ...(orders.filter((o) => o.status === 'pending').length ? [{ level: 'info', title: `${orders.filter((o) => o.status === 'pending').length} order(s) awaiting confirmation`, body: 'Confirm them so customers get an update.', link: 'orders.html?status=pending' }] : []),
    ],
    serverTime: db.nowIso(),
  });
});

/* --------------------------------------------------------------- store setup */

const STORE_FIELDS = ['name', 'legalName', 'tagline', 'description', 'businessType', 'phone', 'email', 'address', 'city', 'state', 'country', 'pincode', 'logo', 'favicon', 'banner'];

router.get('/store', (req, res) => ok(res, req.vendor));

router.put('/store', (req, res) => {
  const v = req.vendor;
  const b = req.body || {};
  const patch = {};
  for (const f of STORE_FIELDS) {
    if (b[f] === undefined) continue;
    patch[f] = ['logo', 'favicon', 'banner'].includes(f) ? sanitizeUrl(b[f]) : sanitizeText(b[f], f === 'description' ? 2000 : 200);
  }
  if (patch.email) assert(RE.email.test(patch.email), 'Enter a valid business email.');
  if (patch.phone) assert(RE.phone.test(patch.phone.replace(/\s/g, '')), 'Enter a valid phone number.');
  if (patch.pincode) assert(RE.pincode.test(patch.pincode), 'Enter a valid 6 digit pincode.');
  if (patch.name) assert(patch.name.length >= 3, 'Business name is too short.');

  if (b.theme && typeof b.theme === 'object') {
    const isHex = (c) => /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(String(c || ''));
    const theme = { ...v.theme };
    if (b.theme.primary) {
      assert(isHex(b.theme.primary), 'Primary colour must be a hex value like #6D5EF6.');
      theme.primary = b.theme.primary;
    }
    if (b.theme.secondary) {
      assert(isHex(b.theme.secondary), 'Secondary colour must be a hex value.');
      theme.secondary = b.theme.secondary;
    }
    if (b.theme.accent) theme.accent = isHex(b.theme.accent) ? b.theme.accent : theme.accent;
    if (['light', 'dark', 'auto'].includes(b.theme.mode)) theme.mode = b.theme.mode;
    if (['soft', 'sharp', 'glass'].includes(b.theme.cardStyle)) theme.cardStyle = b.theme.cardStyle;
    patch.theme = theme;
  }

  if (b.hours && typeof b.hours === 'object') {
    patch.hours = {};
    for (const k of ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']) patch.hours[k] = sanitizeText(b.hours[k], 40);
  }
  if (b.social && typeof b.social === 'object') {
    patch.social = {};
    for (const k of ['instagram', 'facebook', 'whatsapp', 'youtube', 'twitter']) patch.social[k] = sanitizeUrl(b.social[k]) || sanitizeText(b.social[k], 40);
  }
  if (Array.isArray(b.gallery)) patch.gallery = b.gallery.map(sanitizeUrl).filter(Boolean).slice(0, 6);
  if (b.codEnabled !== undefined) patch.codEnabled = !!b.codEnabled;
  if (b.onlinePaymentEnabled !== undefined) patch.onlinePaymentEnabled = !!b.onlinePaymentEnabled;
  if (b.seo && typeof b.seo === 'object') {
    patch.seo = {
      title: sanitizeText(b.seo.title, 70),
      description: sanitizeText(b.seo.description, 180),
      ogImage: sanitizeUrl(b.seo.ogImage),
    };
  }

  const updated = db.update('vendors', v.id, patch);
  ok(res, { vendor: updated, message: 'Store details saved.' });
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
  if (b.password) {
    assert(String(b.password).length >= 8, 'Password must be at least 8 characters.');
    assert(String(b.password) === String(b.confirmPassword || ''), 'Passwords do not match.');
    const { hashPassword, verifyPassword } = require('../security');
    assert(verifyPassword(String(b.currentPassword || ''), req.userRecord.passwordHash), 'Your current password is incorrect.');
    patch.passwordHash = hashPassword(String(b.password));
  }
  db.update('users', req.user.id, patch);
  ok(res, { message: 'Profile updated.' });
});

/* --------------------------------------------------------------- categories */

router.get('/categories', (req, res) => {
  const cats = db
    .filter('categories', (c) => c.vendorId === req.vendor.id)
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((c) => ({ ...c, productCount: db.filter('products', (p) => p.categoryId === c.id).length }));
  ok(res, cats);
});

router.post('/categories', (req, res) => {
  const name = sanitizeText(req.body?.name, 60);
  assert(name.length >= 2, 'Enter a category name.');
  const slug = slugify(name);
  if (db.find('categories', (c) => c.vendorId === req.vendor.id && c.slug === slug)) throw badRequest('You already have a category with this name.');
  const cat = db.insert('categories', {
    vendorId: req.vendor.id,
    name,
    slug,
    description: sanitizeText(req.body?.description, 300),
    image: sanitizeUrl(req.body?.image),
    sortOrder: db.filter('categories', (c) => c.vendorId === req.vendor.id).length,
    active: req.body?.active !== false,
  });
  ok(res, { category: cat, message: `Category "${name}" added.` }, { status: 201 });
});

router.put('/categories/:id', (req, res) => {
  const cat = db.find('categories', (c) => c.id === req.params.id);
  if (!cat) throw notFound('Category not found.');
  assertTenant(req, cat.vendorId);
  const patch = {};
  if (req.body?.name !== undefined) {
    const name = sanitizeText(req.body.name, 60);
    assert(name.length >= 2, 'Enter a category name.');
    patch.name = name;
    patch.slug = slugify(name);
  }
  if (req.body?.description !== undefined) patch.description = sanitizeText(req.body.description, 300);
  if (req.body?.image !== undefined) patch.image = sanitizeUrl(req.body.image);
  if (req.body?.sortOrder !== undefined) patch.sortOrder = clampInt(req.body.sortOrder, 0, 999, 0);
  if (req.body?.active !== undefined) patch.active = !!req.body.active;
  ok(res, { category: db.update('categories', cat.id, patch), message: 'Category updated.' });
});

router.delete('/categories/:id', (req, res) => {
  const cat = db.find('categories', (c) => c.id === req.params.id);
  if (!cat) throw notFound('Category not found.');
  assertTenant(req, cat.vendorId);
  const linked = db.filter('products', (p) => p.categoryId === cat.id).length;
  if (linked) throw badRequest(`This category still has ${linked} product(s). Move them first.`);
  db.remove('categories', cat.id);
  ok(res, { removed: true, message: 'Category deleted.' });
});

/* ----------------------------------------------------------------- products */

const productAdmin = (p) => ({ ...p, priceRupees: p.pricePaise / 100, mrpRupees: p.mrpPaise / 100 });

router.get('/products', (req, res) => {
  const q = sanitizeText(req.query.q, 80).toLowerCase();
  const status = sanitizeText(req.query.status, 30);
  const category = sanitizeText(req.query.category, 60);
  let list = db.filter('products', (p) => p.vendorId === req.vendor.id);
  if (q) list = list.filter((p) => `${p.name} ${p.sku}`.toLowerCase().includes(q));
  if (status === 'low') list = list.filter((p) => p.stock > 0 && p.stock <= (p.lowStockAt || 10));
  else if (status === 'out') list = list.filter((p) => p.stock === 0);
  else if (status) list = list.filter((p) => p.status === status);
  if (category) list = list.filter((p) => p.categoryId === category);
  list.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  const page = paginate(list.map(productAdmin), req.query);
  ok(res, page.items, { pagination: page });
});

router.get('/products/:id', (req, res) => {
  const p = db.find('products', (x) => x.id === req.params.id);
  if (!p) throw notFound('Product not found.');
  assertTenant(req, p.vendorId);
  ok(res, { product: productAdmin(p), reviews: db.filter('reviews', (r) => r.productId === p.id) });
});

function validateProductPayload(b, vendorId, existing = null) {
  const out = {};
  const name = b.name !== undefined ? sanitizeText(b.name, 120) : existing?.name;
  assert(name && name.length >= 3, 'Product name must be at least 3 characters.');
  out.name = name;

  if (b.price !== undefined || b.pricePaise !== undefined) {
    const pricePaise = b.pricePaise !== undefined ? clampInt(b.pricePaise, 1, 100000000, 0) : toPaise(b.price);
    assert(pricePaise > 0, 'Enter a selling price greater than zero.');
    out.pricePaise = pricePaise;
  }
  if (b.mrp !== undefined || b.mrpPaise !== undefined) {
    const mrpPaise = b.mrpPaise !== undefined ? clampInt(b.mrpPaise, 1, 100000000, 0) : toPaise(b.mrp);
    out.mrpPaise = Math.max(mrpPaise, out.pricePaise ?? existing?.pricePaise ?? mrpPaise);
  }
  if (out.pricePaise && !out.mrpPaise && !existing?.mrpPaise) out.mrpPaise = out.pricePaise;
  const price = out.pricePaise ?? existing?.pricePaise;
  const mrp = out.mrpPaise ?? existing?.mrpPaise ?? price;
  out.mrpPaise = Math.max(mrp, price);
  out.discountPercent = price && mrp > price ? Math.round(((mrp - price) / mrp) * 100) : 0;

  if (b.stock !== undefined) out.stock = clampInt(b.stock, 0, 100000, 0);
  if (b.lowStockAt !== undefined) out.lowStockAt = clampInt(b.lowStockAt, 0, 1000, 5);
  if (b.sku !== undefined) {
    const sku = sanitizeText(b.sku, 40).toUpperCase();
    const clash = db.find('products', (p) => p.vendorId === vendorId && p.sku === sku && p.id !== existing?.id);
    if (clash) throw badRequest('That SKU is already used by another product.');
    out.sku = sku;
  }
  if (b.categoryId !== undefined) {
    const cat = b.categoryId ? db.find('categories', (c) => c.id === b.categoryId && c.vendorId === vendorId) : null;
    if (b.categoryId && !cat) throw badRequest('Choose a category that belongs to your store.');
    out.categoryId = b.categoryId || null;
  }
  if (b.shortDescription !== undefined) out.shortDescription = sanitizeText(b.shortDescription, 200);
  if (b.description !== undefined) out.description = sanitizeText(b.description, 4000);
  if (b.image !== undefined) out.image = sanitizeUrl(b.image);
  if (Array.isArray(b.gallery)) out.gallery = b.gallery.map(sanitizeUrl).filter(Boolean).slice(0, 8);
  if (Array.isArray(b.specs)) {
    out.specs = b.specs
      .filter((s) => s && (s.label || s[0]))
      .slice(0, 20)
      .map((s) => [sanitizeText(s.label || s[0], 60), sanitizeText(s.value || s[1], 120)]);
  }
  if (Array.isArray(b.tags)) out.tags = b.tags.map((t) => slugify(t)).filter(Boolean).slice(0, 8);
  if (b.featured !== undefined) out.featured = !!b.featured;
  if (b.unit !== undefined) out.unit = sanitizeText(b.unit, 20) || 'pcs';
  if (b.seo) out.seo = { title: sanitizeText(b.seo.title, 70), description: sanitizeText(b.seo.description, 180) };
  if (b.status !== undefined) {
    assert(['active', 'draft', 'out_of_stock'].includes(b.status), 'Invalid product status.');
    out.status = b.status;
  }
  return out;
}

router.post('/products', (req, res) => {
  const v = req.vendor;
  assert(v.status === 'active' || v.status === 'pending_activation', 'Complete your store activation before adding products.');
  const b = req.body || {};
  const data = validateProductPayload(b, v.id);
  assert(b.price !== undefined || b.pricePaise !== undefined, 'Enter a selling price.');
  const stock = data.stock ?? 0;
  const product = db.insert('products', {
    vendorId: v.id,
    categoryId: data.categoryId || null,
    name: data.name,
    slug: slugify(`${v.slug}-${data.name}`),
    sku: data.sku || `${v.slug.slice(0, 3).toUpperCase()}-${Date.now().toString().slice(-5)}`,
    shortDescription: data.shortDescription || '',
    description: data.description || '',
    specs: data.specs || [],
    pricePaise: data.pricePaise,
    mrpPaise: data.mrpPaise,
    discountPercent: data.discountPercent,
    stock,
    lowStockAt: data.lowStockAt ?? 5,
    unit: data.unit || 'pcs',
    image: data.image || '',
    gallery: data.gallery || (data.image ? [data.image] : []),
    rating: 0,
    reviewCount: 0,
    soldCount: 0,
    status: data.status || (stock > 0 ? 'active' : 'out_of_stock'),
    featured: !!data.featured,
    tags: data.tags || [],
    seo: data.seo || { title: '', description: '' },
  });
  db.update('vendors', v.id, { productCount: db.filter('products', (p) => p.vendorId === v.id && p.status === 'active').length });
  ok(res, { product: productAdmin(product), message: `"${product.name}" added to your store.` }, { status: 201 });
});

router.put('/products/:id', (req, res) => {
  const p = db.find('products', (x) => x.id === req.params.id);
  if (!p) throw notFound('Product not found.');
  assertTenant(req, p.vendorId);
  const data = validateProductPayload(req.body || {}, req.vendor.id, p);
  if (data.stock !== undefined && data.stock === 0) data.status = 'out_of_stock';
  else if (data.stock !== undefined && data.stock > 0 && p.status === 'out_of_stock') data.status = 'active';
  if (data.name && data.name !== p.name) data.slug = slugify(`${req.vendor.slug}-${data.name}`);
  const updated = db.update('products', p.id, data);
  db.update('vendors', req.vendor.id, { productCount: db.filter('products', (x) => x.vendorId === req.vendor.id && x.status === 'active').length });
  ok(res, { product: productAdmin(updated), message: `"${updated.name}" saved.` });
});

router.delete('/products/:id', (req, res) => {
  const p = db.find('products', (x) => x.id === req.params.id);
  if (!p) throw notFound('Product not found.');
  assertTenant(req, p.vendorId);
  const sold = db.filter('orders', (o) => o.vendorId === p.vendorId && o.lines.some((l) => l.productId === p.id)).length;
  if (sold) {
    // Keep history intact — archive instead of deleting.
    db.update('products', p.id, { status: 'draft' });
    return ok(res, { archived: true, message: `"${p.name}" has order history, so it was archived instead of deleted.` });
  }
  db.remove('products', p.id);
  for (const r of db.filter('reviews', (r) => r.productId === p.id)) db.remove('reviews', r.id);
  db.update('vendors', req.vendor.id, { productCount: db.filter('products', (x) => x.vendorId === req.vendor.id && x.status === 'active').length });
  ok(res, { removed: true, message: `"${p.name}" deleted.` });
});

/* ------------------------------------------------------------------- orders */

router.get('/orders', (req, res) => {
  const q = sanitizeText(req.query.q, 60).toLowerCase();
  const status = sanitizeText(req.query.status, 30);
  const paymentStatus = sanitizeText(req.query.paymentStatus, 30);
  let list = vendorOrders(req.vendor.id);
  if (status && status !== 'all') list = list.filter((o) => o.status === status);
  if (paymentStatus) list = list.filter((o) => o.paymentStatus === paymentStatus);
  if (q) list = list.filter((o) => `${o.orderNumber} ${o.customer.name} ${o.customer.phone} ${o.customer.email} ${o.shipping?.city}`.toLowerCase().includes(q));
  list.sort((a, b) => new Date(b.placedAt) - new Date(a.placedAt));
  const page = paginate(list.map(orderBrief), req.query, 10);
  const counts = { all: vendorOrders(req.vendor.id).length };
  for (const s of ORDER_STATUSES) counts[s] = vendorOrders(req.vendor.id).filter((o) => o.status === s).length;
  ok(res, page.items, { pagination: page, counts });
});

router.get('/orders/:id', (req, res) => {
  const o = db.find('orders', (x) => x.id === req.params.id || x.orderNumber === req.params.id);
  if (!o) throw notFound('Order not found.');
  assertTenant(req, o.vendorId);
  const customer = db.findOneBy('customers', 'id', o.customerId);
  ok(res, {
    order: { ...o, lines: o.lines },
    customer,
    split: commissionSplit(o.totalPaise, o.commissionPercent),
    allowedStatuses: ORDER_STATUSES,
    timelineSteps: TRACKING_STEPS,
  });
});

/**
 * Status updates are validated against a legal transition map and the money
 * side effects (settlement / commission) happen here — never in the browser.
 */
const TRANSITIONS = {
  pending: ['confirmed', 'cancelled'],
  confirmed: ['processing', 'cancelled'],
  processing: ['shipped', 'cancelled'],
  shipped: ['out_for_delivery'],
  out_for_delivery: ['delivered'],
  delivered: ['refunded'],
  cancelled: ['refunded'],
  refunded: [],
};

router.patch('/orders/:id/status', (req, res) => {
  const o = db.find('orders', (x) => x.id === req.params.id || x.orderNumber === req.params.id);
  if (!o) throw notFound('Order not found.');
  assertTenant(req, o.vendorId);
  const next = sanitizeText(req.body?.status, 30);
  assert(ORDER_STATUSES.includes(next), 'Unknown order status.');
  const allowed = TRANSITIONS[o.status] || [];
  if (!allowed.includes(next)) throw badRequest(`An order that is "${o.status.replace(/_/g, ' ')}" cannot move to "${next.replace(/_/g, ' ')}".`);

  const note = sanitizeText(req.body?.note, 200);
  const timeline = [...(o.timeline || []), { status: next, at: db.nowIso(), note: note || `Marked ${next.replace(/_/g, ' ')}` }];
  const patch = { status: next, timeline, updatedAt: db.nowIso() };

  if (['shipped', 'out_for_delivery', 'delivered'].includes(next)) patch.deliveryEta = o.deliveryEta || new Date(Date.now() + 2 * 86400000).toISOString();
  if (next === 'delivered' && o.paymentMethod === 'cod') patch.paymentStatus = 'paid';
  if (next === 'refunded') patch.paymentStatus = 'refunded';

  db.update('orders', o.id, patch);

  const vendor = req.vendor;
  const balance = { ...vendor.balance };
  if (next === 'delivered' && o.status !== 'delivered') {
    // Settlement: vendor gets total minus platform commission (server computed).
    balance.pendingPaise = Math.max(0, balance.pendingPaise - o.vendorPaise);
    balance.earnedPaise += o.vendorPaise;
    balance.commissionPaise += o.commissionPaise;
    balance.availablePaise += o.vendorPaise;
    db.insert('ledger', {
      kind: 'order_settlement',
      vendorId: vendor.id,
      orderId: o.id,
      creditPaise: o.vendorPaise,
      debitPaise: 0,
      commissionPaise: o.commissionPaise,
      note: `Settlement for ${o.orderNumber}`,
    });
    notify({
      userId: req.user.id,
      vendorId: vendor.id,
      type: 'payment',
      title: 'Payment settled',
      body: `₹${(o.vendorPaise / 100).toFixed(2)} added to your balance from ${o.orderNumber} (commission ₹${(o.commissionPaise / 100).toFixed(2)}).`,
      link: 'balance.html',
    });
  }
  if (['cancelled', 'refunded'].includes(next) && o.status !== next) {
    balance.pendingPaise = Math.max(0, balance.pendingPaise - o.vendorPaise);
    for (const l of o.lines) {
      const p = db.findOneBy('products', 'id', l.productId);
      if (p) db.update('products', p.id, { stock: p.stock + l.qty, status: p.stock + l.qty > 0 && p.status === 'out_of_stock' ? 'active' : p.status });
    }
  }
  db.update('vendors', vendor.id, { balance });

  if (o.userId) {
    notify({ userId: o.userId, type: 'order', title: `Order ${o.orderNumber} ${next.replace(/_/g, ' ')}`, body: vendor.name, link: `vendor/order-detail.html?number=${o.orderNumber}` });
  }
  ok(res, { order: { ...db.findOneBy('orders', 'id', o.id) }, message: `Order marked as ${next.replace(/_/g, ' ')}.` });
});

/* ---------------------------------------------------------------- customers */

router.get('/customers', (req, res) => {
  const q = sanitizeText(req.query.q, 60).toLowerCase();
  let list = db.filter('customers', (c) => c.vendorId === req.vendor.id);
  if (q) list = list.filter((c) => `${c.name} ${c.email} ${c.phone} ${c.city}`.toLowerCase().includes(q));
  list.sort((a, b) => (b.spentPaise || 0) - (a.spentPaise || 0));
  const page = paginate(list, req.query, 10);
  ok(res, page.items, { pagination: page, total: list.length });
});

/* ---------------------------------------------------------------- analytics */

router.get('/analytics', (req, res) => {
  const v = req.vendor;
  const days = clampInt(req.query.range === '90' ? 90 : req.query.range === '7' ? 7 : 30, 7, 90, 30);
  const orders = vendorOrders(v.id);
  const sales = series(days, orders, (list) => sum(list, (o) => o.totalPaise));
  const revenue = series(days, orders.filter((o) => o.status === 'delivered'), (list) => sum(list, (o) => o.vendorPaise));
  const commission = series(days, orders.filter((o) => o.status === 'delivered'), (list) => sum(list, (o) => o.commissionPaise));

  const catMap = new Map();
  for (const o of orders) {
    for (const l of o.lines) {
      const p = db.findOneBy('products', 'id', l.productId);
      const key = p ? db.findOneBy('categories', 'id', p.categoryId)?.name || 'Other' : 'Other';
      catMap.set(key, (catMap.get(key) || 0) + l.grossPaise);
    }
  }
  const byCategory = [...catMap.entries()].map(([name, value]) => ({ name, valuePaise: value })).sort((a, b) => b.valuePaise - a.valuePaise);

  const byCity = new Map();
  for (const o of orders) byCity.set(o.shipping?.city || 'Unknown', (byCity.get(o.shipping?.city || 'Unknown') || 0) + 1);

  const total = sum(orders, (o) => o.totalPaise);
  const delivered = orders.filter((o) => o.status === 'delivered');
  ok(res, {
    range: days,
    totals: {
      orders: orders.length,
      revenuePaise: total,
      delivered: delivered.length,
      cancelled: orders.filter((o) => ['cancelled', 'refunded'].includes(o.status)).length,
      commissionPaise: v.balance.commissionPaise,
      vendorNetPaise: v.balance.earnedPaise,
      avgOrderValuePaise: delivered.length ? Math.round(sum(delivered, (o) => o.totalPaise) / delivered.length) : 0,
      fulfillmentRate: orders.length ? Math.round((delivered.length / orders.length) * 100) : 0,
    },
    charts: { sales, revenue, commission, byCategory, byCity: [...byCity.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count).slice(0, 8) },
    serverTime: db.nowIso(),
  });
});

/* ------------------------------------------------------------ notifications */

router.get('/notifications', (req, res) => {
  const list = db
    .filter('notifications', (n) => n.vendorId === req.vendor.id || (n.userId && n.userId === req.user.id) || (!n.vendorId && !n.userId))
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  const page = paginate(list, req.query, 20);
  ok(res, page.items, { pagination: page, unread: list.filter((n) => !n.readAt).length });
});

router.post('/notifications/read', (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(String) : [];
  let count = 0;
  if (!ids.length) {
    for (const n of db.filter('notifications', (x) => x.vendorId === req.vendor.id && !x.readAt)) {
      db.update('notifications', n.id, { readAt: db.nowIso() });
      count++;
    }
  } else {
    for (const id of ids) {
      const n = db.findOneBy('notifications', 'id', id);
      if (!n) continue;
      if (n.vendorId) assertTenant(req, n.vendorId);
      if (!n.readAt) {
        db.update('notifications', id, { readAt: db.nowIso() });
        count++;
      }
    }
  }
  ok(res, { marked: count });
});

/* ------------------------------------------------------------------ support */

router.post('/support', (req, res) => {
  const subject = sanitizeText(req.body?.subject, 120);
  const message = sanitizeText(req.body?.message, 2000);
  assert(subject && message.length >= 10, 'Add a subject and describe the issue.');
  const row = db.insert('messages', {
    name: req.user.name,
    email: req.user.email,
    phone: req.user.phone,
    subject: `[Vendor ${req.vendor.slug}] ${subject}`,
    message,
    status: 'new',
    vendorId: req.vendor.id,
  });
  notify({ userId: req.user.id, vendorId: req.vendor.id, type: 'system', title: 'Support request sent', body: 'Our team usually replies within one working day.', link: '' });
  ok(res, { ticketId: row.id, message: 'Support request sent.' }, { status: 201 });
});

module.exports = router;
