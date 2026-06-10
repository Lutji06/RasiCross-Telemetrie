# Phase 23: rasicross.js Split komplett (gauges / track / laps-drivers / live-ui / pit-wall / recording) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Den in Phase 22 begonnenen Split von rasicross.js (aktuell 3637 Zeilen) abschließen — alle verbliebenen Feature-Sektionen wandern als klassische Scripts in sechs eigene Dateien; rasicross.js behält nur den App-Kern (State, Utilities, Persistenz, Dialoge, Tabs, Settings, Telemetry-Pipeline, G-View/Uploader-Glue, Init). Keine Verhaltensänderung.

**Architecture:** Identisch zu Phase 22: reiner Code-Move, klassische `<script>`-Dateien im gemeinsamen Global-Scope, geladen nach den UMD-Modulen und den Phase-22-Scripts, vor rasicross.js. Kein Top-Level-Code außer Deklarationen — einzige Logik-Anpassung: die zwei Top-Level-`setInterval` aus Sektion 17 werden in `initLiveUiLoops()` gekapselt und aus `init()` gerufen (Präzedenz: `initTrackCanvases()` aus Phase 22; Verhalten identisch, da die Intervals ohnehin erst nach dem synchronen Laden aller Scripts feuern). ESLint-`no-undef` mit Globals-Listen dokumentiert die Schnittstellen; `void [...]`-Marker verhindern `no-unused-vars`.

**Tech Stack:** Vanilla JS (classic scripts), ESLint flat config, node:test (Suite unverändert), electron-builder (`package.json` → `build.files`).

---

## Working Directory & Conventions

