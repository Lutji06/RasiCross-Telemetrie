# Phase 28 — Multi-Kart Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run 2–4 karts simultaneously live on one bridge and one dashboard, each with a full per-kart pipeline (telemetry, charts, laps, drift, attitude, battery, calibration, engine, recording, race history), rendering the selected kart in the rich view and the others in a kart bar.

**Architecture:** Kart identity is the MAC — the kart firmware (`sender.py`, `frame.py`) is **unchanged and not reflashed**. `bridge.py` becomes multi-host (`karts{}` stats, MAC-list NVS, target-MAC downlink, `karts[]` status). The dashboard gains a pure `kart-registry.js` (MAC→kartState), partitions the global `state` so per-kart fields are **proxy getters** delegating to the active kart, and migrates the **write paths** (`processTelemetry`, `recordPacket`, lap/sector logic, calibration/engine, races) to an explicit `kartFor(mac)` reference. A new `kart-bar.js` renders chips + selection with render-throttling.

**Tech Stack:** MicroPython (ESP32, `bridge.py`), vanilla JS UMD modules + `node:test` (dashboard), Electron (serial bridge IPC), `python -m unittest` / `node --test` baselines.

**Spec:** `docs/superpowers/specs/2026-06-21-multi-kart-support-design.md`

---

## Working Directory & Conventions

