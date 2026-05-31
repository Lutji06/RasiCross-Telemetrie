# Phase 19a — Roll/Abheben: Firmware-Fundament + attitude.js — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Die Roll-Rate (Gyro-X) auf den Funk bringen (Frame v2) und ein reines, getestetes Rollwinkel-Fusions-Modul (`attitude.js`) bereitstellen — das Fundament, auf dem Phase 19b die Dashboard-Anzeige (Rollwinkel + „LIFT!") aufsetzt.

**Architecture:** `frame.py` bekommt ein zusätzliches `int16 roll` (Gyro-X °/s ×10) direkt nach `yaw` (`FRAME_VER 1→2`, `SIZE 33→35`). `sender.py` glättet Gyro-X mit demselben EMA wie `yaw` und sendet `roll` in jedem Paket. `attitude.js` ist ein reines UMD-Modul (Komplementärfilter `rollStep` + Hysterese-Abhebe-Erkennung `wheelLift`), analog zu `drift.js`. `mpu6050.py` ±4 g (R3) ist eine **optionale, übersprungbare** Task.

**Tech Stack:** MicroPython/CPython (`frame.py`/`sender.py`/`mpu6050.py`, `unittest`), Vanilla-JS-UMD + `node:test` (`attitude.js`). Keine neuen Laufzeit-Abhängigkeiten.

**Spec:** `docs/superpowers/specs/2026-05-30-drift-rollover-detection-design.md` (Teil 2, R1–R9). Dieser Plan deckt **R1–R4 + R9-Anteil für attitude.js** ab; R5–R8 (Dashboard) folgen in Phase 19b.

---

## Working Directory & Conventions

- Repo-Root: `C:/Users/jimlu/Documents/RasiCross-Telemetrie-git`. Git als `git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" …`.
- **CRLF-Repo:** Vor jedem Edit die Zielregion frisch lesen (Read) und auf Text ankern; Zeilennummern indikativ. Verifikation mit dem **Grep-Tool**.
- `frame.py`/`sender.py`/`mpu6050.py` laufen unter MicroPython **und** CPython (CI). `attitude.js` ist **ES5** (`var`, keine Arrow-Funktionen, kein `??`/optional chaining) wie `drift.js`.
- **Hardware (ESP32 + MPU-6050) liegt hier nicht vor.** Sender/`mpu6050`-Laufzeit wird per `py_compile` + statischem Review abgedeckt; die echte Funktionsprüfung erfolgt über die Hardware-Checkliste (vom Nutzer). `frame.py` ist voll CPython-getestet.
- Pro Task ein Commit; nur die genannten Dateien adden (nie `git add .`, nie `.claude/` oder Plan-/Spec-Docs außer im finalen Plan-Doc-Commit). Trailer: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- Verifikations-Rezept: `python -m unittest discover -s test -p "test_*.py"` (oder `py -3 …`), `python -m py_compile sender.py bridge.py esp_libs/*.py`, `node --test`, `node --check`, `npm run lint`. `__pycache__` vor jedem `git status` löschen: `find . -name __pycache__ -type d -prune -exec rm -rf {} +`.
- **Baselines (frisch ermittelt):** `node --test` = **73**, `python -m unittest` = **34**. `package.json.version` = 9.6.0 (kein Bump).

## Locked decisions

- `roll` = Gyro-X-Rate (°/s ×10) als `int16`, **direkt nach `yaw`** im Frame. `FRAME_VER = 2`, `SIZE = 35`, `FMT = "<BHHHhhhhhiiHHHBbBB"`.
- Backward-compat über `FRAME_VER`+Längenprüfung (kein In-Frame-Thema). **Beide ESPs zusammen flashen.** `bridge.py` referenziert `frame.FRAME_VER`/`frame.SIZE` → übernimmt den Bump automatisch (verifizieren, nicht ändern).
- `attitude.js`: pure `rollStep(prevRollDeg, rollRateDps, gy, gz, dtSec, alpha)` (Komplementärfilter, α-Default 0.98, `dt` geklemmt) + pure `wheelLift(st, rollDeg, rollRateDps, thr) → {active, onset}` (Hysterese). State explizit durchgereicht (Muster wie `drift.smoothStep`).
- **R3 (±4 g) ist OPTIONAL** und ändert bestehendes `gx`/`gy`/`gz`-Verhalten — nur mit ausdrücklicher Zustimmung ausführen (Default: überspringen). Ohne R3 funktioniert alles, mit möglicher `gy`-Sättigung bei sehr hoher Querbeschleunigung.
- **Kein Dashboard-Wiring in diesem Plan** (das ist 19b). `attitude.js` wird erstellt, getestet und geladen (Script-Tag/Build/Lint), aber noch nicht von `rasicross.js` konsumiert. `roll` fließt durch `unpack` ins Paket, wird vom Dashboard vorerst ignoriert (additiv, kein Schaden).

