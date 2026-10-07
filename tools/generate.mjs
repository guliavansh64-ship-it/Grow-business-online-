/**
 * tools/generate.mjs — builds every static HTML page from frontend/partials/*.
 *
 *   node tools/generate.mjs
 *
 * Why generate instead of hand-write?
 *   · one header/footer/markup source for ~45 pages (spec §41: never duplicate)
 *   · the committed HTML gives crawlers real content (spec §39)
 *   · the same files upload straight to Hostinger hPanel — no build step needed
 *     at deploy time, this script only runs in development.
 */
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FE = path.join(ROOT, 'frontend');
const PARTIALS = path.join(FE, 'partials');
const SITE = 'https://www.growbusinessonline.com';

const partial = (name) => readFileSync(path.join(PARTIALS, `${name}.html`), 'utf8');
const BASE = partial('base');
const HEADER = partial('header');
const FOOTER = partial('footer');
const STOREFRONT = partial('storefront');
const DASHBOARD = partial('dashboard');

const fill = (tpl, vars = {}) => tpl.replace(/\{\{(\w+)\}\}/g, (_, key) => (vars[key] === undefined ? '' : String(vars[key])));
const attr = (s = '') => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/* ------------------------------------------------------------------ shell */

function doc({
  page,
  title,
  description,
  depth = 0,
  body,
  head = '',
  canonical = null,
  robots = 'index,follow',
  bodyClass = '',
  ogImage = '/assets/images/og-cover.svg',
  noscriptTitle = title,
}) {
  const prefix = '../'.repeat(depth);
  const html = fill(BASE, {
    title: attr(title),
    description: attr(description),
    robots,
    canonical: canonical || `${SITE}/${depth ? `${depthPrefix(depth)}` : ''}`,
    ogImage: `${SITE}${ogImage}`,
    prefix,
    bodyClass,
    body: fill(body, { prefix, noscriptTitle: attr(noscriptTitle), description: attr(description) }),
    head: fill(head, { prefix }),
    page,
  });
  // Keep generated files clean and stable in diffs (partials/content can leave
  // indentation-only whitespace at the ends of lines).
  return `${html.replace(/[ \t]+$/gm, '').trim()}\n`;
}

/** The canonical path for a generated page (filled in per page below). */
function depthPrefix(depth) {
  return depth === 1 ? 'pages/' : '';
}

const marketing = ({ page, title, description, content, depth = 0, canonical, head = '', bodyClass = '', ogImage }) =>
  doc({
    page,
    title,
    description,
    depth,
    canonical,
    head,
    bodyClass,
    ogImage,
    body: `${fill(HEADER, { prefix: '../'.repeat(depth) })}
<main id="main">
${content}
</main>
${fill(FOOTER, { prefix: '../'.repeat(depth) })}`,
  });

const storefrontPage = ({ page, title, description, canonical, robots = 'index,follow', head = '' }) =>
  doc({
    page,
    title,
    description,
    depth: 1,
    canonical,
    robots,
    head,
    body: STOREFRONT,
    noscriptTitle: title,
  });

const dashboardPage = ({ page, title, description, variant = 'vendor' }) =>
  doc({
    page,
    title,
    description,
    depth: 1,
    robots: 'noindex,nofollow',
    canonical: `${SITE}/admin/`,
    head: variant === 'console' ? `<script>document.documentElement.dataset.console="true";</script>` : '',
    body: DASHBOARD,
    noscriptTitle: title,
  });

/* ---------------------------------------------------------------- content */

const FEATURES = [
  { icon: 'store', title: 'Create Online Store', body: 'Your own storefront on vendorname.growbusinessonline.com, live within 48 hours of activation.', tag: 'Included' },
  { icon: 'package', title: 'Product Management', body: 'Add products with images, prices, MRP, discounts, stock levels, specifications and categories.', tag: 'Unlimited products' },
  { icon: 'receipt', title: 'Order Management', body: 'Confirm, process, ship and deliver from one queue. Every status change updates the customer.', tag: 'Live tracking' },
  { icon: 'users', title: 'Customer Management', body: 'See every buyer, their order history, lifetime spend and city — without exporting spreadsheets.', tag: 'Built-in CRM' },
  { icon: 'grid', title: 'Vendor Dashboard', body: 'A single console for your catalogue, sales, money and store settings, built for daily use.', tag: 'One place' },
  { icon: 'shield-check', title: 'Secure Authentication', body: 'Hashed passwords, signed sessions, role-based access and rate limiting on every endpoint.', tag: 'Role based' },
  { icon: 'bell', title: 'Notifications', body: 'New order, order updated, payment received, withdrawal updated, store activated and announcements.', tag: 'In-app + push ready' },
  { icon: 'chart-line', title: 'Sales Analytics', body: 'Sales, orders, revenue, top products, category mix and delivery cities over 7, 30 or 90 days.', tag: 'Charts included' },
  { icon: 'credit', title: 'Payment Management', body: 'UPI, cards, net banking and cash on delivery. Balances and payouts tracked to the rupee.', tag: '5% commission' },
  { icon: 'globe', title: '24/7 Online Store', body: 'Your store never closes. Customers can browse and order at 2am and you see it in the morning.', tag: 'Always on' },
  { icon: 'smartphone', title: 'Mobile Responsive Store', body: 'Every storefront is designed mobile-first and tested from 320px phones to 1440px desktops.', tag: 'Touch friendly' },
  { icon: 'palette', title: 'Custom Store Branding', body: 'Your logo, banner, colours, tagline and business details — no “powered by” clutter on your pages.', tag: 'Your brand' },
];

const STEPS = [
  { title: 'Register Your Account', body: 'Add your business name, type, address and contact details. Your account is created instantly.' },
  { title: 'Pay ₹1,000 Security Deposit', body: 'A one-time, fully refundable security deposit. It is returned when you close your store in good standing.' },
  { title: 'Complete Store Setup', body: 'Upload your logo, choose your colours, set opening hours and add your first products.' },
  { title: 'Launch Your Online Store', body: 'After the 48 hour activation window your store goes live and starts taking orders.' },
];

const PLANS = [
  {
    name: 'Starter Store',
    price: '₹1,000',
    period: 'one-time refundable deposit',
    featured: false,
    cta: 'Create your store',
    points: ['Your own subdomain storefront', 'Unlimited products & categories', 'Order and customer management', 'UPI, card, net banking and COD', 'Sales analytics dashboard', '5% commission on delivered orders'],
  },
  {
    name: 'Growth Store',
    price: '₹1,000',
    period: 'same deposit · everything unlocked',
    featured: true,
    ribbon: 'Most popular',
    cta: 'Start growing',
    points: ['Everything in Starter', 'Custom branding: logo, banner, colours', 'Product reviews and ratings', 'Withdrawals to bank or UPI', 'Notifications for every event', 'Priority support queue'],
  },
  {
    name: 'Multi-Store',
    price: 'Talk to us',
    period: 'for chains & franchises',
    featured: false,
    cta: 'Contact sales',
    points: ['Multiple storefronts under one owner', 'Shared catalogue across locations', 'Consolidated payouts and reports', 'Custom commission agreement', 'Dedicated onboarding help'],
  },
];

const FAQS = [
  {
    group: 'Getting started',
    items: [
      { q: 'How much does it cost to start selling?', a: 'A one-time ₹1,000 refundable security deposit, plus a 5% platform commission on delivered orders. There is no monthly fee and no setup charge.' },
      { q: 'Is the ₹1,000 deposit really refundable?', a: 'Yes. It is a security deposit, not a fee. It is returned in full when you close your store in good standing — no pending disputes, no unpaid dues.' },
      { q: 'How long does my store take to go live?', a: 'Activation starts the moment your deposit is confirmed and finishes within 48 hours. You can add products and branding while you wait.' },
      { q: 'Do I need a website or technical knowledge?', a: 'No. You get a storefront on your own subdomain, and everything is managed from a dashboard. If you can use WhatsApp, you can manage your store.' },
    ],
  },
  {
    group: 'Orders & payments',
    items: [
      { q: 'Which payment methods can my customers use?', a: 'UPI (Google Pay, PhonePe, Paytm), credit and debit cards, net banking, and cash on delivery. You can switch COD off for your store.' },
      { q: 'When do I receive my money?', a: 'An order settles to your available balance the moment you mark it delivered. Withdrawals need a minimum of ₹500 and are usually paid within 1–2 working days.' },
      { q: 'How is the 5% commission calculated?', a: 'On a ₹1,000 delivered order, the platform keeps ₹50 and you receive ₹950. Cancelled and refunded orders are never charged. The calculation always happens on the server.' },
      { q: 'Can I refund a customer?', a: 'Yes. Open the order in your dashboard, choose Refund and add a reason. Stock is restored and the commission is reversed automatically.' },
    ],
  },
  {
    group: 'Your store',
    items: [
      { q: 'Can I use my own domain name?', a: 'Your store starts on yourname.growbusinessonline.com. A custom domain can be mapped later by pointing a CNAME at your storefront.' },
      { q: 'How many products can I list?', a: 'As many as you like. Categories, search, filters and pagination keep large catalogues fast for shoppers.' },
      { q: 'Can I change my logo, colours and banner?', a: 'Yes, from Store Settings. Changes go live immediately and are reflected on your storefront, favicon and social share cards.' },
      { q: 'Will my store work on mobile?', a: 'Every storefront is mobile-first and tested from 320px phones up to 1440px desktops, with touch-friendly buttons and no horizontal scrolling.' },
    ],
  },
  {
    group: 'Account & security',
    items: [
      { q: 'How is my data protected?', a: 'Passwords are hashed, sessions are signed and revocable, every request is re-authorised on the server, and one store can never read another store’s data.' },
      { q: 'Can my staff have their own login?', a: 'Yes. Accounts have roles — vendor, staff, customer and platform admin — so you can give limited access without sharing your password.' },
      { q: 'I forgot my password', a: 'Use “Forgot password” on the login page. A reset link is emailed to you and, for safety, it signs out every other device.' },
      { q: 'What happens if I close my store?', a: 'Your storefront goes offline, your refundable deposit is returned, and your order history stays available for accounting and GST purposes.' },
    ],
  },
];

