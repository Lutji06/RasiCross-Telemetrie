// ============================================================
//  RasiCross — kart-settings-window.js  (Einstellungs-Fenster pro Kart, Phase 48)
// ============================================================
//  Echte OS-Fenster via window.open aus dem Haupt-Renderer: das Kind ist
//  same-origin (about:blank), der Haupt-Renderer baut dessen DOM auf und
//  bindet alle Handler selbst — kein IPC, kein State-Sync. Mehrere Fenster
//  parallel (Map mac -> Rekord); zweiter ⚙-Klick fokussiert nur.
//  ESP-Feldwerte werden NIE vom Refresh ueberschrieben (nur config_ack
//  fuellt sie, Task 6); Fokus-Schutz gilt pro Fenster.
//  Nur Deklarationen auf Top-Level — kein Code laeuft beim Laden.
// ============================================================
import { state, rcToast, rcConfirm, saveData, saveDataDebounced,
         kartMetaFor, kartRosterMacs, kartCalFor, kartEngineFor, kartStatsFor,
         updateKartMeta, bridgeSend } from './rasicross.js';
import { ESP_CFG_FIELDS, applyEspConfigAck } from './esp-config.js';
import { drawGMeter } from './gauges.js';
import RasiEngine from './engine.js';
import RasiKartRoster from './kart-roster.js';
import RasiKartBar from './kart-bar.js';
import KartRegistry from './kart-registry.js';
import { renderKartsTab, forgetKart } from './karts-page.js';

// mac -> { mac, win, doc, ackTimer, zeroBusy, lastEspUsable }
const _wins = new Map();

// Letztes config/config_get-Ziel — Acks alter Firmware ohne from_mac
// gehen an dieses Fenster.
let _lastCfgMac = null;

function _el(r, id) { return r.doc.getElementById(id); }

function _kartIdx(mac) { return Math.max(0, state.karts.macs().indexOf(mac)); }

// Live-Bucket NUR lesen, wenn er existiert — state.karts.get() wuerde sonst
// einen leeren Bucket fuer ein offline-Kart anlegen.
function _liveKart(mac) {
  return (mac && state.karts.has(mac)) ? state.karts.get(mac) : null;
}

const CAL_TOGGLES = [
  ['setInvertGx', 'invertGx'], ['setInvertGy', 'invertGy'], ['setSwapG', 'swapG'],
  ['setInvertYaw', 'invertYaw'], ['setInvertRollRate', 'invertRollRate'],
];

// target_mac explizit auf das FENSTER-Kart setzen (Muster pit-wall.js) —
// der bridgeSend-Default waere das aktive Kart.
function _sendTo(mac, payload) {
  if (mac && mac !== KartRegistry.DEFAULT_MAC) payload.target_mac = mac;
  return bridgeSend(payload);
}

