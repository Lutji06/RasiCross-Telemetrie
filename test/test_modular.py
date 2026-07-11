import ast
import os
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ESP = os.path.join(ROOT, "esp_libs")


def _tree(path):
    with open(path, "r", encoding="utf-8") as f:
        return ast.parse(f.read())


def _toplevel_names(tree):
    """Direkt auf Modulebene definierte Klassen/Funktionen/Zuweisungen.
    Bewusst NICHT in try/except hinein (die _HAS_*-Guards zaehlen nicht)."""
    names = set()
    for node in tree.body:
        if isinstance(node, (ast.ClassDef, ast.FunctionDef)):
            names.add(node.name)
        elif isinstance(node, ast.Assign):
            for t in node.targets:
                if isinstance(t, ast.Name):
                    names.add(t.id)
    return names


def _imported_modules(tree):
    mods = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            mods.update(a.name for a in node.names)
        elif isinstance(node, ast.ImportFrom) and node.module:
            mods.add(node.module)
    return mods


class ConfigStoreModule(unittest.TestCase):
    def test_config_store_owns_config(self):
        names = _toplevel_names(_tree(os.path.join(ESP, "config_store.py")))
        for expected in ("Config", "log", "config_snapshot", "_ACK_KEYS",
                         "config_ack", "ConfigStore", "apply_config"):
            self.assertIn(expected, names)

    def test_sender_no_longer_defines_config(self):
        names = _toplevel_names(_tree(os.path.join(ROOT, "sender.py")))
        for gone in ("Config", "log", "config_snapshot", "_ACK_KEYS",
                     "config_ack", "ConfigStore", "apply_config"):
            self.assertNotIn(gone, names)

    def test_config_store_no_back_import(self):
        mods = _imported_modules(_tree(os.path.join(ESP, "config_store.py")))
        self.assertFalse({"sender", "bridge"} & mods)


class RadioModule(unittest.TestCase):
    def test_radio_owns_espnowlink(self):
        self.assertIn("ESPNowLink",
                      _toplevel_names(_tree(os.path.join(ESP, "radio.py"))))
        self.assertNotIn("ESPNowLink",
                         _toplevel_names(_tree(os.path.join(ROOT, "sender.py"))))

    def test_radio_no_back_import(self):
        mods = _imported_modules(_tree(os.path.join(ESP, "radio.py")))
        self.assertFalse({"sender", "bridge"} & mods)


class ImuTaskModule(unittest.TestCase):
    def test_imu_task_owns_imu(self):
        tree = _tree(os.path.join(ESP, "imu_task.py"))
        self.assertIn("IMU", _toplevel_names(tree))
        self.assertFalse({"sender", "bridge"} & _imported_modules(tree))
        self.assertNotIn("IMU",
                         _toplevel_names(_tree(os.path.join(ROOT, "sender.py"))))


class GpsTaskModule(unittest.TestCase):
    def test_gps_task_owns_gps(self):
        tree = _tree(os.path.join(ESP, "gps_task.py"))
        self.assertIn("GPS", _toplevel_names(tree))
        self.assertFalse({"sender", "bridge"} & _imported_modules(tree))
        self.assertNotIn("GPS",
                         _toplevel_names(_tree(os.path.join(ROOT, "sender.py"))))


class DisplayPagesModule(unittest.TestCase):
    def test_display_pages_owns_display_and_pages(self):
        tree = _tree(os.path.join(ESP, "display_pages.py"))
        names = _toplevel_names(tree)
        for expected in ("Display", "page_speed", "page_race", "page_rpm",
                         "page_delta", "page_diag"):
            self.assertIn(expected, names)
        self.assertFalse({"sender", "bridge"} & _imported_modules(tree))

    def test_sender_is_thin_orchestrator(self):
        names = _toplevel_names(_tree(os.path.join(ROOT, "sender.py")))
        self.assertEqual(names, {"RPMCounter", "Battery", "StatusLED", "main"})


if __name__ == "__main__":
    unittest.main()
