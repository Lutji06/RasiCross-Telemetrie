# RasiCross — D1: Binary Uplink Protocol + Event-Driven Downlink

**Date:** 2026-05-19
**Status:** Approved (design); pending implementation plans
**Author:** Brainstorming session (Claude + user)

---

## 1. Purpose

Two coupled goals, both reducing ESP-NOW airtime / removing the 250-byte
pressure that motivated all the slow-cadence/rounding workarounds:

1. **Binary uplink (D1):** replace the JSON telemetry packet on the
   kart→bridge radio leg with a compact fixed binary frame (~33 B vs
   ~150–210 B JSON). Sender + bridge change in lockstep; the bridge decodes
   and emits the **identical JSON** over USB, so the dashboard is unchanged.
2. **Event-driven downlink:** the dashboard currently pushes the OLED
   `display` message every `displayUpdateMs` (default 500 ms) **uncondition­
   ally**, even when nothing changed. Send it only on a *structural* change
   plus a slow keepalive; the kart computes the running lap/remaining clock
   locally from a time anchor.

D1 is the spec-sanctioned next architectural step from
`2026-05-17-rasicross-telemetry-improvements-design.md` §3 (deferred D1:
"binary ESP-NOW protocol; sender+bridge firmware lockstep; breaking on the
radio leg only, dashboard unaffected"). D2 (multi-kart) remains out of scope.

## 2. Background / current state (grounding facts)

- **Uplink:** `sender.py` builds a JSON dict; `ESPNowLink.send` injects
  `data["seq"]` (u16 counter, wraps `& 0xFFFF`), `ujson.dumps`, then
  `self._esp.send(bridge_mac, payload, True)` with `Config.SEND_RETRY`
  retries; `tx_fail_run` counts consecutive failures. ~12.5 Hz. `bridge.py`
  `self.esp.recv()` → `ujson.loads` → adds `source` (+ sets `from_mac`/`rssi`
  from ESP-NOW recv metadata) → `print(ujson.dumps(...))` as a USB JSON line.
  Long-Range mode (`protocol=8`, `esp.config(rate=8)`), configurable channel,
  max TX power. The 250 B ESP-NOW cap forced the P4/P5 slow-cadence + rounding.
- **Telemetry fields today** (every packet): `speed`(1dp), `rpm`(int),
  `gx`/`gy`(3dp), `gz`(2dp), `yaw`(1dp), `lat`/`lon`(7dp), `gps_fix`(0/1),
  `gps_health`(`ok|searching|lost|disabled`), `pulse_hz`(1dp), `send_ms`(int),
  `spd_src`(`gps|wheel|none`), `imu_cal`(0/1); slow (every
  `SLOW_FIELD_EVERY`th, only if battery active / IMU ok): `batt_warn`(0/1/2,
  actually every packet when battery active), `vbat`(2dp), `soc`(int 0–100),
  `mtemp`(int °C). `seq` added by the link. The dashboard tolerates missing
  fields (keep-last / hidden).
- **Downlink:** dashboard `sendDisplayUpdate` runs on
  `setInterval(..., displayUpdateMs)` (default 500 ms) and **always** sends a
  `display` JSON message (race data for the kart OLED) regardless of change.
  `config`/`pit_call`/`imu_calibrate`/`set_kart_mac`/`request_status` are
  already event-driven. `bridge.py` `_forward_to_kart` relays
  `display|config|pit_call|imu_calibrate` via
  `esp.send(kart_host, ujson.dumps(data), False)`. `bridge_hello` is sent only
  when the kart has been quiet (`HELLO_QUIET_MS`). `sender.py` `recv()`
  `ujson.loads` dispatches downlink by `data["type"]`.
- **gear-ratio** (`feat/gear-ratio`) is a *downlink config* field, **not** a
  telemetry field — it is **not** part of the binary uplink frame and this
  work is independent of it. This branch (`feat/binary-protocol`) is based on
  `docs/telemetry-improvements-spec` (Phases 1–6), not on `feat/gear-ratio`.

### Confirmed decisions (from brainstorming)

- **Uplink binary only.** Downlink stays JSON but becomes event-driven.
- **Fixed binary struct, ALL fields every packet.** Binary is ~33 B ≪ 250 B,
  so the slow-cadence concept is **removed entirely**; `vbat`/`soc`/`mtemp`
  ride every packet. Dashboard keep-last still works (just always fresh).
- **Shared pure `esp_libs/frame.py` codec** (import-free, `struct`-based,
  runs under MicroPython *and* CPython) — TDD'd like `calc.py`; both
  `sender.py` (pack) and `bridge.py` (unpack) use it (no drift).
- **Hard break on the radio leg** (spec §3) with a **version byte** so a
  mismatched sender/bridge fails loudly (bridge emits `bridge_error`), never
  silently corrupt. Both ESPs must be flashed together.
- **Bridge reconstructs the identical USB JSON** → `rasicross.js` uplink path
  unchanged (zero dashboard change for D1).
- **Event-driven downlink + kart-side clock:** dashboard sends `display` on
  structural change + ~5 s keepalive; the message carries a time anchor; the
  kart OLED computes the live running clock from its own `utime`.
- **One spec, three numbered phase plans** (repo convention): α `frame.py` +
  tests, β sender/bridge lockstep, γ event-driven downlink + kart clock.

## 3. Scope

### In scope

| ID | Item | Surface |
|----|------|---------|
| D1-α | Pure `esp_libs/frame.py` codec (`pack`/`unpack`) + unit tests | `esp_libs/frame.py`, `test/test_frame.py` |
| D1-β | Sender emits binary; bridge decodes → identical JSON | `sender.py`, `bridge.py` |
| D1-γ | Event-driven downlink + kart-side OLED clock | `rasicross.js`, `sender.py` (+ OLED render), pure `structuralRaceKey` JS helper + `test/` |

### Out of scope

- Binary **downlink** (control messages stay JSON).
- D2 multi-kart; any change to the USB JSON-line protocol or dashboard
  telemetry parsing; Long-Range/peer-learning/`bridge_hello` mechanics.
- Removing existing telemetry semantics (battery hidden when absent, etc.) —
  preserved via frame flags + conditional JSON reconstruction.

## 4. Detailed design

### 4.1 `esp_libs/frame.py` — pure codec (D1-α)

Import-free module (same model as `calc.py`; flashed to the kart **and** the
bridge ESP). Public API:

- `FRAME_VER` — module constant (single byte). Bumped on any layout change.
- `FMT` — `struct` format string `"<BHHHhhhhiiHHHBbBB"` (little-endian, no
  padding), `SIZE = struct.calcsize(FMT)` (33 bytes).
- `pack(d, seq) -> bytes`: reads the telemetry dict `d` + the link's `seq`,
  scales/saturating-clamps each field to its integer domain, encodes enums &
  bit flags, returns exactly `SIZE` bytes beginning with `FRAME_VER`.
- `unpack(buf) -> dict`: validates `len(buf) == SIZE` and `buf[0] ==
  FRAME_VER`; on mismatch returns `{"_err": "bad_len"|"bad_ver", ...}` (never
  raises); otherwise returns a dict with the **same keys/types/units the
  dashboard already expects** (floats rescaled, enums as strings, flags as
  0/1), plus `seq`. Battery keys (`vbat`/`soc`/`batt_warn`) included only when
  the `batt_present` flag is set; `mtemp` only when `mtemp_valid` — preserving
  today's "absent ⇒ hidden/keep-last" dashboard behaviour.

Scaling/clamping is pure and total (no exceptions on out-of-range — saturate
to the type bound), so a sensor glitch can never crash the link.

### 4.2 Frame layout (33 bytes, little-endian)

| Off | Type | Field | Encoding (pack ⇄ unpack) |
|-----|------|-------|--------------------------|
| 0 | u8 | `ver` | constant `FRAME_VER` |
| 1 | u16 | `seq` | link counter, raw 0–65535 |
| 3 | u16 | `speed` | km/h × 100 (0–655.35) |
| 5 | u16 | `rpm` | raw 0–65535 |
| 7 | i16 | `gx` | g × 1000 (±32.767) |
| 9 | i16 | `gy` | g × 1000 |
| 11 | i16 | `gz` | g × 1000 |
| 13 | i16 | `yaw` | °/s × 10 (±3276.7) |
| 15 | i32 | `lat` | deg × 1e7 |
| 19 | i32 | `lon` | deg × 1e7 |
| 23 | u16 | `pulse_hz` | Hz × 10 (0–6553.5) |
| 25 | u16 | `send_ms` | raw ms |
| 27 | u16 | `vbat` | V × 100 (0–655.35) |
| 29 | u8 | `soc` | 0–100 |
| 30 | i8 | `mtemp` | °C (−128…127) |
| 31 | u8 | `flags1` | b0 `gps_fix`; b1–2 `gps_health` 0=ok/1=searching/2=lost/3=disabled; b3–4 `spd_src` 0=gps/1=wheel/2=none; b5 `imu_cal`; b6–7 `batt_warn` 0/1/2 |
| 32 | u8 | `flags2` | b0 `batt_present`; b1 `mtemp_valid`; b2–7 reserved (0) |

`from_mac`, `rssi`, `source` are **not** in the frame — the bridge adds them
to the JSON from its ESP-NOW recv metadata, exactly as today.

### 4.3 `sender.py` (D1-β)

`ESPNowLink.send` keeps owning the `seq` counter and the retry/`tx_fail_run`
logic; only the serialisation changes: `payload = frame.pack(data, self._seq)`
instead of `ujson.dumps`. The dict assembly in `main()` loses the slow-cadence
branching for `vbat`/`soc`/`mtemp` (now always provided to `pack`; the present
flags are derived from battery-active / IMU-ok state). Downlink `recv()` is
**unchanged** (still JSON). No change to Long-Range/peer/hello.

### 4.4 `bridge.py` (D1-β)

In the ESP-NOW receive path, if the first byte equals `frame.FRAME_VER` and
`len == frame.SIZE`, call `frame.unpack`, then build the **same JSON object**
the bridge emits today (same keys; add `source`/`from_mac`/`rssi`) and print
it — dashboard sees no difference. On `_err` (bad version/length) or a
first-byte that is neither `FRAME_VER` nor `{`: drop the frame and emit
`{"type":"bridge_error","error":"frame_version_mismatch"|"frame_bad_len"}`
(the dashboard already surfaces `bridge_error`). Downlink forwarding
(`_forward_to_kart`) and `bridge_hello`/heartbeat are unchanged.

### 4.5 Event-driven downlink + kart clock (D1-γ)

- **Dashboard (`rasicross.js`):** replace the unconditional
  `setInterval(sendDisplayUpdate, displayUpdateMs)` with change detection. A
  pure helper `structuralRaceKey(payload)` returns a stable string of only the
  *structural* fields (driver, num, lapn, target, sectors, best_lap,
  live_delta_ref, length_type, page, race status, pit) — **excluding** the
  continuously ticking values (`lap` string, `elapsed_ms`, `remaining_ms`,
  numeric live delta). Send `display` when the key changes **or** a keepalive
  interval (default ~5 s) elapses. The `display` message gains anchor fields:
  `running` (bool) and the at-send values `lap_ms`/`elapsed_ms`/
  `remaining_ms` (already present) plus an explicit `anchor: true` marker.
- **Kart (`sender.py` OLED render):** on receiving `display`, store the
  values + `utime.ticks_ms()` receipt tick. Each OLED refresh, if `running`,
  compute `live = base + ticks_diff(now, recv_tick)` for lap/elapsed and
  `remaining = max(0, base_remaining − elapsed_since)`; freeze when not
  `running`. The OLED clock stays smooth between (now rare) downlink packets.
- Downlink stays JSON; `bridge.py` forwards it unchanged (no bridge change for
  γ). The dashboard keeps evaluating `structuralRaceKey` on its existing
  internal tick (the `displayUpdateMs` interval, still persisted) but only
  **transmits** on a key change or when the fixed ~5 s keepalive elapses —
  i.e. `displayUpdateMs` no longer causes an unconditional RF send. The kart
  OLED refresh rate is local and independent of any of this.

## 5. Data / protocol changes

- **Radio leg (breaking, intended):** kart→bridge telemetry is a 33-byte
  binary frame instead of JSON. Versioned; mismatched firmware fails loudly.
- **USB / dashboard boundary (unchanged):** bridge emits the identical JSON
  line shape (same keys/units, `seq`, `source`, `from_mac`, `rssi`); battery/
  `mtemp` keys present only when their flags are set (matches today). Dashboard
  uplink parsing untouched.
- **Downlink:** still JSON; `display` is now change-triggered + keepalive and
  carries the time anchor. New optional field `anchor` is additive and
  ignored by anything that doesn't use it.
- No change to D2 deferral, Long-Range, channel, peer learning, `bridge_hello`.

## 6. Testing strategy

- **`frame.py`:** `test/test_frame.py` (`unittest`, mirrors `test_calc.py`) —
  full round-trip (`unpack(pack(d,seq))` ≈ `d` within each field's
  quantisation), scaling/saturation at and beyond every bound, enum & flag
  mapping (incl. `batt_present`/`mtemp_valid` gating), wrong `FRAME_VER`,
  truncated/oversized buffer ⇒ defined `_err` (never raises), `seq` wrap.
- **`structuralRaceKey`:** small pure JS helper in `geo.js`-style placement →
  `node:test` (key stable when only the clock ticks; changes on each
  structural field).
- **`sender.py`/`bridge.py`/OLED:** static review + `py_compile` +
  `node --check` + hardware checklist (no ESP/MPU here). The pure codec
  carries the correctness load; the wiring is conservative and lockstep.
- **CI:** `node --check`, `npm test`, `py_compile`, `python -m unittest` all
  green locally before/independently of GitHub Actions (no `gh` here).

### Hardware acceptance checklist (user-run, real ESP32 pair)

1. Flash **sender + bridge together**. Live telemetry flows; the dashboard is
   visually identical to JSON era (speed/rpm/g/gz/yaw/gps/battery/mtemp,
   `spd_src`, `gps_health`); `seq`-based loss stats still work.
2. Logged/observed frame size ≪ 250 B; range/loss no worse than JSON (LR
   unaffected); optionally a higher send rate is now possible (not required).
3. Version-mismatch test: flash only one side → bridge emits
   `bridge_error: frame_version_mismatch`, dashboard shows it, no crash/garble.
4. Battery disabled / IMU absent ⇒ those keys absent in the USB JSON exactly
   as before (flags gate them); old behaviour preserved.
5. Downlink: OLED race clock runs smoothly; `display` RF traffic visibly drops
   (only on structural change + ~5 s keepalive); pause/stop freezes the clock;
   driver/lap/sector/page changes reflect immediately.
6. No-kart / kart-quiet and reconnect behave as before (`bridge_hello`,
   peer learning, NVS kart-MAC unaffected).

## 7. Backward compatibility

- **Intended break** only on the radio leg (spec §3): sender & bridge are a
  matched pair; the version byte enforces this loudly. This is the explicit
  D1 trade-off.
- **No break** at the USB/dashboard boundary: identical JSON ⇒ old/new
  dashboard, recordings, replay, `localStorage` all unaffected.
- Downlink `display` `anchor` field is additive/optional. `config` (incl. a
  future `gear_ratio` from the other branch) and other control messages are
  untouched.

## 8. Sequencing (three numbered phase plans, repo convention)

1. **D1-α — `frame.py` + tests** (pure, local, fully TDD'd; zero hardware
   risk; ships independently green on CI).
2. **D1-β — sender/bridge lockstep binary** (the hardware-gated break;
   bridge reconstructs identical JSON; user flashes both, runs checklist 1–4).
3. **D1-γ — event-driven downlink + kart clock** (dashboard `structuralRaceKey`
   + anchor send; kart OLED local clock; checklist 5).

Each phase is independently shippable, ends green on `check`, and follows the
established conventions (per-task commits, full local CI dry-run, ESP hardware
checklist deferred to the user, plan doc committed + pushed). PR target after
the telemetry/gear-ratio branches land, or against
`docs/telemetry-improvements-spec`.

## 9. Risks & mitigations

| Risk | Mitigation |
|------|------------|
| Silent corruption from mismatched firmware | `FRAME_VER` byte; bridge drops + emits `bridge_error`; checklist 3. |
| Codec drift sender vs bridge | One shared pure `frame.py` used by both; TDD round-trip suite. |
| Field overflow/sensor glitch crashes link | Saturating clamps in `pack`; `unpack` never raises (`_err` dict). |
| Dashboard regression from changed wire format | Bridge reconstructs byte-identical JSON; uplink parsing untouched; checklist 1/4. |
| OLED clock drift/jump with rare downlink | Kart computes from local `utime` + anchor; ~5 s keepalive resync; checklist 5. |
| ESP code unverifiable here | Pure codec fully unit-tested; β/γ static-review + `py_compile` + user hardware checklist (project precedent). |
