'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const att = require('../attitude.js');

const approx = (a, b, tol = 1e-3) => assert.ok(Math.abs(a - b) <= tol, `${a} != ${b} (±${tol})`);

test('module exports rollStep + wheelLift', () => {
  assert.equal(typeof att.rollStep, 'function');
  assert.equal(typeof att.wheelLift, 'function');
});

test('rollStep: alpha=0 -> pure accel reference atan2(gy,gz)', () => {
  approx(att.rollStep(99, 999, 1, 0, 0.1, 0), 90, 1e-6);   // atan2(1,0)=pi/2 -> 90
});

test('rollStep: alpha=1 -> pure gyro integration', () => {
  approx(att.rollStep(10, 90, 0, 1, 0.1, 1), 19, 1e-9);    // 10 + 90*0.1
});

test('rollStep: dt clamped on a large gap (no jump)', () => {
  approx(att.rollStep(0, 100, 0, 1, 5.0, 1), 50, 1e-9);    // dt clamp 0.5: 0 + 100*0.5
});

test('rollStep: blends gyro and accel by alpha', () => {
  approx(att.rollStep(0, 0, 1, 1, 0.1, 0.5), 22.5, 1e-6);  // 0.5*0 + 0.5*45
});

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
  assert.equal(att.wheelLift({ active: true }, 10, 5, thr).active, true);  // 10 > 9
  assert.equal(att.wheelLift({ active: true }, 8, 5, thr).active, false);  // 8 < 9
  assert.equal(att.wheelLift({ active: true }, 15, 80, thr).onset, false); // continuing
});

test('attitude: junk inputs never throw', () => {
  assert.doesNotThrow(() => att.rollStep(NaN, NaN, NaN, NaN, NaN, NaN));
  assert.doesNotThrow(() => att.wheelLift(null, NaN, NaN, null));
});
