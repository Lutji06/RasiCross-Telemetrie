'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../engine.js');

test('engineStep: erster laufender Tick setzt nur den Anker, zaehlt nichts', () => {
  const r = E.engineStep({ totalMs: 0, lastAt: null }, 1800, 1000);
  assert.equal(r.totalMs, 0);
  assert.equal(r.lastAt, 1000);
  assert.equal(r.addedMs, 0);
});

test('engineStep: laufender Motor akkumuliert die Paket-Luecke', () => {
  let acc = { totalMs: 0, lastAt: null };
  acc = E.engineStep(acc, 1800, 1000);
  acc = E.engineStep(acc, 2500, 1080);
  assert.equal(acc.totalMs, 80);
  assert.equal(acc.lastAt, 1080);
});

test('engineStep: unter RUN_RPM_MIN -> Anker weg, nichts gezaehlt', () => {
  const r = E.engineStep({ totalMs: 500, lastAt: 1000 }, 0, 2000);
  assert.equal(r.totalMs, 500);
  assert.equal(r.lastAt, null);
  assert.equal(r.addedMs, 0);
});

test('engineStep: Luecke > MAX_GAP_MS wird gedeckelt', () => {
  const r = E.engineStep({ totalMs: 0, lastAt: 1000 }, 3000, 61000);
  assert.equal(r.totalMs, E.MAX_GAP_MS);
});

test('engineStep: rueckwaerts laufende Uhr zaehlt nicht negativ', () => {
  const r = E.engineStep({ totalMs: 100, lastAt: 5000 }, 3000, 4000);
  assert.equal(r.totalMs, 100);
  assert.equal(r.lastAt, 4000);
});

test('engineStep: kaputte Eingaben -> wirft nie, liefert Zahlen', () => {
  const r = E.engineStep(null, NaN, NaN);
  assert.equal(r.totalMs, 0);
  assert.equal(r.lastAt, null);
});

test('hoursText: formatiert mit Dezimal-Komma', () => {
  assert.equal(E.hoursText(0), '0,0 h');
  assert.equal(E.hoursText(4530000), '1,3 h');
  assert.equal(E.hoursText(-5), '0,0 h');
});

test('serviceDue: faellig ab Intervall, 0 = aus', () => {
  assert.equal(E.serviceDue(10 * 3600000, 0, 10), true);
  assert.equal(E.serviceDue(9.9 * 3600000, 0, 10), false);
  assert.equal(E.serviceDue(999 * 3600000, 0, 0), false);
  assert.equal(E.serviceDue(12 * 3600000, 5 * 3600000, 10), false);
});

test('sinceServiceMs: nie negativ', () => {
  assert.equal(E.sinceServiceMs(5, 10), 0);
  assert.equal(E.sinceServiceMs(20, 5), 15);
});
