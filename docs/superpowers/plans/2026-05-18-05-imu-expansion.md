# Phase 5 — A4: IMU Expansion (accel-Z + yaw rate + MPU temp) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose three additional MPU-6050 channels — accel-Z (`gz`, g), yaw rate (`yaw`, gyro-Z °/s, smoothed), and chip temperature (`mtemp`, °C) — through the telemetry packet and surface them on the dashboard (yaw/temp readouts + `gz`/`yaw` live charts), fully additively and backward-compatibly.

**Architecture:** `mpu6050.py` gains an additive `gyro` property mirroring the existing `accel` byte-decode (register `0x43`, ±250 °/s ⇒ `/131.0`). `sender.py` `IMU.update()` also reads accel-Z and gyro-Z, smoothing both with the **existing inline `G_ALPHA` EMA** (the same one used for `gx`/`gy`); new `az`/`yaw`/`mpu_temp` properties. The send loop adds `gz`/`yaw` to every packet (like the always-present `gx`/`gy`) and `mtemp` on the slow cadence introduced in Phase 4 (`SLOW_FIELD_EVERY`). The dashboard parses the three optional fields, charts `gz` on the existing G-axis and `yaw` on a right axis via the **existing speed/rpm dual-axis chart pattern**, and adds yaw/temp to the G-Kraft KPI sub-line.

**Tech Stack:** MicroPython (`esp_libs/mpu6050.py`, `sender.py`), vanilla DOM + canvas charts (`rasicross.js`, `RasiCross_Telemetry.html`). No new deps. **No `calc.py`/unit-test changes** — A4 is a hardware sensor-expansion phase (the A1 precedent); the only arithmetic is the existing EMA reused inline plus trivial register scaling in the hardware driver. CPython `unittest` stays at `Ran 17 tests`.

---

## Working Directory & Conventions

**All work happens in the git clone:** `C:/Users/jimlu/Documents/RasiCross-Telemetrie-git` (branch `docs/telemetry-improvements-spec`, Phases 1–4 already committed/pushed).

- Paths relative to clone root unless absolute. Files use **CRLF**; always `Read` the target region in-session immediately before an `Edit` and copy the `old_string` anchor from that fresh Read (strip the line-number/tab prefix). Line numbers below are indicative — anchor on the text.
- Git: `git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" …`. Use the Grep tool (not shell grep) for verification greps. There is an untracked `.claude/` directory and untracked plan docs — **never** `git add` them; use explicit `git add <path>`.
- Windows: Python may be `python` or `py -3` — try `python` first, fall back to `py -3`. Node v24 local; CI Node 20 / Python 3.12.
- **Spec:** `docs/superpowers/specs/2026-05-17-rasicross-telemetry-improvements-design.md` §4 (byte budget / slow cadence), §5 A4, §6 (data table), §7.
- **ESP code reality:** `sender.py`/`mpu6050.py` cannot be runtime-tested here (no ESP32/MPU-6050). The byte-decode is identical in shape to the existing, working `accel` path; edits are conservative, additive, statically reviewed, and **hardware-verified by the user** via the checklist at the end (the A1 precedent — that phase also shipped with static review + hardware checklist and no unit tests). JS is verified with `node --check` + `node --test` (regression; no new JS test blocks — DOM/canvas wiring is not unit-tested in this project, consistent with Phases 2–4) + a deferred manual smoke.

**Behavioural invariant:** All new fields are additive. `gz`/`yaw` are emitted every packet exactly like the always-present `gx`/`gy` (value `0.0` when no MPU — the existing `gx`/`gy` behaviour); `mtemp` is emitted only on slow packets and only when the IMU initialised OK (omitted otherwise — dashboard keeps last / shows `--`). No existing packet key or behaviour changes. With no MPU present, `IMU.update()` still returns early as today and `gx`/`gy` are unchanged. The dashboard tolerates absence of all three (defaults `0` / last value). Old firmware → dashboard shows `0`/`--`; old dashboard → ignores the new keys.

