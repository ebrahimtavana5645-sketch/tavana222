// کپی امن پوشهٔ برنامه به مقصد (مقصد داخل پوشهٔ مبدأ است، پس cpSync مستقیم خطا می‌دهد)
// اگر nmDir داده شود، کتابخانه‌های اینترنتی (CDN) از node_modules در پوشهٔ lib کپی و در index.html جایگزین می‌شوند
// تا برنامه (EXE/APK) بدون اینترنت و بدون نیاز به دسترسی به cdnjs هم کار کند. اگر فایلی نبود، همان CDN می‌ماند.
const fs = require('fs'), path = require('path');
const SKIP_DIRS = new Set(['build-kits', '.github', 'node_modules', '.git', 'install-counter']);
const LIBS = [
  { cdn: 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js', from: 'html2canvas/dist/html2canvas.min.js', to: 'lib/html2canvas.min.js' },
  { cdn: 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js', from: 'jspdf/dist/jspdf.umd.min.js', to: 'lib/jspdf.umd.min.js' },
  { cdn: 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js', from: 'xlsx/dist/xlsx.full.min.js', to: 'lib/xlsx.full.min.js' },
  { cdn: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js', from: 'pdfjs-dist/build/pdf.min.js', to: 'lib/pdf.min.js' },
  { cdn: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js', from: 'pdfjs-dist/build/pdf.worker.min.js', to: 'lib/pdf.worker.min.js' }
];
function vendorLibs(dst, nmDir) {
  const htmlPath = path.join(dst, 'index.html');
  let html = fs.readFileSync(htmlPath, 'utf8'), n = 0;
  for (const l of LIBS) {
    const src = path.join(nmDir, l.from);
    if (!fs.existsSync(src)) { console.log('  (کتابخانه پیدا نشد، از اینترنت: ' + l.from + ')'); continue; }
    fs.mkdirSync(path.join(dst, 'lib'), { recursive: true });
    fs.copyFileSync(src, path.join(dst, l.to));
    html = html.split(l.cdn).join(l.to); n++;
  }
  fs.writeFileSync(htmlPath, html);
  console.log('کتابخانه‌های آفلاین: ' + n + ' از ' + LIBS.length);
}
// فونت‌های آفلاین: از بسته‌های @fontsource (npm) در پوشهٔ fonts کپی و به‌جای Google Fonts در index.html قرار می‌گیرند
const FONT_PKGS = [
  ['Vazirmatn', 'vazirmatn', [400, 500, 600, 700, 800, 900]], ['Noto Naskh Arabic', 'noto-naskh-arabic', [400, 600, 700]],
  ['Noto Kufi Arabic', 'noto-kufi-arabic', [400, 700]], ['Amiri', 'amiri', [400, 700]], ['Amiri Quran', 'amiri-quran', [400]],
  ['Aref Ruqaa', 'aref-ruqaa', [700]], ['Reem Kufi', 'reem-kufi', [400, 700]], ['Katibeh', 'katibeh', [400]],
  ['Scheherazade New', 'scheherazade-new', [400, 700]], ['Noto Nastaliq Urdu', 'noto-nastaliq-urdu', [400, 700]], ['Lateef', 'lateef', [400, 700]]
];
function vendorFonts(dst, nmDir) {
  const htmlPath = path.join(dst, 'index.html');
  let html = fs.readFileSync(htmlPath, 'utf8'), css = '', n = 0;
  for (const [family, pkg, weights] of FONT_PKGS) {
    const dir = path.join(nmDir, '@fontsource', pkg, 'files');
    if (!fs.existsSync(dir)) { console.log('  (فونت پیدا نشد، از اینترنت/سیستم: ' + family + ')'); continue; }
    const files = fs.readdirSync(dir);
    let got = false;
    for (const w of weights) for (const sub of ['arabic', 'latin']) {
      const f = pkg + '-' + sub + '-' + w + '-normal.woff2';
      if (!files.includes(f)) continue;
      fs.mkdirSync(path.join(dst, 'fonts'), { recursive: true });
      fs.copyFileSync(path.join(dir, f), path.join(dst, 'fonts', f));
      const range = sub === 'arabic' ? 'U+0600-06FF,U+200C-200E,U+2010-2011,U+204F,U+2E41,U+FB50-FDFF,U+FE80-FEFC' : 'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD';
      css += "@font-face{font-family:'" + family + "';font-style:normal;font-weight:" + w + ";font-display:swap;src:url(fonts/" + f + ") format('woff2');unicode-range:" + range + "}\n";
      got = true;
    }
    if (got) n++;
  }
  if (n) {
    html = html.replace(/<link[^>]*id="gfontsLink"[^>]*>/, '<style id="localFonts">\n' + css + '</style>');
    html = html.replace(/<link rel="preconnect"[^>]*fonts\.g[^>]*>\s*/g, '');
    fs.writeFileSync(htmlPath, html);
  }
  console.log('فونت‌های آفلاین: ' + n + ' از ' + FONT_PKGS.length);
}
module.exports = function copyApp(src, dst, nmDir) {
  fs.rmSync(dst, { recursive: true, force: true });
  (function walk(from, to) {
    fs.mkdirSync(to, { recursive: true });
    for (const e of fs.readdirSync(from, { withFileTypes: true })) {
      if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) walk(path.join(from, e.name), path.join(to, e.name)); }
      else if (!e.name.endsWith('.txt')) fs.copyFileSync(path.join(from, e.name), path.join(to, e.name));
    }
  })(src, dst);
  if (nmDir) { vendorLibs(dst, nmDir); try { vendorFonts(dst, nmDir); } catch (e) { console.log('فونت آفلاین ناموفق: ' + e.message); } }
};
