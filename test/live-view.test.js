import test from 'node:test';
import assert from 'node:assert/strict';
import LV from '../src/live-view.js';

const M3 = ['a', 'b', 'c'];
const P = (o) => LV.resolvePage(o);

test('exports the pure api', () => {
  assert.equal(typeof LV.resolvePage, 'function');
});

test('Seite 0 ist die Uebersicht, 1..n je ein Kart', () => {
  assert.deepEqual(P({ macs: M3, page: 0 }), { page: 0, view: 'overview', mac: null });
  assert.deepEqual(P({ macs: M3, page: 1 }), { page: 1, view: 'single', mac: 'a' });
  assert.deepEqual(P({ macs: M3, page: 3 }), { page: 3, view: 'single', mac: 'c' });
});

test('ein einziges Kart hat keine Uebersicht', () => {
  assert.deepEqual(P({ macs: ['a'], page: 0 }), { page: 1, view: 'single', mac: 'a' });
  assert.deepEqual(P({ macs: ['a'], page: 1 }), { page: 1, view: 'single', mac: 'a' });
});

test('gar kein Kart: keine Seite, kein mac', () => {
  assert.deepEqual(P({ macs: [], page: 0 }), { page: 1, view: 'single', mac: null });
});

test('Seiten ausserhalb des Bereichs werden geklemmt', () => {
  assert.equal(P({ macs: M3, page: 9 }).page, 3);
  assert.equal(P({ macs: M3, page: -4 }).page, 0);
});

test('wantMac gewinnt und waehlt dessen Seite', () => {
  assert.deepEqual(P({ macs: M3, page: 0, wantMac: 'b' }), { page: 2, view: 'single', mac: 'b' });
});

test('verschwundenes wantMac faellt auf die Uebersicht zurueck', () => {
  assert.deepEqual(P({ macs: M3, page: 2, wantMac: 'weg' }), { page: 0, view: 'overview', mac: null });
});

test('verschwundenes wantMac bei einem Kart landet auf dessen Seite', () => {
  assert.deepEqual(P({ macs: ['a'], page: 1, wantMac: 'weg' }), { page: 1, view: 'single', mac: 'a' });
});

test('ein neues Kart aendert die aktuelle Seite nicht', () => {
  const vorher = P({ macs: ['a', 'b'], page: 2 });
  const nachher = P({ macs: ['a', 'b', 'c'], page: vorher.page });
  assert.equal(nachher.page, 2);
  assert.equal(nachher.mac, 'b');
});

test('Junk-Eingaben werfen nie', () => {
  assert.doesNotThrow(() => P({}));
  assert.doesNotThrow(() => P(null));
  assert.doesNotThrow(() => P({ macs: 'keinArray', page: NaN, wantMac: 7 }));
  assert.deepEqual(P(null), { page: 1, view: 'single', mac: null });
  assert.equal(P({ macs: M3, page: NaN }).page, 0);
});
