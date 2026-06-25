# Momentaner Streckenabstand-Gap — Design (Phase 36)

**Datum:** 2026-06-25
**Branch:** `feat/track-distance-gap` (von `main` nach Phase 35)
**Status:** Design genehmigt, bereit für Implementierungsplan

## 1. Ziel

Heute basiert der Gap/Intervall im Leaderboard auf der **Zeit-Differenz der
letzten Linien-Durchfahrten** (`k.lapStart`) — eine grobe „Lücke an der Linie".
Phase 36 ersetzt das durch den **momentanen Streckenabstand**: die tatsächliche
Distanz entlang der Strecke zwischen den Karts **jetzt**, in **Metern**. Bei
gleicher Rundenzahl bestimmt der Streckenfortschritt zusätzlich die Position
(mehr Fortschritt = weiter vorn) — genauer als der Durchfahrt-Zeitstempel.

**Bewusster Schnitt:** Letztes verbleibendes Multi-Kart-Item ist das **synchrone
Replay** (eigene spätere Phase, §9). Der im Phase-35-Review gefundene
Pit-Wall-Fahrername-Bug ist davon unabhängig.

## 2. Ausgangslage (bereits vorhanden)

- `geo.js`: `gpsDist(lat1,lon1,lat2,lon2)` (Punkt-Distanz in m), `traceDistanceM(trace)`
  (Polyline-Länge). **Keine** Punkt-auf-Polyline-Projektion. `node:test`-getestet.
- `lap-engine.js` `rankParticipants(race, lastCrossingByMac)` → sortiert nach
  (gültige Runden desc, früheste Durchfahrt asc); Ausgabe je Eintrag
  `{ mac, pos, laps, lapGap, timeGapMs, intervalLapGap, intervalMs }`.
  `timeGapMs`/`intervalMs` = Zeit-Differenz zum Führenden / Vordermann.
- `kart-overview.js`: baut `buildCrossings(state, r)` (`{mac: k.lapStart}`), ruft
  `rankParticipants`, `fmtGap(e)` zeigt `Gap +2.3s · Int +0.8s` (Phase 32) /
  `+N Runde(n)` / `Leader`.
- `map-draw.js` `drawKartMarkersOn`: baut inline dieselbe Crossing-Map, nutzt
  `rankParticipants` **nur** für die `P{pos}`-Reihenfolge (Gap-Felder ungenutzt).
- `state.track.points` = aufgezeichnete Strecken-Polyline (`[{lat,lon},…]`);
  `state.startGate` = Start/Ziel-Gate; `k.telemetry.lat/lon` = Live-Position je Kart.
- `live-ui.js`/`laps-drivers.js` nutzen `participantsOf`/`partValidLaps` (Rundenzahl),
  **nicht** die rankParticipants-Gap-Felder → von dieser Änderung **unberührt**.

## 3. Architektur

