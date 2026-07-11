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
from machine import Pin, I2C, WDT, reset, disable_irq, enable_irq, ADC
import gc

# Optionale Module — Programm läuft auch ohne, mit reduzierter Funktion
try:
    import calc
    _HAS_CALC = True
except ImportError:
    _HAS_CALC = False

from config_store import Config, log, ConfigStore, apply_config, config_ack
from imu_task import IMU
from gps_task import GPS
from display_pages import (Display, page_speed, page_race, page_rpm,
                           page_delta, page_diag)
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
