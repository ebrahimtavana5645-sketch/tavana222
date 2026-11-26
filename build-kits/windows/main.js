// برنامه را با یک سرور محلی کوچک اجرا می‌کند تا خواندن/ذخیرهٔ فایل‌های شهرها کار کند
const { app, BrowserWindow, shell, Notification, Tray, Menu, nativeImage, ipcMain, powerMonitor } = require('electron');
const fs = require('fs'), path = require('path');
const { createServer, prepareCitiesDir } = require('./server');
const { createNative, makeMute } = require('./native');
const root = path.join(__dirname, 'app');
const startHidden = process.argv.includes('--hidden');
let mainWindow = null, tray = null, quitting = false, native = null;

if (!app.requestSingleInstanceLock()) { app.quit(); } else {
  app.on('second-instance', () => showWindow());
}

function showWindow() {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show(); mainWindow.focus();
}
function ensureTray() {
  if (tray) return;
  try {
    const img = nativeImage.createFromPath(path.join(root, 'icons', 'icon-192.png')).resize({ width: 16, height: 16 });
    tray = new Tray(img);
    tray.setToolTip('اوقات شرعی');
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: 'نمایش', click: showWindow },
      { label: 'خروج', click: () => { quitting = true; app.quit(); } },
    ]));
    tray.on('click', showWindow);
  } catch (e) { console.error('tray', e.message); }
}

// پوشهٔ شهرها: نسخهٔ Portable → کنار فایل exe ؛ نسخهٔ نصبی → AppData\Roaming\<برنامه>\cities
// اگر ساخته نشد، به پوشهٔ دیگر و در آخر به اکسل‌های همراه برنامه برمی‌گردد.
function resolveCitiesDir() {
  const cands = [];
  if (process.env.PORTABLE_EXECUTABLE_DIR) cands.push(path.join(process.env.PORTABLE_EXECUTABLE_DIR, 'cities'));
  cands.push(path.join(app.getPath('userData'), 'cities'));
  cands.push(path.join(app.getPath('documents'), 'اوقات شرعی', 'cities'));
  for (const c of cands) { try { return prepareCitiesDir(c, path.join(root, 'cities')); } catch (_) {} }
  return path.join(root, 'cities');
}

app.whenReady().then(async () => {
  if (!app.hasSingleInstanceLock()) return;
  const userData = app.getPath('userData');
  native = createNative({
    dir: userData, Notification,
    mute: makeMute({ dir: userData, log: console.log }),
    log: console.log,
    onAlert: type => {
      // اگر پنجره باز و فعال است، صفحه خودش صدا پخش می‌کند؛ دوباره بوق نمی‌زنیم
      const focused = !!(mainWindow && mainWindow.isVisible() && mainWindow.isFocused());
      if (focused) return;
      try { require('electron').shell.beep(); } catch (_) {}
      if (!mainWindow) return;
      if (type === 'azan' || type === 'iqama') { if (!mainWindow.isVisible()) mainWindow.showInactive(); }
      try { mainWindow.flashFrame(true); } catch (_) {}
    },
    setLoginItem: v => app.setLoginItemSettings({ openAtLogin: v, openAsHidden: true, args: ['--hidden'] }),
    getLoginItem: () => app.getLoginItemSettings({ args: ['--hidden'] }).openAtLogin,
  });
  const H = (n, f) => ipcMain.handle('owqat:' + n, (_e, ...a) => f(...a));
  H('setSchedule', p => native.setSchedule(p)); H('cancelAll', () => native.cancelAll());
  H('getStatus', () => native.getStatus()); H('testAlarm', p => native.testAlarm(p));
  H('setAutoStart', v => native.setAutoStart(v)); H('setRunInBackground', v => native.setRunInBackground(v));
  powerMonitor.on('resume', () => native.onResume());
  native.start();

  const citiesDir = resolveCitiesDir();
  const { port } = await createServer({ root, citiesDir, onOpenCities: d => shell.openPath(d) });
  const w = mainWindow = new BrowserWindow({ width: 1100, height: 850, show: !startHidden, autoHideMenuBar: true, icon: path.join(root, 'icons', 'icon-512.png'), title: 'اوقات شرعی',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false } });
  w.loadURL(`http://127.0.0.1:${port}/index.html`);
  w.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
  w.on('focus', () => { try { w.flashFrame(false); } catch (_) {} });
  w.on('close', e => {
    if (!quitting && native && native.shouldStayInBackground()) { e.preventDefault(); ensureTray(); w.hide(); }
  });
  if (startHidden) ensureTray();
});
app.on('before-quit', () => { quitting = true; });
app.on('window-all-closed', () => app.quit());
