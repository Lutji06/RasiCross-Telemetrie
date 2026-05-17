# RasiCross — Robustness, IMU/Battery Telemetry, Tests & In-App Replay

**Date:** 2026-05-17
**Status:** Approved (design); pending implementation plan
**Author:** Brainstorming session (Claude + user)

---

## 1. Purpose

Improve the RasiCross telemetry system with a batch of safe, additive
improvements plus the supporting test/CI infrastructure and a recording/replay
feature. This spec covers **Groups A + B + C** only.

Two larger, architectural changes were explicitly **deferred** to their own
future specs:

- **D1 — Binary ESP-NOW protocol** (sender+bridge firmware lockstep; breaking on
  the radio leg only, dashboard unaffected).
- **D2 — Multi-kart support** (cross-cutting rework of pairing, bridge state,
  dashboard data model).

This spec must not be expanded to include D1 or D2.

## 2. Background / current state

- `sender.py` (MicroPython, kart): sensors → ESP-NOW JSON to bridge.
- `bridge.py` (MicroPython, pit): ESP-NOW → JSON-lines over USB; also
  ESP-NOW→JSON translation means **the dashboard never sees raw radio bytes**.
- `rasicross.js` + `RasiCross_Telemetry.html`: single-file dashboard, loaded via
  `file://`, no bundler. Functions are top-level / attached to `window`.
- `main.js`/`preload.js`: Electron wrapper, only `serialport` IPC exposed.
- Telemetry is plain JSON parsed in `processTelemetry(d)`; **unknown fields are
  ignored and missing fields tolerated → new fields are backward-compatible.**

### Confirmed grounding facts

