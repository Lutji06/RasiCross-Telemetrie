const { contextBridge, ipcRenderer } = require("electron");

let lineCb = null;
let closeCb = null;
let errorCb = null;

ipcRenderer.on("serial:line",  (_, line) => { if (lineCb)  try { lineCb(line);  } catch(e) { console.error(e); } });
ipcRenderer.on("serial:close", ()        => { if (closeCb) try { closeCb();      } catch(e) { console.error(e); } });
ipcRenderer.on("serial:error", (_, msg)  => { if (errorCb) try { errorCb(msg);   } catch(e) { console.error(e); } });

contextBridge.exposeInMainWorld("rasiSerial", {
  list: () => ipcRenderer.invoke("serial:list"),
  open: (path, baud) => ipcRenderer.invoke("serial:open", path, baud),
  close: () => ipcRenderer.invoke("serial:close"),
  writeLine: (line) => ipcRenderer.invoke("serial:write", line),
  onLine:  (cb) => { lineCb  = typeof cb === "function" ? cb : null; },
  onClose: (cb) => { closeCb = typeof cb === "function" ? cb : null; },
  onError: (cb) => { errorCb = typeof cb === "function" ? cb : null; },
});

contextBridge.exposeInMainWorld("rasiKart", {
  saveKartModel:  (uint8) => ipcRenderer.invoke("rasi-kart:save", uint8),
  loadKartModel:  ()      => ipcRenderer.invoke("rasi-kart:load"),
  clearKartModel: ()      => ipcRenderer.invoke("rasi-kart:clear"),
});
