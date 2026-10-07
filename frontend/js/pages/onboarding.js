/**
 * pages/onboarding.js — the two screens between "account created" and "selling".
 *
 *   §11 Security deposit  → status is owned by the payment gateway, never the UI
 *   §12 Two-day activation → countdown driven by a SERVER timestamp, not Date.now()
 */
import Api, { friendlyMessage } from '../api.js';
import cfg from '../config.js';
import { guard, state as auth } from '../auth.js';
import { $, $$, url, html, raw, esc, money, splitDuration, sleep, on } from '../utils.js';
import { icon } from '../icons.js';
import { toast, toastSuccess, toastError, withButtonState, emptyState } from '../ui.js';
import { statusBadge, DEPOSIT_TONE } from '../components.js';

/* ================================================================ deposit */

export async function deposit() {
  await guard({ roles: ['vendor'] });
  const host = $('[data-deposit-host]');
  if (!host) return;

  host.innerHTML = depositSkeleton();
  let data;
  try {
    data = await Api.deposit();
  } catch (err) {
    host.innerHTML = emptyState({ icon: 'alert-triangle', title: 'Could not load your deposit', message: friendlyMessage(err), action: { label: 'Try again', href: url('deposit.html') } });
    return;
  }

  const { deposit: dep, activation, explainer, paymentMethods, statuses } = data;
  renderDeposit(host, { dep, activation, explainer, paymentMethods, statuses, vendor: data.vendor });
}

const depositSkeleton = () => `
  <div class="pay-card">
    <div class="pay-head"><div class="skeleton sk-title" style="margin:0 auto 14px"></div><div class="skeleton" style="height:52px;width:60%;margin:0 auto;border-radius:12px"></div></div>
    <div class="pay-body"><div class="skeleton sk-row"></div><div class="skeleton sk-row"></div><div class="skeleton sk-btn"></div></div>
  </div>`;

