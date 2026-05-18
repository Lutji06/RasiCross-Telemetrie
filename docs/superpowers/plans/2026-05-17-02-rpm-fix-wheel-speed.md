# Phase 2 — RPM IRQ Fix + Wheel-Speed Fallback (A1 + A2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the lost-pulse race in the kart RPM counter (A1) and add a Hall-wheel speed fallback when GPS has no fix (A2), with the speed math in a pure, unit-tested module.

**Architecture:** New dependency-free `esp_libs/calc.py` holds the two pure functions (`wheel_speed_kmh`, `speed_source`) so they are unit-testable under CPython and reusable on MicroPython. `sender.py` wraps the Hall counter read+reset in a `disable_irq`/`enable_irq` critical section, exposes `ppr`, imports `calc` (guarded), and picks the speed source per priority, emitting a new optional `spd_src` field. The dashboard reads `spd_src`, shows a small source tag by the Speed KPI, and adds a `wheel_circ_m` live-config input. CI gains a Python unit-test step.

**Tech Stack:** MicroPython (`sender.py`, `esp_libs/calc.py`), CPython 3 stdlib `unittest` (tests, zero new deps), Node ≥18 `node:test` (regression only), GitHub Actions.

---

## Working Directory & Conventions

**All work happens in the git clone:** `C:/Users/jimlu/Documents/RasiCross-Telemetrie-git` (branch `docs/telemetry-improvements-spec`, Phase 1 already committed/pushed).

- Paths relative to the clone root unless absolute. Files use **CRLF**; always `Read` the target file in-session immediately before an `Edit` and copy the `old_string` anchor from that fresh Read.
- Git: `git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" …`.
- Windows: Python may be `python` or `py -3` — try `python` first, fall back to `py -3`. Node v24 local; CI Node 20 / Python 3.12.
- **Spec:** `docs/superpowers/specs/2026-05-17-rasicross-telemetry-improvements-design.md` §5 A1, §5 A2, §6 (`spd_src`), §7.
- **ESP code reality:** `sender.py` cannot be runtime-tested here (no ESP32). All speed *math* is in `calc.py` and IS unit-tested. `sender.py` edits are conservative wiring, statically reviewed, and **hardware-verified by the user** via the checklist at the end.

**Behavioral invariant:** `spd_src` is a new optional field; the dashboard tolerates its absence (old firmware) and missing speed source. No existing field renamed/removed. With GPS fix present, behavior is unchanged (still GPS speed).

---

## File Structure

| Action | Path | Responsibility |
|--------|------|----------------|
| Create | `esp_libs/calc.py` | Pure speed math: `wheel_speed_kmh(pulse_hz, ppr, circ_m)`, `speed_source(gps_fix, wheel_circ_m)`. No imports. CPython+MicroPython safe. |
| Create | `test/test_calc.py` | CPython stdlib `unittest` for `calc.py`. |
| Modify | `.github/workflows/check.yml` | Add `esp_libs/calc.py` to py_compile; add a `unittest` step. |
| Modify | `sender.py` | A1: IRQ critical section + `ppr` property. A2: guarded `import calc`, speed-source priority + `spd_src`, `wheel_circ_m` in `apply_config`. |
| Modify | `rasicross.js` | A2: `state.spdSrc`, parse `d.spd_src`, Speed-KPI source tag, `wheel_circ_m` in config packet. |
| Modify | `RasiCross_Telemetry.html` | A2: `#espWheelCirc` input; `#spdSrcTag` element under Speed KPI. |

**Task order (each commit independently sound):** T1 calc.py+tests → T2 CI wiring → T3 A1 sender IRQ → T4 A2 sender wiring → T5 A2 dashboard → T6 phase verify/commit/push.

---

### Task 1: Pure speed math module + unit tests

**Files:**
- Create: `esp_libs/calc.py`
- Create: `test/test_calc.py`

