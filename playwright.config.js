'use strict';
// Playwright-Konfiguration fuer die Electron-Smoke-Suite (Phase 41).
// Nur e2e/ -- die node:test-Suite (test/) laeuft weiter unter `npm test`.
const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: 'e2e',
  timeout: 120000,
  fullyParallel: false,
  workers: 1,                            // eine Electron-Instanz zur Zeit
  retries: process.env.CI ? 1 : 0,
  reporter: [['list']],
  use: { trace: 'retain-on-failure' },
});
