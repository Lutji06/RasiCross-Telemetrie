# Phase 24: Race-Day-Quick-Wins (Crash-Aufnahme / Theoretische Bestrunde / RSSI-Sparkline / Drift-Hangkompensation) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Vier vom User beauftragte Features: (1) crash-sichere Aufnahme (NDJSON-Stream auf Platte via Electron-Main, Recovery beim nächsten Start), (2) theoretische Bestrunde (Summe der Sektor-Bests, Live-Sektorpanel + Pit-Wall), (3) RSSI-Sparkline im Verbindungs-Tab, (4) hangkompensierte Drift-Erkennung (Schwerkraftanteil aus der Quer-g via fusioniertem Rollwinkel) + Hinweis am „Roll nullen"-Button.

**Architecture:** Keine neuen Dateien. (1) Neues IPC-Trio main.js↔preload.js↔rasicross.js (`rasi-rec:*`, Muster wie `rasi-kart:*`); `before-quit` löscht die Crash-Datei → liegt sie beim Start noch da, war es ein Absturz. (2+3) reine Anzeige-Erweiterungen in track.js/pit-wall.js + HTML. (4) pure Funktion `tiltCompLatG` in drift.js (TDD, node:test), angewendet an den **Analyze-Aufrufstellen** — NICHT in `driftInputs()`, weil `rollStep()` dieselbe unkompensierte Quer-g als Gravitationsreferenz braucht (sonst Rückkopplung). Replay-Aggregat bekommt eine Roll-Vorfusion (`fusedRolls`, refaktoriert aus `rolloverOnsets`).

**Tech Stack:** Electron IPC (contextBridge/ipcMain.handle), Vanilla JS classic scripts, node:test, ESLint flat config.

---

## Working Directory & Conventions

