# Drift-System-Überarbeitung (Phase 20) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Den bestehenden Gierraten-Index-Drift (Phase 18) härten und stabilisieren — mounting-sicherer `invertYaw`-Vorzeichen-Fix, EMA-Glättung + Status-Hysterese + Counter-Entprellung über einen puren Reducer, geschärfter 3D-Pfeil und klarere Badge — alles rein im Dashboard.

**Architecture:** Neue pure Funktion `smoothStep(state, raw, opts)` in `drift.js` (State explizit durchgereicht, `analyze` unverändert). `rasicross.js` normalisiert Drift-Eingänge über einen gemeinsamen `driftInputs`-Helper (Live **und** Replay-Aggregat), hält `state.driftSmooth` und speist Badge + 3D-Pfeil mit dem geglätteten `state.drift`. `karts3d.js` macht den Drift-Pfeil zum Abweichung-vom-Grip-Indikator.

**Tech Stack:** Vanilla JS (ES5-UMD-Module + `node:test`), Electron-Dashboard, kein neues npm-Paket, keine Firmware.

**Spec:** `docs/superpowers/specs/2026-05-31-drift-system-rework-design.md`

---

## Working Directory & Conventions

- Repo-Root: `C:/Users/jimlu/Documents/RasiCross-Telemetrie-git`. Git immer als `git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" …`.
- **CRLF-Repo:** Vor **jedem** Edit die Zielregion frisch lesen (Read) und den Anker aus diesem frischen Read kopieren. Zeilennummern hier sind **indikativ** — auf Text ankern. Zur Verifikation das **Grep-Tool** nutzen (nicht Shell-`grep`).
- `drift.js` ist **ES5** (`var`, keine Arrow-Funktionen, kein `??`/optional chaining) — neuer Code dort im selben Stil. `rasicross.js` nutzt `let`/`const`.
- Pro Task ein Commit; nur die im Task genannten Dateien adden (nie `git add .`, nie `.claude/` oder Plan-/Spec-Docs außer im finalen Plan-Doc-Commit). Trailer: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- Verifikations-Rezept: `node --check` (geänderte + Kern-`.js`), `node --test` (kein Pfad, auto-discovers `test/`), `npm run lint`, `python -m unittest discover -s test -p "test_*.py"`. `__pycache__` vor jedem `git status` löschen. Python evtl. `py -3`.
- **Baseline vor Start (frisch ermittelt):** `node --test` = **66 grün**. Python wird nicht angefasst (bleibt grün). `package.json.version` = 9.6.0 (kein Bump in diesem Durchgang).

## Locked decisions

- Methode bleibt Gierraten-Index; **kein** GPS-β, kein Methodenwechsel.
- Vorzeichen-Fix über neuen Kalibrierschalter `invertYaw` (gepaart mit `swapG`/`invertGx`/`invertGy`).
- Glättung als purer Reducer in `drift.js`; `analyze`/`expectedYawRate`/`summarize`/`driftSpans` **unverändert**.
- `tol`/`minSpeedKmh`/`minLatG` bleiben einstellbar; `smooth=0.6`/`hyst=0.15`/`counterHold=3` sind feste Defaults (keine neue UI).
- Badge-Wert = geglätteter Index. 3D-Pfeil: Länge ∝ `|index−1|`, sichtbar **nur** bei `oversteer` & `counter` (`grip`/`understeer`/`n/a` unsichtbar).
- Replay-Anzeige unverändert, bekommt aber die gemeinsame Eingangs-Normalisierung (behebt fehlendes `swapG`/`invertGy` + neues `invertYaw`).
- **Keine** neue `.js`-Datei ⇒ `package.json`/`eslint.config.js` unverändert.

## File Structure

| Action | Path | Responsibility |
|--------|------|----------------|
| Modify | `drift.js` | `SMOOTH_DEFAULTS`, `smoothInit`, pure `smoothStep`; Export erweitern. `analyze` & Co. unverändert. |
| Modify | `test/drift.test.js` | 6 neue `smoothStep`-Fälle. |
| Modify | `karts3d.js` | `driftArrowSpec`: Länge ∝ `|index−1|`, sichtbar nur oversteer/counter. |
| Modify | `test/karts3d.test.js` | 3 `driftArrowSpec`-Fälle an neue Semantik anpassen. |
| Modify | `rasicross.js` | `invertYaw` in `calibration`; `driftInputs`-Helper; `state.driftSmooth` + Reset + `REPLAY_KEYS`; `processTelemetry`-Pipe; Replay-Aggregat-Map; Badge-Glyph; Settings populate/apply. |
| Modify | `RasiCross_Telemetry.html` | Toggle-Row `setInvertYaw`. |

