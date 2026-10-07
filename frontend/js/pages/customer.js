/**
 * pages/customer.js — My Orders, Order Tracking, My Account and Wishlist.
 *
 * Tracking works two ways (spec §21):
 *   · signed-in customers read their own orders through /customer/orders
 *   · guests look an order up with the order number + the phone/email they used
 * A guest can never enumerate somebody else's order — the server checks both.
 */
import Api, { friendlyMessage } from '../api.js';
import cfg from '../config.js';
import { initStorefront } from '../vendor.js';
import { mountStorefrontChrome } from '../layout.js';
import cart from '../cart.js';
import { guard, isSignedIn, state as auth, renderAccountChip } from '../auth.js';
import { $, $$, url, html, raw, esc, money, num, dateShort, dateTime, timeAgo, debounce, qget, setQuery } from '../utils.js';
import { readForm, paintErrors, validators } from '../utils.js';
import { icon } from '../icons.js';
import { toast, toastSuccess, toastError, withButtonState, emptyState, setLoading, modal, confirmDialog } from '../ui.js';
import { statusBadge, ORDER_TONE, PAYMENT_TONE, trackingSteps, table, paginationBar, summaryRows, ratingStars, priceBlock } from '../components.js';
import { renderNotificationCenter, refreshNotifications, markRead } from '../notifications.js';

const boot = async (activeNav, { requireVendor = true } = {}) => {
  const vendor = await initStorefront({ onNotFound: () => $('[data-store-host]')?.remove(), requireVendor });
  if (requireVendor && !vendor) return null;
  const categories = vendor?.categories?.length ? vendor.categories : [];
  mountStorefrontChrome(vendor, { categories, activeNav });
  if (vendor) cart.bind(vendor.slug);
  return vendor;
};

const ACCOUNT_NAV = [
  { key: 'account', label: 'My Account', icon: 'user', href: 'account.html' },
  { key: 'orders', label: 'My Orders', icon: 'receipt', href: 'orders.html' },
  { key: 'wishlist', label: 'Wishlist', icon: 'heart', href: 'wishlist.html' },
  { sep: true },
  { key: 'addresses', label: 'Saved Addresses', icon: 'map-pin', href: 'account.html#addresses' },
  { key: 'profile', label: 'Profile', icon: 'settings', href: 'account.html#profile' },
  { key: 'notifications', label: 'Notifications', icon: 'bell', href: 'account.html#notifications' },
  { sep: true },
  { key: 'logout', label: 'Logout', icon: 'log-out', href: null },
];

function accountNav(active, vendor) {
  return html`
    <nav class="account-nav" aria-label="Account">
      ${ACCOUNT_NAV.map((item) => item.sep
        ? '<span class="sep"></span>'
        : item.key === 'logout'
          ? html`<a href="#" data-signout>${raw(icon('log-out'))}<span>${item.label}</span></a>`
          : html`<a href="${url(`vendor/${item.href}${vendor ? `?vendor=${vendor.slug}` : ''}`)}" class="${active === item.key ? 'is-active' : ''}">${raw(icon(item.icon))}<span>${item.label}</span>${active === item.key ? raw(icon('chevron-right')) : ''}</a>`)}
    </nav>`;
}

/* ============================================================== my orders */