- Repo root: `C:/Users/jimlu/Documents/RasiCross-Telemetrie-git`. All git via `git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" …`. Branch: `feat/multi-kart-support` (already created; the spec commit lives there).
- **Files are CRLF.** Immediately before any `Edit`, **Read the target region fresh in-session** and copy the anchor from that Read — line numbers in this plan are indicative, anchor on text.
- Use the **Grep tool** (not shell grep) for verification asserts.
- **Never `git add` `.claude/`** or this plan doc except the explicit plan-doc commit in the final task. Per-task commits otherwise.
- Commit messages: conventional + short body + trailer `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- Delete `__pycache__` before any `git status`/commit that could pick it up: `git -C "…" status` should never show pyc.
- **Verification recipe (per task where relevant + final):**
  - `node --check geo.js replay.js rasicross.js kart-registry.js kart-bar.js recording.js rec-store.js races.js live-ui.js pit-wall.js main.js preload.js` (only the files that exist/were touched)
  - `node --test` (auto-discovers `test/`)
  - `python -m py_compile bridge.py` (and `sender.py esp_libs/*.py` if touched — they are **not** touched here)
  - `python -m unittest discover -s test -p "test_*.py"`
  - Python may be `python` or `py -3`.
- **Baselines to keep green:** `node --test` = existing `geo` + `replay` suites **plus** the new `kart-registry` suite; `unittest` = `Ran 17 tests` `OK` (unchanged — no Python logic touched besides `bridge.py` which has no unittest).

## Locked decisions (from spec §3)

1. `MAX_KARTS = 4`. Over-cap MACs are ignored with a notice (bridge) / toast (dashboard).
2. Identity = MAC. **No** frame change. `sender.py`/`frame.py`/`calc.py` untouched.
3. Full per-kart pipeline (Approach A) via proxy facade; only the active kart renders heavy 3D/charts.
4. Kart bar (chips) + one rich full view for the selected kart.
5. Calibration is per-IMU, engine runtime is per-mower → per-kart state, persisted keyed by MAC.
6. Race history tagged per kart (`kartMac` on races/laps); per-kart `activeRaceId`. **No** cross-kart leaderboard this phase.
7. Backward compatible: single kart behaves exactly as today; legacy 9.6 saves migrate to a `"default"` bucket adopted by the first kart.

## File Structure

| Action | Path | Responsibility |
|--------|------|----------------|
| Create | `kart-registry.js` | Pure UMD: `makeKartState()`, registry `{mac→kartState}`, `MAX_KARTS` cap, forget/reset, active-MAC selection. Unit-tested. |
| Create | `test/kart-registry.test.js` | `node:test` suite for the registry. |
| Create | `kart-bar.js` | Kart chips (name/colour via localStorage, RSSI/Hz/age/batt/REC), selection, render-throttle helper. UMD/global. |
| Modify | `bridge.py` | `karts{}` per-MAC `Stats`, MAC-list `PeerStore`, `forget_kart_mac`/`reset_karts`, `target_mac` downlink, `karts[]` in `bridge_status`, OLED count. |
| Modify | `rasicross.js` | `state.karts`/`activeKartMac`, proxy getters, `kartFor()` write-path migration, per-kart cal/engine + 9.6 migration, per-kart `recordPacket`, central `bridgeSend()`. |
| Modify | `recording.js`, `rec-store.js` | Per-MAC recording buffers + per-kart save/export filename. |
| Modify | `races.js` | `kartMac` tag on races/laps, per-kart `activeRaceId`, kart filter. |
| Modify | `live-ui.js` | Mount kart bar, throttle heavy render to active kart. |
| Modify | `pit-wall.js`, `serial-demo.js` | Route downlink commands through `bridgeSend()` (adds `target_mac`). |
| Modify | `index.html` | `<script>` include for `kart-registry.js` (before `rasicross.js`) and `kart-bar.js`. |
| Unchanged | `sender.py`, `frame.py`, `calc.py`, `geo.js`, `replay.js` | No reflash; pure-logic modules untouched. |

**Task order:** 1 (registry, pure/TDD) → 2 (bridge multi-host) → 3 (state partition + proxy) → 4 (write-path migration) → 5 (central downlink target_mac) → 6 (per-kart cal/engine + migration) → 7 (kart bar + selection + throttle) → 8 (per-kart recording) → 9 (race kartMac tagging) → 10 (final verification + plan-doc commit).

---

## Task 1: `kart-registry.js` — pure registry (TDD)

**Files:**
- Create: `kart-registry.js`
- Test: `test/kart-registry.test.js`

- [ ] **Step 1: Write the failing test**

Create `test/kart-registry.test.js`:

```js
const { test } = require('node:test');
const assert = require('node:assert');
const KartRegistry = require('../kart-registry.js');

test('makeKartState returns independent fresh state', () => {
  const a = KartRegistry.makeKartState();
  const b = KartRegistry.makeKartState();
  a.max.speed = 50;
  assert.strictEqual(b.max.speed, 0);
  assert.deepStrictEqual(a.telemetry, { speed: 0, rpm: 0, gx: 0, gy: 0, lat: 0, lon: 0 });
  assert.deepStrictEqual(a.charts.speed, []);
  assert.strictEqual(a.calibration.swapG, false);
  assert.strictEqual(a.engine.serviceIntervalH, 10);
});

test('get() creates on first sight and auto-selects first as active', () => {
  const r = KartRegistry.create();
  assert.strictEqual(r.activeMac(), null);
  const k = r.get('aa');
  assert.ok(k);
  assert.strictEqual(r.activeMac(), 'aa');
  assert.strictEqual(r.get('aa'), k);          // same instance on re-get
  assert.deepStrictEqual(r.macs(), ['aa']);
});

test('get() caps at MAX_KARTS and returns null beyond', () => {
  const r = KartRegistry.create();
  assert.strictEqual(KartRegistry.MAX_KARTS, 4);
  ['a', 'b', 'c', 'd'].forEach(m => assert.ok(r.get(m)));
  assert.strictEqual(r.get('e'), null);        // over cap
  assert.strictEqual(r.macs().length, 4);
});

test('setActive only switches to a known mac', () => {
  const r = KartRegistry.create();
  r.get('a'); r.get('b');
  assert.strictEqual(r.setActive('b'), true);
  assert.strictEqual(r.activeMac(), 'b');
  assert.strictEqual(r.setActive('zzz'), false);
  assert.strictEqual(r.activeMac(), 'b');       // unchanged on unknown
});

test('active() returns the active kartState', () => {
  const r = KartRegistry.create();
  const a = r.get('a');
  assert.strictEqual(r.active(), a);
});

test('forget() drops a kart and re-points active if needed', () => {
  const r = KartRegistry.create();
  r.get('a'); r.get('b');
  r.setActive('a');
  assert.strictEqual(r.forget('a'), true);
  assert.deepStrictEqual(r.macs(), ['b']);
  assert.strictEqual(r.activeMac(), 'b');       // active re-pointed to remaining
  assert.strictEqual(r.forget('nope'), false);
});

test('reset() clears everything', () => {
  const r = KartRegistry.create();
  r.get('a'); r.get('b');
  r.reset();
  assert.deepStrictEqual(r.macs(), []);
  assert.strictEqual(r.activeMac(), null);
});

test('DEFAULT_MAC bucket is usable like any mac', () => {
  const r = KartRegistry.create();
  const k = r.get(KartRegistry.DEFAULT_MAC);
  assert.ok(k);
  assert.strictEqual(r.activeMac(), KartRegistry.DEFAULT_MAC);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/kart-registry.test.js`
Expected: FAIL — `Cannot find module '../kart-registry.js'`.

- [ ] **Step 3: Write `kart-registry.js`**

Create `kart-registry.js`:

```js
// ============================================================
//  RasiCross — kart-registry.js  (pure MAC→kartState registry)
// ============================================================
//  Dependency-free UMD: runs under CPython-less node:test (CI) and
//  in the browser as window.KartRegistry. No DOM, no globals.
//  Holds the per-kart runtime+persisted state; rasicross.js wires
//  the active kart into the render path via proxy getters.
// ============================================================
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.KartRegistry = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var MAX_KARTS = 4;
  var DEFAULT_MAC = 'default';

  function makeKartState() {
    return {
      connection: { source: 'offline', packets: 0, lost: 0, rssi: null,
                    lastPacketAt: null, seq: null, errors: 0, degraded: false },
      telemetry: { speed: 0, rpm: 0, gx: 0, gy: 0, lat: 0, lon: 0 },
      raw: { speed: 0, rpm: 0, gx: 0, gy: 0, lat: 0, lon: 0 },
      display: { speedLerp: 0, rpmLerp: 0, gxLerp: 0, gyLerp: 0 },
      gps: { fix: false, lastAt: null },
      spdSrc: 'gps',
      batt: { present: false, vbat: 0, soc: 0, warn: 0, cells: 3, _lastWarn: 0 },
      max: { speed: 0, rpm: 0, g: 0 },
      charts: { speed: [], rpm: [], gx: [], gy: [], gz: [], yaw: [], driftIndex: [] },
      imu: { yaw: 0, mtemp: null },
      drift: { status: 'n/a', index: null },
      attitude: { rollDeg: 0, over: false, overState: { active: false } },
      driftSmooth: { idxEma: null, status: 'n/a', counterRun: 0 },
      heatmap: { on: false, lapMaxSpeed: 0 },
      lapStart: null,
      currentLapMax: { speed: 0, rpm: 0 },
      currentLapTrace: [],
      bestLapTrace: null, bestLapMs: null, bestLapNum: null, liveDelta: null,
      autoLap: { prevLat: null, prevLon: null, lastTriggerAt: 0 },
      sectorsLive: { cur: 0, sectorStart: null, lapSectors: [null, null, null], lastLapSectors: null },
      recording: { armed: false, buf: [], startWall: null, overflowed: false },
      replay: { active: false, packets: [], idx: 0, virtualMs: 0, durationMs: 0,
                speed: 1, playing: false, raf: null, lastWall: null, snapshot: null },
      calibration: { gxZero: 0, gyZero: 0, swapG: false, invertGx: false,
                     invertGy: false, invertYaw: false, invertRollRate: false, rollZero: 0 },
      engine: { totalMs: 0, lastServiceMs: 0, serviceIntervalH: 10, lastAt: null,
                _unsavedMs: 0, _warned: false },
      activeRaceId: null,
      name: null, color: null,
      _attLastMs: 0,
    };
  }

  function create() {
    var karts = {};
    var orderList = [];
    var activeMac = null;

    function has(mac) { return Object.prototype.hasOwnProperty.call(karts, mac); }

    function get(mac) {
      if (has(mac)) return karts[mac];
      if (orderList.length >= MAX_KARTS) return null;
      var k = makeKartState();
      karts[mac] = k;
      orderList.push(mac);
      if (activeMac === null) activeMac = mac;
      return k;
    }

    function setActive(mac) {
      if (!has(mac)) return false;
      activeMac = mac;
      return true;
    }

    function active() { return activeMac === null ? null : karts[activeMac]; }

    function forget(mac) {
      if (!has(mac)) return false;
      delete karts[mac];
      orderList = orderList.filter(function (m) { return m !== mac; });
      if (activeMac === mac) activeMac = orderList.length ? orderList[0] : null;
      return true;
    }

    function reset() { karts = {}; orderList = []; activeMac = null; }

    return {
      get: get,
      has: has,
      setActive: setActive,
      activeMac: function () { return activeMac; },
      active: active,
      forget: forget,
      reset: reset,
      macs: function () { return orderList.slice(); },
    };
  }

  return {
    MAX_KARTS: MAX_KARTS,
    DEFAULT_MAC: DEFAULT_MAC,
    makeKartState: makeKartState,
    create: create,
  };
}));
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test test/kart-registry.test.js`
Expected: PASS (8 tests). Then `node --test` (full suite) — geo + replay + kart-registry all green.

- [ ] **Step 5: Commit**

```bash
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" add kart-registry.js test/kart-registry.test.js
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" commit -m "feat(multikart): pure kart-registry (MAC→kartState, cap, forget/reset)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: `bridge.py` — multi-host

**Files:**
- Modify: `bridge.py` (`PeerStore`, `Stats` ownership, init `~407-431`, `_handle_packet`/`on_packet` routing, USB dispatch `~609-646`, `_forward_to_kart` `~648-673`, `_send_status` `~684-699`, OLED `update()` call site).

### Task 2a: `PeerStore` stores a MAC list

- [ ] **Step 1:** Read `bridge.py` lines ~99–135 fresh. Replace the single-blob `load`/`save` with list semantics (store up to `MAX_KARTS` MACs concatenated as a 6·N blob).

Replace the `KEY = "kart_mac"` body so `load()` returns a `list[bytes]` and add `save_list`/`remove`/`clear`:

```python
class PeerStore:
    """Speichert die bekannten Kart-MACs im ESP32-NVS (Liste, <= MAX_KARTS),
    sodass die Bridge nach einem Reboot ohne Neulernen direkt senden kann."""

    NAMESPACE = "rasicross"
    KEY       = "kart_macs"          # neue Liste; alter Single-Key wird migriert
    LEGACY_KEY = "kart_mac"

    def __init__(self):
        self._nvs = None
        if not _HAS_NVS:
            return
        try:
            self._nvs = esp32.NVS(self.NAMESPACE)
        except Exception as e:
            print("[init] NVS init fehler:", e)
            self._nvs = None

    def load(self):
        """-> list[bytes] (6-Byte MACs). Migriert alten Single-Key einmalig."""
        if not self._nvs:
            return []
        macs = []
        try:
            buf = bytearray(6 * Config.MAX_KARTS)
            n = self._nvs.get_blob(self.KEY, buf)
            for i in range(0, n - (n % 6), 6):
                macs.append(bytes(buf[i:i + 6]))
        except Exception:
            pass
        if not macs:                              # Migration: alter Single-Slot
            try:
                lbuf = bytearray(6)
                if self._nvs.get_blob(self.LEGACY_KEY, lbuf) == 6:
                    macs.append(bytes(lbuf))
            except Exception:
                pass
        return macs

    def save_list(self, mac_list):
        if not self._nvs:
            return
        try:
            blob = b"".join(m for m in mac_list if m and len(m) == 6)[:6 * Config.MAX_KARTS]
            self._nvs.set_blob(self.KEY, blob if blob else b"")
            self._nvs.commit()
        except Exception as e:
            print("[init] NVS save fehler:", e)
```

- [ ] **Step 2: Verify** with the Grep tool: `class PeerStore` body contains `KEY       = "kart_macs"` and `def save_list`. Run `python -m py_compile bridge.py` → no error.

### Task 2b: `Config.MAX_KARTS` + per-MAC `karts` dict

- [ ] **Step 3:** Read the `Config` block (`~80-130`, contains `HELLO_QUIET_MS`). Add `MAX_KARTS = 4` near the radio settings.

```python
    MAX_KARTS         = 4       # max gleichzeitig verwaltete Karts (Multi-Kart)
```

- [ ] **Step 4:** Read init `~407-423`. Replace single-host state with a `karts` dict and load the MAC list:

```python
        # State
        self.karts        = {}    # {mac_bytes: Stats} — Multi-Kart
        self.kart_host    = None  # zuletzt gehoerte MAC (Legacy-Felder/Display)
        self.known_peers  = set()
        self.last_hb_ms   = utime.ticks_ms()
        self.last_hello_ms = 0
        self.last_usb_at  = 0
        self.usb_errors   = 0

        # Persistente Peer-Liste: bekannte Kart-MACs ueberleben Reboot
        self.peer_store = PeerStore()
        for saved_mac in self.peer_store.load():
            self.karts[saved_mac] = Stats()
            self.kart_host = saved_mac
            self._add_peer(saved_mac)
            print("[init] Kart-MAC aus NVS geladen:",
                  ubinascii.hexlify(saved_mac, ":").decode())
```

Note: the old `self.stats = Stats()` line (just above, `~408`) is **removed** — stats are now per-MAC. Anywhere `self.stats` was referenced must move to per-MAC (next steps) or to an aggregate. Add a helper right after init:

```python
    def _stats_for(self, mac):
        st = self.karts.get(mac)
        if st is None:
            if len(self.karts) >= Config.MAX_KARTS:
                return None
            st = Stats()
            self.karts[mac] = st
        return st
```

- [ ] **Step 5: Verify:** Grep `bridge.py` for `self.stats` — every remaining hit must be intentional. Replace `self.stats.*` references (in `_handle_packet`, OLED `update`, `_send_status`) per the next sub-tasks. `python -m py_compile bridge.py`.

### Task 2c: route incoming packets per MAC + `karts[]` status

- [ ] **Step 6:** Read `_handle_packet` (`~509-565`). Where it currently does `self.stats.on_packet(data)` (`~565`) and learns the host, route to per-MAC stats and persist the MAC list:

```python
        if host:
            self._add_peer(host)
            if host not in self.karts and len(self.karts) < Config.MAX_KARTS:
                self.karts[host] = Stats()
                self.peer_store.save_list(list(self.karts.keys()))
            self.kart_host = host          # zuletzt gehoert (Legacy/Display)
        st = self._stats_for(host) if host else None
        if st is None:
            jprint({"type": "bridge_info", "info": "kart_limit",
                    "max": Config.MAX_KARTS})
            return
        st.on_packet(data)
```

(Adjust the surrounding lines so the existing RSSI lookup writes into `data["rssi"]` as before, and the per-MAC `st` is used instead of `self.stats`.)

- [ ] **Step 7:** Read `_send_status` (`~684-699`). Emit a `karts[]` array; keep legacy scalars from the most-recent host:

```python
    def _send_status(self):
        mac = ubinascii.hexlify(self.wlan.config("mac"), ":").decode()
        karts = []
        agg_rx = 0
        for m, st in self.karts.items():
            agg_rx += st.rx_count
            karts.append({
                "mac":      ubinascii.hexlify(m, ":").decode(),
                "rate_hz":  st.packets_per_sec,
                "rssi":     st.last_rssi,
                "lost":     st.lost,
                "last_seq": st.last_seq,
                "age":      st.packet_age_ms,
            })
        host = self.kart_host
        host_st = self.karts.get(host) if host else None
        jprint({
            "type":      "bridge_status",
            "bridge":    "alive",
            "mac":       mac,
            "channel":   Config.ESPNOW_CHANNEL,
            "rx_count":  agg_rx,
            "lost":      host_st.lost if host_st else 0,
            "last_seq":  host_st.last_seq if host_st else None,
            "kart_mac":  ubinascii.hexlify(host, ":").decode() if host else None,
            "rate_hz":   host_st.packets_per_sec if host_st else 0,
            "karts":     karts,
            "usb_errors": self.usb_errors,
        })
```

- [ ] **Step 8:** Read the main loop where `self.stats.tick()` and `self.display.update(self.stats, …)` are called (Grep `\.tick\(\)` and `display.update`). Tick every kart and pass an aggregate/most-recent stats + kart count to the OLED:

```python
        for st in self.karts.values():
            st.tick()
        host_st = self.karts.get(self.kart_host)
        self.display.update(host_st, self.kart_host, len(self.karts), usb_connected)
```

And update `BridgeDisplay.update` signature `def update(self, stats, kart_mac, kart_count, usb_connected):` — guard `if not stats: return` early, and in the header draw `o.text("x{}".format(kart_count), 40, 0, 1)` near the `CH{}` label.

- [ ] **Step 9: Verify:** `python -m py_compile bridge.py`. Grep `bridge.py` for `self.stats` → **zero** remaining hits. Grep for `"karts"` → present in `_send_status`.

### Task 2d: USB commands — target-MAC downlink + forget/reset

- [ ] **Step 10:** Read USB dispatch (`~609-646`) and `_forward_to_kart` (`~648-673`). Make `set_kart_mac` additive, add `forget_kart_mac`/`reset_karts`, and route `_forward_to_kart` by `target_mac`:

In the dispatch, after the `set_kart_mac` block, add:

```python
        if t == "forget_kart_mac":
            mac_str = data.get("mac", "")
            try:
                clean = mac_str.replace(":", "").replace("-", "")
                if len(clean) == 12:
                    mb = bytes.fromhex(clean)
                    self.karts.pop(mb, None)
                    try: self.esp.del_peer(mb)
                    except Exception: pass
                    self.known_peers.discard(mb)
                    if self.kart_host == mb:
                        self.kart_host = next(iter(self.karts), None)
                    self.peer_store.save_list(list(self.karts.keys()))
                    jprint({"type": "bridge_info", "info": "kart_forgotten", "mac": mac_str})
            except Exception as e:
                jprint({"type": "bridge_error", "error": "forget_failed", "detail": str(e)})
            return

        if t == "reset_karts":
            for mb in list(self.karts.keys()):
                try: self.esp.del_peer(mb)
                except Exception: pass
            self.karts.clear()
            self.known_peers.clear()
            self.kart_host = None
            self.peer_store.save_list([])
            jprint({"type": "bridge_info", "info": "karts_reset"})
            return
```

Change `set_kart_mac` so it does **not** clobber: replace `self.kart_host = mac_bytes` with additive registration:

```python
                    if mac_bytes not in self.karts and len(self.karts) < Config.MAX_KARTS:
                        self.karts[mac_bytes] = Stats()
                    self.kart_host = mac_bytes
                    self._add_peer(mac_bytes)
                    self.peer_store.save_list(list(self.karts.keys()))
```

Rewrite `_forward_to_kart` to target a MAC:

```python
    def _forward_to_kart(self, kind, data, raw=None):
        target = None
        tm = data.get("target_mac")
        if tm:
            try:
                clean = tm.replace(":", "").replace("-", "")
                if len(clean) == 12:
                    target = bytes.fromhex(clean)
            except Exception:
                target = None
        if target is None:
            target = self.kart_host           # Fallback: zuletzt gehoerter Kart
        if not target:
            jprint({"type": "bridge_error", "error": "no_target", "kind": kind})
            return
        payload = raw if raw is not None else ujson.dumps(data)
        if len(payload) > 250:
            jprint({"type": "bridge_error", "error": "payload_too_long",
                    "kind": kind, "bytes": len(payload)})
            return
        try:
            self.esp.send(target, payload, False)
            if kind == "pit_call":
                action = data.get("action", "trigger")
                if action == "cancel":
                    self.display.show_message("PIT-CALL", "abgebrochen", 1500)
                else:
                    msg = data.get("message", "PIT STOP")[:14]
                    self.display.show_message("PIT-CALL TX", msg, 3000)
        except Exception as e:
            jprint({"type": "bridge_error", "error": "send_failed", "detail": str(e)})
```

Note: `target_mac` is a routing-only field. The raw line passed to `esp.send` still contains it, but the kart firmware ignores unknown keys (additive/backward-compatible) — verify the raw payload incl. `target_mac` stays ≤ 250 B (the 250-B guard already enforces this).

- [ ] **Step 11: Verify:** `python -m py_compile bridge.py`. Grep `bridge.py` for `target_mac`, `forget_kart_mac`, `reset_karts`, `save_list` → all present.

- [ ] **Step 12: Commit**

```bash
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" add bridge.py
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" commit -m "feat(multikart): bridge multi-host (karts{} stats, MAC-list NVS, target-MAC downlink, karts[] status)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: `rasicross.js` — state partition + proxy facade

**Files:**
- Modify: `index.html` (script include), `rasicross.js` (`state` def `~38-96`, new facade block right after).

- [ ] **Step 1:** Read `index.html` around the `<script src="rasicross.js">` / `replay.js` includes. Add **before** `rasicross.js`:

```html
    <script src="kart-registry.js"></script>
```

- [ ] **Step 2:** Read `rasicross.js:38-96`. **Remove** the per-kart fields from the `const state = {…}` literal (keep only the global/shared fields) and add the registry handle + active pointer. The literal becomes:

```js
const state = {
  // Session
  sessionStart: Date.now(),
  hz: 0,
  _lastHz: 0,
  // Multi-Kart
  karts: KartRegistry.create(),
  activeKartMac: null,
  kartMeta: {},   // {mac: {name, color}} — gespiegelt aus localStorage
  // Settings (global/shared)
  serial: { connected: false, port: null, baud: 115200, portName: '--', autoReconnect: true, reconnectTimer: null, reconnectAttempts: 0, lastPath: null },
  demo: { running: false, interval: null, raf: null, t: 0, angle: -Math.PI/2, lapsDone: 0 },
  settings: { maxSpeed: 80, maxRpm: 10000, rpmWarning: 9000, gScale: 3, minLapSeconds: 10, displayUpdateMs: 500, oledPage: 'auto', recordAutoArm: true, gView: '2d', kartModelYaw: 0, tiles: { enabled: true, urlTemplate: '', liveQuickToggle: true }, drift: { tol: 0.25, minSpeedKmh: 5, minLatG: 0.15 }, rollover: { angleDeg: 75 } },
  theme: 'dark',
  // Track / sectors-config / races (global/shared)
  track: { points: [], bounds: null, scanning: false, totalDistance: 0, maxDistFromStart: 0, closed: false },
  startGate: { enabled: false, lat: 0, lon: 0, heading: 0, width: 14 },
  savedTracks: [],
  activeTrackId: null,
  sectors: { boundaries: [null, null], best: [null, null, null], manual: false, clickTarget: null },
  drivers: [],
  races: [],
  activeRaceId: null,
  selectedRaceId: null,
  pendingDriverChange: null,
  expandedRaceIds: {},
  gateFlashUntil: 0,
};
```

(Note: the live sector-tracking fields `cur/sectorStart/lapSectors/lastLapSectors` moved into `kartState.sectorsLive`; `state.sectors` keeps config only — `boundaries/best/manual/clickTarget`.)

- [ ] **Step 3:** Immediately **after** the `state` literal, install the proxy facade + helpers:

```js
// ── Multi-Kart facade ───────────────────────────────────────────────────
// Per-kart fields are getters delegating to the active kart, so the entire
// render/read path keeps using state.telemetry / state.charts / state.batt …
// unchanged. Write paths use kartFor(mac) explicitly (see processTelemetry).
const PER_KART_FIELDS = ['connection','telemetry','raw','display','gps','spdSrc',
  'batt','max','charts','imu','drift','attitude','driftSmooth','heatmap','lapStart',
  'currentLapMax','currentLapTrace','bestLapTrace','bestLapMs','bestLapNum','liveDelta',
  'autoLap','sectorsLive','recording','replay','calibration','engine'];

function activeKart() {
  let k = state.karts.active();
  if (!k) k = state.karts.get(KartRegistry.DEFAULT_MAC);   // single-source fallback
  return k;
}

function kartFor(mac) {
  const key = mac || KartRegistry.DEFAULT_MAC;
  const k = state.karts.get(key);
  if (k && state.activeKartMac === null) state.activeKartMac = state.karts.activeMac();
  return k;   // null if over MAX_KARTS
}

for (const f of PER_KART_FIELDS) {
  Object.defineProperty(state, f, {
    get() { return activeKart()[f]; },
    set(v) { activeKart()[f] = v; },
    enumerable: false, configurable: true,
  });
}
```

- [ ] **Step 4: Verify:** `node --check rasicross.js kart-registry.js`. Grep `rasicross.js` for `Object.defineProperty(state` and `function kartFor` and `function activeKart` → present. Manual: `node -e "global.KartRegistry=require('./kart-registry.js'); /* smoke */"` is not needed — the facade is browser-only; static check suffices.

