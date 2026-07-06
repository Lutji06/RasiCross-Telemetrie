'use strict';
// Gemeinsamer Electron-Launcher fuer die Smoke-Suite (Phase 41).
// Jeder Test bekommt ein frisches userData-Verzeichnis (RASI_TEST_USERDATA,
// Hook in main.js) -- localStorage, Tile-Cache und Crash-Datei der echten
// App bleiben unberuehrt. Konsolen-Fehler werden gesammelt; die Tests
// pruefen das Array am Ende.
const { _electron: electron } = require('@playwright/test');
const fs = require('fs');
const os = require('os');
const path = require('path');

// Bekannte, harmlose Fehlermeldungen per Teilstring erlauben (bewusst leer;
// nur nach Team-Entscheid fuellen).
const CONSOLE_ERROR_ALLOWLIST = [];

async function launchApp() {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'rasicross-e2e-'));
  const app = await electron.launch({
    args: ['.'].concat(process.env.CI ? ['--no-sandbox'] : []),
    cwd: path.join(__dirname, '..'),
    env: Object.assign({}, process.env, { RASI_TEST_USERDATA: userData }),
  });
  const page = await app.firstWindow();
  const errors = [];
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    const text = msg.text();
    if (CONSOLE_ERROR_ALLOWLIST.some((s) => text.includes(s))) return;
    errors.push(text);
  });
  page.on('pageerror', (err) => errors.push(String(err)));
  // App-Boot abwarten: init() haengt Handler an .nav-item[data-tab];
  // state.karts existiert erst nach kart-registry-Init.
  await page.waitForSelector('.nav-item[data-tab]');
  // try/catch: waehrend des Script-Boots kann das lexikalische state-
  // Binding kurz in der TDZ sein -> als "noch nicht bereit" werten.
  await page.waitForFunction(() => {
    try { return typeof state === 'object' && !!state.karts; }
    catch (_) { return false; }
  });
  return { app, page, errors, userData };
}

async function closeApp(app, userData) {
  try { await app.close(); } catch (_) { /* Fenster ggf. schon zu */ }
  try { fs.rmSync(userData, { recursive: true, force: true }); } catch (_) { /* best effort */ }
}

module.exports = { launchApp, closeApp, CONSOLE_ERROR_ALLOWLIST };
