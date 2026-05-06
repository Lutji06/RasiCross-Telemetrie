'use strict';
/* ============================================================
   RASICROSS TELEMETRY v9.6 — Clean Implementation
   Sections:
     1. Constants & State
     2. Utilities
     3. Persistence
     4. Custom Dialogs
     5. Tab navigation + Theme
     6. Settings
     7. Telemetry Pipeline
     8. Tacho/RPM/G-Meter
     9. Track Map (drawing)
    10. Track Scan
    11. Track Persistence (saved tracks)
    12. Track Editor
    13. Sectors
    14. Lap Detection
    15. Drivers
    16. Races
    17. Live UI
    18. Pit-Wall
    19. Serial / Demo
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
  settings: { maxSpeed: 80, maxRpm: 10000, rpmWarning: 9000, gScale: 3, minLapSeconds: 10, displayUpdateMs: 500, oledPage: 'auto' },
  calibration: { gxZero: 0, gyZero: 0, swapG: false, invertGx: false, invertGy: false },
  theme: 'dark',
  // Telemetry
  telemetry: { speed: 0, rpm: 0, gx: 0, gy: 0, lat: 0, lon: 0 },
  raw: { speed: 0, rpm: 0, gx: 0, gy: 0, lat: 0, lon: 0 },
  display: { speedLerp: 0, rpmLerp: 0, gxLerp: 0, gyLerp: 0 },
  gps: { fix: false, lastAt: null },
  max: { speed: 0, rpm: 0, g: 0 },
  charts: { speed: [], rpm: [], gx: [], gy: [] },
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
};

// ============================================================
// 2. UTILITIES
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
function setText(id, val) { const e = $(id); if (e) e.textContent = val; }

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

function gpsDist(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const mLat = ((lat1 + lat2) / 2) * Math.PI / 180;
  return Math.sqrt((R * dLon * Math.cos(mLat)) ** 2 + (R * dLat) ** 2);
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
function logTime(ts = Date.now()) { return new Date(ts).toLocaleTimeString('de-DE'); }

// ============================================================
// 3. PERSISTENCE
// ============================================================
let _saveTimer = null;
function saveData() {
  try {
    const payload = {
      version: '9.6', savedAt: new Date().toISOString(),
      settings: state.settings, calibration: state.calibration, theme: state.theme,
      drivers: state.drivers, races: state.races, savedTracks: state.savedTracks,
      activeRaceId: state.activeRaceId, selectedRaceId: state.selectedRaceId,
      activeTrackId: state.activeTrackId,
      track: state.track, startGate: state.startGate, sectors: { boundaries: state.sectors.boundaries, manual: state.sectors.manual, best: state.sectors.best }
    };
    localStorage.setItem(SAVE_KEY, JSON.stringify(payload));
    setText('storageState', 'Gespeichert ' + logTime());
  } catch (e) { console.warn('saveData:', e); setText('storageState', 'Fehler'); }
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
  document.querySelectorAll('.nav-item[data-tab]').forEach(btn => {
    btn.onclick = () => {
      document.querySelectorAll('.nav-item[data-tab]').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      btn.classList.add('active');
      const tab = btn.dataset.tab;
      const panel = $('tab-' + tab);
      if (panel) panel.classList.add('active');
      // Resize canvases when tab becomes visible
      setTimeout(resizeCanvases, 50);
      // Bei Driver-Tab: Stats neu berechnen (kann sich nach jedem Rennen aendern)
      if (tab === 'drivers') renderDrivers();
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
    setEnabled: (v) => { enabled = !!v; try { localStorage.setItem('rc_audio', v ? '1' : '0'); } catch(e){} },
    isEnabled:  () => enabled,
  };
})();

// ============================================================
// 6. SETTINGS
// ============================================================
function loadSettingsToUi() {
  $('setMaxSpeed').value = state.settings.maxSpeed;
  $('setMaxRpm').value = state.settings.maxRpm;
  $('setRpmWarn').value = state.settings.rpmWarning;
  $('setGScale').value = state.settings.gScale;
  $('setMinLap').value = state.settings.minLapSeconds;
  if ($('setDisplayUpdateMs')) $('setDisplayUpdateMs').value = state.settings.displayUpdateMs || 500;
  $('settingsHint').textContent = `${state.settings.maxSpeed} km/h · ${state.settings.maxRpm} rpm`;
  $('rpmScale').textContent = state.settings.maxRpm;
  $('gxOffsetText').textContent = state.calibration.gxZero.toFixed(2);
  $('gyOffsetText').textContent = state.calibration.gyZero.toFixed(2);
  if ($('setInvertGx')) $('setInvertGx').checked = !!state.calibration.invertGx;
  if ($('setInvertGy')) $('setInvertGy').checked = !!state.calibration.invertGy;
  if ($('setSwapG')) $('setSwapG').checked = !!state.calibration.swapG;
}
function saveSettingsFromUi() {
  state.settings.maxSpeed = Math.max(20, Math.min(200, Number($('setMaxSpeed').value) || 80));
  state.settings.maxRpm = Math.max(3000, Math.min(20000, Number($('setMaxRpm').value) || 10000));
  state.settings.rpmWarning = Math.max(2000, Math.min(state.settings.maxRpm, Number($('setRpmWarn').value) || 9000));
  state.settings.gScale = Math.max(2, Math.min(5, Number($('setGScale').value) || 3));
  state.settings.minLapSeconds = Math.max(3, Math.min(300, Number($('setMinLap').value) || 10));
  const newInterval = Math.max(100, Math.min(2000, Number($('setDisplayUpdateMs')?.value) || 500));
  if (newInterval !== state.settings.displayUpdateMs) {
    state.settings.displayUpdateMs = newInterval;
    restartDisplayUpdateInterval();
  }
  state.calibration.invertGx = !!$('setInvertGx')?.checked;
  state.calibration.invertGy = !!$('setInvertGy')?.checked;
  state.calibration.swapG = !!$('setSwapG')?.checked;
  loadSettingsToUi();
  saveData();
  rcToast('Einstellungen gespeichert');
}

// ============================================================
// 7. TELEMETRY PIPELINE
// ============================================================
function processTelemetry(d) {
  try {
    if (!d) return;
    if (d.type === 'bridge_status') {
      if (d.mac) state.connection.bridgeMac = d.mac;
      if (d.kart_mac) state.connection.kartMac = d.kart_mac;
      return;
    }
    state.connection.packets++;
    state.connection.lastPacketAt = Date.now();
    if (d.from_mac) state.connection.kartMac = d.from_mac;
    if (typeof d.rssi === 'number') state.connection.rssi = d.rssi;
    if (d.seq != null) {
      if (state.connection.seq != null) {
        const delta = (d.seq - state.connection.seq + 65536) % 65536;
        if (delta > 1 && delta < 1000) state.connection.lost += delta - 1;
      }
      state.connection.seq = d.seq;
    }
    state.hz++;
    // Calibrated values
    const speed = Math.max(0, Number(d.speed) || 0);
    const rpm = Math.max(0, Number(d.rpm) || 0);
    let gx = (Number(d.gx) || 0) - state.calibration.gxZero;
    let gy = (Number(d.gy) || 0) - state.calibration.gyZero;
    // Apply axis transformations
    if (state.calibration.swapG) { const tmp = gx; gx = gy; gy = tmp; }
    if (state.calibration.invertGx) gx = -gx;
    if (state.calibration.invertGy) gy = -gy;
    const lat = Number(d.lat);
    const lon = Number(d.lon);
    const hasGps = !!(d.gps_fix ?? d.fix ?? (lat && lon));
    state.gps.fix = hasGps;
    if (lat && lon) state.gps.lastAt = Date.now();
    state.raw = { speed, rpm, gx: Number(d.gx) || 0, gy: Number(d.gy) || 0, lat: lat || 0, lon: lon || 0 };
    state.telemetry = { speed, rpm, gx, gy, lat: lat || 0, lon: lon || 0 };
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
      const max = 600;
      while (state.charts.speed.length > max) state.charts.speed.shift();
      while (state.charts.rpm.length > max) state.charts.rpm.shift();
      while (state.charts.gx.length > max) state.charts.gx.shift();
      while (state.charts.gy.length > max) state.charts.gy.shift();
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

// ============================================================
// 8. TACHO / RPM / G-METER
// ============================================================
const LERP = 0.18;
function lerp(a, b) { return a + (b - a) * LERP; }
function renderGauges() {
  const t = state.telemetry;
  state.display.speedLerp = lerp(state.display.speedLerp, t.speed);
  state.display.rpmLerp = lerp(state.display.rpmLerp, t.rpm);
  state.display.gxLerp = lerp(state.display.gxLerp, t.gx);
  state.display.gyLerp = lerp(state.display.gyLerp, t.gy);
  // Tacho
  const speedRatio = Math.min(1, state.display.speedLerp / state.settings.maxSpeed);
  const arc = $('speedArc');
  if (arc) arc.setAttribute('stroke-dashoffset', String(314 - 314 * speedRatio));
  setText('speedDial', Math.round(state.display.speedLerp));
  // RPM bar
  const rpmRatio = Math.min(1, state.display.rpmLerp / state.settings.maxRpm);
  const fill = $('rpmFill');
  if (fill) fill.style.width = (rpmRatio * 100).toFixed(1) + '%';
  // G-Meter
  drawGMeter();
}
function drawGMeter() {
  const c = $('gMeterCanvas');
  if (!c) return;
  if (c.width !== c.offsetWidth * dpr()) {
    c.width = c.offsetWidth * dpr();
    c.height = c.offsetHeight * dpr();
  }
  const ctx = c.getContext('2d');
  const w = c.width, h = c.height, cx = w/2, cy = h/2, r = w * 0.46;
  const gs = state.settings.gScale;
  const gx = state.display.gxLerp, gy = state.display.gyLerp;
  ctx.clearRect(0, 0, w, h);
  // Background circle
  ctx.fillStyle = css('--soft');
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
  // G-zones
  [[1,'rgba(32,192,64,.15)'],[2,'rgba(255,149,0,.15)'],[gs,'rgba(224,48,48,.18)']].forEach(([maxG, col]) => {
    const zr = Math.min(r, r * maxG / gs);
    ctx.fillStyle = col;
    ctx.beginPath(); ctx.arc(cx, cy, zr, 0, Math.PI * 2); ctx.fill();
  });
  // Gridlines
  ctx.strokeStyle = css('--div'); ctx.lineWidth = 0.8;
  for (let g = 1; g < gs; g++) {
    const gr = r * g / gs;
    ctx.beginPath(); ctx.arc(cx, cy, gr, 0, Math.PI * 2); ctx.stroke();
  }
  ctx.beginPath(); ctx.moveTo(cx, cy - r); ctx.lineTo(cx, cy + r);
  ctx.moveTo(cx - r, cy); ctx.lineTo(cx + r, cy); ctx.stroke();
  // Border
  ctx.strokeStyle = css('--bor'); ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
  // Trail (last positions tracked here)
  if (!drawGMeter._trail) drawGMeter._trail = [];
  drawGMeter._trail.push({ x: gy, y: gx });
  if (drawGMeter._trail.length > 50) drawGMeter._trail.shift();
  drawGMeter._trail.forEach((pt, i) => {
    const alpha = (i / drawGMeter._trail.length) * 0.4;
    const px = cx + (pt.x / gs) * r, py = cy - (pt.y / gs) * r;
    const g = Math.sqrt(pt.x*pt.x + pt.y*pt.y);
    const col = g < 1 ? `rgba(32,192,64,${alpha})` : g < 2 ? `rgba(255,149,0,${alpha})` : `rgba(224,48,48,${alpha})`;
    ctx.fillStyle = col;
    ctx.beginPath(); ctx.arc(px, py, 3 * dpr(), 0, Math.PI * 2); ctx.fill();
  });
  // Current dot
  const px = cx + (gy / gs) * r, py = cy - (gx / gs) * r;
  const curG = Math.sqrt(gx*gx + gy*gy);
  const dotCol = curG < 1 ? css('--green') : curG < 2 ? css('--orange') : css('--red');
  ctx.fillStyle = dotCol;
  ctx.shadowColor = dotCol; ctx.shadowBlur = 12 * dpr();
  ctx.beginPath(); ctx.arc(px, py, 7 * dpr(), 0, Math.PI * 2); ctx.fill();
  ctx.shadowBlur = 0;
}

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
  const dLat = (b.maxLat - b.minLat) || 0.0001;
  const dLon = (b.maxLon - b.minLon) || 0.0001;
  const sc = Math.min((w - 2*pad) / dLon, (h - 2*pad) / dLat);
  const ox = (w - dLon * sc) / 2, oy = (h - dLat * sc) / 2;
  return { x: ox + (lon - b.minLon) * sc, y: h - oy - (lat - b.minLat) * sc };
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
  const pts = state.track.points;
  if (!pts || pts.length < 2) {
    ctx.fillStyle = css('--dim');
    ctx.font = `${13 * dpr()}px monospace`;
    ctx.textAlign = 'center';
    ctx.fillText(state.track.scanning ? 'Scan läuft – fahre die Runde ab' : 'Noch keine Strecke', w/2, h/2);
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
  // Start line
  const ep = lineEndpointsFromGate(state.startGate);
  if (ep) drawLineOn(ctx, c, ep, css('--green'), 'START', Date.now() < state.gateFlashUntil);
  // Sector boundaries
  state.sectors.boundaries.forEach((b, i) => {
    if (!b) return;
    const sep = lineEndpointsFromGate(b);
    if (sep) drawLineOn(ctx, c, sep, i === 0 ? css('--blue') : css('--orange'), 'S' + (i + 2), false);
  });
  // GPS dot
  const t = state.telemetry;
  if (t.lat && t.lon) {
    const xy = gpsXYOnCanvas(t.lat, t.lon, c);
    ctx.fillStyle = css('--blue');
    ctx.shadowColor = css('--blue');
    ctx.shadowBlur = 16 * dpr();
    ctx.beginPath();
    ctx.arc(xy.x, xy.y, 7 * dpr(), 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
  }
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
function onGpsUpdate(lat, lon) {
  if (!lat || !lon) return;
  if (!state.track.scanning) {
    updateBounds(lat, lon);
    return;
  }
  const last = state.track.points[state.track.points.length - 1];
  const dist = last ? gpsDist(last.lat, last.lon, lat, lon) : 999;
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
    totalDistance: state.track.totalDistance,
    maxDistFromStart: state.track.maxDistFromStart,
    closed: state.track.closed
  });
  $('trackSaveName').value = '';
  renderSavedTracks();
  renderTrackOptions();
  saveData();
  rcToast(`Strecke "${name}" gespeichert`);
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
      <button class="btn primary" onclick="window.loadSavedTrack('${t.id}')">Laden</button>
      <button class="btn ghost" onclick="window.openTrackEditor('${t.id}')">✎</button>
      <button class="btn danger" onclick="window.deleteSavedTrack('${t.id}')">✕</button>
    </div>
  `).join('');
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
}

// ============================================================
// 14. LAP DETECTION
// ============================================================
function checkLapCrossing(lat, lon) {
  try {
    if (!state.startGate.enabled) return;
    if (!state.autoLap.prevLat) return;
    const ep = lineEndpointsFromGate(state.startGate);
    if (!ep) return;
    const now = Date.now();
    // Cooldown: at least minLapSeconds
    if (state.lapStart && (now - state.lapStart) < state.settings.minLapSeconds * 1000) return;
    const A = { lat: state.autoLap.prevLat, lon: state.autoLap.prevLon };
    const B = { lat, lon };
    if (segmentsCross(A, B, ep.p1, ep.p2) && crossingDirectionOk(A.lat, A.lon, lat, lon, state.startGate.heading)) {
      triggerLap();
    }
  } catch (e) { console.warn('checkLapCrossing:', e); }
}
function triggerLap() {
  try {
    const r = activeRace();
    if (!r || r.status !== 'running') return;
    const now = Date.now();
    if (state.lapStart) {
      const lapMs = now - state.lapStart;
      if (lapMs < state.settings.minLapSeconds * 1000) return;
      const lap = {
        id: uid(),
        number: r.laps.length + 1,
        timeMs: lapMs,
        driverId: r.currentDriverId,
        maxSpeed: state.currentLapMax.speed,
        maxRpm: state.currentLapMax.rpm,
        distanceM: traceDistanceM(state.currentLapTrace),
        valid: true
      };
      r.laps.push(lap);
      // Update sector best for last sector
      const s = state.sectors;
      if (s.boundaries[0] && s.boundaries[1] && s.cur === 2 && s.sectorStart) {
        const s3Ms = now - s.sectorStart;
        s.lapSectors[2] = s3Ms;
        if (s.best[2] == null || s3Ms < s.best[2]) {
          s.best[2] = s3Ms;
          rcAudio.sectorBest();
        }
      }
      // Update best lap
      if (state.bestLapMs == null || lapMs < state.bestLapMs) {
        state.bestLapMs = lapMs;
        state.bestLapNum = lap.number;
        state.bestLapTrace = [...state.currentLapTrace];
        rcAudio.lapBest();
      }
      // Save sector times for display
      if (s.lapSectors.some(x => x)) {
        s.lastLapSectors = [...s.lapSectors];
        setTimeout(() => {
          if (s.lastLapSectors && !s.lapSectors.some(x => x)) {
            s.lastLapSectors = null;
            updateSectorPanel();
          }
        }, 7000);
      }
      // Flash gate
      state.gateFlashUntil = now + 1500;
      // Auto-end if lap-based race
      if (r.lengthType === 'laps' && r.laps.filter(l => l.valid).length >= r.targetLaps) {
        endRace(true);
      }
      saveDataDebounced();
    }
    // Start new lap
    state.lapStart = now;
    state.currentLapMax = { speed: 0, rpm: 0 };
    state.currentLapTrace = [];
    state.heatmap.lapMaxSpeed = 0;
    state.sectors.cur = 0;
    state.sectors.sectorStart = now;
    state.sectors.lapSectors = [null, null, null];
    updateSectorPanel();
    renderLapTable();
  } catch (e) { console.warn('triggerLap:', e); }
}
function renderLapTable() {
  const r = activeRace();
  const tbody = $('lapTable');
  if (!r || !r.laps.length) {
    tbody.innerHTML = '<tr><td colspan="6" class="muted">Noch keine Runden — starte ein Rennen und fahre die erste Runde.</td></tr>';
    setText('lapCountText', '0 Runden');
    return;
  }
  const valid = r.laps.filter(l => l.valid);
  const best = valid.length ? Math.min(...valid.map(l => l.timeMs)) : null;
  setText('lapCountText', `${valid.length} Runden`);
  tbody.innerHTML = [...r.laps].reverse().map(l => {
    const idx = l.number - 1;
    const prev = idx > 0 ? r.laps[idx - 1].timeMs : null;
    const delta = prev ? l.timeMs - prev : null;
    const d = state.drivers.find(x => x.id === l.driverId);
    return `<tr class="${!l.valid ? 'invalid' : (l.timeMs === best ? 'best' : '')}">
      <td>${l.number}</td>
      <td>${fmtMs(l.timeMs)}</td>
      <td style="color:${delta == null ? 'var(--mut)' : delta < 0 ? 'var(--green)' : 'var(--red)'}">${delta == null ? '--' : fmtDelta(delta)}</td>
      <td>${esc(d?.name || '--')}</td>
      <td>${l.maxSpeed.toFixed(1)}</td>
      <td>${Math.round(l.maxRpm)}</td>
    </tr>`;
  }).join('');
}

// ============================================================

// ============================================================
// DRIVER STATS
// ============================================================
function getDriverStats(driverId) {
  let totalDistanceM = 0;
  let totalTimeMs = 0;
  let maxSpeed = 0;
  let lapCount = 0;
  let bestLapMs = null;
  let raceCount = 0;
  let avgSpeedSum = 0;       // gewichteter Durchschnitt
  let avgSpeedDist = 0;      // Distanz fuer Gewichtung
  let totalRpmMax = 0;
  let firstSeenAt = null;
  let lastSeenAt = null;
  state.races.forEach(r => {
    let driverWasInRace = false;
    // Streckenlaenge bestimmen (Fallback fuer alte Runden ohne distanceM)
    const trk = r.trackId ? state.savedTracks.find(t => t.id === r.trackId) : null;
    const fallbackLapM = trk?.totalDistance || 0;
    // Laps pro Driver
    r.laps.forEach(l => {
      if (l.driverId !== driverId) return;
      if (!l.valid) return;
      driverWasInRace = true;
      lapCount++;
      totalTimeMs += l.timeMs;
      const lapM = (l.distanceM != null && l.distanceM > 0) ? l.distanceM : fallbackLapM;
      if (lapM > 0) {
        totalDistanceM += lapM;
        // Avg-Speed gewichtet nach Distanz
        const lapSpeed = lapM / (l.timeMs / 1000) * 3.6; // km/h
        avgSpeedSum += lapSpeed * lapM;
        avgSpeedDist += lapM;
      }
      if ((l.maxSpeed || 0) > maxSpeed) maxSpeed = l.maxSpeed;
      if ((l.maxRpm || 0) > totalRpmMax) totalRpmMax = l.maxRpm;
      if (bestLapMs == null || l.timeMs < bestLapMs) bestLapMs = l.timeMs;
    });
    // Stints des Fahrers
    (r.stints || []).forEach(st => {
      if (st.driverId === driverId) {
        const start = st.startAt;
        const end = st.endAt || Date.now();
        if (firstSeenAt == null || start < firstSeenAt) firstSeenAt = start;
        if (lastSeenAt == null || end > lastSeenAt) lastSeenAt = end;
      }
    });
    if (driverWasInRace) raceCount++;
  });
  const avgSpeed = avgSpeedDist > 0 ? avgSpeedSum / avgSpeedDist : 0;
  return {
    distanceM: totalDistanceM,
    distanceKm: totalDistanceM / 1000,
    timeMs: totalTimeMs,
    maxSpeed,
    avgSpeed,
    lapCount,
    bestLapMs,
    raceCount,
    totalRpmMax,
    firstSeenAt,
    lastSeenAt
  };
}

function getTotalStats() {
  // Gesamt-KM ueber alle Rennen aller Fahrer.
  // Pro Runde: bevorzugt die tatsaechlich gefahrene GPS-Distanz (lap.distanceM),
  // sonst Fallback auf die Streckenlaenge (rueckwaertskompatibel zu alten
  // gespeicherten Rennen, die noch kein distanceM-Feld kannten).
  let totalDistanceM = 0;
  let totalTimeMs = 0;
  let totalLaps = 0;
  let allTimeMaxSpeed = 0;
  let allTimeBestLap = null;
  state.races.forEach(r => {
    const trk = r.trackId ? state.savedTracks.find(t => t.id === r.trackId) : null;
    const fallbackLapM = trk?.totalDistance || 0;
    r.laps.forEach(l => {
      if (!l.valid) return;
      totalLaps++;
      totalTimeMs += l.timeMs;
      const lapM = (l.distanceM != null && l.distanceM > 0) ? l.distanceM : fallbackLapM;
      if (lapM > 0) totalDistanceM += lapM;
      if ((l.maxSpeed || 0) > allTimeMaxSpeed) allTimeMaxSpeed = l.maxSpeed;
      if (allTimeBestLap == null || l.timeMs < allTimeBestLap) allTimeBestLap = l.timeMs;
    });
  });
  return {
    distanceM: totalDistanceM,
    distanceKm: totalDistanceM / 1000,
    timeMs: totalTimeMs,
    lapCount: totalLaps,
    raceCount: state.races.length,
    driverCount: state.drivers.length,
    trackCount: state.savedTracks.length,
    allTimeMaxSpeed,
    allTimeBestLap
  };
}

function fmtKm(km) {
  if (km < 1) return (km * 1000).toFixed(0) + ' m';
  if (km < 100) return km.toFixed(2) + ' km';
  return km.toFixed(1) + ' km';
}


// 15. DRIVERS
// ============================================================
function addDriver() {
  const name = $('newDriverName').value.trim();
  const number = $('newDriverNumber').value.trim();
  const color = $('newDriverColor').value || '#e8ff00';
  if (!name) return rcAlert('Bitte Namen eingeben.');
  state.drivers.push({ id: uid(), name, number, color });
  $('newDriverName').value = '';
  $('newDriverNumber').value = '';
  renderDrivers();
  renderDriverOptions();
  saveData();
  rcToast(`Fahrer "${name}" hinzugefügt`);
}
async function deleteDriver(id) {
  const d = state.drivers.find(x => x.id === id);
  if (!d) return;
  if (!await rcConfirm(`Fahrer "${d.name}" löschen?`, 'Löschen', 'Löschen', true)) return;
  state.drivers = state.drivers.filter(x => x.id !== id);
  renderDrivers();
  renderDriverOptions();
  saveData();
}

function renderTotalHero() {
  const t = getTotalStats();
  const km = t.distanceKm;
  const totalEl = $('totalDistance');
  if (totalEl) {
    totalEl.innerHTML = (km < 1 ? (km * 1000).toFixed(0) : km < 100 ? km.toFixed(2) : km.toFixed(1)) +
      `<small>${km < 1 ? 'm' : 'km'}</small>`;
  }
  setText('totalTime', t.timeMs > 0 ? fmtClock(t.timeMs) : '--:--');
  setText('totalLaps', t.lapCount);
  setText('totalRaces', t.raceCount);
  setText('totalMaxSpeed', t.allTimeMaxSpeed > 0 ? t.allTimeMaxSpeed.toFixed(1) + ' km/h' : '--');
  setText('totalBestLap', t.allTimeBestLap ? fmtMs(t.allTimeBestLap) : '--');
  setText('totalTracks', t.trackCount);
}

function renderDrivers() {
  renderTotalHero();
  const list = $('driverStatsList');
  setText('driverCount', state.drivers.length);
  if (!state.drivers.length) {
    list.innerHTML = '<div class="muted">Noch keine Fahrer.</div>';
    return;
  }
  list.innerHTML = state.drivers.map(d => {
    const s = getDriverStats(d.id);
    const hasData = s.lapCount > 0;
    return `
    <div class="driver-stat-card" style="--driver:${esc(d.color)}">
      <div class="driver-stat-head">
        <div class="driver-num" style="--driver:${esc(d.color)}">${esc(d.number || '?')}</div>
        <div class="driver-stat-info">
          <div class="driver-stat-name">${esc(d.name)}</div>
          <div class="driver-stat-sub">${d.number ? '#' + esc(d.number) : 'ohne Nummer'} · ${s.raceCount} Rennen · ${s.lapCount} Runden</div>
        </div>
        <button class="btn danger" onclick="window.deleteDriver('${d.id}')" title="Fahrer löschen">✕</button>
      </div>
      ${hasData ? `
      <div class="driver-stat-grid">
        <div class="dstat highlight"><span>Distanz</span><b>${fmtKm(s.distanceKm)}</b></div>
        <div class="dstat"><span>Fahrzeit</span><b>${fmtClock(s.timeMs)}</b></div>
        <div class="dstat"><span>Max km/h</span><b>${s.maxSpeed.toFixed(1)}</b></div>
        <div class="dstat"><span>Ø km/h</span><b>${s.avgSpeed.toFixed(1)}</b></div>
        <div class="dstat"><span>Best Runde</span><b>${s.bestLapMs ? fmtMs(s.bestLapMs) : '--'}</b></div>
        <div class="dstat"><span>Max RPM</span><b>${Math.round(s.totalRpmMax).toLocaleString('de-DE')}</b></div>
      </div>` : `
      <div class="driver-stat-empty">Noch keine Renndaten — fahre eine Runde mit ${esc(d.name)}!</div>
      `}
    </div>
  `;
  }).join('');
}
function renderDriverOptions() {
  const sel1 = $('newRaceDriver');
  const sel2 = $('driverModalSelect');
  if (!state.drivers.length) {
    if (sel1) sel1.innerHTML = '<option value="">Bitte zuerst Fahrer anlegen</option>';
    if (sel2) sel2.innerHTML = '<option value="">Keine Fahrer</option>';
    return;
  }
  const opts = state.drivers.map(d => `<option value="${d.id}">${esc(d.name)} ${d.number ? '#' + esc(d.number) : ''}</option>`).join('');
  if (sel1) sel1.innerHTML = opts;
  if (sel2) sel2.innerHTML = opts;
}

// ============================================================
// 16. RACES
// ============================================================
function activeRace() { return state.races.find(r => r.id === state.activeRaceId); }
function selectedRace() { return state.races.find(r => r.id === state.selectedRaceId); }
function currentStint(r) { return r && r.stints && r.stints.length ? r.stints[r.stints.length - 1] : null; }
function raceValidLaps(r) { return r ? r.laps.filter(l => l.valid) : []; }
function raceElapsedMs(r) {
  if (!r || !r.startedAt) return 0;
  const end = r.endedAt || (r.status === 'paused' ? r.pausedAt : Date.now());
  return Math.max(0, (end - r.startedAt) - (r.totalPausedMs || 0));
}

function createRace() {
  const name = $('newRaceName').value.trim() || 'Rennen ' + (state.races.length + 1);
  const trackId = $('newRaceTrack').value;
  const driverId = $('newRaceDriver').value;
  const lengthType = $('newRaceLengthType').value;
  const duration = Math.max(1, Number($('newRaceDuration').value) || 30);
  const targetLaps = Math.max(1, Number($('newRaceLaps').value) || 20);
  if (!driverId) return rcAlert('Bitte einen Fahrer wählen.');
  const race = {
    id: uid(), name, trackId, lengthType,
    durationMs: duration * 60000,
    targetLaps,
    startDriverId: driverId, currentDriverId: driverId,
    status: 'created', createdAt: Date.now(),
    startedAt: null, endedAt: null, pausedAt: null, totalPausedMs: 0,
    laps: [], stints: [], speedTrace: []
  };
  state.races.unshift(race);
  // Nicht mehr automatisch aktivieren — User muss explizit "Aktivieren" klicken
  state.selectedRaceId = race.id;
  $('newRaceName').value = '';
  renderRaces();
  updateRaceControls();
  saveData();
  rcToast(`Rennen "${name}" erstellt — jetzt aktivieren um zu starten`);
}
function startRace() {
  try {
    const r = activeRace();
    if (!r) return rcAlert('Bitte ein Rennen aktivieren.');
    if (r.status === 'running') return;
    if (r.status === 'finished' || r.status === 'finished_auto') return rcAlert('Rennen ist beendet.');
    const now = Date.now();
    if (r.status === 'paused') {
      r.totalPausedMs = (r.totalPausedMs || 0) + (now - (r.pausedAt || now));
      r.pausedAt = null;
      r.status = 'running';
    } else {
      r.status = 'running';
      r.startedAt = now;
      r.endedAt = null;
      r.totalPausedMs = 0;
      r.stints = [{ id: uid(), driverId: r.currentDriverId, startAt: now, endAt: null }];
      r.laps = [];
      r.speedTrace = [];
    }
    state.lapStart = now;
    state.currentLapMax = { speed: 0, rpm: 0 };
    state.currentLapTrace = [];
    state.bestLapMs = null;
    state.bestLapNum = null;
    state.bestLapTrace = null;
    state.heatmap.lapMaxSpeed = 0;
    state.sectors.cur = 0;
    state.sectors.sectorStart = now;
    state.sectors.lapSectors = [null, null, null];
    state.sectors.lastLapSectors = null;
    state.autoLap.prevLat = null;
    state.autoLap.prevLon = null;
    renderRaces();
    updateRaceControls();
    updateSectorPanel();
    saveDataDebounced();
  } catch (e) { console.warn('startRace:', e); }
}
function endRace(auto = false) {
  try {
    const r = activeRace();
    if (!r) return;
    if (r.status !== 'running' && r.status !== 'paused') return;
    const now = Date.now();
    if (r.status === 'paused' && r.pausedAt) {
      r.totalPausedMs = (r.totalPausedMs || 0) + (now - r.pausedAt);
      r.pausedAt = null;
    }
    r.status = auto ? 'finished_auto' : 'finished';
    r.endedAt = now;
    const st = currentStint(r);
    if (st && !st.endAt) st.endAt = now;
    state.lapStart = null;
    state.currentLapMax = { speed: 0, rpm: 0 };
    state.sectors.cur = 0;
    state.sectors.sectorStart = null;
    state.sectors.lapSectors = [null, null, null];
    document.body.classList.add('flash');
    setTimeout(() => document.body.classList.remove('flash'), 2000);
    renderRaces();
    updateRaceControls();
    updateSectorPanel();
    saveData();
    rcToast(auto ? 'Rennen automatisch beendet' : 'Rennen beendet');
  } catch (e) {
    console.warn('endRace:', e);
    rcAlert('Fehler beim Beenden:\n' + (e?.message || e));
  }
}
function pauseRace() {
  const r = activeRace();
  if (!r || r.status !== 'running') return;
  r.status = 'paused';
  r.pausedAt = Date.now();
  renderRaces();
  updateRaceControls();
  saveDataDebounced();
}
function openDriverChange() {
  const r = activeRace();
  if (!r || r.status !== 'running') return;
  renderDriverOptions();
  // Pre-select non-current driver if possible
  const sel = $('driverModalSelect');
  const others = state.drivers.filter(d => d.id !== r.currentDriverId);
  if (others.length && sel) sel.value = others[0].id;
  $('driverModal').classList.add('show');
}
function confirmDriverChange() {
  const r = activeRace();
  if (!r) return;
  const newId = $('driverModalSelect').value;
  if (!newId || newId === r.currentDriverId) {
    $('driverModal').classList.remove('show');
    return;
  }
  const now = Date.now();
  const old = currentStint(r);
  if (old && !old.endAt) old.endAt = now;
  r.currentDriverId = newId;
  r.stints.push({ id: uid(), driverId: newId, startAt: now, endAt: null });
  $('driverModal').classList.remove('show');
  renderRaces();
  saveDataDebounced();
  rcToast('Fahrer gewechselt');
}
function closeDriverModal() { $('driverModal').classList.remove('show'); }

function selectRace(id) {
  state.selectedRaceId = id;
  renderRaces();
}
async function setActiveRace(id) {
  // Blockieren wenn aktuell ein Rennen läuft oder pausiert ist
  const cur = activeRace();
  if (cur && (cur.status === 'running' || cur.status === 'paused')) {
    if (cur.id === id) return;   // schon aktiv, kein Wechsel
    await rcAlert(
      `Das aktuelle Rennen "${cur.name}" läuft noch (Status: ${cur.status === 'running' ? 'läuft' : 'pausiert'}).\n\nBeende es zuerst, bevor du ein anderes Rennen aktivierst.`,
      'Rennen läuft'
    );
    return;
  }
  state.activeRaceId = id;
  state.selectedRaceId = id;
  const r = activeRace();
  if (r && r.trackId) loadSavedTrack(r.trackId);
  renderRaces();
  updateRaceControls();
  saveDataDebounced();
}


function toggleRaceExpand(id) {
  if (!state.expandedRaceIds) state.expandedRaceIds = {};
  state.expandedRaceIds[id] = !state.expandedRaceIds[id];
  renderRaces();
  // Wenn jetzt expanded, Chart zeichnen
  if (state.expandedRaceIds[id]) {
    setTimeout(() => drawRaceHistoryChart(id), 50);
  }
}
async function deleteRace(id) {
  const r = state.races.find(x => x.id === id);
  if (!r) return;
  if (!await rcConfirm(`Rennen "${r.name}" wirklich löschen?`, 'Löschen', 'Löschen', true)) return;
  state.races = state.races.filter(x => x.id !== id);
  if (state.activeRaceId === id) state.activeRaceId = null;
  if (state.selectedRaceId === id) state.selectedRaceId = state.races[0]?.id || null;
  if (state.expandedRaceIds) delete state.expandedRaceIds[id];
  renderRaces();
  updateRaceControls();
  saveData();
  rcToast('Rennen gelöscht');
}
function drawRaceHistoryChart(raceId) {
  const r = state.races.find(x => x.id === raceId);
  if (!r) return;
  const canvas = document.querySelector(`canvas[data-race-chart="${raceId}"]`);
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const speeds = (r.speedTrace || []).map(p => p.speed);
  const rpms = (r.speedTrace || []).map(p => p.rpm);
  const max = Math.max(state.settings.maxSpeed, ...speeds, 10);
  drawChart(ctx, canvas,
    [
      { data: speeds, color: css('--pr'), label: 'Speed', fill: true },
      { data: rpms.map(v => v / state.settings.maxRpm * max), raw: rpms, color: css('--red'), label: 'RPM', dash: true }
    ],
    0, max,
    { unit: 'km/h', right: 'rpm', maxRight: state.settings.maxRpm }
  );
}

function renderRaces() {
  const list = $('raceList');
  setText('raceListCount', state.races.length);
  if (!state.races.length) {
    list.innerHTML = '<div class="muted">Noch keine Rennen.</div>';
    return;
  }
  list.innerHTML = state.races.map(r => {
    const isActive = r.id === state.activeRaceId;
    const isSelected = r.id === state.selectedRaceId;
    const isExpanded = state.expandedRaceIds && state.expandedRaceIds[r.id];
    const cur = activeRace();
    const anotherRunning = cur && cur.id !== r.id && (cur.status === 'running' || cur.status === 'paused');
    const validLaps = raceValidLaps(r);
    const best = validLaps.length ? Math.min(...validLaps.map(l => l.timeMs)) : null;
    const avgLap = validLaps.length ? validLaps.reduce((s,l)=>s+l.timeMs,0)/validLaps.length : null;
    const totalSpeed = validLaps.length ? Math.max(...validLaps.map(l => l.maxSpeed||0)) : 0;
    const totalRpm = validLaps.length ? Math.max(...validLaps.map(l => l.maxRpm||0)) : 0;
    const elapsedMs = raceElapsedMs(r);
    const startDriver = state.drivers.find(d => d.id === r.startDriverId);
    return `
      <div class="race-card ${isSelected ? 'selected' : ''} ${isExpanded ? 'expanded' : ''}" onclick="window.selectRace('${r.id}')">
        <div class="race-card-top">
          <h3>${esc(r.name)}</h3>
          <span class="race-status ${r.status}">${({ created: 'Erstellt', running: 'Läuft', paused: 'Pausiert', finished: 'Beendet', finished_auto: 'Auto-End' }[r.status] || r.status)}</span>
        </div>
        <div class="race-meta">
          <div>Format: <b>${r.lengthType === 'time' ? Math.round(r.durationMs/60000) + ' min' : r.lengthType === 'laps' ? r.targetLaps + ' Runden' : 'Frei'}</b></div>
          <div>Runden: <b>${validLaps.length}</b></div>
          <div>Beste: <b>${best ? fmtMs(best) : '--'}</b></div>
          <div>Erstellt: <b>${new Date(r.createdAt).toLocaleDateString('de-DE')}</b></div>
        </div>
        <div class="race-card-actions">
          ${!isActive ? `<button class="btn primary" onclick="event.stopPropagation();window.setActiveRace('${r.id}')" ${anotherRunning ? 'disabled title="Anderes Rennen läuft noch"' : ''}>Aktivieren</button>` : ''}
          ${(r.status === 'running' || r.status === 'paused') && isActive ? `<button class="btn danger" onclick="event.stopPropagation();window.endRace(false)">Beenden</button>` : ''}
          <button class="btn ghost expand-btn" onclick="event.stopPropagation();window.toggleRaceExpand('${r.id}')">
            ${isExpanded ? '▲ Weniger' : '▼ Details'}
          </button>
          <button class="btn ghost" onclick="event.stopPropagation();window.deleteRace('${r.id}')" title="Rennen löschen">✕</button>
        </div>
        ${isExpanded ? renderRaceDetails(r, validLaps, best, avgLap, totalSpeed, totalRpm, elapsedMs, startDriver) : ''}
      </div>
    `;
  }).join('');
}

function renderRaceDetails(r, validLaps, best, avgLap, maxSpeed, maxRpm, elapsedMs, startDriver) {
  const stintsHtml = (r.stints || []).map((st, i) => {
    const d = state.drivers.find(x => x.id === st.driverId);
    const dur = (st.endAt || Date.now()) - st.startAt;
    return `<div class="stint-row">
      <span class="stint-num">#${i+1}</span>
      <span class="stint-name">${esc(d?.name || '--')}</span>
      <span class="stint-dur">${fmtClock(dur)}</span>
    </div>`;
  }).join('');

  const lapsHtml = r.laps.length
    ? r.laps.map(l => {
        const d = state.drivers.find(x => x.id === l.driverId);
        const isBest = best && l.timeMs === best;
        return `<tr class="${!l.valid ? 'invalid' : (isBest ? 'best' : '')}">
          <td>${l.number}</td>
          <td>${fmtMs(l.timeMs)}</td>
          <td>${esc(d?.name || '--')}</td>
          <td>${(l.maxSpeed||0).toFixed(1)}</td>
          <td>${Math.round(l.maxRpm||0)}</td>
        </tr>`;
      }).join('')
    : '<tr><td colspan="5" class="muted">Keine Runden</td></tr>';

  return `<div class="race-details">
    <div class="race-detail-stats">
      <div class="stat"><div class="t">Dauer</div><div class="n">${fmtClock(elapsedMs)}</div></div>
      <div class="stat"><div class="t">Bestzeit</div><div class="n" style="color:var(--green)">${best ? fmtMs(best) : '--'}</div></div>
      <div class="stat"><div class="t">Durchschnitt</div><div class="n">${avgLap ? fmtMs(avgLap) : '--'}</div></div>
      <div class="stat"><div class="t">Max km/h</div><div class="n">${maxSpeed.toFixed(1)}</div></div>
      <div class="stat"><div class="t">Max RPM</div><div class="n">${Math.round(maxRpm).toLocaleString('de-DE')}</div></div>
      <div class="stat"><div class="t">Stints</div><div class="n">${(r.stints || []).length}</div></div>
    </div>
    ${stintsHtml ? `<div class="race-detail-section">
      <h4>Stints</h4>
      <div class="stints-list">${stintsHtml}</div>
    </div>` : ''}
    <div class="race-detail-section">
      <h4>Runden (${r.laps.length})</h4>
      <div class="tbl-wrap" style="max-height:240px">
        <table>
          <thead><tr><th>#</th><th>Zeit</th><th>Fahrer</th><th>Max km/h</th><th>Max RPM</th></tr></thead>
          <tbody>${lapsHtml}</tbody>
        </table>
      </div>
    </div>
    <div class="race-detail-section">
      <h4>Speed-Verlauf</h4>
      <div style="position:relative;aspect-ratio:3;background:var(--soft);border:1px solid var(--bor);border-radius:var(--radius-md)">
        <canvas data-race-chart="${r.id}" style="width:100%;height:100%;display:block"></canvas>
      </div>
    </div>
  </div>`;
}
function renderTrackOptions() {
  const sel = $('newRaceTrack');
  if (!sel) return;
  if (!state.savedTracks.length) {
    sel.innerHTML = '<option value="">Keine Strecken gespeichert</option>';
    return;
  }
  sel.innerHTML = '<option value="">Keine</option>' +
    state.savedTracks.map(t => `<option value="${t.id}">${esc(t.name)}</option>`).join('');
}

function updateRaceControls() {
  const r = activeRace();
  const running = r && r.status === 'running';
  const paused = r && r.status === 'paused';
  const canStart = r && (r.status === 'created' || r.status === 'paused');
  const startBtn = $('startRaceBtn');
  const changeBtn = $('changeDriverBtn');
  const endBtn = $('endRaceBtn');
  if (startBtn) {
    startBtn.disabled = !canStart;
    startBtn.textContent = paused ? 'Fortsetzen' : 'Start';
  }
  if (changeBtn) changeBtn.disabled = !running;
  if (endBtn) endBtn.disabled = !(running || paused);
}

// ============================================================

// ============================================================
// LIVE CHARTS (Speed/RPM + G-Kraft)
// ============================================================
let _srCanvas, _srCtx, _gCanvas, _gCtx;
function initLiveCharts() {
  _srCanvas = $('srCanvas'); if (_srCanvas) _srCtx = _srCanvas.getContext('2d');
  _gCanvas = $('gCanvas'); if (_gCanvas) _gCtx = _gCanvas.getContext('2d');
}
function resizeChartCanvas(c) {
  if (!c) return;
  const w = c.offsetWidth, h = c.offsetHeight;
  if (w > 0 && h > 0) {
    const targetW = Math.floor(w * dpr()), targetH = Math.floor(h * dpr());
    if (c.width !== targetW || c.height !== targetH) { c.width = targetW; c.height = targetH; }
  }
}
function drawChart(ctx, c, series, min, max, opts = {}) {
  if (!ctx || !c) return;
  resizeChartCanvas(c);
  const w = c.width, h = c.height;
  if (!w || !h) return;
  const D = dpr();
  const pL = 50 * D, pR = (opts.right ? 50 : 16) * D, pT = 16 * D, pB = 28 * D;
  const iW = w - pL - pR, iH = h - pT - pB;
  const range = (max - min) || 1;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = css('--soft');
  ctx.fillRect(0, 0, w, h);
  // Grid lines
  ctx.font = `${10 * D}px ` + css('--mono');
  ctx.fillStyle = css('--mut');
  ctx.strokeStyle = css('--div');
  ctx.lineWidth = D;
  for (let i = 0; i <= 4; i++) {
    const y = pT + iH * i / 4;
    const val = max - range * i / 4;
    ctx.beginPath(); ctx.moveTo(pL, y); ctx.lineTo(w - pR, y); ctx.stroke();
    ctx.textAlign = 'right';
    ctx.fillText(axisFmt(val, opts.unit), pL - 8 * D, y + 4 * D);
    if (opts.right) {
      ctx.textAlign = 'left';
      ctx.fillText(axisFmt(val / max * (opts.maxRight || max), 'rpm'), w - pR + 8 * D, y + 4 * D);
    }
  }
  if (opts.zero) {
    const y = pT + iH - (0 - min) / range * iH;
    ctx.strokeStyle = css('--bor2');
    ctx.lineWidth = 1.5 * D;
    ctx.setLineDash([4 * D, 3 * D]);
    ctx.beginPath(); ctx.moveTo(pL, y); ctx.lineTo(w - pR, y); ctx.stroke();
    ctx.setLineDash([]);
  }
  // Empty state
  if (!series.some(s => (s.data || []).length > 1)) {
    ctx.textAlign = 'center';
    ctx.fillStyle = css('--dim');
    ctx.font = `800 ${12 * D}px ` + css('--mono');
    ctx.fillText('Warte auf Telemetrie-Daten…', w / 2, h / 2);
    return;
  }
  const X = (i, n) => pL + iW * i / Math.max(1, n - 1);
  const Y = v => Math.max(pT, Math.min(pT + iH, pT + iH - (v - min) / range * iH));
  // Draw each series
  series.forEach((s, si) => {
    const d = s.data || [];
    if (d.length < 2) return;
    ctx.save();
    if (s.fill) {
      ctx.beginPath();
      d.forEach((v, i) => i ? ctx.lineTo(X(i, d.length), Y(v)) : ctx.moveTo(X(i, d.length), Y(v)));
      ctx.lineTo(X(d.length - 1, d.length), pT + iH);
      ctx.lineTo(X(0, d.length), pT + iH);
      ctx.closePath();
      const g = ctx.createLinearGradient(0, pT, 0, pT + iH);
      g.addColorStop(0, 'rgba(220,255,0,.22)');
      g.addColorStop(1, 'rgba(220,255,0,0)');
      ctx.fillStyle = g;
      ctx.fill();
    }
    ctx.beginPath();
    d.forEach((v, i) => i ? ctx.lineTo(X(i, d.length), Y(v)) : ctx.moveTo(X(i, d.length), Y(v)));
    ctx.strokeStyle = s.color;
    ctx.lineWidth = (si ? 1.8 : 2.4) * D;
    if (s.dash) ctx.setLineDash([6 * D, 4 * D]);
    ctx.shadowColor = s.color;
    ctx.shadowBlur = si ? 3 * D : 8 * D;
    ctx.stroke();
    ctx.restore();
  });
}
function axisFmt(v, u) {
  if (u === 'rpm') return Math.round(v).toLocaleString('de-DE');
  if (u === 'G') return (Math.round(v * 10) / 10).toFixed(1);
  return Math.round(v).toString();
}
function drawLiveCharts() {
  try {
    if (!_srCtx || !_gCtx) return;
    drawChart(_srCtx, _srCanvas,
      [
        { data: state.charts.speed, color: css('--pr'), label: 'Speed', fill: true },
        { data: state.charts.rpm.map(v => v / state.settings.maxRpm * state.settings.maxSpeed), raw: state.charts.rpm, color: css('--red'), label: 'RPM', dash: true }
      ],
      0, state.settings.maxSpeed,
      { unit: 'km/h', right: 'rpm', maxRight: state.settings.maxRpm }
    );
    drawChart(_gCtx, _gCanvas,
      [
        { data: state.charts.gx, color: css('--blue'), label: 'Gx' },
        { data: state.charts.gy, color: css('--green'), label: 'Gy' }
      ],
      -state.settings.gScale, state.settings.gScale,
      { unit: 'G', zero: true }
    );
  } catch (e) { console.warn('drawLiveCharts:', e); }
}

// 17. LIVE UI
// ============================================================
let _lastDeltaUpdate = 0;
function updateLiveDelta() {
  if (Date.now() - _lastDeltaUpdate < 500) return;
  _lastDeltaUpdate = Date.now();
  const banner = $('deltaBanner');
  if (!state.lapStart || !state.bestLapTrace || state.bestLapTrace.length < 5 || !state.currentLapTrace.length) {
    state.liveDelta = null;
    if (banner) banner.classList.add('hidden');
    return;
  }
  // Find time on best lap at same GPS position
  const cur = state.currentLapTrace[state.currentLapTrace.length - 1];
  if (!cur || !cur.lat || !cur.lon) return;
  let bestT = null, minD = Infinity;
  for (const p of state.bestLapTrace) {
    const d = (p.lat - cur.lat) ** 2 + (p.lon - cur.lon) ** 2;
    if (d < minD) { minD = d; bestT = p.t; }
  }
  if (bestT == null) return;
  const delta = cur.t - bestT;
  state.liveDelta = delta;
  if (banner) banner.classList.remove('hidden');
  const tEl = $('deltaTime');
  if (tEl) {
    tEl.textContent = (delta >= 0 ? '+' : '') + (delta / 1000).toFixed(3) + 's';
    tEl.className = 'delta-time ' + (Math.abs(delta) < 50 ? 'same' : delta < 0 ? 'faster' : 'slower');
  }
  setText('deltaRef', `vs. Runde ${state.bestLapNum} (${fmtMs(state.bestLapMs)})`);
}
// KPI-Anzeige mit eigenem Smoothing (langsamer als Tacho-Animation).
// Throttle: aktualisiert nur alle 100ms (10 Hz), bleibt aber smooth genug.
const KPI_SMOOTH = 0.08;     // niedriger = traeger / besser lesbar
const KPI_UPDATE_MS = 100;   // 10 Updates pro Sekunde
const _kpiDisplay = { speed: 0, rpm: 0, gx: 0, gy: 0 };
let _lastKpiUpdate = 0;
let _lastKpiText = { speed: '', rpm: '', g: '', lap: '', count: '' };

function updateLiveKPIs() {
  const now = Date.now();
  if (now - _lastKpiUpdate < KPI_UPDATE_MS) return;
  _lastKpiUpdate = now;
  try {
    const t = state.telemetry;
    // Eigenes, langsameres Smoothing für Anzeige-Werte
    _kpiDisplay.speed += (t.speed - _kpiDisplay.speed) * KPI_SMOOTH;
    _kpiDisplay.rpm   += (t.rpm   - _kpiDisplay.rpm)   * KPI_SMOOTH;
    _kpiDisplay.gx    += (t.gx    - _kpiDisplay.gx)    * KPI_SMOOTH;
    _kpiDisplay.gy    += (t.gy    - _kpiDisplay.gy)    * KPI_SMOOTH;
    const g = Math.sqrt(_kpiDisplay.gx * _kpiDisplay.gx + _kpiDisplay.gy * _kpiDisplay.gy);
    // Texte vorbereiten (gerundet) und nur setzen wenn sich was geaendert hat
    const speedText = _kpiDisplay.speed.toFixed(0);
    if (speedText !== _lastKpiText.speed) {
      $('kSpeed').innerHTML = `${speedText}<small>km/h</small>`;
      _lastKpiText.speed = speedText;
    }
    // RPM in 50er-Schritten runden damit es nicht so wackelt
    const rpmRounded = Math.round(_kpiDisplay.rpm / 50) * 50;
    const rpmText = rpmRounded.toLocaleString('de-DE');
    if (rpmText !== _lastKpiText.rpm) {
      setText('kRpm', rpmText);
      _lastKpiText.rpm = rpmText;
    }
    // G-Kraft auf eine Nachkommastelle (statt zwei) — weniger flackern
    const gText = g.toFixed(1);
    if (gText !== _lastKpiText.g) {
      $('kG').innerHTML = `${gText}<small>G</small>`;
      _lastKpiText.g = gText;
    }
    // Max-Werte: aktualisieren sich seltener (bei jedem Update OK)
    setText('kSpeedMax', state.max.speed.toFixed(0));
    setText('kRpmMax', Math.round(state.max.rpm / 50) * 50);
    setText('kGMax', state.max.g.toFixed(1));
    // Rundenzeit: nur alle 100ms aktualisieren ist ok
    const lapText = state.lapStart ? fmtMs(Date.now() - state.lapStart) : '--:--.---';
    if (lapText !== _lastKpiText.lap) {
      setText('kLap', lapText);
      _lastKpiText.lap = lapText;
    }
    setText('kLapBest', state.bestLapMs ? fmtMs(state.bestLapMs) : '--:--.---');
    setText('gxText', _kpiDisplay.gx.toFixed(1));
    setText('gyText', _kpiDisplay.gy.toFixed(1));
    // Race-Countdown
    const r = activeRace();
    if (r && (r.status === 'running' || r.status === 'paused')) {
      const elapsed = raceElapsedMs(r);
      if (r.lengthType === 'time') {
        const rem = Math.max(0, r.durationMs - elapsed);
        const cdText = fmtClock(rem);
        if (cdText !== _lastKpiText.count) {
          setText('countdown', cdText);
          _lastKpiText.count = cdText;
        }
      } else if (r.lengthType === 'free') {
        const cdText = fmtClock(elapsed);
        if (cdText !== _lastKpiText.count) {
          setText('countdown', cdText);
          _lastKpiText.count = cdText;
        }
      }
    }
  } catch (e) { /* stumm — animLoop soll nie crashen */ }
}

