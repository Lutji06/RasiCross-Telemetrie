'use strict';
// ============================================================
//  RasiCross -- map-draw.js  (Track-Karten-Zeichnung, Phase 22)
//  Klassisches Script im gemeinsamen Global-Scope: liest state/$/css/
//  dpr aus rasicross.js (laedt danach) sowie RasiTiles/RasiTileRenderer
//  und geo.js-Globals (lineEndpointsFromGate, ghostPointAt).
//  Nur Deklarationen auf Top-Level -- kein Code laeuft beim Laden.
// ============================================================

// ============================================================
// 9. TRACK MAP DRAWING
// ============================================================
let _trackCanvas, _scanCanvas;
function resizeCanvases() {
  [_trackCanvas, _scanCanvas, $('editorCanvas')].forEach(c => {
    if (!c) return;
    const w = c.offsetWidth, h = c.offsetHeight;
    if (w > 0 && h > 0) {
      const targetW = Math.floor(w * dpr()), targetH = Math.floor(h * dpr());
      if (c.width !== targetW || c.height !== targetH) {
        c.width = targetW;
        c.height = targetH;
      }
    }
  });
  drawTrack();
}
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
function drawTrack() {
  try {
    if (_trackCanvas) drawTrackOn(_trackCanvas);
    if (_scanCanvas) drawTrackOn(_scanCanvas);
  } catch (e) { console.warn('drawTrack:', e); }
}
function drawTrackOn(c) {
  const ctx = c.getContext('2d');
  const w = c.width, h = c.height;
  if (!w || !h) return;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = css('--soft');
  ctx.fillRect(0, 0, w, h);
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
  const pts = state.track.points;
  if (!pts || pts.length < 2) {
    // Wenn der Scan-Canvas (Strecke-Tab) gezeichnet wird, übernimmt die HTML
    // .pw-map-empty Karte den Empty-State — also keinen Text auf den Canvas malen,
    // sonst überlappen sich beide Hinweise.
    if (c.id !== 'scanCanvas') {
      ctx.fillStyle = css('--dim');
      ctx.font = `${13 * dpr()}px monospace`;
      ctx.textAlign = 'center';
      ctx.fillText(state.track.scanning ? 'Scan läuft – fahre die Runde ab' : 'Noch keine Strecke', w/2, h/2);
    }
    return;
  }
  // Track outline (yellow glow)
  ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  ctx.beginPath();
  pts.forEach((p, i) => {
    const xy = gpsXYOnCanvas(p.lat, p.lon, c);
    if (i) ctx.lineTo(xy.x, xy.y); else ctx.moveTo(xy.x, xy.y);
  });
  if (state.track.closed && pts.length > 2) {
    const xy = gpsXYOnCanvas(pts[0].lat, pts[0].lon, c);
    ctx.lineTo(xy.x, xy.y);
  }
  ctx.strokeStyle = 'rgba(232,255,0,.32)';
  ctx.lineWidth = 9 * dpr();
  ctx.stroke();
  // Track line
  ctx.beginPath();
  pts.forEach((p, i) => {
    const xy = gpsXYOnCanvas(p.lat, p.lon, c);
    if (i) ctx.lineTo(xy.x, xy.y); else ctx.moveTo(xy.x, xy.y);
  });
  if (state.track.closed && pts.length > 2) {
    const xy = gpsXYOnCanvas(pts[0].lat, pts[0].lon, c);
    ctx.lineTo(xy.x, xy.y);
  }
  ctx.strokeStyle = css('--pr');
  ctx.lineWidth = 2.6 * dpr();
  ctx.stroke();
  // Heatmap
  if (state.heatmap.on) drawHeatmapOn(c, ctx);
  // Ghost-Runde (beste Runde) — nur auf der Live-Karte
  if (c.id === 'trackCanvas' && state.bestLapTrace && state.bestLapTrace.length > 1) {
    drawGhostOn(c, ctx);
  }
  // Start line
  const ep = lineEndpointsFromGate(state.startGate);
  if (ep) drawLineOn(ctx, c, ep, css('--green'), 'START', Date.now() < state.gateFlashUntil);
  // Sector boundaries
  state.sectors.boundaries.forEach((b, i) => {
    if (!b) return;
    const sep = lineEndpointsFromGate(b);
    if (sep) drawLineOn(ctx, c, sep, i === 0 ? css('--blue') : css('--orange'), 'S' + (i + 2), false);
  });
  // Phase 33: Live-Positions-Overlay statt einzelnem GPS-Punkt. Nur auf der
  // Live-Karte; scanCanvas/editorCanvas bekommen keine Kart-Marker.
  if (c.id === 'trackCanvas') drawKartMarkersOn(c, ctx);
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
}
// Phase 34: Marker-Overtake-Ring — eigener modul-lokaler Overtake-State
// (unabhaengig von kart-overview.js; map-draw rechnet die Rangfolge jeden Frame).
let _prevPosByMac = {};
let _overtakeAtByMac = {};
const MARKER_OVERTAKE_MS = 1200;
// Phase 33: Live-Positions-Overlay — jeder verbundene Kart als farbiger Marker
// an seiner GPS-Position. Aktiver Kart groesser+Glow, stale gedimmt; P-Nummer
// oberhalb des Markers nur bei laufendem Rennen mit >=2 Teilnehmern.
function drawKartMarkersOn(c, ctx) {
  try {
    const now = Date.now();
    const macs = state.karts.macs();
    // Positionsnummern nur bei laufendem Rennen mit >=2 Teilnehmern.
    const r = (typeof activeRace === 'function') ? activeRace() : null;
    // Phase 39: gemeinsames, memoisiertes Ranking (kart-rank.js) statt
    // eigener trackProgressM-Rechnung pro Frame.
    const rr = window.RasiKartRank ? RasiKartRank.ranking(state, r) : null;
    let posByMac = null;
    if (rr) {
      posByMac = {};
      rr.ranked.forEach(e => { posByMac[e.mac] = e.pos; });
      // Phase 34: Aufsteiger -> Overtake-Ring-Zeitstempel; Vorpositionen merken.
      RasiLapEngine.positionGains(_prevPosByMac, rr.ranked).forEach(mac => { _overtakeAtByMac[mac] = now; });
      const _np = {};
      rr.ranked.forEach(e => { _np[e.mac] = e.pos; });
      _prevPosByMac = _np;
    } else {
      // Kein aktives Ranking -> Overtake-State zuruecksetzen.
      _prevPosByMac = {};
      _overtakeAtByMac = {};
    }
    const labels = [];   // Phase 34: Label-Anker sammeln, nach der Schleife entzerren.
    macs.forEach(mac => {
      const k = state.karts.get(mac);
      if (!k) return;
      const t = k.telemetry;
      if (!t.lat || !t.lon) return;        // kein GPS-Fix -> kein Marker
      const xy = gpsXYOnCanvas(t.lat, t.lon, c);
      // Kart-Farbe NUR lesen (state.kartMeta) — kein localStorage-Write im Draw-Loop.
      const meta = state.kartMeta && state.kartMeta[mac];
      const color = (meta && meta.color) || '#3aa0e8';
      const isActive = (mac === state.activeKartMac);
      const stale = k.connection.lastPacketAt ? (now - k.connection.lastPacketAt > 2000) : true;
      const rad = (isActive ? 7 : 5) * dpr();
      ctx.save();
      ctx.globalAlpha = stale ? 0.4 : 1;
      ctx.fillStyle = color;
      if (isActive) { ctx.shadowColor = color; ctx.shadowBlur = 16 * dpr(); }
      ctx.beginPath();
      ctx.arc(xy.x, xy.y, rad, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
      // Phase 34: goldener Overtake-Ring fuer kurz zuvor aufgestiegene Karts.
      const _otAge = _overtakeAtByMac[mac] != null ? (now - _overtakeAtByMac[mac]) : Infinity;
      if (_otAge < MARKER_OVERTAKE_MS) {
        ctx.strokeStyle = 'rgba(255,200,60,.9)';
        ctx.lineWidth = 2 * dpr();
        ctx.beginPath();
        ctx.arc(xy.x, xy.y, rad + 4 * dpr(), 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.restore();
      // Phase 34: Label nicht sofort zeichnen — Anker fuer Declutter sammeln.
      if (posByMac && posByMac[mac] != null) {
        labels.push({ x: xy.x, y: xy.y - (rad + 6 * dpr()), text: 'P' + posByMac[mac], alpha: stale ? 0.4 : 1 });
      }
    });
    // Phase 34: ueberlappende Labels vertikal entzerren, dann zeichnen.
    if (labels.length) {
      const ys = declutterLabels(labels.map(l => ({ x: l.x, y: l.y })), 13 * dpr(), 22 * dpr());
      ctx.save();
      ctx.font = `900 ${11 * dpr()}px monospace`;
      ctx.textAlign = 'center';
      ctx.fillStyle = '#fff';
      for (let i = 0; i < labels.length; i++) {
        ctx.globalAlpha = labels[i].alpha;
        ctx.fillText(labels[i].text, labels[i].x, ys[i]);
      }
      ctx.restore();
    }
  } catch (e) { console.warn('drawKartMarkersOn:', e); }
}
function drawLineOn(ctx, c, ep, color, label, flash) {
  const xy1 = gpsXYOnCanvas(ep.p1.lat, ep.p1.lon, c);
  const xy2 = gpsXYOnCanvas(ep.p2.lat, ep.p2.lon, c);
  ctx.save();
  ctx.strokeStyle = flash ? css('--pr') : color;
  ctx.lineWidth = (flash ? 5 : 3) * dpr();
  ctx.setLineDash(flash ? [] : [6 * dpr(), 4 * dpr()]);
  ctx.beginPath();
  ctx.moveTo(xy1.x, xy1.y);
  ctx.lineTo(xy2.x, xy2.y);
  ctx.stroke();
  ctx.setLineDash([]);
  // Endpoint dots
  [xy1, xy2].forEach(p => {
    ctx.fillStyle = flash ? css('--pr') : color;
    ctx.beginPath(); ctx.arc(p.x, p.y, 4 * dpr(), 0, Math.PI * 2); ctx.fill();
  });
  // Label
  const mx = (xy1.x + xy2.x) / 2, my = (xy1.y + xy2.y) / 2;
  ctx.fillStyle = flash ? css('--pr') : color;
  ctx.font = `900 ${10 * dpr()}px monospace`;
  ctx.textAlign = 'center';
  ctx.fillText(flash && label === 'START' ? 'ZIEL' : label, mx, my - 8 * dpr());
  ctx.restore();
}
// Ghost-Runde: Linie der besten Runde blass gestrichelt + Geister-Punkt an
// der Position, die der Ghost bei gleicher verstrichener Rundenzeit hatte.
// Punkt nur waehrend einer laufenden Runde; verschwindet, wenn der Ghost
// die Runde beendet hat (ghostPointAt -> null).
function drawGhostOn(c, ctx) {
  const trace = state.bestLapTrace;
  ctx.save();
  ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  ctx.beginPath();
  for (let i = 0; i < trace.length; i++) {
    const xy = gpsXYOnCanvas(trace[i].lat, trace[i].lon, c);
    if (i) ctx.lineTo(xy.x, xy.y); else ctx.moveTo(xy.x, xy.y);
  }
  ctx.strokeStyle = 'rgba(187,154,247,.35)';
  ctx.lineWidth = 2 * dpr();
  ctx.setLineDash([5 * dpr(), 5 * dpr()]);
  ctx.stroke();
  ctx.setLineDash([]);
  if (state.lapStart) {
    const gp = ghostPointAt(trace, Date.now() - state.lapStart);
    if (gp) {
      const xy = gpsXYOnCanvas(gp.lat, gp.lon, c);
      ctx.fillStyle = 'rgba(187,154,247,.9)';
      ctx.shadowColor = 'rgba(187,154,247,.8)';
      ctx.shadowBlur = 10 * dpr();
      ctx.beginPath();
      ctx.arc(xy.x, xy.y, 5.5 * dpr(), 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
    }
  }
  ctx.restore();
}
function drawHeatmapOn(c, ctx) {
  const trace = state.currentLapTrace;
  if (!trace || trace.length < 2 || !state.heatmap.lapMaxSpeed) return;
  const max = state.heatmap.lapMaxSpeed;
  ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  for (let i = 1; i < trace.length; i++) {
    const p0 = trace[i - 1], p1 = trace[i];
    const xy0 = gpsXYOnCanvas(p0.lat, p0.lon, c);
    const xy1 = gpsXYOnCanvas(p1.lat, p1.lon, c);
    const ratio = Math.min(1, p1.speed / max);
    let r, g, b;
    if (ratio < 0.5) { r = 224; g = Math.round(96 + ratio * 318); b = 32; }
    else { r = Math.round(224 - (ratio - 0.5) * 352); g = 224; b = Math.round(32 + (ratio - 0.5) * 64); }
    ctx.strokeStyle = `rgb(${r},${g},${b})`;
    ctx.lineWidth = 5 * dpr();
    ctx.beginPath();
    ctx.moveTo(xy0.x, xy0.y);
    ctx.lineTo(xy1.x, xy1.y);
    ctx.stroke();
  }
}

// Canvas-Referenzen aufloesen -- wird von init() in rasicross.js gerufen.
function initTrackCanvases() {
  _trackCanvas = $('trackCanvas');
  _scanCanvas = $('scanCanvas');
}

// Interface-Marker: von rasicross.js (u.a. init/Render-Loop/Editor/Sektoren)
// genutzte Funktionen -- verhindert no-unused-vars, dokumentiert das API.
void [initTrackCanvases, resizeCanvases, gpsXYOnCanvas, drawTrack,
      drawTrackOn, drawLineOn, drawGhostOn, drawHeatmapOn];
