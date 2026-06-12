'use strict';
// ============================================================
//  RasiCross -- live-ui.js  (Live-Charts + Live-Tab-UI + Loops, Phase 23)
//  Klassisches Script im gemeinsamen Global-Scope: nutzt state/$/css/dpr,
//  geo-Helfer, gauges.js/map-draw.js/races.js/laps-drivers.js sowie
//  RasiKart3D/RasiDrift/RasiAttitude/DomTargets. Die beiden UI-Loops
//  startet init() in rasicross.js via initLiveUiLoops().
//  Nur Deklarationen auf Top-Level -- kein Code laeuft beim Laden.
// ============================================================

// ============================================================
// LIVE CHARTS (Speed/RPM + G-Kraft)
// ============================================================
let _srCanvas, _srCtx, _gCanvas, _gCtx;
function initLiveCharts() {
  _srCanvas = $('srCanvas'); if (_srCanvas) _srCtx = _srCanvas.getContext('2d');
  _gCanvas = $('gCanvas'); if (_gCanvas) _gCtx = _gCanvas.getContext('2d');
}
function resizeChartCanvas(c) {
  if (!c) return;
  const w = c.offsetWidth, h = c.offsetHeight;
  if (w > 0 && h > 0) {
    const targetW = Math.floor(w * dpr()), targetH = Math.floor(h * dpr());
    if (c.width !== targetW || c.height !== targetH) { c.width = targetW; c.height = targetH; }
  }
}
function drawChart(ctx, c, series, min, max, opts = {}) {
  if (!ctx || !c) return;
  resizeChartCanvas(c);
  const w = c.width, h = c.height;
  if (!w || !h) return;
  const D = dpr();
  const pL = 50 * D, pR = (opts.right ? 50 : 16) * D, pT = 16 * D, pB = 28 * D;
  const iW = w - pL - pR, iH = h - pT - pB;
  const range = (max - min) || 1;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = css('--soft');
  ctx.fillRect(0, 0, w, h);
  // Grid lines
  ctx.font = `${10 * D}px ` + css('--mono');
  ctx.fillStyle = css('--mut');
  ctx.strokeStyle = css('--div');
  ctx.lineWidth = D;
  for (let i = 0; i <= 4; i++) {
    const y = pT + iH * i / 4;
    const val = max - range * i / 4;
    ctx.beginPath(); ctx.moveTo(pL, y); ctx.lineTo(w - pR, y); ctx.stroke();
    ctx.textAlign = 'right';
    ctx.fillText(axisFmt(val, opts.unit), pL - 8 * D, y + 4 * D);
    if (opts.right) {
      ctx.textAlign = 'left';
      ctx.fillText(axisFmt(val / max * (opts.maxRight || max), 'rpm'), w - pR + 8 * D, y + 4 * D);
    }
  }
  if (opts.zero) {
    const y = pT + iH - (0 - min) / range * iH;
    ctx.strokeStyle = css('--bor2');
    ctx.lineWidth = 1.5 * D;
    ctx.setLineDash([4 * D, 3 * D]);
    ctx.beginPath(); ctx.moveTo(pL, y); ctx.lineTo(w - pR, y); ctx.stroke();
    ctx.setLineDash([]);
  }
  // Empty state
  if (!series.some(s => (s.data || []).length > 1)) {
    ctx.textAlign = 'center';
    ctx.fillStyle = css('--dim');
    ctx.font = `800 ${12 * D}px ` + css('--mono');
    ctx.fillText('Warte auf Telemetrie-Daten…', w / 2, h / 2);
    return;
  }
  const X = (i, n) => pL + iW * i / Math.max(1, n - 1);
  const Y = v => Math.max(pT, Math.min(pT + iH, pT + iH - (v - min) / range * iH));
  // Draw each series
  series.forEach((s, si) => {
    const d = s.data || [];
    if (d.length < 2) return;
    ctx.save();
    if (s.fill) {
      ctx.beginPath();
      d.forEach((v, i) => i ? ctx.lineTo(X(i, d.length), Y(v)) : ctx.moveTo(X(i, d.length), Y(v)));
      ctx.lineTo(X(d.length - 1, d.length), pT + iH);
      ctx.lineTo(X(0, d.length), pT + iH);
      ctx.closePath();
      const g = ctx.createLinearGradient(0, pT, 0, pT + iH);
      g.addColorStop(0, 'rgba(220,255,0,.22)');
      g.addColorStop(1, 'rgba(220,255,0,0)');
      ctx.fillStyle = g;
      ctx.fill();
    }
    ctx.beginPath();
    d.forEach((v, i) => i ? ctx.lineTo(X(i, d.length), Y(v)) : ctx.moveTo(X(i, d.length), Y(v)));
    ctx.strokeStyle = s.color;
    ctx.lineWidth = (si ? 1.8 : 2.4) * D;
    if (s.dash) ctx.setLineDash([6 * D, 4 * D]);
    ctx.shadowColor = s.color;
    ctx.shadowBlur = si ? 3 * D : 8 * D;
    ctx.stroke();
    ctx.restore();
  });
}
function axisFmt(v, u) {
  if (u === 'rpm') return Math.round(v).toLocaleString('de-DE');
  if (u === 'G') return (Math.round(v * 10) / 10).toFixed(1);
  return Math.round(v).toString();
}
function drawLiveCharts() {
  try {
    if (!_srCtx || !_gCtx) return;
    drawChart(_srCtx, _srCanvas,
      [
        { data: state.charts.speed, color: css('--pr'), label: 'Speed', fill: true },
        { data: state.charts.rpm.map(v => v / state.settings.maxRpm * state.settings.maxSpeed), raw: state.charts.rpm, color: css('--red'), label: 'RPM', dash: true }
      ],
      0, state.settings.maxSpeed,
      { unit: 'km/h', right: 'rpm', maxRight: state.settings.maxRpm }
    );
    drawChart(_gCtx, _gCanvas,
      [
        { data: state.charts.gx, color: css('--blue'),  label: 'Gx' },
        { data: state.charts.gy, color: css('--green'), label: 'Gy' },
        { data: state.charts.gz, color: '#e8a13a',      label: 'Gz' }
      ],
      -state.settings.gScale, state.settings.gScale,
      { unit: 'G', zero: true }
    );
    drawYawSparkline();
  } catch (e) { console.warn('drawLiveCharts:', e); }
}

