# Phase 68 — Rückbau des Roh-Mitschnitts und des Replays

**Goal:** Aufnahme und Replay ersatzlos entfernen. Der Zweig schneidet in jedem Rennen jedes Telemetriepaket mit, schreibt eine Crash-Sicherungsdatei und hält bis zu 20 Rennen-Aufnahmen in IndexedDB — genutzt wurde davon nie etwas. Was der Nutzer auswertet (Rundenzeiten, Sektoren, Fahrer, Max-Werte pro Runde), hängt nicht daran: `commitLap()` schreibt es je Runde ins Rennen, `saveData()` persistiert es.

**Architecture:** Rückbau von außen nach innen, damit die App nach jeder Aufgabe lauffähig bleibt: erst die Bedienflächen, dann die Aufrufer, zuletzt Kern, Hauptprozess und Tests. `recording.js` verliert seine Aufnahme-Hälfte und behält nur noch Datensicherung (`exportAll`/`importAll`) — die Datei heißt danach `data-backup.js`, weil das ihre einzige verbliebene Verantwortung ist.

**Branch:** `feat/phase-68-rohmitschnitt-rueckbau`, aufgesetzt auf `main`.

**Spec:** kein eigenes Design-Dokument. Die Entscheidung fiel im Gespräch vom 2026-09-26: Der Nutzer hat in keinem Renntag je eine `.ndjson` oder CSV geöffnet; GPS-Positionen sind für ihn der uninteressanteste Teil der Daten. Phase A („Rennergebnisse als CSV exportieren") bleibt offen und ist **nicht** Teil dieser Phase.

## Global Constraints

- Rundenzeiten, Sektor-Bests, Fahrer, Motorstunden und Statistik bleiben unangetastet. Kein Schritt dieser Phase fasst `lap-engine.js`, `races.js`-Wertung oder `store.js`-Persistenz für diese Daten an.
- `exportAll`/`importAll` (Einstellungen → „Alle Daten exportieren") bleiben vollständig erhalten — nach dem Rückbau ist das der einzige Weg, Rennen aus der App zu holen.
- Der Demo-Modus ist nicht Replay und bleibt vollständig.
- Zeilen-Gate: Inhaltszeilen ohne Leerzeilen, gemessen mit `(Get-Content <f> | Measure-Object -Line).Lines`; harte Grenze 520 für neue/angefasste Dateien.
- Dateien sind CRLF. Vor jedem Edit die Zielstelle frisch lesen und den Anker aus diesem Lesen kopieren.
- Je Aufgabe ein Commit, Botschaft konventionell + Fließtext-Body, Trailer `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.

## Locked Decisions

- **Ersatzlos, nicht abgeschaltet.** Kein Feature-Flag, keine versteckte Einstellung. Toter Code mit Schalter ist teurer als kein Code.
- **`recording.js` wird zu `data-backup.js`.** Von 528 Zeilen bleiben `exportAll`, `importAll` und deren Hilfsfunktionen. Ein Modul, das nur noch sichert, soll nicht „recording" heißen.
- **`k.recording` und `k.replay` fallen aus der Kart-Registry.** Beide wurden nie persistiert (`saveData` schreibt nur Kalibrierung, Motor, Statistik) — es gibt keine Migration für Altstände.
- **`settings.recordAutoArm` bleibt im Save stehen.** `loadData()` kopiert unbekannte Schlüssel per `Object.assign` weiter; ein toter Schlüssel kostet nichts, eine Save-Migration schon.
- **Aufräumen statt Liegenlassen:** die IndexedDB `rasicross_recordings` und eine eventuell zurückgebliebene `crash-recording.ndjson` werden beim ersten Start nach dem Rückbau einmalig gelöscht. Beide Aufräumer tragen einen Kommentar mit Phasennummer, damit sie in einer späteren Phase wieder verschwinden können.
- **Die Replay-Leiste geht komplett**, samt Drift- und Roll-Streifen (`rpDriftStrip`, `rpRollStrip`). Sie werden ausschließlich in `enterReplay()` befüllt. `drift.js` selbst bleibt — die Drift-Erkennung läuft live.
- **Die REC-Pille verschwindet an allen drei Stellen** (Chip-Leiste, Übersichtskachel, Karts-Karte). Ohne Aufnahme gibt es keinen Zustand mehr, den sie anzeigen könnte.
- **Screenshot-Baselines werden in dieser Phase nicht eingefroren.** Sie stehen seit Phase 65–67 ohnehin aus; der Regen passiert danach in einem Zug, mit ausdrücklicher Abnahme des Nutzers.

## File Structure

| Action | Path | Responsibility |
|---|---|---|
| Rename | `src/recording.js` → `src/data-backup.js` | nur noch `exportAll`/`importAll` |
| Delete | `src/replay.js` | Serialisierung, Parser, CSV-Spalten, `REC_MAX` |
| Delete | `src/rec-store.js` | IndexedDB-Ablage der Rennen-Aufnahmen |
| Delete | `test/replay.test.js` | Tests des gelöschten Moduls |
| Delete | `e2e/replay.spec.js` | Recording/Replay-Roundtrip |
| Modify | `index.html` | Karte „Aufnahme & Replay", `#replayBar`, `#recLoadFile`, Auto-Arm-Zeile |
| Modify | `src/app-init.js` | Bindings, Crash-Recovery, IndexedDB-Aufräumer |
| Modify | `src/app.js` | Importe und Test-Brücke ohne `armRecording`/Replay |
| Modify | `src/races.js` | Replay-Knopf, `persistRaceRecording`, `discardRaceRecording` |
| Modify | `src/telemetry.js` | `armRecording`, `recordPacket`, Crash-Warteschlange |
| Modify | `src/kart-registry.js` | `recording`/`replay` aus dem Kart-Default |
| Modify | `src/kart-bar.js`, `src/kart-overview.js`, `src/karts-page.js` | REC-Pille |
| Modify | `src/serial-demo.js` | Auto-Arm-Aufrufe, Replay-Sperren |
| Modify | `src/store.js` | Replay-Wächter in `saveData`, `recordAutoArm`-Default |
| Modify | `src/settings.js`, `src/settings-ui.js` | Sucheintrag und Toggle-Spiegel |
| Modify | `src/rasicross.js` | Re-Exporte |
| Modify | `main.js`, `preload.js` | `rasi-rec`-IPC, Crash-Datei |
| Modify | `test/facade-free.test.js`, `test/kart-registry.test.js` | Feldlisten und Testfelder |

Reihenfolge: 1 → 2 → 3 → 4 → 5 → 6 → 7 (sequenziell, je Aufgabe ein Commit).

---

## Task 1 — Bedienflächen entfernen

**Files:**
- Modify: `index.html` (Karte ab `<div class="card-head"><span class="card-title">Aufnahme &amp; Replay</span>`, `#replayBar`, Toggle-Zeile `recAutoArmToggle`)
- Modify: `src/app-init.js` (Bindings `recSaveBtn`/`recCsvBtn`/`recLoadBtn`/`recLoadFile`/`rpPlayBtn`/`rpExitBtn`/`rpSeek`, Toggle-Binding)
- Modify: `src/settings.js` (Sucheintrag), `src/settings-ui.js` (Toggle-Spiegel)

**Interfaces:**
- Produces: keine DOM-Ids `rec*`/`rp*` mehr. Alle Funktionen in `recording.js` bleiben in dieser Aufgabe unangetastet und nur noch ungenutzt.

- [x] **Step 1: Karte „Aufnahme & Replay" aus `index.html` entfernen**

Den gesamten `<div class="card" style="margin-top:18px">`-Block löschen, der mit `<span class="card-title">Aufnahme &amp; Replay</span>` beginnt und mit dem `</div>` nach `<input type="file" id="recLoadFile" ...>` endet (aktuell Zeilen 868–879). `<div class="conn-grid" id="connGrid"></div>` darüber bleibt.

- [x] **Step 2: Replay-Leiste entfernen**

Den Block `<div id="replayBar" class="replay-bar hidden"> … </div>` (aktuell 1223–1240) löschen. `<div id="rcToast"></div>` und der `<script type="module" src="/src/app.js">` darunter bleiben.

- [x] **Step 3: Auto-Arm-Zeile aus den Einstellungen entfernen**

Die Zeile mit `id="recAutoArmToggle"` löschen (aktuell 1030). Die umgebende Gruppe behält ihre übrigen Zeilen.

- [x] **Step 4: Bindings in `src/app-init.js` entfernen**

Diese sieben Zeilen löschen (aktuell 258–265):

```js
  _bind('recSaveBtn', saveRecording);
  _bind('recCsvBtn', exportRecordingCsv);
  _bind('recLoadBtn', () => $('recLoadFile')?.click());
  const _rlf = $('recLoadFile');
  if (_rlf) _rlf.onchange = (e) => { if (e.target.files[0]) loadRecordingFile(e.target.files[0]); e.target.value = ''; };
  _bind('rpPlayBtn', toggleReplayPlay);
  _bind('rpExitBtn', exitReplay);
  const _rps = $('rpSeek');
  if (_rps) _rps.addEventListener('input', () => replaySeek((Number(_rps.value) || 0) / 1000));
```

Ebenso die Toggle-Zeile (aktuell 153):

```js
  if ($('recAutoArmToggle')) $('recAutoArmToggle').onchange = () => { state.settings.recordAutoArm = $('recAutoArmToggle').checked; saveData(); };
```

Die Importe aus `./recording.js` in `app-init.js` auf das reduzieren, was noch aufgerufen wird (`exportAll`, `importAll`) — der Lint-Lauf in Step 6 zeigt jeden übrig gebliebenen.

- [x] **Step 5: Sucheintrag und Toggle-Spiegel entfernen**

`src/settings.js`: den Eintrag mit `rowId: 'recAutoArmToggle'` aus der Registry löschen.
`src/settings-ui.js` (aktuell 102): `if ($('recAutoArmToggle')) $('recAutoArmToggle').checked = state.settings.recordAutoArm !== false;` löschen.

- [x] **Step 6: Verifizieren**

```bash
npm test
npm run lint
npm run lint:css
```
Erwartet: alle grün. Danach Grep über `index.html` nach `recSaveBtn|recCsvBtn|recLoadBtn|recLoadFile|replayBar|rpSeek|recAutoArmToggle` → keine Treffer.

- [x] **Step 7: Funktionsnachweis**

```bash
npx vite build && npx playwright test e2e/app.spec.js
```
Erwartet: 4/4 grün (alle Tabs rendern weiterhin).

- [x] **Step 8: Commit**

```
refactor(ui): Bedienflaechen fuer Aufnahme und Replay entfernt (Phase 68)
```

---

## Task 2 — Rennen-Tab und IndexedDB-Ablage

**Files:**
- Modify: `src/races.js:11` (Import), `:179` (`persistRaceRecording`), `:298` (`discardRaceRecording`), `:384` (Replay-Knopf), Handler `replayRace`
- Delete: `src/rec-store.js`
- Modify: `src/app-init.js` (einmaliger IndexedDB-Aufräumer), `src/app.js` (Import von `rec-store.js`, falls vorhanden)

**Interfaces:**
- Consumes: nichts aus Task 1.
- Produces: `races.js` importiert nichts mehr aus `recording.js`.

- [x] **Step 1: Replay-Knopf aus der Rennenliste entfernen**

In `src/races.js` (aktuell 384) den gesamten Ternär-Ausdruck löschen, der `data-action="replayRace"` erzeugt. Die übrigen Knöpfe der Zeile bleiben unverändert.

- [x] **Step 2: Handler und Aufrufe entfernen**

- Den `case 'replayRace':`-Zweig in `handleActionClick` löschen.
- Zeile 179 `persistRaceRecording(r);` samt Kommentar `// Replay soll App-Neustarts ueberleben` löschen.
- Zeile 298 `discardRaceRecording(id);` löschen.
- Import in Zeile 11 (`discardRaceRecording, persistRaceRecording, raceHasRecording`) löschen.

- [x] **Step 3: `src/rec-store.js` löschen**

```bash
git rm src/rec-store.js
```
Danach Grep nach `RasiRecStore|rec-store` über `src/`, `index.html`, `main.js` → nur noch Treffer in `recording.js` (fällt in Task 4).

- [x] **Step 4: Alte Datenbank einmalig löschen**

In `src/app-init.js` in `init()` ergänzen, vor dem ersten `render`-Aufruf:

```js
  // Phase 68: Rennen-Aufnahmen sind entfallen -- die alte Ablage einmalig
  // abraeumen, damit sie nicht stumm Platz belegt. Kann entfernt werden,
  // sobald kein Profil von vor Phase 68 mehr im Umlauf ist.
  try { indexedDB.deleteDatabase('rasicross_recordings'); } catch (e) { /* kein IndexedDB: nichts zu tun */ }
```

- [x] **Step 5: Verifizieren**

```bash
npm test
npm run lint
npx vite build && npx playwright test e2e/app.spec.js e2e/karts.spec.js
```
Erwartet: node-Tests grün, Lint 0, e2e grün.

- [x] **Step 6: Commit**

```
refactor(rennen): Replay-Knopf und IndexedDB-Ablage entfernt (Phase 68)
```

---

## Task 3 — REC-Pillen und Auto-Arm

**Files:**
- Modify: `src/kart-bar.js:87`, `src/kart-overview.js:107`, `src/karts-page.js:26`
- Modify: `src/serial-demo.js:59`, `:262` (Auto-Arm), `:42`, `:226` (Replay-Sperren)
- Modify: `src/store.js:31` (`recordAutoArm` aus dem Default)

- [x] **Step 1: Pillen entfernen**

Je Datei die `rec`-Variable und ihre Verwendung im Template streichen:

```js
// kart-bar.js:87
const rec = k.recording.armed ? ' ●REC' : '';
// kart-overview.js:107
const rec = k.recording.armed ? '<span class="ko-rec">●REC</span>' : '';
// karts-page.js:26
const rec = k.recording.armed ? '<span class="rec">●REC</span>' : '';
```

Die zugehörigen CSS-Regeln (`.ko-rec`, `.rec`) bleiben vorerst stehen; der Zeilen-Gate-Lauf fasst sie nicht an und ungenutztes CSS ist kein Fehler dieser Phase.

- [x] **Step 2: Auto-Arm-Aufrufe entfernen**

In `src/serial-demo.js` beide Vorkommen von `if (state.settings.recordAutoArm) armRecording();` löschen (aktuell 59 und 262, letzteres samt Phase-41-Kommentar darüber) und `armRecording` aus dem Import in Zeile 9 nehmen.

- [x] **Step 3: Replay-Sperren entfernen**

In `src/serial-demo.js` die beiden Wächter löschen (aktuell 42 und 226):

```js
  if (activeKart().replay.active) { rcToast('Im Replay-Modus — zuerst Replay beenden'); return; }
```

- [x] **Step 4: Default aus den Einstellungen nehmen**

In `src/store.js:31` `recordAutoArm: true,` aus dem `settings`-Default löschen.

- [x] **Step 5: Verifizieren**

```bash
npm test
npm run lint
```
Grep über `src/` nach `recordAutoArm` → keine Treffer. Grep nach `●REC` → keine Treffer.

- [x] **Step 6: Commit**

```
refactor(karts): REC-Pille und Auto-Arm entfernt (Phase 68)
```

---

## Task 4 — Aufnahme-Kern und `data-backup.js`

**Files:**
- Rename: `src/recording.js` → `src/data-backup.js`
- Modify: `src/telemetry.js` (Zeilen 20–78 Crash-Warteschlange/`armRecording`/`recordPacket`, Aufrufstelle 162)
- Modify: `src/app-init.js`, `src/app.js`, `src/rasicross.js` (Importpfade und Re-Exporte)

**Interfaces:**
- Produces: `src/data-backup.js` exportiert genau `exportAll` und `importAll`. `telemetry.js` exportiert `driftInputs`, `processTelemetry`, `resetAttitudeClock` — `armRecording` und `recordPacket` entfallen.

- [x] **Step 1: Datei umbenennen und kürzen**

```bash
git mv src/recording.js src/data-backup.js
```

In `src/data-backup.js` alles außer `exportAll` (aktuell 25–44) und `importAll` (45–79) löschen, dazu den Export-Block am Dateiende auf diese beiden reduzieren. Den Dateikopf-Kommentar auf die neue Verantwortung umschreiben: Datensicherung als JSON, kein Mitschnitt mehr.

- [x] **Step 2: Importpfade nachziehen**

Grep nach `from './recording.js'` über `src/` und jeden Treffer auf `'./data-backup.js'` umstellen, dabei die Importlisten auf `exportAll`/`importAll` reduzieren.

- [x] **Step 3: Crash-Warteschlange aus `telemetry.js` entfernen**

Löschen: den Kommentarblock „Crash-Sicherung (Phase 24)", `REC_FLUSH_N`, `REC_FLUSH_MS`, `_crashQ`, `_crashLastFlush`, `_crashFailed`, `_crashFlush()` (aktuell 26–43).

- [x] **Step 4: `armRecording` und `recordPacket` entfernen**

Beide Funktionen löschen (aktuell 44–78) sowie die Aufrufstelle in `processTelemetry` (aktuell 162):

```js
    if (k.recording.armed && !k.replay.active) recordPacket(d);
```

Die Zeile ersatzlos streichen — die Nachbarzeilen (`k.connection.packets++` usw.) bleiben.

- [x] **Step 5: Export-Liste und Fassade nachziehen**

- `src/telemetry.js`: Export-Zeile (aktuell 367) auf `driftInputs, processTelemetry, resetAttitudeClock` kürzen.
- `src/rasicross.js`: `armRecording` aus Import (Zeile 11) und Re-Export (Zeile 378) nehmen.
- `src/app.js`: `armRecording` aus Import (49) und `window.RasiTest` (60) nehmen, `import { enterReplay, exitReplay } from './recording.js';` löschen.

- [x] **Step 6: Verifizieren**

```bash
node --check src/data-backup.js && node --check src/telemetry.js
npm test
npm run lint
```
Erwartet: grün, keine ungenutzten Importe. Grep über `src/` nach `armRecording|recordPacket|rasiRec` → nur noch Treffer in `app-init.js` (Crash-Recovery, fällt in Task 6).

- [x] **Step 7: Commit**

```
refactor(telemetrie): Mitschnitt entfernt, recording.js wird data-backup.js (Phase 68)
```

---

## Task 5 — Replay-Kern und Kart-Felder

**Files:**
- Delete: `src/replay.js`, `test/replay.test.js`
- Modify: `src/kart-registry.js:42-44`, `src/store.js:194`, `src/app.js:20,53`
- Modify: `test/facade-free.test.js:15`, `test/kart-registry.test.js:103,108,133`

- [x] **Step 1: Kart-Felder entfernen**

In `src/kart-registry.js` die beiden Zeilen löschen:

```js
      recording: { armed: false, buf: [], startWall: null, overflowed: false },
      replay: { active: false, packets: [], idx: 0, virtualMs: 0, durationMs: 0,
                speed: 1, playing: false, raf: null, lastWall: null, snapshot: null },
```

- [x] **Step 2: Testfelder umstellen**

`test/facade-free.test.js:15`: `'recording','replay',` aus der Feldliste nehmen.
`test/kart-registry.test.js`: die drei Stellen, die `k.recording.armed` als Beispielfeld benutzen, auf ein weiterhin existierendes Feld umstellen — `k.connection.rssi = -42;` setzen und entsprechend prüfen (`r.peek('aa:bb').connection.rssi === -42`). Der Test prüft die Übernahme eines Buckets, nicht das Feld selbst.

- [x] **Step 3: Replay-Wächter in `saveData` entfernen**

`src/store.js:194`: `if (activeKart().replay.active) return;` samt Kommentar löschen.

- [x] **Step 4: Modul und Test löschen**

```bash
git rm src/replay.js test/replay.test.js
```
In `src/app.js` die Zeilen `import './replay.js';` (20) und `import RasiReplay from './replay.js';` (53) löschen; `RasiReplay` aus `window.RasiTest` nehmen, falls dort geführt.

- [x] **Step 5: Verifizieren**

```bash
npm test
npm run lint
```
Erwartet: grün; die Testzahl sinkt um die Fälle aus `replay.test.js` — neue Zahl notieren, sie ist ab jetzt die Basis. Grep über `src/` nach `RasiReplay|\.replay\.` → keine Treffer.

- [x] **Step 6: Commit**

```
refactor(karts): replay.js und die Kart-Felder recording/replay entfernt (Phase 68)
```

---

## Task 6 — Hauptprozess, Crash-Datei, e2e

**Files:**
- Modify: `main.js:141-198` (IPC-Handler, `recCrashPath`, `REC_CRASH_MAX_BYTES`, `recCrashBytes`), `:200-204` (`before-quit`)
- Modify: `preload.js:44-50` (`rasiRec`-Brücke)
- Modify: `src/app-init.js` (Crash-Recovery-Block, aktuell 292–320)
- Delete: `e2e/replay.spec.js`

- [x] **Step 1: Crash-Recovery im Renderer entfernen**

In `src/app-init.js` den kompletten `if (window.rasiRec) { … }`-Block löschen (aktuell 292–320) samt Kommentarkopf „Crash-Recovery (Phase 24)". `formatBytes` bleibt, falls es andere Aufrufer hat — sonst mit löschen (Lint zeigt es an).

- [x] **Step 2: IPC-Handler entfernen**

In `main.js` löschen: `recCrashPath()`, `REC_CRASH_MAX_BYTES`, `recCrashBytes` und die fünf Handler `rasi-rec:start|append|check|read|clear` (aktuell 141–198), samt Kommentarkopf.

- [x] **Step 3: Aufräumer statt Löschen beim Beenden**

Im `before-quit`-Handler (aktuell 200–204) die Zeile `try { fs.unlinkSync(recCrashPath()); } catch (e) {}` entfernen. Stattdessen einmalig beim Start, direkt nach `app.whenReady()`:

```js
  // Phase 68: Der Mitschnitt ist entfallen -- eine Sicherungsdatei aus der
  // Zeit davor einmalig wegraeumen. Kann entfernt werden, sobald kein
  // Profil von vor Phase 68 mehr im Umlauf ist.
  try { fs.unlinkSync(path.join(app.getPath("userData"), "crash-recording.ndjson")); } catch (e) {}
```

- [x] **Step 4: Preload-Brücke entfernen**

In `preload.js` den Block `contextBridge.exposeInMainWorld("rasiRec", { … });` (aktuell 44–50) löschen.

- [x] **Step 5: e2e-Test löschen**

```bash
git rm e2e/replay.spec.js
```

- [x] **Step 6: Verifizieren**

```bash
node --check main.js && node --check preload.js
npm test
npm run lint
npx vite build && npx playwright test e2e/app.spec.js e2e/karts.spec.js e2e/demo.spec.js
```
Erwartet: grün. Grep über `main.js`, `preload.js`, `src/` nach `rasiRec|rasi-rec|crash-recording` → nur die beiden Aufräumer-Kommentare.

- [x] **Step 7: Am laufenden Programm prüfen**

```bash
npx vite build && env -u ELECTRON_RUN_AS_NODE npx electron .
```
Prüfen: Verbindungsseite ohne Karte „Aufnahme & Replay", Rennen-Tab ohne Replay-Knopf, Einstellungen ohne Auto-Arm-Zeile, Demo startet und zeichnet Runden. Konsole ohne Fehler.

- [x] **Step 8: Commit**

```
refactor(main): Crash-Sicherung und rasiRec-Bruecke entfernt (Phase 68)
```

---

## Task 7 — Abschluss

- [x] **Step 1: Volle lokale Gates**

```bash
npm test
npm run lint
npm run lint:css
node --check src/geo.js && node --check src/data-backup.js && node --check main.js && node --check preload.js && node --check tiles.js
python -m unittest discover -s test -p "test_*.py"
```
`__pycache__` danach löschen.

- [x] **Step 2: Lokale e2e vollständig**

```bash
npx vite build && npx playwright test e2e/demo.spec.js e2e/karts.spec.js e2e/app.spec.js
```
Erwartet: 15/15 (16 minus der gelöschte Replay-Roundtrip).

- [x] **Step 3: Zeilen-Gate**

`(Get-Content src/data-backup.js | Measure-Object -Line).Lines` — erwartet deutlich unter 520 (vorher 528 als `recording.js`).

- [x] **Step 4: Branch pushen, PR, CI**

```bash
git push -u origin feat/phase-68-rohmitschnitt-rueckbau
gh pr create --base main --title "Phase 68: Rückbau des Roh-Mitschnitts und des Replays" --body-file -
```

- [x] **Step 5: Screenshot-Gate einordnen**

Erwartet rot sind `tab-connection` und `demo-connection` (Karte entfällt) sowie `tab-settings` (Toggle-Zeile entfällt) — zusätzlich zu den sieben, die seit Phase 65–67 ohnehin offen sind. `tab-races` bleibt grün, solange der Ruhezustand kein beendetes Rennen zeigt. Jedes weitere rote Bild ist ein Fehler, kein Grund für einen Regen.

- [x] **Step 6: `graphify update .`** (nicht committen)

- [x] **Step 7: Plan-Doc committen**

```
docs(phase-68): Plan Rueckbau des Roh-Mitschnitts
```

## Abweichungen vom Plan

Beim Ausführen haben sich vier Schnitte als falsch gesetzt erwiesen; die Reihenfolge wurde angepasst, das Ergebnis ist dasselbe.

- **Crash-Recovery im Renderer fiel schon in Task 1** statt in Task 6: der Block ruft `enterReplay()` auf, ohne den Import brach der Lint-Lauf.
- **`rec-store.js` fiel erst in Task 4** statt in Task 2: `recording.js` importierte es direkt, auch `resetAll` nutzte es.
- **`e2e/replay.spec.js` fiel schon in Task 4** statt in Task 6: der Test nutzte die Test-Brücke `armRecording`/`enterReplay`/`RasiReplay`, die in Task 4 entfiel.
- **`data-backup.js` behält drei Funktionen, nicht zwei:** `resetAll` („Alle Daten zurücksetzen") lebte ebenfalls in `recording.js`. Sie verliert nur das Abräumen der Rennen-Aufnahmen.

Zusätzlich zum Plan entfernt, weil sie mit dem Replay ihren einzigen Aufrufer verloren:

- `resetAttitudeClock()` in `telemetry.js` (setzte die Fusions-Uhr beim Replay-Reset zurück) samt Re-Export über `rasicross.js`.
- Der Re-Export von `driftInputs` über `rasicross.js` — die Funktion selbst bleibt, `processTelemetry` nutzt sie.
- Die vier `!k.replay.active`-Bedingungen in `processTelemetry`; der Block der Lebens-Statistik läuft ohne Klammer.
- Totes CSS: Replay-Leiste (11 Regeln), Play/Pause-Icons, die Verschiebung der Statusleiste bei sichtbarer Leiste, `.kc-live .rec`, `.ko-card .ko-rec` und das Token `--rec`, das nur diese beiden Regeln nutzten.
- Kommentare in `gauges.js`, `laps-drivers.js`, `live-ui.js`, `track.js`, `rasicross.js`, `store.js`, `kart-registry.js` und `telemetry.js`, die `recording.js` oder das Replay als Grund nannten.

Screenshot-Gate (CI-Lauf 36201487204): 8 rot, 22 grün. Neu rot durch Phase 68 ist nur `tab-connection` — die Differenz liegt ausschließlich im Bereich der entfallenen Karte. `demo-connection` war schon rot und zeigt jetzt zusätzlich die fehlende Karte. `tab-settings` ist vor und nach Phase 68 pixelgleich rot: die Auto-Arm-Zeile stand in der Gruppe „Daten", die im Screenshot nicht offen ist — die Vorhersage in Task 7 Step 5 war dort falsch. Keine unerklärte Abweichung.

Messwerte nach dem Rückbau: `npm test` 247 (vorher 264, die 17 fehlenden waren `replay.test.js`), Python 72, Lint 0, CSS-Gate OK, lokale e2e 15/15. `data-backup.js` 58 Inhaltszeilen.

## Manuelle Abnahme (Nutzer, nicht automatisierbar)

- [ ] Verbindungsseite: keine Karte „Aufnahme & Replay" mehr, der Rest der Seite sitzt unverändert.
- [ ] Rennen-Tab: beendete Rennen zeigen ihre Ergebnisse, aber keinen Replay-Knopf.
- [ ] Einstellungen: keine Zeile „Aufnahme bei Verbindung automatisch starten"; die Suche findet sie auch nicht mehr.
- [ ] Chip-Leiste, Übersichtskacheln und Karts-Karten ohne REC-Pille.
- [ ] Ein Rennen fahren (oder Demo): Runden, Sektoren, Fahrerwechsel und Max-Werte entstehen unverändert.
- [ ] „Alle Daten exportieren" liefert weiterhin ein vollständiges JSON mit allen Rennen.
- [ ] Nach einem harten Beenden während eines Rennens fragt beim Neustart nichts mehr nach Wiederherstellung — die bereits geschlossenen Runden stehen trotzdem im Rennen.

## Self-Review

- [x] Abdeckung: Jede Fundstelle aus der Bestandsaufnahme (`recording`, `replay`, `rasiRec`, `Aufnahme`) ist genau einer Aufgabe zugeordnet — UI (1), Rennen (2), Karts (3), Kern (4), Modul/Felder (5), Hauptprozess (6).
- [x] Keine Platzhalter: jeder Schritt nennt Datei, Anker und den vollständigen zu löschenden oder zu schreibenden Text.
- [x] Namenskonsistenz: `data-backup.js` heißt in File Structure, Task 4, Task 7 und der Verifikation gleich; `exportAll`/`importAll` sind die einzigen verbleibenden Exporte.
- [x] Reihenfolge trägt: nach jeder Aufgabe ist die App lauffähig, weil Aufrufer vor den Aufgerufenen verschwinden.
- [x] Risiko benannt: `kart-registry.test.js` benutzte `recording.armed` als beliebiges Beispielfeld — Task 5 stellt es um, statt den Test zu löschen. Sonst ginge die Regression zur Bucket-Übernahme verloren.

## Phase Map

- Phase 65 → Live-Tab als Seitenkonzept
- Phase 66 → Kart-Wahl im Detail-Tab
- Phase 67 → Anzeigefehler-Audit, Firmware-Absturzpfad, Config-Fehlermeldung
- **Phase 68 → Rückbau des Roh-Mitschnitts und des Replays**
- offen (Phase A) → Rennergebnisse als CSV exportieren
