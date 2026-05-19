# Phase 6 — C1: Recording + Full In-App Replay Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a bounded in-memory recorder of all inbound telemetry/control packets, NDJSON save/load, and a full in-app replay mode (virtual clock, transport bar with play/pause/seek/speed/exit) that re-feeds the **existing** `processTelemetry` + render path — fully additive, backward-compatible, and with the live state isolated so a replay never mutates saved races/tracks.

**Architecture:** A new dependency-free UMD module **`replay.js`** holds the pure, unit-tested core (NDJSON serialize/parse with malformed-line skipping + monotonic `t_rel` clamp, ring-buffer cap, virtual-clock due-index, seek mapping) — same UMD pattern as `geo.js`. `rasicross.js` records every inbound `d` at the top of `processTelemetry` (gated off during replay), and replay drives the **same** `processTelemetry`/`onGpsUpdate` path used by serial and demo. Entering replay deep-snapshots the replay-touched `state` slices, substitutes fresh accumulators plus a disposable race/driver (so detected laps stay isolated), and restores the snapshot verbatim on exit; seeking backward resets the accumulators and fast-re-feeds from 0 for deterministic rebuild. A fixed bottom overlay bar (CSP-compliant `addEventListener` wiring, like the existing pit-wall overlay) is the transport UI.

**Tech Stack:** Node ≥ 18 built-in `node:test`/`node:assert` (zero new deps), vanilla DOM + `Blob`/`FileReader`/`structuredClone` (Electron + Chromium), classic `<script>` load order `geo.js → replay.js → rasicross.js`. No ESP/Python changes.

---

## Working Directory & Conventions

**All work happens in the git clone:** `C:/Users/jimlu/Documents/RasiCross-Telemetrie-git` (branch `docs/telemetry-improvements-spec`, Phases 1–5 already committed/pushed).

- Paths relative to clone root unless absolute. Files use **CRLF**; always `Read` the target region in-session immediately before an `Edit` and copy the `old_string` anchor from that fresh Read (strip the line-number/tab prefix). Line numbers below are indicative — anchor on the text.
- Git: `git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" …`. Use the Grep tool (not shell grep) for verification greps. There is an untracked `.claude/` directory and untracked plan docs — **never** `git add` them; use explicit `git add <path>`.
- Windows: Python may be `python` or `py -3` — try `python` first, fall back to `py -3`. Node v24 local; CI Node 20 / Python 3.12. Delete any `__pycache__` before a `git status` check.
- **Spec:** `docs/superpowers/specs/2026-05-17-rasicross-telemetry-improvements-design.md` §5 C1, §6, §9, §10.

**Behavioural invariant:** All additions are additive and live-mode behaviour is unchanged when not recording/replaying. Recording is an in-memory ring buffer **never** written to `localStorage`. Replay never mutates persisted data: `saveData()` is a no-op while replaying, and the replay-touched `state` slices are snapshot on enter and restored verbatim on exit. Old recordings with missing/old fields replay correctly via the existing backward-compat (`Number(d.x)||0`, `!= null` keep-last). The `geo.test.js` suite is unaffected.

**Locked decisions (spec + established codebase patterns + user confirmation):**
1. **Pure core in `replay.js`** (UMD namespace object `window.RasiReplay` + `module.exports`), exactly mirroring the `geo.js`/`calc.js` test-first pattern. The DOM/transport wiring lives in `rasicross.js` and is **not** unit-tested (consistent with Phases 2–5: charts/DOM verified by `node --check` + grep-static + a deferred manual smoke; only pure logic gets `node:test`).
2. **Single recording chokepoint:** record at the very top of `processTelemetry(d)` (after `if (!d) return;`, **before** the `bridge_status` early return) so telemetry **and** control lines are captured uniformly for serial and demo. Gated by `state.recording.armed && !state.replay.active`.
3. **Isolated replay** (user-confirmed): `enterReplay` deep-snapshots the replay-touched slices, installs fresh accumulators + a disposable running race/driver (so lap/sector detection works without touching saved races), keeps the existing `track`/`startGate` (gate geometry the recording was made against — not an accumulator). `exitReplay` restores the snapshot verbatim. Backward seek = reset accumulators + re-feed `0→target` at max speed (deterministic rebuild, spec §9).
4. **Transport = fixed bottom overlay bar** (user-confirmed): one `#replayBar` element appended before `#rcToast`, shown via a `.hidden` class toggle (same pattern as `#demoStopBtn`/pit-wall overlay), styled by a rule added to the existing `<style>` block (CSP retains `'unsafe-inline'` for styles per A5). Play/Pause, seek scrubber, speed `0.25×…8×`, elapsed/total, Exit.
5. **Auto-arm** is a persisted setting `state.settings.recordAutoArm` (default `true`); the buffer/replay runtime state is **not** persisted (decision 2/invariant). A fresh recording auto-starts on serial connect and demo start when the toggle is on.
6. **No `package.json` change:** `npm test` is `node --test` (no path) which auto-discovers `test/replay.test.js` (Phase-1 Task-2 note). `check.yml` only gains `node --check replay.js`.
7. **`REC_MAX = 150000`** packets; on overflow drop oldest + one-shot `rcToast` (once per session, tracked by `state.recording.overflowed`). NDJSON header `version` is `'9.6'` (matches the persistence/export `version` already in the codebase).

---

## File Structure

| Action | Path | Responsibility |
|--------|------|----------------|
| Create | `replay.js` | Pure UMD core: `REC_MAX`, `REC_VERSION`, `serializeRecording`, `parseRecording` (skip malformed, clamp `t_rel`), `pushCapped`, `nextIndexFor`, `seekTargetMs`. Dependency-free. |
| Create | `test/replay.test.js` | `node:test` suite (12 blocks) for the entire `replay.js` API. |
| Modify | `RasiCross_Telemetry.html` | `<script src="replay.js">` after `geo.js`; recording/replay card in the Connection tab; auto-arm toggle in Settings; `#replayBar` overlay; `.replay-bar` CSS in `<style>`. |
| Modify | `.github/workflows/check.yml` | Add `node --check replay.js` to the `js` job. |
| Modify | `rasicross.js` | `state.recording`/`state.replay` slices + `state.settings.recordAutoArm`; `recordPacket` hook in `processTelemetry`; `saveData` replay no-op guard; auto-arm in `connectSerial`/`startDemo`; `connectSerial`/`startDemo` replay guards; save/load/enter/exit/seek/tick + transport render; settings + button wiring in `init()`. |

**Task order (each commit independently sound):** T1 `replay.js`+tests → T2 load+CI → T3 recording → T4 save → T5 replay engine → T6 transport UI → T7 verify/commit/push.

---

### Task 1: `replay.js` pure module + tests (TDD)

**Files:** Create `replay.js`, Create `test/replay.test.js`

- [ ] **Step 1: Write the failing test (module does not exist yet)**

Create `test/replay.test.js`:

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../replay.js');

test('exports the full api + constants', () => {
  assert.equal(R.REC_MAX, 150000);
  assert.equal(R.REC_VERSION, '9.6');
  for (const n of ['serializeRecording','parseRecording','pushCapped','nextIndexFor','seekTargetMs']) {
    assert.equal(typeof R[n], 'function', `missing ${n}`);
  }
});

