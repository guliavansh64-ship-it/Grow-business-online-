/**
 * pages/sales.js — vendor Orders, Order Detail and Customers (spec §22, §23).
 *
 * Status changes go through PATCH /vendor/orders/:id/status; the server owns the
 * legal transition map and every money side effect. The UI only offers the
 * transitions the server says are allowed.
 */
import Api, { friendlyMessage } from '../api.js';
import cfg from '../config.js';
import { $, $$, url, html, raw, esc, money, num, dateShort, dateTime, timeAgo, debounce, qget, setQuery } from '../utils.js';
import { readForm, paintErrors, validators } from '../utils.js';
import { icon } from '../icons.js';
import { toast, toastSuccess, toastError, withButtonState, emptyState, setLoading, modal, confirmDialog } from '../ui.js';
import { lineChart, hBars, compactMoney } from '../charts.js';
import { table, paginationBar, statusBadge, ORDER_TONE, PAYMENT_TONE, customerCell, trackingSteps, summaryRows, moneySplit, statusFilterChips, kpiGrid } from '../components.js';
import { dashPage } from './_dashBase.js';

const STATUS_LABELS = {
  pending: 'Placed', confirmed: 'Confirmed', processing: 'Processing',
  shipped: 'Shipped', out_for_delivery: 'Out for delivery', delivered: 'Delivered',
  cancelled: 'Cancelled', refunded: 'Refunded',
};

const NEXT_ACTION = {
  pending: { to: 'confirmed', label: 'Confirm order', icon: 'check-circle', variant: 'btn-success' },
  confirmed: { to: 'processing', label: 'Start processing', icon: 'package', variant: 'btn-primary' },
  processing: { to: 'shipped', label: 'Mark shipped', icon: 'truck', variant: 'btn-primary' },
  shipped: { to: 'out_for_delivery', label: 'Out for delivery', icon: 'bike', variant: 'btn-primary' },
  out_for_delivery: { to: 'delivered', label: 'Mark delivered', icon: 'check-circle', variant: 'btn-success' },
};

/* ================================================================ orders */

