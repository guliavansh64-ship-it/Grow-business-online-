/**
 * theme.js — light/dark mode (spec §33) + per-vendor brand theming (spec §15, §41).
 *
 * The initial theme is applied by a tiny inline script in <head> so there is
 * never a flash of the wrong colours. This module owns everything after that.
 */
import cfg from './config.js';
import { store, $, on } from './utils.js';

const KEY = 'theme';

/* ------------------------------------------------------------- colour maths */

const clamp255 = (n) => Math.max(0, Math.min(255, Math.round(n)));

export function hexToRgb(hex) {
  let h = String(hex || '').replace('#', '').trim();
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  if (!/^[0-9a-f]{6}$/i.test(h)) return { r: 109, g: 94, b: 246 };
  return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16) };
}

export const rgbToHex = ({ r, g, b }) => `#${[r, g, b].map((v) => clamp255(v).toString(16).padStart(2, '0')).join('')}`;

/** mix(#6D5EF6, #FFFFFF, 0.8) → 80% towards white */
export function mix(hex, target, amount) {
  const a = hexToRgb(hex);
  const b = hexToRgb(target);
  return rgbToHex({ r: a.r + (b.r - a.r) * amount, g: a.g + (b.g - a.g) * amount, b: a.b + (b.b - a.b) * amount });
}

/** Contrast-safe foreground for a background colour. */
export function readableOn(hex) {
  const { r, g, b } = hexToRgb(hex);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.62 ? '#0B1020' : '#FFFFFF';
}

/** Builds a 50→900 ramp from one colour, like a design token generator. */
export function ramp(hex) {
  const light = [0.94, 0.86, 0.7, 0.46, 0.2];
  const dark = [0.14, 0.3, 0.48, 0.68];
  return {
    50: mix(hex, '#ffffff', light[0]),
    100: mix(hex, '#ffffff', light[1]),
    200: mix(hex, '#ffffff', light[2]),
    300: mix(hex, '#ffffff', light[3]),
    400: mix(hex, '#ffffff', light[4]),
    500: hex,
    600: mix(hex, '#000000', dark[0]),
    700: mix(hex, '#000000', dark[1]),
    800: mix(hex, '#000000', dark[2]),
    900: mix(hex, '#000000', dark[3]),
  };
}

/* ------------------------------------------------------------------- theme */

export function currentTheme() {
  return document.documentElement.dataset.theme || 'light';
}

export function setTheme(mode, { persist = true } = {}) {
  let resolved = mode;
  if (mode === 'auto' || !mode) {
    resolved = globalThis.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  document.documentElement.dataset.theme = resolved;
  document.documentElement.dataset.themePref = mode;
  if (persist) store.set(KEY, mode);
  const meta = $('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', resolved === 'dark' ? '#080b16' : '#ffffff');
  document.dispatchEvent(new CustomEvent('theme:change', { detail: { theme: resolved, pref: mode } }));
  return resolved;
}

export function toggleTheme() {
  return setTheme(currentTheme() === 'dark' ? 'light' : 'dark');
}

/** Wires every [data-theme-toggle] button on the page. */
export function bindThemeToggles(scope = document) {
  on('[data-theme-toggle]', 'click', (e) => {
    e.preventDefault();
    toggleTheme();
  }, { capture: false });
  // Follow the OS when the preference is "auto".
  globalThis.matchMedia?.('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
    if ((store.get(KEY) || cfg.theme) === 'auto') setTheme(e.matches ? 'dark' : 'light', { persist: false });
  });
  return scope;
}

/* --------------------------------------------------------- vendor branding */

/**
 * Applies a vendor's palette to the shared component library, so ONE frontend
 * can render techmart in indigo and stylehub in pink without any duplicated CSS.
 */
export function applyVendorTheme(theme = {}, { accent = false } = {}) {
  const root = document.documentElement;
  const primary = /^#[0-9a-f]{3,6}$/i.test(theme.primary || '') ? theme.primary : null;
  if (!primary) return;
  const scale = ramp(primary);
  root.style.setProperty('--brand-50', scale[50]);
  root.style.setProperty('--brand-100', scale[100]);
  root.style.setProperty('--brand-200', scale[200]);
  root.style.setProperty('--brand-300', scale[300]);
  root.style.setProperty('--brand-400', scale[400]);
  root.style.setProperty('--brand-500', scale[500]);
  root.style.setProperty('--brand-600', scale[600]);
  root.style.setProperty('--brand-700', scale[700]);
  root.style.setProperty('--brand-800', scale[800]);
  root.style.setProperty('--brand-900', scale[900]);
  root.style.setProperty('--brand', currentTheme() === 'dark' ? scale[400] : scale[500]);
  root.style.setProperty('--brand-strong', currentTheme() === 'dark' ? scale[300] : scale[600]);
  root.style.setProperty('--brand-soft', currentTheme() === 'dark' ? mix(scale[500], '#0b1020', 0.82) : scale[50]);
  root.style.setProperty('--brand-ink', readableOn(scale[500]));
  if (theme.secondary) root.style.setProperty('--accent', theme.secondary);
  root.dataset.vendorTheme = 'on';
  if (accent && theme.accent) root.style.setProperty('--accent', theme.accent);
}

/** Re-applies the platform palette (marketing site / dashboard). */
export function clearVendorTheme() {
  const root = document.documentElement;
  [50, 100, 200, 300, 400, 500, 600, 700, 800, 900].forEach((n) => root.style.removeProperty(`--brand-${n}`));
  ['--brand', '--brand-strong', '--brand-soft', '--brand-ink', '--accent'].forEach((p) => root.style.removeProperty(p));
  delete root.dataset.vendorTheme;
}

export function initTheme() {
  const stored = store.get(KEY, cfg.theme || 'auto');
  setTheme(stored, { persist: false });
  bindThemeToggles();
  document.addEventListener('theme:change', () => {
    if (document.documentElement.dataset.vendorTheme === 'on' && window.__gboVendorTheme) {
      applyVendorTheme(window.__gboVendorTheme);
    }
  });
}

export default { initTheme, setTheme, toggleTheme, currentTheme, applyVendorTheme, clearVendorTheme, ramp, mix, readableOn };
