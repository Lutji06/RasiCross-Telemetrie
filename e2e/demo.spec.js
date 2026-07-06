'use strict';
// Smoke: Demo-Modus mit 3 Karts, Rennen-Steuerung und
// buildRaceDataForKart-Payloads (Phase 41, Spec-Punkte 3-5).
const { test, expect } = require('@playwright/test');
const { launchApp, closeApp } = require('./helpers');

const DEMO_MACS = ['DE:MO:RA:SI:00:01', 'DE:MO:RA:SI:00:02', 'DE:MO:RA:SI:00:03'];

let app, page, errors, userData;

test.beforeEach(async () => {
  ({ app, page, errors, userData } = await launchApp());
  // Demo starten: Verbindungs-Tab -> Demo-Modus einblenden -> Start.
  await page.click('.nav-item[data-tab="connection"]');
  await page.click('#modeDemoBtn');
  await page.click('#demoStartBtn');
  await page.waitForFunction(() => state.demo.running === true);
});

test.afterEach(async () => {
  await closeApp(app, userData);
});

test('Demo erzeugt 3 Karts mit laufenden Rundenzeiten', async () => {
  // Kart 3 startet 3,2 rad vor dem Gate -> lapStart erst nach ~45 s Echtzeit.
  test.setTimeout(180000);
  // Alle 3 Demo-Karts registriert
  await page.waitForFunction(
    (macs) => macs.every((m) => state.karts.has(m)),
    DEMO_MACS
  );
  // Telemetrie fliesst: seq-Zaehler aller Demo-Karts steigen
  const s1 = await page.evaluate(() => state.demo.karts.map((k) => k.seq));
  await page.waitForTimeout(500);
  const s2 = await page.evaluate(() => state.demo.karts.map((k) => k.seq));
  for (let i = 0; i < 3; i++) expect(s2[i]).toBeGreaterThan(s1[i]);
  // Laufende Rundenzeit: lapStart wird beim ersten Gate-Durchgang gesetzt.
  await page.waitForFunction(
    (macs) => macs.every((m) => state.karts.get(m).lapStart != null),
    DEMO_MACS,
    { timeout: 120000 }
  );
  const lapMs = await page.evaluate(
    (macs) => macs.map((m) => Date.now() - state.karts.get(m).lapStart),
    DEMO_MACS
  );
  for (const ms of lapMs) expect(ms).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});
