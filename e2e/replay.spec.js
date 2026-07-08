'use strict';
// Smoke: Recording -> Serialize -> Parse -> Replay Roundtrip
// (Phase 41, Spec-Punkt 6). Prueft zugleich die Kompatibilitaets-
// garantie: REC_VERSION-9.6-Aufnahmen bleiben abspielbar.
const { test, expect } = require('@playwright/test');
const { launchApp, closeApp } = require('./helpers');

let app, page, errors, userData;

test.beforeEach(async () => {
  ({ app, page, errors, userData } = await launchApp());
});

test.afterEach(async () => {
  await closeApp(app, userData);
});

test('Recording/Replay-Roundtrip', async () => {
  await page.click('.nav-item[data-tab="connection"]');
  await page.click('#modeDemoBtn');
  await page.click('#demoStartBtn');
  await page.waitForFunction(() => RasiTest.state.demo.running === true);
  // recordAutoArm (Default true) armiert den aktiven Demo-Kart automatisch
  // (Fix des Phase-41-Funds: armRecording() laeuft in startDemo jetzt NACH
  // dem setActive auf Demo-Kart 1).
  // ~12 Hz Demo-Pakete: nach wenigen Sekunden liegen >= 20 im Buffer
  await page.waitForFunction(
    () => RasiTest.activeKart().recording.armed === true
      && RasiTest.activeKart().recording.buf.length >= 20,
    null,
    { timeout: 30000 }
  );
  // Roundtrip im Renderer: Buffer VOR stopDemo sichern (stopDemo/
  // enterReplay raeumen die Demo-Buckets weg).
  const result = await page.evaluate(() => {
    const buf = RasiTest.activeKart().recording.buf.slice();
    const text = RasiTest.RasiReplay.serializeRecording(buf, { created: new Date().toISOString() });
    const parsed = RasiTest.RasiReplay.parseRecording(text);
    if (!parsed.ok) return { ok: false, error: parsed.error };
    RasiTest.enterReplay(parsed); // beendet den Demo-Modus selbst
    return { ok: true, recorded: buf.length, replayed: parsed.packets.length };
  });
  expect(result.ok).toBe(true);
  expect(result.replayed).toBe(result.recorded);
  await page.waitForFunction(() => RasiTest.activeKart().replay.active === true);
  // Replay spielt: virtuelle Zeit schreitet voran
  await page.waitForFunction(() => RasiTest.activeKart().replay.virtualMs > 0, null, { timeout: 10000 });
  await page.evaluate(() => RasiTest.exitReplay());
  expect(await page.evaluate(() => RasiTest.activeKart().replay.active)).toBe(false);
  expect(errors).toEqual([]);
});
