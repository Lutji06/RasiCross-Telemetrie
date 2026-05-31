'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const drift = require('../drift.js');

const approx = (a, b, tol = 1e-3) => assert.ok(Math.abs(a - b) <= tol, `${a} != ${b} (±${tol})`);

test('module exports the 4 functions', () => {
  for (const n of ['expectedYawRate', 'analyze', 'summarize', 'driftSpans']) {
    assert.equal(typeof drift[n], 'function', `missing ${n}`);
  }
});

test('expectedYawRate: matches hand calc and guards v<=0', () => {
  // a = 0.5 g = 4.90332 m/s^2 ; v = 36 km/h = 10 m/s ; w = 0.490332 rad/s = 28.092 deg/s
  approx(drift.expectedYawRate(0.5, 36), 28.092, 0.05);
  assert.equal(drift.expectedYawRate(0.5, 0), 0);
  assert.equal(drift.expectedYawRate(0, 36), 0);
});

test('analyze: straight / slow -> n/a', () => {
  assert.equal(drift.analyze({ yawRate: 0, latAccel: 0.02, speed: 40 }).status, 'n/a');
  assert.equal(drift.analyze({ yawRate: 5, latAccel: 0.4, speed: 2 }).status, 'n/a');
  assert.equal(drift.analyze({ yawRate: 5, latAccel: 0.4, speed: 2 }).index, null);
});

test('analyze: steady grip -> index ~1', () => {
  const exp = drift.expectedYawRate(0.5, 36);
  const r = drift.analyze({ yawRate: exp, latAccel: 0.5, speed: 36 });
  assert.equal(r.status, 'grip');
  approx(r.index, 1, 0.01);
});

test('analyze: oversteer vs understeer', () => {
  const exp = drift.expectedYawRate(0.5, 36);
  assert.equal(drift.analyze({ yawRate: exp * 1.6, latAccel: 0.5, speed: 36 }).status, 'oversteer');
  assert.equal(drift.analyze({ yawRate: exp * 0.5, latAccel: 0.5, speed: 36 }).status, 'understeer');
});

test('analyze: opposite signs -> counter (above noise)', () => {
  const exp = drift.expectedYawRate(0.5, 36);
  assert.equal(drift.analyze({ yawRate: -exp, latAccel: 0.5, speed: 36 }).status, 'counter');
});

test('analyze: NaN / junk -> n/a, never throws', () => {
  assert.equal(drift.analyze({ yawRate: NaN, latAccel: 'x', speed: undefined }).status, 'n/a');
  assert.equal(drift.analyze(null).status, 'n/a');
});

test('summarize: percentages and max over a sequence', () => {
  const exp = drift.expectedYawRate(0.5, 36);
  const s = drift.summarize([
    { yaw: 0, gy: 0.0, speed: 40 },          // n/a
    { yaw: exp, gy: 0.5, speed: 36 },        // grip
    { yaw: exp * 1.6, gy: 0.5, speed: 36 },  // oversteer (drift)
    { yaw: -exp, gy: 0.5, speed: 36 },       // counter (drift)
    { yaw: exp * 0.5, gy: 0.5, speed: 36 }   // understeer
  ]);
  assert.equal(s.total, 5);
  assert.equal(s.counted, 4);
  assert.equal(s.driftCount, 2);
  approx(s.driftPct, 50, 0.01);
  approx(s.understeerPct, 25, 0.01);
  assert.ok(s.maxIndex >= 1.6);
});

test('driftSpans: contiguous drift phases in ms', () => {
  const exp = drift.expectedYawRate(0.5, 36);
  const G = { yaw: exp, gy: 0.5, speed: 36 };           // grip
  const D = { yaw: exp * 1.6, gy: 0.5, speed: 36 };     // drift
  const spans = drift.driftSpans([
    { ...G, t_rel: 0 }, { ...D, t_rel: 100 }, { ...D, t_rel: 200 },
    { ...G, t_rel: 300 }, { ...D, t_rel: 400 }
  ]);
  assert.equal(spans.length, 2);
  assert.deepEqual(spans[0], { startMs: 100, endMs: 200 });
  assert.deepEqual(spans[1], { startMs: 400, endMs: 400 });
});
