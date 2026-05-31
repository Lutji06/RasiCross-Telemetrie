# Phase 18 — Drift Detection (Dashboard-only) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Detect and surface drift (over-/understeer / counter-steer) from the already-transmitted `yaw` (gyro-Z °/s), `gy` (lateral g) and `speed` (km/h) — live and during replay — with a pure, tested `drift.js` module. No firmware change.

**Architecture:** A dependency-free UMD module `drift.js` (same pattern as `geo.js`/`replay.js`) computes a *drift index* = measured yaw rate ÷ the yaw rate the lateral grip implies (ω_exp = a_lat/v). `rasicross.js` calls it per packet in `processTelemetry` (which the replay path also drives via `feedReplayPacket`), stores `state.drift`, shows a status badge in the G-Kraft KPI sub-line, and — on loading a recording — computes a drift summary + a marker strip on the replay bar.

**Tech Stack:** Vanilla JS UMD module + `node:test` (`test/drift.test.js`); vanilla DOM/canvas dashboard (`rasicross.js`, `RasiCross_Telemetry.html`). No new runtime deps. No ESP/`calc.py`/`frame.py` changes.

---

## Working Directory & Conventions

**All work happens in the git clone:** `C:/Users/jimlu/Documents/RasiCross-Telemetrie-git` (current branch `feat/tab-redesign-pitwall`).

- Paths relative to clone root unless absolute. Files use **CRLF**; always `Read` the target region in-session immediately before an `Edit` and copy the `old_string` anchor from that fresh Read (strip the line-number/tab prefix). Line numbers below are indicative — anchor on the text.
- Git: `git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" …`. Use the **Grep tool** (not shell grep) for verification greps. There is an untracked `.claude/` directory and untracked plan/spec docs — **never** `git add` them; use explicit `git add <path>`.
- Windows: Python may be `python` or `py -3` (not needed this phase except the full-CI dry-run). Node v24 local; CI Node 20 / Python 3.12.
- **Spec:** `docs/superpowers/specs/2026-05-30-drift-rollover-detection-design.md` (Phase 18 = items D1–D6; Phase 19 is a later plan).
- Commit messages: conventional + body + trailer `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

**Behavioural invariant:** Phase 18 is **purely additive** on the dashboard. No packet key, no ESP code, no existing chart/KPI changes. `state.drift` defaults to `{status:'n/a', index:null}`; the badge shows `–` until real cornering data arrives. With no `yaw`/`gy`/`speed` (old firmware / demo without IMU) the module returns `'n/a'` and nothing breaks. Recordings already store the raw packet (`recordPacket` at `rasicross.js:420` does `Object.assign({}, d, …)`), so `yaw`/`gy`/`speed` are present in any recording made since Phase 5 — the replay summary works on existing files.

**Locked decisions (spec §5.1–5.3 + established patterns):**
1. **Method = yaw-rate-vs-expected** (spec Ansatz 1). `index = |yawRate| / ω_exp`, `ω_exp = (|latAccel|·g / v)·180/π`. GPS-independent, no integration. Sideslip-β and geometric thresholds are explicitly out of scope.
2. **Pure logic in `drift.js`** (UMD, `node:test`), loaded `<script>` **after `replay.js`, before `rasicross.js`**. Browser global `RasiDrift`; Node `module.exports`. Mirrors `geo.js`.
3. **Gate** against noise: `speed < minSpeedKmh` (default 5) **or** `|latAccel| < minLatG` (default 0.15 g) ⇒ `'n/a'`. Status tolerance `tol` default 0.25.
4. **Live wiring** in `processTelemetry` reuses the *transformed* `gy` (after swap/invert calibration) and raw `yawv`/`speed`, computed right after the axis-transform block, before the charts block (so the index can be pushed to a ring buffer).
5. **Badge** extends the existing **G-Kraft KPI sub-line** (the Phase-5 `kYaw`/`kMtemp` line) with `· Drift <b id="kDrift">–</b>`; colour set in JS via `el.style.color` (no new CSS class needed). No new KPI block.
6. **Replay** needs no per-sample re-plumbing: `feedReplayPacket`→`processTelemetry` already updates `state.drift` live as you scrub/play. This plan additionally computes a one-shot **summary** (`RasiDrift.summarize`) + a **drift-phase marker strip** (`RasiDrift.driftSpans`) when a recording is loaded.
7. **No optional index chart trace** on the G-chart (spec calls it optional) — YAGNI for this phase; the live badge + replay strip already visualise drift phases.

---

## File Structure

| Action | Path | Responsibility |
|--------|------|----------------|
| Create | `drift.js` | Pure drift math: `expectedYawRate`, `analyze`, `summarize`, `driftSpans`. UMD export `RasiDrift`. |
| Create | `test/drift.test.js` | `node:test` unit tests for `drift.js`. |
| Modify | `RasiCross_Telemetry.html` | `<script src="drift.js">` before `rasicross.js`; `#kDrift` in the G-Kraft sub-line; `#rpDrift` + `#rpDriftStrip` in the replay bar; CSS for the strip. |
| Modify | `package.json` | Add `drift.js` to `build.files`. |
| Modify | `eslint.config.js` | New `drift.js` UMD block; add `RasiDrift` to the `rasicross.js` globals. |
| Modify | `rasicross.js` | `state.drift` + `state.charts.driftIndex` + `state.settings.drift`; `processTelemetry` drift call; `updateLiveKPIs` badge; reset + REPLAY_KEYS; settings load/save; `enterReplay` summary + strip render. |

**Task order (each commit independently sound):** T1 `drift.js`+tests (TDD) → T2 register module (script/build/eslint) → T3 live wiring (state + processTelemetry + reset/keys) → T4 live badge → T5 settings → T6 replay summary → T7 replay marker strip → T8 phase verify/commit/push.

---

### Task 1: `drift.js` module + unit tests (TDD)

**Files:**
- Create: `test/drift.test.js`
- Create: `drift.js`

