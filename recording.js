'use strict';
// ============================================================
//  RasiCross -- recording.js  (Export/Import/Reset + Aufnahme/Replay,
//  Phase 23). Klassisches Script im gemeinsamen Global-Scope: nutzt
//  state/$/setText, Dialoge, RasiReplay/RasiDrift/RasiAttitude, geo-
//  Helfer sowie track.js/races.js/laps-drivers.js/live-ui.js-Funktionen.
//  Nur Deklarationen auf Top-Level -- kein Code laeuft beim Laden.
// ============================================================

// ============================================================
// EXPORT / IMPORT / RESET
// ============================================================
function exportAll() {
  const data = {
    version: '9.6', exportedAt: new Date().toISOString(),
    settings: state.settings, calibration: state.calibration,
    drivers: state.drivers, races: state.races,
    savedTracks: state.savedTracks,
    track: state.track, startGate: state.startGate,
    sectors: state.sectors
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
      if (d.settings) Object.assign(state.settings, d.settings);
      if (d.calibration) Object.assign(state.calibration, d.calibration);
      if (Array.isArray(d.drivers)) state.drivers = d.drivers;
      if (Array.isArray(d.races)) state.races = d.races;
      if (Array.isArray(d.savedTracks)) state.savedTracks = d.savedTracks;
      saveData();
      location.reload();
    } catch (e) { rcAlert('Import fehlgeschlagen:\n' + e.message); }
  };
  reader.readAsText(file);
}
async function resetAll() {
  if (!await rcConfirm('Alle Daten unwiderruflich löschen?', 'Zurücksetzen', 'Löschen', true)) return;
  localStorage.removeItem(SAVE_KEY);
  location.reload();
}

