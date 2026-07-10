# ============================================================
#  RasiCross  --  KART ESP32 SENDER
# ============================================================
#  Rolle:    Mäher-seitiger ESP. Sammelt Sensordaten und sendet
#            sie via ESP-NOW an die Bridge (Boxengasse).
#
#  Sensoren: Hall (RPM), MPU-6050 (Gx,Gy), GPS (NMEA),
#            SSD1306 OLED (5 Seiten + Pit-Call Override).
#
#  Pins (Standard, im Config-Block änderbar):
#    Hall      → GPIO 4    (INPUT, PULL-UP, falling-edge IRQ)
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

import utime
import framebuf
from machine import Pin, I2C, WDT, reset, disable_irq, enable_irq, ADC
import gc

# Optionale Module — Programm läuft auch ohne, mit reduzierter Funktion
try:
    import ssd1306
    _HAS_OLED = True
except ImportError:
    _HAS_OLED = False

try:
    import calc
    _HAS_CALC = True
except ImportError:
    _HAS_CALC = False

from config_store import Config, log, ConfigStore, apply_config, config_ack
from imu_task import IMU
from gps_task import GPS
from radio import ESPNowLink


# ── RPM-Zähler ────────────────────────────────────────────────────────────

class RPMCounter:
    """Hall-Pulse via IRQ — Drehzahl per Periodenmessung statt Fensterzaehlung.

    Warum: ein 50-80-ms-Zaehlfenster quantisiert auf 750-1200 U/min pro
    Puls (bei 1 Puls/U) — der Leerlauf wackelte dadurch um Hunderte U/min.
    Der Flankenabstand der letzten zwei Pulse ist dagegen < 1 U/min genau.
    Dazu ISR-seitiger Glitch-Filter gegen Zuend-EMI-Doppeltrigger
    (RPM_CEILING) und adaptive EMA, damit kurz angetippte Drehzahl-Peaks
    nicht weggeglaettet werden."""

    def __init__(self, pin_nr, pulses_per_rev=1):
        self._count        = 0          # akzeptierte Flanken seit letztem update()
        self._glitches     = 0          # verworfene Stoerflanken (kumulativ)
        self._ppr          = max(1, pulses_per_rev)
        self._min_period_us = self._calc_min_period()
        self._last_edge_us = utime.ticks_us()
        self._period_us    = 0          # Abstand der letzten zwei echten Flanken
        self._last_calc_ms = utime.ticks_ms()
        self._rpm_raw      = 0.0
        self._rpm_smooth   = 0.0
        self._pulse_hz_raw = 0.0
        self._total_pulses = 0
        self._pin = Pin(pin_nr, Pin.IN, Pin.PULL_UP)
        self._pin.irq(trigger=Pin.IRQ_FALLING, handler=self._isr)

    def _calc_min_period(self):
        if _HAS_CALC:
            return calc.hall_min_period_us(Config.RPM_CEILING, self._ppr)
        if Config.RPM_CEILING > 0:
            return int(60000000 / (Config.RPM_CEILING * self._ppr))
        return 0

    def _isr(self, _p):
        # Soft-IRQ: kurz halten, nur Integer-Arithmetik.
        now = utime.ticks_us()
        dt = utime.ticks_diff(now, self._last_edge_us)
        if 0 <= dt < self._min_period_us:
            # Schneller als RPM_CEILING erlaubt -> Stoerimpuls (Zuend-EMI,
            # Prellen). last_edge bleibt stehen: die naechste ECHTE Flanke
            # misst weiter gegen die letzte echte.
            self._glitches += 1
            return
        self._last_edge_us = now
        self._period_us = dt            # dt < 0 nur nach ticks-Wrap -> update() faengt das
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

        # Atomarer Read+Reset: ein Hall-IRQ zwischen den Zugriffen wuerde
        # sonst Zaehler und Periode inkonsistent machen / Pulse verschlucken.
        _irq = disable_irq()
        cnt = self._count
        self._count = 0
        period_us = self._period_us
        last_edge_us = self._last_edge_us
        enable_irq(_irq)
        self._total_pulses += cnt
        self._last_calc_ms = now

        # Mittlere Pulsrate des Fensters: Semantik unveraendert, speist
        # weiterhin die Rad-Geschwindigkeit (calc.wheel_speed_kmh).
        self._pulse_hz_raw = cnt / (dt / 1000.0) if cnt > 0 else 0.0

        if cnt > 0 and period_us > 0:
            # Periodenmessung: Aufloesung im Leerlauf < 1 U/min statt
            # 750-1200 U/min pro Fenster-Puls.
            if _HAS_CALC:
                self._rpm_raw = calc.rpm_from_period_us(period_us, self._ppr)
            else:
                self._rpm_raw = 60000000.0 / (period_us * self._ppr)
        elif cnt > 0:
            # period <= 0 (ticks_us-Wrap direkt nach langem Stillstand):
            # einmalig auf die Fensterrate zurueckfallen.
            self._rpm_raw = (self._pulse_hz_raw / self._ppr) * 60.0
        else:
            # Keine Flanke in diesem Fenster. Bei sehr niedriger Drehzahl
            # liegt zwischen zwei Pulsen mehr als ein Fenster — den letzten
            # Wert halten und erst nach RPM_TIMEOUT_MS auf 0 (Motor steht).
            # Das alte Sofort-Null drueckte den Leerlauf systematisch runter.
            age_ms = utime.ticks_diff(utime.ticks_us(), last_edge_us) // 1000
            if age_ms < 0 or age_ms >= Config.RPM_TIMEOUT_MS:
                self._rpm_raw = 0.0

        if _HAS_CALC:
            self._rpm_smooth = calc.rpm_ema_step(
                self._rpm_smooth, self._rpm_raw, alpha,
                Config.RPM_ALPHA_FAST, Config.RPM_FAST_DELTA)
        else:
            self._rpm_smooth = alpha * self._rpm_raw + (1 - alpha) * self._rpm_smooth
        return self._rpm_smooth

    def set_ppr(self, ppr):
        # Obergrenze haelt auch das config_ack-JSON kompakt (<250 B ESP-NOW)
        self._ppr = max(1, min(99, int(ppr)))
        self._min_period_us = self._calc_min_period()

    def recalc_glitch_filter(self):
        """Nach einer Aenderung von Config.RPM_CEILING aufrufen — die
        Mindest-Periode ist gecacht, damit die ISR nicht rechnen muss."""
        self._min_period_us = self._calc_min_period()

    @property
    def rpm(self):           return self._rpm_smooth

    @property
    def pulse_hz(self):      return self._pulse_hz_raw

    @property
    def ppr(self):           return self._ppr

    @property
    def total_pulses(self):  return self._total_pulses

    @property
    def glitches(self):      return self._glitches


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

        # Race-Anker fuer kart-seitige OLED-Uhr (D1-gamma).
        # set_race_data(d) speichert d + den Empfangs-Tick; live_lap_ms()
        # rechnet die laufende Rundenzeit lokal aus utime weiter, solange
        # 'running' im d ist und 'lap_ms' geliefert wurde.
        self._race          = None
        self._race_recv_tick = 0

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

    def set_race_data(self, d):
        """Race-Display-Nachricht + Empfangs-Tick speichern (D1-gamma)."""
        self._race = d or None
        self._race_recv_tick = utime.ticks_ms()

    def live_lap_ms(self):
        """Lokal hochgerechnete Rundenzeit in ms, oder None wenn kein
        Anker geliefert wurde / nicht 'running'. Bei Pause/Stop friert
        die Uhr ein."""
        d = self._race
        if not d or not d.get("running"):
            return None
        base = d.get("lap_ms")
        if base is None:
            return None
        return base + utime.ticks_diff(utime.ticks_ms(), self._race_recv_tick)

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
        o.text("RasiCross", 28, 8, 1)
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


