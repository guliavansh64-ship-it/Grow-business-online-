/**
 * SUPER ADMIN console API — platform level oversight of vendors, deposits,
 * payouts and support messages. Restricted to the `super_admin` role.
 */
const express = require('express');
const db = require('../db');
const config = require('../config');
const { sanitizeText, assert, badRequest, notFound, clampInt } = require('../security');
const { requireAdmin } = require('../middleware/auth');
const { ok, notify, audit } = require('../respond');
const { paginate, sum, DEPOSIT_STATUSES, WITHDRAWAL_STATUSES, VENDOR_STATUSES } = require('../domain');

const router = express.Router();
router.use(requireAdmin);

router.get('/stats', (_req, res) => {
  const vendors = db.col('vendors');
  const orders = db.col('orders');
  const delivered = orders.filter((o) => o.status === 'delivered');
  ok(res, {
    vendors: {
      total: vendors.length,
      active: vendors.filter((v) => v.status === 'active').length,
      pendingDeposit: vendors.filter((v) => v.status === 'pending_deposit').length,
      pendingActivation: vendors.filter((v) => v.status === 'pending_activation').length,
      suspended: vendors.filter((v) => v.status === 'suspended').length,
    },
    orders: {
      total: orders.length,
      pending: orders.filter((o) => o.status === 'pending').length,
      delivered: delivered.length,
      cancelled: orders.filter((o) => ['cancelled', 'refunded'].includes(o.status)).length,
    },
    money: {
      gmvPaise: sum(delivered, (o) => o.totalPaise),
      commissionPaise: sum(delivered, (o) => o.commissionPaise),
      vendorPayoutPaise: sum(delivered, (o) => o.vendorPaise),
      depositsHeldPaise: sum(db.filter('deposits', (d) => ['approved', 'paid'].includes(d.status)), (d) => d.amountPaise),
      pendingWithdrawalsPaise: sum(db.filter('withdrawals', (w) => ['pending', 'processing'].includes(w.status)), (w) => w.amountPaise),
    },
    catalogue: {
      products: db.col('products').length,
      customers: db.col('customers').length,
      reviews: db.col('reviews').length,
    },
    queue: {
      deposits: db.filter('deposits', (d) => d.status === 'processing').length,
      withdrawals: db.filter('withdrawals', (w) => ['pending', 'processing'].includes(w.status)).length,
      messages: db.filter('messages', (m) => m.status === 'new').length,
    },
    commissionPercent: config.commissionPercent,
  });
});

router.get('/vendors', (req, res) => {
  const q = sanitizeText(req.query.q, 60).toLowerCase();
  const status = sanitizeText(req.query.status, 30);
  let list = db.col('vendors').slice();
  if (q) list = list.filter((v) => `${v.name} ${v.slug} ${v.email} ${v.city}`.toLowerCase().includes(q));
  if (status && status !== 'all') list = list.filter((v) => v.status === status);
  list.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  const page = paginate(list, req.query, 10);
  ok(res, page.items, { pagination: page, statuses: VENDOR_STATUSES });
});

router.patch('/vendors/:id', (req, res) => {
  const v = db.findOneBy('vendors', 'id', req.params.id);
  if (!v) throw notFound('Store not found.');
  const patch = {};
  if (req.body?.status !== undefined) {
    assert(VENDOR_STATUSES.includes(req.body.status), 'Invalid store status.');
    patch.status = req.body.status;
    if (req.body.status === 'active' && !v.activatedAt) patch.activatedAt = db.nowIso();
  }
  if (req.body?.commissionPercent !== undefined) {
    patch.commissionPercent = clampInt(req.body.commissionPercent, 0, 30, config.commissionPercent);
  }
  if (req.body?.suspensionReason !== undefined) patch.suspensionReason = sanitizeText(req.body.suspensionReason, 200);
  const updated = db.update('vendors', v.id, patch);
  const owner = db.find('users', (u) => u.vendorId === v.id && u.role === 'vendor');
  if (patch.status && owner) {
    notify({
      userId: owner.id,
      vendorId: v.id,
      type: 'system',
      title: `Store status: ${patch.status.replace(/_/g, ' ')}`,
      body: patch.suspensionReason || 'Updated by the GrowBusiness Online team.',
    });
  }
  audit('admin.vendor.updated', req.user.id, { vendorId: v.id, patch });
  ok(res, { vendor: updated, message: 'Store updated.' });
});

router.get('/deposits', (req, res) => {
  let list = db.col('deposits').slice();
  const status = sanitizeText(req.query.status, 30);
  if (status && status !== 'all') list = list.filter((d) => d.status === status);
  list.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  const page = paginate(
    list.map((d) => ({ ...d, vendor: db.findOneBy('vendors', 'id', d.vendorId) })),
    req.query,
    10
  );
  ok(res, page.items, { pagination: page, statuses: DEPOSIT_STATUSES });
});

router.patch('/deposits/:id', (req, res) => {
  const d = db.findOneBy('deposits', 'id', req.params.id);
  if (!d) throw notFound('Deposit not found.');
  const status = sanitizeText(req.body?.status, 30);
  assert(['approved', 'rejected', 'refunded', 'pending'].includes(status), 'Invalid deposit status.');
  const vendor = db.findOneBy('vendors', 'id', d.vendorId);
  db.update('deposits', d.id, { status, note: sanitizeText(req.body?.note, 200) || d.note });

  if (vendor) {
    if (status === 'rejected') db.update('vendors', vendor.id, { status: 'rejected' });
    if (status === 'refunded') db.update('vendors', vendor.id, { status: 'suspended' });
  }
  const owner = db.find('users', (u) => u.vendorId === d.vendorId && u.role === 'vendor');
  if (owner) notify({ userId: owner.id, vendorId: d.vendorId, type: 'payment', title: `Deposit ${status}`, body: `Your security deposit was marked ${status}.` });
  audit(`admin.deposit.${status}`, req.user.id, { depositId: d.id });
  ok(res, { deposit: db.findOneBy('deposits', 'id', d.id), message: `Deposit ${status}.` });
});

