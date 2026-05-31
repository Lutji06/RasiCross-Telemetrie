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
  approx(s1.idxEma, 1.5, 1e-9);
  const s2 = drift.smoothStep(s1, { status: 'oversteer', index: 2.0 }, { smooth: 0.6 });
  approx(s2.idxEma, 1.7, 1e-9);
});

test('smoothStep: Hysterese haelt oversteer bis Index unter 1+tol-hyst faellt', () => {
  const opts = { smooth: 0, tol: 0.25, hyst: 0.15 };
  let s = drift.smoothStep(drift.smoothInit(), { status: 'oversteer', index: 1.4 }, opts);
  assert.equal(s.status, 'oversteer');
  s = drift.smoothStep(s, { status: 'grip', index: 1.15 }, opts);
  assert.equal(s.status, 'oversteer');
  s = drift.smoothStep(s, { status: 'grip', index: 1.05 }, opts);
  assert.equal(s.status, 'grip');
});

test('smoothStep: counter braucht counterHold Samples (Entprellung), dann loest es', () => {
  const opts = { smooth: 0, counterHold: 3 };
  let s = drift.smoothInit();
  s = drift.smoothStep(s, { status: 'counter', index: 1.5 }, opts);
  assert.notEqual(s.status, 'counter');
  s = drift.smoothStep(s, { status: 'counter', index: 1.5 }, opts);
  assert.notEqual(s.status, 'counter');
  s = drift.smoothStep(s, { status: 'counter', index: 1.5 }, opts);
  assert.equal(s.status, 'counter');
  s = drift.smoothStep(s, { status: 'oversteer', index: 1.5 }, opts);
  assert.equal(s.status, 'counter');
  s = drift.smoothStep(s, { status: 'oversteer', index: 1.5 }, opts);
  s = drift.smoothStep(s, { status: 'oversteer', index: 1.5 }, opts);
  assert.notEqual(s.status, 'counter');
});

test('smoothStep: Junk-Eingaben werfen nie', () => {
  assert.doesNotThrow(() => drift.smoothStep(null, null));
  assert.equal(drift.smoothStep(undefined, { status: 'grip', index: 'x' }).status, 'n/a');
});
