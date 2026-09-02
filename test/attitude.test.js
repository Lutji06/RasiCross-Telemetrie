import test from 'node:test';
import assert from 'node:assert/strict';
import att from '../src/attitude.js';

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

// ── mountFix: IMU kopfueber eingebaut (180 Grad um die Laengsachse) ──
test('module exports mountFix', () => {
  assert.equal(typeof att.mountFix, 'function');
});

test('mountFix: aufrecht eingebaut laesst alle Achsen unveraendert', () => {
  const r = att.mountFix(0.3, -0.9, 12, false);
  approx(r.gy, 0.3, 1e-9);
  approx(r.gz, -0.9, 1e-9);
  approx(r.rollRate, 12, 1e-9);
});

test('mountFix: kopfueber kippt gy, gz und die Roll-Rate', () => {
  const r = att.mountFix(0.3, 1, 12, true);
  approx(r.gy, -0.3, 1e-9);
  approx(r.gz, -1, 1e-9);
  approx(r.rollRate, -12, 1e-9);
});

test('mountFix: zweimal gespiegelt ist wieder die Ausgangslage', () => {
  const a = att.mountFix(0.3, -0.9, 12, true);
  const b = att.mountFix(a.gy, a.gz, a.rollRate, true);
  approx(b.gy, 0.3, 1e-9);
  approx(b.gz, -0.9, 1e-9);
  approx(b.rollRate, 12, 1e-9);
});

// Der eigentliche Zweck: kopfueber misst der Sensor im Stand gz = -1g.
// Ungeklammert liefert atan2(0,-1) den Rollwinkel 180 Grad -- und damit
// steht die Umkipp-Warnung dauerhaft an, obwohl der Kart eben steht.
test('mountFix: kopfueber im Stand ergibt 0 Grad statt 180', () => {
  const roh = att.rollStep(0, 0, 0, -1, 0.1, 0);
  approx(Math.abs(roh), 180, 1e-6);                 // so sieht der Fehler heute aus
  const m = att.mountFix(0, -1, 0, true);
  approx(att.rollStep(0, m.rollRate, m.gy, m.gz, 0.1, 0), 0, 1e-6);
});

test('mountFix: kopfueber im Stand loest keine Umkipp-Warnung aus', () => {
  const thr = { angleDeg: 75, hystDeg: 5 };
  const m = att.mountFix(0, -1, 0, true);
  const roll = att.rollStep(0, m.rollRate, m.gy, m.gz, 0.1, 0);
  assert.equal(att.rolloverStep({ active: false }, roll, thr).active, false);
});

test('mountFix: kopfueber kippt echte Schraeglage mit, nicht nur den Nullpunkt', () => {
  // 30 Grad Schraeglage aufrecht: atan2(0.5, -0.866) ... gespiegelt muss
  // derselbe Betrag mit umgekehrtem Vorzeichen herauskommen.
  const auf = att.rollStep(0, 0, 0.5, 0.866, 0.1, 0);
  const m = att.mountFix(-0.5, -0.866, 0, true);
  approx(att.rollStep(0, m.rollRate, m.gy, m.gz, 0.1, 0), auf, 1e-6);
});

test('mountFix: junk inputs never throw', () => {
  assert.doesNotThrow(() => att.mountFix(NaN, undefined, null, true));
  const r = att.mountFix(NaN, undefined, null, true);
  approx(r.gy, 0, 1e-9);
  approx(r.gz, 0, 1e-9);
  approx(r.rollRate, 0, 1e-9);
});