export async function orders() {
  const page = await dashPage({
    active: 'orders',
    title: 'Orders',
    subtitle: 'Confirm, pack, ship and settle',
    actions: html`<a class="btn btn-secondary btn-sm" href="${url('admin/customers.html')}">${raw(icon('users'))} Customers</a>`,
  });
  if (!page) return;
  const { scroll } = page;

  const state = {
    status: qget('status') || 'all',
    payment: qget('payment') || '',
    q: qget('q') || '',
    page: Number(qget('page') || 1),
    limit: 10,
  };

  scroll.innerHTML = html`
    <div data-order-kpis class="mb-6"></div>
    <div class="card">
      <div class="card-pad pb-0">
        <div class="toolbar">
          <div class="toolbar-left"><div class="chip-row" data-counts><span class="skeleton sk-text" style="width:280px"></span></div></div>
          <div class="toolbar-right">
            <form class="tb-search-form" data-search-form role="search">
              <div class="input-group">${raw(icon('search', 'ico'))}<input class="input" type="search" name="q" value="${state.q}" placeholder="Order no, customer, phone, city…" aria-label="Search orders"/></div>
            </form>
            <div class="select-wrap">
              <select class="select" data-payment-filter aria-label="Filter by payment status">
                <option value="">Any payment</option>
                <option value="pending" ${state.payment === 'pending' ? 'selected' : ''}>Payment pending</option>
                <option value="paid" ${state.payment === 'paid' ? 'selected' : ''}>Paid</option>
                <option value="refunded" ${state.payment === 'refunded' ? 'selected' : ''}>Refunded</option>
              </select>
              ${raw(icon('chevron-down', 'sel'))}
            </div>
          </div>
        </div>
      </div>
      <div data-order-table><div class="card-pad">${'<div class="skeleton sk-row"></div>'.repeat(6)}</div></div>
      <div class="card-pad pt-0"><div data-pagination></div></div>
    </div>`;

  const host = $('[data-order-table]');
  let items = [];

  const load = async () => {
    setLoading(host, true, `<div class="card-pad">${'<div class="skeleton sk-row"></div>'.repeat(6)}</div>`);
    try {
      const res = await Api.paged('/vendor/orders', {
        status: state.status === 'all' ? '' : state.status,
        paymentStatus: state.payment || undefined,
        q: state.q || undefined,
        page: state.page,
        limit: state.limit,
      });
      items = res.items;
      const counts = res.meta.counts || {};

      $('[data-counts]').innerHTML = statusFilterChips(counts, state.status);
      $$('[data-counts] [data-filter]').forEach((chip) => chip.addEventListener('click', (e) => {
        e.preventDefault();
        state.status = chip.dataset.filter;
        state.page = 1;
        setQuery({ status: state.status === 'all' ? null : state.status, page: null }, { replace: true });
        load();
      }));

      const pending = counts.pending || 0;
      $('[data-order-kpis]').innerHTML = kpiGrid([
        { label: 'Total orders', value: num(counts.all || 0), sub: 'All time', icon: 'receipt', tone: 'brand' },
        { label: 'Awaiting confirmation', value: num(pending), sub: pending ? 'Confirm these first' : 'All caught up', icon: 'clock', tone: pending ? 'warning' : 'success', href: pending ? url('admin/orders.html?status=pending') : null },
        { label: 'In fulfilment', value: num((counts.confirmed || 0) + (counts.processing || 0) + (counts.shipped || 0) + (counts.out_for_delivery || 0)), sub: 'Confirmed → out for delivery', icon: 'package', tone: 'info' },
        { label: 'Delivered', value: num(counts.delivered || 0), sub: `${num(counts.cancelled || 0)} cancelled`, icon: 'check-circle', tone: 'success' },
      ]);

      if (!items.length) {
        host.innerHTML = `<div class="card-pad">${emptyState({
          icon: 'receipt',
          title: state.status === 'all' && !state.q ? 'No orders yet' : 'No orders match these filters',
          message: state.status === 'all' && !state.q
            ? 'As soon as a customer checks out, the order lands here and you get a notification.'
            : 'Try a different status, or clear the search.',
          action: state.status === 'all' && !state.q ? { label: 'View your store', href: url(`vendor/index.html?vendor=${page.vendor.slug}`), variant: 'btn-secondary' } : { label: 'Clear filters', onClick: () => { setQuery({}, { replace: true }); globalThis.location.reload(); } },
        })}</div>`;
        $('[data-pagination]').innerHTML = '';
        setLoading(host, false);
        return;
      }

      host.innerHTML = table({
        columns: [
          { key: 'orderNumber', label: 'Order ID', render: (o) => html`<a class="mono ink" href="${url(`admin/order-detail.html?id=${o.id}`)}">${o.orderNumber}</a><span class="muted text-xs" style="display:block">${timeAgo(o.placedAt)}</span>` },
          { key: 'customer', label: 'Customer', render: (o) => customerCell(o) },
          { key: 'items', label: 'Products', render: (o) => html`<span class="muted text-sm clamp-1" style="max-width:220px">${esc((o.items || []).map((i) => `${i.qty}× ${i.name}`).join(', '))}</span>` },
          { key: 'totalPaise', label: 'Amount', align: 'right', render: (o) => html`<strong class="ink">${money(o.totalPaise)}</strong><span class="muted text-xs" style="display:block">You get ${money(o.vendorPaise)}</span>` },
          { key: 'status', label: 'Status', render: (o) => statusBadge(o.status, ORDER_TONE) },
          { key: 'paymentStatus', label: 'Payment', render: (o) => html`${statusBadge(o.paymentStatus, PAYMENT_TONE)}<span class="muted text-xs" style="display:block">${(o.paymentMethod || '').toUpperCase()}</span>` },
          { key: 'placedAt', label: 'Date', render: (o) => html`<span class="muted text-sm">${dateShort(o.placedAt)}</span>` },
          {
            key: 'actions',
            label: '',
            align: 'right',
            render: (o) => {
              const next = NEXT_ACTION[o.status];
              return html`<span class="table-actions">
                ${next ? html`<button type="button" class="btn btn-sm ${next.variant}" data-advance="${o.id}" data-to="${next.to}">${raw(icon(next.icon))} ${next.label}</button>` : ''}
                <a class="icon-btn" href="${url(`admin/order-detail.html?id=${o.id}`)}" title="Open" aria-label="Open order">${raw(icon('eye'))}</a>
              </span>`;
            },
          },
        ],
        rows: items,
        empty: 'No orders.',
      });
      $('[data-pagination]').innerHTML = res.pagination ? paginationBar(res.pagination) : '';
      setLoading(host, false);

      $$('[data-advance]', host).forEach((btn) => btn.addEventListener('click', (e) => {
        e.stopPropagation();
        advanceStatus(items.find((o) => o.id === btn.dataset.advance), btn.dataset.to, btn, load);
      }));
      $$('tbody tr', host).forEach((row) => {
        row.classList.add('is-clickable');
        row.addEventListener('click', (e) => {
          if (e.target.closest('a, button')) return;
          const link = row.querySelector('a[href*="order-detail"]');
          if (link) globalThis.location.href = link.href;
        });
      });
    } catch (err) {
      setLoading(host, false);
      host.innerHTML = `<div class="card-pad">${emptyState({ icon: 'alert-triangle', title: 'Could not load orders', message: friendlyMessage(err) })}</div>`;
    }
  };

  $('[data-search-form]').addEventListener('submit', (e) => { e.preventDefault(); state.q = e.target.q.value.trim(); state.page = 1; load(); });
  $('[data-search-form] input').addEventListener('input', debounce((e) => { state.q = e.target.value.trim(); state.page = 1; setQuery({ q: state.q || null }, { replace: true }); load(); }, cfg.searchDebounceMs));
  $('[data-payment-filter]').addEventListener('change', (e) => { state.payment = e.target.value; state.page = 1; setQuery({ payment: state.payment || null }, { replace: true }); load(); });
  $('[data-pagination]').addEventListener('click', (e) => {
    const link = e.target.closest('[data-page]');
    if (!link || link.getAttribute('aria-disabled') === 'true') return;
    e.preventDefault();
    state.page = Number(link.dataset.page);
    setQuery({ page: state.page > 1 ? state.page : null }, { replace: true });
    load();
    globalThis.scrollTo({ top: 0, behavior: 'smooth' });
  });

  await load();
}

