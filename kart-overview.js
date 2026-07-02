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

  // Phase 36: ein Delta formatieren ("+N Runde(n)" bei Runden-Rueckstand,
  // sonst "+N m" Streckenabstand). Fuer Gap (zum Fuehrenden) + Int (zum Vordermann).
  function fmtDelta(lapGap, distM) {
    if (lapGap > 0) return '+' + lapGap + (lapGap === 1 ? ' Runde' : ' Runden');
    return '+' + Math.round(distM) + ' m';
  }

  // Phase 36: Gap·Int-Zeile in Metern — Fuehrender "Leader", sonst "Gap <Meter zum
  // Fuehrenden> · Int <Meter zum Vordermann>". P2: Gap == Int (Vordermann = Fuehrender).
  function fmtGap(e) {
    if (!e || e.pos === 1) return 'Leader';
    return 'Gap ' + fmtDelta(e.lapGap, e.distGapM)
         + ' · Int ' + fmtDelta(e.intervalLapGap, e.distIntM);
  }

  // Phase 33: Overtake-Highlight — vorherige Positionen + Aufstiegs-Zeitstempel
  // je Kart (modul-lokal). Statischer Glow fuer OVERTAKE_MS, rebuild-sicher.
  const OVERTAKE_MS = 1200;
  let prevPosByMac = {};
  let overtakeAtByMac = {};

  function render(state) {
    const el = document.getElementById('liveOverview');
    if (!el) return;
    const macs = state.karts.macs();
    const now = Date.now();
    // Phase 31: Positions-Ranking nur bei laufendem Rennen mit >=2 Teilnehmern.
    const r = (typeof activeRace === 'function') ? activeRace() : null;
    // Phase 39: gemeinsames, memoisiertes Ranking aus kart-rank.js.
    const rr = window.RasiKartRank ? RasiKartRank.ranking(state, r) : null;
    const hasTrack = !!(rr && rr.hasTrack);
    // Phase 32: Halter der schnellsten Runde (lila Markierung), nur bei aktivem Ranking.
    const flHolder = rr ? RasiLapEngine.fastestLapHolder(r) : null;
    const posByMac = rr ? rr.posByMac : {};
    let orderedMacs = macs;
    if (rr) {
      orderedMacs = rr.ranked.map(e => e.mac).filter(m => macs.includes(m))
        .concat(macs.filter(m => !(m in posByMac)));
      // Phase 33: Aufsteiger erkennen -> Glow-Zeitstempel; Vorpositionen merken.
      RasiLapEngine.positionGains(prevPosByMac, rr.ranked).forEach(mac => { overtakeAtByMac[mac] = now; });
      const _np = {};
      rr.ranked.forEach(e => { _np[e.mac] = e.pos; });
      prevPosByMac = _np;
    } else {
      // Kein aktives Ranking -> Overtake-State zuruecksetzen (frischer Start).
      prevPosByMac = {};
      overtakeAtByMac = {};
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
      // Phase 31: Positions-Badge + Gap. Phase 32: Gap·Int + Fastest-Lap-Markierung.
      const pe = posByMac[mac];
      const posBadge = pe ? '<span class="ko-pos">P' + pe.pos + '</span>' : '';
      const gapRow = pe ? '<div class="ko-gap">' + (hasTrack ? fmtGap(pe) : '--') + '</div>' : '';
      const isFL = !!(flHolder && flHolder.mac === mac);
      const flBadge = isFL ? '<span class="ko-fl">⚡FL</span>' : '';
      const bestCls = 'ko-v' + (isFL ? ' ko-v-fl' : '');
      const isOvertake = !!(overtakeAtByMac[mac] && (now - overtakeAtByMac[mac] < OVERTAKE_MS));
      const cls = 'ko-card' + (mac === state.activeKartMac ? ' active' : '') + (stale ? ' stale' : '')
        + (isOvertake ? ' ko-overtake' : '');
      return '<div class="' + cls + '" data-mac="' + mac + '" style="border-color:' + m.color + '">'
        + '<div class="ko-head">' + posBadge + '<span class="ko-dot" style="background:' + m.color + '"></span>'
        +   '<span class="ko-name" style="color:' + m.color + '">' + esc(m.name) + '</span>' + rec + flBadge + '</div>'
        + '<div class="ko-speed">' + speed + '<small>km/h</small></div>'
        + '<div class="ko-row"><span class="ko-l">Aktuelle Runde</span><span class="ko-v">' + lapCur + '</span></div>'
        + '<div class="ko-row"><span class="ko-l">Beste Runde</span><span class="' + bestCls + '">' + lapBest + '</span></div>'
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
