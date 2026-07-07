// RasiCross Entry (Phase 42): laedt alle Module in der Reihenfolge der
// frueheren <script>-Tags. rasicross.js bootet sich beim Import selbst
// (Top-Level init(); die Tags standen am Body-Ende, das DOM ist geparst).
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

import { state, saveData, activeKart, armRecording } from './rasicross.js';
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
  activeRace, toggleRaceRun, endRace,
  buildRaceDataForKart, RasiReplay, enterReplay, exitReplay,
};
