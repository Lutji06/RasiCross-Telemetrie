import test from 'node:test';
import assert from 'node:assert/strict';
import P from '../src/esp-payload.js';

// Phase 70: Lange Dezimalzahlen aus dem Kart-Fenster schoben die Config-
// Zeile ueber das 250-B-ESP-NOW-Limit -- die Bridge verwarf sie still
// (payload_too_long), das Fenster meldete nur "keine Bestaetigung".
const LANG = {
  type: 'config', send_ms: 80.33333333333333, pulses_per_rev: 1.9999999999,
  wheel_circ_m: 1.1938052083641213, gear_ratio: 6.333333333333333,
  batt_cells: 3.0000000001, batt_warn_v: 3.4499999999999997,
  batt_crit_v: 3.3000000000000003, batt_cal: 1.0234567891234567,
  rpm_ceiling: 16000.123456789, rpm_alpha: 0.30000000000000004,
  target_mac: 'de:ad:00:00:00:01',
};

test('roundEspConfig haelt die Zeile unter 250 Byte', () => {
  assert.ok(JSON.stringify(LANG).length > 250, 'Testdaten muessen das Limit reissen');
  assert.ok(JSON.stringify(P.roundEspConfig(LANG)).length <= 250);
});

test('roundEspConfig rundet wie das config_ack des Karts', () => {
  const r = P.roundEspConfig(LANG);
  assert.equal(r.wheel_circ_m, 1.1938);
  assert.equal(r.gear_ratio, 6.333);
  assert.equal(r.batt_warn_v, 3.45);
  assert.equal(r.batt_crit_v, 3.3);
  assert.equal(r.batt_cal, 1.023);
  assert.equal(r.rpm_alpha, 0.3);
});

test('roundEspConfig schneidet Ganzzahlfelder ab wie int() auf dem ESP', () => {
  const r = P.roundEspConfig(LANG);
  assert.equal(r.send_ms, 80);
  assert.equal(r.pulses_per_rev, 1);
  assert.equal(r.batt_cells, 3);
  assert.equal(r.rpm_ceiling, 16000);
});

test('roundEspConfig laesst Routing-Felder und Eingabe unveraendert', () => {
  const r = P.roundEspConfig(LANG);
  assert.equal(r.type, 'config');
  assert.equal(r.target_mac, 'de:ad:00:00:00:01');
  assert.equal(LANG.wheel_circ_m, 1.1938052083641213, 'Eingabe nicht mutieren');
});

test('roundEspConfig ignoriert fehlende und nicht-endliche Werte', () => {
  const r = P.roundEspConfig({ type: 'config', wheel_circ_m: Infinity });
  assert.equal(r.wheel_circ_m, Infinity);
  assert.equal('gear_ratio' in r, false);
});