**Task-Reihenfolge:** 1 (drift.js, TDD) → 2 (karts3d.js, TDD) → 3 (rasicross core) → 4 (invertYaw-UI) → 5 (Replay-Aggregat) → 6 (Badge-Glyph) → 7 (Gesamt-Verifikation + Plan-Doc-Commit). 1 & 2 sind unit-getestet; 3–6 sind DOM/Wiring (verifiziert per `node --check` + Grep + manueller Smoke).

---

## Task 1: `smoothStep`-Reducer in `drift.js` (TDD)

**Files:**
- Modify: `drift.js` (DEFAULTS-Bereich ~`:12`, vor dem Export ~`:89`, api-Objekt ~`:93`)
- Test: `test/drift.test.js`

- [ ] **Step 1: Failing Tests schreiben** — ans Ende von `test/drift.test.js` anhängen (nach dem `driftSpans`-Test, letzte Zeile ~`:78`):

```js

test('smoothInit: sauberer Reset-Shape', () => {
  assert.deepEqual(drift.smoothInit(), { idxEma: null, status: 'n/a', counterRun: 0 });
});

test('smoothStep: n/a / null / NaN raw -> Reset auf n/a', () => {
  const st = { idxEma: 1.4, status: 'oversteer', counterRun: 2 };
  assert.deepEqual(drift.smoothStep(st, { status: 'n/a', index: null }),
                   { idxEma: null, status: 'n/a', counterRun: 0 });
  assert.equal(drift.smoothStep(st, { status: 'grip', index: NaN }).status, 'n/a');
});

test('smoothStep: EMA seedet beim ersten Sample, dann Mischung mit smooth-Gewicht', () => {
  const s1 = drift.smoothStep(drift.smoothInit(), { status: 'oversteer', index: 1.5 }, { smooth: 0.6 });
  approx(s1.idxEma, 1.5, 1e-9);                 // erster gueltiger Sample seedet exakt
  const s2 = drift.smoothStep(s1, { status: 'oversteer', index: 2.0 }, { smooth: 0.6 });
  approx(s2.idxEma, 1.7, 1e-9);                 // 0.6*1.5 + 0.4*2.0 = 1.7
});

test('smoothStep: Hysterese haelt oversteer bis Index unter 1+tol-hyst faellt', () => {
  const opts = { smooth: 0, tol: 0.25, hyst: 0.15 };   // smooth 0 -> idxEma = raw index
  let s = drift.smoothStep(drift.smoothInit(), { status: 'oversteer', index: 1.4 }, opts);
  assert.equal(s.status, 'oversteer');                 // rein (>1.25)
  s = drift.smoothStep(s, { status: 'grip', index: 1.15 }, opts);
  assert.equal(s.status, 'oversteer');                 // Dip auf 1.15 (>1.10) haelt
  s = drift.smoothStep(s, { status: 'grip', index: 1.05 }, opts);
  assert.equal(s.status, 'grip');                      // <1.10 -> grip
});

test('smoothStep: counter braucht counterHold Samples (Entprellung), dann loest es', () => {
  const opts = { smooth: 0, counterHold: 3 };
  let s = drift.smoothInit();
  s = drift.smoothStep(s, { status: 'counter', index: 1.5 }, opts);
  assert.notEqual(s.status, 'counter');                // 1. Sample: noch nicht
  s = drift.smoothStep(s, { status: 'counter', index: 1.5 }, opts);
  assert.notEqual(s.status, 'counter');                // 2. Sample: noch nicht
  s = drift.smoothStep(s, { status: 'counter', index: 1.5 }, opts);
  assert.equal(s.status, 'counter');                   // 3. Sample: rastet ein
  s = drift.smoothStep(s, { status: 'oversteer', index: 1.5 }, opts);
  assert.equal(s.status, 'counter');                   // Run 3->2, bleibt aktiv
  s = drift.smoothStep(s, { status: 'oversteer', index: 1.5 }, opts);
  s = drift.smoothStep(s, { status: 'oversteer', index: 1.5 }, opts);
  assert.notEqual(s.status, 'counter');                // Run auf 0 -> loest
});

test('smoothStep: Junk-Eingaben werfen nie', () => {
  assert.doesNotThrow(() => drift.smoothStep(null, null));
  assert.equal(drift.smoothStep(undefined, { status: 'grip', index: 'x' }).status, 'n/a');
});
```

- [ ] **Step 2: Test ausführen, Rotphase prüfen**

