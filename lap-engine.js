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
    p.laps = Array.isArray(r.laps) ? r.laps : [];
    p.stints = Array.isArray(r.stints) ? r.stints : [];
    p.speedTrace = Array.isArray(r.speedTrace) ? r.speedTrace : [];
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
    var lap = {
      number: (part.laps ? part.laps.length : 0) + 1,
      timeMs: o.now - o.lapStart,
      driverId: o.driverId != null ? o.driverId : part.currentDriverId,
      kartMac: o.kartMac,
      maxSpeed: o.maxSpeed || 0,
      maxRpm: o.maxRpm || 0,
      distanceM: o.distanceM || 0,
      sectors: Array.isArray(o.sectors) ? o.sectors.slice(0, 3) : [null, null, null],
      valid: true,
    };
    if (!part.laps) part.laps = [];
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
  };
}));
