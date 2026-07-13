// ============================================================
//  RasiCross — telemetry.js  (Telemetrie-Pipeline, Phase 44)
//  Herausgeloest aus rasicross.js — NUR bewegt, nicht geaendert.
// ============================================================

import { checkSectorCrossings } from './track.js';
import { checkLapCrossing } from './laps-drivers.js';
import { activeRace } from './races.js';
import KartRegistry from './kart-registry.js';
import RasiAttitude from './attitude.js';
import RasiDrift from './drift.js';
import RasiEngine from './engine.js';
import RasiKartStats from './kart-stats.js';
import RasiKartBar from './kart-bar.js';
import RasiLapEngine from './lap-engine.js';
import RasiReplay from './replay.js';
import { rcToast, rcAudio } from './rasicross.js';
import { applyEspConfigAck } from './esp-config.js';
import { selectedKartMac } from './kart-settings.js';
import { state, activeKart, kartFor, saveDataDebounced, kartMetaFor } from './store.js';

// Crash-Sicherung (Phase 24): recordPacket sammelt NDJSON-Zeilen und schiebt
// sie gebuendelt an den Main-Prozess (alle ~25 Pakete oder 2s) — nach einem
// Absturz bietet init() die Datei zur Wiederherstellung an. Nur in Electron
// (window.rasiRec); im Browser bleibt alles wie bisher im RAM.
const REC_FLUSH_N = 25, REC_FLUSH_MS = 2000;
let _crashQ = [], _crashLastFlush = 0, _crashFailed = false;
function _crashFlush(now) {
  if (!window.rasiRec || _crashFailed || !_crashQ.length) return;
  const batch = _crashQ.join('\n') + '\n';
  _crashQ = [];
  _crashLastFlush = now;
  window.rasiRec.append(batch).then(r => {
    if (r && r.ok === false && !_crashFailed) {
      _crashFailed = true;
      rcToast('⚠ Crash-Sicherung deaktiviert: ' + (r.error || 'Schreibfehler'), 4000);
    }
  }).catch(() => {});
}
function armRecording() {
  // Frische Aufnahme starten (auto bei Connect/Demo, wenn aktiviert).
  // Aufnahme bezieht sich auf den aktuell ausgewaehlten Kart.
  const k = activeKart();
  k.recording.buf = [];
  k.recording.startWall = null;
  k.recording.overflowed = false;
  k.recording.armed = true;
  // Crash-Sicherungsdatei frisch beginnen (Header-Zeile, Pakete folgen).
  _crashQ = []; _crashLastFlush = Date.now(); _crashFailed = false;
  if (window.rasiRec) {
    const header = RasiReplay.serializeRecording([], { created: new Date().toISOString() });
    window.rasiRec.start(header).catch(() => {});
  }
}
function recordPacket(d) {
  const k = kartFor(d.from_mac || KartRegistry.DEFAULT_MAC);
  if (!k) return;
  const now = Date.now();
  if (k.recording.startWall == null) k.recording.startWall = now;
  const rec = Object.assign({}, d, { t_rel: now - k.recording.startWall, _wall: now });
  const dropped = RasiReplay.pushCapped(k.recording.buf, rec, RasiReplay.REC_MAX);
  if (dropped && !k.recording.overflowed) {
    k.recording.overflowed = true;
    rcToast('⚠ Aufnahme-Puffer voll — älteste Pakete werden verworfen', 4000);
  }
  if (window.rasiRec && !_crashFailed) {
    _crashQ.push(JSON.stringify(rec));
    if (_crashQ.length >= REC_FLUSH_N || now - _crashLastFlush >= REC_FLUSH_MS) _crashFlush(now);
  }
}
// Drift-Eingaenge aus einem (Roh-)Paket — identisch fuer Live und Replay-Aggregat.
// Wendet die IMU-Kalibrierung an (gy: Null-Offset, swap, invertGy; yaw: invertYaw),
// damit der Vorzeichen-/Counter-Check konsistente Achsen vergleicht.
function driftInputs(d, cal) {
  d = d || {};
  cal = cal || {};
  let gx = (Number(d.gx) || 0) - (cal.gxZero || 0);
  let gy = (Number(d.gy) || 0) - (cal.gyZero || 0);
  // Nur gy (Querbeschleunigung) fliesst ins Ergebnis; bei vertauschten Achsen
  // liegt sie auf gx -> gy <- gx (kein voller Swap noetig, gx wird hier nicht mehr gelesen).
  if (cal.swapG) gy = gx;
  if (cal.invertGy) gy = -gy;
  let yaw = Number(d.yaw) || 0;
  if (cal.invertYaw) yaw = -yaw;
  return { yawRate: yaw, latAccel: gy, speed: Math.max(0, Number(d.speed) || 0) };
}