Run: `node --test test/drift.test.js`
Expected: FAIL — `drift.smoothInit is not a function` / `drift.smoothStep is not a function`.

- [ ] **Step 3: `SMOOTH_DEFAULTS` ergänzen** — in `drift.js` direkt nach der `DEFAULTS`-Zeile.

Anker (OLD):
```js
var DEFAULTS = { tol: 0.25, minSpeedKmh: 5, minLatG: 0.15 };
```
NEW:
```js
var DEFAULTS = { tol: 0.25, minSpeedKmh: 5, minLatG: 0.15 };
var SMOOTH_DEFAULTS = { smooth: 0.6, hyst: 0.15, counterHold: 3 };
```

- [ ] **Step 4: `smoothInit` + `smoothStep` implementieren** — in `drift.js` direkt **vor** dem UMD-Export-Block (vor `// ── UMD-style export`).

```js
// Default-Glaettungs-State.
function smoothInit() { return { idxEma: null, status: 'n/a', counterRun: 0 }; }

// Purer Reducer: vorheriger Glaettungs-State + rohes analyze()-Ergebnis -> neuer
// State. Ausgabe fuer die UI: state.status (entprellt/hysterese) + state.idxEma
// (EMA-geglaetteter Index). Wirft nie.
function smoothStep(st, raw, opts) {
  st = st || smoothInit();
  raw = raw || {};
  var o = opts || {};
  var a    = o.smooth      == null ? SMOOTH_DEFAULTS.smooth      : o.smooth;
  var hyst = o.hyst        == null ? SMOOTH_DEFAULTS.hyst        : o.hyst;
  var hold = o.counterHold == null ? SMOOTH_DEFAULTS.counterHold : o.counterHold;
  var tol  = o.tol         == null ? DEFAULTS.tol                : o.tol;

  // Gerade/langsam: Drift-Status sinnlos -> Reset.
  if (raw.status === 'n/a' || raw.index == null || !isFinite(Number(raw.index))) {
    return { idxEma: null, status: 'n/a', counterRun: 0 };
  }

  var rawIdx = Number(raw.index);
  var idxEma = st.idxEma == null ? rawIdx : a * st.idxEma + (1 - a) * rawIdx;

  // Counter-Entprellung: Run hoch bei 'counter', runter sonst (geklemmt 0..hold).
  var run = st.counterRun + (raw.status === 'counter' ? 1 : -1);
  if (run < 0) run = 0;
  if (run > hold) run = hold;
  var counterActive = st.status === 'counter' ? run > 0 : run >= hold;

  var status;
  if (counterActive) {
    status = 'counter';
  } else if (st.status === 'oversteer') {
    status = idxEma > 1 + tol - hyst ? 'oversteer' : (idxEma < 1 - tol ? 'understeer' : 'grip');
  } else if (st.status === 'understeer') {
    status = idxEma < 1 - tol + hyst ? 'understeer' : (idxEma > 1 + tol ? 'oversteer' : 'grip');
  } else { // grip / counter-Ausstieg / n/a -> frische Klassifikation
    status = idxEma > 1 + tol ? 'oversteer' : (idxEma < 1 - tol ? 'understeer' : 'grip');
  }
  return { idxEma: idxEma, status: status, counterRun: run };
}
```

- [ ] **Step 5: Export erweitern** — im UMD-`api`-Objekt.

Anker (OLD):
```js
  var api = { expectedYawRate: expectedYawRate, analyze: analyze,
              summarize: summarize, driftSpans: driftSpans };
```
NEW:
```js
  var api = { expectedYawRate: expectedYawRate, analyze: analyze,
              summarize: summarize, driftSpans: driftSpans,
              smoothInit: smoothInit, smoothStep: smoothStep };
```

- [ ] **Step 6: Tests grün + Syntax-Check**

Run: `node --test test/drift.test.js`
Expected: PASS (bestehende 9 + 6 neue = 15).
Run: `node --check drift.js`
Expected: keine Ausgabe (ok).

- [ ] **Step 7: Commit**

```bash
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" add drift.js test/drift.test.js
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" commit -m "feat(drift): pure smoothStep reducer (EMA + hysteresis + counter debounce)" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: `driftArrowSpec` schärfen in `karts3d.js` (TDD)

Neue Semantik: Länge ∝ Abweichung vom Grip (`|index−1|`, geklemmt auf `SEV_MAX=1.0`), sichtbar **nur** bei `oversteer` & `counter`. `grip`/`understeer`/`n/a` → unsichtbar.

**Files:**
- Modify: `karts3d.js` (`driftArrowSpec` ~`:95‑113`)
- Test: `test/karts3d.test.js` (~`:113‑132`)

- [ ] **Step 1: Bestehende Tests an neue Semantik anpassen** — in `test/karts3d.test.js` die drei Tests „grip sichtbar…", „oversteer laenger als understeer…" und „index ueber 2…" **ersetzen**.

Anker (OLD — exakt diese drei `test(...)`-Blöcke):
```js
test('driftArrowSpec: grip sichtbar, gruene Farbe, positive Laenge', () => {
  const s = K.driftArrowSpec('grip', 1, 5);
  assert.equal(s.visible, true);
  assert.equal(s.color, 0x3ee08a);
  assert.ok(s.length > 0);
});

