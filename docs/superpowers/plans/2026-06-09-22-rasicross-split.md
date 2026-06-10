# Phase 22: rasicross.js Split (map-draw / races / serial-demo) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** rasicross.js (~4430 Zeilen) um drei in sich geschlossene Sektionen entlasten — Track-Map-Zeichnung, Rennen-Verwaltung und Serial/Demo wandern als klassische Scripts in eigene Dateien (`map-draw.js`, `races.js`, `serial-demo.js`), ohne Verhaltensänderung.

**Architecture:** Reiner Code-Move, kein UMD-/DI-Umbau: Die drei neuen Dateien sind klassische `<script>`-Dateien im gemeinsamen Global-Scope, geladen **nach** den UMD-Modulen und **vor** rasicross.js. Alle Querverweise (state, `$`, `css`, geo-Helfer, Funktionsaufrufe in beide Richtungen) passieren erst zur Laufzeit, daher ist die Ladereihenfolge unkritisch — Bedingung: kein Top-Level-Code in den neuen Dateien außer Deklarationen (verifiziert pro Task). ESLint-`no-undef` mit expliziten Globals-Listen dokumentiert die Modul-Schnittstellen und fängt Tippfehler; ein `void [...]`-Interface-Marker am Dateiende verhindert `no-unused-vars` für die exportierten Funktionen. Einzige Logik-Anpassung: die zwei Canvas-Zuweisungen aus `init()` ziehen als neue Funktion `initTrackCanvases()` nach map-draw.js.

**Tech Stack:** Vanilla JS (classic scripts), ESLint flat config, node:test (bestehende Suite unverändert), Electron-Build via electron-builder (`package.json` → `build.files`).

---

## Working Directory & Conventions

