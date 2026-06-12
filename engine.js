'use strict';
/*!
 * engine.js — Motorlaufzeit & Wartung, pure Logik (RasiCross).
 * UMD wie settings.js: Browser (window.RasiEngine) + node:test.
 * Kein DOM, keine Seiteneffekte, wirft nie.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.RasiEngine = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {

  // Ab dieser Drehzahl gilt der Motor als laufend (Leerlauf liegt beim
  // Maeher um 1800 U/min, Sensor-Rauschen im Stand weit darunter).
  const RUN_RPM_MIN = 500;
  // Groessere Luecken zwischen zwei Paketen zaehlen nicht als Laufzeit
  // (Funkabriss/Disconnect soll den Zaehler nicht aufblasen).
  const MAX_GAP_MS = 2000;

  // Ein Telemetrie-Tick. acc = { totalMs, lastAt }. Liefert neues
  // { totalMs, lastAt, addedMs } — mutiert nichts.
  function engineStep(acc, rpm, nowMs) {
    const totalMs = Math.max(0, Number(acc && acc.totalMs) || 0);
    const lastAt = (acc && typeof acc.lastAt === 'number') ? acc.lastAt : null;
    const r = Number(rpm) || 0;
    const now = Number(nowMs) || 0;
    if (r < RUN_RPM_MIN) {
      return { totalMs: totalMs, lastAt: null, addedMs: 0 };
    }
    let added = 0;
    if (lastAt != null) {
      const dt = now - lastAt;
      if (dt > 0) added = Math.min(dt, MAX_GAP_MS);
    }
    return { totalMs: totalMs + added, lastAt: now, addedMs: added };
  }

  // 4530000 -> '1,3 h' (deutsches Dezimal-Komma)
  function hoursText(ms) {
    const h = Math.max(0, Number(ms) || 0) / 3600000;
    return h.toFixed(1).replace('.', ',') + ' h';
  }

  function sinceServiceMs(totalMs, lastServiceMs) {
    return Math.max(0, (Number(totalMs) || 0) - (Number(lastServiceMs) || 0));
  }

  // intervalH <= 0 = Wartungshinweis aus.
  function serviceDue(totalMs, lastServiceMs, intervalH) {
    const iv = Number(intervalH) || 0;
    if (iv <= 0) return false;
    return sinceServiceMs(totalMs, lastServiceMs) >= iv * 3600000;
  }

  return { RUN_RPM_MIN: RUN_RPM_MIN, MAX_GAP_MS: MAX_GAP_MS,
           engineStep: engineStep, hoursText: hoursText,
           sinceServiceMs: sinceServiceMs, serviceDue: serviceDue };
}));