/* ------------------------------------------------- shared status mutation */

async function advanceStatus(order, to, button, onDone) {
  if (!order) return;
  const isCancel = to === 'cancelled' || to === 'refunded';
  let note = '';
  if (isCancel) {
    const reason = await promptNote({
      title: to === 'refunded' ? `Refund ${order.orderNumber}?` : `Cancel ${order.orderNumber}?`,
      message: to === 'refunded'
        ? 'The customer is refunded through their original payment method. Stock is returned to your catalogue.'
        : 'The customer is told the order was cancelled and any paid amount is refunded.',
      label: 'Reason (shared with the customer)',
      placeholder: 'e.g. Customer requested cancellation',
      confirmLabel: to === 'refunded' ? 'Refund order' : 'Cancel order',
      danger: true,
    });
    if (reason === null) return;
    note = reason;
  } else if (to === 'delivered') {
    const okToSettle = await confirmDialog({
      title: `Mark ${order.orderNumber} delivered?`,
      message: `This settles ${money(order.vendorPaise)} to your available balance after the ${cfg.commissionPercent}% platform commission (${money(order.commissionPaise)}). Cash-on-delivery is also marked as paid.`,
      confirmLabel: 'Yes, it was delivered',
    });
    if (!okToSettle) return;
  }

  await withButtonState(button, async () => {
    try {
      const res = await Api.setOrderStatus(order.id, to, note);
      toastSuccess(res.message || `Order marked ${String(to).replace(/_/g, ' ')}.`);
      onDone();
    } catch (err) {
      toastError(friendlyMessage(err), { title: 'Could not update the order' });
      onDone();
    }
  });
}

/** Small modal that collects an optional note. Resolves null when dismissed. */
function promptNote({ title, message, label, placeholder, confirmLabel, danger = false }) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (value) => { if (!settled) { settled = true; resolve(value); } };
    const m = modal({
      title,
      description: message,
      body: html`
        <div class="field" data-field="note">
          <label class="label" for="nt-note">${label}</label>
          <textarea class="textarea" id="nt-note" name="note" rows="3" maxlength="200" placeholder="${placeholder}" data-autofocus></textarea>
        </div>`,
      footer: html`
        <button type="button" class="btn btn-secondary" data-close>Cancel</button>
        <button type="button" class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-confirm-note>${confirmLabel}</button>`,
      onMount: ({ root }) => {
        $('[data-confirm-note]', root).addEventListener('click', () => {
          done($('[name="note"]', root).value.trim());
          m.close();
        });
      },
      onClose: () => done(null),
    });
  });
}

/* =========================================================== order detail */

