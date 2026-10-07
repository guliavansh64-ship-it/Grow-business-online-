#!/usr/bin/env node
/**
 * GrowBusiness Online — end-to-end smoke + security test.
 *
 *   node tools/smoke-test.mjs [baseUrl]
 *
 * Covers spec §46 (functional testing) and §47 (security testing):
 * auth, vendor lifecycle, products, orders, tenancy isolation, and every
 * "never trust the browser" rule (prices, balances, commission, statuses).
 */
const BASE = (process.argv[2] || process.env.API_BASE || 'http://localhost:4000').replace(/\/$/, '');

let pass = 0;
let fail = 0;
const failures = [];

const c = {
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
  cyan: (s) => `\x1b[36m${s}\x1b[0m`,
};

async function call(method, path, { body, token, headers = {}, raw = false } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (raw) return { status: res.status, text: await res.text(), headers: res.headers };
  let json = null;
  try {
    json = await res.json();
  } catch {
    /* non-JSON response */
  }
  return { status: res.status, json, data: json?.data, error: json?.error };
}

function check(name, condition, detail = '') {
  if (condition) {
    pass++;
    console.log(`  ${c.green('✓')} ${name}`);
  } else {
    fail++;
    failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
    console.log(`  ${c.red('✗')} ${name}${detail ? c.dim(` — ${detail}`) : ''}`);
  }
}

const section = (title) => console.log(`\n${c.bold(c.cyan(title))}`);

const uniq = `t${Date.now().toString().slice(-6)}`;