def _fmt_ms(ms):
    """Millisekunden -> 'M:SS.mmm' (Kart-seitige Live-Uhr, D1-gamma)."""
    if ms is None or ms < 0:
        ms = 0
    ms = int(ms)
    m = ms // 60000
    s = (ms % 60000) // 1000
    r = ms % 1000
    return "{}:{:02d}.{:03d}".format(m, s, r)


def page_race(o, ctx):
    """Seite 2: Sektor-Segmente oben + Rundenzeit gross."""
    race = ctx.get("race_data")
    if not race:
        o.text("Kein Rennen", 10, 30, 1)
        return
    # Sektor-Segmente oben
    _draw_sector_bar(o, race, y=12, h=6)
    # Rundenzeit gross zentriert (2x skaliert).
    # Wenn das Dashboard einen Anker geliefert hat (running + lap_ms),
    # rechnen wir hier kart-seitig live weiter (D1-gamma). Sonst
    # Fallback auf den vorformatierten String vom Dashboard.
    live_ms = ctx["display"].live_lap_ms()
    if live_ms is not None:
        lap = _fmt_ms(live_ms)[:9]
    else:
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
    # !n = vom Glitch-Filter verworfene Stoerflanken (Zuend-EMI).
    # Steigt der Zaehler im Betrieb stetig, koppelt die Zuendung in die
    # Hall-Leitung ein -> Verkabelung pruefen (verdrillen, weg vom Zuendkabel).
    gl = ctx.get("rpm_glitch", 0)
    if gl:
        o.text("RPM {:5d} !{}".format(int(ctx.get("rpm", 0)), min(gl, 9999)), 0, 40, 1)
    else:
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


