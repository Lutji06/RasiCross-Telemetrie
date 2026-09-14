# ============================================================
#  RasiCross -- test_firmware.py  (sender.py + bridge.py unter CPython)
# ============================================================
#  Faehrt die echte Firmware gegen die Stubs aus mpstub.py: Sender-
#  Hauptschleife, Bridge-Empfang, Rueckkanal und die komplette Kette
#  Sensor -> frame -> ESP-NOW -> JSON-Zeile -> Dashboard-Felder.
#  Ohne das ist die Firmware nur lesbar, nicht pruefbar.
# ============================================================
import io
import json
import os
import sys
import types
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
import mpstub  # noqa: E402
mpstub.install()
sys.path.insert(0, os.path.join(ROOT, 'esp_libs'))
import frame  # noqa: E402

KART = b'\xde\xad\x00\x00\x00\x01'


def _load(filename, drop):
    """Programm laden, ohne dass es losrennt: beide Dateien starten am
    Ende selbst (main() / Bridge().run()) -- genau die Zeile faellt weg."""
    with io.open(os.path.join(ROOT, filename), encoding='utf-8') as fh:
        src = fh.read()
    assert drop in src, filename + ': Startzeile ' + drop + ' nicht gefunden'
    mod = types.ModuleType(filename.replace('.py', '_mod'))
    mod.__dict__['sys'] = sys
    exec(compile(src.replace(drop, ''), filename, 'exec'), mod.__dict__)
    return mod


class _Capture:
    """bridge.py spricht ueber print() -- stdout einsammeln und als
    JSON-Zeilen zurueckgeben (das ist das Dashboard-Protokoll)."""

    def __enter__(self):
        self._real = sys.stdout
        self.lines = []
        outer = self

        class Sink(io.TextIOBase):
            def write(self, s):
                if s.strip():
                    outer.lines.append(s.strip())
                return len(s)
        sys.stdout = Sink()
        return self

    def __exit__(self, *a):
        sys.stdout = self._real
        return False

    def json(self):
        return [json.loads(x) for x in self.lines if x.startswith('{')]


class _FakeStdin:
    def __init__(self):
        self.lines = []

    def readline(self):
        return self.lines.pop(0) if self.lines else ""


def _bridge():
    """Bridge mit gefaktem USB-Rueckkanal. Wichtig: select.POLLIN gibt es
    unter Windows nicht -- ohne den Stub faellt bridge.py still auf
    return_channel=False zurueck und der Rueckkanal bliebe ungetestet."""
    import select as _sel
    stdin = _FakeStdin()

    class FakePoll:
        def register(self, *a, **k):
            pass

        def poll(self, t=0):
            return [(stdin, 1)] if stdin.lines else []

    _sel.poll = FakePoll
    _sel.POLLIN = 1
    with _Capture():
        mod = _load('bridge.py', 'Bridge().run()')
        mod.sys.stdin = stdin
        b = mod.Bridge()
    return mod, b, stdin


class SenderLaeuft(unittest.TestCase):
    def test_hauptschleife_sendet_gueltige_frames(self):
        utime = sys.modules['utime']
        clock = {'ms': 0}
        stop = {'n': 0}
        utime.ticks_ms = lambda: clock['ms']
        utime.ticks_us = lambda: clock['ms'] * 1000

        class Stop(Exception):
            pass

        def sleep_ms(ms):
            clock['ms'] += 10          # Modellzeit, damit die Sende-Kadenz greift
            stop['n'] += 1
            if stop['n'] > 300:
                raise Stop()
        utime.sleep_ms = sleep_ms

        with _Capture():
            mod = _load('sender.py', '\nmain()')
            # Bridge-Hello in die Inbox: der Sender lernt die MAC daraus.
            orig = mod.ESPNowLink.__init__
            seen = {}

            def patched(self, bridge_mac):
                orig(self, bridge_mac)
                seen['link'] = self
                self._esp.inbox.append(
                    (b'\xaa\xbb\xcc\x00\x00\x09',
                     json.dumps({"type": "bridge_hello"})))
            mod.ESPNowLink.__init__ = patched
            try:
                mod.main()
            except Stop:
                pass

        link = seen['link']
        frames = [m for _, m in link._esp.sent
                  if isinstance(m, (bytes, bytearray)) and len(m) == frame.SIZE]
        self.assertGreater(len(frames), 10, "Sender hat kaum Frames geschickt")
        for buf in frames:
            self.assertNotIn("_err", frame.unpack(buf))
        # Auto-Pairing: MAC kam aus dem bridge_hello, nicht aus der Config
        self.assertEqual(link._bridge_mac, b'\xaa\xbb\xcc\x00\x00\x09')