export async function orderDetail() {
  const page = await dashPage({ active: 'orders', title: 'Order details', subtitle: '' });
  if (!page) return;
  const { scroll, vendor } = page;
  const id = qget('id') || qget('number');
  if (!id) {
    globalThis.location.replace(url('admin/orders.html'));
    return;
  }

  scroll.innerHTML = `<div class="skeleton sk-card" style="height:200px"></div><div class="skeleton sk-card mt-4" style="height:280px"></div>`;

  let data;
  try {
    data = await Api.vendorOrder(id);
  } catch (err) {
    scroll.innerHTML = emptyState({ icon: 'receipt', title: 'Order not found', message: friendlyMessage(err), action: { label: 'Back to orders', href: url('admin/orders.html') } });
    return;
  }

  const { order, customer, split, allowedStatuses } = data;
  const next = NEXT_ACTION[order.status];
  document.title = `${order.orderNumber} · Orders · ${vendor.name}`;
  $('[data-app-title]') && ($('[data-app-title]').textContent = `Order ${order.orderNumber}`);

  scroll.innerHTML = html`
    <nav class="breadcrumb mb-4" aria-label="Breadcrumb">
      <a href="${url('admin/orders.html')}">Orders</a>${raw(icon('chevron-right', 'sep'))}<span class="current mono">${order.orderNumber}</span>
    </nav>

    <div class="detail-grid">
      <div class="stack">
        <div class="card card-pad">
          <div class="row row-wrap row-between" style="gap:12px">
            <div>
              <span class="eyebrow">Order</span>
              <h2 class="mono mt-1" style="letter-spacing:-0.02em">${order.orderNumber}</h2>
              <p class="muted text-sm mt-2">Placed ${dateTime(order.placedAt)} · updated ${timeAgo(order.updatedAt)}</p>
            </div>
            <div class="row" style="gap:8px;flex-wrap:wrap">
              ${statusBadge(order.status, ORDER_TONE)}
              ${statusBadge(order.paymentStatus, PAYMENT_TONE)}
              ${order.paymentMethod === 'cod' ? html`<span class="badge badge-outline">${raw(icon('banknote'))} Cash on delivery</span>` : html`<span class="badge badge-outline">${(order.paymentMethod || '').toUpperCase()}</span>`}
            </div>
          </div>

          <div class="status-flow mt-6">
            ${trackingSteps(order.status)}
          </div>

          <div class="row mt-6" style="gap:8px;flex-wrap:wrap">
            ${next ? html`<button type="button" class="btn ${next.variant}" data-advance="${next.to}">${raw(icon(next.icon))} ${next.label}</button>` : ''}
            ${['pending', 'confirmed', 'processing'].includes(order.status)
              ? html`<button type="button" class="btn btn-danger" data-advance="cancelled">${raw(icon('x-circle'))} Cancel order</button>` : ''}
            ${order.status === 'delivered'
              ? html`<button type="button" class="btn btn-secondary" data-advance="refunded">${raw(icon('refresh'))} Refund order</button>` : ''}
            <button type="button" class="btn btn-ghost" data-print>${raw(icon('printer'))} Print invoice</button>
            <a class="btn btn-ghost" href="${url('admin/orders.html')}">${raw(icon('arrow-left'))} All orders</a>
          </div>
          ${!next && !['cancelled', 'refunded'].includes(order.status) && order.status !== 'delivered'
            ? html`<p class="hint mt-3">No further status change is allowed from “${STATUS_LABELS[order.status] || order.status}”.</p>` : ''}
        </div>

        <div class="card card-pad">
          <div class="card-head" style="padding:0 0 var(--sp-4);margin-bottom:var(--sp-4)">
            <div><h3 class="h4">Items</h3><div class="sub">${num(order.lines.reduce((a, l) => a + l.qty, 0))} units</div></div>
          </div>
          <div class="order-lines">
            ${order.lines.map((l) => html`
              <div class="ol">
                ${l.image ? html`<img src="${url(String(l.image).replace(/^\//, ''))}" alt="" width="52" height="52" loading="lazy"/>` : '<span class="thumb thumb-empty"></span>'}
                <div class="ol-body">
                  <strong class="ink text-sm">${l.name}</strong>
                  <span class="muted text-xs">${l.qty} × ${money(l.unitPricePaise)}${l.discountPaise ? ` · saved ${money(l.discountPaise)}` : ''}</span>
                </div>
                <strong class="ink">${money(l.grossPaise)}</strong>
              </div>`)}
          </div>
          <div class="divider"></div>
          ${summaryRows([
            { label: 'Subtotal', value: money(order.subtotalPaise) },
            order.discountPaise ? { label: 'Discount', value: `− ${money(order.discountPaise)}`, tone: 'is-discount' } : null,
            { label: 'Delivery fee', value: order.deliveryFeePaise ? money(order.deliveryFeePaise) : 'Free', tone: order.deliveryFeePaise ? '' : 'is-discount' },
            order.taxPaise ? { label: 'Tax', value: money(order.taxPaise) } : null,
            { label: 'Order total', value: money(order.totalPaise), strong: true },
          ], { wrap: false })}
        </div>

        <div class="card card-pad">
          <div class="card-head" style="padding:0 0 var(--sp-4);margin-bottom:var(--sp-4)">
            <div><h3 class="h4">Settlement</h3><div class="sub">Calculated by the server on delivery</div></div>
          </div>
          ${moneySplit({ grossPaise: split.grossPaise, commissionPaise: split.commissionPaise, vendorPaise: split.vendorPaise, percent: split.commissionPercent })}
          <div class="alert alert-info mt-4">${raw(icon('lock'))}
            <div class="a-body">Commission and payouts are settled server side. Editing this page cannot change what you are paid.</div>
          </div>
        </div>
      </div>

      <div class="stack">
        <div class="card card-pad">
          <h3 class="h4 mb-4">Customer</h3>
          <div class="row">
            <span class="avatar">${esc((order.customer?.name || 'G').slice(0, 1).toUpperCase())}</span>
            <div class="grow">
              <strong class="ink">${order.customer?.name || 'Guest'}</strong>
              <span class="muted text-sm" style="display:block">${order.customer?.guest ? 'Guest checkout' : 'Registered customer'}</span>
            </div>
          </div>
          <div class="mt-4">
            <div class="info-row"><span>${raw(icon('phone'))} Mobile</span><strong><a href="tel:${String(order.customer?.phone || '').replace(/\s/g, '')}">${order.customer?.phone || '—'}</a></strong></div>
            <div class="info-row"><span>${raw(icon('mail'))} Email</span><strong>${order.customer?.email || '—'}</strong></div>
            ${customer ? html`<div class="info-row"><span>${raw(icon('receipt'))} Lifetime orders</span><strong>${num(customer.orders || 0)}</strong></div>
              <div class="info-row"><span>${raw(icon('rupee'))} Lifetime spend</span><strong>${money(customer.spentPaise || 0, { decimals: 0 })}</strong></div>` : ''}
          </div>
          ${order.customer?.phone ? html`<a class="btn btn-secondary btn-block mt-4" href="https://wa.me/${String(order.customer.phone).replace(/\D/g, '')}?text=${encodeURIComponent(`Hi ${order.customer.name}, an update about your order ${order.orderNumber} from ${vendor.name}:`)}" target="_blank" rel="noopener">${raw(icon('message'))} Message on WhatsApp</a>` : ''}
        </div>

        <div class="card card-pad">
          <h3 class="h4 mb-4">Delivery address</h3>
          <p class="ink">${order.shipping?.address || '—'}</p>
          <p class="muted text-sm mt-1">${order.shipping?.city}, ${order.shipping?.state} — ${order.shipping?.pincode}<br/>${order.shipping?.country || 'India'}</p>
          ${order.notes ? html`<div class="alert alert-warning mt-4">${raw(icon('sticky-note'))}<div class="a-body"><strong>Customer note</strong>${order.notes}</div></div>` : ''}
          ${order.deliveryEta ? html`<div class="info-row mt-4"><span>${raw(icon('truck'))} Estimated delivery</span><strong>${dateShort(order.deliveryEta)}</strong></div>` : ''}
        </div>

        <div class="card card-pad">
          <h3 class="h4 mb-4">Timeline</h3>
          <div class="timeline">
            ${[...(order.timeline || [])].reverse().map((t, i) => html`
              <div class="tl-item ${i === 0 ? 'is-current' : ''}">
                <span class="tl-dot"></span>
                <div><strong class="ink">${t.note || STATUS_LABELS[t.status] || t.status}</strong><span class="muted text-xs" style="display:block">${dateTime(t.at)}</span></div>
              </div>`)}
          </div>
        </div>
      </div>
    </div>`;

  $$('[data-advance]', scroll).forEach((btn) => btn.addEventListener('click', () => advanceStatus(order, btn.dataset.advance, btn, async () => {
    const fresh = await Api.vendorOrder(order.id).catch(() => null);
    if (fresh) {
      globalThis.location.reload();
    }
  })));

  $('[data-print]')?.addEventListener('click', () => globalThis.print());
}