- [ ] **Step 5: Commit**

```bash
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" add index.html rasicross.js
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" commit -m "feat(multikart): partition dashboard state behind per-kart proxy facade

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: `rasicross.js` — migrate write paths to `kartFor()`

**Files:** Modify `rasicross.js` (`processTelemetry` `~626-760`, `recordPacket` `~595-605`, `arm`/recording reset `~584-587`, `applyEspConfigAck` `~434`, any `state.connection.* =` / lap-reset writers).

- [ ] **Step 1:** Read `processTelemetry` (`~626-760`) fresh. At the top, resolve the target kart and operate on it. Insert right after the `bridge_status`/`config_ack` early-returns (which stay global) and **before** `state.connection.packets++`:

```js
    const _mac = d.from_mac || KartRegistry.DEFAULT_MAC;
    const k = kartFor(_mac);
    if (!k) { rcToast('Max. ' + KartRegistry.MAX_KARTS + ' Karts — ' + _mac + ' ignoriert', 4000); return; }
    if (k.recording.armed && !k.replay.active) recordPacket(d);
```

Then **within `processTelemetry`, replace every `state.<perKartField>` with `k.<perKartField>`** for the fields in `PER_KART_FIELDS` (connection, telemetry, raw, batt, max, charts, imu, drift, attitude, driftSmooth, heatmap, gps, spdSrc, engine, currentLapMax, currentLapTrace, etc.). The `state.settings`, `state.calibration`→ now `k.calibration`, `state.replay`→`k.replay`. Keep `state.hz++` (global session counter) and `state.settings.*` (global) as-is. Keep `state.connection.source` reads — but `source` is now per-kart; set it where the serial/demo source is assigned (Task 6 wiring) — for live packets use `k.connection.source`.

The existing guard at `~629` (`if (state.recording.armed && !state.replay.active) recordPacket(d);`) is **removed** (moved above to use `k`).

- [ ] **Step 2:** Read `recordPacket` (`~595-605`). Re-target to the packet's kart:

```js
function recordPacket(d) {
  const k = kartFor(d.from_mac || KartRegistry.DEFAULT_MAC);
  if (!k) return;
  const now = Date.now();
  if (k.recording.startWall == null) k.recording.startWall = now;
  const rec = Object.assign({}, d, { t_rel: now - k.recording.startWall, _wall: now });
  const dropped = RasiReplay.pushCapped(k.recording.buf, rec, RasiReplay.REC_MAX);
  if (dropped && !k.recording.overflowed) {
    k.recording.overflowed = true;
    rcToast('⚠ Aufnahme-Puffer voll — älteste Pakete werden verworfen', 5000);
  }
}
```

- [ ] **Step 3:** Read the recording-arm reset (`~584-587`) and any lap-reset / `applyEspConfigAck` that writes per-kart fields. Re-target them to `activeKart()` (arming/calibration acts on the selected kart). E.g. the arm reset becomes:

```js
  const k = activeKart();
  k.recording.buf = [];
  k.recording.startWall = null;
  k.recording.overflowed = false;
  k.recording.armed = true;
