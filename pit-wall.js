'use strict';
// ============================================================
//  RasiCross -- pit-wall.js  (Pit-Wall + Connection-Tab + Pit-Call +
//  Kart-Display, Phase 23). Klassisches Script im gemeinsamen Global-
//  Scope: nutzt state/$/esc/setText, Dialoge, geo-Formatter, races.js,
//  laps-drivers.js, live-ui.js (drawChart), window.rasiSerial.
//  Nur Deklarationen auf Top-Level -- kein Code laeuft beim Laden.
// ============================================================

// ============================================================
// 18. PIT-WALL
// ============================================================
function openPitWall() {
  $('pitwallOverlay').classList.add('show');
  document.addEventListener('keydown', pwKeyHandler);
  pwKeepAwake(true);
}
function closePitWall() {
  $('pitwallOverlay').classList.remove('show');
  document.removeEventListener('keydown', pwKeyHandler);
  pwKeepAwake(false);
}
function pwKeyHandler(e) { if (e.key === 'Escape' || e.key === 'F11') closePitWall(); }
// Bildschirm-Standby unterdruecken solange die Pit Wall offen ist:
// Electron via powerSaveBlocker (rasiPower), Browser via Wake-Lock-API.
let _pwWakeLock = null;
async function pwKeepAwake(on) {
  try {
    if (window.rasiPower?.keepAwake) { await window.rasiPower.keepAwake(on); return; }
    if (on && navigator.wakeLock?.request) {
      _pwWakeLock = await navigator.wakeLock.request('screen');
    } else if (!on && _pwWakeLock) {
      await _pwWakeLock.release(); _pwWakeLock = null;
    }
  } catch (e) { /* Standby-Schutz ist nice-to-have -- still scheitern */ }
}
// Lap-Hold: nach Rundenende bleibt die fertige Zeit 5 s stehen (PB gruen)
const PW_LAP_HOLD_MS = 5000;
let _pwSeenRaceId = null;
let _pwSeenLapCount = 0;
let _pwHold = null;            // { text, pb, until }
function updatePitWall() {
  const ov = $('pitwallOverlay');
  if (!ov || !ov.classList.contains('show')) return;
  const t = state.telemetry;
  const now = Date.now();
  // Top info
  setText('pwSession', fmtClock(now - state.sessionStart));
  const r = activeRace();
  // Phase 30: Pit-Wall zeigt Runden des aktiven Karts (Teilnehmer-Slot).
  const _pwPart = r ? RasiLapEngine.partOf(r, state.activeKartMac || KartRegistry.DEFAULT_MAC) : null;
  const validLaps = _pwPart ? RasiLapEngine.partValidLaps(_pwPart).length : 0;
  setText('pwLapCount', r && r.lengthType === 'laps' && r.targetLaps
    ? `${validLaps} / ${r.targetLaps}` : validLaps);
  // Restzeit nur bei Zeit-Rennen
  const remWrap = $('pwRemainWrap');
  if (remWrap) {
    const isTimeRace = r && r.lengthType === 'time' && r.durationMs > 0;
    remWrap.style.display = isTimeRace ? '' : 'none';
    if (isTimeRace) setText('pwRemain', fmtClock(Math.max(0, r.durationMs - raceElapsedMs(r))));
  }
  // Speed
  setText('pwSpeed', Math.round(t.speed));
  setText('pwSpeedMax', Math.round(state.max.speed));
  // Delta
  const dEl = $('pwDelta');
  if (dEl) {
    if (state.liveDelta != null) {
      dEl.textContent = (state.liveDelta >= 0 ? '+' : '') + (state.liveDelta / 1000).toFixed(3);
      dEl.className = 'pw-delta-val ' + (Math.abs(state.liveDelta) < 50 ? 'same' : state.liveDelta < 0 ? 'faster' : 'slower');
    } else {
      // Ohne Referenzrunde kein "+0.000" vorgaukeln
      dEl.textContent = '—';
      dEl.className = 'pw-delta-val same';
    }
  }
  setText('pwDeltaRef', state.bestLapMs ? `vs. Runde ${state.bestLapNum} (${fmtMs(state.bestLapMs)})` : 'vs. beste Runde');
  // Lap -- neue fertige Runde erkennen und 5 s halten
  const _pwLaps = _pwPart ? _pwPart.laps : [];
  if (r && r.id === _pwSeenRaceId && _pwLaps.length > _pwSeenLapCount) {
    const last = _pwLaps[_pwLaps.length - 1];
    _pwHold = { text: fmtMs(last.timeMs), pb: state.bestLapNum === last.number, until: now + PW_LAP_HOLD_MS };
  } else if (!r || r.id !== _pwSeenRaceId) {
    _pwHold = null;
  }
  _pwSeenRaceId = r ? r.id : null;
  _pwSeenLapCount = r ? _pwLaps.length : 0;
  const lapEl = $('pwLap');
  if (lapEl) {
    if (_pwHold && now < _pwHold.until) {
      lapEl.textContent = _pwHold.text;
      lapEl.className = 'pw-side-val hold' + (_pwHold.pb ? ' pb' : '');
    } else {
      _pwHold = null;
      lapEl.textContent = state.lapStart ? fmtMs(now - state.lapStart) : '--:--.---';
      lapEl.className = 'pw-side-val';
    }
  }
  setText('pwBestLap', state.bestLapMs ? fmtMs(state.bestLapMs) : '--:--.---');
  const _tb = theoreticalBestMs();
  setText('pwTheoLap', _tb ? fmtMs(_tb) : '--:--.---');
  // Sectors
  const s = state.sectors;          // Konfiguration (global)
  const sl = state.sectorsLive;     // Live-Sektorzeiten (pro Kart)
  for (let i = 0; i < 3; i++) {
    let t2 = sl.lapSectors[i];
    if (!t2 && sl.lastLapSectors) t2 = sl.lastLapSectors[i];
    const best = s.best[i];
    const el = $('pwS' + (i + 1));
    if (el) {
      el.textContent = t2 ? fmtMs(t2) : '--';
      el.className = 'pw-sector-time' + (t2 && best ? (t2 <= best ? ' best' : ' slower') : '');
    }
  }
  // Footer
  const drv = r ? state.drivers.find(d => d.id === r.currentDriverId) : null;
  setText('pwDriver', drv ? drv.name : '--');
  setText('pwRpm', Math.round(t.rpm).toLocaleString('de-DE'));
  const g = Math.sqrt(t.gx * t.gx + t.gy * t.gy);
  setText('pwG', g.toFixed(1));
  // Status farbcodiert -- aus Distanz ohne Lesen erkennbar
  const stEl = $('pwStatus');
  if (stEl) {
    const src = state.connection.source;
    stEl.textContent = src === 'serial' ? 'USB' : src === 'demo' ? 'DEMO' : 'OFF';
    stEl.className = 'pw-foot-v ' + (src === 'serial' ? 'ok' : src === 'demo' ? 'warn' : 'off');
  }
}

