# Phase 45 — Firmware-Modularisierung Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** sender.py (1533 Zeilen) wird entlang seiner heutigen Abschnitte in die esp_libs-Module `config_store.py`, `radio.py`, `imu_task.py`, `gps_task.py` und `display_pages.py` gezogen; sender.py bleibt dünner Orchestrator (RPMCounter, Battery, StatusLED, main) — und es wird NUR Code bewegt, nicht geändert. Zusätzlich (einziges neues Verhalten, Spec-Deliverable): `gc.mem_free()` wird nach Boot geloggt.

**Architecture:** Alle Module leben flach in `esp_libs/` und werden auf dem ESP32 ins Root kopiert (flaches Dateisystem, Imports wie heute `import calc` — **niemals** `from esp_libs import …`). `config_store.py` ist die gemeinsame Wurzel (Config-Klasse + log + NVS + apply_config); die vier anderen Module importieren `from config_store import Config, log`. Da `Config` ein Klassen-Objekt ist, sind Live-Mutationen (`Config.MAX_RPM = …` aus apply_config) in allen Modulen sichtbar — Verhalten identisch zu heute. Keine Zyklen: kein esp_libs-Modul importiert sender (per neuem AST-Test erzwungen).

**Tech Stack:** MicroPython (ESP32), CPython-CI (`py_compile` + `unittest`); keine neuen Dependencies. mpy-cross-Flash-Prozedur (app.mpy + main_stub) bleibt unverändert; die fünf neuen Module gehen wie die bestehenden esp_libs als `.py` aufs Gerät.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-06-technical-redesign-program-design.md`, Abschnitt „Phase 45" + „Kompatibilitätsgarantien" + „Risiken" Punkt 3.
- **Merge-Gate (Spec, hart):** Beide echte Karts geflasht; Telemetrie, OLED und Pit-Call auf der Wiese verifiziert. **Vorher wird nichts gemerged** — PR wird erstellt, aber als Draft/mit Warnhinweis.
- **Heap-Abbruchkriterium (Spec):** Baseline = `gc.mem_free()` nach Boot mit dem Task-1-Stand (nur Heap-Log, noch monolithisch). Fällt der Wert nach der Modularisierung >10 % unter die Baseline → Module wieder zusammenlegen statt weiter splitten (vorher als milderen Versuch: neue Module ebenfalls mpy-cross'en — die Spec-Regel „zusammenlegen" bleibt maßgeblich).
- **Funk-Protokoll unantastbar:** ESP-NOW-Payloads, `_ACK_KEYS`-Dict (Inhalt byte-identisch), 250-B-Budget, frame.py, calc.py, bridge.py — alles unangetastet. Phase 45 verschiebt Code, ändert kein Paketfeld.
- **Nur Code bewegen:** Klassen-/Funktions-Bodies byte-identisch übernehmen. Erlaubte Nicht-Bewegungs-Änderungen sind AUSSCHLIESSLICH: (a) Import-Blöcke der neuen Module (inkl. mitbewegter/duplizierter try-Import-Guards), (b) `from … import …`-Zeilen in sender.py, (c) je Datei ein kurzer Kopf-Kommentar, (d) gelöschte alte Abschnitts-Kommentare in sender.py, (e) der Task-1-Heap-Log (eigener Commit, VOR den Move-Commits). Keine Umbenennungen, keine Formatierung, keine Gelegenheits-Fixes (auch nicht die ungenutzte `_fmt_clock_ms` — wird mitbewegt, nicht gelöscht).
- **Gates pro Task:** `python -m py_compile sender.py bridge.py esp_libs/*.py` fehlerfrei; `python -m unittest discover -s test -p "test_*.py"` OK (Zahl wächst pro Task, s. Tasks); `git diff --color-moved=dimmed-zebra HEAD~1` — Bodies gedimmt, nur Import/Kommentar-Zeilen hell.
- Flash-Sicherheit (gilt fürs Hardware-Gate): sender.py **nie** direkt als main.py flashen (WiFi-OOM-Bootloop seit MicroPython 1.28) — immer app.mpy + main_stub.py laut `esp_libs/README.md`.

## Working Directory & Conventions

- Branch `feat/phase-45-firmware-modular` **von `main`** (Phase 45 ist unabhängig von PR #70/Phase 44 — nur Python). `git checkout main && git pull && git checkout -b feat/phase-45-firmware-modular`.
- Repo-Dateien sind CRLF. Bodies per `sed -n 'A,Bp'` extrahieren (erhält CRLF byte-genau); Kopf-/Import-Blöcke mit `printf '…\r\n'` schreiben. **Zeilennummern im Plan sind Momentaufnahmen** — vor jedem Schnitt die Anker per `grep -n` frisch lokalisieren.
- Niemals `.claude/`, `CLAUDE.md`, `graphify-out/`, `__pycache__` committen (`__pycache__` vor jedem `git status` löschen). Commit-Trailer (Co-Authored-By + Claude-Session) Pflicht.
- Python heißt hier `python` (3.11); unittest-Basis vor Phase 45: **Ran 56 tests, OK**.

## Locked Decisions

- **Zuordnung (verbindlich, Abschnitts-Anker = die `# ── … ─`-Trennkommentare in sender.py):**
  - `config_store.py` ← „Konfiguration" (Config-Klasse L76–154, `log` L157–160) **und** der Config-Block am Dateiende (`config_snapshot` L1164, `_ACK_KEYS` L1186, `config_ack` L1198, `ConfigStore` L1206, `apply_config` L1260–1342) + try-Import `esp32`/`_HAS_NVS` (L68–73).
  - `radio.py` ← „ESP-NOW Link" (`ESPNowLink` L979–1121) + try-Import `frame`/`_HAS_FRAME` (L62–66).
  - `imu_task.py` ← „IMU (MPU-6050)" (`IMU` L350–484) + try-Import `mpu6050`/`_HAS_MPU` (L38–42).
  - `gps_task.py` ← „GPS" (`GPS` L487–602) + try-Import `micropyGPS`/`_HAS_GPS` (L50–54); braucht zusätzlich einen **eigenen** `calc`-Guard (Duplikat von L56–60, weil `_configure_m8n` calc nutzt und der Guard auch in sender.py bleibt — dokumentierte erlaubte Duplizierung).
  - `display_pages.py` ← „OLED-Display" + „Display-Pages" (Display-Klasse L605–841, Helpers + `page_*` L844–976) + try-Import `ssd1306`/`_HAS_OLED` (L44–48) + `import framebuf`.
  - **sender.py behält:** Kopf-Kommentar, RPMCounter (L163–287), Battery (L290–347), StatusLED (L1124–1161), `main()` (L1345–1533) + Top-Level-`main()`-Aufruf, den `calc`-Guard. Ergebnis ≈ 450 Zeilen — „dünner Orchestrator" im Sinne der Spec; RPMCounter/Battery/StatusLED sind NICHT in der Spec-Modulliste und bleiben bewusst (kein sechstes Modul ohne Not — YAGNI).
- **Import-Stil auf dem Gerät:** flach (`import config_store`), identisch zu `import calc` heute. Die neuen Module gehen als `.py` aufs Gerät (wie mpu6050/micropyGPS/calc/frame); nur sender.py/bridge.py bleiben mpy-cross-Pflicht. Der On-Device-Compile der fünf Module passiert beim `import app` — also VOR dem WiFi-Init in `main()` (ESPNowLink wird erst dort instanziert), im RAM-günstigsten Moment.
- **CPython-Testbarkeit:** Die neuen Module importieren MicroPython-only-Module (`ujson`, `utime`, `machine`, …) → nicht CPython-importierbar. Der neue Guard-Test `test/test_modular.py` arbeitet deshalb **AST-basiert** (parst Dateien, importiert sie nicht) und wächst pro Task mit: Task 2 +3 Tests (59), Task 3 +2 (61), Task 4 +1 (62), Task 5 +1 (63), Task 6 +2 (65).
- **Heap-Log (Task 1, einziges neues Verhalten):** `gc.collect()` + `log("init", "Heap frei nach Boot:", gc.mem_free(), "Bytes")` am Ende der Init-Phase von `main()` (nach den `register_page`-Zeilen). Topic `init` ist in `DEBUG_TOPICS` → druckt ohne DEBUG-Flag.
- **PR-Basis `main`;** PR trägt im Titel/Body den Hinweis „NICHT mergen vor Hardware-Gate" und wird als **Draft** erstellt.

## File Structure

| Action | Path | ca. Zeilen | Task |
|---|---|---|---|
| Modify | `sender.py` (Heap-Log, dann Schrumpfen auf ~450) | — | 1–6 |
| Create | `test/test_modular.py` | ~90 (final) | 2–6 |
| Create | `esp_libs/config_store.py` | ~265 | 2 |
| Create | `esp_libs/radio.py` | ~160 | 3 |
| Create | `esp_libs/imu_task.py` | ~150 | 4 |
| Create | `esp_libs/gps_task.py` | ~135 | 5 |
| Create | `esp_libs/display_pages.py` | ~385 | 6 |
| Modify | `esp_libs/README.md` (Flash-Prozedur + Modul-Liste) | — | 7 |
| Commit | dieses Plan-Doc, Push, Draft-PR | — | 7 |

---

### Task 1: Heap-Log nach Boot (Spec-Deliverable, vor den Moves)

**Files:**
- Modify: `sender.py`

**Interfaces:**
- Produces: Boot-Log-Zeile `[init] Heap frei nach Boot: <N> Bytes` — Messpunkt für Baseline (dieser Commit) und Gate (Branch-Spitze). Kein API-Export.

- [ ] **Step 1:** Branch anlegen: `git checkout main && git pull && git checkout -b feat/phase-45-firmware-modular`.
- [ ] **Step 2:** In sender.py nach der `from machine import …`-Zeile (Anker frisch greppen: `grep -n "^from machine import" sender.py`) einfügen:

```python
import gc
```

- [ ] **Step 3:** In `main()` direkt NACH der Zeile `display.register_page("diag",  page_diag)` (Anker: `grep -n 'register_page("diag"' sender.py`) einfügen:

```python

    # Phase 45: freier Heap nach Boot als Gate-Messwert (Spec: Baseline vor
    # der Modularisierung; faellt der Wert nach dem Split >10 % darunter,
    # werden Module wieder zusammengelegt statt weiter gesplittet).
    gc.collect()
    log("init", "Heap frei nach Boot:", gc.mem_free(), "Bytes")
```

- [ ] **Step 4: Gates** — `python -m py_compile sender.py bridge.py esp_libs/*.py` (kein Output = OK); `python -m unittest discover -s test -p "test_*.py"` → `Ran 56 tests … OK`.
- [ ] **Step 5: Commit** — `git add sender.py && git commit -m "feat(fw): gc.mem_free()-Log nach Boot (Heap-Baseline fuer Phase 45)"` (+ Pflicht-Trailer). **Diesen Commit-Hash notieren** — er ist der Baseline-Flash-Stand fürs Hardware-Gate.

---

### Task 2: `config_store.py` + AST-Guard-Test

**Files:**
- Create: `esp_libs/config_store.py`
- Create: `test/test_modular.py`
- Modify: `sender.py`

**Interfaces:**
- Produces: `config_store.py` mit Top-Level-Namen `Config` (Klasse), `log(topic, *args)`, `config_snapshot(rpm_counter) -> dict`, `_ACK_KEYS` (dict, Inhalt byte-identisch), `config_ack(rpm_counter) -> dict`, `ConfigStore` (Klasse, `.load(rpm_counter, imu=None)` / `.save(rpm_counter, imu=None)`), `apply_config(cfg, rpm_counter, store=None, imu=None)`. Alle späteren Tasks importieren `from config_store import Config, log`.

- [ ] **Step 1: Failing Test.** `test/test_modular.py` anlegen (LF ok, wie test_frame.py):

```python
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
```

- [ ] **Step 2:** Test laufen lassen: `python -m unittest test.test_modular -v` → erwartet **FAIL/ERROR** (`config_store.py` existiert nicht).
- [ ] **Step 3:** Anker frisch lokalisieren: `grep -n "── Konfiguration\|^def log\|^def config_snapshot\|^_ACK_KEYS\|^def config_ack\|^class ConfigStore\|^def apply_config\|^def main" sender.py`. Dann `esp_libs/config_store.py` bauen: Kopf + Imports per printf (CRLF), Bodies per sed (Snapshot-Bereiche: L76–160 und L1164–1342 — an frischen Ankern verifizieren; der zweite Bereich beginnt bei `def config_snapshot`, endet mit der letzten Zeile von `apply_config` vor der Leerzeile über `def main`):

```python
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
```

  danach byte-identisch: Config-Klasse (inkl. `# ── Konfiguration ─…`-Kommentar weglassen — Kategorie d), `log`, dann `config_snapshot`, `_ACK_KEYS`-Kommentar+Dict, `config_ack`, `ConfigStore`, `apply_config`.
- [ ] **Step 4:** sender.py schrumpfen: die beiden Bereiche + den esp32-try-Block (L68–73) löschen (sed-Bereiche bottom-up: erst den config-Block am Dateiende, dann Konfiguration+log oben, dann den esp32-Guard). An der Stelle des alten Import-Blocks einfügen:

```python
from config_store import Config, log, ConfigStore, apply_config, config_ack
```

  (Platzierung: nach den verbliebenen try-Import-Guards, vor RPMCounter.)
- [ ] **Step 5: Gates** — `python -m py_compile sender.py bridge.py esp_libs/*.py`; `python -m unittest discover -s test -p "test_*.py"` → `Ran 59 tests … OK`; `git diff --color-moved=dimmed-zebra HEAD` sichtprüfen (Bodies gedimmt).
- [ ] **Step 6: Commit** — `git add sender.py esp_libs/config_store.py test/test_modular.py && git commit -m "refactor(fw): config_store.py -- Config/log/NVS/apply_config aus sender.py (nur bewegt)"` (+ Trailer).

---

### Task 3: `radio.py` (ESPNowLink)

**Files:**
- Create: `esp_libs/radio.py`
- Modify: `sender.py`, `test/test_modular.py`

**Interfaces:**
- Consumes: `from config_store import Config, log` (Task 2).
- Produces: `radio.py` mit `ESPNowLink` (Klasse; `.send(data)->bool`, `.send_json(obj)->bool`, `.recv()->(kind,data)|None`, `.mac->str`, `.tx_fail_run->int`). sender.py importiert `from radio import ESPNowLink`.

- [ ] **Step 1: Failing Test.** In `test/test_modular.py` anhängen:

```python
class RadioModule(unittest.TestCase):
    def test_radio_owns_espnowlink(self):
        self.assertIn("ESPNowLink",
                      _toplevel_names(_tree(os.path.join(ESP, "radio.py"))))
        self.assertNotIn("ESPNowLink",
                         _toplevel_names(_tree(os.path.join(ROOT, "sender.py"))))

    def test_radio_no_back_import(self):
        mods = _imported_modules(_tree(os.path.join(ESP, "radio.py")))
        self.assertFalse({"sender", "bridge"} & mods)
```

- [ ] **Step 2:** `python -m unittest test.test_modular -v` → 2 neue FAIL/ERROR.
- [ ] **Step 3:** Anker: `grep -n "── ESP-NOW Link\|^class ESPNowLink\|── Status-LED" sender.py`. `esp_libs/radio.py` bauen — Kopf/Imports:

```python
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
```

  dann byte-identisch die ESPNowLink-Klasse (Body von `class ESPNowLink:` bis vor den `# ── Status-LED ─…`-Kommentar).
- [ ] **Step 4:** sender.py: ESPNowLink-Block + Abschnitts-Kommentar löschen; frame-Guard (try-Block) löschen; aus dem Kopf-Importblock `network`, `espnow`, `ujson`, `ubinascii` streichen (nur noch von radio genutzt — verifizieren: `grep -n "network\.\|espnow\.\|ujson\.\|ubinascii\." sender.py` muss leer sein). Import ergänzen: `from radio import ESPNowLink`.
- [ ] **Step 5: Gates** — py_compile; unittest → `Ran 61 tests … OK`; color-moved-Sichtprüfung.
- [ ] **Step 6: Commit** — `refactor(fw): radio.py -- ESPNowLink aus sender.py (nur bewegt)` (+ Trailer).

---

### Task 4: `imu_task.py` (IMU)

**Files:**
- Create: `esp_libs/imu_task.py`
- Modify: `sender.py`, `test/test_modular.py`

**Interfaces:**
- Consumes: `from config_store import Config, log`.
- Produces: `imu_task.py` mit `IMU` (Klasse; `.update(alpha=None)->(gx,gy)`, `.start_calibration(duration_ms)`, `.reset_calibration()`, `.set_offsets(ox,oy)`, Properties `calibrating/offsets/ok/az/yaw/roll/mpu_temp`). sender.py importiert `from imu_task import IMU`.

- [ ] **Step 1: Failing Test.** Anhängen an `test/test_modular.py`:

```python
class ImuTaskModule(unittest.TestCase):
    def test_imu_task_owns_imu(self):
        tree = _tree(os.path.join(ESP, "imu_task.py"))
        self.assertIn("IMU", _toplevel_names(tree))
        self.assertFalse({"sender", "bridge"} & _imported_modules(tree))
        self.assertNotIn("IMU",
                         _toplevel_names(_tree(os.path.join(ROOT, "sender.py"))))
```

- [ ] **Step 2:** `python -m unittest test.test_modular -v` → 1 neuer ERROR.
- [ ] **Step 3:** Anker: `grep -n "── IMU\|^class IMU\|── GPS" sender.py`. `esp_libs/imu_task.py` — Kopf/Imports:

```python
# ============================================================
#  RasiCross — imu_task.py  (MPU-6050 IMU, Phase 45)
#  Herausgeloest aus sender.py — NUR bewegt, nicht geaendert.
# ============================================================

import utime

try:
    import mpu6050
    _HAS_MPU = True
except ImportError:
    _HAS_MPU = False

from config_store import Config, log
```

  dann byte-identisch die IMU-Klasse.
- [ ] **Step 4:** sender.py: IMU-Block + Abschnitts-Kommentar + mpu6050-Guard löschen; `from imu_task import IMU` ergänzen.
- [ ] **Step 5: Gates** — py_compile; unittest → `Ran 62 tests … OK`; color-moved.
- [ ] **Step 6: Commit** — `refactor(fw): imu_task.py -- IMU aus sender.py (nur bewegt)` (+ Trailer).

---

### Task 5: `gps_task.py` (GPS)

**Files:**
- Create: `esp_libs/gps_task.py`
- Modify: `sender.py`, `test/test_modular.py`

**Interfaces:**
- Consumes: `from config_store import Config, log`.
- Produces: `gps_task.py` mit `GPS` (Klasse; `.update()`, Properties `fix/speed_kmh/lat/lon/has_recent_data/health`). sender.py importiert `from gps_task import GPS`.

- [ ] **Step 1: Failing Test.** Anhängen:

```python
class GpsTaskModule(unittest.TestCase):
    def test_gps_task_owns_gps(self):
        tree = _tree(os.path.join(ESP, "gps_task.py"))
        self.assertIn("GPS", _toplevel_names(tree))
        self.assertFalse({"sender", "bridge"} & _imported_modules(tree))
        self.assertNotIn("GPS",
                         _toplevel_names(_tree(os.path.join(ROOT, "sender.py"))))
```

- [ ] **Step 2:** `python -m unittest test.test_modular -v` → 1 neuer ERROR.
- [ ] **Step 3:** Anker: `grep -n "── GPS\|^class GPS\|── OLED-Display" sender.py`. `esp_libs/gps_task.py` — Kopf/Imports (calc-Guard hier BEWUSST dupliziert, sender.py behält seinen):

```python
# ============================================================
#  RasiCross — gps_task.py  (NMEA-GPS via UART, Phase 45)
#  Herausgeloest aus sender.py — NUR bewegt, nicht geaendert.
# ============================================================

import utime
from machine import UART

try:
    from micropyGPS import MicropyGPS
    _HAS_GPS = True
except ImportError:
    _HAS_GPS = False

try:
    import calc
    _HAS_CALC = True
except ImportError:
    _HAS_CALC = False

from config_store import Config, log
```

  dann byte-identisch die GPS-Klasse.
- [ ] **Step 4:** sender.py: GPS-Block + Abschnitts-Kommentar + micropyGPS-Guard löschen; `UART` aus dem machine-Import streichen (verifizieren: `grep -n "UART" sender.py` leer); `from gps_task import GPS` ergänzen. Der calc-Guard BLEIBT in sender.py (RPMCounter/Battery/main nutzen ihn).
- [ ] **Step 5: Gates** — py_compile; unittest → `Ran 63 tests … OK`; color-moved.
- [ ] **Step 6: Commit** — `refactor(fw): gps_task.py -- GPS aus sender.py (nur bewegt)` (+ Trailer).

---

### Task 6: `display_pages.py` (Display + Pages) — sender.py wird Orchestrator

**Files:**
- Create: `esp_libs/display_pages.py`
- Modify: `sender.py`, `test/test_modular.py`

**Interfaces:**
- Consumes: `from config_store import Config, log`.
- Produces: `display_pages.py` mit `Display` (Klasse; `.register_page(name, fn)`, `.set_race_data(d)`, `.live_lap_ms()`, `.set_forced_page(name)`, `.update(ctx)`, `.trigger_pit_call(message, duration_ms)`, `.cancel_pit_call()`, `.big_text(…)`) und den Page-Funktionen `page_speed, page_race, page_rpm, page_delta, page_diag` (+ Helpers `_fmt_clock_ms, _draw_sector_bar, _fmt_ms`). sender.py importiert Display + die fünf Pages.

- [ ] **Step 1: Failing Test.** Anhängen:

```python
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
```

- [ ] **Step 2:** `python -m unittest test.test_modular -v` → 2 neue FAIL/ERROR.
- [ ] **Step 3:** Anker: `grep -n "── OLED-Display\|^class Display\|── Display-Pages\|^def page_delta\|── ESP-NOW Link\|── Status-LED" sender.py` (ESP-NOW-Abschnitt ist seit Task 3 weg — Ende des Page-Blocks ist die letzte Zeile von `page_delta` vor dem Status-LED- bzw. nächsten Abschnitt). `esp_libs/display_pages.py` — Kopf/Imports:

```python
# ============================================================
#  RasiCross — display_pages.py  (SSD1306-OLED + Seiten, Phase 45)
#  Herausgeloest aus sender.py — NUR bewegt, nicht geaendert.
#  5 Seiten + Pit-Call/Shift-Override; Pages sind Funktionen
#  (o, ctx) und werden in sender.main() registriert.
# ============================================================

import utime
import framebuf

try:
    import ssd1306
    _HAS_OLED = True
except ImportError:
    _HAS_OLED = False

from config_store import Config, log
```

  dann byte-identisch: Display-Klasse, `# ── Display-Pages ─…`-Kommentar samt Folgeblock (`_fmt_clock_ms`, `_draw_sector_bar`, `page_speed`, `_fmt_ms`, `page_race`, `page_rpm`, `page_diag`, `page_delta`).
- [ ] **Step 4:** sender.py: beide Abschnitte + ssd1306-Guard + `import framebuf` löschen (verifizieren: `grep -n "framebuf" sender.py` leer); ergänzen:

```python
from display_pages import (Display, page_speed, page_race, page_rpm,
                           page_delta, page_diag)
```

- [ ] **Step 5:** Aufgeräumten sender.py-Kopf gegenprüfen — er muss jetzt genau so aussehen (Reihenfolge: Hardware, gc, calc-Guard, eigene Module):

```python
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
```

- [ ] **Step 6: Gates** — py_compile; unittest → `Ran 65 tests … OK`; color-moved über den GANZEN Branch: `git diff --color-moved=dimmed-zebra main..HEAD -- sender.py esp_libs/ | grep -P "^\x1b\[3[12]m[+-]"` → übrig bleiben nur Import-/Kommentar-/Heap-Log-Zeilen. Zeilen-Check: `wc -l sender.py esp_libs/*.py` (sender ≈ 450, kein neues Modul > 400).
- [ ] **Step 7: Commit** — `refactor(fw): display_pages.py -- OLED + Pages aus sender.py, sender.py ist Orchestrator (nur bewegt)` (+ Trailer).

---

### Task 7: README, finale Gates, Plan-Doc, Push + Draft-PR

**Files:**
- Modify: `esp_libs/README.md`
- Commit: `docs/superpowers/plans/2026-07-09-45-firmware-modular.md`

- [ ] **Step 1:** README.md aktualisieren — Abschnitt „Nur auf dem Sender (Kart-ESP)" um die fünf neuen Module ergänzen:

```markdown
- **`config_store.py`** — Live-Config + log + NVS-Persistenz (Phase 45)
- **`radio.py`** — ESP-NOW-Link (Phase 45)
- **`imu_task.py`** — IMU-Task (MPU-6050, Phase 45)
- **`gps_task.py`** — GPS-Task (NMEA/UART, Phase 45)
- **`display_pages.py`** — OLED-Display + Seiten (Phase 45)
```

  und im mpremote-Block „── Sender (Kart-ESP) ──" nach der `calc.py`-Zeile einfügen (Bridge-Block bleibt unverändert):

```bash
mpremote connect COM3 cp config_store.py :config_store.py
mpremote connect COM3 cp radio.py :radio.py
mpremote connect COM3 cp imu_task.py :imu_task.py
mpremote connect COM3 cp gps_task.py :gps_task.py
mpremote connect COM3 cp display_pages.py :display_pages.py
```

- [ ] **Step 2: Finale Gates** — `python -m py_compile sender.py bridge.py esp_libs/*.py`; `python -m unittest discover -s test -p "test_*.py"` → `Ran 65 tests … OK`; mpy-cross-Probelauf, falls installiert: `python -m mpy_cross -o /tmp/app.mpy sender.py` (sonst als User-Checklist-Punkt belassen); JS-Seite unangetastet gegenprüfen: `git diff main..HEAD --stat -- src/ package.json` → leer. `__pycache__` löschen.
- [ ] **Step 3:** `graphify update .`; Plan-Doc committen: `docs(plan): Phase 45 Firmware-Modularisierung Implementierungsplan` (+ Trailer); README-Commit: `docs(fw): Flash-Prozedur um Phase-45-Module ergaenzt` (+ Trailer).
- [ ] **Step 4:** Push; **Draft-PR gegen `main`** mit Titel `refactor(fw): Phase 45 -- sender.py in esp_libs-Module zerlegt (nur bewegt)`, Gate-Nachweisen (py_compile, 65 Tests, color-moved-Review, Zeilen-Tabelle), Heap-Baseline-Anleitung, dem fetten Hinweis **„NICHT mergen vor Hardware-Gate (beide Karts, Wiese)"** + Pflicht-Fußzeile.

---

## Hardware/Manual Acceptance Checklist (User)

- [ ] **Heap-Baseline:** Task-1-Commit auschecken bzw. `git show <task1-hash>:sender.py > /tmp/sender_base.py`; `python -m mpy_cross -o app.mpy /tmp/sender_base.py`; ein Kart flashen (app.mpy + main_stub laut README); Boot-Log notieren: `[init] Heap frei nach Boot: <BASELINE> Bytes`.
- [ ] **Modularisierten Stand flashen:** Branch-Spitze: `python -m mpy_cross -o app.mpy sender.py`; app.mpy + die FÜNF neuen .py + bestehende esp_libs auf BEIDE Karts (mpremote-Block im README). Achtung Brownout: stabile Versorgung beim Flashen.
- [ ] **Heap-Gate:** Boot-Log beider Karts: Heap ≥ 90 % der Baseline. Darunter → Abbruchkriterium der Spec: erst Versuch „neue Module mpy-cross'en", sonst Module wieder zusammenlegen; Befund im PR dokumentieren.
- [ ] **Wiese:** Telemetrie kommt im Dashboard an (Speed/RPM/G/GPS), OLED rotiert alle 5 Seiten + forced page vom Dashboard wirkt, Pit-Call löst Override aus und lässt sich canceln, Config-Send → `✓ Bestätigung` (config_ack), IMU-Kalibrierung über Dashboard funktioniert, Reboot behält NVS-Config.
- [ ] Actions grün; erst DANN Draft-PR auf „Ready" und mergen.

## Self-Review

- **Spec-Coverage:** fünf Spec-Module → Tasks 2–6 (Namen exakt wie Spec: gps_task, imu_task, display_pages, radio, config_store); „sender.py bleibt dünner Orchestrator" → Task-6-Test `test_sender_is_thin_orchestrator` (nur RPMCounter/Battery/StatusLED/main); „mpy-cross-Prozedur unverändert" → nur cp-Zeilen ergänzt (Task 7), app.mpy+Stub identisch; „gc.mem_free() nach Boot geloggt" → Task 1; Hardware-Gate + 10-%-Abbruchkriterium → Checklist; „verschiebt Code, ändert kein Paketfeld" → nur-bewegt-Kategorien + color-moved-Gate + `_ACK_KEYS`/frame.py unangetastet.
- **Risiken verankert:** Kein CPython-Import der neuen Module nötig (AST-Tests); Config-Mutations-Sichtbarkeit über geteiltes Klassen-Objekt (dokumentiert im config_store-Kopf); On-Device-Compile der fünf .py vor WiFi-Init (RAM-günstig, Heap-Gate misst); calc-Guard-Duplikat sender/gps_task explizit erlaubt und begründet; keine Zyklen (Back-Import-Tests); RPMCounter-ISR bleibt unangetastet in sender.py.
- **Platzhalter-Scan:** Alle Import-/Kopf-Blöcke und Testcodes stehen vollständig im Plan; Bodies werden bewegt, nicht neu geschrieben (deshalb bewusst nicht dupliziert); sed-Bereiche sind Momentaufnahmen mit Pflicht-Anker-Grep pro Task.
- **Typ-Konsistenz:** Exporte/Importe (`Config, log, ConfigStore, apply_config, config_ack`, `ESPNowLink`, `IMU`, `GPS`, `Display, page_*`) identisch in Interfaces, Import-Blöcken und Tests; Testzahlen 56→59→61→62→63→65 konsistent mit den je Task ergänzten Tests (3/2/1/1/2).

## Phase Map

- Phase 44 (rasicross-Zerlegung): PR #70 offen — unabhängig, kein Konflikt (Phase 45 ist rein Python).
- **Phase 45 (dieser Plan): Firmware-Modularisierung — letzte Phase des Redesign-Programms 41–45.** Merge erst nach Hardware-Gate.
