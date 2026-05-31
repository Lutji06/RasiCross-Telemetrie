import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'esp_libs'))
import frame  # noqa: E402


def _base():
    # A fully-populated telemetry dict (battery active + IMU temp present).
    return {
        "speed": 42.37, "rpm": 5123, "gx": 0.123, "gy": -1.987,
        "gz": 0.97, "yaw": -142.3, "roll": 75.4, "lat": 49.6012345, "lon": 6.1198765,
        "gps_fix": 1, "gps_health": "ok", "pulse_hz": 318.4,
        "send_ms": 80, "spd_src": "gps", "imu_cal": 0,
        "batt_warn": 1, "vbat": 11.84, "soc": 73, "mtemp": 34,
    }


class FrameLayout(unittest.TestCase):
    def test_size_and_ver(self):
        self.assertEqual(frame.SIZE, 35)
        self.assertEqual(frame.FMT, "<BHHHhhhhhiiHHHBbBB")
        self.assertEqual(frame.FRAME_VER, 2)
        b = frame.pack(_base(), 7)
        self.assertIsInstance(b, (bytes, bytearray))
        self.assertEqual(len(b), 35)
        self.assertEqual(b[0], frame.FRAME_VER)


class RoundTrip(unittest.TestCase):
    def test_nominal(self):
        d = _base()
        out = frame.unpack(frame.pack(d, 12345))
        self.assertNotIn("_err", out)
        self.assertEqual(out["seq"], 12345)
        self.assertAlmostEqual(out["speed"], 42.37, places=2)
        self.assertEqual(out["rpm"], 5123)
        self.assertAlmostEqual(out["gx"], 0.123, places=3)
        self.assertAlmostEqual(out["gy"], -1.987, places=3)
        self.assertAlmostEqual(out["gz"], 0.97, places=2)
        self.assertAlmostEqual(out["yaw"], -142.3, places=1)
        self.assertAlmostEqual(out["roll"], 75.4, places=1)
        self.assertAlmostEqual(out["lat"], 49.6012345, places=6)
        self.assertAlmostEqual(out["lon"], 6.1198765, places=6)
        self.assertEqual(out["gps_fix"], 1)
        self.assertEqual(out["gps_health"], "ok")
        self.assertAlmostEqual(out["pulse_hz"], 318.4, places=1)
        self.assertEqual(out["send_ms"], 80)
        self.assertEqual(out["spd_src"], "gps")
        self.assertEqual(out["imu_cal"], 0)
        self.assertEqual(out["batt_warn"], 1)
        self.assertAlmostEqual(out["vbat"], 11.84, places=2)
        self.assertEqual(out["soc"], 73)
        self.assertEqual(out["mtemp"], 34)

    def test_negative_and_zero(self):
        d = _base()
        d.update(speed=0.0, rpm=0, gx=-0.001, yaw=0.0, lat=-0.0000001,
                 lon=-179.9999999, imu_cal=1, gps_fix=0)
        out = frame.unpack(frame.pack(d, 0))
        self.assertEqual(out["seq"], 0)
        self.assertEqual(out["speed"], 0.0)
        self.assertEqual(out["rpm"], 0)
        self.assertEqual(out["gps_fix"], 0)
        self.assertEqual(out["imu_cal"], 1)
        self.assertAlmostEqual(out["lon"], -179.9999999, places=6)


class Saturation(unittest.TestCase):
    def test_overflow_clamps_not_raises(self):
        d = _base()
        d.update(speed=99999.0, rpm=999999, gx=1000.0, yaw=99999.0,
                 pulse_hz=999999.0, vbat=9999.0, soc=250, mtemp=900)
        out = frame.unpack(frame.pack(d, 0))
        self.assertNotIn("_err", out)
        self.assertAlmostEqual(out["speed"], 655.35, places=2)   # u16/100
        self.assertEqual(out["rpm"], 65535)
        self.assertAlmostEqual(out["gx"], 32.767, places=3)      # i16/1000
        self.assertAlmostEqual(out["yaw"], 3276.7, places=1)
        self.assertAlmostEqual(out["vbat"], 655.35, places=2)
        self.assertEqual(out["soc"], 100)
        self.assertEqual(out["mtemp"], 127)

    def test_negative_underflow_clamps(self):
        d = _base()
        d.update(gx=-1000.0, yaw=-99999.0, mtemp=-900, speed=-5.0)
        out = frame.unpack(frame.pack(d, 0))
        self.assertAlmostEqual(out["gx"], -32.768, places=3)
        self.assertAlmostEqual(out["yaw"], -3276.8, places=1)
        self.assertEqual(out["mtemp"], -128)
        self.assertEqual(out["speed"], 0.0)                      # u16 floor


