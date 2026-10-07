/**
 * pages/checkout.js — cart, checkout and the order-confirmation screen.
 *
 * Security rules this module obeys (spec §24, §47):
 *   · every total comes from the server quote, never from a local calculation
 *   · the browser never sets paymentStatus, commission or price
 *   · no card number, CVV or UPI PIN is ever collected by this page
 */
import Api, { friendlyMessage } from '../api.js';
import cfg from '../config.js';
import { initStorefront } from '../vendor.js';
import { mountStorefrontChrome } from '../layout.js';
import cart from '../cart.js';
import { isSignedIn, state as auth } from '../auth.js';
import { $, $$, url, html, raw, esc, money, num, dateShort, qget, sleep } from '../utils.js';
import { readForm, paintErrors, validators } from '../utils.js';
import { icon } from '../icons.js';
import { toast, toastSuccess, toastError, withButtonState, emptyState, setLoading } from '../ui.js';
import { summaryRows, trackingSteps, statusBadge, ORDER_TONE, PAYMENT_TONE } from '../components.js';
import { bindProductActions } from '../products.js';

const boot = async (activeNav) => {
  const vendor = await initStorefront({ onNotFound: () => $('[data-store-host]')?.remove() });
  if (!vendor) return null;
  const categories = vendor.categories?.length ? vendor.categories : await Api.categories(vendor.slug).catch(() => []);
  mountStorefrontChrome(vendor, { categories, activeNav });
  cart.bind(vendor.slug);
  return vendor;
};

const snapshot = (item) => item.snapshot || {};

/* ================================================================== cart */

