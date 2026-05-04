// ============================================================
//  RasiCross Telemetry --  Electron-Hauptprozess
// ============================================================
//  Lädt das HTML-Dashboard in ein natives Fenster und stellt
//  ueber IPC eine SerialPort-Bruecke bereit. Das Dashboard
//  erwartet `window.rasiSerial` (siehe preload.js) mit:
//    list()                -> [{path, friendlyName, manufacturer, vendorId, productId}]
//    open(path, baud)      -> Promise
//    close()               -> Promise
//    writeLine(line)       -> Promise
//    onLine(cb), onClose(cb), onError(cb)
// ============================================================

const { app, BrowserWindow, ipcMain, Menu } = require('electron');
const path = require('path');
const { SerialPort } = require('serialport');

let currentPort = null;
let portBuffer = '';
let quitting = false;

function broadcast(channel, ...args) {
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) w.webContents.send(channel, ...args);
  }
}

function closePort() {
  return new Promise((resolve) => {
    const p = currentPort;
    currentPort = null;
    portBuffer = '';
    if (p && p.isOpen) p.close(() => resolve());
    else resolve();
  });
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    title: 'RasiCross Telemetrie v9.6',
    backgroundColor: '#0a0a0d',
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  win.loadFile('RasiCross_Telemetry_v9_6.html');
  return win;
}

// ── IPC: Serial-API für das Dashboard ─────────────────────────────────────

ipcMain.handle('serial:list', async () => {
  const ports = await SerialPort.list();
  return ports.map((p) => ({
    path: p.path,
    friendlyName: p.friendlyName || '',
    manufacturer: p.manufacturer || '',
    vendorId: p.vendorId || '',
    productId: p.productId || '',
  }));
});

ipcMain.handle('serial:open', async (_event, portPath, baudRate) => {
  await closePort();

  const port = new SerialPort({
    path: portPath,
    baudRate: Number(baudRate) || 115200,
    autoOpen: false,
  });

  port.on('data', (chunk) => {
    portBuffer += chunk.toString('utf-8');
    const lines = portBuffer.split(/\r?\n/);
    portBuffer = lines.pop() || '';
    for (const line of lines) broadcast('serial:line', line);
  });

  port.on('close', () => {
    if (port === currentPort) currentPort = null;
    broadcast('serial:close');
  });

  port.on('error', (err) => {
    broadcast('serial:error', String((err && err.message) || err));
  });

  await new Promise((resolve, reject) => {
    port.open((err) => (err ? reject(err) : resolve()));
  });

  currentPort = port;
});

ipcMain.handle('serial:close', async () => {
  await closePort();
});

ipcMain.handle('serial:write', async (_event, line) => {
  if (!currentPort || !currentPort.isOpen) throw new Error('Port nicht offen');
  const out = String(line);
  const data = out.endsWith('\n') ? out : out + '\n';
  await new Promise((resolve, reject) => {
    currentPort.write(data, (err) => (err ? reject(err) : resolve()));
  });
});

// ── App-Lifecycle ─────────────────────────────────────────────────────────

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('before-quit', async (event) => {
  if (quitting) return;
  if (currentPort && currentPort.isOpen) {
    event.preventDefault();
    quitting = true;
    await closePort();
    app.quit();
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
