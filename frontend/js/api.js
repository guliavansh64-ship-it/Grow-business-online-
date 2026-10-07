/**
 * api.js — the single HTTP client for the custom backend.
 *
 * Responsibilities (spec §34, §35):
 *   • attach the session token
 *   • always return typed errors with a HUMAN message (never a raw stack)
 *   • drive the global loading bar + offline / session-expired handling
 *
 * Firebase-backed apps do not use this file; see firebase.js.
 */
import cfg from './config.js';
import { store } from './utils.js';

const TOKEN_KEY = 'token';

export const session = {
  get token() {
    return store.get(TOKEN_KEY, null);
  },
  set token(value) {
    if (value) store.set(TOKEN_KEY, value);
    else store.remove(TOKEN_KEY);
  },
  clear() {
    store.remove(TOKEN_KEY);
    store.remove('user');
  },
};

/** Errors that reach the UI always look like this. */
export class ApiClientError extends Error {
  constructor(message, { status = 0, code = 'error', details = null, cause = null } = {}) {
    super(message);
    this.name = 'ApiClientError';
    this.status = status;
    this.code = code;
    this.details = details;
    this.cause = cause;
  }
}

/* Spec §35 — translate machine errors into something a shop owner understands. */
const FRIENDLY = {
  failed_to_fetch: 'Unable to connect. Please check your internet connection and try again.',
  network: 'Unable to connect. Please check your internet connection and try again.',
  timeout: 'The server took too long to respond. Please try again.',
  unauthorized: 'Your session has expired. Please sign in again.',
  forbidden: "You don't have permission to perform this action.",
  not_found: "We couldn't find what you were looking for.",
  route_not_found: 'That action is not available right now.',
  conflict: 'That information is already in use.',
  rate_limited: 'Too many attempts. Please wait a moment and try again.',
  bad_request: 'Please check the highlighted fields and try again.',
  payload_too_large: 'That file or request is too large.',
  server_error: 'Something went wrong on our side. Please try again in a moment.',
  service_unavailable: 'The service is temporarily unavailable. Please try again shortly.',
};

const statusToCode = (status) =>
  ({ 400: 'bad_request', 401: 'unauthorized', 403: 'forbidden', 404: 'not_found', 409: 'conflict', 413: 'payload_too_large', 429: 'rate_limited' })[status] ||
  (status >= 500 ? 'server_error' : 'error');

export function friendlyMessage(error) {
  if (!error) return FRIENDLY.server_error;
  if (error instanceof ApiClientError) return error.message;
  const code = error.code || statusToCode(error.status);
  return FRIENDLY[code] || error.message || FRIENDLY.server_error;
}

/* ------------------------------------------------------------ loading bar */

let inflight = 0;
let barEl = null;

function loadingBar(on) {
  if (typeof document === 'undefined') return;
  if (!barEl) {
    barEl = document.querySelector('.loading-bar');
    if (!barEl) {
      barEl = document.createElement('div');
      barEl.className = 'loading-bar';
      document.body.prepend(barEl);
    }
  }
  barEl.classList.toggle('is-active', on);
}

function trackRequest(delta) {
  inflight = Math.max(0, inflight + delta);
  loadingBar(inflight > 0);
  document.dispatchEvent(new CustomEvent('api:loading', { detail: { inflight } }));
}

/* --------------------------------------------------------------- the call */

const listeners = new Set();
export const onUnauthorized = (fn) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

let redirecting = false;
function handleUnauthorized() {
  session.clear();
  listeners.forEach((fn) => {
    try {
      fn();
    } catch {
      /* a broken listener must not block the others */
    }
  });
  if (redirecting) return;
  const path = globalThis.location.pathname;
  const isAuthPage = /(login|register|forgot|reset)/.test(path);
  if (isAuthPage) return;
  redirecting = true;
  const next = encodeURIComponent(path + globalThis.location.search);
  const depth = path.split('/').filter(Boolean).length > 1 ? '../' : '';
  globalThis.location.href = `${depth}login.html?next=${next}`;
}

/**
 * request('/store/vendors/techmart', { method:'GET', query:{page:2} })
 * Returns the `data` field of the API envelope.
 */