- [ ] **Step 1: Write the failing test** — create `test/drift.test.js`:

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const drift = require('../drift.js');

const approx = (a, b, tol = 1e-3) => assert.ok(Math.abs(a - b) <= tol, `${a} != ${b} (±${tol})`);

test('module exports the 4 functions', () => {
  for (const n of ['expectedYawRate', 'analyze', 'summarize', 'driftSpans']) {
    assert.equal(typeof drift[n], 'function', `missing ${n}`);
  }
});

test('expectedYawRate: matches hand calc and guards v<=0', () => {
  // a = 0.5 g = 4.90332 m/s^2 ; v = 36 km/h = 10 m/s ; w = 0.490332 rad/s = 28.092 deg/s
  approx(drift.expectedYawRate(0.5, 36), 28.092, 0.05);
  assert.equal(drift.expectedYawRate(0.5, 0), 0);
  assert.equal(drift.expectedYawRate(0, 36), 0);
});

test('analyze: straight / slow -> n/a', () => {
  assert.equal(drift.analyze({ yawRate: 0, latAccel: 0.02, speed: 40 }).status, 'n/a');
  assert.equal(drift.analyze({ yawRate: 5, latAccel: 0.4, speed: 2 }).status, 'n/a');
  assert.equal(drift.analyze({ yawRate: 5, latAccel: 0.4, speed: 2 }).index, null);
});

test('analyze: steady grip -> index ~1', () => {
  const exp = drift.expectedYawRate(0.5, 36);
  const r = drift.analyze({ yawRate: exp, latAccel: 0.5, speed: 36 });
  assert.equal(r.status, 'grip');
  approx(r.index, 1, 0.01);
});

test('analyze: oversteer vs understeer', () => {
  const exp = drift.expectedYawRate(0.5, 36);
  assert.equal(drift.analyze({ yawRate: exp * 1.6, latAccel: 0.5, speed: 36 }).status, 'oversteer');
  assert.equal(drift.analyze({ yawRate: exp * 0.5, latAccel: 0.5, speed: 36 }).status, 'understeer');
});

test('analyze: opposite signs -> counter (above noise)', () => {
  const exp = drift.expectedYawRate(0.5, 36);
  assert.equal(drift.analyze({ yawRate: -exp, latAccel: 0.5, speed: 36 }).status, 'counter');
});

test('analyze: NaN / junk -> n/a, never throws', () => {
  assert.equal(drift.analyze({ yawRate: NaN, latAccel: 'x', speed: undefined }).status, 'n/a');
  assert.equal(drift.analyze(null).status, 'n/a');
});

test('summarize: percentages and max over a sequence', () => {
  const exp = drift.expectedYawRate(0.5, 36);
  const s = drift.summarize([
    { yaw: 0, gy: 0.0, speed: 40 },          // n/a
    { yaw: exp, gy: 0.5, speed: 36 },        // grip
    { yaw: exp * 1.6, gy: 0.5, speed: 36 },  // oversteer (drift)
    { yaw: -exp, gy: 0.5, speed: 36 },       // counter (drift)
    { yaw: exp * 0.5, gy: 0.5, speed: 36 }   // understeer
  ]);
  assert.equal(s.total, 5);
  assert.equal(s.counted, 4);
  assert.equal(s.driftCount, 2);
  approx(s.driftPct, 50, 0.01);
  approx(s.understeerPct, 25, 0.01);
  assert.ok(s.maxIndex >= 1.6);
});