- Working Directory: `C:\Users\jimlu\Documents\RasiCross-Telemetrie-git`.
- Branch: **`refactor/rasicross-split`** (Fortsetzung von Phase 22 auf demselben Branch — ein Branch = der komplette Split). Kein neuer Branch.
- Dateien sind **CRLF**. Vor jedem Edit die Zielregion frisch mit Read lesen; Zeilennummern hier sind indikativ, Anker sind Text. Verifikation mit dem **Grep-Tool** (nicht Shell-grep).
- Sektions-Moves laufen über das Python-Snippet (liest/schreibt mit `newline=''` → CRLF bleibt byte-identisch). Snippet per Bash-Heredoc, wird **nicht** eingecheckt.
- Zwei End-Anker-Modi im Snippet: **SEP-Modus** (Block endet vor der `====`-Zeile der Folge-Sektion, via `rindex(SEP, 0, j)`) und **Direkt-Modus** (Block endet unmittelbar vor dem End-Anker, z.B. einem Phase-22-Tombstone). Pro Task ist der Modus im Snippet bereits fest verdrahtet — nichts anpassen.
- **Lint-Fix-Regel (deterministisch):** Meldet `npm run lint` nach einem Move `no-undef` für Namen X in Datei Y → genau X in die Globals des File-Entries von Y ergänzen. Ist X in rasicross.js (Kern) definiert und wird von mehreren Modulen genutzt → stattdessen in `appCoreGlobals` ergänzen. Meldet lint `no-unused-vars` für eine Funktion in rasicross.js, die nur noch von neuen Modulen gerufen wird → Namen in den `void [...]`-Marker am Ende von rasicross.js aufnehmen. Kein Blind-Disable.
- Commit-Messages: conventional + Body + Trailer `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- Verifikations-Rezept (pro Task UND final): `node --check` auf neue Datei + rasicross.js, `npm run lint`, `npm test`. Final zusätzlich `python -m unittest discover -s test -p "test_*.py"` und `node --check` auf alle App-JS.
- **Baselines (müssen grün bleiben):** `npm test` = **107 pass / 0 fail**; `unittest` = **Ran 38 tests … OK**; `npm run lint` = keine Ausgabe; `node --check` = keine Ausgabe.

## Locked Decisions

1. **Sechs Dateien, sieben Tasks:** `gauges.js` (Sektion 8), `track.js` (Sektionen 10–13), `laps-drivers.js` (Sektion 14 + Driver-Stats-Block + Sektion 15), `live-ui.js` (Live-Charts-Block + Sektion 17), `pit-wall.js` (Sektion 18 + Connection-Tab + Pit-Call + Kart-Display), `recording.js` (Export/Import/Reset + Sektion 19b Recording/Replay). Task 7 = Header + Abschluss-Verifikation.
2. **In rasicross.js bleiben:** Sektionen 1–7 (Kern), G-View-Toggle + Kart-Model-Uploader (Init-Glue, Zeilen ~2982–3141), Sektion 20 Init + UI-Glue-IIFE.
3. **`initLiveUiLoops()`:** Die zwei Top-Level-`setInterval` (200ms-Backup-Tick + 1Hz-UI-Loop) werden beim Move in eine Funktion gekapselt; `init()` ruft sie nach `initLiveCharts()`. Keine Re-Indentierung der Interval-Bodies (ESLint hat keine Indent-Regel).
4. **Ladereihenfolge im HTML:** nach `serial-demo.js`, vor `rasicross.js`, in Task-Reihenfolge: gauges, track, laps-drivers, live-ui, pit-wall, recording. (Reihenfolge unkritisch — nur Deklarationen auf Top-Level.)
5. **ESLint:** Pro Datei ein File-Entry + eine Export-Globals-Konstante (`gaugesGlobals` … `recordingGlobals`); rasicross.js-Entry bekommt alle sechs Spreads. Seed-Listen unten sind Startpunkte — die Lint-Fix-Regel ergänzt fehlende Namen.
6. **void-Marker-Pflege:** rasicross.js-Marker (`void [armRecording, pushPacketLog]`) verliert `pushPacketLog` in Task 5 (zieht nach pit-wall.js); jede neue Datei bekommt ihren eigenen Marker.
7. **Bestehende Modul-Entries (races/serial-demo) bleiben unverändert** — deren explizite Globals (z.B. `drawChart`, `pushPacketLog`) bleiben gültig, egal welche Datei den Namen jetzt definiert.

## File Structure

| Action | Path | Responsibility |
| --- | --- | --- |
| Create | `gauges.js` | Tacho/RPM/G-Meter: `renderDriftBadge`, `renderRollBar`, `lerp`, `renderGauges`, `drawGMeter` (Ex-Sektion 8) |
| Create | `track.js` | Track Scan + Persistence + Editor + Sektoren: `startTrackScan` … `updateSectorPanel` (Ex-Sektionen 10–13) |
| Create | `laps-drivers.js` | Rundenerkennung + Fahrer: `checkLapCrossing` … `renderDriverOptions` (Ex-Sektion 14 + Driver Stats + 15) |
| Create | `live-ui.js` | Live-Charts + Live-Tab-UI + Loops: `initLiveCharts` … `initLiveUiLoops` (Ex-Live-Charts + Sektion 17) |
| Create | `pit-wall.js` | Pit-Wall + Connection-Tab + Pit-Call + Kart-Display: `openPitWall` … `togglePitCall` (Ex-Sektion 18 + Folgeblöcke) |
| Create | `recording.js` | Export/Import/Reset + Aufnahme/Replay: `exportAll` … `renderReplayBar` (Ex-Sektion 19b) |
| Modify | `rasicross.js` | Sektionen raus (Tombstones rein), `init()` ruft `initLiveUiLoops()`, Header-Liste, void-Marker |
| Modify | `RasiCross_Telemetry.html` | Sechs `<script>`-Tags vor `rasicross.js` |
| Modify | `package.json` | `build.files`: sechs neue Dateien |
| Modify | `eslint.config.js` | Sechs Export-Konstanten + sechs File-Entries + erweiterter rasicross.js-Entry |
| Modify | `.github/workflows/check.yml` | `node --check` für sechs neue Dateien |
| Modify | `README.md` | `node --check`-Zeile erweitert |

Task-Reihenfolge: 1 → 2 → 3 → 4 → 5 → 6 → 7 (jeder Task hinterlässt ein grünes Repo + eigenen Commit).

---

### Task 0: Plan-Doc committen

- [ ] **Step 0.1:** `git status --short` → nur das Plan-Dokument untracked; Branch ist `refactor/rasicross-split`.
- [ ] **Step 0.2:** `git add docs/superpowers/plans/2026-06-10-23-rasicross-split-complete.md && git commit -m "docs: Plan Phase 23 (Split komplett)"` (+ Trailer).

---

### Task 1: `gauges.js` (Sektion 8)

- [ ] **Step 1.1: Move-Snippet (Direkt-Modus, Ende am Sektion-9-Tombstone).**

```python
python << 'PYEOF'
import io
SRC = 'rasicross.js'; DST = 'gauges.js'
SEP = '// ============================================================'
start_anchor = '// 8. TACHO / RPM / G-METER'
end_anchor   = '// (Sektion 9 "Track Map Drawing" -> map-draw.js, Phase 22)'
header = ("'use strict';\r\n" + SEP + "\r\n"
  + "//  RasiCross -- gauges.js  (Tacho/RPM/G-Meter, Phase 23)\r\n"
  + "//  Klassisches Script im gemeinsamen Global-Scope: nutzt state/css/dpr/$\r\n"
  + "//  aus rasicross.js (laedt danach). Nur Deklarationen auf Top-Level.\r\n"
  + SEP + "\r\n\r\n")
footer = ("\r\n// Interface-Marker: von rasicross.js/live-ui.js genutzte Funktionen --\r\n"
  + "// verhindert no-unused-vars, dokumentiert das API.\r\n"
  + "void [renderDriftBadge, renderRollBar, lerp, renderGauges, drawGMeter];\r\n")
s = io.open(SRC, encoding='utf-8', newline='').read()
i = s.index(start_anchor)
prev_nl = s.rindex('\n', 0, i)
prev_start = s.rindex('\n', 0, prev_nl) + 1
if s[prev_start:prev_nl].rstrip('\r') == SEP:
    i = prev_start
