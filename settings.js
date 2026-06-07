'use strict';
/*!
 * settings.js — pure Logik fuer den Einstellungs-Tab:
 *   - settingsNavReducer: aktive Gruppe (Muster wie kartModelYawReducer)
 *   - settingsFilter:     Suche/Filter ueber SETTINGS_INDEX (Task 2)
 * Reines UMD-Modul — kein DOM, keine Seiteneffekte, wirft nie.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.RasiSettings = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {

  const GROUPS = Object.freeze(['dashboard', 'sensorik', 'hardware', 'model3d', 'map', 'data']);

  function settingsNavReducer(current, action) {
    const cur = GROUPS.includes(current) ? current : GROUPS[0];
    if (action && action.type === 'set' && GROUPS.includes(action.id)) {
      return action.id;
    }
    return cur;
  }

  return { GROUPS, settingsNavReducer };
}));
