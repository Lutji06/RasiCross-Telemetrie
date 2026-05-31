# Phase 19b — Rollwinkel-Dashboard + Umkipp-Warnung — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Den in Phase 19a gesendeten Roll-Raten-Wert im Dashboard zu einem Rollwinkel fusionieren, als Live-Neigungs-Balken anzeigen, bei echtem **Umkippen** (nicht bloßem Abheben) per Toast + Sound warnen, in den Settings einstellbar machen (Schwelle + Null-Kalibrierung) und im Replay als Roll-Spur + Umkipp-Marker zeigen.

**Architecture:** `attitude.js` bekommt statt der (transienten, rate-getriggerten) `wheelLift` einen **`rolloverStep`** (anhaltend großer Winkel + Hysterese, kein Raten-Gate, Sofort-Trigger). `rasicross.js` parst `roll` (Roll-Rate), fusioniert via `RasiAttitude.rollStep` zu `state.attitude.rollDeg` (minus `rollZero`-Offset) und detektiert Umkippen via `rolloverStep`; ein Onset feuert `rcToast` + `rcAudio.rollover`. Ein neuer Neigungs-Balken (±90°, grün→amber→rot) zeigt den Live-Winkel; Replay aggregiert Umkipp-Onsets als Marker-Strip.

**Tech Stack:** Vanilla-JS-UMD (`attitude.js` + `node:test`), Electron-Dashboard (DOM/CSS), keine neuen Abhängigkeiten, keine Firmware (19a lieferte `roll`).

**Spec:** `docs/superpowers/specs/2026-05-30-drift-rollover-detection-design.md` §5.6/§5.7 (R5–R8), **mit Nutzer-Anpassung:** Warnung nur bei Umkippen (Abheben ist normal); Schwelle ~75°, Sofort-Meldung (kein Dwell), beides Setting-einstellbar.

---

## Working Directory & Conventions

