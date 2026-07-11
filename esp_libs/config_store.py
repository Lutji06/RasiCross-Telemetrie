# ============================================================
#  RasiCross — config_store.py  (Live-Config + NVS, Phase 45)
#  Herausgeloest aus sender.py — NUR bewegt, nicht geaendert.
#  Config ist ein Klassen-Objekt: apply_config-Mutationen sind in
#  allen Modulen sichtbar (from config_store import Config).
# ============================================================

import ujson

# NVS fuer persistente Live-Config (ueberlebt Watchdog-/Power-Resets)
try:
    import esp32
    _HAS_NVS = True
except ImportError:
    _HAS_NVS = False


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
    PULSES_PER_REV  = 1          # Pulse pro Wellenumdrehung
    WHEEL_CIRC_M    = 0.0        # Radumfang in Meter (0 = GPS-Speed nutzen)
    GEAR_RATIO      = 1.0        # Wellenumdrehungen je Radumdrehung (1.0 = 1:1)

    # Batterie (A3) — None = Feature aus. NUR ADC1-Pins (GPIO 32-39);
    # ADC2 ist bei aktivem WiFi/ESP-NOW gesperrt!
    BATT_ADC_PIN    = 34       # z.B. 34. None -> Battery-Klasse inert
    BATT_DIVIDER    = 2.0      # externer Teiler Vin/Vadc (2x 10k: halbiert)
    BATT_CELLS      = 1          # Zellen in SERIE (Pack-Spannung -> Per-Cell + SoC).
    #                              Parallel verschaltete Zellen zaehlen NICHT: 2x 18650
    #                              parallel = 1S = 1. Per Dashboard ueberschreibbar.
    BATT_CAL        = 1.0        # Feinkalibrierung (Multiplikator)
    BATT_CELL_WARN  = 3.5        # Warn-Schwelle pro Zelle (V)
    BATT_CELL_CRIT  = 3.3        # Kritisch-Schwelle pro Zelle (V)

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

    # Filter (EMA-Gewicht des neuen Werts: 1=ungefiltert, klein=traege)
    RPM_ALPHA       = 0.25
    RPM_ALPHA_FAST  = 0.60       # Schnellpfad bei grossen Spruengen (Peaks nicht kappen)
    RPM_FAST_DELTA  = 400.0      # ab dieser Abweichung (U/min) greift der Schnellpfad
    G_ALPHA         = 0.30

    # Hall-Glitch-Filter: Flanken oberhalb dieser Drehzahl sind physikalisch
    # unmoeglich (Zuend-EMI am Magnetschuh, Prellen) -> ISR verwirft sie.
    RPM_CEILING     = 16000
    RPM_TIMEOUT_MS  = 600        # so lange keine Flanke -> Motor steht, Drehzahl 0

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


def config_snapshot(rpm_counter):
    """Aktuelle Live-Config als dict — eine Quelle fuer den NVS-Blob
    (ConfigStore) und das config_ack ans Dashboard. OHNE IMU-Offsets,
    damit das Ack unter dem 250-B-ESP-NOW-Limit bleibt; ConfigStore.save
    ergaenzt die Offsets selbst."""
    return {
        "max_rpm":        Config.MAX_RPM,
        "warn_rpm":       Config.RPM_WARN,
        "send_ms":        Config.SEND_MS,
        "pulses_per_rev": rpm_counter.ppr,
        "wheel_circ_m":   round(Config.WHEEL_CIRC_M, 4),
        "gear_ratio":     round(Config.GEAR_RATIO, 3),
        "batt_cells":     Config.BATT_CELLS,
        "rpm_ceiling":    Config.RPM_CEILING,
        "rpm_alpha":      round(Config.RPM_ALPHA, 2),
        "batt_warn_v":    round(Config.BATT_CELL_WARN, 2),
        "batt_crit_v":    round(Config.BATT_CELL_CRIT, 2),
        "batt_cal":       round(Config.BATT_CAL, 3),
        "page_ms":        Config.PAGE_MS,
    }


# Kompakte Funk-Keys fuers config_ack: die langen NVS-/Dashboard-Keys
# sprengen das 250-B-ESP-NOW-Limit. Gegenstueck: ESP_CFG_FIELDS in
# rasicross.js (Dashboard mappt sie zurueck auf die Formular-Inputs).
_ACK_KEYS = {
    "max_rpm": "mr", "warn_rpm": "wr", "send_ms": "sm",
    "pulses_per_rev": "ppr", "wheel_circ_m": "wc", "gear_ratio": "gear",
    "batt_cells": "bc", "rpm_ceiling": "rcl", "rpm_alpha": "ra",
    "batt_warn_v": "bwv", "batt_crit_v": "bcv", "batt_cal": "bcal",
    "page_ms": "pm",
}


def config_ack(rpm_counter):
    """config_snapshot mit kompakten Funk-Keys + type, sendefertig."""
    out = {"type": "config_ack"}
    for k, v in config_snapshot(rpm_counter).items():
        out[_ACK_KEYS[k]] = v
    return out


