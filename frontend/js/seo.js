/**
 * seo.js — per-page and per-vendor metadata (spec §39).
 *
 * Vendor storefronts are one shared codebase on many subdomains, so the title,
 * description, Open Graph image, canonical URL and favicon are all set at
 * runtime from the vendor record loaded from the backend.
 */
import cfg from './config.js';
import { $, el } from './utils.js';

function upsertMeta(selector, attrs) {
  let node = $(selector);
  if (!node) {
    node = el('meta');
    document.head.append(node);
  }
  for (const [k, v] of Object.entries(attrs)) {
    if (v !== undefined && v !== null && v !== '') node.setAttribute(k, v);
  }
  return node;
}

function upsertLink(rel, href) {
  if (!href) return null;
  let node = $(`link[rel="${rel}"]`);
  if (!node) {
    node = el('link', { rel });
    document.head.append(node);
  }
  node.setAttribute('href', href);
  return node;
}

export function setTitle(title) {
  if (!title) return;
  document.title = title;
  upsertMeta('meta[property="og:title"]', { content: title });
  upsertMeta('meta[name="twitter:title"]', { content: title });
}

export function setDescription(description) {
  if (!description) return;
  const clean = String(description).replace(/\s+/g, ' ').trim().slice(0, 170);
  upsertMeta('meta[name="description"]', { content: clean });
  upsertMeta('meta[property="og:description"]', { content: clean });
  upsertMeta('meta[name="twitter:description"]', { content: clean });
}

export function setCanonical(href) {
  if (!href) return;
  upsertLink('canonical', href);
  upsertMeta('meta[property="og:url"]', { content: href });
}

export function setOgImage(href) {
  if (!href) return;
  const abs = new URL(href, globalThis.location.href).href;
  upsertMeta('meta[property="og:image"]', { content: abs });
  upsertMeta('meta[name="twitter:image"]', { content: abs });
  upsertMeta('meta[name="twitter:card"]', { content: 'summary_large_image' });
}

export function setFavicon(href) {
  if (!href) return;
  upsertLink('icon', href);
  upsertLink('shortcut icon', href);
  upsertLink('apple-touch-icon', href);
}

export function setRobots(value) {
  upsertMeta('meta[name="robots"]', { content: value });
}

export function setThemeColor(color) {
  upsertMeta('meta[name="theme-color"]', { content: color });
}

/** Injects (or replaces) a JSON-LD block — used for Store, Product and FAQ schema. */
export function setJsonLd(id, data) {
  if (!data) return;
  let node = $(`script[type="application/ld+json"][data-ld="${id}"]`);
  if (!node) {
    node = el('script', { type: 'application/ld+json', 'data-ld': id });
    document.head.append(node);
  }
  node.textContent = JSON.stringify(data);
}

const origin = () => globalThis.location.origin;

/** Storefront SEO: "ABC Store | GrowBusiness Online" (spec §39). */
export function applyVendorSeo(vendor, { path = '' } = {}) {
  if (!vendor) return;
  const name = vendor.name || 'Store';
  const suffix = cfg.brand.name;
  const title = vendor.seo?.title || `${name} | ${suffix}`;
  const description = vendor.seo?.description || vendor.tagline || vendor.description?.slice(0, 160) || `Shop online at ${name} on ${suffix}.`;
  setTitle(title);
  setDescription(description);
  const host = `${vendor.slug}.${cfg.rootDomain}`;
  setCanonical(`https://${host}${path}`);
  setOgImage(vendor.seo?.ogImage || vendor.banner || `${origin()}/assets/images/og-cover.svg`);
  setFavicon(vendor.favicon || vendor.logo);
  upsertMeta('meta[property="og:type"]', { content: 'website' });
  upsertMeta('meta[property="og:site_name"]', { content: name });
  setJsonLd('store', {
    '@context': 'https://schema.org',
    '@type': 'Store',
    name,
    description,
    url: `https://${host}`,
    image: vendor.banner ? new URL(vendor.banner, origin()).href : undefined,
    logo: vendor.logo ? new URL(vendor.logo, origin()).href : undefined,
    telephone: vendor.phone,
    email: vendor.email,
    address: {
      '@type': 'PostalAddress',
      streetAddress: vendor.address,
      addressLocality: vendor.city,
      addressRegion: vendor.state,
      postalCode: vendor.pincode,
      addressCountry: 'IN',
    },
    aggregateRating: vendor.rating ? { '@type': 'AggregateRating', ratingValue: vendor.rating, reviewCount: vendor.reviewCount || 1 } : undefined,
  });
}

/** Product page SEO + schema (spec §39). */
export function applyProductSeo(product, vendor) {
  if (!product) return;
  const storeName = vendor?.name || cfg.brand.name;
  const title = product.seo?.title || `${product.name} | ${storeName}`;
  const description = product.seo?.description || product.shortDescription || `${product.name} available at ${storeName}.`;
  setTitle(title);
  setDescription(description);
  setCanonical(`https://${vendor?.slug}.${cfg.rootDomain}/product.html?id=${encodeURIComponent(product.id)}`);
  setOgImage(product.image ? new URL(product.image, origin()).href : null);
  upsertMeta('meta[property="og:type"]', { content: 'product' });
  setJsonLd('product', {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: product.name,
    image: product.image ? new URL(product.image, origin()).href : undefined,
    description,
    sku: product.sku,
    brand: { '@type': 'Brand', name: storeName },
    offers: {
      '@type': 'Offer',
      priceCurrency: cfg.currency,
      price: (product.pricePaise / 100).toFixed(2),
      availability: product.inStock ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
      url: globalThis.location.href,
    },
    aggregateRating: product.reviewCount
      ? { '@type': 'AggregateRating', ratingValue: product.rating, reviewCount: product.reviewCount }
      : undefined,
  });
}

/** FAQ page schema. */
export function applyFaqSeo(items = []) {
  if (!items.length) return;
  setJsonLd('faq', {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: items.map((q) => ({
      '@type': 'Question',
      name: q.question,
      acceptedAnswer: { '@type': 'Answer', text: q.answer },
    })),
  });
}

export default { setTitle, setDescription, setCanonical, setOgImage, setFavicon, setJsonLd, applyVendorSeo, applyProductSeo, applyFaqSeo, setThemeColor, setRobots };
