# Hostinger deployment guide

This project serves its frontend from **Hostinger hPanel** and uses a custom Node.js API for the main platform. Do not deploy the frontend to Firebase Hosting. This guide describes the intended layout and the checks needed for a safe staging deployment; it does not replace a production database, payment-provider integration, or operational review.

## 1. Choose the host layout

Recommended layout:

| Hostname | Destination |
| --- | --- |
| `growbusinessonline.com` and `www.growbusinessonline.com` | Hostinger hPanel static site document root (`public_html`) |
| `*.growbusinessonline.com` | The **same** static document root for every vendor storefront |
| `api.growbusinessonline.com` | Node.js backend application on a Hostinger Node.js-capable plan or Hostinger VPS |

A basic shared web-hosting plan may serve the static files but may not support a persistent Express process. Confirm Node.js application support for the selected plan; otherwise use a Hostinger VPS for the API. Keep the API on a stable HTTPS URL and make sure its data directory is persistent and writable.

There is one frontend, not one copy per store. The shared storefront code reads the vendor slug from the hostname and fetches the vendor's storefront configuration and catalogue from the API.

## 2. DNS, wildcard subdomain, and TLS

In the domain's DNS zone, point the apex and `www` records to the values provided by Hostinger. Add a wildcard DNS record (`*`) to the frontend web host, then configure the wildcard subdomain in hPanel to use the **same document root** as the main site. If the API is separate, point `api` to the backend host according to that provider's instructions.

Issue and verify TLS certificates for the apex, `www`, the API host, and `*.growbusinessonline.com`. Do not rely on an HTTP-only wildcard; customer login, checkout, and vendor dashboards must use HTTPS. DNS and SSL control panels differ by plan, so use the exact target and certificate workflow shown in the Hostinger account.

## 3. Deploy the static frontend to hPanel

1. From the repository, upload the **contents** of `frontend/` to the hPanel document root (usually `public_html`), rather than nesting the site under a `frontend/` folder.
2. Preserve the directory structure: `assets/`, `css/`, `js/`, `pages/`, `vendor/`, and `admin/`. Upload the generated root HTML files and `robots.txt` / `sitemap.xml` too.
3. Upload the hidden `frontend/.htaccess` file. In File Manager, enable display of hidden files if needed. It supplies the static 404, security headers, caching/compression rules, and pretty marketing URLs such as `/about`. Its HTTPS redirect is intentionally commented out; after TLS is issued and verified, enable the two HTTPS rewrite lines there (or configure the equivalent redirect in hPanel).
4. The static pages are already generated and committed. If you changed templates locally, run `node tools/generate.mjs` from the repo root before uploading. The web server does not need Node to serve the frontend.
5. Edit `frontend/js/config.js` before upload:
   - set `rootDomain` to the production root domain;
   - set `OVERRIDES.apiBase` to the public API base URL, e.g. `https://api.growbusinessonline.com/api`;
   - set `features.demoMode` to `false`.

The config file is public browser code. Only public values belong there; no API signing key, payment secret, database credentials, or Firebase service-account key may be added. If the API is reverse-proxied under the same origin as the site, the default `apiBase: '/api'` can be used instead of a separate API hostname.

## 4. Deploy the Node.js API

Use a Node.js 18+ runtime and install from `backend/`:

```bash
cd backend
npm ci --omit=dev
npm start
```

Configure the hosting panel to keep the process running and route HTTPS requests for `api.growbusinessonline.com` to the app. The server listens on the configured `PORT` and binds to `0.0.0.0`. Do not expose a development port directly to browsers; the frontend should call the public HTTPS API URL configured in `config.js`.

Set environment variables in the hosting panel's secret/environment settings (do not upload a real `.env` file or commit it):

