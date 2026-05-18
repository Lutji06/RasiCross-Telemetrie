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


class BatteryPackV(unittest.TestCase):
    def test_normal(self):
        self.assertAlmostEqual(calc.battery_pack_v(1.0, 11.0, 1.0), 11.0, places=6)
        self.assertAlmostEqual(calc.battery_pack_v(0.30, 11.0, 1.05),
                               0.30 * 11.0 * 1.05, places=6)

    def test_zero_input_is_zero(self):
        self.assertEqual(calc.battery_pack_v(0.0, 11.0, 1.0), 0.0)

    def test_zero_for_bad_or_negative(self):
        self.assertEqual(calc.battery_pack_v(-1.0, 11.0, 1.0), 0.0)
        self.assertEqual(calc.battery_pack_v(1.0, 0.0, 1.0), 0.0)
        self.assertEqual(calc.battery_pack_v(1.0, 11.0, 0.0), 0.0)
        self.assertEqual(calc.battery_pack_v(None, 11.0, 1.0), 0.0)
        self.assertEqual(calc.battery_pack_v('x', 11.0, 1.0), 0.0)
        self.assertEqual(calc.battery_pack_v(float('nan'), 11.0, 1.0), 0.0)


class BatteryCellV(unittest.TestCase):
    def test_normal(self):
        self.assertAlmostEqual(calc.battery_cell_v(12.6, 3), 4.2, places=6)
        self.assertAlmostEqual(calc.battery_cell_v(11.1, 3), 3.7, places=6)

    def test_zero_for_bad(self):
        self.assertEqual(calc.battery_cell_v(12.0, 0), 0.0)
        self.assertEqual(calc.battery_cell_v(12.0, -1), 0.0)
        self.assertEqual(calc.battery_cell_v(None, 3), 0.0)
        self.assertEqual(calc.battery_cell_v(12.0, None), 0.0)
        self.assertEqual(calc.battery_cell_v(float('nan'), 3), 0.0)


class BatterySoc(unittest.TestCase):
    def test_curve_points(self):
        self.assertEqual(calc.battery_soc(4.20), 100)
        self.assertEqual(calc.battery_soc(3.85), 60)
        self.assertEqual(calc.battery_soc(3.70), 35)
        self.assertEqual(calc.battery_soc(3.50), 15)
        self.assertEqual(calc.battery_soc(3.30), 0)

    def test_clamped(self):
        self.assertEqual(calc.battery_soc(4.30), 100)
        self.assertEqual(calc.battery_soc(5.00), 100)
        self.assertEqual(calc.battery_soc(3.20), 0)
        self.assertEqual(calc.battery_soc(0.0), 0)

    def test_linear_interpolation(self):
        # midpoint of 3.85->60 .. 4.20->100  => 80
        self.assertEqual(calc.battery_soc(4.025), 80)
        # midpoint of 3.50->15 .. 3.70->35   => 25
        self.assertEqual(calc.battery_soc(3.60), 25)

    def test_zero_for_bad(self):
        self.assertEqual(calc.battery_soc(None), 0)
        self.assertEqual(calc.battery_soc('x'), 0)
        self.assertEqual(calc.battery_soc(float('nan')), 0)


class BatteryWarn(unittest.TestCase):
    def test_levels(self):
        self.assertEqual(calc.battery_warn(3.80, 3.5, 3.3), 0)
        self.assertEqual(calc.battery_warn(3.50, 3.5, 3.3), 1)  # <= warn
        self.assertEqual(calc.battery_warn(3.40, 3.5, 3.3), 1)
        self.assertEqual(calc.battery_warn(3.30, 3.5, 3.3), 2)  # <= crit
        self.assertEqual(calc.battery_warn(3.10, 3.5, 3.3), 2)

    def test_zero_for_bad(self):
        self.assertEqual(calc.battery_warn(None, 3.5, 3.3), 0)
        self.assertEqual(calc.battery_warn('x', 3.5, 3.3), 0)
        self.assertEqual(calc.battery_warn(float('nan'), 3.5, 3.3), 0)


if __name__ == '__main__':
    unittest.main()