export async function orders() {
  const vendor = await boot('orders');
  if (!vendor) return;
  const host = $('[data-store-host]');

  if (!isSignedIn()) {
    host.innerHTML = `<div class="container section">${emptyState({ icon: 'lock', title: 'Sign in to see your orders', message: 'Your order history is kept private to your account.', action: { label: 'Sign in', href: url('login.html') } })}
      <div class="text-center mt-6"><a class="btn btn-secondary" href="${url(`vendor/order-detail.html?vendor=${vendor.slug}`)}">${raw(icon('search'))} Track an order as a guest</a></div></div>`;
    return;
  }
  if (auth.user.role !== 'customer') {
    host.innerHTML = `<div class="container section">${emptyState({ icon: 'alert-triangle', title: 'This area is for customers', message: 'Vendor and admin accounts have their own console.', action: { label: 'Go to dashboard', href: url(auth.user.role === 'super_admin' ? 'admin/index.html' : 'admin/dashboard.html') } })}</div>`;
    return;
  }

  document.title = `My Orders · ${vendor.name}`;
  host.innerHTML = html`
    <div class="container section-sm">
      <div class="page-head mb-6">
        <div><h1>My Orders</h1><p class="sub">Every order you have placed across ${cfg.brand.shortName} stores.</p></div>
      </div>
      <div class="account-layout">
        ${accountNav('orders', vendor)}
        <div>
          <div class="toolbar mb-4">
            <div class="toolbar-left">
              <form class="tb-search-form" data-order-search-form role="search">
                <div class="input-group">${raw(icon('search', 'ico'))}<input class="input" type="search" placeholder="Search order number or store…" data-order-search aria-label="Search orders"/></div>
              </form>
            </div>
            <div class="toolbar-right">
              <div class="chip-row" data-status-filter>
                <button type="button" class="chip is-active" data-status="all">All</button>
                ${['pending', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled'].map((s) => html`<button type="button" class="chip" data-status="${s}">${s.replace(/_/g, ' ')}</button>`)}
              </div>
            </div>
          </div>
          <div data-order-list></div>
          <div class="mt-6" data-pagination></div>
        </div>
      </div>
    </div>`;

  const list = $('[data-order-list]');
  const state = { status: qget('status') || 'all', q: qget('q') || '', page: Number(qget('page') || 1) };
  $('[data-order-search]').value = state.q;

  const load = async () => {
    setLoading(list, true, `<div class="stack">${Array.from({ length: 3 }, () => '<div class="skeleton sk-card" style="height:120px"></div>').join('')}</div>`);
    try {
      const { items, pagination } = await Api.paged('/customer/orders', {
        status: state.status === 'all' ? '' : state.status,
        q: state.q || undefined,
        page: state.page,
        limit: 10,
      });

      if (!items.length) {
        list.innerHTML = emptyState({ icon: 'receipt', title: state.status === 'all' && !state.q ? 'No orders yet' : 'No orders match that filter', message: 'When you place an order it will show up here with live tracking.', action: { label: 'Start shopping', href: url(`vendor/category.html?vendor=${vendor.slug}`) } });
      } else {
        list.innerHTML = `<div class="stack">${items.map(orderCard).join('')}</div>`;
      }
      $('[data-pagination]').innerHTML = pagination ? paginationBar(pagination) : '';
      setLoading(list, false);
    } catch (err) {
      setLoading(list, false);
      list.innerHTML = emptyState({ icon: 'alert-triangle', title: 'Could not load your orders', message: friendlyMessage(err) });
    }
  };

  const orderCard = (o) => html`
    <article class="order-card">
      <div class="oc-thumbs">
        ${(o.items || []).slice(0, 3).map((l) => l.image
          ? html`<img src="${url(String(l.image).replace(/^\//, ''))}" alt="" width="52" height="52" loading="lazy"/>`
          : '<span class="thumb"></span>')}
        ${o.itemCount > 3 ? html`<span class="more">+${o.itemCount - 3}</span>` : ''}
      </div>
      <div class="oc-body">
        <div class="row row-wrap" style="gap:8px">
          <strong class="ink mono">${o.orderNumber}</strong>
          ${statusBadge(o.status, ORDER_TONE)}
          ${statusBadge(o.paymentStatus, PAYMENT_TONE)}
        </div>
        <p class="muted text-sm mt-2">
          ${o.vendor ? html`<a href="${url(`vendor/index.html?vendor=${o.vendor.slug}`)}">${o.vendor.name}</a> · ` : ''}
          ${num(o.itemCount)} item${o.itemCount === 1 ? '' : 's'} · ${dateShort(o.placedAt)}
        </p>
        <p class="text-sm mt-1 clamp-1">${(o.items || []).map((l) => `${l.qty}× ${l.name}`).join(', ')}</p>
        ${o.deliveryEta && !['delivered', 'cancelled', 'refunded'].includes(o.status)
          ? html`<p class="hint mt-2">${raw(icon('truck'))} Estimated delivery ${dateShort(o.deliveryEta)}</p>` : ''}
      </div>
      <div class="oc-right">
        <div class="oc-amount">${money(o.totalPaise)}</div>
        <a class="btn btn-sm btn-secondary mt-2" href="${url(`vendor/order-detail.html?vendor=${vendor.slug}&number=${o.orderNumber}`)}">${raw(icon('eye'))} Track</a>
      </div>
    </article>`;

  $$('[data-status]').forEach((chip) => chip.addEventListener('click', () => {
    $$('[data-status]').forEach((c) => c.classList.remove('is-active'));
    chip.classList.add('is-active');
    state.status = chip.dataset.status;
    state.page = 1;
    setQuery({ status: state.status === 'all' ? null : state.status, page: null }, { replace: true });
    load();
  }));

  $('[data-order-search-form]').addEventListener('submit', (e) => { e.preventDefault(); state.q = $('[data-order-search]').value.trim(); load(); });
  $('[data-order-search]').addEventListener('input', debounce((e) => { state.q = e.target.value.trim(); state.page = 1; load(); }, cfg.searchDebounceMs));
  $('[data-pagination]').addEventListener('click', (e) => {
    const link = e.target.closest('[data-page]');
    if (!link || link.getAttribute('aria-disabled') === 'true') return;
    e.preventDefault();
    state.page = Number(link.dataset.page);
    load();
    globalThis.scrollTo({ top: 0, behavior: 'smooth' });
  });

  load();
}

/* ========================================================== order detail */

