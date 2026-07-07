'use strict';
/*!
 * settings.js — pure Logik fuer den Einstellungs-Tab:
 *   - settingsNavReducer: aktive Gruppe (Muster wie kartModelYawReducer)
 *   - settingsFilter:     Suche/Filter ueber SETTINGS_INDEX (Task 2)
 * Reines UMD-Modul — kein DOM, keine Seiteneffekte, wirft nie.
 */

  const GROUPS = Object.freeze(['dashboard', 'sensorik', 'hardware', 'model3d', 'map', 'data']);

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
    { group: 'sensorik',  rowId: 'setInvertGx',       label: 'Gx invertieren',       keywords: ['imu', 'achse', 'kalibrierung', 'g'] },
    { group: 'sensorik',  rowId: 'setInvertGy',       label: 'Gy invertieren',       keywords: ['imu', 'achse', 'kalibrierung', 'g'] },
    { group: 'sensorik',  rowId: 'setSwapG',          label: 'Gx Gy tauschen',       keywords: ['imu', 'achse', 'swap', 'tauschen'] },
    { group: 'sensorik',  rowId: 'setInvertYaw',      label: 'Gier invertieren',     keywords: ['imu', 'yaw', 'gier', 'drift'] },
    { group: 'sensorik',  rowId: 'setInvertRollRate', label: 'Roll-Rate invertieren', keywords: ['imu', 'roll', 'kipp', 'achse', 'rollwinkel', 'gyro'] },
    { group: 'sensorik',  rowId: 'setDriftTol',       label: 'Drift-Empfindlichkeit', keywords: ['drift', 'toleranz', 'empfindlichkeit'] },
    { group: 'sensorik',  rowId: 'setDriftMinSpeed',  label: 'Drift Min-Tempo',      keywords: ['drift', 'tempo', 'speed', 'minimum'] },
    { group: 'sensorik',  rowId: 'setRolloverAngle',  label: 'Umkipp-Schwelle',      keywords: ['umkippen', 'rollover', 'rollwinkel', 'grad', 'sicherheit'] },
    { group: 'hardware',  rowId: 'espMaxRpm',         label: 'Max RPM (Sender)',     keywords: ['esp', 'sender', 'drehzahl', 'rpm'] },
    { group: 'hardware',  rowId: 'espWarnRpm',        label: 'Warn RPM (Sender)',    keywords: ['esp', 'sender', 'warnung', 'rpm'] },
    { group: 'hardware',  rowId: 'espSendMs',         label: 'Sende-Intervall',      keywords: ['esp', 'rate', 'intervall', 'ms'] },
    { group: 'hardware',  rowId: 'espPulses',         label: 'Pulses per Revolution', keywords: ['esp', 'puls', 'sensor', 'umdrehung'] },
    { group: 'hardware',  rowId: 'espWheelCirc',      label: 'Radumfang',            keywords: ['esp', 'rad', 'umfang', 'gps', 'meter'] },
    { group: 'hardware',  rowId: 'espGearRatio',      label: 'Uebersetzung',         keywords: ['esp', 'getriebe', 'gear', 'ratio', 'welle'] },
    { group: 'hardware',  rowId: 'espBattCells',      label: 'Akkuzellen in Reihe',  keywords: ['esp', 'akku', 'batterie', 'zellen', 'batt', 'lipo'] },
    { group: 'hardware',  rowId: 'espBattWarnV',      label: 'Akku Warn-Schwelle',   keywords: ['esp', 'akku', 'batterie', 'warnung', 'spannung', 'volt'] },
    { group: 'hardware',  rowId: 'espBattCritV',      label: 'Akku Kritisch-Schwelle', keywords: ['esp', 'akku', 'batterie', 'kritisch', 'spannung', 'volt'] },
    { group: 'hardware',  rowId: 'espBattCal',        label: 'Akku Feinkalibrierung', keywords: ['esp', 'akku', 'batterie', 'kalibrierung', 'multimeter'] },
    { group: 'hardware',  rowId: 'espRpmCeiling',     label: 'RPM Glitch-Schwelle',  keywords: ['esp', 'rpm', 'glitch', 'filter', 'zuendung', 'emi', 'hall'] },
    { group: 'hardware',  rowId: 'espRpmAlpha',       label: 'RPM-Glaettung',        keywords: ['esp', 'rpm', 'glaettung', 'filter', 'alpha', 'ema'] },
    { group: 'hardware',  rowId: 'espPageMs',         label: 'OLED Seitenwechsel',   keywords: ['esp', 'oled', 'display', 'seite', 'wechsel', 'ms'] },
    { group: 'hardware',  rowId: 'setDisplayUpdateMs', label: 'OLED-Update Intervall', keywords: ['oled', 'display', 'bridge', 'intervall', 'ms'] },
    { group: 'hardware',  rowId: 'engineHoursText',   label: 'Motorlaufzeit',        keywords: ['motor', 'laufzeit', 'betriebsstunden', 'stunden', 'wartung'] },
    { group: 'hardware',  rowId: 'setServiceIntervalH', label: 'Wartungsintervall',  keywords: ['wartung', 'service', 'intervall', 'oel', 'stunden'] },
    { group: 'hardware',  rowId: 'engineSinceServiceText', label: 'Seit letzter Wartung', keywords: ['wartung', 'service', 'motor', 'stunden'] },
    { group: 'hardware',  rowId: 'serviceDoneBtn',    label: 'Wartung erledigt',     keywords: ['wartung', 'service', 'reset', 'zuruecksetzen'] },
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
