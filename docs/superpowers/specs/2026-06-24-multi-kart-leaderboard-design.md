# Multi-Kart Leaderboard + Positions-Ranking — Design (Phase 31)

**Datum:** 2026-06-24
**Branch:** `feat/multi-kart-support` (Folge auf Phase 30)
**Status:** Design genehmigt, bereit für Implementierungsplan

## 1. Ziel

Phase 30 gab jedem Kart im selben Rennen eigene Runden, Bestrunde, Sektor-Best
und Stints. Phase 31 ordnet diese Teilnehmer zu einem **Live-Klassement**: jeder
Kart bekommt eine **Position** (P1, P2, …), das Übersicht-Grid wird nach Position
sortiert und zeigt den **Abstand** zum Führenden. Lap-basierte Multi-Kart-Rennen
enden automatisch, sobald der **Führende** die Zielrundenzahl erreicht, und die
„Verbleibend"-Anzeige zählt die **Rest-Runden des Führenden** statt — wie aktuell
fälschlich — die Summe aller Karts.

**Bewusster Schnitt:** Phase 31 liefert **Ranking-Engine + sortiertes Grid mit
Positions-Badge + Gap + Leader-Auto-Ende + Runden-bis-Ziel**. Live-Positions-Karte
(Strecken-Overlay), synchrones Multi-Kart-Replay und ein kombinierter
Mehr-Kart-Fahrerdialog sind **Phase 32 / deferred** (siehe §9).

## 2. Ausgangslage (bereits vorhanden, nach Phase 30)

- `lap-engine.js`: dependency-freies UMD `window.RasiLapEngine` mit
  `participantsOf`, `flatValidLaps`, `partValidLaps`, `commitLap`, `migrateRace`
  etc. — `node:test`-getestet (140 Tests grün). Hier kommt die Ranking-Logik dazu.
- `kart-registry.js`: jeder Kart hat `k.lapStart` = **Zeitstempel der letzten
  Linien-Durchfahrt** (Start der aktuellen Runde). Genau dieses Feld liefert den
  Tiebreak fürs Ranking (wer zuerst die Linie überquerte, liegt vorn).
- `kart-overview.js` `render(state)`: zeichnet je Kart eine Karte (`liveOverview`)
  in **Einfüge-Reihenfolge** (`state.karts.macs()`), liest bereits `k.lapStart`,
  `k.bestLapMs` und die gültige Rundenzahl des Teilnehmer-Slots
  (`RasiLapEngine.partValidLaps`). Hat `RasiLapEngine` + `activeRace` bereits als
  ESLint-Globals (Phase 30, Task 9).
- `laps-drivers.js` `triggerLap(k, mac)`: committet Runden; Lap-Auto-Ende sitzt
  hier und feuert heute **nur bei Single-Teilnehmer** (`participantsOf(r).length
  <= 1 && partValidLaps(part).length >= r.targetLaps → endRace(true)`, Phase 30).
- `live-ui.js` (~Zeile 380): „Verbleibend" für Lap-Rennen =
  `Math.max(0, r.targetLaps - raceValidLaps(r).length)`. Nach Phase 30 aggregiert
  `raceValidLaps` **alle** Teilnehmer (`flatValidLaps`) → die Anzeige ist im
  Multi-Kart-Fall bereits semantisch falsch (Summe statt Führender).
- `pit-wall.js` (~Zeile 51–54): zeigt `X / targetLaps` des **aktiven** Karts
  (`_pwPart`, Phase 30). Das ist als Per-Kart-Fortschritt korrekt und bleibt
  **unverändert** (Pit-Wall bleibt aktiv-kart-fokussiert).

## 3. Architektur

### 3.1 Ranking-Regel (rein, deterministisch)

Neue Pure-Funktion in `lap-engine.js`:

```js
rankParticipants(race, lastCrossingByMac) → [
  { mac, pos, laps, lapGap, timeGapMs }, …   // sortiert, pos 1 = Führender
]
```