export async function orderDetail() {
  const vendor = await boot('orders');
  if (!vendor) return;
  const host = $('[data-store-host]');
  const number = qget('number');
  const signedIn = isSignedIn() && auth.user.role === 'customer';

  document.title = number ? `Order ${number} · ${vendor.name}` : `Track your order · ${vendor.name}`;

  if (!number) {
    host.innerHTML = html`
      <div class="container section-sm" style="max-width:720px">
        <div class="card card-pad">
          <h1 class="h2">Track your order</h1>
          <p class="muted mt-2">Enter the order number we emailed or showed you after checkout, plus the mobile number or email you used.</p>
          <form class="stack mt-6" data-track-form>
            <div class="field" data-field="number">
              <label class="label" for="tk-number">Order number</label>
              <input class="input mono" id="tk-number" name="number" placeholder="GBO26-00001" autocomplete="off" data-autofocus/>
              <span class="error-text" data-error></span>
            </div>
            <div class="form-grid">
              <div class="field" data-field="phone">
                <label class="label" for="tk-phone">Mobile number</label>
                <input class="input" id="tk-phone" name="phone" inputmode="numeric" placeholder="98765 43210"/>
              </div>
              <div class="field" data-field="email">
                <label class="label" for="tk-email">Or email</label>
                <input class="input" id="tk-email" name="email" type="email" placeholder="you@example.com"/>
              </div>
            </div>
            <button type="submit" class="btn btn-primary btn-lg">${raw(icon('search'))} Track order</button>
            <div class="hidden" data-track-error></div>
          </form>
          ${!signedIn ? html`<hr class="divider"/><p class="text-sm muted">Signed-in customers can see all their orders at once. <a href="${url('login.html')}">Sign in</a></p>` : ''}
        </div>
      </div>`;

    $('[data-track-form]').addEventListener('submit', (e) => {
      e.preventDefault();
      const { values, errors, valid } = readForm(e.currentTarget, {
        number: [validators.required],
      });
      if (!values.phone && !values.email) errors.phone = 'Enter the mobile number or email used for this order.';
      const hasPhoneOrEmail = !!(values.phone || values.email);
      paintErrors(e.currentTarget, errors);
      if (!valid || !hasPhoneOrEmail) {
        toastError('Add your order number and the contact details you used.');
        return;
      }
      setQuery({ number: values.number.trim().toUpperCase(), phone: values.phone || null, email: values.email || null }, { replace: true });
      loadTracking(values.number.trim(), values.phone, values.email);
    });
    return;
  }

  host.innerHTML = `<div class="container section-sm"><div class="skeleton sk-card" style="height:340px"></div></div>`;

  if (signedIn) {
    try {
      const data = await Api.customerOrder(number);
      renderCustomerOrder(host, data, vendor);
      return;
    } catch (err) {
      if (err.status !== 404 && err.status !== 403) {
        host.innerHTML = `<div class="container section">${emptyState({ icon: 'alert-triangle', title: 'Could not load this order', message: friendlyMessage(err), action: { label: 'Back to my orders', href: url(`vendor/orders.html?vendor=${vendor.slug}`) } })}</div>`;
        return;
      }
    }
  }
  loadTracking(number, qget('phone') || '', qget('email') || '');

  async function loadTracking(n, phone, email) {
    setLoading(host, true, `<div class="container section-sm"><div class="skeleton sk-card" style="height:340px"></div></div>`);
    try {
      const data = await Api.trackOrder(n, phone, email);
      renderTracking(host, data, vendor);
      setLoading(host, false);
    } catch (err) {
      setLoading(host, false);
      host.innerHTML = html`
        <div class="container section-sm" style="max-width:720px">
          <div class="card card-pad">
            <div class="alert alert-danger">${raw(icon('alert-circle'))}<div class="a-body"><strong>${err.message}</strong><span class="muted text-sm">Double-check the order number and the mobile number or email you used at checkout.</span></div></div>
            <div class="row mt-4"><a class="btn btn-secondary" href="${url(`vendor/order-detail.html?vendor=${vendor.slug}`)}">${raw(icon('arrow-left'))} Try again</a></div>
          </div>
        </div>`;
    }
  }
}

