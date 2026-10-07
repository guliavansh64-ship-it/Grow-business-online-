/**
 * _dashBase.js — shared bootstrap for every vendor-console page.
 *
 * Enforces the lifecycle (spec §9): a vendor who has not paid the deposit is
 * sent to /deposit.html, one inside the 48h window sees the activation banner,
 * and only an activated store can trade.
 */
import Api from '../api.js';
import cfg from '../config.js';
import { guard, state as auth } from '../auth.js';
import { mountDashboardChrome, paintDashboardIdentity } from '../layout.js';
import { startNotificationPolling } from '../notifications.js';
import { $, url, html, raw } from '../utils.js';
import { icon } from '../icons.js';
import { sentence } from '../utils.js';

export async function dashPage({ active, title, subtitle = '', actions = '', roles = ['vendor'], allowPendingActivation = true } = {}) {
  const st = await guard({ roles });

  // Super admins live in the platform console.
  if (st.user.role === 'super_admin') {
    globalThis.location.replace(url('admin/index.html'));
    return new Promise(() => {});
  }

  const shell = mountDashboardChrome({ active, title, subtitle, actions });

  let me = null;
  try {
    me = await Api.vendorMe();
  } catch (err) {
    if (err.status === 403 || err.status === 404) {
      globalThis.location.replace(url('deposit.html'));
      return new Promise(() => {});
    }
    throw err;
  }

  const vendor = me.vendor;
  if (vendor.status === 'pending_deposit') {
    globalThis.location.replace(url('deposit.html'));
    return new Promise(() => {});
  }
  if (vendor.status === 'pending_activation' && !allowPendingActivation) {
    globalThis.location.replace(url('activation.html'));
    return new Promise(() => {});
  }

  paintDashboardIdentity(vendor, st.user, { commissionPercent: vendor.commissionPercent ?? cfg.commissionPercent });
  startNotificationPolling();
  document.title = `${title} · ${vendor.name} | ${cfg.brand.shortName}`;

  if (vendor.status === 'pending_activation') renderActivationBanner(me.activation);
  if (!vendor.logo && active !== 'settings') renderSetupHint();

  return { auth: st, vendor, me, shell, scroll: $('[data-app-scroll]'), cfg };
}

function renderActivationBanner(activation) {
  const scroll = $('[data-app-scroll]');
  if (!scroll || $('[data-activation-banner]')) return;
  const due = activation?.dueAt ? new Date(activation.dueAt) : null;
  const hours = due ? Math.max(0, Math.round((due.getTime() - Date.now()) / 3600000)) : null;
  const banner = document.createElement('div');
  banner.dataset.activationBanner = '';
  banner.className = 'alert alert-warning';
  banner.innerHTML = html`
    ${raw(icon('clock'))}
    <div class="a-body">
      <strong>Your store is being activated</strong>
      ${hours !== null
        ? `Setup finishes in about ${hours} hour${hours === 1 ? '' : 's'}. You can add products and brand your store right now.`
        : 'Finish your setup while we prepare your storefront.'}
      <div class="row mt-2">
        <a class="btn btn-sm btn-secondary" href="${url('activation.html')}">View countdown</a>
        <a class="btn btn-sm btn-ghost" href="${url('admin/settings.html')}">Complete store setup</a>
      </div>
    </div>`;
  scroll.prepend(banner);
}

function renderSetupHint() {
  const scroll = $('[data-app-scroll]');
  if (!scroll || $('[data-setup-hint]')) return;
  const hint = document.createElement('div');
  hint.dataset.setupHint = '';
  hint.className = 'alert alert-brand';
  hint.innerHTML = html`
    ${raw(icon('sparkles'))}
    <div class="a-body">
      <strong>Finish your store branding</strong>
      Add a logo, banner and theme colour so customers recognise your store.
      <div class="row mt-2"><a class="btn btn-sm btn-primary" href="${url('admin/settings.html')}">Open store settings</a></div>
    </div>`;
  scroll.prepend(hint);
}

/** Small helper so each page can render into the scroll area consistently. */
export function section(title, bodyHtml, { subtitle = '', actions = '', id = '' } = {}) {
  return html`
    <section class="card card-pad" ${id ? `id="${id}"` : ''}>
      ${title
        ? html`<div class="card-head" style="padding:0 0 var(--sp-4); margin-bottom:var(--sp-4)">
            <div><h3>${title}</h3>${subtitle ? html`<div class="sub">${subtitle}</div>` : ''}</div>
            ${actions ? html`<div class="row">${raw(actions)}</div>` : ''}
          </div>`
        : ''}
      ${raw(bodyHtml)}
    </section>`;
}

export const statusSentence = sentence;
export { auth };
export default { dashPage, section };
