/**
 * MONEY routes: security deposit, balance, withdrawals and the 48h activation.
 *
 * Spec §11, §23, §24, §25, §47 — the browser can never:
 *   • mark a deposit as paid      (only the gateway webhook can, with a secret)
 *   • change a balance            (balances are derived from settled orders)
 *   • transfer money              (withdrawals are requests, paid out by admin)
 */
const express = require('express');
const crypto = require('crypto');
const db = require('../db');
const config = require('../config');
const { sanitizeText, assert, badRequest, notFound, forbidden } = require('../security');
const { asyncHandler, requireAuth, requireVendor, requireAdmin, ownVendor, assertTenant } = require('../middleware/auth');
const { ok, notify, audit } = require('../respond');
const { commissionSplit, clampInt, DEPOSIT_STATUSES, WITHDRAWAL_STATUSES } = require('../domain');

const router = express.Router();

const platform = () => (db.find('meta', (m) => m.key === 'platform') || { value: {} }).value;

function depositView(d, vendor) {
  return {
    id: d.id,
    vendorId: d.vendorId,
    amountPaise: d.amountPaise,
    status: d.status,
    method: d.method,
    reference: d.reference,
    initiatedAt: d.initiatedAt,
    confirmedAt: d.confirmedAt,
    note: d.note,
    refundable: true,
    storeSlug: vendor?.slug,
    activationDueAt: vendor?.activationDueAt || null,
  };
}

/* -------------------------------------------------------------------- deposit */

router.get('/deposit', requireAuth, (req, res) => {
  const vendor = req.user.vendorId ? db.findOneBy('vendors', 'id', req.user.vendorId) : null;
  if (!vendor) throw forbidden('Only vendor accounts have a security deposit.');
  let deposit = db.find('deposits', (d) => d.vendorId === vendor.id);
  if (!deposit) {
    deposit = db.insert('deposits', {
      vendorId: vendor.id,
      userId: req.user.id,
      amountPaise: config.depositPaise,
      status: 'pending',
      method: null,
      reference: null,
      initiatedAt: null,
      confirmedAt: null,
      note: 'Awaiting payment',
    });
  }
  const dueAt = vendor.activationDueAt ? new Date(vendor.activationDueAt).getTime() : null;
  ok(res, {
    deposit: depositView(deposit, vendor),
    vendor: { id: vendor.id, slug: vendor.slug, name: vendor.name, status: vendor.status },
    activation: {
      dueAt: vendor.activationDueAt,
      remainingMs: dueAt ? Math.max(0, dueAt - Date.now()) : 0,
      serverTime: db.nowIso(),
      activationHours: config.activationHours,
      ready: vendor.status === 'active',
    },
    paymentMethods: (platform().paymentMethods || []).filter((m) => m.enabled && m.kind === 'online'),
    statuses: DEPOSIT_STATUSES,
    explainer: {
      title: 'Refundable security deposit',
      amountPaise: config.depositPaise,
      points: [
        '₹1,000 is a refundable security deposit, not a charge for security features.',
        'It is returned in full when you close your store in good standing.',
        'Your store activation starts the moment the payment is confirmed.',
        'Only the payment gateway can confirm a payment — the website cannot.',
      ],
    },
  });
});

