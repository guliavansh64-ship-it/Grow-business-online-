/**
 * charts.js — dependency-free SVG charts (spec §14, §38).
 *
 * A chart library CDN would add 200 KB+ and an external request to every
 * dashboard load. These render crisp, themeable, accessible SVG in ~5 KB and
 * pick their colours straight from the design tokens, so they re-colour
 * automatically for dark mode and for each vendor's brand palette.
 */
import { money, num, esc, html, raw } from './utils.js';

const NS = 'http://www.w3.org/2000/svg';

function svgEl(tag, attrs = {}) {
  const node = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  return node;
}

const niceMax = (value) => {
  if (value <= 0) return 10;
  const exp = Math.floor(Math.log10(value));
  const base = 10 ** exp;
  const norm = value / base;
  const step = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10;
  return step * base;
};

function attachTooltip(host, points, formatter) {
  let tip = host.querySelector('.chart-tooltip');
  if (!tip) {
    tip = document.createElement('div');
    tip.className = 'chart-tooltip';
    host.style.position = 'relative';
    host.append(tip);
  }
  const svg = host.querySelector('svg');
  if (!svg) return;

  const move = (event) => {
    const rect = svg.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * 100;
    let nearest = points[0];
    let best = Infinity;
    for (const p of points) {
      const d = Math.abs(p.xPct - x);
      if (d < best) {
        best = d;
        nearest = p;
      }
    }
    if (!nearest) return;
    tip.innerHTML = html`<div>${nearest.label}</div><div class="sub">${raw(formatter(nearest))}</div>`;
    tip.style.left = `${nearest.xPct}%`;
    tip.style.top = `${nearest.yPct}%`;
    tip.classList.add('is-on');
    svg.querySelectorAll('.chart-cursor').forEach((c) => {
      c.setAttribute('x1', nearest.x);
      c.setAttribute('x2', nearest.x);
      c.setAttribute('y1', 0);
      c.setAttribute('y2', '100%');
      c.style.opacity = '0.55';
    });
    svg.querySelectorAll('.chart-dot').forEach((d) => d.setAttribute('r', d.dataset.x === String(nearest.x) ? '6' : '0'));
  };
  svg.addEventListener('mousemove', move);
  svg.addEventListener('touchmove', (e) => move(e.touches[0]), { passive: true });
  svg.addEventListener('mouseleave', () => {
    tip.classList.remove('is-on');
    svg.querySelectorAll('.chart-cursor').forEach((c) => (c.style.opacity = '0'));
  });
}

/* ------------------------------------------------------------- line chart */

/**
 * lineChart(node, [{label, value}], { format, height, area })
 */
