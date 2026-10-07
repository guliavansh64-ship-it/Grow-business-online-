/**
 * Shared response + notification helpers used by the route modules.
 */
const db = require('./db');

const ok = (res, data, { status = 200, ...extra } = {}) => res.status(status).json({ ok: true, data, ...extra });

function notify({ userId = null, vendorId = null, type = 'system', title = '', body = '', link = '', meta = {} }) {
  return db.insert('notifications', {
    userId,
    vendorId,
    type,
    title,
    body,
    link,
    meta,
    readAt: null,
  });
}

function audit(action, actorId, meta = {}) {
  return db.insert('ledger', { kind: 'audit', action, actorId, meta, at: db.nowIso() });
}

module.exports = { ok, notify, audit };
