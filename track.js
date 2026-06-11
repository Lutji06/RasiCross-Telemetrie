'use strict';
// ============================================================
//  RasiCross -- track.js  (Track Scan/Persistence/Editor/Sektoren, Phase 23)
//  Klassisches Script im gemeinsamen Global-Scope: nutzt state/$/css,
//  Dialoge, geo-Helfer, map-draw.js (drawTrack/gpsXYOnCanvas/...),
//  RasiTiles/RasiTileRenderer. Nur Deklarationen auf Top-Level.
// ============================================================

// ============================================================
// 10. TRACK SCAN
// ============================================================
function startTrackScan() {
  state.track.points = [];
  state.track.bounds = null;
  state.track.totalDistance = 0;
  state.track.maxDistFromStart = 0;
  state.track.closed = false;
  state.track.scanning = true;
  state.startGate = { enabled: false, lat: 0, lon: 0, heading: 0, width: Number($('gateWidth').value) || 14 };
  state.sectors.boundaries = [null, null];
  state.sectors.manual = false;
  setText('scanModePill', 'Scan läuft');
  setText('scanStateValue', 'Scannen…');
  $('scanTrackBtn').textContent = 'Scan beenden';
  $('scanTrackBtn').classList.remove('primary');
  $('scanTrackBtn').classList.add('danger');
  drawTrack();
}
function finishTrackScan(auto) {
  state.track.scanning = false;
  state.track.closed = state.track.points.length >= 10;
  setText('scanModePill', auto ? 'Auto-Stop' : 'Manuell beendet');
  setText('scanStateValue', state.track.closed ? 'Gespeichert' : 'Zu wenig Punkte');
  $('scanTrackBtn').textContent = 'Scan starten';
  $('scanTrackBtn').classList.remove('danger');
  $('scanTrackBtn').classList.add('primary');
  // Auto-set start gate at first point
  if (state.track.closed && state.track.points.length >= 2) {
    const first = state.track.points[0];
    const ref = state.track.points.find(p => gpsDist(first.lat, first.lon, p.lat, p.lon) >= 6) || state.track.points[1];
    state.startGate = {
      enabled: true,
      lat: first.lat,
      lon: first.lon,
      heading: headingFromPoints(first, ref),
      width: Number($('gateWidth').value) || 14
    };
    setText('gateSizeText', state.startGate.width + 'm');
    // Auto-calculate sector boundaries (33% / 66%)
    if (!state.sectors.manual) calcAutoSectors();
  }
  // Scan beendet: Bounds eng auf die Strecke ziehen (Anfahrt/Ausreisser raus).
  if (state.track.closed) recomputeTrackBounds();
  drawTrack();
  saveDataDebounced();
}
function clearTrack() {
  state.track.points = [];
  state.track.bounds = null;
  state.track.scanning = false;
  state.track.closed = false;
  state.track.totalDistance = 0;
  state.track.maxDistFromStart = 0;
  state.startGate = { enabled: false, lat: 0, lon: 0, heading: 0, width: 14 };
  state.sectors.boundaries = [null, null];
  state.sectors.manual = false;
  state.sectors.best = [null, null, null];   // Bests gelten pro Strecke
  $('sectorPanel').style.display = 'none';
  setText('scanModePill', 'Manuell');
  setText('scanStateValue', 'Warte auf GPS');
  setText('scanPointsValue', '0');
  setText('trackPoints', '0');
  setText('gateSizeText', '--');
  drawTrack();
  saveDataDebounced();
}
function updateBounds(lat, lon) {
  const b = state.track.bounds || { minLat: lat, maxLat: lat, minLon: lon, maxLon: lon };
  b.minLat = Math.min(b.minLat, lat);
  b.maxLat = Math.max(b.maxLat, lat);
  b.minLon = Math.min(b.minLon, lon);
  b.maxLon = Math.max(b.maxLon, lon);
  state.track.bounds = b;
}
// Bounds eng aus den Streckenpunkten ableiten (Phase 26) -- heilt verseuchte
// Session-Bounds: GPS-Ausreisser (Kaltstart-Spruenge, Anfahrt) blaehten sie
// frueher unbegrenzt auf und zerquetschten damit die Karten-Skalierung.
function recomputeTrackBounds() {
  const pts = state.track.points;
  if (!pts || !pts.length) { state.track.bounds = null; return; }
  const b = { minLat: pts[0].lat, maxLat: pts[0].lat, minLon: pts[0].lon, maxLon: pts[0].lon };
  for (const p of pts) {
    b.minLat = Math.min(b.minLat, p.lat); b.maxLat = Math.max(b.maxLat, p.lat);
    b.minLon = Math.min(b.minLon, p.lon); b.maxLon = Math.max(b.maxLon, p.lon);
  }
  state.track.bounds = b;
}
function onGpsUpdate(lat, lon) {
  if (!lat || !lon) return;
  if (!state.track.scanning) {
    // Geschlossene Strecke rahmt die Karte -- Bounds nicht weiter aufblaehen,
    // der Live-Punkt wird einfach auf der Strecken-Skalierung gezeichnet.
    if (state.track.closed) return;
    // Vor dem Scan folgt die Karte dem GPS, aber Ausreisser (>10 km vom
    // bisherigen Zentrum) bleiben draussen.
    const b = state.track.bounds;
    if (b && gpsDist(lat, lon, (b.minLat + b.maxLat) / 2, (b.minLon + b.maxLon) / 2) > 10000) return;
    updateBounds(lat, lon);
    return;
  }
  const last = state.track.points[state.track.points.length - 1];
  const dist = last ? gpsDist(last.lat, last.lon, lat, lon) : 999;
  // GPS-Sprung beim Scannen (>500 m zwischen zwei Fixen ist physikalisch
  // unmoeglich): Fix komplett verwerfen statt Strecke und Bounds zerstoeren.
  if (last && dist >= 500) return;
  if (!last || dist > 2) {
    if (last) state.track.totalDistance += dist;
    state.track.points.push({ lat, lon });
    updateBounds(lat, lon);
    setText('scanPointsValue', state.track.points.length);
    setText('trackPoints', state.track.points.length);
    if (state.track.points.length > 1) {
      const start = state.track.points[0];
      state.track.maxDistFromStart = Math.max(state.track.maxDistFromStart, gpsDist(start.lat, start.lon, lat, lon));
    }
  }
  // Auto-stop check: GPS within radius/2 of start AND traveled at least 80% of max distance
  if (state.track.points.length >= 30) {
    const first = state.track.points[0];
    const distToStart = gpsDist(lat, lon, first.lat, first.lon);
    const radius = Math.max(6, (Number($('gateWidth').value) || 14) / 2);
    const minDist = state.track.maxDistFromStart * 0.8;
    if (distToStart <= radius && state.track.totalDistance > minDist) {
      finishTrackScan(true);
    }
  }
}

