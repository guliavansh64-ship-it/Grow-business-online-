/**
 * layout.js — the shared "chrome" for the three applications that live in one
 * codebase (spec §4):
 *
 *   A. Main website      → marketing header + footer (static HTML, SEO-first)
 *   B. Vendor storefront → mountStorefrontChrome() injects a header/footer
 *                          built from the vendor record (logo, colours, menu)
 *   C. Vendor dashboard  → mountDashboardChrome() injects the sidebar + topbar
 *
 * Injecting B and C from one module is what keeps the system DRY: change the
 * product card or the sidebar once and every vendor gets it (spec §41).
 */
import cfg from './config.js';
import { $, $$, url, html, raw, el, on, throttle, esc } from './utils.js';
import { icon } from './icons.js';
import { state as auth, isSignedIn, signOut, renderAccountChip, homeFor } from './auth.js';
import { currentTheme, toggleTheme } from './theme.js';
import cart from './cart.js';
import { bindCartBadges } from './cart.js';
import { toast } from './ui.js';
import { sentence, money } from './utils.js';

/* =================================================== A. marketing chrome */

const NAV = [
  { label: 'Home', href: 'index.html' },
  { label: 'Features', href: 'pages/features.html' },
  { label: 'Pricing', href: 'pages/pricing.html' },
  { label: 'How it works', href: 'pages/how-it-works.html' },
  { label: 'Vendors', href: 'pages/vendors.html' },
  { label: 'Contact', href: 'pages/contact.html' },
];

export function mountMarketingChrome() {
  bindStickyHeader();
  bindMobileNav();
  bindAccountArea();
  bindThemeButtons();
  const year = $('[data-year]');
  if (year) year.textContent = String(new Date().getFullYear());
  markActiveNav();
}

function markActiveNav() {
  const here = globalThis.location.pathname.split('/').pop() || 'index.html';
  $$('[data-nav-link]').forEach((link) => {
    const target = link.getAttribute('href')?.split('/').pop();
    link.classList.toggle('is-active', target === here);
    if (target === here) link.setAttribute('aria-current', 'page');
  });
}

function bindStickyHeader() {
  const header = $('[data-site-header]');
  if (!header) return;
  const update = throttle(() => {
    header.classList.toggle('is-stuck', globalThis.scrollY > 8);
    header.classList.toggle('is-hidden', globalThis.scrollY > 400 && globalThis.scrollY > (header._last || 0) && !header.classList.contains('nav-open'));
    header._last = globalThis.scrollY;
  }, 60);
  globalThis.addEventListener('scroll', update, { passive: true });
  update();
}

function bindMobileNav() {
  const burger = $('[data-nav-toggle]');
  const panel = $('[data-nav-panel]');
  if (!burger || !panel) return;
  const setOpen = (open) => {
    panel.classList.toggle('is-open', open);
    burger.classList.toggle('is-open', open);
    burger.setAttribute('aria-expanded', String(open));
    document.body.style.overflow = open ? 'hidden' : '';
    $('[data-site-header]')?.classList.toggle('nav-open', open);
  };
  burger.addEventListener('click', () => setOpen(!panel.classList.contains('is-open')));
  panel.addEventListener('click', (e) => e.target.closest('a') && setOpen(false));
  $('[data-nav-close]')?.addEventListener('click', () => setOpen(false));
  document.addEventListener('keydown', (e) => e.key === 'Escape' && setOpen(false));
}

function bindAccountArea() {
  const host = $('[data-account-area]');
  const hostMobile = $('[data-account-area-mobile]');
  const paint = () => {
    if (host) renderAccountChip(host);
    if (hostMobile) renderAccountChip(hostMobile);
  };
  paint();
  document.addEventListener('auth:change', paint);
}

function bindThemeButtons() {
  on('[data-theme-toggle]', 'click', (e) => {
    e.preventDefault();
    toggleTheme();
  });
}

/* ================================================== B. storefront chrome */

/**
 * Builds the storefront header/footer from the vendor record.
 * Everything vendor-specific (name, logo, colours, categories, contact) comes
 * from the API, so the same HTML file renders any tenant.
 */
export function mountStorefrontChrome(vendor, { categories = [], activeNav = 'home' } = {}) {
  mountStoreHeader(vendor, { categories, activeNav });
  mountStoreFooter(vendor);
  bindCartBadges();
}

