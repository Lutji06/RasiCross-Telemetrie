// ============================================================
//  RasiCross — app-init.js  (Boot, Init-Bindings, 3D-Setup, Phase 44)
//  Herausgeloest aus rasicross.js — NUR bewegt, nicht geaendert.
// ============================================================

import { initTrackCanvases, resizeCanvases, drawTrack,
         trackCanvas, scanCanvas } from './map-draw.js';
import { activeRace, activePart, closeDriverModal, confirmDriverChange,
         createRace, deleteRace, endRace, openDriverChange, renderRaces,
         renderTrackOptions, selectRace, setActiveRace, toggleRaceExpand,
         toggleRaceRun, updateRaceControls } from './races.js';
import { connectSerial, disconnectSerial, listSerialPorts,
         startDemo, stopDemo } from './serial-demo.js';
import { activateSectorClick, clearManualSectors,
         clearTrack, closeTrackEditor, deleteSavedTrack, editorClickTarget,
         finishTrackScan, handleTrackCanvasClick, loadSavedTrack,
         openTrackEditor, recomputeTrackBounds, renderSavedTracks,
         saveCurrentTrack, saveEditor, startTrackScan,
         updateSectorPanel } from './track.js';
import { addDriver, deleteDriver, renderDriverOptions,
         renderDrivers, renderLapTable } from './laps-drivers.js';
import { animLoop, initLiveCharts, initLiveUiLoops } from './live-ui.js';
import { closePitWall, openPitWall, restartDisplayUpdateInterval,
         sendDisplayUpdate, toggleDiagnose, togglePitCall } from './pit-wall.js';
import { enterReplay, exitReplay, exportAll, exportRecordingCsv, importAll,
         initRecStore, loadRecordingFile, replayRace, replaySeek, resetAll,
         saveRecording, setReplaySpeed, toggleReplayPlay,
         updateRecStatus } from './recording.js';
import RasiKart3D from './karts3d.js';
import RasiReplay from './replay.js';
import RasiSettings from './settings.js';
import RasiTileRenderer from './tile-renderer.js';
import { state, activeKart, saveData, saveDataDebounced, loadData, migrateLegacyKartMeta } from './store.js';
import { armEspAckTimer } from './esp-config.js';
import { applyTilesPresetFromUrl, onTilesPresetChanged, updateTilesUrlHint,
         onTilesClearClicked, showSettingsGroup, loadSettingsToUi,
         initUpdateUi, scheduleSettingsSave } from './settings-ui.js';
import { $, setText, rcAlert, rcConfirm, rcToast, rcAudio, formatBytes,
         bridgeSend, applyTheme, setupTabs, toggleTheme } from './rasicross.js';

// 3D-Viewer instance state (single global; rAF lifecycle managed by start/stop).
// Geteilt mit gauges.js (drawGMeter-Tick) und live-ui.js (updateLiveKPIs).
let _kart3dReady = false;
let _kart3dLastTick = 0;
// Phase 42: Accessoren fuer gauges.js -- ESM-Importe von let-Variablen sind
// read-only Momentaufnahmen, deshalb Funktions-API statt Direktzugriff.
function kart3dIsReady() { return _kart3dReady; }
function kart3dTickDt(now) {
  const dtMs = _kart3dLastTick ? (now - _kart3dLastTick) : 16;
  _kart3dLastTick = now;
  return dtMs;
}

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
      armEspAckTimer(3000, () => {
        setText('espSendStatus', '⚠ Keine Bestätigung vom Kart — Funkverbindung prüfen');
      });
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

export { kart3dIsReady, kart3dTickDt };