- [ ] **Step 1: Write the failing tests**

Create `test/test_calc.py`:

```python
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'esp_libs'))
import calc  # noqa: E402


class WheelSpeedKmh(unittest.TestCase):
    def test_zero_for_nonpositive(self):
        self.assertEqual(calc.wheel_speed_kmh(0, 1, 1.0), 0.0)
        self.assertEqual(calc.wheel_speed_kmh(10, 0, 1.0), 0.0)
        self.assertEqual(calc.wheel_speed_kmh(10, 1, 0.0), 0.0)
        self.assertEqual(calc.wheel_speed_kmh(-5, 1, 1.0), 0.0)

    def test_zero_for_bad_types(self):
        self.assertEqual(calc.wheel_speed_kmh(None, 1, 1.0), 0.0)
        self.assertEqual(calc.wheel_speed_kmh('x', 1, 1.0), 0.0)
        self.assertEqual(calc.wheel_speed_kmh(10, None, 1.0), 0.0)

    def test_normal(self):
        # 10 pulses/s, 1 ppr, 1 m -> 10 rev/s -> 36.0 km/h
        self.assertAlmostEqual(calc.wheel_speed_kmh(10, 1, 1.0), 36.0, places=6)
        # 2 ppr halves the speed
        self.assertAlmostEqual(calc.wheel_speed_kmh(10, 2, 1.0), 18.0, places=6)
        # arbitrary realistic values
        self.assertAlmostEqual(calc.wheel_speed_kmh(71.3, 1, 1.2),
                               71.3 * 1.2 * 3.6, places=6)


class SpeedSource(unittest.TestCase):
    def test_gps_wins(self):
        self.assertEqual(calc.speed_source(True, 0.0), 'gps')
        self.assertEqual(calc.speed_source(1, 1.2), 'gps')

    def test_wheel_when_configured_and_no_fix(self):
        self.assertEqual(calc.speed_source(False, 1.2), 'wheel')
        self.assertEqual(calc.speed_source(0, 0.001), 'wheel')

    def test_none_when_no_fix_and_no_circ(self):
        self.assertEqual(calc.speed_source(False, 0.0), 'none')
        self.assertEqual(calc.speed_source(0, 0), 'none')
        self.assertEqual(calc.speed_source(False, None), 'none')


if __name__ == '__main__':
    unittest.main()
```

- [ ] **Step 2: Run tests to verify they fail**

Run (from clone root): `python -m unittest discover -s test -p "test_*.py" -v`
(If `python` is missing, use `py -3 -m unittest discover -s test -p "test_*.py" -v`.)
Expected: FAIL — `ModuleNotFoundError: No module named 'calc'`.

- [ ] **Step 3: Create `esp_libs/calc.py`**

Create `esp_libs/calc.py`:

```python
# ============================================================
#  RasiCross  --  calc.py  (pure speed math)
# ============================================================
#  Keine Importe -> laeuft identisch unter CPython (Unit-Tests /
#  CI) und MicroPython (auf dem Kart-ESP32). Auf den Kart-ESP wie
#  die anderen esp_libs ins Root flashen:
#    mpremote connect <port> cp esp_libs/calc.py :
# ============================================================


def wheel_speed_kmh(pulse_hz, ppr, circ_m):
    """Fahrzeuggeschwindigkeit in km/h aus der Hall-Pulsfrequenz.

    pulse_hz : Hall-Pulse pro Sekunde
    ppr      : Hall-Pulse pro Radumdrehung (>= 1)
    circ_m   : Radumfang in Metern (> 0 aktiviert die Funktion)

    Liefert 0.0 bei nicht-positiven oder nicht-numerischen Eingaben.
    """
    try:
        pulse_hz = float(pulse_hz)
        ppr = float(ppr)
        circ_m = float(circ_m)
    except (TypeError, ValueError):
        return 0.0
    if pulse_hz <= 0.0 or ppr <= 0.0 or circ_m <= 0.0:
        return 0.0
    rev_per_s = pulse_hz / ppr
    return rev_per_s * circ_m * 3.6


def speed_source(gps_fix, wheel_circ_m):
    """Aus welcher Quelle die gemeldete Geschwindigkeit stammen soll.

    Prioritaet: GPS-Fix gewinnt; sonst Rad, falls ein Radumfang
    konfiguriert ist (> 0); sonst keine Quelle.

    Rueckgabe: 'gps' | 'wheel' | 'none'.
    """
    if gps_fix:
        return 'gps'
    try:
        if float(wheel_circ_m) > 0.0:
            return 'wheel'
    except (TypeError, ValueError):
        pass
    return 'none'
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `python -m unittest discover -s test -p "test_*.py" -v` (or `py -3 …`)
Expected: PASS — `Ran 6 tests` … `OK`.

- [ ] **Step 5: Byte-compile check (MicroPython-safety proxy)**

Run: `python -m py_compile esp_libs/calc.py` (or `py -3 -m py_compile esp_libs/calc.py`)
Expected: exit 0. Then delete any `__pycache__` created: Bash `find . -name __pycache__ -type d -prune -exec rm -rf {} +`. Confirm `git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" status --short` shows no `__pycache__`/`.pyc` (the repo `.gitignore` already covers these).

- [ ] **Step 6: Commit**

```bash
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" add esp_libs/calc.py test/test_calc.py
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" commit -m "feat: pure speed math (wheel_speed_kmh, speed_source) + unit tests

calc.py is import-free so it runs on CPython (CI/tests) and
MicroPython (kart). stdlib unittest, zero new deps.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 2: Wire the Python unit tests into CI

**Files:**
- Modify: `.github/workflows/check.yml`

- [ ] **Step 1: Read the workflow** `C:/Users/jimlu/Documents/RasiCross-Telemetrie-git/.github/workflows/check.yml` to anchor the edit. The `python` job currently ends with the `Byte-compile ESP scripts (syntax only)` step.

- [ ] **Step 2: Add calc.py to py_compile and add the unittest step**

Edit `.github/workflows/check.yml` — replace:

```
      - name: Byte-compile ESP scripts (syntax only)
        run: |
          python -m py_compile sender.py bridge.py \
            esp_libs/micropyGPS.py esp_libs/mpu6050.py \
            esp_libs/oled_diagnose.py esp_libs/ssd1306.py
```

with:

```
      - name: Byte-compile ESP scripts (syntax only)
        run: |
          python -m py_compile sender.py bridge.py \
            esp_libs/micropyGPS.py esp_libs/mpu6050.py \
            esp_libs/oled_diagnose.py esp_libs/ssd1306.py \
            esp_libs/calc.py
      - name: Pure-logic unit tests
        run: python -m unittest discover -s test -p "test_*.py" -v
```

- [ ] **Step 3: Validate and reproduce locally**

Run: `node -e "const s=require('fs').readFileSync('.github/workflows/check.yml','utf8');if(!/calc\.py/.test(s)||!/unittest discover/.test(s)){process.exit(1)}console.log('check.yml updated ok')"`
Expected: `check.yml updated ok`

Run: `python -m py_compile sender.py bridge.py esp_libs/micropyGPS.py esp_libs/mpu6050.py esp_libs/oled_diagnose.py esp_libs/ssd1306.py esp_libs/calc.py` (or `py -3 …`)
Expected: exit 0.

Run: `python -m unittest discover -s test -p "test_*.py" -v` (or `py -3 …`)
Expected: `Ran 6 tests` … `OK`.

Delete any `__pycache__` created; confirm `git status --short` clean (no pyc/pycache).

- [ ] **Step 4: Commit**

```bash
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" add .github/workflows/check.yml
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" commit -m "ci: compile calc.py and run Python unit tests in check workflow

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 3: A1 — fix the lost-pulse race in `RPMCounter` + expose `ppr`

