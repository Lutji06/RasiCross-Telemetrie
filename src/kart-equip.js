// ============================================================
//  RasiCross — kart-equip.js  (Kart-Ausstattung, Phase 57)
// ============================================================
//  Erst-Verbindungs-Dialog (Modal im Hauptfenster, Warteschlange) und
//  Ausstattungs-Sektion des Kart-Einstellungsfensters. Die Flags leben
//  im Roster-Meta ({equip:{rpm,display}, equipSet}); Konsumenten lesen
//  sie pro Render-Tick — nach Aenderungen ist kein Push-Refresh noetig.
//  Nur Deklarationen auf Top-Level — kein Code laeuft beim Laden.
// ============================================================
import { state, kartMetaFor, updateKartMeta } from './store.js';
import RasiKartRoster from './kart-roster.js';

function _metaIdx(mac) { return Math.max(0, state.karts.macs().indexOf(mac)); }

function _esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Ausstattung eines Karts lesen (normalisiert, nie null).
function equipForMac(mac) {
  return RasiKartRoster.equipFor(kartMetaFor(mac, _metaIdx(mac)));
}

// ---- Erst-Verbindungs-Dialog -------------------------------

const _queue = [];        // MACs, die auf den Dialog warten
let _open = null;         // MAC des gerade offenen Dialogs
const _asked = new Set(); // Session-Gedaechtnis — pro Kart hoechstens einmal

// telemetry.js ruft das pro Paket auf — Set-Lookup zuerst, billig halten.
function maybeShowEquipDialog(mac) {
  if (_asked.has(mac) || _open === mac || _queue.indexOf(mac) >= 0) return;
  const meta = kartMetaFor(mac, _metaIdx(mac));
  if (!RasiKartRoster.needsEquipDialog(meta, mac)) { _asked.add(mac); return; }
  _queue.push(mac);
  _processQueue();
}

function _processQueue() {
  if (_open || !_queue.length) return;
  _open = _queue.shift();
  _buildDialog(_open);
}

function _buildDialog(mac) {
  const meta = kartMetaFor(mac, _metaIdx(mac));
  const ov = document.createElement('div');
  ov.id = 'equipOverlay';
  ov.className = 'overlay show';
  ov.innerHTML = '<div class="dialog">'
    + '<h3>Neues Kart: ' + _esc(meta.name) + '</h3>'
    + '<p>Womit ist dieses Kart ausgestattet? Die Auswahl ist später im ⚙-Einstellungsfenster des Karts änderbar.</p>'
    + '<div class="toggle-row"><span class="label-text">RPM-Sensor</span><label class="toggle"><input type="checkbox" id="equipDlgRpm" checked><span class="toggle-knob"></span></label></div>'
    + '<div class="toggle-row"><span class="label-text">OLED-Display</span><label class="toggle"><input type="checkbox" id="equipDlgDisplay" checked><span class="toggle-knob"></span></label></div>'
    + '<div class="dialog-btns"><button class="btn primary" id="equipDlgSave">Übernehmen</button></div>'
    + '</div>';
  document.body.appendChild(ov);
  ov.querySelector('#equipDlgSave').onclick = () => {
    updateKartMeta(mac, {
      equip: {
        rpm: !!ov.querySelector('#equipDlgRpm').checked,
        display: !!ov.querySelector('#equipDlgDisplay').checked,
      },
      equipSet: true,
    });
    _asked.add(mac);
    ov.remove();
    _open = null;
    _processQueue();
  };
}

// ---- Sektion im Kart-Einstellungsfenster -------------------

function equipSectionMarkup() {
  return '<section class="settings-group active" id="kartEquipPanel" style="margin-top:14px">'
    + '<header class="settings-group-head">'
    +   '<div><h2 class="settings-group-title">Ausstattung</h2><p class="settings-group-sub">Sensoren &amp; Anzeige dieses Karts</p></div>'
    + '</header>'
    + '<div class="toggle-row"><span class="label-text">RPM-Sensor verbaut</span><label class="toggle"><input type="checkbox" id="equipRpm"><span class="toggle-knob"></span></label></div>'
    + '<div class="toggle-row"><span class="label-text">OLED-Display verbaut</span><label class="toggle"><input type="checkbox" id="equipDisplay"><span class="toggle-knob"></span></label></div>'
    + '<p class="settings-block-note">Ohne RPM-Sensor blendet die App alle Drehzahl-Anzeigen und die zugehörigen Sender-Felder aus.</p>'
    + '</section>';
}

const _EQUIP_TOGGLES = [['equipRpm', 'rpm'], ['equipDisplay', 'display']];

function bindEquipSection(r) {
  for (const [id, key] of _EQUIP_TOGGLES) {
    const el = r.doc.getElementById(id);
    if (el) el.onchange = () => {
      const eq = Object.assign({}, equipForMac(r.mac));
      eq[key] = !!el.checked;
      updateKartMeta(r.mac, { equip: eq, equipSet: true });
    };
  }
}

function refreshEquipSection(r) {
  const eq = equipForMac(r.mac);
  for (const [id, key] of _EQUIP_TOGGLES) {
    const el = r.doc.getElementById(id);
    if (el && el.checked !== !!eq[key]) el.checked = !!eq[key];
  }
}

// ---- ESP-Panel: sensorabhaengige Zeilen ein-/ausblenden ----

// Radumfang/Uebersetzung rechnen aus denselben Sensor-Pulsen wie die
// Drehzahl — ohne RPM-Sensor sind alle 7 Felder gegenstandslos.
const _RPM_ESP_IDS = ['espMaxRpm', 'espWarnRpm', 'espPulses', 'espWheelCirc',
                      'espGearRatio', 'espRpmCeiling', 'espRpmAlpha'];

function applyEquipToEspPanel(doc, eq) {
  const rowOf = (id) => {
    const el = doc.getElementById(id);
    return el ? el.closest('.settings-row') : null;
  };
  for (const id of _RPM_ESP_IDS) {
    const row = rowOf(id);
    if (row) row.classList.toggle('row-hidden', !eq.rpm);
  }
  const pm = rowOf('espPageMs');
  if (pm) pm.classList.toggle('row-hidden', !eq.display);
}

// ESM-Export (Phase 57)
export { equipForMac, maybeShowEquipDialog, equipSectionMarkup,
         bindEquipSection, refreshEquipSection, applyEquipToEspPanel };
