# Phase 49: CSS-Fundament (Extraktion + Tokens + Screenshot-Baseline) — Implementierungsplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Der ~2.380-Zeilen-`<style>`-Block wandert pixel-neutral aus index.html nach `src/styles/` (Tokens, Basis, Komponenten, Seiten), alle 112 rohen Hex-Farben laufen über `var(--…)`, und eine Playwright-Screenshot-Baseline beweist die Neutralität und sichert Phase 50 ab.

**Architecture:** Kontiguierlicher Split an den vorhandenen Sektions-Bannern — jede Zieldatei ist ein zusammenhängender Ausschnitt des Originalblocks, die `@import`-Reihenfolge in `index.css` ist die Quelltext-Reihenfolge. Dadurch ist die Kaskade beweisbar unverändert: Konkatenation der Teil-Dateien == Originalblock (byte-weise, Verifikations-Skript). Screenshots werden nur in der CI (Linux) verglichen; die Baseline entsteht per Fehlschlag-Artefakt-Bootstrap aus dem bestehenden `playwright-results`-Upload.

**Tech Stack:** Vite (bündelt CSS-`@import` nativ), Playwright `toHaveScreenshot`, Node-Einmalskripte unter `.superpowers/phase49/` (gitignored), CJS-Dauerskript `scripts/check-css-tokens.js` als CI-Gate.

**Spec:** `docs/superpowers/specs/2026-07-14-modernisierung-49-54-design.md` (Abschnitt Phase 49)

## Global Constraints

- **Pixel-neutral:** Kein Farbwert, keine Regel, keine Reihenfolge ändert sich — nur Schreibweise (`#hex` → `var(--…)`) und Ablageort. Gate: CI-Screenshots identisch.
- **Reihenfolge 1:1:** Split nur an Banner-Grenzen; `index.css`-Importreihenfolge = Quelltext-Reihenfolge; nichts wird umsortiert.
- **Kein JS-Verhalten ändern:** Einzige JS-Änderung ist die CSS-Importzeile in `src/app.js`. CSP in index.html bleibt unverändert.
- **Neue Dateien ≤ 520 Inhaltszeilen** (`(Get-Content <f> | Measure-Object -Line).Lines`; größte erwartete Datei tables.css ~430).
- Alle Repo-Dateien sind **CRLF**: Vor jedem Edit die Zielregion frisch Read-en und den Anker aus diesem Read kopieren; Zeilennummern sind nur Richtwerte. Verifikation mit dem Grep-Tool, nie Shell-grep.
- Nie `git add` auf `.claude/`, `graphify-out/`, `CLAUDE.md` oder Plan-/Spec-Docs — Ausnahme: der explizite Plan-Doc-Commit in Task 6.

## Working Directory & Conventions

- Repo: `C:/Users/jimlu/Documents/RasiCross-Telemetrie-git`; Git-Befehle mit `git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" …`.
- Branch: `feat/phase-49-css-fundament`, erstellt ab `docs/modernisierung-49-54-spec` (trägt den Spec-Commit `49b3530` mit in den PR): `git checkout -b feat/phase-49-css-fundament docs/modernisierung-49-54-spec`.
- Pro Task: Verifikation (Kommandos im Task), dann Commit. Commit-Messages ohne Anführungszeichen im Text (PowerShell-5.1-Falle), mit den Harness-Trailern (Co-Authored-By + Claude-Session der laufenden Session).
- Einmalskripte liegen unter `.superpowers/phase49/` (gitignored via `.superpowers/`), Aufruf immer aus dem Repo-Root.

## Locked Decisions (aus der Spec + Planungsbefunden)

