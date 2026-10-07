/**
 * GrowBusiness Online — custom backend for the MAIN PLATFORM.
 *
 *   • REST API under /api  (auth, storefront, vendor dashboard, finance, admin)
 *   • Serves the compiled static frontend from ../frontend in dev / single-host mode
 *   • Resolves vendor subdomains (vendor1.growbusinessonline.com → /vendor/index.html)
 *
 * The frontend can also be uploaded to Hostinger hPanel on its own; point
 * frontend/js/config.js at this API and everything keeps working (see docs/DEPLOYMENT.md).
 */
const path = require('path');
const fs = require('fs');
const express = require('express');
const cors = require('cors');

const config = require('./src/config');
const db = require('./src/db');
const { seed } = require('./src/seed');
const { attachUser, securityHeaders, notFoundHandler, errorHandler } = require('./src/middleware/auth');

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', true);

/* --------------------------------------------------------------------- cors */

const allowed = new Set(config.corsOrigins);
app.use(
  cors({
    origin(origin, cb) {
      if (!origin) return cb(null, true); // curl / same-origin / mobile
      if (allowed.has(origin)) return cb(null, true);
      // Any subdomain of the root domain is trusted (vendor storefronts).
      const host = origin.replace(/^https?:\/\//, '').split('/')[0].split(':')[0];
      if (host === config.rootDomain || host.endsWith(`.${config.rootDomain}`)) return cb(null, true);
      if (!config.isProd) return cb(null, true);
      cb(new Error(`Origin ${origin} is not allowed by CORS.`));
    },
    credentials: true,
    exposedHeaders: ['X-Vendor-Slug', 'Retry-After'],
  })
);

app.use(express.json({ limit: '256kb' }));
app.use(express.urlencoded({ extended: true, limit: '256kb' }));
app.use(securityHeaders);
app.use(attachUser);

/* --------------------------------------------------------------------- api */

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    data: {
      service: 'growbusiness-online-api',
      version: '1.0.0',
      env: config.env,
      serverTime: db.nowIso(),
      rootDomain: config.rootDomain,
      counts: {
        vendors: db.col('vendors').length,
        products: db.col('products').length,
        orders: db.col('orders').length,
        users: db.col('users').length,
      },
    },
  });
});

app.use('/api/auth', require('./src/routes/auth'));
app.use('/api/store', require('./src/routes/store'));
app.use('/api/vendor', require('./src/routes/vendor'));
app.use('/api/finance', require('./src/routes/finance'));
app.use('/api/customer', require('./src/routes/customer'));
app.use('/api/admin', require('./src/routes/admin'));

app.use('/api', notFoundHandler);

/* ----------------------------------------------------------------- frontend */

if (config.serveFrontend) {
  const frontendDir = config.paths.frontend;

  /**
   * Subdomain router (spec §40, §45).
   *   techmart.growbusinessonline.com/            → storefront for "techmart"
   *   admin.growbusinessonline.com/dashboard.html → vendor dashboard
   *   growbusinessonline.com/                     → marketing site
   * In local dev you can use techmart.localhost:4000 or ?vendor=techmart.
   */
  app.use((req, res, next) => {
    const host = String(req.headers.host || '').split(':')[0].toLowerCase();
    const labels = host.split('.');
    let sub = null;
    const knownRoots = [config.rootDomain, 'localhost', '127.0.0.1'];
    if (labels.length > 1) {
      const parent = labels.slice(1).join('.');
      if (knownRoots.includes(parent)) sub = labels[0];
    }
    // e2b / ngrok style preview hosts have no vendor subdomain — fall back to query param.
    if (!sub && req.query.vendor) sub = String(req.query.vendor).toLowerCase();

    if (sub && !['www', 'app', 'api'].includes(sub)) {
      const vendor = db.find('vendors', (v) => v.slug === sub);
      if (vendor) {
        res.set('X-Vendor-Slug', vendor.slug);
        req.vendorSlug = vendor.slug;
        if (sub === 'admin') return next();
        if (req.path === '/' || req.path === '/index.html') {
          req.url = '/vendor/index.html';
        }
      }
    }
    next();
  });

  app.use(
    express.static(frontendDir, {
      extensions: ['html'],
      index: ['index.html'],
      maxAge: config.isProd ? '7d' : 0,
      setHeaders(res, filePath) {
        if (/\.(html)$/i.test(filePath)) res.set('Cache-Control', 'no-cache');
        if (/\.(svg|png|jpg|jpeg|webp|avif|ico)$/i.test(filePath)) res.set('Cache-Control', 'public, max-age=31536000, immutable');
      },
    })
  );

  // Pretty 404 for the static site.
  app.use((req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return res.status(405).json({ ok: false, error: { code: 'method_not_allowed', message: 'Method not allowed.' } });
    const notFoundPage = path.join(frontendDir, '404.html');
    if (fs.existsSync(notFoundPage)) return res.status(404).sendFile(notFoundPage);
    res.status(404).type('html').send('<h1>404 — page not found</h1><p><a href="/">Back to GrowBusiness Online</a></p>');
  });
}

app.use(errorHandler);

/* ------------------------------------------------------------------- boot */

db.load();
seed();

if (require.main === module) {
  const server = app.listen(config.port, '0.0.0.0', () => {
    const url = `http://localhost:${config.port}`;
    console.log('');
    console.log('  GrowBusiness Online API');
    console.log(`  ├─ env         ${config.env}`);
    console.log(`  ├─ api         ${url}/api/health`);
    if (config.serveFrontend) {
      console.log(`  ├─ website     ${url}/`);
      console.log(`  ├─ storefront  ${url}/vendor/index.html?vendor=techmart`);
      console.log(`  └─ dashboard   ${url}/admin/dashboard.html`);
    } else {
      console.log(`  └─ frontend    served separately (Hostinger hPanel)`);
    }
    console.log('');
  });

  const shutdown = (signal) => {
    console.log(`\n[api] ${signal} received — flushing database and closing.`);
    db.persist(true);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000).unref();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

module.exports = app;
