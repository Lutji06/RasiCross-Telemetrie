# ============================================================
#  RasiCross -- ota.py  (Update-Empfang, Phase 72)
# ============================================================
#  Geraeteseitige Haelfte des Updates aus der App. Laeuft auf BEIDEN
#  ESPs (Sender und Bridge) und ist reine Datei-/Zustandslogik:
#  handle() bekommt eine Nachricht als dict und gibt die Antwort als
#  dict zurueck. Wer sie transportiert (ESP-NOW im Sender, USB in der
#  Bridge), entscheidet der Aufrufer -- deshalb hier kein Funk, kein
#  Timer, kein machine.reset.
#
#  Ablauf: ota_begin -> je Datei ota_file + ota_data-Stuecke -> ota_end.
#  Die Dateien landen in ota_new/. Erst wenn jede Pruefsumme stimmt,
#  wird der Zustand "ready" geschrieben; das eigentliche Umschalten und
#  der Rueckfall passieren beim naechsten Boot in main.py (Bootlader,
#  esp_libs/main_stub.py). Das laufende Programm wird hier nie angefasst.
#
#  Spec: docs/superpowers/specs/2026-11-10-esp-ota-update-design.md
# ============================================================

import os
import sys

try:
    import hashlib
except ImportError:
    import uhashlib as hashlib
try:
    import binascii
except ImportError:
    import ubinascii as binascii
try:
    import json
except ImportError:
    import ujson as json

STATE_FILE = "ota_state"
MANIFEST = "ota_manifest.json"
NEW_DIR = "ota_new"
OLD_DIR = "ota_old"

RX_TIMEOUT_MS = 30000     # Update-Modus endet ohne gueltige ota_*-Nachricht
FREE_MARGIN = 16384       # Flash-Reserve ueber die Paketgroesse hinaus
MAX_NAME = 32

_NAME_CHARS = "abcdefghijklmnopqrstuvwxyz0123456789_"
_RESERVED = ("main.py", "boot.py")     # Bootlader -- nie per Update ersetzen
# Zustaende, in denen ein Umschalten/Rueckfall noch aussteht: kein neues Update.
_BUSY = ("ready", "swap", "trial", "rollback", "rollback2")


def join(root, name):
    """Pfad unter root. MicroPython hat kein os.path."""
    return root + "/" + name if root else name


def exists(path):
    try:
        os.stat(path)
        return True
    except OSError:
        return False


def valid_name(name):
    """Nur flache Modul-Dateien: [a-z0-9_]+ mit .mpy/.py, nie der Bootlader."""
    if not isinstance(name, str) or len(name) > MAX_NAME or name in _RESERVED:
        return False
    if name.endswith(".mpy"):
        stem = name[:-4]
    elif name.endswith(".py"):
        stem = name[:-3]
    else:
        return False
    if not stem:
        return False
    for ch in stem:
        if ch not in _NAME_CHARS:
            return False
    return True


def read_state(root=""):
    try:
        with open(join(root, STATE_FILE)) as f:
            return f.read().strip()
    except OSError:
        return ""


def write_state(root, word):
    path = join(root, STATE_FILE)
    if not word:
        try:
            os.remove(path)
        except OSError:
            pass
        return
    with open(path, "w") as f:
        f.write(word)


def read_manifest(root=""):
    """Installiertes Paket. Fehlt die Datei oder ist sie kaputt: leer."""
    try:
        with open(join(root, MANIFEST)) as f:
            m = json.load(f)
        return {"id": str(m.get("id", "")), "lbl": str(m.get("lbl", "")),
                "files": list(m.get("files", []))}
    except (OSError, ValueError, AttributeError, TypeError):
        return {"id": "", "lbl": "", "files": []}


def rmtree(path):
    """Verzeichnis samt Inhalt loeschen; fehlt es, ist das kein Fehler."""
    try:
        names = os.listdir(path)
    except OSError:
        return
    for n in names:
        p = join(path, n)
        try:
            os.remove(p)
        except OSError:
            rmtree(p)
    try:
        os.rmdir(path)
    except OSError:
        pass


def free_bytes(root=""):
    """Freier Flash in Bytes, -1 wenn nicht ermittelbar."""
    try:
        s = os.statvfs(root or "/")
        return s[0] * s[4]
    except Exception:
        return -1


