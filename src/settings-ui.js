// ============================================================
//  RasiCross — settings-ui.js  (Settings-UI, Phase 44)
//  Herausgeloest aus rasicross.js — NUR bewegt, nicht geaendert.
// ============================================================

import { drawTrack } from './map-draw.js';
import { renderSavedTracks } from './track.js';
import { restartDisplayUpdateInterval } from './pit-wall.js';
import RasiSettings from './settings.js';
import RasiTileRenderer from './tile-renderer.js';
import { state, saveData } from './store.js';
import { $, setText, rcAlert, rcConfirm, rcToast, formatBytes } from './rasicross.js';

const TILES_PRESETS = [
  '',
  'https://basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png',
  'https://basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png',
  'https://basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png',
  'https://a.tile.opentopomap.org/{z}/{x}/{y}.png',
  'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
];

function applyTilesPresetFromUrl() {
  const sel = $('setTilesPreset');
  const url = $('setTilesUrl');
  if (!sel || !url) return;
  const cur = (url.value || '').trim();
  sel.value = TILES_PRESETS.indexOf(cur) >= 0 ? cur : '__custom__';
}

function onTilesPresetChanged() {
  const sel = $('setTilesPreset');
  const url = $('setTilesUrl');
  if (!sel || !url) return;
  const v = sel.value;
  if (v === '__custom__') { url.focus(); return; }
  if (url.value === v) return;
  let prevHost = 'tile.openstreetmap.org';
  try { if (url.value) prevHost = new URL(url.value).host || prevHost; } catch (_) {}
  url.value = v;
  updateTilesUrlHint();
  if (!state.settings.tiles) state.settings.tiles = { enabled: true, urlTemplate: '', liveQuickToggle: true };
  state.settings.tiles.urlTemplate = v;
  saveData();
  let newHost = 'tile.openstreetmap.org';
  try { if (v) newHost = new URL(v).host || newHost; } catch (_) {}
  if (prevHost !== newHost) {
    rcToast('Stil geändert — neue Tiles können in der Strecken-Bibliothek geladen werden');
  }
  try { drawTrack(); renderSavedTracks(); } catch (e) {}
}

function updateTilesUrlHint() {
  const el = $('setTilesUrl');
  const hint = $('setTilesUrlHint');
  if (!el || !hint) return;
  const v = (el.value || '').trim();
  const ok = !v || (v.indexOf('{z}') >= 0 && v.indexOf('{x}') >= 0 && v.indexOf('{y}') >= 0);
  el.classList.toggle('invalid', !ok);
  hint.textContent = ok
    ? (v ? 'Gültige Vorlage.' : 'Leer = OSM Standard wird verwendet.')
    : 'Vorlage muss {z}, {x}, {y} enthalten.';
}

async function onTilesClearClicked() {
  if (!window.rasiTiles) {
    rcAlert('Tile-Cache nur in der Desktop-App verfügbar.', 'Karten-Hintergrund');
    return;
  }
  if (!await rcConfirm('Alle gecachten Karten-Tiles löschen?', 'Cache leeren', 'Löschen', true)) return;
  try {
    const r = await window.rasiTiles.clearAll();
    RasiTileRenderer.clearMemory();
    rcToast(`${r.deleted || 0} Tiles entfernt (${formatBytes(r.bytes || 0)})`);
    try { drawTrack(); renderSavedTracks(); } catch (e) {}
  } catch (e) {
    rcAlert('Cache konnte nicht geleert werden: ' + (e && e.message ? e.message : e), 'Karten-Hintergrund');
  }
}

function showSettingsGroup(id) {
  const next = RasiSettings.settingsNavReducer(
    (state.settings && state.settings.uiActiveGroup) || 'dashboard',
    { type: 'set', id }
  );
  state.settings.uiActiveGroup = next;
  document.querySelectorAll('#tab-settings .settings-nav-item').forEach(b =>
    b.classList.toggle('active', b.dataset.sgroup === next));
  document.querySelectorAll('#tab-settings .settings-group').forEach(s =>
    s.classList.toggle('active', s.dataset.sgroup === next));
}