test('driftArrowSpec: oversteer laenger als understeer; Farben je Status', () => {
  const over = K.driftArrowSpec('oversteer', 1.6, 5);
  const under = K.driftArrowSpec('understeer', 0.5, 5);
  assert.ok(over.length > under.length, `${over.length} !> ${under.length}`);
  assert.equal(over.color, 0xffa336);
  assert.equal(under.color, 0x7aa2f7);
});

test('driftArrowSpec: index ueber 2 wird auf maxLen geclamped', () => {
  const at2 = K.driftArrowSpec('oversteer', 2, 5).length;
  const above = K.driftArrowSpec('oversteer', 10, 5).length;
  assert.equal(at2, above);
});
```
NEW:
```js
test('driftArrowSpec: grip & understeer -> unsichtbar (kein Rotations-Ueberschuss)', () => {
  assert.equal(K.driftArrowSpec('grip', 1, 5).visible, false);
  assert.equal(K.driftArrowSpec('grip', 1.05, 5).visible, false);
  assert.equal(K.driftArrowSpec('understeer', 0.5, 5).visible, false);
});

test('driftArrowSpec: oversteer sichtbar, Laenge ~ |index-1|, amber', () => {
  const small = K.driftArrowSpec('oversteer', 1.3, 5);
  const big   = K.driftArrowSpec('oversteer', 1.8, 5);
  assert.equal(small.visible, true);
  assert.equal(small.color, 0xffa336);
  assert.ok(big.length > small.length, `${big.length} !> ${small.length}`);
});

test('driftArrowSpec: severity auf SEV_MAX (index 2) geclamped', () => {
  const at2   = K.driftArrowSpec('oversteer', 2, 5).length;   // |2-1| = 1 = SEV_MAX
  const above = K.driftArrowSpec('oversteer', 10, 5).length;  // auf SEV_MAX geklemmt
  assert.equal(at2, above);
});
```
(Die Tests „n/a / fehlend / null / NaN -> unsichtbar" und „dirSign folgt dem Vorzeichen der Gierrate" bleiben unverändert.)

- [ ] **Step 2: Test ausführen, Rotphase prüfen**

Run: `node --test test/karts3d.test.js`
Expected: FAIL — „grip & understeer -> unsichtbar" schlägt fehl (alte Impl zeigt grip/understeer sichtbar).

- [ ] **Step 3: `driftArrowSpec` neu implementieren**

Anker (OLD — komplette Funktion):
```js
function driftArrowSpec(status, index, yawRate, opts) {
  opts = opts || {};
  var maxLen = Number(opts.maxLen) || 1.6;
  var minLen = Number(opts.minLen) || 0.06;
  var color = DRIFT_3D_COLOR[status];
  var idx = Number(index);
  if (color == null || index == null || !isFinite(idx)) {
    return { visible: false, length: 0, dirSign: 0, color: 0xffffff };
  }
  var clamped = Math.max(0, Math.min(2, idx));
  var length = clamped / 2 * maxLen;
  var dirSign = (Number(yawRate) || 0) >= 0 ? 1 : -1;
  return {
    visible: length > 0.05,
    length: Math.max(length, minLen),
    dirSign: dirSign,
    color: color
  };
}
```
NEW:
```js
function driftArrowSpec(status, index, yawRate, opts) {
  opts = opts || {};
  var maxLen = Number(opts.maxLen) || 1.6;
  var minLen = Number(opts.minLen) || 0.06;
  var sevMax = Number(opts.sevMax) || 1.0;
  var color = DRIFT_3D_COLOR[status];
  var idx = Number(index);
  // Pfeil zeigt nur Rotations-Ueberschuss / Spin; grip & understeer -> unsichtbar.
  if (color == null || index == null || !isFinite(idx) ||
      (status !== 'oversteer' && status !== 'counter')) {
    return { visible: false, length: 0, dirSign: 0, color: 0xffffff };
  }
  var severity = Math.max(0, Math.min(sevMax, Math.abs(idx - 1)));   // Abweichung vom Grip
  var length = severity / sevMax * maxLen;
  var dirSign = (Number(yawRate) || 0) >= 0 ? 1 : -1;
  return {
    visible: length > 0.05,
    length: Math.max(length, minLen),
    dirSign: dirSign,
    color: color
  };
}
```

- [ ] **Step 4: Kommentar über der Funktion an neue Semantik anpassen**

Anker (OLD):
```js
// driftArrowSpec: Darstellungs-Parameter fuer den 3D-Drift-Pfeil aus dem
// Phase-18-Driftzustand. Rein, wirft nie. Laenge ~ Drift-Index (0..2 -> 0..maxLen),
// Richtung = Vorzeichen der gemessenen Gierrate, Farbe je Status. 'n/a'/fehlende
// Daten -> unsichtbar.
```
NEW:
```js
// driftArrowSpec: Darstellungs-Parameter fuer den 3D-Drift-Pfeil aus dem
// (geglaetteten) Driftzustand. Rein, wirft nie. Laenge ~ Abweichung vom Grip
// (|index-1|, geklemmt auf SEV_MAX). Sichtbar nur bei oversteer & counter;
// grip/understeer/'n/a'/fehlende Daten -> unsichtbar. Richtung = Vorzeichen der
// gemessenen Gierrate, Farbe je Status.
```

- [ ] **Step 5: Tests grün + Syntax-Check**

Run: `node --test test/karts3d.test.js`
Expected: PASS (Anzahl unverändert).
Run: `node --check karts3d.js`
Expected: ok.

- [ ] **Step 6: Commit**

```bash
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" add karts3d.js test/karts3d.test.js
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" commit -m "feat(drift3d): sharpen drift arrow to deviation-from-grip indicator" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: Kern-Verdrahtung in `rasicross.js` (`invertYaw` + `driftInputs` + Glättung)

