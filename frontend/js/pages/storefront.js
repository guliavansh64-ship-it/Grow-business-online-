/**
 * pages/storefront.js — the vendor's public store (spec §16–§18).
 *
 * The SAME module serves every tenant: it boots through initStorefront(), which
 * resolves the vendor from ?vendor= → /s/<slug> → the real subdomain.
 */
import Api, { friendlyMessage } from '../api.js';
import cfg from '../config.js';
import { initStorefront } from '../vendor.js';
import { mountStorefrontChrome } from '../layout.js';
import cart from '../cart.js';
import { $, $$, url, html, raw, esc, money, num, dateShort, debounce, qget, setQuery } from '../utils.js';
import { icon } from '../icons.js';
import { toast, emptyState, setLoading } from '../ui.js';
import { applyProductSeo } from '../seo.js';
import {
  bindProductActions, loadCatalogue, readFiltersFromUrl,
  renderFilters, bindMobileFilters, renderProductDetail, SORT_OPTIONS,
} from '../products.js';
import { productCard, ratingStars, priceBlock } from '../components.js';

/**
 * Shared storefront bootstrap: resolve the tenant, paint chrome, bind the cart.
 * Every page in this module starts here, which is what keeps one codebase
 * serving every subdomain (spec §41).
 */
async function bootStore({ activeNav = 'home' } = {}) {
  const vendor = await initStorefront({ onNotFound: () => $('[data-store-host]')?.remove() });
  if (!vendor) return null;
  const categories = vendor.categories?.length ? vendor.categories : await Api.categories(vendor.slug).catch(() => []);
  mountStorefrontChrome(vendor, { categories, activeNav });
  cart.bind(vendor.slug);
  return { vendor, categories };
}

const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

/** "Today: 10:00–20:00" from the vendor's opening hours map. */
function todayHours(vendor) {
  const hours = vendor.hours || {};
  const today = hours[DAY_KEYS[new Date().getDay()]];
  const parts = [vendor.city, vendor.state].filter(Boolean).join(', ');
  return today ? `${today}${parts ? ` · ${parts}` : ''}` : parts || 'Open daily';
}

/* ============================================================ store home */

