'use strict';
// ============================================================
//  RasiCross -- races.js  (Rennen-Verwaltung, Phase 22)
//  Klassisches Script im gemeinsamen Global-Scope: nutzt state/$/uid/
//  esc/setText/css, Dialoge (rcAlert/rcConfirm/rcToast), geo-Formatter
//  (fmtMs/fmtClock), saveData(Debounced) sowie loadSavedTrack/
//  updateSectorPanel/drawChart/renderDriverOptions aus rasicross.js.
//  Nur Deklarationen auf Top-Level -- kein Code laeuft beim Laden.
// ============================================================

// ============================================================
// 16. RACES
// ============================================================
function activeRace() { return state.races.find(r => r.id === state.activeRaceId); }
function currentStint(r) { return r && r.stints && r.stints.length ? r.stints[r.stints.length - 1] : null; }
function raceValidLaps(r) { return r ? r.laps.filter(l => l.valid) : []; }
function raceElapsedMs(r) {
  if (!r || !r.startedAt) return 0;
  const end = r.endedAt || (r.status === 'paused' ? r.pausedAt : Date.now());
  return Math.max(0, (end - r.startedAt) - (r.totalPausedMs || 0));
}

function createRace() {
  const name = $('newRaceName').value.trim() || 'Rennen ' + (state.races.length + 1);
  const trackId = $('newRaceTrack').value;
  const driverId = $('newRaceDriver').value;
  const lengthType = $('newRaceLengthType').value;
  const duration = Math.max(1, Number($('newRaceDuration').value) || 30);
  const targetLaps = Math.max(1, Number($('newRaceLaps').value) || 20);
  if (!driverId) return rcAlert('Bitte einen Fahrer wählen.');
  const race = {
    id: uid(), name, trackId, lengthType,
    durationMs: duration * 60000,
    targetLaps,
    startDriverId: driverId, currentDriverId: driverId,
    // Multi-Kart: Rennen gehoert dem aktuell ausgewaehlten Kart.
    kartMac: state.activeKartMac || KartRegistry.DEFAULT_MAC,
    status: 'created', createdAt: Date.now(),
    startedAt: null, endedAt: null, pausedAt: null, totalPausedMs: 0,
    laps: [], stints: [], speedTrace: []
  };
  state.races.unshift(race);
  // Nicht mehr automatisch aktivieren — User muss explizit "Aktivieren" klicken
  state.selectedRaceId = race.id;
  $('newRaceName').value = '';
  renderRaces();
  updateRaceControls();
  saveData();
  $('newRaceModal').classList.remove('show');
  rcToast(`Rennen "${name}" erstellt — jetzt aktivieren um zu starten`);
}
function startRace() {
  try {
    const r = activeRace();
    if (!r) return rcAlert('Bitte ein Rennen aktivieren.');
    if (r.status === 'running') return;
    if (r.status === 'finished' || r.status === 'finished_auto') return rcAlert('Rennen ist beendet.');
    const now = Date.now();
    if (r.status === 'paused') {
      // Fortsetzen: Pausendauer ermitteln, Rennuhr korrigieren.
      const pausedMs = now - (r.pausedAt || now);
      r.totalPausedMs = (r.totalPausedMs || 0) + pausedMs;
      r.pausedAt = null;
      r.status = 'running';
      if (typeof state.lapStart === 'number') {
        // Live-Renndaten noch im Speicher -> Lauf- und Sektor-Uhr um
        // die Pause vorruecken, damit die Zeit nahtlos weiterlaeuft.
        state.lapStart += pausedMs;
        if (typeof state.sectorsLive.sectorStart === 'number') {
          state.sectorsLive.sectorStart += pausedMs;
        }
      } else {
        // Nach App-Neustart sind die Live-Lap-Daten weg -> aktuelle
        // Runde frisch beginnen (gefahrene Runden bleiben erhalten).
        state.lapStart = now;
        state.currentLapMax = { speed: 0, rpm: 0 };
        state.currentLapTrace = [];
        state.heatmap.lapMaxSpeed = 0;
        state.sectorsLive.cur = 0;
        state.sectorsLive.sectorStart = now;
        state.sectorsLive.lapSectors = [null, null, null];
        state.sectorsLive.lastLapSectors = null;
      }
      // Stale GPS-Punkt verwerfen, sonst Geister-Durchfahrt moeglich.
      state.autoLap.prevLat = null;
      state.autoLap.prevLon = null;
    } else {
      // Frischer Start: kompletter Reset wie bisher.
      r.status = 'running';
      r.startedAt = now;
      r.endedAt = null;
      r.totalPausedMs = 0;
      r.stints = [{ id: uid(), driverId: r.currentDriverId, startAt: now, endAt: null }];
      r.laps = [];
      r.speedTrace = [];
      state.lapStart = now;
      state.currentLapMax = { speed: 0, rpm: 0 };
      state.currentLapTrace = [];
      state.bestLapMs = null;
      state.bestLapNum = null;
      state.bestLapTrace = null;
      state.heatmap.lapMaxSpeed = 0;
      state.sectorsLive.cur = 0;
      state.sectorsLive.sectorStart = now;
      state.sectorsLive.lapSectors = [null, null, null];
      state.sectorsLive.lastLapSectors = null;
      state.autoLap.prevLat = null;
      state.autoLap.prevLon = null;
    }
    renderRaces();
    updateRaceControls();
    updateSectorPanel();
    saveDataDebounced();
  } catch (e) { console.warn('startRace:', e); }
}
function endRace(auto = false) {
  try {
    const r = activeRace();
    if (!r) return;
    if (r.status !== 'running' && r.status !== 'paused') return;
    const now = Date.now();
    if (r.status === 'paused' && r.pausedAt) {
      r.totalPausedMs = (r.totalPausedMs || 0) + (now - r.pausedAt);
      r.pausedAt = null;
    }
    r.status = auto ? 'finished_auto' : 'finished';
    r.endedAt = now;
    const st = currentStint(r);
    if (st && !st.endAt) st.endAt = now;
    state.lapStart = null;
    state.currentLapMax = { speed: 0, rpm: 0 };
    state.sectorsLive.cur = 0;
    state.sectorsLive.sectorStart = null;
    state.sectorsLive.lapSectors = [null, null, null];
    document.body.classList.add('flash');
    setTimeout(() => document.body.classList.remove('flash'), 2000);
    renderRaces();
    updateRaceControls();
    updateSectorPanel();
    saveData();
    persistRaceRecording(r);   // Replay soll App-Neustarts ueberleben
    rcToast(auto ? 'Rennen automatisch beendet' : 'Rennen beendet');
  } catch (e) {
    console.warn('endRace:', e);
    rcAlert('Fehler beim Beenden:\n' + (e?.message || e));
  }
}
function pauseRace() {
  const r = activeRace();
  if (!r || r.status !== 'running') return;
  r.status = 'paused';
  r.pausedAt = Date.now();
  renderRaces();
  updateRaceControls();
  saveDataDebounced();
}
function toggleRaceRun() {
  // Start-Button-Toggle: laeuft -> pausieren, sonst -> starten/fortsetzen
  const r = activeRace();
  if (r && r.status === 'running') pauseRace();
  else startRace();
}
function openDriverChange() {
  const r = activeRace();
  if (!r || r.status !== 'running') return;
  renderDriverOptions();
  // Pre-select non-current driver if possible
  const sel = $('driverModalSelect');
  const others = state.drivers.filter(d => d.id !== r.currentDriverId);
  if (others.length && sel) sel.value = others[0].id;
  $('driverModal').classList.add('show');
}
function confirmDriverChange() {
  const r = activeRace();
  if (!r) return;
  const newId = $('driverModalSelect').value;
  if (!newId || newId === r.currentDriverId) {
    $('driverModal').classList.remove('show');
    return;
  }
  const now = Date.now();
  const old = currentStint(r);
  if (old && !old.endAt) old.endAt = now;
  r.currentDriverId = newId;
  r.stints.push({ id: uid(), driverId: newId, startAt: now, endAt: null });
  $('driverModal').classList.remove('show');
  renderRaces();
  saveDataDebounced();
  rcToast('Fahrer gewechselt');
}
function closeDriverModal() { $('driverModal').classList.remove('show'); }

