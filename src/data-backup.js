// ============================================================
//  RasiCross -- data-backup.js  (Export/Import/Reset aller Daten)
//  Bis Phase 67 hiess die Datei recording.js und trug zusaetzlich
//  Mitschnitt und Replay; beides ist in Phase 68 entfallen. Geblieben
//  ist die Datensicherung als JSON -- nach dem Rueckbau der einzige
//  Weg, Rennen aus der App zu holen. Nur Deklarationen auf Top-Level.
// ============================================================
import { state, rcAlert, rcConfirm, rcToast, saveData, SAVE_KEY,
         activeKart } from './rasicross.js';

function exportAll() {
  const k = activeKart();
  const data = {
    version: '9.6', exportedAt: new Date().toISOString(),
    settings: state.settings, calibration: k.calibration,
    drivers: state.drivers, races: state.races,
    savedTracks: state.savedTracks,
    track: state.track, startGate: state.startGate,
    sectors: state.sectors,
    engine: { totalMs: k.engine.totalMs, lastServiceMs: k.engine.lastServiceMs, serviceIntervalH: k.engine.serviceIntervalH }
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `rasicross_v96_${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(url);
  rcToast('Export erstellt');
}
function importAll(file) {
  const reader = new FileReader();
  reader.onload = async () => {
    try {
      const d = JSON.parse(reader.result);
      if (!await rcConfirm('Aktuelle Daten überschreiben?', 'Importieren', 'Importieren', true)) return;
      const k = activeKart();
      if (d.settings) Object.assign(state.settings, d.settings);
      if (d.calibration) Object.assign(k.calibration, d.calibration);
      if (Array.isArray(d.drivers)) state.drivers = d.drivers;
      if (Array.isArray(d.races)) state.races = d.races;
      if (Array.isArray(d.savedTracks)) state.savedTracks = d.savedTracks;
      if (d.engine) {
        k.engine.totalMs = Number(d.engine.totalMs) || 0;
        k.engine.lastServiceMs = Number(d.engine.lastServiceMs) || 0;
        if (d.engine.serviceIntervalH != null) k.engine.serviceIntervalH = Number(d.engine.serviceIntervalH) || 0;
      }
      saveData();
      location.reload();
    } catch (e) { rcAlert('Import fehlgeschlagen:\n' + e.message); }
  };
  reader.readAsText(file);
}
async function resetAll() {
  if (!await rcConfirm('Alle Daten unwiderruflich löschen?', 'Zurücksetzen', 'Löschen', true)) return;
  localStorage.removeItem(SAVE_KEY);
  location.reload();
}

export { exportAll, importAll, resetAll };