export async function storeHome() {
  const store = await bootStore({ activeNav: 'home' });
  if (!store) return;
  const { vendor, categories } = store;

  const host = $('[data-store-host]');
  host.innerHTML = `<div class="container section-sm"><div class="grid g-3">${Array.from({ length: 6 }, () => '<div class="sk-card"><div class="skeleton sk-img"></div><div style="padding:14px"><div class="skeleton sk-title"></div><div class="skeleton sk-text"></div></div></div>').join('')}</div></div>`;

  const products = await Api.products(vendor.slug, { limit: 48, sort: 'popular' });
  document.title = `${vendor.name} | ${vendor.tagline || cfg.brand.shortName}`;

  const featured = products.filter((p) => p.featured).slice(0, 8);
  const newest = [...products].sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0)).slice(0, 8);
  const bestSellers = [...products].sort((a, b) => (b.soldCount || 0) - (a.soldCount || 0)).slice(0, 4);
  const reviews = await Api.reviews(vendor.slug).catch(() => []);

  host.innerHTML = html`
    <section class="store-hero">
      ${vendor.banner ? html`<img src="${url(String(vendor.banner).replace(/^\//, ''))}" alt="" class="hero-bg" width="1440" height="420"/>` : ''}
      <div class="container hero-content">
        <span class="badge badge-soft-light mb-4">${raw(icon('store'))} Official online store</span>
        <h1>${vendor.name}</h1>
        <p>${vendor.tagline || vendor.description || 'Quality products, delivered to your door.'}</p>
        <div class="hero-meta">
          <span>${raw(icon('star'))} ${Number(vendor.rating || 0).toFixed(1)} rating</span>
          <span>${raw(icon('package'))} ${num(vendor.productCount)} products</span>
          <span>${raw(icon('truck'))} ${raw(icon('shield-check'))} ${money(vendor.freeDeliveryAbovePaise ?? 99900, { decimals: 0 })}+ free delivery</span>
          <span>${raw(icon('map-pin'))} ${vendor.city || 'India'}</span>
        </div>
        <div class="hero-cta mt-8">
          <a class="btn btn-primary btn-lg" href="#products">${raw(icon('grid'))} Shop products</a>
          <a class="btn btn-secondary btn-lg" href="${url(`vendor/category.html?vendor=${vendor.slug}`)}">${raw(icon('layers'))} Browse categories</a>
        </div>
      </div>
    </section>

    <section class="section-sm">
      <div class="container">
        <div class="section-head">
          <div><h2 class="h3">Shop by category</h2><p class="sub">Find exactly what you need</p></div>
          <a class="btn btn-sm btn-ghost" href="${url(`vendor/category.html?vendor=${vendor.slug}`)}">All products ${raw(icon('arrow-right'))}</a>
        </div>
        <div class="cat-grid">
          ${categories.slice(0, 10).map((c) => html`
            <a class="cat-tile" href="${url(`vendor/category.html?vendor=${vendor.slug}&category=${c.slug}`)}" style="--tile:${esc(c.color || 'var(--brand)')}">
              <span class="ico">${raw(icon(c.icon || 'tag'))}</span>
              <span class="nm">${c.name}</span>
              <span class="ct">${num(c.count)} products</span>
            </a>`)}
        </div>
      </div>
    </section>

    ${featured.length
      ? html`<section class="section-sm" id="products">
          <div class="container">
            <div class="section-head">
              <div><span class="eyebrow">${raw(icon('sparkles'))} Handpicked</span><h2 class="h3">Featured products</h2></div>
              <a class="btn btn-sm btn-ghost" href="${url(`vendor/category.html?vendor=${vendor.slug}&sort=popular`)}">View all ${raw(icon('arrow-right'))}</a>
            </div>
            <div class="product-grid" data-featured>${featured.map((p) => productCard(p, vendor)).join('')}</div>
          </div>
        </section>`
      : ''}

    ${bestSellers.length
      ? html`<section class="section-sm">
          <div class="container">
            <div class="card card-pad">
              <div class="card-head" style="padding:0 0 var(--sp-4);margin-bottom:var(--sp-4)">
                <div><h3 class="h4">Best sellers this month</h3><div class="sub">Most ordered from ${vendor.name}</div></div>
              </div>
              <div class="grid g-2">
                ${bestSellers.map((p, i) => html`
                  <div class="top-product">
                    <span class="tp-rank">${i + 1}</span>
                    <img src="${url(String(p.image || '').replace(/^\//, ''))}" alt="" width="54" height="54" loading="lazy"/>
                    <div class="tp-body">
                      <a class="nm clamp-1" href="${url(`vendor/product.html?vendor=${vendor.slug}&id=${p.id}`)}">${p.name}</a>
                      <div class="row text-sm muted" style="gap:10px">
                        <span>${raw(icon('cart'))} ${num(p.soldCount || 0)} sold</span>
                        <span>${raw(icon('star'))} ${Number(p.rating || 0).toFixed(1)}</span>
                      </div>
                    </div>
                    <div class="tp-right">${priceBlock(p)}
                      <button type="button" class="btn btn-sm btn-soft" data-add-cart="${p.id}">Add</button>
                    </div>
                  </div>`)}
              </div>
            </div>
          </div>
        </section>`
      : ''}

    ${newest.length
      ? html`<section class="section-sm">
          <div class="container">
            <div class="section-head">
              <div><span class="eyebrow">${raw(icon('clock'))} Fresh arrivals</span><h2 class="h3">New in store</h2></div>
            </div>
            <div class="product-grid">${newest.map((p) => productCard(p, vendor)).join('')}</div>
          </div>
        </section>`
      : ''}

    <section class="section-sm">
      <div class="container">
        <div class="card card-pad">
          <div class="sf-grid" style="grid-template-columns:1.4fr 1fr">
            <div class="sf-about">
              <h3 class="h4">About ${vendor.name}</h3>
              <p class="muted mt-2">${vendor.description || `${vendor.name} is a verified store on ${cfg.brand.shortName}, serving customers across India.`}</p>
              <div class="row row-wrap mt-4" style="gap:8px">
                ${vendor.tags?.map((t) => html`<span class="badge badge-outline">${t}</span>`)}
              </div>
            </div>
            <div>
              <h4 class="upper muted mb-4">Store information</h4>
              <div class="info-row"><span>${raw(icon('mail'))} Email</span><strong>${vendor.email || '—'}</strong></div>
              <div class="info-row"><span>${raw(icon('phone'))} Phone</span><strong>${vendor.phone || '—'}</strong></div>
              <div class="info-row"><span>${raw(icon('map-pin'))} Address</span><strong>${vendor.address || '—'}</strong></div>
              <div class="info-row"><span>${raw(icon('clock'))} Today</span><strong>${todayHours(vendor)}</strong></div>
            </div>
          </div>
        </div>
      </div>
    </section>

    ${reviews.length
      ? html`<section class="section-sm">
          <div class="container">
            <div class="section-head"><div><h2 class="h3">What customers say</h2><p class="sub">Reviews from verified buyers</p></div></div>
            <div class="quote-grid">
              ${reviews.slice(0, 3).map((r) => html`
                <article class="quote-card">
                  ${ratingStars(r.rating)}
                  <p class="q">“${r.body}”</p>
                  <div class="who">
                    <span class="avatar avatar-sm">${esc((r.author || 'C').slice(0, 1).toUpperCase())}</span>
                    <div><div class="n">${r.author}</div><div class="r">${r.productName || 'Verified purchase'} · ${dateShort(r.createdAt)}</div></div>
                  </div>
                </article>`)}
            </div>
          </div>
        </section>`
      : ''}`;

  bindProductActions(vendor, { products });
}

