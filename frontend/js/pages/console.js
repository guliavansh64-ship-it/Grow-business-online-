/**
 * pages/console.js — the platform (super admin) console: admin.growbusinessonline.com
 *
 * Oversight only. Approving a deposit, releasing a payout or suspending a store
 * always goes through the API, which re-checks the role on the server (spec §30,
 * §47). Hiding these pages from a vendor is a convenience, never the control.
 */
import Api, { friendlyMessage } from '../api.js';
import cfg from '../config.js';
import { guard, state as auth } from '../auth.js';
import { mountDashboardChrome, ADMIN_SIDEBAR, paintDashboardIdentity } from '../layout.js';
import { $, $$, url, html, raw, esc, money, num, compactNumber, dateShort, dateTime, timeAgo, debounce, qget, setQuery } from '../utils.js';
import { readForm, paintErrors, validators } from '../utils.js';
import { icon } from '../icons.js';
import { toast, toastSuccess, toastError, withButtonState, emptyState, setLoading, modal, confirmDialog } from '../ui.js';
import { lineChart, donutChart, hBars, compactMoney } from '../charts.js';
import { table, paginationBar, statusBadge, ORDER_TONE, PAYMENT_TONE, VENDOR_TONE, DEPOSIT_TONE, WITHDRAWAL_TONE, kpiGrid, infoRow, statusFilterChips } from '../components.js';
import { startNotificationPolling, refreshNotifications } from '../notifications.js';

async function consolePage({ active, title, subtitle = '', actions = '' } = {}) {
  const st = await guard({ roles: ['super_admin'] });
  const shell = mountDashboardChrome({ active, title, subtitle, actions, nav: ADMIN_SIDEBAR, variant: 'console' });
  document.title = `${title} · Platform console | ${cfg.brand.shortName}`;
  paintDashboardIdentity(null, st.user, { commissionPercent: cfg.commissionPercent });
  paintConsoleCard();
  startNotificationPolling();
  return { auth: st, shell, scroll: $('[data-app-scroll]') };
}

/** The console has no single store, so the sidebar card shows platform totals. */
async function paintConsoleCard() {
  const card = $('[data-sb-store]');
  if (!card) return;
  try {
    const s = await Api.adminStats();
    card.innerHTML = html`
      <span class="avatar avatar-sm" style="background:var(--danger-soft);color:var(--danger)">${raw(icon('shield'))}</span>
      <div class="sb-store-meta">
        <strong>Platform</strong>
        <span class="badge badge-danger"><span class="dotmark"></span>Super admin</span>
      </div>`;
    const plan = $('[data-sb-commission]');
    if (plan) plan.textContent = `${s.commissionPercent ?? cfg.commissionPercent}%`;
    const viewStore = $('[data-view-store]');
    if (viewStore) {
      viewStore.href = url('index.html');
      viewStore.querySelector('span')?.replaceWith(Object.assign(document.createElement('span'), { textContent: 'Main site' }));
    }
  } catch {
    card.innerHTML = `<div class="sb-store-meta"><strong>Platform console</strong></div>`;
  }
}

/* ============================================================== overview */

