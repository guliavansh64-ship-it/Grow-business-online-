/**
 * products.js — storefront catalogue logic shared by every vendor store.
 * One implementation of the product card, grid, filters, add-to-cart and
 * wishlist behaviour → all tenants get the same update at once (spec §41).
 */
import cfg from './config.js';
import Api, { friendlyMessage } from './api.js';
import cart from './cart.js';
import { state as auth, isSignedIn } from './auth.js';
import { $, $$, url, html, raw, esc, money, num, debounce, qget, setQuery, clamp } from './utils.js';
import { icon } from './icons.js';
import { toast, toastSuccess, emptyState, setLoading } from './ui.js';
import { productCard, productGrid, ratingStars, priceBlock, paginationBar, statusBadge } from './components.js';

export { productCard, productGrid };

/* ------------------------------------------------------------- rendering */

export function renderGrid(host, products, vendor) {
  if (!host) return;
  if (!products.length) {
    host.innerHTML = emptyState({
      icon: 'search',
      title: 'No products found',
      message: 'Try a different search term or clear the filters.',
      action: { label: 'Clear filters', href: url(`vendor/category.html?vendor=${vendor?.slug || ''}`) },
    });
    return;
  }
  host.innerHTML = productGrid(products, vendor);
}

/* -------------------------------------------------------- cart & wishlist */

/** Wires every [data-add-cart] / [data-buy-now] / [data-wishlist] on the page. */
export function bindProductActions(vendor, { products = [], onAdd = null } = {}) {
  const index = new Map(products.map((p) => [p.id, p]));
  const find = async (id) => index.get(id) || (await loadProduct(vendor.slug, id));

  document.addEventListener('click', async (e) => {
    const addBtn = e.target.closest('[data-add-cart]');
    if (addBtn) {
      e.preventDefault();
      await addToCart(addBtn.dataset.addCart, vendor, { find, button: addBtn, onAdd });
      return;
    }
    const buyBtn = e.target.closest('[data-buy-now]');
    if (buyBtn) {
      e.preventDefault();
      const product = await find(buyBtn.dataset.buyNow);
      if (!product) return;
      if (!product.inStock) {
        toast('This product is out of stock.', { type: 'warning' });
        return;
      }
      const qty = Number($('[data-qty-input]')?.value || 1);
      if (!cart.has(product.id)) cart.add(product, qty);
      else cart.setQty(product.id, (cart.items.find((i) => i.productId === product.id)?.qty || 1) + qty - 1);
      globalThis.location.href = url(`vendor/checkout.html?vendor=${vendor.slug}`);
      return;
    }
    const wishBtn = e.target.closest('[data-wishlist]');
    if (wishBtn) {
      e.preventDefault();
      await toggleWishlist(wishBtn, wishBtn.dataset.wishlist);
    }
  });
}

async function loadProduct(slug, id) {
  try {
    const data = await Api.product(slug, id);
    return data.product;
  } catch {
    return null;
  }
}

export async function addToCart(productId, vendor, { qty = null, find, button = null, onAdd = null } = {}) {
  const product = await find(productId);
  if (!product) {
    toast('That product is no longer available.', { type: 'error' });
    return false;
  }
  if (!product.inStock) {
    toast(`${product.name} is out of stock.`, { type: 'warning' });
    return false;
  }
  const amount = Number(qty ?? $('[data-qty-input]')?.value ?? 1);
  if (amount > product.stock) {
    toast(`Only ${product.stock} left in stock.`, { type: 'warning' });
    return false;
  }
  if (button) {
    button.classList.add('is-loading');
    button.setAttribute('aria-busy', 'true');
  }
  cart.bind(vendor.slug).add(product, amount);
  if (button) {
    button.classList.remove('is-loading');
    button.removeAttribute('aria-busy');
    const original = button.innerHTML;
    button.innerHTML = `${icon('check')} Added`;
    button.classList.add('btn-success');
    setTimeout(() => {
      button.innerHTML = original;
      button.classList.remove('btn-success');
    }, 1500);
  }
  toastSuccess(`${product.name} added to your cart.`, {
    duration: 3200,
    action: { label: 'View cart', onClick: () => (globalThis.location.href = url(`vendor/cart.html?vendor=${vendor.slug}`)) },
  });
  onAdd?.(product);
  return true;
}