## File Structure

| Action | Path | Responsibility |
|--------|------|----------------|
| Modify | `esp_libs/frame.py` | `FRAME_VER=2`, `roll`-Feld in `FMT`/`pack`/`unpack`, `SIZE=35`, Kommentare. |
| Modify | `test/test_frame.py` | `roll` Round-Trip + `FRAME_VER==2`/`SIZE==35` + v1-Reject + roll-default-0 Tests. |
| Modify | `sender.py` | `IMU._roll` EMA-Glättung von Gyro-X, `roll`-Property, `roll` in jedem Paket. |
| Modify | `esp_libs/mpu6050.py` | **OPTIONAL (R3):** `ACCEL_CONFIG=0x08` (±4 g) + `ACCEL_SCALE_4G`. |
| Create | `attitude.js` | Pure `rollStep` + `wheelLift` + Defaults, UMD-Export `RasiAttitude`. |
| Create | `test/attitude.test.js` | `node:test` für `rollStep`/`wheelLift`. |
| Modify | `package.json` | `attitude.js` in `build.files`. |
| Modify | `eslint.config.js` | `attitude.js`-Block (analog `drift.js`). |
| Modify | `RasiCross_Telemetry.html` | `<script src="attitude.js"></script>` vor `rasicross.js`. |

**Task-Reihenfolge:** 1 (frame.py v2, TDD) → 2 (sender.py roll) → 3 (mpu6050 ±4g, OPTIONAL) → 4 (attitude.js + Tests, TDD) → 5 (Packaging + Gesamt-Verifikation + Plan-Doc-Commit).

---

## Task 1: `frame.py` v2 — `roll`-Feld (TDD, CPython)

**Files:** Modify `esp_libs/frame.py`, `test/test_frame.py`.

- [ ] **Step 1: Failing tests** — in `test/test_frame.py`: (a) `roll` in `_base()`, (b) update `FrameLayout`, (c) add a `RollField` class. 

(a) OLD anchor (in `_base`):
```python
        "gz": 0.97, "yaw": -142.3, "lat": 49.6012345, "lon": 6.1198765,
```
NEW:
```python
        "gz": 0.97, "yaw": -142.3, "roll": 75.4, "lat": 49.6012345, "lon": 6.1198765,
```

(b) OLD (`test_size_and_ver`):
```python
    def test_size_and_ver(self):
        self.assertEqual(frame.SIZE, 33)
        self.assertEqual(frame.FMT, "<BHHHhhhhiiHHHBbBB")
        self.assertEqual(frame.FRAME_VER, 1)
        b = frame.pack(_base(), 7)
        self.assertIsInstance(b, (bytes, bytearray))
        self.assertEqual(len(b), 33)
        self.assertEqual(b[0], frame.FRAME_VER)
```
NEW:
```python
    def test_size_and_ver(self):
        self.assertEqual(frame.SIZE, 35)
        self.assertEqual(frame.FMT, "<BHHHhhhhhiiHHHBbBB")
        self.assertEqual(frame.FRAME_VER, 2)
        b = frame.pack(_base(), 7)
        self.assertIsInstance(b, (bytes, bytearray))
        self.assertEqual(len(b), 35)
        self.assertEqual(b[0], frame.FRAME_VER)
```