export async function console() {
  const page = await consolePage({ active: 'console', title: 'Platform overview', subtitle: 'Every store, deposit and payout in one place' });
  const { scroll } = page;

  scroll.innerHTML = html`
    <div data-console-kpis>${kpiSkeleton(8)}</div>

    <div class="console-hero card card-pad mt-6">
      <div>
        <span class="eyebrow">${raw(icon('zap'))} Needs your attention</span>
        <h3 class="h3 mt-2">Review queue</h3>
        <p class="muted mt-2">Deposits waiting on a gateway callback, payouts waiting for approval and unread support messages.</p>
      </div>
      <div class="queue-grid" data-queue><div class="skeleton sk-row"></div></div>
    </div>

    <div class="dash-grid dash-main mt-6">
      <div class="card card-pad">
        <div class="chart-head"><div><h3 class="h4">Newest stores</h3><div class="sub">Recently registered vendors</div></div>
          <a class="btn btn-sm btn-ghost" href="${url('admin/vendors.html')}">All stores ${raw(icon('arrow-right'))}</a></div>
        <div data-console-vendors><div class="skeleton sk-row"></div></div>
      </div>
      <div class="stack">
        <div class="card card-pad">
          <div class="chart-head"><div><h3 class="h4">Store pipeline</h3><div class="sub">By lifecycle status</div></div></div>
          <div class="donut-wrap" data-console-donut></div>
        </div>
        <div class="card card-pad">
          <div class="chart-head"><div><h3 class="h4">Platform money</h3><div class="sub">Delivered orders only</div></div></div>
          <div data-console-money></div>
        </div>
      </div>
    </div>

    <div class="card mt-6">
      <div class="card-head"><div><h3 class="h4">Latest orders across all stores</h3><div class="sub">Read-only — vendors manage their own fulfilment</div></div>
        <a class="btn btn-sm btn-secondary" href="${url('admin/orders.html')}">View all ${raw(icon('arrow-right'))}</a></div>
      <div data-console-orders><div class="card-pad"><div class="skeleton sk-row"></div></div></div>
    </div>`;

  let s;
  try {
    s = await Api.adminStats();
  } catch (err) {
    scroll.innerHTML = emptyState({ icon: 'alert-triangle', title: 'Could not load platform stats', message: friendlyMessage(err), action: { label: 'Try again', href: url('admin/index.html') } });
    return;
  }

  $('[data-console-kpis]').innerHTML = kpiGrid([
    { label: 'Stores', value: num(s.vendors.total), sub: `${num(s.vendors.active)} live · ${num(s.vendors.pendingActivation)} activating`, icon: 'store', tone: 'brand' },
    { label: 'GMV', value: compactNumber(s.money.gmvPaise), sub: 'Delivered order value', icon: 'chart', tone: 'info' },
    { label: 'Commission earned', value: money(s.money.commissionPaise, { decimals: 0 }), sub: `${s.commissionPercent}% of GMV`, icon: 'percent', tone: 'success' },
    { label: 'Vendor payouts', value: money(s.money.vendorPayoutPaise, { decimals: 0 }), sub: 'Settled to stores', icon: 'wallet', tone: 'accent' },
    { label: 'Orders', value: num(s.orders.total), sub: `${num(s.orders.pending)} pending · ${num(s.orders.delivered)} delivered`, icon: 'receipt', tone: 'warning' },
    { label: 'Products', value: num(s.catalogue.products), sub: `${num(s.catalogue.customers)} customers`, icon: 'package', tone: 'brand' },
    { label: 'Deposits held', value: money(s.money.depositsHeldPaise, { decimals: 0 }), sub: 'Refundable', icon: 'shield-check', tone: 'success', href: url('admin/deposits.html') },
    { label: 'Payouts in review', value: money(s.money.pendingWithdrawalsPaise, { decimals: 0 }), sub: `${num(s.queue.withdrawals)} requests`, icon: 'banknote', tone: 'danger', href: url('admin/withdrawals.html') },
  ]);

  const queue = [
    { label: 'Deposits awaiting gateway', count: s.queue.deposits, icon: 'credit', href: 'admin/deposits.html?status=processing', tone: s.queue.deposits ? 'warning' : 'success' },
    { label: 'Payouts to approve', count: s.queue.withdrawals, icon: 'banknote', href: 'admin/withdrawals.html?status=pending', tone: s.queue.withdrawals ? 'danger' : 'success' },
    { label: 'New support messages', count: s.queue.messages, icon: 'message', href: 'admin/messages.html?status=new', tone: s.queue.messages ? 'warning' : 'success' },
    { label: 'Stores awaiting deposit', count: s.vendors.pendingDeposit, icon: 'clock', href: 'admin/vendors.html?status=pending_deposit', tone: 'info' },
  ];
  $('[data-queue]').innerHTML = queue.map((q) => html`
    <a class="queue-card" href="${url(q.href)}">
      <span class="q-ico ${q.tone === 'success' ? 'is-ok' : q.tone === 'danger' ? 'is-bad' : q.tone === 'warning' ? 'is-warn' : ''}">${raw(icon(q.icon))}</span>
      <span class="q-count ${q.count ? 'is-live' : ''}">${num(q.count)}</span>
      <span class="q-label">${q.label}</span>
      ${raw(icon('arrow-right', 'q-arrow'))}
    </a>`).join('');

  const donutHost = $('[data-console-donut]');
  const donutItems = [
    { name: 'Active', value: s.vendors.active },
    { name: 'Pending activation', value: s.vendors.pendingActivation },
    { name: 'Pending deposit', value: s.vendors.pendingDeposit },
    { name: 'Suspended', value: s.vendors.suspended },
  ].filter((i) => i.value > 0);
  donutChart(donutHost, donutItems, { centerLabel: 'Stores' });
  if (donutHost && !$('.donut-legend', donutHost)) {
    const colors = ['#16A34A', '#D97706', '#6D5EF6', '#DC2626'];
    const legend = document.createElement('div');
    legend.className = 'donut-legend';
    legend.innerHTML = donutItems.map((i, idx) => `<span><i style="background:${colors[idx % colors.length]}"></i>${esc(i.name)} · ${num(i.value)}</span>`).join('');
    donutHost.appendChild(legend);
  }

  $('[data-console-money]').innerHTML = html`
    ${infoRow('Gross merchandise value', money(s.money.gmvPaise, { decimals: 0 }))}
    ${infoRow('Platform commission', money(s.money.commissionPaise, { decimals: 0 }))}
    ${infoRow('Paid to stores', money(s.money.vendorPayoutPaise, { decimals: 0 }))}
    ${infoRow('Deposits held (refundable)', money(s.money.depositsHeldPaise, { decimals: 0 }))}
    ${infoRow('Payouts in review', money(s.money.pendingWithdrawalsPaise, { decimals: 0 }))}
    <p class="hint mt-3">Commission is applied server side when an order is delivered. Nothing on this page can change a store's balance.</p>`;

  // Newest stores + latest orders
  try {
    const vendors = await Api.paged('/admin/vendors', { limit: 6 });
    $('[data-console-vendors]').innerHTML = vendors.items.length
      ? table({
          columns: [
            {
              key: 'name',
              label: 'Store',
              render: (v) => html`<span class="cell-product">
                ${v.logo ? html`<img src="${url(String(v.logo).replace(/^\//, ''))}" alt="" width="38" height="38"/>` : '<span class="thumb thumb-empty"></span>'}
                <span class="meta"><span class="n">${v.name}</span><span class="s mono">${v.slug}.${cfg.rootDomain}</span></span></span>`,
            },
            { key: 'city', label: 'City', render: (v) => html`<span class="muted text-sm">${v.city || '—'}</span>` },
            { key: 'productCount', label: 'Products', align: 'right', render: (v) => num(v.productCount || 0) },
            { key: 'orderCount', label: 'Orders', align: 'right', render: (v) => num(v.orderCount || 0) },
            { key: 'status', label: 'Status', render: (v) => statusBadge(v.status, VENDOR_TONE) },
            { key: 'createdAt', label: 'Joined', render: (v) => html`<span class="muted text-sm">${dateShort(v.createdAt || v.joinedAt)}</span>` },
          ],
          rows: vendors.items,
          dense: true,
        })
      : emptyState({ icon: 'store', title: 'No stores registered yet', small: true });
  } catch {
    $('[data-console-vendors]').innerHTML = `<p class="muted text-sm">Could not load stores.</p>`;
  }

  try {
    const orders = await Api.paged('/admin/orders', { limit: 8 });
    $('[data-console-orders]').innerHTML = orders.items.length
      ? table({
          columns: [
            { key: 'orderNumber', label: 'Order', render: (o) => html`<span class="mono ink">${o.orderNumber}</span>` },
            { key: 'vendor', label: 'Store', render: (o) => html`<span class="text-sm">${o.vendorName || o.vendorSlug || '—'}</span>` },
            { key: 'customer', label: 'Customer', render: (o) => html`<span class="text-sm">${o.customerName || o.customer?.name || '—'}</span>` },
            { key: 'totalPaise', label: 'Amount', align: 'right', render: (o) => html`<strong class="ink">${money(o.totalPaise)}</strong>` },
            { key: 'commissionPaise', label: 'Commission', align: 'right', render: (o) => html`<span class="text-warning">${money(o.commissionPaise || 0)}</span>` },
            { key: 'status', label: 'Status', render: (o) => statusBadge(o.status, ORDER_TONE) },
            { key: 'paymentStatus', label: 'Payment', render: (o) => statusBadge(o.paymentStatus, PAYMENT_TONE) },
            { key: 'placedAt', label: 'Placed', render: (o) => html`<span class="muted text-sm">${timeAgo(o.placedAt)}</span>` },
          ],
          rows: orders.items,
          dense: true,
        })
      : `<div class="card-pad">${emptyState({ icon: 'receipt', title: 'No orders yet', small: true })}</div>`;
  } catch {
    $('[data-console-orders]').innerHTML = `<div class="card-pad"><p class="muted text-sm">Could not load orders.</p></div>`;
  }
}