const LEGAL = {
  terms: {
    title: 'Terms of Service',
    updated: '7 October 2026',
    intro: 'These terms govern your use of the GrowBusiness Online platform, including your storefront, dashboard and any payment services we connect you to.',
    sections: [
      { h: '1. Agreement', p: 'By creating an account you agree to these terms and to the Vendor Agreement. If you are accepting on behalf of a business, you confirm you are authorised to bind that business.' },
      { h: '2. Your account', p: 'You are responsible for keeping your login details secret and for everything that happens under your account. Tell us immediately if you believe your account has been accessed by somebody else.' },
      { h: '3. Security deposit', p: 'A one-time refundable security deposit of ₹1,000 is required before your store is activated. The deposit is held against breaches of these terms and is refunded in full when you close your store in good standing.' },
      { h: '4. Platform commission', p: 'The platform charges a commission of 5% on the value of delivered orders. Commission is calculated on the server at the moment an order is delivered. Cancelled and refunded orders are not charged.' },
      { h: '5. Your obligations', p: 'You must list products accurately, honour the prices you publish, ship within the time you state, comply with applicable Indian law (including GST, consumer protection and legal metrology rules), and respond to customer complaints.' },
      { h: '6. Prohibited items', p: 'You may not sell counterfeit goods, prohibited or restricted items, prescription medicines without a licence, weapons, or anything that infringes another person’s intellectual property.' },
      { h: '7. Payments and payouts', p: 'Money collected from customers is settled to your available balance once an order is delivered. Payouts require a minimum of ₹500 and are sent to the bank account or UPI ID you register. You are responsible for the accuracy of those details.' },
      { h: '8. Suspension and termination', p: 'We may suspend a store that breaches these terms, sells prohibited items, or receives repeated verified complaints. You may close your store at any time from your dashboard.' },
      { h: '9. Intellectual property', p: 'You keep ownership of your logo, product content and brand. You grant us a limited licence to display that content on your storefront and in platform marketing that names you.' },
      { h: '10. Liability', p: 'The platform is provided “as is”. We are not liable for lost profits or indirect losses. Our total liability in any twelve month period is limited to the commission you paid us in that period.' },
      { h: '11. Changes to these terms', p: 'We may update these terms and will notify vendors by email and in-app notification at least 14 days before a change takes effect.' },
      { h: '12. Governing law', p: 'These terms are governed by the laws of India, and the courts at Jhajjar, Haryana have exclusive jurisdiction.' },
    ],
  },
  privacy: {
    title: 'Privacy Policy',
    updated: '7 October 2026',
    intro: 'This policy explains what personal data GrowBusiness Online collects, why we collect it, and the choices you have.',
    sections: [
      { h: '1. What we collect', p: 'Account data (name, email, mobile, password hash), business data (business name, type, address, GST details if provided), catalogue data (products, prices, images), transaction data (orders, payments, payouts) and technical data (IP address, browser type, pages visited).' },
      { h: '2. Why we collect it', p: 'To operate your storefront, process orders and payments, provide support, prevent fraud, meet tax and legal obligations, and improve the platform.' },
      { h: '3. Legal basis', p: 'We process data because it is necessary to perform our contract with you, to comply with legal obligations, and for our legitimate interests in operating and securing the platform.' },
      { h: '4. Sharing', p: 'We share customer order details with the vendor fulfilling the order, with payment gateways and logistics partners as needed to complete a transaction, and with authorities where the law requires it. We never sell personal data.' },
      { h: '5. Storage and security', p: 'Data is stored on servers in India. Passwords are hashed with a strong one-way function, sessions are signed and revocable, transport is encrypted with TLS, and access to production data is restricted and logged.' },
      { h: '6. Retention', p: 'Order and payment records are retained for eight years to meet Indian tax and accounting requirements. Marketing data is retained until you unsubscribe. Deleted accounts are anonymised within 90 days except where the law requires retention.' },
      { h: '7. Your rights', p: 'You may request access, correction, export or deletion of your personal data, and you may object to processing. Write to support@growbusinessonline.com and we will respond within 30 days.' },
      { h: '8. Cookies and local storage', p: 'We use local storage to remember your theme, your shopping cart and your session. We do not use third-party advertising trackers.' },
      { h: '9. Children', p: 'The platform is not intended for children under 18 and we do not knowingly collect their data.' },
      { h: '10. Third-party apps', p: 'Companion mobile applications may use Firebase services with their own configuration. The main platform authentication never mixes with Firebase Auth.' },
      { h: '11. Grievance officer', p: 'Under the Information Technology Act, 2000 our grievance officer can be reached at support@growbusinessonline.com, GrowBusiness Online, Sector 14, Jhajjar, Haryana 124103.' },
      { h: '12. Changes', p: 'We will notify you of material changes by email or in-app notification before they take effect.' },
    ],
  },
  refund: {
    title: 'Refund Policy',
    updated: '7 October 2026',
    intro: 'How refunds work for customer orders, for the vendor security deposit, and for platform charges.',
    sections: [
      { h: '1. Customer order refunds', p: 'Refunds are decided by the store that sold the product, within the window that store publishes. A customer can request a refund from the order tracking page, and the vendor approves it from their dashboard.' },
      { h: '2. Refund timelines', p: 'Once a refund is approved, the amount is returned to the original payment method. UPI and wallet refunds usually appear within 3–5 working days; card and net banking refunds within 7–10 working days, depending on the issuing bank.' },
      { h: '3. Cash on delivery orders', p: 'COD orders have no online payment to reverse. Where a COD order is cancelled after dispatch, the store may offer a replacement or a bank transfer refund at its discretion.' },
      { h: '4. Non-refundable situations', p: 'Refunds may be refused for products that are used, damaged by the customer, missing original packaging, or returned outside the stated window, and for personalised or perishable goods.' },
      { h: '5. Vendor security deposit', p: 'The ₹1,000 security deposit is refundable in full when a vendor closes their store in good standing: no unresolved customer disputes, no pending dues, and no breach of the Vendor Agreement. Refunds are processed within 15 working days of the closure request.' },
      { h: '6. Deposit forfeiture', p: 'A deposit may be withheld, in whole or in part, where it is needed to compensate customers for undelivered paid orders, or where the store was suspended for fraud or prohibited products.' },
      { h: '7. Platform commission', p: 'Commission is charged only on delivered orders. If an order is refunded after delivery, the commission for that order is reversed and returned to the vendor balance.' },
      { h: '8. Failed payments', p: 'If a payment is deducted from a customer account but the order was not created, the gateway reverses it automatically within 5–7 working days. Contact support with the payment reference if it does not.' },
      { h: '9. How to request a refund', p: 'Customers: open your order from Track My Order and choose Request refund. Vendors: use Orders → Refund in your dashboard. Both routes notify the other party immediately.' },
      { h: '10. Disputes', p: 'If a store and customer cannot agree, either party can raise the dispute with the platform. We review the order timeline, delivery proof and correspondence, and our decision is final.' },
    ],
  },
  vendor: {
    title: 'Vendor Agreement',
    updated: '7 October 2026',
    intro: 'The specific terms between GrowBusiness Online and every store operating on the platform.',
    sections: [
      { h: '1. Relationship', p: 'You operate as an independent business. Nothing here creates employment, partnership or agency. You are the seller of record for your products.' },
      { h: '2. Store activation', p: 'Your store is activated within 48 hours of a confirmed security deposit. Activation may take longer if business details need verification, and we will tell you why.' },
      { h: '3. Listing standards', p: 'Product titles, images and descriptions must be accurate and your own. Prices must include applicable taxes unless clearly stated otherwise. You may not list prohibited or counterfeit items.' },
      { h: '4. Order fulfilment', p: 'Confirm or cancel a new order within 24 hours. Ship within the handling time you publish, upload tracking where available, and keep stock levels accurate.' },
      { h: '5. Commission and settlement', p: 'The platform commission is 5% of the order value on delivered orders. Settlement happens automatically on delivery, and the split is visible on every order and in your ledger.' },
      { h: '6. Withdrawals', p: 'Minimum withdrawal is ₹500 from your available balance. Requests are reviewed for fraud and compliance, and payouts are normally made within 1–2 working days of approval.' },
      { h: '7. Taxes and invoices', p: 'You are responsible for GST registration, invoicing customers where required, filing returns and paying taxes on your income. The platform issues a tax invoice for the commission it charges.' },
      { h: '8. Customer data', p: 'Customer details shared with you are for fulfilling that order only. You may not use them for unrelated marketing, share them, or sell them.' },
      { h: '9. Branding and conduct', p: 'Your storefront must not display content that is unlawful, hateful, obscene or misleading, and must not impersonate another brand or the platform itself.' },
      { h: '10. Support standards', p: 'Respond to customer messages within one working day. Repeated failure to respond is grounds for suspension.' },
      { h: '11. Suspension', p: 'We may suspend a store immediately for fraud, prohibited products, repeated policy breaches or a legal requirement. You will be notified with the reason and how to appeal.' },
      { h: '12. Termination and deposit refund', p: 'Either party may end this agreement with 30 days notice. On closure in good standing your refundable deposit is returned within 15 working days, less any amounts owed to customers or the platform.' },
      { h: '13. Dispute resolution', p: 'Disputes are first resolved by discussion, then by arbitration under the Arbitration and Conciliation Act, 1996, seated at Jhajjar, Haryana. Courts at Jhajjar have exclusive jurisdiction.' },
    ],
  },
};

/* ----------------------------------------------------------------- pages */

const heroArt = (prefix) => `
  <div class="hero-art reveal">
    <div class="frame">
      <img src="${prefix}assets/images/hero-dashboard.svg" alt="GrowBusiness Online vendor dashboard showing sales, orders and top products" width="760" height="520" fetchpriority="high"/>
    </div>
    <div class="float-card fc-1">
      <span class="ico"><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 17.5 9.2 12l3.4 3.4L20 7.6M15 7.6h5v5" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg></span>
      <span><span class="v">₹1,24,580</span><span class="l">Sales this month</span></span>
    </div>
    <div class="float-card fc-2">
      <span class="ico"><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M6 7h12l-1.2 9.2a2 2 0 0 1-2 1.8H9.2a2 2 0 0 1-2-1.8L6 7Z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M9 7a3 3 0 0 1 6 0" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg></span>
      <span><span class="v">18 new orders</span><span class="l">In the last 24 hours</span></span>
    </div>
    <div class="float-card fc-3">
      <span class="ico"><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m12 3 2.6 5.4 5.9.8-4.3 4.1 1.1 5.9L12 16.9 6.7 19.2l1.1-5.9L3.5 9.2l5.9-.8L12 3Z" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round"/></svg></span>
      <span><span class="v">4.8 rating</span><span class="l">From 1,240 buyers</span></span>
    </div>
  </div>`;

const featureCard = (f) => `
  <article class="feature-card reveal">
    <span class="f-ico"><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><use href="#i-${f.icon}"/></svg></span>
    <h3>${f.title}</h3>
    <p>${f.body}</p>
    <span class="f-tag">${f.tag}</span>
  </article>`;

const stepCard = (s, i) => `
  <article class="how-step reveal">
    <span class="n">${i + 1}</span>
    <h3>${s.title}</h3>
    <p>${s.body}</p>
    ${i < STEPS.length - 1 ? '<span class="arrow"><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><use href="#i-arrow-right"/></svg></span>' : ''}
  </article>`;