```

`applyEspConfigAck(d)` (`~434`): if it stores values into `state.calibration`/`state.batt`, target the kart by `d.from_mac` (`kartFor(d.from_mac||DEFAULT)`), else `activeKart()`.

- [ ] **Step 4: Verify:**
  - `node --check rasicross.js`.
  - Grep `processTelemetry` region (`rasicross.js`) for `state.telemetry` / `state.charts` / `state.max` / `state.batt` / `state.connection` writes → **none should remain inside processTelemetry/recordPacket** (they must be `k.…`). Reads of `state.settings` may remain.
  - Manual smoke (deferred to user): single kart still updates the live view (proxy delegates to the only/default kart).

- [ ] **Step 5: Commit**

```bash
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" add rasicross.js
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" commit -m "feat(multikart): route processTelemetry/recordPacket writes through kartFor()

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: central downlink with `target_mac`

**Files:** Modify `rasicross.js` (add `bridgeSend()` helper near the serial helpers), `pit-wall.js` (`~331-376`), `serial-demo.js` (`~58-60`), and the inline command sites in `rasicross.js` (`~1118`, `~1158`, `~1188`).

- [ ] **Step 1:** Add a single helper in `rasicross.js` (near where `state.serial` is used), exported on `window` for the other scripts:

```js
// Send a command line to the bridge, tagged with the active kart's MAC so the
// bridge routes the downlink to the selected kart (target_mac is routing-only).
function bridgeSend(obj) {
  if (!window.rasiSerial || !window.rasiSerial.writeLine) return false;
  if (!state.serial || !state.serial.connected) return false;
  const mac = state.activeKartMac;
  const payload = Object.assign({}, obj);
  if (mac && mac !== KartRegistry.DEFAULT_MAC && !payload.target_mac) payload.target_mac = mac;
  try { window.rasiSerial.writeLine(JSON.stringify(payload)); return true; }
  catch (e) { return false; }
}
window.rasiBridgeSend = bridgeSend;
```

