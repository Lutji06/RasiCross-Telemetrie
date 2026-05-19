# Phase 8 (D1-α) — Pure Binary Frame Codec Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create the dependency-free `esp_libs/frame.py` codec (`pack`/`unpack`) for the 33-byte binary telemetry frame, fully TDD'd under CPython `unittest` — no `sender.py`/`bridge.py` wiring yet (that is Phase 9/D1-β).

**Architecture:** One import-free module using only `struct` (runs identically under MicroPython on the ESPs and CPython in CI), mirroring the `esp_libs/calc.py` pattern. `pack(d, seq)` saturating-encodes a telemetry dict + seq into exactly 33 bytes beginning with a version byte; `unpack(buf)` validates length+version and returns a dict whose keys/types/units exactly match what the dashboard already consumes (so Phase 9's bridge can emit byte-identical JSON). No exceptions escape — bad input saturates, bad buffers return an `_err` dict.

**Tech Stack:** Python stdlib `struct` + `unittest` (CPython for tests/CI, MicroPython on the kart+bridge ESP32). No new deps. No behaviour change anywhere yet — this phase only adds two files.

---

## Working Directory & Conventions

**All work happens in the git clone:** `C:/Users/jimlu/Documents/RasiCross-Telemetrie-git` on branch **`feat/binary-protocol`** (already checked out; based on `docs/telemetry-improvements-spec` tip `5cbad6b` = Phases 1–6; gear-ratio deliberately **not** present). Independent of `main` and the open PRs.

- Paths relative to clone root unless absolute. Files use **CRLF**; always `Read` the target region in-session immediately before an `Edit` and copy anchors from that fresh Read. New files created here use LF (git will normalise to CRLF — harmless, matches `calc.py`/`replay.js`).
- Git: `git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" …`. Use the Grep tool for verification. Untracked `.claude/` — **never** `git add` it. Plan doc committed only in the final task.
- Windows: `python` or fall back to `py -3`. Node v24 local; CI Node 20 / Python 3.12. Delete any `__pycache__` before a `git status` check.
- **Spec:** `docs/superpowers/specs/2026-05-19-binary-protocol-design.md` §4.1, §4.2, §6.

**Behavioural invariant:** This phase changes **no** runtime behaviour. It only adds `esp_libs/frame.py` and `test/test_frame.py`. `sender.py`/`bridge.py`/`rasicross.js` are untouched; the link stays JSON until Phase 9. CI stays green; `npm test` unchanged (`tests 22`); Python `unittest` rises from `Ran 17 tests` to `Ran 30 tests` (17 existing `test_calc.py` + 13 new `test_frame.py`).

**Locked decisions (spec):** `FRAME_VER = 1`; `FMT = "<BHHHhhhhiiHHHBbBB"`; `SIZE = 33`; all fields every packet (no slow cadence); enums `gps_health` 0=ok/1=searching/2=lost/3=disabled, `spd_src` 0=gps/1=wheel/2=none; flags gate battery (`batt_present`) and `mtemp` (`mtemp_valid`); saturating clamps; `unpack` never raises (returns `{"_err": …}`).

---

## File Structure

| Action | Path | Responsibility |
|--------|------|----------------|
| Create | `esp_libs/frame.py` | Pure codec: `FRAME_VER`, `FMT`, `SIZE`, `pack(d, seq)`, `unpack(buf)`. Import-free (`struct` only). |
| Create | `test/test_frame.py` | `unittest` suite (13 methods): round-trip, saturation, enums, flag-gating, bad version, bad length, seq wrap. |

**Task order:** T1 codec + tests (TDD) → T2 verify/commit/push.

---

### Task 1: `esp_libs/frame.py` + `test/test_frame.py` (TDD)

**Files:** Create `esp_libs/frame.py`, Create `test/test_frame.py`

- [ ] **Step 1: Write the failing tests**

Create `test/test_frame.py`:

```python
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'esp_libs'))
import frame  # noqa: E402


def _base():
    # A fully-populated telemetry dict (battery active + IMU temp present).
    return {
        "speed": 42.37, "rpm": 5123, "gx": 0.123, "gy": -1.987,
        "gz": 0.97, "yaw": -142.3, "lat": 49.6012345, "lon": 6.1198765,
        "gps_fix": 1, "gps_health": "ok", "pulse_hz": 318.4,
        "send_ms": 80, "spd_src": "gps", "imu_cal": 0,
        "batt_warn": 1, "vbat": 11.84, "soc": 73, "mtemp": 34,
    }


class FrameLayout(unittest.TestCase):
    def test_size_and_ver(self):
        self.assertEqual(frame.SIZE, 33)
        self.assertEqual(frame.FMT, "<BHHHhhhhiiHHHBbBB")
        self.assertEqual(frame.FRAME_VER, 1)
        b = frame.pack(_base(), 7)
        self.assertIsInstance(b, (bytes, bytearray))
        self.assertEqual(len(b), 33)
        self.assertEqual(b[0], frame.FRAME_VER)


class RoundTrip(unittest.TestCase):
    def test_nominal(self):
        d = _base()
        out = frame.unpack(frame.pack(d, 12345))
        self.assertNotIn("_err", out)
        self.assertEqual(out["seq"], 12345)
        self.assertAlmostEqual(out["speed"], 42.37, places=2)
        self.assertEqual(out["rpm"], 5123)
        self.assertAlmostEqual(out["gx"], 0.123, places=3)
        self.assertAlmostEqual(out["gy"], -1.987, places=3)
        self.assertAlmostEqual(out["gz"], 0.97, places=2)
        self.assertAlmostEqual(out["yaw"], -142.3, places=1)
        self.assertAlmostEqual(out["lat"], 49.6012345, places=6)
        self.assertAlmostEqual(out["lon"], 6.1198765, places=6)
        self.assertEqual(out["gps_fix"], 1)
        self.assertEqual(out["gps_health"], "ok")
        self.assertAlmostEqual(out["pulse_hz"], 318.4, places=1)
        self.assertEqual(out["send_ms"], 80)
        self.assertEqual(out["spd_src"], "gps")
        self.assertEqual(out["imu_cal"], 0)
        self.assertEqual(out["batt_warn"], 1)
        self.assertAlmostEqual(out["vbat"], 11.84, places=2)
        self.assertEqual(out["soc"], 73)
        self.assertEqual(out["mtemp"], 34)

    def test_negative_and_zero(self):
        d = _base()
        d.update(speed=0.0, rpm=0, gx=-0.001, yaw=0.0, lat=-0.0000001,
                 lon=-179.9999999, imu_cal=1, gps_fix=0)
        out = frame.unpack(frame.pack(d, 0))
        self.assertEqual(out["seq"], 0)
        self.assertEqual(out["speed"], 0.0)
        self.assertEqual(out["rpm"], 0)
        self.assertEqual(out["gps_fix"], 0)
        self.assertEqual(out["imu_cal"], 1)
        self.assertAlmostEqual(out["lon"], -179.9999999, places=6)


class Saturation(unittest.TestCase):
    def test_overflow_clamps_not_raises(self):
        d = _base()
        d.update(speed=99999.0, rpm=999999, gx=1000.0, yaw=99999.0,
                 pulse_hz=999999.0, vbat=9999.0, soc=250, mtemp=900)
        out = frame.unpack(frame.pack(d, 0))
        self.assertNotIn("_err", out)
        self.assertAlmostEqual(out["speed"], 655.35, places=2)   # u16/100
        self.assertEqual(out["rpm"], 65535)
        self.assertAlmostEqual(out["gx"], 32.767, places=3)      # i16/1000
        self.assertAlmostEqual(out["yaw"], 3276.7, places=1)
        self.assertAlmostEqual(out["vbat"], 655.35, places=2)
        self.assertEqual(out["soc"], 100)
        self.assertEqual(out["mtemp"], 127)

    def test_negative_underflow_clamps(self):
        d = _base()
        d.update(gx=-1000.0, yaw=-99999.0, mtemp=-900, speed=-5.0)
        out = frame.unpack(frame.pack(d, 0))
        self.assertAlmostEqual(out["gx"], -32.768, places=3)
        self.assertAlmostEqual(out["yaw"], -3276.8, places=1)
        self.assertEqual(out["mtemp"], -128)
        self.assertEqual(out["speed"], 0.0)                      # u16 floor


class Enums(unittest.TestCase):
    def test_gps_health_roundtrip(self):
        for name in ("ok", "searching", "lost", "disabled"):
            d = _base(); d["gps_health"] = name
            self.assertEqual(frame.unpack(frame.pack(d, 0))["gps_health"], name)

    def test_spd_src_roundtrip(self):
        for name in ("gps", "wheel", "none"):
            d = _base(); d["spd_src"] = name
            self.assertEqual(frame.unpack(frame.pack(d, 0))["spd_src"], name)

    def test_unknown_enum_falls_back(self):
        d = _base(); d["gps_health"] = "bogus"; d["spd_src"] = "???"
        out = frame.unpack(frame.pack(d, 0))
        self.assertEqual(out["gps_health"], "disabled")  # idx 3 fallback
        self.assertEqual(out["spd_src"], "none")          # idx 2 fallback


class FlagGating(unittest.TestCase):
    def test_battery_absent_omits_keys(self):
        d = _base()
        for k in ("batt_warn", "vbat", "soc"):
            d.pop(k)
        out = frame.unpack(frame.pack(d, 0))
        self.assertNotIn("vbat", out)
        self.assertNotIn("soc", out)
        self.assertNotIn("batt_warn", out)

    def test_mtemp_absent_omits_key(self):
        d = _base(); d.pop("mtemp")
        out = frame.unpack(frame.pack(d, 0))
        self.assertNotIn("mtemp", out)
        self.assertIn("vbat", out)  # battery still present


class Errors(unittest.TestCase):
    def test_bad_length(self):
        self.assertEqual(frame.unpack(b"")["_err"], "bad_len")
        self.assertEqual(frame.unpack(b"\x01" * 10)["_err"], "bad_len")
        self.assertEqual(frame.unpack(b"\x01" * 34)["_err"], "bad_len")
        self.assertEqual(frame.unpack(None)["_err"], "bad_len")

    def test_bad_version(self):
        good = bytearray(frame.pack(_base(), 1))
        good[0] = 0x99
        out = frame.unpack(bytes(good))
        self.assertEqual(out["_err"], "bad_ver")
        self.assertEqual(out["ver"], 0x99)

    def test_seq_wraps(self):
        out = frame.unpack(frame.pack(_base(), 70000))
        self.assertEqual(out["seq"], 70000 & 0xFFFF)


if __name__ == '__main__':
    unittest.main()
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `python -m unittest discover -s test -p "test_*.py" -v` (or `py -3 …`).
Expected: the `test_frame` cases **fail** — `ModuleNotFoundError: No module named 'frame'` (file not created). `test_calc.py`'s 17 still pass.

- [ ] **Step 3: Create `esp_libs/frame.py`**

Create `esp_libs/frame.py`:

```python
# ============================================================
#  RasiCross  --  frame.py  (pure binary telemetry codec)
# ============================================================
#  Keine Importe ausser struct -> laeuft identisch unter CPython
#  (Unit-Tests / CI) und MicroPython (Kart-ESP packt, Bridge-ESP
#  entpackt). Auf BEIDE ESPs flashen:
#    mpremote connect <port> cp esp_libs/frame.py :
#  33-Byte Little-Endian Frame, siehe Spec 2026-05-19 D1 4.2.
# ============================================================
import struct

FRAME_VER = 1
FMT = "<BHHHhhhhiiHHHBbBB"
SIZE = struct.calcsize(FMT)            # 33

_GPS_HEALTH = ("ok", "searching", "lost", "disabled")
_SPD_SRC = ("gps", "wheel", "none")


def _clamp(v, lo, hi):
    if v < lo:
        return lo
    if v > hi:
        return hi
    return v


def _i(x):
    # robustes int(round()) ohne Exceptions (NaN/None -> 0)
    try:
        x = float(x)
    except (TypeError, ValueError):
        return 0
    if not (x == x):                   # NaN
        return 0
    return int(round(x))


def pack(d, seq):
    """Telemetrie-dict + seq -> 33 Byte. Saettigt, wirft nie."""
    d = d or {}
    speed = _clamp(_i(_f(d.get("speed")) * 100.0), 0, 65535)
    rpm = _clamp(_i(d.get("rpm")), 0, 65535)
    gx = _clamp(_i(_f(d.get("gx")) * 1000.0), -32768, 32767)
    gy = _clamp(_i(_f(d.get("gy")) * 1000.0), -32768, 32767)
    gz = _clamp(_i(_f(d.get("gz")) * 1000.0), -32768, 32767)
    yaw = _clamp(_i(_f(d.get("yaw")) * 10.0), -32768, 32767)
    lat = _clamp(_i(_f(d.get("lat")) * 1e7), -2147483648, 2147483647)
    lon = _clamp(_i(_f(d.get("lon")) * 1e7), -2147483648, 2147483647)
    pulse = _clamp(_i(_f(d.get("pulse_hz")) * 10.0), 0, 65535)
    send_ms = _clamp(_i(d.get("send_ms")), 0, 65535)
    vbat = _clamp(_i(_f(d.get("vbat")) * 100.0), 0, 65535)
    soc = _clamp(_i(d.get("soc")), 0, 100)
    mtemp = _clamp(_i(d.get("mtemp")), -128, 127)

    try:
        gh = _GPS_HEALTH.index(d.get("gps_health"))
    except ValueError:
        gh = 3
    try:
        ss = _SPD_SRC.index(d.get("spd_src"))
    except ValueError:
        ss = 2
    bw = _clamp(_i(d.get("batt_warn")), 0, 3)
    flags1 = ((1 if d.get("gps_fix") else 0)
              | (gh << 1)
              | (ss << 3)
              | ((1 if d.get("imu_cal") else 0) << 5)
              | (bw << 6))
    batt_present = 1 if ("vbat" in d or "soc" in d or "batt_warn" in d) else 0
    mtemp_valid = 1 if ("mtemp" in d and d.get("mtemp") is not None) else 0
    flags2 = batt_present | (mtemp_valid << 1)

    return struct.pack(FMT, FRAME_VER, seq & 0xFFFF, speed, rpm,
                       gx, gy, gz, yaw, lat, lon, pulse, send_ms,
                       vbat, soc, mtemp, flags1, flags2)


def _f(x):
    try:
        x = float(x)
    except (TypeError, ValueError):
        return 0.0
    if not (x == x):                   # NaN
        return 0.0
    return x


def unpack(buf):
    """33 Byte -> Telemetrie-dict (Dashboard-kompatible Keys).
    Wirft nie; bei Fehler {'_err': 'bad_len'|'bad_ver', ...}."""
    try:
        n = len(buf)
    except TypeError:
        return {"_err": "bad_len"}
    if n != SIZE:
        return {"_err": "bad_len", "len": n}
    if buf[0] != FRAME_VER:
        return {"_err": "bad_ver", "ver": buf[0]}
    (_ver, seq, speed, rpm, gx, gy, gz, yaw, lat, lon, pulse,
     send_ms, vbat, soc, mtemp, flags1, flags2) = struct.unpack(FMT, buf)
    out = {
        "seq": seq,
        "speed": speed / 100.0,
        "rpm": rpm,
        "gx": gx / 1000.0,
        "gy": gy / 1000.0,
        "gz": gz / 1000.0,
        "yaw": yaw / 10.0,
        "lat": lat / 1e7,
        "lon": lon / 1e7,
        "gps_fix": flags1 & 1,
        "gps_health": _GPS_HEALTH[(flags1 >> 1) & 3],
        "pulse_hz": pulse / 10.0,
        "send_ms": send_ms,
        "spd_src": _SPD_SRC[min((flags1 >> 3) & 3, 2)],
        "imu_cal": (flags1 >> 5) & 1,
    }
    if flags2 & 1:                     # batt_present
        out["batt_warn"] = (flags1 >> 6) & 3
        out["vbat"] = vbat / 100.0
        out["soc"] = soc
    if flags2 & 2:                     # mtemp_valid
        out["mtemp"] = mtemp
    return out
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `python -m unittest discover -s test -p "test_*.py" -v` (or `py -3 …`).
Expected: `Ran 30 tests` `OK` (17 `test_calc` + 10 `test_frame`).
Run: `python -m py_compile esp_libs/frame.py` → exit 0.
Delete any `__pycache__`; `git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" status --short` shows only `esp_libs/frame.py` + `test/test_frame.py` untracked (plus untracked `.claude/` and the plan doc).

- [ ] **Step 5: Commit**

```bash
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" add esp_libs/frame.py test/test_frame.py
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" commit -m "feat(frame): pure 33-byte binary telemetry codec (D1-alpha)

pack/unpack with saturating clamps, enum+flag encoding, version
byte; never raises (unpack returns _err dict). Import-free (struct
only) -> MicroPython + CPython. 13 unittest cases. No wiring yet.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 2: Verification, plan commit & push

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
Expected: all exit 0; `npm test` = `tests 22 | pass 22 | fail 0` (unchanged — no JS touched); unittest = `Ran 30 tests` `OK`. Delete any `__pycache__`; `git status --short` shows no pyc (only the untracked plan doc until Step 2, plus `.claude/`).

- [ ] **Step 2: Grep + commit the plan document**
- Grep `esp_libs/frame.py`: `FRAME_VER = 1` → 1; `FMT = "<BHHHhhhhiiHHHBbBB"` → 1; `def pack\(d, seq\)` → 1; `def unpack\(buf\)` → 1. Confirm `sender.py`/`bridge.py`/`rasicross.js` are byte-unchanged (`git status` lists none of them).
```bash
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" add docs/superpowers/plans/2026-05-19-08-binary-frame.md
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" commit -m "docs: D1-alpha binary frame codec plan

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

- [ ] **Step 3: Push**
```bash
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" push -u origin feat/binary-protocol
```
Credentials cached this session — should be silent. If it hangs >30s, report BLOCKED (do not loop).

- [ ] **Step 4: Deferred to user (do NOT attempt here):** GitHub Actions `check` confirmation (no `gh`). No hardware step in D1-α (pure, fully tested here). Phase 9 (D1-β) is authored next, against the now-frozen `frame.py` API.

---

## Self-Review

**1. Spec coverage (§4.1, §4.2, §6):**
- `FRAME_VER`/`FMT`/`SIZE`(33), `pack(d,seq)`/`unpack(buf)`, saturating clamp, never-raise, `_err` dict, dashboard-compatible keys, enum+flag encoding incl. `batt_present`/`mtemp_valid` gating → Task 1 (impl + 10 tests). ✅
- §4.2 layout: format string `"<BHHHhhhhiiHHHBbBB"` = 17 fields, sizes 1+2+2+2+2+2+2+2+4+4+2+2+2+1+1+1+1 = 33 = `SIZE`; offsets/scales match the table (speed×100, g×1000, yaw×10, lat/lon×1e7, vbat×100). ✅
- §6 testing: round-trip, saturation (over+under), enum both-ways + fallback, flag gating (battery/mtemp absent), bad_ver, bad_len, seq wrap → all present (13 methods). ✅
- §8: this is Phase α only — no sender/bridge/dashboard change (invariant + Task 2 Step 2 grep). ✅

**2. Placeholder scan:** No TBD/TODO; complete code; every command has an expected result. ✅

**3. Type/name consistency:** `FRAME_VER`/`FMT`/`SIZE`/`pack`/`unpack` consistent between `frame.py` and `test_frame.py`; `pack` returns `bytes`, `unpack` returns dict with keys (`seq`,`speed`,`rpm`,`gx`,`gy`,`gz`,`yaw`,`lat`,`lon`,`gps_fix`,`gps_health`,`pulse_hz`,`send_ms`,`spd_src`,`imu_cal`, conditional `batt_warn`/`vbat`/`soc`/`mtemp`, or `_err`) — exactly the keys `bridge.py` will emit and the dashboard already parses. Helper order: `_clamp`/`_i` are defined before `pack`; `_f` is defined after `pack` but before `unpack` — both `pack` and `unpack` reference `_f`; in Python module-level functions resolve names at **call** time, not def time, so `pack` calling `_f` works (all defs execute at import before any call). ✅

**4. Notes:** `unpack` clamps `spd_src` index with `min(...,2)` so reserved bit-patterns can't `IndexError`; `gps_health` uses 2 bits (0–3, all valid). `_i`/`_f` swallow NaN/None → 0 (a sensor glitch can never break the link, per §9). Test count is deterministic: 13 new methods → `Ran 30 tests`.

---

## Phase Map / Branch & Sequencing

D1 = 3 phases on `feat/binary-protocol` (off `docs/telemetry-improvements-spec`, Phases 1–6; **no** gear-ratio — that is a separate branch and `gear_ratio` is downlink config, not in this uplink frame). **This is Phase α (8 of the D1 set).** Next: **Phase 9 / D1-β** — `sender.py` packs via `frame.pack`, `bridge.py` decodes via `frame.unpack` and emits byte-identical USB JSON (hardware-gated lockstep), authored against this now-frozen `frame.py` API. Then **Phase 10 / D1-γ** — event-driven downlink + kart-side OLED clock. Open the D1 PR after the telemetry/gear-ratio branches land, or against `docs/telemetry-improvements-spec`.
