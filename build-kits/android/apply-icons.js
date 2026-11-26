// بعد از «npx cap add android» آیکن برنامه را با آیکن Tavana جایگزین می‌کند
const fs = require('fs'), path = require('path');
const icons = path.resolve(__dirname, '..', '..', 'icons');
const res = path.join(__dirname, 'android', 'app', 'src', 'main', 'res');
if (!fs.existsSync(res)) { console.log('پوشهٔ android پیدا نشد؛ اول npx cap add android'); process.exit(0); }
for (const d of fs.readdirSync(res).filter(n => /^mipmap-(mdpi|hdpi|xhdpi|xxhdpi|xxxhdpi)$/.test(n))) {
  const dir = path.join(res, d);
  fs.copyFileSync(path.join(icons, 'icon-192.png'), path.join(dir, 'ic_launcher.png'));
  fs.copyFileSync(path.join(icons, 'icon-192.png'), path.join(dir, 'ic_launcher_round.png'));
  fs.copyFileSync(path.join(icons, 'icon-maskable-512.png'), path.join(dir, 'ic_launcher_foreground.png'));
}
const bg = path.join(res, 'values', 'ic_launcher_background.xml');
if (fs.existsSync(bg)) fs.writeFileSync(bg, '<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">#0F5A3D</color>\n</resources>\n');
console.log('آیکن‌ها جایگزین شد');
