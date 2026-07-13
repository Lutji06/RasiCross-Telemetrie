import test from 'node:test';
import assert from 'node:assert/strict';
import RasiKartRoster from '../src/kart-roster.js';

const { isDemoMac, metaDefaults, ensureMeta, migrateLegacyMeta,
        rosterMacs, clampServiceH, calDefaults, ackTargetMac, PALETTE } = RasiKartRoster;

test('isDemoMac: DE:MO:-Prefix erkannt, echte MACs nicht', () => {
  assert.equal(isDemoMac('DE:MO:RA:SI:00:01'), true);
  assert.equal(isDemoMac('AA:BB:CC:DD:EE:01'), false);
  assert.equal(isDemoMac(null), false);
});

test('metaDefaults: Name nach Index, Farbe aus Palette (Modulo)', () => {
  assert.deepEqual(metaDefaults(0), { name: 'Kart 1', color: PALETTE[0], lastSeenAt: null });
  assert.equal(metaDefaults(5).color, PALETTE[0]);   // 5 % 5 = 0
  assert.equal(metaDefaults(6).name, 'Kart 7');
});

test('ensureMeta: legt Default an, laesst Bestehendes unangetastet', () => {
  const map = {};
  const r1 = ensureMeta(map, 'AA:01', 0);
  assert.equal(r1.created, true);
  assert.equal(map['AA:01'].name, 'Kart 1');
  map['AA:01'].name = 'Blitz';
  const r2 = ensureMeta(map, 'AA:01', 3);
  assert.equal(r2.created, false);
  assert.equal(r2.entry.name, 'Blitz');
});

test('migrateLegacyMeta: uebernimmt Name/Farbe, ergaenzt lastSeenAt', () => {
  const map = {};
  const legacy = JSON.stringify({ 'AA:01': { name: 'Rot', color: '#e85a7a' } });
  assert.equal(migrateLegacyMeta(map, legacy), true);
  assert.deepEqual(map['AA:01'], { name: 'Rot', color: '#e85a7a', lastSeenAt: null });
});

test('migrateLegacyMeta: nur wenn Ziel leer (idempotent)', () => {
  const map = { 'BB:02': { name: 'Neu', color: '#3aa0e8', lastSeenAt: 5 } };
  const legacy = JSON.stringify({ 'AA:01': { name: 'Alt', color: '#fff' } });
  assert.equal(migrateLegacyMeta(map, legacy), false);
  assert.equal(map['AA:01'], undefined);
});

test('migrateLegacyMeta: korruptes JSON / null wirft nicht', () => {
  assert.equal(migrateLegacyMeta({}, '{kaputt'), false);
  assert.equal(migrateLegacyMeta({}, null), false);
  assert.equal(migrateLegacyMeta({}, JSON.stringify({ 'AA:01': 'quatsch' })), false);
});

test('migrateLegacyMeta: Nicht-Hex-Farbe faellt auf Palette zurueck', () => {
  const map = {};
  const legacy = JSON.stringify({ 'AA:01': { name: 'Rot', color: 'red;background:url(x)' } });
  assert.equal(migrateLegacyMeta(map, legacy), true);
  assert.equal(map['AA:01'].color, PALETTE[0]);
});

test('rosterMacs: Registry zuerst (Reihenfolge erhalten), offline nach lastSeenAt', () => {
  const meta = {
    'OF:ALT': { name: 'a', color: '#fff', lastSeenAt: 100 },
    'ON:01':  { name: 'b', color: '#fff', lastSeenAt: 999 },
    'OF:NEU': { name: 'c', color: '#fff', lastSeenAt: 200 },
  };
  assert.deepEqual(rosterMacs(meta, ['ON:01', 'DE:MO:RA:SI:00:01']),
    ['ON:01', 'DE:MO:RA:SI:00:01', 'OF:NEU', 'OF:ALT']);
  assert.deepEqual(rosterMacs({}, []), []);
});

test('rosterMacs: default-Platzhalter-Bucket wird nie angezeigt', () => {
  const meta = { 'default': { name: 'x', color: '#fff', lastSeenAt: 9 },
                 'AA:01': { name: 'a', color: '#fff', lastSeenAt: 1 } };
  assert.deepEqual(rosterMacs(meta, ['default', 'ON:01']), ['ON:01', 'AA:01']);
});

test('clampServiceH: 0..500, NaN -> 0', () => {
  assert.equal(clampServiceH(10.5), 10.5);
  assert.equal(clampServiceH(-3), 0);
  assert.equal(clampServiceH(9999), 500);
  assert.equal(clampServiceH('abc'), 0);
});

test('calDefaults: frisches Objekt mit Registry-Defaults', () => {
  const a = calDefaults(); const b = calDefaults();
  assert.notEqual(a, b);
  assert.deepEqual(a, { gxZero: 0, gyZero: 0, swapG: false, invertGx: false,
                        invertGy: false, invertYaw: false, invertRollRate: false, rollZero: 0 });
});

test('ackTargetMac: from_mac gewinnt, wenn ein Fenster offen ist', () => {
  assert.equal(ackTargetMac('BB:02', 'AA:01', ['AA:01', 'BB:02']), 'BB:02');
});

test('ackTargetMac: ohne from_mac (alte Firmware) -> letztes Anfrage-Ziel', () => {
  assert.equal(ackTargetMac(null, 'AA:01', ['AA:01', 'BB:02']), 'AA:01');
});

test('ackTargetMac: kein passendes offenes Fenster -> null', () => {
  assert.equal(ackTargetMac('CC:03', 'AA:01', ['BB:02']), null);
  assert.equal(ackTargetMac(null, null, ['AA:01']), null);
  assert.equal(ackTargetMac('AA:01', null, null), null);
});
