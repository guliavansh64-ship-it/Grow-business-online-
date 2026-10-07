/**
 * pages/auth.js — login, register, forgot password and reset password.
 * Main-platform authentication only (custom backend). Firebase Auth is never
 * used here, so the two systems cannot be mixed (spec §27).
 */
import Api from '../api.js';
import cfg from '../config.js';
import { signIn, signUp, state as auth, isSignedIn, demoCredentials, homeFor } from '../auth.js';
import { $, $$, url, html, raw, esc, qget, on } from '../utils.js';
import { readForm, paintErrors, validators, passwordStrength } from '../utils.js';
import { icon } from '../icons.js';
import { toast, toastSuccess, toastError, withButtonState } from '../ui.js';

const BUSINESS_TYPES = [
  'Electronics Retail', 'Fashion & Apparel', 'Grocery & Organics', 'Home & Living',
  'Beauty & Wellness', 'Sports & Fitness', 'Books & Stationery', 'Handmade & Crafts', 'Services', 'Other',
];

function redirectAfterAuth(data) {
  const next = qget('next');
  if (next && /^\/|^(\.\.\/)/.test(next) && !next.startsWith('//')) {
    globalThis.location.replace(next);
    return;
  }
  globalThis.location.replace(data.redirectTo || homeFor(data.user, data.vendor) || url('index.html'));
}

/* ----------------------------------------------------------------- login */

export async function login() {
  if (isSignedIn()) {
    globalThis.location.replace(auth.redirectTo || homeFor(auth.user, auth.vendor));
    return;
  }
  if (qget('signedOut')) toast('You have been signed out.', { type: 'info' });
  if (qget('registered')) toastSuccess('Account created. Sign in to continue.');
  if (qget('reset')) toastSuccess('Password updated. Please sign in with your new password.');

  const form = $('[data-login-form]');
  if (!form) return;
  const errorBox = $('[data-form-error]');

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const btn = form.querySelector('[type="submit"]');
    const { values, errors, valid } = readForm(form, {
      identifier: [validators.required],
      password: [validators.required],
    });
    paintErrors(form, errors);
    if (!valid) return;
    if (errorBox) errorBox.classList.add('hidden');

    withButtonState(btn, async () => {
      try {
        const data = await signIn(values.identifier.trim(), values.password);
        toastSuccess(`Welcome back, ${data.user.name.split(' ')[0]}!`);
        setTimeout(() => redirectAfterAuth(data), 420);
      } catch (err) {
        if (errorBox) {
          errorBox.classList.remove('hidden');
          errorBox.innerHTML = `${icon('alert-circle', 'a-icon')}<div class="a-body">${esc(err.message)}</div>`;
        } else {
          toastError(err.message);
        }
      }
    });
  });

  renderDemoBox($('[data-demo-accounts]'));
}

function renderDemoBox(host) {
  if (!host || !cfg.features.demoMode) return;
  const creds = demoCredentials();
  host.innerHTML = html`
    <div class="demo-box">
      <div class="t">${raw(icon('key'))} Demo accounts — click to fill</div>
      ${creds.map(
        (c, i) => html`<div class="demo-row">
          <span><span class="r">${c.role}</span><br/><span class="e">${c.email}</span></span>
          <button type="button" class="btn btn-sm btn-soft" data-fill="${i}">Use</button>
        </div>`
      )}
      <p class="hint mt-2">${creds[0].note}. Passwords: <span class="mono">Vendor@123</span>, <span class="mono">Customer@123</span>, <span class="mono">Admin@123</span>.</p>
    </div>`;
  host.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-fill]');
    if (!btn) return;
    const c = creds[Number(btn.dataset.fill)];
    const form = $('form');
    if (!form) return;
    const idField = form.querySelector('[name="identifier"], [name="email"]');
    const pwField = form.querySelector('[name="password"]');
    if (idField) idField.value = c.email;
    if (pwField) pwField.value = c.password;
    idField?.dispatchEvent(new Event('input', { bubbles: true }));
    toast(`Filled ${c.role.toLowerCase()} credentials.`, { type: 'info', duration: 2200 });
  });
}

/* -------------------------------------------------------------- register */

