/**
 * ui.js — the interaction layer: toasts, modals, drawers, skeletons, empty
 * states, accordions, dropdowns, tabs, confirm dialogs and the global
 * "API failed" toast (spec §34, §35, §36).
 */
import { $, $$, on, delegate, esc, html, raw, el, debounce, throttle } from './utils.js';
import { icon } from './icons.js';
import { friendlyMessage } from './api.js';

/* ================================================================ toasts */

let toastHost = null;

function host() {
  if (!toastHost) {
    toastHost = $('.toast-host') || el('div', { class: 'toast-host', role: 'status', 'aria-live': 'polite' });
    if (!toastHost.parentNode) document.body.append(toastHost);
  }
  return toastHost;
}

const TOAST_ICONS = { success: 'check-circle', error: 'alert-circle', warning: 'alert-triangle', info: 'info' };

export function toast(message, { type = 'info', title = '', duration = 4200, action = null } = {}) {
  const node = el('div', { class: `toast toast-${type}`, role: type === 'error' ? 'alert' : 'status' });
  node.innerHTML = html`
    ${raw(icon(TOAST_ICONS[type] || 'info', 't-icon'))}
    <div class="t-body">
      ${title ? html`<div class="t-title">${title}</div>` : ''}
      <div class="t-msg">${message}</div>
      ${action ? html`<button type="button" class="btn btn-sm btn-soft mt-2" data-act>${action.label}</button>` : ''}
    </div>
    <button type="button" class="t-close" aria-label="Dismiss">${raw(icon('close'))}</button>`;

  host().append(node);
  const close = () => {
    if (!node.isConnected) return;
    node.classList.add('is-out');
    setTimeout(() => node.remove(), 240);
  };
  node.querySelector('.t-close').addEventListener('click', close);
  node.querySelector('[data-act]')?.addEventListener('click', () => {
    action.onClick?.();
    close();
  });
  const timer = setTimeout(close, duration);
  node.addEventListener('mouseenter', () => clearTimeout(timer));
  return close;
}

export const toastSuccess = (m, o = {}) => toast(m, { ...o, type: 'success' });
export const toastError = (m, o = {}) => toast(m, { ...o, type: 'error', duration: o.duration ?? 6000 });
export const toastWarn = (m, o = {}) => toast(m, { ...o, type: 'warning' });
export const toastInfo = (m, o = {}) => toast(m, { ...o, type: 'info' });

/** Any uncaught API error becomes a friendly toast unless the caller handles it. */
export function bindApiErrors() {
  document.addEventListener('api:error', (e) => {
    const { code, message } = e.detail || {};
    if (code === 'unauthorized') return; // api.js redirects for this
    toastError(friendlyMessage({ code, message }));
  });
}

/* ================================================================ modals */

const openModals = [];

export function modal({ title = '', description = '', body = '', footer = '', size = '', onMount = null, onClose = null, dismissible = true }) {
  const backdrop = el('div', { class: 'modal-backdrop', role: 'dialog', 'aria-modal': 'true', 'aria-label': title || 'Dialog' });
  backdrop.innerHTML = html`
    <div class="modal ${size && !String(size).startsWith('modal-') ? `modal-${size}` : size}">
      <div class="modal-head">
        <div>
          ${title ? html`<h3>${title}</h3>` : ''}
          ${description ? html`<p>${description}</p>` : ''}
        </div>
        <button type="button" class="icon-btn ghost" data-close aria-label="Close">${raw(icon('close'))}</button>
      </div>
      <div class="modal-body">${raw(body)}</div>
      ${footer ? html`<div class="modal-foot">${raw(footer)}</div>` : ''}
    </div>`;
  document.body.append(backdrop);
  document.body.style.overflow = 'hidden';
  requestAnimationFrame(() => backdrop.classList.add('is-open'));

  const close = (result) => {
    backdrop.classList.remove('is-open');
    document.body.style.overflow = '';
    setTimeout(() => backdrop.remove(), 220);
    const i = openModals.indexOf(close);
    if (i > -1) openModals.splice(i, 1);
    document.removeEventListener('keydown', onKey);
    onClose?.(result);
  };
  const onKey = (e) => {
    if (e.key === 'Escape' && dismissible) close(null);
    if (e.key === 'Tab') trapFocus(backdrop, e);
  };

  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop && dismissible) close(null);
    if (e.target.closest('[data-close]')) close(null);
  });
  document.addEventListener('keydown', onKey);
  openModals.push(close);

  const api = { root: backdrop, close, body: $('.modal-body', backdrop), footer: $('.modal-foot', backdrop) };
  onMount?.(api);
  setTimeout(() => $('[data-autofocus]', backdrop)?.focus() || $('.modal-body input, .modal-body button, .modal-body select', backdrop)?.focus(), 120);
  return api;
}

