# RasiCross — G-Meter + 3D-Modell Redesign mit Kippfunktion

**Date:** 2026-06-09
**Status:** Approved (design); pending implementation plan
**Author:** Brainstorming session (Claude + user)

---

## 1. Purpose

Seit Phase 19b existiert eine echte **Kippfunktion**: `state.attitude.rollDeg` ist
ein *fusionierter* Rollwinkel (Komplementärfilter Gyro-Roll-Rate + Accel-
Schwerkraftreferenz) mit Umkipp-Erkennung (`state.attitude.over`, Schwelle
`settings.rollover.angleDeg`) und — seit dem aktuellen Settings-Redesign —
einem `invertRollRate`-Toggle. Diese Messung steckt aber **nur im flachen
Roll-Balken** (`#rollInd`) unter dem G-Meter.

Das 3D-Kart und das 2D-G-Meter zeigen den Roll **getrennt davon**: Das 3D-Modell
neigt sich nach rohem Accel-Roll (`rollFromG`, EMA-geglättet), das 2D-Meter
zeigt gar keinen Roll. Es gibt also zwei verschiedene Roll-Werte und die
„offizielle" Kippfunktion ist visuell unterrepräsentiert.

**Ziel:** Beide Ansichten (2D-Meter + 3D-Modell) nutzen denselben fusionierten
Rollwinkel + Umkipp-Zustand und machen das Kippen/Umkippen visuell prominent.

## 2. Background / current state (geerdet im Code)

- **Kippfunktion-State** (`rasicross.js:61`): `state.attitude = { rollDeg, over,
  overState }`. `rollDeg` wird in `processTelemetry` (`rasicross.js:541-547`)
  per `RasiAttitude.rollStep(...)` fusioniert (inkl. `invertRollRate`-Korrektur
  der Roll-Rate); `overState`/`over` per `RasiAttitude.rolloverStep(...)` mit
  Schwelle `state.settings.rollover.angleDeg` (Default 75°).
- **3D-Modell** (`karts3d.js`): `update(imu)` (`:284`) berechnet `_roll` aus
  `rollFromG(gx,gy,gz)` (`:298`), EMA α=0.2, und setzt das Kart-Euler
  `(_pitch, _yaw+heading, _roll, 'YXZ')` (`:306`). Pitch aus `pitchFromG(gx)`,
  Yaw integriert. **Nutzt den fusionierten Rollwinkel nicht.** Bodenplatte =
  `PlaneGeometry(4,3)`, `MeshBasicMaterial` (`:228-233`). G-Pfeil + Gz-Glow +
  Drift-Pfeil bleiben.
- **2D-G-Meter** `drawGMeter` (`rasicross.js:689`): Canvas-Kreis mit G-Zonen,
  50er-Trail, aktueller Dot. **Kein Roll/Neigungs-Element.**
- **Flacher Roll-Balken** (`RasiCross_Telemetry.html:2413-2417`): `#rollInd` mit
  `.roll-track > #rollMarker`, `.roll-scale` (−90/0/+90), `#rollVal` (Gradzahl),
  `#rollOver` (`UMGEKIPPT`-Badge). Gefüttert von `renderRollBar()`
  (`rasicross.js:656-665`) aus `state.attitude.rollDeg`/`.over`.
- **Datenfluss** `renderGauges()` (`rasicross.js:668-688`): bei `gView==='3d'`
  Aufruf `RasiKart3D.update({ gx, gy, gz, yaw, dtMs, drift })` (`:677`); sonst
  `drawGMeter()`. `renderRollBar()` läuft unabhängig.

### Confirmed decisions (Brainstorming)

- **Richtung A + B:** 3D-Kart kippt zum echten fusionierten Rollwinkel mit
  dramatischer Umkipp-Warnung; 2D-Meter bekommt künstlichen Horizont + Bank-Ring.
  Beide nutzen **denselben** Rollwert.
- **Pitch behalten:** Roll = fusionierte Kippfunktion, **Pitch weiter aus Gx**
  (`pitchFromG`), Yaw weiter integriert. Kart bleibt „lebendig".
- **Flacher Balken → kompakter Readout:** Grafik-Leiste/Marker/Skala entfallen;
  es bleibt eine Zeile `ROLL <n>°` + rotes `⚠ UMGEKIPPT`-Badge. IDs `rollVal`/
  `rollOver` bleiben erhalten.