j = s.index(end_anchor)            # Direkt-Modus: Block endet vor dem Tombstone
block = s[i:j].rstrip() + '\r\n'
tomb = '// (Sektion 8 "Tacho/RPM/G-Meter" -> gauges.js, Phase 23)\r\n\r\n'
io.open(DST, 'w', encoding='utf-8', newline='').write(header + block + footer)
io.open(SRC, 'w', encoding='utf-8', newline='').write(s[:i] + tomb + s[j:])
print('moved', len(block), 'chars')
PYEOF
```

- [ ] **Step 1.2: Script-Tag.** Edit `RasiCross_Telemetry.html`:

```
old: <script src="serial-demo.js"></script>\n<script src="rasicross.js"></script>
new: <script src="serial-demo.js"></script>\n<script src="gauges.js"></script>\n<script src="rasicross.js"></script>
```

- [ ] **Step 1.3: `package.json`.** Edit: `"serial-demo.js",\n      "geo.js",` → `"serial-demo.js",\n      "gauges.js",\n      "geo.js",`

- [ ] **Step 1.4: ESLint.** Nach `serialDemoGlobals` einfügen:

```js
// Schnittstelle gauges.js -> Nutzer (rasicross.js, live-ui.js)
const gaugesGlobals = {
  renderDriftBadge: 'readonly', renderRollBar: 'readonly', lerp: 'readonly',
  renderGauges: 'readonly', drawGMeter: 'readonly',
};
```

File-Entry vor dem rasicross.js-Entry:

```js
  // gauges.js — klassisches App-Script, gemeinsamer Global-Scope
  {
    files: ['gauges.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: { ...globals.browser, ...geoGlobals, ...appCoreGlobals },
    },
    rules: bugRules,
  },
```

rasicross.js-Entry: `...gaugesGlobals,` ergänzen (nach `...serialDemoGlobals,`).

- [ ] **Step 1.5: check.yml + README.** `node --check gauges.js` nach der serial-demo-Zeile; README-Zeile um ` gauges.js` ergänzen.
- [ ] **Step 1.6: Verifikation.** `node --check gauges.js rasicross.js` (einzeln) sauber; Grep `^function drawGMeter` → 0 in rasicross.js, 1 in gauges.js; `npm run lint` (Lint-Fix-Regel anwenden); `npm test` → 107 pass.
- [ ] **Step 1.7: Commit.** `refactor(split): Tacho/RPM/G-Meter -> gauges.js` (+ Body + Trailer); Files: rasicross.js gauges.js RasiCross_Telemetry.html package.json eslint.config.js .github/workflows/check.yml README.md.

---

### Task 2: `track.js` (Sektionen 10–13)

- [ ] **Step 2.1: Move-Snippet (SEP-Modus, Ende vor Sektion 14).**

```python
python << 'PYEOF'
import io
SRC = 'rasicross.js'; DST = 'track.js'
SEP = '// ============================================================'
start_anchor = '// 10. TRACK SCAN'
end_anchor   = '// 14. LAP DETECTION'
header = ("'use strict';\r\n" + SEP + "\r\n"
  + "//  RasiCross -- track.js  (Track Scan/Persistence/Editor/Sektoren, Phase 23)\r\n"
  + "//  Klassisches Script im gemeinsamen Global-Scope: nutzt state/$/css,\r\n"
  + "//  Dialoge, geo-Helfer, map-draw.js (drawTrack/gpsXYOnCanvas/...),\r\n"
  + "//  RasiTiles/RasiTileRenderer. Nur Deklarationen auf Top-Level.\r\n"
  + SEP + "\r\n\r\n")
footer = ("\r\n// Interface-Marker: von rasicross.js/serial-demo.js/races.js/recording.js\r\n"
  + "// genutzte Funktionen -- verhindert no-unused-vars, dokumentiert das API.\r\n"
  + "void [startTrackScan, finishTrackScan, clearTrack, updateBounds, onGpsUpdate,\r\n"
  + "      saveCurrentTrack, loadSavedTrack, deleteSavedTrack, refreshTrackTileStatus,\r\n"
  + "      startTrackTileCache, renderSavedTracks, openTrackEditor, closeTrackEditor,\r\n"
  + "      editorClickTarget, handleEditorClick, saveEditor, calcAutoSectors,\r\n"
  + "      clearManualSectors, activateSectorClick, handleTrackCanvasClick,\r\n"
  + "      checkSectorCrossings, updateSectorPanel];\r\n")
s = io.open(SRC, encoding='utf-8', newline='').read()
i = s.index(start_anchor)
prev_nl = s.rindex('\n', 0, i)
prev_start = s.rindex('\n', 0, prev_nl) + 1
if s[prev_start:prev_nl].rstrip('\r') == SEP:
    i = prev_start
j = s.index(end_anchor)
j = s.rindex(SEP, 0, j)            # SEP-Modus
block = s[i:j].rstrip()
if block.endswith(SEP):
    block = block[:block.rindex(SEP)].rstrip()
