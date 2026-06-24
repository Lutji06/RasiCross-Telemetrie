'use strict';
// ============================================================
//  RasiCross -- laps-drivers.js  (Rundenerkennung + Fahrer, Phase 23)
//  Klassisches Script im gemeinsamen Global-Scope: nutzt state/$/esc/uid,
//  Dialoge, geo-Helfer (fmtMs/segmentsCross/...), races.js (activeRace),
//  rcAudio. Nur Deklarationen auf Top-Level.
// ============================================================

// ============================================================
// 14. LAP DETECTION
// ============================================================
// Phase 30: pro Kart aufgerufen. Geometrie (startGate) ist geteilt; Lap-State
// (lapStart/autoLap) kommt vom uebergebenen Kart k, nicht von der Fassade.
function checkLapCrossing(k, mac, lat, lon) {
  try {
    if (!state.startGate.enabled) return;
    if (!k.autoLap.prevLat) return;
    const ep = lineEndpointsFromGate(state.startGate);
    if (!ep) return;
    const now = Date.now();
    // Cooldown: at least minLapSeconds (gegen k.lapStart dieses Karts)
    if (k.lapStart && (now - k.lapStart) < state.settings.minLapSeconds * 1000) return;
    const A = { lat: k.autoLap.prevLat, lon: k.autoLap.prevLon };
    const B = { lat, lon };
    if (segmentsCross(A, B, ep.p1, ep.p2) && crossingDirectionOk(A.lat, A.lon, lat, lon, state.startGate.heading)) {
      triggerLap(k, mac);
    }
  } catch (e) { console.warn('checkLapCrossing:', e); }
}
// Phase 30: pro Kart. Erste Durchfahrt (k.lapStart==null) armiert nur; weitere
// Durchfahrten committen eine Runde in den Teilnehmer-Slot dieses Karts.
function triggerLap(k, mac) {
  try {
    const r = activeRace();
    if (!r || r.status !== 'running') return;
    const now = Date.now();
    const isAct = (k === activeKart());
    if (k.lapStart) {
      const minMs = state.settings.minLapSeconds * 1000;
      if (now - k.lapStart < minMs) return;
      const part = RasiLapEngine.getOrCreatePart(r, mac, r.currentDriverId, now);
      const sl = k.sectorsLive;           // Live-Sektorzeiten (pro Kart)
      const s = state.sectors;            // Sektor-Konfiguration (global)
      // Letzten Sektor (S3) abschliessen + Per-Kart-Best (k.sectorsBest).
      if (s.boundaries[0] && s.boundaries[1] && sl.cur === 2 && sl.sectorStart) {
        const s3Ms = now - sl.sectorStart;
        sl.lapSectors[2] = s3Ms;
        if (RasiLapEngine.sectorBestUpdate(k.sectorsBest, 2, s3Ms)) {
          if (isAct) rcAudio.sectorBest();
          syncSectorBestToTrack();
        }
      }
      const res = RasiLapEngine.commitLap(part, {
        now, lapStart: k.lapStart, driverId: part.currentDriverId, kartMac: mac,
        maxSpeed: k.currentLapMax.speed, maxRpm: k.currentLapMax.rpm,
        distanceM: traceDistanceM(k.currentLapTrace),
        sectors: sl.lapSectors.slice(0, 3),
      });
      res.lap.id = uid();
      // Registry-Best (fuer Uebersicht-Grid) mit Teilnehmer-Best synchron halten.
      k.bestLapMs = part.bestLapMs;
      k.bestLapNum = part.bestLapNum;
      if (res.isBest) {
        k.bestLapTrace = [...k.currentLapTrace];
        if (isAct) rcAudio.lapBest();
      }
      // Sektorzeiten fuers Display merken (nur aktiver Kart treibt das Panel).
      if (sl.lapSectors.some(x => x)) {
        sl.lastLapSectors = [...sl.lapSectors];
        setTimeout(() => {
          if (k.sectorsLive.lastLapSectors && !k.sectorsLive.lapSectors.some(x => x)) {
            k.sectorsLive.lastLapSectors = null;
            if (k === activeKart()) updateSectorPanel();
          }
        }, 7000);
      }
      if (isAct) state.gateFlashUntil = now + 1500;
      // Phase 31: Auto-Ende, sobald EIN Kart targetLaps erreicht. Der erste Kart,
      // der das schafft, ist definitionsgemaess der Fuehrende (Leader-Auto-Ende).
      // Single-Kart-Rennen verhalten sich dabei exakt wie bisher.
      if (r.lengthType === 'laps'
          && RasiLapEngine.partValidLaps(part).length >= r.targetLaps) {
        endRace(true);
      }
      saveDataDebounced();
    }
    // Neue Runde dieses Karts starten.
    k.lapStart = now;
    k.currentLapMax = { speed: 0, rpm: 0 };
    k.currentLapTrace = [];
    k.heatmap.lapMaxSpeed = 0;
    k.sectorsLive.cur = 0;
    k.sectorsLive.sectorStart = now;
    k.sectorsLive.lapSectors = [null, null, null];
    if (isAct) { updateSectorPanel(); renderLapTable(); }
  } catch (e) { console.warn('triggerLap:', e); }
}
function renderLapTable() {
  renderLiveLapList();
  const r = activeRace();
  const tbody = $('lapTable');
  // Phase 30: Runden des aktiven Karts (Teilnehmer-Slot).
  const _p = r ? RasiLapEngine.getOrCreatePart(r, state.activeKartMac || KartRegistry.DEFAULT_MAC, r.startDriverId, r.startedAt || Date.now()) : null;
  if (!r || !_p || !_p.laps.length) {
    tbody.innerHTML = '<tr><td colspan="6" class="muted">Noch keine Runden — starte ein Rennen und fahre die erste Runde.</td></tr>';
    setText('lapCountText', '0 Runden');
    return;
  }
  const valid = _p.laps.filter(l => l.valid);
  const best = valid.length ? Math.min(...valid.map(l => l.timeMs)) : null;
  setText('lapCountText', `${valid.length} Runden`);
  tbody.innerHTML = [..._p.laps].reverse().map(l => {
    const idx = l.number - 1;
    const prev = idx > 0 ? _p.laps[idx - 1].timeMs : null;
    const delta = prev ? l.timeMs - prev : null;
    const d = state.drivers.find(x => x.id === l.driverId);
    return `<tr class="${!l.valid ? 'invalid' : (l.timeMs === best ? 'best' : '')}">
      <td>${l.number}</td>
      <td>${fmtMs(l.timeMs)}</td>
      <td style="color:${delta == null ? 'var(--mut)' : delta < 0 ? 'var(--green)' : 'var(--red)'}">${delta == null ? '--' : fmtDelta(delta)}</td>
      <td>${esc(d?.name || '--')}</td>
      <td>${l.maxSpeed.toFixed(1)}</td>
      <td>${Math.round(l.maxRpm)}</td>
    </tr>`;
  }).join('');
}
// Kompakte, scrollbare Rundentabelle im Live-Tab unter der Streckenkarte.
// Alle Pro-Runden-Infos: Zeit, Delta vs. Vorrunde, Sektoren S1-S3, Max km/h,
// Max RPM, Fahrer. Neueste zuerst, schnellste gueltige Runde hervorgehoben.
function renderLiveLapList() {
  const tbody = $('liveLapList');
  if (!tbody) return;
  const r = activeRace();
  const _p = r ? RasiLapEngine.getOrCreatePart(r, state.activeKartMac || KartRegistry.DEFAULT_MAC, r.startDriverId, r.startedAt || Date.now()) : null;
  if (!r || !_p || !_p.laps.length) {
    tbody.innerHTML = '<tr><td colspan="9" class="muted">Noch keine Runden.</td></tr>';
    setText('liveLapCount', '0 Runden');
    return;
  }
  const fmtS = ms => (ms == null ? '--' : (ms / 1000).toFixed(2));
  const valid = _p.laps.filter(l => l.valid);
  const best = valid.length ? Math.min(...valid.map(l => l.timeMs)) : null;
  setText('liveLapCount', `${valid.length} Runden`);
  tbody.innerHTML = [..._p.laps].reverse().map(l => {
    const idx = l.number - 1;
    const prev = idx > 0 ? _p.laps[idx - 1].timeMs : null;
    const delta = prev ? l.timeMs - prev : null;
    const sec = Array.isArray(l.sectors) ? l.sectors : [null, null, null];
    const d = state.drivers.find(x => x.id === l.driverId);
    const cls = !l.valid ? 'invalid' : (l.timeMs === best ? 'best' : '');
    const dColor = delta == null ? 'var(--mut)' : delta < 0 ? 'var(--green)' : 'var(--red)';
    return `<tr class="${cls}">
      <td>${l.number}</td>
      <td class="llt-time">${fmtMs(l.timeMs)}</td>
      <td style="color:${dColor}">${delta == null ? '--' : fmtDelta(delta)}</td>
      <td>${fmtS(sec[0])}</td>
      <td>${fmtS(sec[1])}</td>
      <td>${fmtS(sec[2])}</td>
      <td>${(l.maxSpeed || 0).toFixed(1)}</td>
      <td>${Math.round(l.maxRpm || 0)}</td>
      <td class="llt-drv">${esc(d?.name || '--')}</td>
    </tr>`;
  }).join('');
}

