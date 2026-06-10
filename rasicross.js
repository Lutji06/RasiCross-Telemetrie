'use strict';
/* ============================================================
   RASICROSS TELEMETRY — Clean Implementation
   Sections:
     1. Constants & State
     2. Utilities
     3. Persistence
     4. Custom Dialogs
     5. Tab navigation + Theme
     6. Settings
     7. Telemetry Pipeline
     8. Tacho/RPM/G-Meter
     9. Track Map (drawing)        -> map-draw.js (Phase 22)
    10. Track Scan
    11. Track Persistence (saved tracks)
    12. Track Editor
    13. Sectors
    14. Lap Detection
    15. Drivers
    16. Races                      -> races.js (Phase 22)
    17. Live UI
    18. Pit-Wall
    19. Serial / Demo              -> serial-demo.js (Phase 22)
    20. Init
   ============================================================ */

// ============================================================
// 1. CONSTANTS & STATE
// ============================================================
const SAVE_KEY = 'rasicross_v96_data';
const $ = id => document.getElementById(id);
const css = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const dpr = () => window.devicePixelRatio || 1;
const uid = () => 'id_' + Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

const state = {
  // Session
  sessionStart: Date.now(),
  hz: 0,
  _lastHz: 0,
  // Connection
  connection: { source: 'offline', packets: 0, lost: 0, rssi: null, bridgeMac: '--', kartMac: '--', lastPacketAt: null, seq: null, errors: 0 },
  serial: { connected: false, port: null, baud: 115200, portName: '--', autoReconnect: true, reconnectTimer: null, reconnectAttempts: 0, lastPath: null },
  demo: { running: false, interval: null, raf: null, t: 0, angle: -Math.PI/2, lapsDone: 0 },
  // Settings
  settings: { maxSpeed: 80, maxRpm: 10000, rpmWarning: 9000, gScale: 3, minLapSeconds: 10, displayUpdateMs: 500, oledPage: 'auto', recordAutoArm: true, gView: '2d', kartModelYaw: 0, tiles: { enabled: true, urlTemplate: '', liveQuickToggle: true }, drift: { tol: 0.25, minSpeedKmh: 5, minLatG: 0.15 }, rollover: { angleDeg: 75 } },
  calibration: { gxZero: 0, gyZero: 0, swapG: false, invertGx: false, invertGy: false, invertYaw: false, invertRollRate: false, rollZero: 0 },
  theme: 'dark',
  // Telemetry
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
  // Track
  track: { points: [], bounds: null, scanning: false, totalDistance: 0, maxDistFromStart: 0, closed: false },
  startGate: { enabled: false, lat: 0, lon: 0, heading: 0, width: 14 },
  savedTracks: [],
  activeTrackId: null,
  // Sectors
  sectors: { boundaries: [null, null], cur: 0, sectorStart: null, lapSectors: [null, null, null], best: [null, null, null], lastLapSectors: null, manual: false, clickTarget: null },
  // Laps & Races
  lapStart: null,
  currentLapMax: { speed: 0, rpm: 0 },
  currentLapTrace: [],
  bestLapTrace: null,
  bestLapMs: null,
  bestLapNum: null,
  liveDelta: null,
  autoLap: { prevLat: null, prevLon: null, lastTriggerAt: 0 },
  drivers: [],
  races: [],
  activeRaceId: null,
  selectedRaceId: null,
  pendingDriverChange: null,
  expandedRaceIds: {},
  // UI
  gateFlashUntil: 0,
  // Recording / Replay (NEVER persisted — see saveData guard)
  recording: { armed: false, buf: [], startWall: null, overflowed: false },
  replay: { active: false, packets: [], idx: 0, virtualMs: 0, durationMs: 0,
            speed: 1, playing: false, raf: null, lastWall: null, snapshot: null },
};

// ============================================================
// 2. UTILITIES
// ============================================================
// fmtMs / fmtClock / fmtDelta moved to geo.js (loaded as a <script> before rasicross.js; also a CommonJS module for tests)
function setText(id, val) { const e = $(id); if (e) e.textContent = val; }

// Shared-ID fan-out — Live and Detail share several values (Speed, RPM, Lap, ...).
// DomTargets is provided by dom-targets.js (loaded before rasicross.js).
function setTextShared(key, value) {
  const ids = (typeof DomTargets !== 'undefined' && DomTargets.targetIdsFor)
    ? DomTargets.targetIdsFor(key) : [];
  for (const id of ids) setText(id, value);
}
function setHtmlShared(key, html) {
  const ids = (typeof DomTargets !== 'undefined' && DomTargets.targetIdsFor)
    ? DomTargets.targetIdsFor(key) : [];
  for (const id of ids) {
    const el = $(id);
    if (el) el.innerHTML = html;
  }
}

// traceDistanceM moved to geo.js

// gpsDist / headingFromPoints / segmentsCross / crossingDirectionOk / lineEndpointsFromGate moved to geo.js
function logTime(ts = Date.now()) { return new Date(ts).toLocaleTimeString('de-DE'); }

