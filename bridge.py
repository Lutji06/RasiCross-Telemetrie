# ============================================================
#  RasiCross  --  BRIDGE ESP32  ESP-NOW ⇆ USB SERIAL
# ============================================================
#  Rolle:    Boxen-seitiger ESP. Empfängt Telemetrie vom Kart
#            per ESP-NOW und gibt sie als JSON-Lines per USB-Serial
#            an das Dashboard aus. Leitet Steuerpakete (Config,
#            IMU-Kalibrierung) vom Dashboard zurück an den Kart.
#
#  Pins (Standard, im Config-Block änderbar):
#    Status-LED→ GPIO 2 (onboard)
#
#  Was ist neu vs. v8:
#    • Saubere Trennung: Stats / Bridge / I/O
#    • Bridge sendet "bridge_hello" beim Start → Sender lernt MAC
#      automatisch (kein Hardcoding mehr nötig im Notfall)
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
    from machine import Pin, WDT
    _HAS_WDT = True
except Exception:
    _HAS_WDT = False
    try:
        from machine import Pin
    except Exception:
        pass

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

    # Funk: ESP-NOW laeuft im reinen Long-Range-Modus.
    # WICHTIG: Sender muss auch im LR-Mode laufen!
    WIFI_TX_POWER_DBM = 20       # Sendeleistung in dBm (20 = EU-Max)

    # Multi-Kart
    MAX_KARTS         = 4       # max gleichzeitig verwaltete Karts

    # Status-LED
    LED_ENABLED       = True
    LED_PIN           = 2
    LED_BLINK_MS      = 500


def jprint(obj):
    """Eine JSON-Zeile auf stdout — das ist das Dashboard-Protokoll."""
    print(ujson.dumps(obj))


# ── Persistenz ────────────────────────────────────────────────────────────

