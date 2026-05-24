# ============================================================
#  RasiCross  --  BRIDGE ESP32  ESP-NOW ⇆ USB SERIAL
# ============================================================
#  Rolle:    Boxen-seitiger ESP. Empfängt Telemetrie vom Kart
#            per ESP-NOW und gibt sie als JSON-Lines per USB-Serial
#            an das Dashboard aus. Leitet Steuerpakete (Display,
#            Config, Pit-Call) vom Dashboard zurück an den Kart.
#
#  Pins (Standard, im Config-Block änderbar):
#    OLED      → I2C  SDA=21  SCL=22  (Adresse 0x3C)
#    Status-LED→ GPIO 2 (onboard)
#
#  Was ist neu vs. v8:
#    • Saubere Trennung: Stats / Display / Bridge / I/O
#    • Pit-Call Hinweis hat eigenen Timeout (überschreibt
#      normales Display nicht endlos)
#    • Bridge sendet "bridge_hello" beim Start → Sender lernt MAC
#      automatisch (kein Hardcoding mehr nötig im Notfall)
#    • OLED zeigt Channel + Verbindungsstatus klar getrennt
#    • Statistik-Klasse für Pakete/s, Verlustrate, RSSI-Filter
#    • Onboard-LED Heartbeat
#    • Bessere Fehler-Meldungen ans Dashboard
# ============================================================

import network
import espnow
import ujson
import frame
import utime
import ubinascii
import sys

try:
    import select
    _HAS_SELECT = True
except Exception:
    _HAS_SELECT = False

try:
    from machine import Pin, I2C, WDT
    _HAS_WDT = True
except Exception:
    _HAS_WDT = False
    try:
        from machine import Pin, I2C
    except Exception:
        pass

try:
    import ssd1306
    _HAS_OLED = True
except Exception:
    _HAS_OLED = False

# NVS fuer persistente Peer-Liste (Kart-MAC ueberlebt Reboot)
try:
    import esp32
    _HAS_NVS = True
except Exception:
    _HAS_NVS = False


# ── Konfiguration ─────────────────────────────────────────────────────────

class Config:
    ESPNOW_CHANNEL    = 1       # Muss mit Sender übereinstimmen
    HEARTBEAT_MS      = 2000    # Status-Meldung an Dashboard
    HELLO_MS          = 5000    # Bridge-Hello (nur wenn Kart laenger nichts sendet)
    HELLO_QUIET_MS    = 5000    # Hello nur senden, wenn so lange nichts vom Kart kam
    LOOP_SLEEP_MS     = 2

    # Sicherheit
    WATCHDOG_MS       = 8000    # Hardware-Watchdog (0 = aus); Bridge-Hang wird automatisch behoben

    # OLED
    OLED_ENABLED      = True
    OLED_SDA          = 21
    OLED_SCL          = 22
    OLED_REFRESH_MS   = 250
    PIT_MSG_DURATION_MS = 3000   # Wie lange "PIT-CALL TX" auf Bridge sichtbar

    # Funk: ESP-NOW laeuft im reinen Long-Range-Modus.
    # WICHTIG: Sender muss auch im LR-Mode laufen!
    WIFI_TX_POWER_DBM = 20       # Sendeleistung in dBm (20 = EU-Max)

    # Status-LED
    LED_ENABLED       = True
    LED_PIN           = 2
    LED_BLINK_MS      = 500


def jprint(obj):
    """Eine JSON-Zeile auf stdout — das ist das Dashboard-Protokoll."""
    print(ujson.dumps(obj))


# ── Persistenz ────────────────────────────────────────────────────────────

class PeerStore:
    """Speichert die zuletzt bekannte Kart-MAC im ESP32-NVS, sodass die
    Bridge nach einem Reboot ohne Neulernen direkt senden kann."""

    NAMESPACE = "rasicross"
    KEY       = "kart_mac"

    def __init__(self):
        self._nvs = None
        if not _HAS_NVS:
            return
        try:
            self._nvs = esp32.NVS(self.NAMESPACE)
        except Exception as e:
            print("[init] NVS init fehler:", e)
            self._nvs = None

    def load(self):
        if not self._nvs:
            return None
        try:
            buf = bytearray(6)
            n = self._nvs.get_blob(self.KEY, buf)
            if n == 6:
                return bytes(buf)
        except Exception:
            pass
        return None

    def save(self, mac_bytes):
        if not self._nvs or not mac_bytes or len(mac_bytes) != 6:
            return
        try:
            self._nvs.set_blob(self.KEY, mac_bytes)
            self._nvs.commit()
        except Exception as e:
            print("[init] NVS save fehler:", e)