function loadSettingsToUi() {
  $('setMaxSpeed').value = state.settings.maxSpeed;
  $('setMaxRpm').value = state.settings.maxRpm;
  $('setRpmWarn').value = state.settings.rpmWarning;
  $('setGScale').value = state.settings.gScale;
  $('setMinLap').value = state.settings.minLapSeconds;
  if ($('setDriftTol')) $('setDriftTol').value = state.settings.drift.tol;
  if ($('setDriftMinSpeed')) $('setDriftMinSpeed').value = state.settings.drift.minSpeedKmh;
  if ($('setRolloverAngle')) $('setRolloverAngle').value = (state.settings.rollover && state.settings.rollover.angleDeg) || 75;
  if ($('setDisplayUpdateMs')) $('setDisplayUpdateMs').value = state.settings.displayUpdateMs || 500;
  $('settingsHint').textContent = `${state.settings.maxSpeed} km/h · ${state.settings.maxRpm} rpm`;
  if ($('recAutoArmToggle')) $('recAutoArmToggle').checked = state.settings.recordAutoArm !== false;
  if ($('setTilesEnabled')) {
    $('setTilesEnabled').checked = !!(state.settings.tiles && state.settings.tiles.enabled);
  }
  if ($('setTilesUrl')) {
    $('setTilesUrl').value = (state.settings.tiles && state.settings.tiles.urlTemplate) || '';
    updateTilesUrlHint();
    applyTilesPresetFromUrl();
  }
  showSettingsGroup((state.settings && state.settings.uiActiveGroup) || 'dashboard');
}
let _settingsSaveTimer = null;
let _flashTimerId = null;
function flashSettingsSaved() {
  const active = document.querySelector('#tab-settings .settings-group.active [data-savemark]');
  if (!active) return;
  active.classList.add('show');
  clearTimeout(_flashTimerId);
  _flashTimerId = setTimeout(() => active.classList.remove('show'), 1500);
}
function scheduleSettingsSave() {
  clearTimeout(_settingsSaveTimer);
  _settingsSaveTimer = setTimeout(() => { saveSettingsFromUi(); }, 150);
}
function saveSettingsFromUi() {
  state.settings.maxSpeed = Math.max(20, Math.min(200, Number($('setMaxSpeed').value) || 80));
  state.settings.maxRpm = Math.max(3000, Math.min(20000, Number($('setMaxRpm').value) || 10000));
  state.settings.rpmWarning = Math.max(2000, Math.min(state.settings.maxRpm, Number($('setRpmWarn').value) || 9000));
  state.settings.gScale = Math.max(2, Math.min(5, Number($('setGScale').value) || 3));
  state.settings.minLapSeconds = Math.max(3, Math.min(300, Number($('setMinLap').value) || 10));
  if (!state.settings.drift) state.settings.drift = { tol: 0.25, minSpeedKmh: 5, minLatG: 0.15 };
  state.settings.drift.tol = Math.max(0.05, Math.min(1, Number($('setDriftTol')?.value) || 0.25));
  state.settings.drift.minSpeedKmh = Math.max(1, Math.min(60, Number($('setDriftMinSpeed')?.value) || 5));
  if (!state.settings.rollover) state.settings.rollover = { angleDeg: 75 };
  state.settings.rollover.angleDeg = Math.max(30, Math.min(90, Number($('setRolloverAngle')?.value) || 75));
  const newInterval = Math.max(100, Math.min(2000, Number($('setDisplayUpdateMs')?.value) || 500));
  if (newInterval !== state.settings.displayUpdateMs) {
    state.settings.displayUpdateMs = newInterval;
    restartDisplayUpdateInterval();
  }
  if (!state.settings.tiles) state.settings.tiles = { enabled: true, urlTemplate: '', liveQuickToggle: true };
  if ($('setTilesEnabled')) state.settings.tiles.enabled = !!$('setTilesEnabled').checked;
  if ($('setTilesUrl')) state.settings.tiles.urlTemplate = ($('setTilesUrl').value || '').trim();
  loadSettingsToUi();
  saveData();
  flashSettingsSaved();
}

// Auto-Update-UI (Phase 25): Version + Status in den Einstellungen, Toast
// sobald ein Update heruntergeladen ist. Main-Prozess macht die Arbeit
// (electron-updater); im Browser/Dev-Modus degradiert die Anzeige sauber.
function initUpdateUi() {
  const statusEl = $('updStatus'), installBtn = $('updInstallBtn');
  const setStatus = (t) => { if (statusEl) statusEl.textContent = t; };
  if (!window.rasiUpdate) { setStatus('Updates: nur in der installierten App'); const b = $('updCheckBtn'); if (b) b.disabled = true; return; }
  window.rasiUpdate.version().then(v => {
    setText('updVersion', v.version || '--');
    if (v.guard === 'dev') setStatus('Updates: im Dev-Modus deaktiviert');
    else if (v.guard === 'portable') setStatus('Updates: Portable-Version aktualisiert sich nicht selbst');
  }).catch(() => {});
  window.rasiUpdate.onStatus(s => {
    if (!s) return;
    if (s.state === 'downloading') {
      setStatus('Update ' + (s.version ? 'auf ' + s.version + ' ' : '') + 'wird geladen' + (s.percent != null ? ' (' + s.percent + '%)' : '') + ' …');
    } else if (s.state === 'uptodate') {
      setStatus('Auf dem neuesten Stand (' + (s.version || '') + ')');
    } else if (s.state === 'ready') {
      setStatus('Update ' + (s.version || '') + ' bereit — wird beim Beenden installiert');
      if (installBtn) installBtn.style.display = '';
      rcToast('⬇ Update ' + (s.version || '') + ' bereit — Installation beim Beenden', 5000);
    } else if (s.state === 'error') {
      setStatus('Update-Fehler: ' + (s.message || '?'));
    }
  });
  const checkBtn = $('updCheckBtn');
  if (checkBtn) checkBtn.onclick = async () => {
    setStatus('Suche nach Updates …');
    const r = await window.rasiUpdate.check().catch(() => null);
    if (r && r.ok === false) {
      setStatus(r.reason === 'dev' ? 'Updates: im Dev-Modus deaktiviert'
        : r.reason === 'portable' ? 'Updates: Portable-Version aktualisiert sich nicht selbst'
        : 'Update-Fehler: ' + (r.message || r.reason || '?'));
    }
  };
  if (installBtn) installBtn.onclick = () => window.rasiUpdate.install().catch(() => {});
}

export { applyTilesPresetFromUrl, onTilesPresetChanged, updateTilesUrlHint,
         onTilesClearClicked, showSettingsGroup, loadSettingsToUi,
         flashSettingsSaved, scheduleSettingsSave, saveSettingsFromUi,
         initUpdateUi };
