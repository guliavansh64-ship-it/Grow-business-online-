/**
 * pages/catalogue.js — Products, Categories and My Store (spec §15, §42).
 */
import Api, { friendlyMessage } from '../api.js';
import cfg from '../config.js';
import { $, $$, url, html, raw, esc, money, num, dateShort, debounce, qget, setQuery } from '../utils.js';
import { readForm, paintErrors, validators } from '../utils.js';
import { icon } from '../icons.js';
import { toast, toastSuccess, toastError, withButtonState, emptyState, setLoading, modal, confirmDialog } from '../ui.js';
import { table, paginationBar, statusBadge, PRODUCT_TONE, kpiGrid } from '../components.js';
import { dashPage } from './_dashBase.js';

/** The generated asset library offered by the image picker. */
const GLYPHS = ['bag', 'band', 'battery', 'belt', 'blazer', 'bottle', 'cable', 'camera', 'charger', 'earbuds', 'glasses', 'headphones', 'jar', 'jeans', 'keyboard', 'laptop', 'monitor', 'mouse', 'phone', 'pillow', 'shirt', 'shoe', 'speaker', 'vase', 'watch'];
const assetUrl = (glyph, variant) => `/assets/images/products/${glyph}-${variant}.svg`;

/* =============================================================== products */

export async function products() {
  const page = await dashPage({
    active: 'products',
    title: 'Products',
    subtitle: 'Your catalogue — prices and stock are yours to control',
    actions: html`<button type="button" class="btn btn-primary btn-sm" data-new-product>${raw(icon('plus'))} Add product</button>`,
  });
  if (!page) return;
  const { vendor, scroll } = page;

  const categories = await Api.vendorCategories().catch(() => []);
  const state = {
    q: qget('q') || '',
    status: qget('status') || '',
    category: qget('category') || '',
    page: Number(qget('page') || 1),
    limit: cfg.pageSize,
  };

  scroll.innerHTML = html`
    <div data-product-kpis class="mb-6"></div>
    <div class="card">
      <div class="card-pad pb-0">
        <div class="toolbar">
          <div class="toolbar-left">
            <div class="chip-row" data-status-chips>
              ${[['', 'All'], ['active', 'Live'], ['draft', 'Drafts'], ['low', 'Low stock'], ['out', 'Out of stock']].map(([v, l]) => html`<button type="button" class="chip ${state.status === v ? 'is-active' : ''}" data-status-value="${v}">${l}</button>`)}
            </div>
          </div>
          <div class="toolbar-right">
            <form class="tb-search-form" data-search-form role="search">
              <div class="input-group">${raw(icon('search', 'ico'))}<input class="input" type="search" name="q" value="${state.q}" placeholder="Search products or SKU…" aria-label="Search products"/></div>
            </form>
            <div class="select-wrap">
              <select class="select" data-category-filter aria-label="Filter by category">
                <option value="">All categories</option>
                ${categories.map((c) => html`<option value="${c.id}" ${state.category === c.id ? 'selected' : ''}>${c.name}</option>`)}
              </select>
              ${raw(icon('chevron-down', 'sel'))}
            </div>
          </div>
        </div>
      </div>
      <div data-product-table><div class="card-pad"><div class="skeleton sk-row"></div><div class="skeleton sk-row"></div><div class="skeleton sk-row"></div></div></div>
      <div class="card-pad pt-0"><div data-pagination></div></div>
    </div>`;

  const host = $('[data-product-table]');
  let items = [];

  const load = async () => {
    setLoading(host, true, `<div class="card-pad">${'<div class="skeleton sk-row"></div>'.repeat(6)}</div>`);
    try {
      const res = await Api.paged('/vendor/products', { q: state.q || undefined, status: state.status || undefined, category: state.category || undefined, page: state.page, limit: state.limit });
      items = res.items;
      const counts = { all: res.pagination?.totalItems ?? items.length };
      $('[data-product-kpis]').innerHTML = kpiGrid([
        { label: 'Products', value: num(res.pagination?.totalItems ?? items.length), sub: 'In your catalogue', icon: 'package', tone: 'brand' },
        { label: 'Low stock', value: num(items.filter((p) => p.stock > 0 && p.stock <= (p.lowStockAt || 5)).length), sub: 'On this page', icon: 'alert-triangle', tone: 'warning' },
        { label: 'Out of stock', value: num(items.filter((p) => p.stock === 0).length), sub: 'On this page', icon: 'x-circle', tone: 'danger' },
        { label: 'Catalogue value', value: money(items.reduce((a, p) => a + p.pricePaise * p.stock, 0), { decimals: 0 }), sub: 'Stock × price (this page)', icon: 'rupee', tone: 'success' },
      ]);
      void counts;

      if (!items.length) {
        host.innerHTML = `<div class="card-pad">${emptyState({
          icon: 'package',
          title: state.q || state.status || state.category ? 'No products match those filters' : 'No products yet',
          message: state.q || state.status || state.category ? 'Try clearing the search or filters.' : 'Add your first product and it appears in your store straight away.',
          action: state.q || state.status || state.category ? { label: 'Clear filters', onClick: () => { setQuery({}, { replace: true }); globalThis.location.reload(); } } : { label: 'Add your first product', onClick: () => openProductForm(null, categories) },
        })}</div>`;
        $('[data-pagination]').innerHTML = '';
        setLoading(host, false);
        return;
      }

      host.innerHTML = table({
        columns: [
          {
            key: 'name',
            label: 'Product',
            render: (p) => html`
              <span class="cell-product">
                ${p.image ? html`<img src="${url(String(p.image).replace(/^\//, ''))}" alt="" width="42" height="42" loading="lazy"/>` : '<span class="thumb thumb-empty"></span>'}
                <span class="meta">
                  <span class="n">${p.name}</span>
                  <span class="s mono">${p.sku}${p.featured ? ' · ★ featured' : ''}</span>
                </span>
              </span>`,
          },
          { key: 'category', label: 'Category', render: (p) => html`<span class="muted text-sm">${esc(categories.find((c) => c.id === p.categoryId)?.name || '—')}</span>` },
          {
            key: 'pricePaise',
            label: 'Price',
            align: 'right',
            render: (p) => html`<strong class="ink">${money(p.pricePaise)}</strong>${p.mrpPaise > p.pricePaise ? html`<span class="muted text-xs" style="display:block;text-decoration:line-through">${money(p.mrpPaise)}</span>` : ''}`,
          },
          {
            key: 'stock',
            label: 'Stock',
            align: 'right',
            render: (p) => (p.stock === 0
              ? html`<span class="badge badge-danger">Out</span>`
              : p.stock <= (p.lowStockAt || 5)
                ? html`<span class="badge badge-warning">${num(p.stock)} left</span>`
                : html`<span class="ink">${num(p.stock)}</span>`),
          },
          { key: 'soldCount', label: 'Sold', align: 'right', render: (p) => html`<span class="muted">${num(p.soldCount || 0)}</span>` },
          { key: 'status', label: 'Status', render: (p) => statusBadge(p.status, PRODUCT_TONE) },
          {
            key: 'actions',
            label: '',
            align: 'right',
            render: (p) => html`
              <span class="table-actions">
                <a class="icon-btn" href="${url(`vendor/product.html?vendor=${vendor.slug}&id=${p.id}`)}" target="_blank" rel="noopener" aria-label="View in store" title="View in store">${raw(icon('external'))}</a>
                <button type="button" class="icon-btn" data-edit="${p.id}" aria-label="Edit ${esc(p.name)}" title="Edit">${raw(icon('edit'))}</button>
                <button type="button" class="icon-btn" data-dup="${p.id}" aria-label="Duplicate" title="Duplicate">${raw(icon('copy'))}</button>
                <button type="button" class="icon-btn danger" data-del="${p.id}" aria-label="Delete" title="Delete">${raw(icon('trash'))}</button>
              </span>`,
          },
        ],
        rows: items,
        empty: 'No products found.',
      });
      $('[data-pagination]').innerHTML = res.pagination ? paginationBar(res.pagination) : '';
      setLoading(host, false);
      bindRowActions();
    } catch (err) {
      setLoading(host, false);
      host.innerHTML = `<div class="card-pad">${emptyState({ icon: 'alert-triangle', title: 'Could not load products', message: friendlyMessage(err) })}</div>`;
    }
  };

  const bindRowActions = () => {
    $$('[data-edit]', host).forEach((btn) => btn.addEventListener('click', () => openProductForm(items.find((p) => p.id === btn.dataset.edit), categories, load)));
    $$('[data-dup]', host).forEach((btn) => btn.addEventListener('click', () => {
      const src = items.find((p) => p.id === btn.dataset.dup);
      if (!src) return;
      openProductForm({ ...src, id: null, name: `${src.name} (copy)`, sku: '', soldCount: 0, rating: 0 }, categories, load);
    }));
    $$('[data-del]', host).forEach((btn) => btn.addEventListener('click', async () => {
      const p = items.find((x) => x.id === btn.dataset.del);
      const yes = await confirmDialog({
        title: `Delete “${p.name}”?`,
        message: 'If this product already has orders it will be archived instead of deleted, so your sales history stays intact.',
        confirmLabel: 'Delete product',
        danger: true,
      });
      if (!yes) return;
      try {
        const res = await Api.deleteProduct(p.id);
        toast(res.message || (res.archived ? 'Product archived.' : 'Product deleted.'), { type: res.archived ? 'info' : 'success' });
        load();
      } catch (err) {
        toastError(friendlyMessage(err));
      }
    }));
  };

  $$('[data-status-value]').forEach((chip) => chip.addEventListener('click', () => {
    $$('[data-status-value]').forEach((c) => c.classList.remove('is-active'));
    chip.classList.add('is-active');
    state.status = chip.dataset.statusValue;
    state.page = 1;
    setQuery({ status: state.status || null, page: null }, { replace: true });
    load();
  }));

  $('[data-search-form]').addEventListener('submit', (e) => { e.preventDefault(); state.q = e.target.q.value.trim(); state.page = 1; load(); });
  $('[data-search-form] input').addEventListener('input', debounce((e) => { state.q = e.target.value.trim(); state.page = 1; setQuery({ q: state.q || null }, { replace: true }); load(); }, cfg.searchDebounceMs));
  $('[data-category-filter]').addEventListener('change', (e) => { state.category = e.target.value; state.page = 1; setQuery({ category: state.category || null }, { replace: true }); load(); });
  $('[data-pagination]').addEventListener('click', (e) => {
    const link = e.target.closest('[data-page]');
    if (!link || link.getAttribute('aria-disabled') === 'true') return;
    e.preventDefault();
    state.page = Number(link.dataset.page);
    setQuery({ page: state.page > 1 ? state.page : null }, { replace: true });
    load();
  });

  $('[data-new-product]').addEventListener('click', () => openProductForm(null, categories, load));
  if (qget('new')) openProductForm(null, categories, load);
  if (qget('edit')) {
    Api.vendorProduct(qget('edit')).then((data) => openProductForm(data.product, categories, load)).catch(() => {});
  }
  await load();
}

