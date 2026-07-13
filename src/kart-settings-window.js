// ============================================================
//  RasiCross — kart-settings-window.js  (Einstellungs-Fenster pro Kart, Phase 48)
// ============================================================
//  Echte OS-Fenster via window.open aus dem Haupt-Renderer: das Kind ist
//  same-origin (about:blank), der Haupt-Renderer baut dessen DOM auf und
//  bindet alle Handler selbst — kein IPC, kein State-Sync. Mehrere Fenster
//  parallel (Map mac -> Rekord); zweiter ⚙-Klick fokussiert nur.
//  ESP-Feldwerte werden NIE vom Refresh ueberschrieben (nur config_ack
//  fuellt sie, Task 6); Fokus-Schutz gilt pro Fenster.
//  Nur Deklarationen auf Top-Level — kein Code laeuft beim Laden.
// ============================================================
import { state, rcToast, rcConfirm, saveData, saveDataDebounced,
         kartMetaFor, kartRosterMacs, kartCalFor, kartEngineFor, kartStatsFor,
         updateKartMeta, bridgeSend } from './rasicross.js';
import { ESP_CFG_FIELDS } from './esp-config.js';
import { drawGMeter } from './gauges.js';
import RasiEngine from './engine.js';
import RasiKartRoster from './kart-roster.js';
import RasiKartBar from './kart-bar.js';
import KartRegistry from './kart-registry.js';
import { renderKartsTab } from './karts-page.js';

// mac -> { mac, win, doc, ackTimer, zeroBusy, lastEspUsable }
const _wins = new Map();

function _el(r, id) { return r.doc.getElementById(id); }

function _kartIdx(mac) { return Math.max(0, state.karts.macs().indexOf(mac)); }

// Live-Bucket NUR lesen, wenn er existiert — state.karts.get() wuerde sonst
// einen leeren Bucket fuer ein offline-Kart anlegen.
function _liveKart(mac) {
  return (mac && state.karts.has(mac)) ? state.karts.get(mac) : null;
}

// target_mac explizit auf das FENSTER-Kart setzen (Muster pit-wall.js) —
// der bridgeSend-Default waere das aktive Kart.
function _sendTo(mac, payload) {
  if (mac && mac !== KartRegistry.DEFAULT_MAC) payload.target_mac = mac;
  return bridgeSend(payload);
}

// Fenster-Markup: statisches HTML ohne Inline-Handler (CSP script-src 'self');
// alle dynamischen Werte setzt _refreshWin per DOM-API.
function _markup() {
  return '<div class="pw-library" style="margin:0">'
    + '<section class="settings-group active" id="kartIdPanel">'
    +   '<header class="settings-group-head">'
    +     '<div><h2 class="settings-group-title">Identität</h2><p class="settings-group-sub">Name &amp; Farbe</p></div>'
    +   '</header>'
    +   '<div class="settings-row">'
    +     '<div class="settings-row-label"><span class="settings-row-name">Name</span><span class="settings-row-desc">Anzeige in Chip-Leiste, Karten und Rennen</span></div>'
    +     '<input type="text" id="kartName" maxlength="20">'
    +   '</div>'
    +   '<div class="settings-row">'
    +     '<div class="settings-row-label"><span class="settings-row-name">Farbe</span><span class="settings-row-desc">Frei wählbar — Schnellwahl darunter</span></div>'
    +     '<input type="color" id="kartColor">'
    +   '</div>'
    +   '<div class="row" id="kartPaletteRow" style="gap:8px;margin:4px 0 8px"></div>'
    +   '<div class="kc-mac" id="kartMacText"></div>'
    + '</section>'
    + '</div>';
}

function openKartSettings(mac) {
  const existing = _wins.get(mac);
  if (existing && existing.win && !existing.win.closed) {
    try { existing.win.focus(); } catch (e) {}
    return;
  }
  const win = window.open('', '_blank', 'width=460,height=720');
  if (!win) {
    rcToast('Popup blockiert — bitte Popups für die App erlauben', 4000);
    return;
  }
  const doc = win.document;
  doc.documentElement.dataset.theme = state.theme;
  // Styles des Hauptfensters klonen: Vite inlined das App-CSS als <style>-
  // Knoten (Dev: von Vite injizierte <style>; Fonts-<link> ist absolut).
  document.querySelectorAll('style, link[rel="stylesheet"]').forEach((n) => {
    doc.head.appendChild(doc.importNode(n, true));
  });
  doc.body.innerHTML = _markup();
  doc.body.style.cssText = 'padding:14px;overflow-y:auto';
  const r = { mac, win, doc, ackTimer: null, zeroBusy: false, lastEspUsable: null };
  _wins.set(mac, r);
  _el(r, 'kartMacText').textContent = mac;
  _bindHandlers(r);
  _refreshWin(r);
}

