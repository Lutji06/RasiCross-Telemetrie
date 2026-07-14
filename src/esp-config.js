// ============================================================
//  RasiCross — esp-config.js  (ESP-Konfigurationsformular + Ack, Phase 44)
//  Herausgeloest aus rasicross.js — NUR bewegt, nicht geaendert.
// ============================================================

import { logTime } from './rasicross.js';
import { activeKart, kartFor } from './store.js';
import KartRegistry from './kart-registry.js';

// ESP-Config-Formular <- config_ack: [Input-ID, kompakter Funk-Key].
// Der Kart bestaetigt jede Config (und antwortet auf config_get) mit den
// TATSAECHLICH uebernommenen Werten — Gegenstueck: _ACK_KEYS in sender.py.
// Kompakte Keys, weil die langen Namen das 250-B-ESP-NOW-Limit sprengen.
const ESP_CFG_FIELDS = [
  ['espMaxRpm', 'mr'], ['espWarnRpm', 'wr'], ['espSendMs', 'sm'],
  ['espPulses', 'ppr'], ['espWheelCirc', 'wc'], ['espGearRatio', 'gear'],
  ['espBattCells', 'bc'], ['espBattWarnV', 'bwv'], ['espBattCritV', 'bcv'],
  ['espBattCal', 'bcal'], ['espRpmCeiling', 'rcl'], ['espRpmAlpha', 'ra'],
  ['espPageMs', 'pm'],
];
function applyEspConfigAck(d, doc) {
  // Phase 48: Zieldokument = Einstellungs-Fenster des bestaetigenden Karts
  // (routeConfigAck in kart-settings-window.js waehlt es); ohne doc kein
  // globales Formular mehr -> nichts tun.
  if (!doc) return;
  for (const [id, key] of ESP_CFG_FIELDS) {
    const el = doc.getElementById(id);
    if (el && d[key] != null) el.value = d[key];
  }
  // Akkuzellen-Zahl gehoert zum bestaetigenden Kart (per from_mac), sonst aktiver Kart.
  const _k = kartFor(d.from_mac || KartRegistry.DEFAULT_MAC) || activeKart();
  if (d.bc != null) _k.batt.cells = Number(d.bc) || _k.batt.cells;
  const st = doc.getElementById('espSendStatus');
  if (st) st.textContent = '✓ Vom Kart bestätigt ' + logTime();
}

export { ESP_CFG_FIELDS, applyEspConfigAck };