const priceCard = (p, prefix = '') => `
  <article class="price-card ${p.featured ? 'is-featured' : ''} reveal">
    ${p.ribbon ? `<span class="ribbon">${p.ribbon}</span>` : ''}
    <div>
      <h3 class="h4">${p.name}</h3>
      <div class="amount mt-4">${p.price} <small>${p.period}</small></div>
    </div>
    <ul class="plist">
      ${p.points.map((pt) => `<li><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><use href="#i-check-circle"/></svg> ${pt}</li>`).join('')}
    </ul>
    <a class="btn ${p.featured ? 'btn-primary' : 'btn-secondary'} btn-block" href="${prefix}${p.name === 'Multi-Store' ? 'pages/contact.html' : 'register.html'}">${p.cta}</a>
  </article>`;

const faqBlock = (group) => `
  <div class="card card-pad reveal">
    <h3 class="h4 mb-4">${group.group}</h3>
    <div data-exclusive>
      ${group.items.map((it) => `
        <div class="accordion">
          <button type="button" class="acc-head" aria-expanded="false">${it.q}<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><use href="#i-chevron-down"/></svg></button>
          <div class="acc-body"><div class="acc-inner"><p>${it.a}</p></div></div>
        </div>`).join('')}
    </div>
  </div>`;

/* ------------------------------------------------------------- home page */

const homeContent = (prefix) => `
  <section class="hero">
    <div class="container container-wide hero-inner">
      <div class="hero-copy">
        <span class="badge badge-brand reveal"><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><use href="#i-sparkles"/></svg> Multi-vendor commerce platform for India</span>
        <h1 class="reveal">Grow Your Business <span class="grad-text">Online</span></h1>
        <p class="lede reveal">Create your own online store on your own subdomain. Manage products, orders, customers and payments from one dashboard — and get paid directly into your bank account.</p>
        <div class="hero-cta reveal">
          <a class="btn btn-primary btn-lg" href="${prefix}register.html">
            <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><use href="#i-rocket"/></svg> Start Your Business
          </a>
          <a class="btn btn-secondary btn-lg" href="${prefix}login.html">
            <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><use href="#i-login"/></svg> Login
          </a>
        </div>
        <div class="hero-trust reveal">
          <span class="t"><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><use href="#i-check-circle"/></svg> ₹1,000 refundable deposit</span>
          <span class="t"><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><use href="#i-check-circle"/></svg> No monthly fee</span>
          <span class="t"><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><use href="#i-check-circle"/></svg> Live in 48 hours</span>
        </div>
      </div>
      ${heroArt(prefix)}
    </div>
  </section>

  <section class="logo-strip">
    <div class="container container-wide inner">
      <span class="label">Live stores on the platform</span>
      <div class="marquee grow" data-marquee-host>
        <div class="marquee-track" data-marquee>
          <span class="lg"><img src="${prefix}assets/images/logos/techmart.svg" alt="" width="30" height="30"/> TechMart</span>
          <span class="lg"><img src="${prefix}assets/images/logos/stylehub.svg" alt="" width="30" height="30"/> StyleHub</span>
          <span class="lg"><img src="${prefix}assets/images/logos/freshkart.svg" alt="" width="30" height="30"/> FreshKart</span>
          <span class="lg"><img src="${prefix}assets/images/logos/homely.svg" alt="" width="30" height="30"/> Homely</span>
          <span class="lg"><svg viewBox="0 0 24 24" fill="none" aria-hidden="true" width="22" height="22"><use href="#i-store"/></svg> Your store here</span>
        </div>
      </div>
    </div>
  </section>

  <section class="section" id="stats">
    <div class="container">
      <div class="section-head center">
        <span class="eyebrow">Platform numbers</span>
        <h2>Built for real businesses, not demos</h2>
        <p class="sub">Live counts from the platform API, refreshed whenever you open this page.</p>
      </div>
      <div class="stats-band card card-pad" data-platform-stats>
        <div class="stat-block"><div class="v brand" data-stat="vendors" data-count-up>0</div><div class="l">Active stores</div></div>
        <div class="stat-block"><div class="v" data-stat="products" data-count-up>0</div><div class="l">Products listed</div></div>
        <div class="stat-block"><div class="v" data-stat="orders" data-count-up>0</div><div class="l">Orders processed</div></div>
        <div class="stat-block"><div class="v" data-stat="cities" data-count-up>0</div><div class="l">Cities delivered</div></div>
      </div>
    </div>
  </section>

  <section class="section section-alt" id="features">
    <div class="container">
      <div class="section-head center">
        <span class="eyebrow">Everything included</span>
        <h2>One platform. Twelve things you no longer have to do by hand.</h2>
        <p class="sub">Every feature below is part of the same ₹1,000 refundable deposit — no add-ons, no tiers to unlock.</p>
      </div>
      <div class="feature-grid">
        ${FEATURES.map(featureCard).join('')}
      </div>
      <div class="text-center mt-10">
        <a class="btn btn-secondary btn-lg" href="${prefix}pages/features.html">See every feature in detail
          <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><use href="#i-arrow-right"/></svg>
        </a>
      </div>
    </div>
  </section>

  <section class="section" id="how-it-works">
    <div class="container">
      <div class="section-head center">
        <span class="eyebrow">How it works</span>
        <h2>From registration to your first order in four steps</h2>
        <p class="sub">No developer, no server setup, no monthly subscription.</p>
      </div>
      <div class="how-steps">
        ${STEPS.map(stepCard).join('')}
      </div>
      <div class="flow-note mt-8 reveal">
        <span class="ico"><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><use href="#i-shield-check"/></svg></span>
        <div>
          <strong class="ink">The ₹1,000 is a refundable security deposit</strong>
          <p class="muted text-sm mt-2 mb-0">It is not a fee and it is not a subscription. It is returned in full when you close your store in good standing. The only ongoing charge is a 5% commission on delivered orders.</p>
        </div>
      </div>
    </div>
  </section>

  <section class="section section-alt" id="vendors">
    <div class="container">
      <div class="section-head">
        <div>
          <span class="eyebrow">Live storefronts</span>
          <h2>Stores already selling on GrowBusiness</h2>
          <p class="sub">Each one runs on the same platform, with its own subdomain, branding and catalogue.</p>
        </div>
        <a class="btn btn-secondary" href="${prefix}pages/vendors.html">Browse all stores</a>
      </div>
      <div class="vendor-grid" data-vendor-showcase>
        <div class="skeleton sk-card" style="height:290px"></div>
        <div class="skeleton sk-card" style="height:290px"></div>
        <div class="skeleton sk-card" style="height:290px"></div>
      </div>
    </div>
  </section>

  <section class="section" id="dashboard-preview">
    <div class="container">
      <div class="grid g-2 align-center">
        <div>
          <span class="eyebrow">Vendor dashboard</span>
          <h2 class="mt-4">Run the whole business from one screen</h2>
          <p class="lede">Sales, orders, pending confirmations, customers, products, available balance and commission — all in one view, with charts that answer the questions you actually ask.</p>
          <ul class="check-list mt-6">
            <li><span class="tick"><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><use href="#i-check"/></svg></span><span>Eight KPIs at the top, updated in real time</span></li>
            <li><span class="tick"><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><use href="#i-check"/></svg></span><span>Sales, orders and revenue charts for 7, 30 or 90 days</span></li>
            <li><span class="tick"><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><use href="#i-check"/></svg></span><span>Top products and a recent-orders queue you can act on</span></li>
            <li><span class="tick"><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><use href="#i-check"/></svg></span><span>Balance and payouts that are always calculated server side</span></li>
          </ul>
          <div class="row mt-8">
            <a class="btn btn-primary btn-lg" href="${prefix}register.html">Create your store</a>
            <a class="btn btn-ghost btn-lg" href="${prefix}pages/how-it-works.html">See how it works</a>
          </div>
        </div>
        <div class="reveal">
          <div class="frame" style="border-radius:var(--r-2xl);overflow:hidden;box-shadow:var(--sh-4);border:1px solid var(--line)">
            <img src="${prefix}assets/images/hero-dashboard.svg" alt="Vendor dashboard preview with KPI cards and sales chart" width="720" height="492" loading="lazy"/>
          </div>
        </div>
      </div>
    </div>
  </section>

  <section class="section section-alt" id="testimonials">
    <div class="container">
      <div class="section-head center">
        <span class="eyebrow">Vendor stories</span>
        <h2>What store owners say</h2>
      </div>
      <div class="quote-grid">
        <article class="quote-card reveal">
          <span class="stars"><svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><use href="#i-star"/></svg><svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><use href="#i-star"/></svg><svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><use href="#i-star"/></svg><svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><use href="#i-star"/></svg><svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><use href="#i-star"/></svg></span>
          <p class="q">“I moved my electronics shop online in two days. Orders started coming in from other cities in the first week — something WhatsApp could never do for me.”</p>
          <div class="who"><span class="avatar avatar-sm">R</span><div><div class="n">Rohit Verma</div><div class="r">TechMart · Bengaluru</div></div></div>
        </article>
        <article class="quote-card reveal">
          <span class="stars"><svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><use href="#i-star"/></svg><svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><use href="#i-star"/></svg><svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><use href="#i-star"/></svg><svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><use href="#i-star"/></svg><svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><use href="#i-star"/></svg></span>
          <p class="q">“The payout screen is the reason I stayed. I always know exactly what I earned, what commission was charged and when the money reaches my account.”</p>
          <div class="who"><span class="avatar avatar-sm">P</span><div><div class="n">Priya Nair</div><div class="r">StyleHub · Kochi</div></div></div>
        </article>
        <article class="quote-card reveal">
          <span class="stars"><svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><use href="#i-star"/></svg><svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><use href="#i-star"/></svg><svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><use href="#i-star"/></svg><svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><use href="#i-star"/></svg><svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><use href="#i-star"/></svg></span>
          <p class="q">“My customers order vegetables at night and I pack in the morning. The pending orders list means nothing is missed, and COD settles automatically on delivery.”</p>
          <div class="who"><span class="avatar avatar-sm">A</span><div><div class="n">Aman Sethi</div><div class="r">FreshKart · Jhajjar</div></div></div>
        </article>
      </div>
    </div>
  </section>

  <section class="section" id="faq">
    <div class="container">
      <div class="section-head center">
        <span class="eyebrow">Questions</span>
        <h2>The things vendors ask us first</h2>
        <p class="sub">Full answers, including refunds and payouts, are in the FAQ.</p>
      </div>
      <div class="grid g-2">
        ${faqBlock(FAQS[0])}
        ${faqBlock(FAQS[1])}
      </div>
      <div class="text-center mt-8">
        <a class="btn btn-secondary" href="${prefix}pages/faq.html">Read all ${FAQS.reduce((a, g) => a + g.items.length, 0)} questions</a>
      </div>
    </div>
  </section>

  <section class="section">
    <div class="container">
      <div class="cta-band reveal">
        <span class="eyebrow" style="color:rgba(255,255,255,.8)">Start today</span>
        <h2 class="mt-4">Your own online store, live in 48 hours</h2>
        <p>Register, pay the ₹1,000 refundable security deposit, add your products, and start selling. No monthly fee — just 5% on delivered orders.</p>
        <div class="row mt-8" style="gap:12px;flex-wrap:wrap">
          <a class="btn btn-primary btn-lg" href="${prefix}register.html">Start Your Business</a>
          <a class="btn btn-secondary btn-lg" href="${prefix}pages/pricing.html">See pricing</a>
        </div>
        <div class="cta-points">
          <span><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><use href="#i-check"/></svg> Refundable deposit</span>
          <span><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><use href="#i-check"/></svg> Your own subdomain</span>
          <span><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><use href="#i-check"/></svg> UPI, cards &amp; COD</span>
          <span><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><use href="#i-check"/></svg> Mobile-first storefront</span>
        </div>
      </div>
    </div>
  </section>`;