- [ ] **Step 2:** Replace the three inline command emitters in `rasicross.js`:
  - `~1118` `imu_calibrate auto` → `bridgeSend({ type: 'imu_calibrate', action: 'auto', duration_ms: 2000 });`
  - `~1158` `imu_calibrate reset` → `bridgeSend({ type: 'imu_calibrate', action: 'reset' });`
  - `~1188` `config` send → `bridgeSend(cfg);` (drop the manual `writeLine`).

- [ ] **Step 3:** Read `pit-wall.js:325-377`. Replace the two `window.rasiSerial.writeLine(...)` calls (display payload `~338`, pit_call `~366`, cancel `~376`) with `window.rasiBridgeSend(payloadObj)` (pass the object, not a stringified line — `bridgeSend` stringifies). For the already-stringified `payload` at `~361`, change to build the object and pass it through `rasiBridgeSend`.

- [ ] **Step 4:** Read `serial-demo.js:58-60`. `request_status` and `config_get` are bridge-level (not kart-routed) — leave `request_status` as a plain `writeLine` (no target), but route `config_get` via `window.rasiBridgeSend({ type: 'config_get' })` so it reaches the selected kart.

- [ ] **Step 5: Verify:** `node --check rasicross.js pit-wall.js serial-demo.js`. Grep for `rasiBridgeSend` → present in pit-wall.js and serial-demo.js; Grep `pit-wall.js` for `rasiSerial.writeLine` → no kart-bound command sites remain.