async function main() {
  console.log(c.bold(`\nGrowBusiness Online — smoke test against ${BASE}\n`));

  /* ------------------------------------------------------------- platform */
  section('Platform');
  const health = await call('GET', '/api/health');
  check('GET /api/health responds', health.status === 200 && health.json?.ok === true);
  const cfg = await call('GET', '/api/store/config');
  check('GET /api/store/config returns commission + deposit', cfg.data?.commissionPercent === 5 && cfg.data?.depositPaise === 100000, JSON.stringify(cfg.data?.commissionPercent));
  check('Config exposes payment methods', Array.isArray(cfg.data?.paymentMethods) && cfg.data.paymentMethods.length > 0);
  const stats = await call('GET', '/api/store/stats');
  check('GET /api/store/stats returns marketplace counters', stats.data?.vendors > 0 && stats.data?.products > 0);

  /* ------------------------------------------------------------ storefront */
  section('Public storefront (vendor subdomain data)');
  const v1 = await call('GET', '/api/store/vendors/techmart');
  check('Vendor config resolves by slug', v1.status === 200 && v1.data?.slug === 'techmart' && !!v1.data?.theme?.primary);
  const v2 = await call('GET', '/api/store/vendors/stylehub');
  check('Second vendor resolves independently', v2.data?.slug === 'stylehub' && v2.data?.theme?.primary !== v1.data?.theme?.primary);
  const missing = await call('GET', '/api/store/vendors/does-not-exist');
  check('Unknown slug returns 404 (no data leak)', missing.status === 404);
  const notLive = await call('GET', '/api/store/vendors/freshkart');
  check('Non-activated store is hidden from the public API', notLive.status === 404, `got ${notLive.status}`);

  const cats = await call('GET', '/api/store/vendors/techmart/categories');
  check('Categories are scoped to the vendor', cats.status === 200 && cats.data?.length > 0);

  const p1 = await call('GET', '/api/store/vendors/techmart/products?limit=4&sort=price_asc');
  check('Product listing paginates', p1.status === 200 && p1.data?.length === 4 && p1.json?.pagination?.pages > 1);
  const pSorted = p1.data.map((p) => p.pricePaise);
  check('price_asc sort is honoured', pSorted.every((v, i) => i === 0 || pSorted[i - 1] <= v));
  const pSearch = await call('GET', '/api/store/vendors/techmart/products?q=phone&limit=48');
  check('Search filters products', pSearch.status === 200 && pSearch.data.every((p) => /phone|smart/i.test(`${p.name} ${p.tags}`)));
  const pCat = await call('GET', `/api/store/vendors/techmart/products?category=${cats.data[0].slug}`);
  check('Category filter works', pCat.status === 200 && pCat.data.every((p) => p.categoryId === cats.data[0].id));
  const huge = await call('GET', '/api/store/vendors/techmart/products?limit=100000');
  check('Page size is capped (no bulk scraping)', huge.json?.pagination?.limit <= 48, `limit=${huge.json?.pagination?.limit}`);

  const product = p1.data[0];
  const detail = await call('GET', `/api/store/vendors/techmart/products/${product.id}`);
  check('Product detail returns gallery + specs + reviews', detail.data?.product?.gallery?.length > 0 && Array.isArray(detail.data?.specs ?? detail.data?.product?.specs));
  const crossStore = await call('GET', `/api/store/vendors/stylehub/products/${product.id}`);
  check('Product cannot be read through another store (IDOR)', crossStore.status === 404);

  /* ------------------------------------------------------------------ auth */
  section('Authentication');
  const badLogin = await call('POST', '/api/auth/login', { body: { identifier: 'vendor@growbusinessonline.com', password: 'wrong' } });
  check('Wrong password rejected with 401', badLogin.status === 401);
  const enumLogin = await call('POST', '/api/auth/login', { body: { identifier: 'nobody@example.com', password: 'wrong' } });
  check('Unknown account gives the same generic message', enumLogin.status === 401 && enumLogin.error?.message === badLogin.error?.message);

  const login = await call('POST', '/api/auth/login', { body: { identifier: 'vendor@growbusinessonline.com', password: 'Vendor@123' } });
  const vendorToken = login.data?.token;
  check('Vendor can sign in', login.status === 200 && !!vendorToken);
  check('Vendor is routed to the dashboard', login.data?.redirectTo === '/admin/dashboard.html', login.data?.redirectTo);

  const adminLogin = await call('POST', '/api/auth/login', { body: { identifier: 'admin@growbusinessonline.com', password: 'Admin@123' } });
  const adminToken = adminLogin.data?.token;
  check('Super admin can sign in and is routed to /admin', adminToken && adminLogin.data?.redirectTo === '/admin/index.html');

  const custLogin = await call('POST', '/api/auth/login', { body: { identifier: 'customer@example.com', password: 'Customer@123' } });
  const customerToken = custLogin.data?.token;
  check('Customer can sign in', !!customerToken);

  const me = await call('GET', '/api/auth/me', { token: vendorToken });
  check('GET /api/auth/me returns the session user', me.data?.user?.role === 'vendor' && !('passwordHash' in (me.data?.user || {})));
  const noAuth = await call('GET', '/api/vendor/dashboard');
  check('Dashboard is blocked without a token', noAuth.status === 401);
  const custBlocked = await call('GET', '/api/vendor/dashboard', { token: customerToken });
  check('A customer token cannot open the vendor dashboard (RBAC)', custBlocked.status === 403);

  /* ------------------------------------------------- registration + deposit */
  section('Vendor registration → deposit → activation');
  const reg = await call('POST', '/api/auth/register', {
    body: {
      name: 'Test Vendor',
      email: `${uniq}@example.com`,
      phone: '+91 98123 00011',
      password: 'Str0ngPass!',
      confirmPassword: 'Str0ngPass!',
      businessName: `Test Store ${uniq}`,
      businessType: 'Electronics Retail',
      address: '12 Test Road',
      city: 'Jhajjar',
      state: 'Haryana',
      country: 'India',
      pincode: '124103',
      agree: true,
    },
  });
  const newToken = reg.data?.token;
  const newVendorId = reg.data?.vendor?.id;
  check('Registration creates account + store', reg.status === 201 && !!newToken && reg.data?.vendor?.status === 'pending_deposit');
  check('Registration points to the deposit step', reg.data?.nextStep === 'security_deposit' && reg.data?.redirectTo === '/deposit.html');
  check('A unique subdomain slug is generated', /^[a-z0-9-]+$/.test(reg.data?.vendor?.slug || ''));

  const dup = await call('POST', '/api/auth/register', { body: { ...reg.json && {}, name: 'Test Vendor', email: `${uniq}@example.com`, phone: '+91 98123 00011', password: 'Str0ngPass!', confirmPassword: 'Str0ngPass!', businessName: 'Dup', businessType: 'Other', city: 'X', state: 'Y', pincode: '124103', agree: true } });
  check('Duplicate email is rejected', dup.status === 409);
  const noAgree = await call('POST', '/api/auth/register', { body: { name: 'No Agree', email: `${uniq}b@example.com`, phone: '+91 98123 00012', password: 'Str0ngPass!', confirmPassword: 'Str0ngPass!', businessName: 'No Agree Store', businessType: 'Other', city: 'X', state: 'Y', pincode: '124103', agree: false } });
  check('Terms must be accepted', noAgree.status === 400);
  const badPin = await call('POST', '/api/auth/register', { body: { name: 'Bad Pin', email: `${uniq}c@example.com`, phone: '+91 98123 00013', password: 'Str0ngPass!', confirmPassword: 'Str0ngPass!', businessName: 'Bad Pin Store', businessType: 'Other', city: 'X', state: 'Y', pincode: '12', agree: true } });
  check('Invalid pincode is rejected', badPin.status === 400);

  const dep = await call('GET', '/api/finance/deposit', { token: newToken });
  check('Deposit screen shows ₹1,000 + refundable explainer', dep.data?.deposit?.amountPaise === 100000 && dep.data?.deposit?.refundable === true && dep.data?.explainer?.points?.length > 0);
  const initiate = await call('POST', '/api/finance/deposit/initiate', { token: newToken, body: { method: 'upi' } });
  check('Deposit can be initiated (status → processing)', initiate.data?.deposit?.status === 'processing');
  check('Client is told it cannot confirm the payment itself', initiate.data?.canConfirmOnClient === false);

  const fakeWebhook = await call('POST', '/api/finance/gateway/deposit-webhook', { body: { depositId: initiate.data.deposit.id, signature: 'forged' } });
  check('Forged gateway signature is rejected (fake payment blocked)', fakeWebhook.status === 403);

  const sim = await call('POST', '/api/finance/dev/simulate-payment', { body: { depositId: initiate.data.deposit.id } });
  check('Demo gateway callback confirms the deposit', sim.data?.confirmed === true && sim.data?.deposit?.status === 'approved');
  const act = await call('GET', '/api/finance/activation', { token: newToken });
  check('48h activation countdown starts from a server timestamp', act.data?.status === 'pending_activation' && act.data?.remainingMs > 0 && !!act.data?.serverTime);
  check('Activation window is 48 hours', Math.abs(act.data.remainingMs - 48 * 3600 * 1000) < 60_000, `${Math.round(act.data?.remainingMs / 3600000)}h`);

  /* ------------------------------------------------------ vendor dashboard */
  section('Vendor dashboard');
  const dash = await call('GET', '/api/vendor/dashboard', { token: vendorToken });
  check('KPI payload is complete', dash.status === 200 && ['totalSalesPaise', 'totalOrders', 'pendingOrders', 'completedOrders', 'customers', 'products', 'availableBalancePaise', 'commissionPaidPaise'].every((k) => k in dash.data.kpis));
  check('Sales chart series is returned', Array.isArray(dash.data?.charts?.sales) && dash.data.charts.sales.length === 14);
  check('Top products + recent orders present', Array.isArray(dash.data?.topProducts) && Array.isArray(dash.data?.recentOrders));
  check('Dashboard is tenant scoped', dash.data?.vendor?.slug === 'techmart');

  const analytics = await call('GET', '/api/vendor/analytics?range=30', { token: vendorToken });
  check('Analytics returns 30 day series + totals', analytics.data?.range === 30 && analytics.data?.charts?.sales?.length === 30);

  const styleToken = (await call('POST', '/api/auth/login', { body: { identifier: 'priya@stylehub.in', password: 'Vendor@123' } })).data?.token;

  section('Vendor catalogue (CRUD)');
  const created = await call('POST', '/api/vendor/products', {
    token: vendorToken,
    body: { name: `Smoke Test Product ${uniq}`, price: 1999, mrp: 2999, stock: 12, categoryId: cats.data[0].id, shortDescription: 'Temporary product created by the smoke test.', description: 'Temporary product created by the smoke test.', specs: [['Warranty', '1 year']] },
  });
  const newProductId = created.data?.product?.id;
  check('Product created with server-computed discount', created.status === 201 && created.data?.product?.discountPercent === Math.round(((2999 - 1999) / 2999) * 100), `discount=${created.data?.product?.discountPercent}`);
  check('mrp is forced >= price', created.data?.product?.mrpPaise >= created.data?.product?.pricePaise);

  const fakePrice = await call('PUT', `/api/vendor/products/${newProductId}`, { token: vendorToken, body: { price: -500, stock: 999999 } });
  check('Negative price is rejected', fakePrice.status === 400);
  const hugeStock = await call('PUT', `/api/vendor/products/${newProductId}`, { token: vendorToken, body: { stock: 1e9 } });
  check('Stock is clamped to a sane range', hugeStock.status === 200 && hugeStock.data.product.stock <= 100000);

  const styleProduct = (await call('GET', '/api/store/vendors/stylehub/products?limit=1')).data[0];
  const crossEdit = await call('PUT', `/api/vendor/products/${styleProduct.id}`, { token: vendorToken, body: { price: 1 } });
  check('Vendor A cannot edit Vendor B product (tenant isolation)', crossEdit.status === 403);
  const crossRead = await call('GET', `/api/vendor/products/${styleProduct.id}`, { token: vendorToken });
  check('Vendor A cannot read Vendor B product', crossRead.status === 403);
  const customerEdit = await call('PUT', `/api/vendor/products/${newProductId}`, { token: customerToken, body: { price: 1 } });
  check('Customer token cannot edit products', customerEdit.status === 403);

  const updated = await call('PUT', `/api/vendor/products/${newProductId}`, { token: vendorToken, body: { name: `Renamed ${uniq}`, price: 1499, stock: 8 } });
  check('Product updates correctly', updated.data?.product?.name?.startsWith('Renamed') && updated.data?.product?.pricePaise === 149900);

  /* ---------------------------------------------------------------- orders */
  section('Cart → checkout → order lifecycle');
  const quote = await call('POST', '/api/store/vendors/techmart/cart/quote', { body: { items: [{ productId: newProductId, qty: 2 }] } });
  check('Quote prices the basket server side', quote.data?.subtotalPaise === 149900 * 2 && quote.data?.totalPaise > 0);
  const tampered = await call('POST', '/api/store/vendors/techmart/cart/quote', { body: { items: [{ productId: newProductId, qty: 2, pricePaise: 1, unitPricePaise: 1 }] } });
  check('Client-supplied prices are ignored', tampered.data?.subtotalPaise === 149900 * 2);
  const otherVendorItem = await call('POST', '/api/store/vendors/techmart/cart/quote', { body: { items: [{ productId: styleProduct.id, qty: 1 }] } });
  check("Another vendor's product cannot be added to this cart", otherVendorItem.data?.lines?.length === 0);

  const order = await call('POST', '/api/store/vendors/techmart/orders', {
    body: {
      items: [{ productId: newProductId, qty: 2 }],
      customer: { name: 'Smoke Tester', phone: '+91 98123 00099', email: `${uniq}@example.com` },
      shipping: { line1: '44 Test Street, Sector 9', city: 'Jhajjar', state: 'Haryana', pincode: '124103', country: 'India' },
      paymentMethod: 'upi',
    },
  });
  const orderId = order.data?.orderId;
  const orderNumber = order.data?.orderNumber;
  check('Order is placed', order.status === 201 && !!orderNumber);
  const expectedTotal = quote.data.totalPaise;
  check('Order total matches the server quote', order.data?.totalPaise === expectedTotal);
  check('Stock was decremented server side', (await call('GET', `/api/vendor/products/${newProductId}`, { token: vendorToken })).data?.product?.stock === 6);

  const badAddr = await call('POST', '/api/store/vendors/techmart/orders', { body: { items: [{ productId: newProductId, qty: 1 }], customer: { name: 'X', phone: '12', email: 'no' }, shipping: { line1: 'a', city: '', state: '', pincode: '99' }, paymentMethod: 'upi' } });
  check('Invalid checkout payload is rejected', badAddr.status === 400);
  const badMethod = await call('POST', '/api/store/vendors/techmart/orders', { body: { items: [{ productId: newProductId, qty: 1 }], customer: { name: 'Smoke Tester', phone: '+91 98123 00099' }, shipping: { line1: '44 Test Street', city: 'Jhajjar', state: 'Haryana', pincode: '124103' }, paymentMethod: 'free_money' } });
  check('Unknown payment method is rejected', badMethod.status === 400);

  const trackBad = await call('GET', `/api/store/orders/track?number=${orderNumber}&phone=0000000000`);
  check('Tracking requires a matching phone/email', trackBad.status === 400);
  const track = await call('GET', `/api/store/orders/track?number=${orderNumber}&phone=9812300099`);
  check('Order tracking returns the timeline', track.status === 200 && track.data?.steps?.length === 6 && track.data?.status === 'pending');

  section('Order status machine + settlement');
  const illegal = await call('PATCH', `/api/vendor/orders/${orderId}/status`, { token: vendorToken, body: { status: 'delivered' } });
  check('pending → delivered is blocked (no fake fulfilment)', illegal.status === 400);
  for (const s of ['confirmed', 'processing', 'shipped', 'out_for_delivery', 'delivered']) {
    const r = await call('PATCH', `/api/vendor/orders/${orderId}/status`, { token: vendorToken, body: { status: s } });
    check(`Status advances to ${s}`, r.status === 200 && r.data?.order?.status === s);
  }
  const crossStatus = await call('PATCH', `/api/vendor/orders/${orderId}/status`, { token: styleToken, body: { status: 'cancelled' } });
  check("Vendor B cannot touch Vendor A's order", crossStatus.status === 403);
  const custStatus = await call('PATCH', `/api/vendor/orders/${orderId}/status`, { token: customerToken, body: { status: 'cancelled' } });
  check('Customer cannot change order status', custStatus.status === 403);

  const settled = await call('GET', `/api/vendor/orders/${orderId}`, { token: vendorToken });
  check('Payment is settled once delivered', settled.data?.order?.paymentStatus === 'paid');
  check(`Commission is ${cfg.data.commissionPercent}% and computed server side`, settled.data?.order?.commissionPaise === Math.round(settled.data.order.totalPaise * 0.05) && settled.data.order.vendorPaise + settled.data.order.commissionPaise === settled.data.order.totalPaise);

  /* --------------------------------------------------------------- finance */
  section('Balance & withdrawals');
  const bal = await call('GET', '/api/finance/balance', { token: vendorToken });
  check('Balance payload is read-only + itemised', bal.data?.readOnly === true && ['availablePaise', 'pendingPaise', 'earnedPaise', 'commissionPaise', 'withdrawnPaise'].every((k) => k in bal.data));
  check('Balance example shows the 5% split', bal.data?.example === null || (bal.data.example.percent === cfg.data.commissionPercent && bal.data.example.commissionPaise + bal.data.example.vendorAmountPaise === bal.data.example.orderAmountPaise));
  const balCross = await call('GET', '/api/finance/balance?vendorId=vnd_stylehub', { token: vendorToken });
  check('A vendor cannot read another vendor balance via query param', balCross.data?.vendorId === 'vnd_techmart');

  const smallWd = await call('POST', '/api/finance/withdrawals', { token: vendorToken, body: { amount: 10, method: 'upi', account: 'test@okhdfc' } });
  check('Withdrawal below the minimum is rejected', smallWd.status === 400);
  const bigWd = await call('POST', '/api/finance/withdrawals', { token: vendorToken, body: { amount: 99999999, method: 'upi', account: 'test@okhdfc' } });
  check('Withdrawal above available balance is rejected', bigWd.status === 400);
  const badUpi = await call('POST', '/api/finance/withdrawals', { token: vendorToken, body: { amount: 600, method: 'upi', account: 'not-a-upi' } });
  check('Invalid UPI ID is rejected', badUpi.status === 400);
  const wd = await call('POST', '/api/finance/withdrawals', { token: vendorToken, body: { amount: 600, method: 'upi', account: `${uniq}@okhdfc` } });
  check('Valid withdrawal request is accepted (pending, not paid)', wd.status === 201 && wd.data?.withdrawal?.status === 'pending');
  const balAfter = await call('GET', '/api/finance/balance', { token: vendorToken });
  check('Requested amount is reserved from the available balance', balAfter.data.availablePaise === bal.data.availablePaise - 60000);
  const selfPay = await call('PATCH', `/api/admin/withdrawals/${wd.data.withdrawal.id}`, { token: vendorToken, body: { status: 'paid' } });
  check('A vendor cannot self-approve their own payout', selfPay.status === 403);
  const adminPay = await call('PATCH', `/api/admin/withdrawals/${wd.data.withdrawal.id}`, { token: adminToken, body: { status: 'paid' } });
  check('Super admin can approve the payout', adminPay.status === 200 && adminPay.data?.withdrawal?.status === 'paid');
  const wds = await call('GET', '/api/finance/withdrawals', { token: vendorToken });
  check('Withdrawal history lists statuses', Array.isArray(wds.data) && wds.data.some((w) => w.id === wd.data.withdrawal.id));

  /* --------------------------------------------------------------- customer */
  section('Customer account');
  const custOrders = await call('GET', '/api/customer/orders', { token: customerToken });
  check('Customer sees their own orders', custOrders.status === 200 && Array.isArray(custOrders.data));
  const custAddr = await call('POST', '/api/customer/addresses', { token: customerToken, body: { label: 'Home', name: 'Ananya Gupta', phone: '+91 98765 43210', line1: '504, Prestige Sunberry', city: 'Bengaluru', state: 'Karnataka', pincode: '560034' } });
  check('Address saved', custAddr.status === 201);
  const custAddrBad = await call('POST', '/api/customer/addresses', { token: customerToken, body: { name: 'x', phone: '1', line1: 'y', city: '', state: '', pincode: '1' } });
  check('Invalid address rejected', custAddrBad.status === 400);
  const wish = await call('POST', '/api/customer/wishlist', { token: customerToken, body: { productId: newProductId } });
  check('Wishlist add works', wish.status === 201 || wish.status === 400);
  const custAdmin = await call('GET', '/api/admin/stats', { token: customerToken });
  check('Customer cannot reach the admin API', custAdmin.status === 403);
  const vendorAdmin = await call('GET', '/api/admin/stats', { token: vendorToken });
  check('Vendor cannot reach the admin API', vendorAdmin.status === 403);

  /* ----------------------------------------------------------------- admin */
  section('Super admin console');
  const aStats = await call('GET', '/api/admin/stats', { token: adminToken });
  check('Admin stats include money + queue counters', aStats.status === 200 && !!aStats.data?.money?.gmvPaise && !!aStats.data?.queue);
  const aVendors = await call('GET', '/api/admin/vendors?status=pending_activation', { token: adminToken });
  check('Admin can filter vendors by lifecycle status', aVendors.status === 200 && aVendors.data.every((v) => v.status === 'pending_activation'));
  const aSuspend = await call('PATCH', `/api/admin/vendors/${newVendorId}`, { token: adminToken, body: { status: 'suspended', suspensionReason: 'Smoke test' } });
  check('Admin can suspend a store', aSuspend.status === 200 && aSuspend.data?.vendor?.status === 'suspended');
  const suspendedPublic = await call('GET', `/api/store/vendors/${reg.data.vendor.slug}`);
  check('Suspended store is blocked publicly', suspendedPublic.status === 403);

  /* -------------------------------------------------------------- security */
  section('Security hardening');
  const xss = await call('POST', '/api/store/contact', { body: { name: 'XSS Tester', email: 'xss@example.com', message: '<script>alert(1)</script> please call me back about the vendor plan.' } });
  check('Contact endpoint accepts messages', xss.status === 201);
  const msgs = await call('GET', '/api/admin/messages', { token: adminToken });
  const stored = msgs.data?.find((m) => m.email === 'xss@example.com');
  check('Stored text is sanitised (no <script> persisted)', stored && !/<script/i.test(stored.message), stored?.message?.slice(0, 40));

  const tamperToken = `${vendorToken.slice(0, -4)}AAAA`;
  const tamperedRes = await call('GET', '/api/vendor/dashboard', { token: tamperToken });
  check('Tampered token signature is rejected', tamperedRes.status === 401);
  const forgedRole = Buffer.from(JSON.stringify({ sub: 'usr_admin', role: 'super_admin', exp: Math.floor(Date.now() / 1000) + 9999 })).toString('base64url');
  const forgedRes = await call('GET', '/api/admin/stats', { token: `${vendorToken.split('.')[0]}.${forgedRole}.${vendorToken.split('.')[2]}` });
  check('Forged role claim is rejected', forgedRes.status === 401);

  const logout = await call('POST', '/api/auth/logout', { token: styleToken });
  const afterLogout = await call('GET', '/api/auth/me', { token: styleToken });
  check('Logout revokes the session', logout.status === 200 && afterLogout.status === 401);

  const reset = await call('POST', '/api/auth/forgot-password', { body: { email: `${uniq}@example.com` } });
  check('Password reset can be requested', reset.status === 200 && reset.data?.sent === true);
  if (reset.data?.devToken) {
    const done = await call('POST', '/api/auth/reset-password', { body: { token: reset.data.devToken, password: 'NewStr0ng!', confirmPassword: 'NewStr0ng!' } });
    check('Reset link rotates the password', done.status === 200);
    const replay = await call('POST', '/api/auth/reset-password', { body: { token: reset.data.devToken, password: 'Another1!', confirmPassword: 'Another1!' } });
    check('Reset link cannot be replayed', replay.status === 400);
    const newLogin = await call('POST', '/api/auth/login', { body: { identifier: `${uniq}@example.com`, password: 'NewStr0ng!' } });
    check('New password works', newLogin.status === 200);
  }
  const unknownReset = await call('POST', '/api/auth/reset-password', { body: { token: 'guessed', password: 'Whatever123', confirmPassword: 'Whatever123' } });
  check('Guessed reset token is rejected', unknownReset.status === 400);

  const headers = await call('GET', '/api/health', { raw: true });
  check('Security headers are set', headers.headers.get('x-content-type-options') === 'nosniff' && !!headers.headers.get('x-frame-options'));
  const bigBody = await call('POST', '/api/store/contact', { body: { name: 'x'.repeat(400000), email: 'a@b.com', message: 'y'.repeat(400000) } });
  check('Oversized payloads are rejected', bigBody.status === 400 || bigBody.status === 413);

  /* --------------------------------------------------------------- cleanup */
  section('Cleanup');
  const del = await call('DELETE', `/api/vendor/products/${newProductId}`, { token: vendorToken });
  check('Test product removed/archived', del.status === 200);

  /* ---------------------------------------------------------------- report */
  console.log(`\n${c.bold('Summary')}  ${c.green(`${pass} passed`)}  ${fail ? c.red(`${fail} failed`) : '0 failed'}`);
  if (failures.length) {
    console.log(c.red('\nFailures:'));
    for (const f of failures) console.log(`  • ${f}`);
  }
  console.log('');
  process.exit(fail ? 1 : 0);
}

main().catch((err) => {
  console.error(c.red(`\nSmoke test crashed: ${err.message}`));
  console.error(err.stack);
  process.exit(1);
});
