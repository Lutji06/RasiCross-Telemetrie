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
    // --disable-gpu (Phase 50 Task 1): rcAlert/rcConfirm oeffnen erstmals in
    // dieser Suite einen Overlay mit backdrop-filter:blur (modals.css). Unter
    // Xvfb (Mesa-Softwarepipeline, kein echtes GPU) fuehrte das reproduzierbar
    // zu einem Renderer-Crash direkt nach dem ersten Dialog-Screenshot --
    // Playwright startete daraufhin fuer den naechsten Test einen neuen
    // Worker (frisches launchApp, Tab wieder "live"), waehrend ein noch
    // ausstehender Klick aus dem Vorlauf offenbar den frischen Dialog sofort
    // wieder schloss (leeres Live-Tab-Bild statt Dialog in beiden CI-Laeufen,
    // s. .superpowers/phase50/task1/trace-confirm). --disable-gpu erzwingt
    // Software-Rendering durchgaengig statt eines instabilen GPU-Pfads.
    args: ['.'].concat(process.env.CI ? ['--no-sandbox', '--disable-gpu'] : []),
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
  // window.RasiTest setzt src/app.js nach Auswertung aller Module (Phase 42).
  await page.waitForSelector('.nav-item[data-tab]');
  await page.waitForFunction(() =>
    !!(window.RasiTest && window.RasiTest.state && window.RasiTest.state.karts));
  return { app, page, errors, userData };
}

async function closeApp(app, userData) {
  try { await app.close(); } catch (_) { /* Fenster ggf. schon zu */ }
  try { fs.rmSync(userData, { recursive: true, force: true }); } catch (_) { /* best effort */ }
}

module.exports = { launchApp, closeApp, CONSOLE_ERROR_ALLOWLIST };
