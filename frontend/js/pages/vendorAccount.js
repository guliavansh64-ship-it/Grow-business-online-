/**
 * pages/vendorAccount.js — Store Settings, Profile and Support (spec §33–§35).
 */
import Api, { friendlyMessage } from '../api.js';
import cfg from '../config.js';
import { $, $$, url, html, raw, esc, money, num, qget } from '../utils.js';
import { readForm, paintErrors, validators } from '../utils.js';
import { icon } from '../icons.js';
import { toast, toastSuccess, toastError, withButtonState, emptyState, setLoading, modal } from '../ui.js';
import { applyVendorTheme, clearVendorTheme, currentTheme } from '../theme.js';
import { applyVendorSeo } from '../seo.js';
import { infoRow, statusBadge } from '../components.js';
import { dashPage } from './_dashBase.js';

const BUSINESS_TYPES = [
  'Electronics Retail', 'Fashion & Apparel', 'Grocery & Organics', 'Home & Living',
  'Beauty & Wellness', 'Sports & Fitness', 'Books & Stationery', 'Handmade & Crafts', 'Services', 'Other',
];
const DAYS = [['mon', 'Monday'], ['tue', 'Tuesday'], ['wed', 'Wednesday'], ['thu', 'Thursday'], ['fri', 'Friday'], ['sat', 'Saturday'], ['sun', 'Sunday']];
const LOGOS = ['growbusiness', 'techmart', 'stylehub', 'freshkart', 'homely', 'wordmark'].map((s) => `/assets/images/logos/${s}.svg`);
const BANNERS = ['techmart', 'stylehub', 'freshkart', 'homely'].map((s) => `/assets/images/banners/${s}.svg`);
const SWATCHES = ['#6D5EF6', '#4F46E5', '#0EA5E9', '#0D9488', '#16A34A', '#D97706', '#DC2626', '#DB2777', '#7C3AED', '#0B1020'];

/* ============================================================== settings */

