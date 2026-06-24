# Multi-Kart Leaderboard-Polish + Pit-Wall-Fix — Design (Phase 32)

**Datum:** 2026-06-24
**Branch:** Folge auf Phase 31 (gemergt via PR #50 in `main`)
**Status:** Design genehmigt, bereit für Implementierungsplan

## 1. Ziel

Phase 31 lieferte Live-Positions-Ranking (sortiertes Übersicht-Grid mit
`P{pos}`-Badge + Gap zum Führenden) und Leader-Auto-Ende. Phase 32 ist eine
**Konsolidierungs-/Polish-Phase**: drei Leaderboard-Verfeinerungen plus ein
isolierter Bugfix am OLED-Pit-Wall-Payload.

1. **Intervall zum Vordermann** — zusätzlich zum Gap zum Führenden auch den
   Abstand zum direkt davorliegenden Kart (Position n−1) anzeigen.
2. **Schnellste-Runde-Badge (Lila)** — den Kart mit der absolut schnellsten
   gültigen Runde im Rennen mit einem lila „⚡FL"-Badge markieren.
3. **Review-Nits** aus Phase 31 aufräumen.
4. **Pit-Wall-OLED-Fix** — der OLED-Display-Payload zählt aktuell die Summe
   **aller** Karts (`raceValidLaps`); er soll die Runden des **aktiven** Karts
   zeigen (analog zur bereits korrekten On-Screen-Pit-Wall).

**Bewusster Schnitt:** Overtake-/Positionswechsel-Highlight, Live-Positions-
Overlay auf der Strecke, synchrones Multi-Kart-Replay, kombinierter
Fahrerdialog und momentaner Streckenabstand-Gap sind **Phase 33 / deferred**
(siehe §9).

## 2. Ausgangslage (bereits vorhanden, nach Phase 31)

- `lap-engine.js` `rankParticipants(race, lastCrossingByMac)` → sortiertes
  `[{ mac, pos, laps, lapGap, timeGapMs }]` (Zeile ~136–169). `lapGap`/`timeGapMs`
  sind der Abstand zum **Führenden**. Jeder Teilnehmer-Slot führt `bestLapMs`
  /`bestLapNum` (von `commitLap` gepflegt).
- `kart-overview.js` `render(state)`: zeichnet Karten in Positions-Reihenfolge;
  Helfer `buildCrossings(state, r)` und `fmtGap(e)`; Badge + Gap-Zeile nur bei
  laufendem Rennen mit ≥2 Teilnehmern. Hat `RasiLapEngine`/`activeRace` als
  ESLint-Globals.
- `pit-wall.js`:
  - `updatePitWall` (~Zeile 50–54): On-Screen-Pit-Wall, zeigt **bereits** die
    Runden des **aktiven** Karts (`_pwPart` via `RasiLapEngine.getOrCreatePart`).
    **Korrekt, bleibt unverändert.**
  - OLED-Display-Payload-Builder (~Zeile 353): `const validLaps =
    raceValidLaps(r).length;` … `lapn: validLaps + 1`. Da `raceValidLaps` seit
    Phase 30 über **alle** Teilnehmer aggregiert (`flatValidLaps`), zeigt das
    OLED bei Multi-Kart die **Summe** statt der Runde des aktiven Karts. **Das
    ist der Bug.** Der Payload ist sonst aktiv-kart-orientiert (nutzt
    `state.lapStart`, `state.bestLapMs` über die Fassade).

## 3. Architektur

Gleiche bewährte Form wie Phase 31: reine Logik in `lap-engine.js` (per
`node:test` TDD'd), dünne UI-Verdrahtung in `kart-overview.js`, isolierter
Payload-Fix in `pit-wall.js`.

### 3.1 Intervall zum Vordermann (`rankParticipants`-Erweiterung)

`rankParticipants` bekommt **zwei zusätzliche Felder** je Ergebnis-Eintrag:
`intervalMs` und `intervalLapGap` — der Abstand zum Kart auf Position n−1 (dem
**Vordermann**), analog zu `timeGapMs`/`lapGap` (die zum **Führenden** bleiben):

```js
{ mac, pos, laps, lapGap, timeGapMs, intervalLapGap, intervalMs }
```

Berechnung in der zweiten Schleife (`out`-Aufbau), wo `j` der Index in der
sortierten Liste ist:

- Führender (`j === 0`): `intervalLapGap = 0`, `intervalMs = 0`.
- Sonst, Vordermann `ahead = list[j-1]`:
  - `intervalLapGap = ahead.laps - e.laps`.
  - `intervalMs = (intervalLapGap === 0 && e.cross != null && ahead.cross != null)
    ? e.cross - ahead.cross : 0`.

Die bestehenden `lapGap`/`timeGapMs` (zum Führenden) bleiben **unverändert**.
Für Position 2 gilt `ahead == Führender`, also `intervalMs == timeGapMs` und
`intervalLapGap == lapGap` — korrekt (Vordermann ist der Führende), kein Bug.

### 3.2 Schnellste-Runde-Halter (`fastestLapHolder`)

Neue reine Funktion in `lap-engine.js`:

```js
fastestLapHolder(race) → { mac, ms, num } | null
```

Iteriert `participantsOf(race)` und liefert den Teilnehmer mit dem kleinsten
`bestLapMs` (samt `mac` und `bestLapNum`); `null`, wenn kein Teilnehmer eine
Bestrunde hat. Reine Ableitung aus den gepflegten `participant.bestLapMs`.

### 3.3 Gap·Int-Zeile + Fastest-Lap-Badge (`kart-overview.js`)

- **Gap·Int-Zeile:** Die bestehende `ko-gap`-Zeile zeigt für Nicht-Führende
  beide Werte kompakt: `Gap {gapToLeader} · Int {intervalToAhead}` (z. B.
  `Gap +2.3s · Int +0.8s`). Führender: `Leader`. Für Position 2 sind Gap und
  Int identisch (Vordermann = Führender). Beide Werte werden über dieselbe
  Formatierungs-Logik wie heute (`fmtGap`-Stil: `+x.xs` bzw. `+N Runde(n)`)
  aus `timeGapMs`/`lapGap` (Gap) und `intervalMs`/`intervalLapGap` (Int)
  gebildet.
- **Fastest-Lap-Badge:** `holder = RasiLapEngine.fastestLapHolder(r)`. Die Karte
  mit `mac === holder.mac` bekommt ein lila **„⚡FL"**-Chip im Karten-Kopf
  (neben dem `P{pos}`-Badge) und ihr „Beste Runde"-Wert wird lila eingefärbt.
- **Gate:** Beides nur bei laufendem Rennen mit **≥2 Teilnehmern** (identisch
  zur Phase-31-Bedingung). Ohne aktives Ranking bleibt das Grid exakt wie heute.
- **CSS** (`RasiCross_Telemetry.html`): neue Klasse `.ko-fl` (lila Chip) und ein
  lila Modifier für den Bestrunden-Wert. Die `ko-gap`-Zeile bleibt strukturell
  gleich (nur mehr Text).

### 3.4 Pit-Wall-OLED-Fix (`pit-wall.js`)

Im OLED-Payload-Builder (~Zeile 353) wird die Runden-Quelle vom Summen-Aggregat
auf den **aktiven** Kart umgestellt — derselbe `_pwPart`-Zugriff, den
`updatePitWall` bereits nutzt:

```js
// vorher:
const validLaps = raceValidLaps(r).length;
// nachher:
const _oledPart = RasiLapEngine.getOrCreatePart(
  r, state.activeKartMac || KartRegistry.DEFAULT_MAC, r.startDriverId,
  r.startedAt || Date.now());
const validLaps = RasiLapEngine.partValidLaps(_oledPart).length;
```

`lapn: validLaps + 1` (aktuelle Runde des aktiven Karts) bleibt; nur die Quelle
ändert sich. `RasiLapEngine`/`KartRegistry` sind in `pit-wall.js` seit Phase 31
**nicht** zwingend als ESLint-Globals deklariert (Phase 31 ließ `pit-wall.js`
unberührt) — falls ESLint sie als undefiniert meldet, müssen sie im
`pit-wall.js`-Block ergänzt werden (siehe §6).

### 3.5 Review-Nits (Phase-31-Aufräumen)

- `lap-engine.js` ~Zeile 146: `cross: (c != null ? c : null)` → `cross: c`
  (No-op-Normalisierung; `undefined`/`null` werden im Komparator ohnehin via
  `!= null` gleich behandelt). Verhalten unverändert; durch bestehende Tests
  abgesichert.
- Die „Leader"-Gap-Zeile geht in der neuen Gap·Int-Zeile auf: der Führende zeigt
  genau einmal `Leader`, keine redundante Zeile.

## 4. Datenfluss

```
kart-overview.render (laufendes Rennen, >=2 Teilnehmer)
  → ranked = rankParticipants(r, buildCrossings(state, r))
       jetzt mit intervalMs / intervalLapGap je Eintrag
  → holder = fastestLapHolder(r)
  → je Karte: Gap·Int-Zeile + (mac == holder.mac ? lila ⚡FL + lila Bestzeit : –)
pit-wall OLED-Payload
  → validLaps = partValidLaps(aktiver Teilnehmer)   // statt Summe
  → lapn = validLaps + 1
```

## 5. Randfälle

1. **Single-Teilnehmer / <2 Karts:** keine Badges, keine Gap·Int-Zeile, kein
   FL-Chip — Grid optisch identisch zu Phase 31. OLED zeigt die Runde des einen
   (= aktiven) Karts wie bisher.
2. **Rolling Start (alle 0 Runden):** `fastestLapHolder` = `null` (kein
   `bestLapMs`) → kein lila Chip; Intervalle 0/`Leader` bis Runden gezählt werden.
3. **Position 2:** Vordermann = Führender → `Int == Gap`. Korrekt, kein Bug.
4. **Überrundeter Kart:** `intervalLapGap > 0` → `Int` zeigt `+N Runde(n)`
   (wie `Gap`).
5. **Fastest-Lap-Gleichstand:** zwei Karts mit identischem `bestLapMs` → erster
   Teilnehmer in `participantsOf`-Reihenfolge gewinnt das Chip (deterministisch,
   stabil).
6. **OLED Single-Kart-Regression:** aktiver Kart = einziger Kart → `lapn`
   identisch zur heutigen App.

## 6. Tests / Verifikation

- **Neue/erweiterte Pure-Logik wird TDD'd** in `lap-engine.js`
  (`test/lap-engine.test.js`):
  - `rankParticipants` Intervall: `intervalMs`/`intervalLapGap` für P2 (== Gap),
    P3 (zum Vordermann, nicht zum Führenden), überrundeter Vordermann.
  - `fastestLapHolder`: Halter-`mac`/`ms`/`num` korrekt; `null` ohne Bestrunde;
    Gleichstand → erster Teilnehmer.
  - Baseline `node --test` wächst von **147** auf **~152**.
- **DOM-/Payload-Verdrahtung** (`kart-overview.js`, `pit-wall.js`): `node --check`
  + `npx eslint` + Grep-Asserts; bestehende Baselines grün. Falls `pit-wall.js`
  neue Globals braucht, `eslint.config.js` `pit-wall.js`-Block ergänzen
  (`RasiLapEngine`/`KartRegistry`).
- **Python unverändert:** `python -m py_compile bridge.py`;
  `python -m unittest discover -s test -p "test_*.py"` → **50 OK**.
- **Funktionales Multi-Kart-Verhalten (zwei Karts, Hardware) bleibt manuell** —
  Akzeptanzliste §7.

## 7. Betroffene Dateien

| Aktion | Datei | Verantwortung |
|--------|-------|---------------|
| Ändern | `lap-engine.js` | `rankParticipants`: `intervalMs`/`intervalLapGap` je Eintrag; neue `fastestLapHolder(race)`; No-op-Nit `cross: c`. Beide im UMD-Return exportieren (`fastestLapHolder`). |
| Ändern | `test/lap-engine.test.js` | `node:test`-Fälle für Intervall + Fastest-Lap-Halter. |
| Ändern | `kart-overview.js` | Gap·Int-Zeile; lila „⚡FL"-Chip + lila Bestzeit für den Fastest-Lap-Halter; Gate ≥2 Teilnehmer. |
| Ändern | `RasiCross_Telemetry.html` | CSS `.ko-fl` (lila Chip) + lila Bestrunden-Modifier. |
| Ändern | `pit-wall.js` | OLED-Payload `lapn` = Runden des aktiven Karts (`_pwPart`-Muster) statt `raceValidLaps`-Summe. |
| Ändern | `eslint.config.js` | **Nur falls nötig:** `RasiLapEngine`/`KartRegistry` im `pit-wall.js`-Block; `fastestLapHolder` ist Methode des bestehenden `RasiLapEngine`-Globals → keine neue Global in `kart-overview.js`. |

`live-ui.js`, `laps-drivers.js`, `races.js`, `package.json` und der
`<script src="lap-engine.js">`-Include bleiben **unverändert**.

## 8. Manuelle Akzeptanz (Nutzer, Hardware/zwei Karts)

1. **Intervall:** Bei ≥3 Karts zeigt jede Karte `Gap` (zum Führenden) **und**
   `Int` (zum Vordermann); für P2 sind beide gleich.
2. **Fastest Lap:** Der Kart mit der absolut schnellsten Runde trägt ein lila
   „⚡FL"-Chip; wechselt der Rekord, wandert das Chip.
3. **Pit-Wall-OLED:** Der OLED-Rundenzähler zeigt die Runde des **aktiven**
   Karts (Chip-Wechsel ändert ihn), nicht mehr die Summe aller Karts.
4. **Single-Kart-Regression:** mit einem Kart Grid + OLED exakt wie vor Phase 32
   (keine Badges/Int/FL).
5. **Rolling Start:** kein FL-Chip, bis die erste Runde gezählt ist.

## 9. Risiken / offene Punkte

- **Karten-Dichte:** Die Gap·Int-Zeile trägt mehr Text auf einer kleinen Karte.
  Kompakt halten (`Gap … · Int …`); kein zweizeiliges Layout nötig.
- **Fastest-Lap-Quelle:** `participant.bestLapMs` muss zuverlässig gepflegt sein
  (ist es seit Phase 30 via `commitLap`); `fastestLapHolder` rechnet nur ab, hält
  keinen eigenen State.
- **Pit-Wall-Globals:** `pit-wall.js` wurde in Phase 31 bewusst nicht angefasst;
  der OLED-Fix bringt erstmals `RasiLapEngine`/`KartRegistry` hinein — ESLint-
  Block ggf. ergänzen (verifiziert via `npx eslint pit-wall.js`).

## 10. Bewusst nicht enthalten (Phase 33 / deferred)

- **Overtake-/Positionswechsel-Highlight** (braucht Vorzustands-Vergleich).
- **Live-Positions-Overlay** auf Strecke/3D-Ansicht.
- **Synchrones Replay aller Karts.**
- **Kombinierter Mehr-Kart-Fahrerdialog.**
- **Gap als momentaner Streckenabstand** (statt Linien-Differenz).

## 11. Phase Map

- **Phase 30:** Per-Kart-Runden/Bestrunde/Sektor-Best/Stints, rolling start,
  Migration.
- **Phase 31:** Leaderboard + Positions-Ranking — sortiertes Grid, P-Badge,
  Gap zum Führenden, Leader-Auto-Ende, Runden-bis-Ziel.
- **Phase 32 (dieses Design):** Leaderboard-Polish (Intervall zum Vordermann,
  Fastest-Lap-Badge, Review-Nits) + Pit-Wall-OLED-Fix.
- **Phase 33 (deferred):** Overtake-Highlight, Live-Positions-Overlay,
  synchrones Replay, kombinierter Fahrerdialog, momentaner Streckenabstand-Gap.
