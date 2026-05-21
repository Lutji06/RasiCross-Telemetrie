# Phase 10 (D1-γ) — Event-Driven Downlink + Kart-Side OLED Clock Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the dashboard's unconditional 500 ms `display` push. The dashboard transmits the OLED race-display message **only** when the *structural* race data actually changes (plus a slow keepalive). The message carries a time anchor; the kart's OLED page computes the running lap clock locally from its own `utime`, so the on-kart display stays smooth between (now rare) downlink packets.

**Architecture:** A new pure `structuralRaceKey(payload)` in `geo.js` (UMD, TDD-able like the rest of the pure JS) returns a stable string of only the non-time-ticking fields. `sendDisplayUpdate` compares it against the last sent key and additionally honours a fixed ~5 s keepalive; everything else stays as today (still JSON, bridge forwards unchanged). The kart's `Display` class gains `set_race_data(d)` (stores the dict + `utime.ticks_ms()` of receipt) and `live_lap_ms()` (returns `lap_ms + ticks_diff(now, recv_tick)` while `running`, else `None`); `page_race` uses the live value when available and falls back to the pre-formatted string for an old/incomplete dashboard.

**Tech Stack:** Vanilla DOM JS + UMD `geo.js` + Node ≥ 18 `node:test`; MicroPython `sender.py`. No new deps. Downlink stays JSON (uplink-only-binary decision from the D1 spec).

---

## Working Directory & Conventions

