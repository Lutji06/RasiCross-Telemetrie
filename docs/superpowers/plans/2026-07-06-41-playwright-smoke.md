# Phase 41 — Test-Sicherheitsnetz (Playwright-Smoke) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Playwright-basierte UI-Smoke-Suite für das Electron-Dashboard, die App-Start, Tab-Rendering, Demo-Modus (3 Karts), Rennen starten/stoppen, `buildRaceDataForKart`-Payloads und den Recording/Replay-Roundtrip absichert — in CI (GitHub Actions, Xvfb) und lokal unter Windows.

**Architecture:** `@playwright/test` als devDependency treibt Electron über `_electron.launch` (kein Browser-Download nötig — Playwright steuert das vorhandene Electron-Binary per CDP). Tests liegen in `e2e/` (CommonJS, `.spec.js` — von `node --test` nicht erfasst), Asserts laufen über `page.evaluate` gegen die echten App-Globals (`state`, `activeRace()`, `buildRaceDataForKart()`, `RasiReplay`). Ein 5-Zeilen-Hook in `main.js` lenkt `userData` auf ein Wegwerf-Verzeichnis, damit Tests nie echte Nutzerdaten (localStorage, Tile-Cache, Crash-Datei) berühren. Bewusst Smoke-Tiefe: keine Pixel-Prüfung, keine Screenshots.