// Fenster-Markup: statisches HTML ohne Inline-Handler (CSP script-src 'self');
// alle dynamischen Werte setzt _refreshWin per DOM-API.
function _markup() {
  return '<div class="pw-library" style="margin:0">'
    + '<section class="settings-group active" id="kartIdPanel">'
    +   '<header class="settings-group-head">'
    +     '<div><h2 class="settings-group-title">Identität</h2><p class="settings-group-sub">Name &amp; Farbe</p></div>'
    +   '</header>'
    +   '<div class="settings-row">'
    +     '<div class="settings-row-label"><span class="settings-row-name">Name</span><span class="settings-row-desc">Anzeige in Chip-Leiste, Karten und Rennen</span></div>'
    +     '<input type="text" id="kartName" maxlength="20">'
    +   '</div>'
    +   '<div class="settings-row">'
    +     '<div class="settings-row-label"><span class="settings-row-name">Farbe</span><span class="settings-row-desc">Frei wählbar — Schnellwahl darunter</span></div>'
    +     '<input type="color" id="kartColor">'
    +   '</div>'
    +   '<div class="row" id="kartPaletteRow" style="gap:8px;margin:4px 0 8px"></div>'
    +   '<div class="kc-mac" id="kartMacText"></div>'
    + '</section>'
    + '<section class="settings-group active" id="kartCalPanel" style="margin-top:14px">'
    +   '<header class="settings-group-head">'
    +     '<div><h2 class="settings-group-title">Kalibrierung</h2><p class="settings-group-sub">IMU · Nullpunkt &amp; Achsen</p></div>'
    +   '</header>'
    +   '<p class="settings-block-note">Mäher auf eine ebene Fläche stellen, dann „Nullpunkt setzen". Achsen-Korrekturen darunter.</p>'
    +   '<div class="row" style="margin-bottom:14px">'
    +     '<div class="stat"><div class="t">Gx Offset</div><div class="n" id="gxOffsetText">0.00</div></div>'
    +     '<div class="stat"><div class="t">Gy Offset</div><div class="n" id="gyOffsetText">0.00</div></div>'
    +   '</div>'
    +   '<div class="toggle-row"><span class="label-text">Gx invertieren</span><label class="toggle"><input type="checkbox" id="setInvertGx"><span class="toggle-knob"></span></label></div>'
    +   '<div class="toggle-row"><span class="label-text">Gy invertieren</span><label class="toggle"><input type="checkbox" id="setInvertGy"><span class="toggle-knob"></span></label></div>'
    +   '<div class="toggle-row"><span class="label-text">Gx ↔ Gy tauschen</span><label class="toggle"><input type="checkbox" id="setSwapG"><span class="toggle-knob"></span></label></div>'
    +   '<div class="toggle-row"><span class="label-text">Gier invertieren</span><label class="toggle"><input type="checkbox" id="setInvertYaw"><span class="toggle-knob"></span></label></div>'
    +   '<div class="toggle-row"><span class="label-text">Roll-Rate invertieren</span><label class="toggle"><input type="checkbox" id="setInvertRollRate"><span class="toggle-knob"></span></label></div>'
    +   '<div class="row" style="gap:8px;margin:14px 0 4px">'
    +     '<button class="btn primary" id="zeroImuBtn" style="flex:1">Nullpunkt setzen</button>'
    +     '<button class="btn ghost" id="resetImuBtn" style="flex:0 0 auto">Zurücksetzen</button>'
    +     '<button class="btn ghost" id="zeroRollBtn" style="flex:0 0 auto" title="Aktuellen Rollwinkel als 0 setzen — Mäher dazu auf ebener Fläche abstellen">Roll nullen</button>'
    +   '</div>'
    +   '<div style="font-size:11px;color:var(--mut);margin:0 0 4px">⚠ Nullen nur auf <b>ebener Fläche</b> — am Hang genullt wäre jede spätere Messung um die Hangneigung verschoben.</div>'
    +   '<p id="kartCalHint" style="font-family:var(--mono);font-size:11px;color:var(--mut);margin-top:6px;min-height:14px"></p>'
    + '</section>'
    + '<section class="settings-group active" id="kartEspPanel" style="margin-top:14px">'
    +   '<header class="settings-group-head">'
    +     '<div><h2 class="settings-group-title">ESP32 / Sender</h2><p class="settings-group-sub">Sender-Konfig dieses Karts</p></div>'
    +   '</header>'
    +   '<p class="settings-block-note">Werte unten gehen erst per „An ESP32 senden" an den Kart und wirken dann sofort.</p>'
    +   '<div class="settings-row"><div class="settings-row-label"><span class="settings-row-name">Max RPM (Sender)</span><span class="settings-row-desc">Drehzahl-Obergrenze im Sender</span></div><input type="number" id="espMaxRpm" value="6000"></div>'
    +   '<div class="settings-row"><div class="settings-row-label"><span class="settings-row-name">Warn RPM (Sender)</span><span class="settings-row-desc">Warnschwelle im Sender</span></div><input type="number" id="espWarnRpm" value="5500"></div>'
    +   '<div class="settings-row"><div class="settings-row-label"><span class="settings-row-name">Sende-Intervall</span><span class="settings-row-desc">Telemetrie-Rate des Senders (ms)</span></div><input type="number" id="espSendMs" value="80" min="20" max="500"></div>'
    +   '<div class="settings-row"><div class="settings-row-label"><span class="settings-row-name">Pulses per Revolution</span><span class="settings-row-desc">Sensor-Pulse pro Wellenumdrehung</span></div><input type="number" id="espPulses" value="1" min="1" max="32"></div>'
    +   '<div class="settings-row"><div class="settings-row-label"><span class="settings-row-name">Radumfang</span><span class="settings-row-desc">Meter pro Radumdrehung (0 = nur GPS)</span></div><input type="number" id="espWheelCirc" value="0" min="0" step="0.001"></div>'
    +   '<div class="settings-row"><div class="settings-row-label"><span class="settings-row-name">Übersetzung Welle:Rad</span><span class="settings-row-desc">Getriebeverhältnis (1 = 1:1)</span></div><input type="number" id="espGearRatio" value="1" min="0.01" step="0.01"></div>'
    +   '<div class="settings-row"><div class="settings-row-label"><span class="settings-row-name">Akkuzellen in Reihe</span><span class="settings-row-desc">Anzahl LiPo-Zellen (cells in series)</span></div><input type="number" id="espBattCells" value="1" min="1" max="14"></div>'
    +   '<div class="settings-row"><div class="settings-row-label"><span class="settings-row-name">Akku Warn-Schwelle</span><span class="settings-row-desc">Warnung ab dieser Spannung pro Zelle (V)</span></div><input type="number" id="espBattWarnV" value="3.5" min="2.5" max="4.4" step="0.05"></div>'
    +   '<div class="settings-row"><div class="settings-row-label"><span class="settings-row-name">Akku Kritisch-Schwelle</span><span class="settings-row-desc">Kritisch ab dieser Spannung pro Zelle (V)</span></div><input type="number" id="espBattCritV" value="3.3" min="2.0" max="4.4" step="0.05"></div>'
    +   '<div class="settings-row"><div class="settings-row-label"><span class="settings-row-name">Akku Feinkalibrierung</span><span class="settings-row-desc">Multiplikator auf die gemessene Spannung (Abgleich mit Multimeter)</span></div><input type="number" id="espBattCal" value="1.0" min="0.5" max="2.0" step="0.01"></div>'
    +   '<div class="settings-row"><div class="settings-row-label"><span class="settings-row-name">RPM Glitch-Schwelle</span><span class="settings-row-desc">Flanken oberhalb dieser Drehzahl gelten als Störimpuls (Zünd-EMI); 0 = Filter aus</span></div><input type="number" id="espRpmCeiling" value="16000" min="0" max="30000" step="500"></div>'
    +   '<div class="settings-row"><div class="settings-row-label"><span class="settings-row-name">RPM-Glättung</span><span class="settings-row-desc">EMA-Gewicht des neuen Werts: 1 = ungefiltert, klein = träge</span></div><input type="number" id="espRpmAlpha" value="0.25" min="0.05" max="1" step="0.05"></div>'
    +   '<div class="settings-row"><div class="settings-row-label"><span class="settings-row-name">OLED Seitenwechsel</span><span class="settings-row-desc">Auto-Seitenwechsel des Kart-Displays (ms)</span></div><input type="number" id="espPageMs" value="4000" min="1000" max="20000" step="500"></div>'
    +   '<div class="row" style="margin:6px 0 4px"><button class="btn primary" id="espSendBtn" style="flex:1">An ESP32 senden</button></div>'
    +   '<p id="espSendStatus" style="font-family:var(--mono);font-size:11px;color:var(--mut);margin-top:6px;text-align:center;min-height:14px"></p>'
    + '</section>'
    + '<section class="settings-group active" id="kartServicePanel" style="margin-top:14px">'
    +   '<header class="settings-group-head">'
    +     '<div><h2 class="settings-group-title">Wartung</h2><p class="settings-group-sub">Motorstunden &amp; Intervall</p></div>'
    +   '</header>'
    +   '<div class="kc-grid" id="kartServiceStats"></div>'
    +   '<div class="settings-row">'
    +     '<div class="settings-row-label"><span class="settings-row-name">Intervall (h)</span><span class="settings-row-desc">0 = Wartungshinweis aus</span></div>'
    +     '<input type="number" id="kartServiceInterval" min="0" max="500" step="0.5">'
    +   '</div>'
    +   '<div class="row" style="margin:6px 0 4px"><button class="btn ghost" id="kartServiceBtn" style="flex:1">Wartung erledigt</button></div>'
    + '</section>'
    + '<section class="settings-group active" id="kartDangerPanel" style="margin-top:14px">'
    +   '<header class="settings-group-head">'
    +     '<div><h2 class="settings-group-title">Gefahrenzone</h2><p class="settings-group-sub">Zurücksetzen &amp; Entfernen</p></div>'
    +   '</header>'
    +   '<div class="row" style="gap:8px;margin:6px 0 4px">'
    +     '<button class="btn ghost" id="kartCalResetBtn" style="flex:1">Kalibrierung zurücksetzen</button>'
    +     '<button class="btn ghost" id="kartStatsResetBtn" style="flex:1">Statistik zurücksetzen</button>'
    +   '</div>'
    +   '<div class="row" style="margin:6px 0 4px"><button class="btn danger" id="kartForgetBtn" style="flex:1">Kart vergessen</button></div>'
    + '</section>'
    + '</div>';
}