export async function request(path, { method = 'GET', body, query, token, headers = {}, timeout = 25000, retry = 1, silent = false, withMeta = false } = {}) {
  const url = new URL(cfg.apiUrl(path), globalThis.location.href);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
    }
  }

  const useToken = token === undefined ? session.token : token;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  trackRequest(1);

  try {
    const res = await fetch(url, {
      method,
      headers: {
        accept: 'application/json',
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(useToken ? { authorization: `Bearer ${useToken}` } : {}),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
      credentials: 'same-origin',
    });

    let payload = null;
    const text = await res.text();
    if (text) {
      try {
        payload = JSON.parse(text);
      } catch {
        payload = null;
      }
    }

    if (!res.ok) {
      const code = payload?.error?.code || statusToCode(res.status);
      const message = payload?.error?.message || FRIENDLY[code] || `Request failed (${res.status}).`;
      if (res.status === 401 && useToken) handleUnauthorized();
      if (!silent) document.dispatchEvent(new CustomEvent('api:error', { detail: { code, message, status: res.status } }));
      throw new ApiClientError(message, { status: res.status, code, details: payload?.error?.details || null });
    }

    // `withMeta` hands back the whole envelope so callers can read pagination.
    if (withMeta) return payload || { data: null };
    return payload && Object.prototype.hasOwnProperty.call(payload, 'data') ? payload.data : payload;
  } catch (err) {
    if (err instanceof ApiClientError) throw err;
    const aborted = err?.name === 'AbortError';
    const code = aborted ? 'timeout' : 'network';
    if (retry > 0 && method === 'GET' && !aborted) {
      return request(path, { method, body, query, token, headers, timeout, retry: retry - 1, silent, withMeta });
    }
    if (!silent) document.dispatchEvent(new CustomEvent('api:error', { detail: { code, message: FRIENDLY[code] } }));
    throw new ApiClientError(FRIENDLY[code], { code, cause: err });
  } finally {
    clearTimeout(timer);
    trackRequest(-1);
  }
}

/* Convenience verbs */
export const get = (path, opts = {}) => request(path, { ...opts, method: 'GET' });

/**
 * List endpoints return `{ items, pagination, meta }` instead of a bare array,
 * so a table can render "Showing 1–20 of 143" without a second request.
 */
export async function paged(path, query = {}, opts = {}) {
  const envelope = await request(path, { ...opts, method: 'GET', query, withMeta: true });
  const { ok: _ok, data, pagination, ...rest } = envelope || {};
  const items = Array.isArray(data) ? data : data?.items || [];
  // Normalise: the API calls it `total`, some callers read `totalItems`.
  const pg = pagination
    ? {
        ...pagination,
        items,
        total: pagination.total ?? pagination.totalItems ?? items.length,
        totalItems: pagination.totalItems ?? pagination.total ?? items.length,
        pages: pagination.pages ?? 1,
        page: pagination.page ?? 1,
      }
    : null;
  return {
    items,
    pagination: pg,
    // Any extra envelope keys (businessTypes, counts, count, average, …) land here.
    meta: rest,
    total: pg ? pg.total : items.length,
  };
}
export const post = (path, body, opts = {}) => request(path, { ...opts, method: 'POST', body });
export const put = (path, body, opts = {}) => request(path, { ...opts, method: 'PUT', body });
export const patch = (path, body, opts = {}) => request(path, { ...opts, method: 'PATCH', body });
export const del = (path, opts = {}) => request(path, { ...opts, method: 'DELETE' });

/* ------------------------------------------------------------------ domain */