/* ------------------------------------------------------- product form modal */

function openProductForm(existing, categories, onSaved = () => {}) {
  const p = existing || {};
  const specs = Array.isArray(p.specs) ? p.specs : [];

  modal({
    size: 'lg',
    title: p.id ? `Edit ${p.name}` : 'Add a product',
    description: p.id ? 'Changes go live in your store immediately.' : 'It appears in your storefront as soon as you save.',
    body: html`
      <form class="stack" data-product-form>
        <div class="product-form-grid">
          <div class="field span-2" data-field="name">
            <label class="label" for="pf-name">Product name</label>
            <input class="input" id="pf-name" name="name" value="${p.name || ''}" maxlength="120" placeholder="e.g. Wireless Noise-Cancelling Headphones" data-autofocus/>
            <span class="error-text" data-error></span>
          </div>

          <div class="field" data-field="price">
            <label class="label" for="pf-price">Selling price (₹)</label>
            <div class="input-group"><span class="prefix">₹</span><input class="input" id="pf-price" name="price" type="number" step="0.01" min="1" value="${p.priceRupees ?? ''}" placeholder="1499"/></div>
            <span class="error-text" data-error></span>
          </div>
          <div class="field" data-field="mrp">
            <label class="label" for="pf-mrp">MRP (₹) <span class="opt">optional</span></label>
            <div class="input-group"><span class="prefix">₹</span><input class="input" id="pf-mrp" name="mrp" type="number" step="0.01" min="1" value="${p.mrpRupees ?? ''}" placeholder="1999"/></div>
            <span class="hint" data-discount-hint></span>
          </div>

          <div class="field" data-field="stock">
            <label class="label" for="pf-stock">Stock quantity</label>
            <input class="input" id="pf-stock" name="stock" type="number" min="0" max="100000" value="${p.stock ?? 0}"/>
            <span class="error-text" data-error></span>
          </div>
          <div class="field" data-field="lowStockAt">
            <label class="label" for="pf-low">Low stock alert at</label>
            <input class="input" id="pf-low" name="lowStockAt" type="number" min="0" max="1000" value="${p.lowStockAt ?? 5}"/>
          </div>

          <div class="field" data-field="sku">
            <label class="label" for="pf-sku">SKU <span class="opt">auto-generated if blank</span></label>
            <input class="input mono" id="pf-sku" name="sku" value="${p.sku || ''}" maxlength="40" placeholder="TM-HEAD-01"/>
            <span class="error-text" data-error></span>
          </div>
          <div class="field" data-field="categoryId">
            <label class="label" for="pf-cat">Category</label>
            <div class="select-wrap">
              <select class="select" id="pf-cat" name="categoryId">
                <option value="">Uncategorised</option>
                ${categories.map((c) => html`<option value="${c.id}" ${p.categoryId === c.id ? 'selected' : ''}>${c.name}</option>`)}
              </select>
              ${raw(icon('chevron-down', 'sel'))}
            </div>
          </div>

          <div class="field span-2" data-field="shortDescription">
            <label class="label" for="pf-short">Short description</label>
            <input class="input" id="pf-short" name="shortDescription" maxlength="200" value="${p.shortDescription || ''}" placeholder="One line customers see on the product card"/>
          </div>
          <div class="field span-2" data-field="description">
            <label class="label" for="pf-desc">Full description</label>
            <textarea class="textarea" id="pf-desc" name="description" rows="4" maxlength="4000" placeholder="Features, materials, what is in the box…">${p.description || ''}</textarea>
          </div>

          <div class="field" data-field="unit">
            <label class="label" for="pf-unit">Unit</label>
            <input class="input" id="pf-unit" name="unit" maxlength="20" value="${p.unit || 'pcs'}" placeholder="pcs / kg / pack of 2"/>
          </div>
          <div class="field" data-field="tags">
            <label class="label" for="pf-tags">Tags <span class="opt">comma separated</span></label>
            <input class="input" id="pf-tags" name="tags" value="${(p.tags || []).join(', ')}" placeholder="gift, bestselling"/>
          </div>
        </div>

        <div class="field" data-field="image">
          <label class="label">Product image</label>
          <div class="image-picker">
            <div class="image-preview" data-image-preview>
              ${p.image ? html`<img src="${url(String(p.image).replace(/^\//, ''))}" alt="Current product image"/>` : raw(icon('image'))}
            </div>
            <div class="grow stack-xs">
              <input class="input" name="image" value="${p.image || ''}" placeholder="/assets/images/products/headphones-1.svg or https://…"/>
              <p class="hint">Pick from the bundled library, or paste any image URL (WebP/AVIF/JPG). Uploads need a storage bucket — see docs/DEPLOYMENT.md.</p>
              <button type="button" class="btn btn-sm btn-secondary" data-open-library>${raw(icon('grid'))} Browse image library</button>
            </div>
          </div>
        </div>

        <div class="field">
          <label class="label">Specifications</label>
          <div class="spec-editor" data-spec-editor>
            ${specs.map((s, i) => specRow(Array.isArray(s) ? s[0] : s.label, Array.isArray(s) ? s[1] : s.value, i))}
          </div>
          <button type="button" class="btn btn-sm btn-ghost mt-2" data-add-spec>${raw(icon('plus'))} Add specification</button>
        </div>

        <div class="row row-wrap" style="gap:16px">
          <label class="check"><input type="checkbox" name="featured" ${p.featured ? 'checked' : ''}/><span class="box">${raw(icon('check'))}</span><span class="text">Feature on the store home</span></label>
          <label class="check"><input type="checkbox" name="status" value="draft" ${p.status === 'draft' ? 'checked' : ''}/><span class="box">${raw(icon('check'))}</span><span class="text">Save as draft (hidden from customers)</span></label>
        </div>
      </form>`,
    footer: html`
      <button type="button" class="btn btn-secondary" data-close>Cancel</button>
      <button type="button" class="btn btn-primary" data-save-product data-label="${p.id ? 'Save changes' : 'Add product'}">${p.id ? 'Save changes' : 'Add product'}</button>`,
    onMount: ({ root, close }) => {
      const form = $('[data-product-form]', root);
      const price = $('[name="price"]', form);
      const mrp = $('[name="mrp"]', form);
      const hint = $('[data-discount-hint]', form);
      const discountHint = () => {
        const a = Number(price.value);
        const b = Number(mrp.value);
        hint.textContent = a && b && b > a ? `Customers see ${Math.round(((b - a) / b) * 100)}% off.` : '';
      };
      price.addEventListener('input', discountHint);
      mrp.addEventListener('input', discountHint);
      discountHint();

      // ---- spec editor
      const specHost = $('[data-spec-editor]', root);
      $('[data-add-spec]', root).addEventListener('click', () => {
        const node = document.createElement('div');
        node.innerHTML = specRow('', '', specHost.children.length);
        specHost.appendChild(node.firstElementChild);
      });
      specHost.addEventListener('click', (e) => {
        const rm = e.target.closest('[data-remove-spec]');
        if (rm) rm.closest('.spec-row').remove();
      });

      // ---- image library
      $('[data-open-library]', root).addEventListener('click', () => {
        const picker = modal({
          size: 'lg',
          title: 'Image library',
          description: 'Bundled, licence-free product illustrations. Click one to use it.',
          body: html`
            <div class="stack">
              <div class="input-group">${raw(icon('search', 'ico'))}<input class="input" type="search" placeholder="Filter library…" data-lib-search aria-label="Filter images"/></div>
              <div class="image-library" data-lib-grid>
                ${GLYPHS.flatMap((g) => [1, 2, 3, 4].map((v) => html`
                  <button type="button" class="lib-tile" data-lib="${assetUrl(g, v)}" data-glyph="${g}" title="${g}-${v}">
                    <img src="${url(assetUrl(g, v).replace(/^\//, ''))}" alt="${g} illustration ${v}" loading="lazy" width="72" height="72"/>
                  </button>`))}
              </div>
            </div>`,
          onMount: ({ root: libRoot, close: closeLib }) => {
            const grid = $('[data-lib-grid]', libRoot);
            $('[data-lib-search]', libRoot).addEventListener('input', debounce((e) => {
              const q = e.target.value.trim().toLowerCase();
              $$('.lib-tile', grid).forEach((t) => { t.classList.toggle('hidden', q && !t.dataset.glyph.includes(q)); });
            }, 180));
            grid.addEventListener('click', (e) => {
              const tile = e.target.closest('[data-lib]');
              if (!tile) return;
              $('[name="image"]', form).value = tile.dataset.lib;
              $('[data-image-preview]', root).innerHTML = `<img src="${url(tile.dataset.lib.replace(/^\//, ''))}" alt="Selected product image"/>`;
              closeLib();
            });
          },
        });
        void picker;
      });

      $('[name="image"]', form).addEventListener('input', debounce((e) => {
        const value = e.target.value.trim();
        $('[data-image-preview]', root).innerHTML = value
          ? `<img src="${url(value.replace(/^\//, ''))}" alt="Product image preview" onerror="this.replaceWith(Object.assign(document.createElement('span'),{textContent:'Could not load that image'}))"/>`
          : icon('image');
      }, 300));

      // ---- save
      $('[data-save-product]', root).addEventListener('click', async (e) => {
        const btn = e.currentTarget;
        const { values, errors, valid } = readForm(form, {
          name: [validators.required, validators.minLen(3)],
          price: [validators.required, validators.min(1)],
          mrp: [validators.min(0)],
          stock: [validators.required, validators.min(0)],
        });
        paintErrors(form, errors);
        if (!valid) {
          toastError('Check the highlighted fields.');
          return;
        }
        const specsOut = $$('.spec-row', specHost).map((row) => ({
          label: $('[name="specLabel"]', row).value.trim(),
          value: $('[name="specValue"]', row).value.trim(),
        })).filter((s) => s.label);

        const payload = {
          name: values.name,
          price: Number(values.price),
          mrp: values.mrp ? Number(values.mrp) : undefined,
          stock: Number(values.stock),
          lowStockAt: Number(values.lowStockAt || 5),
          sku: values.sku || undefined,
          categoryId: values.categoryId || null,
          shortDescription: values.shortDescription,
          description: values.description,
          unit: values.unit || 'pcs',
          image: values.image,
          gallery: values.image ? [values.image] : [],
          specs: specsOut,
          tags: String(values.tags || '').split(',').map((t) => t.trim()).filter(Boolean),
          featured: !!values.featured,
          status: values.status === 'draft' ? 'draft' : Number(values.stock) > 0 ? 'active' : 'out_of_stock',
        };

        await withButtonState(btn, async () => {
          try {
            const res = p.id ? await Api.updateProduct(p.id, payload) : await Api.createProduct(payload);
            toastSuccess(res.message || 'Saved.');
            close();
            onSaved();
          } catch (err) {
            toastError(friendlyMessage(err), { title: 'Could not save the product' });
          }
        });
      });
    },
  });
}