## 3. Scope

### In scope

| Item | Surface |
|------|---------|
| `RasiKart3D.update` nimmt `rollDeg` + `over`; Roll aus `rollDeg` statt `rollFromG` (Fallback erhalten) | `karts3d.js`, `test/karts3d.test.js` |
| 3D-Umkipp-Optik: pulsierendes rotes Boden-Glühen + Boden-Tönung bei `over` | `karts3d.js` |
| 2D-G-Meter: gekippte Horizontlinie + Bank-Ring (Ticks, Zeiger, rote Schwellen-Zonen) + Umkipp-Glow | `rasicross.js` (`drawGMeter`) |
| Flacher Roll-Balken → kompakter Readout (`rollVal` + `rollOver`) | `RasiCross_Telemetry.html`, `rasicross.js` (`renderRollBar`) |
| Datenfluss: `rollDeg`/`over` an `RasiKart3D.update`; `drawGMeter` liest `state.attitude` | `rasicross.js` (`renderGauges`) |
| Optionaler reiner Helfer (Bank-Zeiger-Winkel / Glow-Puls) + `node:test` | `karts3d.js`, `test/karts3d.test.js` |

### Out of scope

- Echter Pitch/Roll aus Gyro-Fusion über die bestehende Kippfunktion hinaus
  (Pitch bleibt Accel-basiert).
- Konfigurierbare Horizont-/Ring-Optik, Themes, zusätzliche Skalen.
- Änderungen an Drift-Pfeil, G-Vektor, Gz-Glow, Sektoren, Telemetrie/Protokoll.
- Custom-Modell-Material-Eingriffe (Umkipp-Optik bleibt Szenen-Ebene, damit
  geladene glTF-Modelle nicht angefasst werden).

## 4. Detailed design

### 4.1 3D-Modell: Roll aus der Kippfunktion (`karts3d.js`)

`update(imu)` akzeptiert zwei neue optionale Felder: `imu.rollDeg` (Grad,
fusioniert) und `imu.over` (bool, Umkipp aktiv).

- **Roll-Quelle:** Liegt `rollDeg` vor (endlich), ist `targetRoll = rollDeg *
  π/180`. Fehlt es, **Fallback** auf `rollFromG(gx,gy,gz)` (heutiges Verhalten —
  hält alte Tests & rollDeg-lose Aufrufer unverändert).
- **Vorzeichen:** Die statische Komponente des fusionierten Rolls ist
  `atan2(latAccel, gz)` — gleiche Konvention wie `rollFromG` (`atan2(gy,…)`).
  `rollDeg` wird also **direkt** auf die Z-Euler-Achse gemappt (Rechtskippen →
  Kart kippt rechts). Eine evtl. nötige globale Spiegelung deckt der
  `invertRollRate`-Toggle bereits ab.
- **Glättung:** `targetRoll` weiter über die bestehende EMA (`_EMA_ALPHA`)
  laufen lassen (der fusionierte Wert ist schon vorgeglättet; EMA dämpft
  Render-Jitter). Pitch/Yaw unverändert.
- `_tmpEuler.set(_pitch, _yaw + headingRad, _roll, 'YXZ')` bleibt.

### 4.2 3D-Umkipp-Optik (`karts3d.js`)

Neues Szenen-Element `_rolloverGlow`: flacher roter Ring/Disc (`RingGeometry`
oder `CircleGeometry`, `MeshBasicMaterial` rot, transparent, additiv-artig) auf
der Bodenplatte, `visible=false` im Normalzustand. Plus optionale rote Tönung
der bestehenden Bodenplatte.

Pro `update`:
- `over === true` → `_rolloverGlow.visible = true`, Opacity **pulsiert** über
  die Zeit (`0.25 + 0.35*(0.5+0.5*sin(now/180))`); Boden-Material-Farbe wird
  rot getönt.
- `over === false` → Glow unsichtbar, Boden zurück auf Normalfarbe.

Bewusst auf Szenen-Ebene (Boden/Glow), **nicht** über Kart-Materialien — so
bleiben Custom-Modelle (Phase 12) unberührt. Der textuelle `UMGEKIPPT`-Hinweis
kommt zentral aus dem 2D-Readout (§4.4), gilt also für beide Modi.

