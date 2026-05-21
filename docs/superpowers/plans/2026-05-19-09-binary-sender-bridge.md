# Phase 9 (D1-β) — Sender Packs / Bridge Decodes Binary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Switch the kart→bridge radio leg from JSON to the 33-byte binary frame: `sender.py` serialises via `frame.pack`, `bridge.py` decodes via `frame.unpack` and emits **byte-identical** USB JSON — so the dashboard, recordings and replay are entirely unaffected.

**Architecture:** `ESPNowLink.send` calls `frame.pack(data, seq)` instead of `ujson.dumps`; the seq counter and retry/`tx_fail_run` logic are unchanged. The main loop drops the slow-cadence gating (binary is ~33 B ≪ 250 B → all fields every packet, per the D1 spec). `bridge.py` `_handle_packet` gains a binary branch *before* the JSON path: a frame (first byte `== FRAME_VER`, `len == SIZE`) is decoded and then enriched + printed exactly as today; a version/length error emits `bridge_error`; a `{`-leading message still takes the unchanged JSON path (grace during the flash window / rollback). Hard break on the radio leg, loud on mismatch — the spec's D1 trade-off.

**Tech Stack:** MicroPython `sender.py`/`bridge.py`, the pure `esp_libs/frame.py` from Phase α (no new deps). Dashboard untouched.

---

## Working Directory & Conventions

**Branch `feat/binary-protocol`** in `C:/Users/jimlu/Documents/RasiCross-Telemetrie-git`. **Requires Phase α committed on this branch** (`esp_libs/frame.py` + `test/test_frame.py` present — verify in Task 1 Step 1). Based on `docs/telemetry-improvements-spec` (Phases 1–6; no gear-ratio).

- CRLF: `Read` the target region in-session immediately before each `Edit`; anchor on text (line numbers indicative). Grep tool for verification. `git -C "…"`. Never `git add` `.claude/`; plan doc committed in the final task. `python`/`py -3`; delete `__pycache__` before `git status`.
- **Spec:** `docs/superpowers/specs/2026-05-19-binary-protocol-design.md` §4.3, §4.4, §5, §9.