export async function settings() {
  const page = await dashPage({
    active: 'settings',
    title: 'Store Settings',
    subtitle: 'Branding, business details and how your storefront looks',
    actions: html`<a class="btn btn-secondary btn-sm" href="${url('vendor/index.html')}" target="_blank" rel="noopener">${raw(icon('external'))} Preview store</a>`,
  });
  if (!page) return;
  const { scroll, vendor: bootVendor } = page;

  scroll.innerHTML = `<div class="skeleton sk-card" style="height:120px"></div><div class="skeleton sk-card mt-4" style="height:420px"></div>`;

  let v;
  try {
    v = await Api.storeSettings();
  } catch (err) {
    scroll.innerHTML = emptyState({ icon: 'alert-triangle', title: 'Could not load your store settings', message: friendlyMessage(err), action: { label: 'Try again', href: url('admin/settings.html') } });
    return;
  }

  const tab = qget('tab') || 'branding';
  const TABS = [
    { id: 'branding', label: 'Branding', icon: 'palette' },
    { id: 'business', label: 'Business details', icon: 'building' },
    { id: 'hours', label: 'Hours & social', icon: 'clock' },
    { id: 'payments', label: 'Payments & SEO', icon: 'credit' },
  ];

  scroll.innerHTML = html`
    <div class="settings-grid">
      <nav class="settings-nav" data-settings-nav>
        ${TABS.map((t) => html`<a href="#${t.id}" data-tab="${t.id}" class="${t.id === tab ? 'is-active' : ''}">${raw(icon(t.icon))}<span>${t.label}</span></a>`)}
        <a href="${url('admin/profile.html')}">${raw(icon('user'))}<span>Your profile</span></a>
        <a href="${url('admin/support.html')}">${raw(icon('message'))}<span>Support</span></a>
      </nav>

      <form class="stack-lg" data-settings-form>
        <!-- ---------------------------------------------------- branding -->
        <section class="card card-pad" id="branding" data-panel="branding">
          <div class="card-head" style="padding:0 0 var(--sp-4);margin-bottom:var(--sp-4)">
            <div><h3 class="h4">Store branding</h3><div class="sub">This is what customers see on ${v.slug}.${cfg.rootDomain}</div></div>
          </div>

          <div class="form-grid">
            <div class="field" data-field="name">
              <label class="label" for="st-name">Business name</label>
              <input class="input" id="st-name" name="name" value="${v.name || ''}" maxlength="80"/>
              <span class="error-text" data-error></span>
            </div>
            <div class="field" data-field="tagline">
              <label class="label" for="st-tagline">Tagline</label>
              <input class="input" id="st-tagline" name="tagline" value="${v.tagline || ''}" maxlength="120" placeholder="Gadgets you can trust"/>
            </div>
            <div class="field span-2" data-field="description">
              <label class="label" for="st-desc">Store description</label>
              <textarea class="textarea" id="st-desc" name="description" rows="3" maxlength="2000" placeholder="Tell customers what you sell and why they should buy from you.">${v.description || ''}</textarea>
            </div>
          </div>

          <div class="field mt-6" data-field="logo">
            <label class="label">Store logo</label>
            <div class="image-picker">
              <div class="image-preview" data-preview-logo>
                ${v.logo ? html`<img src="${url(String(v.logo).replace(/^\//, ''))}" alt="Current logo"/>` : raw(icon('image'))}
              </div>
              <div class="grow stack-xs">
                <input class="input" name="logo" value="${v.logo || ''}" placeholder="/assets/images/logos/yourstore.svg or https://…"/>
                <p class="hint">Square images work best (512×512). SVG or WebP keeps it crisp on every screen.</p>
                <button type="button" class="btn btn-sm btn-secondary" data-pick="logo">${raw(icon('grid'))} Choose from library</button>
              </div>
            </div>
          </div>

          <div class="form-grid mt-6">
            <div class="field" data-field="favicon">
              <label class="label">Favicon</label>
              <div class="image-picker">
                <div class="image-preview sm" data-preview-favicon>
                  ${v.favicon ? html`<img src="${url(String(v.favicon).replace(/^\//, ''))}" alt=""/>` : raw(icon('image'))}
                </div>
                <div class="grow stack-xs">
                  <input class="input" name="favicon" value="${v.favicon || ''}" placeholder="/assets/icons/favicon.svg"/>
                  <button type="button" class="btn btn-sm btn-ghost" data-pick="favicon">Library</button>
                </div>
              </div>
            </div>
            <div class="field" data-field="banner">
              <label class="label">Hero banner</label>
              <div class="image-picker">
                <div class="image-preview wide" data-preview-banner>
                  ${v.banner ? html`<img src="${url(String(v.banner).replace(/^\//, ''))}" alt=""/>` : raw(icon('image'))}
                </div>
                <div class="grow stack-xs">
                  <input class="input" name="banner" value="${v.banner || ''}" placeholder="/assets/images/banners/yourstore.svg"/>
                  <button type="button" class="btn btn-sm btn-ghost" data-pick="banner">Library</button>
                </div>
              </div>
            </div>
          </div>

          <div class="field mt-6">
            <label class="label">Theme colours</label>
            <div class="row row-wrap" style="gap:16px">
              <div class="field" style="flex:1;min-width:200px" data-field="theme.primary">
                <label class="label" for="st-primary">Primary</label>
                <div class="input-group">
                  <input type="color" class="color-swatch" name="themePrimary" value="${v.theme?.primary || '#6D5EF6'}" aria-label="Primary colour"/>
                  <input class="input mono" id="st-primary" name="themePrimaryHex" value="${v.theme?.primary || '#6D5EF6'}" maxlength="7"/>
                </div>
                <span class="error-text" data-error></span>
              </div>
              <div class="field" style="flex:1;min-width:200px" data-field="theme.secondary">
                <label class="label" for="st-secondary">Secondary</label>
                <div class="input-group">
                  <input type="color" class="color-swatch" name="themeSecondary" value="${v.theme?.secondary || '#0EA5E9'}" aria-label="Secondary colour"/>
                  <input class="input mono" id="st-secondary" name="themeSecondaryHex" value="${v.theme?.secondary || '#0EA5E9'}" maxlength="7"/>
                </div>
              </div>
            </div>
            <div class="theme-swatches mt-4">
              ${SWATCHES.map((c) => html`<button type="button" class="swatch ${v.theme?.primary === c ? 'is-active' : ''}" data-swatch="${c}" style="--sw:${c}" aria-label="Use ${c}"></button>`)}
            </div>
            <div class="row mt-4" style="gap:12px;flex-wrap:wrap">
              <label class="check"><input type="radio" name="themeMode" value="light" ${(v.theme?.mode || 'light') === 'light' ? 'checked' : ''}/><span class="box">${raw(icon('check'))}</span><span class="text">Light storefront</span></label>
              <label class="check"><input type="radio" name="themeMode" value="dark" ${v.theme?.mode === 'dark' ? 'checked' : ''}/><span class="box">${raw(icon('check'))}</span><span class="text">Dark storefront</span></label>
              <label class="check"><input type="radio" name="themeMode" value="auto" ${v.theme?.mode === 'auto' ? 'checked' : ''}/><span class="box">${raw(icon('check'))}</span><span class="text">Follow visitor</span></label>
            </div>
          </div>

          <div class="field mt-6" data-field="gallery">
            <label class="label">Store images <span class="opt">up to 6</span></label>
            <div class="stack-xs" data-gallery-list>
              ${(v.gallery || []).map((g, i) => galleryRow(g, i))}
            </div>
            <button type="button" class="btn btn-sm btn-ghost mt-2" data-add-gallery>${raw(icon('plus'))} Add image</button>
          </div>
        </section>

        <!-- ---------------------------------------------------- business -->
        <section class="card card-pad hidden" id="business" data-panel="business">
          <div class="card-head" style="padding:0 0 var(--sp-4);margin-bottom:var(--sp-4)">
            <div><h3 class="h4">Business details</h3><div class="sub">Shown on invoices and used for delivery support.</div></div>
          </div>
          <div class="form-grid">
            <div class="field" data-field="legalName">
              <label class="label" for="st-legal">Registered / legal name</label>
              <input class="input" id="st-legal" name="legalName" value="${v.legalName || v.name || ''}" maxlength="120"/>
            </div>
            <div class="field" data-field="businessType">
              <label class="label" for="st-type">Business type</label>
              <div class="select-wrap">
                <select class="select" id="st-type" name="businessType">
                  ${BUSINESS_TYPES.map((t) => html`<option value="${t}" ${v.businessType === t ? 'selected' : ''}>${t}</option>`)}
                </select>
                ${raw(icon('chevron-down', 'sel'))}
              </div>
            </div>
            <div class="field" data-field="phone">
              <label class="label" for="st-phone">Business phone</label>
              <input class="input" id="st-phone" name="phone" value="${v.phone || ''}" maxlength="20" placeholder="+91 98765 43210"/>
              <span class="error-text" data-error></span>
            </div>
            <div class="field" data-field="email">
              <label class="label" for="st-email">Business email</label>
              <input class="input" id="st-email" name="email" type="email" value="${v.email || ''}" maxlength="120"/>
              <span class="error-text" data-error></span>
            </div>
            <div class="field span-2" data-field="address">
              <label class="label" for="st-address">Address</label>
              <textarea class="textarea" id="st-address" name="address" rows="2" maxlength="200">${v.address || ''}</textarea>
              <span class="error-text" data-error></span>
            </div>
            <div class="field" data-field="city"><label class="label" for="st-city">City</label><input class="input" id="st-city" name="city" value="${v.city || ''}" maxlength="60"/><span class="error-text" data-error></span></div>
            <div class="field" data-field="state"><label class="label" for="st-state">State</label><input class="input" id="st-state" name="state" value="${v.state || ''}" maxlength="60"/><span class="error-text" data-error></span></div>
            <div class="field" data-field="pincode"><label class="label" for="st-pin">Pincode</label><input class="input" id="st-pin" name="pincode" value="${v.pincode || ''}" maxlength="6" inputmode="numeric"/><span class="error-text" data-error></span></div>
            <div class="field" data-field="country"><label class="label" for="st-country">Country</label><input class="input" id="st-country" name="country" value="${v.country || 'India'}" maxlength="60"/></div>
          </div>
        </section>

        <!-- ------------------------------------------------------- hours -->
        <section class="card card-pad hidden" id="hours" data-panel="hours">
          <div class="card-head" style="padding:0 0 var(--sp-4);margin-bottom:var(--sp-4)">
            <div><h3 class="h4">Opening hours</h3><div class="sub">Shown to customers on your storefront. Use “Closed” for a day off.</div></div>
            <button type="button" class="btn btn-sm btn-ghost" data-copy-hours>${raw(icon('copy'))} Apply Monday to all</button>
          </div>
          <div class="form-grid">
            ${DAYS.map(([key, label]) => html`
              <div class="field" data-field="hours.${key}">
                <label class="label" for="st-${key}">${label}</label>
                <input class="input" id="st-${key}" name="hours_${key}" value="${v.hours?.[key] || ''}" placeholder="10:00-20:00 or Closed" maxlength="40"/>
              </div>`)}
          </div>

          <hr class="divider"/>
          <h3 class="h4 mb-4">Social links</h3>
          <div class="form-grid">
            ${[['instagram', 'Instagram', 'https://instagram.com/yourstore'], ['facebook', 'Facebook', 'https://facebook.com/yourstore'], ['whatsapp', 'WhatsApp', '+91 98765 43210'], ['youtube', 'YouTube', 'https://youtube.com/@yourstore'], ['twitter', 'X / Twitter', 'https://x.com/yourstore']].map(([key, label, ph]) => html`
              <div class="field" data-field="social.${key}">
                <label class="label" for="st-${key}">${label}</label>
                <input class="input" id="st-${key}" name="social_${key}" value="${v.social?.[key] || ''}" placeholder="${ph}"/>
              </div>`)}
          </div>
        </section>

        <!-- ---------------------------------------------------- payments -->
        <section class="card card-pad hidden" id="payments" data-panel="payments">
          <div class="card-head" style="padding:0 0 var(--sp-4);margin-bottom:var(--sp-4)">
            <div><h3 class="h4">Payments &amp; search</h3><div class="sub">Which payment options customers see, and how search engines describe your store.</div></div>
          </div>

          <label class="check mb-4"><input type="checkbox" name="codEnabled" ${v.codEnabled !== false ? 'checked' : ''}/><span class="box">${raw(icon('check'))}</span><span class="text"><strong>Accept cash on delivery</strong><br/><span class="muted text-sm">Customers pay the delivery partner. The order settles when you mark it delivered.</span></span></label>
          <label class="check"><input type="checkbox" name="onlinePaymentEnabled" ${v.onlinePaymentEnabled !== false ? 'checked' : ''}/><span class="box">${raw(icon('check'))}</span><span class="text"><strong>Accept online payments</strong><br/><span class="muted text-sm">UPI, cards and net banking through the connected payment gateway.</span></span></label>

          <div class="alert alert-info mt-6">${raw(icon('lock'))}
            <div class="a-body"><strong>Delivery fees, tax and commission are platform settings</strong>
              They are configured by the platform team, not in the browser. Your current commission is ${v.commissionPercent ?? cfg.commissionPercent}% and free delivery starts at ${money(v.freeDeliveryAbovePaise ?? cfg.freeDeliveryAbovePaise, { decimals: 0 })}.</div>
          </div>

          <hr class="divider"/>
          <h3 class="h4 mb-4">Search engine listing</h3>
          <div class="form-grid">
            <div class="field span-2" data-field="seo.title">
              <label class="label" for="st-seo-title">Meta title <span class="opt">max 70 characters</span></label>
              <input class="input" id="st-seo-title" name="seoTitle" value="${v.seo?.title || ''}" maxlength="70" placeholder="${v.name} | ${cfg.brand.shortName}"/>
              <span class="hint">Used for the browser tab and Google results.</span>
            </div>
            <div class="field span-2" data-field="seo.description">
              <label class="label" for="st-seo-desc">Meta description <span class="opt">max 180 characters</span></label>
              <textarea class="textarea" id="st-seo-desc" name="seoDescription" rows="2" maxlength="180" placeholder="What you sell, where you deliver and why customers choose you.">${v.seo?.description || ''}</textarea>
            </div>
            <div class="field span-2" data-field="seo.ogImage">
              <label class="label" for="st-seo-og">Social share image (OG)</label>
              <input class="input" id="st-seo-og" name="seoOgImage" value="${v.seo?.ogImage || ''}" placeholder="/assets/images/og-cover.svg"/>
            </div>
          </div>
        </section>

        <div class="row row-wrap sticky-save" data-save-bar>
          <p class="muted text-sm grow" data-save-hint>${raw(icon('info'))} Changes are saved to your live storefront.</p>
          <button type="button" class="btn btn-ghost" data-preview-store>${raw(icon('eye'))} Preview store</button>
          <button type="button" class="btn btn-secondary" data-reset-form>${raw(icon('refresh'))} Discard</button>
          <button type="submit" class="btn btn-primary" data-label="Save changes">${raw(icon('save'))} Save changes</button>
        </div>
      </form>
    </div>`;

  const form = $('[data-settings-form]');

  /* ------------------------------------------------------------- tabs */
  const showTab = (id) => {
    $$('[data-panel]', scroll).forEach((p) => p.classList.toggle('hidden', p.dataset.panel !== id));
    $$('[data-tab]', scroll).forEach((t) => t.classList.toggle('is-active', t.dataset.tab === id));
    setHash(id);
  };
  const setHash = (id) => {
    const u = new URL(globalThis.location.href);
    u.hash = id;
    globalThis.history.replaceState(null, '', u);
  };
  $$('[data-tab]', scroll).forEach((t) => t.addEventListener('click', (e) => { e.preventDefault(); showTab(t.dataset.tab); }));
  showTab(tab);

  /* ------------------------------------------------- colour interactions */
  const primaryColor = $('[name="themePrimary"]', form);
  const primaryHex = $('[name="themePrimaryHex"]', form);
  const secondaryColor = $('[name="themeSecondary"]', form);
  const secondaryHex = $('[name="themeSecondaryHex"]', form);
  const livePreview = () => {
    applyVendorTheme({ primary: primaryHex.value, secondary: secondaryHex.value }, { accent: true });
  };
  primaryColor.addEventListener('input', () => { primaryHex.value = primaryColor.value.toUpperCase(); livePreview(); });
  primaryHex.addEventListener('input', () => { if (/^#[0-9a-f]{6}$/i.test(primaryHex.value)) { primaryColor.value = primaryHex.value; livePreview(); } });
  secondaryColor.addEventListener('input', () => { secondaryHex.value = secondaryColor.value.toUpperCase(); livePreview(); });
  secondaryHex.addEventListener('input', () => { if (/^#[0-9a-f]{6}$/i.test(secondaryHex.value)) { secondaryColor.value = secondaryHex.value; livePreview(); } });

  $$('[data-swatch]', form).forEach((sw) => sw.addEventListener('click', () => {
    $$('[data-swatch]', form).forEach((s) => s.classList.remove('is-active'));
    sw.classList.add('is-active');
    primaryHex.value = sw.dataset.swatch;
    primaryColor.value = sw.dataset.swatch;
    livePreview();
  }));

  /* ------------------------------------------------------- image pickers */
  $$('[data-pick]', form).forEach((btn) => btn.addEventListener('click', () => {
    const field = btn.dataset.pick;
    const library = field === 'banner' ? BANNERS : field === 'favicon' ? ['/assets/icons/favicon.svg', ...LOGOS] : LOGOS;
    openImageLibrary({
      title: field === 'banner' ? 'Banner library' : field === 'favicon' ? 'Favicon library' : 'Logo library',
      images: library,
      wide: field === 'banner',
      onPick: (value) => {
        $(`[name="${field}"]`, form).value = value;
        $(`[data-preview-${field}]`, form).innerHTML = `<img src="${url(value.replace(/^\//, ''))}" alt="Selected ${field}"/>`;
      },
    });
  }));

  $$('[name="logo"], [name="banner"], [name="favicon"]', form).forEach((input) => {
    input.addEventListener('input', () => {
      const field = input.name;
      const preview = $(`[data-preview-${field}]`, form);
      if (preview) preview.innerHTML = input.value ? `<img src="${url(input.value.replace(/^\//, ''))}" alt=""/>` : icon('image');
    });
  });

  /* ---------------------------------------------------------- gallery */
  const galleryHost = $('[data-gallery-list]', form);
  $('[data-add-gallery]', form).addEventListener('click', () => {
    if (galleryHost.children.length >= 6) {
      toast('You can add up to 6 store images.', { type: 'warning' });
      return;
    }
    const node = document.createElement('div');
    node.innerHTML = galleryRow('', galleryHost.children.length);
    galleryHost.appendChild(node.firstElementChild);
  });
  galleryHost.addEventListener('click', (e) => {
    const rm = e.target.closest('[data-remove-gallery]');
    if (rm) rm.closest('.gallery-row').remove();
    const pick = e.target.closest('[data-gallery-pick]');
    if (pick) {
      openImageLibrary({
        title: 'Store image library',
        images: [...BANNERS, ...LOGOS],
        wide: true,
        onPick: (value) => { pick.closest('.gallery-row').querySelector('input').value = value; },
      });
    }
  });

  /* ------------------------------------------------------- hours helper */
  $('[data-copy-hours]', form).addEventListener('click', () => {
    const monday = $('[name="hours_mon"]', form).value;
    DAYS.forEach(([key]) => { const f = $(`[name="hours_${key}"]`, form); if (f) f.value = monday; });
    toast('Monday hours copied to every day. Adjust the weekend if needed.', { type: 'info', duration: 3000 });
  });

  /* ------------------------------------------------------------- save */
  $('[data-preview-store]', form).addEventListener('click', () => globalThis.open(url(`vendor/index.html?vendor=${v.slug}`), '_blank', 'noopener'));
  $('[data-reset-form]', form).addEventListener('click', () => globalThis.location.reload());

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = form.querySelector('[type="submit"]');
    const { values, errors, valid } = readForm(form, {
      name: [validators.required, validators.minLen(3)],
      phone: [validators.required, validators.phone],
      email: [validators.required, validators.email],
      pincode: [validators.required, validators.pincode],
      themePrimaryHex: [validators.required, validators.hex],
      themeSecondaryHex: [validators.hex],
    });
    paintErrors(form, errors);
    if (!valid) {
      toastError('Please fix the highlighted fields.');
      showTab('branding');
      return;
    }

    const hours = {};
    DAYS.forEach(([key]) => { hours[key] = values[`hours_${key}`] || ''; });
    const social = {};
    ['instagram', 'facebook', 'whatsapp', 'youtube', 'twitter'].forEach((key) => { social[key] = values[`social_${key}`] || ''; });
    const gallery = $$('[data-gallery-list] input', form).map((i) => i.value.trim()).filter(Boolean).slice(0, 6);

    const payload = {
      name: values.name,
      legalName: values.legalName,
      tagline: values.tagline,
      description: values.description,
      businessType: values.businessType,
      phone: values.phone,
      email: values.email,
      address: values.address,
      city: values.city,
      state: values.state,
      country: values.country || 'India',
      pincode: values.pincode,
      logo: values.logo,
      favicon: values.favicon,
      banner: values.banner,
      gallery,
      hours,
      social,
      codEnabled: !!values.codEnabled,
      onlinePaymentEnabled: !!values.onlinePaymentEnabled,
      theme: {
        primary: values.themePrimaryHex.toUpperCase(),
        secondary: values.themeSecondaryHex.toUpperCase(),
        accent: values.themeSecondaryHex.toUpperCase(),
        mode: values.themeMode || 'light',
        cardStyle: v.theme?.cardStyle || 'soft',
      },
      seo: { title: values.seoTitle, description: values.seoDescription, ogImage: values.seoOgImage },
    };

    await withButtonState(btn, async () => {
      try {
        const res = await Api.saveStoreSettings(payload);
        const fresh = res.vendor;
        toastSuccess(res.message || 'Store details saved.');
        applyVendorTheme(fresh.theme || {}, { accent: true });
        applyVendorSeo(fresh, { path: globalThis.location.pathname });
        $('[data-save-hint]').innerHTML = `${icon('check-circle')} Saved ${new Date().toLocaleTimeString('en-IN')}. Your storefront is updated.`;
        // Refresh the sidebar identity + cached vendor so chrome matches.
        const { loadVendor, applyVendor } = await import('../vendor.js');
        applyVendor(await loadVendor(fresh.slug, { force: true }));
        const { paintDashboardIdentity } = await import('../layout.js');
        const { state: authState } = await import('../auth.js');
        paintDashboardIdentity(fresh, authState.user, { commissionPercent: fresh.commissionPercent });
      } catch (err) {
        toastError(friendlyMessage(err), { title: 'Could not save your settings' });
      }
    });
  });
}

const galleryRow = (value = '', i = 0) => html`
  <div class="gallery-row">
    <input class="input" value="${value}" placeholder="/assets/images/banners/yourstore.svg" aria-label="Store image ${i + 1}"/>
    <button type="button" class="btn btn-sm btn-ghost" data-gallery-pick>${raw(icon('grid'))} Library</button>
    <button type="button" class="icon-btn danger" data-remove-gallery aria-label="Remove image">${raw(icon('trash'))}</button>
  </div>`;

function openImageLibrary({ title, images, wide = false, onPick }) {
  modal({
    size: 'lg',
    title,
    description: 'Bundled, licence-free artwork. Click one to use it, or paste your own URL in the field.',
    body: html`
      <div class="image-library ${wide ? 'wide' : ''}">
        ${images.map((src) => html`<button type="button" class="lib-tile" data-lib="${src}" title="${src}">
          <img src="${url(String(src).replace(/^\//, ''))}" alt="" loading="lazy" width="120" height="72"/>
        </button>`)}
      </div>`,
    onMount: ({ root, close }) => {
      root.addEventListener('click', (e) => {
        const tile = e.target.closest('[data-lib]');
        if (!tile) return;
        onPick(tile.dataset.lib);
        close();
      });
    },
  });
}

/* ============================================================== profile */

export async function profile() {
  const page = await dashPage({ active: 'profile', title: 'Profile', subtitle: 'Your login and contact details' });
  if (!page) return;
  const { scroll, auth } = page;
  const user = auth.user;

  scroll.innerHTML = html`
    <div class="dash-grid dash-2">
      <div class="card card-pad">
        <div class="card-head" style="padding:0 0 var(--sp-4);margin-bottom:var(--sp-4)">
          <div><h3 class="h4">Your details</h3><div class="sub">This is the account you sign in with.</div></div>
        </div>
        <form class="stack" data-profile-form>
          <div class="row mb-4">
            <span class="avatar avatar-lg">${esc((user.name || 'V').slice(0, 1).toUpperCase())}</span>
            <div class="grow">
              <strong class="ink">${user.name}</strong>
              <span class="muted text-sm" style="display:block">${user.email}</span>
              <div class="row mt-2" style="gap:6px">
                ${statusBadge(user.role, { vendor: 'badge-brand', super_admin: 'badge-danger', customer: 'badge-info', staff: 'badge-soft' })}
                ${user.emailVerified ? html`<span class="badge badge-success">${raw(icon('check'))} Email verified</span>` : html`<span class="badge badge-warning">Email not verified</span>`}
              </div>
            </div>
          </div>

          <div class="field" data-field="name">
            <label class="label" for="pr-name">Full name</label>
            <input class="input" id="pr-name" name="name" value="${user.name || ''}" maxlength="80" autocomplete="name"/>
            <span class="error-text" data-error></span>
          </div>
          <div class="field" data-field="phone">
            <label class="label" for="pr-phone">Mobile number</label>
            <input class="input" id="pr-phone" name="phone" value="${user.phone || ''}" maxlength="20" autocomplete="tel"/>
            <span class="error-text" data-error></span>
          </div>
          <div class="field">
            <label class="label" for="pr-email">Email</label>
            <input class="input" id="pr-email" value="${user.email || ''}" disabled/>
            <span class="hint">Contact support to change the email on a vendor account.</span>
          </div>
          <button type="submit" class="btn btn-primary" data-label="Save profile">${raw(icon('save'))} Save profile</button>
        </form>
      </div>

      <div class="stack">
        <div class="card card-pad">
          <div class="card-head" style="padding:0 0 var(--sp-4);margin-bottom:var(--sp-4)">
            <div><h3 class="h4">Change password</h3><div class="sub">At least 8 characters. Changing it signs out other devices.</div></div>
          </div>
          <form class="stack" data-password-form>
            <div class="field" data-field="currentPassword">
              <label class="label" for="pw-current">Current password</label>
              <div class="input-group"><input class="input" id="pw-current" name="currentPassword" type="password" autocomplete="current-password"/><button type="button" class="suffix icon-btn ghost" data-toggle-password aria-label="Show password">${raw(icon('eye'))}</button></div>
              <span class="error-text" data-error></span>
            </div>
            <div class="field" data-field="password">
              <label class="label" for="pw-new">New password</label>
              <div class="input-group"><input class="input" id="pw-new" name="password" type="password" autocomplete="new-password"/></div>
              <div class="password-meter" data-password-meter><span class="bar"><span></span></span><span class="lbl">Too short</span></div>
              <span class="error-text" data-error></span>
            </div>
            <div class="field" data-field="confirmPassword">
              <label class="label" for="pw-confirm">Confirm new password</label>
              <input class="input" id="pw-confirm" name="confirmPassword" type="password" autocomplete="new-password"/>
              <span class="error-text" data-error></span>
            </div>
            <button type="submit" class="btn btn-secondary" data-label="Update password">${raw(icon('lock'))} Update password</button>
          </form>
        </div>

        <div class="card card-pad">
          <h3 class="h4 mb-4">Appearance</h3>
          <p class="muted text-sm">This controls the dashboard theme. Your storefront has its own theme in Store settings.</p>
          <div class="row mt-4" style="gap:8px">
            <button type="button" class="btn btn-secondary btn-sm" data-theme-set="light">${raw(icon('sun'))} Light</button>
            <button type="button" class="btn btn-secondary btn-sm" data-theme-set="dark">${raw(icon('moon'))} Dark</button>
            <button type="button" class="btn btn-ghost btn-sm" data-theme-set="auto">${raw(icon('monitor'))} Auto</button>
          </div>
        </div>

        <div class="card card-pad">
          <h3 class="h4 mb-4">Sessions &amp; security</h3>
          ${infoRow('Signed in as', user.email)}
          ${infoRow('Role', String(user.role).replace(/_/g, ' '))}
          ${infoRow('Store', page.vendor.name)}
          <div class="alert alert-warning mt-4">${raw(icon('shield-check'))}
            <div class="a-body"><strong>Hiding buttons is not security</strong>Every request is re-checked on the server, so another store's data can never be reached from your account.</div>
          </div>
          <button type="button" class="btn btn-ghost btn-sm mt-4" data-signout>${raw(icon('log-out'))} Sign out of this device</button>
        </div>
      </div>
    </div>`;

  $('[data-profile-form]').addEventListener('submit', (e) => {
    e.preventDefault();
    const form = e.currentTarget;
    const { values, errors, valid } = readForm(form, {
      name: [validators.required, validators.minLen(3)],
      phone: [validators.required, validators.phone],
    });
    paintErrors(form, errors);
    if (!valid) return;
    withButtonState(form.querySelector('[type="submit"]'), async () => {
      try {
        const res = await Api.saveProfile({ name: values.name, phone: values.phone });
        const { state: authState } = await import('../auth.js');
        authState.user = { ...authState.user, name: values.name, phone: values.phone };
        const { paintDashboardIdentity } = await import('../layout.js');
        paintDashboardIdentity(page.vendor, authState.user, { commissionPercent: page.vendor.commissionPercent });
        toastSuccess(res.message || 'Profile updated.');
      } catch (err) {
        toastError(friendlyMessage(err));
      }
    });
  });

  const pwForm = $('[data-password-form]');
  const meter = $('[data-password-meter]', pwForm);
  const newPw = $('[name="password"]', pwForm);
  newPw.addEventListener('input', async () => {
    const { passwordStrength } = await import('../utils.js');
    const s = passwordStrength(newPw.value);
    $('.bar span', meter).style.width = `${s.percent}%`;
    $('.bar span', meter).style.background = ['var(--danger)', 'var(--danger)', 'var(--warning)', 'var(--warning)', 'var(--success)', 'var(--success)'][s.score];
    $('.lbl', meter).textContent = s.label;
  });

  pwForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const { values, errors, valid } = readForm(pwForm, {
      currentPassword: [validators.required],
      password: [validators.required, validators.password],
      confirmPassword: [validators.required, validators.sameAs('password')],
    });
    paintErrors(pwForm, errors);
    if (!valid) return;
    withButtonState(pwForm.querySelector('[type="submit"]'), async () => {
      try {
        await Api.saveProfile(values);
        toastSuccess('Password updated. Other devices have been signed out.');
        pwForm.reset();
      } catch (err) {
        toastError(friendlyMessage(err), { title: 'Could not update the password' });
      }
    });
  });

  $$('[data-theme-set]').forEach((btn) => btn.addEventListener('click', async () => {
    const { setTheme } = await import('../theme.js');
    setTheme(btn.dataset.themeSet);
    toast(`Dashboard theme: ${btn.dataset.themeSet}.`, { type: 'info', duration: 1800 });
  }));
}

/* =============================================================== support */

export async function support() {
  const page = await dashPage({ active: 'support', title: 'Support', subtitle: 'We usually reply within one working day' });
  if (!page) return;
  const { scroll, auth, vendor } = page;

  scroll.innerHTML = html`
    <div class="dash-grid dash-main">
      <div class="card card-pad">
        <div class="card-head" style="padding:0 0 var(--sp-4);margin-bottom:var(--sp-4)">
          <div><h3 class="h4">Raise a request</h3><div class="sub">Tell us what happened and we will pick it up.</div></div>
        </div>
        <form class="stack" data-support-form>
          <div class="field" data-field="subject">
            <label class="label" for="sp-subject">Subject</label>
            <div class="select-wrap">
              <select class="select" id="sp-subject" name="subject">
                <option value="">Choose a topic…</option>
                ${['Store activation', 'Payment or payout', 'Product listing issue', 'Order or delivery problem', 'Commission question', 'Technical issue', 'Something else'].map((t) => html`<option value="${t}">${t}</option>`)}
              </select>
              ${raw(icon('chevron-down', 'sel'))}
            </div>
            <span class="error-text" data-error></span>
          </div>
          <div class="field" data-field="message">
            <label class="label" for="sp-message">How can we help?</label>
            <textarea class="textarea" id="sp-message" name="message" rows="6" maxlength="2000" placeholder="Include order numbers, dates and what you expected to happen."></textarea>
            <span class="error-text" data-error></span>
          </div>
          <div class="alert alert-info">${raw(icon('info'))}
            <div class="a-body">Your message is sent as <strong>${auth.user.email}</strong> about <strong>${vendor.name}</strong>. Please never send passwords, OTPs or full card numbers.</div>
          </div>
          <button type="submit" class="btn btn-primary btn-lg" data-label="Send request">${raw(icon('send'))} Send request</button>
        </form>
      </div>

      <div class="stack">
        <div class="card card-pad">
          <h3 class="h4 mb-4">Direct contact</h3>
          ${infoRow('Email', cfg.brand.supportEmail)}
          ${infoRow('Phone', cfg.brand.supportPhone)}
          ${infoRow('Address', cfg.brand.address)}
          <a class="btn btn-secondary btn-block mt-4" href="mailto:${cfg.brand.supportEmail}">${raw(icon('mail'))} Email us</a>
        </div>

        <div class="card card-pad">
          <h3 class="h4 mb-4">Common questions</h3>
          <div data-exclusive>
            ${SUPPORT_FAQ.map((f) => html`
              <div class="accordion">
                <button type="button" class="acc-head" aria-expanded="false">${f.q}${raw(icon('chevron-down'))}</button>
                <div class="acc-body"><div class="acc-inner">${f.a}</div></div>
              </div>`)}
          </div>
        </div>

        <div class="card card-pad">
          <h3 class="h4 mb-4">Before you write to us</h3>
          <ul class="check-list">
            <li><span class="tick">${raw(icon('check'))}</span><span>Activation takes ${cfg.activationHours} hours after your deposit is confirmed.</span></li>
            <li><span class="tick">${raw(icon('check'))}</span><span>Payouts need ${money(cfg.minWithdrawalPaise, { decimals: 0 })} available balance.</span></li>
            <li><span class="tick">${raw(icon('check'))}</span><span>Commission is ${cfg.commissionPercent}% and is charged only on delivered orders.</span></li>
          </ul>
          <a class="btn btn-ghost btn-sm mt-4" href="${url('pages/faq.html')}">${raw(icon('external'))} Read the full FAQ</a>
        </div>
      </div>
    </div>`;

  $('[data-support-form]').addEventListener('submit', (e) => {
    e.preventDefault();
    const form = e.currentTarget;
    const { values, errors, valid } = readForm(form, {
      subject: [validators.required],
      message: [validators.required, validators.minLen(15)],
    });
    paintErrors(form, errors);
    if (!valid) {
      toastError('Add a subject and at least a sentence about the issue.');
      return;
    }
    withButtonState(form.querySelector('[type="submit"]'), async () => {
      try {
        const res = await Api.supportTicket(values);
        form.reset();
        modal({
          title: 'Request sent',
          body: html`
            <div class="text-center">
              <div class="empty"><div class="art">${raw(icon('check-circle'))}</div>
                <h3>We have your request</h3>
                <p>Reference <strong class="mono">${res.ticketId}</strong>. A reply will arrive at ${auth.user.email}, usually within one working day.</p>
              </div>
            </div>`,
          footer: html`<button type="button" class="btn btn-primary" data-close>Done</button>`,
        });
      } catch (err) {
        toastError(friendlyMessage(err), { title: 'Could not send your request' });
      }
    });
  });
}

const SUPPORT_FAQ = [
  { q: 'When do I get paid?', a: 'Money moves to your available balance the moment you mark an order delivered. Withdrawals are reviewed by the platform team and usually paid within 1–2 working days.' },
  { q: 'Why is my store not live yet?', a: 'A new store goes live automatically at the end of the activation window (48 hours after your deposit is confirmed). You can add products and branding while you wait.' },
  { q: 'Is the ₹1,000 deposit refundable?', a: 'Yes. It is a refundable security deposit, returned in full when you close your store in good standing.' },
  { q: 'Can I change my commission rate?', a: 'Commission is a platform-wide setting and is shown on every order. It is charged only on delivered orders, never on cancelled or refunded ones.' },
  { q: 'A customer wants a refund', a: 'Open the order, choose Refund, and add a reason. The server reverses the commission, restores stock and records the refund in your ledger.' },
];

export default { settings, profile, support };