function selectRace(id) {
  state.selectedRaceId = id;
  renderRaces();
}
async function setActiveRace(id) {
  // Blockieren wenn aktuell ein Rennen läuft oder pausiert ist
  const cur = activeRace();
  if (cur && (cur.status === 'running' || cur.status === 'paused')) {
    if (cur.id === id) return;   // schon aktiv, kein Wechsel
    await rcAlert(
      `Das aktuelle Rennen "${cur.name}" läuft noch (Status: ${cur.status === 'running' ? 'läuft' : 'pausiert'}).\n\nBeende es zuerst, bevor du ein anderes Rennen aktivierst.`,
      'Rennen läuft'
    );
    return;
  }
  state.activeRaceId = id;
  state.selectedRaceId = id;
  const r = activeRace();
  // Per-Kart-Zeiger: das aktive Rennen gehoert dem aktuell ausgewaehlten Kart.
  activeKart().activeRaceId = id;
  if (r && r.trackId) loadSavedTrack(r.trackId);
  renderRaces();
  updateRaceControls();
  saveDataDebounced();
}


function toggleRaceExpand(id) {
  if (!state.expandedRaceIds) state.expandedRaceIds = {};
  state.expandedRaceIds[id] = !state.expandedRaceIds[id];
  renderRaces();
  // Wenn jetzt expanded, Chart zeichnen
  if (state.expandedRaceIds[id]) {
    setTimeout(() => drawRaceHistoryChart(id), 50);
  }
}
async function deleteRace(id) {
  const r = state.races.find(x => x.id === id);
  if (!r) return;
  if (!await rcConfirm(`Rennen "${r.name}" wirklich löschen?`, 'Löschen', 'Löschen', true)) return;
  state.races = state.races.filter(x => x.id !== id);
  discardRaceRecording(id);
  if (state.activeRaceId === id) state.activeRaceId = null;
  if (state.selectedRaceId === id) state.selectedRaceId = state.races[0]?.id || null;
  if (state.expandedRaceIds) delete state.expandedRaceIds[id];
  renderRaces();
  updateRaceControls();
  saveData();
  rcToast('Rennen gelöscht');
}
function drawRaceHistoryChart(raceId) {
  const r = state.races.find(x => x.id === raceId);
  if (!r) return;
  const canvas = document.querySelector(`canvas[data-race-chart="${raceId}"]`);
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const speeds = (r.speedTrace || []).map(p => p.speed);
  const rpms = (r.speedTrace || []).map(p => p.rpm);
  const max = Math.max(state.settings.maxSpeed, ...speeds, 10);
  drawChart(ctx, canvas,
    [
      { data: speeds, color: css('--pr'), label: 'Speed', fill: true },
      { data: rpms.map(v => v / state.settings.maxRpm * max), raw: rpms, color: css('--red'), label: 'RPM', dash: true }
    ],
    0, max,
    { unit: 'km/h', right: 'rpm', maxRight: state.settings.maxRpm }
  );
}

