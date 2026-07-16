'use strict';
/*!
 * settings.js — pure Logik fuer den Einstellungs-Tab:
 *   - settingsNavReducer: aktive Gruppe (Muster wie kartModelYawReducer)
 *   - settingsFilter:     Suche/Filter ueber SETTINGS_INDEX (Task 2)
 * Reines UMD-Modul — kein DOM, keine Seiteneffekte, wirft nie.
 */

  const GROUPS = Object.freeze(['dashboard', 'fahrdynamik', 'bridge', 'model3d', 'map', 'data']);

  function settingsNavReducer(current, action) {
    const cur = GROUPS.includes(current) ? current : GROUPS[0];
    if (action && action.type === 'set' && GROUPS.includes(action.id)) {
      return action.id;
    }
    return cur;
  }

  // rowId == bestehende DOM-Element-ID. keywords: deutsche Synonyme fuer die Suche.
  const SETTINGS_INDEX = Object.freeze([
    { group: 'dashboard', rowId: 'setMaxSpeed',       label: 'Max Speed',            keywords: ['tacho', 'geschwindigkeit', 'kmh', 'speed', 'skala'] },
    { group: 'dashboard', rowId: 'setMaxRpm',         label: 'Max RPM',              keywords: ['drehzahl', 'umdrehung', 'rpm'] },
    { group: 'dashboard', rowId: 'setRpmWarn',        label: 'RPM-Warnung ab',       keywords: ['drehzahl', 'warnung', 'limit', 'rpm'] },
    { group: 'dashboard', rowId: 'setGScale',         label: 'G-Skala',              keywords: ['gmeter', 'beschleunigung', 'g', 'skala'] },
    { group: 'dashboard', rowId: 'setMinLap',         label: 'Mindest-Rundenzeit',   keywords: ['runde', 'lap', 'zeit', 'minimum'] },
    { group: 'dashboard', rowId: 'setLiveStartView',  label: 'Live-Start-Ansicht',   keywords: ['live', 'uebersicht', 'overview', 'multi', 'kart', 'start', 'ansicht'] },
    { group: 'fahrdynamik', rowId: 'setDriftTol',       label: 'Drift-Empfindlichkeit', keywords: ['drift', 'toleranz', 'empfindlichkeit'] },
    { group: 'fahrdynamik', rowId: 'setDriftMinSpeed',  label: 'Drift Min-Tempo',      keywords: ['drift', 'tempo', 'speed', 'minimum'] },
    { group: 'fahrdynamik', rowId: 'setRolloverAngle',  label: 'Umkipp-Schwelle',      keywords: ['umkippen', 'rollover', 'rollwinkel', 'grad', 'sicherheit'] },
    { group: 'bridge',   rowId: 'setDisplayUpdateMs', label: 'OLED-Update Intervall', keywords: ['oled', 'display', 'bridge', 'intervall', 'ms'] },
    { group: 'model3d',   rowId: 'kartModelFile',     label: '3D-Modell laden',      keywords: ['kart', 'modell', '3d', 'glb', 'gltf', 'upload'] },
    { group: 'map',       rowId: 'setTilesEnabled',   label: 'OSM-Hintergrund',      keywords: ['karte', 'osm', 'tiles', 'hintergrund'] },
    { group: 'map',       rowId: 'setTilesPreset',    label: 'Karten-Stil',          keywords: ['karte', 'stil', 'preset', 'tiles'] },
    { group: 'map',       rowId: 'setTilesUrl',       label: 'Tile-URL-Template',    keywords: ['karte', 'url', 'tiles', 'eigene'] },
    { group: 'data',      rowId: 'recAutoArmToggle',  label: 'Aufnahme automatisch starten', keywords: ['aufnahme', 'record', 'auto', 'arm'] },
    { group: 'data',      rowId: 'exportAllBtn',      label: 'Alle Daten exportieren', keywords: ['export', 'backup', 'sichern'] },
    { group: 'data',      rowId: 'importAllBtn',      label: 'Daten importieren',    keywords: ['import', 'backup', 'laden'] },
    { group: 'data',      rowId: 'resetAllBtn',       label: 'Alle Daten zuruecksetzen', keywords: ['reset', 'loeschen', 'zuruecksetzen'] },
  ].map(Object.freeze));

  function _norm(s) {
    return String(s == null ? '' : s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
  }

  function settingsFilter(query, index) {
    const list = Array.isArray(index) ? index : SETTINGS_INDEX;
    const q = _norm(query);
    const rows = new Set();
    const groups = new Set();
    if (q === '') {
      for (const e of list) { rows.add(e.rowId); groups.add(e.group); }
      return { groups, rows, query: '' };
    }
    for (const e of list) {
      const hay = _norm(e.label + ' ' + (e.keywords || []).join(' ') + ' ' + e.group);
      if (hay.includes(q)) { rows.add(e.rowId); groups.add(e.group); }
    }
    return { groups, rows, query: q };
  }

  // ESM-Export (Phase 42): Default-Objekt = bisheriges window.RasiSettings
  export default { GROUPS, settingsNavReducer, SETTINGS_INDEX, settingsFilter };
