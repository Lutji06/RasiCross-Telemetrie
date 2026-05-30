# Drift-Pfeil im 3D-Kart — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Den in Phase 18 berechneten `state.drift` zusätzlich im 3D-Kart-Viewer als einzelnen, farbcodierten Gierraten-Pfeil anzeigen (Länge ∝ Drift-Index, Richtung = Vorzeichen der Gierrate, Farbe je Status).

**Architecture:** Reine, testbare Funktion `driftArrowSpec(status, index, yawRate, opts)` in `karts3d.js` (gleiches Muster wie die übrigen pure Helper), die ein neuer `_driftArrow` (THREE.ArrowHelper) im DOM/WebGL-Wrapper pro Frame anwendet. `rasicross.js` reicht nur `drift: state.drift` zusätzlich in den bestehenden `RasiKart3D.update(...)`-Aufruf — keine neue Berechnung, keine neuen Settings.

**Tech Stack:** Vanilla-JS-UMD-Modul + `node:test`; THREE.js-gated DOM-Wrapper. Keine neuen Runtime-Deps. Kein ESP/Python-Touch.

---

## Working Directory & Conventions

**Alle Arbeit im Clone:** `C:/Users/jimlu/Documents/RasiCross-Telemetrie-git` (Branch `feat/tab-redesign-pitwall`).