(c) Append a new test class (after the `Errors` class, before `if __name__`):
```python
class RollField(unittest.TestCase):
    def test_roll_roundtrip_value_and_sign(self):
        d = _base(); d["roll"] = 75.4
        self.assertAlmostEqual(frame.unpack(frame.pack(d, 0))["roll"], 75.4, places=1)
        d["roll"] = -75.4
        self.assertAlmostEqual(frame.unpack(frame.pack(d, 0))["roll"], -75.4, places=1)

    def test_roll_absent_defaults_zero(self):
        d = _base(); d.pop("roll")
        self.assertEqual(frame.unpack(frame.pack(d, 0))["roll"], 0.0)

    def test_roll_saturates(self):
        d = _base(); d["roll"] = 99999.0
        self.assertAlmostEqual(frame.unpack(frame.pack(d, 0))["roll"], 3276.7, places=1)
        d["roll"] = -99999.0
        self.assertAlmostEqual(frame.unpack(frame.pack(d, 0))["roll"], -3276.8, places=1)

    def test_v1_frame_rejected_by_length(self):
        # A 33-byte buffer (old v1 SIZE) must be rejected on length, not misread.
        self.assertEqual(frame.unpack(b"\x02" * 33)["_err"], "bad_len")
```

- [ ] **Step 2: Run, confirm RED**
Run: `python -m unittest discover -s test -p "test_*.py"` (or `py -3 …`)
Expected: FAIL (SIZE 33≠35 / roll KeyError / FMT mismatch).

- [ ] **Step 3: `frame.py` — version, format, size + header comment.**
OLD:
```python
#  33-Byte Little-Endian Frame, siehe Spec 2026-05-19 D1 4.2.
```
NEW:
```python
#  35-Byte Little-Endian Frame (v2: +roll Gyro-X), siehe Spec 2026-05-19 D1 4.2.
```
OLD:
```python
FRAME_VER = 1
FMT = "<BHHHhhhhiiHHHBbBB"
SIZE = struct.calcsize(FMT)            # 33
```
NEW:
```python
FRAME_VER = 2
FMT = "<BHHHhhhhhiiHHHBbBB"
SIZE = struct.calcsize(FMT)            # 35
```

- [ ] **Step 4: `frame.py` `pack` — compute `roll`, add to struct.pack.**
OLD:
```python
    yaw = _clamp(_i(_f(d.get("yaw")) * 10.0), -32768, 32767)
```
NEW:
```python
    yaw = _clamp(_i(_f(d.get("yaw")) * 10.0), -32768, 32767)
    roll = _clamp(_i(_f(d.get("roll")) * 10.0), -32768, 32767)
```
OLD (docstring + return):
```python
    """Telemetrie-dict + seq -> 33 Byte. Saettigt, wirft nie."""
```
NEW:
```python
    """Telemetrie-dict + seq -> 35 Byte. Saettigt, wirft nie."""
```
OLD:
```python
    return struct.pack(FMT, FRAME_VER, seq & 0xFFFF, speed, rpm,
                       gx, gy, gz, yaw, lat, lon, pulse, send_ms,
                       vbat, soc, mtemp, flags1, flags2)
```
NEW:
```python
    return struct.pack(FMT, FRAME_VER, seq & 0xFFFF, speed, rpm,
                       gx, gy, gz, yaw, roll, lat, lon, pulse, send_ms,
                       vbat, soc, mtemp, flags1, flags2)
```

- [ ] **Step 5: `frame.py` `unpack` — docstring, tuple, out dict.**
OLD:
```python
    """33 Byte -> Telemetrie-dict (Dashboard-kompatible Keys).
```
NEW:
```python
    """35 Byte -> Telemetrie-dict (Dashboard-kompatible Keys).
```
OLD:
```python
    (_ver, seq, speed, rpm, gx, gy, gz, yaw, lat, lon, pulse,
     send_ms, vbat, soc, mtemp, flags1, flags2) = struct.unpack(FMT, buf)
```
NEW:
```python
    (_ver, seq, speed, rpm, gx, gy, gz, yaw, roll, lat, lon, pulse,
     send_ms, vbat, soc, mtemp, flags1, flags2) = struct.unpack(FMT, buf)
```
OLD:
```python
        "yaw": yaw / 10.0,
```
NEW:
```python
        "yaw": yaw / 10.0,
        "roll": roll / 10.0,
```

- [ ] **Step 6: Confirm GREEN + compile**
Run: `python -m unittest discover -s test -p "test_*.py"`
Expected: PASS, ~38 tests OK (34 + 4 new).
Run: `python -m py_compile esp_libs/frame.py`
Expected: clean. Then delete `__pycache__`.

