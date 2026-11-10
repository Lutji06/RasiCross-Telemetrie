# ============================================================
#  RasiCross -- test_ota.py  (esp_libs/ota.py unter CPython)
# ============================================================
#  Das Empfangsmodul ist reine Datei-/Zustandslogik und laeuft deshalb
#  komplett gegen ein Temp-Verzeichnis: Uebertragung, Duplikate, Luecken,
#  falsche Pruefsumme, Abbruch, Timeout. Der Bootlader hat seine eigene
#  Datei (test_ota_boot.py).
# ============================================================
import base64
import hashlib
import json
import os
import shutil
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
import mpstub  # noqa: E402
mpstub.install()
sys.path.insert(0, os.path.join(ROOT, 'esp_libs'))
import ota  # noqa: E402

PKG = "0123456789abcdef"
TARGET = "aa:bb:cc:dd:ee:ff"


def b64(data):
    return base64.b64encode(data).decode()


def sha(data):
    return hashlib.sha256(data).hexdigest()


def compact(obj):
    return json.dumps(obj, separators=(",", ":"))


def send_package(rx, files, pkg_id=PKG, chunk=120, lbl="2.1.0"):
    """begin + je Datei file/data -- ohne ota_end. Gibt alle Antworten zurueck."""
    acks = [rx.handle({"type": "ota_begin", "id": pkg_id, "lbl": lbl,
                       "n": len(files), "sz": sum(len(d) for d in files.values())}, 0)]
    for i, (name, data) in enumerate(files.items()):
        acks.append(rx.handle({"type": "ota_file", "i": i, "name": name,
                               "sz": len(data), "sha": sha(data)}, 0))
        for o in range(0, len(data), chunk):
            acks.append(rx.handle({"type": "ota_data", "i": i, "o": o,
                                   "d": b64(data[o:o + chunk])}, 0))
    return acks


class _Tmp(unittest.TestCase):
    def setUp(self):
        self.root = tempfile.mkdtemp(prefix="rasi-ota-")
        self._free = ota.free_bytes

    def tearDown(self):
        ota.free_bytes = self._free
        shutil.rmtree(self.root, ignore_errors=True)

    def path(self, *parts):
        return os.path.join(self.root, *parts)


class TestOtaBasics(_Tmp):
    def test_valid_name(self):
        for ok in ("app.mpy", "frame.mpy", "gps_task.mpy", "calc.py"):
            self.assertTrue(ota.valid_name(ok), ok)
        for bad in ("main.py", "boot.py", "../x.mpy", "a/b.mpy", "App.mpy",
                    "x.txt", "", ".mpy", "ota_manifest.json", "a" * 30 + ".mpy",
                    None, 5):
            self.assertFalse(ota.valid_name(bad), bad)

    def test_state_roundtrip(self):
        self.assertEqual(ota.read_state(self.root), "")
        ota.write_state(self.root, "trial")
        self.assertEqual(ota.read_state(self.root), "trial")
        ota.write_state(self.root, "")
        self.assertFalse(os.path.exists(self.path("ota_state")))

    def test_info_fresh_device(self):
        info = ota.OtaReceiver(self.root).info()
        self.assertEqual(info["type"], "ota_info")
        self.assertEqual(info["id"], "")
        self.assertEqual(info["st"], "ok")
        self.assertIsInstance(info["free"], int)

    def test_info_reports_installed_and_rolledback(self):
        with open(self.path("ota_manifest.json"), "w") as f:
            json.dump({"id": "abcdef0123456789", "lbl": "2.1.0", "files": ["app.mpy"]}, f)
        ota.write_state(self.root, "rolledback")
        info = ota.OtaReceiver(self.root).info()
        self.assertEqual((info["id"], info["lbl"], info["st"]),
                         ("abcdef0123456789", "2.1.0", "rolledback"))

    def test_broken_manifest_reads_as_empty(self):
        with open(self.path("ota_manifest.json"), "w") as f:
            f.write("{kaputt")
        self.assertEqual(ota.read_manifest(self.root), {"id": "", "lbl": "", "files": []})

    def test_info_fits_radio_budget(self):
        info = ota.OtaReceiver(self.root).info()
        info.update(id="f" * 16, lbl="99.99.99", st="rx", rid="f" * 16, i=99, o=999999,
                    free=99999999)
        self.assertLessEqual(len(compact(info)), 250)