**Locked decisions (spec + established codebase patterns):**
1. **No `calc.py`/unittest work.** `yaw` is smoothed with the *existing inline* `alpha*x + (1-alpha)*prev` EMA already used for `gx`/`gy` (spec: "lightly smoothed with the existing `G_ALPHA`-style filter"). Extracting an `ema()` helper is out of scope (would force refactoring the working RPM/G smoothing for consistency — risk with no hardware to test). A4 mirrors the A1 hardware-phase verification model.
2. **`gz` = accel-Z in g** (`imu.az`, 2 dp, every packet); **`yaw` = smoothed gyro-Z °/s** (`imu.yaw`, 1 dp, every packet); **`mtemp` = `int` MPU °C** (slow cadence, reuses Phase-4 `slow`/`Config.SLOW_FIELD_EVERY`).
3. **`gz`/`yaw` always emitted** (0.0 without MPU) — consistent with the existing always-present `gx`/`gy`. `mtemp` omitted when IMU not OK.
4. **Charts:** `gz` joins the existing G-chart (same g axis/unit); `yaw` joins the *same* chart on a right axis using the **existing dual-axis pattern** proven by the speed/rpm chart (`drawChart` `opts.right`/`opts.maxRight`; right-axis series pre-mapped into the primary range). `YAW_DPS = 250` (matches the ±250 °/s gyro range). No new canvas (YAGNI).
5. **Readouts:** extend the **G-Kraft KPI sub-line** with `· Gier <b id="kYaw">…</b>°/s · MPU <b id="kMtemp">…</b>°C` — mirrors the Phase-2 Speed-KPI sub-line extension; no new KPI block.
6. **"in recording":** there is **no per-sample recording in the codebase yet** (only per-lap `maxSpeed`/`maxRpm` summaries; full recording+replay is **C1 / Phase 6**). Adding `gz`/`yaw`/`mtemp` to the parsed telemetry + `state` means Phase-6 C1 recording captures them automatically. No Phase-5 recording code exists to modify — inventing one is Phase-6 scope (YAGNI). This is the honest reading of "include … in recording".
7. **No OLED change** — A4 (unlike A3) does not request one; keep scope tight.

---

## File Structure

| Action | Path | Responsibility |
|--------|------|----------------|
| Modify | `esp_libs/mpu6050.py` | Add `GYRO_XOUT_H`/`GYRO_SCALE_250` constants + additive `gyro` property (°/s). `accel`/`temperature_c` untouched. |
| Modify | `sender.py` | `IMU.update()` also reads accel-Z + gyro-Z, EMA-smoothed; new `az`/`yaw`/`mpu_temp` properties. Packet emits `gz`/`yaw` every packet, `mtemp` slow. |
| Modify | `rasicross.js` | `state.charts` `gz`/`yaw` arrays + `state.imu`; parse `gz`/`yaw`/`mtemp` in `processTelemetry` (+ chart push/trim); yaw/temp readouts in `updateLiveKPIs`; `gz`/`yaw` in `drawLiveCharts` (dual-axis). |
| Modify | `RasiCross_Telemetry.html` | Extend the G-Kraft KPI sub-line with `#kYaw` + `#kMtemp`. |

**Task order (each commit independently sound):** T1 mpu6050 `gyro` → T2 sender `IMU` props → T3 sender packet wiring → T4 dashboard → T5 phase verify/commit/push.

---

### Task 1: `mpu6050.py` — additive `gyro` property

**Files:** Modify `esp_libs/mpu6050.py` (2 constants + `gyro` property; `accel` untouched)

- [ ] **Step 1: Read** `esp_libs/mpu6050.py` (whole file — short) to anchor the two edits exactly.

- [ ] **Step 2: Add the `GYRO_XOUT_H` + `GYRO_SCALE_250` constants**

Edit `esp_libs/mpu6050.py` — replace exactly:

```
    ACCEL_XOUT_H = 0x3B
    WHO_AM_I     = 0x75
    DEFAULT_ADDR = 0x68

    # Skalierung fuer Beschleunigung +-2g (Standard-Range)
    ACCEL_SCALE_2G = 16384.0
```

with:

```
    ACCEL_XOUT_H = 0x3B
    GYRO_XOUT_H  = 0x43
    WHO_AM_I     = 0x75
    DEFAULT_ADDR = 0x68

    # Skalierung fuer Beschleunigung +-2g (Standard-Range)
    ACCEL_SCALE_2G = 16384.0
    # Skalierung fuer Gyro +-250 deg/s (Standard-Range, GYRO_CONFIG=0)
    GYRO_SCALE_250 = 131.0
```

- [ ] **Step 3: Add the `gyro` property after `accel`**

Edit `esp_libs/mpu6050.py` — replace exactly:

```
    @property
    def accel(self):
        """Liefert (ax, ay, az) in g-Einheiten."""
        # Sechs Bytes auf einmal lesen ist effizienter
        data = self._i2c.readfrom_mem(self._addr, self.ACCEL_XOUT_H, 6)
        ax = ustruct.unpack(">h", data[0:2])[0] / self._scale
        ay = ustruct.unpack(">h", data[2:4])[0] / self._scale
        az = ustruct.unpack(">h", data[4:6])[0] / self._scale
        return (ax, ay, az)
```

with:

