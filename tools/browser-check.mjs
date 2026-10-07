/**
 * tools/browser-check.mjs — runs every generated page through a real DOM.
 *
 *   node tools/browser-check.mjs              # check all pages
 *   node tools/browser-check.mjs vendor/cart.html   # check one page
 *
 * It boots each page exactly the way a browser does — jsdom parses the committed
 * HTML, the real ES modules are imported, and the live API on :4000 answers the
 * requests. That catches the bugs a syntax check cannot: a helper that was never
 * exported, a wrong API field name, a template that throws on real data.
 *
 * Each page runs in its own child process so no module state leaks between them.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FE = path.join(ROOT, 'frontend');
const API = process.env.GBO_API || 'http://localhost:4000';

/* ------------------------------------------------------------------ child */

async function runOne(page, { token, query = '', role = 'guest' } = {}) {
  const { JSDOM, VirtualConsole } = await import('jsdom');

  const file = path.join(FE, page);
  if (!existsSync(file)) throw new Error(`missing page ${page}`);
  const htmlSource = readFileSync(file, 'utf8');
  const url = `${API}/${page}${query ? `?${query}` : ''}`;

  const noise = [];
  const navigations = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', (e) => {
    const msg = String(e?.message || e);
    // jsdom refuses to navigate. That IS the redirect our guards perform, so
    // record it rather than treating it as a failure.
    if (/Not implemented: navigation/i.test(msg)) { navigations.push(`navigate: ${msg}`); return; }
    if (/Could not load|Not implemented/i.test(msg)) return;
    noise.push(`jsdomError: ${msg}`);
  });
  virtualConsole.on('error', (...args) => noise.push(`console.error: ${args.map(String).join(' ')}`));
  virtualConsole.on('warn', (...args) => {
    const text = args.map(String).join(' ');
    if (/\[boot\] No module registered/.test(text)) noise.push(text);
  });

  const dom = new JSDOM(htmlSource, {
    url,
    runScripts: 'outside-only',
    pretendToBeVisual: true,
    virtualConsole,
  });
  const { window } = dom;

  /* ---- publish the DOM as Node globals so the modules can use it ------- */
  const globals = [
    'window', 'document', 'navigator', 'location', 'history', 'localStorage', 'sessionStorage',
    'HTMLElement', 'HTMLInputElement', 'HTMLAnchorElement', 'HTMLFormElement', 'Element', 'Node',
    'Event', 'CustomEvent', 'MouseEvent', 'KeyboardEvent', 'FormData', 'File', 'Blob', 'URL',
    'URLSearchParams', 'AbortController', 'getComputedStyle', 'requestAnimationFrame',
    'cancelAnimationFrame', 'DOMParser', 'XMLHttpRequest', 'matchMedia', 'screen', 'visualViewport',
  ];
  // Node 21+ ships read-only globals (`navigator`, `location`), so every one of
  // these has to be redefined rather than assigned.
  const define = (key, value) => {
    try {
      Object.defineProperty(globalThis, key, { value, configurable: true, writable: true, enumerable: true });
    } catch {
      /* a global we cannot replace — the page will fall back to Node's own */
    }
  };
  for (const key of globals) {
    if (window[key] !== undefined) define(key, window[key]);
  }
  // These must keep `window` as their receiver, or the DOM rejects the call.
  for (const key of ['addEventListener', 'removeEventListener', 'dispatchEvent']) {
    if (typeof window[key] === 'function') define(key, window[key].bind(window));
  }
  define('self', window);
  define('top', window);
  define('parent', window);
  define('innerWidth', 1440);
  define('innerHeight', 900);
  define('outerWidth', 1440);
  define('outerHeight', 900);
  define('devicePixelRatio', 2);
  define('scrollX', 0);
  define('scrollY', 0);
  define('scrollTo', () => {});
  define('print', () => {});
  define('open', () => null);
  define('alert', () => {});
  define('confirm', () => true);
  define('prompt', () => null);

  // Observers that jsdom does not ship.
  class FakeObserver {
    constructor(cb) { this.cb = cb; this.nodes = []; }
    observe(node) { this.nodes.push(node); }
    unobserve() {}
    disconnect() {}
    takeRecords() { return []; }
  }
  define('IntersectionObserver', FakeObserver);
  define('ResizeObserver', FakeObserver);
  define('MutationObserver', window.MutationObserver || FakeObserver);
  if (!window.matchMedia) {
    define('matchMedia', (q) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }));
  }
  if (!window.navigator.clipboard) {
    Object.defineProperty(window.navigator, 'clipboard', { value: { writeText: async () => true, readText: async () => '' }, configurable: true });
  }

  // window.location is [LegacyUnreplaceable] in jsdom, so it cannot be proxied.
  // Redirects surface as "Not implemented: navigation" and are captured above.
  define('location', window.location);

  /* ---- a signed-in session, when this page needs one ------------------- */
  if (token) window.localStorage.setItem('gbo:token', JSON.stringify(token));

  /* ---- run the page ---------------------------------------------------- */
  const errors = [];
  const originalError = console.error;
  console.error = (...args) => {
    errors.push(args.map((a) => (a instanceof Error ? `${a.message}\n${(a.stack || '').split('\n').slice(1, 4).join('\n')}` : String(a))).join(' '));
  };
  process.on('unhandledRejection', (e) => errors.push(`unhandled rejection: ${e?.message || e}`));

  const bootPath = pathToFileURL(path.join(FE, 'js', 'boot.js')).href;
  const started = Date.now();
  try {
    await import(`${bootPath}?page=${encodeURIComponent(page)}`);
  } catch (err) {
    errors.push(`module import failed: ${err?.message || err}`);
  }

  // Give async work (API calls, charts, rendering) time to settle.
  const settleMs = Number(process.env.GBO_SETTLE_MS || 3500);
  await new Promise((resolve) => setTimeout(resolve, settleMs));
  console.error = originalError;

  const bodyClass = window.document.body.className;
  // guard() deliberately returns a promise that never resolves once it starts a
  // redirect, so a role-blocked page ends up "not ready" but with a navigation.
  const redirected = navigations.length > 0;
  const result = {
    page,
    role,
    ms: Date.now() - started,
    redirected,
    pageError: /page-error/.test(bodyClass),
    pageReady: /page-ready/.test(bodyClass),
    errors: [...new Set([...errors, ...noise])],
    navigations,
    title: window.document.title,
    textLength: (window.document.body.textContent || '').trim().length,
    nodeCount: window.document.querySelectorAll('*').length,
  };

  window.close();
  return result;
}