**Tech Stack:** Electron 36 (vorhanden), `@playwright/test` (neu, latest), node:test (bestehende 177 Tests, unverändert), GitHub Actions (`check.yml`, neuer `smoke`-Job mit `xvfb-run`).

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-06-technical-redesign-program-design.md`, Abschnitt „Phase 41".
- **Gate:** Smoke-Suite läuft in CI (GitHub Actions, headless via Xvfb) und lokal unter Windows.
- Keine Feature-/UI-Änderungen. Einzige App-Code-Änderung: der `RASI_TEST_USERDATA`-Hook in `main.js`.
- `npm test` (node --test) bleibt unangetastet und grün: **177 Tests**. Python-Suiten unverändert.
- Datenformate (`SAVE_KEY`, `REC_VERSION` 9.6, serielles JSON) werden nicht angefasst.
- Keine Pixel-/Screenshot-Prüfungen — nur strukturelle Smoke-Asserts.
- `e2e/` und `playwright.config.js` kommen NICHT in die `build.files`-Whitelist von package.json (werden nicht paketiert).

## Working Directory & Conventions

- Arbeitsverzeichnis: `C:/Users/jimlu/Documents/RasiCross-Telemetrie-git`; git immer als `git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" …`.
- Branch: `feat/phase-41-playwright-smoke`, abgezweigt von `docs/technical-redesign-spec` (enthält das Spec-Commit ad7fa5e; PR am Ende gegen `main`, wie Phase 40 / PR #62).
- Dateien sind **CRLF**: Ziel-Region unmittelbar vor jedem Edit frisch lesen und den Anker aus diesem Read kopieren; Zeilennummern sind nur Richtwerte. Verifikation mit dem Grep-Tool (nicht Shell-grep).
- Niemals `.claude/`, `CLAUDE.md`, `graphify-out/` oder dieses Plan-Dokument committen — Ausnahme: das explizite Plan-Doc-Commit in Task 6.
- Commit-Messages: conventional + Body, ohne Anführungszeichen im Text (PowerShell-5.1-Falle), mit den vom Harness vorgegebenen Co-Authored-By-/Claude-Session-Trailern.
- Vor jedem `git status`: `__pycache__` löschen.

## Locked Decisions

- **Playwright, nicht CDP-Handarbeit:** Der frühere CDP-Smoke-Treiber (`%TEMP%\rasicross-smoke\`) existiert nicht mehr (Verzeichnis ist leer) — die Suite wird frisch auf `@playwright/test` aufgebaut (Spec-Entscheidung).
- **`e2e/` statt `test/`:** `node --test` erfasst rekursiv alles unter Verzeichnissen namens `test` — die Playwright-Specs müssen außerhalb liegen. Namensschema `*.spec.js` (matcht Playwright-Default, nicht node:test).
- **Asserts über App-Globals statt DOM-Details:** Die klassischen Scripts legen Funktionsdeklarationen (`startDemo`, `activeRace`, `toggleRaceRun`, `endRace`, `activeKart`, `buildRaceDataForKart`, `enterReplay`, `exitReplay`) auf window; `const state` (rasicross.js:38) ist als globales lexikalisches Binding aus `page.evaluate` erreichbar. Das überlebt UI-Umbauten (Phasen 42–44) besser als CSS-Selektor-Ketten.
- **Rennen-Steuerung per `evaluate`, nicht Button-Klick:** `startRaceBtn`/`endRaceBtn` haben statusabhängige `disabled`-Logik (races.js:480–494); die Smoke-Suite ruft `toggleRaceRun()`/`endRace(false)` direkt — exakt die Funktionen, die die Buttons binden (rasicross.js:1194–1195).
- **userData-Isolation per Env-Hook in main.js:** Electron bietet keinen CLI-Switch, der `app.getPath('userData')` umlenkt; `app.setPath('userData', …)` vor `app.whenReady()` ist der offizielle Weg. Nur aktiv, wenn `RASI_TEST_USERDATA` gesetzt ist.
- **CI:** eigener `smoke`-Job in `check.yml` (ubuntu-latest, `xvfb-run`, `--no-sandbox` nur unter CI). Kein `playwright install` nötig (Electron-Binary wird genutzt). `js`-/`python`-Jobs bleiben unverändert.
- **Wartezeiten:** Demo-Runde dauert ~83 s; Kart 3 startet 3,2 rad vor dem Gate → `lapStart` für alle 3 Karts nach spätestens ~45 s Echtzeit. Der Demo-Test bekommt 180 s Test-Timeout, das `waitForFunction`-Timeout 120 s.

## File Structure

| Action | Path | Responsibility |
|---|---|---|
| Create | `playwright.config.js` | Playwright-Konfig: testDir `e2e`, 1 Worker, 120 s Timeout, Trace bei Fehlschlag |
| Create | `e2e/helpers.js` | `launchApp()`/`closeApp()`: Electron-Launch mit frischem userData, Konsolen-Fehler-Sammler |
| Create | `e2e/app.spec.js` | Smoke: App startet ohne Konsolen-Fehler; alle 7 Tabs rendern |
| Create | `e2e/demo.spec.js` | Smoke: Demo → 3 Karts mit laufenden Rundenzeiten; Rennen pausieren/fortsetzen/beenden; `buildRaceDataForKart`-Payloads |
| Create | `e2e/replay.spec.js` | Smoke: Recording → serialize → parse → Replay → exit (Roundtrip) |
| Modify | `main.js:14-22` | `RASI_TEST_USERDATA`-Hook (userData-Isolation für Tests) |
| Modify | `package.json:8-24` | devDependency `@playwright/test`; Script `test:e2e` |
| Modify | `eslint.config.js:141-153` | Config-Block für `e2e/**` + `playwright.config.js` |
| Modify | `.gitignore` | `test-results/`, `playwright-report/` |
| Modify | `.github/workflows/check.yml` | Neuer `smoke`-Job (Xvfb) |
| Commit | `docs/superpowers/plans/2026-07-06-41-playwright-smoke.md` | Dieses Plan-Dokument (nur im finalen Task) |

**Task-Reihenfolge:** 1 (Infrastruktur + App-Start-Smoke) → 2 (Tabs) → 3 (Demo, 3 Karts) → 4 (Rennen + Payloads) → 5 (Replay-Roundtrip) → 6 (CI + finale Verifikation + Plan-Doc).

---

### Task 1: Playwright-Infrastruktur + Smoke „App startet"

**Files:**
- Create: `playwright.config.js`
- Create: `e2e/helpers.js`
- Create: `e2e/app.spec.js`
- Modify: `main.js:14-22` (Hook nach den require-try/catch-Blöcken)
- Modify: `package.json:8-17` (Script), `package.json:18-24` (devDependency via npm)
- Modify: `eslint.config.js:141-153` (neuer Block nach dem main.js/preload-Block)
- Modify: `.gitignore` (Playwright-Artefakte)

**Interfaces:**
- Consumes: `main.js`-Bootpfad (`app.whenReady` → `createWindow` lädt `RasiCross_Telemetry.html`); App-Global `state` (rasicross.js:38, `const` → global-lexikalisch, aus `page.evaluate` sichtbar).
- Produces: `launchApp() → Promise<{ app, page, errors, userData }>` und `closeApp(app, userData) → Promise<void>` aus `e2e/helpers.js` — **alle späteren Tasks nutzen exakt diese zwei Funktionen**. `errors` ist ein `string[]`, das Konsolen-`error`-Meldungen und `pageerror`s sammelt.

- [ ] **Step 1: Branch anlegen**

```bash
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" checkout -b feat/phase-41-playwright-smoke docs/technical-redesign-spec
```

- [ ] **Step 2: Failing test schreiben — `e2e/app.spec.js` (erster Test) + `e2e/helpers.js` + `playwright.config.js`**

`playwright.config.js` (neu, Repo-Root):

```js
'use strict';
// Playwright-Konfiguration fuer die Electron-Smoke-Suite (Phase 41).
// Nur e2e/ -- die node:test-Suite (test/) laeuft weiter unter `npm test`.
const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: 'e2e',
  timeout: 120000,
  fullyParallel: false,
  workers: 1,                            // eine Electron-Instanz zur Zeit
  retries: process.env.CI ? 1 : 0,
  reporter: [['list']],
  use: { trace: 'retain-on-failure' },
});
```

`e2e/helpers.js` (neu):

```js
'use strict';
// Gemeinsamer Electron-Launcher fuer die Smoke-Suite (Phase 41).
// Jeder Test bekommt ein frisches userData-Verzeichnis (RASI_TEST_USERDATA,
// Hook in main.js) -- localStorage, Tile-Cache und Crash-Datei der echten
// App bleiben unberuehrt. Konsolen-Fehler werden gesammelt; die Tests
// pruefen das Array am Ende.
const { _electron: electron } = require('@playwright/test');
const fs = require('fs');
const os = require('os');
const path = require('path');

// Bekannte, harmlose Fehlermeldungen per Teilstring erlauben (bewusst leer;
// nur nach Team-Entscheid fuellen).
const CONSOLE_ERROR_ALLOWLIST = [];

async function launchApp() {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'rasicross-e2e-'));
  const app = await electron.launch({
    args: ['.'].concat(process.env.CI ? ['--no-sandbox'] : []),
    cwd: path.join(__dirname, '..'),
    env: Object.assign({}, process.env, { RASI_TEST_USERDATA: userData }),
  });
  const page = await app.firstWindow();
  const errors = [];
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    const text = msg.text();
    if (CONSOLE_ERROR_ALLOWLIST.some((s) => text.includes(s))) return;
    errors.push(text);
  });
  page.on('pageerror', (err) => errors.push(String(err)));
  // App-Boot abwarten: init() haengt Handler an .nav-item[data-tab];
  // state.karts existiert erst nach kart-registry-Init.
  await page.waitForSelector('.nav-item[data-tab]');
  // try/catch: waehrend des Script-Boots kann das lexikalische state-
  // Binding kurz in der TDZ sein -> als "noch nicht bereit" werten.
  await page.waitForFunction(() => {
    try { return typeof state === 'object' && !!state.karts; }
    catch (_) { return false; }
  });
  return { app, page, errors, userData };
}

async function closeApp(app, userData) {
  try { await app.close(); } catch (_) { /* Fenster ggf. schon zu */ }
  try { fs.rmSync(userData, { recursive: true, force: true }); } catch (_) { /* best effort */ }
}

