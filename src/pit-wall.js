// ============================================================
//  RasiCross -- pit-wall.js  (Pit-Wall + Connection-Tab + Pit-Call +
//  Kart-Display, Phase 23). ESM (Phase 42): explizite Imports statt
//  gemeinsamem Global-Scope. window.rasiSerial/rasiPower/rasiBridgeSend
//  bleiben window-APIs (Preload/contextBridge, keine Module).
//  Nur Deklarationen auf Top-Level -- kein Code laeuft beim Laden.
// ============================================================
import { fmtClock, fmtMs, structuralRaceKey } from './geo.js';
import { state, $, setText, rcAlert, rcToast, activeKart } from './rasicross.js';
import { activeRace, raceElapsedMs } from './races.js';
import { theoreticalBestMs } from './laps-drivers.js';
import KartRegistry from './kart-registry.js';
import RasiLapEngine from './lap-engine.js';

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
  const k = activeKart();
  const t = k.telemetry;
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
  setText('pwSpeedMax', Math.round(k.max.speed));
  // Delta
  const dEl = $('pwDelta');
  if (dEl) {
    if (k.liveDelta != null) {
      dEl.textContent = (k.liveDelta >= 0 ? '+' : '') + (k.liveDelta / 1000).toFixed(3);
      dEl.className = 'pw-delta-val ' + (Math.abs(k.liveDelta) < 50 ? 'same' : k.liveDelta < 0 ? 'faster' : 'slower');
    } else {
      // Ohne Referenzrunde kein "+0.000" vorgaukeln
      dEl.textContent = '—';
      dEl.className = 'pw-delta-val same';
    }
  }
  setText('pwDeltaRef', k.bestLapMs ? `vs. Runde ${k.bestLapNum} (${fmtMs(k.bestLapMs)})` : 'vs. beste Runde');
  // Lap -- neue fertige Runde erkennen und 5 s halten
  const _pwLaps = _pwPart ? _pwPart.laps : [];
  if (r && r.id === _pwSeenRaceId && _pwLaps.length > _pwSeenLapCount) {
    const last = _pwLaps[_pwLaps.length - 1];
    _pwHold = { text: fmtMs(last.timeMs), pb: k.bestLapNum === last.number, until: now + PW_LAP_HOLD_MS };
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
      lapEl.textContent = k.lapStart ? fmtMs(now - k.lapStart) : '--:--.---';
      lapEl.className = 'pw-side-val';
    }
  }
  setText('pwBestLap', k.bestLapMs ? fmtMs(k.bestLapMs) : '--:--.---');
  const _tb = theoreticalBestMs();
  setText('pwTheoLap', _tb ? fmtMs(_tb) : '--:--.---');
  // Sectors
  const s = state.sectors;          // Konfiguration (global)
  const sl = k.sectorsLive;         // Live-Sektorzeiten (pro Kart)
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
    const src = k.connection.source;
    stEl.textContent = src === 'serial' ? 'USB' : src === 'demo' ? 'DEMO' : 'OFF';
    stEl.className = 'pw-foot-v ' + (src === 'serial' ? 'ok' : src === 'demo' ? 'warn' : 'off');
  }
}

// Phase 56: Der Connection-Tab-Renderer (renderConnectionTab), Paket-Log
// und die RSSI-Sparkline sind nach conn-ui.js umgezogen -- die Verbindungs-
// seite hat dort ihren einzigen 1-Hz-Writer.

// PIT-CALL — Boxenruf an Sender-ESP
// ============================================================
let _pitCallActive = false;
let _pitCallTimer = null;
// Phase 40: Ziel-Kart des laufenden Pit-Calls — nur dessen Display-Payload
// bekommt pit:true.
let _pitCallMac = null;