function updateLiveUi() {
  try {
    const t = state.telemetry;
    setText('gpsStatus', state.gps.fix ? 'OK' : '--');
    setText('latText', t.lat ? t.lat.toFixed(6) : '--');
    setText('lonText', t.lon ? t.lon.toFixed(6) : '--');
    setText('trackPoints', state.track.points.length);
    document.body.classList.toggle('rpm-warn', t.rpm >= state.settings.rpmWarning);
    const gpsAge = state.gps.lastAt ? Date.now() - state.gps.lastAt : null;
    document.body.classList.toggle('gps-warn', !!(gpsAge && gpsAge > 3000));
    // Race-Status (Countdown läuft im 60fps-Loop, hier nur Meta)
    const r = activeRace();
    if (r && (r.status === 'running' || r.status === 'paused')) {
      const elapsed = raceElapsedMs(r);
      if (r.lengthType === 'time') {
        const rem = Math.max(0, r.durationMs - elapsed);
        if (r.status === 'running' && rem <= 0) endRace(true);
      } else if (r.lengthType === 'laps') {
        const left = Math.max(0, r.targetLaps - raceValidLaps(r).length);
        setText('countdown', `${left} LAPS`);
      }
      const drv = state.drivers.find(d => d.id === r.currentDriverId);
      setText('raceMeta', `${r.name} · ${drv ? drv.name : 'Kein Fahrer'} · Runde ${raceValidLaps(r).length + 1}`);
      setText('currentDriverName', drv ? drv.name : '--');
    } else if (r) {
      setText('countdown', r.lengthType === 'time' ? fmtClock(r.durationMs) : r.lengthType === 'laps' ? `${r.targetLaps} LAPS` : '∞');
      setText('raceMeta', `${r.name} · ${r.status === 'created' ? 'Bereit' : r.status}`);
    } else {
      setText('countdown', '--:--');
      setText('raceMeta', 'Erstelle im Tab Rennen ein Rennen.');
      setText('currentDriverName', '--');
    }
    // Stints
    renderStints(r);
    // Status badge
    setText('hzText', state.hz);
    setText('packetsText', state.connection.packets);
    // Live delta
    updateLiveDelta();
    // Pit-wall
    updatePitWall();
  } catch (e) { console.warn('updateLiveUi:', e); }
}
function renderStints(r) {
  const list = $('stintsList');
  if (!list) return;
  if (!r || !r.stints || !r.stints.length) {
    list.innerHTML = '<div class="muted">Noch kein Stint.</div>';
    return;
  }
  list.innerHTML = r.stints.map((st, i) => {
    const d = state.drivers.find(x => x.id === st.driverId);
    const dur = (st.endAt || Date.now()) - st.startAt;
    const stintLaps = r.laps.filter(l => l.driverId === st.driverId &&
      (i === 0 || l.number > r.stints.slice(0, i).reduce((sum, s) => sum + r.laps.filter(ll => ll.driverId === s.driverId).length, 0))).length;
    return `<div style="padding:10px;background:var(--soft);border-radius:10px;margin-bottom:6px">
      <div style="font-family:var(--mono);font-size:13px;color:var(--tx)">${esc(d?.name || '--')}</div>
      <div style="font-family:var(--mono);font-size:11px;color:var(--mut);margin-top:4px">
        Stint ${i+1} · ${fmtClock(dur)} · ${stintLaps} Runden ${st.endAt ? '' : '(läuft)'}
      </div>
    </div>`;
  }).join('');
}