def main():
    log("init", "RasiCross Sender startet")

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

    # Persistierte Live-Config + IMU-Offsets anwenden
    # (ueberlebt Watchdog-/Power-Resets)
    cfg_store = ConfigStore()
    cfg_store.load(rpm_counter, imu)

    log("init", "Eigene MAC:", link.mac)

    # Display-Pages registrieren (Reihenfolge bestimmt Wechsel)
    # Reihenfolge: Speed -> Race -> RPM -> Delta -> Diag
    display.register_page("speed", page_speed)
    display.register_page("race",  page_race)
    display.register_page("rpm",   page_rpm)
    display.register_page("delta", page_delta)
    display.register_page("diag",  page_diag)

    # Phase 45: freier Heap nach Boot als Gate-Messwert (Spec: Baseline vor
    # der Modularisierung; faellt der Wert nach dem Split >10 % darunter,
    # werden Module wieder zusammengelegt statt weiter gesplittet).
    gc.collect()
    log("init", "Heap frei nach Boot:", gc.mem_free(), "Bytes")

    # Lokaler Zustand
    last_send = utime.ticks_ms()
    race_data = None
    imu_was_calibrating = False

    while True:
        if wdt:
            wdt.feed()

        now = utime.ticks_ms()

        # ── Sensoren lesen ──
        rpm = rpm_counter.update()
        gx, gy = imu.update()
        gps.update()

        # Kalibrierung gerade (non-blocking) fertig geworden?
        # -> neue Offsets reboot-fest ins NVS schreiben.
        if imu_was_calibrating and not imu.calibrating:
            cfg_store.save(rpm_counter, imu)
            log("config", "IMU-Offsets im NVS gespeichert")
        imu_was_calibrating = imu.calibrating

        # ── Rückkanal ──
        pkt = link.recv()
        if pkt:
            kind, data = pkt
            if kind == "display":
                race_data = data
                display.set_race_data(data)
                log("recv", "display:", data.get("driver", "?"),
                    "lap=", data.get("lap", "?"))
                # Page-Auswahl vom Dashboard uebernehmen
                page_choice = data.get("page", "auto")
                display.set_forced_page(page_choice)
            elif kind == "config":
                apply_config(data, rpm_counter, cfg_store, imu)
                link.send_json(config_ack(rpm_counter))
            elif kind == "config_get":
                # Dashboard will den Ist-Stand lesen (z.B. direkt nach Connect)
                link.send_json(config_ack(rpm_counter))
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
                    cfg_store.save(rpm_counter, imu)   # genullte Offsets persistieren
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
                                             Config.WHEEL_CIRC_M,
                                             Config.GEAR_RATIO)
            else:
                speed = 0.0
            # Binaer-Frame ist winzig (~35 B) -> keine Slow-Kadenz mehr:
            # alle Felder in jedem Paket (D1-Spec 4.3).
            if battery.active:
                battery.read()
            packet = {
                "speed":    round(speed, 1),
                "rpm":      int(rpm),
                "gx":       round(gx, 3),
                "gy":       round(gy, 3),
                "gz":       round(imu.az, 2),    # Accel-Z (g), jedes Paket
                "yaw":      round(imu.yaw, 1),   # Gier-Rate (deg/s), jedes Paket
                "roll":     round(imu.roll, 1),  # Roll-Rate (deg/s), jedes Paket
                "lat":      round(gps.lat, 7),
                "lon":      round(gps.lon, 7),
                "gps_fix":  1 if gps.fix else 0,
                "gps_health": gps.health,    # 'ok'|'searching'|'lost'|'disabled'
                "pulse_hz": round(rpm_counter.pulse_hz, 1),
                "send_ms":  send_interval,   # Dashboard sieht degraded mode
                "spd_src":  spd_src,         # 'gps'|'wheel'|'none'
                "imu_cal":  1 if imu.calibrating else 0,
                "glitch":   rpm_counter.glitches,  # verworfene Stoerflanken (kumulativ)
            }
            if battery.active:
                packet["batt_warn"] = battery.warn          # 0|1|2
                packet["vbat"]      = round(battery.vbat, 2) # Pack-V
                packet["soc"]       = battery.soc            # 0..100
            mt = imu.mpu_temp
            if mt is not None:
                packet["mtemp"] = mt                          # MPU-Temp degC
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
                "rpm_glitch": rpm_counter.glitches,
            })

            # LED
            led.update(tx_ok, gps.fix)

            # Bei vielen TX-Fehlern in Folge: warnen
            if link.tx_fail_run == 20:
                log("link", "Achtung — 20 ESP-NOW Fehler in Folge")

        # Kurze Pause -> spart CPU/Strom, IRQs (Hall-Counter) laufen weiter
        utime.sleep_ms(2)


# Laeuft los, egal ob als Hauptprogramm gestartet oder aus boot.py importiert.
main()