### 4.3 2D-G-Meter: Horizont + Bank-Ring (`drawGMeter`)

Liest `roll = state.attitude.rollDeg` (geklemmt −90..+90), `over =
state.attitude.over`, `thr = state.settings.rollover.angleDeg`. Zeichen-Reihen-
folge im bestehenden `drawGMeter` ergänzt:

1. **Kern unverändert:** Hintergrundkreis, G-Zonen, Gridlines, Achsenlabels,
   Trail, aktueller Dot (wie heute).
2. **Künstlicher Horizont (in den Kreis geclippt):** Context um `−rollRad` um
   das Zentrum rotiert; eine Horizontlinie durch die Mitte + dezente „Boden"-
   Füllung auf der Unterseite (niedrige Opacity, damit der G-Dot dominant
   bleibt). Im Umkipp-Zustand rot statt blau.
3. **Bank-Ring (außerhalb des G-Kreises):** Ring bei `r*1.12` mit Ticks (0° oben,
   ±30/±60); rote Bogen-Segmente von `±thr` bis ±90° (Umkipp-Zone); ein Zeiger
   (Dreieck) am Rand, der um den aktuellen Rollwinkel von oben rotiert.
4. **Umkipp-Glow:** bei `over` roter Außenring-Glow (`shadowBlur` / roter
   Stroke) + Zeiger/Horizont rot.

Alle neuen Elemente sind rein additiv; bei `rollDeg≈0` ist der Horizont waagrecht
und der Zeiger oben — keine Ablenkung.

### 4.4 Kompakter Readout statt flachem Balken

**HTML** (`RasiCross_Telemetry.html`): `#rollInd`-Block ersetzen. `.roll-track`/
`#rollMarker`/`.roll-scale` entfallen. Es bleibt eine schlanke Zeile, die
`#rollVal` (Gradzahl) und `#rollOver` (`⚠ UMGEKIPPT`-Badge) weiterhin enthält
(IDs unverändert, damit das Wiring minimal bleibt). Begleitendes CSS für die
entfernten Klassen wird mit aufgeräumt.

**JS** (`rasicross.js`): `renderRollBar()` → schlank: nur noch `rollVal`-Text
(`Math.round(deg)+'°'`) + `rollOver`-Toggle (`hidden` ⇄ sichtbar). Die
`rollMarker`-Positionierung entfällt. **Funktionsname bleibt `renderRollBar`**
(Aufrufer unverändert; kein Umbenennen, minimiert Churn).

### 4.5 Datenfluss (`renderGauges`)

- `RasiKart3D.update({ gx, gy, gz, yaw, dtMs, drift, rollDeg:
  state.attitude.rollDeg, over: state.attitude.over })`.
- `drawGMeter()` liest `state.attitude.rollDeg`/`.over` direkt aus dem globalen
  State (wie es schon `state.display`/`state.settings` nutzt).

## 5. Daten / Protokoll-Änderungen

Keine. Reine Dashboard-Visualisierung. `state.attitude` existiert bereits.
`RasiKart3D.update` gewinnt zwei optionale Eingangsfelder (abwärtskompatibel).

## 6. Testing-Strategie

- **Reine Helfer** (`karts3d.js`): bestehende Tests bleiben unverändert grün
  (`rollFromG`/`pitchFromG`/`yawIntegrate`/`gViewReducer`/… — aktuell 95
  Tests gesamt). Falls ein neuer reiner Helfer eingeführt wird (z. B.
  `bankPointerDeg(rollDeg)` oder `rolloverGlowAlpha(over, tMs)`), wird er per
  `node:test` abgedeckt (Stillstand/Clamp/NaN-Robustheit).
- **DOM/WebGL + Canvas** (3D-`update`-Roll/Glow, `drawGMeter`-Horizont/Ring,
  Readout-Wiring): Project-Precedent → **nicht** unit-getestet. Verifikation:
  - `node --check rasicross.js` + `node --check karts3d.js`
  - grep-statische Anker (IDs `rollVal`/`rollOver` vorhanden; `rollDeg`/`over`
    an `update` übergeben; entfernte Klassen weg)
  - deferred manueller Smoke (Checklist unten)
- **Backward-Compat-Test:** `update()` ohne `rollDeg` muss weiter über
  `rollFromG` laufen (durch bestehende Tests/Fallback-Pfad abgedeckt).

