# RasiCross — Start/Pause Toggle for the Race Control Button

**Date:** 2026-05-21
**Status:** Approved (design); pending implementation plan
**Author:** Brainstorming session (Claude + user)

---

## 1. Purpose

The race-control button in the Live tab currently only starts (and resumes) a
race; pausing a running race from the UI is impossible. `pauseRace()` is fully
implemented in `rasicross.js` but bound to no button. This change makes the
existing button a **toggle**: Start → Pause → Fortsetzen (Resume), so a running
race can be paused and resumed from one button. Resuming continues lap and
sector timing **seamlessly**, with the pause excluded.

## 2. Background / current state (grounding facts)

- The button is `#startRaceBtn` (`RasiCross_Telemetry.html`, `class="btn good"`,
  contains a play-triangle `<svg>`). `init()` wires
  `$('startRaceBtn').onclick = startRace`.
- `updateRaceControls()` (`rasicross.js`) sets `startBtn.disabled` and
  `startBtn.textContent` (`'Fortsetzen'` when paused, else `'Start'`). Assigning
  `.textContent` already removes the inline `<svg>` on the first call — the
  button is text-only in practice today.
- Race `status` values: `created`, `running`, `paused`, `finished`,
  `finished_auto`.
- `startRace()` handles two cases in one function: fresh start
  (`status==='created'`) and resume (`status==='paused'`). After the
  case-specific branch, an **unconditional** block runs for **both** cases — it
  resets `state.lapStart`, `currentLapMax`, `currentLapTrace`,
  `bestLapMs`/`bestLapNum`/`bestLapTrace`, `heatmap.lapMaxSpeed`, `sectors.*`
  and `autoLap.prev*`. So resuming today also wipes the in-progress lap, the
  sectors and the session best lap.
- `pauseRace()` sets `status='paused'` and `pausedAt=Date.now()`; nothing else.
- `endRace()` ends a race from `running` or `paused`.
- Race elapsed time (`raceElapsedMs`) already excludes paused time via
  `r.totalPausedMs`; `startRace()`'s resume branch accumulates `totalPausedMs`.
- `state.lapStart`, `state.sectors.sectorStart`, `state.autoLap.prev*` are
  **in-memory only** — not in the persisted set (`drivers`, `races`,
  `activeRaceId`, `selectedRaceId`, `gateFlashUntil`). `r.pausedAt` and
  `r.totalPausedMs` live on the race object and are persisted.
- `pauseRace()` currently carries an `eslint-disable-next-line no-unused-vars`
  comment because it is unreferenced.

## 3. Scope

### In scope

| ID | Item | Surface |
|----|------|---------|
| T1 | `toggleRaceRun()` dispatcher + button wiring | `rasicross.js` |
| T2 | Button label / enabled state per race status | `rasicross.js` (`updateRaceControls`) |
| T3 | Seamless resume: split `startRace()` into fresh-start vs resume | `rasicross.js` (`startRace`) |

### Out of scope

- Per-state button icons (button stays text-only — matches today's de-facto
  behaviour).
- Button colour change between states (stays `btn good`).
- Persisting `lapStart` / sector / best-lap state across an app restart.
- Any change to `endRace`, to `pauseRace`'s status/`pausedAt` behaviour, to
  `bridge.py` or ESP firmware.

## 4. Detailed design

### 4.1 Button states (T2 — `updateRaceControls`)

| Race status | Label | Enabled |
|-------------|-------|---------|
| no active race | Start | no |
| `created` | Start | yes |
| `running` | Pause | yes |
| `paused` | Fortsetzen | yes |
| `finished` / `finished_auto` | Start | no |

`startBtn.textContent` carries the label; `startBtn.disabled` is true only when
there is no active race or the race is finished.

### 4.2 Click dispatcher (T1)

New function `toggleRaceRun()`:

- active race with `status==='running'` → `pauseRace()`
- otherwise → `startRace()` (which itself handles `created`, `paused`, the
  "no active race" alert, and the finished guard)

`init()` wiring changes from `$('startRaceBtn').onclick = startRace` to
`$('startRaceBtn').onclick = toggleRaceRun`.

### 4.3 Seamless resume (T3 — `startRace`)

The unconditional reset block moves into the **fresh-start branch only**. The
resume branch (`status==='paused'`) instead:

- computes the pause duration `d = now - r.pausedAt` (the value already used to
  accumulate `totalPausedMs`);
- if `state.lapStart` is set (a number, not `null`/`undefined`):
  `state.lapStart += d`, and if `state.sectors.sectorStart` is set
  `state.sectors.sectorStart += d` — the lap and sector clocks advance past the
  pause so live timing continues seamlessly;
- if `state.lapStart` is **not** set (e.g. the race was paused, then the app
  restarted — in-memory lap state is gone): fall back to a fresh current lap by
  resetting the in-progress lap state (`lapStart`, `sectors.sectorStart`,
  `sectors.cur`, `sectors.lapSectors`, `currentLapMax`, `currentLapTrace`,
  `heatmap.lapMaxSpeed`) — a seamless continuation is impossible because the
  live data was never persisted; the race's completed laps are unaffected;
- always resets `state.autoLap.prevLat`/`prevLon` to `null` (safe: forces GPS
  re-acquisition, avoids a spurious geofence crossing from a stale point);
- leaves `state.bestLapMs`/`bestLapNum`/`bestLapTrace`, the completed laps and,
  on the seamless path, the in-progress lap's accumulated data untouched.

Fresh-start behaviour is unchanged (full reset, exactly as today).

### 4.4 Lint

`pauseRace()` becomes referenced by `toggleRaceRun()`, so its
`eslint-disable-next-line no-unused-vars` line and the two explanatory comment
lines above it are removed.

## 5. Backward compatibility

- Pure dashboard change; no telemetry, USB-protocol, bridge or ESP impact.
- `localStorage` schema unchanged. A race persisted as `paused` resumes
  correctly (degrading to a fresh current lap per §4.3).
- Fresh-start and end-race behaviour unchanged.

## 6. Testing strategy

- **No new unit tests.** The changed code (`startRace`, `updateRaceControls`,
  `toggleRaceRun`) is stateful `rasicross.js` code, which the project covers by
  static review rather than `node:test` — only the pure
  `geo.js`/`replay.js`/`karts3d.js` cores are unit-tested. The existing 36 JS +
  34 Python tests must stay green.
- **Static checks:** `node --check`, `npm run lint` (ESLint clean), `npm test`,
  and the Python suite — all green.
- **Manual acceptance** (user, in the running app):
  1. Create + activate a race → button shows **Start**, enabled.
  2. Click Start → race runs, button shows **Pause**.
  3. Drive part of a lap, click **Pause** → race freezes; click again
     (**Fortsetzen**) → lap time and sector continue from where they were, the
     pause not counted; session best lap and completed laps intact.
  4. Race elapsed time excludes the pause duration.
  5. End a race → button shows **Start**, disabled.
  6. Pause a race, restart the app → race is `paused`, button shows
     **Fortsetzen**; resuming starts a fresh current lap, completed laps intact.

## 7. Risks & mitigations

| Risk | Mitigation |
|------|------------|
| `state.lapStart` is `null` on resume (post-restart) → `NaN` timers | Explicit validity check → fresh-lap fallback (§4.3). |
| A stale `autoLap` point triggers a false lap crossing on resume | Resume resets `autoLap.prev*` to `null`. |
| Resume accidentally wipes the session best lap (today's behaviour) | The reset block moves into the fresh-start branch only. |