- Repo-Root: `C:/Users/jimlu/Documents/RasiCross-Telemetrie-git`. Git als `git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" …`.
- **CRLF-Repo:** vor jedem Edit frisch lesen, auf Text ankern (Zeilennummern indikativ). Verifikation mit dem **Grep-Tool**.
- `attitude.js` ist **ES5** (`var`, keine Arrow/let/const/`??`). `rasicross.js` nutzt `let`/`const`. DOM/CSS folgen den bestehenden Pit-Wall-Mustern.
- DOM/Wiring ist **nicht** unit-getestet → `node --check` + Grep + manueller Smoke (Checkliste). Nur `attitude.js` ist unit-getestet.
- Pro Task ein Commit; nur genannte Dateien adden (nie `git add .`/`.claude/`/Docs außer finalem Plan-Commit). Trailer `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- Verifikation: `node --test` (auto-discovers `test/`), `node --check`, `npm run lint`. Python wird nicht angefasst. `__pycache__` vor `git status` löschen.
- **Baselines (frisch):** `node --test` = **82**. `package.json.version` = 9.6.0 (kein Bump). Keine neue `.js`-Datei → keine `package.json`/`eslint.config.js`-Änderung.

## Locked decisions

- **Warnung nur bei Umkippen**, nicht bei Abheben. `attitude.js`: `wheelLift` (rate-getriggert) **entfernen** → `rolloverStep(st, rollDeg, thr)` (Enter `|roll|>=angleDeg`, Stay bis `<angleDeg-hystDeg`, kein Raten-Gate, kein Dwell).
- Default-Schwelle **75°** (`ROLLOVER_DEFAULTS.angleDeg`), Hysterese **5°**; Schwelle in Settings einstellbar (`state.settings.rollover.angleDeg`). Sofort-Trigger (Onset im Moment des Überschreitens).
- Rollwinkel = `RasiAttitude.rollStep(prevRollDeg, rollRate=d.roll, gy, gz, dt, 0.98)` minus `state.calibration.rollZero`. `gy` = kalibrierte Querbeschleunigung (`driftInputs(...).latAccel`), `gz` = `Number(d.gz)||0`.
- Live: Neigungs-Balken (±90°), grün/amber/rot, Umkipp-Zone rot ab Schwelle; Wert in Grad. Warnung: `rcToast('⚠ Mäher umgekippt!', …)` + neuer `rcAudio.rollover()`.
- Replay: Roll wird über `processTelemetry` beim Abspielen mitfusioniert; zusätzlich Aggregat beim Laden → Umkipp-Onset-Marker-Strip (analog `renderDriftStrip`).
- `state.imu.yaw`-Stil: `state.attitude` in REPLAY_KEYS + Reset-Pfaden mitführen; `rollZero` in `calibration` (persistiert).

## File Structure

| Action | Path | Responsibility |
|--------|------|----------------|
| Modify | `attitude.js` | `wheelLift` → `rolloverStep`; `ROLLOVER_DEFAULTS`; Export. `rollStep` unverändert. |
| Modify | `test/attitude.test.js` | `wheelLift`-Fälle → `rolloverStep`-Fälle; Export-Test. `rollStep`-Fälle unverändert. |
| Modify | `rasicross.js` | `state.attitude` + `settings.rollover` + `calibration.rollZero`; `roll`-Parse + `rollStep`/`rolloverStep` + Toast/Sound; `rcAudio.rollover`; `renderRollBar`; Settings populate/apply + „Roll nullen"; Replay-Aggregat + `renderRollStrip`; Reset + REPLAY_KEYS. |
| Modify | `RasiCross_Telemetry.html` | Neigungs-Balken im G-Modul; Settings-Feld (Umkipp-Schwelle) + „Roll nullen"-Button; `rpRollStrip` im Replay-Seek; CSS. |

**Task-Reihenfolge:** 1 (`attitude.js` rolloverStep, TDD) → 2 (rasicross Kern: state+fusion+detect+toast) → 3 (Live-Balken HTML/CSS/render) → 4 (Settings + Null-Kalibrierung) → 5 (Replay-Strip) → 6 (Verifikation + Plan-Doc-Commit).

---

## Task 1: `attitude.js` — `wheelLift` → `rolloverStep` (TDD)

**Files:** Modify `attitude.js`, `test/attitude.test.js`.

- [ ] **Step 1: Update tests** in `test/attitude.test.js`.
(a) Export test — OLD:
```js
test('module exports rollStep + wheelLift', () => {
  assert.equal(typeof att.rollStep, 'function');
  assert.equal(typeof att.wheelLift, 'function');
});
```
NEW:
```js
test('module exports rollStep + rolloverStep', () => {
  assert.equal(typeof att.rollStep, 'function');
  assert.equal(typeof att.rolloverStep, 'function');
});
```
(b) Replace the three `wheelLift` tests AND the junk test's wheelLift line. OLD (the 3 wheelLift tests):
```js
test('wheelLift: onset when angle AND rate exceed', () => {
  const thr = { angleDeg: 12, rateDps: 60, hystDeg: 3 };
  const r = att.wheelLift({ active: false }, 15, 80, thr);
  assert.equal(r.active, true);
  assert.equal(r.onset, true);
});

test('wheelLift: no onset when only one threshold exceeds', () => {
  const thr = { angleDeg: 12, rateDps: 60, hystDeg: 3 };
  assert.equal(att.wheelLift({ active: false }, 15, 50, thr).active, false);
  assert.equal(att.wheelLift({ active: false }, 10, 80, thr).active, false);
});

test('wheelLift: hysteresis holds active until below angle-hyst', () => {
  const thr = { angleDeg: 12, rateDps: 60, hystDeg: 3 };
  assert.equal(att.wheelLift({ active: true }, 9, 5, thr).active, true);   // 9 == angle-hyst -> stays (spec: ends only when <)
  assert.equal(att.wheelLift({ active: true }, 10, 5, thr).active, true);  // 10 > 9
  assert.equal(att.wheelLift({ active: true }, 8, 5, thr).active, false);  // 8 < 9
  assert.equal(att.wheelLift({ active: true }, 15, 80, thr).onset, false); // continuing
});
```
NEW:
```js
test('rolloverStep: onset at/above the angle threshold (no rate gate)', () => {
  const thr = { angleDeg: 75, hystDeg: 5 };
  const r = att.rolloverStep({ active: false }, 80, thr);
  assert.equal(r.active, true);
  assert.equal(r.onset, true);
  // rate is irrelevant — even a quasi-static large angle triggers
  assert.equal(att.rolloverStep({ active: false }, 75, thr).active, true);  // == threshold
});