// ============================================================
// 19b. RECORDING SAVE / LOAD / REPLAY
// ============================================================
function updateRecStatus() {
  const el = $('recStatusText');
  if (!el) return;
  if (state.replay.active) { el.textContent = 'Replay aktiv'; return; }
  const n = state.recording.buf.length;
  el.textContent = state.recording.armed ? (n + ' Pakete aufgenommen') : 'Bereit';
}
function saveRecording() {
  // Replay aktiv -> die geladene Aufnahme speichern (z.B. nach Crash-Recovery),
  // sonst den Live-Mitschnitt.
  const buf = state.replay.active ? state.replay.packets : state.recording.buf;
  if (!buf.length) { rcToast('Keine Aufnahme vorhanden'); return; }
  const text = RasiReplay.serializeRecording(buf, { created: new Date().toISOString() });
  const blob = new Blob([text], { type: 'application/x-ndjson' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `rasicross_rec_${Date.now()}.ndjson`;
  a.click();
  URL.revokeObjectURL(url);
  rcToast('Aufnahme gespeichert (' + buf.length + ' Pakete)');
}
function exportRecordingCsv() {
  // Replay aktiv -> die geladene Aufnahme exportieren, sonst den Live-Mitschnitt.
  const buf = state.replay.active ? state.replay.packets : state.recording.buf;
  if (!buf.length) { rcToast('Keine Aufnahme vorhanden'); return; }
  const text = RasiReplay.recordingToCsv(buf);
  // UTF-8 BOM, damit Excel die Kodierung erkennt
  const blob = new Blob(['\uFEFF' + text], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `rasicross_rec_${Date.now()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  rcToast('CSV exportiert (' + (text.split('\r\n').length - 1) + ' Zeilen)');
}

// Slices that processTelemetry / onGpsUpdate / lap-sector-race
// detection mutate. Snapshot on enter, restore verbatim on exit.
const REPLAY_KEYS = ['connection','hz','telemetry','raw','display','gps','spdSrc',
  'batt','max','charts','imu','drift','driftSmooth','attitude','heatmap','sectors','lapStart','currentLapMax',
  'currentLapTrace','bestLapTrace','bestLapMs','bestLapNum','liveDelta','autoLap',
  'drivers','races','activeRaceId','selectedRaceId','gateFlashUntil'];

function snapshotReplayState() {
  const s = {};
  for (const k of REPLAY_KEYS) s[k] = state[k];
  try { return structuredClone(s); } catch (e) { return JSON.parse(JSON.stringify(s)); }
}
function restoreReplayState(snap) {
  for (const k of REPLAY_KEYS) state[k] = snap[k];
}
// Fresh accumulators + a disposable running race/driver so detected
// laps/sectors stay isolated. track/startGate are intentionally kept.
function resetReplayDerived() {
  state.connection = { source: 'replay', packets: 0, lost: 0, rssi: null,
    bridgeMac: 'RE:PL:AY:00:00:01', kartMac: 'RE:PL:AY:00:00:02',
    lastPacketAt: null, seq: null, errors: 0 };
  state.hz = 0;
  state.telemetry = { speed: 0, rpm: 0, gx: 0, gy: 0, lat: 0, lon: 0 };
  state.raw = { speed: 0, rpm: 0, gx: 0, gy: 0, gz: 0, yaw: 0, lat: 0, lon: 0 };
  state.display = { speedLerp: 0, rpmLerp: 0, gxLerp: 0, gyLerp: 0 };
  state.gps = { fix: false, lastAt: null };
  state.spdSrc = 'gps';
  state.batt = { present: false, vbat: 0, soc: 0, warn: 0, cells: 3, _lastWarn: 0 };
  state.max = { speed: 0, rpm: 0, g: 0 };
  state.charts = { speed: [], rpm: [], gx: [], gy: [], gz: [], yaw: [], driftIndex: [] };
  state.imu = { yaw: 0, mtemp: null };
  state.drift = { status: 'n/a', index: null };
  state.driftSmooth = { idxEma: null, status: 'n/a', counterRun: 0 };
  state.attitude = { rollDeg: 0, over: false, overState: { active: false } };
  _attLastMs = 0;
  state.heatmap = { on: state.heatmap.on, lapMaxSpeed: 0 };
  state.sectors = { boundaries: state.sectors.boundaries, cur: 0, sectorStart: null,
    lapSectors: [null, null, null], best: [null, null, null], lastLapSectors: null,
    manual: state.sectors.manual, clickTarget: null };
  state.lapStart = null;
  state.currentLapMax = { speed: 0, rpm: 0 };
  state.currentLapTrace = [];
  state.bestLapTrace = null;
  state.bestLapMs = null;
  state.bestLapNum = null;
  state.liveDelta = null;
  state.autoLap = { prevLat: null, prevLon: null, lastTriggerAt: 0 };
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
  processTelemetry(p);
  if (p.lat && p.lon) onGpsUpdate(p.lat, p.lon);
}
function fastForwardTo(targetMs) {
  const pk = state.replay.packets;
  const end = RasiReplay.nextIndexFor(pk, targetMs, state.replay.idx);
  for (let i = state.replay.idx; i < end; i++) feedReplayPacket(pk[i]);
  state.replay.idx = end;
  state.replay.virtualMs = targetMs;
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
  state.recording.armed = false;                 // do not record the replay
  state.replay.snapshot = snapshotReplayState();
  resetReplayDerived();
  if (window.RasiKart3D && window.RasiKart3D.resetYaw) window.RasiKart3D.resetYaw();
  state.replay.active = true;
  state.replay.packets = parsed.packets;
  // Drift-Aggregat mit DERSELBEN Kalibrierung wie Live (driftInputs): Pakete
  // normalisieren, summarize/driftSpans erwarten die Keys yaw/gy/speed/t_rel.
  // Hangkompensation (Phase 24) wie live: sin(roll) aus der Quer-g ziehen,
  // Roll-Verlauf dafuer einmal vorfusionieren.
  const _rolls = fusedRolls(parsed.packets, state.calibration);
  const _calPk = parsed.packets.map((p, idx) => {
    const i = driftInputs(p, state.calibration);
    return { yaw: i.yawRate, gy: RasiDrift.tiltCompLatG(i.latAccel, _rolls[idx]),
             speed: i.speed, t_rel: p.t_rel };
  });
  const _ds = RasiDrift.summarize(_calPk, state.settings.drift);
  state.replay.driftSummary = _ds;
  setText('rpDrift', _ds.counted ? `${_ds.driftPct.toFixed(0)}% · max ${_ds.maxIndex.toFixed(1)}` : '–');
  renderDriftStrip(RasiDrift.driftSpans(_calPk, state.settings.drift), parsed.durationMs);
  renderRollStrip(rolloverOnsets(parsed.packets, state.calibration, state.settings.rollover), parsed.durationMs);
  state.replay.idx = 0;
  state.replay.virtualMs = 0;
  state.replay.durationMs = parsed.durationMs;
  state.replay.speed = 1;
  state.replay.playing = true;
  state.replay.lastWall = null;
  $('replayBar')?.classList.remove('hidden');
  $('connectBtn').textContent = 'Replay aktiv';
  $('connectBtn').className = 'btn blue w100';
  renderRaces();
  drawTrack();
  updateRecStatus();
  rcToast('Replay gestartet (' + parsed.packets.length + ' Pakete, '
    + fmtClock(parsed.durationMs) + ')', 3000);
  state.replay.raf = requestAnimationFrame(replayTick);
}
function replayTick() {
  if (!state.replay.active) return;
  const now = performance.now();
  if (state.replay.playing) {
    if (state.replay.lastWall != null) {
      const dt = (now - state.replay.lastWall) * state.replay.speed;
      let v = state.replay.virtualMs + dt;
      if (v >= state.replay.durationMs) { v = state.replay.durationMs; state.replay.playing = false; }
      const end = RasiReplay.nextIndexFor(state.replay.packets, v, state.replay.idx);
      for (let i = state.replay.idx; i < end; i++) feedReplayPacket(state.replay.packets[i]);
      state.replay.idx = end;
      state.replay.virtualMs = v;
    }
  }
  state.replay.lastWall = now;
  renderReplayBar();
  state.replay.raf = requestAnimationFrame(replayTick);
}
function replaySeek(ratio) {
  if (!state.replay.active) return;
  const target = RasiReplay.seekTargetMs(state.replay.durationMs, ratio);
  if (target < state.replay.virtualMs) {       // backward -> deterministic rebuild
    resetReplayDerived();
    state.replay.idx = 0;
    state.replay.virtualMs = 0;
    if (window.RasiKart3D && window.RasiKart3D.resetYaw) window.RasiKart3D.resetYaw();
  }
  fastForwardTo(target);
  state.replay.lastWall = null;
  renderRaces();
  drawTrack();
  renderReplayBar();
}
function setReplaySpeed(mult) {
  state.replay.speed = Number(mult) || 1;
}
function toggleReplayPlay() {
  if (!state.replay.active) return;
  if (state.replay.virtualMs >= state.replay.durationMs && !state.replay.playing) {
    replaySeek(0);                              // restart from the beginning
  }
  state.replay.playing = !state.replay.playing;
  state.replay.lastWall = null;
  renderReplayBar();
}
function exitReplay() {
  if (!state.replay.active) return;
  if (state.replay.raf) cancelAnimationFrame(state.replay.raf);
  state.replay.raf = null;
  state.replay.active = false;
  if (state.replay.snapshot) restoreReplayState(state.replay.snapshot);
  state.replay.snapshot = null;
  if (window.RasiKart3D && window.RasiKart3D.resetYaw) window.RasiKart3D.resetYaw();
  state.replay.packets = [];
  $('replayBar')?.classList.add('hidden');
  $('connectBtn').textContent = 'USB verbinden';
  $('connectBtn').className = 'btn primary w100';
  renderRaces();
  drawTrack();
  updateRecStatus();
  rcToast('Replay beendet');
}
function renderReplayBar() {
  const playBtn = $('rpPlayBtn');
  if (playBtn) playBtn.classList.toggle('paused', !state.replay.playing);
  setText('rpElapsed', fmtClock(state.replay.virtualMs));
  setText('rpTotal', fmtClock(state.replay.durationMs));
  const sk = $('rpSeek');
  if (sk && document.activeElement !== sk) {
    const r = state.replay.durationMs ? state.replay.virtualMs / state.replay.durationMs : 0;
    sk.value = String(Math.round(r * 1000));
  }
}

// ============================================================
// RENNEN-REPLAY: Replay direkt aus dem Sitzungs-Puffer
// ============================================================
// Schneller Check fuer den Button-Zustand (laeuft bei jedem renderRaces):
// nur Zeitfenster-Ueberlappung pruefen, NICHT den Puffer filtern.
function raceHasRecording(r) {
  if (!r || !r.startedAt || state.replay.active) return false;
  const buf = state.recording.buf;
  if (buf.length < 2) return false;
  const end = r.endedAt || Date.now();
  return r.startedAt <= buf[buf.length - 1]._wall && end >= buf[0]._wall;
}
// Pakete eines Rennens per Wandzeit (_wall) ausschneiden; Status-/
// Steuerzeilen (type) raus, wie es parseRecording bei Dateien tut.
function raceRecordingSlice(r) {
  if (!r || !r.startedAt) return null;
  const end = r.endedAt || Date.now();
  const pk = state.recording.buf.filter(p =>
    !p.type && p._wall >= r.startedAt && p._wall <= end);
  return pk.length >= 2 ? pk : null;
}
function replayRace(raceId) {
  const r = state.races.find(x => x.id === raceId);
  if (!r) return;
  if (r.status === 'running' || r.status === 'paused') {
    rcToast('Rennen läuft noch — erst beenden', 3000);
    return;
  }
  const pk = raceRecordingSlice(r);
  if (!pk) {
    rcToast('Keine Aufnahme zu diesem Rennen in dieser Sitzung', 3000);
    return;
  }
  // t_rel auf den Rennstart rebasen, damit Seek/Dauer bei 0 beginnen.
  const t0 = Number(pk[0].t_rel) || 0;
  const packets = pk.map(p => Object.assign({}, p, { t_rel: (Number(p.t_rel) || 0) - t0 }));
  enterReplay({ packets, durationMs: packets[packets.length - 1].t_rel });
}

// Interface-Marker: von rasicross.js (init-Bindings)/serial-demo.js
// genutzte Funktionen -- verhindert no-unused-vars, dokumentiert das API.
void [exportAll, importAll, resetAll, updateRecStatus, saveRecording,
      exportRecordingCsv, snapshotReplayState, restoreReplayState,
      resetReplayDerived, feedReplayPacket, fastForwardTo, renderDriftStrip,
      renderRollStrip, rolloverOnsets, loadRecordingFile, enterReplay,
      replayTick, replaySeek, setReplaySpeed, toggleReplayPlay, exitReplay,
      renderReplayBar, raceHasRecording, replayRace];
