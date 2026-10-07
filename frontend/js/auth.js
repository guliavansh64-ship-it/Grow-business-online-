/**
 * auth.js — session state for the MAIN PLATFORM (custom backend).
 *
 * Spec §27: Firebase Auth is only used by the separate "other apps"; this
 * module never talks to Firebase so the two systems cannot be mixed.
 * Spec §30: role decides which dashboard you land in — but the backend
 * re-checks every request, because hiding a button is not security.
 */
import cfg from './config.js';
import Api, { session } from './api.js';
import { store, $, url, initials } from './utils.js';

const USER_KEY = 'user';

export const state = {
  user: store.get(USER_KEY, null),
  vendor: null,
  redirectTo: null,
  ready: false,
  checked: false,
};

const listeners = new Set();
export const onAuthChange = (fn) => {
  listeners.add(fn);
  if (state.checked) fn(state);
  return () => listeners.delete(fn);
};
const emit = () => {
  document.dispatchEvent(new CustomEvent('auth:change', { detail: { ...state } }));
  listeners.forEach((fn) => fn(state));
};

export const isSignedIn = () => !!session.token && !!state.user;
export const role = () => state.user?.role || null;
export const hasRole = (...roles) => roles.includes(role());

/** Restores the session on every page load. Safe to call more than once. */
export async function restore({ force = false } = {}) {
  if (state.checked && !force) return state;
  if (!session.token) {
    state.user = null;
    state.vendor = null;
    state.checked = true;
    state.ready = true;
    emit();
    return state;
  }
  try {
    const data = await Api.me();
    state.user = data.user;
    state.vendor = data.vendor;
    state.redirectTo = data.redirectTo;
    store.set(USER_KEY, data.user);
  } catch {
    session.clear();
    state.user = null;
    state.vendor = null;
    store.remove(USER_KEY);
  }
  state.checked = true;
  state.ready = true;
  emit();
  return state;
}

export async function signIn(identifier, password) {
  const data = await Api.login({ identifier, password });
  session.token = data.token;
  state.user = data.user;
  state.vendor = data.vendor;
  state.redirectTo = data.redirectTo;
  store.set(USER_KEY, data.user);
  emit();
  return data;
}

export async function signUp(payload) {
  const data = await Api.register(payload);
  session.token = data.token;
  state.user = data.user;
  state.vendor = data.vendor;
  state.redirectTo = data.redirectTo;
  store.set(USER_KEY, data.user);
  emit();
  return data;
}

export async function signOut({ redirect = true } = {}) {
  try {
    await Api.logout();
  } catch {
    /* the local clear below is what matters */
  }
  session.clear();
  state.user = null;
  state.vendor = null;
  store.remove(USER_KEY);
  emit();
  if (redirect) {
    const depth = globalThis.location.pathname.split('/').filter(Boolean).length > 1 ? '../' : '';
    globalThis.location.href = `${depth}login.html?signedOut=1`;
  }
}

/**
 * Page guard. `roles` limits which roles may stay on the page.
 * Returns the session state, or redirects away.
 */
export async function guard({ roles = null, redirect = null, silent = false } = {}) {
  await restore();
  const depth = globalThis.location.pathname.split('/').filter(Boolean).length > 1 ? '../' : '';

  if (!isSignedIn()) {
    const next = encodeURIComponent(globalThis.location.pathname + globalThis.location.search);
    globalThis.location.replace(`${depth}login.html?next=${next}`);
    return new Promise(() => {}); // never resolves — the page is navigating away
  }
  if (roles && !roles.includes(state.user.role)) {
    const target = redirect || homeFor(state.user, state.vendor) || `${depth}index.html`;
    if (!silent) globalThis.location.replace(target.startsWith('http') ? target : `${depth}${target.replace(/^\//, '')}`);
    return new Promise(() => {});
  }
  return state;
}

/** Role → landing page (spec §30). */
export function homeFor(user, vendor) {
  if (!user) return 'login.html';
  if (user.role === 'super_admin') return url('admin/index.html');
  if (user.role === 'vendor') {
    if (!vendor || vendor.status === 'pending_deposit') return url('deposit.html');
    if (vendor.status === 'pending_activation') return url('activation.html');
    return url('admin/dashboard.html');
  }
  return url('vendor/account.html');
}

export const avatarHtml = (user, size = '') => {
  const name = user?.name || 'Guest';
  const color = user?.avatarColor || 'var(--brand)';
  return `<span class="avatar ${size}" style="background:color-mix(in srgb, ${color} 18%, var(--surface));color:${color}">${escAttr(initials(name))}</span>`;
};

const escAttr = (v) => String(v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/** Renders the signed-in chip in any header (marketing, storefront, dashboard). */
export function renderAccountChip(container) {
  if (!container) return;
  if (!isSignedIn()) {
    container.innerHTML = `
      <a class="btn btn-ghost btn-sm" href="${url('login.html')}">Login</a>
      <a class="btn btn-primary btn-sm" href="${url('register.html')}">Register</a>`;
    return;
  }
  const u = state.user;
  container.innerHTML = `
    <div class="dropdown">
      <button class="account-chip" data-dropdown-toggle aria-expanded="false" aria-haspopup="menu">
        ${avatarHtml(u, 'avatar-sm')}
        <span class="acct-name">${escAttr(u.name.split(' ')[0])}</span>
        <span class="acct-role">${escAttr(u.role.replace('_', ' '))}</span>
      </button>
      <div class="dropdown-menu" role="menu">
        <div class="head">${escAttr(u.email)}</div>
        <a role="menuitem" href="${homeFor(u, state.vendor)}">My dashboard</a>
        ${u.role === 'customer' ? `<a role="menuitem" href="${url('vendor/account.html')}">My account</a>` : ''}
        ${u.role === 'vendor' && state.vendor ? `<a role="menuitem" href="${url('vendor/index.html')}?vendor=${escAttr(state.vendor.slug)}">View my store</a>` : ''}
        <div class="sep"></div>
        <button role="menuitem" type="button" data-signout>Sign out</button>
      </div>
    </div>`;
  container.querySelector('[data-signout]')?.addEventListener('click', () => signOut());
}

export function bindSignOutButtons(scope = document) {
  scope.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-signout]');
    if (btn) {
      e.preventDefault();
      signOut();
    }
  });
}

/** Demo credentials helper — only shown when features.demoMode is on. */
export function demoCredentials() {
  if (!cfg.features.demoMode) return [];
  return [
    { role: 'Vendor', email: 'vendor@growbusinessonline.com', password: 'Vendor@123', note: 'Active store with 70 orders' },
    { role: 'Customer', email: 'customer@example.com', password: 'Customer@123', note: 'Order history + saved addresses' },
    { role: 'Admin', email: 'admin@growbusinessonline.com', password: 'Admin@123', note: 'Platform console' },
    { role: 'New vendor', email: 'aman@freshkart.in', password: 'Vendor@123', note: 'Deposit still pending' },
  ];
}

export default { state, restore, guard, signIn, signUp, signOut, isSignedIn, role, hasRole, homeFor, onAuthChange, renderAccountChip, demoCredentials };