- **CI ist die einzige Wahrheit für Screenshots** (Linux-Baselines versioniert); lokale Windows-Läufe optional via `RASI_SCREENS=1`, deren `*-win32.png` sind gitignored.
- **Baseline-Bootstrap über das Fehlschlag-Artefakt:** Der erste CI-Lauf ohne Baselines schlägt planmäßig fehl; die `*-actual.png` aus dem `playwright-results`-Artefakt werden als `*-linux.png` committet. Kein Workflow-Umbau.
- **tokens.css enthält den Blockanfang** (Header-Banner, 1-Zeilen-Reset, `:root`, Basis-Element-Styles bis vor SIDEBAR): Null-Umsortierung schlägt Datei-Reinheit. Aufräumen ist Phase-50-Arbeit (mit Screenshot-Gate).
- **Nur exakte Hex-Treffer ersetzen:** `#abc` == `#aabbcc` (normalisiert, case-insensitiv). Ähnliche Farben werden NICHT zusammengelegt (wäre nicht pixel-neutral, gehört in Phase 50). `rgba(…)`-Werte bleiben unangetastet.
- **Neue Token-Namen** folgen dem Bestandsstil (kurz, semantisch: `--pr`, `--green`, `--surf2`): nach Verwendungszweck benennen; ist keiner erkennbar, Fallback `--x-<hex6>` (z. B. `--x-2a3150`).
- Demo-Screenshots laufen mit **laufendem Demo-Modus + Masken**: `toHaveScreenshot` verlangt zwei identische Frames in Folge — unmaskierte Live-Werte lassen den Test sofort scheitern, die Masken-Liste ist dadurch selbst-verifizierend.

## File Structure

| Aktion | Pfad | Verantwortung |
|---|---|---|
| Neu | `e2e/screens.spec.js` | Screenshot-Suite: 8 Tabs Ruhezustand, Live/Karts/Kart-Fenster im Demo |
| Neu | `e2e/screens.spec.js-snapshots/*-linux.png` | CI-Baselines (Task 2, aus Artefakt) |
| Ändern | `.gitignore` | `*-win32.png`-Baselines ausschließen |
| Neu | `src/styles/index.css` | `@import`-Liste in Quelltext-Reihenfolge |
| Neu | `src/styles/tokens.css` | Blockanfang: Banner, Reset, `:root`-Tokens, Basis-Elemente |
| Neu | `src/styles/base.css` | SIDEBAR + MAIN (Layout-Gerüst) |
| Neu | `src/styles/components.css` | BUTTONS, PILLS/BADGES, GRID, CARD, FORM, STATS |
| Neu | `src/styles/pages/live.css` | HERO KPI ROW … HEAT BTN |
| Neu | `src/styles/tables.css` | TABLES |
| Neu | `src/styles/pages/live-compact.css` | LIVE-TAB COMPACT VARIANTS |
| Neu | `src/styles/pages/track.css` | TRACK LIST |
| Neu | `src/styles/pages/drivers.css` | DRIVERS |
| Neu | `src/styles/pages/races.css` | RACE CARDS |
| Neu | `src/styles/pages/connection.css` | CONNECTION |
| Neu | `src/styles/modals.css` | MODALS |
| Neu | `src/styles/pages/pitwall.css` | PIT WALL OVERLAY inkl. Abschluss-`@media` (reduce-motion) |
| Ändern | `index.html` | `<style>`-Block entfällt komplett (Zeilen ~11–2392); Rest unverändert |
| Ändern | `src/app.js` | `import './styles/index.css';` als erste Zeile |
| Neu | `scripts/check-css-tokens.js` | CI-Gate: kein Hex außerhalb tokens.css, kein `<style>` in index.html |
| Ändern | `package.json` | Script `lint:css` |
| Ändern | `.github/workflows/check.yml` | Step `CSS-Token-Gate` im js-Job |
| Einmalig | `.superpowers/phase49/split-css.mjs` | Split-Skript (gitignored) |
| Einmalig | `.superpowers/phase49/verify-css.mjs` | Konkatenation == Original (gitignored) |
| Einmalig | `.superpowers/phase49/hex-inventory.mjs` | Hex-Inventur mit Token-Vorschlag (gitignored) |

Task-Reihenfolge: 1 → 2 → 3 → 4 → 5 → 6 (strikt sequenziell; 2 braucht die CI, 3/4 brauchen das Gate aus 2).

---

### Task 1: Screenshot-Suite `e2e/screens.spec.js`

**Files:**
- Create: `e2e/screens.spec.js`
- Modify: `.gitignore` (Ende der Playwright-Sektion)

**Interfaces:**
- Consumes: `launchApp()/closeApp()` aus `e2e/helpers.js` (bestehend); Demo-Start-Klickfolge aus `e2e/demo.spec.js` (`#modeDemoBtn`, `#demoStartBtn`); Kart-Fenster-Öffnung aus `e2e/karts.spec.js` (`#kartCardsList … [data-action="settings"]` + `app.waitForEvent('window')`).
- Produces: Screenshot-Namen `tab-<tab>.png` (8×), `demo-live.png`, `demo-karts.png`, `demo-kart-fenster.png` — Task 2 friert genau diese als `*-linux.png` ein; Task 3/4 verlassen sich auf ihre Unveränderlichkeit.

