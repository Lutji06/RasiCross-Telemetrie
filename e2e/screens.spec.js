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

// maxDiffPixels 2 (User-Entscheid 2026-07-14): GitHub-Runner rendern Font-Kanten
// instanzabhaengig minimal verschieden (1px-Jitter, Task-3-Report Review-Fix 3);
// echte Styling-Aenderungen liegen um Groessenordnungen darueber.
const SHOT = { animations: 'disabled', caret: 'hide', maxDiffPixels: 2 };

// Masken: alles, was zwischen zwei Frames wechselt (Karte, Canvas,
// Live-Werte). Liste per Masken-Iteration ermittelt (Step 3) -- bei
// spaeteren Diffs hier ergaenzen; Toleranz nur per dokumentiertem
// User-Entscheid (s. SHOT).
// #topConnPill steht drin, obwohl sein Text ("Offline") konstant ist: seine
// Position haengt am variablen #hzPill davor (Ziffernzahl der Hz-Anzeige) --
// ohne eigene Maske "blutet" die Textkante beim Verschieben in den Diff.
// Der prep()-Wait unten sichert den ersten 1-Hz-Tick (#heroGps, Phase 56).
// .sidebar wird NICHT maskiert: das Gate soll Sidebar-CSS-Regressionen sehen (Phase 50).
// #liveOverview wird KOMPLETT maskiert: die Demo faehrt ein Auto-Rennen,
// das Ranking kann die Karten zwischen den zwei Vergleichs-Frames umsortieren
// (Phase 55) -- Feld-Masken koennen Reihenfolge nicht ausgleichen. Getestet
// bleibt das Layout drumherum; die Einzel-Ansicht deckt demo-live-single ab.
const DYN = ['canvas', '.map', '.statusbar',
  '#kartBar', '#liveLeaderStrip', '.pw-clockbox', '#hzPill', '#topConnPill',
  '#battPill', '.pw-kpi-combo', '#latText', '#lonText', '#trackPoints',
  '#packetsText', '.kc-live', '#liveOverview'];

async function prep(page, app) {
  await app.evaluate(({ BrowserWindow }, size) => {
    const w = BrowserWindow.getAllWindows()[0];
    w.setSize(size.width, size.height);
    w.center();
  }, WIN);
  await page.evaluate(() => document.fonts.ready);
  // Erster 1-Hz-Tick muss durch sein, sonst racet der Screenshot gegen die
  // Boot-Zustaende (Phase 49). conn-ui.render() schreibt #heroGps vom
  // Markup-Initial '--' auf 'N× Fix' -- letztes Glied der Boot-Kette (Phase 56).
  await page.waitForFunction(() => {
    const el = document.querySelector('#heroGps');
    return !!el && el.textContent.trim() !== '--';
  });
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

  test('Dialog rcAlert', async () => {
    // Dialog-Kontext pinnen: im Voll-Durchlauf ist nach der Tab-Schleife
    // settings aktiv, nach einem Worker-Neustart (Retry) aber live -- dort
    // malen die Karten-Masken UEBER den Dialog. Expliziter Klick macht den
    // Hintergrund kontext-unabhaengig (Lektion Pass A, Phase 50).
    await ctx.page.click('.nav-item[data-tab="settings"]');
    await ctx.page.evaluate(() => { RasiTest.rcAlert('Aufzeichnung gespeichert.', 'Hinweis'); });
    await ctx.page.waitForSelector('#rcAlertOverlay.show');
    await expect(ctx.page).toHaveScreenshot('dialog-alert.png',
      Object.assign({ mask: masks(ctx.page) }, SHOT));
    await ctx.page.click('#rcAlertBtns .btn.primary');
    // state:'attached' statt Default 'visible': .overlay setzt display:none
    // sobald .show entfaellt (src/styles/modals.css), das Element wird also
    // sofort unsichtbar -- 'visible' wuerde hier nie erfuellt (Timeout).
    await ctx.page.waitForSelector('#rcAlertOverlay:not(.show)', { state: 'attached' });
  });

  test('Dialog rcConfirm (danger)', async () => {
    // Kontext-Pin wie bei rcAlert (Worker-Neustart => sonst live-Tab).
    await ctx.page.click('.nav-item[data-tab="settings"]');
    await ctx.page.evaluate(() => {
      RasiTest.rcConfirm('Diesen Eintrag wirklich loeschen?', 'Bestaetigung', 'Loeschen', true);
    });
    await ctx.page.waitForSelector('#rcAlertOverlay.show');
    await expect(ctx.page).toHaveScreenshot('dialog-confirm.png',
      Object.assign({ mask: masks(ctx.page) }, SHOT));
    await ctx.page.click('#rcAlertBtns .btn.ghost');
    await ctx.page.waitForSelector('#rcAlertOverlay:not(.show)', { state: 'attached' });
  });
});