/* ------------------------------------------------------------ sub pages */

const featuresContent = (prefix) => `
  <section class="page-hero">
    <div class="container">
      <nav class="breadcrumb" aria-label="Breadcrumb"><a href="${prefix}index.html">Home</a><span class="sep">/</span><span class="current">Features</span></nav>
      <h1>Everything your store needs, nothing it doesn't</h1>
      <p class="lede">Twelve capabilities that replace a website developer, a billing tool, an order register and a payments dashboard.</p>
    </div>
  </section>
  <section class="section pt-0">
    <div class="container">
      <div class="feature-grid">${FEATURES.map(featureCard).join('')}</div>
      <div class="cta-band mt-12 reveal">
        <h2>Ready to use all of this?</h2>
        <p>One refundable deposit unlocks every feature. No tiers, no add-ons.</p>
        <div class="row mt-6"><a class="btn btn-primary btn-lg" href="${prefix}register.html">Create your store</a><a class="btn btn-secondary btn-lg" href="${prefix}pages/pricing.html">See pricing</a></div>
      </div>
    </div>
  </section>`;

const pricingContent = (prefix) => `
  <section class="page-hero">
    <div class="container">
      <nav class="breadcrumb" aria-label="Breadcrumb"><a href="${prefix}index.html">Home</a><span class="sep">/</span><span class="current">Pricing</span></nav>
      <h1>Simple pricing that grows with you</h1>
      <p class="lede">A one-time ₹1,000 refundable security deposit, plus a 5% commission on delivered orders. No monthly fee, no setup cost, no hidden charges.</p>
    </div>
  </section>

  <section class="section pt-0">
    <div class="container">
      <div class="pricing-grid">${PLANS.map((p) => priceCard(p, prefix)).join('')}</div>

      <div class="card card-pad mt-10" data-commission-calculator data-percent="5">
        <div class="section-head" style="margin-bottom:var(--sp-6)">
          <div><h2 class="h3">What would you actually pay?</h2><p class="sub">Move the sliders. This is an illustration — real commission is calculated on the server for each delivered order.</p></div>
        </div>
        <div class="grid g-2">
          <div class="stack">
            <div class="field">
              <label class="label" for="calc-sales">Expected monthly sales (₹)</label>
              <input type="range" id="calc-sales" name="sales" min="10000" max="2000000" step="10000" value="200000"/>
              <div class="row row-between text-sm muted mt-2"><span>₹10,000</span><strong class="ink" data-calc-sales>₹2,00,000</strong><span>₹20,00,000</span></div>
            </div>
            <div class="field">
              <label class="label" for="calc-orders">Orders per month</label>
              <input type="range" id="calc-orders" name="orders" min="1" max="500" step="1" value="80"/>
              <div class="row row-between text-sm muted mt-2"><span>1</span><strong class="ink" data-calc-aov>₹2,500</strong><span>500</span></div>
            </div>
          </div>
          <div class="split-card">
            <div class="split-row"><span>Your sales</span><strong data-calc-sales-total>₹2,00,000</strong></div>
            <div class="split-row is-fee"><span>Platform commission (5%)</span><strong data-calc-commission>− ₹10,000</strong></div>
            <div class="split-row is-net"><span>You keep</span><strong data-calc-keep>₹1,90,000</strong></div>
            <div class="progress progress-sm mt-4"><span data-calc-bar style="width:5%"></span></div>
            <p class="hint mt-3">Charged only on delivered orders. Cancelled and refunded orders cost you nothing.</p>
          </div>
        </div>
      </div>

      <div class="card mt-10">
        <div class="card-head"><div><h3 class="h4">What's included, plan by plan</h3><div class="sub">Every store gets the same software — the difference is scale and support.</div></div></div>
        <div style="overflow-x:auto">
          <table class="table compare-table">
            <thead><tr><th>Feature</th><th>Starter</th><th>Growth</th><th>Multi-Store</th></tr></thead>
            <tbody>
              ${[
                ['Your own subdomain storefront', 1, 1, 1],
                ['Unlimited products &amp; categories', 1, 1, 1],
                ['Order &amp; customer management', 1, 1, 1],
                ['UPI, card, net banking &amp; COD', 1, 1, 1],
                ['Sales analytics dashboard', 1, 1, 1],
                ['Custom branding (logo, banner, colours)', 0, 1, 1],
                ['Product reviews &amp; ratings', 0, 1, 1],
                ['Priority support queue', 0, 1, 1],
                ['Multiple storefronts, one owner', 0, 0, 1],
                ['Custom commission agreement', 0, 0, 1],
              ].map(([label, a, b, c]) => `<tr><td>${label}</td>${[a, b, c].map((v) => `<td>${v ? '<span class="yes">✓</span>' : '<span class="no">—</span>'}</td>`).join('')}</tr>`).join('')}
            </tbody>
          </table>
        </div>
      </div>

      <div class="grid g-3 mt-10">
        ${[
          ['shield-check', 'Refundable deposit', '₹1,000 is held as security and returned in full when you close your store in good standing.'],
          ['percent', 'Only 5% commission', 'Charged on delivered orders only. You see the split on every single order and in your ledger.'],
          ['banknote', 'Payouts in 1–2 days', 'Withdraw from ₹500 to your bank account or UPI ID. Track every request to the rupee.'],
        ].map(([ic, t, b]) => `<div class="card card-pad reveal"><span class="f-ico" style="margin-bottom:var(--sp-4)"><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><use href="#i-${ic}"/></svg></span><h3 class="h4">${t}</h3><p class="muted text-sm mt-2">${b}</p></div>`).join('')}
      </div>

      <div class="text-center mt-10">
        <a class="btn btn-primary btn-lg" href="${prefix}register.html">Start with a ₹1,000 refundable deposit</a>
        <p class="hint mt-4">Questions? <a href="${prefix}pages/contact.html">Talk to us</a> before you pay anything.</p>
      </div>
    </div>
  </section>`;

const howContent = (prefix) => `
  <section class="page-hero">
    <div class="container">
      <nav class="breadcrumb" aria-label="Breadcrumb"><a href="${prefix}index.html">Home</a><span class="sep">/</span><span class="current">How It Works</span></nav>
      <h1>Four steps from registration to your first order</h1>
      <p class="lede">The whole journey takes under an hour of your time. Activation runs in the background.</p>
    </div>
  </section>
  <section class="section pt-0">
    <div class="container">
      <div class="how-steps">${STEPS.map(stepCard).join('')}</div>

      <div class="flow-note mt-10 reveal">
        <span class="ico"><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><use href="#i-shield-check"/></svg></span>
        <div><strong class="ink">About the ₹1,000</strong><p class="muted text-sm mt-2 mb-0">It is a refundable security deposit, not a fee. It is returned in full when you close your store in good standing, and it is the only amount you pay before you start selling.</p></div>
      </div>

      <div class="grid g-2 mt-10">
        <div class="card card-pad">
          <h3 class="h4 mb-4">Deposit lifecycle</h3>
          <p class="muted text-sm">Your deposit moves through these states, and only the payment gateway can move it to “approved”.</p>
          <div class="pay-status-list mt-4">
            ${['pending', 'paid', 'processing', 'approved', 'rejected', 'refunded'].map((s) => `<span class="badge badge-outline"><span class="dotmark"></span>${s[0].toUpperCase() + s.slice(1)}</span>`).join('')}
          </div>
          <div class="alert alert-info mt-6"><svg class="a-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true"><use href="#i-info"/></svg><div class="a-body"><strong>The website cannot mark your payment successful.</strong> Only the gateway's signed server-to-server callback can. That protects you and us.</div></div>
        </div>
        <div class="card card-pad">
          <h3 class="h4 mb-4">Activation countdown</h3>
          <p class="muted text-sm">Once your deposit is confirmed, a 48 hour activation window starts, driven by a server timestamp — not your device clock.</p>
          <div class="countdown mt-4">
            <div class="cd-cell"><div class="v">02</div><div class="l">Days</div></div>
            <div class="cd-cell"><div class="v">23</div><div class="l">Hours</div></div>
            <div class="cd-cell"><div class="v">59</div><div class="l">Minutes</div></div>
            <div class="cd-cell"><div class="v">59</div><div class="l">Seconds</div></div>
          </div>
          <p class="hint mt-4">You can add products and branding while you wait. When the timer ends you see “Store Ready 🎉” with buttons to open your store and your dashboard.</p>
        </div>
      </div>

      <div class="card card-pad mt-10">
        <h3 class="h4 mb-4">Order lifecycle</h3>
        <ol class="steps">
          ${['Placed', 'Confirmed', 'Processing', 'Shipped', 'Out for delivery', 'Delivered'].map((s, i) => `<li class="step ${i === 0 ? 'is-active' : ''}"><span class="bubble">${i + 1}</span><span class="lbl">${s}</span></li>`).join('')}
        </ol>
        <p class="hint mt-6">Every move notifies the customer. On delivery, cash-on-delivery orders are marked paid and your share is settled to your available balance after the 5% commission.</p>
      </div>

      <div class="text-center mt-10">
        <a class="btn btn-primary btn-lg" href="${prefix}register.html">Start step 1 — register</a>
      </div>
    </div>
  </section>`;