/** Creates a payment intent. The deposit stays "processing" until the webhook lands. */
router.post('/deposit/initiate', requireAuth, (req, res) => {
  const vendor = req.user.vendorId ? db.findOneBy('vendors', 'id', req.user.vendorId) : null;
  if (!vendor) throw forbidden('Only vendor accounts have a security deposit.');
  const deposit = db.find('deposits', (d) => d.vendorId === vendor.id);
  if (!deposit) throw notFound('Deposit record not found.');
  if (['approved', 'paid'].includes(deposit.status)) throw badRequest('This deposit has already been paid.');

  const method = sanitizeText(req.body?.method, 30) || 'upi';
  const allowed = (platform().paymentMethods || []).filter((m) => m.enabled && m.kind === 'online').map((m) => m.id);
  assert(allowed.includes(method), 'Choose a valid payment method.');

  const reference = `GBO_DEP_${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
  db.update('deposits', deposit.id, { status: 'processing', method, reference, initiatedAt: db.nowIso() });
  audit('deposit.initiated', req.user.id, { depositId: deposit.id, method });
  ok(res, {
    deposit: depositView(db.findOneBy('deposits', 'id', deposit.id), vendor),
    redirectNote: 'In production the customer is redirected to the payment gateway here.',
    // The frontend may ONLY show a "we are waiting for confirmation" state.
    canConfirmOnClient: false,
  });
});

/**
 * The real payment confirmation endpoint. It is protected by a shared secret
 * that only the payment gateway holds, so a browser cannot forge success.
 */
function confirmDeposit(depositId, { reference, method, secret }) {
  const expected = crypto.createHmac('sha256', config.gatewaySecret).update(String(depositId)).digest('hex');
  const provided = String(secret || '');
  const a = Buffer.from(provided);
  const b = Buffer.from(expected.length === provided.length ? expected : ' '.repeat(expected.length));
  const signatureOk = a.length === b.length && crypto.timingSafeEqual(a, b);
  if (!signatureOk) throw forbidden('Gateway signature rejected.');

  const deposit = db.findOneBy('deposits', 'id', depositId);
  if (!deposit) throw notFound('Deposit not found.');
  if (deposit.status === 'approved') return deposit;

  const vendor = db.findOneBy('vendors', 'id', deposit.vendorId);
  if (!vendor) throw notFound('Store not found for this deposit.');

  const paidAt = db.nowIso();
  const activationMs = config.devFastActivation ? 60 * 1000 : config.activationHours * 3600 * 1000;
  const activationDueAt = new Date(Date.now() + activationMs).toISOString();

  db.update('deposits', depositId, {
    status: 'approved',
    amountPaise: deposit.amountPaise || config.depositPaise,
    method: method || deposit.method || 'upi',
    reference: reference || deposit.reference,
    confirmedAt: paidAt,
    note: 'Confirmed by payment gateway',
  });
  db.update('vendors', vendor.id, {
    status: 'pending_activation',
    depositPaidAt: paidAt,
    activationDueAt,
  });
  db.insert('ledger', {
    kind: 'deposit_received',
    vendorId: vendor.id,
    creditPaise: 0,
    debitPaise: 0,
    depositPaise: deposit.amountPaise || config.depositPaise,
    note: 'Refundable security deposit received',
  });
  const owner = db.find('users', (u) => u.vendorId === vendor.id && u.role === 'vendor');
  notify({
    userId: owner?.id || null,
    vendorId: vendor.id,
    type: 'payment',
    title: 'Payment received ✅',
    body: `Your ₹${((deposit.amountPaise || config.depositPaise) / 100).toFixed(0)} security deposit is confirmed. Store activation has started.`,
    link: 'activation.html',
  });
  audit('deposit.confirmed', owner?.id || null, { depositId, vendorId: vendor.id });
  return db.findOneBy('deposits', 'id', depositId);
}

router.post(
  '/gateway/deposit-webhook',
  express.json(),
  asyncHandler(async (req, res) => {
    const depositId = sanitizeText(req.body?.depositId, 60);
    const secret = req.headers['x-gateway-signature'] || req.body?.signature;
    const deposit = confirmDeposit(depositId, { reference: sanitizeText(req.body?.reference, 60), method: sanitizeText(req.body?.method, 30), secret });
    ok(res, { confirmed: true, status: deposit.status });
  })
);

/**
 * DEMO ONLY — stands in for the gateway callback while no PSP is connected.
 * Disabled automatically when NODE_ENV=production or DEV_TOOLS=false.
 */
router.post(
  '/dev/simulate-payment',
  express.json(),
  asyncHandler(async (req, res) => {
    if (!config.devTools) throw forbidden('Demo payment simulation is disabled on this server.');
    const depositId = sanitizeText(req.body?.depositId, 60);
    const deposit = db.findOneBy('deposits', 'id', depositId);
    if (!deposit) throw notFound('Deposit not found.');
    const expected = crypto.createHmac('sha256', config.gatewaySecret).update(String(depositId)).digest('hex');
    const updated = confirmDeposit(depositId, { reference: `SIM${Date.now().toString().slice(-6)}`, method: deposit.method || 'upi', secret: expected });
    const vendor = db.findOneBy('vendors', 'id', updated.vendorId);
    ok(res, {
      confirmed: true,
      deposit: depositView(updated, vendor),
      activationDueAt: vendor.activationDueAt,
      serverTime: db.nowIso(),
      warning: 'This endpoint is a development stub. In production the real gateway calls /api/finance/gateway/deposit-webhook.',
    });
  })
);

/* ---------------------------------------------------------------- activation */

router.get('/activation', requireAuth, (req, res) => {
  const vendor = req.user.vendorId ? db.findOneBy('vendors', 'id', req.user.vendorId) : null;
  if (!vendor) throw forbidden('Only vendor accounts have an activation window.');
  const dueAt = vendor.activationDueAt ? new Date(vendor.activationDueAt).getTime() : null;
  const remaining = dueAt ? Math.max(0, dueAt - Date.now()) : 0;

  // Auto-flip to live once the server side window has elapsed.
  if (dueAt && remaining === 0 && vendor.status === 'pending_activation') {
    db.update('vendors', vendor.id, { status: 'active', activatedAt: db.nowIso() });
    notify({
      userId: req.user.id,
      vendorId: vendor.id,
      type: 'system',
      title: 'Store activated 🎉',
      body: `${vendor.name} is now live at ${vendor.slug}.${config.rootDomain}.`,
      link: 'admin/dashboard.html',
    });
    vendor.status = 'active';
    vendor.activatedAt = db.nowIso();
  }

  ok(res, {
    status: vendor.status,
    slug: vendor.slug,
    name: vendor.name,
    logo: vendor.logo,
    depositPaidAt: vendor.depositPaidAt,
    activationDueAt: vendor.activationDueAt,
    activatedAt: vendor.activatedAt,
    remainingMs: remaining,
    serverTime: db.nowIso(),
    serverNow: Date.now(),
    ready: vendor.status === 'active',
    storefrontUrl: `https://${vendor.slug}.${config.rootDomain}`,
    previewUrl: `/vendor/index.html?vendor=${vendor.slug}`,
    dashboardUrl: '/admin/dashboard.html',
    checklist: [
      { key: 'account', label: 'Account created', done: true },
      { key: 'deposit', label: 'Security deposit paid', done: !!vendor.depositPaidAt },
      { key: 'activation', label: 'Store activation window', done: vendor.status === 'active' },
      { key: 'products', label: 'Add your first products', done: db.filter('products', (p) => p.vendorId === vendor.id).length > 0 },
      { key: 'branding', label: 'Upload logo & banner', done: !!vendor.logo },
    ],
  });
});

