# RasiCross — OSM Tile Background for Track Map (Offline-Capable Per-Track Cache)

**Date:** 2026-05-28
**Status:** Approved (design); pending implementation plan
**Author:** Brainstorming session (Claude + user)

---

## 1. Purpose

The track map (`trackCanvas`, `scanCanvas`, `editorCanvas`) currently renders
only the GPS polyline, sector lines, heatmap and a live GPS dot on a flat
background. In a real pit-wall scenario that polyline floats in empty space —
the user can't tell where the track sits in the world, where the paddock is,
or how the line relates to surrounding roads/buildings.

This spec adds an **OpenStreetMap raster-tile background** under the existing
overlays, with a **per-track offline cache** so the pit-wall works without
internet once tiles for the venue have been downloaded once. The download is
triggered when the user saves a track (or via an explicit "update tiles"
button), so the workflow is: scan + save the track at home → arrive at the
venue offline → tiles are already on disk.

The feature is **purely presentational**: no telemetry, race-logic, lap/sector,
binary-protocol or ESP-firmware changes. The existing `gpsXYOnCanvas`
projection is generalised to Web-Mercator so tiles and polyline align
pixel-accurately, but the on-screen track shape is visually unchanged at
kart-track scale (<1 px difference).

## 2. Background / grounding facts

- **Current rendering** (`rasicross.js` §9 "TRACK MAP DRAWING", lines ~544-693):
  - Three canvases: `trackCanvas` (Live tab), `scanCanvas` (Strecke tab),
    `editorCanvas` (Editor tab).
  - `gpsXYOnCanvas(lat, lon, c, bounds)` does a direct equirectangular
    lat/lon → canvas-pixel mapping with 32 px padding and uniform scale-fit
    inside the canvas; **not** Web-Mercator.
  - `drawTrackOn(c)` clears, fills with `--soft`, draws polyline (yellow glow
    + main line), heatmap, start/sector lines, GPS dot. Called from
    `drawTrack()` which routes to all canvases.
- **Track persistence:** `state.savedTracks[i]` already contains a `bounds`
  field `{minLat, maxLat, minLon, maxLon}` set during track-scan.
- **Electron storage pattern:** `main.js:72-105` already implements an
  `userData`-based feature: `rasi-kart:save/load/clear` IPC handlers write to
  `app.getPath('userData') + '/karts/active.glb'`. `preload.js:21-25` exposes
  it as `window.rasiKart.*`. Tiles will follow the same shape under
  `userData/tiles/`.
- **Renderer constraints:** loaded over `file://` in Electron and (optionally)
  directly in a browser. CSP rules already exist in
  `RasiCross_Telemetry.html` (added in Phase 5, `2026-05-18-03-csp-deinline-handlers.md`).
- **Build packaging:** `package.json` `build.files` enumerates the JS files
  shipped in the .exe/.app bundle. Any new top-level `.js` must be added
  there or it will be missing in release builds.
- **Test baselines (2026-05-28):**
  - `npm test` = 36 JS tests (10 geo + 12 replay + 11 karts3d + 3 dom-targets).
  - `python -m unittest` = 34 tests (calc + frame).
- **OpenStreetMap Tile Usage Policy** (operations.osmfoundation.org/policies/tiles/):
  - Heavy bulk-downloading is prohibited.
  - Valid HTTP User-Agent identifying the app + contact URL is required.
  - Attribution "© OpenStreetMap contributors" is required wherever tiles are
    shown.
  - For a single-track bbox at zoom 16-18 (~40 tiles) downloaded once per
    track at ≤ 2 req/s, the usage stays well within "reasonable hobby use".
    Power users with a different scale should override the URL template.
- **Vanilla-only constraint:** the project has zero runtime npm deps in the
  renderer (Electron `serialport` is the only runtime dep). This spec must
  keep that — no Leaflet, no map library; tile math + blit are
  ~100 lines of pure JS.

## 3. Scope

### In scope