- [ ] **Step 6: Commit**

```bash
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" add rasicross.js pit-wall.js serial-demo.js
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" commit -m "feat(multikart): route downlink commands through bridgeSend() with target_mac

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 6: per-kart calibration + engine persistence + 9.6 migration

**Files:** Modify `rasicross.js` (`saveData` `~140-157`, `loadData`/restore — Grep `JSON.parse` + `SAVE_KEY`).

- [ ] **Step 1:** Read `saveData` (`~140-157`). Replace the single `calibration`/`engine` payload fields with per-MAC maps built from the registry:

```js
      const _kartsCal = {}, _kartsEngine = {};
      for (const mac of state.karts.macs()) {
        const kk = state.karts.get(mac);
        _kartsCal[mac] = kk.calibration;
        _kartsEngine[mac] = { totalMs: kk.engine.totalMs, lastServiceMs: kk.engine.lastServiceMs, serviceIntervalH: kk.engine.serviceIntervalH };
      }
```

and in the `payload` object replace `calibration: state.calibration` / `engine: {…}` with:

```js
      kartsCal: _kartsCal,
      kartsEngine: _kartsEngine,
```

Keep `version: '9.6'` unchanged (additive).

- [ ] **Step 2:** Read the load/restore path (Grep `kartsCal` won't exist yet; Grep for where `parsed.calibration`/`parsed.engine` are applied). Add migration: prefer `parsed.kartsCal`/`parsed.kartsEngine`; fall back to legacy single objects into the `"default"` bucket:

```js
  // Multi-Kart Migration (9.6 additive): kartsCal/kartsEngine bevorzugen,
  // sonst altes Single-Objekt in den "default"-Bucket legen (vom ersten
  // realen Kart adoptiert, sobald er funkt).
  const _cal = parsed.kartsCal || (parsed.calibration ? { [KartRegistry.DEFAULT_MAC]: parsed.calibration } : {});
  const _eng = parsed.kartsEngine || (parsed.engine ? { [KartRegistry.DEFAULT_MAC]: parsed.engine } : {});
  for (const mac of new Set([...Object.keys(_cal), ...Object.keys(_eng)])) {
    const kk = state.karts.get(mac);
    if (!kk) continue;
    if (_cal[mac]) Object.assign(kk.calibration, _cal[mac]);
    if (_eng[mac]) Object.assign(kk.engine, { totalMs: _eng[mac].totalMs || 0, lastServiceMs: _eng[mac].lastServiceMs || 0, serviceIntervalH: _eng[mac].serviceIntervalH || 10 });
  }
