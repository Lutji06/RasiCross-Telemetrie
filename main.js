// ============================================================
//  RasiCross Telemetry — Electron-Hauptprozess
// ============================================================
//  Lädt das HTML-Dashboard in ein natives Fenster und gibt der
//  Web-Serial-API Zugriff auf die Bridge (USB-Serial).
// ============================================================

const { app, BrowserWindow, dialog, Menu } = require('electron');
const path = require('path');

const HTML_FILE = 'RasiCross_Telemetry_v9_6.html';

function createWindow() {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    title: 'RasiCross Telemetrie v9.6',
    backgroundColor: '#0a0a0d',
    autoHideMenuBar: true,
    icon: path.join(__dirname, 'icon.png'),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Menüleiste ausblenden (kann mit Alt eingeblendet werden)
  Menu.setApplicationMenu(null);

  const ses = win.webContents.session;

  // Web-Serial / -USB / -HID erlauben — sonst blockiert Electron Anfragen.
  ses.setPermissionCheckHandler((_wc, permission) => {
    return permission === 'serial' || permission === 'usb' || permission === 'hid';
  });

  ses.setDevicePermissionHandler((details) => {
    return ['serial', 'usb', 'hid'].includes(details.deviceType);
  });

  // Port-Auswahl: bei genau einem Port automatisch nehmen,
  // bei mehreren einen nativen Auswahldialog zeigen.
  ses.on('select-serial-port', async (event, portList, _webContents, callback) => {
    event.preventDefault();

    if (!portList || portList.length === 0) {
      callback('');
      return;
    }

    if (portList.length === 1) {
      callback(portList[0].portId);
      return;
    }

    const labels = portList.map((p) => {
      const name = p.portName || p.displayName || p.portId;
      const vendor = p.vendorId ? ` (VID 0x${Number(p.vendorId).toString(16).padStart(4, '0')})` : '';
      return `${name}${vendor}`;
    });

    const result = await dialog.showMessageBox(win, {
      type: 'question',
      title: 'Serial-Port wählen',
      message: 'Mehrere Ports gefunden — welcher ist die Bridge?',
      buttons: [...labels, 'Abbrechen'],
      cancelId: labels.length,
      defaultId: 0,
      noLink: true,
    });

    if (result.response >= 0 && result.response < portList.length) {
      callback(portList[result.response].portId);
    } else {
      callback('');
    }
  });

  win.loadFile(HTML_FILE);
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
