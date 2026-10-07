/**
 * icons.js — an inline SVG sprite so the UI never depends on an icon CDN.
 *
 *   import { icon, mountIcons } from './icons.js';
 *   mountIcons();                       // once per page, before first paint
 *   button.innerHTML = icon('cart');    // <svg><use href="#i-cart"/></svg>
 *
 * Spec §38: no external requests, no font downloads, ~9 KB total, crisp at any DPR.
 */
import { html, raw } from './utils.js';

const S = (d, extra = '') => `<path d="${d}"${extra ? ` ${extra}` : ''}/>`;
const C = (cx, cy, r, extra = '') => `<circle cx="${cx}" cy="${cy}" r="${r}"${extra ? ` ${extra}` : ''}/>`;
const R = (x, y, w, h, rx, extra = '') => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}"${extra ? ` ${extra}` : ''}/>`;

export const ICONS = {
  /* navigation */
  menu: S('M3 6h18M3 12h18M3 18h18'),
  close: S('M18 6 6 18M6 6l12 12'),
  'chevron-down': S('m6 9 6 6 6-6'),
  'chevron-up': S('m18 15-6-6-6 6'),
  'chevron-right': S('m9 18 6-6-6-6'),
  'chevron-left': S('m15 18-6-6 6-6'),
  'arrow-right': S('M5 12h14m-6-7 7 7-7 7'),
  'arrow-left': S('M19 12H5m6 7-7-7 7-7'),
  'arrow-up': S('M12 19V5m-7 7 7-7 7 7'),
  'arrow-down': S('M12 5v14m7-7-7 7-7-7'),
  'arrow-up-right': S('M7 17 17 7M8 7h9v9'),
  external: S('M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6'),
  home: S('M3 10.5 12 3l9 7.5M5.5 9.5V20a1 1 0 0 0 1 1H10v-6h4v6h3.5a1 1 0 0 0 1-1V9.5'),
  search: `${C(11, 11, 7)}${S('m20.5 20.5-4.2-4.2')}`,
  filter: S('M3 5h18l-7 8v6l-4 2v-8z'),
  sliders: S('M4 6h9M17 6h3M4 12h3M11 12h9M4 18h9M17 18h3'),
  grid: `${R(3, 3, 7, 7, 1.6)}${R(14, 3, 7, 7, 1.6)}${R(3, 14, 7, 7, 1.6)}${R(14, 14, 7, 7, 1.6)}`,
  list: S('M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01'),
  'more-v': `${C(12, 5, 1.6, 'fill="currentColor" stroke="none"')}${C(12, 12, 1.6, 'fill="currentColor" stroke="none"')}${C(12, 19, 1.6, 'fill="currentColor" stroke="none"')}`,
  'more-h': `${C(5, 12, 1.6, 'fill="currentColor" stroke="none"')}${C(12, 12, 1.6, 'fill="currentColor" stroke="none"')}${C(19, 12, 1.6, 'fill="currentColor" stroke="none"')}`,

  /* state */
  check: S('m4.5 12.5 5 5 10-11'),
  'check-circle': `${C(12, 12, 9)}${S('m8.2 12.3 2.6 2.6 5-5.4')}`,
  'alert-triangle': S('M10.3 3.9 2.6 17.2A2 2 0 0 0 4.3 20h15.4a2 2 0 0 0 1.7-2.8L13.7 3.9a2 2 0 0 0-3.4 0ZM12 9v4m0 3.2h.01'),
  'alert-circle': `${C(12, 12, 9)}${S('M12 7.5v5m0 3h.01')}`,
  info: `${C(12, 12, 9)}${S('M12 11v5.5m0-8.5h.01')}`,
  'x-circle': `${C(12, 12, 9)}${S('m9.2 9.2 5.6 5.6m0-5.6-5.6 5.6')}`,
  help: `${C(12, 12, 9)}${S('M9.4 9.2a2.7 2.7 0 1 1 3.6 2.5c-.7.3-1 .9-1 1.6v.3m-1 3h.01')}`,
  plus: S('M12 5v14M5 12h14'),
  minus: S('M5 12h14'),
  sparkles: S('M12 3.5l1.7 4.6 4.6 1.7-4.6 1.7L12 16.1l-1.7-4.6L5.7 9.8l4.6-1.7zM18.5 15.5l.8 2.1 2.1.8-2.1.8-.8 2.1-.8-2.1-2.1-.8 2.1-.8zM5 3l.6 1.6L7.2 5l-1.6.6L5 7.2l-.6-1.6L2.8 5l1.6-.4z'),
  zap: S('M13.2 2 4.6 13.1h5.9L9.9 22l9.1-11.4h-6.2z'),
  loader: S('M12 3v4m0 10v4M5.6 5.6l2.8 2.8m7.2 7.2 2.8 2.8M3 12h4m10 0h4M5.6 18.4l2.8-2.8m7.2-7.2 2.8-2.8'),
  refresh: S('M20.5 12a8.5 8.5 0 1 1-2.6-6.1M20.8 4v5h-5'),
  eye: S('M2.2 12S5.8 5.5 12 5.5 21.8 12 21.8 12 18.2 18.5 12 18.5 2.2 12 2.2 12Z'),
  'eye-off': S('M9.9 5.8A9.6 9.6 0 0 1 12 5.5c6.2 0 9.8 6.5 9.8 6.5a17 17 0 0 1-3.3 4.1M6.3 7.9A17 17 0 0 0 2.2 12S5.8 18.5 12 18.5a9.4 9.4 0 0 0 3.7-.7M3 3l18 18'),
  copy: `${R(9, 9, 12, 12, 2.2)}${S('M5.5 15H4a1.5 1.5 0 0 1-1.5-1.5V4A1.5 1.5 0 0 1 4 2.5h9.5A1.5 1.5 0 0 1 15 4v1.5')}`,
  trash: S('M3.5 6h17M9 6V4.2A1.2 1.2 0 0 1 10.2 3h3.6A1.2 1.2 0 0 1 15 4.2V6m2.5 0-.8 13.1a1.6 1.6 0 0 1-1.6 1.4H8.9a1.6 1.6 0 0 1-1.6-1.4L6.5 6m3.5 4v6.5m4-6.5v6.5'),
  edit: S('M4 20h4L20 8l-4-4L4 16zM14.5 5.5l4 4'),
  save: S('M5 3.5h11L20.5 8v12.5a1 1 0 0 1-1 1h-14a1 1 0 0 1-1-1v-16a1 1 0 0 1 1-1ZM8 3.5v6h7M8 21.5v-6h8v6'),
  upload: S('M12 16V4m-5 5 5-5 5 5M4 17v2.5a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1V17'),
  download: S('M12 4v12m-5-5 5 5 5-5M4 17v2.5a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1V17'),
  print: S('M7 8V3.5h10V8M7 18H5a1.5 1.5 0 0 1-1.5-1.5v-5A1.5 1.5 0 0 1 5 10h14a1.5 1.5 0 0 1 1.5 1.5v5A1.5 1.5 0 0 1 19 18h-2M7 14.5h10v6H7z'),
  share: `${C(18, 5, 2.6)}${C(6, 12, 2.6)}${C(18, 19, 2.6)}${S('m8.4 10.8 7.2-4.2M8.4 13.2l7.2 4.2')}`,

  /* commerce */
  cart: `${C(9.5, 20, 1.5)}${C(18, 20, 1.5)}${S('M2.5 3h2.6l2.4 11.4a1.6 1.6 0 0 0 1.6 1.3h8.6a1.6 1.6 0 0 0 1.6-1.2L21 7.2H6')}`,
  bag: S('M5.5 8h13l1 12.5a1 1 0 0 1-1 1.1H5.5a1 1 0 0 1-1-1.1zM9 8V6a3 3 0 0 1 6 0v2'),
  tag: S('M3.5 11.4V4.6a1 1 0 0 1 1-1h6.8a1 1 0 0 1 .7.3l8.1 8.1a1 1 0 0 1 0 1.4l-6.8 6.8a1 1 0 0 1-1.4 0L3.8 12.1a1 1 0 0 1-.3-.7Z'),
  gift: `${R(3, 8, 18, 4, 1.4)}${S('M5 12v8.5a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V12M12 8v13.5M12 8S10.8 3 8.3 3a2.4 2.4 0 0 0 0 5zM12 8s1.2-5 3.7-5a2.4 2.4 0 0 1 0 5z')}`,
  percent: S('M6.5 6.5l11 11'),
  receipt: S('M5 3.5h14v17l-2.3-1.6-2.4 1.6-2.3-1.6-2.4 1.6L7.3 19 5 20.5zM8.5 8.5h7M8.5 12.5h7'),
  store: S('M3.5 9.5V20a1 1 0 0 0 1 1h15a1 1 0 0 0 1-1V9.5M2.5 9.5 4.8 4a1 1 0 0 1 .9-.6h12.6a1 1 0 0 1 .9.6l2.3 5.5a3 3 0 0 1-5.6 1.7 3 3 0 0 1-5.4 0 3 3 0 0 1-5.4 0 3 3 0 0 1-2.5-1.7ZM9.5 21v-6h5v6'),
  shop: S('M4 4h16v4a3 3 0 0 1-3 3 3 3 0 0 1-3-3 3 3 0 0 1-3 3 3 3 0 0 1-3-3 3 3 0 0 1-4 0ZM5 11v9h14v-9M10 20v-5h4v5'),
  package: S('M20.5 7.8v8.4a1.6 1.6 0 0 1-.8 1.4l-7 3.9a1.6 1.6 0 0 1-1.5 0l-7-3.9a1.6 1.6 0 0 1-.8-1.4V7.8a1.6 1.6 0 0 1 .8-1.4l7-3.8a1.6 1.6 0 0 1 1.5 0l7 3.8a1.6 1.6 0 0 1 .8 1.4ZM3.8 7 12 11.5 20.2 7M12 11.5V21'),
  box: `${R(3, 6.5, 18, 14, 2)}${S('M3 11h18M8 6.5V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2.5')}`,
  boxes: `${R(3, 3, 8, 8, 1.6)}${R(13, 3, 8, 8, 1.6)}${R(3, 13, 8, 8, 1.6)}${R(13, 13, 8, 8, 1.6)}`,
  truck: S('M2.5 6.5h11v10h-11zM13.5 10h4l3 3.2v3.3h-7zM6.5 20a1.9 1.9 0 1 0 0-3.8 1.9 1.9 0 0 0 0 3.8ZM17.5 20a1.9 1.9 0 1 0 0-3.8 1.9 1.9 0 0 0 0 3.8Z'),
  credit: `${R(2.5, 5, 19, 14, 2.4)}${S('M2.5 10h19M6.5 15h3')}`,
  wallet: S('M3.5 7.5A2 2 0 0 1 5.5 5.5h11a2 2 0 0 1 2 2M3.5 7.5v10a2 2 0 0 0 2 2h13a2 2 0 0 0 2-2v-3M3.5 7.5h15a2 2 0 0 1 2 2v1h-4.2a2.2 2.2 0 0 0 0 4.4H20.5'),
  banknote: `${R(2.5, 6, 19, 12, 2)}${C(12, 12, 2.6)}${S('M6 10v4M18 10v4')}`,
  rupee: S('M7 4h10M7 8.5h10M15.5 4c0 4.5-3 6.4-8.5 6.4l7.5 9.6'),
  coins: `${C(9, 9, 5.5)}${S('M14.6 5.4a5.5 5.5 0 0 1 0 13.2M6.5 18.6h9')}`,
  trending: S('M3 17.5 9.5 11l4 4L21 7.5M15.5 7.5H21v5.5'),
  'trending-down': S('M3 7.5 9.5 14l4-4L21 17.5M15.5 17.5H21V12'),

  /* people */
  user: `${C(12, 8, 3.8)}${S('M4.5 20.5a7.5 7.5 0 0 1 15 0')}`,
  'user-plus': `${C(10, 8, 3.8)}${S('M3 20.5a7 7 0 0 1 14 0M18.5 8v6M15.5 11h6')}`,
  users: `${C(9, 8, 3.4)}${S('M2.8 20a6.2 6.2 0 0 1 12.4 0M16.2 5.2a3.4 3.4 0 0 1 0 6.4M17.6 14.4A6.2 6.2 0 0 1 21.4 20')}`,
  'user-check': `${C(10, 8, 3.8)}${S('M3 20.5a7 7 0 0 1 14 0M16.5 12.5l2 2 4-4.5')}`,
  briefcase: `${R(3, 7.5, 18, 13, 2.2)}${S('M8.5 7.5V5.4a1.4 1.4 0 0 1 1.4-1.4h4.2a1.4 1.4 0 0 1 1.4 1.4v2.1M3 13h18')}`,
  building: `${R(4, 3, 16, 18, 1.6)}${S('M8 7h2M14 7h2M8 11h2M14 11h2M8 15h2M14 15h2M10 21v-3h4v3')}`,

  /* dashboard */
  chart: S('M4 20V10M10 20V4M16 20v-7M22 20H2'),
  'chart-line': S('M3.5 19.5h17M6 15.5l4-4.5 3.5 3L20 6.5'),
  pie: S('M12 3a9 9 0 1 0 9 9h-9z'),
  activity: S('M2.5 12.5h4L9 6l4.5 12 2.5-5.5h5.5'),
  target: `${C(12, 12, 8.5)}${C(12, 12, 4.6)}${C(12, 12, 1, 'fill="currentColor"')}`,
  layers: S('M12 3 3 7.8l9 4.8 9-4.8zM3 12.4l9 4.8 9-4.8M3 16.9l9 4.8 9-4.8'),
  bell: S('M18 8.6a6 6 0 1 0-12 0c0 6.4-2.4 8-2.4 8h16.8s-2.4-1.6-2.4-8M13.7 20.5a2 2 0 0 1-3.4 0'),
  settings: `${C(12, 12, 3.1)}${S('M19.6 14.4a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5v.2a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3.4a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9.4a1.6 1.6 0 0 0 1-1.5V3.4a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8v.1a1.6 1.6 0 0 0 1.5 1h.2a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1Z')}`,
  shield: S('M12 21.5s7.5-3.4 7.5-9.2V5.6L12 2.8 4.5 5.6v6.7c0 5.8 7.5 9.2 7.5 9.2Z'),
  'shield-check': S('M12 21.5s7.5-3.4 7.5-9.2V5.6L12 2.8 4.5 5.6v6.7c0 5.8 7.5 9.2 7.5 9.2ZM9 11.8l2.2 2.2 4-4.4'),
  lock: `${R(4.5, 10.5, 15, 10.5, 2.2)}${S('M8 10.5V7.4a4 4 0 0 1 8 0v3.1M12 15v2.5')}`,
  key: `${C(8, 15, 4)}${S('m10.9 12.1 8-8M17 6l2.5 2.5M14.5 8.5 17 11')}`,
  logout: S('M9.5 21H5.4a1.4 1.4 0 0 1-1.4-1.4V4.4A1.4 1.4 0 0 1 5.4 3h4.1M16 16.5 20.5 12 16 7.5M20.5 12H9.5'),
  login: S('M14.5 21h4.1a1.4 1.4 0 0 0 1.4-1.4V4.4a1.4 1.4 0 0 0-1.4-1.4h-4.1M9.5 16.5 5 12l4.5-4.5M5 12h11'),
  clock: `${C(12, 12, 9)}${S('M12 7v5.2l3.4 2')}`,
  calendar: `${R(3.5, 5, 17, 16, 2.2)}${S('M3.5 10h17M8 3v4M16 3v4')}`,
  'map-pin': S('M12 21.5s7-5.6 7-11a7 7 0 1 0-14 0c0 5.4 7 11 7 11Z'),
  phone: S('M21 16.9v2.6a1.8 1.8 0 0 1-2 1.8 17.6 17.6 0 0 1-7.7-2.7 17.3 17.3 0 0 1-5.3-5.3A17.6 17.6 0 0 1 3.3 5.5 1.8 1.8 0 0 1 5.1 3.5h2.6a1.8 1.8 0 0 1 1.8 1.6c.1 1 .4 1.9.7 2.8a1.8 1.8 0 0 1-.4 1.9l-1.1 1.1a14 14 0 0 0 5.3 5.3l1.1-1.1a1.8 1.8 0 0 1 1.9-.4c.9.3 1.8.6 2.8.7a1.8 1.8 0 0 1 1.6 1.8Z'),
  mail: `${R(2.5, 5, 19, 14, 2.2)}${S('m3.5 7 8.5 6 8.5-6')}`,
  message: S('M20.5 12a8 8 0 0 1-8 8 8.4 8.4 0 0 1-3.9-.9L3.5 20.5l1.4-5A8 8 0 0 1 12.5 4a8 8 0 0 1 8 8Z'),
  send: S('M21.5 3 2.8 10.4l7.4 2.9 2.9 7.4zM21.5 3 10.2 13.3'),
  globe: `${C(12, 12, 9)}${S('M3.2 9.5h17.6M3.2 14.5h17.6M12 3a15 15 0 0 1 0 18 15 15 0 0 1 0-18Z')}`,
  link: S('M10.5 13.5a4.2 4.2 0 0 0 6.3.5l2.4-2.4a4.2 4.2 0 0 0-6-6l-1.4 1.4M13.5 10.5a4.2 4.2 0 0 0-6.3-.5l-2.4 2.4a4.2 4.2 0 0 0 6 6l1.4-1.4'),
  image: `${R(3, 4.5, 18, 15, 2.2)}${C(8.6, 10, 1.7)}${S('m3.6 17.6 5-5 3.4 3.4 3-3 5.4 5.4')}`,
  camera: `${R(2.5, 6.5, 19, 13.5, 2.6)}${C(12, 13.2, 3.8)}${S('M8.4 6.5 9.7 4h4.6l1.3 2.5')}`,
  star: S('m12 3.2 2.7 5.6 6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1L3.2 9.7l6.1-.9z'),
  heart: S('M20.4 5.6a5 5 0 0 0-7.1 0L12 6.9l-1.3-1.3a5 5 0 1 0-7.1 7.1l8.4 8.4 8.4-8.4a5 5 0 0 0 0-7.1Z'),
  bookmark: S('M6 3.5h12v17l-6-4-6 4z'),
  flag: S('M5 21V4.5M5 4.5h11l-1.6 3.6L16 12H5'),
  award: `${C(12, 9, 5.6)}${S('m8.6 13.8-1.4 7.2 4.8-2.6 4.8 2.6-1.4-7.2')}`,
  rocket: S('M5.5 15.5c-1.6 1.6-2 6-2 6s4.4-.4 6-2c.9-.9.9-2.3 0-3.2a2.3 2.3 0 0 0-4-.8ZM9.8 14.2 6.5 10.9C8 6.4 12.4 3 18.5 2.5c1 6.4-2 11.4-6.6 13l-2.1-1.3ZM14.4 8.4a1.5 1.5 0 1 0 2.1-2.1 1.5 1.5 0 0 0-2.1 2.1Z'),
  cloud: S('M7 18.5h10.5a3.8 3.8 0 0 0 .3-7.6 5.6 5.6 0 0 0-10.8-1.3A4.3 4.3 0 0 0 7 18.5Z'),
  database: S('M12 8.2c4.4 0 8-1.3 8-2.9S16.4 2.4 12 2.4 4 3.7 4 5.3s3.6 2.9 8 2.9ZM4 5.3v13.4c0 1.6 3.6 2.9 8 2.9s8-1.3 8-2.9V5.3M4 12c0 1.6 3.6 2.9 8 2.9s8-1.3 8-2.9'),
  code: S('m8.5 17.5-5-5.5 5-5.5M15.5 6.5l5 5.5-5 5.5M13.5 4l-3 16'),
  file: S('M14 3.5H7.4a1.4 1.4 0 0 0-1.4 1.4v14.2a1.4 1.4 0 0 0 1.4 1.4h9.2a1.4 1.4 0 0 0 1.4-1.4V7.5zM14 3.5V7.5h4M9 13h6M9 16.5h4'),
  clipboard: `${R(8.5, 3, 7, 3.6, 1.2)}${S('M15.5 4.8h2a1.5 1.5 0 0 1 1.5 1.5v13.2a1.5 1.5 0 0 1-1.5 1.5h-11a1.5 1.5 0 0 1-1.5-1.5V6.3a1.5 1.5 0 0 1 1.5-1.5h2M9 12h6M9 16h4')}`,
  qr: `${R(3.5, 3.5, 6.5, 6.5, 1.4)}${R(14, 3.5, 6.5, 6.5, 1.4)}${R(3.5, 14, 6.5, 6.5, 1.4)}${S('M14 14h2.5v2.5H14zM18 18h2.5v2.5H18zM14 20.5h2M20.5 14v2')}`,

  /* theme */
  sun: `${C(12, 12, 4.2)}${S('M12 2.5v2.2M12 19.3v2.2M4.6 4.6l1.6 1.6M17.8 17.8l1.6 1.6M2.5 12h2.2M19.3 12h2.2M4.6 19.4l1.6-1.6M17.8 6.2l1.6-1.6')}`,
  moon: S('M20.5 14.3A8.6 8.6 0 0 1 9.7 3.5a8.6 8.6 0 1 0 10.8 10.8Z'),

  /* category glyphs (storefront) */
  smartphone: `${R(7, 2.5, 10, 19, 2.4)}${S('M11 18.4h2')}`,
  laptop: `${R(3.5, 5, 17, 11, 1.6)}${S('M2 19.5h20l-1.6-3H3.6z')}`,
  headphones: S('M4 15v-3a8 8 0 0 1 16 0v3'),
  watch: `${C(12, 12, 5.6)}${S('M9 2.5h6M9 21.5h6M12 9.4V12l1.8 1.2')}`,
  shirt: S('M8.6 2.6 4 5.2l1.9 3.6 1.6-.9v11.5h9V7.9l1.6.9L20 5.2l-4.6-2.6a3.4 3.4 0 0 1-6.8 0z'),
  shoe: S('M2 16.5h13.2a6.6 6.6 0 0 0 6.3-4.6l-3.6-1.2-2.6-4.2-3.4 2.1v4.1H2z'),
  grocery: `${R(4.5, 7.5, 15, 13, 2.4)}${S('M8.8 7.5V6a3.2 3.2 0 0 1 6.4 0v1.5')}`,
  decor: S('M9.5 2.5h5l-.8 3.4c2.6 1.4 4.3 4 4.3 7 0 4.6-3 8.6-6 8.6s-6-4-6-8.6c0-3 1.7-5.6 4.3-7z'),

  /* social */
  instagram: `${R(3, 3, 18, 18, 5)}${C(12, 12, 4)}${C(17.2, 6.8, 1.1, 'fill="currentColor"')}`,
  facebook: S('M14.5 8.5h2.6V5.2h-2.6a4.2 4.2 0 0 0-4.2 4.2v2H8v3.3h2.3V21h3.4v-6.3h2.4l.5-3.3h-2.9V9.8a1.3 1.3 0 0 1 1.3-1.3Z'),
  youtube: `${R(2.5, 5.5, 19, 13, 4)}${S('m10.5 9.4 4.6 2.6-4.6 2.6z')}`,
  twitter: S('M4 4l7 9.2L4.4 20h2.3l5.3-5.6L16.4 20H20l-7.2-9.5L19.3 4H17l-4.8 5.1L8.2 4z'),
  whatsapp: S('M3.5 20.5l1.3-4A8.4 8.4 0 1 1 8 20.2zM8.6 8.2c.3-.1.6 0 .8.4l.6 1.2c.1.2.1.5-.1.7l-.4.5c-.1.2-.2.4 0 .7a6 6 0 0 0 2.4 2.1c.3.1.5.1.7-.1l.5-.5c.2-.2.4-.2.6-.1l1.2.6c.3.2.4.5.3.8-.2.6-.9 1.2-1.7 1.2-1.6 0-4-1.6-5.3-3.4-.9-1.3-1.1-2.7-.7-3.6.2-.5.7-.9 1.1-1'),

  /* misc */
  play: S('M7 4.5l12 7.5-12 7.5z'),
  pause: S('M8.5 4.5v15M15.5 4.5v15'),
  dots: `${C(6, 12, 1.6, 'fill="currentColor" stroke="none"')}${C(12, 12, 1.6, 'fill="currentColor" stroke="none"')}${C(18, 12, 1.6, 'fill="currentColor" stroke="none"')}`,
  grid2: S('M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z'),

  /* added while wiring the page modules */
  monitor: `${R(2.5, 4, 19, 12.5, 2)}${S('M8.5 20.5h7M12 16.5v4')}`,
  palette: `${S('M12 3a9 9 0 1 0 0 18c1.2 0 1.9-.9 1.9-1.9 0-.6-.2-1-.6-1.4-.3-.4-.5-.7-.5-1.2 0-1 .8-1.7 1.8-1.7H16a5 5 0 0 0 5-5c0-3.9-4-6.8-9-6.8Z')}${C(7.6, 11.6, 1.1, 'fill="currentColor" stroke="none"')}${C(10, 7.8, 1.1, 'fill="currentColor" stroke="none"')}${C(14.6, 8, 1.1, 'fill="currentColor" stroke="none"')}${C(17.4, 11.4, 1.1, 'fill="currentColor" stroke="none"')}`,
  printer: `${R(6.5, 3, 11, 5.5, 1.4)}${R(3, 8.5, 18, 8, 2)}${R(6.5, 14, 11, 7, 1.4)}${C(17.6, 11.6, 0.9, 'fill="currentColor" stroke="none"')}`,
  'sticky-note': S('M5 4.5h14v9.8l-5.7 5.7H5z M19 14.3h-5.6v5.7'),
  bike: `${C(5.5, 17, 3.2)}${C(18.5, 17, 3.2)}${S('M8.7 17h5.1l3-7.6h-3.6M12.4 6.4h3.4l1.6 3')}`,
  /* aliases so page code can use the most natural name */
  x: S('M18 6 6 18M6 6l12 12'),
  'log-out': S('M15 4.5h3.5a1.5 1.5 0 0 1 1.5 1.5v12a1.5 1.5 0 0 1-1.5 1.5H15M10 8l-4 4 4 4M6 12h11'),
  'trending-up': S('M3 17.5 9 11.5l3.5 3.5L21 6.5M15.5 6.5H21v5.5'),
};