export function mountStoreHeader(vendor, { categories = [], activeNav = 'home' } = {}) {
  const host = $('[data-store-header]');
  if (!host || !vendor) return;

  host.innerHTML = html`
    <header class="store-header" data-sticky>
      <div class="sh-top">
        <div class="container container-wide sh-top-inner">
          <span>${raw(icon('truck'))} Free delivery above ${money(vendor.freeDeliveryAbovePaise ?? cfg.freeDeliveryAbovePaise ?? 99900, { decimals: 0 })} · Ships across India</span>
          <span class="sh-top-right">
            ${vendor.phone ? html`<a href="tel:${vendor.phone.replace(/\s/g, '')}">${raw(icon('phone'))} ${vendor.phone}</a>` : ''}
            <a href="${url('pages/vendors.html')}">${raw(icon('store'))} All stores</a>
            <button type="button" class="link-btn" data-theme-toggle aria-label="Toggle dark mode">${raw(icon(currentTheme() === 'dark' ? 'sun' : 'moon'))}</button>
          </span>
        </div>
      </div>

      <div class="sh-main">
        <div class="container container-wide sh-main-inner">
          <a class="sh-brand" href="${url('vendor/index.html')}?vendor=${vendor.slug}" aria-label="${vendor.name} home">
            ${vendor.logo
              ? html`<img src="${url(vendor.logo.replace(/^\//, ''))}" alt="${vendor.name} logo" width="42" height="42" loading="eager"/>`
              : html`<span class="sh-brand-mark">${(vendor.name || 'S').slice(0, 2).toUpperCase()}</span>`}
            <span class="sh-brand-text">
              <strong>${vendor.name}</strong>
              <small>${vendor.city ? `${vendor.city}${vendor.state ? ` · ${vendor.state}` : ''}` : vendor.businessType || ''}</small>
            </span>
          </a>

          <form class="sh-search" role="search" data-store-search action="${url('vendor/category.html')}" method="get">
            ${raw(icon('search'))}
            <input type="search" name="q" placeholder="Search products in ${vendor.name}…" aria-label="Search products" autocomplete="off" data-search-input/>
            <input type="hidden" name="vendor" value="${vendor.slug}"/>
            <button type="submit" class="btn btn-primary btn-sm">Search</button>
          </form>

          <div class="sh-actions">
            ${isSignedIn() && auth.user?.role === 'customer'
              ? html`<a class="icon-btn" href="${url('vendor/account.html')}" aria-label="My account" data-tip="My account">${raw(icon('user'))}</a>`
              : html`<a class="icon-btn" href="${url('login.html')}" aria-label="Sign in" data-tip="Sign in">${raw(icon('user'))}</a>`}
            <a class="icon-btn" href="${url('vendor/wishlist.html')}" aria-label="Wishlist" data-tip="Wishlist">${raw(icon('heart'))}</a>
            <a class="icon-btn" href="${url('vendor/cart.html')}" aria-label="Cart" data-tip="Cart" data-cart-badge-host>
              ${raw(icon('cart'))}<span class="dot hidden" data-cart-count>0</span>
            </a>
            <button type="button" class="icon-btn sh-burger" data-nav-toggle aria-label="Open menu" aria-expanded="false">${raw(icon('menu'))}</button>
          </div>
        </div>
      </div>

      <nav class="sh-nav" aria-label="Store categories">
        <div class="container container-wide sh-nav-inner">
          <a class="sh-nav-link ${activeNav === 'home' ? 'is-active' : ''}" href="${url('vendor/index.html')}?vendor=${vendor.slug}">Home</a>
          <a class="sh-nav-link ${activeNav === 'all' ? 'is-active' : ''}" href="${url('vendor/category.html')}?vendor=${vendor.slug}">All products</a>
          ${categories.map(
            (c) => html`<a class="sh-nav-link ${activeNav === c.slug ? 'is-active' : ''}" href="${url('vendor/category.html')}?vendor=${vendor.slug}&category=${c.slug}">${c.name}</a>`
          )}
          <a class="sh-nav-link" href="${url('vendor/orders.html')}?vendor=${vendor.slug}">${raw(icon('package'))} Track order</a>
        </div>
      </nav>
    </header>

    <div class="sh-drawer-backdrop" data-nav-backdrop></div>
    <aside class="sh-drawer" data-nav-panel aria-label="Store menu">
      <div class="sh-drawer-head">
        <div class="row">
          ${vendor.logo ? html`<img src="${url(vendor.logo.replace(/^\//, ''))}" alt="" width="34" height="34" style="border-radius:10px"/>` : ''}
          <strong>${vendor.name}</strong>
        </div>
        <button type="button" class="icon-btn ghost" data-nav-close aria-label="Close menu">${raw(icon('close'))}</button>
      </div>
      <form class="sh-drawer-search" role="search" action="${url('vendor/category.html')}" method="get">
        <div class="input-group">${raw(icon('search'))}<input class="input" type="search" name="q" placeholder="Search products…" aria-label="Search"/></div>
        <input type="hidden" name="vendor" value="${vendor.slug}"/>
      </form>
      <nav class="sh-drawer-nav">
        <a href="${url('vendor/index.html')}?vendor=${vendor.slug}">Home</a>
        <a href="${url('vendor/category.html')}?vendor=${vendor.slug}">All products</a>
        ${categories.map((c) => html`<a href="${url('vendor/category.html')}?vendor=${vendor.slug}&category=${c.slug}">${c.name}</a>`)}
        <a href="${url('vendor/cart.html')}?vendor=${vendor.slug}">Cart</a>
        <a href="${url('vendor/orders.html')}?vendor=${vendor.slug}">Track order</a>
        <a href="${url('vendor/account.html')}?vendor=${vendor.slug}">My account</a>
      </nav>
      <div class="sh-drawer-foot">
        <a class="btn btn-secondary btn-block" href="${url('index.html')}">${raw(icon('globe'))} GrowBusiness Online</a>
      </div>
    </aside>`;

  bindStoreNav();
  bindStoreSearch(host, vendor);
}

