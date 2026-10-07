/**
 * pages/money.js — Payments, Balance and Withdrawals (spec §24–§26).
 *
 * Hard rule: this module only DISPLAYS money. Available balance, commission and
 * settlement are all computed by the server; nothing here can add to a balance,
 * change a commission or mark a payment as received.
 */
import Api, { friendlyMessage } from '../api.js';
import cfg from '../config.js';
import { $, $$, url, html, raw, esc, money, num, compactNumber, dateShort, dateTime, timeAgo, qget } from '../utils.js';
import { readForm, paintErrors, validators } from '../utils.js';
import { icon } from '../icons.js';
import { toast, toastSuccess, toastError, withButtonState, emptyState, setLoading, modal, confirmDialog } from '../ui.js';
import { donutChart, hBars, compactMoney } from '../charts.js';
import { table, paginationBar, statusBadge, ORDER_TONE, PAYMENT_TONE, WITHDRAWAL_TONE, DEPOSIT_TONE, kpiGrid, moneySplit, infoRow, summaryRows } from '../components.js';
import { dashPage } from './_dashBase.js';

/* ============================================================== payments */

export async function payments() {
  const page = await dashPage({
    active: 'payments',
    title: 'Payments',
    subtitle: 'Every rupee that moved through your store',
    actions: html`<a class="btn btn-secondary btn-sm" href="${url('admin/withdrawals.html')}">${raw(icon('banknote'))} Withdrawals</a>`,
  });
  if (!page) return;
  const { scroll } = page;

  scroll.innerHTML = html`
    <div data-pay-kpis class="mb-6"></div>

    <div class="dash-grid dash-main mt-6">
      <div class="card card-pad">
        <div class="card-head" style="padding:0 0 var(--sp-4);margin-bottom:var(--sp-4)">
          <div><h3 class="h4">Settled orders</h3><div class="sub">Delivered orders are settled automatically</div></div>
          <div class="chip-row" data-pay-filter>
            <button type="button" class="chip is-active" data-pay-status="all">All</button>
            <button type="button" class="chip" data-pay-status="paid">Paid</button>
            <button type="button" class="chip" data-pay-status="pending">Payment pending</button>
            <button type="button" class="chip" data-pay-status="refunded">Refunded</button>
          </div>
        </div>
        <div data-pay-table><div class="skeleton sk-row"></div><div class="skeleton sk-row"></div></div>
        <div class="mt-4" data-pay-pagination></div>
      </div>

      <div class="stack">
        <div class="card card-pad">
          <h3 class="h4 mb-4">Where the money goes</h3>
          <div class="donut-wrap" data-pay-split></div>
        </div>
        <div class="card card-pad">
          <h3 class="h4 mb-4">Commission example</h3>
          <div data-pay-example><div class="skeleton sk-row"></div></div>
        </div>
        <div class="card card-pad">
          <h3 class="h4 mb-4">Security deposit</h3>
          <div data-pay-deposit><div class="skeleton sk-row"></div></div>
        </div>
      </div>
    </div>

    <div class="card mt-6">
      <div class="card-head"><div><h3 class="h4">Ledger</h3><div class="sub">Server-written entries. Newest first.</div></div></div>
      <div data-pay-ledger><div class="card-pad"><div class="skeleton sk-row"></div></div></div>
    </div>`;

  let filter = qget('payment') || 'all';
  let page_ = 1;

  const loadOrders = async () => {
    const host = $('[data-pay-table]');
    setLoading(host, true, '<div class="skeleton sk-row"></div><div class="skeleton sk-row"></div>');
    try {
      const res = await Api.paged('/vendor/orders', { paymentStatus: filter === 'all' ? '' : filter, page: page_, limit: 10 });
      if (!res.items.length) {
        host.innerHTML = emptyState({ icon: 'credit', title: 'No payments here', message: 'Nothing matches this payment filter yet.', small: true });
      } else {
        host.innerHTML = table({
          columns: [
            { key: 'orderNumber', label: 'Order', render: (o) => html`<a class="mono ink" href="${url(`admin/order-detail.html?id=${o.id}`)}">${o.orderNumber}</a>` },
            { key: 'customer', label: 'Customer', render: (o) => html`<span class="text-sm">${o.customer?.name || 'Guest'}</span>` },
            { key: 'paymentMethod', label: 'Method', render: (o) => html`<span class="badge badge-outline">${(o.paymentMethod || '').toUpperCase()}</span>` },
            { key: 'totalPaise', label: 'Collected', align: 'right', render: (o) => html`<strong class="ink">${money(o.totalPaise)}</strong>` },
            { key: 'commissionPaise', label: 'Commission', align: 'right', render: (o) => html`<span class="text-warning">− ${money(o.commissionPaise)}</span>` },
            { key: 'vendorPaise', label: 'You receive', align: 'right', render: (o) => html`<strong class="text-success">${money(o.vendorPaise)}</strong>` },
            { key: 'paymentStatus', label: 'Status', render: (o) => statusBadge(o.paymentStatus, PAYMENT_TONE) },
            { key: 'placedAt', label: 'Date', render: (o) => html`<span class="muted text-sm">${dateShort(o.placedAt)}</span>` },
          ],
          rows: res.items,
          dense: true,
        });
      }
      $('[data-pay-pagination]').innerHTML = res.pagination ? paginationBar(res.pagination) : '';
      setLoading(host, false);
    } catch (err) {
      setLoading(host, false);
      host.innerHTML = emptyState({ icon: 'alert-triangle', title: 'Could not load payments', message: friendlyMessage(err), small: true });
    }
  };

  $$('[data-pay-status]').forEach((chip) => chip.addEventListener('click', () => {
    $$('[data-pay-status]').forEach((c) => c.classList.remove('is-active'));
    chip.classList.add('is-active');
    filter = chip.dataset.payStatus;
    page_ = 1;
    loadOrders();
  }));
  $('[data-pay-pagination]').addEventListener('click', (e) => {
    const link = e.target.closest('[data-page]');
    if (!link || link.getAttribute('aria-disabled') === 'true') return;
    e.preventDefault();
    page_ = Number(link.dataset.page);
    loadOrders();
  });

  /* ------------------------------------------------ balance + charts */
  try {
    const bal = await Api.balance();
    $('[data-pay-kpis]').innerHTML = kpiGrid([
      { label: 'Collected (lifetime)', value: money(bal.lifetimeGrossPaise, { decimals: 0 }), sub: `${num(bal.settledOrders)} settled orders`, icon: 'credit', tone: 'brand' },
      { label: 'Your earnings', value: money(bal.earnedPaise, { decimals: 0 }), sub: 'After commission', icon: 'wallet', tone: 'success' },
      { label: 'Commission paid', value: money(bal.commissionPaise, { decimals: 0 }), sub: `${bal.commissionPercent}% platform fee`, icon: 'percent', tone: 'warning' },
      { label: 'Paid out', value: money(bal.withdrawnPaise, { decimals: 0 }), sub: `To your bank / UPI`, icon: 'banknote', tone: 'info' },
    ]);

    donutChart($('[data-pay-split]'), [
      { name: 'You keep', value: bal.earnedPaise },
      { name: 'Platform commission', value: bal.commissionPaise },
      { name: 'In flight', value: bal.pendingPaise },
    ], { centerLabel: 'Order value', format: (v) => compactMoney(v) });
    const legend = $('[data-pay-split]');
    if (legend && !$('.donut-legend', legend)) {
      const el = document.createElement('div');
      el.className = 'donut-legend';
      el.innerHTML = [['You keep', bal.earnedPaise, '#16A34A'], ['Commission', bal.commissionPaise, '#D97706'], ['In flight', bal.pendingPaise, '#6D5EF6']]
        .map(([n, v, c]) => `<span><i style="background:${c}"></i>${n} · ${esc(money(v, { decimals: 0 }))}</span>`).join('');
      legend.appendChild(el);
    }

    $('[data-pay-example]').innerHTML = bal.example
      ? moneySplit({ grossPaise: bal.example.orderAmountPaise, commissionPaise: bal.example.commissionPaise, vendorPaise: bal.example.vendorAmountPaise, percent: bal.example.percent })
      : `<p class="muted text-sm">No settled orders yet — the split appears after your first delivery.</p>`;

    $('[data-pay-ledger]').innerHTML = bal.ledger?.length
      ? table({
          columns: [
            { key: 'at', label: 'When', render: (l) => html`<span class="muted text-sm">${dateTime(l.at)}</span>` },
            { key: 'kind', label: 'Entry', render: (l) => html`<span class="badge badge-soft">${esc(String(l.kind).replace(/_/g, ' '))}</span>` },
            { key: 'note', label: 'Note', render: (l) => html`<span class="text-sm">${l.note || '—'}</span>` },
            { key: 'creditPaise', label: 'Credit', align: 'right', render: (l) => (l.creditPaise ? html`<strong class="text-success">+ ${money(l.creditPaise)}</strong>` : '<span class="muted">—</span>') },
            { key: 'debitPaise', label: 'Debit', align: 'right', render: (l) => (l.debitPaise ? html`<strong class="text-danger">− ${money(l.debitPaise)}</strong>` : '<span class="muted">—</span>') },
          ],
          rows: bal.ledger,
          dense: true,
        })
      : `<div class="card-pad">${emptyState({ icon: 'list', title: 'No ledger entries yet', message: 'Settled orders and payouts are recorded here automatically.', small: true })}</div>`;
  } catch (err) {
    $('[data-pay-kpis]').innerHTML = emptyState({ icon: 'alert-triangle', title: 'Could not load balances', message: friendlyMessage(err) });
  }

  /* -------------------------------------------------------- deposit card */
  try {
    const dep = await Api.deposit();
    const d = dep.deposit || {};
    $('[data-pay-deposit]').innerHTML = html`
      <div class="row row-between">
        <div><strong class="ink">${money(d.amountPaise || 0, { decimals: 0 })}</strong><span class="muted text-sm" style="display:block">Refundable security deposit</span></div>
        ${statusBadge(d.status, DEPOSIT_TONE)}
      </div>
      <div class="mt-4">
        ${infoRow('Reference', d.reference || '—', { mono: true })}
        ${infoRow('Method', d.method ? String(d.method).toUpperCase() : '—')}
        ${infoRow('Confirmed', d.confirmedAt ? dateShort(d.confirmedAt) : 'Not yet')}
      </div>
      <p class="hint mt-3">Returned in full when you close the store in good standing.</p>
      <a class="btn btn-ghost btn-sm mt-2" href="${url('deposit.html')}">${raw(icon('external'))} Deposit details</a>`;
  } catch {
    $('[data-pay-deposit]').innerHTML = `<p class="muted text-sm">Deposit details are unavailable.</p>`;
  }

  loadOrders();
}