// ============================================================
// 11. TRACK PERSISTENCE
// ============================================================
async function saveCurrentTrack() {
  const name = ($('trackSaveName').value || '').trim();
  if (!name) return rcAlert('Bitte einen Streckennamen eingeben.', 'Strecke');
  if (state.track.points.length < 10) return rcAlert('Zu wenige Streckenpunkte (min. 10).\nErst Scannen.', 'Strecke');
  const existing = state.savedTracks.find(t => t.name.toLowerCase() === name.toLowerCase());
  if (existing) {
    if (!await rcConfirm(`Strecke "${name}" überschreiben?`, 'Überschreiben', 'Ja')) return;
    state.savedTracks = state.savedTracks.filter(t => t.id !== existing.id);
  }
  state.savedTracks.unshift({
    id: uid(), name, createdAt: Date.now(),
    points: [...state.track.points], bounds: { ...state.track.bounds },
    startGate: { ...state.startGate },
    sectorBoundaries: [...state.sectors.boundaries],
    sectorBest: [...state.sectors.best],
    totalDistance: state.track.totalDistance,
    maxDistFromStart: state.track.maxDistFromStart,
    closed: state.track.closed
  });
  $('trackSaveName').value = '';
  renderSavedTracks();
  renderTrackOptions();
  saveData();
  rcToast(`Strecke "${name}" gespeichert`);
  try {
    const newTrack = state.savedTracks[0];
    if (newTrack && newTrack.bounds && window.rasiTiles) {
      startTrackTileCache(newTrack.id);
    }
  } catch (e) { /* silent — manual button is the fallback */ }
}
// Sektor-Bests gehoeren zur Strecke: nach jedem neuen Best in die aktive
// gespeicherte Strecke spiegeln, damit sie Streckenwechsel ueberleben.
function syncSectorBestToTrack() {
  const t = state.savedTracks.find(x => x.id === state.activeTrackId);
  if (t) t.sectorBest = [...state.sectors.best];
}
function loadSavedTrack(id) {
  const t = state.savedTracks.find(x => x.id === id);
  if (!t) return;
  state.track.points = [...t.points];
  state.track.bounds = { ...t.bounds };
  state.track.totalDistance = t.totalDistance || 0;
  state.track.maxDistFromStart = t.maxDistFromStart || 0;
  state.track.closed = t.closed !== false;
  state.startGate = { ...t.startGate };
  if (Array.isArray(t.sectorBoundaries)) {
    state.sectors.boundaries = [...t.sectorBoundaries];
    state.sectors.manual = !!t.sectorBoundaries.some(b => b);
  }
  // Sektor-Bests (und damit die theoretische Bestrunde) gelten pro Strecke
  state.sectors.best = Array.isArray(t.sectorBest) ? [...t.sectorBest] : [null, null, null];
  state.activeTrackId = id;
  setText('gateSizeText', (state.startGate.width || 14) + 'm');
  setText('scanStateValue', 'Geladen: ' + t.name);
  drawTrack();
  updateSectorPanel();
  saveDataDebounced();
  rcToast(`Strecke "${t.name}" geladen`);
}
async function deleteSavedTrack(id) {
  const t = state.savedTracks.find(x => x.id === id);
  if (!t) return;
  if (!await rcConfirm(`Strecke "${t.name}" löschen?`, 'Löschen', 'Löschen', true)) return;
  state.savedTracks = state.savedTracks.filter(x => x.id !== id);
  if (state.activeTrackId === id) {
    state.activeTrackId = null;
    clearTrack();
  }
  renderSavedTracks();
  renderTrackOptions();
  saveData();
  rcToast('Strecke gelöscht');
}
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
  const slot = document.getElementById('trackTileStatus_' + trackId);
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