- Working Directory: `C:\Users\jimlu\Documents\RasiCross-Telemetrie-git` — alle git-Befehle als `git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" …`.
- Branch: `refactor/rasicross-split`, abgezweigt von `feat/settings-menu-redesign` (enthält Ghost-Runde/CSV, auf denen Sektion 9 aufbaut). Vor Task 1: `git checkout -b refactor/rasicross-split`.
- Dateien sind **CRLF**. Vor jedem Edit die Zielregion frisch mit Read lesen und den Anker aus diesem Read kopieren; Zeilennummern in diesem Plan sind indikativ, Anker sind Text. Für Verifikation das **Grep-Tool** benutzen (nicht Shell-grep).
- Die Sektions-Moves laufen über das mitgelieferte Python-Snippet (liest/schreibt mit `newline=''` → CRLF bleibt byte-identisch erhalten). Das Snippet wird per Heredoc ausgeführt und **nicht** eingecheckt.
- Niemals `.claude/` oder Plan-Dokumente adden — Ausnahme: der explizite Plan-Doc-Commit in Task 4.
- Commit-Messages: conventional + Body + Trailer `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- Verifikations-Rezept (pro Task UND final): `node --check` auf alle App-JS-Dateien, `npm run lint`, `npm test`, `python -m unittest discover -s test -p "test_*.py"`. `__pycache__` vor `git status` löschen. Python heißt `python` oder `py -3`.
- **Baselines (müssen grün bleiben):** `npm test` = **107 pass / 0 fail**; `unittest` = **Ran 38 tests … OK**; `npm run lint` = keine Ausgabe; `node --check` = keine Ausgabe.

## Locked Decisions

1. **Klassische Scripts, kein UMD:** Die drei Sektionen sind DOM-/State-verwoben; ein Dependency-Injection-Umbau wäre ein Rewrite mit Regressionsrisiko. Code-Move mit gemeinsamem Global-Scope = minimales Diff, identisches Laufzeitverhalten.
2. **Ladereihenfolge:** Neue Scripts nach `karts3d.js`, vor `rasicross.js` (rasicross.js bleibt App-Entry mit `init()`).
3. **Dateinamen:** `map-draw.js` (Sektion 9), `races.js` (Sektion 16), `serial-demo.js` (Sektion 19).
4. **Keine Logikänderung** außer `initTrackCanvases()` (ersetzt zwei Zuweisungs-Zeilen in `init()`).
5. **Kein neuer Unit-Test:** DOM-Glue bleibt per Konvention un-unit-getestet. Absicherung: `node --check`, ESLint-`no-undef` über explizite Schnittstellen-Listen, Grep-Asserts (Funktion ist umgezogen, nicht dupliziert), manueller Smoke (Checkliste unten).
6. **ESLint als Schnittstellen-Doku:** Pro neuer Datei eine Globals-Liste (was sie konsumiert); `rasicross.js` bekommt die Export-Listen der neuen Module. Meldet `npm run lint` ein fehlendes Global (`no-undef`), wird **genau dieser Name** in die betreffende Liste ergänzt (kein Blind-Disable).
7. **`void [...]`-Interface-Marker** am Ende jeder neuen Datei listet alle Top-Level-Funktionen → verhindert `no-unused-vars` und dokumentiert das Interface.
8. **Sektionen, die (noch) bleiben:** Connection-Tab-Updates, Pit-Call, Track-Editor — Kandidaten für eine spätere Phase, hier außer Scope.

## File Structure

| Action | Path | Responsibility |
| --- | --- | --- |
| Create | `map-draw.js` | Track-Karten-Zeichnung: `initTrackCanvases`, `resizeCanvases`, `gpsXYOnCanvas`, `drawTrack`, `drawTrackOn`, `drawLineOn`, `drawGhostOn`, `drawHeatmapOn` (Ex-Sektion 9) |
| Create | `races.js` | Rennen-Verwaltung: `activeRace` … `updateRaceControls` (21 Funktionen, Ex-Sektion 16) |
| Create | `serial-demo.js` | Serial-Verbindung + Auto-Reconnect + Demo-Modus: `listSerialPorts` … `generateDemoTrack` (13 Funktionen, Ex-Sektion 19) |
| Modify | `rasicross.js` | Sektionen 9/16/19 raus (Tombstone-Kommentar rein), `init()` ruft `initTrackCanvases()`, Header-Sektionsliste aktualisiert |
| Modify | `RasiCross_Telemetry.html` | Drei `<script>`-Tags vor `rasicross.js` |
| Modify | `package.json` | `build.files`: drei neue Dateien |
| Modify | `eslint.config.js` | `appCoreGlobals` + drei Modul-Globals-Konstanten + drei File-Entries + erweiterte rasicross.js-Globals |
| Modify | `.github/workflows/check.yml` | `node --check` für die drei neuen Dateien |
| Modify | `README.md` | `node --check`-Zeile im Pre-Commit-Rezept |

Task-Reihenfolge: 1 → 2 → 3 → 4 (jeder Task hinterlässt ein vollständig verdrahtetes, grünes Repo + eigenen Commit).

---

### Task 0: Branch

- [ ] **Step 0.1:** `git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" checkout -b refactor/rasicross-split`
- [ ] **Step 0.2:** `git status --short` → leer (sauberer Start).

---

### Task 1: `map-draw.js` extrahieren (Sektion 9)

**Files:**
- Create: `map-draw.js`
- Modify: `rasicross.js` (Sektion 9 raus, `init()`-Canvas-Zeilen ersetzen)
- Modify: `RasiCross_Telemetry.html`, `package.json`, `eslint.config.js`, `.github/workflows/check.yml`, `README.md`

- [ ] **Step 1.1: Sektion 9 per Python-Snippet verschieben.** Heredoc ausführen (Bash, im Repo-Root):

