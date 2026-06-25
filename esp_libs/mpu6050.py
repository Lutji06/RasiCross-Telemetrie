# MicroPython MPU-6050/9250 Driver fuer RasiCross
# Vereinfachte Version, gibt accel als (gx, gy, gz) in g-Einheiten zurueck.
# Auf den Sender-ESP in das Root-Verzeichnis flashen.
#
# Phase 37: Die Karts tragen jetzt den MPU-9250. Accel- und Gyro-Register
# (0x3B/0x43) sowie die Skalierungen (+-2 g, +-250 deg/s) sind register-
# kompatibel zum 6050 -> unveraendert. NUR die Temperatur-Kennlinie ist
# anders (siehe temperature_c). Modul-/Klassenname bleiben, damit Import in
# sender.py und die Flash-Prozedur unangetastet bleiben.

import ustruct

try:
    import calc
    _HAS_CALC = True
except ImportError:
    _HAS_CALC = False


class MPU6050:
    # Register-Adressen
    PWR_MGMT_1   = 0x6B
    ACCEL_CONFIG = 0x1C
    GYRO_CONFIG  = 0x1B
    SMPLRT_DIV   = 0x19
    CONFIG       = 0x1A
    ACCEL_XOUT_H = 0x3B
    GYRO_XOUT_H  = 0x43
    WHO_AM_I     = 0x75
    DEFAULT_ADDR = 0x68

    # Skalierung fuer Beschleunigung +-2g (Standard-Range)
    ACCEL_SCALE_2G = 16384.0
    # Skalierung fuer Gyro +-250 deg/s (Standard-Range, GYRO_CONFIG=0)
    GYRO_SCALE_250 = 131.0

    def __init__(self, i2c, addr=DEFAULT_ADDR):
        self._i2c = i2c
        self._addr = addr
        self._scale = self.ACCEL_SCALE_2G
        # Aufwecken (PWR_MGMT_1 = 0 = nicht-Sleep, internal oscillator)
        self._write_byte(self.PWR_MGMT_1, 0x00)
        # Sample-Rate-Divider: 1 kHz / (1 + 7) = 125 Hz
        self._write_byte(self.SMPLRT_DIV, 0x07)
        # DLPF: 44 Hz Bandbreite (rauschfrei genug fuer Karts)
        self._write_byte(self.CONFIG, 0x03)
        # Accel-Range +- 2g
        self._write_byte(self.ACCEL_CONFIG, 0x00)
        # Gyro-Range +- 250 deg/s (wir nutzen Gyro hier nicht, aber sauber konfiguriert)
        self._write_byte(self.GYRO_CONFIG, 0x00)
        # Verifiziere mit WHO_AM_I (Wert sollte 0x68 sein)
        who = self._read_byte(self.WHO_AM_I)
        if who not in (0x68, 0x70, 0x71, 0x72, 0x73, 0x98):  # 0x68 = MPU6050, andere = Klone
            raise OSError("MPU6050 nicht gefunden (WHO_AM_I=0x{:02X})".format(who))

    def _write_byte(self, reg, val):
        self._i2c.writeto_mem(self._addr, reg, bytes([val]))

    def _read_byte(self, reg):
        return self._i2c.readfrom_mem(self._addr, reg, 1)[0]

    def _read_word_signed(self, reg):
        data = self._i2c.readfrom_mem(self._addr, reg, 2)
        # Big-endian, signed
        v = (data[0] << 8) | data[1]
        if v >= 0x8000:
            v = -((65535 - v) + 1)
        return v

    @property
    def accel(self):
        """Liefert (ax, ay, az) in g-Einheiten."""
        # Sechs Bytes auf einmal lesen ist effizienter
        data = self._i2c.readfrom_mem(self._addr, self.ACCEL_XOUT_H, 6)
        ax = ustruct.unpack(">h", data[0:2])[0] / self._scale
        ay = ustruct.unpack(">h", data[2:4])[0] / self._scale
        az = ustruct.unpack(">h", data[4:6])[0] / self._scale
        return (ax, ay, az)

    @property
    def gyro(self):
        """Liefert (gx, gy, gz) in Grad/Sekunde (Range +-250 deg/s)."""
        # Identisches Schema wie accel: 6 Bytes, big-endian signed.
        data = self._i2c.readfrom_mem(self._addr, self.GYRO_XOUT_H, 6)
        gx = ustruct.unpack(">h", data[0:2])[0] / self.GYRO_SCALE_250
        gy = ustruct.unpack(">h", data[2:4])[0] / self.GYRO_SCALE_250
        gz = ustruct.unpack(">h", data[4:6])[0] / self.GYRO_SCALE_250
        return (gx, gy, gz)

    @property
    def temperature_c(self):
        """Chip-Temperatur in Grad Celsius (MPU-9250-Kennlinie).

        Pure Umrechnung liegt in calc.mpu9250_temp_c (getestet); der
        Inline-Fallback muss damit identisch bleiben."""
        raw = self._read_word_signed(0x41)
        if _HAS_CALC:
            return calc.mpu9250_temp_c(raw)
        return raw / 333.87 + 21.0