let _tileCacheRun = null;

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

function renderSavedTracks() {
  const list = $('savedTracksList');
  setText('savedTrackCount', state.savedTracks.length);
  if (!state.savedTracks.length) {
    list.innerHTML = '<div class="muted">Noch keine gespeicherten Strecken.</div>';
    return;
  }
  list.innerHTML = state.savedTracks.map(t => `
    <div class="track-item">
      <div class="track-item-info">
        <b>${esc(t.name)}</b>
        <span>${t.points.length} Punkte · ${Math.round((t.totalDistance || 0))}m · ${new Date(t.createdAt).toLocaleDateString('de-DE')}</span>
      </div>
      <button class="btn primary" data-action="loadSavedTrack" data-id="${t.id}">Laden</button>
      <button class="btn ghost" data-action="openTrackEditor" data-id="${t.id}">✎</button>
      <button class="btn danger" data-action="deleteSavedTrack" data-id="${t.id}">✕</button>
      <div class="track-item-tile-row" style="flex-basis:100%;display:flex;align-items:center;justify-content:space-between;gap:10px;margin-top:6px">
        <span id="trackTileStatus_${t.id}" class="muted" style="font-size:11px">…</span>
        <button id="trackTileBtn_${t.id}" class="btn ghost" style="font-size:11px;padding:4px 10px">Tiles aktualisieren</button>
      </div>
    </div>
  `).join('');
  for (const t of state.savedTracks) {
    const btn = document.getElementById('trackTileBtn_' + t.id);
    if (btn) btn.onclick = function () { startTrackTileCache(t.id); };
    refreshTrackTileStatus(t.id);
  }
}