/* ============================================================ category */

export async function category() {
  const store = await bootStore({ activeNav: 'category' });
  if (!store) return;
  const { vendor, categories } = store;

  const host = $('[data-store-host]');
  host.innerHTML = html`
    <section class="section-sm">
      <div class="container">
        <nav class="breadcrumb mb-4" aria-label="Breadcrumb">
          <a href="${url(`vendor/index.html?vendor=${vendor.slug}`)}">Home</a>${raw(icon('chevron-right', 'sep'))}
          <span class="current">Products</span>
        </nav>

        <div class="mobile-filter-bar">
          <button type="button" class="btn btn-secondary" data-open-filters>${raw(icon('sliders'))} Filters</button>
          <div class="select-wrap grow">
            <select class="select" data-sort-top aria-label="Sort products">
              ${SORT_OPTIONS.map((o) => html`<option value="${o.value}">${o.label}</option>`)}
            </select>
            ${raw(icon('chevron-down', 'sel'))}
          </div>
        </div>

        <div class="catalogue">
          <aside class="filters" id="filters" data-filters aria-label="Product filters"></aside>
          <div>
            <div class="catalogue-head">
              <div>
                <h1 class="h3" data-result-title>All products</h1>
                <p class="sub" data-result-count>Loading products…</p>
              </div>
              <div class="select-wrap desktop-only">
                <select class="select sort-select" data-sort aria-label="Sort products">
                  ${SORT_OPTIONS.map((o) => html`<option value="${o.value}">${o.label}</option>`)}
                </select>
                ${raw(icon('chevron-down', 'sel'))}
              </div>
            </div>
            <div data-product-grid></div>
            <div class="mt-6" data-pagination></div>
          </div>
        </div>
      </div>
    </section>`;

  const grid = $('[data-product-grid]');
  const titleEl = $('[data-result-title]');
  const countEl = $('[data-result-count]');

  // Price bounds from the catalogue we already have (avoids an extra request).
  const prices = (await Api.products(vendor.slug, { limit: 48 })).map((p) => Number(p.pricePaise) || 0);
  const bounds = { min: 0, max: Math.max(1000, Math.ceil(Math.max(...prices, 1000) / 100) * 100) };

  let filters = readFiltersFromUrl();
  paintFilters();
  bindMobileFilters();

  // Sync the two sort controls. This is a declaration (rather than a const
  // arrow) because paintFilters() runs immediately below it and on initial load.
  function syncSort(value) {
    $$('[data-sort], [data-sort-top]').forEach((s) => { s.value = value; });
  }
  const onSort = (e) => {
    setQuery({ sort: e.target.value, page: null }, { replace: false });
    filters = readFiltersFromUrl();
    paintFilters();
    run();
  };
  $('[data-sort]')?.addEventListener('change', onSort);
  $('[data-sort-top]')?.addEventListener('change', onSort);

  document.addEventListener('filters:change', (e) => {
    filters = e.detail;
    syncSort(filters.sort);
    paintFilters();
    run();
  });

  function paintFilters() {
    renderFilters($('[data-filters]'), { vendor, categories, filters, priceBounds: bounds });
    syncSort(filters.sort);
    if (titleEl) {
      const cat = categories.find((c) => c.slug === filters.category);
      titleEl.textContent = filters.q ? `Results for “${filters.q}”` : cat ? cat.name : 'All products';
    }
    document.title = `${filters.q || titleEl?.textContent || 'Products'} · ${vendor.name} | ${cfg.brand.shortName}`;
  }

  async function run() {
    setLoading(countEl, true, 'Loading products…');
    const { items, pagination } = await loadCatalogue({ vendor, host: grid, paginationHost: $('[data-pagination]'), filters });
    if (countEl) {
      countEl.textContent = pagination
        ? `Showing ${num(items.length)} of ${num(pagination.totalItems)} products`
        : `${num(items.length)} products`;
    }
    bindProductActions(vendor, { products: items });
  }

  // Live search from the header search box.
  const searchForm = $('[data-store-search-form]');
  searchForm?.addEventListener('submit', (e) => {
    e.preventDefault();
    const q = $('[data-store-search]', searchForm).value.trim();
    setQuery({ q: q || null, page: null }, { replace: false });
    filters = readFiltersFromUrl();
    paintFilters();
    run();
  });
  $('[data-store-search]')?.addEventListener('input', debounce((e) => {
    setQuery({ q: e.target.value.trim() || null, page: null }, { replace: true });
    filters = readFiltersFromUrl();
    paintFilters();
    run();
  }, cfg.searchDebounceMs));

  run();
}