module.exports = { launchApp, closeApp, CONSOLE_ERROR_ALLOWLIST };
```

`e2e/app.spec.js` (neu, zunächst nur der Start-Test):

```js
'use strict';
// Smoke: App-Start + Tab-Rendering (Phase 41, Spec-Punkte 1+2).
const { test, expect } = require('@playwright/test');
const { launchApp, closeApp } = require('./helpers');

let app, page, errors, userData;

test.beforeEach(async () => {
  ({ app, page, errors, userData } = await launchApp());
});

test.afterEach(async () => {
  await closeApp(app, userData);
});

test('App startet ohne Konsolen-Fehler', async () => {
  await expect(page).toHaveTitle(/RasiCross/i);
  await expect(page.locator('#tab-live')).toBeVisible();
  // 2 s Leerlauf: 1-Hz-Loop + Init-Renderer laufen mindestens einmal durch.
  await page.waitForTimeout(2000);
  expect(errors).toEqual([]);
});
```

- [ ] **Step 3: Test laufen lassen — muss fehlschlagen (Playwright fehlt noch)**

Run: `npx playwright test 2>&1 | Select-Object -Last 5`
Expected: Fehler — `@playwright/test` nicht installiert (`Cannot find module`) bzw. npx-Prompt abgelehnt.

- [ ] **Step 4: Playwright installieren + npm-Script**

Run: `npm install --save-dev @playwright/test`
Expected: package.json/package-lock.json aktualisiert, exit 0. KEIN `npx playwright install` (Electron braucht keine Playwright-Browser).

Dann in `package.json` das Script ergänzen — Anker (frisch lesen, CRLF):

```json
    "test": "node --test",
