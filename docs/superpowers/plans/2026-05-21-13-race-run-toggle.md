# Race-Run Toggle (Start/Pause Button) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Live-tab race-control button a toggle — Start → Pause → Fortsetzen — and make resuming a paused race continue lap/sector timing seamlessly.

**Architecture:** Pure dashboard change in `rasicross.js`. A new `toggleRaceRun()` dispatcher is wired to `#startRaceBtn`; `updateRaceControls()` labels/enables the button per race status; `startRace()` is split so its full reset runs only on a fresh start, while the resume branch shifts the in-memory lap/sector clocks past the pause.

**Tech Stack:** Vanilla DOM JS (`rasicross.js`, loaded via `file://`, no bundler). No new dependencies, no new tests. ESLint 9 flat config + Ruff already gate the repo.

---

## Working Directory & Conventions

**Branch `feat/race-run-toggle`** in `C:/Users/jimlu/Documents/RasiCross-Telemetrie-git`. The design spec is committed on this branch (`f8fe88c`); the prior repo-hygiene work is `7fdfb34`.

- **Spec:** `docs/superpowers/specs/2026-05-21-race-run-toggle-design.md`.
- **CRLF:** `rasicross.js` is CRLF. `Read` the target region in-session immediately before each `Edit`; anchor on the literal text (line numbers below are indicative only). Use the Grep tool for verification counts.
- **No new tests** (spec §6): `startRace`/`updateRaceControls`/`toggleRaceRun` are stateful `rasicross.js` code, covered by static review like the rest of that file. The existing 36 JS + 34 Python tests must stay green.
- Verification recipe (run from the clone root; `py -3` if `python` is absent):
  ```
  node --check rasicross.js
  npm run lint
  npm test
  python -m py_compile sender.py bridge.py esp_libs/*.py
  python -m unittest discover -s test -p "test_*.py"
  python -m ruff check
  ```
  Delete any `__pycache__` before `git status`.

---

## File Structure

| Action | Path | Responsibility |
|--------|------|----------------|
| Modify | `rasicross.js` | `updateRaceControls` (button label/enable), new `toggleRaceRun` dispatcher, init wiring, `startRace` fresh-start vs. seamless-resume split, drop `pauseRace`'s `eslint-disable`. |

**Task order:** Task 1 (button toggle — dispatcher + labels + wiring) → Task 2 (seamless resume in `startRace`).

---

### Task 1: Button toggle — dispatcher, labels, wiring

**Files:**
- Modify: `rasicross.js` — `updateRaceControls()` (~line 1932), `pauseRace()` (~line 1712), insert `toggleRaceRun()` after `pauseRace`, `init()` wiring (~line 3384).

- [ ] **Step 1: Label/enable the button per race status**

Edit `rasicross.js` — replace exactly:

```
function updateRaceControls() {
  const r = activeRace();
  const running = r && r.status === 'running';
  const paused = r && r.status === 'paused';
  const canStart = r && (r.status === 'created' || r.status === 'paused');
  const startBtn = $('startRaceBtn');
  const changeBtn = $('changeDriverBtn');
  const endBtn = $('endRaceBtn');
  if (startBtn) {
    startBtn.disabled = !canStart;
    startBtn.textContent = paused ? 'Fortsetzen' : 'Start';
  }
  if (changeBtn) changeBtn.disabled = !running;
  if (endBtn) endBtn.disabled = !(running || paused);
}
```

with:

```
function updateRaceControls() {
  const r = activeRace();
  const running = r && r.status === 'running';
  const paused = r && r.status === 'paused';
  const startBtn = $('startRaceBtn');
  const changeBtn = $('changeDriverBtn');
  const endBtn = $('endRaceBtn');
  if (startBtn) {
    // Start-Button ist ein Toggle: Start -> Pause -> Fortsetzen
    if (running) {
      startBtn.disabled = false;
      startBtn.textContent = 'Pause';
    } else if (paused) {
      startBtn.disabled = false;
      startBtn.textContent = 'Fortsetzen';
    } else {
      startBtn.disabled = !(r && r.status === 'created');
      startBtn.textContent = 'Start';
    }
  }
  if (changeBtn) changeBtn.disabled = !running;
  if (endBtn) endBtn.disabled = !(running || paused);
}
```

Note: `canStart` is removed — it is no longer used, and ESLint's `no-unused-vars` would flag it if left behind.

- [ ] **Step 2: Drop the obsolete `eslint-disable` above `pauseRace`**

Edit `rasicross.js` — replace exactly:

```
// pauseRace ist vollstaendig implementiert, aber (noch) an keinen
// Button gebunden -- "Fortsetzen" laeuft ueber den Start-Button.
// eslint-disable-next-line no-unused-vars
function pauseRace() {
```

with:

```
function pauseRace() {
```

- [ ] **Step 3: Add the `toggleRaceRun()` dispatcher after `pauseRace`**

