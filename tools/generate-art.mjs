#!/usr/bin/env node
/**
 * Generates every raster-free image the frontend needs:
 *   • product tiles      frontend/assets/images/products/<glyph>-<n>.svg
 *   • vendor banners     frontend/assets/images/banners/<slug>.svg
 *   • vendor logos       frontend/assets/images/logos/<slug>.svg
 *   • hero illustration  frontend/assets/images/hero-dashboard.svg
 *
 * Why SVG?  Spec §38 asks for a light, fast frontend with no external
 * dependencies. These files are ~1 KB each, scale to any DPR, need no image
 * CDN and keep working when the site is uploaded to Hostinger hPanel.
 *
 *   node tools/generate-art.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const img = (...p) => path.join(root, 'frontend', 'assets', 'images', ...p);

const PALETTES = [
  ['#6366F1', '#22D3EE'],
  ['#8B5CF6', '#EC4899'],
  ['#0EA5E9', '#34D399'],
  ['#F59E0B', '#EF4444'],
  ['#10B981', '#84CC16'],
  ['#F43F5E', '#FB923C'],
  ['#3B82F6', '#8B5CF6'],
  ['#14B8A6', '#0EA5E9'],
  ['#A855F7', '#6366F1'],
  ['#F97316', '#FBBF24'],
  ['#0F766E', '#22D3EE'],
  ['#BE185D', '#F472B6'],
  ['#1D4ED8', '#60A5FA'],
  ['#065F46', '#4ADE80'],
];

/* Line-art glyphs drawn on a 24×24 grid, scaled into the tile. */
const GLYPHS = {
  phone: `<rect x="7" y="2" width="10" height="20" rx="2.5"/><path d="M10.8 18.6h2.4"/>`,
  laptop: `<rect x="3" y="5" width="18" height="11" rx="1.8"/><path d="M1.5 19.5h21l-1.6-3H3.1z"/>`,
  headphones: `<path d="M4 15v-3a8 8 0 0 1 16 0v3"/><rect x="2" y="13.5" width="4.5" height="7.5" rx="2.2"/><rect x="17.5" y="13.5" width="4.5" height="7.5" rx="2.2"/>`,
  speaker: `<rect x="6" y="2" width="12" height="20" rx="3.5"/><circle cx="12" cy="15" r="3.6"/><circle cx="12" cy="7" r="1.4"/>`,
  earbuds: `<rect x="3.5" y="12" width="17" height="9.5" rx="4.2"/><path d="M8.5 12V7.5A2.5 2.5 0 0 1 11 5"/><path d="M15.5 12V7.5A2.5 2.5 0 0 0 13 5"/>`,
  watch: `<rect x="8.5" y="1.5" width="7" height="4.5" rx="1.4"/><rect x="8.5" y="18" width="7" height="4.5" rx="1.4"/><circle cx="12" cy="12" r="6.2"/><path d="M12 9.2V12l1.9 1.2"/>`,
  band: `<rect x="8" y="1.5" width="8" height="21" rx="4"/><rect x="9.8" y="8" width="4.4" height="6.4" rx="1.2"/>`,
  camera: `<rect x="2" y="6.5" width="20" height="14" rx="3"/><circle cx="12" cy="13.5" r="4.2"/><path d="M8.2 6.5 9.6 4h4.8l1.4 2.5"/>`,
  charger: `<path d="M13.5 2 5 13.4h5.2L9.4 22 19 10.2h-5.4z"/>`,
  cable: `<path d="M7 2.5v4a3 3 0 0 0 3 3h4a3 3 0 0 1 3 3v4"/><rect x="5.2" y="1.5" width="3.6" height="2.6" rx="1"/><rect x="15.2" y="19.9" width="3.6" height="2.6" rx="1"/>`,
  battery: `<rect x="2.5" y="7" width="16" height="10" rx="2.6"/><path d="M21.5 10.5v3"/><path d="M11 9.2 8.4 13h2.4l-.8 2.6L13 11.6h-2.4z"/>`,
  monitor: `<rect x="2" y="3.5" width="20" height="13" rx="2.2"/><path d="M8.5 20.5h7M12 16.5v4"/>`,
  keyboard: `<rect x="1.8" y="6" width="20.4" height="12" rx="2.4"/><path d="M5.5 9.5h.01M9 9.5h.01M12.5 9.5h.01M16 9.5h.01M18.5 9.5h.01M5.5 12.5h.01M9 12.5h.01M12.5 12.5h.01M16 12.5h.01M18.5 12.5h.01M8 15.4h8"/>`,
  mouse: `<rect x="7.5" y="2" width="9" height="20" rx="4.5"/><path d="M12 6v4"/>`,
  shirt: `<path d="M8.6 2.6 4 5.2l1.9 3.6 1.6-.9v11.5h9V7.9l1.6.9L20 5.2l-4.6-2.6a3.4 3.4 0 0 1-6.8 0z"/>`,
  jeans: `<path d="M6.8 2.5h10.4v7.2l-1.1 11.8h-3.6l-1.3-9.6-1.3 9.6H6.3L5.2 9.7z"/><path d="M6.8 6.6h10.4"/>`,
  blazer: `<path d="M9 2.6 4.2 5.4l1.6 3.4 1.4-.8v11.4h9.6V8l1.4.8 1.6-3.4L15 2.6 12 6.4z"/><path d="M9 2.6 12 6.4l3-3.8"/><path d="M12 6.4v13"/>`,
  shoe: `<path d="M2 16.5h13.2a6.6 6.6 0 0 0 6.3-4.6l-3.6-1.2-2.6-4.2-3.4 2.1v4.1H2z"/><path d="M2 19.6h20"/>`,
  bag: `<rect x="4.5" y="7.5" width="15" height="14" rx="2.6"/><path d="M8.8 7.5V6a3.2 3.2 0 0 1 6.4 0v1.5"/>`,
  glasses: `<circle cx="6.4" cy="14" r="3.8"/><circle cx="17.6" cy="14" r="3.8"/><path d="M10.2 13.6h3.6M2.6 12 5 9.6M21.4 12 19 9.6"/>`,
  belt: `<rect x="1.8" y="9" width="20.4" height="6" rx="1.6"/><rect x="9" y="7.8" width="6" height="8.4" rx="1.6"/><path d="M12 9.6v4.8"/>`,
  jar: `<rect x="7.5" y="2.5" width="9" height="3" rx="1.2"/><path d="M6 8.4c0-1.4 1.1-2.4 2.5-2.4h7c1.4 0 2.5 1 2.5 2.4v10.7c0 1.4-1.1 2.4-2.5 2.4h-7c-1.4 0-2.5-1-2.5-2.4z"/><path d="M9 12.5h6"/>`,
  bottle: `<rect x="9.8" y="2" width="4.4" height="3.4" rx="1.1"/><path d="M9 8.6c0-1.6 1.3-2.8 3-2.8s3 1.2 3 2.8v10.6c0 1.6-1.3 2.8-3 2.8s-3-1.2-3-2.8z"/><path d="M9 13.5h6"/>`,
  vase: `<path d="M9.5 2.5h5l-.8 3.4c2.6 1.4 4.3 4 4.3 7 0 4.6-3 8.6-6 8.6s-6-4-6-8.6c0-3 1.7-5.6 4.3-7z"/><path d="M8.6 12.5h6.8"/>`,
  pillow: `<rect x="3.5" y="3.5" width="17" height="17" rx="4"/><path d="M7 7h.01M17 7h.01M7 17h.01M17 17h.01"/><path d="M9.5 12h5"/>`,
};

