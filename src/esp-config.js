// ============================================================
//  RasiCross — esp-config.js  (ESP-Konfigurationsformular + Ack, Phase 44)
//  Herausgeloest aus rasicross.js — NUR bewegt, nicht geaendert.
// ============================================================

import { $, setText, logTime } from './rasicross.js';
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
let _espAckTimer = null;
function applyEspConfigAck(d, expectedMac) {
  // Phase 47: Das Formular zeigt das im Karts-Tab GEWAEHLTE Kart — Acks
  // fremder Karts nicht uebernehmen. Ohne from_mac (alte Firmware) oder
  // ohne Erwartung: Verhalten wie bisher.
  if (expectedMac && d.from_mac && d.from_mac !== expectedMac) return;
  clearTimeout(_espAckTimer);
  _espAckTimer = null;
  for (const [id, key] of ESP_CFG_FIELDS) {
    const el = $(id);
    if (el && d[key] != null) el.value = d[key];
  }
  // Akkuzellen-Zahl gehoert zum bestaetigenden Kart (per from_mac), sonst aktiver Kart.
  const _k = kartFor(d.from_mac || KartRegistry.DEFAULT_MAC) || activeKart();
  if (d.bc != null) _k.batt.cells = Number(d.bc) || _k.batt.cells;
  setText('espSendStatus', '✓ Vom Kart bestätigt ' + logTime());
}
// Phase 44: Accessor fuer rasicross.js' init() -- ESM-Importe von let-Variablen
// sind read-only, deshalb Setter-Funktion statt Direktzuweisung auf
// _espAckTimer (gleiches Muster wie kart3dIsReady/resetAttitudeClock, Phase 42).
function armEspAckTimer(ms, onTimeout) {
  clearTimeout(_espAckTimer);
  _espAckTimer = setTimeout(onTimeout, ms);
}

export { ESP_CFG_FIELDS, applyEspConfigAck, armEspAckTimer };
