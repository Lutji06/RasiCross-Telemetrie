'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { targetIdsFor, SHARED_ID_MAP } = require('../dom-targets.js');

test('targetIdsFor: unknown key returns empty array', () => {
  assert.deepEqual(targetIdsFor('nope'), []);
});

test('targetIdsFor: speed fans out to Detail + Live IDs', () => {
  assert.deepEqual(targetIdsFor('speed'), ['kSpeed', 'kSpeedLive']);
});

test('targetIdsFor: rpm fans out to Detail + Live IDs', () => {
  assert.deepEqual(targetIdsFor('rpm'), ['kRpm', 'kRpmLive']);
});

test('targetIdsFor: speedMax / rpmMax / spdSrc each fan out to both tabs', () => {
  assert.deepEqual(targetIdsFor('speedMax'), ['kSpeedMax', 'kSpeedMaxLive']);
  assert.deepEqual(targetIdsFor('rpmMax'), ['kRpmMax', 'kRpmMaxLive']);
  assert.deepEqual(targetIdsFor('spdSrc'), ['spdSrcTag', 'spdSrcTagLive']);
});

test('targetIdsFor: lap fans out to Detail KPI + Live big card + Detail hero chip', () => {
  assert.deepEqual(targetIdsFor('lap'), ['kLap', 'liveLapBig', 'detailHeroLapCurrent']);
});

test('targetIdsFor: lapBest fans out to Detail KPI + Live sub + Detail hero chip', () => {
  assert.deepEqual(targetIdsFor('lapBest'), ['kLapBest', 'liveLapBest', 'detailHeroLapBest']);
});

test('SHARED_ID_MAP is a frozen plain object with string-array values', () => {
  assert.equal(typeof SHARED_ID_MAP, 'object');
  assert.equal(Object.isFrozen(SHARED_ID_MAP), true);
  for (const [k, v] of Object.entries(SHARED_ID_MAP)) {
    assert.equal(typeof k, 'string');
    assert.ok(Array.isArray(v) && v.length > 0, `${k} must be a non-empty array`);
    for (const id of v) assert.equal(typeof id, 'string');
  }
});
