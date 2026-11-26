// منطق بومی ویندوز: زمان‌بند اعلان/اذان و حالت سکوت (قطع صدای سیستم)
// همهٔ بخش‌های وابسته به Electron از بیرون تزریق می‌شوند تا با node ساده قابل تست باشد.
'use strict';
const fs0 = require('fs'), path0 = require('path'), cp0 = require('child_process');

const STALE_MS = 2 * 60 * 1000, AHEAD_MS = 1500, GUARD_MS = 60 * 1000, MAX_TIMEOUT = 2147000000;
const TYPES = ['pre', 'azan', 'iqama', 'silentOn', 'silentOff'];

// ---------- قطع/وصل صدا با Core Audio (فقط ویندوز) ----------
const PS_SCRIPT = String.raw`param([string]$Action = 'get')
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
namespace Owqat {
  [Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IMMDeviceEnumerator {
    int EnumAudioEndpoints(int dataFlow, int stateMask, out IntPtr devices);
    int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice device);
    int GetDevice([MarshalAs(UnmanagedType.LPWStr)] string id, out IMMDevice device);
    int RegisterEndpointNotificationCallback(IntPtr client);
    int UnregisterEndpointNotificationCallback(IntPtr client);
  }
  [Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IMMDevice {
    int Activate(ref Guid iid, int clsCtx, IntPtr activationParams, [MarshalAs(UnmanagedType.IUnknown)] out object iface);
    int OpenPropertyStore(int access, out IntPtr properties);
    int GetId([MarshalAs(UnmanagedType.LPWStr)] out string id);
    int GetState(out int state);
  }
  [Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IAudioEndpointVolume {
    int RegisterControlChangeNotify(IntPtr notify);
    int UnregisterControlChangeNotify(IntPtr notify);
    int GetChannelCount(out uint count);
    int SetMasterVolumeLevel(float levelDB, ref Guid eventContext);
    int SetMasterVolumeLevelScalar(float level, ref Guid eventContext);
    int GetMasterVolumeLevel(out float levelDB);
    int GetMasterVolumeLevelScalar(out float level);
    int SetChannelVolumeLevel(uint channel, float levelDB, ref Guid eventContext);
    int SetChannelVolumeLevelScalar(uint channel, float level, ref Guid eventContext);
    int GetChannelVolumeLevel(uint channel, out float levelDB);
    int GetChannelVolumeLevelScalar(uint channel, out float level);
    int SetMute([MarshalAs(UnmanagedType.Bool)] bool mute, ref Guid eventContext);
    int GetMute([MarshalAs(UnmanagedType.Bool)] out bool mute);
    int GetVolumeStepInfo(out uint step, out uint stepCount);
    int VolumeStepUp(ref Guid eventContext);
    int VolumeStepDown(ref Guid eventContext);
    int QueryHardwareSupport(out uint mask);
    int GetVolumeRange(out float minDB, out float maxDB, out float incDB);
  }
  [ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]
  class MMDeviceEnumeratorComObject { }
  public static class Vol {
    static IAudioEndpointVolume Ep() {
      var en = (IMMDeviceEnumerator)(new MMDeviceEnumeratorComObject());
      IMMDevice dev; Marshal.ThrowExceptionForHR(en.GetDefaultAudioEndpoint(0, 1, out dev)); // eRender, eMultimedia
      Guid iid = typeof(IAudioEndpointVolume).GUID; object o;
      Marshal.ThrowExceptionForHR(dev.Activate(ref iid, 23, IntPtr.Zero, out o)); // CLSCTX_ALL
      return (IAudioEndpointVolume)o;
    }
    public static int Get() { bool m; Marshal.ThrowExceptionForHR(Ep().GetMute(out m)); return m ? 1 : 0; }
    public static void Set(bool m) { Guid g = Guid.Empty; Marshal.ThrowExceptionForHR(Ep().SetMute(m, ref g)); }
  }
}
"@
switch ($Action) {
  'mute'   { [Owqat.Vol]::Set($true) }
  'unmute' { [Owqat.Vol]::Set($false) }
  'get'    { }
  default  { throw "bad action" }
}
Write-Output ([Owqat.Vol]::Get())
`;