export function lineChart(node, data = [], opts = {}) {
  if (!node) return null;
  const { height = 220, format = (v) => num(v), valueLabel = 'Value', area = true, color = 'var(--brand)' } = opts;
  if (!data.length) {
    node.innerHTML = `<div class="empty empty-sm"><div class="art">${''}</div><p class="muted">No data for this period yet.</p></div>`;
    return null;
  }

  const W = 1000;
  const H = height;
  const padL = 8;
  const padR = 8;
  const padT = 16;
  const padB = 28;
  const values = data.map((d) => Number(d.value) || 0);
  const max = niceMax(Math.max(...values, 1));
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;
  const x = (i) => padL + (data.length === 1 ? innerW / 2 : (i / (data.length - 1)) * innerW);
  const y = (v) => padT + innerH - (v / max) * innerH;

  const uid = `lc${Math.random().toString(36).slice(2, 8)}`;
  const path = data.map((d, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(Number(d.value) || 0).toFixed(1)}`).join(' ');
  const areaPath = `${path} L${x(data.length - 1).toFixed(1)},${(padT + innerH).toFixed(1)} L${x(0).toFixed(1)},${(padT + innerH).toFixed(1)} Z`;

  const gridLines = 4;
  const grid = Array.from({ length: gridLines + 1 }, (_, i) => {
    const gy = padT + (innerH / gridLines) * i;
    const value = max - (max / gridLines) * i;
    return `<line class="chart-grid" x1="${padL}" y1="${gy.toFixed(1)}" x2="${W - padR}" y2="${gy.toFixed(1)}"/>
            <text class="chart-label" x="${padL}" y="${(gy - 6).toFixed(1)}">${esc(format(value))}</text>`;
  }).join('');

  const labelEvery = Math.max(1, Math.ceil(data.length / 7));
  const labels = data
    .map((d, i) => (i % labelEvery === 0 || i === data.length - 1 ? `<text class="chart-label" x="${x(i).toFixed(1)}" y="${H - 8}" text-anchor="middle">${esc(d.label || '')}</text>` : ''))
    .join('');

  const dots = data
    .map((d, i) => `<circle class="chart-dot" data-x="${x(i).toFixed(1)}" cx="${x(i).toFixed(1)}" cy="${y(Number(d.value) || 0).toFixed(1)}" r="${i === data.length - 1 ? 5 : 0}"/>`)
    .join('');

  node.innerHTML = `
    <svg class="chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Line chart of ${esc(valueLabel)}">
      <defs>
        <linearGradient id="${uid}" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="${color}" stop-opacity="0.28"/>
          <stop offset="1" stop-color="${color}" stop-opacity="0"/>
        </linearGradient>
      </defs>
      ${grid}
      <line class="chart-cursor" y1="0" y2="${H}" x1="0" x2="0"/>
      ${area ? `<path d="${areaPath}" fill="url(#${uid})"/>` : ''}
      <path class="chart-line" d="${path}" style="stroke:${color}" vector-effect="non-scaling-stroke"/>
      ${dots}
      ${labels}
    </svg>`;

  const points = data.map((d, i) => ({
    x: x(i).toFixed(1),
    xPct: (x(i) / W) * 100,
    yPct: (y(Number(d.value) || 0) / H) * 100,
    label: d.label || '',
    value: Number(d.value) || 0,
    extra: d.extra,
  }));
  attachTooltip(node, points, (p) => `${esc(format(p.value))}${p.extra ? ` · ${esc(p.extra)}` : ''}`);
  return { max, points };
}

/* -------------------------------------------------------------- bar chart */

export function barChart(node, data = [], opts = {}) {
  if (!node) return null;
  const { height = 220, format = (v) => num(v), valueLabel = 'Orders', color = 'var(--brand)' } = opts;
  if (!data.length) {
    node.innerHTML = `<p class="muted text-sm">No data for this period yet.</p>`;
    return null;
  }
  const W = 1000;
  const H = height;
  const padT = 14;
  const padB = 28;
  const padX = 6;
  const max = niceMax(Math.max(...data.map((d) => Number(d.value) || 0), 1));
  const innerH = H - padT - padB;
  const slot = W / data.length;
  const barW = Math.min(46, slot * 0.56);
  const uid = `bc${Math.random().toString(36).slice(2, 8)}`;

  const bars = data
    .map((d, i) => {
      const v = Number(d.value) || 0;
      const h = Math.max(2, (v / max) * innerH);
      const bx = i * slot + (slot - barW) / 2;
      const by = padT + innerH - h;
      return `<rect class="chart-bar" x="${bx.toFixed(1)}" y="${by.toFixed(1)}" width="${barW.toFixed(1)}" height="${h.toFixed(1)}" rx="5" fill="url(#${uid})"/>`;
    })
    .join('');

  const labelEvery = Math.max(1, Math.ceil(data.length / 8));
  const labels = data
    .map((d, i) =>
      i % labelEvery === 0 || i === data.length - 1
        ? `<text class="chart-label" x="${(i * slot + slot / 2).toFixed(1)}" y="${H - 8}" text-anchor="middle">${esc(d.label || '')}</text>`
        : ''
    )
    .join('');

  const grid = Array.from({ length: 4 }, (_, i) => {
    const gy = padT + (innerH / 3) * i;
    return `<line class="chart-grid" x1="0" y1="${gy.toFixed(1)}" x2="${W}" y2="${gy.toFixed(1)}"/>`;
  }).join('');

  node.innerHTML = `
    <svg class="chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Bar chart of ${esc(valueLabel)}">
      <defs><linearGradient id="${uid}" x1="0" y1="1" x2="0" y2="0">
        <stop offset="0" stop-color="${color}" stop-opacity="0.55"/><stop offset="1" stop-color="${color}"/>
      </linearGradient></defs>
      ${grid}${bars}${labels}
      <line class="chart-cursor" y1="0" y2="${H}" x1="0" x2="0" style="opacity:0"/>
    </svg>`;

  const points = data.map((d, i) => ({
    x: (i * slot + slot / 2).toFixed(1),
    xPct: ((i * slot + slot / 2) / W) * 100,
    yPct: 40,
    label: d.label || '',
    value: Number(d.value) || 0,
    extra: d.extra,
  }));
  attachTooltip(node, points, (p) => `${esc(format(p.value))}${p.extra ? ` · ${esc(p.extra)}` : ''}`);
  return points;
}

/* ------------------------------------------------------------ donut chart */

export function donutChart(node, items = [], opts = {}) {
  if (!node) return null;
  const { size = 180, thickness = 22, format = (v) => num(v), centerLabel = 'Total', palette = ['#6D5EF6', '#0EA5E9', '#16A34A', '#F59E0B', '#EC4899', '#14B8A6', '#8B5CF6', '#F97316'] } = opts;
  const total = items.reduce((a, i) => a + (Number(i.value) || 0), 0);
  if (!total) {
    node.innerHTML = `<p class="muted text-sm">Nothing to show yet.</p>`;
    return null;
  }
  const r = (size - thickness) / 2;
  const c = 2 * Math.PI * r;
  let offset = 0;
  const segs = items
    .map((item, i) => {
      const value = Number(item.value) || 0;
      const frac = value / total;
      const dash = `${(frac * c).toFixed(2)} ${c.toFixed(2)}`;
      const seg = `<circle class="donut-seg" cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none"
        stroke="${item.color || palette[i % palette.length]}" stroke-width="${thickness}"
        stroke-dasharray="${dash}" stroke-dashoffset="${(-offset).toFixed(2)}" stroke-linecap="butt">
        <title>${esc(item.name)}: ${esc(format(value))}</title></circle>`;
      offset += frac * c;
      return seg;
    })
    .join('');

  node.innerHTML = `
    <div class="donut-wrap">
      <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" role="img" aria-label="Donut chart">
        <g transform="rotate(-90 ${size / 2} ${size / 2})">${segs}</g>
        <text x="50%" y="47%" text-anchor="middle" class="donut-value">${esc(format(total))}</text>
        <text x="50%" y="60%" text-anchor="middle" class="donut-label">${esc(centerLabel)}</text>
      </svg>
      <ul class="donut-legend">
        ${items
          .map(
            (item, i) => `<li><span class="swatch" style="background:${item.color || palette[i % palette.length]}"></span>
              <span class="nm">${esc(item.name)}</span>
              <span class="vl">${esc(format(item.value))}</span>
              <span class="pc">${Math.round(((Number(item.value) || 0) / total) * 100)}%</span></li>`
          )
          .join('')}
      </ul>
    </div>`;
  return { total };
}

/* ----------------------------------------------------------- horizontal bars */

export function hBars(node, items = [], opts = {}) {
  if (!node) return null;
  const { format = (v) => num(v), max: forcedMax = null } = opts;
  if (!items.length) {
    node.innerHTML = `<p class="muted text-sm">Nothing to show yet.</p>`;
    return null;
  }
  const max = forcedMax || Math.max(...items.map((i) => Number(i.value) || 0), 1);
  node.innerHTML = `<div class="hbars">${items
    .map(
      (i) => `<div class="hbar">
        <div class="hbar-top"><span class="hbar-name">${esc(i.name)}</span><span class="hbar-val">${esc(format(i.value))}</span></div>
        <div class="progress ${i.variant ? `progress-${i.variant}` : ''}"><span style="width:${Math.max(2, ((Number(i.value) || 0) / max) * 100).toFixed(1)}%"></span></div>
      </div>`
    )
    .join('')}</div>`;
}

/* ------------------------------------------------------------- sparkline */

export function sparkline(values = [], { width = 120, height = 34, color = 'var(--brand)' } = {}) {
  if (!values.length) return '';
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const range = max - min || 1;
  const pts = values.map((v, i) => {
    const x = (i / Math.max(1, values.length - 1)) * width;
    const y = height - ((v - min) / range) * (height - 4) - 2;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  return `<svg class="spark" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" aria-hidden="true">
    <polyline points="${pts.join(' ')}" fill="none" stroke="${color}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" opacity="0.9"/>
    <circle cx="${pts[pts.length - 1].split(',')[0]}" cy="${pts[pts.length - 1].split(',')[1]}" r="2.8" fill="${color}"/>
  </svg>`;
}

export const moneyFormat = (v) => money(v, { decimals: 0 });
export const compactMoney = (v) => money(v, { compact: true });

export default { lineChart, barChart, donutChart, hBars, sparkline, moneyFormat, compactMoney };
