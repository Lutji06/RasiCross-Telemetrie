// ============================================================
//  RasiCross  --  tiles.js  (pure Web-Mercator + tile-math)
// ============================================================
//  Keine Importe. Laeuft im Browser (UMD: window.RasiTiles) und
//  unter node:test (module.exports). 256-px-Tile-Pyramide.
// ============================================================
'use strict';

const TILE_SIZE = 256;

function lonToGlobalX(lon, z) {
  return (lon + 180) / 360 * TILE_SIZE * Math.pow(2, z);
}

function latToGlobalY(lat, z) {
  const r = lat * Math.PI / 180;
  const y = (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2;
  return y * TILE_SIZE * Math.pow(2, z);
}

function globalXToLon(x, z) {
  return x / (TILE_SIZE * Math.pow(2, z)) * 360 - 180;
}

function globalYToLat(y, z) {
  const n = Math.PI - 2 * Math.PI * y / (TILE_SIZE * Math.pow(2, z));
  return 180 / Math.PI * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
}

// Returns the set of (z,x,y) tiles that cover `bbox` at zoom `z`,
// optionally padded by `padTiles` extra tiles on every side.
function tilesForBbox(bbox, z, padTiles) {
  padTiles = padTiles | 0;
  const x0 = Math.floor(lonToGlobalX(bbox.minLon, z) / TILE_SIZE) - padTiles;
  const x1 = Math.floor(lonToGlobalX(bbox.maxLon, z) / TILE_SIZE) + padTiles;
  // Mercator-Y grows southward, so maxLat -> smaller Y
  const y0 = Math.floor(latToGlobalY(bbox.maxLat, z) / TILE_SIZE) - padTiles;
  const y1 = Math.floor(latToGlobalY(bbox.minLat, z) / TILE_SIZE) + padTiles;
  const out = [];
  const max = Math.pow(2, z);
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      if (x < 0 || y < 0 || x >= max || y >= max) continue;
      out.push({ z, x, y });
    }
  }
  return out;
}

// Best zoom z such that the bbox + 2*paddingPx fits within (canvasW x canvasH).
// Bounded by [zoomMin, zoomMax].
function pickZoom(bbox, canvasW, canvasH, paddingPx, zoomMin, zoomMax) {
  let best = zoomMin;
  for (let z = zoomMin; z <= zoomMax; z++) {
    const dx = lonToGlobalX(bbox.maxLon, z) - lonToGlobalX(bbox.minLon, z);
    const dy = latToGlobalY(bbox.minLat, z) - latToGlobalY(bbox.maxLat, z);
    if (dx + 2 * paddingPx <= canvasW && dy + 2 * paddingPx <= canvasH) {
      best = z;
    } else {
      break;  // higher z only gets larger -> stop
    }
  }
  return best;
}

// Linear transform global-pixel-coords -> canvas-pixel-coords:
//   canvasX = ox + (globalX - gxBase) * sc
//   canvasY = oy + (globalY - gyBase) * sc
// where gxBase = lonToGlobalX(minLon), gyBase = latToGlobalY(maxLat).
function bboxToCanvasTransform(bbox, z, canvasW, canvasH, paddingPx) {
  const gxBase = lonToGlobalX(bbox.minLon, z);
  const gyBase = latToGlobalY(bbox.maxLat, z);
  const dx = lonToGlobalX(bbox.maxLon, z) - gxBase;
  const dy = latToGlobalY(bbox.minLat, z) - gyBase;
  const sc = Math.min((canvasW - 2 * paddingPx) / Math.max(dx, 1e-9),
                     (canvasH - 2 * paddingPx) / Math.max(dy, 1e-9));
  const ox = (canvasW - dx * sc) / 2;
  const oy = (canvasH - dy * sc) / 2;
  return { ox, oy, sc, gxBase, gyBase, z };
}

const API = {
  TILE_SIZE,
  lonToGlobalX, latToGlobalY, globalXToLon, globalYToLat,
  tilesForBbox, pickZoom, bboxToCanvasTransform,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = API;
}
if (typeof window !== 'undefined') {
  window.RasiTiles = API;
}
