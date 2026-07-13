import test from 'node:test';
import assert from 'node:assert/strict';
import RasiKartStats from '../src/kart-stats.js';

test('statsStep: integriert Distanz und Fahrzeit (36 km/h, 1 s -> +10 m)', () => {
  const acc = { odoM: 100, moveMs: 5000, topKmh: 30, lastAt: 10000 };
  const r = RasiKartStats.statsStep(acc, 36, 11000);
  assert.ok(Math.abs(r.odoM - 110) < 1e-9);
  assert.equal(r.moveMs, 6000);
  assert.equal(r.topKmh, 36);
  assert.equal(r.lastAt, 11000);
  assert.equal(r.addedMs, 1000);
  assert.equal(acc.odoM, 100);   // pur: Eingabe unveraendert
});

test('statsStep: unter 3 km/h zaehlt nichts, lastAt wird genullt', () => {
  const r = RasiKartStats.statsStep({ odoM: 50, moveMs: 2000, topKmh: 20, lastAt: 10000 }, 2, 11000);
  assert.equal(r.odoM, 50);
  assert.equal(r.moveMs, 2000);
  assert.equal(r.lastAt, null);
  assert.equal(r.addedMs, 0);
});

test('statsStep: Luecke > MAX_GAP_MS wird verworfen, zaehlt ab jetzt weiter', () => {
  const r = RasiKartStats.statsStep({ odoM: 50, moveMs: 2000, topKmh: 20, lastAt: 10000 }, 36, 20000);
  assert.equal(r.odoM, 50);
  assert.equal(r.moveMs, 2000);
  assert.equal(r.addedMs, 0);
  assert.equal(r.lastAt, 20000);
});

test('statsStep: topKmh waechst auch im Stand; erster Tick ohne lastAt addiert nichts', () => {
  const still = RasiKartStats.statsStep({ odoM: 0, moveMs: 0, topKmh: 10, lastAt: null }, 2, 1000);
  assert.equal(still.topKmh, 10);
  const fast = RasiKartStats.statsStep({ odoM: 0, moveMs: 0, topKmh: 10, lastAt: null }, 44, 1000);
  assert.equal(fast.topKmh, 44);
  assert.equal(fast.addedMs, 0);
  assert.equal(fast.lastAt, 1000);
});

test('avgKmh: 10 km in 0,5 h -> 20; ohne Fahrzeit -> 0', () => {
  assert.equal(RasiKartStats.avgKmh(10000, 1800000), 20);
  assert.equal(RasiKartStats.avgKmh(10000, 0), 0);
});

test('kmText/kmhText: deutsches Komma, eine Nachkommastelle', () => {
  assert.equal(RasiKartStats.kmText(148234), '148,2 km');
  assert.equal(RasiKartStats.kmhText(24.31), '24,3 km/h');
  assert.equal(RasiKartStats.kmText(0), '0,0 km');
});