export async function register() {
  if (isSignedIn()) {
    globalThis.location.replace(auth.redirectTo || homeFor(auth.user, auth.vendor));
    return;
  }
  const form = $('[data-register-form]');
  if (!form) return;

  // Business type options (kept in sync with the backend's allowed list).
  const typeSelect = form.querySelector('[name="businessType"]');
  if (typeSelect && typeSelect.options.length <= 1) {
    typeSelect.innerHTML = `<option value="">Select business type</option>` + BUSINESS_TYPES.map((t) => `<option value="${esc(t)}">${esc(t)}</option>`).join('');
  }

  bindPasswordMeter(form);
  bindPincodeAutofill(form);

  const steps = $$('[data-step]');
  const goTo = (n) => {
    steps.forEach((s) => s.classList.toggle('hidden', s.dataset.step !== String(n)));
    $$('[data-step-dot]').forEach((d, i) => d.classList.toggle('is-active', i + 1 === n));
    const bar = $('[data-step-progress]');
    if (bar) bar.style.width = `${(n / steps.length) * 100}%`;
    globalThis.scrollTo({ top: 0, behavior: 'smooth' });
  };
  if (steps.length > 1) {
    goTo(1);
    $$('[data-next-step]').forEach((btn) =>
      btn.addEventListener('click', () => {
        const current = Number($('.step:not(.hidden)')?.dataset?.step || 1);
        const errorsFor = current === 1
          ? { name: [validators.required, validators.minLen(3)], email: [validators.required, validators.email], phone: [validators.required, validators.phone], password: [validators.required, validators.password], confirmPassword: [validators.required, validators.sameAs('password')] }
          : { businessName: [validators.required, validators.minLen(3)], businessType: [validators.required], address: [validators.required, validators.minLen(6)], city: [validators.required], state: [validators.required], pincode: [validators.required, validators.pincode] };
        const { errors, valid } = readForm(form, errorsFor);
        paintErrors(form, errors);
        if (!valid) {
          toastError('Please complete the highlighted fields before continuing.');
          return;
        }
        goTo(Math.min(steps.length, current + 1));
      })
    );
    $$('[data-prev-step]').forEach((btn) => btn.addEventListener('click', () => goTo(Math.max(1, Number($('.step:not(.hidden)')?.dataset?.step || 2) - 1))));
  }

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const btn = form.querySelector('[type="submit"]');
    const { values, errors, valid } = readForm(form, {
      name: [validators.required, validators.minLen(3)],
      email: [validators.required, validators.email],
      phone: [validators.required, validators.phone],
      password: [validators.required, validators.password],
      confirmPassword: [validators.required, validators.sameAs('password')],
      businessName: [validators.required, validators.minLen(3)],
      businessType: [validators.required],
      address: [validators.required, validators.minLen(6)],
      city: [validators.required],
      state: [validators.required],
      country: [validators.required],
      pincode: [validators.required, validators.pincode],
      agree: [validators.checked],
    });
    paintErrors(form, errors);
    if (!valid) {
      toastError('Please fix the highlighted fields.', { title: 'Almost there' });
      if (steps.length > 1) {
        const firstBad = Object.keys(errors)[0];
        const stepEl = form.querySelector(`[name="${firstBad}"]`)?.closest('[data-step]');
        if (stepEl) goTo(Number(stepEl.dataset.step));
      }
      return;
    }

    withButtonState(btn, async () => {
      try {
        const data = await signUp({ ...values, country: values.country || 'India' });
        toastSuccess('Account created! Next step: your ₹1,000 refundable security deposit.', { duration: 5200 });
        setTimeout(() => globalThis.location.replace(data.redirectTo || url('deposit.html')), 700);
      } catch (err) {
        toastError(err.message, { title: 'Could not create your account' });
        const field = err.details && Object.keys(err.details)[0];
        if (field) paintErrors(form, { [field]: err.message });
      }
    });
  });

  renderDemoBox($('[data-demo-accounts]'));
}