function bindStoreNav() {
  const burger = $('[data-nav-toggle]');
  const panel = $('[data-nav-panel]');
  const backdrop = $('[data-nav-backdrop]');
  if (!burger || !panel) return;
  const setOpen = (open) => {
    panel.classList.toggle('is-open', open);
    backdrop?.classList.toggle('is-open', open);
    burger.setAttribute('aria-expanded', String(open));
    burger.innerHTML = icon(open ? 'close' : 'menu');
    document.body.style.overflow = open ? 'hidden' : '';
  };
  burger.addEventListener('click', () => setOpen(!panel.classList.contains('is-open')));
  backdrop?.addEventListener('click', () => setOpen(false));
  $('[data-nav-close]')?.addEventListener('click', () => setOpen(false));
  panel.addEventListener('click', (e) => e.target.closest('a') && setOpen(false));
  document.addEventListener('keydown', (e) => e.key === 'Escape' && setOpen(false));

  const header = $('[data-sticky]');
  if (header) {
    const update = throttle(() => header.classList.toggle('is-stuck', globalThis.scrollY > 10), 60);
    globalThis.addEventListener('scroll', update, { passive: true });
    update();
  }
}

/** Debounced live search suggestions (spec §37). */
function bindStoreSearch(scope, vendor) {
  const input = $('[data-search-input]', scope);
  if (!input) return;
  let box = null;
  const run = async (term) => {
    if (!term || term.length < 2) {
      box?.remove();
      box = null;
      return;
    }
    const { get } = await import('./api.js');
    try {
      const products = await get(`/store/vendors/${encodeURIComponent(vendor.slug)}/products`, { query: { q: term, limit: 6 } });
      if (!products.length) return;
      if (!box) {
        box = el('div', { class: 'search-suggest' });
        input.closest('.sh-search').append(box);
      }
      box.innerHTML = products
        .map(
          (p) => `<a href="${url(`vendor/product.html?vendor=${vendor.slug}&id=${encodeURIComponent(p.id)}`)}">
            <img src="${url(String(p.image || '').replace(/^\//, ''))}" alt="" loading="lazy" width="40" height="40"/>
            <span class="ss-name">${esc(p.name)}</span>
            <span class="ss-price">${money(p.pricePaise)}</span>
          </a>`
        )
        .join('');
    } catch {
      box?.remove();
    }
  };
  const debounced = throttle((v) => run(v), 320);
  input.addEventListener('input', (e) => debounced(e.target.value.trim()));
  input.addEventListener('focus', (e) => run(e.target.value.trim()));
  document.addEventListener('click', (e) => {
    if (box && !e.target.closest('.sh-search')) {
      box.remove();
      box = null;
    }
  });
}

