// ============================================================
//  RasiCross  --  tile-renderer.js
// ============================================================
//  Renderer-side OSM-Tile-Cache. Haelt geladene PNGs als
//  HTMLImageElement in einer Map, damit drawTrackOn synchron
//  blitten kann. Misses werden asynchron via window.rasiTiles
//  (IPC -> Electron Main) gefetcht; sobald das letzte Bild
//  resolved, wird drawTrack() einmalig nachgetriggert.
// ============================================================
import RasiTiles from '../tiles.js';

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
    if (!RasiTiles) return;
    const template = _resolveTemplate();
    const host = _host(template);
    const z = RasiTiles.pickZoom(bounds, canvasW, canvasH, PADDING_PX, Z_MIN, Z_MAX);
    const tiles = RasiTiles.tilesForBbox(bounds, z, 1);
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
    if (!RasiTiles) return null;
    const template = _resolveTemplate();
    const host = _host(template);
    const w = canvas.width, h = canvas.height;
    const dpr = (window.devicePixelRatio || 1);
    const padPx = PADDING_PX * dpr;
    const z = RasiTiles.pickZoom(bounds, w, h, padPx, Z_MIN, Z_MAX);
    const tr = RasiTiles.bboxToCanvasTransform(bounds, z, w, h, padPx);
    const tiles = RasiTiles.tilesForBbox(bounds, z, 1);
    let painted = 0;
    for (const t of tiles) {
      const k = _key(host, t.z, t.x, t.y);
      const img = _cache.get(k);
      if (!img) continue;
      const tileWorldX = t.x * RasiTiles.TILE_SIZE;
      const tileWorldY = t.y * RasiTiles.TILE_SIZE;
      const dx = tr.ox + (tileWorldX - tr.gxBase) * tr.sc;
      const dy = tr.oy + (tileWorldY - tr.gyBase) * tr.sc;
      const ds = RasiTiles.TILE_SIZE * tr.sc;
      ctx.drawImage(img, dx, dy, ds, ds);
      painted++;
    }
    return painted > 0 ? z : null;
  }

  // ESM-Export (Phase 42): Default-Objekt = bisheriges window.RasiTileRenderer
  export default { init, ensureBbox, paintTilesOn, clearMemory, _DEFAULT_URL: DEFAULT_URL };
