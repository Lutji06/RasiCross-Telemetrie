# ============================================================
#  RasiCross  --  calc.py  (pure speed math)
# ============================================================
#  Keine Importe -> laeuft identisch unter CPython (Unit-Tests /
#  CI) und MicroPython (auf dem Kart-ESP32). Auf den Kart-ESP wie
#  die anderen esp_libs ins Root flashen:
#    mpremote connect <port> cp esp_libs/calc.py :
# ============================================================


def wheel_speed_kmh(pulse_hz, ppr, circ_m):
    """Fahrzeuggeschwindigkeit in km/h aus der Hall-Pulsfrequenz.

    pulse_hz : Hall-Pulse pro Sekunde
    ppr      : Hall-Pulse pro Radumdrehung (>= 1)
    circ_m   : Radumfang in Metern (> 0 aktiviert die Funktion)

    Liefert 0.0 bei nicht-positiven oder nicht-numerischen Eingaben.
    """
    try:
        pulse_hz = float(pulse_hz)
        ppr = float(ppr)
        circ_m = float(circ_m)
    except (TypeError, ValueError):
        return 0.0
    if pulse_hz <= 0.0 or ppr <= 0.0 or circ_m <= 0.0:
        return 0.0
    rev_per_s = pulse_hz / ppr
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