- [ ] **Step 7: Commit**
```bash
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" add esp_libs/frame.py test/test_frame.py
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" commit -m "feat(frame): v2 frame with roll (Gyro-X) field, SIZE 35" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: `sender.py` — roll-rate smoothing + send (static; hardware-deferred)

**Files:** Modify `sender.py`. Not unit-testable (needs MPU). Verify `py_compile` + Grep; runtime via hardware checklist.

- [ ] **Step 1: IMU `__init__` — add roll state.**
OLD:
```python
        self._yaw = 0.0          # geglaettete Gier-Rate = Gyro-Z (deg/s)
```
NEW:
```python
        self._yaw = 0.0          # geglaettete Gier-Rate = Gyro-Z (deg/s)
        self._roll = 0.0         # geglaettete Roll-Rate = Gyro-X (deg/s)
```

- [ ] **Step 2: IMU `update` — read Gyro-X, smooth it.**
OLD:
```python
            _gxr, _gyr, gzr = self._mpu.gyro      # nur Z (= Gier) genutzt
```
NEW:
```python
            gxr, _gyr, gzr = self._mpu.gyro       # X (= Roll) + Z (= Gier) genutzt
```
OLD:
```python
            self._yaw = alpha * gzr + (1 - alpha) * self._yaw
```
NEW:
```python
            self._yaw = alpha * gzr + (1 - alpha) * self._yaw
            self._roll = alpha * gxr + (1 - alpha) * self._roll
```

- [ ] **Step 3: IMU `roll` property — after `yaw`.**
OLD:
```python
    @property
    def yaw(self):  return self._yaw
```
NEW:
```python
    @property
    def yaw(self):  return self._yaw

    @property
    def roll(self): return self._roll
```

- [ ] **Step 4: Packet dict — send `roll` each packet.**
OLD:
```python
                "yaw":      round(imu.yaw, 1),   # Gier-Rate (deg/s), jedes Paket
```
NEW:
```python
                "yaw":      round(imu.yaw, 1),   # Gier-Rate (deg/s), jedes Paket
                "roll":     round(imu.roll, 1),  # Roll-Rate (deg/s), jedes Paket
```

- [ ] **Step 5: Verify**
Run: `python -m py_compile sender.py`
Expected: clean.
Grep-Tool `sender.py` for `_roll|imu\.roll|gxr` → confirm: `self._roll` init + smoothing + property; `"roll":` in packet; `gxr` used (no longer `_gxr`).
Grep-Tool `bridge.py` for `FRAME_VER|frame\.SIZE` → confirm it references the constants (auto-handles v2), no hardcoded `33`/`1`. (If a hardcoded literal is found, STOP and report — that would need a fix.)

- [ ] **Step 6: Commit**
```bash
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" add sender.py
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" commit -m "feat(sender): smooth Gyro-X roll-rate + send roll in every packet" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: `mpu6050.py` ±4 g — **OPTIONAL (R3), only with explicit user consent**

> **Skip by default.** Execute ONLY if the user confirms. Changes existing `gx`/`gy`/`gz` resolution (halves it) to gain headroom for the gravity reference. Without it, everything still works (possible `gy` saturation at very high lateral g — documented).

**Files:** Modify `esp_libs/mpu6050.py`. Static; `py_compile`; hardware-verified.

- [ ] **Step 1: Add ±4 g scale constant.**
OLD:
```python
    # Skalierung fuer Beschleunigung +-2g (Standard-Range)
    ACCEL_SCALE_2G = 16384.0
```
NEW:
```python
    # Skalierung fuer Beschleunigung +-2g (Standard-Range)
    ACCEL_SCALE_2G = 16384.0
    # Skalierung fuer Beschleunigung +-4g (ACCEL_CONFIG=0x08)
    ACCEL_SCALE_4G = 8192.0
```

- [ ] **Step 2: Use ±4 g in `__init__`.**
OLD:
```python
        self._scale = self.ACCEL_SCALE_2G
```
NEW:
```python
        self._scale = self.ACCEL_SCALE_4G
```
OLD:
```python
        # Accel-Range +- 2g
        self._write_byte(self.ACCEL_CONFIG, 0x00)
```
NEW:
```python
        # Accel-Range +- 4g (mehr Headroom fuer Schwerkraft-Referenz/Drift)
        self._write_byte(self.ACCEL_CONFIG, 0x08)
```

