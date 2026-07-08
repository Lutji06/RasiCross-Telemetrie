// ESM (Phase 42): explizite Imports statt gemeinsamem Global-Scope. Zyklen
// rasicross <-> UI-Module sind zulaessig -- alle Split-Scripts haben nur
// Deklarationen auf Top-Level, Aufrufe erfolgen erst nach init().
import { initTrackCanvases, resizeCanvases, drawTrack,
         trackCanvas, scanCanvas } from './map-draw.js';
import { activeRace, activePart, closeDriverModal, confirmDriverChange,
         createRace, deleteRace, endRace, openDriverChange, renderRaces,
         renderTrackOptions, selectRace, setActiveRace, toggleRaceExpand,
         toggleRaceRun, updateRaceControls } from './races.js';
import { connectSerial, disconnectSerial, listSerialPorts,
         startDemo, stopDemo } from './serial-demo.js';
import { drawGMeter } from './gauges.js';
import { activateSectorClick, checkSectorCrossings, clearManualSectors,
         clearTrack, closeTrackEditor, deleteSavedTrack, editorClickTarget,
         finishTrackScan, handleTrackCanvasClick, loadSavedTrack,
         openTrackEditor, recomputeTrackBounds, renderSavedTracks,
         saveCurrentTrack, saveEditor, startTrackScan,
         updateSectorPanel } from './track.js';
import { addDriver, checkLapCrossing, deleteDriver, renderDriverOptions,
         renderDrivers, renderLapTable } from './laps-drivers.js';
import { animLoop, initLiveCharts, initLiveUiLoops } from './live-ui.js';
import { closePitWall, openPitWall, restartDisplayUpdateInterval,
         sendDisplayUpdate, toggleDiagnose, togglePitCall } from './pit-wall.js';
import { enterReplay, exitReplay, exportAll, exportRecordingCsv, importAll,
         initRecStore, loadRecordingFile, replayRace, replaySeek, resetAll,
         saveRecording, setReplaySpeed, toggleReplayPlay,
         updateRecStatus } from './recording.js';
import DomTargets from './dom-targets.js';
import KartRegistry from './kart-registry.js';
import RasiAttitude from './attitude.js';
import RasiDrift from './drift.js';
import RasiEngine from './engine.js';
import RasiKart3D from './karts3d.js';
import RasiKartBar from './kart-bar.js';
import { renderKartsTab } from './karts-page.js';
import RasiLapEngine from './lap-engine.js';
import RasiReplay from './replay.js';
import RasiSettings from './settings.js';
import RasiTileRenderer from './tile-renderer.js';
import { state, activeKart, kartFor, saveData, saveDataDebounced, loadData, migrateLegacyKartMeta, kartMetaFor } from './store.js';

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
     8. Tacho/RPM/G-Meter          -> gauges.js (Phase 23)
     9. Track Map (drawing)        -> map-draw.js (Phase 22)
    10. Track Scan                 -> track.js (Phase 23)
    11. Track Persistence          -> track.js (Phase 23)
    12. Track Editor               -> track.js (Phase 23)
    13. Sectors                    -> track.js (Phase 23)
    14. Lap Detection              -> laps-drivers.js (Phase 23)
    15. Drivers                    -> laps-drivers.js (Phase 23)
    16. Races                      -> races.js (Phase 22)
    17. Live UI                    -> live-ui.js (Phase 23)
    18. Pit-Wall                   -> pit-wall.js (Phase 23)
    19. Serial / Demo              -> serial-demo.js (Phase 22)
    19b. Recording/Replay          -> recording.js (Phase 23)
    20. Init (+ G-View/Kart-Model-Glue)
   ============================================================ */

// ============================================================
// 1. CONSTANTS & STATE
// ============================================================
const $ = id => document.getElementById(id);
const css = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const dpr = () => window.devicePixelRatio || 1;
const uid = () => 'id_' + Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

// Send a command line to the bridge, tagged with the active kart's MAC so the
// bridge routes the downlink to the selected kart (target_mac is routing-only;
// the kart firmware ignores the unknown key). Returns true if written.
function bridgeSend(obj) {
  if (!window.rasiSerial || !window.rasiSerial.writeLine) return false;
  if (!state.serial || !state.serial.connected) return false;
  const mac = state.activeKartMac;
  const payload = Object.assign({}, obj);
  if (mac && mac !== KartRegistry.DEFAULT_MAC && !payload.target_mac) payload.target_mac = mac;
  try { window.rasiSerial.writeLine(JSON.stringify(payload)); return true; }
  catch (e) { return false; }
}
window.rasiBridgeSend = bridgeSend;

// ============================================================
// 2. UTILITIES
// ============================================================
// fmtMs / fmtClock / fmtDelta moved to geo.js (loaded as a <script> before rasicross.js; also a CommonJS module for tests)
function setText(id, val) { const e = $(id); if (e) e.textContent = val; }