const kpiSkeleton = (n) => `<div class="kpi-grid">${Array.from({ length: n }, () => `<div class="kpi"><div class="skeleton sk-text" style="width:50%"></div><div class="skeleton" style="height:26px;width:40%;border-radius:8px"></div></div>`).join('')}</div>`;

/* ================================================================ stores */

export async function vendors() {
  const page = await consolePage({ active: 'vendors', title: 'Stores', subtitle: 'Approve, suspend and configure every vendor' });
  const { scroll } = page;
  const state = { q: qget('q') || '', status: qget('status') || 'all', page: Number(qget('page') || 1) };

  scroll.innerHTML = html`
    <div class="card">
      <div class="card-pad pb-0">
        <div class="toolbar">
          <div class="toolbar-left"><div class="chip-row" data-vendor-statuses><span class="skeleton sk-text" style="width:260px"></span></div></div>
          <div class="toolbar-right">
            <form class="tb-search-form" data-search-form role="search">
              <div class="input-group">${raw(icon('search', 'ico'))}<input class="input" type="search" name="q" value="${state.q}" placeholder="Store name, slug, email or city…" aria-label="Search stores"/></div>
            </form>
          </div>
        </div>
      </div>
      <div data-vendor-table><div class="card-pad">${'<div class="skeleton sk-row"></div>'.repeat(5)}</div></div>
      <div class="card-pad pt-0"><div data-pagination></div></div>
    </div>`;

  const host = $('[data-vendor-table]');
  let rows = [];

  const load = async () => {
    setLoading(host, true, `<div class="card-pad">${'<div class="skeleton sk-row"></div>'.repeat(5)}</div>`);
    try {
      const res = await Api.paged('/admin/vendors', { q: state.q || undefined, status: state.status === 'all' ? '' : state.status, page: state.page, limit: 10 });
      rows = res.items;
      const statuses = res.meta.statuses || ['pending_deposit', 'pending_activation', 'active', 'suspended', 'rejected'];
      const counts = { all: res.pagination?.totalItems ?? rows.length };
      statuses.forEach((s) => { counts[s] = rows.filter((v) => v.status === s).length; });
      $('[data-vendor-statuses]').innerHTML = statusFilterChips(counts, state.status);
      $$('[data-vendor-statuses] [data-filter]').forEach((chip) => chip.addEventListener('click', (e) => {
        e.preventDefault();
        state.status = chip.dataset.filter;
        state.page = 1;
        setQuery({ status: state.status === 'all' ? null : state.status }, { replace: true });
        load();
      }));

      host.innerHTML = rows.length
        ? table({
            columns: [
              {
                key: 'name',
                label: 'Store',
                render: (v) => html`<span class="cell-product">
                  ${v.logo ? html`<img src="${url(String(v.logo).replace(/^\//, ''))}" alt="" width="40" height="40"/>` : '<span class="thumb thumb-empty"></span>'}
                  <span class="meta"><span class="n">${v.name}</span><span class="s mono">${v.slug}.${cfg.rootDomain}</span></span></span>`,
              },
              { key: 'owner', label: 'Owner', render: (v) => html`<span class="cell-user"><span class="meta"><span class="n">${v.ownerName || '—'}</span><span class="s">${v.email || '—'}</span></span></span>` },
              { key: 'city', label: 'Location', render: (v) => html`<span class="muted text-sm">${[v.city, v.state].filter(Boolean).join(', ') || '—'}</span>` },
              { key: 'productCount', label: 'Products', align: 'right', render: (v) => num(v.productCount || 0) },
              { key: 'orderCount', label: 'Orders', align: 'right', render: (v) => num(v.orderCount || 0) },
              { key: 'commissionPercent', label: 'Commission', align: 'right', render: (v) => html`<span class="badge badge-soft">${v.commissionPercent ?? cfg.commissionPercent}%</span>` },
              { key: 'status', label: 'Status', render: (v) => statusBadge(v.status, VENDOR_TONE) },
              {
                key: 'actions',
                label: '',
                align: 'right',
                render: (v) => html`<span class="table-actions">
                  <a class="icon-btn" href="${url(`vendor/index.html?vendor=${v.slug}`)}" target="_blank" rel="noopener" title="Open storefront">${raw(icon('external'))}</a>
                  <button type="button" class="icon-btn" data-manage="${v.id}" title="Manage store" aria-label="Manage store">${raw(icon('sliders'))}</button>
                </span>`,
              },
            ],
            rows,
            empty: 'No stores found.',
          })
        : `<div class="card-pad">${emptyState({ icon: 'store', title: state.q ? 'No stores match that search' : 'No stores yet', message: state.q ? 'Try a different name, slug or city.' : 'Vendor stores appear here as soon as they register.' })}</div>`;

      $('[data-pagination]').innerHTML = res.pagination ? paginationBar(res.pagination) : '';
      setLoading(host, false);

      $$('[data-manage]', host).forEach((btn) => btn.addEventListener('click', () => openVendorManager(rows.find((v) => v.id === btn.dataset.manage), load)));
    } catch (err) {
      setLoading(host, false);
      host.innerHTML = `<div class="card-pad">${emptyState({ icon: 'alert-triangle', title: 'Could not load stores', message: friendlyMessage(err) })}</div>`;
    }
  };

  function openVendorManager(v, onDone) {
    if (!v) return;
    modal({
      size: 'lg',
      title: v.name,
      description: `${v.slug}.${cfg.rootDomain} · joined ${dateShort(v.createdAt || v.joinedAt)}`,
      body: html`
        <div class="stack">
          <div class="mini-stats">
            <div class="ms"><span class="l">Products</span><span class="v">${num(v.productCount || 0)}</span></div>
            <div class="ms"><span class="l">Orders</span><span class="v">${num(v.orderCount || 0)}</span></div>
            <div class="ms"><span class="l">Rating</span><span class="v">${Number(v.rating || 0).toFixed(1)}</span></div>
            <div class="ms"><span class="l">Status</span><span class="v">${esc(String(v.status).replace(/_/g, ' '))}</span></div>
          </div>

          <form class="stack" data-vendor-form>
            <div class="field" data-field="status">
              <label class="label" for="vm-status">Store status</label>
              <div class="select-wrap">
                <select class="select" id="vm-status" name="status">
                  ${['pending_deposit', 'pending_activation', 'active', 'suspended', 'rejected'].map((s) => html`<option value="${s}" ${v.status === s ? 'selected' : ''}>${s.replace(/_/g, ' ')}</option>`)}
                </select>
                ${raw(icon('chevron-down', 'sel'))}
              </div>
              <span class="hint">Activating a store makes its subdomain public immediately.</span>
            </div>
            <div class="field" data-field="commissionPercent">
              <label class="label" for="vm-commission">Commission override (%)</label>
              <input class="input" id="vm-commission" name="commissionPercent" type="number" min="0" max="30" step="1" value="${v.commissionPercent ?? cfg.commissionPercent}"/>
              <span class="hint">Platform default is ${cfg.commissionPercent}%. Overrides apply to future orders only.</span>
              <span class="error-text" data-error></span>
            </div>
            <div class="field" data-field="suspensionReason">
              <label class="label" for="vm-reason">Note to the store owner <span class="opt">sent as a notification</span></label>
              <textarea class="textarea" id="vm-reason" name="suspensionReason" rows="2" maxlength="200" placeholder="e.g. Suspended pending KYC documents">${v.suspensionReason || ''}</textarea>
            </div>
          </form>

          <div class="alert alert-warning">${raw(icon('alert-triangle'))}
            <div class="a-body"><strong>This changes a live store</strong>The owner is notified, and the change is written to the audit ledger with your user id.</div>
          </div>

          <div class="grid g-2">
            <div>${infoRow('Owner email', v.email || '—')}</div>
            <div>${infoRow('Phone', v.phone || '—')}</div>
            <div>${infoRow('Business type', v.businessType || '—')}</div>
            <div>${infoRow('Balance (available)', money(v.balance?.availablePaise || 0, { decimals: 0 }))}</div>
          </div>
        </div>`,
      footer: html`
        <a class="btn btn-ghost" href="${url(`vendor/index.html?vendor=${v.slug}`)}" target="_blank" rel="noopener">${raw(icon('external'))} View storefront</a>
        <button type="button" class="btn btn-secondary" data-close>Cancel</button>
        <button type="button" class="btn btn-primary" data-save-vendor data-label="Save changes">Save changes</button>`,
      onMount: ({ root, close }) => {
        $('[data-save-vendor]', root).addEventListener('click', async (e) => {
          const form = $('[data-vendor-form]', root);
          const { values, errors, valid } = readForm(form, { commissionPercent: [validators.min(0)] });
          paintErrors(form, errors);
          if (!valid) return;
          await withButtonState(e.currentTarget, async () => {
            try {
              const res = await Api.updateAdminVendor(v.id, {
                status: values.status,
                commissionPercent: Number(values.commissionPercent),
                suspensionReason: values.suspensionReason,
              });
              toastSuccess(res.message || 'Store updated.');
              close();
              onDone();
            } catch (err2) {
              toastError(friendlyMessage(err2));
            }
          });
        });
      },
    });
  }

  $('[data-search-form]').addEventListener('submit', (e) => { e.preventDefault(); state.q = e.target.q.value.trim(); state.page = 1; load(); });
  $('[data-search-form] input').addEventListener('input', debounce((e) => { state.q = e.target.value.trim(); state.page = 1; setQuery({ q: state.q || null }, { replace: true }); load(); }, cfg.searchDebounceMs));
  $('[data-pagination]').addEventListener('click', (e) => {
    const link = e.target.closest('[data-page]');
    if (!link || link.getAttribute('aria-disabled') === 'true') return;
    e.preventDefault();
    state.page = Number(link.dataset.page);
    load();
  });

  await load();
}

