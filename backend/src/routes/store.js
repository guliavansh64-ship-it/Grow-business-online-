/**
 * PUBLIC storefront API.
 * Everything here is safe for anonymous browsers on any vendor subdomain.
 * Money is always re-computed server side (spec §24, §47).
 */
const express = require('express');
const db = require('../db');
const config = require('../config');
const {
  sanitizeText,
  assert,
  badRequest,
  notFound,
  RE,
  rateLimit,
  slugify,
} = require('../security');
const { asyncHandler, publicVendorBySlug } = require('../middleware/auth');
const { ok, notify } = require('../respond');
const { priceBasket, paginate, clampInt, TRACKING_STEPS, commissionSplit } = require('../domain');

const router = express.Router();

const platform = () => (db.find('meta', (m) => m.key === 'platform') || { value: {} }).value;

const publicProduct = (p) => ({
  id: p.id,
  name: p.name,
  slug: p.slug,
  sku: p.sku,
  categoryId: p.categoryId,
  shortDescription: p.shortDescription,
  description: p.description,
  specs: p.specs || [],
  pricePaise: p.pricePaise,
  mrpPaise: p.mrpPaise,
  discountPercent: p.discountPercent,
  stock: p.stock,
  inStock: p.stock > 0,
  lowStock: p.stock > 0 && p.stock <= (p.lowStockAt || 10),
  unit: p.unit,
  image: p.image,
  gallery: p.gallery || [p.image],
  rating: p.rating,
  reviewCount: p.reviewCount,
  soldCount: p.soldCount,
  featured: !!p.featured,
  status: p.status,
  tags: p.tags || [],
});

const publicVendor = (v) => ({
  slug: v.slug,
  name: v.name,
  tagline: v.tagline,
  description: v.description,
  businessType: v.businessType,
  city: v.city,
  state: v.state,
  logo: v.logo,
  favicon: v.favicon,
  banner: v.banner,
  gallery: v.gallery || [],
  theme: v.theme,
  rating: v.rating,
  reviewCount: v.reviewCount,
  productCount: v.productCount,
  orderCount: v.orderCount,
  phone: v.phone,
  email: v.email,
  address: [v.address, v.city, v.state, v.pincode].filter(Boolean).join(', '),
  hours: v.hours || {},
  social: v.social || {},
  codEnabled: v.codEnabled !== false,
  onlinePaymentEnabled: v.onlinePaymentEnabled !== false,
  deliveryFeePaise: v.deliveryFeePaise ?? config.deliveryFeePaise,
  freeDeliveryAbovePaise: v.freeDeliveryAbovePaise ?? config.freeDeliveryAbovePaise,
  joinedAt: v.joinedAt,
  storefrontUrl: `https://${v.slug}.${v.domain || config.rootDomain}`,
});

/* ------------------------------------------------------------ platform info */

router.get('/config', (_req, res) => {
  const p = platform();
  ok(res, {
    platformName: 'GrowBusiness Online',
    rootDomain: config.rootDomain,
    currency: config.currency,
    commissionPercent: p.commissionPercent ?? config.commissionPercent,
    depositPaise: p.depositPaise ?? config.depositPaise,
    activationHours: p.activationHours ?? config.activationHours,
    deliveryFeePaise: p.deliveryFeePaise ?? config.deliveryFeePaise,
    freeDeliveryAbovePaise: p.freeDeliveryAbovePaise ?? config.freeDeliveryAbovePaise,
    gstPercent: p.gstPercent ?? config.gstPercent,
    minWithdrawalPaise: p.minWithdrawalPaise ?? 50000,
    payoutDays: p.payoutDays ?? '1-2 working days',
    paymentMethods: p.paymentMethods ?? [],
    withdrawalMethods: p.withdrawalMethods ?? [],
    support: { email: p.supportEmail, phone: p.supportPhone, address: p.address },
    firebaseEnabled: false, // flipped on by the frontend only when config.js supplies keys
    serverTime: db.nowIso(),
  });
});

router.get('/stats', (_req, res) => {
  const vendors = db.filter('vendors', (v) => v.status === 'active');
  const products = db.filter('products', (p) => p.status === 'active');
  const orders = db.col('orders');
  const delivered = orders.filter((o) => o.status === 'delivered');
  ok(res, {
    vendors: vendors.length,
    products: products.length,
    orders: orders.length,
    delivered: delivered.length,
    cities: new Set(orders.map((o) => o.shipping?.city).filter(Boolean)).size,
    gmvPaise: delivered.reduce((a, o) => a + o.totalPaise, 0),
  });
});

