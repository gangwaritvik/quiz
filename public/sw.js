/*
 * SecureQuiz service worker.
 *
 * Scope is deliberately narrow. It caches only the static app shell so a brief
 * network blip does not blank the page mid-exam.
 *
 * It must NEVER cache:
 *   - anything under /api (a cached timer or attempt state would be worse than
 *     an error — the server clock is the only authority),
 *   - the /exam route (a stale question paper is a correctness bug),
 *   - authenticated HTML in general.
 *
 * Every request that is not a same-origin static asset falls through to the
 * network untouched.
 */

const CACHE_VERSION = 'securequiz-shell-v1';
const SHELL_ASSETS = ['/icons/icon.svg', '/manifest.webmanifest'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_VERSION)
      .then((cache) => cache.addAll(SHELL_ASSETS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== CACHE_VERSION).map((key) => caches.delete(key))),
      )
      .then(() => self.clients.claim()),
  );
});

function isCacheable(request) {
  if (request.method !== 'GET') return false;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return false;

  // Never serve exam or API traffic from a cache.
  if (url.pathname.startsWith('/api/')) return false;
  if (url.pathname.startsWith('/exam')) return false;

  // Static build output and public assets only.
  return (
    url.pathname.startsWith('/_next/static/') ||
    url.pathname.startsWith('/icons/') ||
    url.pathname === '/manifest.webmanifest'
  );
}

self.addEventListener('fetch', (event) => {
  if (!isCacheable(event.request)) return;

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;

      return fetch(event.request).then((response) => {
        // Only store complete, same-origin successes.
        if (!response || response.status !== 200 || response.type !== 'basic') {
          return response;
        }
        const copy = response.clone();
        void caches.open(CACHE_VERSION).then((cache) => cache.put(event.request, copy));
        return response;
      });
    }),
  );
});