def confirm(root=""):
    """Probe bestanden: alte Version verwerfen, Zustand loeschen."""
    if read_state(root) != "trial":
        return False
    rmtree(join(root, OLD_DIR))
    write_state(root, "")
    return True


def acknowledge_rollback(root=""):
    """Die App hat den Rueckfall angezeigt -- Merker loeschen."""
    if read_state(root) != "rolledback":
        return False
    write_state(root, "")
    return True


def _ticks_diff(a, b):
    try:
        import utime
        return utime.ticks_diff(a, b)
    except ImportError:
        return a - b


def _is_count(v):
    return isinstance(v, int) and not isinstance(v, bool) and v > 0


class OtaReceiver:
    """Nimmt ein Paket stueckweise entgegen.
       handle(msg, now_ms) -> Antwort-dict (oder None bei fremdem type)
       tick(now_ms)        -> True, wenn der Update-Modus per Timeout endete
       active              -> Update-Modus (Aufrufer pausiert Telemetrie)
       reboot_requested    -> nach erfolgreichem ota_end: bitte neu starten"""

    def __init__(self, root=""):
        self.root = root
        self.active = False
        self.reboot_requested = False
        self._last_rx = 0
        self._reset()
        # Halbe Uebertragung aus dem vorigen Lauf: verwerfen. Ein fertig
        # bereitgestelltes Paket (ready/swap) gehoert dem Bootlader.
        if read_state(root) not in ("ready", "swap"):
            rmtree(join(root, NEW_DIR))

    def _reset(self):
        self._rid = ""          # ID der laufenden Uebertragung
        self._lbl = ""
        self._n = 0             # angekuendigte Dateianzahl
        self._sz = 0            # angekuendigte Gesamtgroesse
        self._files = []        # [name, sz, sha] in Reihenfolge
        self._cur = 0           # geschriebene Bytes der letzten Datei
        self._declared = 0      # Summe der bisher angekuendigten Dateigroessen

    # ── naechste erwartete Position ──
    def _cur_done(self):
        return bool(self._files) and self._cur >= self._files[-1][1]

    def _next_i(self):
        if not self._files:
            return 0
        return len(self._files) if self._cur_done() else len(self._files) - 1

    def _next_o(self):
        if not self._files or self._cur_done():
            return 0
        return self._cur

    def _ack(self, step, err=None, i=None):
        a = {"type": "ota_ack", "s": step,
             "i": self._next_i() if i is None else i, "o": self._next_o()}
        if err:
            a["e"] = err
        return a

    def info(self):
        m = read_manifest(self.root)
        word = read_state(self.root)
        if word in ("ready", "swap"):
            st = "ready"
        elif word == "trial":
            st = "trial"
        elif word in ("rolledback", "rollback", "rollback2"):
            st = "rolledback"
        elif self.active:
            st = "rx"
        else:
            st = "ok"
        v = sys.implementation.version
        d = {"type": "ota_info", "id": m["id"], "lbl": m["lbl"], "st": st,
             "mpy": "%d.%d" % (v[0], v[1]), "free": free_bytes(self.root)}
        if st == "rx":
            d["rid"] = self._rid
            d["i"] = self._next_i()
            d["o"] = self._next_o()
        return d

    def tick(self, now_ms):
        if self.active and _ticks_diff(now_ms, self._last_rx) >= RX_TIMEOUT_MS:
            # Teil-Dateien bleiben liegen -- die App kann fortsetzen.
            self.active = False
            return True
        return False

    def handle(self, msg, now_ms):
        kind = msg.get("type") if isinstance(msg, dict) else None
        if kind == "ota_info":
            self._last_rx = now_ms
            return self.info()
        fn = {"ota_begin": self._begin, "ota_file": self._file,
              "ota_data": self._data, "ota_end": self._end,
              "ota_abort": self._abort}.get(kind)
        if fn is None:
            return None
        self._last_rx = now_ms
        return fn(msg)

    def _begin(self, msg):
        word = read_state(self.root)
        if word in _BUSY:
            return self._ack("begin", "state")
        pid, n, sz = msg.get("id"), msg.get("n"), msg.get("sz")
        if not (isinstance(pid, str) and pid and _is_count(n) and _is_count(sz)):
            return self._ack("begin", "size")
        if pid == self._rid:
            # Fortsetzen nach Funkabriss/Timeout: nichts verwerfen.
            self.active = True
            return self._ack("begin")
        rmtree(join(self.root, NEW_DIR))
        self._reset()
        self.active = False
        free = free_bytes(self.root)
        if free != -1 and free < sz + FREE_MARGIN:
            return self._ack("begin", "space")
        try:
            os.mkdir(join(self.root, NEW_DIR))
        except OSError:
            return self._ack("begin", "io")
        if word == "rolledback":
            write_state(self.root, "")
        self._rid = pid
        self._lbl = str(msg.get("lbl", ""))
        self._n = n
        self._sz = sz
        self.active = True
        self.reboot_requested = False
        return self._ack("begin")

    def _file(self, msg):
        if not self.active:
            return self._ack("file", "state")
        i, name, sz, sha = msg.get("i"), msg.get("name"), msg.get("sz"), msg.get("sha")
        if self._files and i == len(self._files) - 1 and \
                [name, sz, sha] == self._files[-1]:
            return self._ack("file")           # wiederholte Ankuendigung
        if i != len(self._files) or i >= self._n or \
                (self._files and not self._cur_done()):
            return self._ack("file", "state")
        if not valid_name(name) or name in [f[0] for f in self._files]:
            return self._ack("file", "name")
        if not _is_count(sz) or self._declared + sz > self._sz:
            return self._ack("file", "size")
        if not (isinstance(sha, str) and len(sha) == 64):
            return self._ack("file", "hash")
        try:
            os.remove(join(join(self.root, NEW_DIR), name))
        except OSError:
            pass
        self._files.append([name, sz, sha])
        self._declared += sz
        self._cur = 0
        return self._ack("file")

    def _data(self, msg):
        if not self.active or not self._files:
            return self._ack("data", "state")
        i, o = msg.get("i"), msg.get("o")
        last = len(self._files) - 1
        if i != last or not isinstance(o, int):
            return self._ack("data", "state")
        if o < self._cur:
            return self._ack("data")           # Duplikat: nur erneut bestaetigen
        if o > self._cur:
            return self._ack("data", "gap")
        try:
            chunk = binascii.a2b_base64(msg.get("d", ""))
        except Exception:
            return self._ack("data", "io")
        if not chunk:
            return self._ack("data", "io")
        name, sz, _ = self._files[last]
        if self._cur + len(chunk) > sz:
            return self._ack("data", "size")
        try:
            # Pro Stueck oeffnen/schliessen: kein offenes Handle zwischen
            # zwei Nachrichten, ein Reset verliert hoechstens dieses Stueck.
            with open(join(join(self.root, NEW_DIR), name), "ab") as f:
                f.write(chunk)
        except OSError:
            return self._ack("data", "io")
        self._cur += len(chunk)
        return self._ack("data")

    def _hash_ok(self, name, want):
        h = hashlib.sha256()
        try:
            with open(join(join(self.root, NEW_DIR), name), "rb") as f:
                while True:
                    block = f.read(512)
                    if not block:
                        break
                    h.update(block)
        except OSError:
            return False
        return binascii.hexlify(h.digest()).decode() == want.lower()

    def _end(self, msg):
        if not self.active or len(self._files) != self._n or not self._cur_done():
            return self._ack("end", "state")
        for idx, (name, _, sha) in enumerate(self._files):
            if not self._hash_ok(name, sha):
                rmtree(join(self.root, NEW_DIR))
                self._reset()
                self.active = False
                return self._ack("end", "hash", idx)
        try:
            with open(join(join(self.root, NEW_DIR), MANIFEST), "w") as f:
                json.dump({"id": self._rid, "lbl": self._lbl,
                           "files": [x[0] for x in self._files]}, f)
            write_state(self.root, "ready")
        except OSError:
            return self._ack("end", "io")
        self.active = False
        self.reboot_requested = True
        return self._ack("end")

    def _abort(self, msg):
        rmtree(join(self.root, NEW_DIR))
        self._reset()
        self.active = False
        return self._ack("abort")