# ── Statistik ─────────────────────────────────────────────────────────────

class Stats:
    """Verwaltet Pakete-pro-Sekunde, Verlustrate, RSSI-Mittelwert."""

    def __init__(self):
        self.rx_count    = 0
        self.lost        = 0
        self.last_seq    = None
        self._packets_at_last_calc = 0
        self._last_rate_ms = utime.ticks_ms()
        self.packets_per_sec = 0
        # Live-Werte des letzten Pakets
        self.last_speed = 0.0
        self.last_rpm   = 0
        self.last_rssi  = None
        self.gps_fix    = False
        self.last_packet_at = 0

    def on_packet(self, data):
        """Wird mit dem geparsten Paket aufgerufen. Aktualisiert Statistiken."""
        self.rx_count += 1
        self.last_packet_at = utime.ticks_ms()

        # Verlustrate über Sequenznummer
        seq = data.get("seq")
        if seq is not None:
            try:
                seq = int(seq)
                if self.last_seq is not None:
                    expected = (self.last_seq + 1) % 65536
                    if seq != expected:
                        diff = (seq - expected) % 65536
                        if 0 < diff < 200:    # Sprung ignorieren bei Neustart
                            self.lost += diff
                self.last_seq = seq
            except (TypeError, ValueError):
                pass

        # Live-Werte für Display
        if "speed" in data:
            try: self.last_speed = float(data["speed"])
            except (TypeError, ValueError): pass
        if "rpm" in data:
            try: self.last_rpm = int(data["rpm"])
            except (TypeError, ValueError): pass
        if "rssi" in data:
            try: self.last_rssi = int(data["rssi"])
            except (TypeError, ValueError): pass
        if "gps_fix" in data:
            self.gps_fix = bool(data["gps_fix"])

    def tick(self):
        """Einmal pro Sekunde aufrufen, aktualisiert Pakete/s."""
        now = utime.ticks_ms()
        if utime.ticks_diff(now, self._last_rate_ms) >= 1000:
            delta = self.rx_count - self._packets_at_last_calc
            self.packets_per_sec = max(0, delta)
            self._packets_at_last_calc = self.rx_count
            self._last_rate_ms = now

    @property
    def packet_age_ms(self):
        if not self.last_packet_at:
            return 99999
        return utime.ticks_diff(utime.ticks_ms(), self.last_packet_at)


# ── OLED-Display ──────────────────────────────────────────────────────────

