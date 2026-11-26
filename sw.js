/* Service worker: نصب‌پذیری و کار بدون اینترنت پس از اولین بار */
const VER = 'owqat-4.15.5';
const LOCAL = ['./', './index.html', './native-bridge.js', './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png', './cities/index.json', './help/step-01.webp', './help/step-02.webp', './help/step-03.webp', './help/step-04.webp', './help/step-05.webp', './help/step-06.webp', './help/step-07.webp', './help/step-08.webp', './help/step-09.webp', './help/step-10.webp'];
const CDN = [
  'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js'
];
self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const c = await caches.open(VER);
    await Promise.all(LOCAL.map(u => c.add(u).catch(() => {})));
    await Promise.all(CDN.map(u => c.add(new Request(u, { mode: 'no-cors' })).catch(() => {})));
    try { // فایل‌های اکسل شهرها
      const list = await (await fetch('./cities/index.json', { cache: 'no-store' })).json();
      await Promise.all(list.map(n => c.add('./cities/' + encodeURIComponent(n)).catch(() => {})));
    } catch (_) {}
    self.skipWaiting();
  })());
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith('owqat-') && k !== VER).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
/* ابتدا حافظهٔ نهان، همزمان به‌روزرسانی از شبکه (stale-while-revalidate) */
self.addEventListener('fetch', e => {
  const r = e.request;
  if (r.method !== 'GET' || !/^https?:/.test(r.url)) return;
  e.respondWith((async () => {
    const c = await caches.open(VER), hit = await c.match(r, { ignoreSearch: true });
    const net = fetch(r).then(res => { if (res && (res.ok || res.type === 'opaque')) c.put(r, res.clone()); return res; }).catch(() => null);
    return hit || (await net) || (r.mode === 'navigate' ? await c.match('./index.html') : Response.error());
  })());
});