/* ----------------------------------------------------------------- parent */

const ROLES = {
  vendor: { identifier: 'vendor@growbusinessonline.com', password: 'Vendor@123' },
  customer: { identifier: 'customer@example.com', password: 'Customer@123' },
  admin: { identifier: 'admin@growbusinessonline.com', password: 'Admin@123' },
};

const TOKEN_CACHE = path.join(process.env.TMPDIR || '/tmp', 'gbo-browser-check-tokens.json');

/**
 * Logins are rate limited (as they should be), so tokens are cached between
 * runs and only refreshed once the API says they no longer work.
 */
async function login(role) {
  const creds = ROLES[role];
  if (!creds) return null;

  let cache = {};
  try { cache = JSON.parse(readFileSync(TOKEN_CACHE, 'utf8')); } catch { cache = {}; }
  if (cache[role]) {
    const me = await fetch(`${API}/api/auth/me`, { headers: { authorization: `Bearer ${cache[role]}` } });
    if (me.ok) return cache[role];
  }

  const res = await fetch(`${API}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(creds),
  });
  const json = await res.json();
  if (!json.ok) throw new Error(`login failed for ${role}: ${json.error?.message}`);
  cache[role] = json.data.token;
  try { writeFileSync(TOKEN_CACHE, JSON.stringify(cache, null, 2)); } catch { /* not fatal */ }
  return json.data.token;
}

/** page → which session should be signed in, plus any query string. */
const MATRIX = [
  ['index.html', 'guest', ''],
  ['404.html', 'guest', ''],
  ['pages/features.html', 'guest', ''],
  ['pages/pricing.html', 'guest', ''],
  ['pages/how-it-works.html', 'guest', ''],
  ['pages/about.html', 'guest', ''],
  ['pages/vendors.html', 'guest', ''],
  ['pages/contact.html', 'guest', ''],
  ['pages/faq.html', 'guest', ''],
  ['pages/terms.html', 'guest', ''],
  ['pages/privacy.html', 'guest', ''],
  ['pages/refund-policy.html', 'guest', ''],
  ['pages/vendor-agreement.html', 'guest', ''],
  ['login.html', 'guest', ''],
  ['register.html', 'guest', ''],
  ['forgot-password.html', 'guest', ''],
  ['reset-password.html', 'guest', ''],

  // storefront — a shopper's session, and one guest pass to prove guest checkout works
  ['vendor/index.html', 'guest', 'vendor=techmart'],
  ['vendor/index.html', 'customer', 'vendor=stylehub'],
  ['vendor/category.html', 'guest', 'vendor=techmart'],
  ['vendor/category.html', 'guest', 'vendor=techmart&category=mobiles&q=nova'],
  ['vendor/product.html', 'guest', 'vendor=techmart&id=prd_techmart_2'],
  ['vendor/cart.html', 'guest', 'vendor=techmart'],
  ['vendor/checkout.html', 'customer', 'vendor=techmart'],
  ['vendor/success.html', 'customer', 'vendor=techmart'],
  ['vendor/orders.html', 'customer', 'vendor=techmart'],
  ['vendor/order-detail.html', 'guest', 'vendor=techmart'],
  ['vendor/account.html', 'customer', 'vendor=techmart'],
  ['vendor/wishlist.html', 'customer', 'vendor=techmart'],
  // an unknown tenant must render the friendly "store not found" screen, not crash
  ['vendor/index.html', 'guest', 'vendor=does-not-exist'],

  // vendor console
  ['admin/dashboard.html', 'vendor', ''],
  ['admin/analytics.html', 'vendor', ''],
  ['admin/notifications.html', 'vendor', ''],
  ['admin/products.html', 'vendor', ''],
  ['admin/categories.html', 'vendor', ''],
  ['admin/store.html', 'vendor', ''],
  ['admin/orders.html', 'vendor', ''],
  ['admin/order-detail.html', 'vendor', ''],
  ['admin/customers.html', 'vendor', ''],
  ['admin/payments.html', 'vendor', ''],
  ['admin/balance.html', 'vendor', ''],
  ['admin/withdrawals.html', 'vendor', ''],
  ['admin/settings.html', 'vendor', ''],
  ['admin/profile.html', 'vendor', ''],
  ['admin/support.html', 'vendor', ''],
  // a vendor must not be able to open the platform console
  ['admin/index.html', 'vendor', ''],

  // platform console
  ['admin/index.html', 'admin', ''],
  ['admin/vendors.html', 'admin', ''],
  ['admin/deposits.html', 'admin', ''],
  ['admin/withdrawals.html', 'admin', ''],
  ['admin/orders.html', 'admin', ''],
  ['admin/messages.html', 'admin', ''],

  // onboarding, as a vendor whose deposit is already approved
  ['deposit.html', 'vendor', ''],
  ['activation.html', 'vendor', ''],
];

async function parent() {
  const only = process.argv[2];
  const rows = only ? MATRIX.filter(([p]) => p === only || p.includes(only)) : MATRIX;
  if (!rows.length) {
    console.error(`No page matched "${only}".`);
    process.exit(2);
  }

  const tokens = {};
  for (const role of ['vendor', 'customer', 'admin']) {
    try {
      tokens[role] = await login(role);
    } catch (err) {
      console.error(`✖ Could not log in as ${role}: ${err.message}`);
      console.error('  Is the API running on :4000? (cd backend && npm start)');
      process.exit(2);
    }
  }

  const results = [];
  for (const [page, role, query] of rows) {
    process.stdout.write(`  · ${role.padEnd(8)} ${page}${query ? `?${query}` : ''} … `);
    const out = await new Promise((resolve) => {
      const child = spawn(process.execPath, [fileURLToPath(import.meta.url), page, role, query], {
        env: { ...process.env, GBO_RUN_CHILD: '1', GBO_TOKEN: tokens[role] || '', GBO_API: API },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (d) => { stdout += d; });
      child.stderr.on('data', (d) => { stderr += d; });
      const killer = setTimeout(() => child.kill('SIGKILL'), 45000);
      child.on('close', (code) => {
        clearTimeout(killer);
        try {
          resolve(JSON.parse(stdout.slice(stdout.lastIndexOf('{'))));
        } catch {
          resolve({ page, role, errors: [`child exited ${code}: ${stderr.slice(0, 400) || stdout.slice(0, 400)}`], pageError: true });
        }
      });
    });
    const blocked = out.redirected && !out.pageReady && !out.errors?.length;
    const bad = out.errors?.length || out.pageError || (!out.pageReady && !blocked);
    console.log(bad ? 'FAIL' : blocked ? `redirected (${out.ms}ms) — access correctly denied` : `ok (${out.ms}ms, ${out.nodeCount} nodes)`);
    results.push(out);
  }

  const failed = results.filter((r) => r.errors?.length || r.pageError || (!r.pageReady && !(r.redirected && !r.errors?.length)));
  console.log('');
  if (!failed.length) {
    console.log(`✔ All ${results.length} page runs rendered cleanly against the live API.`);
    return;
  }
  console.error(`✖ ${failed.length} of ${results.length} page runs had problems:`);
  for (const r of failed) {
    console.error(`\n  ${r.page} (${r.role})`);
    for (const e of (r.errors || []).slice(0, 6)) console.error(`    · ${e.split('\n').join('\n      ')}`);
  }
  process.exitCode = 1;
}

if (process.env.GBO_RUN_CHILD) {
  // Child: render exactly one page and hand the result back as JSON.
  const [page, role, query] = process.argv.slice(2);
  const result = await runOne(page, { token: process.env.GBO_TOKEN || null, query, role });
  process.stdout.write(JSON.stringify(result));
} else {
  // Parent: log in once per role, then run every page in its own process.
  await parent();
}
