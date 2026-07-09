# Phase 44 — rasicross.js zerlegen Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** rasicross.js (~1660 Zeilen) wird entlang seiner heutigen Abschnitte in `store.js`, `telemetry.js`, `esp-config.js`, `settings-ui.js` und `app-init.js` zerlegt; danach ist keine App-Datei über ~500 Zeilen — und es wird NUR Code bewegt, nicht geändert.

**Architecture:** rasicross.js bleibt als schlanker Hub bestehen (Utilities, Dialoge, Audio, Tabs/Theme, bridgeSend) und **re-exportiert** alles Verschobene (`export { … } from './store.js'` usw.) — dadurch bleiben die Import-Zeilen aller 10 Konsumenten-Module und der e2e-/Test-Stand wortwörtlich unverändert, was das Spec-Gate „nur Code bewegt, nicht geändert" mechanisch nachprüfbar macht (`git diff --color-moved`). Zyklen Hub ⇄ neue Module sind deklarationsrein (etablierte Konvention).

**Tech Stack:** Bestehender Stack; keine neuen Dependencies. ESLint ist wieder volles Orakel (fehlender Import = no-undef).

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-06-technical-redesign-program-design.md`, Abschnitt „Phase 44".
- **Gate:** Smoke-Suite grün (10 passed) + Diff-Review „nur Code bewegt, nicht geändert" + `npm test` 190/190 + `npm run lint` 0 + **Zeilen-Gate**: keine Datei unter `src/` über ~500 Zeilen (Messung `(Get-Content <f> | Measure-Object -Line).Lines`; harte Grenze 520 — darüber ist der Schnitt falsch gesetzt).
- **Nur Code bewegen:** Funktions-/Konstanten-Bodies byte-identisch übernehmen (nur CRLF beibehalten). Erlaubte Nicht-Bewegungs-Änderungen sind AUSSCHLIESSLICH: (a) neue Import-/Export-Blöcke der neuen Module, (b) Re-Export-Zeilen im Hub, (c) je Datei ein kurzer Kopf-Kommentar, (d) gelöschte alte Abschnitts-Kommentare am Ursprungsort. Keine Umbenennungen, keine Formatierung, keine „Gelegenheits-Fixes".
- Verhaltens-/Format-Stabilität wie immer: `SAVE_KEY`, `REC_VERSION` 9.6, serielles Protokoll, Python unangetastet.
- `test/facade-free.test.js` scannt src/ rekursiv — die neuen Module fallen automatisch unter den Guard.

## Working Directory & Conventions

- Branch `feat/phase-44-rasicross-split` **gestapelt auf `feat/phase-43-state-redesign`** (PR #69 offen). MERGE-REIHENFOLGE-WARNUNG (Lehre Phase 46): erst #69 mergen, dann prüfen, dass der 44er-PR auf main retargetet ist (`gh pr view --json baseRefName`), erst dann 44 mergen; nach jedem Merge `git merge-base --is-ancestor <head> origin/main`.
- CRLF; Regionen vor jedem Edit frisch lesen; Zeilennummern im Plan sind Momentaufnahmen (Task-Reihenfolge verschiebt sie!). Niemals `.claude/`, `CLAUDE.md`, `graphify-out/` committen. Commit-Trailer Pflicht.
- **Move-Verifikation pro Task:** `git diff --color-moved=dimmed-zebra HEAD~1` — bewegte Blöcke erscheinen gedimmt; jede NICHT gedimmte Inhaltszeile außerhalb der erlaubten Kategorien (Imports/Exports/Kopf-Kommentare) ist ein Fehler. Zusätzlich `npm test` + `npx eslint src/` nach jedem Task; `npm run test:e2e` (9? nein: 10 passed) nach jedem Task.

## Locked Decisions

- **Hub-Muster:** rasicross.js behält seinen Dateinamen und re-exportiert jede verschobene öffentliche API namensgleich (`export { state, activeKart, … } from './store.js';`). Konsumenten (`from './rasicross.js'`) bleiben unangetastet — das ist Teil des „nur bewegt"-Gates. Direkt-Importe zwischen den NEUEN Modulen sind erlaubt und erwünscht (z. B. telemetry → esp-config), um Hub-Umwege zu vermeiden.
- **Fünftes Modul `settings-ui.js`:** Die Spec nennt vier Module; ohne Herauslösen des Settings-Abschnitts (heute ~230 Zeilen) bleibt aber entweder der Hub oder app-init über 500 Zeilen. `settings-ui.js` folgt derselben Logik („entlang der heutigen Abschnitte" — Abschnitt 6) und wird im PR als begründete Ergänzung dokumentiert.
- **Zuordnung (verbindlich, nach heutigem Stand der Datei):**
  - `store.js` ← Abschnitt 1+3: `SAVE_KEY`-Konstante, `state`-Objekt, `activeKart`, `kartFor`, `_saveTimer`, `_quotaWarned`, `_persistedKarts`, `_demoMeta`, `rasiPersistForget`, `kartMetaFor`, `updateKartMeta`, `kartRosterMacs`, `kartCalFor`, `kartEngineFor`, `PERSIST_TRACE_MAX`+`_persistRace`, `saveData`, `saveDataDebounced`, `loadData`, `migrateLegacyKartMeta`, `window.addEventListener('beforeunload', saveData)`.
  - `telemetry.js` ← Abschnitt 7 (Kern): `_crashQ`/`_crashLastFlush`/`_crashFailed`, `_crashFlush`, `armRecording`, `recordPacket`, `driftInputs`, `_maxKartsToasted`, `processTelemetry`.
  - `esp-config.js` ← `ESP_CFG_FIELDS`, `_espAckTimer`, `applyEspConfigAck` (telemetry.js importiert `applyEspConfigAck` direkt).
  - `settings-ui.js` ← Abschnitt 6 ohne `formatBytes` (bleibt Utility im Hub): `applyTilesPresetFromUrl`, `onTilesPresetChanged`, `updateTilesUrlHint`, `onTilesClearClicked`, `showSettingsGroup`, `loadSettingsToUi`, `_settingsSaveTimer`/`_flashTimerId`, `flashSettingsSaved`, `scheduleSettingsSave`, `saveSettingsFromUi`, `initUpdateUi`.
  - `app-init.js` ← 3D-/Boot-Block + Init: `_kart3dReady`/`_kart3dLastTick`/`_attLastMs`, `kart3dIsReady`, `kart3dTickDt`, `resetAttitudeClock`, `initGViewToggle`, `applyGView`, `initKartModelUploader`, `init()`, der DOMContentLoaded-IIFE am Dateiende. **Achtung:** `resetAttitudeClock`/`_attLastMs` werden vom Telemetrie-Pfad genutzt (Attitude-Fusion in processTelemetry) — prüfen, wo `_attLastMs` gelesen/geschrieben wird: die Fusions-Zeilen in processTelemetry brauchen Zugriff → `_attLastMs` samt Accessoren gehört dann in `telemetry.js`, nicht app-init (beim Umsetzen anhand Grep entscheiden, Ziel: keine let-Variable wird über Modulgrenzen direkt beschrieben; notfalls bestehende Accessor-Muster nutzen).
  - Hub `rasicross.js` behält: `$`, `css`, `dpr`, `uid`, `esc`, `setText`, `setTextShared`, `setHtmlShared`, `logTime`, `formatBytes`, `bridgeSend`+`window.rasiBridgeSend`, Dialoge (`rcAlert`, `rcConfirm`, `rcToast`, `_toastTimer`), `rcAudio`, `setupTabs`, `applyTheme`, `toggleTheme` + alle Re-Exports.
- **Import-Orakel:** pro neuem Modul `npx eslint src/<datei>.js` — jedes no-undef = fehlender Import. Der Hub importiert die neuen Module NICHT pauschal; Re-Export-Syntax (`export { x } from './store.js'`) genügt und erzeugt keine unused-Warnungen.
- **Reihenfolge:** store → telemetry+esp-config → settings-ui → app-init → Zeilen-/Final-Gates. app-init zuletzt, weil init() Funktionen aus allen anderen bindet.

## File Structure

| Action | Path | ca. Zeilen | Task |
|---|---|---|---|
| Create | `src/store.js` | ~320 | 1 |
| Create | `src/esp-config.js` | ~35 | 2 |
| Create | `src/telemetry.js` | ~300 | 2 |
| Create | `src/settings-ui.js` | ~250 | 3 |
| Create | `src/app-init.js` | ~470 | 4 |
| Modify | `src/rasicross.js` | Hub ~350 | 1-4 |
| Commit | dieses Plan-Doc | — | 5 |

---

### Task 1: `store.js` extrahieren + Hub-Re-Exports

**Files:**
- Create: `src/store.js`
- Modify: `src/rasicross.js`

**Interfaces:**
- Produces: `src/store.js` mit benannten Exports `{ SAVE_KEY, state, activeKart, kartFor, rasiPersistForget, kartMetaFor, updateKartMeta, kartRosterMacs, kartCalFor, kartEngineFor, saveData, saveDataDebounced, loadData, migrateLegacyKartMeta }`; rasicross.js re-exportiert exakt diese Namen (`export { … } from './store.js';`) — Konsumenten unverändert.

- [ ] **Step 1:** Die Locked-Decision-Blöcke für store.js aus rasicross.js ausschneiden (Regionen frisch lesen; Bodies byte-identisch) und in `src/store.js` einfügen. Kopf-Kommentar (neu):

```js
// ============================================================
//  RasiCross — store.js  (State + Persistenz, Phase 44)
//  Herausgeloest aus rasicross.js — NUR bewegt, nicht geaendert.
//  state/Buckets sind die einzige Quelle der Wahrheit (Phase 43).
// ============================================================
```

- [ ] **Step 2:** Import-Block von store.js per ESLint-Orakel aufbauen (erwartet u. a.: `KartRegistry`, `RasiKartRoster`, `RasiLapEngine` (loadData-Migration), aus dem Hub `{ setText, logTime, rcAlert }` (saveData-Statuszeile/Quota), ggf. weitere — Orakel entscheidet). Export-Block ans Dateiende (Liste oben).
- [ ] **Step 3:** In rasicross.js an der Stelle des entfernten Persistenz-Abschnitts einfügen: `export { SAVE_KEY, state, activeKart, kartFor, rasiPersistForget, kartMetaFor, updateKartMeta, kartRosterMacs, kartCalFor, kartEngineFor, saveData, saveDataDebounced, loadData, migrateLegacyKartMeta } from './store.js';` — und dieselben Namen aus dem alten Export-Block am Dateiende STREICHEN (sonst doppelt). rasicross' eigene Verwendungen der bewegten Namen (init() ruft loadData/migrateLegacyKartMeta/saveData; processTelemetry nutzt kartFor …) brauchen einen normalen Import: `import { state, activeKart, kartFor, saveData, saveDataDebounced, loadData, migrateLegacyKartMeta, kartMetaFor } from './store.js';` (Orakel verfeinert).
- [ ] **Step 4: Gates** — `npx eslint src/` 0; `npm test` 190/190; `npm run test:e2e` 10 passed; `git diff --color-moved=dimmed-zebra HEAD` prüfen: Bodies gedimmt (bewegt), nur Import/Export/Kommentar-Zeilen hell.
- [ ] **Step 5: Commit** — `git add src/store.js src/rasicross.js && git commit -m "refactor(split): store.js -- State + Persistenz aus rasicross.js herausgeloest (nur bewegt)"`

---

### Task 2: `esp-config.js` + `telemetry.js` extrahieren

**Files:**
- Create: `src/esp-config.js`, `src/telemetry.js`
- Modify: `src/rasicross.js`

**Interfaces:**
- Produces: `esp-config.js` exportiert `{ ESP_CFG_FIELDS, applyEspConfigAck }`; `telemetry.js` exportiert `{ armRecording, recordPacket, driftInputs, processTelemetry }` (+ `resetAttitudeClock`, falls `_attLastMs` hierher gehört — siehe Locked Decision, per Grep entscheiden und im Report dokumentieren). Hub re-exportiert `armRecording, driftInputs, processTelemetry, applyEspConfigAck, resetAttitudeClock` namensgleich.

- [ ] **Step 1:** `grep -n "_attLastMs" src/rasicross.js` — liegt die Attitude-Fusion (Schreib-/Lesestellen) in processTelemetry, wandern `let _attLastMs` + `resetAttitudeClock` mit nach telemetry.js; `kart3dIsReady`/`kart3dTickDt`/`_kart3dReady`/`_kart3dLastTick` bleiben für app-init (Task 4) liegen. Falls initGViewToggle & Co. `_attLastMs` NICHT anfassen, ist die Trennung sauber — sonst Accessor-Muster (wie Phase 42/46) verwenden und im Report begründen.
- [ ] **Step 2:** esp-config.js anlegen (ESP_CFG_FIELDS, _espAckTimer, applyEspConfigAck; Kopf-Kommentar analog Task 1; Orakel-Imports — erwartet `{ setText }` o. ä. aus dem Hub, `{ state }` aus store). telemetry.js anlegen (Crash-Q, armRecording, recordPacket, driftInputs, _maxKartsToasted, processTelemetry; Orakel-Imports — erwartet u. a. `{ state, kartFor, activeKart, saveDataDebounced, kartMetaFor }` aus store, `{ setText, rcToast, logTime, bridgeSend? }` aus Hub, `{ applyEspConfigAck }` aus esp-config, Objekt-Module RasiDrift/RasiAttitude/RasiEngine/RasiLapEngine/KartRegistry/DomTargets…, UI-Funktionen (checkLapCrossing, onGpsUpdate, updateRecStatus, pushPacketLog, renderConnectionTab, RasiKartBar …) aus ihren Modulen — exakt wie bisher in rasicross importiert; die rasicross-Import-Zeilen entsprechend erleichtern, wenn der Hub sie nicht mehr braucht (Orakel/no-unused-vars)).
- [ ] **Step 3:** Hub: Re-Export-Zeilen einfügen, alte Export-Block-Einträge streichen, eigene Verwendungen importieren (init bindet armRecording? — Orakel).
- [ ] **Step 4: Gates** wie Task 1 (eslint 0, 190/190, 10 passed, color-moved-Prüfung).
- [ ] **Step 5: Commit** — `refactor(split): telemetry.js + esp-config.js aus rasicross.js herausgeloest (nur bewegt)`

---

### Task 3: `settings-ui.js` extrahieren

**Files:**
- Create: `src/settings-ui.js`
- Modify: `src/rasicross.js`

**Interfaces:**
- Produces: Exports `{ applyTilesPresetFromUrl, onTilesPresetChanged, updateTilesUrlHint, onTilesClearClicked, showSettingsGroup, loadSettingsToUi, flashSettingsSaved, scheduleSettingsSave, saveSettingsFromUi, initUpdateUi }`; Hub re-exportiert namensgleich (Konsumenten: app-init/init() in Task 4, ggf. andere — Grep).

- [ ] **Step 1:** Abschnitt-6-Funktionen (Liste Locked Decisions, OHNE formatBytes) nach settings-ui.js bewegen; Kopf-Kommentar; Orakel-Imports (erwartet: `{ state, activeKart, saveData, saveDataDebounced }` aus store, `{ $, setText, rcAlert, rcConfirm, rcToast, formatBytes, esc? }` aus Hub, `RasiSettings`, `RasiTileRenderer`, `drawTrack`/`renderSavedTracks` aus map-draw/track, `bridgeSend`? …).
- [ ] **Step 2:** Hub: Re-Exports + Export-Block bereinigen + eigene Imports.
- [ ] **Step 3: Gates** wie Task 1. **Commit** — `refactor(split): settings-ui.js aus rasicross.js herausgeloest (nur bewegt)`

---

### Task 4: `app-init.js` extrahieren (Boot zuletzt)

**Files:**
- Create: `src/app-init.js`
- Modify: `src/rasicross.js`, `src/app.js`

**Interfaces:**
- Produces: app-init.js enthält `init()`, DOMContentLoaded-IIFE, GView/KartModel/kart3d-Block und exportiert `{ kart3dIsReady, kart3dTickDt }` (Konsument gauges via Hub-Re-Export) — sonst nichts (Boot läuft als Seiteneffekt beim Import, exakt wie bisher in rasicross: Top-Level-`init()`-Aufruf mitbewegen!).
- Consumes: alles aus Tasks 1-3 + UI-Module (Import-Zeilen aus dem heutigen rasicross-Importblock mitnehmen, soweit init sie bindet).

- [ ] **Step 1:** Block 3D/GView/Uploader + `init()` + Top-Level-`init();`-Aufruf + DOMContentLoaded-IIFE nach app-init.js bewegen. Der große rasicross-Import-Block wird aufgeteilt: was nur init() brauchte, zieht mit nach app-init; was der Hub noch braucht, bleibt (Orakel + no-unused-vars machen das mechanisch).
- [ ] **Step 2:** `src/app.js`: NACH `import './rasicross.js';` die Zeile `import './app-init.js';` ergänzen (Boot-Reihenfolge: Hub zuerst, dann Boot — entspricht der bisherigen Selbst-Boot-Position am rasicross-Dateiende). Hub: Re-Export `export { kart3dIsReady, kart3dTickDt } from './app-init.js';`, Export-Block bereinigen.
- [ ] **Step 3: Gates** wie Task 1 + **Zeilen-Gate**: `Get-ChildItem src\*.js | ForEach-Object { "$($_.Name): $((Get-Content $_.FullName | Measure-Object -Line).Lines)" }` → alle ≤ 520, Ziel ≤ ~500 (rasicross.js jetzt Hub). **Commit** — `refactor(split): app-init.js -- Boot, init-Bindings und 3D-Setup aus rasicross.js (nur bewegt)`

---

### Task 5: Finale Gates, Plan-Doc, Push + PR

- [ ] **Step 1:** Komplettrezept — `npm test` 190/190; `npm run lint` 0; `npm run test:e2e` 10 passed; `node --check main.js preload.js tiles.js`; Python-Suite (56); Zeilen-Gate-Tabelle in den Report; Diff-Review über den GANZEN Branch: `git diff --color-moved=dimmed-zebra <base>..HEAD -- src/ | grep -c …` bzw. Sichtprüfung, dass Inhaltsänderungen nur Import/Export/Kommentar sind.
- [ ] **Step 2:** `__pycache__` löschen; `graphify update .`; Plan-Doc committen (`docs(plan): Phase 44 rasicross-Zerlegung Implementierungsplan`); Push; PR **gegen `feat/phase-43-state-redesign`** (stacked; Basis retargetet nach #69-Merge — MERGE-REIHENFOLGE beachten, siehe Conventions) mit Gate-Nachweisen, settings-ui.js-Begründung + Pflicht-Fußzeile.

---

## Hardware/Manual Acceptance Checklist (User)

- [ ] Actions grün; Merge-Reihenfolge: #69 → Retarget-Check → #44er-PR.
- [ ] Portable-EXE: Alles wie vorher (reiner Struktur-PR) — Stichprobe: Demo, Settings speichern, ESP-Config senden, 3D-Ansicht.

## Self-Review

- **Spec-Coverage:** vier Spec-Module → Tasks 1/2/4; „entlang der heutigen Abschnitte" → Zuordnungstabelle (Abschnitt 6 ⇒ settings-ui.js als begründete fünfte Datei, dokumentiert); „keine App-Datei über ~500" → Zeilen-Gate Task 4/5; „nur Code bewegt" → color-moved-Prüfung pro Task + erlaubte Änderungskategorien in den Global Constraints; „Smoke grün" → jeder Task.
- **Risiken verankert:** Konsumenten-Stabilität per Hub-Re-Export (kein Konsument ändert sich — mechanisch prüfbar via `git diff -- src/gauges.js …` leer); `_attLastMs`-Zugehörigkeit als explizite Vorab-Prüfung (Task 2 Step 1); Boot-Reihenfolge (Top-Level init() zieht mit, app.js importiert app-init NACH rasicross); Guard-Test rekursiv (fängt die neuen Dateien).
- **Platzhalter-Scan:** Import-Listen bewusst per ESLint-Orakel (mechanisch, wie Phasen 42/43) statt abgeschrieben — Erwartungswerte sind als Orientierung genannt; Bodies werden bewegt, nicht neu geschrieben, daher kein Code im Plan dupliziert. Export-/Re-Export-Listen stehen vollständig.
- **Typ-Konsistenz:** Export-Namen store/telemetry/esp-config/settings-ui/app-init identisch in Interfaces, Re-Export-Zeilen und Task-Steps.

## Phase Map

- Phase 43 (State-Redesign): PR #69 offen — Voraussetzung, Branch gestapelt.
- **Phase 44 (dieser Plan): rasicross-Zerlegung.**
- Phase 45 (Firmware-Modularisierung): unabhängig (nur Python), Hardware-Gate — kann parallel von main starten.