### Manuelle Acceptance-Checklist (Nutzer, Electron + Chromium)

1. **2D-Meter:** Horizontlinie kippt mit dem realen Rollwinkel; Bank-Zeiger
   wandert; bei Lehnen über die Schwelle werden Ring-Zone + Glow rot. G-Dot/
   Trail/Zonen unverändert.
2. **3D-Modell:** Kart kippt seitlich zum **gleichen** Rollwert wie der 2D-
   Zeiger; Pitch reagiert weiter auf Bremsen/Gas; Yaw wie bisher.
3. **Umkipp:** Schwelle überschreiten → 3D-Boden glüht rot/pulsiert, 2D-Glow
   rot, Readout zeigt `⚠ UMGEKIPPT`. Unter Schwelle (mit Hysterese) erlischt
   alles sauber.
4. **`invertRollRate`-Toggle** (Sensorik): kehrt die Kipprichtung in **beiden**
   Ansichten konsistent um.
5. **Readout:** flacher Balken ist weg; `ROLL <n>°` + Badge bleiben korrekt.
6. **Custom-Modell** (falls geladen): Umkipp-Glow erscheint am Boden, ohne das
   geladene Modell einzufärben.
7. **Replay:** 3D/2D-Kippen folgt den abgespielten Paketen wie live.

## 7. Backward Compatibility

- `RasiKart3D.update` ohne `rollDeg`/`over` = heutiges Verhalten (Fallback
  `rollFromG`, kein Glow). Kein Aufrufer außerhalb `renderGauges` betroffen.
- Readout-Umbau ist eine bewusste, sichtbare UI-Änderung; Roll-Info bleibt
  (Gradzahl + Badge) erhalten, nur die grafische Leiste entfällt.
- Keine Telemetrie-/Protokoll-/localStorage-Schema-Änderung. ESP/Bridge
  unberührt. 250-B-ESP-NOW-Budget irrelevant (reines Frontend).

## 8. Sequencing

Eigene Phase, ein Plan-Dokument, Tasks (Reihenfolge sicher → sichtbar):

1. **(Optional) reiner Helfer + Test** in `karts3d.js` (Bank-Zeiger/Glow-Puls),
   falls eingeführt — TDD, lokal verifizierbar.
2. **3D-Roll-Quelle:** `update()` nimmt `rollDeg`/`over`, Roll aus `rollDeg`
   (Fallback erhalten); `renderGauges` übergibt beide Felder.
3. **3D-Umkipp-Glow:** `_rolloverGlow` + Boden-Tönung in `init`/`update`/
   `dispose`.
4. **2D-Meter:** Horizont + Bank-Ring + Umkipp-Glow in `drawGMeter`.
5. **Readout-Umbau:** HTML `#rollInd` schlank, CSS-Cleanup, `renderRollBar`
   vereinfacht.
6. **Phase-Verifikation** (`node --check`, `node --test` = 95 grün, grep-Anker)
   **+ Plan-Doc-Commit.**

Plan-Doc: `docs/superpowers/plans/2026-06-09-NN-gmeter-3d-kippfunktion.md` im
bewährten Phase-Plan-Format.

## 9. Risiken & Mitigation

| Risiko | Mitigation |
|--------|------------|
| Roll-Vorzeichen im 3D gespiegelt ggü. Erwartung | Gleiche `atan2`-Konvention wie `rollFromG`; `invertRollRate` deckt globale Spiegelung ab; im manuellen Smoke verifiziert. |
| 2D-Meter wird visuell überladen (Horizont + Ring + G-Dot + Trail) | Horizont dezent (niedrige Opacity), Ring außerhalb des G-Kreises; G-Dot bleibt dominant. Bei `roll≈0` neutral. |
| Umkipp-Glow färbt Custom-Modelle ein | Effekt strikt auf Boden/Szenen-Ebene, nie auf Kart-Materialien. |
| EMA auf bereits gefiltertem Roll → träge | `_EMA_ALPHA` ist klein genug für Render-Glättung; fusionierter Wert ist die Wahrheit, EMA nur Anti-Jitter. Bei Bedarf α erhöhen. |
| Test-Lücke bei Canvas/WebGL | Project-Precedent (DOM/Canvas nicht unit-getestet); reine Helfer TDD'd, Rest static-review + manueller Smoke. |
