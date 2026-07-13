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
         kartMetaFor, kartRosterMacs, kartCalFor, kartEngineFor, kartStatsFor,
         rcConfirm, rcToast, saveData, rasiPersistForget } from './rasicross.js';
import RasiEngine from './engine.js';
import RasiKartRoster from './kart-roster.js';
import RasiKartBar from './kart-bar.js';
import { renderKartSettings } from './kart-settings.js';
import { openKartSettings } from './kart-settings-window.js';
import RasiKartStats from './kart-stats.js';

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
    + (due ? '<div class="kc-actions"><span class="kc-warn">🔧 Wartung fällig</span></div>' : '');
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
    + '</div>';
}

function _statsHtml(mac) {
  const s = kartStatsFor(mac);
  if (!s) return '';
  return '<div class="kc-live"><span>Gefahren ' + RasiKartStats.kmText(s.odoM) + '</span>'
    + '<span>Ø ' + RasiKartStats.kmhText(RasiKartStats.avgKmh(s.odoM, s.moveMs)) + '</span>'
    + '<span>Top ' + RasiKartStats.kmhText(s.topKmh) + '</span>'
    + '<span>Fahrzeit ' + RasiEngine.hoursText(s.moveMs) + '</span></div>';
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
  return '<div class="kart-card' + activeCls + offCls + '" data-mac="' + esc(mac) + '" style="--kart:' + esc(m.color) + '">'
    + '<div class="kc-head">'
    +   '<span class="kc-dot"></span>'
    +   '<div><span class="kc-name">' + esc(m.name) + '</span>' + badge
    +   '<div class="kc-mac">' + esc(mac) + '</div></div>'
    +   '<button type="button" class="btn ghost" data-action="settings" data-mac="' + esc(mac) + '">⚙ Einstellungen</button>'
    + '</div>'
    + (online ? _liveHtml(k, now) : seen)
    + _statsHtml(mac)
    + _engineHtml(mac) + _calHtml(mac)
    + '</div>';
}

function renderKartsTab() {
  const list = $('kartCardsList');
  if (!list) return;
  // Phase 47: Dropdown+Panels der Kart-Einstellungen (eigener Fokus-Schutz).
  renderKartSettings();
  // Tipp-Schutz: waehrend ein Karten-Input den Fokus hat, nicht neu bauen
  // (der 1-Hz-Refresh wuerde sonst die Eingabe verwerfen).
  const ae = document.activeElement;
  if (ae && list.contains(ae) && ae.tagName === 'INPUT') return;
  const resetBtn = $('kartsResetAllBtn');
  if (resetBtn && !resetBtn._bound) { resetBtn._bound = true; resetBtn.onclick = resetAllKarts; }
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

function forgetKart(mac) {
  state.karts.forget(mac);
  // Bewusstes Vergessen loescht auch Kalibrierung/Motorstunden/Meta der MAC
  // (Semantik von Phase 39, jetzt eine Stelle: rasiPersistForget).
  rasiPersistForget(mac);
  if (state._kartHz) delete state._kartHz[mac];
  if (state.serial && state.serial.connected && window.rasiSerial && window.rasiSerial.writeLine) {
    try { window.rasiSerial.writeLine(JSON.stringify({ type: 'forget_kart_mac', mac })); } catch (e) {}
  }
  state.activeKartMac = state.karts.activeMac();
  saveData();
  rcToast('Kart vergessen');
  RasiKartBar.render(state);
  renderKartsTab();
}

async function resetAllKarts() {
  if (!await rcConfirm('Alle bekannten Karts vergessen? Namen/Farben, Kalibrierung und Motorstunden bleiben erhalten.',
      'Karts zurücksetzen', 'Zurücksetzen', true)) return;
  state.karts.reset();
  state._kartHz = {};
  state.activeKartMac = null;
  if (state.serial && state.serial.connected && window.rasiSerial && window.rasiSerial.writeLine) {
    try { window.rasiSerial.writeLine(JSON.stringify({ type: 'reset_karts' })); } catch (e) {}
  }
  rcToast('Alle Karts zurückgesetzt');
  RasiKartBar.render(state);
  renderKartsTab();
}

function bindCardEvents(list) {
  list.querySelectorAll('.kart-card').forEach(card => {
    card.addEventListener('click', (ev) => {
      if (ev.target.closest('[data-action]')) return;
      const mac = card.getAttribute('data-mac');
      if (state.karts.has(mac) && state.karts.setActive(mac)) {
        state.activeKartMac = mac;
        RasiKartBar.render(state);
        renderKartsTab();
      }
    });
  });
  list.querySelectorAll('[data-action="settings"]').forEach(btn => {
    btn.onclick = () => openKartSettings(btn.getAttribute('data-mac'));
  });
}

// ESM-Export (Phase 46)
export { renderKartsTab, forgetKart };