// ============================================================

// ============================================================

// ============================================================
// CONNECTION TAB Updates
// ============================================================
let _packetLog = [];
// RSSI-Sparkline (Phase 24): 1Hz-Historie (max 3 min), gezeichnet im
// Verbindungs-Tab. Kein Persist -- Session-Verlauf reicht fuer Funkloecher.
const RSSI_HIST_MAX = 180;
let _rssiHist = [];
function drawRssiSparkline() {
  const cv = $('rssiSpark');
  if (!cv) return;
  const ctx = cv.getContext('2d');
  if (!ctx) return;
  const w = cv.width, h = cv.height;
  ctx.clearRect(0, 0, w, h);
  if (_rssiHist.length < 2) return;
  const MIN = -100, MAX = -30;            // dBm-Skala
  const y = v => h - 2 - ((Math.max(MIN, Math.min(MAX, v)) - MIN) / (MAX - MIN)) * (h - 4);
  // Schwellen-Linie (-85 dBm = "Schwach")
  ctx.strokeStyle = 'rgba(255,255,255,0.10)';
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(0, y(-85)); ctx.lineTo(w, y(-85)); ctx.stroke();
  // Verlauf
  const last = _rssiHist[_rssiHist.length - 1];
  const color = last > -70 ? (css('--green') || '#5ad17a')
              : last > -85 ? (css('--orange') || '#f0a050')
              : (css('--red') || '#e05555');
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  for (let i = 0; i < _rssiHist.length; i++) {
    const x = (i / (RSSI_HIST_MAX - 1)) * w;
    if (i === 0) ctx.moveTo(x, y(_rssiHist[i])); else ctx.lineTo(x, y(_rssiHist[i]));
  }
  ctx.stroke();
  // Endpunkt
  const xe = ((_rssiHist.length - 1) / (RSSI_HIST_MAX - 1)) * w;
  ctx.fillStyle = color;
  ctx.beginPath(); ctx.arc(xe, y(last), 2.4, 0, Math.PI * 2); ctx.fill();
}
function renderConnKartList() {
  const list = $('connKartList');
  const resetBtn = $('resetKartsBtn');
  if (!list) return;
  const macs = state.karts.macs();
  const multi = macs.length > 1;
  list.style.display = multi ? 'flex' : 'none';
  if (resetBtn) resetBtn.style.display = multi ? 'inline-flex' : 'none';
  if (resetBtn && !resetBtn._bound) { resetBtn._bound = true; resetBtn.onclick = resetKarts; }
  if (!multi) { list.innerHTML = ''; return; }
  const now = Date.now();
  list.innerHTML = macs.map((mac, i) => {
    const k = state.karts.get(mac);
    if (!k) return '';
    const m = window.RasiKartBar ? RasiKartBar.metaFor(state, mac, i) : { name: mac, color: '#3aa0e8' };
    const age = k.connection.lastPacketAt ? (now - k.connection.lastPacketAt) : 99999;
    const hz = (state._kartHz && state._kartHz[mac] != null) ? state._kartHz[mac] : '--';
    const rssi = (k.connection.rssi != null) ? (k.connection.rssi + 'dBm') : '--';
    const batt = (k.batt && k.batt.present) ? ((k.batt.soc | 0) + '%') : '--';
    const rec = k.recording.armed ? '<span class="ckr-rec">●REC</span>' : '';
    const ageStr = age < 99999 ? (age / 1000).toFixed(1) + 's' : '--';
    const cls = 'conn-kart-row' + (mac === state.activeKartMac ? ' active' : '') + (age > 2000 ? ' stale' : '');
    return '<div class="' + cls + '" data-mac="' + mac + '">'
      + '<span class="ckr-dot" style="background:' + m.color + '"></span>'
      + '<span class="ckr-name">' + esc(m.name) + '</span>'
      + '<span class="ckr-stats">'
      +   '<span>' + hz + 'Hz</span><span>' + rssi + '</span>'
      +   '<span>L:' + (k.connection.lost || 0) + '</span><span>' + ageStr + '</span>'
      +   '<span>' + batt + '</span>' + rec
      + '</span></div>';
  }).join('');
  list.querySelectorAll('.conn-kart-row').forEach(row => {
    row.onclick = () => {
      const mac = row.getAttribute('data-mac');
      if (state.karts.setActive(mac)) {
        state.activeKartMac = mac;
        renderConnKartList();
        if (window.RasiKartBar) RasiKartBar.render(state);
      }
    };
  });
}