// Kleiner Kart-Badge (Name/Farbe) fuer eine Rennzeile — nur wenn das Rennen
// einem benannten Kart zugeordnet ist (Multi-Kart). Default-Bucket = kein Badge.
function kartBadge(r) {
  const mac = r && r.kartMac;
  if (!mac || mac === (window.KartRegistry && KartRegistry.DEFAULT_MAC)) return '';
  const meta = state.kartMeta && state.kartMeta[mac];
  if (!meta) return '';
  const color = meta.color || '#3aa0e8';
  return ` <span class="kart-badge" style="border-color:${esc(color)};color:${esc(color)}">${esc(meta.name || 'Kart')}</span>`;
}

function renderRaces() {
  const list = $('raceList');
  setText('raceListCount', state.races.length);
  const _ar = activeRace();
  setText('raceHeroActive', _ar ? _ar.name : '--');
  setText('raceHeroStatus', _ar
    ? ({ created: 'Bereit', running: 'Läuft', paused: 'Pausiert', finished: 'Beendet', finished_auto: 'Auto-Ende' }[_ar.status] || _ar.status)
    : 'Bereit');
  if (!state.races.length) {
    list.innerHTML = '<div class="muted">Noch keine Rennen.</div>';
    return;
  }
  list.innerHTML = state.races.map(r => {
    const isActive = r.id === state.activeRaceId;
    const isSelected = r.id === state.selectedRaceId;
    const isExpanded = state.expandedRaceIds && state.expandedRaceIds[r.id];
    const cur = activeRace();
    const anotherRunning = cur && cur.id !== r.id && (cur.status === 'running' || cur.status === 'paused');
    const validLaps = raceValidLaps(r);
    const best = validLaps.length ? Math.min(...validLaps.map(l => l.timeMs)) : null;
    const avgLap = validLaps.length ? validLaps.reduce((s,l)=>s+l.timeMs,0)/validLaps.length : null;
    const totalSpeed = validLaps.length ? Math.max(...validLaps.map(l => l.maxSpeed||0)) : 0;
    const totalRpm = validLaps.length ? Math.max(...validLaps.map(l => l.maxRpm||0)) : 0;
    const elapsedMs = raceElapsedMs(r);
    const startDriver = state.drivers.find(d => d.id === r.startDriverId);
    return `
      <div class="race-card ${isSelected ? 'selected' : ''} ${isExpanded ? 'expanded' : ''}" data-action="selectRace" data-id="${r.id}">
        <div class="race-card-top">
          <h3>${esc(r.name)}${kartBadge(r)}</h3>
          <span class="race-status ${r.status}">${({ created: 'Erstellt', running: 'Läuft', paused: 'Pausiert', finished: 'Beendet', finished_auto: 'Auto-End' }[r.status] || r.status)}</span>
        </div>
        <div class="race-meta">
          <div>Format: <b>${r.lengthType === 'time' ? Math.round(r.durationMs/60000) + ' min' : r.lengthType === 'laps' ? r.targetLaps + ' Runden' : 'Frei'}</b></div>
          <div>Runden: <b>${validLaps.length}</b></div>
          <div>Beste: <b>${best ? fmtMs(best) : '--'}</b></div>
          <div>Erstellt: <b>${new Date(r.createdAt).toLocaleDateString('de-DE')}</b></div>
        </div>
        <div class="race-card-actions">
          ${!isActive ? `<button class="btn primary" data-action="setActiveRace" data-id="${r.id}" ${anotherRunning ? 'disabled title="Anderes Rennen läuft noch"' : ''}>Aktivieren</button>` : ''}
          ${(r.status === 'running' || r.status === 'paused') && isActive ? `<button class="btn danger" data-action="endRace">Beenden</button>` : ''}
          ${(r.status === 'finished' || r.status === 'finished_auto') ? `<button class="btn blue" data-action="replayRace" data-id="${r.id}" ${raceHasRecording(r) ? '' : 'disabled title="Keine Aufnahme zu diesem Rennen vorhanden"'}><svg viewBox="0 0 24 24"><path d="M6 4l14 8-14 8z" style="fill:currentColor"/></svg>Replay</button>` : ''}
          <button class="btn ghost expand-btn" data-action="toggleRaceExpand" data-id="${r.id}">
            ${isExpanded ? '▲ Weniger' : '▼ Details'}
          </button>
          <button class="btn ghost" data-action="deleteRace" data-id="${r.id}" title="Rennen löschen">✕</button>
        </div>
        ${isExpanded ? renderRaceDetails(r, validLaps, best, avgLap, totalSpeed, totalRpm, elapsedMs, startDriver) : ''}
      </div>
    `;
  }).join('');
}