export function confirmDialog({ title = 'Are you sure?', message = '', confirmLabel = 'Confirm', cancelLabel = 'Cancel', danger = false }) {
  return new Promise((resolve) => {
    let settled = false;
    const m = modal({
      title,
      size: 'modal-sm',
      body: html`<p class="muted">${message}</p>`,
      footer: html`
        <button type="button" class="btn btn-secondary" data-no>${cancelLabel}</button>
        <button type="button" class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-yes>${confirmLabel}</button>`,
      onClose: () => {
        if (!settled) resolve(false);
      },
      onMount: ({ root, close }) => {
        $('[data-no]', root).addEventListener('click', () => {
          settled = true;
          close();
          resolve(false);
        });
        $('[data-yes]', root).addEventListener('click', () => {
          settled = true;
          close();
          resolve(true);
        });
      },
    });
    return m;
  });
}

function trapFocus(container, e) {
  const focusables = $$('a[href], button:not(:disabled), input:not([type="hidden"]), select, textarea, [tabindex]:not([tabindex="-1"])', container).filter(
    (n) => n.offsetParent !== null
  );
  if (!focusables.length) return;
  const first = focusables[0];
  const last = focusables[focusables.length - 1];
  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault();
    first.focus();
  }
}

/* =============================================================== drawers */

export function drawer({ title = '', body = '', footer = '', side = 'right', onMount = null, onClose = null, size = '' }) {
  const backdrop = el('div', { class: 'drawer-backdrop' });
  const panel = el('aside', {
    class: `drawer ${side === 'left' ? 'drawer-left' : ''} ${size}`,
    role: 'dialog',
    'aria-modal': 'true',
    'aria-label': title || 'Panel',
    style: size === 'drawer-wide' ? 'width:min(560px,100%)' : '',
  });
  panel.innerHTML = html`
    <div class="drawer-head">
      <h3 style="font-size:1.06rem">${title}</h3>
      <button type="button" class="icon-btn ghost" data-close aria-label="Close">${raw(icon('close'))}</button>
    </div>
    <div class="drawer-body">${raw(body)}</div>
    ${footer ? html`<div class="drawer-foot">${raw(footer)}</div>` : ''}`;
  document.body.append(backdrop, panel);
  document.body.style.overflow = 'hidden';
  requestAnimationFrame(() => {
    backdrop.classList.add('is-open');
    panel.classList.add('is-open');
  });

  const close = () => {
    backdrop.classList.remove('is-open');
    panel.classList.remove('is-open');
    document.body.style.overflow = '';
    setTimeout(() => {
      backdrop.remove();
      panel.remove();
    }, 340);
    document.removeEventListener('keydown', onKey);
    onClose?.();
  };
  const onKey = (e) => {
    if (e.key === 'Escape') close();
    if (e.key === 'Tab') trapFocus(panel, e);
  };
  backdrop.addEventListener('click', close);
  panel.addEventListener('click', (e) => e.target.closest('[data-close]') && close());
  document.addEventListener('keydown', onKey);

  const api = { root: panel, close, body: $('.drawer-body', panel), footer: $('.drawer-foot', panel) };
  onMount?.(api);
  return api;
}

/* ============================================================= skeletons */

export const skeletonCard = () => html`
  <div class="sk-card">
    <div class="skeleton sk-img"></div>
    <div style="padding:14px">
      <div class="skeleton sk-title"></div>
      <div class="skeleton sk-text" style="width:80%"></div>
      <div class="skeleton sk-text" style="width:45%"></div>
    </div>
  </div>`;

export const skeletonGrid = (count = 8) => html`${Array.from({ length: count }, () => skeletonCard())}`;

export const skeletonRows = (count = 6) => html`${Array.from({ length: count }, () => html`<div class="skeleton sk-row"></div>`)}`;

export const skeletonText = (lines = 3) => html`${Array.from({ length: lines }, (_, i) => html`<div class="skeleton sk-text" style="width:${100 - i * 12}%"></div>`)}`;

export const skeletonKpis = (count = 4) =>
  html`${Array.from({ length: count }, () => html`<div class="card card-pad"><div class="skeleton sk-text" style="width:40%"></div><div class="skeleton" style="height:28px;width:60%;border-radius:8px"></div></div>`)}`;

export function setLoading(container, loading, skeleton = skeletonRows(5)) {
  if (!container) return;
  if (loading) {
    container.dataset.prevHtml = container.innerHTML;
    container.innerHTML = skeleton;
    container.setAttribute('aria-busy', 'true');
  } else {
    container.removeAttribute('aria-busy');
  }
}