// ============================================================

// ============================================================
// DRIVER STATS
// ============================================================
function getDriverStats(driverId) {
  let totalDistanceM = 0;
  let totalTimeMs = 0;
  let maxSpeed = 0;
  let lapCount = 0;
  let bestLapMs = null;
  let raceCount = 0;
  let avgSpeedSum = 0;       // gewichteter Durchschnitt
  let avgSpeedDist = 0;      // Distanz fuer Gewichtung
  let totalRpmMax = 0;
  let firstSeenAt = null;
  let lastSeenAt = null;
  state.races.forEach(r => {
    let driverWasInRace = false;
    // Streckenlaenge bestimmen (Fallback fuer alte Runden ohne distanceM)
    const trk = r.trackId ? state.savedTracks.find(t => t.id === r.trackId) : null;
    const fallbackLapM = trk?.totalDistance || 0;
    // Laps pro Driver (Phase 30: ueber alle Teilnehmer-Karts)
    RasiLapEngine.flatLaps(r).forEach(l => {
      if (l.driverId !== driverId) return;
      if (!l.valid) return;
      driverWasInRace = true;
      lapCount++;
      totalTimeMs += l.timeMs;
      const lapM = (l.distanceM != null && l.distanceM > 0) ? l.distanceM : fallbackLapM;
      if (lapM > 0) {
        totalDistanceM += lapM;
        // Avg-Speed gewichtet nach Distanz
        const lapSpeed = lapM / (l.timeMs / 1000) * 3.6; // km/h
        avgSpeedSum += lapSpeed * lapM;
        avgSpeedDist += lapM;
      }
      if ((l.maxSpeed || 0) > maxSpeed) maxSpeed = l.maxSpeed;
      if ((l.maxRpm || 0) > totalRpmMax) totalRpmMax = l.maxRpm;
      if (bestLapMs == null || l.timeMs < bestLapMs) bestLapMs = l.timeMs;
    });
    // Stints des Fahrers (Phase 30: ueber alle Teilnehmer-Karts)
    RasiLapEngine.flatStints(r).forEach(st => {
      if (st.driverId === driverId) {
        const start = st.startAt;
        const end = st.endAt || Date.now();
        if (firstSeenAt == null || start < firstSeenAt) firstSeenAt = start;
        if (lastSeenAt == null || end > lastSeenAt) lastSeenAt = end;
      }
    });
    if (driverWasInRace) raceCount++;
  });
  const avgSpeed = avgSpeedDist > 0 ? avgSpeedSum / avgSpeedDist : 0;
  return {
    distanceM: totalDistanceM,
    distanceKm: totalDistanceM / 1000,
    timeMs: totalTimeMs,
    maxSpeed,
    avgSpeed,
    lapCount,
    bestLapMs,
    raceCount,
    totalRpmMax,
    firstSeenAt,
    lastSeenAt
  };
}