async function resetKarts() {
  if (!await rcConfirm('Alle bekannten Karts vergessen? Namen/Farben bleiben erhalten.',
      'Karts zurücksetzen', 'Zurücksetzen', true)) return;
  state.karts.reset();
  state._kartHz = {};
  state.activeKartMac = null;
  if (state.serial && state.serial.connected && window.rasiSerial && window.rasiSerial.writeLine) {
    try { window.rasiSerial.writeLine(JSON.stringify({ type: 'reset_karts' })); } catch (e) {}
  }
  if (typeof rcToast === 'function') rcToast('Alle Karts zurückgesetzt');
  renderConnKartList();
  if (window.RasiKartBar) RasiKartBar.render(state);
}

function renderConnectionTab() {
  try {
    const c = state.connection;
    renderConnKartList();
    const _am = state.activeKartMac;
    const _meta = (window.RasiKartBar && _am) ? RasiKartBar.metaFor(state, _am, 0) : null;
    setText('connDetailTitle', _meta ? ('Detail: ' + _meta.name) : '');
    // Pills oben
    setText('connModePill', c.source === 'serial' ? 'USB Serial' : c.source === 'demo' ? 'Demo' : 'Offline');
    setText('connBridgeState', state.serial.connected ? 'Online' : 'Offline');
    setText('connPacketsMini', c.packets.toLocaleString('de-DE'));
    // Overview
    setText('connOverviewState', c.source === 'serial' ? 'Verbunden' : c.source === 'demo' ? 'Demo' : 'Offline');
    setText('connOverviewHz', (state._lastHz || 0) + ' Hz');
    setText('connOverviewLost', c.lost);
    setText('connOverviewGps', state.gps.fix ? 'Fix' : '--');
    setText('connOverviewSignal', c.rssi != null ? c.rssi + ' dBm' : '--');
    // Diagram
    setText('kartStatePill', c.lastPacketAt ? (Date.now() - c.lastPacketAt < 2000 ? 'aktiv' : 'inaktiv') : 'wartet');
    setText('kartMainValue', state.telemetry.speed.toFixed(0) + ' km/h');
    setText('pitStatePill', state.serial.connected ? 'online' : c.source === 'demo' ? 'demo' : 'offline');
    setText('pitMainValue', state.serial.connected ? 'USB' : c.source === 'demo' ? 'DEMO' : 'OFF');
    setText('connSeq', c.seq != null ? c.seq : '--');
    setText('connAge', c.lastPacketAt ? ((Date.now() - c.lastPacketAt) / 1000).toFixed(1) + 's' : '--');
    setText('connSpeed', state.telemetry.speed.toFixed(0));
    setText('connRpm', Math.round(state.telemetry.rpm));
    setText('connUsbState', state.serial.connected ? 'ON' : 'OFF');
    setText('connHz', state._lastHz || 0);
    setText('connRssi', c.rssi != null ? c.rssi + ' dBm' : '--');
    setText('connLost', c.lost);
    setText('connBridgeMac', c.bridgeMac || '--');
    setText('connRasiMac', c.kartMac || '--');
    setText('connGpsFix', state.gps.fix ? 'Fix' : 'kein Fix');
    setText('connGpsAge', state.gps.lastAt ? ((Date.now() - state.gps.lastAt) / 1000).toFixed(1) + 's' : '--');
    // Signal-Bars
    const bars = document.querySelectorAll('#signalBars i');
    if (bars.length === 4 && c.rssi != null) {
      const r = c.rssi;
      let lvl = r > -55 ? 4 : r > -70 ? 3 : r > -85 ? 2 : r > -95 ? 1 : 0;
      bars.forEach((b, i) => {
        b.classList.remove('on', 'warn');
        if (i < lvl) b.classList.add(lvl <= 2 ? 'warn' : 'on');
      });
      setText('connQualityText', lvl >= 3 ? 'Sehr gut' : lvl === 2 ? 'OK' : lvl === 1 ? 'Schwach' : 'Verloren');
    } else {
      bars.forEach(b => b.classList.remove('on', 'warn'));
      setText('connQualityText', 'Keine Daten');
    }
    setText('connLatency', c.lastPacketAt ? Math.round(Date.now() - c.lastPacketAt) : '--');
    // RSSI-Historie (1Hz, da dieser Renderer im 1Hz-Loop laeuft)
    if (c.rssi != null && (c.source === 'serial' || c.source === 'demo')) {
      _rssiHist.push(c.rssi);
      if (_rssiHist.length > RSSI_HIST_MAX) _rssiHist.shift();
    }
    drawRssiSparkline();
    setText('connRawG', `${state.raw.gx.toFixed(2)} / ${state.raw.gy.toFixed(2)}`);
    setText('connPulseHz', state.raw.pulseHz?.toFixed(1) || '--');
    setText('connPulseCount', state.raw.pulseCount || '--');
    setText('connErrCount', c.errors);
    // Packet log
    const log = $('packetLog');
    if (log && _packetLog.length) {
      log.innerHTML = _packetLog.slice(0, 8).map(p =>
        `<div><b>${p.t}</b><span>${esc(p.line.slice(0, 200))}</span></div>`
      ).join('');
    }
  } catch (e) { console.warn('renderConnectionTab:', e); }
}
function pushPacketLog(line) {
  _packetLog.unshift({ t: logTime(), line: line });
  _packetLog = _packetLog.slice(0, 20);
}
function toggleDiagnose() {
  document.body.classList.toggle('diagnose-on');
  const btn = $('diagToggleBtn');
  if (btn) btn.classList.toggle('primary', document.body.classList.contains('diagnose-on'));
}