- [ ] **Step 3: Verify + commit**
Run: `python -m py_compile esp_libs/mpu6050.py` → clean.
```bash
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" add esp_libs/mpu6050.py
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" commit -m "feat(mpu6050): switch accel range to +-4g (R3, opt-in)" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: `attitude.js` — pure roll fusion + wheel-lift (TDD)

**Files:** Create `attitude.js`, `test/attitude.test.js`.

- [ ] **Step 1: Failing tests** — create `test/attitude.test.js`:
```js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const att = require('../attitude.js');

const approx = (a, b, tol = 1e-3) => assert.ok(Math.abs(a - b) <= tol, `${a} != ${b} (±${tol})`);

test('module exports rollStep + wheelLift', () => {
  assert.equal(typeof att.rollStep, 'function');
  assert.equal(typeof att.wheelLift, 'function');
});

test('rollStep: alpha=0 -> pure accel reference atan2(gy,gz)', () => {
  // prev/rate ignored; atan2(1,0)=pi/2 -> 90 deg
  approx(att.rollStep(99, 999, 1, 0, 0.1, 0), 90, 1e-6);
});

test('rollStep: alpha=1 -> pure gyro integration', () => {
  // 10 + 90 dps * 0.1 s = 19
  approx(att.rollStep(10, 90, 0, 1, 0.1, 1), 19, 1e-9);
});

test('rollStep: dt clamped on a large gap (no jump)', () => {
  // dt 5.0 -> clamped to 0.5: 0 + 100*0.5 = 50 (not 500)
  approx(att.rollStep(0, 100, 0, 1, 5.0, 1), 50, 1e-9);
});

test('rollStep: blends gyro and accel by alpha', () => {
  // alpha 0.5: 0.5*(0+0) + 0.5*atan2(1,1)=0.5*45 = 22.5
  approx(att.rollStep(0, 0, 1, 1, 0.1, 0.5), 22.5, 1e-6);
});

test('wheelLift: onset when angle AND rate exceed', () => {
  const thr = { angleDeg: 12, rateDps: 60, hystDeg: 3 };
  const r = att.wheelLift({ active: false }, 15, 80, thr);
  assert.equal(r.active, true);
  assert.equal(r.onset, true);
});

test('wheelLift: no onset when only one threshold exceeds', () => {
  const thr = { angleDeg: 12, rateDps: 60, hystDeg: 3 };
  assert.equal(att.wheelLift({ active: false }, 15, 50, thr).active, false); // rate low
  assert.equal(att.wheelLift({ active: false }, 10, 80, thr).active, false); // angle low
});

test('wheelLift: hysteresis holds active until below angle-hyst', () => {
  const thr = { angleDeg: 12, rateDps: 60, hystDeg: 3 };
  assert.equal(att.wheelLift({ active: true }, 10, 5, thr).active, true);  // 10 > 9
  assert.equal(att.wheelLift({ active: true }, 8, 5, thr).active, false);  // 8 < 9
  // onset is false on a continuing event
  assert.equal(att.wheelLift({ active: true }, 15, 80, thr).onset, false);
});

test('attitude: junk inputs never throw', () => {
  assert.doesNotThrow(() => att.rollStep(NaN, NaN, NaN, NaN, NaN, NaN));
  assert.doesNotThrow(() => att.wheelLift(null, NaN, NaN, null));
});
```

- [ ] **Step 2: Run, confirm RED**
Run: `node --test test/attitude.test.js`
Expected: FAIL (cannot find module `../attitude.js`).

- [ ] **Step 3: Create `attitude.js`** (ES5 UMD, dependency-free):
```js
'use strict';
// ============================================================
//  attitude.js — pure roll-angle fusion + wheel-lift (Phase 19)
//  Loaded as a classic <script> BEFORE rasicross.js (exposes
//  window.RasiAttitude) and as a CommonJS module for node:test.
//  Dependency-free. No DOM. See spec 2026-05-30 §5.6.
// ============================================================

