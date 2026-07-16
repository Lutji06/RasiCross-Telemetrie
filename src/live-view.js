'use strict';
/*!
 * live-view.js — pure Logik fuer die Live-Tab-Start-Ansicht (Phase 55):
 *   - liveViewAutoReducer: entscheidet, ob die Automatik zwischen
 *     'single' und 'overview' umschaltet (Muster wie gViewReducer).
 * Reines Modul — kein DOM, keine Seiteneffekte, wirft nie.
 */

const VIEWS = Object.freeze(['single', 'overview']);
const START_MODES = Object.freeze(['auto', 'single', 'overview']);

// Regeln (Spec 2026-07-16, Prioritaet absteigend):
//  1. count<=1: overview -> 'single' (Zwangs-Rueckfall), sonst null
//  2. manual: null (Hand-Wahl gewinnt fuer die Sitzung)
//  3. setting 'single': null (nie automatisch)
//  4. setting 'auto': nur auf der Flanke prevCount<2<=count -> 'overview'
//  5. setting 'overview': pegel-getriggert — count>=2 und single -> 'overview'
function liveViewAutoReducer(a) {
  const o = a || {};
  const view = VIEWS.includes(o.view) ? o.view : 'single';
  const setting = START_MODES.includes(o.setting) ? o.setting : 'auto';
  const count = (typeof o.count === 'number' && isFinite(o.count)) ? o.count : 0;
  const prev = (typeof o.prevCount === 'number' && isFinite(o.prevCount)) ? o.prevCount : 0;
  if (count <= 1) return view === 'overview' ? 'single' : null;
  if (o.manual === true) return null;
  if (setting === 'single') return null;
  if (setting === 'auto') return (prev < 2 && view === 'single') ? 'overview' : null;
  return view === 'single' ? 'overview' : null;
}

export default { liveViewAutoReducer, START_MODES };