/* ============================================================== deposits */

export async function deposits() {
  const page = await consolePage({ active: 'deposits', title: 'Security deposits', subtitle: '₹1,000 refundable deposits and their gateway status' });
  const { scroll } = page;
  const state = { status: qget('status') || 'all', page: 1 };

  scroll.innerHTML = html`
    <div class="card">
      <div class="card-pad pb-0">
        <div class="toolbar">
          <div class="toolbar-left"><div class="chip-row" data-deposit-chips><span class="skeleton sk-text" style="width:240px"></span></div></div>
          <div class="toolbar-right"><span class="muted text-sm">Gateway callbacks are the only source of truth.</span></div>
        </div>
      </div>
      <div data-deposit-table><div class="card-pad">${'<div class="skeleton sk-row"></div>'.repeat(5)}</div></div>
      <div class="card-pad pt-0"><div data-pagination></div></div>
    </div>`;

  const host = $('[data-deposit-table]');
  const CHIP_STATUSES = ['all', 'pending', 'processing', 'approved', 'rejected', 'refunded'];

  const load = async () => {
    setLoading(host, true, `<div class="card-pad">${'<div class="skeleton sk-row"></div>'.repeat(5)}</div>`);
    try {
      const res = await Api.paged('/admin/deposits', { status: state.status === 'all' ? '' : state.status, page: state.page, limit: 10 });
      const rows = res.items;
      $('[data-deposit-chips]').innerHTML = html`${CHIP_STATUSES.map((s) => html`<button type="button" class="chip ${state.status === s ? 'is-active' : ''}" data-deposit-status="${s}">${s === 'all' ? 'All' : s[0].toUpperCase() + s.slice(1)}${s === 'all' && res.pagination ? html` <span class="chip-count">${num(res.pagination.totalItems)}</span>` : ''}</button>`)}`;
      $$('[data-deposit-status]').forEach((chip) => chip.addEventListener('click', () => {
        state.status = chip.dataset.depositStatus;
        state.page = 1;
        setQuery({ status: state.status === 'all' ? null : state.status }, { replace: true });
        load();
      }));

      host.innerHTML = rows.length
        ? table({
            columns: [
              { key: 'vendor', label: 'Store', render: (d) => html`<span class="cell-product"><span class="meta"><span class="n">${d.vendor?.name || '—'}</span><span class="s mono">${d.vendor?.slug || ''}</span></span></span>` },
              { key: 'amountPaise', label: 'Amount', align: 'right', render: (d) => html`<strong class="ink">${money(d.amountPaise)}</strong>` },
              { key: 'reference', label: 'Reference', render: (d) => html`<span class="mono text-xs">${d.reference || '—'}</span>` },
              { key: 'method', label: 'Method', render: (d) => html`<span class="badge badge-outline">${(d.method || '—').toUpperCase()}</span>` },
              { key: 'status', label: 'Status', render: (d) => statusBadge(d.status, DEPOSIT_TONE) },
              { key: 'initiatedAt', label: 'Initiated', render: (d) => html`<span class="muted text-sm">${d.initiatedAt ? dateTime(d.initiatedAt) : '—'}</span>` },
              { key: 'confirmedAt', label: 'Confirmed', render: (d) => html`<span class="muted text-sm">${d.confirmedAt ? dateTime(d.confirmedAt) : '—'}</span>` },
              {
                key: 'actions',
                label: '',
                align: 'right',
                render: (d) => html`<span class="table-actions">
                  ${['pending', 'processing'].includes(d.status) ? html`<button type="button" class="btn btn-sm btn-success" data-deposit-action="approved" data-deposit-id="${d.id}">${raw(icon('check'))} Approve</button>` : ''}
                  ${['approved', 'pending', 'processing'].includes(d.status) ? html`<button type="button" class="btn btn-sm btn-ghost text-danger" data-deposit-action="refunded" data-deposit-id="${d.id}">${raw(icon('refresh'))} Refund</button>` : ''}
                  ${d.status !== 'rejected' ? html`<button type="button" class="icon-btn danger" data-deposit-action="rejected" data-deposit-id="${d.id}" title="Reject" aria-label="Reject">${raw(icon('x'))}</button>` : ''}
                </span>`,
              },
            ],
            rows,
            empty: 'No deposits.',
          })
        : `<div class="card-pad">${emptyState({ icon: 'shield-check', title: 'No deposits in this state', message: 'Deposits appear here when a vendor starts the payment flow.' })}</div>`;

      $('[data-pagination]').innerHTML = res.pagination ? paginationBar(res.pagination) : '';
      setLoading(host, false);

      $$('[data-deposit-action]', host).forEach((btn) => btn.addEventListener('click', async () => {
        const row = rows.find((d) => d.id === btn.dataset.depositId);
        const action = btn.dataset.depositAction;
        const isReject = action !== 'approved';
        let note = '';
        if (isReject) {
          note = await askNote({
            title: action === 'refunded' ? `Refund ${row.vendor?.name || 'this'} deposit?` : 'Reject this deposit?',
            message: action === 'refunded'
              ? 'The ₹1,000 is returned to the vendor and their store is suspended.'
              : 'The vendor is told the payment could not be verified and their store is marked rejected.',
            confirmLabel: action === 'refunded' ? 'Refund deposit' : 'Reject deposit',
          });
          if (note === null) return;
        } else {
          const yes = await confirmDialog({
            title: `Approve ${money(row.amountPaise)} for ${row.vendor?.name}?`,
            message: 'Only do this if the payment gateway confirms the money arrived. Approving starts the store activation window.',
            confirmLabel: 'Approve deposit',
          });
          if (!yes) return;
        }
        await withButtonState(btn, async () => {
          try {
            const res2 = await Api.updateDeposit(row.id, { status: action, note });
            toastSuccess(res2.message || `Deposit ${action}.`);
            load();
          } catch (err) {
            toastError(friendlyMessage(err));
          }
        });
      }));
    } catch (err) {
      setLoading(host, false);
      host.innerHTML = `<div class="card-pad">${emptyState({ icon: 'alert-triangle', title: 'Could not load deposits', message: friendlyMessage(err) })}</div>`;
    }
  };

  $('[data-pagination]').addEventListener('click', (e) => {
    const link = e.target.closest('[data-page]');
    if (!link || link.getAttribute('aria-disabled') === 'true') return;
    e.preventDefault();
    state.page = Number(link.dataset.page);
    load();
  });

  await load();
}

