// ============================================================
//  RasiCross — kart-bar.js  (kart chips + selection)
// ============================================================
//  Renders one chip per known kart with name/colour (localStorage
//  keyed by MAC), RSSI, Hz, packet age, battery + REC indicators.
//  Clicking sets state.activeKartMac. Browser-only (uses document).
// ============================================================
(function () {
  'use strict';
  const LS_KEY = 'rasi.kartMeta.v1';
  const PALETTE = ['#3aa0e8', '#e8a13a', '#5ad17a', '#e85a7a', '#b07ae8'];

  function loadMeta() {
    try { return JSON.parse(localStorage.getItem(LS_KEY)) || {}; } catch (e) { return {}; }
  }
  function saveMeta(meta) {
    try { localStorage.setItem(LS_KEY, JSON.stringify(meta)); } catch (e) {}
  }
  function metaFor(meta, mac, idx) {
    if (!meta[mac]) meta[mac] = { name: 'Kart ' + (idx + 1), color: PALETTE[idx % PALETTE.length] };
    return meta[mac];
  }

  function render(state) {
    const el = document.getElementById('kartBar');
    if (!el) return;
    const meta = state.kartMeta && Object.keys(state.kartMeta).length ? state.kartMeta : loadMeta();
    state.kartMeta = meta;
    const macs = state.karts.macs();
    // Einzelner Kart ohne echte MAC (default-Bucket): keine Chip-Leiste noetig.
    el.style.display = macs.length <= 1 ? 'none' : 'flex';
    el.innerHTML = '';
    macs.forEach((mac, i) => {
      const k = state.karts.get(mac);
      if (!k) return;
      const m = metaFor(meta, mac, i);
      const chip = document.createElement('button');
      let cls = 'kart-chip' + (mac === state.activeKartMac ? ' active' : '');
      chip.style.borderColor = m.color;
      const age = k.connection.lastPacketAt ? (Date.now() - k.connection.lastPacketAt) : 99999;
      const rec = k.recording.armed ? ' ●REC' : '';
      const rssi = (k.connection.rssi != null) ? (k.connection.rssi + 'dBm') : '--';
      const hz = (state._kartHz && state._kartHz[mac] != null) ? state._kartHz[mac] : '--';
      if (age > 2000) cls += ' stale';
      chip.className = cls;
      chip.title = mac;
      chip.innerHTML = '<b style="color:' + m.color + '">' + escHtml(m.name) + '</b>'
        + ' <span>' + hz + 'Hz</span> <span>' + rssi + '</span>'
        + (k.batt && k.batt.present ? ' <span>' + (k.batt.soc | 0) + '%</span>' : '')
        + rec;
      chip.onclick = () => {
        if (state.karts.setActive(mac)) {
          state.activeKartMac = mac;
          render(state);
        }
      };
      el.appendChild(chip);
    });
    saveMeta(meta);
  }

  function escHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g,
      c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  window.RasiKartBar = { render };
})();