// Animation loop
function animLoop() {
  renderGauges();
  drawTrack();
  drawLiveCharts();
  updateLiveKPIs();   // KPI-Karten jetzt im 60fps-Loop für flüssige Updates
  requestAnimationFrame(animLoop);
}
// Backup tick (top-level, läuft auch wenn rAF im Hintergrund-Iframe pausiert)
setInterval(() => {
  try { renderGauges(); drawTrack(); drawLiveCharts(); updateLiveKPIs(); } catch(e){}
}, 200);

// 1Hz UI loop
setInterval(() => {
  // Snapshot der Hz BEVOR wir resetten
  state._lastHz = state.hz;
  state.hz = 0;

  setText('sessionText', fmtClock(Date.now() - state.sessionStart));
  updateLiveUi();

  // Status-Badge oben rechts
  if (state.connection.source === 'serial' && state.serial.connected) {
    (()=>{const e=$('topConnPill');if(e){e.className='pill green'};const e2=$('sideConnCard');if(e2){e2.className='conn-card connected'}})();
    setText('topConnText', 'Verbunden'); setText('sideConnText', 'Verbunden');
  } else if (state.connection.source === 'demo') {
    (()=>{const e=$('topConnPill');if(e){e.className='pill blue'};const e2=$('sideConnCard');if(e2){e2.className='conn-card demo'}})();
    setText('topConnText', 'Demo'); setText('sideConnText', 'Demo');
  } else {
    (()=>{const e=$('topConnPill');if(e){e.className='pill'};const e2=$('sideConnCard');if(e2){e2.className='conn-card'}})();
    setText('topConnText', 'Offline'); setText('sideConnText', 'Offline');
  }

  // Connection-Tab (das hat vorher gefehlt!)
  renderConnectionTab();

  // Reconnect-Status
  if (state.serial.reconnectTimer) {
    setText('reconnectStatus', `Reconnect-Versuch ${state.serial.reconnectAttempts}...`);
  } else {
    setText('reconnectStatus', state.serial.connected ? '--' : 'Inaktiv');
  }

  // Footer-KM live aktualisieren
  try {
    const t = getTotalStats();
    setText('footerKm', t.distanceKm < 1
      ? (t.distanceKm * 1000).toFixed(0) + ' m'
      : t.distanceKm.toFixed(2) + ' km');
  } catch (e) {}
}, 1000);