/* ------------------------------------------------------------------ balance */

router.get('/balance', requireVendor, (req, res) => {
  const vendor = ownVendor(req) || db.findOneBy('vendors', 'id', req.query.vendorId);
  if (!vendor) throw notFound('Store not found.');
  if (req.user.role !== 'super_admin') assertTenant(req, vendor.id);

  const orders = db.filter('orders', (o) => o.vendorId === vendor.id);
  const settled = orders.filter((o) => o.status === 'delivered');
  const inFlight = orders.filter((o) => !['delivered', 'cancelled', 'refunded'].includes(o.status));
  const withdrawals = db.filter('withdrawals', (w) => w.vendorId === vendor.id);
  const reserved = withdrawals.filter((w) => ['pending', 'processing', 'approved'].includes(w.status));

  const earnedPaise = settled.reduce((a, o) => a + o.vendorPaise, 0);
  const commissionPaise = settled.reduce((a, o) => a + o.commissionPaise, 0);
  const withdrawnPaise = withdrawals.filter((w) => w.status === 'paid').reduce((a, w) => a + w.amountPaise, 0);
  const reservedPaise = reserved.reduce((a, w) => a + w.amountPaise, 0);
  const pendingPaise = inFlight.reduce((a, o) => a + o.vendorPaise, 0);
  const availablePaise = Math.max(0, earnedPaise - withdrawnPaise - reservedPaise);

  ok(res, {
    vendorId: vendor.id,
    availablePaise,
    pendingPaise,
    reservedPaise,
    earnedPaise,
    commissionPaise,
    withdrawnPaise,
    lifetimeGrossPaise: orders.filter((o) => !['cancelled', 'refunded'].includes(o.status)).reduce((a, o) => a + o.totalPaise, 0),
    commissionPercent: vendor.commissionPercent ?? config.commissionPercent,
    settledOrders: settled.length,
    inFlightOrders: inFlight.length,
    minWithdrawalPaise: platform().minWithdrawalPaise ?? 50000,
    payoutDays: platform().payoutDays ?? '1-2 working days',
    readOnly: true, // balances are computed server side — the UI can only display them
    ledger: db
      .filter('ledger', (l) => l.vendorId === vendor.id)
      .sort((a, b) => new Date(b.at || b.createdAt) - new Date(a.at || a.createdAt))
      .slice(0, 25)
      .map((l) => ({
        id: l.id,
        kind: l.kind,
        note: l.note,
        creditPaise: l.creditPaise || 0,
        debitPaise: l.debitPaise || 0,
        commissionPaise: l.commissionPaise || 0,
        at: l.at || l.createdAt,
      })),
    example: (() => {
      const sample = settled[0] || orders[0];
      if (!sample) return null;
      const split = commissionSplit(sample.totalPaise, vendor.commissionPercent ?? config.commissionPercent);
      return {
        orderNumber: sample.orderNumber,
        orderAmountPaise: split.grossPaise,
        commissionPaise: split.commissionPaise,
        vendorAmountPaise: split.vendorPaise,
        percent: split.commissionPercent,
      };
    })(),
  });
});

/* -------------------------------------------------------------- withdrawals */

const withdrawalView = (w) => ({
  id: w.id,
  amountPaise: w.amountPaise,
  status: w.status,
  method: w.method,
  account: w.account,
  ifsc: w.ifsc,
  requestedAt: w.requestedAt || w.createdAt,
  processedAt: w.processedAt,
  reference: w.reference,
  note: w.note,
});

