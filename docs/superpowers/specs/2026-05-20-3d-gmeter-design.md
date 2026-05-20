# RasiCross — 3D Kart G-Viewer (toggelbar mit 2D)

**Date:** 2026-05-20
**Status:** Approved (design); pending implementation plan
**Author:** Brainstorming session (Claude + user)

---

## 1. Purpose

Die G-Kraft-Anzeige im Dashboard ist seit der `gz`-Ergänzung in Phase 5
inkonsistent: der 2D-G-Kreis und die KPI-Zahlen (`kG`/`kGMax`) ignorieren die
3. Achse, während der Live-Chart bereits `gz` (und unsauber `yaw` auf einer
G-Skala) zeigt. Das Ziel: ein "Modern-Car"-tauglicher **3D-Kart-Viewer**, der
sich live aus den IMU-Daten neigt/dreht und die G-Kräfte als sichtbaren
Vektor am Modell darstellt — **toggelbar** mit der bestehenden 2D-Ansicht
(Default 2D, voll abwärtskompatibel). Gleichzeitig wird der Live-Chart
aufgeräumt: `yaw` raus aus dem G-Chart (gehört physikalisch nicht zu
Beschleunigungen).

Aus dem Brainstorming festgelegt: echtes **WebGL-3D** via **lokal
gebundeltem Three.js**, **Primitive-Kart** aus Three.js-Boxen (kein externes
Modell-File nötig — später ersetzbar), **Toggle 2D↔3D** in der G-Kraft-Karte.

## 2. Background / current state (geerdet im Code)

- **G-Meter** `drawGMeter` (`rasicross.js` ~L460–508): 2D-Canvas-Kreis mit
  Zonen (grün<1G/orange<2G/rot≥`gScale`), 50er-Trail, aktueller Punkt. Liest
  `state.display.gxLerp` / `state.display.gyLerp`. **`gz` wird ignoriert.**
- **G-Kraft-KPI** (`rasicross.js` `updateLiveKPIs` ~L2138–2148): `kG` aktuell
  als `g.toFixed(1)` mit `g = Math.sqrt(gxLerp²+gyLerp²)` (2D); `kGMax` aus
  `state.max.g`, das in `processTelemetry` (~L385) als
  `Math.sqrt(gx²+gy²)` (2D) berechnet wird. `kYaw`/`kMtemp` aus
  `state.imu.yaw`/`state.imu.mtemp`.
- **Live-G-Chart** `drawLiveCharts` (~L2028–2038): 4 Spuren — Gx (blau),
  Gy (grün), Gz (orange `#e8a13a`), **Yaw (gestrichelt, rechte °/s-Achse,
  aber auf die G-Skala umgemappt)**. Y-Achse `-gScale..+gScale`.
- **CSP** (Phase 3): `script-src 'self'` → externe CDN-Skripte blockiert;
  Three.js muss lokal gebundelt sein. `style-src` erlaubt `'unsafe-inline'`
  weiterhin (für vorhandene `style=`-Attribute).
- **Telemetrie**: alle relevanten Daten existieren bereits — `gx`/`gy`/`gz`
  in `state.telemetry`/`state.display` (geglättet), `yaw` (°/s) in
  `state.imu.yaw`. `state.settings` wird in `localStorage` persistiert.

### Confirmed decisions (Brainstorming)

- **Echtes WebGL-3D**, Three.js lokal gebundelt (`vendor/three.min.js`,
  ~150 KB gz, same-origin → CSP-konform).
- **Primitive-Kart** aus Three.js-Geometrie (Box + 4 Zylinder + Sitz/Lenker),
  ~50 Zeilen — kein externes Modell-File jetzt; später durch glTF ersetzbar
  (out of scope hier).
- **Toggle 2D↔3D**: `state.settings.gView = '2d' | '3d'`, persistiert,
  **default `'2d'`** ⇒ keine Verhaltensänderung bis explizit getoggelt.
- **3D-Inhalt:** Kart-Attitude (Pitch/Roll aus accel, Yaw integriert aus
  Gyro-Z) **+ 1 G-Vektor-Pfeil** auf der Bodenplatte (Richtung +
  Magnitude lateral+longitudinal) **+ Gz-Glow** (vertikaler Stab/Glow neben
  dem Kart, signed).
