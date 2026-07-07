// ============================================================
//  RasiCross — karts-page.js  (Karts-Tab, Phase 46)
// ============================================================
//  Eine Karte pro Roster-Kart (persistent) + Session-/Demo-Karts.
//  Rendert aus kartRosterMacs/kartMetaFor + Registry-Buckets; die
//  Aktionen (Umbenennen, Farbe, Vergessen, Service, Kalibrierung,
//  Reset-alle) haengen direkt an den Karten-Elementen.
//  Nur Deklarationen auf Top-Level — kein Code laeuft beim Laden.
// ============================================================
import { state, $, esc, setText,
         kartMetaFor, kartRosterMacs, kartCalFor, kartEngineFor } from './rasicross.js';
import RasiEngine from './engine.js';
import RasiKartRoster from './kart-roster.js';
import RasiKartBar from './kart-bar.js';

function _liveHtml(k, now) {
  const age = k.connection.lastPacketAt ? (now - k.connection.lastPacketAt) : 99999;
  const ageStr = age < 99999 ? (age / 1000).toFixed(1) + 's' : '--';
  const hzMap = state._kartHz || {};
  const hz = hzMap[k.connection.kartMac] != null ? hzMap[k.connection.kartMac] : '--';
  const rssi = k.connection.rssi != null ? k.connection.rssi + 'dBm' : '--';
  const batt = (k.batt && k.batt.present) ? ((k.batt.soc | 0) + '%') : '--';
  const rec = k.recording.armed ? '<span class="rec">●REC</span>' : '';
  return '<div class="kc-live"><span>' + hz + 'Hz</span><span>' + rssi + '</span>'
    + '<span>Alter ' + ageStr + '</span><span>Akku ' + batt + '</span>' + rec + '</div>';
}

function _engineHtml(mac) {
  const e = kartEngineFor(mac);
  if (!e) return '';
  const due = RasiEngine.serviceDue(e.totalMs, e.lastServiceMs, e.serviceIntervalH);
  return '<div class="kc-grid">'
    + '<div class="dstat"><span>Motorlaufzeit</span><b>' + RasiEngine.hoursText(e.totalMs) + '</b></div>'
    + '<div class="dstat"><span>Seit Wartung</span><b>' + RasiEngine.hoursText(RasiEngine.sinceServiceMs(e.totalMs, e.lastServiceMs)) + '</b></div>'
    + '</div>'
    + '<div class="kc-actions">'
    + (due ? '<span class="kc-warn">🔧 Wartung fällig</span>' : '')
    + '<label class="kc-mac">Intervall (h) <input type="number" class="kc-interval" data-action="interval" data-mac="' + esc(mac) + '" value="' + e.serviceIntervalH + '" min="0" max="500" step="0.5"></label>'
    + '<button type="button" class="btn ghost" data-action="service" data-mac="' + esc(mac) + '">Wartung erledigt</button>'
    + '</div>';
}

function _calHtml(mac) {
  const c = kartCalFor(mac);
  if (!c) return '';
  const flags = [c.swapG && 'GxGy-Swap', c.invertGx && 'Gx-Inv', c.invertGy && 'Gy-Inv',
                 c.invertYaw && 'Yaw-Inv', c.invertRollRate && 'Roll-Inv'].filter(Boolean).join(' · ') || 'keine Flags';
  return '<div class="kc-grid">'
    + '<div class="dstat"><span>Gx/Gy-Offset</span><b>' + (Number(c.gxZero) || 0).toFixed(2) + ' / ' + (Number(c.gyZero) || 0).toFixed(2) + '</b></div>'
    + '<div class="dstat"><span>Roll-Null</span><b>' + (Number(c.rollZero) || 0).toFixed(1) + '°</b></div>'
    + '<div class="dstat"><span>Achsen</span><b style="font-size:11px">' + flags + '</b></div>'
    + '</div>'
    + '<div class="kc-actions"><button type="button" class="btn ghost" data-action="calreset" data-mac="' + esc(mac) + '">Kalibrierung zurücksetzen</button>'
    + '<span class="grow"></span>'
    + '<button type="button" class="btn danger" data-action="forget" data-mac="' + esc(mac) + '">Kart vergessen</button></div>';
}

function _cardHtml(mac, idx, now) {
  const m = kartMetaFor(mac, idx);
  const online = state.karts.has(mac);
  const k = online ? state.karts.get(mac) : null;
  const demo = RasiKartRoster.isDemoMac(mac);
  const activeCls = (mac === state.activeKartMac && online) ? ' active' : '';
  const offCls = online ? '' : ' offline';
  const badge = demo ? '<span class="kc-badge demo">DEMO</span>'
    : (online ? '' : '<span class="kc-badge">OFFLINE</span>');
  const seen = (!online && m.lastSeenAt)
    ? '<div class="kc-live"><span>Zuletzt gesehen ' + new Date(m.lastSeenAt).toLocaleString('de-DE') + '</span></div>'
    : (!online ? '<div class="kc-live"><span>Noch nie verbunden</span></div>' : '');
  const swatches = RasiKartRoster.PALETTE.map(col =>
    '<span class="kc-sw' + (col === m.color ? ' active' : '') + '" data-action="color" data-mac="' + esc(mac) + '" data-color="' + col + '" style="background:' + col + '"></span>').join('');
  return '<div class="kart-card' + activeCls + offCls + '" data-mac="' + esc(mac) + '" style="--kart:' + esc(m.color) + '">'
    + '<div class="kc-head">'
    +   '<span class="kc-dot"></span>'
    +   '<div><input type="text" class="kc-name-input" data-action="name" data-mac="' + esc(mac) + '" maxlength="20" value="' + esc(m.name) + '">' + badge
    +   '<div class="kc-mac">' + esc(mac) + '</div></div>'
    +   '<div class="kc-swatches">' + swatches + '</div>'
    + '</div>'
    + (online ? _liveHtml(k, now) : seen)
    + _engineHtml(mac) + _calHtml(mac)
    + '</div>';
}

function renderKartsTab() {
  const list = $('kartCardsList');
  if (!list) return;
  // Tipp-Schutz: waehrend ein Karten-Input den Fokus hat, nicht neu bauen
  // (der 1-Hz-Refresh wuerde sonst die Eingabe verwerfen).
  const ae = document.activeElement;
  if (ae && list.contains(ae) && ae.tagName === 'INPUT') return;
  const macs = kartRosterMacs();
  setText('kartCount', macs.length);
  if (!macs.length) {
    list.innerHTML = '<div class="muted">Noch keine Karts — sie erscheinen mit dem ersten Telemetrie-Paket.</div>';
    return;
  }
  const now = Date.now();
  list.innerHTML = macs.map((mac, i) => _cardHtml(mac, i, now)).join('');
  bindCardEvents(list);
}

// Task 5 fuellt die Aktionen; das Geruest verdrahtet nur die Aktiv-Wahl.
function bindCardEvents(list) {
  list.querySelectorAll('.kart-card').forEach(card => {
    card.addEventListener('click', (ev) => {
      if (ev.target.closest('[data-action]')) return;   // Inputs/Buttons nicht kapern
      const mac = card.getAttribute('data-mac');
      if (state.karts.has(mac) && state.karts.setActive(mac)) {
        state.activeKartMac = mac;
        RasiKartBar.render(state);
        renderKartsTab();
      }
    });
  });
}

// ESM-Export (Phase 46)
export { renderKartsTab };