Edit `rasicross.js` — replace exactly (this is `pauseRace`'s closing brace followed by the start of the next function):

```
  saveDataDebounced();
}
function openDriverChange() {
```

with:

```
  saveDataDebounced();
}
function toggleRaceRun() {
  // Start-Button-Toggle: laeuft -> pausieren, sonst -> starten/fortsetzen
  const r = activeRace();
  if (r && r.status === 'running') pauseRace();
  else startRace();
}
function openDriverChange() {
```

- [ ] **Step 4: Wire the button to the dispatcher**

Edit `rasicross.js` — replace exactly:

```
  $('startRaceBtn').onclick = startRace;
```

with:

```
  $('startRaceBtn').onclick = toggleRaceRun;
```

- [ ] **Step 5: Verify**

Run: `node --check rasicross.js` → exit 0.
Run: `npm run lint` → ESLint prints no problems (exit 0). In particular `canStart` no longer exists and `pauseRace`/`toggleRaceRun` are both referenced, so `no-unused-vars` stays clean.
Run: `npm test` → `tests 36` `pass 36` `fail 0`.
Grep (tool) `rasicross.js`: `function toggleRaceRun` → 1; `onclick = toggleRaceRun` → 1; `eslint-disable-next-line no-unused-vars` → 0; `const canStart` → 0.
Delete any `__pycache__`; `git status --short` shows only `rasicross.js` modified.

- [ ] **Step 6: Commit**

```bash
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" add rasicross.js
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" commit -m "feat(dashboard): toggle Start button to Start/Pause/Resume

New toggleRaceRun() dispatcher wired to #startRaceBtn: pauses a running
race, otherwise starts/resumes it. updateRaceControls labels the button
Start/Pause/Fortsetzen and keeps it enabled while a race is running.
pauseRace is now referenced, so its eslint-disable is removed.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 2: Seamless resume after a pause

**Files:**
- Modify: `rasicross.js` — `startRace()` (~line 1642).

Context: `startRace()` currently runs one unconditional reset block (`state.lapStart` … `state.autoLap.prevLon`) for **both** the fresh-start and the resume case, so resuming today also wipes the in-progress lap, the sectors and the session best lap. This task moves that block into the fresh-start branch only and gives the resume branch a seamless time-shift (spec §4.3).

- [ ] **Step 1: Split `startRace` into fresh-start vs. seamless resume**

Edit `rasicross.js` — replace exactly:

```
function startRace() {
  try {
    const r = activeRace();
    if (!r) return rcAlert('Bitte ein Rennen aktivieren.');
    if (r.status === 'running') return;
    if (r.status === 'finished' || r.status === 'finished_auto') return rcAlert('Rennen ist beendet.');
    const now = Date.now();
    if (r.status === 'paused') {
      r.totalPausedMs = (r.totalPausedMs || 0) + (now - (r.pausedAt || now));
      r.pausedAt = null;
      r.status = 'running';
    } else {
      r.status = 'running';
      r.startedAt = now;
      r.endedAt = null;
      r.totalPausedMs = 0;
      r.stints = [{ id: uid(), driverId: r.currentDriverId, startAt: now, endAt: null }];
      r.laps = [];
      r.speedTrace = [];
    }
    state.lapStart = now;
    state.currentLapMax = { speed: 0, rpm: 0 };
    state.currentLapTrace = [];
    state.bestLapMs = null;
    state.bestLapNum = null;
    state.bestLapTrace = null;
    state.heatmap.lapMaxSpeed = 0;
    state.sectors.cur = 0;
    state.sectors.sectorStart = now;
    state.sectors.lapSectors = [null, null, null];
    state.sectors.lastLapSectors = null;
    state.autoLap.prevLat = null;
    state.autoLap.prevLon = null;
    renderRaces();
    updateRaceControls();
    updateSectorPanel();
    saveDataDebounced();
  } catch (e) { console.warn('startRace:', e); }
}
```

with:

```
function startRace() {
  try {
    const r = activeRace();
    if (!r) return rcAlert('Bitte ein Rennen aktivieren.');
    if (r.status === 'running') return;
    if (r.status === 'finished' || r.status === 'finished_auto') return rcAlert('Rennen ist beendet.');
    const now = Date.now();
    if (r.status === 'paused') {
      // Fortsetzen: Pausendauer ermitteln, Rennuhr korrigieren.
      const pausedMs = now - (r.pausedAt || now);
      r.totalPausedMs = (r.totalPausedMs || 0) + pausedMs;
      r.pausedAt = null;
      r.status = 'running';
      if (typeof state.lapStart === 'number') {
        // Live-Renndaten noch im Speicher -> Lauf- und Sektor-Uhr um
        // die Pause vorruecken, damit die Zeit nahtlos weiterlaeuft.
        state.lapStart += pausedMs;
        if (typeof state.sectors.sectorStart === 'number') {
          state.sectors.sectorStart += pausedMs;
        }
      } else {
        // Nach App-Neustart sind die Live-Lap-Daten weg -> aktuelle
        // Runde frisch beginnen (gefahrene Runden bleiben erhalten).
        state.lapStart = now;
        state.currentLapMax = { speed: 0, rpm: 0 };
        state.currentLapTrace = [];
        state.heatmap.lapMaxSpeed = 0;
        state.sectors.cur = 0;
        state.sectors.sectorStart = now;
        state.sectors.lapSectors = [null, null, null];
      }
      // Stale GPS-Punkt verwerfen, sonst Geister-Durchfahrt moeglich.
      state.autoLap.prevLat = null;
      state.autoLap.prevLon = null;
    } else {
      // Frischer Start: kompletter Reset wie bisher.
      r.status = 'running';
      r.startedAt = now;
      r.endedAt = null;
      r.totalPausedMs = 0;
      r.stints = [{ id: uid(), driverId: r.currentDriverId, startAt: now, endAt: null }];
      r.laps = [];
      r.speedTrace = [];
      state.lapStart = now;
      state.currentLapMax = { speed: 0, rpm: 0 };
      state.currentLapTrace = [];
      state.bestLapMs = null;
      state.bestLapNum = null;
      state.bestLapTrace = null;
      state.heatmap.lapMaxSpeed = 0;
      state.sectors.cur = 0;
      state.sectors.sectorStart = now;
      state.sectors.lapSectors = [null, null, null];
      state.sectors.lastLapSectors = null;
      state.autoLap.prevLat = null;
      state.autoLap.prevLon = null;
    }
    renderRaces();
    updateRaceControls();
    updateSectorPanel();
    saveDataDebounced();
  } catch (e) { console.warn('startRace:', e); }
}
```

Behaviour check: on a within-session resume `state.lapStart` is a number → it and `sectors.sectorStart` advance by exactly `pausedMs`, so `now - state.lapStart` equals the partial lap time at the moment of pause (seamless); `bestLapMs`/`bestLapNum`/`bestLapTrace` and the completed laps are untouched. After an app restart `state.lapStart` is not a number → the current lap restarts fresh. Fresh start is byte-for-byte the old behaviour.

- [ ] **Step 2: Verify**

Run: `node --check rasicross.js` → exit 0.
Run: `npm run lint` → no problems (exit 0).
Run: `npm test` → `tests 36` `pass 36` `fail 0`.
Run: `python -m py_compile sender.py bridge.py esp_libs/*.py` → exit 0.
Run: `python -m unittest discover -s test -p "test_*.py"` → `Ran 34 tests` `OK`.
Run: `python -m ruff check` → `All checks passed!`.
Grep (tool) `rasicross.js`: `state.lapStart += pausedMs` → 1; `Frischer Start` → 1; confirm `state.bestLapMs = null` now appears only once (inside the fresh-start branch).
Delete any `__pycache__`; `git status --short` shows only `rasicross.js` modified.

- [ ] **Step 3: Commit**

```bash
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" add rasicross.js
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" commit -m "feat(dashboard): seamless resume after a race pause

startRace's full reset now runs only on a fresh start. The resume
branch shifts state.lapStart and sectors.sectorStart past the pause so
lap and sector timing continue seamlessly, and keeps the session best
lap and completed laps. If in-memory lap state was lost (app restart),
it falls back to a fresh current lap.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Manual Acceptance (user, in the running app — not runtime-testable here)

Per spec §6:

1. Create + activate a race → button shows **Start**, enabled.
2. Click Start → race runs, button shows **Pause**.
3. Drive part of a lap, click **Pause** → race freezes; click again (**Fortsetzen**) → lap time and sector continue from where they were, the pause not counted; session best lap and completed laps intact.
4. Race elapsed time excludes the pause duration.
5. End a race → button shows **Start**, disabled.
6. Pause a race, restart the app → race is `paused`, button shows **Fortsetzen**; resuming starts a fresh current lap, completed laps intact.

---

## Self-Review

**1. Spec coverage:**
- §4.1 button states (created/running/paused/finished) → Task 1 Step 1. ✅
- §4.2 `toggleRaceRun` dispatcher + init wiring → Task 1 Steps 3–4. ✅
- §4.3 seamless resume: reset block moved to fresh-start branch; resume shifts `lapStart`/`sectorStart`, fallback on lost state, `autoLap` reset, best lap preserved → Task 2 Step 1. ✅
- §4.4 drop `pauseRace` `eslint-disable` → Task 1 Step 2. ✅
- §6 no new tests; existing 36 JS + 34 Python green; static checks → verification steps. ✅

**2. Placeholder scan:** No TBD/TODO; every edit step shows complete literal old/new blocks; every command has an expected result. ✅

**3. Type/name consistency:** `toggleRaceRun` defined in Task 1 Step 3, referenced in Step 4; `pauseRace`/`startRace`/`activeRace` are existing functions used unchanged in signature; `state.lapStart`, `state.sectors.sectorStart`, `state.autoLap.prevLat/prevLon`, `state.heatmap.lapMaxSpeed` are existing fields. `npm test` stays at 36 (no test changes). ✅