**Files:**
- Modify: `sender.py` (import line; `RPMCounter.update`; add `ppr` property)

Context: in `RPMCounter.update()` the sequence `cnt = self._count` then `self._count = 0` is non-atomic — a Hall IRQ firing between them drops a pulse (RPM systematically low at high pulse rates). Wrap the read+reset in `disable_irq()/enable_irq()`. Also add a `ppr` read property (Task 4 needs it for the wheel-speed calc).

- [ ] **Step 1: Read `sender.py`** lines ~30–185 in the clone to anchor the three edits exactly (CRLF-safe — copy anchors from the Read).

- [ ] **Step 2: Extend the `machine` import**

Edit `sender.py` — replace:

```
from machine import Pin, I2C, UART, WDT, reset
```

with:

```
from machine import Pin, I2C, UART, WDT, reset, disable_irq, enable_irq
```

- [ ] **Step 3: Make the count read+reset atomic**

Edit `sender.py` — inside `RPMCounter.update`, replace exactly:

```
        cnt = self._count
        self._count = 0
        self._total_pulses += cnt
        self._last_calc_ms = now
```

with:

```
        # Atomarer Read+Reset: ein Hall-IRQ zwischen Lesen und
        # Nullsetzen wuerde sonst einen Puls verschlucken (RPM
        # systematisch zu niedrig bei hoher Pulsrate).
        _irq = disable_irq()
        cnt = self._count
        self._count = 0
        enable_irq(_irq)
        self._total_pulses += cnt
        self._last_calc_ms = now
```

- [ ] **Step 4: Add a `ppr` read property**

Edit `sender.py` — replace exactly:

```
    @property
    def pulse_hz(self):      return self._pulse_hz_raw
```

with:

```
    @property
    def pulse_hz(self):      return self._pulse_hz_raw

    @property
    def ppr(self):           return self._ppr
```

- [ ] **Step 5: Static verification**

Run: `python -m py_compile sender.py` (or `py -3 -m py_compile sender.py`)
Expected: exit 0 (compile-only; `from machine import …` does not resolve on CPython but is not imported).

Run (Grep tool) on `sender.py` for `disable_irq\(\)` → expect ≥1; for `enable_irq\(_irq\)` → expect 1; for `def ppr\(self\)` → expect 1. Confirm the critical section contains exactly the `cnt = self._count` + `self._count = 0` pair and nothing else (review the Read).

Delete any `__pycache__`; confirm git status clean of pyc.

- [ ] **Step 6: Commit**

```bash
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" add sender.py
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" commit -m "fix(sender): atomic Hall pulse read+reset; expose RPMCounter.ppr

Wrapping count read/reset in disable_irq/enable_irq prevents losing a
pulse that fires between the two statements (RPM was systematically low
at high pulse rates). ppr property added for the wheel-speed fallback.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 4: A2 — sender wheel-speed fallback + `spd_src` + `wheel_circ_m` live config

**Files:**
- Modify: `sender.py` (guarded `import calc`; speed-source logic + `spd_src` in packet; `wheel_circ_m` in `apply_config`)

Context: `Config.WHEEL_CIRC_M` already exists (default `0.0`). Activate it: GPS fix → GPS km/h; else if `WHEEL_CIRC_M > 0` → `calc.wheel_speed_kmh`; else `0.0`. Emit `spd_src` ∈ `gps|wheel|none`. Allow the dashboard to set `wheel_circ_m` live (consistent with the existing `config` packet keys).

- [ ] **Step 1: Read `sender.py`** the optional-imports block (~lines 38–55), `apply_config` (~lines 855–866), and the send block in `main()` (the `if utime.ticks_diff(now, last_send) >= send_interval:` region, ~lines 961–977). Copy anchors from the Read.

- [ ] **Step 2: Add a guarded `import calc`**

Edit `sender.py` — replace exactly:

```
try:
    from micropyGPS import MicropyGPS
    _HAS_GPS = True