test('rolloverStep: cornering lean (~45deg) does NOT trigger', () => {
  const thr = { angleDeg: 75, hystDeg: 5 };
  assert.equal(att.rolloverStep({ active: false }, 45, thr).active, false);
  assert.equal(att.rolloverStep({ active: false }, 70, thr).active, false);  // below 75
});

test('rolloverStep: sign-independent (negative roll triggers too)', () => {
  const thr = { angleDeg: 75, hystDeg: 5 };
  assert.equal(att.rolloverStep({ active: false }, -80, thr).active, true);
});

test('rolloverStep: hysteresis holds until below angle-hyst; onset only on transition', () => {
  const thr = { angleDeg: 75, hystDeg: 5 };  // clear below 70
  assert.equal(att.rolloverStep({ active: true }, 72, thr).active, true);   // 72 >= 70 stays
  assert.equal(att.rolloverStep({ active: true }, 70, thr).active, true);   // 70 == 70 stays
  assert.equal(att.rolloverStep({ active: true }, 69, thr).active, false);  // 69 < 70 clears
  assert.equal(att.rolloverStep({ active: true }, 80, thr).onset, false);   // continuing, not onset
});
```
(c) Junk test — OLD:
```js
test('attitude: junk inputs never throw', () => {
  assert.doesNotThrow(() => att.rollStep(NaN, NaN, NaN, NaN, NaN, NaN));
  assert.doesNotThrow(() => att.wheelLift(null, NaN, NaN, null));
});
```
NEW:
```js
test('attitude: junk inputs never throw', () => {
  assert.doesNotThrow(() => att.rollStep(NaN, NaN, NaN, NaN, NaN, NaN));
  assert.doesNotThrow(() => att.rolloverStep(null, NaN, null));
});
```
(Leave all `rollStep:` tests unchanged.)

- [ ] **Step 2: Run, confirm RED**
`node --test test/attitude.test.js` → FAIL (`att.rolloverStep is not a function`).

- [ ] **Step 3: `attitude.js` — replace defaults + function + export.**
(a) OLD: `var LIFT_DEFAULTS = { angleDeg: 12, rateDps: 60, hystDeg: 3 };`
NEW: `var ROLLOVER_DEFAULTS = { angleDeg: 75, hystDeg: 5 };`
(b) OLD (the whole `wheelLift` comment block + function):
```js
// Wheel-lift event with hysteresis. Pure: state in, result out.
//   st  : { active }
//   thr : { angleDeg, rateDps, hystDeg }
//   -> { active, onset }
function wheelLift(st, rollDeg, rollRateDps, thr) {
  st = st || {};
  var t = thr || {};
  var angleDeg = t.angleDeg == null ? LIFT_DEFAULTS.angleDeg : t.angleDeg;
  var rateDps  = t.rateDps  == null ? LIFT_DEFAULTS.rateDps  : t.rateDps;
  var hystDeg  = t.hystDeg  == null ? LIFT_DEFAULTS.hystDeg  : t.hystDeg;
  var aRoll = Math.abs(_num(rollDeg));
  var aRate = Math.abs(_num(rollRateDps));
  var wasActive = !!st.active;
  var active = wasActive
    ? aRoll >= (angleDeg - hystDeg)                // stay until strictly below angle-hyst
    : (aRoll > angleDeg && aRate > rateDps);       // enter needs BOTH
  return { active: active, onset: active && !wasActive };
}
```
NEW:
```js
// Rollover (capsize) detector with hysteresis. Pure: state in, result out.
// Fires on a SUSTAINED large roll angle — wheel-lift (small/normal lean) is NOT
// flagged here. No rate gate, no dwell (immediate). A high default threshold
// (75deg, well above cornering lean ~45deg) is the false-alarm guard.
//   st  : { active } ; thr : { angleDeg, hystDeg }  ->  { active, onset }
function rolloverStep(st, rollDeg, thr) {
  st = st || {};
  var t = thr || {};
  var angleDeg = t.angleDeg == null ? ROLLOVER_DEFAULTS.angleDeg : t.angleDeg;
  var hystDeg  = t.hystDeg  == null ? ROLLOVER_DEFAULTS.hystDeg  : t.hystDeg;
  var aRoll = Math.abs(_num(rollDeg));
  var wasActive = !!st.active;
  var active = wasActive ? aRoll >= (angleDeg - hystDeg)   // stay until below angle-hyst
                         : aRoll >= angleDeg;               // enter at/above threshold
  return { active: active, onset: active && !wasActive };
}
```
(c) OLD: `  var api = { rollStep: rollStep, wheelLift: wheelLift };`
NEW: `  var api = { rollStep: rollStep, rolloverStep: rolloverStep };`

- [ ] **Step 4: GREEN + syntax**
`node --test test/attitude.test.js` → PASS (still 9 tests). `node --check attitude.js` → clean.

- [ ] **Step 5: Commit**
```
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" add attitude.js test/attitude.test.js
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" commit -m "feat(attitude): rolloverStep (capsize) replaces transient wheelLift" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: `rasicross.js` — roll fusion + rollover detection + warning