class PeerStore:
    """Speichert die bekannten Kart-MACs im ESP32-NVS (Liste, <= MAX_KARTS),
    sodass die Bridge nach einem Reboot ohne Neulernen direkt senden kann."""

    NAMESPACE = "rasicross"
    KEY       = "kart_macs"          # neue Liste; alter Single-Key wird migriert
    LEGACY_KEY = "kart_mac"

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
        """-> list[bytes] (6-Byte MACs). Migriert alten Single-Key einmalig."""
        if not self._nvs:
            return []
        macs = []
        try:
            buf = bytearray(6 * Config.MAX_KARTS)
            n = self._nvs.get_blob(self.KEY, buf)
            for i in range(0, n - (n % 6), 6):
                macs.append(bytes(buf[i:i + 6]))
        except Exception:
            pass
        if not macs:                              # Migration: alter Single-Slot
            try:
                lbuf = bytearray(6)
                if self._nvs.get_blob(self.LEGACY_KEY, lbuf) == 6:
                    macs.append(bytes(lbuf))
            except Exception:
                pass
        return macs

    def save_list(self, mac_list):
        if not self._nvs:
            return
        try:
            blob = b"".join(m for m in mac_list if m and len(m) == 6)[:6 * Config.MAX_KARTS]
            self._nvs.set_blob(self.KEY, blob if blob else b"")
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
        self.last_rssi  = None
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

        # RSSI des letzten Pakets (speist bridge_status)
        if "rssi" in data:
            try: self.last_rssi = int(data["rssi"])
            except (TypeError, ValueError): pass

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

        # Modem-Powersave AUS: Seit IDF 5.x (MicroPython >= 1.28) legt das
        # STA-Interface das Funkmodul ohne AP-Verbindung schlafen und
        # verpasst dann eingehende ESP-NOW-Pakete. PM_NONE haelt den
        # Empfaenger dauerhaft wach (Telemetrie-Empfang = Kernaufgabe).
        try:
            self.wlan.config(pm=self.wlan.PM_NONE)
            print("[init] WiFi-Powersave aus (PM_NONE)")
        except Exception as e:
            print("[init] WARNUNG: PM_NONE nicht setzbar:", e)

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
        self.karts        = {}    # {mac_bytes: Stats} — Multi-Kart
        self.kart_host    = None  # zuletzt gehoerte MAC (Legacy-Felder)
        self.known_peers  = set()
        self.last_hb_ms   = utime.ticks_ms()
        self.last_hello_ms = 0
        self.last_usb_at  = 0
        self.usb_errors   = 0

        # Persistente Peer-Liste: bekannte Kart-MACs ueberleben Reboot
        self.peer_store = PeerStore()
        for saved_mac in self.peer_store.load():
            self.karts[saved_mac] = Stats()
            self.kart_host = saved_mac
            self._add_peer(saved_mac)
            print("[init] Kart-MAC aus NVS geladen:",
                  ubinascii.hexlify(saved_mac, ":").decode())

        # Broadcast-Peer fuer Pairing-Hellos, solange kein Kart bekannt ist.
        # Ohne diesen Peer kann esp_now.send() den Broadcast nicht raustragen.
        self._bcast = b'\xff\xff\xff\xff\xff\xff'
        try:
            self.esp.add_peer(self._bcast)
        except Exception:
            pass

        # Watchdog
        self.wdt = None
        if _HAS_WDT and Config.WATCHDOG_MS > 0:
            try:
                self.wdt = WDT(timeout=Config.WATCHDOG_MS)
                print("[init] Watchdog aktiv:", Config.WATCHDOG_MS, "ms")
            except Exception as e:
                print("[init] WDT init fehler:", e)

        # Status-LED
        self.led = StatusLED()

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
        })

    def _stats_for(self, mac):
        st = self.karts.get(mac)
        if st is None:
            if len(self.karts) >= Config.MAX_KARTS:
                return None
            st = Stats()
            self.karts[mac] = st
        return st

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

    # ── Status-Aktualisierungen (LED + Stats-Tick) ────────────────────────

    def _update_status(self):
        for st in self.karts.values():
            st.tick()
        usb_alive = self._usb_alive()
        recent = any(st.packet_age_ms < 2000 for st in self.karts.values())
        self.led.update(
            packets_recent = recent,
            usb_connected  = usb_alive,
        )

    def _usb_alive(self):
        if not self.last_usb_at:
            return False
        return utime.ticks_diff(utime.ticks_ms(), self.last_usb_at) < 5000

    # ── Empfangen ─────────────────────────────────────────────────────────

    def _handle_packet(self, host, msg):
        # Peer-Lernen (Routing/RSSI); Stats-Zuordnung erfolgt nach dem Parsen.
        if host:
            self._add_peer(host)

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

        # Stats pro Kart-MAC fuehren + Peer-Liste persistieren
        if host:
            if host not in self.karts and len(self.karts) < Config.MAX_KARTS:
                self.karts[host] = Stats()
                self.peer_store.save_list(list(self.karts.keys()))
            self.kart_host = host          # zuletzt gehoert (Legacy-Felder)
        st = self._stats_for(host) if host else None
        if st is None:
            jprint({"type": "bridge_info", "info": "kart_limit",
                    "max": Config.MAX_KARTS})
            return
        st.on_packet(data)

        # Metadaten an Dashboard anreichern
        data["source"]    = "espnow_usb"
        data["rx_count"]  = st.rx_count
        data["lost"]      = st.lost
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
                    # Additiv registrieren (Multi-Kart) — nicht den Slot ueberschreiben
                    if mac_bytes not in self.karts and len(self.karts) < Config.MAX_KARTS:
                        self.karts[mac_bytes] = Stats()
                    self.kart_host = mac_bytes
                    self._add_peer(mac_bytes)
                    self.peer_store.save_list(list(self.karts.keys()))
                    jprint({"type": "bridge_info",
                            "info": "kart_mac_set",
                            "kart_mac": mac_str})
            except Exception as e:
                jprint({"type": "bridge_error",
                        "error": "set_kart_mac_failed",
                        "detail": str(e)})
            return

        # Einen bekannten Kart vergessen (aus Liste + NVS entfernen)
        if t == "forget_kart_mac":
            mac_str = data.get("mac", "")
            try:
                clean = mac_str.replace(":", "").replace("-", "")
                if len(clean) == 12:
                    mb = bytes.fromhex(clean)
                    self.karts.pop(mb, None)
                    try: self.esp.del_peer(mb)
                    except Exception: pass
                    self.known_peers.discard(ubinascii.hexlify(mb).decode())
                    if self.kart_host == mb:
                        self.kart_host = next(iter(self.karts), None)
                    self.peer_store.save_list(list(self.karts.keys()))
                    jprint({"type": "bridge_info", "info": "kart_forgotten", "mac": mac_str})
            except Exception as e:
                jprint({"type": "bridge_error", "error": "forget_failed", "detail": str(e)})
            return

        # Alle Karts vergessen (kompletter Reset der Peer-Liste)
        if t == "reset_karts":
            for mb in list(self.karts.keys()):
                try: self.esp.del_peer(mb)
                except Exception: pass
            self.karts.clear()
            self.known_peers.clear()
            self.kart_host = None
            self.peer_store.save_list([])
            jprint({"type": "bridge_info", "info": "karts_reset"})
            return

        # Steuer-Pakete an den Kart weiterleiten. WICHTIG: die rohe
        # USB-Zeile durchreichen, nicht neu serialisieren -- ujson.dumps
        # fuegt Leerzeichen ein und schiebt das 13-Felder-config ueber
        # das 250-Byte-ESP-NOW-Limit (228 B kompakt -> 255 B ujson).
        if t in ("config", "imu_calibrate", "config_get"):
            self._forward_to_kart(t, data, line)
            return

        # Unbekannter Typ
        jprint({"type": "bridge_error", "error": "unknown_type",
                "received": str(t)})

    def _forward_to_kart(self, kind, data, raw=None):
        # Ziel-Kart bestimmen: target_mac (vom Dashboard gesetzt) hat Vorrang,
        # sonst Fallback auf den zuletzt gehoerten Kart (Single-Kart-Verhalten).
        target = None
        tm = data.get("target_mac")
        if tm:
            try:
                clean = tm.replace(":", "").replace("-", "")
                if len(clean) == 12:
                    target = bytes.fromhex(clean)
            except Exception:
                target = None
        if target is None:
            target = self.kart_host
        if not target:
            jprint({"type": "bridge_error", "error": "no_target",
                    "kind": kind})
            return
        # Rohe Dashboard-Zeile bevorzugen (kompaktes JSON.stringify);
        # ujson.dumps nur als Fallback fuer intern erzeugte Pakete.
        # target_mac ist ein reines Routing-Feld; das Kart ignoriert es.
        payload = raw if raw is not None else ujson.dumps(data)
        if len(payload) > 250:
            jprint({"type": "bridge_error", "error": "payload_too_long",
                    "kind": kind, "bytes": len(payload)})
            return
        try:
            self.esp.send(target, payload, False)
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
        karts = []
        agg_rx = 0
        for m, st in self.karts.items():
            agg_rx += st.rx_count
            karts.append({
                "mac":      ubinascii.hexlify(m, ":").decode(),
                "rate_hz":  st.packets_per_sec,
                "rssi":     st.last_rssi,
                "lost":     st.lost,
                "last_seq": st.last_seq,
                "age":      st.packet_age_ms,
            })
        host = self.kart_host
        host_st = self.karts.get(host) if host else None
        jprint({
            "type":      "bridge_status",
            "bridge":    "alive",
            "mac":       mac,
            "channel":   Config.ESPNOW_CHANNEL,
            "rx_count":  agg_rx,
            "lost":      host_st.lost if host_st else 0,
            "last_seq":  host_st.last_seq if host_st else None,
            "kart_mac":  ubinascii.hexlify(host, ":").decode() if host else None,
            "rate_hz":   host_st.packets_per_sec if host_st else 0,
            "karts":     karts,
            "usb_errors": self.usb_errors,
        })

    def _send_hello(self):
        """Sendet ein Hello-Paket an den Kart.
        - Bekanntes Kart: gerichtet, nur wenn Kart laenger nichts geschickt
          hat (HELLO_QUIET_MS, spart Airtime).
        - Unbekanntes Kart (Pairing-Phase): per Broadcast, damit ein frisch
          gestartetes Kart die Bridge-MAC ohne Hardcoding lernen kann.
          Loest das Cold-Start-Henne-Ei-Problem zwischen Sender und Bridge."""
        now = utime.ticks_ms()
        if utime.ticks_diff(now, self.last_hello_ms) < Config.HELLO_MS:
            return

        if self.karts:
            # Gerichtetes Hello an jedes Kart, das laenger nichts geschickt hat
            self.last_hello_ms = now
            hello = ujson.dumps({"type": "bridge_hello"})
            for mac, st in self.karts.items():
                if st.packet_age_ms < Config.HELLO_QUIET_MS:
                    continue
                try:
                    self.esp.send(mac, hello, False)
                except Exception:
                    pass
        else:
            # Pairing-Broadcast — kein Kart bekannt
            self.last_hello_ms = now
            try:
                self.esp.send(self._bcast,
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
