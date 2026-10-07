/**
 * components.js — render helpers shared by the storefront and the dashboard.
 * Everything returns an html`` string (already escaped), so pages stay short
 * and a change here updates every vendor store at once (spec §41).
 */
import cfg from './config.js';
import { $, url, html, raw, esc, money, num, dateShort, dateTime, timeAgo, sentence, initials } from './utils.js';
import { icon } from './icons.js';
import { emptyState } from './ui.js';
import { sparkline } from './charts.js';

/* ------------------------------------------------------------ status maps */

export const ORDER_TONE = {
  pending: 'badge-warning',
  confirmed: 'badge-info',
  processing: 'badge-info',
  shipped: 'badge-brand',
  out_for_delivery: 'badge-brand',
  delivered: 'badge-success',
  cancelled: 'badge-danger',
  refunded: 'badge-danger',
};

export const PAYMENT_TONE = { pending: 'badge-warning', paid: 'badge-success', failed: 'badge-danger', refunded: 'badge-info' };

export const DEPOSIT_TONE = {
  pending: 'badge-warning',
  processing: 'badge-info',
  paid: 'badge-brand',
  approved: 'badge-success',
  rejected: 'badge-danger',
  refunded: 'badge-info',
};

export const WITHDRAWAL_TONE = {
  pending: 'badge-warning',
  processing: 'badge-info',
  approved: 'badge-brand',
  paid: 'badge-success',
  rejected: 'badge-danger',
  cancelled: 'badge',
};

export const VENDOR_TONE = {
  active: 'badge-success',
  pending_activation: 'badge-warning',
  pending_deposit: 'badge-warning',
  suspended: 'badge-danger',
  rejected: 'badge-danger',
};

export const PRODUCT_TONE = { active: 'badge-success', draft: 'badge', out_of_stock: 'badge-danger' };

export function statusBadge(value, toneMap = ORDER_TONE, { icon: iconName = null } = {}) {
  const tone = toneMap[value] || 'badge';
  return html`<span class="badge ${tone}">${iconName ? raw(icon(iconName)) : html`<span class="dotmark"></span>`}${sentence(value)}</span>`;
}

/* ---------------------------------------------------------------- KPI cards */

export function kpiCard({ label, value, sub = '', icon: iconName = 'chart', tone = 'brand', delta = null, spark = null, href = null, big = false }) {
  const tag = href ? 'a' : 'div';
  const hrefAttr = href ? `href="${url(href)}"` : '';
  return html`
    <${tag} ${raw(hrefAttr)} class="kpi kpi-${tone} ${href ? 'kpi-link' : ''} ${big ? 'kpi-big' : ''}">
      <div class="kpi-top">
        <span class="kpi-ico">${raw(icon(iconName))}</span>
        ${delta !== null && delta !== undefined
          ? html`<span class="kpi-delta ${Number(delta) >= 0 ? 'up' : 'down'}">${raw(icon(Number(delta) >= 0 ? 'trending' : 'trending-down'))}${Number(delta) >= 0 ? '+' : ''}${Number(delta).toFixed(0)}%</span>`
          : ''}
      </div>
      <div class="kpi-value">${value}</div>
      <div class="kpi-label">${label}</div>
      ${sub ? html`<div class="kpi-sub">${sub}</div>` : ''}
      ${spark ? raw(sparkline(spark, { color: `var(--kpi-${tone}, var(--brand))` })) : ''}
    </${tag}>`;
}

export const kpiGrid = (cards) => html`<div class="kpi-grid">${cards.map(kpiCard)}</div>`;

/* --------------------------------------------------------------- data table */

/**
 * table({
 *   columns: [{ key, label, render(row), align, className }],
 *   rows, empty: {icon,title,message,action}, rowAttr(row)
 * })
 */
