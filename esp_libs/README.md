# ESP32 MicroPython-Treiber

Diese Dateien gehören auf die ESP32-Module (nicht auf den PC).
Sie liefern die Schnittstellen für Sensoren und Display.

## Was du brauchst

### Auf BEIDEN ESPs (Sender + Bridge)
- **`ssd1306.py`** — OLED-Treiber für SSD1306 128x64
- **`frame.py`** — Binär-Protokoll-Codec (Pflicht! Ohne sie startet die Bridge nicht und der Sender sendet keine Telemetrie)

### Nur auf dem Sender (Kart-ESP)
- **`mpu6050.py`** — MPU-6050 IMU (Beschleunigungssensor)
- **`micropyGPS.py`** — NMEA-Parser für das GPS-Modul
- **`calc.py`** — Batterie-/Wheel-Speed-Mathe (ohne sie: kein Akku-Monitoring, kein GPS-Ausfall-Fallback)

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

**Wichtig: MicroPython Version 1.21 oder neuer** — `espnow` und die RSSI-Auswertung (`peers_table`) sind erst ab dieser Version dabei.

### 2. Programme vorkompilieren (mpy-cross) — PFLICHT ab MicroPython 1.28

`sender.py` und `bridge.py` dürfen **nicht mehr als `.py` direkt aufs Gerät**.
Grund: MicroPython kompiliert `main.py` beim Boot auf dem Chip. Bei so
großen Dateien wächst der Python-Heap dabei in genau die DRAM-Region,
aus der der WiFi-Treiber seine Buffer braucht → der Sender crasht beim
Start mit `OSError: WiFi Out of Memory` und hängt in einer
Watchdog-Bootschleife. Vorkompiliertes Bytecode (`.mpy`) braucht beim
Laden nur einen Bruchteil des RAMs und umgeht das Problem komplett.

```bash
pip install mpy-cross
python -m mpy_cross -o app.mpy sender.py     # fuer den Kart-ESP
python -m mpy_cross -o app.mpy bridge.py     # fuer die Bridge (separat!)
```

Auf dem Gerät liegt dann `app.mpy` plus ein Mini-`main.py` mit nur:

```python
# Programm ist vorkompiliert (app.mpy, mpy-cross) -- der On-Device-Compile
# der grossen .py wuerde dem WiFi-Treiber den RAM wegfressen.
import app
```

### 3. Mit mpremote (CLI) — komplette Prozedur

```bash
# ── Sender (Kart-ESP) ──
python -m mpy_cross -o app.mpy ../sender.py
mpremote connect COM3 cp ssd1306.py :ssd1306.py
mpremote connect COM3 cp mpu6050.py :mpu6050.py
mpremote connect COM3 cp micropyGPS.py :micropyGPS.py
mpremote connect COM3 cp frame.py :frame.py
mpremote connect COM3 cp calc.py :calc.py
mpremote connect COM3 cp app.mpy :app.mpy
mpremote connect COM3 cp main_stub.py :main.py

# ── Bridge (Boxen-ESP) ──
python -m mpy_cross -o app.mpy ../bridge.py
mpremote connect COM4 cp ssd1306.py :ssd1306.py
mpremote connect COM4 cp frame.py :frame.py
mpremote connect COM4 cp app.mpy :app.mpy
mpremote connect COM4 cp main_stub.py :main.py
```

`main_stub.py` ist das Mini-`main.py` aus Schritt 2 (liegt in diesem Ordner).

**Wenn der ESP in einer Crash-Schleife hängt** (Watchdog resettet alle
paar Sekunden, mpremote meldet `could not enter raw repl`): Reset-Taste
drücken und in den ersten ~2 s in einem seriellen Terminal mehrfach
Strg-C senden — das unterbricht `main.py`, bevor der Watchdog scharf
wird. Danach funktioniert mpremote wieder.

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
