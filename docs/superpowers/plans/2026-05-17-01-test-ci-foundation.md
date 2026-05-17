# Phase 1 — Test & CI Foundation (B1 + B2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a zero-runtime-risk test + CI safety net: extract the 9 pure lap/geo/format helpers into a tested `geo.js` module and add a GitHub CI check workflow — with **no change to dashboard behavior**.

**Architecture:** `geo.js` becomes the single source of the pure helpers. It is loaded as a classic `<script>` *before* `rasicross.js` and assigns the **same global names** the code already uses, so existing call sites are untouched and zero call-site edits are needed. It also exports via CommonJS for Node's built-in test runner. `rasicross.js` loses only its duplicate definitions. A `check.yml` workflow runs `node --check`, `npm test`, and `python -m py_compile` on push/PR.

**Tech Stack:** Node ≥ 18 built-in `node:test` / `node:assert` (no new npm dependencies, no `node_modules` needed to run tests), GitHub Actions, Python 3 stdlib (`py_compile`, compile-only so MicroPython-only imports do not fail).

---

## Working Directory & Conventions

**All work happens in the git clone, not the archive:**

```
C:/Users/jimlu/Documents/RasiCross-Telemetrie-git
```

(Branch `docs/telemetry-improvements-spec`, already checked out, spec committed.)

- All file paths below are **relative to that clone root** unless absolute.
- Files in the clone use **CRLF** line endings (Windows checkout). Always `Read` the target file in-session immediately before an `Edit` and copy the `old_string` anchor from that fresh Read, so matching is byte-exact regardless of line endings.
- Git commands use `git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" …`.
- This plan does **not** touch the non-git archive at `…/RasiCross-Telemetrie-main`.

**Spec reference:** `docs/superpowers/specs/2026-05-17-rasicross-telemetry-improvements-design.md` §5 B1, §5 B2, §7.

**Behavioral invariant for this phase:** the dashboard must behave **identically** before and after. The only changes are: where the 9 functions live, a new `<script>` tag, a `test/` dir, a `package.json` test script, and a CI workflow.

---

## File Structure

| Action | Path | Responsibility |
|--------|------|----------------|
| Create | `geo.js` | Single source of the 9 pure helpers; UMD-style (global + CommonJS). Dependency-free. |
| Create | `test/geo.test.js` | `node:test` characterization tests for all 9 helpers. |
| Modify | `package.json` | Add `"test"` script (currently none). |
| Modify | `rasicross.js` | Delete the 9 duplicate function definitions only. Keep `setText`, `logTime`, comments. |
| Modify | `RasiCross_Telemetry.html` | Add `<script src="geo.js"></script>` immediately before the `rasicross.js` script. |
| Create | `.github/workflows/check.yml` | CI: `node --check`, `npm test`, `py_compile`. |

The 9 extracted functions (verbatim from current `rasicross.js`): `fmtMs`, `fmtClock`, `fmtDelta`, `traceDistanceM`, `gpsDist`, `headingFromPoints`, `segmentsCross`, `crossingDirectionOk`, `lineEndpointsFromGate`. `setText` (uses DOM `$`) and `logTime` (locale/Date) are **not** extracted — they stay in `rasicross.js`.

---

### Task 1: Create `geo.js`

**Files:**
- Create: `geo.js`

- [ ] **Step 1: Write the failing test (module does not exist yet)**

Create `test/geo.test.js`:

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const geo = require('../geo.js');

const approx = (a, b, tol = 1e-3) => assert.ok(Math.abs(a - b) <= tol, `${a} != ${b} (±${tol})`);

test('module exports all 9 helpers', () => {
  for (const name of ['fmtMs','fmtClock','fmtDelta','traceDistanceM','gpsDist',
                       'headingFromPoints','segmentsCross','crossingDirectionOk',
                       'lineEndpointsFromGate']) {
    assert.equal(typeof geo[name], 'function', `missing ${name}`);
  }
});