- Working Directory: `C:\Users\jimlu\Documents\RasiCross-Telemetrie-git`.
- Branch: **`feat/race-day-quickwins`**, abgezweigt von `feat/settings-menu-redesign`.
- CRLF-Dateien; vor jedem Edit Zielregion frisch lesen, Anker sind Text. Grep-Tool für Verifikation.
- **Lint-Fix-Regel** wie Phase 22/23 (genau den gemeldeten Namen in die richtige Globals-Liste; Kern-Helfer → `appCoreGlobals`; nur-extern-genutzte rasicross-Funktionen → void-Marker).
- Verifikation pro Task: `node --check` auf geänderte JS, `npm run lint`, `npm test`. Final zusätzlich Python-Suite + CDP-Smoke (Treiber liegt unter `C:\Users\jimlu\AppData\Local\Temp\rasicross-smoke\`).
- **Baselines:** `npm test` = 107 pass (steigt durch Task 4 auf >107), unittest = 38 OK, lint leer, node --check leer.
- Commits conventional + Trailer `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

## Locked Decisions

1. **Crash-Datei-Semantik:** `userData/crash-recording.ndjson`. `armRecording()` beginnt sie frisch (Header-Zeile via `RasiReplay.serializeRecording([], …)`), `recordPacket()` puffert NDJSON-Zeilen und flusht alle ≥25 Pakete oder ≥2s (fire-and-forget invoke). `app.on('before-quit')` löscht sie → reguläres Beenden hinterlässt nichts; nach Absturz bietet `init()` Recovery per `rcConfirm` an (laden → `enterReplay`, sonst löschen). Browser ohne `window.rasiRec`: alles no-op.
2. **Recovery lädt ins Replay**; damit der User die Daten danach auch als NDJSON sichern kann, speichert `saveRecording()` künftig im Replay-Modus `state.replay.packets` (analog `exportRecordingCsv`).
3. **Größenschutz:** Main bricht Appends über 256 MB ab (`{ok:false,error:'limit'}`); Renderer zeigt dann einmalig einen Toast und stellt das Streamen ein (RAM-Puffer läuft normal weiter).
4. **Theoretische Bestrunde** = `state.sectors.best[0]+[1]+[2]`, nur wenn alle drei existieren; Anzeige als Vollbreite-Zeile im Sektor-Panel (grid-column:1/-1) + `pw-side-sub`-Zeile im Pit-Wall. Helper `theoreticalBestMs()` in laps-drivers.js (Sektor-/Runden-Domäne).
5. **RSSI-Sparkline:** 1Hz-Historie (max 180 Werte ≈ 3 min) gepusht in `renderConnectionTab()` (läuft im 1Hz-Loop), Canvas in der „Verbindungsqualität"-Karte, Skala −100…−30 dBm, Zeichnung nach dem Muster `drawYawSparkline`. Kein Persist.
6. **Drift-Kompensation immer aktiv** (Korrektur, kein Feature-Flag): live `RasiDrift.analyze({...di, latAccel: tiltCompLatG(di.latAccel, state.attitude.rollDeg)})`; Replay-Aggregat kompensiert pro Paket mit vorfusioniertem Roll (`fusedRolls`). Vorzeichen-Konsistenz ist konstruktionsbedingt: `rollStep` fusioniert Roll aus derselben (kalibrierten) gy → statisch gilt gy = sin(roll).
7. **`driftInputs()` bleibt unverändert** (2 Parameter) — Kompensation ausschließlich an den Analyze-Stellen (siehe Architecture).
8. **Kein Unit-Test für DOM-/IPC-Glue** (Projektkonvention); `tiltCompLatG` und `fusedRolls`-Verhalten via bestehende pure-Module-Suiten (drift.test.js) bzw. Smoke.

## File Structure

| Action | Path | Responsibility |
| --- | --- | --- |
| Modify | `main.js` | IPC `rasi-rec:start/append/check/read/clear`, `before-quit`-Cleanup, 256-MB-Limit |
| Modify | `preload.js` | `window.rasiRec` (contextBridge) |
| Modify | `rasicross.js` | Crash-Queue + Flush in Sektion 7, Recovery in `init()`, Drift-Analyze-Stelle kompensieren |
| Modify | `recording.js` | `saveRecording` im Replay, `fusedRolls`-Refactor, Replay-Drift-Aggregat kompensieren |
| Modify | `drift.js` | `tiltCompLatG` (pure, exportiert) |
| Modify | `laps-drivers.js` | `theoreticalBestMs()` |
| Modify | `track.js` | Sektor-Panel-Zeile setzen |
| Modify | `pit-wall.js` | Pit-Wall-Zeile, RSSI-Historie + `drawRssiSparkline()` |
| Modify | `RasiCross_Telemetry.html` | Theo-Zeile im Sektorpanel, Pit-Wall-Zeile, RSSI-Canvas, zeroRoll-Hinweis |
| Modify | `test/drift.test.js` | TDD-Tests `tiltCompLatG` |
| Modify | `eslint.config.js` | nur falls Lint-Loop Namen meldet (z.B. `theoreticalBestMs` in lapsDriversGlobals) |

Task-Reihenfolge: 0 → 1 (Crash) → 2 (Theo) → 3 (RSSI) → 4 (Drift, TDD) → 5 (Hinweis + Final-Verify + Smoke).

---

### Task 0: Branch + Plan-Doc

- [ ] `git checkout -b feat/race-day-quickwins` (von feat/settings-menu-redesign), Plan-Doc committen (`docs: Plan Phase 24 (Race-Day-Quick-Wins)`).

### Task 1: Crash-sichere Aufnahme

- [ ] **1.1 main.js** — nach dem `rasi-kart:clear`-Handler einfügen (Pfad-Helper + 5 Handler + before-quit; Code siehe Architecture/Decision 1+3; `recCrashPath()` = `path.join(app.getPath("userData"), "crash-recording.ndjson")`).
- [ ] **1.2 preload.js** — `rasiRec`-Bridge (start/append/check/read/clear) nach dem `rasiKart`-Block.
- [ ] **1.3 rasicross.js Sektion 7** — vor `armRecording()`: Konstanten `REC_FLUSH_N=25, REC_FLUSH_MS=2000`, `_crashQ/_crashLastFlush/_crashFailed`, `_crashFlush(now)`; in `armRecording()` Crash-Datei frisch starten (Header via `RasiReplay.serializeRecording([], {created})` erste Zeile); in `recordPacket()` nach `pushCapped`: Zeile queueen + Flush-Bedingung.
- [ ] **1.4 rasicross.js init()** — Recovery-Block (check → ≥1 KB → rcConfirm mit Datum+Größe → read → `RasiReplay.parseRecording` → `enterReplay` → clear; Ablehnen → clear). `formatBytes` für die Größe.
- [ ] **1.5 recording.js** — `saveRecording()`: `const buf = state.replay.active ? state.replay.packets : state.recording.buf;` (Decision 2).
- [ ] **1.6 Verify** — node --check main/preload/rasicross/recording, lint (Loop), npm test 107. **1.7 Commit** `feat(recording): crash-sichere Aufnahme via Main-Prozess-Stream`.

### Task 2: Theoretische Bestrunde

- [ ] **2.1 laps-drivers.js** — `theoreticalBestMs()` (Decision 4) vor dem Interface-Marker; Marker + ggf. `lapsDriversGlobals` ergänzen.
- [ ] **2.2 HTML** — im `sectorPanel` nach der `s3Card`-Zeile: `<div style="grid-column:1/-1;…" >Theoretische Bestrunde <b id="theoBestTime">--:--.---</b></div>`; im Pit-Wall nach der `pwBestLap`-Zeile: `<div class="pw-side-sub">Theoretisch <b id="pwTheoLap">--:--.---</b></div>`.
- [ ] **2.3 track.js** — Ende `updateSectorPanel()`: Wert setzen. **2.4 pit-wall.js** — `updatePitWall()` nach pwBestLap: Wert setzen.
- [ ] **2.5 Verify + Commit** `feat(sectors): theoretische Bestrunde im Sektorpanel + Pit-Wall`.

### Task 3: RSSI-Sparkline

- [ ] **3.1 HTML** — Canvas `rssiSpark` (Vollbreite, h=36) in der „Verbindungsqualität"-Karte unter der Flex-Zeile.
- [ ] **3.2 pit-wall.js** — `RSSI_HIST_MAX=180`, `_rssiHist`, `drawRssiSparkline()` (Skala −100…−30, Linie + Füllung, Muster drawYawSparkline); in `renderConnectionTab()` Push + Draw.
- [ ] **3.3 Verify + Commit** `feat(connection): RSSI-Sparkline (3-min-Verlauf)`.

### Task 4: Drift-Hangkompensation (TDD)

- [ ] **4.1 Test zuerst** — `test/drift.test.js`: `tiltCompLatG(0.342, 20) ≈ 0` (±0.01), `(0.5, 0) === 0.5`, `(0, -15) ≈ +0.2588`, `(0.3, undefined) === 0.3`, `(0.3, NaN) === 0.3`. `npm test` → rot (Funktion fehlt).
- [ ] **4.2 drift.js** — `tiltCompLatG(latG, rollDeg)` (Decision 6, mit Vorzeichen-Kommentar) + Export. `npm test` → grün.
- [ ] **4.3 rasicross.js live** — Analyze-Stelle in `processTelemetry` (Region um `RasiDrift.analyze` frisch lesen): latAccel durch `RasiDrift.tiltCompLatG(di.latAccel, state.attitude.rollDeg)` ersetzen — `rollStep` weiter mit **unkompensiertem** `di.latAccel` füttern!
- [ ] **4.4 recording.js Replay** — `rolloverOnsets` refaktorieren: Roll-Fusion in `fusedRolls(packets, cal)` herausziehen (Array der Rollwinkel je Paket), `rolloverOnsets` nutzt sie; `enterReplay`-`_calPk` kompensiert `gy` pro Paket mit `_rolls[i]`.
- [ ] **4.5 Verify** — npm test (>107, alle grün), lint, node --check. **4.6 Commit** `feat(drift): hangkompensierte Quer-g (gy - sin(roll))`.

### Task 5: zeroRoll-Hinweis + Abschluss

- [ ] **5.1 HTML** — `zeroRollBtn`-title erweitern („… Mäher dazu auf **ebener Fläche** abstellen") + sichtbaren Kurzhinweis in der Settings-Zeile, falls Layout es hergibt (Region lesen).
- [ ] **5.2 Komplett-Verify** — node --check alle App-JS, lint, npm test, Python-Suite, `__pycache__` weg, git status sauber.
- [ ] **5.3 CDP-Smoke** — App starten, Demo laufen lassen: keine Konsolen-Fehler; nach 2+ Runden `theoBestTime` ≠ '--:--.---'; `rssiSpark`-Canvas nicht leer (Pixel-Check via toDataURL-Länge oder Historie >10); Drift-Badge weiterhin plausibel; `crash-recording.ndjson` existiert und wächst während der Demo (rasiRec.check über Konsole); App regulär beenden → Datei weg.
- [ ] **5.4 Commit** `docs(settings): Hinweis ebene Flaeche am Roll-nullen-Button` (falls eigener Commit nötig) — Push nur nach User-Freigabe.

## Manual Acceptance (User, deferred)

- [ ] Hardware-Lauf: Aufnahme starten, Stecker ziehen/App killen → Neustart bietet Wiederherstellung an, Replay zeigt die Daten, „Aufnahme speichern" liefert NDJSON.
- [ ] Hangfahrt: Drift-Badge bleibt bei Geradeausfahrt am Hang auf Grip/–.
- [ ] RSSI-Sparkline zeigt Funkloch-Dellen beim Strecken-Umrunden.

## Self-Review

- Kompensations-Rückkopplung (rollStep braucht rohe gy) ist als Locked Decision 6/7 gebannt; Replay nutzt dieselbe Mathematik via fusedRolls → Live/Replay konsistent.
- Recovery-UX deckt Ablehnen (clear), kaputte Datei (clear + Alert) und Browser (kein rasiRec) ab; before-quit macht False-Positives beim regulären Beenden unmöglich.
- Alle IDs (`theoBestTime`, `pwTheoLap`, `rssiSpark`) neu → keine Kollisionen (gegrept).