test('serializeRecording: header line + one line per packet, round-trips', () => {
  const pkts = [{ t_rel: 0, speed: 1 }, { t_rel: 80, speed: 2 }, { t_rel: 160, speed: 3 }];
  const txt = R.serializeRecording(pkts, { created: '2026-05-19T00:00:00.000Z' });
  const lines = txt.split('\n');
  assert.equal(lines.length, 4);
  const hdr = JSON.parse(lines[0]);
  assert.equal(hdr.rasicross_recording, 1);
  assert.equal(hdr.version, '9.6');
  assert.equal(hdr.created, '2026-05-19T00:00:00.000Z');
  assert.equal(hdr.count, 3);
  assert.equal(hdr.duration_ms, 160);
  const back = R.parseRecording(txt);
  assert.equal(back.ok, true);
  assert.equal(back.packets.length, 3);
  assert.equal(back.packets[2].speed, 3);
});

test('serializeRecording: duration_ms is the max t_rel (order-independent)', () => {
  const txt = R.serializeRecording([{ t_rel: 50 }, { t_rel: 10 }, { t_rel: 30 }], { created: 'x' });
  assert.equal(JSON.parse(txt.split('\n')[0]).duration_ms, 50);
});

test('parseRecording: empty / whitespace -> ok:false', () => {
  assert.equal(R.parseRecording('').ok, false);
  assert.equal(R.parseRecording('   \n  \n').ok, false);
  assert.equal(R.parseRecording(null).ok, false);
});

test('parseRecording: unparseable header -> ok:false bad-header', () => {
  const r = R.parseRecording('not json\n{"t_rel":0}');
  assert.equal(r.ok, false);
  assert.equal(r.error, 'bad-header');
});

test('parseRecording: valid json header without the flag -> ok:false', () => {
  const r = R.parseRecording('{"hello":1}\n{"t_rel":0}');
  assert.equal(r.ok, false);
  assert.equal(r.error, 'not-a-recording');
});

test('parseRecording: skips malformed body lines and counts them', () => {
  const txt = [
    '{"rasicross_recording":1,"version":"9.6"}',
    '{"t_rel":0,"speed":1}',
    'GARBAGE{',
    '42',                       // not an object -> skipped
    '{"t_rel":80,"speed":2}'
  ].join('\n');
  const r = R.parseRecording(txt);
  assert.equal(r.ok, true);
  assert.equal(r.packets.length, 2);
  assert.equal(r.skipped, 2);
  assert.equal(r.packets[1].speed, 2);
});

test('parseRecording: clamps missing / non-monotonic t_rel into __t', () => {
  const txt = [
    '{"rasicross_recording":1}',
    '{"t_rel":0}',
    '{"t_rel":100}',
    '{"speed":9}',              // missing t_rel -> clamp to prev (100)
    '{"t_rel":50}',             // goes backwards -> clamp to prev (100)
    '{"t_rel":250}'
  ].join('\n');
  const r = R.parseRecording(txt);
  assert.deepEqual(r.packets.map(p => p.__t), [0, 100, 100, 100, 250]);
  assert.equal(r.durationMs, 250);
});

test('pushCapped: under cap returns false, no drop', () => {
  const buf = [1, 2];
  assert.equal(R.pushCapped(buf, 3, 5), false);
  assert.deepEqual(buf, [1, 2, 3]);
});

test('pushCapped: at cap drops oldest, returns true, length stays == max', () => {
  const buf = [1, 2, 3];
  assert.equal(R.pushCapped(buf, 4, 3), true);
  assert.deepEqual(buf, [2, 3, 4]);
  assert.equal(buf.length, 3);
});

test('nextIndexFor: progressive feed, fromIndex resume, ties, beyond end', () => {
  const pk = R.parseRecording([
    '{"rasicross_recording":1}',
    '{"t_rel":0}', '{"t_rel":80}', '{"t_rel":80}', '{"t_rel":240}'
  ].join('\n')).packets;
  assert.equal(R.nextIndexFor(pk, 0, 0), 1);     // only t=0 due
  assert.equal(R.nextIndexFor(pk, 80, 1), 3);    // both t=80 (tie) due
  assert.equal(R.nextIndexFor(pk, 100, 3), 3);   // nothing new yet
  assert.equal(R.nextIndexFor(pk, 9999, 3), 4);  // rest due
  assert.equal(R.nextIndexFor(pk, 9999, 4), 4);  // already at end
});

