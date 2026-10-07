/**
 * Central runtime configuration.
 * Everything tunable lives here so no magic numbers are scattered in routes.
 */
require('dotenv').config();

const path = require('path');

const bool = (v, d = false) => (v === undefined ? d : /^(1|true|yes|on)$/i.test(String(v)));
const int = (v, d) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : d;
};

const NODE_ENV = process.env.NODE_ENV || 'development';
const isProd = NODE_ENV === 'production';

const config = {
  env: NODE_ENV,
  isProd,
  port: int(process.env.PORT, 4000),
  rootDomain: (process.env.ROOT_DOMAIN || 'growbusinessonline.com').toLowerCase(),
  appSecret: process.env.APP_SECRET || 'dev-only-insecure-secret-change-me',
  gatewaySecret: process.env.GATEWAY_WEBHOOK_SECRET || 'dev-only-gateway-secret',
  corsOrigins: (process.env.CORS_ORIGINS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),

  currency: process.env.CURRENCY || 'INR',
  commissionPercent: Number(process.env.PLATFORM_COMMISSION_PERCENT || 5),
  depositPaise: int(process.env.SECURITY_DEPOSIT_PAISE, 100000), // ₹1,000
  activationHours: int(process.env.ACTIVATION_HOURS, 48),
  deliveryFeePaise: int(process.env.DEFAULT_DELIVERY_FEE_PAISE, 4900), // ₹49
  freeDeliveryAbovePaise: int(process.env.FREE_DELIVERY_ABOVE_PAISE, 99900), // ₹999
  gstPercent: Number(process.env.GST_PERCENT || 0),
  taxable: bool(process.env.TAXABLE, false),

  serveFrontend: bool(process.env.SERVE_FRONTEND, true),
  devTools: bool(process.env.DEV_TOOLS, !isProd),
  devFastActivation: bool(process.env.DEV_FAST_ACTIVATION, false),

  paths: {
    root: path.join(__dirname, '..'),
    data: path.join(__dirname, '..', 'data'),
    dbFile: path.join(__dirname, '..', 'data', 'db.json'),
    frontend: path.join(__dirname, '..', '..', 'frontend'),
  },

  token: {
    accessTtlSeconds: 60 * 60 * 24 * 7, // 7 days
    resetTtlSeconds: 60 * 30,
    verifyTtlSeconds: 60 * 60 * 24,
    issuer: 'growbusiness-online',
  },

  limits: {
    pageSize: 12,
    maxPageSize: 48,
    authWindowMs: 10 * 60 * 1000,
    authMaxAttempts: 12,
  },
};

if (isProd && /change-me|dev-only/.test(config.appSecret)) {
  // Fail loudly rather than silently signing tokens with a known secret.
  throw new Error('APP_SECRET must be set to a strong random value in production.');
}

module.exports = config;