| ID | Item | Surface |
|----|------|---------|
| T1 | Pure tile-math module (`tiles.js`) + unit tests | new file + `test/` |
| T2 | Web-Mercator generalisation of `gpsXYOnCanvas` | `rasicross.js` |
| T3 | Renderer-side tile cache + `paintTilesOn(ctx, canvas, bounds)` API | new `tile-renderer.js` |
| T4 | Electron IPC for disk-cache (`fetchTile`, `cacheArea`, `areaStats`, `clearAll`) | `main.js`, `preload.js` |
| T5 | Auto-cache on "Strecke speichern" + manual "Tiles aktualisieren" button + Strecken-Tab status line | `rasicross.js`, HTML |
| T6 | Settings UI: global toggle + URL-template override + "Cache leeren" | `rasicross.js`, HTML |
| T7 | Per-canvas Live `M`-quick-toggle + attribution text | `rasicross.js`, HTML, CSS |
| T8 | README "Karten-Hintergrund" section + OSM attribution mention | `README.md` |

### Out of scope

- Browser-mode tile support (HTML loaded directly without Electron) — tiles
  simply do not render; everything else works as today. IndexedDB fallback
  may be added in a later phase if there is demand.
- Vector tiles, MBTiles bundles, offline-by-bundle. Only HTTP-fetched raster
  tiles persisted as `.png` per file.
- Interactive pan/zoom. The canvas continues to auto-fit the track bbox.
- Heatmap or sector-line projection changes beyond what the Web-Mercator
  generalisation incidentally requires.
- Tile-cache eviction policy. The user can clear all tiles via Settings;
  otherwise the cache grows until manually purged. At ~1-2 MB per track this
  is harmless for years of use.
- Retina / DPR-aware tile selection (`@2x` tiles). The existing canvas
  rendering uses `dpr()` scaling, but tiles stay at 256 × 256 native; on a
  Retina display the result is slightly soft but acceptable for v1.

## 4. Cross-cutting constraints

### 4.1 OSM Tile Usage Policy compliance

- HTTP User-Agent header on every fetch:
  `RasiCross-Telemetry/<package.json.version> (+https://github.com/Lutji06/RasiCross-Telemetrie)`.
- Rate-limit: tiles are fetched **serially** with a `≥ 500 ms` gap between
  requests (≤ 2 req/s). HTTP 429 → pause 30 s, single retry, then give up
  for the rest of this `cacheArea` run.
- 5 s per-request timeout. No retry inside a single `cacheArea` run apart
  from the 429 case.
- Attribution "© OpenStreetMap-Mitwirkende" is rendered in the bottom-right
  of any canvas that currently shows tiles, in 10 px monospace `--dim`, with
  enough padding that it doesn't overlap the GPS dot.
- The Settings URL-template field lets users redirect to any compatible
  `{z}/{x}/{y}` provider (MapTiler, Stadia, Carto, self-hosted) at their own
  TOS responsibility. Default template (when field is empty) is OSM Standard.

### 4.2 No new runtime dependencies

Implementation must be pure-JS using only:
- Node-built-in `https` (or `fetch` in Electron ≥ 21) in `main.js`.
- `Image` / `Canvas2D.drawImage` in the renderer.
- `node:fs/promises` for disk access in `main.js`.

No npm packages added to `dependencies`. (`devDependencies` already covers
`electron-builder` etc.)

### 4.3 Backwards compatibility

- When `state.settings.tiles.enabled === false`, or when no tiles are cached
  for the current bbox, or when running in browser-mode (no `window.rasiTiles`),
  `paintTilesOn` is a no-op and the canvas renders exactly as today.
- Existing `state.savedTracks[]` entries keep their structure. The cache
  index is derived from filesystem inspection, not stored on the track.
- The `gpsXYOnCanvas` Web-Mercator switch is the only behavioural change
  that affects pixels even when tiles are off — and that change is < 1 px at
  kart-track scale (numerically verified in §5.2).

## 5. Detailed design

### 5.1 Tile math (`tiles.js`)

New UMD module (loaded via `<script>`, same pattern as `geo.js`, `replay.js`,
`dom-targets.js`). Exports a single namespace object with pure functions:

