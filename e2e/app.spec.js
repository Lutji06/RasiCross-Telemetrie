'use strict';
// Smoke: App-Start + Tab-Rendering (Phase 41, Spec-Punkte 1+2).
const { test, expect } = require('@playwright/test');
const { launchApp, closeApp } = require('./helpers');

let app, page, errors, userData;

test.beforeEach(async () => {
  ({ app, page, errors, userData } = await launchApp());
});

test.afterEach(async () => {
  await closeApp(app, userData);
});

test('App startet ohne Konsolen-Fehler', async () => {
  await expect(page).toHaveTitle(/RasiCross/i);
  await expect(page.locator('#tab-live')).toBeVisible();
  // 2 s Leerlauf: 1-Hz-Loop + Init-Renderer laufen mindestens einmal durch.
  await page.waitForTimeout(2000);
  expect(errors).toEqual([]);
});

const TABS = ['live', 'detail', 'races', 'drivers', 'karts', 'track', 'connection', 'settings'];

test('alle Tabs rendern', async () => {
  for (const tab of TABS) {
    await page.click(`.nav-item[data-tab="${tab}"]`);
    const section = page.locator(`#tab-${tab}`);
    await expect(section).toHaveClass(/active/);
    await expect(section).toBeVisible();
    // Sektion hat Inhalt (tab-settings wird von settings.js zur Laufzeit
    // befuellt -> ueber waitForFunction statt Sofort-Assert).
    await page.waitForFunction(
      (id) => {
        const el = document.getElementById(id);
        return !!el && el.innerHTML.trim().length > 0;
      },
      `tab-${tab}`
    );
  }
  expect(errors).toEqual([]);
});