function renderCustomerOrder(host, data, vendor) {
  const { order, timeline, steps } = data;
  const v = order.vendor || vendor;
  document.title = `Order ${order.orderNumber} · ${v.name}`;

  host.innerHTML = html`
    <div class="container section-sm">
      <nav class="breadcrumb mb-4" aria-label="Breadcrumb">
        <a href="${url(`vendor/index.html?vendor=${v.slug || vendor.slug}`)}">Home</a>${raw(icon('chevron-right', 'sep'))}
        <a href="${url(`vendor/orders.html?vendor=${v.slug || vendor.slug}`)}">My Orders</a>${raw(icon('chevron-right', 'sep'))}
        <span class="current">${order.orderNumber}</span>
      </nav>

      <div class="track-hero card card-pad mb-6">
        <div class="row row-wrap" style="gap:12px">
          <div class="grow">
            <span class="eyebrow">Order</span>
            <h1 class="mono" style="letter-spacing:-0.02em">${order.orderNumber}</h1>
            <p class="muted mt-2">Placed ${dateTime(order.placedAt)} from <a href="${url(`vendor/index.html?vendor=${v.slug || vendor.slug}`)}">${v.name}</a></p>
          </div>
          <div class="row" style="gap:8px">
            ${statusBadge(order.status, ORDER_TONE)}
            ${statusBadge(order.paymentStatus, PAYMENT_TONE)}
          </div>
        </div>
        ${!['delivered', 'cancelled', 'refunded'].includes(order.status) && order.deliveryEta
          ? html`<div class="alert alert-brand mt-4">${raw(icon('truck'))}<div class="a-body"><strong>Estimated delivery ${dateShort(order.deliveryEta)}</strong>You will get an update at every stage.</div></div>`
          : ''}
      </div>

      <div class="card card-pad mb-6">
        <h3 class="h4 mb-4">Order progress</h3>
        ${trackingSteps(order.status, steps || undefined)}
        ${order.timeline?.length ? html`
          <div class="timeline mt-6">
            ${[...order.timeline].reverse().map((t, i) => html`
              <div class="tl-item ${i === 0 ? 'is-current' : ''}">
                <span class="tl-dot"></span>
                <div><strong class="ink">${t.note || sentenceStatus(t.status)}</strong><span class="muted text-sm" style="display:block">${dateTime(t.at)}</span></div>
              </div>`)}
          </div>` : ''}
      </div>

      <div class="grid g-2">
        <div class="card card-pad">
          <h3 class="h4 mb-4">Items (${order.lines.reduce((a, l) => a + l.qty, 0)})</h3>
          <div class="order-lines">
            ${order.lines.map((l) => html`
              <div class="ol">
                ${l.image ? html`<img src="${url(String(l.image).replace(/^\//, ''))}" alt="" width="56" height="56" loading="lazy"/>` : '<span class="thumb"></span>'}
                <div class="ol-body">
                  <strong class="ink text-sm">${l.name}</strong>
                  <span class="muted text-sm">${l.qty} × ${money(l.unitPricePaise)}</span>
                </div>
                <strong class="ink">${money(l.grossPaise)}</strong>
              </div>`)}
          </div>
          <div class="divider"></div>
          ${summaryRows([
            { label: 'Subtotal', value: money(order.subtotalPaise) },
            order.discountPaise ? { label: 'Discount', value: `− ${money(order.discountPaise)}`, tone: 'is-discount' } : null,
            { label: 'Delivery', value: order.deliveryFeePaise ? money(order.deliveryFeePaise) : 'Free', tone: order.deliveryFeePaise ? '' : 'is-discount' },
            order.taxPaise ? { label: 'Tax', value: money(order.taxPaise) } : null,
            { label: 'Total paid', value: money(order.totalPaise), strong: true },
          ], { wrap: false })}
          <p class="hint mt-3">${order.paymentMethod === 'cod' ? 'Cash on delivery' : `Paid by ${order.paymentMethod}${order.paymentReference ? ` · ref ${order.paymentReference}` : ''}`}</p>
        </div>

        <div class="stack">
          <div class="card card-pad">
            <h3 class="h4 mb-4">Delivery address</h3>
            <p class="ink">${order.customer.name}</p>
            <p class="muted text-sm mt-1">${order.shipping.address}<br/>${order.shipping.city}, ${order.shipping.state} — ${order.shipping.pincode}<br/>${order.shipping.country}</p>
            <p class="muted text-sm mt-3">${raw(icon('phone'))} ${order.customer.phone}${order.customer.email ? html`<br/>${raw(icon('mail'))} ${order.customer.email}` : ''}</p>
          </div>
          <div class="card card-pad">
            <h3 class="h4 mb-4">Need help?</h3>
            <div class="stack-xs">
              ${v.phone ? html`<a class="btn btn-secondary btn-block" href="tel:${String(v.phone).replace(/\s/g, '')}">${raw(icon('phone'))} Call ${v.name}</a>` : ''}
              <a class="btn btn-ghost btn-block" href="${url(`pages/contact.html?subject=Order ${order.orderNumber}`)}">${raw(icon('message'))} Contact support</a>
              ${['pending', 'confirmed'].includes(order.status)
                ? html`<button type="button" class="btn btn-ghost btn-block text-danger" data-cancel-order>${raw(icon('x-circle'))} Request cancellation</button>`
                : ''}
            </div>
            <p class="hint mt-3">Cancellations are approved by the store. Refunds follow the platform refund policy.</p>
          </div>
        </div>
      </div>
    </div>`;

  $('[data-cancel-order]', host)?.addEventListener('click', async () => {
    const yes = await confirmDialog({
      title: 'Request cancellation?',
      message: `${v.name} will be asked to cancel order ${order.orderNumber}. You cannot undo this request.`,
      confirmLabel: 'Send request',
      danger: true,
    });
    if (!yes) return;
    toast('Cancellation request sent. The store will confirm shortly.', { type: 'info', duration: 4000 });
    // Customers never change order status directly — the store does (spec §47).
    await Api.contact({
      name: order.customer.name,
      email: order.customer.email || 'customer@example.com',
      phone: order.customer.phone,
      subject: `Cancel order ${order.orderNumber}`,
      message: `Please cancel order ${order.orderNumber} placed on ${dateShort(order.placedAt)}. Reason: changed my mind.`,
    }).catch(() => {});
  });
}