const specRow = (label = '', value = '', i = 0) => html`
  <div class="spec-row">
    <input class="input" name="specLabel" value="${label}" placeholder="Label (e.g. Battery)" aria-label="Specification ${i + 1} label"/>
    <input class="input" name="specValue" value="${value}" placeholder="Value (e.g. 40 hours)" aria-label="Specification ${i + 1} value"/>
    <button type="button" class="icon-btn danger" data-remove-spec aria-label="Remove specification">${raw(icon('trash'))}</button>
  </div>`;

/* ============================================================= categories */

export async function categories() {
  const page = await dashPage({
    active: 'categories',
    title: 'Categories',
    subtitle: 'How customers navigate your store',
    actions: html`<button type="button" class="btn btn-primary btn-sm" data-new-category>${raw(icon('plus'))} Add category</button>`,
  });
  if (!page) return;
  const { scroll } = page;

  scroll.innerHTML = html`
    <div class="card">
      <div class="card-head"><div><h3 class="h4">Your categories</h3><div class="sub">Drag order is set with the sort field. Empty categories can be deleted.</div></div></div>
      <div data-category-list><div class="card-pad"><div class="skeleton sk-row"></div><div class="skeleton sk-row"></div></div></div>
    </div>`;

  const host = $('[data-category-list]');
  let items = [];

  const load = async () => {
    setLoading(host, true, `<div class="card-pad">${'<div class="skeleton sk-row"></div>'.repeat(4)}</div>`);
    try {
      items = await Api.vendorCategories();
      setLoading(host, false);
      if (!items.length) {
        host.innerHTML = `<div class="card-pad">${emptyState({ icon: 'layers', title: 'No categories yet', message: 'Categories help customers find products faster. Add your first one.', action: { label: 'Add category', onClick: () => openCategoryForm(null, load) } })}</div>`;
        return;
      }
      host.innerHTML = table({
        columns: [
          { key: 'name', label: 'Category', render: (c) => html`<span class="cell-product"><span class="meta"><span class="n">${c.name}</span><span class="s mono">${c.slug}</span></span></span>` },
          { key: 'description', label: 'Description', render: (c) => html`<span class="muted text-sm clamp-1">${c.description || '—'}</span>` },
          { key: 'productCount', label: 'Products', align: 'right', render: (c) => html`<span class="badge ${c.productCount ? 'badge-soft' : 'badge-outline'}">${num(c.productCount)}</span>` },
          { key: 'sortOrder', label: 'Order', align: 'right', render: (c) => html`<span class="muted">${num(c.sortOrder)}</span>` },
          { key: 'active', label: 'Visible', render: (c) => html`<label class="switch"><input type="checkbox" data-toggle="${c.id}" ${c.active ? 'checked' : ''}/><span class="track"></span></label>` },
          {
            key: 'actions',
            label: '',
            align: 'right',
            render: (c) => html`
              <span class="table-actions">
                <a class="icon-btn" href="${url(`vendor/category.html?vendor=${page.vendor.slug}&category=${c.slug}`)}" target="_blank" rel="noopener" title="View in store">${raw(icon('external'))}</a>
                <button type="button" class="icon-btn" data-edit-cat="${c.id}" title="Edit">${raw(icon('edit'))}</button>
                <button type="button" class="icon-btn danger" data-del-cat="${c.id}" title="Delete">${raw(icon('trash'))}</button>
              </span>`,
          },
        ],
        rows: items,
        empty: 'No categories.',
      });

      $$('[data-toggle]', host).forEach((input) => input.addEventListener('change', async () => {
        const c = items.find((x) => x.id === input.dataset.toggle);
        try {
          await Api.updateCategory(c.id, { active: input.checked });
          toast(input.checked ? 'Category is visible in your store.' : 'Category hidden from your store.', { type: 'success', duration: 2200 });
        } catch (err) {
          input.checked = !input.checked;
          toastError(friendlyMessage(err));
        }
      }));
      $$('[data-edit-cat]', host).forEach((btn) => btn.addEventListener('click', () => openCategoryForm(items.find((c) => c.id === btn.dataset.editCat), load)));
      $$('[data-del-cat]', host).forEach((btn) => btn.addEventListener('click', async () => {
        const c = items.find((x) => x.id === btn.dataset.delCat);
        if (c.productCount) {
          toastError(`Move or delete the ${c.productCount} product(s) in “${c.name}” first.`);
          return;
        }
        const yes = await confirmDialog({ title: `Delete “${c.name}”?`, message: 'This cannot be undone.', confirmLabel: 'Delete', danger: true });
        if (!yes) return;
        try {
          const res = await Api.deleteCategory(c.id);
          toastSuccess(res.message || 'Category deleted.');
          load();
        } catch (err) {
          toastError(friendlyMessage(err));
        }
      }));
    } catch (err) {
      setLoading(host, false);
      host.innerHTML = `<div class="card-pad">${emptyState({ icon: 'alert-triangle', title: 'Could not load categories', message: friendlyMessage(err) })}</div>`;
    }
  };

  const openCategoryForm = (existing, onSaved) => {
    const c = existing || {};
    modal({
      title: existing ? `Edit ${c.name}` : 'Add a category',
      body: html`
        <form class="stack" data-category-form>
          <div class="field" data-field="name">
            <label class="label" for="cf-name">Category name</label>
            <input class="input" id="cf-name" name="name" value="${c.name || ''}" maxlength="60" placeholder="e.g. Audio" data-autofocus/>
            <span class="error-text" data-error></span>
          </div>
          <div class="field" data-field="description">
            <label class="label" for="cf-desc">Description <span class="opt">optional</span></label>
            <textarea class="textarea" id="cf-desc" name="description" rows="2" maxlength="300">${c.description || ''}</textarea>
          </div>
          <div class="form-grid">
            <div class="field" data-field="image">
              <label class="label" for="cf-image">Image URL <span class="opt">optional</span></label>
              <input class="input" id="cf-image" name="image" value="${c.image || ''}" placeholder="/assets/images/products/headphones-1.svg"/>
            </div>
            <div class="field" data-field="sortOrder">
              <label class="label" for="cf-sort">Sort order</label>
              <input class="input" id="cf-sort" name="sortOrder" type="number" min="0" max="999" value="${c.sortOrder ?? 0}"/>
            </div>
          </div>
          <label class="check"><input type="checkbox" name="active" ${c.active === false ? '' : 'checked'}/><span class="box">${raw(icon('check'))}</span><span class="text">Show in my store</span></label>
        </form>`,
      footer: html`<button type="button" class="btn btn-secondary" data-close>Cancel</button><button type="button" class="btn btn-primary" data-save-category data-label="Save category">Save category</button>`,
      onMount: ({ root, close }) => {
        $('[data-save-category]', root).addEventListener('click', async (e) => {
          const form = $('[data-category-form]', root);
          const { values, errors, valid } = readForm(form, { name: [validators.required, validators.minLen(2)] });
          paintErrors(form, errors);
          if (!valid) return;
          const payload = { name: values.name, description: values.description, image: values.image, sortOrder: Number(values.sortOrder || 0), active: !!values.active };
          await withButtonState(e.currentTarget, async () => {
            try {
              const res = existing ? await Api.updateCategory(existing.id, payload) : await Api.createCategory(payload);
              toastSuccess(res.message || 'Category saved.');
              close();
              onSaved();
            } catch (err) {
              toastError(friendlyMessage(err));
            }
          });
        });
      },
    });
  };

  $('[data-new-category]').addEventListener('click', () => openCategoryForm(null, load));
  await load();
}