```

(When a real kart MAC first appears and the registry has only the `"default"` bucket populated, copy `default`'s cal/engine into the new MAC on first sight — add this in `kartFor()` adoption or on first packet. Implement in `kartFor`: if creating a non-default mac and a `default` kart exists with non-zero engine/cal, clone it once.)

- [ ] **Step 3:** Implement the one-time adoption in `kartFor` (extend Task 3's `kartFor`): when a brand-new non-default MAC is created and a `default` bucket exists, copy its `calibration` + `engine` into the new kart, then forget `default`.

- [ ] **Step 4: Verify:** `node --check rasicross.js`. Grep for `kartsCal` and `kartsEngine` in both `saveData` and the load path. Manual (deferred): old save loads without error; calibration appears on the first kart.

- [ ] **Step 5: Commit**

```bash
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" add rasicross.js
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" commit -m "feat(multikart): per-kart calibration+engine persistence with 9.6 default-bucket migration

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 7: kart bar + selection + render throttle

**Files:** Create `kart-bar.js`; modify `index.html` (script include + a `<div id="kartBar">` in the live header), `live-ui.js` (animLoop/displayUpdate throttle), `rasicross.js` (handle `bridge_status.karts[]` → registry + chip data).

- [ ] **Step 1:** Read the live header area of `index.html` (Grep for the live tab container). Add `<div id="kartBar" class="kart-bar"></div>` at the top of the live view, and add `<script src="kart-bar.js"></script>` after `rasicross.js`.

- [ ] **Step 2:** Create `kart-bar.js` (browser global; reads `state`, `KartRegistry`):

```js
// ============================================================
//  RasiCross — kart-bar.js  (kart chips + selection)
// ============================================================
//  Renders one chip per known kart with name/colour (localStorage
//  keyed by MAC), RSSI, Hz, packet age, battery + REC indicators.
//  Clicking sets state.activeKartMac. Browser-only (uses document).
// ============================================================
(function () {
  'use strict';
  const LS_KEY = 'rasi.kartMeta.v1';
  const PALETTE = ['#3aa0e8', '#e8a13a', '#5ad17a', '#e85a7a', '#b07ae8'];

  function loadMeta() {
    try { return JSON.parse(localStorage.getItem(LS_KEY)) || {}; } catch (e) { return {}; }
  }
  function saveMeta(meta) {
    try { localStorage.setItem(LS_KEY, JSON.stringify(meta)); } catch (e) {}
  }
  function metaFor(meta, mac, idx) {
    if (!meta[mac]) meta[mac] = { name: 'Kart ' + (idx + 1), color: PALETTE[idx % PALETTE.length] };
    return meta[mac];
  }

  function render(state) {
    const el = document.getElementById('kartBar');
    if (!el) return;
    const meta = state.kartMeta && Object.keys(state.kartMeta).length ? state.kartMeta : loadMeta();
    state.kartMeta = meta;
    const macs = state.karts.macs();
    el.innerHTML = '';
    macs.forEach((mac, i) => {
      const k = state.karts.get(mac);
      const m = metaFor(meta, mac, i);
      const chip = document.createElement('button');
      chip.className = 'kart-chip' + (mac === state.activeKartMac ? ' active' : '');
      chip.style.borderColor = m.color;
      const age = k.connection.lastPacketAt ? (Date.now() - k.connection.lastPacketAt) : 99999;
      const rec = k.recording.armed ? ' ●REC' : '';
      const rssi = (k.connection.rssi != null) ? (k.connection.rssi + 'dBm') : '--';
      const hz = state._kartHz && state._kartHz[mac] != null ? state._kartHz[mac] : '--';
      const stale = age > 2000 ? ' stale' : '';
      chip.className += stale;
      chip.innerHTML = '<b style="color:' + m.color + '">' + m.name + '</b>'
        + ' <span>' + hz + 'Hz</span> <span>' + rssi + '</span>'
        + (k.batt && k.batt.present ? ' <span>' + (k.batt.soc | 0) + '%</span>' : '')
        + rec;
      chip.onclick = () => { state.karts.setActive(mac); state.activeKartMac = mac; render(state); };
      el.appendChild(chip);
    });
    saveMeta(meta);
  }

  window.RasiKartBar = { render };
})();
```

Add minimal CSS for `.kart-bar`/`.kart-chip`/`.kart-chip.active`/`.kart-chip.stale` to the stylesheet (Read the main CSS file, add a small block near other live-header styles).

- [ ] **Step 3:** In `rasicross.js`, where `bridge_status` is handled (`~630-633`), feed `d.karts` into the registry + per-kart connection/hz so background karts populate even before their first telemetry packet:

```js
    if (d.type === 'bridge_status') {
      if (d.mac) { /* keep bridgeMac on active */ activeKart().connection.bridgeMac = d.mac; }
      state._kartHz = state._kartHz || {};
      if (Array.isArray(d.karts)) {
        for (const ks of d.karts) {
          const kk = kartFor(ks.mac);
          if (!kk) continue;
          if (ks.rssi != null) kk.connection.rssi = ks.rssi;
          if (ks.lost != null) kk.connection.lost = ks.lost;
          state._kartHz[ks.mac] = ks.rate_hz;
        }
      }
      if (window.RasiKartBar) RasiKartBar.render(state);
      return;
    }
```

- [ ] **Step 4:** Render throttle — Read `live-ui.js` `animLoop` (`~432`) and the display-update `setInterval` (`~438-443`). Wrap the **heavy** redraw (3D kart, charts) so it only runs for the active kart; the chip refresh + per-kart data already happen in `processTelemetry`. Add a guard at the top of the heavy render: it always renders `activeKart()` (proxy), which is correct — the throttle is that background karts never trigger a heavy redraw because only telemetry processing (light) runs for them; the rAF loop renders the active kart once per frame regardless. Add `if (window.RasiKartBar) RasiKartBar.render(state);` to the existing 2–4 Hz display-update interval so chips refresh.

- [ ] **Step 5: Verify:** `node --check kart-bar.js rasicross.js live-ui.js`. Grep `index.html` for `kartBar` and `kart-bar.js`. Manual (deferred): two karts → two chips; clicking switches the rich view; stale chip greys out.

- [ ] **Step 6: Commit**

```bash
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" add kart-bar.js index.html rasicross.js live-ui.js
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" commit -m "feat(multikart): kart bar chips + selection + bridge karts[] wiring

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```
(Include the CSS file in the add if a separate stylesheet was edited.)

---

## Task 8: per-kart recording save/export

**Files:** Modify `recording.js` (Grep `state.recording`), `rec-store.js`.

- [ ] **Step 1:** Read `recording.js`. Replace `state.recording.buf` / `state.recording.armed` reads with the **active kart's** buffer via the proxy (`state.recording.*` already delegates to the active kart after Task 3) — verify no direct `state.recording` write bypasses the proxy. The arm toggle acts on `activeKart()` (Task 4 Step 3).