- **Live-Chart-Aufräumen** im selben Zug: **Yaw raus aus dem G-Chart**, jetzt
  3 Spuren (Gx/Gy/Gz). Yaw bekommt einen schmalen eigenen Sparkline +
  Zahl direkt unter dem KPI-Yaw-Wert. Gilt für **beide** Toggle-Stellungen.
- **KPI `kG`/`kGMax` bleiben 2D-Cornering-G** (rennrelevant; Gz "liest" man
  im 3D-Viewer). Keine 3D-Magnitude — bewusst.
- **Branch `feat/3d-gmeter`** ab `docs/telemetry-improvements-spec`
  (Phasen 1–6), unabhängig von D1 (`feat/binary-protocol`) und gear-ratio
  (`feat/gear-ratio`). Eigener PR, eigene Phase-Plan-Datei.

## 3. Scope

### In scope

| Item | Surface |
|------|---------|
| `vendor/three.min.js` lokal bundeln (Three.js r150+ UMD build) | `vendor/`, HTML |
| `karts3d.js` — UMD-Modul, kapselt Szene/Kart/G-Pfeil/Gz-Glow, IMU→Rotation, Toggle | `karts3d.js`, `test/karts3d.test.js` |
| Toggle 2D↔3D in der G-Kraft-Karte + Setting persistiert | `RasiCross_Telemetry.html`, `rasicross.js` |
| Live-Chart aufgeräumt: Yaw raus, Gx/Gy/Gz bleiben; Yaw-Sparkline + Zahl separat | `rasicross.js`, `RasiCross_Telemetry.html` |
| `state.settings.gView` (`'2d'\|'3d'`, persistiert; default `'2d'`) | `rasicross.js` |
| `node:test` für pure Helper (`pitchFromG`, `rollFromG`, `yawIntegrate`, `gViewReducer`) | `test/karts3d.test.js` |

### Out of scope

- Echtes glTF/OBJ-Modell des Karts (Primitive bleibt; späteres Drop-In ohne
  Code-Änderung möglich, aber das ist eine eigene Phase).
- D2 multi-kart; jegliche Änderung an Telemetrie-Feldern oder am
  ESP-NOW-Protokoll; D1-binary-Arbeit (lebt auf `feat/binary-protocol`).
- Gear-ratio-Dashboard-Erweiterung (lebt auf `feat/gear-ratio`).
- 3D-Trail / G-Heatmap / Pitch-/Roll-Replay (YAGNI).

## 4. Detailed design

### 4.1 `vendor/three.min.js`

Three.js (z. B. r152, UMD-Build `build/three.min.js`) wird als statisches
Asset unter `vendor/three.min.js` ins Repo gelegt (committet, ~600 KB
unkomprimiert; einmaliger Repo-Größen-Aufschlag). Loaded als Classic-Script
**vor** `karts3d.js`:

```html
<script src="vendor/three.min.js"></script>
<script src="karts3d.js"></script>
```

Exponiert `window.THREE`. CSP-konform da same-origin. Keine ES-Module
nötig.

### 4.2 `karts3d.js` — UMD-Modul (Muster `geo.js`/`replay.js`)

Kapselt die gesamte 3D-Szene. Pure Helper am Anfang (testbar unter Node
ohne THREE), DOM/WebGL-Code danach (gated mit `typeof THREE !== 'undefined'`).