/* =============================================================== my store */

export async function myStore() {
  const page = await dashPage({
    active: 'store',
    title: 'My Store',
    subtitle: 'Preview exactly what your customers see',
    actions: html`
      <a class="btn btn-secondary btn-sm" href="${url('vendor/index.html')}" data-open-store target="_blank" rel="noopener">${raw(icon('external'))} Open in new tab</a>
      <a class="btn btn-primary btn-sm" href="${url('admin/settings.html')}">${raw(icon('settings'))} Store settings</a>`,
  });
  if (!page) return;
  const { vendor, scroll } = page;
  const openStore = $('[data-open-store]');
  if (openStore) openStore.href = `${url('vendor/index.html')}?vendor=${encodeURIComponent(vendor.slug)}`;

  const previewUrl = `${url(`vendor/index.html`)}?vendor=${vendor.slug}`;
  scroll.innerHTML = html`
    <div class="dash-grid dash-main">
      <div class="card card-pad">
        <div class="chart-head">
          <div><h3 class="h4">Live preview</h3><div class="sub mono">${vendor.slug}.${cfg.rootDomain}</div></div>
          <div class="chip-row" data-preview-mode>
            <button type="button" class="chip is-active" data-mode="desktop">${raw(icon('monitor'))} Desktop</button>
            <button type="button" class="chip" data-mode="mobile">${raw(icon('smartphone'))} Mobile</button>
          </div>
        </div>
        <div class="preview-frame" data-preview-frame>
          <iframe src="${previewUrl}" title="Store preview" loading="lazy" referrerpolicy="no-referrer"></iframe>
        </div>
        <p class="hint mt-3">${raw(icon('info'))} This is your real storefront, loaded in an iframe. Changes to settings appear here after a refresh.</p>
      </div>

      <div class="stack">
        <div class="card card-pad">
          <h3 class="h4 mb-4">Store health</h3>
          <div data-store-health><div class="skeleton sk-row"></div><div class="skeleton sk-row"></div></div>
        </div>
        <div class="card card-pad">
          <h3 class="h4 mb-4">Branding</h3>
          <div class="stack-xs">
            <div class="info-row"><span>Logo</span><strong>${vendor.logo ? 'Set' : 'Missing'}</strong></div>
            <div class="info-row"><span>Banner</span><strong>${vendor.banner ? 'Set' : 'Missing'}</strong></div>
            <div class="info-row"><span>Favicon</span><strong>${vendor.favicon ? 'Set' : 'Missing'}</strong></div>
            <div class="info-row"><span>Theme colour</span><strong><span class="swatch-dot" style="background:${esc(vendor.theme?.primary || '#6D5EF6')}"></span> ${esc(vendor.theme?.primary || 'Default')}</strong></div>
            <div class="info-row"><span>Tagline</span><strong>${vendor.tagline || 'Missing'}</strong></div>
          </div>
          <a class="btn btn-secondary btn-block mt-4" href="${url('admin/settings.html')}">${raw(icon('edit'))} Edit branding</a>
        </div>
        <div class="card card-pad">
          <h3 class="h4 mb-4">Store address</h3>
          <p class="mono text-sm" data-store-address>${vendor.slug}.${cfg.rootDomain}</p>
          <button type="button" class="btn btn-ghost btn-sm mt-2" data-copy-address>${raw(icon('copy'))} Copy</button>
          <p class="hint mt-3">Point a subdomain (or wildcard DNS) at your Hostinger frontend so this address resolves. See docs/DEPLOYMENT.md.</p>
        </div>
      </div>
    </div>`;

  $$('[data-mode]').forEach((chip) => chip.addEventListener('click', () => {
    $$('[data-mode]').forEach((c) => c.classList.remove('is-active'));
    chip.classList.add('is-active');
    $('[data-preview-frame]').classList.toggle('is-mobile', chip.dataset.mode === 'mobile');
  }));

  $('[data-copy-address]').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(`${vendor.slug}.${cfg.rootDomain}`);
      toast('Store address copied.', { type: 'success', duration: 2000 });
    } catch {
      toastError('Could not copy — select the text instead.');
    }
  });

  try {
    const [stats, cats] = await Promise.all([Api.dashboard(7).catch(() => null), Api.vendorCategories().catch(() => [])]);
    const k = stats?.kpis || {};
    $('[data-store-health]').innerHTML = html`
      <div class="info-row"><span>${raw(icon('package'))} Products live</span><strong>${num(k.activeProducts || 0)} / ${num(k.products || 0)}</strong></div>
      <div class="info-row"><span>${raw(icon('layers'))} Categories</span><strong>${num(cats.filter((c) => c.active).length)}</strong></div>
      <div class="info-row"><span>${raw(icon('alert-triangle'))} Low or out of stock</span><strong>${num((k.lowStock || 0) + (k.outOfStock || 0))}</strong></div>
      <div class="info-row"><span>${raw(icon('star'))} Store rating</span><strong>${Number(k.rating || vendor.rating || 0).toFixed(1)} (${num(k.reviewCount || vendor.reviewCount || 0)})</strong></div>
      <div class="info-row"><span>${raw(icon('receipt'))} Orders (7 days)</span><strong>${num(k.totalOrders || 0)}</strong></div>
      <div class="info-row"><span>${raw(icon('shield-check'))} Store status</span><strong>${statusBadge(vendor.status, { active: 'badge-success', pending_activation: 'badge-warning', suspended: 'badge-danger' })}</strong></div>`;
  } catch {
    $('[data-store-health]').innerHTML = `<p class="muted text-sm">Store health is unavailable right now.</p>`;
  }
}

export default { products, categories, myStore };
