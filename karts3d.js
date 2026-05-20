'use strict';
// ============================================================
//  karts3d.js — 3D Kart G-Viewer (RasiCross)
//  UMD-style: pure helpers exported via module.exports for
//  node:test; DOM/WebGL wrapper attached to window.RasiKart3D
//  when running in a browser with THREE available.
//  Dependency-free at module top; the DOM part is gated by
//  `typeof THREE !== 'undefined'` (see Task 3).
//  Loaded order in HTML:
//    geo.js -> replay.js -> vendor/three.min.js -> karts3d.js
//      -> rasicross.js
// ============================================================

// ── Pure helpers (testable under node:test) ────────────────

// pitchFromG: atan2(gx, sqrt(gy^2 + gz^2)).
// Returns radians. Stillstand (0,0,0) -> 0 (JS atan2(0,0) === 0).
function pitchFromG(gx, gy, gz) {
  var x = Number(gx) || 0, y = Number(gy) || 0, z = Number(gz) || 0;
  return Math.atan2(x, Math.sqrt(y * y + z * z));
}

// rollFromG: atan2(gy, sqrt(gx^2 + gz^2)).
function rollFromG(gx, gy, gz) {
  var x = Number(gx) || 0, y = Number(gy) || 0, z = Number(gz) || 0;
  return Math.atan2(y, Math.sqrt(x * x + z * z));
}

// yawIntegrate: prev + dps * dt/1000 * pi/180, wrapped into (-pi, pi].
// NaN/Inf in dps or dtMs -> returns prev unchanged (no propagation).
function yawIntegrate(prevRad, yawDegPerS, dtMs) {
  var p = Number(prevRad);
  if (!isFinite(p)) p = 0;
  var d = Number(yawDegPerS), t = Number(dtMs);
  if (!isFinite(d) || !isFinite(t)) return p;
  if (d === 0) return p;  // identity: skip wrap to avoid float drift
  var next = p + d * (t / 1000) * (Math.PI / 180);
  // Wrap into [-pi, pi] (both endpoints valid; pi stays pi, not folded to -pi).
  var twoPi = Math.PI * 2;
  // Standard modulo into [0, 2pi), then shift to (-pi, pi].
  next = ((next % twoPi) + twoPi) % twoPi; // now in [0, 2pi)
  if (next > Math.PI) next -= twoPi;        // shift: values above pi become negative
  return next;
}

// gViewReducer: clamp current to '2d'/'3d', then apply action.
// Unknown action -> identity (post-clamp).
function gViewReducer(current, action) {
  var cur = (current === '3d') ? '3d' : '2d';
  if (action === 'toggle') return cur === '2d' ? '3d' : '2d';
  if (action === 'set:2d') return '2d';
  if (action === 'set:3d') return '3d';
  return cur;
}

// ── UMD-style export ───────────────────────────────────────
(function () {
  var api = {
    pitchFromG: pitchFromG,
    rollFromG: rollFromG,
    yawIntegrate: yawIntegrate,
    gViewReducer: gViewReducer
  };
  if (typeof module !== 'undefined' && module.exports) { module.exports = api; }
  if (typeof window !== 'undefined') { window.RasiKart3D = api; }
})();
