/**
 * Tiny zero-dependency JSON document store.
 *
 * The whole database lives in memory and is flushed atomically to
 * backend/data/db.json. This keeps the backend deployable on the cheapest
 * Hostinger Node plan (no native modules to compile) while still giving us
 * real persistence. Swap `load()`/`persist()` for MySQL/Postgres later —
 * every route goes through the collection helpers below, so the change is local.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const config = require('./config');

const COLLECTIONS = [
  'users',
  'sessions',
  'vendors',
  'categories',
  'products',
  'reviews',
  'orders',
  'customers',
  'addresses',
  'wishlists',
  'deposits',
  'withdrawals',
  'ledger',
  'notifications',
  'passwordResets',
  'emailVerifications',
  'messages',
  'meta',
];

let db = null;
let flushTimer = null;
let dirty = false;

function blank() {
  const out = { schemaVersion: 1, createdAt: new Date().toISOString() };
  for (const c of COLLECTIONS) out[c] = [];
  out.meta = [{ key: 'platform', value: {} }];
  return out;
}

function ensureDirs() {
  fs.mkdirSync(config.paths.data, { recursive: true });
}

function load() {
  ensureDirs();
  if (fs.existsSync(config.paths.dbFile)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(config.paths.dbFile, 'utf8'));
      db = Object.assign(blank(), parsed);
      for (const c of COLLECTIONS) if (!Array.isArray(db[c])) db[c] = [];
    } catch (err) {
      const backup = `${config.paths.dbFile}.corrupt-${Date.now()}`;
      fs.copyFileSync(config.paths.dbFile, backup);
      console.error(`[db] db.json unreadable (${err.message}); backed up to ${backup} and starting fresh.`);
      db = blank();
    }
  } else {
    db = blank();
  }
  return db;
}

/** Atomic write: temp file + rename, so a crash can never truncate the DB. */
function persist(now = false) {
  if (!db) return;
  dirty = true;
  if (!now) {
    if (flushTimer) return;
    flushTimer = setTimeout(() => {
      flushTimer = null;
      persist(true);
    }, 250);
    return;
  }
  if (!dirty) return;
  dirty = false;
  ensureDirs();
  const tmp = `${config.paths.dbFile}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, config.paths.dbFile);
}

function get() {
  if (!db) load();
  return db;
}

function col(name) {
  if (!COLLECTIONS.includes(name)) throw new Error(`Unknown collection: ${name}`);
  return get()[name];
}

const uid = (prefix = 'id') => `${prefix}_${crypto.randomBytes(9).toString('base64url')}`;

const nowIso = () => new Date().toISOString();

function insert(name, doc) {
  const record = { id: doc.id || uid(name.slice(0, 3)), createdAt: nowIso(), updatedAt: nowIso(), ...doc };
  record.id = doc.id || record.id;
  col(name).push(record);
  persist();
  return record;
}

function find(name, predicate) {
  return col(name).find(predicate) || null;
}

function filter(name, predicate) {
  return predicate ? col(name).filter(predicate) : col(name).slice();
}

function update(name, id, patch) {
  const row = col(name).find((r) => r.id === id);
  if (!row) return null;
  Object.assign(row, patch, { updatedAt: nowIso() });
  persist();
  return row;
}

function remove(name, id) {
  const list = col(name);
  const i = list.findIndex((r) => r.id === id);
  if (i === -1) return false;
  list.splice(i, 1);
  persist();
  return true;
}

function findOneBy(name, key, value) {
  return find(name, (r) => r[key] === value);
}

function replaceAll(next) {
  db = Object.assign(blank(), next);
  persist(true);
  return db;
}

module.exports = {
  COLLECTIONS,
  load,
  persist,
  get,
  col,
  uid,
  nowIso,
  insert,
  find,
  filter,
  update,
  remove,
  findOneBy,
  replaceAll,
};
