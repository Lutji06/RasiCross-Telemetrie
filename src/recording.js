// ============================================================
//  RasiCross -- recording.js  (Export/Import/Reset + Aufnahme/Replay,
//  Phase 23). ESM (Phase 42): explizite Imports statt gemeinsamem
//  Global-Scope. Nur Deklarationen auf Top-Level -- kein Code laeuft
//  beim Laden.
// ============================================================
import { fmtClock } from './geo.js';
import { state, $, uid, setText, rcAlert, rcConfirm, rcToast, saveData,
         SAVE_KEY, processTelemetry, driftInputs,
         resetAttitudeClock, activeKart } from './rasicross.js';
import { renderRaces } from './races.js';
import { drawTrack } from './map-draw.js';
import { onGpsUpdate } from './track.js';
import { disconnectSerial, stopDemo } from './serial-demo.js';
import KartRegistry from './kart-registry.js';
import RasiAttitude from './attitude.js';
import RasiDrift from './drift.js';
import RasiKart3D from './karts3d.js';
import RasiRecStore from './rec-store.js';
import RasiReplay from './replay.js';

// ============================================================
// EXPORT / IMPORT / RESET
// ============================================================
function exportAll() {
  const k = activeKart();
  const data = {
    version: '9.6', exportedAt: new Date().toISOString(),
    settings: state.settings, calibration: k.calibration,
    drivers: state.drivers, races: state.races,
    savedTracks: state.savedTracks,
    track: state.track, startGate: state.startGate,
    sectors: state.sectors,
    engine: { totalMs: k.engine.totalMs, lastServiceMs: k.engine.lastServiceMs, serviceIntervalH: k.engine.serviceIntervalH }
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `rasicross_v96_${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(url);
  rcToast('Export erstellt');
}
function importAll(file) {
  const reader = new FileReader();
  reader.onload = async () => {
    try {
      const d = JSON.parse(reader.result);
      if (!await rcConfirm('Aktuelle Daten überschreiben?', 'Importieren', 'Importieren', true)) return;
      const k = activeKart();
      if (d.settings) Object.assign(state.settings, d.settings);
      if (d.calibration) Object.assign(k.calibration, d.calibration);
      if (Array.isArray(d.drivers)) state.drivers = d.drivers;
      if (Array.isArray(d.races)) state.races = d.races;
      if (Array.isArray(d.savedTracks)) state.savedTracks = d.savedTracks;
      if (d.engine) {
        k.engine.totalMs = Number(d.engine.totalMs) || 0;
        k.engine.lastServiceMs = Number(d.engine.lastServiceMs) || 0;
        if (d.engine.serviceIntervalH != null) k.engine.serviceIntervalH = Number(d.engine.serviceIntervalH) || 0;
      }
      saveData();
      location.reload();
    } catch (e) { rcAlert('Import fehlgeschlagen:\n' + e.message); }
  };
  reader.readAsText(file);
}
async function resetAll() {
  if (!await rcConfirm('Alle Daten unwiderruflich löschen?', 'Zurücksetzen', 'Löschen', true)) return;
  localStorage.removeItem(SAVE_KEY);
  if (RasiRecStore.available()) {
    await RasiRecStore.clear().catch(() => {});
  }
  location.reload();
}

// ============================================================
// 19b. RECORDING SAVE / LOAD / REPLAY
// ============================================================
function updateRecStatus() {
  const el = $('recStatusText');
  if (!el) return;
  const k = activeKart();
  if (k.replay.active) { el.textContent = 'Replay aktiv'; return; }
  const n = k.recording.buf.length;
  el.textContent = k.recording.armed ? (n + ' Pakete aufgenommen') : 'Bereit';
}
// Dateinamen-Praefix aus dem Namen des aktiven Karts (Multi-Kart-Export),
// damit zwei Karts unterscheidbare Dateien ergeben.
function activeKartSlug() {
  const mac = state.activeKartMac;
  const meta = mac && state.kartMeta ? state.kartMeta[mac] : null;
  const name = meta && meta.name ? meta.name : '';
  const slug = name.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase();
  return slug ? slug + '_' : '';
}
function saveRecording() {
  // Replay aktiv -> die geladene Aufnahme speichern (z.B. nach Crash-Recovery),
  // sonst den Live-Mitschnitt.
  const k = activeKart();
  const buf = k.replay.active ? k.replay.packets : k.recording.buf;
  if (!buf.length) { rcToast('Keine Aufnahme vorhanden'); return; }
  const text = RasiReplay.serializeRecording(buf, { created: new Date().toISOString() });
  const blob = new Blob([text], { type: 'application/x-ndjson' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `rasicross_rec_${activeKartSlug()}${Date.now()}.ndjson`;
  a.click();
  URL.revokeObjectURL(url);
  rcToast('Aufnahme gespeichert (' + buf.length + ' Pakete)');
}
function exportRecordingCsv() {
  // Replay aktiv -> die geladene Aufnahme exportieren, sonst den Live-Mitschnitt.
  const k = activeKart();
  const buf = k.replay.active ? k.replay.packets : k.recording.buf;
  if (!buf.length) { rcToast('Keine Aufnahme vorhanden'); return; }
  const text = RasiReplay.recordingToCsv(buf);
  // UTF-8 BOM, damit Excel die Kodierung erkennt
  const blob = new Blob(['\uFEFF' + text], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `rasicross_rec_${activeKartSlug()}${Date.now()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  rcToast('CSV exportiert (' + (text.split('\r\n').length - 1) + ' Zeilen)');
}

// Slices that processTelemetry / onGpsUpdate / lap-sector-race
// detection mutate. Snapshot on enter, restore verbatim on exit.
// Per-Kart-Bucket-Felder: Snapshot/Restore iteriert den Bucket des AKTIVEN
// Karts (activeKart()), nicht state. Die vom Replay ebenfalls veraenderten
// GLOBALEN state-Felder (hz, sectors, drivers, races, activeRaceId,
// selectedRaceId, gateFlashUntil) werden darunter explizit behandelt.
const REPLAY_KART_KEYS = ['connection','telemetry','raw','display','gps','spdSrc',
  'batt','max','charts','imu','drift','driftSmooth','attitude','heatmap','sectorsLive','lapStart','currentLapMax',
  'currentLapTrace','bestLapTrace','bestLapMs','bestLapNum','liveDelta','autoLap'];

function snapshotReplayState() {
  const ak = activeKart();
  const s = {};
  for (const key of REPLAY_KART_KEYS) s[key] = ak[key];
  s.hz = state.hz;
  s.sectors = state.sectors;
  s.drivers = state.drivers;
  s.races = state.races;
  s.activeRaceId = state.activeRaceId;
  s.selectedRaceId = state.selectedRaceId;
  s.gateFlashUntil = state.gateFlashUntil;
  try { return structuredClone(s); } catch (e) { return JSON.parse(JSON.stringify(s)); }
}
function restoreReplayState(snap) {
  const ak = activeKart();
  for (const key of REPLAY_KART_KEYS) ak[key] = snap[key];
  state.hz = snap.hz;
  state.sectors = snap.sectors;
  state.drivers = snap.drivers;
  state.races = snap.races;
  state.activeRaceId = snap.activeRaceId;
  state.selectedRaceId = snap.selectedRaceId;
  state.gateFlashUntil = snap.gateFlashUntil;
}
// Fresh accumulators + a disposable running race/driver so detected
// laps/sectors stay isolated. track/startGate are intentionally kept.
function resetReplayDerived() {
  const k = activeKart();
  k.connection = { source: 'replay', packets: 0, lost: 0, rssi: null,
    bridgeMac: 'RE:PL:AY:00:00:01', kartMac: 'RE:PL:AY:00:00:02',
    lastPacketAt: null, seq: null, errors: 0 };
  state.hz = 0;
  k.telemetry = { speed: 0, rpm: 0, gx: 0, gy: 0, lat: 0, lon: 0 };
  k.raw = { speed: 0, rpm: 0, gx: 0, gy: 0, gz: 0, yaw: 0, lat: 0, lon: 0 };
  k.display = { speedLerp: 0, rpmLerp: 0, gxLerp: 0, gyLerp: 0 };
  k.gps = { fix: false, lastAt: null };
  k.spdSrc = 'gps';
  k.batt = { present: false, vbat: 0, soc: 0, warn: 0, cells: 3, _lastWarn: 0 };
  k.max = { speed: 0, rpm: 0, g: 0 };
  k.charts = { speed: [], rpm: [], gx: [], gy: [], gz: [], yaw: [], driftIndex: [] };
  k.imu = { yaw: 0, mtemp: null };
  k.drift = { status: 'n/a', index: null };
  k.driftSmooth = { idxEma: null, status: 'n/a', counterRun: 0 };
  k.attitude = { rollDeg: 0, over: false, overState: { active: false } };
  resetAttitudeClock();
  k.heatmap = { on: k.heatmap.on, lapMaxSpeed: 0 };
  // Sektor-Konfiguration (boundaries/manual) bleibt erhalten; Bests + Live-
  // Sektorzeiten (pro Kart) zuruecksetzen.
  state.sectors.best = [null, null, null];
  state.sectors.clickTarget = null;
  k.sectorsLive = { cur: 0, sectorStart: null, lapSectors: [null, null, null], lastLapSectors: null };
  k.lapStart = null;
  k.currentLapMax = { speed: 0, rpm: 0 };
  k.currentLapTrace = [];
  k.bestLapTrace = null;
  k.bestLapMs = null;
  k.bestLapNum = null;
  k.liveDelta = null;
  k.autoLap = { prevLat: null, prevLon: null, lastTriggerAt: 0 };
  state.gateFlashUntil = 0;
  const drv = { id: uid(), name: 'Replay', number: 'R', color: '#7aa2f7' };
  const race = { id: uid(), name: 'Replay', trackId: state.activeTrackId,
    lengthType: 'free', durationMs: 0, targetLaps: 0,
    startDriverId: drv.id, currentDriverId: drv.id,
    status: 'running', createdAt: Date.now(), startedAt: Date.now(),
    endedAt: null, totalPausedMs: 0, laps: [],
    stints: [{ driverId: drv.id, startAt: Date.now(), endAt: null, laps: [] }],
    speedTrace: [] };
  state.drivers = [drv];
  state.races = [race];
  state.activeRaceId = race.id;
  state.selectedRaceId = race.id;
}
function feedReplayPacket(p) {
  // Replay treibt immer den AKTIVEN Kart-Slot: processTelemetry routet nach
  // from_mac, also auf die aktive MAC umstempeln (sonst landet die Wiedergabe
  // im falschen/neuen Bucket).
  const mac = state.activeKartMac || KartRegistry.DEFAULT_MAC;
  const pkt = (p.from_mac === mac) ? p : Object.assign({}, p, { from_mac: mac });
  processTelemetry(pkt);
  if (p.lat && p.lon) onGpsUpdate(p.lat, p.lon);
}
function fastForwardTo(targetMs) {
  const k = activeKart();
  const pk = k.replay.packets;
  const end = RasiReplay.nextIndexFor(pk, targetMs, k.replay.idx);
  for (let i = k.replay.idx; i < end; i++) feedReplayPacket(pk[i]);
  k.replay.idx = end;
  k.replay.virtualMs = targetMs;
}
// Drift-Phasen als proportionale Marker über dem Replay-Seek (Phase 18).
function renderDriftStrip(spans, durationMs) {
  const strip = $('rpDriftStrip');
  if (!strip) return;
  strip.innerHTML = '';
  const dur = Number(durationMs) || 0;
  if (!dur || !spans || !spans.length) return;
  for (const s of spans) {
    const a = Math.max(0, Math.min(100, s.startMs / dur * 100));
    const b = Math.max(0, Math.min(100, s.endMs / dur * 100));
    const tick = document.createElement('i');
    tick.style.left = a + '%';
    tick.style.width = Math.max(0.3, b - a) + '%';
    strip.appendChild(tick);
  }
}
// Umkipp-Onset-Marker über dem Replay-Seek (Phase 19b). onsets = [ms, …].
function renderRollStrip(onsets, durationMs) {
  const strip = $('rpRollStrip');
  if (!strip) return;
  strip.innerHTML = '';
  const dur = Number(durationMs) || 0;
  if (!dur || !onsets || !onsets.length) return;
  for (const t of onsets) {
    const p = Math.max(0, Math.min(100, t / dur * 100));
    const tick = document.createElement('i');
    tick.style.left = p + '%';
    strip.appendChild(tick);
  }
}
// Umkipp-Onsets über eine Aufnahme: Roll fusionieren + rolloverStep, Onset-ms sammeln.
// Roll-Verlauf einer Aufnahme vorfusionieren -- identische Mathematik wie die
// Live-Fusion in processTelemetry (kalibrierte Quer-g via driftInputs als
// Gravitationsreferenz). Liefert den Null-bereinigten Rollwinkel je Paket;
// genutzt fuer Roll-Strip UND Drift-Hangkompensation (Phase 24).
function fusedRolls(packets, cal) {
  const rolls = [];
  let roll = 0, lastT = null;
  for (const p of (packets || [])) {
    const t = Number(p.t_rel) || 0;
    const dt = lastT == null ? 0.08 : Math.max(0, (t - lastT) / 1000);
    lastT = t;
    const inp = driftInputs(p, cal);
    roll = RasiAttitude.rollStep(roll, (Number(p.roll) || 0) * (cal.invertRollRate ? -1 : 1),
      inp.latAccel, Number(p.gz) || 0, dt, 0.98);
    rolls.push(roll - (cal.rollZero || 0));
  }
  return rolls;
}
function rolloverOnsets(packets, cal, thr) {
  const out = [];
  const rolls = fusedRolls(packets, cal);
  let st = { active: false };
  const pk = packets || [];
  for (let i = 0; i < pk.length; i++) {
    const r = RasiAttitude.rolloverStep(st, rolls[i], thr);
    if (r.onset) out.push(Number(pk[i].t_rel) || 0);
    st = r;
  }
  return out;
}
function loadRecordingFile(file) {
  const reader = new FileReader();
  reader.onload = () => {
    const parsed = RasiReplay.parseRecording(reader.result);
    if (!parsed.ok) { rcAlert('Keine gültige Aufnahme:\n' + parsed.error); return; }
    if (parsed.packets.length < 2) { rcAlert('Aufnahme zu kurz (keine abspielbaren Pakete).'); return; }
    if (parsed.skipped) rcToast(parsed.skipped + ' fehlerhafte Zeilen übersprungen', 3000);
    enterReplay(parsed);
  };
  reader.onerror = () => rcAlert('Datei konnte nicht gelesen werden.');
  reader.readAsText(file);
}
function enterReplay(parsed) {
  if (state.serial.connected) disconnectSerial();
  if (state.demo.running) stopDemo();
  const k = activeKart();
  k.recording.armed = false;                 // do not record the replay
  k.replay.snapshot = snapshotReplayState();
  resetReplayDerived();
  RasiKart3D.resetYaw();
  k.replay.active = true;
  k.replay.packets = parsed.packets;
  // Drift-Aggregat mit DERSELBEN Kalibrierung wie Live (driftInputs): Pakete
  // normalisieren, summarize/driftSpans erwarten die Keys yaw/gy/speed/t_rel.
  // Hangkompensation (Phase 24) wie live: sin(roll) aus der Quer-g ziehen,
  // Roll-Verlauf dafuer einmal vorfusionieren.
  const _rolls = fusedRolls(parsed.packets, k.calibration);
  const _calPk = parsed.packets.map((p, idx) => {
    const i = driftInputs(p, k.calibration);
    return { yaw: i.yawRate, gy: RasiDrift.tiltCompLatG(i.latAccel, _rolls[idx]),
             speed: i.speed, t_rel: p.t_rel };
  });
  const _ds = RasiDrift.summarize(_calPk, state.settings.drift);
  k.replay.driftSummary = _ds;
  setText('rpDrift', _ds.counted ? `${_ds.driftPct.toFixed(0)}% · max ${_ds.maxIndex.toFixed(1)}` : '–');
  renderDriftStrip(RasiDrift.driftSpans(_calPk, state.settings.drift), parsed.durationMs);
  renderRollStrip(rolloverOnsets(parsed.packets, k.calibration, state.settings.rollover), parsed.durationMs);
  k.replay.idx = 0;
  k.replay.virtualMs = 0;
  k.replay.durationMs = parsed.durationMs;
  k.replay.speed = 1;
  k.replay.playing = true;
  k.replay.lastWall = null;
  $('replayBar')?.classList.remove('hidden');
  $('connectBtn').textContent = 'Replay aktiv';
  $('connectBtn').className = 'btn blue w100';
  renderRaces();
  drawTrack();
  updateRecStatus();
  rcToast('Replay gestartet (' + parsed.packets.length + ' Pakete, '
    + fmtClock(parsed.durationMs) + ')', 3000);
  k.replay.raf = requestAnimationFrame(replayTick);
}
function replayTick() {
  const k = activeKart();
  if (!k.replay.active) return;
  const now = performance.now();
  if (k.replay.playing) {
    if (k.replay.lastWall != null) {
      const dt = (now - k.replay.lastWall) * k.replay.speed;
      let v = k.replay.virtualMs + dt;
      if (v >= k.replay.durationMs) { v = k.replay.durationMs; k.replay.playing = false; }
      const end = RasiReplay.nextIndexFor(k.replay.packets, v, k.replay.idx);
      for (let i = k.replay.idx; i < end; i++) feedReplayPacket(k.replay.packets[i]);
      k.replay.idx = end;
      k.replay.virtualMs = v;
    }
  }
  k.replay.lastWall = now;
  renderReplayBar();
  k.replay.raf = requestAnimationFrame(replayTick);
}
function replaySeek(ratio) {
  const k = activeKart();
  if (!k.replay.active) return;
  const target = RasiReplay.seekTargetMs(k.replay.durationMs, ratio);
  if (target < k.replay.virtualMs) {       // backward -> deterministic rebuild
    resetReplayDerived();
    k.replay.idx = 0;
    k.replay.virtualMs = 0;
    RasiKart3D.resetYaw();
  }
  fastForwardTo(target);
  k.replay.lastWall = null;
  renderRaces();
  drawTrack();
  renderReplayBar();
}
function setReplaySpeed(mult) {
  activeKart().replay.speed = Number(mult) || 1;
}
function toggleReplayPlay() {
  const k = activeKart();
  if (!k.replay.active) return;
  if (k.replay.virtualMs >= k.replay.durationMs && !k.replay.playing) {
    replaySeek(0);                              // restart from the beginning
  }
  k.replay.playing = !k.replay.playing;
  k.replay.lastWall = null;
  renderReplayBar();
}
function exitReplay() {
  const k = activeKart();
  if (!k.replay.active) return;
  if (k.replay.raf) cancelAnimationFrame(k.replay.raf);
  k.replay.raf = null;
  k.replay.active = false;
  if (k.replay.snapshot) restoreReplayState(k.replay.snapshot);
  k.replay.snapshot = null;
  RasiKart3D.resetYaw();
  k.replay.packets = [];
  $('replayBar')?.classList.add('hidden');
  $('connectBtn').textContent = 'USB verbinden';
  $('connectBtn').className = 'btn primary w100';
  renderRaces();
  drawTrack();
  updateRecStatus();
  rcToast('Replay beendet');
}
function renderReplayBar() {
  const k = activeKart();
  const playBtn = $('rpPlayBtn');
  if (playBtn) playBtn.classList.toggle('paused', !k.replay.playing);
  setText('rpElapsed', fmtClock(k.replay.virtualMs));
  setText('rpTotal', fmtClock(k.replay.durationMs));
  const sk = $('rpSeek');
  if (sk && document.activeElement !== sk) {
    const r = k.replay.durationMs ? k.replay.virtualMs / k.replay.durationMs : 0;
    sk.value = String(Math.round(r * 1000));
  }
}

// ============================================================
// RENNEN-REPLAY: Replay direkt aus dem Sitzungs-Puffer
// ============================================================
// ── Persistente Rennen-Aufnahmen (IndexedDB, Phase 27) ──────
// IDs der Rennen, zu denen eine Aufnahme im RasiRecStore liegt; beim
// App-Start aus der DB geladen, haelt raceHasRecording synchron.
let _recStoreIds = new Set();
function initRecStore() {
  if (!RasiRecStore.available()) return;
  RasiRecStore.keys().then(ids => {
    const known = new Set(state.races.map(r => r.id));
    for (const id of ids) {
      if (known.has(String(id))) _recStoreIds.add(String(id));
      else RasiRecStore.remove(id).catch(() => {});   // Waise (Rennen geloescht)
    }
    if (_recStoreIds.size) renderRaces();
  }).catch(() => {});
}
// Beim Rennende den Sitzungs-Ausschnitt dauerhaft ablegen.
function persistRaceRecording(r) {
  if (!RasiRecStore.available()) return;
  const pk = raceRecordingSlice(r);
  if (!pk) return;
  RasiRecStore.put(r.id, pk, { name: r.name }).then(dropped => {
    _recStoreIds.add(r.id);
    for (const id of (dropped || [])) _recStoreIds.delete(id);
    renderRaces();
  }).catch(() => rcToast('⚠ Aufnahme konnte nicht dauerhaft gespeichert werden', 3500));
}
function discardRaceRecording(raceId) {
  _recStoreIds.delete(raceId);
  if (RasiRecStore.available()) {
    RasiRecStore.remove(raceId).catch(() => {});
  }
}

// Schneller Check fuer den Button-Zustand (laeuft bei jedem renderRaces):
// Store-Treffer oder Zeitfenster-Ueberlappung pruefen, NICHT den Puffer filtern.
function raceHasRecording(r) {
  if (!r || activeKart().replay.active) return false;
  if (_recStoreIds.has(r.id)) return true;
  if (!r.startedAt) return false;
  const buf = activeKart().recording.buf;
  if (buf.length < 2) return false;
  const end = r.endedAt || Date.now();
  return r.startedAt <= buf[buf.length - 1]._wall && end >= buf[0]._wall;
}
// Pakete eines Rennens per Wandzeit (_wall) ausschneiden; Status-/
// Steuerzeilen (type) raus, wie es parseRecording bei Dateien tut.
function raceRecordingSlice(r) {
  if (!r || !r.startedAt) return null;
  const end = r.endedAt || Date.now();
  const pk = activeKart().recording.buf.filter(p =>
    !p.type && p._wall >= r.startedAt && p._wall <= end);
  return pk.length >= 2 ? pk : null;
}
async function replayRace(raceId) {
  const r = state.races.find(x => x.id === raceId);
  if (!r) return;
  if (r.status === 'running' || r.status === 'paused') {
    rcToast('Rennen läuft noch — erst beenden', 3000);
    return;
  }
  let pk = raceRecordingSlice(r);
  if (!pk && _recStoreIds.has(raceId)) {
    const rec = await RasiRecStore.get(raceId).catch(() => null);
    if (rec && Array.isArray(rec.packets) && rec.packets.length >= 2) pk = rec.packets;
  }
  if (!pk) {
    rcToast('Keine Aufnahme zu diesem Rennen vorhanden', 3000);
    return;
  }
  // t_rel auf den Rennstart rebasen, damit Seek/Dauer bei 0 beginnen.
  // __t mitsetzen: nextIndexFor/fastForwardTo takten ueber __t (bei
  // Datei-Replays setzt parseRecording das Feld; hier muessen wir es tun).
  const t0 = Number(pk[0].t_rel) || 0;
  const packets = pk.map(p => {
    const t = (Number(p.t_rel) || 0) - t0;
    return Object.assign({}, p, { t_rel: t, __t: t });
  });
  enterReplay({ packets, durationMs: packets[packets.length - 1].t_rel });
}

// Interface-Marker: von rasicross.js (init-Bindings)/serial-demo.js
// genutzte Funktionen -- verhindert no-unused-vars, dokumentiert das API.
void [exportAll, importAll, resetAll, updateRecStatus, saveRecording,
      exportRecordingCsv, snapshotReplayState, restoreReplayState,
      resetReplayDerived, feedReplayPacket, fastForwardTo, renderDriftStrip,
      renderRollStrip, rolloverOnsets, loadRecordingFile, enterReplay,
      replayTick, replaySeek, setReplaySpeed, toggleReplayPlay, exitReplay,
      renderReplayBar, initRecStore, persistRaceRecording,
      discardRaceRecording, raceHasRecording, replayRace];

// ESM-Export (Phase 42): bisherige Interface-Globals von recording.js
export {
  exportAll, importAll, resetAll, updateRecStatus, saveRecording,
  exportRecordingCsv, snapshotReplayState, restoreReplayState,
  resetReplayDerived, feedReplayPacket, fastForwardTo, renderDriftStrip,
  renderRollStrip, rolloverOnsets, loadRecordingFile, enterReplay,
  replayTick, replaySeek, setReplaySpeed, toggleReplayPlay, exitReplay,
  renderReplayBar, initRecStore, persistRaceRecording,
  discardRaceRecording, raceHasRecording, replayRace,
};