// ============================================================
// 18. PIT-WALL
// ============================================================
function openPitWall() {
  $('pitwallOverlay').classList.add('show');
  document.addEventListener('keydown', pwKeyHandler);
}
function closePitWall() {
  $('pitwallOverlay').classList.remove('show');
  document.removeEventListener('keydown', pwKeyHandler);
}
function pwKeyHandler(e) { if (e.key === 'Escape' || e.key === 'F11') closePitWall(); }
function updatePitWall() {
  const ov = $('pitwallOverlay');
  if (!ov || !ov.classList.contains('show')) return;
  const t = state.telemetry;
  // Top info
  setText('pwSession', fmtClock(Date.now() - state.sessionStart));
  const r = activeRace();
  setText('pwLapCount', r ? raceValidLaps(r).length : 0);
  // Speed
  setText('pwSpeed', Math.round(t.speed));
  setText('pwSpeedMax', Math.round(state.max.speed));
  // Delta
  const dEl = $('pwDelta');
  if (dEl) {
    if (state.liveDelta != null) {
      dEl.textContent = (state.liveDelta >= 0 ? '+' : '') + (state.liveDelta / 1000).toFixed(3);
      dEl.className = 'pw-delta-val ' + (Math.abs(state.liveDelta) < 50 ? 'same' : state.liveDelta < 0 ? 'faster' : 'slower');
    } else {
      dEl.textContent = '+0.000';
      dEl.className = 'pw-delta-val same';
    }
  }
  setText('pwDeltaRef', state.bestLapMs ? `vs. Runde ${state.bestLapNum} (${fmtMs(state.bestLapMs)})` : 'vs. beste Runde');
  // Lap
  setText('pwLap', state.lapStart ? fmtMs(Date.now() - state.lapStart) : '--:--.---');
  setText('pwBestLap', state.bestLapMs ? fmtMs(state.bestLapMs) : '--:--.---');
  // Sectors
  const s = state.sectors;
  for (let i = 0; i < 3; i++) {
    let t2 = s.lapSectors[i];
    if (!t2 && s.lastLapSectors) t2 = s.lastLapSectors[i];
    const best = s.best[i];
    const el = $('pwS' + (i + 1));
    if (el) {
      el.textContent = t2 ? fmtMs(t2) : '--';
      el.className = 'pw-sector-time' + (t2 && best ? (t2 <= best ? ' best' : ' slower') : '');
    }
  }
  // Footer
  const drv = r ? state.drivers.find(d => d.id === r.currentDriverId) : null;
  setText('pwDriver', drv ? drv.name : '--');
  setText('pwRpm', Math.round(t.rpm).toLocaleString('de-DE'));
  const g = Math.sqrt(t.gx * t.gx + t.gy * t.gy);
  setText('pwG', g.toFixed(1));
  setText('pwStatus', state.connection.source === 'serial' ? 'USB' : state.connection.source === 'demo' ? 'DEMO' : 'OFF');
}