```python
python << 'PYEOF'
import io
SRC = 'rasicross.js'
DST = 'map-draw.js'
SEP = '// ============================================================'
start_anchor = '// 9. TRACK MAP DRAWING'
end_anchor   = '// 10. TRACK SCAN'
header = (
    "'use strict';\r\n"
    + SEP + "\r\n"
    + "//  RasiCross -- map-draw.js  (Track-Karten-Zeichnung, Phase 22)\r\n"
    + "//  Klassisches Script im gemeinsamen Global-Scope: liest state/$/css/\r\n"
    + "//  dpr aus rasicross.js (laedt danach) sowie RasiTiles/RasiTileRenderer\r\n"
    + "//  und geo.js-Globals (lineEndpointsFromGate, ghostPointAt).\r\n"
    + "//  Nur Deklarationen auf Top-Level -- kein Code laeuft beim Laden.\r\n"
    + SEP + "\r\n\r\n"
)
footer = (
    "\r\n// Canvas-Referenzen aufloesen -- wird von init() in rasicross.js gerufen.\r\n"
    + "function initTrackCanvases() {\r\n"
    + "  _trackCanvas = $('trackCanvas');\r\n"
    + "  _scanCanvas = $('scanCanvas');\r\n"
    + "}\r\n\r\n"
    + "// Interface-Marker: von rasicross.js (u.a. init/Render-Loop/Editor/Sektoren)\r\n"
    + "// genutzte Funktionen -- verhindert no-unused-vars, dokumentiert das API.\r\n"
    + "void [initTrackCanvases, resizeCanvases, gpsXYOnCanvas, drawTrack,\r\n"
    + "      drawTrackOn, drawLineOn, drawGhostOn, drawHeatmapOn];\r\n"
)
s = io.open(SRC, encoding='utf-8', newline='').read()
i = s.index(start_anchor)
prev_nl = s.rindex('\n', 0, i)
prev_start = s.rindex('\n', 0, prev_nl) + 1
if s[prev_start:prev_nl].rstrip('\r') == SEP:
    i = prev_start                      # ====-Zeile vor dem Titel gehoert zum Block
j = s.index(end_anchor)
j = s.rindex(SEP, 0, j)                 # Block endet vor der ====-Zeile der Folge-Sektion
block = s[i:j].rstrip()
if block.endswith(SEP):                 # haengende ====-Zeile am Blockende abschneiden
    block = block[:block.rindex(SEP)].rstrip()
block += '\r\n'
tomb = '// (Sektion 9 "Track Map Drawing" -> map-draw.js, Phase 22)\r\n\r\n'
io.open(DST, 'w', encoding='utf-8', newline='').write(header + block + footer)
io.open(SRC, 'w', encoding='utf-8', newline='').write(s[:i] + tomb + s[j:])
print('moved', len(block), 'chars')
PYEOF
```

Expected: `moved <Zahl> chars` (Zahl ~7000–9000).

- [ ] **Step 1.2: `init()` auf `initTrackCanvases()` umstellen.** Region um `_trackCanvas = $('trackCanvas');` in rasicross.js frisch lesen, dann Edit:

```
old_string:
  _trackCanvas = $('trackCanvas');
  _scanCanvas = $('scanCanvas');
new_string:
  initTrackCanvases();
```

- [ ] **Step 1.3: Script-Tag in `RasiCross_Telemetry.html`.** Edit:

```
old_string:
<script src="karts3d.js"></script>
<script src="rasicross.js"></script>
new_string:
<script src="karts3d.js"></script>
<script src="map-draw.js"></script>
<script src="rasicross.js"></script>
```

- [ ] **Step 1.4: `package.json` → `build.files`.** Edit (Eintrag vor `"geo.js"`):

```
old_string:
      "rasicross.js",
      "geo.js",
new_string:
      "rasicross.js",
      "map-draw.js",
      "geo.js",
```

- [ ] **Step 1.5: ESLint-Globals.** In `eslint.config.js` direkt nach dem `geoGlobals`-Block einfügen:

```js
// Kern-Helfer + State, die rasicross.js global definiert und die die
// ausgelagerten App-Scripts (map-draw/races/serial-demo) mitbenutzen.
const appCoreGlobals = {
  state: 'readonly', $: 'readonly', css: 'readonly', dpr: 'readonly',
  uid: 'readonly', esc: 'readonly', setText: 'readonly',
  rcAlert: 'readonly', rcConfirm: 'readonly', rcToast: 'readonly',
  saveData: 'readonly', saveDataDebounced: 'readonly',
};
// Schnittstelle map-draw.js -> Nutzer (rasicross.js u.a.)
const mapDrawGlobals = {
  initTrackCanvases: 'readonly', resizeCanvases: 'readonly',
  gpsXYOnCanvas: 'readonly', drawTrack: 'readonly', drawTrackOn: 'readonly',
  drawLineOn: 'readonly', drawGhostOn: 'readonly', drawHeatmapOn: 'readonly',
};
```