**Files:** Modify `rasicross.js`. DOM/wiring — verify `node --check` + Grep + `node --test` (82 unaffected).

- [ ] **Step 1: `rcAudio.rollover` sound.** In the `rcAudio` return object, after the `battCrit` line.
OLD:
```js
    battCrit:   () => { beep(200, 300, 0.25); setTimeout(() => beep(200, 300, 0.25), 320); },
```
NEW:
```js
    battCrit:   () => { beep(200, 300, 0.25); setTimeout(() => beep(200, 300, 0.25), 320); },
    rollover:   () => { beep(160, 300, 0.3); setTimeout(() => beep(120, 450, 0.3), 300); },
```

- [ ] **Step 2: State — `attitude`, `settings.rollover`, `calibration.rollZero`.**
(a) OLD: `  drift: { status: 'n/a', index: null },`
NEW:
```js
  drift: { status: 'n/a', index: null },
  attitude: { rollDeg: 0, over: false, overState: { active: false } },
```
(b) `settings`: OLD ends `… drift: { tol: 0.25, minSpeedKmh: 5, minLatG: 0.15 } },`
NEW: `… drift: { tol: 0.25, minSpeedKmh: 5, minLatG: 0.15 }, rollover: { angleDeg: 75 } },`
(c) `calibration`: OLD `  calibration: { gxZero: 0, gyZero: 0, swapG: false, invertGx: false, invertGy: false, invertYaw: false },`
NEW: `  calibration: { gxZero: 0, gyZero: 0, swapG: false, invertGx: false, invertGy: false, invertYaw: false, rollZero: 0 },`

- [ ] **Step 3: Module-level fusion clock.** Near `let _kart3dLastTick = 0;`.
OLD: `let _kart3dLastTick = 0;`
NEW:
```js
let _kart3dLastTick = 0;
let _attLastMs = 0;            // wall-clock of last attitude fusion step (ms)
```

- [ ] **Step 4: `processTelemetry` — fuse roll, detect rollover, warn on onset.** Insert directly AFTER the existing drift block (after the line `state.drift = { status: state.driftSmooth.status, index: state.driftSmooth.idxEma };`).
NEW:
```js
    // Rollwinkel (Phase 19b): Roll-Rate (d.roll) + Accel-Schwerkraft-Referenz
    // -> Winkel (Komplementaerfilter), minus Null-Offset. di.latAccel = kalibrierte
    // Querbeschleunigung; gz = Accel-Z.
    const _attNow = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    const _attDt = _attLastMs ? (_attNow - _attLastMs) / 1000 : 0.08;
    _attLastMs = _attNow;
    const _rollRaw = RasiAttitude.rollStep(
      state.attitude.rollDeg + state.calibration.rollZero,  // prev in sensor frame
      Number(d.roll) || 0, di.latAccel, Number(d.gz) || 0, _attDt, 0.98);
    state.attitude.rollDeg = _rollRaw - state.calibration.rollZero;
    state.attitude.overState = RasiAttitude.rolloverStep(
      state.attitude.overState, state.attitude.rollDeg, state.settings.rollover);
    state.attitude.over = state.attitude.overState.active;
    if (state.attitude.overState.onset) {
      rcToast('⚠ Mäher umgekippt!', 4000);
      rcAudio.rollover();
    }
```

- [ ] **Step 5: Reset paths.** In `resetReplayDerived`, after the `state.driftSmooth = …` reset line, add:
```js
  state.attitude = { rollDeg: 0, over: false, overState: { active: false } };
  _attLastMs = 0;
```

