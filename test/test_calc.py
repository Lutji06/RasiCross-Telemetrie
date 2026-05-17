import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'esp_libs'))
import calc  # noqa: E402


class WheelSpeedKmh(unittest.TestCase):
    def test_zero_for_nonpositive(self):
        self.assertEqual(calc.wheel_speed_kmh(0, 1, 1.0), 0.0)
        self.assertEqual(calc.wheel_speed_kmh(10, 0, 1.0), 0.0)
        self.assertEqual(calc.wheel_speed_kmh(10, 1, 0.0), 0.0)
        self.assertEqual(calc.wheel_speed_kmh(-5, 1, 1.0), 0.0)
        self.assertEqual(calc.wheel_speed_kmh(10, -1, 1.0), 0.0)
        self.assertEqual(calc.wheel_speed_kmh(10, 1, -1.0), 0.0)
        self.assertEqual(calc.wheel_speed_kmh(float('nan'), 1, 1.0), 0.0)

    def test_zero_for_bad_types(self):
        self.assertEqual(calc.wheel_speed_kmh(None, 1, 1.0), 0.0)
        self.assertEqual(calc.wheel_speed_kmh('x', 1, 1.0), 0.0)
        self.assertEqual(calc.wheel_speed_kmh(10, None, 1.0), 0.0)
        self.assertEqual(calc.wheel_speed_kmh(10, 1, 'abc'), 0.0)

    def test_normal(self):
        self.assertAlmostEqual(calc.wheel_speed_kmh(10, 1, 1.0), 36.0, places=6)
        self.assertAlmostEqual(calc.wheel_speed_kmh(10, 2, 1.0), 18.0, places=6)
        self.assertAlmostEqual(calc.wheel_speed_kmh(71.3, 1, 1.2),
                               71.3 * 1.2 * 3.6, places=6)


class SpeedSource(unittest.TestCase):
    def test_gps_wins(self):
        self.assertEqual(calc.speed_source(True, 0.0), 'gps')
        self.assertEqual(calc.speed_source(1, 1.2), 'gps')

    def test_wheel_when_configured_and_no_fix(self):
        self.assertEqual(calc.speed_source(False, 1.2), 'wheel')
        self.assertEqual(calc.speed_source(0, 0.001), 'wheel')

    def test_none_when_no_fix_and_no_circ(self):
        self.assertEqual(calc.speed_source(False, 0.0), 'none')
        self.assertEqual(calc.speed_source(0, 0), 'none')
        self.assertEqual(calc.speed_source(False, None), 'none')


if __name__ == '__main__':
    unittest.main()