Dann einen neuen File-Entry vor dem `rasicross.js`-Entry:

```js
  // map-draw.js — klassisches App-Script, gemeinsamer Global-Scope
  {
    files: ['map-draw.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: { ...globals.browser, ...geoGlobals, ...appCoreGlobals,
                 RasiTiles: 'readonly', RasiTileRenderer: 'readonly' },
    },
    rules: bugRules,
  },
```

Und im bestehenden `rasicross.js`-Entry die Globals erweitern: `...mapDrawGlobals,` (in das `globals:`-Objekt, z.B. nach `...geoGlobals,`).

- [ ] **Step 1.6: `check.yml` + README.** In `.github/workflows/check.yml` nach `node --check rasicross.js` einfügen: `          node --check map-draw.js`. In `README.md` die Zeile `node --check geo.js replay.js karts3d.js rasicross.js main.js preload.js` um ` map-draw.js` ergänzen.

- [ ] **Step 1.7: Verifikation.**
  - `node --check map-draw.js` und `node --check rasicross.js` → keine Ausgabe.
  - Grep `^function drawTrackOn` in `rasicross.js` → **0 Treffer**; in `map-draw.js` → **1 Treffer**. Ebenso für `^function resizeCanvases`, `^function gpsXYOnCanvas`, `^function drawGhostOn`.
  - Grep `^let _trackCanvas` in `map-draw.js` → 1 Treffer; in `rasicross.js` → 0.
  - `npm run lint` → keine Ausgabe. Falls `no-undef` einen Namen meldet: genau diesen Namen in die Globals-Liste der meldenden Datei eintragen (map-draw.js-Entry bzw. rasicross.js-Entry), lint wiederholen.
  - `npm test` → 107 pass / 0 fail.

- [ ] **Step 1.8: Commit.**

```bash
git add rasicross.js map-draw.js RasiCross_Telemetry.html package.json eslint.config.js .github/workflows/check.yml README.md
git commit -m "refactor(split): Track-Map-Zeichnung -> map-draw.js

Sektion 9 unveraendert verschoben (klassisches Script, gemeinsamer
Global-Scope, nur Deklarationen auf Top-Level). init() ruft neu
initTrackCanvases(). ESLint-Globals dokumentieren die Schnittstelle.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: `races.js` extrahieren (Sektion 16)

**Files:**
- Create: `races.js`
- Modify: `rasicross.js`, `RasiCross_Telemetry.html`, `package.json`, `eslint.config.js`, `.github/workflows/check.yml`, `README.md`

- [ ] **Step 2.1: Sektion 16 per Python-Snippet verschieben.**

```python
python << 'PYEOF'
import io
SRC = 'rasicross.js'
DST = 'races.js'
SEP = '// ============================================================'
start_anchor = '// 16. RACES'
end_anchor   = '// LIVE CHARTS (Speed/RPM + G-Kraft)'
header = (
    "'use strict';\r\n"
    + SEP + "\r\n"
    + "//  RasiCross -- races.js  (Rennen-Verwaltung, Phase 22)\r\n"
    + "//  Klassisches Script im gemeinsamen Global-Scope: nutzt state/$/uid/\r\n"
    + "//  esc/setText/css, Dialoge (rcAlert/rcConfirm/rcToast), geo-Formatter\r\n"
    + "//  (fmtMs/fmtClock), saveData(Debounced) sowie loadSavedTrack/\r\n"
    + "//  updateSectorPanel/drawChart/renderDriverOptions aus rasicross.js.\r\n"
    + "//  Nur Deklarationen auf Top-Level -- kein Code laeuft beim Laden.\r\n"
    + SEP + "\r\n\r\n"
)
footer = (
    "\r\n// Interface-Marker: von rasicross.js/serial-demo.js genutzte Funktionen --\r\n"
    + "// verhindert no-unused-vars, dokumentiert das API.\r\n"
    + "void [activeRace, currentStint, raceValidLaps, raceElapsedMs, createRace,\r\n"
    + "      startRace, endRace, pauseRace, toggleRaceRun, openDriverChange,\r\n"
    + "      confirmDriverChange, closeDriverModal, selectRace, setActiveRace,\r\n"
    + "      toggleRaceExpand, deleteRace, drawRaceHistoryChart, renderRaces,\r\n"
    + "      renderRaceDetails, renderTrackOptions, updateRaceControls];\r\n"
)
s = io.open(SRC, encoding='utf-8', newline='').read()
i = s.index(start_anchor)
prev_nl = s.rindex('\n', 0, i)
prev_start = s.rindex('\n', 0, prev_nl) + 1
if s[prev_start:prev_nl].rstrip('\r') == SEP:
    i = prev_start
