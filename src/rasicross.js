// ESM (Phase 42): explizite Imports statt gemeinsamem Global-Scope. Zyklen
// rasicross <-> UI-Module sind zulaessig -- alle Split-Scripts haben nur
// Deklarationen auf Top-Level, Aufrufe erfolgen erst nach init().
import { resizeCanvases } from './map-draw.js';
import { renderDrivers } from './laps-drivers.js';
import DomTargets from './dom-targets.js';
import KartRegistry from './kart-registry.js';
import { renderKartsTab } from './karts-page.js';
import { state, saveDataDebounced } from './store.js';
import { armRecording, driftInputs, processTelemetry, resetAttitudeClock } from './telemetry.js';

/* ============================================================
   RASICROSS TELEMETRY — Clean Implementation
   Sections:
     1. Constants & State
     2. Utilities
     3. Persistence               -> store.js (Phase 44)
     4. Custom Dialogs
     5. Tab navigation + Theme
     6. Settings                   -> settings-ui.js (Phase 44)
     7. Telemetry Pipeline        -> telemetry.js (Phase 44)
     8. Tacho/RPM/G-Meter          -> gauges.js (Phase 23)
     9. Track Map (drawing)        -> map-draw.js (Phase 22)
    10. Track Scan                 -> track.js (Phase 23)
    11. Track Persistence          -> track.js (Phase 23)
    12. Track Editor               -> track.js (Phase 23)
    13. Sectors                    -> track.js (Phase 23)
    14. Lap Detection              -> laps-drivers.js (Phase 23)
    15. Drivers                    -> laps-drivers.js (Phase 23)
    16. Races                      -> races.js (Phase 22)
    17. Live UI                    -> live-ui.js (Phase 23)
    18. Pit-Wall                   -> pit-wall.js (Phase 23)
    19. Serial / Demo              -> serial-demo.js (Phase 22)
    19b. Recording/Replay          -> recording.js (Phase 23)
    20. Init                       -> app-init.js + kart3d-ui.js + ui-glue.js (Phase 44)
   ============================================================ */

// ============================================================
// 1. CONSTANTS & STATE
// ============================================================
const $ = id => document.getElementById(id);
const css = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const dpr = () => window.devicePixelRatio || 1;
const uid = () => 'id_' + Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

// Send a command line to the bridge, tagged with the active kart's MAC so the
// bridge routes the downlink to the selected kart (target_mac is routing-only;
// the kart firmware ignores the unknown key). Returns true if written.
function bridgeSend(obj) {
  if (!window.rasiSerial || !window.rasiSerial.writeLine) return false;
  if (!state.serial || !state.serial.connected) return false;
  const mac = state.activeKartMac;
  const payload = Object.assign({}, obj);
  if (mac && mac !== KartRegistry.DEFAULT_MAC && !payload.target_mac) payload.target_mac = mac;
  try { window.rasiSerial.writeLine(JSON.stringify(payload)); return true; }
  catch (e) { return false; }
}
window.rasiBridgeSend = bridgeSend;

// ============================================================
// 2. UTILITIES
// ============================================================
// fmtMs / fmtClock / fmtDelta moved to geo.js (loaded as a <script> before rasicross.js; also a CommonJS module for tests)
function setText(id, val) { const e = $(id); if (e) e.textContent = val; }

// Shared-ID fan-out — Live and Detail share several values (Speed, RPM, Lap, ...).
function setTextShared(key, value) {
  const ids = DomTargets.targetIdsFor(key);
  for (const id of ids) setText(id, value);
}
function setHtmlShared(key, html) {
  const ids = DomTargets.targetIdsFor(key);
  for (const id of ids) {
    const el = $(id);
    if (el) el.innerHTML = html;
  }
}

// traceDistanceM moved to geo.js

// gpsDist / headingFromPoints / segmentsCross / crossingDirectionOk / lineEndpointsFromGate moved to geo.js
function logTime(ts = Date.now()) { return new Date(ts).toLocaleTimeString('de-DE'); }

