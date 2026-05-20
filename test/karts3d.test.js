'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const K = require('../karts3d.js');

const close = (a, b, eps) => Math.abs(a - b) <= (eps == null ? 1e-9 : eps);

test('exports the pure-helper api', () => {
  for (const n of ['pitchFromG', 'rollFromG', 'yawIntegrate', 'gViewReducer']) {
    assert.equal(typeof K[n], 'function', `missing ${n}`);
  }
});

test('pitchFromG: stillstand (g=0,0,0) -> 0 rad', () => {
  assert.equal(K.pitchFromG(0, 0, 0), 0);
});

test('pitchFromG: pure forward G -> +pi/2; gravity-only -> 0; sign symmetric', () => {
  // gx=1, gy=0, gz=0  ->  atan2(1, sqrt(0+0)) = +pi/2
  assert.ok(close(K.pitchFromG(1, 0, 0), Math.PI / 2, 1e-9));
  // gravity-only at rest: gx=0, gy=0, gz=1  -> 0
  assert.equal(K.pitchFromG(0, 0, 1), 0);
  // -gx -> -pi/2
  assert.ok(close(K.pitchFromG(-1, 0, 0), -Math.PI / 2, 1e-9));
});

test('rollFromG: pure lateral G -> +pi/2; sign symmetric; gravity-only -> 0', () => {
  assert.ok(close(K.rollFromG(0, 1, 0), Math.PI / 2, 1e-9));
  assert.ok(close(K.rollFromG(0, -1, 0), -Math.PI / 2, 1e-9));
  assert.equal(K.rollFromG(0, 0, 1), 0);
});

test('yawIntegrate: dt-scaling + dps->rad; wraps into [-pi, pi]', () => {
  // 90 deg/s for 1000 ms -> +pi/2 rad
  assert.ok(close(K.yawIntegrate(0, 90, 1000), Math.PI / 2, 1e-9));
  // accumulating: pi/2 + (90 dps * 1000 ms) -> pi  (boundary)
  assert.ok(close(K.yawIntegrate(Math.PI / 2, 90, 1000), Math.PI, 1e-9));
  // wrap: large positive accumulation stays bounded
  const w = K.yawIntegrate(Math.PI - 0.01, 90 * 0.5, 1000); // adds pi/4
  assert.ok(w <= Math.PI && w >= -Math.PI, `wrap out of range: ${w}`);
  // zero rate -> identity
  assert.equal(K.yawIntegrate(0.3, 0, 50), 0.3);
  // NaN inputs -> caller's prev (no NaN propagation)
  assert.equal(K.yawIntegrate(0.5, NaN, 100), 0.5);
  assert.equal(K.yawIntegrate(0.5, 90, NaN), 0.5);
});

test('gViewReducer: toggle, set, invalid fallback -> 2d', () => {
  assert.equal(K.gViewReducer('2d', 'toggle'), '3d');
  assert.equal(K.gViewReducer('3d', 'toggle'), '2d');
  assert.equal(K.gViewReducer('2d', 'set:3d'), '3d');
  assert.equal(K.gViewReducer('3d', 'set:2d'), '2d');
  // garbage current -> clamp to '2d', then toggle -> '3d'
  assert.equal(K.gViewReducer('xxx', 'toggle'), '3d');
  // unknown action -> identity (after clamp)
  assert.equal(K.gViewReducer('3d', 'noop'), '3d');
  assert.equal(K.gViewReducer(undefined, 'noop'), '2d');
});

test('computeAutoFitScale: normal case scales bbox diagonal to target', () => {
  // bbox 2x2x2 -> diagonal sqrt(12) ≈ 3.4641; target = 4 -> scale ≈ 1.1547
  const s = K.computeAutoFitScale(2, 2, 2, 4);
  assert.ok(close(s, 4 / Math.sqrt(12), 1e-9), `expected ~${4 / Math.sqrt(12)}, got ${s}`);
  // 1x1x1 diagonal sqrt(3); target = sqrt(3) -> scale = 1
  assert.ok(close(K.computeAutoFitScale(1, 1, 1, Math.sqrt(3)), 1, 1e-9));
  // Primitive default target = sqrt(2² + 0.4² + 1.2²) ≈ 2.4166
  const target = Math.sqrt(4 + 0.16 + 1.44);
  // bbox 1x1x1 -> scale = target / sqrt(3)
  assert.ok(close(K.computeAutoFitScale(1, 1, 1, target), target / Math.sqrt(3), 1e-9));
});

test('computeAutoFitScale: degenerate (zero) and NaN inputs -> 1', () => {
  assert.equal(K.computeAutoFitScale(0, 0, 0, 4), 1);
  assert.equal(K.computeAutoFitScale(NaN, 2, 2, 4), 1);
  assert.equal(K.computeAutoFitScale(2, 2, 2, NaN), 1);
  assert.equal(K.computeAutoFitScale(-1, 2, 2, 4), 1);  // negative -> degenerate
  assert.equal(K.computeAutoFitScale(2, 2, 2, 0), 1);    // zero target -> degenerate
});

test('kartModelYawReducer: next / prev with wrap', () => {
  assert.equal(K.kartModelYawReducer(0,   'next'), 90);
  assert.equal(K.kartModelYawReducer(90,  'next'), 180);
  assert.equal(K.kartModelYawReducer(180, 'next'), 270);
  assert.equal(K.kartModelYawReducer(270, 'next'), 0);   // wrap
  assert.equal(K.kartModelYawReducer(0,   'prev'), 270); // wrap
  assert.equal(K.kartModelYawReducer(90,  'prev'), 0);
  assert.equal(K.kartModelYawReducer(180, 'prev'), 90);
  assert.equal(K.kartModelYawReducer(270, 'prev'), 180);
});

test('kartModelYawReducer: set:N actions, clamp invalid current, unknown action -> identity', () => {
  assert.equal(K.kartModelYawReducer(0,   'set:90'),  90);
  assert.equal(K.kartModelYawReducer(0,   'set:180'), 180);
  assert.equal(K.kartModelYawReducer(0,   'set:270'), 270);
  assert.equal(K.kartModelYawReducer(180, 'set:0'),   0);
  // invalid current clamps to 0 before action
  assert.equal(K.kartModelYawReducer(45,  'next'),    90);
  assert.equal(K.kartModelYawReducer(45,  'set:180'), 180);
  // unknown action returns clamped current
  assert.equal(K.kartModelYawReducer(90,  'noop'),    90);
  assert.equal(K.kartModelYawReducer('xx', 'noop'),   0);
  assert.equal(K.kartModelYawReducer(undefined, 'next'), 90);
});