j = s.index(end_anchor)
j = s.rindex(SEP, 0, j)
block = s[i:j].rstrip()
if block.endswith(SEP):
    block = block[:block.rindex(SEP)].rstrip()
block += '\r\n'
tomb = '// (Sektion 16 "Races" -> races.js, Phase 22)\r\n\r\n'
io.open(DST, 'w', encoding='utf-8', newline='').write(header + block + footer)
io.open(SRC, 'w', encoding='utf-8', newline='').write(s[:i] + tomb + s[j:])
print('moved', len(block), 'chars')
PYEOF
```

- [ ] **Step 2.2: Script-Tag.** Edit in `RasiCross_Telemetry.html`:

```
old_string:
<script src="map-draw.js"></script>
<script src="rasicross.js"></script>
new_string:
<script src="map-draw.js"></script>
<script src="races.js"></script>
<script src="rasicross.js"></script>
```

- [ ] **Step 2.3: `package.json`.** Edit:

```
old_string:
      "map-draw.js",
      "geo.js",
new_string:
      "map-draw.js",
      "races.js",
      "geo.js",
```

- [ ] **Step 2.4: ESLint.** In `eslint.config.js` nach dem `mapDrawGlobals`-Block:

```js
// Schnittstelle races.js -> Nutzer (rasicross.js, serial-demo.js)
const racesGlobals = {
  activeRace: 'readonly', currentStint: 'readonly', raceValidLaps: 'readonly',
  raceElapsedMs: 'readonly', createRace: 'readonly', startRace: 'readonly',
  endRace: 'readonly', pauseRace: 'readonly', toggleRaceRun: 'readonly',
  openDriverChange: 'readonly', confirmDriverChange: 'readonly',
  closeDriverModal: 'readonly', selectRace: 'readonly', setActiveRace: 'readonly',
  toggleRaceExpand: 'readonly', deleteRace: 'readonly',
  drawRaceHistoryChart: 'readonly', renderRaces: 'readonly',
  renderTrackOptions: 'readonly', updateRaceControls: 'readonly',
};
```

Neuer File-Entry direkt nach dem `map-draw.js`-Entry:

```js
  // races.js — klassisches App-Script, gemeinsamer Global-Scope
  {
    files: ['races.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: { ...globals.browser, ...geoGlobals, ...appCoreGlobals,
                 loadSavedTrack: 'readonly', updateSectorPanel: 'readonly',
                 drawChart: 'readonly', renderDriverOptions: 'readonly' },
    },
    rules: bugRules,
  },
```

Im `rasicross.js`-Entry: `...racesGlobals,` ergänzen (nach `...mapDrawGlobals,`).

- [ ] **Step 2.5: `check.yml` + README.** `node --check races.js`-Zeile nach der map-draw-Zeile in check.yml; ` races.js` an die README-`node --check`-Zeile anhängen.

- [ ] **Step 2.6: Verifikation.**
  - `node --check races.js rasicross.js` (einzeln) → keine Ausgabe.
  - Grep `^function startRace` / `^function renderRaces` / `^function activeRace` in `rasicross.js` → je **0 Treffer**; in `races.js` → je **1 Treffer**.
  - `npm run lint` → keine Ausgabe (no-undef-Meldungen wie in Step 1.7 behandeln — fehlende Namen in die jeweilige Liste).
  - `npm test` → 107 pass / 0 fail.

- [ ] **Step 2.7: Commit.**

```bash
git add rasicross.js races.js RasiCross_Telemetry.html package.json eslint.config.js .github/workflows/check.yml README.md
git commit -m "refactor(split): Rennen-Verwaltung -> races.js

