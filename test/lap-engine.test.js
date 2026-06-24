'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../lap-engine.js');

test('module exports all helpers', () => {
  for (const name of ['migrateRace','participantsOf','getOrCreatePart','flatLaps',
                      'flatValidLaps','flatStints','partValidLaps','bestFromLaps',
                      'commitLap','sectorBestUpdate','trackRecordFromKarts',
                      'rankParticipants','leaderReachedTarget']) {
    assert.equal(typeof E[name], 'function', `missing ${name}`);
  }
});

test('migrateRace wraps legacy laps/stints into participants[kartMac]', () => {
  const r = { kartMac: 'AA', startDriverId: 'd1', currentDriverId: 'd2',
    laps: [{ number: 1, timeMs: 30000, valid: true }],
    stints: [{ id: 's1', driverId: 'd1', startAt: 1, endAt: 2 }],
    speedTrace: [{ t: 0, speed: 10 }], startedAt: 111 };
  E.migrateRace(r, 'default');
  const p = r.participants.AA;
  assert.equal(p.mac, 'AA');
  assert.equal(p.currentDriverId, 'd2');
  assert.equal(p.laps.length, 1);
  assert.equal(p.stints.length, 1);
  assert.equal(p.speedTrace.length, 1);
  assert.equal(p.joinedAt, 111);
});

test('migrateRace falls back to defaultMac when no kartMac', () => {
  const r = { laps: [], stints: [] };
  E.migrateRace(r, 'default');
  assert.ok(r.participants.default);
});

test('migrateRace is idempotent (no double-wrap)', () => {
  const r = { kartMac: 'AA', laps: [{ number: 1, timeMs: 1, valid: true }], stints: [] };
  E.migrateRace(r, 'default');
  const first = r.participants.AA;
  E.migrateRace(r, 'default');
  assert.equal(r.participants.AA, first, 'participant object replaced on 2nd call');
  assert.equal(r.participants.AA.laps.length, 1);
});

test('getOrCreatePart creates then returns same slot', () => {
  const r = { participants: {} };
  const p1 = E.getOrCreatePart(r, 'BB', 'drv', 500);
  assert.equal(p1.mac, 'BB');
  assert.equal(p1.currentDriverId, 'drv');
  assert.equal(p1.joinedAt, 500);
  const p2 = E.getOrCreatePart(r, 'BB', 'other', 999);
  assert.equal(p2, p1, 'should reuse existing slot');
  assert.equal(p2.currentDriverId, 'drv', 'must not overwrite driver');
});

test('commitLap appends per-participant lap with kartMac + per-kart number', () => {
  const part = { mac: 'AA', laps: [], bestLapMs: null, bestLapNum: null, currentDriverId: 'd1' };
  const res = E.commitLap(part, { now: 40000, lapStart: 10000, minLapMs: 10000,
    driverId: 'd1', kartMac: 'AA', maxSpeed: 55, maxRpm: 8000, distanceM: 400,
    sectors: [10000, 10000, 10000] });
  assert.equal(part.laps.length, 1);
  assert.equal(res.lap.number, 1);
  assert.equal(res.lap.timeMs, 30000);
  assert.equal(res.lap.kartMac, 'AA');
  assert.equal(res.lap.valid, true);
  assert.equal(res.isBest, true);
  assert.equal(part.bestLapMs, 30000);
  assert.equal(part.bestLapNum, 1);
});

test('commitLap second slower lap is not best; number increments', () => {
  const part = { mac: 'AA', laps: [], bestLapMs: null, bestLapNum: null };
  E.commitLap(part, { now: 30000, lapStart: 0, minLapMs: 10000, kartMac: 'AA',
    sectors: [] });
  const res = E.commitLap(part, { now: 70000, lapStart: 30000, minLapMs: 10000,
    kartMac: 'AA', sectors: [] });
  assert.equal(res.lap.number, 2);
  assert.equal(res.isBest, false);
  assert.equal(part.bestLapNum, 1);
});

test('partValidLaps / flatValidLaps count only valid', () => {
  const r = { participants: {
    AA: { mac: 'AA', laps: [{ valid: true }, { valid: false }] },
    BB: { mac: 'BB', laps: [{ valid: true }] },
  } };
  assert.equal(E.partValidLaps(r.participants.AA).length, 1);
  assert.equal(E.flatLaps(r).length, 3);
  assert.equal(E.flatValidLaps(r).length, 2);
});

test('bestFromLaps returns fastest valid lap + number', () => {
  const b = E.bestFromLaps([{ number: 1, timeMs: 30000, valid: true },
                            { number: 2, timeMs: 25000, valid: true },
                            { number: 3, timeMs: 20000, valid: false }]);
  assert.equal(b.ms, 25000);
  assert.equal(b.num, 2);
});

