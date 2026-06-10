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
    files: ['geo.js', 'replay.js', 'karts3d.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: { ...globals.browser, module: 'readonly', THREE: 'readonly' },
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
                 loadSavedTrack: 'readonly', updateSectorPanel: 'readonly',
                 drawChart: 'readonly', renderDriverOptions: 'readonly' },
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

  // Dashboard-Renderer (Browser) -- nutzt die UMD-Globals
  {
    files: ['rasicross.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: {
        ...globals.browser,
        ...geoGlobals,
        ...mapDrawGlobals,
        ...racesGlobals,
        ...serialDemoGlobals,
        ...gaugesGlobals,
        THREE: 'readonly',
        RasiReplay: 'readonly',
        RasiKart3D: 'readonly',
        DomTargets: 'readonly',
        RasiTiles: 'readonly',
        RasiTileRenderer: 'readonly',
        RasiDrift: 'readonly',
        RasiAttitude: 'readonly',
        RasiSettings: 'readonly',
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
