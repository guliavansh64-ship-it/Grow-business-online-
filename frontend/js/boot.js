/**
 * boot.js — the single script tag every page includes.
 *
 *   <script type="module" src="../js/boot.js" data-page="store-product"></script>
 *
 * It mounts the icon sprite + theme (both before first paint of dynamic UI),
 * restores the session, then dynamically imports ONLY the module that page
 * needs. That is the code splitting required by spec §38 — a customer never
 * downloads the dashboard bundle and a vendor never downloads checkout code.
 */
import cfg from './config.js';
import { mountIcons, mountIconStyle } from './icons.js';
import { initTheme } from './theme.js';
import { initUI, toastError } from './ui.js';
import { restore, bindSignOutButtons, state as auth } from './auth.js';
import { $ } from './utils.js';
import { friendlyMessage } from './api.js';

const PAGES = {
  /* marketing */
  home: () => import('./pages/marketing.js').then((m) => m.home),
  'page-about': () => import('./pages/marketing.js').then((m) => m.about),
  'page-features': () => import('./pages/marketing.js').then((m) => m.about),
  'page-pricing': () => import('./pages/marketing.js').then((m) => m.pricing),
  'page-how': () => import('./pages/marketing.js').then((m) => m.about),
  'page-vendors': () => import('./pages/marketing.js').then((m) => m.vendors),
  'page-contact': () => import('./pages/marketing.js').then((m) => m.contact),
  'page-faq': () => import('./pages/marketing.js').then((m) => m.faq),
  'page-legal': () => import('./pages/marketing.js').then((m) => m.legal),

  /* auth + onboarding */
  login: () => import('./pages/auth.js').then((m) => m.login),
  register: () => import('./pages/auth.js').then((m) => m.register),
  forgot: () => import('./pages/auth.js').then((m) => m.forgot),
  reset: () => import('./pages/auth.js').then((m) => m.reset),
  deposit: () => import('./pages/onboarding.js').then((m) => m.deposit),
  activation: () => import('./pages/onboarding.js').then((m) => m.activation),

  /* storefront */
  store: () => import('./pages/storefront.js').then((m) => m.storeHome),
  'store-category': () => import('./pages/storefront.js').then((m) => m.category),
  'store-product': () => import('./pages/storefront.js').then((m) => m.product),
  'store-cart': () => import('./pages/checkout.js').then((m) => m.cartPage),
  'store-checkout': () => import('./pages/checkout.js').then((m) => m.checkout),
  'store-success': () => import('./pages/checkout.js').then((m) => m.success),
  'store-orders': () => import('./pages/customer.js').then((m) => m.orders),
  'store-order': () => import('./pages/customer.js').then((m) => m.orderDetail),
  'store-account': () => import('./pages/customer.js').then((m) => m.account),
  'store-wishlist': () => import('./pages/customer.js').then((m) => m.wishlist),

  /* vendor dashboard */
  dash: () => import('./pages/dashboard.js').then((m) => m.dashboard),
  'dash-analytics': () => import('./pages/dashboard.js').then((m) => m.analytics),
  'dash-notifications': () => import('./pages/dashboard.js').then((m) => m.notifications),
  'dash-products': () => import('./pages/catalogue.js').then((m) => m.products),
  'dash-categories': () => import('./pages/catalogue.js').then((m) => m.categories),
  'dash-store': () => import('./pages/catalogue.js').then((m) => m.myStore),
  'dash-orders': () => import('./pages/sales.js').then((m) => m.orders),
  'dash-order': () => import('./pages/sales.js').then((m) => m.orderDetail),
  'dash-customers': () => import('./pages/sales.js').then((m) => m.customers),
  'dash-payments': () => import('./pages/money.js').then((m) => m.payments),
  'dash-balance': () => import('./pages/money.js').then((m) => m.balance),
  'dash-withdrawals': () => import('./pages/money.js').then((m) => m.withdrawals),
  'dash-settings': () => import('./pages/vendorAccount.js').then((m) => m.settings),
  'dash-profile': () => import('./pages/vendorAccount.js').then((m) => m.profile),
  'dash-support': () => import('./pages/vendorAccount.js').then((m) => m.support),

  /* super admin */
  console: () => import('./pages/console.js').then((m) => m.console),
  'console-vendors': () => import('./pages/console.js').then((m) => m.vendors),
  'console-deposits': () => import('./pages/console.js').then((m) => m.deposits),
  'console-withdrawals': () => import('./pages/console.js').then((m) => m.withdrawals),
  'console-orders': () => import('./pages/console.js').then((m) => m.orders),
  'console-messages': () => import('./pages/console.js').then((m) => m.messages),

  notfound: () => import('./pages/marketing.js').then((m) => m.notFound),
};

async function boot() {
  const script = document.currentScript || $('script[data-page]');
  const page = script?.dataset?.page || 'home';

  mountIconStyle();
  mountIcons(document.body);
  initTheme();
  initUI();
  bindSignOutButtons(document);

  document.documentElement.dataset.page = page;
  document.body.classList.add('js-ready');

  const needsAuth = !/^(home|page-|login|register|forgot|reset|store|notfound)/.test(page) || /^(dash|console)/.test(page);
  if (needsAuth || page.startsWith('store-account') || page.startsWith('store-wishlist')) {
    await restore();
  } else {
    // Restore in the background so headers can show the account chip.
    restore().catch(() => {});
  }

  const loader = PAGES[page];
  if (!loader) {
    console.warn(`[boot] No module registered for data-page="${page}"`);
    return;
  }

  try {
    const init = await loader();
    if (typeof init === 'function') await init({ page, auth });
  } catch (err) {
    console.error(`[boot:${page}]`, err);
    document.body.classList.add('page-error');
    const host = $('[data-page-error]') || $('main');
    if (host && !host.dataset.errorRendered) {
      host.dataset.errorRendered = '1';
      host.innerHTML = `<div class="empty"><div class="art"><svg class="icon"><use href="#i-alert-triangle"/></svg></div>
        <h3>We couldn't load this page</h3><p>${friendlyMessage(err)}</p>
        <button class="btn btn-primary" onclick="location.reload()">Try again</button></div>`;
    }
    toastError(friendlyMessage(err));
  } finally {
    document.body.classList.add('page-ready');
  }
}

boot();
