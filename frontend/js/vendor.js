/**
 * vendor.js — the multi-tenant heart of the frontend (spec §3, §40, §41, §45).
 *
 *   ONE shared codebase  →  detectVendorFromHostname()  →  load vendor config
 *                     →  theme + SEO + data all swap to that vendor.
 *
 * Changing a component here changes every vendor store at once — there is never
 * a duplicated vendor1/, vendor2/, vendor3/ tree.
 *
 * NOTE (spec §40): the hostname only decides WHICH store to *display*.
 * Authorisation always happens in the backend, which re-checks the session.
 */
import cfg from './config.js';
import Api from './api.js';
import { store, $, url, html, raw, el } from './utils.js';
import { applyVendorTheme } from './theme.js';
import { applyVendorSeo } from './seo.js';
import { icon } from './icons.js';
import { toastError, emptyState } from './ui.js';

const RESERVED = new Set(['www', 'app', 'api', 'admin', 'mail', 'ftp', 'cdn', 'static', 'blog', 'support', 'help', 'store', 'demo', ...cfg.reservedSubdomains]);

const memoryCache = new Map();
const state = {
  slug: null,
  vendor: null,
  source: null, // 'subdomain' | 'query' | 'path' | 'fallback'
  loading: false,
  error: null,
};

/* ------------------------------------------------------------- detection */

/**
 * Resolves the vendor slug for the current request.
 *
 *   techmart.growbusinessonline.com   → 'techmart'   (subdomain — production)
 *   techmart.localhost:4000           → 'techmart'   (local dev)
 *   /vendor/index.html?vendor=stylehub→ 'stylehub'   (preview / testing)
 *   /s/stylehub/product.html          → 'stylehub'   (path mode, no DNS needed)
 *   growbusinessonline.com            → null         (main marketing site)
 */
export function detectVendorFromHostname(
  hostname = globalThis.location.hostname,
  { search = globalThis.location.search, path = globalThis.location.pathname, rootDomain = cfg.rootDomain, fallback = null } = {}
) {
  // 1. Explicit override wins — used for local preview and QA.
  const q = new URLSearchParams(search).get('vendor');
  if (q) return { slug: normalise(q), source: 'query' };

  // 2. Path mode: /s/<slug>/… or /store/<slug>/…  (works without wildcard DNS)
  const pathMatch = path.match(/^\/(?:s|store)\/([a-z0-9-]+)(?:\/|$)/i);
  if (pathMatch) return { slug: normalise(pathMatch[1]), source: 'path' };

  // 3. Subdomain mode (production).
  const host = String(hostname).split(':')[0].toLowerCase();
  const labels = host.split('.').filter(Boolean);

  // Sandbox/preview proxies look like 4000-abcd1234.e2b.app — never a vendor.
  if (/^\d+-/.test(labels[0])) return { slug: fallback, source: fallback ? 'fallback' : null };

  if (labels.length > 1) {
    const candidate = labels[0];
    const parent = labels.slice(1).join('.');
    const isKnownRoot = parent === rootDomain || parent === 'localhost' || parent === '127.0.0.1' || parent.endsWith(`.${rootDomain}`);
    if (isKnownRoot && !RESERVED.has(candidate) && /^[a-z0-9](?:[a-z0-9-]{0,46})[a-z0-9]$/.test(candidate)) {
      return { slug: candidate, source: 'subdomain' };
    }
    // admin.growbusinessonline.com is the vendor console, not a storefront.
    if (candidate === 'admin') return { slug: null, source: null };
  }

  return { slug: fallback, source: fallback ? 'fallback' : null };
}

const normalise = (value) => String(value || '').toLowerCase().trim().replace(/[^a-z0-9-]/g, '').slice(0, 48) || null;

export function currentVendorSlug() {
  if (state.slug) return state.slug;
  const { slug } = detectVendorFromHostname(undefined, { fallback: cfg.fallbackVendor });
  return slug;
}

/* ---------------------------------------------------------------- loading */

/** Loads (and caches) the vendor configuration for a slug. */
export async function loadVendor(slug, { force = false } = {}) {
  const key = slug || currentVendorSlug();
  if (!key) return null;
  if (!force && memoryCache.has(key)) return memoryCache.get(key);

  const sessionKey = `vendor:${key}`;
  if (!force) {
    const cached = store.get(sessionKey);
    if (cached) {
      memoryCache.set(key, cached);
      // Refresh in the background so a rebrand shows up quickly.
      Api.vendor(key)
        .then((fresh) => {
          memoryCache.set(key, fresh);
          store.set(sessionKey, fresh, 5 * 60 * 1000);
          if (state.slug === key) applyVendor(fresh);
        })
        .catch(() => {});
      return cached;
    }
  }

  const vendor = await Api.vendor(key);
  memoryCache.set(key, vendor);
  store.set(sessionKey, vendor, 5 * 60 * 1000);
  return vendor;
}

