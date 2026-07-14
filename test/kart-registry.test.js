import { test } from 'node:test';
import assert from 'node:assert';
import KartRegistry from '../src/kart-registry.js';

test('makeKartState returns independent fresh state', () => {
  const a = KartRegistry.makeKartState();
  const b = KartRegistry.makeKartState();
  a.max.speed = 50;
  assert.strictEqual(b.max.speed, 0);
  assert.deepStrictEqual(a.telemetry, { speed: 0, rpm: 0, gx: 0, gy: 0, lat: 0, lon: 0 });
  assert.deepStrictEqual(a.charts.speed, []);
  assert.strictEqual(a.calibration.swapG, false);
  assert.strictEqual(a.engine.serviceIntervalH, 10);
});

test('get() creates on first sight and auto-selects first as active', () => {
  const r = KartRegistry.create();
  assert.strictEqual(r.activeMac(), null);
  const k = r.get('aa');
  assert.ok(k);
  assert.strictEqual(r.activeMac(), 'aa');
  assert.strictEqual(r.get('aa'), k);
  assert.deepStrictEqual(r.macs(), ['aa']);
});

test('get() caps at MAX_KARTS and returns null beyond', () => {
  const r = KartRegistry.create();
  assert.strictEqual(KartRegistry.MAX_KARTS, 4);
  ['a', 'b', 'c', 'd'].forEach(m => assert.ok(r.get(m)));
  assert.strictEqual(r.get('e'), null);
  assert.strictEqual(r.macs().length, 4);
});

test('setActive only switches to a known mac', () => {
  const r = KartRegistry.create();
  r.get('a'); r.get('b');
  assert.strictEqual(r.setActive('b'), true);
  assert.strictEqual(r.activeMac(), 'b');
  assert.strictEqual(r.setActive('zzz'), false);
  assert.strictEqual(r.activeMac(), 'b');
});

test('active() returns the active kartState', () => {
  const r = KartRegistry.create();
  const a = r.get('a');
  assert.strictEqual(r.active(), a);
});

test('forget() drops a kart and re-points active if needed', () => {
  const r = KartRegistry.create();
  r.get('a'); r.get('b');
  r.setActive('a');
  assert.strictEqual(r.forget('a'), true);
  assert.deepStrictEqual(r.macs(), ['b']);
  assert.strictEqual(r.activeMac(), 'b');
  assert.strictEqual(r.forget('nope'), false);
});

test('reset() clears everything', () => {
  const r = KartRegistry.create();
  r.get('a'); r.get('b');
  r.reset();
  assert.deepStrictEqual(r.macs(), []);
  assert.strictEqual(r.activeMac(), null);
});

test('DEFAULT_MAC bucket is usable like any mac', () => {
  const r = KartRegistry.create();
  const k = r.get(KartRegistry.DEFAULT_MAC);
  assert.ok(k);
  assert.strictEqual(r.activeMac(), KartRegistry.DEFAULT_MAC);
});

test('makeKartState: stats-Defaults (Phase 48)', () => {
  const k = KartRegistry.makeKartState();
  assert.deepStrictEqual(k.stats, { odoM: 0, moveMs: 0, topKmh: 0, lastAt: null, _unsavedMs: 0 });
});