- `esp_libs/mpu6050.py` exposes only `accel` (ax/ay/**az**) and
  `temperature_c`. No gyro read exists. Sender currently sends ax/ay only.
- ESP-NOW payload hard limit is **250 bytes**; current telemetry JSON ≈ 150 B.
- `RasiCross_Telemetry.html` has **7 inline `onclick="window.x()"` handlers**
  (lines ~2799–2839), one external `<script src="rasicross.js">` (line ~2855),
  a `<style>` block, and pervasive inline `style=` attributes.
- I (the implementer) have **no ESP32 hardware**: all ESP-side code is written
  and statically reviewed but must be **flashed and verified by the user**.
- Project requires Node ≥ 18 (per README) → `node:test`/`node:assert` available
  with zero new dependencies.
- The working directory is **not a git repository** (it is an unpacked
  `RasiCross-Telemetrie-main` archive). Commits cannot be made unless the user
  initialises one.

## 3. Scope

### In scope

| ID | Item | Surface |
|----|------|---------|
| A1 | RPM IRQ race-condition fix | `sender.py` |
| A2 | Wheel-speed GPS fallback | `sender.py`, dashboard |
| A3 | Battery telemetry (LiPo/Li-ion) | `sender.py`, dashboard, kart OLED |
| A4 | IMU expansion (accel-Z + yaw rate + MPU temp) | `mpu6050.py`, `sender.py`, dashboard |
| A5 | Content-Security-Policy + de-inline handlers | `RasiCross_Telemetry.html`, `rasicross.js` |
| B1 | Unit tests for lap/geo/format logic | new `geo.js`, new `test/`, `rasicross.js`, HTML |
| B2 | CI check job | `.github/workflows/check.yml` |
| C1 | Recording + full in-app replay | `rasicross.js`, HTML |

### Out of scope (deferred)

- D1 binary ESP-NOW protocol.
- D2 multi-kart support.
- Electron auto-log / on-disk session library (recording Option 3) — purely
  additive on top of C1 later if desired.
- Any unrelated refactor of `rasicross.js` beyond the targeted `geo.js`
  extraction needed for B1.

## 4. Cross-cutting constraint: ESP-NOW byte budget

Adding `vbat, soc, batt_warn, gz, yaw, mtemp, spd_src` must keep the
worst-case packet < 250 B. (`vcell` is **not** transmitted — it is derived
dashboard-side from `vbat`/`BATT_CELLS`; see §5 A3.)

Mitigations (mandatory for every new field):

- **Aggressive rounding**: voltages 2 dp, `gz` 2 dp, `yaw` 1 dp, `mtemp` integer,
  `soc` integer.
- **Reduced cadence for slow fields**: `vbat`, `soc`, `mtemp` are included only
  every Nth telemetry packet (`Config.SLOW_FIELD_EVERY`, default 8 ≈ ~1 Hz at
  12.5 Hz base). When omitted, the dashboard keeps the last value.
- `spd_src` is a 3-char enum string.

Target: typical packet ≈ 160 B, worst-case (slow fields present) ≈ ≤ 210 B.
The implementation plan must include a step that measures real packet size
(log `len(payload)`) and the spec's hardware checklist verifies it stays
< 250 B. This pressure is the motivation for the deferred D1 binary protocol.

## 5. Detailed design

### A1 — RPM IRQ race fix (`sender.py`)

In `RPMCounter.update()` the sequence `cnt = self._count; self._count = 0` can
lose a pulse if the IRQ fires between the two statements (systematic
under-count at high RPM / high `PULSES_PER_REV`).

- Add `disable_irq, enable_irq` to the `from machine import …` line.
- Wrap only the read+reset in a critical section:
  ```python
  s = disable_irq()
  cnt = self._count
  self._count = 0
  enable_irq(s)
  ```
- No other behavioural change. Critical section is ~µs.

### A2 — Wheel-speed GPS fallback (`sender.py` + dashboard)

`Config.WHEEL_CIRC_M` is currently declared but unused; speed is GPS-only, so a
lost GPS fix reports 0 km/h while the wheel turns.

- Speed source priority each send cycle:
  1. GPS fix present → GPS km/h (unchanged).
  2. else `WHEEL_CIRC_M > 0` and pulse data present →
     `pulse_hz / ppr * WHEEL_CIRC_M * 3.6`.
  3. else `0.0`.
- New telemetry field `spd_src`: `"gps" | "wheel" | "none"`.
- `wheel_circ_m` added to live-config (`apply_config`) and one new dashboard
  config input (consistent with existing live-config pattern).
- Dashboard: small source indicator next to the speed value (e.g. `GPS`/`WHL`
  tag); if `spd_src` absent (old firmware), show nothing (backward-compat).

### A3 — Battery telemetry, LiPo/Li-ion (`sender.py` + dashboard + OLED)

New `Battery` class in `sender.py`.

Config (all in `class Config`):

| Key | Default | Meaning |
|-----|---------|---------|
| `BATT_ADC_PIN` | `None` | ADC1 pin (GPIO 32–39). `None` ⇒ feature disabled. ADC2 forbidden (WiFi/ESP-NOW conflict). |
| `BATT_DIVIDER` | `11.0` | External divider ratio (Vin/Vadc), e.g. 100 k / 10 k. |
| `BATT_CELLS` | `3` | Series cell count (for per-cell + SoC). |
| `BATT_CAL` | `1.0` | Fine calibration multiplier. |
| `BATT_CELL_WARN` | `3.5` | Per-cell warn threshold (V). |
| `BATT_CELL_CRIT` | `3.3` | Per-cell critical threshold (V). |
| `SLOW_FIELD_EVERY` | `8` | Shared slow-field cadence (see §4). |

Behaviour:

- ADC configured 11 dB attenuation (~0–3.3 V usable), average 16 samples.
- `vbat = adc_volts * BATT_DIVIDER * BATT_CAL`.
- `vcell = vbat / BATT_CELLS`.
- `soc` (0–100) from a fixed piecewise LiPo voltage→% curve on `vcell`
  (e.g. 4.20→100, 3.85→60, 3.70→35, 3.50→15, 3.30→0, clamped).
- `batt_warn`: `0` ok, `1` warn (`vcell ≤ WARN`), `2` critical
  (`vcell ≤ CRIT`).
- Fields `vbat`, `soc` are slow-cadence; `batt_warn` is sent every packet
  (latency-sensitive); `vcell` derived dashboard-side from `vbat`/cells (not
  sent) — only `vbat`, `soc`, `batt_warn` are transmitted.
- `BATT_ADC_PIN is None` ⇒ class is inert, no fields emitted.

Dashboard:

- Battery readout: pack V, per-cell V (computed), SoC %.
- Colour states: normal / amber (`batt_warn==1`) / red (`batt_warn==2`).
- On transition into warn/critical: existing `rcToast` + `rcAudio` cue
  (debounced, fires once per transition, not every packet).
- Missing fields (old firmware / disabled) ⇒ readout hidden.

Kart OLED: `page_diag` gains one line `BAT 11.8V` (only if data present;
keep within existing 128×64 layout — replace/condense an existing diag line if
space-constrained, decided during implementation against the real layout).

### A4 — IMU expansion (`esp_libs/mpu6050.py` + `sender.py` + dashboard)

`mpu6050.py` (additive only, `accel` untouched):

- Add `gyro` property: read 6 bytes from `GYRO_XOUT` (`0x43`), big-endian
  signed, scale ±250 °/s ⇒ `/ 131.0`, return `(gx, gy, gz)` in °/s.

`sender.py` `IMU`:

- Also expose `az` (g) and `yaw` = gyro-Z (°/s), `yaw` lightly smoothed with the
  existing `G_ALPHA`-style filter.
- `mpu_temp` from existing `temperature_c`, slow cadence.
- New fields: `gz` (2 dp, every packet), `yaw` (1 dp, every packet),
  `mtemp` (int °C, slow cadence).

Dashboard:

- `processTelemetry` reads `gz`, `yaw`, `mtemp` (default 0 / last value).
- Add a yaw-rate °/s numeric readout; include `gz`/`yaw` in the live charts and
  in recording. `mtemp` shown as a small secondary readout.
- All optional; absent ⇒ omitted/zero (backward-compat).

### A5 — CSP + de-inline handlers (`RasiCross_Telemetry.html` + `rasicross.js`)

- Give the 7 inline-handler buttons stable `id`s; remove the
  `onclick="window.x()"` attributes; wire equivalent `addEventListener` calls in
  `init()` in `rasicross.js`. Behaviour identical.
- Add to `<head>`:
  ```
  <meta http-equiv="Content-Security-Policy" content="
    default-src 'none';
    script-src 'self';
    style-src 'self' 'unsafe-inline';
    img-src 'self' data:;
    connect-src 'none';
    object-src 'none';
    base-uri 'none';
    form-action 'none'">
  ```
- `'unsafe-inline'` is retained **only** for styles (pervasive `style=` +
  `<style>` block; de-inlining all CSS is out of scope). Security value: locks
  scripts to same-origin files, forbids network/objects/base-uri/forms.
- Acceptance: app fully functional under CSP with **zero CSP violations** in
  devtools console (verified here in Electron + a Chromium browser).

### B1 — Unit tests (new `geo.js`, new `test/`)

- Create `geo.js`: dependency-free module containing the pure helpers
  `gpsDist`, `headingFromPoints`, `segmentsCross`, `crossingDirectionOk`,
  `lineEndpointsFromGate`, `traceDistanceM`, `fmtMs`, `fmtClock`, `fmtDelta`.
  UMD-style export: attaches to `window.RasiGeo` in browser **and**
  `module.exports` in Node.
- `RasiCross_Telemetry.html`: add `<script src="geo.js"></script>` **before**
  `rasicross.js`.
- `rasicross.js`: remove the moved definitions; call them via the `RasiGeo`
  namespace (or destructure once at top into local consts to minimise churn).
  This is a deliberate, scoped boundary improvement to the code under test —
  no other refactor.
- `test/geo.test.js`: `node:test` + `node:assert` cases covering, at minimum:
  great-circle distance (known coordinate pairs), heading quadrants, segment
  intersection (crossing / parallel / touching / disjoint), gate-crossing
  direction gating (correct vs. wrong direction), `lineEndpointsFromGate`
  geometry, trace distance accumulation, and time formatting edge cases
  (negative, zero, hours rollover, sub-second).
- `package.json`: add `"test": "node --test test/"`.
- TDD: where extraction reveals ambiguity, characterization tests first against
  current behaviour, then refactor.

### B2 — CI check job (`.github/workflows/check.yml`)

New workflow, triggers `push` and `pull_request`:

- `node --check` on `main.js`, `preload.js`, `rasicross.js`, `geo.js`.
- `npm ci` (or `npm install --no-audit`) + `npm test`.
- Set up Python 3, `python -m py_compile sender.py bridge.py esp_libs/*.py`
  (compile-only ⇒ MicroPython-only imports such as `network`, `espnow`,
  `machine` do **not** cause failure).

Existing tag-triggered `build.yml` is left untouched.

### C1 — Recording + full in-app replay (Option 1)

**Recording**

- Bounded in-memory ring buffer of raw inbound telemetry objects `d`, each
  stamped with `t_rel` (ms since first recorded packet) and the original
  receive wall-clock.
- Cap `REC_MAX = 150000` packets (~3 h @ 12.5 Hz). On overflow: drop oldest,
  emit a single `rcToast` warning (once per session, not per drop).
- Auto-arms on serial/demo connect; a settings toggle controls auto-arm.
- `bridge_status` / non-telemetry control lines are recorded too (so replay
  reproduces connection state), tagged by their existing `type`.
- Replay buffer and recording state are **never** persisted to `localStorage`.

**Save**

- "Save recording" → `.ndjson` Blob download:
  - line 1: header `{"rasicross_recording":1,"version":"9.6","created":<iso>,
    "count":<n>,"duration_ms":<ms>}`
  - subsequent lines: one recorded object per line, including `t_rel`.

**Load + replay**

- "Load recording" → `<input type=file>` → parse NDJSON → enter **Replay mode**.
- Transport UI (new panel/bar): Play/Pause, seek scrubber (by `t_rel`), speed
  selector `0.25× 0.5× 1× 2× 4× 8×`, elapsed/total readout, Exit.
- A virtual clock drives feeding: packets whose `t_rel ≤ virtualNow` are pushed
  through the **existing** `processTelemetry` + render path (no duplicate
  logic). Seeking resets derived state and fast-replays from the last sensible
  point (implementation: reset `state` slices touched by replay, then re-feed
  from 0 up to seek target at max speed — laps/sectors/track rebuild
  deterministically).
- While replaying: live serial and demo are disabled; `connectSerial` /
  `startDemo` guarded. Exiting replay restores prior live mode cleanly.
- Edge cases: empty/short recording, malformed lines (skip + count),
  non-monotonic `t_rel` (clamp), recording with old/missing fields (works via
  existing backward-compat).

## 6. Data / protocol changes

New optional telemetry JSON fields (kart → bridge → dashboard). All additive;
absence tolerated everywhere.

| Field | Type | Cadence | Rounding | Notes |
|-------|------|---------|----------|-------|
| `spd_src` | string | every | — | `gps`/`wheel`/`none` |
| `vbat` | number | slow | 2 dp | pack volts |
| `soc` | int | slow | int | 0–100 |
| `batt_warn` | int | every | — | 0/1/2 |
| `gz` | number | every | 2 dp | accel Z (g) |
| `yaw` | number | every | 1 dp | gyro Z (°/s) |
| `mtemp` | int | slow | int | MPU °C |

"slow" = every `SLOW_FIELD_EVERY`th packet (default 8). No field is removed or
renamed. Bridge passes JSON through unchanged (no bridge logic change needed).

## 7. Testing strategy

- **JS / dashboard / geo / replay clock**: TDD with `node:test`; fully verified
  by the implementer here.
- **CI**: verified by running the workflow logic locally (node --check, npm
  test, py_compile) before/independently of GitHub.
- **CSP**: verified here — load dashboard in Electron and a Chromium browser,
  confirm zero CSP console violations and full functionality.
- **ESP code (A1–A4, `mpu6050.py`)**: structured for clarity and statically
  reviewed; **hardware-validated by the user** per the checklist below. Not
  runtime-tested by the implementer.

### Hardware acceptance checklist (user-run, on real ESP32s)

1. Sender + bridge flashed; dashboard connects; live telemetry flows as before
   (regression: speed/rpm/gx/gy/gps unaffected).
2. A1: RPM reading stable and not under-reporting vs. expected at high RPM.
3. A2: cover GPS / lose fix → speed continues from wheel; `spd_src` flips
   `gps`→`wheel`→`none`; dashboard indicator matches.
4. A3 (if `BATT_ADC_PIN` set): `vbat` within ±0.1 V of a multimeter; SoC
   plausible; warn/critical toast+sound fire at thresholds; OLED shows `BAT`.
5. A4: `gz` ≈ 1 g static upright; `yaw` ≈ 0 static, swings sign on rotation;
   `mtemp` plausible.
6. Byte budget: logged `len(payload)` worst-case (slow fields present) < 250 B.
7. Range/loss not worse than before (LR-mode unaffected).

## 8. Sequencing

Independent; recommended order:

1. **B1 + B2** — tests/CI first (safety net, fully local).
2. **A1** — smallest ESP fix.
3. **A2** — speed fallback.
4. **A5** — CSP + de-inline.
5. **A3** — battery.
6. **A4** — IMU.
7. **C1** — recording/replay (largest JS feature).

Each ESP-touching step ends with: implementer static review + user hardware
sign-off against the relevant checklist item before the next ESP step.

## 9. Risks & mitigations

| Risk | Mitigation |
|------|------------|
| Packet exceeds 250 B | Slow-cadence + rounding (§4); measured + checklist item 6. |
| ESP code unverifiable by implementer | Conservative, additive changes; explicit hardware checklist; user sign-off gate. |
| `geo.js` extraction changes behaviour | Characterization tests before refactor; identical call signatures. |
| CSP breaks dashboard | De-inline handlers first; verify zero console violations in both runtimes. |
| Replay seek leaves stale derived state | Deterministic rebuild: reset replay-touched `state` slices, re-feed from 0 at max speed to seek point. |
| Recording memory growth | Hard cap 150 000 + drop-oldest + one-shot toast. |
| No git repo → cannot commit spec/plan | Inform user; offer `git init`; otherwise proceed without commits. |

## 10. Backward compatibility

- All new telemetry fields optional; old firmware ↔ new dashboard and new
  firmware ↔ old dashboard both work (unknown ignored, missing tolerated).
- Bridge unchanged. USB JSON-line protocol unchanged in shape.
- No removed/renamed fields. `localStorage` schema unchanged (replay/recording
  not persisted).
- Deferred D1/D2 remain fully compatible follow-ups.
