# Verkabelung & Pinbelegung

Detaillierte Aufbau-Anleitung fuer Sender (Kart-Seite) und Bridge (Boxen-Seite).

## Sender (Kart-ESP32)

### Pin-Tabelle

| Funktion          | ESP32-Pin | Sensor-Pin   | Bemerkung                              |
| ----------------- | --------- | ------------ | -------------------------------------- |
| Hall-Sensor Signal| GPIO 4    | OUT (Signal) | Internal Pull-Up aktiv, Falling-IRQ    |
| Hall-Sensor VCC   | 3V3       | VCC          | A3144 vertraegt 3,3 V (auch 5 V)       |
| Hall-Sensor GND   | GND       | GND          |                                        |
| I²C SDA           | GPIO 21   | SDA          | gemeinsam IMU + OLED                   |
| I²C SCL           | GPIO 22   | SCL          | gemeinsam IMU + OLED                   |
| I²C-Geraete VCC   | 3V3       | VCC          |                                        |
| I²C-Geraete GND   | GND       | GND          |                                        |
| GPS UART2 RX      | GPIO 16   | TX am GPS    | gekreuzt anschliessen!                 |
| GPS UART2 TX      | GPIO 17   | RX am GPS    | gekreuzt anschliessen!                 |
| GPS VCC           | 3V3       | VCC          | NEO-6M auch 5 V-tolerant               |
| GPS GND           | GND       | GND          |                                        |
| Status-LED        | GPIO 2    | (onboard)    | aus / blink / an                       |

> ⚠️ **Wichtig:** Die ESP32-Pins **34, 35, 36 und 39 sind Input-only** und
> haben **keinen internen Pull-Up**. Der A3144 ist open-collector und braucht
> zwingend einen Pull-Up. Auf GPIO 4 macht der ESP32 das intern. Wer einen
> dieser Input-only-Pins benutzen will, muss einen externen 10 kΩ-Widerstand
> von Pin → 3.3 V loeten.

### Schaubild

```
                     ┌───────────────────────────────┐
                     │        ESP32 DevKit            │
                     │                                │
   ┌─────────────┐   │                                │
   │ Hall A3144  │   │                                │
   │  OUT  ──────┼───┤ GPIO 4   (Pull-Up intern)      │
   │  VCC  ──────┼───┤ 3V3                            │
   │  GND  ──────┼───┤ GND                            │
   └─────────────┘   │                                │
                     │                                │
   ┌─────────────┐   │                                │
   │ MPU-6050    │   │                                │
   │  SDA  ──────┼───┤ GPIO 21  (I²C-Bus, geteilt)    │
   │  SCL  ──────┼───┤ GPIO 22                        │
   │  VCC  ──────┼───┤ 3V3                            │
   │  GND  ──────┼───┤ GND                            │
   └─────────────┘   │                                │
                     │                                │
   ┌─────────────┐   │                                │
   │ OLED 0x3C   │   │                                │
   │  SDA  ──────┼───┤ GPIO 21  (gleicher I²C-Bus)    │
   │  SCL  ──────┼───┤ GPIO 22                        │
   │  VCC  ──────┼───┤ 3V3                            │
   │  GND  ──────┼───┤ GND                            │
   └─────────────┘   │                                │
                     │                                │
   ┌─────────────┐   │                                │
   │ GPS NEO-6M  │   │                                │
   │  TX   ──────┼───┤ GPIO 16  (UART2 RX)  gekreuzt! │
   │  RX   ──────┼───┤ GPIO 17  (UART2 TX)  gekreuzt! │
   │  VCC  ──────┼───┤ 3V3 (oder 5V, NEO-6M tolerant) │
   │  GND  ──────┼───┤ GND                            │
   └─────────────┘   │                                │
                     │  GPIO 2  ── Onboard-LED        │
                     └───────────────────────────────┘
```

## Bridge (Boxen-ESP32)

### Pin-Tabelle

| Funktion       | ESP32-Pin | Sensor-Pin | Bemerkung      |
| -------------- | --------- | ---------- | -------------- |
| I²C SDA        | GPIO 21   | SDA        | nur OLED       |
| I²C SCL        | GPIO 22   | SCL        |                |
| OLED VCC       | 3V3       | VCC        |                |
| OLED GND       | GND       | GND        |                |
| Status-LED     | GPIO 2    | (onboard)  |                |

### Schaubild

```
                     ┌───────────────────────────────┐
                     │        ESP32 DevKit            │
                     │                                │
                     │ USB ──────────►  PC (Dashboard)│
                     │                                │
   ┌─────────────┐   │                                │
   │ OLED 0x3C   │   │                                │
   │  SDA  ──────┼───┤ GPIO 21                        │
   │  SCL  ──────┼───┤ GPIO 22                        │
   │  VCC  ──────┼───┤ 3V3                            │
   │  GND  ──────┼───┤ GND                            │
   └─────────────┘   │                                │
                     │  GPIO 2  ── Onboard-LED        │
                     └───────────────────────────────┘
```

Die Bridge hat keine eigenen Sensoren — sie braucht nur das OLED zur Anzeige
und die USB-Verbindung zum PC.

## Stromversorgung

### Sender (Kart)

- **Empfohlen:** Pufferakku (z.B. 7.4 V LiPo) → 5 V Step-Down → ESP32 VIN
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

## ESP32-Pins, die du **nicht** verwenden solltest

| Pin              | Grund                                            |
| ---------------- | ------------------------------------------------ |
| GPIO 0           | Strapping-Pin, beim Boot LOW = Flash-Mode        |
| GPIO 6–11        | Intern an SPI-Flash gebunden, nicht nutzbar      |
| GPIO 12          | Strapping-Pin, beeinflusst Flash-Spannung        |
| GPIO 15          | Strapping-Pin, beim Boot HIGH = Silent-Boot      |
| GPIO 34/35/36/39 | Input-only, KEIN interner Pull-Up                |

GPIO 4, 5, 13, 14, 18, 19, 23, 25–27, 32, 33 sind unkritisch.
GPIO 2 (LED) ist auch Strapping-Pin — bei OUT geht der Boot trotzdem,
weil der Pin beim Boot in den richtigen Zustand gebracht wird.

## Pruef-Checklist nach dem Aufbau

1. **Vor dem ersten Strom-Anlegen:** Mit Multimeter alle GND/VCC-Verbindungen
   durchklingeln. Niemals 5 V auf einen 3,3 V-only-Pin (z.B. RX/TX) legen.
2. **OLED-Diagnose** laufen lassen: `esp_libs/oled_diagnose.py` in Thonny ausfuehren —
   sagt sofort, ob I²C, OLED und IMU antworten.
3. **Hall-Sensor pruefen:** Magnet vor den Sensor halten; auf der Sender-OLED
   sollte die RPM-Page reagieren (klein > 0).
4. **GPS-Fix:** Beim ersten Start kann der Cold-Fix bis 90 s dauern, ideal
   draussen mit freiem Himmel. Status-LED blinkt waehrend GPS sucht.
