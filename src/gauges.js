// ============================================================
//  RasiCross -- gauges.js  (Tacho/RPM/G-Meter, Phase 23)
//  ESM (Phase 42): explizite Imports. Der 3D-Tick-State bleibt in
//  rasicross.js (kart3dIsReady/kart3dTickDt-Accessoren, da ESM-Importe
//  nicht beschreibbar sind). Nur Deklarationen auf Top-Level.
// ============================================================
import { state, $, css, dpr, kart3dIsReady, kart3dTickDt } from './rasicross.js';
import RasiKart3D from './karts3d.js';

// ============================================================
// 8. TACHO / RPM / G-METER
// ============================================================
// Drift-Badge (Phase 18): Label + Indexwert + Farbe je Status.
const DRIFT_LABEL = { 'n/a': '–', grip: 'Grip', oversteer: 'Drift',
                      understeer: 'Schiebt', counter: 'Spin' };
const DRIFT_COLOR = { 'n/a': '', grip: 'var(--green,#5ad17a)',
                      oversteer: 'var(--warn,#e0a13a)',
                      understeer: 'var(--blue,#7aa2f7)',
                      counter: 'var(--danger,#e05a5a)' };
function renderDriftBadge() {
  const el = $('kDrift');
  if (!el) return;
  const st = (state.drift && state.drift.status) || 'n/a';
  const idx = state.drift && state.drift.index;
  const label = DRIFT_LABEL[st] || '–';
  // Richtungs-Glyph nur fuer Rotations-Status, aus dem Vorzeichen der (kalibrierten) Gierrate.
  const glyph = (st === 'oversteer' || st === 'counter')
    ? ((state.imu && state.imu.yaw < 0) ? ' ←' : ' →') : '';
  // Wert (geglaetteter Index) bei oversteer/understeer/counter; grip/n/a nur Label.
  const showVal = idx != null && (st === 'oversteer' || st === 'understeer' || st === 'counter');
  el.textContent = showVal ? `${label}${glyph} ${idx.toFixed(1)}` : label;
  el.style.color = DRIFT_COLOR[st] || '';
}
// Neigungs-Balken (Phase 19b): Marker-Position aus Rollwinkel (±90° -> 0..100%),
// Umkipp-Zustand faerbt Marker rot + zeigt "UMGEKIPPT".
function renderRollBar() {
  const v = $('rollVal');
  if (!v) return;
  const deg = Math.max(-90, Math.min(90, (state.attitude && state.attitude.rollDeg) || 0));
  v.textContent = Math.round(deg) + '°';
  const over = !!(state.attitude && state.attitude.over);
  const o = $('rollOver'); if (o) o.classList.toggle('hidden', !over);
}
const LERP = 0.18;
function lerp(a, b) { return a + (b - a) * LERP; }
function renderGauges() {
  const t = state.telemetry;
  state.display.gxLerp = lerp(state.display.gxLerp, t.gx);
  state.display.gyLerp = lerp(state.display.gyLerp, t.gy);
  // G-Meter
  if (state.settings.gView === '3d' && kart3dIsReady()) {
    const now = performance.now();
    const dtMs = kart3dTickDt(now);
    RasiKart3D.update({
      gx: state.display.gxLerp,
      gy: state.display.gyLerp,
      gz: state.telemetry.gz || 0,
      yaw: state.imu.yaw || 0,
      dtMs: dtMs,
      drift: state.drift,
      rollDeg: (state.attitude && state.attitude.rollDeg) || 0,
      over: !!(state.attitude && state.attitude.over)
    });
  } else {
    drawGMeter();
  }
}
function drawGMeter() {
  const c = $('gMeterCanvas');
  if (!c) return;
  if (c.width !== c.offsetWidth * dpr()) {
    c.width = c.offsetWidth * dpr();
    c.height = c.offsetHeight * dpr();
  }
  const ctx = c.getContext('2d');
  const w = c.width, h = c.height, cx = w/2, cy = h/2, r = w * 0.40, rr = w * 0.46;
  const gs = state.settings.gScale;
  const gx = state.display.gxLerp, gy = state.display.gyLerp;
  ctx.clearRect(0, 0, w, h);
  // Background circle
  ctx.fillStyle = css('--soft');
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
  // G-zones
  [[1,'rgba(32,192,64,.15)'],[2,'rgba(255,149,0,.15)'],[gs,'rgba(224,48,48,.18)']].forEach(([maxG, col]) => {
    const zr = Math.min(r, r * maxG / gs);
    ctx.fillStyle = col;
    ctx.beginPath(); ctx.arc(cx, cy, zr, 0, Math.PI * 2); ctx.fill();
  });
  // Gridlines
  ctx.strokeStyle = css('--div'); ctx.lineWidth = 0.8;
  for (let g = 1; g < gs; g++) {
    const gr = r * g / gs;
    ctx.beginPath(); ctx.arc(cx, cy, gr, 0, Math.PI * 2); ctx.stroke();
  }
  ctx.beginPath(); ctx.moveTo(cx, cy - r); ctx.lineTo(cx, cy + r);
  ctx.moveTo(cx - r, cy); ctx.lineTo(cx + r, cy); ctx.stroke();
  // Axis labels
  const lpad = 4 * dpr();
  ctx.fillStyle = css('--sub');
  ctx.font = `${Math.round(10 * dpr())}px sans-serif`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
  ctx.fillText('+Gx', cx, cy - rr - lpad);
  ctx.textBaseline = 'top';
  ctx.fillText('−Gx', cx, cy + rr + lpad);
  ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  ctx.fillText('+Gy', cx + rr + lpad, cy);
  ctx.textAlign = 'right';
  ctx.fillText('−Gy', cx - rr - lpad, cy);
  // Border
  ctx.strokeStyle = css('--bor'); ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
  // ── Künstlicher Horizont (Kippfunktion) ──────────────────────
  const rollDeg = Math.max(-90, Math.min(90, (state.attitude && state.attitude.rollDeg) || 0));
  const over = !!(state.attitude && state.attitude.over);
  const rollRad = rollDeg * Math.PI / 180;
  ctx.save();
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.clip();
  ctx.translate(cx, cy); ctx.rotate(-rollRad);
  ctx.fillStyle = over ? 'rgba(255,84,112,.13)' : 'rgba(90,184,255,.10)';
  ctx.fillRect(-r, 0, r * 2, r);
  ctx.strokeStyle = over ? css('--red') : 'rgba(90,184,255,.55)';
  ctx.lineWidth = 1.5 * dpr();
  ctx.beginPath(); ctx.moveTo(-r, 0); ctx.lineTo(r, 0); ctx.stroke();
  ctx.restore();
  // Trail (last positions tracked here)
  if (!drawGMeter._trail) drawGMeter._trail = [];
  drawGMeter._trail.push({ x: gy, y: gx });
  if (drawGMeter._trail.length > 50) drawGMeter._trail.shift();
  drawGMeter._trail.forEach((pt, i) => {
    const alpha = (i / drawGMeter._trail.length) * 0.4;
    const px = cx + (pt.x / gs) * r, py = cy - (pt.y / gs) * r;
    const g = Math.sqrt(pt.x*pt.x + pt.y*pt.y);
    const col = g < 1 ? `rgba(32,192,64,${alpha})` : g < 2 ? `rgba(255,149,0,${alpha})` : `rgba(224,48,48,${alpha})`;
    ctx.fillStyle = col;
    ctx.beginPath(); ctx.arc(px, py, 3 * dpr(), 0, Math.PI * 2); ctx.fill();
  });
  // Current dot
  const px = cx + (gy / gs) * r, py = cy - (gx / gs) * r;
  const curG = Math.sqrt(gx*gx + gy*gy);
  const dotCol = curG < 1 ? css('--green') : curG < 2 ? css('--orange') : css('--red');
  ctx.fillStyle = dotCol;
  ctx.shadowColor = dotCol; ctx.shadowBlur = 12 * dpr();
  ctx.beginPath(); ctx.arc(px, py, 7 * dpr(), 0, Math.PI * 2); ctx.fill();
  ctx.shadowBlur = 0;
  // ── Bank-Ring: Roll-Skala + Zeiger + Umkipp-Zonen ────────────
  const thr = (state.settings.rollover && state.settings.rollover.angleDeg) || 75;
  const a0 = -Math.PI / 2;                 // 0° Roll = oben (12 Uhr)
  const toA = d => a0 + d * Math.PI / 180; // Roll φ -> Canvas-Winkel
  ctx.strokeStyle = css('--bor'); ctx.lineWidth = 2 * dpr();
  ctx.beginPath(); ctx.arc(cx, cy, rr, 0, Math.PI * 2); ctx.stroke();
  // Umkipp-Zonen ±thr..±90°
  ctx.strokeStyle = over ? css('--red') : 'rgba(255,84,112,.5)';
  ctx.lineWidth = 4 * dpr();
  ctx.beginPath(); ctx.arc(cx, cy, rr, toA(thr), toA(90)); ctx.stroke();
  ctx.beginPath(); ctx.arc(cx, cy, rr, toA(-90), toA(-thr)); ctx.stroke();
  // Ticks 0/±30/±60
  ctx.strokeStyle = css('--sub'); ctx.lineWidth = 1.5 * dpr();
  [-60, -30, 0, 30, 60].forEach(d => {
    const a = toA(d), c1 = Math.cos(a), s1 = Math.sin(a);
    ctx.beginPath();
    ctx.moveTo(cx + c1 * (rr - 5 * dpr()), cy + s1 * (rr - 5 * dpr()));
    ctx.lineTo(cx + c1 * (rr + 4 * dpr()), cy + s1 * (rr + 4 * dpr()));
    ctx.stroke();
  });
  // Zeiger am aktuellen Rollwinkel
  const ap = toA(rollDeg);
  const cpx = cx + Math.cos(ap) * rr, cpy = cy + Math.sin(ap) * rr;
  ctx.fillStyle = over ? css('--red') : css('--green');
  ctx.shadowColor = ctx.fillStyle; ctx.shadowBlur = (over ? 10 : 5) * dpr();
  ctx.beginPath(); ctx.arc(cpx, cpy, 4 * dpr(), 0, Math.PI * 2); ctx.fill();
  ctx.shadowBlur = 0;
  // Umkipp-Glow am Hauptkreis
  if (over) {
    ctx.strokeStyle = css('--red');
    ctx.shadowColor = css('--red'); ctx.shadowBlur = 14 * dpr();
    ctx.lineWidth = 2.5 * dpr();
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
    ctx.shadowBlur = 0;
  }
}

// Interface-Marker: von rasicross.js/live-ui.js genutzte Funktionen --
// verhindert no-unused-vars, dokumentiert das API.
void [renderDriftBadge, renderRollBar, lerp, renderGauges, drawGMeter];

// ESM-Export (Phase 42): bisherige Interface-Globals von gauges.js
export { renderDriftBadge, renderRollBar, lerp, renderGauges, drawGMeter };
