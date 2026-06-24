# Map-Marker-Polish — Marker-Overtake + Label-Kollision — Design (Phase 34)

**Datum:** 2026-06-24
**Branch:** `feat/map-marker-polish` (Folge auf Phase 33 / PR #52; gestapelt, bis #51/#52 in `main` sind)
**Status:** Design genehmigt, bereit für Implementierungsplan

## 1. Ziel

Phase 33 brachte Per-Kart-Marker + Positionsnummern auf die Live-Streckenkarte.
Phase 34 poliert dieses Overlay mit zwei kleinen, zusammenhängenden Features in
`map-draw.js`:

1. **Marker-Overtake-Highlight** — überholt ein Kart (steigt eine Position auf),
   bekommt sein Marker auf der Karte kurz einen goldenen Ring (analog zum
   Übersicht-Karten-Glow aus Phase 33).
2. **Marker/Label-Kollisionsauflösung** — stehen zwei Karts nah beieinander,
   überlappen ihre `P{pos}`-Labels. Die Labels werden vertikal entzerrt
   (Declutter), damit sie lesbar bleiben; die Marker selbst bleiben an ihrer
   echten GPS-Position.

**Bewusster Schnitt:** Dies ist die **erste** von mehreren Phase-34-Slices. Die
übrigen Deferred-Items aus Phase 33 — synchrones Multi-Kart-Replay, kombinierter
Fahrerdialog, momentaner Streckenabstand-Gap — sind **eigene spätere Phasen**
(je eigene Spec, siehe §9).

## 2. Ausgangslage (bereits vorhanden, nach Phase 33)

- `map-draw.js` `drawKartMarkersOn(c, ctx)`: zeichnet je verbundenem Kart einen
  farbigen Marker an `k.telemetry.lat/lon` (aktiv größer+Glow, stale gedimmt) und
  — bei laufendem Rennen mit ≥2 Teilnehmern — ein `P{pos}`-Label oberhalb des
  Markers. Die Rangfolge wird inline berechnet (`RasiLapEngine.rankParticipants`
  mit einer inline gebauten Crossing-Map). Kart-Farbe wird aus `state.kartMeta`
  gelesen (kein localStorage-Write im Draw-Loop).
- `lap-engine.js` `positionGains(prevPosByMac, ranked)`: reine Funktion, liefert
  die `mac`s, die gegenüber `prevPosByMac` aufgestiegen sind (Phase 33). Wird
  bereits von `kart-overview.js` für den Karten-Overtake-Glow genutzt.
- `kart-overview.js` hält **eigenen** modul-lokalen Overtake-State
  (`prevPosByMac`/`overtakeAtByMac`, `OVERTAKE_MS = 1200`) und vergibt die
  Klasse `ko-overtake` (goldener Glow `rgba(255,200,60,…)`).
- `geo.js`: dependency-freies UMD `window`/`module.exports`-Modul mit reiner
  Geometrie/Format-Logik (`gpsDist`, `segmentsCross`, `ghostPointAt`, …), per
  `node:test` getestet (`test/geo.test.js`). Richtiger Ort für eine reine
  Label-Declutter-Funktion.

## 3. Architektur

Gleiche bewährte Form: reine Logik in `geo.js` (TDD'd), dünne Canvas-Verdrahtung
in `map-draw.js`.

### 3.1 Marker-Overtake-Highlight (`map-draw.js`)

- `map-draw.js` bekommt **eigenen** modul-lokalen Overtake-State:
  `let _prevPosByMac = {}`, `let _overtakeAtByMac = {}`, `const MARKER_OVERTAKE_MS
  = 1200`. (Eigene Kopie, unabhängig von `kart-overview.js` — analog zur in
  Phase 33 bewusst duplizierten Crossing-Map; `map-draw` rechnet die Rangfolge
  ohnehin jeden Frame, ist also der natürliche Besitzer eines Frame-getriebenen
  Overtake-States.)
- In `drawKartMarkersOn`, sobald die Rangfolge aktiv ist (`posByMac` gesetzt):
  - `RasiLapEngine.positionGains(_prevPosByMac, ranked)` → für jede zurückgegebene
    `mac`: `_overtakeAtByMac[mac] = now`;
  - danach `_prevPosByMac` aus der aktuellen Rangfolge neu setzen.
  - Ist die Rangfolge **nicht** aktiv (kein Rennen / <2): beide Maps leeren.
  - (Dazu muss `drawKartMarkersOn` die gerankte Liste behalten, nicht nur
    `posByMac` — der Ranking-Aufruf liefert ein Array; daraus wird sowohl
    `posByMac` als auch `_prevPosByMac` gebildet.)
- Beim Zeichnen eines Markers: ist `now - _overtakeAtByMac[mac] <
  MARKER_OVERTAKE_MS`, wird **zusätzlich** zum Punkt ein goldener Ring gezogen
  (gestrichelt/voll, `strokeStyle` Gold ~`rgba(255,200,60,.9)`, Radius etwas
  größer als der Marker). Der Ring erbt die `globalAlpha`-Dimmung des Markers
  (stale-überholendes Kart bleibt konsistent gedimmt).

### 3.2 Label-Kollisionsauflösung (`geo.js` + `map-draw.js`)

Neue reine Funktion in `geo.js`:

```js
declutterLabels(points, minGapY, minGapX) → [y0, y1, …]
```

- `points`: Array `[{ x, y }]` (Label-Anker in Canvas-Pixeln, Eingabe-Reihenfolge).
- Liefert ein Array **angepasster y-Werte** (gleiche Länge/Reihenfolge wie
  `points`), sodass keine zwei Labels, deren x-Abstand `< minGapX` ist, einen
  y-Abstand `< minGapY` haben.
- Verfahren: stabile Sortierung nach y; greedy von oben nach unten — kollidiert
  ein Label (x-Nähe `< minGapX`) mit einem bereits platzierten, wird sein y nach
  unten geschoben, bis `minGapY` Abstand erreicht ist. Reihenfolge der Rückgabe
  entspricht der Eingabe (nicht der sortierten).
- Rein, kein Canvas, deterministisch → `node:test`-tauglich.

In `map-draw.js`:

- Während der Marker-Schleife werden die Label-Anker gesammelt (Marker-`xy` minus
  vertikalem Offset) statt sofort gezeichnet — nur wenn `P{pos}`-Labels aktiv sind.
- Nach der Schleife: `declutterLabels(anchors, …)` aufrufen, dann jedes Label am
  entzerrten y zeichnen. **Marker bleiben an ihrer echten Position** — nur die
  Textlabels wandern vertikal. Keine Verbindungslinien (YAGNI).

### 3.3 Render-/Daten-Fluss

```
drawTrackOn(trackCanvas) → drawKartMarkersOn
  ranked = rankParticipants(...)   (bei Rennen >=2)
  posByMac aus ranked; positionGains(_prevPosByMac, ranked) -> _overtakeAtByMac
  _prevPosByMac := {mac: pos}      (bzw. else: beide Maps leeren)
  Schleife je Kart:
    Marker zeichnen (Farbe/aktiv/stale wie Phase 33)
    falls now-_overtakeAtByMac[mac] < MARKER_OVERTAKE_MS: goldenen Ring zeichnen
    falls Label aktiv: Anker {x, y} sammeln
  nach Schleife: ys = declutterLabels(anker, minGapY, minGapX)
  Labels an entzerrten ys zeichnen
```

## 4. Randfälle

1. **Single-Kart / <2 Teilnehmer / kein Rennen:** keine Rangfolge → keine Ringe,
   keine Labels, kein Declutter. Marker-Verhalten exakt wie Phase 33.
2. **Keine Überholung:** `positionGains` leer → keine Ringe.
3. **Labels weit auseinander:** `declutterLabels` ist ein No-Op (gibt die
   Original-y zurück).
4. **Stale überholendes Kart:** Ring wird mit dem Marker gedimmt (`globalAlpha`).
5. **Rennende / Wechsel <2:** Overtake-State (`_prevPosByMac`/`_overtakeAtByMac`)
   geleert → kein hängender Ring im nächsten Rennen.
6. **Mehr als zwei nahe Labels:** Greedy-Declutter stapelt sie nacheinander nach
   unten; Reihenfolge stabil (kein Springen zwischen Frames, da deterministisch).
7. **Marker ohne GPS-Fix:** wie Phase 33 übersprungen — kein Anker, kein Label.

## 5. Tests / Verifikation

- **Neue reine Logik wird TDD'd** in `geo.js` (`test/geo.test.js`):
  - `declutterLabels`: nicht-kollidierende Punkte unverändert; zwei x-nahe,
    y-nahe Labels werden auf `minGapY` Abstand geschoben; x-ferne Labels bleiben
    unverändert (kein falsches Verschieben); drei gestapelte Labels; Rückgabe in
    Eingabe-Reihenfolge.
  - Baseline `node --test` wächst von **157** um die neuen `declutterLabels`-Tests.
- **Canvas-Verdrahtung** (`map-draw.js`): `node --check` + `npx eslint` +
  Grep-Asserts; bestehende Baselines grün. Ring-/Label-Zeichnung selbst wird
  **nicht** unit-getestet — manuelle Hardware-Akzeptanz (§7).
- **Python unverändert:** `python -m py_compile bridge.py`;
  `python -m unittest discover -s test -p "test_*.py"` → **50 OK**.

## 6. Betroffene Dateien

| Aktion | Datei | Verantwortung |
|--------|-------|---------------|
| Ändern | `geo.js` | Neue reine `declutterLabels(points, minGapY, minGapX)`; im UMD-Export aufnehmen. |
| Ändern | `test/geo.test.js` | `node:test`-Fälle für `declutterLabels`. |
| Ändern | `map-draw.js` | Modul-State `_prevPosByMac`/`_overtakeAtByMac`/`MARKER_OVERTAKE_MS`; goldener Overtake-Ring je Marker; Label-Anker sammeln + via `declutterLabels` entzerrt zeichnen. |

`lap-engine.js`, `kart-overview.js`, `RasiCross_Telemetry.html`, `eslint.config.js`
(`map-draw`-Block hat `RasiLapEngine` bereits; `declutterLabels` ist Teil des
schon deklarierten `geo`-Globals) und alle übrigen Dateien bleiben **unverändert**.

## 7. Manuelle Akzeptanz (Nutzer, Hardware/zwei Karts)

1. **Overtake-Ring:** Überholt Kart B Kart A, bekommt B's Marker auf der Karte
   kurz (~1,2 s) einen goldenen Ring.
2. **Label-Declutter:** Stehen zwei Karts dicht beieinander, überlappen ihre
   `P{pos}`-Labels nicht mehr — sie stapeln sich vertikal.
3. **Marker-Treue:** Die Marker-Punkte bleiben exakt an der GPS-Position; nur die
   Zahlen-Labels wandern.
4. **Single-Kart-Regression:** ein Marker, kein Ring, kein Label — wie Phase 33.
5. **Rennende:** kein hängender Overtake-Ring im nächsten Rennen.

## 8. Risiken / offene Punkte

- **Doppelter Overtake-State:** `map-draw` und `kart-overview` detektieren
  Überholungen unabhängig (eigene `prevPos`/`overtakeAt`). Bewusst — für
  Modul-Unabhängigkeit; beide leuchten praktisch gleichzeitig. Falls das später
  driftet/stört, kann ein gemeinsamer State folgen.
- **Declutter-Stabilität:** rein-deterministisch + stabile Sortierung verhindern
  Frame-zu-Frame-Springen; bei sich bewegenden Karts wandern Labels weich mit den
  Markern.
- **Declutter nur vertikal:** Labels werden nur nach unten geschoben (kein
  horizontales Ausweichen, keine Leader-Linien). Bei sehr vielen sehr nahen Karts
  kann ein langer vertikaler Stapel entstehen — akzeptiert für ≤MAX_KARTS.

## 9. Bewusst nicht enthalten (spätere Phasen)

- **Synchrones Multi-Kart-Replay** (eigene große Spec — `replay.js` + Aufnahme).
- **Kombinierter Mehr-Kart-Fahrerdialog** (eigene Spec — `races.js`).
- **Momentaner Streckenabstand-Gap** (eigene Spec — Ranking + Geo-Distanz).
- **Label-Pille/Hintergrund** als Alternative zum Declutter (bei Bedarf später).
- **Horizontales Declutter / Leader-Linien.**

## 10. Phase Map

- **Phase 33:** Live-Positions-Overlay (Marker + P-Nummern) + Overtake-Highlight
  (Übersicht-Karten).
- **Phase 34 (dieses Design):** Map-Marker-Polish — Marker-Overtake-Ring +
  Label-Kollisionsauflösung.
- **Phasen 35+ (deferred):** synchrones Replay, kombinierter Fahrerdialog,
  momentaner Streckenabstand-Gap.
