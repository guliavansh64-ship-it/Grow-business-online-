/**
 * pages/marketing.js — behaviour for the public website (spec §5–§9).
 * Content lives in static HTML for SEO; this module adds live data,
 * the commission calculator, the contact form and small interactions.
 */
import Api, { friendlyMessage } from '../api.js';
import cfg from '../config.js';
import { $, $$, url, html, raw, esc, money, num, compactNumber, debounce, on, qget } from '../utils.js';
import { icon } from '../icons.js';
import { toast, toastSuccess, toastError, withButtonState, emptyState, bindCountUp } from '../ui.js';
import { readForm, paintErrors, validators } from '../utils.js';
import { applyFaqSeo } from '../seo.js';
import { mountMarketingChrome } from '../layout.js';

/* --------------------------------------------------------------- shared */

const boot = () => mountMarketingChrome();

async function liveStats() {
  const host = $('[data-platform-stats]');
  if (!host) return;
  try {
    const s = await Api.stats();
    const map = {
      vendors: s.vendors,
      products: s.products,
      orders: s.orders,
      cities: s.cities,
      gmv: s.gmvPaise,
    };
    $$('[data-stat]', host).forEach((node) => {
      const key = node.dataset.stat;
      if (!(key in map)) return;
      const value = map[key];
      if (key === 'gmv') node.textContent = compactNumber(value);
      else node.textContent = num(value);
    });
    host.classList.remove('is-loading');
  } catch {
    host.classList.remove('is-loading');
  }
}

function vendorCard(v) {
  return html`
    <article class="vendor-card reveal">
      <div class="vc-banner">
        ${v.banner ? html`<img src="${url(String(v.banner).replace(/^\//, ''))}" alt="" loading="lazy"/>` : ''}
        ${v.logo ? html`<img class="vc-logo" src="${url(String(v.logo).replace(/^\//, ''))}" alt="${v.name} logo" loading="lazy"/>` : ''}
      </div>
      <div class="vc-body">
        <span class="vc-sub">${v.slug}.${cfg.rootDomain}</span>
        <h3>${v.name}</h3>
        <p class="clamp-2">${v.tagline || v.description || ''}</p>
        <div class="vc-meta">
          <span>${raw(icon('star'))} ${Number(v.rating || 0).toFixed(1)}</span>
          <span>${raw(icon('package'))} ${num(v.productCount)} products</span>
          <span>${raw(icon('map-pin'))} ${v.city || 'India'}</span>
        </div>
        <a class="btn btn-secondary btn-sm mt-4" href="${url('vendor/index.html')}?vendor=${v.slug}">Visit store ${raw(icon('arrow-right'))}</a>
      </div>
    </article>`;
}

async function vendorShowcase(limit = 3) {
  const host = $('[data-vendor-showcase]');
  if (!host) return;
  host.innerHTML = Array.from({ length: limit }, () => `<div class="sk-card" style="height:290px"><div class="skeleton" style="height:108px;border-radius:0"></div><div style="padding:20px"><div class="skeleton sk-title"></div><div class="skeleton sk-text"></div><div class="skeleton sk-text" style="width:60%"></div></div></div>`).join('');
  try {
    const vendors = await Api.vendors({ limit });
    host.innerHTML = vendors.length ? vendors.map(vendorCard).join('') : emptyState({ icon: 'store', title: 'No live stores yet', message: 'Vendor stores appear here as soon as they are activated.' });
    bindCountUp();
    document.dispatchEvent(new Event('reveal:refresh'));
    const { bindRevealOnScroll } = await import('../ui.js');
    bindRevealOnScroll(host);
  } catch (err) {
    host.innerHTML = emptyState({ icon: 'alert-triangle', title: 'Could not load stores', message: friendlyMessage(err) });
  }
}

/* ------------------------------------------------------------------ home */

export async function home() {
  boot();
  liveStats();
  vendorShowcase(3);
  bindCategoryMarquee();
  bindFaqSchema();
}

function bindCategoryMarquee() {
  const track = $('[data-marquee]');
  if (!track) return;
  // Duplicate the content so the CSS marquee loops seamlessly.
  track.innerHTML += track.innerHTML;
  track.addEventListener('mouseenter', () => track.classList.add('is-paused'));
  track.addEventListener('mouseleave', () => track.classList.remove('is-paused'));
}

/* ----------------------------------------------------------------- pages */

export async function about() {
  boot();
  liveStats();
  bindFaqSchema();
}

export async function pricing() {
  boot();
  liveStats();
  bindCommissionCalculator();
}

/** Interactive 5% commission calculator (spec §24) — display maths only. */
function bindCommissionCalculator() {
  const root = $('[data-commission-calculator]');
  if (!root) return;
  const input = $('input[name="sales"]', root);
  const ordersInput = $('input[name="orders"]', root);
  if (!input) return;

  const paint = () => {
    const sales = Math.max(0, Number(input.value) || 0);
    const orders = Math.max(1, Number(ordersInput?.value) || 1);
    const percent = Number(root.dataset.percent || cfg.commissionPercent || 5);
    const commission = Math.round((sales * percent) / 100);
    const keep = sales - commission;
    const aov = sales / orders;
    $('[data-calc-sales]', root).textContent = money(sales * 100, { decimals: 0 });
    $('[data-calc-commission]', root).textContent = `− ${money(commission * 100, { decimals: 0 })}`;
    $('[data-calc-keep]', root).textContent = money(keep * 100, { decimals: 0 });
    $('[data-calc-aov]', root).textContent = money(aov * 100, { decimals: 0 });
    const bar = $('[data-calc-bar]', root);
    if (bar) bar.style.width = `${((commission / (sales || 1)) * 100).toFixed(1)}%`;
  };

  input.addEventListener('input', paint);
  ordersInput?.addEventListener('input', paint);
  paint();
}

