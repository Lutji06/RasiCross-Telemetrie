// ============================================================
//  RasiCross — conn-ui.js  (Verbindungsseite: Hero + Kart-Grid, Phase 56)
//  EINZIGER Writer der Verbindungsseiten-IDs, laeuft im 1-Hz-Loop
//  (live-ui.js). Pure Ampel-/Aggregat-Logik liegt in conn-health.js.
//  Aufklapper-Zustaende sind Session-State (nie persistiert).
// ============================================================
import ConnHealth from './conn-health.js';
import KartRegistry from './kart-registry.js';
import RasiKartBar from './kart-bar.js';
import { state, $, css, esc, setText, logTime } from './rasicross.js';

// Diagnose-Aufklapper pro Kart + Hz-Fenster (Paketzaehler-Deltas, 1 s)
const _diagOpen = {};   // mac -> bool
const _hzWin = {};      // mac -> { packets, at, hz }

// Paket-Log (aus pit-wall.js umgezogen, Phase 56)
let _packetLog = [];
function pushPacketLog(line) {
  _packetLog.unshift({ t: logTime(), line: line });
  _packetLog = _packetLog.slice(0, 20);
}

// RSSI-Sparkline (aus pit-wall.js umgezogen): 1-Hz-Historie, max 3 min.
const RSSI_HIST_MAX = 180;
let _rssiHist = [];
function drawRssiSparkline() {
  const cv = $('rssiSpark');
  if (!cv) return;
  const ctx = cv.getContext('2d');
  if (!ctx) return;
  const w = cv.width, h = cv.height;
  ctx.clearRect(0, 0, w, h);
  if (_rssiHist.length < 2) return;
  const MIN = -100, MAX = -30;            // dBm-Skala
  const y = v => h - 2 - ((Math.max(MIN, Math.min(MAX, v)) - MIN) / (MAX - MIN)) * (h - 4);
  // Schwellen-Linie (-85 dBm = Schwach)
  ctx.strokeStyle = 'rgba(255,255,255,0.10)';
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(0, y(-85)); ctx.lineTo(w, y(-85)); ctx.stroke();
  const last = _rssiHist[_rssiHist.length - 1];
  const color = last > -70 ? (css('--green') || '#5ad17a')
              : last > -85 ? (css('--orange') || '#f0a050')
              : (css('--red') || '#e05555');
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  for (let i = 0; i < _rssiHist.length; i++) {
    const x = (i / (RSSI_HIST_MAX - 1)) * w;
    if (i === 0) ctx.moveTo(x, y(_rssiHist[i])); else ctx.lineTo(x, y(_rssiHist[i]));
  }
  ctx.stroke();
  const xe = ((_rssiHist.length - 1) / (RSSI_HIST_MAX - 1)) * w;
  ctx.fillStyle = color;
  ctx.beginPath(); ctx.arc(xe, y(last), 2.4, 0, Math.PI * 2); ctx.fill();
}

function _kartHz(mac, k, now) {
  const w = _hzWin[mac] || (_hzWin[mac] = { packets: k.connection.packets, at: now, hz: 0 });
  const dt = now - w.at;
  if (dt >= 1000) {
    w.hz = Math.max(0, Math.round((k.connection.packets - w.packets) / (dt / 1000)));
    w.packets = k.connection.packets;
    w.at = now;
  }
  return w.hz;
}

function _fmtAge(lastAt, now) {
  return lastAt ? ((now - lastAt) / 1000).toFixed(1) + ' s' : '--';
}

const _BADGE = { ok: '● online', warn: '● schwach', off: '● offline' };

function _kartCard(r, meta, now) {
  const c = r.k.connection;
  const open = !!_diagOpen[r.mac];
  const vals = '<div class="cc-vals">'
    + '<span><i>Signal</i><b>' + (c.rssi != null ? c.rssi + ' dBm' : '—') + '</b></span>'
    + '<span><i>Rate</i><b>' + r.hz + ' Hz</b></span>'
    + '<span><i>Verl.</i><b>' + c.lost + '</b></span>'
    + '<span><i>GPS</i><b>' + (r.k.gps.fix ? 'Fix' : 'kein Fix') + '</b></span>'
    + '<span><i>Alter</i><b>' + _fmtAge(c.lastPacketAt, now) + '</b></span>'
    + '</div>';
  const hints = r.res.hints.length
    ? '<div class="cc-hints">' + r.res.hints.map(h => '<div>' + esc(h) + '</div>').join('') + '</div>'
    : '';
  const diag = open
    ? '<div class="cc-diag mono-box">'
      + 'MAC: <b>' + esc(c.kartMac !== '--' ? c.kartMac : r.mac) + '</b><br>'
      + 'Seq: <b>' + (c.seq != null ? c.seq : '--') + '</b><br>'
      + 'RPM Pulse/s: <b>' + (r.k.raw.pulseHz != null ? r.k.raw.pulseHz.toFixed(1) : '--') + '</b><br>'
      + 'Pulse Count: <b>' + (r.k.raw.pulseCount || '--') + '</b><br>'
      + 'Raw-G: <b>' + r.k.raw.gx.toFixed(2) + ' / ' + r.k.raw.gy.toFixed(2) + '</b><br>'
      + 'Errors: <b>' + c.errors + '</b>'
      + '</div>'
    : '';
  return '<div class="cc-card ' + r.res.level + '" data-mac="' + r.mac + '">'
    + '<div class="cc-head">'
    +   '<span class="cc-dot" style="background:' + meta.color + '"></span>'
    +   '<span class="cc-name">' + esc(meta.name) + '</span>'
    +   '<span class="cc-badge ' + r.res.level + '">' + _BADGE[r.res.level] + '</span>'
    + '</div>'
    + vals + hints
    + '<button class="cc-diag-btn" data-mac="' + r.mac + '">Diagnose ' + (open ? '▾' : '▸') + '</button>'
    + diag
    + '</div>';
}