function renderTracking(host, data, vendor) {
  const v = data.vendor || vendor;
  document.title = `Order ${data.orderNumber} · ${v.name}`;

  host.innerHTML = html`
    <div class="container section-sm" style="max-width:880px">
      <div class="track-hero card card-pad mb-6">
        <span class="eyebrow">${raw(icon('truck'))} Live tracking</span>
        <h1 class="mono mt-2">${data.orderNumber}</h1>
        <div class="row row-wrap mt-3" style="gap:8px">
          ${statusBadge(data.status, ORDER_TONE)}
          ${statusBadge(data.paymentStatus, PAYMENT_TONE)}
          <span class="badge badge-outline">${num(data.itemCount)} item${data.itemCount === 1 ? '' : 's'}</span>
          <span class="badge badge-outline">${money(data.totalPaise)}</span>
        </div>
        ${data.deliveryEta && !['delivered', 'cancelled', 'refunded'].includes(data.status)
          ? html`<p class="muted mt-3">${raw(icon('clock'))} Estimated delivery ${dateShort(data.deliveryEta)}</p>` : ''}
      </div>

      <div class="tracking-visual card card-pad mb-6">
        <h3 class="h4 mb-4">Order progress</h3>
        ${trackingSteps(data.status, data.steps || undefined)}
        ${data.timeline?.length ? html`
          <div class="timeline mt-6">
            ${[...data.timeline].reverse().map((t, i) => html`
              <div class="tl-item ${i === 0 ? 'is-current' : ''}"><span class="tl-dot"></span>
                <div><strong class="ink">${t.note || sentenceStatus(t.status)}</strong><span class="muted text-sm" style="display:block">${dateTime(t.at)}</span></div>
              </div>`)}
          </div>` : ''}
      </div>

      <div class="grid g-2">
        <div class="card card-pad">
          <h3 class="h4 mb-4">Items in this order</h3>
          <div class="order-lines">
            ${data.lines.map((l) => html`
              <div class="ol">
                ${l.image ? html`<img src="${url(String(l.image).replace(/^\//, ''))}" alt="" width="52" height="52" loading="lazy"/>` : '<span class="thumb"></span>'}
                <div class="ol-body"><strong class="ink text-sm">${l.name}</strong><span class="muted text-sm">${l.qty} × ${money(l.unitPricePaise)}</span></div>
                <strong class="ink">${money(l.grossPaise)}</strong>
              </div>`)}
          </div>
        </div>
        <div class="card card-pad">
          <h3 class="h4 mb-4">Delivering to</h3>
          <p class="muted text-sm">${data.shipping.address}<br/>${data.shipping.city}, ${data.shipping.state} — ${data.shipping.pincode}</p>
          <hr class="divider"/>
          <div class="row">
            ${v.logo ? html`<img src="${url(String(v.logo).replace(/^\//, ''))}" alt="" width="40" height="40" style="border-radius:12px"/>` : ''}
            <div class="grow"><strong class="ink">${v.name}</strong><span class="muted text-sm" style="display:block">${v.slug}.${cfg.rootDomain}</span></div>
            <a class="btn btn-sm btn-secondary" href="${url(`vendor/index.html?vendor=${v.slug}`)}">Visit store</a>
          </div>
        </div>
      </div>

      <div class="row mt-6" style="flex-wrap:wrap;justify-content:center">
        <a class="btn btn-secondary" href="${url(`vendor/order-detail.html?vendor=${v.slug}`)}">${raw(icon('search'))} Track another order</a>
        <a class="btn btn-ghost" href="${url(`vendor/index.html?vendor=${v.slug}`)}">${raw(icon('store'))} Back to ${v.name}</a>
      </div>
    </div>`;
}

const sentenceStatus = (s) => String(s || '').replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());

/* =========================================================== my account */

