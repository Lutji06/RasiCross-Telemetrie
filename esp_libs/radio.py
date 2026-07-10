# ============================================================
#  RasiCross — radio.py  (ESP-NOW Link, Phase 45)
#  Herausgeloest aus sender.py — NUR bewegt, nicht geaendert.
#  Funk-Protokoll unveraendert: Binaer-Frame via frame.py,
#  JSON-Steuerpakete, 250-B-Budget.
# ============================================================

import network
import espnow
import ujson
import ubinascii
import utime

try:
    import frame
    _HAS_FRAME = True
except ImportError:
    _HAS_FRAME = False

from config_store import Config, log

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

        # Modem-Powersave AUS: Seit IDF 5.x (MicroPython >= 1.28) legt das
        # STA-Interface das Funkmodul ohne AP-Verbindung schlafen und
        # verpasst dann eingehende ESP-NOW-Pakete -- Senden geht weiter,
        # aber der Rueckkanal (config/display/pit_call) stirbt nach kurzer
        # Zeit. PM_NONE haelt den Empfaenger dauerhaft wach.
        try:
            self._sta.config(pm=self._sta.PM_NONE)
            log("init", "WiFi-Powersave aus (PM_NONE)")
        except Exception as e:
            log("init", "WARNUNG: PM_NONE nicht setzbar:", e)

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

        # ESP-NOW PHY-Rate auf Long-Range stellen — 250 kbit/s,
        # Sensitivitaet ~-129 dBm = maximale Reichweite.
        try:
            self._esp.config(rate=41)  # WIFI_PHY_RATE_LORA_250K (0x29)
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
        # Sequenznummer kommt in den Binaer-Frame (Bridge misst Verlust)
        seq = self._seq
        self._seq = (self._seq + 1) & 0xFFFF
        if not _HAS_FRAME:
            log("link", "FATAL: frame.py fehlt auf dem Kart -- bitte flashen")
            self.tx_fail_run += 1
            return False
        payload = frame.pack(data, seq)

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

    def send_json(self, obj):
        """Kleines JSON-Steuerpaket an die Bridge (kein Binaer-Frame).
        Die Bridge reicht JSON vom Kart unveraendert ans Dashboard durch."""
        if not self._bridge_mac:
            return False
        try:
            return bool(self._esp.send(self._bridge_mac, ujson.dumps(obj), True))
        except Exception:
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
        if not isinstance(data, dict):
            return None      # Nicht-Objekt-JSON (Zahl/Liste/String) -> ignorieren
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