// Shared-ID fan-out — Live and Detail share several values (Speed, RPM, Lap, ...).
function setTextShared(key, value) {
  const ids = DomTargets.targetIdsFor(key);
  for (const id of ids) setText(id, value);
}
function setHtmlShared(key, html) {
  const ids = DomTargets.targetIdsFor(key);
  for (const id of ids) {
    const el = $(id);
    if (el) el.innerHTML = html;
  }
}

// traceDistanceM moved to geo.js

// gpsDist / headingFromPoints / segmentsCross / crossingDirectionOk / lineEndpointsFromGate moved to geo.js
function logTime(ts = Date.now()) { return new Date(ts).toLocaleTimeString('de-DE'); }

export { SAVE_KEY, state, activeKart, kartFor, rasiPersistForget, kartMetaFor, updateKartMeta, kartRosterMacs, kartCalFor, kartEngineFor, saveData, saveDataDebounced, loadData, migrateLegacyKartMeta } from './store.js';

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
  document.body.dataset.liveView = state.liveView || 'single';
  document.querySelectorAll('.nav-item[data-tab]').forEach(btn => {
    btn.onclick = () => {
      document.querySelectorAll('.nav-item[data-tab]').forEach(b => { b.classList.remove('active'); b.removeAttribute('aria-current'); });
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      btn.classList.add('active');
      btn.setAttribute('aria-current', 'page');
      const tab = btn.dataset.tab;
      const panel = $('tab-' + tab);
      if (panel) panel.classList.add('active');
      document.body.dataset.tab = tab;
      // Resize canvases when tab becomes visible
      setTimeout(resizeCanvases, 50);
      // Bei Driver-Tab: Stats neu berechnen (kann sich nach jedem Rennen aendern)
      if (tab === 'drivers') renderDrivers();
      if (tab === 'karts') renderKartsTab();
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
    RasiTileRenderer.clearMemory();
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

// ESP-Config-Formular <- config_ack: [Input-ID, kompakter Funk-Key].
// Der Kart bestaetigt jede Config (und antwortet auf config_get) mit den
// TATSAECHLICH uebernommenen Werten — Gegenstueck: _ACK_KEYS in sender.py.
// Kompakte Keys, weil die langen Namen das 250-B-ESP-NOW-Limit sprengen.
const ESP_CFG_FIELDS = [
  ['espMaxRpm', 'mr'], ['espWarnRpm', 'wr'], ['espSendMs', 'sm'],
  ['espPulses', 'ppr'], ['espWheelCirc', 'wc'], ['espGearRatio', 'gear'],
  ['espBattCells', 'bc'], ['espBattWarnV', 'bwv'], ['espBattCritV', 'bcv'],
  ['espBattCal', 'bcal'], ['espRpmCeiling', 'rcl'], ['espRpmAlpha', 'ra'],
  ['espPageMs', 'pm'],
];
let _espAckTimer = null;
function applyEspConfigAck(d) {
  clearTimeout(_espAckTimer);
  _espAckTimer = null;
  for (const [id, key] of ESP_CFG_FIELDS) {
    const el = $(id);
    if (el && d[key] != null) el.value = d[key];
  }
  // Akkuzellen-Zahl gehoert zum bestaetigenden Kart (per from_mac), sonst aktiver Kart.
  const _k = kartFor(d.from_mac || KartRegistry.DEFAULT_MAC) || activeKart();
  if (d.bc != null) _k.batt.cells = Number(d.bc) || _k.batt.cells;
  setText('espSendStatus', '✓ Vom Kart bestätigt ' + logTime());
}

function loadSettingsToUi() {
  const k = activeKart();
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
  $('gxOffsetText').textContent = k.calibration.gxZero.toFixed(2);
  $('gyOffsetText').textContent = k.calibration.gyZero.toFixed(2);
  if ($('setInvertGx')) $('setInvertGx').checked = !!k.calibration.invertGx;
  if ($('setInvertGy')) $('setInvertGy').checked = !!k.calibration.invertGy;
  if ($('setSwapG')) $('setSwapG').checked = !!k.calibration.swapG;
  if ($('setInvertYaw')) $('setInvertYaw').checked = !!k.calibration.invertYaw;
  if ($('setInvertRollRate')) $('setInvertRollRate').checked = !!k.calibration.invertRollRate;
  if ($('recAutoArmToggle')) $('recAutoArmToggle').checked = state.settings.recordAutoArm !== false;
  if ($('setTilesEnabled')) {
    $('setTilesEnabled').checked = !!(state.settings.tiles && state.settings.tiles.enabled);
  }
  if ($('setTilesUrl')) {
    $('setTilesUrl').value = (state.settings.tiles && state.settings.tiles.urlTemplate) || '';
    updateTilesUrlHint();
    applyTilesPresetFromUrl();
  }
  showSettingsGroup((state.settings && state.settings.uiActiveGroup) || 'dashboard');
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
  const k = activeKart();
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
  k.calibration.invertGx = !!$('setInvertGx')?.checked;
  k.calibration.invertGy = !!$('setInvertGy')?.checked;
  k.calibration.swapG = !!$('setSwapG')?.checked;
  k.calibration.invertYaw = !!$('setInvertYaw')?.checked;
  k.calibration.invertRollRate = !!$('setInvertRollRate')?.checked;
  drawGMeter._trail = [];
  if (!state.settings.tiles) state.settings.tiles = { enabled: true, urlTemplate: '', liveQuickToggle: true };
  if ($('setTilesEnabled')) state.settings.tiles.enabled = !!$('setTilesEnabled').checked;
  if ($('setTilesUrl')) state.settings.tiles.urlTemplate = ($('setTilesUrl').value || '').trim();
  loadSettingsToUi();
  saveData();
  flashSettingsSaved();
}

// Auto-Update-UI (Phase 25): Version + Status in den Einstellungen, Toast
// sobald ein Update heruntergeladen ist. Main-Prozess macht die Arbeit
// (electron-updater); im Browser/Dev-Modus degradiert die Anzeige sauber.
function initUpdateUi() {
  const statusEl = $('updStatus'), installBtn = $('updInstallBtn');
  const setStatus = (t) => { if (statusEl) statusEl.textContent = t; };
  if (!window.rasiUpdate) { setStatus('Updates: nur in der installierten App'); const b = $('updCheckBtn'); if (b) b.disabled = true; return; }
  window.rasiUpdate.version().then(v => {
    setText('updVersion', v.version || '--');
    if (v.guard === 'dev') setStatus('Updates: im Dev-Modus deaktiviert');
    else if (v.guard === 'portable') setStatus('Updates: Portable-Version aktualisiert sich nicht selbst');
  }).catch(() => {});
  window.rasiUpdate.onStatus(s => {
    if (!s) return;
    if (s.state === 'downloading') {
      setStatus('Update ' + (s.version ? 'auf ' + s.version + ' ' : '') + 'wird geladen' + (s.percent != null ? ' (' + s.percent + '%)' : '') + ' …');
    } else if (s.state === 'uptodate') {
      setStatus('Auf dem neuesten Stand (' + (s.version || '') + ')');
    } else if (s.state === 'ready') {
      setStatus('Update ' + (s.version || '') + ' bereit — wird beim Beenden installiert');
      if (installBtn) installBtn.style.display = '';
      rcToast('⬇ Update ' + (s.version || '') + ' bereit — Installation beim Beenden', 5000);
    } else if (s.state === 'error') {
      setStatus('Update-Fehler: ' + (s.message || '?'));
    }
  });
  const checkBtn = $('updCheckBtn');
  if (checkBtn) checkBtn.onclick = async () => {
    setStatus('Suche nach Updates …');
    const r = await window.rasiUpdate.check().catch(() => null);
    if (r && r.ok === false) {
      setStatus(r.reason === 'dev' ? 'Updates: im Dev-Modus deaktiviert'
        : r.reason === 'portable' ? 'Updates: Portable-Version aktualisiert sich nicht selbst'
        : 'Update-Fehler: ' + (r.message || r.reason || '?'));
    }
  };
  if (installBtn) installBtn.onclick = () => window.rasiUpdate.install().catch(() => {});
}

// ============================================================
// 7. TELEMETRY PIPELINE
// ============================================================
// Crash-Sicherung (Phase 24): recordPacket sammelt NDJSON-Zeilen und schiebt
// sie gebuendelt an den Main-Prozess (alle ~25 Pakete oder 2s) — nach einem
// Absturz bietet init() die Datei zur Wiederherstellung an. Nur in Electron
// (window.rasiRec); im Browser bleibt alles wie bisher im RAM.
const REC_FLUSH_N = 25, REC_FLUSH_MS = 2000;
let _crashQ = [], _crashLastFlush = 0, _crashFailed = false;
function _crashFlush(now) {
  if (!window.rasiRec || _crashFailed || !_crashQ.length) return;
  const batch = _crashQ.join('\n') + '\n';
  _crashQ = [];
  _crashLastFlush = now;
  window.rasiRec.append(batch).then(r => {
    if (r && r.ok === false && !_crashFailed) {
      _crashFailed = true;
      rcToast('⚠ Crash-Sicherung deaktiviert: ' + (r.error || 'Schreibfehler'), 4000);
    }
  }).catch(() => {});
}
function armRecording() {
  // Frische Aufnahme starten (auto bei Connect/Demo, wenn aktiviert).
  // Aufnahme bezieht sich auf den aktuell ausgewaehlten Kart.
  const k = activeKart();
  k.recording.buf = [];
  k.recording.startWall = null;
  k.recording.overflowed = false;
  k.recording.armed = true;
  // Crash-Sicherungsdatei frisch beginnen (Header-Zeile, Pakete folgen).
  _crashQ = []; _crashLastFlush = Date.now(); _crashFailed = false;
  if (window.rasiRec) {
    const header = RasiReplay.serializeRecording([], { created: new Date().toISOString() });
    window.rasiRec.start(header).catch(() => {});
  }
}
function recordPacket(d) {
  const k = kartFor(d.from_mac || KartRegistry.DEFAULT_MAC);
  if (!k) return;
  const now = Date.now();
  if (k.recording.startWall == null) k.recording.startWall = now;
  const rec = Object.assign({}, d, { t_rel: now - k.recording.startWall, _wall: now });
  const dropped = RasiReplay.pushCapped(k.recording.buf, rec, RasiReplay.REC_MAX);
  if (dropped && !k.recording.overflowed) {
    k.recording.overflowed = true;
    rcToast('⚠ Aufnahme-Puffer voll — älteste Pakete werden verworfen', 4000);
  }
  if (window.rasiRec && !_crashFailed) {
    _crashQ.push(JSON.stringify(rec));
    if (_crashQ.length >= REC_FLUSH_N || now - _crashLastFlush >= REC_FLUSH_MS) _crashFlush(now);
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

// Phase 39: "Max Karts"-Hinweis nur einmal pro unbekannter MAC und Session —
// ohne Drossel wuerde ein 5. Kart bei ~12 Hz den Toast permanent halten.
const _maxKartsToasted = new Set();

function processTelemetry(d) {
  try {
    if (!d) return;
    if (d.type === 'bridge_status') {
      if (d.mac) activeKart().connection.bridgeMac = d.mac;
      if (d.kart_mac) activeKart().connection.kartMac = d.kart_mac;
      // Hintergrund-Karts schon vor ihrem ersten Telemetrie-Paket befuellen,
      // damit Chips RSSI/Hz/Lost anzeigen.
      state._kartHz = state._kartHz || {};
      if (Array.isArray(d.karts)) {
        for (const ks of d.karts) {
          if (!ks || !ks.mac) continue;
          const kk = kartFor(ks.mac);
          if (!kk) continue;
          if (ks.rssi != null) kk.connection.rssi = ks.rssi;
          if (ks.lost != null) kk.connection.lost = ks.lost;
          state._kartHz[ks.mac] = ks.rate_hz;
        }
      }
      RasiKartBar.render(state);
      return;
    }
    if (d.type === 'config_ack') { applyEspConfigAck(d); return; }
    // Ziel-Kart aufloesen (MAC = Identitaet). Schreibpfade laufen explizit
    // ueber k statt ueber die aktive-Kart-Proxy-Fassade, damit Hintergrund-
    // Karts ihren eigenen Zustand fuellen.
    const _mac = d.from_mac || KartRegistry.DEFAULT_MAC;
    const k = kartFor(_mac);
    if (!k) {
      if (!_maxKartsToasted.has(_mac)) {
        _maxKartsToasted.add(_mac);
        rcToast('Max. ' + KartRegistry.MAX_KARTS + ' Karts — ' + _mac + ' ignoriert', 4000);
      }
      return;
    }
    // Phase 30: Nachzuegler — sendet ein Kart waehrend eines laufenden Rennens
    // erstmals und ist noch kein Teilnehmer, lege seinen Slot an (armiert bei
    // erster Linie, da k.lapStart noch null ist).
    {
      const _r = activeRace();
      if (_r && _r.status === 'running' && !(_r.participants && _r.participants[_mac])) {
        RasiLapEngine.getOrCreatePart(_r, _mac, _r.currentDriverId, null);
      }
    }
    if (k.recording.armed && !k.replay.active) recordPacket(d);
    if (state.serial.connected && !k.replay.active) k.connection.source = 'serial';
    k.connection.packets++;
    k.connection.lastPacketAt = Date.now();
    kartMetaFor(_mac, Math.max(0, state.karts.macs().indexOf(_mac))).lastSeenAt = Date.now();
    k.connection.kartMac = _mac;
    if (typeof d.rssi === 'number') k.connection.rssi = d.rssi;
    // Verlustzaehlung: eine Quelle. Die Bridge zaehlt ueber die ESP-NOW-
    // Sequenznummern und liefert `lost` kumulativ in jedem Paket mit ->
    // direkt uebernehmen. Eigene seq-Zaehlung nur als Fallback fuer
    // Quellen ohne lost-Feld (Demo, alte Aufnahmen).
    if (d.lost != null) {
      k.connection.lost = Number(d.lost) || 0;
    } else if (d.seq != null && k.connection.seq != null) {
      const delta = (d.seq - k.connection.seq + 65536) % 65536;
      if (delta > 1 && delta < 1000) k.connection.lost += delta - 1;
    }
    if (d.seq != null) k.connection.seq = d.seq;
    state.hz++;
    // Calibrated values
    const speed = Math.max(0, Number(d.speed) || 0);
    const rpm = Math.max(0, Number(d.rpm) || 0);
    // Motorlaufzeit (Phase 27): nur echte Hardware-Pakete zaehlen --
    // Demo/Replay wuerden den Wartungszaehler verfaelschen.
    if (k.connection.source === 'serial' && !k.replay.active) {
      const _eng = RasiEngine.engineStep(k.engine, rpm, Date.now());
      k.engine.totalMs = _eng.totalMs;
      k.engine.lastAt = _eng.lastAt;
      k.engine._unsavedMs += _eng.addedMs;
      if (k.engine._unsavedMs >= 60000) {   // 1x pro Motor-Minute persistieren
        k.engine._unsavedMs = 0;
        saveDataDebounced();
      }
      if (!k.engine._warned
          && RasiEngine.serviceDue(k.engine.totalMs, k.engine.lastServiceMs, k.engine.serviceIntervalH)) {
        k.engine._warned = true;
        rcToast('🔧 Wartung fällig — '
          + RasiEngine.hoursText(RasiEngine.sinceServiceMs(k.engine.totalMs, k.engine.lastServiceMs))
          + ' seit letzter Wartung', 6000);
      }
    }
    let gx = (Number(d.gx) || 0) - k.calibration.gxZero;
    let gy = (Number(d.gy) || 0) - k.calibration.gyZero;
    const gz = Number(d.gz) || 0;                  // Accel-Z (g), jedes Paket
    const di = driftInputs(d, k.calibration);      // geteilte Drift-Normalisierung (inkl. invertYaw)
    const yawv = di.yawRate;                        // vorzeichen-korrigierte Gierrate (deg/s)
    k.imu.yaw = yawv;
    if (d.mtemp != null) k.imu.mtemp = Number(d.mtemp) || 0;  // langsam: letzten Wert halten
    // Apply axis transformations
    if (k.calibration.swapG) { const tmp = gx; gx = gy; gy = tmp; }
    if (k.calibration.invertGx) gx = -gx;
    if (k.calibration.invertGy) gy = -gy;
    // Drift (Phase 20): gehaerteter + geglaetteter Gierraten-Index. di teilt die
    // Eingangs-Normalisierung mit dem Replay-Aggregat; smoothStep liefert
    // EMA-Index + entprellten/hysterese-stabilen Status.
    // Hangkompensation (Phase 24): Schwerkraftanteil sin(roll) aus der Quer-g
    // ziehen, damit Hangfahrt nicht als Unter-/Uebersteuern erscheint. Roll vom
    // vorherigen Sample (Update folgt unten) -- bei 12 Hz vernachlaessigbar.
    const dRaw = RasiDrift.analyze(
      { yawRate: di.yawRate, speed: di.speed,
        latAccel: RasiDrift.tiltCompLatG(di.latAccel, k.attitude.rollDeg) },
      state.settings.drift);
    // settings.drift liefert tol (-> Hysterese-Baender); smooth/hyst/counterHold
    // sind nicht in den Settings und fallen in smoothStep auf SMOOTH_DEFAULTS zurueck.
    k.driftSmooth = RasiDrift.smoothStep(k.driftSmooth, dRaw, state.settings.drift);
    k.drift = { status: k.driftSmooth.status, index: k.driftSmooth.idxEma };
    // Rollwinkel (Phase 19b): Roll-Rate (d.roll) + Accel-Schwerkraft-Referenz
    // -> Winkel (Komplementaerfilter), minus Null-Offset. di.latAccel = kalibrierte
    // Querbeschleunigung; gz = Accel-Z.
    const _attNow = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    const _attDt = _attLastMs ? (_attNow - _attLastMs) / 1000 : 0.08;
    _attLastMs = _attNow;
    const _rollRate = (Number(d.roll) || 0) * (k.calibration.invertRollRate ? -1 : 1);
    const _rollRaw = RasiAttitude.rollStep(
      k.attitude.rollDeg + k.calibration.rollZero,
      _rollRate, di.latAccel, Number(d.gz) || 0, _attDt, 0.98);
    k.attitude.rollDeg = _rollRaw - k.calibration.rollZero;
    k.attitude.overState = RasiAttitude.rolloverStep(
      k.attitude.overState, k.attitude.rollDeg, state.settings.rollover);
    k.attitude.over = k.attitude.overState.active;
    if (k.attitude.overState.onset) {
      rcToast('⚠ Mäher umgekippt!', 4000);
      rcAudio.rollover();
    }
    const lat = Number(d.lat);
    const lon = Number(d.lon);
    const hasGps = !!(d.gps_fix ?? d.fix ?? (lat && lon));
    k.gps.fix = hasGps;
    if (lat && lon) k.gps.lastAt = Date.now();
    if (d.spd_src) k.spdSrc = d.spd_src;
    // Batterie (A3): vbat/soc langsam -> nur bei Anwesenheit aktualisieren
    // (sonst letzten Wert behalten); batt_warn jedes Paket wenn aktiv.
    if (d.vbat != null) { k.batt.vbat = Number(d.vbat) || 0; k.batt.present = true; }
    if (d.soc != null)  { k.batt.soc = Number(d.soc) || 0;  k.batt.present = true; }
    if (d.batt_warn != null) {
      k.batt.present = true;
      const w = Number(d.batt_warn) || 0;
      if (w > k.batt._lastWarn) {           // nur Aufwaerts-Transition
        if (w === 2) { rcToast('⛔ Akku kritisch!', 3500); rcAudio.battCrit(); }
        else if (w === 1) { rcToast('⚠ Akku schwach', 3000); rcAudio.battWarn(); }
      }
      k.batt._lastWarn = w;
      k.batt.warn = w;
    }
    k.raw = { speed, rpm, gx: Number(d.gx) || 0, gy: Number(d.gy) || 0, gz, yaw: yawv, lat: lat || 0, lon: lon || 0, glitch: d.glitch != null ? (Number(d.glitch) || 0) : null, pulseHz: Number(d.pulse_hz) || 0 };
    k.telemetry = { speed, rpm, gx, gy, gz, lat: lat || 0, lon: lon || 0 };
    // Update max
    k.max.speed = Math.max(k.max.speed, speed);
    k.max.rpm = Math.max(k.max.rpm, rpm);
    k.max.g = Math.max(k.max.g, Math.sqrt(gx*gx + gy*gy));
    // Per-lap max
    k.currentLapMax.speed = Math.max(k.currentLapMax.speed, speed);
    k.currentLapMax.rpm = Math.max(k.currentLapMax.rpm, rpm);
    k.heatmap.lapMaxSpeed = Math.max(k.heatmap.lapMaxSpeed, speed);
    // Charts (downsampled)
    if (k.charts.speed.length === 0 || (k.connection.packets % 2 === 0)) {
      k.charts.speed.push(speed);
      k.charts.rpm.push(rpm);
      k.charts.gx.push(gx);
      k.charts.gy.push(gy);
      k.charts.gz.push(gz);
      k.charts.yaw.push(yawv);
      k.charts.driftIndex.push(k.drift.index == null ? 0 : k.drift.index);
      const max = 600;
      while (k.charts.speed.length > max) k.charts.speed.shift();
      while (k.charts.rpm.length > max) k.charts.rpm.shift();
      while (k.charts.gx.length > max) k.charts.gx.shift();
      while (k.charts.gy.length > max) k.charts.gy.shift();
      while (k.charts.gz.length > max) k.charts.gz.shift();
      while (k.charts.yaw.length > max) k.charts.yaw.shift();
      while (k.charts.driftIndex.length > max) k.charts.driftIndex.shift();
    }
    // Track current lap trace
    if (k.lapStart && lat && lon) {
      k.currentLapTrace.push({ t: Date.now() - k.lapStart, lat, lon, speed });
      if (k.currentLapTrace.length > 5000) k.currentLapTrace.shift();
    }
    // Phase 30: Lap-/Sektorerkennung laeuft PRO KART (k/mac explizit), nicht mehr
    // nur fuer den aktiven. Geometrie (startGate/boundaries) ist geteilt.
    const _r = activeRace();
    const _isPart = !!(_r && _r.status === 'running' && _r.participants && _r.participants[_mac]);
    if (_isPart && lat && lon && state.startGate.enabled) {
      // Erste Durchfahrt armiert (k.lapStart==null -> checkLapCrossing setzt sie
      // via triggerLap auf now, ohne Runde zu zaehlen). checkLapCrossing/-Sectors
      // pruefen k.lapStart selbst.
      checkLapCrossing(k, _mac, lat, lon);
      checkSectorCrossings(k, lat, lon);
      // Armierung: solange noch keine Runde laeuft, erste gueltige Linie startet
      // die Uhr. triggerLap handhabt das (k.lapStart null -> nur Start-Zweig).
    }
    // Vorgaenger-GPS-Punkt dieses Karts immer pflegen (Richtungscheck).
    if (lat && lon) {
      k.autoLap.prevLat = lat;
      k.autoLap.prevLon = lon;
    }
    // Renn-Speed-Trace pro Teilnehmer (downsampled).
    if (_isPart) {
      const part = _r.participants[_mac];
      part.speedTrace = part.speedTrace || [];
      if (k.connection.packets % 5 === 0) {
        part.speedTrace.push({ t: Date.now() - (_r.startedAt || Date.now()), speed, rpm });
        if (part.speedTrace.length > 4000) part.speedTrace.shift();
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
// Phase 42: Accessoren fuer gauges.js -- ESM-Importe von let-Variablen sind
// read-only Momentaufnahmen, deshalb Funktions-API statt Direktzugriff.
function kart3dIsReady() { return _kart3dReady; }
function kart3dTickDt(now) {
  const dtMs = _kart3dLastTick ? (now - _kart3dLastTick) : 16;
  _kart3dLastTick = now;
  return dtMs;
}
// Phase 42: recording.js setzt die Fusions-Uhr beim Replay-Reset zurueck --
// ESM-Importe sind read-only, deshalb Setter statt Direktzuweisung.
function resetAttitudeClock() { _attLastMs = 0; }

function initGViewToggle() {
  const wrap = $('gViewToggle');
  const c2d = $('gMeterCanvas');
  const c3d = $('gMeter3dCanvas');
  if (!wrap || !c2d || !c3d) return;

  // Try to bring up the 3D backend exactly once.
  try {
    _kart3dReady = !!RasiKart3D.init(c3d, { gScale: state.settings.gScale });
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
        rcToast('3D nicht verfügbar — WebGL fehlt');
        return;
      }
      const next = RasiKart3D.gViewReducer(state.settings.gView, 'set:' + target);
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
  if (is3d) {
    _kart3dLastTick = 0;  // reset dispatch clock so first frame uses the 16ms fallback
    RasiKart3D.start();
  } else {
    RasiKart3D.stop();
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
    if (!_kart3dReady) return;
    return RasiKart3D.loadCustomModel(res.buffer.buffer, persistedYaw).then((r) => {
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
    if (!_kart3dReady) {
      // File is on disk but 3D backend is unavailable (e.g. no WebGL). Reflect
      // that the upload succeeded so the user knows the next start will pick it up.
      name.textContent = f.name + ' (gespeichert — WebGL nicht verfügbar)';
      rcToast('Gespeichert — Modell wird beim nächsten Start geladen');
      return;
    }
    const loadRes = await RasiKart3D.loadCustomModel(buf, Number(state.settings.kartModelYaw) || 0);
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
      RasiKart3D.setHeadingOffset(next);
    });
  });

  // Reset-button handler.
  resetB.addEventListener('click', async () => {
    const yes = await rcConfirm('Eigenes Modell auf Standard zurücksetzen?', 'Zurücksetzen', 'Zurücksetzen', true);
    if (!yes) return;
    await window.rasiKart.clearKartModel();
    RasiKart3D.resetToPrimitive();
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
  migrateLegacyKartMeta();
  // Persistierte Session-Bounds heilen: eng aus den Punkten neu ableiten
  // (alte Daten koennen GPS-Ausreisser in den Bounds tragen, Phase 26).
  if (state.track.points.length) recomputeTrackBounds();
  try {
    RasiTileRenderer.init({
      getSettings: function () { return state.settings.tiles || { enabled: false, urlTemplate: '', liveQuickToggle: true }; },
      redraw: function () { try { drawTrack(); } catch (e) {} },
    });
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
  // Persistierte Rennen-Aufnahmen laden (Replay-Buttons nach Neustart)
  initRecStore();
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
    const k = activeKart();
    k.heatmap.on = !k.heatmap.on;
    $('heatmapBtn').classList.toggle('active', k.heatmap.on);
    drawTrack();
  };
  // Track tab buttons
  $('scanTrackBtn').onclick = () => state.track.scanning ? finishTrackScan(false) : startTrackScan();
  $('clearTrackBtn').onclick = clearTrack;
  $('saveTrackBtn').onclick = saveCurrentTrack;
  $('setSector2Btn').onclick = () => activateSectorClick(0);
  $('setSector3Btn').onclick = () => activateSectorClick(1);
  $('clearSectorsBtn').onclick = clearManualSectors;
  if (trackCanvas()) trackCanvas().addEventListener('click', handleTrackCanvasClick);
  if (scanCanvas()) scanCanvas().addEventListener('click', handleTrackCanvasClick);
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
    const k = activeKart();
    k.calibration.rollZero = k.calibration.rollZero + ((k.attitude && k.attitude.rollDeg) || 0);
    k.attitude.rollDeg = 0;
    k.attitude.overState = { active: false };
    k.attitude.over = false;
    saveData();
    rcToast('Rollwinkel genullt', 1500);
  };
  $('zeroImuBtn').onclick = () => {
    const btn = $('zeroImuBtn');
    if (btn.disabled) return;
    const original = btn.textContent;
    btn.disabled = true;
    // Sender-seitige Kalibrierung mitstarten (an den ausgewaehlten Kart)
    try {
      bridgeSend({ type: 'imu_calibrate', action: 'auto', duration_ms: 2000 });
    } catch(e) { console.warn('imu_calibrate send:', e); }
    // Client-seitig: 2 Sekunden lang Samples mitteln
    const samples = [];
    const start = Date.now();
    const duration = 2000;
    const tick = setInterval(() => {
      const elapsed = Date.now() - start;
      const k = activeKart();
      samples.push({ x: k.raw.gx || 0, y: k.raw.gy || 0 });
      const remain = Math.max(0, duration - elapsed) / 1000;
      btn.textContent = `Kart still halten… ${remain.toFixed(1)}s`;
      if (elapsed >= duration) {
        clearInterval(tick);
        if (samples.length >= 5) {
          const avgX = samples.reduce((s,p) => s + p.x, 0) / samples.length;
          const avgY = samples.reduce((s,p) => s + p.y, 0) / samples.length;
          k.calibration.gxZero = avgX;
          k.calibration.gyZero = avgY;
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
    activeKart().calibration.gxZero = 0;
    activeKart().calibration.gyZero = 0;
    loadSettingsToUi();
    saveData();
    // Sender-Offsets ebenfalls zuruecksetzen (am ausgewaehlten Kart)
    try {
      bridgeSend({ type: 'imu_calibrate', action: 'reset' });
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
      batt_cells: Number($('espBattCells').value) || 1,
      batt_warn_v: Number($('espBattWarnV').value) || 3.5,
      batt_crit_v: Number($('espBattCritV').value) || 3.3,
      batt_cal: Number($('espBattCal').value) || 1.0,
      rpm_ceiling: Math.max(0, Number($('espRpmCeiling').value) || 0),
      rpm_alpha: Number($('espRpmAlpha').value) || 0.25,
      page_ms: Number($('espPageMs').value) || 4000,
    };
    activeKart().batt.cells = cfg.batt_cells;
    if (!state.serial.connected) {
      setText('espSendStatus', 'Nicht verbunden');
      return;
    }
    try {
      bridgeSend(cfg);
      setText('espSendStatus', '✓ Gesendet — warte auf Bestätigung…');
      clearTimeout(_espAckTimer);
      _espAckTimer = setTimeout(() => {
        setText('espSendStatus', '⚠ Keine Bestätigung vom Kart — Funkverbindung prüfen');
      }, 3000);
    } catch (e) {
      setText('espSendStatus', '✗ Fehler');
    }
  };
  $('exportAllBtn').onclick = exportAll;
  $('importAllBtn').onclick = () => $('importAllFile').click();
  $('importAllFile').onchange = e => { if (e.target.files[0]) importAll(e.target.files[0]); e.target.value = ''; };
  $('resetAllBtn').onclick = resetAll;
  initUpdateUi();
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
    replayRace:       id => replayRace(id),
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

  // Crash-Recovery (Phase 24): liegt die Sicherungsdatei vom letzten Lauf
  // noch da, war es ein Absturz (regulaeres Beenden loescht sie in main.js).
  if (window.rasiRec) {
    window.rasiRec.check().then(async (c) => {
      if (!c || !c.exists) return;
      if (c.size < 1024) { window.rasiRec.clear().catch(() => {}); return; }
      const when = c.mtimeMs ? new Date(c.mtimeMs).toLocaleString('de-DE') : 'unbekannt';
      const ok = await rcConfirm(
        `Unvollständige Aufnahme vom letzten Lauf gefunden\n(${when}, ${formatBytes(c.size)}).\nJetzt im Replay laden?`,
        'Aufnahme wiederherstellen', 'Laden');
      if (!ok) { window.rasiRec.clear().catch(() => {}); return; }
      const r = await window.rasiRec.read();
      if (!r.ok) { rcAlert('Wiederherstellung fehlgeschlagen:\n' + (r.error || '?')); return; }
      const parsed = RasiReplay.parseRecording(r.text);
      if (!parsed.ok || parsed.packets.length < 2) {
        rcAlert('Sicherungsdatei unbrauchbar — wird verworfen.');
        window.rasiRec.clear().catch(() => {});
        return;
      }
      if (parsed.skipped) rcToast(parsed.skipped + ' fehlerhafte Zeilen übersprungen', 3000);
      enterReplay(parsed);
      window.rasiRec.clear().catch(() => {});
    }).catch(() => {});
  }
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
      // Fahrername im Haupt-Layout spiegeln. Die pw*-Felder gehoeren
      // allein updatePitWall() (pit-wall.js) -- der fruehere Spiegel hier
      // ueberschrieb sekuendlich Lap-Hold, Rundenziel und Status-Farbe
      // (u.a. mit dem Race-Status statt der Verbindung).
      try {
        {
          const r = activeRace();
          if (r) {
            const stints = activePart(r).stints || [];
            const last = stints[stints.length-1];
            if (last && !last.endAt) {
              const driver = state.drivers.find(d=>d.id===last.driverId);
              txt('currentDriverName', driver ? driver.name : '--');
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
          const hasFix = activeKart().gps?.lat != null;
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
      detail:['Detail','Verlauf, Stints & Rundentabelle des aktiven Rennens'],
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
    const audioBtnEl = $$('audioBtn');
    const updateAudioIcon = () => {
      // CSS blendet je nach .muted das passende SVG ein (statt Emoji-Swap)
      audioBtnEl?.classList.toggle('muted', !rcAudio.isEnabled());
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

// ESM-Export (Phase 42): Kern-API fuer die src/-Module (bisherige
// appCoreGlobals aus eslint.config.js + Phase-42-Accessoren).
export {
  $, css, dpr, uid, esc, setText,
  rcAlert, rcConfirm, rcToast, rcAudio,
  formatBytes,
  setTextShared, setHtmlShared, logTime,
  processTelemetry, armRecording, driftInputs,
  resetAttitudeClock,
  kart3dIsReady, kart3dTickDt,
};