// ============================================================
// Dashboard → Kart: Live Race-Display Update
// ============================================================
function buildRaceDataForKart(mac) {
  // Phase 40: Payload fuer EINEN Kart (Bucket + Teilnehmer-Slot). Ohne
  // Argument: aktiver Kart (bisheriges Verhalten der Aufrufer).
  mac = mac || state.activeKartMac || KartRegistry.DEFAULT_MAC;
  const r = activeRace();
  const k = state.karts.has(mac) ? state.karts.get(mac) : null;
  const part = r ? RasiLapEngine.partOf(r, mac) : null;
  // Ohne Race/Bucket/Teilnahme wird nur die page-Auswahl uebermittelt
  // (kleines Paket; die OLED-Page-Wahl ist global).
  if (!r || (r.status !== 'running' && r.status !== 'paused') || !k || !part) {
    return {
      type: 'display',
      page: state.settings.oledPage || 'auto',
      // Race-Felder bleiben leer/default
      sectors: ['open', 'open', 'open'],
    };
  }
  // Phase 40: Fahrer DIESES Karts (Teilnehmer-Slot, per-Kart seit Phase 35).
  const drv = state.drivers.find(d => d.id === part.currentDriverId);
  // Sektor-States: 'done' bei abgeschlossenen, 'current' beim aktiven, 'open' sonst
  const cur = k.sectorsLive.cur || 0;
  const lapSec = k.sectorsLive.lapSectors || [null, null, null];
  const sectorStates = ["open", "open", "open"];
  for (let i = 0; i < 3; i++) {
    if (lapSec[i] != null) sectorStates[i] = "done";
    else if (i === cur && k.lapStart) sectorStates[i] = "current";
  }
  // Aktuelle Rundenzeit (mm:ss.SSS)
  const lapMs = k.lapStart ? Date.now() - k.lapStart : 0;
  const lapStr = k.lapStart ? fmtMs(lapMs) : "--:--.---";
  // Delta vs Bestzeit dieses Karts (per-Kart-liveDelta, Phase 40/Task 2)
  let deltaStr = "--";
  let liveDeltaStr = "--";
  let liveDeltaMs = null;
  if (k.liveDelta != null) {
    const sign = k.liveDelta >= 0 ? "+" : "";
    liveDeltaStr = sign + (k.liveDelta / 1000).toFixed(3);
    liveDeltaMs = k.liveDelta;
    deltaStr = liveDeltaStr;
  }
  // Bestzeit dieses Karts (Teilnehmer-Slot, Fallback Registry-Bucket)
  const bestMs = part.bestLapMs != null ? part.bestLapMs : k.bestLapMs;
  const bestNum = part.bestLapNum != null ? part.bestLapNum : k.bestLapNum;
  const bestStr = bestMs ? fmtMs(bestMs) : "--";
  const validLaps = RasiLapEngine.partValidLaps(part).length;
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
    lap_ms:         k.lapStart ? lapMs : null,    // Kart-seitiger Anker
    lapn:           validLaps + 1,
    target:         target,
    delta:          deltaStr,
    live_delta:     liveDeltaStr,
    live_delta_ms:  liveDeltaMs,
    live_delta_ref: bestNum || null,
    best_lap:       bestStr,
    sectors:        sectorStates,
    elapsed_ms:     elapsedMs,
    remaining_ms:   remainingMs,
    length_type:    r.lengthType,
    page:           state.settings.oledPage || 'auto',
    running:        r.status === 'running' && !!k.lapStart,
    pit:            !!(_pitCallActive && _pitCallMac === mac),
  };
}
// Sendekriterium (D1-gamma): nur bei struktureller Aenderung oder
// alle 5 s als Keepalive. Spart RF-Traffic; OLED-Uhr laeuft kart-
// seitig per utime weiter.
// Phase 40: Dedupe pro Ziel-MAC — jedes Kart bekommt SEINE Daten.
let _lastDisplayKeyByMac = {};
let _lastDisplayAtByMac = {};
const RC_DISPLAY_KEEPALIVE_MS = 5000;
function sendDisplayUpdate() {
  if (activeKart().connection.source !== 'serial' || !state.serial.connected) return;
  if (!window.rasiSerial?.writeLine) return;
  const now = Date.now();
  // Leere Registry -> ein Paket ohne target_mac (Bridge-Fallback = zuletzt
  // gehoerter Kart, bisheriges Single-Kart-Verhalten).
  const macs = state.karts.macs();
  const targets = macs.length ? macs : [null];
  for (const mac of targets) {
    // Demo-Karts sind keine Funk-Ziele (Mischfall Serial + Demo-Reste).
    if (mac && mac.indexOf('DE:MO:') === 0) continue;
    const payload = buildRaceDataForKart(mac || undefined);
    if (!payload) continue;
    const dedupeKey = mac || '_single';
    const key = structuralRaceKey(payload);
    if (key === _lastDisplayKeyByMac[dedupeKey]
        && (now - (_lastDisplayAtByMac[dedupeKey] || 0)) < RC_DISPLAY_KEEPALIVE_MS) continue;
    // target_mac explizit setzen — der rasiBridgeSend-Default wuerde sonst
    // immer den AKTIVEN Kart adressieren. default-Bucket: Bridge-Fallback.
    if (mac && mac !== KartRegistry.DEFAULT_MAC) payload.target_mac = mac;
    try {
      window.rasiBridgeSend(payload);
      _lastDisplayKeyByMac[dedupeKey] = key;
      _lastDisplayAtByMac[dedupeKey] = now;
    } catch (e) {
      // stumm - keine Hupe wenn der Sender mal nicht erreichbar ist
    }
  }
}