// PIT-CALL — Boxenruf an Sender-ESP
// ============================================================
let _pitCallActive = false;
let _pitCallTimer = null;

// ============================================================
// Dashboard → Kart: Live Race-Display Update
// ============================================================
function buildRaceDataForKart() {
  const r = activeRace();
  // Auch ohne Race wird page-Auswahl uebermittelt (kleines Paket)
  if (!r || (r.status !== 'running' && r.status !== 'paused')) {
    return {
      type: 'display',
      page: state.settings.oledPage || 'auto',
      // Race-Felder bleiben leer/default
      sectors: ['open', 'open', 'open'],
    };
  }
  const drv = state.drivers.find(d => d.id === r.currentDriverId);
  // Sektor-States: 'done' bei abgeschlossenen, 'current' beim aktiven, 'open' sonst
  const cur = state.sectorsLive.cur || 0;
  const lapSec = state.sectorsLive.lapSectors || [null, null, null];
  const sectorStates = ["open", "open", "open"];
  for (let i = 0; i < 3; i++) {
    if (lapSec[i] != null) sectorStates[i] = "done";
    else if (i === cur && state.lapStart) sectorStates[i] = "current";
  }
  // Aktuelle Rundenzeit (mm:ss.SSS)
  const lapMs = state.lapStart ? Date.now() - state.lapStart : 0;
  const lapStr = state.lapStart ? fmtMs(lapMs) : "--:--.---";
  // Delta vs Bestzeit (nur Sektor-Delta wenn gerade Rundenzeit nicht final ist)
  let deltaStr = "--";
  let liveDeltaStr = "--";
  let liveDeltaMs = null;
  if (state.liveDelta != null) {
    const sign = state.liveDelta >= 0 ? "+" : "";
    liveDeltaStr = sign + (state.liveDelta / 1000).toFixed(3);
    liveDeltaMs = state.liveDelta;
    deltaStr = liveDeltaStr;
  }
  // Bestzeit als string
  const bestStr = state.bestLapMs ? fmtMs(state.bestLapMs) : "--";
  // Runden-Counter — Phase 32: Runden des AKTIVEN Karts (Teilnehmer-Slot),
  // nicht die Summe aller Karts (raceValidLaps aggregiert seit Phase 30).
  const _oledPart = RasiLapEngine.partOf(r, state.activeKartMac || KartRegistry.DEFAULT_MAC);
  const validLaps = RasiLapEngine.partValidLaps(_oledPart).length;
  let target = "--";
  if (r.lengthType === 'laps') target = r.targetLaps;
  else if (r.lengthType === 'time') target = "T";
  // Restzeit (nur bei Time-Races) und gefahrene Zeit
  let remainingMs = null;
  let elapsedMs = raceElapsedMs(r);
  if (r.lengthType === 'time' && r.durationMs > 0) {
    remainingMs = Math.max(0, r.durationMs - elapsedMs);
  }
  // Driver-Name max 8 Zeichen, Nummer max 3
  const driverName = drv ? drv.name.slice(0, 8) : "--";
  const driverNum = drv ? String(drv.number || "").slice(0, 3) : "";
  return {
    type:           "display",
    driver:         driverName,
    num:            driverNum,
    lap:            lapStr,
    lap_ms:         state.lapStart ? lapMs : null,    // Kart-seitiger Anker
    lapn:           validLaps + 1,
    target:         target,
    delta:          deltaStr,
    live_delta:     liveDeltaStr,
    live_delta_ms:  liveDeltaMs,
    live_delta_ref: state.bestLapNum || null,
    best_lap:       bestStr,
    sectors:        sectorStates,
    elapsed_ms:     elapsedMs,
    remaining_ms:   remainingMs,
    length_type:    r.lengthType,
    page:           state.settings.oledPage || 'auto',
    running:        r.status === 'running' && !!state.lapStart,
    pit:            !!_pitCallActive,
  };
}
// Sendekriterium (D1-gamma): nur bei struktureller Aenderung oder
// alle 5 s als Keepalive. Spart RF-Traffic; OLED-Uhr laeuft kart-
// seitig per utime weiter.
let _lastDisplayKey = '';
let _lastDisplayAt = 0;
const RC_DISPLAY_KEEPALIVE_MS = 5000;
function sendDisplayUpdate() {
  if (state.connection.source !== 'serial' || !state.serial.connected) return;
  if (!window.rasiSerial?.writeLine) return;
  const payload = buildRaceDataForKart();
  if (!payload) return;
  const key = structuralRaceKey(payload);
  const now = Date.now();
  if (key === _lastDisplayKey && (now - _lastDisplayAt) < RC_DISPLAY_KEEPALIVE_MS) return;
  try {
    window.rasiBridgeSend(payload);   // an den ausgewaehlten Kart (target_mac)
    _lastDisplayKey = key;
    _lastDisplayAt = now;
  } catch (e) {
    // stumm - keine Hupe wenn der Sender mal nicht erreichbar ist
  }
}