export function mountStoreFooter(vendor) {
  const host = $('[data-store-footer]');
  if (!host || !vendor) return;
  const socials = Object.entries(vendor.social || {}).filter(([, v]) => v);
  host.innerHTML = html`
    <footer class="store-footer">
      <div class="container container-wide">
        <div class="sf-grid">
          <div class="sf-about">
            <div class="row mb-4">
              ${vendor.logo ? html`<img src="${url(vendor.logo.replace(/^\//, ''))}" alt="" width="40" height="40" style="border-radius:12px"/>` : ''}
              <strong class="ink">${vendor.name}</strong>
            </div>
            <p class="muted text-sm clamp-3">${vendor.tagline || vendor.description || ''}</p>
            ${socials.length
              ? html`<div class="sf-social">${socials.map(([k, v]) => html`<a href="${v.startsWith('http') ? v : '#'}" target="_blank" rel="noopener noreferrer" aria-label="${k}">${raw(icon(k === 'whatsapp' ? 'whatsapp' : k))}</a>`)}</div>`
              : ''}
          </div>
          <div>
            <h6>Shop</h6>
            <a href="${url('vendor/category.html')}?vendor=${vendor.slug}">All products</a>
            <a href="${url('vendor/cart.html')}?vendor=${vendor.slug}">Your cart</a>
            <a href="${url('vendor/orders.html')}?vendor=${vendor.slug}">Track an order</a>
            <a href="${url('vendor/wishlist.html')}?vendor=${vendor.slug}">Wishlist</a>
          </div>
          <div>
            <h6>Account</h6>
            <a href="${url('vendor/account.html')}?vendor=${vendor.slug}">My account</a>
            <a href="${url('login.html')}">Sign in</a>
            <a href="${url('register.html')}">Sell on ${cfg.brand.shortName}</a>
            <a href="${url('pages/refund-policy.html')}">Refund policy</a>
          </div>
          <div>
            <h6>Contact</h6>
            <p class="sf-contact">${raw(icon('map-pin'))} ${vendor.address || `${vendor.city || ''} ${vendor.state || ''}`}</p>
            ${vendor.phone ? html`<p class="sf-contact"><a href="tel:${vendor.phone.replace(/\s/g, '')}">${raw(icon('phone'))} ${vendor.phone}</a></p>` : ''}
            ${vendor.email ? html`<p class="sf-contact"><a href="mailto:${vendor.email}">${raw(icon('mail'))} ${vendor.email}</a></p>` : ''}
            ${vendor.hours?.mon ? html`<p class="sf-contact">${raw(icon('clock'))} Mon–Fri ${vendor.hours.mon}</p>` : ''}
          </div>
        </div>
        <div class="sf-bottom">
          <span>© ${new Date().getFullYear()} ${vendor.name}. Powered by <a href="${url('index.html')}">${cfg.brand.name}</a></span>
          <span class="sf-legal">
            <a href="${url('pages/terms.html')}">Terms</a>
            <a href="${url('pages/privacy.html')}">Privacy</a>
            <a href="${url('pages/refund-policy.html')}">Refunds</a>
          </span>
        </div>
      </div>
    </footer>`;
}

/* =================================================== C. dashboard chrome */

export const SIDEBAR = [
  { group: 'Overview', items: [
    { id: 'dashboard', label: 'Dashboard', icon: 'grid', href: 'dashboard.html' },
    { id: 'analytics', label: 'Analytics', icon: 'chart-line', href: 'analytics.html' },
    { id: 'notifications', label: 'Notifications', icon: 'bell', href: 'notifications.html', badge: 'notifications' },
  ]},
  { group: 'Catalogue', items: [
    { id: 'products', label: 'Products', icon: 'package', href: 'products.html' },
    { id: 'categories', label: 'Categories', icon: 'tag', href: 'categories.html' },
    { id: 'store', label: 'My Store', icon: 'store', href: 'store.html' },
  ]},
  { group: 'Sales', items: [
    { id: 'orders', label: 'Orders', icon: 'receipt', href: 'orders.html' },
    { id: 'customers', label: 'Customers', icon: 'users', href: 'customers.html' },
    { id: 'order-detail', label: 'Order detail', icon: 'file', href: 'order-detail.html', hidden: true },
  ]},
  { group: 'Money', items: [
    { id: 'payments', label: 'Payments', icon: 'credit', href: 'payments.html' },
    { id: 'balance', label: 'Balance', icon: 'wallet', href: 'balance.html' },
    { id: 'withdrawals', label: 'Withdrawals', icon: 'banknote', href: 'withdrawals.html' },
  ]},
  { group: 'Account', items: [
    { id: 'settings', label: 'Store Settings', icon: 'settings', href: 'settings.html' },
    { id: 'profile', label: 'Profile', icon: 'user', href: 'profile.html' },
    { id: 'support', label: 'Support', icon: 'message', href: 'support.html' },
  ]},
];