export { SAVE_KEY, state, activeKart, kartFor, rasiPersistForget, kartMetaFor, updateKartMeta, kartRosterMacs, kartCalFor, kartEngineFor, kartStatsFor, saveData, saveDataDebounced, loadData, migrateLegacyKartMeta } from './store.js';

// ============================================================
// 4. CUSTOM DIALOGS
// ============================================================
function rcAlert(msg, title = 'Hinweis') {
  return new Promise(resolve => {
    setText('rcAlertTitle', title);
    setText('rcAlertMsg', msg);
    const btns = $('rcAlertBtns');
    btns.innerHTML = '';
    const ok = document.createElement('button');
    ok.className = 'btn primary'; ok.textContent = 'OK';
    ok.onclick = () => { $('rcAlertOverlay').classList.remove('show'); resolve(); };
    btns.appendChild(ok);
    $('rcAlertOverlay').classList.add('show');
    setTimeout(() => ok.focus(), 50);
  });
}
function rcConfirm(msg, title = 'Bestätigung', confirmLabel = 'OK', danger = false) {
  return new Promise(resolve => {
    setText('rcAlertTitle', title);
    setText('rcAlertMsg', msg);
    const btns = $('rcAlertBtns'); btns.innerHTML = '';
    const cancel = document.createElement('button');
    cancel.className = 'btn ghost'; cancel.textContent = 'Abbrechen';
    cancel.onclick = () => { $('rcAlertOverlay').classList.remove('show'); resolve(false); };
    const ok = document.createElement('button');
    ok.className = 'btn ' + (danger ? 'danger' : 'primary'); ok.textContent = confirmLabel;
    ok.onclick = () => { $('rcAlertOverlay').classList.remove('show'); resolve(true); };
    btns.appendChild(cancel); btns.appendChild(ok);
    $('rcAlertOverlay').classList.add('show');
    setTimeout(() => ok.focus(), 50);
  });
}
let _toastTimer = null;
function rcToast(msg, ms = 2000) {
  const el = $('rcToast'); if (!el) return;
  el.textContent = msg; el.classList.add('show');
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}

// ============================================================
// 5. TAB NAVIGATION + THEME
// ============================================================
function setupTabs() {
  // Initial: aktiven Tab am body markieren (CSS nutzt body[data-tab=live] fuer no-scroll-Layout)
  const _active = document.querySelector('.nav-item[data-tab].active');
  if (_active) document.body.dataset.tab = _active.dataset.tab;
  document.body.dataset.liveView = state.liveView || 'single';
  document.querySelectorAll('.nav-item[data-tab]').forEach(btn => {
    btn.onclick = () => {
      document.querySelectorAll('.nav-item[data-tab]').forEach(b => { b.classList.remove('active'); b.removeAttribute('aria-current'); });
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      btn.classList.add('active');
      btn.setAttribute('aria-current', 'page');
      const tab = btn.dataset.tab;
      const panel = $('tab-' + tab);
      if (panel) panel.classList.add('active');
      document.body.dataset.tab = tab;
      // Resize canvases when tab becomes visible
      setTimeout(resizeCanvases, 50);
      // Bei Driver-Tab: Stats neu berechnen (kann sich nach jedem Rennen aendern)
      if (tab === 'drivers') renderDrivers();
      if (tab === 'karts') renderKartsTab();
      // Task 7 – Settings-Suche beim Tab-Wechsel zuruecksetzen
      const _ss = document.getElementById('settingsSearch');
      if (_ss && _ss.value) { _ss.value = ''; _ss.dispatchEvent(new Event('input')); }
    };
  });
}
function applyTheme() {
  document.documentElement.dataset.theme = state.theme;
}
function toggleTheme() {
  // Cycle: dark -> light -> outdoor -> dark
  const order = ['dark', 'light', 'outdoor'];
  const idx = order.indexOf(state.theme);
  state.theme = order[(idx + 1) % order.length] || 'dark';
  applyTheme();
  saveDataDebounced();
}