```
    @property
    def accel(self):
        """Liefert (ax, ay, az) in g-Einheiten."""
        # Sechs Bytes auf einmal lesen ist effizienter
        data = self._i2c.readfrom_mem(self._addr, self.ACCEL_XOUT_H, 6)
        ax = ustruct.unpack(">h", data[0:2])[0] / self._scale
        ay = ustruct.unpack(">h", data[2:4])[0] / self._scale
        az = ustruct.unpack(">h", data[4:6])[0] / self._scale
        return (ax, ay, az)

    @property
    def gyro(self):
        """Liefert (gx, gy, gz) in Grad/Sekunde (Range +-250 deg/s)."""
        # Identisches Schema wie accel: 6 Bytes, big-endian signed.
        data = self._i2c.readfrom_mem(self._addr, self.GYRO_XOUT_H, 6)
        gx = ustruct.unpack(">h", data[0:2])[0] / self.GYRO_SCALE_250
        gy = ustruct.unpack(">h", data[2:4])[0] / self.GYRO_SCALE_250
        gz = ustruct.unpack(">h", data[4:6])[0] / self.GYRO_SCALE_250
        return (gx, gy, gz)
```

- [ ] **Step 4: Static verification**

Run: `python -m py_compile esp_libs/mpu6050.py` (or `py -3 …`). Expected: exit 0.
Run (Grep tool) on `esp_libs/mpu6050.py`: `GYRO_XOUT_H  = 0x43` → 1; `GYRO_SCALE_250 = 131.0` → 1; `def gyro\(self\)` → 1; `def accel\(self\)` → 1 (still present). Visually confirm (from the Read) the `accel` body and `temperature_c` are byte-for-byte unchanged.
Delete any `__pycache__` (Bash: `find . -name __pycache__ -type d -prune -exec rm -rf {} + 2>/dev/null`). Confirm `git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" status --short` shows only `esp_libs/mpu6050.py` modified.

- [ ] **Step 5: Commit**

```bash
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" add esp_libs/mpu6050.py
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" commit -m "feat(mpu6050): additive gyro property (deg/s, +-250 range)

Reads GYRO_XOUT (0x43) with the same big-endian signed decode as
accel; /131.0 for the +-250 deg/s range. accel/temperature_c untouched.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 2: `sender.py` `IMU` — `az` / `yaw` / `mpu_temp`

**Files:** Modify `sender.py` (`IMU.__init__` state; `IMU.update()` reads accel-Z + gyro-Z, EMA-smoothed; new `az`/`yaw`/`mpu_temp` properties)

Context: `IMU.update()` currently reads `ax, ay, _az = self._mpu.accel`, calibrates/​smooths `gx`/`gy` with `alpha*v + (1-alpha)*prev` (`alpha = Config.G_ALPHA`), returns `(gx, gy)`. We additionally use accel-Z (no calibration offset — only the lean axes are zeroed) and gyro-Z, each smoothed with the **same EMA**. `mpu_temp` reads the chip temperature on demand (sender calls it only on slow packets). If the MPU is absent (`not self._ok`) the early `return (0.0, 0.0)` is unchanged and `az`/`yaw` stay `0.0`, `mpu_temp` is `None`.

- [ ] **Step 1: Read** `sender.py` the whole `IMU` class (from `class IMU:` through the `ok` property — the section between the `# ── IMU (MPU-6050) ──` banner and the `# ── GPS ──` banner). Copy the three anchors below from that fresh Read.

- [ ] **Step 2: Add `_az`/`_yaw` to `IMU.__init__`**

Edit `sender.py` — replace exactly:

```
    def __init__(self, i2c):
        self._ok  = False
        self._gx  = 0.0
        self._gy  = 0.0
        self._mpu = None
```

with:

```
    def __init__(self, i2c):
        self._ok  = False
        self._gx  = 0.0
        self._gy  = 0.0
        self._az  = 0.0          # geglaettetes Accel-Z (g)
        self._yaw = 0.0          # geglaettete Gier-Rate = Gyro-Z (deg/s)
        self._mpu = None
```

- [ ] **Step 3: Read accel-Z + gyro-Z and smooth them in `IMU.update()`**

Edit `sender.py` — replace exactly:

```
        try:
            ax, ay, _az = self._mpu.accel
            # Kalibrierung: rohe Samples mitteln, bis Zeit abgelaufen
            if self._cal_active:
```

with:

