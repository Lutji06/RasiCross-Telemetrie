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


class WheelSpeedGearRatio(unittest.TestCase):
    def test_default_equals_three_arg(self):
        # Optional param omitted == explicit 1.0 == pre-change result.
        self.assertAlmostEqual(calc.wheel_speed_kmh(10, 1, 1.0),
                               calc.wheel_speed_kmh(10, 1, 1.0, 1.0),
                               places=6)
        self.assertAlmostEqual(calc.wheel_speed_kmh(10, 1, 1.0, 1.0),
                               36.0, places=6)

    def test_reduction_slows_wheel(self):
        # ratio 2.0 -> wheel turns half as fast -> half the speed.
        self.assertAlmostEqual(calc.wheel_speed_kmh(10, 1, 1.0, 2.0),
                               18.0, places=6)

    def test_known_and_fractional_ratio(self):
        # 63 Hz / ppr1 / 6.3 = 10 wheel rev/s * 1.0 m * 3.6 = 36.0
        self.assertAlmostEqual(calc.wheel_speed_kmh(63, 1, 1.0, 6.3),
                               36.0, places=6)
        self.assertAlmostEqual(calc.wheel_speed_kmh(10, 2, 1.2, 2.5),
                               (10 / 2) / 2.5 * 1.2 * 3.6, places=6)

    def test_guard_nonpositive_or_bad_acts_as_one(self):
        base = calc.wheel_speed_kmh(10, 1, 1.0)        # == 36.0
        for bad in (0, 0.0, -3, float('nan'), 'x', None):
            self.assertAlmostEqual(calc.wheel_speed_kmh(10, 1, 1.0, bad),
                                   base, places=6)


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


class RpmFromPeriodUs(unittest.TestCase):
    def test_normal(self):
        # 20 ms Flankenabstand bei 1 Puls/U -> 3000 U/min
        self.assertAlmostEqual(calc.rpm_from_period_us(20000, 1), 3000.0, places=6)
        # 2 Pulse/U halbieren die Drehzahl bei gleicher Periode
        self.assertAlmostEqual(calc.rpm_from_period_us(20000, 2), 1500.0, places=6)
        # Leerlauf: 33.333 ms -> 1800 U/min
        self.assertAlmostEqual(calc.rpm_from_period_us(100000.0 / 3.0, 1),
                               1800.0, places=3)

    def test_zero_for_bad(self):
        for bad in (0, -1, None, 'x', float('nan')):
            self.assertEqual(calc.rpm_from_period_us(bad, 1), 0.0)
            self.assertEqual(calc.rpm_from_period_us(20000, bad), 0.0)


class HallMinPeriodUs(unittest.TestCase):
    def test_normal(self):
        # 16000 U/min bei 1 Puls/U -> 3750 µs Mindestabstand
        self.assertEqual(calc.hall_min_period_us(16000, 1), 3750)
        self.assertEqual(calc.hall_min_period_us(16000, 2), 1875)

    def test_filter_off_for_bad(self):
        # Konfig-Fehler duerfen NIE echte Pulse verwerfen -> 0 = Filter aus.
        for bad in (0, -1, None, 'x', float('nan')):
            self.assertEqual(calc.hall_min_period_us(bad, 1), 0)
            self.assertEqual(calc.hall_min_period_us(16000, bad), 0)

    def test_roundtrip_with_rpm(self):
        # Eine Flanke genau an der Schwelle entspricht RPM_CEILING.
        p = calc.hall_min_period_us(16000, 1)
        self.assertAlmostEqual(calc.rpm_from_period_us(p, 1), 16000.0, places=0)


