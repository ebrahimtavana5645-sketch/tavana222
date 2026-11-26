/**
 * شمارندهٔ ناشناس نصب «اوقات شرعی» — Google Apps Script
 * هر دستگاه یک شناسهٔ تصادفی دارد (بدون نام، شماره یا مکان). سطرها در یک Google Sheet ذخیره می‌شوند.
 * راه‌اندازی: راهنما-شمارنده-نصب.md
 */
var SHEET = 'installs';

function sheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(SHEET);
  if (!sh) {
    sh = ss.insertSheet(SHEET);
    sh.appendRow(['id', 'platform', 'version', 'first_seen', 'last_seen', 'launches']);
    sh.setFrozenRows(1);
  }
  return sh;
}

function out_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

function doGet(e) {
  var p = (e && e.parameter) || {};
  if (p.a === 'stats') return stats_(p);
  return ping_(p);
}

function ping_(p) {
  var id = String(p.id || ''), plat = String(p.p || 'web'), ver = String(p.v || '').slice(0, 20);
  if (!/^[A-Za-z0-9-]{8,64}$/.test(id)) return out_({ ok: false });
  if (['apk', 'exe', 'pwa', 'web'].indexOf(plat) < 0) plat = 'web';
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var sh = sheet_(), now = new Date();
    var last = sh.getLastRow();
    var ids = last > 1 ? sh.getRange(2, 1, last - 1, 1).getValues() : [];
    var row = -1;
    for (var i = 0; i < ids.length; i++) { if (ids[i][0] === id) { row = i + 2; break; } }
    if (row < 0) {
      sh.appendRow([id, plat, ver, now, now, 1]);
    } else {
      var cur = sh.getRange(row, 1, 1, 6).getValues()[0];
      // اگر قبلاً «web» ثبت شده و حالا نصب‌شده است، پلتفرم ارتقا می‌یابد
      var newPlat = (cur[1] === 'web' && plat !== 'web') ? plat : cur[1];
      sh.getRange(row, 2, 1, 5).setValues([[newPlat, ver || cur[2], cur[3], now, Number(cur[5] || 0) + 1]]);
    }
  } finally { lock.releaseLock(); }
  return out_({ ok: true });
}

function stats_(p) {
  var key = PropertiesService.getScriptProperties().getProperty('ADMIN_KEY');
  if (!key || p.key !== key) return out_({ ok: false, error: 'unauthorized' });
  var sh = sheet_(), last = sh.getLastRow();
  var rows = last > 1 ? sh.getRange(2, 1, last - 1, 6).getValues() : [];
  var now = Date.now(), DAY = 86400000;
  var byPlat = { apk: 0, exe: 0, pwa: 0, web: 0 };
  var active7 = 0, active30 = 0, versions = {}, daily = {};
  rows.forEach(function (r) {
    byPlat[r[1]] = (byPlat[r[1]] || 0) + 1;
    var ls = new Date(r[4]).getTime(), fs = new Date(r[3]);
    if (now - ls <= 7 * DAY) active7++;
    if (now - ls <= 30 * DAY) active30++;
    versions[r[2] || '?'] = (versions[r[2] || '?'] || 0) + 1;
    if (now - fs.getTime() <= 30 * DAY) {
      var d = Utilities.formatDate(fs, Session.getScriptTimeZone(), 'yyyy-MM-dd');
      daily[d] = (daily[d] || 0) + 1;
    }
  });
  return out_({
    ok: true,
    total_devices: rows.length,
    installs: byPlat.apk + byPlat.exe + byPlat.pwa,   // نصب‌شده‌ها (بدون بازدید مرورگر)
    by_platform: byPlat,
    active_7d: active7,
    active_30d: active30,
    versions: versions,
    new_per_day_30d: daily
  });
}
