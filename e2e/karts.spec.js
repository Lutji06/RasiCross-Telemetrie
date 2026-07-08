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
  // Demo-Karten anhand des DEMO-Badges zaehlen -- das ist die praezisere
  // Assertion (der fruehere default-Platzhalter ist seit dem rosterMacs-
  // Filter ohnehin nie mehr sichtbar).
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

test('Kart-Wechsel waehrend laufendem Rennen aendert keine Bucket-Daten', async () => {
  await startDemo();
  // startDemo() legt ein laufendes Demo-Race an (Auto-Arm-Flow, Phase 41/42).
  await page.waitForFunction(() => {
    const r = RasiTest.activeRace();
    return !!r && r.status === 'running';
  });
  // macA MUSS das aktive Kart sein (der Marker wird via activeKart() gesetzt).
  // macs()[0] waere der default-Platzhalter-Bucket: startDemo() erzeugt ihn
  // vor den DE:MO:*-Karts, die Registry listet in Anlage-Reihenfolge.
  const macA = await page.evaluate(() => RasiTest.state.karts.activeMac());
  const macB = await page.evaluate(
    (a) => RasiTest.state.karts.macs().find((m) => m !== a && m.indexOf('DE:MO:') === 0), macA);
  // Marker auf Kart A (aktiv) setzen, dann auf B wechseln.
  await page.evaluate(() => { RasiTest.activeKart().calibration.gxZero = 0.11; });
  await page.evaluate((mac) => {
    RasiTest.state.karts.setActive(mac);
    RasiTest.state.activeKartMac = mac;
  }, macB);
  // (a) B traegt den Marker NICHT, (b) A's Bucket traegt ihn unveraendert.
  const probe = await page.evaluate(([a, b]) => ({
    activeGx: RasiTest.activeKart().calibration.gxZero,
    aGx: RasiTest.state.karts.get(a).calibration.gxZero,
    bIsActive: RasiTest.state.karts.activeMac() === b,
  }), [macA, macB]);
  expect(probe.bIsActive).toBe(true);
  expect(probe.activeGx).not.toBe(0.11);
  expect(probe.aGx).toBe(0.11);
  // (c) Rueckwechsel: activeKart() liefert wieder A's Marker.
  await page.evaluate((mac) => {
    RasiTest.state.karts.setActive(mac);
    RasiTest.state.activeKartMac = mac;
  }, macA);
  expect(await page.evaluate(() => RasiTest.activeKart().calibration.gxZero)).toBe(0.11);
  expect(errors).toEqual([]);
});
