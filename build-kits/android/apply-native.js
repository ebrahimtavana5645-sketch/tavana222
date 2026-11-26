// بعد از «npx cap add android» اجرا شود؛ کد بومی آلارم/بی‌صدا را به پروژهٔ اندروید اضافه می‌کند.
// چند بار اجرا کردن بی‌خطر است (idempotent).
const fs = require('fs'), path = require('path');

const root = path.join(__dirname, 'android');
const mainDir = path.join(root, 'app', 'src', 'main');
const manifestPath = path.join(mainDir, 'AndroidManifest.xml');
if (!fs.existsSync(manifestPath)) { console.log('پوشهٔ android پیدا نشد؛ اول npx cap add android'); process.exit(0); }

// appId از capacitor.config.json (پیش‌فرض ir.owqat.prayertimes)
let appId = 'ir.owqat.prayertimes';
try { appId = JSON.parse(fs.readFileSync(path.join(__dirname, 'capacitor.config.json'), 'utf8')).appId || appId; } catch (e) {}

// ۱) کپی فایل‌های جاوا (با اصلاح خط package)
const srcDir = path.join(__dirname, 'native');
const javaDir = path.join(mainDir, 'java', ...appId.split('.'));
fs.mkdirSync(javaDir, { recursive: true });
for (const f of fs.readdirSync(srcDir).filter(n => n.endsWith('.java'))) {
  const code = fs.readFileSync(path.join(srcDir, f), 'utf8').replace(/^package\s+[\w.]+;/m, 'package ' + appId + ';');
  const dest = path.join(javaDir, f);
  if (!fs.existsSync(dest) || fs.readFileSync(dest, 'utf8') !== code) fs.writeFileSync(dest, code);
}
console.log('فایل‌های جاوا کپی شد:', javaDir);

// ۲) پچ AndroidManifest.xml (هر مورد فقط اگر وجود نداشته باشد)
let xml = fs.readFileSync(manifestPath, 'utf8');
const perms = ['POST_NOTIFICATIONS', 'SCHEDULE_EXACT_ALARM', 'USE_EXACT_ALARM', 'RECEIVE_BOOT_COMPLETED',
  'VIBRATE', 'WAKE_LOCK', 'USE_FULL_SCREEN_INTENT', 'ACCESS_NOTIFICATION_POLICY'];
let permXml = '';
for (const p of perms) {
  if (!xml.includes('android:name="android.permission.' + p + '"'))
    permXml += '    <uses-permission android:name="android.permission.' + p + '" />\n';
}
if (permXml) {
  if (!xml.includes('</manifest>')) throw new Error('</manifest> در AndroidManifest.xml نیست');
  xml = xml.replace('</manifest>', permXml + '</manifest>');
}
let recXml = '';
if (!xml.includes('android:name=".AlarmReceiver"'))
  recXml += '        <receiver android:name=".AlarmReceiver" android:exported="false" />\n';
if (!xml.includes('android:name=".BootReceiver"'))
  recXml += '        <receiver android:name=".BootReceiver" android:exported="true">\n' +
    '            <intent-filter>\n' +
    '                <action android:name="android.intent.action.BOOT_COMPLETED" />\n' +
    '                <action android:name="android.intent.action.TIME_SET" />\n' +
    '                <action android:name="android.intent.action.TIMEZONE_CHANGED" />\n' +
    '                <action android:name="android.intent.action.MY_PACKAGE_REPLACED" />\n' +
    '            </intent-filter>\n' +
    '        </receiver>\n';
if (recXml) {
  if (!xml.includes('</application>')) throw new Error('</application> در AndroidManifest.xml نیست');
  xml = xml.replace('</application>', recXml + '    </application>');
}
if (permXml || recXml) fs.writeFileSync(manifestPath, xml);
console.log('AndroidManifest.xml پچ شد' + (permXml || recXml ? '' : ' (از قبل کامل بود)'));