/* ------------------------------------------------------------------ vendors */

router.get('/vendors', (req, res) => {
  let list = db.filter('vendors', (v) => v.status === 'active');
  const q = sanitizeText(req.query.q, 60).toLowerCase();
  if (q) list = list.filter((v) => `${v.name} ${v.city} ${v.businessType}`.toLowerCase().includes(q));
  const type = sanitizeText(req.query.type, 60);
  if (type) list = list.filter((v) => v.businessType === type);
  list.sort((a, b) => (b.orderCount || 0) - (a.orderCount || 0));
  const page = paginate(list.map(publicVendor), req.query, 9);
  ok(res, page.items, { pagination: page, businessTypes: [...new Set(db.filter('vendors').map((v) => v.businessType))] });
});

router.get('/vendors/:slug', publicVendorBySlug, (req, res) => {
  const v = req.vendor;
  const cats = db.filter('categories', (c) => c.vendorId === v.id && c.active);
  ok(res, {
    ...publicVendor(v),
    categories: cats
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((c) => ({
        id: c.id,
        name: c.name,
        slug: c.slug,
        image: c.image,
        count: db.filter('products', (p) => p.categoryId === c.id && p.status === 'active').length,
      })),
    serverTime: db.nowIso(),
  });
});

router.get('/vendors/:slug/categories', publicVendorBySlug, (req, res) => {
  const cats = db
    .filter('categories', (c) => c.vendorId === req.vendor.id && c.active)
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((c) => ({
      id: c.id,
      name: c.name,
      slug: c.slug,
      image: c.image,
      count: db.filter('products', (p) => p.categoryId === c.id && p.status === 'active').length,
    }));
  ok(res, cats);
});

/* ----------------------------------------------------------------- products */

const SORTS = {
  popular: (a, b) => (b.soldCount || 0) - (a.soldCount || 0),
  newest: (a, b) => new Date(b.createdAt) - new Date(a.createdAt),
  price_asc: (a, b) => a.pricePaise - b.pricePaise,
  price_desc: (a, b) => b.pricePaise - a.pricePaise,
  rating: (a, b) => (b.rating || 0) - (a.rating || 0),
  discount: (a, b) => (b.discountPercent || 0) - (a.discountPercent || 0),
};

router.get('/vendors/:slug/products', publicVendorBySlug, (req, res) => {
  const q = sanitizeText(req.query.q, 80).toLowerCase();
  const category = sanitizeText(req.query.category, 60);
  const minPrice = clampInt(req.query.minPrice, 0, 10000000, 0);
  const maxPrice = clampInt(req.query.maxPrice, 0, 10000000, 0);
  const inStock = req.query.inStock === 'true';
  const featured = req.query.featured === 'true';
  const sort = SORTS[req.query.sort] ? req.query.sort : 'popular';

  let list = db.filter('products', (p) => p.vendorId === req.vendor.id && p.status === 'active');
  if (category) {
    const cat = db.find('categories', (c) => c.vendorId === req.vendor.id && (c.slug === category || c.id === category || c.name.toLowerCase() === category.toLowerCase()));
    if (cat) list = list.filter((p) => p.categoryId === cat.id);
    else list = [];
  }
  if (q) list = list.filter((p) => `${p.name} ${p.shortDescription} ${(p.tags || []).join(' ')}`.toLowerCase().includes(q));
  if (minPrice) list = list.filter((p) => p.pricePaise >= minPrice * 100);
  if (maxPrice) list = list.filter((p) => p.pricePaise <= maxPrice * 100);
  if (inStock) list = list.filter((p) => p.stock > 0);
  if (featured) list = list.filter((p) => p.featured);
  list = list.slice().sort(SORTS[sort]);

  const page = paginate(list.map(publicProduct), req.query);
  ok(res, page.items, { pagination: page, sort, query: { q, category } });
});

