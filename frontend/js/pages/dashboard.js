/**
 * pages/dashboard.js — vendor Dashboard, Analytics and Notifications.
 *
 * Every number on these screens comes from the API. The browser never computes
 * commission, revenue or balance (spec §24, §47) — it only formats and draws.
 */
import Api, { friendlyMessage } from '../api.js';
import cfg from '../config.js';
import { $, $$, url, html, raw, esc, money, num, compactNumber, dateShort, dateTime, timeAgo, qget, setQuery } from '../utils.js';
import { icon } from '../icons.js';
import { toast, toastSuccess, emptyState, setLoading, withButtonState } from '../ui.js';
import { lineChart, barChart, donutChart, hBars, sparkline, moneyFormat, compactMoney } from '../charts.js';
import { kpiCard, kpiGrid, table, statusBadge, ORDER_TONE, PAYMENT_TONE, customerCell, paginationBar, statusFilterChips } from '../components.js';
import { dashPage } from './_dashBase.js';
import { refreshNotifications, renderNotificationCenter, markRead, notificationKind } from '../notifications.js';

/* ============================================================= dashboard */

export async function dashboard() {
  const page = await dashPage({
    active: 'dashboard',
    title: 'Dashboard',
    subtitle: 'Your store at a glance',
    actions: html`
      <a class="btn btn-secondary btn-sm tb-view-store" href="${url('vendor/index.html')}" target="_blank" rel="noopener">${raw(icon('external'))} <span>View store</span></a>
      <a class="btn btn-primary btn-sm" href="${url('admin/products.html')}?new=1">${raw(icon('plus'))} Add product</a>`,
  });
  if (!page) return;
  const { vendor, scroll } = page;

  const days = Number(qget('days') || 14);
  scroll.innerHTML = html`
    <div data-alerts></div>
    <div data-kpis>${kpiSkeleton(8)}</div>
    <div class="dash-grid dash-main mt-6">
      <div class="chart-box card card-pad">
        <div class="chart-head">
          <div><h3>Sales &amp; orders</h3><div class="sub" data-range-label>Loading last ${days} days…</div></div>
          <div class="chip-row" data-range>
            ${[7, 14, 30, 90].map((d) => html`<button type="button" class="chip ${d === days ? 'is-active' : ''}" data-days="${d}">${d}d</button>`)}
          </div>
        </div>
        <div data-chart-sales><div class="skeleton" style="height:220px"></div></div>
        <div class="mt-4" data-chart-orders></div>
      </div>
      <div class="stack">
        <div class="chart-box card card-pad">
          <div class="chart-head"><div><h3>Order status</h3><div class="sub">All time</div></div></div>
          <div class="donut-wrap" data-chart-status><div class="skeleton" style="height:180px;width:180px;border-radius:50%"></div></div>
        </div>
        <div class="chart-box card card-pad">
          <div class="chart-head"><div><h3>Payment methods</h3><div class="sub">Share of orders</div></div></div>
          <div data-chart-payments><div class="skeleton sk-row"></div></div>
        </div>
      </div>
    </div>

    <div class="dash-grid dash-2 mt-6">
      <div class="card card-pad">
        <div class="card-head" style="padding:0 0 var(--sp-4);margin-bottom:var(--sp-4)">
          <div><h3 class="h4">Top products</h3><div class="sub">By revenue, all time</div></div>
          <a class="btn btn-sm btn-ghost" href="${url('admin/products.html')}">Manage ${raw(icon('arrow-right'))}</a>
        </div>
        <div data-top-products><div class="skeleton sk-row"></div><div class="skeleton sk-row"></div></div>
      </div>
      <div class="card card-pad">
        <div class="card-head" style="padding:0 0 var(--sp-4);margin-bottom:var(--sp-4)">
          <div><h3 class="h4">Money</h3><div class="sub">Server-settled balances</div></div>
          <a class="btn btn-sm btn-ghost" href="${url('admin/balance.html')}">Details ${raw(icon('arrow-right'))}</a>
        </div>
        <div data-money><div class="skeleton sk-row"></div><div class="skeleton sk-row"></div></div>
      </div>
    </div>

    <div class="card mt-6">
      <div class="card-head">
        <div><h3 class="h4">Recent orders</h3><div class="sub">Newest first</div></div>
        <a class="btn btn-sm btn-secondary" href="${url('admin/orders.html')}">View all orders ${raw(icon('arrow-right'))}</a>
      </div>
      <div data-recent-orders><div class="card-pad"><div class="skeleton sk-row"></div><div class="skeleton sk-row"></div><div class="skeleton sk-row"></div></div></div>
    </div>`;

  const load = async (d) => {
    setLoading($('[data-kpis]'), true, kpiSkeleton(8));
    let data;
    try {
      data = await Api.dashboard(d);
    } catch (err) {
      scroll.innerHTML = emptyState({ icon: 'alert-triangle', title: 'Could not load your dashboard', message: friendlyMessage(err), action: { label: 'Try again', href: url('admin/dashboard.html') } });
      return;
    }
    const k = data.kpis;

    /* ---------------------------------------------------------- alerts */
    const alerts = data.alerts || [];
    $('[data-alerts]').innerHTML = alerts.length
      ? alerts.map((a) => html`
          <div class="alert alert-${a.level === 'warning' ? 'warning' : 'brand'} mb-4">
            ${raw(icon(a.level === 'warning' ? 'alert-triangle' : 'info'))}
            <div class="a-body">
              <strong>${a.title}</strong>${a.body}
              ${a.link ? html`<div class="mt-2"><a class="btn btn-sm btn-secondary" href="${url(a.link.startsWith('admin/') ? a.link : `admin/${a.link}`)}">Take action</a></div>` : ''}
            </div>
          </div>`).join('')
      : '';

    /* ------------------------------------------------------------ KPIs */
    const spark = (data.charts.sales || []).map((p) => p.value);
    $('[data-kpis]').innerHTML = kpiGrid([
      { label: 'Total sales', value: money(k.totalSalesPaise, { decimals: 0 }), sub: `${num(k.completedOrders)} delivered orders`, icon: 'rupee', tone: 'brand', delta: data.growth?.ordersPercent ?? null, spark },
      { label: 'Total orders', value: num(k.totalOrders), sub: `Avg ${money(k.avgOrderValuePaise, { decimals: 0 })}`, icon: 'receipt', tone: 'info', href: url('admin/orders.html') },
      { label: 'Pending orders', value: num(k.pendingOrders), sub: k.pendingOrders ? 'Needs your confirmation' : 'Nothing waiting', icon: 'clock', tone: k.pendingOrders ? 'warning' : 'success', href: url('admin/orders.html?status=pending') },
      { label: 'Completed', value: num(k.completedOrders), sub: `${num(k.shippedOrders)} in transit`, icon: 'check-circle', tone: 'success' },
      { label: 'Customers', value: num(k.customers), sub: 'Unique buyers', icon: 'users', tone: 'accent', href: url('admin/customers.html') },
      { label: 'Products', value: num(k.products), sub: `${num(k.activeProducts)} live · ${num(k.outOfStock)} out of stock`, icon: 'package', tone: 'brand', href: url('admin/products.html') },
      { label: 'Available balance', value: money(k.availableBalancePaise, { decimals: 0 }), sub: `${money(k.pendingBalancePaise, { decimals: 0 })} pending`, icon: 'wallet', tone: 'success', href: url('admin/balance.html') },
      { label: 'Commission paid', value: money(k.commissionPaidPaise, { decimals: 0 }), sub: `${vendor.commissionPercent ?? cfg.commissionPercent}% of delivered orders`, icon: 'percent', tone: 'warning', href: url('admin/payments.html') },
    ]);

    /* ---------------------------------------------------------- charts */
    $('[data-range-label]').textContent = `Last ${d} days · ${num((data.charts.sales || []).reduce((a, p) => a + p.orders, 0))} orders`;
    lineChart($('[data-chart-sales]'), (data.charts.sales || []).map((p) => ({ label: p.label, value: p.value })), { format: compactMoney, valueLabel: 'Sales', height: 230 });
    barChart($('[data-chart-orders]'), (data.charts.orders || []).map((p) => ({ label: p.label, value: p.orders ?? p.value })), { format: (v) => num(v), valueLabel: 'Orders', height: 130, color: 'var(--accent)' });

    const statusItems = (data.charts.statusBreakdown || []).map((s) => ({ name: String(s.status).replace(/_/g, ' '), value: s.count }));
    const donutHost = $('[data-chart-status]');
    donutChart(donutHost, statusItems, { centerLabel: 'Orders', format: (v) => num(v) });
    if (donutHost && !$('.donut-legend', donutHost)) {
      const legend = document.createElement('div');
      legend.className = 'donut-legend';
      legend.innerHTML = statusItems.map((s, i) => `<span><i style="background:${DONUT_COLORS[i % DONUT_COLORS.length]}"></i>${esc(s.name)} · ${num(s.value)}</span>`).join('');
      donutHost.appendChild(legend);
    }

    hBars($('[data-chart-payments]'), (data.charts.paymentSplit || []).map((p) => ({ name: p.method.toUpperCase(), value: p.count })), { format: (v) => `${num(v)} orders` });

    /* ---------------------------------------------------- top products */
    const top = data.topProducts || [];
    $('[data-top-products]').innerHTML = top.length
      ? top.map((p, i) => html`
          <div class="top-product">
            <span class="tp-rank">${i + 1}</span>
            ${p.image ? html`<img src="${url(String(p.image).replace(/^\//, ''))}" alt="" width="46" height="46" loading="lazy"/>` : '<span class="thumb thumb-empty"></span>'}
            <div class="tp-body">
              <a class="nm" href="${url(`admin/products.html?edit=${p.productId}`)}">${p.name}</a>
              <span class="tp-meta">${num(p.units)} sold</span>
            </div>
            <div class="tp-right"><span class="tp-val">${money(p.revenuePaise, { decimals: 0 })}</span></div>
          </div>`).join('')
      : emptyState({ icon: 'package', title: 'No sales yet', message: 'Your best sellers will appear here after the first delivered order.', small: true });

    /* ----------------------------------------------------------- money */
    $('[data-money]').innerHTML = html`
      <div class="mini-stats">
        <div class="ms"><span class="l">Earned</span><span class="v">${money(k.earnedPaise, { decimals: 0 })}</span></div>
        <div class="ms"><span class="l">Pending</span><span class="v">${money(k.pendingBalancePaise, { decimals: 0 })}</span></div>
        <div class="ms"><span class="l">Withdrawn</span><span class="v">${money(k.withdrawnPaise, { decimals: 0 })}</span></div>
        <div class="ms"><span class="l">Commission</span><span class="v">${money(k.commissionPaidPaise, { decimals: 0 })}</span></div>
      </div>
      <div class="row mt-4" style="gap:8px;flex-wrap:wrap">
        <a class="btn btn-primary btn-sm" href="${url('admin/withdrawals.html')}">${raw(icon('banknote'))} Request payout</a>
        <a class="btn btn-ghost btn-sm" href="${url('admin/balance.html')}">${raw(icon('list'))} View ledger</a>
      </div>
      <p class="hint mt-3">${raw(icon('lock'))} Balances are calculated on the server from delivered orders. This page can only display them.</p>`;

    /* --------------------------------------------------- recent orders */
    const recent = data.recentOrders || [];
    $('[data-recent-orders]').innerHTML = recent.length
      ? table({
          columns: [
            { key: 'orderNumber', label: 'Order', render: (o) => html`<a class="mono ink" href="${url(`admin/order-detail.html?id=${o.id}`)}">${o.orderNumber}</a>` },
            { key: 'customer', label: 'Customer', render: (o) => customerCell(o) },
            { key: 'items', label: 'Items', render: (o) => html`<span class="muted text-sm">${num(o.itemCount)} · ${esc((o.items || []).map((i) => i.name).join(', ').slice(0, 46))}${(o.items || []).length > 2 ? '…' : ''}</span>` },
            { key: 'totalPaise', label: 'Amount', align: 'right', render: (o) => html`<strong class="ink">${money(o.totalPaise)}</strong>` },
            { key: 'status', label: 'Status', render: (o) => statusBadge(o.status, ORDER_TONE) },
            { key: 'paymentStatus', label: 'Payment', render: (o) => statusBadge(o.paymentStatus, PAYMENT_TONE) },
            { key: 'placedAt', label: 'Date', render: (o) => html`<span class="muted text-sm">${timeAgo(o.placedAt)}</span>` },
          ],
          rows: recent,
          rowAttr: (o) => `data-order-row="${o.id}"`,
          empty: 'No orders yet.',
        })
      : `<div class="card-pad">${emptyState({ icon: 'receipt', title: 'No orders yet', message: 'Orders appear here the moment a customer checks out.', action: { label: 'View your store', href: url(`vendor/index.html?vendor=${vendor.slug}`), variant: 'btn-secondary' }, small: true })}</div>`;

    $$('[data-order-row]').forEach((row) => {
      row.classList.add('is-clickable');
      row.addEventListener('click', (e) => {
        if (e.target.closest('a, button')) return;
        globalThis.location.href = url(`admin/order-detail.html?id=${row.dataset.orderRow}`);
      });
    });
  };

  $$('[data-range] .chip').forEach((chip) => chip.addEventListener('click', () => {
    $$('[data-range] .chip').forEach((c) => c.classList.remove('is-active'));
    chip.classList.add('is-active');
    setQuery({ days: chip.dataset.days }, { replace: true });
    load(Number(chip.dataset.days));
  }));

  await load(days);
}

