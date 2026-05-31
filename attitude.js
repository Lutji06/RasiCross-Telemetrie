'use strict';
// ============================================================
//  attitude.js — pure roll-angle fusion + wheel-lift (Phase 19)
//  Loaded as a classic <script> BEFORE rasicross.js (exposes
//  window.RasiAttitude) and as a CommonJS module for node:test.
//  Dependency-free. No DOM. See spec 2026-05-30 §5.6.
// ============================================================

var _DEG = 180 / Math.PI;
var LIFT_DEFAULTS = { angleDeg: 12, rateDps: 60, hystDeg: 3 };

function _num(x) { var v = Number(x); return isFinite(v) ? v : 0; }
function _clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

// Complementary-filter step -> new roll angle (deg).
//   prevRollDeg : last roll angle (deg)
//   rollRateDps : roll rate (deg/s, Gyro-X)
//   gy, gz      : accel axes (g) for the gravity reference
//   dtSec       : timestep (s), clamped against gaps
//   alpha       : gyro weight (default 0.98)
function rollStep(prevRollDeg, rollRateDps, gy, gz, dtSec, alpha) {
  var a = alpha == null ? 0.98 : Number(alpha);
  if (!(a >= 0)) a = 0;
  if (a > 1) a = 1;
  var dt = _clamp(_num(dtSec), 0, 0.5);            // clamp against stalls/gaps
  var gyroPart = _num(prevRollDeg) + _num(rollRateDps) * dt;
  var accelRoll = Math.atan2(_num(gy), _num(gz)) * _DEG;
  return a * gyroPart + (1 - a) * accelRoll;
}

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
    ? aRoll > (angleDeg - hystDeg)                 // stay until below angle-hyst
    : (aRoll > angleDeg && aRate > rateDps);       // enter needs BOTH
  return { active: active, onset: active && !wasActive };
}

// ── UMD-style export ────────────────────────────────────────
(function () {
  var api = { rollStep: rollStep, wheelLift: wheelLift };
  if (typeof module !== 'undefined' && module.exports) { module.exports = api; }
  if (typeof window !== 'undefined') { window.RasiAttitude = api; }
})();