function render() {
  try {
    const now = Date.now();
    const macs = state.karts.macs();
    // Der lazy angelegte default-Bucket ist erst ein Kart, wenn er je ein
    // Paket empfangen hat -- sonst zeigte eine frische App eine Geisterkarte
    // statt nur des Platzhalters (Spec: leere Registry -> Karts 0/0).
    const shown = macs.filter(m => m !== KartRegistry.DEFAULT_MAC
      || (state.karts.get(m) && state.karts.get(m).connection.lastPacketAt != null));
    // 1) Ampel je Kart (pure Logik)
    const results = shown.map((mac) => {
      const k = state.karts.get(mac);
      const hz = _kartHz(mac, k, now);
      const res = ConnHealth.classifyKart({
        now: now, lastPacketAt: k.connection.lastPacketAt, rssi: k.connection.rssi,
        hz: hz, gpsFix: k.gps.fix, gpsLastAt: k.gps.lastAt,
      });
      return { mac: mac, k: k, hz: hz, res: res };
    });
    // 2) Hero: Aggregate + Portstatus-Zeile
    const agg = ConnHealth.aggregate(results.map(r => ({ level: r.res.level, hz: r.hz, gpsFix: r.k.gps.fix })));
    setText('heroKarts', agg.online + '/' + agg.total);
    setText('heroRate', agg.hzSum + ' Hz');
    setText('heroGps', agg.gpsFixCount + '× Fix');
    const hs = ConnHealth.heroStatus({
      connected: state.serial.connected,
      portName: state.serial.portName,
      baud: state.serial.baud,
      auto: state.serial.autoConnected,
      demoRunning: state.demo.running,
      reconnecting: !!state.serial.reconnectTimer,
      attempts: state.serial.reconnectAttempts,
      dropped: state.serial.dropped,
    });
    const pl = $('connPortLine');
    if (pl) { pl.textContent = hs.text; pl.className = 'conn-port-line ' + hs.level; }
    // 3) Aktions-Button (waehrend Demo inaktiv, Locked Decision Demo-Chip)
    const btn = $('connActionBtn');
    if (btn) {
      btn.disabled = state.demo.running;
      btn.title = state.demo.running ? 'Demo läuft' : '';
      btn.textContent = state.serial.connected ? 'Trennen' : 'Verbinden';
      btn.className = state.serial.connected ? 'btn danger' : 'btn primary';
    }
    // 4) Details-Werte (Struktur ist statisches Markup -- Selects bleiben stehen)
    const ak = state.karts.active();
    setText('connBridgeMac', (ak && ak.connection.bridgeMac) || '--');
    if (ak && ak.connection.rssi != null
        && (ak.connection.source === 'serial' || ak.connection.source === 'demo')) {
      _rssiHist.push(ak.connection.rssi);
      if (_rssiHist.length > RSSI_HIST_MAX) _rssiHist.shift();
    }
    drawRssiSparkline();
    const log = $('packetLog');
    if (log && _packetLog.length) {
      log.innerHTML = _packetLog.slice(0, 8).map(p =>
        '<div><b>' + p.t + '</b><span>' + esc(p.line.slice(0, 200)) + '</span></div>').join('');
    }
    // 5) Kart-Grid in Registry-Reihenfolge + gestrichelter Platzhalter.
    //    Ohne sichtbare Karts: Empty-State-Panel mit Demo-Einstieg (56b);
    //    #emptyDemoBtn ist per Delegation auf #connGrid verdrahtet (app-init).
    const grid = $('connGrid');
    if (grid) {
      if (results.length === 0) {
        grid.innerHTML = '<div class="conn-empty">'
          + '<div class="ce-icon">📡</div>'
          + '<div class="ce-title">Warte auf Karts…</div>'
          + '<div class="ce-sub">Bridge per USB anschließen und <b>Verbinden</b> drücken —<br>oder ohne Hardware ausprobieren:</div>'
          + '<button class="conn-chip" id="emptyDemoBtn">▶ Demo starten</button>'
          + '</div>';
        return;
      }
      const cards = results.map(r => _kartCard(r, RasiKartBar.metaFor(state, r.mac, macs.indexOf(r.mac)), now));
      if (macs.length < KartRegistry.MAX_KARTS) {
        cards.push('<div class="cc-card cc-wait">wartet auf weitere Karts…</div>');
      }
      grid.innerHTML = cards.join('');
      grid.querySelectorAll('.cc-diag-btn').forEach((b) => {
        b.onclick = () => {
          const m = b.getAttribute('data-mac');
          _diagOpen[m] = !_diagOpen[m];
          render();
        };
      });
    }
  } catch (e) { console.warn('conn-ui render:', e); }
}

function openDetails() {
  const d = $('connDetails');
  if (d) d.classList.remove('hidden');
}

export default { render, pushPacketLog, openDetails };