class BridgeEmpfang(unittest.TestCase):
    def test_frame_wird_zur_dashboard_zeile(self):
        _mod, b, _stdin = _bridge()
        b.esp.peers_table = {KART: [-63, 0]}   # RSSI wie MicroPython 1.21+
        tele = {"speed": 37.4, "rpm": 4210, "gx": 0.31, "gy": -0.22, "gz": 0.98,
                "yaw": -88.5, "roll": 12.3, "lat": 49.6012345, "lon": 6.1198765,
                "gps_fix": 1, "gps_health": "ok", "pulse_hz": 70.2,
                "send_ms": 80, "spd_src": "gps", "imu_cal": 0, "glitch": 3,
                "batt_warn": 0, "vbat": 12.34, "soc": 88, "mtemp": 31}
        with _Capture() as cap:
            b._handle_packet(KART, frame.pack(tele, 1234))
        pkt = next(m for m in cap.json() if m.get('source') == 'espnow_usb')

        # Alles, was das Dashboard aus einem Telemetrie-Paket liest
        for key in ('speed', 'rpm', 'gx', 'gy', 'gz', 'yaw', 'roll', 'lat',
                    'lon', 'gps_fix', 'pulse_hz', 'spd_src', 'glitch',
                    'batt_warn', 'vbat', 'soc', 'mtemp', 'seq', 'rssi',
                    'from_mac', 'lost'):
            self.assertIn(key, pkt, "Dashboard-Feld fehlt: " + key)
        for key in ('rpm', 'soc', 'mtemp', 'glitch', 'spd_src', 'gps_health'):
            self.assertEqual(pkt[key], tele[key], key)
        self.assertEqual(pkt['seq'], 1234)
        self.assertEqual(pkt['rssi'], -63)
        self.assertEqual(pkt['from_mac'], 'de:ad:00:00:00:01')
        self.assertAlmostEqual(pkt['lat'], tele['lat'], places=6)

    def test_abgewiesenes_kart_wird_nicht_kart_host(self):
        """Ueber MAX_KARTS hinaus: das abgewiesene Kart darf die Legacy-
        Felder nicht kapern. Vorher zeigte bridge_status.kart_mac auf ein
        Kart ohne Stats und _forward_to_kart schickte Steuerpakete ohne
        target_mac genau dorthin."""
        mod, b, _stdin = _bridge()
        with _Capture():
            for n in range(1, mod.Config.MAX_KARTS + 2):
                mac = bytes([0xde, 0xad, 0, 0, 0, n])
                b._handle_packet(mac, frame.pack({"speed": 1.0 * n}, n))
        ueberzaehlig = bytes([0xde, 0xad, 0, 0, 0, mod.Config.MAX_KARTS + 1])
        self.assertNotIn(ueberzaehlig, b.karts)
        self.assertNotEqual(b.kart_host, ueberzaehlig)
        self.assertIn(b.kart_host, b.karts)
        with _Capture() as cap:
            b._send_status()
        st = next(m for m in cap.json() if m.get('type') == 'bridge_status')
        self.assertIsNotNone(st['last_seq'], "kart_mac zeigt auf ein Kart ohne Stats")


class Rueckkanal(unittest.TestCase):
    """Dashboard -> Bridge -> Kart. Genau der Weg, der die Einstellungen
    an den ESP bringt."""

    CFG = {"type": "config", "target_mac": "de:ad:00:00:00:01", "send_ms": 100,
           "pulses_per_rev": 2, "wheel_circ_m": 1.2, "gear_ratio": 3.0,
           "batt_cells": 3, "batt_warn_v": 3.5, "batt_crit_v": 3.3,
           "batt_cal": 1.0, "rpm_ceiling": 16000, "rpm_alpha": 0.25}

    def test_config_erreicht_das_richtige_kart(self):
        _mod, b, stdin = _bridge()
        with _Capture():
            b._handle_packet(KART, frame.pack({"speed": 1.0}, 1))
        b.esp.sent.clear()
        raw = json.dumps(self.CFG, separators=(',', ':'))
        stdin.lines.append(raw + "\n")
        with _Capture():
            b._handle_usb()
        self.assertEqual([m for m, _ in b.esp.sent], [KART])
        # Die ROHE Zeile geht raus (ujson.dumps wuerde sie ueber 250 B blaehen)
        self.assertEqual(b.esp.sent[0][1], raw)
        self.assertLessEqual(len(raw), 250, "Config sprengt das ESP-NOW-Limit")

    def test_kart_uebernimmt_und_bestaetigt(self):
        import config_store

        class FakeRpm:
            ppr = 1

            def set_ppr(self, v):
                self.ppr = max(1, min(99, int(v)))

            def recalc_glitch_filter(self):
                pass

        r = FakeRpm()
        with _Capture():          # apply_config loggt die uebernommene Config
            config_store.apply_config(dict(self.CFG), r)
        self.assertEqual(config_store.Config.SEND_MS, 100)
        self.assertEqual(r.ppr, 2)
        self.assertEqual(config_store.Config.BATT_CELLS, 3)
        self.assertAlmostEqual(config_store.Config.GEAR_RATIO, 3.0)
        ack = config_store.config_ack(r)
        self.assertEqual(ack['type'], 'config_ack')
        # Kompakte Funk-Keys -- Gegenstueck ESP_CFG_FIELDS in esp-config.js
        for k in ('sm', 'ppr', 'wc', 'gear', 'bc', 'rcl', 'ra', 'bwv', 'bcv', 'bcal'):
            self.assertIn(k, ack)
        self.assertLessEqual(len(json.dumps(ack, separators=(',', ':'))), 250)


if __name__ == '__main__':
    unittest.main()