```
        try:
            ax, ay, az = self._mpu.accel
            _gxr, _gyr, gzr = self._mpu.gyro      # nur Z (= Gier) genutzt
            # Accel-Z + Gier mit demselben EMA wie gx/gy glaetten
            # (keine Kalibrier-Offsets: nur die Lehne-Achsen werden genullt).
            self._az  = alpha * az  + (1 - alpha) * self._az
            self._yaw = alpha * gzr + (1 - alpha) * self._yaw
            # Kalibrierung: rohe Samples mitteln, bis Zeit abgelaufen
            if self._cal_active:
```

- [ ] **Step 4: Add `az` / `yaw` / `mpu_temp` properties**

Edit `sender.py` — replace exactly:

```
    @property
    def ok(self):  return self._ok
```

with:

```
    @property
    def ok(self):  return self._ok

    @property
    def az(self):   return self._az

    @property
    def yaw(self):  return self._yaw

    @property
    def mpu_temp(self):
        """Chip-Temperatur in ganzen Grad C, oder None wenn nicht
        verfuegbar. Wird nur auf Slow-Paketen abgefragt."""
        if not self._ok:
            return None
        try:
            return int(round(self._mpu.temperature_c))
        except Exception:
            return None
```

- [ ] **Step 5: Static verification**

Run: `python -m py_compile sender.py esp_libs/mpu6050.py esp_libs/calc.py` (or `py -3 …`). Expected: exit 0.
Run (Grep tool) on `sender.py`: `self\._az  = 0\.0` → 1; `self\._yaw = 0\.0` → 1; `_gxr, _gyr, gzr = self\._mpu\.gyro` → 1; `def az\(self\)` → 1; `def yaw\(self\)` → 1; `def mpu_temp\(self\)` → 1; `ax, ay, az = self\._mpu\.accel` → 1; and `ax, ay, _az` → **0** (old form gone). Visually confirm (fresh Read) the EMA lines use `alpha` and the existing `gx`/`gy` smoothing + calibration logic is unchanged.
Delete any `__pycache__`; `git status --short` shows only `sender.py` modified, no pyc.

- [ ] **Step 6: Commit**

```bash
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" add sender.py
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" commit -m "feat(sender): IMU exposes az / yaw (gyro-Z) / mpu_temp

update() now also reads accel-Z and gyro-Z, smoothed with the same
G_ALPHA EMA as gx/gy (no calibration offset — only lean axes are
zeroed). mpu_temp reads chip temp on demand (slow-cadence use).
No change to gx/gy or the no-MPU early return.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 3: `sender.py` — emit `gz` / `yaw` (every) + `mtemp` (slow)

**Files:** Modify `sender.py` (packet dict gains `gz`/`yaw`; the existing slow block gains `mtemp`)

Context: the packet is built around `gx, gy = imu.update()`. `gz`/`yaw` ride every packet like `gx`/`gy`. `mtemp` is added inside the existing Phase-4 `if slow:` block — independent of battery, only when `imu.mpu_temp` is not `None`.

- [ ] **Step 1: Read** `sender.py` the send block: the `packet = { … }` dict literal (the `"gx": …` / `"gy": …` / `"imu_cal": …` lines and the closing `}`), the `if battery.active:` block, and the `if slow:` payload-log block ending `log("link", "payload bytes:", len(ujson.dumps(packet)))` then `tx_ok = link.send(packet)`. Copy anchors from the Read.

- [ ] **Step 2: Add `gz`/`yaw` to the packet (every packet)**

Edit `sender.py` — replace exactly:

```
                "gx":       round(gx, 3),
                "gy":       round(gy, 3),
                "lat":      round(gps.lat, 7),
```

with:

```
                "gx":       round(gx, 3),
                "gy":       round(gy, 3),
                "gz":       round(imu.az, 2),    # Accel-Z (g), jedes Paket
                "yaw":      round(imu.yaw, 1),   # Gier-Rate (deg/s), jedes Paket
                "lat":      round(gps.lat, 7),
```

- [ ] **Step 3: Add `mtemp` to the existing slow block**

Edit `sender.py` — replace exactly:

```
            if slow:
                # Byte-Budget-Kontrolle (< 250 B, siehe Spec §4). Nur
                # bei DEBUG/Topic 'link' sichtbar -> kein Funk-Overhead.
                log("link", "payload bytes:", len(ujson.dumps(packet)))
```

with:

```
            if slow:
                mt = imu.mpu_temp
                if mt is not None:
                    packet["mtemp"] = mt          # MPU-Chip-Temp (deg C), langsam
                # Byte-Budget-Kontrolle (< 250 B, siehe Spec §4). Nur
                # bei DEBUG/Topic 'link' sichtbar -> kein Funk-Overhead.
                log("link", "payload bytes:", len(ujson.dumps(packet)))
