# ============================================================
#  RasiCross — gps_task.py  (NMEA-GPS via UART, Phase 45)
#  Herausgeloest aus sender.py — NUR bewegt, nicht geaendert.
# ============================================================

import utime
from machine import UART

try:
    from micropyGPS import MicropyGPS
    _HAS_GPS = True
except ImportError:
    _HAS_GPS = False

try:
    import calc
    _HAS_CALC = True
except ImportError:
    _HAS_CALC = False

from config_store import Config, log

class GPS:
    """NMEA-Parser über UART. Liefert speed, lat, lon, fix-status."""

    def __init__(self, rx_pin, tx_pin):
        self._ok     = False
        self._parser = None
        self._uart   = None
        self._last_rx_ms = 0
        if not _HAS_GPS:
            log("init", "GPS: micropyGPS Modul nicht installiert")
            return
        try:
            self._uart   = UART(2, baudrate=9600, rx=rx_pin, tx=tx_pin)
            self._parser = MicropyGPS()
            self._ok     = True
            self._configure_m8n()
            log("init", "GPS: OK")
        except Exception as e:
            log("init", "GPS init fehler:", e)

    def _configure_m8n(self):
        """Phase 37: NEO-M8N auf 5 Hz stellen. Damit 5 Hz in 9600 Baud
        passen, bleiben nur RMC + GGA aktiv (GLL/GSA/GSV/VTG aus). Reine
        UBX-Bytes aus calc.ubx_frame; idempotent bei jedem Boot gesendet,
        daher kein Flash-Save noetig. Ohne calc.py -> Modul bleibt auf 1 Hz."""
        if not _HAS_CALC:
            return
        try:
            # CFG-MSG (0x06 0x01): nicht benoetigte NMEA-Saetze abschalten
            for mid in (0x01, 0x02, 0x03, 0x05):   # GLL, GSA, GSV, VTG -> Rate 0
                self._uart.write(calc.ubx_frame(0x06, 0x01, bytes((0xF0, mid, 0x00))))
                utime.sleep_ms(20)
            for mid in (0x00, 0x04):               # GGA, RMC -> Rate 1 (sicher an)
                self._uart.write(calc.ubx_frame(0x06, 0x01, bytes((0xF0, mid, 0x01))))
                utime.sleep_ms(20)
            # CFG-RATE (0x06 0x08): 200 ms Mess-Intervall = 5 Hz
            self._uart.write(calc.ubx_frame(0x06, 0x08,
                                            bytes((0xC8, 0x00, 0x01, 0x00, 0x01, 0x00))))
            log("init", "GPS: NEO-M8N auf 5 Hz konfiguriert (RMC+GGA)")
        except Exception as e:
            log("init", "GPS-Konfig fehler:", e)

    def update(self):
        if not self._ok:
            return
        try:
            n = self._uart.any()
            if n:
                raw = self._uart.read(min(n, 256))
                if raw:
                    self._last_rx_ms = utime.ticks_ms()
                    for b in raw:
                        try:
                            self._parser.update(chr(b))
                        except Exception:
                            pass
        except Exception:
            pass

    @property
    def fix(self):
        return self._ok and bool(self._parser and self._parser.fix_stat)

    @property
    def speed_kmh(self):
        if not self.fix:
            return 0.0
        try:
            s = self._parser.speed[2]   # km/h
            return round(float(s), 1) if s is not None else 0.0
        except Exception:
            return 0.0

    @property
    def lat(self):
        if not self.fix:
            return 0.0
        try:
            v = float(self._parser.latitude[0])
            return -v if self._parser.latitude[1] == "S" else v
        except Exception:
            return 0.0

    @property
    def lon(self):
        if not self.fix:
            return 0.0
        try:
            v = float(self._parser.longitude[0])
            return -v if self._parser.longitude[1] == "W" else v
        except Exception:
            return 0.0

    @property
    def has_recent_data(self):
        """True wenn UART in den letzten 3 Sekunden NMEA-Bytes gelesen hat."""
        if not self._ok or not self._last_rx_ms:
            return False
        return utime.ticks_diff(utime.ticks_ms(), self._last_rx_ms) < 3000

    @property
    def health(self):
        """'ok' = Fix vorhanden, 'searching' = noch keine NMEA-Daten,
        'lost' = NMEA kommt zwar an, aber kein Fix seit GPS_TIMEOUT_MS,
        'disabled' = Modul nicht installiert."""
        if not self._ok:
            return "disabled"
        if self.fix:
            return "ok"
        if not self._last_rx_ms:
            return "searching"
        if utime.ticks_diff(utime.ticks_ms(), self._last_rx_ms) > Config.GPS_TIMEOUT_MS:
            return "lost"
        return "searching"
