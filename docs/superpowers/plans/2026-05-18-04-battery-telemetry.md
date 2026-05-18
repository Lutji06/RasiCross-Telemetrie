# Phase 4 — A3: Battery Telemetry (LiPo/Li-ion) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add optional pack-voltage / per-cell / state-of-charge / low-battery-warning telemetry sourced from an ESP32 ADC, with the battery math pure-tested in `calc.py`, slow-cadence transmission, a dashboard readout with colour states + a debounced toast/audio cue, and a kart-OLED `BAT` line.

**Architecture:** The voltage→SoC/warn math is added to the dependency-free `esp_libs/calc.py` (CPython-unit-tested, MicroPython-safe), reused by a new inert-by-default `Battery` class in `sender.py`. A new `Config.SLOW_FIELD_EVERY` packet-cadence counter sends `vbat`/`soc` every Nth packet while `batt_warn` rides every packet. The dashboard parses the three optional fields (keeping last value when a slow field is absent), shows a 5th KPI block (hidden until battery data arrives) with normal/amber/red states, and fires the existing `rcToast` + a new `rcAudio` cue once per upward warn transition. `BATT_ADC_PIN is None` (default) ⇒ the whole feature is inert and no fields are emitted (full backward-compat).

**Tech Stack:** MicroPython (`sender.py` `machine.ADC`, `esp_libs/calc.py`), CPython 3 stdlib `unittest` (tests, zero new deps), vanilla DOM + WebAudio (`rasicross.js`), GitHub Actions.

---

## Working Directory & Conventions

**All work happens in the git clone:** `C:/Users/jimlu/Documents/RasiCross-Telemetrie-git` (branch `docs/telemetry-improvements-spec`, Phases 1–3 already committed/pushed).

- Paths relative to clone root unless absolute. Files use **CRLF**; always `Read` the target region in-session immediately before an `Edit` and copy the `old_string` anchor from that fresh Read (strip the line-number/tab prefix). Line numbers below are indicative — anchor on the text.
- Git: `git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" …`. Use the Grep tool (not shell grep) for verification greps. There is an untracked `.claude/` directory and untracked plan docs — **never** `git add` them; use explicit `git add <path>` of only the named files.
- Windows: Python may be `python` or `py -3` — try `python` first, fall back to `py -3`. Node v24 local; CI Node 20 / Python 3.12.
- **Spec:** `docs/superpowers/specs/2026-05-17-rasicross-telemetry-improvements-design.md` §4 (byte budget / slow cadence), §5 A3, §6 (data table), §7.
- **ESP code reality:** `sender.py` cannot be runtime-tested here (no ESP32, no battery, no OLED). All battery *math* is in `calc.py` and IS unit-tested under CPython. `sender.py`/OLED edits are conservative, additive, statically reviewed, and **hardware-verified by the user** via the checklist at the end (consistent with the A1/A2 precedent). JS is verified with `node --check` + `node --test` (regression; no new JS test blocks — DOM/WebAudio wiring is not unit-tested in this project, consistent with Phases 2–3) + a deferred manual smoke.

**Behavioural invariant:** With `BATT_ADC_PIN = None` (the shipped default) the `Battery` class is inert: it touches no ADC, and `sender.py` emits **no** `vbat`/`soc`/`batt_warn` keys — the telemetry packet and OLED are byte-for-byte unchanged vs. Phase 3 (old dashboards/firmware unaffected). All new fields are additive; the dashboard tolerates their absence (readout hidden) and tolerates a slow field being absent on a given packet (keeps the last value). No existing field renamed/removed.

**Locked decisions (derived from spec + established codebase patterns):**
1. **Pure math in `calc.py`** — `battery_pack_v`, `battery_cell_v`, `battery_soc`, `battery_warn` (Phase-4 Phase-Map item "extends `esp_libs/calc.py` + `test_calc.py`").
2. **Canonical SoC curve** = the spec's example points, treated as definitive: `vcell→%` `(3.30,0) (3.50,15) (3.70,35) (3.85,60) (4.20,100)`, piecewise-linear between, clamped to `[0,100]`, returned as `int`.
3. **Dashboard cell count** via a new `espBattCells` input sent as `batt_cells` in the existing config packet → `apply_config` sets `Config.BATT_CELLS`; the dashboard uses the same value for the computed per-cell readout (one source of truth; mirrors the `wheel_circ_m`/`pulses_per_rev` live-config pattern). Default `3`.
4. **Slow-field cadence** = new `Config.SLOW_FIELD_EVERY = 8` + a per-send packet counter; `vbat`/`soc` only every Nth packet, `batt_warn` every packet.
5. **`calc.py` is a required ESP lib** (already true since Phase 2). If `_HAS_CALC` is False the `Battery` class is inert (same effect as `BATT_ADC_PIN None`) — no separate non-calc fallback (YAGNI).
6. **OLED**: condense the `GPS`/`TX` diag rows into one line to free a row for `BAT 11.8V` (shown only when battery data is present).
7. **Dashboard UI**: a 5th `.kpi` block after "Aktuelle Runde", `class="kpi hidden"` until the first battery field arrives; SoC% as the big value, `pack V` + computed `cell V` in the sub-line; amber when `batt_warn==1`, red when `==2` (colour set in JS like the Phase-2 `spdSrcTag`).

---

## File Structure

| Action | Path | Responsibility |
|--------|------|----------------|
| Modify | `esp_libs/calc.py` | Add 4 pure functions: `battery_pack_v`, `battery_cell_v`, `battery_soc`, `battery_warn`. No imports; CPython+MicroPython safe. |
| Modify | `test/test_calc.py` | Add `unittest` coverage for the 4 new functions (curve points, interpolation, clamping, bad/neg inputs). |
| Modify | `.github/workflows/check.yml` | No change needed (already compiles `calc.py` + runs `unittest discover`). *(Listed for clarity — do NOT edit.)* |
| Modify | `sender.py` | `Config` battery keys + `SLOW_FIELD_EVERY`; `ADC` import; new inert-by-default `Battery` class; instantiate in `main()`; slow-field packet counter; emit `batt_warn`(every)/`vbat`,`soc`(slow); payload-size log; `apply_config` `batt_cells`; OLED `page_diag` `BAT` line. |
| Modify | `rasicross.js` | `state.batt`; parse `vbat`/`soc`/`batt_warn` in `processTelemetry` (keep-last for slow); debounced once-per-upward-transition `rcToast` + new `rcAudio.battWarn/battCrit`; battery KPI render (value/sub/colour/show); `batt_cells` in config packet + `state.batt.cells`. |
| Modify | `RasiCross_Telemetry.html` | 5th `.kpi` battery block (`id="kpiBatt" class="kpi hidden"`); `#espBattCells` config input. |

