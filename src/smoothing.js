// ============================================================
//  RasiCross — smoothing.js  (EMA-Glaettung, Phase 61)
// ============================================================
//  Dependency-free UMD: laeuft unter node:test (CI) und im Browser.
//  Kein DOM, kein State, wirft nie.
//
//  Zweck: die ANGEZEIGTEN Maximalwerte von Geschwindigkeit und Drehzahl
//  duerfen nicht von einem einzelnen Stoerimpuls gesetzt werden (ein
//  GPS-Ausreisser oder eine Zuend-EMI-Flanke haette den MAX-Wert sonst
//  dauerhaft verfaelscht). Der Maximalwert wird daher ueber den
//  EMA-geglaetteten Verlauf gebildet, nicht ueber die Rohwerte.
//
//  Konvention: alpha ist das Gewicht des NEUEN Werts (wie gauges.js LERP
//  und calc.rpm_ema_step auf dem ESP) — klein = traege, 1 = ungefiltert.
// ============================================================

  // 0.3 bei ~12,5 Hz Paketrate: ein einzelner Ausreisser schlaegt nur zu
  // 30 % durch, ein echter Anstieg ist nach ~0,4 s praktisch erreicht.
  var MAX_ALPHA = 0.3;

  // prev == null (noch kein Messwert) -> der erste Wert seedet direkt,
  // damit der MAX-Wert nicht erst aus einer Rampe ab 0 hochlaeuft.
  function emaStep(prev, value, alpha) {
    var v = Number(value);
    if (!isFinite(v)) return prev == null ? null : prev;
    var a = Number(alpha);
    if (!isFinite(a) || a <= 0 || a > 1) a = MAX_ALPHA;
    var p = Number(prev);
    if (prev == null || !isFinite(p)) return v;
    return p + (v - p) * a;
  }

  export default { MAX_ALPHA: MAX_ALPHA, emaStep: emaStep };