**Files:**
- Modify: `rasicross.js` (`:48`, `:60`, vor `processTelemetry` ~`:436`, `:463`, `:470‑473`, `:3354`, `:3382`)

> DOM/Wiring — nicht unit-getestet; verifiziert per `node --check` + Grep + manuellem Smoke (Task 7 / Checklist).

- [ ] **Step 1: `invertYaw` ins Kalibrier-Default-Objekt**

Anker (OLD):
```js
  calibration: { gxZero: 0, gyZero: 0, swapG: false, invertGx: false, invertGy: false },
```
NEW:
```js
  calibration: { gxZero: 0, gyZero: 0, swapG: false, invertGx: false, invertGy: false, invertYaw: false },
```

- [ ] **Step 2: `state.driftSmooth` ins State-Literal** — direkt nach der `drift:`-Zeile.

Anker (OLD):
```js
  drift: { status: 'n/a', index: null },
```
NEW:
```js
  drift: { status: 'n/a', index: null },
  driftSmooth: { idxEma: null, status: 'n/a', counterRun: 0 },
```

- [ ] **Step 3: `driftInputs`-Helper** — direkt **vor** `function processTelemetry(d) {` einfügen.

Anker (OLD):
```js
function processTelemetry(d) {
```
NEW:
```js
// Drift-Eingaenge aus einem (Roh-)Paket — identisch fuer Live und Replay-Aggregat.
// Wendet die IMU-Kalibrierung an (gy: swap/invert/zero; yaw: invertYaw), damit der
// Vorzeichen-/Counter-Check konsistente Achsen vergleicht.
function driftInputs(d, cal) {
  cal = cal || {};
  let gx = (Number(d.gx) || 0) - (cal.gxZero || 0);
  let gy = (Number(d.gy) || 0) - (cal.gyZero || 0);
  if (cal.swapG) { const t = gx; gx = gy; gy = t; }
  if (cal.invertGy) gy = -gy;
  let yaw = Number(d.yaw) || 0;
  if (cal.invertYaw) yaw = -yaw;
  return { yawRate: yaw, latAccel: gy, speed: Math.max(0, Number(d.speed) || 0) };
}

function processTelemetry(d) {
```

- [ ] **Step 4: `yawv` aus `driftInputs` beziehen** (vorzeichen-korrigiert)