- Dateien sind **CRLF**. Immer die Zielregion frisch `Read`-en direkt vor einem `Edit` und den `old_string`-Anker aus diesem Read kopieren (Zeilennummern-Präfix strippen). Zeilennummern unten sind indikativ — auf den Text ankern.
- Git: `git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" …`. Für Verifikations-Greps die **Grep-Tool** nutzen (nicht shell grep). Untracked `.claude/` und Plan/Spec-Docs **nie** mit `git add .` — immer explizit `git add <pfad>`.
- Commit-Messages: conventional + Body + Trailer `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- **Spec:** `docs/superpowers/specs/2026-05-30-drift-arrow-3d-design.md`.

**Verhaltens-Invariante:** Rein additiv. Kein bestehendes Verhalten (Pose, G-Pfeil `_arrow`, Gz-Bar, Custom-Model-API) wird verändert. Ohne `drift`-Feld im `update(imu)`-Aufruf (Altaufrufer) ist `imu.drift` undefined → Status undefined → Pfeil unsichtbar, kein Fehler. Baseline-Tests: `node --test` = `tests 61 | pass 61 | fail 0`; nach diesem Plan **66** (5 neue `test()`-Fälle; das erweiterte Export-Array bleibt ein bestehender Test).

---

## File Structure

| Aktion | Pfad | Verantwortung |
|--------|------|---------------|
| Modify | `karts3d.js` | `DRIFT_3D_COLOR` + pure `driftArrowSpec` (+ Export); `_driftArrow`-Mesh in `init`/`update`/`dispose`. |
| Modify | `test/karts3d.test.js` | `node:test`-Fälle für `driftArrowSpec`; Export-Array um `driftArrowSpec` ergänzt. |
| Modify | `rasicross.js` | `drift: state.drift` im `RasiKart3D.update(...)`-Aufruf (~Zeile 579). |

**Task-Reihenfolge:** T1 pure Helper + Tests + Export (TDD) → T2 DOM-Pfeil (`karts3d.js` init/update/dispose) + Wiring (`rasicross.js`) → T3 Voll-Verifikation + Plan-Commit + Push.

---

### Task 1: Pure `driftArrowSpec` + Palette + Export (TDD)

**Files:**
- Modify: `test/karts3d.test.js`
- Modify: `karts3d.js`

- [ ] **Step 1: Failing Tests schreiben** — `test/karts3d.test.js`.

  Zuerst das bestehende Export-Array um `driftArrowSpec` ergänzen. Ersetze exakt:

```
  for (const n of ['pitchFromG', 'rollFromG', 'yawIntegrate', 'gViewReducer',
                   'computeAutoFitScale', 'kartModelYawReducer']) {
```

  mit:

```
  for (const n of ['pitchFromG', 'rollFromG', 'yawIntegrate', 'gViewReducer',
                   'computeAutoFitScale', 'kartModelYawReducer', 'driftArrowSpec']) {
```

  Dann ans **Ende** der Datei anhängen:

```js

test('driftArrowSpec: n/a / fehlend / null / NaN -> unsichtbar', () => {
  assert.equal(K.driftArrowSpec('n/a', 1, 5).visible, false);
  assert.equal(K.driftArrowSpec(undefined, 1, 5).visible, false);
  assert.equal(K.driftArrowSpec('grip', null, 5).visible, false);
  assert.equal(K.driftArrowSpec('grip', NaN, 5).visible, false);
});

test('driftArrowSpec: grip sichtbar, gruene Farbe, positive Laenge', () => {
  const s = K.driftArrowSpec('grip', 1, 5);
  assert.equal(s.visible, true);
  assert.equal(s.color, 0x3ee08a);
  assert.ok(s.length > 0);
});

test('driftArrowSpec: oversteer laenger als understeer; Farben je Status', () => {
  const over = K.driftArrowSpec('oversteer', 1.6, 5);
  const under = K.driftArrowSpec('understeer', 0.5, 5);
  assert.ok(over.length > under.length, `${over.length} !> ${under.length}`);
  assert.equal(over.color, 0xffa336);
  assert.equal(under.color, 0x7aa2f7);
});

test('driftArrowSpec: index ueber 2 wird auf maxLen geclamped', () => {
  const at2 = K.driftArrowSpec('oversteer', 2, 5).length;
  const above = K.driftArrowSpec('oversteer', 10, 5).length;
  assert.equal(at2, above);
});

test('driftArrowSpec: dirSign folgt dem Vorzeichen der Gierrate', () => {
  assert.equal(K.driftArrowSpec('counter', 1.5, -5).dirSign, -1);
  assert.equal(K.driftArrowSpec('counter', 1.5, 5).dirSign, 1);
  assert.equal(K.driftArrowSpec('counter', 1.5, 5).color, 0xff5470);
});
```

- [ ] **Step 2: Test laufen lassen → muss scheitern**

  Run: `node --test test/karts3d.test.js`
  Expected: FAIL — `driftArrowSpec is not a function` (bzw. `missing driftArrowSpec`).

- [ ] **Step 3: Palette + Funktion implementieren** — `karts3d.js`. Ersetze exakt (Ende des pure-Helper-Blocks, direkt vor dem DOM-Banner):

```
  return c;
}

// ── DOM/WebGL wrapper (gated by typeof THREE) ──────────────
```

  mit:

```
  return c;
}

// driftArrowSpec: Darstellungs-Parameter fuer den 3D-Drift-Pfeil aus dem
// Phase-18-Driftzustand. Rein, wirft nie. Laenge ~ Drift-Index (0..2 -> 0..maxLen),
// Richtung = Vorzeichen der gemessenen Gierrate, Farbe je Status. 'n/a'/fehlende
// Daten -> unsichtbar.
var DRIFT_3D_COLOR = {
  grip:       0x3ee08a,   // gruen  (wie _zoneColor green)
  oversteer:  0xffa336,   // amber  (wie _zoneColor orange)
  understeer: 0x7aa2f7,   // blau   (wie 2D-Badge --blue)
  counter:    0xff5470    // rot    (wie _zoneColor red)
};
function driftArrowSpec(status, index, yawRate, opts) {
  opts = opts || {};
  var maxLen = Number(opts.maxLen) || 1.6;
  var minLen = Number(opts.minLen) || 0.06;
  var color = DRIFT_3D_COLOR[status];
  var idx = Number(index);
  if (color == null || index == null || !isFinite(idx)) {
    return { visible: false, length: 0, dirSign: 0, color: 0xffffff };
  }
  var clamped = Math.max(0, Math.min(2, idx));
  var length = clamped / 2 * maxLen;
  var dirSign = (Number(yawRate) || 0) >= 0 ? 1 : -1;
  return {
    visible: length > 0.05,
    length: Math.max(length, minLen),
    dirSign: dirSign,
    color: color
  };
}

