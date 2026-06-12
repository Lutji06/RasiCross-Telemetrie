'use strict';
// ============================================================
//  replay.js — pure recording/replay core (RasiCross)
//  Single source of truth for the testable logic. Loaded as a
//  classic <script> AFTER geo.js and BEFORE rasicross.js
//  (exposes window.RasiReplay) and as a CommonJS module for
//  node:test. Dependency-free. No DOM, no globals besides the
//  one explicit RasiReplay assignment at the bottom.
// ============================================================

var REC_MAX = 150000;        // ~3 h @ 12.5 Hz
var REC_VERSION = '9.6';

// Build the NDJSON text: line 1 = header, then one packet/line.
// Each packet is expected to already carry t_rel.
function serializeRecording(packets, meta) {
  packets = packets || [];
  meta = meta || {};
  var n = packets.length, dur = 0;
  for (var i = 0; i < n; i++) {
    var t = Number(packets[i] && packets[i].t_rel) || 0;
    if (t > dur) dur = t;
  }
  var header = {
    rasicross_recording: 1,
    version: REC_VERSION,
    created: meta.created || new Date().toISOString(),
    count: n,
    duration_ms: dur
  };
  var lines = [JSON.stringify(header)];
  for (var j = 0; j < n; j++) lines.push(JSON.stringify(packets[j]));
  return lines.join('\n');
}

// Parse NDJSON text -> { ok, error, header, packets, skipped, durationMs }.
// Malformed body lines are skipped + counted. t_rel is clamped to a
// monotonic non-decreasing timeline stored on each packet as __t.
function parseRecording(text) {
  var src = String(text == null ? '' : text).split(/\r?\n/);
  var lines = [];
  for (var i = 0; i < src.length; i++) {
    var s = src[i].trim();
    if (s) lines.push(s);
  }
  if (!lines.length) {
    return { ok: false, error: 'empty', header: null, packets: [], skipped: 0, durationMs: 0 };
  }
  var header;
  try { header = JSON.parse(lines[0]); }
  catch (e) {
    return { ok: false, error: 'bad-header', header: null, packets: [], skipped: 0, durationMs: 0 };
  }
  if (!header || header.rasicross_recording !== 1) {
    return { ok: false, error: 'not-a-recording', header: null, packets: [], skipped: 0, durationMs: 0 };
  }
  var packets = [], skipped = 0, prevT = 0;
  for (var k = 1; k < lines.length; k++) {
    var obj;
    try { obj = JSON.parse(lines[k]); }
    catch (e2) { skipped++; continue; }
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) { skipped++; continue; }
    var t = Number(obj.t_rel);
    if (!isFinite(t)) t = prevT;     // missing/NaN -> hold
    if (t < prevT) t = prevT;        // non-monotonic -> clamp
    prevT = t;
    obj.__t = t;
    packets.push(obj);
  }
  return {
    ok: true, error: null, header: header, packets: packets,
    skipped: skipped, durationMs: packets.length ? packets[packets.length - 1].__t : 0
  };
}

// Bounded ring push. Returns true iff an item was dropped (overflow).
function pushCapped(buf, item, max) {
  buf.push(item);
  if (buf.length > max) { buf.shift(); return true; }
  return false;
}

// First index whose __t is still in the future relative to virtualMs.
// packets[fromIndex .. return-1] are the ones now due to feed.
function nextIndexFor(packets, virtualMs, fromIndex) {
  var i = fromIndex | 0;
  var n = packets.length;
  while (i < n && packets[i].__t <= virtualMs) i++;
  return i;
}

// ── CSV-Export ──────────────────────────────────────────────
// Spalten: [Header, Paket-Feld]. Reihenfolge = Spaltenreihenfolge.
var CSV_COLUMNS = [
  ['t_rel_ms', 't_rel'], ['speed_kmh', 'speed'], ['rpm', 'rpm'],
  ['gx_g', 'gx'], ['gy_g', 'gy'], ['gz_g', 'gz'],
  ['yaw_dps', 'yaw'], ['roll_dps', 'roll'],
  ['lat', 'lat'], ['lon', 'lon'], ['gps_fix', 'gps_fix'], ['spd_src', 'spd_src'],
  ['rssi_dbm', 'rssi'], ['vbat_v', 'vbat'], ['soc_pct', 'soc'],
  ['batt_warn', 'batt_warn'], ['mtemp_c', 'mtemp'], ['glitch', 'glitch'],
  ['seq', 'seq'], ['lost', 'lost']
];

function _csvCell(v) {
  if (v == null) return '';
  if (typeof v === 'number') return isFinite(v) ? String(v).replace('.', ',') : '';
  // Trennzeichen/Zeilenumbrueche in Strings entschaerfen (kein Quoting noetig)
  return String(v).replace(/[;\r\n]/g, ' ');
}

// Aufnahme-Pakete -> CSV-Text im deutschen Excel-Format (Semikolon-Trenner,
// Dezimal-Komma, CRLF). Steuer-/Statuszeilen (mit type-Feld, z.B.
// bridge_status) werden uebersprungen; fehlende Felder -> leere Zelle.
function recordingToCsv(packets) {
  packets = packets || [];
  var lines = [CSV_COLUMNS.map(function (c) { return c[0]; }).join(';')];
  for (var i = 0; i < packets.length; i++) {
    var p = packets[i];
    if (!p || typeof p !== 'object' || p.type) continue;
    var row = [];
    for (var j = 0; j < CSV_COLUMNS.length; j++) {
      row.push(_csvCell(p[CSV_COLUMNS[j][1]]));
    }
    lines.push(row.join(';'));
  }
  return lines.join('\r\n');
}

// Map a 0..1 scrubber ratio to a clamped ms position.
function seekTargetMs(durationMs, ratio) {
  var r = Number(ratio);
  if (!isFinite(r)) r = 0;
  if (r < 0) r = 0; else if (r > 1) r = 1;
  return r * (Number(durationMs) || 0);
}

// ── UMD-style export ────────────────────────────────────────
(function () {
  var api = {
    REC_MAX: REC_MAX, REC_VERSION: REC_VERSION,
    serializeRecording: serializeRecording, parseRecording: parseRecording,
    pushCapped: pushCapped, nextIndexFor: nextIndexFor, seekTargetMs: seekTargetMs,
    recordingToCsv: recordingToCsv, CSV_COLUMNS: CSV_COLUMNS
  };
  if (typeof module !== 'undefined' && module.exports) { module.exports = api; }
  if (typeof window !== 'undefined') { window.RasiReplay = api; }
})();