export function table({ columns, rows = [], empty = null, rowAttr = () => '', dense = false, foot = '' }) {
  if (!rows.length && empty) return emptyState(empty);
  return html`
    <div class="table-wrap">
      <table class="table ${dense ? 'table-compact' : ''}">
        <thead><tr>${columns.map((c) => html`<th class="${c.align === 'right' ? 'num' : ''} ${c.className || ''}">${c.label}</th>`)}</tr></thead>
        <tbody>
          ${rows.map((row) => html`<tr ${raw(rowAttr(row))}>${columns.map((c) => html`<td class="${c.align === 'right' ? 'num' : ''} ${c.className || ''}">${c.render ? raw(c.render(row)) : esc(row[c.key] ?? '—')}</td>`)}</tr>`)}
        </tbody>
        ${foot ? raw(`<tfoot><tr>${foot}</tr></tfoot>`) : ''}
      </table>
    </div>`;
}

export function paginationBar(pagination, { baseUrl = null, paramName = 'page' } = {}) {
  if (!pagination || pagination.pages <= 1) {
    return pagination?.total
      ? html`<div class="pagination"><span class="info">Showing ${num(pagination.items?.length ?? 0)} of ${num(pagination.total)} results</span></div>`
      : '';
  }
  const { page, pages, total, limit } = pagination;
  const from = (page - 1) * limit + 1;
  const to = Math.min(total, page * limit);
  const link = (p) => {
    if (baseUrl) return `${baseUrl}${baseUrl.includes('?') ? '&' : '?'}${paramName}=${p}`;
    return '#';
  };
  const nums = [];
  const push = (p) => nums.includes(p) || p < 1 || p > pages || nums.push(p);
  push(1);
  push(page - 1);
  push(page);
  push(page + 1);
  push(pages);
  nums.sort((a, b) => a - b);

  return html`
    <div class="pagination">
      <span class="info">Showing <strong>${num(from)}–${num(to)}</strong> of <strong>${num(total)}</strong></span>
      <nav class="page-btns" aria-label="Pagination">
        <a class="page-btn" href="${link(page - 1)}" data-page="${page - 1}" ${page <= 1 ? 'aria-disabled="true"' : ''} aria-label="Previous">${raw(icon('chevron-left'))}</a>
        ${nums.map((p, i) => html`${i && nums[i - 1] !== p - 1 ? html`<span class="page-gap">…</span>` : ''}
          <a class="page-btn ${p === page ? 'is-active' : ''}" href="${link(p)}" data-page="${p}" ${p === page ? 'aria-current="page"' : ''}>${p}</a>`)}
        <a class="page-btn" href="${link(page + 1)}" data-page="${page + 1}" ${page >= pages ? 'aria-disabled="true"' : ''} aria-label="Next">${raw(icon('chevron-right'))}</a>
      </nav>
    </div>`;
}

/* ------------------------------------------------------------- product bits */

export function ratingStars(rating = 0, { count = null, size = '' } = {}) {
  const full = Math.floor(rating);
  const half = rating - full >= 0.5;
  const stars = Array.from({ length: 5 }, (_, i) => {
    const on = i < full || (i === full && half);
    return `<svg class="${on ? 'on' : ''}" viewBox="0 0 24 24" aria-hidden="true"><use href="#i-star"/></svg>`;
  }).join('');
  return html`
    <span class="rating-line">
      <span class="stars ${size}" role="img" aria-label="Rated ${Number(rating).toFixed(1)} out of 5">${raw(stars)}</span>
      <strong>${Number(rating || 0).toFixed(1)}</strong>
      ${count !== null ? html`<span class="dim">(${num(count)})</span>` : ''}
    </span>`;
}

export function priceBlock({ pricePaise, mrpPaise, discountPercent, size = '' }) {
  const hasDiscount = mrpPaise > pricePaise;
  return html`
    <span class="price ${size}">
      <span class="now">${money(pricePaise)}</span>
      ${hasDiscount ? html`<span class="was">${money(mrpPaise)}</span><span class="off">${discountPercent ?? Math.round(((mrpPaise - pricePaise) / mrpPaise) * 100)}% off</span>` : ''}
    </span>`;
}