// ============================================================

// ============================================================

// ============================================================
// CONNECTION TAB Updates
// ============================================================
let _packetLog = [];
function renderConnectionTab() {
  try {
    const c = state.connection;
    // Pills oben
    setText('connModePill', c.source === 'serial' ? 'USB Serial' : c.source === 'demo' ? 'Demo' : 'Offline');
    setText('connBridgeState', state.serial.connected ? 'Online' : 'Offline');
    setText('connPacketsMini', c.packets.toLocaleString('de-DE'));
    // Overview
    setText('connOverviewState', c.source === 'serial' ? 'Verbunden' : c.source === 'demo' ? 'Demo' : 'Offline');
    setText('connOverviewHz', (state._lastHz || 0) + ' Hz');
    setText('connOverviewLost', c.lost);
    setText('connOverviewGps', state.gps.fix ? 'Fix' : '--');
    setText('connOverviewSignal', c.rssi != null ? c.rssi + ' dBm' : '--');
    // Diagram
    setText('kartStatePill', c.lastPacketAt ? (Date.now() - c.lastPacketAt < 2000 ? 'aktiv' : 'inaktiv') : 'wartet');
    setText('kartMainValue', state.telemetry.speed.toFixed(0) + ' km/h');
    setText('pitStatePill', state.serial.connected ? 'online' : c.source === 'demo' ? 'demo' : 'offline');
    setText('pitMainValue', state.serial.connected ? 'USB' : c.source === 'demo' ? 'DEMO' : 'OFF');
    setText('connSeq', c.seq != null ? c.seq : '--');
    setText('connAge', c.lastPacketAt ? ((Date.now() - c.lastPacketAt) / 1000).toFixed(1) + 's' : '--');
    setText('connSpeed', state.telemetry.speed.toFixed(0));
    setText('connRpm', Math.round(state.telemetry.rpm));
    setText('connUsbState', state.serial.connected ? 'ON' : 'OFF');
    setText('connHz', state._lastHz || 0);
    setText('connRssi', c.rssi != null ? c.rssi + ' dBm' : '--');
    setText('connLost', c.lost);
    setText('connBridgeMac', c.bridgeMac || '--');
    setText('connRasiMac', c.kartMac || '--');
    setText('connGpsFix', state.gps.fix ? 'Fix' : 'kein Fix');
    setText('connGpsAge', state.gps.lastAt ? ((Date.now() - state.gps.lastAt) / 1000).toFixed(1) + 's' : '--');
    // Signal-Bars
    const bars = document.querySelectorAll('#signalBars i');
    if (bars.length === 4 && c.rssi != null) {
      const r = c.rssi;
      let lvl = r > -55 ? 4 : r > -70 ? 3 : r > -85 ? 2 : r > -95 ? 1 : 0;
      bars.forEach((b, i) => {
        b.classList.remove('on', 'warn');
        if (i < lvl) b.classList.add(lvl <= 2 ? 'warn' : 'on');
      });
      setText('connQualityText', lvl >= 3 ? 'Sehr gut' : lvl === 2 ? 'OK' : lvl === 1 ? 'Schwach' : 'Verloren');
    } else {
      bars.forEach(b => b.classList.remove('on', 'warn'));
      setText('connQualityText', 'Keine Daten');
    }
    setText('connLatency', c.lastPacketAt ? Math.round(Date.now() - c.lastPacketAt) : '--');
    setText('connRawG', `${state.raw.gx.toFixed(2)} / ${state.raw.gy.toFixed(2)}`);
    setText('connPulseHz', state.raw.pulseHz?.toFixed(1) || '--');
    setText('connPulseCount', state.raw.pulseCount || '--');
    setText('connErrCount', c.errors);
    // Packet log
    const log = $('packetLog');
    if (log && _packetLog.length) {
      log.innerHTML = _packetLog.slice(0, 8).map(p =>
        `<div><b>${p.t}</b><span>${esc(p.line.slice(0, 200))}</span></div>`
      ).join('');
    }
  } catch (e) { console.warn('renderConnectionTab:', e); }
}
function pushPacketLog(line) {
  _packetLog.unshift({ t: logTime(), line: line });
  _packetLog = _packetLog.slice(0, 20);
}
function toggleDiagnose() {
  document.body.classList.toggle('diagnose-on');
  const btn = $('diagToggleBtn');
  if (btn) btn.classList.toggle('primary', document.body.classList.contains('diagnose-on'));
}