const VARIANTS = 4;

const tile = (glyph, [c1, c2], uid) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 600" width="600" height="600" role="img" aria-label="Product illustration">
  <defs>
    <linearGradient id="g${uid}" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/>
    </linearGradient>
    <radialGradient id="h${uid}" cx="0.28" cy="0.18" r="0.85">
      <stop offset="0" stop-color="#ffffff" stop-opacity="0.42"/><stop offset="1" stop-color="#ffffff" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="600" height="600" fill="url(#g${uid})"/>
  <rect width="600" height="600" fill="url(#h${uid})"/>
  <circle cx="300" cy="300" r="176" fill="#ffffff" fill-opacity="0.14"/>
  <circle cx="300" cy="300" r="228" fill="none" stroke="#ffffff" stroke-opacity="0.14" stroke-width="2"/>
  <g transform="translate(156 156) scale(12)" fill="none" stroke="#ffffff" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round" stroke-opacity="0.96">${GLYPHS[glyph]}</g>
  <path d="M0 470c120-42 210 26 330-6s170-64 270-30v166H0z" fill="#0b1020" fill-opacity="0.10"/>
</svg>`;

const banner = (slug, [c1, c2], label) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 620" width="1600" height="620" role="img" aria-label="${label} store banner">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${c1}"/><stop offset="0.55" stop-color="${c2}"/><stop offset="1" stop-color="#0B1020"/></linearGradient>
    <radialGradient id="glow" cx="0.78" cy="0.2" r="0.6"><stop offset="0" stop-color="#ffffff" stop-opacity="0.35"/><stop offset="1" stop-color="#ffffff" stop-opacity="0"/></radialGradient>
  </defs>
  <rect width="1600" height="620" fill="url(#bg)"/>
  <rect width="1600" height="620" fill="url(#glow)"/>
  <g fill="none" stroke="#ffffff" stroke-opacity="0.16" stroke-width="2">
    <circle cx="1290" cy="180" r="150"/><circle cx="1290" cy="180" r="230"/><circle cx="1290" cy="180" r="310"/>
    <path d="M-40 470c220-90 380 40 620-10s360-120 620-40 300 90 440 40"/>
    <path d="M-40 540c220-90 380 40 620-10s360-120 620-40 300 90 440 40"/>
  </g>
  <g fill="#ffffff" fill-opacity="0.10">
    <rect x="90" y="380" width="120" height="120" rx="26"/><rect x="240" y="330" width="90" height="170" rx="22"/><rect x="360" y="420" width="140" height="80" rx="20"/>
  </g>
</svg>`;