test('gpsDist', () => {
  assert.equal(geo.gpsDist(0, 0, 0, 0), 0);
  approx(geo.gpsDist(0, 0, 0, 1), 111194.92664455873, 1e-3);
  approx(geo.gpsDist(0, 0, 1, 0), 111194.92664455873, 1e-3);
});

test('traceDistanceM', () => {
  assert.equal(geo.traceDistanceM(null), 0);
  assert.equal(geo.traceDistanceM([{lat:0,lon:0}]), 0);
  approx(geo.traceDistanceM([{lat:0,lon:0},{lat:0,lon:1}]), 111194.92664455873, 1e-3);
  // entries with null lat are skipped
  approx(geo.traceDistanceM([{lat:0,lon:0},{lat:null,lon:1},{lat:0,lon:1}]), 0, 1e-9);
});

test('headingFromPoints (degrees, 0=north, cw)', () => {
  assert.equal(geo.headingFromPoints(null, {lat:1,lon:0}), 0);
  assert.equal(geo.headingFromPoints({lat:0,lon:0}, {lat:1,lon:0}), 0);    // north
  assert.equal(geo.headingFromPoints({lat:0,lon:0}, {lat:0,lon:1}), 90);   // east
  assert.equal(geo.headingFromPoints({lat:0,lon:0}, {lat:-1,lon:0}), 180); // south
  assert.equal(geo.headingFromPoints({lat:0,lon:0}, {lat:0,lon:-1}), 270); // west
});

test('segmentsCross', () => {
  const a1={lat:0,lon:-1}, a2={lat:0,lon:1}, b1={lat:-1,lon:0}, b2={lat:1,lon:0};
  assert.equal(geo.segmentsCross(a1,a2,b1,b2), true);   // cross at origin
  // parallel, non-touching
  assert.equal(geo.segmentsCross({lat:0,lon:0},{lat:0,lon:1},
                                  {lat:1,lon:0},{lat:1,lon:1}), false);
  // disjoint
  assert.equal(geo.segmentsCross({lat:0,lon:0},{lat:0,lon:0.4},
                                  {lat:-1,lon:0.6},{lat:1,lon:0.6}), false);
});

test('crossingDirectionOk', () => {
  assert.equal(geo.crossingDirectionOk(0,0,1,0,null), true);  // no expected heading
  assert.equal(geo.crossingDirectionOk(0,0,1,0,0),   true);   // moving north, expect north
  assert.equal(geo.crossingDirectionOk(0,0,1,0,180), false);  // moving north, expect south
  assert.equal(geo.crossingDirectionOk(0,0,1,0,80),  true);   // within 90°
  assert.equal(geo.crossingDirectionOk(0,0,1,0,95),  false);  // beyond 90°
});

test('lineEndpointsFromGate', () => {
  assert.equal(geo.lineEndpointsFromGate(null), null);
  assert.equal(geo.lineEndpointsFromGate({lat:0,lon:5}), null); // lat 0 is falsy → null (existing behavior)
  const ep = geo.lineEndpointsFromGate({lat:49.6, lon:6.12, width:14, heading:0});
  assert.ok(ep && ep.p1 && ep.p2);
  approx(ep.p1.lat, 49.6, 1e-4);
  approx(ep.p2.lat, 49.6, 1e-4);
  approx((ep.p1.lon + ep.p2.lon) / 2, 6.12, 1e-9); // symmetric about gate lon
  assert.ok(ep.p1.lon !== ep.p2.lon);
});

test('fmtMs', () => {
  assert.equal(geo.fmtMs(null), '--:--.---');
  assert.equal(geo.fmtMs(Infinity), '--:--.---');
  assert.equal(geo.fmtMs(0), '0:00.000');
  assert.equal(geo.fmtMs(61234), '1:01.234');
  assert.equal(geo.fmtMs(-1500), '-0:01.500');
});

