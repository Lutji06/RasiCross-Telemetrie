# ============================================================
#  RasiCross  --  KART ESP32 SENDER  v9.6
# ============================================================
#  Rolle:    Mäher-seitiger ESP. Sammelt Sensordaten und sendet
#            sie via ESP-NOW an die Bridge (Boxengasse).
#
#  Sensoren: Hall (RPM), MPU-6050 (Gx,Gy), GPS (NMEA),
#            SSD1306 OLED (5 Seiten + Pit-Call Override).
#
#  Pins (Standard, im Config-Block änderbar):
#    Hall      → GPIO 34   (INPUT, PULL-UP, falling-edge IRQ)
#    MPU-6050  → I2C  SDA=21  SCL=22
#    GPS       → UART2  RX=16  TX=17  (9600 Baud)
#    OLED      → I2C  SDA=21  SCL=22  (Adresse 0x3C)
#    Status-LED→ GPIO 2 (onboard)
#
#  Was ist neu vs. v8:
#    • Saubere Trennung: Sensors / Display / Link / App
#    • Display-Pages als Funktionen registriert (statt if/elif)
#    • Robuster ESP-NOW Send (Retry + Backoff)
#    • Auto-Pairing: Bridge-MAC kann durch Bridge-Hello gelernt
#      werden, Hardcoding optional
#    • Heartbeat-Counter im Sender (Bridge erkennt Hänger)
#    • Konfiguration vollständig live durch das Dashboard änderbar
#    • Status-LED zeigt: aus=offline, blink=GPS sucht, ein=alles ok
#    • Debug-Output strukturiert (level + topic)
# ============================================================

import network
import espnow
import ujson
import utime
import ubinascii
import framebuf
from machine import Pin, I2C, UART, WDT, reset, disable_irq, enable_irq, ADC

# Optionale Module — Programm läuft auch ohne, mit reduzierter Funktion
try:
    import mpu6050
    _HAS_MPU = True
except ImportError:
    _HAS_MPU = False

try:
    import ssd1306
    _HAS_OLED = True
except ImportError:
    _HAS_OLED = False

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


# ── Konfiguration ─────────────────────────────────────────────────────────

class Config:
    # ESP-NOW
    # Bridge-MAC wird zur Laufzeit ueber das bridge_hello-Paket gelernt.
    # Wer die Pairing-Phase ueberspringen will, kann hier optional die
    # MAC der eigenen Bridge eintragen, z.B.:
    #   BRIDGE_MAC = ubinascii.unhexlify("aabbccddeeff")
    # Default = leer -> immer Auto-Pairing.
    BRIDGE_MAC = b""
    ESPNOW_CHANNEL  = 1                              # muss bei beiden gleich

    # Pins
    # Wichtig: NICHT GPIO 34/35/36/39 nehmen - das sind Input-only-Pins
    # OHNE interne Pull-Up-Widerstaende. Der A3144 Hall-Sensor ist
    # open-collector und braucht zwingend einen Pull-Up. Mit GPIO 4
    # liefert der ESP32 den Pull-Up intern. Wer GPIO 34 nutzen will,
    # muss einen externen 10 kOhm-Widerstand von dort nach 3.3 V loeten.
    HALL_PIN        = 4
    GPS_RX_PIN      = 17
    GPS_TX_PIN      = 16
    I2C_SDA         = 21
    I2C_SCL         = 22
    LED_PIN         = 2          # onboard Status-LED

    # Hall-Sensor
    PULSES_PER_REV  = 1          # Pulse pro Radumdrehung
    WHEEL_CIRC_M    = 0.0        # Radumfang in Meter (0 = GPS-Speed nutzen)

    # Batterie (A3) — None = Feature aus. NUR ADC1-Pins (GPIO 32-39);
    # ADC2 ist bei aktivem WiFi/ESP-NOW gesperrt!
    BATT_ADC_PIN    = None       # z.B. 34. None -> Battery-Klasse inert
    BATT_DIVIDER    = 11.0       # externer Teiler Vin/Vadc (z.B. 100k/10k)
    BATT_CELLS      = 3          # Zellen in Serie (Per-Cell + SoC)
    BATT_CAL        = 1.0        # Feinkalibrierung (Multiplikator)
    BATT_CELL_WARN  = 3.5        # Warn-Schwelle pro Zelle (V)
    BATT_CELL_CRIT  = 3.3        # Kritisch-Schwelle pro Zelle (V)

    # Langsame Felder (vbat/soc/...) nur jedes N-te Paket senden
    SLOW_FIELD_EVERY = 8         # ~1 Hz bei 12.5 Hz Basisrate

    # Timing (alle Werte in ms)
    SEND_MS         = 80         # Telemetrie-Intervall (12.5 Hz)
    SEND_MS_DEGRADED = 200       # Bei schlechter Funkverbindung -> langsamere Rate (5 Hz)
    SEND_FAIL_THRESHOLD = 10     # Ab so vielen TX-Fehlern in Folge: degraded mode
    OLED_MS         = 120        # Display-Refresh
    PAGE_MS         = 4000       # Auto-Seitenwechsel
    BLINK_MS        = 150        # Shift-Light Blink
    LED_BLINK_MS    = 500        # Status-LED Blink (GPS sucht)

    # GPS-Health
    GPS_TIMEOUT_MS  = 10000      # Nach so vielen ms ohne validen Fix -> als verloren melden

    # Drehzahl-Grenzen
    MAX_RPM         = 6000       # Shift-Light Schwelle
    RPM_WARN        = 5500       # Vorwarnung

    # Filter (0=keine Glättung, 1=eingefroren)
    RPM_ALPHA       = 0.25
    G_ALPHA         = 0.30

    # Sicherheit
    WATCHDOG_MS     = 8000       # 0 = WDT aus
    SEND_RETRY      = 2          # ESP-NOW Wiederholungen bei Fehler

    # Funk: ESP-NOW laeuft im reinen Long-Range-Modus (250 kbit/s, max Reichweite)
    # WICHTIG: Bridge muss auch im LR-Mode laufen — sonst keine Verbindung!
    WIFI_TX_POWER_DBM = 20       # Sendeleistung in dBm (20 = EU-Max bei 100 mW)

    # Debug
    DEBUG           = False
    DEBUG_TOPICS    = ("init", "config", "pit_call", "display", "recv")  # Filter wenn DEBUG=False


