# Geht als main.py auf BEIDE ESPs (Kart-Sender und Bridge).
# Das eigentliche Programm ist vorkompiliert (app.mpy, siehe README):
# der On-Device-Compile der grossen sender.py/bridge.py wuerde dem
# WiFi-Treiber den RAM wegfressen ("WiFi Out of Memory" beim Boot).
#
# Phase 72: diese Datei ist zugleich der Bootlader fuer Updates aus der
# App. ota.py legt ein geprueftes Paket in ota_new/ und schreibt "ready";
# hier wird umgeschaltet (alte Dateien -> ota_old/) und die neue Version
# auf Probe gestartet ("trial"). Bestaetigt sie sich nicht (ota.confirm),
# kommt beim naechsten Boot automatisch die alte zurueck. Jeder Schritt
# ist wiederholbar -- ein Stromausfall mittendrin wird beim naechsten
# Boot zu Ende gefuehrt.
# Bewusst klein, ohne Import des Empfangsmoduls und nie selbst per Update
# ersetzt: der Bootlader muss auch laufen, wenn ein Update alles andere
# zerstoert hat.
import os
try:
    import json
except ImportError:
    import ujson as json

_STATE = "ota_state"
_MAN = "ota_manifest.json"
_NEW = "ota_new"
_OLD = "ota_old"


def _p(a, b):
    return a + "/" + b if a else b


def _exists(path):
    try:
        os.stat(path)
        return True
    except OSError:
        return False


def _get(root):
    try:
        with open(_p(root, _STATE)) as f:
            return f.read().strip()
    except OSError:
        return ""


def _set(root, word):
    if word:
        with open(_p(root, _STATE), "w") as f:
            f.write(word)
    elif _exists(_p(root, _STATE)):
        os.remove(_p(root, _STATE))


def _ls(path):
    try:
        return os.listdir(path)
    except OSError:
        return []


def _mv(src, dst):
    if _exists(dst):
        os.remove(dst)
    os.rename(src, dst)


def _rmdir(path):
    for n in _ls(path):
        os.remove(_p(path, n))
    if _exists(path):
        os.rmdir(path)


def _files(path):
    # Dateiliste eines Manifests; None, wenn es fehlt oder kaputt ist.
    try:
        with open(path) as f:
            return [str(n) for n in json.load(f)["files"]]
    except Exception:
        return None


def _sister(name):
    # x.py hat beim Import Vorrang vor x.mpy -> die Schwester muss mit weg.
    if name.endswith(".mpy"):
        return name[:-4] + ".py"
    if name.endswith(".py"):
        return name[:-3] + ".mpy"
    return None


def rollback(root=""):
    old = _p(root, _OLD)
    if _get(root) != "rollback2":
        # Phase 1: Dateien, die NUR die neue Version mitbrachte, loeschen.
        # Laeuft komplett vor dem ersten Zurueckspielen -- nur solange ist
        # die Liste in ota_old/ vollstaendig.
        _set(root, "rollback")
        keep = _ls(old)
        if keep:
            for name in (_files(_p(root, _MAN)) or []) + [_MAN]:
                if name not in keep and _exists(_p(root, name)):
                    os.remove(_p(root, name))
        _set(root, "rollback2")
    # Phase 2: alte Dateien zurueck (ueberschreibt die neuen).
    for name in _ls(old):
        _mv(_p(old, name), _p(root, name))
    _rmdir(old)
    _rmdir(_p(root, _NEW))
    _set(root, "rolledback")


def prepare(root=""):
    # Anstehendes Umschalten/Rueckfall ausfuehren. Gibt den Zustand zurueck,
    # mit dem das Programm startet: "", "trial" oder "rolledback".
    st = _get(root)
    new = _p(root, _NEW)
    old = _p(root, _OLD)
    if st == "ready":
        if _files(_p(new, _MAN)) is None:      # kaputt bereitgestellt: verwerfen
            _rmdir(new)
            _set(root, "")
            return ""
        _rmdir(old)                            # Reste eines frueheren Updates
        _set(root, "swap")
        st = "swap"
    if st == "swap":
        if not _exists(old):
            os.mkdir(old)
        for name in (_files(_p(new, _MAN)) or []) + [_MAN]:
            if not _exists(_p(new, name)):
                continue                       # schon getauscht
            for victim in (name, _sister(name)):
                if victim and _exists(_p(root, victim)) and not _exists(_p(old, victim)):
                    _mv(_p(root, victim), _p(old, victim))
            _mv(_p(new, name), _p(root, name))
        _rmdir(new)
        _set(root, "trial")
        return "trial"
    if st in ("trial", "rollback", "rollback2"):
        # "trial" beim Start heisst: der vorige Lauf hat sich nie bestaetigt.
        rollback(root)
        return "rolledback"
    return st


def boot(root="", importer=None, reset=None):
    try:
        prepare(root)
    except Exception as e:                     # Bootlader darf nie sterben
        print("[boot] OTA-Vorbereitung fehlgeschlagen:", e)
    try:
        if importer:
            importer()
        else:
            import app  # noqa: F401 -- Side-Effect-Import: startet das Programm
    except Exception:
        # Nur solange die Probe unbestaetigt ist, gibt es etwas zum Zurueckfallen.
        if _get(root) != "trial":
            raise
        rollback(root)
        if reset is None:
            from machine import reset
        reset()


boot()