function openKartSettings(mac) {
  const existing = _wins.get(mac);
  if (existing && existing.win && !existing.win.closed) {
    try { existing.win.focus(); } catch (e) {}
    return;
  }
  const win = window.open('', '_blank', 'width=460,height=720');
  if (!win) {
    rcToast('Popup blockiert — bitte Popups für die App erlauben', 4000);
    return;
  }
  const doc = win.document;
  doc.documentElement.dataset.theme = state.theme;
  // Styles des Hauptfensters klonen: Vite inlined das App-CSS als <style>-
  // Knoten (Dev: von Vite injizierte <style>; Fonts-<link> ist absolut).
  document.querySelectorAll('style, link[rel="stylesheet"]').forEach((n) => {
    doc.head.appendChild(doc.importNode(n, true));
  });
  doc.body.innerHTML = _markup();
  doc.body.style.cssText = 'padding:14px;overflow-y:auto';
  const r = { mac, win, doc, ackTimer: null, zeroBusy: false, lastEspUsable: null };
  _wins.set(mac, r);
  _el(r, 'kartMacText').textContent = mac;
  _bindHandlers(r);
  _refreshWin(r);
  // Ist-Konfig anfragen — config_ack fuellt das Formular (routeConfigAck).
  if (state.serial && state.serial.connected && _liveKart(mac)) {
    _lastCfgMac = mac;
    try { _sendTo(mac, { type: 'config_get' }); } catch (e) {}
  }
}

