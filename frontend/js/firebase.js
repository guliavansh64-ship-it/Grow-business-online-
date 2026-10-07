/**
 * firebase.js — Firebase bridge for the OTHER APPS in the architecture.
 *
 *   GROWBUSINESS ONLINE
 *     ├─ MAIN PLATFORM → custom backend (js/api.js) — used by this repo
 *     └─ OTHER APPS    → Firebase (this module)
 *
 * Nothing here loads unless `firebase.enabled` is true in js/config.js, so the
 * main platform ships with ZERO Firebase bytes (spec §2, §27).
 *
 * Spec §28 — only the public *web app* config belongs in config.js. Never put
 * an Admin SDK key, service-account key, payment secret or database master
 * credential anywhere in the frontend. Spec §29: client credentials are not a
 * replacement for Security Rules + App Check + server-side validation.
 */
import cfg from './config.js';

const CDN = 'https://www.gstatic.com/firebasejs/10.12.2';

let sdkPromise = null;
let app = null;

export const isFirebaseEnabled = () => !!cfg.firebase?.enabled && !!cfg.firebase?.config?.apiKey;

/** Lazily imports the Firebase modules. Called only by Firebase-backed apps. */
export async function loadFirebase() {
  if (!isFirebaseEnabled()) {
    throw new Error('Firebase is disabled. Set firebase.enabled = true and add the web app config in js/config.js.');
  }
  if (sdkPromise) return sdkPromise;

  sdkPromise = (async () => {
    const [{ initializeApp, getApps }, authMod, fsMod] = await Promise.all([
      import(/* webpackIgnore: true */ `${CDN}/firebase-app.js`),
      import(/* webpackIgnore: true */ `${CDN}/firebase-auth.js`),
      import(/* webpackIgnore: true */ `${CDN}/firebase-firestore.js`),
    ]);
    app = getApps().length ? getApps()[0] : initializeApp(cfg.firebase.config);
    return {
      app,
      auth: authMod.getAuth(app),
      authMod,
      db: fsMod.getFirestore(app),
      fsMod,
    };
  })();

  return sdkPromise;
}

/* ------------------------------------------------------- auth (other apps) */

export async function firebaseSignInWithEmail(email, password) {
  const { auth, authMod } = await loadFirebase();
  return authMod.signInWithEmailAndPassword(auth, email, password);
}

export async function firebaseSignUpWithEmail(email, password) {
  const { auth, authMod } = await loadFirebase();
  const cred = await authMod.createUserWithEmailAndPassword(auth, email, password);
  await authMod.sendEmailVerification(cred.user);
  return cred;
}

export async function firebaseSignOut() {
  const { auth, authMod } = await loadFirebase();
  return authMod.signOut(auth);
}

export async function firebaseSendReset(email) {
  const { auth, authMod } = await loadFirebase();
  return authMod.sendPasswordResetEmail(auth, email);
}

/* ------------------------------------------------------------- push (FCM) */

/**
 * Requests push permission and returns an FCM token.
 * Requires a public VAPID key in config.js (firebase.config.vapidKey).
 */
export async function requestPushToken(serviceWorkerPath = '/firebase-messaging-sw.js') {
  if (!isFirebaseEnabled()) throw new Error('Firebase is disabled.');
  if (!('serviceWorker' in navigator) || !('PushManager' in globalThis)) {
    throw new Error('Push notifications are not supported in this browser.');
  }
  const { app } = await loadFirebase();
  const { getMessaging, getToken, onMessage } = await import(/* webpackIgnore: true */ `${CDN}/firebase-messaging.js`);
  const registration = await navigator.serviceWorker.register(serviceWorkerPath);
  const messaging = getMessaging(app);
  const token = await getToken(messaging, { vapidKey: cfg.firebase.config.vapidKey, serviceWorkerRegistration: registration });
  return { token, messaging, onMessage };
}

/**
 * Translates FirebaseError codes into the friendly copy the UI shows
 * (spec §35 — never surface "FirebaseError: PERMISSION_DENIED").
 */
const FRIENDLY = {
  'auth/invalid-credential': 'Incorrect email or password.',
  'auth/invalid-email': 'Enter a valid email address.',
  'auth/user-not-found': 'Incorrect email or password.',
  'auth/wrong-password': 'Incorrect email or password.',
  'auth/email-already-in-use': 'An account with this email already exists.',
  'auth/weak-password': 'Choose a stronger password (at least 8 characters).',
  'auth/too-many-requests': 'Too many attempts. Please try again in a few minutes.',
  'auth/network-request-failed': 'Unable to connect. Please check your internet connection and try again.',
  'auth/requires-recent-login': 'For your security, please sign in again.',
  'permission-denied': "You don't have permission to perform this action.",
  'unavailable': 'The service is temporarily unavailable. Please try again.',
  'failed-precondition': 'This action is not available right now.',
  unauthenticated: 'Your session has expired. Please sign in again.',
};

export function friendlyFirebaseError(err) {
  const code = err?.code || err?.error?.code || '';
  const short = String(code).replace(/^firebase\/|^auth\//, (m) => m);
  return FRIENDLY[code] || FRIENDLY[short] || err?.message || 'Something went wrong. Please try again.';
}

/**
 * Tenant isolation helper (spec §29). Every Firestore query built by a
 * Firebase-backed app must be constrained by the signed-in user's vendorId —
 * which is read from the custom token claims, never from the URL.
 */
export function tenantQuery(collectionRef, vendorId, extraWhere = []) {
  return { vendorId, extraWhere, note: 'Security Rules must enforce the same constraint server side.' };
}

export default { isFirebaseEnabled, loadFirebase, firebaseSignInWithEmail, firebaseSignUpWithEmail, firebaseSignOut, firebaseSendReset, requestPushToken, friendlyFirebaseError };