const logo = (letters, [c1, c2]) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120" width="120" height="120" role="img" aria-label="Store logo">
  <defs><linearGradient id="lg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient></defs>
  <rect width="120" height="120" rx="30" fill="url(#lg)"/>
  <rect x="6" y="6" width="108" height="108" rx="25" fill="none" stroke="#ffffff" stroke-opacity="0.35" stroke-width="2"/>
  <text x="60" y="76" text-anchor="middle" font-family="Inter, Segoe UI, Helvetica, Arial, sans-serif" font-size="46" font-weight="800" fill="#ffffff" letter-spacing="-1">${letters}</text>
</svg>`;

const initials = (name) =>
  name
    .replace(/[^A-Za-z ]/g, '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('');

function write(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
  return file;
}

/* --------------------------------------------------------------- product art */
let count = 0;
for (const glyph of Object.keys(GLYPHS)) {
  for (let v = 1; v <= VARIANTS; v++) {
    write(img('products', `${glyph}-${v}.svg`), tile(glyph, PALETTES[(v - 1) * 3 % PALETTES.length], `${glyph}${v}`));
    count++;
  }
}

/* ------------------------------------------------------------- vendor banners */
const VENDORS = [
  ['techmart', 'TechMart Electronics', 0],
  ['stylehub', 'StyleHub Fashion', 5],
  ['freshkart', 'FreshKart Organics', 4],
  ['homely', 'Homely Decor', 9],
];
for (const [slug, name, pi] of VENDORS) {
  write(img('banners', `${slug}.svg`), banner(slug, PALETTES[pi], name));
  write(img('logos', `${slug}.svg`), logo(initials(name), PALETTES[pi]));
  count += 2;
}

/* ------------------------------------------------------- platform hero artwork */
const hero = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 760 620" width="760" height="620" role="img" aria-label="GrowBusiness Online vendor dashboard preview">
  <defs>
    <linearGradient id="hbg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#6D5EF6"/><stop offset="1" stop-color="#0EA5E9"/></linearGradient>
    <linearGradient id="harea" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#6D5EF6" stop-opacity="0.45"/><stop offset="1" stop-color="#6D5EF6" stop-opacity="0"/></linearGradient>
    <linearGradient id="hbar" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="#22D3EE"/><stop offset="1" stop-color="#6D5EF6"/></linearGradient>
    <filter id="hshadow" x="-30%" y="-30%" width="160%" height="160%"><feDropShadow dx="0" dy="26" stdDeviation="28" flood-color="#0B1020" flood-opacity="0.28"/></filter>
    <filter id="hshadow2" x="-40%" y="-40%" width="180%" height="180%"><feDropShadow dx="0" dy="14" stdDeviation="16" flood-color="#0B1020" flood-opacity="0.20"/></filter>
  </defs>

  <!-- backdrop blob -->
  <circle cx="600" cy="120" r="180" fill="url(#hbg)" opacity="0.13"/>
  <circle cx="120" cy="520" r="140" fill="#22D3EE" opacity="0.12"/>

  <!-- browser window -->
  <g filter="url(#hshadow)">
    <rect x="60" y="70" width="640" height="430" rx="22" fill="#FFFFFF"/>
    <path d="M60 92a22 22 0 0 1 22-22h596a22 22 0 0 1 22 22v26H60z" fill="#F4F5FB"/>
    <circle cx="88" cy="93" r="6" fill="#F87171"/><circle cx="108" cy="93" r="6" fill="#FBBF24"/><circle cx="128" cy="93" r="6" fill="#34D399"/>
    <rect x="300" y="84" width="160" height="18" rx="9" fill="#E6E8F2"/>
  </g>

  <!-- sidebar -->
  <rect x="60" y="118" width="146" height="382" rx="0" fill="#0F172A"/>
  <rect x="80" y="140" width="30" height="30" rx="9" fill="url(#hbg)"/>
  <rect x="118" y="150" width="66" height="10" rx="5" fill="#FFFFFF" opacity="0.75"/>
  <g fill="#FFFFFF" opacity="0.22">
    <rect x="80" y="196" width="106" height="10" rx="5"/><rect x="80" y="226" width="86" height="10" rx="5"/>
    <rect x="80" y="286" width="96" height="10" rx="5"/><rect x="80" y="316" width="72" height="10" rx="5"/>
    <rect x="80" y="346" width="102" height="10" rx="5"/><rect x="80" y="376" width="64" height="10" rx="5"/>
  </g>
  <rect x="72" y="248" width="122" height="26" rx="9" fill="url(#hbg)" opacity="0.9"/>
  <rect x="86" y="257" width="72" height="8" rx="4" fill="#FFFFFF" opacity="0.9"/>

  <!-- kpi cards -->
  <g filter="url(#hshadow2)">
    <rect x="228" y="140" width="140" height="74" rx="14" fill="#FFFFFF" stroke="#EDEFF7"/>
    <rect x="382" y="140" width="140" height="74" rx="14" fill="#FFFFFF" stroke="#EDEFF7"/>
    <rect x="536" y="140" width="140" height="74" rx="14" fill="#FFFFFF" stroke="#EDEFF7"/>
  </g>
  <g>
    <rect x="244" y="156" width="30" height="30" rx="9" fill="#EEF0FF"/><rect x="398" y="156" width="30" height="30" rx="9" fill="#E6FAF3"/><rect x="552" y="156" width="30" height="30" rx="9" fill="#FFF3E2"/>
    <rect x="244" y="194" width="72" height="9" rx="4.5" fill="#0F172A" opacity="0.85"/><rect x="398" y="194" width="60" height="9" rx="4.5" fill="#0F172A" opacity="0.85"/><rect x="552" y="194" width="66" height="9" rx="4.5" fill="#0F172A" opacity="0.85"/>
  </g>

  <!-- revenue chart -->
  <g filter="url(#hshadow2)"><rect x="228" y="234" width="294" height="168" rx="16" fill="#FFFFFF" stroke="#EDEFF7"/></g>
  <rect x="248" y="252" width="96" height="10" rx="5" fill="#0F172A" opacity="0.8"/>
  <rect x="248" y="270" width="56" height="8" rx="4" fill="#94A3B8" opacity="0.7"/>
  <path d="M248 372 L282 350 L316 358 L350 322 L384 330 L418 296 L452 306 L494 274 L494 386 L248 386 Z" fill="url(#harea)"/>
  <path d="M248 372 L282 350 L316 358 L350 322 L384 330 L418 296 L452 306 L494 274" fill="none" stroke="#6D5EF6" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>
  <g fill="#6D5EF6"><circle cx="350" cy="322" r="5"/><circle cx="418" cy="296" r="5"/><circle cx="494" cy="274" r="5.5" stroke="#fff" stroke-width="3"/></g>

  <!-- orders bars -->
  <g filter="url(#hshadow2)"><rect x="536" y="234" width="140" height="168" rx="16" fill="#FFFFFF" stroke="#EDEFF7"/></g>
  <rect x="552" y="252" width="70" height="10" rx="5" fill="#0F172A" opacity="0.8"/>
  <g fill="url(#hbar)">
    <rect x="554" y="352" width="14" height="34" rx="5"/><rect x="574" y="330" width="14" height="56" rx="5"/>
    <rect x="594" y="308" width="14" height="78" rx="5"/><rect x="614" y="336" width="14" height="50" rx="5"/>
    <rect x="634" y="288" width="14" height="98" rx="5"/>
  </g>

  <!-- order rows -->
  <g filter="url(#hshadow2)"><rect x="228" y="418" width="448" height="66" rx="16" fill="#FFFFFF" stroke="#EDEFF7"/></g>
  <rect x="248" y="436" width="30" height="30" rx="9" fill="#F1F5F9"/>
  <rect x="290" y="440" width="120" height="9" rx="4.5" fill="#0F172A" opacity="0.8"/>
  <rect x="290" y="458" width="80" height="8" rx="4" fill="#94A3B8" opacity="0.7"/>
  <rect x="560" y="440" width="96" height="22" rx="11" fill="#E6FAF3"/>
  <rect x="574" y="448" width="68" height="7" rx="3.5" fill="#16A34A" opacity="0.8"/>

  <!-- floating chips -->
  <g filter="url(#hshadow2)">
    <rect x="18" y="200" width="176" height="70" rx="18" fill="#FFFFFF"/>
    <rect x="600" y="470" width="146" height="92" rx="18" fill="#FFFFFF"/>
  </g>
  <circle cx="52" cy="235" r="17" fill="#E6FAF3"/><path d="M45 235l5 5 10-11" stroke="#16A34A" stroke-width="3.4" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
  <rect x="78" y="222" width="86" height="9" rx="4.5" fill="#0F172A" opacity="0.85"/>
  <rect x="78" y="240" width="58" height="8" rx="4" fill="#94A3B8" opacity="0.8"/>

  <rect x="618" y="488" width="110" height="9" rx="4.5" fill="#0F172A" opacity="0.85"/>
  <rect x="618" y="506" width="72" height="8" rx="4" fill="#94A3B8" opacity="0.8"/>
  <g fill="url(#hbar)"><rect x="618" y="540" width="10" height="12" rx="4"/><rect x="634" y="532" width="10" height="20" rx="4"/><rect x="650" y="524" width="10" height="28" rx="4"/><rect x="666" y="536" width="10" height="16" rx="4"/><rect x="682" y="518" width="10" height="34" rx="4"/></g>

  <!-- storefront mini card -->
  <g filter="url(#hshadow2)"><rect x="40" y="404" width="150" height="176" rx="18" fill="#FFFFFF"/></g>
  <rect x="40" y="404" width="150" height="86" rx="18" fill="url(#hbg)"/>
  <rect x="58" y="504" width="86" height="10" rx="5" fill="#0F172A" opacity="0.85"/>
  <rect x="58" y="524" width="54" height="9" rx="4.5" fill="#6D5EF6"/>
  <rect x="58" y="546" width="114" height="22" rx="11" fill="#0F172A"/>
  <rect x="76" y="554" width="78" height="7" rx="3.5" fill="#FFFFFF" opacity="0.9"/>
</svg>`;
write(img('hero-dashboard.svg'), hero);
count++;

