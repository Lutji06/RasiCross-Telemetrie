// ESLint Flat-Config (ESLint 9) -- fehler-orientiert, kein Style-Nitpicking.
// Faengt toten Code, ungenutzte Variablen, doppelte Object-Keys und
// Tippfehler bei globalen Namen ab. vendor/ (Drittcode: three.js) und
// Build-Ausgaben sind ausgenommen.
'use strict';

const js = require('@eslint/js');
const globals = require('globals');

// Namen, die geo.js zur Laufzeit per UMD-Export auf window legt.
const geoGlobals = {
  fmtMs: 'readonly', fmtClock: 'readonly', fmtDelta: 'readonly',
  gpsDist: 'readonly', traceDistanceM: 'readonly',
  headingFromPoints: 'readonly', segmentsCross: 'readonly',
  crossingDirectionOk: 'readonly', lineEndpointsFromGate: 'readonly',
  structuralRaceKey: 'readonly', ghostPointAt: 'readonly',
};

// Kern-Helfer + State, die rasicross.js global definiert und die die
// ausgelagerten App-Scripts (map-draw/races/serial-demo) mitbenutzen.
const appCoreGlobals = {
  state: 'readonly', $: 'readonly', css: 'readonly', dpr: 'readonly',
  uid: 'readonly', esc: 'readonly', setText: 'readonly',
  rcAlert: 'readonly', rcConfirm: 'readonly', rcToast: 'readonly',
  saveData: 'readonly', saveDataDebounced: 'readonly',
  rcAudio: 'readonly', formatBytes: 'readonly',
  setTextShared: 'readonly', setHtmlShared: 'readonly',
  logTime: 'readonly', SAVE_KEY: 'readonly',
};
// Schnittstelle map-draw.js -> Nutzer (rasicross.js u.a.)
const mapDrawGlobals = {
  initTrackCanvases: 'readonly', resizeCanvases: 'readonly',
  gpsXYOnCanvas: 'readonly', drawTrack: 'readonly', drawTrackOn: 'readonly',
  drawLineOn: 'readonly', drawGhostOn: 'readonly', drawHeatmapOn: 'readonly',
  _trackCanvas: 'readonly', _scanCanvas: 'readonly',
};
// Schnittstelle races.js -> Nutzer (rasicross.js, serial-demo.js)
const racesGlobals = {
  activeRace: 'readonly', currentStint: 'readonly', raceValidLaps: 'readonly',
  raceElapsedMs: 'readonly', createRace: 'readonly', startRace: 'readonly',
  endRace: 'readonly', pauseRace: 'readonly', toggleRaceRun: 'readonly',
  openDriverChange: 'readonly', confirmDriverChange: 'readonly',
  closeDriverModal: 'readonly', selectRace: 'readonly', setActiveRace: 'readonly',
  toggleRaceExpand: 'readonly', deleteRace: 'readonly',
  drawRaceHistoryChart: 'readonly', renderRaces: 'readonly',
  renderTrackOptions: 'readonly', updateRaceControls: 'readonly',
  activePart: 'readonly',
};
// Schnittstelle serial-demo.js -> Nutzer (rasicross.js)
const serialDemoGlobals = {
  listSerialPorts: 'readonly', connectSerial: 'readonly',
  disconnectSerial: 'readonly', startDemo: 'readonly', stopDemo: 'readonly',
  stopReconnect: 'readonly', scheduleReconnect: 'readonly',
  handleSerialLine: 'readonly', generateDemoTrack: 'readonly',
};
// Schnittstelle gauges.js -> Nutzer (rasicross.js, live-ui.js)
const gaugesGlobals = {
  renderDriftBadge: 'readonly', renderRollBar: 'readonly', lerp: 'readonly',
  renderGauges: 'readonly', drawGMeter: 'readonly',
};
// Schnittstelle track.js -> Nutzer (rasicross.js, serial-demo.js, races.js, recording.js)
const trackGlobals = {
  startTrackScan: 'readonly', finishTrackScan: 'readonly', clearTrack: 'readonly',
  updateBounds: 'readonly', onGpsUpdate: 'readonly', recomputeTrackBounds: 'readonly',
  saveCurrentTrack: 'readonly', syncSectorBestToTrack: 'readonly',
  loadSavedTrack: 'readonly', deleteSavedTrack: 'readonly',
  refreshTrackTileStatus: 'readonly', startTrackTileCache: 'readonly',
  renderSavedTracks: 'readonly', openTrackEditor: 'readonly',
  closeTrackEditor: 'readonly', editorClickTarget: 'readonly',
  handleEditorClick: 'readonly', saveEditor: 'readonly',
  calcAutoSectors: 'readonly', clearManualSectors: 'readonly',
  activateSectorClick: 'readonly', handleTrackCanvasClick: 'readonly',
  checkSectorCrossings: 'readonly', updateSectorPanel: 'readonly',
};
// Schnittstelle laps-drivers.js -> Nutzer (rasicross.js, races.js, serial-demo.js)
const lapsDriversGlobals = {
  checkLapCrossing: 'readonly', triggerLap: 'readonly',
  renderLapTable: 'readonly', renderLiveLapList: 'readonly',
  getDriverStats: 'readonly', getTotalStats: 'readonly', fmtKm: 'readonly',
  addDriver: 'readonly', deleteDriver: 'readonly', renderTotalHero: 'readonly',
  renderDrivers: 'readonly', renderDriverOptions: 'readonly',
  theoreticalBestMs: 'readonly',
};
// Schnittstelle live-ui.js -> Nutzer (rasicross.js, races.js, pit-wall.js, recording.js)
const liveUiGlobals = {
  initLiveCharts: 'readonly', resizeChartCanvas: 'readonly', drawChart: 'readonly',
  axisFmt: 'readonly', drawLiveCharts: 'readonly', drawYawSparkline: 'readonly',
  updateLiveDelta: 'readonly', updateLiveKPIs: 'readonly',
  updateDiagnostics: 'readonly', updateLiveUi: 'readonly', renderStints: 'readonly',
  animLoop: 'readonly', initLiveUiLoops: 'readonly',
};
// Schnittstelle pit-wall.js -> Nutzer (rasicross.js, serial-demo.js, live-ui.js)
const pitWallGlobals = {
  openPitWall: 'readonly', closePitWall: 'readonly', pwKeyHandler: 'readonly',
  updatePitWall: 'readonly', renderConnectionTab: 'readonly',
  pushPacketLog: 'readonly', toggleDiagnose: 'readonly',
  buildRaceDataForKart: 'readonly', sendDisplayUpdate: 'readonly',
  restartDisplayUpdateInterval: 'readonly', sendPitCall: 'readonly',
  cancelPitCall: 'readonly', togglePitCall: 'readonly',
};
// Schnittstelle recording.js -> Nutzer (rasicross.js, serial-demo.js)
const recordingGlobals = {
  exportAll: 'readonly', importAll: 'readonly', resetAll: 'readonly',
  updateRecStatus: 'readonly', saveRecording: 'readonly',
  exportRecordingCsv: 'readonly', loadRecordingFile: 'readonly',
  enterReplay: 'readonly', exitReplay: 'readonly', replaySeek: 'readonly',
  setReplaySpeed: 'readonly', toggleReplayPlay: 'readonly',
  renderReplayBar: 'readonly', feedReplayPacket: 'readonly',
  fastForwardTo: 'readonly',
  initRecStore: 'readonly', persistRaceRecording: 'readonly',
  discardRaceRecording: 'readonly',
  raceHasRecording: 'readonly', replayRace: 'readonly',
};
// Schnittstelle kart-registry.js -> Nutzer (UMD: window.KartRegistry)
const kartRegistryGlobals = { KartRegistry: 'readonly' };
// Schnittstelle kart-bar.js -> Nutzer (window.RasiKartBar)
const kartBarGlobals = { RasiKartBar: 'readonly' };
// Schnittstelle kart-overview.js -> Nutzer (window.RasiKartOverview)
const kartOverviewGlobals = { RasiKartOverview: 'readonly' };
// Schnittstelle lap-engine.js -> Nutzer (window.RasiLapEngine)
const lapEngineGlobals = { RasiLapEngine: 'readonly' };