/** Platform (super admin) console navigation — spec §30, role based menus. */
export const ADMIN_SIDEBAR = [
  { group: 'Platform', items: [
    { id: 'console', label: 'Overview', icon: 'grid', href: 'index.html' },
    { id: 'vendors', label: 'Stores', icon: 'store', href: 'vendors.html' },
    { id: 'orders', label: 'All orders', icon: 'receipt', href: 'orders.html' },
  ]},
  { group: 'Money', items: [
    { id: 'deposits', label: 'Security deposits', icon: 'shield-check', href: 'deposits.html' },
    { id: 'withdrawals', label: 'Payouts', icon: 'banknote', href: 'withdrawals.html' },
  ]},
  { group: 'Support', items: [
    { id: 'messages', label: 'Messages', icon: 'message', href: 'messages.html', badge: 'messages' },
    { id: 'notifications', label: 'Notifications', icon: 'bell', href: 'notifications.html', badge: 'notifications' },
  ]},
];

/**
 * Injects the dashboard sidebar + topbar around the page's <main> content.
 * @param {object} opts { active, title, subtitle, actions, nav, variant }
 *   variant 'vendor'  → store console (admin/dashboard.html and friends)
 *   variant 'console' → platform console for super admins (admin/index.html)
 */
export function mountDashboardChrome({ active = 'dashboard', title = '', subtitle = '', actions = '', nav = SIDEBAR, variant = 'vendor' } = {}) {
  const shell = $('[data-app-shell]');
  const main = $('main');
  if (!shell || !main) return;
  const isConsole = variant === 'console';

  const groups = nav.map((group) => {
    const items = group.items.filter((i) => !i.hidden);
    if (!items.length) return '';
    return html`
      <div class="sb-group">
        <span class="sb-title">${group.group}</span>
        ${items.map((item) => navLink(item, active))}
      </div>`;
  }).join('');

  shell.innerHTML = html`
    <div class="app-backdrop" data-app-backdrop></div>
    <aside class="sidebar" data-sidebar aria-label="Dashboard navigation">
      <div class="sb-head">
        <a class="sb-brand" href="${url(isConsole ? 'admin/index.html' : 'admin/dashboard.html')}">
          <img src="${url('assets/images/logos/growbusiness.svg')}" alt="" width="34" height="34"/>
          <span><strong>${cfg.brand.shortName}</strong><small>${isConsole ? 'Platform console' : 'Vendor console'}</small></span>
        </a>
        <button type="button" class="icon-btn ghost sb-close" data-app-close aria-label="Close navigation">${raw(icon('close'))}</button>
      </div>

      <div class="sb-store" data-sb-store>
        <div class="skeleton sk-text" style="width:60%"></div>
        <div class="skeleton sk-text" style="width:40%"></div>
      </div>

      <nav class="sb-nav">${raw(groups)}</nav>

      <div class="sb-foot">
        <a class="sb-link" href="${url('index.html')}">${raw(icon('globe'))}<span>Main website</span></a>
        <button type="button" class="sb-link" data-signout>${raw(icon('logout'))}<span>Logout</span></button>
        <div class="sb-plan">
          <div class="row row-between"><span>Commission</span><strong data-sb-commission>—</strong></div>
          <div class="progress progress-sm mt-2"><span style="width:5%"></span></div>
          <small>Platform fee on completed orders</small>
        </div>
      </div>
    </aside>

    <div class="app-main">
      <header class="topbar" data-topbar>
        <button type="button" class="icon-btn ghost tb-burger" data-app-open aria-label="Open navigation">${raw(icon('menu'))}</button>
        <div class="tb-title">
          <h1 data-page-title>${title || 'Dashboard'}</h1>
          ${subtitle ? html`<p data-page-subtitle>${subtitle}</p>` : ''}
        </div>
        <div class="tb-actions">
          <form class="tb-search" role="search" data-global-search>
            <div class="input-group">${raw(icon('search'))}<input class="input" type="search" placeholder="${isConsole ? 'Search stores, orders…' : 'Search products, orders…'}" aria-label="Search dashboard"/></div>
          </form>
          <button type="button" class="icon-btn" data-theme-toggle aria-label="Toggle dark mode">${raw(icon(currentTheme() === 'dark' ? 'sun' : 'moon'))}</button>
          <div class="dropdown">
            <button type="button" class="icon-btn" data-dropdown-toggle aria-label="Notifications" aria-expanded="false">
              ${raw(icon('bell'))}<span class="dot hidden" data-notif-count>0</span>
            </button>
            <div class="dropdown-menu notif-menu" data-notif-preview>
              <div class="head">Notifications</div>
              <div class="notif-loading"><span class="spinner"></span> Loading…</div>
            </div>
          </div>
          <a class="btn btn-secondary btn-sm tb-view-store" href="#" data-view-store target="_blank" rel="noopener">${raw(icon('external'))}<span class="hide-sm">View store</span></a>
          <div class="dropdown">
            <button type="button" class="tb-user" data-dropdown-toggle aria-expanded="false" aria-haspopup="menu">
              <span class="avatar avatar-sm" data-user-avatar>?</span>
              <span class="tb-user-name hide-sm" data-user-name>Loading…</span>
              ${raw(icon('chevron-down'))}
            </button>
            <div class="dropdown-menu" role="menu">
              <div class="head" data-user-email>—</div>
              ${isConsole ? html`
                <a role="menuitem" href="${url('admin/vendors.html')}">${raw(icon('store'))} Stores</a>
                <a role="menuitem" href="${url('admin/messages.html')}">${raw(icon('message'))} Messages</a>
                <a role="menuitem" href="${url('index.html')}">${raw(icon('globe'))} Main website</a>`
                : html`
                <a role="menuitem" href="${url('admin/profile.html')}">${raw(icon('user'))} Profile</a>
                <a role="menuitem" href="${url('admin/settings.html')}">${raw(icon('settings'))} Store settings</a>
                <a role="menuitem" href="${url('admin/support.html')}">${raw(icon('message'))} Support</a>`}
              <div class="sep"></div>
              <button role="menuitem" type="button" data-signout>${raw(icon('logout'))} Logout</button>
            </div>
          </div>
          ${actions ? raw(`<div class="tb-extra">${actions}</div>`) : ''}
        </div>
      </header>
      <div class="app-scroll" data-app-scroll></div>
    </div>`;

  document.documentElement.dataset.variant = variant;
  if (isConsole) document.documentElement.dataset.console = 'true';

  // Move the page's own <main> content into the scroll container.
  const scroll = $('[data-app-scroll]', shell);
  while (main.firstChild) scroll.append(main.firstChild);
  main.remove();
  bindAppShell();
  return shell;
}