test('sectorBestUpdate returns true and stores on improvement only', () => {
  const sb = [null, null, null];
  assert.equal(E.sectorBestUpdate(sb, 0, 12000), true);
  assert.equal(sb[0], 12000);
  assert.equal(E.sectorBestUpdate(sb, 0, 13000), false);
  assert.equal(sb[0], 12000);
  assert.equal(E.sectorBestUpdate(sb, 0, 11000), true);
  assert.equal(sb[0], 11000);
});

test('trackRecordFromKarts takes min per sector, ignoring null', () => {
  const rec = E.trackRecordFromKarts([[12000, null, 9000], [11000, 8000, null]]);
  assert.deepEqual(rec, [11000, 8000, 9000]);
});

test('flatStints merges all participant stints', () => {
  const r = { participants: {
    AA: { stints: [{ id: 'a' }] }, BB: { stints: [{ id: 'b' }, { id: 'c' }] } } };
  assert.equal(E.flatStints(r).length, 3);
});

test('commitLap marks a lap shorter than minLapMs invalid', () => {
  const part = { mac: 'AA', laps: [], bestLapMs: null, bestLapNum: null };
  const res = E.commitLap(part, { now: 5000, lapStart: 0, minLapMs: 10000,
    kartMac: 'AA', sectors: [] });
  assert.equal(res.lap.valid, false);
});

test('rankParticipants orders by valid laps desc with positions', () => {
  const r = { participants: {
    AA: { mac: 'AA', laps: [{ valid: true }, { valid: true }] },
    BB: { mac: 'BB', laps: [{ valid: true }, { valid: true }, { valid: true }] },
  } };
  const ranked = E.rankParticipants(r, { AA: 1000, BB: 1200 });
  assert.equal(ranked[0].mac, 'BB');
  assert.equal(ranked[0].pos, 1);
  assert.equal(ranked[0].laps, 3);
  assert.equal(ranked[1].mac, 'AA');
  assert.equal(ranked[1].pos, 2);
  assert.equal(ranked[1].lapGap, 1);
});

test('rankParticipants tiebreak: earliest last crossing leads on equal laps', () => {
  const r = { participants: {
    AA: { mac: 'AA', laps: [{ valid: true }, { valid: true }] },
    BB: { mac: 'BB', laps: [{ valid: true }, { valid: true }] },
  } };
  const ranked = E.rankParticipants(r, { AA: 5200, BB: 5000 });
  assert.equal(ranked[0].mac, 'BB');
  assert.equal(ranked[0].timeGapMs, 0);
  assert.equal(ranked[1].mac, 'AA');
  assert.equal(ranked[1].lapGap, 0);
  assert.equal(ranked[1].timeGapMs, 200);
});

test('rankParticipants unarmed karts sort last, stable order', () => {
  const r = { participants: {
    AA: { mac: 'AA', laps: [] },
    BB: { mac: 'BB', laps: [{ valid: true }] },
    CC: { mac: 'CC', laps: [] },
  } };
  const ranked = E.rankParticipants(r, { BB: 3000 });
  assert.equal(ranked[0].mac, 'BB');
  assert.equal(ranked[1].mac, 'AA');
  assert.equal(ranked[2].mac, 'CC');
});

test('rankParticipants armed-with-zero-laps beats never-crossed', () => {
  const r = { participants: {
    AA: { mac: 'AA', laps: [] },
    BB: { mac: 'BB', laps: [] },
  } };
  const ranked = E.rankParticipants(r, { AA: 8000 });
  assert.equal(ranked[0].mac, 'AA');
  assert.equal(ranked[1].mac, 'BB');
});

test('rankParticipants lapped kart shows lap gap, not time gap', () => {
  const r = { participants: {
    AA: { mac: 'AA', laps: [{ valid: true }, { valid: true }, { valid: true }] },
    BB: { mac: 'BB', laps: [{ valid: true }] },
  } };
  const ranked = E.rankParticipants(r, { AA: 1000, BB: 1500 });
  assert.equal(ranked[0].mac, 'AA');
  assert.equal(ranked[1].lapGap, 2);
  assert.equal(ranked[1].timeGapMs, 0);
});

test('rankParticipants empty participants returns []', () => {
  assert.deepEqual(E.rankParticipants({ participants: {} }, {}), []);
});

test('leaderReachedTarget true once leader reaches target laps', () => {
  const ranked = [{ mac: 'AA', pos: 1, laps: 5 }, { mac: 'BB', pos: 2, laps: 3 }];
  assert.equal(E.leaderReachedTarget(ranked, 5), true);
  assert.equal(E.leaderReachedTarget(ranked, 6), false);
  assert.equal(E.leaderReachedTarget([], 5), false);
});
