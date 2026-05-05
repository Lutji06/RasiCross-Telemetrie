# Verkabelung & Pinbelegung

Detaillierte Aufbau-Anleitung fuer Sender (Kart-Seite) und Bridge (Boxen-Seite).

## Sender (Kart-ESP32)

```
                        ┌────────────────────────┐
                        │     ESP32 DevKit       │
                        │                        │
                        │ 3V3 ─────────────────┐ │
   ┌────────────┐       │                      ├─┼──── 3V3 (rot)
   │  Hall A3144│──D────┤ GPIO 34              │ │
   │  (RPM)     │──VCC──┘  (Pull-Up intern)    │ │
   │            │──GND──┐                      │ │
   └────────────┘       │                      │ │
                        │                      │ │
   ┌────────────┐       │                      │ │
   │ MPU-6050   │──SDA──┤ GPIO 21 (I²C SDA)    │ │
   │ (IMU)      │──SCL──┤ GPIO 22 (I²C SCL)    │ │
   │            │──VCC──┤                      │ │
   │            │──GND──┤                      │ │
   └────────────┘       │                      │ │
                        │                      │ │
   ┌────────────┐       │                      │ │
   │SSD1306 OLED│──SDA──┤ (gleicher I²C-Bus)   │ │
   │ 128 × 64   │──SCL──┤                      │ │
   │            │──VCC──┤                      │ │
   │            │──GND──┤                      │ │
   └────────────┘       │                      │ │
                        │                      │ │
   ┌────────────┐       │                      │ │
   │ GPS NEO-6M │──TX───┤ GPIO 16 (UART2 RX)   │ │
   │            │──RX───┤ GPIO 17 (UART2 TX)   │ │
   │            │──VCC──┤                      │ │
   │            │──GND──┤                      │ │
   └────────────┘       │                      │ │
                        │ GND ─────────────────┴─┼──── GND (schwarz)
                        │                        │
                        │ GPIO 2 ── Onboard-LED  │
                        └────────────────────────┘
```

### Pin-Tabelle Sender

| Funktion          | ESP32-Pin | Sensor-Pin     | Bemerkung                          |
| ----------------- | --------- | -------------- | ---------------------------------- |
| Hall-Sensor       | GPIO 34   | OUT (Signal)   | Input-only, Pull-Up intern, IRQ    |
| Hall-Sensor VCC   | 3V3       | VCC            | A3144 vertraegt 3,3 V (auch 5 V)   |
| Hall-Sensor GND   | GND       | GND            |                                    |
| I²C SDA           | GPIO 21   | SDA            | gemeinsam IMU + OLED               |
| I²C SCL           | GPIO 22   | SCL            | gemeinsam IMU + OLED               |
| I²C-Geraete VCC   | 3V3       | VCC            |                                    |
| I²C-Geraete GND   | GND       | GND            |                                    |
| GPS UART2 RX      | GPIO 16   | TX am GPS      | gekreuzt!                          |
| GPS UART2 TX      | GPIO 17   | RX am GPS      | gekreuzt!                          |
| GPS VCC           | 3V3       | VCC            | NEO-6M auch 5 V-tolerant           |
| GPS GND           | GND       | GND            |                                    |
| Status-LED        | GPIO 2    | (onboard)      | aus / blink / an                   |

## Bridge (Boxen-ESP32)

```
                        ┌────────────────────────┐
                        │     ESP32 DevKit       │
                        │                        │
                        │ USB ── PC (Dashboard)  │
                        │                        │
                        │ 3V3 ─────────────────┐ │
                        │                      │ │
   ┌────────────┐       │                      │ │
   │SSD1306 OLED│──SDA──┤ GPIO 21              │ │
   │ 128 × 64   │──SCL──┤ GPIO 22              │ │
   │            │──VCC──┤                      │ │
   │            │──GND──┤                      │ │
   └────────────┘       │                      │ │
                        │                      │ │
                        │ GPIO 2 ── Onboard-LED│ │
                        │                      │ │
                        │ GND ─────────────────┘ │
                        └────────────────────────┘
```

Die Bridge hat keine Sensoren — sie braucht nur das OLED zur Anzeige
und die USB-Verbindung zum PC.

## Stromversorgung

### Sender (Kart)

- **Empfohlen:** Pufferakku (z.B. 7.4 V LiPo) → 5 V Step-Down → ESP32-VIN
- **Minimum:** 5 V/1 A USB-Powerbank, am ESP32-USB-Port
- **Wichtig:** GPS und IMU ziehen Spitzen, eine glatte Versorgung
  vermeidet Reset-Schleifen. Ein 470 µF-Elko nahe am ESP32 hilft.

### Bridge (Pit)

- **Standard:** USB-Stromversorgung vom PC (5 V, ca. 200 mA Last)
- Alternativ Powerbank oder 5 V-Netzteil

## Antenne

ESP-NOW im Long-Range-Modus reicht typischerweise 100–300 m mit
Onboard-Antenne. Fuer mehr Reichweite:

- ESP32-Devboards mit **U.FL/IPEX-Antennenanschluss** kaufen (statt nur PCB-Antenne)
- 2,4 GHz-Aussenantenne (5–9 dBi) mit RP-SMA → IPEX-Adapter
- Kart-Antenne aufrecht montieren, mindestens 5 cm von Metallflaechen entfernt
- Bridge-Antenne ggf. erhoeht aufstellen (Pylon, Mast in der Box)

## Pruef-Checklist nach dem Aufbau

1. **Vor dem ersten Strom-Anlegen:** Mit Multimeter alle GND/VCC-Verbindungen
   durchklingeln. Niemals 5 V auf einen 3,3 V-only-Pin (z.B. RX/TX) legen.
2. **OLED-Diagnose** laufen lassen: `esp_libs/oled_diagnose.py` in Thonny ausfuehren —
   sagt sofort, ob I²C, OLED und IMU antworten.
3. **Hall-Sensor pruefen:** Magnet vor den Sensor halten; auf der Sender-OLED
   sollte die RPM-Page reagieren (klein > 0).
4. **GPS-Fix:** Beim ersten Start kann der Cold-Fix bis 90 s dauern, ideal
   draussen mit freiem Himmel. Status-LED blinkt waehrend GPS sucht.
