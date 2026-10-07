/**
 * notifications.js — the notification centre (spec §26).
 *
 * Main platform: polls the custom backend and paints the bell + preview.
 * Other apps:    push comes from Firebase Cloud Messaging (see firebase.js).
 */
import cfg from './config.js';
import Api from './api.js';
import { state as auth } from './auth.js';
import { $, timeAgo, sentence, html, raw, esc, url, el } from './utils.js';
import { icon } from './icons.js';
import { paintNotificationPreview, notifIcon } from './layout.js';
import { toast } from './ui.js';

let timer = null;
let lastSeen = null;

export function notificationKind(n) {
  return n.type || 'system';
}

/** Fetches + paints the bell. Safe to call from any signed-in page. */
export async function refreshNotifications({ silent = false } = {}) {
  if (!auth.user) return null;
  const isVendor = auth.user.role === 'vendor' || auth.user.role === 'super_admin';
  try {
    const data = await (isVendor ? Api.vendorNotifications({ limit: 20 }) : Api.customerNotifications({ limit: 20 }));
    const items = Array.isArray(data) ? data : data.items || [];
    const unread = items.filter((n) => !n.readAt).length;
    paintNotificationPreview(items, unread);

    // Announce genuinely new items (not on first paint).
    if (!silent && lastSeen !== null && unread > lastSeen) {
      const newest = items.find((n) => !n.readAt);
      if (newest) toast(newest.body || '', { title: newest.title, type: 'info', duration: 5000 });
    }
    lastSeen = unread;
    return { items, unread };
  } catch {
    return null;
  }
}

export function startNotificationPolling(intervalMs = cfg.notificationPollMs) {
  stopNotificationPolling();
  refreshNotifications({ silent: true });
  timer = setInterval(() => refreshNotifications({ silent: true }), intervalMs);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) refreshNotifications({ silent: true });
  });
}

export function stopNotificationPolling() {
  if (timer) clearInterval(timer);
  timer = null;
}

export async function markRead(ids = []) {
  const isVendor = auth.user?.role === 'vendor' || auth.user?.role === 'super_admin';
  try {
    if (isVendor) await Api.markNotificationsRead(ids);
    else await Api.markCustomerNotificationsRead(ids);
    await refreshNotifications({ silent: true });
    return true;
  } catch {
    return false;
  }
}

/* ---------------------------------------------------- notification centre UI */

export function renderNotificationCenter(container, items = []) {
  if (!container) return;
  if (!items.length) {
    container.innerHTML = html`
      <div class="empty">
        <div class="art">${raw(icon('bell'))}</div>
        <h3>No notifications yet</h3>
        <p>Order updates, payouts and platform announcements will appear here as soon as they happen.</p>
      </div>`;
    return;
  }
  container.innerHTML = html`
    <div class="notif-list">
      ${items.map(
        (n) => html`
        <article class="notif-card ${n.readAt ? '' : 'is-unread'}" data-id="${n.id}">
          <span class="notif-ico kind-${notificationKind(n)}">${raw(icon(notifIcon(n.type)))}</span>
          <div class="notif-main">
            <div class="row row-between row-wrap">
              <strong>${n.title}</strong>
              <time class="dim text-xs" datetime="${n.createdAt}">${timeAgo(n.createdAt)}</time>
            </div>
            <p class="muted text-sm">${n.body || ''}</p>
            <div class="row mt-2">
              <span class="badge badge-outline">${sentence(notificationKind(n))}</span>
              ${n.link ? html`<a class="btn btn-sm btn-ghost" href="${url(n.link)}">Open ${raw(icon('arrow-right'))}</a>` : ''}
              ${!n.readAt ? html`<button type="button" class="btn btn-sm btn-ghost" data-mark-read="${n.id}">Mark read</button>` : ''}
            </div>
          </div>
        </article>`
      )}
    </div>`;

  container.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-mark-read]');
    if (btn) await markRead([btn.dataset.markRead]);
  });
}

export default { refreshNotifications, startNotificationPolling, stopNotificationPolling, markRead, renderNotificationCenter };