/* =========================================================== withdrawals */

export async function withdrawals() {
  const page = await consolePage({ active: 'withdrawals', title: 'Payouts', subtitle: 'Approve, pay or reject vendor withdrawal requests' });
  const { scroll } = page;
  const state = { status: qget('status') || 'all', page: 1 };

  scroll.innerHTML = html`
    <div class="card">
      <div class="card-pad pb-0">
        <div class="toolbar">
          <div class="toolbar-left"><div class="chip-row" data-withdrawal-chips><span class="skeleton sk-text" style="width:240px"></span></div></div>
          <div class="toolbar-right"><span class="muted text-sm">Available balances are re-derived on the server.</span></div>
        </div>
      </div>
      <div data-withdrawal-table><div class="card-pad">${'<div class="skeleton sk-row"></div>'.repeat(5)}</div></div>
      <div class="card-pad pt-0"><div data-pagination></div></div>
    </div>`;

  const host = $('[data-withdrawal-table]');
  const CHIPS = ['all', 'pending', 'processing', 'approved', 'paid', 'rejected', 'cancelled'];

  const load = async () => {
    setLoading(host, true, `<div class="card-pad">${'<div class="skeleton sk-row"></div>'.repeat(5)}</div>`);
    try {
      const res = await Api.paged('/admin/withdrawals', { status: state.status === 'all' ? '' : state.status, page: state.page, limit: 10 });
      const rows = res.items;
      $('[data-withdrawal-chips]').innerHTML = html`${CHIPS.map((s) => html`<button type="button" class="chip ${state.status === s ? 'is-active' : ''}" data-wd-status="${s}">${s === 'all' ? 'All' : s[0].toUpperCase() + s.slice(1)}</button>`)}`;
      $$('[data-wd-status]').forEach((chip) => chip.addEventListener('click', () => {
        state.status = chip.dataset.wdStatus;
        state.page = 1;
        setQuery({ status: state.status === 'all' ? null : state.status }, { replace: true });
        load();
      }));

      host.innerHTML = rows.length
        ? table({
            columns: [
              { key: 'vendor', label: 'Store', render: (w) => html`<span class="cell-product"><span class="meta"><span class="n">${w.vendor?.name || '—'}</span><span class="s mono">${w.vendor?.slug || ''}</span></span></span>` },
              { key: 'amountPaise', label: 'Amount', align: 'right', render: (w) => html`<strong class="ink">${money(w.amountPaise)}</strong>` },
              { key: 'method', label: 'Method', render: (w) => html`<span class="badge badge-outline">${(w.method || '').toUpperCase()}</span>` },
              { key: 'account', label: 'Payout to', render: (w) => html`<span class="mono text-xs">${w.method === 'upi' ? w.account : `${w.account || ''}${w.ifsc ? ` · ${w.ifsc}` : ''}`}</span><span class="muted text-xs" style="display:block">${w.holder || ''}</span>` },
              { key: 'status', label: 'Status', render: (w) => statusBadge(w.status, WITHDRAWAL_TONE) },
              { key: 'requestedAt', label: 'Requested', render: (w) => html`<span class="muted text-sm">${dateTime(w.requestedAt || w.createdAt)}</span>` },
              {
                key: 'actions',
                label: '',
                align: 'right',
                render: (w) => html`<span class="table-actions">
                  ${w.status === 'pending' ? html`<button type="button" class="btn btn-sm btn-primary" data-wd-action="approved" data-wd-id="${w.id}">${raw(icon('check'))} Approve</button>` : ''}
                  ${w.status === 'approved' ? html`<button type="button" class="btn btn-sm btn-success" data-wd-action="paid" data-wd-id="${w.id}">${raw(icon('banknote'))} Mark paid</button>` : ''}
                  ${['pending', 'processing', 'approved'].includes(w.status) ? html`<button type="button" class="icon-btn danger" data-wd-action="rejected" data-wd-id="${w.id}" title="Reject" aria-label="Reject">${raw(icon('x'))}</button>` : ''}
                </span>`,
              },
            ],
            rows,
            empty: 'No payouts.',
          })
        : `<div class="card-pad">${emptyState({ icon: 'banknote', title: 'No payout requests in this state', message: 'Vendor withdrawal requests appear here for review.' })}</div>`;

      $('[data-pagination]').innerHTML = res.pagination ? paginationBar(res.pagination) : '';
      setLoading(host, false);

      $$('[data-wd-action]', host).forEach((btn) => btn.addEventListener('click', async () => {
        const row = rows.find((w) => w.id === btn.dataset.wdId);
        const action = btn.dataset.wdAction;
        if (action === 'rejected') {
          const note = await askNote({ title: `Reject ${money(row.amountPaise)} for ${row.vendor?.name}?`, message: 'The reserved amount returns to their available balance and they are notified.', confirmLabel: 'Reject payout' });
          if (note === null) return;
          await withButtonState(btn, async () => {
            try {
              const r = await Api.updateWithdrawal(row.id, { status: action, note });
              toast(r.message || 'Payout rejected.', { type: 'info' });
              load();
            } catch (err) { toastError(friendlyMessage(err)); }
          });
          return;
        }
        const yes = await confirmDialog({
          title: action === 'paid' ? `Confirm ${money(row.amountPaise)} sent?` : `Approve ${money(row.amountPaise)} for ${row.vendor?.name}?`,
          message: action === 'paid'
            ? `Only mark this paid once the transfer has actually left your account to ${row.method === 'upi' ? row.account : `account ${row.account}`}.`
            : 'The amount stays reserved until you mark it paid.',
          confirmLabel: action === 'paid' ? 'Mark as paid' : 'Approve',
        });
        if (!yes) return;
        await withButtonState(btn, async () => {
          try {
            const r = await Api.updateWithdrawal(row.id, { status: action, reference: action === 'paid' ? `PAY_${Date.now().toString(36).toUpperCase()}` : undefined });
            toastSuccess(r.message || 'Payout updated.');
            load();
          } catch (err) { toastError(friendlyMessage(err)); }
        });
      }));
    } catch (err) {
      setLoading(host, false);
      host.innerHTML = `<div class="card-pad">${emptyState({ icon: 'alert-triangle', title: 'Could not load payouts', message: friendlyMessage(err) })}</div>`;
    }
  };

  $('[data-pagination]').addEventListener('click', (e) => {
    const link = e.target.closest('[data-page]');
    if (!link || link.getAttribute('aria-disabled') === 'true') return;
    e.preventDefault();
    state.page = Number(link.dataset.page);
    load();
  });

  await load();
}