// mute(action) -> Promise<boolean muted>   ؛ action: get | mute | unmute
function makeMute({ platform = process.platform, spawn = cp0.spawn, fs = fs0, path = path0, dir, log = () => {} } = {}) {
  return function mute(action) {
    if (platform !== 'win32') { log('mute no-op (non-windows):', action); return Promise.resolve(false); }
    return new Promise((resolve, reject) => {
      let file;
      try {
        file = path.join(dir, 'audio-mute.ps1');
        // BOM تا PowerShell 5 فایل را UTF-8 بخواند
        fs.writeFileSync(file, '﻿' + PS_SCRIPT);
      } catch (e) { return reject(e); }
      let out = '', err = '', done = false;
      const p = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', file, action], { windowsHide: true });
      const fin = (f, v) => { if (!done) { done = true; clearTimeout(t); f(v); } };
      const t = setTimeout(() => { try { p.kill(); } catch (_) {} fin(reject, new Error('powershell timeout')); }, 20000);
      p.stdout && p.stdout.on('data', d => out += d);
      p.stderr && p.stderr.on('data', d => err += d);
      p.on('error', e => fin(reject, e));
      p.on('close', code => {
        const m = /(^|\s)([01])\s*$/.exec(out);
        if (code === 0 && m) fin(resolve, m[2] === '1');
        else fin(reject, new Error('powershell exit ' + code + ' ' + err.slice(0, 300)));
      });
    });
  };
}