function renderDeposit(host, { dep, activation, explainer, paymentMethods, statuses, vendor }) {
  const isPaid = ['approved', 'paid'].includes(dep.status);
  const isRefunded = dep.status === 'refunded';
  const isRejected = dep.status === 'rejected';

  host.innerHTML = html`
    <div class="pay-card">
      <div class="pay-head">
        <span class="eyebrow">${raw(icon('shield-check'))} Step 2 of 4</span>
        <h1 class="mt-4">Security Deposit</h1>
        <div class="pay-amount mt-4">${money(dep.amountPaise, { decimals: 0 })}</div>
        <p class="muted mt-2">${explainer?.title || 'Refundable security deposit'} required to activate your online store.</p>
        <div class="row mt-4" style="justify-content:center">
          ${statusBadge(dep.status, DEPOSIT_TONE)}
          ${vendor ? html`<span class="badge badge-outline">${vendor.name}</span>` : ''}
        </div>
      </div>

      <div class="pay-body">
        ${isPaid
          ? html`
            <div class="alert alert-success">${raw(icon('check-circle'))}
              <div class="a-body"><strong>Payment confirmed</strong>
                Your deposit was verified by the payment gateway${dep.confirmedAt ? ` on ${esc(new Date(dep.confirmedAt).toLocaleString('en-IN'))}` : ''}. Reference: <span class="mono">${dep.reference || '—'}</span>
              </div>
            </div>
            <a class="btn btn-primary btn-lg btn-block mt-6" href="${url('activation.html')}">Continue to store activation ${raw(icon('arrow-right'))}</a>`
          : isRejected
            ? html`<div class="alert alert-danger">${raw(icon('x-circle'))}<div class="a-body"><strong>Deposit rejected</strong>${dep.note || 'Please contact support to resolve this.'}</div></div>
                  <a class="btn btn-secondary btn-block mt-4" href="${url('pages/contact.html')}">Contact support</a>`
            : isRefunded
              ? html`<div class="alert alert-info">${raw(icon('info'))}<div class="a-body"><strong>Deposit refunded</strong>Your store has been closed and the refundable deposit returned.</div></div>`
              : html`
                <ul class="check-list">
                  ${(explainer?.points || []).map((p) => html`<li>${raw(icon('check', ''))}<span>${p}</span></li>`)}
                </ul>

                <hr class="divider"/>

                <form data-deposit-form>
                  <label class="label mb-2">Choose a payment method</label>
                  <div class="pay-methods">
                    ${(paymentMethods || []).map((m, i) => html`
                      <label class="pay-option ${i === 0 ? 'is-selected' : ''}">
                        <input type="radio" name="method" value="${m.id}" ${i === 0 ? 'checked' : ''} class="sr-only"/>
                        <span class="po-ico">${raw(icon(payIcon(m.id)))}</span>
                        <span class="po-body"><strong>${m.label}</strong><span>${m.note || ''}</span></span>
                        <span class="po-check">${raw(icon('check-circle'))}</span>
                      </label>`)}
                  </div>

                  <div class="alert alert-info mt-6">${raw(icon('lock'))}
                    <div class="a-body"><strong>You cannot mark this payment as complete</strong>
                      Only the payment gateway can confirm a deposit. This page will wait for the gateway and update automatically.
                    </div>
                  </div>

                  <button type="submit" class="btn btn-primary btn-lg btn-block mt-6">${raw(icon('credit'))} Pay ${money(dep.amountPaise, { decimals: 0 })} securely</button>

                  <div class="secure-note">${raw(icon('shield-check'))} 256-bit encrypted · Refundable on closure · GST invoice provided</div>
                </form>

                <div class="hidden mt-6" data-awaiting>
                  <div class="alert alert-brand">
                    <span class="spinner"></span>
                    <div class="a-body">
                      <strong>Waiting for payment confirmation</strong>
                      <span data-await-text>Do not close this tab. We are listening for the gateway callback…</span>
                      <div class="progress progress-sm mt-2"><span style="width:100%;animation:load-slide 1.4s ease-in-out infinite"></span></div>
                    </div>
                  </div>
                  <div class="row mt-4" style="gap:10px">
                    <button type="button" class="btn btn-secondary btn-sm" data-recheck>${raw(icon('refresh'))} Check status</button>
                    <button type="button" class="btn btn-ghost btn-sm" data-cancel-await>Cancel</button>
                  </div>
                  ${cfg.features.demoMode ? html`
                    <div class="demo-box mt-4">
                      <div class="t">${raw(icon('zap'))} Development sandbox</div>
                      <p class="hint">No payment gateway is connected yet. This button replays the gateway's server-to-server callback so you can test the full activation flow. It is disabled automatically when <span class="mono">NODE_ENV=production</span>.</p>
                      <button type="button" class="btn btn-sm btn-dark mt-2" data-simulate>${raw(icon('play'))} Simulate successful payment</button>
                    </div>` : ''}
                </div>`}

        <div class="mt-8">
          <h4 class="upper muted mb-2">Deposit lifecycle</h4>
          <div class="pay-status-list">
            ${(statuses || []).map((s) => html`<span class="badge ${s === dep.status ? DEPOSIT_TONE[s] || 'badge-brand' : 'badge-outline'}"><span class="dotmark"></span>${s[0].toUpperCase() + s.slice(1)}</span>`)}
          </div>
        </div>
      </div>
    </div>`;

  bindDepositInteractions(host, dep);
}

const payIcon = (id) => ({ upi: 'smartphone', card: 'credit', netbanking: 'building', cod: 'banknote' })[id] || 'credit';

function bindDepositInteractions(host, dep) {
  // Payment method selection
  $$('.pay-option', host).forEach((opt) => {
    opt.addEventListener('click', () => {
      $$('.pay-option', host).forEach((o) => o.classList.remove('is-selected'));
      opt.classList.add('is-selected');
      const input = $('input', opt);
      if (input) input.checked = true;
    });
  });

  const form = $('[data-deposit-form]', host);
  const awaiting = $('[data-awaiting]', host);
  let pollTimer = null;

  const stopPolling = () => {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = null;
  };

  const startPolling = async () => {
    stopPolling();
    if (form) form.classList.add('hidden');
    awaiting?.classList.remove('hidden');
    let ticks = 0;
    pollTimer = setInterval(async () => {
      ticks += 1;
      const txt = $('[data-await-text]', host);
      if (txt) txt.textContent = `Do not close this tab. Waiting for the gateway… (${ticks * 4}s)`;
      try {
        const fresh = await Api.deposit();
        if (['approved', 'paid'].includes(fresh.deposit.status)) {
          stopPolling();
          toastSuccess('Payment confirmed! Your 48 hour activation has started.', { duration: 5000 });
          setTimeout(() => globalThis.location.replace(url('activation.html')), 900);
        } else if (['rejected', 'refunded'].includes(fresh.deposit.status)) {
          stopPolling();
          renderDeposit(host, { ...fresh, dep: fresh.deposit });
        }
      } catch {
        /* keep polling — a transient network error must not lose the payment */
      }
    }, 4000);
  };

  form?.addEventListener('submit', (e) => {
    e.preventDefault();
    const btn = form.querySelector('[type="submit"]');
    const method = form.querySelector('input[name="method"]:checked')?.value || 'upi';
    withButtonState(btn, async () => {
      try {
        const data = await Api.initiateDeposit(method);
        toast(`Payment initiated — reference ${data.deposit.reference || ''}`, { type: 'info' });
        await startPolling();
      } catch (err) {
        toastError(err.message);
      }
    });
  });

  $('[data-recheck]', host)?.addEventListener('click', async (e) => {
    await withButtonState(e.currentTarget, async () => {
      const fresh = await Api.deposit();
      renderDeposit(host, { ...fresh, dep: fresh.deposit });
      toast('Status refreshed.', { type: 'info', duration: 1800 });
    });
  });

  $('[data-cancel-await]', host)?.addEventListener('click', () => {
    stopPolling();
    awaiting?.classList.add('hidden');
    form?.classList.remove('hidden');
  });

  $('[data-simulate]', host)?.addEventListener('click', async (e) => {
    await withButtonState(e.currentTarget, async () => {
      try {
        await Api.simulatePayment(dep.id);
        stopPolling();
        toastSuccess('Gateway callback received. Deposit approved ✅', { duration: 4000 });
        setTimeout(() => globalThis.location.replace(url('activation.html')), 900);
      } catch (err) {
        toastError(`${err.message} (simulation is disabled when DEV_TOOLS=false)`);
      }
    });
  });

  // If the deposit is already "processing" when the page loads, resume polling.
  if (dep.status === 'processing') startPolling();
}