/* ================================================================ orders */

export async function orders() {
  const page = await consolePage({ active: 'orders', title: 'All orders', subtitle: 'Platform-wide order oversight (read only)' });
  const { scroll } = page;
  const state = { q: qget('q') || '', status: qget('status') || 'all', page: Number(qget('page') || 1) };

  scroll.innerHTML = html`
    <div class="card">
      <div class="card-pad pb-0">
        <div class="toolbar">
          <div class="toolbar-left">
            <div class="chip-row" data-order-statuses>
              ${['all', 'pending', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled', 'refunded'].map((s) => html`<button type="button" class="chip ${state.status === s ? 'is-active' : ''}" data-order-status="${s}">${s === 'all' ? 'All' : s[0].toUpperCase() + s.slice(1)}</button>`)}
            </div>
          </div>
          <div class="toolbar-right">
            <form class="tb-search-form" data-search-form role="search">
              <div class="input-group">${raw(icon('search', 'ico'))}<input class="input" type="search" name="q" value="${state.q}" placeholder="Order number, store or customer…" aria-label="Search orders"/></div>
            </form>
          </div>
        </div>
      </div>
      <div data-order-table><div class="card-pad">${'<div class="skeleton sk-row"></div>'.repeat(6)}</div></div>
      <div class="card-pad pt-0"><div data-pagination></div></div>
    </div>`;

  const host = $('[data-order-table]');

  const load = async () => {
    setLoading(host, true, `<div class="card-pad">${'<div class="skeleton sk-row"></div>'.repeat(6)}</div>`);
    try {
      const res = await Api.paged('/admin/orders', { q: state.q || undefined, status: state.status === 'all' ? '' : state.status, page: state.page, limit: 12 });
      const rows = res.items;
      host.innerHTML = rows.length
        ? table({
            columns: [
              { key: 'orderNumber', label: 'Order', render: (o) => html`<span class="mono ink">${o.orderNumber}</span>` },
              { key: 'vendor', label: 'Store', render: (o) => html`<span class="text-sm">${o.vendorName || o.vendorSlug || '—'}</span>` },
              { key: 'customer', label: 'Customer', render: (o) => html`<span class="text-sm">${o.customerName || o.customer?.name || '—'}</span><span class="muted text-xs" style="display:block">${o.customerPhone || o.customer?.phone || ''}</span>` },
              { key: 'totalPaise', label: 'Amount', align: 'right', render: (o) => html`<strong class="ink">${money(o.totalPaise)}</strong>` },
              { key: 'commissionPaise', label: 'Commission', align: 'right', render: (o) => html`<span class="text-warning">${money(o.commissionPaise || 0)}</span>` },
              { key: 'status', label: 'Status', render: (o) => statusBadge(o.status, ORDER_TONE) },
              { key: 'paymentStatus', label: 'Payment', render: (o) => statusBadge(o.paymentStatus, PAYMENT_TONE) },
              { key: 'placedAt', label: 'Placed', render: (o) => html`<span class="muted text-sm">${dateShort(o.placedAt)}</span>` },
            ],
            rows,
            empty: 'No orders.',
          })
        : `<div class="card-pad">${emptyState({ icon: 'receipt', title: 'No orders match those filters', message: 'Try another status or clear the search.' })}</div>`;
      $('[data-pagination]').innerHTML = res.pagination ? paginationBar(res.pagination) : '';
      setLoading(host, false);
    } catch (err) {
      setLoading(host, false);
      host.innerHTML = `<div class="card-pad">${emptyState({ icon: 'alert-triangle', title: 'Could not load orders', message: friendlyMessage(err) })}</div>`;
    }
  };

  $$('[data-order-status]').forEach((chip) => chip.addEventListener('click', () => {
    $$('[data-order-status]').forEach((c) => c.classList.remove('is-active'));
    chip.classList.add('is-active');
    state.status = chip.dataset.orderStatus;
    state.page = 1;
    setQuery({ status: state.status === 'all' ? null : state.status }, { replace: true });
    load();
  }));
  $('[data-search-form]').addEventListener('submit', (e) => { e.preventDefault(); state.q = e.target.q.value.trim(); state.page = 1; load(); });
  $('[data-search-form] input').addEventListener('input', debounce((e) => { state.q = e.target.value.trim(); state.page = 1; load(); }, cfg.searchDebounceMs));
  $('[data-pagination]').addEventListener('click', (e) => {
    const link = e.target.closest('[data-page]');
    if (!link || link.getAttribute('aria-disabled') === 'true') return;
    e.preventDefault();
    state.page = Number(link.dataset.page);
    load();
  });

  await load();
}

