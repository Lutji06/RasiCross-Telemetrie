'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const geo = require('../geo.js');

const approx = (a, b, tol = 1e-3) => assert.ok(Math.abs(a - b) <= tol, `${a} != ${b} (±${tol})`);

test('module exports all 9 helpers', () => {
  for (const name of ['fmtMs','fmtClock','fmtDelta','traceDistanceM','gpsDist',
                       'headingFromPoints','segmentsCross','crossingDirectionOk',
                       'lineEndpointsFromGate']) {
    assert.equal(typeof geo[name], 'function', `missing ${name}`);
  }
});

test('gpsDist', () => {
  // Pins the existing equirectangular ("flat-earth") approximation output,
  // NOT WGS-84 ground truth. Replacing the formula (e.g. with haversine) will
  // change these numbers by design — update the expected values if that happens.
  assert.equal(geo.gpsDist(0, 0, 0, 0), 0);
  approx(geo.gpsDist(0, 0, 0, 1), 111194.92664455873, 1e-3);
  approx(geo.gpsDist(0, 0, 1, 0), 111194.92664455873, 1e-3);
});

test('traceDistanceM', () => {
  assert.equal(geo.traceDistanceM(null), 0);
  assert.equal(geo.traceDistanceM([{lat:0,lon:0}]), 0);
  approx(geo.traceDistanceM([{lat:0,lon:0},{lat:0,lon:1}]), 111194.92664455873, 1e-3);
  approx(geo.traceDistanceM([{lat:0,lon:0},{lat:null,lon:1},{lat:0,lon:1}]), 0, 1e-9);
});

test('headingFromPoints (degrees, 0=north, cw)', () => {
  assert.equal(geo.headingFromPoints(null, {lat:1,lon:0}), 0);
  assert.equal(geo.headingFromPoints({lat:0,lon:0}, {lat:1,lon:0}), 0);
  assert.equal(geo.headingFromPoints({lat:0,lon:0}, {lat:0,lon:1}), 90);
  assert.equal(geo.headingFromPoints({lat:0,lon:0}, {lat:-1,lon:0}), 180);
  assert.equal(geo.headingFromPoints({lat:0,lon:0}, {lat:0,lon:-1}), 270);
});

test('segmentsCross', () => {
  const a1={lat:0,lon:-1}, a2={lat:0,lon:1}, b1={lat:-1,lon:0}, b2={lat:1,lon:0};
  assert.equal(geo.segmentsCross(a1,a2,b1,b2), true);
  assert.equal(geo.segmentsCross({lat:0,lon:0},{lat:0,lon:1},
                                  {lat:1,lon:0},{lat:1,lon:1}), false);
  assert.equal(geo.segmentsCross({lat:0,lon:0},{lat:0,lon:0.4},
                                  {lat:-1,lon:0.6},{lat:1,lon:0.6}), false);
  // touching endpoint (t=1,u=0) is inclusive → true (pinned current behavior)
  assert.equal(geo.segmentsCross({lat:0,lon:0},{lat:0,lon:1},
                                  {lat:0,lon:1},{lat:1,lon:1}), true);
  // collinear overlapping segments → d≈0 short-circuit → false (pinned)
  assert.equal(geo.segmentsCross({lat:0,lon:0},{lat:0,lon:2},
                                  {lat:0,lon:1},{lat:0,lon:3}), false);
});

test('crossingDirectionOk', () => {
  assert.equal(geo.crossingDirectionOk(0,0,1,0,null), true);
  assert.equal(geo.crossingDirectionOk(0,0,1,0,0),   true);
  assert.equal(geo.crossingDirectionOk(0,0,1,0,180), false);
  assert.equal(geo.crossingDirectionOk(0,0,1,0,80),  true);
  assert.equal(geo.crossingDirectionOk(0,0,1,0,95),  false);
  assert.equal(geo.crossingDirectionOk(0,0,1,0,90), false); // exact 90° boundary: diff<90 is false (pinned)
});

