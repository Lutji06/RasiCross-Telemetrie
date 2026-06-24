# Multi-Kart Live-Positions-Overlay + Overtake-Highlight — Design (Phase 33)

**Datum:** 2026-06-24
**Branch:** `feat/multi-kart-live-overlay` (Folge auf Phase 32 / PR #51; stapelt darauf, bis Phase 32 in `main` ist)
**Status:** Design genehmigt, bereit für Implementierungsplan

## 1. Ziel

Phase 31/32 lieferten das Leaderboard (Positions-Ranking, Gap·Int, Fastest-Lap).
Phase 33 bringt die Positionen auf die **Live-Strecke** und macht
Positionswechsel sichtbar:

1. **Live-Positions-Overlay** — die Live-Streckenkarte (`trackCanvas`) zeichnet
   bisher nur **einen** Punkt (den aktiven Kart). Künftig werden **alle**
   verbundenen Karts als farbige Marker gezeichnet; bei laufendem Rennen
   (≥2 Teilnehmer) trägt jeder Marker seine Positionsnummer `P{pos}`. Der aktive
   Kart bleibt hervorgehoben (größer + Glow).
2. **Overtake-Highlight** — steigt ein Kart im Übersicht-Grid eine Position auf,
   pulst seine Karte kurz golden (nur Gewinn).

**Bewusster Schnitt:** synchrones Multi-Kart-Replay, kombinierter Fahrerdialog
und momentaner Streckenabstand-Gap bleiben **Phase 34 / deferred** (siehe §9).

## 2. Ausgangslage (bereits vorhanden)

- `map-draw.js` `drawTrackOn(c)`: zeichnet Strecke, Linien, Sektoren, Heatmap,
  Ghost-Runde und **genau einen** GPS-Punkt aus `state.telemetry.lat/lon`
  (~Zeile 120–131). `state.telemetry` ist die **aktive-Kart-Fassade** → nur der
  aktive Kart erscheint. `gpsXYOnCanvas(lat, lon, c)` projiziert GPS→Canvas.
  `drawTrackOn` wird für `trackCanvas` (Live) **und** `scanCanvas` (Strecke-Tab)
  aufgerufen; die Ghost-Runde ist bereits auf `c.id === 'trackCanvas'` gegated.
- `kart-registry.js`: jeder Kart hat eigene `telemetry.lat/lon` (Zeile 23) — die
  Live-Position **pro Kart** ist also vorhanden.
- `kart-overview.js`: `render(state)` berechnet bei laufendem Rennen (≥2
  Teilnehmer) `ranking = RasiLapEngine.rankParticipants(r, buildCrossings(state,
  r))` und zeichnet Karten in Positions-Reihenfolge mit `P{pos}`-Badge,
  Gap·Int-Zeile (Phase 32) und Fastest-Lap-Chip. Lokaler Helfer
  `buildCrossings(state, r)` (Linien-Durchfahrt-Zeitstempel je Teilnehmer).
- `RasiKartBar.metaFor(state, mac, idx)` → `{ name, color }` je Kart (für
  Farben), bereits von `kart-overview.js` genutzt.
- `lap-engine.js`: reines UMD `window.RasiLapEngine` mit `rankParticipants` etc.,
  `node:test` (152 Tests nach Phase 32).

## 3. Architektur

Gleiche bewährte Form: reine Logik in `lap-engine.js` (TDD'd), dünne
Canvas-/DOM-Verdrahtung.

### 3.1 `positionGains` (rein, TDD)

Neue reine Funktion in `lap-engine.js`:

```js
positionGains(prevPosByMac, ranked) → [mac, …]   // Karts, die aufgestiegen sind
```

Liefert die `mac`s, deren Position sich **verbessert** hat: `prevPosByMac[mac]`
existiert **und** der neue `pos` (aus `ranked`) ist **kleiner** als der vorherige
(kleinere Zahl = weiter vorn). Neueinsteiger (kein `prevPosByMac[mac]`) und
Abstiege werden ignoriert. Rein, kein DOM, kein State.

### 3.2 Overtake-Highlight (`kart-overview.js` + CSS)

- Modul-lokaler State: `prevPosByMac` (letzte Positionen) und `overtakeAtByMac`
  (Zeitstempel des letzten Aufstiegs je Kart).
- In `render` bei aktivem Ranking:
  - `gains = RasiLapEngine.positionGains(prevPosByMac, ranked)`;
  - für jeden `mac` in `gains`: `overtakeAtByMac[mac] = now`;
  - danach `prevPosByMac` aus `ranked` neu setzen.
- Eine Karte bekommt die Klasse `ko-overtake`, solange
  `now - overtakeAtByMac[mac] < OVERTAKE_MS` (≈ 1200 ms).
- **Ohne aktives Ranking** (Rennen beendet / <2 Teilnehmer): `prevPosByMac` und
  `overtakeAtByMac` werden geleert, damit ein neues Rennen frisch startet.
- **CSS `.ko-overtake`:** ein **gehaltener goldener Glow** (`box-shadow`), keine
  CSS-Keyframe-Animation. Das Grid baut `innerHTML` jeden Frame neu auf; eine
  Keyframe-Animation würde bei jedem Rebuild neu starten (Flackern). Ein für die
  Dauer gehaltener statischer Glow ist rebuild-sicher und verschwindet nach dem
  Fenster.

### 3.3 Live-Positions-Overlay (`map-draw.js`)

- Neue Funktion `drawKartMarkersOn(c, ctx)`, aufgerufen in `drawTrackOn`
  **nur für `c.id === 'trackCanvas'`** (Live-Karte; `scanCanvas`/`editorCanvas`
  bleiben unverändert). Sie **ersetzt** den heutigen einzelnen GPS-Punkt-Block
  (~Zeile 120–131).
- Für jeden `mac` in `state.karts.macs()`:
  - Kart `k = state.karts.get(mac)`; ohne gültige `k.telemetry.lat/lon`
    (Werte `0`/falsy = kein Fix) → übersprungen (kein Marker).
  - `xy = gpsXYOnCanvas(k.telemetry.lat, k.telemetry.lon, c)`.
  - Farbe = Kart-Farbe via `RasiKartBar.metaFor(state, mac, idx)`.
  - **Aktiver Kart** (`mac === state.activeKartMac`): größerer Radius + Glow
    (übernimmt die heutige Hervorhebung); andere kleiner.
  - **Stale** (`k.connection.lastPacketAt` älter als ~2 s): Marker **gedimmt**
    (reduzierte Deckkraft), aber an letzter Position weiter gezeichnet.
- **Positionsnummern:** Nur bei laufendem Rennen mit ≥2 Teilnehmern. `map-draw.js`
  berechnet die Rangfolge selbst (baut die Crossing-Map inline + ruft
  `RasiLapEngine.rankParticipants`) und beschriftet jeden Marker mit `P{pos}`
  oberhalb des Punkts. Die ~5 Zeilen Crossing-Builder werden bewusst aus
  `kart-overview.buildCrossings` dupliziert, um die Module unabhängig zu halten
  (statt gemeinsamen State zu teilen).
- **Single-Kart / kein Rennen:** „alle verbundenen Karts" = nur der aktive Kart
  → genau ein hervorgehobener Punkt, optisch ≈ heute (keine P-Nummern).
  Rückwärtskompatibel.

### 3.4 ESLint

Der `map-draw.js`-Block in `eslint.config.js` erhält `RasiLapEngine` und
`RasiKartBar` (sowie `kartRegistry`-Globals, falls noch nicht vorhanden), damit
die neuen Konsumenten 0 Fehler linten. `positionGains` ist Methode des
bestehenden `RasiLapEngine`-Globals → in `kart-overview.js` keine neue Global.

## 4. Datenfluss

```
Render-Tick
  drawTrack → drawTrackOn(trackCanvas)
    → drawKartMarkersOn(trackCanvas, ctx)
        je Kart: gpsXYOnCanvas(k.telemetry.lat/lon) → farbiger Marker
                 aktiv: groß+Glow; stale: gedimmt
        bei Rennen ≥2: rankParticipants → P{pos}-Label je Marker
kart-overview.render (laufendes Rennen, >=2)
  → ranked = rankParticipants(...)
  → gains = positionGains(prevPosByMac, ranked)
  → overtakeAtByMac[mac] = now (für gains); prevPosByMac aktualisieren
  → Karte mit now-overtakeAtByMac[mac] < OVERTAKE_MS → Klasse ko-overtake (Glow)
```

## 5. Randfälle

1. **Single-Teilnehmer / <2 Karts:** kein Overtake-Highlight (kein Ranking);
   Live-Karte zeigt einen hervorgehobenen Punkt wie heute, keine P-Nummern.
2. **Rolling Start (alle 0 Runden):** Ranking ordnet die Karts; `positionGains`
   feuert erst bei echtem Positionswechsel — kein Fehl-Glow beim Start.
3. **Kart ohne GPS-Fix (`lat/lon` 0):** kein Marker auf der Karte (übersprungen).
4. **Stale/getrennter Kart:** Marker bleibt an letzter Position, **gedimmt**;
   Position/Highlight im Grid unverändert (Phase-31/32-Verhalten).
5. **Rennende / Wechsel <2 Teilnehmer:** Overtake-State (`prevPosByMac`,
   `overtakeAtByMac`) wird geleert; P-Nummern verschwinden von der Karte.
6. **Aktiver Kart gewechselt (Chip):** der hervorgehobene Marker wandert auf den
   neuen aktiven Kart; Sortierung/Position unberührt.
7. **Overtake-Glow-Rebuild:** statischer Glow für `OVERTAKE_MS` gehalten, jeden
   Frame neu berechnet → kein Flackern trotz `innerHTML`-Rebuild.

## 6. Tests / Verifikation

- **Neue Pure-Logik wird TDD'd** in `lap-engine.js` (`test/lap-engine.test.js`):
  - `positionGains`: Aufstieg erkannt (z. B. P3→P1); kein Gain bei gleicher
    Position; Neueinsteiger ohne Vorposition ignoriert; Abstieg ignoriert;
    mehrere gleichzeitige Aufsteiger.
  - Baseline `node --test` wächst von **152** auf **~156**.
- **Canvas-/DOM-Verdrahtung** (`map-draw.js`, `kart-overview.js`): `node --check`
  + `npx eslint` + Grep-Asserts; bestehende Baselines grün. Canvas-Rendering
  selbst wird **nicht** unit-getestet (kein DOM/Canvas in `node:test`) —
  verifiziert per `node --check`/ESLint/Grep + manuelle Hardware-Akzeptanz.
- **Python unverändert:** `python -m py_compile bridge.py`;
  `python -m unittest discover -s test -p "test_*.py"` → **50 OK**.
- **Funktionales Multi-Kart-Verhalten (zwei Karts, Hardware) bleibt manuell** —
  Akzeptanzliste §7.

## 7. Betroffene Dateien

| Aktion | Datei | Verantwortung |
|--------|-------|---------------|
| Ändern | `lap-engine.js` | Neue reine `positionGains(prevPosByMac, ranked)`; im UMD-Return exportieren. |
| Ändern | `test/lap-engine.test.js` | `node:test`-Fälle für `positionGains`. |
| Ändern | `kart-overview.js` | `prevPosByMac`/`overtakeAtByMac`-State; `positionGains`-Aufruf; Klasse `ko-overtake` bei Aufstieg; State-Reset ohne Ranking. |
| Ändern | `RasiCross_Telemetry.html` | CSS `.ko-overtake` (gehaltener goldener Glow). |
| Ändern | `map-draw.js` | `drawKartMarkersOn(c, ctx)` ersetzt den Einzel-GPS-Punkt auf `trackCanvas`; Marker je Kart (Farbe, aktiv=Glow, stale=gedimmt) + `P{pos}`-Label bei Rennen ≥2. |
| Ändern | `eslint.config.js` | `RasiLapEngine`/`RasiKartBar`(/kartRegistry) im `map-draw.js`-Block. |

`pit-wall.js`, `live-ui.js`, `laps-drivers.js`, `races.js`, `package.json` und der
`<script>`-Include bleiben **unverändert**.

## 8. Manuelle Akzeptanz (Nutzer, Hardware/zwei Karts)

1. **Marker:** Live-Karte zeigt für jeden verbundenen Kart einen Marker in
   Kart-Farbe; der aktive Kart ist größer/mit Glow.
2. **Positionsnummern:** Im laufenden Rennen (≥2) trägt jeder Marker `P{pos}`,
   passend zum Leaderboard.
3. **Stale:** Ein Kart ohne aktuelle Pakete bleibt an letzter Position, gedimmt.
4. **Overtake:** Überholt Kart B Kart A, pulst B's Übersicht-Karte kurz golden.
5. **Single-Kart-Regression:** mit einem Kart ein hervorgehobener Punkt wie vor
   Phase 33; kein Overtake-Glow.
6. **Rennende:** P-Nummern verschwinden von der Karte; Overtake-State zurückgesetzt.

## 9. Risiken / offene Punkte

- **Render-Last:** `drawKartMarkersOn` läuft pro Frame über ≤MAX_KARTS Karts —
  vernachlässigbar; Ranking-Berechnung nur bei aktivem Rennen.
- **Crossing-Builder-Duplikat:** ~5 Zeilen in `map-draw.js` parallel zu
  `kart-overview.buildCrossings` — bewusst, für Modul-Unabhängigkeit. Falls das
  später stört, kann ein gemeinsamer Helfer folgen.
- **Overtake-Glow vs. Rebuild:** statischer Glow (kein Keyframe) gewählt, weil
  `kart-overview` das Grid je Frame neu aufbaut.
- **Marker-Lesbarkeit bei Überlappung:** zwei nah beieinander stehende Karts
  können Marker/Labels überlappen — akzeptiert (keine Kollisionsauflösung in
  Phase 33).

## 10. Bewusst nicht enthalten (Phase 34 / deferred)

- **Synchrones Replay aller Karts** (Replay zeigt weiter nur den aktiven Kart).
- **Kombinierter Mehr-Kart-Fahrerdialog.**
- **Gap als momentaner Streckenabstand** (statt Linien-Differenz).
- **Overtake-Highlight am Karten-Marker** (Phase 33: nur Übersicht-Karte).
- **Kollisionsauflösung überlappender Marker/Labels.**

## 11. Phase Map

- **Phase 31:** Leaderboard + Positions-Ranking (Grid, P-Badge, Gap, Auto-Ende).
- **Phase 32:** Leaderboard-Polish (Intervall, Fastest-Lap) + Pit-Wall-OLED-Fix.
- **Phase 33 (dieses Design):** Live-Positions-Overlay (Marker + P-Nummern auf
  der Strecke) + Overtake-Highlight (Übersicht-Karten, Gewinn).
- **Phase 34 (deferred):** synchrones Replay, kombinierter Fahrerdialog,
  momentaner Streckenabstand-Gap, Marker-Overtake-Highlight, Marker-Kollision.
