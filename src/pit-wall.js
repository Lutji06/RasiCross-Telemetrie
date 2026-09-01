// ============================================================
//  RasiCross -- pit-wall.js  (Pit-Wall, Phase 23). ESM (Phase 42):
//  explizite Imports statt gemeinsamem Global-Scope.
//  window.rasiSerial/rasiPower bleiben window-APIs
//  (Preload/contextBridge, keine Module).
//  Nur Deklarationen auf Top-Level -- kein Code laeuft beim Laden.
// ============================================================
import { fmtClock, fmtMs } from './geo.js';
import { state, $, setText, activeKart } from './rasicross.js';
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

// Interface-Marker: von rasicross.js (init-Bindings, 1Hz-Loop)/serial-demo.js
// genutzte Funktionen -- verhindert no-unused-vars, dokumentiert das API.
void [openPitWall, closePitWall, pwKeyHandler, updatePitWall];

// ESM-Export (Phase 42): bisherige Interface-Globals von pit-wall.js
export {
  openPitWall, closePitWall, pwKeyHandler, updatePitWall,
};