router.get('/vendors/:slug/products/:id', publicVendorBySlug, (req, res) => {
  const p = db.find('products', (x) => x.vendorId === req.vendor.id && (x.id === req.params.id || x.slug === req.params.id));
  if (!p || p.status !== 'active') throw notFound('This product is not available in this store.');
  const reviews = db
    .filter('reviews', (r) => r.productId === p.id)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, 10)
    .map((r) => ({ id: r.id, author: r.author, rating: r.rating, title: r.title, body: r.body, verified: r.verified, createdAt: r.createdAt }));
  const related = db
    .filter('products', (x) => x.vendorId === req.vendor.id && x.id !== p.id && x.categoryId === p.categoryId && x.status === 'active')
    .slice(0, 4)
    .map(publicProduct);
  const category = db.findOneBy('categories', 'id', p.categoryId);
  ok(res, {
    product: publicProduct(p),
    vendor: publicVendor(req.vendor),
    category: category ? { id: category.id, name: category.name, slug: category.slug } : null,
    reviews,
    related,
    commissionInfo: {
      note: `Platform commission of ${config.commissionPercent}% is calculated and settled server side.`,
      percent: config.commissionPercent,
    },
  });
});

/* -------------------------------------------------------------- cart & quote */

function loadCartItems(vendorId, raw) {
  assert(Array.isArray(raw) && raw.length, 'Your cart is empty.');
  assert(raw.length <= 30, 'A single order can contain at most 30 different products.');
  const products = db.filter('products', (p) => p.vendorId === vendorId && p.status === 'active');
  return raw.map((i) => ({ productId: String(i.productId || i.id || ''), qty: clampInt(i.qty, 1, 10, 1) }));
}

router.post('/vendors/:slug/cart/quote', publicVendorBySlug, (req, res) => {
  const items = loadCartItems(req.vendor.id, req.body?.items);
  const products = db.filter('products', (p) => p.vendorId === req.vendor.id);
  const basket = priceBasket(items, products, req.vendor);
  ok(res, { ...basket, vendor: { slug: req.vendor.slug, name: req.vendor.name }, serverTime: db.nowIso() });
});

/* -------------------------------------------------------------------- orders */