```

wird zu:

```json
    "test": "node --test",
    "test:e2e": "playwright test",
```

- [ ] **Step 5: main.js-Hook einfügen**

Anker in `main.js` (Zeilen 16–21 frisch lesen):

```js
let autoUpdater = null;
try {
  ({ autoUpdater } = require("electron-updater"));
} catch(e) {
  console.error("electron-updater not available:", e.message);
}
```

Direkt DANACH einfügen:

```js

// Test-Isolation (Phase 41): Die Playwright-Smoke-Suite setzt
// RASI_TEST_USERDATA auf ein Wegwerf-Verzeichnis, damit localStorage,
// Tile-Cache und Crash-Aufnahme echte Nutzerdaten nie beruehren.
// Muss vor app.whenReady() laufen.
if (process.env.RASI_TEST_USERDATA) {
  app.setPath("userData", process.env.RASI_TEST_USERDATA);
}
```

- [ ] **Step 6: ESLint-Block + .gitignore**

`eslint.config.js` — Anker: der Block `// Electron-Hauptprozess + Preload (Node, CommonJS)` (Zeilen 144–153, frisch lesen). Direkt NACH dessen schließendem `},` einfügen:

```js

  // Playwright-Smoke-Suite (Phase 41) -- Node/CommonJS; die evaluate-
  // Callbacks laufen im Renderer und referenzieren App-Globals.
  {
    files: ['e2e/**/*.js', 'playwright.config.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: {
        ...globals.node, ...globals.browser,
        state: 'readonly', activeKart: 'readonly', activeRace: 'readonly',
        toggleRaceRun: 'readonly', endRace: 'readonly',
        buildRaceDataForKart: 'readonly', RasiReplay: 'readonly',
        enterReplay: 'readonly', exitReplay: 'readonly',
      },
    },
    rules: bugRules,
  },
```

`.gitignore` — am Ende ergänzen:

```
# Playwright-Smoke (Phase 41)
test-results/
playwright-report/
```

- [ ] **Step 7: Test laufen lassen — muss bestehen**

Run: `npx playwright test e2e/app.spec.js 2>&1 | Select-Object -Last 8`
Expected: `1 passed`. Falls Konsolen-Fehler auftauchen: Ursache ansehen — echte Boot-Fehler fixen gehört NICHT in diese Phase; nur nachweislich harmlose Meldungen (mit Begründung im Commit-Body) in `CONSOLE_ERROR_ALLOWLIST` aufnehmen.

- [ ] **Step 8: Regressionen prüfen + Commit**

Run: `npm test 2>&1 | Select-Object -Last 8` → `pass 177`, `fail 0`.
Run: `npm run lint` → exit 0.

```bash
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" add playwright.config.js e2e/helpers.js e2e/app.spec.js main.js package.json package-lock.json eslint.config.js .gitignore
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" commit -m "test(e2e): Playwright-Smoke-Infrastruktur + App-Start-Test"
```

(Commit-Body + Pflicht-Trailer wie in den Conventions.)

---

### Task 2: Smoke „alle Tabs rendern"

**Files:**
- Modify: `e2e/app.spec.js` (Test ergänzen)

