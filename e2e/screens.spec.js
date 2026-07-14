'use strict';
// Screenshot-Baseline (Phase 49): visuelles Regressionsnetz fuer die
// CSS-Extraktion (Task 3/4) und den Konsistenz-Pass (Phase 50).
// Verglichen wird nur in der CI (Linux) -- Font-Rendering ist pro
// Plattform verschieden (Spec-Risiko 1). Lokal: RASI_SCREENS=1 gibt
// den Lauf frei; dabei entstehen *-win32.png-Baselines (gitignored).
// toHaveScreenshot wartet selbst auf zwei identische Frames -- laufende
// Demo-Werte MUESSEN daher in DYN maskiert sein, sonst Timeout.
const { test, expect } = require('@playwright/test');
const { launchApp, closeApp } = require('./helpers');

test.skip(process.platform !== 'linux' && !process.env.RASI_SCREENS,
  'Screenshot-Gate laeuft in der CI (Linux); lokal via RASI_SCREENS=1');

const TABS = ['live', 'detail', 'races', 'drivers', 'karts', 'track',
  'connection', 'settings'];

// Feste Fenstergroesse: CI (xvfb) und lokal identisch.
const WIN = { width: 1440, height: 900 };

const SHOT = { animations: 'disabled', caret: 'hide' };

// Masken: alles, was zwischen zwei Frames wechselt (Karte, Canvas,
// Live-Werte). Liste per Masken-Iteration ermittelt (Step 3) -- bei
// spaeteren Diffs hier ergaenzen, nie Toleranzen aufweichen.
// #topConnPill steht drin, obwohl sein Text ("Offline") konstant ist: seine
// Position haengt am variablen #hzPill davor (Ziffernzahl der Hz-Anzeige) --
// ohne eigene Maske "blutet" die Textkante beim Verschieben in den Diff.
const DYN = ['canvas', '.map', '.statusbar',
  '#kartBar', '#liveLeaderStrip', '.pw-clockbox', '#hzPill', '#topConnPill',
  '#battPill', '.pw-kpi-combo', '#latText', '#lonText', '#trackPoints',
  '#packetsText', '.kc-live'];

async function prep(page, app) {
  await app.evaluate(({ BrowserWindow }, size) => {
    const w = BrowserWindow.getAllWindows()[0];
    w.setSize(size.width, size.height);
    w.center();
  }, WIN);
  await page.evaluate(() => document.fonts.ready);
}

function masks(scope) { return DYN.map((s) => scope.locator(s)); }

test.describe('Ruhezustand', () => {
  let ctx;
  test.beforeAll(async () => {
    ctx = await launchApp();
    await prep(ctx.page, ctx.app);
  });
  test.afterAll(async () => { await closeApp(ctx.app, ctx.userData); });

  for (const tab of TABS) {
    test(`Tab ${tab}`, async () => {
      await ctx.page.click(`.nav-item[data-tab="${tab}"]`);
      await expect(ctx.page).toHaveScreenshot(`tab-${tab}.png`,
        Object.assign({ mask: masks(ctx.page) }, SHOT));
    });
  }
});

test.describe('Demo-Zustand', () => {
  let ctx;
  test.beforeAll(async () => {
    ctx = await launchApp();
    await prep(ctx.page, ctx.app);
    // Demo starten: Verbindungs-Tab -> Demo-Modus -> Start (wie demo.spec.js)
    await ctx.page.click('.nav-item[data-tab="connection"]');
    await ctx.page.click('#modeDemoBtn');
    await ctx.page.click('#demoStartBtn');
    await ctx.page.waitForFunction(() => RasiTest.state.demo.running === true);
    // state.karts ist die KartRegistry (get/has/macs/...), kein Map -- .size
    // existiert dort nicht (immer undefined >= 3 == false, Timeout). macs()
    // liefert die MAC-Liste analog zu karts.spec.js.
    // Zusaetzlich auf batt.present des aktiven Karts warten: die Akku-Pille
    // (#battPill) ist bis zum ersten Batterie-Paket per CSS .hidden (~2s nach
    // Demo-Start, alle 25 Ticks). Ohne diesen Wait rennt Lauf 1 (Pille meist
    // sichtbar) gegen Lauf 2 (Pille evtl. noch versteckt) -- ein Masken-
    // Rechteck kann Existenz (display:none vs. sichtbar) nicht ausgleichen.
    await ctx.page.waitForFunction(() => {
      const ak = RasiTest.activeKart();
      return RasiTest.state.karts.macs().length >= 3 && ak && ak.batt.present;
    });
  });
  test.afterAll(async () => { await closeApp(ctx.app, ctx.userData); });

  test('Live-Tab mit Demo', async () => {
    await ctx.page.click('.nav-item[data-tab="live"]');
    await expect(ctx.page).toHaveScreenshot('demo-live.png',
      Object.assign({ mask: masks(ctx.page) }, SHOT));
  });

  test('Karts-Tab mit 3 Demo-Karts', async () => {
    await ctx.page.click('.nav-item[data-tab="karts"]');
    await ctx.page.waitForFunction(() =>
      document.querySelectorAll('#kartCardsList [data-action="settings"]').length >= 3);
    await expect(ctx.page).toHaveScreenshot('demo-karts.png',
      Object.assign({ mask: masks(ctx.page) }, SHOT));
  });

  test('Kart-Fenster', async () => {
    await ctx.page.click('.nav-item[data-tab="karts"]');
    await ctx.page.waitForFunction(() =>
      document.querySelectorAll('#kartCardsList [data-action="settings"]').length >= 3);
    const [win] = await Promise.all([
      ctx.app.waitForEvent('window'),
      ctx.page.click('#kartCardsList .kart-card:nth-child(1) [data-action="settings"]'),
    ]);
    await win.waitForLoadState('domcontentloaded');
    await win.evaluate(() => document.fonts.ready);
    await expect(win).toHaveScreenshot('demo-kart-fenster.png',
      Object.assign({ mask: masks(win) }, SHOT));
    await win.close();
  });
});