test('fmtClock', () => {
  assert.equal(geo.fmtClock(null), '--:--');
  assert.equal(geo.fmtClock(0), '00:00');
  assert.equal(geo.fmtClock(61000), '01:01');
  assert.equal(geo.fmtClock(3661000), '1:01:01');
});

test('fmtDelta', () => {
  assert.equal(geo.fmtDelta(null), '--');
  assert.equal(geo.fmtDelta(0), '+0.000s');
  assert.equal(geo.fmtDelta(1234), '+1.234s');
  assert.equal(geo.fmtDelta(-1234), '-1.234s');
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test`
Expected: FAIL — `Cannot find module '../geo.js'` (file not created yet).

- [ ] **Step 3: Create `geo.js` with the 9 helpers verbatim + UMD wiring**

Create `geo.js` (function bodies are copied **verbatim** from the current `rasicross.js`; only their location changes):

```js
'use strict';
// ============================================================
//  geo.js — pure lap/geo/format helpers (RasiCross)
//  Single source of truth. Loaded as a classic <script> BEFORE
//  rasicross.js (assigns the same global names the app already
//  uses, so call sites are unchanged) and as a CommonJS module
//  for node:test. Dependency-free. No DOM, no globals besides
//  the explicit assignments at the bottom.
// ============================================================

function fmtMs(ms) {
  if (ms == null || !isFinite(ms)) return '--:--.---';
  const sign = ms < 0 ? '-' : '';
  ms = Math.abs(Math.round(ms));
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const msr = ms % 1000;
  return `${sign}${m}:${String(s).padStart(2,'0')}.${String(msr).padStart(3,'0')}`;
}
function fmtClock(ms) {
  if (ms == null || !isFinite(ms)) return '--:--';
  ms = Math.max(0, Math.round(ms));
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return h ? `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}` : `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
}
function fmtDelta(ms) {
  if (ms == null) return '--';
  const sign = ms >= 0 ? '+' : '';
  return sign + (ms / 1000).toFixed(3) + 's';
}

function gpsDist(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const mLat = ((lat1 + lat2) / 2) * Math.PI / 180;
  return Math.sqrt((R * dLon * Math.cos(mLat)) ** 2 + (R * dLat) ** 2);
}

// Aufsummierte GPS-Distanz eines Tracks (Polyline-Laenge in Metern)
function traceDistanceM(trace) {
  if (!trace || trace.length < 2) return 0;
  let m = 0;
  for (let i = 1; i < trace.length; i++) {
    const a = trace[i - 1], b = trace[i];
    if (a && b && a.lat != null && b.lat != null) {
      m += gpsDist(a.lat, a.lon, b.lat, b.lon);
    }
  }
  return m;
}

function headingFromPoints(p1, p2) {
  if (!p1 || !p2) return 0;
  const dLat = p2.lat - p1.lat;
  const dLon = p2.lon - p1.lon;
  return ((Math.atan2(dLon, dLat) * 180 / Math.PI) + 360) % 360;
}
function segmentsCross(a1, a2, b1, b2) {
  const d = (a2.lon - a1.lon) * (b2.lat - b1.lat) - (a2.lat - a1.lat) * (b2.lon - b1.lon);
  if (Math.abs(d) < 1e-12) return false;
  const t = ((b1.lon - a1.lon) * (b2.lat - b1.lat) - (b1.lat - a1.lat) * (b2.lon - b1.lon)) / d;
  const u = ((b1.lon - a1.lon) * (a2.lat - a1.lat) - (b1.lat - a1.lat) * (a2.lon - a1.lon)) / d;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1;
}
function crossingDirectionOk(prevLat, prevLon, lat, lon, expectedHeading) {
  if (expectedHeading == null) return true;
  const moveHead = ((Math.atan2(lon - prevLon, lat - prevLat) * 180 / Math.PI) + 360) % 360;
  const exp = ((Number(expectedHeading) || 0) + 360) % 360;
  const diff = Math.abs(((moveHead - exp) + 540) % 360 - 180);
  return diff < 90;
}
function lineEndpointsFromGate(gate) {
  if (!gate || !gate.lat) return null;
  const w = (Number(gate.width) || 14) / 2;
  const headingPerp = (((Number(gate.heading) || 0) + 90) * Math.PI / 180);
  const R = 6371000;
  const lt = gate.lat * Math.PI / 180;
  const dLat = w * Math.cos(headingPerp) / R * 180 / Math.PI;
  const dLon = w * Math.sin(headingPerp) / (R * Math.cos(lt)) * 180 / Math.PI;
  return { p1: { lat: gate.lat + dLat, lon: gate.lon + dLon }, p2: { lat: gate.lat - dLat, lon: gate.lon - dLon } };
}

// ── UMD-style export ────────────────────────────────────────
(function () {
  var api = {
    fmtMs: fmtMs, fmtClock: fmtClock, fmtDelta: fmtDelta,
    gpsDist: gpsDist, traceDistanceM: traceDistanceM,
    headingFromPoints: headingFromPoints, segmentsCross: segmentsCross,
    crossingDirectionOk: crossingDirectionOk, lineEndpointsFromGate: lineEndpointsFromGate
  };
  if (typeof module !== 'undefined' && module.exports) { module.exports = api; }
  if (typeof window !== 'undefined') {
    for (var k in api) { if (Object.prototype.hasOwnProperty.call(api, k)) window[k] = api[k]; }
  }
})();
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test`
Expected: PASS — all `geo.test.js` tests pass (10 test blocks).

- [ ] **Step 5: Syntax-check geo.js standalone**

Run: `node --check geo.js`
Expected: no output, exit 0.

- [ ] **Step 6: Commit**

```bash
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" add geo.js test/geo.test.js
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" commit -m "test: extract pure lap/geo/format helpers into tested geo.js

geo.js is the single source of fmtMs/fmtClock/fmtDelta/gpsDist/
traceDistanceM/headingFromPoints/segmentsCross/crossingDirectionOk/
lineEndpointsFromGate. node:test characterization suite, zero new deps.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 2: Add `npm test` script

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Read `package.json` to anchor the edit**

Run: Read `C:/Users/jimlu/Documents/RasiCross-Telemetrie-git/package.json` (confirm the `scripts` block; there is currently **no** `test` script — npm's default would error).

- [ ] **Step 2: Add the test script**

Edit `package.json` — replace:

```
    "start": "electron .",
```

with:

```
    "start": "electron .",
    "test": "node --test",
```

> **Invocation note:** the script uses `node --test` with **no path** (not `node --test test/`). On Node ≥ 24 the directory form `node --test test/` misbehaves; the no-path form auto-discovers files under `test/` per Node's default test-discovery rules, works on Node 20 (CI) and 24 (local), and automatically picks up later phases' test files. Verified by the controller.

- [ ] **Step 3: Verify `package.json` is still valid JSON and the script runs**

Run: `node -e "JSON.parse(require('fs').readFileSync('package.json','utf8')); console.log('json ok')"`
Expected: `json ok`

Run: `npm test`
Expected: PASS — same `geo.test.js` results as Task 1 Step 4 (npm does not install anything; `node --test` needs no `node_modules`).

- [ ] **Step 4: Commit**

```bash
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" add package.json
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" commit -m "build: add npm test script (node --test)

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 3: Remove the duplicate definitions from `rasicross.js`

**Files:**
- Modify: `rasicross.js` (delete 3 blocks; keep `setText`, `logTime`, surrounding comments)

Rationale: `rasicross.js` is a classic (non-module) script that loads **after** `geo.js`. If both define `function gpsDist(){}` at top level, `rasicross.js`'s definition wins the global binding → the app would use a copy the tests don't cover (drift). So the duplicates must be deleted; the bare calls (`gpsDist(...)`, `fmtMs(...)`) then resolve to the globals `geo.js` assigned.

- [ ] **Step 1: Characterize current behavior (safety net already exists)**

The `geo.test.js` suite from Task 1 is the characterization. Run it once more to confirm green baseline before editing `rasicross.js`:

Run: `node --test`
Expected: PASS.

- [ ] **Step 2: Read `rasicross.js` lines 80–165 to copy exact anchors**

Run: Read `C:/Users/jimlu/Documents/RasiCross-Telemetrie-git/rasicross.js` offset 80 limit 90. Copy the three blocks below exactly as they appear (CRLF-safe: copy from this Read).

- [ ] **Step 3: Delete block A (fmtMs / fmtClock / fmtDelta)**

Edit `rasicross.js` — replace this exact block:

```
function fmtMs(ms) {
  if (ms == null || !isFinite(ms)) return '--:--.---';
  const sign = ms < 0 ? '-' : '';
  ms = Math.abs(Math.round(ms));
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const msr = ms % 1000;
  return `${sign}${m}:${String(s).padStart(2,'0')}.${String(msr).padStart(3,'0')}`;
}
function fmtClock(ms) {
  if (ms == null || !isFinite(ms)) return '--:--';
  ms = Math.max(0, Math.round(ms));
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return h ? `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}` : `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
}
function fmtDelta(ms) {
  if (ms == null) return '--';
  const sign = ms >= 0 ? '+' : '';
  return sign + (ms / 1000).toFixed(3) + 's';
}
```

with:

```
// fmtMs / fmtClock / fmtDelta moved to geo.js (loaded as a <script> before rasicross.js; also a CommonJS module for tests)
```

- [ ] **Step 4: Delete block B (traceDistanceM + its comment)**

Edit `rasicross.js` — replace this exact block:

```
// Aufsummierte GPS-Distanz eines Tracks (Polyline-Laenge in Metern)
function traceDistanceM(trace) {
  if (!trace || trace.length < 2) return 0;
  let m = 0;
  for (let i = 1; i < trace.length; i++) {
    const a = trace[i - 1], b = trace[i];
    if (a && b && a.lat != null && b.lat != null) {
      m += gpsDist(a.lat, a.lon, b.lat, b.lon);
    }
  }
  return m;
}
```

with:

```
// traceDistanceM moved to geo.js
```

- [ ] **Step 5: Delete block C (gpsDist / headingFromPoints / segmentsCross / crossingDirectionOk / lineEndpointsFromGate)**

Edit `rasicross.js` — replace this exact block:

```
function gpsDist(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const mLat = ((lat1 + lat2) / 2) * Math.PI / 180;
  return Math.sqrt((R * dLon * Math.cos(mLat)) ** 2 + (R * dLat) ** 2);
}
function headingFromPoints(p1, p2) {
  if (!p1 || !p2) return 0;
  const dLat = p2.lat - p1.lat;
  const dLon = p2.lon - p1.lon;
  return ((Math.atan2(dLon, dLat) * 180 / Math.PI) + 360) % 360;
}
function segmentsCross(a1, a2, b1, b2) {
  const d = (a2.lon - a1.lon) * (b2.lat - b1.lat) - (a2.lat - a1.lat) * (b2.lon - b1.lon);
  if (Math.abs(d) < 1e-12) return false;
  const t = ((b1.lon - a1.lon) * (b2.lat - b1.lat) - (b1.lat - a1.lat) * (b2.lon - b1.lon)) / d;
  const u = ((b1.lon - a1.lon) * (a2.lat - a1.lat) - (b1.lat - a1.lat) * (a2.lon - a1.lon)) / d;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1;
}
function crossingDirectionOk(prevLat, prevLon, lat, lon, expectedHeading) {
  if (expectedHeading == null) return true;
  const moveHead = ((Math.atan2(lon - prevLon, lat - prevLat) * 180 / Math.PI) + 360) % 360;
  const exp = ((Number(expectedHeading) || 0) + 360) % 360;
  const diff = Math.abs(((moveHead - exp) + 540) % 360 - 180);
  return diff < 90;
}
function lineEndpointsFromGate(gate) {
  if (!gate || !gate.lat) return null;
  const w = (Number(gate.width) || 14) / 2;
  const headingPerp = (((Number(gate.heading) || 0) + 90) * Math.PI / 180);
  const R = 6371000;
  const lt = gate.lat * Math.PI / 180;
  const dLat = w * Math.cos(headingPerp) / R * 180 / Math.PI;
  const dLon = w * Math.sin(headingPerp) / (R * Math.cos(lt)) * 180 / Math.PI;
  return { p1: { lat: gate.lat + dLat, lon: gate.lon + dLon }, p2: { lat: gate.lat - dLat, lon: gate.lon - dLon } };
}
```

with:

```
// gpsDist / headingFromPoints / segmentsCross / crossingDirectionOk / lineEndpointsFromGate moved to geo.js
```

- [ ] **Step 6: Verify no duplicate definitions remain and syntax is valid**

Run: `node --check rasicross.js`
Expected: no output, exit 0.

Run (Grep tool, not shell): pattern `^function (fmtMs|fmtClock|fmtDelta|gpsDist|traceDistanceM|headingFromPoints|segmentsCross|crossingDirectionOk|lineEndpointsFromGate)\b` in `rasicross.js`.
Expected: **0 matches** (all now live only in `geo.js`).

Run (Grep tool): same pattern in `geo.js`.
Expected: 9 matches (one per helper).

- [ ] **Step 7: Commit**

```bash
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" add rasicross.js
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" commit -m "refactor: drop duplicate helpers from rasicross.js (now sourced from geo.js)

No behavior change: geo.js loads first and assigns the same global names.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 4: Load `geo.js` in the dashboard before `rasicross.js`

**Files:**
- Modify: `RasiCross_Telemetry.html` (one line, near end of file)

- [ ] **Step 1: Read the end of the HTML to anchor the edit**

Run: Read `C:/Users/jimlu/Documents/RasiCross-Telemetrie-git/RasiCross_Telemetry.html` offset 2850 limit 8. Confirm the line `<script src="rasicross.js"></script>` is present (it is the only script tag in the file).

- [ ] **Step 2: Insert the geo.js script tag immediately before rasicross.js**

Edit `RasiCross_Telemetry.html` — replace:

```
<script src="rasicross.js"></script>
```

with:

```
<script src="geo.js"></script>
<script src="rasicross.js"></script>
```

- [ ] **Step 3: Verify ordering and uniqueness**

Run (Grep tool): pattern `<script src="(geo|rasicross)\.js"></script>` in `RasiCross_Telemetry.html`, output mode content.
Expected: exactly two lines, `geo.js` line appearing **before** `rasicross.js` line.

- [ ] **Step 4: Manual smoke (no automated DOM here) — record as a checklist item**

The dashboard cannot be auto-tested without a DOM. Add to the Phase 1 manual-verification checklist (Task 6): open `RasiCross_Telemetry.html` in Electron (`npm start`) **and** a Chromium browser; confirm: no console errors, lap/sector detection still works in Demo mode (start Demo, drive a lap, lap time appears), and time strings render (`fmtMs`/`fmtClock`) — proving the globals resolve from `geo.js`.

- [ ] **Step 5: Commit**

```bash
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" add RasiCross_Telemetry.html
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" commit -m "build: load geo.js before rasicross.js in the dashboard

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 5: Add the CI check workflow

**Files:**
- Create: `.github/workflows/check.yml`

Note: the existing tag-triggered `.github/workflows/build.yml` is **not** modified. `npm test` runs `node --test` which needs no dependencies, so the JS job does **not** run `npm install` (avoids downloading Electron in CI). `py_compile` is compile-only: MicroPython-only imports (`network`, `espnow`, `machine`, `esp32`) do not cause failure because the modules are byte-compiled, not imported.

- [ ] **Step 1: Create the workflow**

Create `.github/workflows/check.yml`:

```yaml
name: check

on:
  push:
  pull_request:

jobs:
  js:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - name: Syntax-check JS
        run: |
          node --check geo.js
          node --check rasicross.js
          node --check main.js
          node --check preload.js
      - name: Unit tests
        run: npm test

  python:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: '3.12'
      - name: Byte-compile ESP scripts (syntax only)
        run: |
          python -m py_compile sender.py bridge.py \
            esp_libs/micropyGPS.py esp_libs/mpu6050.py \
            esp_libs/oled_diagnose.py esp_libs/ssd1306.py
```

- [ ] **Step 2: Validate the workflow YAML locally**

Run: `node -e "const fs=require('fs');const s=fs.readFileSync('.github/workflows/check.yml','utf8');if(!/jobs:/.test(s)||!/npm test/.test(s)||!/py_compile/.test(s)){process.exit(1)}console.log('check.yml looks well-formed')"`
Expected: `check.yml looks well-formed`

- [ ] **Step 3: Reproduce the CI steps locally to prove they pass**

Run: `node --check geo.js && node --check rasicross.js && node --check main.js && node --check preload.js && echo "js syntax ok"`
Expected: `js syntax ok`

Run: `npm test`
Expected: PASS (geo.test.js).

Run: `python -m py_compile sender.py bridge.py esp_libs/micropyGPS.py esp_libs/mpu6050.py esp_libs/oled_diagnose.py esp_libs/ssd1306.py && echo "py compile ok"`
Expected: `py compile ok` (if `python` is not on PATH on Windows, use `py -3 -m py_compile …` — the GitHub runner uses `python`).

- [ ] **Step 4: Commit**

```bash
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" add .github/workflows/check.yml
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" commit -m "ci: add check workflow (node --check, npm test, py_compile)

Runs on push/PR. Independent of the tag-triggered build.yml.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 6: Phase verification, plan commit & push

**Files:**
- Modify: none (verification + push)
- The plan doc `docs/superpowers/plans/2026-05-17-01-test-ci-foundation.md` is committed here.

- [ ] **Step 1: Full local CI dry-run**

Run, in order, and confirm each passes:
```
node --check geo.js
node --check rasicross.js
node --check main.js
node --check preload.js
npm test
python -m py_compile sender.py bridge.py esp_libs/micropyGPS.py esp_libs/mpu6050.py esp_libs/oled_diagnose.py esp_libs/ssd1306.py
```
Expected: all exit 0; `npm test` shows all `geo.test.js` tests passing.

- [ ] **Step 2: No-duplication invariant check**

Run (Grep tool): `^function (fmtMs|fmtClock|fmtDelta|gpsDist|traceDistanceM|headingFromPoints|segmentsCross|crossingDirectionOk|lineEndpointsFromGate)\b` across the repo.
Expected: 9 matches, **all in `geo.js`** (none in `rasicross.js`).

- [ ] **Step 3: Manual dashboard smoke (record results in the commit message)**

Open the dashboard two ways and verify **identical behavior to before this phase**:
1. Electron: `npm start` (this *does* require deps — run `npm install --no-audit --no-fund` first if `node_modules` is absent; this is only for the manual smoke, not for CI).
2. Chromium browser: open `RasiCross_Telemetry.html` directly.

In each: open devtools console → **no errors**; click Demo → a lap completes and a formatted lap time (`M:SS.mmm`) appears; the session clock renders. This proves `geo.js` globals resolve and lap/sector logic is unaffected.

If `npm install` for the Electron smoke is undesirable, the Chromium-browser smoke alone is sufficient evidence (same code path for `geo.js`/lap logic).

- [ ] **Step 4: Commit the plan document**

```bash
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" add docs/superpowers/plans/2026-05-17-01-test-ci-foundation.md
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" commit -m "docs: phase 1 implementation plan (test & CI foundation)

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

- [ ] **Step 5: Push the branch**

```bash
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" push
```
Expected: branch `docs/telemetry-improvements-spec` updated on origin (may trigger the Windows credential prompt on first push of the session — already authenticated earlier this session, so it should be silent).

- [ ] **Step 6: Confirm GitHub CI ran**

Open the branch on GitHub and confirm the new `check` workflow ran and is green for both `js` and `python` jobs. (No `gh` CLI available — verify via the GitHub web UI / the PR's checks tab.)

---

## Self-Review

**1. Spec coverage (B1, B2, §7):**
- B1 "extract pure helpers into geo.js, UMD, script before rasicross.js, rasicross uses them, node:test, npm test, zero new deps" → Tasks 1–4 (extraction, UMD, ordering, deletion) + Task 2 (`npm test`). ✅
- B1 list of functions (`gpsDist, headingFromPoints, segmentsCross, crossingDirectionOk, lineEndpointsFromGate, traceDistanceM, fmtMs/fmtClock/fmtDelta`) → all 9 covered in `geo.js` and tested. ✅
- B1 test coverage areas (great-circle distance, heading quadrants, segment intersection crossing/parallel/disjoint, direction gating correct/wrong, gate geometry, trace accumulation, time formatting incl. negative/zero/hours/sub-second) → all present in `test/geo.test.js`. ✅
- B2 "check.yml on push/PR: node --check all JS, npm test, py_compile sender/bridge/esp_libs; build.yml untouched" → Task 5. ✅ (Refinement vs spec, documented inline: JS job skips `npm install` because `node --test` needs no deps — avoids Electron download; faithful to intent.)
- §7 "JS fully verified locally; ESP code compile-checked" → Tasks 5–6 local dry-run + py_compile. ✅
- §10 backward-compat / behavioral invariant → Task 3 rationale + Task 6 Step 3 manual smoke. ✅

**2. Placeholder scan:** No TBD/TODO; every code step contains complete code; every command has expected output. ✅

**3. Type/name consistency:** Function names identical across `geo.js`, `test/geo.test.js`, and the deleted `rasicross.js` blocks (`fmtMs/fmtClock/fmtDelta/gpsDist/traceDistanceM/headingFromPoints/segmentsCross/crossingDirectionOk/lineEndpointsFromGate`). UMD `api` keys match exported names. ✅

**4. Carried-forward spec refinement (for later phases, not this one):** §5 A5 CSP in the spec is **incomplete** — the HTML head loads `https://fonts.googleapis.com` (stylesheet) and `https://fonts.gstatic.com` (font files) plus `assets/icon.svg`. The Phase 3 (A5) plan must use a CSP that includes `style-src … https://fonts.googleapis.com`, `font-src https://fonts.gstatic.com`, `img-src 'self' data:` (and decide self-host-fonts vs. allow-origins). Recorded here so it is not lost; **out of scope for Phase 1.**

---

## Phase Map (context for executor)

This is **Phase 1 of 6**. Remaining phases are authored as separate plans at their phase start (so each is accurate against the then-current code — geo.js, calc.js, the CSP/fonts fix, etc.):

2. A1 + A2 — RPM IRQ fix, wheel-speed fallback, pure `esp_libs/calc.py` + Python unit tests, `spd_src` + dashboard indicator.
3. A5 — CSP (with the fonts/icon correction above) + de-inline the 7 handlers.
4. A3 — LiPo battery telemetry.
5. A4 — IMU expansion (gyro/Gz/temp).
6. C1 — recording + in-app replay (+ pure `replay.js` + tests).

Each later phase is independently shippable and ends green on the `check` workflow this phase creates.
