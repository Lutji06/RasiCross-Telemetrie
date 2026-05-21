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
  structuralRaceKey: 'readonly',
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

  // Dashboard-Renderer (Browser) -- nutzt die UMD-Globals
  {
    files: ['rasicross.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: {
        ...globals.browser,
        ...geoGlobals,
        THREE: 'readonly',
        RasiReplay: 'readonly',
        RasiKart3D: 'readonly',
      },
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
