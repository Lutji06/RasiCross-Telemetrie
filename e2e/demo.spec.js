'use strict';
// Smoke: Demo-Modus mit 3 Karts, Rennen-Steuerung und
// buildRaceDataForKart-Payloads (Phase 41, Spec-Punkte 3-5).
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

test('buildRaceDataForKart liefert pro Kart plausible Payloads', async () => {
  await page.waitForFunction(() => {
    const r = RasiTest.activeRace();
    return !!r && r.status === 'running';
  });
  const payloads = await page.evaluate(
    (macs) => macs.map((m) => RasiTest.buildRaceDataForKart(m)),
    DEMO_MACS
  );
  expect(payloads.length).toBe(3);
  for (const p of payloads) {
    expect(p.type).toBe('display');
    // Voll-Payload: Race laeuft + alle Demo-Karts sind Teilnehmer
    expect(typeof p.lap).toBe('string');
    expect(p.lapn).toBeGreaterThanOrEqual(1);
    expect(p.driver).toBeTruthy();
    expect(Array.isArray(p.sectors)).toBe(true);
    expect(p.sectors.length).toBe(3);
    expect(p.page).toBeTruthy();
    expect(typeof p.running).toBe('boolean');
  }
  expect(errors).toEqual([]);
});