/* ========================================================== empty states */

/**
 * Empty states. `action` may be a link ({ href }) or a callback ({ onClick }) —
 * callbacks are parked in a registry and fired by one delegated listener, so an
 * empty state can be injected with innerHTML and still be interactive.
 */
const emptyActions = new Map();
let emptyActionSeq = 0;

export function emptyState({ icon: iconName = 'box', title = 'Nothing here yet', message = '', action = null, small = false } = {}) {
  let actionHtml = '';
  if (action) {
    const variant = action.variant || 'btn-primary';
    if (action.href) {
      actionHtml = html`<a class="btn ${variant}" href="${action.href}">${action.label}</a>`;
    } else {
      const id = `ea${++emptyActionSeq}`;
      if (typeof action.onClick === 'function') emptyActions.set(id, action.onClick);
      actionHtml = html`<button type="button" class="btn ${variant}" data-empty-action="${id}">${action.label}</button>`;
    }
  }
  return html`
    <div class="empty ${small ? 'empty-sm' : ''}">
      <div class="art">${raw(icon(iconName))}</div>
      <h3>${title}</h3>
      ${message ? html`<p>${message}</p>` : ''}
      ${raw(actionHtml)}
    </div>`;
}

/** Single delegated handler for every empty-state action button. */
export function bindEmptyActions(scope = document) {
  scope.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-empty-action]');
    if (!btn) return;
    const fn = emptyActions.get(btn.dataset.emptyAction);
    if (fn) {
      e.preventDefault();
      fn();
    }
  });
}

/* ============================================================ accordions */

export function bindAccordions(scope = document) {
  delegate(scope, '.acc-head', 'click', (e, head) => {
    const acc = head.closest('.accordion');
    const body = $('.acc-body', acc);
    const isOpen = acc.classList.contains('is-open');
    // Close siblings inside the same group when data-exclusive is set.
    if (!isOpen && acc.parentElement?.dataset.exclusive !== undefined) {
      $$('.accordion.is-open', acc.parentElement).forEach((other) => {
        other.classList.remove('is-open');
        $('.acc-body', other).style.maxHeight = '0px';
      });
    }
    acc.classList.toggle('is-open', !isOpen);
    body.style.maxHeight = isOpen ? '0px' : `${body.scrollHeight + 24}px`;
  });
}

/* ============================================================= dropdowns */

export function bindDropdowns(scope = document) {
  delegate(scope, '[data-dropdown-toggle]', 'click', (e, btn) => {
    e.stopPropagation();
    const dd = btn.closest('.dropdown');
    const willOpen = !dd.classList.contains('is-open');
    $$('.dropdown.is-open', document).forEach((o) => o.classList.remove('is-open'));
    dd.classList.toggle('is-open', willOpen);
    btn.setAttribute('aria-expanded', String(willOpen));
  });
  document.addEventListener('click', () => $$('.dropdown.is-open').forEach((d) => d.classList.remove('is-open')));
  document.addEventListener('keydown', (e) => e.key === 'Escape' && $$('.dropdown.is-open').forEach((d) => d.classList.remove('is-open')));
}

/* ================================================================== tabs */

export function bindTabs(scope = document, onChange = null) {
  delegate(scope, '[data-tab]', 'click', (e, tab) => {
    e.preventDefault();
    const group = tab.closest('[data-tabs]') || tab.parentElement;
    const name = tab.dataset.tab;
    $$('[data-tab]', group).forEach((t) => {
      t.classList.toggle('is-active', t === tab);
      t.setAttribute('aria-selected', String(t === tab));
    });
    const host = group.dataset.target ? $(group.dataset.target) : document;
    $$('[data-panel]', host).forEach((p) => p.classList.toggle('hidden', p.dataset.panel !== name));
    onChange?.(name, tab);
  });
}

/* ============================================================ copy button */

export function bindCopyButtons(scope = document) {
  delegate(scope, '[data-copy]', 'click', async (e, btn) => {
    const text = btn.dataset.copy;
    try {
      await navigator.clipboard.writeText(text);
      const old = btn.innerHTML;
      btn.innerHTML = icon('check') + '<span>Copied</span>';
      btn.classList.add('btn-success');
      setTimeout(() => {
        btn.innerHTML = old;
        btn.classList.remove('btn-success');
      }, 1600);
    } catch {
      toastError('Could not copy to the clipboard.');
    }
  });
}

/* ====================================================== scroll utilities */