def log(topic, *args):
    """Strukturiertes Logging. Druckt nur, wenn DEBUG aktiv ODER Topic in DEBUG_TOPICS."""
    if Config.DEBUG or topic in Config.DEBUG_TOPICS:
        print("[{}]".format(topic), *args)


# ── RPM-Zähler ────────────────────────────────────────────────────────────

class RPMCounter:
    """Zählt Hall-Pulse via IRQ. Berechnet RPM mit exponentieller Glättung."""

    def __init__(self, pin_nr, pulses_per_rev=1):
        self._count        = 0
        self._ppr          = max(1, pulses_per_rev)
        self._last_calc_ms = utime.ticks_ms()
        self._rpm_raw      = 0.0
        self._rpm_smooth   = 0.0
        self._pulse_hz_raw = 0.0
        self._total_pulses = 0
        self._pin = Pin(pin_nr, Pin.IN, Pin.PULL_UP)
        self._pin.irq(trigger=Pin.IRQ_FALLING, handler=self._isr)

    def _isr(self, _p):
        self._count += 1

    def update(self, alpha=None):
        """Sollte regelmäßig (alle 50ms+) aufgerufen werden.
        Liefert geglättete RPM zurück."""
        if alpha is None:
            alpha = Config.RPM_ALPHA
        now = utime.ticks_ms()
        dt  = utime.ticks_diff(now, self._last_calc_ms)
        if dt < 50:
            return self._rpm_smooth

        # Atomarer Read+Reset: ein Hall-IRQ zwischen Lesen und
        # Nullsetzen wuerde sonst einen Puls verschlucken (RPM
        # systematisch zu niedrig bei hoher Pulsrate).
        _irq = disable_irq()
        cnt = self._count
        self._count = 0
        enable_irq(_irq)
        self._total_pulses += cnt
        self._last_calc_ms = now

        if dt > 0 and cnt > 0:
            self._pulse_hz_raw = cnt / (dt / 1000.0)
            self._rpm_raw = (self._pulse_hz_raw / self._ppr) * 60.0
        elif dt > 500:
            # Lange kein Puls → Stillstand
            self._rpm_raw = 0.0
            self._pulse_hz_raw = 0.0

        self._rpm_smooth = alpha * self._rpm_raw + (1 - alpha) * self._rpm_smooth
        return self._rpm_smooth

    def set_ppr(self, ppr):
        self._ppr = max(1, int(ppr))

    @property
    def rpm(self):           return self._rpm_smooth

    @property
    def pulse_hz(self):      return self._pulse_hz_raw

    @property
    def ppr(self):           return self._ppr

    @property
    def total_pulses(self):  return self._total_pulses


# ── Batterie (A3) ─────────────────────────────────────────────────────────

