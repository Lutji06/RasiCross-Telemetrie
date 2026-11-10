# Phase 72 — ESP-OTA: Empfangsmodul + Bootlader — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Die geräteseitige Hälfte des ESP-Updates: ein Modul, das Dateien stückweise entgegennimmt und prüft, und ein Bootlader, der umschaltet und bei Fehlschlag zurückrollt — vollständig unter CPython getestet, noch ohne Funk-/App-Anbindung.

**Architecture:** `esp_libs/ota.py` ist ein reines Datei-/Zustandsmodul (kein Funk, kein Timer): Es bekommt Nachrichten als `dict` und gibt die Antwort als `dict` zurück; wer sie transportiert (ESP-NOW im Sender, USB in der Bridge), ist Sache von Phase 73. `esp_libs/main_stub.py` wird vom Ein-Zeilen-Stub zum Bootlader mit Umschalten/Rückfall. Beide arbeiten relativ zu einem `root`-Verzeichnis, damit Tests sie in einem Temp-Ordner fahren können.

**Tech Stack:** MicroPython ≥ 1.28 (`os`, `hashlib`, `binascii`, `json`), CPython `unittest` + `tempfile` für Tests.

**Spec:** `docs/superpowers/specs/2026-11-10-esp-ota-update-design.md` (Abschnitte 4.2–4.4, 6, 7)

## Global Constraints