// ── DOM/WebGL wrapper (gated by typeof THREE) ──────────────
```

- [ ] **Step 4: Export ergänzen** — `karts3d.js`. Ersetze exakt:

```
    kartModelYawReducer: kartModelYawReducer,
    init: init,
```

  mit:

```
    kartModelYawReducer: kartModelYawReducer,
    driftArrowSpec: driftArrowSpec,
    init: init,
```

- [ ] **Step 5: Tests laufen lassen → müssen bestehen**

  Run: `node --test test/karts3d.test.js`
  Expected: PASS (alle karts3d-Fälle inkl. der 5 neuen).
  Run: `node --test` (gesamte Suite) → `tests 66 | pass 66 | fail 0`.

- [ ] **Step 6: Lint + Syntax**

  Run: `node --check karts3d.js` → exit 0.
  Run: `npx eslint karts3d.js test/karts3d.test.js` → exit 0.

- [ ] **Step 7: Commit**

```bash
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" add karts3d.js test/karts3d.test.js
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" commit -m "feat(drift3d): pure driftArrowSpec helper + unit tests

Maps the Phase-18 drift state to a 3D arrow spec (length ~ index,
direction = yaw-rate sign, colour per status). 5 node:test cases.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: DOM-Pfeil `_driftArrow` + Wiring

**Files:**
- Modify: `karts3d.js` (Modul-Var, `init`, `update`, `dispose`)
- Modify: `rasicross.js` (`RasiKart3D.update(...)`-Aufruf)

- [ ] **Step 1: Modul-Variable deklarieren** — `karts3d.js`. Ersetze exakt:

```
var _gzBar = null;          // Gz-glow vertical bar mesh
```

  mit:

```
var _gzBar = null;          // Gz-glow vertical bar mesh
var _driftArrow = null;     // Drift yaw-rate arrow (Phase 18 -> 3D)
```

- [ ] **Step 2: `_driftArrow` in `init()` anlegen** — `karts3d.js`. Ersetze exakt (das Ende des Gz-Bar-Setups):

```
  _gzBar.position.set(0, 0.5, 1.4);
  _gzBar.scale.y = 0.001;
  _scene.add(_gzBar);
```

  mit:

```
  _gzBar.position.set(0, 0.5, 1.4);
  _gzBar.scale.y = 0.001;
  _scene.add(_gzBar);

  // Drift yaw-rate arrow (raised above the kart, world-fixed like _arrow).
  _driftArrow = new THREE.ArrowHelper(
    new THREE.Vector3(1, 0, 0),
    new THREE.Vector3(0, 1.4, 0),
    0.01,
    0x3ee08a,
    0.2, 0.12
  );
  _driftArrow.visible = false;
  _scene.add(_driftArrow);
```

- [ ] **Step 3: Pfeil in `update()` aktualisieren** — `karts3d.js`. Ersetze exakt (das Ende des Gz-Glow-Blocks + der folgende Resize-Kommentar):

```
  _gzBar.material.opacity = 0.3 + 0.6 * scaleY;

  // Re-fit if the canvas client size or device pixel ratio changed (cheap
```

  mit:

```
  _gzBar.material.opacity = 0.3 + 0.6 * scaleY;

  // Drift-Pfeil: gemessene Gierrate-Abweichung. imu.drift = {status,index}
  // aus RasiDrift.analyze; imu.yaw liefert das Vorzeichen (Drehrichtung).
  var dInfo = imu.drift || {};
  var dSpec = driftArrowSpec(dInfo.status, dInfo.index, imu.yaw);
  if (!dSpec.visible) {
    _driftArrow.visible = false;
  } else {
    _driftArrow.visible = true;
    _tmpArrowDir.set(dSpec.dirSign, 0, 0);
    _driftArrow.setDirection(_tmpArrowDir);
    _driftArrow.setLength(dSpec.length, 0.2, 0.12);
    _driftArrow.setColor(dSpec.color);
  }

  // Re-fit if the canvas client size or device pixel ratio changed (cheap
```

