'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const T = require('../tiles.js');

test('lonToGlobalX: longitude 180 maps to right edge of pyramid at z=18', () => {
  const size = 256 * Math.pow(2, 18);
  assert.equal(T.lonToGlobalX(180, 18), size);
  assert.equal(T.lonToGlobalX(-180, 18), 0);
  assert.equal(T.lonToGlobalX(0, 18), size / 2);
});

test('latToGlobalY: latitude 0 maps to middle of pyramid at z=18', () => {
  const size = 256 * Math.pow(2, 18);
  const mid = T.latToGlobalY(0, 18);
  assert.ok(Math.abs(mid - size / 2) < 1e-6);
  assert.ok(T.latToGlobalY(50, 18) < mid);
  assert.ok(T.latToGlobalY(-50, 18) > mid);
});

test('round-trip: globalXToLon(lonToGlobalX(lon)) ≈ lon', () => {
  for (const lon of [-179.9, -90, -11.5, 0, 11.5, 90, 179.9]) {
    const back = T.globalXToLon(T.lonToGlobalX(lon, 17), 17);
    assert.ok(Math.abs(back - lon) < 1e-9, `lon=${lon} got ${back}`);
  }
});

test('round-trip: globalYToLat(latToGlobalY(lat)) ≈ lat', () => {
  for (const lat of [-80, -50, -11.5, 0, 11.5, 50, 80]) {
    const back = T.globalYToLat(T.latToGlobalY(lat, 17), 17);
    assert.ok(Math.abs(back - lat) < 1e-9, `lat=${lat} got ${back}`);
  }
});

test('tilesForBbox: small Munich bbox at z=17 returns ≥1 tile', () => {
  const bbox = { minLat: 48.135, maxLat: 48.137, minLon: 11.580, maxLon: 11.582 };
  const tiles = T.tilesForBbox(bbox, 17, 0);
  assert.ok(tiles.length >= 1 && tiles.length <= 4, `got ${tiles.length}`);
  for (const t of tiles) {
    assert.equal(t.z, 17);
    assert.ok(Number.isInteger(t.x) && t.x >= 0);
    assert.ok(Number.isInteger(t.y) && t.y >= 0);
  }
});

test('tilesForBbox: padTiles=1 adds a one-tile ring around the inner set', () => {
  const bbox = { minLat: 48.135, maxLat: 48.137, minLon: 11.580, maxLon: 11.582 };
  const inner = T.tilesForBbox(bbox, 17, 0).length;
  const padded = T.tilesForBbox(bbox, 17, 1).length;
  const expected = { 1: 9, 2: 12, 4: 16 };
  assert.equal(padded, expected[inner], `inner=${inner} padded=${padded}`);
});

test('pickZoom: 200 m × 150 m bbox in a 1000 × 600 canvas falls in [16..18]', () => {
  const dLat = 150 / 111_000;
  const dLon = 200 / 71_300;
  const bbox = { minLat: 50, maxLat: 50 + dLat, minLon: 11, maxLon: 11 + dLon };
  const z = T.pickZoom(bbox, 1000, 600, 32, 16, 18);
  assert.ok(z >= 16 && z <= 18, `picked z=${z}`);
});

test('bboxToCanvasTransform: project corner points to canvas corners', () => {
  const bbox = { minLat: 48.135, maxLat: 48.137, minLon: 11.580, maxLon: 11.582 };
  const z = 18, W = 800, H = 600, pad = 32;
  const tr = T.bboxToCanvasTransform(bbox, z, W, H, pad);
  const gxSW = T.lonToGlobalX(bbox.minLon, z);
  const gySW = T.latToGlobalY(bbox.minLat, z);
  const gxBase = T.lonToGlobalX(bbox.minLon, z);
  const gyBase = T.latToGlobalY(bbox.maxLat, z);
  const xSW = tr.ox + (gxSW - gxBase) * tr.sc;
  const ySW = tr.oy + (gySW - gyBase) * tr.sc;
  assert.ok(Math.abs(xSW - tr.ox) < 1e-6, `xSW=${xSW} ox=${tr.ox}`);
  const dyBbox = T.latToGlobalY(bbox.minLat, z) - T.latToGlobalY(bbox.maxLat, z);
  assert.ok(Math.abs(ySW - (tr.oy + dyBbox * tr.sc)) < 1e-6);
});