function _bindHandlers(r) {
  const name = _el(r, 'kartName');
  name.oninput = () => {
    updateKartMeta(r.mac, { name: name.value.trim() || ('Kart ' + (_kartIdx(r.mac) + 1)) });
    RasiKartBar.render(state);
    renderKartsTab();
    r.doc.title = kartMetaFor(r.mac, _kartIdx(r.mac)).name + ' — Einstellungen';
  };
  const col = _el(r, 'kartColor');
  col.oninput = () => {
    updateKartMeta(r.mac, { color: col.value });
    RasiKartBar.render(state);
    renderKartsTab();
    _renderPalette(r);
  };
  for (const [id, key] of CAL_TOGGLES) {
    const el = _el(r, id);
    if (el) el.onchange = () => {
      const c = kartCalFor(r.mac);
      if (!c) return;
      c[key] = !!el.checked;
      drawGMeter._trail = [];
      saveData();
      renderKartsTab();
      _refreshWin(r);
    };
  }
  if (_el(r, 'zeroRollBtn')) _el(r, 'zeroRollBtn').onclick = () => {
    const k = _liveKart(r.mac);
    if (!k) return;
    // Aktuellen fusionierten Rollwinkel (inkl. bestehendem Offset) als neue 0 setzen.
    k.calibration.rollZero = k.calibration.rollZero + ((k.attitude && k.attitude.rollDeg) || 0);
    k.attitude.rollDeg = 0;
    k.attitude.overState = { active: false };
    k.attitude.over = false;
    saveData();
    rcToast('Rollwinkel genullt', 1500);
  };
  if (_el(r, 'zeroImuBtn')) _el(r, 'zeroImuBtn').onclick = () => {
    const btn = _el(r, 'zeroImuBtn');
    if (btn.disabled || r.zeroBusy) return;
    if (!_liveKart(r.mac)) return;
    r.zeroBusy = true;
    const original = btn.textContent;
    btn.disabled = true;
    // Sender-seitige Kalibrierung mitstarten (am Fenster-Kart)
    try {
      _sendTo(r.mac, { type: 'imu_calibrate', action: 'auto', duration_ms: 2000 });
    } catch (e) { console.warn('imu_calibrate send:', e); }
    // Client-seitig: 2 Sekunden lang Samples des Fenster-Karts mitteln
    const samples = [];
    const start = Date.now();
    const duration = 2000;
    const tick = setInterval(() => {
      const elapsed = Date.now() - start;
      const k = _liveKart(r.mac);
      if (k) samples.push({ x: k.raw.gx || 0, y: k.raw.gy || 0 });
      const remain = Math.max(0, duration - elapsed) / 1000;
      btn.textContent = `Kart still halten… ${remain.toFixed(1)}s`;
      if (elapsed >= duration) {
        clearInterval(tick);
        const k2 = _liveKart(r.mac);
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
        r.zeroBusy = false;
        renderKartsTab();
        _refreshWin(r);
      }
    }, 50);
  };
  if (_el(r, 'resetImuBtn')) _el(r, 'resetImuBtn').onclick = () => {
    const c = kartCalFor(r.mac);
    if (!c) return;
    c.gxZero = 0;
    c.gyZero = 0;
    saveData();
    // Sender-Offsets ebenfalls zuruecksetzen (am Fenster-Kart)
    try { _sendTo(r.mac, { type: 'imu_calibrate', action: 'reset' }); } catch (e) {}
    rcToast('IMU-Kalibrierung zurückgesetzt');
    renderKartsTab();
    _refreshWin(r);
  };
  const ivEl = _el(r, 'kartServiceInterval');
  if (ivEl) ivEl.onchange = () => {
    const e = kartEngineFor(r.mac);
    if (!e) return;
    e.serviceIntervalH = RasiKartRoster.clampServiceH(ivEl.value);
    ivEl.value = e.serviceIntervalH;
    saveDataDebounced();
    renderKartsTab();
  };
  if (_el(r, 'kartServiceBtn')) _el(r, 'kartServiceBtn').onclick = async () => {
    window.focus();   // rcConfirm rendert im Hauptfenster
    if (!await rcConfirm('Wartungszähler zurücksetzen? Seit-letzter-Wartung beginnt wieder bei 0.', 'Wartung', 'Zurücksetzen')) return;
    const e = kartEngineFor(r.mac);
    if (!e) return;
    e.lastServiceMs = e.totalMs;
    if ('_warned' in e) e._warned = false;
    saveData();
    rcToast('🔧 Wartung vermerkt');
    renderKartsTab();
    _refreshWin(r);
  };
  if (_el(r, 'kartCalResetBtn')) _el(r, 'kartCalResetBtn').onclick = async () => {
    window.focus();
    if (!await rcConfirm('Kalibrierung dieses Karts auf Werkswerte zurücksetzen?', 'Kalibrierung', 'Zurücksetzen', true)) return;
    const c = kartCalFor(r.mac);
    if (!c) return;
    Object.assign(c, RasiKartRoster.calDefaults());
    saveData();
    rcToast('Kalibrierung zurückgesetzt');
    renderKartsTab();
    _refreshWin(r);
  };
  if (_el(r, 'kartStatsResetBtn')) _el(r, 'kartStatsResetBtn').onclick = async () => {
    window.focus();
    if (!await rcConfirm('Statistik (Kilometer, Ø, Top-Speed, Fahrzeit) dieses Karts auf 0 setzen?', 'Statistik', 'Zurücksetzen', true)) return;
    const s = kartStatsFor(r.mac);
    if (!s) return;
    s.odoM = 0;
    s.moveMs = 0;
    s.topKmh = 0;
    if ('lastAt' in s) s.lastAt = null;
    saveData();
    rcToast('Statistik zurückgesetzt');
    renderKartsTab();
  };
  if (_el(r, 'kartForgetBtn')) _el(r, 'kartForgetBtn').onclick = async () => {
    window.focus();
    if (!await rcConfirm('Dieses Kart endgültig vergessen? Name, Farbe, Kalibrierung, Statistik und Motorstunden werden gelöscht.', 'Kart vergessen', 'Vergessen', true)) return;
    forgetKart(r.mac);
    try { r.win.close(); } catch (e) {}
    _wins.delete(r.mac);
  };
  if (_el(r, 'espSendBtn')) _el(r, 'espSendBtn').onclick = () => {
    const k = _liveKart(r.mac);
    const doc = r.doc;
    const num = (id) => Number(doc.getElementById(id).value);
    const cfg = {
      type: 'config',
      max_rpm: num('espMaxRpm') || 6000,
      warn_rpm: num('espWarnRpm') || 5500,
      send_ms: num('espSendMs') || 80,
      pulses_per_rev: num('espPulses') || 1,
      wheel_circ_m: num('espWheelCirc') || 0,
      gear_ratio: num('espGearRatio') || 1,
      batt_cells: num('espBattCells') || 1,
      batt_warn_v: num('espBattWarnV') || 3.5,
      batt_crit_v: num('espBattCritV') || 3.3,
      batt_cal: num('espBattCal') || 1.0,
      rpm_ceiling: Math.max(0, num('espRpmCeiling') || 0),
      rpm_alpha: num('espRpmAlpha') || 0.25,
      page_ms: num('espPageMs') || 4000,
    };
    const stEl = _el(r, 'espSendStatus');
    if (!state.serial.connected || !k) {
      if (stEl) stEl.textContent = !state.serial.connected ? 'Nicht verbunden' : 'Kart nicht verbunden';
      return;
    }
    k.batt.cells = cfg.batt_cells;
    try {
      _lastCfgMac = r.mac;
      _sendTo(r.mac, cfg);
      if (stEl) stEl.textContent = '✓ Gesendet — warte auf Bestätigung…';
      clearTimeout(r.ackTimer);
      r.ackTimer = setTimeout(() => {
        const el = _el(r, 'espSendStatus');
        if (el) el.textContent = '⚠ Keine Bestätigung vom Kart — Funkverbindung prüfen';
      }, 3000);
    } catch (e) {
      if (stEl) stEl.textContent = '✗ Fehler';
    }
  };
}