Anker (OLD):
```js
    const yawv = Number(d.yaw) || 0;               // Gier (deg/s), jedes Paket
    state.imu.yaw = yawv;
```
NEW:
```js
    const di = driftInputs(d, state.calibration);  // geteilte Drift-Normalisierung (inkl. invertYaw)
    const yawv = di.yawRate;                        // vorzeichen-korrigierte Gierrate (deg/s)
    state.imu.yaw = yawv;
```
(Hinweis: `state.imu.yaw` ist jetzt vorzeichen-korrigiert — bei aktivem `invertYaw` dreht sich konsistent auch das `kYaw`-„Gier"-Vorzeichen und die 3D-Pfeil-Richtung. Gewollt.)

- [ ] **Step 5: Live-Drift auf analyze + smoothStep umstellen**

Anker (OLD):
```js
    // Drift (Phase 18): gemessene vs. erwartete Gierrate. gy = transformierte
    // Querbeschleunigung, yawv = Gier-Rate (Gyro-Z), speed in km/h.
    state.drift = RasiDrift.analyze(
      { yawRate: yawv, latAccel: gy, speed: speed }, state.settings.drift);
```
NEW:
```js
    // Drift (Phase 20): gehaerteter + geglaetteter Gierraten-Index. di teilt die
    // Eingangs-Normalisierung mit dem Replay-Aggregat; smoothStep liefert
    // EMA-Index + entprellten/hysterese-stabilen Status.
    const dRaw = RasiDrift.analyze(di, state.settings.drift);
    state.driftSmooth = RasiDrift.smoothStep(state.driftSmooth, dRaw, state.settings.drift);
    state.drift = { status: state.driftSmooth.status, index: state.driftSmooth.idxEma };
```

- [ ] **Step 6: `driftSmooth` in `REPLAY_KEYS`** (Snapshot/Restore um Replay)

Anker (OLD):
```js
  'batt','max','charts','imu','drift','heatmap','sectors','lapStart','currentLapMax',
```
NEW:
```js
  'batt','max','charts','imu','drift','driftSmooth','heatmap','sectors','lapStart','currentLapMax',
```

- [ ] **Step 7: `driftSmooth` in `resetReplayDerived`** — nach dem `state.drift`-Reset.

Anker (OLD):
```js
  state.drift = { status: 'n/a', index: null };
```
NEW:
```js
  state.drift = { status: 'n/a', index: null };
  state.driftSmooth = { idxEma: null, status: 'n/a', counterRun: 0 };
```

- [ ] **Step 8: Syntax-Check**

Run: `node --check rasicross.js`
Expected: ok.

- [ ] **Step 9: Grep-Verifikation**

Grep-Tool: `pattern: "invertYaw|driftSmooth|driftInputs"`, `path: rasicross.js`, `output_mode: content`.
Expected: `invertYaw` in calibration-Default + `driftInputs`; `driftSmooth` im State-Literal, `REPLAY_KEYS`, `resetReplayDerived` und der `processTelemetry`-Pipe; `driftInputs` Definition + Aufruf.

- [ ] **Step 10: Commit**

```bash
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" add rasicross.js
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" commit -m "feat(drift): invertYaw calibration + shared driftInputs + smoothed live pipe" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: `invertYaw`-UI (HTML-Toggle + Settings populate/apply)

**Files:**
- Modify: `RasiCross_Telemetry.html` (~`:3071`)
- Modify: `rasicross.js` (~`:379`, ~`:406`)

- [ ] **Step 1: Toggle-Row im IMU-Kalibrier-Block** — nach der „Gx ↔ Gy tauschen"-Row.

Anker (OLD):
```html
      <div class="toggle-row"><span class="label-text">Gx ↔ Gy tauschen</span><label class="toggle"><input type="checkbox" id="setSwapG"><span class="toggle-knob"></span></label></div>
```
NEW:
```html
      <div class="toggle-row"><span class="label-text">Gx ↔ Gy tauschen</span><label class="toggle"><input type="checkbox" id="setSwapG"><span class="toggle-knob"></span></label></div>
      <div class="toggle-row"><span class="label-text">Gier invertieren</span><label class="toggle"><input type="checkbox" id="setInvertYaw"><span class="toggle-knob"></span></label></div>
```

- [ ] **Step 2: populate (`loadSettingsToUi`)** — nach der `setSwapG`-Zeile.

Anker (OLD):
```js
  if ($('setSwapG')) $('setSwapG').checked = !!state.calibration.swapG;
```
NEW:
```js
  if ($('setSwapG')) $('setSwapG').checked = !!state.calibration.swapG;
  if ($('setInvertYaw')) $('setInvertYaw').checked = !!state.calibration.invertYaw;
```

- [ ] **Step 3: apply (`saveSettingsFromUi`)** — nach der `swapG`-Zeile.

Anker (OLD):
```js
  state.calibration.swapG = !!$('setSwapG')?.checked;
```
NEW:
```js
  state.calibration.swapG = !!$('setSwapG')?.checked;
  state.calibration.invertYaw = !!$('setInvertYaw')?.checked;
```

- [ ] **Step 4: Syntax-Check + Grep**

Run: `node --check rasicross.js`
Expected: ok.
Grep-Tool: `pattern: "setInvertYaw"`, expect 3 Treffer (HTML, populate, apply).

- [ ] **Step 5: Commit**

```bash
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" add rasicross.js RasiCross_Telemetry.html
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" commit -m "feat(drift): invertYaw calibration toggle in IMU settings" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: Replay-Aggregat mit gemeinsamer Normalisierung (`enterReplay`)

Behebt den latenten Bug, dass das Replay-Aggregat `swapG`/`invertGy`/`invertYaw` nicht anwandte.

**Files:**
- Modify: `rasicross.js` (`enterReplay` ~`:3457‑3460`)

- [ ] **Step 1: Pakete vor Auswertung normalisieren**

Anker (OLD):
```js
  const _ds = RasiDrift.summarize(parsed.packets, state.settings.drift);
  state.replay.driftSummary = _ds;
  setText('rpDrift', _ds.counted ? `${_ds.driftPct.toFixed(0)}% · max ${_ds.maxIndex.toFixed(1)}` : '–');
  renderDriftStrip(RasiDrift.driftSpans(parsed.packets, state.settings.drift), parsed.durationMs);
```
NEW:
```js
  // Drift-Aggregat mit DERSELBEN Kalibrierung wie Live (driftInputs): Pakete
  // normalisieren, summarize/driftSpans erwarten die Keys yaw/gy/speed/t_rel.
  const _calPk = parsed.packets.map(p => {
    const i = driftInputs(p, state.calibration);
    return { yaw: i.yawRate, gy: i.latAccel, speed: i.speed, t_rel: p.t_rel };
  });
  const _ds = RasiDrift.summarize(_calPk, state.settings.drift);
  state.replay.driftSummary = _ds;
  setText('rpDrift', _ds.counted ? `${_ds.driftPct.toFixed(0)}% · max ${_ds.maxIndex.toFixed(1)}` : '–');
  renderDriftStrip(RasiDrift.driftSpans(_calPk, state.settings.drift), parsed.durationMs);
```

- [ ] **Step 2: Syntax-Check + Grep**

Run: `node --check rasicross.js`
Expected: ok.
Grep-Tool: `pattern: "_calPk"`, expect 3 Treffer (Definition + summarize + driftSpans).

- [ ] **Step 3: Commit**

```bash
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" add rasicross.js
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" commit -m "fix(drift): apply IMU calibration to replay drift aggregate" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 6: Badge-Glyph + ruhiger Wert (`renderDriftBadge`)

**Files:**
- Modify: `rasicross.js` (`renderDriftBadge` ~`:559‑567`)

- [ ] **Step 1: Richtungs-Glyph + Wert-Regel**

Anker (OLD):
```js
function renderDriftBadge() {
  const el = $('kDrift');
  if (!el) return;
  const st = (state.drift && state.drift.status) || 'n/a';
  const idx = state.drift && state.drift.index;
  const label = DRIFT_LABEL[st] || '–';
  el.textContent = (st === 'n/a' || idx == null) ? label : `${label} ${idx.toFixed(1)}`;
  el.style.color = DRIFT_COLOR[st] || '';
}
```
NEW:
```js
function renderDriftBadge() {
  const el = $('kDrift');
  if (!el) return;
  const st = (state.drift && state.drift.status) || 'n/a';
  const idx = state.drift && state.drift.index;
  const label = DRIFT_LABEL[st] || '–';
  // Richtungs-Glyph nur fuer Rotations-Status, aus dem Vorzeichen der (kalibrierten) Gierrate.
  const glyph = (st === 'oversteer' || st === 'counter')
    ? ((state.imu && state.imu.yaw < 0) ? ' ←' : ' →') : '';
  // Wert (geglaetteter Index) bei oversteer/understeer/counter; grip/n/a nur Label.
  const showVal = idx != null && (st === 'oversteer' || st === 'understeer' || st === 'counter');
  el.textContent = showVal ? `${label}${glyph} ${idx.toFixed(1)}` : label;
  el.style.color = DRIFT_COLOR[st] || '';
}
```

- [ ] **Step 2: Syntax-Check**

Run: `node --check rasicross.js`
Expected: ok.

- [ ] **Step 3: Commit**

```bash
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" add rasicross.js
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" commit -m "feat(drift): badge direction glyph + grip shows label only" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 7: Gesamt-Verifikation + Plan-Doc-Commit

- [ ] **Step 1: Syntax-Check aller relevanten JS-Dateien**

Run: `node --check geo.js && node --check replay.js && node --check drift.js && node --check karts3d.js && node --check rasicross.js && node --check main.js && node --check preload.js`
Expected: keine Ausgabe (alle ok).

- [ ] **Step 2: Volle JS-Test-Suite**

Run: `node --test`
Expected: PASS, `pass 73  fail 0` (66 Baseline + 7 neue `drift`-Fälle: 6 geplant + 1 aus Task-1-Review [Understeer-Hysterese]; `karts3d`-Anzahl unverändert).

- [ ] **Step 3: Lint**

Run: `npm run lint`
Expected: keine Fehler (keine neuen Globals — `RasiDrift`/`RasiKart3D` bereits deklariert).

- [ ] **Step 4: Python-Regression (unverändert, muss grün bleiben)**

Run: `python -m unittest discover -s test -p "test_*.py"` (falls `python` fehlt: `py -3 -m unittest discover -s test -p "test_*.py"`)
Expected: `OK`.
Danach `__pycache__` löschen: `find . -name __pycache__ -type d -prune -exec rm -rf {} +`

- [ ] **Step 5: Status prüfen** (nur erwartete Dateien + dieser Plan)

Run: `git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" status --short`
Expected: working tree clean bis auf den **untracked** Plan `docs/superpowers/plans/2026-05-31-20-drift-system-rework.md`.

- [ ] **Step 6: Plan-Doc committen** (expliziter, finaler Plan-Doc-Commit)

```bash
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" add "docs/superpowers/plans/2026-05-31-20-drift-system-rework.md"
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" commit -m "docs: phase 20 drift-system rework implementation plan" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Hardware / Manual Acceptance Checklist (Dashboard-only — kein ESP-Flash)

Vom Nutzer in Electron/Live oder Demo zu verifizieren:

1. **Grip ruhig:** saubere Kurvenfahrt ⇒ Badge `Grip`, **kein** Flackern; 3D-Pfeil bei Grip unsichtbar.
2. **Übersteuern:** provoziertes Übersteuern (Heck kommt) ⇒ Badge `Drift` mit Richtungs-Glyph + Index; 3D-Pfeil wächst in Dreh-Richtung; bei kurzem Zucken kein Zurückspringen (Hysterese).
3. **Geradeaus/Stand:** ⇒ `–` (n/a), kein Fehlalarm, Pfeil unsichtbar.
4. **`invertYaw`-Kalibrierung:** zeigt eine saubere Kurve fälschlich `Spin`, kippt der neue Schalter „Gier invertieren" das auf `Drift`/`Grip`; Einstellung übersteht App-Neustart (persistiert via `saveData`).
5. **Replay-Konsistenz:** Aufnahme abspielen ⇒ Drift-%/max plausibel und konsistent zur Live-Anzeige (gleiche Kalibrierung); Drift-Strip markiert die Phasen.

## Self-Review (Plan ↔ Spec)

- **Spec coverage:** §4.1 driftInputs → Task 3/5; §4.2 smoothStep → Task 1; §4.3 Wiring (calibration/state/reset/REPLAY_KEYS/pipe) → Task 3; §4.4 Badge → Task 6; §4.5 driftArrowSpec → Task 2; §4.6 HTML/Settings → Task 4. §6.1 Tests → Task 1 & 2; §6.2 Statik/Lint → Task 7. Keine offene Spec-Anforderung.
- **Placeholder-Scan:** kein `TBD`/`TODO`/„später"; jeder Code-Step enthält vollständigen Code + Anker.
- **Typ-/Namens-Konsistenz:** `smoothInit`/`smoothStep`, `driftSmooth`, `driftInputs`, `setInvertYaw`, `invertYaw`, `_calPk`, `SEV_MAX`/`sevMax` — je einmal definiert, verbatim wiederverwendet. `state.drift = { status, index }` (index = `idxEma`) konsistent als Badge-/Pfeil-Eingang.
- **CRLF:** alle Edits ankern auf frisch gelesenen Text; Grep-Tool zur Verifikation; `__pycache__` vor `git status` löschen; nur genannte Dateien adden.

## Phase Map

| Phase | Scope | Status |
|-------|-------|--------|
| 18 | Drift-Erkennung (Gierraten-Index) | gemerged |
| (Follow-up) | Drift-Pfeil im 3D-Kart | gemerged |
| **20** (dieser Plan) | Drift-System härten + glätten + UX (Dashboard-only) | dieser Plan |
| 19 | Rollwinkel / Abheben (Firmware v2 + `attitude.js`) | gespeckt, aufgeschoben |
