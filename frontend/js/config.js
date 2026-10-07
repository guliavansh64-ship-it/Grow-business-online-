/**
 * config.js — the ONLY file you normally need to edit after uploading to Hostinger.
 *
 * Spec §28: never put secrets here. This file is delivered to the browser, so it
 * may only contain public values: the API base URL, the root domain, public
 * Firebase *web* config, and UI flags.
 *
 * NEVER add: service-account keys, Admin SDK private keys, payment secrets,
 * database master credentials or any API secret.
 */

/** Absolute URL of a module, resolved from this file (works in any sub-folder). */
export const BASE = new URL('.', import.meta.url).href;
export const ROOT = new URL('../', import.meta.url).href;

const qs = new URLSearchParams(globalThis.location?.search || '');

const DEFAULTS = {
  /* --- Backend ---------------------------------------------------------- */
  // Same-origin by default, so one Hostinger/VPS host can serve both.
  // Point this at your API domain when the backend lives elsewhere:
  //   apiBase: 'https://api.growbusinessonline.com/api'
  apiBase: '/api',

  /* --- Multi-tenant storefront ------------------------------------------ */
  rootDomain: 'growbusinessonline.com',
  // Slug used when no subdomain is present (local preview / direct file access).
  fallbackVendor: 'techmart',
  // Reserved labels that are never treated as a vendor slug.
  reservedSubdomains: ['www', 'app', 'api', 'admin', 'mail', 'ftp', 'cdn', 'static', 'blog'],

  /* --- Firebase (OTHER APPS ONLY — spec §2, §28) ------------------------- */
  // The main platform uses the custom backend above and must NOT use these.
  // Paste the *web app* config from Firebase console → Project settings.
  // Client keys are public by design; security comes from rules + App Check.
  firebase: {
    enabled: false,
    config: {
      apiKey: '',
      authDomain: '',
      projectId: '',
      storageBucket: '',
      messagingSenderId: '',
      appId: '',
      measurementId: '',
      vapidKey: '', // public Web Push key for FCM
    },
  },

  /* --- UI ---------------------------------------------------------------- */
  brand: {
    name: 'GrowBusiness Online',
    shortName: 'GrowBusiness',
    tagline: 'Grow your business online',
    supportEmail: 'support@growbusinessonline.com',
    supportPhone: '+91 90000 00001',
    address: 'GrowBusiness Online, Sector 14, Jhajjar, Haryana 124103, India',
  },
  currency: 'INR',
  locale: 'en-IN',

  /* --- Commerce defaults ------------------------------------------------ */
  // Display-only fallbacks. The API (/store/config) is the source of truth and
  // overrides these at runtime — money is never computed from them.
  commissionPercent: 5,
  depositPaise: 100000,
  activationHours: 48,
  deliveryFeePaise: 4900,
  freeDeliveryAbovePaise: 99900,
  minWithdrawalPaise: 50000,
  payoutDays: '1-2 working days',
  theme: 'light', // 'light' | 'dark' | 'auto'
  pageSize: 12,
  searchDebounceMs: 320,
  notificationPollMs: 45000,
  cartTtlDays: 14,
  features: {
    demoMode: true, // shows demo credentials on the login screen
    firebaseAuth: false,
    pushNotifications: false,
    reviews: true,
    wishlist: true,
    guestCheckout: true,
  },
};

/** Deep merge that ignores empty strings so defaults are never wiped out. */
function merge(base, override) {
  if (override === undefined || override === null) return base;
  if (Array.isArray(base) || typeof base !== 'object') return override === '' ? base : override;
  const out = { ...base };
  for (const [k, v] of Object.entries(override)) {
    if (v && typeof v === 'object' && !Array.isArray(v)) out[k] = merge(base[k] || {}, v);
    else if (v !== '' && v !== undefined && v !== null) out[k] = v;
  }
  return out;
}

/**
 * Site-specific overrides. Edit this object (or drop a `js/config.local.js`
 * file next to it) when deploying — nothing else needs to change.
 */
const OVERRIDES = {
  // apiBase: 'https://api.growbusinessonline.com/api',
};

const cfg = merge(DEFAULTS, OVERRIDES);

// Query-string overrides make multi-tenant testing trivial:
//   /vendor/index.html?vendor=stylehub&theme=dark
if (qs.get('api')) cfg.apiBase = qs.get('api').replace(/\/$/, '');
if (qs.get('theme')) cfg.theme = qs.get('theme');
if (qs.get('vendor')) cfg.fallbackVendor = qs.get('vendor');

cfg.apiUrl = (path = '') => `${cfg.apiBase.replace(/\/$/, '')}/${path.replace(/^\//, '')}`;

globalThis.GBO_CONFIG = cfg;
export default cfg;