class ConfigStore:
    """Persistiert die live aenderbaren Config-Werte im ESP32-NVS, damit
    sie einen Reboot ueberleben (z.B. Watchdog-Reset mitten im Rennen).
    Ohne NVS (oder bei Fehlern) inert — dann gelten die Code-Defaults.
    Gleiches Muster wie PeerStore in bridge.py."""

    NAMESPACE = "rasicross"
    KEY       = "config"
    _BUF_SIZE = 512   # Blob ist mit allen Live-Keys + IMU-Offsets ~300 B

    def __init__(self):
        self._nvs = None
        if not _HAS_NVS:
            return
        try:
            self._nvs = esp32.NVS(self.NAMESPACE)
        except Exception as e:
            log("init", "NVS init fehler:", e)
            self._nvs = None

    def load(self, rpm_counter, imu=None):
        """Gespeicherte Config laden und anwenden (via apply_config,
        damit dieselbe Validierung greift wie beim Dashboard-Paket).
        Enthaelt der Blob IMU-Offsets, werden sie ebenfalls gesetzt."""
        if not self._nvs:
            return
        try:
            buf = bytearray(self._BUF_SIZE)
            n = self._nvs.get_blob(self.KEY, buf)
            cfg = ujson.loads(bytes(buf[:n]))
        except Exception:
            return    # nichts gespeichert / korrupt -> Code-Defaults
        if isinstance(cfg, dict):
            apply_config(cfg, rpm_counter)
            if imu is not None and "imu_off_x" in cfg:
                imu.set_offsets(cfg.get("imu_off_x", 0.0),
                                cfg.get("imu_off_y", 0.0))
            log("init", "Config aus NVS geladen")

    def save(self, rpm_counter, imu=None):
        if not self._nvs:
            return
        try:
            data = config_snapshot(rpm_counter)
            if imu is not None:
                off = imu.offsets
                data["imu_off_x"] = off[0]
                data["imu_off_y"] = off[1]
            self._nvs.set_blob(self.KEY, ujson.dumps(data).encode())
            self._nvs.commit()
        except Exception as e:
            log("config", "NVS save fehler:", e)


def apply_config(cfg, rpm_counter, store=None, imu=None):
    """Übernimmt eine Config-Nachricht vom Dashboard. Mit store wird der
    neue Stand zusaetzlich ins NVS geschrieben (reboot-fest); imu liefert
    dabei die aktuellen Kalibrier-Offsets, damit sie im Blob erhalten bleiben."""
    # Obergrenzen: physikalisch sinnvoll UND halten das config_ack-JSON
    # unter dem 250-B-ESP-NOW-Limit (keine 10-stelligen Werte).
    if "max_rpm" in cfg:
        try:
            Config.MAX_RPM = max(500, min(30000, int(cfg["max_rpm"])))
        except (TypeError, ValueError):
            pass
    if "warn_rpm" in cfg:
        try:
            Config.RPM_WARN = max(500, min(30000, int(cfg["warn_rpm"])))
        except (TypeError, ValueError):
            pass
    if "send_ms" in cfg:
        try:
            Config.SEND_MS = max(20, min(5000, int(cfg["send_ms"])))
        except (TypeError, ValueError):
            pass
    if "pulses_per_rev" in cfg:
        try:
            rpm_counter.set_ppr(cfg["pulses_per_rev"])
        except (TypeError, ValueError):
            pass
    if "wheel_circ_m" in cfg:
        try:
            Config.WHEEL_CIRC_M = max(0.0, min(10.0, float(cfg["wheel_circ_m"])))
        except (TypeError, ValueError):
            pass
    if "gear_ratio" in cfg:
        try:
            Config.GEAR_RATIO = max(0.0, min(100.0, float(cfg["gear_ratio"])))
        except (TypeError, ValueError):
            pass
    if "batt_cells" in cfg:
        try:
            Config.BATT_CELLS = max(1, min(24, int(cfg["batt_cells"])))
        except (TypeError, ValueError):
            pass
    if "rpm_ceiling" in cfg:
        try:
            Config.RPM_CEILING = max(0, min(60000, int(cfg["rpm_ceiling"])))
            rpm_counter.recalc_glitch_filter()
        except (TypeError, ValueError):
            pass
    if "rpm_alpha" in cfg:
        try:
            a = float(cfg["rpm_alpha"])
            if 0.01 <= a <= 1.0:
                Config.RPM_ALPHA = a
        except (TypeError, ValueError):
            pass
    if "batt_warn_v" in cfg:
        try:
            v = float(cfg["batt_warn_v"])
            if 2.5 <= v <= 4.4:
                Config.BATT_CELL_WARN = v
        except (TypeError, ValueError):
            pass
    if "batt_crit_v" in cfg:
        try:
            v = float(cfg["batt_crit_v"])
            if 2.0 <= v <= 4.4:
                Config.BATT_CELL_CRIT = v
        except (TypeError, ValueError):
            pass
    if "batt_cal" in cfg:
        try:
            v = float(cfg["batt_cal"])
            if 0.5 <= v <= 2.0:
                Config.BATT_CAL = v
        except (TypeError, ValueError):
            pass
    if "page_ms" in cfg:
        try:
            Config.PAGE_MS = max(1000, min(60000, int(cfg["page_ms"])))
        except (TypeError, ValueError):
            pass
    log("config", "übernommen:", cfg)
    if store:
        store.save(rpm_counter, imu)
