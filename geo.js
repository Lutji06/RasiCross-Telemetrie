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

// ── UMD-style export ────────────────────────────────────────
(function () {
  var api = {
    fmtMs: fmtMs, fmtClock: fmtClock, fmtDelta: fmtDelta,
    gpsDist: gpsDist, traceDistanceM: traceDistanceM,
    headingFromPoints: headingFromPoints, segmentsCross: segmentsCross,
    crossingDirectionOk: crossingDirectionOk, lineEndpointsFromGate: lineEndpointsFromGate,
    structuralRaceKey: structuralRaceKey
  };
  if (typeof module !== 'undefined' && module.exports) { module.exports = api; }
  if (typeof window !== 'undefined') {
    for (var k in api) { if (Object.prototype.hasOwnProperty.call(api, k)) window[k] = api[k]; }
  }
})();