- [ ] **Step 1: Spec-Datei anlegen** — `e2e/screens.spec.js` komplett:

```js
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
const DYN = ['canvas', '.map'];

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
    await ctx.page.waitForFunction(() => RasiTest.state.karts.size >= 3);
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
```

- [ ] **Step 2: `.gitignore` ergänzen** — Region „Playwright-Smoke (Phase 41)" frisch Read-en, danach anhängen:

```
# Screenshot-Baselines (Phase 49): nur die Linux-(CI-)Baselines sind
# versioniert; lokale Windows-Baselines bleiben privat.
e2e/**/*-win32.png
```

- [ ] **Step 3: Masken-Iteration lokal** — zweimal laufen lassen; Lauf 1 schreibt Windows-Baselines, Lauf 2 muss grün sein:

```powershell
$env:RASI_SCREENS='1'; npm run test:e2e -- e2e/screens.spec.js --update-snapshots
$env:RASI_SCREENS='1'; npm run test:e2e -- e2e/screens.spec.js
```

Erwartung Lauf 2: 11 passed. Bei „Screenshot comparison failed" oder Timeout („screenshots do not match" in Serie): Diff-Bild unter `test-results/**` ansehen, den CSS-Selektor der diffenden Region (typisch: Rundenzeiten-Listen, KPI-Werte, Status-Punkte, Kart-Karten-Statuszeile, Stats-Zeile im Kart-Fenster) in die `DYN`-Konstante aufnehmen, beide Läufe wiederholen. Abbruchkriterium: Läufe 1+2 in Folge grün ohne neue Masken.

- [ ] **Step 4: Lint + Commit** (die `*-win32.png` sind gitignored und dürfen NICHT im Commit landen):

```powershell
npm run lint
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" add e2e/screens.spec.js .gitignore
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" status --short
```

Erwartung: nur die zwei Dateien gestaged. Commit-Message: `test(e2e): Screenshot-Suite -- 8 Tabs Ruhezustand + Demo-Live/Karts/Kart-Fenster, Vergleich nur CI-Linux (Phase 49 Task 1)`

---

### Task 2: Linux-Baselines aus dem CI-Artefakt einfrieren

**Files:**
- Create: `e2e/screens.spec.js-snapshots/*-linux.png` (11 Dateien)