**Behavioural invariant:** The USB/dashboard boundary is **byte-identical** to the JSON era (same keys/units/`seq`/`source`/`from_mac`/`rssi`; battery/`mtemp` keys present only when their flags are set — same as today's "absent ⇒ hidden/keep-last"). `rasicross.js` is **not** touched. Radio leg breaks intentionally; `FRAME_VER` makes a mismatched pair fail loud (`bridge_error`), never silently corrupt. Downlink (control) stays JSON and unchanged. CI: `npm test` `tests 22`; `unittest` `Ran 30 tests` (unchanged from Phase α — no test files touched here; ESP code is `py_compile` + hardware-checklist verified, project precedent).

**Locked decisions (spec):** uplink binary only; all fields every packet (slow-cadence removed); sender requires `frame.py` and fails loud if absent (no silent JSON fallback that would re-blow the 250 B budget); bridge keeps the JSON path for an un-updated sender / control echoes (first byte `{`); binary detected by `msg[0] == FRAME_VER and len == SIZE` (JSON starts with `{`=0x7B ≠ 1, no collision).

---

## File Structure

| Action | Path | Responsibility |
|--------|------|----------------|
| Modify | `sender.py` | Guarded `import frame`; `ESPNowLink.send` → `frame.pack`; main loop drops slow-cadence (all fields every packet). |
| Modify | `bridge.py` | `import frame`; `_handle_packet` binary-decode branch before the JSON path; `bridge_error` on frame error. |

**Task order:** T1 sender → T2 bridge → T3 verify/commit/push.

---

### Task 1: `sender.py` — pack binary

**Files:** Modify `sender.py`

- [ ] **Step 1: Verify prerequisite + read anchors**

Confirm Phase α is present: `ls esp_libs/frame.py test/test_frame.py` (both exist) and `python -m unittest discover -s test -p "test_*.py"` → `Ran 30 tests` `OK`. If absent, STOP — Phase α must land first.
Read in `sender.py`: the `try: import calc … _HAS_CALC = False` guard block; the `ESPNowLink.send` body (the `data["seq"] = self._seq` … `payload = ujson.dumps(data)` lines and the retry loop); and the main-loop packet block (`pkt_count += 1` … through `tx_ok = link.send(packet)`). Copy anchors from that fresh Read.

- [ ] **Step 2: Add the guarded `frame` import**

Edit `sender.py` — replace exactly:

```
try:
    import calc
    _HAS_CALC = True
except ImportError:
    _HAS_CALC = False
```

with:

```
try:
    import calc
    _HAS_CALC = True
except ImportError:
    _HAS_CALC = False

try:
    import frame
    _HAS_FRAME = True
except ImportError:
    _HAS_FRAME = False
```

- [ ] **Step 3: `ESPNowLink.send` packs the binary frame**

Edit `sender.py` — replace exactly:

```
        # Sequenznummer einbauen damit Bridge Paket-Verlust messen kann
        data["seq"] = self._seq
        self._seq = (self._seq + 1) & 0xFFFF
        payload = ujson.dumps(data)
```

with:

```
        # Sequenznummer kommt in den Binaer-Frame (Bridge misst Verlust)
        seq = self._seq
        self._seq = (self._seq + 1) & 0xFFFF
        if not _HAS_FRAME:
            log("link", "FATAL: frame.py fehlt auf dem Kart -- bitte flashen")
            self.tx_fail_run += 1
            return False
        payload = frame.pack(data, seq)
```

- [ ] **Step 4: Drop slow-cadence — all fields every packet**

Edit `sender.py` — replace exactly:

```
            # Batterie messen + Slow-Field-Kadenz (vbat/soc nur jedes
            # SLOW_FIELD_EVERY-te Paket; batt_warn jedes Paket).
            pkt_count += 1
            slow = (pkt_count % Config.SLOW_FIELD_EVERY == 0)
            if battery.active:
                battery.read()
```

with:

```
            # Binaer-Frame ist winzig (~33 B) -> keine Slow-Kadenz mehr:
            # alle Felder in jedem Paket (D1-Spec 4.3). pkt_count nicht
            # mehr noetig.
            if battery.active:
                battery.read()
```

Edit `sender.py` — replace exactly:

```
            if battery.active:
                packet["batt_warn"] = battery.warn          # 0|1|2, jedes Paket
                if slow:
                    packet["vbat"] = round(battery.vbat, 2)  # Pack-V, langsam
                    packet["soc"]  = battery.soc             # 0..100, langsam
            if slow:
                mt = imu.mpu_temp
                if mt is not None:
                    packet["mtemp"] = mt          # MPU-Chip-Temp (deg C), langsam
                # Byte-Budget-Kontrolle (< 250 B, siehe Spec §4). Nur
                # bei DEBUG/Topic 'link' sichtbar -> kein Funk-Overhead.
                log("link", "payload bytes:", len(ujson.dumps(packet)))
            tx_ok = link.send(packet)
```

with:

```
            if battery.active:
                packet["batt_warn"] = battery.warn          # 0|1|2
                packet["vbat"]      = round(battery.vbat, 2) # Pack-V
                packet["soc"]       = battery.soc            # 0..100
            mt = imu.mpu_temp
            if mt is not None:
                packet["mtemp"] = mt                          # MPU-Temp degC
            tx_ok = link.send(packet)
```

- [ ] **Step 5: Static verification**

Run: `python -m py_compile sender.py esp_libs/frame.py esp_libs/calc.py` (or `py -3 …`) → exit 0.
Run: `python -m unittest discover -s test -p "test_*.py"` → `Ran 30 tests` `OK` (unchanged; no test/dashboard touched).
Run (Grep tool) `sender.py`: `import frame` → 1; `_HAS_FRAME = True` → 1; `payload = frame\.pack\(data, seq\)` → 1; `if not _HAS_FRAME:` → 1; `data\["seq"\] = self\._seq` → **0** (old form gone); `ujson\.dumps\(data\)` → **0** (uplink no longer JSON; confirm no other use of that exact call in `ESPNowLink`); `if slow:` → **0**; `% Config\.SLOW_FIELD_EVERY` → **0**. Visually confirm (fresh Read) the retry loop / `tx_fail_run` and the core packet keys (`speed`…`imu_cal`) are unchanged, and `link.send(packet)` still called once.
Delete any `__pycache__`; `git status --short` shows only `sender.py` modified, no pyc.

- [ ] **Step 6: Commit**

```bash
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" add sender.py
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" commit -m "feat(sender): pack telemetry as binary frame (D1-beta)

ESPNowLink.send -> frame.pack(data, seq); seq/retry/tx_fail_run
unchanged. Slow-cadence removed (binary ~33 B): all fields every
packet. Fails loud if frame.py missing (no silent JSON fallback).

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 2: `bridge.py` — decode binary → identical JSON

**Files:** Modify `bridge.py`

- [ ] **Step 1: Read anchors**

Read in `bridge.py`: the top imports (`import espnow` / `import ujson` lines) and the `_handle_packet` JSON-parse block (the `try: data = ujson.loads(msg) except Exception: jprint({... "invalid_json" ...}) return` block, with the surrounding peer-learn above and the `rssi`/`source` enrichment below). Copy anchors from that fresh Read.

- [ ] **Step 2: Add the `frame` import**

Edit `bridge.py` — replace exactly:

```
import espnow
import ujson
```

with:

```
import espnow
import ujson
import frame
```

- [ ] **Step 3: Decode binary before the JSON path**

Edit `bridge.py` — replace exactly:

```
        # JSON parsen
        try:
            data = ujson.loads(msg)
        except Exception:
            jprint({
                "type": "bridge_error",
                "error": "invalid_json",
                "raw": str(msg)[:40],
            })
            return
```

with:

```
        # Binaer-Frame (D1)? Erstes Byte == FRAME_VER und exakte Laenge.
        # JSON beginnt immer mit '{' (0x7B != 1) -> keine Kollision.
        # Alter Sender / Steuer-Echo (JSON) bleibt weiter lesbar
        # (Flash-Fenster / Rollback-Gnade).
        if msg and msg[0] == frame.FRAME_VER and len(msg) == frame.SIZE:
            data = frame.unpack(msg)
            if "_err" in data:
                jprint({"type": "bridge_error",
                        "error": "frame_" + data["_err"]})
                return
        else:
            try:
                data = ujson.loads(msg)
            except Exception:
                jprint({
                    "type": "bridge_error",
                    "error": "invalid_json",
                    "raw": str(msg)[:40],
                })
                return
```

- [ ] **Step 4: Static verification**

Run: `python -m py_compile bridge.py esp_libs/frame.py` (or `py -3 …`) → exit 0.
Run: `python -m unittest discover -s test -p "test_*.py"` → `Ran 30 tests` `OK`.
Run (Grep tool) `bridge.py`: `^import frame` → 1; `msg\[0\] == frame\.FRAME_VER and len\(msg\) == frame\.SIZE` → 1; `data = frame\.unpack\(msg\)` → 1; `"error": "frame_" \+ data\["_err"\]` → 1; `data = ujson\.loads\(msg\)` → 1 (the retained JSON path). Visually confirm (fresh Read) the peer-learn block above and the `rssi`/`source`/`from_mac`/`jprint(data)` enrichment below are unchanged — so a decoded frame produces the identical JSON line as before.
Delete any `__pycache__`; `git status --short` shows only `bridge.py` modified, no pyc.

- [ ] **Step 5: Commit**

```bash
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" add bridge.py
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" commit -m "feat(bridge): decode binary frame -> identical USB JSON (D1-beta)

_handle_packet decodes a FRAME_VER/SIZE frame via frame.unpack and
enriches+prints it exactly as before (dashboard byte-identical).
Version/length error -> bridge_error. JSON path retained for an
un-updated sender / control echo.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 3: Verification, plan commit & push

**Files:** none (verification + push); commits this plan doc.

- [ ] **Step 1: Full local CI dry-run** (clone root; `py -3` if `python` absent):
```
node --check geo.js
node --check replay.js
node --check rasicross.js
node --check main.js
node --check preload.js
npm test
python -m py_compile sender.py bridge.py esp_libs/micropyGPS.py esp_libs/mpu6050.py esp_libs/oled_diagnose.py esp_libs/ssd1306.py esp_libs/calc.py esp_libs/frame.py
python -m unittest discover -s test -p "test_*.py" -v
```
Expected: all exit 0; `npm test` = `tests 22 | pass 22 | fail 0` (dashboard untouched); unittest = `Ran 30 tests` `OK` (unchanged from Phase α). Delete any `__pycache__`; `git status --short` shows no pyc (only the untracked plan doc until Step 2, plus `.claude/`).

- [ ] **Step 2: Backward-compat spot-check + commit the plan document**
- Grep `sender.py`: `frame.pack(data, seq)` present; `data["seq"] = self._seq`, `ujson.dumps(data)` in `ESPNowLink`, `if slow:`, `Config.SLOW_FIELD_EVERY` all **gone**; core packet keys unchanged. Grep `bridge.py`: binary branch present; JSON path retained; the `rssi`/`source`/`from_mac`/`jprint(data)` enrichment unchanged. `rasicross.js`/`geo.js`/`replay.js` not in `git status` (dashboard untouched ⇒ USB JSON identical).
```bash
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" add docs/superpowers/plans/2026-05-19-09-binary-sender-bridge.md
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" commit -m "docs: D1-beta sender/bridge binary lockstep plan

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

- [ ] **Step 3: Push**
```bash
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" push
```
Credentials cached — silent expected. Hang >30s ⇒ report BLOCKED (do not loop).

- [ ] **Step 4: Deferred to user (do NOT attempt here):** GitHub Actions `check` (no `gh`) and the hardware checklist below — **flash sender + bridge together** (lockstep).

---

## Hardware Acceptance Checklist (user-run, real ESP32 pair — not runtime-testable here)

1. Flash the updated `sender.py` **and** `bridge.py` **plus `esp_libs/frame.py` on both ESPs**, together.
2. Dashboard shows live telemetry **visually identical** to the JSON era: speed/rpm/gx/gy/gz/yaw/lat/lon/gps_fix/gps_health/pulse_hz/spd_src/imu_cal, plus battery (vbat/soc/batt_warn) when configured and `mtemp` when the IMU is OK; `seq`-based loss/`lost` stats still update.
3. Battery disabled and/or IMU absent ⇒ those keys are **absent** in the USB JSON exactly as before (flag-gated) — dashboard hides them / keeps last.
4. Mismatch test: flash only one side (or bump `FRAME_VER` on one) → dashboard shows `bridge_error: frame_bad_ver` (or `frame_bad_len`); no crash, no garbled values.
5. Frame size: with `DEBUG`/topic `link`, observed payload ≈ 33 B (≪ 250 B); range/loss no worse than JSON; LR mode, peer-learning, NVS kart-MAC, `bridge_hello`, downlink (display/config/pit_call/imu_calibrate) all behave as before.
6. Un-updated sender (still JSON) + updated bridge ⇒ telemetry still flows via the retained JSON path (flash-window grace), no `bridge_error` flood.

---

## Self-Review

**1. Spec coverage (§4.3, §4.4, §5, §9):**
- §4.3 `ESPNowLink.send` → `frame.pack(data, seq)`, seq/retry/`tx_fail_run` unchanged, slow-cadence branching removed (all fields every packet), downlink `recv()` untouched → Task 1 Steps 3–4. ✅
- §4.4 bridge binary branch (first byte `FRAME_VER` + `len==SIZE` → `frame.unpack`), `_err` → `bridge_error`, JSON path retained for `{`-leading, enrichment/`jprint` unchanged → Task 2 Step 3. ✅
- §5 USB JSON byte-identical (no dashboard change) → invariant + Task 3 Step 2 + checklist 2/3. ✅
- §9 risks: loud mismatch (`FRAME_VER` → `bridge_error`, checklist 4); no silent budget-blowing JSON fallback on the sender (fail loud if `frame.py` missing); shared `frame.py` (no drift); `unpack` never raises (`_err`) → Tasks 1–2 + checklist. ✅

**2. Placeholder scan:** No TBD/TODO; complete literal old/new blocks; every command has an expected result. ✅

**3. Type/name consistency:** `frame.FRAME_VER`/`frame.SIZE`/`frame.pack(data, seq)`/`frame.unpack(msg)` exactly match the Phase-α `frame.py` contract; `_HAS_FRAME` mirrors the established `_HAS_CALC` guard; `unpack` `_err` values (`bad_len`/`bad_ver`) → `bridge_error` `frame_bad_len`/`frame_bad_ver` consistent with α. Dashboard keys unchanged (α `unpack` emits exactly today's keys). ✅

**4. Notes:** `pkt_count`/`Config.SLOW_FIELD_EVERY` become unused after Task 1 Step 4 — harmless for `py_compile` (no removal needed; minimal diff on un-runtime-testable ESP code). `msg[0]` on `bytes` yields an int in MicroPython and CPython; JSON's leading `{` (0x7B) never equals `FRAME_VER` (1) so the discriminator is unambiguous. The retained JSON path keeps the system working if only one side is flashed (checklist 6) — this is graceful, not a silent protocol downgrade (an old sender still sends within-budget slow-cadence JSON).

---

## Phase Map / Branch & Sequencing

D1 Phase **β (9 of the set)** on `feat/binary-protocol`. Requires Phase α (`frame.py`). Next: **Phase 10 / D1-γ** — event-driven downlink + kart-side OLED clock (dashboard `structuralRaceKey` + anchor send; kart computes the running clock locally), authored against the then-current code. PR after the telemetry/gear-ratio branches land, or against `docs/telemetry-improvements-spec`. Independent of D2.