/* ============================================================= product */

export async function product() {
  const store = await bootStore({ activeNav: 'product' });
  if (!store) return;
  const { vendor, categories } = store;

  const id = qget('id');
  const host = $('[data-store-host]');
  if (!id) {
    globalThis.location.replace(url(`vendor/category.html?vendor=${vendor.slug}`));
    return;
  }

  host.innerHTML = `<div class="container section-sm"><div class="grid" style="grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:40px">
    <div><div class="skeleton sk-img" style="height:380px"></div></div>
    <div><div class="skeleton sk-title"></div><div class="skeleton sk-text"></div><div class="skeleton sk-row"></div><div class="skeleton sk-row"></div><div class="skeleton sk-btn"></div></div>
  </div></div>`;

  let data;
  try {
    data = await Api.product(vendor.slug, id);
  } catch (err) {
    host.innerHTML = `<div class="container section">${emptyState({ icon: 'package', title: 'Product not found', message: friendlyMessage(err), action: { label: 'Back to store', href: url(`vendor/index.html?vendor=${vendor.slug}`) } })}</div>`;
    return;
  }

  const { product, reviews, related, category } = data;
  applyProductSeo(vendor, product);
  renderProductDetail(host, { product, vendor, category, reviews, related });
  bindProductActions(vendor, { products: [product, ...(related || [])] });

  // JSON-LD structured data for rich search results (spec §39).
  const ld = document.createElement('script');
  ld.type = 'application/ld+json';
  ld.textContent = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: product.name,
    image: product.gallery || [product.image],
    description: product.shortDescription || product.description || '',
    sku: product.sku,
    brand: { '@type': 'Brand', name: vendor.name },
    offers: {
      '@type': 'Offer',
      priceCurrency: cfg.currency,
      price: (product.pricePaise / 100).toFixed(2),
      availability: product.inStock ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
      url: globalThis.location.href,
      seller: { '@type': 'Organization', name: vendor.name },
    },
    aggregateRating: product.reviewCount
      ? { '@type': 'AggregateRating', ratingValue: product.rating, reviewCount: product.reviewCount }
      : undefined,
  });
  document.head.appendChild(ld);
}

export default { storeHome, category, product };