// ============================================================
// 12. TRACK EDITOR
// ============================================================
let _editor = null;
function openTrackEditor(id) {
  const t = state.savedTracks.find(x => x.id === id);
  if (!t) { rcAlert('Strecke nicht gefunden.'); return; }
  _editor = {
    track: JSON.parse(JSON.stringify(t)),
    clickTarget: null
  };
  if (!Array.isArray(_editor.track.sectorBoundaries)) _editor.track.sectorBoundaries = [null, null];
  setText('editorTitle', `Bearbeiten: ${t.name}`);
  // Fill inputs
  const sg = _editor.track.startGate || {};
  $('edStartLat').value = sg.lat ? Number(sg.lat).toFixed(6) : '';
  $('edStartLon').value = sg.lon ? Number(sg.lon).toFixed(6) : '';
  $('edStartHead').value = sg.heading != null ? Math.round(sg.heading) : '';
  const s2 = _editor.track.sectorBoundaries[0];
  $('edS2Lat').value = s2 ? Number(s2.lat).toFixed(6) : '';
  $('edS2Lon').value = s2 ? Number(s2.lon).toFixed(6) : '';
  $('edS2Head').value = s2 ? Math.round(s2.heading) : '';
  const s3 = _editor.track.sectorBoundaries[1];
  $('edS3Lat').value = s3 ? Number(s3.lat).toFixed(6) : '';
  $('edS3Lon').value = s3 ? Number(s3.lon).toFixed(6) : '';
  $('edS3Head').value = s3 ? Math.round(s3.heading) : '';
  setText('edClickHint', '');
  $('editorOverlay').classList.add('show');
  setTimeout(() => {
    const c = $('editorCanvas');
    c.width = c.offsetWidth * dpr();
    c.height = c.offsetHeight * dpr();
    c.onclick = handleEditorClick;
    // Live-Vorschau bei Eingabe der Winkel-Felder
    ['edStartHead', 'edS2Head', 'edS3Head'].forEach(id => {
      const el = $(id);
      if (el) el.oninput = applyEditorInputsToTrack;
    });
    ['edStartLat','edStartLon','edS2Lat','edS2Lon','edS3Lat','edS3Lon'].forEach(id => {
      const el = $(id);
      if (el) el.oninput = applyEditorInputsToTrack;
    });
    drawEditor();
  }, 100);
}