**Interfaces:**
- Consumes: `launchApp()`/`closeApp()` aus Task 1; Tab-Leiste `.nav-item[data-tab]` (RasiCross_Telemetry.html:2429–2457), Sektionen `#tab-<name>` mit Klasse `active` (rasicross.js:350–356 setzt beim Klick `active` + `body[data-tab]`).
- Produces: nichts Neues für spätere Tasks.

- [ ] **Step 1: Failing test schreiben** — in `e2e/app.spec.js` unter dem Start-Test ergänzen:

```js
const TABS = ['live', 'detail', 'races', 'drivers', 'track', 'connection', 'settings'];

test('alle Tabs rendern', async () => {
  for (const tab of TABS) {
    await page.click(`.nav-item[data-tab="${tab}"]`);
    const section = page.locator(`#tab-${tab}`);
    await expect(section).toHaveClass(/active/);
    await expect(section).toBeVisible();
    // Sektion hat Inhalt (tab-settings wird von settings.js zur Laufzeit
    // befuellt -> ueber waitForFunction statt Sofort-Assert).
    await page.waitForFunction(
      (id) => {
        const el = document.getElementById(id);
        return !!el && el.innerHTML.trim().length > 0;
      },
      `tab-${tab}`
    );
  }
  expect(errors).toEqual([]);
});
```

- [ ] **Step 2: Verifizieren, dass der Test das Richtige prüft**

Run: `npx playwright test e2e/app.spec.js 2>&1 | Select-Object -Last 8`
Expected: `2 passed`. (Kein „echtes" Rot möglich — der App-Code existiert schon; das Netz wird für die Phasen 42–44 gespannt. Schlägt er fehl, ist ein Selektor im Test falsch → Test fixen, nicht die App.)

- [ ] **Step 3: Commit**

```bash
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" add e2e/app.spec.js
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" commit -m "test(e2e): Smoke fuer Tab-Rendering aller 7 Tabs"
```

---

### Task 3: Smoke „Demo-Modus erzeugt 3 Karts mit laufenden Rundenzeiten"

**Files:**
- Create: `e2e/demo.spec.js`

**Interfaces:**
- Consumes: `launchApp()`/`closeApp()`; `#demoStartBtn` im Verbindungs-Tab (serial-demo.js:202 blendet ihn um); Demo-MACs `DE:MO:RA:SI:00:01..03` (serial-demo.js:171–175, `DEMO_KART_DEFS`); Kart-Buckets `state.karts.has/get(mac)` mit Feld `lapStart` (gesetzt beim ersten Gate-Durchgang); Liveness über `state.demo.karts[i].seq` (serial-demo.js:293, zählt pro 80-ms-Tick).
- Produces: das `beforeEach`-Muster „Demo starten" (Connection-Tab → `#demoStartBtn` → `state.demo.running`), das Task 4 im selben File wiederverwendet.

- [ ] **Step 1: Failing test schreiben** — `e2e/demo.spec.js` (neu):

```js
'use strict';
// Smoke: Demo-Modus mit 3 Karts, Rennen-Steuerung und
// buildRaceDataForKart-Payloads (Phase 41, Spec-Punkte 3-5).
const { test, expect } = require('@playwright/test');
const { launchApp, closeApp } = require('./helpers');

const DEMO_MACS = ['DE:MO:RA:SI:00:01', 'DE:MO:RA:SI:00:02', 'DE:MO:RA:SI:00:03'];

let app, page, errors, userData;

test.beforeEach(async () => {
  ({ app, page, errors, userData } = await launchApp());
  // Demo starten: Button liegt im Verbindungs-Tab.
  await page.click('.nav-item[data-tab="connection"]');
  await page.click('#modeDemoBtn'); // Demo-Panel einblenden (rasicross.js:1223)
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
```

- [ ] **Step 2: Test laufen lassen**

Run: `npx playwright test e2e/demo.spec.js 2>&1 | Select-Object -Last 8`
Expected: `1 passed` (Laufzeit bis ~60 s — die Gate-Durchgänge brauchen Echtzeit).

- [ ] **Step 3: Commit**

```bash
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" add e2e/demo.spec.js
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" commit -m "test(e2e): Smoke Demo-Modus mit 3 Karts und laufenden Rundenzeiten"
```

---

### Task 4: Smoke „Rennen starten/stoppen" + `buildRaceDataForKart`-Payloads

