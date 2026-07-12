// ============================================================
//  RasiCross — kart-settings.js  (Kart-Einstellungen im Karts-Tab, Phase 47)
// ============================================================
//  Dropdown + Panels (Kalibrierung, ESP32-Sender) fuer das im Dropdown
//  gewaehlte Kart. Alle Aktionen zielen explizit per target_mac auf dieses
//  Kart — nie implizit auf das aktive. ESP-Feldwerte werden NIE vom Render
//  ueberschrieben (nur config_ack fuellt sie), sonst wuerde der 1-Hz-
//  Refresh des Karts-Tabs Eingaben verwerfen.
//  Nur Deklarationen auf Top-Level — kein Code laeuft beim Laden.
// ============================================================
import { state, $, esc, setText, rcToast, saveData,
         kartMetaFor, kartRosterMacs, kartCalFor, bridgeSend } from './rasicross.js';
import { ESP_CFG_FIELDS, armEspAckTimer } from './esp-config.js';
import { drawGMeter } from './gauges.js';
import RasiKartRoster from './kart-roster.js';
import KartRegistry from './kart-registry.js';

let _selectedMac = null;
let _zeroBusy = false;
let _lastEspUsable = null;

function selectedKartMac() {
  return RasiKartRoster.resolveSelectedMac(_selectedMac, state.activeKartMac, kartRosterMacs());
}

// Live-Bucket NUR lesen, wenn er existiert — state.karts.get() wuerde sonst
// einen leeren Bucket fuer ein offline-Kart anlegen.
function _liveKart(mac) {
  return (mac && state.karts.has(mac)) ? state.karts.get(mac) : null;
}

// target_mac explizit setzen (Muster pit-wall.js) — der bridgeSend-Default
// waere das AKTIVE Kart, hier zielt alles auf das GEWAEHLTE.
function _sendToSelected(payload) {
  const mac = selectedKartMac();
  if (mac && mac !== KartRegistry.DEFAULT_MAC) payload.target_mac = mac;
  return bridgeSend(payload);
}

const CAL_TOGGLES = [
  ['setInvertGx', 'invertGx'], ['setInvertGy', 'invertGy'], ['setSwapG', 'swapG'],
  ['setInvertYaw', 'invertYaw'], ['setInvertRollRate', 'invertRollRate'],
];

function renderKartSettings() {
  const sect = $('kartSettingsSection');
  if (!sect) return;
  // Fokus-Schutz wie renderKartsTab: offenes Dropdown / fokussierte
  // Panel-Inputs nicht per 1-Hz-Refresh zerstoeren.
  const ae = document.activeElement;
  if (ae && sect.contains(ae) && (ae.tagName === 'INPUT' || ae.tagName === 'SELECT')) return;
  const macs = kartRosterMacs();
  const empty = $('kartSettingsEmpty'), panels = $('kartSettingsPanels'), sel = $('kartSettingsSelect');
  const has = macs.length > 0;
  if (empty) empty.style.display = has ? 'none' : '';
  if (panels) panels.style.display = has ? '' : 'none';
  if (sel) sel.style.display = has ? '' : 'none';
  if (!has || !sel) return;
  const mac = selectedKartMac();
  sel.innerHTML = macs.map((m, i) => {
    const name = kartMetaFor(m, i).name;
    const off = state.karts.has(m) ? '' : ' (offline)';
    return '<option value="' + esc(m) + '"' + (m === mac ? ' selected' : '') + '>'
      + esc(name) + off + '</option>';
  }).join('');
  _renderCalPanel(mac);
  _renderEspPanel(mac);
}

function _renderCalPanel(mac) {
  const c = kartCalFor(mac);
  const online = !!_liveKart(mac);
  for (const [id] of CAL_TOGGLES) { const el = $(id); if (el) el.disabled = !c; }
  if (c) {
    setText('gxOffsetText', (Number(c.gxZero) || 0).toFixed(2));
    setText('gyOffsetText', (Number(c.gyZero) || 0).toFixed(2));
    for (const [id, key] of CAL_TOGGLES) { const el = $(id); if (el) el.checked = !!c[key]; }
  } else {
    setText('gxOffsetText', '--');
    setText('gyOffsetText', '--');
  }
  // Live-Aktionen brauchen Telemetrie des gewaehlten Karts.
  if ($('zeroImuBtn')) $('zeroImuBtn').disabled = !online || _zeroBusy;
  if ($('zeroRollBtn')) $('zeroRollBtn').disabled = !online;
  if ($('resetImuBtn')) $('resetImuBtn').disabled = !c;
  setText('kartCalHint', !c ? 'Keine Kalibrierdaten für dieses Kart.'
    : (online ? '' : 'Kart offline — Nullpunkt/Roll nullen erst bei Live-Telemetrie.'));
}

function _renderEspPanel(mac) {
  const online = !!_liveKart(mac);
  const usable = online && !!(state.serial && state.serial.connected);
  for (const [id] of ESP_CFG_FIELDS) { const el = $(id); if (el) el.disabled = !usable; }
  if ($('espSendBtn')) $('espSendBtn').disabled = !usable;
  // Status nur bei ZUSTANDSWECHSEL schreiben — Sende-/Ack-Meldungen
  // (espSendStatus) sonst nicht bei jedem 1-Hz-Render ueberschreiben.
  if (usable !== _lastEspUsable) {
    _lastEspUsable = usable;
    setText('espSendStatus', usable ? ''
      : (online ? 'Bridge nicht verbunden' : 'Kart nicht verbunden — Konfig erscheint bei Live-Telemetrie'));
  }
}