var _DEG = 180 / Math.PI;
var LIFT_DEFAULTS = { angleDeg: 12, rateDps: 60, hystDeg: 3 };

function _num(x) { var v = Number(x); return isFinite(v) ? v : 0; }
function _clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

// Complementary-filter step -> new roll angle (deg).
//   prevRollDeg : last roll angle (deg)
//   rollRateDps : roll rate (deg/s, Gyro-X)
//   gy, gz      : accel axes (g) for the gravity reference
//   dtSec       : timestep (s), clamped against gaps
//   alpha       : gyro weight (default 0.98)
function rollStep(prevRollDeg, rollRateDps, gy, gz, dtSec, alpha) {
  var a = alpha == null ? 0.98 : Number(alpha);
  if (!(a >= 0)) a = 0;
  if (a > 1) a = 1;
  var dt = _clamp(_num(dtSec), 0, 0.5);            // clamp against stalls/gaps
  var gyroPart = _num(prevRollDeg) + _num(rollRateDps) * dt;
  var accelRoll = Math.atan2(_num(gy), _num(gz)) * _DEG;
  return a * gyroPart + (1 - a) * accelRoll;
}

// Wheel-lift event with hysteresis. Pure: state in, result out.
//   st  : { active }
//   thr : { angleDeg, rateDps, hystDeg }
//   -> { active, onset }
function wheelLift(st, rollDeg, rollRateDps, thr) {
  st = st || {};
  var t = thr || {};
  var angleDeg = t.angleDeg == null ? LIFT_DEFAULTS.angleDeg : t.angleDeg;
  var rateDps  = t.rateDps  == null ? LIFT_DEFAULTS.rateDps  : t.rateDps;
  var hystDeg  = t.hystDeg  == null ? LIFT_DEFAULTS.hystDeg  : t.hystDeg;
  var aRoll = Math.abs(_num(rollDeg));
  var aRate = Math.abs(_num(rollRateDps));
  var wasActive = !!st.active;
  var active = wasActive
    ? aRoll > (angleDeg - hystDeg)                 // stay until below angle-hyst
    : (aRoll > angleDeg && aRate > rateDps);       // enter needs BOTH
  return { active: active, onset: active && !wasActive };
}

// ── UMD-style export ────────────────────────────────────────
(function () {
  var api = { rollStep: rollStep, wheelLift: wheelLift };
  if (typeof module !== 'undefined' && module.exports) { module.exports = api; }
  if (typeof window !== 'undefined') { window.RasiAttitude = api; }
})();
```

- [ ] **Step 4: Confirm GREEN + syntax**
Run: `node --test test/attitude.test.js` → expect PASS (9 tests).
Run: `node --check attitude.js` → expect no output.

- [ ] **Step 5: Commit**
```bash
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" add attitude.js test/attitude.test.js
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" commit -m "feat(attitude): pure roll-fusion + wheel-lift module + tests" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: Packaging (`attitude.js`) + full verification + plan-doc commit

**Files:** Modify `package.json`, `eslint.config.js`, `RasiCross_Telemetry.html`.

- [ ] **Step 1: `package.json` `build.files` — add `attitude.js` after `drift.js`.**
OLD:
```json
      "drift.js",
      "karts3d.js",
```
NEW:
```json
      "drift.js",
      "attitude.js",
      "karts3d.js",
```

- [ ] **Step 2: `eslint.config.js` — add an `attitude.js` block (after the `drift.js` block).**
OLD:
```js
  // drift.js setzt window.RasiDrift (UMD, Browser + node:test)
  {
    files: ['drift.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: { ...globals.browser, module: 'readonly' },
    },
    rules: bugRules,
  },
```
NEW:
```js
  // drift.js setzt window.RasiDrift (UMD, Browser + node:test)
  {
    files: ['drift.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: { ...globals.browser, module: 'readonly' },
    },
    rules: bugRules,
  },

  // attitude.js setzt window.RasiAttitude (UMD, Browser + node:test)
  {
    files: ['attitude.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: { ...globals.browser, module: 'readonly' },
    },
    rules: bugRules,
  },
```

- [ ] **Step 3: `RasiCross_Telemetry.html` — load `attitude.js` after `drift.js`.**
OLD:
```html
<script src="drift.js"></script>
```
NEW:
```html
<script src="drift.js"></script>
<script src="attitude.js"></script>
```