**Task order (each commit independently sound):** T1 calc math+tests → T2 sender Config+Battery class → T3 sender wiring (packet/cadence/OLED/apply_config) → T4 dashboard → T5 phase verify/commit/push.

---

### Task 1: Pure battery math in `calc.py` + unit tests (TDD)

**Files:**
- Modify: `esp_libs/calc.py` (append 4 functions)
- Modify: `test/test_calc.py` (append test classes)

- [ ] **Step 1: Read** `esp_libs/calc.py` (whole file — it is short) and `test/test_calc.py` (whole file) to anchor the appends exactly. Note `test_calc.py` ends with:
```
if __name__ == '__main__':
    unittest.main()
```
and `calc.py` ends with the `speed_source` function (last line is `    return 'none'`).

- [ ] **Step 2: Write the failing tests** — Edit `test/test_calc.py`, replace exactly:

```
if __name__ == '__main__':
    unittest.main()
```

with:

```
class BatteryPackV(unittest.TestCase):
    def test_normal(self):
        self.assertAlmostEqual(calc.battery_pack_v(1.0, 11.0, 1.0), 11.0, places=6)
        self.assertAlmostEqual(calc.battery_pack_v(0.30, 11.0, 1.05),
                               0.30 * 11.0 * 1.05, places=6)

    def test_zero_input_is_zero(self):
        self.assertEqual(calc.battery_pack_v(0.0, 11.0, 1.0), 0.0)

    def test_zero_for_bad_or_negative(self):
        self.assertEqual(calc.battery_pack_v(-1.0, 11.0, 1.0), 0.0)
        self.assertEqual(calc.battery_pack_v(1.0, 0.0, 1.0), 0.0)
        self.assertEqual(calc.battery_pack_v(1.0, 11.0, 0.0), 0.0)
        self.assertEqual(calc.battery_pack_v(None, 11.0, 1.0), 0.0)
        self.assertEqual(calc.battery_pack_v('x', 11.0, 1.0), 0.0)
        self.assertEqual(calc.battery_pack_v(float('nan'), 11.0, 1.0), 0.0)


class BatteryCellV(unittest.TestCase):
    def test_normal(self):
        self.assertAlmostEqual(calc.battery_cell_v(12.6, 3), 4.2, places=6)
        self.assertAlmostEqual(calc.battery_cell_v(11.1, 3), 3.7, places=6)

    def test_zero_for_bad(self):
        self.assertEqual(calc.battery_cell_v(12.0, 0), 0.0)
        self.assertEqual(calc.battery_cell_v(12.0, -1), 0.0)
        self.assertEqual(calc.battery_cell_v(None, 3), 0.0)
        self.assertEqual(calc.battery_cell_v(12.0, None), 0.0)
        self.assertEqual(calc.battery_cell_v(float('nan'), 3), 0.0)


class BatterySoc(unittest.TestCase):
    def test_curve_points(self):
        self.assertEqual(calc.battery_soc(4.20), 100)
        self.assertEqual(calc.battery_soc(3.85), 60)
        self.assertEqual(calc.battery_soc(3.70), 35)
        self.assertEqual(calc.battery_soc(3.50), 15)
        self.assertEqual(calc.battery_soc(3.30), 0)

    def test_clamped(self):
        self.assertEqual(calc.battery_soc(4.30), 100)
        self.assertEqual(calc.battery_soc(5.00), 100)
        self.assertEqual(calc.battery_soc(3.20), 0)
        self.assertEqual(calc.battery_soc(0.0), 0)

    def test_linear_interpolation(self):
        # midpoint of 3.85->60 .. 4.20->100  => 80
        self.assertEqual(calc.battery_soc(4.025), 80)
        # midpoint of 3.50->15 .. 3.70->35   => 25
        self.assertEqual(calc.battery_soc(3.60), 25)

    def test_zero_for_bad(self):
        self.assertEqual(calc.battery_soc(None), 0)
        self.assertEqual(calc.battery_soc('x'), 0)
        self.assertEqual(calc.battery_soc(float('nan')), 0)


class BatteryWarn(unittest.TestCase):
    def test_levels(self):
        self.assertEqual(calc.battery_warn(3.80, 3.5, 3.3), 0)
        self.assertEqual(calc.battery_warn(3.50, 3.5, 3.3), 1)  # <= warn
        self.assertEqual(calc.battery_warn(3.40, 3.5, 3.3), 1)
        self.assertEqual(calc.battery_warn(3.30, 3.5, 3.3), 2)  # <= crit
        self.assertEqual(calc.battery_warn(3.10, 3.5, 3.3), 2)

    def test_zero_for_bad(self):
        self.assertEqual(calc.battery_warn(None, 3.5, 3.3), 0)
        self.assertEqual(calc.battery_warn('x', 3.5, 3.3), 0)
        self.assertEqual(calc.battery_warn(float('nan'), 3.5, 3.3), 0)


if __name__ == '__main__':
    unittest.main()
```

- [ ] **Step 3: Run tests to verify they fail**

Run (clone root): `python -m unittest discover -s test -p "test_*.py" -v` (or `py -3 …`).
Expected: FAIL — `AttributeError: module 'calc' has no attribute 'battery_pack_v'` (and the other three).

- [ ] **Step 4: Implement** — Edit `esp_libs/calc.py`, replace exactly:

```
    if gps_fix:
        return 'gps'
    try:
        if float(wheel_circ_m) > 0.0:
            return 'wheel'
    except (TypeError, ValueError):
        pass
    return 'none'
```

with:

```
    if gps_fix:
        return 'gps'
    try:
        if float(wheel_circ_m) > 0.0:
            return 'wheel'
    except (TypeError, ValueError):
        pass
    return 'none'


# ---- Batterie (LiPo/Li-ion) ------------------------------------------------
# Reine Mathematik fuer die A3-Batterietelemetrie. Die ADC-Rohwerte
# liest sender.py auf dem ESP32; hier nur die testbare Umrechnung.

# SoC-Stuetzpunkte (Zellspannung V -> Ladezustand %), aufsteigend.
_SOC_CURVE = ((3.30, 0.0), (3.50, 15.0), (3.70, 35.0),
              (3.85, 60.0), (4.20, 100.0))


def battery_pack_v(adc_volts, divider, cal):
    """Packspannung = ADC-Spannung * Teiler * Feinkalibrierung.

    Liefert 0.0 bei nicht-positiven (Teiler/cal) oder negativen/
    nicht-numerischen Eingaben. adc_volts == 0.0 -> 0.0 (kein Akku).
    """
    try:
        adc_volts = float(adc_volts)
        divider = float(divider)
        cal = float(cal)
    except (TypeError, ValueError):
        return 0.0
    if not (adc_volts >= 0.0) or not (divider > 0.0) or not (cal > 0.0):
        return 0.0  # NaN-Vergleiche sind immer False -> ebenfalls 0.0
    return adc_volts * divider * cal


def battery_cell_v(vbat, cells):
    """Spannung pro Zelle = Packspannung / Zellenzahl (>= 1).

    Liefert 0.0 bei ungueltiger Zellenzahl oder nicht-numerischen
    Eingaben.
    """
    try:
        vbat = float(vbat)
        cells = int(cells)
    except (TypeError, ValueError):
        return 0.0
    if cells < 1 or not (vbat >= 0.0):
        return 0.0
    return vbat / cells


def battery_soc(vcell):
    """Ladezustand 0..100 (int) aus der Zellspannung.

    Stueckweise lineare Interpolation auf _SOC_CURVE, ausserhalb
    geklemmt. Liefert 0 bei nicht-numerischen Eingaben.
    """
    try:
        v = float(vcell)
    except (TypeError, ValueError):
        return 0
    if not (v == v):          # NaN
        return 0
    if v <= _SOC_CURVE[0][0]:
        return 0
    if v >= _SOC_CURVE[-1][0]:
        return 100
    for i in range(1, len(_SOC_CURVE)):
        v0, p0 = _SOC_CURVE[i - 1]
        v1, p1 = _SOC_CURVE[i]
        if v <= v1:
            t = (v - v0) / (v1 - v0)
            return int(round(p0 + t * (p1 - p0)))
    return 100


def battery_warn(vcell, warn_v, crit_v):
    """0 = ok, 1 = Warnung (vcell <= warn_v), 2 = kritisch
    (vcell <= crit_v). crit_v sollte <= warn_v sein.

    Liefert 0 bei nicht-numerischen Eingaben (kein Fehlalarm).
    """
    try:
        v = float(vcell)
        w = float(warn_v)
        c = float(crit_v)
    except (TypeError, ValueError):
        return 0
    if not (v == v):          # NaN
        return 0
    if v <= c:
        return 2
    if v <= w:
        return 1
    return 0
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `python -m unittest discover -s test -p "test_*.py" -v` (or `py -3 …`).
Expected: PASS — `OK`, with the new `BatteryPackV`/`BatteryCellV`/`BatterySoc`/`BatteryWarn` cases plus the existing `WheelSpeedKmh`/`SpeedSource`. The **total test count rises from 6 to 17** (4 new classes adding 3+2+4+2 = 11 test methods; 6 + 11 = 17 → `Ran 17 tests`). Record the exact `Ran N tests` line.

- [ ] **Step 6: Byte-compile check (MicroPython-safety proxy)**

Run: `python -m py_compile esp_libs/calc.py` (or `py -3 …`). Expected: exit 0.
Delete any `__pycache__` (Bash: `find . -name __pycache__ -type d -prune -exec rm -rf {} + 2>/dev/null`). Confirm `git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" status --short` shows only `esp_libs/calc.py` + `test/test_calc.py` modified (untracked `.claude/`/plan docs expected).

- [ ] **Step 7: Commit**

```bash
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" add esp_libs/calc.py test/test_calc.py
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" commit -m "feat(calc): pure battery math (pack_v/cell_v/soc/warn) + unit tests

Piecewise-linear LiPo SoC curve, per-cell + warn thresholds. Import-free
so it runs on CPython (CI/tests) and MicroPython (kart). stdlib unittest.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 2: `sender.py` — battery `Config` + `SLOW_FIELD_EVERY` + inert `Battery` class

**Files:**
- Modify: `sender.py` (`Config` keys; `machine` import adds `ADC`; new `Battery` class)

Context: define config + the class only. With `BATT_ADC_PIN = None` (default) the class is inert. No wiring into `main()`/packet yet (that is Task 3) — after this task `sender.py` still behaves exactly as Phase 3 (py_compiles, nothing instantiated).

- [ ] **Step 1: Read** `sender.py` lines ~33–60 (the `from machine import …` line + the optional-imports block) and ~88–92 (the `# Hall-Sensor` Config block) and ~125–185 (end of `RPMCounter`, to place `Battery` right after it). Copy anchors from the Read.

- [ ] **Step 2: Add `ADC` to the `machine` import**

Edit `sender.py` — replace exactly:

```
from machine import Pin, I2C, UART, WDT, reset, disable_irq, enable_irq
```

with:

```
from machine import Pin, I2C, UART, WDT, reset, disable_irq, enable_irq, ADC
```

> If the fresh Read shows a different exact import list, anchor on what it shows and append `, ADC` once at the end (do not duplicate any existing name).

- [ ] **Step 3: Add the battery `Config` block + `SLOW_FIELD_EVERY`**

Edit `sender.py` — replace exactly:

```
    # Hall-Sensor
    PULSES_PER_REV  = 1          # Pulse pro Radumdrehung
    WHEEL_CIRC_M    = 0.0        # Radumfang in Meter (0 = GPS-Speed nutzen)
```

with:

```
    # Hall-Sensor
    PULSES_PER_REV  = 1          # Pulse pro Radumdrehung
    WHEEL_CIRC_M    = 0.0        # Radumfang in Meter (0 = GPS-Speed nutzen)

    # Batterie (A3) — None = Feature aus. NUR ADC1-Pins (GPIO 32-39);
    # ADC2 ist bei aktivem WiFi/ESP-NOW gesperrt!
    BATT_ADC_PIN    = None       # z.B. 34. None -> Battery-Klasse inert
    BATT_DIVIDER    = 11.0       # externer Teiler Vin/Vadc (z.B. 100k/10k)
    BATT_CELLS      = 3          # Zellen in Serie (Per-Cell + SoC)
    BATT_CAL        = 1.0        # Feinkalibrierung (Multiplikator)
    BATT_CELL_WARN  = 3.5        # Warn-Schwelle pro Zelle (V)
    BATT_CELL_CRIT  = 3.3        # Kritisch-Schwelle pro Zelle (V)

    # Langsame Felder (vbat/soc/...) nur jedes N-te Paket senden
    SLOW_FIELD_EVERY = 8         # ~1 Hz bei 12.5 Hz Basisrate
```

- [ ] **Step 4: Add the `Battery` class after `RPMCounter`**

Edit `sender.py` — replace exactly (the `RPMCounter` `total_pulses` property and the section banner that follows):

```
    @property
    def total_pulses(self):  return self._total_pulses


# ── IMU (MPU-6050) ────────────────────────────────────────────────────────
```

with:

```
    @property
    def total_pulses(self):  return self._total_pulses


# ── Batterie (A3) ─────────────────────────────────────────────────────────

class Battery:
    """Optionale Akku-Telemetrie ueber einen ADC1-Pin.

    Inert, wenn Config.BATT_ADC_PIN None ist ODER calc.py fehlt:
    .active == False, alle Werte 0/None, sender.py sendet dann keine
    Batteriefelder. Die reine Umrechnung liegt in calc.py (getestet);
    diese Klasse macht nur ADC-IO + Mittelung.
    """

    _SAMPLES = 16

    def __init__(self):
        self._adc = None
        self._vbat = 0.0
        self._soc = 0
        self._warn = 0
        pin = Config.BATT_ADC_PIN
        if pin is None or not _HAS_CALC:
            return
        try:
            self._adc = ADC(Pin(pin))
            # 11 dB Daempfung -> ~0..3.3 V nutzbar
            self._adc.atten(ADC.ATTN_11DB)
        except Exception as e:               # noqa: BLE001
            log("init", "Battery ADC init fehlgeschlagen:", e)
            self._adc = None

    @property
    def active(self):
        return self._adc is not None

    def read(self):
        """Misst und aktualisiert vbat/soc/warn. No-op wenn inert."""
        if self._adc is None:
            return
        acc = 0
        for _ in range(self._SAMPLES):
            acc += self._adc.read_uv()       # kalibrierte Mikrovolt
        adc_volts = (acc / self._SAMPLES) / 1_000_000.0
        self._vbat = calc.battery_pack_v(adc_volts,
                                         Config.BATT_DIVIDER,
                                         Config.BATT_CAL)
        vcell = calc.battery_cell_v(self._vbat, Config.BATT_CELLS)
        self._soc = calc.battery_soc(vcell)
        self._warn = calc.battery_warn(vcell,
                                       Config.BATT_CELL_WARN,
                                       Config.BATT_CELL_CRIT)

    @property
    def vbat(self):   return self._vbat

    @property
    def soc(self):    return self._soc

    @property
    def warn(self):   return self._warn


# ── IMU (MPU-6050) ────────────────────────────────────────────────────────
```

- [ ] **Step 5: Static verification**

Run: `python -m py_compile sender.py esp_libs/calc.py` (or `py -3 …`). Expected: exit 0 (`from machine import …`/`ADC` do not resolve on CPython but are not imported at compile time).
Run (Grep tool) on `sender.py`: `, ADC$|, ADC,| ADC\b` near the machine import → `ADC` present once in the import; `class Battery:` → 1; `BATT_ADC_PIN` → ≥2 (Config def + class use); `def read\(self\)` → 1; `_HAS_CALC` still present (now also referenced in `Battery.__init__`).
Delete any `__pycache__`; confirm `git status --short` shows only `sender.py` modified, no pyc.

- [ ] **Step 6: Commit**

```bash
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" add sender.py
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" commit -m "feat(sender): battery Config + inert-by-default Battery class

ADC1-only battery sense (16-sample avg), math delegated to calc.py.
BATT_ADC_PIN None (default) or missing calc -> class inert, zero
behaviour change. SLOW_FIELD_EVERY added for cadence (used next).

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 3: `sender.py` — instantiate, slow-cadence packet fields, payload log, OLED, `apply_config`

**Files:**
- Modify: `sender.py` (`main()` instantiate + counter; packet emit; payload-size log; `display.update` ctx; `page_diag`; `apply_config`)

Context: `Battery` is wired in. When `battery.active` is False (default `BATT_ADC_PIN None`), **no** battery keys are emitted and the OLED line is skipped — packet/OLED identical to Phase 3. `batt_warn` rides every packet (latency-sensitive); `vbat`/`soc` only on slow packets (`pkt_count % Config.SLOW_FIELD_EVERY == 0`).

- [ ] **Step 1: Read** `sender.py`: the `main()` sensor-instantiation block (the `link        = ESPNowLink(Config.BRIDGE_MAC)` line + the "Lokaler Zustand" lines `last_send = utime.ticks_ms()` / `race_data = None`), the send block (`last_send = now` … the `packet = { … }` dict … `"spd_src":  spd_src,` / `"imu_cal":  …` … `tx_ok = link.send(packet)` … the `display.update({ … })` ctx), `page_diag` (the 4 `o.text(...)` lines), and `apply_config` (the `wheel_circ_m` block + `log("config", …)`). Copy each anchor from the Read.

- [ ] **Step 2: Instantiate `Battery` + add the slow-field counter in `main()`**

Edit `sender.py` — replace exactly:

```
    link        = ESPNowLink(Config.BRIDGE_MAC)
```

with:

```
    link        = ESPNowLink(Config.BRIDGE_MAC)
    battery     = Battery()
```

Then replace exactly:

```
    # Lokaler Zustand
    last_send = utime.ticks_ms()
    race_data = None
```

with:

```
    # Lokaler Zustand
    last_send = utime.ticks_ms()
    race_data = None
    pkt_count = 0                 # zaehlt gesendete Pakete (Slow-Field-Kadenz)