export async function cartPage() {
  const vendor = await boot('cart');
  if (!vendor) return;
  const host = $('[data-store-host]');

  const render = async () => {
    if (cart.isEmpty) {
      host.innerHTML = `<div class="container section">${emptyState({
        icon: 'cart',
        title: 'Your cart is empty',
        message: `Browse ${vendor.name} and add a few products to get started.`,
        action: { label: 'Start shopping', href: url(`vendor/category.html?vendor=${vendor.slug}`) },
      })}</div>`;
      document.title = `Shopping Cart · ${vendor.name}`;
      return;
    }

    host.innerHTML = html`
      <div class="container section-sm">
        <div class="page-head mb-6">
          <div><h1>Shopping Cart</h1><p class="sub" data-cart-count-text>Loading cart…</p></div>
          <button type="button" class="btn btn-ghost btn-sm" data-clear-cart>${raw(icon('trash'))} Clear cart</button>
        </div>

        <div class="cart-layout">
          <div data-cart-lines>
            ${cart.items.map(cartLine).join('')}
          </div>

          <aside class="cart-summary-sticky">
            <div class="summary" data-cart-summary>
              <h3 class="h4">Order summary</h3>
              <div class="rows" data-summary-rows><div class="skeleton sk-text"></div></div>
              <button type="button" class="btn btn-primary btn-lg btn-block mt-6" data-checkout>${raw(icon('lock'))} Proceed to Checkout</button>
              <a class="btn btn-secondary btn-block mt-2" href="${url(`vendor/category.html?vendor=${vendor.slug}`)}">${raw(icon('arrow-left'))} Continue shopping</a>
              <div class="secure-note">${raw(icon('shield-check'))} Prices are verified by the store before your order is confirmed.</div>
            </div>
          </aside>
        </div>
      </div>`;

    document.title = `Shopping Cart (${cart.count}) · ${vendor.name}`;
    $('[data-cart-count-text]').textContent = `${cart.count} item${cart.count === 1 ? '' : 's'} from ${vendor.name}`;
    bindLineEvents();
    await refreshQuote();
  };

  const cartLine = (item) => {
    const p = snapshot(item);
    const mrp = Number(p.mrpPaise || p.pricePaise || 0);
    const price = Number(p.pricePaise || 0);
    const off = mrp > price ? Math.round(((mrp - price) / mrp) * 100) : 0;
    return html`
      <article class="cart-line" data-line="${item.productId}">
        <a href="${url(`vendor/product.html?vendor=${vendor.slug}&id=${item.productId}`)}">
          ${p.image ? html`<img src="${url(String(p.image).replace(/^\//, ''))}" alt="${p.name}" width="88" height="88" loading="lazy"/>` : '<span class="thumb"></span>'}
        </a>
        <div class="cl-body">
          <a class="cl-name" href="${url(`vendor/product.html?vendor=${vendor.slug}&id=${item.productId}`)}">${p.name || 'Product'}</a>
          <div class="row text-sm muted" style="gap:10px">
            ${p.sku ? html`<span class="mono">${p.sku}</span>` : ''}
            ${off ? html`<span class="badge badge-success">${off}% off</span>` : ''}
            ${p.stock !== undefined ? html`<span>${p.stock > item.qty ? `${p.stock} in stock` : `Only ${p.stock} left`}</span>` : ''}
          </div>
          <div class="row mt-3" style="gap:10px">
            <div class="qty">
              <button type="button" data-dec aria-label="Decrease">${raw(icon('minus'))}</button>
              <input type="number" value="${item.qty}" min="1" max="${Math.max(1, p.stock ?? 10)}" data-qty aria-label="Quantity for ${p.name}"/>
              <button type="button" data-inc aria-label="Increase">${raw(icon('plus'))}</button>
            </div>
            <button type="button" class="btn btn-ghost btn-sm" data-remove>${raw(icon('trash'))} Remove</button>
          </div>
        </div>
        <div class="cl-right">
          <div class="cl-price">${money(price * item.qty)}</div>
          ${off ? html`<div class="cl-was">${money(mrp * item.qty)}</div>` : ''}
        </div>
      </article>`;
  };

  function bindLineEvents() {
    $$('[data-line]', host).forEach((line) => {
      const id = line.dataset.line;
      const input = $('[data-qty]', line);
      const repaint = () => {
        const node = document.createElement('div');
        node.innerHTML = cartLine(cart.items.find((i) => i.productId === id));
        line.replaceWith(node.firstElementChild);
        bindLineEvents();
      };
      $('[data-dec]', line)?.addEventListener('click', () => { cart.setQty(id, Number(input.value) - 1); repaint(); refreshQuote(); });
      $('[data-inc]', line)?.addEventListener('click', () => { cart.setQty(id, Number(input.value) + 1); repaint(); refreshQuote(); });
      $('[data-remove]', line)?.addEventListener('click', () => {
        cart.remove(id);
        line.remove();
        if (cart.isEmpty) render();
        else { $('[data-cart-count-text]').textContent = `${cart.count} item${cart.count === 1 ? '' : 's'} from ${vendor.name}`; refreshQuote(); }
        toast('Item removed from your cart.', { type: 'info', duration: 2200 });
      });
      input?.addEventListener('change', () => { cart.setQty(id, Number(input.value)); refreshQuote(); });
    });

    $('[data-clear-cart]', host)?.addEventListener('click', async () => {
      const { confirmDialog } = await import('../ui.js');
      const yes = await confirmDialog({ title: 'Empty your cart?', message: 'This removes every item from your cart.', confirmLabel: 'Empty cart', danger: true });
      if (!yes) return;
      cart.clear();
      render();
    });

    $('[data-checkout]', host)?.addEventListener('click', () => {
      globalThis.location.href = url(`vendor/checkout.html?vendor=${vendor.slug}`);
    });
  }

  /** The ONLY place totals are painted — straight from the server quote. */
  async function refreshQuote() {
    const rowsHost = $('[data-summary-rows]', host);
    if (!rowsHost) return;
    setLoading(rowsHost, true, '<div class="skeleton sk-text"></div><div class="skeleton sk-text"></div><div class="skeleton sk-text"></div>');
    try {
      const quote = await cart.quote();
      if (!quote) return;
      cart.serverQuote = quote;
      const freeAbove = vendor.freeDeliveryAbovePaise ?? cfg.freeDeliveryAbovePaise;
      const short = quote.subtotalPaise > 0 && quote.netPaise < freeAbove ? freeAbove - quote.netPaise : 0;
      rowsHost.innerHTML = summaryRows([
        { label: `Subtotal (${quote.itemCount} item${quote.itemCount === 1 ? '' : 's'})`, value: money(quote.subtotalPaise) },
        { label: 'Discount', value: quote.discountPaise ? `− ${money(quote.discountPaise)}` : money(0), tone: quote.discountPaise ? 'is-discount' : '' },
        { label: 'Delivery fee', value: quote.deliveryFeePaise ? money(quote.deliveryFeePaise) : 'Free', tone: quote.deliveryFeePaise ? '' : 'is-discount' },
        quote.taxPaise ? { label: `Tax (${quote.taxPercent}%)`, value: money(quote.taxPaise) } : null,
        { label: 'Total', value: money(quote.totalPaise), strong: true },
      ], { wrap: false });
      if (short > 0) {
        const hint = document.createElement('p');
        hint.className = 'hint mt-3';
        hint.innerHTML = `${icon('truck')} Add ${money(short)} more for free delivery.`;
        rowsHost.after(hint);
      }
      const btn = $('[data-checkout]', host);
      if (btn) btn.disabled = quote.lines.length === 0;
      setLoading(rowsHost, false);
    } catch (err) {
      setLoading(rowsHost, false);
      rowsHost.innerHTML = `<p class="muted text-sm">${esc(friendlyMessage(err))}</p>`;
    }
  }

  render();
  document.addEventListener('cart:change', () => {
    if (!cart.isEmpty) refreshQuote();
  });
}

