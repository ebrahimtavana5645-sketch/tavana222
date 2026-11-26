/* پل بومی اندروید (Capacitor): ذخیره و ارسال فایل‌های عکس/PDF/ZIP/اکسل
   در WebView اندروید «دانلود با لینک» و navigator.share(files) کار نمی‌کند؛ این فایل آن‌ها را
   با افزونه‌های Filesystem و Share اندروید جایگزین می‌کند. در مرورگر و ویندوز هیچ کاری نمی‌کند. */
(function () {
  'use strict';
  var installed = false;
  function isNative() {
    var cap = window.Capacitor;
    try { return !!(cap && (cap.isNativePlatform ? cap.isNativePlatform() : (cap.getPlatform && cap.getPlatform() !== 'web'))); } catch (e) { return false; }
  }
  function plug(n) { var P = (window.Capacitor && window.Capacitor.Plugins) || {}; return P[n]; }
  var FS = { writeFile: function (o) { return plug('Filesystem').writeFile(o); }, getUri: function (o) { return plug('Filesystem').getUri(o); } };
  var SH = { share: function (o) { return plug('Share').share(o); } };

  var FOLDER = 'PrayerTimes';

  function toast(msg) {
    try {
      var t = document.getElementById('nbToast');
      if (!t) {
        t = document.createElement('div'); t.id = 'nbToast';
        t.style.cssText = 'position:fixed;left:50%;bottom:84px;transform:translateX(-50%);max-width:88vw;background:rgba(20,20,20,.92);color:#fff;padding:.6rem 1rem;border-radius:12px;z-index:2147483000;font-family:inherit;font-weight:600;font-size:.85rem;line-height:1.8;text-align:center;direction:rtl;box-shadow:0 4px 16px rgba(0,0,0,.4);transition:opacity .3s;pointer-events:none';
        document.body.appendChild(t);
      }
      t.textContent = msg; t.style.opacity = '1';
      clearTimeout(t._h); t._h = setTimeout(function () { t.style.opacity = '0'; }, 4200);
    } catch (e) {}
  }

  function safeName(n) {
    n = String(n || 'file').replace(/[\\\/:*?"<>|\u0000-\u001f]+/g, '-').replace(/\s+/g, ' ').trim();
    return n || 'file';
  }

  function blobToBase64(blob) {
    return new Promise(function (res, rej) {
      var r = new FileReader();
      r.onload = function () { var s = String(r.result || ''); res(s.slice(s.indexOf(',') + 1)); };
      r.onerror = function () { rej(r.error || new Error('خواندن فایل ناموفق بود')); };
      r.readAsDataURL(blob);
    });
  }

  async function writeTo(dir, path, blob) {
    var data = await blobToBase64(blob);
    await FS.writeFile({ path: path, data: data, directory: dir, recursive: true });
    var u = await FS.getUri({ path: path, directory: dir });
    return u.uri;
  }

  /* ارسال: فایل‌ها را در حافظهٔ موقت می‌نویسد و برگهٔ اشتراک‌گذاری اندروید را باز می‌کند */
  async function shareFiles(files, title, text) {
    if (!plug('Share')) throw new Error('افزونهٔ اشتراک‌گذاری در این نسخه نیست');
    var uris = [];
    for (var i = 0; i < files.length; i++) {
      uris.push(await writeTo('CACHE', 'share/' + safeName(files[i].name), files[i]));
    }
    try {
      await SH.share({ title: title || 'اوقات شرعی', text: text || undefined, files: uris, dialogTitle: 'ارسال' });
    } catch (e) {
      var m = String((e && e.message) || e || '');
      if (/cancel/i.test(m)) { var a = new Error('canceled'); a.name = 'AbortError'; throw a; }
      throw e;
    }
  }

  /* ذخیره: در پوشهٔ Documents/PrayerTimes؛ اگر نشد، برگهٔ اشتراک‌گذاری (ذخیره در فایل‌ها/درایو/ارسال) */
  var shareQueue = Promise.resolve();
  async function saveBlob(blob, name) {
    name = safeName(name);
    try {
      await writeTo('DOCUMENTS', FOLDER + '/' + name, blob);
      toast('✅ ذخیره شد: Documents/' + FOLDER + '/' + name);
    } catch (e) {
      shareQueue = shareQueue.then(function () {
        return shareFiles([new File([blob], name, { type: blob.type || 'application/octet-stream' })], name)
          .catch(function (er) { if (!er || er.name !== 'AbortError') toast('ذخیرهٔ فایل ناموفق بود: ' + ((er && er.message) || er)); });
      });
    }
  }

  function install() {
    if (installed || !isNative() || !plug('Filesystem')) return;
    installed = true;
    /* ---- ۱) navigator.share / canShare ---- */
    function defineNav(k, v) { try { Object.defineProperty(navigator, k, { value: v, configurable: true, writable: true }); } catch (e) { try { navigator[k] = v; } catch (e2) {} } }
    defineNav('canShare', function (d) { return !!d && (!d.files || d.files.length > 0); });
    defineNav('share', async function (d) {
      d = d || {};
      if (d.files && d.files.length) return shareFiles(Array.prototype.slice.call(d.files), d.title, d.text);
      if (!plug('Share')) throw new Error('اشتراک‌گذاری در دسترس نیست');
      try { await SH.share({ title: d.title, text: d.text, url: d.url, dialogTitle: 'ارسال' }); }
      catch (e) { if (/cancel/i.test(String((e && e.message) || e))) { var a = new Error('canceled'); a.name = 'AbortError'; throw a; } throw e; }
    });

    /* ---- ۲) هر لینک دانلود (blob:/data:) → ذخیرهٔ بومی ---- */
    function handleAnchor(a) {
      try {
        if (!a || !a.hasAttribute || !a.hasAttribute('download')) return false;
        var href = a.href || '';
        if (!/^(blob:|data:)/i.test(href)) return false;
        var name = a.getAttribute('download') || 'file';
        fetch(href).then(function (r) { return r.blob(); }).then(function (b) { return saveBlob(b, name); })
          .catch(function (e) { toast('ذخیرهٔ فایل ناموفق بود: ' + ((e && e.message) || e)); });
        return true;
      } catch (e) { return false; }
    }
    var origClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () { if (handleAnchor(this)) return; return origClick.apply(this, arguments); };
    var origDispatch = EventTarget.prototype.dispatchEvent;
    EventTarget.prototype.dispatchEvent = function (ev) {
      if (this instanceof HTMLAnchorElement && ev && ev.type === 'click' && handleAnchor(this)) return true;
      return origDispatch.apply(this, arguments);
    };


  }
  install();
  document.addEventListener('DOMContentLoaded', install);
  window.addEventListener('load', install);
  setTimeout(install, 500); setTimeout(install, 2000);

  window.__nativeSaveBlob = saveBlob;
  function mark() { if (isNative()) document.documentElement.classList.add('is-native-app'); }
  mark(); document.addEventListener('DOMContentLoaded', mark);
})();