function navLink(item, active) {
  const isActive = item.id === active;
  return html`<a class="sb-link ${isActive ? 'is-active' : ''}" href="${url(`admin/${item.href}`)}" ${isActive ? 'aria-current="page"' : ''}>
    ${raw(icon(item.icon))}<span>${item.label}</span>
    ${item.badge === 'notifications' ? html`<em class="sb-badge hidden" data-notif-badge>0</em>` : ''}
  </a>`;
}

function bindAppShell() {
  const open = (v) => {
    $('[data-sidebar]')?.classList.toggle('is-open', v);
    $('[data-app-backdrop]')?.classList.toggle('is-open', v);
    document.body.style.overflow = v ? 'hidden' : '';
  };
  $('[data-app-open]')?.addEventListener('click', () => open(true));
  $('[data-app-close]')?.addEventListener('click', () => open(false));
  $('[data-app-backdrop]')?.addEventListener('click', () => open(false));
  document.addEventListener('keydown', (e) => e.key === 'Escape' && open(false));

  // "/" focuses the dashboard search (spec §37)
  document.addEventListener('keydown', (e) => {
    if (e.key === '/' && !/input|textarea|select/i.test(document.activeElement?.tagName || '')) {
      e.preventDefault();
      $('[data-global-search] input')?.focus();
    }
  });
  $('[data-global-search]')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const q = e.target.querySelector('input').value.trim();
    const target = document.documentElement.dataset.console === 'true' ? 'admin/vendors.html' : 'admin/products.html';
    if (q) globalThis.location.href = url(`${target}?q=${encodeURIComponent(q)}`);
  });
}