// Phase 39: "Max Karts"-Hinweis nur einmal pro unbekannter MAC und Session —
// ohne Drossel wuerde ein 5. Kart bei ~12 Hz den Toast permanent halten.
const _maxKartsToasted = new Set();

function processTelemetry(d) {
  try {
    if (!d) return;
    if (d.type === 'bridge_status') {
      if (d.mac) activeKart().connection.bridgeMac = d.mac;
      if (d.kart_mac) activeKart().connection.kartMac = d.kart_mac;
      // Hintergrund-Karts schon vor ihrem ersten Telemetrie-Paket befuellen,
      // damit Chips RSSI/Hz/Lost anzeigen.
      state._kartHz = state._kartHz || {};
      if (Array.isArray(d.karts)) {
        for (const ks of d.karts) {
          if (!ks || !ks.mac) continue;
          const kk = kartFor(ks.mac);
          if (!kk) continue;
          if (ks.rssi != null) kk.connection.rssi = ks.rssi;
          if (ks.lost != null) kk.connection.lost = ks.lost;
          state._kartHz[ks.mac] = ks.rate_hz;
        }
      }
      RasiKartBar.render(state);
      return;
    }
    if (d.type === 'config_ack') { applyEspConfigAck(d, selectedKartMac()); return; }
    // Ziel-Kart aufloesen (MAC = Identitaet). Schreibpfade laufen explizit
    // ueber k statt ueber die aktive-Kart-Proxy-Fassade, damit Hintergrund-
    // Karts ihren eigenen Zustand fuellen.
    const _mac = d.from_mac || KartRegistry.DEFAULT_MAC;
    const k = kartFor(_mac);
    if (!k) {
      if (!_maxKartsToasted.has(_mac)) {
        _maxKartsToasted.add(_mac);
        rcToast('Max. ' + KartRegistry.MAX_KARTS + ' Karts — ' + _mac + ' ignoriert', 4000);
      }
      return;
    }
    // Phase 30: Nachzuegler — sendet ein Kart waehrend eines laufenden Rennens
    // erstmals und ist noch kein Teilnehmer, lege seinen Slot an (armiert bei
    // erster Linie, da k.lapStart noch null ist).
    {
      const _r = activeRace();
      if (_r && _r.status === 'running' && !(_r.participants && _r.participants[_mac])) {
        RasiLapEngine.getOrCreatePart(_r, _mac, _r.currentDriverId, null);
      }
    }
    if (k.recording.armed && !k.replay.active) recordPacket(d);
    if (state.serial.connected && !k.replay.active) k.connection.source = 'serial';
    k.connection.packets++;
    k.connection.lastPacketAt = Date.now();
    kartMetaFor(_mac, Math.max(0, state.karts.macs().indexOf(_mac))).lastSeenAt = Date.now();
    k.connection.kartMac = _mac;
    if (typeof d.rssi === 'number') k.connection.rssi = d.rssi;
    // Verlustzaehlung: eine Quelle. Die Bridge zaehlt ueber die ESP-NOW-
    // Sequenznummern und liefert `lost` kumulativ in jedem Paket mit ->
    // direkt uebernehmen. Eigene seq-Zaehlung nur als Fallback fuer
    // Quellen ohne lost-Feld (Demo, alte Aufnahmen).
    if (d.lost != null) {
      k.connection.lost = Number(d.lost) || 0;
    } else if (d.seq != null && k.connection.seq != null) {
      const delta = (d.seq - k.connection.seq + 65536) % 65536;
      if (delta > 1 && delta < 1000) k.connection.lost += delta - 1;
    }
    if (d.seq != null) k.connection.seq = d.seq;
    state.hz++;
    // Calibrated values
    const speed = Math.max(0, Number(d.speed) || 0);
    const rpm = Math.max(0, Number(d.rpm) || 0);
    // Motorlaufzeit (Phase 27): nur echte Hardware-Pakete zaehlen --
    // Demo/Replay wuerden den Wartungszaehler verfaelschen.
    if (k.connection.source === 'serial' && !k.replay.active) {
      const _eng = RasiEngine.engineStep(k.engine, rpm, Date.now());
      k.engine.totalMs = _eng.totalMs;
      k.engine.lastAt = _eng.lastAt;
      k.engine._unsavedMs += _eng.addedMs;
      if (k.engine._unsavedMs >= 60000) {   // 1x pro Motor-Minute persistieren
        k.engine._unsavedMs = 0;
        saveDataDebounced();
      }
      if (!k.engine._warned
          && RasiEngine.serviceDue(k.engine.totalMs, k.engine.lastServiceMs, k.engine.serviceIntervalH)) {
        k.engine._warned = true;
        rcToast('🔧 Wartung fällig — '
          + RasiEngine.hoursText(RasiEngine.sinceServiceMs(k.engine.totalMs, k.engine.lastServiceMs))
          + ' seit letzter Wartung', 6000);
      }
    }
    // Lebens-Statistik (Phase 48): Odometer/Fahrzeit/Topspeed. Zaehlt jede
    // Live-Quelle (Serial + Demo-Session-Bucket), nie Replay — der wuerde
    // gefahrene Kilometer doppelt zaehlen.
    if (!k.replay.active) {
      const _st = RasiKartStats.statsStep(k.stats, speed, Date.now());
      k.stats.odoM = _st.odoM;
      k.stats.moveMs = _st.moveMs;
      k.stats.topKmh = _st.topKmh;
      k.stats.lastAt = _st.lastAt;
      k.stats._unsavedMs += _st.addedMs;
      if (k.stats._unsavedMs >= 60000) {   // 1x pro Fahr-Minute persistieren
        k.stats._unsavedMs = 0;
        saveDataDebounced();
      }
    }
    let gx = (Number(d.gx) || 0) - k.calibration.gxZero;
    let gy = (Number(d.gy) || 0) - k.calibration.gyZero;
    const gz = Number(d.gz) || 0;                  // Accel-Z (g), jedes Paket
    const di = driftInputs(d, k.calibration);      // geteilte Drift-Normalisierung (inkl. invertYaw)
    const yawv = di.yawRate;                        // vorzeichen-korrigierte Gierrate (deg/s)
    k.imu.yaw = yawv;
    if (d.mtemp != null) k.imu.mtemp = Number(d.mtemp) || 0;  // langsam: letzten Wert halten
    // Apply axis transformations
    if (k.calibration.swapG) { const tmp = gx; gx = gy; gy = tmp; }
    if (k.calibration.invertGx) gx = -gx;
    if (k.calibration.invertGy) gy = -gy;
    // Drift (Phase 20): gehaerteter + geglaetteter Gierraten-Index. di teilt die
    // Eingangs-Normalisierung mit dem Replay-Aggregat; smoothStep liefert
    // EMA-Index + entprellten/hysterese-stabilen Status.
    // Hangkompensation (Phase 24): Schwerkraftanteil sin(roll) aus der Quer-g
    // ziehen, damit Hangfahrt nicht als Unter-/Uebersteuern erscheint. Roll vom
    // vorherigen Sample (Update folgt unten) -- bei 12 Hz vernachlaessigbar.
    const dRaw = RasiDrift.analyze(
      { yawRate: di.yawRate, speed: di.speed,
        latAccel: RasiDrift.tiltCompLatG(di.latAccel, k.attitude.rollDeg) },
      state.settings.drift);
    // settings.drift liefert tol (-> Hysterese-Baender); smooth/hyst/counterHold
    // sind nicht in den Settings und fallen in smoothStep auf SMOOTH_DEFAULTS zurueck.
    k.driftSmooth = RasiDrift.smoothStep(k.driftSmooth, dRaw, state.settings.drift);
    k.drift = { status: k.driftSmooth.status, index: k.driftSmooth.idxEma };
    // Rollwinkel (Phase 19b): Roll-Rate (d.roll) + Accel-Schwerkraft-Referenz
    // -> Winkel (Komplementaerfilter), minus Null-Offset. di.latAccel = kalibrierte
    // Querbeschleunigung; gz = Accel-Z.
    const _attNow = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    const _attDt = _attLastMs ? (_attNow - _attLastMs) / 1000 : 0.08;
    _attLastMs = _attNow;
    const _rollRate = (Number(d.roll) || 0) * (k.calibration.invertRollRate ? -1 : 1);
    const _rollRaw = RasiAttitude.rollStep(
      k.attitude.rollDeg + k.calibration.rollZero,
      _rollRate, di.latAccel, Number(d.gz) || 0, _attDt, 0.98);
    k.attitude.rollDeg = _rollRaw - k.calibration.rollZero;
    k.attitude.overState = RasiAttitude.rolloverStep(
      k.attitude.overState, k.attitude.rollDeg, state.settings.rollover);
    k.attitude.over = k.attitude.overState.active;
    if (k.attitude.overState.onset) {
      rcToast('⚠ Mäher umgekippt!', 4000);
      rcAudio.rollover();
    }
    const lat = Number(d.lat);
    const lon = Number(d.lon);
    const hasGps = !!(d.gps_fix ?? d.fix ?? (lat && lon));
    k.gps.fix = hasGps;
    if (lat && lon) k.gps.lastAt = Date.now();
    if (d.spd_src) k.spdSrc = d.spd_src;
    // Batterie (A3): vbat/soc langsam -> nur bei Anwesenheit aktualisieren
    // (sonst letzten Wert behalten); batt_warn jedes Paket wenn aktiv.
    if (d.vbat != null) { k.batt.vbat = Number(d.vbat) || 0; k.batt.present = true; }
    if (d.soc != null)  { k.batt.soc = Number(d.soc) || 0;  k.batt.present = true; }
    if (d.batt_warn != null) {
      k.batt.present = true;
      const w = Number(d.batt_warn) || 0;
      if (w > k.batt._lastWarn) {           // nur Aufwaerts-Transition
        if (w === 2) { rcToast('⛔ Akku kritisch!', 3500); rcAudio.battCrit(); }
        else if (w === 1) { rcToast('⚠ Akku schwach', 3000); rcAudio.battWarn(); }
      }
      k.batt._lastWarn = w;
      k.batt.warn = w;
    }
    k.raw = { speed, rpm, gx: Number(d.gx) || 0, gy: Number(d.gy) || 0, gz, yaw: yawv, lat: lat || 0, lon: lon || 0, glitch: d.glitch != null ? (Number(d.glitch) || 0) : null, pulseHz: Number(d.pulse_hz) || 0 };
    k.telemetry = { speed, rpm, gx, gy, gz, lat: lat || 0, lon: lon || 0 };
    // Update max
    k.max.speed = Math.max(k.max.speed, speed);
    k.max.rpm = Math.max(k.max.rpm, rpm);
    k.max.g = Math.max(k.max.g, Math.sqrt(gx*gx + gy*gy));
    // Per-lap max
    k.currentLapMax.speed = Math.max(k.currentLapMax.speed, speed);
    k.currentLapMax.rpm = Math.max(k.currentLapMax.rpm, rpm);
    k.heatmap.lapMaxSpeed = Math.max(k.heatmap.lapMaxSpeed, speed);
    // Charts (downsampled)
    if (k.charts.speed.length === 0 || (k.connection.packets % 2 === 0)) {
      k.charts.speed.push(speed);
      k.charts.rpm.push(rpm);
      k.charts.gx.push(gx);
      k.charts.gy.push(gy);
      k.charts.gz.push(gz);
      k.charts.yaw.push(yawv);
      k.charts.driftIndex.push(k.drift.index == null ? 0 : k.drift.index);
      const max = 600;
      while (k.charts.speed.length > max) k.charts.speed.shift();
      while (k.charts.rpm.length > max) k.charts.rpm.shift();
      while (k.charts.gx.length > max) k.charts.gx.shift();
      while (k.charts.gy.length > max) k.charts.gy.shift();
      while (k.charts.gz.length > max) k.charts.gz.shift();
      while (k.charts.yaw.length > max) k.charts.yaw.shift();
      while (k.charts.driftIndex.length > max) k.charts.driftIndex.shift();
    }
    // Track current lap trace
    if (k.lapStart && lat && lon) {
      k.currentLapTrace.push({ t: Date.now() - k.lapStart, lat, lon, speed });
      if (k.currentLapTrace.length > 5000) k.currentLapTrace.shift();
    }
    // Phase 30: Lap-/Sektorerkennung laeuft PRO KART (k/mac explizit), nicht mehr
    // nur fuer den aktiven. Geometrie (startGate/boundaries) ist geteilt.
    const _r = activeRace();
    const _isPart = !!(_r && _r.status === 'running' && _r.participants && _r.participants[_mac]);
    if (_isPart && lat && lon && state.startGate.enabled) {
      // Erste Durchfahrt armiert (k.lapStart==null -> checkLapCrossing setzt sie
      // via triggerLap auf now, ohne Runde zu zaehlen). checkLapCrossing/-Sectors
      // pruefen k.lapStart selbst.
      checkLapCrossing(k, _mac, lat, lon);
      checkSectorCrossings(k, lat, lon);
      // Armierung: solange noch keine Runde laeuft, erste gueltige Linie startet
      // die Uhr. triggerLap handhabt das (k.lapStart null -> nur Start-Zweig).
    }
    // Vorgaenger-GPS-Punkt dieses Karts immer pflegen (Richtungscheck).
    if (lat && lon) {
      k.autoLap.prevLat = lat;
      k.autoLap.prevLon = lon;
    }
    // Renn-Speed-Trace pro Teilnehmer (downsampled).
    if (_isPart) {
      const part = _r.participants[_mac];
      part.speedTrace = part.speedTrace || [];
      if (k.connection.packets % 5 === 0) {
        part.speedTrace.push({ t: Date.now() - (_r.startedAt || Date.now()), speed, rpm });
        if (part.speedTrace.length > 4000) part.speedTrace.shift();
      }
    }
  } catch (e) { console.warn('processTelemetry:', e); }
}

let _attLastMs = 0;            // wall-clock of last attitude fusion step (ms)
// Phase 42: recording.js setzt die Fusions-Uhr beim Replay-Reset zurueck --
// ESM-Importe sind read-only, deshalb Setter statt Direktzuweisung.
function resetAttitudeClock() { _attLastMs = 0; }

export { armRecording, recordPacket, driftInputs, processTelemetry, resetAttitudeClock };
