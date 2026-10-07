/**
 * cart.js — per-vendor shopping cart.
 *
 * The cart is stored locally so it survives a refresh, but it only ever holds
 * { productId, qty } plus a display snapshot. Every price is re-read from the
 * server at checkout (spec §47 — never trust a price that came from a browser).
 */
import cfg from './config.js';
import Api from './api.js';
import { store, money, debounce } from './utils.js';

const keyFor = (slug) => `cart:${slug || 'default'}`;
const TTL = cfg.cartTtlDays * 86400000;

export const cart = {
  slug: null,
  items: [],
  serverQuote: null,

  bind(slug) {
    this.slug = slug;
    this.items = store.get(keyFor(slug), []) || [];
    return this;
  },

  /** Adds a product (or increases its quantity). */
  add(product, qty = 1) {
    if (!product?.id) return false;
    const max = Math.max(1, product.stock ?? 10);
    const existing = this.items.find((i) => i.productId === product.id);
    const nextQty = Math.min(max, (existing?.qty || 0) + qty);
    const snapshot = {
      name: product.name,
      image: product.image,
      pricePaise: product.pricePaise,
      mrpPaise: product.mrpPaise,
      stock: product.stock,
    };
    if (existing) existing.qty = nextQty;
    else this.items.push({ productId: product.id, qty: Math.min(max, qty), snapshot });
    this.commit();
    return true;
  },

  setQty(productId, qty) {
    const item = this.items.find((i) => i.productId === productId);
    if (!item) return false;
    const max = Math.max(1, item.snapshot?.stock ?? 10);
    const next = Math.max(0, Math.min(max, Number(qty) || 0));
    if (next === 0) this.remove(productId);
    else {
      item.qty = next;
      this.commit();
    }
    return true;
  },

  remove(productId) {
    this.items = this.items.filter((i) => i.productId !== productId);
    this.commit();
    return true;
  },

  clear() {
    this.items = [];
    this.serverQuote = null;
    this.commit();
  },

  has(productId) {
    return this.items.some((i) => i.productId === productId);
  },

  get count() {
    return this.items.reduce((a, i) => a + i.qty, 0);
  },

  get lines() {
    return this.items.length;
  },

  get isEmpty() {
    return this.items.length === 0;
  },

  /** Local estimate for the badge/drawer only — checkout uses the server quote. */
  get estimatePaise() {
    return this.items.reduce((a, i) => a + (Number(i.snapshot?.pricePaise) || 0) * i.qty, 0);
  },

  /** Payload accepted by /store/vendors/:slug/cart/quote and /orders. */
  payload() {
    return this.items.map((i) => ({ productId: i.productId, qty: i.qty }));
  },

  commit() {
    store.set(keyFor(this.slug), this.items, TTL);
    this.serverQuote = null;
    const event = new CustomEvent('cart:change', { detail: { count: this.count, items: this.items, slug: this.slug } });
    document.dispatchEvent(event);
    this.scheduleQuote();
  },

  /** Debounced server re-quote so the drawer total is always trustworthy. */
  scheduleQuote: debounce(async function refresh() {
    if (!this.slug || this.isEmpty) {
      this.serverQuote = null;
      document.dispatchEvent(new CustomEvent('cart:quote', { detail: null }));
      return;
    }
    try {
      const quote = await Api.quote(this.slug, this.payload());
      // Ignore stale responses if the cart changed while we waited.
      if (quote.itemCount !== this.count) return;
      this.serverQuote = quote;
      document.dispatchEvent(new CustomEvent('cart:quote', { detail: quote }));
    } catch {
      this.serverQuote = null;
    }
  }, 600),

  async quote() {
    if (this.isEmpty) return null;
    const quote = await Api.quote(this.slug, this.payload());
    this.serverQuote = quote;
    return quote;
  },

  /** Re-validates the cart against live stock before checkout. */
  async validate() {
    const quote = await this.quote();
    if (!quote) return { ok: false, message: 'Your cart is empty.' };
    const dropped = this.items.filter((i) => !quote.lines.some((l) => l.productId === i.productId));
    if (dropped.length) {
      dropped.forEach((i) => this.remove(i.productId));
      return { ok: false, message: `${dropped.length} item(s) are no longer available and were removed from your cart.` };
    }
    const short = quote.lines.filter((l) => l.qty > 0 && this.items.find((i) => i.productId === l.productId)?.qty !== l.qty);
    return { ok: true, quote, adjusted: short };
  },
};

/** Keeps every [data-cart-count] badge in sync. */
export function bindCartBadges() {
  const paint = () => {
    document.querySelectorAll('[data-cart-count]').forEach((node) => {
      const n = cart.count;
      node.textContent = n > 99 ? '99+' : String(n);
      node.classList.toggle('hidden', n === 0);
      node.closest('[data-cart-badge-host]')?.classList.toggle('has-items', n > 0);
    });
    document.querySelectorAll('[data-cart-total]').forEach((node) => {
      node.textContent = cart.serverQuote ? money(cart.serverQuote.totalPaise) : money(cart.estimatePaise);
    });
  };
  document.addEventListener('cart:change', paint);
  document.addEventListener('cart:quote', paint);
  paint();
  return paint;
}

export const formatCartSummary = () => ({
  count: cart.count,
  estimate: money(cart.estimatePaise),
  server: cart.serverQuote ? money(cart.serverQuote.totalPaise) : null,
});

export default cart;