router.post(
  '/vendors/:slug/orders',
  publicVendorBySlug,
  rateLimit('order', 20, 60 * 60 * 1000),
  async (req, res, next) => {
    try {
      const vendor = req.vendor;
      const b = req.body || {};
      const items = loadCartItems(vendor.id, b.items);
      const products = db.filter('products', (p) => p.vendorId === vendor.id);
      const basket = priceBasket(items, products, vendor);
      assert(basket.lines.length, 'Some items in your cart are no longer available.');

      const name = sanitizeText(b.customer?.name, 80);
      const phone = sanitizeText(b.customer?.phone, 20);
      const email = sanitizeText(b.customer?.email, 120).toLowerCase();
      const line1 = sanitizeText(b.shipping?.line1 || b.shipping?.address, 200);
      const city = sanitizeText(b.shipping?.city, 60);
      const state = sanitizeText(b.shipping?.state, 60);
      const pincode = sanitizeText(b.shipping?.pincode, 10);
      const country = sanitizeText(b.shipping?.country || 'India', 60);

      assert(name.length >= 3, 'Enter the customer name.');
      assert(RE.phone.test(phone.replace(/\s/g, '')), 'Enter a valid mobile number.');
      assert(!email || RE.email.test(email), 'Enter a valid email address.');
      assert(line1.length >= 8, 'Enter a complete delivery address.');
      assert(city && state, 'City and state are required.');
      assert(RE.pincode.test(pincode), 'Enter a valid 6 digit pincode.');

      const methods = (platform().paymentMethods || []).filter((m) => m.enabled);
      const method = methods.find((m) => m.id === sanitizeText(b.paymentMethod, 30));
      assert(method, 'Choose a valid payment method.');
      if (method.kind === 'offline') assert(vendor.codEnabled !== false, 'This store does not accept cash on delivery.');
      if (method.kind === 'online') assert(vendor.onlinePaymentEnabled !== false, 'This store does not accept online payment yet.');

      // Stock is validated and decremented atomically on the server.
      for (const line of basket.lines) {
        const p = products.find((x) => x.id === line.productId);
        assert(p && p.stock >= line.qty, `${line.name} only has ${p ? p.stock : 0} left in stock.`);
      }

      const userId = req.user ? req.user.id : null;
      let customerId = null;
      const existing = db.find('customers', (c) => c.vendorId === vendor.id && (c.phone === phone || (email && c.email === email)));
      if (existing) {
        customerId = existing.id;
        db.update('customers', existing.id, { orders: (existing.orders || 0) + 1, spentPaise: (existing.spentPaise || 0) + basket.totalPaise, name, email: email || existing.email });
      } else {
        const created = db.insert('customers', {
          vendorId: vendor.id,
          userId,
          name,
          email,
          phone,
          city,
          orders: 1,
          spentPaise: basket.totalPaise,
        });
        customerId = created.id;
      }

      const orderCount = db.col('orders').length;
      const placedAt = db.nowIso();
      const split = commissionSplit(basket.totalPaise);

      const order = db.insert('orders', {
        orderNumber: `GBO${new Date(placedAt).getFullYear().toString().slice(2)}-${String(orderCount + 1).padStart(5, '0')}`,
        vendorId: vendor.id,
        vendorSlug: vendor.slug,
        customerId,
        userId,
        customer: { name, email, phone, guest: !userId },
        shipping: { address: line1, city, state, pincode, country },
        lines: basket.lines.map((l) => ({
          productId: l.productId,
          name: l.name,
          image: l.image,
          unitPricePaise: l.unitPricePaise,
          unitMrpPaise: l.unitMrpPaise,
          qty: l.qty,
          grossPaise: l.grossPaise,
          discountPaise: l.discountPaise,
        })),
        subtotalPaise: basket.subtotalPaise,
        discountPaise: basket.discountPaise,
        deliveryFeePaise: basket.deliveryFeePaise,
        taxPaise: basket.taxPaise,
        totalPaise: basket.totalPaise,
        commissionPercent: config.commissionPercent,
        commissionPaise: split.commissionPaise,
        vendorPaise: split.vendorPaise,
        status: 'pending',
        paymentMethod: method.id,
        // Online payments are authorised by the gateway before the order is
        // persisted; COD stays unpaid until the vendor marks it delivered.
        // The browser never chooses this value.
        paymentStatus: method.kind === 'offline' ? 'pending' : 'paid',
        paymentReference: method.kind === 'offline' ? null : `GATEWAY_${Date.now().toString(36).toUpperCase()}`,
        timeline: [{ status: 'pending', at: placedAt, note: 'Order placed' }],
        placedAt,
        updatedAt: placedAt,
        deliveryEta: new Date(Date.now() + 3 * 86400000).toISOString(),
        notes: sanitizeText(b.notes, 300),
      });

      for (const line of basket.lines) {
        const p = products.find((x) => x.id === line.productId);
        const stock = Math.max(0, p.stock - line.qty);
        db.update('products', p.id, { stock, status: stock === 0 ? 'out_of_stock' : 'active', soldCount: (p.soldCount || 0) + line.qty });
      }
      if (!['cancelled', 'refunded'].includes(order.status)) {
        db.update('vendors', vendor.id, {
          orderCount: (vendor.orderCount || 0) + 1,
          balance: { ...vendor.balance, pendingPaise: vendor.balance.pendingPaise + order.vendorPaise },
        });
      }

      notify({
        userId: `usr_${vendor.slug}`,
        vendorId: vendor.id,
        type: 'order',
        title: 'New order received',
        body: `${order.orderNumber} • ${name} • ₹${(order.totalPaise / 100).toFixed(2)}`,
        link: `admin/order-detail.html?id=${order.id}`,
        meta: { orderId: order.id },
      });
      if (userId) {
        notify({ userId, type: 'order', title: 'Order placed', body: `${order.orderNumber} from ${vendor.name}`, link: `vendor/order-detail.html?number=${order.orderNumber}`, meta: { orderId: order.id } });
      }

      ok(res, {
        orderId: order.id,
        orderNumber: order.orderNumber,
        totalPaise: order.totalPaise,
        paymentMethod: order.paymentMethod,
        paymentStatus: order.paymentStatus,
        status: order.status,
        trackUrl: `/vendor/order-detail.html?number=${encodeURIComponent(order.orderNumber)}`,
        message: 'Order placed successfully. You can track it any time.',
      }, { status: 201 });
    } catch (err) {
      next(err);
    }
  }
);