const aboutContent = (prefix) => `
  <section class="page-hero">
    <div class="container">
      <nav class="breadcrumb" aria-label="Breadcrumb"><a href="${prefix}index.html">Home</a><span class="sep">/</span><span class="current">About</span></nav>
      <h1>We build the software so you can build the business</h1>
      <p class="lede">GrowBusiness Online exists because most small businesses in India are told that selling online needs a developer, a monthly subscription and a lot of patience. It doesn't.</p>
    </div>
  </section>
  <section class="section pt-0">
    <div class="container">
      <div class="grid g-2 align-center">
        <div>
          <h2 class="h3">Our promise</h2>
          <p class="muted mt-4">One refundable deposit. One dashboard. One storefront that looks like yours, not ours. We only earn when you do — our 5% commission is charged on delivered orders, so a cancelled order costs you nothing.</p>
          <ul class="check-list mt-6">
            <li><span class="tick"><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><use href="#i-check"/></svg></span><span>No monthly subscription, ever</span></li>
            <li><span class="tick"><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><use href="#i-check"/></svg></span><span>Your ₹1,000 deposit is refundable</span></li>
            <li><span class="tick"><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><use href="#i-check"/></svg></span><span>Your brand, your subdomain, your customers</span></li>
            <li><span class="tick"><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><use href="#i-check"/></svg></span><span>Money maths happens on the server, never in the browser</span></li>
          </ul>
        </div>
        <div class="reveal"><div class="frame" style="border-radius:var(--r-2xl);overflow:hidden;box-shadow:var(--sh-3);border:1px solid var(--line)"><img src="${prefix}assets/images/marketplace.svg" alt="Illustration of multiple vendor storefronts on one platform" width="680" height="460" loading="lazy"/></div></div>
      </div>

      <div class="stats-band card card-pad mt-12" data-platform-stats>
        <div class="stat-block"><div class="v brand" data-stat="vendors" data-count-up>0</div><div class="l">Stores on the platform</div></div>
        <div class="stat-block"><div class="v" data-stat="products" data-count-up>0</div><div class="l">Products listed</div></div>
        <div class="stat-block"><div class="v" data-stat="orders" data-count-up>0</div><div class="l">Orders processed</div></div>
        <div class="stat-block"><div class="v" data-stat="gmv" data-count-up>0</div><div class="l">Delivered order value</div></div>
      </div>

      <div class="grid g-3 mt-12">
        ${[
          ['target', 'Our mission', 'Give every small business in India a professional online store they can run themselves, in a single afternoon.'],
          ['eye', 'How we work', 'Server-side money, tenant isolation on every request, and a frontend that never trusts the browser with prices or balances.'],
          ['heart', 'Who we build for', 'Kirana stores, boutiques, electronics shops, home bakers and service businesses that want to sell beyond their street.'],
        ].map(([ic, t, b]) => `<div class="card card-pad reveal"><span class="f-ico" style="margin-bottom:var(--sp-4)"><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><use href="#i-${ic}"/></svg></span><h3 class="h4">${t}</h3><p class="muted text-sm mt-2">${b}</p></div>`).join('')}
      </div>

      <div class="cta-band mt-12 reveal">
        <h2>Come and see a live store</h2>
        <p>Browse the demo storefronts, then create your own in minutes.</p>
        <div class="row mt-6"><a class="btn btn-primary btn-lg" href="${prefix}pages/vendors.html">Browse stores</a><a class="btn btn-secondary btn-lg" href="${prefix}register.html">Create your store</a></div>
      </div>
    </div>
  </section>`;

const vendorsContent = (prefix) => `
  <section class="page-hero">
    <div class="container">
      <nav class="breadcrumb" aria-label="Breadcrumb"><a href="${prefix}index.html">Home</a><span class="sep">/</span><span class="current">Vendors</span></nav>
      <h1>Live stores on GrowBusiness Online</h1>
      <p class="lede">Every store below runs on the same platform with its own subdomain, branding, catalogue and checkout.</p>
    </div>
  </section>
  <section class="section pt-0">
    <div class="container">
      <div class="toolbar mb-6">
        <div class="toolbar-left"><span class="muted text-sm" data-vendor-count>Loading stores…</span></div>
        <div class="toolbar-right">
          <div class="input-group"><svg class="ico" viewBox="0 0 24 24" fill="none" aria-hidden="true"><use href="#i-search"/></svg><input class="input" type="search" placeholder="Search stores, cities, categories…" data-vendor-search aria-label="Search stores"/></div>
          <div class="select-wrap"><select class="select" data-vendor-type aria-label="Filter by business type"><option value="">All categories</option></select><svg class="sel" viewBox="0 0 24 24" fill="none" aria-hidden="true"><use href="#i-chevron-down"/></svg></div>
        </div>
      </div>
      <div class="vendor-grid" data-vendor-directory>
        ${Array.from({ length: 6 }, () => '<div class="skeleton sk-card" style="height:280px"></div>').join('')}
      </div>
      <div class="cta-band mt-12 reveal">
        <h2>Want your store in this list?</h2>
        <p>Register today, pay the ₹1,000 refundable deposit, and your storefront goes live within 48 hours.</p>
        <div class="row mt-6"><a class="btn btn-primary btn-lg" href="${prefix}register.html">Create your store</a></div>
      </div>
    </div>
  </section>`;

const contactContent = (prefix) => `
  <section class="page-hero">
    <div class="container">
      <nav class="breadcrumb" aria-label="Breadcrumb"><a href="${prefix}index.html">Home</a><span class="sep">/</span><span class="current">Contact</span></nav>
      <h1>Talk to a human</h1>
      <p class="lede">Questions about pricing, activation, payouts or a store you want to launch? Send a message and we reply within one working day.</p>
    </div>
  </section>
  <section class="section pt-0">
    <div class="container">
      <div class="contact-grid">
        <div class="card card-pad">
          <h2 class="h3 mb-6">Send us a message</h2>
          <form class="stack" data-contact-form novalidate>
            <div class="form-grid">
              <div class="field" data-field="name"><label class="label" for="ct-name">Your name</label><input class="input" id="ct-name" name="name" autocomplete="name" placeholder="Full name"/><span class="error-text" data-error></span></div>
              <div class="field" data-field="email"><label class="label" for="ct-email">Email</label><input class="input" id="ct-email" name="email" type="email" autocomplete="email" placeholder="you@example.com"/><span class="error-text" data-error></span></div>
              <div class="field" data-field="phone"><label class="label" for="ct-phone">Mobile <span class="opt">optional</span></label><input class="input" id="ct-phone" name="phone" inputmode="numeric" autocomplete="tel" placeholder="98765 43210"/></div>
              <div class="field" data-field="subject"><label class="label" for="ct-subject">Subject</label>
                <div class="select-wrap"><select class="select" id="ct-subject" name="subject">
                  <option value="">Choose a topic…</option>
                  <option>I want to open a store</option><option>Question about pricing</option><option>Deposit or activation</option><option>Payout or commission</option><option>Technical issue</option><option>Something else</option>
                </select><svg class="sel" viewBox="0 0 24 24" fill="none" aria-hidden="true"><use href="#i-chevron-down"/></svg></div>
              </div>
            </div>
            <div class="field" data-field="message"><label class="label" for="ct-message">Message</label><textarea class="textarea" id="ct-message" name="message" rows="5" placeholder="Tell us what you need…"></textarea><span class="error-text" data-error></span></div>
            <button type="submit" class="btn btn-primary btn-lg" data-label="Send message">Send message</button>
            <p class="hint">Please never send passwords, OTPs or full card numbers in a message.</p>
          </form>
        </div>
        <div class="stack">
          <div class="contact-card"><span class="ico"><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><use href="#i-mail"/></svg></span><div><h4>Email</h4><p><a href="mailto:support@growbusinessonline.com">support@growbusinessonline.com</a></p></div></div>
          <div class="contact-card"><span class="ico"><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><use href="#i-phone"/></svg></span><div><h4>Phone &amp; WhatsApp</h4><p><a href="tel:+919000000001">+91 90000 00001</a><br/>Mon–Sat, 10:00–19:00 IST</p></div></div>
          <div class="contact-card"><span class="ico"><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><use href="#i-map-pin"/></svg></span><div><h4>Office</h4><p>GrowBusiness Online<br/>Sector 14, Jhajjar, Haryana 124103, India</p></div></div>
          <div class="card card-pad">
            <h4 class="h4 mb-2">Already a vendor?</h4>
            <p class="muted text-sm">Raise a ticket from inside your dashboard so we can see your store context.</p>
            <a class="btn btn-secondary btn-sm mt-4" href="${prefix}login.html">Vendor login</a>
          </div>
        </div>
      </div>
    </div>
  </section>`;

const faqContent = () => `
  <section class="page-hero">
    <div class="container">
      <nav class="breadcrumb" aria-label="Breadcrumb"><a href="../index.html">Home</a><span class="sep">/</span><span class="current">FAQ</span></nav>
      <h1>Frequently asked questions</h1>
      <p class="lede">Answers about pricing, the refundable deposit, activation, orders, payouts and your storefront.</p>
      <div class="input-group mt-6" style="max-width:460px"><svg class="ico" viewBox="0 0 24 24" fill="none" aria-hidden="true"><use href="#i-search"/></svg><input class="input" type="search" placeholder="Search the FAQ…" data-faq-search aria-label="Search frequently asked questions"/></div>
    </div>
  </section>
  <section class="section pt-0">
    <div class="container" style="max-width:900px">
      <div class="stack-lg" data-faq-list>${FAQS.map(faqBlock).join('')}</div>
      <div class="empty hidden mt-6" data-faq-empty><div class="art"><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><use href="#i-search"/></svg></div><h3>No answers match that search</h3><p>Try a different word, or send us your question directly.</p><a class="btn btn-primary" href="contact.html">Contact support</a></div>
      <div class="cta-band mt-12 reveal">
        <h2>Still unsure about something?</h2>
        <p>Ask us before you pay anything. We would rather answer ten questions than have one unhappy vendor.</p>
        <div class="row mt-6"><a class="btn btn-primary btn-lg" href="contact.html">Contact us</a><a class="btn btn-secondary btn-lg" href="../register.html">Create your store</a></div>
      </div>
    </div>
  </section>`;

const legalContent = (doc_, prefix) => `
  <section class="page-hero">
    <div class="container">
      <nav class="breadcrumb" aria-label="Breadcrumb"><a href="${prefix}index.html">Home</a><span class="sep">/</span><span class="current">${doc_.title}</span></nav>
      <h1>${doc_.title}</h1>
      <p class="updated mt-4">Last updated: ${doc_.updated}</p>
      <p class="lede">${doc_.intro}</p>
    </div>
  </section>
  <section class="section pt-0">
    <div class="container">
      <div class="legal-layout">
        <article class="legal-body">
          ${doc_.sections.map((s) => `<h2 id="${slug(s.h)}">${s.h}</h2><p>${s.p}</p>`).join('')}
          <div class="card card-pad mt-10">
            <h3 class="h4">Questions about this policy?</h3>
            <p class="muted text-sm mt-2">Write to <a href="mailto:support@growbusinessonline.com">support@growbusinessonline.com</a> or call <a href="tel:+919000000001">+91 90000 00001</a>.</p>
          </div>
        </article>
        <aside>
          <nav class="card card-pad legal-toc" aria-label="On this page">
            <h4 class="upper muted mb-4">On this page</h4>
            ${doc_.sections.map((s) => `<a href="#${slug(s.h)}">${s.h}</a>`).join('')}
          </nav>
        </aside>
      </div>
    </div>
  </section>`;

