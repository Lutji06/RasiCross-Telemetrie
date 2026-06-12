# ============================================================
#  RasiCross  --  calc.py  (pure speed math)
# ============================================================
#  Keine Importe -> laeuft identisch unter CPython (Unit-Tests /
#  CI) und MicroPython (auf dem Kart-ESP32). Auf den Kart-ESP wie
#  die anderen esp_libs ins Root flashen:
#    mpremote connect <port> cp esp_libs/calc.py :
# ============================================================


def wheel_speed_kmh(pulse_hz, ppr, circ_m, gear_ratio=1.0):
    """Fahrzeuggeschwindigkeit in km/h aus der Hall-Pulsfrequenz.

    pulse_hz   : Hall-Pulse pro Sekunde
    ppr        : Hall-Pulse pro Wellenumdrehung (>= 1)
    circ_m     : Radumfang in Metern (> 0 aktiviert die Funktion)
    gear_ratio : Wellenumdrehungen je Radumdrehung (Untersetzung,
                 z. B. 6.3). <= 0 / nicht-numerisch -> 1.0 (keine
                 Untersetzung). Default 1.0 = bisheriges Verhalten.

    Liefert 0.0 bei nicht-positiven oder nicht-numerischen
    pulse_hz/ppr/circ_m.
    """
    try:
        pulse_hz = float(pulse_hz)
        ppr = float(ppr)
        circ_m = float(circ_m)
    except (TypeError, ValueError):
        return 0.0
    if not (pulse_hz > 0.0) or not (ppr > 0.0) or not (circ_m > 0.0):
        return 0.0  # also maps NaN -> 0.0 (NaN comparisons are always False)
    try:
        g = float(gear_ratio)
    except (TypeError, ValueError):
        g = 1.0
    if not (g > 0.0):          # <=0, negativ oder NaN -> keine Untersetzung
        g = 1.0
    rev_per_s = (pulse_hz / ppr) / g
    return rev_per_s * circ_m * 3.6


def speed_source(gps_fix, wheel_circ_m):
    """Aus welcher Quelle die gemeldete Geschwindigkeit stammen soll.

    Prioritaet: GPS-Fix gewinnt; sonst Rad, falls ein Radumfang
    konfiguriert ist (> 0); sonst keine Quelle.

    Rueckgabe: 'gps' | 'wheel' | 'none'.
    """
    if gps_fix:
        return 'gps'
    try:
        if float(wheel_circ_m) > 0.0:
            return 'wheel'
    except (TypeError, ValueError):
        pass
    return 'none'


# ---- Drehzahl (Hall am Zuendmagnet) -----------------------------------------
# Periodenmessung + Glitch-Schwelle + adaptive Glaettung. Reine Mathematik;
# die ISR-/Timing-Seite lebt im RPMCounter (sender.py).


def rpm_from_period_us(period_us, ppr):
    """Drehzahl aus dem Flankenabstand (µs) der letzten zwei Hall-Pulse.

    Periodenmessung statt Fensterzaehlung: ein 80-ms-Zaehlfenster hat
    bei 1 Puls/U eine Aufloesung von 750 U/min pro Puls — der Flanken-
    abstand ist dagegen im Leerlauf auf < 1 U/min genau.

    Liefert 0.0 bei nicht-positiven oder nicht-numerischen Eingaben.
    """
    try:
        period_us = float(period_us)
        ppr = float(ppr)
    except (TypeError, ValueError):
        return 0.0
    if not (period_us > 0.0) or not (ppr > 0.0):
        return 0.0  # also maps NaN -> 0.0 (NaN comparisons are always False)
    return 60000000.0 / (period_us * ppr)


def hall_min_period_us(ceiling_rpm, ppr):
    """Glitch-Schwelle fuer die Hall-ISR in µs.

    Flanken, die schneller aufeinander folgen, als es die physikalisch
    moegliche Hoechstdrehzahl (ceiling_rpm) erlaubt, sind Stoerimpulse —
    typisch Zuend-EMI am Magnetschuh oder Prellen — und werden verworfen.

    Liefert die Mindest-Periode als int; 0 = Filter aus (bei ungueltigen
    Eingaben, damit ein Konfig-Fehler nie echte Pulse verwirft).
    """
    try:
        ceiling_rpm = float(ceiling_rpm)
        ppr = float(ppr)
    except (TypeError, ValueError):
        return 0
    if not (ceiling_rpm > 0.0) or not (ppr > 0.0):
        return 0
    return int(60000000.0 / (ceiling_rpm * ppr))


