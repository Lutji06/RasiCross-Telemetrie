# ============================================================
#  RasiCross  --  frame.py  (pure binary telemetry codec)
# ============================================================
#  Keine Importe ausser struct -> laeuft identisch unter CPython
#  (Unit-Tests / CI) und MicroPython (Kart-ESP packt, Bridge-ESP
#  entpackt). Auf BEIDE ESPs flashen:
#    mpremote connect <port> cp esp_libs/frame.py :
#  33-Byte Little-Endian Frame, siehe Spec 2026-05-19 D1 4.2.
# ============================================================
import struct

FRAME_VER = 1
FMT = "<BHHHhhhhiiHHHBbBB"
SIZE = struct.calcsize(FMT)            # 33

_GPS_HEALTH = ("ok", "searching", "lost", "disabled")
_SPD_SRC = ("gps", "wheel", "none")


def _clamp(v, lo, hi):
    if v < lo:
        return lo
    if v > hi:
        return hi
    return v


def _i(x):
    # robustes int(round()) ohne Exceptions (NaN/None -> 0)
    try:
        x = float(x)
    except (TypeError, ValueError):
        return 0
    if not (x == x):                   # NaN
        return 0
    return int(round(x))


def _f(x):
    try:
        x = float(x)
    except (TypeError, ValueError):
        return 0.0
    if not (x == x):                   # NaN
        return 0.0
    return x


def pack(d, seq):
    """Telemetrie-dict + seq -> 33 Byte. Saettigt, wirft nie."""
    d = d or {}
    speed = _clamp(_i(_f(d.get("speed")) * 100.0), 0, 65535)
    rpm = _clamp(_i(d.get("rpm")), 0, 65535)
    gx = _clamp(_i(_f(d.get("gx")) * 1000.0), -32768, 32767)
    gy = _clamp(_i(_f(d.get("gy")) * 1000.0), -32768, 32767)
    gz = _clamp(_i(_f(d.get("gz")) * 1000.0), -32768, 32767)
    yaw = _clamp(_i(_f(d.get("yaw")) * 10.0), -32768, 32767)
    lat = _clamp(_i(_f(d.get("lat")) * 1e7), -2147483648, 2147483647)
    lon = _clamp(_i(_f(d.get("lon")) * 1e7), -2147483648, 2147483647)
    pulse = _clamp(_i(_f(d.get("pulse_hz")) * 10.0), 0, 65535)
    send_ms = _clamp(_i(d.get("send_ms")), 0, 65535)
    vbat = _clamp(_i(_f(d.get("vbat")) * 100.0), 0, 65535)
    soc = _clamp(_i(d.get("soc")), 0, 100)
    mtemp = _clamp(_i(d.get("mtemp")), -128, 127)

    try:
        gh = _GPS_HEALTH.index(d.get("gps_health"))
    except ValueError:
        gh = 3
    try:
        ss = _SPD_SRC.index(d.get("spd_src"))
    except ValueError:
        ss = 2
    bw = _clamp(_i(d.get("batt_warn")), 0, 3)
    flags1 = ((1 if d.get("gps_fix") else 0)
              | (gh << 1)
              | (ss << 3)
              | ((1 if d.get("imu_cal") else 0) << 5)
              | (bw << 6))
    batt_present = 1 if ("vbat" in d or "soc" in d or "batt_warn" in d) else 0
    mtemp_valid = 1 if ("mtemp" in d and d.get("mtemp") is not None) else 0
    flags2 = batt_present | (mtemp_valid << 1)

    return struct.pack(FMT, FRAME_VER, seq & 0xFFFF, speed, rpm,
                       gx, gy, gz, yaw, lat, lon, pulse, send_ms,
                       vbat, soc, mtemp, flags1, flags2)


def unpack(buf):
    """33 Byte -> Telemetrie-dict (Dashboard-kompatible Keys).
    Wirft nie; bei Fehler {'_err': 'bad_len'|'bad_ver', ...}."""
    try:
        n = len(buf)
    except TypeError:
        return {"_err": "bad_len"}
    if n != SIZE:
        return {"_err": "bad_len", "len": n}
    if buf[0] != FRAME_VER:
        return {"_err": "bad_ver", "ver": buf[0]}
    (_ver, seq, speed, rpm, gx, gy, gz, yaw, lat, lon, pulse,
     send_ms, vbat, soc, mtemp, flags1, flags2) = struct.unpack(FMT, buf)
    out = {
        "seq": seq,
        "speed": speed / 100.0,
        "rpm": rpm,
        "gx": gx / 1000.0,
        "gy": gy / 1000.0,
        "gz": gz / 1000.0,
        "yaw": yaw / 10.0,
        "lat": lat / 1e7,
        "lon": lon / 1e7,
        "gps_fix": flags1 & 1,
        "gps_health": _GPS_HEALTH[(flags1 >> 1) & 3],
        "pulse_hz": pulse / 10.0,
        "send_ms": send_ms,
        "spd_src": _SPD_SRC[min((flags1 >> 3) & 3, 2)],
        "imu_cal": (flags1 >> 5) & 1,
    }
    if flags2 & 1:                     # batt_present
        out["batt_warn"] = (flags1 >> 6) & 3
        out["vbat"] = vbat / 100.0
        out["soc"] = soc
    if flags2 & 2:                     # mtemp_valid
        out["mtemp"] = mtemp
    return out