class BridgeDisplay:
    """SSD1306 128x64 für die Bridge.

    Layout (4 Zeilen à 12px):
      Zeile 0 (Header):   "BRIDGE  CH:1   #####"  + Aktivitätspunkt
      Zeile 1 (Tele):     "999km/h  9999 rpm"
      Zeile 2 (Funk):     "999Hz  L:9999"
      Zeile 3 (RF/GPS):   "-99dBm   GPS:OK"
      Zeile 4 (USB):      "USB ON|OFF"
    """

    def __init__(self):
        self._ok = False
        self._oled = None
        self._last_draw = 0
        self._msg_until = 0
        self._msg_line1 = ""
        self._msg_line2 = ""

        if not (Config.OLED_ENABLED and _HAS_OLED):
            return
        try:
            i2c = I2C(0, sda=Pin(Config.OLED_SDA),
                      scl=Pin(Config.OLED_SCL), freq=400_000)
            self._oled = ssd1306.SSD1306_I2C(128, 64, i2c)
            self._ok = True
            self._show_boot()
        except Exception as e:
            print("OLED init fehler:", e)

    def _show_boot(self):
        o = self._oled
        o.fill(0)
        o.text("RasiCross", 28, 8, 1)
        o.text("Bridge ESP32", 16, 24, 1)
        o.text("CH:{}  Init...".format(Config.ESPNOW_CHANNEL), 0, 44, 1)
        o.show()

    def show_message(self, line1, line2="", duration_ms=None):
        """Blendet eine Nachricht für duration_ms ein (überschreibt normales Display)."""
        if not self._ok:
            return
        self._msg_line1 = str(line1)[:16]
        self._msg_line2 = str(line2)[:16]
        if duration_ms is None:
            duration_ms = Config.PIT_MSG_DURATION_MS
        self._msg_until = utime.ticks_add(utime.ticks_ms(), duration_ms)

    def update(self, stats, kart_mac, usb_connected):
        if not self._ok:
            return
        now = utime.ticks_ms()
        if utime.ticks_diff(now, self._last_draw) < Config.OLED_REFRESH_MS:
            return
        self._last_draw = now

        o = self._oled
        o.fill(0)

        # ── Message-Override (z.B. Pit-Call) ────────────────────────────
        if utime.ticks_diff(now, self._msg_until) < 0:
            o.rect(0, 0, 128, 64, 1)
            o.fill_rect(0, 0, 128, 12, 1)
            o.text("BRIDGE", 4, 2, 0)
            o.text(self._msg_line1, 4, 24, 1)
            if self._msg_line2:
                o.text(self._msg_line2, 4, 38, 1)
            o.show()
            return

        # ── Header ───────────────────────────────────────────────────────
        o.text("BRIDGE", 0, 0, 1)
        o.text("CH{}".format(Config.ESPNOW_CHANNEL), 56, 0, 1)
        rx_str = "{:>5}".format(stats.rx_count) if stats.rx_count < 100000 \
                 else "{:>5}".format(stats.rx_count % 100000)
        o.text(rx_str, 88, 0, 1)
        # Aktivitätspunkt rechts
        age = stats.packet_age_ms
        if age < 500:
            o.fill_rect(122, 1, 4, 4, 1)   # gerade aktiv
        elif age < 2000:
            o.rect(121, 0, 6, 6, 1)        # noch warm
        o.hline(0, 9, 128, 1)

        # ── Telemetrie ───────────────────────────────────────────────────
        o.text("{:>3}km/h".format(int(stats.last_speed)), 0, 14, 1)
        o.text("{:>5}rpm".format(int(stats.last_rpm)), 64, 14, 1)

        # ── Funk: Hz + Lost ──────────────────────────────────────────────
        o.text("{:>3}Hz".format(stats.packets_per_sec), 0, 26, 1)
        o.text("L:{}".format(stats.lost), 64, 26, 1)

        # ── RSSI + GPS ───────────────────────────────────────────────────
        rssi_text = "{}dBm".format(stats.last_rssi) if stats.last_rssi is not None else "----dBm"
        o.text(rssi_text, 0, 38, 1)
        o.text("GPS:" + ("OK" if stats.gps_fix else "--"), 80, 38, 1)

        # ── USB-Status & Kart-MAC (letzte 4 Zeichen) ─────────────────────
        usb_txt = "USB ON" if usb_connected else "USB OFF"
        o.text(usb_txt, 0, 50, 1)
        if kart_mac:
            # letzte 4 Hex-Zeichen ("ab:cd")
            short = kart_mac.split(":")[-2:] if ":" in kart_mac else [kart_mac[-4:]]
            o.text("KT " + ":".join(short), 64, 50, 1)
        o.show()


# ── Status-LED ────────────────────────────────────────────────────────────

class StatusLED:
    """Onboard-LED:
       aus       → keine Pakete vom Kart
       blink     → Pakete kommen aber USB nicht verbunden
       an dauer  → Pakete + USB verbunden"""

    def __init__(self):
        self._ok = False
        if not Config.LED_ENABLED:
            return
        try:
            self._led = Pin(Config.LED_PIN, Pin.OUT)
            self._ok = True
        except Exception:
            pass
        self._state = False
        self._last_blink = utime.ticks_ms()

    def update(self, packets_recent, usb_connected):
        if not self._ok:
            return
        now = utime.ticks_ms()
        if not packets_recent:
            self._state = False
        elif packets_recent and usb_connected:
            self._state = True
        else:
            if utime.ticks_diff(now, self._last_blink) > Config.LED_BLINK_MS:
                self._state = not self._state
                self._last_blink = now
        try:
            self._led.value(1 if self._state else 0)
        except Exception:
            pass


