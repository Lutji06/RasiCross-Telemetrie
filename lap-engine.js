// ============================================================
//  RasiCross — lap-engine.js  (pure per-kart race/lap logic)
// ============================================================
//  Dependency-free UMD: runs under node:test (CI) and in the
//  browser as window.RasiLapEngine. No DOM, no registry, no
//  globals. Holds the participant data model + lap/sector/best
//  computations used by races.js / laps-drivers.js / track.js.
// ============================================================
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.RasiLapEngine = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function bestFromLaps(laps) {
    var ms = null, num = null;
    for (var i = 0; i < (laps || []).length; i++) {
      var l = laps[i];
      if (!l.valid) continue;
      if (ms == null || l.timeMs < ms) { ms = l.timeMs; num = l.number; }
    }
    return { ms: ms, num: num };
  }

  function makePart(mac, driverId, now) {
    return {
      mac: mac,
      startDriverId: driverId || null,
      currentDriverId: driverId || null,
      laps: [],
      stints: [],
      speedTrace: [],
      bestLapMs: null,
      bestLapNum: null,
      joinedAt: now != null ? now : null,
    };
  }

  // Idempotent: only wraps legacy top-level laps/stints once.
  function migrateRace(r, defaultMac) {
    if (!r || r.participants) return r;
    var mac = r.kartMac || defaultMac;
    var p = makePart(mac, r.currentDriverId || r.startDriverId || null, r.startedAt || null);
    p.startDriverId = r.startDriverId || null;
    p.laps = Array.isArray(r.laps) ? r.laps.slice() : [];
    p.stints = Array.isArray(r.stints) ? r.stints.slice() : [];
    p.speedTrace = Array.isArray(r.speedTrace) ? r.speedTrace.slice() : [];
    var b = bestFromLaps(p.laps);
    p.bestLapMs = b.ms; p.bestLapNum = b.num;
    r.participants = {};
    r.participants[mac] = p;
    return r;
  }

  function participantsOf(r) {
    if (!r || !r.participants) return [];
    var out = [], keys = Object.keys(r.participants);
    for (var i = 0; i < keys.length; i++) out.push(r.participants[keys[i]]);
    return out;
  }

  function getOrCreatePart(r, mac, driverId, now) {
    if (!r.participants) r.participants = {};
    if (!r.participants[mac]) r.participants[mac] = makePart(mac, driverId, now);
    return r.participants[mac];
  }

  function flatLaps(r) {
    var ps = participantsOf(r), out = [];
    for (var i = 0; i < ps.length; i++) {
      var laps = ps[i].laps || [];
      for (var j = 0; j < laps.length; j++) out.push(laps[j]);
    }
    return out;
  }

  function flatValidLaps(r) { return flatLaps(r).filter(function (l) { return l.valid; }); }

  function flatStints(r) {
    var ps = participantsOf(r), out = [];
    for (var i = 0; i < ps.length; i++) {
      var st = ps[i].stints || [];
      for (var j = 0; j < st.length; j++) out.push(st[j]);
    }
    return out;
  }

  function partValidLaps(part) {
    return ((part && part.laps) || []).filter(function (l) { return l.valid; });
  }

  // Pushes a completed lap into part.laps. Per-kart lap number = count+1.
  function commitLap(part, o) {
    if (!part.laps) part.laps = [];
    var lap = {
      number: part.laps.length + 1,
      timeMs: o.now - o.lapStart,
      driverId: o.driverId != null ? o.driverId : part.currentDriverId,
      kartMac: o.kartMac,
      maxSpeed: o.maxSpeed || 0,
      maxRpm: o.maxRpm || 0,
      distanceM: o.distanceM || 0,
      sectors: Array.isArray(o.sectors) ? o.sectors.slice(0, 3) : [null, null, null],
      valid: (o.now - o.lapStart) >= (o.minLapMs || 0),
    };
    part.laps.push(lap);
    var isBest = part.bestLapMs == null || lap.timeMs < part.bestLapMs;
    if (isBest) { part.bestLapMs = lap.timeMs; part.bestLapNum = lap.number; }
    return { lap: lap, isBest: isBest };
  }

  function sectorBestUpdate(sectorsBest, i, sectorMs) {
    if (sectorsBest[i] == null || sectorMs < sectorsBest[i]) {
      sectorsBest[i] = sectorMs;
      return true;
    }
    return false;
  }

  function trackRecordFromKarts(bestsList) {
    var rec = [null, null, null];
    for (var i = 0; i < bestsList.length; i++) {
      var b = bestsList[i] || [];
      for (var s = 0; s < 3; s++) {
        if (b[s] == null) continue;
        if (rec[s] == null || b[s] < rec[s]) rec[s] = b[s];
      }
    }
    return rec;
  }

  // Phase 31: Live-Positions-Ranking. lastCrossingByMac[mac] = k.lapStart
  // (Zeitstempel der letzten Linien-Durchfahrt; null/undefined = unarmiert).
  // Sortierung: gueltige Runden absteigend, Tiebreak frueheste Durchfahrt,
  // unarmierte Karts stabil ans Ende.
  function rankParticipants(race, lastCrossingByMac) {
    var ps = participantsOf(race), cross = lastCrossingByMac || {};
    var list = [];
    for (var i = 0; i < ps.length; i++) {
      var p = ps[i];
      var c = cross[p.mac];
      list.push({
        mac: p.mac,
        idx: i,
        laps: partValidLaps(p).length,
        cross: c,
      });
    }
    list.sort(function (a, b) {
      var aArmed = a.cross != null, bArmed = b.cross != null;
      if (aArmed !== bArmed) return aArmed ? -1 : 1;   // armierte zuerst
      if (!aArmed) return a.idx - b.idx;               // beide unarmiert: stabil
      if (a.laps !== b.laps) return b.laps - a.laps;   // mehr Runden zuerst
      return a.cross - b.cross;                         // frueher ueberquert zuerst
    });
    var leaderLaps = list.length ? list[0].laps : 0;
    var leaderCross = list.length ? list[0].cross : null;
    var out = [];
    for (var j = 0; j < list.length; j++) {
      var e = list[j];
      var lapGap = leaderLaps - e.laps;
      var timeGapMs = 0;
      if (j > 0 && lapGap === 0 && e.cross != null && leaderCross != null) {
        timeGapMs = e.cross - leaderCross;
      }
      // Phase 32: Intervall zum Vordermann (Position n-1), analog zu lapGap/timeGapMs.
      var intervalLapGap = 0, intervalMs = 0;
      if (j > 0) {
        var ahead = list[j - 1];
        intervalLapGap = ahead.laps - e.laps;
        if (intervalLapGap === 0 && e.cross != null && ahead.cross != null) {
          intervalMs = e.cross - ahead.cross;
        }
      }
      out.push({ mac: e.mac, pos: j + 1, laps: e.laps, lapGap: lapGap, timeGapMs: timeGapMs,
                 intervalLapGap: intervalLapGap, intervalMs: intervalMs });
    }
    return out;
  }

  function leaderReachedTarget(ranked, targetLaps) {
    return !!(ranked && ranked.length && ranked[0].laps >= targetLaps);
  }

  // Phase 32: Teilnehmer mit der absolut schnellsten gueltigen Runde im Rennen.
  // Rein abgeleitet aus participant.bestLapMs (von commitLap gepflegt).
  function fastestLapHolder(race) {
    var ps = participantsOf(race), bestMs = null, mac = null, num = null;
    for (var i = 0; i < ps.length; i++) {
      var p = ps[i];
      if (p.bestLapMs == null) continue;
      if (bestMs == null || p.bestLapMs < bestMs) {
        bestMs = p.bestLapMs; mac = p.mac; num = p.bestLapNum != null ? p.bestLapNum : null;
      }
    }
    return bestMs == null ? null : { mac: mac, ms: bestMs, num: num };
  }

  // Phase 33: Karts, die gegenueber prevPosByMac aufgestiegen sind (kleinere
  // pos-Zahl = weiter vorn). Neueinsteiger (keine Vorposition) und Abstiege
  // werden ignoriert. Rein, kein DOM, kein State.
  function positionGains(prevPosByMac, ranked) {
    var prev = prevPosByMac || {}, out = [];
    for (var i = 0; i < (ranked || []).length; i++) {
      var e = ranked[i], pv = prev[e.mac];
      if (pv != null && e.pos < pv) out.push(e.mac);
    }
    return out;
  }

  return {
    migrateRace: migrateRace,
    participantsOf: participantsOf,
    getOrCreatePart: getOrCreatePart,
    flatLaps: flatLaps,
    flatValidLaps: flatValidLaps,
    flatStints: flatStints,
    partValidLaps: partValidLaps,
    bestFromLaps: bestFromLaps,
    commitLap: commitLap,
    sectorBestUpdate: sectorBestUpdate,
    trackRecordFromKarts: trackRecordFromKarts,
    rankParticipants: rankParticipants,
    leaderReachedTarget: leaderReachedTarget,
    fastestLapHolder: fastestLapHolder,
    positionGains: positionGains,
  };
}));