test('seekTargetMs: clamps ratio to [0,1] and maps to ms', () => {
  assert.equal(R.seekTargetMs(1000, 0), 0);
  assert.equal(R.seekTargetMs(1000, 0.5), 500);
  assert.equal(R.seekTargetMs(1000, 1), 1000);
  assert.equal(R.seekTargetMs(1000, -3), 0);
  assert.equal(R.seekTargetMs(1000, 9), 1000);
  assert.equal(R.seekTargetMs(1000, NaN), 0);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test` (clone root). Expected: FAIL — `Cannot find module '../replay.js'` (geo.test.js still passes).

- [ ] **Step 3: Create `replay.js`**

Create `replay.js`:

```js
'use strict';
// ============================================================
//  replay.js — pure recording/replay core (RasiCross)
//  Single source of truth for the testable logic. Loaded as a
//  classic <script> AFTER geo.js and BEFORE rasicross.js
//  (exposes window.RasiReplay) and as a CommonJS module for
//  node:test. Dependency-free. No DOM, no globals besides the
//  one explicit RasiReplay assignment at the bottom.
// ============================================================

var REC_MAX = 150000;        // ~3 h @ 12.5 Hz
var REC_VERSION = '9.6';

// Build the NDJSON text: line 1 = header, then one packet/line.
// Each packet is expected to already carry t_rel.
function serializeRecording(packets, meta) {
  packets = packets || [];
  meta = meta || {};
  var n = packets.length, dur = 0;
  for (var i = 0; i < n; i++) {
    var t = Number(packets[i] && packets[i].t_rel) || 0;
    if (t > dur) dur = t;
  }
  var header = {
    rasicross_recording: 1,
    version: REC_VERSION,
    created: meta.created || new Date().toISOString(),
    count: n,
    duration_ms: dur
  };
  var lines = [JSON.stringify(header)];
  for (var j = 0; j < n; j++) lines.push(JSON.stringify(packets[j]));
  return lines.join('\n');
}

// Parse NDJSON text -> { ok, error, header, packets, skipped, durationMs }.
// Malformed body lines are skipped + counted. t_rel is clamped to a
// monotonic non-decreasing timeline stored on each packet as __t.
function parseRecording(text) {
  var src = String(text == null ? '' : text).split(/\r?\n/);
  var lines = [];
  for (var i = 0; i < src.length; i++) {
    var s = src[i].trim();
    if (s) lines.push(s);
  }
  if (!lines.length) {
    return { ok: false, error: 'empty', header: null, packets: [], skipped: 0, durationMs: 0 };
  }
  var header;
  try { header = JSON.parse(lines[0]); }
  catch (e) {
    return { ok: false, error: 'bad-header', header: null, packets: [], skipped: 0, durationMs: 0 };
  }
  if (!header || header.rasicross_recording !== 1) {
    return { ok: false, error: 'not-a-recording', header: null, packets: [], skipped: 0, durationMs: 0 };
  }
  var packets = [], skipped = 0, prevT = 0;
  for (var k = 1; k < lines.length; k++) {
    var obj;
    try { obj = JSON.parse(lines[k]); }
    catch (e2) { skipped++; continue; }
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) { skipped++; continue; }
    var t = Number(obj.t_rel);
    if (!isFinite(t)) t = prevT;     // missing/NaN -> hold
    if (t < prevT) t = prevT;        // non-monotonic -> clamp
    prevT = t;
    obj.__t = t;
    packets.push(obj);
  }
  return {
    ok: true, error: null, header: header, packets: packets,
    skipped: skipped, durationMs: packets.length ? packets[packets.length - 1].__t : 0
  };
}

// Bounded ring push. Returns true iff an item was dropped (overflow).
function pushCapped(buf, item, max) {
  buf.push(item);
  if (buf.length > max) { buf.shift(); return true; }
  return false;
}

// First index whose __t is still in the future relative to virtualMs.
// packets[fromIndex .. return-1] are the ones now due to feed.
function nextIndexFor(packets, virtualMs, fromIndex) {
  var i = fromIndex | 0;
  var n = packets.length;
  while (i < n && packets[i].__t <= virtualMs) i++;
  return i;
}

// Map a 0..1 scrubber ratio to a clamped ms position.
function seekTargetMs(durationMs, ratio) {
  var r = Number(ratio);
  if (!isFinite(r)) r = 0;
  if (r < 0) r = 0; else if (r > 1) r = 1;
  return r * (Number(durationMs) || 0);
}

// ── UMD-style export ────────────────────────────────────────
(function () {
  var api = {
    REC_MAX: REC_MAX, REC_VERSION: REC_VERSION,
    serializeRecording: serializeRecording, parseRecording: parseRecording,
    pushCapped: pushCapped, nextIndexFor: nextIndexFor, seekTargetMs: seekTargetMs
  };
  if (typeof module !== 'undefined' && module.exports) { module.exports = api; }
  if (typeof window !== 'undefined') { window.RasiReplay = api; }
})();
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test`. Expected: PASS — all 12 `replay.test.js` blocks pass; `geo.test.js` still passes. Summary: `tests 22` `pass 22` `fail 0`.

- [ ] **Step 5: Standalone syntax check**

Run: `node --check replay.js`. Expected: exit 0, no output.
Delete any `__pycache__`; confirm `git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" status --short` shows only `replay.js` + `test/replay.test.js` untracked (plus the untracked `.claude/` and plan docs).

- [ ] **Step 6: Commit**

```bash
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" add replay.js test/replay.test.js
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" commit -m "test: pure recording/replay core in replay.js (UMD + node:test)

serializeRecording/parseRecording (skip malformed, clamp t_rel),
pushCapped ring cap, nextIndexFor virtual-clock slice, seekTargetMs.
12 node:test blocks, zero new deps. Mirrors the geo.js pattern.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 2: Load `replay.js` in the dashboard + CI

**Files:** Modify `RasiCross_Telemetry.html` (one line), Modify `.github/workflows/check.yml`

- [ ] **Step 1: Read** the end of `RasiCross_Telemetry.html` (the two `<script>` lines + `</body>`) and `.github/workflows/check.yml` (whole file) to anchor the edits.

- [ ] **Step 2: Insert the `replay.js` script after `geo.js`, before `rasicross.js`**

Edit `RasiCross_Telemetry.html` — replace exactly:

```
<script src="geo.js"></script>
<script src="rasicross.js"></script>
```

with:

```
<script src="geo.js"></script>
<script src="replay.js"></script>
<script src="rasicross.js"></script>
```

- [ ] **Step 3: Add `node --check replay.js` to the CI `js` job**

Edit `.github/workflows/check.yml` — replace exactly:

```
          node --check geo.js
          node --check rasicross.js
```

with:

```
          node --check geo.js
          node --check replay.js
          node --check rasicross.js
```

- [ ] **Step 4: Verify**

Run (Grep tool) `RasiCross_Telemetry.html` pattern `<script src="(geo|replay|rasicross)\.js"></script>` output mode content → exactly three lines, in order `geo.js`, `replay.js`, `rasicross.js`.
Run (Grep tool) `.github/workflows/check.yml` pattern `node --check replay\.js` → 1.
Run: `node -e "const fs=require('fs');const s=fs.readFileSync('.github/workflows/check.yml','utf8');if(!/jobs:/.test(s)||!/npm test/.test(s)){process.exit(1)}console.log('check.yml ok')"` → `check.yml ok`.
Delete any `__pycache__`; `git status --short` shows only `RasiCross_Telemetry.html` + `.github/workflows/check.yml` modified.

- [ ] **Step 5: Commit**

```bash
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" add RasiCross_Telemetry.html .github/workflows/check.yml
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" commit -m "build: load replay.js (after geo.js) + CI node --check replay.js

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 3: Recording — state slices, hook, auto-arm, settings toggle

**Files:** Modify `rasicross.js` (state + settings + `recordPacket` + `processTelemetry` hook + `saveData` guard + auto-arm in `connectSerial`/`startDemo`), Modify `RasiCross_Telemetry.html` (auto-arm toggle in Settings)

Context: `state` literal ends at `  gateFlashUntil: 0,\n};`. `settings:` is one object literal on line ~47. `processTelemetry` starts `function processTelemetry(d) {` → `  try {` → `    if (!d) return;`. `saveData()` body starts `function saveData() {\n  try {`. `connectSerial` sets `state.serial.connected = true;` on the Electron path; `startDemo` sets `state.demo.running = true;`.

- [ ] **Step 1: Read** in `rasicross.js`: the `state` literal tail (`  // UI\n  gateFlashUntil: 0,\n};`), the `settings: { … }` line, `function saveData() {` + its `try {`, the `processTelemetry` head (`function processTelemetry(d) {`/`  try {`/`    if (!d) return;`), the `connectSerial` Electron success block around `state.serial.connected = true;\n      state.serial.portName = path;`, and in `startDemo` the `state.demo.running = true;\n  state.demo.t = 0;` lines. Read `RasiCross_Telemetry.html` the Settings "Daten" card (`<button class="btn ghost" id="exportAllBtn">…`).

- [ ] **Step 2: Add `recordAutoArm` to settings + `recording`/`replay` slices to `state`**

Edit `rasicross.js` — replace exactly:

```
  settings: { maxSpeed: 80, maxRpm: 10000, rpmWarning: 9000, gScale: 3, minLapSeconds: 10, displayUpdateMs: 500, oledPage: 'auto' },
```

with:

```
  settings: { maxSpeed: 80, maxRpm: 10000, rpmWarning: 9000, gScale: 3, minLapSeconds: 10, displayUpdateMs: 500, oledPage: 'auto', recordAutoArm: true },
```

Edit `rasicross.js` — replace exactly:

```
  // UI
  gateFlashUntil: 0,
};
```

with:

```
  // UI
  gateFlashUntil: 0,
  // Recording / Replay (NEVER persisted — see saveData guard)
  recording: { armed: false, buf: [], startWall: null, overflowed: false },
  replay: { active: false, packets: [], idx: 0, virtualMs: 0, durationMs: 0,
            speed: 1, playing: false, raf: null, lastWall: null, snapshot: null },
};
```

- [ ] **Step 3: Make `saveData()` a no-op during replay (never persist replay/disposable state)**

Edit `rasicross.js` — replace exactly:

```
function saveData() {
  try {
```

with:

```
function saveData() {
  if (state.replay && state.replay.active) return;  // replay uses disposable state — never persist
  try {
```

- [ ] **Step 4: Add `recordPacket` + arm/disarm helpers (before `processTelemetry`)**

Edit `rasicross.js` — replace exactly:

```
// ============================================================
// 7. TELEMETRY PIPELINE
// ============================================================
function processTelemetry(d) {
  try {
    if (!d) return;
```

with:

```
// ============================================================
// 7. TELEMETRY PIPELINE
// ============================================================
function armRecording() {
  // Frische Aufnahme starten (auto bei Connect/Demo, wenn aktiviert).
  state.recording.buf = [];
  state.recording.startWall = null;
  state.recording.overflowed = false;
  state.recording.armed = true;
}
function recordPacket(d) {
  const now = Date.now();
  if (state.recording.startWall == null) state.recording.startWall = now;
  const rec = Object.assign({}, d, { t_rel: now - state.recording.startWall, _wall: now });
  const dropped = RasiReplay.pushCapped(state.recording.buf, rec, RasiReplay.REC_MAX);
  if (dropped && !state.recording.overflowed) {
    state.recording.overflowed = true;
    rcToast('⚠ Aufnahme-Puffer voll — älteste Pakete werden verworfen', 4000);
  }
}
function processTelemetry(d) {
  try {
    if (!d) return;
    if (state.recording.armed && !state.replay.active) recordPacket(d);
```

- [ ] **Step 5: Auto-arm on serial connect (Electron path) and on demo start**

Edit `rasicross.js` — replace exactly:

```
      state.serial.connected = true;
      state.serial.portName = path;
```

with:

```
      state.serial.connected = true;
      if (state.settings.recordAutoArm) armRecording();
      state.serial.portName = path;
```

Edit `rasicross.js` — replace exactly:

```
  state.demo.running = true;
  state.demo.t = 0;
```

with:

```
  state.demo.running = true;
  if (state.settings.recordAutoArm) armRecording();
  state.demo.t = 0;
```

- [ ] **Step 6: Add the auto-arm toggle to the Settings "Daten" card**

Edit `RasiCross_Telemetry.html` — replace exactly:

```
      <div class="fieldset">
        <button class="btn ghost" id="exportAllBtn">📥 Alle Daten exportieren</button>
```

with:

```
      <div class="toggle-row"><span class="label-text">Aufnahme bei Verbindung automatisch starten</span><label class="toggle"><input type="checkbox" id="recAutoArmToggle" checked><span class="toggle-knob"></span></label></div>
      <div class="fieldset">
        <button class="btn ghost" id="exportAllBtn">📥 Alle Daten exportieren</button>
```

- [ ] **Step 7: Reflect + persist the toggle (in `loadSettingsToUi` and `init`)**

Edit `rasicross.js` — replace exactly:

```
  if ($('setSwapG')) $('setSwapG').checked = !!state.calibration.swapG;
}
```

with:

```
  if ($('setSwapG')) $('setSwapG').checked = !!state.calibration.swapG;
  if ($('recAutoArmToggle')) $('recAutoArmToggle').checked = state.settings.recordAutoArm !== false;
}
```

Edit `rasicross.js` — replace exactly:

```
  $('autoReconnectToggle').onchange = () => { state.serial.autoReconnect = $('autoReconnectToggle').checked; };
```

with:

```
  $('autoReconnectToggle').onchange = () => { state.serial.autoReconnect = $('autoReconnectToggle').checked; };
  if ($('recAutoArmToggle')) $('recAutoArmToggle').onchange = () => { state.settings.recordAutoArm = $('recAutoArmToggle').checked; saveData(); };
```

- [ ] **Step 8: Verify**

Run: `node --check rasicross.js` → exit 0.
Run: `node --test` → `tests 22` `pass 22` `fail 0` (no JS regression).
Run (Grep tool) `rasicross.js`: `recordAutoArm: true` → 1; `recording: \{ armed: false` → 1; `replay: \{ active: false` → 1; `function recordPacket` → 1; `function armRecording` → 1; `if \(state\.recording\.armed && !state\.replay\.active\) recordPacket\(d\)` → 1; `if \(state\.replay && state\.replay\.active\) return;` → 1; `if \(state\.settings\.recordAutoArm\) armRecording\(\)` → 2; `recAutoArmToggle` → 3. `RasiCross_Telemetry.html`: `id="recAutoArmToggle"` → 1. Visually confirm (fresh Read) the hook sits directly after `if (!d) return;` and **before** the `if (d.type === 'bridge_status')` block (so control lines are recorded).
Delete any `__pycache__`; `git status --short` shows only `rasicross.js` + `RasiCross_Telemetry.html` modified.

- [ ] **Step 9: Commit**

```bash
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" add rasicross.js RasiCross_Telemetry.html
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" commit -m "feat(dashboard): in-memory telemetry recorder + auto-arm

Bounded ring buffer (RasiReplay.pushCapped, REC_MAX) filled at the
single processTelemetry chokepoint (incl. control lines), gated off
during replay; one-shot overflow toast. Auto-arms on serial/demo
connect via the persisted recordAutoArm setting. saveData() is a
no-op while replaying. Buffer/replay state never persisted.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 4: Save recording (NDJSON download) + Connection-tab UI

**Files:** Modify `rasicross.js` (`saveRecording` + wiring), Modify `RasiCross_Telemetry.html` (recording/replay card in the Connection tab)

Context: the Connection tab's `#demoPanel` div closes with `    </div>\n  </div>\n</section>` (the demo card, then `#demoPanel`, then `</section>` for `#tab-connection`). The `exportAll` blob-download is the model for `saveRecording`. Static modal buttons are CSP-wired via the `_bind` helper near the end of `init()`.

- [ ] **Step 1: Read** `RasiCross_Telemetry.html` the `#demoPanel` close (`        <button class="btn primary" id="demoStartBtn">Demo starten</button>` through `  </div>\n</section>`), and `rasicross.js` the `exportAll` function (model) + the `_bind(...)` block in `init()` (`  const _bind = (elId, fn) => …` through `  _bind('dmConfirmBtn', confirmDriverChange);`).

- [ ] **Step 2: Add the recording/replay card to the Connection tab**

Edit `RasiCross_Telemetry.html` — replace exactly:

```
        <button class="btn primary" id="demoStartBtn">Demo starten</button>
        <button class="btn danger hidden" id="demoStopBtn">Demo stoppen</button>
      </div>
    </div>
  </div>
</section>
```

with:

```
        <button class="btn primary" id="demoStartBtn">Demo starten</button>
        <button class="btn danger hidden" id="demoStopBtn">Demo stoppen</button>
      </div>
    </div>
  </div>

  <div class="card" style="margin-top:18px">
    <div class="card-head"><span class="card-title">Aufnahme &amp; Replay</span><span class="card-sub" id="recStatusText">Bereit</span></div>
    <p style="color:var(--mut);font-size:13px;margin-bottom:14px">
      Telemetrie wird im Speicher mitgeschnitten (max. 150 000 Pakete). Speichern als <code>.ndjson</code>; geladene Aufnahmen werden im Replay-Modus abgespielt.
    </p>
    <div class="row">
      <button class="btn ghost" id="recSaveBtn">💾 Aufnahme speichern</button>
      <button class="btn primary" id="recLoadBtn">📂 Aufnahme laden &amp; abspielen</button>
      <input type="file" id="recLoadFile" accept=".ndjson,.jsonl,application/x-ndjson" style="display:none">
    </div>
  </div>
</section>
```

- [ ] **Step 3: Add `saveRecording()` (model: `exportAll`) before `function init()`**

Edit `rasicross.js` — replace exactly:

```
// ============================================================
// 20. INIT
// ============================================================
function init() {
```

with:

```
// ============================================================
// 19b. RECORDING SAVE / LOAD / REPLAY
// ============================================================
function updateRecStatus() {
  const el = $('recStatusText');
  if (!el) return;
  if (state.replay.active) { el.textContent = 'Replay aktiv'; return; }
  const n = state.recording.buf.length;
  el.textContent = state.recording.armed ? (n + ' Pakete aufgenommen') : 'Bereit';
}
function saveRecording() {
  const buf = state.recording.buf;
  if (!buf.length) { rcToast('Keine Aufnahme vorhanden'); return; }
  const text = RasiReplay.serializeRecording(buf, { created: new Date().toISOString() });
  const blob = new Blob([text], { type: 'application/x-ndjson' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `rasicross_rec_${Date.now()}.ndjson`;
  a.click();
  URL.revokeObjectURL(url);
  rcToast('Aufnahme gespeichert (' + buf.length + ' Pakete)');
}

// ============================================================
// 20. INIT
// ============================================================
function init() {
```

- [ ] **Step 4: Wire the Save button (CSP-compliant) in the `_bind` block**

Edit `rasicross.js` — replace exactly:

```
  _bind('dmCancelBtn', closeDriverModal);
  _bind('dmConfirmBtn', confirmDriverChange);
```

with:

```
  _bind('dmCancelBtn', closeDriverModal);
  _bind('dmConfirmBtn', confirmDriverChange);
  _bind('recSaveBtn', saveRecording);
  updateRecStatus();
```

- [ ] **Step 5: Verify**

Run: `node --check rasicross.js` → exit 0. Run: `node --test` → `tests 22` `pass 22` `fail 0`.
Run (Grep tool) `rasicross.js`: `function saveRecording` → 1; `RasiReplay\.serializeRecording` → 1; `_bind\('recSaveBtn', saveRecording\)` → 1; `function updateRecStatus` → 1. `RasiCross_Telemetry.html`: `id="recSaveBtn"` → 1; `id="recLoadBtn"` → 1; `id="recLoadFile"` → 1; `id="recStatusText"` → 1.
Delete any `__pycache__`; `git status --short` shows only `rasicross.js` + `RasiCross_Telemetry.html` modified.

- [ ] **Step 6: Commit**

```bash
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" add rasicross.js RasiCross_Telemetry.html
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" commit -m "feat(dashboard): save recording as NDJSON + Connection-tab card

saveRecording() builds the header+packets NDJSON via
RasiReplay.serializeRecording and triggers a Blob download (exportAll
pattern). New Aufnahme & Replay card; Save button CSP-wired via _bind.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 5: Replay engine — load, isolated enter/exit, virtual clock, guards, seek

**Files:** Modify `rasicross.js` (load/enter/exit/tick/seek/feed + snapshot-isolation + `connectSerial`/`startDemo` guards + Load button wiring)

Context (user-confirmed isolated replay): on enter, deep-snapshot the replay-touched slices, install fresh accumulators + a disposable running race/driver (keep `track`/`startGate` — gate geometry the recording used). `feedReplayPacket` mirrors `handleSerialLine`'s `processTelemetry(d); if (d.lat && d.lon) onGpsUpdate(d.lat, d.lon);`. Backward seek = reset accumulators + re-feed 0→target at max speed. `uid()` and `drawTrack`/`renderRaces` already exist. The replay clock runs on `requestAnimationFrame`.

- [ ] **Step 1: Read** `rasicross.js`: the new section "19b. RECORDING SAVE / LOAD / REPLAY" you added in Task 4 (anchor: `function saveRecording() {` … its closing `}` before the `// 20. INIT` banner), the `connectSerial` head (`async function connectSerial() {\n  if (state.demo.running) stopDemo();`), the `startDemo` head (`function startDemo() {\n  if (state.demo.running) return;`), and the `_bind('recSaveBtn', saveRecording);\n  updateRecStatus();` lines.

- [ ] **Step 2: Add the replay engine (snapshot isolation + load/enter/exit/seek/tick/feed)**

Edit `rasicross.js` — replace exactly:

```
function saveRecording() {
  const buf = state.recording.buf;
  if (!buf.length) { rcToast('Keine Aufnahme vorhanden'); return; }
  const text = RasiReplay.serializeRecording(buf, { created: new Date().toISOString() });
  const blob = new Blob([text], { type: 'application/x-ndjson' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `rasicross_rec_${Date.now()}.ndjson`;
  a.click();
  URL.revokeObjectURL(url);
  rcToast('Aufnahme gespeichert (' + buf.length + ' Pakete)');
}
```

with:

```
function saveRecording() {
  const buf = state.recording.buf;
  if (!buf.length) { rcToast('Keine Aufnahme vorhanden'); return; }
  const text = RasiReplay.serializeRecording(buf, { created: new Date().toISOString() });
  const blob = new Blob([text], { type: 'application/x-ndjson' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `rasicross_rec_${Date.now()}.ndjson`;
  a.click();
  URL.revokeObjectURL(url);
  rcToast('Aufnahme gespeichert (' + buf.length + ' Pakete)');
}

// Slices that processTelemetry / onGpsUpdate / lap-sector-race
// detection mutate. Snapshot on enter, restore verbatim on exit.
const REPLAY_KEYS = ['connection','hz','telemetry','raw','display','gps','spdSrc',
  'batt','max','charts','imu','heatmap','sectors','lapStart','currentLapMax',
  'currentLapTrace','bestLapTrace','bestLapMs','bestLapNum','liveDelta','autoLap',
  'drivers','races','activeRaceId','selectedRaceId','gateFlashUntil'];

function snapshotReplayState() {
  const s = {};
  for (const k of REPLAY_KEYS) s[k] = state[k];
  try { return structuredClone(s); } catch (e) { return JSON.parse(JSON.stringify(s)); }
}
function restoreReplayState(snap) {
  for (const k of REPLAY_KEYS) state[k] = snap[k];
}
// Fresh accumulators + a disposable running race/driver so detected
// laps/sectors stay isolated. track/startGate are intentionally kept.
function resetReplayDerived() {
  state.connection = { source: 'replay', packets: 0, lost: 0, rssi: null,
    bridgeMac: 'RE:PL:AY:00:00:01', kartMac: 'RE:PL:AY:00:00:02',
    lastPacketAt: null, seq: null, errors: 0 };
  state.hz = 0;
  state.telemetry = { speed: 0, rpm: 0, gx: 0, gy: 0, lat: 0, lon: 0 };
  state.raw = { speed: 0, rpm: 0, gx: 0, gy: 0, gz: 0, yaw: 0, lat: 0, lon: 0 };
  state.display = { speedLerp: 0, rpmLerp: 0, gxLerp: 0, gyLerp: 0 };
  state.gps = { fix: false, lastAt: null };
  state.spdSrc = 'gps';
  state.batt = { present: false, vbat: 0, soc: 0, warn: 0, cells: 3, _lastWarn: 0 };
  state.max = { speed: 0, rpm: 0, g: 0 };
  state.charts = { speed: [], rpm: [], gx: [], gy: [], gz: [], yaw: [] };
  state.imu = { yaw: 0, mtemp: null };
  state.heatmap = { on: state.heatmap.on, lapMaxSpeed: 0 };
  state.sectors = { boundaries: state.sectors.boundaries, cur: 0, sectorStart: null,
    lapSectors: [null, null, null], best: [null, null, null], lastLapSectors: null,
    manual: state.sectors.manual, clickTarget: null };
  state.lapStart = null;
  state.currentLapMax = { speed: 0, rpm: 0 };
  state.currentLapTrace = [];
  state.bestLapTrace = null;
  state.bestLapMs = null;
  state.bestLapNum = null;
  state.liveDelta = null;
  state.autoLap = { prevLat: null, prevLon: null, lastTriggerAt: 0 };
  state.gateFlashUntil = 0;
  const drv = { id: uid(), name: 'Replay', number: 'R', color: '#7aa2f7' };
  const race = { id: uid(), name: 'Replay', trackId: state.activeTrackId,
    lengthType: 'free', durationMs: 0, targetLaps: 0,
    startDriverId: drv.id, currentDriverId: drv.id,
    status: 'running', createdAt: Date.now(), startedAt: Date.now(),
    endedAt: null, totalPausedMs: 0, laps: [],
    stints: [{ driverId: drv.id, startAt: Date.now(), endAt: null, laps: [] }],
    speedTrace: [] };
  state.drivers = [drv];
  state.races = [race];
  state.activeRaceId = race.id;
  state.selectedRaceId = race.id;
}
function feedReplayPacket(p) {
  processTelemetry(p);
  if (p.lat && p.lon) onGpsUpdate(p.lat, p.lon);
}
function fastForwardTo(targetMs) {
  const pk = state.replay.packets;
  const end = RasiReplay.nextIndexFor(pk, targetMs, state.replay.idx);
  for (let i = state.replay.idx; i < end; i++) feedReplayPacket(pk[i]);
  state.replay.idx = end;
  state.replay.virtualMs = targetMs;
}
function loadRecordingFile(file) {
  const reader = new FileReader();
  reader.onload = () => {
    const parsed = RasiReplay.parseRecording(reader.result);
    if (!parsed.ok) { rcAlert('Keine gültige Aufnahme:\n' + parsed.error); return; }
    if (parsed.packets.length < 2) { rcAlert('Aufnahme zu kurz (keine abspielbaren Pakete).'); return; }
    if (parsed.skipped) rcToast(parsed.skipped + ' fehlerhafte Zeilen übersprungen', 3000);
    enterReplay(parsed);
  };
  reader.onerror = () => rcAlert('Datei konnte nicht gelesen werden.');
  reader.readAsText(file);
}
function enterReplay(parsed) {
  if (state.serial.connected) disconnectSerial();
  if (state.demo.running) stopDemo();
  state.recording.armed = false;                 // do not record the replay
  state.replay.snapshot = snapshotReplayState();
  resetReplayDerived();
  state.replay.active = true;
  state.replay.packets = parsed.packets;
  state.replay.idx = 0;
  state.replay.virtualMs = 0;
  state.replay.durationMs = parsed.durationMs;
  state.replay.speed = 1;
  state.replay.playing = true;
  state.replay.lastWall = null;
  $('replayBar')?.classList.remove('hidden');
  $('connectBtn').textContent = 'Replay aktiv';
  $('connectBtn').className = 'btn blue w100';
  renderRaces();
  drawTrack();
  updateRecStatus();
  rcToast('Replay gestartet (' + parsed.packets.length + ' Pakete, '
    + fmtClock(parsed.durationMs) + ')', 3000);
  state.replay.raf = requestAnimationFrame(replayTick);
}
function replayTick() {
  if (!state.replay.active) return;
  const now = performance.now();
  if (state.replay.playing) {
    if (state.replay.lastWall != null) {
      const dt = (now - state.replay.lastWall) * state.replay.speed;
      let v = state.replay.virtualMs + dt;
      if (v >= state.replay.durationMs) { v = state.replay.durationMs; state.replay.playing = false; }
      const end = RasiReplay.nextIndexFor(state.replay.packets, v, state.replay.idx);
      for (let i = state.replay.idx; i < end; i++) feedReplayPacket(state.replay.packets[i]);
      state.replay.idx = end;
      state.replay.virtualMs = v;
    }
  }
  state.replay.lastWall = now;
  renderReplayBar();
  state.replay.raf = requestAnimationFrame(replayTick);
}
function replaySeek(ratio) {
  if (!state.replay.active) return;
  const target = RasiReplay.seekTargetMs(state.replay.durationMs, ratio);
  if (target < state.replay.virtualMs) {       // backward -> deterministic rebuild
    resetReplayDerived();
    state.replay.idx = 0;
    state.replay.virtualMs = 0;
  }
  fastForwardTo(target);
  state.replay.lastWall = null;
  renderRaces();
  drawTrack();
  renderReplayBar();
}
function setReplaySpeed(mult) {
  state.replay.speed = Number(mult) || 1;
}
function toggleReplayPlay() {
  if (!state.replay.active) return;
  if (state.replay.virtualMs >= state.replay.durationMs && !state.replay.playing) {
    replaySeek(0);                              // restart from the beginning
  }
  state.replay.playing = !state.replay.playing;
  state.replay.lastWall = null;
  renderReplayBar();
}
function exitReplay() {
  if (!state.replay.active) return;
  if (state.replay.raf) cancelAnimationFrame(state.replay.raf);
  state.replay.raf = null;
  state.replay.active = false;
  if (state.replay.snapshot) restoreReplayState(state.replay.snapshot);
  state.replay.snapshot = null;
  state.replay.packets = [];
  $('replayBar')?.classList.add('hidden');
  $('connectBtn').textContent = 'USB verbinden';
  $('connectBtn').className = 'btn primary w100';
  renderRaces();
  drawTrack();
  updateRecStatus();
  rcToast('Replay beendet');
}
function renderReplayBar() {
  const playBtn = $('rpPlayBtn');
  if (playBtn) playBtn.textContent = state.replay.playing ? '⏸' : '▶';
  setText('rpElapsed', fmtClock(state.replay.virtualMs));
  setText('rpTotal', fmtClock(state.replay.durationMs));
  const sk = $('rpSeek');
  if (sk && document.activeElement !== sk) {
    const r = state.replay.durationMs ? state.replay.virtualMs / state.replay.durationMs : 0;
    sk.value = String(Math.round(r * 1000));
  }
}
```

- [ ] **Step 3: Guard live modes while replaying**

Edit `rasicross.js` — replace exactly:

```
async function connectSerial() {
  if (state.demo.running) stopDemo();
```

with:

```
async function connectSerial() {
  if (state.replay.active) { rcToast('Im Replay-Modus — zuerst Replay beenden'); return; }
  if (state.demo.running) stopDemo();
```

Edit `rasicross.js` — replace exactly:

```
function startDemo() {
  if (state.demo.running) return;
```

with:

```
function startDemo() {
  if (state.replay.active) { rcToast('Im Replay-Modus — zuerst Replay beenden'); return; }
  if (state.demo.running) return;
```

- [ ] **Step 4: Wire Load + transport controls (CSP-compliant) in the `_bind` block**

Edit `rasicross.js` — replace exactly:

```
  _bind('recSaveBtn', saveRecording);
  updateRecStatus();
```

with:

```
  _bind('recSaveBtn', saveRecording);
  _bind('recLoadBtn', () => $('recLoadFile')?.click());
  const _rlf = $('recLoadFile');
  if (_rlf) _rlf.onchange = (e) => { if (e.target.files[0]) loadRecordingFile(e.target.files[0]); e.target.value = ''; };
  _bind('rpPlayBtn', toggleReplayPlay);
  _bind('rpExitBtn', exitReplay);
  const _rps = $('rpSeek');
  if (_rps) _rps.addEventListener('input', () => replaySeek((Number(_rps.value) || 0) / 1000));
  const _rsp = $('rpSpeed');
  if (_rsp) _rsp.addEventListener('change', () => setReplaySpeed(_rsp.value));
  updateRecStatus();
```

- [ ] **Step 5: Verify**

Run: `node --check rasicross.js` → exit 0. Run: `node --test` → `tests 22` `pass 22` `fail 0`.
Run (Grep tool) `rasicross.js`: `function enterReplay` → 1; `function exitReplay` → 1; `function replayTick` → 1; `function replaySeek` → 1; `function loadRecordingFile` → 1; `function resetReplayDerived` → 1; `snapshotReplayState\(\)` → ≥2; `restoreReplayState\(` → ≥2; `RasiReplay\.nextIndexFor` → 2; `RasiReplay\.parseRecording` → 1; `RasiReplay\.seekTargetMs` → 1; `if \(state\.replay\.active\) \{ rcToast\('Im Replay-Modus` → 2; `_bind\('rpExitBtn', exitReplay\)` → 1; `requestAnimationFrame\(replayTick\)` → 2. Visually confirm (fresh Read) `feedReplayPacket` mirrors `handleSerialLine` (`processTelemetry` then conditional `onGpsUpdate`), and `exitReplay` calls `restoreReplayState` before clearing the snapshot.
Delete any `__pycache__`; `git status --short` shows only `rasicross.js` modified.

- [ ] **Step 6: Commit**

```bash
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" add rasicross.js
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" commit -m "feat(dashboard): isolated in-app replay engine (virtual clock + seek)

Load NDJSON -> enterReplay snapshots replay-touched state, installs
fresh accumulators + disposable race/driver, feeds the recording
through the existing processTelemetry/onGpsUpdate path on a rAF
virtual clock. Backward seek resets + re-feeds 0->target
deterministically; exit restores the snapshot verbatim. connectSerial/
startDemo guarded while replaying.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 6: Transport overlay bar (HTML + CSS)

**Files:** Modify `RasiCross_Telemetry.html` (`#replayBar` element + `.replay-bar` CSS in the `<style>` block)

Context: `#rcToast` is the last body element before the scripts. The `<style>` block ends with `</style>` in `<head>`. The bar is hidden via the existing `.hidden` class (already used by `#demoStopBtn`). Buttons reuse `.btn`/`.ghost`/`.danger`. Wiring (`rpPlayBtn`/`rpSeek`/`rpSpeed`/`rpExitBtn`) was added in Task 5 Step 4.

- [ ] **Step 1: Read** `RasiCross_Telemetry.html`: the `</style>` line in `<head>`, and the `<div id="rcToast"></div>` line near the end.

- [ ] **Step 2: Add the `.replay-bar` styles before `</style>`**

Edit `RasiCross_Telemetry.html` — replace exactly:

```
</style>
```

with:

```
.replay-bar{position:fixed;left:0;right:0;bottom:0;z-index:900;display:flex;
  align-items:center;gap:14px;padding:12px 20px;background:var(--card,#15171c);
  border-top:1px solid var(--border,#2a2d36);box-shadow:0 -6px 24px rgba(0,0,0,.35)}
.replay-bar.hidden{display:none}
.replay-bar .rp-seek{flex:1;min-width:120px;accent-color:var(--pr,#7aa2f7)}
.replay-bar .rp-time{font-family:var(--mono,monospace);font-size:12px;color:var(--mut,#8b90a0);white-space:nowrap}
.replay-bar select{background:var(--bg,#0e0f13);color:var(--tx,#e8eaf0);border:1px solid var(--border,#2a2d36);border-radius:8px;padding:6px 8px;font-size:12px}
.replay-bar #rpPlayBtn{min-width:44px;font-size:15px}
</style>
```

- [ ] **Step 3: Add the `#replayBar` element before `#rcToast`**

Edit `RasiCross_Telemetry.html` — replace exactly:

```
<div id="rcToast"></div>
```

with:

```
<div id="replayBar" class="replay-bar hidden">
  <button class="btn ghost" id="rpPlayBtn">⏸</button>
  <input type="range" id="rpSeek" class="rp-seek" min="0" max="1000" value="0">
  <span class="rp-time"><b id="rpElapsed">00:00</b> / <b id="rpTotal">00:00</b></span>
  <select id="rpSpeed" title="Wiedergabe-Geschwindigkeit">
    <option value="0.25">0.25×</option>
    <option value="0.5">0.5×</option>
    <option value="1" selected>1×</option>
    <option value="2">2×</option>
    <option value="4">4×</option>
    <option value="8">8×</option>
  </select>
  <button class="btn danger" id="rpExitBtn">Replay beenden</button>
</div>
<div id="rcToast"></div>
```

- [ ] **Step 4: Verify**

Run (Grep tool) `RasiCross_Telemetry.html`: `id="replayBar"` → 1; `id="rpPlayBtn"` → 1; `id="rpSeek"` → 1; `id="rpElapsed"` → 1; `id="rpTotal"` → 1; `id="rpSpeed"` → 1; `id="rpExitBtn"` → 1; `class="replay-bar hidden"` → 1; `\.replay-bar\.hidden\{display:none\}` → 1. Confirm (fresh Read) `#replayBar` sits immediately before `<div id="rcToast"></div>` and the CSS block sits immediately before `</style>`.
Run: `node --check rasicross.js` → exit 0 (unchanged; sanity). Run: `node --test` → `tests 22` `pass 22` `fail 0`.
Manual smoke (record in commit; deferred to handoff — do not block): open `RasiCross_Telemetry.html` in Chromium → Demo → stop Demo → Connection tab → Save recording downloads a `.ndjson`; Load it → bar appears, plays back (speed/RPM/track animate), seek scrubs, speed selector changes rate, Exit restores the prior view; **zero CSP console violations**; saved races unchanged after exit.
Delete any `__pycache__`; `git status --short` shows only `RasiCross_Telemetry.html` modified.

- [ ] **Step 5: Commit**

```bash
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" add RasiCross_Telemetry.html
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" commit -m "feat(dashboard): fixed bottom replay transport bar (CSP-compliant)

#replayBar overlay (play/pause, seek, 0.25x-8x speed, elapsed/total,
exit) toggled via .hidden; styles in the existing <style> block.
Wired in Task 5 via addEventListener (no inline handlers).

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 7: Phase verification, plan commit & push

**Files:** none (verification + push); commits the Phase 6 plan doc.

- [ ] **Step 1: Full local CI dry-run** (clone root; `py -3` if `python` absent):
```
node --check geo.js
node --check replay.js
node --check rasicross.js
node --check main.js
node --check preload.js
npm test
python -m py_compile sender.py bridge.py esp_libs/micropyGPS.py esp_libs/mpu6050.py esp_libs/oled_diagnose.py esp_libs/ssd1306.py esp_libs/calc.py
python -m unittest discover -s test -p "test_*.py" -v
```
Expected: all exit 0; `npm test` = `tests 22 | pass 22 | fail 0` (10 geo + 12 replay); unittest = `Ran 17 tests` `OK` (unchanged — C1 is pure-JS, adds no Python tests). Delete any `__pycache__`; confirm `git status --short` shows no pyc/pycache (only the untracked plan doc until Step 3, plus untracked `.claude/`).

- [ ] **Step 2: Backward-compat + isolation spot-check**
- Grep `rasicross.js`: the recorder hook `if (state.recording.armed && !state.replay.active) recordPacket(d)` is the first statement after `if (!d) return;` and **before** `if (d.type === 'bridge_status')` (control lines recorded). `saveData()` first line is the `state.replay.active` no-op guard. `enterReplay` calls `snapshotReplayState()` before `resetReplayDerived()`; `exitReplay` calls `restoreReplayState` before nulling the snapshot. `connectSerial`/`startDemo` both early-return under `state.replay.active`.
- Confirm no telemetry packet **key** changed and `processTelemetry`'s parsing (`Number(d.x)||0`, `d.mtemp != null`, etc.) is untouched — replay reuses it verbatim, so old/short recordings (missing `gz`/`yaw`/`mtemp`/`spd_src`/`vbat`) replay via the existing backward-compat. `geo.js`/`calc.py`/ESP code unchanged.
- Confirm recording/replay state is **not** in the `saveData` payload object and `loadData` does not read it (only `state.settings.recordAutoArm` persists, via the existing `settings` merge).

- [ ] **Step 3: Commit the plan document**
```bash
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" add docs/superpowers/plans/2026-05-19-06-recording-replay.md
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" commit -m "docs: phase 6 implementation plan (recording + in-app replay C1)

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

- [ ] **Step 4: Push**
```bash
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" push
```
Credentials cached this session — should be silent. If it hangs >30s on auth, report BLOCKED (do not loop).

- [ ] **Step 5: Deferred to user (do NOT attempt here):** GitHub Actions `check` confirmation (no `gh` CLI) and the manual dashboard smoke below. Note them as pending in the report.

---

## Manual Acceptance Checklist (user-run, Electron + Chromium — DOM not unit-tested here)

1. **Record:** start Demo (or connect serial) with the auto-arm toggle on → the Connection card shows a rising packet count.
2. **Save:** "Aufnahme speichern" downloads `rasicross_rec_*.ndjson`; line 1 is the header (`rasicross_recording:1`, version, count, duration_ms); subsequent lines each carry `t_rel`.
3. **Load + replay:** "Aufnahme laden" → bottom bar appears; speed/RPM/G/track/charts animate; elapsed advances toward total.
4. **Transport:** Play/Pause toggles; speed `0.25×…8×` changes rate; the scrubber seeks both directions and the view rebuilds correctly (laps/sectors/track consistent after a backward seek).
5. **Isolation:** before replay note your saved races/tracks; after **Exit** they are byte-identical (replay used a disposable "Replay" race; nothing persisted). `localStorage` has no recording/replay keys.
6. **Guards:** while replaying, attempting USB connect / Demo shows the "zuerst Replay beenden" toast and does nothing.
7. **Edge cases:** loading an empty/short file → clear alert, no replay; a file with some corrupt lines → "n fehlerhafte Zeilen übersprungen" and replay proceeds; an old recording missing `gz`/`yaw`/`vbat` → replays with those readouts at `0`/`--`.
8. **CSP:** devtools console shows **zero** CSP violations throughout (record/save/load/replay/exit) in Electron and Chromium.

---

## Self-Review

**1. Spec coverage (§5 C1 + §6 + §9 + §10):**
- Bounded in-memory ring of raw inbound `d`, stamped `t_rel` (ms since first) + receive wall-clock → T3 `recordPacket` (`t_rel`, `_wall`) + `RasiReplay.pushCapped`. ✅
- `REC_MAX = 150000`, drop-oldest, one-shot toast → T1 `REC_MAX`/`pushCapped` return + T3 `state.recording.overflowed` guard. ✅
- Auto-arms on serial/demo connect; settings toggle controls auto-arm → T3 `armRecording` in `connectSerial`/`startDemo`, `recordAutoArm` setting + Settings toggle (persisted via existing `settings`). ✅
- `bridge_status`/control lines recorded too (tagged by `type`) → T3 hook is **before** the `bridge_status` early return; whole `d` is cloned. ✅
- Replay buffer/recording never persisted to `localStorage` → invariant + T3 `saveData` no-op guard + T7 Step 2 (not in payload). ✅
- Save → `.ndjson` Blob; line 1 header `{"rasicross_recording":1,"version":"9.6","created":…,"count":…,"duration_ms":…}`; subsequent lines incl. `t_rel` → T1 `serializeRecording` + T4 `saveRecording`. ✅
- Load → file input → parse NDJSON → Replay mode → T4 card/file input + T5 `loadRecordingFile`/`parseRecording`/`enterReplay`. ✅
- Transport UI: Play/Pause, seek scrubber by `t_rel`, speed `0.25×…8×`, elapsed/total, Exit → T6 `#replayBar` + T5 handlers (`toggleReplayPlay`/`replaySeek`/`setReplaySpeed`/`exitReplay`/`renderReplayBar`). ✅
- Virtual clock feeds packets with `t_rel ≤ virtualNow` through the **existing** `processTelemetry`+render path (no duplicate logic) → T5 `replayTick` + `RasiReplay.nextIndexFor` + `feedReplayPacket` (mirrors `handleSerialLine`). ✅
- Seek resets derived state + fast-replays from a sensible point (reset replay-touched slices, re-feed 0→target at max speed; deterministic) → T5 `replaySeek` (backward → `resetReplayDerived` + re-feed) / `fastForwardTo`. ✅
- While replaying, live serial + demo disabled; exit restores prior live mode cleanly → T5 `connectSerial`/`startDemo` guards + `exitReplay` `restoreReplayState`. ✅
- Edge cases (empty/short, malformed skip+count, non-monotonic `t_rel` clamp, old/missing fields) → T1 `parseRecording` (`empty`/`bad-header`/`not-a-recording`, `skipped`, `__t` clamp) + T5 `loadRecordingFile` guards + existing backward-compat parsing. ✅
- §6: no telemetry key added/removed; replay reuses `processTelemetry` so old recordings work → T7 Step 2. ✅
- §9 risks: memory cap (T1/T3), seek staleness (T5 deterministic rebuild), isolation so saved races safe (user-confirmed; T5 snapshot/restore + disposable race). ✅
- §10 backward-compat: additive only, `localStorage` schema unchanged (only `settings.recordAutoArm` added, tolerated by existing `Object.assign`) → invariant + T7 Step 2. ✅

**2. Placeholder scan:** No TBD/TODO; every code step is complete literal code; every command has an expected result. ✅

**3. Type/name consistency:** `RasiReplay` API (`REC_MAX`,`REC_VERSION`,`serializeRecording`,`parseRecording`,`pushCapped`,`nextIndexFor`,`seekTargetMs`) defined in T1, consumed identically in T3/T4/T5 and `test/replay.test.js`. `parseRecording` returns `{ok,error,header,packets,skipped,durationMs}` and stamps `__t`; consumers use `parsed.ok`/`.error`/`.packets`/`.skipped`/`.durationMs` and `nextIndexFor` reads `__t` — consistent. `state.recording`/`state.replay`/`state.settings.recordAutoArm` shapes defined in T3 and used unchanged in T4/T5/T6. DOM ids identical across HTML (T3/T4/T6) and `rasicross.js` wiring (T3/T4/T5): `recAutoArmToggle`,`recSaveBtn`,`recLoadBtn`,`recLoadFile`,`recStatusText`,`replayBar`,`rpPlayBtn`,`rpSeek`,`rpElapsed`,`rpTotal`,`rpSpeed`,`rpExitBtn`. `feedReplayPacket` matches `handleSerialLine`'s call shape. `fmtClock` (from `geo.js`, global) used for the transport readout. ✅

**4. Notes:** `replay.js` exports a single namespace object `window.RasiReplay` (not per-name globals like `geo.js`) because the new call sites are all written here as `RasiReplay.x` — cleaner and avoids global churn; the UMD shape still mirrors `geo.js`. The DOM/transport code is intentionally **not** unit-tested (project precedent: only pure logic gets `node:test`; DOM verified by `node --check` + grep-static + the deferred manual smoke — same model as Phases 2–5). Isolation via full snapshot/restore + a disposable race/driver was the user-confirmed choice; `track`/`startGate` are deliberately **not** reset (they are gate geometry the recording was made against, not accumulators) and are part of the snapshot so an in-replay edit could not leak either. `npm test` rises to `tests 22` (10 geo + 12 replay) deterministically — Phase 7+ would update this baseline if more suites are added.

---

## Phase Map

Phase **6 of 6 — final phase.** Done: Phase 1 (test/CI, `geo.js`), Phase 2 (A1 RPM + A2 wheel-speed, `calc.py`), Phase 3 (A5 CSP + de-inline), Phase 4 (A3 battery), Phase 5 (A4 IMU). This phase delivers C1 (recording + in-app replay) and **completes the entire `2026-05-17-rasicross-telemetry-improvements-design` spec (Groups A + B + C)**. The recorder captures the full telemetry packet — including `spd_src` (P2), `vbat`/`soc`/`batt_warn` (P4), and `gz`/`yaw`/`mtemp` (P5) — so A4's "include … in recording" requirement is satisfied here. Deferred D1 (binary ESP-NOW) and D2 (multi-kart) remain out of scope per spec §3 and would each get their own future spec.