function _renderPalette(r) {
  const row = _el(r, 'kartPaletteRow');
  if (!row) return;
  const cur = kartMetaFor(r.mac, _kartIdx(r.mac)).color;
  row.innerHTML = RasiKartRoster.PALETTE.map((c) =>
    '<span class="kc-sw' + (c === cur ? ' active' : '') + '" data-color="' + c
    + '" style="background:' + c + ';cursor:pointer"></span>').join('');
  row.querySelectorAll('[data-color]').forEach((sw) => {
    sw.onclick = () => {
      const c = sw.getAttribute('data-color');
      updateKartMeta(r.mac, { color: c });
      const colEl = _el(r, 'kartColor');
      if (colEl) colEl.value = c;
      RasiKartBar.render(state);
      renderKartsTab();
      _renderPalette(r);
    };
  });
}

function _refreshWin(r) {
  const m = kartMetaFor(r.mac, _kartIdx(r.mac));
  r.doc.title = m.name + ' — Einstellungen';
  // Fokus-Schutz PRO FENSTER: waehrend der Nutzer in diesem Fenster tippt,
  // keine Eingabefelder ueberschreiben.
  const ae = r.doc.activeElement;
  const typing = !!(ae && (ae.tagName === 'INPUT' || ae.tagName === 'SELECT'));
  if (!typing) {
    const nameEl = _el(r, 'kartName');
    if (nameEl && nameEl.value !== m.name) nameEl.value = m.name;
    const colEl = _el(r, 'kartColor');
    if (colEl && /^#[0-9a-f]{6}$/i.test(m.color) && colEl.value !== m.color.toLowerCase()) {
      colEl.value = m.color.toLowerCase();
    }
    _renderPalette(r);
  }
  _renderCal(r, typing);
  _renderService(r, typing);
  _renderEsp(r);
}