test('driftSpans: contiguous drift phases in ms', () => {
  const exp = drift.expectedYawRate(0.5, 36);
  const G = { yaw: exp, gy: 0.5, speed: 36 };           // grip
  const D = { yaw: exp * 1.6, gy: 0.5, speed: 36 };     // drift
  const spans = drift.driftSpans([
    { ...G, t_rel: 0 }, { ...D, t_rel: 100 }, { ...D, t_rel: 200 },
    { ...G, t_rel: 300 }, { ...D, t_rel: 400 }
  ]);
  assert.equal(spans.length, 2);
  assert.deepEqual(spans[0], { startMs: 100, endMs: 200 });
  assert.deepEqual(spans[1], { startMs: 400, endMs: 400 });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/drift.test.js`
Expected: FAIL — `Cannot find module '../drift.js'`.

- [ ] **Step 3: Write the minimal implementation** — create `drift.js`:

```js
'use strict';
// ============================================================
//  drift.js — pure drift detection (RasiCross, Phase 18)
//  Loaded as a classic <script> BEFORE rasicross.js (exposes
//  window.RasiDrift) and as a CommonJS module for node:test.
//  Dependency-free. No DOM. Method: yaw-rate vs the rate the
//  lateral grip implies (omega_exp = a_lat / v). See spec
//  2026-05-30-drift-rollover-detection-design.md §5.1.
// ============================================================

var G_MS2 = 9.80665;
var DEFAULTS = { tol: 0.25, minSpeedKmh: 5, minLatG: 0.15 };

function _num(x) { var v = Number(x); return isFinite(v) ? v : 0; }

// Expected steady-cornering yaw rate (deg/s) from lateral g + speed (km/h).
function expectedYawRate(latAccelG, speedKmh) {
  var v = _num(speedKmh) / 3.6;            // m/s
  if (!(v > 0)) return 0;
  var a = Math.abs(_num(latAccelG)) * G_MS2;
  return (a / v) * (180 / Math.PI);
}

// Analyse one sample. Never throws.
function analyze(sample, opts) {
  var o = opts || {};
  var tol = o.tol == null ? DEFAULTS.tol : o.tol;
  var minSpeed = o.minSpeedKmh == null ? DEFAULTS.minSpeedKmh : o.minSpeedKmh;
  var minLat = o.minLatG == null ? DEFAULTS.minLatG : o.minLatG;
  var s = sample || {};
  var yaw = _num(s.yawRate);
  var lat = _num(s.latAccel);
  var spd = _num(s.speed);
  if (spd < minSpeed || Math.abs(lat) < minLat) {
    return { status: 'n/a', index: null, expectedYaw: 0 };
  }
  var exp = expectedYawRate(lat, spd);
  if (!(exp > 0)) return { status: 'n/a', index: null, expectedYaw: 0 };
  var index = Math.abs(yaw) / exp;
  // Opposite sign of yaw vs lateral accel = vehicle rotating against the
  // turn direction implied by lateral load -> counter-steer / spin.
  // (Sign relationship depends on IMU mounting; documented in spec §4.4.)
  if (yaw * lat < 0) return { status: 'counter', index: index, expectedYaw: exp };
  var status = index > 1 + tol ? 'oversteer'
             : index < 1 - tol ? 'understeer'
             : 'grip';
  return { status: status, index: index, expectedYaw: exp };
}

// Aggregate over a recording's packets ({yaw, gy, speed}).
function summarize(samples, opts) {
  var out = { total: 0, counted: 0, driftCount: 0, driftPct: 0,
              understeerPct: 0, maxIndex: 0 };
  if (!samples || !samples.length) return out;
  var under = 0;
  for (var i = 0; i < samples.length; i++) {
    var p = samples[i];
    out.total++;
    var r = analyze({ yawRate: p.yaw, latAccel: p.gy, speed: p.speed }, opts);
    if (r.status === 'n/a') continue;
    out.counted++;
    if (r.index > out.maxIndex) out.maxIndex = r.index;
    if (r.status === 'oversteer' || r.status === 'counter') out.driftCount++;
    else if (r.status === 'understeer') under++;
  }
  if (out.counted > 0) {
    out.driftPct = out.driftCount / out.counted * 100;
    out.understeerPct = under / out.counted * 100;
  }
  return out;
}

// Contiguous drift phases as [{startMs,endMs}] using each packet's t_rel.
function driftSpans(samples, opts) {
  var spans = [];
  if (!samples || !samples.length) return spans;
  var cur = null;
  for (var i = 0; i < samples.length; i++) {
    var p = samples[i];
    var r = analyze({ yawRate: p.yaw, latAccel: p.gy, speed: p.speed }, opts);
    var isDrift = r.status === 'oversteer' || r.status === 'counter';
    var t = _num(p.t_rel);
    if (isDrift) {
      if (cur) cur.endMs = t; else cur = { startMs: t, endMs: t };
    } else if (cur) { spans.push(cur); cur = null; }
  }
  if (cur) spans.push(cur);
  return spans;
}

// ── UMD-style export ────────────────────────────────────────
(function () {
  var api = { expectedYawRate: expectedYawRate, analyze: analyze,
              summarize: summarize, driftSpans: driftSpans };
  if (typeof module !== 'undefined' && module.exports) { module.exports = api; }
  if (typeof window !== 'undefined') { window.RasiDrift = api; }
})();
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test test/drift.test.js`
Expected: PASS — `tests 9 | pass 9 | fail 0`.

- [ ] **Step 5: Lint + full JS regression**

Run: `node --check drift.js` → exit 0.
Run: `npx eslint drift.js test/drift.test.js` → **will report `RasiDrift`/`module` issues** until Task 2 adds the eslint block; that is expected here. If eslint errors only concern `module`/`window`/`RasiDrift` globals, proceed (Task 2 fixes them). Any *other* error (unused var, syntax) must be fixed now.
Run: `node --test` (no path, auto-discovers `test/`) → `tests 61 | pass 61 | fail 0` (52 baseline + 9 new).

- [ ] **Step 6: Commit**

```bash
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" add drift.js test/drift.test.js
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" commit -m "feat(drift): pure drift-detection module + unit tests

Yaw-rate-vs-expected drift index (omega_exp = a_lat/v) with a
speed/lateral-g noise gate. expectedYawRate/analyze/summarize/driftSpans.
Dependency-free UMD (RasiDrift), 9 node:test cases.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Register `drift.js` (script tag, build.files, eslint)

**Files:**
- Modify: `RasiCross_Telemetry.html` (one `<script>` line)
- Modify: `package.json` (`build.files`)
- Modify: `eslint.config.js` (new block + global)

- [ ] **Step 1: Read** the script-tag region of `RasiCross_Telemetry.html` (the `<script src="geo.js">` … `<script src="rasicross.js">` block, ~lines 3357-3365) to anchor the insert.

- [ ] **Step 2: Add the `<script>` tag** — Edit `RasiCross_Telemetry.html`, replace exactly:

```
<script src="geo.js"></script>
<script src="replay.js"></script>
```

with:

```
<script src="geo.js"></script>
<script src="replay.js"></script>
<script src="drift.js"></script>
```

- [ ] **Step 3: Add to `build.files`** — Edit `package.json`, replace exactly:

```
    "geo.js",
    "replay.js",
```

with:

```
    "geo.js",
    "replay.js",
    "drift.js",
```

(If the surrounding indentation differs in the fresh Read, copy it verbatim from that Read — anchor on the two filenames.)

- [ ] **Step 4: Add the eslint UMD block** — Edit `eslint.config.js`, replace exactly:

```
  // dom-targets.js setzt window.DomTargets (UMD, Browser)
```

with:

```
  // drift.js setzt window.RasiDrift (UMD, Browser + node:test)
  {
    files: ['drift.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: { ...globals.browser, module: 'readonly' },
    },
    rules: bugRules,
  },

  // dom-targets.js setzt window.DomTargets (UMD, Browser)
```

- [ ] **Step 5: Add `RasiDrift` to the `rasicross.js` globals** — Edit `eslint.config.js`, replace exactly:

```
        RasiTiles: 'readonly',
        RasiTileRenderer: 'readonly',
      },
```

with:

```
        RasiTiles: 'readonly',
        RasiTileRenderer: 'readonly',
        RasiDrift: 'readonly',
      },
```

- [ ] **Step 6: Verify**

Run: `npx eslint drift.js test/drift.test.js eslint.config.js` → exit 0 (the global errors from Task 1 Step 5 are now gone).
Run (Grep tool) on `RasiCross_Telemetry.html`: `src="drift.js"` → 1. On `package.json`: `"drift.js"` → 1. On `eslint.config.js`: `files: \['drift.js'\]` → 1; `RasiDrift: 'readonly'` → 1.
Confirm `git -C "…" status --short` shows only the 3 expected files modified.

- [ ] **Step 7: Commit**

```bash
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" add RasiCross_Telemetry.html package.json eslint.config.js
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" commit -m "build(drift): load drift.js, bundle it, lint it

Script tag before rasicross.js, package.json build.files entry, eslint
UMD block + RasiDrift global for the renderer.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Live wiring — state, `processTelemetry`, reset, REPLAY_KEYS

**Files:**
- Modify: `rasicross.js` (state init; `processTelemetry`; `resetReplayDerived`; `REPLAY_KEYS`)

Context: `processTelemetry` computes `speed` (line ~452) and the calibration-transformed `gy` (after the swap/invert block, line ~463), and sets `state.imu.yaw = yawv` (~458). We compute drift right after the transform block, before the charts block (~495), and push the index into a new ring buffer.

- [ ] **Step 1: Read** `rasicross.js` the state-init region (the `charts:`/`imu:` lines, ~58-59), the `processTelemetry` axis-transform + charts region (~454-509), `resetReplayDerived` (~3343-3351), and `REPLAY_KEYS` (~3323-3326). Copy the anchors below from that fresh Read.

- [ ] **Step 2: Add `driftIndex` chart buffer + `state.drift` to the main state init** — Edit `rasicross.js`, replace exactly:

```
  charts: { speed: [], rpm: [], gx: [], gy: [], gz: [], yaw: [] },
  imu: { yaw: 0, mtemp: null },
```

with:

```
  charts: { speed: [], rpm: [], gx: [], gy: [], gz: [], yaw: [], driftIndex: [] },
  imu: { yaw: 0, mtemp: null },
  drift: { status: 'n/a', index: null },
```

- [ ] **Step 3: Compute drift in `processTelemetry`** — Edit `rasicross.js`, replace exactly:

```
    if (state.calibration.invertGx) gx = -gx;
    if (state.calibration.invertGy) gy = -gy;
    const lat = Number(d.lat);
```

with:

```
    if (state.calibration.invertGx) gx = -gx;
    if (state.calibration.invertGy) gy = -gy;
    // Drift (Phase 18): gemessene vs. erwartete Gierrate. gy = transformierte
    // Querbeschleunigung, yawv = Gier-Rate (Gyro-Z), speed in km/h.
    state.drift = RasiDrift.analyze(
      { yawRate: yawv, latAccel: gy, speed: speed }, state.settings.drift);
    const lat = Number(d.lat);
```

- [ ] **Step 4: Push the drift index into the chart ring buffer** — Edit `rasicross.js`, replace exactly:

```
      state.charts.gz.push(gz);
      state.charts.yaw.push(yawv);
      const max = 600;
```

with:

```
      state.charts.gz.push(gz);
      state.charts.yaw.push(yawv);
      state.charts.driftIndex.push(state.drift.index == null ? 0 : state.drift.index);
      const max = 600;
```

- [ ] **Step 5: Trim the new ring buffer** — Edit `rasicross.js`, replace exactly:

```
      while (state.charts.gz.length > max) state.charts.gz.shift();
      while (state.charts.yaw.length > max) state.charts.yaw.shift();
    }
```

with:

```
      while (state.charts.gz.length > max) state.charts.gz.shift();
      while (state.charts.yaw.length > max) state.charts.yaw.shift();
      while (state.charts.driftIndex.length > max) state.charts.driftIndex.shift();
    }
