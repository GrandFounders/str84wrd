/* eslint-disable no-restricted-globals */
/**
 * Static Invoice / guapp — Service worker
 *
 * - Precache: "shell" (index, css, shared JS, menu) vs "invoice" (templates + iframe helpers).
 * - Runtime: network-first, then cache; successful responses refresh the matching cache.
 * - Bump VERSION after any change to precache lists so old caches are deleted on activate.
 *
 * Requires https: or localhost (not file://). Registered from js/sw-register.js.
 *
 * Learning — SKIP_WAITING_ON_INSTALL:
 * - true (default): install calls skipWaiting() so the new worker usually goes straight to activate
 *   (you will still see installing → activated in logs, but little or no **waiting** phase).
 * - false: after a refresh when an older worker is still active, the new worker stays **installed/waiting**
 *   until the page posts { type: 'SKIP_WAITING' } (see button in index.html or __guappSwSkipWaiting()).
 */
const VERSION = 'guapp-v3';
/** @type {boolean} Set false to practice the "waiting" lifecycle in DevTools. */
const SKIP_WAITING_ON_INSTALL = false;

const SHELL_CACHE = `${VERSION}-shell`;
const PLUGIN_CACHE = `${VERSION}-invoice`;

/** Host / canvas / chrome — offline shell */
const SHELL_ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icons/img00001.PNG',
  './css/index.css',
  './menu/sidebar_mMenu.html',
  './js/html2canvas.min.js',
  './js/global-storage.js',
  './js/invoice-app-catalog-storage.js',
  './js/invoice-catalog-admin.js',
  './js/invoice-shell-bootstrap.js',
  './js/canvas-shell-ctrls.js',
  './js/overlay-layer.js',
  './js/page-overlay-elements.js',
  './js/sw-register.js',
];

/** Document templates + plugin surface */
const INVOICE_ASSETS = [
  './templates/invoice.html',
  './templates/Receipt.html',
  './templates/statement.html',
  './templates/Summary.html',
  './templates/Orders.html',
  './templates/blankDoc.html',
  './templates/Transactions.html',
  './templates/Inventory.html',
];

function cacheNameForUrl(url) {
  try {
    const path = new URL(url).pathname;
    if (path.includes('/templates/')) return PLUGIN_CACHE;
    return SHELL_CACHE;
  } catch {
    return SHELL_CACHE;
  }
}

async function precacheAll(cacheName, urls) {
  const cache = await caches.open(cacheName);
  for (const url of urls) {
    await cache.add(url);
  }
}

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    console.log('[sw:worker] message SKIP_WAITING → skipWaiting()');
    self.skipWaiting();
  }
});

self.addEventListener('install', (event) => {
  console.log('[sw:worker] install event — precache shell + invoice, VERSION=', VERSION);
  event.waitUntil(
    (async () => {
      await precacheAll(SHELL_CACHE, SHELL_ASSETS);
      await precacheAll(PLUGIN_CACHE, INVOICE_ASSETS);
      if (SKIP_WAITING_ON_INSTALL) {
        console.log('[sw:worker] install done → skipWaiting() (SKIP_WAITING_ON_INSTALL=true)');
        await self.skipWaiting();
      } else {
        console.log(
          '[sw:worker] install done — NOT calling skipWaiting (SKIP_WAITING_ON_INSTALL=false). New worker will **wait** until SKIP_WAITING message.'
        );
      }
    })()
  );
});

self.addEventListener('activate', (event) => {
  console.log('[sw:worker] activate event — prune old guapp-* caches, claim clients');
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((k) => k.startsWith('guapp-') && !k.startsWith(VERSION))
          .map((k) => caches.delete(k))
      );
      await self.clients.claim();
      console.log('[sw:worker] activate complete');
    })()
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  let url;
  try {
    url = new URL(req.url);
  } catch {
    return;
  }
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    (async () => {
      const targetCache = cacheNameForUrl(req.url);
      try {
        const network = await fetch(req);
        if (network && network.ok) {
          const c = await caches.open(targetCache);
          c.put(req, network.clone());
        }
        return network;
      } catch {
        const hit = await caches.match(req);
        if (hit) return hit;
        if (req.mode === 'navigate') {
          const shell = await caches.match('./index.html');
          if (shell) return shell;
        }
        return Response.error();
      }
    })()
  );
});