except ImportError:
    _HAS_GPS = False
```

with:

```
try:
    from micropyGPS import MicropyGPS
    _HAS_GPS = True
except ImportError:
    _HAS_GPS = False

try:
    import calc
    _HAS_CALC = True
except ImportError:
    _HAS_CALC = False
```

- [ ] **Step 3: Handle `wheel_circ_m` in `apply_config`**

Edit `sender.py` — replace exactly:

```
    if "pulses_per_rev" in cfg:
        rpm_counter.set_ppr(cfg["pulses_per_rev"])
    log("config", "übernommen:", cfg)
```

with:

```
    if "pulses_per_rev" in cfg:
        rpm_counter.set_ppr(cfg["pulses_per_rev"])
    if "wheel_circ_m" in cfg:
        try:
            Config.WHEEL_CIRC_M = max(0.0, float(cfg["wheel_circ_m"]))
        except (TypeError, ValueError):
            pass
    log("config", "übernommen:", cfg)
```

- [ ] **Step 4: Pick the speed source and emit `spd_src`**

Edit `sender.py` — replace exactly:

```
            last_send = now
            speed = gps.speed_kmh
            packet = {
```

with:

```
            last_send = now
            # Geschwindigkeitsquelle: GPS-Fix hat Vorrang; sonst Rad-
            # Hochrechnung aus Hall-Pulsen (nur wenn WHEEL_CIRC_M > 0);
            # sonst 0. Die reine Logik liegt in calc.py (getestet).
            if _HAS_CALC:
                spd_src = calc.speed_source(gps.fix, Config.WHEEL_CIRC_M)
            else:
                spd_src = "gps" if gps.fix else "none"
            if spd_src == "gps":
                speed = gps.speed_kmh
            elif spd_src == "wheel" and _HAS_CALC:
                speed = calc.wheel_speed_kmh(rpm_counter.pulse_hz,
                                             rpm_counter.ppr,
                                             Config.WHEEL_CIRC_M)
            else:
                speed = 0.0
            packet = {
```

- [ ] **Step 5: Add `spd_src` to the telemetry packet**

Edit `sender.py` — replace exactly:

```
                "send_ms":  send_interval,   # Dashboard sieht degraded mode
                "imu_cal":  1 if imu.calibrating else 0,
```

with:

```
                "send_ms":  send_interval,   # Dashboard sieht degraded mode
                "spd_src":  spd_src,         # 'gps'|'wheel'|'none'
                "imu_cal":  1 if imu.calibrating else 0,
```

- [ ] **Step 6: Static verification**

Run: `python -m py_compile sender.py esp_libs/calc.py` (or `py -3 …`)
Expected: exit 0.

Run (Grep tool) on `sender.py`: `import calc` → ≥1; `_HAS_CALC` → ≥3; `calc\.speed_source` → 1; `calc\.wheel_speed_kmh` → 1; `"spd_src"` → 1; `wheel_circ_m` → 1. Visually confirm (from a fresh Read) that the speed block sits directly after `last_send = now` and before the `packet = {` dict, and `spd_src` is a packet key.

Delete any `__pycache__`; git status clean of pyc.

- [ ] **Step 7: Commit**

```bash
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" add sender.py
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" commit -m "feat(sender): wheel-speed fallback when GPS lost; emit spd_src

Activates the previously-dead Config.WHEEL_CIRC_M. GPS fix still wins;
otherwise speed is derived from Hall pulses via the tested calc module.
wheel_circ_m is now settable live from the dashboard config packet.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 5: A2 — dashboard: read `spd_src`, show source tag, add `wheel_circ_m` input

**Files:**
- Modify: `rasicross.js` (state field; parse in `processTelemetry`; tag in `updateLiveKPIs`; `_lastKpiText`; config packet)
- Modify: `RasiCross_Telemetry.html` (`#espWheelCirc` input; `#spdSrcTag` element)

- [ ] **Step 1: Read** `rasicross.js` regions: the `state` object (the `gps: { fix: false, lastAt: null },` line), `processTelemetry` (the `if (lat && lon) state.gps.lastAt = Date.now();` line), `updateLiveKPIs` (the `kSpeed` block), the `_lastKpiText` declaration, and the `espSendBtn` `cfg` object. Read `RasiCross_Telemetry.html` around the Speed KPI (`<div class="kpi-sub">Max <b id="kSpeedMax">0</b></div>`) and the ESP config fields (`id="espPulses"`). Copy anchors from these Reads.

- [ ] **Step 2: Add `spdSrc` to `state`**

Edit `rasicross.js` — replace exactly:

```
  gps: { fix: false, lastAt: null },
```

with:

```
  gps: { fix: false, lastAt: null },
  spdSrc: 'gps',
```

- [ ] **Step 3: Parse `spd_src` in `processTelemetry`**

Edit `rasicross.js` — replace exactly:

```
    if (lat && lon) state.gps.lastAt = Date.now();
```

with:

```
    if (lat && lon) state.gps.lastAt = Date.now();
    if (d.spd_src) state.spdSrc = d.spd_src;
```

- [ ] **Step 4: Add `spdSrc` to `_lastKpiText`**

Edit `rasicross.js` — replace exactly:

```
let _lastKpiText = { speed: '', rpm: '', g: '', lap: '', count: '' };
```

with:

```
let _lastKpiText = { speed: '', rpm: '', g: '', lap: '', count: '', spdSrc: '' };
```

- [ ] **Step 5: Render the source tag in `updateLiveKPIs`**

Edit `rasicross.js` — replace exactly:

```
    const speedText = _kpiDisplay.speed.toFixed(0);
    if (speedText !== _lastKpiText.speed) {
      $('kSpeed').innerHTML = `${speedText}<small>km/h</small>`;
      _lastKpiText.speed = speedText;
    }
```

with:

```
    const speedText = _kpiDisplay.speed.toFixed(0);
    if (speedText !== _lastKpiText.speed) {
      $('kSpeed').innerHTML = `${speedText}<small>km/h</small>`;
      _lastKpiText.speed = speedText;
    }
    // Geschwindigkeitsquelle-Indikator (GPS / WHL-Fallback / keine)
    const _srcMap = { gps: 'GPS', wheel: 'WHL', none: '—' };
    const _srcLabel = _srcMap[state.spdSrc] || '—';
    if (_srcLabel !== _lastKpiText.spdSrc) {
      const _srcEl = $('spdSrcTag');
      if (_srcEl) {
        _srcEl.textContent = _srcLabel;
        _srcEl.style.color = state.spdSrc === 'wheel' ? '#e8a13a'
                           : (state.spdSrc === 'none' || !state.spdSrc) ? 'var(--mut)'
                           : '';
      }
      _lastKpiText.spdSrc = _srcLabel;
    }
```

- [ ] **Step 6: Add `wheel_circ_m` to the config packet**

Edit `rasicross.js` — replace exactly:

```
      send_ms: Number($('espSendMs').value) || 80,
      pulses_per_rev: Number($('espPulses').value) || 1
    };
```

with:

```
      send_ms: Number($('espSendMs').value) || 80,
      pulses_per_rev: Number($('espPulses').value) || 1,
      wheel_circ_m: Number($('espWheelCirc').value) || 0
    };
```

- [ ] **Step 7: Add the `Radumfang` input (HTML)**

Edit `RasiCross_Telemetry.html` — replace exactly:

```
        <div class="field"><label>Pulses per Revolution</label><input type="number" id="espPulses" value="1" min="1" max="32"></div>
```

with:

```
        <div class="field"><label>Pulses per Revolution</label><input type="number" id="espPulses" value="1" min="1" max="32"></div>
        <div class="field"><label>Radumfang m (0 = nur GPS)</label><input type="number" id="espWheelCirc" value="0" min="0" step="0.001"></div>
```

- [ ] **Step 8: Add the source tag element under the Speed KPI (HTML)**

Edit `RasiCross_Telemetry.html` — replace exactly:

```
      <div class="kpi-sub">Max <b id="kSpeedMax">0</b></div>
```

with:

```
      <div class="kpi-sub">Max <b id="kSpeedMax">0</b> · Quelle <b id="spdSrcTag">GPS</b></div>
```

- [ ] **Step 9: Verify (regression + syntax)**

Run: `node --check rasicross.js` → exit 0.
Run: `node --test` (no path) → `tests 10 | pass 10 | fail 0` (geo.js suite unaffected — confirms no JS breakage).
Run (Grep tool) `rasicross.js`: `spdSrc` → ≥4 matches; `espWheelCirc` → 1. `RasiCross_Telemetry.html`: `id="espWheelCirc"` → 1; `id="spdSrcTag"` → 1.

Manual smoke (record in commit, do not block on it here — full check is the Phase-6/handoff manual item): if convenient, open `RasiCross_Telemetry.html` in a Chromium browser, click Demo; the Speed KPI shows `Quelle GPS` (demo packets have `gps_fix:1`); no console errors. (Demo does not exercise `wheel`/`none`; that is covered by the hardware checklist.)

- [ ] **Step 10: Commit**

```bash
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" add rasicross.js RasiCross_Telemetry.html
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" commit -m "feat(dashboard): show speed-source tag; add wheel_circ_m config input

Reads the new optional spd_src field (GPS/WHL/—) next to the Speed KPI
and lets the user set the wheel circumference live. Backward-compatible:
absent spd_src keeps the last value; old firmware unaffected.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 6: Phase verification, plan commit & push

**Files:** none (verification + push); commits the Phase 2 plan doc.

- [ ] **Step 1: Full local CI dry-run** (from clone root; use `py -3` if `python` absent):
```
node --check geo.js
node --check rasicross.js
node --check main.js
node --check preload.js
npm test
python -m py_compile sender.py bridge.py esp_libs/micropyGPS.py esp_libs/mpu6050.py esp_libs/oled_diagnose.py esp_libs/ssd1306.py esp_libs/calc.py
python -m unittest discover -s test -p "test_*.py" -v
```
Expected: all exit 0; `npm test` = `tests 10 | pass 10 | fail 0`; unittest `Ran 6 tests` `OK`.
Then delete any `__pycache__`; confirm `git status --short` shows no pyc/pycache (only the untracked plan doc until Step 3).

- [ ] **Step 2: Backward-compat invariant spot-check**
Grep `rasicross.js` confirm `if (d.spd_src) state.spdSrc = d.spd_src;` — value only updates when present (absent ⇒ keeps last; old firmware safe). Grep `sender.py` confirm `spd_src` is additive (no field removed/renamed: `"speed"`, `"rpm"`, `"gps_health"`, `"send_ms"`, `"imu_cal"` all still present in the packet dict).

- [ ] **Step 3: Commit the plan document**
```bash
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" add docs/superpowers/plans/2026-05-17-02-rpm-fix-wheel-speed.md
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" commit -m "docs: phase 2 implementation plan (RPM fix + wheel-speed fallback)

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

- [ ] **Step 4: Push**
```bash
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" push
```
Credentials cached this session — should be silent. If it hangs >30s on auth, report BLOCKED (do not loop).

- [ ] **Step 5: Deferred to controller/user (do NOT attempt):** GitHub Actions `check` confirmation (no `gh` CLI) and the hardware acceptance checklist below. Note them as pending in the report.

---

## Hardware Acceptance Checklist (user-run, real ESP32 — not runtime-testable here)

Flash `esp_libs/calc.py` to the kart ESP root alongside the other libs (`mpremote connect <port> cp esp_libs/calc.py :`) and re-flash `sender.py` as `main.py`. Then verify:

1. **Regression:** with GPS fix, speed/rpm/gx/gy unchanged vs. before; dashboard Speed KPI shows `Quelle GPS`.
2. **A1:** at sustained high RPM, the reading is stable and not under-reporting vs. expected (no systematic low bias).
3. **A2 fallback:** set a real `Radumfang` (e.g. measured wheel circumference in m) via the dashboard config → "An ESP32 senden". Block/lose GPS fix (cover antenna): speed continues from the wheel; dashboard tag flips `GPS → WHL`; on full stop with no GPS, speed → 0 and tag stays `WHL`. With `Radumfang = 0` and no GPS, speed = 0 and tag shows `—`.
4. **Live config:** changing `Radumfang` and re-sending takes effect without re-flashing.
5. **Byte budget:** logged worst-case `len(payload)` still < 250 B (one new short string field added).

---

## Self-Review

**1. Spec coverage:**
- §5 A1 (IRQ critical section + import + `ppr`) → Task 3. ✅
- §5 A2 (speed-source priority; `spd_src`; `wheel_circ_m` in `apply_config` + dashboard input; source indicator; activates `WHEEL_CIRC_M`) → Tasks 1 (math), 4 (sender), 5 (dashboard). ✅
- §6 data table (`spd_src` string, every packet, additive) → Task 4 Step 5; backward-compat → Task 5 Step 3 / Task 6 Step 2. ✅
- §7 (ESP code compile-checked + hardware-verified; pure math unit-tested; JS verified locally) → Tasks 1–2 (unittest+CI), 3–4 (py_compile + checklist), 5 (node --check + node --test + smoke). ✅
- Phase-1 Phase-Map item "pure esp_libs/calc.py + Python unit tests, spd_src + dashboard indicator" → fully covered. ✅

**2. Placeholder scan:** No TBD/TODO; every code step has complete code; every command has expected output. ✅

**3. Type/name consistency:** `wheel_speed_kmh(pulse_hz, ppr, circ_m)` and `speed_source(gps_fix, wheel_circ_m)` — identical signatures in `calc.py`, `test_calc.py`, and `sender.py` call sites. `spd_src` (snake, wire/JSON + `sender.py`) vs `state.spdSrc`/`#spdSrcTag`/`_lastKpiText.spdSrc` (camel, JS/DOM) used consistently per side. `RPMCounter.ppr` defined Task 3, consumed Task 4. `wheel_circ_m` key consistent across `apply_config`, dashboard `cfg`, `#espWheelCirc`. CI test command `python -m unittest discover -s test -p "test_*.py"` identical in Tasks 1, 2, 6 and `check.yml`. ✅

**4. Notes:** `node --test` (no path) is the portable form established in Phase 1. The `geo.test.js` baseline is **`tests 10 | pass 10`** (verified on this branch) — Phase 1's review follow-ups added assertions *inside* existing `test()` blocks, so the block count stays 10; Phase 2 adds no JS test blocks. The Python `unittest discover` pattern `test_*.py` matches `test/test_calc.py` and excludes `test/geo.test.js` (JS).

---

## Phase Map

Phase **2 of 6**. Next: Phase 3 = A5 (CSP + de-inline 7 handlers) — must use the corrected CSP that allows `https://fonts.googleapis.com` (style), `https://fonts.gstatic.com` (font), `img-src 'self' data:` for `assets/icon.svg` (recorded in the Phase-1 plan's carried-forward note). Then Phase 4 = A3 battery (extends `esp_libs/calc.py` + `test_calc.py`), Phase 5 = A4 IMU, Phase 6 = C1 recording/replay.