router.get('/withdrawals', (req, res) => {
  let list = db.col('withdrawals').slice();
  const status = sanitizeText(req.query.status, 30);
  if (status && status !== 'all') list = list.filter((w) => w.status === status);
  list.sort((a, b) => new Date(b.requestedAt || b.createdAt) - new Date(a.requestedAt || a.createdAt));
  const page = paginate(list.map((w) => ({ ...w, vendor: db.findOneBy('vendors', 'id', w.vendorId) })), req.query, 10);
  ok(res, page.items, { pagination: page, statuses: WITHDRAWAL_STATUSES });
});

router.patch('/withdrawals/:id', (req, res) => {
  const w = db.findOneBy('withdrawals', 'id', req.params.id);
  if (!w) throw notFound('Withdrawal not found.');
  const status = sanitizeText(req.body?.status, 30);
  assert(WITHDRAWAL_STATUSES.includes(status), 'Invalid withdrawal status.');
  const vendor = db.findOneBy('vendors', 'id', w.vendorId);
  if (!vendor) throw notFound('Store not found.');

  db.update('withdrawals', w.id, {
    status,
    processedAt: ['paid', 'rejected', 'cancelled'].includes(status) ? db.nowIso() : w.processedAt,
    reference: status === 'paid' ? `PAYOUT${Date.now().toString().slice(-6)}` : w.reference,
    note: sanitizeText(req.body?.note, 200) || w.note,
  });

  const balance = { ...vendor.balance };
  if (status === 'paid') {
    balance.withdrawnPaise += w.amountPaise;
    db.insert('ledger', { kind: 'withdrawal_paid', vendorId: vendor.id, creditPaise: 0, debitPaise: w.amountPaise, note: `Payout ${w.id}` });
  }
  if (status === 'rejected' || status === 'cancelled') {
    balance.withdrawnPaise = Math.max(0, balance.withdrawnPaise);
    db.insert('ledger', { kind: 'withdrawal_reversed', vendorId: vendor.id, creditPaise: w.amountPaise, debitPaise: 0, note: `Payout ${w.id} ${status} — amount returned to balance` });
  }
  db.update('vendors', vendor.id, { balance });

  const owner = db.find('users', (u) => u.vendorId === vendor.id && u.role === 'vendor');
  if (owner) {
    notify({
      userId: owner.id,
      vendorId: vendor.id,
      type: 'payment',
      title: `Withdrawal ${status}`,
      body: `₹${(w.amountPaise / 100).toFixed(2)} payout is now ${status}.`,
      link: 'withdrawals.html',
    });
  }
  audit(`admin.withdrawal.${status}`, req.user.id, { withdrawalId: w.id });
  ok(res, { withdrawal: db.findOneBy('withdrawals', 'id', w.id), message: `Withdrawal ${status}.` });
});

router.get('/orders', (req, res) => {
  const q = sanitizeText(req.query.q, 60).toLowerCase();
  const status = sanitizeText(req.query.status, 30);
  const paymentStatus = sanitizeText(req.query.paymentStatus, 30);
  let list = db.col('orders').slice();
  if (q) list = list.filter((o) => `${o.orderNumber} ${o.customer.name} ${o.customer.phone} ${o.vendorSlug}`.toLowerCase().includes(q));
  if (status && status !== 'all') list = list.filter((o) => o.status === status);
  if (paymentStatus) list = list.filter((o) => o.paymentStatus === paymentStatus);
  list.sort((a, b) => new Date(b.placedAt) - new Date(a.placedAt));
  const page = paginate(list, req.query, 10);
  const counts = { all: db.col('orders').length };
  for (const s of require('../domain').ORDER_STATUSES) counts[s] = db.col('orders').filter((o) => o.status === s).length;
  ok(res, page.items, { pagination: page, counts });
});

router.get('/messages', (req, res) => {
  const status = sanitizeText(req.query.status, 20);
  const q = sanitizeText(req.query.q, 60).toLowerCase();
  let list = db.col('messages').slice();
  if (status && status !== 'all') list = list.filter((m) => m.status === status);
  if (q) list = list.filter((m) => `${m.name} ${m.email} ${m.subject} ${m.message}`.toLowerCase().includes(q));
  list.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  const page = paginate(list, req.query, 10);
  const all = db.col('messages');
  ok(res, page.items, {
    pagination: page,
    counts: { all: all.length, new: all.filter((m) => m.status === 'new').length, read: all.filter((m) => m.status === 'read').length, replied: all.filter((m) => m.status === 'replied').length, closed: all.filter((m) => m.status === 'closed').length },
  });
});

router.patch('/messages/:id', (req, res) => {
  const m = db.findOneBy('messages', 'id', req.params.id);
  if (!m) throw notFound('Message not found.');
  const status = sanitizeText(req.body?.status, 20);
  assert(['new', 'read', 'replied', 'closed'].includes(status), 'Invalid message status.');
  if (status === 'replied' || status === 'closed') {
    notify({
      userId: m.userId || null,
      vendorId: m.vendorId || null,
      type: 'system',
      title: `Support update: ${m.subject || 'your request'}`,
      body: status === 'replied' ? 'Our team has replied to your request.' : 'Your support request was closed.',
      link: '',
    });
  }
  ok(res, { message: db.update('messages', m.id, { status }), message: 'Updated.' });
});

module.exports = router;
