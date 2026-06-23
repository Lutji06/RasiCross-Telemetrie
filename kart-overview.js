// ============================================================
//  RasiCross — kart-overview.js  (all-karts live overview grid)
// ============================================================
//  Renders one card per known kart on the Live tab when
//  state.liveView === 'overview'. Racing/timing focus: Speed,
//  current lap, best lap (+best-lap number), REC, plus a stale
//  marker. Reads each kart via state.karts.get(mac) — NOT the
//  active-only facade. Clicking a card selects that kart and
//  switches back to the single-kart Live view. Browser-only.
// ============================================================
(function () {
  'use strict';

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g,
      c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function lap(ms) {
    return (ms && typeof fmtMs === 'function') ? fmtMs(ms) : '--:--.---';
  }

  function render(state) {
    const el = document.getElementById('liveOverview');
    if (!el) return;
    const macs = state.karts.macs();
    const now = Date.now();
    el.innerHTML = macs.map((mac, i) => {
      const k = state.karts.get(mac);
      if (!k) return '';
      const m = window.RasiKartBar ? RasiKartBar.metaFor(state, mac, i) : { name: mac, color: '#3aa0e8' };
      const age = k.connection.lastPacketAt ? (now - k.connection.lastPacketAt) : 99999;
      const stale = age > 2000;
      const speed = (k.telemetry.speed || 0).toFixed(0);
      const lapCur = k.lapStart ? lap(now - k.lapStart) : '--:--.---';
      const lapBest = lap(k.bestLapMs);
      const bestNum = k.bestLapNum ? ('Bestrunde · Runde ' + k.bestLapNum) : 'Noch keine Rundenzeit';
      const rec = k.recording.armed ? '<span class="ko-rec">●REC</span>' : '';
      const cls = 'ko-card' + (mac === state.activeKartMac ? ' active' : '') + (stale ? ' stale' : '');
      return '<div class="' + cls + '" data-mac="' + mac + '" style="border-color:' + m.color + '">'
        + '<div class="ko-head"><span class="ko-dot" style="background:' + m.color + '"></span>'
        +   '<span class="ko-name" style="color:' + m.color + '">' + esc(m.name) + '</span>' + rec + '</div>'
        + '<div class="ko-speed">' + speed + '<small>km/h</small></div>'
        + '<div class="ko-row"><span class="ko-l">Aktuelle Runde</span><span class="ko-v">' + lapCur + '</span></div>'
        + '<div class="ko-row"><span class="ko-l">Beste Runde</span><span class="ko-v">' + lapBest + '</span></div>'
        + '<div class="ko-sub">' + bestNum + '</div>'
        + '</div>';
    }).join('');
    el.querySelectorAll('.ko-card').forEach(card => {
      card.onclick = () => {
        const mac = card.getAttribute('data-mac');
        if (state.karts.setActive(mac)) {
          state.activeKartMac = mac;
          if (window.setLiveView) window.setLiveView('single');
        }
      };
    });
  }

  window.RasiKartOverview = { render };
})();
