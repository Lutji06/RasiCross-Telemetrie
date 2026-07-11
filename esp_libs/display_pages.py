# ============================================================
#  RasiCross — display_pages.py  (SSD1306-OLED + Seiten, Phase 45)
#  Herausgeloest aus sender.py — NUR bewegt, nicht geaendert.
#  5 Seiten + Pit-Call/Shift-Override; Pages sind Funktionen
#  (o, ctx) und werden in sender.main() registriert.
# ============================================================

import utime
import framebuf

try:
    import ssd1306
    _HAS_OLED = True
except ImportError:
    _HAS_OLED = False

from config_store import Config, log

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
