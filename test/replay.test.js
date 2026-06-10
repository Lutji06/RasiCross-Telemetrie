'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../replay.js');

test('exports the full api + constants', () => {
  assert.equal(R.REC_MAX, 150000);
  assert.equal(R.REC_VERSION, '9.6');
  for (const n of ['serializeRecording','parseRecording','pushCapped','nextIndexFor','seekTargetMs']) {
    assert.equal(typeof R[n], 'function', `missing ${n}`);
  }
});

test('serializeRecording: header line + one line per packet, round-trips', () => {
  const pkts = [{ t_rel: 0, speed: 1 }, { t_rel: 80, speed: 2 }, { t_rel: 160, speed: 3 }];
  const txt = R.serializeRecording(pkts, { created: '2026-05-19T00:00:00.000Z' });
  const lines = txt.split('\n');
  assert.equal(lines.length, 4);
  const hdr = JSON.parse(lines[0]);
  assert.equal(hdr.rasicross_recording, 1);
  assert.equal(hdr.version, '9.6');
  assert.equal(hdr.created, '2026-05-19T00:00:00.000Z');
  assert.equal(hdr.count, 3);
  assert.equal(hdr.duration_ms, 160);
  const back = R.parseRecording(txt);
  assert.equal(back.ok, true);
  assert.equal(back.packets.length, 3);
  assert.equal(back.packets[2].speed, 3);
});

test('serializeRecording: duration_ms is the max t_rel (order-independent)', () => {
  const txt = R.serializeRecording([{ t_rel: 50 }, { t_rel: 10 }, { t_rel: 30 }], { created: 'x' });
  assert.equal(JSON.parse(txt.split('\n')[0]).duration_ms, 50);
});

test('parseRecording: empty / whitespace -> ok:false', () => {
  assert.equal(R.parseRecording('').ok, false);
  assert.equal(R.parseRecording('   \n  \n').ok, false);
  assert.equal(R.parseRecording(null).ok, false);
});

test('parseRecording: unparseable header -> ok:false bad-header', () => {
  const r = R.parseRecording('not json\n{"t_rel":0}');
  assert.equal(r.ok, false);
  assert.equal(r.error, 'bad-header');
});

test('parseRecording: valid json header without the flag -> ok:false', () => {
  const r = R.parseRecording('{"hello":1}\n{"t_rel":0}');
  assert.equal(r.ok, false);
  assert.equal(r.error, 'not-a-recording');
});

test('parseRecording: skips malformed body lines and counts them', () => {
  const txt = [
    '{"rasicross_recording":1,"version":"9.6"}',
    '{"t_rel":0,"speed":1}',
    'GARBAGE{',
    '42',                       // not an object -> skipped
    '{"t_rel":80,"speed":2}'
  ].join('\n');
  const r = R.parseRecording(txt);
  assert.equal(r.ok, true);
  assert.equal(r.packets.length, 2);
  assert.equal(r.skipped, 2);
  assert.equal(r.packets[1].speed, 2);
});

test('parseRecording: clamps missing / non-monotonic t_rel into __t', () => {
  const txt = [
    '{"rasicross_recording":1}',
    '{"t_rel":0}',
    '{"t_rel":100}',
    '{"speed":9}',              // missing t_rel -> clamp to prev (100)
    '{"t_rel":50}',             // goes backwards -> clamp to prev (100)
    '{"t_rel":250}'
  ].join('\n');
  const r = R.parseRecording(txt);
  assert.deepEqual(r.packets.map(p => p.__t), [0, 100, 100, 100, 250]);
  assert.equal(r.durationMs, 250);
});

test('pushCapped: under cap returns false, no drop', () => {
  const buf = [1, 2];
  assert.equal(R.pushCapped(buf, 3, 5), false);
  assert.deepEqual(buf, [1, 2, 3]);
});