- [ ] **Step 6: REPLAY_KEYS.** OLD: `  'batt','max','charts','imu','drift','driftSmooth','heatmap','sectors','lapStart','currentLapMax',`
NEW: `  'batt','max','charts','imu','drift','driftSmooth','attitude','heatmap','sectors','lapStart','currentLapMax',`

- [ ] **Step 7: Verify + commit**
`node --check rasicross.js` → clean. `node --test` → 82. Grep `rasicross.js` for `attitude|rollover|rollZero|_attLastMs|rcAudio.rollover` → confirm state, processTelemetry fusion, reset, REPLAY_KEYS, sound.
```
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" add rasicross.js
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" commit -m "feat(roll): live roll fusion + rollover warning (toast+sound)" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: Live Neigungs-Balken (HTML + CSS + render)

**Files:** Modify `RasiCross_Telemetry.html` (markup + CSS), `rasicross.js` (`renderRollBar` + call).

- [ ] **Step 1: HTML — bar inside the G-module, after the 3D canvas.**
OLD:
```html
        <canvas id="gMeterCanvas"></canvas>
        <canvas id="gMeter3dCanvas" class="hidden"></canvas>
```
NEW:
```html
        <canvas id="gMeterCanvas"></canvas>
        <canvas id="gMeter3dCanvas" class="hidden"></canvas>
        <div class="roll-ind" id="rollInd" title="Rollwinkel (Umkipp-Warnung ab Schwelle)">
          <div class="roll-track"><i class="roll-marker" id="rollMarker"></i></div>
          <div class="roll-scale"><span>-90°</span><span>0°</span><span>+90°</span></div>
          <div class="roll-val"><b id="rollVal">0°</b> <span id="rollOver" class="roll-over hidden">UMGEKIPPT</span></div>
        </div>
```

- [ ] **Step 2: CSS — append near the `#gMeterCanvas` rules.** After the `#gMeter3dCanvas.hidden, #gMeterCanvas.hidden{ display:none; }` line:
```css
.roll-ind{ margin:10px auto 0; max-width:280px; }
.roll-track{ position:relative; height:14px; border-radius:7px;
  background:linear-gradient(90deg,#e05a5a 0%,#e0a13a 22%,#3ddc84 50%,#e0a13a 78%,#e05a5a 100%); }
.roll-marker{ position:absolute; top:-3px; left:50%; width:4px; height:20px;
  margin-left:-2px; border-radius:2px; background:#fff; box-shadow:0 0 4px rgba(0,0,0,.6); transition:left .1s linear; }
.roll-marker.over{ background:#ff2d2d; box-shadow:0 0 8px #ff2d2d; }
.roll-scale{ display:flex; justify-content:space-between; font-size:11px; color:var(--mut); margin-top:2px; }
.roll-val{ text-align:center; font-size:13px; margin-top:2px; }
.roll-over{ color:#ff2d2d; font-weight:700; animation:rollBlink .5s steps(1) infinite; }
.roll-over.hidden{ display:none; }
@keyframes rollBlink{ 50%{ opacity:.2; } }
```

- [ ] **Step 3: `rasicross.js` — `renderRollBar`.** Add next to `renderDriftBadge` (after that function).
```js
// Neigungs-Balken (Phase 19b): Marker-Position aus Rollwinkel (±90° -> 0..100%),
// Umkipp-Zustand faerbt Marker rot + zeigt "UMGEKIPPT".
function renderRollBar() {
  const m = $('rollMarker');
  if (!m) return;
  const deg = Math.max(-90, Math.min(90, (state.attitude && state.attitude.rollDeg) || 0));
  m.style.left = (50 + deg / 90 * 50) + '%';
  const over = !!(state.attitude && state.attitude.over);
  m.classList.toggle('over', over);
  const v = $('rollVal'); if (v) v.textContent = Math.round(deg) + '°';
  const o = $('rollOver'); if (o) o.classList.toggle('hidden', !over);
}
```

- [ ] **Step 4: Call it.** Find where `renderDriftBadge();` is called (in the display-update path) and add `renderRollBar();` right after.
OLD: `    renderDriftBadge();`
NEW:
```js
    renderDriftBadge();
    renderRollBar();
```