test('lineEndpointsFromGate', () => {
  assert.equal(geo.lineEndpointsFromGate(null), null);
  // lat:0 is falsy in JS, so the `!gate.lat` guard returns null at the equator.
  // This pins a pre-existing quirk verbatim from rasicross.js (do not "fix" here).
  assert.equal(geo.lineEndpointsFromGate({lat:0,lon:5}), null);
  const ep = geo.lineEndpointsFromGate({lat:49.6, lon:6.12, width:14, heading:0});
  assert.ok(ep && ep.p1 && ep.p2);
  approx(ep.p1.lat, 49.6, 1e-4);
  approx(ep.p2.lat, 49.6, 1e-4);
  approx((ep.p1.lon + ep.p2.lon) / 2, 6.12, 1e-9);
  assert.ok(ep.p1.lon !== ep.p2.lon);
});

test('fmtMs', () => {
  assert.equal(geo.fmtMs(null), '--:--.---');
  assert.equal(geo.fmtMs(Infinity), '--:--.---');
  assert.equal(geo.fmtMs(0), '0:00.000');
  assert.equal(geo.fmtMs(61234), '1:01.234');
  assert.equal(geo.fmtMs(-1500), '-0:01.500');
});

test('fmtClock', () => {
  assert.equal(geo.fmtClock(null), '--:--');
  assert.equal(geo.fmtClock(0), '00:00');
  assert.equal(geo.fmtClock(61000), '01:01');
  assert.equal(geo.fmtClock(3661000), '1:01:01');
  assert.equal(geo.fmtClock(-1000), '00:00'); // clamped via Math.max(0,…)
});

test('fmtDelta', () => {
  assert.equal(geo.fmtDelta(null), '--');
  assert.equal(geo.fmtDelta(0), '+0.000s');
  assert.equal(geo.fmtDelta(1234), '+1.234s');
  assert.equal(geo.fmtDelta(-1234), '-1.234s');
  assert.equal(geo.fmtDelta(NaN), 'NaNs');    // NaN bypasses the == null guard (pinned)
});

test('structuralRaceKey: stable when only the running clock ticks', () => {
  const base = {
    type: 'display', driver: 'Alex', num: '7', lapn: 4, target: 10,
    sectors: ['done', 'current', 'open'], best_lap: '1:23.456',
    live_delta_ref: 3, length_type: 'laps', page: 'auto',
    running: true, lap: '0:42.123', lap_ms: 42123,
    elapsed_ms: 200000, remaining_ms: null, live_delta: -250,
  };
  const k1 = geo.structuralRaceKey(base);
  const k2 = geo.structuralRaceKey({
    ...base, lap: '0:42.456', lap_ms: 42456,
    elapsed_ms: 200333, live_delta: -240,
  });
  assert.equal(k1, k2);
});

test('structuralRaceKey: changes on each structural field', () => {
  const base = {
    driver: 'A', num: '1', lapn: 1, target: 5, sectors: ['open','open','open'],
    best_lap: '--', live_delta_ref: null, length_type: 'free',
    page: 'auto', running: false, pit: false,
  };
  const k0 = geo.structuralRaceKey(base);
  const tweaks = [
    { driver: 'B' }, { num: '2' }, { lapn: 2 }, { target: 6 },
    { sectors: ['done','open','open'] }, { best_lap: '1:00.000' },
    { live_delta_ref: 4 }, { length_type: 'time' }, { page: 'race' },
    { running: true }, { pit: true },
  ];
  for (const t of tweaks) {
    assert.notEqual(geo.structuralRaceKey({ ...base, ...t }), k0,
      'expected change for ' + Object.keys(t)[0]);
  }
});

test('structuralRaceKey: null/undefined/empty are stable', () => {
  assert.equal(geo.structuralRaceKey(null), geo.structuralRaceKey(undefined));
  assert.equal(geo.structuralRaceKey({}), geo.structuralRaceKey(null));
});

test('structuralRaceKey: excludes live-ticking + delta fields', () => {
  const base = { driver: 'A', sectors: ['open','open','open'] };
  const k0 = geo.structuralRaceKey(base);
  for (const f of ['lap', 'lap_ms', 'elapsed_ms', 'remaining_ms',
                   'live_delta', 'live_delta_ms']) {
    assert.equal(geo.structuralRaceKey({ ...base, [f]: 12345 }), k0,
      'expected stable across ' + f);
  }
});