// PIT-CALL — Boxenruf an Sender-ESP
// ============================================================
let _pitCallActive = false;
let _pitCallTimer = null;

// ============================================================
// Dashboard → Kart: Live Race-Display Update
// ============================================================
function buildRaceDataForKart() {
  const r = activeRace();
  // Auch ohne Race wird page-Auswahl uebermittelt (kleines Paket)
  if (!r || (r.status !== 'running' && r.status !== 'paused')) {
    return {
      type: 'display',
      page: state.settings.oledPage || 'auto',
      // Race-Felder bleiben leer/default
      sectors: ['open', 'open', 'open'],
    };
  }
  const drv = state.drivers.find(d => d.id === r.currentDriverId);
  // Sektor-States: 'done' bei abgeschlossenen, 'current' beim aktiven, 'open' sonst
  const cur = state.sectors.cur || 0;
  const lapSec = state.sectors.lapSectors || [null, null, null];
  const sectorStates = ["open", "open", "open"];
  for (let i = 0; i < 3; i++) {
    if (lapSec[i] != null) sectorStates[i] = "done";
    else if (i === cur && state.lapStart) sectorStates[i] = "current";
  }
  // Aktuelle Rundenzeit (mm:ss.SSS)
  const lapMs = state.lapStart ? Date.now() - state.lapStart : 0;
  const lapStr = state.lapStart ? fmtMs(lapMs) : "--:--.---";
  // Delta vs Bestzeit (nur Sektor-Delta wenn gerade Rundenzeit nicht final ist)
  let deltaStr = "--";
  let liveDeltaStr = "--";
  let liveDeltaMs = null;
  if (state.liveDelta != null) {
    const sign = state.liveDelta >= 0 ? "+" : "";
    liveDeltaStr = sign + (state.liveDelta / 1000).toFixed(3);
    liveDeltaMs = state.liveDelta;
    deltaStr = liveDeltaStr;
  }
  // Bestzeit als string
  const bestStr = state.bestLapMs ? fmtMs(state.bestLapMs) : "--";
  // Runden-Counter
  const validLaps = raceValidLaps(r).length;
  let target = "--";
  if (r.lengthType === 'laps') target = r.targetLaps;
  else if (r.lengthType === 'time') target = "T";
  // Restzeit (nur bei Time-Races) und gefahrene Zeit
  let remainingMs = null;
  let elapsedMs = raceElapsedMs(r);
  if (r.lengthType === 'time' && r.durationMs > 0) {
    remainingMs = Math.max(0, r.durationMs - elapsedMs);
  }
  // Driver-Name max 8 Zeichen, Nummer max 3
  const driverName = drv ? drv.name.slice(0, 8) : "--";
  const driverNum = drv ? String(drv.number || "").slice(0, 3) : "";
  return {
    type:           "display",
    driver:         driverName,
    num:            driverNum,
    lap:            lapStr,
    lapn:           validLaps + 1,
    target:         target,
    delta:          deltaStr,
    live_delta:     liveDeltaStr,
    live_delta_ms:  liveDeltaMs,
    live_delta_ref: state.bestLapNum || null,
    best_lap:       bestStr,
    sectors:        sectorStates,
    elapsed_ms:     elapsedMs,
    remaining_ms:   remainingMs,
    length_type:    r.lengthType,
    page:           state.settings.oledPage || 'auto',
  };
}
function sendDisplayUpdate() {
  if (state.connection.source !== 'serial' || !state.serial.connected) return;
  if (!window.rasiSerial?.writeLine) return;
  const payload = buildRaceDataForKart();
  if (!payload) return;
  try {
    window.rasiSerial.writeLine(JSON.stringify(payload));
  } catch (e) {
    // stumm - keine Hupe wenn der Sender mal nicht erreichbar ist
  }
}