# ── Bridge ────────────────────────────────────────────────────────────────

class Bridge:
    """Das Hauptobjekt — hält ESP-NOW, USB-IO, Statistik und Display zusammen."""

    def __init__(self):
        # WLAN init (Station-Mode für ESP-NOW)
        self.wlan = network.WLAN(network.STA_IF)
        self.wlan.active(True)
        try:
            self.wlan.disconnect()
        except Exception:
            pass

        # Reiner Long-Range-Modus (250 kbit/s, max Reichweite, LR-only)
        try:
            self.wlan.config(protocol=8)
            print("[init] Long-Range-Modus aktiv (LR-only)")
        except Exception as e:
            print("[init] WARNUNG: LR-Mode nicht setzbar:", e)

        try:
            self.wlan.config(channel=Config.ESPNOW_CHANNEL)
        except Exception:
            pass

        # Maximale Sendeleistung (20 dBm = 100 mW, EU-Max)
        try:
            self.wlan.config(txpower=Config.WIFI_TX_POWER_DBM)
            print("[init] TX-Power:", Config.WIFI_TX_POWER_DBM, "dBm")
        except Exception:
            pass

        # ESP-NOW
        self.esp = espnow.ESPNow()
        self.esp.active(True)

        # PHY-Rate auf Long-Range — 250 kbit/s, Sensitivitaet ~-129 dBm
        # (max Reichweite). Muss zum Sender passen.
        try:
            self.esp.config(rate=41)  # WIFI_PHY_RATE_LORA_250K (0x29)
        except Exception:
            pass

        # State
        self.stats        = Stats()
        self.kart_host    = None      # MAC des Kart-ESP (auto-erkannt)
        self.known_peers  = set()
        self.last_hb_ms   = utime.ticks_ms()
        self.last_hello_ms = 0
        self.last_usb_at  = 0
        self.usb_errors   = 0

        # Persistente Peer-Liste: Kart-MAC ueberlebt Reboot
        self.peer_store = PeerStore()
        saved_mac = self.peer_store.load()
        if saved_mac:
            self.kart_host = saved_mac
            self._add_peer(saved_mac)
            print("[init] Kart-MAC aus NVS geladen:",
                  ubinascii.hexlify(saved_mac, ":").decode())

        # Watchdog
        self.wdt = None
        if _HAS_WDT and Config.WATCHDOG_MS > 0:
            try:
                self.wdt = WDT(timeout=Config.WATCHDOG_MS)
                print("[init] Watchdog aktiv:", Config.WATCHDOG_MS, "ms")
            except Exception as e:
                print("[init] WDT init fehler:", e)

        # Display + LED
        self.display = BridgeDisplay()
        self.led     = StatusLED()

        # Optional: USB-Stdin lesen für Rückkanal
        self.poll = None
        if _HAS_SELECT:
            try:
                self.poll = select.poll()
                self.poll.register(sys.stdin, select.POLLIN)
            except Exception:
                self.poll = None

        # Boot-Meldung an Dashboard
        mac = ubinascii.hexlify(self.wlan.config("mac"), ":").decode()
        jprint({
            "type":           "bridge_status",
            "bridge":         "ready",
            "mac":            mac,
            "channel":        Config.ESPNOW_CHANNEL,
            "return_channel": self.poll is not None,
            "oled":           self.display._ok,
        })

    # ── Hauptschleife ─────────────────────────────────────────────────────

    def run(self):
        while True:
            if self.wdt:
                self.wdt.feed()

            # Alle wartenden Pakete in einem Rutsch verarbeiten
            while True:
                try:
                    host, msg = self.esp.recv(0)
                except Exception:
                    break
                if not msg:
                    break
                self._handle_packet(host, msg)

            self._handle_usb()
            self._send_heartbeat()
            self._send_hello()
            self._update_status()
            utime.sleep_ms(Config.LOOP_SLEEP_MS)

    # ── Status-Aktualisierungen (Display + LED + Stats-Tick) ──────────────

    def _update_status(self):
        self.stats.tick()
        usb_alive = self._usb_alive()
        self.led.update(
            packets_recent = self.stats.packet_age_ms < 2000,
            usb_connected  = usb_alive,
        )
        kart_mac_str = (ubinascii.hexlify(self.kart_host, ":").decode()
                        if self.kart_host else None)
        self.display.update(self.stats, kart_mac_str, usb_alive)

    def _usb_alive(self):
        if not self.last_usb_at:
            return False
        return utime.ticks_diff(utime.ticks_ms(), self.last_usb_at) < 5000

    # ── Empfangen ─────────────────────────────────────────────────────────

    def _handle_packet(self, host, msg):
        # Peer-Lernen
        if host:
            self._add_peer(host)
            # Neue MAC -> persistent speichern, damit sie Reboots ueberlebt
            if self.kart_host != host:
                self.kart_host = host
                self.peer_store.save(host)

        # Binaer-Frame (D1)? Erstes Byte == FRAME_VER und exakte Laenge.
        # JSON beginnt immer mit '{' (0x7B != 1) -> keine Kollision.
        # Alter Sender / Steuer-Echo (JSON) bleibt weiter lesbar
        # (Flash-Fenster / Rollback-Gnade).
        if msg and msg[0] == frame.FRAME_VER and len(msg) == frame.SIZE:
            data = frame.unpack(msg)
            if "_err" in data:
                jprint({"type": "bridge_error",
                        "error": "frame_" + data["_err"]})
                return
        else:
            try:
                data = ujson.loads(msg)
            except Exception:
                jprint({
                    "type": "bridge_error",
                    "error": "invalid_json",
                    "raw": str(msg)[:40],
                })
                return
            if not isinstance(data, dict):
                # Gueltiges JSON, aber kein Objekt (Zahl/Liste/String) -> nicht
                # weiterverarbeiten, sonst crasht der dict-Zugriff in on_packet
                # die ganze Empfangsschleife.
                jprint({
                    "type": "bridge_error",
                    "error": "invalid_json",
                    "raw": str(msg)[:40],
                })
                return

        # RSSI aus ESP-NOW peers_table holen (Empfangsstaerke des Pakets).
        # peers_table ist ein dict {mac_bytes: [rssi_int, time_ms]}.
        # Wird nur in MicroPython 1.21+ unterstuetzt — Fallback macht nix.
        rssi = None
        if host:
            try:
                pt = self.esp.peers_table
                entry = pt.get(host) if pt else None
                if entry and len(entry) >= 1:
                    rssi = int(entry[0])
            except Exception:
                pass
        if rssi is not None:
            data["rssi"] = rssi

        # Statistiken aktualisieren
        self.stats.on_packet(data)

        # Metadaten an Dashboard anreichern
        data["source"]    = "espnow_usb"
        data["rx_count"]  = self.stats.rx_count
        data["lost"]      = self.stats.lost
        data["bridge_ms"] = utime.ticks_ms()
        if host:
            data["from_mac"] = ubinascii.hexlify(host, ":").decode()

        jprint(data)

    # ── USB → Kart ────────────────────────────────────────────────────────

    def _handle_usb(self):
        if not self.poll:
            return
        try:
            if not self.poll.poll(0):
                return
            line = sys.stdin.readline()
        except Exception:
            return
        if not line:
            return
        line = line.strip()
        if not line:
            return

        self.last_usb_at = utime.ticks_ms()

        try:
            data = ujson.loads(line)
        except Exception:
            self.usb_errors += 1
            jprint({"type": "bridge_error", "error": "usb_invalid_json",
                    "raw": line[:40]})
            return
        if not isinstance(data, dict):
            self.usb_errors += 1
            jprint({"type": "bridge_error", "error": "usb_invalid_json",
                    "raw": line[:40]})
            return

        t = data.get("type")

        # Dashboard fragt nach Status
        if t == "request_status":
            self._send_status()
            return

        # Dashboard kann Kart-MAC manuell setzen (falls Sender noch nicht funkt)
        if t == "set_kart_mac":
            mac_str = data.get("mac", "")
            try:
                # "aa:bb:cc:dd:ee:ff" oder "aabbccddeeff"
                clean = mac_str.replace(":", "").replace("-", "")
                if len(clean) == 12:
                    mac_bytes = bytes.fromhex(clean)
                    self.kart_host = mac_bytes
                    self._add_peer(mac_bytes)
                    self.peer_store.save(mac_bytes)
                    jprint({"type": "bridge_info",
                            "info": "kart_mac_set",
                            "kart_mac": mac_str})
            except Exception as e:
                jprint({"type": "bridge_error",
                        "error": "set_kart_mac_failed",
                        "detail": str(e)})
            return

        # Steuer-Pakete an den Kart weiterleiten
        if t in ("display", "config", "pit_call", "imu_calibrate"):
            self._forward_to_kart(t, data)
            return

        # Unbekannter Typ
        jprint({"type": "bridge_error", "error": "unknown_type",
                "received": str(t)})

    def _forward_to_kart(self, kind, data):
        if not self.kart_host:
            jprint({"type": "bridge_error", "error": "no_kart_known",
                    "kind": kind})
            return
        try:
            self.esp.send(self.kart_host, ujson.dumps(data), False)
            # Hinweis ans Dashboard dass weitergeleitet wurde (nur fuer 'display' optional)
            # Bridge-Display informieren bei Pit-Call
            if kind == "pit_call":
                action = data.get("action", "trigger")
                if action == "cancel":
                    self.display.show_message("PIT-CALL", "abgebrochen", 1500)
                else:
                    msg = data.get("message", "PIT STOP")[:14]
                    self.display.show_message("PIT-CALL TX", msg, 3000)
        except Exception as e:
            jprint({"type": "bridge_error", "error": "send_failed",
                    "detail": str(e)})

    # ── Heartbeat & Hello ─────────────────────────────────────────────────

    def _send_heartbeat(self):
        now = utime.ticks_ms()
        if utime.ticks_diff(now, self.last_hb_ms) < Config.HEARTBEAT_MS:
            return
        self.last_hb_ms = now
        self._send_status()

    def _send_status(self):
        mac = ubinascii.hexlify(self.wlan.config("mac"), ":").decode()
        kart = (ubinascii.hexlify(self.kart_host, ":").decode()
                if self.kart_host else None)
        jprint({
            "type":      "bridge_status",
            "bridge":    "alive",
            "mac":       mac,
            "channel":   Config.ESPNOW_CHANNEL,
            "rx_count":  self.stats.rx_count,
            "lost":      self.stats.lost,
            "last_seq":  self.stats.last_seq,
            "kart_mac":  kart,
            "rate_hz":   self.stats.packets_per_sec,
            "usb_errors": self.usb_errors,
        })

    def _send_hello(self):
        """Sendet ein Hello-Paket an den Kart, aber nur wenn vom Kart
        laenger nichts kam (HELLO_QUIET_MS). Spart Airtime."""
        if not self.kart_host:
            return
        now = utime.ticks_ms()
        if utime.ticks_diff(now, self.last_hello_ms) < Config.HELLO_MS:
            return
        # Nur senden wenn Kart laenger nichts geschickt hat
        if self.stats.packet_age_ms < Config.HELLO_QUIET_MS:
            return
        self.last_hello_ms = now
        try:
            self.esp.send(self.kart_host,
                          ujson.dumps({"type": "bridge_hello"}), False)
        except Exception:
            pass

    # ── Peer-Verwaltung ───────────────────────────────────────────────────

    def _add_peer(self, host):
        key = ubinascii.hexlify(host).decode()
        if key in self.known_peers:
            return
        try:
            self.esp.add_peer(host)
            self.known_peers.add(key)
        except Exception:
            pass


# ── Start ─────────────────────────────────────────────────────────────────

# Laeuft los, egal ob als Hauptprogramm gestartet oder aus boot.py importiert.
Bridge().run()