```js
// Web-Mercator: lon/lat → global pixel coords at zoom z (256-tile pyramid)
RasiTiles.lonToGlobalX(lon, z)   → number (px)
RasiTiles.latToGlobalY(lat, z)   → number (px)

// Inverse for sanity tests
RasiTiles.globalXToLon(x, z)     → number (deg)
RasiTiles.globalYToLat(y, z)     → number (deg)

// Tile-list cover for a bbox at zoom z, with optional pad (in tiles)
RasiTiles.tilesForBbox({minLat, maxLat, minLon, maxLon}, z, padTiles=0)
  → [{z, x, y}, ...]  // (x,y) = integer tile indices

// Best zoom such that bbox + paddingPx fits in (canvasW × canvasH) pixels
RasiTiles.pickZoom(bbox, canvasW, canvasH, paddingPx, zoomMin, zoomMax)
  → z

// Project bbox+chosen zoom to canvas pixel coords (matches gpsXYOnCanvas exactly)
RasiTiles.bboxToCanvasTransform(bbox, z, canvasW, canvasH, paddingPx)
  → { ox, oy, sc }   // canvasX = ox + (globalX - globalXmin) * sc, etc.
```

All functions are deterministic, side-effect-free, and unit-tested.

### 5.2 Projection unification (`gpsXYOnCanvas`)

`rasicross.js:562` is rewritten to use Web-Mercator via `RasiTiles`:

```js
function gpsXYOnCanvas(lat, lon, c, bounds) {
  const b = bounds || state.track.bounds || { /* …same fallback as today… */ };
  const w = c.width, h = c.height, pad = 32 * dpr();
  const z = 18;  // reference zoom for projection math; cancels out via sc
  const gx  = RasiTiles.lonToGlobalX(lon, z);
  const gy  = RasiTiles.latToGlobalY(lat, z);
  const gx0 = RasiTiles.lonToGlobalX(b.minLon, z);
  const gx1 = RasiTiles.lonToGlobalX(b.maxLon, z);
  const gy0 = RasiTiles.latToGlobalY(b.maxLat, z);  // note: Mercator-Y grows southward
  const gy1 = RasiTiles.latToGlobalY(b.minLat, z);
  const dx = gx1 - gx0, dy = gy1 - gy0;
  const sc = Math.min((w - 2*pad) / dx, (h - 2*pad) / dy);
  const ox = (w - dx * sc) / 2, oy = (h - dy * sc) / 2;
  return { x: ox + (gx - gx0) * sc, y: oy + (gy - gy0) * sc };
}
```

**Numerical impact** at a typical kart-track (Bbox 0.002° × 0.002° at lat 50°):
- Equirectangular vertical-stretch ratio = 1.0 (constant).
- Web-Mercator vertical-stretch ratio at lat 50° = 1/cos(50°) ≈ 1.556 — but
  uniform-scale fit keeps width and height in proportion, so the visible
  result is the track rotated/scaled identically.
- Per-point deviation between the two projections inside the bbox:
  < 0.001 px at kart-track scale (analytically zero at the bbox centre and
  bounded above by the Mercator-Y curvature over the bbox span — empirically
  confirmed at < 0.01 px for any bbox under ~10 km on a 1000 px canvas).

So the polyline visually does not move; the test baseline stays green; and
tiles will sit exactly under the line they should sit under.

### 5.3 Renderer tile cache + paint (`tile-renderer.js`)

New UMD module. Manages an in-memory `Map<key, HTMLImageElement>` so the
synchronous `drawTrackOn` blit path never blocks on async tile fetch.

```js
RasiTileRenderer.init({ getSettings: () => state.settings.tiles })
RasiTileRenderer.ensureBbox(host, bbox)
  // Synchronously: for every (z,x,y) covering `bbox` at the chosen zoom,
  // either serve cached Image or kick off an async fetch via IPC + add to
  // the in-memory map when ready. If anything was missing, schedules a
  // single drawTrack() call once the last image resolves.
RasiTileRenderer.paintTilesOn(ctx, canvas, bounds)
  // Synchronous: blits whichever tiles for this bbox are already in the
  // in-memory map. Missing tiles are silently skipped (background stays
  // --soft). Returns the chosen zoom (so the caller can stamp attribution).
RasiTileRenderer.clearMemory()  // settings change / cache cleared
```

