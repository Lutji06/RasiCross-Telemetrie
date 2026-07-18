// ============================================================
//  RasiCross — store.js  (State + Persistenz, Phase 44)
//  Herausgeloest aus rasicross.js — NUR bewegt, nicht geaendert.
//  state/Buckets sind die einzige Quelle der Wahrheit (Phase 43).
// ============================================================

import KartRegistry from './kart-registry.js';
import RasiKartRoster from './kart-roster.js';
import RasiLapEngine from './lap-engine.js';
import { setText, logTime, rcAlert } from './rasicross.js';

const SAVE_KEY = 'rasicross_v96_data';

const state = {
  // Session
  sessionStart: Date.now(),
  hz: 0,
  _lastHz: 0,
  // Multi-Kart: per-Kart-Felder leben ausschliesslich in state.karts;
  // beide Lese- und Schreibpfade nutzen den Selektor activeKart() (Phase 43).
  karts: KartRegistry.create(),
  activeKartMac: null,
  // Live-Tab-Ansicht: 'single' (aktiver Kart) oder 'overview' (alle Karts).
  // Nicht persistiert; per setLiveView() in live-ui.js umgeschaltet.
  liveView: 'single',
  kartMeta: {},   // {mac: {name, color}} — gespiegelt aus localStorage
  // Settings (global/shared)
  serial: { connected: false, port: null, baud: 115200, portName: '--', autoReconnect: true, reconnectTimer: null, reconnectAttempts: 0, lastPath: null, dropped: false, autoConnected: false },
  demo: { running: false, interval: null, raf: null, t: 0, angle: -Math.PI/2, lapsDone: 0 },
  settings: { maxSpeed: 80, maxRpm: 10000, rpmWarning: 9000, gScale: 3, minLapSeconds: 10, displayUpdateMs: 500, oledPage: 'auto', liveStartView: 'auto', recordAutoArm: true, serialAutoConnect: true, serialLastPath: null, serialLastBaud: 115200, gView: '2d', kartModelYaw: 0, tiles: { enabled: true, urlTemplate: '', liveQuickToggle: true }, drift: { tol: 0.25, minSpeedKmh: 5, minLatG: 0.15 }, rollover: { angleDeg: 75 } },
  theme: 'dark',
  // Track / sectors-config / races (global/shared)
  track: { points: [], bounds: null, scanning: false, totalDistance: 0, maxDistFromStart: 0, closed: false },
  startGate: { enabled: false, lat: 0, lon: 0, heading: 0, width: 14 },
  savedTracks: [],
  activeTrackId: null,
  // Sectors — nur Konfiguration ist global; die Live-Sektorzeiten
  // (cur/sectorStart/lapSectors/lastLapSectors) liegen per Kart in sectorsLive.
  sectors: { boundaries: [null, null], best: [null, null, null], manual: false, clickTarget: null },
  drivers: [],
  races: [],
  activeRaceId: null,
  selectedRaceId: null,
  pendingDriverChange: null,
  expandedRaceIds: {},
  // UI
  gateFlashUntil: 0,
};

function activeKart() {
  let k = state.karts.active();
  if (!k) k = state.karts.get(KartRegistry.DEFAULT_MAC);   // single-source fallback
  return k;
}