- `lastCrossingByMac` = `{ [mac]: k.lapStart }` (Zeitstempel der letzten
  Linien-Durchfahrt; `null`/`undefined` = noch nicht armiert).
- **Primär-Sortierung:** gültige Runden **absteigend** (`partValidLaps(part).length`).
- **Tiebreak (gleiche Rundenzahl):** früheste letzte Linien-Durchfahrt **zuerst**
  (`lastCrossing` aufsteigend → wer früher überquerte, liegt vorn).
- **Unarmierte/0-Runden-Karts** (`lastCrossing == null`) sortieren **ganz nach
  hinten**, stabil in Teilnehmer-Reihenfolge (`participantsOf`).
- **Gap zum Führenden:**
  - `lapGap = leaderLaps − kartLaps` (>0 = N Runden Rückstand).
  - Gleiche Runde wie Führender (`lapGap == 0`, nicht selbst Führender):
    `timeGapMs = kartCrossing − leaderCrossing` (später überquert → positiv).
  - Führender: `pos = 1`, `lapGap = 0`, `timeGapMs = 0`.

Reine Funktion, kein DOM, kein Registry-Zugriff — Eingaben werden vom Aufrufer
übergeben (`race` + `lastCrossingByMac`).

Zweite Helfer-Funktion:

```js
leaderReachedTarget(ranked, targetLaps) → boolean   // ranked[0].laps >= targetLaps
```

### 3.2 Anzeige-Format (Gap)

Vom UI aus den Ranking-Feldern abgeleitet (kein zusätzlicher State):