- [ ] **Step 5: Verify + commit**
`node --check rasicross.js` → clean. `node --test` → 82. Grep for `renderRollBar`, `rollMarker`, `roll-ind` (HTML+JS).
```
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" add rasicross.js RasiCross_Telemetry.html
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" commit -m "feat(roll): live tilt indicator bar" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: Settings — Umkipp-Schwelle + „Roll nullen"

**Files:** Modify `RasiCross_Telemetry.html`, `rasicross.js`.

- [ ] **Step 1: HTML — threshold field** (after the Drift Min-Tempo field).
OLD:
```html
        <div class="field"><label>Drift Min-Tempo (km/h)</label><input type="number" id="setDriftMinSpeed" value="5" min="1" max="60" step="1"></div>
```
NEW:
```html
        <div class="field"><label>Drift Min-Tempo (km/h)</label><input type="number" id="setDriftMinSpeed" value="5" min="1" max="60" step="1"></div>
        <div class="field"><label>Umkipp-Schwelle (Grad)</label><input type="number" id="setRolloverAngle" value="75" min="30" max="90" step="1"></div>
```

- [ ] **Step 2: HTML — „Roll nullen" button** next to the IMU zero button.
OLD:
```html
        <button class="btn primary" id="zeroImuBtn" style="flex:1">Nullpunkt setzen</button>
        <button class="btn ghost" id="resetImuBtn" style="flex:0 0 auto">Zurücksetzen</button>
```
NEW:
```html
        <button class="btn primary" id="zeroImuBtn" style="flex:1">Nullpunkt setzen</button>
        <button class="btn ghost" id="resetImuBtn" style="flex:0 0 auto">Zurücksetzen</button>
        <button class="btn ghost" id="zeroRollBtn" style="flex:0 0 auto" title="Aktuellen Rollwinkel als 0 setzen">Roll nullen</button>
```

- [ ] **Step 3: populate** (`loadSettingsToUi`), after the `setDriftMinSpeed` populate line.
OLD: `  if ($('setDriftMinSpeed')) $('setDriftMinSpeed').value = state.settings.drift.minSpeedKmh;`
NEW:
```js
  if ($('setDriftMinSpeed')) $('setDriftMinSpeed').value = state.settings.drift.minSpeedKmh;
  if ($('setRolloverAngle')) $('setRolloverAngle').value = (state.settings.rollover && state.settings.rollover.angleDeg) || 75;
```

- [ ] **Step 4: apply** (`saveSettingsFromUi`), after the `drift.minSpeedKmh` apply line.
OLD: `  state.settings.drift.minSpeedKmh = Math.max(1, Math.min(60, Number($('setDriftMinSpeed')?.value) || 5));`
NEW:
```js
  state.settings.drift.minSpeedKmh = Math.max(1, Math.min(60, Number($('setDriftMinSpeed')?.value) || 5));
  if (!state.settings.rollover) state.settings.rollover = { angleDeg: 75 };
  state.settings.rollover.angleDeg = Math.max(30, Math.min(90, Number($('setRolloverAngle')?.value) || 75));