const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/* ------------------------------------------------------------ auth pages */

const authShell = ({ prefix, side, main, title }) => `
  <div class="auth-page">
    <aside class="auth-side">
      <a class="brand" href="${prefix}index.html">
        <span class="brand-mark"><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><use href="#i-trending-up"/></svg></span>
        <span class="brand-text"><strong>GrowBusiness</strong><small>Online</small></span>
      </a>
      ${side}
      <a class="auth-quote" href="${prefix}index.html">
        <p>← Back to the website</p>
        <div class="who">${title}</div>
      </a>
    </aside>
    <main class="auth-main" id="main">${main}</main>
  </div>`;

const authSideDefault = `
  <div>
    <h2>Your business, online in 48 hours</h2>
    <p>One refundable deposit. No monthly fee. Your own storefront, dashboard and payouts.</p>
    <ul class="auth-points">
      <li><span class="ico"><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><use href="#i-store"/></svg></span><span>Your own subdomain storefront</span></li>
      <li><span class="ico"><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><use href="#i-package"/></svg></span><span>Unlimited products and categories</span></li>
      <li><span class="ico"><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><use href="#i-credit"/></svg></span><span>UPI, cards, net banking and COD</span></li>
      <li><span class="ico"><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><use href="#i-chart-line"/></svg></span><span>Sales analytics and payouts</span></li>
    </ul>
  </div>`;

const loginContent = (prefix) => authShell({
  prefix,
  title: 'Vendor, customer and admin sign in',
  side: authSideDefault,
  main: `
    <div class="auth-card">
      <div class="auth-head">
        <h1>Welcome back</h1>
        <p>Sign in to manage your store, track an order or reach the platform console.</p>
      </div>
      <form class="stack" data-login-form novalidate>
        <div class="hidden" data-form-error role="alert"></div>
        <div class="field" data-field="identifier">
          <label class="label" for="li-id">Email or mobile number</label>
          <div class="input-group"><svg class="ico" viewBox="0 0 24 24" fill="none" aria-hidden="true"><use href="#i-mail"/></svg><input class="input" id="li-id" name="identifier" type="text" autocomplete="username" placeholder="you@example.com" data-autofocus/></div>
          <span class="error-text" data-error></span>
        </div>
        <div class="field" data-field="password">
          <div class="row row-between"><label class="label" for="li-pw">Password</label><a class="link-btn text-sm" href="${prefix}forgot-password.html">Forgot password?</a></div>
          <div class="input-group"><svg class="ico" viewBox="0 0 24 24" fill="none" aria-hidden="true"><use href="#i-lock"/></svg><input class="input" id="li-pw" name="password" type="password" autocomplete="current-password" placeholder="Your password"/><button type="button" class="suffix icon-btn ghost" data-toggle-password aria-label="Show password"><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><use href="#i-eye"/></svg></button></div>
          <span class="error-text" data-error></span>
        </div>
        <label class="check"><input type="checkbox" name="remember" checked/><span class="box"><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><use href="#i-check"/></svg></span><span class="text">Keep me signed in on this device</span></label>
        <button type="submit" class="btn btn-primary btn-lg btn-block" data-label="Signing in">Sign in</button>
      </form>
      <p class="auth-foot">New to GrowBusiness Online? <a href="${prefix}register.html">Create your store</a></p>
      <div data-demo-accounts></div>
    </div>`,
});

const registerContent = (prefix) => authShell({
  prefix,
  title: 'Vendor registration — account, then deposit',
  side: `
    <div>
      <h2>Register your business</h2>
      <p>Two short steps: create your account, then pay the ₹1,000 refundable security deposit to start activation.</p>
      <ul class="auth-points">
        <li><span class="ico"><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><use href="#i-user-plus"/></svg></span><span>Step 1 — account created instantly</span></li>
        <li><span class="ico"><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><use href="#i-shield-check"/></svg></span><span>Step 2 — ₹1,000 refundable security deposit</span></li>
        <li><span class="ico"><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><use href="#i-clock"/></svg></span><span>Step 3 — 48 hour activation window</span></li>
        <li><span class="ico"><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><use href="#i-rocket"/></svg></span><span>Step 4 — your store goes live</span></li>
      </ul>
    </div>`,
  main: `
    <div class="auth-card wide">
      <div class="auth-head">
        <h1>Create your vendor account</h1>
        <p>It takes about two minutes. You can add products while your store activates.</p>
        <div class="progress progress-sm mt-6"><span data-step-progress style="width:50%"></span></div>
      </div>

      <form class="stack" data-register-form novalidate>
        <div class="step" data-step="1">
          <h2 class="h4 mb-4">1 · Your login details</h2>
          <div class="form-grid">
            <div class="field" data-field="name"><label class="label" for="rg-name">Full name</label><input class="input" id="rg-name" name="name" autocomplete="name" placeholder="Your full name" data-autofocus/><span class="error-text" data-error></span></div>
            <div class="field" data-field="email"><label class="label" for="rg-email">Email</label><input class="input" id="rg-email" name="email" type="email" autocomplete="email" placeholder="you@example.com"/><span class="error-text" data-error></span></div>
            <div class="field" data-field="phone"><label class="label" for="rg-phone">Mobile number</label><div class="input-group"><span class="prefix">+91</span><input class="input" id="rg-phone" name="phone" inputmode="numeric" maxlength="10" autocomplete="tel-national" placeholder="98765 43210"/></div><span class="error-text" data-error></span></div>
            <div class="field" data-field="password">
              <label class="label" for="rg-pw">Password</label>
              <div class="input-group"><input class="input" id="rg-pw" name="password" type="password" autocomplete="new-password" placeholder="At least 8 characters"/><button type="button" class="suffix icon-btn ghost" data-toggle-password aria-label="Show password"><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><use href="#i-eye"/></svg></button></div>
              <div class="password-meter" data-password-meter><span class="bar"><span></span></span><span class="lbl">Too short</span></div>
              <span class="error-text" data-error></span>
            </div>
            <div class="field" data-field="confirmPassword"><label class="label" for="rg-pw2">Confirm password</label><input class="input" id="rg-pw2" name="confirmPassword" type="password" autocomplete="new-password" placeholder="Repeat your password"/><span class="error-text" data-error></span></div>
          </div>
          <div class="row mt-6"><button type="button" class="btn btn-primary btn-lg" data-next-step>Continue <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><use href="#i-arrow-right"/></svg></button><a class="btn btn-ghost btn-lg" href="${prefix}login.html">I already have an account</a></div>
        </div>

        <div class="step hidden" data-step="2">
          <h2 class="h4 mb-4">2 · Your business details</h2>
          <div class="form-grid">
            <div class="field" data-field="businessName"><label class="label" for="rg-biz">Business name</label><input class="input" id="rg-biz" name="businessName" placeholder="e.g. Sharma Electronics"/><span class="error-text" data-error></span></div>
            <div class="field" data-field="businessType"><label class="label" for="rg-type">Business type</label><div class="select-wrap"><select class="select" id="rg-type" name="businessType"><option value="">Select business type</option></select><svg class="sel" viewBox="0 0 24 24" fill="none" aria-hidden="true"><use href="#i-chevron-down"/></svg></div><span class="error-text" data-error></span></div>
            <div class="field span-2" data-field="address"><label class="label" for="rg-addr">Address</label><textarea class="textarea" id="rg-addr" name="address" rows="2" placeholder="Shop number, street, landmark"></textarea><span class="error-text" data-error></span></div>
            <div class="field" data-field="city"><label class="label" for="rg-city">City</label><input class="input" id="rg-city" name="city" placeholder="City"/><span class="error-text" data-error></span></div>
            <div class="field" data-field="state"><label class="label" for="rg-state">State</label><input class="input" id="rg-state" name="state" placeholder="State"/><span class="error-text" data-error></span></div>
            <div class="field" data-field="country"><label class="label" for="rg-country">Country</label><input class="input" id="rg-country" name="country" value="India"/><span class="error-text" data-error></span></div>
            <div class="field" data-field="pincode"><label class="label" for="rg-pin">Pincode</label><input class="input" id="rg-pin" name="pincode" inputmode="numeric" maxlength="6" placeholder="6 digit pincode"/><span class="error-text" data-error></span></div>
          </div>
          <label class="check mt-6" data-field="agree"><input type="checkbox" name="agree"/><span class="box"><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><use href="#i-check"/></svg></span><span class="text">I agree to the <a href="${prefix}pages/terms.html">Terms of Service</a>, <a href="${prefix}pages/privacy.html">Privacy Policy</a> and <a href="${prefix}pages/vendor-agreement.html">Vendor Agreement</a>.</span></label>
          <span class="error-text" data-error></span>
          <div class="alert alert-brand mt-6"><svg class="a-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true"><use href="#i-info"/></svg><div class="a-body"><strong>What happens next</strong> Your account is created, then you pay the ₹1,000 refundable security deposit. Activation starts immediately after the gateway confirms the payment.</div></div>
          <div class="row mt-6"><button type="button" class="btn btn-ghost btn-lg" data-prev-step><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><use href="#i-arrow-left"/></svg> Back</button><button type="submit" class="btn btn-primary btn-lg" data-label="Creating account">Create account &amp; continue</button></div>
        </div>
      </form>
      <div data-demo-accounts></div>
    </div>`,
});

const forgotContent = (prefix) => authShell({
  prefix,
  title: 'Reset your password',
  side: authSideDefault,
  main: `
    <div class="auth-card">
      <div class="auth-head"><h1>Forgot your password?</h1><p>Enter the email on your account and we will send a reset link. For safety, using the link signs out your other devices.</p></div>
      <form class="stack" data-forgot-form novalidate>
        <div class="field" data-field="email"><label class="label" for="fp-email">Email address</label><div class="input-group"><svg class="ico" viewBox="0 0 24 24" fill="none" aria-hidden="true"><use href="#i-mail"/></svg><input class="input" id="fp-email" name="email" type="email" autocomplete="email" placeholder="you@example.com" data-autofocus/></div><span class="error-text" data-error></span></div>
        <button type="submit" class="btn btn-primary btn-lg btn-block" data-label="Sending link">Send reset link</button>
      </form>
      <div class="hidden" data-forgot-done>
        <div class="empty"><div class="art"><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><use href="#i-mail"/></svg></div><h3>Check your inbox</h3><p>If <strong data-forgot-email>that address</strong> is registered, a reset link is on its way. It expires in 30 minutes.</p></div>
        <div class="hidden" data-dev-reset></div>
        <a class="btn btn-secondary btn-block mt-6" href="${prefix}login.html">Back to sign in</a>
      </div>
      <p class="auth-foot">Remembered it? <a href="${prefix}login.html">Sign in</a></p>
    </div>`,
});

