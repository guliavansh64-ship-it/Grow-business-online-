/**
 * utils.js — DOM helpers, formatting, storage, validation and misc utilities.
 * Zero dependencies, used by every other module.
 */
import cfg from './config.js';

/* ------------------------------------------------------------------- DOM */

export const $ = (sel, scope = document) => scope.querySelector(sel);
export const $$ = (sel, scope = document) => Array.from(scope.querySelectorAll(sel));

/**
 * html`<div class="${cls}">${name}</div>` — tagged template that escapes every
 * interpolation. This is the project's XSS defence for templated markup
 * (spec §47): values are inserted as text unless you explicitly pass `raw()`.
 */
const RAW = Symbol('raw-html');
export const raw = (value) => ({ [RAW]: String(value ?? '') });
const isRaw = (v) => v && typeof v === 'object' && RAW in v;

export function html(strings, ...values) {
  let out = '';
  strings.forEach((chunk, i) => {
    out += chunk;
    if (i >= values.length) return;
    const v = values[i];
    if (v === null || v === undefined || v === false) return;
    if (Array.isArray(v)) {
      out += v.map((x) => (isRaw(x) ? x[RAW] : x === null || x === undefined || x === false ? '' : esc(x))).join('');
      return;
    }
    out += isRaw(v) ? v[RAW] : esc(v);
  });
  return out;
}

/** Sets innerHTML from a safe html`` template result (or escapes a plain string). */
export function setHtml(el, content) {
  if (!el) return el;
  el.innerHTML = typeof content === 'string' ? content : String(content ?? '');
  return el;
}

export function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k === 'text') node.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
    else node.setAttribute(k, v);
  }
  for (const child of [].concat(children)) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child.nodeType ? child : document.createTextNode(String(child)));
  }
  return node;
}

export const on = (target, event, handler, options) => {
  const list = typeof target === 'string' ? $$(target) : [target].filter(Boolean);
  list.forEach((t) => t.addEventListener(event, handler, options));
  return () => list.forEach((t) => t.removeEventListener(event, handler, options));
};

/** Event delegation — survives re-rendered lists. */
export function delegate(root, selector, event, handler) {
  root.addEventListener(event, (e) => {
    const target = e.target.closest(selector);
    if (target && root.contains(target)) handler(e, target);
  });
}

export function clear(node) {
  if (node) node.innerHTML = '';
  return node;
}

export function toggle(node, force, className = 'hidden') {
  if (!node) return;
  node.classList.toggle(className, !force);
}

export function show(node, display = '') {
  if (node) node.style.display = display;
}
export function hide(node) {
  if (node) node.style.display = 'none';
}

/* ------------------------------------------------------------ formatting */

const inrFormatter = new Intl.NumberFormat(cfg.locale || 'en-IN', {
  style: 'currency',
  currency: cfg.currency || 'INR',
  maximumFractionDigits: 2,
  minimumFractionDigits: 0,
});
const inrWhole = new Intl.NumberFormat(cfg.locale || 'en-IN', { maximumFractionDigits: 0 });

/** Money always arrives from the API in paise (integers). */
export function money(paise, { decimals = 2, compact = false } = {}) {
  const rupees = Number(paise || 0) / 100;
  if (compact) return compactNumber(rupees);
  return decimals === 0
    ? `₹${inrWhole.format(Math.round(rupees))}`
    : `₹${rupees.toLocaleString(cfg.locale || 'en-IN', { minimumFractionDigits: Number.isInteger(rupees) ? 0 : 2, maximumFractionDigits: decimals })}`;
}

export function compactNumber(n) {
  const v = Number(n || 0);
  const abs = Math.abs(v);
  if (abs >= 1e7) return `₹${(v / 1e7).toFixed(abs >= 1e8 ? 0 : 2)}Cr`;
  if (abs >= 1e5) return `₹${(v / 1e5).toFixed(abs >= 1e6 ? 0 : 2)}L`;
  if (abs >= 1e3) return `₹${(v / 1e3).toFixed(abs >= 1e4 ? 0 : 1)}K`;
  return `₹${inrWhole.format(Math.round(v))}`;
}