```

- [ ] **Step 4: Static verification**

Run: `python -m py_compile sender.py esp_libs/mpu6050.py esp_libs/calc.py` (or `py -3 …`). Expected: exit 0.
Run (Grep tool) on `sender.py`: `"gz":       round\(imu\.az, 2\)` → 1; `"yaw":      round\(imu\.yaw, 1\)` → 1; `packet\["mtemp"\] = mt` → 1; `mt = imu\.mpu_temp` → 1. Confirm the base packet still contains the unchanged keys `"speed"`/`"rpm"`/`"gx"`/`"gy"`/`"lat"`/`"lon"`/`"gps_fix"`/`"gps_health"`/`"pulse_hz"`/`"send_ms"`/`"spd_src"`/`"imu_cal"`, and (from Phase 4) the `if battery.active:` block is intact/untouched. Visually confirm (fresh Read) `gz`/`yaw` sit directly after `"gy"` and `mtemp` is inside the `if slow:` block before the payload-bytes `log(...)`.
Delete any `__pycache__`; `git status --short` shows only `sender.py` modified, no pyc.

- [ ] **Step 5: Commit**

```bash
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" add sender.py
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" commit -m "feat(sender): emit gz/yaw every packet, mtemp on slow cadence

gz=accel-Z(2dp), yaw=gyro-Z(1dp) ride every packet like gx/gy;
mtemp=int MPU degC piggybacks the Phase-4 slow block (only when the
IMU is OK). Additive — no existing key changed.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 4: Dashboard — parse, readouts, charts

**Files:**
- Modify: `rasicross.js` (`state.charts` `gz`/`yaw` + `state.imu`; `processTelemetry` parse + chart push/trim; `updateLiveKPIs` yaw/temp readouts; `drawLiveCharts` dual-axis)
- Modify: `RasiCross_Telemetry.html` (G-Kraft KPI sub-line `#kYaw` + `#kMtemp`)

Context: `gz`/`yaw` arrive every packet (default `0`); `mtemp` slow (keep last; `null` until first seen → readout `--`). Charts: `gz` on the existing G-axis, `yaw` mapped onto a right axis using the **same dual-axis mechanism** the speed/rpm chart already uses (`drawChart` reads `opts.right`/`opts.maxRight`; the right-axis series must be pre-mapped into the primary `[min,max]` range — exactly like `state.charts.rpm.map(v => v / maxRpm * maxSpeed)`). `YAW_DPS = 250`.

- [ ] **Step 1: Read** `rasicross.js`: the `charts:` line in `state`; the `processTelemetry` region with `let gx = …` / `let gy = …`, the `state.raw = { … }` line, and the chart-push block (`if (state.charts.speed.length === 0 …` through the `gy` trim + closing `}`); the G-Kraft render in `updateLiveKPIs` (the `gText`/`kG` block and the `setText('kGMax', …)` line); and `drawLiveCharts` (the second `drawChart(_gCtx, _gCanvas, [ … ], -state.settings.gScale, state.settings.gScale, { unit: 'G', zero: true })` call). Read `RasiCross_Telemetry.html` the G-Kraft KPI block (`<div class="kpi-sub">Max <b id="kGMax">0.0</b></div>`). Copy anchors from these Reads.

- [ ] **Step 2: Add `gz`/`yaw` chart arrays + `state.imu`**

Edit `rasicross.js` — replace exactly:

```
  charts: { speed: [], rpm: [], gx: [], gy: [] },
```

with:

```
  charts: { speed: [], rpm: [], gx: [], gy: [], gz: [], yaw: [] },
  imu: { yaw: 0, mtemp: null },
```

- [ ] **Step 3: Parse `gz`/`yaw`/`mtemp` in `processTelemetry`**

Edit `rasicross.js` — replace exactly:

```
    let gx = (Number(d.gx) || 0) - state.calibration.gxZero;
    let gy = (Number(d.gy) || 0) - state.calibration.gyZero;
```

with:

```
    let gx = (Number(d.gx) || 0) - state.calibration.gxZero;
    let gy = (Number(d.gy) || 0) - state.calibration.gyZero;
    const gz = Number(d.gz) || 0;                  // Accel-Z (g), jedes Paket
    const yawv = Number(d.yaw) || 0;               // Gier (deg/s), jedes Paket
    state.imu.yaw = yawv;
    if (d.mtemp != null) state.imu.mtemp = Number(d.mtemp) || 0;  // langsam: letzten Wert halten
```

- [ ] **Step 4: Add `gz`/`yaw` to `state.raw`**

Edit `rasicross.js` — replace exactly:

```
    state.raw = { speed, rpm, gx: Number(d.gx) || 0, gy: Number(d.gy) || 0, lat: lat || 0, lon: lon || 0 };
```