block += '\r\n'
tomb = '// (Sektionen 10-13 "Track Scan/Persistence/Editor/Sectors" -> track.js, Phase 23)\r\n\r\n'
io.open(DST, 'w', encoding='utf-8', newline='').write(header + block + footer)
io.open(SRC, 'w', encoding='utf-8', newline='').write(s[:i] + tomb + s[j:])
print('moved', len(block), 'chars')
PYEOF
```

- [ ] **Step 2.2: Script-Tag** nach gauges.js (Muster Task 1). **Step 2.3: package.json** `"gauges.js",` → + `"track.js",`. **Step 2.4: ESLint:**

```js
// Schnittstelle track.js -> Nutzer (rasicross.js, serial-demo.js, races.js, recording.js)
const trackGlobals = {
  startTrackScan: 'readonly', finishTrackScan: 'readonly', clearTrack: 'readonly',
  updateBounds: 'readonly', onGpsUpdate: 'readonly', saveCurrentTrack: 'readonly',
  loadSavedTrack: 'readonly', deleteSavedTrack: 'readonly',
  refreshTrackTileStatus: 'readonly', startTrackTileCache: 'readonly',
  renderSavedTracks: 'readonly', openTrackEditor: 'readonly',
  closeTrackEditor: 'readonly', editorClickTarget: 'readonly',
  handleEditorClick: 'readonly', saveEditor: 'readonly',
  calcAutoSectors: 'readonly', clearManualSectors: 'readonly',
  activateSectorClick: 'readonly', handleTrackCanvasClick: 'readonly',
  checkSectorCrossings: 'readonly', updateSectorPanel: 'readonly',
};
```

File-Entry (vor rasicross.js-Entry):

```js
  // track.js — klassisches App-Script, gemeinsamer Global-Scope
  {
    files: ['track.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: { ...globals.browser, ...geoGlobals, ...appCoreGlobals,
                 ...mapDrawGlobals, RasiTiles: 'readonly',
                 RasiTileRenderer: 'readonly' },
    },
    rules: bugRules,
  },
```

rasicross.js-Entry: `...trackGlobals,` ergänzen.

- [ ] **Step 2.5: check.yml + README** (` track.js`). **Step 2.6: Verifikation** (Grep `^function startTrackScan` / `^function drawEditor` / `^function updateSectorPanel` → 0 in rasicross.js, 1 in track.js; lint-Loop; 107 pass). **Step 2.7: Commit** `refactor(split): Track Scan/Persistence/Editor/Sektoren -> track.js`.

---

### Task 3: `laps-drivers.js` (Sektion 14 + Driver Stats + Sektion 15)

- [ ] **Step 3.1: Move-Snippet (Direkt-Modus, Ende am Sektion-16-Tombstone).**

```python
python << 'PYEOF'
import io
SRC = 'rasicross.js'; DST = 'laps-drivers.js'
SEP = '// ============================================================'
start_anchor = '// 14. LAP DETECTION'
end_anchor   = '// (Sektion 16 "Races" -> races.js, Phase 22)'
header = ("'use strict';\r\n" + SEP + "\r\n"
  + "//  RasiCross -- laps-drivers.js  (Rundenerkennung + Fahrer, Phase 23)\r\n"
  + "//  Klassisches Script im gemeinsamen Global-Scope: nutzt state/$/esc/uid,\r\n"
  + "//  Dialoge, geo-Helfer (fmtMs/segmentsCross/...), races.js (activeRace),\r\n"
  + "//  rcAudio. Nur Deklarationen auf Top-Level.\r\n"
  + SEP + "\r\n\r\n")
footer = ("\r\n// Interface-Marker: von rasicross.js/races.js/serial-demo.js/recording.js\r\n"
  + "// genutzte Funktionen -- verhindert no-unused-vars, dokumentiert das API.\r\n"
  + "void [checkLapCrossing, triggerLap, renderLapTable, renderLiveLapList,\r\n"
  + "      getDriverStats, getTotalStats, fmtKm, addDriver, deleteDriver,\r\n"
  + "      renderTotalHero, renderDrivers, renderDriverOptions];\r\n")
s = io.open(SRC, encoding='utf-8', newline='').read()
i = s.index(start_anchor)
prev_nl = s.rindex('\n', 0, i)
prev_start = s.rindex('\n', 0, prev_nl) + 1
if s[prev_start:prev_nl].rstrip('\r') == SEP:
    i = prev_start
j = s.index(end_anchor)            # Direkt-Modus
block = s[i:j].rstrip() + '\r\n'
tomb = '// (Sektionen 14-15 "Lap Detection/Driver Stats/Drivers" -> laps-drivers.js, Phase 23)\r\n\r\n'
io.open(DST, 'w', encoding='utf-8', newline='').write(header + block + footer)
io.open(SRC, 'w', encoding='utf-8', newline='').write(s[:i] + tomb + s[j:])
print('moved', len(block), 'chars')
PYEOF
```

- [ ] **Step 3.2–3.5: Wiring** (Muster Task 1/2): Script-Tag nach track.js; package.json nach `"track.js",`; ESLint-Konstante + Entry + rasicross-Spread; check.yml + README.

```js
// Schnittstelle laps-drivers.js -> Nutzer (rasicross.js, races.js, serial-demo.js)
const lapsDriversGlobals = {
  checkLapCrossing: 'readonly', triggerLap: 'readonly',
  renderLapTable: 'readonly', renderLiveLapList: 'readonly',
  getDriverStats: 'readonly', getTotalStats: 'readonly', fmtKm: 'readonly',
  addDriver: 'readonly', deleteDriver: 'readonly', renderTotalHero: 'readonly',
  renderDrivers: 'readonly', renderDriverOptions: 'readonly',
};
```

```js
  // laps-drivers.js — klassisches App-Script, gemeinsamer Global-Scope
  {
    files: ['laps-drivers.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: { ...globals.browser, ...geoGlobals, ...appCoreGlobals,
                 ...mapDrawGlobals, ...racesGlobals, ...trackGlobals },
    },
    rules: bugRules,
  },