/* =============================================================== balance */

export async function balance() {
  const page = await dashPage({
    active: 'balance',
    title: 'Balance',
    subtitle: 'What you have earned, what is on hold, what you can withdraw',
    actions: html`<a class="btn btn-primary btn-sm" href="${url('admin/withdrawals.html')}">${raw(icon('banknote'))} Request payout</a>`,
  });
  if (!page) return;
  const { scroll } = page;

  scroll.innerHTML = `<div class="skeleton sk-card" style="height:180px"></div><div class="skeleton sk-card mt-4" style="height:260px"></div>`;

  let bal;
  try {
    bal = await Api.balance();
  } catch (err) {
    scroll.innerHTML = emptyState({ icon: 'alert-triangle', title: 'Could not load your balance', message: friendlyMessage(err), action: { label: 'Try again', href: url('admin/balance.html') } });
    return;
  }

  scroll.innerHTML = html`
    <div class="balance-hero card card-pad">
      <div>
        <span class="eyebrow">${raw(icon('wallet'))} Available to withdraw</span>
        <div class="balance-amount">${money(bal.availablePaise, { decimals: 2 })}</div>
        <p class="muted mt-2">Payouts usually arrive in ${bal.payoutDays}. Minimum ${money(bal.minWithdrawalPaise, { decimals: 0 })}.</p>
        <div class="row mt-4" style="gap:8px;flex-wrap:wrap">
          <a class="btn btn-primary" href="${url('admin/withdrawals.html')}">${raw(icon('banknote'))} Request payout</a>
          <a class="btn btn-secondary" href="${url('admin/payments.html')}">${raw(icon('list'))} Payment history</a>
        </div>
      </div>
      <div class="balance-breakdown">
        ${infoRow('Pending (orders in progress)', money(bal.pendingPaise, { decimals: 0 }))}
        ${infoRow('Reserved (payouts in review)', money(bal.reservedPaise, { decimals: 0 }))}
        ${infoRow('Total earnings', money(bal.earnedPaise, { decimals: 0 }))}
        ${infoRow('Platform commission paid', money(bal.commissionPaise, { decimals: 0 }))}
        ${infoRow('Already withdrawn', money(bal.withdrawnPaise, { decimals: 0 }))}
        ${infoRow('Lifetime order value', money(bal.lifetimeGrossPaise, { decimals: 0 }))}
        ${infoRow('Settled / in-flight orders', `${num(bal.settledOrders)} / ${num(bal.inFlightOrders)}`)}
      </div>
    </div>

    ${bal.readOnly
      ? html`<div class="alert alert-info mt-6">${raw(icon('lock'))}
          <div class="a-body"><strong>This page cannot change your balance</strong>
            Balances are re-derived on the server from delivered orders and payout history. Editing the page, the network request or local storage has no effect.</div>
        </div>`
      : ''}

    <div class="dash-grid dash-2 mt-6">
      <div class="card card-pad">
        <h3 class="h4 mb-4">How the ${bal.commissionPercent}% commission works</h3>
        ${bal.example
          ? moneySplit({
              grossPaise: bal.example.orderAmountPaise,
              commissionPaise: bal.example.commissionPaise,
              vendorPaise: bal.example.vendorAmountPaise,
              percent: bal.example.percent,
            })
          : '<p class="muted text-sm">No settled orders yet.</p>'}
        <ul class="check-list mt-6">
          <li><span class="tick">${raw(icon('check'))}</span><span>Commission is charged only on delivered orders.</span></li>
          <li><span class="tick">${raw(icon('check'))}</span><span>Cancelled and refunded orders are never charged.</span></li>
          <li><span class="tick">${raw(icon('check'))}</span><span>Cash on delivery settles when you mark the order delivered.</span></li>
          <li><span class="tick">${raw(icon('check'))}</span><span>No monthly fee — you pay only when you sell.</span></li>
        </ul>
      </div>
      <div class="card card-pad">
        <h3 class="h4 mb-4">Earnings mix</h3>
        <div data-balance-mix></div>
        <div class="divider"></div>
        <h4 class="upper muted mb-2">Recent ledger</h4>
        <div data-balance-ledger></div>
      </div>
    </div>`;

  hBars($('[data-balance-mix]'), [
    { name: 'You keep', value: bal.earnedPaise },
    { name: 'Commission', value: bal.commissionPaise },
    { name: 'Withdrawn', value: bal.withdrawnPaise },
    { name: 'Pending', value: bal.pendingPaise },
  ], { format: (v) => money(v, { decimals: 0 }) });

  $('[data-balance-ledger]').innerHTML = (bal.ledger || []).slice(0, 6).map((l) => html`
    <div class="info-row">
      <span><strong class="ink text-sm">${esc(String(l.kind).replace(/_/g, ' '))}</strong><br/><span class="muted text-xs">${timeAgo(l.at)}</span></span>
      <strong class="${l.creditPaise ? 'text-success' : l.debitPaise ? 'text-danger' : ''}">${l.creditPaise ? `+ ${money(l.creditPaise)}` : l.debitPaise ? `− ${money(l.debitPaise)}` : '—'}</strong>
    </div>`).join('') || '<p class="muted text-sm">No entries yet.</p>';
}