function drawYawSparkline() {
  const cv = $('yawSparkCanvas');
  if (!cv) return;
  const ctx = cv.getContext('2d');
  if (!ctx) return;
  const w = cv.width, h = cv.height;
  ctx.clearRect(0, 0, w, h);
  const data = state.charts.yaw || [];
  if (data.length < 2) return;
  const maxAbs = 250;  // gyro +-250 deg/s
  const midY = h / 2;
  ctx.strokeStyle = 'rgba(255,255,255,0.12)';
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(0, midY); ctx.lineTo(w, midY); ctx.stroke();
  ctx.strokeStyle = css('--mut') || '#888';
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  for (let i = 0; i < data.length; i++) {
    const x = (i / (data.length - 1)) * w;
    const v = Math.max(-maxAbs, Math.min(maxAbs, Number(data[i]) || 0));
    const y = midY - (v / maxAbs) * (midY - 1);
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.stroke();
}

// 17. LIVE UI
// ============================================================
let _lastDeltaUpdate = 0;
function updateLiveDelta() {
  if (Date.now() - _lastDeltaUpdate < 500) return;
  _lastDeltaUpdate = Date.now();
  const banner = $('deltaBanner');
  if (!state.lapStart || !state.bestLapTrace || state.bestLapTrace.length < 5 || !state.currentLapTrace.length) {
    state.liveDelta = null;
    if (banner) banner.classList.add('hidden');
    return;
  }
  // Find time on best lap at same GPS position
  const cur = state.currentLapTrace[state.currentLapTrace.length - 1];
  if (!cur || !cur.lat || !cur.lon) return;
  let bestT = null, minD = Infinity;
  for (const p of state.bestLapTrace) {
    const d = (p.lat - cur.lat) ** 2 + (p.lon - cur.lon) ** 2;
    if (d < minD) { minD = d; bestT = p.t; }
  }
  if (bestT == null) return;
  const delta = cur.t - bestT;
  state.liveDelta = delta;
  if (banner) banner.classList.remove('hidden');
  const tEl = $('deltaTime');
  if (tEl) {
    tEl.textContent = (delta >= 0 ? '+' : '') + (delta / 1000).toFixed(3) + 's';
    tEl.className = 'delta-time ' + (Math.abs(delta) < 50 ? 'same' : delta < 0 ? 'faster' : 'slower');
  }
  setText('deltaRef', `vs. Runde ${state.bestLapNum} (${fmtMs(state.bestLapMs)})`);
}
// KPI-Anzeige mit eigenem Smoothing (langsamer als Tacho-Animation).
// Throttle: aktualisiert nur alle 100ms (10 Hz), bleibt aber smooth genug.
const KPI_SMOOTH = 0.08;     // niedriger = traeger / besser lesbar
const KPI_UPDATE_MS = 100;   // 10 Updates pro Sekunde
const _kpiDisplay = { speed: 0, rpm: 0, gx: 0, gy: 0 };
let _lastKpiUpdate = 0;
let _lastKpiText = { speed: '', rpm: '', g: '', lap: '', count: '', spdSrc: '', batt: '' };
// 3D-Viewer-State (_kart3dReady/_kart3dLastTick/_attLastMs) ist in
// rasicross.js deklariert (G-View-Glue bleibt im Kern, Phase 23).

function updateLiveKPIs() {
  const now = Date.now();
  if (now - _lastKpiUpdate < KPI_UPDATE_MS) return;
  _lastKpiUpdate = now;
  try {
    const t = state.telemetry;
    // Eigenes, langsameres Smoothing für Anzeige-Werte
    _kpiDisplay.speed += (t.speed - _kpiDisplay.speed) * KPI_SMOOTH;
    _kpiDisplay.rpm   += (t.rpm   - _kpiDisplay.rpm)   * KPI_SMOOTH;
    _kpiDisplay.gx    += (t.gx    - _kpiDisplay.gx)    * KPI_SMOOTH;
    _kpiDisplay.gy    += (t.gy    - _kpiDisplay.gy)    * KPI_SMOOTH;
    const g = Math.sqrt(_kpiDisplay.gx * _kpiDisplay.gx + _kpiDisplay.gy * _kpiDisplay.gy);
    // Texte vorbereiten (gerundet) und nur setzen wenn sich was geaendert hat
    const speedText = _kpiDisplay.speed.toFixed(0);
    if (speedText !== _lastKpiText.speed) {
      setHtmlShared('speed', `${speedText}<small>km/h</small>`);
      _lastKpiText.speed = speedText;
    }
    // Geschwindigkeitsquelle-Indikator (GPS / WHL-Fallback / keine)
    const _srcMap = { gps: 'GPS', wheel: 'WHL', none: '—' };
    const _srcLabel = _srcMap[state.spdSrc] || '—';
    if (_srcLabel !== _lastKpiText.spdSrc) {
      const _spdColor = state.spdSrc === 'wheel' ? '#e8a13a'
                      : (state.spdSrc === 'none' || !state.spdSrc) ? 'var(--mut)'
                      : '';
      const _spdIds = (typeof DomTargets !== 'undefined' && DomTargets.targetIdsFor)
        ? DomTargets.targetIdsFor('spdSrc') : [];
      for (const _id of _spdIds) {
        const _e = $(_id);
        if (_e) { _e.textContent = _srcLabel; _e.style.color = _spdColor; }
      }
      _lastKpiText.spdSrc = _srcLabel;
    }
    // Batterie-Pill (iPhone-Style, Topbar oben rechts):
    // erst sichtbar sobald Daten kamen; Farbe nach warn + SoC;
    // verschwindet wieder wenn laenger als 5s kein Paket (stale).
    const _bEl = $('battPill');
    const _battStale = !state.connection.lastPacketAt
                    || (Date.now() - state.connection.lastPacketAt) > 5000;
    if (state.batt.present && !_battStale) {
      if (_bEl && _bEl.classList.contains('hidden')) _bEl.classList.remove('hidden');
      const _soc = Math.max(0, Math.min(100, state.batt.soc | 0));
      const _vb  = +state.batt.vbat.toFixed(2);
      // Klasse aus warn (Sender) plus SoC-Fallback (falls warn=0 aber SoC niedrig)
      let _cls = 'ok';
      if (state.batt.warn === 2 || _soc <= 15) _cls = 'crit';
      else if (state.batt.warn === 1 || _soc <= 30) _cls = 'warn';
      // vbat im Diff-Schluessel, damit der title-Tooltip mit aktualisiert wird,
      // auch wenn SoC/cls gleich bleiben.
      const _battText = `${_soc}|${_cls}|${_vb}`;
      if (_battText !== _lastKpiText.batt) {
        const _fill = $('battFill'), _pct = $('battPct');
        if (_fill) _fill.style.width = _soc + '%';
        if (_pct)  _pct.textContent = _soc + '%';
        if (_bEl) {
          _bEl.classList.remove('ok','warn','crit');
          _bEl.classList.add(_cls);
          _bEl.title = `Akku ${_soc}% · ${_vb.toFixed(2)} V`;
        }
        _lastKpiText.batt = _battText;
      }
    } else if (_bEl && !_bEl.classList.contains('hidden')) {
      // Stale oder Battery weg -> Pill wieder verstecken, Diff-Cache leeren
      _bEl.classList.add('hidden');
      _lastKpiText.batt = '';
    }
    // RPM in 50er-Schritten runden damit es nicht so wackelt
    const rpmRounded = Math.round(_kpiDisplay.rpm / 50) * 50;
    const rpmText = rpmRounded.toLocaleString('de-DE');
    if (rpmText !== _lastKpiText.rpm) {
      setTextShared('rpm', rpmText);
      _lastKpiText.rpm = rpmText;
    }
    // G-Kraft auf eine Nachkommastelle (statt zwei) — weniger flackern
    const gText = g.toFixed(1);
    if (gText !== _lastKpiText.g) {
      $('kG').innerHTML = `${gText}<small>G</small>`;
      _lastKpiText.g = gText;
    }
    // Max-Werte: aktualisieren sich seltener (bei jedem Update OK)
    setTextShared('speedMax', state.max.speed.toFixed(0));
    setTextShared('rpmMax', String(Math.round(state.max.rpm / 50) * 50));
    setText('kGMax', state.max.g.toFixed(1));
    setText('kYaw', Math.round(state.imu.yaw));
    setText('kMtemp', state.imu.mtemp == null ? '--' : Math.round(state.imu.mtemp));
    renderDriftBadge();
    renderRollBar();
    // Rundenzeit: nur alle 100ms aktualisieren ist ok
    const lapText = state.lapStart ? fmtMs(Date.now() - state.lapStart) : '--:--.---';
    if (lapText !== _lastKpiText.lap) {
      setTextShared('lap', lapText);     // -> kLap, liveLapBig, detailHeroLapCurrent
      _lastKpiText.lap = lapText;
    }
    const lapBestText = state.bestLapMs ? fmtMs(state.bestLapMs) : '--:--.---';
    setTextShared('lapBest', lapBestText); // -> kLapBest, liveLapBest, detailHeroLapBest
    setText('gxText', _kpiDisplay.gx.toFixed(1));
    setText('gyText', _kpiDisplay.gy.toFixed(1));
    // Race-Countdown
    const r = activeRace();
    if (r && (r.status === 'running' || r.status === 'paused')) {
      const elapsed = raceElapsedMs(r);
      if (r.lengthType === 'time') {
        const rem = Math.max(0, r.durationMs - elapsed);
        const cdText = fmtClock(rem);
        if (cdText !== _lastKpiText.count) {
          setText('countdown', cdText);
          _lastKpiText.count = cdText;
        }
      } else if (r.lengthType === 'free') {
        const cdText = fmtClock(elapsed);
        if (cdText !== _lastKpiText.count) {
          setText('countdown', cdText);
          _lastKpiText.count = cdText;
        }
      }
    }
    updateDiagnostics();
  } catch (e) { /* stumm — animLoop soll nie crashen */ }
}

// Diagnose-Block auf #tab-detail — pro Paket geschrieben, schluckt
// fehlende Felder still (frühe Pakete bevor erste GPS-/Batt-/RSSI-Daten da sind).
// Hinweis: gps_sat/gps_health/send_ms/imu_cal sind im rohen ESP-NOW-Paket
// vorhanden, werden aber bisher nicht in state gespiegelt -> zeigen '--'.
function updateDiagnostics() {
  const t = state.telemetry || {};
  const b = state.batt || {};
  const imu = state.imu || {};
  const conn = state.connection || {};
  const gps = state.gps || {};

  setText('diagGpsLat',    t.lat ? Number(t.lat).toFixed(6) : '--');
  setText('diagGpsLon',    t.lon ? Number(t.lon).toFixed(6) : '--');
  setText('diagGpsSat',    '--');
  setText('diagGpsHealth', gps.fix ? 'fix' : '--');

  setText('diagPackets', String(conn.packets || 0));
  setText('diagLost',    String(conn.lost || 0));
  setText('diagRate',    '--');
  setText('diagRssi',    conn.rssi != null ? String(conn.rssi) : '--');

  setText('diagGx',      t.gx != null ? Number(t.gx).toFixed(2) : '0.00');
  setText('diagGy',      t.gy != null ? Number(t.gy).toFixed(2) : '0.00');
  setText('diagAz',      t.gz != null ? Number(t.gz).toFixed(2) : '0.00');
  setText('diagYaw',     imu.yaw != null ? String(Math.round(imu.yaw)) : '0');
  setText('diagMpuTemp', imu.mtemp != null ? String(imu.mtemp) : '--');
  setText('diagGlitch', (state.raw && state.raw.glitch != null) ? String(state.raw.glitch) : '--');

  setText('diagVbat',    (b.present && b.vbat != null) ? b.vbat.toFixed(2) : '--');
  setText('diagSoc',     (b.present && b.soc != null)  ? String(b.soc)     : '--');
  setText('diagBattWarn',b.warn != null ? String(b.warn) : '0');

  setText('diagSendMs',  '--');
  setText('diagSpdSrc',  state.spdSrc || '--');
  setText('diagImuCal',  '--');
}

function updateLiveUi() {
  try {
    const t = state.telemetry;
    setText('latText', t.lat ? t.lat.toFixed(6) : '--');
    setText('lonText', t.lon ? t.lon.toFixed(6) : '--');
    // Koordinaten-Badge auf der Scan-Karte (Strecke-Tab) — live statt Deko
    setText('scanCoordText', (t.lat && t.lon)
      ? `${Math.abs(t.lat).toFixed(4)}°${t.lat >= 0 ? 'N' : 'S'} · ${Math.abs(t.lon).toFixed(4)}°${t.lon >= 0 ? 'E' : 'W'}`
      : '--°N · --°E');
    setText('trackPoints', state.track.points.length);
    document.body.classList.toggle('rpm-warn', t.rpm >= state.settings.rpmWarning);
    const gpsAge = state.gps.lastAt ? Date.now() - state.gps.lastAt : null;
    document.body.classList.toggle('gps-warn', !!(gpsAge && gpsAge > 3000));
    // Race-Status (Countdown läuft im 60fps-Loop, hier nur Meta)
    const r = activeRace();
    // Label ehrlich halten: nur Zeit-Rennen haben eine echte Restzeit;
    // freie Rennen zaehlen die Fahrzeit hoch, Runden-Rennen Rest-Runden.
    setText('countdownLabel', r
      ? (r.lengthType === 'time' ? 'Restzeit' : r.lengthType === 'laps' ? 'Verbleibend' : 'Fahrzeit')
      : 'Restzeit');
    if (r && (r.status === 'running' || r.status === 'paused')) {
      const elapsed = raceElapsedMs(r);
      if (r.lengthType === 'time') {
        const rem = Math.max(0, r.durationMs - elapsed);
        if (r.status === 'running' && rem <= 0) endRace(true);
      } else if (r.lengthType === 'laps') {
        const left = Math.max(0, r.targetLaps - raceValidLaps(r).length);
        setText('countdown', `${left} LAPS`);
      }
      const drv = state.drivers.find(d => d.id === r.currentDriverId);
      setText('currentDriverName', drv ? drv.name : '--');
    } else if (r) {
      setText('countdown', r.lengthType === 'time' ? fmtClock(r.durationMs) : r.lengthType === 'laps' ? `${r.targetLaps} LAPS` : '∞');
    } else {
      setText('countdown', '--:--');
      setText('currentDriverName', '--');
    }
    // Stints
    renderStints(r);
    setText('detailHeroStintCount', r && r.stints ? r.stints.length : 0);
    // Status badge
    setText('hzText', state.hz);
    setText('packetsText', state.connection.packets);
    setText('detailHeroPackets', state.connection.packets);
    // Live delta
    updateLiveDelta();
  } catch (e) { console.warn('updateLiveUi:', e); }
}
function renderStints(r) {
  const list = $('stintsList');
  if (!list) return;
  if (!r || !r.stints || !r.stints.length) {
    list.innerHTML = '<div class="muted">Noch kein Stint.</div>';
    return;
  }
  list.innerHTML = r.stints.map((st, i) => {
    const d = state.drivers.find(x => x.id === st.driverId);
    const dur = (st.endAt || Date.now()) - st.startAt;
    const stintLaps = r.laps.filter(l => l.driverId === st.driverId &&
      (i === 0 || l.number > r.stints.slice(0, i).reduce((sum, s) => sum + r.laps.filter(ll => ll.driverId === s.driverId).length, 0))).length;
    return `<div style="padding:10px;background:var(--soft);border-radius:10px;margin-bottom:6px">
      <div style="font-family:var(--mono);font-size:13px;color:var(--tx)">${esc(d?.name || '--')}</div>
      <div style="font-family:var(--mono);font-size:11px;color:var(--mut);margin-top:4px">
        Stint ${i+1} · ${fmtClock(dur)} · ${stintLaps} Runden ${st.endAt ? '' : '(läuft)'}
      </div>
    </div>`;
  }).join('');
}

// Animation loop
function animLoop() {
  renderGauges();
  drawTrack();
  drawLiveCharts();
  updateLiveKPIs();   // KPI-Karten jetzt im 60fps-Loop für flüssige Updates
  updatePitWall();    // Pit Wall ebenfalls 60fps (laufende Rundenzeit/Delta); no-op wenn zu
  requestAnimationFrame(animLoop);
}
// Beide UI-Loops (200ms-Backup-Tick + 1Hz-Loop) -- werden von init() in
// rasicross.js via initLiveUiLoops() gestartet (Phase 23, kein Top-Level-Code).
function initLiveUiLoops() {
// Backup tick (läuft auch wenn rAF im Hintergrund-Iframe pausiert)
setInterval(() => {
  try { renderGauges(); drawTrack(); drawLiveCharts(); updateLiveKPIs(); updatePitWall(); } catch(e){}
}, 200);

// 1Hz UI loop
setInterval(() => {
  // Snapshot der Hz BEVOR wir resetten
  state._lastHz = state.hz;
  state.hz = 0;

  setText('sessionText', fmtClock(Date.now() - state.sessionStart));
  updateLiveUi();

  // Status-Badge oben rechts
  if (state.connection.source === 'serial' && state.serial.connected) {
    (()=>{const e=$('topConnPill');if(e){e.className='pill green'};const e2=$('sideConnCard');if(e2){e2.className='conn-card connected'}})();
    setText('topConnText', 'Verbunden'); setText('sideConnText', 'Verbunden');
  } else if (state.connection.source === 'demo') {
    (()=>{const e=$('topConnPill');if(e){e.className='pill blue'};const e2=$('sideConnCard');if(e2){e2.className='conn-card demo'}})();
    setText('topConnText', 'Demo'); setText('sideConnText', 'Demo');
  } else {
    (()=>{const e=$('topConnPill');if(e){e.className='pill'};const e2=$('sideConnCard');if(e2){e2.className='conn-card'}})();
    setText('topConnText', 'Offline'); setText('sideConnText', 'Offline');
  }

  // Connection-Tab (das hat vorher gefehlt!)
  renderConnectionTab();

  // Reconnect-Status
  if (state.serial.reconnectTimer) {
    setText('reconnectStatus', `Reconnect-Versuch ${state.serial.reconnectAttempts}...`);
  } else {
    setText('reconnectStatus', state.serial.connected ? '--' : 'Inaktiv');
  }

  // Footer-KM live aktualisieren
  try {
    const t = getTotalStats();
    setText('footerKm', t.distanceKm < 1
      ? (t.distanceKm * 1000).toFixed(0) + ' m'
      : t.distanceKm.toFixed(2) + ' km');
  } catch (e) {}
}, 1000);
}

// Interface-Marker: von rasicross.js/races.js/pit-wall.js/recording.js
// genutzte Funktionen -- verhindert no-unused-vars, dokumentiert das API.
void [initLiveCharts, resizeChartCanvas, drawChart, axisFmt, drawLiveCharts,
      drawYawSparkline, updateLiveDelta, updateLiveKPIs, updateDiagnostics,
      updateLiveUi, renderStints, animLoop, initLiveUiLoops];