// ---------- هستهٔ زمان‌بند ----------
function createNative(opts) {
  const o = Object.assign({
    dir: '.', fs: fs0, path: path0, Notification: null, now: () => Date.now(),
    setTimeout, clearTimeout, setInterval, clearInterval,
    mute: async () => false, onAlert: () => {}, onChange: () => {},
    platform: process.platform, log: () => {}, setLoginItem: null, getLoginItem: null,
  }, opts);
  const { fs, path } = o;
  const F = n => path.join(o.dir, n);
  function readJson(n, d) { try { return JSON.parse(fs.readFileSync(F(n), 'utf8')); } catch (_) { return d; } }
  function writeJson(n, v) { try { fs.mkdirSync(o.dir, { recursive: true }); fs.writeFileSync(F(n), JSON.stringify(v)); } catch (e) { o.log('persist failed', n, e.message); } }

  let sched = readJson('schedule.json', { events: [], silentMode: 'silent', fired: [] });
  if (!Array.isArray(sched.events)) sched.events = [];
  if (!Array.isArray(sched.fired)) sched.fired = [];
  let muteState = readJson('mute-state.json', { weMuted: false, until: 0 });
  let settings = Object.assign({ runInBackground: true }, readJson('settings.json', {}));
  let timer = null, guard = null, chain = Promise.resolve();

  const key = e => e.type + '@' + e.at;
  const saveSched = () => writeJson('schedule.json', sched);
  const saveMute = () => writeJson('mute-state.json', muteState);
  const queue = fn => (chain = chain.then(fn, fn).catch(e => { o.log('error', e && e.message); }));

  function pending() { return sched.events.filter(e => !e.done); }
  function hasFutureEvents() { const n = o.now(); return sched.events.some(e => !e.done && e.at > n); }

  function arm() {
    if (timer) { o.clearTimeout(timer); timer = null; }
    const p = pending().sort((a, b) => a.at - b.at)[0];
    if (!p) return;
    const wait = Math.min(Math.max(p.at - AHEAD_MS - o.now(), 0), MAX_TIMEOUT);
    timer = o.setTimeout(() => { timer = null; tick(); }, wait);
  }

  async function doMute(on, until) {
    try {
      const cur = await o.mute('get');
      if (on) {
        if (muteState.weMuted) { muteState.until = Math.max(muteState.until || 0, until || 0); if (!cur) await o.mute('mute'); }
        else if (cur) { /* قبلاً توسط کاربر قطع بوده؛ دست نمی‌زنیم */ }
        else { await o.mute('mute'); muteState = { weMuted: true, until: until || 0 }; }
      } else if (muteState.weMuted) {
        if (cur) await o.mute('unmute');
        muteState = { weMuted: false, until: 0 };
      }
      saveMute();
    } catch (e) { o.log('mute failed', e && e.message); }
  }

  function notify(ev) {
    try {
      if (o.Notification && (!o.Notification.isSupported || o.Notification.isSupported())) {
        new o.Notification({ title: ev.title || '', body: ev.body || '', urgency: 'critical', silent: false }).show();
      }
    } catch (e) { o.log('notify failed', e.message); }
    try { o.onAlert(ev.type, ev); } catch (e) { o.log('alert failed', e.message); }
  }

  async function runEvent(ev) {
    const n = o.now();
    if (ev.type === 'silentOff') return doMute(false);
    if (n - ev.at > STALE_MS) return;
    if (ev.type === 'silentOn') {
      if (ev.until && ev.until <= n) return;
      return doMute(true, ev.until);
    }
    if (ev.type === 'pre' || ev.type === 'azan' || ev.type === 'iqama') notify(ev);
  }

  // پایان سکوتِ گذشته (پس از ری‌استارت یا اگر silentOff از دست رفت)
  async function expireMute() {
    if (muteState.weMuted && muteState.until && muteState.until <= o.now()) await doMute(false);
  }

  function tick() {
    return queue(async () => {
      const lim = o.now() + AHEAD_MS;
      const due = pending().filter(e => e.at <= lim).sort((a, b) => a.at - b.at);
      for (const ev of due) {
        ev.done = true;
        if (sched.fired.indexOf(key(ev)) < 0) sched.fired.push(key(ev));
        await runEvent(ev);
      }
      await expireMute();
      const cutoff = o.now() - 24 * 3600 * 1000;
      sched.events = sched.events.filter(e => !e.done || e.at > cutoff);
      sched.fired = sched.fired.filter(k => Number(k.split('@')[1]) > cutoff);
      saveSched(); arm(); o.onChange();
    });
  }

  function start() {
    if (!guard) guard = o.setInterval(() => { tick(); }, GUARD_MS);
    return tick();
  }
  function stop() { if (timer) o.clearTimeout(timer); if (guard) o.clearInterval(guard); timer = guard = null; }
  const onResume = () => tick();

  async function setSchedule(p) {
    p = p || {};
    const evs = (Array.isArray(p.events) ? p.events : [])
      .filter(e => e && TYPES.indexOf(e.type) >= 0 && Number.isFinite(Number(e.at)))
      .map(e => ({ at: Number(e.at), type: e.type, title: String(e.title || ''), body: String(e.body || ''), until: e.until ? Number(e.until) : undefined }));
    const seen = {};
    const uniq = evs.filter(e => { const k = key(e); if (seen[k]) return false; seen[k] = 1; return true; });
    uniq.forEach(e => { if (sched.fired.indexOf(key(e)) >= 0) e.done = true; });
    sched.events = uniq;
    sched.silentMode = p.silentMode === 'vibrate' ? 'vibrate' : 'silent';
    saveSched();
    await tick();
    return { scheduled: pending().length };
  }
  async function cancelAll() {
    sched.events = []; saveSched();
    if (timer) { o.clearTimeout(timer); timer = null; }
    await tick();
    return {};
  }
  async function getStatus() {
    let autoStart = false;
    try { if (o.getLoginItem) autoStart = !!o.getLoginItem(); } catch (_) {}
    return {
      platform: 'windows',
      notifications: !!(o.Notification && o.Notification.isSupported && o.Notification.isSupported()),
      canMute: true, silentActive: !!muteState.weMuted, autoStart, runInBackground: !!settings.runInBackground,
    };
  }
  async function testAlarm(p) {
    p = p || {};
    notify({ type: 'azan', title: p.title || 'اوقات شرعی', body: p.body || '' });
    return {};
  }
  async function setAutoStart(v) { try { if (o.setLoginItem) o.setLoginItem(!!v); } catch (e) { o.log('autostart failed', e.message); } return { autoStart: !!v }; }
  async function setRunInBackground(v) { settings.runInBackground = !!v; writeJson('settings.json', settings); o.onChange(); return { runInBackground: settings.runInBackground }; }

  return {
    start, stop, tick, onResume, setSchedule, cancelAll, getStatus, testAlarm, setAutoStart, setRunInBackground,
    hasFutureEvents, shouldStayInBackground: () => !!settings.runInBackground && hasFutureEvents(),
    _state: () => ({ sched, muteState, settings, timer: !!timer }),
  };
}

module.exports = { createNative, makeMute, PS_SCRIPT, STALE_MS, AHEAD_MS };