/** Fills the sidebar store card + user chip once /vendor/me resolves. */
export function paintDashboardIdentity(vendor, user, { commissionPercent = null } = {}) {
  const card = $('[data-sb-store]');
  if (card && vendor) {
    const statusTone = { active: 'badge-success', pending_activation: 'badge-warning', pending_deposit: 'badge-warning', suspended: 'badge-danger', rejected: 'badge-danger' }[vendor.status] || 'badge';
    card.innerHTML = html`
      ${vendor.logo ? html`<img src="${url(String(vendor.logo).replace(/^\//, ''))}" alt="" width="38" height="38"/>` : html`<span class="avatar avatar-sm">${(vendor.name || 'S').slice(0, 2).toUpperCase()}</span>`}
      <div class="sb-store-meta">
        <strong>${vendor.name}</strong>
        <span class="badge ${statusTone}"><span class="dotmark"></span>${sentence(vendor.status)}</span>
      </div>
      <a class="sb-store-link" href="${url(`vendor/index.html?vendor=${vendor.slug}`)}" target="_blank" rel="noopener" data-tip="Open storefront">${raw(icon('external'))}</a>`;
  }
  const viewStore = $('[data-view-store]');
  if (viewStore && vendor) viewStore.href = url(`vendor/index.html?vendor=${vendor.slug}`);
  if (user) {
    const avatar = $('[data-user-avatar]');
    if (avatar) {
      avatar.textContent = (user.name || '?').split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase();
      avatar.style.background = `color-mix(in srgb, ${user.avatarColor || 'var(--brand)'} 20%, var(--surface))`;
      avatar.style.color = user.avatarColor || 'var(--brand)';
    }
    const name = $('[data-user-name]');
    if (name) name.textContent = user.name || 'Account';
    const email = $('[data-user-email]');
    if (email) email.textContent = user.email || '';
  }
  if (commissionPercent !== null && commissionPercent !== undefined) {
    const node = $('[data-sb-commission]');
    if (node) node.textContent = `${commissionPercent}%`;
    $$('.sb-plan .progress span').forEach((n) => (n.style.width = `${Math.min(100, commissionPercent * 6)}%`));
  }
}

/* ---------------------------------------------------- notification preview */

export function paintNotificationPreview(items = [], unread = 0) {
  const box = $('[data-notif-preview]');
  const dot = $('[data-notif-count]');
  const badge = $('[data-notif-badge]');
  if (dot) {
    dot.textContent = unread > 9 ? '9+' : String(unread);
    dot.classList.toggle('hidden', unread === 0);
  }
  if (badge) {
    badge.textContent = unread > 9 ? '9+' : String(unread);
    badge.classList.toggle('hidden', unread === 0);
  }
  if (!box) return;
  if (!items.length) {
    box.innerHTML = `<div class="head">Notifications</div><div class="notif-empty">You're all caught up 🎉</div>
      <a class="notif-all" href="${url('admin/notifications.html')}">Open notification centre</a>`;
    return;
  }
  box.innerHTML = `<div class="head">Notifications ${unread ? `· ${unread} new` : ''}</div>` +
    items.slice(0, 5).map((n) => `<a class="notif-row ${n.readAt ? '' : 'is-unread'}" href="${url(n.link || 'admin/notifications.html')}">
        <span class="notif-ico">${icon(notifIcon(n.type))}</span>
        <span class="notif-body"><strong>${esc(n.title)}</strong><small>${esc((n.body || '').slice(0, 70))}</small></span>
      </a>`).join('') +
    `<a class="notif-all" href="${url('admin/notifications.html')}">View all notifications</a>`;
}

export const notifIcon = (type) =>
  ({ order: 'receipt', payment: 'wallet', system: 'sparkles', security: 'shield-check', announcement: 'bell' })[type] || 'bell';

/* ------------------------------------------------------- small link button */

export const linkButton = (label, href, { variant = 'btn-ghost', iconName = null } = {}) =>
  `<a class="btn ${variant}" href="${href}">${iconName ? icon(iconName) : ''}<span>${esc(label)}</span></a>`;

export default { mountMarketingChrome, mountStorefrontChrome, mountStoreHeader, mountStoreFooter, mountDashboardChrome, paintDashboardIdentity, paintNotificationPreview, SIDEBAR, ADMIN_SIDEBAR, NAV };
