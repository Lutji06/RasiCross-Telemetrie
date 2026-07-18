// ============================================================
//  RasiCross -- serial-demo.js  (Serial-Verbindung + Demo, Phase 22)
//  ESM (Phase 42): explizite Imports; window.rasiSerial (Electron-
//  Preload) bzw. WebSerial bleiben Laufzeit-Bruecken.
//  Nur Deklarationen auf Top-Level -- kein Code laeuft beim Laden.
// ============================================================
import { gpsDist, headingFromPoints } from './geo.js';
import { state, $, uid, esc, setText, rcAlert, rcToast, saveDataDebounced,
         armRecording, kartFor, activeKart, processTelemetry } from './rasicross.js';
import { activeRace, endRace, raceValidLaps, renderRaces, startRace } from './races.js';
import { calcAutoSectors, onGpsUpdate, updateBounds, updateSectorPanel } from './track.js';
import { drawTrack } from './map-draw.js';
import { renderDrivers, renderDriverOptions } from './laps-drivers.js';
import ConnUi from './conn-ui.js';
import RasiKartBar from './kart-bar.js';

// 19. SERIAL / DEMO
// ============================================================
async function listSerialPorts() {
  const sel = $('serialPortSelect');
  if (!sel) return;
  sel.innerHTML = '<option value="">Suche…</option>';
  try {
    if (window.rasiSerial) {
      const ports = await window.rasiSerial.list();
      sel.innerHTML = ports.length
        ? ports.map(p => `<option value="${esc(p.path)}">${esc(p.path)} ${esc(p.friendlyName || p.manufacturer || '')}</option>`).join('')
        : '<option value="">Kein COM-Port gefunden</option>';
      // Volle Portbezeichnung als Tooltip (das Select schneidet lange Namen ab)
      const syncTitle = () => { sel.title = sel.selectedOptions[0]?.textContent || ''; };
      sel.onchange = syncTitle;
      syncTitle();
    } else if ('serial' in navigator) {
      sel.innerHTML = '<option value="webserial">Browser-Auswahl beim Verbinden</option>';
    } else {
      sel.innerHTML = '<option value="">Nicht unterstützt</option>';
    }
  } catch (e) { console.warn('listSerialPorts:', e); sel.innerHTML = '<option value="">Fehler</option>'; }
}
async function connectSerial(opts) {
  const _auto = !!(opts && opts.auto);
  if (activeKart().replay.active) { rcToast('Im Replay-Modus — zuerst Replay beenden'); return; }
  // Phase 56: Verbinden stoppt die Demo nie automatisch (Locked Decision) --
  // der Demo-Chip muss zuerst gestoppt werden.
  if (state.demo.running) { rcToast('Demo läuft — zuerst Demo stoppen'); return; }
  stopReconnect();
  state.serial.autoReconnect = state.settings.serialAutoConnect !== false;
  state.serial.baud = Number($('serialBaud').value) || 115200;
  try {
    if (window.rasiSerial) {
      let path = $('serialPortSelect').value;
      if (!path) { await listSerialPorts(); path = $('serialPortSelect').value; }
      if (!path) return rcAlert('Bitte COM-Port wählen.');
      await window.rasiSerial.open(path, state.serial.baud);
      window.rasiSerial.onLine(line => handleSerialLine(line));
      window.rasiSerial.onClose(() => onSerialClose());
      window.rasiSerial.onError?.(msg => onSerialError(msg));
      state.serial.connected = true;
      if (state.settings.recordAutoArm) armRecording();
      state.serial.portName = path;
      state.serial.lastPath = path;
      state.serial.dropped = false;
      state.serial.autoConnected = _auto;
      // Phase 56: letzten Port + Baud persistieren -> Auto-Connect beim Start
      state.settings.serialLastPath = path;
      state.settings.serialLastBaud = state.serial.baud;
      saveDataDebounced();
      // Nach await frisch aufloesen -- der aktive Kart kann waehrend des
      // Verbindungsaufbaus gewechselt worden sein (Fassaden-Semantik: Read-Zeit).
      activeKart().connection.source = 'serial';
      $('connectBtn').textContent = 'USB trennen';
      $('connectBtn').className = 'btn danger w100';
      $('serialConnectBtn').textContent = 'Trennen';
      // Request status (Bridge-Ebene, nicht kart-geroutet)
      setTimeout(() => { try { window.rasiSerial.writeLine(JSON.stringify({ type: 'request_status' })); } catch {} }, 800);
      // Ist-Config vom Kart anfragen -> config_ack fuellt das ESP-Formular
      // (an den ausgewaehlten Kart routen via target_mac)
      setTimeout(() => { try { window.rasiBridgeSend({ type: 'config_get' }); } catch {} }, 1600);
    } else if ('serial' in navigator) {
      const port = await navigator.serial.requestPort();
      await port.open({ baudRate: state.serial.baud });
      state.serial.port = port;
      state.serial.connected = true;
      state.serial.portName = 'WebSerial';
      state.serial.dropped = false;
      state.serial.autoConnected = false;   // WebSerial hat keinen persistierbaren Pfad
      activeKart().connection.source = 'serial';
      $('connectBtn').textContent = 'USB trennen';
      readWebSerial(port);
    } else {
      rcAlert('USB-Serial nur in Electron oder Chrome/Edge verfügbar.');
    }
  } catch (e) {
    activeKart().connection.errors++;
    state.serial.connected = false;
    if (_auto) {
      // Auto-Versuch scheitert leise -- der bestehende Backoff uebernimmt
      // (Spec Auto-Connect); kein rcAlert-Spam beim App-Start.
      state.serial.lastPath = state.serial.lastPath || state.settings.serialLastPath;
      scheduleReconnect();
    } else {
      rcAlert('Verbindung fehlgeschlagen:\n' + (e?.message || e), 'Fehler');
    }
  }
}
async function disconnectSerial() {
  stopReconnect();
  state.serial.autoReconnect = false;
  state.serial.dropped = false;         // manuell getrennt = gewollt, keine Stoerung
  state.serial.autoConnected = false;
  try {
    if (window.rasiSerial) await window.rasiSerial.close();
    if (state.serial.port) await state.serial.port.close();
  } catch {}
  state.serial.connected = false;
  state.serial.port = null;
  activeKart().connection.source = 'offline';
  $('connectBtn').textContent = 'USB verbinden';
  $('connectBtn').className = 'btn primary w100';
  $('serialConnectBtn').textContent = 'Verbinden';
}
function onSerialClose() {
  state.serial.connected = false;
  state.serial.dropped = true;          // Klartext-Stoerung in der Portstatus-Zeile
  activeKart().connection.source = 'offline';
  $('connectBtn').textContent = 'USB verbinden';
  $('connectBtn').className = 'btn primary w100';
  $('serialConnectBtn').textContent = 'Verbinden';
  if (state.serial.autoReconnect && state.serial.lastPath) scheduleReconnect();
}
function onSerialError(msg) {
  activeKart().connection.errors++;
  console.warn('Serial error:', msg);
}
async function readWebSerial(port) {
  const decoder = new TextDecoder();
  let buf = '';
  try {
    while (state.serial.connected && port.readable) {
      const reader = port.readable.getReader();
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          if (value) {
            buf += decoder.decode(value, { stream: true });
            const lines = buf.split(/\r?\n/);
            buf = lines.pop() || '';
            for (const line of lines) handleSerialLine(line);
          }
        }
      } finally { reader.releaseLock(); }
    }
  } catch (e) { console.warn('WebSerial read:', e); }
}
function handleSerialLine(line) {
  line = String(line || '').trim();
  if (!line || !line.startsWith('{')) return;
  try {
    const d = JSON.parse(line);
    ConnUi.pushPacketLog(line);
    processTelemetry(d);
    if (d.lat && d.lon) onGpsUpdate(d.lat, d.lon);
  } catch (e) { activeKart().connection.errors++; }
}
function scheduleReconnect() {
  if (state.serial.reconnectTimer) return;
  state.serial.reconnectAttempts++;
  if (state.serial.reconnectAttempts > 30) return;
  const delay = Math.min(15000, 1500 * Math.pow(1.4, Math.min(state.serial.reconnectAttempts, 8)));
  state.serial.reconnectTimer = setTimeout(async () => {
    state.serial.reconnectTimer = null;
    if (!state.serial.autoReconnect || state.serial.connected) return;
    try {
      if (window.rasiSerial && state.serial.lastPath) {
        await window.rasiSerial.open(state.serial.lastPath, state.serial.baud);
        window.rasiSerial.onLine(line => handleSerialLine(line));
        window.rasiSerial.onClose(() => onSerialClose());
        state.serial.connected = true;
        state.serial.portName = state.serial.lastPath;
        activeKart().connection.source = 'serial';
        state.serial.reconnectAttempts = 0;
        state.serial.dropped = false;
        state.serial.autoConnected = true;
        $('connectBtn').textContent = 'USB trennen';
        $('connectBtn').className = 'btn danger w100';
      }
    } catch (e) {
      if (state.serial.autoReconnect) scheduleReconnect();
    }
  }, delay);
}
function stopReconnect() {
  if (state.serial.reconnectTimer) { clearTimeout(state.serial.reconnectTimer); state.serial.reconnectTimer = null; }
  state.serial.reconnectAttempts = 0;
}