function bindPasswordMeter(form) {
  const input = form.querySelector('[name="password"]');
  const meter = $('[data-password-meter]');
  if (!input || !meter) return;
  const bar = $('.bar span', meter);
  const label = $('.lbl', meter);
  const update = () => {
    const s = passwordStrength(input.value);
    bar.style.width = `${s.percent}%`;
    bar.style.background = ['var(--danger)', 'var(--danger)', 'var(--warning)', 'var(--warning)', 'var(--success)', 'var(--success)'][s.score];
    label.textContent = s.label;
  };
  input.addEventListener('input', update);
  update();
}

/** Indian pincode → auto-fill a sensible state hint (cosmetic convenience only). */
function bindPincodeAutofill(form) {
  const pin = form.querySelector('[name="pincode"]');
  const state = form.querySelector('[name="state"]');
  if (!pin || !state) return;
  const MAP = { '1': 'Delhi / Haryana / J&K', '2': 'UP / Uttarakhand', '3': 'Gujarat / Rajasthan', '4': 'Maharashtra / Goa', '5': 'Telangana / AP / Karnataka', '6': 'Tamil Nadu / Kerala', '7': 'WB / Odisha / NE', '8': 'Bihar / Jharkhand', '9': 'Assam / NE' };
  pin.addEventListener('blur', () => {
    const v = pin.value.trim();
    if (/^[1-9][0-9]{5}$/.test(v) && !state.value) {
      state.placeholder = MAP[v[0]] || 'Enter your state';
    }
  });
}

/* -------------------------------------------------------- forgot password */

export async function forgot() {
  const form = $('[data-forgot-form]');
  if (!form) return;
  const done = $('[data-forgot-done]');

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const btn = form.querySelector('[type="submit"]');
    const { values, errors, valid } = readForm(form, { email: [validators.required, validators.email] });
    paintErrors(form, errors);
    if (!valid) return;

    withButtonState(btn, async () => {
      const data = await Api.forgotPassword(values.email.trim());
      form.classList.add('hidden');
      if (done) {
        done.classList.remove('hidden');
        $('[data-forgot-email]', done).textContent = values.email.trim();
        // Dev-only: the backend returns the reset token so the flow is testable
        // without a mail server. Hidden automatically in production.
        if (data.devToken) {
          const dev = $('[data-dev-reset]', done);
          if (dev) {
            dev.classList.remove('hidden');
            dev.innerHTML = html`
              <div class="alert alert-warning mt-4">
                ${raw(icon('info'))}
                <div class="a-body">
                  <strong>Development mode</strong>
                  No mail server is attached, so here is your reset link:
                  <a class="mono text-sm" href="${url(`reset-password.html?token=${encodeURIComponent(data.devToken)}`)}">reset-password.html?token=${esc(data.devToken.slice(0, 12))}…</a>
                </div>
              </div>`;
          }
        }
      }
      toastSuccess('If that email is registered, a reset link is on its way.');
    });
  });
}

/* --------------------------------------------------------- reset password */

export async function reset() {
  const form = $('[data-reset-form]');
  if (!form) return;
  const token = qget('token');
  const tokenField = form.querySelector('[name="token"]');
  if (tokenField) tokenField.value = token;
  if (!token) {
    const box = $('[data-reset-invalid]');
    if (box) box.classList.remove('hidden');
    form.classList.add('hidden');
    return;
  }
  bindPasswordMeter(form);

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const btn = form.querySelector('[type="submit"]');
    const { values, errors, valid } = readForm(form, {
      password: [validators.required, validators.password],
      confirmPassword: [validators.required, validators.sameAs('password')],
    });
    paintErrors(form, errors);
    if (!valid) return;
    withButtonState(btn, async () => {
      try {
        const data = await Api.resetPassword({ token, password: values.password, confirmPassword: values.confirmPassword });
        toastSuccess(data.message || 'Password updated.');
        setTimeout(() => globalThis.location.replace(url('login.html?reset=1')), 900);
      } catch (err) {
        toastError(err.message, { title: 'Could not reset the password' });
        const box = $('[data-reset-invalid]');
        if (box) {
          box.classList.remove('hidden');
          box.innerHTML = `${icon('alert-circle', 'a-icon')}<div class="a-body"><strong>${esc(err.message)}</strong><a href="${url('forgot-password.html')}">Request a new link</a></div>`;
        }
      }
    });
  });
}

export default { login, register, forgot, reset };