/* --------------------------------------------------------- marketplace banner */
const marketplace = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 480" width="1200" height="480" role="img" aria-label="Vendor marketplace">
  <defs><linearGradient id="mbg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#1E1B4B"/><stop offset="0.5" stop-color="#4F46E5"/><stop offset="1" stop-color="#0EA5E9"/></linearGradient></defs>
  <rect width="1200" height="480" fill="url(#mbg)"/>
  <g fill="none" stroke="#ffffff" stroke-opacity="0.18" stroke-width="2">
    <circle cx="980" cy="120" r="120"/><circle cx="980" cy="120" r="190"/><circle cx="980" cy="120" r="260"/>
    <path d="M-20 360c200-70 320 40 540-10s320-100 560-30"/>
  </g>
  <g fill="#ffffff" fill-opacity="0.12">
    <rect x="80" y="300" width="110" height="110" rx="24"/><rect x="220" y="250" width="80" height="160" rx="20"/>
    <rect x="330" y="330" width="130" height="80" rx="20"/><rect x="490" y="280" width="96" height="130" rx="22"/>
  </g>
</svg>`;
write(img('marketplace.svg'), marketplace);
count++;

/* ------------------------------------------------------------ og / social card */
const og = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 630" width="1200" height="630" role="img" aria-label="GrowBusiness Online">
  <defs><linearGradient id="og" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#0B1020"/><stop offset="0.55" stop-color="#312E81"/><stop offset="1" stop-color="#0EA5E9"/></linearGradient></defs>
  <rect width="1200" height="630" fill="url(#og)"/>
  <g fill="none" stroke="#ffffff" stroke-opacity="0.12" stroke-width="2"><circle cx="1000" cy="140" r="180"/><circle cx="1000" cy="140" r="280"/></g>
  <rect x="90" y="220" width="86" height="86" rx="24" fill="#6D5EF6"/>
  <path d="M118 276c14-26 30-38 44-38" stroke="#ffffff" stroke-width="9" fill="none" stroke-linecap="round"/>
  <circle cx="150" cy="248" r="7" fill="#ffffff"/>
  <text x="90" y="380" font-family="Inter, Segoe UI, Helvetica, Arial, sans-serif" font-size="72" font-weight="800" fill="#ffffff">Grow Your Business Online</text>
  <text x="92" y="436" font-family="Inter, Segoe UI, Helvetica, Arial, sans-serif" font-size="30" fill="#C7D2FE">Your store, your subdomain, your customers — in 48 hours.</text>
</svg>`;
write(img('og-cover.svg'), og);
count++;

