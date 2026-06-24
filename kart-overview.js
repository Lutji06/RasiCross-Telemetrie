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

  // Phase 31: Linien-Durchfahrt-Zeitstempel je Teilnehmer fuer das Ranking.
  function buildCrossings(state, r) {
    const out = {};
    RasiLapEngine.participantsOf(r).forEach(p => {
      const kk = state.karts.has(p.mac) ? state.karts.get(p.mac) : null;
      out[p.mac] = kk ? kk.lapStart : null;
    });
    return out;
  }

  // Phase 31: Gap-Text — Fuehrender "Leader", gleiche Runde "+x.xs",
  // ueberrundet "+N Runde(n)".
  function fmtGap(e) {
    if (!e || e.pos === 1) return 'Leader';
    if (e.lapGap > 0) return '+' + e.lapGap + (e.lapGap === 1 ? ' Runde' : ' Runden');
    return '+' + (e.timeGapMs / 1000).toFixed(1) + 's';
  }

  function render(state) {
    const el = document.getElementById('liveOverview');
    if (!el) return;
    const macs = state.karts.macs();
    const now = Date.now();
    // Phase 31: Positions-Ranking nur bei laufendem Rennen mit >=2 Teilnehmern.
    const r = (typeof activeRace === 'function') ? activeRace() : null;
    const ranking = (r && r.status === 'running'
                     && RasiLapEngine.participantsOf(r).length >= 2)
      ? RasiLapEngine.rankParticipants(r, buildCrossings(state, r))
      : null;
    const posByMac = {};
    let orderedMacs = macs;
    if (ranking) {
      ranking.forEach(e => { posByMac[e.mac] = e; });
      orderedMacs = ranking.map(e => e.mac).filter(m => macs.includes(m))
        .concat(macs.filter(m => !(m in posByMac)));
    }
    el.innerHTML = orderedMacs.map(mac => {
      const k = state.karts.get(mac);
      if (!k) return '';
      const origIdx = macs.indexOf(mac);
      const m = window.RasiKartBar ? RasiKartBar.metaFor(state, mac, origIdx) : { name: mac, color: '#3aa0e8' };
      const age = k.connection.lastPacketAt ? (now - k.connection.lastPacketAt) : 99999;
      const stale = age > 2000;
      const speed = (k.telemetry.speed || 0).toFixed(0);
      const lapCur = k.lapStart ? lap(now - k.lapStart) : '--:--.---';
      const lapBest = lap(k.bestLapMs);
      // Phase 30: Rundenzahl dieses Karts im aktiven Rennen (Teilnehmer-Slot).
      const _part = (r && r.participants) ? r.participants[mac] : null;
      const lapCount = _part ? RasiLapEngine.partValidLaps(_part).length : 0;
      const bestNum = k.bestLapNum
        ? ('Runde ' + lapCount + ' · Best R' + k.bestLapNum)
        : (lapCount ? ('Runde ' + lapCount) : 'Noch keine Rundenzeit');
      const rec = k.recording.armed ? '<span class="ko-rec">●REC</span>' : '';
      // Phase 31: Positions-Badge + Gap (nur wenn Ranking aktiv).
      const pe = posByMac[mac];
      const posBadge = pe ? '<span class="ko-pos">P' + pe.pos + '</span>' : '';
      const gapRow = pe ? '<div class="ko-gap">' + fmtGap(pe) + '</div>' : '';
      const cls = 'ko-card' + (mac === state.activeKartMac ? ' active' : '') + (stale ? ' stale' : '');
      return '<div class="' + cls + '" data-mac="' + mac + '" style="border-color:' + m.color + '">'
        + '<div class="ko-head">' + posBadge + '<span class="ko-dot" style="background:' + m.color + '"></span>'
        +   '<span class="ko-name" style="color:' + m.color + '">' + esc(m.name) + '</span>' + rec + '</div>'
        + '<div class="ko-speed">' + speed + '<small>km/h</small></div>'
        + '<div class="ko-row"><span class="ko-l">Aktuelle Runde</span><span class="ko-v">' + lapCur + '</span></div>'
        + '<div class="ko-row"><span class="ko-l">Beste Runde</span><span class="ko-v">' + lapBest + '</span></div>'
        + '<div class="ko-sub">' + bestNum + '</div>' + gapRow
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
