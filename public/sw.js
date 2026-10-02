// Service worker scoped to /__proxy/. It only controls proxied site documents,
// never the tester itself. Its job: make CORS-mode requests (web fonts, ES
// modules, fetch/XHR) work when a site runs from our origin, by routing them
// through the proxy. Everything else (images, CSS, classic scripts) goes
// straight to the real site untouched.
const PREFIX = '/__proxy/';
const META_CACHE = 'duo-meta';
const META_KEY = '/__duo_target';
let target = null;

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('message', (event) => {
  const data = event.data;
  if (!data || data.type !== 'duo-target' || !data.origin) return;
  target = data.origin;
  event.waitUntil(caches.open(META_CACHE).then((c) => c.put(META_KEY, new Response(target))));
});

async function currentTarget() {
  if (target) return target;
  const hit = await (await caches.open(META_CACHE)).match(META_KEY);
  if (hit) target = await hit.text();
  return target;
}

function proxyUrl(url) {
  return `${self.location.origin}${PREFIX}${url.protocol.slice(0, -1)}/${url.host}${url.pathname}${url.search}`;
}

async function viaProxy(request, url) {
  const headers = new Headers();
  for (const [k, v] of request.headers) {
    if (k !== 'origin' && k !== 'referer') headers.set(k, v);
  }
  const init = { method: request.method, headers, redirect: 'follow', credentials: 'omit' };
  if (request.method !== 'GET' && request.method !== 'HEAD') init.body = await request.arrayBuffer();
  return fetch(url, init);
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.mode === 'navigate') return;
  const url = new URL(request.url);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;

  if (url.origin === self.location.origin) {
    if (url.pathname.startsWith(PREFIX)) return;
    // The page built a URL from location.origin: it meant the real site.
    event.respondWith((async () => {
      const t = await currentTarget();
      if (!t) return fetch(request);
      return viaProxy(request, proxyUrl(new URL(url.pathname + url.search, t)));
    })());
    return;
  }

  if (request.mode === 'cors') {
    event.respondWith(viaProxy(request, proxyUrl(url)).catch(() => fetch(request)));
  }
});