- [ ] **Step 4: `_driftArrow` in `dispose()` nullen** — `karts3d.js`. Ersetze exakt:

```
  _kartGroup = _arrow = _gzBar = null;
```

  mit:

```
  _kartGroup = _arrow = _gzBar = _driftArrow = null;
```

- [ ] **Step 5: Wiring in `rasicross.js`** — `drift` an `update()` durchreichen. Ersetze exakt:

```
    window.RasiKart3D.update({
      gx: state.display.gxLerp,
      gy: state.display.gyLerp,
      gz: state.telemetry.gz || 0,
      yaw: state.imu.yaw || 0,
      dtMs: dtMs
    });
```

  mit:

```
    window.RasiKart3D.update({
      gx: state.display.gxLerp,
      gy: state.display.gyLerp,
      gz: state.telemetry.gz || 0,
      yaw: state.imu.yaw || 0,
      dtMs: dtMs,
      drift: state.drift
    });
```

- [ ] **Step 6: Verifikation**

  Run: `node --check karts3d.js` → exit 0.
  Run: `node --check rasicross.js` → exit 0.
  Run: `npx eslint karts3d.js rasicross.js` → exit 0.
  Run: `node --test` → `tests 66 | pass 66 | fail 0` (DOM-Teil ist nicht getestet — Zahl unverändert ggü. Task 1).
  Grep-Tool auf `karts3d.js`: `_driftArrow` → 6 (Deklaration + init-Erzeugung + `_scene.add` + 2 in update + dispose-Null). `driftArrowSpec\(dInfo` → 1. Auf `rasicross.js`: `drift: state\.drift` → 1.

- [ ] **Step 7: Commit**

```bash
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" add karts3d.js rasicross.js
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" commit -m "feat(drift3d): drift yaw-rate arrow in the 3D kart viewer

_driftArrow (THREE.ArrowHelper) raised above the kart, driven each frame
by driftArrowSpec from imu.drift + imu.yaw; rasicross passes state.drift
into RasiKart3D.update. Hidden when n/a. Purely additive.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Voll-Verifikation, Plan-Commit & Push

**Files:** keine Code-Änderung; committet das Plan-Dokument.

- [ ] **Step 1: Voller lokaler CI-Dry-Run** (Clone-Root):

```
node --check geo.js
node --check replay.js
node --check drift.js
node --check karts3d.js
node --check rasicross.js
node --check main.js
node --check preload.js
npx eslint .
npm test
python -m py_compile sender.py bridge.py esp_libs/micropyGPS.py esp_libs/mpu6050.py esp_libs/oled_diagnose.py esp_libs/ssd1306.py esp_libs/calc.py
python -m unittest discover -s test -p "test_*.py"
```

  Expected: alle exit 0; `npm test` / `node --test` = `tests 66 | pass 66 | fail 0` (61 Baseline + 5 neue `test()`-Fälle). `unittest` = `Ran 34 tests` `OK` (unverändert — kein Python-Touch). `__pycache__` vor `git status` löschen (Bash: `find . -name __pycache__ -type d -prune -exec rm -rf {} + 2>/dev/null`).

- [ ] **Step 2: Additivitäts-Spot-Check**
  - Grep `karts3d.js`: der bestehende `_arrow`/`_gzBar`-Code ist unverändert; `_driftArrow` ist rein additiv. `update()` berechnet den Drift-Pfeil nur aus `imu.drift`/`imu.yaw`.
  - Altaufrufer-Sicherheit: ein `update(imu)` ohne `drift`-Feld ⇒ `imu.drift` undefined ⇒ `driftArrowSpec(undefined,…)` ⇒ `visible:false` ⇒ Pfeil aus, kein Fehler.
  - Kein ESP/Python/Protokoll-Touch.

- [ ] **Step 3: Plan-Dokument committen**

```bash
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" add docs/superpowers/plans/2026-05-30-drift-arrow-3d.md
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" commit -m "docs: drift-arrow 3D implementation plan

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