test('pushCapped: at cap drops oldest, returns true, length stays == max', () => {
  const buf = [1, 2, 3];
  assert.equal(R.pushCapped(buf, 4, 3), true);
  assert.deepEqual(buf, [2, 3, 4]);
  assert.equal(buf.length, 3);
});

test('nextIndexFor: progressive feed, fromIndex resume, ties, beyond end', () => {
  const pk = R.parseRecording([
    '{"rasicross_recording":1}',
    '{"t_rel":0}', '{"t_rel":80}', '{"t_rel":80}', '{"t_rel":240}'
  ].join('\n')).packets;
  assert.equal(R.nextIndexFor(pk, 0, 0), 1);     // only t=0 due
  assert.equal(R.nextIndexFor(pk, 80, 1), 3);    // both t=80 (tie) due
  assert.equal(R.nextIndexFor(pk, 100, 3), 3);   // nothing new yet
  assert.equal(R.nextIndexFor(pk, 9999, 3), 4);  // rest due
  assert.equal(R.nextIndexFor(pk, 9999, 4), 4);  // already at end
});

test('seekTargetMs: clamps ratio to [0,1] and maps to ms', () => {
  assert.equal(R.seekTargetMs(1000, 0), 0);
  assert.equal(R.seekTargetMs(1000, 0.5), 500);
  assert.equal(R.seekTargetMs(1000, 1), 1000);
  assert.equal(R.seekTargetMs(1000, -3), 0);
  assert.equal(R.seekTargetMs(1000, 9), 1000);
  assert.equal(R.seekTargetMs(1000, NaN), 0);
});

test('recordingToCsv: Header + Semikolon-Trenner + Dezimal-Komma + CRLF', () => {
  const csv = R.recordingToCsv([{ t_rel: 0, speed: 42.3, rpm: 4280, gx: 0.12, spd_src: 'gps' }]);
  const lines = csv.split('\r\n');
  assert.equal(lines.length, 2);
  assert.equal(lines[0], R.CSV_COLUMNS.map(c => c[0]).join(';'));
  assert.ok(lines[0].startsWith('t_rel_ms;speed_kmh;rpm;gx_g;'));
  assert.ok(lines[1].startsWith('0;42,3;4280;0,12;'));
  assert.ok(lines[1].includes(';gps;'));
});

test('recordingToCsv: fehlende Felder -> leere Zellen, Spaltenzahl stabil', () => {
  const csv = R.recordingToCsv([{ t_rel: 80 }]);
  const cells = csv.split('\r\n')[1].split(';');
  assert.equal(cells.length, R.CSV_COLUMNS.length);
  assert.equal(cells[0], '80');
  assert.equal(cells[1], '');          // speed fehlt
});

test('recordingToCsv: Status-/Steuerzeilen (type) und Junk werden uebersprungen', () => {
  const csv = R.recordingToCsv([
    { type: 'bridge_status', rate_hz: 12 },
    null, 'junk', 42,
    { t_rel: 0, speed: 1 }
  ]);
  assert.equal(csv.split('\r\n').length, 2);    // Header + 1 Datenzeile
});

test('recordingToCsv: Semikolon/Zeilenumbruch in Strings wird entschaerft', () => {
  const csv = R.recordingToCsv([{ t_rel: 0, spd_src: 'a;b\nc' }]);
  const cells = csv.split('\r\n')[1].split(';');
  assert.equal(cells.length, R.CSV_COLUMNS.length);
  assert.ok(cells.join(';').includes('a b c'));
});

test('recordingToCsv: leer/NaN -> nur Header bzw. leere Zelle', () => {
  assert.equal(R.recordingToCsv([]).split('\r\n').length, 1);
  assert.equal(R.recordingToCsv(null).split('\r\n').length, 1);
  const cells = R.recordingToCsv([{ t_rel: 0, speed: NaN }]).split('\r\n')[1].split(';');
  assert.equal(cells[1], '');
});