function kartFor(mac) {
  const key = mac || KartRegistry.DEFAULT_MAC;
  const isNew = !state.karts.has(key);
  const k = state.karts.get(key);
  // Phase 39: bekannten MAC nach "Karts zuruecksetzen" aus der Persist-Map
  // rehydrieren (Kalibrierung + Motorstunden).
  if (k && isNew && _persistedKarts.cal[key]) Object.assign(k.calibration, _persistedKarts.cal[key]);
  if (k && isNew && _persistedKarts.eng[key]) {
    const pe = _persistedKarts.eng[key];
    Object.assign(k.engine, {
      totalMs: Number(pe.totalMs) || 0,
      lastServiceMs: Number(pe.lastServiceMs) || 0,
      serviceIntervalH: pe.serviceIntervalH != null ? (Number(pe.serviceIntervalH) || 10) : 10,
    });
  }
  // Phase 48: Lebens-Statistik ebenfalls rehydrieren -- sonst nullt der naechste Save die persistierten km.
  if (k && isNew && _persistedKarts.stats[key]) {
    const ps = _persistedKarts.stats[key];
    Object.assign(k.stats, {
      odoM: Number(ps.odoM) || 0,
      moveMs: Number(ps.moveMs) || 0,
      topKmh: Number(ps.topKmh) || 0,
    });
  }
  // Phase 39: Demo-Karts (DE:MO:*) adoptieren den default-Bucket NICHT —
  // sonst wandern echte Kalibrierung/Motorstunden auf einen Wegwerf-Kart.
  if (k && isNew && key !== KartRegistry.DEFAULT_MAC && key.indexOf('DE:MO:') !== 0
      && state.karts.has(KartRegistry.DEFAULT_MAC)) {
    // 9.6-Migration: der erste reale Kart adoptiert den "default"-Bucket
    // (Kalibrierung + Motorlaufzeit) und loescht den Platzhalter danach.
    const dk = state.karts.get(KartRegistry.DEFAULT_MAC);
    if (dk && dk !== k) {
      Object.assign(k.calibration, dk.calibration);
      Object.assign(k.engine, { totalMs: dk.engine.totalMs, lastServiceMs: dk.engine.lastServiceMs, serviceIntervalH: dk.engine.serviceIntervalH });
      const wasDefaultActive = state.karts.activeMac() === KartRegistry.DEFAULT_MAC;
      state.karts.forget(KartRegistry.DEFAULT_MAC);
      if (wasDefaultActive) { state.karts.setActive(key); state.activeKartMac = key; }
    }
  }
  if (k && state.activeKartMac === null) state.activeKartMac = state.karts.activeMac();
  return k;   // null if over MAX_KARTS
}