Sektion 16 (21 Funktionen, activeRace..updateRaceControls)
unveraendert verschoben. ESLint-Globals dokumentieren Konsum
(loadSavedTrack/updateSectorPanel/drawChart/renderDriverOptions)
und Export (racesGlobals).

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: `serial-demo.js` extrahieren (Sektion 19)

**Files:**
- Create: `serial-demo.js`
- Modify: `rasicross.js`, `RasiCross_Telemetry.html`, `package.json`, `eslint.config.js`, `.github/workflows/check.yml`, `README.md`

**Achtung Anker:** Sektion 19 hat **keine** `====`-Zeile über dem Titel (nur darunter) — das Snippet behandelt das über den Konditional-Check, nichts anpassen.

- [ ] **Step 3.1: Sektion 19 per Python-Snippet verschieben.**

```python
python << 'PYEOF'
import io
SRC = 'rasicross.js'
DST = 'serial-demo.js'
SEP = '// ============================================================'
start_anchor = '// 19. SERIAL / DEMO'
end_anchor   = '// EXPORT / IMPORT / RESET'
header = (
    "'use strict';\r\n"
    + SEP + "\r\n"
    + "//  RasiCross -- serial-demo.js  (Serial-Verbindung + Demo, Phase 22)\r\n"
    + "//  Klassisches Script im gemeinsamen Global-Scope: nutzt state/$/esc/\r\n"
    + "//  uid/setText, Dialoge, window.rasiSerial (Electron-Preload) bzw.\r\n"
    + "//  WebSerial, sowie processTelemetry/onGpsUpdate/armRecording/\r\n"
    + "//  pushPacketLog und races.js-/map-draw.js-Funktionen.\r\n"
    + "//  Nur Deklarationen auf Top-Level -- kein Code laeuft beim Laden.\r\n"
    + SEP + "\r\n\r\n"
)
footer = (
    "\r\n// Interface-Marker: von rasicross.js (init-Bindings, Replay, Settings)\r\n"
    + "// genutzte Funktionen -- verhindert no-unused-vars, dokumentiert das API.\r\n"
    + "void [listSerialPorts, connectSerial, disconnectSerial, onSerialClose,\r\n"
    + "      onSerialError, readWebSerial, handleSerialLine, scheduleReconnect,\r\n"
    + "      stopReconnect, startDemo, stopDemo, demoTick, generateDemoTrack];\r\n"
)
s = io.open(SRC, encoding='utf-8', newline='').read()
i = s.index(start_anchor)
prev_nl = s.rindex('\n', 0, i)
prev_start = s.rindex('\n', 0, prev_nl) + 1
if s[prev_start:prev_nl].rstrip('\r') == SEP:
    i = prev_start
j = s.index(end_anchor)
j = s.rindex(SEP, 0, j)
block = s[i:j].rstrip()
if block.endswith(SEP):
    block = block[:block.rindex(SEP)].rstrip()
block += '\r\n'
tomb = '// (Sektion 19 "Serial / Demo" -> serial-demo.js, Phase 22)\r\n\r\n'
io.open(DST, 'w', encoding='utf-8', newline='').write(header + block + footer)
io.open(SRC, 'w', encoding='utf-8', newline='').write(s[:i] + tomb + s[j:])
print('moved', len(block), 'chars')
PYEOF
```

- [ ] **Step 3.2: Script-Tag.** Edit in `RasiCross_Telemetry.html`:

```
old_string:
<script src="races.js"></script>
<script src="rasicross.js"></script>
new_string:
<script src="races.js"></script>
<script src="serial-demo.js"></script>
<script src="rasicross.js"></script>
```

- [ ] **Step 3.3: `package.json`.** Edit:

```
old_string:
      "races.js",
      "geo.js",
new_string:
      "races.js",
      "serial-demo.js",
      "geo.js",
```

- [ ] **Step 3.4: ESLint.** Nach dem `racesGlobals`-Block:

```js
// Schnittstelle serial-demo.js -> Nutzer (rasicross.js)
const serialDemoGlobals = {
  listSerialPorts: 'readonly', connectSerial: 'readonly',
  disconnectSerial: 'readonly', startDemo: 'readonly', stopDemo: 'readonly',
  stopReconnect: 'readonly', scheduleReconnect: 'readonly',
  handleSerialLine: 'readonly', generateDemoTrack: 'readonly',
};
```

Neuer File-Entry direkt nach dem `races.js`-Entry:

```js
  // serial-demo.js — klassisches App-Script, gemeinsamer Global-Scope
  {
    files: ['serial-demo.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: { ...globals.browser, ...geoGlobals, ...appCoreGlobals,
                 ...racesGlobals, drawTrack: 'readonly',
                 armRecording: 'readonly', processTelemetry: 'readonly',
                 onGpsUpdate: 'readonly', pushPacketLog: 'readonly',
                 renderDrivers: 'readonly', renderDriverOptions: 'readonly',
                 updateBounds: 'readonly', calcAutoSectors: 'readonly',
                 updateSectorPanel: 'readonly' },
    },
    rules: bugRules,
  },
```

Im `rasicross.js`-Entry: `...serialDemoGlobals,` ergänzen (nach `...racesGlobals,`).

- [ ] **Step 3.5: `check.yml` + README.** `node --check serial-demo.js`-Zeile in check.yml; ` serial-demo.js` an die README-`node --check`-Zeile anhängen.

- [ ] **Step 3.6: Verifikation.**
  - `node --check serial-demo.js rasicross.js` (einzeln) → keine Ausgabe.
  - Grep `^function startDemo` / `^async function connectSerial` / `^function demoTick` in `rasicross.js` → je **0 Treffer**; in `serial-demo.js` → je **1 Treffer**.
  - `npm run lint` → keine Ausgabe (no-undef wie gehabt behandeln).
  - `npm test` → 107 pass / 0 fail.
  - Zeilen-Ziel: `wc -l rasicross.js` (Bash) → **< 3600** (vorher ~4430).

- [ ] **Step 3.7: Commit.**

```bash
git add rasicross.js serial-demo.js RasiCross_Telemetry.html package.json eslint.config.js .github/workflows/check.yml README.md
git commit -m "refactor(split): Serial/Demo -> serial-demo.js

Sektion 19 (Serial-Connect/Auto-Reconnect/WebSerial-Fallback +
Demo-Modus, 13 Funktionen) unveraendert verschoben.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Header-Doku, Abschluss-Verifikation, Plan-Doc

**Files:**
- Modify: `rasicross.js` (Sektionsliste im Datei-Header)
- Add: `docs/superpowers/plans/2026-06-09-22-rasicross-split.md` (dieses Dokument)

- [ ] **Step 4.1: Datei-Header von rasicross.js aktualisieren.** Region (Zeilen ~2–25) frisch lesen, dann die drei verschobenen Einträge in der Sektionsliste markieren. Edit:

```
old_string:
     9. Track Map (drawing)
new_string:
     9. Track Map (drawing)        -> map-draw.js (Phase 22)
```

```
old_string:
    16. Races
new_string:
    16. Races                      -> races.js (Phase 22)
```

```
old_string:
    19. Serial / Demo
new_string:
    19. Serial / Demo              -> serial-demo.js (Phase 22)
