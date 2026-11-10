# ============================================================
#  RasiCross -- test_ota_boot.py  (Bootlader esp_libs/main_stub.py)
# ============================================================
#  Der Bootlader entscheidet, ob ein Kart nach einem Update noch lebt.
#  Deshalb hier jeder Weg einzeln: Umschalten, Rueckfall, Stromausfall
#  mitten im Umschalten/Rueckfall, Import-Fehler der neuen Version --
#  und der Durchstich Empfang (ota.py) -> Boot -> Probe -> Bestaetigen.
# ============================================================
import io
import json
import os
import shutil
import sys
import tempfile
import types
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
import mpstub  # noqa: E402
mpstub.install()
sys.path.insert(0, os.path.join(ROOT, 'esp_libs'))
import ota  # noqa: E402
from test_ota import send_package  # noqa: E402

STUB = os.path.join(ROOT, 'esp_libs', 'main_stub.py')
OLD_ID = "000000000000000a"
NEW_ID = "000000000000000b"


def _stub_source():
    with io.open(STUB, encoding='utf-8') as fh:
        return fh.read()


def _load_boot():
    """Bootlader laden, ohne dass er startet: die letzte Zeile boot() faellt weg
    (gleiches Muster wie _load in test_firmware.py)."""
    src = _stub_source().rstrip()
    assert src.endswith("\nboot()"), "main_stub.py muss mit boot() enden"
    mod = types.ModuleType("main_stub_mod")
    exec(compile(src[:-len("boot()")], STUB, 'exec'), mod.__dict__)
    return mod


boot = _load_boot()


def write(root, rel, data):
    path = os.path.join(root, *rel.split("/"))
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "wb") as f:
        f.write(data)


def manifest(pkg_id, files, lbl="x"):
    return json.dumps({"id": pkg_id, "lbl": lbl, "files": files}).encode()


def stage(root, files, pkg_id=NEW_ID):
    """Fertig geprueftes Paket bereitlegen, wie ota_end es hinterlaesst."""
    for name, data in files.items():
        write(root, "ota_new/" + name, data)
    write(root, "ota_new/ota_manifest.json", manifest(pkg_id, list(files)))
    ota.write_state(root, "ready")


def tree(root):
    out = {}
    for base, _dirs, names in os.walk(root):
        for n in names:
            full = os.path.join(base, n)
            with open(full, "rb") as f:
                out[os.path.relpath(full, root).replace(os.sep, "/")] = f.read()
    return out


def without_state(t):
    return {k: v for k, v in t.items() if k != "ota_state"}


class _Device(unittest.TestCase):
    """Geraet mit installierter alter Version: app.mpy + frame.py + Manifest."""

    def setUp(self):
        self.root = tempfile.mkdtemp(prefix="rasi-boot-")
        write(self.root, "main.py", b"# bootlader")
        write(self.root, "app.mpy", b"old")
        write(self.root, "frame.py", b"oldframe")
        write(self.root, "ota_manifest.json", manifest(OLD_ID, ["app.mpy", "frame.py"]))
        self.before = tree(self.root)
        self.new = {"app.mpy": b"new", "frame.mpy": b"newframe"}

    def tearDown(self):
        shutil.rmtree(self.root, ignore_errors=True)

    def assert_new_installed(self):
        t = tree(self.root)
        self.assertEqual(t["app.mpy"], b"new")
        self.assertEqual(t["frame.mpy"], b"newframe")
        self.assertNotIn("frame.py", t)                 # .py haette Vorrang vor .mpy
        self.assertEqual(json.loads(t["ota_manifest.json"])["id"], NEW_ID)
        self.assertEqual(t["ota_old/app.mpy"], b"old")
        self.assertEqual(t["ota_old/frame.py"], b"oldframe")
        self.assertEqual(json.loads(t["ota_old/ota_manifest.json"])["id"], OLD_ID)
        self.assertFalse(any(k.startswith("ota_new/") for k in t))
        self.assertEqual(t["main.py"], b"# bootlader")
        self.assertEqual(ota.read_state(self.root), "trial")

    def assert_old_restored(self):
        self.assertEqual(without_state(tree(self.root)), self.before)
        self.assertEqual(ota.read_state(self.root), "rolledback")
        self.assertFalse(os.path.exists(os.path.join(self.root, "ota_old")))
        self.assertFalse(os.path.exists(os.path.join(self.root, "ota_new")))


