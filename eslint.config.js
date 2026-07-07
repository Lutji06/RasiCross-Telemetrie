// ESLint Flat-Config (ESLint 9) -- fehler-orientiert, kein Style-Nitpicking.
// Faengt toten Code, ungenutzte Variablen, doppelte Object-Keys und
// Tippfehler bei Namen ab. Seit Phase 42 sind die Renderer-Scripts
// ES-Module unter src/ -- no-undef prueft echte Imports, die frueheren
// Interface-Global-Listen sind entfallen.
'use strict';

const js = require('@eslint/js');
const globals = require('globals');

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
  { ignores: ['dist/**', 'release/**', 'out/**', 'node_modules/**'] },

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

  // tiles.js -- einzige geteilte UMD/CJS-Datei (main.js per require,
  // Renderer per Vite-CJS-Interop). Bleibt bewusst im Root.
  {
    files: ['tiles.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: { ...globals.browser, module: 'readonly', require: 'readonly' },
    },
    rules: bugRules,
  },

  // Vite-Konfig (ESM, Node)
  {
    files: ['vite.config.mjs'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.node },
    },
    rules: bugRules,
  },

  // Playwright-Smoke-Suite (Phase 41) -- Node/CommonJS; die evaluate-
  // Callbacks laufen im Renderer und nutzen die RasiTest-Bruecke (Phase 42).
  {
    files: ['e2e/**/*.js', 'playwright.config.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: {
        ...globals.node, ...globals.browser,
        RasiTest: 'readonly',
      },
    },
    rules: bugRules,
  },

  // Renderer-Module (Phase 42): echte Imports, keine Interface-Globals.
  {
    files: ['src/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.browser },
    },
    rules: bugRules,
  },

  // Test-Dateien (node:test, ESM via test/package.json)
  {
    files: ['test/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.node },
    },
    rules: bugRules,
  },
];