function _bindHandlers(r) {
  const name = _el(r, 'kartName');
  name.oninput = () => {
    updateKartMeta(r.mac, { name: name.value.trim() || ('Kart ' + (_kartIdx(r.mac) + 1)) });
    RasiKartBar.render(state);
    renderKartsTab();
    r.doc.title = kartMetaFor(r.mac, _kartIdx(r.mac)).name + ' — Einstellungen';
  };
  const col = _el(r, 'kartColor');
  col.oninput = () => {
    updateKartMeta(r.mac, { color: col.value });
    RasiKartBar.render(state);
    renderKartsTab();
    _renderPalette(r);
  };
}

function _renderPalette(r) {
  const row = _el(r, 'kartPaletteRow');
  if (!row) return;
  const cur = kartMetaFor(r.mac, _kartIdx(r.mac)).color;
  row.innerHTML = RasiKartRoster.PALETTE.map((c) =>
    '<span class="kc-sw' + (c === cur ? ' active' : '') + '" data-color="' + c
    + '" style="background:' + c + ';cursor:pointer"></span>').join('');
  row.querySelectorAll('[data-color]').forEach((sw) => {
    sw.onclick = () => {
      const c = sw.getAttribute('data-color');
      updateKartMeta(r.mac, { color: c });
      const colEl = _el(r, 'kartColor');
      if (colEl) colEl.value = c;
      RasiKartBar.render(state);
      renderKartsTab();
      _renderPalette(r);
    };
  });
}

function _refreshWin(r) {
  const m = kartMetaFor(r.mac, _kartIdx(r.mac));
  r.doc.title = m.name + ' — Einstellungen';
  // Fokus-Schutz PRO FENSTER: waehrend der Nutzer in diesem Fenster tippt,
  // keine Eingabefelder ueberschreiben.
  const ae = r.doc.activeElement;
  const typing = !!(ae && (ae.tagName === 'INPUT' || ae.tagName === 'SELECT'));
  if (!typing) {
    const nameEl = _el(r, 'kartName');
    if (nameEl && nameEl.value !== m.name) nameEl.value = m.name;
    const colEl = _el(r, 'kartColor');
    if (colEl && /^#[0-9a-f]{6}$/i.test(m.color) && colEl.value !== m.color.toLowerCase()) {
      colEl.value = m.color.toLowerCase();
    }
    _renderPalette(r);
  }
}

// 1-Hz-Hook (live-ui.js): geschlossene Fenster aufraeumen, verschwundene
// Roster-Karts schliessen (Demo-Ende, Vergessen), Rest aktualisieren.
function refreshKartSettingsWindows() {
  if (!_wins.size) return;
  const roster = kartRosterMacs();
  for (const [mac, r] of _wins) {
    if (!r.win || r.win.closed) { _wins.delete(mac); continue; }
    if (roster.indexOf(mac) === -1) {
      try { r.win.close(); } catch (e) {}
      _wins.delete(mac);
      continue;
    }
    try { _refreshWin(r); } catch (e) { console.warn('kartSettingsRefresh:', e); }
  }
}

function closeAllKartSettings() {
  for (const [, r] of _wins) {
    try { if (r.win && !r.win.closed) r.win.close(); } catch (e) {}
  }
  _wins.clear();
}

function initKartSettingsWindows() {
  // Reload/Schliessen des Hauptfensters: Kinder haetten sonst keine Logik
  // mehr (alle Handler leben hier im Haupt-Renderer).
  window.addEventListener('beforeunload', closeAllKartSettings);
}

// ESM-Export (Phase 48)
export { openKartSettings, refreshKartSettingsWindows, closeAllKartSettings,
         initKartSettingsWindows };

// Interface-Marker (Phase 48 Task 4): Task 5/6 nutzen diese Imports fuer
// weitere Panels (Kalibrierung, ESP) — hier nur ESLint no-unused-vars ruhig
// stellen; wieder entfernen, sobald benutzt.
void [saveData, saveDataDebounced, kartCalFor, kartEngineFor, kartStatsFor, drawGMeter, RasiEngine, ESP_CFG_FIELDS, rcConfirm, _sendTo, _liveKart];