export async function account() {
  const vendor = await boot('account');
  if (!vendor) return;
  const host = $('[data-store-host]');

  if (!isSignedIn()) {
    host.innerHTML = `<div class="container section">${emptyState({ icon: 'user', title: 'Sign in to your account', message: 'Manage your profile, addresses, wishlist and notifications in one place.', action: { label: 'Sign in', href: url('login.html') } })}</div>`;
    return;
  }

  document.title = `My Account · ${vendor.name}`;
  host.innerHTML = html`
    <div class="container section-sm">
      <div class="page-head mb-6">
        <div><h1>My Account</h1><p class="sub">Signed in as ${auth.user.email}</p></div>
        <div class="page-actions">
          <a class="btn btn-secondary btn-sm" href="${url(`vendor/orders.html?vendor=${vendor.slug}`)}">${raw(icon('receipt'))} My orders</a>
          <button type="button" class="btn btn-ghost btn-sm" data-theme-toggle>${raw(icon('moon'))} Theme</button>
        </div>
      </div>

      <div class="account-layout">
        ${accountNav('account', vendor)}
        <div class="stack-lg">
          <div class="kpi-grid" data-account-stats>
            ${['Orders', 'Delivered', 'Total spent', 'Wishlist'].map((l) => html`<div class="kpi"><div class="kpi-head"><span class="kpi-ico">${raw(icon('loader'))}</span></div><div class="kpi-label">${l}</div><div class="kpi-value"><span class="skeleton sk-text" style="width:70px"></span></div></div>`)}
          </div>

          <section class="card card-pad" id="profile">
            <div class="card-head" style="padding:0 0 var(--sp-4);margin-bottom:var(--sp-4)">
              <div><h3 class="h4">Profile</h3><div class="sub">How stores address you and where updates are sent.</div></div>
            </div>
            <form class="form-grid" data-profile-form>
              <div class="field" data-field="name">
                <label class="label" for="ac-name">Full name</label>
                <input class="input" id="ac-name" name="name" value="${auth.user.name || ''}" autocomplete="name"/>
                <span class="error-text" data-error></span>
              </div>
              <div class="field" data-field="phone">
                <label class="label" for="ac-phone">Mobile number</label>
                <input class="input" id="ac-phone" name="phone" value="${auth.user.phone || ''}" inputmode="numeric" autocomplete="tel"/>
                <span class="error-text" data-error></span>
              </div>
              <div class="field" data-field="email">
                <label class="label" for="ac-email">Email</label>
                <input class="input" id="ac-email" value="${auth.user.email || ''}" disabled/>
                <span class="hint">Email changes need a new verification.</span>
              </div>
              <div class="span-2 row" style="gap:10px">
                <button type="submit" class="btn btn-primary" data-label="Save changes">Save changes</button>
                <button type="button" class="btn btn-ghost" data-change-password>Change password</button>
              </div>
              ${auth.user.emailVerified === false ? html`<div class="span-2 alert alert-warning">${raw(icon('mail'))}<div class="a-body"><strong>Email not verified</strong>Check your inbox for the verification link, or <button type="button" class="link-btn" data-resend>send it again</button>.</div></div>` : ''}
            </form>
          </section>

          <section class="card card-pad" id="addresses">
            <div class="card-head" style="padding:0 0 var(--sp-4);margin-bottom:var(--sp-4)">
              <div><h3 class="h4">Saved addresses</h3><div class="sub">Up to 10 addresses for faster checkout.</div></div>
              <button type="button" class="btn btn-secondary btn-sm" data-add-address>${raw(icon('plus'))} Add address</button>
            </div>
            <div class="grid g-2" data-address-list><div class="skeleton sk-card" style="height:120px"></div></div>
          </section>

          <section class="card card-pad" id="notifications">
            <div class="card-head" style="padding:0 0 var(--sp-4);margin-bottom:var(--sp-4)">
              <div><h3 class="h4">Notifications</h3><div class="sub">Order updates and store messages.</div></div>
              <button type="button" class="btn btn-ghost btn-sm" data-mark-read>${raw(icon('check'))} Mark all read</button>
            </div>
            <div data-notif-list><div class="skeleton sk-row"></div><div class="skeleton sk-row"></div></div>
          </section>
        </div>
      </div>
    </div>`;

  /* ---------------------------------------------------------- stats */
  Api.profile().then((data) => {
    const s = data.stats || {};
    const icons = ['receipt', 'check-circle', 'wallet', 'heart'];
    const tones = ['kpi-brand', 'kpi-success', 'kpi-info', 'kpi-danger'];
    const values = [num(s.orders || 0), num(s.delivered || 0), money(s.spentPaise || 0, { decimals: 0 }), num(s.wishlist || 0)];
    const labels = ['Orders placed', 'Delivered', 'Total spent', 'Wishlist items'];
    $$('[data-account-stats] .kpi').forEach((card, i) => {
      card.innerHTML = html`
        <div class="kpi-head"><span class="kpi-ico ${tones[i]}">${raw(icon(icons[i]))}</span></div>
        <div class="kpi-label">${labels[i]}</div>
        <div class="kpi-value">${values[i]}</div>`;
    });
  }).catch(() => {});

  /* -------------------------------------------------------- profile form */
  $('[data-profile-form]').addEventListener('submit', (e) => {
    e.preventDefault();
    const form = e.currentTarget;
    const btn = form.querySelector('[type="submit"]');
    const { values, errors, valid } = readForm(form, {
      name: [validators.required, validators.minLen(3)],
      phone: [validators.required, validators.phone],
    });
    paintErrors(form, errors);
    if (!valid) return;
    withButtonState(btn, async () => {
      const data = await Api.saveProfile({ name: values.name, phone: values.phone });
      auth.user = { ...auth.user, ...data.user };
      renderAccountChip();
      toastSuccess('Profile saved.');
    });
  });

  $('[data-resend]')?.addEventListener('click', async (e) => {
    await withButtonState(e.currentTarget, async () => {
      await Api.resendVerification();
      toastSuccess('Verification email sent.');
    });
  });

  /* ---------------------------------------------------- change password */
  $('[data-change-password]')?.addEventListener('click', () => {
    modal({
      title: 'Change password',
      description: 'For your security we ask for the current password. Other devices are signed out.',
      body: html`
        <form class="stack" data-password-form>
          <div class="field" data-field="currentPassword">
            <label class="label" for="cp-current">Current password</label>
            <input class="input" id="cp-current" name="currentPassword" type="password" autocomplete="current-password" data-autofocus/>
            <span class="error-text" data-error></span>
          </div>
          <div class="field" data-field="password">
            <label class="label" for="cp-new">New password</label>
            <input class="input" id="cp-new" name="password" type="password" autocomplete="new-password"/>
            <span class="hint">At least 8 characters.</span>
            <span class="error-text" data-error></span>
          </div>
          <div class="field" data-field="confirmPassword">
            <label class="label" for="cp-confirm">Confirm new password</label>
            <input class="input" id="cp-confirm" name="confirmPassword" type="password" autocomplete="new-password"/>
            <span class="error-text" data-error></span>
          </div>
        </form>`,
      footer: html`<button type="button" class="btn btn-secondary" data-close>Cancel</button><button type="button" class="btn btn-primary" data-save-password data-label="Update password">Update password</button>`,
      onMount: ({ root, close }) => {
        $('[data-save-password]', root).addEventListener('click', async (e) => {
          const form = $('[data-password-form]', root);
          const { values, errors, valid } = readForm(form, {
            currentPassword: [validators.required],
            password: [validators.required, validators.password],
            confirmPassword: [validators.required, validators.sameAs('password')],
          });
          paintErrors(form, errors);
          if (!valid) return;
          await withButtonState(e.currentTarget, async () => {
            try {
              const res = await Api.saveProfile(values);
              toastSuccess(res.message || 'Password updated.');
              close();
            } catch (err) {
              toastError(friendlyMessage(err), { title: 'Could not update the password' });
              if (/current password/i.test(err.message)) paintErrors(form, { currentPassword: err.message });
            }
          });
        });
      },
    });
  });

  /* ------------------------------------------------------- addresses */
  const addressHost = $('[data-address-list]');
  const loadAddresses = async () => {
    setLoading(addressHost, true, '<div class="skeleton sk-card" style="height:120px"></div>');
    const list = await Api.addresses().catch(() => []);
    setLoading(addressHost, false);
    if (!list.length) {
      addressHost.innerHTML = emptyState({ icon: 'map-pin', title: 'No saved addresses', message: 'Add one to check out faster next time.', action: { label: 'Add address', onClick: () => openAddressForm() }, small: true });
      return;
    }
    addressHost.innerHTML = list.map((a) => html`
      <article class="address-card ${a.isDefault ? 'is-primary' : ''}">
        <div class="row row-between">
          <strong class="ink">${a.label}${a.isDefault ? html` <span class="badge badge-brand" style="margin-left:6px">Default</span>` : ''}</strong>
          <div class="row" style="gap:2px">
            <button type="button" class="icon-btn" data-edit-address="${a.id}" aria-label="Edit address">${raw(icon('edit'))}</button>
            <button type="button" class="icon-btn" data-del-address="${a.id}" aria-label="Delete address">${raw(icon('trash'))}</button>
          </div>
        </div>
        <p class="muted text-sm mt-2">${a.name} · ${a.phone}<br/>${a.line1}<br/>${a.city}, ${a.state} — ${a.pincode}</p>
        ${!a.isDefault ? html`<button type="button" class="btn btn-ghost btn-sm mt-3" data-default-address="${a.id}">Make default</button>` : ''}
      </article>`).join('');
    bindAddressActions(list);
  };

  const bindAddressActions = (list) => {
    $$('[data-del-address]', addressHost).forEach((btn) => btn.addEventListener('click', async () => {
      const yes = await confirmDialog({ title: 'Delete this address?', message: 'It will be removed from your saved addresses.', confirmLabel: 'Delete', danger: true });
      if (!yes) return;
      await Api.deleteAddress(btn.dataset.delAddress);
      toast('Address deleted.', { type: 'info', duration: 2000 });
      loadAddresses();
    }));
    $$('[data-default-address]', addressHost).forEach((btn) => btn.addEventListener('click', async () => {
      const a = list.find((x) => x.id === btn.dataset.defaultAddress);
      await Api.updateAddress(a.id, { ...a, isDefault: true });
      toastSuccess('Default address updated.');
      loadAddresses();
    }));
    $$('[data-edit-address]', addressHost).forEach((btn) => btn.addEventListener('click', () => {
      openAddressForm(list.find((x) => x.id === btn.dataset.editAddress));
    }));
  };

  const openAddressForm = (existing = null) => {
    modal({
      title: existing ? 'Edit address' : 'Add a new address',
      body: html`
        <form class="stack" data-address-form>
          <div class="field" data-field="label">
            <label class="label" for="ad-label">Label</label>
            <input class="input" id="ad-label" name="label" value="${existing?.label || 'Home'}" maxlength="30" data-autofocus/>
          </div>
          <div class="form-grid">
            <div class="field" data-field="name">
              <label class="label" for="ad-name">Recipient name</label>
              <input class="input" id="ad-name" name="name" value="${existing?.name || auth.user.name || ''}"/>
              <span class="error-text" data-error></span>
            </div>
            <div class="field" data-field="phone">
              <label class="label" for="ad-phone">Mobile</label>
              <input class="input" id="ad-phone" name="phone" value="${existing?.phone || auth.user.phone || ''}" inputmode="numeric"/>
              <span class="error-text" data-error></span>
            </div>
          </div>
          <div class="field" data-field="line1">
            <label class="label" for="ad-line1">Address</label>
            <textarea class="textarea" id="ad-line1" name="line1" rows="2">${existing?.line1 || ''}</textarea>
            <span class="error-text" data-error></span>
          </div>
          <div class="form-grid">
            <div class="field" data-field="city"><label class="label" for="ad-city">City</label><input class="input" id="ad-city" name="city" value="${existing?.city || ''}"/><span class="error-text" data-error></span></div>
            <div class="field" data-field="state"><label class="label" for="ad-state">State</label><input class="input" id="ad-state" name="state" value="${existing?.state || ''}"/><span class="error-text" data-error></span></div>
            <div class="field" data-field="pincode"><label class="label" for="ad-pin">Pincode</label><input class="input" id="ad-pin" name="pincode" value="${existing?.pincode || ''}" inputmode="numeric" maxlength="6"/><span class="error-text" data-error></span></div>
          </div>
          <label class="check"><input type="checkbox" name="isDefault" ${existing?.isDefault ? 'checked' : !existing ? 'checked' : ''}/><span class="box">${raw(icon('check'))}</span><span class="text">Use as my default address</span></label>
        </form>`,
      footer: html`<button type="button" class="btn btn-secondary" data-close>Cancel</button><button type="button" class="btn btn-primary" data-save-address>${existing ? 'Save changes' : 'Add address'}</button>`,
      onMount: ({ root, close }) => {
        $('[data-save-address]', root).addEventListener('click', async (e) => {
          const btn = e.currentTarget;
          const form = $('[data-address-form]', root);
          const { values, errors, valid } = readForm(form, {
            name: [validators.required, validators.minLen(3)],
            phone: [validators.required, validators.phone],
            line1: [validators.required, validators.minLen(8)],
            city: [validators.required],
            state: [validators.required],
            pincode: [validators.required, validators.pincode],
          });
          paintErrors(form, errors);
          if (!valid) return;
          await withButtonState(btn, async () => {
            const payload = { ...values, isDefault: !!values.isDefault };
            if (existing) await Api.updateAddress(existing.id, payload);
            else await Api.addAddress(payload);
            toastSuccess(existing ? 'Address updated.' : 'Address saved.');
            close();
            loadAddresses();
          });
        });
      },
    });
  };

  $('[data-add-address]').addEventListener('click', () => openAddressForm());
  loadAddresses();

  /* ---------------------------------------------------- notifications */
  const notifHost = $('[data-notif-list]');
  const loadNotifs = async () => {
    setLoading(notifHost, true, '<div class="skeleton sk-row"></div><div class="skeleton sk-row"></div>');
    const data = await refreshNotifications({ silent: true }).catch(() => null);
    setLoading(notifHost, false);
    renderNotificationCenter(notifHost, data?.items || []);
  };
  $('[data-mark-read]').addEventListener('click', async (e) => {
    await withButtonState(e.currentTarget, async () => {
      await markRead([]);
      toast('All notifications marked as read.', { type: 'success', duration: 2000 });
      loadNotifs();
    });
  });
  loadNotifs();

  // Deep links: account.html#addresses scrolls to that section.
  if (globalThis.location.hash) {
    const target = $(globalThis.location.hash);
    if (target) setTimeout(() => target.scrollIntoView({ behavior: 'smooth', block: 'start' }), 250);
  }
}