export function bindStickyHeader(selector = '[data-sticky-header]') {
  const header = $(selector);
  if (!header) return;
  const onScroll = throttle(() => header.classList.toggle('is-stuck', globalThis.scrollY > 12), 80);
  globalThis.addEventListener('scroll', onScroll, { passive: true });
  onScroll();
}

export function bindBackToTop() {
  const btn = $('[data-back-to-top]');
  if (!btn) return;
  const onScroll = throttle(() => btn.classList.toggle('is-visible', globalThis.scrollY > 600), 100);
  globalThis.addEventListener('scroll', onScroll, { passive: true });
  btn.addEventListener('click', () => globalThis.scrollTo({ top: 0, behavior: 'smooth' }));
  onScroll();
}

export function bindRevealOnScroll(scope = document) {
  const nodes = $$('.reveal', scope);
  if (!('IntersectionObserver' in globalThis)) return nodes.forEach((n) => n.classList.add('is-visible'));
  const io = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry, index) => {
        if (!entry.isIntersecting) return;
        setTimeout(() => entry.target.classList.add('is-visible'), index * 55);
        io.unobserve(entry.target);
      });
    },
    { rootMargin: '0px 0px -6% 0px', threshold: 0.05 }
  );
  nodes.forEach((n) => io.observe(n));
}

/** Animates [data-count-up] elements the first time they scroll into view. */
export function bindCountUp(scope = document, format = (n) => Math.round(n).toLocaleString('en-IN')) {
  const nodes = $$('[data-count-up]', scope);
  if (!nodes.length) return;
  const run = (node) => {
    const to = Number(node.dataset.countUp || 0);
    const suffix = node.dataset.suffix || '';
    const prefix = node.dataset.prefix || '';
    const duration = Number(node.dataset.duration || 1100);
    const start = performance.now();
    const tick = (now) => {
      const p = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      node.textContent = `${prefix}${format(to * eased)}${suffix}`;
      if (p < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  };
  if (!('IntersectionObserver' in globalThis)) return nodes.forEach(run);
  const io = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        run(entry.target);
        io.unobserve(entry.target);
      }
    });
  });
  nodes.forEach((n) => io.observe(n));
}

/* ========================================================== button state */

/**
 * Wraps an async action with a loading state on the clicked button and a
 * single error toast. Keeps every form handler down to two lines.
 */
export async function withButtonState(button, action, { loadingText = null } = {}) {
  if (!button || button.classList.contains('is-loading')) return undefined;
  const original = button.innerHTML;
  button.classList.add('is-loading');
  button.setAttribute('aria-busy', 'true');
  if (loadingText) button.dataset.label = loadingText;
  try {
    return await action();
  } catch (err) {
    toastError(friendlyMessage(err), { title: err?.details ? 'Please review the form' : '' });
    return undefined;
  } finally {
    button.classList.remove('is-loading');
    button.removeAttribute('aria-busy');
    button.innerHTML = original;
  }
}

export const busy = (node, isBusy) => {
  if (!node) return;
  node.classList.toggle('is-loading', !!isBusy);
  node.setAttribute('aria-busy', String(!!isBusy));
};

/* ============================================================== utilities */

export function bindPasswordToggles(scope = document) {
  delegate(scope, '[data-toggle-password]', 'click', (e, btn) => {
    const input = $(btn.dataset.togglePassword) || btn.closest('.input-group')?.querySelector('input');
    if (!input) return;
    const shown = input.type === 'text';
    input.type = shown ? 'password' : 'text';
    btn.innerHTML = icon(shown ? 'eye-off' : 'eye');
    btn.setAttribute('aria-label', shown ? 'Show password' : 'Hide password');
  });
}

export function bindSmoothScroll(scope = document) {
  delegate(scope, 'a[href^="#"]', 'click', (e, link) => {
    const id = link.getAttribute('href');
    if (!id || id === '#') return;
    const target = $(id);
    if (!target) return;
    e.preventDefault();
    target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    history.replaceState(null, '', id);
  });
}

/** Boots every generic behaviour. Called once from boot.js. */
export function initUI() {
  bindEmptyActions();
  bindApiErrors();
  bindAccordions();
  bindDropdowns();
  bindTabs();
  bindCopyButtons();
  bindStickyHeader();
  bindBackToTop();
  bindRevealOnScroll();
  bindCountUp();
  bindPasswordToggles();
  bindSmoothScroll();

  // Close any open drawer/modal when the viewport resizes to desktop.
  globalThis.addEventListener('resize', debounce(() => {
    if (globalThis.innerWidth > 1024) $$('[data-mobile-only-open].is-open').forEach((n) => n.classList.remove('is-open'));
  }, 200));
}

export default { toast, modal, drawer, confirmDialog, emptyState, initUI, setLoading, withButtonState };