- [ ] **Step 4: Push**

```bash
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" push
```

  Credentials sind diese Session gecached — sollte still durchlaufen. Hängt es >30 s an Auth, BLOCKED melden (nicht loopen).

- [ ] **Step 5: An den User delegiert (hier NICHT versuchen):** Manueller 3D-Smoke — `RasiCross_Telemetry.html` öffnen, G-Meter auf 3D stellen, bei sauberer Kurve grüner kurzer Pfeil (Grip), Tail steppt aus → langer amber Pfeil (Drift), Schieben → kurzer blauer Pfeil, harter Gegenlenk/Spin → roter Pfeil auf die andere Seite. Bei Stillstand/Gerade kein Pfeil. Als pending im Report notieren.

---

## Manual Acceptance Checklist (user-run — Dashboard, kein ESP-Flash)

`RasiCross_Telemetry.html` im Desktop-App (oder Chromium) öffnen, G-Meter auf **3D**:

1. **Stillstand / Gerade:** kein Drift-Pfeil über dem Kart (oder nur sehr kurz bei Grip).
2. **Saubere Kurve:** kurzer grüner Pfeil (Grip, index≈1).
3. **Übersteuern:** langer amber Pfeil (index>1).
4. **Untersteuern:** sehr kurzer blauer Pfeil (index<1).
5. **Counter/Spin:** roter Pfeil, auf die der Kurvenrichtung entgegengesetzte Seite.
6. **Replay:** beim Scrubben/Abspielen folgt der Pfeil dem Driftzustand (über `feedReplayPacket`→`processTelemetry`→`state.drift`).
7. **2D-Ansicht:** unverändert; das 2D-Drift-Badge wie zuvor.

---

## Self-Review

**1. Spec-Coverage:**
- Pure `driftArrowSpec` + Palette + Tests → Task 1. ✅
- `_driftArrow` DOM-Mesh in init/update/dispose → Task 2. ✅
- `rasicross.js` reicht `drift: state.drift` → Task 2 Step 5. ✅
- Welt-fixiert, erhöht (y≈1.4), Farbe je Status, Länge ∝ Index, Richtung = Gierraten-Vorzeichen → Task 1 (Logik) + Task 2 (Anwendung). ✅
- Additivität / n/a-unsichtbar / Altaufrufer-Sicherheit → Verhaltens-Invariante + Task 3 Step 2. ✅

**2. Placeholder-Scan:** Keine TBD/TODO. Jeder Code-Step zeigt vollständigen Literal-Code; jeder Command hat ein erwartetes Ergebnis.

**3. Typ/Namens-Konsistenz:** `driftArrowSpec(status,index,yawRate,opts)` → `{visible,length,dirSign,color}` definiert Task 1, konsumiert Task 2 Step 3. `DRIFT_3D_COLOR`-Keys (`grip/oversteer/understeer/counter`) entsprechen `RasiDrift.analyze`-Status. `imu.drift = {status,index}` entspricht `state.drift` (Phase 18). `_driftArrow` deklariert/erzeugt/genutzt/genullt konsistent. `_tmpArrowDir` wird wiederverwendet (nach dem G-Pfeil-Block sicher).

**4. Testzahl:** 5 neue `test()`-Fälle (das erweiterte Export-Array bleibt ein bestehender Test) ⇒ Suite 61 → **66**. Konsistent in Task 1 Step 5, Task 2 Step 6 und Task 3 Step 1.