const bugRules = {
  ...js.configs.recommended.rules,
  // Ungenutzte Funktionsargumente und catch-Bindungen sind hier
  // idiomatisch (Event-Handler, leere catch-Bloecke) -- kein Fehler.
  'no-unused-vars': ['error', { args: 'none', caughtErrors: 'none' }],
  // Leere catch-Bloecke sind ein bewusstes Idiom (Fehler absichtlich
  // verschluckt); leere if/for/while-Bloecke bleiben ein Fehler.
  'no-empty': ['error', { allowEmptyCatch: true }],
  // Funktionen duerfen gleichnamige Browser-Globals (stop, start, ...)
  // ueberdecken -- hier gewollt, kein versehentliches Redeclare.
  'no-redeclare': ['error', { builtinGlobals: false }],
};

module.exports = [
  { ignores: ['vendor/**', 'dist/**', 'out/**', 'node_modules/**'] },

  // Electron-Hauptprozess + Preload (Node, CommonJS)
  {
    files: ['main.js', 'preload.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: { ...globals.node },
    },
    rules: bugRules,
  },

  // Pure UMD-Module -- laufen im Browser und unter node:test
  {
    files: ['geo.js', 'replay.js', 'lap-engine.js', 'karts3d.js', 'kart-registry.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: { ...globals.browser, module: 'readonly', THREE: 'readonly' },
    },
    rules: bugRules,
  },

  // kart-bar.js — Kart-Chip-Leiste (Browser-Script, window.RasiKartBar)
  {
    files: ['kart-bar.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: { ...globals.browser, ...appCoreGlobals, ...kartRegistryGlobals,
                 setLiveView: 'readonly' },
    },
    rules: bugRules,
  },

  // kart-overview.js — Live-Übersicht-Grid (Browser-Script, window.RasiKartOverview)
  {
    files: ['kart-overview.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: { ...globals.browser, ...geoGlobals, ...appCoreGlobals,
                 ...kartRegistryGlobals, ...kartBarGlobals, ...racesGlobals,
                 ...lapEngineGlobals, setLiveView: 'readonly' },
    },
    rules: bugRules,
  },

  // map-draw.js — klassisches App-Script, gemeinsamer Global-Scope
  {
    files: ['map-draw.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: { ...globals.browser, ...geoGlobals, ...appCoreGlobals,
                 RasiTiles: 'readonly', RasiTileRenderer: 'readonly' },
    },
    rules: bugRules,
  },

  // races.js — klassisches App-Script, gemeinsamer Global-Scope
  {
    files: ['races.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: { ...globals.browser, ...geoGlobals, ...appCoreGlobals,
                 ...kartRegistryGlobals, ...lapEngineGlobals, activeKart: 'readonly',
                 loadSavedTrack: 'readonly', updateSectorPanel: 'readonly',
                 drawChart: 'readonly', renderDriverOptions: 'readonly',
                 raceHasRecording: 'readonly',
                 persistRaceRecording: 'readonly',
                 discardRaceRecording: 'readonly' },
    },
    rules: bugRules,
  },

  // serial-demo.js — klassisches App-Script, gemeinsamer Global-Scope
  {
    files: ['serial-demo.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: { ...globals.browser, ...geoGlobals, ...appCoreGlobals,
                 ...racesGlobals, drawTrack: 'readonly',
                 armRecording: 'readonly', processTelemetry: 'readonly',
                 onGpsUpdate: 'readonly', pushPacketLog: 'readonly',
                 renderDrivers: 'readonly', renderDriverOptions: 'readonly',
                 updateBounds: 'readonly', calcAutoSectors: 'readonly',
                 updateSectorPanel: 'readonly' },
    },
    rules: bugRules,
  },

  // gauges.js — klassisches App-Script, gemeinsamer Global-Scope
  {
    files: ['gauges.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: { ...globals.browser, ...geoGlobals, ...appCoreGlobals,
                 // 3D-Viewer-Tick-State (live-ui.js): drawGMeter treibt den
                 // Kart-3D-Render-Tick mit an.
                 _kart3dReady: 'readonly', _kart3dLastTick: 'writable' },
    },
    rules: bugRules,
  },

  // track.js — klassisches App-Script, gemeinsamer Global-Scope
  {
    files: ['track.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: { ...globals.browser, ...geoGlobals, ...appCoreGlobals,
                 ...lapEngineGlobals, ...kartRegistryGlobals,
                 ...mapDrawGlobals, ...racesGlobals,
                 activeKart: 'readonly',
                 theoreticalBestMs: 'readonly', RasiTiles: 'readonly',
                 RasiTileRenderer: 'readonly' },
    },
    rules: bugRules,
  },

  // laps-drivers.js — klassisches App-Script, gemeinsamer Global-Scope
  {
    files: ['laps-drivers.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: { ...globals.browser, ...geoGlobals, ...appCoreGlobals,
                 ...lapEngineGlobals, ...kartRegistryGlobals, activeKart: 'readonly',
                 ...mapDrawGlobals, ...racesGlobals, ...trackGlobals },
    },
    rules: bugRules,
  },

  // live-ui.js — klassisches App-Script, gemeinsamer Global-Scope
  {
    files: ['live-ui.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: { ...globals.browser, ...geoGlobals, ...appCoreGlobals,
                 ...mapDrawGlobals, ...racesGlobals, ...trackGlobals,
                 ...gaugesGlobals, ...lapsDriversGlobals,
                 renderConnectionTab: 'readonly', updatePitWall: 'readonly',
                 sendDisplayUpdate: 'readonly',
                 // 3D-Viewer-Tick-State (deklariert in rasicross.js)
                 _kart3dReady: 'writable', _kart3dLastTick: 'writable',
                 _attLastMs: 'writable',
                 RasiKart3D: 'readonly', RasiDrift: 'readonly',
                 RasiAttitude: 'readonly', DomTargets: 'readonly',
                 RasiEngine: 'readonly', updateEngineUi: 'readonly',
                 ...kartBarGlobals, ...kartOverviewGlobals,
                 activePart: 'readonly', ...lapEngineGlobals },
    },
    rules: bugRules,
  },

  // pit-wall.js — klassisches App-Script, gemeinsamer Global-Scope
  {
    files: ['pit-wall.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: { ...globals.browser, ...geoGlobals, ...appCoreGlobals,
                 ...racesGlobals, ...lapsDriversGlobals, ...liveUiGlobals,
                 ...kartBarGlobals, ...kartRegistryGlobals, ...lapEngineGlobals },
    },
    rules: bugRules,
  },

  // recording.js — klassisches App-Script, gemeinsamer Global-Scope
  {
    files: ['recording.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: { ...globals.browser, ...geoGlobals, ...appCoreGlobals,
                 ...mapDrawGlobals, ...racesGlobals, ...serialDemoGlobals,
                 ...trackGlobals, ...lapsDriversGlobals, ...liveUiGlobals,
                 ...gaugesGlobals, ...pitWallGlobals,
                 RasiReplay: 'readonly', RasiDrift: 'readonly',
                 RasiAttitude: 'readonly', RasiRecStore: 'readonly',
                 processTelemetry: 'readonly', recordPacket: 'readonly',
                 armRecording: 'readonly', driftInputs: 'readonly',
                 // Attitude-Fusion-Tick (deklariert in rasicross.js) --
                 // Replay-Reset setzt ihn zurueck.
                 _attLastMs: 'writable', ...kartRegistryGlobals },
    },
    rules: bugRules,
  },

  // Dashboard-Renderer (Browser) -- nutzt die UMD-Globals
  {
    files: ['rasicross.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: {
        ...globals.browser,
        ...geoGlobals, ...lapEngineGlobals,
        ...mapDrawGlobals,
        ...racesGlobals,
        ...serialDemoGlobals,
        ...gaugesGlobals,
        ...trackGlobals,
        ...lapsDriversGlobals,
        ...liveUiGlobals,
        ...pitWallGlobals,
        ...recordingGlobals,
        THREE: 'readonly',
        RasiReplay: 'readonly',
        RasiKart3D: 'readonly',
        DomTargets: 'readonly',
        RasiTiles: 'readonly',
        RasiTileRenderer: 'readonly',
        RasiDrift: 'readonly',
        RasiAttitude: 'readonly',
        RasiSettings: 'readonly',
        RasiEngine: 'readonly',
        RasiRecStore: 'readonly',
        ...kartRegistryGlobals,
        ...kartBarGlobals,
      },
    },
    rules: bugRules,
  },

  // drift.js setzt window.RasiDrift (UMD, Browser + node:test)
  {
    files: ['drift.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: { ...globals.browser, module: 'readonly' },
    },
    rules: bugRules,
  },

  // attitude.js setzt window.RasiAttitude (UMD, Browser + node:test)
  {
    files: ['attitude.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: { ...globals.browser, module: 'readonly' },
    },
    rules: bugRules,
  },

  // dom-targets.js setzt window.DomTargets (UMD, Browser)
  {
    files: ['dom-targets.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: { ...globals.browser, module: 'readonly' },
    },
    rules: bugRules,
  },

  // settings.js setzt window.RasiSettings (UMD, Browser + node:test)
  {
    files: ['settings.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: { ...globals.browser, module: 'readonly' },
    },
    rules: bugRules,
  },

  // engine.js setzt window.RasiEngine (UMD, Browser + node:test)
  {
    files: ['engine.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: { ...globals.browser, module: 'readonly' },
    },
    rules: bugRules,
  },

  // rec-store.js — IndexedDB-Wrapper (window.RasiRecStore), reines IO
  {
    files: ['rec-store.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: { ...globals.browser },
    },
    rules: bugRules,
  },

  // tile-renderer.js — UMD module, uses window/document/fetch + window.rasiTiles
  {
    files: ['tile-renderer.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: { ...globals.browser, module: 'readonly', RasiTiles: 'readonly' },
    },
    rules: bugRules,
  },

  // Test-Dateien (node:test)
  {
    files: ['test/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: { ...globals.node },
    },
    rules: bugRules,
  },
];