export async function vendors() {
  boot();
  const host = $('[data-vendor-directory]');
  const search = $('[data-vendor-search]');
  const typeSelect = $('[data-vendor-type]');
  if (!host) return;

  const load = async () => {
    host.innerHTML = Array.from({ length: 6 }, () => `<div class="sk-card" style="height:280px"></div>`).join('');
    try {
      const { items, meta } = await Api.paged('/store/vendors', {
        q: search?.value?.trim() || undefined,
        type: typeSelect?.value || undefined,
        limit: 24,
      });
      host.innerHTML = items.length ? items.map(vendorCard).join('') : emptyState({ icon: 'search', title: 'No stores match that search', message: 'Try a different keyword, or browse all stores.', action: { label: 'Clear filters', href: url('pages/vendors.html') } });
      const { bindRevealOnScroll } = await import('../ui.js');
      bindRevealOnScroll(host);
      const count = $('[data-vendor-count]');
      if (count) count.textContent = `${num(items.length)} live ${items.length === 1 ? 'store' : 'stores'}`;

      // The business-type filter is populated once, from the API's own list.
      const types = meta.businessTypes || [];
      if (typeSelect && types.length && typeSelect.options.length <= 1) {
        typeSelect.innerHTML = `<option value="">All categories</option>` + types.map((t) => `<option value="${esc(t)}">${esc(t)}</option>`).join('');
      }
    } catch (err) {
      host.innerHTML = emptyState({ icon: 'alert-triangle', title: 'Could not load stores', message: friendlyMessage(err) });
    }
  };

  search?.addEventListener('input', debounce(load, cfg.searchDebounceMs));
  typeSelect?.addEventListener('change', load);
  load();
}

export async function contact() {
  boot();
  const form = $('[data-contact-form]');
  if (!form) return;

  // Pre-fill from ?subject= so other pages can deep-link into support.
  const subject = qget('subject');
  if (subject) form.querySelector('[name="subject"]').value = subject;

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const btn = form.querySelector('[type="submit"]');
    const { values, errors, valid } = readForm(form, {
      name: [validators.required, validators.minLen(3)],
      email: [validators.required, validators.email],
      message: [validators.required, validators.minLen(15)],
    });
    paintErrors(form, errors);
    if (!valid) {
      toastError('Please fix the highlighted fields.');
      return;
    }
    withButtonState(btn, async () => {
      const data = await Api.contact(values);
      toastSuccess(data.message || 'Message sent. We will reply within one working day.');
      form.reset();
    });
  });
}

export async function faq() {
  boot();
  bindFaqSchema();
  bindFaqSearch();
}

function bindFaqSchema() {
  const items = $$('.accordion').map((acc) => ({
    question: $('.acc-head', acc)?.textContent?.trim() || '',
    answer: $('.acc-inner', acc)?.textContent?.trim() || '',
  })).filter((i) => i.question && i.answer);
  if (items.length) applyFaqSeo(items);
}

function bindFaqSearch() {
  const input = $('[data-faq-search]');
  const list = $('[data-faq-list]');
  if (!input || !list) return;
  const run = debounce(() => {
    const q = input.value.trim().toLowerCase();
    let visible = 0;
    $$('.accordion', list).forEach((acc) => {
      const match = !q || acc.textContent.toLowerCase().includes(q);
      acc.classList.toggle('hidden', !match);
      if (match) visible++;
    });
    const empty = $('[data-faq-empty]');
    if (empty) empty.classList.toggle('hidden', visible > 0);
  }, 220);
  input.addEventListener('input', run);
}

/* ----------------------------------------------------------------- legal */

export async function legal() {
  boot();
  bindLegalToc();
}

function bindLegalToc() {
  const links = $$('.legal-toc a');
  if (!links.length) return;
  // Legal section IDs begin with numbers (for example `1-agreement`), which
  // are valid HTML IDs but need CSS escaping in querySelector. Use the DOM's
  // ID lookup directly so every table-of-contents anchor is safe to resolve.
  const sections = links.map((link) => document.getElementById(link.hash.slice(1))).filter(Boolean);
  const setActive = () => {
    let current = sections[0];
    for (const s of sections) {
      if (s.getBoundingClientRect().top <= 140) current = s;
    }
    links.forEach((l) => l.classList.toggle('is-active', l.getAttribute('href') === `#${current?.id}`));
  };
  globalThis.addEventListener('scroll', debounce(setActive, 60), { passive: true });
  setActive();
}

/* --------------------------------------------------------------- 404 */

export async function notFound() {
  boot();
}

export default { home, about, pricing, vendors, contact, faq, legal, notFound };
