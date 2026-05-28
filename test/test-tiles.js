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

test('pickZoom: picks the largest zoom in [zMin, zMax] that still fits', () => {
  // 200 m x 150 m bbox at lat 50°. 1° lat ≈ 111 km;  1° lon ≈ 111 km * cos(50°) ≈ 71.3 km.
  const dLat = 150 / 111_000;
  const dLon = 200 / 71_300;
  const bbox = { minLat: 50, maxLat: 50 + dLat, minLon: 11, maxLon: 11 + dLon };
  // Big canvas: zMax=18 fits, so pickZoom must return 18 exactly.
  assert.equal(T.pickZoom(bbox, 1000, 600, 32, 16, 18), 18, 'zMax fits and must be returned');
  // Small canvas: at z=18 the bbox no longer fits. Result must clamp below zMax and stay >= zMin.
  const zSmall = T.pickZoom(bbox, 300, 200, 32, 16, 18);
  assert.ok(zSmall < 18, `small canvas should pick z<18, got ${zSmall}`);
  assert.ok(zSmall >= 16, `small canvas should still stay >= zMin, got ${zSmall}`);
});

test('bboxToCanvasTransform: project corner points to canvas corners', () => {
  const bbox = { minLat: 48.135, maxLat: 48.137, minLon: 11.580, maxLon: 11.582 };
  const z = 18, W = 800, H = 600, pad = 32;
  const tr = T.bboxToCanvasTransform(bbox, z, W, H, pad);
  // NW corner (minLon, maxLat) should land at (tr.ox, tr.oy) -- inner top-left.
  const xNW = tr.ox + (T.lonToGlobalX(bbox.minLon, z) - tr.gxBase) * tr.sc;
  const yNW = tr.oy + (T.latToGlobalY(bbox.maxLat, z) - tr.gyBase) * tr.sc;
  assert.ok(Math.abs(xNW - tr.ox) < 1e-6, `xNW=${xNW} ox=${tr.ox}`);
  assert.ok(Math.abs(yNW - tr.oy) < 1e-6, `yNW=${yNW} oy=${tr.oy}`);
  // SE corner (maxLon, minLat) should land at (tr.ox + dx*sc, tr.oy + dy*sc).
  const dx = T.lonToGlobalX(bbox.maxLon, z) - tr.gxBase;
  const dy = T.latToGlobalY(bbox.minLat, z) - tr.gyBase;
  const xSE = tr.ox + dx * tr.sc;
  const ySE = tr.oy + dy * tr.sc;
  // The constraining dimension (height for this bbox/canvas) should exactly consume H - 2*pad.
  assert.ok(Math.abs((ySE - tr.oy) - (H - 2 * pad)) < 1e-6, `height span=${ySE - tr.oy} expected=${H - 2 * pad}`);
  // The non-constraining dimension should be centred inside the canvas (xSE strictly inside (ox, W-pad)).
  assert.ok(xSE > tr.ox && xSE < W - pad, `xSE=${xSE} not inside (${tr.ox}, ${W - pad})`);
});