```

- [ ] **Step 3: Read the battery + decide slow cadence, just before the packet dict**

Edit `sender.py` — replace exactly:

```
            else:
                speed = 0.0
            packet = {
```

with:

```
            else:
                speed = 0.0
            # Batterie messen + Slow-Field-Kadenz (vbat/soc nur jedes
            # SLOW_FIELD_EVERY-te Paket; batt_warn jedes Paket).
            pkt_count += 1
            slow = (pkt_count % Config.SLOW_FIELD_EVERY == 0)
            if battery.active:
                battery.read()
            packet = {
```

- [ ] **Step 4: Emit `batt_warn` every packet (when active)**

Edit `sender.py` — replace exactly:

```
                "spd_src":  spd_src,         # 'gps'|'wheel'|'none'
                "imu_cal":  1 if imu.calibrating else 0,
            }
```

with:

```
                "spd_src":  spd_src,         # 'gps'|'wheel'|'none'
                "imu_cal":  1 if imu.calibrating else 0,
            }
            if battery.active:
                packet["batt_warn"] = battery.warn          # 0|1|2, jedes Paket
                if slow:
                    packet["vbat"] = round(battery.vbat, 2)  # Pack-V, langsam
                    packet["soc"]  = battery.soc             # 0..100, langsam
```

- [ ] **Step 5: Log the serialized payload size (spec §4 measurement step)**

Edit `sender.py` — replace exactly:

```
            tx_ok = link.send(packet)
```

with:

```
            if slow:
                # Byte-Budget-Kontrolle (< 250 B, siehe Spec §4). Nur
                # bei DEBUG/Topic 'link' sichtbar -> kein Funk-Overhead.
                log("link", "payload bytes:", len(ujson.dumps(packet)))
            tx_ok = link.send(packet)
```

- [ ] **Step 6: Pass battery pack-V into the OLED context**

Edit `sender.py` — replace exactly:

```
                "tx_ok":     tx_ok,
                "race_data": race_data,
                "display":   display,
            })
```

with:

```
                "tx_ok":     tx_ok,
                "race_data": race_data,
                "display":   display,
                "vbat":      battery.vbat if battery.active else None,
            })
```

- [ ] **Step 7: OLED `page_diag` — condense GPS/TX, add `BAT`**

Edit `sender.py` — replace exactly:

```
def page_diag(o, ctx):
    """Seite 5: Diagnose - GPS / TX / Speed / RPM."""
    o.text("GPS " + ("OK" if ctx.get("gps_fix") else "--"), 0, 16, 1)
    o.text("TX  " + ("OK" if ctx.get("tx_ok") else "--"), 0, 28, 1)
    o.text("SPD {:5.1f}".format(ctx.get("speed", 0)), 0, 40, 1)
    o.text("RPM {:5d}".format(int(ctx.get("rpm", 0))), 0, 52, 1)
```

with:

```
def page_diag(o, ctx):
    """Seite 5: Diagnose - GPS/TX (1 Zeile) / SPD / RPM / BAT."""
    g = "OK" if ctx.get("gps_fix") else "--"
    t = "OK" if ctx.get("tx_ok") else "--"
    o.text("GPS {}  TX {}".format(g, t), 0, 16, 1)
    o.text("SPD {:5.1f}".format(ctx.get("speed", 0)), 0, 28, 1)
    o.text("RPM {:5d}".format(int(ctx.get("rpm", 0))), 0, 40, 1)
    vbat = ctx.get("vbat")
    if vbat is not None:
        o.text("BAT {:4.1f}V".format(vbat), 0, 52, 1)
```

- [ ] **Step 8: `apply_config` — live `batt_cells`**

Edit `sender.py` — replace exactly:

```
    if "wheel_circ_m" in cfg:
        try:
            Config.WHEEL_CIRC_M = max(0.0, float(cfg["wheel_circ_m"]))
        except (TypeError, ValueError):
            pass
    log("config", "übernommen:", cfg)
```

with:

```
    if "wheel_circ_m" in cfg:
        try:
            Config.WHEEL_CIRC_M = max(0.0, float(cfg["wheel_circ_m"]))
        except (TypeError, ValueError):
            pass
    if "batt_cells" in cfg:
        try:
            Config.BATT_CELLS = max(1, int(cfg["batt_cells"]))
        except (TypeError, ValueError):
            pass
    log("config", "übernommen:", cfg)
