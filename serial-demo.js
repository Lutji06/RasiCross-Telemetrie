'use strict';
// ============================================================
//  RasiCross -- serial-demo.js  (Serial-Verbindung + Demo, Phase 22)
//  Klassisches Script im gemeinsamen Global-Scope: nutzt state/$/esc/
//  uid/setText, Dialoge, window.rasiSerial (Electron-Preload) bzw.
//  WebSerial, sowie processTelemetry/onGpsUpdate/armRecording/
//  pushPacketLog und races.js-/map-draw.js-Funktionen.
//  Nur Deklarationen auf Top-Level -- kein Code laeuft beim Laden.
// ============================================================

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
    } else if ('serial' in navigator) {
      sel.innerHTML = '<option value="webserial">Browser-Auswahl beim Verbinden</option>';
    } else {
      sel.innerHTML = '<option value="">Nicht unterstützt</option>';
    }
  } catch (e) { console.warn('listSerialPorts:', e); sel.innerHTML = '<option value="">Fehler</option>'; }
}
async function connectSerial() {
  if (state.replay.active) { rcToast('Im Replay-Modus — zuerst Replay beenden'); return; }
  if (state.demo.running) stopDemo();
  stopReconnect();
  state.serial.autoReconnect = $('autoReconnectToggle').checked;
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
      state.connection.source = 'serial';
      $('connectBtn').textContent = 'USB trennen';
      $('connectBtn').className = 'btn danger w100';
      $('serialConnectBtn').textContent = 'Trennen';
      // Request status
      setTimeout(() => { try { window.rasiSerial.writeLine(JSON.stringify({ type: 'request_status' })); } catch {} }, 800);
    } else if ('serial' in navigator) {
      const port = await navigator.serial.requestPort();
      await port.open({ baudRate: state.serial.baud });
      state.serial.port = port;
      state.serial.connected = true;
      state.serial.portName = 'WebSerial';
      state.connection.source = 'serial';
      $('connectBtn').textContent = 'USB trennen';
      readWebSerial(port);
    } else {
      rcAlert('USB-Serial nur in Electron oder Chrome/Edge verfügbar.');
    }
  } catch (e) {
    state.connection.errors++;
    state.serial.connected = false;
    rcAlert('Verbindung fehlgeschlagen:\n' + (e?.message || e), 'Fehler');
  }
}
async function disconnectSerial() {
  stopReconnect();
  state.serial.autoReconnect = false;
  try {
    if (window.rasiSerial) await window.rasiSerial.close();
    if (state.serial.port) await state.serial.port.close();
  } catch {}
  state.serial.connected = false;
  state.serial.port = null;
  state.connection.source = 'offline';
  $('connectBtn').textContent = 'USB verbinden';
  $('connectBtn').className = 'btn primary w100';
  $('serialConnectBtn').textContent = 'Verbinden';
}
function onSerialClose() {
  state.serial.connected = false;
  state.connection.source = 'offline';
  $('connectBtn').textContent = 'USB verbinden';
  $('connectBtn').className = 'btn primary w100';
  $('serialConnectBtn').textContent = 'Verbinden';
  if (state.serial.autoReconnect && state.serial.lastPath) scheduleReconnect();
}
function onSerialError(msg) {
  state.connection.errors++;
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
    pushPacketLog(line);
    processTelemetry(d);
    if (d.lat && d.lon) onGpsUpdate(d.lat, d.lon);
  } catch (e) { state.connection.errors++; }
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
        state.connection.source = 'serial';
        state.serial.reconnectAttempts = 0;
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

// Demo
function startDemo() {
  if (state.replay.active) { rcToast('Im Replay-Modus — zuerst Replay beenden'); return; }
  if (state.demo.running) return;
  if (state.serial.connected) disconnectSerial();
  state.demo.running = true;
  if (state.settings.recordAutoArm) armRecording();
  state.demo.t = 0;
  state.demo.angle = -Math.PI / 2;
  state.demo.lapsDone = 0;
  state.connection.source = 'demo';
  state.connection.bridgeMac = 'DE:MO:00:00:00:01';
  state.connection.kartMac = 'DE:MO:00:00:00:02';
  $('demoStartBtn').classList.add('hidden');
  $('demoStopBtn').classList.remove('hidden');
  setText('demoModeText', 'Läuft');
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
      lengthType: 'free', durationMs: 30 * 60000, targetLaps: 20,
      startDriverId: state.drivers[0].id, currentDriverId: state.drivers[0].id,
      status: 'created', createdAt: Date.now(),
      startedAt: null, endedAt: null, totalPausedMs: 0,
      laps: [], stints: [], speedTrace: []
    };
    state.races.unshift(demo);
    state.activeRaceId = demo.id;
    state.selectedRaceId = demo.id;
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
  state.connection.source = 'offline';
  $('demoStartBtn').classList.remove('hidden');
  $('demoStopBtn').classList.add('hidden');
  setText('demoModeText', 'Bereit');
  $('connectBtn').textContent = 'USB verbinden';
  $('connectBtn').className = 'btn primary w100';
  // End demo race if running
  const r = activeRace();
  if (r && r.name === 'Demo Race' && (r.status === 'running' || r.status === 'paused')) {
    endRace(false);
  }
}
function demoTick() {
  try {
    state.demo.t += 0.08;
    state.demo.angle += (Math.PI * 2) / 1038; // ~83s/lap
    const a = state.demo.angle;
    const C = { lat: 49.6, lon: 6.12 };
    const RAD = 0.00033, WOB = 0.000028;
    const wob = WOB * Math.sin(a * 4.5 + 0.3);
    const lat = C.lat + Math.sin(a) * RAD * 0.62 + wob;
    const lon = C.lon + Math.cos(a) * RAD + wob;
    const curvature = Math.abs(Math.cos(a * 2));
    const speed = Math.max(0, 72 - 40 * curvature + 6 * Math.sin(state.demo.t * 0.3) + Math.random() * 4);
    const rpm = Math.max(800, 4500 + 4200 * Math.abs(Math.sin(state.demo.t * 0.45)) - 3000 * curvature + 300 * Math.sin(state.demo.t * 2.1));
    const gx = 0.6 * Math.sin(state.demo.t * 1.9) + 0.08 * (Math.random() - 0.5);
    const gy = (2.1 - 1.2 * curvature) * Math.sin(a * 2 + 0.2) + 0.15 * (Math.random() - 0.5);
    // Process as if from telemetry
    processTelemetry({
      speed, rpm, gx, gy, lat, lon,
      gps_fix: 1, fix: 1,
      seq: (state.connection.seq || 0) + 1,
      from_mac: 'DE:MO:RA:SI:00:01',
      rssi: -52
    });
    onGpsUpdate(lat, lon);
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

// Interface-Marker: von rasicross.js (init-Bindings, Replay, Settings)
// genutzte Funktionen -- verhindert no-unused-vars, dokumentiert das API.
void [listSerialPorts, connectSerial, disconnectSerial, onSerialClose,
      onSerialError, readWebSerial, handleSerialLine, scheduleReconnect,
      stopReconnect, startDemo, stopDemo, demoTick, generateDemoTrack];
