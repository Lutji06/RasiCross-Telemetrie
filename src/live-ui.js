// ============================================================
//  RasiCross -- live-ui.js  (Live-Charts + Live-Tab-UI + Loops, Phase 23)
//  ESM (Phase 42): explizite Imports statt gemeinsamem Global-Scope.
//  Die beiden UI-Loops startet init() in rasicross.js via initLiveUiLoops().
//  Nur Deklarationen auf Top-Level -- kein Code laeuft beim Laden.
// ============================================================
import { fmtClock, fmtMs, nearestTraceDelta } from './geo.js';
import { state, $, css, dpr, esc, setText, setTextShared, setHtmlShared, activeKart } from './rasicross.js';
import { activeRace, activePart, raceElapsedMs, endRace } from './races.js';
import { drawTrack, resizeCanvases } from './map-draw.js';
import { getTotalStats } from './laps-drivers.js';
import { renderDriftBadge, renderGauges, renderRollBar } from './gauges.js';
import { updatePitWall } from './pit-wall.js';
import ConnUi from './conn-ui.js';
import DomTargets from './dom-targets.js';
import RasiKartBar from './kart-bar.js';
import RasiKartOverview from './kart-overview.js';
import { renderKartsTab } from './karts-page.js';
import { refreshKartSettingsWindows } from './kart-settings-window.js';
import RasiKartRank from './kart-rank.js';
import RasiLapEngine from './lap-engine.js';
import RasiLiveView from './live-view.js';

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
    const k = activeKart();
    drawChart(_srCtx, _srCanvas,
      [
        { data: k.charts.speed, color: css('--pr'), label: 'Speed', fill: true },
        { data: k.charts.rpm.map(v => v / state.settings.maxRpm * state.settings.maxSpeed), raw: k.charts.rpm, color: css('--red'), label: 'RPM', dash: true }
      ],
      0, state.settings.maxSpeed,
      { unit: 'km/h', right: 'rpm', maxRight: state.settings.maxRpm }
    );
    drawChart(_gCtx, _gCanvas,
      [
        { data: k.charts.gx, color: css('--blue'),  label: 'Gx' },
        { data: k.charts.gy, color: css('--green'), label: 'Gy' },
        { data: k.charts.gz, color: '#e8a13a',      label: 'Gz' }
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
  const data = activeKart().charts.yaw || [];
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
  // Phase 40: Delta fuer ALLE Karts (per-Kart-OLED). Kernrechnung ist
  // nearestTraceDelta (geo.js, getestet); DOM-Banner speist weiterhin
  // nur der aktive Kart (activeKart().liveDelta).
  for (const mac of state.karts.macs()) {
    const kart = state.karts.get(mac);
    if (!kart) continue;
    if (!kart.lapStart || !kart.bestLapTrace || !kart.currentLapTrace.length) {
      kart.liveDelta = null;
      continue;
    }
    const cur = kart.currentLapTrace[kart.currentLapTrace.length - 1];
    const d = nearestTraceDelta(kart.bestLapTrace, cur);
    if (d != null) kart.liveDelta = d;
  }
  const banner = $('deltaBanner');
  const k = activeKart();
  if (k.liveDelta == null) {
    if (banner) banner.classList.add('hidden');
    return;
  }
  const delta = k.liveDelta;
  if (banner) banner.classList.remove('hidden');
  const tEl = $('deltaTime');
  if (tEl) {
    tEl.textContent = (delta >= 0 ? '+' : '') + (delta / 1000).toFixed(3) + 's';
    tEl.className = 'delta-time ' + (Math.abs(delta) < 50 ? 'same' : delta < 0 ? 'faster' : 'slower');
  }
  setText('deltaRef', `vs. Runde ${k.bestLapNum} (${fmtMs(k.bestLapMs)})`);
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
    const k = activeKart();
    const t = k.telemetry;
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
    const _srcLabel = _srcMap[k.spdSrc] || '—';
    if (_srcLabel !== _lastKpiText.spdSrc) {
      const _spdColor = k.spdSrc === 'wheel' ? '#e8a13a'
                      : (k.spdSrc === 'none' || !k.spdSrc) ? 'var(--mut)'
                      : '';
      const _spdIds = DomTargets.targetIdsFor('spdSrc');
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
    const _battStale = !k.connection.lastPacketAt
                    || (Date.now() - k.connection.lastPacketAt) > 5000;
    if (k.batt.present && !_battStale) {
      if (_bEl && _bEl.classList.contains('hidden')) _bEl.classList.remove('hidden');
      const _soc = Math.max(0, Math.min(100, k.batt.soc | 0));
      const _vb  = +k.batt.vbat.toFixed(2);
      // Klasse aus warn (Sender) plus SoC-Fallback (falls warn=0 aber SoC niedrig)
      let _cls = 'ok';
      if (k.batt.warn === 2 || _soc <= 15) _cls = 'crit';
      else if (k.batt.warn === 1 || _soc <= 30) _cls = 'warn';
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
    setTextShared('speedMax', k.max.speed.toFixed(0));
    setTextShared('rpmMax', String(Math.round(k.max.rpm / 50) * 50));
    setText('kGMax', k.max.g.toFixed(1));
    setText('kYaw', Math.round(k.imu.yaw));
    setText('kMtemp', k.imu.mtemp == null ? '--' : Math.round(k.imu.mtemp));
    renderDriftBadge();
    renderRollBar();
    // Rundenzeit: nur alle 100ms aktualisieren ist ok
    const lapText = k.lapStart ? fmtMs(Date.now() - k.lapStart) : '--:--.---';
    if (lapText !== _lastKpiText.lap) {
      setTextShared('lap', lapText);     // -> kLap, liveLapBig, detailHeroLapCurrent
      _lastKpiText.lap = lapText;
    }
    const lapBestText = k.bestLapMs ? fmtMs(k.bestLapMs) : '--:--.---';
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
  const k = activeKart();
  const t = k.telemetry || {};
  const b = k.batt || {};
  const imu = k.imu || {};
  const conn = k.connection || {};
  const gps = k.gps || {};

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
  setText('diagGlitch', (k.raw && k.raw.glitch != null) ? String(k.raw.glitch) : '--');

  setText('diagVbat',    (b.present && b.vbat != null) ? b.vbat.toFixed(2) : '--');
  setText('diagSoc',     (b.present && b.soc != null)  ? String(b.soc)     : '--');
  setText('diagBattWarn',b.warn != null ? String(b.warn) : '0');

  setText('diagSendMs',  '--');
  setText('diagSpdSrc',  k.spdSrc || '--');
  setText('diagImuCal',  '--');
}

function updateLiveUi() {
  try {
    const k = activeKart();
    const t = k.telemetry;
    setText('latText', t.lat ? t.lat.toFixed(6) : '--');
    setText('lonText', t.lon ? t.lon.toFixed(6) : '--');
    // Koordinaten-Badge auf der Scan-Karte (Strecke-Tab) — live statt Deko
    setText('scanCoordText', (t.lat && t.lon)
      ? `${Math.abs(t.lat).toFixed(4)}°${t.lat >= 0 ? 'N' : 'S'} · ${Math.abs(t.lon).toFixed(4)}°${t.lon >= 0 ? 'E' : 'W'}`
      : '--°N · --°E');
    setText('trackPoints', state.track.points.length);
    document.body.classList.toggle('rpm-warn', t.rpm >= state.settings.rpmWarning);
    const gpsAge = k.gps.lastAt ? Date.now() - k.gps.lastAt : null;
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
        // Phase 31: Rest-Runden des FUEHRENDEN (meiste gueltige Runden),
        // nicht die Summe aller Karts (raceValidLaps aggregiert seit Phase 30).
        const _leaderLaps = RasiLapEngine.participantsOf(r)
          .reduce((mx, p) => Math.max(mx, RasiLapEngine.partValidLaps(p).length), 0);
        const left = Math.max(0, r.targetLaps - _leaderLaps);
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
    const _heroPart = r ? activePart(r) : null;
    setText('detailHeroStintCount', _heroPart ? _heroPart.stints.length : 0);
    // Status badge
    setText('hzText', state.hz);
    setText('packetsText', k.connection.packets);
    setText('detailHeroPackets', k.connection.packets);
    // Live delta
    updateLiveDelta();
  } catch (e) { console.warn('updateLiveUi:', e); }
}
function renderStints(r) {
  // Phase 30: Stints des aktiven Karts (Teilnehmer-Slot).
  const _sp = r ? activePart(r) : null;
  const _stints = _sp ? _sp.stints : (r && r.stints) || [];
  const _laps = _sp ? _sp.laps : ((r && r.laps) || []);
  const list = $('stintsList');
  if (!list) return;
  if (!r || !_stints || !_stints.length) {
    list.innerHTML = '<div class="muted">Noch kein Stint.</div>';
    return;
  }
  list.innerHTML = _stints.map((st, i) => {
    const d = state.drivers.find(x => x.id === st.driverId);
    const dur = (st.endAt || Date.now()) - st.startAt;
    const stintLaps = _laps.filter(l => l.driverId === st.driverId &&
      (i === 0 || l.number > _stints.slice(0, i).reduce((sum, s) => sum + _laps.filter(ll => ll.driverId === s.driverId).length, 0))).length;
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
// ============================================================
// LIVE-VIEW-MODUS (Einzel-Kart vs. Übersicht aller Karts)
// ============================================================
// Schaltet den Live-Tab zwischen 'single' (aktiver Kart, klassische
// Ansicht) und 'overview' (Grid aller Karts) um. Bei <=1 Kart immer
// 'single' (Single-Kart-Regression). Steuert die Sichtbarkeit per
// body[data-live-view]; CSS blendet .pw-liverow/.pw-live-body bzw.
// #liveOverview entsprechend ein/aus.
function setLiveView(mode, manual) {
  if (mode === 'overview' && state.karts.macs().length <= 1) mode = 'single';
  // Phase 55: Hand-Wahl pausiert die Start-Automatik fuer die Sitzung.
  if (manual === true) _liveViewManual = true;
  state.liveView = mode;
  document.body.dataset.liveView = mode;
  RasiKartBar.render(state);
  if (mode === 'overview') {
    RasiKartOverview.render(state);
  } else {
    // Zurück zur Einzelansicht: Canvas-Größen neu messen (waren ggf. hidden).
    setTimeout(() => { try { resizeCanvases(); } catch (e) {} }, 50);
  }
}

// Phase 39: Leaderboard-Strip (Einzelansicht). Zeigt P1..Pn mit Interval zum
// Vordermann; Klick waehlt den Kart. Versteckt ohne laufendes Rennen/<2
// Teilnehmern oder in der Uebersicht. HTML-Diff vermeidet Rebuild-Flackern.
let _lastLeaderStripHtml = '';
function renderLeaderStrip() {
  try {
    const el = $('liveLeaderStrip');
    if (!el) return;
    const r = activeRace();
    const rr = (state.liveView !== 'overview')
      ? RasiKartRank.ranking(state, r) : null;
    if (!rr) {
      if (el.style.display !== 'none') { el.style.display = 'none'; _lastLeaderStripHtml = ''; }
      return;
    }
    const fl = RasiLapEngine.fastestLapHolder(r);
    const macs = state.karts.macs();
    const html = rr.ranked.map(e => {
      const idx = Math.max(0, macs.indexOf(e.mac));
      const m = RasiKartBar.metaFor(state, e.mac, idx);
      const gap = e.pos === 1 ? ''
        : (rr.hasTrack
            ? (e.intervalLapGap > 0 ? '+' + e.intervalLapGap + ' Rd.' : '+' + Math.round(e.distIntM) + ' m')
            : '--');
      const flMark = (fl && fl.mac === e.mac) ? ' ⚡' : '';
      const act = e.mac === state.activeKartMac ? ' active' : '';
      return '<button type="button" class="ls-item' + act + '" data-mac="' + e.mac + '">'
        + '<b>P' + e.pos + '</b>'
        + '<span class="ls-dot" style="background:' + m.color + '"></span>'
        + '<span class="ls-name" style="color:' + m.color + '">' + esc(m.name) + flMark + '</span>'
        + (gap ? '<span class="ls-gap">' + gap + '</span>' : '')
        + '</button>';
    }).join('');
    el.style.display = 'flex';
    if (html === _lastLeaderStripHtml) return;
    _lastLeaderStripHtml = html;
    el.innerHTML = html;
    el.querySelectorAll('.ls-item').forEach(b => {
      b.onclick = () => {
        const mac = b.getAttribute('data-mac');
        if (state.karts.setActive(mac)) {
          state.activeKartMac = mac;
          setLiveView('single', true);
        }
      };
    });
  } catch (e) { console.warn('renderLeaderStrip:', e); }
}

// Phase 55: Start-Automatik der Live-Ansicht. Session-Zustand: Hand-Wahl-Flag
// (Reset, sobald die Kartzahl unter 2 faellt) + letzte Kartzahl fuer die
// auto-Flanke. Entscheidung ist pur in live-view.js (unit-getestet).
let _liveViewManual = false;
let _prevKartCount = 0;
function autoLiveView() {
  const count = state.karts.macs().length;
  if (count < 2) _liveViewManual = false;
  const next = RasiLiveView.liveViewAutoReducer({
    view: state.liveView, prevCount: _prevKartCount, count,
    setting: state.settings.liveStartView, manual: _liveViewManual,
  });
  _prevKartCount = count;
  if (next && next !== state.liveView) setLiveView(next);
}

// Im 1-Hz-/200-ms-Loop aufgerufen: hält das Übersicht-Grid aktuell und
// erzwingt bei auf <=1 gesunkener Kartzahl die Einzelansicht.
function refreshOverview() {
  if (state.liveView !== 'overview') return;
  if (state.karts.macs().length <= 1) { setLiveView('single'); return; }
  RasiKartOverview.render(state);
}

// Beide UI-Loops (200ms-Backup-Tick + 1Hz-Loop) -- werden von init() in
// rasicross.js via initLiveUiLoops() gestartet (Phase 23, kein Top-Level-Code).
function initLiveUiLoops() {
// Backup tick (läuft auch wenn rAF im Hintergrund-Iframe pausiert)
setInterval(() => {
  try { renderGauges(); drawTrack(); drawLiveCharts(); updateLiveKPIs(); updatePitWall(); autoLiveView(); refreshOverview(); renderLeaderStrip(); } catch(e){}
}, 200);

// 1Hz UI loop
setInterval(() => {
  // Snapshot der Hz BEVOR wir resetten
  state._lastHz = state.hz;
  state.hz = 0;

  setText('sessionText', fmtClock(Date.now() - state.sessionStart));
  updateLiveUi();

  // Multi-Kart Chip-Leiste auffrischen (auch ohne bridge_status, damit
  // Stale-Markierung mit der Zeit greift).
  RasiKartBar.render(state);
  // Übersicht-Grid (falls aktiv) auffrischen; erzwingt single bei <=1 Kart.
  autoLiveView();
  refreshOverview();
  // Leaderboard-Strip (Einzelansicht) aktuell halten.
  renderLeaderStrip();

  // Status-Badge oben rechts
  if (activeKart().connection.source === 'serial' && state.serial.connected) {
    (()=>{const e=$('topConnPill');if(e){e.className='pill green'};const e2=$('sideConnCard');if(e2){e2.className='conn-card connected'}})();
    setText('topConnText', 'Verbunden'); setText('sideConnText', 'Verbunden');
  } else if (activeKart().connection.source === 'demo') {
    (()=>{const e=$('topConnPill');if(e){e.className='pill blue'};const e2=$('sideConnCard');if(e2){e2.className='conn-card demo'}})();
    setText('topConnText', 'Demo'); setText('sideConnText', 'Demo');
  } else {
    (()=>{const e=$('topConnPill');if(e){e.className='pill'};const e2=$('sideConnCard');if(e2){e2.className='conn-card'}})();
    setText('topConnText', 'Offline'); setText('sideConnText', 'Offline');
  }

  // Verbindungsseite (Phase 56): conn-ui.js ist der einzige Writer;
  // der Reconnect-Status steckt jetzt in der Portstatus-Zeile (heroStatus).
  ConnUi.render();

  // Footer-KM live aktualisieren
  try {
    const t = getTotalStats();
    setText('footerKm', t.distanceKm < 1
      ? (t.distanceKm * 1000).toFixed(0) + ' m'
      : t.distanceKm.toFixed(2) + ' km');
  } catch (e) {}

  // Karts-Tab: Live-Werte der Karten im 1-Hz-Takt (nur bei aktivem Tab).
  if (document.body.dataset.tab === 'karts') { try { renderKartsTab(); } catch (e) {} }
  // Phase 48: offene Kart-Einstellungs-Fenster tab-unabhaengig aktualisieren.
  try { refreshKartSettingsWindows(); } catch (e) {}
}, 1000);
}

// Interface-Marker: von rasicross.js/races.js/pit-wall.js/recording.js
// genutzte Funktionen -- verhindert no-unused-vars, dokumentiert das API.
void [initLiveCharts, resizeChartCanvas, drawChart, axisFmt, drawLiveCharts,
      drawYawSparkline, updateLiveDelta, updateLiveKPIs, updateDiagnostics,
      updateLiveUi, renderStints, animLoop, initLiveUiLoops,
      setLiveView, refreshOverview, renderLeaderStrip];

// ESM-Export (Phase 42): bisherige Interface-Globals von live-ui.js
export {
  initLiveCharts, resizeChartCanvas, drawChart, axisFmt, drawLiveCharts,
  drawYawSparkline, updateLiveDelta, updateLiveKPIs, updateDiagnostics,
  updateLiveUi, renderStints, animLoop, initLiveUiLoops,
  setLiveView, refreshOverview, renderLeaderStrip,
};
