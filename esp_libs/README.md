# ESP32 MicroPython-Treiber

Diese Dateien gehören auf die ESP32-Module (nicht auf den PC).
Sie liefern die Schnittstellen für Sensoren und Display.

## Was du brauchst

### Auf BEIDEN ESPs (Sender + Bridge)
- **`ssd1306.py`** — OLED-Treiber für SSD1306 128x64

### Nur auf dem Sender (Kart-ESP)
- **`mpu6050.py`** — MPU-6050 IMU (Beschleunigungssensor)
- **`micropyGPS.py`** — NMEA-Parser für das GPS-Modul

## Installation

### 1. MicroPython Firmware aufspielen
Falls noch nicht vorhanden, lade die offizielle MicroPython-Firmware
für ESP32 herunter und flashe sie mit `esptool.py`:

```bash
# Firmware löschen
esptool.py --port COM3 erase_flash

# Firmware aufspielen (Pfad anpassen)
esptool.py --port COM3 --baud 460800 write_flash 0x1000 esp32-xxx.bin
```

Download: https://micropython.org/download/ESP32_GENERIC/

**Wichtig: MicroPython Version 1.20 oder neuer** — `espnow` ist erst ab dieser Version dabei.

### 2. Treiber-Files kopieren
Mit einem Tool wie **Thonny** (Tools → Manage Packages oder einfach Datei → Speichern als → MicroPython Gerät) oder **mpremote**:

**Sender-ESP (Kart):**
```
/ssd1306.py
/mpu6050.py
/micropyGPS.py
/main.py        ← der Inhalt von sender_v9_main.py
```

**Bridge-ESP (Boxen):**
```
/ssd1306.py
/main.py        ← der Inhalt von bridge_v9_main.py
```

### 3. Mit mpremote (CLI)
```bash
# Sender flashen
mpremote connect COM3 cp ssd1306.py :ssd1306.py
mpremote connect COM3 cp mpu6050.py :mpu6050.py
mpremote connect COM3 cp micropyGPS.py :micropyGPS.py
mpremote connect COM3 cp ../sender_v9_main.py :main.py

# Bridge flashen
mpremote connect COM4 cp ssd1306.py :ssd1306.py
mpremote connect COM4 cp ../bridge_v9_main.py :main.py
```

### 4. Mit Thonny (GUI)
1. Thonny öffnen, ESP32 als Interpreter wählen
2. Linke Seite: Datei-Browser auf dem ESP32
3. Diese Dateien per Drag-and-Drop ins ESP32-Root kopieren
4. ESP32 reset (RESET-Taste oder Thonny → Stop/Restart backend)

## PC-Treiber (Windows)

Auf dem PC selbst brauchst du den USB-zu-Seriell-Treiber:

- **CP210x** (Silicon Labs) — die meisten ESP32-Boards. Liegt im `drivers/`-Ordner des Projekts.
- **CH340** — manche günstige Boards. Download bei wch.cn falls nötig.

Nach Installation taucht der ESP32 als COM-Port im Geräte-Manager auf.
Im Dashboard → Verbindung → COM-Port wählen und verbinden.

## Lizenzen

- `ssd1306.py` — MIT, basierend auf MicroPython-offiziellem Code
- `mpu6050.py` — MIT, eigene minimale Implementierung der InvenSense-Spec
- `micropyGPS.py` — MIT, kompakter NMEA-Parser kompatibel zur inmcm/micropyGPS-API