test.describe('Demo-Zustand', () => {
  let ctx;
  test.beforeAll(async () => {
    ctx = await launchApp();
    await prep(ctx.page, ctx.app);
    // Demo starten: Verbindungs-Tab -> Demo-Chip (Phase 56, wie demo.spec.js)
    await ctx.page.click('.nav-item[data-tab="connection"]');
    await ctx.page.click('#demoChip');
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
    // Eingeschwungenen Zustand erzwingen (Phase 56b): Sidebar-Status schreibt
    // erst der 1-Hz-Loop ('Offline' -> 'Demo'), die Batterie-Pille der
    // 200-ms-Loop. Ohne diese Waits friert ein fruehes Shot Boot-Zustaende
    // ein -- die alte demo-karts-Baseline trug genau so einen (Flake-Quelle).
    await ctx.page.waitForFunction(() =>
      document.querySelector('#sideConnText').textContent === 'Demo'
      && !document.querySelector('#battPill').classList.contains('hidden'));
  });
  test.afterAll(async () => { await closeApp(ctx.app, ctx.userData); });

  test('Live-Tab mit Demo', async () => {
    await ctx.page.click('.nav-item[data-tab="live"]');
    // Phase 55: 3 Demo-Karts => Start-Automatik schaltet auf die Uebersicht.
    await ctx.page.waitForFunction(() => document.body.dataset.liveView === 'overview');
    await expect(ctx.page).toHaveScreenshot('demo-live.png',
      Object.assign({ mask: masks(ctx.page) }, SHOT));
  });

  test('Live-Tab Einzel-Ansicht nach Karten-Klick', async () => {
    await ctx.page.click('.nav-item[data-tab="live"]');
    await ctx.page.waitForFunction(() => document.body.dataset.liveView === 'overview');
    // Karten-Klick = Hand-Wahl (manual): waehlt Kart 1, Einzel-Ansicht bleibt.
    // Deterministisch Kart 1 waehlen: nth-child ist ranking-sortiert und
    // kann mitten im Demo-Rennen umsortieren (Final-Review Phase 55).
    const mac = await ctx.page.evaluate(() => RasiTest.state.karts.macs()[0]);
    await ctx.page.click('#liveOverview .ko-card[data-mac="' + mac + '"]');
    await ctx.page.waitForFunction(() => document.body.dataset.liveView === 'single');
    await expect(ctx.page).toHaveScreenshot('demo-live-single.png',
      Object.assign({ mask: masks(ctx.page) }, SHOT));
  });

  test('Karts-Tab mit 3 Demo-Karts', async () => {
    // Aktiven Kart deterministisch pinnen (Demo-Kart 1): Sidebar-Status
    // ('Demo' schreibt der 1-Hz-Loop nur fuer den aktiven Kart) und der
    // Aktiv-Ring der Karte sind sonst reihenfolge-/retry-abhaengig -- die
    // alte Baseline trug so einen Zufallszustand (Phase 56b-Fund).
    // macs()[0] waere der lazy default-Bucket, nie der erste Demo-Kart.
    await ctx.page.evaluate(() => {
      const m = RasiTest.state.karts.macs().find((x) => x.indexOf('DE:MO:') === 0);
      RasiTest.state.karts.setActive(m);
      RasiTest.state.activeKartMac = m;
    });
    await ctx.page.click('.nav-item[data-tab="karts"]');
    await ctx.page.waitForFunction(() =>
      document.querySelectorAll('#kartCardsList [data-action="settings"]').length >= 3
      && !!document.querySelector('#kartCardsList .kart-card.active')
      && document.querySelector('#sideConnText').textContent === 'Demo');
    // Maus parken: sonst laege sie reihenfolgeabhaengig ueber einer Karte.
    await ctx.page.mouse.move(0, 0);
    await expect(ctx.page).toHaveScreenshot('demo-karts.png',
      Object.assign({ mask: masks(ctx.page) }, SHOT));
  });

  test('Verbindungsseite mit laufender Demo', async () => {
    // Aktiven Kart pinnen wie im Karts-Test: Sidebar-Status bleibt sonst
    // vom Vortest abhaengig (unmaskiert im Shot).
    await ctx.page.evaluate(() => {
      const m = RasiTest.state.karts.macs().find((x) => x.indexOf('DE:MO:') === 0);
      RasiTest.state.karts.setActive(m);
      RasiTest.state.activeKartMac = m;
    });
    await ctx.page.click('.nav-item[data-tab="connection"]');
    // Grid gefuellt: 3 Demo-Kart-Karten vom 1-Hz-Renderer (conn-ui.js);
    // Sidebar im eingeschwungenen Demo-Zustand.
    await ctx.page.waitForFunction(() =>
      document.querySelectorAll('#connGrid .cc-card[data-mac]').length >= 3
      && document.querySelector('#sideConnText').textContent === 'Demo');
    await ctx.page.mouse.move(0, 0);
    // Dynamische Wertefelder maskieren (RSSI-Jitter, Paketalter, Summen-Hz).
    // Maske und Baseline entstehen im selben Schritt (Lektion Phase 49).
    // Portstatus (Demo-Modus aktiv), Karts 3/3 und GPS 3x Fix sind statisch;
    // Demo-RSSI (-52/-63/-71 +-3) bleibt ueber -75 -> Ampel stabil gruen.
    const dyn = masks(ctx.page).concat([
      ctx.page.locator('#connGrid .cc-vals'),
      ctx.page.locator('#heroRate'),
    ]);
    await expect(ctx.page).toHaveScreenshot('demo-connection.png',
      Object.assign({ mask: dyn }, SHOT));
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