**Branch `feat/binary-protocol`** in `C:/Users/jimlu/Documents/RasiCross-Telemetrie-git`. Requires Phases α + β committed on this branch (they don't touch the γ surfaces, so anchors are stable; but γ should be authored/executed **after** β so the kart firmware is on the binary uplink, not as a regression risk).

- CRLF: `Read` the target region in-session immediately before each `Edit`; anchor on text (line numbers indicative). Grep tool for verification. `git -C "…"`. Never `git add` `.claude/`; plan doc committed in the final task. `python`/`py -3`; delete `__pycache__` before `git status`.
- **Spec:** `docs/superpowers/specs/2026-05-19-binary-protocol-design.md` §4.5, §6, §9.

**Behavioural invariant:** Downlink is still JSON. The `display` message gains additive fields (`running`, `lap_ms`); old senders ignore unknown keys (existing tolerance — `data.get(...)`). With the new dashboard + old sender: the kart still gets the same string fields it does today, so the OLED keeps working (the live computation is a *fallback chain*: if `lap_ms`+`running` present ⇒ compute live; else use `lap` string as before). With the old dashboard + new kart: the kart sees no `lap_ms`/`running` ⇒ same fallback ⇒ identical behaviour. Backward-compat in both directions. CI: `npm test` rises from `tests 22` to `tests 26` (4 new `structuralRaceKey` cases); Python `unittest` `Ran 30 tests` unchanged.

**Locked decisions (spec):** change-detected + ~5 s keepalive; kart computes clock from `utime` anchor; downlink JSON; bridge unchanged; `displayUpdateMs` retained as the dashboard's internal check tick (no unconditional RF send anymore).

---

## File Structure

| Action | Path | Responsibility |
|--------|------|----------------|
| Modify | `geo.js` | Add pure `structuralRaceKey(d)` + export entry (UMD/`window.structuralRaceKey`). |
| Modify | `test/geo.test.js` | 4 new `node:test` cases for `structuralRaceKey`. |
| Modify | `rasicross.js` | `buildRaceDataForKart` adds `running` + `lap_ms`; `sendDisplayUpdate` is change-detected + 5 s keepalive. |
| Modify | `sender.py` | `Display.set_race_data` / `Display.live_lap_ms` / `_fmt_ms` helper; recv handler calls `set_race_data`; `page_race` uses the live clock when available. |

**Task order:** T1 `structuralRaceKey` + tests (TDD) → T2 dashboard send-on-change → T3 kart-side clock → T4 verify/commit/push.

---

### Task 1: `structuralRaceKey` in `geo.js` + tests (TDD)

**Files:** Modify `geo.js`, Modify `test/geo.test.js`

- [ ] **Step 1: Write the failing tests**

Edit `test/geo.test.js` — replace exactly:

```
  assert.equal(geo.fmtDelta(NaN), 'NaNs');    // NaN bypasses the == null guard (pinned)
});
```

with:

```
  assert.equal(geo.fmtDelta(NaN), 'NaNs');    // NaN bypasses the == null guard (pinned)
});

test('structuralRaceKey: stable when only the running clock ticks', () => {
  const base = {
    type: 'display', driver: 'Alex', num: '7', lapn: 4, target: 10,
    sectors: ['done', 'current', 'open'], best_lap: '1:23.456',
    live_delta_ref: 3, length_type: 'laps', page: 'auto',
    running: true, lap: '0:42.123', lap_ms: 42123,
    elapsed_ms: 200000, remaining_ms: null, live_delta: -250,
  };
  const k1 = geo.structuralRaceKey(base);
  const k2 = geo.structuralRaceKey({
    ...base, lap: '0:42.456', lap_ms: 42456,
    elapsed_ms: 200333, live_delta: -240,
  });
  assert.equal(k1, k2);
});

test('structuralRaceKey: changes on each structural field', () => {
  const base = {
    driver: 'A', num: '1', lapn: 1, target: 5, sectors: ['open','open','open'],
    best_lap: '--', live_delta_ref: null, length_type: 'free',
    page: 'auto', running: false, pit: false,
  };
  const k0 = geo.structuralRaceKey(base);
  const tweaks = [
    { driver: 'B' }, { num: '2' }, { lapn: 2 }, { target: 6 },
    { sectors: ['done','open','open'] }, { best_lap: '1:00.000' },
    { live_delta_ref: 4 }, { length_type: 'time' }, { page: 'race' },
    { running: true }, { pit: true },
  ];
  for (const t of tweaks) {
    assert.notEqual(geo.structuralRaceKey({ ...base, ...t }), k0,
      'expected change for ' + Object.keys(t)[0]);
  }
});

test('structuralRaceKey: null/undefined/empty are stable', () => {
  assert.equal(geo.structuralRaceKey(null), geo.structuralRaceKey(undefined));
  assert.equal(geo.structuralRaceKey({}), geo.structuralRaceKey(null));
});

test('structuralRaceKey: excludes live-ticking + delta fields', () => {
  const base = { driver: 'A', sectors: ['open','open','open'] };
  const k0 = geo.structuralRaceKey(base);
  for (const f of ['lap', 'lap_ms', 'elapsed_ms', 'remaining_ms',
                   'live_delta', 'live_delta_ms']) {
    assert.equal(geo.structuralRaceKey({ ...base, [f]: 12345 }), k0,
      'expected stable across ' + f);
  }
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test` (clone root). Expected: FAIL — the 4 new cases throw `TypeError: geo.structuralRaceKey is not a function`. `geo.test.js`'s existing 10 + `replay.test.js`'s 12 still pass.

- [ ] **Step 3: Add `structuralRaceKey` to `geo.js`**

Edit `geo.js` — replace exactly:

```
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

with:

```
// Stabiler Schluessel ueber die *strukturellen* Felder einer Display-
// Nachricht (alles ausser den staendig tickenden Live-Werten). Wird
// vom Dashboard genutzt, um nur bei echten Aenderungen ein display-
// Paket per USB an die Bridge zu schicken.
function structuralRaceKey(d) {
  d = d || {};
  return JSON.stringify([
    d.driver || '', d.num || '', d.lapn || 0, d.target || '',
    Array.isArray(d.sectors) ? d.sectors.join('|') : '',
    d.best_lap || '', d.live_delta_ref == null ? null : d.live_delta_ref,
    d.length_type || '', d.page || '',
    d.running ? 1 : 0, d.pit ? 1 : 0
  ]);
}

// ── UMD-style export ────────────────────────────────────────
(function () {
  var api = {
    fmtMs: fmtMs, fmtClock: fmtClock, fmtDelta: fmtDelta,
    gpsDist: gpsDist, traceDistanceM: traceDistanceM,
    headingFromPoints: headingFromPoints, segmentsCross: segmentsCross,
    crossingDirectionOk: crossingDirectionOk, lineEndpointsFromGate: lineEndpointsFromGate,
    structuralRaceKey: structuralRaceKey
  };
  if (typeof module !== 'undefined' && module.exports) { module.exports = api; }
  if (typeof window !== 'undefined') {
    for (var k in api) { if (Object.prototype.hasOwnProperty.call(api, k)) window[k] = api[k]; }
  }
})();
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --check geo.js` → exit 0. Run: `node --test` → `tests 26` `pass 26` `fail 0` (10 prior geo + 4 new + 12 replay).
Delete any `__pycache__`; `git status --short` shows only `geo.js` + `test/geo.test.js` modified (plus untracked `.claude/` and the plan doc).

- [ ] **Step 5: Commit**

```bash
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" add geo.js test/geo.test.js
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" commit -m "test(geo): pure structuralRaceKey for change-detected display send

Stable across ticking clock/elapsed/delta; changes on each structural
field (driver/num/lapn/target/sectors/best/live_delta_ref/
length_type/page/running/pit). 4 node:test cases.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 2: Dashboard — change-detected `sendDisplayUpdate` + anchor fields

**Files:** Modify `rasicross.js`

Context: `buildRaceDataForKart` already emits `lap` (string), `elapsed_ms`, `remaining_ms`, `live_delta_ms`. We add `running` (bool, derived from `r.status === 'running'` and `state.lapStart != null`) and `lap_ms` (number) so the kart can compute the live clock. `sendDisplayUpdate` keeps the existing connection guards but only `writeLine` when `structuralRaceKey` differs from the last sent key OR when more than `5000 ms` have passed since the last send (keepalive). `restartDisplayUpdateInterval` is unchanged in shape — the existing `displayUpdateMs` tick still drives `sendDisplayUpdate`, but the *transmit* decision now lives inside it.

- [ ] **Step 1: Read** `rasicross.js`: the `buildRaceDataForKart` return-object (the `lapMs`/`lapStr` derivation block and the `return { type: "display", ... }` literal), and the `function sendDisplayUpdate() { … }` body. Copy anchors from that fresh Read.

- [ ] **Step 2: Add `running` + `lap_ms` to the display payload**

Edit `rasicross.js` — replace exactly:

```
  // Driver-Name max 8 Zeichen, Nummer max 3
  const driverName = drv ? drv.name.slice(0, 8) : "--";
  const driverNum = drv ? String(drv.number || "").slice(0, 3) : "";
  return {
    type:           "display",
    driver:         driverName,
    num:            driverNum,
    lap:            lapStr,
    lapn:           validLaps + 1,
    target:         target,
    delta:          deltaStr,
    live_delta:     liveDeltaStr,
    live_delta_ms:  liveDeltaMs,
    live_delta_ref: state.bestLapNum || null,
    best_lap:       bestStr,
    sectors:        sectorStates,
    elapsed_ms:     elapsedMs,
    remaining_ms:   remainingMs,
    length_type:    r.lengthType,
    page:           state.settings.oledPage || 'auto',
  };
}
```

with:

```
  // Driver-Name max 8 Zeichen, Nummer max 3
  const driverName = drv ? drv.name.slice(0, 8) : "--";
  const driverNum = drv ? String(drv.number || "").slice(0, 3) : "";
  return {
    type:           "display",
    driver:         driverName,
    num:            driverNum,
    lap:            lapStr,
    lap_ms:         state.lapStart ? lapMs : null,    // Kart-seitiger Anker
    lapn:           validLaps + 1,
    target:         target,
    delta:          deltaStr,
    live_delta:     liveDeltaStr,
    live_delta_ms:  liveDeltaMs,
    live_delta_ref: state.bestLapNum || null,
    best_lap:       bestStr,
    sectors:        sectorStates,
    elapsed_ms:     elapsedMs,
    remaining_ms:   remainingMs,
    length_type:    r.lengthType,
    page:           state.settings.oledPage || 'auto',
    running:        r.status === 'running' && !!state.lapStart,
    pit:            !!_pitCallActive,
  };
}
```

- [ ] **Step 3: Make `sendDisplayUpdate` change-detected with a 5 s keepalive**

Edit `rasicross.js` — replace exactly:

```
function sendDisplayUpdate() {
  if (state.connection.source !== 'serial' || !state.serial.connected) return;
  if (!window.rasiSerial?.writeLine) return;
  const payload = buildRaceDataForKart();
  if (!payload) return;
  try {
    window.rasiSerial.writeLine(JSON.stringify(payload));
  } catch (e) {
    // stumm - keine Hupe wenn der Sender mal nicht erreichbar ist
  }
}
```

with:

```
// Sendekriterium (D1-gamma): nur bei struktureller Aenderung oder
// alle 5 s als Keepalive. Spart RF-Traffic; OLED-Uhr laeuft kart-
// seitig per utime weiter.
let _lastDisplayKey = '';
let _lastDisplayAt = 0;
const RC_DISPLAY_KEEPALIVE_MS = 5000;
function sendDisplayUpdate() {
  if (state.connection.source !== 'serial' || !state.serial.connected) return;
  if (!window.rasiSerial?.writeLine) return;
  const payload = buildRaceDataForKart();
  if (!payload) return;
  const key = structuralRaceKey(payload);
  const now = Date.now();
  if (key === _lastDisplayKey && (now - _lastDisplayAt) < RC_DISPLAY_KEEPALIVE_MS) return;
  try {
    window.rasiSerial.writeLine(JSON.stringify(payload));
    _lastDisplayKey = key;
    _lastDisplayAt = now;
  } catch (e) {
    // stumm - keine Hupe wenn der Sender mal nicht erreichbar ist
  }
}
```

- [ ] **Step 4: Verify**

Run: `node --check rasicross.js` → exit 0. Run: `node --test` → `tests 26` `pass 26` `fail 0`.
Run (Grep tool) `rasicross.js`: `lap_ms:` → 1; `running:` → 1; `pit:` → ≥1; `structuralRaceKey\(payload\)` → 1; `RC_DISPLAY_KEEPALIVE_MS = 5000` → 1; `_lastDisplayKey` → ≥3; `_lastDisplayAt` → ≥3. Confirm (fresh Read) `restartDisplayUpdateInterval` is unchanged (still uses `state.settings.displayUpdateMs` for the internal tick).
Delete any `__pycache__`; `git status --short` shows only `rasicross.js` modified.

- [ ] **Step 5: Commit**

```bash
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" add rasicross.js
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" commit -m "feat(dashboard): change-detected display send + anchor fields (D1-gamma)

sendDisplayUpdate transmits only on structuralRaceKey change or every
5 s (keepalive). buildRaceDataForKart adds running + lap_ms so the
kart computes the live OLED clock locally. Big RF-traffic reduction;
no behaviour change beyond cadence.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 3: Kart — `Display.set_race_data` / `live_lap_ms` / `page_race` live clock

**Files:** Modify `sender.py`

Context: `class Display` (`sender.py` ~line 489). The recv handler (~line 1052) currently sets a local `race_data = data` and calls `display.set_forced_page(...)`. We add two methods to `Display`, call `set_race_data` from recv, and update `page_race` (~line 746) to render a live-computed lap string when `running` + `lap_ms` are present, falling back to today's pre-formatted `race.get("lap")` otherwise. A small `_fmt_ms(ms)` helper at module level produces `"M:SS.mmm"` like the dashboard's `geo.fmtMs`.

- [ ] **Step 1: Read** `sender.py`: the `class Display:` `__init__` end (the lines just before `# ── Public API ────────────`), the existing `set_forced_page(self, name)` method, the `def page_race(o, ctx):` function (the full ~15-line body including the `lap = str(race.get("lap", "--:--.---"))[:9]` line), and the recv handler block (`if kind == "display": race_data = data … display.set_forced_page(page_choice)`). Copy anchors from that fresh Read.

- [ ] **Step 2: Add a module-level `_fmt_ms` helper before `page_race`**

Edit `sender.py` — replace exactly:

```
def page_race(o, ctx):
    """Seite 2: Sektor-Segmente oben + Rundenzeit gross."""
```

with:

```
def _fmt_ms(ms):
    """Millisekunden -> 'M:SS.mmm' (Kart-seitige Live-Uhr, D1-gamma)."""
    if ms is None or ms < 0:
        ms = 0
    ms = int(ms)
    m = ms // 60000
    s = (ms % 60000) // 1000
    r = ms % 1000
    return "{}:{:02d}.{:03d}".format(m, s, r)


def page_race(o, ctx):
    """Seite 2: Sektor-Segmente oben + Rundenzeit gross."""
```

- [ ] **Step 3: Add `set_race_data` + `live_lap_ms` to `Display.__init__` + methods**

Edit `sender.py` — replace exactly:

```
        # Pit-Call Override
        self._pit_active  = False
        self._pit_until   = 0
        self._pit_message = "PIT STOP"
```

with:

```
        # Pit-Call Override
        self._pit_active  = False
        self._pit_until   = 0
        self._pit_message = "PIT STOP"

        # Race-Anker fuer kart-seitige OLED-Uhr (D1-gamma).
        # set_race_data(d) speichert d + den Empfangs-Tick; live_lap_ms()
        # rechnet die laufende Rundenzeit lokal aus utime weiter, solange
        # 'running' im d ist und 'lap_ms' geliefert wurde.
        self._race          = None
        self._race_recv_tick = 0
```

Edit `sender.py` — replace exactly:

```
    def set_forced_page(self, name):
        """Setzt die fest angezeigte Seite. None oder 'auto' = Auto-Wechsel."""
```

with:

```
    def set_race_data(self, d):
        """Race-Display-Nachricht + Empfangs-Tick speichern (D1-gamma)."""
        self._race = d or None
        self._race_recv_tick = utime.ticks_ms()

    def live_lap_ms(self):
        """Lokal hochgerechnete Rundenzeit in ms, oder None wenn kein
        Anker geliefert wurde / nicht 'running'. Bei Pause/Stop friert
        die Uhr ein."""
        d = self._race
        if not d or not d.get("running"):
            return None
        base = d.get("lap_ms")
        if base is None:
            return None
        return base + utime.ticks_diff(utime.ticks_ms(), self._race_recv_tick)

    def set_forced_page(self, name):
        """Setzt die fest angezeigte Seite. None oder 'auto' = Auto-Wechsel."""
```

- [ ] **Step 4: recv handler calls `set_race_data`**

Edit `sender.py` — replace exactly:

```
            if kind == "display":
                race_data = data
                log("recv", "display:", data.get("driver", "?"),
                    "lap=", data.get("lap", "?"))
                # Page-Auswahl vom Dashboard uebernehmen
                page_choice = data.get("page", "auto")
                display.set_forced_page(page_choice)
```

with:

```
            if kind == "display":
                race_data = data
                display.set_race_data(data)
                log("recv", "display:", data.get("driver", "?"),
                    "lap=", data.get("lap", "?"))
                # Page-Auswahl vom Dashboard uebernehmen
                page_choice = data.get("page", "auto")
                display.set_forced_page(page_choice)
```

- [ ] **Step 5: `page_race` renders the live clock when available**

Edit `sender.py` — replace exactly:

```
    # Rundenzeit gross zentriert (2x skaliert)
    lap = str(race.get("lap", "--:--.---"))[:9]
    ctx["display"].big_text(lap, 0, 30, 2)
```

with:

```
    # Rundenzeit gross zentriert (2x skaliert).
    # Wenn das Dashboard einen Anker geliefert hat (running + lap_ms),
    # rechnen wir hier kart-seitig live weiter (D1-gamma). Sonst
    # Fallback auf den vorformatierten String vom Dashboard.
    live_ms = ctx["display"].live_lap_ms()
    if live_ms is not None:
        lap = _fmt_ms(live_ms)[:9]
    else:
        lap = str(race.get("lap", "--:--.---"))[:9]
    ctx["display"].big_text(lap, 0, 30, 2)
```

- [ ] **Step 6: Static verification**

Run: `python -m py_compile sender.py esp_libs/frame.py esp_libs/calc.py` (or `py -3 …`) → exit 0.
Run: `python -m unittest discover -s test -p "test_*.py"` → `Ran 30 tests` `OK` (Python suite unaffected).
Run: `node --test` → `tests 26` `pass 26` `fail 0`.
Run (Grep tool) `sender.py`: `def _fmt_ms\(ms\)` → 1; `def set_race_data\(self, d\)` → 1; `def live_lap_ms\(self\)` → 1; `display\.set_race_data\(data\)` → 1; `live_ms = ctx\["display"\]\.live_lap_ms\(\)` → 1; `self\._race          = None` → 1; `self\._race_recv_tick = 0` → 1. Confirm (fresh Read) the rest of `page_race` (sector bar, `R{}/{}`) and `set_forced_page` are unchanged.
Delete any `__pycache__`; `git status --short` shows only `sender.py` modified.

- [ ] **Step 7: Commit**

```bash
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" add sender.py
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" commit -m "feat(kart): local OLED race clock from anchor (D1-gamma)

Display.set_race_data stores d + utime tick; live_lap_ms() runs the
lap clock from utime while 'running'. page_race uses the live value
when the dashboard sent an anchor (lap_ms + running), falls back to
the pre-formatted string otherwise (full backward-compat with old
dashboards). _fmt_ms helper for ms -> M:SS.mmm.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 4: Verification, plan commit & push

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
Expected: all exit 0; `npm test` = `tests 26 | pass 26 | fail 0` (10 geo + 4 structuralRaceKey + 12 replay); unittest = `Ran 30 tests` `OK` (unchanged). Delete any `__pycache__`; `git status --short` shows no pyc (only the untracked plan doc until Step 2, plus `.claude/`).

- [ ] **Step 2: Backward-compat spot-check + commit the plan document**
- Grep `geo.js`: `function structuralRaceKey` → 1; `structuralRaceKey: structuralRaceKey` in the UMD `api` → 1. Grep `rasicross.js`: `structuralRaceKey(payload)` → 1; `RC_DISPLAY_KEEPALIVE_MS` → 1; `lap_ms:` → 1; `running:` → 1. Grep `sender.py`: `set_race_data`/`live_lap_ms` defined; recv handler calls `set_race_data`; `page_race` uses `live_lap_ms()` with fallback to `race.get("lap")`. Confirm `bridge.py` is **not** in `git status` (bridge unchanged; downlink still JSON, just rarer).
```bash
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" add docs/superpowers/plans/2026-05-19-10-event-driven-downlink.md
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" commit -m "docs: D1-gamma event-driven downlink + kart clock plan

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

- [ ] **Step 3: Push**
```bash
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" push
```

- [ ] **Step 4: Deferred to user (do NOT attempt here):** GitHub Actions `check` confirmation (no `gh`) and the hardware checklist below.

---

## Hardware Acceptance Checklist (user-run, real ESP32 pair — not runtime-testable here)

1. With Phases α + β flashed: start a race → OLED Page 2 shows the running lap clock **smoothly** (no 500 ms steps), even though `display` is now sent only on structural change + every 5 s.
2. Driver/lap-number/sector-state/page changes are reflected immediately on the OLED (each triggers a structural-key change).
3. Pause / end race → the OLED lap clock freezes (no `running` ⇒ `live_lap_ms` returns `None` ⇒ fallback to whatever string the dashboard last sent).
4. Pit-call still works (`pit` flag is part of the structural key ⇒ instant send on `_pitCallActive` flip; the existing pit_call message path is unchanged).
5. RF-traffic measurably reduced: observed `display` packets ≈ change events plus ~12 per minute keepalive, vs ~120 per minute (500 ms) before.
6. Backward-compat: with the OLD dashboard (no `lap_ms`/`running`), the new kart's `page_race` falls back to the dashboard's pre-formatted `lap` string ⇒ identical UX to today. With the OLD kart (no `set_race_data`), the new dashboard's `display` JSON has extra harmless keys ⇒ ignored.
7. Long-Range mode, peer-learning, NVS kart-MAC, `bridge_hello`, all unchanged.

---

## Self-Review

**1. Spec coverage (§4.5, §6, §9):**
- §4.5 dashboard: change-detected `sendDisplayUpdate` via `structuralRaceKey` + ~5 s keepalive; `displayUpdateMs` no longer forces an unconditional RF send → Task 2 (+ unchanged `restartDisplayUpdateInterval`). ✅
- §4.5 anchor fields (`running`, `lap_ms` plus existing `elapsed_ms`/`remaining_ms`) → Task 2 Step 2. ✅
- §4.5 kart computes live clock from anchor + own `utime`; pause/stop freezes → Task 3 (`Display.set_race_data`/`live_lap_ms`, `page_race` fallback chain, `_fmt_ms`). ✅
- §4.5 downlink stays JSON; bridge unchanged → invariant + Task 4 Step 2 (bridge not in status). ✅
- §6 testing: pure `structuralRaceKey` `node:test` (4 cases — stability, structural sensitivity, null-handling, exclusion of live fields); ESP kart-clock via static review + `py_compile` + hardware checklist (project precedent). ✅
- §9 OLED drift/jump: kart computes from local `utime` + anchor; 5 s keepalive resyncs; checklist 1/5. ✅

**2. Placeholder scan:** No TBD/TODO; complete literal old/new blocks; every command has an expected result. ✅

**3. Type/name consistency:** `structuralRaceKey(d)` signature defined in T1, called identically in T2 (`structuralRaceKey(payload)`). Dashboard payload keys `running`/`lap_ms`/`pit` added in T2 ↔ consumed in T1 tests ↔ read by `Display.live_lap_ms()` in T3 (`d.get("running")`, `d.get("lap_ms")`). `_fmt_ms` and `set_race_data`/`live_lap_ms` are defined before their first call (`_fmt_ms` defined before `page_race`; `Display` methods defined inside class before any `display.set_race_data(...)`/`display.live_lap_ms()` call in `main`). Test counts: `npm test` 22→26 (+4), `unittest` 27 (unchanged). ✅

**4. Notes:** The `pit` field is added to the structural key so a pit-call instantly forces a `display` send (still independent of the dedicated `pit_call` control message which keeps its own path). The fallback chain (live → string → "--:--.---") preserves every prior behaviour: old kart, old dashboard, new kart with no anchor, new dashboard with old kart. `restartDisplayUpdateInterval` stays — `displayUpdateMs` is now the dashboard's *check* interval (cheap local function call), not the RF cadence; users can leave the existing setting alone.

---

## Phase Map / Branch & Sequencing

D1 Phase **γ (10 of the set)** on `feat/binary-protocol`. **Final D1 phase.** Requires α (`frame.py`) and β (sender/bridge binary lockstep) committed and ideally flashed. With γ done, the full D1 design is implemented; the branch is ready to PR (after the telemetry/gear-ratio branches land, or against `docs/telemetry-improvements-spec`). D2 (multi-kart) remains out of scope; future deferred specs.