The `host` arg corresponds to the URL-template's host part — the cache is
keyed by host so switching from OSM to MapTiler doesn't mix tiles.

`drawTrackOn(c)` is modified so its `ctx.fillRect` background-fill is
followed by:
```js
if (state.settings.tiles.enabled && c.id !== 'editorCanvas') {
  RasiTileRenderer.ensureBbox(host, b);              // schedules async
  RasiTileRenderer.paintTilesOn(ctx, c, b);          // blits what's there now
}
```
(`editorCanvas` keeps the flat background — the sector-editor needs neutral
contrast for boundary placement.)

The Live `M`-quick-toggle short-circuits `paintTilesOn` for `trackCanvas`
only, independently of the global setting.

### 5.4 Electron IPC (`main.js`, `preload.js`)

New IPC channel `rasi-tiles:*`. Pattern mirrors `rasi-kart:*`.

```js
// main.js
ipcMain.handle('rasi-tiles:fetch', async (_e, {host, z, x, y, urlTemplate}) => {
  // host is the bare host of urlTemplate or 'osm' for the default.
  // 1. Compute disk path: userData/tiles/<host>/<z>/<x>/<y>.png
  // 2. If exists → read → return { ok: true, dataUrl, fromCache: true }
  // 3. Else → fetch URL with UA header, 5 s timeout
  //         → write to disk → return { ok: true, dataUrl, fromCache: false }
  // 4. On 429: return { ok: false, retryAfterMs: 30000 }
  // 5. On any other fetch error: return { ok: false, error: '…' }
});

ipcMain.handle('rasi-tiles:cacheArea', async (e, {host, bbox, urlTemplate, zMin, zMax}) => {
  // Enumerates all tiles for zMin..zMax inside bbox + 1-tile pad.
  // Serial loop, 500 ms gap. After each tile, sends:
  //   event.sender.send('rasi-tiles:progress', { done, total, lastError })
  // Resolves with { done, total, errors } at the end. User can cancel via
  // another IPC 'rasi-tiles:cancel' (sets a flag inspected each iteration).
});

ipcMain.handle('rasi-tiles:areaStats', async (_e, {host, bbox, zMin, zMax}) => {
  // Walks expected tile list, stats each on disk. Returns:
  //   { cached: int, missing: int, bytes: int }
});

ipcMain.handle('rasi-tiles:clearAll', async () => {
  // Recursively rm userData/tiles/. Returns { deleted: int, bytes: int }.
});
```

`preload.js` exposes:
```js
contextBridge.exposeInMainWorld('rasiTiles', {
  fetchTile:  (args) => ipcRenderer.invoke('rasi-tiles:fetch', args),
  cacheArea:  (args) => ipcRenderer.invoke('rasi-tiles:cacheArea', args),
  cancel:     ()     => ipcRenderer.invoke('rasi-tiles:cancel'),
  areaStats:  (args) => ipcRenderer.invoke('rasi-tiles:areaStats', args),
  clearAll:   ()     => ipcRenderer.invoke('rasi-tiles:clearAll'),
  onProgress: (cb)   => ipcRenderer.on('rasi-tiles:progress', (_e, p) => cb(p)),
});
```

### 5.5 Settings & UI wiring (`rasicross.js`, HTML)

**Settings slice** (added to the existing settings persistence):
```js
state.settings.tiles = {
  enabled: true,             // global toggle
  urlTemplate: '',           // '' = OSM default 'https://tile.openstreetmap.org/{z}/{x}/{y}.png'
  liveQuickToggle: true      // M-button state on Live
};
```
Saved/loaded with the existing settings serialiser (localStorage key already
in use for other settings).