**Files:**
- Modify: `e2e/demo.spec.js` (zwei Tests ergänzen)

**Interfaces:**
- Consumes: Demo-`beforeEach` aus Task 3; `activeRace()` / `toggleRaceRun()` / `endRace(false)` (races.js — Statuswerte: `created`/`running`/`paused`/`finished`/`finished_auto`; startDemo legt automatisch ein laufendes Demo-Race an, serial-demo.js:216–234); `buildRaceDataForKart(mac)` (pit-wall.js:320–398 — Voll-Payload mit `type:'display'`, `driver`, `lap` (String), `lapn` (≥1), `sectors` (Array[3]), `page`, `running`, sobald Race läuft und Bucket+Teilnehmer-Slot existieren; alle 3 Demo-Karts werden vor `startRace()` registriert und sind damit Teilnehmer).
- Produces: nichts Neues für spätere Tasks.

- [ ] **Step 1: Failing tests schreiben** — in `e2e/demo.spec.js` ergänzen:

```js
test('Rennen pausieren, fortsetzen und beenden', async () => {
  // startDemo() hat automatisch ein Demo-Race angelegt und gestartet.
  await page.waitForFunction(() => {
    const r = activeRace();
    return !!r && r.status === 'running';
  });
  // Pausieren + Fortsetzen ueber dieselbe Funktion, die startRaceBtn bindet
  // (rasicross.js init: startRaceBtn.onclick = toggleRaceRun).
  await page.evaluate(() => toggleRaceRun());
  expect(await page.evaluate(() => activeRace().status)).toBe('paused');
  await page.evaluate(() => toggleRaceRun());
  expect(await page.evaluate(() => activeRace().status)).toBe('running');
  // Beenden (endRaceBtn.onclick = () => endRace(false))
  const raceId = await page.evaluate(() => activeRace().id);
  await page.evaluate(() => endRace(false));
  const status = await page.evaluate((id) => {
    const r = state.races.find((x) => x.id === id);
    return r ? r.status : 'gone';
  }, raceId);
  expect(status).toBe('finished');
  expect(errors).toEqual([]);
});

test('buildRaceDataForKart liefert pro Kart plausible Payloads', async () => {
  await page.waitForFunction(() => {
    const r = activeRace();
    return !!r && r.status === 'running';
  });
  const payloads = await page.evaluate(
    (macs) => macs.map((m) => buildRaceDataForKart(m)),
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
```

- [ ] **Step 2: Tests laufen lassen**

Run: `npx playwright test e2e/demo.spec.js 2>&1 | Select-Object -Last 8`
Expected: `3 passed`.

- [ ] **Step 3: Commit**

```bash
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" add e2e/demo.spec.js
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" commit -m "test(e2e): Smoke Rennen-Steuerung und buildRaceDataForKart-Payloads"
```

---

### Task 5: Smoke „Recording/Replay-Roundtrip"

**Files:**
- Create: `e2e/replay.spec.js`

**Interfaces:**
- Consumes: `launchApp()`/`closeApp()`; Demo-Start-Muster aus Task 3; `armRecording()`/`activeKart().recording.{armed,buf}` (rasicross.js:690–708; der Test armiert explizit nach dem Demo-Start — **Fund Phase 41:** der `recordAutoArm`-Pfad in `startDemo()` (serial-demo.js:181) armiert den VOR dem Demo aktiven Bucket, weil `setActive(Demo-Kart 1)` erst danach kommt (serial-demo.js:199) → seit Phase 39 zeichnen Demo-Karts per Auto-Arm nichts auf; Fix separat außerhalb dieser Phase); `RasiReplay.serializeRecording(buf, meta)` / `RasiReplay.parseRecording(text)` (replay.js:16/39, REC_VERSION 9.6); `enterReplay(parsed)` (recording.js:265 — beendet den Demo-Modus selbst, braucht ≥2 Pakete), `state.replay.{active,virtualMs}`, `exitReplay()` (recording.js:350).
- Produces: nichts Neues für spätere Tasks.

- [ ] **Step 1: Failing test schreiben** — `e2e/replay.spec.js` (neu):