**Interfaces:**
- Consumes: Screenshot-Namen aus Task 1; bestehender `playwright-results`-Artefakt-Upload in `.github/workflows/check.yml` (Step „Testartefakte bei Fehlschlag").
- Produces: die 11 versionierten `*-linux.png`; ab hier ist der smoke-Job das Screenshot-Gate für Task 3/4 und Phase 50.

- [ ] **Step 1: Branch pushen, planmäßigen Fehlschlag abwarten**

```powershell
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" push -u origin feat/phase-49-css-fundament
$run = gh run list --branch feat/phase-49-css-fundament --limit 1 --json databaseId --jq '.[0].databaseId'
gh run watch $run --exit-status
```

(`gh run watch` braucht die Run-ID — ohne sie fragt es interaktiv nach und hängt. Dieses Muster gilt für ALLE CI-Warte-Schritte in diesem Plan.)

Erwartung: js + python grün, **smoke rot** mit `Error: A snapshot doesn't exist at … screens.spec.js-snapshots/…-linux.png` pro Screenshot (planmäßig — die Baselines existieren noch nicht).

- [ ] **Step 2: Artefakt laden und Actuals als Baselines übernehmen**

```powershell
$run = gh run list --branch feat/phase-49-css-fundament --limit 1 --json databaseId --jq '.[0].databaseId'
gh run download $run -n playwright-results -D .superpowers/phase49/artefakt
New-Item -ItemType Directory -Force e2e/screens.spec.js-snapshots
Get-ChildItem -Recurse .superpowers/phase49/artefakt -Filter '*-actual.png' | ForEach-Object { Copy-Item $_.FullName ("e2e/screens.spec.js-snapshots/" + ($_.Name -replace '-actual\.png$','-linux.png')) -Force }
(Get-ChildItem e2e/screens.spec.js-snapshots -Filter '*-linux.png').Count
```

Erwartung: `11`. Die PNGs stichprobenartig ansehen (Read-Tool auf 2–3 Dateien): Tabs müssen gefüllt gerendert sein, nicht weiß/leer.

- [ ] **Step 3: Committen, pushen, CI grün sehen**

```powershell
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" add e2e/screens.spec.js-snapshots
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" status --short
```

Erwartung: nur `*-linux.png` gestaged (keine `-win32`, kein Artefakt-Ordner). Commit-Message: `test(e2e): Linux-Screenshot-Baselines aus CI-Artefakt eingefroren (Phase 49 Task 2)`. Dann push und CI abwarten (Run-ID-Muster aus Step 1) — Erwartung: **alle Jobs grün** (Gate scharf).

---

### Task 3: CSS-Extraktion nach `src/styles/` (1:1-Verschiebung)

**Files:**
- Create: `src/styles/index.css`, `src/styles/tokens.css`, `src/styles/base.css`, `src/styles/components.css`, `src/styles/tables.css`, `src/styles/modals.css`, `src/styles/pages/{live,live-compact,track,drivers,races,connection,pitwall}.css`
- Modify: `index.html` (`<style>`-Block raus), `src/app.js` (Importzeile)
- Einmalskripte: `.superpowers/phase49/split-css.mjs`, `.superpowers/phase49/verify-css.mjs`

**Interfaces:**
- Consumes: Sektions-Banner im `<style>`-Block (Namen exakt: `SIDEBAR`, `BUTTONS`, `HERO KPI ROW`, `TABLES`, `LIVE-TAB COMPACT` (Präfix), `TRACK LIST`, `DRIVERS`, `RACE CARDS`, `CONNECTION`, `MODALS`, `PIT WALL OVERLAY`); Screenshot-Gate aus Task 2.
- Produces: die 13 CSS-Dateien + Importkette; Task 4/5 und Phase 50 arbeiten ausschließlich auf `src/styles/`.

- [ ] **Step 1: Split-Skript anlegen** — `.superpowers/phase49/split-css.mjs` komplett:

```js
// Phase 49: zerlegt den <style>-Block von index.html an den
// Banner-Grenzen in src/styles/*.css. Reine Verschiebung: Zeilen 1:1,
// Reihenfolge = Quelltext-Reihenfolge. Schreibt ausserdem index.html
// ohne den Block, src/styles/index.css (@import-Liste) und sichert den
// Originalblock fuer verify-css.mjs.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const NL = '\r\n';
const html = readFileSync('index.html', 'utf8');
const lines = html.split(NL);
const open = lines.findIndex((l) => l.trim() === '<style>');
const close = lines.findIndex((l) => l.trim() === '</style>');
if (open < 0 || close < open) throw new Error('style-Block nicht gefunden');
const block = lines.slice(open + 1, close);

// Zieldateien in Quelltext-Reihenfolge. Startanker = Zeile, deren
// Trim exakt dem Namen entspricht (bzw. mit ihm beginnt); die
// ====-Bannerzeile direkt darueber gehoert zur Sektion.
const FILES = [
  ['tokens.css', null],
  ['base.css', 'SIDEBAR'],
  ['components.css', 'BUTTONS'],
  ['pages/live.css', 'HERO KPI ROW'],
  ['tables.css', 'TABLES'],
  ['pages/live-compact.css', 'LIVE-TAB COMPACT'],
  ['pages/track.css', 'TRACK LIST'],
  ['pages/drivers.css', 'DRIVERS'],
  ['pages/races.css', 'RACE CARDS'],
  ['pages/connection.css', 'CONNECTION'],
  ['modals.css', 'MODALS'],
  ['pages/pitwall.css', 'PIT WALL OVERLAY'],
];

const starts = FILES.map(([, name]) => {
  if (name === null) return 0;
  const i = block.findIndex((l) => l.trim() === name || l.trim().startsWith(name));
  if (i < 1) throw new Error('Sektions-Banner fehlt: ' + name);
  return i - 1;
});
for (let i = 1; i < starts.length; i++) {
  if (starts[i] <= starts[i - 1]) throw new Error('Reihenfolge verletzt bei ' + FILES[i][0]);
}

mkdirSync('src/styles/pages', { recursive: true });
mkdirSync('.superpowers/phase49', { recursive: true });
writeFileSync('.superpowers/phase49/original-style.css', block.join(NL) + NL);

FILES.forEach(([f], i) => {
  const end = i + 1 < starts.length ? starts[i + 1] : block.length;
  writeFileSync('src/styles/' + f, block.slice(starts[i], end).join(NL) + NL);
});

writeFileSync('src/styles/index.css', [
  '/* Phase 49: @import-Reihenfolge = fruehere Quelltext-Reihenfolge des',
  '   <style>-Blocks aus index.html. NICHT umsortieren -- Kaskade! */',
  ...FILES.map(([f]) => `@import './${f}';`),
  '',
].join(NL));

writeFileSync('index.html',
  lines.slice(0, open).concat(lines.slice(close + 1)).join(NL));
console.log('OK: ' + FILES.length + ' Dateien, Block ' + block.length + ' Zeilen');
```

- [ ] **Step 2: Verifikations-Skript anlegen** — `.superpowers/phase49/verify-css.mjs` komplett:

```js
// Phase 49: beweist die 1:1-Verschiebung -- Konkatenation der
// Split-Dateien in Import-Reihenfolge == gesicherter Originalblock.
import { readFileSync } from 'node:fs';
const NL = '\r\n';
const ORDER = ['tokens.css', 'base.css', 'components.css', 'pages/live.css',
  'tables.css', 'pages/live-compact.css', 'pages/track.css',
  'pages/drivers.css', 'pages/races.css', 'pages/connection.css',
  'modals.css', 'pages/pitwall.css'];
const strip = (s) => s.replace(/\r\n$/, '');
const concat = ORDER.map((f) => strip(readFileSync('src/styles/' + f, 'utf8'))).join(NL);
const ref = strip(readFileSync('.superpowers/phase49/original-style.css', 'utf8'));
if (concat === ref) { console.log('IDENTISCH'); process.exit(0); }
const a = concat.split(NL); const b = ref.split(NL);
for (let i = 0; i < Math.max(a.length, b.length); i++) {
  if (a[i] !== b[i]) {
    console.error('Diff ab Zeile ' + (i + 1));
    console.error('Split   : ' + a[i]);
    console.error('Original: ' + b[i]);
    process.exit(1);
  }
}
process.exit(1);
```

- [ ] **Step 3: Split ausführen und beweisen**

```powershell
node .superpowers/phase49/split-css.mjs
node .superpowers/phase49/verify-css.mjs
```

Erwartung: `OK: 12 Dateien, Block ~2380 Zeilen`, dann `IDENTISCH`. Bei „Sektions-Banner fehlt" oder „Reihenfolge verletzt": Banner-Schreibweise im frisch ge-Read-eten Block prüfen und den Anker in FILES exakt anpassen — NICHT die Sektionsgrenzen freihändig wählen. Zusätzlich Größen-Gate: `git ls-files -o src/styles | %{ "{0,5} {1}" -f (Get-Content $_ | Measure-Object -Line).Lines, $_ }` — keine Datei > 520 Inhaltszeilen. Läuft eine drüber, an einem weiteren vorhandenen Banner INNERHALB ihres Bereichs zusätzlich schneiden (neue Datei an der Position in FILES + ORDER beider Skripte ergänzen, verify erneut).

- [ ] **Step 4: `src/app.js` — Importzeile.** Datei frisch Read-en; VOR den Kopfkommentar (`// RasiCross Entry (Phase 42): …`) einfügen:

```js
// Styles zuerst (Phase 49): reiner CSS-Import, fuehrt kein JS aus.
// Die Regel "app-init.js MUSS erster Import sein" (unten) betrifft
// nur Module mit Ausfuehrungsreihenfolge.
import './styles/index.css';
```

- [ ] **Step 5: index.html prüfen** — mit dem Grep-Tool: Pattern `<style` in `index.html` → 0 Treffer; Pattern `</head>` → 1 Treffer (Head-Struktur intakt); CSP-Zeile unverändert vorhanden (Pattern `Content-Security-Policy`).

- [ ] **Step 6: Lokale Gates**

```powershell
npm test
npm run lint
npm run test:e2e
```

Erwartung: Unit-Tests grün, Lint grün, Smoke-Suite grün (screens.spec lokal geskippt). Optional-Sichtprüfung: `npm start` — App sieht unverändert aus.

- [ ] **Step 7: Commit + CI-Gate**

```powershell
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" add src/styles src/app.js index.html
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" status --short
```

Erwartung: keine `.superpowers/`-Dateien gestaged. Commit-Message: `refactor(css): style-Block aus index.html nach src/styles verschoben -- 1zu1, Reihenfolge erhalten (Phase 49 Task 3)`. Push, dann CI abwarten (Run-ID-Muster aus Task 2) — Erwartung: alle Jobs grün, **insbesondere Screenshots identisch** (das ist der Pixel-Neutralitäts-Beweis).

---

### Task 4: Hex-Inventur + `var(--…)`-Umstellung

**Files:**
- Modify: `src/styles/*.css`, `src/styles/pages/*.css` (Hex → var), `src/styles/tokens.css` (neue Tokens)
- Einmalskript: `.superpowers/phase49/hex-inventory.mjs`

**Interfaces:**
- Consumes: Token-Bestand in `src/styles/tokens.css` (`--bg`, `--surf`, `--pr`, `--green`, … Stil: kurz, semantisch); Screenshot-Gate.
- Produces: hex-freie Styles außerhalb tokens.css — Task 5 macht genau das zum CI-Gate.

- [ ] **Step 1: Inventur-Skript anlegen** — `.superpowers/phase49/hex-inventory.mjs` komplett:

```js
// Phase 49: listet #hex-Farben ausserhalb tokens.css und schlaegt
// exakte Token-Treffer vor. NEU = Solitaer, braucht neues Token.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const norm = (h) => {
  let x = h.toLowerCase();
  if (x.length === 4) x = '#' + [...x.slice(1)].map((c) => c + c).join('');
  return x;
};
const tokens = readFileSync('src/styles/tokens.css', 'utf8');
const map = new Map();
for (const m of tokens.matchAll(/(--[a-z0-9-]+)\s*:\s*(#[0-9a-fA-F]{3,8})\s*;/g)) {
  const v = norm(m[2]);
  if (!map.has(v)) map.set(v, m[1]);
}
const files = [];
const walk = (d) => {
  for (const e of readdirSync(d, { withFileTypes: true })) {
    if (e.isDirectory()) walk(join(d, e.name));
    else if (e.name.endsWith('.css') && e.name !== 'tokens.css') files.push(join(d, e.name));
  }
};
walk('src/styles');
let n = 0;
for (const f of files) {
  readFileSync(f, 'utf8').split('\r\n').forEach((line, i) => {
    for (const m of line.matchAll(/#[0-9a-fA-F]{3,8}\b/g)) {
      const t = map.get(norm(m[0]));
      console.log(f + ':' + (i + 1) + ' ' + m[0] + ' -> ' + (t ? 'var(' + t + ')' : 'NEU'));
      n++;
    }
  });
}
console.log(n + ' Vorkommen');
```

- [ ] **Step 2: Inventur laufen lassen und abarbeiten**

```powershell
node .superpowers/phase49/hex-inventory.mjs
```

Erwartung: ~112 Zeilen (die Zahl aus der Spec bezog sich auf den Gesamtblock; tokens.css-Definitionen zählen hier nicht mehr mit). Abarbeitung mit dem Edit-Tool, Datei für Datei, Region vorher frisch Read-en:
  - `… -> var(--x)`: Hex exakt durch `var(--x)` ersetzen (auch innerhalb von Gradients/Shadows; Groß-/Kleinschreibung und 3er-Form des Originals beim Suchen beachten).
  - `… -> NEU`: erst Token in `tokens.css` anlegen — am Ende des `:root`-Blocks (Region frisch Read-en, vor der schließenden `}`) ein Block:

```css
  /* Phase 49: Solitaer-Farben, aus dem Bestand gehoben (Wert unveraendert) */
  --scroll-thumb:#2a3150;   /* Beispielform -- echte Namen nach Zweck */
```

  Namensregel aus Locked Decisions (Zweck-Name, sonst `--x-<hex6>`). Danach die Fundstelle auf `var(--…)` umstellen. Mehrfach vorkommende NEU-Werte bekommen EIN Token.

- [ ] **Step 3: Inventur leer + Gates**

```powershell
node .superpowers/phase49/hex-inventory.mjs
npm test
npm run test:e2e
```

Erwartung: `0 Vorkommen`; Tests grün (screens lokal geskippt).

- [ ] **Step 4: Commit + CI-Gate**

Stage nur `src/styles`. Commit-Message: `refactor(css): Hex-Farben auf tokens-var umgestellt, Solitaer-Tokens ergaenzt -- Werte unveraendert (Phase 49 Task 4)`. Push, CI abwarten (Run-ID-Muster): alle Jobs grün, Screenshots identisch.

---

### Task 5: CSS-Token-Gate in CI

**Files:**
- Create: `scripts/check-css-tokens.js`
- Modify: `package.json` (scripts), `.github/workflows/check.yml` (js-Job)

**Interfaces:**
- Consumes: hex-freien Zustand aus Task 4; `<style>`-freie index.html aus Task 3.
- Produces: `npm run lint:css` — dauerhaftes Gate; Phase 50 baut darauf.

- [ ] **Step 1: Gate-Skript anlegen** — `scripts/check-css-tokens.js` komplett (CJS wie main.js):

```js
'use strict';
// CI-Gate (Phase 49): Farbwerte gehoeren nach tokens.css.
// (1) Kein rohes #hex ausserhalb von src/styles/tokens.css
// (2) index.html enthaelt keinen <style>-Block mehr
const fs = require('fs');
const path = require('path');

let bad = 0;
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).forEach((e) => {
  const p = path.join(d, e.name);
  if (e.isDirectory()) return walk(p);
  if (!e.name.endsWith('.css') || e.name === 'tokens.css') return;
  fs.readFileSync(p, 'utf8').split(/\r?\n/).forEach((line, i) => {
    const m = line.match(/#[0-9a-fA-F]{3,8}\b/);
    if (m) { console.error(p + ':' + (i + 1) + ' rohes Hex ' + m[0] + ' -- Token in tokens.css anlegen'); bad++; }
  });
});
walk('src/styles');
if (/<style/i.test(fs.readFileSync('index.html', 'utf8'))) {
  console.error('index.html: <style> gefunden -- CSS gehoert nach src/styles/');
  bad++;
}
if (bad) process.exit(1);
console.log('CSS-Token-Gate: OK');
```

- [ ] **Step 2: `package.json`** — Region `"scripts"` frisch Read-en; nach der `"lint"`-Zeile einfügen:

```json
    "lint:css": "node scripts/check-css-tokens.js",
```

- [ ] **Step 3: `.github/workflows/check.yml`** — js-Job frisch Read-en; nach dem Step „Lint JS" einfügen:

```yaml
      - name: CSS-Token-Gate
        run: npm run lint:css
```

- [ ] **Step 4: Lokal prüfen**

```powershell
npm run lint:css
node --check scripts/check-css-tokens.js
npm run lint
```

Erwartung: `CSS-Token-Gate: OK`, beide Checks grün. Negativ-Probe: vorübergehend ein `#fff` in `src/styles/base.css` einfügen → Skript muss mit Fundstelle und Exit 1 abbrechen → Änderung rückgängig machen (`git checkout -- src/styles/base.css`), Skript wieder grün.

- [ ] **Step 5: Commit + CI**

Stage: `scripts/check-css-tokens.js package.json .github/workflows/check.yml`. Commit-Message: `chore(ci): CSS-Token-Gate -- kein Hex ausserhalb tokens.css, kein style-Block in index.html (Phase 49 Task 5)`. Push, CI abwarten (Run-ID-Muster): alle Jobs grün inkl. neuem Step.

---

### Task 6: Volle Gates + Graph + Plan-Doc

- [ ] **Step 1: Komplettes Verifikationsrezept**

```powershell
node --check main.js; node --check preload.js; node --check tiles.js
npm test
npm run lint
npm run lint:css
npm run test:e2e
python -m py_compile sender.py bridge.py esp_libs/calc.py
python -m unittest discover -s test -p "test_*.py"
Get-ChildItem -Recurse -Directory -Filter __pycache__ | Remove-Item -Recurse -Force
```

Erwartung: alles grün (Python unangetastet, Rezept läuft trotzdem). `git status` zeigt außer `.claude/`, `CLAUDE.md`, `graphify-out/` (untracked, NIE stagen) nur das Plan-Doc.

- [ ] **Step 2: Graph aktualisieren** — `graphify update .` (AST-only).

- [ ] **Step 3: Plan-Doc committen** (einzige erlaubte Plan-Doc-Stage):

```powershell
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" add docs/superpowers/plans/2026-07-14-49-css-fundament.md
```

Commit-Message: `docs(plan): Phase 49 CSS-Fundament Implementierungsplan (Phase 49 Task 6)`. Push; danach `finishing-a-development-branch` (PR gegen main).

---

## Hardware/Manual Acceptance Checklist (User, nach Merge)

- [ ] `npm start`: alle 8 Tabs durchklicken — Optik exakt wie vor Phase 49 (Farben, Abstände, Schriften).
- [ ] Demo-Modus starten, ein Kart-Fenster öffnen — Fenster-Layout unverändert.
- [ ] Optional: Portable-EXE bauen (`npm run build-portable`), starten, Stichprobe Live- und Pit-Wall-Tab.

## Self-Review

- **Spec-Abdeckung (Phase-49-Abschnitt):** Dateistruktur ✔ (kontiguierlicher Split; Abweichung von der Spec-Beispielstruktur — tables/modals/live-compact als eigene Dateien, tokens.css trägt den Blockanfang — folgt aus der Locked Decision Null-Umsortierung), Token-Vervollständigung ✔ (Task 4, nur exakte Treffer), Hex-Lint-Gate ✔ (Task 5), Screenshot-Baseline vor der Extraktion ✔ (Task 1+2 vor 3), Gate „kein `<style>` mehr" ✔ (Task 3 Step 5 + Task 5 dauerhaft), CI als einzige Screenshot-Wahrheit ✔ (skip-Guard + Linux-Baselines).
- **Platzhalter-Scan:** Keine TBD/TODO; alle Skripte vollständig; die Masken-Liste `DYN` startet konkret (`canvas`, `.map`) und wächst über ein definiertes, selbst-verifizierendes Verfahren (zwei grüne Läufe in Folge) — kein offenes Ende.
- **Namens-Konsistenz:** Dateiliste in `FILES` (split-css.mjs) == `ORDER` (verify-css.mjs) == `@import`-Liste (index.css) == File-Structure-Tabelle; Screenshot-Namen in Task 1 == Bootstrap-Zählung 11 in Task 2 (8 Tabs + 3 Demo).

## Abweichungen bei Ausführung (Nachtrag, 2026-07-14)

Die Screenshot-Gate-Mechanik wurde während Task 3 von der Realität überholt; der Shipped-Zustand weicht in drei Punkten vom obigen Plan ab (vollständige Fix-Kette in den Commit-Messages c7fb2cc → 125d500 → c82ef6a → 3d2c67c → 0005918):

1. **Baselines regeneriert, Beweis-Semantik erhalten:** Die Task-2-Baselines racten gegen JS-Boot-Zustände (1-Hz-Tick, 200-ms-Sidebar-Spiegel). Der finale Harness (Tick-Wait in `prep()` + `#connOverviewGps`-Maske wegen eines vorbestehenden Dual-Writer-Bugs pit-wall.js/ui-glue.js) wurde auf den Prä-Extraktions-Stand 7837523 angewandt und die Baselines dort neu eingefroren — Baseline bleibt „Rendering vor der Extraktion".
2. **`maxDiffPixels: 2` statt „nie Toleranzen aufweichen":** GitHub-Runner rendern Font-Kanten instanzabhängig minimal verschieden (nachgewiesener 1px-Jitter, identische Koordinate über 10 Tests). User-Entscheid 2026-07-14; die Task-1-Formulierung „nie Toleranzen aufweichen" ist damit überholt und gilt nicht als Referenz für Folgephasen.
3. **`.sidebar`-Maske erprobt und zurückgenommen:** Ganz-Sidebar-Maskierung würde das Gate für Sidebar-Regressionen (Phase-50-Kernbereich) blind machen; außerdem sind nachträgliche Masken ohne Baseline-Regeneration strukturell unverträglich (Maske muss auf beiden Vergleichsseiten existieren).

Für Phase 50 vorgemerkt (Final-Review): Dialog-/Modal-Screenshots ergänzen, bevor modals.css angefasst wird (Spec-Zusage „wichtigste Dialoge" wurde in diesem Plan stillschweigend verengt); 2× `#000` in tokens.css-*Regeln* (outdoor-Theme) auf Tokens umstellen oder das Gate auf Deklarationszeilen verschärfen; `on-pr-*`-Farbvarianten vereinheitlichen.

## Phase Map

- Phasen 41–45: Technisches Redesign — merged. Phasen 46–48: Kart-Seite/-Einstellungen/-Fenster — merged (PR #75).
- **Phase 49 (dieses Dokument):** CSS-Fundament — Basis für Phase 50.
- Phase 50: UI-Konsistenz-Pass (nutzt tokens.css + Screenshot-Gate). Phasen 51–54: Tests, TypeScript ×2, Langzeit-Performance — je eigener Plan.