```

- [ ] **Step 3.6: Verifikation** (Grep `^function triggerLap` / `^function getDriverStats` / `^function renderDrivers` → 0/1; lint-Loop; 107 pass). **Step 3.7: Commit** `refactor(split): Rundenerkennung + Fahrer -> laps-drivers.js`.

---

### Task 4: `live-ui.js` (Live-Charts + Sektion 17) — mit `initLiveUiLoops()`

- [ ] **Step 4.1: Move-Snippet (SEP-Modus, Ende vor Sektion 18).**

```python
python << 'PYEOF'
import io
SRC = 'rasicross.js'; DST = 'live-ui.js'
SEP = '// ============================================================'
start_anchor = '// LIVE CHARTS (Speed/RPM + G-Kraft)'
end_anchor   = '// 18. PIT-WALL'
header = ("'use strict';\r\n" + SEP + "\r\n"
  + "//  RasiCross -- live-ui.js  (Live-Charts + Live-Tab-UI + Loops, Phase 23)\r\n"
  + "//  Klassisches Script im gemeinsamen Global-Scope: nutzt state/$/css/dpr,\r\n"
  + "//  geo-Helfer, gauges.js/map-draw.js/races.js/laps-drivers.js sowie\r\n"
  + "//  RasiKart3D/RasiDrift/RasiAttitude/DomTargets. Die beiden UI-Loops\r\n"
  + "//  startet init() in rasicross.js via initLiveUiLoops().\r\n"
  + "//  Nur Deklarationen auf Top-Level -- kein Code laeuft beim Laden.\r\n"
  + SEP + "\r\n\r\n")
footer = ("\r\n// Interface-Marker: von rasicross.js/races.js/pit-wall.js/recording.js\r\n"
  + "// genutzte Funktionen -- verhindert no-unused-vars, dokumentiert das API.\r\n"
  + "void [initLiveCharts, resizeChartCanvas, drawChart, axisFmt, drawLiveCharts,\r\n"
  + "      drawYawSparkline, updateLiveDelta, updateLiveKPIs, updateDiagnostics,\r\n"
  + "      updateLiveUi, renderStints, animLoop, initLiveUiLoops];\r\n")
s = io.open(SRC, encoding='utf-8', newline='').read()
i = s.index(start_anchor)
prev_nl = s.rindex('\n', 0, i)
prev_start = s.rindex('\n', 0, prev_nl) + 1
if s[prev_start:prev_nl].rstrip('\r') == SEP:
    i = prev_start
j = s.index(end_anchor)
j = s.rindex(SEP, 0, j)            # SEP-Modus
block = s[i:j].rstrip()
if block.endswith(SEP):
    block = block[:block.rindex(SEP)].rstrip()
block += '\r\n'
tomb = '// (Live Charts + Sektion 17 "Live UI" -> live-ui.js, Phase 23)\r\n\r\n'
io.open(DST, 'w', encoding='utf-8', newline='').write(header + block + footer)
io.open(SRC, 'w', encoding='utf-8', newline='').write(s[:i] + tomb + s[j:])
print('moved', len(block), 'chars')
PYEOF
```

- [ ] **Step 4.2: setInterval kapseln.** In `live-ui.js` (Region frisch lesen, zwei Edits):

Edit A — Funktionskopf vor dem Backup-Tick:

```
old:
// Backup tick (top-level, läuft auch wenn rAF im Hintergrund-Iframe pausiert)
setInterval(() => {
new:
// Beide UI-Loops (200ms-Backup-Tick + 1Hz-Loop) -- werden von init() in
// rasicross.js via initLiveUiLoops() gestartet (Phase 23, kein Top-Level-Code).
function initLiveUiLoops() {
// Backup tick (läuft auch wenn rAF im Hintergrund-Iframe pausiert)
setInterval(() => {
```

Edit B — Funktionsende nach dem 1Hz-Loop (Anker `}, 1000);` ist in live-ui.js eindeutig — mit Grep prüfen):

```
old:
}, 1000);
new:
}, 1000);
}
```

- [ ] **Step 4.3: `init()`-Aufruf.** In `rasicross.js` Region um `initLiveCharts();` frisch lesen, Edit:

```
old:   initLiveCharts();
new:   initLiveCharts();\n  initLiveUiLoops();
```

- [ ] **Step 4.4: Wiring** (Muster): Script-Tag nach laps-drivers.js; package.json; ESLint; check.yml + README.

```js
// Schnittstelle live-ui.js -> Nutzer (rasicross.js, races.js, pit-wall.js, recording.js)
const liveUiGlobals = {
  initLiveCharts: 'readonly', resizeChartCanvas: 'readonly', drawChart: 'readonly',
  axisFmt: 'readonly', drawLiveCharts: 'readonly', drawYawSparkline: 'readonly',
  updateLiveDelta: 'readonly', updateLiveKPIs: 'readonly',
  updateDiagnostics: 'readonly', updateLiveUi: 'readonly', renderStints: 'readonly',
  animLoop: 'readonly', initLiveUiLoops: 'readonly',
};
```

```js
  // live-ui.js — klassisches App-Script, gemeinsamer Global-Scope
  {
    files: ['live-ui.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: { ...globals.browser, ...geoGlobals, ...appCoreGlobals,
                 ...mapDrawGlobals, ...racesGlobals, ...trackGlobals,
                 ...gaugesGlobals, ...lapsDriversGlobals,
                 renderConnectionTab: 'readonly', updatePitWall: 'readonly',
                 sendDisplayUpdate: 'readonly',
                 RasiKart3D: 'readonly', RasiDrift: 'readonly',
                 RasiAttitude: 'readonly', DomTargets: 'readonly' },
    },
    rules: bugRules,
  },