```dotenv
NODE_ENV=production
PORT=<port supplied by the hosting platform>
ROOT_DOMAIN=growbusinessonline.com
CORS_ORIGINS=https://growbusinessonline.com,https://www.growbusinessonline.com
APP_SECRET=<unique long random value>
GATEWAY_WEBHOOK_SECRET=<unique gateway shared secret>
SERVE_FRONTEND=false
DEV_TOOLS=false
DEV_FAST_ACTIVATION=false
PLATFORM_COMMISSION_PERCENT=5
SECURITY_DEPOSIT_PAISE=100000
ACTIVATION_HOURS=48
DEFAULT_DELIVERY_FEE_PAISE=4900
FREE_DELIVERY_ABOVE_PAISE=99900
```

Generate a high-entropy application secret on a trusted machine, for example:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

Use a separate random value for the gateway secret. Store both in the hosting provider's protected environment configuration. The backend explicitly trusts the configured root domain and **all** its subdomains for CORS (in addition to origins listed in `CORS_ORIGINS`). Keep control of the root domain and wildcard DNS/subdomains; only add other origins when required. Never use the example `change-me` values in production.

After deployment, check `https://api.growbusinessonline.com/api/health`, then test registration, login, vendor data isolation, checkout quoting, and role-protected dashboard routes from the HTTPS frontend.

## 5. Multi-vendor routing

Every vendor hostname must resolve to the same frontend document root. For example, `techmart.growbusinessonline.com` and `stylehub.growbusinessonline.com` both serve the same static `vendor/` pages; the browser detects the hostname and requests that vendor slug from the API. Do not create a separate upload or code fork for each vendor.

`?vendor=techmart` is a local/testing override and should not be used as the production tenant-routing mechanism. Reserve platform labels such as `www`, `api`, and `admin`; they are not vendor storefront slugs.

## 6. Pre-launch requirements and current limitations

Treat the current backend as a demo/staging foundation until all of the following are addressed:

- **Persistence:** the included document store writes `backend/data/db.json`. It is appropriate for a local, single-process demo only. Use a production-grade database with durable storage, migrations, access controls, backups, and tested recovery before handling live commerce. Keep runtime data out of Git and never overwrite it during deploy.
- **Demo records:** local development seeds public example accounts. Remove or replace every demo account and confirm the public login UI does not show demo credentials. Do not expose a fresh demo database on the public internet.
- **First production administrator:** provision the first administrator through a controlled, one-time process; do not make the published demo admin account available to the public.
- **Payments:** deposit initiation currently explains that a real provider redirect is not yet wired. The webhook route expects a signature in `x-gateway-signature` (or the request body) derived from the deposit ID using the server-held `GATEWAY_WEBHOOK_SECRET`; integrate and validate the chosen provider's actual signature and event/replay rules before accepting payments. The `/api/finance/dev/simulate-payment` route is demo-only and must remain disabled in production. Do not use it to record a real payment.
- **Email:** password reset and verification routes are present, but no email delivery service is configured. Connect and test a transactional email provider before relying on those flows.
- **Operations and compliance:** review privacy, vendor agreement, refunds, taxes, consumer obligations, log retention, monitoring, abuse controls, and incident response with the appropriate technical and legal reviewers.

## 7. Post-deploy checklist

- [ ] Apex, `www`, wildcard vendor subdomains, and API host resolve to the intended destinations.
- [ ] HTTPS works on the apex, API, and a sample vendor subdomain; HTTP redirects to HTTPS.
- [ ] `https://growbusinessonline.com/`, `/about`, `/login`, and a vendor storefront render without missing assets.
- [ ] `https://api.growbusinessonline.com/api/health` returns a healthy response.
- [ ] The browser uses the configured HTTPS API URL (no `localhost` URL in deployed requests).
- [ ] A vendor hostname displays only that vendor's name, branding, categories, and products.
- [ ] Guest/customer/vendor/admin role checks and cross-vendor access tests pass.
- [ ] Production mode, demo UI off, simulation endpoint off, secrets rotated, and persistent database backups verified.
- [ ] Payment and email provider integrations have been tested end-to-end before real transactions are accepted.