// ============================================================
//  Audio-Cues: Web Audio API, keine externen Dateien
// ============================================================
const rcAudio = (() => {
  let ctx = null;
  let enabled = (() => {
    try { return localStorage.getItem('rc_audio') !== '0'; } catch(e) { return true; }
  })();
  function getCtx() {
    if (!ctx) {
      try { ctx = new (window.AudioContext || window.webkitAudioContext)(); }
      catch(e) { return null; }
    }
    if (ctx && ctx.state === 'suspended') ctx.resume().catch(()=>{});
    return ctx;
  }
  function beep(freq, durMs, vol) {
    if (!enabled) return;
    const c = getCtx(); if (!c) return;
    try {
      const osc = c.createOscillator();
      const g   = c.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      g.gain.value = vol == null ? 0.18 : vol;
      osc.connect(g).connect(c.destination);
      const t = c.currentTime;
      g.gain.setValueAtTime(g.gain.value, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + durMs / 1000);
      osc.start(t);
      osc.stop(t + durMs / 1000);
    } catch(e) {}
  }
  return {
    sectorBest: () => beep(880, 120, 0.15),
    lapBest:    () => { beep(1320, 120, 0.18); setTimeout(() => beep(1760, 180, 0.18), 140); },
    warning:    () => beep(220, 400, 0.22),
    pitCall:    () => { beep(660, 200, 0.2); setTimeout(() => beep(880, 200, 0.2), 220); },
    battWarn:   () => beep(300, 350, 0.2),
    battCrit:   () => { beep(200, 300, 0.25); setTimeout(() => beep(200, 300, 0.25), 320); },
    rollover:   () => { beep(160, 300, 0.3); setTimeout(() => beep(120, 450, 0.3), 300); },
    setEnabled: (v) => { enabled = !!v; try { localStorage.setItem('rc_audio', v ? '1' : '0'); } catch(e){} },
    isEnabled:  () => enabled,
  };
})();

function formatBytes(b) {
  if (!b || b < 1024) return (b | 0) + ' B';
  if (b < 1024 * 1024) return (b / 1024).toFixed(1) + ' KB';
  return (b / (1024 * 1024)).toFixed(1) + ' MB';
}

// (Sektion 8 "Tacho/RPM/G-Meter" -> gauges.js, Phase 23)

// (Sektion 9 "Track Map Drawing" -> map-draw.js, Phase 22)

// (Sektionen 10-13 "Track Scan/Persistence/Editor/Sectors" -> track.js, Phase 23)

// (Sektionen 14-15 "Lap Detection/Driver Stats/Drivers" -> laps-drivers.js, Phase 23)

// (Sektion 16 "Races" -> races.js, Phase 22)

// (Live Charts + Sektion 17 "Live UI" -> live-ui.js, Phase 23)

// (Sektion 18 "Pit-Wall" + Connection-Tab + Pit-Call -> pit-wall.js, Phase 23)

// (Sektion 19 "Serial / Demo" -> serial-demo.js, Phase 22)

// (Export/Import/Reset + Sektion 19b "Recording/Replay" -> recording.js, Phase 23)

// (Sektion 20 "Init" -> app-init.js; G-View/Kart-Model-Glue -> kart3d-ui.js;
//  DOMContentLoaded-IIFE/Sidebar-Spiegel -> ui-glue.js; alles Phase 44)

// Interface-Marker: Kern-Helfer/State, die nur noch von den ausgelagerten
// Modulen (Phase 22/23) genutzt werden -- verhindert no-unused-vars,
// dokumentiert das API.
void [css, dpr, esc, uid, setTextShared, setHtmlShared];

// ESM-Export (Phase 42): Kern-API fuer die src/-Module (bisherige
// appCoreGlobals aus eslint.config.js + Phase-42-Accessoren).
export {
  $, css, dpr, uid, esc, setText,
  rcAlert, rcConfirm, rcToast, rcAudio,
  formatBytes,
  setTextShared, setHtmlShared, logTime,
  processTelemetry, armRecording, driftInputs,
  resetAttitudeClock,
  bridgeSend, applyTheme, setupTabs, toggleTheme,
};
export { kart3dIsReady, kart3dTickDt } from './kart3d-ui.js';
