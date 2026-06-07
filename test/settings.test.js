'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { GROUPS, settingsNavReducer } = require('../settings.js');

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
