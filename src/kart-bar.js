// ============================================================
//  RasiCross — kart-bar.js  (kart chips + selection)
// ============================================================
//  Renders one chip per known kart with name/colour (localStorage
//  keyed by MAC), RSSI, Hz, packet age, battery + REC indicators.
//  Clicking sets state.activeKartMac. Browser-only (uses document).
// ============================================================
// ESM (Phase 42): explizite Imports; window.rasiSerial bleibt Preload-API.
import { kartMetaFor } from './rasicross.js';
import { setLivePage } from './live-ui.js';

  // Signatur-Wrapper (state wird seit Phase 46 ignoriert): pit-wall.js,
  // live-ui.js und kart-overview.js rufen metaFor(state, mac, idx).
  function metaForState(state, mac, idx) {
    return kartMetaFor(mac, idx);
  }

  // Phase 66: Der Detail-Tab blaettert wie Live -- dieselbe Leiste, zweiter
  // Anker im DOM. Ohne Ziel zeichnet render() beide; so bleiben die sieben
  // Aufrufer unveraendert und die Leisten koennen nicht auseinanderlaufen.
  const LIVE_BAR = 'kartBar';
  const DETAIL_BAR = 'kartBarDetail';

  function render(state, targetId) {
    if (targetId) { renderInto(state, targetId); return; }
    renderInto(state, LIVE_BAR);
    renderInto(state, DETAIL_BAR);
    renderDetailName(state);
  }

  // Der Detail-Tab hat keine Seiten: ein Chip waehlt nur das aktive Kart,
  // an dem seine Werte ohnehin haengen (live-ui.js schreibt sie ueber die
  // gemeinsamen Ziele aus dom-targets.js).
  function selectKart(state, mac) {
    if (!state.karts.setActive(mac)) return;
    state.activeKartMac = mac;
    render(state);
  }

  // Zeigt im Eyebrow des Detail-Tabs, welches Kart gerade zu sehen ist --
  // ohne das steht dort eine Kurve ohne Absender.
  function renderDetailName(state) {
    const el = document.getElementById('detailKartName');
    if (!el) return;
    const mac = state.activeKartMac || state.karts.activeMac();
    const idx = state.karts.macs().indexOf(mac);
    if (!mac || idx < 0) { el.textContent = ''; return; }
    const m = kartMetaFor(mac, idx);
    el.textContent = '· ' + m.name;
    el.style.color = m.color;
  }

  function renderInto(state, id) {
    const el = document.getElementById(id);
    if (!el) return;
    const isLive = id === LIVE_BAR;
    const macs = state.karts.macs();
    // Einzelner Kart ohne echte MAC (default-Bucket): keine Chip-Leiste noetig.
    el.style.display = macs.length <= 1 ? 'none' : 'flex';
    // Focus ueber den 1-Hz-Rebuild retten (Tastatur-Nutzer, Phase 38-Linie).
    const _fe = document.activeElement;
    const _feMac = _fe && el.contains(_fe) ? _fe.getAttribute('data-mac') : null;
    el.innerHTML = '';
    // Übersicht-Button (alle Karts auf einmal) — erstes Element in der Leiste.
    // Nur im Live-Tab: der Detail-Tab kennt keine Uebersichtsseite.
    if (isLive) {
      const ovBtn = document.createElement('button');
      ovBtn.type = 'button';
      ovBtn.className = 'kart-overview-btn' + (state.liveView === 'overview' ? ' active' : '');
      ovBtn.innerHTML = '⊞ Übersicht';
      ovBtn.onclick = () => { setLivePage(0); };
      el.appendChild(ovBtn);
    }
    macs.forEach((mac, i) => {
      const k = state.karts.get(mac);
      if (!k) return;
      const m = kartMetaFor(mac, i);
      // Phase 39: div-Container mit zwei Geschwister-Buttons — kein
      // Button-in-Button mehr (valides HTML, Tastatur-bedienbar).
      const chip = document.createElement('div');
      // Im Detail-Tab markiert der Chip immer das aktive Kart -- die
      // Uebersichtsseite gibt es dort nicht.
      let cls = 'kart-chip' + (mac === state.activeKartMac
        && (!isLive || state.liveView !== 'overview') ? ' active' : '');
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
        // Phase 65: Der Chip ist die Seitenwahl -- setLivePage setzt das
        // aktive Kart selbst, sobald die Seite aufgeloest ist.
        if (isLive) setLivePage(null, mac);
        else selectKart(state, mac);
      };
      el.appendChild(chip);
    });
    if (_feMac) {
      const _re = el.querySelector('.kart-chip-main[data-mac="' + _feMac + '"]');
      // preventScroll ist Pflicht, nicht Kosmetik: focus() rollt den Chip
      // sonst in den Sichtbereich. Die Leiste steht ganz oben, der Rebuild
      // laeuft im Sekundentakt -- wer nach einem Chip-Klick im Detail-Tab
      // nach unten scrollte, wurde jede Sekunde an den Anfang zurueck-
      // geworfen (Phase 67).
      if (_re) _re.focus({ preventScroll: true });
    }
  }

  function escHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g,
      c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // ESM-Export (Phase 42): Default-Objekt = bisheriges window.RasiKartBar
  export default { render, metaFor: metaForState };