/* =========================================================== withdrawals */

export async function withdrawals() {
  const page = await dashPage({
    active: 'withdrawals',
    title: 'Withdrawals',
    subtitle: 'Request a payout to your bank account or UPI ID',
  });
  if (!page) return;
  const { scroll, vendor } = page;

  scroll.innerHTML = `<div class="skeleton sk-card" style="height:200px"></div><div class="skeleton sk-card mt-4" style="height:280px"></div>`;

  const [bal, withdrawalData] = await Promise.all([
    Api.balance().catch(() => null),
    Api.paged('/finance/withdrawals', {}).catch(() => ({ items: [], meta: {} })),
  ]);
  const rows = withdrawalData.items;
  const methods = withdrawalData.meta.methods || [{ id: 'bank', label: 'Bank transfer (NEFT/IMPS)' }, { id: 'upi', label: 'UPI ID' }];
  const statuses = withdrawalData.meta.statuses || ['pending', 'processing', 'approved', 'paid', 'rejected', 'cancelled'];
  const available = bal?.availablePaise ?? 0;
  const min = bal?.minWithdrawalPaise ?? cfg.minWithdrawalPaise;

  scroll.innerHTML = html`
    <div class="dash-grid dash-main">
      <div class="card card-pad">
        <div class="card-head" style="padding:0 0 var(--sp-4);margin-bottom:var(--sp-4)">
          <div><h3 class="h4">Request a payout</h3><div class="sub">Minimum ${money(min, { decimals: 0 })} · ${bal?.payoutDays || cfg.payoutDays}</div></div>
        </div>

        ${vendor.status !== 'active'
          ? html`<div class="alert alert-warning">${raw(icon('alert-triangle'))}<div class="a-body"><strong>Payouts open once your store is active</strong>Finish activation and your first payout becomes available.</div></div>
            <a class="btn btn-primary mt-4" href="${url('activation.html')}">View activation status</a>`
          : available < min
            ? html`<div class="alert alert-info">${raw(icon('info'))}<div class="a-body"><strong>Not enough available balance yet</strong>You have ${money(available, { decimals: 0 })} available and the minimum payout is ${money(min, { decimals: 0 })}. Delivered orders add to it automatically.</div></div>`
            : html`
              <form class="withdraw-form" data-withdraw-form>
                <div class="field" data-field="amount">
                  <label class="label" for="wd-amount">Amount to withdraw</label>
                  <div class="input-group"><span class="prefix">₹</span><input class="input input-lg" id="wd-amount" name="amount" type="number" step="0.01" min="${(min / 100).toFixed(2)}" max="${(available / 100).toFixed(2)}" placeholder="${(available / 100).toFixed(2)}" data-autofocus/></div>
                  <span class="hint">Available: <strong class="ink">${money(available, { decimals: 2 })}</strong></span>
                  <div class="amount-quick mt-2">
                    ${[0.25, 0.5, 1].map((f) => html`<button type="button" class="chip" data-quick="${f}">${f === 1 ? 'All' : `${f * 100}%`}</button>`)}
                  </div>
                  <span class="error-text" data-error></span>
                </div>

                <div class="field" data-field="method">
                  <label class="label">Payment method</label>
                  <div class="pay-grid">
                    ${methods.map((m, i) => html`
                      <label class="pay-option ${i === 0 ? 'is-selected' : ''}">
                        <input type="radio" name="method" value="${m.id}" ${i === 0 ? 'checked' : ''} class="sr-only"/>
                        <span class="po-ico">${raw(icon(m.id === 'upi' ? 'smartphone' : 'building'))}</span>
                        <span class="po-body"><strong>${m.label}</strong><span>${m.id === 'upi' ? 'Instant, no IFSC needed' : 'NEFT / IMPS to your account'}</span></span>
                        <span class="po-check">${raw(icon('check-circle'))}</span>
                      </label>`)}
                  </div>
                </div>

                <div data-bank-fields>
                  <div class="form-grid">
                    <div class="field" data-field="holder">
                      <label class="label" for="wd-holder">Account holder name</label>
                      <input class="input" id="wd-holder" name="holder" value="${vendor.ownerName || vendor.name || ''}" maxlength="80"/>
                      <span class="error-text" data-error></span>
                    </div>
                    <div class="field" data-field="account">
                      <label class="label" for="wd-account">Account number</label>
                      <input class="input mono" id="wd-account" name="account" inputmode="numeric" maxlength="20" placeholder="50100XXXXXXXX"/>
                      <span class="error-text" data-error></span>
                    </div>
                    <div class="field" data-field="ifsc">
                      <label class="label" for="wd-ifsc">IFSC code</label>
                      <input class="input mono" id="wd-ifsc" name="ifsc" maxlength="11" placeholder="HDFC0001234" style="text-transform:uppercase"/>
                      <span class="error-text" data-error></span>
                    </div>
                  </div>
                </div>

                <div class="alert alert-info mt-4">${raw(icon('shield-check'))}
                  <div class="a-body"><strong>Server verified</strong>Your available balance is re-calculated when you submit, so an edited form cannot withdraw more than you have earned.</div>
                </div>

                <button type="submit" class="btn btn-primary btn-lg btn-block mt-6" data-label="Submit request">${raw(icon('send'))} Submit withdrawal request</button>
              </form>`}
      </div>

      <div class="stack">
        <div class="card card-pad">
          <h3 class="h4 mb-4">Your balance</h3>
          ${bal ? html`
            <div class="balance-amount" style="font-size:2rem">${money(bal.availablePaise, { decimals: 0 })}</div>
            <p class="muted text-sm">Available now</p>
            <div class="mt-4">
              ${infoRow('Pending', money(bal.pendingPaise, { decimals: 0 }))}
              ${infoRow('Reserved', money(bal.reservedPaise, { decimals: 0 }))}
              ${infoRow('Total earnings', money(bal.earnedPaise, { decimals: 0 }))}
              ${infoRow('Withdrawn', money(bal.withdrawnPaise, { decimals: 0 }))}
            </div>` : '<p class="muted text-sm">Balance unavailable.</p>'}
        </div>
        <div class="card card-pad">
          <h3 class="h4 mb-4">Status meanings</h3>
          <div class="stack-xs">
            ${statuses.map((s) => html`<div class="row" style="gap:8px">${statusBadge(s, WITHDRAWAL_TONE)}<span class="muted text-sm">${WITHDRAWAL_MEANING[s] || ''}</span></div>`)}
          </div>
        </div>
      </div>
    </div>

    <div class="card mt-6">
      <div class="card-head"><div><h3 class="h4">Withdrawal history</h3><div class="sub">${num(rows.length)} request${rows.length === 1 ? '' : 's'}</div></div></div>
      ${rows.length
        ? table({
            columns: [
              { key: 'requestedAt', label: 'Requested', render: (w) => html`<span class="text-sm">${dateTime(w.requestedAt)}</span>` },
              { key: 'amountPaise', label: 'Amount', align: 'right', render: (w) => html`<strong class="ink">${money(w.amountPaise)}</strong>` },
              { key: 'method', label: 'Method', render: (w) => html`<span class="badge badge-outline">${(w.method || '').toUpperCase()}</span>` },
              { key: 'account', label: 'Account', render: (w) => html`<span class="mono text-sm">${w.method === 'upi' ? w.account : `${maskAccount(w.account)}${w.ifsc ? ` · ${w.ifsc}` : ''}`}</span>` },
              { key: 'status', label: 'Status', render: (w) => statusBadge(w.status, WITHDRAWAL_TONE) },
              { key: 'reference', label: 'Reference', render: (w) => html`<span class="mono text-xs muted">${w.reference || '—'}</span>` },
              {
                key: 'actions',
                label: '',
                align: 'right',
                render: (w) => (w.status === 'pending'
                  ? html`<button type="button" class="btn btn-sm btn-ghost text-danger" data-cancel-withdrawal="${w.id}">Cancel</button>`
                  : html`<span class="muted text-xs">${w.processedAt ? dateShort(w.processedAt) : '—'}</span>`),
              },
            ],
            rows,
            empty: 'No withdrawals yet.',
          })
        : `<div class="card-pad">${emptyState({ icon: 'banknote', title: 'No withdrawal requests yet', message: `Your first payout becomes available once you have ${money(min, { decimals: 0 })} in your available balance.` })}</div>`}
    </div>`;

  /* ---------------------------------------------------------- form logic */
  const form = $('[data-withdraw-form]');
  if (form) {
    const bankFields = $('[data-bank-fields]', form);
    const syncMethod = () => {
      const method = form.querySelector('input[name="method"]:checked')?.value;
      bankFields.classList.toggle('hidden', method === 'upi');
      const accountLabel = $('[data-field="account"] .label', form);
      const accountInput = $('[name="account"]', form);
      if (method === 'upi') {
        accountLabel.textContent = 'UPI ID';
        accountInput.placeholder = 'yourname@okhdfc';
        accountInput.classList.remove('mono');
      } else {
        accountLabel.textContent = 'Account number';
        accountInput.placeholder = '50100XXXXXXXX';
        accountInput.classList.add('mono');
      }
    };
    $$('.pay-option', form).forEach((opt) => opt.addEventListener('click', () => {
      $$('.pay-option', form).forEach((o) => o.classList.remove('is-selected'));
      opt.classList.add('is-selected');
      const input = $('input', opt);
      if (input) input.checked = true;
      syncMethod();
    }));
    syncMethod();

    $$('[data-quick]', form).forEach((chip) => chip.addEventListener('click', () => {
      const value = (available * Number(chip.dataset.quick)) / 100;
      $('[name="amount"]', form).value = Math.max(min / 100, value / 100).toFixed(2);
      $('[name="amount"]', form).dispatchEvent(new Event('input', { bubbles: true }));
    }));

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = form.querySelector('[type="submit"]');
      const method = form.querySelector('input[name="method"]:checked')?.value;
      const rules = {
        amount: [validators.required, validators.min(min / 100)],
        holder: [validators.required, validators.minLen(3)],
        account: [validators.required, validators.minLen(5)],
      };
      if (method === 'upi') rules.account = [validators.required, validators.upi];
      else rules.ifsc = [validators.required, validators.ifsc];

      const { values, errors, valid } = readForm(form, rules);
      paintErrors(form, errors);
      if (!valid) {
        toastError('Please check the highlighted fields.');
        return;
      }
      const amountPaise = Math.round(Number(values.amount) * 100);
      const confirmed = await confirmDialog({
        title: `Withdraw ${money(amountPaise)}?`,
        message: `To ${method === 'upi' ? values.account : `account ${maskAccount(values.account)} (${values.ifsc})`}. Requests are reviewed by the platform team and usually paid within ${bal?.payoutDays || cfg.payoutDays}.`,
        confirmLabel: 'Submit request',
      });
      if (!confirmed) return;

      await withButtonState(btn, async () => {
        try {
          const res = await Api.requestWithdrawal({
            amountPaise,
            method,
            account: values.account,
            ifsc: method === 'bank' ? values.ifsc.toUpperCase() : '',
            holder: values.holder,
          });
          toastSuccess(res.message || 'Withdrawal requested.');
          setTimeout(() => globalThis.location.reload(), 900);
        } catch (err) {
          toastError(friendlyMessage(err), { title: 'Could not submit the request' });
        }
      });
    });
  }

  $$('[data-cancel-withdrawal]').forEach((btn) => btn.addEventListener('click', async () => {
    const yes = await confirmDialog({ title: 'Cancel this withdrawal request?', message: 'The reserved amount returns to your available balance.', confirmLabel: 'Cancel request', danger: true });
    if (!yes) return;
    await withButtonState(btn, async () => {
      try {
        const res = await Api.cancelWithdrawal(btn.dataset.cancelWithdrawal);
        toast(res.message || 'Withdrawal cancelled.', { type: 'info' });
        setTimeout(() => globalThis.location.reload(), 800);
      } catch (err) {
        toastError(friendlyMessage(err));
      }
    });
  }));
}

const WITHDRAWAL_MEANING = {
  pending: 'Submitted, waiting for review',
  processing: 'Approved, payment initiated',
  approved: 'Approved by the platform team',
  paid: 'Sent to your account',
  rejected: 'Rejected — check the note',
  cancelled: 'Cancelled by you',
};

const maskAccount = (value = '') => {
  const digits = String(value).replace(/\D/g, '');
  if (digits.length <= 4) return digits ? '••••' : '—';
  return `••••${digits.slice(-4)}`;
};

export default { payments, balance, withdrawals };
