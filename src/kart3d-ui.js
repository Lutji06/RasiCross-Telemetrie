// ============================================================
//  RasiCross — kart3d-ui.js  (3D-Viewer: GView-Toggle + Modell-Uploader, Phase 44)
//  Herausgeloest aus rasicross.js (via app-init.js) — NUR bewegt, nicht geaendert.
// ============================================================

import RasiKart3D from './karts3d.js';
import { state, saveData } from './store.js';
import { $, rcToast, rcConfirm } from './rasicross.js';

// 3D-Viewer instance state (single global; rAF lifecycle managed by start/stop).
// Geteilt mit gauges.js (drawGMeter-Tick) und live-ui.js (updateLiveKPIs).
let _kart3dReady = false;
let _kart3dLastTick = 0;
// Phase 42: Accessoren fuer gauges.js -- ESM-Importe von let-Variablen sind
// read-only Momentaufnahmen, deshalb Funktions-API statt Direktzugriff.
function kart3dIsReady() { return _kart3dReady; }
function kart3dTickDt(now) {
  const dtMs = _kart3dLastTick ? (now - _kart3dLastTick) : 16;
  _kart3dLastTick = now;
  return dtMs;
}

function initGViewToggle() {
  const wrap = $('gViewToggle');
  const c2d = $('gMeterCanvas');
  const c3d = $('gMeter3dCanvas');
  if (!wrap || !c2d || !c3d) return;

  // Try to bring up the 3D backend exactly once.
  try {
    _kart3dReady = !!RasiKart3D.init(c3d, { gScale: state.settings.gScale });
  } catch (e) { _kart3dReady = false; }
  if (!_kart3dReady) {
    const btn3d = wrap.querySelector('button[data-view="3d"]');
    if (btn3d) { btn3d.classList.add('disabled'); btn3d.disabled = true; }
    // Force a known-good state if persisted gView was '3d' but 3D failed.
    if (state.settings.gView === '3d') {
      state.settings.gView = '2d';
      saveData();
    }
  }

  applyGView(state.settings.gView || '2d');

  wrap.querySelectorAll('button').forEach((btn) => {
    btn.addEventListener('click', () => {
      const target = btn.getAttribute('data-view');
      if (target === '3d' && !_kart3dReady) {
        rcToast('3D nicht verfügbar — WebGL fehlt');
        return;
      }
      const next = RasiKart3D.gViewReducer(state.settings.gView, 'set:' + target);
      if (next === state.settings.gView) return;
      state.settings.gView = next;
      saveData();
      applyGView(next);
    });
  });
}

function applyGView(view) {
  const c2d = $('gMeterCanvas');
  const c3d = $('gMeter3dCanvas');
  const wrap = $('gViewToggle');
  if (!c2d || !c3d || !wrap) return;
  const is3d = (view === '3d') && _kart3dReady;
  c2d.classList.toggle('hidden', is3d);
  c3d.classList.toggle('hidden', !is3d);
  wrap.querySelectorAll('button').forEach((b) => {
    b.classList.toggle('active', b.getAttribute('data-view') === (is3d ? '3d' : '2d'));
  });
  if (is3d) {
    _kart3dLastTick = 0;  // reset dispatch clock so first frame uses the 16ms fallback
    RasiKart3D.start();
  } else {
    RasiKart3D.stop();
  }
}

