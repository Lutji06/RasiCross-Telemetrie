# ============================================================
#  RasiCross -- mpstub.py  (MicroPython-Stubs fuer CPython-Tests)
# ============================================================
#  Warum: sender.py und bridge.py laufen sonst nur auf echter Hardware
#  und sind damit ungeprueft -- genau dort sitzen aber die teuren Fehler
#  (Watchdog-Bootloop mitten im Rennen). Mit diesen Stubs laeuft die
#  ganze Kette Sensor -> frame.pack -> ESP-NOW -> bridge -> JSON-Zeile
#  unter CPython, in Sekunden statt am Kart.
#
#  Bewusst minimal: nur so viel Verhalten, wie die beiden Programme
#  anfassen. espnow.add_peer wirft bei bekanntem Peer wie das Original --
#  ein zu gutmuetiger Stub wuerde Peer-Verwaltungsfehler verdecken.
#
#  Nutzung siehe test/test_firmware.py.
# ============================================================
import sys, types, time, json, binascii

_t0 = time.monotonic()

# ---- utime ----
utime = types.ModuleType("utime")
utime.ticks_ms = lambda: int((time.monotonic() - _t0) * 1000)
utime.ticks_us = lambda: int((time.monotonic() - _t0) * 1000000)
utime.ticks_diff = lambda a, b: a - b
utime.ticks_add = lambda t, d: t + d
utime.sleep_ms = lambda ms: None
utime.sleep = lambda s: None

# ---- ujson / ubinascii ----
ujson = types.ModuleType("ujson")
ujson.dumps = lambda o: json.dumps(o, separators=(',', ':'))
ujson.loads = json.loads
ubinascii = types.ModuleType("ubinascii")
ubinascii.hexlify = binascii.hexlify
ubinascii.unhexlify = binascii.unhexlify

# ---- machine ----
machine = types.ModuleType("machine")
class Pin:
    IN = 0; OUT = 1; PULL_UP = 2; IRQ_FALLING = 4
    def __init__(self, nr, mode=None, pull=None): self.nr = nr; self._v = 0; self._irq = None
    def irq(self, trigger=None, handler=None): self._irq = handler
    def value(self, v=None):
        if v is None: return self._v
        self._v = v
class I2C:
    def __init__(self, *a, **k): pass
    def readfrom_mem(self, *a, **k): return b"\0" * 14
    def writeto_mem(self, *a, **k): pass
    def scan(self): return [0x68]
class WDT:
    def __init__(self, timeout=0): self.timeout = timeout; self.feeds = 0
    def feed(self): self.feeds += 1
class ADC:
    ATTN_11DB = 3
    def __init__(self, pin): pass
    def atten(self, a): pass
    def read_uv(self): return 1_650_000
class UART:
    def __init__(self, *a, **k): self._buf = b""
    def init(self, *a, **k): pass
    def any(self): return len(self._buf)
    def read(self, n=None):
        b, self._buf = self._buf, b""
        return b or None
    def write(self, d): return len(d)
    def feed(self, data): self._buf += data
machine.UART = UART
machine.Pin = Pin; machine.I2C = I2C; machine.WDT = WDT; machine.ADC = ADC
machine.reset = lambda: (_ for _ in ()).throw(SystemExit("machine.reset()"))
machine.disable_irq = lambda: 0
machine.enable_irq = lambda s: None

# ---- network ----
network = types.ModuleType("network")
network.STA_IF = 1
class WLAN:
    PM_NONE = 0
    def __init__(self, iface): self._cfg = {"mac": b"\xaa\xbb\xcc\x00\x00\x01"}
    def active(self, v=None): return True
    def disconnect(self): pass
    def config(self, *a, **k):
        if a: return self._cfg.get(a[0])
        self._cfg.update(k); return None
network.WLAN = WLAN

# ---- espnow ----
espnow = types.ModuleType("espnow")
class ESPNow:
    def __init__(self):
        self.peers = set(); self.sent = []; self.inbox = []
        self.peers_table = {}; self.fail_next = 0
    def active(self, v=None): return True
    def config(self, **k): pass
    def add_peer(self, mac):
        if mac in self.peers: raise OSError("ESP_ERR_ESPNOW_EXIST")
        self.peers.add(mac)
    def del_peer(self, mac): self.peers.discard(mac)
    def send(self, mac, msg, sync=True):
        if mac not in self.peers: raise OSError("ESP_ERR_ESPNOW_NOT_FOUND")
        self.sent.append((mac, msg))
        if self.fail_next > 0: self.fail_next -= 1; return False
        return True
    def recv(self, timeout=None):
        if self.inbox: return self.inbox.pop(0)
        return (None, None)
espnow.ESPNow = ESPNow

# ---- esp32 (NVS) ----
esp32 = types.ModuleType("esp32")
class NVS:
    _store = {}
    def __init__(self, ns): self.ns = ns
    def get_blob(self, key, buf):
        v = self._store.get((self.ns, key))
        if v is None: raise OSError("ESP_ERR_NVS_NOT_FOUND")
        n = min(len(v), len(buf)); buf[:n] = v[:n]; return len(v)
    def set_blob(self, key, val): self._store[(self.ns, key)] = bytes(val)
    def commit(self): pass
esp32.NVS = NVS

# ---- ustruct / gc ----
import struct as _s, gc as _gc
ustruct = types.ModuleType("ustruct")
for _n in dir(_s):
    if not _n.startswith('_'): setattr(ustruct, _n, getattr(_s, _n))
if not hasattr(_gc, 'mem_free'):
    _gc.mem_free = lambda: 123456
    _gc.mem_alloc = lambda: 65536


def install():
    for name, mod in (("utime", utime), ("ujson", ujson), ("ubinascii", ubinascii),
                      ("machine", machine), ("network", network),
                      ("espnow", espnow), ("esp32", esp32), ("ustruct", ustruct)):
        sys.modules[name] = mod
    return dict(utime=utime, espnow=espnow, esp32=esp32, machine=machine)