export async function toggleWishlist(button, productId) {
  if (!isSignedIn() || auth.user?.role === 'vendor') {
    toast('Sign in as a customer to save a wishlist.', {
      type: 'info',
      action: { label: 'Sign in', onClick: () => (globalThis.location.href = url('login.html')) },
    });
    return;
  }
  try {
    await Api.addWishlist(productId);
    button.classList.add('is-liked');
    button.innerHTML = icon('heart');
    toastSuccess('Added to your wishlist.');
  } catch (err) {
    if (err.code === 'bad_request') {
      toast('Already in your wishlist.', { type: 'info', duration: 2200 });
      button.classList.add('is-liked');
      return;
    }
    // Not signed in / session expired → send them to sign in.
    toast('Sign in to save your wishlist.', { type: 'info', action: { label: 'Sign in', onClick: () => (globalThis.location.href = url('login.html')) } });
  }
}

/* ------------------------------------------------------- catalogue loading */

export const SORT_OPTIONS = [
  { value: 'popular', label: 'Most popular' },
  { value: 'newest', label: 'Newest first' },
  { value: 'price_asc', label: 'Price: low to high' },
  { value: 'price_desc', label: 'Price: high to low' },
  { value: 'rating', label: 'Customer rating' },
  { value: 'discount', label: 'Biggest discount' },
];

/**
 * Loads a page of products and paints grid + pagination.
 * Keeps the URL in sync so a filtered view is shareable and refresh-safe.
 */
export async function loadCatalogue({ vendor, host, paginationHost, filters, skeletonCount = 8 }) {
  if (!host) return { items: [], pagination: null };
  setLoading(host, true, html`<div class="product-grid">${Array.from({ length: skeletonCount }, () => `<div class="sk-card"><div class="skeleton sk-img"></div><div style="padding:14px"><div class="skeleton sk-title"></div><div class="skeleton sk-text"></div><div class="skeleton sk-text" style="width:50%"></div></div></div>`).join('')}</div>`);
  try {
    const query = { ...filters, limit: filters.limit || cfg.pageSize };
    const { items, pagination } = await Api.paged(`/store/vendors/${encodeURIComponent(vendor.slug)}/products`, query);
    renderGrid(host, items, vendor);
    if (paginationHost) {
      paginationHost.innerHTML = pagination ? paginationBar(pagination) : '';
      bindPagination(paginationHost, query);
    }
    setLoading(host, false);
    return { items, pagination };
  } catch (err) {
    setLoading(host, false);
    host.innerHTML = emptyState({ icon: 'alert-triangle', title: 'Could not load products', message: friendlyMessage(err), action: { label: 'Try again', href: url(`vendor/category.html?vendor=${vendor.slug}`) } });
    return { items: [], pagination: null };
  }
}

function bindPagination(host, query) {
  host.addEventListener('click', (e) => {
    const link = e.target.closest('[data-page]');
    if (!link || link.getAttribute('aria-disabled') === 'true') return;
    e.preventDefault();
    const page = Number(link.dataset.page);
    setQuery({ ...stripEmpty(query), page: page > 1 ? page : null }, { replace: false });
    loadCatalogue({ vendor: globalThis.__gboVendor, host: $('[data-product-grid]'), paginationHost: $('[data-pagination]'), filters: readFiltersFromUrl() });
    globalThis.scrollTo({ top: 0, behavior: 'smooth' });
  });
}

const stripEmpty = (obj) => Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== '' && v !== null && v !== undefined));

/** Reads the current filter state from the query string (single source of truth). */
export function readFiltersFromUrl() {
  const q = new URLSearchParams(globalThis.location.search);
  return {
    q: q.get('q') || '',
    category: q.get('category') || '',
    sort: q.get('sort') || 'popular',
    page: Number(q.get('page') || 1),
    minPrice: q.get('minPrice') || '',
    maxPrice: q.get('maxPrice') || '',
    inStock: q.get('inStock') === 'true' ? 'true' : '',
    limit: Number(q.get('limit') || cfg.pageSize),
  };
}

