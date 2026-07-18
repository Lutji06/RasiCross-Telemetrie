import test from 'node:test';
import assert from 'node:assert/strict';
import CH from '../src/conn-health.js';

const C = (o) => CH.classifyKart(o);
const NOW = 1000000;
// Gesunder Kart als Basis; Tests ueberschreiben gezielt einzelne Felder.
const OK = { now: NOW, lastPacketAt: NOW - 100, rssi: -60, hz: 12, gpsFix: true, gpsLastAt: NOW - 100 };

test('exports the pure api + frozen thresholds', () => {
  assert.equal(typeof CH.classifyKart, 'function');
  assert.equal(typeof CH.aggregate, 'function');
  assert.equal(typeof CH.heroStatus, 'function');
  assert.ok(Object.isFrozen(CH.THRESHOLDS));
  assert.deepEqual(CH.THRESHOLDS, {
    OFFLINE_MS: 5000, RSSI_WARN_DBM: -75, GPS_STALE_MS: 30000,
    RATE_WARN_HZ: 5, AGE_WARN_MS: 2000, MAX_HINTS: 2,
  });
});

test('classifyKart: gesunder Kart -> ok ohne Hinweise', () => {
  assert.deepEqual(C(OK), { level: 'ok', hints: [] });
});

test('offline: Grenze 5000 ms strikt (> off, == noch nicht), N s im Hinweis', () => {
  assert.equal(C({ ...OK, lastPacketAt: NOW - 5000 }).level, 'warn'); // 5000 ms Alter: nicht off, aber > 2 s -> verzoegert
  const off = C({ ...OK, lastPacketAt: NOW - 5001 });
  assert.equal(off.level, 'off');
  assert.equal(off.hints.length, 1);
  assert.match(off.hints[0], /^Seit 5 s keine Pakete/);
  assert.match(off.hints[0], /Akku, Reichweite oder Sender/);
});

test('offline: nie ein Paket (lastPacketAt null/fehlend) -> off, wirft nie', () => {
  const r = C({ now: NOW });
  assert.equal(r.level, 'off');
  assert.match(r.hints[0], /Keine Pakete empfangen/);
});

test('rssi: -75 ist noch ok, < -75 warn; rssi null bewertet nicht', () => {
  assert.equal(C({ ...OK, rssi: -75 }).level, 'ok');
  const w = C({ ...OK, rssi: -76 });
  assert.equal(w.level, 'warn');
  assert.deepEqual(w.hints, ['Schwaches Signal — Reichweite/Antenne prüfen.']);
  assert.equal(C({ ...OK, rssi: null }).level, 'ok');
});

test('gps: fix=false + Alter > 30 s oder nie Fix -> warn; frischer fix=false nicht; gpsFix undefined nicht', () => {
  assert.equal(C({ ...OK, gpsFix: false, gpsLastAt: NOW - 30000 }).level, 'ok');
  const w = C({ ...OK, gpsFix: false, gpsLastAt: NOW - 30001 });
  assert.deepEqual(w.hints, ['Kein GPS-Fix — freie Sicht zum Himmel?']);
  const nie = C({ ...OK, gpsFix: false, gpsLastAt: null });
  assert.equal(nie.level, 'warn');
  const ohne = { ...OK };
  delete ohne.gpsFix;
  assert.equal(C(ohne).level, 'ok');
});

test('rate: 5 Hz ok, < 5 warn; hz null bewertet nicht', () => {
  assert.equal(C({ ...OK, hz: 5 }).level, 'ok');
  assert.deepEqual(C({ ...OK, hz: 4 }).hints, ['Datenrate niedrig.']);
  assert.equal(C({ ...OK, hz: null }).level, 'ok');
});

test('alter: > 2000 ms -> Pakete verzoegert (2000 selbst noch nicht)', () => {
  assert.equal(C({ ...OK, lastPacketAt: NOW - 2000 }).level, 'ok');
  assert.deepEqual(C({ ...OK, lastPacketAt: NOW - 2001 }).hints, ['Pakete verzögert.']);
});

test('prioritaet + max 2: Signal vor GPS vor Rate; dritter Hinweis faellt weg', () => {
  const r = C({ ...OK, rssi: -90, gpsFix: false, gpsLastAt: null, hz: 1 });
  assert.equal(r.level, 'warn');
  assert.deepEqual(r.hints, [
    'Schwaches Signal — Reichweite/Antenne prüfen.',
    'Kein GPS-Fix — freie Sicht zum Himmel?',
  ]);
});

test('junk wirft nie', () => {
  assert.equal(C().level, 'off');
  assert.equal(C(null).level, 'off');
  assert.equal(C({ now: 'x', lastPacketAt: 'y', rssi: NaN, hz: 'z', gpsFix: 42 }).level, 'off');
});

test('aggregate: online = ok+warn, hzSum, gpsFixCount; Junk zaehlt nur in total', () => {
  assert.deepEqual(CH.aggregate([
    { level: 'ok', hz: 12, gpsFix: true },
    { level: 'warn', hz: 9, gpsFix: false },
    { level: 'off', hz: 0, gpsFix: false },
    null,
  ]), { online: 2, total: 4, hzSum: 21, gpsFixCount: 1 });
  assert.deepEqual(CH.aggregate([]), { online: 0, total: 0, hzSum: 0, gpsFixCount: 0 });
  assert.deepEqual(CH.aggregate('junk'), { online: 0, total: 0, hzSum: 0, gpsFixCount: 0 });
});

test('heroStatus: Demo > verbunden > Reconnect > getrennt > idle', () => {
  assert.deepEqual(CH.heroStatus({ demoRunning: true, connected: true }),
    { text: 'Demo-Modus aktiv', level: 'demo' });
  assert.deepEqual(CH.heroStatus({ connected: true, portName: 'COM7', baud: 115200, auto: true }),
    { text: 'COM7 · 115200 ● verbunden (auto)', level: 'ok' });
  assert.deepEqual(CH.heroStatus({ connected: true, portName: 'COM7', baud: 115200 }),
    { text: 'COM7 · 115200 ● verbunden', level: 'ok' });
  assert.deepEqual(CH.heroStatus({ reconnecting: true, attempts: 3 }),
    { text: 'Wiederverbinden, Versuch 3…', level: 'warn' });
  assert.deepEqual(CH.heroStatus({ dropped: true }),
    { text: 'USB getrennt — Kabel prüfen', level: 'err' });
  assert.deepEqual(CH.heroStatus({}), { text: 'Nicht verbunden', level: 'idle' });
  assert.deepEqual(CH.heroStatus(), { text: 'Nicht verbunden', level: 'idle' });
});