let _displayUpdateTimer = null;
function restartDisplayUpdateInterval() {
  if (_displayUpdateTimer) clearInterval(_displayUpdateTimer);
  const ms = state.settings.displayUpdateMs || 500;
  _displayUpdateTimer = setInterval(sendDisplayUpdate, ms);
}


function sendPitCall(message, durationMs = 15000) {
  if (state.connection.source !== 'serial' || !state.serial.connected) {
    rcAlert('Kein USB verbunden. Pit-Call nicht moeglich.', 'Pit-Call');
    return false;
  }
  try {
    window.rasiBridgeSend({
      type: 'pit_call',
      action: 'trigger',
      message: (message || 'PIT STOP').slice(0, 14),
      duration_ms: durationMs
    });
    return true;
  } catch (e) {
    rcAlert('Pit-Call Senden fehlgeschlagen:\n' + (e?.message || e), 'Fehler');
    return false;
  }
}
function cancelPitCall() {
  if (state.connection.source !== 'serial' || !state.serial.connected) return false;
  try {
    window.rasiBridgeSend({ type: 'pit_call', action: 'cancel' });
    return true;
  } catch (e) { return false; }
}
function togglePitCall() {
  const btn = $('pitCallBtn');
  if (!btn) return;
  if (_pitCallActive) {
    // Bereits aktiv -> abbrechen
    cancelPitCall();
    _pitCallActive = false;
    btn.classList.remove('active');
    btn.textContent = '📢 BOX';
    if (_pitCallTimer) { clearTimeout(_pitCallTimer); _pitCallTimer = null; }
    rcToast('Pit-Call abgebrochen');
    return;
  }
  // Aktivieren
  if (state.connection.source === 'demo') {
    // Demo: lokal zeigen (kein echter ESP)
    _pitCallActive = true;
    btn.classList.add('active');
    btn.textContent = '⏹ STOP';
    rcToast('Demo: Pit-Call aktiviert (15s)', 2500);
    _pitCallTimer = setTimeout(() => {
      _pitCallActive = false;
      btn.classList.remove('active');
      btn.textContent = '📢 BOX';
      _pitCallTimer = null;
    }, 15000);
    return;
  }
  if (sendPitCall('PIT STOP', 15000)) {
    _pitCallActive = true;
    btn.classList.add('active');
    btn.textContent = '⏹ STOP';
    rcToast('Pit-Call gesendet — Mäher wird benachrichtigt', 3000);
    _pitCallTimer = setTimeout(() => {
      _pitCallActive = false;
      btn.classList.remove('active');
      btn.textContent = '📢 BOX';
      _pitCallTimer = null;
    }, 15000);
  }
}

// Interface-Marker: von rasicross.js (init-Bindings, 1Hz-Loop)/serial-demo.js
// genutzte Funktionen -- verhindert no-unused-vars, dokumentiert das API.
void [openPitWall, closePitWall, pwKeyHandler, updatePitWall,
      renderConnectionTab, pushPacketLog, toggleDiagnose,
      buildRaceDataForKart, sendDisplayUpdate, restartDisplayUpdateInterval,
      sendPitCall, cancelPitCall, togglePitCall,
      renderConnKartList, resetKarts];

window.renderConnectionTab = renderConnectionTab;