- Führender: `—` (oder „Leader").
- Gleiche Runde: `+2.3s` (aus `timeGapMs`, eine Nachkommastelle).
- Überrundet: `+1 Runde` / `+N Runden` (aus `lapGap`).

### 3.3 Sortiertes Grid + Positions-Badge (`kart-overview.js`)

`render(state)` wird umgestellt:

1. `r = activeRace()`; nur wenn `r` läuft **und** ≥2 Teilnehmer → Ranking aktiv.
2. `lastCrossingByMac` aus `state.karts` aufbauen (`k.lapStart` je `mac`).
3. `ranked = RasiLapEngine.rankParticipants(r, lastCrossingByMac)`.
4. Karten in **Positions-Reihenfolge** rendern; je Karte ein `P{pos}`-Badge und
   die Gap-Zeile.
5. **Kein laufendes Rennen oder <2 Teilnehmer** → exakt wie heute (Einfüge-
   Reihenfolge, **keine** Badges/Gap). Single-Kart bleibt visuell identisch.

Die Karten behalten ihre bestehenden Felder (Speed, aktuelle Runde, Bestrunde,
Rundenzahl); Badge + Gap kommen additiv hinzu.

### 3.4 Leader-Auto-Ende + Runden-bis-Ziel

- **`laps-drivers.js` `triggerLap`:** Die Phase-30-Beschränkung „nur bei
  ≤1 Teilnehmer" entfällt. Nach einem Lap-Commit gilt für `lengthType === 'laps'`:
  erreicht **dieser** Kart `targetLaps` gültige Runden → `endRace(true)`. Der
  erste Kart, der `targetLaps` erreicht, **ist** definitionsgemäß der Führende —
  daher genügt der bestehende Per-Kart-Check ohne separate Ranking-Auswertung.
  Single-Kart-Verhalten bleibt 1:1 identisch.
- **`live-ui.js` „Verbleibend":** `r.targetLaps − leaderLaps` statt
  `r.targetLaps − raceValidLaps(r).length`. `leaderLaps` = `ranked[0].laps` (bei
  ≥1 Teilnehmer); ohne Teilnehmer/Ranking Fallback auf bisheriges Verhalten.
  Damit zeigt der Countdown korrekt die Rest-Runden des Führenden.

### 3.5 Datenfluss

```
processTelemetry (Phase 30)
  → je Teilnehmer-Kart triggerLap(k, mac); k.lapStart = letzte Linien-Durchfahrt
kart-overview.render
  → lastCrossingByMac = {mac: k.lapStart}
  → ranked = rankParticipants(activeRace, lastCrossingByMac)
  → Karten in Positions-Reihenfolge + P-Badge + Gap
triggerLap (laps-Rennen, ≥? Teilnehmer)
  → dieser Kart erreicht targetLaps → endRace(true)   (Führender per Definition)
live-ui countdown (laps-Rennen)
  → Verbleibend = targetLaps − ranked[0].laps
```

## 4. Randfälle

1. **Single-Teilnehmer (Single-Kart-Regression):** Ranking liefert genau einen
   Eintrag; Grid ohne Badge/Gap, Auto-Ende + Runden-bis-Ziel identisch zu
   Phase 30. Keine sichtbare Änderung.
2. **Rolling Start (alle 0 Runden, unarmiert):** alle `lastCrossing == null` →
   stabile Reihenfolge, keine Gaps, bis die ersten Linien-Durchfahrten kommen.
3. **Gleicher Rundenstand:** Tiebreak über früheste letzte Durchfahrt; Gap als
   `+x.xs` aus den Durchfahrt-Zeitstempeln.
4. **Überrundeter / Nachzügler-Kart:** sortiert nach Runden, dann Durchfahrt;
   Nachzügler (späteres `joinedAt`/weniger Runden) liegt hinten; Gap als
   `+N Runden`.
5. **Zeit-/Frei-Rennen:** Ranking + sortiertes Grid + Gap werden angezeigt; **kein**
   Lap-Auto-Ende (greift nur bei `lengthType === 'laps'`). Die Restzeit-/Fahrzeit-
   Anzeige bleibt unverändert.
6. **Stale/getrennter Kart:** behält Runden + letzte Durchfahrt, hält damit seine
   Position; keine Geister-Runden (Phase-30-Verhalten).
7. **Aktiver Kart gewechselt (Chip):** Sortierung/Position sind unabhängig vom
   aktiven Kart; das aktive-Kart-Highlight (`ko-card.active`) bleibt erhalten,
   verschiebt sich nur mit der Sortierung.

## 5. Tests / Verifikation

- **Neue Pure-Logik wird TDD'd** in `lap-engine.js` unter `node:test`
  (`test/lap-engine.test.js`):
  - `rankParticipants`: Sortierung nach Runden absteigend; Tiebreak früheste
    Durchfahrt; unarmierte Karts hinten; `lapGap` für überrundete; `timeGapMs`
    für gleiche Runde; Führender `pos 1`.
  - `leaderReachedTarget`: `true` ab `ranked[0].laps >= targetLaps`, sonst `false`.
  - Baseline `node --test` wächst von **140** auf **~146** (neue Ranking-Tests).
- **DOM-/UI-Verdrahtung** (`kart-overview.js`, `laps-drivers.js`, `live-ui.js`):
  `node --check` + `npx eslint` + Grep-Asserts; bestehende Baselines grün.
- **Python unverändert:** `python -m py_compile bridge.py`;
  `python -m unittest discover -s test -p "test_*.py"` → **50 OK**.
- **Funktionales Multi-Kart-Verhalten (zwei Karts, Hardware) bleibt manuell** —
  Akzeptanzliste §7.

## 6. Betroffene Dateien

| Aktion | Datei | Verantwortung |
|--------|-------|---------------|
| Ändern | `lap-engine.js` | Neue Pure-Funktionen `rankParticipants(race, lastCrossingByMac)` + `leaderReachedTarget(ranked, targetLaps)`; im UMD-Return exportieren. |
| Ändern | `test/lap-engine.test.js` | `node:test`-Fälle für Ranking + Leader-Ziel. |
| Ändern | `kart-overview.js` | Grid nach Position sortieren; `P{pos}`-Badge + Gap-Zeile bei ≥2 Teilnehmern; sonst unverändert. |
| Ändern | `laps-drivers.js` | `triggerLap`: `participants <= 1`-Beschränkung beim Lap-Auto-Ende entfernen (erster Kart auf `targetLaps` = Führender → `endRace(true)`). |
| Ändern | `live-ui.js` | „Verbleibend" (Lap-Rennen) = `targetLaps − leaderLaps` statt Summe `raceValidLaps`. |
| Ändern | `RasiCross_Telemetry.html` | CSS für Positions-Badge (`ko-pos`) + Gap-Zeile (`ko-gap`) im `kart-overview`-Kartenstil. |
| Ändern | `eslint.config.js` | Nur falls neue Globals nötig — `rankParticipants`/`leaderReachedTarget` sind Methoden des bestehenden `RasiLapEngine`-Globals, daher voraussichtlich **keine** Änderung. |

`pit-wall.js`, `package.json` und der `<script src="lap-engine.js">`-Include
bleiben **unverändert** (lap-engine ist seit Phase 30 gebündelt; Pit-Wall bleibt
aktiv-kart-fokussiert).

## 7. Manuelle Akzeptanz (Nutzer, Hardware/zwei Karts)

1. **Positions-Ranking:** Rennen mit zwei Karts starten; Übersicht sortiert nach
   Position, P1/P2-Badges erscheinen, sobald Runden gezählt werden.
2. **Gap:** Kart auf gleicher Runde zeigt `+x.xs` zum Führenden; überrundeter Kart
   zeigt `+1 Runde`.
3. **Tiebreak:** Karts mit gleicher Rundenzahl ordnen sich nach Linien-Durchfahrt
   (früher überquert = weiter vorn).
4. **Leader-Auto-Ende:** Lap-Rennen (z. B. 5 Runden) endet automatisch, sobald der
   **Führende** Runde 5 abschließt; „Verbleibend" zählt die Rest-Runden des
   Führenden, nicht die Summe.
5. **Single-Kart-Regression:** mit einem Kart Grid/Anzeige/Auto-Ende exakt wie vor
   Phase 31 (keine Badges/Gaps).
6. **Zeit-/Frei-Rennen:** Ranking sichtbar, aber kein Lap-Auto-Ende.

## 8. Risiken / offene Punkte

- **Tiebreak-Genauigkeit:** `timeGapMs` ist der Abstand an der Linie (Differenz der
  letzten Durchfahrt-Zeitstempel), nicht der momentane Streckenabstand — bewusst
  vereinfacht, aus vorhandenen Daten ableitbar, ohne GPS-Distanzberechnung.
- **Sortier-Stabilität bei Rolling Start:** vor den ersten Durchfahrten sind alle
  Karts gleichwertig (0 Runden, unarmiert) — stabile Einfüge-Reihenfolge
  vermeidet „springende" Karten.
- **Aktiv-Kart-Highlight wandert:** durch die Sortierung kann die hervorgehobene
  Karte ihre Grid-Position ändern; gewollt, aber visuell zu beachten.
- **Auto-Ende-Timing:** Rennen endet, sobald der Führende `targetLaps` abschließt;
  andere Karts werden an ihrer aktuellen Position klassifiziert (Standard-
  Zielflaggen-Verhalten), keine „Auslauf-Runde".

## 9. Bewusst nicht enthalten (Phase 32 / deferred)

- **Live-Position als Strecken-Overlay** (Karten-/3D-Ansicht mit Positionsnummern).
- **Synchrones Replay aller Karts** (Replay zeigt weiter nur den aktiven Kart).
- **Kombinierter Mehr-Kart-Fahrerdialog** (bleibt „pro Kart einzeln" via Chip).
- **Gap als momentaner Streckenabstand** (statt Linien-Differenz).

## 10. Phase Map

- **Phase 30:** Ein Rennen / mehrere Karts — Per-Kart-Runden/Bestrunde/Sektor-Best/
  Stints, rolling start, Migration, minimale UI.
- **Phase 31 (dieses Design):** Leaderboard + Positions-Ranking — sortiertes Grid
  mit P-Badge + Gap, Leader-Auto-Ende bei Zielrunden, Runden-bis-Ziel des
  Führenden.
- **Phase 32 (deferred):** Live-Positions-Overlay, synchrones Multi-Kart-Replay,
  kombinierter Fahrerdialog, momentaner Streckenabstand-Gap.