const DONUT_COLORS = ['#6D5EF6', '#0EA5E9', '#16A34A', '#F59E0B', '#EC4899', '#14B8A6', '#8B5CF6', '#F97316'];

const kpiSkeleton = (n) => `<div class="kpi-grid">${Array.from({ length: n }, () => `<div class="kpi"><div class="kpi-head"><span class="skeleton" style="width:38px;height:38px;border-radius:12px"></span></div><div class="skeleton sk-text" style="width:60%"></div><div class="skeleton" style="height:26px;width:45%;border-radius:8px"></div></div>`).join('')}</div>`;

/* ============================================================= analytics */

export async function analytics() {
  const page = await dashPage({ active: 'analytics', title: 'Sales Analytics', subtitle: 'Trends, revenue and where your customers are' });
  if (!page) return;
  const { scroll } = page;
  const range = Number(qget('range') || 30);

  scroll.innerHTML = html`
    <div class="card card-pad mb-6">
      <div class="row row-between row-wrap" style="gap:12px">
        <div><h3 class="h4">Reporting period</h3><p class="sub">Charts are built from your order history on the server.</p></div>
        <div class="chip-row" data-range>
          ${[{ v: 7, l: 'Last 7 days' }, { v: 30, l: 'Last 30 days' }, { v: 90, l: 'Last 90 days' }].map((o) => html`<button type="button" class="chip ${o.v === range ? 'is-active' : ''}" data-range-value="${o.v}">${o.l}</button>`)}
        </div>
      </div>
    </div>
    <div data-analytics-kpis>${kpiSkeleton(6)}</div>
    <div class="dash-grid dash-main mt-6">
      <div class="chart-box card card-pad">
        <div class="chart-head"><div><h3>Gross sales</h3><div class="sub">Order value per day</div></div></div>
        <div data-chart-gross><div class="skeleton" style="height:230px"></div></div>
      </div>
      <div class="chart-box card card-pad">
        <div class="chart-head"><div><h3>Revenue by category</h3><div class="sub">All time</div></div></div>
        <div data-chart-category><div class="skeleton sk-row"></div></div>
      </div>
    </div>
    <div class="dash-grid dash-2 mt-6">
      <div class="chart-box card card-pad">
        <div class="chart-head"><div><h3>Your earnings</h3><div class="sub">After platform commission</div></div></div>
        <div data-chart-net><div class="skeleton" style="height:200px"></div></div>
      </div>
      <div class="chart-box card card-pad">
        <div class="chart-head"><div><h3>Commission paid</h3><div class="sub">Settled with the platform</div></div></div>
        <div data-chart-commission><div class="skeleton" style="height:200px"></div></div>
      </div>
    </div>
    <div class="dash-grid dash-2 mt-6">
      <div class="chart-box card card-pad">
        <div class="chart-head"><div><h3>Orders by city</h3><div class="sub">Top 8 delivery cities</div></div></div>
        <div data-chart-cities><div class="skeleton sk-row"></div></div>
      </div>
      <div class="card card-pad">
        <div class="chart-head"><div><h3>How the 5% split works</h3><div class="sub">Illustration only — real splits are server side</div></div></div>
        <div data-split-example></div>
      </div>
    </div>`;

  const load = async (r) => {
    setLoading($('[data-analytics-kpis]'), true, kpiSkeleton(6));
    let data;
    try {
      data = await Api.analytics(String(r));
    } catch (err) {
      $('[data-analytics-kpis]').innerHTML = emptyState({ icon: 'alert-triangle', title: 'Could not load analytics', message: friendlyMessage(err) });
      return;
    }
    const t = data.totals;
    $('[data-analytics-kpis]').innerHTML = kpiGrid([
      { label: 'Gross sales', value: money(t.revenuePaise, { decimals: 0 }), sub: `${num(t.orders)} orders`, icon: 'chart', tone: 'brand' },
      { label: 'Your earnings', value: money(t.vendorNetPaise, { decimals: 0 }), sub: 'After commission', icon: 'wallet', tone: 'success' },
      { label: 'Commission paid', value: money(t.commissionPaise, { decimals: 0 }), sub: `${page.vendor.commissionPercent ?? cfg.commissionPercent}% platform fee`, icon: 'percent', tone: 'warning' },
      { label: 'Avg order value', value: money(t.avgOrderValuePaise, { decimals: 0 }), sub: `${num(t.delivered)} delivered`, icon: 'receipt', tone: 'info' },
      { label: 'Fulfilment rate', value: `${num(t.fulfillmentRate)}%`, sub: `${num(t.cancelled)} cancelled`, icon: 'truck', tone: t.fulfillmentRate >= 80 ? 'success' : 'warning' },
      { label: 'Period', value: `${num(data.range)} days`, sub: 'Rolling window', icon: 'calendar', tone: 'accent' },
    ]);

    const map = (arr) => (arr || []).map((p) => ({ label: p.label, value: p.value }));
    lineChart($('[data-chart-gross]'), map(data.charts.sales), { format: compactMoney, valueLabel: 'Sales', height: 240 });
    lineChart($('[data-chart-net]'), map(data.charts.revenue), { format: compactMoney, valueLabel: 'Earnings', height: 200, color: 'var(--success)' });
    lineChart($('[data-chart-commission]'), map(data.charts.commission), { format: compactMoney, valueLabel: 'Commission', height: 200, color: 'var(--warning)' });
    hBars($('[data-chart-category]'), (data.charts.byCategory || []).map((c) => ({ name: c.name, value: c.valuePaise })), { format: (v) => money(v, { decimals: 0 }) });
    hBars($('[data-chart-cities]'), (data.charts.byCity || []).map((c) => ({ name: c.name, value: c.count })), { format: (v) => `${num(v)} orders` });

    $('[data-split-example]').innerHTML = html`
      <div class="split-card">
        <div class="split-row"><span>Customer pays</span><strong>${money(100000)}</strong></div>
        <div class="split-row is-fee"><span>Platform commission (${cfg.commissionPercent}%)</span><strong>− ${money(5000)}</strong></div>
        <div class="split-row is-net"><span>You receive</span><strong>${money(95000)}</strong></div>
      </div>
      <p class="hint mt-3">Commission is deducted only when an order is delivered, and it is settled by the server. There is nothing to configure in the browser.</p>
      <a class="btn btn-secondary btn-sm mt-4" href="${url('admin/balance.html')}">${raw(icon('wallet'))} See your real balance</a>`;
  };

  $$('[data-range-value]').forEach((chip) => chip.addEventListener('click', () => {
    $$('[data-range-value]').forEach((c) => c.classList.remove('is-active'));
    chip.classList.add('is-active');
    setQuery({ range: chip.dataset.rangeValue }, { replace: true });
    load(Number(chip.dataset.rangeValue));
  }));

  await load(range);
}