/** The storefront product card — the single component every vendor store shares. */
export function productCard(product, vendor, { lazy = true } = {}) {
  const href = url(`vendor/product.html?vendor=${vendor?.slug || ''}&id=${encodeURIComponent(product.id)}`);
  const out = !product.inStock;
  return html`
    <article class="product-card ${out ? 'is-out' : ''}" data-product-id="${product.id}">
      <a class="pc-media" href="${href}" aria-label="${product.name}">
        ${product.image
          ? html`<img src="${url(String(product.image).replace(/^\//, ''))}" alt="${product.name}" width="320" height="320" loading="${lazy ? 'lazy' : 'eager'}" decoding="async"/>`
          : html`<span class="pc-noimg">${raw(icon('image'))}</span>`}
        ${product.discountPercent > 0 && !out ? html`<span class="pc-flag">-${product.discountPercent}%</span>` : ''}
        ${out ? html`<span class="pc-out">Out of stock</span>` : product.lowStock ? html`<span class="pc-low">Only ${product.stock} left</span>` : ''}
        <span class="pc-quick">
          <button type="button" class="icon-btn" data-wishlist="${product.id}" aria-label="Add to wishlist">${raw(icon('heart'))}</button>
          <a class="icon-btn" href="${href}" aria-label="Quick view">${raw(icon('eye'))}</a>
        </span>
      </a>
      <div class="pc-body">
        <h3 class="pc-name"><a href="${href}">${product.name}</a></h3>
        <p class="pc-desc clamp-2">${product.shortDescription || ''}</p>
        ${ratingStars(product.rating, { count: product.reviewCount })}
        <div class="pc-foot">
          ${priceBlock(product)}
          ${out
            ? html`<button type="button" class="btn btn-sm btn-secondary" disabled>Unavailable</button>`
            : html`<button type="button" class="btn btn-sm btn-primary" data-add-cart="${product.id}">${raw(icon('cart'))} Add</button>`}
        </div>
      </div>
    </article>`;
}

export const productGrid = (products, vendor) => html`<div class="product-grid">${products.map((p) => productCard(p, vendor))}</div>`;

/* ------------------------------------------------------------- order bits */

export function orderLineThumb(line, size = 40) {
  return line.image
    ? html`<img src="${url(String(line.image).replace(/^\//, ''))}" alt="" width="${size}" height="${size}" loading="lazy" class="thumb"/>`
    : html`<span class="thumb thumb-empty">${raw(icon('package'))}</span>`;
}

export function customerCell(order) {
  return html`
    <span class="cell-user">
      <span class="avatar avatar-sm">${initials(order.customer?.name)}</span>
      <span class="meta"><span class="n">${order.customer?.name || 'Guest'}</span><span class="s">${order.customer?.phone || order.customer?.email || ''}</span></span>
    </span>`;
}

export const trackingSteps = (current, steps = ['pending', 'confirmed', 'processing', 'shipped', 'out_for_delivery', 'delivered'], labels = null) => {
  const order = ['pending', 'confirmed', 'processing', 'shipped', 'out_for_delivery', 'delivered'];
  const isCancelled = ['cancelled', 'refunded'].includes(current);
  const currentIndex = order.indexOf(current);
  return html`
    <ol class="steps ${isCancelled ? 'is-cancelled' : ''}">
      ${steps.map((step, i) => {
        const done = !isCancelled && currentIndex > i;
        const active = !isCancelled && currentIndex === i;
        return html`<li class="step ${done ? 'is-done' : ''} ${active ? 'is-active' : ''}">
          <span class="bubble">${done ? raw(icon('check')) : active ? raw(icon('truck')) : i + 1}</span>
          <span class="lbl">${labels?.[step] || sentence(step)}</span>
        </li>`;
      })}
    </ol>
    ${isCancelled ? html`<div class="alert alert-danger mt-4">${raw(icon('alert-circle'))}<div class="a-body"><strong>Order ${sentence(current)}</strong>This order was ${current}. Any amount paid is refunded to the original payment method.</div></div>` : ''}`;
};

/* --------------------------------------------------------------- toolbar */

