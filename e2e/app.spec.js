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