```

- [ ] **Step 4.2: Komplette Verifikation (alle Baselines).**
  - `node --check` auf: `geo.js replay.js karts3d.js rasicross.js map-draw.js races.js serial-demo.js main.js preload.js drift.js attitude.js tiles.js tile-renderer.js dom-targets.js settings.js` → keine Ausgabe.
  - `npm run lint` → keine Ausgabe.
  - `npm test` → **107 pass / 0 fail**.
  - `python -m unittest discover -s test -p "test_*.py"` → **Ran 38 tests … OK** (Python unberührt — Plausibilitäts-Gate).
  - Grep `Phase 22` in `rasicross.js` → 6 Treffer (3 Tombstones + 3 Header-Listen-Einträge aus Step 4.1).
  - Grep `void \[` → je 1 Treffer in `map-draw.js`, `races.js`, `serial-demo.js`.
  - `__pycache__` löschen, dann `git status --short` → nur beabsichtigte Dateien.

- [ ] **Step 4.3: Commit.** (Das Plan-Dokument selbst ist bereits beim Authoring auf `feat/settings-menu-redesign` committet — hier nur noch der Header.)

```bash
git add rasicross.js
git commit -m "docs(split): Sektionsliste im rasicross.js-Header aktualisiert

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

- [ ] **Step 4.4:** Push nur nach Freigabe durch den User: `git push -u origin refactor/rasicross-split`.

---

## Manual Acceptance Checklist (User, deferred)

Nach Abschluss `npm start` und durchklicken — der Split ist ein reiner Move, jede Abweichung vom Ist-Verhalten ist ein Bug:

- [ ] App startet ohne Fehler in der DevTools-Konsole (F12 → Console beim Laden beobachten).
- [ ] **Demo starten:** Strecke erscheint auf der Karte, GPS-Punkt fährt, „Demo Race" startet automatisch, Runden werden gezählt.
- [ ] **Ghost-Runde:** ab Runde 2 blasse violette Linie + mitlaufender Geister-Punkt.
- [ ] **Fenster-Resize:** Karte skaliert sauber mit (resizeCanvases).
- [ ] **Rennen-Tab:** Rennen anlegen → aktivieren → Start → Pause → Fortsetzen → Beenden; Details aufklappen (Speed-Verlauf-Chart zeichnet); Rennen löschen; Fahrerwechsel-Modal.
- [ ] **Strecken-Tab:** Track-Editor öffnen, „Auf Karte klicken" für Start/S2/S3 funktioniert (gpsXYOnCanvas quergenutzt).
- [ ] **Verbindungs-Tab:** COM-Port-Liste füllt sich (Electron), Verbinden/Trennen togglet Buttons, Demo-Stop setzt Status zurück.
- [ ] **Aufnahme:** NDJSON speichern, CSV exportieren, NDJSON laden → Replay läuft (Transport-Leiste, Karte + Rennen im Replay).
- [ ] **Pit-Wall** öffnen/schließen (ESC).
- [ ] Optional Hardware-Smoke: Bridge anstecken, verbinden, Live-Daten + Auto-Reconnect nach USB-Ziehen.

## Self-Review

- **Spec-Abdeckung:** Alle drei in der Review benannten Kandidaten (Sektion 9, 16, 19) haben je einen Task; Wiring (HTML/package.json/ESLint/check.yml/README) ist in jedem Task enthalten; Header-Doku + finale Verifikation in Task 4. Bewusst außer Scope (Locked Decision 8): Connection-Tab, Pit-Call, Track-Editor.
- **Platzhalter-Scan:** Keine TBD/TODO; die Move-Snippets sind vollständig und pro Task wiederholt; alle Edits mit literalem old/new; die einzige bedingte Anweisung (no-undef-Nachpflege) ist deterministisch („genau den gemeldeten Namen ergänzen").
- **Namens-Konsistenz:** `initTrackCanvases` identisch in Task 1 (Definition, init-Edit, mapDrawGlobals, void-Marker); `racesGlobals`-Liste == void-Marker-Liste == Funktionsinventar aus Sektion 16 (21 Namen, `renderRaceDetails` nur im Marker, nicht in racesGlobals — wird extern nicht genutzt); `serialDemoGlobals` (9 extern genutzte) ⊂ void-Marker (alle 13).

## Phase Map

- **P1–P6, P11–P21:** geliefert (Telemetrie-Kern, Binär-Protokoll, 3D, OSM-Tiles, Drift/Roll, Settings-Redesign, G-Meter-Kipp).
- **P22 (dieses Dokument):** Struktur-Refactor — rasicross.js → map-draw.js / races.js / serial-demo.js. Keine Protokoll-/Verhaltensänderung, keine ESP-Berührung.
- **Kandidaten danach:** P23 Connection-Tab + Pit-Call-Sektion extrahieren; P24 Track-Editor extrahieren; CSV/Ghost-Folge-Ideen aus der Code-Review (RSSI-Sparkline, theoretische Bestrunde, Crash-sichere Aufnahme).