let _displayUpdateTimer = null;
function restartDisplayUpdateInterval() {
  if (_displayUpdateTimer) clearInterval(_displayUpdateTimer);
  const ms = state.settings.displayUpdateMs || 500;
  _displayUpdateTimer = setInterval(sendDisplayUpdate, ms);
}


function sendPitCall(message, durationMs = 15000) {
  if (state.connection.source !== 'serial' || !state.serial.connected) {
    rcAlert('Kein USB verbunden. Pit-Call nicht moeglich.', 'Pit-Call');
    return false;
  }
  try {
    const payload = JSON.stringify({
      type: 'pit_call',
      action: 'trigger',
      message: (message || 'PIT STOP').slice(0, 14),
      duration_ms: durationMs
    });
    window.rasiSerial.writeLine(payload);
    return true;
  } catch (e) {
    rcAlert('Pit-Call Senden fehlgeschlagen:\n' + (e?.message || e), 'Fehler');
    return false;
  }
}
function cancelPitCall() {
  if (state.connection.source !== 'serial' || !state.serial.connected) return false;
  try {
    window.rasiSerial.writeLine(JSON.stringify({ type: 'pit_call', action: 'cancel' }));
    return true;
  } catch (e) { return false; }
}
function togglePitCall() {
  const btn = $('pitCallBtn');
  if (!btn) return;
  if (_pitCallActive) {
    // Bereits aktiv -> abbrechen
    cancelPitCall();
    _pitCallActive = false;
    btn.classList.remove('active');
    btn.textContent = '📢 BOX';
    if (_pitCallTimer) { clearTimeout(_pitCallTimer); _pitCallTimer = null; }
    rcToast('Pit-Call abgebrochen');
    return;
  }
  // Aktivieren
  if (state.connection.source === 'demo') {
    // Demo: lokal zeigen (kein echter ESP)
    _pitCallActive = true;
    btn.classList.add('active');
    btn.textContent = '⏹ STOP';
    rcToast('Demo: Pit-Call aktiviert (15s)', 2500);
    _pitCallTimer = setTimeout(() => {
      _pitCallActive = false;
      btn.classList.remove('active');
      btn.textContent = '📢 BOX';
      _pitCallTimer = null;
    }, 15000);
    return;
  }
  if (sendPitCall('PIT STOP', 15000)) {
    _pitCallActive = true;
    btn.classList.add('active');
    btn.textContent = '⏹ STOP';
    rcToast('Pit-Call gesendet — Mäher wird benachrichtigt', 3000);
    _pitCallTimer = setTimeout(() => {
      _pitCallActive = false;
      btn.classList.remove('active');
      btn.textContent = '📢 BOX';
      _pitCallTimer = null;
    }, 15000);
  }
}

// 19. SERIAL / DEMO
// ============================================================
async function listSerialPorts() {
  const sel = $('serialPortSelect');
  if (!sel) return;
  sel.innerHTML = '<option value="">Suche…</option>';
  try {
    if (window.rasiSerial) {
      const ports = await window.rasiSerial.list();
      sel.innerHTML = ports.length
        ? ports.map(p => `<option value="${esc(p.path)}">${esc(p.path)} ${esc(p.friendlyName || p.manufacturer || '')}</option>`).join('')
        : '<option value="">Kein COM-Port gefunden</option>';
    } else if ('serial' in navigator) {
      sel.innerHTML = '<option value="webserial">Browser-Auswahl beim Verbinden</option>';
    } else {
      sel.innerHTML = '<option value="">Nicht unterstützt</option>';
    }
  } catch (e) { console.warn('listSerialPorts:', e); sel.innerHTML = '<option value="">Fehler</option>'; }
}
async function connectSerial() {
  if (state.demo.running) stopDemo();
  stopReconnect();
  state.serial.autoReconnect = $('autoReconnectToggle').checked;
  state.serial.baud = Number($('serialBaud').value) || 115200;
  try {
    if (window.rasiSerial) {
      let path = $('serialPortSelect').value;
      if (!path) { await listSerialPorts(); path = $('serialPortSelect').value; }
      if (!path) return rcAlert('Bitte COM-Port wählen.');
      await window.rasiSerial.open(path, state.serial.baud);
      window.rasiSerial.onLine(line => handleSerialLine(line));
      window.rasiSerial.onClose(() => onSerialClose());
      window.rasiSerial.onError?.(msg => onSerialError(msg));
      state.serial.connected = true;
      state.serial.portName = path;
      state.serial.lastPath = path;
      state.connection.source = 'serial';
      $('connectBtn').textContent = 'USB trennen';
      $('connectBtn').className = 'btn danger w100';
      $('serialConnectBtn').textContent = 'Trennen';
      // Request status
      setTimeout(() => { try { window.rasiSerial.writeLine(JSON.stringify({ type: 'request_status' })); } catch {} }, 800);
    } else if ('serial' in navigator) {
      const port = await navigator.serial.requestPort();
      await port.open({ baudRate: state.serial.baud });
      state.serial.port = port;
      state.serial.connected = true;
      state.serial.portName = 'WebSerial';
      state.connection.source = 'serial';
      $('connectBtn').textContent = 'USB trennen';
      readWebSerial(port);
    } else {
      rcAlert('USB-Serial nur in Electron oder Chrome/Edge verfügbar.');
    }
  } catch (e) {
    state.connection.errors++;
    state.serial.connected = false;
    rcAlert('Verbindung fehlgeschlagen:\n' + (e?.message || e), 'Fehler');
  }
}
async function disconnectSerial() {
  stopReconnect();
  state.serial.autoReconnect = false;
  try {
    if (window.rasiSerial) await window.rasiSerial.close();
    if (state.serial.port) await state.serial.port.close();
  } catch {}
  state.serial.connected = false;
  state.serial.port = null;
  state.connection.source = 'offline';
  $('connectBtn').textContent = 'USB verbinden';
  $('connectBtn').className = 'btn primary w100';
  $('serialConnectBtn').textContent = 'Verbinden';
}
function onSerialClose() {
  state.serial.connected = false;
  state.connection.source = 'offline';
  $('connectBtn').textContent = 'USB verbinden';
  $('connectBtn').className = 'btn primary w100';
  $('serialConnectBtn').textContent = 'Verbinden';
  if (state.serial.autoReconnect && state.serial.lastPath) scheduleReconnect();
}
function onSerialError(msg) {
  state.connection.errors++;
  console.warn('Serial error:', msg);
}
async function readWebSerial(port) {
  const decoder = new TextDecoder();
  let buf = '';
  try {
    while (state.serial.connected && port.readable) {
      const reader = port.readable.getReader();
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          if (value) {
            buf += decoder.decode(value, { stream: true });
            const lines = buf.split(/\r?\n/);
            buf = lines.pop() || '';
            for (const line of lines) handleSerialLine(line);
          }
        }
      } finally { reader.releaseLock(); }
    }
  } catch (e) { console.warn('WebSerial read:', e); }
}
function handleSerialLine(line) {
  line = String(line || '').trim();
  if (!line || !line.startsWith('{')) return;
  try {
    const d = JSON.parse(line);
    pushPacketLog(line);
    processTelemetry(d);
    if (d.lat && d.lon) onGpsUpdate(d.lat, d.lon);
  } catch (e) { state.connection.errors++; }
}
function scheduleReconnect() {
  if (state.serial.reconnectTimer) return;
  state.serial.reconnectAttempts++;
  if (state.serial.reconnectAttempts > 30) return;
  const delay = Math.min(15000, 1500 * Math.pow(1.4, Math.min(state.serial.reconnectAttempts, 8)));
  state.serial.reconnectTimer = setTimeout(async () => {
    state.serial.reconnectTimer = null;
    if (!state.serial.autoReconnect || state.serial.connected) return;
    try {
      if (window.rasiSerial && state.serial.lastPath) {
        await window.rasiSerial.open(state.serial.lastPath, state.serial.baud);
        window.rasiSerial.onLine(line => handleSerialLine(line));
        window.rasiSerial.onClose(() => onSerialClose());
        state.serial.connected = true;
        state.serial.portName = state.serial.lastPath;
        state.connection.source = 'serial';
        state.serial.reconnectAttempts = 0;
        $('connectBtn').textContent = 'USB trennen';
        $('connectBtn').className = 'btn danger w100';
      }
    } catch (e) {
      if (state.serial.autoReconnect) scheduleReconnect();
    }
  }, delay);
}
function stopReconnect() {
  if (state.serial.reconnectTimer) { clearTimeout(state.serial.reconnectTimer); state.serial.reconnectTimer = null; }
  state.serial.reconnectAttempts = 0;
}