function renderRaceDetails(r, validLaps, best, avgLap, maxSpeed, maxRpm, elapsedMs, startDriver) {
  const stintsHtml = (r.stints || []).map((st, i) => {
    const d = state.drivers.find(x => x.id === st.driverId);
    const dur = (st.endAt || Date.now()) - st.startAt;
    return `<div class="stint-row">
      <span class="stint-num">#${i+1}</span>
      <span class="stint-name">${esc(d?.name || '--')}</span>
      <span class="stint-dur">${fmtClock(dur)}</span>
    </div>`;
  }).join('');

  const lapsHtml = r.laps.length
    ? r.laps.map(l => {
        const d = state.drivers.find(x => x.id === l.driverId);
        const isBest = best && l.timeMs === best;
        return `<tr class="${!l.valid ? 'invalid' : (isBest ? 'best' : '')}">
          <td>${l.number}</td>
          <td>${fmtMs(l.timeMs)}</td>
          <td>${esc(d?.name || '--')}</td>
          <td>${(l.maxSpeed||0).toFixed(1)}</td>
          <td>${Math.round(l.maxRpm||0)}</td>
        </tr>`;
      }).join('')
    : '<tr><td colspan="5" class="muted">Keine Runden</td></tr>';

  return `<div class="race-details">
    <div class="race-detail-stats">
      <div class="stat"><div class="t">Dauer</div><div class="n">${fmtClock(elapsedMs)}</div></div>
      <div class="stat"><div class="t">Bestzeit</div><div class="n" style="color:var(--green)">${best ? fmtMs(best) : '--'}</div></div>
      <div class="stat"><div class="t">Durchschnitt</div><div class="n">${avgLap ? fmtMs(avgLap) : '--'}</div></div>
      <div class="stat"><div class="t">Max km/h</div><div class="n">${maxSpeed.toFixed(1)}</div></div>
      <div class="stat"><div class="t">Max RPM</div><div class="n">${Math.round(maxRpm).toLocaleString('de-DE')}</div></div>
      <div class="stat"><div class="t">Stints</div><div class="n">${(r.stints || []).length}</div></div>
    </div>
    ${stintsHtml ? `<div class="race-detail-section">
      <h4>Stints</h4>
      <div class="stints-list">${stintsHtml}</div>
    </div>` : ''}
    <div class="race-detail-section">
      <h4>Runden (${r.laps.length})</h4>
      <div class="tbl-wrap" style="max-height:240px">
        <table>
          <thead><tr><th>#</th><th>Zeit</th><th>Fahrer</th><th>Max km/h</th><th>Max RPM</th></tr></thead>
          <tbody>${lapsHtml}</tbody>
        </table>
      </div>
    </div>
    <div class="race-detail-section">
      <h4>Speed-Verlauf</h4>
      <div style="position:relative;aspect-ratio:3;background:var(--soft);border:1px solid var(--bor);border-radius:var(--radius-md)">
        <canvas data-race-chart="${r.id}" style="width:100%;height:100%;display:block"></canvas>
      </div>
    </div>
  </div>`;
}
function renderTrackOptions() {
  const sel = $('newRaceTrack');
  if (!sel) return;
  if (!state.savedTracks.length) {
    sel.innerHTML = '<option value="">Keine Strecken gespeichert</option>';
    return;
  }
  sel.innerHTML = '<option value="">Keine</option>' +
    state.savedTracks.map(t => `<option value="${t.id}">${esc(t.name)}</option>`).join('');
}