let _displayUpdateTimer = null;
function restartDisplayUpdateInterval() {
  if (_displayUpdateTimer) clearInterval(_displayUpdateTimer);
  const ms = state.settings.displayUpdateMs || 500;
  _displayUpdateTimer = setInterval(sendDisplayUpdate, ms);
}


function sendPitCall(message, durationMs = 15000) {
  if (activeKart().connection.source !== 'serial' || !state.serial.connected) {
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
  if (activeKart().connection.source !== 'serial' || !state.serial.connected) return false;
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
    _pitCallMac = null;
    btn.classList.remove('active');
    btn.textContent = '📢 BOX';
    if (_pitCallTimer) { clearTimeout(_pitCallTimer); _pitCallTimer = null; }
    rcToast('Pit-Call abgebrochen');
    return;
  }
  // Aktivieren
  if (activeKart().connection.source === 'demo') {
    // Demo: lokal zeigen (kein echter ESP)
    _pitCallActive = true;
    _pitCallMac = state.activeKartMac || KartRegistry.DEFAULT_MAC;
    btn.classList.add('active');
    btn.textContent = '⏹ STOP';
    rcToast('Demo: Pit-Call aktiviert (15s)', 2500);
    _pitCallTimer = setTimeout(() => {
      _pitCallActive = false;
      _pitCallMac = null;
      btn.classList.remove('active');
      btn.textContent = '📢 BOX';
      _pitCallTimer = null;
    }, 15000);
    return;
  }
  if (sendPitCall('PIT STOP', 15000)) {
    _pitCallActive = true;
    _pitCallMac = state.activeKartMac || KartRegistry.DEFAULT_MAC;
    btn.classList.add('active');
    btn.textContent = '⏹ STOP';
    rcToast('Pit-Call gesendet — Mäher wird benachrichtigt', 3000);
    _pitCallTimer = setTimeout(() => {
      _pitCallActive = false;
      _pitCallMac = null;
      btn.classList.remove('active');
      btn.textContent = '📢 BOX';
      _pitCallTimer = null;
    }, 15000);
  }
}

// Interface-Marker: von rasicross.js (init-Bindings, 1Hz-Loop)/serial-demo.js
// genutzte Funktionen -- verhindert no-unused-vars, dokumentiert das API.
void [openPitWall, closePitWall, pwKeyHandler, updatePitWall,
      buildRaceDataForKart, sendDisplayUpdate, restartDisplayUpdateInterval,
      sendPitCall, cancelPitCall, togglePitCall];

// ESM-Export (Phase 42): bisherige Interface-Globals von pit-wall.js
export {
  openPitWall, closePitWall, pwKeyHandler, updatePitWall,
  buildRaceDataForKart, sendDisplayUpdate, restartDisplayUpdateInterval,
  sendPitCall, cancelPitCall, togglePitCall,
};