/* -------------------------------------------------------------- favicon + logo */
const mark = (size, rounded) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="${size}" height="${size}" role="img" aria-label="GrowBusiness Online">
  <defs><linearGradient id="m" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#6D5EF6"/><stop offset="1" stop-color="#0EA5E9"/></linearGradient></defs>
  <rect width="64" height="64" rx="${rounded}" fill="url(#m)"/>
  <path d="M14 44c9-20 21-30 36-30" stroke="#ffffff" stroke-width="6.5" fill="none" stroke-linecap="round"/>
  <path d="M38 14h12v12" stroke="#ffffff" stroke-width="6.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
  <circle cx="24" cy="36" r="4.2" fill="#ffffff"/>
</svg>`;
write(path.join(root, 'frontend', 'assets', 'icons', 'favicon.svg'), mark(64, 16));
write(path.join(root, 'frontend', 'assets', 'icons', 'apple-touch-icon.svg'), mark(180, 40));
write(img('logos', 'growbusiness.svg'), mark(120, 30));
count += 3;

/* Full lockup logo used in the header */
const lockup = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 64" width="320" height="64" role="img" aria-label="GrowBusiness Online">
  <defs><linearGradient id="l" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#6D5EF6"/><stop offset="1" stop-color="#0EA5E9"/></linearGradient></defs>
  <rect width="56" height="56" x="0" y="4" rx="16" fill="url(#l)"/>
  <path d="M12 44c8-18 18-27 32-27" stroke="#fff" stroke-width="6" fill="none" stroke-linecap="round"/>
  <path d="M33 17h11v11" stroke="#fff" stroke-width="6" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
  <text x="70" y="34" font-family="Inter, Segoe UI, Helvetica, Arial, sans-serif" font-size="24" font-weight="800" fill="currentColor">GrowBusiness</text>
  <text x="70" y="54" font-family="Inter, Segoe UI, Helvetica, Arial, sans-serif" font-size="15" font-weight="600" fill="currentColor" opacity="0.65">ONLINE</text>
</svg>`;
write(img('logos', 'wordmark.svg'), lockup);
count++;

console.log(`✓ generated ${count} SVG assets into frontend/assets/`);