const resetContent = (prefix) => authShell({
  prefix,
  title: 'Choose a new password',
  side: authSideDefault,
  main: `
    <div class="auth-card">
      <div class="auth-head"><h1>Choose a new password</h1><p>Use at least 8 characters. Changing your password signs out every other device.</p></div>
      <div class="hidden" data-reset-invalid><div class="alert alert-danger"><svg class="a-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true"><use href="#i-alert-circle"/></svg><div class="a-body"><strong>This reset link is not valid</strong> It may have expired or already been used. <a href="${prefix}forgot-password.html">Request a new link</a>.</div></div></div>
      <form class="stack" data-reset-form novalidate>
        <input type="hidden" name="token"/>
        <div class="field" data-field="password">
          <label class="label" for="rp-pw">New password</label>
          <div class="input-group"><input class="input" id="rp-pw" name="password" type="password" autocomplete="new-password" data-autofocus/><button type="button" class="suffix icon-btn ghost" data-toggle-password aria-label="Show password"><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><use href="#i-eye"/></svg></button></div>
          <div class="password-meter" data-password-meter><span class="bar"><span></span></span><span class="lbl">Too short</span></div>
          <span class="error-text" data-error></span>
        </div>
        <div class="field" data-field="confirmPassword"><label class="label" for="rp-pw2">Confirm new password</label><input class="input" id="rp-pw2" name="confirmPassword" type="password" autocomplete="new-password"/><span class="error-text" data-error></span></div>
        <button type="submit" class="btn btn-primary btn-lg btn-block" data-label="Updating password">Update password</button>
      </form>
      <p class="auth-foot"><a href="${prefix}login.html">Back to sign in</a></p>
    </div>`,
});

/* ------------------------------------------------ onboarding (deposit etc) */

const depositContent = (prefix) => `
  <main class="pay-page" id="main">
    <div style="width:min(560px,100%)">
      <a class="brand mb-6" href="${prefix}index.html" style="justify-content:center">
        <span class="brand-mark"><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><use href="#i-trending-up"/></svg></span>
        <span class="brand-text"><strong>GrowBusiness</strong><small>Online</small></span>
      </a>
      <div data-deposit-host>
        <div class="pay-card"><div class="pay-head"><div class="skeleton sk-title" style="margin:0 auto 14px"></div><div class="skeleton" style="height:52px;width:60%;margin:0 auto;border-radius:12px"></div></div><div class="pay-body"><div class="skeleton sk-row"></div><div class="skeleton sk-row"></div><div class="skeleton sk-btn"></div></div></div>
      </div>
      <p class="hint text-center mt-6">Step 2 of 4 · Need help? <a href="${prefix}pages/contact.html">Contact support</a></p>
    </div>
  </main>`;

const activationContent = (prefix) => `
  <main class="pay-page" id="main">
    <div style="width:min(620px,100%)">
      <a class="brand mb-6" href="${prefix}index.html" style="justify-content:center">
        <span class="brand-mark"><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><use href="#i-trending-up"/></svg></span>
        <span class="brand-text"><strong>GrowBusiness</strong><small>Online</small></span>
      </a>
      <div data-activation-host>
        <div class="pay-card"><div class="pay-body"><div class="skeleton sk-row"></div><div class="skeleton sk-row"></div><div class="skeleton sk-row"></div></div></div>
      </div>
      <p class="hint text-center mt-6">Step 3 of 4 · The countdown uses a server timestamp, so it cannot be changed on this device.</p>
    </div>
  </main>`;

/* ------------------------------------------------------------ 404 page */

const notFoundContent = (prefix) => `
  <main class="notfound" id="main">
    <div>
      <div class="code">404</div>
      <h1 class="mt-4">This page does not exist</h1>
      <p class="lede mt-4" style="margin-inline:auto">The link may be old, or the store you were looking for has moved. Everything else is still exactly where you left it.</p>
      <div class="row mt-8" style="justify-content:center;flex-wrap:wrap">
        <a class="btn btn-primary btn-lg" href="${prefix}index.html"><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><use href="#i-home"/></svg> Back to home</a>
        <a class="btn btn-secondary btn-lg" href="${prefix}pages/vendors.html"><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><use href="#i-store"/></svg> Browse stores</a>
      </div>
      <p class="hint mt-8">Looking for a store? Try <span class="mono">storename.${'growbusinessonline.com'}</span></p>
    </div>
  </main>`;

/* --------------------------------------------------------------- build */

const PAGES = [];

const add = (file, html) => PAGES.push({ file, html });

/* marketing (root) */
add('index.html', marketing({
  page: 'home',
  title: 'GrowBusiness Online — Create Your Online Store, Manage Orders & Grow',
  description: 'Create your own online store on your own subdomain. Manage products, orders, customers and payments from one dashboard. ₹1,000 refundable deposit, no monthly fee, 5% commission on delivered orders.',
  canonical: `${SITE}/`,
  content: homeContent(''),
  head: `<script type="application/ld+json">${JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: 'GrowBusiness Online',
    url: SITE,
    logo: `${SITE}/assets/images/logos/growbusiness.svg`,
    description: 'Multi-vendor commerce platform for Indian small businesses.',
    address: { '@type': 'PostalAddress', streetAddress: 'Sector 14', addressLocality: 'Jhajjar', addressRegion: 'Haryana', postalCode: '124103', addressCountry: 'IN' },
    contactPoint: { '@type': 'ContactPoint', telephone: '+91-90000-00001', contactType: 'customer support', email: 'support@growbusinessonline.com', availableLanguage: ['en', 'hi'] },
    sameAs: [],
  })}</script>
  <script type="application/ld+json">${JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: 'GrowBusiness Online vendor store',
    description: 'Online storefront with product, order, customer and payment management.',
    offers: { '@type': 'Offer', priceCurrency: 'INR', price: '1000', description: 'One-time refundable security deposit. 5% commission on delivered orders.', availability: 'https://schema.org/InStock' },
  })}</script>`,
}));

/* marketing (pages/) */
add('pages/features.html', marketing({
  page: 'page-features', depth: 1,
  title: 'Features — Store, Products, Orders, Payments & Analytics | GrowBusiness Online',
  description: 'Twelve features included with every store: online storefront, product and order management, customers, analytics, notifications, payments, custom branding and a mobile responsive design.',
  canonical: `${SITE}/pages/features.html`,
  content: featuresContent('../'),
}));

add('pages/pricing.html', marketing({
  page: 'page-pricing', depth: 1,
  title: 'Pricing — ₹1,000 Refundable Deposit + 5% Commission | GrowBusiness Online',
  description: 'No monthly fee. Pay a one-time ₹1,000 refundable security deposit and 5% commission on delivered orders. Use the commission calculator to see exactly what you keep.',
  canonical: `${SITE}/pages/pricing.html`,
  content: pricingContent('../'),
  head: `<script type="application/ld+json">${JSON.stringify({
    '@context': 'https://schema.org', '@type': 'FAQPage',
    mainEntity: [
      { '@type': 'Question', name: 'How much does it cost to start selling?', acceptedAnswer: { '@type': 'Answer', text: 'A one-time ₹1,000 refundable security deposit plus 5% commission on delivered orders. There is no monthly fee.' } },
      { '@type': 'Question', name: 'Is the ₹1,000 deposit refundable?', acceptedAnswer: { '@type': 'Answer', text: 'Yes. It is returned in full when you close your store in good standing.' } },
    ],
  })}</script>`,
}));

add('pages/how-it-works.html', marketing({
  page: 'page-how', depth: 1,
  title: 'How It Works — Register, Deposit, Setup, Launch | GrowBusiness Online',
  description: 'Four steps to your online store: register, pay the ₹1,000 refundable security deposit, complete store setup, and launch after the 48 hour activation window.',
  canonical: `${SITE}/pages/how-it-works.html`,
  content: howContent('../'),
}));

add('pages/about.html', marketing({
  page: 'page-about', depth: 1,
  title: 'About GrowBusiness Online — Online Stores for Indian Small Businesses',
  description: 'We build the software so you can build the business. One refundable deposit, one dashboard, and a storefront that looks like yours — not ours.',
  canonical: `${SITE}/pages/about.html`,
  content: aboutContent('../'),
}));

add('pages/vendors.html', marketing({
  page: 'page-vendors', depth: 1,
  title: 'Vendor Stores — Browse Live Storefronts | GrowBusiness Online',
  description: 'Browse live stores on GrowBusiness Online. Each runs on the same platform with its own subdomain, branding, catalogue and checkout.',
  canonical: `${SITE}/pages/vendors.html`,
  content: vendorsContent('../'),
}));

add('pages/contact.html', marketing({
  page: 'page-contact', depth: 1,
  title: 'Contact Us — Support for Vendors & Customers | GrowBusiness Online',
  description: 'Email support@growbusinessonline.com, call +91 90000 00001, or send a message. We reply within one working day.',
  canonical: `${SITE}/pages/contact.html`,
  content: contactContent('../'),
}));

add('pages/faq.html', marketing({
  page: 'page-faq', depth: 1,
  title: 'FAQ — Deposits, Activation, Orders, Payouts | GrowBusiness Online',
  description: 'Answers about the ₹1,000 refundable deposit, 48 hour activation, the 5% commission, payment methods, payouts, refunds and store branding.',
  canonical: `${SITE}/pages/faq.html`,
  head: `<script type="application/ld+json">${JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: FAQS.flatMap((g) => g.items).map((i) => ({ '@type': 'Question', name: i.q, acceptedAnswer: { '@type': 'Answer', text: i.a } })),
  })}</script>`,
  content: faqContent(),
}));

for (const [key, file] of [['terms', 'terms.html'], ['privacy', 'privacy.html'], ['refund', 'refund-policy.html'], ['vendor', 'vendor-agreement.html']]) {
  const d = LEGAL[key];
  add(`pages/${file}`, marketing({
    page: 'page-legal', depth: 1,
    title: `${d.title} | GrowBusiness Online`,
    description: `${d.intro}`.slice(0, 158),
    canonical: `${SITE}/pages/${file}`,
    content: legalContent(d, '../'),
  }));
}