/* ============================================================= activation */

export async function activation() {
  await guard({ roles: ['vendor'] });
  const host = $('[data-activation-host]');
  if (!host) return;
  host.innerHTML = `<div class="pay-card"><div class="pay-body"><div class="skeleton sk-row"></div><div class="skeleton sk-row"></div><div class="skeleton sk-row"></div></div></div>`;

  let data;
  try {
    data = await Api.activation();
  } catch (err) {
    if (err.status === 403) {
      globalThis.location.replace(url('deposit.html'));
      return;
    }
    host.innerHTML = emptyState({ icon: 'alert-triangle', title: 'Could not load activation status', message: friendlyMessage(err), action: { label: 'Try again', href: url('activation.html') } });
    return;
  }

  if (data.status === 'pending_deposit') {
    globalThis.location.replace(url('deposit.html'));
    return;
  }

  renderActivation(host, data);
}

function renderActivation(host, data) {
  /**
   * Server-time drift correction (spec §12): the countdown is computed from the
   * timestamp the API returned, and re-synced periodically, so changing the
   * device clock cannot shorten the activation window.
   */
  let drift = Date.now() - new Date(data.serverTime).getTime();
  const dueMs = data.activationDueAt ? new Date(data.activationDueAt).getTime() : null;

  host.innerHTML = html`
    <div class="pay-card">
      <div class="pay-head">
        ${data.ready
          ? html`<div class="celebrate">
              <div class="emoji">🎉</div>
              <h1 class="mt-4">Store Ready!</h1>
              <p class="muted mt-2">${data.name} is live and accepting orders.</p>
              <div class="row mt-6" style="justify-content:center;flex-wrap:wrap">
                <a class="btn btn-primary btn-lg" href="${url(`vendor/index.html?vendor=${data.slug}`)}" target="_blank" rel="noopener">${raw(icon('store'))} Open Store</a>
                <a class="btn btn-secondary btn-lg" href="${url('admin/dashboard.html')}">${raw(icon('grid'))} Open Vendor Dashboard</a>
              </div>
              <p class="hint mt-4">Your public address: <span class="mono" data-store-url>${data.slug}.${cfg.rootDomain}</span>
                <button type="button" class="btn btn-sm btn-ghost" data-copy="${data.slug}.${cfg.rootDomain}">${raw(icon('copy'))} Copy</button>
              </p>
            </div>`
          : html`
            <span class="eyebrow">${raw(icon('clock'))} Step 3 of 4</span>
            <h1 class="mt-4">Store Activation</h1>
            <p class="muted mt-2">Your store is being prepared. We verify your business, provision your subdomain and publish your storefront.</p>
            <div class="countdown" data-countdown>
              ${['Days', 'Hours', 'Minutes', 'Seconds'].map((l) => html`<div class="cd-cell"><div class="v" data-cd="${l[0].toLowerCase()}">--</div><div class="l">${l}</div></div>`)}
            </div>
            <p class="hint text-center">Window: ${data.activationDueAt ? esc(new Date(data.activationDueAt).toLocaleString('en-IN')) : '—'} · Server-verified</p>`}
      </div>

      <div class="pay-body">
        <h4 class="upper muted mb-4">Activation checklist</h4>
        <ul class="check-list" data-checklist>
          ${(data.checklist || []).map((item) => html`
            <li class="${item.done ? 'is-done' : ''}">
              <span class="tick">${raw(icon(item.done ? 'check' : 'loader'))}</span>
              <span>${item.label}</span>
            </li>`)}
        </ul>

        ${!data.ready
          ? html`
            <hr class="divider"/>
            <h4 class="upper muted mb-2">Use this time to get ready</h4>
            <div class="grid g-2 mt-4">
              <a class="card card-pad card-hover" href="${url('admin/settings.html')}">
                <span class="kpi-ico kpi-brand" style="display:grid;place-items:center;width:38px;height:38px;border-radius:12px;background:var(--brand-soft);color:var(--brand-strong);margin-bottom:12px">${raw(icon('settings'))}</span>
                <h4>Brand your store</h4>
                <p class="muted text-sm mt-2">Logo, banner, theme colour and opening hours.</p>
              </a>
              <a class="card card-pad card-hover" href="${url('admin/products.html')}">
                <span style="display:grid;place-items:center;width:38px;height:38px;border-radius:12px;background:var(--success-soft);color:var(--success);margin-bottom:12px">${raw(icon('package'))}</span>
                <h4>Add products</h4>
                <p class="muted text-sm mt-2">Upload your catalogue with prices and stock.</p>
              </a>
            </div>
            <div class="alert alert-info mt-6">${raw(icon('info'))}
              <div class="a-body"><strong>You can work while you wait</strong>
                The dashboard is fully usable during activation — only the public storefront stays hidden until the timer ends.</div>
            </div>
            <div class="row mt-6" style="flex-wrap:wrap">
              <a class="btn btn-primary" href="${url('admin/dashboard.html')}">${raw(icon('grid'))} Go to dashboard</a>
              <button type="button" class="btn btn-secondary" data-refresh>${raw(icon('refresh'))} Refresh status</button>
              <a class="btn btn-ghost" href="${url('admin/support.html')}">${raw(icon('message'))} Need help?</a>
            </div>`
          : ''}
      </div>
    </div>`;

  // Copy buttons
  $$('[data-copy]', host).forEach((btn) => {
    btn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(btn.dataset.copy);
        toast('Copied to clipboard.', { type: 'success', duration: 1800 });
      } catch {
        toastError('Could not copy.');
      }
    });
  });

  $('[data-refresh]', host)?.addEventListener('click', async (e) => {
    await withButtonState(e.currentTarget, async () => {
      const fresh = await Api.activation();
      drift = Date.now() - new Date(fresh.serverTime).getTime();
      renderActivation(host, fresh);
    });
  });

  if (data.ready) return;

  /* ---------------------------------------------------- countdown ticking */
  const cells = { d: $('[data-cd="d"]', host), h: $('[data-cd="h"]', host), m: $('[data-cd="m"]', host), s: $('[data-cd="s"]', host) };
  const pad = (n) => String(n).padStart(2, '0');

  const tick = () => {
    if (!dueMs) return;
    const remaining = dueMs - (Date.now() - drift);
    const parts = splitDuration(remaining);
    cells.d.textContent = pad(parts.d);
    cells.h.textContent = pad(parts.h);
    cells.m.textContent = pad(parts.m);
    cells.s.textContent = pad(parts.s);
    $$('.cd-cell', host).forEach((c) => c.classList.toggle('is-done', parts.done));

    if (parts.done) {
      clearInterval(interval);
      clearInterval(resync);
      // Ask the server to flip the store to live — never do it in the browser.
      Api.activation()
        .then((fresh) => {
          renderActivation(host, fresh);
          if (fresh.ready) toastSuccess('Your store is live! 🎉', { duration: 6000 });
        })
        .catch(() => {
          host.innerHTML = emptyState({ icon: 'refresh', title: 'Almost there', message: 'We could not confirm activation just now. Please refresh in a moment.', action: { label: 'Refresh', href: url('activation.html') } });
        });
    }
  };

  const interval = setInterval(tick, 1000);
  // Re-sync drift every 30s so a sleeping laptop cannot drift the timer.
  const resync = setInterval(async () => {
    try {
      const fresh = await Api.activation();
      drift = Date.now() - new Date(fresh.serverTime).getTime();
      if (fresh.ready) {
        clearInterval(interval);
        clearInterval(resync);
        renderActivation(host, fresh);
      }
    } catch {
      /* ignore transient errors */
    }
  }, 30000);

  tick();
}

export default { deposit, activation };