function initKartModelUploader() {
  const wrap   = $('kartModelCard');
  const file   = $('kartModelFile');
  const name   = $('kartModelName');
  const resetB = $('kartModelResetBtn');
  const yawWrap = $('kartModelYawToggle');
  if (!wrap || !file || !name || !resetB || !yawWrap) return;

  // No Electron IPC bridge (e.g. WebApp / dev mode without preload):
  // hide the whole card and bail.
  if (!window.rasiKart) { wrap.classList.add('hidden'); return; }

  // Sync the heading toggle UI to the persisted setting.
  const persistedYaw = Number(state.settings.kartModelYaw) || 0;
  yawWrap.querySelectorAll('button').forEach((b) => {
    b.classList.toggle('active', Number(b.getAttribute('data-yaw')) === persistedYaw);
  });

  // Try to auto-load a previously uploaded model.
  window.rasiKart.loadKartModel().then((res) => {
    if (!res || !res.ok || !res.buffer) return;
    // If the 3D backend failed init (WebGL missing / not ready), keep the file
    // on disk so a future working start can pick it up. Do NOT call
    // loadCustomModel here — it would return {ok:false, error:'not-initialised'}
    // and the failure branch below would delete the user's valid file.
    if (!_kart3dReady) return;
    return RasiKart3D.loadCustomModel(res.buffer.buffer, persistedYaw).then((r) => {
      if (r && r.ok) {
        name.textContent = 'Eigenes Modell (geladen aus Speicher)';
      } else {
        // File on disk is unloadable -> clear it so we don't re-fail next start.
        window.rasiKart.clearKartModel().catch(() => {
          rcToast('Gespeichertes Modell konnte nicht gelöscht werden');
        });
      }
    });
  }).catch(() => { /* IPC not ready, leave primitive */ });

  // File-input change handler.
  file.addEventListener('change', async (e) => {
    const f = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!f) return;
    if (f.size > 10 * 1024 * 1024) { rcToast('Datei zu groß (max 10 MB)'); return; }
    let buf;
    try { buf = await f.arrayBuffer(); }
    catch (err) { rcToast('Datei konnte nicht gelesen werden'); return; }
    const u8 = new Uint8Array(buf);
    const saveRes = await window.rasiKart.saveKartModel(u8);
    if (!saveRes || !saveRes.ok) { rcToast('Speichern fehlgeschlagen: ' + (saveRes && saveRes.error || 'unknown')); return; }
    if (!_kart3dReady) {
      // File is on disk but 3D backend is unavailable (e.g. no WebGL). Reflect
      // that the upload succeeded so the user knows the next start will pick it up.
      name.textContent = f.name + ' (gespeichert — WebGL nicht verfügbar)';
      rcToast('Gespeichert — Modell wird beim nächsten Start geladen');
      return;
    }
    const loadRes = await RasiKart3D.loadCustomModel(buf, Number(state.settings.kartModelYaw) || 0);
    if (!loadRes || !loadRes.ok) {
      rcToast('Modell-Datei beschädigt — Standard bleibt aktiv');
      window.rasiKart.clearKartModel().catch(() => { /* best-effort cleanup */ });
      return;
    }
    name.textContent = f.name;
    rcToast('Eigenes Modell geladen');
  });

  // Heading-button handlers.
  yawWrap.querySelectorAll('button').forEach((btn) => {
    btn.addEventListener('click', () => {
      const next = Number(btn.getAttribute('data-yaw')) || 0;
      state.settings.kartModelYaw = next;
      saveData();
      yawWrap.querySelectorAll('button').forEach((b) => {
        b.classList.toggle('active', Number(b.getAttribute('data-yaw')) === next);
      });
      RasiKart3D.setHeadingOffset(next);
    });
  });

  // Reset-button handler.
  resetB.addEventListener('click', async () => {
    const yes = await rcConfirm('Eigenes Modell auf Standard zurücksetzen?', 'Zurücksetzen', 'Zurücksetzen', true);
    if (!yes) return;
    await window.rasiKart.clearKartModel();
    RasiKart3D.resetToPrimitive();
    state.settings.kartModelYaw = 0;
    saveData();
    name.textContent = 'Standard (Primitive)';
    yawWrap.querySelectorAll('button').forEach((b) => {
      b.classList.toggle('active', Number(b.getAttribute('data-yaw')) === 0);
    });
    rcToast('Auf Standard zurückgesetzt');
  });
}

export { kart3dIsReady, kart3dTickDt, initGViewToggle, initKartModelUploader };
