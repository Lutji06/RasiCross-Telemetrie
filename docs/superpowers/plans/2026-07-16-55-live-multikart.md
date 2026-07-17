# Phase 55: Live-Tab Multi-Kart — Implementierungsplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Der Live-Tab zeigt bei ≥2 Karts standardmäßig die Kart-Übersicht; jede ko-Karte zeigt Speed und RPM groß nebeneinander (RPM rot ab Warnschwelle); eine persistierte Einstellung „Live-Start-Ansicht" (Automatisch/Einzel/Übersicht) steuert das, manuelle Umschaltung gewinnt pro Sitzung.

**Architecture:** Purer, unit-getesteter Reducer in neuem Modul `src/live-view.js` (Muster `gViewReducer`/`settingsNavReducer`); Verdrahtung im bestehenden Render-Pfad von `live-ui.js` (beide UI-Loops); `setLiveView` bekommt einen `manual`-Parameter, den nur echte UI-Klicks setzen. RPM kommt aus `k.telemetry.rpm` (bereits pro Kart vorhanden), keine neuen Datenpfade.

**Tech Stack:** Vanilla ESM + node:test (Unit), Playwright toHaveScreenshot (Baselines 13 → 14), bestehendes CSS-Gate (Hex + Phase-50-Skalen).

**Spec:** `docs/superpowers/specs/2026-07-16-55-live-multikart-design.md` (Branch `docs/spec-55-live-multikart`, Commit 1098bfd; wird in Task 0 in den Phase-Branch gemergt). Locked Decisions dort; eine dokumentierte Abweichung: `SETTINGS_INDEX.rowId` ist per Repo-Konvention die **Control-Element-ID** (vgl. `setRpmWarn`), also `setLiveStartView` — die Spec nannte `rowLiveStartView`.

## Global Constraints

- **Voraussetzung:** PR #77 (Phase 50) ist in main gemergt — die neuen CSS-Klassen müssen das Skalen-Gate passieren, das erst mit Phase 50 existiert.
- Alle Repo-Dateien sind **CRLF**: Vor jedem Edit die Zielregion frisch Read-en, Anker aus dem frischen Read; NIEMALS sed/awk. Verifikation mit dem Grep-Tool.
- Nie `git add` auf `.claude/`, `graphify-out/`, `CLAUDE.md`, `docs/superpowers/` — Ausnahme: Plan-Doc-Commit im letzten Task (die Spec kommt per Branch-Merge in Task 0).
- Lokale Gates pro Task: `npm test` (Ziel 210 nach Task 1), `npm run lint` (0), `npm run lint:css` (OK — Hex- UND Skalen-Gate), `npm run test:e2e` (lokal: 13 passed + N skipped; ab Task 5: 13 passed + 14 skipped). CI-Warten immer mit Run-ID (`$run = gh run list --branch feat/phase-55-live-multikart --limit 1 --json databaseId --jq '.[0].databaseId'`, dann `gh run watch $run --exit-status`).
- Neue CSS-Werte nur auf den Phase-50-Skalen (`--sp-*`, `--fs-*` für ≤20px; >20px roh erlaubt) und ohne rohe Hex-Farben (`var(--red)` statt `#…`).
- Jeder sichtbare Screenshot-Diff ist freigabepflichtig (Pass-Verfahren unten); Masken-/Harness-Änderungen und Baseline-Stände müssen zusammenpassen (Lektion Phase 49).
- Commit-Trailer (Leerzeile davor): `Co-Authored-By:` + `Claude-Session:` der laufenden Session.
- Progress-Ledger `.superpowers/sdd/progress.md` (Abschnitt Phase 55 anlegen) nach jedem Task fortschreiben.
- PowerShell 5.1: keine `&&`, keine Anführungszeichen in Commit-Messages (Here-Strings nutzen).

## Working Directory & Conventions