```js
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
  await page.click('#modeDemoBtn'); // Demo-Panel einblenden (rasicross.js:1223)
  await page.click('#demoStartBtn');
  await page.waitForFunction(() => state.demo.running === true);
  // Explizit armieren, NACHDEM startDemo() den aktiven Kart auf Demo-Kart 1
  // gesetzt hat. (Fund Phase 41: der recordAutoArm-Pfad in startDemo armiert
  // den VOR dem Demo aktiven Bucket -- seit Phase 39 zeichnen Demo-Karts
  // darum nichts auf; separater Fix ausserhalb dieser Test-Phase.)
  await page.evaluate(() => armRecording());
  // ~12 Hz Demo-Pakete: nach wenigen Sekunden liegen >= 20 im Buffer
  await page.waitForFunction(
    () => activeKart().recording.armed === true
      && activeKart().recording.buf.length >= 20,
    null,
    { timeout: 30000 }
  );
  // Roundtrip im Renderer: Buffer VOR stopDemo sichern (stopDemo/
  // enterReplay raeumen die Demo-Buckets weg).
  const result = await page.evaluate(() => {
    const buf = activeKart().recording.buf.slice();
    const text = RasiReplay.serializeRecording(buf, { created: new Date().toISOString() });
    const parsed = RasiReplay.parseRecording(text);
    if (!parsed.ok) return { ok: false, error: parsed.error };
    enterReplay(parsed); // beendet den Demo-Modus selbst
    return { ok: true, recorded: buf.length, replayed: parsed.packets.length };
  });
  expect(result.ok).toBe(true);
  expect(result.replayed).toBe(result.recorded);
  await page.waitForFunction(() => state.replay.active === true);
  // Replay spielt: virtuelle Zeit schreitet voran
  await page.waitForFunction(() => state.replay.virtualMs > 0, null, { timeout: 10000 });
  await page.evaluate(() => exitReplay());
  expect(await page.evaluate(() => state.replay.active)).toBe(false);
  expect(errors).toEqual([]);
});
```

- [ ] **Step 2: Test laufen lassen**

Run: `npx playwright test e2e/replay.spec.js 2>&1 | Select-Object -Last 8`
Expected: `1 passed`.

- [ ] **Step 3: Gesamte Suite lokal (Windows) — das lokale Gate**

Run: `npx playwright test 2>&1 | Select-Object -Last 10`
Expected: `6 passed` (app 2 + demo 3 + replay 1), 0 failed.

- [ ] **Step 4: Commit**

```bash
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" add e2e/replay.spec.js
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" commit -m "test(e2e): Smoke Recording-Replay-Roundtrip"
```

---

### Task 6: CI-Job, finale Verifikation, Plan-Doc

**Files:**
- Modify: `.github/workflows/check.yml` (neuer Job `smoke`)
- Commit: `docs/superpowers/plans/2026-07-06-41-playwright-smoke.md`

