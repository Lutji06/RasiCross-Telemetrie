# Phase 43 — State-Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Die Aktiv-Kart-Fassade (27 `defineProperty`-Delegationen auf `state`) entfällt; alle Lesestellen nutzen den Selektor `activeKart()`, die per-Kart-Buckets (`state.karts`) sind die einzige Quelle der Wahrheit.

**Architecture:** Mechanische Migration modulweise BEI AKTIVER Fassade (Getter/Setter delegieren live — beide Zugriffsstile sind während der Migration äquivalent, jeder Zwischenstand ist lauffähig und smoke-testbar). Erst wenn alle 309 Referenzen konvertiert sind, entfernt der vorletzte Task `PER_KART_FIELDS` + den `defineProperty`-Loop und verankert einen statischen Guard-Test, der Rückfälle dauerhaft verhindert.

**Tech Stack:** Bestehender Stack (Vite/ESM, node:test, Playwright-Smoke). Keine neuen Dependencies.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-06-technical-redesign-program-design.md`, Abschnitte „State-Modell" + „Phase 43".
- **Gate:** Smoke-Suite grün (nach Abschluss: 10 passed inkl. neuem Kart-Wechsel-Test) + `npm test` grün (189 + Guard-Test) + `npm run lint` 0.
- **Keine Verhaltensänderung.** Persistenz formatstabil: `SAVE_KEY`-Payload unverändert — die Legacy-Felder `calibration`/`engine` im Payload behalten ihre Semantik „Werte des aktiven Karts" (Downgrade-Gnade). `REC_VERSION` 9.6, serielles Protokoll, `bridge.py`/`sender.py`/`esp_libs/` unangetastet.
- Die 27 Fassadenfelder (verbindliche Liste, identisch in Guard-Test und allen Grep-Gates): `connection, telemetry, raw, display, gps, spdSrc, batt, max, charts, imu, drift, attitude, driftSmooth, heatmap, lapStart, currentLapMax, currentLapTrace, bestLapTrace, bestLapMs, bestLapNum, liveDelta, autoLap, sectorsLive, sectorsBest, recording, replay, calibration, engine` — Achtung: `state.sectors`, `state.settings`, `state.drivers`, `state.races`, `state.demo`, `state.serial`, `state.karts`, `state.activeKartMac`, `state.track`, `state.startGate`, `state.theme`, `state.liveView`, `state._kartHz`, `state.kartsRoster`-Accessoren usw. sind GLOBAL und bleiben `state.*`.
- Schreibzugriffe auf Fassadenfelder (`state.lapStart = null`, `state.charts = {…}`) werden identisch konvertiert (`activeKart().lapStart = null`) — der Setter delegierte bisher genauso.

## Working Directory & Conventions

- Arbeitsverzeichnis `C:/Users/jimlu/Documents/RasiCross-Telemetrie-git`; Branch `feat/phase-43-state-redesign` von `main` (nach Merge von #68).
- Dateien sind **CRLF**: Ziel-Region unmittelbar vor jedem Edit frisch lesen. Zeilennummern im Plan sind Momentaufnahmen.
- Niemals `.claude/`, `CLAUDE.md`, `graphify-out/` committen. Commit-Messages ohne Anführungszeichen, mit Pflicht-Trailern.
- **Konvertierungs-Orakel pro Datei** (das ESLint-Orakel greift hier NICHT — `state.<feld>` wird nach Fassaden-Entfall still `undefined`, kein no-undef!):
  `grep -cE '\bstate\.(connection|telemetry|raw|display|gps|spdSrc|batt|max|charts|imu|drift|attitude|driftSmooth|heatmap|lapStart|currentLapMax|currentLapTrace|bestLapTrace|bestLapMs|bestLapNum|liveDelta|autoLap|sectorsLive|sectorsBest|recording|replay|calibration|engine)\b' src/<datei>.js` → **0** ist das Task-Gate.
- Nach jedem Task zusätzlich: `npm test` grün, `npm run test:e2e` → 9 passed (Fassade ist noch aktiv, Verhalten identisch — der Smoke-Lauf fängt Tippfehler wie `activeKart().telemtry`, die sonst still undefined wären).

## Locked Decisions

- **Konvertierungsmuster:** Innerhalb einer Funktion mit ≥3 Zugriffen: `const k = activeKart();` als erste Zeile (bzw. nach Guards) und alle Feld-Zugriffe über `k.<feld>`. Bei 1-2 Zugriffen: direkt `activeKart().<feld>`. NIEMALS `activeKart()` auf Modul-Top-Level oder in langlebigen Closures cachen (der aktive Kart wechselt zur Laufzeit) — pro Funktionsaufruf frisch holen ist Pflicht.
- **`activeKart()` bleibt in rasicross.js** und ist bereits exportiert (Phase-42-Export-Block). Module, die es noch nicht importieren, ergänzen den Import (`import { …, activeKart } from './rasicross.js'`). Der Selektor selbst (inkl. DEFAULT_MAC-Fallback) bleibt unverändert.
- **Nicht anfassen:** `kartFor(mac)` (expliziter Schreibpfad in processTelemetry inkl. Adoptions-Migration), die Registry (`kart-registry.js`), `activeKart()`-Definition, saveData-Payload-FORM (nur die Feldquellen werden `activeKart().calibration`/`.engine`).
- **Guard-Test statt Konvention:** `test/facade-free.test.js` scannt alle `src/*.js` statisch auf `\bstate\.(feld)\b` (Kommentare zählen mit — auch dort sind die alten Pfade irreführend) und schlägt bei jedem Treffer mit Datei+Zeile fehl. Er wird im selben Task wie die Fassaden-Entfernung eingeführt (vorher würde er fehlschlagen).
- **e2e-Umstellung:** `e2e/replay.spec.js` liest `RasiTest.state.replay.*` → wird `RasiTest.activeKart().replay.*` (`activeKart` ist seit Phase 42 in der Brücke). Die übrigen Specs nutzen nur globale Felder (`state.demo`, `state.karts`, `state.races`, `state.activeKartMac`) und bleiben unverändert.
- **Neuer Gate-Test (Spec-Wortlaut „Kart-Wechsel während laufendem Rennen ändert keine Bucket-Daten"):** deterministisch über einen Kalibrier-Marker statt über timing-abhängige Laufdaten: auf Kart A `calibration.gxZero = 0.11` setzen, aktiv auf Kart B wechseln, prüfen dass (a) Kart B's Bucket den Marker NICHT trägt, (b) Kart A's Bucket ihn per `state.karts.get(macA)` unverändert trägt, (c) nach Rückwechsel `activeKart()` wieder 0.11 liefert. Läuft im bestehenden `e2e/karts.spec.js` als vierter Test (Demo + laufendes Rennen sind dort schon etabliert).
- **Task-Reihenfolge nach Modulgröße aufsteigend pro Schicht**, rasicross.js als letztes Konvertierungs-Modul (es definiert die Fassade selbst — erst wenn alle anderen leer sind, ist sein eigener Bestand eindeutig).

## File Structure

| Action | Path | Refs | Task |
|---|---|---|---|
| Modify | `src/map-draw.js`, `src/track.js`, `src/laps-drivers.js`, `src/races.js` | 9+3+2+14 | 1 |
| Modify | `src/serial-demo.js`, `src/gauges.js` | 14+30 | 2 |
| Modify | `src/live-ui.js` | 50 | 3 |
| Modify | `src/pit-wall.js` | 33 | 4 |
| Modify | `src/recording.js` | 110 | 5 |
| Modify | `src/rasicross.js` | 41 | 6 |
| Modify | `src/rasicross.js` (Fassade raus), Create `test/facade-free.test.js`, Modify `e2e/replay.spec.js`, `e2e/karts.spec.js` | — | 7 |
| Commit | `docs/superpowers/plans/2026-07-08-43-state-redesign.md` | — | 8 |

---

### Task 1: Leichte UI-Module konvertieren (map-draw, track, laps-drivers, races)

**Files:**
- Modify: `src/map-draw.js` (9 Refs), `src/track.js` (3), `src/laps-drivers.js` (2), `src/races.js` (14)

**Interfaces:**
- Consumes: `activeKart()` aus `./rasicross.js` (existierender Export; Rückgabe = Bucket-Objekt mit den 27 Feldern).
- Produces: vier Module ohne `state.<fassadenfeld>`-Referenzen (Grep-Gate 0).

- [ ] **Step 1: Bestand je Datei listen** — pro Datei ausführen und die Trefferliste als Checkliste nutzen:

```bash
grep -nE '\bstate\.(connection|telemetry|raw|display|gps|spdSrc|batt|max|charts|imu|drift|attitude|driftSmooth|heatmap|lapStart|currentLapMax|currentLapTrace|bestLapTrace|bestLapMs|bestLapNum|liveDelta|autoLap|sectorsLive|sectorsBest|recording|replay|calibration|engine)\b' src/map-draw.js src/track.js src/laps-drivers.js src/races.js
```

- [ ] **Step 2: Konvertieren nach Muster** — jede Fundstelle: Region frisch lesen, `state.` → `activeKart().` bzw. bei ≥3 Zugriffen in einer Funktion `const k = activeKart();` + `k.`. Import ergänzen, falls `activeKart` fehlt (races.js und laps-drivers.js importieren es bereits; map-draw.js und track.js prüfen). Beispiel (map-draw.js, Region frisch lesen — Muster, exakter Code kann abweichen):

```js
// vorher:
const p = gpsXYOnCanvas(state.telemetry.lat, state.telemetry.lon, c);
// nachher:
const t = activeKart().telemetry;
const p = gpsXYOnCanvas(t.lat, t.lon, c);
```

Achtung in races.js: `state.races`, `state.activeRaceId`, `state.drivers`, `state.pendingDriverChange` sind GLOBAL — nur die Treffer aus Step 1 anfassen.

- [ ] **Step 3: Gates** — Grep aus Step 1 mit `-c` → 0 für alle vier Dateien; `npx eslint src/` → 0; `npm test` → 189/189; `npm run test:e2e` → 9 passed.

- [ ] **Step 4: Commit**

```bash
git add src/map-draw.js src/track.js src/laps-drivers.js src/races.js
git commit -m "refactor(state): map-draw/track/laps-drivers/races lesen activeKart() statt Fassade"
```

---

### Task 2: serial-demo.js + gauges.js konvertieren

**Files:**
- Modify: `src/serial-demo.js` (14 Refs), `src/gauges.js` (30)

**Interfaces:**
- Consumes/Produces: wie Task 1 (gleiches Muster, gleiches Gate).

- [ ] **Step 1: Bestand listen** — Grep wie Task 1 Step 1 auf `src/serial-demo.js src/gauges.js`.

- [ ] **Step 2: Konvertieren** — Muster wie Task 1. gauges.js ist Render-Hot-Path (renderGauges/drawGMeter/renderRollBar/renderDriftBadge laufen bis 60 Hz): pro Funktion genau EIN `const k = activeKart();` am Funktionsanfang, alle Zugriffe darüber. serial-demo.js: `state.demo`, `state.serial`, `state.connection`? — Achtung: `connection` IST Fassadenfeld (per-Kart), `state.serial`/`state.demo` sind global; exakt die Step-1-Treffer konvertieren.

- [ ] **Step 3: Gates** — Grep -c → 0 beide Dateien; eslint 0; `npm test` 189; `npm run test:e2e` 9 passed.

- [ ] **Step 4: Commit** — `git add src/serial-demo.js src/gauges.js && git commit -m "refactor(state): serial-demo/gauges lesen activeKart() statt Fassade"`

---

### Task 3: live-ui.js konvertieren (50 Refs)

**Files:**
- Modify: `src/live-ui.js`

- [ ] **Step 1: Bestand listen** — Grep wie Task 1 Step 1 auf `src/live-ui.js`.

- [ ] **Step 2: Konvertieren** — Muster wie Task 1; die großen Funktionen (updateLiveKPIs, updateLiveUi, drawLiveCharts, updateDiagnostics, renderStints) bekommen je ein `const k = activeKart();`. Achtung: `state.liveView`, `state.karts`, `state._kartHz`, `state.activeKartMac`, `state.sessionStart`, `state.hz`, `state.connection.source`-artige Stellen — `connection` ist Fassadenfeld (konvertieren), `liveView`/`hz`/`sessionStart` sind global (stehen lassen; `hz`/`sessionStart` tauchen im Step-1-Grep nicht auf — nur Treffer anfassen).

- [ ] **Step 3: Gates** — Grep -c → 0; eslint 0; `npm test` 189; `npm run test:e2e` 9 passed.

- [ ] **Step 4: Commit** — `git add src/live-ui.js && git commit -m "refactor(state): live-ui liest activeKart() statt Fassade"`

---

### Task 4: pit-wall.js konvertieren (33 Refs)

**Files:**
- Modify: `src/pit-wall.js`

- [ ] **Step 1: Bestand listen** — Grep wie Task 1 Step 1 auf `src/pit-wall.js`.

- [ ] **Step 2: Konvertieren** — Muster wie Task 1. Achtung: `buildRaceDataForKart(mac)` arbeitet bereits explizit per-Kart über `state.karts.get(mac)` — dortige Treffer sind vermutlich `state.connection`/`state.replay`-artige Aktiv-Kart-Reads im Pit-Wall-Overlay bzw. Connection-Tab; exakt die Step-1-Treffer konvertieren, buildRaceDataForKarts explizite `k`-Zugriffe NICHT umbauen.

- [ ] **Step 3: Gates** — Grep -c → 0; eslint 0; `npm test` 189; `npm run test:e2e` 9 passed.

- [ ] **Step 4: Commit** — `git add src/pit-wall.js && git commit -m "refactor(state): pit-wall liest activeKart() statt Fassade"`

---

### Task 5: recording.js konvertieren (110 Refs — größter Bestand)

**Files:**
- Modify: `src/recording.js`

- [ ] **Step 1: Bestand listen** — Grep wie Task 1 Step 1 auf `src/recording.js`.

- [ ] **Step 2: Konvertieren** — Muster wie Task 1. Die Replay-Maschinerie (`enterReplay`/`exitReplay`/`replayTick`/`snapshotReplayState`/`restoreReplayState`/`resetReplayDerived`/`feedReplayPacket`) liest/schreibt fast ausschließlich Aktiv-Kart-Felder (`state.replay`, `state.telemetry`, `state.charts`, `state.recording`, …): pro Funktion `const k = activeKart();`. WICHTIG: Snapshot/Restore kopieren GANZE Felder (`state.telemetry = {…}`) — das wird `k.telemetry = {…}` (Setter-Semantik identisch). `state.races`/`state.drivers`/`state.savedTracks`/`state.sectors`(global)/`state.activeTrackId` bleiben. `resetAttitudeClock()` bleibt wie es ist.

- [ ] **Step 3: Gates** — Grep -c → 0; eslint 0; `npm test` 189; `npm run test:e2e` 9 passed (der Replay-Roundtrip-Test IST das Verhaltens-Gate für dieses Modul).

- [ ] **Step 4: Commit** — `git add src/recording.js && git commit -m "refactor(state): recording/replay liest activeKart() statt Fassade"`

---

### Task 6: rasicross.js konvertieren (41 Refs)

**Files:**
- Modify: `src/rasicross.js`

- [ ] **Step 1: Bestand listen** — Grep wie Task 1 Step 1 auf `src/rasicross.js`.

- [ ] **Step 2: Konvertieren** — Muster wie Task 1, mit drei Sonderfällen:
  1. **saveData-Payload**: `calibration: state.calibration` / `engine: { totalMs: state.engine.totalMs, … }` → `calibration: activeKart().calibration` / `engine: { totalMs: activeKart().engine.totalMs, … }` (Legacy-Semantik „aktiver Kart" bleibt; Payload-FORM unverändert).
  2. **saveData-Guard** `if (state.replay && state.replay.active) return;` → `if (activeKart().replay.active) return;` (Bucket hat replay immer — der Null-Check entfällt).
  3. **processTelemetry** nutzt `kartFor(_mac)`-Zugriffe (`k.…`) — die sind bereits explizit und werden NICHT angefasst; nur die Step-1-Treffer außerhalb (Settings-UI-Reads wie `state.calibration.gxZero` in loadSettingsToUi/applySettings, Batterie-/G-View-Reads, `state.engine`-Warnpfad) konvertieren.

- [ ] **Step 3: Gates** — Grep -c → 0; eslint 0; `npm test` 189; `npm run test:e2e` 9 passed.

- [ ] **Step 4: Commit** — `git add src/rasicross.js && git commit -m "refactor(state): rasicross-Kern liest activeKart() statt Fassade (Payload-Form stabil)"`

---

### Task 7: Fassade entfernen + Guard-Test + e2e-Umstellung + Kart-Wechsel-Test

**Files:**
- Modify: `src/rasicross.js` (PER_KART_FIELDS + defineProperty-Loop), `e2e/replay.spec.js`, `e2e/karts.spec.js`
- Create: `test/facade-free.test.js`

**Interfaces:**
- Consumes: alle Tasks 1-6 abgeschlossen (repo-weiter Grep = 0 außerhalb der Fassaden-Definition selbst).
- Produces: `state` ohne die 27 dynamischen Properties; Guard-Test verankert.

- [ ] **Step 1: Fassade entfernen** — in `src/rasicross.js` (Region frisch lesen): den Kommentarblock „── Multi-Kart facade ──…", die `const PER_KART_FIELDS = […]`-Deklaration und den kompletten `for (const f of PER_KART_FIELDS) { Object.defineProperty(…) }`-Loop ersatzlos löschen. `activeKart()` und `kartFor()` bleiben unverändert stehen.

- [ ] **Step 2: Guard-Test** — `test/facade-free.test.js` (neu):

```js
// Guard (Phase 43): die Aktiv-Kart-Fassade ist entfernt -- state.<feld>
// fuer per-Kart-Felder waere still undefined. Dieser statische Scan
// verhindert Rueckfaelle dauerhaft (Kommentare zaehlen mit: auch dort
// sind die alten Pfade irrefuehrend).
import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = path.join(fileURLToPath(new URL('.', import.meta.url)), '..', 'src');
const PER_KART_FIELDS = ['connection','telemetry','raw','display','gps','spdSrc',
  'batt','max','charts','imu','drift','attitude','driftSmooth','heatmap','lapStart',
  'currentLapMax','currentLapTrace','bestLapTrace','bestLapMs','bestLapNum','liveDelta',
  'autoLap','sectorsLive','sectorsBest','recording','replay','calibration','engine'];
const RE = new RegExp('\\bstate\\.(' + PER_KART_FIELDS.join('|') + ')\\b');

test('facade-free: kein src-Modul liest state.<per-Kart-Feld>', () => {
  const offenders = [];
  for (const f of fs.readdirSync(SRC).filter(n => n.endsWith('.js'))) {
    const lines = fs.readFileSync(path.join(SRC, f), 'utf8').split(/\r?\n/);
    lines.forEach((line, i) => { if (RE.test(line)) offenders.push(`${f}:${i + 1}: ${line.trim()}`); });
  }
  assert.deepStrictEqual(offenders, []);
});
```

Run: `node --test test/facade-free.test.js` → PASS (Tasks 1-6 haben alles konvertiert; jeder Treffer wird mit Datei:Zeile gemeldet).

- [ ] **Step 3: e2e/replay.spec.js umstellen** — die drei `RasiTest.state.replay.*`-Stellen (frisch lesen) werden `RasiTest.activeKart().replay.*`:

```js
  await page.waitForFunction(() => RasiTest.activeKart().replay.active === true);
  await page.waitForFunction(() => RasiTest.activeKart().replay.virtualMs > 0, null, { timeout: 10000 });
  expect(await page.evaluate(() => RasiTest.activeKart().replay.active)).toBe(false);
```

- [ ] **Step 4: Kart-Wechsel-Gate-Test** — in `e2e/karts.spec.js` als vierter Test anhängen (Kalibrier-Marker, deterministisch):

```js
test('Kart-Wechsel waehrend laufendem Rennen aendert keine Bucket-Daten', async () => {
  await startDemo();
  // startDemo() legt ein laufendes Demo-Race an (Auto-Arm-Flow, Phase 41/42).
  await page.waitForFunction(() => {
    const r = RasiTest.activeRace();
    return !!r && r.status === 'running';
  });
  const [macA, macB] = await page.evaluate(() => RasiTest.state.karts.macs().slice(0, 2));
  // Marker auf Kart A (aktiv) setzen, dann auf B wechseln.
  await page.evaluate(() => { RasiTest.activeKart().calibration.gxZero = 0.11; });
  await page.evaluate((mac) => {
    RasiTest.state.karts.setActive(mac);
    RasiTest.state.activeKartMac = mac;
  }, macB);
  // (a) B traegt den Marker NICHT, (b) A's Bucket traegt ihn unveraendert.
  const probe = await page.evaluate(([a, b]) => ({
    activeGx: RasiTest.activeKart().calibration.gxZero,
    aGx: RasiTest.state.karts.get(a).calibration.gxZero,
    bIsActive: RasiTest.state.karts.activeMac() === b,
  }), [macA, macB]);
  expect(probe.bIsActive).toBe(true);
  expect(probe.activeGx).not.toBe(0.11);
  expect(probe.aGx).toBe(0.11);
  // (c) Rueckwechsel: activeKart() liefert wieder A's Marker.
  await page.evaluate((mac) => {
    RasiTest.state.karts.setActive(mac);
    RasiTest.state.activeKartMac = mac;
  }, macA);
  expect(await page.evaluate(() => RasiTest.activeKart().calibration.gxZero)).toBe(0.11);
  expect(errors).toEqual([]);
});
```

- [ ] **Step 5: Gates** — `npm test` → **190/190** (189 + Guard); `npm run lint` → 0; `npm run test:e2e` → **10 passed**. Bei Smoke-Rot: `state.<feld>`-Rückstand suchen (`node --test test/facade-free.test.js` zeigt Datei:Zeile) bzw. Konsolen-Fehler des Specs lesen — NICHT die Fassade zurückbauen.

- [ ] **Step 6: Commit**

```bash
git add src/rasicross.js test/facade-free.test.js e2e/replay.spec.js e2e/karts.spec.js
git commit -m "refactor(state): Aktiv-Kart-Fassade entfernt -- activeKart()-Selektor einzige Lesart, Guard-Test + Kart-Wechsel-Smoke"
```

---

### Task 8: Finale Gates, Plan-Doc, Push + PR

- [ ] **Step 1: Komplettes Rezept** — `npm test` 190/190; `npm run lint` 0; `npm run test:e2e` 10 passed; `node --check main.js preload.js tiles.js`; Python: `python -m py_compile sender.py bridge.py esp_libs/*.py` + `python -m unittest discover -s test -p "test_*.py"` (56); repo-weiter Grep `\bPER_KART_FIELDS\b` → nur noch test/facade-free.test.js.
- [ ] **Step 2:** `__pycache__` löschen; `graphify update .`; Plan-Doc committen (`docs(plan): Phase 43 State-Redesign Implementierungsplan`); Push; PR gegen `main` mit Gate-Nachweisen + Pflicht-Fußzeile. **Nach dem Merge sofort prüfen: `git merge-base --is-ancestor <head> origin/main`** (Lehre aus Phase 46).

---

## Hardware/Manual Acceptance Checklist (User)

- [ ] GitHub Actions grün (js/python/smoke/Build).
- [ ] Portable-EXE: Kart-Wechsel über Chip-Leiste/Karts-Tab während Demo-Rennen — Rundenzeiten, Charts, G-Meter und Replay je Kart bleiben getrennt und korrekt.
- [ ] Bestehende SAVE_KEY-Daten + alte .ndjson-Recordings laden/spielen unverändert.

## Self-Review

- **Spec-Coverage:** „Fassadenfelder einzeln entfernen" → Task 7 (nach vollständiger Konvertierung 1-6); „Lesestellen auf Selektor" → Tasks 1-6 (309 Refs, per Grep-Orakel datei-genau); „Sync-Codepfade löschen" → in dieser Codebasis IST die Fassade der Sync-Pfad (defineProperty-Delegation, keine Kopien mehr seit Phase 39) — ihr Entfall in Task 7 erfüllt den Spec-Punkt; Gate-Test (Kart-Wechsel/Bucket-Integrität) → Task 7 Step 4; Persistenz formatstabil → Task 6 Sonderfall 1.
- **Risiken verankert:** stilles `undefined` nach Fassaden-Entfall (Guard-Test + Grep-Gates statt ESLint), Hot-Path-Konvention (ein activeKart() pro Funktionsaufruf, kein Top-Level-Cache), e2e-Bruch bei replay.spec (Task 7 Step 3), Legacy-Payload-Semantik (Task 6), timing-freier Gate-Test (Kalibrier-Marker statt Laufdaten).
- **Typ-Konsistenz:** Feldliste identisch in Global Constraints, Grep-Kommandos und Guard-Test (27 Felder, wortgleich aus rasicross.js PER_KART_FIELDS übernommen).
- **Platzhalter-Scan:** Konvertierungs-Tasks arbeiten bewusst per Grep-Bestandsliste statt abgeschriebener 309-Zeilen-Tabelle (mechanisch verifizierbar, Vorgehen wie Phase 42); Guard-Test, e2e-Diffs und der neue Gate-Test stehen als vollständiger Code im Plan.

## Phase Map

- Phase 42 (Vite+ESM) + Phase 46 (Karts-Tab): gemerged (#66, #68).
- **Phase 43 (dieser Plan): State-Redesign.**
- Phase 44 (rasicross-Zerlegung): direkt danach — profitiert von der fassadenfreien Lesart (store.js wird trivial extrahierbar).
- Phase 45 (Firmware): unabhängig, Hardware-Gate.