Gleiche bewährte Form: reine Geometrie in `geo.js` (TDD'd), reines Ranking in
`lap-engine.js` (TDD'd), dünne Verdrahtung in den Konsumenten.

### 3.1 `trackProgressM` (rein, TDD — `geo.js`)

```js
trackProgressM(point, trackPoints) → meters
```

- Projiziert `point = {lat,lon}` auf die Polyline `trackPoints` (jedes Segment:
  Lotfußpunkt / nächster Punkt am Segment) und liefert die **aufsummierte
  Distanz vom Strecken-Anfang (`trackPoints[0]`) bis zur nächstgelegenen
  Projektion** in Metern.
- Wählt das Segment mit der kleinsten Punkt-Segment-Distanz; bei der Projektion
  innerhalb eines Segments wird die anteilige Segmentlänge addiert.
- `0`, wenn `trackPoints.length < 2`.
- Rein (nutzt `gpsDist`), kein DOM/State.

### 3.2 Streckenfortschritt je Kart (Builder, DOM-Seite)

Ein kleiner Builder (in `kart-overview.js` **und** `map-draw.js`, ~Phase-33-
Präzedenz „kurze Duplikation für Modul-Unabhängigkeit") berechnet je Kart den
**runden-lokalen Fortschritt ab Start/Ziel-Linie**:

```
pts     = state.track.points
trackLen = traceDistanceM(pts)
gateOff  = (state.startGate && state.startGate.lat)
             ? trackProgressM(state.startGate, pts) : 0
je Kart: raw   = trackProgressM(k.telemetry, pts)
         onlap = trackLen > 0 ? ((raw - gateOff + trackLen) % trackLen) : 0
progressByMac[mac] = onlap
```

- **Anker an der Start/Ziel-Linie:** der Roh-Fortschritt wird um `gateOff`
  (Projektion des Gates) verschoben und modulo `trackLen` genommen, sodass
  `onlap = 0` an der Linie liegt. Das macht die Reihenfolge **über die
  Strecken-Naht** (`trackPoints[0]`) korrekt — sonst würden Karts beiderseits
  des Scan-Startpunkts falsch geordnet.
- **Ohne Strecke** (`trackLen == 0`): `onlap = 0` für alle → Position fällt auf
  reine Rundenordnung zurück (stabil), Gap zeigt `--`.

### 3.3 `rankParticipants` umgestellt (rein — `lap-engine.js`)

Eingabe wechselt von `lastCrossingByMac` (Zeitstempel) auf **`progressByMac`**
(runden-lokaler Fortschritt in Metern; **größer = weiter vorn**):

```js
rankParticipants(race, progressByMac) → [
  { mac, pos, laps, lapGap, distGapM, intervalLapGap, distIntM }, …
]
```

- **Sortierung:** gültige Runden **desc**, dann **Fortschritt desc** (neuer
  Tiebreak), Karts ohne Fortschritt stabil ans Ende.
- **Gaps in Metern** (ersetzen `timeGapMs`/`intervalMs`):
  - `distGapM` = bei gleicher Runde wie Führender (`lapGap === 0`):
    `leaderProgress − progress` (≥0, gerundet beim Anzeigen); sonst `0`.
  - `intervalLapGap` = `aheadLaps − laps`; `distIntM` = bei gleicher Runde wie
    Vordermann: `aheadProgress − progress`; sonst `0`.
  - `lapGap` = `leaderLaps − laps` (für „+N Runden").
- **Kein `trackLen` nötig** in `rankParticipants`: überrundete Karts zeigen
  „+N Runden" (nicht Meter), gleiche-Runde-Karts zeigen den Meter-Abstand aus dem
  runden-lokalen Fortschritt.

> **Bewusste Umstellung** der Phase-31-Funktion: die `node:test`-Fälle für
> Tiebreak/Gap werden auf Fortschritt/Meter umgeschrieben (Positions-/`lapGap`-
> Verhalten bleibt). Konsumenten, die nur `pos`/`laps` lesen (`map-draw`), sind
> nur durch die Eingabe-Map betroffen.

### 3.4 Konsumenten

- **`kart-overview.js`:** `buildCrossings` → `buildProgress` (3.2). `fmtGap`/
  `fmtDelta` zeigen Meter: `Gap +12 m · Int +5 m` (gleiche Runde),
  `+N Runde(n)` (überrundet), `Leader`. Ohne Strecke (alle `onlap=0`,
  `distGapM=0`) → `--` statt Meterwert.
- **`map-draw.js`:** Eingabe-Map auf `buildProgress` umstellen; nutzt weiter nur
  `posByMac` (Reihenfolge), Gap-Felder dort ungenutzt.

### 3.5 Datenfluss

```
kart-overview.render / map-draw.drawKartMarkersOn (Rennen >=2)
  progressByMac = buildProgress(state, r)   // onlap-Meter ab Start/Ziel
  ranked = rankParticipants(r, progressByMac)
  Position = ranked[i].pos
  Gap-Anzeige (kart-overview): distGapM/distIntM in Metern bzw. lapGap "+N Runden"
```

## 4. Randfälle

1. **Keine Strecke aufgezeichnet (`track.points<2`):** `trackLen=0` →
   Fortschritt 0; Position nach Runden (stabil), Gap `--`. Kein Crash.
2. **Kart ohne GPS-Fix:** `trackProgressM` projiziert auf ~Strecken-Anfang
   (kleiner Fortschritt); fällt in der Reihenfolge nach hinten — wie heute ohne
   Marker. (Akzeptiert; momentaner Wert.)
3. **Strecken-Naht (`trackPoints[0]`):** durch Gate-Anker + Modulo korrekt
   geordnet (3.2).
4. **Runden-Grenze:** GPS nahe Linie vs. gerade inkrementierte Rundenzahl kann
   kurz zappeln — akzeptiert (momentaner Gap).
5. **Single-Kart / <2 / kein Rennen:** kein Ranking, keine Gap-Anzeige — wie heute.
6. **Überrundeter Kart:** `lapGap>0` → „+N Runden" (kein Meterwert).

## 5. Tests / Verifikation

- **Neue/umgestellte reine Logik wird TDD'd:**
  - `geo.js` `trackProgressM` (`test/geo.test.js`): Punkt auf gerader Strecke →
    halbe Länge bei Mittelpunkt; Projektion innerhalb eines Segments; Wahl des
    nächstgelegenen Segments; leere Strecke → 0.
  - `lap-engine.js` `rankParticipants` (`test/lap-engine.test.js`): umgeschrieben
    auf `progressByMac` — Sortierung Runden desc + Fortschritt desc; `distGapM`/
    `distIntM` zum Führenden/Vordermann; `lapGap`/`intervalLapGap` bei
    Überrundung; Karts ohne Fortschritt hinten.
  - `node --test`-Baseline ändert sich netto (alte Gap-Tests umgeschrieben +
    `trackProgressM`-Tests dazu).
- **DOM-Verdrahtung** (`kart-overview.js`, `map-draw.js`): `node --check` +
  `npx eslint` + Grep-Asserts; bestehende Baselines grün.
- **Python unverändert:** `py_compile` + `unittest` → **50 OK**.
- **Funktionales Zwei-Kart-Verhalten (Meter-Gaps, Tiebreak) bleibt manuell** (§7).

## 6. Betroffene Dateien

| Aktion | Datei | Verantwortung |
|--------|-------|---------------|
| Ändern | `geo.js` | Neue reine `trackProgressM(point, trackPoints)`; im UMD-Export aufnehmen. |
| Ändern | `test/geo.test.js` | `node:test`-Fälle für `trackProgressM`. |
| Ändern | `lap-engine.js` | `rankParticipants`: Eingabe `progressByMac`, Ausgabe `distGapM`/`distIntM`, Tiebreak Fortschritt. |
| Ändern | `test/lap-engine.test.js` | `rankParticipants`-Gap/Tiebreak-Tests auf Fortschritt/Meter umschreiben. |
| Ändern | `kart-overview.js` | `buildProgress` statt `buildCrossings`; `fmtGap`/`fmtDelta` in Metern. |
| Ändern | `map-draw.js` | Eingabe-Map auf `buildProgress` umstellen (Reihenfolge unverändert genutzt). |

`pit-wall.js`, `live-ui.js`, `laps-drivers.js`, `races.js`, `package.json`,
`eslint.config.js` bleiben **unverändert** (`trackProgressM` ist Teil des
bestehenden `geo`-Globals; `RasiLapEngine` schon deklariert).

## 7. Manuelle Akzeptanz (Nutzer, Hardware/zwei Karts, mit Strecke)

1. **Meter-Gap:** zwei Karts auf gleicher Runde → Übersicht zeigt `Gap +N m`
   (Abstand zum Führenden) und `Int +M m` (zum Vordermann); Werte ändern sich
   live mit dem realen Abstand.
2. **Tiebreak:** bei gleicher Rundenzahl liegt der weiter vorn auf der Strecke
   befindliche Kart vorn — auch direkt nach der Start/Ziel-Linie korrekt.
3. **Überrundet:** ein überrundeter Kart zeigt `+1 Runde`.
4. **Ohne Strecke:** ohne aufgezeichnete Strecke Gap `--`, Position nach Runden.
5. **Single-Kart-Regression:** keine Gap-Anzeige; wie vor Phase 36.

## 8. Risiken / offene Punkte

- **Projektionskosten:** `trackProgressM` ist O(Strecken-Segmente) je Kart je
  Render; Strecken-Polylines können groß sein. ≤MAX_KARTS Karts; bei Bedarf
  später cachen/downsamplen — vorerst akzeptiert (Render-Rate moderat).
- **Naht-/Grenz-Genauigkeit:** Gate-Anker löst die Naht; die Runden-Grenze
  (Crossing vs. GPS) bleibt eine kleine momentane Unschärfe.
- **`rankParticipants`-Umstellung:** Signatur-/Ausgabe-Änderung; alle Aufrufer
  (`kart-overview`, `map-draw`) + Tests werden mitgezogen — bewusst, keine
  Parallel-Funktion.

## 9. Bewusst nicht enthalten (spätere Phasen)

- **Synchrones Multi-Kart-Replay** (eigene große Spec — `replay.js` + Aufnahme).
- **Pit-Wall-Fahrername-Fix** (renn-weites `r.currentDriverId`; eigener kleiner Fix).
- **Zeit-Gap aus Distanz/Tempo** (verworfen zugunsten Metern).
- **Projektions-Caching / Track-Downsampling.**

## 10. Phase Map

- **Phase 31–35:** Leaderboard → Polish → Live-Overlay → Map-Marker-Polish →
  kombinierter Fahrerdialog.
- **Phase 36 (dieses Design):** Momentaner Streckenabstand-Gap (Meter) +
  fortschrittsbasierter Positions-Tiebreak.
- **Phasen 37+ (deferred):** synchrones Replay, Pit-Wall-Fahrername-Fix.
