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
        + rec
        + ' <button class="kart-edit" title="Umbenennen / Farbe / Vergessen" data-mac="' + mac + '">✏</button>';
      chip.onclick = (ev) => {
        if (ev.target && ev.target.classList.contains('kart-edit')) {
          ev.stopPropagation();
          openEditor(state, mac, ev.target);
          return;
        }
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

  let _onDocClick = null;

  function closeEditor() {
    const pop = document.getElementById('kartEditPopover');
    if (pop) pop.classList.add('hidden');
    if (_onDocClick) { document.removeEventListener('mousedown', _onDocClick, true);
      document.removeEventListener('keydown', _onEditKey, true); _onDocClick = null; }
  }

  function _onEditKey(ev) { if (ev.key === 'Escape') closeEditor(); }

  function openEditor(state, mac, anchorEl) {
    const pop = document.getElementById('kartEditPopover');
    if (!pop) return;
    const macs = state.karts.macs();
    const idx = Math.max(0, macs.indexOf(mac));
    const m = metaForState(state, mac, idx);

    const nameEl = document.getElementById('kartEditName');
    nameEl.value = m.name || '';
    nameEl.oninput = () => {
      m.name = nameEl.value.trim() || ('Kart ' + (idx + 1));
      state.kartMeta[mac] = m; saveMeta(state.kartMeta);
      render(state);
      if (window.renderConnectionTab) window.renderConnectionTab();
    };

    const sw = document.getElementById('kartEditSwatches');
    sw.innerHTML = '';
    PALETTE.forEach(col => {
      const b = document.createElement('div');
      b.className = 'sw' + (col === m.color ? ' active' : '');
      b.style.background = col;
      b.onclick = () => {
        m.color = col; state.kartMeta[mac] = m; saveMeta(state.kartMeta);
        sw.querySelectorAll('.sw').forEach(s => s.classList.remove('active'));
        b.classList.add('active');
        render(state);
        if (window.renderConnectionTab) window.renderConnectionTab();
      };
      sw.appendChild(b);
    });

    const fb = document.getElementById('kartEditForget');
    fb.onclick = () => { forgetKart(state, mac); closeEditor(); };

    // Positionieren unter dem Anker
    const r = anchorEl.getBoundingClientRect();
    pop.style.left = Math.min(r.left, window.innerWidth - 220) + 'px';
    pop.style.top = (r.bottom + 6) + 'px';
    pop.classList.remove('hidden');

    _onDocClick = (ev) => { if (!pop.contains(ev.target) && ev.target !== anchorEl) closeEditor(); };
    document.addEventListener('mousedown', _onDocClick, true);
    document.addEventListener('keydown', _onEditKey, true);
  }

  function forgetKart(state, mac) {
    state.karts.forget(mac);
    if (state._kartHz) delete state._kartHz[mac];
    // Bridge-Kommando (Bridge-Ebene, nicht kart-geroutet) — nur falls verbunden.
    if (state.serial && state.serial.connected && window.rasiSerial && window.rasiSerial.writeLine) {
      try { window.rasiSerial.writeLine(JSON.stringify({ type: 'forget_kart_mac', mac })); } catch (e) {}
    }
    state.activeKartMac = state.karts.activeMac();   // Registry hat ggf. umgepointet
    if (typeof rcToast === 'function') rcToast('Kart vergessen');
    render(state);
    if (window.renderConnectionTab) window.renderConnectionTab();
  }

  // state-basierter Wrapper, damit pit-wall.js dieselbe Meta-Quelle nutzt.
  function metaForState(state, mac, idx) {
    const meta = state.kartMeta && Object.keys(state.kartMeta).length ? state.kartMeta : loadMeta();
    state.kartMeta = meta;
    const m = metaFor(meta, mac, idx);
    saveMeta(meta);
    return m;
  }

  window.RasiKartBar = { render, metaFor: metaForState, openEditor, forgetKart };
})();
