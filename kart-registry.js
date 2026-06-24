// ============================================================
//  RasiCross — kart-registry.js  (pure MAC→kartState registry)
// ============================================================
//  Dependency-free UMD: runs under node:test (CI) and in the
//  browser as window.KartRegistry. No DOM, no globals. Holds the
//  per-kart runtime+persisted state; rasicross.js wires the active
//  kart into the render path via proxy getters.
// ============================================================
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.KartRegistry = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var MAX_KARTS = 4;
  var DEFAULT_MAC = 'default';

  function makeKartState() {
    return {
      connection: { source: 'offline', packets: 0, lost: 0, rssi: null,
                    bridgeMac: '--', kartMac: '--',
                    lastPacketAt: null, seq: null, errors: 0, degraded: false },
      telemetry: { speed: 0, rpm: 0, gx: 0, gy: 0, lat: 0, lon: 0 },
      raw: { speed: 0, rpm: 0, gx: 0, gy: 0, lat: 0, lon: 0 },
      display: { speedLerp: 0, rpmLerp: 0, gxLerp: 0, gyLerp: 0 },
      gps: { fix: false, lastAt: null },
      spdSrc: 'gps',
      batt: { present: false, vbat: 0, soc: 0, warn: 0, cells: 3, _lastWarn: 0 },
      max: { speed: 0, rpm: 0, g: 0 },
      charts: { speed: [], rpm: [], gx: [], gy: [], gz: [], yaw: [], driftIndex: [] },
      imu: { yaw: 0, mtemp: null },
      drift: { status: 'n/a', index: null },
      attitude: { rollDeg: 0, over: false, overState: { active: false } },
      driftSmooth: { idxEma: null, status: 'n/a', counterRun: 0 },
      heatmap: { on: false, lapMaxSpeed: 0 },
      lapStart: null,
      currentLapMax: { speed: 0, rpm: 0 },
      currentLapTrace: [],
      bestLapTrace: null, bestLapMs: null, bestLapNum: null, liveDelta: null,
      autoLap: { prevLat: null, prevLon: null, lastTriggerAt: 0 },
      sectorsLive: { cur: 0, sectorStart: null, lapSectors: [null, null, null], lastLapSectors: null },
      // Sektor-Bestzeiten pro Kart (Phase 30). Strecken-Geometrie/Grenzen
      // bleiben global in state.sectors.boundaries; nur die Bests sind je Kart.
      sectorsBest: [null, null, null],
      recording: { armed: false, buf: [], startWall: null, overflowed: false },
      replay: { active: false, packets: [], idx: 0, virtualMs: 0, durationMs: 0,
                speed: 1, playing: false, raf: null, lastWall: null, snapshot: null },
      calibration: { gxZero: 0, gyZero: 0, swapG: false, invertGx: false,
                     invertGy: false, invertYaw: false, invertRollRate: false, rollZero: 0 },
      engine: { totalMs: 0, lastServiceMs: 0, serviceIntervalH: 10, lastAt: null,
                _unsavedMs: 0, _warned: false },
      activeRaceId: null,
      name: null, color: null,
      _attLastMs: 0,
    };
  }

  function create() {
    var karts = {};
    var orderList = [];
    var activeMac = null;

    function has(mac) { return Object.prototype.hasOwnProperty.call(karts, mac); }

    function get(mac) {
      if (has(mac)) return karts[mac];
      if (orderList.length >= MAX_KARTS) return null;
      var k = makeKartState();
      karts[mac] = k;
      orderList.push(mac);
      if (activeMac === null) activeMac = mac;
      return k;
    }

    function setActive(mac) {
      if (!has(mac)) return false;
      activeMac = mac;
      return true;
    }

    function active() { return activeMac === null ? null : karts[activeMac]; }

    function forget(mac) {
      if (!has(mac)) return false;
      delete karts[mac];
      orderList = orderList.filter(function (m) { return m !== mac; });
      if (activeMac === mac) activeMac = orderList.length ? orderList[0] : null;
      return true;
    }

    function reset() { karts = {}; orderList = []; activeMac = null; }

    return {
      get: get,
      has: has,
      setActive: setActive,
      activeMac: function () { return activeMac; },
      active: active,
      forget: forget,
      reset: reset,
      macs: function () { return orderList.slice(); },
    };
  }

  return {
    MAX_KARTS: MAX_KARTS,
    DEFAULT_MAC: DEFAULT_MAC,
    makeKartState: makeKartState,
    create: create,
  };
}));