```

(`renderConnectionTab`/`updatePitWall`/`sendDisplayUpdate` sind bis Task 5 noch in rasicross.js definiert — als explizite Globals eintragen, Task 5 lässt sie unverändert gültig.)

- [ ] **Step 4.5: Verifikation.** Grep `^function updateLiveKPIs` / `^function drawChart` / `^function animLoop` → 0 in rasicross.js, 1 in live-ui.js; Grep `^setInterval` in live-ui.js → **0 Treffer** (gekapselt!); Grep `initLiveUiLoops\(\);` in rasicross.js → 1 Treffer (init); lint-Loop; 107 pass. **Step 4.6: Commit** `refactor(split): Live-Charts + Live-UI -> live-ui.js`.

---

### Task 5: `pit-wall.js` (Sektion 18 + Connection-Tab + Pit-Call + Kart-Display)

- [ ] **Step 5.1: Move-Snippet (Direkt-Modus, Ende am Sektion-19-Tombstone).**

```python
python << 'PYEOF'
import io
SRC = 'rasicross.js'; DST = 'pit-wall.js'
SEP = '// ============================================================'
start_anchor = '// 18. PIT-WALL'
end_anchor   = '// (Sektion 19 "Serial / Demo" -> serial-demo.js, Phase 22)'
header = ("'use strict';\r\n" + SEP + "\r\n"
  + "//  RasiCross -- pit-wall.js  (Pit-Wall + Connection-Tab + Pit-Call +\r\n"
  + "//  Kart-Display, Phase 23). Klassisches Script im gemeinsamen Global-\r\n"
  + "//  Scope: nutzt state/$/esc/setText, Dialoge, geo-Formatter, races.js,\r\n"
  + "//  laps-drivers.js, live-ui.js (drawChart), window.rasiSerial.\r\n"
  + "//  Nur Deklarationen auf Top-Level -- kein Code laeuft beim Laden.\r\n"
  + SEP + "\r\n\r\n")
footer = ("\r\n// Interface-Marker: von rasicross.js (init-Bindings, 1Hz-Loop)/serial-demo.js\r\n"
  + "// genutzte Funktionen -- verhindert no-unused-vars, dokumentiert das API.\r\n"
  + "void [openPitWall, closePitWall, pwKeyHandler, updatePitWall,\r\n"
  + "      renderConnectionTab, pushPacketLog, toggleDiagnose,\r\n"
  + "      buildRaceDataForKart, sendDisplayUpdate, restartDisplayUpdateInterval,\r\n"
  + "      sendPitCall, cancelPitCall, togglePitCall];\r\n")
s = io.open(SRC, encoding='utf-8', newline='').read()
i = s.index(start_anchor)
prev_nl = s.rindex('\n', 0, i)
prev_start = s.rindex('\n', 0, prev_nl) + 1
if s[prev_start:prev_nl].rstrip('\r') == SEP:
    i = prev_start
j = s.index(end_anchor)            # Direkt-Modus
block = s[i:j].rstrip() + '\r\n'
tomb = '// (Sektion 18 "Pit-Wall" + Connection-Tab + Pit-Call -> pit-wall.js, Phase 23)\r\n\r\n'
io.open(DST, 'w', encoding='utf-8', newline='').write(header + block + footer)
io.open(SRC, 'w', encoding='utf-8', newline='').write(s[:i] + tomb + s[j:])
print('moved', len(block), 'chars')
PYEOF
```

- [ ] **Step 5.2: rasicross-void-Marker aktualisieren.** Edit in `rasicross.js`:

```
old:
// Interface-Marker: nur noch von serial-demo.js (Phase 22) genutzte
// Funktionen -- verhindert no-unused-vars, dokumentiert das API.
void [armRecording, pushPacketLog];
new:
// Interface-Marker: nur noch von serial-demo.js (Phase 22) genutzte
// Funktionen -- verhindert no-unused-vars, dokumentiert das API.
void [armRecording];
```

- [ ] **Step 5.3: Wiring** (Muster): Script-Tag nach live-ui.js; package.json; ESLint; check.yml + README.

```js
// Schnittstelle pit-wall.js -> Nutzer (rasicross.js, serial-demo.js, live-ui.js)
const pitWallGlobals = {
  openPitWall: 'readonly', closePitWall: 'readonly', pwKeyHandler: 'readonly',
  updatePitWall: 'readonly', renderConnectionTab: 'readonly',
  pushPacketLog: 'readonly', toggleDiagnose: 'readonly',
  buildRaceDataForKart: 'readonly', sendDisplayUpdate: 'readonly',
  restartDisplayUpdateInterval: 'readonly', sendPitCall: 'readonly',
  cancelPitCall: 'readonly', togglePitCall: 'readonly',
};
```

```js
  // pit-wall.js — klassisches App-Script, gemeinsamer Global-Scope
  {
    files: ['pit-wall.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: { ...globals.browser, ...geoGlobals, ...appCoreGlobals,
                 ...racesGlobals, ...lapsDriversGlobals, ...liveUiGlobals },
    },
    rules: bugRules,
  },