export const num = (n) => Number(n || 0).toLocaleString(cfg.locale || 'en-IN');
export const pct = (n, digits = 0) => `${Number(n || 0).toFixed(digits)}%`;

const pad = (n) => String(n).padStart(2, '0');

export function dateShort(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString(cfg.locale || 'en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}
export function dateTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return `${d.toLocaleDateString(cfg.locale || 'en-IN', { day: '2-digit', month: 'short' })}, ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
export function timeAgo(iso) {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(diff)) return '';
  const s = Math.round(diff / 1000);
  if (s < 45) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} hr ago`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d} day${d === 1 ? '' : 's'} ago`;
  const mo = Math.round(d / 30);
  if (mo < 12) return `${mo} month${mo === 1 ? '' : 's'} ago`;
  return `${Math.round(mo / 12)} yr ago`;
}

/** 90000ms → { d, h, m, s } for the activation countdown (spec §12). */
export function splitDuration(ms) {
  const total = Math.max(0, Math.floor(Number(ms) || 0));
  return {
    total,
    d: Math.floor(total / 86400000),
    h: Math.floor((total % 86400000) / 3600000),
    m: Math.floor((total % 3600000) / 60000),
    s: Math.floor((total % 60000) / 1000),
    done: total <= 0,
  };
}

export const initials = (name = '') =>
  String(name)
    .replace(/[^A-Za-z ]/g, '')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() || '')
    .join('') || '?';

export const sentence = (value = '') => String(value).replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

export const titleCase = sentence;

export function slugify(value) {
  return String(value || '')
    .toLowerCase()
    .trim()
    .replace(/['"]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/* -------------------------------------------------------------- timing */

export function debounce(fn, wait = 300) {
  let t;
  const wrapped = (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), wait);
  };
  wrapped.cancel = () => clearTimeout(t);
  wrapped.flush = (...args) => {
    clearTimeout(t);
    fn(...args);
  };
  return wrapped;
}

export function throttle(fn, wait = 120) {
  let last = 0;
  let timer = null;
  return (...args) => {
    const now = Date.now();
    const remaining = wait - (now - last);
    if (remaining <= 0) {
      last = now;
      fn(...args);
    } else if (!timer) {
      timer = setTimeout(() => {
        timer = null;
        last = Date.now();
        fn(...args);
      }, remaining);
    }
  };
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Counts a number up — used for KPI cards and homepage stats. */
export function countUp(node, to, { duration = 900, format = (n) => Math.round(n).toString() } = {}) {
  if (!node) return;
  const from = 0;
  const start = performance.now();
  const tick = (now) => {
    const p = Math.min(1, (now - start) / duration);
    const eased = 1 - Math.pow(1 - p, 3);
    node.textContent = format(from + (to - from) * eased);
    if (p < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

/* ------------------------------------------------------------- storage */

const PREFIX = 'gbo:';

export const store = {
  get(key, fallback = null) {
    try {
      const raw = localStorage.getItem(PREFIX + key);
      if (raw === null) return fallback;
      const parsed = JSON.parse(raw);
      if (parsed && parsed.__exp && Date.now() > parsed.__exp) {
        localStorage.removeItem(PREFIX + key);
        return fallback;
      }
      return parsed && parsed.__exp ? parsed.value : parsed;
    } catch {
      return fallback;
    }
  },
  set(key, value, ttlMs) {
    try {
      localStorage.setItem(PREFIX + key, JSON.stringify(ttlMs ? { value, __exp: Date.now() + ttlMs } : value));
    } catch {
      /* private mode / quota — non fatal */
    }
  },
  remove(key) {
    try {
      localStorage.removeItem(PREFIX + key);
    } catch {
      /* ignore */
    }
  },
  clear() {
    try {
      Object.keys(localStorage)
        .filter((k) => k.startsWith(PREFIX))
        .forEach((k) => localStorage.removeItem(k));
    } catch {
      /* ignore */
    }
  },
};

/* ----------------------------------------------------------------- urls */

export const query = () => new URLSearchParams(globalThis.location.search);
export const qget = (key, fallback = '') => query().get(key) || fallback;

export function setQuery(params, { replace = true } = {}) {
  const url = new URL(globalThis.location.href);
  for (const [k, v] of Object.entries(params)) {
    if (v === null || v === undefined || v === '') url.searchParams.delete(k);
    else url.searchParams.set(k, String(v));
  }
  globalThis.history[replace ? 'replaceState' : 'pushState']({}, '', url);
  return url;
}

/** Resolves a link so it keeps working from /pages, /vendor and /admin. */
const SITE_ROOT = new URL('../', import.meta.url).href;

export function url(path = '') {
  if (/^(https?:|mailto:|tel:|#|data:)/.test(path)) return path;
  try {
    return new URL(String(path).replace(/^\/+/, ''), SITE_ROOT).href;
  } catch {
    return path;
  }
}

export const asset = url;

export function absolute(href) {
  try {
    return new URL(href, globalThis.location.href).href;
  } catch {
    return href;
  }
}

/* ---------------------------------------------------------- validation */

export const RE = {
  email: /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i,
  phone: /^[0-9+\-\s]{8,15}$/,
  pincode: /^[1-9][0-9]{5}$/,
  upi: /^[\w.\-]{2,}@[a-zA-Z]{2,}$/,
  ifsc: /^[A-Z]{4}0[A-Z0-9]{6}$/,
  hex: /^#([0-9a-f]{3}|[0-9a-f]{6})$/i,
  url: /^https?:\/\/[^\s]+$/i,
};

export const validators = {
  required: (v) => (String(v ?? '').trim() ? null : 'This field is required.'),
  email: (v) => (RE.email.test(String(v || '').trim()) ? null : 'Enter a valid email address.'),
  emailOptional: (v) => (!String(v || '').trim() || RE.email.test(String(v).trim()) ? null : 'Enter a valid email address.'),
  phone: (v) => (RE.phone.test(String(v || '').replace(/\s/g, '')) ? null : 'Enter a valid mobile number.'),
  pincode: (v) => (RE.pincode.test(String(v || '').trim()) ? null : 'Enter a valid 6 digit pincode.'),
  minLen: (n) => (v) => (String(v || '').trim().length >= n ? null : `Use at least ${n} characters.`),
  maxLen: (n) => (v) => (String(v || '').trim().length <= n ? null : `Keep this under ${n} characters.`),
  password: (v) => (String(v || '').length >= 8 ? null : 'Password must be at least 8 characters.'),
  sameAs: (other) => (v, form) => (String(v || '') === String(form?.[other] || '') ? null : 'These values do not match.'),
  checked: (v) => (v === true || v === 'true' || v === 'on' ? null : 'You must accept this to continue.'),
  number: (v) => (v === '' || Number.isFinite(Number(v)) ? null : 'Enter a number.'),
  min: (n) => (v) => (v === '' || Number(v) >= n ? null : `Must be at least ${n}.`),
  upi: (v) => (RE.upi.test(String(v || '').trim()) ? null : 'Enter a valid UPI ID (name@bank).'),
  ifsc: (v) => (RE.ifsc.test(String(v || '').trim().toUpperCase()) ? null : 'Enter a valid IFSC (e.g. HDFC0001234).'),
  hex: (v) => (RE.hex.test(String(v || '').trim()) ? null : 'Use a hex colour like #6D5EF6.'),
};

/**
 * Reads a form into a plain object and validates it against a rule map:
 *   { email: [validators.required, validators.email] }
 * Returns { values, errors, valid }.
 */
export function readForm(form, rules = {}) {
  const data = new FormData(form);
  const values = {};
  for (const [key, value] of data.entries()) {
    if (key in values) values[key] = [].concat(values[key], value);
    else values[key] = value;
  }
  // Checkboxes not present in FormData when unchecked.
  for (const input of form.querySelectorAll('input[type="checkbox"]')) {
    values[input.name] = input.checked;
  }
  const errors = {};
  for (const [field, checks] of Object.entries(rules)) {
    for (const check of [].concat(checks)) {
      const message = check(values[field], values);
      if (message) {
        errors[field] = message;
        break;
      }
    }
  }
  return { values, errors, valid: Object.keys(errors).length === 0 };
}

/** Paints .field-error / .error-text states next to inputs. */
export function paintErrors(form, errors = {}) {
  for (const field of form.querySelectorAll('[data-field]')) {
    const name = field.dataset.field;
    const message = errors[name];
    const holder = field.querySelector('[data-error]');
    field.classList.toggle('field-error', !!message);
    if (holder) holder.textContent = message || '';
    const input = field.querySelector('input, select, textarea');
    if (input) input.setAttribute('aria-invalid', message ? 'true' : 'false');
  }
  const first = form.querySelector('.field-error input, .field-error select, .field-error textarea');
  if (first) first.focus({ preventScroll: false });
}

export function passwordStrength(value = '') {
  const s = String(value);
  let score = 0;
  if (s.length >= 8) score++;
  if (s.length >= 12) score++;
  if (/[A-Z]/.test(s) && /[a-z]/.test(s)) score++;
  if (/\d/.test(s)) score++;
  if (/[^A-Za-z0-9]/.test(s)) score++;
  const labels = ['Too short', 'Weak', 'Fair', 'Good', 'Strong', 'Excellent'];
  return { score: Math.min(5, score), label: labels[Math.min(5, score)], percent: (Math.min(5, score) / 5) * 100 };
}

/* ----------------------------------------------------------------- misc */

export const clamp = (n, min, max) => Math.min(max, Math.max(min, Number(n) || 0));

export const uniqueBy = (list, key) => {
  const seen = new Set();
  return list.filter((item) => {
    const k = typeof key === 'function' ? key(item) : item?.[key];
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
};

export const groupBy = (list, key) =>
  list.reduce((acc, item) => {
    const k = typeof key === 'function' ? key(item) : item[key];
    (acc[k] = acc[k] || []).push(item);
    return acc;
  }, {});

export const sumBy = (list, key) => list.reduce((a, i) => a + (Number(typeof key === 'function' ? key(i) : i[key]) || 0), 0);

export const sortBy = (list, key, dir = 'asc') =>
  list.slice().sort((a, b) => {
    const av = typeof key === 'function' ? key(a) : a[key];
    const bv = typeof key === 'function' ? key(b) : b[key];
    if (av === bv) return 0;
    return (av > bv ? 1 : -1) * (dir === 'asc' ? 1 : -1);
  });

export const chunk = (list, size) => {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
};

export const isEmail = (v) => RE.email.test(String(v || ''));

export function copyText(text) {
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text);
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.append(ta);
  ta.select();
  try {
    document.execCommand('copy');
  } finally {
    ta.remove();
  }
  return Promise.resolve();
}

export const noop = () => {};

export function onReady(fn) {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn, { once: true });
  else fn();
}

/** IntersectionObserver-based reveal for .reveal elements (subtle animation). */
export function observeReveal(scope = document) {
  const nodes = $$('.reveal', scope);
  if (!nodes.length || !('IntersectionObserver' in globalThis)) {
    nodes.forEach((n) => n.classList.add('is-visible'));
    return;
  }
  const io = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry, i) => {
        if (entry.isIntersecting) {
          setTimeout(() => entry.target.classList.add('is-visible'), i * 60);
          io.unobserve(entry.target);
        }
      });
    },
    { rootMargin: '0px 0px -8% 0px', threshold: 0.06 }
  );
  nodes.forEach((n) => io.observe(n));
}