function getTotalStats() {
  // Gesamt-KM ueber alle Rennen aller Fahrer.
  // Pro Runde: bevorzugt die tatsaechlich gefahrene GPS-Distanz (lap.distanceM),
  // sonst Fallback auf die Streckenlaenge (rueckwaertskompatibel zu alten
  // gespeicherten Rennen, die noch kein distanceM-Feld kannten).
  let totalDistanceM = 0;
  let totalTimeMs = 0;
  let totalLaps = 0;
  let allTimeMaxSpeed = 0;
  let allTimeBestLap = null;
  state.races.forEach(r => {
    const trk = r.trackId ? state.savedTracks.find(t => t.id === r.trackId) : null;
    const fallbackLapM = trk?.totalDistance || 0;
    RasiLapEngine.flatLaps(r).forEach(l => {
      if (!l.valid) return;
      totalLaps++;
      totalTimeMs += l.timeMs;
      const lapM = (l.distanceM != null && l.distanceM > 0) ? l.distanceM : fallbackLapM;
      if (lapM > 0) totalDistanceM += lapM;
      if ((l.maxSpeed || 0) > allTimeMaxSpeed) allTimeMaxSpeed = l.maxSpeed;
      if (allTimeBestLap == null || l.timeMs < allTimeBestLap) allTimeBestLap = l.timeMs;
    });
  });
  return {
    distanceM: totalDistanceM,
    distanceKm: totalDistanceM / 1000,
    timeMs: totalTimeMs,
    lapCount: totalLaps,
    raceCount: state.races.length,
    driverCount: state.drivers.length,
    trackCount: state.savedTracks.length,
    allTimeMaxSpeed,
    allTimeBestLap
  };
}

