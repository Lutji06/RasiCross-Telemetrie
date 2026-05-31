'use strict';
// ============================================================
//  attitude.js — pure roll-angle fusion + wheel-lift (Phase 19)
//  Loaded as a classic <script> BEFORE rasicross.js (exposes
//  window.RasiAttitude) and as a CommonJS module for node:test.
//  Dependency-free. No DOM. See spec 2026-05-30 §5.6.
// ============================================================

var _DEG = 180 / Math.PI;
var ROLLOVER_DEFAULTS = { angleDeg: 75, hystDeg: 5 };

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
  var dt = _clamp(_num(dtSec), 0, 0.5);            // upper bound vs stalls/gaps; lower 0 (no div-by-dt; avoids over-integration on fast samples)
  var gyroPart = _num(prevRollDeg) + _num(rollRateDps) * dt;
  var accelRoll = Math.atan2(_num(gy), _num(gz)) * _DEG;
  return a * gyroPart + (1 - a) * accelRoll;
}

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

// ── UMD-style export ────────────────────────────────────────
(function () {
  var api = { rollStep: rollStep, rolloverStep: rolloverStep };
  if (typeof module !== 'undefined' && module.exports) { module.exports = api; }
  if (typeof window !== 'undefined') { window.RasiAttitude = api; }
})();