- [ ] **Step 2:** For save/export (Grep `rasiRec` / `start(headerLine)` in `recording.js` and `rec-store.js`), include the active kart's name in the filename/header: read `state.kartMeta[state.activeKartMac]?.name` and prefix the export. Since `recordPacket` already keys buffers per MAC (Task 4), saving the active kart exports only its buffer — confirm the save reads `activeKart().recording.buf`.

- [ ] **Step 3:** Replay loads into the active kart slot (single-kart replay, as today) — verify `state.replay` (proxy → active kart) is what the replay engine drives.

- [ ] **Step 4: Verify:** `node --check recording.js rec-store.js`. Grep `recording.js` for `state.recording` → all go through the proxy (no per-mac literal). Manual (deferred): record two karts, switch, save each → two independent files with kart names.

- [ ] **Step 5: Commit**

```bash
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" add recording.js rec-store.js
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" commit -m "feat(multikart): per-kart recording buffers + named export

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 9: race history tagged per kart

**Files:** Modify `races.js` (Grep `function startRace`/`addLap`/race-create + `activeRaceId`), `rasicross.js` (lap-complete handler).

- [ ] **Step 1:** Read `races.js`. Where a race object is created, add a `kartMac` field set from `state.activeKartMac` (or `DEFAULT_MAC`). Where a lap is recorded, tag the lap with the same `kartMac`.

- [ ] **Step 2:** Move the live `activeRaceId` pointer to per-kart: the race a kart's laps feed is `activeKart().activeRaceId`. Keep `state.activeRaceId` (global, proxy is **not** applied to it — it stays a real global) as the *currently viewed* race in the UI. Disambiguate: rename the per-kart pointer usage to `activeKart().activeRaceId` in the lap-complete path; the race **list/selection** UI keeps using `state.activeRaceId`/`state.selectedRaceId`.

- [ ] **Step 3:** Race list/views: add a kart filter — when rendering races, allow filtering by `kartMac` (default: show all, with the kart name/colour as a badge per race row). Read the race-render function and add a small badge using `state.kartMeta[r.kartMac]`.

- [ ] **Step 4: Verify:** `node --check races.js rasicross.js`. Grep `races.js` for `kartMac` → present on race create + lap. `node --test` (geo/replay/kart-registry still green). Manual (deferred): two karts each accumulate their own laps into their own race; race list badges show the kart.

- [ ] **Step 5: Commit**

```bash
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" add races.js rasicross.js
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" commit -m "feat(multikart): tag races/laps with kartMac + per-kart activeRaceId

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 10: final verification + plan-doc commit

- [ ] **Step 1: Full verification (all green):**
  - `node --check geo.js replay.js kart-registry.js kart-bar.js rasicross.js recording.js rec-store.js races.js live-ui.js pit-wall.js serial-demo.js main.js preload.js`
  - `node --test` → geo + replay + kart-registry suites PASS.
  - `python -m py_compile bridge.py` → no error.
  - `python -m unittest discover -s test -p "test_*.py"` → `Ran 17 tests` `OK` (unchanged; no Python logic touched).
  - Delete `__pycache__`, then `git -C "…" status` → clean except intended files.

- [ ] **Step 2: Commit the plan doc** (the only place `.md` plan is added):

```bash
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" add docs/superpowers/plans/2026-06-21-28-multi-kart-support.md
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" commit -m "docs(plan): Phase 28 multi-kart-support implementation plan

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Hardware / Manual Acceptance Checklist (deferred to user — no ESP/MPU here)

1. **Two karts live at once:** both appear as chips; selecting one shows it in the rich view; the other keeps updating its chip (Hz/RSSI/age/batt).
2. **Pairing + persistence:** both kart MACs survive a bridge reboot (NVS list); `forget_kart_mac` drops one; `reset_karts` clears all.
3. **Targeted downlink:** IMU-calibrate / config / pit-call reach **only** the selected kart (verify on the other kart's OLED it did **not** act).
4. **Per-kart recording:** record while watching kart A; switch to B; both buffers fill independently; saving each yields two files named per kart.
5. **Per-kart calibration/engine:** calibrate each kart differently; values persist per MAC across an app restart; engine hours accrue separately.
6. **Race history:** each kart's laps feed its own race; race list shows the kart badge; both reviewable.
7. **Cap:** a 5th kart is rejected (bridge `kart_limit` notice + dashboard toast).
8. **Single-kart regression:** with one kart, behaviour is identical to v1.0.7 (one chip, auto-selected, all features work).
9. **Radio:** confirm 4 karts × 12.5 Hz shows no added loss vs. one kart (airtime budget).

## Self-Review

- **Spec coverage:** §4.1 bridge → Task 2; §4.2 partition/proxy → Tasks 3–4; §4.3 kart bar/throttle → Task 7; §4.4 recording → Tasks 4+8; §4.5 cal/engine/migration → Task 6; §4.6 races → Task 9; downlink target_mac (§4.1) → Tasks 2d+5; testing (§7) → Task 1 (unit) + per-task `node --check`/`py_compile` + Task 10 + hardware checklist. All spec sections mapped.
- **Placeholder scan:** every code step shows concrete code; the large in-place migrations (Task 4 Step 1, Task 7 Step 4) specify the exact transformation rule + anchors + Grep asserts rather than re-pasting 130-line functions, per the project's text-anchor convention.
- **Type/name consistency:** `kartFor(mac)`, `activeKart()`, `state.karts` (a `KartRegistry.create()` instance), `KartRegistry.MAX_KARTS`/`DEFAULT_MAC`/`makeKartState`, `bridgeSend()`/`window.rasiBridgeSend`, `RasiKartBar.render`, `state.kartMeta`, `state._kartHz`, `kartState.sectorsLive`, bridge `self.karts`/`_stats_for`/`peer_store.save_list`/`target_mac`/`karts[]` — used consistently across tasks.

## Phase Map

- **Spec:** `docs/superpowers/specs/2026-06-21-multi-kart-support-design.md` (realizes deferred **D2** from the 2026-05-17 improvements design).
- **This phase (28):** full per-kart multi-kart support. Branch `feat/multi-kart-support`.
- **Deferred follow-up (29 candidate):** cross-kart leaderboard / best-lap comparison / inter-kart delta; optional split-screen multi-view.
- **Unchanged firmware:** `sender.py`/`frame.py`/`calc.py` — no reflash (avoids the MicroPython 1.28 WiFi-OOM bootloop).