function fmtKm(km) {
  if (km < 1) return (km * 1000).toFixed(0) + ' m';
  if (km < 100) return km.toFixed(2) + ' km';
  return km.toFixed(1) + ' km';
}


// 15. DRIVERS
// ============================================================
function addDriver() {
  const name = $('newDriverName').value.trim();
  const number = $('newDriverNumber').value.trim();
  const color = $('newDriverColor').value || '#e8ff00';
  if (!name) return rcAlert('Bitte Namen eingeben.');
  state.drivers.push({ id: uid(), name, number, color });
  $('newDriverName').value = '';
  $('newDriverNumber').value = '';
  renderDrivers();
  renderDriverOptions();
  saveData();
  $('newDriverModal').classList.remove('show');
  rcToast(`Fahrer "${name}" hinzugefügt`);
}
async function deleteDriver(id) {
  const d = state.drivers.find(x => x.id === id);
  if (!d) return;
  if (!await rcConfirm(`Fahrer "${d.name}" löschen?`, 'Löschen', 'Löschen', true)) return;
  state.drivers = state.drivers.filter(x => x.id !== id);
  renderDrivers();
  renderDriverOptions();
  saveData();
}

function renderTotalHero() {
  const t = getTotalStats();
  const km = t.distanceKm;
  const totalEl = $('totalDistance');
  if (totalEl) {
    totalEl.innerHTML = (km < 1 ? (km * 1000).toFixed(0) : km < 100 ? km.toFixed(2) : km.toFixed(1)) +
      `<small>${km < 1 ? 'm' : 'km'}</small>`;
  }
  setText('totalTime', t.timeMs > 0 ? fmtClock(t.timeMs) : '--:--');
  setText('totalLaps', t.lapCount);
  setText('totalRaces', t.raceCount);
  setText('totalMaxSpeed', t.allTimeMaxSpeed > 0 ? t.allTimeMaxSpeed.toFixed(1) + ' km/h' : '--');
  setText('totalBestLap', t.allTimeBestLap ? fmtMs(t.allTimeBestLap) : '--');
  setText('totalTracks', t.trackCount);
}