class RpmEmaStep(unittest.TestCase):
    def test_classic_ema(self):
        self.assertAlmostEqual(calc.rpm_ema_step(1000.0, 2000.0, 0.25),
                               1250.0, places=6)
        # Schnellpfad per Default (0/0) deaktiviert
        self.assertAlmostEqual(calc.rpm_ema_step(0.0, 6000.0, 0.25),
                               1500.0, places=6)

    def test_fast_path_on_big_jump(self):
        # |raw - smooth| >= fast_delta -> fast_alpha greift
        self.assertAlmostEqual(calc.rpm_ema_step(1000.0, 2000.0, 0.25, 0.6, 400.0),
                               1600.0, places=6)
        # kleiner Sprung -> klassisches alpha
        self.assertAlmostEqual(calc.rpm_ema_step(1000.0, 1300.0, 0.25, 0.6, 400.0),
                               1075.0, places=6)

    def test_fast_path_never_smooths_harder(self):
        # fast_alpha < alpha darf die Glaettung nicht verschaerfen
        self.assertAlmostEqual(calc.rpm_ema_step(0.0, 1000.0, 0.5, 0.1, 100.0),
                               500.0, places=6)

    def test_alpha_clamped(self):
        self.assertAlmostEqual(calc.rpm_ema_step(100.0, 200.0, 5.0), 200.0, places=6)
        self.assertAlmostEqual(calc.rpm_ema_step(100.0, 200.0, -1.0), 100.0, places=6)

    def test_junk_inputs(self):
        # ungueltiges raw -> letzter guter Wert bleibt stehen
        self.assertEqual(calc.rpm_ema_step(1234.0, None, 0.25), 1234.0)
        self.assertEqual(calc.rpm_ema_step(1234.0, float('nan'), 0.25), 1234.0)
        # ungueltiges smooth -> raw
        self.assertEqual(calc.rpm_ema_step(None, 500.0, 0.25), 500.0)
        # beides ungueltig -> 0.0
        self.assertEqual(calc.rpm_ema_step('x', None, 0.25), 0.0)
        # kaputtes alpha -> haelt den alten Wert (a=0)
        self.assertEqual(calc.rpm_ema_step(100.0, 200.0, 'x'), 100.0)


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


class Mpu9250TempC(unittest.TestCase):
    def test_known_points(self):
        # Phase 37: 9250-Kennlinie raw/333.87 + 21.0 (Datenblatt).
        self.assertAlmostEqual(calc.mpu9250_temp_c(0), 21.0, places=6)
        self.assertAlmostEqual(calc.mpu9250_temp_c(3339),
                               3339 / 333.87 + 21.0, places=6)
        self.assertAlmostEqual(calc.mpu9250_temp_c(-1000),
                               -1000 / 333.87 + 21.0, places=6)

    def test_differs_from_6050_formula(self):
        # Gleicher Rohwert -> andere Temperatur als die alte 6050-Formel.
        raw = 1000
        self.assertNotAlmostEqual(calc.mpu9250_temp_c(raw),
                                  raw / 340.0 + 36.53, places=2)

    def test_zero_for_bad(self):
        self.assertEqual(calc.mpu9250_temp_c(None), 0.0)
        self.assertEqual(calc.mpu9250_temp_c('x'), 0.0)
        self.assertEqual(calc.mpu9250_temp_c(float('nan')), 0.0)


class UbxFrame(unittest.TestCase):
    def test_cfg_rate_5hz(self):
        # CFG-RATE (0x06 0x08), 200 ms = 5 Hz. Bekannte Referenz-Bytes.
        frame = calc.ubx_frame(0x06, 0x08,
                               bytes((0xC8, 0x00, 0x01, 0x00, 0x01, 0x00)))
        self.assertEqual(frame, bytes.fromhex('b56206080600c80001000100de6a'))

    def test_cfg_msg_disable_gsv(self):
        # CFG-MSG (0x06 0x01): NMEA-Satz GSV (0xF0 0x03) Rate 0 -> aus.
        frame = calc.ubx_frame(0x06, 0x01, bytes((0xF0, 0x03, 0x00)))
        self.assertEqual(frame, bytes.fromhex('b56206010300f00300fd15'))

    def test_empty_payload_header_and_length(self):
        frame = calc.ubx_frame(0x06, 0x09)
        self.assertEqual(frame[:6], bytes((0xB5, 0x62, 0x06, 0x09, 0x00, 0x00)))
        self.assertEqual(len(frame), 8)   # 2 sync + 4 header + 0 payload + 2 ck


if __name__ == '__main__':
    unittest.main()
