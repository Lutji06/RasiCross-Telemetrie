// ============================================================
//  RasiCross — esp-payload.js  (Config-Downlink ans Kart, Phase 70)
// ============================================================
//  Rundet die Werte aus dem Kart-Fenster auf die Stellen, mit denen
//  der Kart sie ohnehin bestaetigt (config_snapshot in config_store.py),
//  und schneidet Ganzzahlfelder ab wie int() auf dem ESP. Warum: eine
//  lange Dezimalzahl (z. B. Radumfang 1.1938052083641213) schob die
//  Config-Zeile ueber das 250-B-ESP-NOW-Limit; die Bridge verwarf sie
//  (payload_too_long) und das Fenster meldete nur "keine Bestaetigung".
//  Reines Modul -- kein DOM, keine Seiteneffekte.
// ============================================================

// Nachkommastellen je Feld; 0 = Ganzzahl (abschneiden wie Python int()).
const CFG_DIGITS = Object.freeze({
  send_ms: 0, pulses_per_rev: 0, batt_cells: 0, rpm_ceiling: 0,
  wheel_circ_m: 4, gear_ratio: 3, batt_warn_v: 2, batt_crit_v: 2,
  batt_cal: 3, rpm_alpha: 2,
});

function roundEspConfig(cfg) {
  const out = Object.assign({}, cfg);
  for (const key of Object.keys(CFG_DIGITS)) {
    const v = out[key];
    if (typeof v !== 'number' || !isFinite(v)) continue;
    const d = CFG_DIGITS[key];
    out[key] = d === 0 ? Math.trunc(v) : Number(v.toFixed(d));
  }
  return out;
}

export default { roundEspConfig, CFG_DIGITS };
