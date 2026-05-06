const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("path");

let SerialPort, ReadlineParser;
try {
  ({ SerialPort } = require("serialport"));
  ({ ReadlineParser } = require("@serialport/parser-readline"));
} catch(e) {
  console.error("serialport not available:", e.message);
}

let currentPort = null;
let mainWindow = null;

ipcMain.handle("serial:list", async () => {
  if (!SerialPort) return [];
  try {
    const ports = await SerialPort.list();
    return ports.map(p => ({
      path: p.path,
      friendlyName: p.friendlyName || p.manufacturer || p.path,
      manufacturer: p.manufacturer || ""
    }));
  } catch(e) { return []; }
});

ipcMain.handle("serial:open", async (event, portPath, baud) => {
  if (!SerialPort) throw new Error("serialport Modul nicht verfuegbar");
  if (currentPort && currentPort.isOpen) {
    try { await new Promise(r => currentPort.close(r)); } catch(e) {}
  }
  return new Promise((resolve, reject) => {
    const port = new SerialPort({ path: portPath, baudRate: Number(baud) }, (err) => {
      if (err) { reject(new Error(err.message)); return; }
      currentPort = port;
      const parser = port.pipe(new ReadlineParser({ delimiter: "\n" }));
      parser.on("data", (line) => {
        if (mainWindow && !mainWindow.isDestroyed())
          mainWindow.webContents.send("serial:line", line.trim());
      });
      port.on("close", () => {
        currentPort = null;
        if (mainWindow && !mainWindow.isDestroyed())
          mainWindow.webContents.send("serial:close");
      });
      port.on("error", (err) => {
        if (mainWindow && !mainWindow.isDestroyed())
          mainWindow.webContents.send("serial:error", err.message);
      });
      resolve(true);
    });
  });
});

ipcMain.handle("serial:close", async () => {
  if (!currentPort) return true;
  return new Promise((resolve) => {
    currentPort.close(() => { currentPort = null; resolve(true); });
  });
});

ipcMain.handle("serial:write", async (event, line) => {
  if (currentPort && currentPort.isOpen) currentPort.write(line + "\n");
});

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    title: "RasiCross Telemetry",
    icon: path.join(__dirname, "icon.ico"),
    backgroundColor: "#08080a",
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, "preload.js"),
    },
  });
  mainWindow.setMenuBarVisibility(false);
  mainWindow.loadFile("RasiCross_Telemetry.html");
}

app.whenReady().then(() => {
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => { app.quit(); });

let isQuitting = false;
app.on("before-quit", async (event) => {
  if (isQuitting) return;
  isQuitting = true;
  event.preventDefault();
  try {
    // Renderer Zeit geben, saveData() durchlaufen zu lassen
    const saves = BrowserWindow.getAllWindows().map(w =>
      w.webContents
        .executeJavaScript('if(typeof saveData==="function") saveData();')
        .catch(() => {})
    );
    await Promise.all(saves);
    // Erst danach den seriellen Port sauber schliessen
    if (currentPort && currentPort.isOpen) {
      await new Promise(r => currentPort.close(() => r()));
    }
  } catch(e) { /* still proceed with quit */ }
  app.exit(0);
});