/* ============================================================== wishlist */

export async function wishlist() {
  const vendor = await boot('wishlist');
  if (!vendor) return;
  const host = $('[data-store-host]');
  document.title = `Wishlist · ${vendor.name}`;

  if (!isSignedIn()) {
    host.innerHTML = `<div class="container section">${emptyState({ icon: 'heart', title: 'Sign in to see your wishlist', message: 'Saved products stay with your account across every store.', action: { label: 'Sign in', href: url('login.html') } })}</div>`;
    return;
  }

  host.innerHTML = html`
    <div class="container section-sm">
      <div class="page-head mb-6">
        <div><h1>My Wishlist</h1><p class="sub" data-wish-count>Loading saved products…</p></div>
      </div>
      <div class="account-layout">
        ${accountNav('wishlist', vendor)}
        <div data-wishlist><div class="skeleton sk-card" style="height:180px"></div></div>
      </div>
    </div>`;

  const listHost = $('[data-wishlist]');
  setLoading(listHost, true, `<div class="wishlist-grid">${Array.from({ length: 4 }, () => '<div class="skeleton sk-card" style="height:230px"></div>').join('')}</div>`);

  const items = await Api.wishlist().catch(() => []);
  setLoading(listHost, false);
  $('[data-wish-count]').textContent = items.length ? `${num(items.length)} saved product${items.length === 1 ? '' : 's'}` : 'Nothing saved yet';

  if (!items.length) {
    listHost.innerHTML = emptyState({ icon: 'heart', title: 'Your wishlist is empty', message: `Tap the heart on any product in ${vendor.name} to save it here.`, action: { label: 'Browse products', href: url(`vendor/category.html?vendor=${vendor.slug}`) } });
    return;
  }

  listHost.innerHTML = `<div class="wishlist-grid">${items.map((it) => {
    const p = it.product;
    const v = it.vendor || vendor;
    const mrp = Number(p.mrpPaise || p.pricePaise);
    const off = mrp > p.pricePaise ? Math.round(((mrp - p.pricePaise) / mrp) * 100) : 0;
    return html`
      <article class="product-card">
        <div class="pc-media">
          <a href="${url(`vendor/product.html?vendor=${v.slug}&id=${p.id}`)}">
            ${p.image ? html`<img src="${url(String(p.image).replace(/^\//, ''))}" alt="${p.name}" loading="lazy" width="280" height="280"/>` : '<span class="thumb"></span>'}
          </a>
          ${off ? html`<span class="pc-badge badge-danger">${off}% off</span>` : ''}
          ${p.stock > 0 ? '' : html`<span class="pc-badge badge-dark">Out of stock</span>`}
          <div class="pc-quick"><button type="button" class="icon-btn is-liked" data-remove-wish="${it.id}" aria-label="Remove from wishlist">${raw(icon('heart'))}</button></div>
        </div>
        <div class="pc-body">
          <span class="pc-store">${v.name}</span>
          <a class="pc-name clamp-2" href="${url(`vendor/product.html?vendor=${v.slug}&id=${p.id}`)}">${p.name}</a>
          ${priceBlock(p)}
          <div class="pc-foot">
            ${ratingStars(p.rating, { size: 'stars-sm' })}
            <button type="button" class="btn btn-sm btn-primary" data-add-cart="${p.id}" ${p.stock > 0 ? '' : 'disabled'}>${raw(icon('cart'))} Add</button>
          </div>
        </div>
      </article>`;
  }).join('')}</div>`;

  $$('[data-remove-wish]', listHost).forEach((btn) => btn.addEventListener('click', async () => {
    const card = btn.closest('.product-card');
    await Api.removeWishlist(btn.dataset.removeWish);
    card.style.opacity = '0.35';
    card.style.transform = 'scale(0.97)';
    setTimeout(() => { card.remove(); if (!$$('.product-card', listHost).length) globalThis.location.reload(); }, 220);
    toast('Removed from your wishlist.', { type: 'info', duration: 2000 });
  }));

  // Add-to-cart from the wishlist needs the product's own store.
  listHost.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-add-cart]');
    if (!btn) return;
    const item = items.find((it) => it.product.id === btn.dataset.addCart);
    if (!item) return;
    const targetSlug = item.vendor?.slug || vendor.slug;
    if (targetSlug !== vendor.slug) {
      cart.bind(targetSlug).add(item.product, 1);
      toast(`${item.product.name} added to the ${item.vendor.name} cart.`, {
        type: 'success',
        action: { label: 'View cart', onClick: () => (globalThis.location.href = url(`vendor/cart.html?vendor=${targetSlug}`)) },
      });
      return;
    }
    cart.add(item.product, 1);
    toastSuccess(`${item.product.name} added to your cart.`);
  });
}

export default { orders, orderDetail, account, wishlist };
