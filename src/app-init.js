// ============================================================
//  RasiCross — app-init.js  (Boot + Init-Bindings, Phase 44)
//  Herausgeloest aus rasicross.js — NUR bewegt, nicht geaendert.
// ============================================================

import { initTrackCanvases, resizeCanvases, drawTrack,
         trackCanvas, scanCanvas } from './map-draw.js';
import { closeDriverModal, confirmDriverChange,
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
import RasiReplay from './replay.js';
import RasiSettings from './settings.js';
import RasiTileRenderer from './tile-renderer.js';
import { state, activeKart, saveData, saveDataDebounced, loadData, migrateLegacyKartMeta } from './store.js';
import { applyTilesPresetFromUrl, onTilesPresetChanged, updateTilesUrlHint,
         onTilesClearClicked, showSettingsGroup, loadSettingsToUi,
         initUpdateUi, scheduleSettingsSave } from './settings-ui.js';
import { $, setText, rcAlert, rcConfirm, rcToast, formatBytes,
         applyTheme, setupTabs, toggleTheme } from './rasicross.js';
import { initGViewToggle, initKartModelUploader } from './kart3d-ui.js';
import { initKartSettingsWindows } from './kart-settings-window.js';

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
  initKartSettingsWindows();
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
