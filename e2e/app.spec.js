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

test('Live-Tab bleibt beim Menuewechsel verborgen', async () => {
  // Regression Phase 65: Das Uebersichts-Raster stand als
  // body[data-live-view="overview"] #tab-live -- staerker als das
  // .tab{display:none} aus base.css und damit in jedem Menue offen.
  // Seite 0 gibt es erst ab zwei Karts, Demo liefert drei.
  await page.click('.nav-item[data-tab="connection"]');
  await page.click('#demoChip');
  await page.waitForFunction(() => RasiTest.state.demo.running === true);
  await page.click('.nav-item[data-tab="live"]');
  await page.click('.kart-overview-btn');
  await page.waitForFunction(() => document.body.dataset.liveView === 'overview');
  await expect(page.locator('#tab-live')).toBeVisible();
  for (const tab of ['connection', 'drivers', 'races']) {
    await page.click(`.nav-item[data-tab="${tab}"]`);
    await expect(page.locator('#tab-live')).toBeHidden();
  }
  expect(errors).toEqual([]);
});

test('Uebersichtsseite ordnet um statt zu stapeln', async () => {
  // Regression Phase 65: Das Uebersichts-Raster verlor gegen
  // body[data-tab="live"] #tab-live.active{display:flex} aus dem
  // No-Scroll-Block -- Seite 0 stapelte alles in eine Spalte und die
  // Kart-Kacheln lagen ueber der Karte.
  await page.click('.nav-item[data-tab="connection"]');
  await page.click('#demoChip');
  await page.waitForFunction(() => RasiTest.state.demo.running === true);
  await page.click('.nav-item[data-tab="live"]');
  await page.click('.kart-overview-btn');
  await page.waitForFunction(() => document.body.dataset.liveView === 'overview');
  const display = await page.evaluate(
    () => getComputedStyle(document.getElementById('tab-live')).display);
  expect(display).toBe('grid');
  // Karte und Kachelreihe duerfen sich nicht ueberlappen: die Kacheln
  // beginnen unterhalb des Kartenmoduls.
  const gap = await page.evaluate(() => {
    const map = document.querySelector('#tab-live .pw-map-mod').getBoundingClientRect();
    const cards = document.getElementById('liveOverview').getBoundingClientRect();
    return Math.round(cards.top - map.bottom);
  });
  expect(gap).toBeGreaterThanOrEqual(0);
  expect(errors).toEqual([]);
});
