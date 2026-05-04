# Kompakter NMEA-0183 Parser für RasiCross
# Nur die Felder die wir tatsaechlich brauchen: lat, lon, speed, fix.
# Schnitt-stelle kompatibel zu micropyGPS (latitude, longitude, speed, fix_stat).
# Auf den Sender-ESP in das Root-Verzeichnis flashen.


class MicropyGPS:
    """Minimaler NMEA-Parser. Verarbeitet $GPRMC und $GPGGA Saetze.

    Schnittstellen-kompatibel zur Original-micropyGPS-Bibliothek
    (inmcm/micropyGPS) für die Felder, die unser Sender liest:
      - latitude   = (deg_decimal, _, hemisphere)
      - longitude  = (deg_decimal, _, hemisphere)
      - speed      = (knots, mph, kmh)
      - fix_stat   = 0|1|2 (kein Fix / 2D / 3D)
    """

    def __init__(self):
        self._buf = []
        self.latitude  = (0.0, 0.0, "N")
        self.longitude = (0.0, 0.0, "E")
        self.speed     = (0.0, 0.0, 0.0)   # knots, mph, kmh
        self.fix_stat  = 0
        self.satellites_in_use = 0
        self.last_sentence = None

    # Charakter-für-Charakter Update — kompatibel zur micropyGPS-API
    def update(self, char):
        if char == "$":
            self._buf = []
        if not isinstance(char, str):
            return None
        self._buf.append(char)
        if char == "\n":
            line = "".join(self._buf).strip()
            self._buf = []
            return self._parse(line)
        # Schutz gegen Überlauf bei kaputten Quellen
        if len(self._buf) > 200:
            self._buf = []
        return None

    # ── interner Parser ───────────────────────────────────────────────────

    def _parse(self, line):
        if not line.startswith("$") or "*" not in line:
            return None
        # Checksum überprüfen
        try:
            payload, cks = line[1:].rsplit("*", 1)
            calc = 0
            for c in payload:
                calc ^= ord(c)
            if calc != int(cks[:2], 16):
                return None
        except Exception:
            return None

        parts = payload.split(",")
        sentence = parts[0]
        self.last_sentence = sentence

        if sentence in ("GPRMC", "GNRMC"):
            self._parse_rmc(parts)
            return sentence
        if sentence in ("GPGGA", "GNGGA"):
            self._parse_gga(parts)
            return sentence
        return None

    def _parse_rmc(self, p):
        """RMC: time, A/V, lat, N/S, lon, E/W, speed_knots, course, date"""
        if len(p) < 10:
            return
        status = p[2]
        if status != "A":
            self.fix_stat = 0
            self.speed = (0.0, 0.0, 0.0)
            return
        if self.fix_stat == 0:
            self.fix_stat = 1
        # Position
        try:
            lat = self._parse_lat(p[3])
            self.latitude = (lat, 0.0, p[4] or "N")
            lon = self._parse_lon(p[5])
            self.longitude = (lon, 0.0, p[6] or "E")
        except Exception:
            pass
        # Speed
        try:
            knots = float(p[7]) if p[7] else 0.0
            mph   = knots * 1.15078
            kmh   = knots * 1.852
            self.speed = (knots, mph, kmh)
        except Exception:
            pass

    def _parse_gga(self, p):
        """GGA: time, lat, N/S, lon, E/W, fix, sats, hdop, alt, ..."""
        if len(p) < 8:
            return
        try:
            fix = int(p[6]) if p[6] else 0
            self.fix_stat = 1 if fix > 0 else 0
            self.satellites_in_use = int(p[7]) if p[7] else 0
        except Exception:
            pass
        try:
            if p[2]:
                self.latitude = (self._parse_lat(p[2]), 0.0, p[3] or "N")
            if p[4]:
                self.longitude = (self._parse_lon(p[4]), 0.0, p[5] or "E")
        except Exception:
            pass

    @staticmethod
    def _parse_lat(s):
        """NMEA lat 'ddmm.mmmm' → Dezimalgrad."""
        if not s:
            return 0.0
        f = float(s)
        d = int(f / 100)
        m = f - d * 100
        return d + m / 60.0

    @staticmethod
    def _parse_lon(s):
        """NMEA lon 'dddmm.mmmm' → Dezimalgrad."""
        if not s:
            return 0.0
        f = float(s)
        d = int(f / 100)
        m = f - d * 100
        return d + m / 60.0