class TestBootloader(_Device):
    def test_swap_installs_and_enters_trial(self):
        stage(self.root, self.new)
        self.assertEqual(boot.prepare(self.root), "trial")
        self.assert_new_installed()

    def test_unconfirmed_trial_rolls_back(self):
        stage(self.root, self.new)
        boot.prepare(self.root)
        self.assertEqual(boot.prepare(self.root), "rolledback")
        self.assert_old_restored()

    def test_rolledback_state_stays_on_later_boots(self):
        stage(self.root, self.new)
        boot.prepare(self.root)
        boot.prepare(self.root)
        self.assertEqual(boot.prepare(self.root), "rolledback")
        self.assert_old_restored()

    def test_interrupted_swap_is_completed(self):
        # Stromausfall: app.mpy schon getauscht, frame.mpy + Manifest noch nicht.
        stage(self.root, self.new)
        ota.write_state(self.root, "swap")
        write(self.root, "ota_old/app.mpy", b"old")
        write(self.root, "app.mpy", b"new")
        os.remove(os.path.join(self.root, "ota_new", "app.mpy"))
        self.assertEqual(boot.prepare(self.root), "trial")
        self.assert_new_installed()

    def test_interrupted_swap_between_the_two_moves(self):
        # Alte Datei schon in ota_old, neue noch nicht im Root.
        stage(self.root, self.new)
        ota.write_state(self.root, "swap")
        write(self.root, "ota_old/app.mpy", b"old")
        os.remove(os.path.join(self.root, "app.mpy"))
        self.assertEqual(boot.prepare(self.root), "trial")
        self.assert_new_installed()

    def test_interrupted_swap_after_manifest_moved(self):
        # Alles getauscht, nur Aufraeumen + Zustand "trial" fehlten noch.
        stage(self.root, self.new)
        boot.prepare(self.root)
        ota.write_state(self.root, "swap")
        os.mkdir(os.path.join(self.root, "ota_new"))
        self.assertEqual(boot.prepare(self.root), "trial")
        self.assert_new_installed()

    def test_stale_old_dir_is_cleared_before_swap(self):
        write(self.root, "ota_old/app.mpy", b"uralt")
        write(self.root, "ota_old/geist.mpy", b"x")
        stage(self.root, self.new)
        boot.prepare(self.root)
        self.assert_new_installed()
        self.assertNotIn("ota_old/geist.mpy", tree(self.root))

    def test_interrupted_rollback_before_any_restore(self):
        stage(self.root, self.new)
        boot.prepare(self.root)
        ota.write_state(self.root, "rollback")
        self.assertEqual(boot.prepare(self.root), "rolledback")
        self.assert_old_restored()

    def test_interrupted_rollback_is_completed(self):
        # Phase 2 des Rueckfalls: eine Datei schon zurueck, der Rest noch in ota_old.
        stage(self.root, self.new)
        boot.prepare(self.root)
        ota.write_state(self.root, "rollback2")
        os.remove(os.path.join(self.root, "frame.mpy"))      # Phase 1 war durch
        os.remove(os.path.join(self.root, "app.mpy"))
        os.rename(os.path.join(self.root, "ota_old", "app.mpy"),
                  os.path.join(self.root, "app.mpy"))
        self.assertEqual(boot.prepare(self.root), "rolledback")
        self.assert_old_restored()

    def test_import_failure_in_trial_rolls_back_and_resets(self):
        stage(self.root, self.new)
        resets = []
        boot.boot(self.root, importer=lambda: 1 / 0, reset=lambda: resets.append(1))
        self.assertEqual(resets, [1])
        self.assert_old_restored()

    def test_import_failure_without_trial_propagates(self):
        resets = []

        def broken():
            raise ValueError("kaputt")
        with self.assertRaises(ValueError):
            boot.boot(self.root, importer=broken, reset=lambda: resets.append(1))
        self.assertEqual(resets, [])
        self.assertEqual(tree(self.root), self.before)

    def test_crash_after_confirm_does_not_roll_back(self):
        # Die neue Version hat sich bestaetigt und stuerzt spaeter ab: kein
        # Rueckfall mehr (ota_old ist weg) -- der Fehler geht nach oben.
        stage(self.root, self.new)

        def runs_then_crashes():
            self.assertTrue(ota.confirm(self.root))
            raise RuntimeError("spaeter Absturz")
        resets = []
        with self.assertRaises(RuntimeError):
            boot.boot(self.root, importer=runs_then_crashes, reset=lambda: resets.append(1))
        self.assertEqual(resets, [])
        self.assertEqual(ota.read_state(self.root), "")
        self.assertEqual(tree(self.root)["app.mpy"], b"new")

    def test_normal_boot_touches_nothing(self):
        calls = []
        boot.boot(self.root, importer=lambda: calls.append(1), reset=None)
        self.assertEqual(calls, [1])
        self.assertEqual(tree(self.root), self.before)

    def test_first_update_on_device_without_manifest(self):
        os.remove(os.path.join(self.root, "ota_manifest.json"))
        before = tree(self.root)
        stage(self.root, self.new)
        self.assertEqual(boot.prepare(self.root), "trial")
        t = tree(self.root)
        self.assertEqual((t["app.mpy"], t["frame.mpy"]), (b"new", b"newframe"))
        self.assertEqual(boot.prepare(self.root), "rolledback")
        self.assertEqual(without_state(tree(self.root)), before)

    def test_rollback_without_old_dir_keeps_files(self):
        ota.write_state(self.root, "trial")
        self.assertEqual(boot.prepare(self.root), "rolledback")
        self.assertEqual(without_state(tree(self.root)), self.before)

    def test_broken_staged_manifest_does_not_brick(self):
        stage(self.root, self.new)
        write(self.root, "ota_new/ota_manifest.json", b"{kaputt")
        calls = []
        boot.boot(self.root, importer=lambda: calls.append(1), reset=None)
        self.assertEqual(calls, [1])                    # Geraet startet trotzdem
        self.assertEqual(without_state(tree(self.root)), self.before)
        self.assertEqual(ota.read_state(self.root), "")

    def test_bootloader_does_not_import_ota(self):
        src = _stub_source()
        self.assertNotIn("import ota", src)
        self.assertNotIn("from ota", src)

    def test_bootloader_stays_small(self):
        # Wird on-device kompiliert -> Code-Zeilen zaehlen (Kommentare kosten
        # den Compiler nichts).
        lines = [ln for ln in _stub_source().splitlines()
                 if ln.strip() and not ln.strip().startswith("#")]
        self.assertLess(len(lines), 120)