export const Api = {
  /* generic paginated read — used by every list/table page */
  paged,

  /* platform */
  config: () => get('/store/config', { silent: true }),
  stats: () => get('/store/stats', { silent: true }),

  /* auth */
  register: (body) => post('/auth/register', body),
  login: (body) => post('/auth/login', body),
  logout: () => post('/auth/logout', {}),
  me: () => get('/auth/me', { silent: true }),
  forgotPassword: (email) => post('/auth/forgot-password', { email }),
  resetPassword: (body) => post('/auth/reset-password', body),
  verifyEmail: (token) => post('/auth/verify-email', { token }),
  resendVerification: () => post('/auth/resend-verification', {}),

  /* public storefront */
  vendors: (query) => get('/store/vendors', { query }),
  vendor: (slug) => get(`/store/vendors/${encodeURIComponent(slug)}`),
  categories: (slug) => get(`/store/vendors/${encodeURIComponent(slug)}/categories`),
  products: (slug, query) => get(`/store/vendors/${encodeURIComponent(slug)}/products`, { query }),
  product: (slug, id) => get(`/store/vendors/${encodeURIComponent(slug)}/products/${encodeURIComponent(id)}`),
  quote: (slug, items) => post(`/store/vendors/${encodeURIComponent(slug)}/cart/quote`, { items }),
  placeOrder: (slug, body) => post(`/store/vendors/${encodeURIComponent(slug)}/orders`, body),
  trackOrder: (number, phone, email) => get('/store/orders/track', { query: { number, phone, email } }),
  addReview: (slug, body) => post(`/store/vendors/${encodeURIComponent(slug)}/reviews`, body),
  reviews: (slug, query) => get(`/store/vendors/${encodeURIComponent(slug)}/reviews`, { query, silent: true }),
  contact: (body) => post('/store/contact', body),

  /* vendor dashboard */
  vendorMe: () => get('/vendor/me'),
  dashboard: (days) => get('/vendor/dashboard', { query: { days } }),
  analytics: (range) => get('/vendor/analytics', { query: { range } }),
  storeSettings: () => get('/vendor/store'),
  saveStoreSettings: (body) => put('/vendor/store', body),
  saveProfile: (body) => put('/vendor/profile', body),
  vendorCategories: () => get('/vendor/categories'),
  createCategory: (body) => post('/vendor/categories', body),
  updateCategory: (id, body) => put(`/vendor/categories/${id}`, body),
  deleteCategory: (id) => del(`/vendor/categories/${id}`),
  vendorProducts: (query) => get('/vendor/products', { query }),
  vendorProduct: (id) => get(`/vendor/products/${id}`),
  createProduct: (body) => post('/vendor/products', body),
  updateProduct: (id, body) => put(`/vendor/products/${id}`, body),
  deleteProduct: (id) => del(`/vendor/products/${id}`),
  vendorOrders: (query) => get('/vendor/orders', { query }),
  vendorOrder: (id) => get(`/vendor/orders/${id}`),
  setOrderStatus: (id, status, note) => patch(`/vendor/orders/${id}/status`, { status, note }),
  vendorCustomers: (query) => get('/vendor/customers', { query }),
  vendorNotifications: (query) => get('/vendor/notifications', { query }),
  markNotificationsRead: (ids) => post('/vendor/notifications/read', { ids }),
  supportTicket: (body) => post('/vendor/support', body),

  /* finance */
  deposit: () => get('/finance/deposit'),
  initiateDeposit: (method) => post('/finance/deposit/initiate', { method }),
  simulatePayment: (depositId) => post('/finance/dev/simulate-payment', { depositId }),
  activation: () => get('/finance/activation'),
  balance: () => get('/finance/balance'),
  withdrawals: () => get('/finance/withdrawals'),
  requestWithdrawal: (body) => post('/finance/withdrawals', body),
  cancelWithdrawal: (id) => del(`/finance/withdrawals/${id}`),

  /* customer */
  profile: () => get('/customer/profile'),
  saveProfile: (body) => put('/customer/profile', body),
  customerOrders: (query) => get('/customer/orders', { query }),
  customerOrder: (id) => get(`/customer/orders/${id}`),
  addresses: () => get('/customer/addresses'),
  addAddress: (body) => post('/customer/addresses', body),
  updateAddress: (id, body) => put(`/customer/addresses/${id}`, body),
  deleteAddress: (id) => del(`/customer/addresses/${id}`),
  wishlist: () => get('/customer/wishlist'),
  addWishlist: (productId) => post('/customer/wishlist', { productId }),
  removeWishlist: (id) => del(`/customer/wishlist/${id}`),
  customerNotifications: (query) => get('/customer/notifications', { query }),
  markCustomerNotificationsRead: (ids) => post('/customer/notifications/read', { ids }),

  /* super admin */
  adminStats: () => get('/admin/stats'),
  adminVendors: (query) => get('/admin/vendors', { query }),
  updateAdminVendor: (id, body) => patch(`/admin/vendors/${id}`, body),
  adminDeposits: (query) => get('/admin/deposits', { query }),
  updateDeposit: (id, body) => patch(`/admin/deposits/${id}`, body),
  adminWithdrawals: (query) => get('/admin/withdrawals', { query }),
  updateWithdrawal: (id, body) => patch(`/admin/withdrawals/${id}`, body),
  adminOrders: (query) => get('/admin/orders', { query }),
  adminMessages: (query) => get('/admin/messages', { query }),
  updateMessage: (id, body) => patch(`/admin/messages/${id}`, body),
};

export default Api;
