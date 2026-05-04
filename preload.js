const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("rasiSerial", {
  list: () => ipcRenderer.invoke("serial:list"),
  open: (path, baud) => ipcRenderer.invoke("serial:open", path, baud),
  close: () => ipcRenderer.invoke("serial:close"),
  writeLine: (line) => ipcRenderer.invoke("serial:write", line),
  onLine: (cb) => ipcRenderer.on("serial:line", (_, line) => cb(line)),
  onClose: (cb) => ipcRenderer.on("serial:close", () => cb()),
  onError: (cb) => ipcRenderer.on("serial:error", (_, msg) => cb(msg)),
});
