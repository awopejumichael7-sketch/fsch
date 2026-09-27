/**
 * service-worker.js
 * -----------------------------------------------------------------------
 * Makes the app installable and usable offline as a shell (Sections 38-39
 * of the product spec, extended for installability).
 *
 * SCOPE OF WHAT THIS CACHES:
 *   - Only this app's own static files (HTML/CSS/JS/icons/manifest).
 *   - It NEVER intercepts requests to Firebase/Firestore/Google APIs or any
 *     other cross-origin request — those pass straight to the network so
 *     Firestore's own offline persistence (enabled in firebase-config.js)
 *     remains the single source of truth for live family data. This file
 *     only makes the app itself (the shell) load instantly and installably;
 *     it does not cache or duplicate any Firestore data.
 *
 * Bump CACHE_VERSION whenever a shell file changes so returning visitors
 * get the new version instead of a stale cached copy.
 * -----------------------------------------------------------------------
 */

const CACHE_VERSION = "fph-shell-v1";

const APP_SHELL_FILES = [
  "index.html",
  "login.html",
  "dashboard.html",
  "style.css",
  "dashboard.css",
  "responsive.css",
  "manifest.json",
  "icon-192.png",
  "icon-512.png",
  "icon-maskable-512.png",
  "apple-touch-icon.png",
  "favicon-32.png",
  "favicon-16.png",
  "favicon.ico",
];

// ---- Install: pre-cache the shell -----------------------------------------
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_VERSION)
      .then((cache) => cache.addAll(APP_SHELL_FILES))
      .then(() => self.skipWaiting())
  );
});

// ---- Activate: drop any older cache versions ------------------------------
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== CACHE_VERSION).map((key) => caches.delete(key)))
      )
      .then(() => self.clients.claim())
  );
});

// ---- Fetch strategy ---------------------------------------------------------
self.addEventListener("fetch", (event) => {
  const { request } = event;

  // Only ever handle GET requests for this app's own origin. Everything
  // else (Firebase Auth, Firestore, Cloud Functions, Google Fonts/CDN,
  // POST/PUT requests, etc.) goes straight to the network untouched.
  if (request.method !== "GET" || new URL(request.url).origin !== self.location.origin) {
    return;
  }

  // Page navigations: network-first, so a signed-in family always sees the
  // latest deployed app first; fall back to the cached shell when offline.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const clone = response.clone();
          caches.open(CACHE_VERSION).then((cache) => cache.put(request, clone));
          return response;
        })
        .catch(() => caches.match(request).then((cached) => cached || caches.match("dashboard.html")))
    );
    return;
  }

  // Static assets (css/js/png/etc.): cache-first for instant loads, with a
  // silent background refresh so the next visit picks up any update.
  event.respondWith(
    caches.match(request).then((cached) => {
      const networkFetch = fetch(request)
        .then((response) => {
          const clone = response.clone();
          caches.open(CACHE_VERSION).then((cache) => cache.put(request, clone));
          return response;
        })
        .catch(() => cached);
      return cached || networkFetch;
    })
  );
});
