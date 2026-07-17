// ============================================================
//  RasiCross — kart-bar.js  (kart chips + selection)
// ============================================================
//  Renders one chip per known kart with name/colour (localStorage
//  keyed by MAC), RSSI, Hz, packet age, battery + REC indicators.
//  Clicking sets state.activeKartMac. Browser-only (uses document).
// ============================================================
// ESM (Phase 42): explizite Imports; window.rasiSerial bleibt Preload-API.
import { kartMetaFor } from './rasicross.js';
import { setLiveView } from './live-ui.js';

  // Signatur-Wrapper (state wird seit Phase 46 ignoriert): pit-wall.js,
  // live-ui.js und kart-overview.js rufen metaFor(state, mac, idx).
  function metaForState(state, mac, idx) {
    return kartMetaFor(mac, idx);
  }

  function render(state) {
    const el = document.getElementById('kartBar');
    if (!el) return;
    const macs = state.karts.macs();
    // Einzelner Kart ohne echte MAC (default-Bucket): keine Chip-Leiste noetig.
    el.style.display = macs.length <= 1 ? 'none' : 'flex';
    // Focus ueber den 1-Hz-Rebuild retten (Tastatur-Nutzer, Phase 38-Linie).
    const _fe = document.activeElement;
    const _feMac = _fe && el.contains(_fe) ? _fe.getAttribute('data-mac') : null;
    el.innerHTML = '';
    // Übersicht-Button (alle Karts auf einmal) — erstes Element in der Leiste.
    const ovBtn = document.createElement('button');
    ovBtn.type = 'button';
    ovBtn.className = 'kart-overview-btn' + (state.liveView === 'overview' ? ' active' : '');
    ovBtn.innerHTML = '⊞ Übersicht';
    ovBtn.onclick = () => { setLiveView('overview', true); };
    el.appendChild(ovBtn);
    macs.forEach((mac, i) => {
      const k = state.karts.get(mac);
      if (!k) return;
      const m = kartMetaFor(mac, i);
      // Phase 39: div-Container mit zwei Geschwister-Buttons — kein
      // Button-in-Button mehr (valides HTML, Tastatur-bedienbar).
      const chip = document.createElement('div');
      let cls = 'kart-chip' + (mac === state.activeKartMac && state.liveView !== 'overview' ? ' active' : '');
      chip.style.borderColor = m.color;
      const age = k.connection.lastPacketAt ? (Date.now() - k.connection.lastPacketAt) : 99999;
      const rec = k.recording.armed ? ' ●REC' : '';
      const rssi = (k.connection.rssi != null) ? (k.connection.rssi + 'dBm') : '--';
      const hz = (state._kartHz && state._kartHz[mac] != null) ? state._kartHz[mac] : '--';
      if (age > 2000) cls += ' stale';
      chip.className = cls;
      chip.title = mac;
      chip.innerHTML = '<button type="button" class="kart-chip-main" data-mac="' + mac + '">'
        + '<b style="color:' + m.color + '">' + escHtml(m.name) + '</b>'
        + ' <span>' + hz + 'Hz</span> <span>' + rssi + '</span>'
        + (k.batt && k.batt.present ? ' <span>' + (k.batt.soc | 0) + '%</span>' : '')
        + rec + '</button>';
      chip.querySelector('.kart-chip-main').onclick = () => {
        if (state.karts.setActive(mac)) {
          state.activeKartMac = mac;
          // Chip-Klick wählt immer die Einzelansicht dieses Karts.
          setLiveView('single', true);
        }
      };
      el.appendChild(chip);
    });
    if (_feMac) {
      const _re = el.querySelector('.kart-chip-main[data-mac="' + _feMac + '"]');
      if (_re) _re.focus();
    }
  }

  function escHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g,
      c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // ESM-Export (Phase 42): Default-Objekt = bisheriges window.RasiKartBar
  export default { render, metaFor: metaForState };
