// پل امن بین صفحهٔ وب و پردازش اصلی (contextIsolation فعال است)
const { contextBridge, ipcRenderer } = require('electron');
const call = ch => (...a) => ipcRenderer.invoke('owqat:' + ch, ...a);
contextBridge.exposeInMainWorld('owqatDesktop', {
  setSchedule: call('setSchedule'),
  cancelAll: call('cancelAll'),
  getStatus: call('getStatus'),
  testAlarm: call('testAlarm'),
  setAutoStart: call('setAutoStart'),
  setRunInBackground: call('setRunInBackground'),
  openDndSettings: () => Promise.resolve({}),
  openExactAlarmSettings: () => Promise.resolve({}),
  requestNotifications: () => Promise.resolve({}),
});