function renderDrivers() {
  renderTotalHero();
  const list = $('driverStatsList');
  setText('driverCount', state.drivers.length);
  if (!state.drivers.length) {
    list.innerHTML = '<div class="muted">Noch keine Fahrer.</div>';
    return;
  }
  list.innerHTML = state.drivers.map(d => {
    const s = getDriverStats(d.id);
    const hasData = s.lapCount > 0;
    return `
    <div class="driver-stat-card" style="--driver:${esc(d.color)}">
      <div class="driver-stat-head">
        <div class="driver-num" style="--driver:${esc(d.color)}">${esc(d.number || '?')}</div>
        <div class="driver-stat-info">
          <div class="driver-stat-name">${esc(d.name)}</div>
          <div class="driver-stat-sub">${d.number ? '#' + esc(d.number) : 'ohne Nummer'} · ${s.raceCount} Rennen · ${s.lapCount} Runden</div>
        </div>
        <button class="btn danger" data-action="deleteDriver" data-id="${d.id}" title="Fahrer löschen">✕</button>
      </div>
      ${hasData ? `
      <div class="driver-stat-grid">
        <div class="dstat highlight"><span>Distanz</span><b>${fmtKm(s.distanceKm)}</b></div>
        <div class="dstat"><span>Fahrzeit</span><b>${fmtClock(s.timeMs)}</b></div>
        <div class="dstat"><span>Max km/h</span><b>${s.maxSpeed.toFixed(1)}</b></div>
        <div class="dstat"><span>Ø km/h</span><b>${s.avgSpeed.toFixed(1)}</b></div>
        <div class="dstat"><span>Best Runde</span><b>${s.bestLapMs ? fmtMs(s.bestLapMs) : '--'}</b></div>
        <div class="dstat"><span>Max RPM</span><b>${Math.round(s.totalRpmMax).toLocaleString('de-DE')}</b></div>
      </div>` : `
      <div class="driver-stat-empty">Noch keine Renndaten — fahre eine Runde mit ${esc(d.name)}!</div>
      `}
    </div>
  `;
  }).join('');
}
function renderDriverOptions() {
  const sel1 = $('newRaceDriver');
  const sel2 = $('driverModalSelect');
  if (!state.drivers.length) {
    if (sel1) sel1.innerHTML = '<option value="">Bitte zuerst Fahrer anlegen</option>';
    if (sel2) sel2.innerHTML = '<option value="">Keine Fahrer</option>';
    return;
  }
  const opts = state.drivers.map(d => `<option value="${d.id}">${esc(d.name)} ${d.number ? '#' + esc(d.number) : ''}</option>`).join('');
  if (sel1) sel1.innerHTML = opts;
  if (sel2) sel2.innerHTML = opts;
}

// Theoretische Bestrunde (Phase 24): Summe der besten Sektorzeiten der
// Session -- null solange nicht alle drei Sektor-Bests existieren.
function theoreticalBestMs() {
  // Phase 30: Sektor-Bests sind pro Kart -> aktiver Kart (Fassade state.sectorsBest).
  const b = state.sectorsBest || [];
  return (b[0] && b[1] && b[2]) ? b[0] + b[1] + b[2] : null;
}

// Interface-Marker: von rasicross.js/races.js/serial-demo.js/recording.js
// genutzte Funktionen -- verhindert no-unused-vars, dokumentiert das API.
void [checkLapCrossing, triggerLap, renderLapTable, renderLiveLapList,
      getDriverStats, getTotalStats, fmtKm, addDriver, deleteDriver,
      renderTotalHero, renderDrivers, renderDriverOptions, theoreticalBestMs];
