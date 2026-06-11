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
var SMOOTH_DEFAULTS = { smooth: 0.6, hyst: 0.15, counterHold: 3 };

function _num(x) { var v = Number(x); return isFinite(v) ? v : 0; }

// Hangkompensation (Phase 24): zieht die Schwerkraftkomponente aus der
// Querbeschleunigung (latG in g, rollDeg = fusionierter Rollwinkel aus
// attitude.js). gy und roll teilen per rollStep-Konstruktion dieselbe
// Vorzeichen-Konvention (roll = atan2(gy, gz)): statische Neigung theta
// -> gy = sin(theta). Ungueltiger Rollwinkel -> Passthrough.
// WICHTIG: Den kompensierten Wert NICHT in rollStep zurueckfuettern --
// der braucht die rohe gy als Gravitationsreferenz (sonst Rueckkopplung).
function tiltCompLatG(latG, rollDeg) {
  if (!isFinite(Number(rollDeg))) return _num(latG);
  return _num(latG) - Math.sin(_num(rollDeg) * Math.PI / 180);
}

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

// ── UMD-style export ────────────────────────────────────────
(function () {
  var api = { expectedYawRate: expectedYawRate, analyze: analyze,
              summarize: summarize, driftSpans: driftSpans,
              smoothInit: smoothInit, smoothStep: smoothStep,
              tiltCompLatG: tiltCompLatG };
  if (typeof module !== 'undefined' && module.exports) { module.exports = api; }
  if (typeof window !== 'undefined') { window.RasiDrift = api; }
})();
