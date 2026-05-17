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
});

test('crossingDirectionOk', () => {
  assert.equal(geo.crossingDirectionOk(0,0,1,0,null), true);
  assert.equal(geo.crossingDirectionOk(0,0,1,0,0),   true);
  assert.equal(geo.crossingDirectionOk(0,0,1,0,180), false);
  assert.equal(geo.crossingDirectionOk(0,0,1,0,80),  true);
  assert.equal(geo.crossingDirectionOk(0,0,1,0,95),  false);
});

test('lineEndpointsFromGate', () => {
  assert.equal(geo.lineEndpointsFromGate(null), null);
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
});

test('fmtDelta', () => {
  assert.equal(geo.fmtDelta(null), '--');
  assert.equal(geo.fmtDelta(0), '+0.000s');
  assert.equal(geo.fmtDelta(1234), '+1.234s');
  assert.equal(geo.fmtDelta(-1234), '-1.234s');
});
