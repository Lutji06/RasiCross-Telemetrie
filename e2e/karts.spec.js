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

test('Karts-Tab zeigt 3 Demo-Karten', async () => {
  await startDemo();
  await page.click('.nav-item[data-tab="karts"]');
  // Demo-Karten anhand des DEMO-Badges zaehlen -- das ist die praezisere
  // Assertion (der fruehere default-Platzhalter ist seit dem rosterMacs-
  // Filter ohnehin nie mehr sichtbar).
  await page.waitForFunction(() => document.querySelectorAll('#kartCardsList .kc-badge.demo').length === 3);
  expect(await page.locator('#kartCardsList .kc-badge.demo').count()).toBe(3);
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
  // Seit Task 4/48 ist die Karte reine Status-Anzeige -- der Name lebt im
  // Textinhalt eines <span class="kc-name">, nicht mehr im Wert eines <input>
  // (Rename laeuft jetzt ueber das Kart-Fenster, s. Fenster-Smoke-Tests).
  const val = await page.locator('#kartCardsList .kart-card.offline .kc-name').first().textContent();
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

test('⚙-Button oeffnet Kart-Fenster; Rename im Fenster wirkt auf die Chip-Leiste', async () => {
  await startDemo();
  await page.click('.nav-item[data-tab="karts"]');
  await page.waitForFunction(() => document.querySelectorAll('#kartCardsList [data-action="settings"]').length >= 3);
  const [winPage] = await Promise.all([
    app.waitForEvent('window'),
    page.click('#kartCardsList .kart-card:nth-child(2) [data-action="settings"]'),
  ]);
  await winPage.waitForSelector('#kartName');
  await winPage.fill('#kartName', 'Turbo');
  await winPage.dispatchEvent('#kartName', 'input');
  await page.waitForFunction(() =>
    document.querySelector('#kartBar') && document.querySelector('#kartBar').textContent.includes('Turbo'));
  // Freie Farbe: Palette-Schnellwahl im Fenster setzt --kart der Karte.
  // #b07ae8 ist PALETTE[4] und bei 3 Demo-Karts nie ein Default.
  await winPage.click('#kartPaletteRow [data-color="#b07ae8"]');
  await page.waitForFunction(() => {
    const card = document.querySelector('#kartCardsList .kart-card:nth-child(2)');
    return card && (card.getAttribute('style') || '').includes('#b07ae8');
  });
  expect(errors).toEqual([]);
});

test('Fenster-Toggle wirkt nur auf sein Kart; Karte ist reine Status-Anzeige', async () => {
  await startDemo();
  await page.click('.nav-item[data-tab="karts"]');
  await page.waitForFunction(() => document.querySelectorAll('#kartCardsList [data-action="settings"]').length >= 3);
  const { active, other } = await page.evaluate(() => {
    const a = RasiTest.state.karts.activeMac();
    const demo = RasiTest.state.karts.macs().filter((m) => m.indexOf('DE:MO:') === 0);
    return { active: a, other: demo.find((m) => m !== a) };
  });
  const [winPage] = await Promise.all([
    app.waitForEvent('window'),
    page.click(`#kartCardsList .kart-card[data-mac="${other}"] [data-action="settings"]`),
  ]);
  // Checkbox liegt per CSS auf display:none (.toggle input), daher 'attached'
  // statt des Playwright-Default 'visible' abwarten.
  await winPage.waitForSelector('#setInvertGx', { state: 'attached' });
  // Checkbox sitzt unsichtbar im Toggle-Label -- Change-Event direkt ausloesen.
  await winPage.evaluate(() => {
    const el = document.getElementById('setInvertGx');
    el.checked = true;
    el.dispatchEvent(new Event('change'));
  });
  const probe = await page.evaluate(([a, o]) => ({
    otherInv: RasiTest.state.karts.get(o).calibration.invertGx,
    activeInv: RasiTest.state.karts.get(a).calibration.invertGx,
    nameInputs: document.querySelectorAll('#kartCardsList .kc-name-input').length,
    swatches: document.querySelectorAll('#kartCardsList .kc-sw').length,
    actionBtns: document.querySelectorAll('#kartCardsList [data-action]:not([data-action="settings"])').length,
  }), [active, other]);
  expect(probe.otherInv).toBe(true);
  expect(probe.activeInv).toBe(false);
  expect(probe.nameInputs).toBe(0);
  expect(probe.swatches).toBe(0);
  expect(probe.actionBtns).toBe(0);
  expect(errors).toEqual([]);
});

test('Stats-Zeile auf der Karte; Dropdown-Abschnitt existiert nicht mehr', async () => {
  await startDemo();
  // Demo-Karts fahren -> Odometer waechst binnen Sekunden.
  await page.waitForFunction(() => {
    const macs = RasiTest.state.karts.macs().filter((m) => m.indexOf('DE:MO:') === 0);
    return macs.length && RasiTest.state.karts.get(macs[0]).stats.odoM > 0;
  });
  await page.click('.nav-item[data-tab="karts"]');
  await page.waitForFunction(() =>
    document.querySelector('#kartCardsList') && document.querySelector('#kartCardsList').textContent.includes('Gefahren'));
  const probe = await page.evaluate(() => ({
    hasSection: !!document.getElementById('kartSettingsSection'),
    hasSelect: !!document.getElementById('kartSettingsSelect'),
    hasTop: document.querySelector('#kartCardsList').textContent.includes('Top '),
    navSensorik: !!document.querySelector('#tab-settings .settings-nav-item[data-sgroup="sensorik"]'),
    navFahrdynamik: !!document.querySelector('#tab-settings .settings-nav-item[data-sgroup="fahrdynamik"]'),
  }));
  expect(probe.hasSection).toBe(false);
  expect(probe.hasSelect).toBe(false);
  expect(probe.hasTop).toBe(true);
  expect(probe.navSensorik).toBe(false);
  expect(probe.navFahrdynamik).toBe(true);
  expect(errors).toEqual([]);
});
