'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { GROUPS, settingsNavReducer, SETTINGS_INDEX, settingsFilter } = require('../settings.js');

test('GROUPS: frozen, sechs bekannte Gruppen, dashboard zuerst', () => {
  assert.equal(Object.isFrozen(GROUPS), true);
  assert.deepEqual(GROUPS, ['dashboard', 'sensorik', 'hardware', 'model3d', 'map', 'data']);
});

test('settingsNavReducer: set wechselt auf gueltige Gruppe', () => {
  assert.equal(settingsNavReducer('dashboard', { type: 'set', id: 'hardware' }), 'hardware');
});

test('settingsNavReducer: set auf unbekannte id -> bleibt bei current', () => {
  assert.equal(settingsNavReducer('map', { type: 'set', id: 'nope' }), 'map');
});

test('settingsNavReducer: ungueltige current -> faellt auf dashboard', () => {
  assert.equal(settingsNavReducer('quatsch', { type: 'noop' }), 'dashboard');
  assert.equal(settingsNavReducer(undefined, { type: 'noop' }), 'dashboard');
});

test('settingsNavReducer: unbekannte action -> identity (geklemmt)', () => {
  assert.equal(settingsNavReducer('sensorik', { type: 'wat' }), 'sensorik');
  assert.equal(settingsNavReducer('sensorik', null), 'sensorik');
});

test('SETTINGS_INDEX: nicht-leer, jede Gruppe gueltig, Felder vorhanden', () => {
  assert.ok(Array.isArray(SETTINGS_INDEX) && SETTINGS_INDEX.length > 0);
  for (const e of SETTINGS_INDEX) {
    assert.ok(GROUPS.includes(e.group), `unbekannte group: ${e.group}`);
    assert.equal(typeof e.rowId, 'string');
    assert.equal(typeof e.label, 'string');
    assert.ok(Array.isArray(e.keywords));
  }
});

test('settingsFilter: leerer Query -> alle Gruppen & Zeilen sichtbar', () => {
  const r = settingsFilter('', SETTINGS_INDEX);
  assert.equal(r.rows.size, SETTINGS_INDEX.length);
  assert.equal(r.groups.size, new Set(SETTINGS_INDEX.map(e => e.group)).size);
});

test('settingsFilter: Treffer per Label', () => {
  const r = settingsFilter('Max Speed', SETTINGS_INDEX);
  assert.ok(r.rows.has('setMaxSpeed'));
  assert.ok(r.groups.has('dashboard'));
});

test('settingsFilter: Treffer per Keyword (Synonym)', () => {
  const r = settingsFilter('akku', SETTINGS_INDEX);
  assert.ok(r.rows.has('espBattCells'));
  assert.ok(r.groups.has('hardware'));
});

test('settingsFilter: case- und diakritik-tolerant', () => {
  const r = settingsFilter('UMKIPP', SETTINGS_INDEX);
  assert.ok(r.rows.has('setRolloverAngle'));
});

test('settingsFilter: kein Treffer -> leere Sets', () => {
  const r = settingsFilter('zzzznix', SETTINGS_INDEX);
  assert.equal(r.rows.size, 0);
  assert.equal(r.groups.size, 0);
});

test('SETTINGS_INDEX: jeder Eintrag ist eingefroren', () => {
  for (const e of SETTINGS_INDEX) {
    assert.equal(Object.isFrozen(e), true, `Eintrag ${e.rowId} muss frozen sein`);
  }
});
