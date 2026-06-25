'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../lap-engine.js');

test('module exports all helpers', () => {
  for (const name of ['migrateRace','participantsOf','getOrCreatePart','flatLaps',
                      'flatValidLaps','flatStints','partValidLaps','bestFromLaps',
                      'commitLap','sectorBestUpdate','trackRecordFromKarts',
                      'rankParticipants','leaderReachedTarget','fastestLapHolder',
                      'positionGains','applyDriverChange']) {
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

test('rankParticipants adds interval to the car directly ahead', () => {
  const r = { participants: {
    AA: { mac: 'AA', laps: [{ valid: true }] },
    BB: { mac: 'BB', laps: [{ valid: true }] },
    CC: { mac: 'CC', laps: [{ valid: true }] },
  } };
  const ranked = E.rankParticipants(r, { AA: 1000, BB: 1300, CC: 1500 });
  assert.equal(ranked[0].mac, 'AA');
  assert.equal(ranked[0].intervalMs, 0);
  assert.equal(ranked[0].intervalLapGap, 0);
  assert.equal(ranked[1].mac, 'BB');
  assert.equal(ranked[1].timeGapMs, 300);     // gap to leader
  assert.equal(ranked[1].intervalMs, 300);    // interval to ahead (== leader for P2)
  assert.equal(ranked[2].mac, 'CC');
  assert.equal(ranked[2].timeGapMs, 500);     // gap to leader (1500-1000)
  assert.equal(ranked[2].intervalMs, 200);    // interval to ahead BB (1500-1300)
});

test('rankParticipants interval shows lap gap when car ahead is on another lap', () => {
  const r = { participants: {
    AA: { mac: 'AA', laps: [{ valid: true }, { valid: true }, { valid: true }] },
    BB: { mac: 'BB', laps: [{ valid: true }, { valid: true }] },
    CC: { mac: 'CC', laps: [{ valid: true }] },
  } };
  const ranked = E.rankParticipants(r, { AA: 1000, BB: 1100, CC: 1200 });
  assert.equal(ranked[1].mac, 'BB');
  assert.equal(ranked[1].intervalLapGap, 1);  // 1 lap behind AA
  assert.equal(ranked[1].intervalMs, 0);
  assert.equal(ranked[2].mac, 'CC');
  assert.equal(ranked[2].intervalLapGap, 1);  // 1 lap behind BB
  assert.equal(ranked[2].lapGap, 2);          // 2 laps behind leader
});

test('fastestLapHolder returns participant with smallest bestLapMs', () => {
  const r = { participants: {
    AA: { mac: 'AA', bestLapMs: 30000, bestLapNum: 2 },
    BB: { mac: 'BB', bestLapMs: 28000, bestLapNum: 3 },
    CC: { mac: 'CC', bestLapMs: null, bestLapNum: null },
  } };
  const h = E.fastestLapHolder(r);
  assert.equal(h.mac, 'BB');
  assert.equal(h.ms, 28000);
  assert.equal(h.num, 3);
});

test('fastestLapHolder returns null when no participant has a best lap', () => {
  const r = { participants: {
    AA: { mac: 'AA', bestLapMs: null },
    BB: { mac: 'BB', bestLapMs: null },
  } };
  assert.equal(E.fastestLapHolder(r), null);
});

test('fastestLapHolder tie resolves to first participant', () => {
  const r = { participants: {
    AA: { mac: 'AA', bestLapMs: 25000, bestLapNum: 1 },
    BB: { mac: 'BB', bestLapMs: 25000, bestLapNum: 2 },
  } };
  assert.equal(E.fastestLapHolder(r).mac, 'AA');
});

test('positionGains returns macs that moved up', () => {
  const prev = { AA: 1, BB: 2, CC: 3 };
  const ranked = [{ mac: 'CC', pos: 1 }, { mac: 'AA', pos: 2 }, { mac: 'BB', pos: 3 }];
  assert.deepEqual(E.positionGains(prev, ranked), ['CC']);
});

test('positionGains ignores unchanged positions, detects a swap winner only', () => {
  const prev = { AA: 1, BB: 2 };
  assert.deepEqual(E.positionGains(prev, [{ mac: 'AA', pos: 1 }, { mac: 'BB', pos: 2 }]), []);
  // BB up 2->1, AA down 1->2 (drop ignored)
  assert.deepEqual(E.positionGains(prev, [{ mac: 'BB', pos: 1 }, { mac: 'AA', pos: 2 }]), ['BB']);
});

test('positionGains ignores new entrants without a previous position', () => {
  const prev = { AA: 1 };
  // BB has no prev -> ignored; AA dropped -> ignored
  assert.deepEqual(E.positionGains(prev, [{ mac: 'BB', pos: 1 }, { mac: 'AA', pos: 2 }]), []);
});

test('positionGains detects multiple simultaneous gainers', () => {
  const prev = { AA: 1, BB: 2, CC: 3, DD: 4 };
  const ranked = [{ mac: 'CC', pos: 1 }, { mac: 'DD', pos: 2 },
                  { mac: 'AA', pos: 3 }, { mac: 'BB', pos: 4 }];
  assert.deepEqual(E.positionGains(prev, ranked), ['CC', 'DD']);
});

test('positionGains with empty prev (first ranking) yields no gains', () => {
  assert.deepEqual(E.positionGains({}, [{ mac: 'AA', pos: 1 }, { mac: 'BB', pos: 2 }]), []);
});

test('applyDriverChange closes open stint and opens a new one', () => {
  const part = { currentDriverId: 'd1',
    stints: [{ id: 's1', driverId: 'd1', startAt: 100, endAt: null }] };
  const st = E.applyDriverChange(part, 'd2', 500);
  assert.equal(part.stints[0].endAt, 500);
  assert.equal(part.currentDriverId, 'd2');
  assert.equal(part.stints.length, 2);
  assert.equal(st.driverId, 'd2');
  assert.equal(st.startAt, 500);
  assert.equal(st.endAt, null);
  assert.equal(part.stints[1], st);
});

test('applyDriverChange on empty stints just opens a stint', () => {
  const part = { currentDriverId: null, stints: [] };
  const st = E.applyDriverChange(part, 'd1', 200);
  assert.equal(part.stints.length, 1);
  assert.equal(part.currentDriverId, 'd1');
  assert.equal(st.driverId, 'd1');
});

test('applyDriverChange does not re-close an already closed last stint', () => {
  const part = { currentDriverId: 'd1',
    stints: [{ id: 's1', driverId: 'd1', startAt: 100, endAt: 300 }] };
  E.applyDriverChange(part, 'd2', 500);
  assert.equal(part.stints[0].endAt, 300);
  assert.equal(part.stints.length, 2);
});

test('applyDriverChange creates a stint without an id (caller assigns)', () => {
  const part = { currentDriverId: 'd1', stints: [] };
  const st = E.applyDriverChange(part, 'd2', 10);
  assert.equal(st.id, undefined);
});