with:

```
    state.raw = { speed, rpm, gx: Number(d.gx) || 0, gy: Number(d.gy) || 0, gz, yaw: yawv, lat: lat || 0, lon: lon || 0 };
```

- [ ] **Step 5: Push `gz`/`yaw` into the chart ring buffers**

Edit `rasicross.js` — replace exactly:

```
      state.charts.gx.push(gx);
      state.charts.gy.push(gy);
      const max = 600;
      while (state.charts.speed.length > max) state.charts.speed.shift();
      while (state.charts.rpm.length > max) state.charts.rpm.shift();
      while (state.charts.gx.length > max) state.charts.gx.shift();
      while (state.charts.gy.length > max) state.charts.gy.shift();
```

with:

```
      state.charts.gx.push(gx);
      state.charts.gy.push(gy);
      state.charts.gz.push(gz);
      state.charts.yaw.push(yawv);
      const max = 600;
      while (state.charts.speed.length > max) state.charts.speed.shift();
      while (state.charts.rpm.length > max) state.charts.rpm.shift();
      while (state.charts.gx.length > max) state.charts.gx.shift();
      while (state.charts.gy.length > max) state.charts.gy.shift();
      while (state.charts.gz.length > max) state.charts.gz.shift();
      while (state.charts.yaw.length > max) state.charts.yaw.shift();
```

- [ ] **Step 6: Render the yaw + MPU-temp readouts in `updateLiveKPIs`**

Edit `rasicross.js` — replace exactly:

```
    setText('kGMax', state.max.g.toFixed(1));
```

with:

```
    setText('kGMax', state.max.g.toFixed(1));
    setText('kYaw', Math.round(state.imu.yaw));
    setText('kMtemp', state.imu.mtemp == null ? '--' : Math.round(state.imu.mtemp));
```

- [ ] **Step 7: Chart `gz` (G-axis) + `yaw` (right axis) in `drawLiveCharts`**

Edit `rasicross.js` — replace exactly:

```
    drawChart(_gCtx, _gCanvas,
      [
        { data: state.charts.gx, color: css('--blue'), label: 'Gx' },
        { data: state.charts.gy, color: css('--green'), label: 'Gy' }
      ],
      -state.settings.gScale, state.settings.gScale,
      { unit: 'G', zero: true }
    );
```

with:

```
    const _yawDps = 250;  // Gyro +-250 deg/s -> auf die G-Achse skaliert
    drawChart(_gCtx, _gCanvas,
      [
        { data: state.charts.gx, color: css('--blue'), label: 'Gx' },
        { data: state.charts.gy, color: css('--green'), label: 'Gy' },
        { data: state.charts.gz, color: '#e8a13a', label: 'Gz' },
        { data: state.charts.yaw.map(v => v / _yawDps * state.settings.gScale),
          raw: state.charts.yaw, color: css('--mut'), label: 'Yaw', dash: true }
      ],
      -state.settings.gScale, state.settings.gScale,
      { unit: 'G', zero: true, right: '°/s', maxRight: _yawDps }
    );
```

- [ ] **Step 8: Extend the G-Kraft KPI sub-line (HTML)**

Edit `RasiCross_Telemetry.html` — replace exactly:

```
      <div class="kpi-sub">Max <b id="kGMax">0.0</b></div>
```

with:

```
      <div class="kpi-sub">Max <b id="kGMax">0.0</b> · Gier <b id="kYaw">0</b>°/s · MPU <b id="kMtemp">--</b>°C</div>
```

- [ ] **Step 9: Verify (regression + syntax + static)**

Run: `node --check rasicross.js` → exit 0.
Run: `node --test` (no path) → `tests 10` … `pass 10` … `fail 0` (geo.js suite unaffected — no JS breakage; no new test blocks).
Run (Grep tool) `rasicross.js`: `state\.charts\.gz` → ≥3; `state\.charts\.yaw` → ≥3; `state\.imu` → ≥4; `kYaw` → 1; `kMtemp` → 1; `maxRight: _yawDps` → 1. `RasiCross_Telemetry.html`: `id="kYaw"` → 1; `id="kMtemp"` → 1.
Manual smoke (record in commit, do not block here — deferred to handoff): if convenient, open `RasiCross_Telemetry.html` in Chromium, click Demo — Speed/RPM update; no console errors; the G-chart still renders Gx/Gy (Gz/Yaw flat at 0 since demo packets carry no IMU-Z); G-Kraft sub shows `Gier 0°/s · MPU --°C`. Real IMU-Z behaviour is covered by the hardware checklist.
Delete any `__pycache__`; `git status --short` shows only `rasicross.js` + `RasiCross_Telemetry.html` modified.