class Battery:
    """Optionale Akku-Telemetrie ueber einen ADC1-Pin.

    Inert, wenn Config.BATT_ADC_PIN None ist ODER calc.py fehlt:
    .active == False, alle Werte 0/None, sender.py sendet dann keine
    Batteriefelder. Die reine Umrechnung liegt in calc.py (getestet);
    diese Klasse macht nur ADC-IO + Mittelung.
    """

    _SAMPLES = 16

    def __init__(self):
        self._adc = None
        self._vbat = 0.0
        self._soc = 0
        self._warn = 0
        pin = Config.BATT_ADC_PIN
        if pin is None or not _HAS_CALC:
            return
        try:
            self._adc = ADC(Pin(pin))
            # 11 dB Daempfung -> ~0..3.3 V nutzbar
            self._adc.atten(ADC.ATTN_11DB)
        except Exception as e:               # noqa: BLE001
            log("init", "Battery ADC init fehlgeschlagen:", e)
            self._adc = None

    @property
    def active(self):
        return self._adc is not None

    def read(self):
        """Misst und aktualisiert vbat/soc/warn. No-op wenn inert."""
        if self._adc is None:
            return
        acc = 0
        for _ in range(self._SAMPLES):
            acc += self._adc.read_uv()       # kalibrierte Mikrovolt
        adc_volts = (acc / self._SAMPLES) / 1_000_000.0
        self._vbat = calc.battery_pack_v(adc_volts,
                                         Config.BATT_DIVIDER,
                                         Config.BATT_CAL)
        vcell = calc.battery_cell_v(self._vbat, Config.BATT_CELLS)
        self._soc = calc.battery_soc(vcell)
        self._warn = calc.battery_warn(vcell,
                                       Config.BATT_CELL_WARN,
                                       Config.BATT_CELL_CRIT)

    @property
    def vbat(self):   return self._vbat

    @property
    def soc(self):    return self._soc

    @property
    def warn(self):   return self._warn


# ── IMU (MPU-6050) ────────────────────────────────────────────────────────

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
            _gxr, _gyr, gzr = self._mpu.gyro      # nur Z (= Gier) genutzt
            # Accel-Z + Gier mit demselben EMA wie gx/gy glaetten
            # (keine Kalibrier-Offsets: nur die Lehne-Achsen werden genullt).
            self._az  = alpha * az  + (1 - alpha) * self._az
            self._yaw = alpha * gzr + (1 - alpha) * self._yaw
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
    def mpu_temp(self):
        """Chip-Temperatur in ganzen Grad C, oder None wenn nicht
        verfuegbar. Wird nur auf Slow-Paketen abgefragt."""
        if not self._ok:
            return None
        try:
            return int(round(self._mpu.temperature_c))
        except Exception:
            return None


# ── GPS ───────────────────────────────────────────────────────────────────

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
            log("init", "GPS: OK")
        except Exception as e:
            log("init", "GPS init fehler:", e)

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


# ── OLED-Display ──────────────────────────────────────────────────────────