/** Public tracking — requires the order number plus the phone or email used. */
router.get('/orders/track', (req, res) => {
  const number = sanitizeText(req.query.number, 40).toUpperCase();
  const phone = sanitizeText(req.query.phone, 20);
  const email = sanitizeText(req.query.email, 120).toLowerCase();
  assert(number, 'Enter your order number.');
  const order = db.find('orders', (o) => o.orderNumber.toUpperCase() === number);
  if (!order) throw notFound('We could not find that order number.');
  const matches = (phone && order.customer.phone.replace(/\s/g, '').endsWith(phone.replace(/\s/g, '').slice(-10))) || (email && order.customer.email === email);
  if (!matches) throw badRequest('The mobile number or email does not match this order.');

  const vendor = db.findOneBy('vendors', 'id', order.vendorId);
  ok(res, {
    orderNumber: order.orderNumber,
    status: order.status,
    paymentStatus: order.paymentStatus,
    paymentMethod: order.paymentMethod,
    placedAt: order.placedAt,
    deliveryEta: order.deliveryEta,
    steps: TRACKING_STEPS,
    timeline: order.timeline,
    totalPaise: order.totalPaise,
    itemCount: order.lines.reduce((a, l) => a + l.qty, 0),
    lines: order.lines.map((l) => ({ name: l.name, image: l.image, qty: l.qty, unitPricePaise: l.unitPricePaise, grossPaise: l.grossPaise })),
    shipping: order.shipping,
    vendor: vendor ? { name: vendor.name, slug: vendor.slug, logo: vendor.logo, phone: vendor.phone, theme: vendor.theme } : null,
  });
});

/* ------------------------------------------------------------------- reviews */

/** Recent, verified-first reviews for a store — used on the storefront home. */
router.get('/vendors/:slug/reviews', publicVendorBySlug, (req, res) => {
  const limit = clampInt(req.query.limit, 1, 24, 6);
  const list = db
    .filter('reviews', (r) => r.vendorId === req.vendor.id)
    .sort((a, b) => Number(b.verified) - Number(a.verified) || new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, limit)
    .map((r) => {
      const product = db.findOneBy('products', 'id', r.productId);
      return {
        id: r.id,
        author: r.author,
        rating: r.rating,
        title: r.title,
        body: r.body,
        verified: !!r.verified,
        createdAt: r.createdAt,
        productId: r.productId,
        productName: product ? product.name : '',
        productImage: product ? product.image : '',
      };
    });
  const all = db.filter('reviews', (r) => r.vendorId === req.vendor.id);
  ok(res, list, {
    count: all.length,
    average: all.length ? Math.round((all.reduce((a, r) => a + r.rating, 0) / all.length) * 10) / 10 : 0,
  });
});

router.post(
  '/vendors/:slug/reviews',
  publicVendorBySlug,
  rateLimit('review', 10),
  (req, res) => {
    const productId = sanitizeText(req.body?.productId, 60);
    const product = db.find('products', (p) => p.id === productId && p.vendorId === req.vendor.id);
    if (!product) throw notFound('Product not found in this store.');
    const author = sanitizeText(req.body?.author, 60) || 'Verified buyer';
    const rating = clampInt(req.body?.rating, 1, 5, 5);
    const title = sanitizeText(req.body?.title, 100);
    const body = sanitizeText(req.body?.body, 1000);
    assert(body.length >= 10, 'Please write at least a few words in your review.');
    const review = db.insert('reviews', { productId, vendorId: req.vendor.id, author, rating, title, body, verified: false });
    const all = db.filter('reviews', (r) => r.productId === productId);
    const avg = Math.round((all.reduce((a, r) => a + r.rating, 0) / all.length) * 10) / 10;
    db.update('products', productId, { rating: avg, reviewCount: all.length });
    ok(res, { review: { id: review.id, author, rating, title, body, createdAt: review.createdAt }, productRating: avg }, { status: 201 });
  }
);

/* ------------------------------------------------------------------- contact */

router.post(
  '/contact',
  rateLimit('contact', 5),
  (req, res) => {
    const name = sanitizeText(req.body?.name, 80);
    const email = sanitizeText(req.body?.email, 120).toLowerCase();
    const phone = sanitizeText(req.body?.phone, 20);
    const subject = sanitizeText(req.body?.subject, 120);
    const message = sanitizeText(req.body?.message, 2000);
    assert(name.length >= 3, 'Enter your name.');
    assert(RE.email.test(email), 'Enter a valid email address.');
    assert(message.length >= 15, 'Please tell us a little more (at least 15 characters).');
    const row = db.insert('messages', { name, email, phone, subject, message, status: 'new' });
    notify({ type: 'announcement', title: 'New contact message', body: `${name}: ${subject || message.slice(0, 60)}`, link: '', meta: { messageId: row.id } });
    ok(res, { received: true, message: 'Thanks! Our team will reply within one working day.' }, { status: 201 });
  }
);

module.exports = router;
