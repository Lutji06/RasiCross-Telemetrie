import test from 'node:test';
import assert from 'node:assert/strict';
import LV from '../src/live-view.js';

const R = (o) => LV.liveViewAutoReducer(o);

test('exports the pure api', () => {
  assert.equal(typeof LV.liveViewAutoReducer, 'function');
  assert.ok(Object.isFrozen(LV.START_MODES));
  assert.deepEqual([...LV.START_MODES], ['auto', 'single', 'overview']);
});

test('Zwangs-Rueckfall: count<=1 in overview -> single, in single -> null (auch bei manual)', () => {
  assert.equal(R({ view: 'overview', prevCount: 2, count: 1, setting: 'auto', manual: false }), 'single');
  assert.equal(R({ view: 'overview', prevCount: 2, count: 0, setting: 'overview', manual: true }), 'single');
  assert.equal(R({ view: 'single', prevCount: 0, count: 1, setting: 'auto', manual: false }), null);
});

test('auto: Flanke <2 -> >=2 schaltet auf overview', () => {
  assert.equal(R({ view: 'single', prevCount: 1, count: 2, setting: 'auto', manual: false }), 'overview');
  assert.equal(R({ view: 'single', prevCount: 0, count: 3, setting: 'auto', manual: false }), 'overview');
});

test('auto: ohne Flanke keine Aenderung (2->3, 3->3, bereits overview)', () => {
  assert.equal(R({ view: 'single', prevCount: 2, count: 3, setting: 'auto', manual: false }), null);
  assert.equal(R({ view: 'single', prevCount: 3, count: 3, setting: 'auto', manual: false }), null);
  assert.equal(R({ view: 'overview', prevCount: 1, count: 2, setting: 'auto', manual: false }), null);
});

test('manual gewinnt: keine Automatik trotz Flanke/Pegel', () => {
  assert.equal(R({ view: 'single', prevCount: 1, count: 2, setting: 'auto', manual: true }), null);
  assert.equal(R({ view: 'single', prevCount: 2, count: 3, setting: 'overview', manual: true }), null);
});

test('single: nie automatisch', () => {
  assert.equal(R({ view: 'single', prevCount: 1, count: 2, setting: 'single', manual: false }), null);
  assert.equal(R({ view: 'single', prevCount: 0, count: 5, setting: 'single', manual: false }), null);
});

test('overview: pegel-getriggert — schaltet auch ohne Flanke aus single', () => {
  assert.equal(R({ view: 'single', prevCount: 2, count: 3, setting: 'overview', manual: false }), 'overview');
  assert.equal(R({ view: 'single', prevCount: 3, count: 3, setting: 'overview', manual: false }), 'overview');
});

test('overview: bereits overview -> null', () => {
  assert.equal(R({ view: 'overview', prevCount: 2, count: 3, setting: 'overview', manual: false }), null);
});

test('Junk-Eingaben werfen nie: ungueltiges setting -> auto-Semantik, ungueltige view/counts -> Defaults', () => {
  assert.equal(R({ view: 'single', prevCount: 1, count: 2, setting: 'kaputt', manual: false }), 'overview');
  assert.equal(R({ view: null, prevCount: NaN, count: 2, setting: 'auto', manual: false }), 'overview');
  assert.equal(R({ view: 'single', prevCount: 'x', count: 'y', setting: 'auto', manual: false }), null);
  assert.equal(R({}), null);
});