- [ ] **Step 10: Commit**

```bash
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" add rasicross.js RasiCross_Telemetry.html
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" commit -m "feat(dashboard): gz/yaw live charts + yaw/MPU-temp readouts

Parses optional gz/yaw (every) and mtemp (slow, keep-last); charts gz
on the G-axis and yaw on a right axis via the existing dual-axis
pattern; G-Kraft KPI sub-line gains Gier °/s + MPU °C. Backward-compat
(absent -> 0 / --).

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 5: Phase verification, plan commit & push

**Files:** none (verification + push); commits the Phase 5 plan doc.

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
Expected: all exit 0; `npm test` = `tests 10 | pass 10 | fail 0`; unittest = `Ran 17 tests` `OK` (unchanged — A4 adds no pure-math tests). Delete any `__pycache__`; confirm `git status --short` shows no pyc/pycache (only the untracked plan doc until Step 3, plus untracked `.claude/`).

- [ ] **Step 2: Backward-compat + byte-budget spot-check**
- Grep `sender.py`: confirm `gz`/`yaw` are in the base packet dict literal right after `"gy"` (always emitted, like `gx`/`gy`), and `mtemp` is added only inside `if slow:` guarded by `mt is not None`. No existing key removed/renamed (`speed`/`rpm`/`gx`/`gy`/`lat`/`lon`/`gps_fix`/`gps_health`/`pulse_hz`/`send_ms`/`spd_src`/`imu_cal` all present; Phase-4 `batt_*`/`vbat`/`soc` block untouched).
- Grep `rasicross.js`: `d.gz`/`d.yaw` default to `0` (`Number(d.x) || 0`); `d.mtemp` guarded by `!= null` (absent ⇒ keep last; old firmware safe). The G-chart still includes `Gx`/`Gy` (no regression of the existing series).
- Byte budget (spec §4): new worst-case adds ≈ `"gz":-0.97,"yaw":-142.3` (~22 B every packet) + `"mtemp":34` (~11 B slow) on top of Phase-4. Note in the report that real `len(payload)` is logged by `sender.py` (Phase-4 mechanism, now also covering the slow `if slow:` block) and the **< 250 B** confirmation is a hardware-checklist item.

- [ ] **Step 3: Commit the plan document**
```bash
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" add docs/superpowers/plans/2026-05-18-05-imu-expansion.md
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" commit -m "docs: phase 5 implementation plan (IMU expansion A4)

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

- [ ] **Step 4: Push**
```bash
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" push
```
Credentials cached this session — should be silent. If it hangs >30s on auth, report BLOCKED (do not loop).

- [ ] **Step 5: Deferred to user (do NOT attempt here):** GitHub Actions `check` confirmation (no `gh` CLI) and the hardware acceptance checklist below. Note them as pending in the report.

---

## Hardware Acceptance Checklist (user-run, real ESP32 + MPU-6050 — not runtime-testable here)

Flash the updated `esp_libs/mpu6050.py` and `sender.py` (as `main.py`). Then verify:

1. **Regression:** `gx`/`gy` and IMU zero-calibration behave exactly as before; `speed`/`rpm`/battery unaffected.
2. **A4 `gz`:** kart upright & still ⇒ `gz` ≈ **1.0 g** (gravity on Z); inverting/tilting changes it as expected; dashboard G-chart shows the `Gz` trace.
3. **A4 `yaw`:** still ⇒ `yaw` ≈ **0 °/s**; rotating the kart about the vertical axis swings `yaw` with the correct **sign** and returns toward 0 when rotation stops (lightly smoothed); dashboard `Gier` readout + the right-axis `Yaw` chart trace track it.
4. **A4 `mtemp`:** dashboard `MPU` readout shows a plausible chip temperature (≈ ambient + a few °C), updating at the slow (~1 Hz) cadence.
5. **No-MPU path:** with the MPU disconnected/absent, `IMU.update()` still returns and `gx`/`gy`/`gz`/`yaw` are `0.0`, `mtemp`/`MPU` shows `--` — no crash, no telemetry stall.
6. **Byte budget:** with `DEBUG` (or topic `link`) on, the logged worst-case `payload bytes:` (slow packet: battery active + `spd_src` + `gz`/`yaw`/`mtemp`) stays **< 250 B**.

---

## Self-Review

