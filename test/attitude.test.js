'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const att = require('../attitude.js');

const approx = (a, b, tol = 1e-3) => assert.ok(Math.abs(a - b) <= tol, `${a} != ${b} (±${tol})`);

test('module exports rollStep + rolloverStep', () => {
  assert.equal(typeof att.rollStep, 'function');
  assert.equal(typeof att.rolloverStep, 'function');
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

test('rolloverStep: onset at/above the angle threshold (no rate gate)', () => {
  const thr = { angleDeg: 75, hystDeg: 5 };
  const r = att.rolloverStep({ active: false }, 80, thr);
  assert.equal(r.active, true);
  assert.equal(r.onset, true);
  assert.equal(att.rolloverStep({ active: false }, 75, thr).active, true);  // == threshold
});

test('rolloverStep: cornering lean (~45deg) does NOT trigger', () => {
  const thr = { angleDeg: 75, hystDeg: 5 };
  assert.equal(att.rolloverStep({ active: false }, 45, thr).active, false);
  assert.equal(att.rolloverStep({ active: false }, 70, thr).active, false);
});

test('rolloverStep: sign-independent (negative roll triggers too)', () => {
  const thr = { angleDeg: 75, hystDeg: 5 };
  assert.equal(att.rolloverStep({ active: false }, -80, thr).active, true);
});

test('rolloverStep: hysteresis holds until below angle-hyst; onset only on transition', () => {
  const thr = { angleDeg: 75, hystDeg: 5 };
  assert.equal(att.rolloverStep({ active: true }, 72, thr).active, true);
  assert.equal(att.rolloverStep({ active: true }, 70, thr).active, true);
  assert.equal(att.rolloverStep({ active: true }, 69, thr).active, false);
  assert.equal(att.rolloverStep({ active: true }, 80, thr).onset, false);
});

test('attitude: junk inputs never throw', () => {
  assert.doesNotThrow(() => att.rollStep(NaN, NaN, NaN, NaN, NaN, NaN));
  assert.doesNotThrow(() => att.rolloverStep(null, NaN, null));
});
