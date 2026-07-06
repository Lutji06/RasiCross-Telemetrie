// ============================================================
//  RasiCross — kart-rank.js  (memoisiertes Live-Positions-Ranking)
// ============================================================
//  Phase 39: eine gemeinsame, gecachte Ranking-Quelle fuer map-draw
//  (60fps-Marker), kart-overview (Grid) und den Leaderboard-Strip.
//  Vorher rechneten map-draw und kart-overview trackProgressM ueber
//  alle Trackpunkte x Karts pro Frame doppelt. Browser-only.
//  Nutzt geo.js-Globals (traceDistanceM/trackProgressM/lapProgressM)
//  und RasiLapEngine — nur zur Laufzeit, kein Top-Level-Code.
// ============================================================
import { traceDistanceM, trackProgressM, lapProgressM, gpsDist } from './geo.js';
import RasiLapEngine from './lap-engine.js';

  const MEMO_MS = 250;
  let _memo = { at: 0, raceId: null, result: null };
  let _geom = { ptsRef: null, ptsLen: 0, gateLat: null, gateLon: null,
                trackLen: 0, gateOff: 0 };

  // Track-Laenge + Gate-Offset cachen — invalidiert bei neuer Punkte-
  // Referenz/-Laenge oder verschobenem Start-Gate.
  function trackGeom(state) {
    const pts = state.track && state.track.points;
    if (!pts || pts.length < 2) return { pts: null, trackLen: 0, gateOff: 0 };
    const g = state.startGate || {};
    if (_geom.ptsRef !== pts || _geom.ptsLen !== pts.length
        || _geom.gateLat !== g.lat || _geom.gateLon !== g.lon) {
      const trackLen = traceDistanceM(pts);
      const gateOff = (trackLen > 0 && g.lat)
        ? trackProgressM({ lat: g.lat, lon: g.lon }, pts) : 0;
      _geom = { ptsRef: pts, ptsLen: pts.length, gateLat: g.lat, gateLon: g.lon,
                trackLen, gateOff };
    }
    return { pts, trackLen: _geom.trackLen, gateOff: _geom.gateOff };
  }

  // Liefert { ranked, posByMac, hasTrack } oder null (kein laufendes Rennen
  // mit >=2 Teilnehmern). ranked/posByMac-Eintraege kommen 1:1 aus
  // RasiLapEngine.rankParticipants.
  function ranking(state, r) {
    try {
      if (!r || r.status !== 'running') return null;
      const parts = RasiLapEngine.participantsOf(r);
      if (parts.length < 2) return null;
      const now = Date.now();
      if (_memo.result && _memo.raceId === r.id && (now - _memo.at) < MEMO_MS) {
        return _memo.result;
      }
      const geom = trackGeom(state);
      const hasTrack = !!(geom.pts && geom.trackLen > 0);
      const prog = {};
      parts.forEach(p => {
        const kk = state.karts.has(p.mac) ? state.karts.get(p.mac) : null;
        const t = kk && kk.telemetry;
        prog[p.mac] = (hasTrack && t && t.lat && t.lon)
          ? lapProgressM(trackProgressM({ lat: t.lat, lon: t.lon }, geom.pts),
                         geom.gateOff, geom.trackLen)
          : null;
      });
      const ranked = RasiLapEngine.rankParticipants(r, prog);
      const posByMac = {};
      ranked.forEach(e => { posByMac[e.mac] = e; });
      const result = { ranked, posByMac, hasTrack };
      _memo = { at: now, raceId: r.id, result };
      return result;
    } catch (e) { console.warn('RasiKartRank.ranking:', e); return null; }
  }

  // ESM-Export (Phase 42): Default-Objekt = bisheriges window.RasiKartRank
  export default { ranking };