// Phase 56: Auto-Connect beim App-Start -- genau ein Versuch mit dem
// persistierten Port, nur wenn er in der aktuellen Portliste auftaucht
// (sonst: kein Versuch, kein Fehler-Spam). Fehlversuche laufen ueber den
// bestehenden scheduleReconnect()-Backoff. Aufrufer hat listSerialPorts()
// bereits ausgefuehrt (app-init.js).
async function autoConnect() {
  if (state.settings.serialAutoConnect === false) return;
  const path = state.settings.serialLastPath;
  if (!path || state.demo.running || state.serial.connected) return;
  if (!window.rasiSerial) return;   // WebSerial braucht eine User-Geste
  const sel = $('serialPortSelect');
  if (!sel || !Array.from(sel.options).some(o => o.value === path)) return;
  sel.value = path;
  const baudSel = $('serialBaud');
  if (baudSel) baudSel.value = String(state.settings.serialLastBaud || 115200);
  await connectSerial({ auto: true });
}

// Demo
// Phase 39: 3 simulierte Karts — unterschiedliche Pace (~2-3 % Spreizung)
// erzeugt Ueberholvorgaenge und plausible Gaps; Phasenversatz trennt sie
// auf der Strecke. RSSI/SoC je Kart verschieden fuer realistische Chips.
const DEMO_KART_DEFS = [
  { mac: 'DE:MO:RA:SI:00:01', name: 'Demo 1', color: '#3aa0e8', pace: 1.000, phase: 0.0, rssi: -52, soc0: 92 },
  { mac: 'DE:MO:RA:SI:00:02', name: 'Demo 2', color: '#e8a13a', pace: 0.985, phase: 1.6, rssi: -63, soc0: 74 },
  { mac: 'DE:MO:RA:SI:00:03', name: 'Demo 3', color: '#5ad17a', pace: 0.968, phase: 3.2, rssi: -71, soc0: 55 },
];
function startDemo() {
  if (activeKart().replay.active) { rcToast('Im Replay-Modus — zuerst Replay beenden'); return; }
  if (state.demo.running) return;
  if (state.serial.connected) disconnectSerial();
  const k = activeKart();
  state.demo.running = true;
  state.demo.t = 0;
  state.demo.angle = -Math.PI / 2;
  state.demo.lapsDone = 0;
  k.connection.source = 'demo';
  k.connection.bridgeMac = 'DE:MO:00:00:00:01';
  k.connection.kartMac = 'DE:MO:00:00:00:02';
  // Phase 39: Demo-Karts VOR dem Auto-Race registrieren, damit startRace()
  // alle drei als Teilnehmer aufnimmt (kein Nachzuegler-/default-Slot).
  state.demo.karts = DEMO_KART_DEFS.map(def => ({
    mac: def.mac, pace: def.pace, rssi: def.rssi,
    angle: -Math.PI / 2 - def.phase, seq: 0, soc: def.soc0,
  }));
  state.kartMeta = state.kartMeta || {};
  DEMO_KART_DEFS.forEach(def => {
    const dk = kartFor(def.mac);
    // Phase 56b: Demo-Karts sind selbst Demo-Quellen. Vorher blieb ihre
    // source fuer immer 'offline' (processTelemetry kennt nur 'serial'),
    // nur der Vor-Demo-Bucket bekam 'demo' -- Sidebar-/Statusanzeigen
    // hingen dadurch davon ab, welcher Kart gerade aktiv war (Flake).
    if (dk) {
      dk.connection.source = 'demo';
      dk.connection.bridgeMac = 'DE:MO:00:00:00:01';
      dk.connection.kartMac = def.mac;
    }
    if (!state.kartMeta[def.mac]) state.kartMeta[def.mac] = { name: def.name, color: def.color };
  });
  state.karts.setActive(DEMO_KART_DEFS[0].mac);
  state.activeKartMac = DEMO_KART_DEFS[0].mac;
  // Phase-41-Fund: Auto-Arm erst NACH dem Kart-Wechsel — armRecording()
  // armiert den aktiven Bucket; vor dem setActive traf es den vor dem
  // Demo aktiven Kart, und die Demo-Karts zeichneten nichts auf.
  if (state.settings.recordAutoArm) armRecording();
  RasiKartBar.render(state);
  const chip = $('demoChip');
  if (chip) { chip.classList.add('on'); chip.textContent = '■ Demo läuft'; }
  $('connectBtn').textContent = 'Demo läuft';
  $('connectBtn').className = 'btn blue w100';
  // Generate demo track if no track loaded
  if (!state.track.points.length) generateDemoTrack();
  // Auto-create demo driver
  if (!state.drivers.length) {
    state.drivers.push({ id: uid(), name: 'Demo Driver', number: '1', color: '#e8ff00' });
    renderDrivers();
    renderDriverOptions();
  }
  // Auto-create demo race
  let r = activeRace();
  if (!r || (r.status !== 'running' && r.status !== 'paused')) {
    const demo = {
      id: uid(), name: 'Demo Race', trackId: state.activeTrackId,
      // Zeit-Rennen (30 min): die Restzeit-Box im Live-Tab zaehlt runter
      // und das Rennen endet automatisch -- demonstriert den Countdown.
      lengthType: 'time', durationMs: 30 * 60000, targetLaps: 20,
      startDriverId: state.drivers[0].id, currentDriverId: state.drivers[0].id,
      status: 'created', createdAt: Date.now(),
      startedAt: null, endedAt: null, totalPausedMs: 0,
      laps: [], stints: [], speedTrace: []
    };
    state.races.unshift(demo);
    state.activeRaceId = demo.id;
    state.selectedRaceId = demo.id;
    state.demo.autoRaceId = demo.id;   // fuer Aufraeumen in stopDemo
    startRace();
    renderRaces();
  }
  // 80ms tick
  state.demo.interval = setInterval(demoTick, 80);
}
function stopDemo() {
  if (!state.demo.running) return;
  state.demo.running = false;
  if (state.demo.interval) clearInterval(state.demo.interval);
  state.demo.interval = null;
  activeKart().connection.source = 'offline';
  const chip = $('demoChip');
  if (chip) { chip.classList.remove('on'); chip.textContent = '▶ Demo'; }
  $('connectBtn').textContent = 'USB verbinden';
  $('connectBtn').className = 'btn primary w100';
  // Demo-Race aufraeumen: das selbst angelegte ohne gueltige Runden ist
  // wertlos und wuerde die Bibliothek vermuellen -> direkt loeschen.
  const r = activeRace();
  if (r && r.id === state.demo.autoRaceId && raceValidLaps(r).length === 0) {
    state.races = state.races.filter(x => x.id !== r.id);
    if (state.activeRaceId === r.id) state.activeRaceId = null;
    if (state.selectedRaceId === r.id) state.selectedRaceId = null;
    renderRaces();
    saveDataDebounced();
  } else if (r && r.name === 'Demo Race' && (r.status === 'running' || r.status === 'paused')) {
    endRace(false);
  }
  state.demo.autoRaceId = null;
  // Phase 39: Demo-Karts aus Registry + Hz-Liste entfernen (Meta/Namen
  // bleiben in localStorage erhalten; DE:MO:* wird nie persistiert).
  (state.demo.karts || []).forEach(dk => {
    state.karts.forget(dk.mac);
    if (state._kartHz) delete state._kartHz[dk.mac];
  });
  state.demo.karts = [];
  state.activeKartMac = state.karts.activeMac();
  RasiKartBar.render(state);
}
function demoTick() {
  try {
    state.demo.t += 0.08;
    const C = { lat: 49.6, lon: 6.12 };
    const RAD = 0.00033, WOB = 0.000028;
    const tt = state.demo.t;
    state._kartHz = state._kartHz || {};
    // Phase 39: ein Paket je Demo-Kart pro Tick (~12 Hz) — eigene MAC,
    // Pace-Spreizung, RSSI-Jitter, langsam fallender Akku.
    for (const dk of (state.demo.karts || [])) {
      dk.angle += ((Math.PI * 2) / 1038) * dk.pace;   // ~83 s/Runde x Pace
      const a = dk.angle;
      const wob = WOB * Math.sin(a * 4.5 + 0.3);
      const lat = C.lat + Math.sin(a) * RAD * 0.62 + wob;
      const lon = C.lon + Math.cos(a) * RAD + wob;
      const curvature = Math.abs(Math.cos(a * 2));
      const speed = Math.max(0, (72 - 40 * curvature + 6 * Math.sin(tt * 0.3 + a) + Math.random() * 4) * dk.pace);
      const rpm = Math.max(800, 4500 + 4200 * Math.abs(Math.sin(tt * 0.45 + a)) - 3000 * curvature + 300 * Math.sin(tt * 2.1));
      const gx = 0.6 * Math.sin(tt * 1.9 + a) + 0.08 * (Math.random() - 0.5);
      const gy = (2.1 - 1.2 * curvature) * Math.sin(a * 2 + 0.2) + 0.15 * (Math.random() - 0.5);
      dk.seq = (dk.seq + 1) % 65536;
      dk.soc = Math.max(5, dk.soc - 0.0009);          // langsam fallender Akku
      const pkt = {
        speed, rpm, gx, gy, lat, lon,
        gps_fix: 1, fix: 1,
        seq: dk.seq, from_mac: dk.mac,
        rssi: dk.rssi + Math.round(Math.random() * 6 - 3),
      };
      if (dk.seq % 25 === 0) {                         // Batterie ~alle 2 s
        pkt.soc = Math.round(dk.soc);
        pkt.vbat = +(10.5 + 2.1 * (dk.soc / 100)).toFixed(2);
      }
      state._kartHz[dk.mac] = 12;                      // 80-ms-Tick ≈ 12 Hz
      processTelemetry(pkt);
      if (dk.mac === state.activeKartMac) onGpsUpdate(lat, lon);
    }
  } catch (e) { console.warn('demoTick:', e); }
}
function generateDemoTrack() {
  const C = { lat: 49.6, lon: 6.12 };
  const RAD = 0.00033, WOB = 0.000028;
  const N = 120;
  const pts = [];
  for (let i = 0; i < N; i++) {
    const a = -Math.PI / 2 + (i / N) * Math.PI * 2;
    const wob = WOB * Math.sin(a * 4.5 + 0.3);
    pts.push({ lat: C.lat + Math.sin(a) * RAD * 0.62 + wob, lon: C.lon + Math.cos(a) * RAD + wob });
  }
  state.track.points = pts;
  state.track.bounds = null;
  pts.forEach(p => updateBounds(p.lat, p.lon));
  state.sectors.best = [null, null, null];   // neue (Demo-)Strecke -> eigene Bests
  state.track.closed = true;
  state.track.totalDistance = 0;
  for (let i = 1; i < pts.length; i++) {
    state.track.totalDistance += gpsDist(pts[i-1].lat, pts[i-1].lon, pts[i].lat, pts[i].lon);
  }
  state.track.totalDistance += gpsDist(pts[pts.length-1].lat, pts[pts.length-1].lon, pts[0].lat, pts[0].lon);
  state.track.maxDistFromStart = pts.reduce((m, p) => Math.max(m, gpsDist(pts[0].lat, pts[0].lon, p.lat, p.lon)), 0);
  // Set start gate
  state.startGate = {
    enabled: true,
    lat: pts[0].lat, lon: pts[0].lon,
    heading: headingFromPoints(pts[0], pts[1]),
    width: 14
  };
  setText('gateSizeText', '14m');
  // Auto sectors
  state.sectors.manual = false;
  calcAutoSectors();
  drawTrack();
  updateSectorPanel();
}

// ESM-Export (Phase 42): bisherige Interface-Globals von serial-demo.js
export {
  listSerialPorts, connectSerial, disconnectSerial, autoConnect,
  startDemo, stopDemo, stopReconnect, scheduleReconnect,
  handleSerialLine, generateDemoTrack,
};