/** Applies theme + SEO + <html> attributes for a vendor. */
export function applyVendor(vendor) {
  if (!vendor) return vendor;
  state.vendor = vendor;
  state.slug = vendor.slug;
  globalThis.__gboVendor = vendor;
  globalThis.__gboVendorTheme = vendor.theme;
  document.documentElement.dataset.vendor = vendor.slug;
  applyVendorTheme(vendor.theme || {}, { accent: true });
  applyVendorSeo(vendor, { path: globalThis.location.pathname.replace(/^\/vendor/, '') });
  if (vendor.favicon) {
    const link = $('link[rel="icon"]');
    if (link) link.href = url(vendor.favicon.replace(/^\//, ''));
  }
  document.dispatchEvent(new CustomEvent('vendor:loaded', { detail: vendor }));
  return vendor;
}

/**
 * One-call bootstrap for every storefront page:
 *   const vendor = await initStorefront();
 * It resolves the tenant, paints the theme and returns the config — or renders
 * a friendly "store not found" screen and returns null.
 */
export async function initStorefront({ onNotFound = null, requireVendor = true } = {}) {
  const detected = detectVendorFromHostname(undefined, { fallback: cfg.fallbackVendor });
  state.source = detected.source;

  if (!detected.slug) {
    if (!requireVendor) return null;
    renderStoreNotFound(null, onNotFound);
    return null;
  }
  state.slug = detected.slug;

  const host = $('[data-store-host]');
  if (host) host.innerHTML = `<div class="spinner spinner-lg"></div>`;

  try {
    const vendor = await loadVendor(detected.slug);
    applyVendor(vendor);
    if (detected.source === 'fallback' && cfg.features.demoMode) showDevStoreNotice(vendor);
    return vendor;
  } catch (err) {
    state.error = err;
    if (err.status === 403) renderStoreSuspended(detected.slug);
    else renderStoreNotFound(detected.slug, onNotFound);
    return null;
  }
}

/* ------------------------------------------------------------- UI helpers */

function renderStoreNotFound(slug, onNotFound) {
  if (onNotFound) return onNotFound(slug);
  const host = $('[data-store-host]') || $('main');
  if (!host) return;
  host.innerHTML = emptyState({
    icon: 'store',
    title: slug ? `No store found for "${slug}"` : 'No store selected',
    message: slug
      ? `The subdomain ${slug}.${cfg.rootDomain} is not registered yet, or the store is still being activated.`
      : `Open a vendor subdomain such as techmart.${cfg.rootDomain}, or add ?vendor=techmart to the URL.`,
    action: { label: 'Explore all stores', href: url('pages/vendors.html') },
  });
}

function renderStoreSuspended(slug) {
  const host = $('[data-store-host]') || $('main');
  if (host) {
    host.innerHTML = emptyState({
      icon: 'shield',
      title: 'This store is temporarily unavailable',
      message: `${slug}.${cfg.rootDomain} has been paused by the store owner or our team. Please check back soon.`,
      action: { label: 'Browse other stores', href: url('pages/vendors.html') },
    });
  }
}

/**
 * In preview there is no wildcard DNS, so a small banner tells you which store
 * you are looking at and lets you jump between the demo tenants.
 */
function showDevStoreNotice(vendor) {
  if ($('[data-store-switcher]')) return;
  const bar = el('div', { class: 'store-switcher', 'data-store-switcher': '' });
  bar.innerHTML = html`
    <div class="ss-inner">
      <span class="ss-label">${raw(icon('globe'))} Previewing <strong>${vendor.name}</strong></span>
      <span class="ss-hint">Production URL: <code>${vendor.slug}.${cfg.rootDomain}</code></span>
      <div class="ss-links">
        <span class="ss-switch">Switch store:</span>
        <a href="${url('vendor/index.html')}?vendor=techmart" data-slug="techmart">TechMart</a>
        <a href="${url('vendor/index.html')}?vendor=stylehub" data-slug="stylehub">StyleHub</a>
        <a href="${url('pages/vendors.html')}">All stores</a>
      </div>
    </div>`;
  document.body.prepend(bar);
  document.documentElement.classList.add('has-store-switcher');
}

export function storefrontUrl(vendor, path = '') {
  if (!vendor) return url(`vendor/index.html${path}`);
  if (globalThis.location.hostname.endsWith(cfg.rootDomain)) return `https://${vendor.slug}.${cfg.rootDomain}${path}`;
  return url(`vendor/index.html?vendor=${vendor.slug}${path ? `#${path}` : ''}`);
}

export const vendorState = state;
export const getVendor = () => state.vendor;

export default { detectVendorFromHostname, currentVendorSlug, loadVendor, applyVendor, initStorefront, storefrontUrl, getVendor, vendorState };