```

- [ ] **Step 5.4: Verifikation.** Grep `^function updatePitWall` / `^function togglePitCall` / `^function renderConnectionTab` → 0 in rasicross.js, 1 in pit-wall.js; lint-Loop; 107 pass. **Step 5.5: Commit** `refactor(split): Pit-Wall + Connection-Tab + Pit-Call -> pit-wall.js`.

---

### Task 6: `recording.js` (Export/Import/Reset + Sektion 19b Recording/Replay)

- [ ] **Step 6.1: Move-Snippet (Direkt-Modus, Ende vor `initGViewToggle`).**

```python
python << 'PYEOF'
import io
SRC = 'rasicross.js'; DST = 'recording.js'
SEP = '// ============================================================'
start_anchor = '// EXPORT / IMPORT / RESET'
end_anchor   = 'function initGViewToggle() {'
header = ("'use strict';\r\n" + SEP + "\r\n"
  + "//  RasiCross -- recording.js  (Export/Import/Reset + Aufnahme/Replay,\r\n"
  + "//  Phase 23). Klassisches Script im gemeinsamen Global-Scope: nutzt\r\n"
  + "//  state/$/setText, Dialoge, RasiReplay/RasiDrift/RasiAttitude, geo-\r\n"
  + "//  Helfer sowie track.js/races.js/laps-drivers.js/live-ui.js-Funktionen.\r\n"
  + "//  Nur Deklarationen auf Top-Level -- kein Code laeuft beim Laden.\r\n"
  + SEP + "\r\n\r\n")
footer = ("\r\n// Interface-Marker: von rasicross.js (init-Bindings)/serial-demo.js\r\n"
  + "// genutzte Funktionen -- verhindert no-unused-vars, dokumentiert das API.\r\n"
  + "void [exportAll, importAll, resetAll, updateRecStatus, saveRecording,\r\n"
  + "      exportRecordingCsv, snapshotReplayState, restoreReplayState,\r\n"
  + "      resetReplayDerived, feedReplayPacket, fastForwardTo, renderDriftStrip,\r\n"
  + "      renderRollStrip, rolloverOnsets, loadRecordingFile, enterReplay,\r\n"
  + "      replayTick, replaySeek, setReplaySpeed, toggleReplayPlay, exitReplay,\r\n"
  + "      renderReplayBar];\r\n")
s = io.open(SRC, encoding='utf-8', newline='').read()
i = s.index(start_anchor)
prev_nl = s.rindex('\n', 0, i)
prev_start = s.rindex('\n', 0, prev_nl) + 1
if s[prev_start:prev_nl].rstrip('\r') == SEP:
    i = prev_start
j = s.index(end_anchor)            # Direkt-Modus: Block endet vor initGViewToggle
block = s[i:j].rstrip() + '\r\n'
tomb = '// (Export/Import/Reset + Sektion 19b "Recording/Replay" -> recording.js, Phase 23)\r\n\r\n'
io.open(DST, 'w', encoding='utf-8', newline='').write(header + block + footer)
io.open(SRC, 'w', encoding='utf-8', newline='').write(s[:i] + tomb + s[j:])
print('moved', len(block), 'chars')
PYEOF
```

- [ ] **Step 6.2: Wiring** (Muster): Script-Tag nach pit-wall.js; package.json; ESLint; check.yml + README.

```js
// Schnittstelle recording.js -> Nutzer (rasicross.js, serial-demo.js)
const recordingGlobals = {
  exportAll: 'readonly', importAll: 'readonly', resetAll: 'readonly',
  updateRecStatus: 'readonly', saveRecording: 'readonly',
  exportRecordingCsv: 'readonly', loadRecordingFile: 'readonly',
  enterReplay: 'readonly', exitReplay: 'readonly', replaySeek: 'readonly',
  setReplaySpeed: 'readonly', toggleReplayPlay: 'readonly',
  renderReplayBar: 'readonly', feedReplayPacket: 'readonly',
  fastForwardTo: 'readonly',
};
```

```js
  // recording.js — klassisches App-Script, gemeinsamer Global-Scope
  {
    files: ['recording.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: { ...globals.browser, ...geoGlobals, ...appCoreGlobals,
                 ...mapDrawGlobals, ...racesGlobals, ...serialDemoGlobals,
                 ...trackGlobals, ...lapsDriversGlobals, ...liveUiGlobals,
                 ...gaugesGlobals, ...pitWallGlobals,
                 RasiReplay: 'readonly', RasiDrift: 'readonly',
                 RasiAttitude: 'readonly',
                 processTelemetry: 'readonly', recordPacket: 'readonly',
                 armRecording: 'readonly', driftInputs: 'readonly' },
    },
    rules: bugRules,
  },
