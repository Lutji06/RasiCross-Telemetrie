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


if __name__ == "__main__":
    unittest.main()
