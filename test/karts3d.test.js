'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const K = require('../karts3d.js');

const RAD = Math.PI / 180;
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