**1. Spec coverage (§5 A4 + §4 + §6):**
- `mpu6050.py` additive `gyro` property: read 6 bytes from `GYRO_XOUT` (`0x43`), big-endian signed, ±250 °/s ⇒ `/131.0`, return `(gx,gy,gz)` °/s; `accel` untouched → Task 1. ✅
- `sender.py` `IMU` also exposes `az` (g) and `yaw` = gyro-Z (°/s), yaw lightly smoothed with the `G_ALPHA`-style filter → Task 2 (same inline EMA as `gx`/`gy`). ✅
- `mpu_temp` from existing `temperature_c`, slow cadence → Task 2 (`mpu_temp` property) + Task 3 (emitted only inside `if slow:`). ✅
- New fields `gz` (2 dp, every), `yaw` (1 dp, every), `mtemp` (int °C, slow) → Task 3 (`round(imu.az,2)`, `round(imu.yaw,1)` every packet; `packet["mtemp"]=int` in slow block). §6 table types/cadence/rounding match. ✅
- Dashboard: `processTelemetry` reads `gz`/`yaw`/`mtemp` (default 0 / last value) → Task 4 Steps 3–4; yaw-rate °/s numeric readout + `mtemp` small secondary readout → Step 6 + 8 (G-Kraft sub-line); `gz`/`yaw` in live charts → Step 7. ✅
- "in recording" → no per-sample recorder exists pre-C1; `gz`/`yaw`/`mtemp` are added to parsed telemetry + `state.raw`/`state.imu`, so Phase-6 C1 recording captures them automatically. Documented as locked decision 6; no Phase-5 code to add (YAGNI). ✅
- "All optional; absent ⇒ omitted/zero (backward-compat)" → behavioural invariant + Task 5 Step 2 (defaults `0`/keep-last; old firmware/dashboard safe). ✅
- §4 byte budget: aggressive rounding (`gz` 2 dp, `yaw` 1 dp, `mtemp` int), `mtemp` on slow cadence, real `len(payload)` logged (Phase-4 mechanism) → Task 3; hardware checklist item 6 verifies < 250 B. ✅
- §7 (ESP compile-checked + hardware-verified; JS verified locally; no unit tests for hardware sensor code — A1 precedent) → Tasks 1–3 (py_compile + checklist), 4 (node --check/--test + smoke). ✅

**2. Placeholder scan:** No TBD/TODO; every code step has complete literal code; every command has an expected result. ✅

**3. Type/name consistency:** `mpu6050.gyro` returns `(gx,gy,gz)` °/s; `IMU.update()` consumes `_gxr,_gyr,gzr = self._mpu.gyro` (only Z). `IMU.az`/`IMU.yaw`/`IMU.mpu_temp` produced Task 2, consumed Task 3 (`imu.az`/`imu.yaw`/`imu.mpu_temp`). Packet keys `gz`/`yaw`/`mtemp` (snake, wire) consistent sender↔dashboard (`d.gz`/`d.yaw`/`d.mtemp`). `state.charts.gz`/`state.charts.yaw` + `state.imu.yaw`/`state.imu.mtemp` used consistently; DOM ids `kYaw`/`kMtemp` identical in `rasicross.js` (`setText`) and HTML. `_yawDps` (chart map divisor) == `maxRight` (250) within the one `drawChart` call. EMA uses the existing `alpha`(`Config.G_ALPHA`) — same variable as `gx`/`gy`. ✅

**4. Notes:** `gz` is the spec's name for **accel-Z in g** (`§6`: "accel Z (g)"), implemented as `imu.az` — naming is intentional and matches §6, not a mismatch. Reusing the proven speed/rpm dual-axis path for `yaw` means no new canvas/HTML and no new `drawChart` logic (`opts.right` already supported; right-axis label uses `axisFmt(...,'rpm')` integer formatting which is fine for °/s). `node --test` stays `tests 10 | pass 10` and `unittest` stays `Ran 17 tests` (A4 adds no pure-math/JS test blocks — the hardware-phase model, as A1). The Phase-4 `slow`/`SLOW_FIELD_EVERY` mechanism is reused unchanged for `mtemp` (as foreshadowed in the Phase-4 plan).

---

## Phase Map

Phase **5 of 6**. Done: Phase 1 (test/CI, `geo.js`), Phase 2 (A1 RPM fix + A2 wheel-speed, `calc.py`), Phase 3 (A5 CSP + de-inline handlers), Phase 4 (A3 battery telemetry). Next: Phase **6** = C1 — recording + in-app replay (largest JS feature; pure `replay.js` + `test/` unit tests, `rasicross.js`, HTML). C1's recorder will capture the full telemetry packet — which now includes `spd_src` (P2), `vbat`/`soc`/`batt_warn` (P4), and `gz`/`yaw`/`mtemp` (this phase) — so A4's "include … in recording" requirement is satisfied automatically when C1 lands.
