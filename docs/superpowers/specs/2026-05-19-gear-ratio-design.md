# RasiCross — Configurable Drivetrain Gear Ratio (Übersetzung)

**Date:** 2026-05-19
**Status:** Approved (design); pending implementation plan
**Author:** Brainstorming session (Claude + user)

---

## 1. Purpose

The Hall sensor does not sit on the road wheel; there is a fixed gear/chain
reduction between the measured shaft and the wheel ("die Übersetzung ist nicht
1:1"). The wheel-speed fallback therefore over-reports speed. Add a single,
user-settable **gear ratio** (Übersetzung) so wheel speed is computed
correctly — configured from the dashboard exactly like the existing tyre
circumference (`Radumfang`/`wheel_circ_m`).

This spec is intentionally small and self-contained: one new config quantity,
one arithmetic correction, one dashboard input. It must not be expanded.

## 2. Background / current state

- `RPMCounter` counts Hall pulses; `rpm = (pulse_hz / ppr) * 60`. The user has
  confirmed this value **is and must remain the motor/shaft RPM** — it is shown
  unchanged in the dashboard. `pulse_hz` and `ppr` (`Config.PULSES_PER_REV`,
  live-settable via `apply_config` key `pulses_per_rev`) are unchanged.
- `esp_libs/calc.py` `wheel_speed_kmh(pulse_hz, ppr, circ_m)` currently does
  `rev_per_s = pulse_hz / ppr; return rev_per_s * circ_m * 3.6`. It treats
  `pulse_hz / ppr` as **wheel** rev/s — but with a non-1:1 drivetrain that
  quantity is the **shaft** rev/s, so the wheel speed is wrong by the ratio.
- The single caller in `sender.py` is `calc.wheel_speed_kmh(rpm_counter.pulse_hz,
  rpm_counter.ppr, Config.WHEEL_CIRC_M)`, used only when GPS is unavailable and
  `WHEEL_CIRC_M > 0` (the A2 wheel-speed fallback). `spd_src` logic unchanged.
- The dashboard "ESP32-Konfiguration" card has sibling inputs
  (`espMaxRpm`/`espWarnRpm`/`espSendMs`/`espPulses`/`espWheelCirc`/
  `espBattCells`). On "An ESP32 senden" (`espSendBtn`) a `{type:'config', …}`
  JSON line is sent over serial; `sender.py` `apply_config` consumes it. These
  ESP-config fields are **read on send only** and are **not** persisted to
  `localStorage` (they keep their HTML default on reload). `wheel_circ_m`
  follows exactly this pattern.

### Confirmed grounding facts / decisions (from brainstorming)

- Sensor is on a shaft before the reduction; displayed **RPM stays motor/shaft
  RPM** (no change). The ratio affects **only** the wheel-speed calculation.
- Ratio convention: **shaft revolutions per wheel revolution** (a reduction
  `n:1`, e.g. `6.3` ⇒ shaft spins 6.3× per wheel turn ⇒ wheel slower).
  `wheel_rev_s = (pulse_hz / ppr) / gear_ratio`.
- **Default `1.0`** everywhere ⇒ byte-for-byte identical to today's behaviour
  ⇒ fully backward-compatible (old firmware ↔ new dashboard and vice versa).
- Implemented as **chosen approach A**: a dedicated `gear_ratio` config field
  mirroring `wheel_circ_m` (not folded into `ppr`, which would corrupt the
  motor RPM the user wants preserved; not a teeth/teeth pair — user chose a
  single `n:1` value).
- Parity, not scope creep: the field is **not** persisted to `localStorage`
  because its sibling `wheel_circ_m` is not. Persisting ESP-config inputs is a
  separate, out-of-scope concern (could be a future, consistent change for the
  whole card if ever wanted).

## 3. Scope

### In scope

| Item | Surface |
|------|---------|
| New `Config.GEAR_RATIO` + `apply_config` key `gear_ratio` | `sender.py` |
| `wheel_speed_kmh` gains optional `gear_ratio` divisor + ≤0 guard | `esp_libs/calc.py` |
| Sender passes `Config.GEAR_RATIO` into the one `wheel_speed_kmh` call | `sender.py` |
| New "Übersetzung (Welle:Rad)" input in the ESP32-Konfig card; added to the `config` send object as `gear_ratio` | `RasiCross_Telemetry.html`, `rasicross.js` |
| Unit tests for the ratio (incl. default 1.0, ≤0 guard) | `test/` (Python) |

### Out of scope

- Any change to RPM, `pulse_hz`, `ppr`, `spd_src`, GPS speed, or telemetry
  packet fields.
- Persisting ESP-config card inputs to `localStorage` (no sibling does this).
- Teeth-based input, multiple ratios, or per-axle ratios (YAGNI).

## 4. Detailed design

### 4.1 `esp_libs/calc.py` (pure, unit-tested)

`wheel_speed_kmh(pulse_hz, ppr, circ_m, gear_ratio=1.0)`:

- `rev_per_s = pulse_hz / ppr` (shaft rev/s — unchanged).
- Effective ratio `g`: if `gear_ratio` is not a finite number `> 0`, treat as
  `1.0` (defensive: no divide-by-zero, no negative/garbage speed).
- `wheel_rev_s = rev_per_s / g`.
- `return wheel_rev_s * circ_m * 3.6`.
- Existing guards (`pulse_hz/ppr/circ_m > 0`) unchanged. The new parameter is
  **optional with default `1.0`**, so existing call sites and the existing
  Python unit tests (`Ran 17 tests`) stay green; new test cases cover a
  representative ratio, `gear_ratio=1.0` equivalence, and the `≤0`/garbage
  guard.

### 4.2 `sender.py`

- `class Config`: add `GEAR_RATIO = 1.0` near `WHEEL_CIRC_M` /
  `PULSES_PER_REV` (with a one-line comment: shaft turns per wheel turn).
- `apply_config(cfg, rpm_counter)`: add, mirroring the `wheel_circ_m` block
  (same `try/except`):
  `if "gear_ratio" in cfg: Config.GEAR_RATIO = max(0.0, float(cfg["gear_ratio"]))`
  (the `calc` ≤0 guard makes `0.0`/absurd values safe — they fall back to
  1.0 in the speed math rather than crashing).
- The single `calc.wheel_speed_kmh(...)` call passes `Config.GEAR_RATIO` as the
  fourth argument. Nothing else in the send path changes.

### 4.3 Dashboard (`RasiCross_Telemetry.html` + `rasicross.js`)

- HTML: one new `.field` in the same ESP32-Konfig `fieldset`, directly after
  the `Radumfang` input:
  `Übersetzung (Welle:Rad)` → `<input type="number" id="espGearRatio"
  value="1" min="0.01" step="0.01">`. `value="1"` is the no-op default
  (parity with `espWheelCirc value="0"` being its no-op default).
- `rasicross.js`: in the `espSendBtn` handler `cfg` object, add one line
  mirroring `wheel_circ_m`:
  `gear_ratio: Number($('espGearRatio').value) || 1,`
  (`|| 1` ⇒ blank/invalid sends the safe no-op default). No other dashboard
  change; no `state.settings`, no `saveData`, no `loadData` (parity with the
  sibling fields).

## 5. Data / protocol changes

The serial `config` message (dashboard → ESP only; never on the
kart→bridge→dashboard telemetry path) gains one optional key `gear_ratio`
(number, shaft rev per wheel rev). No telemetry JSON field is added, removed,
or renamed. Bridge unchanged. Absent `gear_ratio` ⇒ ESP keeps its current
`Config.GEAR_RATIO` (default `1.0`).

## 6. Testing strategy

- **`calc.py`**: TDD with the existing Python `unittest` suite — add cases:
  default (`gear_ratio` omitted) equals the pre-change result; a known ratio
  (e.g. shaft 6.3:1 halves/▼ the speed correctly); `gear_ratio=0`, negative,
  and non-numeric all behave as `1.0`. Existing 17 tests must stay green.
- **`sender.py` / dashboard**: static review + `py_compile` + `node --check`
  (ESP/DOM are not unit-tested here, per the project's established model).
- **CI**: `node --check`, `npm test`, `py_compile`, `python -m unittest` all
  green locally before/independently of GitHub Actions.

### Hardware acceptance checklist (user-run, real ESP32)

1. With `gear_ratio = 1.0` (default), wheel-speed fallback behaves exactly as
   before this change (regression).
2. Set the true drivetrain ratio from the dashboard ("An ESP32 senden"); lose
   GPS fix → reported speed now matches a reference (GPS-recovered speed or a
   measured ground speed) within tolerance; `spd_src` flips as before.
3. RPM display is unchanged (still motor/shaft RPM) at all ratios.
4. Absurd input (`0`, negative, blank) does not crash and does not produce
   negative/infinite speed (falls back to 1.0).

## 7. Backward compatibility

- Default `1.0` everywhere ⇒ no behavioural change until the user sets a ratio.
- Old firmware + new dashboard: unknown `gear_ratio` key ignored by old
  `apply_config` (speed stays as today). New firmware + old dashboard: no
  `gear_ratio` sent ⇒ `Config.GEAR_RATIO` stays `1.0`. No telemetry/protocol
  field changed; `localStorage` schema unchanged.

## 8. Sequencing

Single, self-contained change. Delivered as its own numbered phase plan
(`docs/superpowers/plans/…`) following the established phase conventions
(per-task commits, full local CI dry-run, ESP hardware checklist deferred to
the user, plan doc committed + pushed). Independent of the deferred D1/D2.