// Liest Inputs und aktualisiert _editor.track ohne zu speichern (Live-Vorschau)
function applyEditorInputsToTrack() {
  if (!_editor) return;
  const t = _editor.track;
  const parseHeading = (val, fallback = 0) => {
    if (val === '' || val == null) return fallback;
    const n = Number(val);
    return isNaN(n) ? fallback : ((n % 360) + 360) % 360;
  };
  // Start
  const slat = Number($('edStartLat').value);
  const slon = Number($('edStartLon').value);
  if (!isNaN(slat) && !isNaN(slon) && slat && slon) {
    t.startGate = t.startGate || {};
    t.startGate.lat = slat;
    t.startGate.lon = slon;
    t.startGate.heading = parseHeading($('edStartHead').value, t.startGate.heading || 0);
    t.startGate.width = t.startGate.width || 14;
    t.startGate.enabled = true;
  }
  // S2
  if (!Array.isArray(t.sectorBoundaries)) t.sectorBoundaries = [null, null];
  const s2lat = Number($('edS2Lat').value);
  const s2lon = Number($('edS2Lon').value);
  if (!isNaN(s2lat) && !isNaN(s2lon) && s2lat && s2lon) {
    const prev = t.sectorBoundaries[0] || {};
    t.sectorBoundaries[0] = {
      lat: s2lat, lon: s2lon,
      heading: parseHeading($('edS2Head').value, prev.heading || 0),
      width: t.startGate?.width || 14
    };
  }
  // S3
  const s3lat = Number($('edS3Lat').value);
  const s3lon = Number($('edS3Lon').value);
  if (!isNaN(s3lat) && !isNaN(s3lon) && s3lat && s3lon) {
    const prev = t.sectorBoundaries[1] || {};
    t.sectorBoundaries[1] = {
      lat: s3lat, lon: s3lon,
      heading: parseHeading($('edS3Head').value, prev.heading || 0),
      width: t.startGate?.width || 14
    };
  }
  drawEditor();
}
function closeTrackEditor() {
  $('editorOverlay').classList.remove('show');
  _editor = null;
}
function editorClickTarget(target) {
  if (!_editor) return;
  _editor.clickTarget = target;
  const labels = { start: 'START / ZIEL', s2: 'S2', s3: 'S3' };
  setText('edClickHint', `Klicke jetzt auf die Karte für ${labels[target]}`);
  $('editorCanvas').style.cursor = 'crosshair';
}
function handleEditorClick(e) {
  if (!_editor || !_editor.clickTarget) return;
  const c = $('editorCanvas');
  const rect = c.getBoundingClientRect();
  const px = (e.clientX - rect.left) * dpr();
  const py = (e.clientY - rect.top) * dpr();
  // Convert pixel to GPS
  const pts = _editor.track.points;
  if (!pts || pts.length < 2) return;
  let mn = { lat: Infinity, lon: Infinity }, mx = { lat: -Infinity, lon: -Infinity };
  pts.forEach(p => {
    mn.lat = Math.min(mn.lat, p.lat); mx.lat = Math.max(mx.lat, p.lat);
    mn.lon = Math.min(mn.lon, p.lon); mx.lon = Math.max(mx.lon, p.lon);
  });
  const w = c.width, h = c.height, pad = 32 * dpr();
  const dLat = (mx.lat - mn.lat) || 0.0001;
  const dLon = (mx.lon - mn.lon) || 0.0001;
  const sc = Math.min((w - 2*pad) / dLon, (h - 2*pad) / dLat);
  const ox = (w - dLon * sc) / 2, oy = (h - dLat * sc) / 2;
  const lon = mn.lon + (px - ox) / sc;
  const lat = mn.lat + (h - oy - py) / sc;
  // Find nearest track point
  let ci = 0, md = Infinity;
  pts.forEach((p, i) => {
    const d = gpsDist(lat, lon, p.lat, p.lon);
    if (d < md) { md = d; ci = i; }
  });
  const cp = pts[ci];
  const cp2 = pts[Math.min(ci + 1, pts.length - 1)];
  const heading = headingFromPoints(cp, cp2);
  const w2 = Number(_editor.track.startGate?.width || 14);
  const t = _editor.clickTarget;
  if (t === 'start') {
    _editor.track.startGate = { ..._editor.track.startGate, lat: cp.lat, lon: cp.lon, heading, enabled: true, width: w2 };
    $('edStartLat').value = cp.lat.toFixed(6);
    $('edStartLon').value = cp.lon.toFixed(6);
    $('edStartHead').value = Math.round(heading);
  } else if (t === 's2') {
    _editor.track.sectorBoundaries[0] = { lat: cp.lat, lon: cp.lon, heading, width: w2 };
    $('edS2Lat').value = cp.lat.toFixed(6);
    $('edS2Lon').value = cp.lon.toFixed(6);
    $('edS2Head').value = Math.round(heading);
  } else if (t === 's3') {
    _editor.track.sectorBoundaries[1] = { lat: cp.lat, lon: cp.lon, heading, width: w2 };
    $('edS3Lat').value = cp.lat.toFixed(6);
    $('edS3Lon').value = cp.lon.toFixed(6);
    $('edS3Head').value = Math.round(heading);
  }
  _editor.clickTarget = null;
  setText('edClickHint', '');
  $('editorCanvas').style.cursor = 'default';
  drawEditor();
}
function drawEditor() {
  if (!_editor) return;
  const c = $('editorCanvas');
  const ctx = c.getContext('2d');
  const w = c.width, h = c.height;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = '#0a0a10';
  ctx.fillRect(0, 0, w, h);
  const pts = _editor.track.points;
  if (!pts || pts.length < 2) return;
  let mn = { lat: Infinity, lon: Infinity }, mx = { lat: -Infinity, lon: -Infinity };
  pts.forEach(p => {
    mn.lat = Math.min(mn.lat, p.lat); mx.lat = Math.max(mx.lat, p.lat);
    mn.lon = Math.min(mn.lon, p.lon); mx.lon = Math.max(mx.lon, p.lon);
  });
  const pad = 32 * dpr();
  const dLat = (mx.lat - mn.lat) || 0.0001;
  const dLon = (mx.lon - mn.lon) || 0.0001;
  const sc = Math.min((w - 2*pad) / dLon, (h - 2*pad) / dLat);
  const ox = (w - dLon * sc) / 2, oy = (h - dLat * sc) / 2;
  const xy = (lat, lon) => ({ x: ox + (lon - mn.lon) * sc, y: h - oy - (lat - mn.lat) * sc });
  // Track
  ctx.beginPath();
  pts.forEach((p, i) => {
    const q = xy(p.lat, p.lon);
    if (i) ctx.lineTo(q.x, q.y); else ctx.moveTo(q.x, q.y);
  });
  if (_editor.track.closed) {
    const q = xy(pts[0].lat, pts[0].lon);
    ctx.lineTo(q.x, q.y);
  }
  ctx.strokeStyle = 'rgba(232,255,0,.22)';
  ctx.lineWidth = 7 * dpr();
  ctx.stroke();
  ctx.beginPath();
  pts.forEach((p, i) => {
    const q = xy(p.lat, p.lon);
    if (i) ctx.lineTo(q.x, q.y); else ctx.moveTo(q.x, q.y);
  });
  if (_editor.track.closed) {
    const q = xy(pts[0].lat, pts[0].lon);
    ctx.lineTo(q.x, q.y);
  }
  ctx.strokeStyle = '#e8ff00';
  ctx.lineWidth = 2 * dpr();
  ctx.stroke();
  // Lines
  function drawLine(gate, color, label) {
    if (!gate || !gate.lat) return;
    const ep = lineEndpointsFromGate(gate);
    if (!ep) return;
    const p1 = xy(ep.p1.lat, ep.p1.lon);
    const p2 = xy(ep.p2.lat, ep.p2.lon);
    const mc = xy(gate.lat, gate.lon);
    ctx.beginPath();
    ctx.moveTo(p1.x, p1.y);
    ctx.lineTo(p2.x, p2.y);
    ctx.strokeStyle = color;
    ctx.lineWidth = 3 * dpr();
    ctx.setLineDash([6 * dpr(), 3 * dpr()]);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = color;
    ctx.font = `900 ${10 * dpr()}px monospace`;
    ctx.textAlign = 'center';
    ctx.fillText(label, mc.x, mc.y - 8 * dpr());
    ctx.beginPath();
    ctx.arc(mc.x, mc.y, 4 * dpr(), 0, Math.PI * 2);
    ctx.fill();
  }
  drawLine(_editor.track.startGate, '#20c040', 'START');
  drawLine(_editor.track.sectorBoundaries[0], '#3aa0ff', 'S2');
  drawLine(_editor.track.sectorBoundaries[1], '#ff9500', 'S3');
}
function saveEditor() {
  if (!_editor) return;
  const t = _editor.track;
  // Helper: parse heading correctly — 0 is valid, only empty/NaN falls back
  const parseHeading = (val, fallback = 0) => {
    if (val === '' || val == null) return fallback;
    const n = Number(val);
    return isNaN(n) ? fallback : ((n % 360) + 360) % 360;
  };
  // Read inputs
  const sg = t.startGate || {};
  if ($('edStartLat').value) sg.lat = Number($('edStartLat').value);
  if ($('edStartLon').value) sg.lon = Number($('edStartLon').value);
  sg.heading = parseHeading($('edStartHead').value, sg.heading || 0);
  sg.enabled = !!sg.lat;
  sg.width = sg.width || 14;
  t.startGate = sg;
  if (!Array.isArray(t.sectorBoundaries)) t.sectorBoundaries = [null, null];
  if ($('edS2Lat').value) {
    const prev = t.sectorBoundaries[0] || {};
    t.sectorBoundaries[0] = {
      lat: Number($('edS2Lat').value),
      lon: Number($('edS2Lon').value),
      heading: parseHeading($('edS2Head').value, prev.heading || 0),
      width: sg.width
    };
  }
  if ($('edS3Lat').value) {
    const prev = t.sectorBoundaries[1] || {};
    t.sectorBoundaries[1] = {
      lat: Number($('edS3Lat').value),
      lon: Number($('edS3Lon').value),
      heading: parseHeading($('edS3Head').value, prev.heading || 0),
      width: sg.width
    };
  }
  // Save back
  const idx = state.savedTracks.findIndex(x => x.id === t.id);
  if (idx >= 0) state.savedTracks[idx] = t;
  // If active, reload
  if (state.activeTrackId === t.id) {
    state.startGate = { ...t.startGate };
    state.sectors.boundaries = [...t.sectorBoundaries];
    state.sectors.manual = !!t.sectorBoundaries.some(b => b);
    drawTrack();
    updateSectorPanel();
  }
  saveData();
  renderSavedTracks();
  closeTrackEditor();
  rcToast('Strecke gespeichert');
}