**Interfaces:**
- Consumes: die komplette Suite aus Tasks 1–5; `check.yml`-Jobs `js`/`python` (bleiben unverändert — insbesondere behält `js` sein `ELECTRON_SKIP_BINARY_DOWNLOAD: '1'`; der neue Job braucht das Binary und setzt es NICHT).
- Produces: CI-Gate der Phase 41 (Spec: „Smoke-Suite läuft in CI und lokal unter Windows").

- [ ] **Step 1: `smoke`-Job ergänzen** — `check.yml` frisch lesen; am Dateiende (nach dem kompletten `python`-Job) anhängen:

```yaml

  smoke:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
      - name: Install dependencies
        run: npm ci
      - name: Playwright-Smoke (Electron unter Xvfb)
        run: xvfb-run --auto-servernum -- npx playwright test
      - name: Testartefakte bei Fehlschlag
        if: failure()
        uses: actions/upload-artifact@v4
        with:
          name: playwright-results
          path: test-results/
          if-no-files-found: ignore
```

- [ ] **Step 2: YAML-Syntax prüfen**

Run: `python -c "import yaml,io; yaml.safe_load(io.open('.github/workflows/check.yml', encoding='utf-8')); print('YAML OK')"`
Expected: `YAML OK` (falls PyYAML fehlt: `npx --yes yaml-lint .github/workflows/check.yml` oder visuelle Prüfung der Einrückung gegen die bestehenden Jobs).

- [ ] **Step 3: Finale Verifikation (komplettes Rezept)**

- `npm test 2>&1 | Select-Object -Last 8` → `pass 177`, `fail 0`
- `npm run lint` → exit 0
- `npx playwright test 2>&1 | Select-Object -Last 10` → alle Smoke-Tests grün, 0 failed
- `node --check main.js` → exit 0 (einzige App-Code-Änderung)
- `python -m py_compile sender.py bridge.py esp_libs/calc.py esp_libs/frame.py` → exit 0 (unverändert, Regressionscheck)
- `python -m unittest discover -s test -p "test_*.py"` → `OK`
- `__pycache__` löschen, dann `git status` → nur beabsichtigte Dateien; `.claude/`, `CLAUDE.md`, `graphify-out/` bleiben untracked.

- [ ] **Step 4: Commits (CI + Plan-Doc)**

```bash
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" add .github/workflows/check.yml
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" commit -m "ci: Playwright-Smoke-Job (Electron unter Xvfb) in check.yml"
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" add docs/superpowers/plans/2026-07-06-41-playwright-smoke.md
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" commit -m "docs(plan): Phase 41 Playwright-Smoke Implementierungsplan"
```

- [ ] **Step 5: `graphify update .`** (Graph aktuell halten, AST-only) und Branch pushen; PR gegen `main` per `gh pr create` (Body mit Phase-41-Gate-Nachweis + Pflicht-Fußzeile). **CI-Bestätigung des `smoke`-Jobs ist Teil des Gates** — Merge erst nach grünem GitHub-Actions-Lauf (Bestätigung liegt beim User).

---

## Hardware/Manual Acceptance Checklist

Phase 41 berührt keine ESP-Hardware. Manuell durch den User:

- [ ] GitHub Actions: `check`-Workflow inkl. neuem `smoke`-Job grün auf dem PR.
- [ ] Lokal Windows: `npm run test:e2e` läuft durch (Electron-Fenster öffnen sich sichtbar — erwartet, kein Headless unter Windows).
- [ ] Normale App-Nutzung unverändert: `npm start` startet wie bisher; echte Nutzerdaten (localStorage) unangetastet (Tests liefen nur gegen Wegwerf-userData).

## Self-Review

- **Spec-Coverage (Phase-41-Bullets):** App startet ohne Konsolen-Fehler → Task 1; alle Tabs rendern → Task 2; Demo erzeugt 3 Karts mit laufenden Rundenzeiten → Task 3; Rennen starten/stoppen → Task 4; `buildRaceDataForKart` pro Kart plausibel → Task 4; Recording/Replay-Roundtrip → Task 5; Gate CI+Windows → Tasks 5 (lokal) + 6 (CI). „Pit-Wall-E2E-Treiber umziehen": der alte CDP-Treiber existiert nicht mehr (Temp-Verzeichnis leer) → Suite wird neu aufgebaut, im Plan als Locked Decision dokumentiert.
- **Platzhalter-Scan:** keine TBD/TODO; jeder Code-Step enthält vollständigen Code; Kommandos mit erwartetem Output.
- **Typ-/Namens-Konsistenz:** `launchApp/closeApp`-Signaturen in allen Specs identisch; `DEMO_MACS` konsistent mit `DEMO_KART_DEFS` (serial-demo.js:171–175); Statuswerte `paused/running/finished` gegen races.js verifiziert; `activeKart().recording.buf` gegen rasicross.js:690–708 verifiziert.

## Phase Map

- Phasen 22/23: rasicross.js-Split — merged.
- Phase 40: per-Kart-OLED-Routing — merged (PR #62); Hardware-Abnahme offen.
- **Phase 41 (dieser Plan): Test-Sicherheitsnetz (Playwright-Smoke).** Sichert die Phasen 42–45 ab.
- Phase 42: Vite + ESM-Migration (nutzt diese Suite als Gate).
- Phase 43: State-Redesign (`activeKart()`-Selektor statt Fassade) + gezielter Kart-Wechsel-Test.
- Phase 44: rasicross.js-Zerlegung.
- Phase 45: Firmware-Modularisierung (unabhängig, Hardware-Gate).