**Pure Helper (TDD'd):**

- `pitchFromG(gx, gy, gz)` → Rad. `atan2(gx, sqrt(gy²+gz²))`. Bei
  `gx==gy==gz==0` ⇒ 0.
- `rollFromG(gx, gy, gz)` → Rad. `atan2(gy, sqrt(gx²+gz²))`. Bei Stillstand
  ⇒ 0.
- `yawIntegrate(prevRad, yawDegPerS, dtMs)` → neuer Heading-Wert (Rad).
  `prev + yawDegPerS * dt/1000 * π/180`. Wraps zu `[-π, π]` für numerische
  Stabilität.
- `gViewReducer(currentView, action)` → `'2d'|'3d'`. Actions: `'toggle'`,
  `'set:2d'`, `'set:3d'`. Ungültige Werte fallen auf `'2d'` zurück.

**DOM/WebGL-API:**

- `RasiKart3D.init(canvasEl, opts)` → erstellt Szene/Kamera/Renderer/Kart-
  Mesh/G-Pfeil/Gz-Glow im übergebenen Canvas. Idempotent (Re-init ersetzt
  bestehende Szene). `opts.gScale` = 3 default.
- `RasiKart3D.update(imu)` → eine Frame. `imu = {gx,gy,gz,yaw,dtMs}`.
  Aktualisiert Kart-Rotation (Quaternion aus pitch/roll/yaw),
  G-Pfeil-Vektor (Richtung/Länge/Farbe per `gScale`-Zone), Gz-Glow-Höhe.
  Rendert die Frame.
- `RasiKart3D.start()` / `.stop()` → rAF-Loop starten/stoppen. Stop pausiert
  die Szene; start nimmt sie wieder auf. Idempotent.
- `RasiKart3D.resetYaw()` → integriertes Heading auf 0.
- `RasiKart3D.dispose()` → Renderer/Geometrien sauber freigeben (für
  Replay-Enter/Exit-Hygiene).

UMD-Export wie `replay.js`: `window.RasiKart3D = { init, update, start,
stop, resetYaw, dispose, pitchFromG, rollFromG, yawIntegrate, gViewReducer }`;
`module.exports = …` für `node:test` (nur die pure Helper werden unter Node
genutzt; DOM/WebGL-Pfade sind `typeof THREE !== 'undefined'` gegated).

### 4.3 Kart-Primitive (Three.js-Boxen)

Lowpoly, ~50 Zeilen:

- **Chassis:** `BoxGeometry(2.0, 0.4, 1.2)` (Länge×Höhe×Breite), MeshStandard
  Material in `--pr`-Farbe.
- **Sitz:** kleinere `BoxGeometry(0.8, 0.6, 0.7)` mittig oben.
- **Lenkrad-Säule:** kurze `CylinderGeometry` vor dem Sitz.
- **4 Räder:** `CylinderGeometry(0.3, 0.3, 0.25)`, 90°-rotiert auf Z, an
  den Ecken positioniert. Material `#222`.
- **Bodenplatte:** `PlaneGeometry(4, 3)`, leicht transparenter Schatten-
  Receiver, `MeshBasicMaterial` mit `--soft`-Farbe und reduzierter Opacity.
- **Beleuchtung:** `AmbientLight` (intensität 0.6) + `DirectionalLight` von
  schräg oben für Tiefenwirkung.
- **Kamera:** `PerspectiveCamera(45, …)`, 3/4-Iso-Position (z. B. `(3, 2.5,
  3)`), zielt auf den Ursprung.

Alle Geometrien gruppiert unter einem `THREE.Group _kartGroup`, dessen
Rotation (`.quaternion`) jeden Frame aus pitch/roll/yaw gesetzt wird.

### 4.4 G-Vektor-Pfeil

`THREE.ArrowHelper` (oder ein Cylinder+Cone-Mesh-Paar wenn ArrowHelper
nicht im Material customizable genug ist) auf der Bodenplatte:

- **Origin:** `(0, 0.01, 0)` (knapp über der Platte, kein Z-Fighting).
- **Direction:** `new Vector3(gy, 0, -gx).normalize()` (Kart-Koordinaten:
  Gx ist vor/zurück → −Z; Gy ist links/rechts → X).
- **Length:** `sqrt(gx²+gy²) / gScale * 1.5` (1.5 = Pfeil-Bildschirmgröße
  ggü. Kart-Länge bei 1G).
- **Color:** zone-basiert (`<1G` grün, `<2G` orange, `≥gScale` rot —
  identische Zonen wie der 2D-Kreis, css var Werte).
- Beim Update neu setzen (Direction-Vektor + Length + Color); nicht jedes
  Frame neu erzeugen.

### 4.5 Gz-Glow

Schmaler `CylinderGeometry(0.05, 0.05, 1)` rechts neben dem Kart,
Material `MeshBasicMaterial({color: <zone>, transparent: true, opacity: …})`.
Höhe + Y-Position skalieren mit `gz`:

- `bar.scale.y = clamp(|gz| / gScale, 0, 1)` (Bar wächst nach oben für +Gz,
  nach unten für −Gz — Position-Y entsprechend angepasst).
- Farbe wie der G-Pfeil (Zonen-basiert).
- Opacity ∝ |gz| (transparent bei 0, voll bei ≥1G).

### 4.6 Toggle 2D↔3D in der G-Kraft-Karte

- HTML: in der Kart-Header-Zeile ein kleiner Pill-Toggle:
  `<div class="g-view-toggle"><button data-view="2d" class="active">2D</button><button data-view="3d">3D</button></div>`
  Styling minimal (CSS in bestehendem `<style>`-Block; `'unsafe-inline'` ist
  per CSP weiterhin erlaubt).
- Zwei Canvases im G-Kraft-Slot:
  `<canvas id="gMeterCanvas" ...></canvas>` (2D, vorhanden) und
  `<canvas id="gMeter3dCanvas" class="hidden" ...></canvas>` (3D, neu),
  beide gleiche `width`/`height`, der inaktive `.hidden`.
- Wiring in `init()` (CSP-konform, `addEventListener`):
  - Lese `state.settings.gView` (default `'2d'`), setze Sichtbarkeit + aktive
    Toggle-Klasse.
  - Bei Klick auf einen Toggle-Button: `gViewReducer` anwenden, `state.settings.
    gView` aktualisieren, `saveData()`, Sichtbarkeit aktualisieren,
    `RasiKart3D.start()` / `.stop()` entsprechend.
- Render-Pfad in `drawLiveCharts`:
  - Wenn `gView === '2d'`: bestehender `drawGMeter`-Aufruf wie heute.
  - Wenn `gView === '3d'`: 2D-Aufruf übersprungen. (3D-Loop läuft via rAF
    intern in `RasiKart3D`, nicht aus `drawLiveCharts`.)
- Initial: `RasiKart3D.init(...)` einmalig in `init()`, **danach `stop()`**
  (default 2D). Wechsel zu 3D ⇒ `start()`.

### 4.7 Live-Chart aufgeräumt

In `drawLiveCharts` den 4-Spuren-Aufruf ersetzen durch einen 3-Spuren-Aufruf
(Gx/Gy/Gz, keine `right`/`maxRight`-Optionen mehr — saubere g-Achse):

```
drawChart(_gCtx, _gCanvas,
  [
    { data: state.charts.gx, color: css('--blue'),  label: 'Gx' },
    { data: state.charts.gy, color: css('--green'), label: 'Gy' },
    { data: state.charts.gz, color: '#e8a13a',      label: 'Gz' }
  ],
  -state.settings.gScale, state.settings.gScale,
  { unit: 'G', zero: true }
);
```

`state.charts.yaw` bleibt im State (Phase-5-Konvention) — wird stattdessen
in einem neuen kleinen Canvas als Sparkline gerendert. Konkret: ein
neuer `<canvas id="yawSparkCanvas" width=120 height=24>` direkt unter
dem `kYaw`-KPI-Wert in der G-Kraft-Sub-Line; ein neuer `drawChart`-Aufruf
(single trace, `{unit: '°/s', zero: true}`, Höhe via Canvas-`height=24`).
Yaw-Integration findet **intern in `RasiKart3D`** statt; das Dashboard-
state hält keinen integrierten Heading-Wert. Der konkrete HTML-Anker für
die Sparkline-Einfügung wird im Plan-Task gegen die dann aktuelle HTML
festgelegt (CRLF-Anker-Konvention).

### 4.8 IMU → 3D-Mapping (Driver-Loop)

`RasiKart3D` hält intern:
- `_pitch` (Rad, geglättet, EMA α=0.2)
- `_roll` (Rad, geglättet, EMA α=0.2)
- `_yaw` (Rad, integriert)
- `_lastTickMs` für `dtMs`

Pro `update(imu)`:
- `dt = nowMs - _lastTickMs; _lastTickMs = nowMs`
- `targetPitch = pitchFromG(gx, gy, gz)`; `_pitch = α*targetPitch + (1−α)*_pitch`
- analog `_roll`
- `_yaw = yawIntegrate(_yaw, imu.yaw /* °/s */, dt)`
- `_kartGroup.quaternion.setFromEuler(new Euler(_pitch, _yaw, _roll, 'YXZ'))`
- G-Pfeil + Gz-Glow neu setzen (aus `imu.gx/gy/gz`)
- `renderer.render(scene, camera)`

Glättung verhindert nervöse Bewegung bei verrauschten Werten.
`yawIntegrate` driftet ohne Magnetometer — `resetYaw()` Button + Auto-Reset
bei Replay-Enter mitigieren das.

### 4.9 Replay-Modus-Integration

Phase-6-Replay setzt bei Enter/Exit die replay-touched State-Slices zurück
(`resetReplayDerived`). Wenn der 3D-Viewer aktiv ist:
- Replay-Enter: `RasiKart3D.resetYaw()` aufrufen (analog Snapshot-Init).
- Replay-Exit: ebenfalls `resetYaw()`. Toggle-State bleibt persistiert.
- Live-Feed-Schleife: replay-fed Pakete fließen durch `processTelemetry` →
  `state.telemetry`/`state.imu` werden aktualisiert wie im Live-Modus →
  `RasiKart3D.update(imu)` reagiert identisch. Kein Sonderpfad nötig.

### 4.10 Fehler-/Edge-Cases

- **Three.js fehlt** (`typeof THREE === 'undefined'` zur init-Zeit):
  Toggle-Button bleibt klickbar; beim Wechsel zu 3D wird ein Fallback
  ausgelöst — `rcToast('3D nicht verfügbar — vendor/three.min.js fehlt')`,
  Toggle springt zurück auf 2D, `state.settings.gView` ebenfalls.
- **WebGL nicht verfügbar** (`THREE.WebGLRenderer`-Konstruktor wirft): gleicher
  Pfad — Fallback auf 2D, einmaliger Toast `'WebGL nicht unterstützt'`,
  `gView` zurück auf `'2d'`. `RasiKart3D` bleibt initialisiert-aber-inaktiv;
  Toggle-Button 3D wird disabled (`.disabled`-Klasse).
- **Sehr alte Browser** (no rAF, no Performance.now): Three.js würde sowieso
  scheitern → Fallback wie WebGL-Fehler. Project requires Node ≥ 18 +
  modern Chromium/Electron — kein realer Fall.
- **State-Korruption** bei `gView`-Setting aus altem `localStorage` (z. B.
  fehlerhafter Wert): `gViewReducer` clamps auf `'2d'`.

## 5. Daten / Protokoll-Änderungen

Keine. Telemetrie-Felder unverändert. Reine Dashboard-Visualisierung.
`state.settings` gewinnt einen neuen optionalen Key `gView` (string),
der von altem Code toleriert wird (unbekannter Key → ignoriert).

## 6. Testing-Strategie

- **Pure Helper** (`pitchFromG`/`rollFromG`/`yawIntegrate`/`gViewReducer`):
  `test/karts3d.test.js` mit `node:test` — Stillstand→0, bekannte
  Beschleunigungs-Pose→erwarteter Winkel, NaN/None-Robustheit, Yaw-Wrap
  in `[-π, π]`, Reducer-Edge-Cases. ~5–6 Tests. Erwartete neue
  `npm test`-Summe: `tests 22 → tests 28` (10 geo + 12 replay + 6 karts3d).
- **DOM/WebGL-Pfade** (Szene, Kart-Geometrie, Pfeil, Glow, Toggle-Wiring,
  Replay-Hook): nicht unit-testbar in dieser Codebase (Project-Precedent:
  Phasen 2–6 testen DOM/Canvas nicht). Verifikation per:
  - `node --check karts3d.js` (Syntax)
  - Grep-statische Anker (alle erwarteten IDs/Funktionen vorhanden,
    keine Inline-Handler, CSP-konform)
  - Deferred manueller Smoke (Hardware-Checklist, siehe unten)
- **CI** (`.github/workflows/check.yml`): `node --check karts3d.js` zur
  JS-Job-Liste hinzufügen.

### Manuelle Acceptance-Checklist (vom Nutzer, Electron + Chromium)

1. **Default 2D, kein Verhaltensunterschied** beim ersten Laden: G-Kreis +
   KPI-Zahlen wie vorher. Live-Chart zeigt jetzt **3 Spuren** (Gx/Gy/Gz),
   Yaw separat als Sparkline/Zahl unter dem Yaw-KPI. **Null CSP-Verstöße**
   in DevTools.
2. **Toggle auf 3D**: Kart-Modell erscheint im G-Kraft-Slot; reagiert auf
   IMU (Demo oder reale Daten) — Pitch beim Beschleunigen/Bremsen, Roll
   beim Cornering. Yaw-Drift visuell minimal über kurze Sessions.
3. **G-Vektor-Pfeil** auf der Bodenplatte: zeigt in Richtung der
   Resultierenden, Farbe wechselt korrekt durch grün/orange/rot. Bei
   `gx=gy=0` ist der Pfeil unsichtbar/kurz.
4. **Gz-Glow** reagiert auf vertikale Stöße: wächst nach oben bei +Gz,
   nach unten bei −Gz; Farbe per Zone.
5. **`↻`-Yaw-Reset**: nullt das Heading sofort.
6. **Toggle zurück auf 2D**: 3D-Loop pausiert (CPU-Idle bestätigen), G-Kreis
   wieder sichtbar. `localStorage` enthält `gView: '2d'` / `'3d'`.
7. **Replay (Phase 6)**: Replay-Enter setzt Yaw zurück; 3D-Kart bewegt sich
   im Replay genauso wie live; Replay-Exit restauriert sauber.
8. **Fehlerpfade**: `vendor/three.min.js` umbenennen → Toggle 3D zeigt
   Fallback-Toast, springt zurück auf 2D; WebGL deaktiviert → gleicher
   Fallback. Kein Crash, kein State-Drift.

## 7. Backward Compatibility

- Default `gView = '2d'` ⇒ keine Verhaltensänderung beim Update bis der
  Nutzer toggelt.
- Live-Chart-Änderung (Yaw raus) ist eine **sichtbare** Layout-Änderung —
  bewusst, Teil des Rework-Ziels. Yaw bleibt im UI sichtbar (KPI-Zahl +
  Sparkline), nur nicht mehr im G-Chart.
- `localStorage`-Schema kompatibel (`gView`-Key ist neu/optional, alter
  Code ignoriert ihn).
- Telemetrie/Protokoll unverändert. Keine Auswirkung auf ESP-Code,
  Bridge, D1, gear-ratio.

## 8. Sequencing

Eigene Phase, ein Plan-Dokument, mehrere Tasks:

1. **Pure Helper + Tests** (`karts3d.js` initial mit `pitchFromG`/`rollFromG`/
   `yawIntegrate`/`gViewReducer` + UMD-Skeleton; `test/karts3d.test.js`).
   TDD, voll lokal verifizierbar. Sicher.
2. **Vendor + DOM-Skeleton**: `vendor/three.min.js` einchecken; HTML-Script-
   Tags + CSP-Verifikation; Toggle-Markup in G-Kraft-Karte; CI-Job um
   `node --check karts3d.js` ergänzt.
3. **3D-Szene + Kart + Pfeil + Glow** im `karts3d.js` (DOM/WebGL-Teil);
   `RasiKart3D.init/update/start/stop/resetYaw/dispose`.
4. **Wiring + Toggle-Logik** in `rasicross.js` (`init()`, `drawLiveCharts`,
   `state.settings.gView`); Replay-Hooks.
5. **Live-Chart-Aufräumen**: Yaw raus, Sparkline-Render.
6. **Phase-Verifikation + Plan-Doc-Commit + Push.**

Tasks landen in einem Plan-Doc `docs/superpowers/plans/2026-05-20-11-3d-gmeter.md`
mit dem bewährten Phase-Plan-Format.

## 9. Risiken & Mitigation

| Risiko | Mitigation |
|--------|------------|
| Three.js-Bundle bricht CSP / Performance | Lokales same-origin File (passt CSP `script-src 'self'`); UMD-Build ohne `eval`; rAF nur im 3D-Modus → kein Idle-Overhead. |
| Yaw-Drift ohne Magnetometer | Sichtbarer `↻`-Reset-Button; Auto-Reset bei Replay-Enter; Mitigation in der Hardware-Checklist (Item 2). |
| Primitive-Kart sieht "billig" aus | Akzeptiert für jetzt — Spec out-of-scope für echtes glTF. Spätere Phase kann ersetzen, ohne Wiring zu ändern (dispose+init mit neuem Mesh). |
| User-HTML-WIP-Konflikt | Worktree `feat/3d-gmeter` ist **isoliert** — die Implementierung passiert in `.claude/worktrees/feat-3d-gmeter/`; die HTML-WIP des Users auf `feat/binary-protocol` bleibt unangetastet. |
| WebGL nicht überall verfügbar | Fallback auf 2D mit Toast, Toggle-Disable; testbar via DevTools "Disable WebGL". |
| Test-Lücke bei DOM/WebGL | Project-Precedent: DOM/Canvas wird nicht unit-getestet (Phasen 2–6); pure Helper sind TDD'd, Wiring per Static-Review + manueller Smoke verifiziert. |
