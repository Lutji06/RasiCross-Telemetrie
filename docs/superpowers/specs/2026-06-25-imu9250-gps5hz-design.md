# Phase 37 — MPU-9250 + NEO-M8N (5 Hz) Hardware-Anpassung — Design

## 1. Kontext

Hardware-Umbau an den Karts: der IMU wurde von **MPU-6050** auf **MPU-9250**
getauscht, das GPS von einem älteren Modul auf **u-blox NEO-M8N**. Alle Karts
sind auf den 9250 umgebaut (keine gemischte Flotte). Einbaulage des IMU
unverändert (gleiche Achs-Ausrichtung). Diese Phase zieht die Firmware nach.

## 2. Befund (was sich tatsächlich ändert)

- **MPU-9250 Accel/Gyro:** register- und skalierungs-kompatibel zum 6050
  (Reg 0x3B/0x43, ±2 g = 16384 LSB/g, ±250 °/s = 131 LSB/°/s) → `gx/gy/gz/yaw/
  roll` bleiben korrekt, **keine Änderung**. WHO_AM_I (0x71) wird vom Treiber
  bereits akzeptiert.
- **MPU-9250 Temperatur:** einzige echte Abweichung. Kennlinie ist
  `raw/333.87 + 21.0` statt der 6050-Formel `raw/340 + 36.53`. Sonst liest
  `mtemp` (Diag-Seite + Dashboard) zu hoch.
- **NEO-M8N NMEA:** der Parser verarbeitet bereits die Multi-GNSS-Talker-ID
  `GN` (`GNRMC`/`GNGGA`) → lat/lon/speed/fix **unverändert**, keine Pflicht-
  änderung. Default-Rate ist aber 1 Hz.
- **Chance — 5 Hz:** der M8N kann 5 Hz. Da die Telemetrie mit 12,5 Hz sendet,
  die Position aber nur 1×/s frisch ist, profitiert vor allem der Phase-36-
  Streckenabstand-Gap und die Karten-Marker. 5 Hz passt in 9600 Baud, wenn nur
  RMC + GGA gesendet werden (≈800 von ~960 nutzbaren B/s) → keine Baud-Umstellung
  (die wäre beim Boot fragil).

## 3. Lösung

- `calc.mpu9250_temp_c(raw)` — reine, getestete 9250-Temperatur-Kennlinie.
- `calc.ubx_frame(msg_class, msg_id, payload)` — baut UBX-Pakete inkl.
  8-bit-Fletcher-Checksumme; reine Byte-Logik, testbar.
- IMU-Treiber (`mpu6050.py`) nutzt `calc.mpu9250_temp_c` (Inline-Fallback
  identisch); Modul-/Klassenname bleiben (Accel/Gyro register-kompatibel →
  Import + Flash-Prozedur unangetastet).
- `sender.py` GPS-Klasse: beim Init UBX senden — GLL/GSA/GSV/VTG aus, RMC+GGA
  an, CFG-RATE 200 ms (5 Hz). Idempotent je Boot, kein Flash-Save nötig.

## 4. Randfälle

- **Ohne calc.py auf dem ESP:** Treiber-Temp fällt auf identische Inline-Formel
  zurück; GPS-Konfig wird übersprungen → Modul bleibt auf 1 Hz, lat/lon laufen
  weiter. Kein Crash.
- **Modul ignoriert UBX / anderes GPS:** `_configure_m8n` ist fire-and-forget in
  try/except → kein Boot-Block.
- **Magnetometer (AK8963):** ungenutzt; möglicher späterer Kompass-Heading,
  hier bewusst zurückgestellt.

## 5. Verifikation

- Pure Logik per `unittest` TDD'd (Temp-Stützpunkte; UBX-Checksumme gegen
  Referenz-Bytes CFG-RATE/CFG-MSG). ESP-IO (Accel/Gyro/GPS-Fix/5 Hz) bleibt
  Hardware-Test am Kart (`py_compile` + Flash + Diag/Dashboard-Smoke).

## 6. Nicht berührt

JS/Dashboard (liest `mtemp`/`lat`/`lon` unverändert), Phase-36-Code,
ESP-NOW-Budget (keine neuen Telemetriefelder), `bridge.py`.