/* ============================================================= checkout */

export async function checkout() {
  const vendor = await boot('cart');
  if (!vendor) return;
  const host = $('[data-store-host]');

  if (cart.isEmpty) {
    host.innerHTML = `<div class="container section">${emptyState({ icon: 'cart', title: 'Nothing to check out', message: 'Your cart is empty. Add products first.', action: { label: 'Browse products', href: url(`vendor/category.html?vendor=${vendor.slug}`) } })}</div>`;
    return;
  }

  document.title = `Checkout · ${vendor.name}`;
  const [config, savedAddresses] = await Promise.all([
    Api.config().catch(() => ({ paymentMethods: [] })),
    isSignedIn() ? Api.addresses().catch(() => []) : Promise.resolve([]),
  ]);

  const methods = (config.paymentMethods || []).filter((m) => m.enabled !== false)
    .filter((m) => (m.kind === 'offline' ? vendor.codEnabled !== false : vendor.onlinePaymentEnabled !== false));

  const who = auth.user || {};
  const primary = savedAddresses.find((a) => a.isDefault) || savedAddresses[0];

  host.innerHTML = html`
    <div class="container section-sm">
      <nav class="breadcrumb mb-4" aria-label="Breadcrumb">
        <a href="${url(`vendor/cart.html?vendor=${vendor.slug}`)}">Cart</a>${raw(icon('chevron-right', 'sep'))}<span class="current">Checkout</span>
      </nav>
      <h1 class="h2 mb-6">Checkout</h1>

      <form class="checkout-layout" data-checkout-form novalidate>
        <div class="stack-lg">
          ${savedAddresses.length
            ? html`<div class="card card-pad">
                <div class="card-head" style="padding:0 0 var(--sp-3)"><div><h3 class="h4">Saved addresses</h3><div class="sub">Pick one to fill the form</div></div></div>
                <div class="grid g-2">
                  ${savedAddresses.slice(0, 4).map((a) => html`
                    <button type="button" class="address-card ${a.id === primary?.id ? 'is-primary' : ''}" data-use-address='${JSON.stringify(a).replace(/'/g, '&#39;')}'>
                      <strong class="ink">${a.label || 'Address'}</strong>
                      <span class="muted text-sm mt-1" style="display:block">${a.line1}${a.city ? `, ${a.city}` : ''}${a.state ? ` — ${a.state}` : ''} ${a.pincode || ''}</span>
                      <span class="muted text-sm">${a.phone || ''}</span>
                    </button>`)}
                </div>
              </div>`
            : ''}

          <div class="card card-pad">
            <div class="card-head" style="padding:0 0 var(--sp-4);margin-bottom:var(--sp-4)">
              <div><h3 class="h4">1 · Contact details</h3><div class="sub">We only use these for your order updates.</div></div>
            </div>
            <div class="form-grid">
              <div class="field" data-field="name">
                <label class="label" for="co-name">Full name</label>
                <input class="input" id="co-name" name="name" value="${who.name || ''}" autocomplete="name" placeholder="Your name" required/>
                <span class="error-text" data-error></span>
              </div>
              <div class="field" data-field="phone">
                <label class="label" for="co-phone">Mobile number</label>
                <div class="input-group"><span class="prefix">+91</span><input class="input" id="co-phone" name="phone" value="${(who.phone || '').replace(/^\+?91/, '')}" autocomplete="tel-national" inputmode="numeric" maxlength="10" placeholder="98765 43210" required/></div>
                <span class="error-text" data-error></span>
              </div>
              <div class="field" data-field="email">
                <label class="label" for="co-email">Email <span class="opt">for updates</span></label>
                <input class="input" id="co-email" name="email" type="email" value="${who.email || ''}" autocomplete="email" placeholder="you@example.com"/>
                <span class="error-text" data-error></span>
              </div>
            </div>
          </div>

          <div class="card card-pad">
            <div class="card-head" style="padding:0 0 var(--sp-4);margin-bottom:var(--sp-4)">
              <div><h3 class="h4">2 · Delivery address</h3><div class="sub">Where should ${vendor.name} send your order?</div></div>
              ${isSignedIn() ? html`<label class="check"><input type="checkbox" name="saveAddress" checked/><span class="box">${raw(icon('check'))}</span><span class="text">Save this address</span></label>` : ''}
            </div>
            <div class="form-grid">
              <div class="field span-2" data-field="line1">
                <label class="label" for="co-line1">Address</label>
                <textarea class="textarea" id="co-line1" name="line1" rows="2" autocomplete="street-address" placeholder="House / flat, street, landmark" required></textarea>
                <span class="error-text" data-error></span>
              </div>
              <div class="field" data-field="city">
                <label class="label" for="co-city">City</label>
                <input class="input" id="co-city" name="city" autocomplete="address-level2" placeholder="City" required/>
                <span class="error-text" data-error></span>
              </div>
              <div class="field" data-field="state">
                <label class="label" for="co-state">State</label>
                <input class="input" id="co-state" name="state" autocomplete="address-level1" placeholder="State" required/>
                <span class="error-text" data-error></span>
              </div>
              <div class="field" data-field="pincode">
                <label class="label" for="co-pin">Pincode</label>
                <input class="input" id="co-pin" name="pincode" autocomplete="postal-code" inputmode="numeric" maxlength="6" placeholder="6 digit pincode" required/>
                <span class="error-text" data-error></span>
              </div>
              <div class="field" data-field="country">
                <label class="label" for="co-country">Country</label>
                <input class="input" id="co-country" name="country" value="India" autocomplete="country-name" required/>
              </div>
              <div class="field span-2" data-field="notes">
                <label class="label" for="co-notes">Delivery notes <span class="opt">optional</span></label>
                <input class="input" id="co-notes" name="notes" maxlength="200" placeholder="Gate code, preferred time, landmark…"/>
              </div>
            </div>
          </div>

          <div class="card card-pad">
            <div class="card-head" style="padding:0 0 var(--sp-4);margin-bottom:var(--sp-4)">
              <div><h3 class="h4">3 · Payment method</h3><div class="sub">Options are configured by ${vendor.name}.</div></div>
            </div>
            <div class="pay-methods" data-pay-methods>
              ${methods.map((m, i) => html`
                <label class="pay-option ${i === 0 ? 'is-selected' : ''}">
                  <input type="radio" name="paymentMethod" value="${m.id}" ${i === 0 ? 'checked' : ''} class="sr-only"/>
                  <span class="po-ico">${raw(icon(({ upi: 'smartphone', card: 'credit', netbanking: 'building', cod: 'banknote' })[m.id] || 'credit'))}</span>
                  <span class="po-body"><strong>${m.label}</strong><span>${m.note || ''}</span></span>
                  <span class="po-check">${raw(icon('check-circle'))}</span>
                </label>`)}
            </div>
            <div class="alert alert-info mt-4" data-payment-note>${raw(icon('info'))}
              <div class="a-body">${raw(payNote(methods[0]))}</div>
            </div>
            <div class="secure-note">${raw(icon('lock'))} Card numbers and UPI PINs are entered only on the bank's secure page. This site never stores them.</div>
          </div>
        </div>

        <aside>
          <div class="checkout-summary">
            <div class="summary">
              <h3 class="h4">Order summary</h3>
              <div data-summary-rows><div class="skeleton sk-text"></div></div>
              <div class="divider"></div>
              <div class="stack-xs" data-summary-lines></div>
              <button type="submit" class="btn btn-primary btn-lg btn-block mt-6" data-place-order>${raw(icon('check-circle'))} Place order</button>
              <p class="hint text-center mt-3">By placing this order you agree to ${vendor.name}'s terms and the platform refund policy.</p>
            </div>
          </div>
        </aside>
      </form>
    </div>`;

  // ---- payment method interactions
  const noteEl = $('[data-payment-note] .a-body', host);
  $$('[data-pay-methods] .pay-option', host).forEach((opt) => {
    opt.addEventListener('click', () => {
      $$('.pay-option', host).forEach((o) => o.classList.remove('is-selected'));
      opt.classList.add('is-selected');
      const input = $('input', opt);
      if (input) {
        input.checked = true;
        const method = methods.find((m) => m.id === input.value);
        if (noteEl) noteEl.innerHTML = payNote(method);
      }
    });
  });

  function payNote(m) {
    if (!m) return 'Choose a payment method to continue.';
    if (m.kind === 'offline') return `<strong>${m.label}</strong><br/>Pay the delivery partner when your order arrives. No online payment is taken now.`;
    return `<strong>${m.label}</strong><br/>You will be redirected to the secure payment gateway after placing the order. We only receive the gateway's confirmation — never your card details.`;
  }

  // ---- saved address fill
  $$('[data-use-address]', host).forEach((btn) => {
    btn.addEventListener('click', () => {
      const a = JSON.parse(btn.dataset.useAddress.replace(/&#39;/g, "'"));
      const form = $('[data-checkout-form]', host);
      const set = (name, value) => { const f = form.querySelector(`[name="${name}"]`); if (f && value) f.value = value; };
      set('name', a.name); set('phone', a.phone); set('line1', a.line1); set('city', a.city); set('state', a.state); set('pincode', a.pincode);
      paintErrors(form, {});
      toast('Address filled in.', { type: 'success', duration: 2000 });
      btn.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  });

  // ---- summary from the server quote
  const quote = await cart.quote().catch(() => null);
  if (!quote) {
    toastError('We could not price your cart. Please review it again.');
    globalThis.location.replace(url(`vendor/cart.html?vendor=${vendor.slug}`));
    return;
  }
  cart.serverQuote = quote;
  $('[data-summary-rows]', host).innerHTML = summaryRows([
    { label: `Subtotal (${quote.itemCount} items)`, value: money(quote.subtotalPaise) },
    { label: 'Discount', value: quote.discountPaise ? `− ${money(quote.discountPaise)}` : money(0), tone: quote.discountPaise ? 'is-discount' : '' },
    { label: 'Delivery', value: quote.deliveryFeePaise ? money(quote.deliveryFeePaise) : 'Free', tone: quote.deliveryFeePaise ? '' : 'is-discount' },
    quote.taxPaise ? { label: `Tax (${quote.taxPercent}%)`, value: money(quote.taxPaise) } : null,
    { label: 'Total payable', value: money(quote.totalPaise), strong: true },
  ], { wrap: false });
  $('[data-summary-lines]', host).innerHTML = quote.lines.map((l) => html`
    <div class="info-row">
      <span><strong class="ink">${l.qty}×</strong> ${l.name}</span>
      <strong>${money(l.grossPaise)}</strong>
    </div>`).join('');

  // ---- submit
  $('[data-checkout-form]', host).addEventListener('submit', (e) => {
    e.preventDefault();
    const form = e.currentTarget;
    const btn = $('[data-place-order]', form);
    const { values, errors, valid } = readForm(form, {
      name: [validators.required, validators.minLen(3)],
      phone: [validators.required, validators.phone],
      email: [validators.emailOptional],
      line1: [validators.required, validators.minLen(8)],
      city: [validators.required],
      state: [validators.required],
      pincode: [validators.required, validators.pincode],
      country: [validators.required],
    });
    paintErrors(form, errors);
    if (!valid) {
      toastError('Please check the highlighted fields.');
      const firstBad = form.querySelector('.field-error');
      firstBad?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }

    const paymentMethod = form.querySelector('input[name="paymentMethod"]:checked')?.value;
    if (!paymentMethod) {
      toastError('Choose a payment method.');
      return;
    }

    withButtonState(btn, async () => {
      try {
        const payload = {
          items: cart.payload(),
          paymentMethod,
          notes: values.notes,
          customer: { name: values.name, phone: values.phone.replace(/\D/g, '').slice(-10), email: values.email },
          shipping: { line1: values.line1, city: values.city, state: values.state, pincode: values.pincode, country: values.country },
        };
        const order = await Api.placeOrder(vendor.slug, payload);

        if (values.saveAddress && isSignedIn()) {
          Api.addAddress({
            label: 'Home',
            name: values.name,
            phone: payload.customer.phone,
            line1: values.line1,
            city: values.city,
            state: values.state,
            pincode: values.pincode,
            country: values.country,
          }).catch(() => {});
        }

        cart.clear();
        sessionStorage.setItem('gbo:lastOrder', JSON.stringify(order));
        globalThis.location.href = url(`vendor/success.html?vendor=${vendor.slug}&number=${encodeURIComponent(order.orderNumber)}`);
      } catch (err) {
        toastError(friendlyMessage(err), { title: 'Order could not be placed' });
        const field = err.details && Object.keys(err.details)[0];
        if (field) paintErrors(form, { [field]: err.details[field] });
      }
    });
  });
}

/* ============================================================== success */

export async function success() {
  const vendor = await boot('cart');
  if (!vendor) return;
  const host = $('[data-store-host]');
  const number = qget('number');
  const cached = (() => { try { return JSON.parse(sessionStorage.getItem('gbo:lastOrder') || 'null'); } catch { return null; } })();

  document.title = `Order confirmed · ${vendor.name}`;

  const renderConfirmed = (info) => {
    host.innerHTML = html`
      <div class="container section-sm" style="max-width:840px">
        <div class="card card-pad text-center">
          <div class="celebrate">
            <div class="emoji">🎉</div>
            <h1 class="mt-4">Thank you! Your order is confirmed</h1>
            <p class="muted mt-2">Order <strong class="mono ink">${info.orderNumber}</strong> has been sent to ${vendor.name}.</p>
          </div>

          <div class="stat-strip mt-6">
            <div class="ss"><span class="l">Amount</span><span class="v">${money(info.totalPaise)}</span></div>
            <div class="ss"><span class="l">Payment</span><span class="v">${statusBadge(info.paymentStatus, PAYMENT_TONE)}</span></div>
            <div class="ss"><span class="l">Status</span><span class="v">${statusBadge(info.status, ORDER_TONE)}</span></div>
            <div class="ss"><span class="l">Method</span><span class="v">${(info.paymentMethod || '').toUpperCase()}</span></div>
          </div>

          ${trackingSteps(info.status)}

          ${info.paymentStatus === 'pending'
            ? html`<div class="alert alert-warning mt-6">${raw(icon('banknote'))}<div class="a-body"><strong>Pay on delivery</strong>Please keep ${money(info.totalPaise)} ready. Our delivery partner accepts cash and UPI.</div></div>`
            : html`<div class="alert alert-success mt-6">${raw(icon('check-circle'))}<div class="a-body"><strong>Payment received</strong>Your payment was confirmed by the gateway. A receipt has been emailed to you.</div></div>`}

          <div class="row mt-6" style="justify-content:center;flex-wrap:wrap">
            <a class="btn btn-primary" href="${url(`vendor/order-detail.html?vendor=${vendor.slug}&number=${encodeURIComponent(info.orderNumber)}`)}">${raw(icon('truck'))} Track my order</a>
            <a class="btn btn-secondary" href="${url(`vendor/category.html?vendor=${vendor.slug}`)}">${raw(icon('grid'))} Continue shopping</a>
            ${isSignedIn() ? html`<a class="btn btn-ghost" href="${url(`vendor/orders.html?vendor=${vendor.slug}`)}">${raw(icon('receipt'))} My orders</a>` : ''}
          </div>
        </div>
      </div>`;
    sessionStorage.removeItem('gbo:lastOrder');
  };

  if (cached && cached.orderNumber === number) {
    renderConfirmed(cached);
    return;
  }

  // Fall back to the public tracking endpoint (needs the phone/email used).
  host.innerHTML = `<div class="container section">${emptyState({
    icon: 'receipt',
    title: `Order ${number || ''} was placed`,
    message: 'Sign in or use the tracking page with the mobile number you entered to see live updates.',
    action: { label: 'Track an order', href: url(`vendor/order-detail.html?vendor=${vendor.slug}`) },
  })}</div>`;
}

export default { cartPage, checkout, success };