/** Injects the sprite once. Call from boot.js before rendering anything. */
export function mountIcons(scope = document.body) {
  if (document.getElementById('gbo-icons')) return;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('id', 'gbo-icons');
  svg.setAttribute('aria-hidden', 'true');
  svg.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden;pointer-events:none';
  svg.innerHTML = Object.entries(ICONS)
    .map(([name, body]) => `<symbol id="i-${name}" viewBox="0 0 24 24">${body}</symbol>`)
    .join('');
  scope.prepend(svg);
}

/**
 * icon('cart')                → <svg class="icon"><use href="#i-cart"/></svg>
 * icon('cart', 'icon-btn')    → adds classes
 * Safe to embed inside an html`` template via raw().
 */
export function icon(name, className = '', attrs = {}) {
  const cls = ['icon', className].filter(Boolean).join(' ');
  const extra = Object.entries(attrs)
    .map(([k, v]) => ` ${k}="${String(v).replace(/"/g, '&quot;')}"`)
    .join('');
  return `<svg class="${cls}" aria-hidden="true" focusable="false"${extra}><use href="#i-${name}"/></svg>`;
}

/** Escaped-for-template version: html`${iconRaw('cart')}` */
export const iconRaw = (name, className = '', attrs = {}) => raw(icon(name, className, attrs));

/** Applies the shared stroke presentation to every <use> based icon. */
export const ICON_STYLE = `
.icon{width:20px;height:20px;flex:none;fill:none;stroke:currentColor;stroke-width:1.9;stroke-linecap:round;stroke-linejoin:round}
.icon-fill{fill:currentColor;stroke:none}
`;

export function mountIconStyle() {
  if (document.getElementById('gbo-icon-style')) return;
  const style = document.createElement('style');
  style.id = 'gbo-icon-style';
  style.textContent = ICON_STYLE;
  document.head.append(style);
}

export default { ICONS, icon, iconRaw, mountIcons, mountIconStyle };
