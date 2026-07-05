'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const geo = require('../geo.js');

const approx = (a, b, tol = 1e-3) => assert.ok(Math.abs(a - b) <= tol, `${a} != ${b} (±${tol})`);

test('module exports all 12 helpers', () => {
  for (const name of ['fmtMs','fmtClock','fmtDelta','traceDistanceM','gpsDist',
                       'headingFromPoints','segmentsCross','crossingDirectionOk',
                       'lineEndpointsFromGate','declutterLabels',
                       'trackProgressM','lapProgressM']) {
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

test('ghostPointAt: leere/ungueltige Trace oder negative Zeit -> null', () => {
  assert.equal(geo.ghostPointAt(null, 0), null);
  assert.equal(geo.ghostPointAt([], 0), null);
  assert.equal(geo.ghostPointAt([{ t: 0, lat: 1, lon: 2 }], -5), null);
  assert.equal(geo.ghostPointAt([{ t: 0, lat: 1, lon: 2 }], NaN), null);
});

test('ghostPointAt: vor dem ersten Punkt -> erster Punkt; nach dem Ziel -> null', () => {
  const tr = [{ t: 100, lat: 1, lon: 2 }, { t: 200, lat: 3, lon: 4 }];
  assert.deepEqual(geo.ghostPointAt(tr, 0), { lat: 1, lon: 2 });
  assert.deepEqual(geo.ghostPointAt(tr, 100), { lat: 1, lon: 2 });
  assert.equal(geo.ghostPointAt(tr, 201), null);   // Ghost ist im Ziel
});

test('ghostPointAt: lineare Interpolation zwischen Stuetzpunkten', () => {
  const tr = [{ t: 0, lat: 0, lon: 0 }, { t: 1000, lat: 10, lon: 20 }];
  approx(geo.ghostPointAt(tr, 500).lat, 5);
  approx(geo.ghostPointAt(tr, 500).lon, 10);
  approx(geo.ghostPointAt(tr, 250).lat, 2.5);
  assert.deepEqual(geo.ghostPointAt(tr, 1000), { lat: 10, lon: 20 });
});

test('ghostPointAt: doppelte Zeitstempel (span 0) werfen nicht', () => {
  const tr = [{ t: 0, lat: 0, lon: 0 }, { t: 0, lat: 1, lon: 1 }, { t: 100, lat: 2, lon: 2 }];
  const p = geo.ghostPointAt(tr, 0);
  assert.ok(p && isFinite(p.lat) && isFinite(p.lon));
});

test('ghostPointAt: Binaersuche trifft auch in langen Traces', () => {
  const tr = [];
  for (let i = 0; i <= 1000; i++) tr.push({ t: i * 100, lat: i, lon: -i });
  approx(geo.ghostPointAt(tr, 55550).lat, 555.5);
  approx(geo.ghostPointAt(tr, 55550).lon, -555.5);
});

test('declutterLabels leaves non-colliding labels unchanged', () => {
  const pts = [{ x: 0, y: 0 }, { x: 0, y: 100 }];
  assert.deepEqual(geo.declutterLabels(pts, 12, 20), [0, 100]);
});

test('declutterLabels pushes y-near, x-near labels apart by minGapY', () => {
  const pts = [{ x: 0, y: 0 }, { x: 5, y: 4 }];   // dx=5<20, dy=4<12 -> collide
  assert.deepEqual(geo.declutterLabels(pts, 12, 20), [0, 12]);
});

test('declutterLabels does not move x-far labels even if y is near', () => {
  const pts = [{ x: 0, y: 0 }, { x: 100, y: 4 }]; // dx=100>=20 -> no collision
  assert.deepEqual(geo.declutterLabels(pts, 12, 20), [0, 4]);
});

test('declutterLabels stacks three near labels in y-order', () => {
  const pts = [{ x: 0, y: 0 }, { x: 2, y: 3 }, { x: 1, y: 6 }];
  assert.deepEqual(geo.declutterLabels(pts, 12, 20), [0, 12, 24]);
});

test('declutterLabels returns results in input order', () => {
  const pts = [{ x: 0, y: 10 }, { x: 1, y: 0 }]; // 2nd label is higher (y=0)
  const out = geo.declutterLabels(pts, 12, 20);
  assert.equal(out[1], 0);   // input index 1 (y=0) unchanged
  assert.equal(out[0], 12);  // input index 0 (y=10) pushed to 12
});

test('trackProgressM: midpoint of a straight segment is about half the length', () => {
  const track = [{ lat: 0, lon: 0 }, { lat: 0, lon: 0.01 }];
  const total = geo.traceDistanceM(track);
  approx(geo.trackProgressM({ lat: 0, lon: 0.005 }, track), total / 2, total * 0.02);
});

test('trackProgressM: a point before the start projects to ~0', () => {
  const track = [{ lat: 0, lon: 0 }, { lat: 0, lon: 0.01 }];
  approx(geo.trackProgressM({ lat: 0, lon: -0.005 }, track), 0, 1);
});

test('trackProgressM: a point past the end projects to ~full length', () => {
  const track = [{ lat: 0, lon: 0 }, { lat: 0, lon: 0.01 }];
  const total = geo.traceDistanceM(track);
  approx(geo.trackProgressM({ lat: 0, lon: 0.015 }, track), total, 1);
});

test('trackProgressM: picks the nearest of multiple segments', () => {
  // L-shape: east along lon, then north along lat. Point near the 2nd segment.
  const track = [{ lat: 0, lon: 0 }, { lat: 0, lon: 0.01 }, { lat: 0.01, lon: 0.01 }];
  const seg1 = geo.gpsDist(0, 0, 0, 0.01);
  assert.ok(geo.trackProgressM({ lat: 0.005, lon: 0.0101 }, track) > seg1);
});

test('trackProgressM: fewer than two points returns 0', () => {
  assert.equal(geo.trackProgressM({ lat: 0, lon: 0 }, [{ lat: 0, lon: 0 }]), 0);
  assert.equal(geo.trackProgressM({ lat: 0, lon: 0 }, []), 0);
});

test('lapProgressM: normalizes raw progress relative to the gate, modulo length', () => {
  assert.equal(geo.lapProgressM(250, 200, 1000), 50);
  assert.equal(geo.lapProgressM(150, 200, 1000), 950);   // wraps: 150-200 -> 950
  assert.equal(geo.lapProgressM(200, 200, 1000), 0);      // at the gate
});

test('lapProgressM: returns null when track length is non-positive', () => {
  assert.equal(geo.lapProgressM(100, 0, 0), null);
});

test('nearestTraceDelta: Delta zum raeumlich naechsten Best-Trace-Punkt', () => {
  const best = [
    { t: 1000, lat: 49.0000, lon: 6.0000 },
    { t: 2000, lat: 49.0001, lon: 6.0001 },
    { t: 3000, lat: 49.0002, lon: 6.0002 },
    { t: 4000, lat: 49.0003, lon: 6.0003 },
    { t: 5000, lat: 49.0004, lon: 6.0004 },
  ];
  // Aktuelle Position exakt auf Punkt t=3000, aktuelle Rundenzeit 3500 -> +500
  assert.equal(geo.nearestTraceDelta(best, { t: 3500, lat: 49.0002, lon: 6.0002 }), 500);
  // Schneller unterwegs: t=2500 an derselben Stelle -> -500
  assert.equal(geo.nearestTraceDelta(best, { t: 2500, lat: 49.0002, lon: 6.0002 }), -500);
});

test('nearestTraceDelta: null bei kurzer Trace oder fehlender Position', () => {
  const short = [
    { t: 1, lat: 49, lon: 6 }, { t: 2, lat: 49, lon: 6 },
    { t: 3, lat: 49, lon: 6 }, { t: 4, lat: 49, lon: 6 },
  ];
  assert.equal(geo.nearestTraceDelta(short, { t: 5, lat: 49, lon: 6 }), null);
  assert.equal(geo.nearestTraceDelta(null, { t: 5, lat: 49, lon: 6 }), null);
  const ok = short.concat([{ t: 5, lat: 49, lon: 6 }]);
  assert.equal(geo.nearestTraceDelta(ok, null), null);
  // lat/lon 0 gilt wie in der alten Inline-Pruefung (!cur.lat) als ungueltig
  assert.equal(geo.nearestTraceDelta(ok, { t: 5, lat: 0, lon: 6 }), null);
  assert.equal(geo.nearestTraceDelta(ok, { lat: 49, lon: 6 }), null);
});