class Enums(unittest.TestCase):
    def test_gps_health_roundtrip(self):
        for name in ("ok", "searching", "lost", "disabled"):
            d = _base(); d["gps_health"] = name
            self.assertEqual(frame.unpack(frame.pack(d, 0))["gps_health"], name)

    def test_spd_src_roundtrip(self):
        for name in ("gps", "wheel", "none"):
            d = _base(); d["spd_src"] = name
            self.assertEqual(frame.unpack(frame.pack(d, 0))["spd_src"], name)

    def test_unknown_enum_falls_back(self):
        d = _base(); d["gps_health"] = "bogus"; d["spd_src"] = "???"
        out = frame.unpack(frame.pack(d, 0))
        self.assertEqual(out["gps_health"], "disabled")  # idx 3 fallback
        self.assertEqual(out["spd_src"], "none")          # idx 2 fallback


class FlagGating(unittest.TestCase):
    def test_battery_absent_omits_keys(self):
        d = _base()
        for k in ("batt_warn", "vbat", "soc"):
            d.pop(k)
        out = frame.unpack(frame.pack(d, 0))
        self.assertNotIn("vbat", out)
        self.assertNotIn("soc", out)
        self.assertNotIn("batt_warn", out)

    def test_mtemp_absent_omits_key(self):
        d = _base(); d.pop("mtemp")
        out = frame.unpack(frame.pack(d, 0))
        self.assertNotIn("mtemp", out)
        self.assertIn("vbat", out)  # battery still present


class Errors(unittest.TestCase):
    def test_bad_length(self):
        self.assertEqual(frame.unpack(b"")["_err"], "bad_len")
        self.assertEqual(frame.unpack(b"\x01" * 10)["_err"], "bad_len")
        self.assertEqual(frame.unpack(b"\x01" * 34)["_err"], "bad_len")
        self.assertEqual(frame.unpack(None)["_err"], "bad_len")

    def test_bad_version(self):
        good = bytearray(frame.pack(_base(), 1))
        good[0] = 0x99
        out = frame.unpack(bytes(good))
        self.assertEqual(out["_err"], "bad_ver")
        self.assertEqual(out["ver"], 0x99)

    def test_seq_wraps(self):
        out = frame.unpack(frame.pack(_base(), 70000))
        self.assertEqual(out["seq"], 70000 & 0xFFFF)


class RollField(unittest.TestCase):
    def test_roll_roundtrip_value_and_sign(self):
        d = _base(); d["roll"] = 75.4
        self.assertAlmostEqual(frame.unpack(frame.pack(d, 0))["roll"], 75.4, places=1)
        d["roll"] = -75.4
        self.assertAlmostEqual(frame.unpack(frame.pack(d, 0))["roll"], -75.4, places=1)

    def test_roll_absent_defaults_zero(self):
        d = _base(); d.pop("roll")
        self.assertEqual(frame.unpack(frame.pack(d, 0))["roll"], 0.0)

    def test_roll_saturates(self):
        d = _base(); d["roll"] = 99999.0
        self.assertAlmostEqual(frame.unpack(frame.pack(d, 0))["roll"], 3276.7, places=1)
        d["roll"] = -99999.0
        self.assertAlmostEqual(frame.unpack(frame.pack(d, 0))["roll"], -3276.8, places=1)

    def test_v1_frame_rejected_by_length(self):
        # 33-byte frame (old v1 SIZE) is rejected on length before the version check.
        self.assertEqual(frame.unpack(b"\x02" * 33)["_err"], "bad_len")


if __name__ == '__main__':
    unittest.main()