/* ------------------------------------------------------ filters sidebar UI */

export function renderFilters(host, { vendor, categories, filters, priceBounds = { min: 0, max: 100000 } }) {
  if (!host) return;
  host.innerHTML = html`
    <div class="filter-block">
      <h4>Categories</h4>
      <div class="filter-list">
        <a href="${url(`vendor/category.html?vendor=${vendor.slug}`)}" class="${!filters.category ? 'is-active' : ''}">All products</a>
        ${categories.map(
          (c) => html`<a href="${url(`vendor/category.html?vendor=${vendor.slug}&category=${c.slug}`)}" class="${filters.category === c.slug ? 'is-active' : ''}">
            <span>${c.name}</span><span class="ct">${num(c.count)}</span>
          </a>`
        )}
      </div>
    </div>

    <div class="filter-block">
      <h4>Price</h4>
      <div class="field">
        <input type="range" min="${priceBounds.min}" max="${priceBounds.max}" step="100" value="${filters.maxPrice || priceBounds.max}" data-price-max aria-label="Maximum price"/>
        <div class="row row-between text-sm muted mt-2">
          <span>${money(priceBounds.min * 100, { decimals: 0 })}</span>
          <strong class="ink" data-price-label>Up to ${money((filters.maxPrice || priceBounds.max) * 100, { decimals: 0 })}</strong>
        </div>
      </div>
    </div>

    <div class="filter-block">
      <h4>Availability</h4>
      <label class="check">
        <input type="checkbox" data-in-stock ${filters.inStock === 'true' ? 'checked' : ''}/>
        <span class="box">${raw(icon('check'))}</span>
        <span class="text">In stock only</span>
      </label>
    </div>

    <div class="filter-block">
      <h4>Sort by</h4>
      <select class="select" data-sort aria-label="Sort products">
        ${SORT_OPTIONS.map((o) => html`<option value="${o.value}" ${filters.sort === o.value ? 'selected' : ''}>${o.label}</option>`)}
      </select>
    </div>

    <button type="button" class="btn btn-secondary btn-block" data-clear-filters>${raw(icon('refresh'))} Clear all filters</button>`;

  const apply = (patch) => {
    const next = { ...stripEmpty(readFiltersFromUrl()), ...patch, page: null };
    setQuery(stripEmpty(next), { replace: false });
    document.dispatchEvent(new CustomEvent('filters:change', { detail: readFiltersFromUrl() }));
  };

  const range = $('[data-price-max]', host);
  const label = $('[data-price-label]', host);
  range?.addEventListener('input', () => {
    label.textContent = `Up to ${money(Number(range.value) * 100, { decimals: 0 })}`;
  });
  range?.addEventListener('change', () => apply({ maxPrice: range.value === String(priceBounds.max) ? '' : range.value }));
  $('[data-in-stock]', host)?.addEventListener('change', (e) => apply({ inStock: e.target.checked ? 'true' : '' }));
  $('[data-sort]', host)?.addEventListener('change', (e) => apply({ sort: e.target.value }));
  $('[data-clear-filters]', host)?.addEventListener('click', () => {
    setQuery({ vendor: vendor.slug }, { replace: false });
    document.dispatchEvent(new CustomEvent('filters:change', { detail: readFiltersFromUrl() }));
  });
}