function initKartSettings() {
  const sel = $('kartSettingsSelect');
  if (sel) sel.onchange = () => {
    _selectedMac = sel.value || null;
    sel.blur();   // Fokus-Schutz freigeben, sonst friert der 1-Hz-Refresh ein
    renderKartSettings();
    // Ist-Konfig des neu gewaehlten Karts anfragen — config_ack fuellt das
    // Formular (Filter in applyEspConfigAck laesst nur dieses Kart durch).
    if (state.serial && state.serial.connected && _liveKart(selectedKartMac())) {
      _sendToSelected({ type: 'config_get' });
    }
  };
  for (const [id, key] of CAL_TOGGLES) {
    const el = $(id);
    if (el) el.onchange = () => {
      const c = kartCalFor(selectedKartMac());
      if (!c) return;
      c[key] = !!el.checked;
      drawGMeter._trail = [];
      saveData();
      renderKartSettings();
    };
  }
  if ($('zeroRollBtn')) $('zeroRollBtn').onclick = () => {
    const k = _liveKart(selectedKartMac());
    if (!k) return;
    // Aktuellen fusionierten Rollwinkel (inkl. bestehendem Offset) als neue 0 setzen.
    k.calibration.rollZero = k.calibration.rollZero + ((k.attitude && k.attitude.rollDeg) || 0);
    k.attitude.rollDeg = 0;
    k.attitude.overState = { active: false };
    k.attitude.over = false;
    saveData();
    rcToast('Rollwinkel genullt', 1500);
  };
  if ($('zeroImuBtn')) $('zeroImuBtn').onclick = () => {
    const btn = $('zeroImuBtn');
    if (btn.disabled || _zeroBusy) return;
    const mac = selectedKartMac();
    if (!_liveKart(mac)) return;
    _zeroBusy = true;
    const original = btn.textContent;
    btn.disabled = true;
    // Sender-seitige Kalibrierung mitstarten (am gewaehlten Kart)
    try {
      _sendToSelected({ type: 'imu_calibrate', action: 'auto', duration_ms: 2000 });
    } catch (e) { console.warn('imu_calibrate send:', e); }
    // Client-seitig: 2 Sekunden lang Samples des gewaehlten Karts mitteln
    const samples = [];
    const start = Date.now();
    const duration = 2000;
    const tick = setInterval(() => {
      const elapsed = Date.now() - start;
      const k = _liveKart(mac);
      if (k) samples.push({ x: k.raw.gx || 0, y: k.raw.gy || 0 });
      const remain = Math.max(0, duration - elapsed) / 1000;
      btn.textContent = `Kart still halten… ${remain.toFixed(1)}s`;
      if (elapsed >= duration) {
        clearInterval(tick);
        const k2 = _liveKart(mac);
        if (k2 && samples.length >= 5) {
          const avgX = samples.reduce((s, p) => s + p.x, 0) / samples.length;
          const avgY = samples.reduce((s, p) => s + p.y, 0) / samples.length;
          k2.calibration.gxZero = avgX;
          k2.calibration.gyZero = avgY;
          saveData();
          rcToast(`Nullpunkt gesetzt (${samples.length} Samples)`);
        } else {
          rcToast('Zu wenige Samples — kommen Telemetrie-Daten an?');
        }
        btn.textContent = original;
        btn.disabled = false;
        _zeroBusy = false;
        renderKartSettings();
      }
    }, 50);
  };
  if ($('resetImuBtn')) $('resetImuBtn').onclick = () => {
    const c = kartCalFor(selectedKartMac());
    if (!c) return;
    c.gxZero = 0;
    c.gyZero = 0;
    saveData();
    // Sender-Offsets ebenfalls zuruecksetzen (am gewaehlten Kart)
    try { _sendToSelected({ type: 'imu_calibrate', action: 'reset' }); } catch (e) {}
    rcToast('IMU-Kalibrierung zurückgesetzt');
    renderKartSettings();
  };
  if ($('espSendBtn')) $('espSendBtn').onclick = () => {
    const mac = selectedKartMac();
    const k = _liveKart(mac);
    const cfg = {
      type: 'config',
      max_rpm: Number($('espMaxRpm').value) || 6000,
      warn_rpm: Number($('espWarnRpm').value) || 5500,
      send_ms: Number($('espSendMs').value) || 80,
      pulses_per_rev: Number($('espPulses').value) || 1,
      wheel_circ_m: Number($('espWheelCirc').value) || 0,
      gear_ratio: Number($('espGearRatio').value) || 1,
      batt_cells: Number($('espBattCells').value) || 1,
      batt_warn_v: Number($('espBattWarnV').value) || 3.5,
      batt_crit_v: Number($('espBattCritV').value) || 3.3,
      batt_cal: Number($('espBattCal').value) || 1.0,
      rpm_ceiling: Math.max(0, Number($('espRpmCeiling').value) || 0),
      rpm_alpha: Number($('espRpmAlpha').value) || 0.25,
      page_ms: Number($('espPageMs').value) || 4000,
    };
    if (!state.serial.connected || !k) {
      setText('espSendStatus', !state.serial.connected ? 'Nicht verbunden' : 'Kart nicht verbunden');
      return;
    }
    k.batt.cells = cfg.batt_cells;
    try {
      _sendToSelected(cfg);
      setText('espSendStatus', '✓ Gesendet — warte auf Bestätigung…');
      armEspAckTimer(3000, () => {
        setText('espSendStatus', '⚠ Keine Bestätigung vom Kart — Funkverbindung prüfen');
      });
    } catch (e) {
      setText('espSendStatus', '✗ Fehler');
    }
  };
}

// ESM-Export (Phase 47)
export { renderKartSettings, selectedKartMac, initKartSettings };