```

rasicross.js-Entry: `...recordingGlobals,` ergänzen.

- [ ] **Step 6.3: Verifikation.** Grep `^function enterReplay` / `^function exportAll` / `^function replayTick` → 0 in rasicross.js, 1 in recording.js; lint-Loop (Achtung: in rasicross.js können jetzt weitere Kern-Funktionen "unused" werden, die nur noch Module rufen → void-Marker erweitern); 107 pass. **Step 6.4: Commit** `refactor(split): Export/Import + Aufnahme/Replay -> recording.js`.

---

### Task 7: Header, Abschluss-Verifikation

- [ ] **Step 7.1: Datei-Header von rasicross.js.** Sektionsliste markieren (Region frisch lesen, sechs Edits nach Muster Phase 22):

```
     8. Tacho/RPM/G-Meter           -> gauges.js (Phase 23)
    10. Track Scan                  -> track.js (Phase 23)
    11. Track Persistence (saved tracks) -> track.js (Phase 23)
    12. Track Editor                -> track.js (Phase 23)
    13. Sectors                     -> track.js (Phase 23)
    14. Lap Detection               -> laps-drivers.js (Phase 23)
    15. Drivers                     -> laps-drivers.js (Phase 23)
    17. Live UI                     -> live-ui.js (Phase 23)
    18. Pit-Wall                    -> pit-wall.js (Phase 23)
```

- [ ] **Step 7.2: Komplette Verifikation.**
  - `node --check` auf: geo.js replay.js karts3d.js rasicross.js map-draw.js races.js serial-demo.js gauges.js track.js laps-drivers.js live-ui.js pit-wall.js recording.js main.js preload.js drift.js attitude.js tiles.js tile-renderer.js dom-targets.js settings.js → keine Ausgabe.
  - `npm run lint` → keine Ausgabe. `npm test` → 107 pass / 0 fail.
  - `python -m unittest discover -s test -p "test_*.py"` → Ran 38 tests … OK.
  - Grep `Phase 23` in rasicross.js → 15 Treffer (6 Tombstones + 9 Header-Einträge).
  - Grep `void \[` → je 1 Treffer in allen 9 Modul-Dateien + 1 in rasicross.js.
  - Zeilen-Ziel: `wc -l rasicross.js` → **< 1500** (vorher 3637).
  - `__pycache__` löschen, `git status --short` → nur beabsichtigte Dateien.
- [ ] **Step 7.3: Commit** `docs(split): Sektionsliste im rasicross.js-Header aktualisiert (Phase 23)`.
- [ ] **Step 7.4:** Push nur nach Freigabe durch den User.

---

## Manual Acceptance Checklist (User, deferred)

Wie Phase 22 — reiner Move, jede Abweichung ist ein Bug. Zusätzlich zu der Phase-22-Checkliste besonders prüfen:

- [ ] App startet ohne Konsolen-Fehler; Tacho/RPM/G-Meter animieren sofort (gauges.js + animLoop).
- [ ] 1Hz-Statuszeile tickt (Session-Uhr zählt, Verbindungs-Pill aktualisiert) — beweist `initLiveUiLoops()`.
- [ ] Demo: Runden + Sektoren + Live-Rundentabelle + Fahrer-Statistiken aktualisieren.
- [ ] Track speichern/laden/löschen, Tile-Cache-Button, Track-Editor komplett.
- [ ] Pit-Wall (ESC schließt), Pit-Call senden/abbrechen, Connection-Tab-Log füllt sich.
- [ ] NDJSON speichern + laden → Replay (Seek, Speed, Drift-/Roll-Strips), CSV-Export, Voll-Export/Import.

## Self-Review

- **Scope:** Alle verbliebenen Feature-Sektionen haben einen Task; Kern (1–7, G-View/Uploader, Init) bleibt bewusst. Anker gegen den Ist-Stand verifiziert (Tombstones aus Phase 22 als End-Anker; `function initGViewToggle() {` ist als Definitions-String eindeutig, der init()-Aufruf `initGViewToggle();` matcht nicht).
- **Platzhalter:** Move-Snippets vollständig pro Task; Wiring-Schritte referenzieren das Muster aus Task 1/2 mit task-spezifischen Listen vollständig ausgeschrieben; Lint-Nachpflege ist deterministisch geregelt.
- **Top-Level-Code:** Alle Move-Regionen per `^\S`-Scan geprüft — nur Deklarationen, einzige Ausnahme die zwei `setInterval` in Sektion 17 → Step 4.2 kapselt sie; Grep-Assert in Step 4.5.
- **Namen:** void-Marker-Listen == Funktionsinventar der Regionen; Export-Konstanten ⊆ Marker (intern bleibende Helfer wie `_activeTileTemplate`, `applyEditorInputsToTrack`, `drawEditor`, `replayTick`-Konsorten nur im Marker, wo extern ungenutzt).