export function bindMobileFilters() {
  const btn = $('[data-open-filters]');
  const panel = $('[data-filters]');
  if (!btn || !panel) return;
  btn.addEventListener('click', () => {
    const open = panel.classList.toggle('is-open');
    btn.setAttribute('aria-expanded', String(open));
    if (open) panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  $('[data-close-filters]')?.addEventListener('click', () => panel.classList.remove('is-open'));
}

/* -------------------------------------------------------- product details */

export function renderProductDetail(host, { product, vendor, category, reviews = [], related = [] }) {
  if (!host) return;
  const gallery = product.gallery?.length ? product.gallery : [product.image].filter(Boolean);

  host.innerHTML = html`
    <nav class="breadcrumb mb-6" aria-label="Breadcrumb">
      <a href="${url(`vendor/index.html?vendor=${vendor.slug}`)}">Home</a>${raw(icon('chevron-right', 'sep'))}
      <a href="${url(`vendor/category.html?vendor=${vendor.slug}`)}">Products</a>${raw(icon('chevron-right', 'sep'))}
      ${category ? html`<a href="${url(`vendor/category.html?vendor=${vendor.slug}&category=${category.slug}`)}">${category.name}</a>${raw(icon('chevron-right', 'sep'))}` : ''}
      <span class="current truncate">${product.name}</span>
    </nav>

    <div class="pdp">
      <div class="pdp-gallery">
        <div class="pdp-main-img"><img src="${url(String(gallery[0] || '').replace(/^\//, ''))}" alt="${product.name}" id="pdp-main" width="640" height="640"/></div>
        ${gallery.length > 1
          ? html`<div class="pdp-thumbs">
              ${gallery.map((g, i) => html`<button type="button" class="${i === 0 ? 'is-active' : ''}" data-thumb="${url(String(g).replace(/^\//, ''))}" aria-label="View image ${i + 1}">
                <img src="${url(String(g).replace(/^\//, ''))}" alt="" loading="lazy" width="74" height="74"/></button>`)}
            </div>`
          : ''}
        ${related.length
          ? html`<div class="mt-8">
              <h4 class="upper muted mb-4">You may also like</h4>
              <div class="grid g-2">${related.map((p) => productCard(p, vendor)).join('')}</div>
            </div>`
          : ''}
      </div>

      <div class="pdp-info">
        <div class="row row-wrap" style="gap:8px">
          ${product.featured ? html`<span class="badge badge-brand">${raw(icon('sparkles'))} Bestseller</span>` : ''}
          ${product.inStock ? (product.lowStock ? html`<span class="badge badge-warning">Only ${product.stock} left</span>` : html`<span class="badge badge-success"><span class="dotmark"></span>In stock</span>`) : html`<span class="badge badge-danger">Out of stock</span>`}
          <span class="badge badge-outline mono">${product.sku}</span>
        </div>

        <h1 class="pdp-title mt-4">${product.name}</h1>
        <div class="pdp-meta">
          ${ratingStars(product.rating, { count: product.reviewCount })}
          <span class="dim text-sm">${num(product.soldCount || 0)} sold</span>
          <a class="text-sm brand-text" href="#reviews">Read reviews</a>
        </div>

        <div class="pdp-price-box">
          ${priceBlock(product, { size: 'price-xl' })}
          <p class="hint mt-2">Inclusive of all taxes · Free delivery above ${money(vendor.freeDeliveryAbovePaise ?? 99900, { decimals: 0 })}</p>
        </div>

        <p class="muted">${product.shortDescription || ''}</p>

        <div class="row mt-6" style="gap:12px;flex-wrap:wrap">
          <div class="qty" data-qty>
            <button type="button" data-qty-dec aria-label="Decrease quantity">${raw(icon('minus'))}</button>
            <input type="number" value="1" min="1" max="${Math.max(1, product.stock)}" data-qty-input aria-label="Quantity"/>
            <button type="button" data-qty-inc aria-label="Increase quantity">${raw(icon('plus'))}</button>
          </div>
          <button type="button" class="btn btn-secondary btn-lg" data-add-cart="${product.id}" ${product.inStock ? '' : 'disabled'}>${raw(icon('cart'))} Add to Cart</button>
          <button type="button" class="btn btn-primary btn-lg" data-buy-now="${product.id}" ${product.inStock ? '' : 'disabled'}>${raw(icon('zap'))} Buy Now</button>
        </div>

        <div class="pdp-usp">
          <div>${raw(icon('truck'))} Fast delivery across India</div>
          <div>${raw(icon('refresh'))} 7 day replacement</div>
          <div>${raw(icon('shield-check'))} Secure checkout</div>
          <div>${raw(icon('credit'))} UPI, cards & COD</div>
        </div>

        ${product.specs?.length
          ? html`<div class="mt-8">
              <h4 class="upper muted mb-4">Specifications</h4>
              <table class="spec-table"><tbody>
                ${product.specs.map((s) => html`<tr><th>${Array.isArray(s) ? s[0] : s.label}</th><td>${Array.isArray(s) ? s[1] : s.value}</td></tr>`)}
              </tbody></table>
            </div>`
          : ''}

        ${product.description ? html`<div class="mt-8"><h4 class="upper muted mb-4">Description</h4><p class="muted">${product.description}</p></div>` : ''}

        <div class="card card-pad mt-8">
          <div class="row">
            ${vendor.logo ? html`<img src="${url(String(vendor.logo).replace(/^\//, ''))}" alt="" width="46" height="46" style="border-radius:13px"/>` : ''}
            <div class="grow">
              <strong class="ink">Sold by ${vendor.name}</strong>
              <div class="row text-sm muted" style="gap:12px">
                <span>${raw(icon('star'))} ${Number(vendor.rating || 0).toFixed(1)}</span>
                <span>${raw(icon('map-pin'))} ${vendor.city || ''}${vendor.state ? `, ${vendor.state}` : ''}</span>
              </div>
            </div>
            <a class="btn btn-sm btn-secondary" href="${url(`vendor/index.html?vendor=${vendor.slug}`)}">Visit store</a>
          </div>
        </div>
      </div>
    </div>

    <section class="section-sm" id="reviews">
      <div class="card card-pad">
        <div class="card-head" style="padding:0 0 var(--sp-4);margin-bottom:var(--sp-4)">
          <div><h3>Customer reviews</h3><div class="sub">${num(product.reviewCount || 0)} verified reviews</div></div>
          ${cfg.features.reviews ? html`<button type="button" class="btn btn-secondary btn-sm" data-open-review>${raw(icon('edit'))} Write a review</button>` : ''}
        </div>

        <div class="rating-summary mb-6">
          <div class="rating-big">
            <div class="n">${Number(product.rating || 0).toFixed(1)}</div>
            ${ratingStars(product.rating)}
          </div>
          <div class="rating-bars">
            ${[5, 4, 3, 2, 1].map((star) => {
              const share = product.reviewCount ? (star === Math.round(product.rating) ? 62 : star === Math.round(product.rating) - 1 ? 22 : 8) : 0;
              return html`<div class="rb"><span>${star}★</span><span class="progress progress-sm"><span style="width:${share}%"></span></span><span>${share}%</span></div>`;
            })}
          </div>
        </div>

        <div data-review-list>
          ${reviews.length
            ? reviews.map((r) => html`
              <article class="review">
                <div class="review-head">
                  <span class="avatar avatar-sm">${esc((r.author || 'A').slice(0, 1).toUpperCase())}</span>
                  <div><div class="nm">${r.author}${r.verified ? html` <span class="badge badge-success" style="margin-left:6px">Verified</span>` : ''}</div>
                  ${ratingStars(r.rating, { size: 'stars-sm' })}</div>
                  <span class="dt">${esc(new Date(r.createdAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }))}</span>
                </div>
                ${r.title ? html`<strong class="ink text-sm mt-2" style="display:block">${r.title}</strong>` : ''}
                <p class="muted">${r.body}</p>
              </article>`)
            : emptyState({ icon: 'star', title: 'No reviews yet', message: 'Be the first to review this product.', small: true })}
        </div>
      </div>
    </section>`;

  bindGallery(host);
  bindQtyStepper(host);
  bindReviewForm(host, vendor, product);
}

function bindGallery(scope) {
  const main = $('#pdp-main', scope);
  $$('[data-thumb]', scope).forEach((btn) => {
    btn.addEventListener('click', () => {
      $$('[data-thumb]', scope).forEach((b) => b.classList.remove('is-active'));
      btn.classList.add('is-active');
      if (main) main.src = btn.dataset.thumb;
    });
  });
}

export function bindQtyStepper(scope = document) {
  const wrap = $('[data-qty]', scope);
  if (!wrap) return;
  const input = $('[data-qty-input]', wrap);
  const max = Number(input.max || 10);
  const set = (v) => {
    input.value = String(clamp(v, 1, max));
  };
  $('[data-qty-dec]', wrap)?.addEventListener('click', () => set(Number(input.value) - 1));
  $('[data-qty-inc]', wrap)?.addEventListener('click', () => set(Number(input.value) + 1));
  input.addEventListener('change', () => set(Number(input.value)));
}

function bindReviewForm(scope, vendor, product) {
  const openBtn = $('[data-open-review]', scope);
  if (!openBtn) return;
  openBtn.addEventListener('click', async () => {
    const { modal } = await import('./ui.js');
    modal({
      title: `Review ${product.name}`,
      description: 'Your review is published after a quick moderation check.',
      body: html`
        <form data-review-form class="stack">
          <div class="field" data-field="author">
            <label class="label" for="rv-author">Your name</label>
            <input class="input" id="rv-author" name="author" placeholder="e.g. Ananya G" maxlength="60" data-autofocus/>
            <span class="error-text" data-error></span>
          </div>
          <div class="field" data-field="rating">
            <label class="label">Rating</label>
            <div class="chip-row" data-rating-picker>
              ${[1, 2, 3, 4, 5].map((n) => html`<button type="button" class="chip ${n === 5 ? 'is-active' : ''}" data-rating="${n}">${n} ★</button>`)}
            </div>
          </div>
          <div class="field" data-field="title">
            <label class="label" for="rv-title">Headline <span class="opt">optional</span></label>
            <input class="input" id="rv-title" name="title" maxlength="100" placeholder="Sum it up in a few words"/>
          </div>
          <div class="field" data-field="body">
            <label class="label" for="rv-body">Your review</label>
            <textarea class="textarea" id="rv-body" name="body" maxlength="1000" placeholder="What did you like or dislike?"></textarea>
            <span class="error-text" data-error></span>
          </div>
        </form>`,
      footer: html`<button type="button" class="btn btn-secondary" data-close>Cancel</button><button type="button" class="btn btn-primary" data-submit-review>Submit review</button>`,
      onMount: ({ root, close }) => {
        let rating = 5;
        root.addEventListener('click', (e) => {
          const chip = e.target.closest('[data-rating]');
          if (chip) {
            rating = Number(chip.dataset.rating);
            $$('[data-rating]', root).forEach((c) => c.classList.toggle('is-active', c === chip));
          }
        });
        $('[data-submit-review]', root).addEventListener('click', async (e) => {
          const btn = e.currentTarget;
          const form = $('[data-review-form]', root);
          const data = new FormData(form);
          const payload = { productId: product.id, author: data.get('author'), title: data.get('title'), body: data.get('body'), rating };
          if (!payload.author || String(payload.body || '').length < 10) {
            toastError('Add your name and at least a few words about the product.');
            return;
          }
          btn.classList.add('is-loading');
          try {
            const res = await Api.addReview(vendor.slug, payload);
            toastSuccess('Thanks! Your review has been submitted.');
            const list = $('[data-review-list]');
            if (list) {
              const node = document.createElement('article');
              node.className = 'review';
              node.innerHTML = html`
                <div class="review-head"><span class="avatar avatar-sm">${esc(payload.author.slice(0, 1).toUpperCase())}</span>
                  <div><div class="nm">${payload.author} <span class="badge badge-warning" style="margin-left:6px">Pending</span></div>${ratingStars(rating, { size: 'stars-sm' })}</div></div>
                <strong class="ink text-sm mt-2" style="display:block">${payload.title || ''}</strong>
                <p class="muted">${payload.body}</p>`;
              list.prepend(node);
            }
            close();
          } catch (err) {
            toastError(friendlyMessage(err));
          } finally {
            btn.classList.remove('is-loading');
          }
        });
      },
    });
  });
}

export default { renderGrid, bindProductActions, addToCart, toggleWishlist, loadCatalogue, readFiltersFromUrl, renderFilters, bindMobileFilters, renderProductDetail, bindQtyStepper, SORT_OPTIONS };