export function toolbar({ left = '', right = '', searchPlaceholder = '', searchValue = '', searchName = 'q' } = {}) {
  return html`
    <div class="toolbar">
      <div class="toolbar-left">${raw(left)}</div>
      <div class="toolbar-right">
        ${searchPlaceholder
          ? html`<form class="tb-search-form" data-search-form method="get">
              <div class="input-group">${raw(icon('search'))}
                <input class="input" type="search" name="${searchName}" placeholder="${searchPlaceholder}" value="${searchValue}" aria-label="Search" autocomplete="off"/>
              </div>
            </form>`
          : ''}
        ${raw(right)}
      </div>
    </div>`;
}

/* ---------------------------------------------------------- misc fragments */

export function infoRow(label, value, { mono = false } = {}) {
  return html`<div class="info-row"><span>${label}</span><strong class="${mono ? 'mono' : ''}">${value ?? '—'}</strong></div>`;
}

export function summaryRows(rows = [], { total = null, wrap = true } = {}) {
  const norm = (r) => (Array.isArray(r) ? { label: r[0], value: r[1], tone: r[2] } : r || {});
  const body = rows
    .filter(Boolean)
    .map((row) => {
      const { label, value, tone = '', strong = false, hint = '' } = norm(row);
      return html`<div class="summary-row ${tone} ${strong ? 'is-total' : ''}">
        <span>${label}${hint ? html`<small class="hint">${hint}</small>` : ''}</span>
        <strong>${value ?? '—'}</strong>
      </div>`;
    })
    .join('');
  const foot = total ? html`<div class="summary-row is-total"><span>Total</span><strong>${total}</strong></div>` : '';
  return wrap ? html`<div class="summary">${raw(body)}${raw(foot)}</div>` : raw(`${body}${foot}`);
}

export function pageHeader({ title, subtitle = '', actions = '', breadcrumb = null }) {
  return html`
    ${breadcrumb ? html`<nav class="breadcrumb mb-4" aria-label="Breadcrumb">${raw(breadcrumb)}</nav>` : ''}
    <div class="page-head">
      <div><h2>${title}</h2>${subtitle ? html`<p class="muted mt-2">${subtitle}</p>` : ''}</div>
      ${actions ? html`<div class="page-actions">${raw(actions)}</div>` : ''}
    </div>`;
}

export const crumb = (label, href = null) =>
  href ? html`<a href="${url(href)}">${label}</a>${raw(icon('chevron-right', 'sep'))}` : html`<span class="current">${label}</span>`;

export function moneySplit({ grossPaise, commissionPaise, vendorPaise, percent }) {
  return html`
    <div class="split-card">
      <div class="split-row"><span>Order amount</span><strong>${money(grossPaise)}</strong></div>
      <div class="split-row is-fee"><span>Platform commission (${percent}%)</span><strong>− ${money(commissionPaise)}</strong></div>
      <div class="split-row is-net"><span>You receive</span><strong>${money(vendorPaise)}</strong></div>
      <p class="hint mt-2">Calculated on the server for every completed order. The browser never computes money.</p>
    </div>`;
}

export function statusFilterChips(counts = {}, current = 'all', { paramName = 'status', baseUrl = '' } = {}) {
  const entries = Object.entries(counts);
  return html`
    <div class="chip-row">
      ${entries.map(([key, count]) => html`<a class="chip ${String(current) === String(key) ? 'is-active' : ''}" href="${baseUrl ? `${baseUrl}${baseUrl.includes('?') ? '&' : '?'}${paramName}=${key}` : '#'}" data-filter="${key}">${key === 'all' ? 'All' : sentence(key)} <span class="chip-count">${num(count)}</span></a>`)}
    </div>`;
}

export default {
  statusBadge, kpiCard, kpiGrid, table, paginationBar, ratingStars, priceBlock, productCard, productGrid,
  customerCell, trackingSteps, toolbar, infoRow, summaryRows, pageHeader, crumb, moneySplit, statusFilterChips,
  ORDER_TONE, PAYMENT_TONE, DEPOSIT_TONE, WITHDRAWAL_TONE, VENDOR_TONE, PRODUCT_TONE, orderLineThumb,
};