/* ========================================================= notifications */

export async function notifications() {
  const page = await dashPage({
    active: 'notifications',
    title: 'Notifications',
    subtitle: 'Orders, payments and platform updates',
    actions: html`<button type="button" class="btn btn-secondary btn-sm" data-mark-all>${raw(icon('check'))} Mark all read</button>`,
  });
  if (!page) return;
  const { scroll } = page;

  const filter = qget('filter') || 'all';
  scroll.innerHTML = html`
    <div class="card card-pad">
      <div class="notif-filters mb-4">
        <div class="chip-row" data-notif-filter>
          ${['all', 'unread', 'order', 'payment', 'withdrawal', 'system'].map((f) => html`<button type="button" class="chip ${f === filter ? 'is-active' : ''}" data-notif-kind="${f}">${f === 'all' ? 'All' : f[0].toUpperCase() + f.slice(1)}</button>`)}
        </div>
        <button type="button" class="btn btn-ghost btn-sm" data-refresh-notifs>${raw(icon('refresh'))} Refresh</button>
      </div>
      <div data-notif-host><div class="skeleton sk-row"></div><div class="skeleton sk-row"></div><div class="skeleton sk-row"></div></div>
    </div>
    <div class="card card-pad mt-6">
      <h3 class="h4 mb-2">Push notifications</h3>
      <p class="muted text-sm">Browser push (FCM) is used by the companion mobile apps. On the web you get live in-app alerts${cfg.firebase?.enabled ? '' : ' — Firebase is not configured for this deployment'}.</p>
      <div class="row mt-4" style="gap:8px">
        ${cfg.firebase?.enabled ? html`<button type="button" class="btn btn-secondary btn-sm" data-enable-push>${raw(icon('bell'))} Enable push</button>` : ''}
        <a class="btn btn-ghost btn-sm" href="${url('admin/settings.html')}">${raw(icon('settings'))} Notification settings</a>
      </div>
    </div>`;

  const host = $('[data-notif-host]');
  let all = [];

  const paint = (kind) => {
    let items = all;
    if (kind === 'unread') items = all.filter((n) => !n.readAt);
    else if (kind !== 'all') items = all.filter((n) => notificationKind(n) === kind);
    renderNotificationCenter(host, items);
    bindNotifRowActions();
  };

  const bindNotifRowActions = () => {
    $$('[data-notif-read]', host).forEach((btn) => btn.addEventListener('click', async (e) => {
      e.preventDefault();
      await markRead([btn.dataset.notifRead]);
      const card = btn.closest('.notif-card');
      card?.classList.remove('is-unread');
      btn.remove();
    }));
  };

  const load = async () => {
    setLoading(host, true, '<div class="skeleton sk-row"></div><div class="skeleton sk-row"></div>');
    const data = await refreshNotifications({ silent: true }).catch(() => null);
    all = data?.items || [];
    setLoading(host, false);
    paint($('[data-notif-filter] .chip.is-active')?.dataset?.notifKind || 'all');
  };

  $$('[data-notif-kind]').forEach((chip) => chip.addEventListener('click', () => {
    $$('[data-notif-kind]').forEach((c) => c.classList.remove('is-active'));
    chip.classList.add('is-active');
    setQuery({ filter: chip.dataset.notifKind === 'all' ? null : chip.dataset.notifKind }, { replace: true });
    paint(chip.dataset.notifKind);
  }));

  $('[data-refresh-notifs]').addEventListener('click', () => load());
  $('[data-mark-all]').addEventListener('click', async (e) => {
    await withButtonState(e.currentTarget, async () => {
      await markRead([]);
      toastSuccess('All notifications marked as read.');
      load();
    });
  });

  $('[data-enable-push]')?.addEventListener('click', async (e) => {
    const { requestPushToken } = await import('../firebase.js');
    await withButtonState(e.currentTarget, async () => {
      const token = await requestPushToken();
      toast(token ? 'Push notifications enabled.' : 'Push is unavailable in this browser.', { type: token ? 'success' : 'info' });
    });
  });

  await load();
}

export default { dashboard, analytics, notifications };