- [ ] **Step 4: Full verification**
- `node --check geo.js replay.js drift.js attitude.js karts3d.js rasicross.js main.js preload.js` → all clean.
- `node --test` → expect ~**82** pass, 0 fail (73 + 9 attitude).
- `npm run lint` → clean (new `attitude.js` block declares its globals).
- `python -m unittest discover -s test -p "test_*.py"` → expect ~**38** OK (34 + 4 frame roll).
- `python -m py_compile sender.py bridge.py esp_libs/*.py` → clean.
- Delete `__pycache__`: `find . -name __pycache__ -type d -prune -exec rm -rf {} +`.

- [ ] **Step 5: Status + commit packaging**
Run: `git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" status --short` → only `package.json`, `eslint.config.js`, `RasiCross_Telemetry.html` (+ untracked this plan).
```bash
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" add package.json eslint.config.js RasiCross_Telemetry.html
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" commit -m "build(attitude): bundle, lint and load attitude.js" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

- [ ] **Step 6: Plan-doc commit (final, explicit)**
```bash
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" add "docs/superpowers/plans/2026-05-31-19a-roll-firmware-attitude.md"
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" commit -m "docs: phase 19a roll-firmware + attitude implementation plan" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Hardware / Manual Acceptance Checklist (Nutzer — nach Flash BEIDER ESPs mit `frame.py` v2 + `sender.py`)

1. **Regression:** `gx`/`gy`/`gz`/`yaw`/`speed`/`rpm`/Batterie unverändert; Bridge empfängt v2-Frames ohne `bad_ver`/`bad_len` (beide ESPs geflasht).
2. **roll:** Kart im Stand ⇒ Roll-Rate ≈ 0; um die Längsachse kippen ⇒ `roll` zeigt die Rate mit korrektem Vorzeichen, Rückkehr gegen 0. (Im JSON-Diag/Log sichtbar; Dashboard-Anzeige kommt erst mit 19b.)
3. **No-MPU:** ohne MPU ⇒ `roll = 0.0`, kein Stall (early return unverändert).
4. **(Falls R3) ±4 g:** harte Kurve clippt `gy` nicht mehr; `gx`/`gy` im Alltag weiterhin plausibel (halbe Roh-Auflösung).
5. **Byte-Budget:** Funk-Frame 35 B < 250 B ESP-NOW.

## Self-Review (Plan ↔ Spec)

- **Spec coverage:** R1 (frame v2 + Tests) → Task 1; R2 (sender roll) → Task 2; R3 (±4 g, opt) → Task 3; R4 (attitude.js + Tests) → Task 4; R9-Anteil (attitude.js Packaging/Lint/Script) → Task 5. R5–R8 (Dashboard) bewusst in 19b.
- **Placeholder-Scan:** kein `TBD`/`TODO`; jeder Code-Step vollständig.
- **Konsistenz:** `roll` Key/Skalierung (×10) identisch in `frame.py`/`sender.py`/Tests; `FRAME_VER=2`/`SIZE=35`/`FMT` konsistent zwischen `frame.py` und `test_frame.py`; `RasiAttitude`/`rollStep`/`wheelLift` einmal benannt, verbatim wiederverwendet; `attitude.js` ES5 wie `drift.js`.
- **Backward-compat:** `FRAME_VER`/Längenprüfung; `bridge.py` referenziert die Konstanten (Step-2.5-Grep verifiziert, kein Hardcode); v1↔v2 sauber abgewiesen; beide flashen.
- **CRLF/Hygiene:** Edits auf frisch gelesene Anker; Grep-Tool; `__pycache__` vor `git status` löschen; nur genannte Dateien adden.

## Phase Map

| Phase | Scope | Status |
|-------|-------|--------|
| 18 / Follow-up / 20 | Drift-Erkennung + 3D-Pfeil + Härtung/Glättung | gemerged / fertig |
| **19a** (dieser Plan) | Frame v2 (`roll`) + sender + `attitude.js` (Fundament) | dieser Plan |
| 19b | Dashboard: `roll` parsen, Rollwinkel-Fusion, Live „LIFT!", Replay, Settings (R5–R8) | folgt |
