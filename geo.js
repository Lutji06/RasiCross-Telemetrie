'use strict';
// ============================================================
//  geo.js — pure lap/geo/format helpers (RasiCross)
//  Single source of truth. Loaded as a classic <script> BEFORE
//  rasicross.js (assigns the same global names the app already
//  uses, so call sites are unchanged) and as a CommonJS module
//  for node:test. Dependency-free. No DOM, no globals besides
//  the explicit assignments at the bottom.
// ============================================================

function fmtMs(ms) {
  if (ms == null || !isFinite(ms)) return '--:--.---';
  const sign = ms < 0 ? '-' : '';
  ms = Math.abs(Math.round(ms));
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const msr = ms % 1000;
  return `${sign}${m}:${String(s).padStart(2,'0')}.${String(msr).padStart(3,'0')}`;
}
function fmtClock(ms) {
  if (ms == null || !isFinite(ms)) return '--:--';
  ms = Math.max(0, Math.round(ms));
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return h ? `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}` : `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
}
function fmtDelta(ms) {
  if (ms == null) return '--';
  const sign = ms >= 0 ? '+' : '';
  return sign + (ms / 1000).toFixed(3) + 's';
}

function gpsDist(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const mLat = ((lat1 + lat2) / 2) * Math.PI / 180;
  return Math.sqrt((R * dLon * Math.cos(mLat)) ** 2 + (R * dLat) ** 2);
}

// Aufsummierte GPS-Distanz eines Tracks (Polyline-Laenge in Metern)
function traceDistanceM(trace) {
  if (!trace || trace.length < 2) return 0;
  let m = 0;
  for (let i = 1; i < trace.length; i++) {
    const a = trace[i - 1], b = trace[i];
    if (a && b && a.lat != null && b.lat != null) {
      m += gpsDist(a.lat, a.lon, b.lat, b.lon);
    }
  }
  return m;
}

function headingFromPoints(p1, p2) {
  if (!p1 || !p2) return 0;
  const dLat = p2.lat - p1.lat;
  const dLon = p2.lon - p1.lon;
  return ((Math.atan2(dLon, dLat) * 180 / Math.PI) + 360) % 360;
}
function segmentsCross(a1, a2, b1, b2) {
  const d = (a2.lon - a1.lon) * (b2.lat - b1.lat) - (a2.lat - a1.lat) * (b2.lon - b1.lon);
  if (Math.abs(d) < 1e-12) return false;
  const t = ((b1.lon - a1.lon) * (b2.lat - b1.lat) - (b1.lat - a1.lat) * (b2.lon - b1.lon)) / d;
  const u = ((b1.lon - a1.lon) * (a2.lat - a1.lat) - (b1.lat - a1.lat) * (a2.lon - a1.lon)) / d;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1;
}
function crossingDirectionOk(prevLat, prevLon, lat, lon, expectedHeading) {
  if (expectedHeading == null) return true;
  const moveHead = ((Math.atan2(lon - prevLon, lat - prevLat) * 180 / Math.PI) + 360) % 360;
  const exp = ((Number(expectedHeading) || 0) + 360) % 360;
  const diff = Math.abs(((moveHead - exp) + 540) % 360 - 180);
  return diff < 90;
}
function lineEndpointsFromGate(gate) {
  if (!gate || !gate.lat) return null;
  const w = (Number(gate.width) || 14) / 2;
  const headingPerp = (((Number(gate.heading) || 0) + 90) * Math.PI / 180);
  const R = 6371000;
  const lt = gate.lat * Math.PI / 180;
  const dLat = w * Math.cos(headingPerp) / R * 180 / Math.PI;
  const dLon = w * Math.sin(headingPerp) / (R * Math.cos(lt)) * 180 / Math.PI;
  return { p1: { lat: gate.lat + dLat, lon: gate.lon + dLon }, p2: { lat: gate.lat - dLat, lon: gate.lon - dLon } };
}

// Ghost-Runde: Position auf einer Runden-Trace ({t,lat,lon,...}; t = ms seit
// Rundenstart, monoton) zur verstrichenen Zeit elapsedMs — linear interpoliert.
// null wenn Trace leer/ungueltig oder der Ghost die Runde schon beendet hat
// (elapsed > letzter t). Vor dem ersten Punkt wird der erste Punkt geliefert.
function ghostPointAt(trace, elapsedMs) {
  if (!Array.isArray(trace) || !trace.length) return null;
  const t = Number(elapsedMs);
  if (!isFinite(t) || t < 0) return null;
  const last = trace[trace.length - 1];
  if (t > last.t) return null;                       // Ghost ist schon im Ziel
  if (t <= trace[0].t) return { lat: trace[0].lat, lon: trace[0].lon };
  // Binaersuche: groesster Index mit trace[lo].t <= t
  let lo = 0, hi = trace.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (trace[mid].t <= t) lo = mid; else hi = mid;
  }
  const a = trace[lo], b = trace[hi];
  const span = b.t - a.t;
  const f = span > 0 ? (t - a.t) / span : 0;
  return { lat: a.lat + (b.lat - a.lat) * f, lon: a.lon + (b.lon - a.lon) * f };
}

// Stabiler Schluessel ueber die *strukturellen* Felder einer Display-
// Nachricht (alles ausser den staendig tickenden Live-Werten). Wird
// vom Dashboard genutzt, um nur bei echten Aenderungen ein display-
// Paket per USB an die Bridge zu schicken.
function structuralRaceKey(d) {
  d = d || {};
  return JSON.stringify([
    d.driver || '', d.num || '', d.lapn || 0, d.target || '',
    Array.isArray(d.sectors) ? d.sectors.join('|') : '',
    d.best_lap || '', d.live_delta_ref == null ? null : d.live_delta_ref,
    d.length_type || '', d.page || '',
    d.running ? 1 : 0, d.pit ? 1 : 0
  ]);
}

// Phase 34: Vertikales Label-Declutter. points=[{x,y}] (Canvas-Pixel). Liefert
// angepasste y-Werte (Eingabe-Reihenfolge), sodass zwei Labels mit x-Abstand
// < minGapX nicht naeher als minGapY in y stehen. Greedy von oben, nur nach
// unten geschoben; stabile Sortierung -> kein Frame-zu-Frame-Springen.
function declutterLabels(points, minGapY, minGapX) {
  var n = points.length;
  var order = [];
  for (var i = 0; i < n; i++) order.push(i);
  order.sort(function (a, b) { return (points[a].y - points[b].y) || (a - b); });
  var outY = new Array(n);
  var placed = [];
  for (var k = 0; k < n; k++) {
    var idx = order[k];
    var px = points[idx].x, py = points[idx].y;
    var moved = true;
    while (moved) {
      moved = false;
      for (var j = 0; j < placed.length; j++) {
        if (Math.abs(placed[j].x - px) < minGapX && Math.abs(placed[j].y - py) < minGapY) {
          py = placed[j].y + minGapY;
          moved = true;
        }
      }
    }
    placed.push({ x: px, y: py });
    outY[idx] = py;
  }
  return outY;
}

// Phase 36: Projiziert point={lat,lon} auf die Polyline trackPoints und liefert
// die aufsummierte Distanz (Meter) vom Strecken-Anfang bis zur naechstgelegenen
// Projektion. Lokale equirektangulaere Meter-Naeherung je Segment. 0 bei <2 Pkt.
function trackProgressM(point, trackPoints) {
  if (!point || !trackPoints || trackPoints.length < 2) return 0;
  var best = Infinity, bestDist = 0, cum = 0;
  for (var i = 1; i < trackPoints.length; i++) {
    var a = trackPoints[i - 1], b = trackPoints[i];
    var segLen = gpsDist(a.lat, a.lon, b.lat, b.lon);
    var t = 0;
    if (segLen > 0) {
      var mLat = 111320, mLon = 111320 * Math.cos(a.lat * Math.PI / 180);
      var bx = (b.lon - a.lon) * mLon, by = (b.lat - a.lat) * mLat;
      var px = (point.lon - a.lon) * mLon, py = (point.lat - a.lat) * mLat;
      var len2 = bx * bx + by * by;
      t = len2 > 0 ? (px * bx + py * by) / len2 : 0;
      if (t < 0) t = 0; else if (t > 1) t = 1;
    }
    var projLat = a.lat + (b.lat - a.lat) * t;
    var projLon = a.lon + (b.lon - a.lon) * t;
    var d = gpsDist(point.lat, point.lon, projLat, projLon);
    if (d < best) { best = d; bestDist = cum + segLen * t; }
    cum += segLen;
  }
  return bestDist;
}

// Phase 36: runden-lokaler Fortschritt ab Start/Ziel — verschiebt den
// Roh-Fortschritt um die Gate-Projektion und nimmt modulo Streckenlaenge.
// null wenn keine Strecke (trackLen<=0).
function lapProgressM(rawProgress, gateOff, trackLen) {
  if (!(trackLen > 0)) return null;
  return ((rawProgress - gateOff) % trackLen + trackLen) % trackLen;
}

// ── UMD-style export ────────────────────────────────────────
(function () {
  var api = {
    fmtMs: fmtMs, fmtClock: fmtClock, fmtDelta: fmtDelta,
    gpsDist: gpsDist, traceDistanceM: traceDistanceM,
    headingFromPoints: headingFromPoints, segmentsCross: segmentsCross,
    crossingDirectionOk: crossingDirectionOk, lineEndpointsFromGate: lineEndpointsFromGate,
    structuralRaceKey: structuralRaceKey, ghostPointAt: ghostPointAt,
    declutterLabels: declutterLabels,
    trackProgressM: trackProgressM, lapProgressM: lapProgressM
  };
  if (typeof module !== 'undefined' && module.exports) { module.exports = api; }
  if (typeof window !== 'undefined') {
    for (var k in api) { if (Object.prototype.hasOwnProperty.call(api, k)) window[k] = api[k]; }
  }
})();