```

- [ ] **Step 9: Static verification**

Run: `python -m py_compile sender.py esp_libs/calc.py` (or `py -3 …`). Expected: exit 0.
Run (Grep tool) on `sender.py`: `battery     = Battery\(\)` → 1; `pkt_count` → ≥3 (init, increment, modulo); `battery\.active` → ≥3; `"batt_warn"` → 1; `packet\["vbat"\]` → 1; `packet\["soc"\]` → 1; `payload bytes:` → 1; `batt_cells` → 1; `BAT {:4.1f}V` → 1. Visually confirm (fresh Read) the slow-field block sits after `speed = 0.0`/before `packet = {`, `batt_warn` is added after the packet dict literal, and `page_diag` now has the condensed GPS/TX line + conditional BAT.
Delete any `__pycache__`; `git status --short` shows only `sender.py` modified, no pyc.

- [ ] **Step 10: Commit**

```bash
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" add sender.py
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" commit -m "feat(sender): emit battery telemetry (batt_warn every, vbat/soc slow)

SLOW_FIELD_EVERY cadence counter; batt_warn rides every packet,
vbat/soc every Nth. OLED diag condenses GPS/TX to one row, adds BAT
when present. apply_config accepts live batt_cells. Inert (no fields,
unchanged OLED) when BATT_ADC_PIN None. Payload size logged for the
<250 B budget check (spec §4).

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 4: Dashboard — battery readout, colour states, debounced cue, `batt_cells` config

**Files:**
- Modify: `rasicross.js` (`state.batt`; `rcAudio.battWarn/battCrit`; `processTelemetry` parse + transition cue; battery KPI render; `_lastKpiText`; config packet + `state.batt.cells`)
- Modify: `RasiCross_Telemetry.html` (5th `.kpi` battery block; `#espBattCells` input)

Context: all three fields optional. `vbat`/`soc` are slow ⇒ update `state.batt` only when present (keep last). `batt_warn` rides every packet when battery active; absent entirely ⇒ feature off/old firmware ⇒ keep the KPI hidden. Per-cell V is computed dashboard-side as `vbat / state.batt.cells`. The cue fires once per **upward** transition only (0→1, 0→2, 1→2), never on recovery.

- [ ] **Step 1: Read** `rasicross.js`: the `state` object (the `spdSrc: 'gps',` line), the `rcAudio` IIFE return object (the `pitCall:` / `setEnabled:` / `isEnabled:` lines), `processTelemetry` (the `if (d.spd_src) state.spdSrc = d.spd_src;` line), `let _lastKpiText = { … };`, the battery render insertion point in `updateLiveKPIs` (re-use the Phase-2 pattern near the `spdSrcTag` block — Read around `_lastKpiText.spdSrc = _srcLabel;`), and the config packet (`wheel_circ_m: Number($('espWheelCirc').value) || 0`). Read `RasiCross_Telemetry.html` the KPI row (the "Aktuelle Runde" `.kpi` block ending `<b id="kLapBest">--:--.---</b></div>\n    </div>`) and the ESP config field for `espWheelCirc`. Copy anchors from these Reads.

- [ ] **Step 2: Add `state.batt`**

Edit `rasicross.js` — replace exactly:

```
  spdSrc: 'gps',
```

with:

```
  spdSrc: 'gps',
  batt: { present: false, vbat: 0, soc: 0, warn: 0, cells: 3, _lastWarn: 0 },
```

- [ ] **Step 3: Add battery audio cues**

Edit `rasicross.js` — replace exactly:

```
    warning:    () => beep(220, 400, 0.22),
    pitCall:    () => { beep(660, 200, 0.2); setTimeout(() => beep(880, 200, 0.2), 220); },
```

with:

```
    warning:    () => beep(220, 400, 0.22),
    pitCall:    () => { beep(660, 200, 0.2); setTimeout(() => beep(880, 200, 0.2), 220); },
    battWarn:   () => beep(300, 350, 0.2),
    battCrit:   () => { beep(200, 300, 0.25); setTimeout(() => beep(200, 300, 0.25), 320); },
```

- [ ] **Step 4: Parse battery fields + fire the debounced transition cue in `processTelemetry`**

Edit `rasicross.js` — replace exactly:

```
    if (d.spd_src) state.spdSrc = d.spd_src;
```

with:

```
    if (d.spd_src) state.spdSrc = d.spd_src;
    // Batterie (A3): vbat/soc langsam -> nur bei Anwesenheit aktualisieren
    // (sonst letzten Wert behalten); batt_warn jedes Paket wenn aktiv.
    if (d.vbat != null) { state.batt.vbat = Number(d.vbat) || 0; state.batt.present = true; }
    if (d.soc != null)  { state.batt.soc = Number(d.soc) || 0;  state.batt.present = true; }
    if (d.batt_warn != null) {
      state.batt.present = true;
      const w = Number(d.batt_warn) || 0;
      if (w > state.batt._lastWarn) {           // nur Aufwaerts-Transition
        if (w === 2) { rcToast('⛔ Akku kritisch!', 3500); rcAudio.battCrit(); }
        else if (w === 1) { rcToast('⚠ Akku schwach', 3000); rcAudio.battWarn(); }
      }
      state.batt._lastWarn = w;
      state.batt.warn = w;
    }
```

- [ ] **Step 5: Add `batt` to `_lastKpiText`**

Edit `rasicross.js` — replace exactly:

```
let _lastKpiText = { speed: '', rpm: '', g: '', lap: '', count: '', spdSrc: '' };
```

with:

```
let _lastKpiText = { speed: '', rpm: '', g: '', lap: '', count: '', spdSrc: '', batt: '' };
```

- [ ] **Step 6: Render the battery KPI (value/sub/colour/show) in `updateLiveKPIs`**

Edit `rasicross.js` — replace exactly (the end of the Phase-2 spd-src tag block):

```
      _lastKpiText.spdSrc = _srcLabel;
    }
```

with:

```
      _lastKpiText.spdSrc = _srcLabel;
    }
    // Batterie-KPI: erst sichtbar sobald Daten kamen; Farbe nach warn.
    if (state.batt.present) {
      const _bEl = $('kpiBatt');
      if (_bEl && _bEl.classList.contains('hidden')) _bEl.classList.remove('hidden');
      const _cells = state.batt.cells > 0 ? state.batt.cells : 3;
      const _vc = state.batt.vbat / _cells;
      const _battText = `${state.batt.soc}|${state.batt.vbat.toFixed(2)}|${_vc.toFixed(2)}|${state.batt.warn}`;
      if (_battText !== _lastKpiText.batt) {
        const _v = $('kBatt'), _s = $('kBattSub');
        if (_v) _v.innerHTML = `${state.batt.soc}<small>%</small>`;
        if (_s) _s.innerHTML = `<b>${state.batt.vbat.toFixed(2)}</b> V · Zelle <b>${_vc.toFixed(2)}</b> V`;
        if (_bEl) _bEl.style.color = state.batt.warn === 2 ? '#e5484d'
                                   : state.batt.warn === 1 ? '#e8a13a'
                                   : '';
        _lastKpiText.batt = _battText;
      }
    }
```

- [ ] **Step 7: Add `batt_cells` to the config packet + remember it in `state`**

Edit `rasicross.js` — replace exactly:

```
      wheel_circ_m: Number($('espWheelCirc').value) || 0
    };
```

with:

```
      wheel_circ_m: Number($('espWheelCirc').value) || 0,
      batt_cells: Number($('espBattCells').value) || 3
    };
    state.batt.cells = cfg.batt_cells;
```

- [ ] **Step 8: HTML — add the battery KPI block**

Edit `RasiCross_Telemetry.html` — replace exactly:

```
      <div class="kpi-v" id="kLap" style="font-size:clamp(30px,3.6vw,40px)">--:--.---</div>
      <div class="kpi-sub">Best <b id="kLapBest">--:--.---</b></div>
    </div>
  </div>
```

with:

```
      <div class="kpi-v" id="kLap" style="font-size:clamp(30px,3.6vw,40px)">--:--.---</div>
      <div class="kpi-sub">Best <b id="kLapBest">--:--.---</b></div>
    </div>
    <div class="kpi hidden" id="kpiBatt">
      <div class="kpi-head">
        <span class="kpi-l">Batterie</span>
        <span class="kpi-icon"><svg viewBox="0 0 24 24"><rect x="2" y="7" width="16" height="10" rx="2"/><path d="M20 10v4"/></svg></span>
      </div>
      <div class="kpi-v" id="kBatt">--<small>%</small></div>
      <div class="kpi-sub" id="kBattSub"><b>--</b> V · Zelle <b>--</b> V</div>
    </div>
  </div>
```

- [ ] **Step 9: HTML — add the `Akkuzellen` config input**

Edit `RasiCross_Telemetry.html` — replace exactly:

```
        <div class="field"><label>Radumfang m (0 = nur GPS)</label><input type="number" id="espWheelCirc" value="0" min="0" step="0.001"></div>
```

with:

```
        <div class="field"><label>Radumfang m (0 = nur GPS)</label><input type="number" id="espWheelCirc" value="0" min="0" step="0.001"></div>
        <div class="field"><label>Akkuzellen (Battery cells)</label><input type="number" id="espBattCells" value="3" min="1" max="14"></div>
```

- [ ] **Step 10: Verify (regression + syntax + static)**

Run: `node --check rasicross.js` → exit 0.
Run: `node --test` (no path) → `tests 10` … `pass 10` … `fail 0` (geo.js suite unaffected — confirms no JS breakage; no JS test blocks added).
Run (Grep tool) `rasicross.js`: `state\.batt` → ≥8; `rcAudio\.battCrit` → ≥2 (def + call); `rcAudio\.battWarn` → ≥2; `kpiBatt` → ≥2; `batt_cells` → ≥1. `RasiCross_Telemetry.html`: `id="kpiBatt"` → 1; `id="kBatt"` → 1; `id="kBattSub"` → 1; `id="espBattCells"` → 1.
Manual smoke (record in commit, do not block here — deferred to handoff): if convenient, open `RasiCross_Telemetry.html` in Chromium, click Demo — Speed/RPM update; no console errors; the Batterie KPI stays hidden (demo packets have no battery fields). Battery behaviour itself is covered by the hardware checklist.
Delete any `__pycache__`; `git status --short` shows only `rasicross.js` + `RasiCross_Telemetry.html` modified.

- [ ] **Step 11: Commit**

```bash
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" add rasicross.js RasiCross_Telemetry.html
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" commit -m "feat(dashboard): battery KPI, colour states, debounced low-batt cue

Reads optional vbat/soc/batt_warn (keeps last for slow fields), shows a
hidden-until-present Battery KPI with amber/red states and computed
per-cell V, and fires rcToast + rcAudio once per upward warn transition.
batt_cells added to the live config packet. Backward-compatible.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 5: Phase verification, plan commit & push

**Files:** none (verification + push); commits the Phase 4 plan doc.

- [ ] **Step 1: Full local CI dry-run** (clone root; `py -3` if `python` absent):
```
node --check geo.js
node --check rasicross.js
node --check main.js
node --check preload.js
npm test
python -m py_compile sender.py bridge.py esp_libs/micropyGPS.py esp_libs/mpu6050.py esp_libs/oled_diagnose.py esp_libs/ssd1306.py esp_libs/calc.py
python -m unittest discover -s test -p "test_*.py" -v
```
Expected: all exit 0; `npm test` = `tests 10 | pass 10 | fail 0`; unittest = `Ran 17 tests` `OK` (6 prior + 11 new battery test methods = **17 tests** across all classes; record the exact line). Delete any `__pycache__`; confirm `git status --short` shows no pyc/pycache (only the untracked plan doc until Step 3, plus untracked `.claude/`).

- [ ] **Step 2: Backward-compat + byte-budget spot-check**
- Grep `sender.py`: confirm battery keys are added **only** under `if battery.active:` (no `vbat`/`soc`/`batt_warn` in the base `packet = { … }` dict literal) and `vbat`/`soc` only under `if slow:` — i.e. default `BATT_ADC_PIN None` ⇒ zero new keys, packet identical to Phase 3. Confirm no existing packet key (`speed`,`rpm`,`gx`,`gy`,`lat`,`lon`,`gps_fix`,`gps_health`,`pulse_hz`,`send_ms`,`spd_src`,`imu_cal`) was removed/renamed.
- Grep `rasicross.js`: confirm each of `d.vbat`/`d.soc`/`d.batt_warn` is guarded by `!= null` (absent ⇒ keep last / stay hidden; old firmware safe) and the KPI only un-hides when `state.batt.present`.
- Byte budget (spec §4): the new worst-case slow packet adds ≈ `"batt_warn":2,"vbat":12.34,"soc":87` (~35 B) on top of the Phase-3 packet. Note in the commit/report that real `len(payload)` is logged by `sender.py` (Task 3 Step 5) and the **< 250 B** confirmation is hardware-checklist item (no ESP here).

- [ ] **Step 3: Commit the plan document**
```bash
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" add docs/superpowers/plans/2026-05-18-04-battery-telemetry.md
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" commit -m "docs: phase 4 implementation plan (battery telemetry A3)

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

- [ ] **Step 4: Push**
```bash
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" push
```
Credentials cached this session — should be silent. If it hangs >30s on auth, report BLOCKED (do not loop).

- [ ] **Step 5: Deferred to user (do NOT attempt here):** GitHub Actions `check` confirmation (no `gh` CLI) and the hardware acceptance checklist below. Note them as pending in the report.

---

## Hardware Acceptance Checklist (user-run, real ESP32 + battery + OLED — not runtime-testable here)

Flash the updated `esp_libs/calc.py` and `sender.py` (as `main.py`). Set `Config.BATT_ADC_PIN` to a real **ADC1** GPIO (32–39, e.g. 34) wired through the external divider; set `BATT_DIVIDER`/`BATT_CAL`/`BATT_CELLS`/thresholds for the pack. Then verify:

1. **Disabled path:** with `BATT_ADC_PIN = None`, telemetry + OLED behave exactly as before (no `vbat`/`soc`/`batt_warn`; dashboard Batterie KPI stays hidden; OLED diag shows the condensed `GPS .. TX ..` line + SPD/RPM, no BAT).
2. **Accuracy:** `vbat` within **±0.1 V** of a multimeter on the pack (tune `BATT_CAL` if needed; change takes effect after re-flash).
3. **Per-cell + SoC:** dashboard per-cell ≈ `vbat / cells`; SoC plausible against the curve (full ≈100, nominal mid, near-empty low).
4. **Warn/critical:** lowering pack voltage past `BATT_CELL_WARN` then `BATT_CELL_CRIT` flips the KPI amber then red, and fires the toast + sound **once per downward crossing** (not every packet); recovering does not re-fire.
5. **Live config:** changing `Akkuzellen` in the dashboard ESP config + "An ESP32 senden" updates per-cell/SoC without re-flashing.
6. **OLED:** diag page shows `BAT 11.8V` (≈ pack V) without truncating GPS/TX/SPD/RPM in the 128×64 layout.
7. **Byte budget:** with `DEBUG` (or topic `link`) on, the logged worst-case `payload bytes:` (slow packet, battery active, plus any Phase-2 `spd_src`) stays **< 250 B**.

---

## Self-Review

**1. Spec coverage (§5 A3 + §4 + §6):**
- Config keys `BATT_ADC_PIN/BATT_DIVIDER/BATT_CELLS/BATT_CAL/BATT_CELL_WARN/BATT_CELL_CRIT` + `SLOW_FIELD_EVERY` → Task 2 Step 3. ✅
- ADC 11 dB, 16-sample average, `vbat = adc_volts*DIVIDER*CAL`, `vcell = vbat/CELLS` → Task 2 Step 4 (`Battery.read`) + Task 1 (`battery_pack_v`/`battery_cell_v`). ✅
- `soc` piecewise LiPo curve (4.20→100,3.85→60,3.70→35,3.50→15,3.30→0, clamped) → Task 1 `battery_soc` + tests. ✅
- `batt_warn` 0/1/2 on `vcell` vs WARN/CRIT → Task 1 `battery_warn` + tests. ✅
- `vbat`,`soc` slow; `batt_warn` every; `vcell` NOT transmitted (derived dashboard-side) → Task 3 Steps 3–4 (cadence/emit) + Task 4 Step 6 (dashboard computes `_vc = vbat/cells`). ✅
- `BATT_ADC_PIN is None ⇒ inert, no fields` → Task 2 (`active`/inert ctor) + Task 3 `if battery.active:` guards + behavioural-invariant + Task 5 Step 2. ✅
- Dashboard readout pack V / per-cell / SoC; normal/amber/red; `rcToast`+`rcAudio` debounced once per transition; missing ⇒ hidden → Task 4 Steps 2,4,6,8. ✅
- OLED `page_diag` gains `BAT 11.8V` only if present, within 128×64 (condensed GPS/TX) → Task 3 Step 7. ✅
- §4 byte budget: aggressive rounding (`vbat` 2 dp, `soc` int), slow cadence via `SLOW_FIELD_EVERY`, **measurement step logging `len(payload)`** → Task 3 Steps 4–5; hardware checklist item 7 verifies <250 B. ✅
- §6 data table (`vbat` number/slow/2dp, `soc` int/slow, `batt_warn` int/every; additive; bridge unchanged) → Task 3 Step 4; backward-compat → Task 4 Step 4 / Task 5 Step 2. ✅
- §7 (ESP code compile-checked + hardware-verified; pure math unit-tested; JS verified locally) → Task 1 (unittest), 2–3 (py_compile + checklist), 4 (node --check/--test + smoke). ✅

**2. Placeholder scan:** No TBD/TODO; every code step has complete code; every command has an expected result. ✅

**3. Type/name consistency:** `battery_pack_v(adc_volts,divider,cal)`, `battery_cell_v(vbat,cells)`, `battery_soc(vcell)`, `battery_warn(vcell,warn_v,crit_v)` — identical signatures in `calc.py`, `test_calc.py`, and the `Battery.read` call sites. Packet keys `vbat`/`soc`/`batt_warn` (snake, wire) consistent in `sender.py` emit and `rasicross.js` parse (`d.vbat`/`d.soc`/`d.batt_warn`); dashboard state `state.batt.{vbat,soc,warn,cells,present,_lastWarn}` used consistently; DOM ids `kpiBatt`/`kBatt`/`kBattSub`/`espBattCells` identical in `rasicross.js` and the HTML. `Config.BATT_CELLS` set by `apply_config` (`batt_cells`), produced by the dashboard `espBattCells` input → `cfg.batt_cells` → `state.batt.cells`. `SLOW_FIELD_EVERY` defined Task 2, consumed Task 3. `rcAudio.battWarn/battCrit` defined Task 4 Step 3, called Task 4 Step 4. ✅

**4. Notes:** `Battery.read()` does ADC IO only; all arithmetic is the tested `calc.*` (so the untestable-here ESP code is a thin wrapper). The slow-field counter/`slow` flag is intentionally generic so Phase 5 (A4 `mtemp`) can reuse it. Test total moves 6 → 17 (`Ran 17 tests`); `node --test` stays `tests 10 | pass 10` (no JS blocks added — DOM/WebAudio not unit-tested here, consistent with Phases 2–3). `'unsafe-inline'` style CSP from Phase 3 already permits the new inline `style="…"` on no new elements (the battery KPI uses classes + JS `.style.color`, which CSP `style-src 'unsafe-inline'` allows).

---

## Phase Map

Phase **4 of 6**. Done: Phase 1 (test/CI, `geo.js`), Phase 2 (A1 RPM fix + A2 wheel-speed, `calc.py`), Phase 3 (A5 CSP + de-inline all handlers). Next: Phase 5 = A4 IMU expansion — `mpu6050.py` `gyro` property; `sender.py` `IMU` exposes `az`/`yaw`(gyro-Z, `G_ALPHA`-smoothed)/`mpu_temp`; new fields `gz`(2 dp, every), `yaw`(1 dp, every), `mtemp`(int, **slow — reuses this phase's `slow`/`SLOW_FIELD_EVERY`**); dashboard yaw readout + `gz`/`yaw` in charts/recording + `mtemp` secondary readout. Phase 6 = C1 recording + in-app replay (largest JS feature; pure `replay.js` + tests).
