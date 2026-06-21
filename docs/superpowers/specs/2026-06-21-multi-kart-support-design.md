# RasiCross — Phase 28: Multi-Kart Support (full per-kart pipeline)

**Date:** 2026-06-21
**Status:** Approved (design); pending implementation plan
**Author:** Brainstorming session (Claude + user)

---

## 1. Purpose

Run **two to four karts simultaneously live** on a single bridge and a single
dashboard. Today the whole stack is single-kart: the bridge tracks one
`kart_host` MAC, and the dashboard mutates one global `state` object per
packet. This phase makes the bridge multi-host and the dashboard run a
**full per-kart pipeline** — every kart gets its own telemetry, charts, laps,
drift, attitude, battery, calibration, engine-runtime and recording — while
the rich live view renders the *selected* kart and the others appear in a
kart bar.

This realizes **D2 (multi-kart)**, explicitly deferred in
`2026-05-17-rasicross-telemetry-improvements-design.md` §3 and again in
`2026-05-19-binary-protocol-design.md` §1 ("D2 multi-kart remains out of
scope").

### Out of scope (deferred to a follow-up phase)
- Cross-kart **leaderboard / best-lap comparison / delta between karts**.
- Split-screen rendering of multiple full live views at once.
- Any change to the kart firmware radio frame.

## 2. Background / current state (grounding facts)

- **Identity = MAC.** The bridge already tags each uplink packet with
  `from_mac` (`bridge.py` ~line 573) and the dashboard already reads it into
  `state.connection.kartMac` (`rasicross.js:638`). No new ID field is needed;
  `frame.py` (v3, 37 B) and `sender.py` stay **unchanged** — the kart firmware
  is **not** reflashed (avoids the MicroPython 1.28 WiFi-OOM bootloop risk).
- **Bridge is single-host.** `self.kart_host` is one MAC; a new MAC
  **overwrites** the old one and the single NVS `PeerStore` slot
  (`bridge.py:514-516`, `:417-422`). Downlink `_forward_to_kart`
  (`bridge.py:648`) sends only to `self.kart_host`. `bridge_status`
  (`bridge.py:684`) reports one `kart_mac` + one `rate_hz`.
- **Dashboard is single-state.** `const state = {…}` (`rasicross.js:38-96`)
  mixes three concerns in one object: **global/shared** (settings,
  calibration, theme, drivers, races, savedTracks, track, startGate, serial,
  demo), **per-kart runtime** (connection, telemetry, raw, display, gps,
  spdSrc, batt, max, charts, imu, drift, attitude, driftSmooth, heatmap,
  lapStart/currentLap*/bestLap*/liveDelta, autoLap, currentLapTrace,
  sectors-live, recording, replay) and **per-kart persisted** (engine,
  calibration). `processTelemetry(d)` (`rasicross.js:626`) mutates this single
  global state; `recordPacket(d)` (`:595`) appends to one `state.recording.buf`.
- **Radio budget is not the constraint.** ESP-NOW Long-Range PHY = 250 kbit/s
  (`sender.py:1011`, `bridge.py:400`); 4 karts × 12.5 Hz × ~37 B payload is a
  small fraction of channel airtime. The 250-byte cap only bounds the
  *downlink* command size and is already enforced (`bridge.py:656`).

## 3. Design decisions (locked)

1. **Topology:** one bridge → 2–4 karts, one dashboard. `MAX_KARTS = 4`.
2. **Identity:** kart MAC. No frame change. Name + colour assigned per MAC in
   the browser (localStorage), not in firmware.
3. **Pipeline depth:** full per-kart pipeline (Approach A). All karts run the
   complete data pipeline; only the active kart renders the heavy 3D/charts.
4. **Display:** kart bar (chips) + one rich full view for the selected kart.
5. **Calibration is per IMU** and **engine runtime is per mower** → both move
   into per-kart state and persist keyed by MAC.
6. **Race history is tagged per kart** (each race/lap carries `kartMac`; both
   karts recordable in one session, reviewable separately). One global `races`
   list; per-kart `activeRaceId`. No cross-kart comparison this phase.
7. **Backward compatible:** a single kart behaves exactly as today (one chip,
   auto-selected); old 9.6 saves migrate (legacy single-kart cal/engine →
   first known MAC / a `"default"` bucket).

## 4. Architecture

### 4.1 Bridge — multi-host (`bridge.py`)
- `self.kart_host` → `self.karts`: dict `{mac_bytes: Stats}` where `Stats`
  carries `rx_count, lost, last_seq, rssi, last_packet_at, packets_per_sec`.
  Capped at `MAX_KARTS`; an over-cap new MAC is ignored with a
  `bridge_info`/`kart_limit` notice.
- `on_packet` / `_handle_packet` resolve the per-MAC `Stats` and update it;
  `from_mac` tagging is unchanged.
- **PeerStore** stores a **list** of MACs (all survive reboot). New USB
  commands: `forget_kart_mac` (drop one MAC + peer + NVS entry) and
  `reset_karts` (clear all). `set_kart_mac` becomes **additive**.
- **Downlink targeting:** `_forward_to_kart` reads an optional `target_mac`
  from the raw USB line and sends to that peer. Missing/unknown `target_mac`
  → `bridge_error`/`no_target` (never a silent send to the wrong kart). The
  raw-line passthrough (to stay under 250 B) is preserved; `target_mac` is a
  dashboard-only routing field the dashboard does **not** put inside the
  kart-bound payload.
- **Status:** `bridge_status` gains `karts: [{mac, rate_hz, rssi, lost,
  last_seq, age}]`. The legacy scalar `kart_mac`/`rate_hz` fields remain
  (populated from the most-recently-heard kart) for backward compatibility.
- Bridge OLED: show active-kart count + weakest RSSI.

### 4.2 Dashboard state partition via proxy facade (`rasicross.js`, new `kart-registry.js`)
The blast-radius problem: hundreds of `state.telemetry` / `state.charts` /
`state.batt` reads across `rasicross.js`, `live-ui.js`, `recording.js`,
`drift.js`, `track.js`. Rewriting every read is error-prone. Instead:

- **`kart-registry.js`** (new, dependency-free UMD, TDD'd with `node:test`):
  pure factory + registry — `makeKartState()` returns a fresh per-kart state
  object; `KartRegistry` manages `{mac → kartState}`, enforces `MAX_KARTS`,
  handles `forget`/`reset`, and tracks the active MAC. No DOM, no globals.
- **`state.karts = {}`** + **`state.activeKartMac`** added to the global state.
  The per-kart fields listed in §2 are **removed as own properties** and
  re-exposed as **getters** on `state` that delegate to
  `activeKart().<field>`. The entire render/read path keeps working unchanged
  — it transparently reads the active kart.
- **Write paths are migrated to an explicit kart reference.** Only these
  functions stop writing `state.X =` and instead resolve
  `const k = kartFor(d.from_mac)` (creating the kartState on first sight) and
  write `k.X`: `processTelemetry`, `recordPacket`, the lap/sector update
  logic, replay-apply, and calibration-apply. A handful of reassignment sites
  (e.g. `state.recording.buf = []`) get setters that target `activeKart()`,
  or are pointed at an explicit kart.
- **Global (shared) fields stay own properties** of `state`: settings, theme,
  drivers, races, savedTracks, track, startGate, sectors-config, serial,
  demo, sessionStart.

### 4.3 Kart bar + selection (new `kart-bar.js`, `live-ui.js`)
- One chip per known kart: name + colour (localStorage per MAC), RSSI, Hz,
  packet age, battery warning, degraded flag, REC indicator.
- Clicking a chip sets `activeKartMac`; the rich view re-points seamlessly
  (3D/charts/gauges read the new kart through the proxy getters).
- **Render throttle:** only the active kart redraws 3D/canvas/charts.
  Background karts run the full **data** pipeline (so their charts, laps,
  recording and connection accumulate) but only refresh their chip values —
  no 3D/canvas work — keeping CPU bounded with 4 karts.

### 4.4 Recording per kart (`rasicross.js`, `recording.js`, `rec-store.js`)
- `recordPacket(d)` appends to `kartFor(d.from_mac).recording.buf`. Every kart
  is recorded independently regardless of which is selected.
- `recording.js` / `rec-store.js` gain a MAC dimension; save/export is
  per-kart, filename includes the kart name. Replay loads into a single
  kart slot (the active one) — replay stays single-kart as today.

### 4.5 Persistence, calibration, engine — per kart (`rasicross.js`)
- `calibration` → per-kart; persisted as `kartsCal: {[mac]: {…}}`.
- `engine` runtime/service → per-kart; persisted as
  `kartsEngine: {[mac]: {totalMs, lastServiceMs, serviceIntervalH}}`.
- `SAVE_KEY` and format version **9.6 stay**; the payload is extended
  additively. **Migration:** a legacy save's single `calibration`/`engine`
  loads into a `"default"` bucket, adopted by the first kart that appears (or
  the single kart, preserving today's behaviour).

### 4.6 Race history per kart (`races.js`, `rasicross.js`)
- `races` stays one global array; each race and each lap entry carries a
  `kartMac` tag. Live lap timing is per-kart (`kartState.lapStart`,
  `currentLapTrace`, `bestLap*`), feeding a per-kart `activeRaceId`.
- Race lists/views are filterable by kart; driver stints remain per race.
- **Deferred:** any cross-kart aggregate (leaderboard, inter-kart delta).

## 5. Data flow (one packet)
```
kart ESP --(ESP-NOW LR, unchanged frame)--> bridge
  bridge: resolve Stats[from_mac]; update; emit JSON line + from_mac over USB
dashboard processTelemetry(d):
  k = kartFor(d.from_mac)            # create on first sight (<= MAX_KARTS)
  recordPacket -> k.recording.buf    # always, even if k not active
  ... full pipeline writes k.*       # telemetry/charts/laps/drift/batt/engine
  update k chip (light)
  if k is active: render rich view (3D/charts) via state.* proxy getters
downlink (command): dashboard adds target_mac = activeKartMac
  bridge _forward_to_kart -> esp.send(target_mac, raw_payload)
```

## 6. Error handling / edge cases
- **> MAX_KARTS:** bridge ignores extra MACs with a notice; dashboard caps the
  registry and surfaces a toast.
- **Unknown `target_mac` on downlink:** bridge returns `no_target`; no send.
- **Kart drops out:** its chip shows stale age/last-RSSI; the active rich view
  freezes its last values (as today) and the connection state flags it.
- **First kart auto-select:** when the registry is empty and a packet arrives,
  that MAC becomes `activeKartMac` automatically (single-kart parity).
- **Legacy save / no MAC source (demo, old recordings):** route into the
  `"default"` bucket so single-source flows are unaffected.

## 7. Testing
- **Unit (`node:test`, dependency-free UMD):** new `kart-registry.js` —
  create/lookup/cap/forget/reset, active-MAC selection, `"default"` bucket.
  Existing `geo`/`replay` suites stay green; `frame.py`/`calc.py` untouched →
  Python `unittest` baseline (`Ran 17 tests` `OK`) unchanged.
- **Static + compile:** `node --check` on touched JS; `py_compile` on
  `bridge.py`.
- **Hardware / manual checklist (deferred to user — no ESP here):** two karts
  live at once; pairing both + forget/reset; downlink (display/calibrate) hits
  only the selected kart; per-chip RSSI/Hz/age/battery; per-kart recording
  produces two independent files; calibration/engine persist per MAC across
  restart; single-kart regression (behaves like today).

## 8. File structure
| Action | Path | Responsibility |
|--------|------|----------------|
| add    | `kart-registry.js` | Pure MAC→kartState registry: factory, cap, forget/reset, active selection (UMD, unit-tested) |
| add    | `kart-bar.js` | Kart chips: name/colour (localStorage), RSSI/Hz/age/batt/REC, selection, render-throttle wiring |
| modify | `bridge.py` | `karts{}` multi-host stats, MAC-list PeerStore, `forget_kart_mac`/`reset_karts`, `target_mac` downlink, `karts[]` status, OLED count |
| modify | `rasicross.js` | State partition (proxy getters + `state.karts`/`activeKartMac`), `kartFor()` write-path migration, per-kart cal/engine + 9.6 migration, per-kart `recordPacket` |
| modify | `recording.js`, `rec-store.js` | Per-MAC recording buffers, per-kart save/export |
| modify | `races.js` | `kartMac` tag on races/laps, per-kart `activeRaceId`, kart filter |
| modify | `live-ui.js` | Mount kart bar, throttle heavy render to active kart |
| unchanged | `sender.py`, `frame.py`, `calc.py`, `geo.js`, `replay.js` | Kart firmware + pure-logic modules untouched (no reflash) |

## 9. Constraints (house rules)
- All telemetry/protocol changes stay **additive / backward-compatible** and
  within the **250 B** ESP-NOW downlink budget (`target_mac` is routing-only,
  stripped before the kart-bound payload).
- New pure logic lives in a **dependency-free UMD module** TDD'd with
  `node:test`; DOM/ESP wiring is static-review + `node --check` / `py_compile`
  + the user hardware checklist.
- Delivered as a numbered phase plan
  `docs/superpowers/plans/2026-06-21-28-multi-kart-support.md` per project
  convention; `sender.py`/`frame.py` deliberately excluded from the change set.
