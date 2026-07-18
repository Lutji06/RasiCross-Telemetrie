'use strict';
/*!
 * conn-health.js — pure Ampel-/Aggregations-Logik der Verbindungsseite
 * (Phase 56): classifyKart (Ampel + Klartext-Hinweise), aggregate
 * (Hero-Zahlen), heroStatus (Portstatus-Zeile).
 * Reines Modul — kein DOM, keine Seiteneffekte, wirft nie (Muster live-view.js).
 */

const THRESHOLDS = Object.freeze({
  OFFLINE_MS: 5000,     // > 5 s ohne Paket -> offline
  RSSI_WARN_DBM: -75,   // < -75 dBm -> Schwaches Signal
  GPS_STALE_MS: 30000,  // fix=false laenger als 30 s (oder nie Fix) -> GPS-Hinweis
  RATE_WARN_HZ: 5,      // < 5 Hz -> Datenrate niedrig
  AGE_WARN_MS: 2000,    // > 2 s Paketalter -> Pakete verzoegert
  MAX_HINTS: 2,
});

function _num(v) { return (typeof v === 'number' && isFinite(v)) ? v : null; }

// classifyKart({ now, lastPacketAt, rssi, hz, gpsFix, gpsLastAt })
//   -> { level: 'ok'|'warn'|'off', hints: [String] }
// Prioritaet: offline > Signal > GPS > Rate > Paketalter; max. MAX_HINTS.
// Fehlende Werte (rssi null, hz null, gpsFix undefined) werden nicht bewertet.
function classifyKart(a) {
  const o = a || {};
  const now = _num(o.now) !== null ? _num(o.now) : 0;
  const last = _num(o.lastPacketAt);
  if (last === null || now - last > THRESHOLDS.OFFLINE_MS) {
    const hint = last === null
      ? 'Keine Pakete empfangen — Akku, Reichweite oder Sender prüfen.'
      : 'Seit ' + Math.round((now - last) / 1000) + ' s keine Pakete — Akku, Reichweite oder Sender prüfen.';
    return { level: 'off', hints: [hint] };
  }
  const hints = [];
  const rssi = _num(o.rssi);
  if (rssi !== null && rssi < THRESHOLDS.RSSI_WARN_DBM) {
    hints.push('Schwaches Signal — Reichweite/Antenne prüfen.');
  }
  const gpsLastAt = _num(o.gpsLastAt);
  if (o.gpsFix === false && (gpsLastAt === null || now - gpsLastAt > THRESHOLDS.GPS_STALE_MS)) {
    hints.push('Kein GPS-Fix — freie Sicht zum Himmel?');
  }
  const hz = _num(o.hz);
  if (hz !== null && hz < THRESHOLDS.RATE_WARN_HZ) hints.push('Datenrate niedrig.');
  if (now - last > THRESHOLDS.AGE_WARN_MS) hints.push('Pakete verzögert.');
  const capped = hints.slice(0, THRESHOLDS.MAX_HINTS);
  return { level: capped.length ? 'warn' : 'ok', hints: capped };
}

// aggregate([{ level, hz, gpsFix }, ...]) -> { online, total, hzSum, gpsFixCount }
// online = ok + warn (gruen+gelb); Junk-Eintraege zaehlen nur in total.
function aggregate(kartResults) {
  const list = Array.isArray(kartResults) ? kartResults : [];
  let online = 0, hzSum = 0, gpsFixCount = 0;
  for (const e of list) {
    const o = e || {};
    if (o.level === 'ok' || o.level === 'warn') online++;
    const hz = _num(o.hz);
    if (hz !== null) hzSum += hz;
    if (o.gpsFix === true) gpsFixCount++;
  }
  return { online: online, total: list.length, hzSum: hzSum, gpsFixCount: gpsFixCount };
}

// heroStatus({ connected, portName, baud, auto, demoRunning, reconnecting,
//              attempts, dropped }) -> { text, level }
// level ist zugleich CSS-Klasse der Portstatus-Zeile: ok|demo|warn|err|idle.
function heroStatus(a) {
  const o = a || {};
  if (o.demoRunning === true) return { text: 'Demo-Modus aktiv', level: 'demo' };
  if (o.connected === true) {
    const port = (typeof o.portName === 'string' && o.portName && o.portName !== '--') ? o.portName : '?';
    const baud = _num(o.baud) !== null ? _num(o.baud) : 115200;
    return {
      text: port + ' · ' + baud + ' ● verbunden' + (o.auto === true ? ' (auto)' : ''),
      level: 'ok',
    };
  }
  if (o.reconnecting === true) {
    const n = _num(o.attempts) !== null ? Math.max(1, Math.round(_num(o.attempts))) : 1;
    return { text: 'Wiederverbinden, Versuch ' + n + '…', level: 'warn' };
  }
  if (o.dropped === true) return { text: 'USB getrennt — Kabel prüfen', level: 'err' };
  return { text: 'Nicht verbunden', level: 'idle' };
}

export default { classifyKart, aggregate, heroStatus, THRESHOLDS };
