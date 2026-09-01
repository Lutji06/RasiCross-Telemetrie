import test from 'node:test';
import assert from 'node:assert/strict';
import S from '../src/smoothing.js';

test('module exports emaStep + MAX_ALPHA', () => {
  assert.equal(typeof S.emaStep, 'function');
  assert.equal(typeof S.MAX_ALPHA, 'number');
  assert.ok(S.MAX_ALPHA > 0 && S.MAX_ALPHA <= 1);
});

test('emaStep: erster Wert seedet unveraendert (kein Anlauf von 0)', () => {
  assert.equal(S.emaStep(null, 42, 0.3), 42);
  assert.equal(S.emaStep(undefined, 42, 0.3), 42);
});

test('emaStep: einzelner Ausreisser wird gedaempft', () => {
  // Konstante 50, dann ein einzelner 100er-Spike.
  const spiked = S.emaStep(50, 100, 0.3);
  assert.equal(spiked, 65);                 // 50 + (100-50)*0.3
  assert.ok(spiked < 100, 'Spike darf den Wert nicht voll durchreichen');
  // Nach dem Spike faellt der Wert wieder Richtung 50.
  assert.ok(S.emaStep(spiked, 50, 0.3) < spiked);
});

test('emaStep: anhaltender Wert konvergiert dorthin', () => {
  let v = 0;
  for (let i = 0; i < 40; i++) v = S.emaStep(v, 80, 0.3);
  assert.ok(Math.abs(v - 80) < 0.01, 'sollte praktisch 80 erreichen, war ' + v);
});

test('emaStep: unbrauchbare Messwerte lassen den Zustand stehen', () => {
  assert.equal(S.emaStep(50, NaN, 0.3), 50);
  assert.equal(S.emaStep(50, undefined, 0.3), 50);
  assert.equal(S.emaStep(50, 'abc', 0.3), 50);
  assert.equal(S.emaStep(null, NaN, 0.3), null);
});

test('emaStep: ungueltiges alpha faellt auf MAX_ALPHA zurueck', () => {
  assert.equal(S.emaStep(50, 100, 0), S.emaStep(50, 100, S.MAX_ALPHA));
  assert.equal(S.emaStep(50, 100, 5), S.emaStep(50, 100, S.MAX_ALPHA));
  assert.equal(S.emaStep(50, 100, NaN), S.emaStep(50, 100, S.MAX_ALPHA));
});

test('emaStep: alpha=1 heisst ungefiltert', () => {
  assert.equal(S.emaStep(50, 100, 1), 100);
});
