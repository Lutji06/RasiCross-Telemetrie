# Phase 17 — OSM Tile Background Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render an OSM raster-tile background under the track polyline on `trackCanvas`/`scanCanvas`, pre-cached per-track to disk so the pit-wall works offline at the venue.

**Architecture:** Vanilla JS, no map library. A new pure UMD `tiles.js` exposes Web-Mercator + tile-math; `tile-renderer.js` holds an in-memory `HTMLImageElement` cache and a synchronous `paintTilesOn` that blits whatever it has, kicking off async IPC fetches for misses. Electron `main.js` gets `rasi-tiles:*` handlers that read/write `userData/tiles/<host>/<z>/<x>/<y>.png`. `gpsXYOnCanvas` switches to Web-Mercator so polyline aligns pixel-accurately with tiles (< 1 px visual delta at kart-track scale). Spec: `docs/superpowers/specs/2026-05-28-osm-tile-background-design.md`.

**Tech Stack:** Vanilla HTML/CSS/JS UMD modules, Electron IPC, `node:test` for pure logic, `fs/promises` + `https` (built-in) for disk + network, manual visual acceptance for DOM.

---

## Working Directory & Conventions

- Repo root: `C:\Users\jimlu\Documents\RasiCross-Telemetrie-git`.
- Branch: `feat/tab-redesign-pitwall` (current; contains phases 13-16 + spec commit `9681cf8`). Phase 17 commits stack on top.
- Files are **CRLF**: always `Read` the target region in-session immediately before any `Edit`, and copy the anchor from that fresh `Read`. Anchor on text — **line numbers in this plan are indicative, not authoritative**.
- Use the `Grep` tool (not shell `grep`) for verification asserts.
- Never `git add` `.claude/` or any plan/spec doc except the explicit plan-doc commit in the final task (Task 9).
- Commit messages: conventional commit + body explaining the *why* + trailer `Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>`.
- Per-task verification recipe (run before commit, all must pass):
  - `node --check tiles.js tile-renderer.js geo.js replay.js karts3d.js dom-targets.js rasicross.js main.js preload.js` (omit a file from the list if it does not yet exist at that task's commit — but every existing file must check clean)
  - `npm test` (must stay green; will rise as Task 1 adds tests)
  - `npm run lint` (must be 0 errors)
  - `python -m py_compile sender.py bridge.py esp_libs/*.py`
  - `python -m unittest discover -s test -p "test_*.py"`
- Delete `__pycache__` and `**/__pycache__` before any `git status`.
- Baselines as of plan write (2026-05-28): `npm test` = **36** tests passing; `python -m unittest` = **34** tests passing.

## Locked Decisions

- **Renderer:** Canvas-blit. No Leaflet, no DOM map. Tiles drawn first in `drawTrackOn`, before existing overlays (heatmap / start / sectors / GPS dot).
- **Projection:** Web-Mercator (EPSG:3857). Implemented in `tiles.js`, consumed by `gpsXYOnCanvas` and the tile-blit math so polyline and tiles share the same pixel grid.
- **Storage:** Electron-only. `app.getPath('userData') + '/tiles/<host>/<z>/<x>/<y>.png'`. No IndexedDB fallback in v1. In browser mode `window.rasiTiles` is absent → `tile-renderer.js` becomes a no-op.
- **Provider default:** `https://tile.openstreetmap.org/{z}/{x}/{y}.png`. URL-template override via Settings.
- **Host derivation:** `new URL(templateOrDefault).host`. So default OSM tiles land in `userData/tiles/tile.openstreetmap.org/`. Switching providers writes to a different host directory; no mixing.
- **HTTP User-Agent:** `RasiCross-Telemetry/<package.json.version> (+https://github.com/Lutji06/RasiCross-Telemetrie)`. Read once at startup in `main.js`.
- **Rate-limit:** serial fetch with `≥ 500 ms` gap, single 30 s pause + retry on HTTP 429. 5 s per-request timeout.
- **Zoom range cached:** `zMin=16`, `zMax=18`. Render-time `pickZoom` picks the level whose pixel-per-degree best matches canvas size with 32 px padding.
- **Settings slice:** `state.settings.tiles = { enabled: true, urlTemplate: '', liveQuickToggle: true }`. Persisted via the existing `saveData()`/`localStorage[SAVE_KEY]` flow (rasicross.js:122-145).
- **Track storage:** unchanged — bbox + bounds already on `state.savedTracks[i]`.
- **Toast/dialog helpers:** reuse existing `rcToast(msg)`, `rcAlert(msg, title)`, `rcConfirm(msg, title, okLabel, danger?)` (already in `rasicross.js`).
- **Excluded canvas:** `editorCanvas` (sector-editor) renders flat-background-only — tiles would obscure boundary placement. Only `trackCanvas` + `scanCanvas` get tiles.
- **Attribution string:** `'© OpenStreetMap-Mitwirkende'`. Drawn last so it sits on top of all other layers.

## File Structure

| Action | Path | Responsibility |
|---|---|---|
| Create | `tiles.js` | UMD: pure Web-Mercator + tile-list math |
| Create | `test/test-tiles.js` | `node:test` for tile-math |
| Create | `tile-renderer.js` | UMD: in-memory `HTMLImageElement` cache + `paintTilesOn(ctx, canvas, bounds)` + `ensureBbox(bbox)` + `clearMemory()` |
| Modify | `main.js` | Add `rasi-tiles:fetch` / `:cacheArea` / `:areaStats` / `:clearAll` / `:cancel` IPC handlers |
| Modify | `preload.js` | Expose `window.rasiTiles` bridge |
| Modify | `rasicross.js` | Settings init, `gpsXYOnCanvas` → Web-Mercator via `RasiTiles`, `drawTrackOn` tile-blit + attribution, Settings module wiring, Strecken-Tab status line + auto-cache + manual button, Live `M`-quick-toggle |
| Modify | `RasiCross_Telemetry.html` | Settings module markup, Strecken-Tab per-track status placeholder, Live `M`-button, two new `<script>` tags |
| Modify | `eslint.config.js` | Declare `RasiTiles` + `RasiTileRenderer` as globals for `rasicross.js`; new file block for `tile-renderer.js` |
| Modify | `package.json` | Add `tiles.js`, `tile-renderer.js` to `build.files` |
| Modify | `README.md` | New "Karten-Hintergrund (OSM)" subsection under "Erweiterte Dashboard-Features" |
| Create | `docs/superpowers/plans/2026-05-28-17-osm-tile-background.md` | This plan (committed in Task 9) |

## Task Order

`Task 1 → Task 2 → Task 3 → Task 4 → Task 5 → Task 6 → Task 7 → Task 8 → Task 9`

Each task ends with its own commit. Final task commits this plan document.

---

## Task 1: `tiles.js` pure tile-math module + unit tests

**Files:**
- Create: `tiles.js`
- Create: `test/test-tiles.js`

- [ ] **Step 1: Write the failing tests**

Create `test/test-tiles.js` with the full content:

```javascript
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
  // Equator
  const mid = T.latToGlobalY(0, 18);
  assert.ok(Math.abs(mid - size / 2) < 1e-6);
  // Northern lat -> smaller Y, southern lat -> larger Y
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
  // A 1-tile pad ring around an N×M grid adds (N+2)*(M+2) − N*M new tiles.
  // For inner ∈ {1,2,4} the padded count is {9,12,16} respectively.
  const expected = { 1: 9, 2: 12, 4: 16 };
  assert.equal(padded, expected[inner], `inner=${inner} padded=${padded}`);
});

test('pickZoom: 200 m × 150 m bbox in a 1000 × 600 canvas falls in [16..18]', () => {
  // Construct a bbox at lat 50° that is ~200 m wide × ~150 m tall:
  //  1° lat ≈ 111 km;  1° lon ≈ 111 km * cos(50°) ≈ 71.3 km
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
  // SW corner (minLon, minLat) should project at (ox, oy + dy*sc) -- bottom-left of inner box
  const gxSW = T.lonToGlobalX(bbox.minLon, z);
  const gySW = T.latToGlobalY(bbox.minLat, z);
  const gxBase = T.lonToGlobalX(bbox.minLon, z);
  const gyBase = T.latToGlobalY(bbox.maxLat, z);
  const xSW = tr.ox + (gxSW - gxBase) * tr.sc;
  const ySW = tr.oy + (gySW - gyBase) * tr.sc;
  assert.ok(Math.abs(xSW - tr.ox) < 1e-6, `xSW=${xSW} ox=${tr.ox}`);
  // The projected SW Y should be at oy + height-of-bbox * sc
  const dyBbox = T.latToGlobalY(bbox.minLat, z) - T.latToGlobalY(bbox.maxLat, z);
  assert.ok(Math.abs(ySW - (tr.oy + dyBbox * tr.sc)) < 1e-6);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: 36 prior tests pass, 8 new tests **fail** with `Cannot find module '../tiles.js'`.

- [ ] **Step 3: Implement `tiles.js`**

Create `tiles.js` with the full content:

```javascript
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

// Best zoom z such that the bbox + 2*paddingPx fits within (canvasW × canvasH).
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: **44** tests pass (36 + 8 new).

- [ ] **Step 5: Verify lint + node-check**

Run: `node --check tiles.js` → exit 0.
Run: `npm run lint` → 0 errors.

If lint complains that `tiles.js` is not configured in `eslint.config.js`: it falls through to the default config which uses CommonJS+browser globals; the file's `module.exports` + `window.RasiTiles` should both be recognised. If lint errors do appear, **stop and fix in Task 9** — do not commit broken lint state.

- [ ] **Step 6: Commit**

```
git add tiles.js test/test-tiles.js
git commit -m "feat(tiles): pure Web-Mercator + tile-list math helper

Adds tiles.js as a dependency-free UMD module (browser + node:test) with
lonToGlobalX/latToGlobalY round-trip projection, tilesForBbox with
padTiles support, pickZoom for canvas-fit selection, and
bboxToCanvasTransform. Eight node:test cases cover the standard reference
points (Null-Isle, Munich kart-bbox) and the round-trip invariants. JS
test count: 36 → 44.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 2: Switch `gpsXYOnCanvas` to Web-Mercator via `RasiTiles`

**Files:**
- Modify: `RasiCross_Telemetry.html` (add `<script src="tiles.js">` before `rasicross.js`)
- Modify: `rasicross.js` (`gpsXYOnCanvas` rewrite)
- Modify: `eslint.config.js` (declare `RasiTiles` as global for `rasicross.js`)

- [ ] **Step 1: Add the `<script src="tiles.js">` tag to the HTML**

Read `RasiCross_Telemetry.html` around the existing `dom-targets.js` script tag:

Run: `Grep` for pattern `dom-targets\.js` in `RasiCross_Telemetry.html`, output_mode content, -n true, -C 1.

Identify the line that loads `dom-targets.js` (was added in Phase 16, around HTML line 3115). Insert a new line directly before that one:

```html
  <script src="tiles.js"></script>
```

(Use `Edit` with `old_string` = the fresh-Read `dom-targets.js` line and `new_string` = the new `tiles.js` line + a newline + the existing `dom-targets.js` line. Indentation must match the surrounding 2-space-indented `<script>` lines in that file.)

- [ ] **Step 2: Verify the script order**

Run: `Grep` for pattern `src="(geo|replay|dom-targets|tiles|karts3d|rasicross)\.js"` in `RasiCross_Telemetry.html`, output_mode content, -n true.

Expected order top-to-bottom: `geo.js → replay.js → karts3d.js → tiles.js → dom-targets.js → rasicross.js` (geo/replay/karts3d order may vary — only the relative position of `tiles.js` matters: **before** `rasicross.js`).

- [ ] **Step 3: Declare `RasiTiles` as a global in `eslint.config.js`**

Read `eslint.config.js` to confirm the `rasicross.js` block's `globals` map shape (was rasicross.js:63-70 at plan time).

Edit the `globals: { ... }` object of the `files: ['rasicross.js']` block to add `RasiTiles: 'readonly',` alongside the existing `DomTargets: 'readonly',`. After the edit it should read (anchor-text — verify against your fresh Read):

```javascript
        ...geoGlobals,
        THREE: 'readonly',
        RasiReplay: 'readonly',
        RasiKart3D: 'readonly',
        DomTargets: 'readonly',
        RasiTiles: 'readonly',
```

- [ ] **Step 4: Rewrite `gpsXYOnCanvas` to use Web-Mercator**

Read `rasicross.js` around the existing `gpsXYOnCanvas` definition (was line 562 at plan time). Replace the whole function body with:

```javascript
function gpsXYOnCanvas(lat, lon, c, bounds) {
  const b = bounds || state.track.bounds || { minLat: lat - .0001, maxLat: lat + .0001, minLon: lon - .0001, maxLon: lon + .0001 };
  const w = c.width, h = c.height, pad = 32 * dpr();
  // Web-Mercator via RasiTiles -- shared projection with the tile-blit layer.
  // Reference zoom 18 cancels out of the uniform-scale fit; only ratios matter.
  const z = 18;
  const tr = RasiTiles.bboxToCanvasTransform(b, z, w, h, pad);
  const gx = RasiTiles.lonToGlobalX(lon, z);
  const gy = RasiTiles.latToGlobalY(lat, z);
  return { x: tr.ox + (gx - tr.gxBase) * tr.sc, y: tr.oy + (gy - tr.gyBase) * tr.sc };
}
```

- [ ] **Step 5: Verify lint + node-check**

Run: `node --check rasicross.js tiles.js` → exit 0.
Run: `npm run lint` → 0 errors.

- [ ] **Step 6: Manual sanity (recorded in task body, no automated assert)**

The track polyline visual position should be indistinguishable from before this task at kart-track bbox scale (< 1 px). The Web-Mercator switch is invisible at this scale; the test that this is true is **Task 5's manual acceptance**, not here.

Run: `npm test` → 44 passes (no change since Task 1).

- [ ] **Step 7: Commit**

```
git add RasiCross_Telemetry.html rasicross.js eslint.config.js
git commit -m "refactor(track-map): gpsXYOnCanvas uses Web-Mercator via RasiTiles

Replaces the direct equirectangular lat/lon -> canvas mapping with a
Web-Mercator projection delegated to tiles.js. Visually indistinguishable
at kart-track scale (< 1 px deviation), but lets the upcoming tile-blit
layer (Phase 17) align pixel-accurately to the polyline. Adds the
tiles.js <script> tag before dom-targets.js and registers RasiTiles as
an ESLint global for rasicross.js. No new tests -- the projection math
itself is unit-tested in test/test-tiles.js.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 3: Electron IPC handlers (`main.js`, `preload.js`)

**Files:**
- Modify: `main.js`
- Modify: `preload.js`

- [ ] **Step 1: Add `rasi-tiles:*` handlers to `main.js`**

Read `main.js` end-to-end (it is small — ~110 lines).

Append the following block **after** the existing `rasi-kart:clear` handler (anchor on the closing `})` of that handler from a fresh Read):

```javascript

// ---------- OSM tile cache (Phase 17) ----------
const TILE_FETCH_TIMEOUT_MS = 5000;
const TILE_RATE_LIMIT_MS = 500;
const TILE_429_PAUSE_MS = 30000;

let _tileCancelFlag = false;
let _lastTileFetchAt = 0;

function _tileDir(host, z, x) {
  return path.join(app.getPath("userData"), "tiles", host, String(z), String(x));
}
function _tilePath(host, z, x, y) {
  return path.join(_tileDir(host, z, x), String(y) + ".png");
}

function _userAgent() {
  // package.json version is best-effort; fallback constant if read fails
  let v = "0.0.0";
  try { v = require("./package.json").version || v; } catch (_) {}
  return "RasiCross-Telemetry/" + v + " (+https://github.com/Lutji06/RasiCross-Telemetrie)";
}

function _httpGet(url) {
  return new Promise(function (resolve) {
    const u = new URL(url);
    const lib = u.protocol === "https:" ? require("https") : require("http");
    const req = lib.get({
      hostname: u.hostname,
      path: u.pathname + u.search,
      headers: { "User-Agent": _userAgent(), "Accept": "image/png,image/*" },
      timeout: TILE_FETCH_TIMEOUT_MS,
    }, function (res) {
      if (res.statusCode === 429) {
        res.resume();
        return resolve({ ok: false, status: 429 });
      }
      if (res.statusCode !== 200) {
        res.resume();
        return resolve({ ok: false, status: res.statusCode });
      }
      const chunks = [];
      res.on("data", function (c) { chunks.push(c); });
      res.on("end", function () { resolve({ ok: true, buf: Buffer.concat(chunks) }); });
      res.on("error", function () { resolve({ ok: false, status: -1 }); });
    });
    req.on("timeout", function () { req.destroy(); resolve({ ok: false, status: -2 }); });
    req.on("error", function () { resolve({ ok: false, status: -3 }); });
  });
}

function _expandUrl(template, z, x, y) {
  return template.replace("{z}", z).replace("{x}", x).replace("{y}", y);
}

ipcMain.handle("rasi-tiles:fetch", async function (_e, args) {
  const host = String(args.host || "").trim();
  const z = args.z | 0, x = args.x | 0, y = args.y | 0;
  const template = String(args.urlTemplate || "");
  if (!host || !template) return { ok: false, error: "missing host or urlTemplate" };

  const filePath = _tilePath(host, z, x, y);
  try {
    const buf = await fs.promises.readFile(filePath);
    return { ok: true, dataUrl: "data:image/png;base64," + buf.toString("base64"), fromCache: true };
  } catch (_) { /* miss -> fetch */ }

  // Rate-limit gap
  const sinceLast = Date.now() - _lastTileFetchAt;
  if (sinceLast < TILE_RATE_LIMIT_MS) {
    await new Promise(function (r) { setTimeout(r, TILE_RATE_LIMIT_MS - sinceLast); });
  }
  _lastTileFetchAt = Date.now();

  const url = _expandUrl(template, z, x, y);
  const res = await _httpGet(url);
  if (!res.ok) {
    if (res.status === 429) return { ok: false, retryAfterMs: TILE_429_PAUSE_MS };
    return { ok: false, error: "http " + res.status };
  }
  try {
    await fs.promises.mkdir(_tileDir(host, z, x), { recursive: true });
    await fs.promises.writeFile(filePath, res.buf);
  } catch (e) { /* disk error -> still return the data so render works */ }
  return { ok: true, dataUrl: "data:image/png;base64," + res.buf.toString("base64"), fromCache: false };
});

ipcMain.handle("rasi-tiles:cacheArea", async function (e, args) {
  _tileCancelFlag = false;
  const host = String(args.host || "");
  const template = String(args.urlTemplate || "");
  const bbox = args.bbox || {};
  const zMin = args.zMin | 0, zMax = args.zMax | 0;
  // Build the tile list inline (same math as renderer's RasiTiles.tilesForBbox + 1-tile pad)
  const tilesToFetch = [];
  for (let z = zMin; z <= zMax; z++) {
    const m = Math.pow(2, z);
    const x0 = Math.floor(((bbox.minLon + 180) / 360) * 256 * m / 256) - 1;
    const x1 = Math.floor(((bbox.maxLon + 180) / 360) * 256 * m / 256) + 1;
    const lat2y = function (lat) {
      const r = lat * Math.PI / 180;
      return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * m);
    };
    const y0 = lat2y(bbox.maxLat) - 1;
    const y1 = lat2y(bbox.minLat) + 1;
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        if (x < 0 || y < 0 || x >= m || y >= m) continue;
        tilesToFetch.push({ z, x, y });
      }
    }
  }
  let done = 0, errors = 0;
  const total = tilesToFetch.length;
  for (const t of tilesToFetch) {
    if (_tileCancelFlag) break;
    const r = await new Promise(function (resolve) {
      // Reuse the fetch handler logic by invoking the same internal path
      (async function () {
        const filePath = _tilePath(host, t.z, t.x, t.y);
        try {
          await fs.promises.access(filePath);
          resolve({ ok: true, fromCache: true });
          return;
        } catch (_) {}
        const sinceLast = Date.now() - _lastTileFetchAt;
        if (sinceLast < TILE_RATE_LIMIT_MS) {
          await new Promise(function (rr) { setTimeout(rr, TILE_RATE_LIMIT_MS - sinceLast); });
        }
        _lastTileFetchAt = Date.now();
        const httpRes = await _httpGet(_expandUrl(template, t.z, t.x, t.y));
        if (!httpRes.ok) {
          if (httpRes.status === 429) {
            await new Promise(function (rr) { setTimeout(rr, TILE_429_PAUSE_MS); });
            const retry = await _httpGet(_expandUrl(template, t.z, t.x, t.y));
            if (!retry.ok) { resolve({ ok: false }); return; }
            try {
              await fs.promises.mkdir(_tileDir(host, t.z, t.x), { recursive: true });
              await fs.promises.writeFile(filePath, retry.buf);
            } catch (_) {}
            resolve({ ok: true, fromCache: false });
            return;
          }
          resolve({ ok: false });
          return;
        }
        try {
          await fs.promises.mkdir(_tileDir(host, t.z, t.x), { recursive: true });
          await fs.promises.writeFile(filePath, httpRes.buf);
        } catch (_) {}
        resolve({ ok: true, fromCache: false });
      })();
    });
    if (r.ok) done++; else errors++;
    try { e.sender.send("rasi-tiles:progress", { done, total, errors }); } catch (_) {}
  }
  return { done, total, errors, cancelled: _tileCancelFlag };
});

ipcMain.handle("rasi-tiles:cancel", async function () {
  _tileCancelFlag = true;
  return { ok: true };
});

ipcMain.handle("rasi-tiles:areaStats", async function (_e, args) {
  const host = String(args.host || "");
  const bbox = args.bbox || {};
  const zMin = args.zMin | 0, zMax = args.zMax | 0;
  let cached = 0, missing = 0, bytes = 0, total = 0;
  for (let z = zMin; z <= zMax; z++) {
    const m = Math.pow(2, z);
    const x0 = Math.floor(((bbox.minLon + 180) / 360) * m) - 1;
    const x1 = Math.floor(((bbox.maxLon + 180) / 360) * m) + 1;
    const lat2y = function (lat) {
      const r = lat * Math.PI / 180;
      return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * m);
    };
    const y0 = lat2y(bbox.maxLat) - 1;
    const y1 = lat2y(bbox.minLat) + 1;
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        if (x < 0 || y < 0 || x >= m || y >= m) continue;
        total++;
        try {
          const st = await fs.promises.stat(_tilePath(host, z, x, y));
          cached++;
          bytes += st.size;
        } catch (_) {
          missing++;
        }
      }
    }
  }
  return { cached, missing, bytes, total };
});

ipcMain.handle("rasi-tiles:clearAll", async function () {
  const root = path.join(app.getPath("userData"), "tiles");
  let deleted = 0, bytes = 0;
  async function walk(dir) {
    let entries;
    try { entries = await fs.promises.readdir(dir, { withFileTypes: true }); }
    catch (_) { return; }
    for (const ent of entries) {
      const p = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        await walk(p);
        try { await fs.promises.rmdir(p); } catch (_) {}
      } else {
        try {
          const st = await fs.promises.stat(p);
          bytes += st.size;
          await fs.promises.unlink(p);
          deleted++;
        } catch (_) {}
      }
    }
  }
  await walk(root);
  return { deleted, bytes };
});
```

- [ ] **Step 2: Verify `fs` is already imported at the top of `main.js`**

Run: `Grep` for pattern `require\("fs"\)|require\('fs'\)` in `main.js`.

If found: nothing to do. If **not** found: also Read the top of `main.js`, find the existing `const` requires (e.g. `const path = require("path")`), and add `const fs = require("fs");` next to them — anchor the Edit on a fresh Read.

- [ ] **Step 3: Verify `node --check main.js` passes**

Run: `node --check main.js`
Expected: exit 0, no syntax errors.

- [ ] **Step 4: Extend `preload.js` to expose `window.rasiTiles`**

Read `preload.js` (it's ~25 lines). At the end of the file (after the existing `contextBridge.exposeInMainWorld("rasiKart", { ... })` block), append:

```javascript

contextBridge.exposeInMainWorld("rasiTiles", {
  fetchTile:  (args) => ipcRenderer.invoke("rasi-tiles:fetch", args),
  cacheArea:  (args) => ipcRenderer.invoke("rasi-tiles:cacheArea", args),
  cancel:     ()     => ipcRenderer.invoke("rasi-tiles:cancel"),
  areaStats:  (args) => ipcRenderer.invoke("rasi-tiles:areaStats", args),
  clearAll:   ()     => ipcRenderer.invoke("rasi-tiles:clearAll"),
  onProgress: (cb) => { ipcRenderer.on("rasi-tiles:progress", (_, p) => { try { cb(p); } catch(e) { console.error(e); } }); },
});
```

- [ ] **Step 5: Verify `node --check preload.js` + lint**

Run: `node --check preload.js` → exit 0.
Run: `npm run lint` → 0 errors.

- [ ] **Step 6: Run full test baseline**

Run: `npm test` → 44 passes (no change).
Run: `python -m unittest discover -s test -p "test_*.py"` → 34 passes (no change).

- [ ] **Step 7: Commit**

```
git add main.js preload.js
git commit -m "feat(tiles): Electron IPC for OSM tile disk cache

Adds rasi-tiles:fetch / :cacheArea / :areaStats / :clearAll / :cancel
IPC handlers in main.js and a window.rasiTiles bridge in preload.js.
Tiles persist under userData/tiles/<host>/<z>/<x>/<y>.png. Serial fetch
with >=500 ms gap, 5 s timeout, HTTP 429 -> 30 s pause + single retry.
Same pattern as the rasi-kart:* handlers added in Phase 12.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 4: Renderer-side tile cache (`tile-renderer.js`) + Settings init

**Files:**
- Create: `tile-renderer.js`
- Modify: `RasiCross_Telemetry.html` (add `<script src="tile-renderer.js">` after `tiles.js`)
- Modify: `eslint.config.js` (new block for `tile-renderer.js`; add `RasiTileRenderer` to `rasicross.js` globals)
- Modify: `rasicross.js` (add `state.settings.tiles` defaults at the existing `settings:` line)

- [ ] **Step 1: Create `tile-renderer.js`**

Create `tile-renderer.js` with the full content:

```javascript
// ============================================================
//  RasiCross  --  tile-renderer.js
// ============================================================
//  Renderer-side OSM-Tile-Cache. Haelt geladene PNGs als
//  HTMLImageElement in einer Map, damit drawTrackOn synchron
//  blitten kann. Misses werden asynchron via window.rasiTiles
//  (IPC -> Electron Main) gefetcht; sobald das letzte Bild
//  resolved, wird drawTrack() einmalig nachgetriggert.
// ============================================================
'use strict';

(function () {
  const DEFAULT_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
  const Z_MIN = 16, Z_MAX = 18;
  const PADDING_PX = 32;

  let _api = null;                      // window.rasiTiles or null in browser-mode
  let _getSettings = function () {       // injected by init()
    return { enabled: false, urlTemplate: '', liveQuickToggle: true };
  };
  let _redraw = function () {};          // injected by init() — e.g. () => drawTrack()
  let _cache = new Map();                // key "host|z|x|y" -> HTMLImageElement
  let _inflight = new Set();             // keys currently being fetched
  let _enabled = false;                  // false in browser-mode

  function _resolveTemplate() {
    const t = (_getSettings().urlTemplate || '').trim();
    if (!t) return DEFAULT_URL;
    if (t.indexOf('{z}') < 0 || t.indexOf('{x}') < 0 || t.indexOf('{y}') < 0) {
      return DEFAULT_URL;  // invalid template -> silently fall back
    }
    return t;
  }

  function _host(template) {
    try { return new URL(template).host || 'unknown'; }
    catch (_) { return 'unknown'; }
  }

  function _key(host, z, x, y) { return host + '|' + z + '|' + x + '|' + y; }

  function init(opts) {
    _api = (typeof window !== 'undefined' && window.rasiTiles) ? window.rasiTiles : null;
    _enabled = !!_api;
    if (opts && typeof opts.getSettings === 'function') _getSettings = opts.getSettings;
    if (opts && typeof opts.redraw === 'function') _redraw = opts.redraw;
  }

  function clearMemory() {
    _cache.clear();
    _inflight.clear();
  }

  // Synchronous: schedules async fetches for missing tiles covering the bbox at
  // the chosen zoom. Caller will get repaint via _redraw() once images arrive.
  function ensureBbox(bounds, canvasW, canvasH) {
    if (!_enabled || !_getSettings().enabled || !bounds) return;
    if (!window.RasiTiles) return;
    const template = _resolveTemplate();
    const host = _host(template);
    const z = window.RasiTiles.pickZoom(bounds, canvasW, canvasH, PADDING_PX, Z_MIN, Z_MAX);
    const tiles = window.RasiTiles.tilesForBbox(bounds, z, 1);
    let pending = 0;
    for (const t of tiles) {
      const k = _key(host, t.z, t.x, t.y);
      if (_cache.has(k) || _inflight.has(k)) continue;
      _inflight.add(k);
      pending++;
      _api.fetchTile({ host, z: t.z, x: t.x, y: t.y, urlTemplate: template }).then(function (r) {
        _inflight.delete(k);
        if (!r || !r.ok || !r.dataUrl) return;
        const img = new Image();
        img.onload = function () {
          _cache.set(k, img);
          _redraw();
        };
        img.onerror = function () { /* silently drop */ };
        img.src = r.dataUrl;
      }).catch(function () { _inflight.delete(k); });
    }
    return { host, z, tilesNeeded: tiles.length, fetchesStarted: pending };
  }

  // Synchronous blit. Returns the chosen zoom (or null if disabled / nothing painted).
  function paintTilesOn(ctx, canvas, bounds) {
    if (!_enabled || !_getSettings().enabled || !bounds) return null;
    if (!window.RasiTiles) return null;
    const template = _resolveTemplate();
    const host = _host(template);
    const w = canvas.width, h = canvas.height;
    const dpr = (window.devicePixelRatio || 1);
    const padPx = PADDING_PX * dpr;
    const z = window.RasiTiles.pickZoom(bounds, w, h, padPx, Z_MIN, Z_MAX);
    const tr = window.RasiTiles.bboxToCanvasTransform(bounds, z, w, h, padPx);
    const tiles = window.RasiTiles.tilesForBbox(bounds, z, 1);
    let painted = 0;
    for (const t of tiles) {
      const k = _key(host, t.z, t.x, t.y);
      const img = _cache.get(k);
      if (!img) continue;
      const tileWorldX = t.x * window.RasiTiles.TILE_SIZE;
      const tileWorldY = t.y * window.RasiTiles.TILE_SIZE;
      const dx = tr.ox + (tileWorldX - tr.gxBase) * tr.sc;
      const dy = tr.oy + (tileWorldY - tr.gyBase) * tr.sc;
      const ds = window.RasiTiles.TILE_SIZE * tr.sc;
      ctx.drawImage(img, dx, dy, ds, ds);
      painted++;
    }
    return painted > 0 ? z : null;
  }

  const API = { init, ensureBbox, paintTilesOn, clearMemory, _DEFAULT_URL: DEFAULT_URL };
  if (typeof window !== 'undefined') window.RasiTileRenderer = API;
})();
```

- [ ] **Step 2: Add the `<script src="tile-renderer.js">` tag to the HTML**

Read `RasiCross_Telemetry.html` around the existing `<script src="tiles.js">` tag (added in Task 2).

Insert a new `<script src="tile-renderer.js"></script>` line **directly after** the `tiles.js` line and **before** `dom-targets.js`. Use `Edit` with the fresh anchor.

- [ ] **Step 3: Verify script order**

Run: `Grep` for pattern `src="(geo|replay|dom-targets|tiles|tile-renderer|karts3d|rasicross)\.js"` in `RasiCross_Telemetry.html`, output_mode content, -n true.

Expected: `tiles.js` precedes `tile-renderer.js`; both precede `rasicross.js`.

- [ ] **Step 4: Add `tile-renderer.js` to ESLint config + declare `RasiTileRenderer` global for rasicross.js**

Read `eslint.config.js`. After the existing `dom-targets.js` block (around lines 75-84 at plan time), insert a parallel block:

```javascript

  // tile-renderer.js — UMD module, uses window/document/fetch + window.rasiTiles
  {
    files: ['tile-renderer.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: { ...globals.browser, module: 'readonly', RasiTiles: 'readonly' },
    },
    rules: bugRules,
  },
```

Also in the `rasicross.js` block's `globals` object, add `RasiTileRenderer: 'readonly',` next to the existing `DomTargets`/`RasiTiles` entries.

- [ ] **Step 5: Add `state.settings.tiles` defaults to `rasicross.js`**

Read `rasicross.js` line containing the existing `settings:` initialiser inside the global `state` object (was line 47 at plan time, starts with `  settings: { maxSpeed: 80, ...`).

Replace the entire `settings: { ... }` line with one that includes the new `tiles` slice. Use `Edit` with the fresh-Read anchor. Example replacement:

```javascript
  settings: { maxSpeed: 80, maxRpm: 10000, rpmWarning: 9000, gScale: 3, minLapSeconds: 10, displayUpdateMs: 500, oledPage: 'auto', recordAutoArm: true, gView: '2d', kartModelYaw: 0, tiles: { enabled: true, urlTemplate: '', liveQuickToggle: true } },
```

(Match the exact whitespace from your fresh Read — only the comma-separated content changes.)

- [ ] **Step 6: Verify lint + node-check + tests**

Run: `node --check tile-renderer.js tiles.js rasicross.js` → exit 0.
Run: `npm run lint` → 0 errors.
Run: `npm test` → 44 passes (unchanged).

- [ ] **Step 7: Commit**

```
git add tile-renderer.js RasiCross_Telemetry.html eslint.config.js rasicross.js
git commit -m "feat(tiles): renderer-side cache + paintTilesOn / ensureBbox

Adds tile-renderer.js as a UMD module managing an in-memory
HTMLImageElement cache so drawTrackOn can blit tiles synchronously.
Misses are fetched asynchronously via window.rasiTiles (IPC). A single
drawTrack() repaint is triggered once images arrive. Registers
state.settings.tiles defaults (enabled, urlTemplate, liveQuickToggle),
adds the <script> tag, extends ESLint config. Not yet wired into
drawTrackOn — that lands in Task 5.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 5: Wire `drawTrackOn` → `paintTilesOn` + attribution + init

**Files:**
- Modify: `rasicross.js` (init call, drawTrackOn integration, attribution)

- [ ] **Step 1: Call `RasiTileRenderer.init(...)` once at startup**

Read `rasicross.js` to find the existing app init / boot function. Search for the function that runs DOMContentLoaded handlers (was around `setupUI()` near the bottom of the file at plan time). Confirm the right anchor: a function that already calls `loadData()` / `applyTheme()` / similar startup wiring.

After `loadData()` is called (so `state.settings.tiles` defaults are in place), insert:

```javascript
  try {
    if (typeof RasiTileRenderer !== 'undefined') {
      RasiTileRenderer.init({
        getSettings: function () { return state.settings.tiles || { enabled: false, urlTemplate: '', liveQuickToggle: true }; },
        redraw: function () { try { drawTrack(); } catch (e) {} },
      });
    }
  } catch (e) { console.warn('tile-renderer init:', e); }
```

Use `Edit` with the fresh-Read anchor; place this block right after the `loadData()` call.

- [ ] **Step 2: Modify `drawTrackOn` to paint tiles before overlays**

Read `rasicross.js` around `function drawTrackOn(c)` (was line 577 at plan time). After the existing `ctx.fillRect(0, 0, w, h);` (the soft-background fill) and **before** the `const pts = state.track.points;` line, insert:

```javascript
  // ---- Tile background (Phase 17) ----
  // Excluded: editorCanvas (sector-editor needs neutral contrast).
  // Excluded: trackCanvas when state.settings.tiles.liveQuickToggle === false.
  let _tilesPaintedAtZ = null;
  try {
    if (c.id !== 'editorCanvas' && typeof RasiTileRenderer !== 'undefined') {
      const liveSuppressed = (c.id === 'trackCanvas' && state.settings.tiles && state.settings.tiles.liveQuickToggle === false);
      if (!liveSuppressed && state.track.bounds) {
        RasiTileRenderer.ensureBbox(state.track.bounds, w, h);
        _tilesPaintedAtZ = RasiTileRenderer.paintTilesOn(ctx, c, state.track.bounds);
      }
    }
  } catch (e) { /* silent */ }
```

- [ ] **Step 3: Append attribution overlay at the very end of `drawTrackOn`**

Read the closing `}` of `drawTrackOn` (it ends right after the `// GPS dot` block, around line 647 at plan time). **Before** that closing `}`, insert:

```javascript
  // ---- Attribution overlay (OSM Tile Usage Policy) ----
  if (_tilesPaintedAtZ !== null) {
    ctx.save();
    ctx.font = (10 * dpr()) + 'px monospace';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'bottom';
    ctx.fillStyle = 'rgba(255,255,255,.65)';
    ctx.fillText('© OpenStreetMap-Mitwirkende', w - 6 * dpr(), h - 4 * dpr());
    ctx.restore();
  }
```

- [ ] **Step 4: Verify lint + node-check + tests**

Run: `node --check rasicross.js` → exit 0.
Run: `npm run lint` → 0 errors.
Run: `npm test` → 44 passes.

Run: `Grep` for pattern `_tilesPaintedAtZ` in `rasicross.js`. Expected: exactly two hits (declaration + check inside attribution block).

- [ ] **Step 5: Commit**

```
git add rasicross.js
git commit -m "feat(tiles): paint OSM tiles in drawTrackOn + OSM attribution

Wires RasiTileRenderer into the track-map draw path: tiles are painted
right after the soft-background fill and before all existing overlays
(heatmap, start/sector lines, GPS dot). editorCanvas keeps its flat
background; the Live trackCanvas honours state.settings.tiles
.liveQuickToggle. The required '© OpenStreetMap-Mitwirkende' attribution
is drawn last so it stays on top of the GPS dot whenever tiles are
visible. Init happens once after loadData() so the settings slice is
already populated.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 6: Settings-Tab UI module (global toggle + URL template + Cache leeren)

**Files:**
- Modify: `RasiCross_Telemetry.html` (new Settings module markup)
- Modify: `rasicross.js` (apply/save/wire handlers, Cache-leeren action)

- [ ] **Step 1: Locate the Settings tab and existing module style**

Run: `Grep` for pattern `id="tab-settings"` in `RasiCross_Telemetry.html`, output_mode content, -n true, -C 0.

Read 80 lines after that anchor to see the existing `pw-module` style used for Settings cards (e.g. the "Recording", "Display-Update-Rate", "Kart-Modell" modules). Note the heading + body markup pattern to mirror.

- [ ] **Step 2: Add the "Karten-Hintergrund" module**

Insert a new `pw-module` block at the end of the Settings tab content (before the closing `</section>` of `#tab-settings`). Use the same pattern (`<div class="pw-module">...<h3 class="pw-module-title">...</h3>...`) you saw in Step 1. The new module content:

```html
<div class="pw-module">
  <h3 class="pw-module-title">Karten-Hintergrund</h3>
  <div class="pw-module-body">
    <label class="pw-row">
      <span>OSM-Hintergrund anzeigen</span>
      <input type="checkbox" id="setTilesEnabled">
    </label>
    <label class="pw-row pw-row--stack">
      <span>Tile-URL-Template (leer = OSM Standard)</span>
      <input type="text" id="setTilesUrl" placeholder="z.B. https://api.maptiler.com/maps/streets/{z}/{x}/{y}.png?key=…" autocomplete="off">
      <small id="setTilesUrlHint" class="pw-hint">{z}, {x}, {y} sind Pflicht.</small>
    </label>
    <div class="pw-row pw-row--actions">
      <button id="tilesClearBtn" class="pw-btn">Cache leeren</button>
      <span id="tilesCacheInfo" class="pw-hint">—</span>
    </div>
    <p class="pw-hint">
      Karten-Tiles © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap-Mitwirkende</a>.
      Eigene Tile-URL nur mit gültiger Lizenz des jeweiligen Anbieters verwenden.
    </p>
  </div>
</div>
```

(If your Settings tab uses a different module class — e.g. `card` or `settings-card` instead of `pw-module` — substitute consistently. Confirm against the fresh Read from Step 1 before editing.)

- [ ] **Step 3: Wire the settings inputs in `rasicross.js`**

Read `rasicross.js` around `applySettingsToUI` (was line 291 at plan time, the function that sets `$('setMaxSpeed').value = state.settings.maxSpeed` etc.) and the matching read-back-from-UI function (`readSettingsFromUI` or similar — find it via Grep for `state.settings.maxSpeed = `).

In **apply** (push state → UI), append:

```javascript
  if ($('setTilesEnabled')) {
    $('setTilesEnabled').checked = !!(state.settings.tiles && state.settings.tiles.enabled);
  }
  if ($('setTilesUrl')) {
    $('setTilesUrl').value = (state.settings.tiles && state.settings.tiles.urlTemplate) || '';
    updateTilesUrlHint();
  }
```

In **read** (pull UI → state), append:

```javascript
  if (!state.settings.tiles) state.settings.tiles = { enabled: true, urlTemplate: '', liveQuickToggle: true };
  if ($('setTilesEnabled')) state.settings.tiles.enabled = !!$('setTilesEnabled').checked;
  if ($('setTilesUrl')) state.settings.tiles.urlTemplate = ($('setTilesUrl').value || '').trim();
```

- [ ] **Step 4: Add `updateTilesUrlHint()` helper + wire input listener**

Read `rasicross.js` to find a sensible location (near other settings-tab helpers). Insert:

```javascript
function updateTilesUrlHint() {
  const el = $('setTilesUrl');
  const hint = $('setTilesUrlHint');
  if (!el || !hint) return;
  const v = (el.value || '').trim();
  const ok = !v || (v.indexOf('{z}') >= 0 && v.indexOf('{x}') >= 0 && v.indexOf('{y}') >= 0);
  el.classList.toggle('invalid', !ok);
  hint.textContent = ok
    ? (v ? 'Gültige Vorlage.' : 'Leer = OSM Standard wird verwendet.')
    : 'Vorlage muss {z}, {x}, {y} enthalten.';
}
```

Then read the existing init/wire block (the one that already binds `saveTrackBtn.onclick = saveCurrentTrack;` etc.; was around rasicross.js:3505 at plan time) and append:

```javascript
  if ($('setTilesUrl')) $('setTilesUrl').addEventListener('input', updateTilesUrlHint);
  if ($('setTilesEnabled')) $('setTilesEnabled').addEventListener('change', function () {
    saveData();
    try { drawTrack(); } catch (e) {}
  });
  if ($('tilesClearBtn')) $('tilesClearBtn').onclick = onTilesClearClicked;
```

- [ ] **Step 5: Add the Cache-leeren handler**

Insert near `updateTilesUrlHint`:

```javascript
async function onTilesClearClicked() {
  if (!window.rasiTiles) {
    rcAlert('Tile-Cache nur in der Desktop-App verfügbar.', 'Karten-Hintergrund');
    return;
  }
  if (!await rcConfirm('Alle gecachten Karten-Tiles löschen?', 'Cache leeren', 'Löschen', true)) return;
  try {
    const r = await window.rasiTiles.clearAll();
    if (typeof RasiTileRenderer !== 'undefined') RasiTileRenderer.clearMemory();
    rcToast(`${r.deleted || 0} Tiles entfernt (${formatBytes(r.bytes || 0)})`);
    try { drawTrack(); renderSavedTracks(); } catch (e) {}
  } catch (e) {
    rcAlert('Cache konnte nicht geleert werden: ' + (e && e.message ? e.message : e), 'Karten-Hintergrund');
  }
}

function formatBytes(b) {
  if (!b || b < 1024) return (b | 0) + ' B';
  if (b < 1024 * 1024) return (b / 1024).toFixed(1) + ' KB';
  return (b / (1024 * 1024)).toFixed(1) + ' MB';
}
```

If `formatBytes` already exists elsewhere in `rasicross.js` (check with Grep), reuse it and skip the redefinition.

- [ ] **Step 6: Verify lint + node-check + tests**

Run: `node --check rasicross.js` → exit 0.
Run: `npm run lint` → 0 errors.
Run: `npm test` → 44 passes.

Run: `Grep` for pattern `setTilesEnabled|setTilesUrl|tilesClearBtn` in both `rasicross.js` and `RasiCross_Telemetry.html`. Expected: each ID present in both files at least once.

- [ ] **Step 7: Commit**

```
git add RasiCross_Telemetry.html rasicross.js
git commit -m "feat(tiles): Settings tab module — toggle, URL template, clear cache

Adds a 'Karten-Hintergrund' pw-module to the Settings tab with the
global enable switch, the {z}/{x}/{y} URL-template input (live-validated
hint), and a 'Cache leeren' action. URL-template empty -> OSM default.
Toggle change triggers an immediate drawTrack() so the user sees the
effect without a tab switch. Clearing the cache also clears the
renderer's in-memory map and refreshes the Strecken-Tab list (Task 7
will use that refresh to update the per-track status line).

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 7: Strecken-Tab — per-track status line, auto-cache on save, manual button

**Files:**
- Modify: `rasicross.js` (`renderSavedTracks` injection of status+button; `saveCurrentTrack` auto-cache trigger; `onProgress` toast)

- [ ] **Step 1: Locate `renderSavedTracks` and study its row markup**

Run: `Grep` for pattern `function renderSavedTracks` in `rasicross.js`, output_mode content, -n true.

Read 60 lines starting at the hit. Identify where one row of a saved track is built — the per-row `innerHTML` or DOM-construction block. Note which attributes carry the track id (`data-id`, the `id`, etc.) so the new status+button can attach.

- [ ] **Step 2: Add a tile-status helper function**

Insert near `renderSavedTracks` (above its definition is fine):

```javascript
const TILE_Z_MIN = 16, TILE_Z_MAX = 18;

function _activeTileTemplate() {
  const t = (state.settings && state.settings.tiles && state.settings.tiles.urlTemplate) || '';
  if (t && t.indexOf('{z}') >= 0 && t.indexOf('{x}') >= 0 && t.indexOf('{y}') >= 0) return t;
  return 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
}
function _activeTileHost() {
  try { return new URL(_activeTileTemplate()).host || 'unknown'; }
  catch (_) { return 'unknown'; }
}

async function refreshTrackTileStatus(trackId) {
  const slotId = 'trackTileStatus_' + trackId;
  const slot = document.getElementById(slotId);
  if (!slot) return;
  if (!window.rasiTiles) { slot.textContent = 'Tile-Cache nur in Desktop-App'; return; }
  const t = state.savedTracks.find(x => x.id === trackId);
  if (!t || !t.bounds) { slot.textContent = ''; return; }
  try {
    const r = await window.rasiTiles.areaStats({
      host: _activeTileHost(),
      bbox: t.bounds, zMin: TILE_Z_MIN, zMax: TILE_Z_MAX,
    });
    if (r.total === 0) { slot.textContent = ''; return; }
    if (r.missing === 0) {
      slot.textContent = `Karte: ${r.cached}/${r.total} Tiles · ${formatBytes(r.bytes)}`;
    } else {
      slot.textContent = `Karte: ${r.cached}/${r.total} Tiles — ${r.missing} fehlen`;
    }
  } catch (e) {
    slot.textContent = '';
  }
}

let _tileCacheRun = null;  // { trackId, running, done, total }

async function startTrackTileCache(trackId) {
  if (!window.rasiTiles) {
    rcAlert('Tile-Cache nur in der Desktop-App verfügbar.', 'Karte');
    return;
  }
  if (_tileCacheRun && _tileCacheRun.running) {
    rcToast('Tiles werden bereits geladen — bitte warten.');
    return;
  }
  const t = state.savedTracks.find(x => x.id === trackId);
  if (!t || !t.bounds) return;
  _tileCacheRun = { trackId, running: true, done: 0, total: 0 };
  const btn = document.getElementById('trackTileBtn_' + trackId);
  if (btn) { btn.disabled = true; btn.textContent = 'Lade …'; }
  try {
    if (window.rasiTiles.onProgress) {
      window.rasiTiles.onProgress(function (p) {
        if (!_tileCacheRun) return;
        _tileCacheRun.done = p.done; _tileCacheRun.total = p.total;
        if (btn) btn.textContent = `${p.done} / ${p.total}…`;
      });
    }
    const r = await window.rasiTiles.cacheArea({
      host: _activeTileHost(),
      bbox: t.bounds,
      urlTemplate: _activeTileTemplate(),
      zMin: TILE_Z_MIN, zMax: TILE_Z_MAX,
    });
    if (r.errors > 0) {
      rcToast(`Tiles geladen: ${r.done}/${r.total} (${r.errors} Fehler)`);
    } else if (r.cancelled) {
      rcToast(`Abgebrochen: ${r.done}/${r.total} Tiles`);
    } else {
      rcToast(`Karte für "${t.name}" geladen (${r.done} Tiles)`);
    }
  } catch (e) {
    rcAlert('Tiles konnten nicht geladen werden: ' + (e && e.message ? e.message : e), 'Karte');
  } finally {
    _tileCacheRun = null;
    if (btn) { btn.disabled = false; btn.textContent = 'Tiles aktualisieren'; }
    await refreshTrackTileStatus(trackId);
    try { drawTrack(); } catch (e) {}
  }
}
```

- [ ] **Step 3: Inject the status line + button into each saved-track row**

In `renderSavedTracks`, locate the per-row block (identified in Step 1). Augment each row's HTML so that — at the end of the row, on its own line/sub-element — it contains:

```html
<div class="track-tile-status">
  <span id="trackTileStatus_<TRACK_ID>" class="pw-hint">…</span>
  <button id="trackTileBtn_<TRACK_ID>" class="pw-btn pw-btn--ghost">Tiles aktualisieren</button>
</div>
```

Where `<TRACK_ID>` is the saved track's `id` (the same id used by the existing Load/Delete buttons in that row). Match the exact innerHTML template — likely template-string with `${t.id}` substitutions, given the existing row code.

After the loop that builds the rows, append:

```javascript
  // Wire each row's Tiles-button + trigger a status fetch
  for (const t of state.savedTracks) {
    const btn = document.getElementById('trackTileBtn_' + t.id);
    if (btn) btn.onclick = function () { startTrackTileCache(t.id); };
    refreshTrackTileStatus(t.id);  // async, fills the slot
  }
```

- [ ] **Step 4: Auto-cache on `saveCurrentTrack`**

Read `rasicross.js` around `async function saveCurrentTrack()` (was line 802 at plan time). At the very end of the function — **after** `rcToast(\`Strecke "${name}" gespeichert\`);` — append:

```javascript
  // Phase 17: kick off a background tile-cache for the saved track.
  // Non-blocking, no await — the save itself is already complete.
  try {
    const newTrack = state.savedTracks[0];  // unshift placed it at index 0
    if (newTrack && newTrack.bounds && window.rasiTiles) {
      startTrackTileCache(newTrack.id);
    }
  } catch (e) { /* silent — manual button is the fallback */ }
```

- [ ] **Step 5: Verify lint + node-check + tests**

Run: `node --check rasicross.js` → exit 0.
Run: `npm run lint` → 0 errors.
Run: `npm test` → 44 passes.

Run: `Grep` for pattern `trackTileBtn_|trackTileStatus_|startTrackTileCache` in `rasicross.js`. Expected: each name present, with `startTrackTileCache` called both from the per-row click handler and from `saveCurrentTrack`.

- [ ] **Step 6: Commit**

```
git add rasicross.js
git commit -m "feat(tiles): per-track status line + auto-cache on save + manual button

Each saved track gets a 'Karte: X/Y Tiles · Z MB' status (derived from
disk via rasi-tiles:areaStats) and a 'Tiles aktualisieren' button.
'Strecke speichern' now triggers an in-the-background tile-cache run
for the new track's bbox at zoom 16-18; the save itself stays
non-blocking. Progress is surfaced inline on the button and concluded
via rcToast. Browser-mode (no window.rasiTiles) shows a clear inline
note instead of the action.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 8: Live tab — `M`-quick-toggle button

**Files:**
- Modify: `RasiCross_Telemetry.html` (Live map module gets an `M` button overlay)
- Modify: `rasicross.js` (toggle handler)
- Modify: HTML / CSS for the absolute-positioned overlay if no suitable class exists

- [ ] **Step 1: Locate the Live `trackCanvas` container**

Run: `Grep` for pattern `id="trackCanvas"` in `RasiCross_Telemetry.html`, output_mode content, -n true, -C 2.

The canvas is inside a `<div class="map">` (was HTML line 2315 at plan time). The button is added inside this container so it can be absolutely positioned over the canvas via CSS.

- [ ] **Step 2: Insert the M-button into the map container**

Replace the existing `<div class="map"><canvas id="trackCanvas"></canvas></div>` with (using `Edit` against the fresh-Read anchor):

```html
<div class="map">
  <canvas id="trackCanvas"></canvas>
  <button id="liveTileToggle" class="map-toggle" title="Karten-Hintergrund umschalten" aria-label="Karten-Hintergrund umschalten">M</button>
</div>
```

- [ ] **Step 3: Add the CSS for the toggle**

Run: `Grep` for pattern `\.pw-map|\.map\s*\{|\.map-toggle` in `RasiCross_Telemetry.html`, output_mode content, -n true.

If `.map-toggle` already exists from a prior phase: nothing to do. If not: locate the existing `.map { ... }` rule (or the closest `pw-`/Live-tab CSS block) and append a new rule. Use `Edit` against the fresh-Read anchor for an appropriate `</style>` predecessor or extend an existing rule region:

```css
.map { position: relative; }
.map-toggle {
  position: absolute;
  top: 6px;
  left: 6px;
  width: 26px;
  height: 26px;
  border-radius: 50%;
  border: 1px solid var(--line);
  background: rgba(0,0,0,.55);
  color: var(--fg);
  font: 700 12px/1 monospace;
  cursor: pointer;
  opacity: .8;
  z-index: 2;
}
.map-toggle.off { opacity: .4; }
.map-toggle:hover { opacity: 1; }
```

(The `.map { position: relative; }` line is required for the absolute positioning to anchor; if `.map` already has `position: relative` set elsewhere, drop that line from the addition.)

- [ ] **Step 4: Wire the button in `rasicross.js`**

Insert in the same init/wire block where Task 6 added `setTilesEnabled` listener:

```javascript
  if ($('liveTileToggle')) {
    const btn = $('liveTileToggle');
    function applyLiveTileToggleClass() {
      if (!state.settings.tiles) return;
      btn.classList.toggle('off', !state.settings.tiles.liveQuickToggle);
    }
    applyLiveTileToggleClass();
    btn.addEventListener('click', function () {
      if (!state.settings.tiles) state.settings.tiles = { enabled: true, urlTemplate: '', liveQuickToggle: true };
      state.settings.tiles.liveQuickToggle = !state.settings.tiles.liveQuickToggle;
      applyLiveTileToggleClass();
      saveData();
      try { drawTrack(); } catch (e) {}
    });
  }
```

- [ ] **Step 5: Verify lint + node-check + tests**

Run: `node --check rasicross.js` → exit 0.
Run: `npm run lint` → 0 errors.
Run: `npm test` → 44 passes.

Run: `Grep` for pattern `liveTileToggle` in both `rasicross.js` and `RasiCross_Telemetry.html`. Expected: present in both.

- [ ] **Step 6: Commit**

```
git add RasiCross_Telemetry.html rasicross.js
git commit -m "feat(tiles): Live trackCanvas 'M' quick-toggle for tile background

Small absolute-positioned M-button overlays the Live map module. Click
flips state.settings.tiles.liveQuickToggle (persisted) and re-renders.
Inactive state is shown via reduced opacity. Only affects trackCanvas;
scanCanvas continues to honour the global Settings toggle. Implements
spec §5.5 'Live-Tab quick toggle'.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 9: Build packaging + README + plan-doc commit

**Files:**
- Modify: `package.json` (include `tiles.js` + `tile-renderer.js` in `build.files`)
- Modify: `README.md` (new "Karten-Hintergrund (OSM)" subsection)
- Add to git: this plan document (final ritual commit)

- [ ] **Step 1: Add the two new JS files to `package.json` build.files**

Read `package.json` around the `build.files` array (was lines 31-41 at plan time, listing `main.js`, `preload.js`, `RasiCross_Telemetry.html`, `rasicross.js`, `geo.js`, `replay.js`, `karts3d.js`, etc.).

Edit the array to also include `"tiles.js"` and `"tile-renderer.js"`. Anchor on the fresh-Read text — likely insert next to `"karts3d.js"` so all UMD modules sit together. Resulting region (example only — confirm against your Read):

```json
    "files": [
      "main.js",
      "preload.js",
      "RasiCross_Telemetry.html",
      "rasicross.js",
      "geo.js",
      "replay.js",
      "karts3d.js",
      "tiles.js",
      "tile-renderer.js",
      "dom-targets.js",
      "vendor/**",
      "icon.ico"
    ],
```

(`dom-targets.js` was added in Phase 16; verify it's in your fresh Read.)

- [ ] **Step 2: Add the README subsection**

Read `README.md` around the existing "Eigenes 3D-Modell hochladen" subsection (within "## Erweiterte Dashboard-Features").

Append a new subsection (use `Edit` with an anchor on the heading **after** which you want to insert — i.e. find the next `### ` heading and put the new block above it; or place it at the end of the "Erweiterte Dashboard-Features" section if there is no more sub-heading there):

```markdown
### Karten-Hintergrund (OSM, offline-fähig)

Über der Track-Karte wird ein OpenStreetMap-Raster-Hintergrund eingeblendet,
sobald für eine Strecke Tiles vorliegen.

- **Auto-Cache:** Beim Klick auf *"Strecke speichern"* lädt das Dashboard im
  Hintergrund alle Tiles für die Streckengrenzen (Zoom 16–18, typisch
  40–80 Tiles, ~1–2 MB). Voraussetzung: Internet zum Zeitpunkt des
  Speicherns.
- **Offline:** Sobald die Tiles im Cache sind, wird die Karte komplett ohne
  Netzwerk gerendert — ideal für die Boxengasse ohne Empfang.
- **Manueller Refresh:** Im Strecken-Tab steht neben jeder Strecke ein
  *Tiles aktualisieren*-Knopf mit Status („Karte: 42/42 Tiles · 1,3 MB").
- **Live-Schalter:** Kleiner *M*-Knopf links oben auf der Live-Karte schaltet
  den Hintergrund während des Rennens an/aus.
- **Eigene Tile-URL:** In den Einstellungen → *"Karten-Hintergrund"* lässt sich
  eine eigene `{z}/{x}/{y}`-URL (z. B. MapTiler, Stadia, Carto) hinterlegen.
  Leer = OpenStreetMap Standard.
- **Cache leeren:** Settings → *"Cache leeren"* entfernt alle gecachten Tiles
  von der Festplatte (`userData/tiles/`).

> Karten © [OpenStreetMap-Mitwirkende](https://www.openstreetmap.org/copyright).
> Bei eigener Tile-URL gelten die Lizenzbedingungen des jeweiligen Anbieters.
> Die Browser-Variante (`RasiCross_Telemetry.html` direkt im Browser) hat
> dieses Feature nicht — es ist Desktop-App only.
```

- [ ] **Step 3: Optional — bump the "Test-Suite"-Zeile in README to the new count**

Run: `Grep` for pattern `Unit-Tests laufen automatisch|70 Unit-Tests|44 JS` in `README.md`, output_mode content, -n true.

If the README mentions a JS-test count (line ~29 was `70 Unit-Tests (36 JS, 34 Python)` at plan time), update it to the new total (e.g. `78 Unit-Tests (44 JS, 34 Python)`). Use `Edit` with the fresh-Read anchor.

- [ ] **Step 4: Run the full verification recipe**

```
node --check tiles.js tile-renderer.js geo.js replay.js karts3d.js dom-targets.js rasicross.js main.js preload.js
npm test
npm run lint
python -m py_compile sender.py bridge.py esp_libs/*.py
python -m unittest discover -s test -p "test_*.py"
```

All five commands must exit 0. `npm test` should report **44** tests passing. `python -m unittest` should report `Ran 34 tests` `OK`. Delete `__pycache__` (and `**/__pycache__`) before `git status`.

- [ ] **Step 5: Final commit (this plan document + README + package.json)**

```
git add package.json README.md docs/superpowers/plans/2026-05-28-17-osm-tile-background.md
git commit -m "docs+build(tiles): README section, package.json build.files, Phase 17 plan

Adds 'Karten-Hintergrund (OSM)' subsection under Erweiterte
Dashboard-Features documenting the per-track tile cache, the M-toggle,
the URL-template override, and the OSM attribution. Includes tiles.js
and tile-renderer.js in the electron-builder file list so they land in
release builds. Commits the Phase 17 implementation plan.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Hardware / Manual Acceptance Checklist

(Run after all 9 tasks land. Mirrors spec §6.4.)

- [ ] Fresh install of the built `.exe`. Settings → "Karten-Hintergrund" module visible; switch is on by default; URL field empty; hint reads "Leer = OSM Standard wird verwendet."
- [ ] No track exists yet → Live-Karte still shows "Noch keine Strecke", no attribution, no tile fetches in the console.
- [ ] Online, scan + save a track called "Test". Toast progress on the *Tiles aktualisieren*-button shows "17 / 42…" (numbers depend on bbox). On completion, toast says `Karte für "Test" geladen (42 Tiles)` and the Strecken-Tab status line shows `Karte: 42/42 Tiles · ~1,3 MB`.
- [ ] Restart app **with WLAN off**. Open the "Test" track. Tiles appear under the polyline; "© OpenStreetMap-Mitwirkende" visible bottom-right of the canvas; GPS dot moves correctly on top of tiles when fed demo data.
- [ ] Live tab: click the `M`-button top-left of the map. Tiles disappear from `trackCanvas` only; `scanCanvas` on the Strecke-Tab still shows them. Button opacity reduces to 40 %. Click again → tiles return, opacity full.
- [ ] Settings → "Cache leeren" → confirm dialog → toast `42 Tiles entfernt (1,3 MB)`. Strecken-Tab status updates to `Karte: 0/42 Tiles — 42 fehlen`. The Live-Karte is suddenly back to flat background (no tiles, no attribution).
- [ ] Settings → URL-Template → enter a MapTiler / Stadia URL with `{z}/{x}/{y}` and an API key → save → Strecken-Tab "Tiles aktualisieren" on the "Test" track → new host's tiles fetched (visible style change). Switch URL field back to empty → the previously cached OSM tiles still on disk are reused (no re-download).
- [ ] Enter a bogus URL template (`https://example.com/tiles`) into Settings → hint turns red, says "Vorlage muss {z}, {x}, {y} enthalten." Default URL is still used for actual fetches.
- [ ] Browser mode: open `RasiCross_Telemetry.html` directly in Chrome (no Electron) → Settings module's "Cache leeren" button alert reads "Tile-Cache nur in der Desktop-App verfügbar." `M`-toggle still works (state persists across reload). All other features unchanged.
- [ ] ESP firmware: untouched — `npm test` still 44 passes, `python -m unittest` still 34 passes, `python -m py_compile` clean.

---

## Self-Review

**1. Spec coverage:**
- T1 (tiles.js + tests) → Task 1.
- T2 (Web-Mercator gpsXYOnCanvas) → Task 2.
- T3 (tile-renderer.js + paintTilesOn) → Tasks 4 + 5.
- T4 (Electron IPC) → Task 3.
- T5 (auto-cache on save + manual button + status) → Task 7.
- T6 (Settings UI toggle + URL + clear) → Task 6.
- T7 (Live M-toggle + attribution) → Tasks 5 (attribution) + 8 (toggle).
- T8 (README) → Task 9.
- Build packaging + ESLint config: Task 9 + 4.

All spec items covered. ✅

**2. Placeholder scan:** No `TBD`/`TODO`/`implement later`/`placeholder`. Every code step contains complete literal code, every command has expected output. The only template-style markers (`<TRACK_ID>` in Task 7 Step 3) are explicitly defined in that same step as "the saved track's `id`, same id used by the existing Load/Delete buttons" — a "read first, then copy" instruction, not a hand-wave. ✅

**3. Type-name consistency:**
- Settings slice: `state.settings.tiles.{enabled, urlTemplate, liveQuickToggle}` used identically in Tasks 4, 5, 6, 7, 8.
- IPC channels: `rasi-tiles:fetch | :cacheArea | :areaStats | :clearAll | :cancel` consistent in Tasks 3 and 4.
- Renderer API: `RasiTileRenderer.init|ensureBbox|paintTilesOn|clearMemory` consistent in Tasks 4, 5, 6.
- Math API: `RasiTiles.lonToGlobalX|latToGlobalY|globalXToLon|globalYToLat|tilesForBbox|pickZoom|bboxToCanvasTransform|TILE_SIZE` consistent in Tasks 1, 2, 4.
- Element IDs: `setTilesEnabled`, `setTilesUrl`, `setTilesUrlHint`, `tilesClearBtn`, `tilesCacheInfo`, `trackTileStatus_<id>`, `trackTileBtn_<id>`, `liveTileToggle` consistent across HTML (Tasks 6, 7, 8) and JS (Tasks 6, 7, 8). ✅

**4. Scope check:** Single phase, single feature. All in-scope spec items have tasks; no out-of-scope work (browser IndexedDB, vector tiles, pan/zoom, eviction) leaked in. ✅

---

## Phase Map

| Phase | Scope | Files | Status |
|-------|-------|-------|--------|
| 1-16 | (see prior plans) | — | merged to main / on `feat/tab-redesign-pitwall` |
| **17** (this plan) | OSM Tile Background + Per-Track Cache | `tiles.js`, `tile-renderer.js`, `test/test-tiles.js`, `main.js`, `preload.js`, `rasicross.js`, `RasiCross_Telemetry.html`, `package.json`, `eslint.config.js`, `README.md` | **pending** |

D2 (multi-kart) and the on-disk session library (C1-Option-3) remain deferred.