/* ============================================================== customers */

export async function customers() {
  const page = await dashPage({
    active: 'customers',
    title: 'Customers',
    subtitle: 'Everyone who has bought from your store',
  });
  if (!page) return;
  const { scroll } = page;

  const state = { q: qget('q') || '', page: Number(qget('page') || 1), limit: 10 };

  scroll.innerHTML = html`
    <div data-customer-kpis class="mb-6"></div>
    <div class="card">
      <div class="card-pad pb-0">
        <div class="toolbar">
          <div class="toolbar-left"><span class="muted text-sm" data-customer-count>Loading customers…</span></div>
          <div class="toolbar-right">
            <form class="tb-search-form" data-search-form role="search">
              <div class="input-group">${raw(icon('search', 'ico'))}<input class="input" type="search" name="q" value="${state.q}" placeholder="Name, email, phone or city…" aria-label="Search customers"/></div>
            </form>
          </div>
        </div>
      </div>
      <div data-customer-table><div class="card-pad">${'<div class="skeleton sk-row"></div>'.repeat(6)}</div></div>
      <div class="card-pad pt-0"><div data-pagination></div></div>
    </div>`;

  const host = $('[data-customer-table]');

  const load = async () => {
    setLoading(host, true, `<div class="card-pad">${'<div class="skeleton sk-row"></div>'.repeat(6)}</div>`);
    try {
      const res = await Api.paged('/vendor/customers', { q: state.q || undefined, page: state.page, limit: state.limit });
      const rows = res.items;
      $('[data-customer-count]').textContent = `${num(res.pagination?.totalItems ?? rows.length)} customer${(res.pagination?.totalItems ?? rows.length) === 1 ? '' : 's'}`;

      const spent = rows.reduce((a, c) => a + (c.spentPaise || 0), 0);
      $('[data-customer-kpis]').innerHTML = kpiGrid([
        { label: 'Customers', value: num(res.pagination?.totalItems ?? rows.length), sub: 'Across all orders', icon: 'users', tone: 'brand' },
        { label: 'Repeat buyers', value: num(rows.filter((c) => (c.orders || 0) > 1).length), sub: 'On this page', icon: 'refresh', tone: 'success' },
        { label: 'Revenue (page)', value: money(spent, { decimals: 0 }), sub: 'Lifetime spend shown', icon: 'rupee', tone: 'info' },
        { label: 'Avg orders', value: rows.length ? (rows.reduce((a, c) => a + (c.orders || 0), 0) / rows.length).toFixed(1) : '0', sub: 'Per customer', icon: 'chart', tone: 'accent' },
      ]);

      if (!rows.length) {
        host.innerHTML = `<div class="card-pad">${emptyState({
          icon: 'users',
          title: state.q ? 'No customers match that search' : 'No customers yet',
          message: state.q ? 'Try a different name, phone number or city.' : 'Your customer list grows with every completed order.',
          action: state.q ? { label: 'Clear search', onClick: () => { setQuery({}, { replace: true }); globalThis.location.reload(); } } : null,
        })}</div>`;
        $('[data-pagination]').innerHTML = '';
        setLoading(host, false);
        return;
      }

      host.innerHTML = table({
        columns: [
          {
            key: 'name',
            label: 'Customer',
            render: (c) => html`<span class="cell-user"><span class="avatar avatar-sm">${esc((c.name || 'C').slice(0, 1).toUpperCase())}</span>
              <span class="meta"><span class="n">${c.name}</span><span class="s">${c.email || 'No email'}</span></span></span>`,
          },
          { key: 'phone', label: 'Mobile', render: (c) => html`<a class="mono text-sm" href="tel:${String(c.phone || '').replace(/\s/g, '')}">${c.phone || '—'}</a>` },
          { key: 'city', label: 'City', render: (c) => html`<span class="muted text-sm">${c.city || '—'}</span>` },
          { key: 'orders', label: 'Orders', align: 'right', render: (c) => html`<span class="badge badge-soft">${num(c.orders || 0)}</span>` },
          { key: 'spentPaise', label: 'Lifetime spend', align: 'right', render: (c) => html`<strong class="ink">${money(c.spentPaise || 0, { decimals: 0 })}</strong>` },
          {
            key: 'actions',
            label: '',
            align: 'right',
            render: (c) => html`<span class="table-actions">
              ${c.phone ? html`<a class="icon-btn" href="https://wa.me/${String(c.phone).replace(/\D/g, '')}" target="_blank" rel="noopener" title="WhatsApp">${raw(icon('message'))}</a>` : ''}
              <button type="button" class="icon-btn" data-view-customer="${c.id}" title="View orders" aria-label="View orders">${raw(icon('receipt'))}</button>
            </span>`,
          },
        ],
        rows,
        empty: 'No customers.',
      });
      $('[data-pagination]').innerHTML = res.pagination ? paginationBar(res.pagination) : '';
      setLoading(host, false);

      $$('[data-view-customer]', host).forEach((btn) => btn.addEventListener('click', () => {
        const c = rows.find((x) => x.id === btn.dataset.viewCustomer);
        showCustomerOrders(c);
      }));
    } catch (err) {
      setLoading(host, false);
      host.innerHTML = `<div class="card-pad">${emptyState({ icon: 'alert-triangle', title: 'Could not load customers', message: friendlyMessage(err) })}</div>`;
    }
  };

  async function showCustomerOrders(c) {
    if (!c) return;
    const m = modal({
      size: 'lg',
      title: c.name,
      description: `${c.email || 'No email'} · ${c.phone || 'No phone'}${c.city ? ` · ${c.city}` : ''}`,
      body: html`<div data-customer-orders><div class="skeleton sk-row"></div><div class="skeleton sk-row"></div></div>`,
      footer: html`<button type="button" class="btn btn-secondary" data-close>Close</button>`,
      onMount: async ({ root }) => {
        const hostEl = $('[data-customer-orders]', root);
        try {
          const res = await Api.paged('/vendor/orders', { q: c.phone || c.name, limit: 20 });
          const rows = res.items;
          hostEl.innerHTML = rows.length
            ? html`
              <div class="mini-stats mb-4">
                <div class="ms"><span class="l">Orders</span><span class="v">${num(c.orders || rows.length)}</span></div>
                <div class="ms"><span class="l">Lifetime spend</span><span class="v">${money(c.spentPaise || 0, { decimals: 0 })}</span></div>
                <div class="ms"><span class="l">Last order</span><span class="v">${rows[0] ? dateShort(rows[0].placedAt) : '—'}</span></div>
              </div>
              ${table({
                columns: [
                  { key: 'orderNumber', label: 'Order', render: (o) => html`<a class="mono ink" href="${url(`admin/order-detail.html?id=${o.id}`)}">${o.orderNumber}</a>` },
                  { key: 'placedAt', label: 'Date', render: (o) => dateShort(o.placedAt) },
                  { key: 'totalPaise', label: 'Amount', align: 'right', render: (o) => money(o.totalPaise) },
                  { key: 'status', label: 'Status', render: (o) => statusBadge(o.status, ORDER_TONE) },
                ],
                rows,
                dense: true,
              })}`
            : emptyState({ icon: 'receipt', title: 'No orders found', message: 'This customer has not ordered from your store yet.', small: true });
        } catch (err) {
          hostEl.innerHTML = emptyState({ icon: 'alert-triangle', title: 'Could not load orders', message: friendlyMessage(err), small: true });
        }
      },
    });
    void m;
  }

  $('[data-search-form]').addEventListener('submit', (e) => { e.preventDefault(); state.q = e.target.q.value.trim(); state.page = 1; load(); });
  $('[data-search-form] input').addEventListener('input', debounce((e) => { state.q = e.target.value.trim(); state.page = 1; setQuery({ q: state.q || null }, { replace: true }); load(); }, cfg.searchDebounceMs));
  $('[data-pagination]').addEventListener('click', (e) => {
    const link = e.target.closest('[data-page]');
    if (!link || link.getAttribute('aria-disabled') === 'true') return;
    e.preventDefault();
    state.page = Number(link.dataset.page);
    setQuery({ page: state.page > 1 ? state.page : null }, { replace: true });
    load();
  });

  await load();
}

export default { orders, orderDetail, customers };