class TestOtaTransfer(_Tmp):
    def setUp(self):
        super().setUp()
        self.rx = ota.OtaReceiver(self.root)

    def begin(self, n=1, sz=240, pkg_id=PKG, now=0):
        return self.rx.handle({"type": "ota_begin", "id": pkg_id, "lbl": "2.1.0",
                               "n": n, "sz": sz}, now)

    def file(self, data, i=0, name="app.mpy", digest=None):
        return self.rx.handle({"type": "ota_file", "i": i, "name": name,
                               "sz": len(data), "sha": digest or sha(data)}, 0)

    def data(self, chunk, o, i=0, now=0):
        return self.rx.handle({"type": "ota_data", "i": i, "o": o, "d": b64(chunk)}, now)

    def new_files(self):
        d = self.path("ota_new")
        return sorted(os.listdir(d)) if os.path.isdir(d) else []

    def test_full_transfer_marks_ready(self):
        files = {"app.mpy": os.urandom(1000), "frame.mpy": os.urandom(333)}
        acks = send_package(self.rx, files)
        self.assertTrue(all("e" not in a for a in acks), acks)
        end = self.rx.handle({"type": "ota_end"}, 0)
        self.assertNotIn("e", end)
        self.assertEqual(ota.read_state(self.root), "ready")
        self.assertTrue(self.rx.reboot_requested)
        self.assertEqual(self.rx.info()["st"], "ready")
        for name, data in files.items():
            with open(self.path("ota_new", name), "rb") as f:
                self.assertEqual(f.read(), data)
        with open(self.path("ota_new", "ota_manifest.json")) as f:
            self.assertEqual(json.load(f), {"id": PKG, "lbl": "2.1.0",
                                            "files": ["app.mpy", "frame.mpy"]})

    def test_acks_report_next_expected_position(self):
        blob = os.urandom(240)
        self.begin(n=2, sz=480)
        self.assertEqual(self.file(blob)["o"], 0)
        a = self.data(blob[:120], 0)
        self.assertEqual((a["s"], a["i"], a["o"]), ("data", 0, 120))
        a = self.data(blob[120:], 120)
        self.assertEqual((a["i"], a["o"]), (1, 0))       # Datei 0 fertig -> weiter bei 1

    def test_duplicate_chunk_is_acked_not_written(self):
        blob = os.urandom(240)
        self.begin()
        self.file(blob)
        self.data(blob[:120], 0)
        dup = self.data(blob[:120], 0)
        self.assertNotIn("e", dup)
        self.assertEqual(dup["o"], 120)
        self.assertEqual(os.path.getsize(self.path("ota_new", "app.mpy")), 120)

    def test_duplicate_of_last_chunk_after_file_complete(self):
        blob = os.urandom(240)
        self.begin(n=2, sz=480)
        self.file(blob)
        self.data(blob[:120], 0)
        self.data(blob[120:], 120)
        dup = self.data(blob[120:], 120)
        self.assertNotIn("e", dup)
        self.assertEqual((dup["i"], dup["o"]), (1, 0))
        self.assertEqual(os.path.getsize(self.path("ota_new", "app.mpy")), 240)

    def test_gap_is_rejected_with_expected_offset(self):
        blob = os.urandom(240)
        self.begin()
        self.file(blob)
        gap = self.data(blob[120:], 120)
        self.assertEqual((gap["e"], gap["o"]), ("gap", 0))
        p = self.path("ota_new", "app.mpy")
        self.assertTrue(not os.path.exists(p) or os.path.getsize(p) == 0)

    def test_chunk_beyond_declared_size(self):
        blob = os.urandom(100)
        self.begin(sz=100)
        self.file(blob)
        self.assertEqual(self.data(blob + b"zuviel", 0)["e"], "size")
        p = self.path("ota_new", "app.mpy")
        self.assertTrue(not os.path.exists(p) or os.path.getsize(p) == 0)

    def test_bad_base64_is_io_error(self):
        self.begin()
        self.file(os.urandom(240))
        r = self.rx.handle({"type": "ota_data", "i": 0, "o": 0, "d": "###"}, 0)
        self.assertEqual(r["e"], "io")

    def test_bad_name_rejected_nothing_written(self):
        self.begin()
        for name in ("main.py", "../x.mpy", "boot.py", "sub/x.mpy"):
            self.assertEqual(self.file(b"x" * 240, name=name)["e"], "name", name)
        self.assertEqual(self.new_files(), [])
        self.assertFalse(os.path.exists(os.path.join(os.path.dirname(self.root), "x.mpy")))

    def test_file_sizes_must_fit_announced_total(self):
        self.begin(n=2, sz=240)
        self.assertEqual(self.file(b"x" * 241)["e"], "size")
        self.assertEqual(self.rx.handle({"type": "ota_file", "i": 0, "name": "app.mpy",
                                         "sz": 0, "sha": "0" * 64}, 0)["e"], "size")

    def test_file_out_of_order(self):
        blob = os.urandom(240)
        self.begin(n=2, sz=480)
        self.assertEqual(self.file(blob, i=1)["e"], "state")
        self.file(blob)
        self.data(blob[:120], 0)
        # naechste Datei, obwohl die laufende noch unvollstaendig ist
        self.assertEqual(self.file(blob, i=1, name="frame.mpy")["e"], "state")
        # dieselbe Datei erneut angekuendigt -> Ack mit aktuellem Stand
        again = self.file(blob)
        self.assertNotIn("e", again)
        self.assertEqual(again["o"], 120)

    def test_wrong_hash_discards_everything(self):
        blob = os.urandom(240)
        self.begin()
        self.file(blob, digest=sha(b"etwas anderes"))
        self.data(blob[:120], 0)
        self.data(blob[120:], 120)
        end = self.rx.handle({"type": "ota_end"}, 0)
        self.assertEqual((end["e"], end["i"]), ("hash", 0))
        self.assertFalse(os.path.exists(self.path("ota_new")))
        self.assertEqual(ota.read_state(self.root), "")
        self.assertFalse(self.rx.active)
        self.assertFalse(self.rx.reboot_requested)

    def test_end_before_complete(self):
        blob = os.urandom(240)
        self.begin()
        self.file(blob)
        self.data(blob[:120], 0)
        self.assertEqual(self.rx.handle({"type": "ota_end"}, 0)["e"], "state")
        self.assertEqual(ota.read_state(self.root), "")

    def test_end_with_missing_file(self):
        blob = os.urandom(120)
        self.begin(n=2, sz=240)
        self.file(blob)
        self.data(blob, 0)
        self.assertEqual(self.rx.handle({"type": "ota_end"}, 0)["e"], "state")

    def test_data_without_begin(self):
        self.assertEqual(self.data(b"x" * 10, 0)["e"], "state")
        self.assertEqual(self.file(b"x" * 10)["e"], "state")
        self.assertEqual(self.rx.handle({"type": "ota_end"}, 0)["e"], "state")

    def test_resume_same_id_keeps_progress(self):
        blob = os.urandom(480)
        self.begin(sz=480)
        self.file(blob)
        self.data(blob[:120], 0)
        self.data(blob[120:240], 120)
        again = self.begin(sz=480)
        self.assertNotIn("e", again)
        self.assertEqual((again["i"], again["o"]), (0, 240))
        other = self.begin(sz=480, pkg_id="ffffffffffffffff")
        self.assertEqual((other["i"], other["o"]), (0, 0))
        self.assertEqual(self.new_files(), [])

    def test_no_space(self):
        ota.free_bytes = lambda root: 1000
        r = self.begin(sz=5000)
        self.assertEqual(r["e"], "space")
        self.assertFalse(self.rx.active)

    def test_unknown_free_space_counts_as_enough(self):
        ota.free_bytes = lambda root: -1
        self.assertNotIn("e", self.begin(sz=5000))

    def test_timeout_leaves_update_mode_but_keeps_partial(self):
        blob = os.urandom(240)
        self.begin()
        self.file(blob)
        self.data(blob[:120], 0, now=0)
        self.assertFalse(self.rx.tick(29999))
        self.assertTrue(self.rx.active)
        self.assertTrue(self.rx.tick(30000))
        self.assertFalse(self.rx.active)
        self.assertFalse(self.rx.tick(30001))
        self.assertEqual(os.path.getsize(self.path("ota_new", "app.mpy")), 120)
        # ... und die App kann danach fortsetzen
        again = self.begin(now=40000)
        self.assertEqual(again["o"], 120)
        self.assertTrue(self.rx.active)

    def test_info_resets_timeout_and_reports_progress(self):
        blob = os.urandom(240)
        self.begin()
        self.file(blob)
        self.data(blob[:120], 0, now=0)
        info = self.rx.handle({"type": "ota_info"}, 20000)
        self.assertEqual((info["st"], info["rid"], info["i"], info["o"]), ("rx", PKG, 0, 120))
        self.assertFalse(self.rx.tick(45000))
        self.assertTrue(self.rx.tick(50000))

    def test_restart_discards_partial(self):
        blob = os.urandom(240)
        self.begin()
        self.file(blob)
        self.data(blob[:120], 0)
        fresh = ota.OtaReceiver(self.root)
        self.assertFalse(os.path.exists(self.path("ota_new")))
        self.assertEqual(fresh.info()["st"], "ok")

    def test_restart_keeps_ready_package(self):
        send_package(self.rx, {"app.mpy": os.urandom(100)})
        self.rx.handle({"type": "ota_end"}, 0)
        ota.OtaReceiver(self.root)
        self.assertTrue(os.path.exists(self.path("ota_new", "app.mpy")))

    def test_begin_rejected_while_update_pending(self):
        for word in ("ready", "swap", "trial", "rollback", "rollback2"):
            ota.write_state(self.root, word)
            self.assertEqual(self.begin()["e"], "state", word)
            self.assertFalse(self.rx.active)

    def test_begin_with_garbage_fields(self):
        for bad in ({"id": "", "n": 1, "sz": 10}, {"id": PKG, "n": 0, "sz": 10},
                    {"id": PKG, "n": 1, "sz": "viel"}, {"id": PKG, "n": 1}):
            msg = {"type": "ota_begin"}
            msg.update(bad)
            self.assertEqual(self.rx.handle(msg, 0)["e"], "size", bad)

    def test_abort(self):
        blob = os.urandom(240)
        self.begin()
        self.file(blob)
        self.data(blob[:120], 0)
        r = self.rx.handle({"type": "ota_abort"}, 0)
        self.assertEqual(r["s"], "abort")
        self.assertNotIn("e", r)
        self.assertFalse(self.rx.active)
        self.assertFalse(os.path.exists(self.path("ota_new")))

    def test_messages_fit_radio_budget(self):
        self.assertLessEqual(len(compact({
            "type": "ota_file", "i": 99, "name": "a" * 28 + ".mpy", "sz": 999999,
            "sha": "f" * 64, "target_mac": TARGET})), 250)
        self.assertLessEqual(len(compact({
            "type": "ota_data", "i": 99, "o": 999999, "d": b64(b"\xff" * 120),
            "target_mac": TARGET})), 250)
        self.assertLessEqual(len(compact({
            "type": "ota_begin", "id": PKG, "lbl": "99.99.99", "n": 99, "sz": 999999,
            "target_mac": TARGET})), 250)
        acks = send_package(self.rx, {"app.mpy": os.urandom(500)})
        acks.append(self.rx.handle({"type": "ota_end"}, 0))
        for a in acks:
            self.assertLessEqual(len(compact(a)), 250)

    def test_foreign_type_returns_none(self):
        self.assertIsNone(self.rx.handle({"type": "config"}, 0))
        self.assertIsNone(self.rx.handle({"type": "ota_unbekannt"}, 0))
        self.assertIsNone(self.rx.handle({}, 0))


if __name__ == "__main__":
    unittest.main()
