/**
 * Domain helpers: money maths, pagination, ordering and shared constants.
 *
 * IMPORTANT (spec §23, §24, §47): every amount in this system is an integer
 * number of PAISE. Prices, commissions, balances and totals are computed here
 * on the server. The browser only ever displays them.
 */
const config = require('./config');

const PAISE_PER_UNIT = 100;

const toPaise = (rupees) => Math.round(Number(rupees || 0) * PAISE_PER_UNIT);
const toRupees = (paise) => Number(paise || 0) / PAISE_PER_UNIT;

const clampInt = (value, min, max, fallback = min) => {
  const n = Math.trunc(Number(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
};

const sum = (list, fn = (x) => x) => list.reduce((acc, item) => acc + (Number(fn(item)) || 0), 0);

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

/** Commission split for a single order — the only place this maths is allowed. */
function commissionSplit(grossPaise, percent = config.commissionPercent) {
  const gross = Math.max(0, Math.round(Number(grossPaise) || 0));
  const commission = Math.round((gross * percent) / 100);
  return { grossPaise: gross, commissionPercent: percent, commissionPaise: commission, vendorPaise: gross - commission };
}

/**
 * Server-side basket totals. The client sends only {productId, qty}; every
 * price is re-read from the database so a tampered payload cannot change money.
 */
function priceBasket(items, products, vendor) {
  const lines = [];
  for (const item of items) {
    const product = products.find((p) => p.id === item.productId);
    if (!product || product.status !== 'active' || product.stock <= 0) continue;
    const qty = clampInt(item.qty, 1, 10, 1);
    const mrp = Number(product.mrpPaise || product.pricePaise);
    const price = Number(product.pricePaise);
    const lineGross = price * qty;
    lines.push({
      productId: product.id,
      name: product.name,
      image: product.image || '',
      unitMrpPaise: mrp,
      unitPricePaise: price,
      qty,
      grossPaise: lineGross,
      discountPaise: Math.max(0, (mrp - price) * qty),
    });
  }

  const subtotalPaise = sum(lines, (l) => l.grossPaise);
  const discountPaise = sum(lines, (l) => l.discountPaise);
  const netPaise = Math.max(0, subtotalPaise - discountPaise);
  const freeAbove = vendor?.freeDeliveryAbovePaise ?? config.freeDeliveryAbovePaise;
  const deliveryFeePaise = subtotalPaise === 0 || netPaise >= freeAbove ? 0 : Number(vendor?.deliveryFeePaise ?? config.deliveryFeePaise);
  const taxable = !!config.taxable && config.gstPercent > 0 && netPaise > 0;
  const taxPaise = taxable ? Math.round((netPaise * config.gstPercent) / 100) : 0;
  const totalPaise = netPaise + deliveryFeePaise + taxPaise;

  return {
    lines,
    subtotalPaise,
    discountPaise,
    netPaise,
    deliveryFeePaise,
    taxPaise,
    taxPercent: taxable ? config.gstPercent : 0,
    totalPaise,
    itemCount: sum(lines, (l) => l.qty),
    commission: commissionSplit(totalPaise),
  };
}

const ORDER_STATUSES = ['pending', 'confirmed', 'processing', 'shipped', 'out_for_delivery', 'delivered', 'cancelled', 'refunded'];
const PAYMENT_STATUSES = ['pending', 'paid', 'failed', 'refunded'];
const DEPOSIT_STATUSES = ['pending', 'paid', 'processing', 'approved', 'rejected', 'refunded'];
const WITHDRAWAL_STATUSES = ['pending', 'processing', 'approved', 'paid', 'rejected', 'cancelled'];
const VENDOR_STATUSES = ['pending_deposit', 'pending_activation', 'active', 'suspended', 'rejected'];
const ROLES = ['super_admin', 'vendor', 'customer', 'staff'];

const TRACKING_STEPS = ['pending', 'confirmed', 'processing', 'shipped', 'out_for_delivery', 'delivered'];

function paginate(list, query, defaultSize = config.limits.pageSize) {
  const page = clampInt(query.page, 1, 100000, 1);
  const limit = clampInt(query.limit, 1, config.limits.maxPageSize, defaultSize);
  const total = list.length;
  const pages = Math.max(1, Math.ceil(total / limit));
  const safePage = Math.min(page, pages);
  const start = (safePage - 1) * limit;
  return { items: list.slice(start, start + limit), page: safePage, limit, total, pages, hasMore: safePage < pages };
}

const daysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString();
const hoursFromNow = (n) => new Date(Date.now() + n * 3600000).toISOString();
const msBetween = (a, b) => new Date(b).getTime() - new Date(a).getTime();

const ORDER_ID_PREFIX = 'GBO';
function nextOrderId(existingCount) {
  const stamp = new Date().getFullYear().toString().slice(2);
  const seq = String(existingCount + 1).padStart(5, '0');
  return `${ORDER_ID_PREFIX}${stamp}-${seq}`;
}

module.exports = {
  PAISE_PER_UNIT,
  toPaise,
  toRupees,
  clampInt,
  sum,
  round2,
  commissionSplit,
  priceBasket,
  paginate,
  daysAgo,
  hoursFromNow,
  msBetween,
  nextOrderId,
  ORDER_STATUSES,
  PAYMENT_STATUSES,
  DEPOSIT_STATUSES,
  WITHDRAWAL_STATUSES,
  VENDOR_STATUSES,
  ROLES,
  TRACKING_STEPS,
  config,
};
