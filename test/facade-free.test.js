// Guard (Phase 43): die Aktiv-Kart-Fassade ist entfernt -- state.<feld>
// fuer per-Kart-Felder waere still undefined. Dieser statische Scan
// verhindert Rueckfaelle dauerhaft (Kommentare zaehlen mit: auch dort
// sind die alten Pfade irrefuehrend).
import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = path.join(fileURLToPath(new URL('.', import.meta.url)), '..', 'src');
const PER_KART_FIELDS = ['connection','telemetry','raw','display','gps','spdSrc',
  'batt','max','charts','imu','drift','attitude','driftSmooth','heatmap','lapStart',
  'currentLapMax','currentLapTrace','bestLapTrace','bestLapMs','bestLapNum','liveDelta',
  'autoLap','sectorsLive','sectorsBest','recording','replay','calibration','engine'];
const RE = new RegExp('\\bstate\\.(' + PER_KART_FIELDS.join('|') + ')\\b');

test('facade-free: kein src-Modul liest state.<per-Kart-Feld>', () => {
  const offenders = [];
  for (const f of fs.readdirSync(SRC).filter(n => n.endsWith('.js'))) {
    const lines = fs.readFileSync(path.join(SRC, f), 'utf8').split(/\r?\n/);
    lines.forEach((line, i) => { if (RE.test(line)) offenders.push(`${f}:${i + 1}: ${line.trim()}`); });
  }
  assert.deepStrictEqual(offenders, []);
});