let _saveTimer = null;
let _quotaWarned = false;
// Phase 39: zuletzt geladene/gespeicherte per-Kart-Persistenz. saveData()
// merged Registry ueber diese Map, damit "Karts zuruecksetzen" (leere
// Registry) Kalibrierung + Motorstunden NICHT verliert. Nur "Kart
// vergessen" loescht Eintraege (rasiPersistForget). Demo-Karts (DE:MO:*)
// werden nie persistiert.
const _persistedKarts = { cal: {}, eng: {}, meta: {}, stats: {} };
// Demo-Karts (DE:MO:*) bekommen Session-Meta, nie Persistenz (Phase 46).
const _demoMeta = {};
function rasiPersistForget(mac) {
  delete _persistedKarts.cal[mac];
  delete _persistedKarts.eng[mac];
  delete _persistedKarts.stats[mac];
  delete _persistedKarts.meta[mac];
  delete _demoMeta[mac];
}
// Roster-Accessoren (Phase 46): einzige Meta-Quelle fuer Chips, Grid,
// Verbindungs-Detail und Karts-Seite. idx nur fuer die Default-Anlage.
function kartMetaFor(mac, idx) {
  // DE:MO:* und der default-Platzhalter-Bucket bleiben Session-only --
  // beide sind nie echte Karts und duerfen den Roster nicht verschmutzen.
  const sessionOnly = RasiKartRoster.isDemoMac(mac) || mac === KartRegistry.DEFAULT_MAC;
  const map = sessionOnly ? _demoMeta : _persistedKarts.meta;
  const r = RasiKartRoster.ensureMeta(map, mac, idx);
  if (r.created && map === _persistedKarts.meta) saveDataDebounced();
  return r.entry;
}
function updateKartMeta(mac, patch) {
  const m = kartMetaFor(mac, Math.max(0, state.karts.macs().indexOf(mac)));
  Object.assign(m, patch);
  if (!RasiKartRoster.isDemoMac(mac)) saveDataDebounced();
  return m;
}
function kartRosterMacs() {
  return RasiKartRoster.rosterMacs(_persistedKarts.meta, state.karts.macs());
}
// Kalibrierung/Motor eines Karts — live-Bucket bevorzugt, sonst die
// persistierte Ablage (offline-Karts auf der Karts-Seite), sonst null.
function kartCalFor(mac) {
  if (state.karts.has(mac)) return state.karts.get(mac).calibration;
  return _persistedKarts.cal[mac] || null;
}
function kartEngineFor(mac) {
  if (state.karts.has(mac)) return state.karts.get(mac).engine;
  return _persistedKarts.eng[mac] || null;
}
function kartStatsFor(mac) {
  if (state.karts.has(mac)) return state.karts.get(mac).stats;
  return _persistedKarts.stats[mac] || null;
}
// Races fuer die Persistenz verschlanken: speedTrace auf max. 1000 Punkte
// downsamplen. Im RAM bleibt die volle Aufloesung erhalten — nur die
// localStorage-Kopie wird kleiner (5-MB-Quota ueber eine Saison).
const PERSIST_TRACE_MAX = 1000;
function _persistRace(r) {
  // Phase 30: speed traces live per-participant; downsample each for storage
  // (legacy/no-participants races keep the old top-level path).
  if (!r || !r.participants) {
    const t = r && r.speedTrace;
    if (!Array.isArray(t) || t.length <= PERSIST_TRACE_MAX) return r;
    const step = Math.ceil(t.length / PERSIST_TRACE_MAX);
    return Object.assign({}, r, { speedTrace: t.filter((_, i) => i % step === 0) });
  }
  let changed = false;
  const parts = {};
  for (const mac of Object.keys(r.participants)) {
    const p = r.participants[mac];
    const t = p && p.speedTrace;
    if (Array.isArray(t) && t.length > PERSIST_TRACE_MAX) {
      const step = Math.ceil(t.length / PERSIST_TRACE_MAX);
      parts[mac] = Object.assign({}, p, { speedTrace: t.filter((_, i) => i % step === 0) });
      changed = true;
    } else {
      parts[mac] = p;
    }
  }
  return changed ? Object.assign({}, r, { participants: parts }) : r;
}
function saveData() {
  if (activeKart().replay.active) return;  // replay uses disposable state — never persist
  try {
    const k = activeKart();
    // Per-Kart Kalibrierung + Motorlaufzeit (keyed by MAC). Legacy-Felder
    // (calibration/engine) bleiben fuer Downgrade-Gnade aus dem aktiven Kart.
    const _kartsCal = Object.assign({}, _persistedKarts.cal);
    const _kartsEngine = Object.assign({}, _persistedKarts.eng);
    const _kartsStats = Object.assign({}, _persistedKarts.stats);
    for (const mac of state.karts.macs()) {
      if (mac.indexOf('DE:MO:') === 0) continue;   // Demo-Karts nie persistieren
      const kk = state.karts.get(mac);
      _kartsCal[mac] = kk.calibration;
      _kartsEngine[mac] = { totalMs: kk.engine.totalMs, lastServiceMs: kk.engine.lastServiceMs, serviceIntervalH: kk.engine.serviceIntervalH };
      _kartsStats[mac] = { odoM: kk.stats.odoM, moveMs: kk.stats.moveMs, topKmh: kk.stats.topKmh };
    }
    _persistedKarts.cal = _kartsCal;
    _persistedKarts.eng = _kartsEngine;
    _persistedKarts.stats = _kartsStats;
    const payload = {
      version: '9.6', savedAt: new Date().toISOString(),
      settings: state.settings, calibration: k.calibration, theme: state.theme,
      kartsCal: _kartsCal, kartsEngine: _kartsEngine,
      kartsStats: _kartsStats,
      kartsMeta: _persistedKarts.meta,
      drivers: state.drivers, races: state.races.map(_persistRace), savedTracks: state.savedTracks,
      activeRaceId: state.activeRaceId, selectedRaceId: state.selectedRaceId,
      activeTrackId: state.activeTrackId,
      track: state.track, startGate: state.startGate, sectors: { boundaries: state.sectors.boundaries, manual: state.sectors.manual, best: state.sectors.best },
      engine: { totalMs: k.engine.totalMs, lastServiceMs: k.engine.lastServiceMs, serviceIntervalH: k.engine.serviceIntervalH }
    };
    localStorage.setItem(SAVE_KEY, JSON.stringify(payload));
    setText('storageState', 'Gespeichert ' + logTime());
  } catch (e) {
    console.warn('saveData:', e);
    const quota = e && (e.name === 'QuotaExceededError' || e.code === 22);
    setText('storageState', quota ? 'Speicher voll!' : 'Fehler');
    if (quota && !_quotaWarned) {
      _quotaWarned = true;
      rcAlert('Der lokale Speicher ist voll — Änderungen werden nicht mehr gespeichert! ' +
              'Bitte alte Rennen löschen (Renn-Tab) oder vorher über Einstellungen → ' +
              '"Alle Daten exportieren" sichern.', 'Speicher voll');
    }
  }
}
function saveDataDebounced() { clearTimeout(_saveTimer); _saveTimer = setTimeout(saveData, 400); }
function loadData() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return;
    const d = JSON.parse(raw);
    if (d.settings) Object.assign(state.settings, d.settings);
    if (d.theme) state.theme = d.theme;
    if (Array.isArray(d.drivers)) state.drivers = d.drivers;
    if (Array.isArray(d.races)) {
      state.races = d.races;
      // Phase 30: Alt-Rennen (ohne participants) in Teilnehmer-Modell migrieren
      // (idempotent, additiv — Top-Level laps/stints bleiben erhalten).
      state.races.forEach(r => RasiLapEngine.migrateRace(r, KartRegistry.DEFAULT_MAC));
      // Pause running races on reload
      state.races.forEach(r => { if (r.status === 'running') { r.status = 'paused'; r.pausedAt = Date.now(); } });
    }
    if (Array.isArray(d.savedTracks)) state.savedTracks = d.savedTracks;
    if (d.activeRaceId) state.activeRaceId = d.activeRaceId;
    if (d.selectedRaceId) state.selectedRaceId = d.selectedRaceId;
    if (d.activeTrackId) state.activeTrackId = d.activeTrackId;
    if (d.track) Object.assign(state.track, d.track);
    if (d.startGate) Object.assign(state.startGate, d.startGate);
    if (d.sectors) {
      if (Array.isArray(d.sectors.boundaries)) state.sectors.boundaries = d.sectors.boundaries;
      if (typeof d.sectors.manual === 'boolean') state.sectors.manual = d.sectors.manual;
      if (Array.isArray(d.sectors.best)) state.sectors.best = d.sectors.best;
    }
    // Multi-Kart Migration (9.6 additiv): kartsCal/kartsEngine bevorzugen,
    // sonst altes Single-Objekt in den "default"-Bucket legen (vom ersten
    // realen Kart adoptiert, sobald er funkt — siehe kartFor()).
    const _cal = d.kartsCal || (d.calibration ? { [KartRegistry.DEFAULT_MAC]: d.calibration } : {});
    const _eng = d.kartsEngine || (d.engine ? { [KartRegistry.DEFAULT_MAC]: d.engine } : {});
    const _stats = (d.kartsStats && typeof d.kartsStats === 'object') ? d.kartsStats : {};
    for (const mac of new Set([...Object.keys(_cal), ...Object.keys(_eng), ...Object.keys(_stats)])) {
      const kk = state.karts.get(mac);   // legt Bucket an (Cap beachtet)
      if (!kk) continue;
      if (_cal[mac]) Object.assign(kk.calibration, _cal[mac]);
      if (_eng[mac]) Object.assign(kk.engine, {
        totalMs: Number(_eng[mac].totalMs) || 0,
        lastServiceMs: Number(_eng[mac].lastServiceMs) || 0,
        serviceIntervalH: _eng[mac].serviceIntervalH != null ? (Number(_eng[mac].serviceIntervalH) || 10) : 10,
      });
      if (_stats[mac]) Object.assign(kk.stats, {
        odoM: Number(_stats[mac].odoM) || 0,
        moveMs: Number(_stats[mac].moveMs) || 0,
        topKmh: Number(_stats[mac].topKmh) || 0,
      });
    }
    Object.assign(_persistedKarts.cal, _cal);
    Object.assign(_persistedKarts.eng, _eng);
    Object.assign(_persistedKarts.stats, _stats);
    if (d.kartsMeta && typeof d.kartsMeta === 'object') Object.assign(_persistedKarts.meta, d.kartsMeta);
    state.activeKartMac = state.karts.activeMac();
  } catch (e) { console.warn('loadData:', e); }
}
// Phase 46: Alt-Key des Chip-Editors einmalig ins Roster uebernehmen.
function migrateLegacyKartMeta() {
  try {
    const legacy = localStorage.getItem('rasi.kartMeta.v1');
    if (RasiKartRoster.migrateLegacyMeta(_persistedKarts.meta, legacy)) {
      localStorage.removeItem('rasi.kartMeta.v1');
      saveDataDebounced();
    }
  } catch (e) { /* Migration darf den Start nie verhindern */ }
}
window.addEventListener('beforeunload', saveData);

export {
  SAVE_KEY, state, activeKart, kartFor, rasiPersistForget,
  kartMetaFor, updateKartMeta, kartRosterMacs, kartCalFor, kartEngineFor, kartStatsFor,
  saveData, saveDataDebounced, loadData, migrateLegacyKartMeta,
};
