# GrowBusiness Online

A multi-vendor commerce platform starter with a responsive marketing site, vendor storefronts, customer account pages, vendor dashboards, a platform-admin console, and a custom REST API.

The intended deployment is **static frontend on Hostinger hPanel** plus the custom Node.js backend. Vendor subdomains all use the same frontend; the page detects the store slug from the hostname and loads that vendor's data from the API. **Firebase Hosting is not used.** Firebase web configuration is reserved for separate companion apps and is disabled by default.

> **Deployment status:** This repository is a working demo/staging foundation, not a turnkey payment or email service. Before handling real orders or personal data, follow [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md), connect production payment and email providers, and move the demo JSON database to a durable production database.

## What is included

- **Marketing site:** homepage, features, pricing, how it works, vendor directory, contact, FAQ, and legal pages.
- **Shared multi-vendor storefront:** vendor home, categories, product details, cart, checkout, order confirmation/tracking, account, and wishlist. Tenant selection supports vendor subdomains and a `?vendor=<slug>` development override.
- **Vendor console:** dashboard and analytics, product/category and order management, customers, balances, withdrawals, notifications, store settings, profile, and support.
- **Platform console:** vendors, deposits, withdrawals, orders, customer messages, analytics, and settings.
- **Custom API:** authentication and roles, tenant-scoped commerce routes, server-priced checkout, order lifecycle, server-side commission/balance calculations, deposit and activation flow, and finance/admin endpoints.
- **Responsive design system:** light/dark themes, mobile layouts, accessible forms, loading and empty states, and local SVG artwork/icons.
- **Static-page generator and checks:** committed HTML for SEO and direct Hostinger upload, plus static, API smoke, and jsdom page-runtime checks.

## Architecture

```text
Browser
  ├── growbusinessonline.com            → shared static frontend on Hostinger hPanel
  ├── <vendor>.growbusinessonline.com   → same frontend; hostname selects vendor
  └── /api/*                            → custom Node.js backend
                                             ├── auth / storefront / vendor / customer
                                             └── finance / admin
```

- Frontend: static HTML, CSS, and native ES modules (no bundler required).
- Backend: Node.js 18+, Express 4, CommonJS.
- Demo persistence: JSON document store in `backend/data/db.json` (generated locally; ignored by Git). Use a persistent disk and a production-grade database for live commerce; the current JSON store is for demo/single-instance development.
- Currency calculations use integer paise on the server. The browser cannot confirm deposits, set order prices, change balances, or calculate commission.

## Run locally

Requirements: Node.js 18 or newer and npm.

```bash
cd backend
npm ci
cp .env.example .env
# For a local-only demo, defaults work. Never use the sample secrets or demo
# accounts on a public/production server.
npm start
```

Open <http://localhost:4000>. The backend serves the static frontend in local development and creates demo data when the local database is empty. The demo database is written to `backend/data/db.json` and is intentionally not committed.

### Demo accounts (local development only)

| Role | Email | Password |
| --- | --- | --- |
| Platform admin | `admin@growbusinessonline.com` | `Admin@123` |
| Vendor | `vendor@growbusinessonline.com` | `Vendor@123` |
| Customer | `customer@example.com` | `Customer@123` |

These credentials are public demo data. Do not expose the seeded instance as a live service or reuse these passwords. `npm run reset` **deletes and rebuilds** the local demo database; it is destructive.

### Local multi-vendor preview

On the shared dev server, use the query override, for example:

- <http://localhost:4000/vendor/index.html?vendor=techmart>
- <http://localhost:4000/vendor/index.html?vendor=stylehub>

In deployment, configure DNS and the web root for a wildcard vendor subdomain; see the deployment guide.

## Frontend pages and generation

The deployable site lives in `frontend/`. Generated HTML is committed, so there is no build step required on Hostinger. When editing shared templates or page content, regenerate the static pages from the repository root:

```bash
node tools/generate.mjs
```

Shared page templates are in `frontend/partials/`; page-specific controllers are in `frontend/js/pages/`. The single deployment-time frontend configuration is `frontend/js/config.js`. It contains public values only. If the API is on another origin, set `OVERRIDES.apiBase` to the API base URL (for example, `https://api.growbusinessonline.com/api`). **Never place backend secrets, payment secrets, or service-account credentials in frontend files.**

## Checks

Start the backend first for API/runtime tests.

```bash
# From the repository root
node tools/check-frontend.mjs
node tools/smoke-test.mjs

# Browser-like runtime checks (one-time dependency install)
cd tools && npm ci && cd ..
node tools/browser-check.mjs
# Optional: narrow to matching page paths
node tools/browser-check.mjs admin/index.html
```

`check-frontend.mjs` verifies imports/exports, local paths, page boot scripts, and duplicate IDs. `smoke-test.mjs` exercises the API, tenant isolation, auth, and financial/security invariants. `browser-check.mjs` boots generated pages in jsdom against the running API and checks guest/vendor/customer/admin access paths.

## Production safety checklist

Before opening the platform to real vendors or customers:

1. Use a persistent backend host and production database; back up and test restore procedures. Do not run a multi-instance or ephemeral deployment on the JSON store.
2. Replace development secrets with strong, unique environment secrets; set `NODE_ENV=production`, `DEV_TOOLS=false`, and `DEV_FAST_ACTIVATION=false`.
3. Disable demo credentials in the public frontend (`features.demoMode` in `frontend/js/config.js`) and remove/re-provision all demo accounts.
4. Connect a payment provider and implement its verified webhook flow. The current deposit initiation is a demo stub; never treat the development payment simulator as a real payment integration.
5. Connect transactional email for password reset and email verification. No outbound email provider is configured in this repository.
6. Configure HTTPS, wildcard DNS/TLS, CORS, backups, monitoring, rate limits, privacy/retention rules, and production admin provisioning.
7. Review all privacy, refund, vendor, tax, and consumer-law text with qualified counsel before use.

See [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) for Hostinger-oriented staging and production setup notes.
