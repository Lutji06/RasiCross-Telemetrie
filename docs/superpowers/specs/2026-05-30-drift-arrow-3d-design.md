# Drift-Pfeil im 3D-Kart — Design-Spec

**Datum:** 2026-05-30
**Branch:** `feat/tab-redesign-pitwall`
**Status:** freigegeben (Brainstorming abgeschlossen)

## Ziel

Den in Phase 18 berechneten Drift-Zustand (`state.drift`) zusätzlich **im 3D-Kart-Viewer** als einzelnen, farbcodierten Pfeil sichtbar machen. Rein additiv, keine neue Berechnung, keine neuen Settings, keine Firmware-Änderung. Begleitend: Code-Review des 3D-Karts auf Funktionalität (Ergebnis: keine Bugs, siehe unten).

## Kontext

- `karts3d.js` ist ein UMD-Modul: pure, testbare Helper (`pitchFromG`, `rollFromG`, `yawIntegrate`, `gViewReducer`, `computeAutoFitScale`, `kartModelYawReducer`) + ein DOM/WebGL-Wrapper (`window.RasiKart3D`), der nur aktiv ist, wenn `THREE` vorhanden ist.
- `RasiKart3D.update(imu)` wird in `rasicross.js` (~Zeile 579) pro Telemetrie-Frame aufgerufen, derzeit mit `{ gx, gy, gz, yaw, dtMs }`. `imu.yaw` ist die **vorzeichenbehaftete** gemessene Gierrate (deg/s, Gyro-Z).
- Es existiert bereits ein welt-fixierter G-Vektor-Pfeil (`_arrow`) auf dem Boden, der die Querbeschleunigungsrichtung zeigt.
- Phase 18 füllt `state.drift = { status, index }` (plus `expectedYaw` aus `RasiDrift.analyze`). Status ∈ {`n/a`, `grip`, `oversteer`, `understeer`, `counter`}.

## Funktions-Check des 3D-Karts (Review-Ergebnis)

Code-Review ergab **keine Bugs**. Architektur sauber: pure Helper getrennt vom DOM-Wrapper, `dispose()` räumt Geometrie/Material frei, kein Hot-Path-Alloc (`_tmpEuler`/`_tmpArrowDir` wiederverwendet), Resize gegen die zuletzt gesetzte Logikgröße abgesichert (kein Resize-Loop bei fraktionalem devicePixelRatio). Zwei bewusste Eigenheiten (kein Defekt):

1. Der rAF-`_loop` ist ein No-op-Heartbeat; gerendert wird ausschließlich bei `update()`-Aufrufen. Ohne Telemetrie friert das Bild ein (gewollt — spart GPU).
2. Der G-Vektor-Pfeil ist welt-fixiert, dreht sich also nicht mit dem integrierten Kart-Heading mit.

Ein Funktionstest am laufenden Modell (Electron/Browser) bleibt manueller Smoke-Schritt; im Code ist nichts zu reparieren.

## Architektur

Gleiches Muster wie das übrige Modul: **eine pure Funktion + ein DOM-Mesh.**

### Pure Helper: `driftArrowSpec(status, index, yawRate, opts)`

Reine Funktion (kein DOM, wirft nie), exportiert für `node:test`. Berechnet aus dem Drift-Zustand die Darstellungsparameter:

```js
function driftArrowSpec(status, index, yawRate, opts) {
  opts = opts || {};
  var maxLen = Number(opts.maxLen) || 1.6;
  var minLen = Number(opts.minLen) || 0.06;
  var color = DRIFT_3D_COLOR[status];           // siehe Palette
  if (status == null || status === 'n/a' ||
      color == null || index == null || !isFinite(Number(index))) {
    return { visible: false, length: 0, dirSign: 0, color: 0xffffff };
  }
  var idx = Math.max(0, Math.min(2, Number(index)));   // 0..2 geclamped
  var length = idx / 2 * maxLen;                        // 0..maxLen
  var dirSign = (Number(yawRate) || 0) >= 0 ? 1 : -1;
  return {
    visible: length > 0.05,
    length: Math.max(length, minLen),
    dirSign: dirSign,
    color: color
  };
}
```

**Farb-Palette (3D, hex)** — passend zur 2D-Welt:

```js
var DRIFT_3D_COLOR = {
  grip:       0x3ee08a,   // grün  (wie _zoneColor green)
  oversteer:  0xffa336,   // amber (wie _zoneColor orange)
  understeer: 0x7aa2f7,   // blau  (wie 2D-Badge --blue)
  counter:    0xff5470    // rot   (wie _zoneColor red)
};
// 'n/a' bewusst NICHT enthalten -> color == null -> unsichtbar
```

### DOM-Mesh: `_driftArrow`

- In `init()` neben dem G-Pfeil ein zweiter `THREE.ArrowHelper` anlegen:
  Ursprung erhöht über dem Kart-Zentrum (`new THREE.Vector3(0, 1.4, 0)`), Default-Richtung `(1,0,0)`, Startlänge `0.01`, Startfarbe `0x3ee08a`.
- In `update()` nach dem G-Pfeil-Block: Spec aus `imu.drift` (`{status,index}`) + `imu.yaw` berechnen, dann:
  - `spec.visible === false` → `_driftArrow.visible = false`.
  - sonst sichtbar setzen, Richtung `(spec.dirSign, 0, 0)`, `setLength(spec.length, 0.2, 0.12)`, `setColor(spec.color)`.
- In `dispose()` Referenz nullen (`_driftArrow = null`); der `_scene.traverse`-Dispose räumt die GPU-Ressourcen ohnehin.

**Platzierung:** welt-fixiert (wie der bestehende G-Pfeil), horizontal entlang ±X, erhöht bei y≈1.4, damit klar vom Boden-G-Pfeil getrennt. Konsistent mit der bestehenden Konvention.

## Datenfluss

`rasicross.js` (~579): der bestehende `update({...})`-Aufruf bekommt ein zusätzliches Feld:

```js
window.RasiKart3D.update({
  gx: state.display.gxLerp,
  gy: state.display.gyLerp,
  gz: state.telemetry.gz || 0,
  yaw: state.imu.yaw || 0,
  dtMs: dtMs,
  drift: state.drift            // { status, index }  (Phase 18)
});
```

Keine neue Berechnung — der Pfeil visualisiert nur den bereits gefüllten `state.drift`. Keine neuen Settings (Schwellen kommen aus `state.settings.drift` via `RasiDrift.analyze`).

## Verhaltens-Invariante

- Rein additiv: kein bestehendes Verhalten (Pose, G-Pfeil, Gz-Bar, Custom-Model-API) wird verändert.
- Ohne 3D-Ansicht (`gView !== '3d'`) passiert nichts Neues; das 2D-Badge bleibt davon unberührt.
- `drift` fehlt / `n/a` / `index null` → Pfeil unsichtbar, kein Fehler. Alte Aufrufer ohne `drift`-Feld funktionieren weiter (`imu.drift` undefined → `status` undefined → unsichtbar).

## Testing

Neue `node:test`-Fälle für `driftArrowSpec`:

- `n/a` / fehlender Status / `index === null` / `NaN` → `visible:false`.
- `grip` (index≈1) → sichtbar, mittlere Länge, Farbe grün.
- `oversteer` (index>1) länger als `understeer` (index<1).
- `index` über 2 wird auf maxLen geclamped.
- `counter` mit negativer/positiver `yawRate` → `dirSign` kippt (−1 vs +1).
- Farbe je Status korrekt; `oversteer`→amber, `understeer`→blau, `counter`→rot.

DOM/WebGL-Teil bleibt wie das übrige Modul ungetestet (THREE-gated).

## Dateien

| Aktion | Pfad | Verantwortung |
|--------|------|---------------|
| Modify | `karts3d.js` | `DRIFT_3D_COLOR`, pure `driftArrowSpec`, `_driftArrow` in init/update/dispose, Export. |
| Modify | `test/karts3d.test.js` | `node:test`-Fälle für `driftArrowSpec` (Datei existiert bereits). |
| Modify | `rasicross.js` | `drift: state.drift` im `RasiKart3D.update(...)`-Aufruf. |

## Scope / YAGNI

- Kein Doppelpfeil, kein Yaw-Arc (verworfen zugunsten des Einzelpfeils).
- Keine UI-Settings für den Pfeil.
- Keine Änderung am 2D-G-Meter oder am Badge.
- Kein mitdrehender (kart-lokaler) Pfeil — welt-fixiert wie der G-Pfeil.