function updateRaceControls() {
  const r = activeRace();
  const running = r && r.status === 'running';
  const paused = r && r.status === 'paused';
  const startBtn = $('startRaceBtn');
  const changeBtn = $('changeDriverBtn');
  const endBtn = $('endRaceBtn');
  if (startBtn) {
    // Start-Button ist ein Toggle: Start -> Pause -> Fortsetzen
    if (running) {
      startBtn.disabled = false;
      startBtn.textContent = 'Pause';
    } else if (paused) {
      startBtn.disabled = false;
      startBtn.textContent = 'Fortsetzen';
    } else {
      startBtn.disabled = !(r && r.status === 'created');
      startBtn.textContent = 'Start';
    }
  }
  if (changeBtn) changeBtn.disabled = !running;
  if (endBtn) endBtn.disabled = !(running || paused);
}

// Interface-Marker: von rasicross.js/serial-demo.js genutzte Funktionen --
// verhindert no-unused-vars, dokumentiert das API.
void [activeRace, currentStint, raceValidLaps, raceElapsedMs, createRace,
      startRace, endRace, pauseRace, toggleRaceRun, openDriverChange,
      confirmDriverChange, closeDriverModal, selectRace, setActiveRace,
      toggleRaceExpand, deleteRace, drawRaceHistoryChart, renderRaces,
      renderRaceDetails, renderTrackOptions, updateRaceControls];