```

- [ ] **Step 5: „Roll nullen" handler.** Near the `zeroImuBtn` handler binding.
OLD: `  $('zeroImuBtn').onclick = () => {`
NEW (insert the new binding BEFORE it):
```js
  if ($('zeroRollBtn')) $('zeroRollBtn').onclick = () => {
    // Aktuellen fusionierten Rollwinkel (inkl. bestehendem Offset) als neue 0 setzen.
    state.calibration.rollZero = state.calibration.rollZero + ((state.attitude && state.attitude.rollDeg) || 0);
    state.attitude.rollDeg = 0;
    state.attitude.overState = { active: false };
    state.attitude.over = false;
    saveData();
    rcToast('Rollwinkel genullt', 1500);
  };
  $('zeroImuBtn').onclick = () => {
```

- [ ] **Step 6: Verify + commit**
`node --check rasicross.js` → clean. `node --test` → 82. Grep `setRolloverAngle`, `zeroRollBtn`, `rollZero`.
```
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" add rasicross.js RasiCross_Telemetry.html
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" commit -m "feat(roll): rollover threshold setting + roll-zero calibration" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: Replay — Roll-Fusion-Aggregat + Umkipp-Marker-Strip

**Files:** Modify `RasiCross_Telemetry.html` (strip span + CSS), `rasicross.js` (aggregate + `renderRollStrip`).

> Beim Abspielen läuft die Live-Fusion über `processTelemetry` bereits mit (Balken/Warnung). Hier zusätzlich: beim **Laden** die Umkipp-**Onsets** über die Aufnahme ermitteln und als Marker auf der Seek-Leiste zeigen (analog Drift-Strip).

- [ ] **Step 1: HTML — strip span** in the replay seek wrap (next to `rpDriftStrip`).
OLD:
```html
  <span class="rp-seek-wrap"><span id="rpDriftStrip" class="rp-drift-strip"></span><input type="range" id="rpSeek" class="rp-seek" min="0" max="1000" value="0"></span>
```
NEW:
```html
  <span class="rp-seek-wrap"><span id="rpDriftStrip" class="rp-drift-strip"></span><span id="rpRollStrip" class="rp-roll-strip"></span><input type="range" id="rpSeek" class="rp-seek" min="0" max="1000" value="0"></span>
```

- [ ] **Step 2: CSS** — append after the existing `.rp-drift-strip` rule (find it; it styles the strip + its `i` ticks). Add:
```css
.rp-roll-strip{ position:absolute; left:0; right:0; top:0; bottom:0; pointer-events:none; }
.rp-roll-strip i{ position:absolute; top:0; bottom:0; width:3px; margin-left:-1.5px; background:#ff2d2d; box-shadow:0 0 4px #ff2d2d; }
```
(If `.rp-drift-strip` uses a specific positioning context, mirror it; the strip must overlay the seek bar like `rpDriftStrip`.)

- [ ] **Step 3: `rasicross.js` — `renderRollStrip` (point markers).** After `renderDriftStrip`.
```js
// Umkipp-Onset-Marker über dem Replay-Seek (Phase 19b). onsets = [ms, …].
function renderRollStrip(onsets, durationMs) {
  const strip = $('rpRollStrip');
  if (!strip) return;
  strip.innerHTML = '';
  const dur = Number(durationMs) || 0;
  if (!dur || !onsets || !onsets.length) return;
  for (const t of onsets) {
    const p = Math.max(0, Math.min(100, t / dur * 100));
    const tick = document.createElement('i');
    tick.style.left = p + '%';
    strip.appendChild(tick);
  }
}
// Umkipp-Onsets über eine Aufnahme: Roll fusionieren + rolloverStep, Onset-ms sammeln.
function rolloverOnsets(packets, cal, thr) {
  const out = [];
  let roll = 0, st = { active: false }, lastT = null;
  for (const p of (packets || [])) {
    const t = Number(p.t_rel) || 0;
    const dt = lastT == null ? 0.08 : Math.max(0, (t - lastT) / 1000);
    lastT = t;
    roll = RasiAttitude.rollStep(roll, Number(p.roll) || 0,
      (Number(p.gy) || 0) - (cal.gyZero || 0), Number(p.gz) || 0, dt, 0.98) ;
    const r = RasiAttitude.rolloverStep(st, roll - (cal.rollZero || 0), thr);
    if (r.onset) out.push(t);
    st = r;
  }
  return out;
}
```
(Note: replay aggregate uses the recorded raw `p.gy` minus `gyZero`; swap/invert are not applied here to keep parity with how `roll` fusion treats lateral — acceptable for a coarse marker. If exact live parity is wanted later, route through `driftInputs`.)

- [ ] **Step 4: Wire into `enterReplay`.** After the existing `renderDriftStrip(…)` line.
OLD: `  renderDriftStrip(RasiDrift.driftSpans(_calPk, state.settings.drift), parsed.durationMs);`
NEW:
```js
  renderDriftStrip(RasiDrift.driftSpans(_calPk, state.settings.drift), parsed.durationMs);
  renderRollStrip(rolloverOnsets(parsed.packets, state.calibration, state.settings.rollover), parsed.durationMs);
```

- [ ] **Step 5: Verify + commit**
`node --check rasicross.js` → clean. `node --test` → 82. Grep `renderRollStrip`, `rolloverOnsets`, `rpRollStrip`.
```
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" add rasicross.js RasiCross_Telemetry.html
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" commit -m "feat(roll): replay rollover-onset markers on the seek bar" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 6: Full verification + plan-doc commit

- [ ] **Step 1:** `node --check geo.js replay.js drift.js attitude.js karts3d.js rasicross.js main.js preload.js` → all clean.
- [ ] **Step 2:** `node --test` → **82** pass, 0 fail (attitude count unchanged; rolloverStep replaced wheelLift 1:1 plus the extra rollover cases — confirm exact count, expect ~83; if the suite total differs, report the new number).
- [ ] **Step 3:** `npm run lint` → clean. (Note: `rasicross.js` now references `RasiAttitude` — if ESLint flags it as undef, add `RasiAttitude: 'readonly'` to the `rasicross.js` globals block in `eslint.config.js` and re-run; commit that fix with this task.)
- [ ] **Step 4:** `python -m unittest discover -s test -p "test_*.py"` → 38 OK (unchanged); delete `__pycache__`.
- [ ] **Step 5:** `git status --short` → expected files only + untracked this plan.
- [ ] **Step 6: Plan-doc commit**
```
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" add "docs/superpowers/plans/2026-05-31-19b-roll-dashboard.md"
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" commit -m "docs: phase 19b roll-dashboard implementation plan" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

> **eslint note:** `RasiAttitude` must be a declared global for `rasicross.js`. Add it to the `rasicross.js` globals in `eslint.config.js` (next to `RasiDrift: 'readonly'`) as part of Task 2 or Task 6 — whichever first trips lint. The verification step will catch it.

---

## Hardware / Manual Acceptance Checklist (Nutzer)

**Dashboard-Smoke (Demo/Replay, ohne Flash):**
1. Neigungs-Balken bewegt sich mit `roll`; bei 0 mittig; Wert in Grad plausibel.
2. „Roll nullen" im Stand → Balken/Wert auf 0; übersteht Neustart (persistiert).
3. Replay einer Aufnahme mit großem Roll → rote Marker auf der Seek-Leiste an den Umkipp-Onsets.

**Auf der Strecke (nach 19a-Flash beider ESPs):**
4. Normale harte Kurve / kurzes Abheben → **keine** Umkipp-Warnung (Balken amber, kein Toast).
5. Mäher tatsächlich auf die Seite legen (kontrolliert) → Balken rot ab ~75°, Toast „⚠ Mäher umgekippt!" + Sound feuern **sofort**.
6. Falls harte Kurven/Sprünge **doch** fälschlich auslösen: Umkipp-Schwelle in den Settings erhöhen (bis 90°). (Sofort-Trigger ohne Dwell ist gewählt — die Schwelle ist die Fehlalarm-Stellschraube.)

## Self-Review (Plan ↔ Spec + Nutzer-Anpassung)

- **Coverage:** R5 (parse roll + `state.attitude` Fusion) → T2; R6 (Live-Anzeige + Warnung) → T2/T3; R7 (Replay) → T5; R8 (Settings: Schwelle + Null-Kal.) → T4. `attitude.js` Umkipp-Semantik → T1.
- **Nutzer-Anpassung umgesetzt:** Warnung nur bei Umkippen (kein Lift-Alarm); Schwelle 75° einstellbar; Sofort (kein Dwell). Dokumentiert in Checkliste (Schwelle = Fehlalarm-Stellschraube).
- **Placeholder-Scan:** kein TBD/TODO; jeder Code-Step vollständig (inkl. Balken-CSS/render).
- **Konsistenz:** `rolloverStep`/`ROLLOVER_DEFAULTS`, `state.attitude.{rollDeg,over,overState}`, `settings.rollover.angleDeg`, `calibration.rollZero`, DOM-ids (`rollMarker`/`rollVal`/`rollOver`/`setRolloverAngle`/`zeroRollBtn`/`rpRollStrip`), `rcAudio.rollover` — je einmal benannt, verbatim wiederverwendet. `RasiAttitude` eslint-Global ergänzen.
- **CRLF/Hygiene:** Edits auf frische Anker; Grep-Verifikation; `__pycache__` vor `git status`; nur genannte Dateien adden.

## Phase Map

| Phase | Scope | Status |
|-------|-------|--------|
| 18 / 20 / 19a | Drift + Härtung + Roll-Firmware/`attitude.js` | fertig |
| **19b** (dieser Plan) | Rollwinkel-Dashboard + Umkipp-Warnung (R5–R8, Umkipp-Semantik) | dieser Plan |
| (offen) | Gyro-Y/Pitch, Schwimmwinkel β — spätere Phasen | backlog |