// ============================================================
// 3. PERSISTENCE
// ============================================================
let _saveTimer = null;
let _quotaWarned = false;
// Races fuer die Persistenz verschlanken: speedTrace auf max. 1000 Punkte
// downsamplen. Im RAM bleibt die volle Aufloesung erhalten — nur die
// localStorage-Kopie wird kleiner (5-MB-Quota ueber eine Saison).
const PERSIST_TRACE_MAX = 1000;
function _persistRace(r) {
  const t = r && r.speedTrace;
  if (!Array.isArray(t) || t.length <= PERSIST_TRACE_MAX) return r;
  const step = Math.ceil(t.length / PERSIST_TRACE_MAX);
  return Object.assign({}, r, { speedTrace: t.filter((_, i) => i % step === 0) });
}
function saveData() {
  if (state.replay && state.replay.active) return;  // replay uses disposable state — never persist
  try {
    const payload = {
      version: '9.6', savedAt: new Date().toISOString(),
      settings: state.settings, calibration: state.calibration, theme: state.theme,
      drivers: state.drivers, races: state.races.map(_persistRace), savedTracks: state.savedTracks,
      activeRaceId: state.activeRaceId, selectedRaceId: state.selectedRaceId,
      activeTrackId: state.activeTrackId,
      track: state.track, startGate: state.startGate, sectors: { boundaries: state.sectors.boundaries, manual: state.sectors.manual, best: state.sectors.best }
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
    if (d.calibration) Object.assign(state.calibration, d.calibration);
    if (d.theme) state.theme = d.theme;
    if (Array.isArray(d.drivers)) state.drivers = d.drivers;
    if (Array.isArray(d.races)) {
      state.races = d.races;
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
  } catch (e) { console.warn('loadData:', e); }
}
window.addEventListener('beforeunload', saveData);

// ============================================================
// 4. CUSTOM DIALOGS
// ============================================================
function rcAlert(msg, title = 'Hinweis') {
  return new Promise(resolve => {
    setText('rcAlertTitle', title);
    setText('rcAlertMsg', msg);
    const btns = $('rcAlertBtns');
    btns.innerHTML = '';
    const ok = document.createElement('button');
    ok.className = 'btn primary'; ok.textContent = 'OK';
    ok.onclick = () => { $('rcAlertOverlay').classList.remove('show'); resolve(); };
    btns.appendChild(ok);
    $('rcAlertOverlay').classList.add('show');
    setTimeout(() => ok.focus(), 50);
  });
}
function rcConfirm(msg, title = 'Bestätigung', confirmLabel = 'OK', danger = false) {
  return new Promise(resolve => {
    setText('rcAlertTitle', title);
    setText('rcAlertMsg', msg);
    const btns = $('rcAlertBtns'); btns.innerHTML = '';
    const cancel = document.createElement('button');
    cancel.className = 'btn ghost'; cancel.textContent = 'Abbrechen';
    cancel.onclick = () => { $('rcAlertOverlay').classList.remove('show'); resolve(false); };
    const ok = document.createElement('button');
    ok.className = 'btn ' + (danger ? 'danger' : 'primary'); ok.textContent = confirmLabel;
    ok.onclick = () => { $('rcAlertOverlay').classList.remove('show'); resolve(true); };
    btns.appendChild(cancel); btns.appendChild(ok);
    $('rcAlertOverlay').classList.add('show');
    setTimeout(() => ok.focus(), 50);
  });
}
let _toastTimer = null;
function rcToast(msg, ms = 2000) {
  const el = $('rcToast'); if (!el) return;
  el.textContent = msg; el.classList.add('show');
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}

// ============================================================
// 5. TAB NAVIGATION + THEME
// ============================================================
function setupTabs() {
  // Initial: aktiven Tab am body markieren (CSS nutzt body[data-tab=live] fuer no-scroll-Layout)
  const _active = document.querySelector('.nav-item[data-tab].active');
  if (_active) document.body.dataset.tab = _active.dataset.tab;
  document.querySelectorAll('.nav-item[data-tab]').forEach(btn => {
    btn.onclick = () => {
      document.querySelectorAll('.nav-item[data-tab]').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      btn.classList.add('active');
      const tab = btn.dataset.tab;
      const panel = $('tab-' + tab);
      if (panel) panel.classList.add('active');
      document.body.dataset.tab = tab;
      // Resize canvases when tab becomes visible
      setTimeout(resizeCanvases, 50);
      // Bei Driver-Tab: Stats neu berechnen (kann sich nach jedem Rennen aendern)
      if (tab === 'drivers') renderDrivers();
      // Task 7 – Settings-Suche beim Tab-Wechsel zuruecksetzen
      const _ss = document.getElementById('settingsSearch');
      if (_ss && _ss.value) { _ss.value = ''; _ss.dispatchEvent(new Event('input')); }
    };
  });
}
function applyTheme() {
  document.documentElement.dataset.theme = state.theme;
}
function toggleTheme() {
  // Cycle: dark -> light -> outdoor -> dark
  const order = ['dark', 'light', 'outdoor'];
  const idx = order.indexOf(state.theme);
  state.theme = order[(idx + 1) % order.length] || 'dark';
  applyTheme();
  saveDataDebounced();
}

// ============================================================
//  Audio-Cues: Web Audio API, keine externen Dateien
// ============================================================
const rcAudio = (() => {
  let ctx = null;
  let enabled = (() => {
    try { return localStorage.getItem('rc_audio') !== '0'; } catch(e) { return true; }
  })();
  function getCtx() {
    if (!ctx) {
      try { ctx = new (window.AudioContext || window.webkitAudioContext)(); }
      catch(e) { return null; }
    }
    if (ctx && ctx.state === 'suspended') ctx.resume().catch(()=>{});
    return ctx;
  }
  function beep(freq, durMs, vol) {
    if (!enabled) return;
    const c = getCtx(); if (!c) return;
    try {
      const osc = c.createOscillator();
      const g   = c.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      g.gain.value = vol == null ? 0.18 : vol;
      osc.connect(g).connect(c.destination);
      const t = c.currentTime;
      g.gain.setValueAtTime(g.gain.value, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + durMs / 1000);
      osc.start(t);
      osc.stop(t + durMs / 1000);
    } catch(e) {}
  }
  return {
    sectorBest: () => beep(880, 120, 0.15),
    lapBest:    () => { beep(1320, 120, 0.18); setTimeout(() => beep(1760, 180, 0.18), 140); },
    warning:    () => beep(220, 400, 0.22),
    pitCall:    () => { beep(660, 200, 0.2); setTimeout(() => beep(880, 200, 0.2), 220); },
    battWarn:   () => beep(300, 350, 0.2),
    battCrit:   () => { beep(200, 300, 0.25); setTimeout(() => beep(200, 300, 0.25), 320); },
    rollover:   () => { beep(160, 300, 0.3); setTimeout(() => beep(120, 450, 0.3), 300); },
    setEnabled: (v) => { enabled = !!v; try { localStorage.setItem('rc_audio', v ? '1' : '0'); } catch(e){} },
    isEnabled:  () => enabled,
  };
})();

// ============================================================
// 6. SETTINGS
// ============================================================
function formatBytes(b) {
  if (!b || b < 1024) return (b | 0) + ' B';
  if (b < 1024 * 1024) return (b / 1024).toFixed(1) + ' KB';
  return (b / (1024 * 1024)).toFixed(1) + ' MB';
}

const TILES_PRESETS = [
  '',
  'https://basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png',
  'https://basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png',
  'https://basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png',
  'https://a.tile.opentopomap.org/{z}/{x}/{y}.png',
  'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
];

function applyTilesPresetFromUrl() {
  const sel = $('setTilesPreset');
  const url = $('setTilesUrl');
  if (!sel || !url) return;
  const cur = (url.value || '').trim();
  sel.value = TILES_PRESETS.indexOf(cur) >= 0 ? cur : '__custom__';
}

function onTilesPresetChanged() {
  const sel = $('setTilesPreset');
  const url = $('setTilesUrl');
  if (!sel || !url) return;
  const v = sel.value;
  if (v === '__custom__') { url.focus(); return; }
  if (url.value === v) return;
  let prevHost = 'tile.openstreetmap.org';
  try { if (url.value) prevHost = new URL(url.value).host || prevHost; } catch (_) {}
  url.value = v;
  updateTilesUrlHint();
  if (!state.settings.tiles) state.settings.tiles = { enabled: true, urlTemplate: '', liveQuickToggle: true };
  state.settings.tiles.urlTemplate = v;
  saveData();
  let newHost = 'tile.openstreetmap.org';
  try { if (v) newHost = new URL(v).host || newHost; } catch (_) {}
  if (prevHost !== newHost) {
    rcToast('Stil geändert — neue Tiles können in der Strecken-Bibliothek geladen werden');
  }
  try { drawTrack(); renderSavedTracks(); } catch (e) {}
}

function updateTilesUrlHint() {
  const el = $('setTilesUrl');
  const hint = $('setTilesUrlHint');
  if (!el || !hint) return;
  const v = (el.value || '').trim();
  const ok = !v || (v.indexOf('{z}') >= 0 && v.indexOf('{x}') >= 0 && v.indexOf('{y}') >= 0);
  el.classList.toggle('invalid', !ok);
  hint.textContent = ok
    ? (v ? 'Gültige Vorlage.' : 'Leer = OSM Standard wird verwendet.')
    : 'Vorlage muss {z}, {x}, {y} enthalten.';
}

async function onTilesClearClicked() {
  if (!window.rasiTiles) {
    rcAlert('Tile-Cache nur in der Desktop-App verfügbar.', 'Karten-Hintergrund');
    return;
  }
  if (!await rcConfirm('Alle gecachten Karten-Tiles löschen?', 'Cache leeren', 'Löschen', true)) return;
  try {
    const r = await window.rasiTiles.clearAll();
    if (typeof RasiTileRenderer !== 'undefined') RasiTileRenderer.clearMemory();
    rcToast(`${r.deleted || 0} Tiles entfernt (${formatBytes(r.bytes || 0)})`);
    try { drawTrack(); renderSavedTracks(); } catch (e) {}
  } catch (e) {
    rcAlert('Cache konnte nicht geleert werden: ' + (e && e.message ? e.message : e), 'Karten-Hintergrund');
  }
}

function showSettingsGroup(id) {
  const next = RasiSettings.settingsNavReducer(
    (state.settings && state.settings.uiActiveGroup) || 'dashboard',
    { type: 'set', id }
  );
  state.settings.uiActiveGroup = next;
  document.querySelectorAll('#tab-settings .settings-nav-item').forEach(b =>
    b.classList.toggle('active', b.dataset.sgroup === next));
  document.querySelectorAll('#tab-settings .settings-group').forEach(s =>
    s.classList.toggle('active', s.dataset.sgroup === next));
}

function loadSettingsToUi() {
  $('setMaxSpeed').value = state.settings.maxSpeed;
  $('setMaxRpm').value = state.settings.maxRpm;
  $('setRpmWarn').value = state.settings.rpmWarning;
  $('setGScale').value = state.settings.gScale;
  $('setMinLap').value = state.settings.minLapSeconds;
  if ($('setDriftTol')) $('setDriftTol').value = state.settings.drift.tol;
  if ($('setDriftMinSpeed')) $('setDriftMinSpeed').value = state.settings.drift.minSpeedKmh;
  if ($('setRolloverAngle')) $('setRolloverAngle').value = (state.settings.rollover && state.settings.rollover.angleDeg) || 75;
  if ($('setDisplayUpdateMs')) $('setDisplayUpdateMs').value = state.settings.displayUpdateMs || 500;
  $('settingsHint').textContent = `${state.settings.maxSpeed} km/h · ${state.settings.maxRpm} rpm`;
  $('gxOffsetText').textContent = state.calibration.gxZero.toFixed(2);
  $('gyOffsetText').textContent = state.calibration.gyZero.toFixed(2);
  if ($('setInvertGx')) $('setInvertGx').checked = !!state.calibration.invertGx;
  if ($('setInvertGy')) $('setInvertGy').checked = !!state.calibration.invertGy;
  if ($('setSwapG')) $('setSwapG').checked = !!state.calibration.swapG;
  if ($('setInvertYaw')) $('setInvertYaw').checked = !!state.calibration.invertYaw;
  if ($('setInvertRollRate')) $('setInvertRollRate').checked = !!state.calibration.invertRollRate;
  if ($('recAutoArmToggle')) $('recAutoArmToggle').checked = state.settings.recordAutoArm !== false;
  if ($('setTilesEnabled')) {
    $('setTilesEnabled').checked = !!(state.settings.tiles && state.settings.tiles.enabled);
  }
  if ($('setTilesUrl')) {
    $('setTilesUrl').value = (state.settings.tiles && state.settings.tiles.urlTemplate) || '';
    updateTilesUrlHint();
    applyTilesPresetFromUrl();
  }
  if (typeof showSettingsGroup === 'function') {
    showSettingsGroup((state.settings && state.settings.uiActiveGroup) || 'dashboard');
  }
}
let _settingsSaveTimer = null;
let _flashTimerId = null;
function flashSettingsSaved() {
  const active = document.querySelector('#tab-settings .settings-group.active [data-savemark]');
  if (!active) return;
  active.classList.add('show');
  clearTimeout(_flashTimerId);
  _flashTimerId = setTimeout(() => active.classList.remove('show'), 1500);
}
function scheduleSettingsSave() {
  clearTimeout(_settingsSaveTimer);
  _settingsSaveTimer = setTimeout(() => { saveSettingsFromUi(); }, 150);
}
function saveSettingsFromUi() {
  state.settings.maxSpeed = Math.max(20, Math.min(200, Number($('setMaxSpeed').value) || 80));
  state.settings.maxRpm = Math.max(3000, Math.min(20000, Number($('setMaxRpm').value) || 10000));
  state.settings.rpmWarning = Math.max(2000, Math.min(state.settings.maxRpm, Number($('setRpmWarn').value) || 9000));
  state.settings.gScale = Math.max(2, Math.min(5, Number($('setGScale').value) || 3));
  state.settings.minLapSeconds = Math.max(3, Math.min(300, Number($('setMinLap').value) || 10));
  if (!state.settings.drift) state.settings.drift = { tol: 0.25, minSpeedKmh: 5, minLatG: 0.15 };
  state.settings.drift.tol = Math.max(0.05, Math.min(1, Number($('setDriftTol')?.value) || 0.25));
  state.settings.drift.minSpeedKmh = Math.max(1, Math.min(60, Number($('setDriftMinSpeed')?.value) || 5));
  if (!state.settings.rollover) state.settings.rollover = { angleDeg: 75 };
  state.settings.rollover.angleDeg = Math.max(30, Math.min(90, Number($('setRolloverAngle')?.value) || 75));
  const newInterval = Math.max(100, Math.min(2000, Number($('setDisplayUpdateMs')?.value) || 500));
  if (newInterval !== state.settings.displayUpdateMs) {
    state.settings.displayUpdateMs = newInterval;
    restartDisplayUpdateInterval();
  }
  state.calibration.invertGx = !!$('setInvertGx')?.checked;
  state.calibration.invertGy = !!$('setInvertGy')?.checked;
  state.calibration.swapG = !!$('setSwapG')?.checked;
  state.calibration.invertYaw = !!$('setInvertYaw')?.checked;
  state.calibration.invertRollRate = !!$('setInvertRollRate')?.checked;
  drawGMeter._trail = [];
  if (!state.settings.tiles) state.settings.tiles = { enabled: true, urlTemplate: '', liveQuickToggle: true };
  if ($('setTilesEnabled')) state.settings.tiles.enabled = !!$('setTilesEnabled').checked;
  if ($('setTilesUrl')) state.settings.tiles.urlTemplate = ($('setTilesUrl').value || '').trim();
  loadSettingsToUi();
  saveData();
  flashSettingsSaved();
}

// ============================================================
// 7. TELEMETRY PIPELINE
// ============================================================
function armRecording() {
  // Frische Aufnahme starten (auto bei Connect/Demo, wenn aktiviert).
  state.recording.buf = [];
  state.recording.startWall = null;
  state.recording.overflowed = false;
  state.recording.armed = true;
}
function recordPacket(d) {
  const now = Date.now();
  if (state.recording.startWall == null) state.recording.startWall = now;
  const rec = Object.assign({}, d, { t_rel: now - state.recording.startWall, _wall: now });
  const dropped = RasiReplay.pushCapped(state.recording.buf, rec, RasiReplay.REC_MAX);
  if (dropped && !state.recording.overflowed) {
    state.recording.overflowed = true;
    rcToast('⚠ Aufnahme-Puffer voll — älteste Pakete werden verworfen', 4000);
  }
}
// Drift-Eingaenge aus einem (Roh-)Paket — identisch fuer Live und Replay-Aggregat.
// Wendet die IMU-Kalibrierung an (gy: Null-Offset, swap, invertGy; yaw: invertYaw),
// damit der Vorzeichen-/Counter-Check konsistente Achsen vergleicht.
function driftInputs(d, cal) {
  d = d || {};
  cal = cal || {};
  let gx = (Number(d.gx) || 0) - (cal.gxZero || 0);
  let gy = (Number(d.gy) || 0) - (cal.gyZero || 0);
  // Nur gy (Querbeschleunigung) fliesst ins Ergebnis; bei vertauschten Achsen
  // liegt sie auf gx -> gy <- gx (kein voller Swap noetig, gx wird hier nicht mehr gelesen).
  if (cal.swapG) gy = gx;
  if (cal.invertGy) gy = -gy;
  let yaw = Number(d.yaw) || 0;
  if (cal.invertYaw) yaw = -yaw;
  return { yawRate: yaw, latAccel: gy, speed: Math.max(0, Number(d.speed) || 0) };
}

function processTelemetry(d) {
  try {
    if (!d) return;
    if (state.recording.armed && !state.replay.active) recordPacket(d);
    if (d.type === 'bridge_status') {
      if (d.mac) state.connection.bridgeMac = d.mac;
      if (d.kart_mac) state.connection.kartMac = d.kart_mac;
      return;
    }
    state.connection.packets++;
    state.connection.lastPacketAt = Date.now();
    if (d.from_mac) state.connection.kartMac = d.from_mac;
    if (typeof d.rssi === 'number') state.connection.rssi = d.rssi;
    // Verlustzaehlung: eine Quelle. Die Bridge zaehlt ueber die ESP-NOW-
    // Sequenznummern und liefert `lost` kumulativ in jedem Paket mit ->
    // direkt uebernehmen. Eigene seq-Zaehlung nur als Fallback fuer
    // Quellen ohne lost-Feld (Demo, alte Aufnahmen).
    if (d.lost != null) {
      state.connection.lost = Number(d.lost) || 0;
    } else if (d.seq != null && state.connection.seq != null) {
      const delta = (d.seq - state.connection.seq + 65536) % 65536;
      if (delta > 1 && delta < 1000) state.connection.lost += delta - 1;
    }
    if (d.seq != null) state.connection.seq = d.seq;
    state.hz++;
    // Calibrated values
    const speed = Math.max(0, Number(d.speed) || 0);
    const rpm = Math.max(0, Number(d.rpm) || 0);
    let gx = (Number(d.gx) || 0) - state.calibration.gxZero;
    let gy = (Number(d.gy) || 0) - state.calibration.gyZero;
    const gz = Number(d.gz) || 0;                  // Accel-Z (g), jedes Paket
    const di = driftInputs(d, state.calibration);  // geteilte Drift-Normalisierung (inkl. invertYaw)
    const yawv = di.yawRate;                        // vorzeichen-korrigierte Gierrate (deg/s)
    state.imu.yaw = yawv;
    if (d.mtemp != null) state.imu.mtemp = Number(d.mtemp) || 0;  // langsam: letzten Wert halten
    // Apply axis transformations
    if (state.calibration.swapG) { const tmp = gx; gx = gy; gy = tmp; }
    if (state.calibration.invertGx) gx = -gx;
    if (state.calibration.invertGy) gy = -gy;
    // Drift (Phase 20): gehaerteter + geglaetteter Gierraten-Index. di teilt die
    // Eingangs-Normalisierung mit dem Replay-Aggregat; smoothStep liefert
    // EMA-Index + entprellten/hysterese-stabilen Status.
    const dRaw = RasiDrift.analyze(di, state.settings.drift);
    // settings.drift liefert tol (-> Hysterese-Baender); smooth/hyst/counterHold
    // sind nicht in den Settings und fallen in smoothStep auf SMOOTH_DEFAULTS zurueck.
    state.driftSmooth = RasiDrift.smoothStep(state.driftSmooth, dRaw, state.settings.drift);
    state.drift = { status: state.driftSmooth.status, index: state.driftSmooth.idxEma };
    // Rollwinkel (Phase 19b): Roll-Rate (d.roll) + Accel-Schwerkraft-Referenz
    // -> Winkel (Komplementaerfilter), minus Null-Offset. di.latAccel = kalibrierte
    // Querbeschleunigung; gz = Accel-Z.
    const _attNow = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    const _attDt = _attLastMs ? (_attNow - _attLastMs) / 1000 : 0.08;
    _attLastMs = _attNow;
    const _rollRate = (Number(d.roll) || 0) * (state.calibration.invertRollRate ? -1 : 1);
    const _rollRaw = RasiAttitude.rollStep(
      state.attitude.rollDeg + state.calibration.rollZero,
      _rollRate, di.latAccel, Number(d.gz) || 0, _attDt, 0.98);
    state.attitude.rollDeg = _rollRaw - state.calibration.rollZero;
    state.attitude.overState = RasiAttitude.rolloverStep(
      state.attitude.overState, state.attitude.rollDeg, state.settings.rollover);
    state.attitude.over = state.attitude.overState.active;
    if (state.attitude.overState.onset) {
      rcToast('⚠ Mäher umgekippt!', 4000);
      rcAudio.rollover();
    }
    const lat = Number(d.lat);
    const lon = Number(d.lon);
    const hasGps = !!(d.gps_fix ?? d.fix ?? (lat && lon));
    state.gps.fix = hasGps;
    if (lat && lon) state.gps.lastAt = Date.now();
    if (d.spd_src) state.spdSrc = d.spd_src;
    // Batterie (A3): vbat/soc langsam -> nur bei Anwesenheit aktualisieren
    // (sonst letzten Wert behalten); batt_warn jedes Paket wenn aktiv.
    if (d.vbat != null) { state.batt.vbat = Number(d.vbat) || 0; state.batt.present = true; }
    if (d.soc != null)  { state.batt.soc = Number(d.soc) || 0;  state.batt.present = true; }
    if (d.batt_warn != null) {
      state.batt.present = true;
      const w = Number(d.batt_warn) || 0;
      if (w > state.batt._lastWarn) {           // nur Aufwaerts-Transition
        if (w === 2) { rcToast('⛔ Akku kritisch!', 3500); rcAudio.battCrit(); }
        else if (w === 1) { rcToast('⚠ Akku schwach', 3000); rcAudio.battWarn(); }
      }
      state.batt._lastWarn = w;
      state.batt.warn = w;
    }
    state.raw = { speed, rpm, gx: Number(d.gx) || 0, gy: Number(d.gy) || 0, gz, yaw: yawv, lat: lat || 0, lon: lon || 0, pulseHz: Number(d.pulse_hz) || 0 };
    state.telemetry = { speed, rpm, gx, gy, gz, lat: lat || 0, lon: lon || 0 };
    // Update max
    state.max.speed = Math.max(state.max.speed, speed);
    state.max.rpm = Math.max(state.max.rpm, rpm);
    state.max.g = Math.max(state.max.g, Math.sqrt(gx*gx + gy*gy));
    // Per-lap max
    state.currentLapMax.speed = Math.max(state.currentLapMax.speed, speed);
    state.currentLapMax.rpm = Math.max(state.currentLapMax.rpm, rpm);
    state.heatmap.lapMaxSpeed = Math.max(state.heatmap.lapMaxSpeed, speed);
    // Charts (downsampled)
    if (state.charts.speed.length === 0 || (state.connection.packets % 2 === 0)) {
      state.charts.speed.push(speed);
      state.charts.rpm.push(rpm);
      state.charts.gx.push(gx);
      state.charts.gy.push(gy);
      state.charts.gz.push(gz);
      state.charts.yaw.push(yawv);
      state.charts.driftIndex.push(state.drift.index == null ? 0 : state.drift.index);
      const max = 600;
      while (state.charts.speed.length > max) state.charts.speed.shift();
      while (state.charts.rpm.length > max) state.charts.rpm.shift();
      while (state.charts.gx.length > max) state.charts.gx.shift();
      while (state.charts.gy.length > max) state.charts.gy.shift();
      while (state.charts.gz.length > max) state.charts.gz.shift();
      while (state.charts.yaw.length > max) state.charts.yaw.shift();
      while (state.charts.driftIndex.length > max) state.charts.driftIndex.shift();
    }
    // Track current lap trace
    if (state.lapStart && lat && lon) {
      state.currentLapTrace.push({ t: Date.now() - state.lapStart, lat, lon, speed });
      if (state.currentLapTrace.length > 5000) state.currentLapTrace.shift();
    }
    // Lap detection (only if track has start gate)
    if (lat && lon && state.startGate.enabled && state.lapStart) {
      checkLapCrossing(lat, lon);
      checkSectorCrossings(lat, lon);
    }
    // Update prev for direction check
    if (lat && lon) {
      state.autoLap.prevLat = lat;
      state.autoLap.prevLon = lon;
    }
    // Race speed trace (downsampled)
    const r = activeRace();
    if (r && r.status === 'running') {
      r.speedTrace = r.speedTrace || [];
      if (state.connection.packets % 5 === 0) {
        r.speedTrace.push({ t: Date.now() - (r.startedAt || Date.now()), speed, rpm });
        if (r.speedTrace.length > 4000) r.speedTrace.shift();
      }
    }
  } catch (e) { console.warn('processTelemetry:', e); }
}

// (Sektion 8 "Tacho/RPM/G-Meter" -> gauges.js, Phase 23)

// (Sektion 9 "Track Map Drawing" -> map-draw.js, Phase 22)

// (Sektionen 10-13 "Track Scan/Persistence/Editor/Sectors" -> track.js, Phase 23)

// (Sektionen 14-15 "Lap Detection/Driver Stats/Drivers" -> laps-drivers.js, Phase 23)

// (Sektion 16 "Races" -> races.js, Phase 22)

// (Live Charts + Sektion 17 "Live UI" -> live-ui.js, Phase 23)

// (Sektion 18 "Pit-Wall" + Connection-Tab + Pit-Call -> pit-wall.js, Phase 23)

// (Sektion 19 "Serial / Demo" -> serial-demo.js, Phase 22)

// (Export/Import/Reset + Sektion 19b "Recording/Replay" -> recording.js, Phase 23)

// 3D-Viewer instance state (single global; rAF lifecycle managed by start/stop).
// Geteilt mit gauges.js (drawGMeter-Tick) und live-ui.js (updateLiveKPIs).
let _kart3dReady = false;
let _kart3dLastTick = 0;
let _attLastMs = 0;            // wall-clock of last attitude fusion step (ms)

function initGViewToggle() {
  const wrap = $('gViewToggle');
  const c2d = $('gMeterCanvas');
  const c3d = $('gMeter3dCanvas');
  if (!wrap || !c2d || !c3d) return;

  // Try to bring up the 3D backend exactly once.
  try {
    _kart3dReady = !!(window.RasiKart3D && window.RasiKart3D.init &&
                       window.RasiKart3D.init(c3d, { gScale: state.settings.gScale }));
  } catch (e) { _kart3dReady = false; }
  if (!_kart3dReady) {
    const btn3d = wrap.querySelector('button[data-view="3d"]');
    if (btn3d) { btn3d.classList.add('disabled'); btn3d.disabled = true; }
    // Force a known-good state if persisted gView was '3d' but 3D failed.
    if (state.settings.gView === '3d') {
      state.settings.gView = '2d';
      saveData();
    }
  }

  applyGView(state.settings.gView || '2d');

  wrap.querySelectorAll('button').forEach((btn) => {
    btn.addEventListener('click', () => {
      const target = btn.getAttribute('data-view');
      if (target === '3d' && !_kart3dReady) {
        rcToast('3D nicht verfügbar — WebGL fehlt oder vendor/three.min.js fehlt');
        return;
      }
      if (!window.RasiKart3D || !window.RasiKart3D.gViewReducer) return;
      const next = window.RasiKart3D.gViewReducer(state.settings.gView, 'set:' + target);
      if (next === state.settings.gView) return;
      state.settings.gView = next;
      saveData();
      applyGView(next);
    });
  });
}

function applyGView(view) {
  const c2d = $('gMeterCanvas');
  const c3d = $('gMeter3dCanvas');
  const wrap = $('gViewToggle');
  if (!c2d || !c3d || !wrap) return;
  const is3d = (view === '3d') && _kart3dReady;
  c2d.classList.toggle('hidden', is3d);
  c3d.classList.toggle('hidden', !is3d);
  wrap.querySelectorAll('button').forEach((b) => {
    b.classList.toggle('active', b.getAttribute('data-view') === (is3d ? '3d' : '2d'));
  });
  if (window.RasiKart3D) {
    if (is3d) {
      _kart3dLastTick = 0;  // reset dispatch clock so first frame uses the 16ms fallback
      window.RasiKart3D.start();
    } else {
      window.RasiKart3D.stop();
    }
  }
}

function initKartModelUploader() {
  const wrap   = $('kartModelCard');
  const file   = $('kartModelFile');
  const name   = $('kartModelName');
  const resetB = $('kartModelResetBtn');
  const yawWrap = $('kartModelYawToggle');
  if (!wrap || !file || !name || !resetB || !yawWrap) return;

  // No Electron IPC bridge (e.g. WebApp / dev mode without preload):
  // hide the whole card and bail.
  if (!window.rasiKart) { wrap.classList.add('hidden'); return; }

  // Sync the heading toggle UI to the persisted setting.
  const persistedYaw = Number(state.settings.kartModelYaw) || 0;
  yawWrap.querySelectorAll('button').forEach((b) => {
    b.classList.toggle('active', Number(b.getAttribute('data-yaw')) === persistedYaw);
  });

  // Try to auto-load a previously uploaded model.
  window.rasiKart.loadKartModel().then((res) => {
    if (!res || !res.ok || !res.buffer) return;
    // If the 3D backend failed init (WebGL missing / not ready), keep the file
    // on disk so a future working start can pick it up. Do NOT call
    // loadCustomModel here — it would return {ok:false, error:'not-initialised'}
    // and the failure branch below would delete the user's valid file.
    if (!_kart3dReady || !window.RasiKart3D || !window.RasiKart3D.loadCustomModel) return;
    return window.RasiKart3D.loadCustomModel(res.buffer.buffer, persistedYaw).then((r) => {
      if (r && r.ok) {
        name.textContent = 'Eigenes Modell (geladen aus Speicher)';
      } else {
        // File on disk is unloadable -> clear it so we don't re-fail next start.
        window.rasiKart.clearKartModel().catch(() => {
          rcToast('Gespeichertes Modell konnte nicht gelöscht werden');
        });
      }
    });
  }).catch(() => { /* IPC not ready, leave primitive */ });

  // File-input change handler.
  file.addEventListener('change', async (e) => {
    const f = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!f) return;
    if (f.size > 10 * 1024 * 1024) { rcToast('Datei zu groß (max 10 MB)'); return; }
    let buf;
    try { buf = await f.arrayBuffer(); }
    catch (err) { rcToast('Datei konnte nicht gelesen werden'); return; }
    const u8 = new Uint8Array(buf);
    const saveRes = await window.rasiKart.saveKartModel(u8);
    if (!saveRes || !saveRes.ok) { rcToast('Speichern fehlgeschlagen: ' + (saveRes && saveRes.error || 'unknown')); return; }
    if (!_kart3dReady || !window.RasiKart3D || !window.RasiKart3D.loadCustomModel) {
      // File is on disk but 3D backend is unavailable (e.g. no WebGL). Reflect
      // that the upload succeeded so the user knows the next start will pick it up.
      name.textContent = f.name + ' (gespeichert — WebGL nicht verfügbar)';
      rcToast('Gespeichert — Modell wird beim nächsten Start geladen');
      return;
    }
    const loadRes = await window.RasiKart3D.loadCustomModel(buf, Number(state.settings.kartModelYaw) || 0);
    if (!loadRes || !loadRes.ok) {
      rcToast('Modell-Datei beschädigt — Standard bleibt aktiv');
      window.rasiKart.clearKartModel().catch(() => { /* best-effort cleanup */ });
      return;
    }
    name.textContent = f.name;
    rcToast('Eigenes Modell geladen');
  });

  // Heading-button handlers.
  yawWrap.querySelectorAll('button').forEach((btn) => {
    btn.addEventListener('click', () => {
      const next = Number(btn.getAttribute('data-yaw')) || 0;
      state.settings.kartModelYaw = next;
      saveData();
      yawWrap.querySelectorAll('button').forEach((b) => {
        b.classList.toggle('active', Number(b.getAttribute('data-yaw')) === next);
      });
      if (window.RasiKart3D && window.RasiKart3D.setHeadingOffset) {
        window.RasiKart3D.setHeadingOffset(next);
      }
    });
  });

  // Reset-button handler.
  resetB.addEventListener('click', async () => {
    const yes = await rcConfirm('Eigenes Modell auf Standard zurücksetzen?', 'Zurücksetzen', 'Zurücksetzen', true);
    if (!yes) return;
    await window.rasiKart.clearKartModel();
    if (window.RasiKart3D && window.RasiKart3D.resetToPrimitive) {
      window.RasiKart3D.resetToPrimitive();
    }
    state.settings.kartModelYaw = 0;
    saveData();
    name.textContent = 'Standard (Primitive)';
    yawWrap.querySelectorAll('button').forEach((b) => {
      b.classList.toggle('active', Number(b.getAttribute('data-yaw')) === 0);
    });
    rcToast('Auf Standard zurückgesetzt');
  });
}

// ============================================================
// 20. INIT
// ============================================================
function init() {
  loadData();
  try {
    if (typeof RasiTileRenderer !== 'undefined') {
      RasiTileRenderer.init({
        getSettings: function () { return state.settings.tiles || { enabled: false, urlTemplate: '', liveQuickToggle: true }; },
        redraw: function () { try { drawTrack(); } catch (e) {} },
      });
    }
  } catch (e) { console.warn('tile-renderer init:', e); }
  applyTheme();
  loadSettingsToUi();
  setupTabs();
  // Canvases
  initTrackCanvases();
  resizeCanvases();
  initLiveCharts();
  initLiveUiLoops();
  initGViewToggle();
  initKartModelUploader();
  // Display-Update an den Kart-ESP (Intervall in Settings konfigurierbar)
  restartDisplayUpdateInterval();
  window.addEventListener('resize', resizeCanvases);
  // Header buttons
  $('themeBtn').onclick = toggleTheme;
  $('pitwallBtn').onclick = openPitWall;
  // OLED-Seitenauswahl
  if ($('oledPageSelect')) {
    $('oledPageSelect').value = state.settings.oledPage || 'auto';
    $('oledPageSelect').onchange = (e) => {
      state.settings.oledPage = e.target.value;
      saveData();
      // Sofort an den Sender schicken (statt auf naechstes Intervall warten)
      sendDisplayUpdate();
    };
  }
  $('connectBtn').onclick = () => {
    if (state.serial.connected) disconnectSerial();
    else if (state.demo.running) stopDemo();
    else document.querySelector('[data-tab=connection]').click();
  };
  $('pwCloseBtn').onclick = closePitWall;
  $('openNewRaceBtn').onclick = () => $('newRaceModal').classList.add('show');
  $('cancelNewRaceBtn').onclick = () => $('newRaceModal').classList.remove('show');
  $('newRaceModal').onclick = (e) => { if (e.target.id === 'newRaceModal') $('newRaceModal').classList.remove('show'); };
  $('openNewDriverBtn').onclick = () => $('newDriverModal').classList.add('show');
  $('cancelNewDriverBtn').onclick = () => $('newDriverModal').classList.remove('show');
  $('newDriverModal').onclick = (e) => { if (e.target.id === 'newDriverModal') $('newDriverModal').classList.remove('show'); };
  // Live tab buttons
  $('startRaceBtn').onclick = toggleRaceRun;
  $('endRaceBtn').onclick = () => endRace(false);
  $('changeDriverBtn').onclick = openDriverChange;
  $('pitCallBtn').onclick = togglePitCall;
  $('heatmapBtn').onclick = () => {
    state.heatmap.on = !state.heatmap.on;
    $('heatmapBtn').classList.toggle('active', state.heatmap.on);
    drawTrack();
  };
  // Track tab buttons
  $('scanTrackBtn').onclick = () => state.track.scanning ? finishTrackScan(false) : startTrackScan();
  $('clearTrackBtn').onclick = clearTrack;
  $('saveTrackBtn').onclick = saveCurrentTrack;
  $('setSector2Btn').onclick = () => activateSectorClick(0);
  $('setSector3Btn').onclick = () => activateSectorClick(1);
  $('clearSectorsBtn').onclick = clearManualSectors;
  if (_trackCanvas) _trackCanvas.addEventListener('click', handleTrackCanvasClick);
  if (_scanCanvas) _scanCanvas.addEventListener('click', handleTrackCanvasClick);
  // Race tab
  $('createRaceBtn').onclick = createRace;
  // Drivers tab
  $('addDriverBtn').onclick = addDriver;
  // Connection tab
  $('modeSerialBtn').onclick = () => {
    $('modeSerialBtn').classList.add('active');
    $('modeDemoBtn').classList.remove('active');
    $('serialPanel').classList.remove('hidden');
    $('demoPanel').classList.add('hidden');
  };
  $('modeDemoBtn').onclick = () => {
    $('modeDemoBtn').classList.add('active');
    $('modeSerialBtn').classList.remove('active');
    $('demoPanel').classList.remove('hidden');
    $('serialPanel').classList.add('hidden');
  };
  if ($('diagToggleBtn')) $('diagToggleBtn').onclick = toggleDiagnose;
  $('serialRefreshBtn').onclick = listSerialPorts;
  $('serialConnectBtn').onclick = () => state.serial.connected ? disconnectSerial() : connectSerial();
  $('autoReconnectToggle').onchange = () => { state.serial.autoReconnect = $('autoReconnectToggle').checked; };
  if ($('recAutoArmToggle')) $('recAutoArmToggle').onchange = () => { state.settings.recordAutoArm = $('recAutoArmToggle').checked; saveData(); };
  if ($('setTilesUrl')) $('setTilesUrl').addEventListener('input', function () { updateTilesUrlHint(); applyTilesPresetFromUrl(); });
  if ($('setTilesPreset')) $('setTilesPreset').addEventListener('change', onTilesPresetChanged);
  if ($('setTilesEnabled')) $('setTilesEnabled').addEventListener('change', function () {
    if (!state.settings.tiles) state.settings.tiles = { enabled: true, urlTemplate: '', liveQuickToggle: true };
    state.settings.tiles.enabled = !!$('setTilesEnabled').checked;
    saveData();
    try { drawTrack(); } catch (e) {}
  });
  if ($('tilesClearBtn')) $('tilesClearBtn').onclick = onTilesClearClicked;
  if ($('liveTileToggle')) {
    const btn = $('liveTileToggle');
    function applyLiveTileToggleClass() {
      if (!state.settings.tiles) return;
      btn.classList.toggle('off', !state.settings.tiles.liveQuickToggle);
    }
    applyLiveTileToggleClass();
    btn.addEventListener('click', function () {
      if (!state.settings.tiles) state.settings.tiles = { enabled: true, urlTemplate: '', liveQuickToggle: true };
      state.settings.tiles.liveQuickToggle = !state.settings.tiles.liveQuickToggle;
      applyLiveTileToggleClass();
      saveData();
      try { drawTrack(); } catch (e) {}
    });
  }
  $('demoStartBtn').onclick = startDemo;
  $('demoStopBtn').onclick = stopDemo;
  // Settings tab
  if ($('zeroRollBtn')) $('zeroRollBtn').onclick = () => {
    // Aktuellen fusionierten Rollwinkel (inkl. bestehendem Offset) als neue 0 setzen.
    state.calibration.rollZero = state.calibration.rollZero + ((state.attitude && state.attitude.rollDeg) || 0);
    state.attitude.rollDeg = 0;
    state.attitude.overState = { active: false };
    state.attitude.over = false;
    saveData();
    rcToast('Rollwinkel genullt', 1500);
  };
  $('zeroImuBtn').onclick = () => {
    const btn = $('zeroImuBtn');
    if (btn.disabled) return;
    const original = btn.textContent;
    btn.disabled = true;
    // Sender-seitige Kalibrierung mitstarten (falls Bridge verbunden)
    try {
      if (window.rasiSerial && state.serial && state.serial.connected) {
        window.rasiSerial.writeLine(JSON.stringify({
          type: 'imu_calibrate', action: 'auto', duration_ms: 2000
        }));
      }
    } catch(e) { console.warn('imu_calibrate send:', e); }
    // Client-seitig: 2 Sekunden lang Samples mitteln
    const samples = [];
    const start = Date.now();
    const duration = 2000;
    const tick = setInterval(() => {
      const elapsed = Date.now() - start;
      samples.push({ x: state.raw.gx || 0, y: state.raw.gy || 0 });
      const remain = Math.max(0, duration - elapsed) / 1000;
      btn.textContent = `Kart still halten… ${remain.toFixed(1)}s`;
      if (elapsed >= duration) {
        clearInterval(tick);
        if (samples.length >= 5) {
          const avgX = samples.reduce((s,p) => s + p.x, 0) / samples.length;
          const avgY = samples.reduce((s,p) => s + p.y, 0) / samples.length;
          state.calibration.gxZero = avgX;
          state.calibration.gyZero = avgY;
          loadSettingsToUi();
          saveData();
          rcToast(`Nullpunkt gesetzt (${samples.length} Samples)`);
        } else {
          rcToast('Zu wenige Samples — kommen Telemetrie-Daten an?');
        }
        btn.textContent = original;
        btn.disabled = false;
      }
    }, 50);
  };
  $('resetImuBtn').onclick = () => {
    state.calibration.gxZero = 0;
    state.calibration.gyZero = 0;
    loadSettingsToUi();
    saveData();
    // Sender-Offsets ebenfalls zuruecksetzen
    try {
      if (window.rasiSerial && state.serial && state.serial.connected) {
        window.rasiSerial.writeLine(JSON.stringify({
          type: 'imu_calibrate', action: 'reset'
        }));
      }
    } catch(e) {}
    rcToast('IMU-Kalibrierung zurückgesetzt');
  };
  $('espSendBtn').onclick = async () => {
    const cfg = {
      type: 'config',
      max_rpm: Number($('espMaxRpm').value) || 6000,
      warn_rpm: Number($('espWarnRpm').value) || 5500,
      send_ms: Number($('espSendMs').value) || 80,
      pulses_per_rev: Number($('espPulses').value) || 1,
      wheel_circ_m: Number($('espWheelCirc').value) || 0,
      gear_ratio: Number($('espGearRatio').value) || 1,
      batt_cells: Number($('espBattCells').value) || 1
    };
    state.batt.cells = cfg.batt_cells;
    if (!state.serial.connected) {
      setText('espSendStatus', 'Nicht verbunden');
      return;
    }
    try {
      window.rasiSerial.writeLine(JSON.stringify(cfg));
      setText('espSendStatus', '✓ Gesendet');
    } catch (e) {
      setText('espSendStatus', '✗ Fehler');
    }
  };
  $('exportAllBtn').onclick = exportAll;
  $('importAllBtn').onclick = () => $('importAllFile').click();
  $('importAllFile').onchange = e => { if (e.target.files[0]) importAll(e.target.files[0]); e.target.value = ''; };
  $('resetAllBtn').onclick = resetAll;
  // Settings sub-navigation
  document.querySelectorAll('#tab-settings .settings-nav-item').forEach(btn => {
    btn.onclick = () => showSettingsGroup(btn.dataset.sgroup);
  });
  // Task 7 – Settings search filter
  const _settingsSearch = $('settingsSearch');
  if (_settingsSearch) {
    _settingsSearch.addEventListener('input', () => {
      const res = RasiSettings.settingsFilter(_settingsSearch.value, RasiSettings.SETTINGS_INDEX);
      const active = res.query !== '';

      // Nav: passende Gruppen markieren / Rest dimmen
      document.querySelectorAll('#tab-settings .settings-nav-item').forEach(b => {
        b.classList.toggle('search-hit', active && res.groups.has(b.dataset.sgroup));
        b.classList.toggle('search-dim', active && !res.groups.has(b.dataset.sgroup));
      });

      // Zeilen ein-/ausblenden (Zeilen ohne bekannte rowId bleiben immer sichtbar)
      document.querySelectorAll('#tab-settings .settings-row').forEach(row => {
        const ctrl = row.querySelector('[id]');
        const rowId = ctrl ? ctrl.id : null;
        const known = rowId && RasiSettings.SETTINGS_INDEX.some(e => e.rowId === rowId);
        row.classList.toggle('row-hidden', active && known && !res.rows.has(rowId));
        row.classList.toggle('row-hit', active && known && res.rows.has(rowId));
      });

      // Bei Treffer zur ersten passenden Gruppe springen
      if (active && res.groups.size > 0) {
        const first = RasiSettings.GROUPS.find(g => res.groups.has(g));
        if (first) showSettingsGroup(first);
      }
    });
  }
  // Task 8 – Auto-save on change/blur for data-autosave controls
  const _settingsTab = $('tab-settings');
  if (_settingsTab) {
    _settingsTab.addEventListener('change', (e) => {
      if (e.target && e.target.closest && e.target.closest('[data-autosave]')) scheduleSettingsSave();
    });
    // Zahlenfelder zusätzlich bei Blur sofort sichern
    _settingsTab.addEventListener('blur', (e) => {
      if (e.target && e.target.matches && e.target.matches('input[type=number][data-autosave]')) scheduleSettingsSave();
    }, true);
  }
  $('gateWidth').onchange = () => {
    state.startGate.width = Number($('gateWidth').value) || 14;
    setText('gateSizeText', state.startGate.width + 'm');
    drawTrack();
    saveDataDebounced();
  };
  // Initial render
  renderDrivers();
  renderDriverOptions();
  renderTrackOptions();
  renderSavedTracks();
  renderRaces();
  renderLapTable();
  updateRaceControls();
  updateSectorPanel();
  if (state.startGate.enabled) setText('gateSizeText', (state.startGate.width || 14) + 'm');
  // Auto-list ports
  listSerialPorts();
  // Start animation loop
  requestAnimationFrame(animLoop);
  // Statische Modal-Buttons CSP-konform verdrahten (kein inline onclick)
  const _bind = (elId, fn) => { const el = $(elId); if (el) el.addEventListener('click', fn); };
  _bind('edPickStart', () => editorClickTarget('start'));
  _bind('edPickS2',    () => editorClickTarget('s2'));
  _bind('edPickS3',    () => editorClickTarget('s3'));
  _bind('edCancelBtn', closeTrackEditor);
  _bind('edSaveBtn',   saveEditor);
  _bind('dmCancelBtn', closeDriverModal);
  _bind('dmConfirmBtn', confirmDriverChange);
  _bind('recSaveBtn', saveRecording);
  _bind('recCsvBtn', exportRecordingCsv);
  _bind('recLoadBtn', () => $('recLoadFile')?.click());
  const _rlf = $('recLoadFile');
  if (_rlf) _rlf.onchange = (e) => { if (e.target.files[0]) loadRecordingFile(e.target.files[0]); e.target.value = ''; };
  _bind('rpPlayBtn', toggleReplayPlay);
  _bind('rpExitBtn', exitReplay);
  const _rps = $('rpSeek');
  if (_rps) _rps.addEventListener('input', () => replaySeek((Number(_rps.value) || 0) / 1000));
  const _rsp = $('rpSpeed');
  if (_rsp) _rsp.addEventListener('change', () => setReplaySpeed(_rsp.value));
  updateRecStatus();
  // Dynamische Listen-Buttons per Event-Delegation (CSP-konform):
  // innerstes [data-action] gewinnt -> Klick auf einen Karten-Button
  // loest NUR dessen Aktion aus, nie zusaetzlich selectRace (ersetzt
  // das fruehere event.stopPropagation()).
  const ACTION_MAP = {
    loadSavedTrack:   id => loadSavedTrack(id),
    openTrackEditor:  id => openTrackEditor(id),
    deleteSavedTrack: id => deleteSavedTrack(id),
    deleteDriver:     id => deleteDriver(id),
    selectRace:       id => selectRace(id),
    setActiveRace:    id => setActiveRace(id),
    endRace:          () => endRace(false),
    toggleRaceExpand: id => toggleRaceExpand(id),
    deleteRace:       id => deleteRace(id),
  };
  const handleActionClick = (e) => {
    const el = e.target.closest('[data-action]');
    if (!el) return;
    const fn = ACTION_MAP[el.dataset.action];
    if (fn) fn(el.dataset.id);
  };
  ['savedTracksList', 'driverStatsList', 'raceList'].forEach((cid) => {
    const c = $(cid);
    if (c) c.addEventListener('click', handleActionClick);
  });
}
init();


// =============== UI GLUE für neues Sidebar-Layout ===============
(function(){
  function $$(id){return document.getElementById(id);}
  function txt(id,v){const e=$$(id);if(e&&e.textContent!==String(v))e.textContent=v;}

  // Spiegelt KPI/Pit-Wall-Daten ins neue Layout
  setInterval(()=>{
    try{
      // Pit-Wall (das Original updated nur wenn .show-Klasse, das ist OK)
      // Footer / Hz-Pill / Total km
      const hz = $$('connHz')?.textContent || '0';
      txt('hzText', hz);
      const tk = $$('totalDistance');
      if (tk) {
        // Einheit aus dem <small>-Element der Hero-Kachel mitnehmen,
        // sonst wechselt der Footer flickrig zwischen "750 km" (falsch)
        // und "750 m" (richtig), weil der Hero in m anzeigt < 1 km.
        const numMatch = (tk.textContent || '').match(/[\d.,]+/);
        const unit = tk.querySelector('small')?.textContent?.trim() || 'km';
        if (numMatch) txt('footerKm', numMatch[0] + ' ' + unit);
      }
      // Pit-Wall braucht zusätzliche Mappings (driver name)
      try {
        if (typeof activeRace === 'function') {
          const r = activeRace();
          if (r) {
            const stints = r.stints || [];
            const last = stints[stints.length-1];
            if (last && !last.endAt) {
              const driver = state.drivers.find(d=>d.id===last.driverId);
              txt('pwDriver', driver ? driver.name : '--');
              txt('currentDriverName', driver ? driver.name : '--');
            }
            const lapCount = stints.reduce((a,s)=>a + (s.laps?.length||0), 0);
            txt('pwLapCount', lapCount);
            txt('pwSession', $$('sessionText')?.textContent || '00:00');
            // Pit-Wall RPM/G/Status
            const t = state.telemetry;
            txt('pwRpm', Math.round(t.rpm).toLocaleString('de-DE'));
            const g = Math.sqrt(t.gx*t.gx + t.gy*t.gy).toFixed(1);
            txt('pwG', g);
            txt('pwSpeed', Math.round(t.speed));
            txt('pwSpeedMax', Math.round(state.max.speed));
            txt('pwLap', state.lapStart ? fmtMs(Date.now() - state.lapStart) : '--:--.---');
            txt('pwBestLap', state.bestLapMs ? fmtMs(state.bestLapMs) : '--:--.---');
            txt('pwStatus', r.status || '--');
            // Sektoren
            const lapSec = state.sectors?.lapSectors || [null,null,null];
            for(let i=0;i<3;i++) {
              const el = $$('pwS'+(i+1));
              if (el) el.textContent = lapSec[i] != null ? fmtMs(lapSec[i]) : '--';
            }
          }
        }
      } catch(e){}
      // Conn-overview Hz / Lost / GPS
      txt('connOverviewHz', ($$('connHz')?.textContent || '0') + ' Hz');
      txt('connOverviewLost', $$('connLost')?.textContent || '0');
      txt('connOverviewGps', $$('connGpsFix')?.textContent || '--');
      txt('connOverviewState', $$('topConnText')?.textContent || 'Offline');

      // Strecke-Tab Live-Stats
      if (state.track) {
        const pts = state.track.points?.length || 0;
        txt('trackPointsValue', pts);
        const len = state.track.totalDistance || 0;
        txt('trackLengthValue', len < 1000 ? Math.round(len) + ' m' : (len/1000).toFixed(2) + ' km');
        const sb = state.sectors?.boundaries || [];
        const sCount = sb.filter(b=>b).length;
        txt('trackSectorsValue', sCount === 0 ? '--' : (sCount + 1) + ' Sektoren');
        txt('trackClosedValue', state.track.closed ? 'geschlossen' : (state.track.scanning ? 'scannt …' : 'offen'));

        // Sektor-Status Pillen
        const s2 = sb[0], s3 = sb[1];
        const s2el = $$('sectorStatus2'), s3el = $$('sectorStatus3');
        if (s2el) {
          s2el.textContent = s2 ? '✓ gesetzt' : 'nicht gesetzt';
          s2el.style.color = s2 ? 'var(--blue)' : 'var(--mut)';
        }
        if (s3el) {
          s3el.textContent = s3 ? '✓ gesetzt' : 'nicht gesetzt';
          s3el.style.color = s3 ? 'var(--orange)' : 'var(--mut)';
        }
        // Gate
        const gw = state.startGate?.width;
        txt('gateBreiteDisplay', (gw || 14) + ' m');
        const gh = state.startGate?.heading;
        txt('gateHeadingDisplay', (gh != null && state.startGate?.enabled) ? Math.round(gh) + '°' : '--°');

        // Empty-State Overlay
        const emptyEl = $$('trackEmptyState');
        if (emptyEl) emptyEl.style.display = (pts > 0 || state.track.scanning) ? 'none' : 'flex';

        // Workflow-Stepper
        const step1 = $$('step1'), step2 = $$('step2'), step3 = $$('step3');
        if (step1 && step2 && step3) {
          step1.classList.remove('active','done');
          step2.classList.remove('active','done');
          step3.classList.remove('active','done');
          if (pts === 0 && !state.track.scanning) {
            step1.classList.add('active');
          } else if (state.track.scanning || (!state.track.closed && pts > 0)) {
            step1.classList.add('active');
          } else if (state.track.closed && sCount < 2) {
            step1.classList.add('done');
            step2.classList.add('active');
          } else {
            step1.classList.add('done');
            step2.classList.add('done');
            step3.classList.add('active');
          }
        }

        // GPS Bar Fill (statusGpsDot ist jetzt eine Bar, kein Dot)
        const gpsBar = $$('statusGpsDot');
        if (gpsBar) {
          const hasFix = state.gps?.lat != null;
          gpsBar.style.width = hasFix ? '100%' : '30%';
          gpsBar.style.background = hasFix ? 'var(--green)' : 'var(--orange)';
          gpsBar.style.boxShadow = '0 0 8px ' + (hasFix ? 'var(--green-glow)' : 'var(--orange-glow)');
        }
      }
    }catch(e){}
  }, 200);

  // Top-bar Title pro Tab
  document.addEventListener('DOMContentLoaded',()=>{
    const titles = {
      live:['Live Telemetrie','Echtzeit-Daten von Mäher & Bridge'],
      track:['Strecke','Aufnahme, Sektoren & gespeicherte Strecken'],
      races:['Rennen','Erstellen, starten und auswerten'],
      drivers:['Fahrer','Statistiken & Gesamtstrecke'],
      connection:['Verbindung','USB-Bridge, Demo-Modus & Diagnose'],
      settings:['Einstellungen','Skalen, Kalibrierung, ESP32 & Daten']
    };
    document.querySelectorAll('.nav-item[data-tab]').forEach(b=>{
      b.addEventListener('click',()=>{
        const t = b.dataset.tab;
        if(titles[t]){ txt('topTitle', titles[t][0]); txt('topSub', titles[t][1]); }
        $$('sidebar')?.classList.remove('open');
      });
    });
    // Theme-Toggle wird bereits in init() via $('themeBtn').onclick = toggleTheme
    // verdrahtet. KEIN zweiter Listener hier — sonst zaehlt ein Klick doppelt
    // und ueberspringt jedes zweite Theme.
    // Audio-Cues toggle
    const audioIconEl = $$('audioIcon');
    const updateAudioIcon = () => {
      if (audioIconEl) audioIconEl.textContent = rcAudio.isEnabled() ? '🔊' : '🔇';
    };
    updateAudioIcon();
    $$('audioBtn')?.addEventListener('click',()=>{
      rcAudio.setEnabled(!rcAudio.isEnabled());
      updateAudioIcon();
      if (rcAudio.isEnabled()) rcAudio.sectorBest();
    });
    // Mobile burger
    $$('openMobileBtn')?.addEventListener('click', ()=>$$('sidebar').classList.add('open'));
    $$('closeMobileBtn')?.addEventListener('click', ()=>$$('sidebar').classList.remove('open'));
    // pitwallBtn / pwCloseBtn / modeSerialBtn / modeDemoBtn sowie das Theme
    // werden bereits in init() verdrahtet: openPitWall/closePitWall verwalten
    // dort zusaetzlich den Escape-Listener, applyTheme() setzt data-theme.
    // Daher hier KEINE zweiten Listener — sonst feuern Klicks doppelt.
  });
})();

// Interface-Marker: Kern-Helfer/State, die nur noch von den ausgelagerten
// Modulen (Phase 22/23) genutzt werden -- verhindert no-unused-vars,
// dokumentiert das API.
void [armRecording, processTelemetry, _kart3dLastTick,
      css, dpr, esc, uid, setTextShared, setHtmlShared];