- Jede Nachricht ≤ 250 B als kompaktes JSON, inklusive des Routing-Felds `"target_mac":"aa:bb:cc:dd:ee:ff"`, das die App anhängt. Nutzdaten pro `ota_data`: **120 Rohbytes** (160 Base64-Zeichen).
- Ein Gerät darf durch ein Update nie tot sein: jeder Zustand muss einen Stromausfall an beliebiger Stelle überleben.
- `main.py` (Bootlader) und NVS werden vom Update nie angefasst.
- Kein Import von `network`/`espnow`/`machine` in `ota.py` auf Modulebene; `machine.reset` nur im Bootlader und dort erst im Fehlerfall importieren.
- Additiv: `sender.py` und `bridge.py` bleiben in dieser Phase unverändert.
- Dateien sind **CRLF**; Zielbereich direkt vor jedem Edit frisch lesen. Kommentare/Bezeichner ASCII (`ue` statt `ü`) wie im Bestand.
- Branch `feat/phase-72-ota-empfang` von `main` (nach Merge von PR #118, der die Spec enthält). Commits: conventional, deutsch, ohne doppelte Anführungszeichen in der Message, Trailer `Co-Authored-By: Claude <noreply@anthropic.com>`.
- Verifikation pro Task: `python -m py_compile sender.py bridge.py esp_libs/*.py`, `python -m unittest discover -s test -p "test_*.py"`, `npx ruff check .` falls verfügbar; `__pycache__` vor `git status` löschen. Python heißt `python` oder `py -3`.

## Review Focus

1. **Stromausfall mitten im Umschalten** (einige Dateien schon getauscht, andere nicht) → nächster Boot beendet das Umschalten oder rollt sauber zurück, nie Mischzustand. Test in Task 3.
2. **Bösartiger/kaputter Dateiname** (`main.py`, `../x`, `boot.py`, Unterordner) → Ablehnung mit Fehler `name`, nichts wird geschrieben. Test in Task 1.
3. **Doppeltes oder vorauseilendes Datenstück** (Funk-Wiederholung, verlorenes Ack) → Duplikat wird nur erneut bestätigt, Lücke wird mit erwartetem Offset abgelehnt; Datei bleibt bytegenau. Test in Task 2.
4. **Neustart mit halber Übertragung** → Reste in `/ota_new/` werden verworfen, laufendes Programm unberührt, neue Übertragung startet sauber. Test in Task 2.
5. **Neues Paket lässt sich nicht importieren, obwohl alle Hashes stimmen** → sofortiger Rückfall und Neustart, Zustand `rolledback`. Test in Task 3.

---

## Festlegungen (für alle Tasks)

**Dateien auf dem Gerät** (alle relativ zu `root`, auf dem ESP `""`):

| Pfad | Inhalt |
|---|---|
| `ota_state` | ein Wort: `ready`, `swap`, `trial`, `rollback`, `rollback2`, `rolledback`; fehlt = Normalzustand |
| `ota_manifest.json` | installiertes Paket: `{"id": str, "lbl": str, "files": [str]}`; fehlt = `id` leer |
| `ota_new/` | eingehende Dateien + `ota_manifest.json` des neuen Pakets |
| `ota_old/` | beim Umschalten verdrängte Dateien (inkl. altem `ota_manifest.json`) |

**Erlaubte Dateinamen:** nur Basisnamen aus `[a-z0-9_]`, Endung `.mpy` oder `.py`, höchstens 32 Zeichen, nicht `main.py`, nicht `boot.py`. `ota_manifest.json` schreibt nur das Modul selbst.

**Nachrichten** (Feld `type` wie Spalte 1):

| type | Felder | Bedeutung |
|---|---|---|
| `ota_info` | — | Anfrage |
| `ota_begin` | `id` (16 hex), `lbl`, `n`, `sz` | Paket-ID, Etikett, Dateianzahl, Gesamtbytes |
| `ota_file` | `i`, `name`, `sz`, `sha` (64 hex) | Datei `i` (ab 0, aufsteigend) |
| `ota_data` | `i`, `o`, `d` (Base64) | Stück ab Offset `o` |
| `ota_end` | — | Hashes prüfen, bereitstellen |
| `ota_abort` | — | alles verwerfen |

**Antworten:**

- `{"type":"ota_info","id":str,"lbl":str,"st":str,"mpy":str,"free":int}`; `st` ∈ `ok`, `rx`, `ready`, `trial`, `rolledback`. Bei `st == "rx"` zusätzlich `"rid"` (ID der laufenden Übertragung), `"i"`, `"o"` (nächste erwartete Datei/Offset).
- `{"type":"ota_ack","s":<begin|file|data|end|abort>,"i":int,"o":int}`, im Fehlerfall zusätzlich `"e"`.
- Fehlercodes `e`: `state` (Nachricht passt nicht zum Ablauf), `name`, `size`, `space`, `gap`, `hash`, `io`.

**Zeitwerte:** Update-Modus endet nach `RX_TIMEOUT_MS = 30000` ohne gültige `ota_*`-Nachricht. Platzreserve `FREE_MARGIN = 16384` Bytes.

## File Structure

| Action | Path | Responsibility |
|---|---|---|
| Create | `esp_libs/ota.py` | Empfang, Prüfung, Zustandsdatei, Bestätigen der Probe |
| Modify | `esp_libs/main_stub.py` | Bootlader: Umschalten, Rückfall, `import app` |
| Create | `test/test_ota.py` | Tests für `ota.py` |
| Create | `test/test_ota_boot.py` | Tests für den Bootlader + Durchstich Empfang→Boot |
| Modify | `esp_libs/README.md` | Abschnitt „Update-Ablage auf dem Gerät“ |

Reihenfolge: Task 1 → 2 → 3 → 4.

---

### Task 1: `ota.py` — Zustand, Namensprüfung, `info()`

**Files:**
- Create: `esp_libs/ota.py`
- Test: `test/test_ota.py`

**Interfaces:**
- Produces:
  - `ota.valid_name(name) -> bool`
  - `ota.read_state(root="") -> str` (leerer String, wenn Datei fehlt), `ota.write_state(root, word)` (`""` löscht die Datei)
  - `ota.read_manifest(root="") -> dict` (`{"id": "", "lbl": "", "files": []}` wenn Datei fehlt oder unlesbar)
  - `ota.join(root, name) -> str` (kein `os.path` — gibt es in MicroPython nicht)
  - `class OtaReceiver(root="")` mit `info() -> dict`, Attribut `active: bool` (anfangs `False`)
  - Konstanten `STATE_FILE = "ota_state"`, `MANIFEST = "ota_manifest.json"`, `NEW_DIR = "ota_new"`, `OLD_DIR = "ota_old"`, `RX_TIMEOUT_MS`, `FREE_MARGIN`

- [ ] **Step 1: Failing tests schreiben** (`test/test_ota.py`, Klasse `TestOtaBasics`, jeder Test mit eigenem `tempfile.mkdtemp()` als `root`; Import-Vorspann wie in `test/test_firmware.py`: `mpstub.install()`, `esp_libs` in `sys.path`)

```python
def test_valid_name(self):
    for ok in ("app.mpy", "frame.mpy", "gps_task.mpy", "calc.py"):
        self.assertTrue(ota.valid_name(ok), ok)
    for bad in ("main.py", "boot.py", "../x.mpy", "a/b.mpy", "App.mpy",
                "x.txt", "", ".mpy", "ota_manifest.json", "a" * 30 + ".mpy"):
        self.assertFalse(ota.valid_name(bad), bad)

def test_state_roundtrip(self):
    self.assertEqual(ota.read_state(self.root), "")
    ota.write_state(self.root, "trial")
    self.assertEqual(ota.read_state(self.root), "trial")
    ota.write_state(self.root, "")
    self.assertFalse(os.path.exists(os.path.join(self.root, "ota_state")))

def test_info_fresh_device(self):
    info = ota.OtaReceiver(self.root).info()
    self.assertEqual(info["type"], "ota_info")
    self.assertEqual(info["id"], "")
    self.assertEqual(info["st"], "ok")
    self.assertIsInstance(info["free"], int)

def test_info_reports_installed_and_rolledback(self):
    with open(os.path.join(self.root, "ota_manifest.json"), "w") as f:
        json.dump({"id": "abcdef0123456789", "lbl": "2.1.0", "files": ["app.mpy"]}, f)
    ota.write_state(self.root, "rolledback")
    info = ota.OtaReceiver(self.root).info()
    self.assertEqual((info["id"], info["lbl"], info["st"]),
                     ("abcdef0123456789", "2.1.0", "rolledback"))

def test_info_fits_radio_budget(self):
    info = ota.OtaReceiver(self.root).info()
    info.update(id="f" * 16, lbl="99.99.99", st="rx", rid="f" * 16, i=99, o=999999)
    self.assertLessEqual(len(json.dumps(info, separators=(",", ":"))), 250)
```

- [ ] **Step 2: Laufen lassen, Fehlschlag sehen**

Run: `python -m unittest test.test_ota -v` → FAIL (`No module named 'ota'`)

- [ ] **Step 3: `esp_libs/ota.py` anlegen** mit den oben genannten Funktionen und `OtaReceiver.__init__`/`info`.
  - `mpy`: `"%d.%d" % sys.implementation.version[:2]`.
  - `free`: `os.statvfs(root or "/")` → `f_bsize * f_bavail`; bei Ausnahme `-1`. In eine Modulfunktion `free_bytes(root)` legen (Tests überschreiben sie).
  - `st`-Abbildung: Zustandswort `ready`/`swap` → `ready`; `trial` → `trial`; `rolledback`/`rollback` → `rolledback`; sonst `rx` wenn `active`, sonst `ok`.
  - Kopfkommentar im Stil der übrigen `esp_libs`-Dateien (Zweck, Phase 72, Verweis auf die Spec).

- [ ] **Step 4: Tests grün**

Run: `python -m unittest test.test_ota -v` → OK; danach die Global-Constraints-Verifikation.

- [ ] **Step 5: Commit** — `feat(ota): Zustandsablage, Namenspruefung und ota_info (Phase 72)`

---

### Task 2: `ota.py` — Übertragung

**Files:**
- Modify: `esp_libs/ota.py`
- Test: `test/test_ota.py` (Klasse `TestOtaTransfer`)

**Interfaces:**
- Consumes: alles aus Task 1.
- Produces:
  - `OtaReceiver.handle(msg: dict, now_ms: int) -> dict | None` — verarbeitet jede `ota_*`-Nachricht, gibt die Antwort zurück; `None` für fremde `type`.
  - `OtaReceiver.tick(now_ms: int) -> bool` — `True` genau dann, wenn dieser Aufruf den Update-Modus wegen Timeout beendet hat.
  - Nach erfolgreichem `ota_end`: `ota_state == "ready"`, `ota_new/ota_manifest.json` geschrieben, Attribut `reboot_requested = True` (der Aufrufer startet neu, nicht das Modul).

**Verhalten (verbindlich):**
- Konstruktor: liegt `ota_new/` vor und ist der Zustand weder `ready` noch `swap`, wird `ota_new/` gelöscht (Review Focus 4).
- `ota_begin`: prüft Platz (`free_bytes < sz + FREE_MARGIN` → `e: space`; `free_bytes == -1` gilt als ausreichend). Läuft bereits eine Übertragung **derselben** `id`, wird nichts verworfen und mit dem aktuellen `i`/`o` geantwortet (Fortsetzen); bei anderer `id` wird neu begonnen. Im Zustand `ready`/`swap`/`trial` → `e: state`. Setzt `active = True`.
- `ota_file`: nur für `i ==` nächste erwartete Datei und erst, wenn die vorige vollständig ist; sonst `e: state`. Name ungültig → `e: name`; `sz <= 0` oder Summe aller `sz` > angekündigtes `sz` → `e: size`. Wiederholtes `ota_file` für die gerade laufende Datei mit identischen Feldern → normales Ack mit aktuellem Offset.
- `ota_data`: `o ==` aktuelle Dateigröße → anhängen, Ack mit neuem `o`. `o <` aktuelle Größe → nichts schreiben, Ack mit aktuellem `o` (Duplikat). `o >` → `e: gap` mit aktuellem `o`. Stück würde die Datei über `sz` hinaus verlängern → `e: size`. Ungültiges Base64 → `e: io`.
- `ota_end`: alle `n` Dateien vollständig, sonst `e: state`. SHA-256 jeder Datei in 512-Byte-Blöcken nachrechnen; Abweichung → `e: hash` mit `i` der Datei, `ota_new/` löschen, `active = False`.
- `ota_abort`: `ota_new/` löschen, `active = False`, Ack.
- Jede gültige `ota_*`-Nachricht (auch `ota_info`) setzt die Timeout-Uhr zurück; `ota_info` beendet/startet den Update-Modus nicht.
- Dateien werden pro Stück geöffnet (`"ab"`) und geschlossen — kein offenes Handle über Nachrichten hinweg.

- [ ] **Step 1: Failing tests schreiben.** Hilfsfunktion im Test: `send_package(rx, files: dict[str, bytes], pkg_id="0123456789abcdef", chunk=120)` schickt `ota_begin`, je Datei `ota_file` + `ota_data`-Stücke, gibt die Liste aller Antworten zurück (ohne `ota_end`). Tests:

```python
def test_full_transfer_marks_ready(self):
    files = {"app.mpy": os.urandom(1000), "frame.mpy": os.urandom(333)}
    acks = send_package(self.rx, files)
    self.assertTrue(all("e" not in a for a in acks))
    end = self.rx.handle({"type": "ota_end"}, 0)
    self.assertNotIn("e", end)
    self.assertEqual(ota.read_state(self.root), "ready")
    self.assertTrue(self.rx.reboot_requested)
    for name, data in files.items():
        with open(os.path.join(self.root, "ota_new", name), "rb") as f:
            self.assertEqual(f.read(), data)
    with open(os.path.join(self.root, "ota_new", "ota_manifest.json")) as f:
        self.assertEqual(json.load(f), {"id": "0123456789abcdef", "lbl": "2.1.0",
                                         "files": ["app.mpy", "frame.mpy"]})

def test_duplicate_chunk_is_acked_not_written(self):      # Review Focus 3
    # begin + file(sz=240), Stueck o=0 zweimal senden -> zweites Ack o=120, Datei 120 B

def test_gap_is_rejected_with_expected_offset(self):      # Review Focus 3
    # Stueck o=120 vor o=0 -> e == "gap", o == 0, Datei leer/nicht vorhanden

def test_chunk_beyond_declared_size(self):                # e == "size"

def test_bad_name_rejected_nothing_written(self):         # Review Focus 2
    # ota_file name="main.py" und name="../x.mpy" -> e == "name", ota_new enthaelt keine Datei

def test_wrong_hash_discards_everything(self):
    # sha eines anderen Inhalts -> ota_end e == "hash", ota_new weg, state "", active False

def test_end_before_complete(self):                       # e == "state"

def test_resume_same_id_keeps_progress(self):
    # nach 2 Stuecken erneut ota_begin gleicher id -> Ack i=0, o=240; anderer id -> o=0, Datei weg

def test_no_space(self):
    # ota.free_bytes = lambda root: 1000 -> ota_begin sz=5000 -> e == "space", active False

def test_timeout_leaves_update_mode_but_keeps_partial(self):
    # letzte Nachricht bei now=0: tick(29999) False, tick(30000) True, active False,
    # Teil-Datei noch da; tick(30001) False

def test_restart_discards_partial(self):                  # Review Focus 4
    # halbe Uebertragung, dann neuer OtaReceiver(root) -> ota_new existiert nicht, info st "ok"

def test_begin_rejected_while_trial(self):                # state "trial" -> e == "state"

def test_abort(self):

def test_messages_fit_radio_budget(self):
    # groesstes ota_file (name 32 Zeichen) und ota_data (120 B, i=99, o=999999) jeweils mit
    # "target_mac":"aa:bb:cc:dd:ee:ff" kompakt serialisiert <= 250; ebenso jedes ota_ack

def test_foreign_type_returns_none(self):                 # {"type": "config"} -> None
```

Die als Kommentar skizzierten Tests vollständig ausschreiben; die genannten Werte sind die Sollwerte.

- [ ] **Step 2: Fehlschlag sehen** — `python -m unittest test.test_ota -v`
- [ ] **Step 3: `handle`/`tick` implementieren.** `hashlib` mit Fallback `uhashlib`, `binascii` mit Fallback `ubinascii`, `json` mit Fallback `ujson` (jeweils `try/except ImportError`). Verzeichnis rekursiv löschen als eigene Funktion `rmtree(path)` (wird in Task 3 wiederverwendet; `os.listdir` + `os.remove` + `os.rmdir`, fehlendes Verzeichnis ist kein Fehler).
- [ ] **Step 4: Tests grün** + Global-Constraints-Verifikation.
- [ ] **Step 5: Commit** — `feat(ota): stueckweise Uebertragung mit Pruefsumme und Fortsetzen (Phase 72)`

---

### Task 3: Bootlader — Umschalten und Rückfall

**Files:**
- Modify: `esp_libs/main_stub.py` (komplett ersetzen; bleibt die Datei, die als `main.py` aufs Gerät geht)
- Test: `test/test_ota_boot.py`

**Interfaces:**
- Consumes: Ablage-Festlegungen (Zustandswörter, Verzeichnisse). Der Bootlader **importiert `ota.py` nicht** — er muss auch laufen, wenn ein Update `ota.mpy` zerstört hat. Die wenigen Hilfen (Zustand lesen/schreiben, verschieben, Verzeichnis leeren) stehen als eigene kleine Kopie im Bootlader.
- Produces:
  - `prepare(root="") -> str` — führt anstehendes Umschalten/Rückfall aus, gibt den Zustand zurück, mit dem `app` gestartet wird (`""`, `trial` oder `rolledback`).
  - `rollback(root="")`
  - `boot(root="", importer=None, reset=None)` — `prepare`, dann `importer()` (Standard: `import app`); wirft der Import im Zustand `trial`, folgt `rollback` + `reset()` (Standard: `machine.reset`). In jedem anderen Zustand wird die Ausnahme weitergereicht.
  - Letzte Zeile der Datei, exakt: `boot()` — der Test lädt die Datei ohne diese Zeile (gleiches Muster wie `_load` in `test/test_firmware.py`).

**Ablauf `prepare` (verbindlich, jeder Schritt stromausfallfest):**

1. Zustand `ready` → Zustand `swap` schreiben, weiter mit 2.
2. Zustand `swap` → für jede Datei aus `ota_new/ota_manifest.json` (`files` + `ota_manifest.json` selbst), in dieser Reihenfolge und **idempotent**:
   a. Liegt die neue Datei noch in `ota_new/`: vorhandene Root-Datei gleichen Namens **und** die gleichnamige Schwester mit der anderen Endung (`x.py` ↔ `x.mpy`) nach `ota_old/` verschieben, sofern dort noch nicht vorhanden; dann neue Datei nach Root verschieben.
   b. Liegt sie nicht mehr in `ota_new/`: schon erledigt, überspringen.
   Danach `ota_new/` entfernen, Zustand `trial`. Rückgabe `trial`.
3. Zustand `trial` beim Start (voriger Lauf hat nicht bestätigt) oder `rollback` → `rollback(root)`, Rückgabe `rolledback`.
4. Sonst nichts tun, Zustand unverändert zurückgeben (`rolledback` bleibt stehen, bis `ota.confirm`/ein neues Update ihn ersetzt).

**Ablauf `rollback` (zweiphasig, bei der Umsetzung so präzisiert):** Phase 1 (Zustand `rollback`): Dateien des installierten Manifests (`files` + Manifest), die **nicht** in `ota_old/` liegen, aus Root löschen — nur wenn `ota_old/` überhaupt etwas enthält; dann Zustand `rollback2`. Phase 2: alles aus `ota_old/` nach Root verschieben (überschreibt die neuen Dateien), `ota_old/` und `ota_new/` entfernen, Zustand `rolledback`. Die Trennung ist nötig, weil die Lösch-Liste aus dem Inhalt von `ota_old/` abgeleitet wird und nach dem ersten Zurückspielen nicht mehr stimmt — ein einphasiger Ablauf würde nach einem Stromausfall bereits zurückgespielte Dateien löschen.

**Weitere Präzisierungen aus der Umsetzung:** Ein unlesbares Manifest im Zustand `ready` verwirft das bereitgestellte Paket (Zustand leer, altes Programm startet). `boot` prüft bei einem Fehler den Zustand **neu** — hat sich die Version inzwischen bestätigt, wird nicht zurückgerollt. Die Größengrenze des Bootladers zählt Code-Zeilen ohne Kommentare.

- [ ] **Step 1: Failing tests schreiben.** Hilfen im Test: `stage(root, files, pkg_id)` legt `ota_new/` samt Manifest an und schreibt Zustand `ready`; `tree(root)` liefert `{relpath: bytes}`.

```python
def test_swap_installs_and_enters_trial(self):
    # Root: app.mpy=b"old", frame.py=b"oldframe", ota_manifest.json(id "old")
    # staged: app.mpy=b"new", frame.mpy=b"newframe"
    # prepare -> "trial"; Root: app.mpy == b"new", frame.mpy == b"newframe", frame.py fehlt,
    # Manifest-id neu; ota_old: app.mpy b"old", frame.py b"oldframe", altes Manifest; ota_new weg

def test_unconfirmed_trial_rolls_back(self):
    # nach obigem Swap erneut prepare -> "rolledback"; tree(root) == Ausgangsbaum + ota_state

def test_interrupted_swap_is_completed(self):             # Review Focus 1
    # Zustand "swap", app.mpy bereits getauscht (alt in ota_old, neu in Root),
    # frame.mpy noch in ota_new -> prepare -> "trial", Ergebnis identisch zu test_swap...

def test_interrupted_rollback_is_completed(self):         # Review Focus 1
    # Zustand "rollback", eine Datei schon zurueck, eine noch in ota_old -> "rolledback",
    # Root == Ausgangsbaum

def test_import_failure_in_trial_rolls_back_and_resets(self):   # Review Focus 5
    # staged Paket; boot(root, importer=lambda: 1/0, reset=flag) -> reset aufgerufen,
    # Zustand "rolledback", Root == Ausgangsbaum

def test_import_failure_without_trial_propagates(self):
    # kein Update anstehend; boot(root, importer=raise ValueError) -> ValueError, reset nicht aufgerufen

def test_normal_boot_touches_nothing(self):
    # tree vorher == tree nachher, importer genau einmal aufgerufen

def test_first_update_on_device_without_manifest(self):
    # Root nur app.mpy + frame.py (kein Manifest); Swap + Rollback stellen exakt das wieder her

def test_rollback_without_old_dir_keeps_files(self):
    # Zustand "trial", kein ota_old -> "rolledback", Root-Dateien unveraendert

def test_bootloader_does_not_import_ota(self):
    # Quelltext von main_stub.py enthaelt weder "import ota" noch "from ota"
```

Die skizzierten Tests vollständig ausschreiben.

- [ ] **Step 2: Fehlschlag sehen** — `python -m unittest test.test_ota_boot -v`
- [ ] **Step 3: `esp_libs/main_stub.py` neu schreiben.** Kopfkommentar behalten/erweitern (warum Stub, warum `.py`, warum kein `import ota`). Verschieben per `os.rename`; existiert das Ziel, vorher `os.remove` (Windows-Tests und FAT verhalten sich sonst unterschiedlich). Zielgröße: unter 120 Inhaltszeilen — die Datei wird on-device kompiliert.
- [ ] **Step 4: Tests grün** + Global-Constraints-Verifikation (inkl. `python -m unittest test.test_firmware test.test_modular` — der bisherige Stub wird dort ggf. referenziert; Anpassungen dort nur, wenn ein Test wegen der neuen Datei bricht).
- [ ] **Step 5: Commit** — `feat(ota): Bootlader mit Umschalten und automatischem Rueckfall (Phase 72)`

---

### Task 4: Probe bestätigen, Durchstich, Doku

**Files:**
- Modify: `esp_libs/ota.py`
- Modify: `test/test_ota_boot.py` (Klasse `TestOtaEndToEnd`)
- Modify: `esp_libs/README.md`

**Interfaces:**
- Consumes: `OtaReceiver.handle`, `prepare`, `boot`.
- Produces:
  - `ota.confirm(root="") -> bool` — im Zustand `trial`: `ota_old/` löschen, Zustand löschen, `True`. Sonst `False`, nichts ändern.
  - `ota.acknowledge_rollback(root="") -> bool` — im Zustand `rolledback`: Zustand löschen, `True` (die App ruft das in Phase 74 auf, nachdem sie den Rückfall angezeigt hat; ein neues `ota_begin` ist auch ohne das erlaubt).

- [ ] **Step 1: Failing tests schreiben**

```python
def test_confirm_only_in_trial(self):
    # Zustand "" -> False; "trial" mit ota_old -> True, ota_old weg, Zustand ""

def test_confirmed_update_survives_reboot(self):
    # Empfang (send_package + ota_end) -> prepare ("trial") -> confirm -> prepare ("")
    # Root enthaelt neue Dateien; info(): id == neue id, st == "ok"

def test_unconfirmed_update_end_to_end(self):
    # Empfang -> prepare ("trial") -> prepare ("rolledback")
    # info(): id == alte id, st == "rolledback"; danach ota_begin erlaubt (kein e)

def test_begin_after_rolledback_clears_state(self):
    # erfolgreiches ota_begin im Zustand "rolledback" loescht den Zustand

def test_acknowledge_rollback(self):
```

- [ ] **Step 2: Fehlschlag sehen**
- [ ] **Step 3: `confirm`/`acknowledge_rollback` implementieren**, `ota_begin` für Zustand `rolledback` anpassen.
- [ ] **Step 4: README ergänzen** — neuer Abschnitt „Update-Ablage auf dem Gerät (Phase 72)“ in `esp_libs/README.md`: Tabelle der vier Pfade, Bedeutung der Zustandswörter, Hinweis „`main.py` ist ab jetzt der Bootlader und wird nie per Update ersetzt“, und dass die Anbindung an Funk/App mit Phase 73/74 folgt. Die Flash-Prozedur (Abschnitt 3) bleibt in dieser Phase unverändert, weil `sender.py`/`bridge.py` `ota` noch nicht nutzen.
- [ ] **Step 5: Gesamtverifikation** — `python -m py_compile sender.py bridge.py esp_libs/*.py`; `python -m unittest discover -s test -p "test_*.py"` (alle grün, Anzahl gegenüber `main` nur gewachsen); `npm test`; `npm run lint`.
- [ ] **Step 6: Commit** — `feat(ota): Probe bestaetigen, Durchstich-Tests und Doku (Phase 72)`; danach Plan-Doc-Commit `docs(phase-72): Plan OTA Empfang und Bootlader`.

---

## Hardware-/Manuelle Abnahme (durch den Nutzer, nicht blockierend für den Merge)

Diese Phase ändert nichts am laufenden Gerät, solange `main.py` nicht neu geflasht wird. Optionaler Vorab-Check auf einem ESP per `mpremote`:

- [ ] `mpremote cp esp_libs/main_stub.py :main.py` + Reset → Gerät startet wie bisher.
- [ ] Von Hand `ota_new/` mit einer kaputten `app.mpy` und Manifest anlegen, `ota_state` = `ready`, Reset → Gerät rollt zurück und läuft mit der alten Version; `ota_state` = `rolledback`.

## Self-Review

- **Spec-Abdeckung:** 4.2 Protokoll (Geräteseite) → Task 1/2; 4.3 Prüfung/Timeout → Task 2 (Update-Modus des Senders selbst = Phase 73); 4.4 Umschalten/Rückfall → Task 3, Bestätigen → Task 4 (die Kriterien „20 s + quittiertes Paket“, „60 s Selbst-Neustart“ gehören zur Verdrahtung in Phase 73); Annahme 2 (`.py`-Schwester entfernen) → Task 3; Annahme 3 (Bootlader/NVS unberührt) → Namensprüfung Task 1 + Test Task 3; Tests Abschnitt 7 „Firmware“ → Tasks 2–4.
- **Bewusst nicht in dieser Phase:** Versionsmeldung über Funk, Bridge-Weiterleitung, Paket-Build, App.
- **Namen konsistent:** `OtaReceiver`, `handle(msg, now_ms)`, `tick(now_ms)`, `prepare`, `rollback`, `boot`, `confirm`, Zustandswörter wie in der Festlegungs-Tabelle.

## Phase Map

| Phase | Inhalt |
|---|---|
| 71 | Pause-Uhr + Lat/Lon (PR #118) |
| **72** | **OTA: Empfangsmodul + Bootlader (dieser Plan)** |
| 73 | OTA: Verdrahtung in `sender.py`/`bridge.py`, Versionsmeldung, Weiterleitung, Probe-Bestätigung |
| 74 | OTA: Paket-Build im Release |
| 75 | OTA: App-Übertragung + Oberfläche |
| 76 | OTA: README/Erstinstallation, Hardware-Abnahme |
