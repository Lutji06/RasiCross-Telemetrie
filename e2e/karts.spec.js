'use strict';
// Smoke: Karts-Tab (Phase 46) — Demo-Karten, Rename->Chip-Leiste,
// Aktiv-Wahl per Karten-Klick, Offline-Persistenz nach Reload.
const { test, expect } = require('@playwright/test');
const { launchApp, closeApp } = require('./helpers');

let app, page, errors, userData;

test.beforeEach(async () => {
  ({ app, page, errors, userData } = await launchApp());
});

test.afterEach(async () => {
  await closeApp(app, userData);
});

async function startDemo() {
  await page.click('.nav-item[data-tab="connection"]');
  await page.click('#modeDemoBtn');
  await page.click('#demoStartBtn');
  await page.waitForFunction(() => RasiTest.state.demo.running === true);
}

test('Karts-Tab zeigt 3 Demo-Karten, Rename wirkt in der Chip-Leiste', async () => {
  await startDemo();
  await page.click('.nav-item[data-tab="karts"]');
  // Hinweis: die Registry legt beim ersten Zugriff (Live-Tab beim Boot)
  // vorab einen "default"-Platzhalter-Kart an, den Demo-Karts nicht
  // uebernehmen (serial-demo.js) -- daher >= statt exakt 3 Karten gesamt.
  await page.waitForFunction(() => document.querySelectorAll('#kartCardsList .kc-badge.demo').length === 3);
  expect(await page.locator('#kartCardsList .kc-badge.demo').count()).toBe(3);
  const nameInput = page.locator('#kartCardsList .kc-name-input').first();
  await nameInput.fill('Blitz');
  await nameInput.dispatchEvent('input');
  await page.click('.nav-item[data-tab="live"]');
  await page.waitForFunction(() =>
    document.querySelector('#kartBar') && document.querySelector('#kartBar').textContent.includes('Blitz'));
  expect(errors).toEqual([]);
});

test('Karten-Klick wechselt das aktive Kart', async () => {
  await startDemo();
  await page.click('.nav-item[data-tab="karts"]');
  await page.waitForFunction(() => document.querySelectorAll('#kartCardsList .kc-badge.demo').length === 3);
  const secondMac = await page.evaluate(() => RasiTest.state.karts.macs()[1]);
  await page.click('#kartCardsList .kart-card[data-mac="' + secondMac + '"] .kc-mac');
  await page.waitForFunction((mac) => RasiTest.state.activeKartMac === mac, secondMac);
  expect(errors).toEqual([]);
});

test('Persistentes Kart erscheint offline nach Reload', async () => {
  await page.evaluate(() => {
    RasiTest.updateKartMeta('AA:BB:CC:DD:EE:01',
      { name: 'Scheunenkart', color: '#5ad17a', lastSeenAt: Date.now() - 3600000 });
    window.saveData();
  });
  await page.reload();
  await page.waitForFunction(() =>
    !!(window.RasiTest && window.RasiTest.state && window.RasiTest.state.karts));
  await page.click('.nav-item[data-tab="karts"]');
  await page.waitForFunction(() =>
    document.querySelectorAll('#kartCardsList .kart-card.offline').length >= 1);
  // Der Name lebt im Wert eines <input>, nicht im Textinhalt -- inputValue()
  // statt textContent() (letzteres liefert nur statisches Markup zurueck).
  const val = await page.locator('#kartCardsList .kart-card.offline .kc-name-input').first().inputValue();
  expect(val).toBe('Scheunenkart');
  expect(errors).toEqual([]);
});