router.get('/withdrawals', requireVendor, (req, res) => {
  const vendor = ownVendor(req) || db.findOneBy('vendors', 'id', req.query.vendorId);
  if (!vendor) throw notFound('Store not found.');
  if (req.user.role !== 'super_admin') assertTenant(req, vendor.id);
  const list = db
    .filter('withdrawals', (w) => w.vendorId === vendor.id)
    .sort((a, b) => new Date(b.requestedAt || b.createdAt) - new Date(a.requestedAt || a.createdAt))
    .map(withdrawalView);
  ok(res, list, { statuses: WITHDRAWAL_STATUSES, methods: platform().withdrawalMethods || [] });
});

router.post('/withdrawals', requireVendor, (req, res) => {
  const vendor = ownVendor(req);
  if (!vendor) throw forbidden('Select a store first.');
  if (vendor.status !== 'active') throw badRequest('Your store must be active before you can request a payout.');

  const b = req.body || {};
  const amountPaise = clampInt(b.amountPaise !== undefined ? b.amountPaise : Math.round(Number(b.amount || 0) * 100), 100, 100000000, 0);
  const min = platform().minWithdrawalPaise ?? 50000;
  assert(amountPaise >= min, `Minimum withdrawal is ₹${(min / 100).toFixed(0)}.`);

  // Re-derive the available balance on the server — never trust the client's number.
  const orders = db.filter('orders', (o) => o.vendorId === vendor.id);
  const earned = orders.filter((o) => o.status === 'delivered').reduce((a, o) => a + o.vendorPaise, 0);
  const paid = db.filter('withdrawals', (w) => w.vendorId === vendor.id && w.status === 'paid').reduce((a, w) => a + w.amountPaise, 0);
  const reserved = db.filter('withdrawals', (w) => w.vendorId === vendor.id && ['pending', 'processing', 'approved'].includes(w.status)).reduce((a, w) => a + w.amountPaise, 0);
  const available = Math.max(0, earned - paid - reserved);
  assert(amountPaise <= available, `You can withdraw up to ₹${(available / 100).toFixed(2)} right now.`);

  const method = sanitizeText(b.method, 20);
  assert(['bank', 'upi'].includes(method), 'Choose bank transfer or UPI.');
  const account = sanitizeText(b.account, 120);
  assert(account.length >= 5, method === 'upi' ? 'Enter your UPI ID.' : 'Enter your account number.');
  if (method === 'upi') assert(/^[\w.\-]{2,}@[a-zA-Z]{2,}$/.test(account), 'That UPI ID does not look right (example: name@okhdfc).');
  const ifsc = sanitizeText(b.ifsc, 20).toUpperCase();
  if (method === 'bank') assert(/^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifsc), 'Enter a valid IFSC code (example: HDFC0001234).');
  const holder = sanitizeText(b.holder || vendor.ownerName, 80);
  assert(holder.length >= 3, 'Enter the account holder name.');

  const w = db.insert('withdrawals', {
    vendorId: vendor.id,
    userId: req.user.id,
    amountPaise,
    status: 'pending',
    method,
    account,
    ifsc: method === 'bank' ? ifsc : '',
    holder,
    requestedAt: db.nowIso(),
    processedAt: null,
    reference: null,
    note: 'Submitted for review.',
  });
  notify({
    userId: req.user.id,
    vendorId: vendor.id,
    type: 'payment',
    title: 'Withdrawal requested',
    body: `₹${(amountPaise / 100).toFixed(2)} payout request received. It is usually approved within ${platform().payoutDays || '1-2 working days'}.`,
    link: 'withdrawals.html',
  });
  audit('withdrawal.requested', req.user.id, { withdrawalId: w.id, amountPaise });
  ok(res, { withdrawal: withdrawalView(w), availablePaise: Math.max(0, available - amountPaise), message: 'Withdrawal request submitted.' }, { status: 201 });
});

router.delete('/withdrawals/:id', requireVendor, (req, res) => {
  const w = db.findOneBy('withdrawals', 'id', req.params.id);
  if (!w) throw notFound('Withdrawal not found.');
  assertTenant(req, w.vendorId);
  if (w.status !== 'pending') throw badRequest('Only pending requests can be cancelled.');
  db.update('withdrawals', w.id, { status: 'cancelled', note: 'Cancelled by vendor.', processedAt: db.nowIso() });
  ok(res, { cancelled: true, message: 'Withdrawal request cancelled.' });
});

module.exports = router;
module.exports.confirmDeposit = confirmDeposit;
module.exports.depositView = depositView;
module.exports.withdrawalView = withdrawalView;