- Branch: `feat/phase-55-live-multikart` ab `main` (nach Merge PR #77), siehe Task 0.
- Reports nach `.superpowers/sdd/task-<N>-report.md` (Phase-55-Header, bestehende Dateien gleichen Namens werden überschrieben — etabliertes Muster seit Phase 50).

---

## Pass-Verfahren Screenshots (gilt für Task 5; „der Loop")

1. Edits + lokale Gates grün (screens lokal geskippt).
2. Commit + Push (nur Task-Dateien). CI-smoke wird planmäßig ROT (beabsichtigte Diffs bzw. fehlende neue Baseline); js/python müssen grün sein — sonst STOPP + Analyse.
3. `gh run download $run -n playwright-results -D .superpowers/phase55/task5`; die `*-diff.png`/`*-actual.png` sichten. **STOP — Controller legt die Diff-Bilder dem User vor (SendUserFile) und holt die Freigabe ein (AskUserQuestion: freigeben / nacharbeiten).** Kein Weiterarbeiten ohne Antwort.
4. Nach Freigabe: die `*-actual.png` der geänderten/neuen Tests als `e2e/screens.spec.js-snapshots/<name>-linux.png` committen (`test(e2e): Baselines nach Phase 55 Task 5 neu eingefroren -- vom User freigegeben`), push, CI grün abwarten. Bei Nacharbeit: Änderungen im selben Task, zurück zu Schritt 1.

---

### Task 0: Branch-Setup

- [ ] **Step 1:** Prüfen, dass PR #77 gemergt ist: `gh pr view 77 --json state --jq .state` → `MERGED`. Falls nicht: STOPP, User fragen.
- [ ] **Step 2:**

```powershell
git fetch origin
git switch main
git pull
git switch -c feat/phase-55-live-multikart
git merge origin/docs/spec-55-live-multikart
```

Erwartung: Merge bringt genau 1 Commit (1098bfd, die Spec). `git log --oneline -3` zeigt Spec-Commit + main-HEAD.
- [ ] **Step 3:** Push mit Upstream: `git push -u origin feat/phase-55-live-multikart`. Baseline-Kontrolle: `npm test` → 201, `npm run lint` → 0, `npm run lint:css` → OK.

---

### Task 1: Purer Reducer `src/live-view.js` (TDD)

**Files:**
- Create: `src/live-view.js`
- Test: `test/live-view.test.js`

**Interfaces:**
- Produces: `liveViewAutoReducer({ view, prevCount, count, setting, manual })` → `'single' | 'overview' | null` (null = keine Änderung); `START_MODES` = frozen `['auto','single','overview']`. Default-Export-Objekt `{ liveViewAutoReducer, START_MODES }`. Tasks 2/3 importieren `RasiLiveView` default.

- [ ] **Step 1: Failing Test schreiben** — `test/live-view.test.js` komplett anlegen:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import LV from '../src/live-view.js';

const R = (o) => LV.liveViewAutoReducer(o);

test('exports the pure api', () => {
  assert.equal(typeof LV.liveViewAutoReducer, 'function');
  assert.ok(Object.isFrozen(LV.START_MODES));
  assert.deepEqual([...LV.START_MODES], ['auto', 'single', 'overview']);
});

test('Zwangs-Rueckfall: count<=1 in overview -> single, in single -> null (auch bei manual)', () => {
  assert.equal(R({ view: 'overview', prevCount: 2, count: 1, setting: 'auto', manual: false }), 'single');
  assert.equal(R({ view: 'overview', prevCount: 2, count: 0, setting: 'overview', manual: true }), 'single');
  assert.equal(R({ view: 'single', prevCount: 0, count: 1, setting: 'auto', manual: false }), null);
});

test('auto: Flanke <2 -> >=2 schaltet auf overview', () => {
  assert.equal(R({ view: 'single', prevCount: 1, count: 2, setting: 'auto', manual: false }), 'overview');
  assert.equal(R({ view: 'single', prevCount: 0, count: 3, setting: 'auto', manual: false }), 'overview');
});

test('auto: ohne Flanke keine Aenderung (2->3, 3->3, bereits overview)', () => {
  assert.equal(R({ view: 'single', prevCount: 2, count: 3, setting: 'auto', manual: false }), null);
  assert.equal(R({ view: 'single', prevCount: 3, count: 3, setting: 'auto', manual: false }), null);
  assert.equal(R({ view: 'overview', prevCount: 1, count: 2, setting: 'auto', manual: false }), null);
});

test('manual gewinnt: keine Automatik trotz Flanke/Pegel', () => {
  assert.equal(R({ view: 'single', prevCount: 1, count: 2, setting: 'auto', manual: true }), null);
  assert.equal(R({ view: 'single', prevCount: 2, count: 3, setting: 'overview', manual: true }), null);
});

test('single: nie automatisch', () => {
  assert.equal(R({ view: 'single', prevCount: 1, count: 2, setting: 'single', manual: false }), null);
  assert.equal(R({ view: 'single', prevCount: 0, count: 5, setting: 'single', manual: false }), null);
});

test('overview: pegel-getriggert — schaltet auch ohne Flanke aus single', () => {
  assert.equal(R({ view: 'single', prevCount: 2, count: 3, setting: 'overview', manual: false }), 'overview');
  assert.equal(R({ view: 'single', prevCount: 3, count: 3, setting: 'overview', manual: false }), 'overview');
});

test('overview: bereits overview -> null', () => {
  assert.equal(R({ view: 'overview', prevCount: 2, count: 3, setting: 'overview', manual: false }), null);
});

test('Junk-Eingaben werfen nie: ungueltiges setting -> auto-Semantik, ungueltige view/counts -> Defaults', () => {
  assert.equal(R({ view: 'single', prevCount: 1, count: 2, setting: 'kaputt', manual: false }), 'overview');
  assert.equal(R({ view: null, prevCount: NaN, count: 2, setting: 'auto', manual: false }), 'overview');
  assert.equal(R({ view: 'single', prevCount: 'x', count: 'y', setting: 'auto', manual: false }), null);
  assert.equal(R({}), null);
});
```

- [ ] **Step 2: Fail verifizieren** — `npm test` → Fehler `Cannot find module ... live-view.js` (bzw. ERR_MODULE_NOT_FOUND).
- [ ] **Step 3: Implementieren** — `src/live-view.js` komplett anlegen:

```js
'use strict';
/*!
 * live-view.js — pure Logik fuer die Live-Tab-Start-Ansicht (Phase 55):
 *   - liveViewAutoReducer: entscheidet, ob die Automatik zwischen
 *     'single' und 'overview' umschaltet (Muster wie gViewReducer).
 * Reines Modul — kein DOM, keine Seiteneffekte, wirft nie.
 */

const VIEWS = Object.freeze(['single', 'overview']);
const START_MODES = Object.freeze(['auto', 'single', 'overview']);

// Regeln (Spec 2026-07-16, Prioritaet absteigend):
//  1. count<=1: overview -> 'single' (Zwangs-Rueckfall), sonst null
//  2. manual: null (Hand-Wahl gewinnt fuer die Sitzung)
//  3. setting 'single': null (nie automatisch)
//  4. setting 'auto': nur auf der Flanke prevCount<2<=count -> 'overview'
//  5. setting 'overview': pegel-getriggert — count>=2 und single -> 'overview'
function liveViewAutoReducer(a) {
  const o = a || {};
  const view = VIEWS.includes(o.view) ? o.view : 'single';
  const setting = START_MODES.includes(o.setting) ? o.setting : 'auto';
  const count = (typeof o.count === 'number' && isFinite(o.count)) ? o.count : 0;
  const prev = (typeof o.prevCount === 'number' && isFinite(o.prevCount)) ? o.prevCount : 0;
  if (count <= 1) return view === 'overview' ? 'single' : null;
  if (o.manual === true) return null;
  if (setting === 'single') return null;
  if (setting === 'auto') return (prev < 2 && view === 'single') ? 'overview' : null;
  return view === 'single' ? 'overview' : null;
}

export default { liveViewAutoReducer, START_MODES };
```

  (Regel 4 braucht keinen `count >= 2`-Vergleich mehr — `count <= 1` ist durch Regel 1 bereits raus.)
- [ ] **Step 4: Pass verifizieren** — `npm test` → **210** pass, 0 fail. `npm run lint` → 0.
- [ ] **Step 5: Commit**

```powershell
git add src/live-view.js test/live-view.test.js
git commit  # Message: feat(live): liveViewAutoReducer -- pure Start-Ansicht-Logik (Phase 55 Task 1) + Trailer
git push
```

---

### Task 2: Einstellung `liveStartView` (Default, Index, Markup, Load/Save)

**Files:**
- Modify: `src/store.js` (settings-Literal, Z. ~30), `src/settings.js` (SETTINGS_INDEX), `index.html` (Dashboard-Gruppe, nach der Mindest-Rundenzeit-Zeile ~Z. 1018–1021), `src/settings-ui.js` (loadSettingsToUi ~Z. 98, saveSettingsFromUi ~Z. 133)

**Interfaces:**
- Consumes: `RasiLiveView.START_MODES` aus Task 1 (`import RasiLiveView from './live-view.js';`).
- Produces: `state.settings.liveStartView ∈ START_MODES` (Default `'auto'`), Control `#setLiveStartView` (select, data-autosave), Index-Eintrag rowId `setLiveStartView`. Task 3 liest `state.settings.liveStartView`.

- [ ] **Step 1: store.js** — im settings-Literal (frisch Read-en) direkt hinter `oledPage: 'auto', ` einfügen: `liveStartView: 'auto', `. (Persistenz-Merge `Object.assign(state.settings, d.settings)` in store.js:229 macht den Key migrationsfrei.)
- [ ] **Step 2: settings.js** — im `SETTINGS_INDEX` hinter der `setMinLap`-Zeile einfügen:

```js
    { group: 'dashboard', rowId: 'setLiveStartView',  label: 'Live-Start-Ansicht',   keywords: ['live', 'uebersicht', 'overview', 'multi', 'kart', 'start', 'ansicht'] },
```

- [ ] **Step 3: index.html** — hinter der Mindest-Rundenzeit-`settings-row` (vor `<p id="settingsHint"…`) einfügen (Muster = G-Skala-Zeile):

```html
        <div class="settings-row">
          <div class="settings-row-label"><span class="settings-row-name">Live-Start-Ansicht</span><span class="settings-row-desc">Ansicht des Live-Tabs bei mehreren Karts</span></div>
          <select id="setLiveStartView" data-autosave><option value="auto" selected>Automatisch</option><option value="single">Einzel</option><option value="overview">Übersicht</option></select>
        </div>
```

- [ ] **Step 4: settings-ui.js** — Import ergänzen (bestehender Import-Block, frisch Read-en): `import RasiLiveView from './live-view.js';`. In `loadSettingsToUi()` hinter der `setMinLap`-Zeile:

```js
  if ($('setLiveStartView')) $('setLiveStartView').value =
    RasiLiveView.START_MODES.includes(state.settings.liveStartView) ? state.settings.liveStartView : 'auto';
```

  In `saveSettingsFromUi()` hinter der `minLapSeconds`-Zeile:

```js
  const _lsv = $('setLiveStartView') ? $('setLiveStartView').value : 'auto';
  state.settings.liveStartView = RasiLiveView.START_MODES.includes(_lsv) ? _lsv : 'auto';
```

- [ ] **Step 5: Gates** — `npm test` (210; settings.test.js validiert den neuen Index-Eintrag automatisch: Gruppe gültig, eingefroren, nicht Kart-spezifisch), `npm run lint` (0), `npm run lint:css` (OK). `npm run test:e2e` lokal (13 passed + 13 skipped — der `tab-settings`-Screenshot läuft nur in CI; sein Diff wird in Task 5 mit eingefroren).
- [ ] **Step 6: Commit** — `git add src/store.js src/settings.js index.html src/settings-ui.js`; Message: `feat(settings): Live-Start-Ansicht auto/single/overview (Phase 55 Task 2)` + Trailer; push. **CI wird ROT** (tab-settings/dialog-Shots diffen durch die neue Zeile) — das ist ab hier der erwartete Zustand bis zum Baseline-Freeze in Task 5; js/python müssen grün sein (prüfen per Run-ID!).

---

### Task 3: Automatik verdrahten (`live-ui.js`, `kart-bar.js`, `kart-overview.js`)

**Files:**
- Modify: `src/live-ui.js` (Import-Block; `setLiveView` ~Z. 467; neue Module-Locals + `autoLiveView()` vor `refreshOverview` ~Z. 531; beide Loops ~Z. 542 + ~Z. 558; ls-item-Klick ~Z. 522), `src/kart-bar.js` (~Z. 33 + ~Z. 60), `src/kart-overview.js` (~Z. 131)

**Interfaces:**
- Consumes: `RasiLiveView.liveViewAutoReducer` (Task 1), `state.settings.liveStartView` (Task 2).
- Produces: `setLiveView(mode, manual)` — zweiter Parameter optional, nur UI-Klicks übergeben `true`. `autoLiveView()` modul-intern (kein Export).

- [ ] **Step 1: live-ui.js Import** — im bestehenden Import-Block (frisch Read-en) ergänzen: `import RasiLiveView from './live-view.js';`
- [ ] **Step 2: setLiveView erweitern** — Signatur + Flag (Funktionskopf frisch Read-en, Anker `function setLiveView(mode) {`):

```js
function setLiveView(mode, manual) {
  if (mode === 'overview' && state.karts.macs().length <= 1) mode = 'single';
  // Phase 55: Hand-Wahl pausiert die Start-Automatik fuer die Sitzung.
  if (manual === true) _liveViewManual = true;
  state.liveView = mode;
```

  (Rest der Funktion unverändert.)
- [ ] **Step 3: Automatik einbauen** — direkt VOR `function refreshOverview() {` einfügen:

```js
// Phase 55: Start-Automatik der Live-Ansicht. Session-Zustand: Hand-Wahl-Flag
// (Reset, sobald die Kartzahl unter 2 faellt) + letzte Kartzahl fuer die
// auto-Flanke. Entscheidung ist pur in live-view.js (unit-getestet).
let _liveViewManual = false;
let _prevKartCount = 0;
function autoLiveView() {
  const count = state.karts.macs().length;
  if (count < 2) _liveViewManual = false;
  const next = RasiLiveView.liveViewAutoReducer({
    view: state.liveView, prevCount: _prevKartCount, count,
    setting: state.settings.liveStartView, manual: _liveViewManual,
  });
  _prevKartCount = count;
  if (next && next !== state.liveView) setLiveView(next);
}
```

  Hinweis: `_liveViewManual` wird in `setLiveView` (weiter oben in der Datei) referenziert — `let`-Deklarationen laufen beim Modul-Load, vor jedem Aufruf (kein TDZ-Problem). Falls `npm run lint` dennoch no-use-before-define meldet: die beiden `let`-Zeilen VOR `function setLiveView` verschieben und im Report vermerken.
- [ ] **Step 4: Loops** — in BEIDEN Loops `autoLiveView();` unmittelbar vor `refreshOverview()` einfügen (200-ms-Backup-Tick, Anker `updatePitWall(); refreshOverview();` → `updatePitWall(); autoLiveView(); refreshOverview();`; 1-Hz-Loop, Anker-Zeile `refreshOverview();` mit Kommentar darüber → `autoLiveView();` in eigener Zeile davor).
- [ ] **Step 5: manual-Flag an den drei UI-Klickstellen** — jeweils frisch Read-en:
  - `src/live-ui.js` ls-item-Klick (~Z. 522): `setLiveView('single');` → `setLiveView('single', true);`
  - `src/kart-bar.js` Übersicht-Button (~Z. 33): `ovBtn.onclick = () => { setLiveView('overview', true); };`
  - `src/kart-bar.js` Chip-Klick (~Z. 60): `setLiveView('single', true);`
  - `src/kart-overview.js` Karten-Klick (~Z. 131): `setLiveView('single', true);`
  Der Zwangs-Rückfall in `refreshOverview()` (Z. 533) bleibt bewusst OHNE `manual` (programmatisch).
- [ ] **Step 6: Gates** — `npm test` (210), `npm run lint` (0), `npm run test:e2e` lokal: demo.spec/karts.spec/app.spec müssen grün bleiben (13 passed + 13 skipped). Hinweis: karts.spec klickt Chips/Karten — falls ein Test auf `state.liveView` reagiert, Output analysieren, NICHT blind Baselines anfassen.
- [ ] **Step 7: Commit** — `git add src/live-ui.js src/kart-bar.js src/kart-overview.js`; Message: `feat(live): Start-Automatik ab 2 Karts -- Reducer verdrahtet, Hand-Wahl gewinnt (Phase 55 Task 3)` + Trailer; push; js/python grün (Run-ID), smoke weiter planmäßig rot.

---

### Task 4: RPM in der ko-Karte + CSS

**Files:**
- Modify: `src/kart-overview.js` (render, ~Z. 82 + ~Z. 118), `src/styles/pages/live-compact.css` (`.ko-speed`-Block ~Z. 77–78)

**Interfaces:**
- Consumes: `k.telemetry.rpm`, `state.settings.rpmWarning` (beide vorhanden).
- Produces: Markup `<div class="ko-big"><div class="ko-speed">…</div><div class="ko-rpm[ warn]">…</div></div>`; CSS-Klassen `.ko-big`, `.ko-rpm`, `.ko-rpm.warn`. Task 5 nutzt `#liveOverview .ko-card` als Klick-Ziel (unverändert).

- [ ] **Step 1: Werte berechnen** — in `render()` hinter `const speed = …` (frisch Read-en):

```js
      const rpm = Math.round(k.telemetry.rpm || 0);
      const rpmWarn = rpm >= (state.settings.rpmWarning || 9000);
```

- [ ] **Step 2: Markup** — die Zeile `+ '<div class="ko-speed">' + speed + '<small>km/h</small></div>'` ersetzen durch:

```js
        + '<div class="ko-big">'
        +   '<div class="ko-speed">' + speed + '<small>km/h</small></div>'
        +   '<div class="ko-rpm' + (rpmWarn ? ' warn' : '') + '">' + rpm + '<small>rpm</small></div>'
        + '</div>'
```

- [ ] **Step 3: CSS** — in `live-compact.css` (frisch Read-en) die `.ko-speed`-Zeile von `font-size:30px` auf `font-size:26px` ändern und direkt hinter der `.ko-speed small`-Zeile einfügen:

```css
.ko-card .ko-big{display:flex;align-items:baseline;justify-content:space-between;gap:var(--sp-10)}
.ko-card .ko-rpm{font-family:var(--mono);font-size:26px;font-weight:800;line-height:1;color:var(--tx)}
.ko-card .ko-rpm small{font-size:var(--fs-13);opacity:.6;font-weight:600;margin-left:3px}
.ko-card .ko-rpm.warn{color:var(--red)}
```

  (26px roh ist erlaubt: Skalen-Gate prüft nur font-size ≤ 20px; `margin-left:3px` spiegelt die bestehende `.ko-speed small`-Zeile.)
- [ ] **Step 4: Gates** — `npm run lint:css` (OK — beweist Skalen-/Hex-Konformität), `npm test` (210), `npm run lint` (0), `npm run test:e2e` lokal (13 passed + 13 skipped).
- [ ] **Step 5: Commit** — `git add src/kart-overview.js src/styles/pages/live-compact.css`; Message: `feat(live): RPM gross neben Speed in der Kart-Uebersicht, warn ab rpmWarning (Phase 55 Task 4)` + Trailer; push; js/python grün (Run-ID).

---

### Task 5: Screenshots — Masken, demo-live neu, Einzel-Shot, Freigabe-Loop

**Files:**
- Modify: `e2e/screens.spec.js` (DYN ~Z. 36; Demo-Block ~Z. 132–136)
- Baselines: `demo-live-linux.png` (neu eingefroren), `demo-live-single-linux.png` (neu), `tab-settings-linux.png`, `dialog-alert-linux.png`, `dialog-confirm-linux.png` (neu eingefroren — Settings-Zeile aus Task 2 ist deren Hintergrund)

**Interfaces:**
- Consumes: Auto-Übersicht (Task 3, Demo hat 3 Karts ⇒ `body[data-live-view] === 'overview'`), ko-Karten-Klick (Task 4-Markup).
- Produces: Baseline-Bestand 14 Shots; DYN enthält `'#liveOverview'`.

- [ ] **Step 1: Maske** — in `DYN` (frisch Read-en) `'#liveOverview'` ergänzen, mit Kommentar über dem Array-Eintrag:

```js
// #liveOverview wird KOMPLETT maskiert: die Demo faehrt ein Auto-Rennen,
// das Ranking kann die Karten zwischen den zwei Vergleichs-Frames umsortieren
// (Phase 55) -- Feld-Masken koennen Reihenfolge nicht ausgleichen. Getestet
// bleibt das Layout drumherum; die Einzel-Ansicht deckt demo-live-single ab.
```

  Neues DYN-Array-Ende: `'#packetsText', '.kc-live', '#liveOverview'];`
- [ ] **Step 2: demo-live-Test anpassen** — im Test `'Live-Tab mit Demo'` nach dem Tab-Klick auf die Übersicht warten:

```js
  test('Live-Tab mit Demo', async () => {
    await ctx.page.click('.nav-item[data-tab="live"]');
    // Phase 55: 3 Demo-Karts => Start-Automatik schaltet auf die Uebersicht.
    await ctx.page.waitForFunction(() => document.body.dataset.liveView === 'overview');
    await expect(ctx.page).toHaveScreenshot('demo-live.png',
      Object.assign({ mask: masks(ctx.page) }, SHOT));
  });
```

- [ ] **Step 3: Einzel-Ansicht-Test NEU** — direkt dahinter einfügen:

```js
  test('Live-Tab Einzel-Ansicht nach Karten-Klick', async () => {
    await ctx.page.click('.nav-item[data-tab="live"]');
    await ctx.page.waitForFunction(() => document.body.dataset.liveView === 'overview');
    // Karten-Klick = Hand-Wahl (manual): waehlt Kart 1, Einzel-Ansicht bleibt.
    await ctx.page.click('#liveOverview .ko-card:nth-child(1)');
    await ctx.page.waitForFunction(() => document.body.dataset.liveView === 'single');
    await expect(ctx.page).toHaveScreenshot('demo-live-single.png',
      Object.assign({ mask: masks(ctx.page) }, SHOT));
  });
```

- [ ] **Step 4: Lokal validieren** — `$env:RASI_SCREENS='1'; npm run test:e2e -- e2e/screens.spec.js --update-snapshots`, danach derselbe Lauf ohne `--update-snapshots`: 14 passed in Folge (Timeout 600000). `*-win32.png` bleiben untracked. Danach `Remove-Item Env:RASI_SCREENS`.
- [ ] **Step 5: Pass-Verfahren** (oben) durchlaufen. Commit Schritt 2: `git add e2e/screens.spec.js`; Message: `test(e2e): Demo-Uebersicht als Default-Shot + Einzel-Ansicht-Shot, #liveOverview maskiert (Phase 55 Task 5)` + Trailer. Erwartete CI-Diffs/Fails: `demo-live` (Übersicht statt Einzel), `demo-live-single` (Missing Snapshot), `tab-settings`, `dialog-alert`, `dialog-confirm` (neue Settings-Zeile im Hintergrund). Die übrigen 9 Shots MÜSSEN grün sein — sonst STOPP + Analyse. Freigabe → Freeze-Commit → CI komplett grün.

---

### Task 6: Volle Gates + Graph + Plan-Doc + Abschluss

- [ ] **Step 1:** Komplettes Rezept: `node --check main.js`, `node --check preload.js`, `node --check tiles.js`, `npm test` (210), `npm run lint` (0), `npm run lint:css` (OK), `npm run test:e2e` (lokal 13 passed + 14 skipped), `python -m py_compile sender.py bridge.py esp_libs/calc.py`, `python -m unittest discover -s test -p "test_*.py"` (65 OK), `__pycache__` löschen.
- [ ] **Step 2:** `graphify update .`
- [ ] **Step 3:** Plan-Doc committen (einzige erlaubte Plan-Doc-Stage): `git add docs/superpowers/plans/2026-07-16-55-live-multikart.md`; Message: `docs(plan): Phase 55 Live-Tab Multi-Kart Implementierungsplan (Phase 55 Task 6)` + Trailer. Push, CI grün (Run-ID).
- [ ] **Step 4:** Whole-Branch-Final-Review (requesting-code-review, Diff main..HEAD) + finishing-a-development-branch (PR gegen main). Im PR-Text: Verweis auf Spec, Baseline-Änderungen (14 Shots), manuelle Checkliste aus der Spec.

---

## Hardware/Manual Acceptance Checklist (User, nach Merge)

- [ ] Demo starten (3 Karts): Live-Tab springt automatisch in die Übersicht; Speed+RPM pro Karte plausibel.
- [ ] RPM über Warnschwelle: Wert auf der Karte wird rot; Vollbild-Warnung weiterhin nur aktives Kart in Einzel-Ansicht.
- [ ] Manuell auf Einzel toggeln → Automatik schaltet in der Sitzung nicht zurück; App-Neustart → Automatik greift wieder.
- [ ] Einstellung „Einzel" → keine Auto-Übersicht; „Übersicht" → Übersicht sobald ≥2 Karts.
- [ ] Light-/Outdoor-Theme: ko-big-Zeile lesbar (CI testet nur dark).

## Self-Review

- **Spec-Abdeckung:** Reducer-Regeln 1–6 ✔ (Task 1, Tests decken jede Regel), Setting inkl. Klemmen ✔ (Task 2), Verdrahtung/manual-Flag/Flag-Reset ✔ (Task 3), ko-big/RPM/warn ✔ (Task 4), Screenshots 13→14 + Masken-Entscheid ✔ (Task 5), Nicht-Ziele respektiert (kein Redesign, kein Tab-Umbau, rpm-warn-Body unangetastet) ✔.
- **Platzhalter-Scan:** alle Code-Schritte tragen vollständigen Code; keine TBD/„similar to".
- **Namens-Konsistenz:** `liveViewAutoReducer`/`START_MODES` (Task 1) == Importe in Task 2/3; `setLiveStartView` in settings.js == index.html == settings-ui.js; `ko-big`/`ko-rpm` in Task 4 == CSS; `demo-live-single.png` in Task 5 == Baseline-Liste. `setLiveView(mode, manual)` — alle 4 manual-Stellen benannt.
- **Bekannte Risiken:** (a) Karten-Reihenfolge im Demo-Rennen ⇒ Container-Maske (dokumentiert, Task 5); (b) karts.spec-Interaktion mit der Automatik (Task 3 Step 6 prüft explizit); (c) CI zwischen Task 2 und Task 5 planmäßig rot (smoke) — js/python-Grün wird pro Push per Run-ID verifiziert.

## Phase Map

- Phase 50: UI-Konsistenz — PR #77. **Phase 55 (dieses Dokument):** Live-Tab Multi-Kart. Phasen 51–54 (Test-Vertiefung, TypeScript ×2, Langzeit-Performance) bleiben reserviert und unberührt.