function _renderCal(r, typing) {
  const c = kartCalFor(r.mac);
  const online = !!_liveKart(r.mac);
  for (const [id] of CAL_TOGGLES) { const el = _el(r, id); if (el) el.disabled = !c; }
  if (c) {
    _el(r, 'gxOffsetText').textContent = (Number(c.gxZero) || 0).toFixed(2);
    _el(r, 'gyOffsetText').textContent = (Number(c.gyZero) || 0).toFixed(2);
    for (const [id, key] of CAL_TOGGLES) { const el = _el(r, id); if (el) el.checked = !!c[key]; }
  } else {
    _el(r, 'gxOffsetText').textContent = '--';
    _el(r, 'gyOffsetText').textContent = '--';
  }
  // Live-Aktionen brauchen Telemetrie des Fenster-Karts.
  if (_el(r, 'zeroImuBtn')) _el(r, 'zeroImuBtn').disabled = !online || r.zeroBusy;
  if (_el(r, 'zeroRollBtn')) _el(r, 'zeroRollBtn').disabled = !online;
  if (_el(r, 'resetImuBtn')) _el(r, 'resetImuBtn').disabled = !c;
  _el(r, 'kartCalHint').textContent = !c ? 'Keine Kalibrierdaten für dieses Kart.'
    : (online ? '' : 'Kart offline — Nullpunkt/Roll nullen erst bei Live-Telemetrie.');
}