// ============================================================
// 13. SECTORS
// ============================================================
function calcAutoSectors() {
  if (state.sectors.manual) return;
  const pts = state.track.points;
  if (!pts || pts.length < 10 || !state.startGate.enabled) return;
  // Cumulative distance from start
  const cumul = [0];
  for (let i = 1; i < pts.length; i++) {
    cumul.push(cumul[i-1] + gpsDist(pts[i-1].lat, pts[i-1].lon, pts[i].lat, pts[i].lon));
  }
  const total = cumul[cumul.length - 1];
  const findIdx = ratio => {
    const target = total * ratio;
    for (let i = 0; i < cumul.length; i++) if (cumul[i] >= target) return i;
    return cumul.length - 1;
  };
  const i33 = findIdx(0.33), i66 = findIdx(0.66);
  const w = state.startGate.width || 14;
  const mkBoundary = idx => {
    const p = pts[idx];
    const next = pts[Math.min(idx + 1, pts.length - 1)];
    return { lat: p.lat, lon: p.lon, heading: headingFromPoints(p, next), width: w };
  };
  state.sectors.boundaries = [mkBoundary(i33), mkBoundary(i66)];
}
function clearManualSectors() {
  state.sectors.manual = false;
  calcAutoSectors();
  drawTrack();
  saveDataDebounced();
  rcToast('Sektoren automatisch neu berechnet');
}
function activateSectorClick(idx) {
  state.sectors.clickTarget = idx;
  setText('sectorClickHint', `Klicke jetzt auf die Karte für S${idx + 2}`);
  if (_trackCanvas) _trackCanvas.style.cursor = 'crosshair';
  if (_scanCanvas) _scanCanvas.style.cursor = 'crosshair';
}
function handleTrackCanvasClick(e) {
  if (state.sectors.clickTarget == null) return;
  const c = e.currentTarget;
  const rect = c.getBoundingClientRect();
  const px = (e.clientX - rect.left) * dpr();
  const py = (e.clientY - rect.top) * dpr();
  const b = state.track.bounds;
  if (!b || state.track.points.length < 2) {
    state.sectors.clickTarget = null;
    return;
  }
  const w = c.width, h = c.height, pad = 32 * dpr();
  const dLat = (b.maxLat - b.minLat) || 0.0001;
  const dLon = (b.maxLon - b.minLon) || 0.0001;
  const sc = Math.min((w - 2*pad) / dLon, (h - 2*pad) / dLat);
  const ox = (w - dLon * sc) / 2, oy = (h - dLat * sc) / 2;
  const lon = b.minLon + (px - ox) / sc;
  const lat = b.minLat + (h - oy - py) / sc;
  // Find nearest track point
  let ci = 0, md = Infinity;
  state.track.points.forEach((p, i) => {
    const d = gpsDist(lat, lon, p.lat, p.lon);
    if (d < md) { md = d; ci = i; }
  });
  const cp = state.track.points[ci];
  const cp2 = state.track.points[Math.min(ci + 1, state.track.points.length - 1)];
  const heading = headingFromPoints(cp, cp2);
  const idx = state.sectors.clickTarget;
  state.sectors.boundaries[idx] = { lat: cp.lat, lon: cp.lon, heading, width: state.startGate.width || 14 };
  state.sectors.manual = true;
  state.sectors.clickTarget = null;
  setText('sectorClickHint', '');
  if (_trackCanvas) _trackCanvas.style.cursor = '';
  if (_scanCanvas) _scanCanvas.style.cursor = '';
  drawTrack();
  saveDataDebounced();
  rcToast(`S${idx + 2} Grenze gesetzt`);
}
function checkSectorCrossings(lat, lon) {
  try {
    const r = activeRace();
    if (!r || r.status !== 'running' || !state.lapStart) return;
    const s = state.sectors;
    const bs = s.boundaries;
    if (!bs[0] && !bs[1]) return;
    if (!state.autoLap.prevLat) return; // wait for prev
    const A = { lat: state.autoLap.prevLat, lon: state.autoLap.prevLon };
    const B = { lat, lon };
    const now = Date.now();
    // Cooldown (avoid double trigger)
    if (s.sectorStart && (now - s.sectorStart) < 2000) return;
    for (let i = 0; i < 2; i++) {
      if (s.cur !== i) continue;
      const ep = lineEndpointsFromGate(bs[i]);
      if (!ep) continue;
      if (segmentsCross(A, B, ep.p1, ep.p2) && crossingDirectionOk(A.lat, A.lon, lat, lon, bs[i].heading)) {
        const sectorMs = now - (s.sectorStart || state.lapStart);
        s.lapSectors[i] = sectorMs;
        s.sectorStart = now;
        s.cur = i + 1;
        // Update best
        if (s.best[i] == null || sectorMs < s.best[i]) {
          s.best[i] = sectorMs;
          rcAudio.sectorBest();
          syncSectorBestToTrack();
          saveDataDebounced();
        }
        updateSectorPanel();
        break;
      }
    }
  } catch (e) { console.warn('checkSectorCrossings:', e); }
}
function updateSectorPanel() {
  const s = state.sectors;
  const has = s.boundaries[0] || s.boundaries[1];
  $('sectorPanel').style.display = has ? 'grid' : 'none';
  if (!has) return;
  const display = i => {
    let t = s.lapSectors[i];
    if (!t && s.lastLapSectors) t = s.lastLapSectors[i];
    const best = s.best[i];
    const delta = (t && best && t !== best) ? t - best : null;
    setText(`s${i+1}Time`, t ? fmtMs(t) : '--:--.---');
    const dEl = $(`s${i+1}Delta`);
    if (dEl) {
      if (delta == null) { dEl.textContent = '--'; dEl.className = 'sector-delta same'; }
      else {
        dEl.textContent = (delta >= 0 ? '+' : '') + (delta / 1000).toFixed(3) + 's';
        dEl.className = 'sector-delta ' + (delta < 0 ? 'faster' : 'slower');
      }
    }
    const card = $(`s${i+1}Card`);
    if (card) card.classList.toggle('active', s.cur === i && !s.lapSectors[i]);
  };
  display(0); display(1); display(2);
  // Theoretische Bestrunde (Phase 24): Summe der Sektor-Bests
  const tb = theoreticalBestMs();
  setText('theoBestTime', tb ? fmtMs(tb) : '--:--.---');
}

// Interface-Marker: von rasicross.js/serial-demo.js/races.js/recording.js
// genutzte Funktionen -- verhindert no-unused-vars, dokumentiert das API.
void [startTrackScan, finishTrackScan, clearTrack, updateBounds, onGpsUpdate,
      recomputeTrackBounds,
      saveCurrentTrack, syncSectorBestToTrack, loadSavedTrack, deleteSavedTrack, refreshTrackTileStatus,
      startTrackTileCache, renderSavedTracks, openTrackEditor, closeTrackEditor,
      editorClickTarget, handleEditorClick, saveEditor, calcAutoSectors,
      clearManualSectors, activateSectorClick, handleTrackCanvasClick,
      checkSectorCrossings, updateSectorPanel];