def rpm_ema_step(smooth, raw, alpha, fast_alpha=0.0, fast_delta=0.0):
    """Ein EMA-Glaettungsschritt mit optionalem Schnellpfad.

    Weicht raw um >= fast_delta vom geglaetteten Wert ab (Beschleunigen,
    kurz angetippter Peak), folgt der Filter mit fast_alpha statt alpha —
    so wird die Maximaldrehzahl nicht um Hunderte U/min gekappt, waehrend
    der Leerlauf ruhig bleibt. fast_alpha/fast_delta <= 0 deaktiviert den
    Schnellpfad (klassische EMA).

    Robustheit: ungueltiges raw -> smooth (letzter guter Wert bleibt
    stehen); ungueltiges smooth -> raw; beide ungueltig -> 0.0. alpha
    wird auf 0..1 geklemmt.
    """
    try:
        s = float(smooth)
        if s != s:                 # NaN
            s = None
    except (TypeError, ValueError):
        s = None
    try:
        r = float(raw)
        if r != r:                 # NaN
            r = None
    except (TypeError, ValueError):
        r = None
    if r is None:
        return s if s is not None else 0.0
    if s is None:
        return r
    try:
        a = float(alpha)
    except (TypeError, ValueError):
        a = 0.0
    if not (a == a):               # NaN
        a = 0.0
    a = 0.0 if a < 0.0 else (1.0 if a > 1.0 else a)
    try:
        fa = float(fast_alpha)
        fd = float(fast_delta)
    except (TypeError, ValueError):
        fa = 0.0
        fd = 0.0
    if fa > 0.0 and fd > 0.0 and abs(r - s) >= fd:
        fa = 1.0 if fa > 1.0 else fa
        a = fa if fa > a else a    # Schnellpfad glaettet nie STAERKER
    return a * r + (1.0 - a) * s


# ---- Batterie (LiPo/Li-ion) ------------------------------------------------
# Reine Mathematik fuer die A3-Batterietelemetrie. Die ADC-Rohwerte
# liest sender.py auf dem ESP32; hier nur die testbare Umrechnung.

# SoC-Stuetzpunkte (Zellspannung V -> Ladezustand %), aufsteigend.
_SOC_CURVE = ((3.30, 0.0), (3.50, 15.0), (3.70, 35.0),
              (3.85, 60.0), (4.20, 100.0))


def battery_pack_v(adc_volts, divider, cal):
    """Packspannung = ADC-Spannung * Teiler * Feinkalibrierung.

    Liefert 0.0 bei nicht-positiven (Teiler/cal) oder negativen/
    nicht-numerischen Eingaben. adc_volts == 0.0 -> 0.0 (kein Akku).
    """
    try:
        adc_volts = float(adc_volts)
        divider = float(divider)
        cal = float(cal)
    except (TypeError, ValueError):
        return 0.0
    if not (adc_volts >= 0.0) or not (divider > 0.0) or not (cal > 0.0):
        return 0.0  # NaN-Vergleiche sind immer False -> ebenfalls 0.0
    return adc_volts * divider * cal


def battery_cell_v(vbat, cells):
    """Spannung pro Zelle = Packspannung / Zellenzahl (>= 1).

    Liefert 0.0 bei ungueltiger Zellenzahl oder nicht-numerischen
    Eingaben.
    """
    try:
        vbat = float(vbat)
        cells = int(cells)
    except (TypeError, ValueError):
        return 0.0
    if cells < 1 or not (vbat >= 0.0):
        return 0.0
    return vbat / cells


def battery_soc(vcell):
    """Ladezustand 0..100 (int) aus der Zellspannung.

    Stueckweise lineare Interpolation auf _SOC_CURVE, ausserhalb
    geklemmt. Liefert 0 bei nicht-numerischen Eingaben.
    """
    try:
        v = float(vcell)
    except (TypeError, ValueError):
        return 0
    if not (v == v):          # NaN
        return 0
    if v <= _SOC_CURVE[0][0]:
        return 0
    if v >= _SOC_CURVE[-1][0]:
        return 100
    for i in range(1, len(_SOC_CURVE)):
        v0, p0 = _SOC_CURVE[i - 1]
        v1, p1 = _SOC_CURVE[i]
        if v <= v1:
            t = (v - v0) / (v1 - v0)
            return int(round(p0 + t * (p1 - p0)))
    return 100


def battery_warn(vcell, warn_v, crit_v):
    """0 = ok, 1 = Warnung (vcell <= warn_v), 2 = kritisch
    (vcell <= crit_v). crit_v sollte <= warn_v sein.

    Liefert 0 bei nicht-numerischen Eingaben (kein Fehlalarm).
    """
    try:
        v = float(vcell)
        w = float(warn_v)
        c = float(crit_v)
    except (TypeError, ValueError):
        return 0
    if not (v == v):          # NaN
        return 0
    if v <= c:
        return 2
    if v <= w:
        return 1
    return 0
