'use strict';
/*!
 * kart-stats.js — Lebens-Statistik pro Kart (Odometer, Fahrzeit, Topspeed),
 * pure Logik (RasiCross, Phase 48). Stil wie engine.js: node:test + Browser.
 * Kein DOM, keine Seiteneffekte, wirft nie.
 */

  // Unterhalb gilt das Kart als stehend (GPS-Rauschen im Stand liegt
  // typisch bei 1-2 km/h und darf keine Kilometer erzeugen).
  const MOVE_KMH_MIN = 3;
  // Groessere Paket-Luecken zaehlen nicht als Fahrt (Funkabriss/Reconnect
  // wuerde sonst Kilometer und Fahrzeit aufblasen).
  const MAX_GAP_MS = 5000;

  // Bewusst dupliziert zu kart-registry.makeKartState().stats —
  // kart-registry bleibt dependency-frei; bei Feldaenderungen BEIDE pflegen.
  function statsDefaults() {
    return { odoM: 0, moveMs: 0, topKmh: 0, lastAt: null, _unsavedMs: 0 };
  }

  // Ein Telemetrie-Tick. acc = { odoM, moveMs, topKmh, lastAt }. Liefert
  // neues { odoM, moveMs, topKmh, lastAt, addedMs } — mutiert nichts.
  function statsStep(acc, speedKmh, nowMs) {
    const odoM = Math.max(0, Number(acc && acc.odoM) || 0);
    const moveMs = Math.max(0, Number(acc && acc.moveMs) || 0);
    const topKmh = Math.max(0, Number(acc && acc.topKmh) || 0);
    const lastAt = (acc && typeof acc.lastAt === 'number') ? acc.lastAt : null;
    const v = Math.max(0, Number(speedKmh) || 0);
    const now = Number(nowMs) || 0;
    const top = Math.max(topKmh, v);
    if (v < MOVE_KMH_MIN) {
      return { odoM: odoM, moveMs: moveMs, topKmh: top, lastAt: null, addedMs: 0 };
    }
    let added = 0;
    if (lastAt != null) {
      const dt = now - lastAt;
      if (dt > 0 && dt <= MAX_GAP_MS) added = dt;
    }
    return { odoM: odoM + (v / 3.6) * (added / 1000), moveMs: moveMs + added,
             topKmh: top, lastAt: now, addedMs: added };
  }

  // Ø nur ueber echte Fahrzeit (Stillstand zaehlt nicht in moveMs).
  function avgKmh(odoM, moveMs) {
    const ms = Number(moveMs) || 0;
    if (ms <= 0) return 0;
    return ((Number(odoM) || 0) / 1000) / (ms / 3600000);
  }

  // 148234 m -> '148,2 km' (deutsches Dezimal-Komma, wie engine.hoursText)
  function kmText(odoM) {
    return (Math.max(0, Number(odoM) || 0) / 1000).toFixed(1).replace('.', ',') + ' km';
  }
  function kmhText(v) {
    return Math.max(0, Number(v) || 0).toFixed(1).replace('.', ',') + ' km/h';
  }

  // ESM-Export (Konvention der Objekt-Module, Phase 42)
  export default { MOVE_KMH_MIN, MAX_GAP_MS, statsDefaults, statsStep,
                   avgKmh, kmText, kmhText };