class Display:
    """SSD1306 128x64. Zeigt 5 Seiten im Wechsel + Override für Shift/Pit-Call.

    Pages werden als (name, draw_function) registriert. Eine Page-Funktion
    bekommt die aktuellen Daten als ctx-Dict übergeben."""

    def __init__(self, i2c):
        self._ok   = False
        self._oled = None
        self._page_idx   = 0
        self._page_count = 0
        self._pages      = []
        self._last_page_change = utime.ticks_ms()
        # Wenn Dashboard eine bestimmte Seite vorgibt: Name (sonst None = Auto)
        self._forced_page_name = None
        self._page_names = []      # parallele Liste der Namen fuer Lookup
        self._last_draw  = utime.ticks_ms()
        self._blink_on   = False
        self._last_blink = utime.ticks_ms()

        # Pit-Call Override
        self._pit_active  = False
        self._pit_until   = 0
        self._pit_message = "PIT STOP"

        if not _HAS_OLED:
            log("init", "OLED: ssd1306 Modul nicht installiert")
            return
        try:
            self._oled = ssd1306.SSD1306_I2C(128, 64, i2c)
            self._ok   = True
            self._show_boot()
            log("init", "OLED: OK")
        except Exception as e:
            log("init", "OLED init fehler:", e)

    # ── Public API ────────────────────────────────────────────────────────

    def register_page(self, name, draw_fn):
        """Registriert eine Anzeige-Seite.
        draw_fn(oled, ctx) bekommt das oled-Objekt und ein dict mit Daten."""
        self._pages.append((name, draw_fn))
        self._page_names.append(name)
        self._page_count = len(self._pages)

    def set_forced_page(self, name):
        """Setzt die fest angezeigte Seite. None oder 'auto' = Auto-Wechsel."""
        if name in (None, "auto", ""):
            if self._forced_page_name is not None:
                # Beim Wechsel zurueck auf Auto: Timer reset, damit nicht sofort wechselt
                self._last_page_change = utime.ticks_ms()
            self._forced_page_name = None
            return
        # Existiert die Seite ueberhaupt?
        if name in self._page_names:
            if self._forced_page_name != name:
                self._forced_page_name = name
                # Sofort umschalten
                self._page_idx = self._page_names.index(name)

    def update(self, ctx):
        """Hauptmethode. ctx enthält alle Live-Daten:
        speed, rpm, gx, gy, gps_fix, tx_ok, race_data."""
        if not self._ok:
            return
        now = utime.ticks_ms()

        # Auto-Pagewechsel — nur wenn vom Dashboard nicht festgelegt
        if self._forced_page_name is None:
            if utime.ticks_diff(now, self._last_page_change) > Config.PAGE_MS:
                self._page_idx = (self._page_idx + 1) % max(1, self._page_count)
                self._last_page_change = now

        # Blink-Takt
        if utime.ticks_diff(now, self._last_blink) > Config.BLINK_MS:
            self._blink_on = not self._blink_on
            self._last_blink = now

        # Refresh-Throttle
        if utime.ticks_diff(now, self._last_draw) < Config.OLED_MS:
            return
        self._last_draw = now

        # Pit-Call ausgelaufen?
        if self._pit_active and utime.ticks_diff(now, self._pit_until) > 0:
            self._pit_active = False

        o = self._oled
        o.fill(0)

        # Override: Pit-Call (höchste Priorität)
        if self._pit_active:
            self._draw_pit_call()
            o.show()
            return

        # Override: Shift-Alarm (zweithöchste)
        if ctx.get("rpm", 0) >= Config.MAX_RPM and self._blink_on:
            self._draw_shift(ctx)
            o.show()
            return

        # Normale Page-Rotation
        self._draw_statusbar(ctx)
        if self._page_count > 0:
            _name, fn = self._pages[self._page_idx]
            try:
                fn(o, ctx)
            except Exception as e:
                o.text("Page-Error", 24, 32, 1)
                log("display", "page-fehler:", e)
        o.show()

    def trigger_pit_call(self, message=None, duration_ms=15000):
        self._pit_active = True
        self._pit_until = utime.ticks_add(utime.ticks_ms(), duration_ms)
        self._pit_message = (message or "PIT STOP")[:14]
        log("pit_call", "Display-Override aktiviert:", self._pit_message)

    def cancel_pit_call(self):
        self._pit_active = False

    def big_text(self, text, x, y, scale=2, color=1):
        """Pixel-vergrößerter Text (Helper für Pages).
        color=1 zeichnet weiße Pixel auf schwarzem Grund (Standard),
        color=0 zeichnet schwarze Pixel auf weißem Grund (z.B. Shift-Alarm)."""
        w = 8 * len(text)
        fb = framebuf.FrameBuffer(bytearray(w * 8), w, 8, framebuf.MONO_VLSB)
        fb.text(text, 0, 0, 1)
        for i in range(w):
            for j in range(8):
                if fb.pixel(i, j):
                    self._oled.fill_rect(x + i * scale, y + j * scale,
                                         scale, scale, color)

    # ── Interne Zeichen-Methoden ──────────────────────────────────────────

    def _show_boot(self):
        o = self._oled
        o.fill(0)
        o.text("RasiCross v9", 16, 8, 1)
        o.text("Kart-Sender", 20, 24, 1)
        o.text("Init...", 36, 44, 1)
        o.show()

    def _draw_statusbar(self, ctx):
        """Top-Zeile: Page-Indikatoren, GPS, TX-Status."""
        o = self._oled
        # Page-Tabs - aktive Seite hat einen Punkt obendrueber wenn manuell gesperrt
        for i in range(min(self._page_count, 6)):
            x = 2 + i * 10
            if i == self._page_idx:
                o.fill_rect(x, 1, 7, 7, 1)
                # Sperr-Indikator: kleiner Pfeil/Punkt UNTER der Tab
                if self._forced_page_name is not None:
                    o.fill_rect(x + 2, 0, 3, 1, 0)  # Luecke oben = "gesperrt"
            else:
                o.rect(x, 1, 7, 7, 1)
        # GPS-Indikator
        o.text("G" if ctx.get("gps_fix") else "g", 80, 0, 1)
        # TX-Indikator
        o.text("T" if ctx.get("tx_ok")  else "t", 96, 0, 1)
        # Heartbeat-Punkt rechts blinkend
        if self._blink_on:
            o.fill_rect(116, 1, 6, 6, 1)
        o.hline(0, 9, 128, 1)

    def _draw_shift(self, ctx):
        """Release-Throttle Alarm: voll invertiert, 'Release Throttle' gross
        + RPM + km/h. Wird ausgeloest wenn rpm >= MAX_RPM."""
        o = self._oled
        o.fill(1)
        # Voll-invertierter Hintergrund -> Text in Farbe 0 (schwarz auf weiss)
        # Zeile 1: "RELEASE" (8*7=56 px breit, 2x = 112 -> passt)
        self.big_text("RELEASE", 8, 4, 2, 0)
        # Zeile 2: "THROTTLE" (8*8=64 px, 2x = 128 -> passt genau)
        self.big_text("THROTTLE", 0, 22, 2, 0)
        # RPM und km/h klein darunter
        o.text("{:5d} rpm".format(int(ctx.get("rpm", 0))), 16, 44, 0)
        o.text("{:3d} km/h".format(int(ctx.get("speed", 0))), 24, 54, 0)

    def _draw_pit_call(self):
        """Boxenruf - blinkendes Vollbild, nur 'PIT STOP' gross zentriert."""
        o = self._oled
        if self._blink_on:
            # Voll invertiert (weisser Hintergrund)
            o.fill(1)
            # "PIT STOP" gross zentriert (8 Zeichen * 8 px = 64 -> *2 = 128)
            # Wir nehmen 2x Skalierung damit es sehr auffaellig ist.
            self._draw_big_centered("PIT STOP", 24, 2, color=0)
        else:
            # Schwarz mit doppeltem Rahmen
            o.fill(0)
            o.rect(0, 0, 128, 64, 1)
            o.rect(2, 2, 124, 60, 1)
            self._draw_big_centered("PIT STOP", 24, 2, color=1)

    def _draw_big_centered(self, text, y, scale=2, color=1):
        """Zeichnet vergroesserten Text horizontal zentriert."""
        text_w = 8 * scale * len(text)
        x = max(0, (128 - text_w) // 2)
        # Mit eigener big-text Routine (kann color uebergeben werden)
        import framebuf
        w = 8 * len(text)
        fb = framebuf.FrameBuffer(bytearray(w * 8), w, 8, framebuf.MONO_VLSB)
        fb.text(text, 0, 0, 1)
        for i in range(w):
            for j in range(8):
                if fb.pixel(i, j):
                    self._oled.fill_rect(x + i * scale, y + j * scale,
                                         scale, scale, color)


# ── Display-Pages ─────────────────────────────────────────────────────────
# Eigene Funktionen statt Methoden in Display — leichter erweiterbar.



def _fmt_clock_ms(ms):
    """Formatiert Millisekunden als MM:SS - kompakt fuer OLED."""
    if ms is None or ms < 0:
        return "--:--"
    s = ms // 1000
    return "{:02d}:{:02d}".format(s // 60, s % 60)

def _draw_sector_bar(o, race, y=11, h=6):
    """Zeichnet 3 Sektor-Segmente nebeneinander unter der Statusleiste.
    State pro Sektor: 'open'=Rahmen, 'done'=gefuellt, 'current'=gefuellt."""
    sectors = race.get("sectors") if race else None
    # 3 Segmente zentriert: 38px breit + 7px Gap = 38+7+38+7+38 = 128
    seg_w = 38
    gap = 7
    for i in range(3):
        x = i * (seg_w + gap)
        if not sectors:
            o.rect(x, y, seg_w, h, 1)
            continue
        s = sectors[i] if i < len(sectors) else "open"
        if s == "done" or s == "current":
            o.fill_rect(x, y, seg_w, h, 1)
        else:
            o.rect(x, y, seg_w, h, 1)


def page_speed(o, ctx):
    """Seite 1: Nur Speed gross zentral + RPM-Bar darunter."""
    speed = ctx.get("speed", 0)
    rpm = ctx.get("rpm", 0)
    # Speed riesig zentriert (3-stellig, 4x skaliert)
    ctx["display"].big_text("{:3d}".format(int(speed)), 16, 16, 4)
    # RPM-Bar unten
    fill = int(min(1.0, rpm / Config.MAX_RPM) * 124)
    o.rect(0, 54, 128, 8, 1)
    if fill > 2:
        o.fill_rect(2, 56, fill - 4, 4, 1)


def page_race(o, ctx):
    """Seite 2: Sektor-Segmente oben + Rundenzeit gross."""
    race = ctx.get("race_data")
    if not race:
        o.text("Kein Rennen", 10, 30, 1)
        return
    # Sektor-Segmente oben
    _draw_sector_bar(o, race, y=12, h=6)
    # Rundenzeit gross zentriert (2x skaliert)
    lap = str(race.get("lap", "--:--.---"))[:9]
    ctx["display"].big_text(lap, 0, 30, 2)
    # Runden-Counter klein unten
    rnd = "R{}/{}".format(race.get("lapn", "?"), race.get("target", "?"))
    o.text(rnd[:8], 0, 54, 1)


def page_rpm(o, ctx):
    """Seite 3: Drehzahl gross + Segment-Bar + Warnung bei Hoch-RPM."""
    rpm = ctx.get("rpm", 0)
    # RPM-Zahl gross zentriert
    ctx["display"].big_text("{:5d}".format(int(rpm)), 12, 14, 2)
    # Segment-Bar
    segs, sw = 8, 14
    filled = int(min(segs, rpm / Config.MAX_RPM * segs))
    for i in range(segs):
        x = i * (sw + 2)
        if i < filled:
            o.fill_rect(x, 38, sw, 10, 1)
        else:
            o.rect(x, 38, sw, 10, 1)
    # Warnung nur wenn relevant
    if rpm >= Config.MAX_RPM:
        o.text("RELEASE THRTL", 12, 54, 1)
    elif rpm >= Config.RPM_WARN:
        o.text("Release Thrtl", 12, 54, 1)


def page_diag(o, ctx):
    """Seite 5: Diagnose - GPS/TX (1 Zeile) / SPD / RPM / BAT."""
    g = "OK" if ctx.get("gps_fix") else "--"
    t = "OK" if ctx.get("tx_ok") else "--"
    o.text("GPS {}  TX {}".format(g, t), 0, 16, 1)
    o.text("SPD {:5.1f}".format(ctx.get("speed", 0)), 0, 28, 1)
    o.text("RPM {:5d}".format(int(ctx.get("rpm", 0))), 0, 40, 1)
    vbat = ctx.get("vbat")
    if vbat is not None:
        o.text("BAT {:4.1f}V".format(vbat), 0, 52, 1)


def page_delta(o, ctx):
    """Seite 4: Live-Delta gross zentral. Sonst nichts."""
    race = ctx.get("race_data")
    if not race:
        o.text("DELTA", 44, 16, 1)
        o.text("Kein Rennen", 24, 36, 1)
        return
    live = race.get("live_delta", "--")
    live_ms = race.get("live_delta_ms")
    if live == "--" or live_ms is None:
        o.text("DELTA", 44, 16, 1)
        o.text("Warte...", 32, 36, 1)
        return
    # Delta gross zentriert (2x skaliert)
    ctx["display"].big_text(str(live)[:8], 0, 28, 2)


# ── ESP-NOW Link ──────────────────────────────────────────────────────────

class ESPNowLink:
    """Wickelt ESP-NOW Senden und Empfangen ab.
       send(data)  -> True wenn das Paket erfolgreich an die Bridge ging
       recv()      -> (kind, data) Tupel oder None wenn nichts wartet
       mac         -> eigene MAC als String (zum Loggen)
       tx_fail_run -> Anzahl aufeinanderfolgender Sende-Fehler"""

    def __init__(self, bridge_mac):
        # WiFi muss aktiv sein bevor ESP-NOW initialisiert werden kann
        self._sta = network.WLAN(network.STA_IF)
        self._sta.active(True)
        try:
            self._sta.disconnect()
        except Exception:
            pass

        # Reiner Long-Range-Modus: WIFI_PROTOCOL_LR (8) ohne 11b/g/n.
        # Maximale Reichweite, ~250 kbit/s, immun gegen normalen WLAN-Verkehr.
        try:
            self._sta.config(protocol=8)
            log("init", "Long-Range-Modus aktiv (LR-only)")
        except Exception as e:
            log("init", "WARNUNG: LR-Mode nicht setzbar:", e)

        try:
            self._sta.config(channel=Config.ESPNOW_CHANNEL)
        except Exception:
            pass

        # Maximale Sendeleistung (20 dBm = 100 mW, gesetzliches EU-Maximum)
        try:
            self._sta.config(txpower=Config.WIFI_TX_POWER_DBM)
            log("init", "TX-Power:", Config.WIFI_TX_POWER_DBM, "dBm")
        except Exception:
            pass

        self._esp = espnow.ESPNow()
        self._esp.active(True)

        # ESP-NOW PHY-Rate auf Long-Range stellen
        try:
            self._esp.config(rate=8)  # WIFI_PHY_RATE_LORA_500K
        except Exception:
            pass

        self._bridge_mac = bridge_mac
        self._mac_str = ubinascii.hexlify(self._sta.config("mac"), ":").decode()

        # Bridge als Peer registrieren — falls schon bekannt
        if bridge_mac:
            try:
                self._esp.add_peer(bridge_mac)
                log("init", "Bridge-Peer registriert:",
                    ubinascii.hexlify(bridge_mac, ":").decode())
            except Exception as e:
                # Schon registriert oder ungültig — nicht kritisch
                log("init", "add_peer Hinweis:", e)

        self._seq = 0
        self.tx_fail_run = 0

    @property
    def mac(self):
        return self._mac_str

    def send(self, data):
        """Schickt data als JSON an die Bridge. Mit Retry."""
        if not self._bridge_mac:
            return False
        # Sequenznummer einbauen damit Bridge Paket-Verlust messen kann
        data["seq"] = self._seq
        self._seq = (self._seq + 1) & 0xFFFF
        payload = ujson.dumps(data)

        for attempt in range(Config.SEND_RETRY + 1):
            try:
                ok = self._esp.send(self._bridge_mac, payload, True)
                if ok:
                    self.tx_fail_run = 0
                    return True
            except Exception as e:
                if attempt == 0:
                    log("link", "send fehler:", e)
            utime.sleep_ms(5)

        self.tx_fail_run += 1
        return False

    def recv(self):
        """Liest ein eingehendes Paket. Gibt (kind, data) zurueck oder None."""
        try:
            host, msg = self._esp.recv(0)
        except Exception:
            return None
        if not msg:
            return None
        try:
            data = ujson.loads(msg)
        except Exception:
            return None
        # Wenn die Bridge sich meldet und wir noch keine MAC kannten -> lernen
        kind = data.get("type", "unknown")
        log("recv", "Paket:", kind)
        if kind == "bridge_hello" and host:
            if not self._bridge_mac or self._bridge_mac != host:
                self._bridge_mac = host
                try:
                    self._esp.add_peer(host)
                    log("config", "Bridge-MAC gelernt:",
                        ubinascii.hexlify(host, ":").decode())
                except Exception:
                    pass
        return (kind, data)


# ── Status-LED ────────────────────────────────────────────────────────────

class StatusLED:
    """Onboard-LED auf dem ESP32 zeigt den Verbindungs-Zustand:
       aus     -> ESP-NOW Senden geht nicht
       blinken -> Senden ok, aber GPS sucht noch Fix
       an      -> alles ok (TX + GPS-Fix)"""

    def __init__(self, pin_nr):
        self._ok = False
        self._led = None
        try:
            self._led = Pin(pin_nr, Pin.OUT)
            self._led.value(0)
            self._ok = True
        except Exception as e:
            log("init", "Status-LED init fehler:", e)
        self._state = False
        self._last_blink = utime.ticks_ms()

    def update(self, tx_ok, gps_fix):
        if not self._ok:
            return
        now = utime.ticks_ms()
        if not tx_ok:
            new_state = False
        elif gps_fix:
            new_state = True
        else:
            # GPS sucht: blinken
            if utime.ticks_diff(now, self._last_blink) > Config.LED_BLINK_MS:
                self._state = not self._state
                self._last_blink = now
            new_state = self._state
        try:
            self._led.value(1 if new_state else 0)
        except Exception:
            pass


def apply_config(cfg, rpm_counter):
    """Übernimmt eine Config-Nachricht vom Dashboard."""
    if "max_rpm" in cfg:
        Config.MAX_RPM = max(500, int(cfg["max_rpm"]))
    if "warn_rpm" in cfg:
        Config.RPM_WARN = max(500, int(cfg["warn_rpm"]))
    if "send_ms" in cfg:
        Config.SEND_MS = max(20, int(cfg["send_ms"]))
    if "pulses_per_rev" in cfg:
        rpm_counter.set_ppr(cfg["pulses_per_rev"])
    if "wheel_circ_m" in cfg:
        try:
            Config.WHEEL_CIRC_M = max(0.0, float(cfg["wheel_circ_m"]))
        except (TypeError, ValueError):
            pass
    if "batt_cells" in cfg:
        try:
            Config.BATT_CELLS = max(1, int(cfg["batt_cells"]))
        except (TypeError, ValueError):
            pass
    log("config", "übernommen:", cfg)


def main():
    log("init", "RasiCross Sender v9.6 startet")

    # Watchdog
    wdt = None
    if Config.WATCHDOG_MS > 0:
        try:
            wdt = WDT(timeout=Config.WATCHDOG_MS)
            log("init", "Watchdog aktiv:", Config.WATCHDOG_MS, "ms")
        except Exception as e:
            log("init", "WDT init fehler:", e)

    # I2C-Bus für IMU + OLED gemeinsam
    try:
        i2c = I2C(0, sda=Pin(Config.I2C_SDA), scl=Pin(Config.I2C_SCL),
                  freq=400_000)
    except Exception as e:
        log("init", "I2C init fehler:", e)
        utime.sleep(2)
        reset()

    # Sensoren & Peripherie
    rpm_counter = RPMCounter(Config.HALL_PIN, Config.PULSES_PER_REV)
    imu         = IMU(i2c)
    gps         = GPS(Config.GPS_RX_PIN, Config.GPS_TX_PIN)
    display     = Display(i2c)
    led         = StatusLED(Config.LED_PIN)
    link        = ESPNowLink(Config.BRIDGE_MAC)
    battery     = Battery()

    log("init", "Eigene MAC:", link.mac)

    # Display-Pages registrieren (Reihenfolge bestimmt Wechsel)
    # Reihenfolge: Speed -> Race -> RPM -> Delta -> Diag
    display.register_page("speed", page_speed)
    display.register_page("race",  page_race)
    display.register_page("rpm",   page_rpm)
    display.register_page("delta", page_delta)
    display.register_page("diag",  page_diag)

    # Lokaler Zustand
    last_send = utime.ticks_ms()
    race_data = None
    pkt_count = 0                 # zaehlt gesendete Pakete (Slow-Field-Kadenz)

    while True:
        if wdt:
            wdt.feed()

        now = utime.ticks_ms()

        # ── Sensoren lesen ──
        rpm = rpm_counter.update()
        gx, gy = imu.update()
        gps.update()

        # ── Rückkanal ──
        pkt = link.recv()
        if pkt:
            kind, data = pkt
            if kind == "display":
                race_data = data
                log("recv", "display:", data.get("driver", "?"),
                    "lap=", data.get("lap", "?"))
                # Page-Auswahl vom Dashboard uebernehmen
                page_choice = data.get("page", "auto")
                display.set_forced_page(page_choice)
            elif kind == "config":
                apply_config(data, rpm_counter)
            elif kind == "pit_call":
                action = data.get("action", "trigger")
                if action == "cancel":
                    display.cancel_pit_call()
                else:
                    display.trigger_pit_call(
                        data.get("message", "PIT STOP"),
                        int(data.get("duration_ms", 15000))
                    )
            elif kind == "imu_calibrate":
                action = data.get("action", "auto")
                if action == "reset":
                    imu.reset_calibration()
                    log("config", "IMU-Kalibrierung zurueckgesetzt")
                else:
                    if imu.start_calibration(int(data.get("duration_ms", 2000))):
                        log("config", "IMU-Kalibrierung gestartet")
            elif kind == "bridge_hello":
                log("config", "Bridge hat sich gemeldet")

        # ── Telemetrie senden ──
        # Adaptive Rate: bei vielen Fehlern in Folge langsamer senden
        # (mehr Zeit pro Paket -> hoehere Erfolgsrate bei schlechter Funk)
        send_interval = (Config.SEND_MS_DEGRADED
                         if link.tx_fail_run >= Config.SEND_FAIL_THRESHOLD
                         else Config.SEND_MS)
        if utime.ticks_diff(now, last_send) >= send_interval:
            last_send = now
            # Geschwindigkeitsquelle: GPS-Fix hat Vorrang; sonst Rad-
            # Hochrechnung aus Hall-Pulsen (nur wenn WHEEL_CIRC_M > 0);
            # sonst 0. Die reine Logik liegt in calc.py (getestet).
            if _HAS_CALC:
                spd_src = calc.speed_source(gps.fix, Config.WHEEL_CIRC_M)
            else:
                spd_src = "gps" if gps.fix else "none"
            if spd_src == "gps":
                speed = gps.speed_kmh
            elif spd_src == "wheel" and _HAS_CALC:
                speed = calc.wheel_speed_kmh(rpm_counter.pulse_hz,
                                             rpm_counter.ppr,
                                             Config.WHEEL_CIRC_M)
            else:
                speed = 0.0
            # Batterie messen + Slow-Field-Kadenz (vbat/soc nur jedes
            # SLOW_FIELD_EVERY-te Paket; batt_warn jedes Paket).
            pkt_count += 1
            slow = (pkt_count % Config.SLOW_FIELD_EVERY == 0)
            if battery.active:
                battery.read()
            packet = {
                "speed":    round(speed, 1),
                "rpm":      int(rpm),
                "gx":       round(gx, 3),
                "gy":       round(gy, 3),
                "gz":       round(imu.az, 2),    # Accel-Z (g), jedes Paket
                "yaw":      round(imu.yaw, 1),   # Gier-Rate (deg/s), jedes Paket
                "lat":      round(gps.lat, 7),
                "lon":      round(gps.lon, 7),
                "gps_fix":  1 if gps.fix else 0,
                "gps_health": gps.health,    # 'ok'|'searching'|'lost'|'disabled'
                "pulse_hz": round(rpm_counter.pulse_hz, 1),
                "send_ms":  send_interval,   # Dashboard sieht degraded mode
                "spd_src":  spd_src,         # 'gps'|'wheel'|'none'
                "imu_cal":  1 if imu.calibrating else 0,
            }
            if battery.active:
                packet["batt_warn"] = battery.warn          # 0|1|2, jedes Paket
                if slow:
                    packet["vbat"] = round(battery.vbat, 2)  # Pack-V, langsam
                    packet["soc"]  = battery.soc             # 0..100, langsam
            if slow:
                mt = imu.mpu_temp
                if mt is not None:
                    packet["mtemp"] = mt          # MPU-Chip-Temp (deg C), langsam
                # Byte-Budget-Kontrolle (< 250 B, siehe Spec §4). Nur
                # bei DEBUG/Topic 'link' sichtbar -> kein Funk-Overhead.
                log("link", "payload bytes:", len(ujson.dumps(packet)))
            tx_ok = link.send(packet)

            # Display-Update
            display.update({
                "speed":     speed,
                "rpm":       rpm,
                "gx":        gx,
                "gy":        gy,
                "gps_fix":   gps.fix,
                "tx_ok":     tx_ok,
                "race_data": race_data,
                "display":   display,
                "vbat":      battery.vbat if battery.active else None,
            })

            # LED
            led.update(tx_ok, gps.fix)

            # Bei vielen TX-Fehlern in Folge: warnen
            if link.tx_fail_run == 20:
                log("link", "Achtung — 20 ESP-NOW Fehler in Folge")

        # Kurze Pause -> spart CPU/Strom, IRQs (Hall-Counter) laufen weiter
        utime.sleep_ms(2)


# Direkt starten falls als Hauptprogramm aufgerufen
if __name__ == "__main__":
    main()
else:
    # Wird aus boot.py o.ä. importiert
    main()