```

- [ ] **Step 6: Init drift in `resetReplayDerived`** — Edit `rasicross.js`, replace exactly:

```
  state.charts = { speed: [], rpm: [], gx: [], gy: [], gz: [], yaw: [] };
  state.imu = { yaw: 0, mtemp: null };
```

with:

```
  state.charts = { speed: [], rpm: [], gx: [], gy: [], gz: [], yaw: [], driftIndex: [] };
  state.imu = { yaw: 0, mtemp: null };
  state.drift = { status: 'n/a', index: null };
```

- [ ] **Step 7: Add `drift` to REPLAY_KEYS** (so it is snapshot/restored around replay) — Edit `rasicross.js`, replace exactly:

```
const REPLAY_KEYS = ['connection','hz','telemetry','raw','display','gps','spdSrc',
  'batt','max','charts','imu','heatmap','sectors','lapStart','currentLapMax',
```

with:

```
const REPLAY_KEYS = ['connection','hz','telemetry','raw','display','gps','spdSrc',
  'batt','max','charts','imu','drift','heatmap','sectors','lapStart','currentLapMax',
```

- [ ] **Step 8: Verify**

Run: `node --check rasicross.js` → exit 0.
Run: `node --test` → `tests 61 | pass 61 | fail 0` (unchanged — no JS test touches the DOM wiring).
Run: `npx eslint rasicross.js` → exit 0 (`RasiDrift` is now a declared global).
Run (Grep tool) on `rasicross.js`: `state\.drift = RasiDrift\.analyze` → 1; `driftIndex: \[\]` → 2 (main init + reset); `state\.charts\.driftIndex\.push` → 1; `'drift',` → 1 (in REPLAY_KEYS). Visually confirm (fresh Read) the drift call sits after the invertGy line and `speed` is in scope there.

- [ ] **Step 9: Commit**

```bash
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" add rasicross.js
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" commit -m "feat(drift): live drift state in the telemetry pipeline

processTelemetry computes state.drift via RasiDrift.analyze from the
transformed gy, yaw rate and speed; driftIndex ring buffer; reset +
REPLAY_KEYS updated so replay drives and isolates it.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: Live badge in the G-Kraft KPI sub-line

**Files:**
- Modify: `RasiCross_Telemetry.html` (G-Kraft sub-line `#kDrift`)
- Modify: `rasicross.js` (`updateLiveKPIs` badge render)

Context: the G-Kraft KPI sub-line (`RasiCross_Telemetry.html:2475`) already shows `Max … · Gier …°/s · MPU …°C`. `updateLiveKPIs` renders `kGMax`/`kYaw`/`kMtemp` together (`rasicross.js:2476-2478`).

- [ ] **Step 1: Read** `RasiCross_Telemetry.html` line ~2475 (the `kpi-sub` with `kGMax`/`kYaw`/`kMtemp`) and `rasicross.js` ~2476-2478 (the `setText('kGMax' …)` / `kYaw` / `kMtemp` block). Copy both anchors.

- [ ] **Step 2: Add `#kDrift` to the sub-line** — Edit `RasiCross_Telemetry.html`, replace exactly:

```
      <div class="kpi-sub">Max <b id="kGMax">0.0</b> · Gier <b id="kYaw">0</b>°/s · MPU <b id="kMtemp">--</b>°C</div>
```

with:

```
      <div class="kpi-sub">Max <b id="kGMax">0.0</b> · Gier <b id="kYaw">0</b>°/s · MPU <b id="kMtemp">--</b>°C · Drift <b id="kDrift">–</b></div>
```

- [ ] **Step 3: Render the badge** — Edit `rasicross.js`, replace exactly:

```
    setText('kYaw', Math.round(state.imu.yaw));
    setText('kMtemp', state.imu.mtemp == null ? '--' : Math.round(state.imu.mtemp));
```

with:

```
    setText('kYaw', Math.round(state.imu.yaw));
    setText('kMtemp', state.imu.mtemp == null ? '--' : Math.round(state.imu.mtemp));
    renderDriftBadge();
```

- [ ] **Step 4: Add the `renderDriftBadge` helper** — Edit `rasicross.js`, replace exactly (same anchor as Step 3's result, immediately after it — re-Read to confirm) the `renderGauges` banner region. Concretely, replace exactly:

```
// ============================================================
// 8. TACHO / RPM / G-METER
// ============================================================
const LERP = 0.18;
```

with:

```
// ============================================================
// 8. TACHO / RPM / G-METER
// ============================================================
// Drift-Badge (Phase 18): Label + Indexwert + Farbe je Status.
const DRIFT_LABEL = { 'n/a': '–', grip: 'Grip', oversteer: 'Drift',
                      understeer: 'Schiebt', counter: 'Spin' };
const DRIFT_COLOR = { 'n/a': '', grip: 'var(--green,#5ad17a)',
                      oversteer: 'var(--warn,#e0a13a)',
                      understeer: 'var(--blue,#7aa2f7)',
                      counter: 'var(--danger,#e05a5a)' };
function renderDriftBadge() {
  const el = $('kDrift');
  if (!el) return;
  const st = (state.drift && state.drift.status) || 'n/a';
  const idx = state.drift && state.drift.index;
  const label = DRIFT_LABEL[st] || '–';
  el.textContent = (st === 'n/a' || idx == null) ? label : `${label} ${idx.toFixed(1)}`;
  el.style.color = DRIFT_COLOR[st] || '';
}
const LERP = 0.18;
```

- [ ] **Step 5: Verify**

Run: `node --check rasicross.js` → exit 0.
Run: `node --test` → `tests 61 | pass 61 | fail 0`.
Run: `npx eslint rasicross.js` → exit 0.
Run (Grep tool) on `RasiCross_Telemetry.html`: `id="kDrift"` → 1. On `rasicross.js`: `function renderDriftBadge` → 1; `renderDriftBadge\(\)` → 2 (definition call site + the updateLiveKPIs call); `DRIFT_LABEL` → 2; `DRIFT_COLOR` → 2.

- [ ] **Step 6: Commit**

```bash
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" add rasicross.js RasiCross_Telemetry.html
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" commit -m "feat(drift): live drift badge in the G-Kraft KPI sub-line

kDrift shows status label + index, colour-coded (grip/Drift/Schiebt/
Spin). Rendered each updateLiveKPIs tick.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: Settings — drift sensitivity (tolerance) + min-speed gate

**Files:**
- Modify: `rasicross.js` (`state.settings.drift`; `loadSettingsToUi`; `saveSettingsFromUi`)
- Modify: `RasiCross_Telemetry.html` (two settings fields)

Context: `state.settings` is the persisted slice (line ~47). `loadSettingsToUi` (~364) writes settings → inputs; `saveSettingsFromUi` (~387) reads inputs → settings with clamping. The settings card has number fields like `setMinLap` (`RasiCross_Telemetry.html:3048`).

- [ ] **Step 1: Read** `rasicross.js` the `settings:` init line (~47), the `loadSettingsToUi` body (~365-369, the `setMinLap` line), the `saveSettingsFromUi` body (~391-392, the `minLapSeconds` line); and `RasiCross_Telemetry.html` ~3048 (the `setMinLap` field). Copy anchors.

- [ ] **Step 2: Add the `drift` settings slice** — Edit `rasicross.js`, replace exactly:

```
  settings: { maxSpeed: 80, maxRpm: 10000, rpmWarning: 9000, gScale: 3, minLapSeconds: 10, displayUpdateMs: 500, oledPage: 'auto', recordAutoArm: true, gView: '2d', kartModelYaw: 0, tiles: { enabled: true, urlTemplate: '', liveQuickToggle: true } },
```

with:

```
  settings: { maxSpeed: 80, maxRpm: 10000, rpmWarning: 9000, gScale: 3, minLapSeconds: 10, displayUpdateMs: 500, oledPage: 'auto', recordAutoArm: true, gView: '2d', kartModelYaw: 0, tiles: { enabled: true, urlTemplate: '', liveQuickToggle: true }, drift: { tol: 0.25, minSpeedKmh: 5, minLatG: 0.15 } },
```

- [ ] **Step 3: Add the two settings fields (HTML)** — Edit `RasiCross_Telemetry.html`, replace exactly:

```
        <div class="field"><label>Mindest-Rundenzeit (s)</label><input type="number" id="setMinLap" value="10" min="3" max="300"></div>
```

with:

```
        <div class="field"><label>Mindest-Rundenzeit (s)</label><input type="number" id="setMinLap" value="10" min="3" max="300"></div>
        <div class="field"><label>Drift-Empfindlichkeit (Toleranz)</label><input type="number" id="setDriftTol" value="0.25" min="0.05" max="1" step="0.05"></div>
        <div class="field"><label>Drift Min-Tempo (km/h)</label><input type="number" id="setDriftMinSpeed" value="5" min="1" max="60" step="1"></div>
```

- [ ] **Step 4: Load settings → UI** — Edit `rasicross.js`, replace exactly:

```
  $('setMinLap').value = state.settings.minLapSeconds;
```

with:

```
  $('setMinLap').value = state.settings.minLapSeconds;
  if ($('setDriftTol')) $('setDriftTol').value = state.settings.drift.tol;
  if ($('setDriftMinSpeed')) $('setDriftMinSpeed').value = state.settings.drift.minSpeedKmh;
```

- [ ] **Step 5: Save UI → settings (clamped)** — Edit `rasicross.js`, replace exactly:

```
  state.settings.minLapSeconds = Math.max(3, Math.min(300, Number($('setMinLap').value) || 10));
```

with:

```
  state.settings.minLapSeconds = Math.max(3, Math.min(300, Number($('setMinLap').value) || 10));
  if (!state.settings.drift) state.settings.drift = { tol: 0.25, minSpeedKmh: 5, minLatG: 0.15 };
  state.settings.drift.tol = Math.max(0.05, Math.min(1, Number($('setDriftTol')?.value) || 0.25));
  state.settings.drift.minSpeedKmh = Math.max(1, Math.min(60, Number($('setDriftMinSpeed')?.value) || 5));
```

- [ ] **Step 6: Verify**

Run: `node --check rasicross.js` → exit 0.
Run: `node --test` → `tests 61 | pass 61 | fail 0`.
Run: `npx eslint rasicross.js` → exit 0.
Run (Grep tool) on `RasiCross_Telemetry.html`: `id="setDriftTol"` → 1; `id="setDriftMinSpeed"` → 1. On `rasicross.js`: `drift: \{ tol: 0\.25` → 1 (settings init); `state\.settings\.drift\.tol =` → 1; `setDriftMinSpeed` → 2.
Note: `state.settings.drift` (with `minLatG`) is passed as the `opts` arg to `RasiDrift.analyze` in Task 3 — the keys (`tol`, `minSpeedKmh`, `minLatG`) match the module's option names. `minLatG` has no UI field (sensible default 0.15) and is preserved by the load/save (the slice object is kept; only `tol`/`minSpeedKmh` are overwritten).

- [ ] **Step 7: Commit**

```bash
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" add rasicross.js RasiCross_Telemetry.html
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" commit -m "feat(drift): drift sensitivity + min-speed in Settings

state.settings.drift { tol, minSpeedKmh, minLatG }; two number fields
load/save with clamping. Passed as opts to RasiDrift.analyze.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 6: Replay summary (drift % + max index)

**Files:**
- Modify: `RasiCross_Telemetry.html` (replay-bar `#rpDrift`)
- Modify: `rasicross.js` (`enterReplay` computes summary; `exitReplay`/`updateReplayHud` resets the text)

Context: `enterReplay(parsed)` (`rasicross.js:3401`) sets `state.replay.packets = parsed.packets`. The replay bar (`RasiCross_Telemetry.html:3341-3353`) has `rpElapsed`/`rpTotal`. Recording packets carry `yaw`/`gy`/`speed` (raw, from `recordPacket`).

- [ ] **Step 1: Read** `RasiCross_Telemetry.html` the replay-bar block (~3341-3353, the `rp-time` span) and `rasicross.js` `enterReplay` (~3401-3424). Copy anchors.

- [ ] **Step 2: Add `#rpDrift` to the replay bar** — Edit `RasiCross_Telemetry.html`, replace exactly:

```
  <span class="rp-time"><b id="rpElapsed">00:00</b> / <b id="rpTotal">00:00</b></span>
```

with:

```
  <span class="rp-time"><b id="rpElapsed">00:00</b> / <b id="rpTotal">00:00</b></span>
  <span class="rp-time" title="Drift-Zeitanteil · stärkster Index">Drift <b id="rpDrift">–</b></span>
```

- [ ] **Step 3: Compute + show the summary in `enterReplay`** — Edit `rasicross.js`, replace exactly:

```
  state.replay.packets = parsed.packets;
  state.replay.idx = 0;
```

with:

```
  state.replay.packets = parsed.packets;
  const _ds = RasiDrift.summarize(parsed.packets, state.settings.drift);
  state.replay.driftSummary = _ds;
  setText('rpDrift', _ds.counted ? `${_ds.driftPct.toFixed(0)}% · max ${_ds.maxIndex.toFixed(1)}` : '–');
  state.replay.idx = 0;
```

- [ ] **Step 4: Verify**

Run: `node --check rasicross.js` → exit 0.
Run: `node --test` → `tests 61 | pass 61 | fail 0`.
Run: `npx eslint rasicross.js` → exit 0.
Run (Grep tool) on `RasiCross_Telemetry.html`: `id="rpDrift"` → 1. On `rasicross.js`: `RasiDrift\.summarize` → 1; `state\.replay\.driftSummary` → 1; `setText\('rpDrift'` → 1.

- [ ] **Step 5: Commit**

```bash
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" add rasicross.js RasiCross_Telemetry.html
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" commit -m "feat(drift): replay drift summary (time-share + max index)

enterReplay runs RasiDrift.summarize over the loaded recording and
shows '% · max N' in the replay bar. Live badge already updates per
frame while scrubbing.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 7: Replay drift-phase marker strip

**Files:**
- Modify: `RasiCross_Telemetry.html` (wrap `#rpSeek`, add `#rpDriftStrip`, CSS)
- Modify: `rasicross.js` (`renderDriftStrip` + call in `enterReplay`)

Context: the seek control is `<input id="rpSeek" class="rp-seek">` with CSS `.replay-bar .rp-seek{flex:1;min-width:120px;…}` (`RasiCross_Telemetry.html:2140`). We wrap it in a relative container and overlay proportional ticks for each drift phase (`RasiDrift.driftSpans`).

- [ ] **Step 1: Read** `RasiCross_Telemetry.html` the `.replay-bar .rp-seek{…}` CSS rule (~2140) and the `<input … id="rpSeek" …>` line (~3343). Copy both anchors.

- [ ] **Step 2: Wrap the seek input** — Edit `RasiCross_Telemetry.html`, replace exactly:

```
  <input type="range" id="rpSeek" class="rp-seek" min="0" max="1000" value="0">
```

with:

```
  <span class="rp-seek-wrap"><span id="rpDriftStrip" class="rp-drift-strip"></span><input type="range" id="rpSeek" class="rp-seek" min="0" max="1000" value="0"></span>
```

- [ ] **Step 3: Add the strip CSS** — Edit `RasiCross_Telemetry.html`, replace exactly:

```
.replay-bar .rp-seek{flex:1;min-width:120px;accent-color:var(--pr,#7aa2f7)}
```

with:

```
.replay-bar .rp-seek-wrap{position:relative;flex:1;min-width:120px;display:flex;align-items:center}
.replay-bar .rp-seek-wrap .rp-seek{flex:1;width:100%;accent-color:var(--pr,#7aa2f7)}
.replay-bar .rp-drift-strip{position:absolute;left:0;right:0;top:-7px;height:4px;pointer-events:none}
.replay-bar .rp-drift-strip i{position:absolute;top:0;height:4px;background:var(--warn,#e0a13a);border-radius:2px;min-width:2px}
```

- [ ] **Step 4: Add `renderDriftStrip` + call it in `enterReplay`** — Edit `rasicross.js`, replace exactly (the block added in Task 6 Step 3):

```
  state.replay.driftSummary = _ds;
  setText('rpDrift', _ds.counted ? `${_ds.driftPct.toFixed(0)}% · max ${_ds.maxIndex.toFixed(1)}` : '–');
  state.replay.idx = 0;
```

with:

```
  state.replay.driftSummary = _ds;
  setText('rpDrift', _ds.counted ? `${_ds.driftPct.toFixed(0)}% · max ${_ds.maxIndex.toFixed(1)}` : '–');
  renderDriftStrip(RasiDrift.driftSpans(parsed.packets, state.settings.drift), parsed.durationMs);
  state.replay.idx = 0;
```

- [ ] **Step 5: Add the `renderDriftStrip` helper** — Edit `rasicross.js`, replace exactly:

```
function loadRecordingFile(file) {
```

with:

```
// Drift-Phasen als proportionale Marker über dem Replay-Seek (Phase 18).
function renderDriftStrip(spans, durationMs) {
  const strip = $('rpDriftStrip');
  if (!strip) return;
  strip.innerHTML = '';
  const dur = Number(durationMs) || 0;
  if (!dur || !spans || !spans.length) return;
  for (const s of spans) {
    const a = Math.max(0, Math.min(100, s.startMs / dur * 100));
    const b = Math.max(0, Math.min(100, s.endMs / dur * 100));
    const tick = document.createElement('i');
    tick.style.left = a + '%';
    tick.style.width = Math.max(0.3, b - a) + '%';
    strip.appendChild(tick);
  }
}
function loadRecordingFile(file) {
```

- [ ] **Step 6: Verify**

Run: `node --check rasicross.js` → exit 0.
Run: `node --test` → `tests 61 | pass 61 | fail 0`.
Run: `npx eslint rasicross.js` → exit 0.
Run (Grep tool) on `RasiCross_Telemetry.html`: `id="rpDriftStrip"` → 1; `rp-seek-wrap` → 3 (1 HTML + 2 CSS); `rp-drift-strip` → 3 (1 HTML + 2 CSS). On `rasicross.js`: `function renderDriftStrip` → 1; `renderDriftStrip\(RasiDrift\.driftSpans` → 1.

- [ ] **Step 7: Commit**

```bash
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" add rasicross.js RasiCross_Telemetry.html
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" commit -m "feat(drift): replay drift-phase marker strip over the seek bar

RasiDrift.driftSpans -> proportional ticks above #rpSeek (wrapped in a
relative container). Cleared/redrawn on each recording load.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 8: Phase verification, plan commit & push

**Files:** none (verification + push); commits the Phase 18 plan doc.

- [ ] **Step 1: Full local CI dry-run** (clone root; `py -3` if `python` absent):
```
node --check geo.js
node --check replay.js
node --check drift.js
node --check rasicross.js
node --check main.js
node --check preload.js
npx eslint .
npm test
python -m py_compile sender.py bridge.py esp_libs/micropyGPS.py esp_libs/mpu6050.py esp_libs/oled_diagnose.py esp_libs/ssd1306.py esp_libs/calc.py
python -m unittest discover -s test -p "test_*.py"
```
Expected: all exit 0; `npm test` / `node --test` = `tests 61 | pass 61 | fail 0`; `unittest` = `Ran 34 tests` `OK` (unchanged — Phase 18 adds no Python). Delete any `__pycache__` (Bash: `find . -name __pycache__ -type d -prune -exec rm -rf {} + 2>/dev/null`) before `git status`. Confirm `git -C "…" status --short` shows no `.pyc`/`__pycache__` (only the untracked plan doc until Step 3, plus untracked `.claude/`).

- [ ] **Step 2: Backward-compat + additivity spot-check**
- Grep `rasicross.js`: no existing packet key renamed; the drift call only **adds** `state.drift`/`state.charts.driftIndex` and reads `yawv`/`gy`/`speed` already in scope. `RRASI`… (sanity) — confirm `RasiDrift.analyze` is the only new call in `processTelemetry`.
- Confirm old recordings work: `RasiDrift.summarize`/`driftSpans` read `p.yaw`/`p.gy`/`p.speed` and tolerate absence (→ `'n/a'`, no drift). A pre-Phase-5 recording without `yaw` simply yields `0%`/empty strip — no crash.
- Confirm no ESP/protocol bytes touched (no `frame.py`/`sender.py`/`bridge.py` diff in this phase).

- [ ] **Step 3: Commit the plan document**
```bash
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" add docs/superpowers/plans/2026-05-30-18-drift-detection.md
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" commit -m "docs: phase 18 implementation plan (drift detection D1-D6)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

- [ ] **Step 4: Push**
```bash
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" push
```
Credentials cached this session — should be silent. If it hangs >30 s on auth, report BLOCKED (do not loop).

- [ ] **Step 5: Deferred to user (do NOT attempt here):** GitHub Actions `check` confirmation (no `gh` CLI) and the manual dashboard smoke below. Note them as pending in the report.

---

## Manual Acceptance Checklist (user-run — dashboard only, no ESP flash)

Open `RasiCross_Telemetry.html` in the desktop app (or Chromium) and:

1. **Demo/Live straight & slow:** Drift badge shows `–` (or `Grip`) — **no false alarm** at standstill / on straights.
2. **Cornering:** during a clean steady corner the badge reads `Grip` (index ≈ 1, green). Provoke the tail stepping out → badge flips to `Drift` (amber, index > 1); push/understeer → `Schiebt` (blue, index < 1).
3. **Counter/Spin:** a hard counter-steer / spin shows `Spin` (red).
4. **Settings:** lower "Drift-Empfindlichkeit (Toleranz)" → drift triggers more readily; raise "Drift Min-Tempo" → no drift status below that speed. Values persist across reload.
5. **Replay:** load a recording made on real hardware (with `yaw`/`gy`/`speed`). Replay bar shows `Drift NN% · max N.N`; amber ticks mark drift phases above the seek bar; the live badge tracks drift as you scrub/play. Exiting replay restores the live state (badge returns to live values).
6. **Old recording:** a recording without IMU fields shows `Drift –` / empty strip — no error in the console.

---

## Self-Review

**1. Spec coverage (§3 Phase 18, D1–D6):**
- D1 pure `drift.js` module + unit tests → Task 1 (`expectedYawRate`/`analyze`/`summarize`/`driftSpans`, 9 tests). ✅
- D2 live calc in `processTelemetry` + `state.drift` → Task 3. ✅
- D3 live badge in G-Kraft KPI sub-line → Task 4 (`#kDrift`, `renderDriftBadge`, colour). ✅
- D4 replay auswertung (summary + marked drift phases) → Task 6 (`summarize` → `#rpDrift`) + Task 7 (`driftSpans` → marker strip) + the live badge updating during replay (Task 3 wiring via `feedReplayPacket`). ✅
- D5 settings (tolerance + min-speed gate) → Task 5 (`state.settings.drift`, two fields, clamped load/save). ✅
- D6 `build.files`/`eslint.config.js`/script tag → Task 2. ✅

**2. Placeholder scan:** No `TBD`/`TODO`. Every code step has complete literal code; every command has an expected result. ✅

**3. Type/name consistency:** Module API `RasiDrift.{expectedYawRate,analyze,summarize,driftSpans}` defined Task 1, consumed Task 3 (`analyze`), Task 6 (`summarize`), Task 7 (`driftSpans`). `analyze` input keys `{yawRate,latAccel,speed}` and opts `{tol,minSpeedKmh,minLatG}` match `state.settings.drift` (Task 5). `state.drift` shape `{status,index}` produced Task 3, read by `renderDriftBadge` (Task 4). DOM ids `kDrift`/`rpDrift`/`rpDriftStrip` identical in HTML and `rasicross.js`. `state.charts.driftIndex` added to main init + reset + trimmed (Task 3). `'drift'` added to REPLAY_KEYS (Task 3). `renderDriftStrip(spans,durationMs)` defined + called once (Task 7). ✅

**4. Notes / deliberate scope:**
- The replay **live badge** works without extra plumbing because `feedReplayPacket`→`processTelemetry` updates `state.drift` per fed packet — so "Drift-Phasen" are visible both as the moving badge during playback **and** as the static marker strip (Task 7). Spec §5.3's "Phasen markiert" is satisfied by the strip.
- `summarize`/`driftSpans` read the **raw** recorded `gy` (no swap/invert calibration applied — that lives only in the live `processTelemetry` path). For a drift *time-share* statistic this is acceptable and documented; the sign/threshold logic is symmetric in `|gy|` except the counter-sign check (orientation note, spec §4.4).
- No `calc.py`/`frame.py`/ESP changes; `unittest` stays `Ran 34 tests`. JS goes 52 → 61.
- Colour CSS vars (`--green`/`--warn`/`--blue`/`--danger`) are referenced with hex fallbacks in JS, so the badge is correct even if a theme omits one.

---

## Phase Map

Phase **18 of the drift/roll spec (part 1 of 2)**. Delivers drift detection on existing telemetry, dashboard-only, no firmware. Next: Phase **19** — roll-angle / wheel-lift (frame v2 emits gyro-X roll rate, `attitude.js` complementary filter + empirical lift threshold, optional ±4 g). Phase 19 is planned separately and reflashes both ESPs. Pitch-axis (front/rear lift) and sideslip-β remain deferred.