class TestOtaEndToEnd(_Device):
    def receive(self):
        rx = ota.OtaReceiver(self.root)
        acks = send_package(rx, self.new, pkg_id=NEW_ID)
        acks.append(rx.handle({"type": "ota_end"}, 0))
        self.assertTrue(all("e" not in a for a in acks), acks)
        return rx

    def test_confirm_only_in_trial(self):
        self.assertFalse(ota.confirm(self.root))
        stage(self.root, self.new)
        self.assertFalse(ota.confirm(self.root))        # "ready" ist noch keine Probe
        boot.prepare(self.root)
        self.assertTrue(ota.confirm(self.root))
        self.assertEqual(ota.read_state(self.root), "")
        self.assertFalse(os.path.exists(os.path.join(self.root, "ota_old")))

    def test_confirmed_update_survives_reboot(self):
        self.receive()
        self.assertEqual(boot.prepare(self.root), "trial")
        self.assertEqual(ota.OtaReceiver(self.root).info()["st"], "trial")
        self.assertTrue(ota.confirm(self.root))
        self.assertEqual(boot.prepare(self.root), "")
        t = tree(self.root)
        self.assertEqual((t["app.mpy"], t["frame.mpy"]), (b"new", b"newframe"))
        info = ota.OtaReceiver(self.root).info()
        self.assertEqual((info["id"], info["lbl"], info["st"]), (NEW_ID, "2.1.0", "ok"))

    def test_unconfirmed_update_end_to_end(self):
        self.receive()
        self.assertEqual(boot.prepare(self.root), "trial")
        self.assertEqual(boot.prepare(self.root), "rolledback")
        rx = ota.OtaReceiver(self.root)
        info = rx.info()
        self.assertEqual((info["id"], info["st"]), (OLD_ID, "rolledback"))
        self.assertEqual(without_state(tree(self.root)), self.before)

    def test_begin_after_rolledback_clears_state(self):
        ota.write_state(self.root, "rolledback")
        rx = ota.OtaReceiver(self.root)
        r = rx.handle({"type": "ota_begin", "id": NEW_ID, "lbl": "x", "n": 1, "sz": 10}, 0)
        self.assertNotIn("e", r)
        self.assertEqual(ota.read_state(self.root), "")

    def test_acknowledge_rollback(self):
        self.assertFalse(ota.acknowledge_rollback(self.root))
        ota.write_state(self.root, "rolledback")
        self.assertTrue(ota.acknowledge_rollback(self.root))
        self.assertEqual(ota.read_state(self.root), "")

    def test_second_update_after_confirmed_first(self):
        self.receive()
        boot.prepare(self.root)
        ota.confirm(self.root)
        rx = ota.OtaReceiver(self.root)
        acks = send_package(rx, {"app.mpy": b"third"}, pkg_id="000000000000000c")
        acks.append(rx.handle({"type": "ota_end"}, 0))
        self.assertTrue(all("e" not in a for a in acks), acks)
        self.assertEqual(boot.prepare(self.root), "trial")
        t = tree(self.root)
        self.assertEqual(t["app.mpy"], b"third")
        self.assertEqual(t["ota_old/app.mpy"], b"new")
        # frame.mpy gehoert nicht zum dritten Paket und bleibt unangetastet
        self.assertEqual(t["frame.mpy"], b"newframe")


if __name__ == "__main__":
    unittest.main()