function _renderService(r, typing) {
  const e = kartEngineFor(r.mac);
  const grid = _el(r, 'kartServiceStats');
  if (!e) {
    if (grid) grid.innerHTML = '<div class="dstat"><span>Motorstunden</span><b>--</b></div>';
    if (_el(r, 'kartServiceInterval')) _el(r, 'kartServiceInterval').disabled = true;
    if (_el(r, 'kartServiceBtn')) _el(r, 'kartServiceBtn').disabled = true;
    return;
  }
  const due = RasiEngine.serviceDue(e.totalMs, e.lastServiceMs, e.serviceIntervalH);
  if (grid) grid.innerHTML = '<div class="dstat"><span>Motorlaufzeit</span><b>' + RasiEngine.hoursText(e.totalMs) + '</b></div>'
    + '<div class="dstat"><span>Seit Wartung</span><b>' + RasiEngine.hoursText(RasiEngine.sinceServiceMs(e.totalMs, e.lastServiceMs)) + '</b></div>'
    + (due ? '<div class="dstat"><span>Status</span><b class="kc-warn">🔧 fällig</b></div>' : '');
  const ivEl = _el(r, 'kartServiceInterval');
  if (ivEl) {
    ivEl.disabled = false;
    if (!typing) ivEl.value = e.serviceIntervalH;
  }
  if (_el(r, 'kartServiceBtn')) _el(r, 'kartServiceBtn').disabled = false;
}

function _renderEsp(r) {
  const online = !!_liveKart(r.mac);
  const usable = online && !!(state.serial && state.serial.connected);
  for (const [id] of ESP_CFG_FIELDS) { const el = _el(r, id); if (el) el.disabled = !usable; }
  if (_el(r, 'espSendBtn')) _el(r, 'espSendBtn').disabled = !usable;
  // Status nur bei ZUSTANDSWECHSEL schreiben — Sende-/Ack-Meldungen sonst
  // nicht bei jedem 1-Hz-Refresh ueberschreiben.
  if (usable !== r.lastEspUsable) {
    r.lastEspUsable = usable;
    const el = _el(r, 'espSendStatus');
    if (el) el.textContent = usable ? ''
      : (online ? 'Bridge nicht verbunden' : 'Kart nicht verbunden — Konfig erscheint bei Live-Telemetrie');
  }
}

// config_ack-Zustellung: from_mac -> Fenster dieses Karts; ohne from_mac
// (alte Firmware) -> zuletzt anfragendes Fenster; sonst verwerfen.
function routeConfigAck(d) {
  const mac = RasiKartRoster.ackTargetMac(d.from_mac, _lastCfgMac, Array.from(_wins.keys()));
  const r = mac ? _wins.get(mac) : null;
  if (!r || !r.win || r.win.closed) return;
  clearTimeout(r.ackTimer);
  r.ackTimer = null;
  applyEspConfigAck(d, r.doc);
}

// 1-Hz-Hook (live-ui.js): geschlossene Fenster aufraeumen, verschwundene
// Roster-Karts schliessen (Demo-Ende, Vergessen), Rest aktualisieren.
function refreshKartSettingsWindows() {
  if (!_wins.size) return;
  const roster = kartRosterMacs();
  for (const [mac, r] of _wins) {
    if (!r.win || r.win.closed) { _wins.delete(mac); continue; }
    if (roster.indexOf(mac) === -1) {
      try { r.win.close(); } catch (e) {}
      _wins.delete(mac);
      continue;
    }
    try { _refreshWin(r); } catch (e) { console.warn('kartSettingsRefresh:', e); }
  }
}

function closeAllKartSettings() {
  for (const [, r] of _wins) {
    try { if (r.win && !r.win.closed) r.win.close(); } catch (e) {}
  }
  _wins.clear();
}

function initKartSettingsWindows() {
  // Reload/Schliessen des Hauptfensters: Kinder haetten sonst keine Logik
  // mehr (alle Handler leben hier im Haupt-Renderer).
  window.addEventListener('beforeunload', closeAllKartSettings);
}

// ESM-Export (Phase 48)
export { openKartSettings, refreshKartSettingsWindows, closeAllKartSettings,
         initKartSettingsWindows, routeConfigAck };
