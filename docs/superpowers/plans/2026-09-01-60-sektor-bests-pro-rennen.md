# Phase 60 — Sektor-Bestzeiten pro Rennen (Bugfix-Plan)

**Goal:** Die in Phase 59 gefundenen Sektor-Bestzeiten-Bugs beheben. **User-Entscheid: Bestzeiten gelten pro Rennen.** Damit ist der Reset beim Rennstart richtig, und jede Ableitung eines dauerhaften „Streckenrekords" daraus ist falsch und fliegt raus.

**Architecture:** Phase 30 stellte Sektor-Bests von der globalen `state.sectors.best` auf `k.sectorsBest` (pro Kart) um, ließ die globale Liste aber stehen. Drei Stellen arbeiten noch mit ihr — daraus folgen alle Befunde. Der Fix entfernt die tote Globale samt Persistenz, kappt die Streckenrekord-Kopplung und isoliert den Replay-Zustand.

**Branch:** `feat/phase-60-sektor-bests-pro-rennen`, aufgesetzt auf `feat/phase-59-multikart-fixes` (PR #94).

## Locked Decisions

- **Sektor-Bests sind Renn-Zustand.** `startRace` nullt sie (bleibt), sie leben in `k.sectorsBest`, und sie überdauern kein Rennen.
- **Kein Streckenrekord mehr.** `syncSectorBestToTrack`, `t.sectorBest` und `trackRecordFromKarts` entfallen ersatzlos. Der Rekord war **nirgends sichtbar** (nur interne Vorbelegung der Kart-Bests) — sein Wegfall ist für den Nutzer unsichtbar. Alte Saves behalten das Feld; es wird ignoriert.
- **Streckenwechsel nullt die Bests** (`loadSavedTrack`): neue Sektorgrenzen machen alte Zeiten bedeutungslos — unabhängig von der Renn-Semantik.
- **`state.sectors.best` wird ersatzlos entfernt**, inkl. Speichern/Laden. Sie ist die Wurzel der falschen Reset- und Lese-Ziele.
- **Replay isoliert:** `sectorsBest` kommt in `REPLAY_KART_KEYS` (Snapshot/Restore) und wird in `resetReplayDerived` genullt.
- **Nicht in dieser Phase:** die tote `k.batt.cells` (Befund 4, reine Altlast) — bleibt bewusst außen vor, damit der Bugfix reviewbar schmal bleibt.

## File Structure

| Action | Path | Responsibility |
|---|---|---|
| Modify | `src/lap-engine.js` | `trackRecordFromKarts` entfernen |
| Modify | `test/lap-engine.test.js` | zugehörigen Test + Export-Listen-Eintrag entfernen |
| Modify | `src/track.js` | `syncSectorBestToTrack` weg; `saveCurrentTrack` ohne `sectorBest`; `loadSavedTrack` nullt Bests; Reset der Globalen weg |
| Modify | `src/laps-drivers.js` | Aufruf + Import von `syncSectorBestToTrack` weg |
| Modify | `src/store.js` | `sectors.best` aus State-Shape, Save und Load |
| Modify | `src/recording.js` | `sectorsBest` in `REPLAY_KART_KEYS`; Reset auf `k.sectorsBest` |
| Modify | `src/serial-demo.js` | Reset der Globalen weg |
| Modify | `src/pit-wall.js` | Sektor-Färbung liest `k.sectorsBest` |

Reihenfolge: 1 → 2 → 3 → 4 (sequenziell, je Task ein Commit).

## Task 1 — Streckenrekord-Ableitung entfernen (Befund 2)

- [ ] `src/lap-engine.js`: Funktion `trackRecordFromKarts` (inkl. Kommentar) und ihren Export-Eintrag löschen.
- [ ] `test/lap-engine.test.js`: Test `trackRecordFromKarts takes min per sector, ignoring null` löschen; `'trackRecordFromKarts',` aus der Export-Liste in Zeile 8 entfernen.
- [ ] `src/track.js`: `syncSectorBestToTrack()` samt Kommentarblock löschen; aus `void [...]`-Marker und ESM-Export entfernen; Aufruf in `checkSectorCrossings` löschen (das umschließende `if` behält `rcAudio.sectorBest()` + `saveDataDebounced()`).
- [ ] `src/laps-drivers.js`: Aufruf in `triggerLap` löschen; `syncSectorBestToTrack` aus dem Import aus `./track.js` entfernen (`updateSectorPanel` bleibt).
- [ ] Verify: Grep `syncSectorBestToTrack|trackRecordFromKarts` über `src/`+`test/` → 0 Treffer. `npm test`, `npm run lint`.
- [ ] Commit: `fix(track): Streckenrekord-Ableitung entfernt - Sektor-Bests gelten pro Rennen (Phase 60)`

## Task 2 — Tote globale `state.sectors.best` entfernen (Wurzel von Befund 1+3)

- [ ] `src/store.js`: aus dem State-Shape (`sectors: {...}`) den Schlüssel `best` entfernen; im Save-Objekt (`sectors: { boundaries…, manual…, best… }`) `best` entfernen; im Load die Zeile `if (Array.isArray(d.sectors.best)) …` löschen.
- [ ] `src/track.js`: in `saveCurrentTrack` die Zeile `sectorBest: [...state.sectors.best],` löschen; den Reset `state.sectors.best = [null,null,null]` (bei Strecke leeren) löschen.
- [ ] `src/track.js` `loadSavedTrack`: Zeile mit `activeKart().sectorsBest = Array.isArray(t.sectorBest) …` ersetzen durch das Nullen der Bests **aller** Karts, da die Sektorgrenzen wechseln:
```js
  // Phase 60: neue Sektorgrenzen -> alte Bestzeiten sind bedeutungslos.
  for (const _m of state.karts.macs()) {
    const _k = state.karts.get(_m);
    if (_k) _k.sectorsBest = [null, null, null];
  }
```
- [ ] `src/serial-demo.js`: Zeile `state.sectors.best = [null, null, null];` samt Kommentar löschen.
- [ ] **Abweichung bei der Umsetzung:** In `clearTrack` (track.js) wurde der Reset der Globalen nicht ersatzlos gestrichen, sondern auf das richtige Ziel umgebogen — ohne Sektorgrenzen sind Bestzeiten gegenstandslos, also werden dort die Per-Kart-Bests aller Karts genullt (analog `loadSavedTrack`).
- [ ] **Abweichung:** Der Pit-Wall-Fix (eigentlich Task 4) wurde in diesen Commit vorgezogen — nach dem Entfernen von `state.sectors.best` hätte `s.best[i]` dort eine TypeError geworfen; ein separater Zwischenstand wäre kaputt gewesen.
- [ ] Verify: Grep `sectors\.best` über `src/` → 0 Treffer. `npm test`, `npm run lint`.
- [ ] Commit: `fix(state): tote globale Sektor-Bestenliste entfernt (Phase 60)`

## Task 3 — Replay isolieren (Befund 1)

- [ ] `src/recording.js`: `'sectorsBest'` in `REPLAY_KART_KEYS` aufnehmen (hinter `'sectorsLive'`), damit Snapshot und Restore es abdecken.
- [ ] `src/recording.js` `resetReplayDerived`: die Zeile `state.sectors.best = [null, null, null];` durch `k.sectorsBest = [null, null, null];` ersetzen (Kommentar darüber bleibt sinngemäß korrekt).
- [ ] Verify: Grep `sectorsBest` in `src/recording.js` → beide Stellen vorhanden. `npm test`, `npm run lint`.
- [ ] Commit: `fix(replay): Sektor-Bests werden isoliert und wiederhergestellt (Phase 60)`

## Task 4 — Pit-Wall-Sektorfärbung reparieren (Befund 3) + Abschluss

- [ ] `src/pit-wall.js`: in `updatePitWall` die Zeile `const best = s.best[i];` durch `const best = (k.sectorsBest || [])[i];` ersetzen. Prüfen, ob `const s = state.sectors;` danach noch Verwender hat — falls nicht, Zeile entfernen (Lint zeigt es).
- [ ] Volle Verifikation: `npm test`, `npm run lint`, `npm run lint:css`, `python -m unittest discover -s test -p "test_*.py"`, lokale e2e (`npx vite build` + `npx playwright test e2e/demo.spec.js e2e/karts.spec.js e2e/app.spec.js e2e/replay.spec.js`). `__pycache__` löschen.
- [ ] `graphify update .` (nicht committen).
- [ ] Commit Code + Plan-Doc: `fix(pitwall): Sektorfaerbung nutzt Per-Kart-Bestzeiten (Phase 60)` bzw. `docs(phase-60): Plan Sektor-Bests pro Rennen`

## Manuelle Abnahme (User, deferred)

- [ ] Rennen fahren: Sektorzeiten färben sich in der Pit Wall wieder grün/rot.
- [ ] Replay eines Rennens ansehen → danach sind die eigenen Sektor-Bestzeiten unverändert.
- [ ] Andere Strecke laden → Bestzeiten starten leer.
- [ ] Neues Rennen → Bestzeiten starten leer (bewusst, „pro Rennen").

## Self-Review

- [ ] Befund 1 → Task 2+3, Befund 2 → Task 1+2, Befund 3 → Task 4. Befund 4 bewusst ausgeklammert.
- [ ] Keine Platzhalter; alle Stellen mit Datei + Anker benannt.
- [ ] Semantik konsistent: Bests entstehen nur bei laufendem Rennen (`checkSectorCrossings` prüft das), werden bei Rennstart, Streckenwechsel und Replay-Eintritt genullt.