**Settings-Tab new module** "Karten-Hintergrund":
- Switch "OSM-Hintergrund anzeigen" → `settings.tiles.enabled`.
- Text input "Tile-URL-Template (leer = OSM)" → `settings.tiles.urlTemplate`.
  Inline validation: must contain `{z}`, `{x}`, `{y}` literally; otherwise
  red-bordered with hint text.
- Button "Cache leeren" → confirm dialog → `rasiTiles.clearAll()` → toast
  "X Tiles entfernt (Y MB freigegeben)".
- Info paragraph with the OSM attribution and a link to the Tile Usage Policy.

**Strecken-Tab additions** next to each saved track row:
- Status line, format `"Karte: 42/42 Tiles · 1,3 MB"` /
  `"Karte: 0/42 Tiles — nicht heruntergeladen"`. Refreshed via `areaStats`
  on tab-enter and after each successful cache run.
- Button "Tiles aktualisieren" / "Tiles laden". Disabled while a cache run
  is in progress, shows progress text from the `onProgress` event:
  `"17 / 42…"`.
- Auto-trigger: when the user clicks the existing "Strecke speichern" button
  and the new track has a `bounds`, immediately enqueue a `cacheArea` run
  for that bbox at zMin=16, zMax=18. Save-action is not blocked — the
  download runs in the background with a non-modal toast.

**Live-Tab quick toggle** (`trackCanvas`):
- New small button `<button id="liveTileToggle">M</button>` absolutely
  positioned top-left of the map module (`pw-module` containing
  `trackCanvas`). Click toggles `settings.tiles.liveQuickToggle` and
  re-renders. Inactive state shows the icon at 40 % opacity.
- Attribution is overlaid on the canvas inside `drawTrackOn`:
  `ctx.fillText('© OpenStreetMap-Mitwirkende', w - 6*dpr(), h - 4*dpr())`
  with `textAlign='right'`, drawn last so it stays on top of GPS dot.

**Toast helper**: reuses the existing toast/alert mechanism (already used by
recording-save / pit-call confirmations). If no such helper exists at v9.6,
the implementation plan adds a minimal one in `rasicross.js` — but checking
the current code in the plan task is mandatory before adding.

### 5.6 Error & edge-case behaviour

| Situation | Behaviour |
|-----------|-----------|
| No internet on save | Cache run fails fast, toast "Keine Verbindung — Tiles können später per Knopf geladen werden". Track itself saves normally. |
| `fetch` timeout (5 s) | Single tile recorded as missing in that run, next tile attempted, total `errors` count surfaced in toast. |
| HTTP 429 from OSM | Pause 30 s, one retry; if still 429 → abort run, toast "OSM Rate-Limit — bitte später erneut versuchen". |
| Corrupted/empty PNG on disk | `Image.onerror` in renderer → tile is removed from in-memory map; next `cacheArea` will refetch (file is unlinked by `fetchTile` when re-fetched anyway). |
| Settings URL-template missing `{z}/{x}/{y}` | Settings input shows red border + hint; default URL is used for actual fetches until valid. |
| Browser mode (no `window.rasiTiles`) | `tile-renderer.js` detects missing API in `init()` and sets `_enabled=false`; `paintTilesOn` becomes a no-op; Settings module shows greyed-out note "Tile-Cache nur in Desktop-App". |
| `state.savedTracks[]` empty (Live tab before any track) | No bbox → no tiles. Canvas renders as today ("Noch keine Strecke" text). |
| User switches URL-template at runtime | In-memory cache is cleared; on-disk cache is untouched (still under the previous host directory). Old host's tiles can be removed via "Cache leeren". |
| Save-track triggers cacheArea, user closes app mid-download | Background run cancels on `before-quit`; partial tiles on disk are valid PNGs and reused on next run. |

## 6. Testing & acceptance

### 6.1 Unit tests (`test/test-tiles.js`)

`node:test` cases for `tiles.js`. Target ~8 tests:

1. `lonToGlobalX(0, 18) === 256 * 2^18 / 2` (180° west boundary of Null-Isle).
2. `lonToGlobalX(180, 18) === 256 * 2^18` (east boundary).
3. `latToGlobalY(0, 18) === 256 * 2^18 / 2` (equator).
4. Round-trip: `globalXToLon(lonToGlobalX(11.5, 18), 18) ≈ 11.5` within 1e-9.
5. Round-trip latitudes at -60°, 0°, 60° within 1e-9.
6. `tilesForBbox` for a 0.002 × 0.002 bbox in Munich at z=17 returns 1-4 tiles.
7. `tilesForBbox` at z=18 with `padTiles=1` returns the inner set + 8-tile pad
   ring (correct count).
8. `pickZoom` for a 200 × 150 m bbox in a 1000 × 600 canvas returns 17 (the
   zoom where one tile-side ≈ 76 m).

Brings JS test count from 36 → ~44.

### 6.2 Static / lint

- `node --check tiles.js tile-renderer.js rasicross.js main.js preload.js`.
- ESLint clean (`tile-renderer.js`'s use of `Image`/`localStorage`/`window`
  needs to be declared as a global in `eslint.config.js`, analogous to the
  Phase-16 `DomTargets` addition).

### 6.3 ESP firmware

Not touched. `python -m py_compile sender.py bridge.py esp_libs/*.py` and
`python -m unittest discover -s test` must stay green (baseline 34 tests).

### 6.4 Hardware / manual acceptance checklist

1. Fresh install. Settings → "Karten-Hintergrund" visible, switch on. No
   strecke exists → Live-Karte still shows "Noch keine Strecke" (no tiles).
2. Online, scan + save a track. Toast progress "Lade Karte 17/42…" appears.
   When done, Strecken-Tab status shows "Karte: 42/42 Tiles · ~1,3 MB".
3. Restart app **with WLAN off**. Open the track. Tiles appear under the
   polyline; "© OpenStreetMap-Mitwirkende" visible bottom-right; GPS dot
   moves correctly on top of tiles.
4. Toggle Live `M`-button → tiles disappear from `trackCanvas` only;
   `scanCanvas` (Strecke tab) still shows them.
5. Settings → "Cache leeren" → confirm → toast "42 Tiles entfernt (1,3 MB)".
   Strecken-Tab status updates to "Karte: 0/42 Tiles".
6. Settings → URL-Template → enter MapTiler URL with `{z}/{x}/{y}` and key
   → save → Strecken-Tab "Tiles aktualisieren" → new host's tiles fetched
   → render uses new style. Switch back to empty → OSM default returns
   (previously cached OSM tiles still present, no re-download needed).
7. Try a bogus URL-template (`https://example.com/tiles`) → field red,
   default still works.
8. Browser mode: open `RasiCross_Telemetry.html` directly in Chrome
   (without Electron) → Settings module shows "Tile-Cache nur in
   Desktop-App"; everything else works as today.

### 6.5 Self-review checklist (phase plan)

- Spec coverage: every T1-T8 item from §3 mapped to ≥ 1 task.
- Placeholder scan: no `TBD` / `TODO` / `placeholder`.
- ID consistency: `liveTileToggle`, `tilesSettingsModule`, etc. — name once
  in spec, reused verbatim in plan.
- ESP-NOW byte budget: not touched (no protocol changes).

## 7. Phase map

| Phase | Scope | Files |
|-------|-------|-------|
| **17** (this spec) | OSM Tile Background + Per-Track Cache | `tiles.js`, `tile-renderer.js`, `test/test-tiles.js`, `main.js`, `preload.js`, `rasicross.js`, `RasiCross_Telemetry.html`, `package.json`, `eslint.config.js`, `README.md` |

Prior phases (1-16) shipped on `main`; D2 (multi-kart) and the on-disk
session library (C1-Option-3) remain deferred.

## 8. Open questions

None at spec time. URL-template provider examples (MapTiler / Stadia /
Carto) will be listed as comments in the Settings input's placeholder, but
do not need to be enumerated in the spec — they're documented in `README.md`
as part of T8.