/* auth + onboarding */
add('login.html', doc({
  page: 'login', title: 'Login — Vendor, Customer & Admin | GrowBusiness Online',
  description: 'Sign in to your GrowBusiness Online store dashboard, customer account or platform console.',
  canonical: `${SITE}/login.html`, robots: 'noindex,follow', bodyClass: 'auth-body',
  body: loginContent(''),
}));
add('register.html', doc({
  page: 'register', title: 'Register Your Business — Create Your Online Store | GrowBusiness Online',
  description: 'Create your vendor account, then pay the ₹1,000 refundable security deposit to activate your own online store.',
  canonical: `${SITE}/register.html`, robots: 'noindex,follow', bodyClass: 'auth-body',
  body: registerContent(''),
}));
add('forgot-password.html', doc({
  page: 'forgot', title: 'Forgot Password | GrowBusiness Online',
  description: 'Reset your GrowBusiness Online password with a secure emailed link.',
  canonical: `${SITE}/forgot-password.html`, robots: 'noindex,nofollow', bodyClass: 'auth-body',
  body: forgotContent(''),
}));
add('reset-password.html', doc({
  page: 'reset', title: 'Reset Password | GrowBusiness Online',
  description: 'Choose a new password for your GrowBusiness Online account.',
  canonical: `${SITE}/reset-password.html`, robots: 'noindex,nofollow', bodyClass: 'auth-body',
  body: resetContent(''),
}));
add('deposit.html', doc({
  page: 'deposit', title: '₹1,000 Security Deposit | GrowBusiness Online',
  description: 'Pay the one-time ₹1,000 refundable security deposit to activate your store. Only the payment gateway can confirm a payment.',
  canonical: `${SITE}/deposit.html`, robots: 'noindex,nofollow', bodyClass: 'pay-body',
  body: depositContent(''),
}));
add('activation.html', doc({
  page: 'activation', title: 'Store Activation — 48 Hour Countdown | GrowBusiness Online',
  description: 'Your store activation countdown, driven by a server timestamp. Prepare your branding and products while you wait.',
  canonical: `${SITE}/activation.html`, robots: 'noindex,nofollow', bodyClass: 'pay-body',
  body: activationContent(''),
}));

/* storefront (vendor/) */
const vendorPages = [
  ['index.html', 'store', 'Online Store — Shop Products & Categories', 'Shop the full catalogue with categories, search, product details, cart and secure checkout.'],
  ['category.html', 'store-category', 'All Products — Browse, Search & Filter', 'Browse every product with category filters, price range, availability and sorting.'],
  ['product.html', 'store-product', 'Product Details — Price, Reviews & Buy', 'Product gallery, specifications, availability, reviews and related products.'],
  ['cart.html', 'store-cart', 'Shopping Cart — Review Your Items', 'Review your cart, adjust quantities and see a server-verified order summary.'],
  ['checkout.html', 'store-checkout', 'Checkout — Delivery Details & Payment', 'Enter your delivery details and choose UPI, card, net banking or cash on delivery.'],
  ['success.html', 'store-success', 'Order Confirmed — Thank You', 'Your order is confirmed. Track its progress from placed to delivered.'],
  ['orders.html', 'store-orders', 'My Orders — Track Every Purchase', 'Your order history with live status, payment state and estimated delivery.'],
  ['order-detail.html', 'store-order', 'Track Your Order', 'Track an order with the order number plus the mobile number or email you used.'],
  ['account.html', 'store-account', 'My Account — Profile, Addresses & Notifications', 'Manage your profile, saved addresses, notifications and wishlist.'],
  ['wishlist.html', 'store-wishlist', 'My Wishlist — Saved Products', 'Products you saved, from every store on the platform.'],
];
for (const [file, page, title, description] of vendorPages) {
  add(`vendor/${file}`, storefrontPage({
    page,
    title: `${title} | GrowBusiness Online`,
    description,
    canonical: `${SITE}/vendor/${file}`,
    robots: ['checkout.html', 'success.html', 'account.html'].includes(file) ? 'noindex,nofollow' : 'index,follow',
  }));
}

/* vendor console (admin/) */
const dashPages = [
  ['dashboard.html', 'dash', 'Dashboard', 'Your store at a glance: sales, orders, customers, products, balance and commission.'],
  ['analytics.html', 'dash-analytics', 'Sales Analytics', 'Sales, revenue, commission, category mix and delivery cities over 7, 30 or 90 days.'],
  ['notifications.html', 'dash-notifications', 'Notifications', 'New orders, order updates, payments, withdrawals and platform announcements.'],
  ['products.html', 'dash-products', 'Products', 'Add and edit products with prices, MRP, discounts, stock, images and specifications.'],
  ['categories.html', 'dash-categories', 'Categories', 'Organise your catalogue so customers find products faster.'],
  ['store.html', 'dash-store', 'My Store', 'Preview your live storefront and check your store health.'],
  ['orders.html', 'dash-orders', 'Orders', 'Confirm, process, ship and deliver orders from one queue.'],
  ['order-detail.html', 'dash-order', 'Order Details', 'Everything about one order: items, customer, address, settlement and timeline.'],
  ['customers.html', 'dash-customers', 'Customers', 'Every buyer, their order history, lifetime spend and city.'],
  ['payments.html', 'dash-payments', 'Payments', 'Every payment collected, the commission charged and your ledger.'],
  ['balance.html', 'dash-balance', 'Balance', 'Available, pending, reserved, total earnings, commission and withdrawn.'],
  ['withdrawals.html', 'dash-withdrawals', 'Withdrawals', 'Request a payout to your bank account or UPI ID and track its status.'],
  ['settings.html', 'dash-settings', 'Store Settings', 'Branding, business details, opening hours, social links, payments and SEO.'],
  ['profile.html', 'dash-profile', 'Profile', 'Your login details, password and session security.'],
  ['support.html', 'dash-support', 'Support', 'Raise a support request and find answers to common vendor questions.'],
];
for (const [file, page, title, description] of dashPages) {
  add(`admin/${file}`, dashboardPage({ page, title: `${title} · Vendor Console | GrowBusiness Online`, description }));
}

/* platform console (super admin) */
const consolePages = [
  ['index.html', 'console', 'Platform Overview', 'Platform-wide stores, GMV, commission, deposits and payouts.'],
  ['vendors.html', 'console-vendors', 'Stores', 'Approve, suspend and configure every store on the platform.'],
  ['deposits.html', 'console-deposits', 'Security Deposits', 'Review ₹1,000 refundable deposits and their gateway status.'],
  ['withdrawals.html', 'console-withdrawals', 'Payouts', 'Approve, pay or reject vendor withdrawal requests.'],
  ['orders.html', 'console-orders', 'All Orders', 'Platform-wide order oversight across every store.'],
  ['messages.html', 'console-messages', 'Messages', 'Support requests from vendors and website visitors.'],
];
for (const [file, page, title, description] of consolePages) {
  add(`admin/${file}`, dashboardPage({ page, title: `${title} · Platform Console | GrowBusiness Online`, description, variant: 'console' }));
}

/* 404 */
add('404.html', doc({
  page: 'notfound', title: 'Page Not Found (404) | GrowBusiness Online',
  description: 'That page does not exist. Go back home or browse the live vendor stores.',
  canonical: `${SITE}/404.html`, robots: 'noindex,nofollow',
  body: notFoundContent(''),
}));

/* robots + sitemap */
const sitemapUrls = PAGES.filter((p) => !/404|login|register|forgot|reset|deposit|activation|admin\//.test(p.file))
  .map((p) => `  <url><loc>${SITE}/${p.file === 'index.html' ? '' : p.file}</loc><changefreq>weekly</changefreq></url>`);

/* ------------------------------------------------------------------ write */

let written = 0;
for (const { file, html } of PAGES) {
  const out = path.join(FE, file);
  mkdirSync(path.dirname(out), { recursive: true });
  writeFileSync(out, html, 'utf8');
  written++;
}

writeFileSync(path.join(FE, 'robots.txt'), `User-agent: *
Allow: /
Disallow: /admin/
Disallow: /vendor/cart.html
Disallow: /vendor/checkout.html
Disallow: /vendor/account.html
Disallow: /deposit.html
Disallow: /activation.html

Sitemap: ${SITE}/sitemap.xml
`, 'utf8');

writeFileSync(path.join(FE, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${sitemapUrls.join('\n')}
</urlset>
`, 'utf8');

// .htaccess so the same files behave correctly on Hostinger (Apache/LiteSpeed).
writeFileSync(path.join(FE, '.htaccess'), `# GrowBusiness Online — Hostinger / Apache configuration
# Multi-vendor subdomains share ONE frontend (spec §4). Point a wildcard
# subdomain (*.growbusinessonline.com) at this folder and js/vendor.js reads
# the tenant straight from the hostname.

Options -Indexes
DirectoryIndex index.html

<IfModule mod_rewrite.c>
  RewriteEngine On

  # Never expose dotfiles.
  RewriteRule (^|/)\\. - [F]

  # Force HTTPS in production (comment out for local previews).
  # RewriteCond %{HTTPS} off
  # RewriteRule ^(.*)$ https://%{HTTP_HOST}/$1 [R=301,L]

  # Custom error page.
  ErrorDocument 404 /404.html

  # Pretty URLs: /about -> /pages/about.html (only when the file is missing).
  RewriteCond %{REQUEST_FILENAME} !-f
  RewriteCond %{REQUEST_FILENAME} !-d
  RewriteRule ^([a-z0-9-]+)/?$ pages/$1.html [L]
</IfModule>

<IfModule mod_headers.c>
  Header set X-Content-Type-Options "nosniff"
  Header set X-Frame-Options "SAMEORIGIN"
  Header set Referrer-Policy "strict-origin-when-cross-origin"
  Header set Permissions-Policy "geolocation=(), microphone=(), camera=()"

  # Long cache for fingerprinted/static assets, short for HTML.
  <FilesMatch "\\.(svg|webp|avif|jpg|jpeg|png|gif|woff2?)$">
    Header set Cache-Control "public, max-age=2592000"
  </FilesMatch>
  <FilesMatch "\\.(css|js)$">
    Header set Cache-Control "public, max-age=86400"
  </FilesMatch>
  <FilesMatch "\\.html$">
    Header set Cache-Control "no-cache"
  </FilesMatch>
</IfModule>

<IfModule mod_deflate.c>
  AddOutputFilterByType DEFLATE text/html text/css text/javascript application/javascript application/json image/svg+xml
</IfModule>

<IfModule mod_mime.c>
  AddType application/javascript .js .mjs
  AddType text/css .css
  AddType image/svg+xml .svg
  AddType image/webp .webp
  AddType image/avif .avif
</IfModule>
`, 'utf8');

console.log(`✔ Generated ${written} HTML pages + robots.txt, sitemap.xml, .htaccess`);
console.log(`  root:   ${PAGES.filter((p) => !p.file.includes('/')).length}`);
console.log(`  pages/: ${PAGES.filter((p) => p.file.startsWith('pages/')).length}`);
console.log(`  vendor/:${PAGES.filter((p) => p.file.startsWith('vendor/')).length}`);
console.log(`  admin/: ${PAGES.filter((p) => p.file.startsWith('admin/')).length}`);