/* ============================================================== messages */

export async function messages() {
  const page = await consolePage({ active: 'messages', title: 'Messages', subtitle: 'Support requests from vendors and visitors' });
  const { scroll } = page;
  const state = { status: qget('status') || 'all', page: 1 };

  scroll.innerHTML = html`
    <div class="card">
      <div class="card-pad pb-0">
        <div class="toolbar">
          <div class="toolbar-left">
            <div class="chip-row" data-message-chips>
              ${['all', 'new', 'read', 'replied', 'closed'].map((s) => html`<button type="button" class="chip ${state.status === s ? 'is-active' : ''}" data-message-status="${s}">${s === 'all' ? 'All' : s[0].toUpperCase() + s.slice(1)}${s === 'new' ? html` <span class="chip-count" data-new-count></span>` : ''}</button>`)}
            </div>
          </div>
        </div>
      </div>
      <div data-message-list><div class="card-pad">${'<div class="skeleton sk-row"></div>'.repeat(4)}</div></div>
      <div class="card-pad pt-0"><div data-pagination></div></div>
    </div>`;

  const host = $('[data-message-list]');

  const load = async () => {
    setLoading(host, true, `<div class="card-pad">${'<div class="skeleton sk-row"></div>'.repeat(4)}</div>`);
    try {
      const res = await Api.paged('/admin/messages', { status: state.status === 'all' ? '' : state.status, page: state.page, limit: 10 });
      const rows = res.items;
      host.innerHTML = rows.length
        ? `<div class="card-pad stack">${rows.map((m) => html`
            <article class="queue-card message-card ${m.status === 'new' ? 'is-unread' : ''}" data-message="${m.id}">
              <div class="row row-between row-wrap" style="gap:8px">
                <div>
                  <strong class="ink">${m.subject || '(no subject)'}</strong>
                  <span class="muted text-sm" style="display:block">${m.name} · ${m.email}${m.phone ? ` · ${m.phone}` : ''}</span>
                </div>
                <div class="row" style="gap:6px">
                  ${statusBadge(m.status, { new: 'badge-danger', read: 'badge-warning', replied: 'badge-info', closed: 'badge-success' })}
                  <span class="muted text-xs">${timeAgo(m.createdAt)}</span>
                </div>
              </div>
              <p class="muted text-sm mt-3">${m.message}</p>
              <div class="row mt-4" style="gap:8px;flex-wrap:wrap">
                <a class="btn btn-sm btn-secondary" href="mailto:${esc(m.email)}?subject=${encodeURIComponent(`Re: ${m.subject || ''}`)}">${raw(icon('mail'))} Reply by email</a>
                ${m.status === 'new' ? html`<button type="button" class="btn btn-sm btn-ghost" data-message-status-set="read" data-message-id="${m.id}">${raw(icon('eye'))} Mark read</button>` : ''}
                ${m.status !== 'replied' && m.status !== 'closed' ? html`<button type="button" class="btn btn-sm btn-primary" data-message-status-set="replied" data-message-id="${m.id}">${raw(icon('send'))} Mark replied</button>` : ''}
                ${m.status !== 'closed' ? html`<button type="button" class="btn btn-sm btn-success" data-message-status-set="closed" data-message-id="${m.id}">${raw(icon('check'))} Close</button>` : ''}
              </div>
            </article>`).join('')}</div>`
        : `<div class="card-pad">${emptyState({ icon: 'message', title: 'No messages here', message: 'Contact form submissions and vendor support tickets land here.' })}</div>`;

      const counts = res.meta.counts || {};
      const newChip = $('[data-new-count]');
      if (newChip) {
        newChip.textContent = num(counts.new || 0);
        newChip.classList.toggle('hidden', !counts.new);
      }
      $('[data-pagination]').innerHTML = res.pagination ? paginationBar(res.pagination) : '';
      setLoading(host, false);

      $$('[data-message-status-set]', host).forEach((btn) => btn.addEventListener('click', async () => {
        await withButtonState(btn, async () => {
          try {
            await Api.updateMessage(btn.dataset.messageId, { status: btn.dataset.messageStatusSet });
            toast('Message updated.', { type: 'success', duration: 2000 });
            load();
          } catch (err) { toastError(friendlyMessage(err)); }
        });
      }));
    } catch (err) {
      setLoading(host, false);
      host.innerHTML = `<div class="card-pad">${emptyState({ icon: 'alert-triangle', title: 'Could not load messages', message: friendlyMessage(err) })}</div>`;
    }
  };

  $$('[data-message-status]').forEach((chip) => chip.addEventListener('click', () => {
    $$('[data-message-status]').forEach((c) => c.classList.remove('is-active'));
    chip.classList.add('is-active');
    state.status = chip.dataset.messageStatus;
    state.page = 1;
    setQuery({ status: state.status === 'all' ? null : state.status }, { replace: true });
    load();
  }));
  $('[data-pagination]').addEventListener('click', (e) => {
    const link = e.target.closest('[data-page]');
    if (!link || link.getAttribute('aria-disabled') === 'true') return;
    e.preventDefault();
    state.page = Number(link.dataset.page);
    load();
  });

  await load();
}

/* --------------------------------------------------------------- helpers */

/** Confirm-with-note dialog. Resolves the note string, or null if dismissed. */
function askNote({ title, message, confirmLabel, label = 'Reason (shared with the vendor)' }) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (value) => { if (!settled) { settled = true; resolve(value); } };
    const m = modal({
      title,
      description: message,
      body: html`
        <div class="field" data-field="note">
          <label class="label" for="an-note">${label}</label>
          <textarea class="textarea" id="an-note" name="note" rows="3" maxlength="200" placeholder="Add context for the store owner…" data-autofocus></textarea>
        </div>`,
      footer: html`<button type="button" class="btn btn-secondary" data-close>Cancel</button><button type="button" class="btn btn-danger" data-confirm-note>${confirmLabel}</button>`,
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

export default { console, vendors, deposits, withdrawals, orders, messages };
