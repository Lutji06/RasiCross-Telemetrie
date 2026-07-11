# ============================================================
#  RasiCross — imu_task.py  (MPU-6050 IMU, Phase 45)
#  Herausgeloest aus sender.py — NUR bewegt, nicht geaendert.
# ============================================================

import utime

try:
    import mpu6050
    _HAS_MPU = True
except ImportError:
    _HAS_MPU = False

from config_store import Config, log

class IMU:
    """MPU-6050 Beschleunigungs-Sensor. Liefert geglättete Gx, Gy.
    Bei Init-Fehler oder fehlendem Modul werden 0.0 zurückgegeben.

    Kalibrierung: durch start_calibration() werden ueber duration_ms
    Samples gesammelt und der Mittelwert als Null-Offset gespeichert.
    Das laeuft non-blocking innerhalb der normalen update()-Aufrufe -
    waehrend der Kalibrierung muss der Kart still stehen."""

    def __init__(self, i2c):
        self._ok  = False
        self._gx  = 0.0
        self._gy  = 0.0
        self._az  = 0.0          # geglaettetes Accel-Z (g)
        self._yaw = 0.0          # geglaettete Gier-Rate = Gyro-Z (deg/s)
        self._roll = 0.0         # geglaettete Roll-Rate = Gyro-X (deg/s)
        self._mpu = None
        self._fail_count = 0
        # Kalibrier-Offsets (in g)
        self._off_x = 0.0
        self._off_y = 0.0
        # Non-blocking Kalibrierungs-Zustand
        self._cal_active = False
        self._cal_until = 0
        self._cal_sum_x = 0.0
        self._cal_sum_y = 0.0
        self._cal_n = 0
        if not _HAS_MPU:
            log("init", "IMU: mpu6050 Modul nicht installiert")
            return
        try:
            self._mpu = mpu6050.MPU6050(i2c)
            self._ok  = True
            log("init", "IMU: OK")
        except Exception as e:
            log("init", "IMU init fehler:", e)

    def update(self, alpha=None):
        if alpha is None:
            alpha = Config.G_ALPHA
        if not self._ok:
            return (0.0, 0.0)
        try:
            ax, ay, az = self._mpu.accel
            gxr, _gyr, gzr = self._mpu.gyro       # X (= Roll) + Z (= Gier) genutzt
            # Accel-Z + Gier mit demselben EMA wie gx/gy glaetten
            # (keine Kalibrier-Offsets: nur die Lehne-Achsen werden genullt).
            self._az  = alpha * az  + (1 - alpha) * self._az
            self._yaw = alpha * gzr + (1 - alpha) * self._yaw
            self._roll = alpha * gxr + (1 - alpha) * self._roll
            # Kalibrierung: rohe Samples mitteln, bis Zeit abgelaufen
            if self._cal_active:
                self._cal_sum_x += ax
                self._cal_sum_y += ay
                self._cal_n    += 1
                if utime.ticks_diff(self._cal_until, utime.ticks_ms()) <= 0:
                    if self._cal_n > 5:
                        self._off_x = self._cal_sum_x / self._cal_n
                        self._off_y = self._cal_sum_y / self._cal_n
                        log("config", "IMU kalibriert: off_x={:.3f} off_y={:.3f} (n={})".format(
                            self._off_x, self._off_y, self._cal_n))
                    else:
                        log("config", "IMU-Kalibrierung abgebrochen: zu wenige Samples")
                    self._cal_active = False
            # Offset abziehen, dann glaetten
            ax -= self._off_x
            ay -= self._off_y
            self._gx = alpha * ax + (1 - alpha) * self._gx
            self._gy = alpha * ay + (1 - alpha) * self._gy
            self._fail_count = 0
        except Exception as e:
            self._fail_count += 1
            if self._fail_count == 10:
                log("imu", "wiederholte Lesefehler:", e)
        return (self._gx, self._gy)

    def start_calibration(self, duration_ms=2000):
        """Startet eine Null-Punkt-Kalibrierung. Kart muss waehrenddessen
        ruhig stehen. Dauert duration_ms Millisekunden non-blocking."""
        if not self._ok:
            return False
        self._cal_active = True
        self._cal_until = utime.ticks_add(utime.ticks_ms(), int(duration_ms))
        self._cal_sum_x = 0.0
        self._cal_sum_y = 0.0
        self._cal_n     = 0
        return True

    def reset_calibration(self):
        """Setzt die Offsets auf 0 zurueck."""
        self._off_x = 0.0
        self._off_y = 0.0
        self._cal_active = False

    def set_offsets(self, ox, oy):
        """Setzt gespeicherte Null-Offsets direkt (z.B. aus NVS geladen)."""
        try:
            self._off_x = float(ox)
            self._off_y = float(oy)
        except (TypeError, ValueError):
            pass

    @property
    def calibrating(self):
        return self._cal_active

    @property
    def offsets(self):
        return (self._off_x, self._off_y)

    @property
    def ok(self):  return self._ok

    @property
    def az(self):   return self._az

    @property
    def yaw(self):  return self._yaw

    @property
    def roll(self): return self._roll

    @property
    def mpu_temp(self):
        """Chip-Temperatur in ganzen Grad C, oder None wenn nicht
        verfuegbar. Wird in jedem Telemetrie-Paket abgefragt (eine
        I2C-Transaktion pro Paket, seit dem Binaer-Frame ohne Slow-Kadenz)."""
        if not self._ok:
            return None
        try:
            return int(round(self._mpu.temperature_c))
        except Exception:
            return None
