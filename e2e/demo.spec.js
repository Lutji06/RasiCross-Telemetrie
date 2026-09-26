'use strict';
// Smoke: Demo-Modus mit 3 Karts und Rennen-Steuerung
// (Phase 41, Spec-Punkte 3-5).
const { test, expect } = require('@playwright/test');
const { launchApp, closeApp } = require('./helpers');

const DEMO_MACS = ['DE:MO:RA:SI:00:01', 'DE:MO:RA:SI:00:02', 'DE:MO:RA:SI:00:03'];

let app, page, errors, userData;

test.beforeEach(async () => {
  ({ app, page, errors, userData } = await launchApp());
  // Demo starten: Verbindungs-Tab -> Demo-Chip (Phase 56).
  await page.click('.nav-item[data-tab="connection"]');
  await page.click('#demoChip');
  await page.waitForFunction(() => RasiTest.state.demo.running === true);
});

test.afterEach(async () => {
  await closeApp(app, userData);
});

test('Demo erzeugt 3 Karts mit laufenden Rundenzeiten', async () => {
  // Kart 3 startet 3,2 rad vor dem Gate -> lapStart erst nach ~45 s Echtzeit.
  test.setTimeout(180000);
  // Alle 3 Demo-Karts registriert
  await page.waitForFunction(
    (macs) => macs.every((m) => RasiTest.state.karts.has(m)),
    DEMO_MACS
  );
  // Telemetrie fliesst: seq-Zaehler aller Demo-Karts steigen
  const s1 = await page.evaluate(() => RasiTest.state.demo.karts.map((k) => k.seq));
  await page.waitForTimeout(500);
  const s2 = await page.evaluate(() => RasiTest.state.demo.karts.map((k) => k.seq));
  for (let i = 0; i < 3; i++) expect(s2[i]).toBeGreaterThan(s1[i]);
  // Laufende Rundenzeit: lapStart wird beim ersten Gate-Durchgang gesetzt.
  await page.waitForFunction(
    (macs) => macs.every((m) => RasiTest.state.karts.get(m).lapStart != null),
    DEMO_MACS,
    { timeout: 120000 }
  );
  const lapMs = await page.evaluate(
    (macs) => macs.map((m) => Date.now() - RasiTest.state.karts.get(m).lapStart),
    DEMO_MACS
  );
  for (const ms of lapMs) expect(ms).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});

test('Rennen pausieren, fortsetzen und beenden', async () => {
  // startDemo() hat automatisch ein Demo-Race angelegt und gestartet.
  await page.waitForFunction(() => {
    const r = RasiTest.activeRace();
    return !!r && r.status === 'running';
  });
  // Pausieren + Fortsetzen ueber dieselbe Funktion, die startRaceBtn bindet
  // (rasicross.js init: startRaceBtn.onclick = toggleRaceRun).
  await page.evaluate(() => RasiTest.toggleRaceRun());
  expect(await page.evaluate(() => RasiTest.activeRace().status)).toBe('paused');
  await page.evaluate(() => RasiTest.toggleRaceRun());
  expect(await page.evaluate(() => RasiTest.activeRace().status)).toBe('running');
  // Beenden (endRaceBtn.onclick = () => endRace(false))
  const raceId = await page.evaluate(() => RasiTest.activeRace().id);
  await page.evaluate(() => RasiTest.endRace(false));
  const status = await page.evaluate((id) => {
    const r = RasiTest.state.races.find((x) => x.id === id);
    return r ? r.status : 'gone';
  }, raceId);
  expect(status).toBe('finished');
  expect(errors).toEqual([]);
});

// Phase 70: "Ende" sitzt neben "Wechsel", und ein beendetes Rennen laesst
// sich nicht fortsetzen -- ein Fehlklick durfte das Rennen nicht beenden.
test('Ende-Knopf fragt nach, bevor das Rennen endet', async () => {
  await page.waitForFunction(() => RasiTest.activeRace()?.status === 'running');
  const raceId = await page.evaluate(() => RasiTest.activeRace().id);
  await page.evaluate(() => document.getElementById('endRaceBtn').click());
  await expect(page.locator('#rcAlertOverlay')).toHaveClass(/\bshow\b/);
  await page.click('#rcAlertBtns .btn.ghost');                 // Abbrechen
  expect(await page.evaluate(() => RasiTest.activeRace().status)).toBe('running');
  await page.evaluate(() => document.getElementById('endRaceBtn').click());
  await page.click('#rcAlertBtns .btn.danger');                // Beenden
  await page.waitForFunction(
    (id) => RasiTest.state.races.find((r) => r.id === id).status === 'finished', raceId);
  expect(errors).toEqual([]);
});

// Phase 70: Live-Tab und Pit Wall lasen den Fahrer aus dem Rennen, den
// nur createRace setzt -- nach einem Wechsel blieb dort der Startfahrer.
test('Fahrerwechsel: Stint-Kopf und Pit Wall zeigen den neuen Fahrer', async () => {
  await page.waitForFunction(() => RasiTest.activeRace()?.status === 'running');
  await page.evaluate(() => RasiTest.state.drivers.push(
    { id: 'drv2', name: 'Zweite Fahrerin', number: '2', color: '#00aaff' }));
  await page.evaluate(() => document.getElementById('changeDriverBtn').click());
  const mac = await page.evaluate(() => RasiTest.state.activeKartMac);
  await page.selectOption(`#driverModalList .dc-sel[data-mac="${mac}"]`, 'drv2');
  await page.click('#dmConfirmBtn');
  await page.evaluate(() => document.getElementById('pitwallBtn').click());
  await page.waitForFunction(() =>
    document.getElementById('pwDriver').textContent === 'Zweite Fahrerin'
    && document.getElementById('currentDriverName').textContent === 'Zweite Fahrerin',
  null, { timeout: 3000 });
  // Ab jetzt jede Aenderung mitschreiben: 1-Hz-Loop (live-ui) und
  // 200-ms-Spiegel (ui-glue) schreiben denselben Stint-Kopf -- ein
  // Rueckfall auf den Startfahrer waere ein Flackern.
  await page.evaluate(() => {
    window.__seen = new Set();
    for (const id of ['currentDriverName', 'pwDriver']) {
      const el = document.getElementById(id);
      new MutationObserver(() => window.__seen.add(id + '=' + el.textContent))
        .observe(el, { childList: true, characterData: true, subtree: true });
    }
  });
  await page.waitForTimeout(3000);
  const seen = await page.evaluate(() => [...window.__seen]);
  expect(seen.filter((s) => !s.endsWith('=Zweite Fahrerin'))).toEqual([]);
  expect(errors).toEqual([]);
});
