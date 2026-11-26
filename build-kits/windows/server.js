// سرور محلی کوچک برنامه (بدون وابستگی به Electron تا جداگانه قابل آزمایش باشد)
// - فایل‌های برنامه را از root می‌دهد
// - پوشهٔ شهرها (citiesDir) قابل‌نوشتن است: فهرست آن به‌صورت زنده ساخته می‌شود و اکسل شهرهای تازه ذخیره می‌شود
const http = require('http'), fs = require('fs'), path = require('path');

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.xls': 'application/vnd.ms-excel', '.webmanifest': 'application/manifest+json', '.css': 'text/css; charset=utf-8' };
const isSheet = n => /\.xlsx?$/i.test(n) && !n.startsWith('~$');

// پوشهٔ شهرها را می‌سازد و اکسل‌های همراه برنامه را (فقط اگر نبودند) در آن کپی می‌کند
function prepareCitiesDir(dir, bundledDir) {
  fs.mkdirSync(dir, { recursive: true });
  fs.accessSync(dir, fs.constants.W_OK);
  let names = [];
  try { names = fs.readdirSync(bundledDir).filter(isSheet); } catch (_) {}
  for (const n of names) {
    const to = path.join(dir, n);
    if (!fs.existsSync(to)) { try { fs.copyFileSync(path.join(bundledDir, n), to); } catch (_) {} }
  }
  return dir;
}

function createServer({ root, citiesDir, onOpenCities }) {
  const json = (rsp, code, o) => { rsp.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); rsp.end(JSON.stringify(o)); };
  let origin = '';
  const srv = http.createServer((req, rsp) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    let p; try { p = decodeURIComponent(url.pathname); } catch (_) { rsp.writeHead(400); return rsp.end(); }

    // ---- API ذخیره/باز کردن پوشهٔ شهرها (فقط از خود برنامه) ----
    if (p.startsWith('/__cities/')) {
      if (req.method !== 'POST' || (req.headers.origin && req.headers.origin !== origin)) return json(rsp, 403, { ok: false, error: 'forbidden' });
      if (p === '/__cities/open') { try { onOpenCities && onOpenCities(citiesDir); } catch (_) {} return json(rsp, 200, { ok: true, dir: citiesDir }); }
      if (p === '/__cities/save') {
        const name = path.basename(url.searchParams.get('name') || '').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_');
        if (!isSheet(name)) return json(rsp, 400, { ok: false, error: 'فقط فایل اکسل (xlsx) پذیرفته می‌شود' });
        const chunks = []; let size = 0, dead = false;
        req.on('data', c => { size += c.length; if (size > 20 * 1024 * 1024) { dead = true; json(rsp, 413, { ok: false, error: 'فایل بزرگ است' }); req.destroy(); } else chunks.push(c); });
        req.on('end', () => {
          if (dead) return;
          try { fs.mkdirSync(citiesDir, { recursive: true }); fs.writeFileSync(path.join(citiesDir, name), Buffer.concat(chunks)); json(rsp, 200, { ok: true, dir: citiesDir }); }
          catch (e) { json(rsp, 500, { ok: false, error: String(e.message || e) }); }
        });
        return;
      }
      return json(rsp, 404, { ok: false });
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') { rsp.writeHead(405); return rsp.end(); }

    // ---- پوشهٔ شهرها: فهرست زنده + فایل‌ها ----
    if (p === '/cities/index.json') {
      let names = []; try { names = fs.readdirSync(citiesDir).filter(isSheet).sort(); } catch (_) {}
      return json(rsp, 200, names);
    }
    let file;
    if (p.startsWith('/cities/')) {
      const n = path.basename(p);
      file = isSheet(n) ? path.join(citiesDir, n) : null;
      if (!file || !fs.existsSync(file)) file = path.join(root, 'cities', n);   // نسخهٔ همراه برنامه
    } else {
      if (p === '/') p = '/index.html';
      file = path.join(root, path.normalize(p));
      if (file !== root && !file.startsWith(root + path.sep)) { rsp.writeHead(403); return rsp.end(); }
    }
    fs.readFile(file, (e, d) => {
      if (e) { rsp.writeHead(404); return rsp.end(); }
      rsp.writeHead(200, { 'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      rsp.end(req.method === 'HEAD' ? undefined : d);
    });
  });
  return new Promise(res => srv.listen(0, '127.0.0.1', () => { const port = srv.address().port; origin = `http://127.0.0.1:${port}`; res({ server: srv, port, origin }); }));
}

module.exports = { createServer, prepareCitiesDir };
