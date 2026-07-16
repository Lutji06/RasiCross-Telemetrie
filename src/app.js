// Styles zuerst (Phase 49): reiner CSS-Import, fuehrt kein JS aus.
// Die Regel "app-init.js MUSS erster Import sein" (unten) betrifft
// nur Module mit Ausfuehrungsreihenfolge.
import './styles/index.css';
// RasiCross Entry (Phase 42): laedt alle Module in der Reihenfolge der
// frueheren <script>-Tags. app-init.js bootet sich beim Import selbst
// (Top-Level init(); die Tags standen am Body-Ende, das DOM ist geparst).
//
// app-init.js MUSS als allererster Import stehen (Phase 44): es zieht
// rasicross.js (und alles andere) vollstaendig durch, BEVOR sein eigener
// Top-Level-init()-Aufruf feuert -- entspricht dem alten Selbst-Boot am
// rasicross-Dateiende. Der Re-Export-Ring rasicross.js <-> kart3d-ui.js
// (kart3dIsReady/kart3dTickDt) ist deklarationsrein und daher
// reihenfolge-unkritisch -- s. .superpowers/sdd/task-4-report.md.
import './app-init.js';
// ui-glue.js NACH app-init.js: der Sidebar-Spiegel-IIFE lief bisher direkt
// nach dem init()-Aufruf am Dateiende von app-init.js/rasicross.js.
import './ui-glue.js';
import './geo.js';
import './replay.js';
import './lap-engine.js';
import './kart-rank.js';
import './drift.js';
import './attitude.js';
import '../tiles.js';
import './tile-renderer.js';
import './dom-targets.js';
import './settings.js';
import './engine.js';
import './rec-store.js';
import './karts3d.js';
import './map-draw.js';
import './races.js';
import './serial-demo.js';
import './gauges.js';
import './track.js';
import './laps-drivers.js';
import './live-ui.js';
import './pit-wall.js';
import './recording.js';
import './kart-registry.js';
import './rasicross.js';
import './kart-bar.js';
import './kart-overview.js';
import './karts-page.js';
import './kart-settings-window.js';

import { state, saveData, activeKart, armRecording,
         updateKartMeta, kartRosterMacs, rcAlert, rcConfirm } from './rasicross.js';
import { activeRace, toggleRaceRun, endRace } from './races.js';
import { buildRaceDataForKart } from './pit-wall.js';
import { enterReplay, exitReplay } from './recording.js';
import RasiReplay from './replay.js';

// Quit-Pfad: main.js before-quit ruft saveData() per executeJavaScript --
// muss als window-Global erreichbar bleiben.
window.saveData = saveData;
// Explizite Test-Bruecke fuer die Playwright-Smoke-Suite (Phase 41).
window.RasiTest = {
  state, activeKart, armRecording,
  updateKartMeta, kartRosterMacs,
  activeRace, toggleRaceRun, endRace,
  buildRaceDataForKart, RasiReplay, enterReplay, exitReplay,
  // Dialog-Trigger fuer die Screenshot-Suite (Phase 50): oeffnen das
  // echte Overlay deterministisch, ohne UI-Klickpfade zu koppeln.
  rcAlert, rcConfirm,
};