// Demo
function startDemo() {
  if (state.demo.running) return;
  if (state.serial.connected) disconnectSerial();
  state.demo.running = true;
  state.demo.t = 0;
  state.demo.angle = -Math.PI / 2;
  state.demo.lapsDone = 0;
  state.connection.source = 'demo';
  state.connection.bridgeMac = 'DE:MO:00:00:00:01';
  state.connection.kartMac = 'DE:MO:00:00:00:02';
  $('demoStartBtn').classList.add('hidden');
  $('demoStopBtn').classList.remove('hidden');
  setText('demoModeText', 'Läuft');
  $('connectBtn').textContent = 'Demo läuft';
  $('connectBtn').className = 'btn blue w100';
  // Generate demo track if no track loaded
  if (!state.track.points.length) generateDemoTrack();
  // Auto-create demo driver
  if (!state.drivers.length) {
    state.drivers.push({ id: uid(), name: 'Demo Driver', number: '1', color: '#e8ff00' });
    renderDrivers();
    renderDriverOptions();
  }
  // Auto-create demo race
  let r = activeRace();
  if (!r || (r.status !== 'running' && r.status !== 'paused')) {
    const demo = {
      id: uid(), name: 'Demo Race', trackId: state.activeTrackId,
      lengthType: 'free', durationMs: 30 * 60000, targetLaps: 20,
      startDriverId: state.drivers[0].id, currentDriverId: state.drivers[0].id,
      status: 'created', createdAt: Date.now(),
      startedAt: null, endedAt: null, totalPausedMs: 0,
      laps: [], stints: [], speedTrace: []
    };
    state.races.unshift(demo);
    state.activeRaceId = demo.id;
    state.selectedRaceId = demo.id;
    startRace();
    renderRaces();
  }
  // 80ms tick
  state.demo.interval = setInterval(demoTick, 80);
}
function stopDemo() {
  if (!state.demo.running) return;
  state.demo.running = false;
  if (state.demo.interval) clearInterval(state.demo.interval);
  state.demo.interval = null;
  state.connection.source = 'offline';
  $('demoStartBtn').classList.remove('hidden');
  $('demoStopBtn').classList.add('hidden');
  setText('demoModeText', 'Bereit');
  $('connectBtn').textContent = 'USB verbinden';
  $('connectBtn').className = 'btn primary w100';
  // End demo race if running
  const r = activeRace();
  if (r && r.name === 'Demo Race' && (r.status === 'running' || r.status === 'paused')) {
    endRace(false);
  }
}
function demoTick() {
  try {
    state.demo.t += 0.08;
    state.demo.angle += (Math.PI * 2) / 1038; // ~83s/lap
    const a = state.demo.angle;
    const C = { lat: 49.6, lon: 6.12 };
    const RAD = 0.00033, WOB = 0.000028;
    const wob = WOB * Math.sin(a * 4.5 + 0.3);
    const lat = C.lat + Math.sin(a) * RAD * 0.62 + wob;
    const lon = C.lon + Math.cos(a) * RAD + wob;
    const curvature = Math.abs(Math.cos(a * 2));
    const speed = Math.max(0, 72 - 40 * curvature + 6 * Math.sin(state.demo.t * 0.3) + Math.random() * 4);
    const rpm = Math.max(800, 4500 + 4200 * Math.abs(Math.sin(state.demo.t * 0.45)) - 3000 * curvature + 300 * Math.sin(state.demo.t * 2.1));
    const gx = 0.6 * Math.sin(state.demo.t * 1.9) + 0.08 * (Math.random() - 0.5);
    const gy = (2.1 - 1.2 * curvature) * Math.sin(a * 2 + 0.2) + 0.15 * (Math.random() - 0.5);
    // Process as if from telemetry
    processTelemetry({
      speed, rpm, gx, gy, lat, lon,
      gps_fix: 1, fix: 1,
      seq: (state.connection.seq || 0) + 1,
      from_mac: 'DE:MO:RA:SI:00:01',
      rssi: -52
    });
    onGpsUpdate(lat, lon);
  } catch (e) { console.warn('demoTick:', e); }
}
function generateDemoTrack() {
  const C = { lat: 49.6, lon: 6.12 };
  const RAD = 0.00033, WOB = 0.000028;
  const N = 120;
  const pts = [];
  for (let i = 0; i < N; i++) {
    const a = -Math.PI / 2 + (i / N) * Math.PI * 2;
    const wob = WOB * Math.sin(a * 4.5 + 0.3);
    pts.push({ lat: C.lat + Math.sin(a) * RAD * 0.62 + wob, lon: C.lon + Math.cos(a) * RAD + wob });
  }
  state.track.points = pts;
  state.track.bounds = null;
  pts.forEach(p => updateBounds(p.lat, p.lon));
  state.track.closed = true;
  state.track.totalDistance = 0;
  for (let i = 1; i < pts.length; i++) {
    state.track.totalDistance += gpsDist(pts[i-1].lat, pts[i-1].lon, pts[i].lat, pts[i].lon);
  }
  state.track.totalDistance += gpsDist(pts[pts.length-1].lat, pts[pts.length-1].lon, pts[0].lat, pts[0].lon);
  state.track.maxDistFromStart = pts.reduce((m, p) => Math.max(m, gpsDist(pts[0].lat, pts[0].lon, p.lat, p.lon)), 0);
  // Set start gate
  state.startGate = {
    enabled: true,
    lat: pts[0].lat, lon: pts[0].lon,
    heading: headingFromPoints(pts[0], pts[1]),
    width: 14
  };
  setText('gateSizeText', '14m');
  // Auto sectors
  state.sectors.manual = false;
  calcAutoSectors();
  drawTrack();
  updateSectorPanel();
}

// ============================================================
// EXPORT / IMPORT / RESET
// ============================================================
function exportAll() {
  const data = {
    version: '9.6', exportedAt: new Date().toISOString(),
    settings: state.settings, calibration: state.calibration,
    drivers: state.drivers, races: state.races,
    savedTracks: state.savedTracks,
    track: state.track, startGate: state.startGate,
    sectors: state.sectors
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `rasicross_v96_${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(url);
  rcToast('Export erstellt');
}
function importAll(file) {
  const reader = new FileReader();
  reader.onload = async () => {
    try {
      const d = JSON.parse(reader.result);
      if (!await rcConfirm('Aktuelle Daten überschreiben?', 'Importieren', 'Importieren', true)) return;
      if (d.settings) Object.assign(state.settings, d.settings);
      if (d.calibration) Object.assign(state.calibration, d.calibration);
      if (Array.isArray(d.drivers)) state.drivers = d.drivers;
      if (Array.isArray(d.races)) state.races = d.races;
      if (Array.isArray(d.savedTracks)) state.savedTracks = d.savedTracks;
      saveData();
      location.reload();
    } catch (e) { rcAlert('Import fehlgeschlagen:\n' + e.message); }
  };
  reader.readAsText(file);
}
async function resetAll() {
  if (!await rcConfirm('Alle Daten unwiderruflich löschen?', 'Zurücksetzen', 'Löschen', true)) return;
  localStorage.removeItem(SAVE_KEY);
  location.reload();
}

// ============================================================
// 20. INIT
// ============================================================
function init() {
  loadData();
  applyTheme();
  loadSettingsToUi();
  setupTabs();
  // Canvases
  _trackCanvas = $('trackCanvas');
  _scanCanvas = $('scanCanvas');
  resizeCanvases();
  initLiveCharts();
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
  // Live tab buttons
  $('startRaceBtn').onclick = startRace;
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
  $('demoStartBtn').onclick = startDemo;
  $('demoStopBtn').onclick = stopDemo;
  // Settings tab
  $('saveSettingsBtn').onclick = saveSettingsFromUi;
  $('zeroImuBtn').onclick = () => {
    state.calibration.gxZero = state.raw.gx || 0;
    state.calibration.gyZero = state.raw.gy || 0;
    loadSettingsToUi();
    saveData();
    rcToast('Nullpunkt gesetzt');
  };
  $('espSendBtn').onclick = async () => {
    const cfg = {
      type: 'config',
      max_rpm: Number($('espMaxRpm').value) || 6000,
      warn_rpm: Number($('espWarnRpm').value) || 5500,
      send_ms: Number($('espSendMs').value) || 80,
      pulses_per_rev: Number($('espPulses').value) || 1
    };
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
  $('importAllFile').onchange = e => { if (e.target.files[0]) importAll(e.target.files[0]); };
  $('resetAllBtn').onclick = resetAll;
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
  // Window exports for inline onclick handlers
  window.loadSavedTrack = loadSavedTrack;
  window.deleteSavedTrack = deleteSavedTrack;
  window.openTrackEditor = openTrackEditor;
  window.closeEditor = closeTrackEditor;
  window.saveEditor = saveEditor;
  window.editorClickTarget = editorClickTarget;
  window.deleteDriver = deleteDriver;
  window.selectRace = selectRace;
  window.setActiveRace = setActiveRace;
  window.endRace = endRace;
  window.closeDriverModal = closeDriverModal;
  window.confirmDriverChange = confirmDriverChange;
  window.toggleRaceExpand = toggleRaceExpand;
  window.deleteRace = deleteRace;
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
      // Speicher-Status spiegeln (sessionText macht das Original)
      const ss = $$('sessionText')?.textContent;
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
    // Theme toggle: dark -> light -> outdoor -> dark
    $$('themeBtn')?.addEventListener('click',()=>{
      const order = ['dark','light','outdoor'];
      const cur = document.documentElement.getAttribute('data-theme') || 'dark';
      const next = order[(order.indexOf(cur) + 1) % order.length] || 'dark';
      document.documentElement.setAttribute('data-theme', next);
      try{ state.theme = next; saveData(); }catch(e){}
    });
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
    // Pit-wall btn
    $$('pitwallBtn')?.addEventListener('click', ()=>$$('pitwallOverlay').classList.add('show'));
    $$('pwCloseBtn')?.addEventListener('click', ()=>$$('pitwallOverlay').classList.remove('show'));
    document.addEventListener('keydown',(e)=>{
      if(e.key==='Escape') $$('pitwallOverlay')?.classList.remove('show');
    });
    // Diagnose toggle
    $$('diagToggleBtn')?.addEventListener('click',()=>document.body.classList.toggle('diagnose-on'));
    // Mode tabs
    const ms=$$('modeSerialBtn'),md=$$('modeDemoBtn');
    if(ms&&md){
      ms.addEventListener('click',()=>{ms.classList.add('active');md.classList.remove('active');$$('serialPanel').classList.remove('hidden');$$('demoPanel').classList.add('hidden');});
      md.addEventListener('click',()=>{md.classList.add('active');ms.classList.remove('active');$$('demoPanel').classList.remove('hidden');$$('serialPanel').classList.add('hidden');});
    }
    // Theme init
    try{ if(state && state.theme) document.documentElement.setAttribute('data-theme', state.theme);}catch(e){}
  });
})();
