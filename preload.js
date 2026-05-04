// ============================================================
//  RasiCross Telemetry --  Electron-Preload
// ============================================================
//  Stellt im Renderer `window.rasiSerial` bereit. Das Dashboard
//  (HTML) verwendet diese API, wenn es in Electron laeuft.
// ============================================================

const { contextBridge, ipcRenderer } = require('electron');

let lineCb = null;
let closeCb = null;
let errorCb = null;

ipcRenderer.on('serial:line', (_e, line) => {
  if (!lineCb) return;
  try { lineCb(line); }
  catch (e) { console.error('rasiSerial.onLine:', e); }
});

ipcRenderer.on('serial:close', () => {
  if (!closeCb) return;
  try { closeCb(); }
  catch (e) { console.error('rasiSerial.onClose:', e); }
});

ipcRenderer.on('serial:error', (_e, msg) => {
  if (!errorCb) return;
  try { errorCb(msg); }
  catch (e) { console.error('rasiSerial.onError:', e); }
});

contextBridge.exposeInMainWorld('rasiSerial', {
  list:      ()                => ipcRenderer.invoke('serial:list'),
  open:      (portPath, baud)  => ipcRenderer.invoke('serial:open', portPath, baud),
  close:     ()                => ipcRenderer.invoke('serial:close'),
  writeLine: (line)            => ipcRenderer.invoke('serial:write', line),
  onLine:    (cb) => { lineCb  = typeof cb === 'function' ? cb : null; },
  onClose:   (cb) => { closeCb = typeof cb === 'function' ? cb : null; },
  onError:   (cb) => { errorCb = typeof cb === 'function' ? cb : null; },
});
