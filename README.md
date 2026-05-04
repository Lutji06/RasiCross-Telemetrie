# RasiCross-Telemetrie

Ein Live-Telemetrie-System für Kart-Rennen / Rasenmäher-Rennen ("RasiCross") auf Basis von zwei ESP32-Mikrocontrollern und einem Web-Dashboard.

---

## Inhaltsverzeichnis

- [Überblick](#überblick)
- [Systemarchitektur](#systemarchitektur)
- [Komponenten](#komponenten)
- [Hardware](#hardware)
- [Verkabelung & Pinbelegung](#verkabelung--pinbelegung)
- [Installation](#installation)
- [Erste Inbetriebnahme](#erste-inbetriebnahme)
- [Konfiguration](#konfiguration)
- [Datenprotokoll](#datenprotokoll)
- [Display-Seiten am Kart](#display-seiten-am-kart)
- [Bridge-Display](#bridge-display)
- [Status-LEDs](#status-leds)
- [Funk: Long-Range-Modus](#funk-long-range-modus)
- [Fehlersuche](#fehlersuche)
- [Dashboard als .exe bauen](#dashboard-als-exe-bauen)
- [Versionsstand](#versionsstand)
- [Lizenz](#lizenz)

---

## Überblick

RasiCross-Telemetrie überträgt Sensordaten vom Fahrzeug live in die Boxengasse und visualisiert sie in einem Browser-Dashboard. Vom Cockpit aus lassen sich gleichzeitig Anzeigeseiten umschalten und Pit-Calls signalisieren.

**Erfasste Daten:**
- Drehzahl (Hall-Sensor am Antrieb)
- Geschwindigkeit, Position und GPS-Fix (NMEA via UART)
- Längs- und Querbeschleunigung (MPU-6050)
- Verbindungsqualität (Pakete/s, Verlustrate, RSSI)

**Wichtige Eigenschaften:**
- Kabellos via ESP-NOW im Long-Range-Modus (~250 kbit/s, max. Reichweite)
- Bidirektionaler Kanal: Dashboard kann Konfiguration, Display-Seite und Pit-Call zum Kart senden
- Auto-Pairing: Sender lernt Bridge-MAC automatisch (Hardcoding optional)
- Robuster Sende-Pfad mit Retry, Heartbeat und Watchdog
- 5 Display-Seiten am Kart + Override für Shift-Light und Pit-Call
- Bridge mit eigenem OLED zur Diagnose

---

## Systemarchitektur

```
   ┌──────────────────┐                       ┌──────────────────┐
   │   KART  (Sender) │   ESP-NOW (LR-Mode)   │  BRIDGE (Empf.)  │       ┌──────────────┐
   │                  │ ◄────────────────────►│                  │  USB  │  Dashboard   │
   │  ESP32 + OLED    │     2.4 GHz, CH 1     │  ESP32 + OLED    │ ◄───► │  (HTML/JS    │
   │  Hall · IMU · GPS│                       │                  │ JSON  │   im Browser)│
   └──────────────────┘                       └──────────────────┘ Lines └──────────────┘
```

**Datenfluss:**
1. Der Sender liest Sensoren und schickt alle 80 ms (≈ 12,5 Hz) ein JSON-Paket per ESP-NOW.
2. Die Bridge empfängt, reichert das Paket mit RSSI und Statistik an und schreibt es als JSON-Zeile auf USB-Serial.
3. Das Dashboard liest die Zeilen über die Web-Serial-Schnittstelle und visualisiert sie live.
4. Steuerpakete (Display-Seite, Config, Pit-Call) wandern den umgekehrten Weg.

---

## Komponenten

| Datei                          | Rolle              | Plattform              |
| ------------------------------ | ------------------ | ---------------------- |
| `sender_v9_main.py`            | Kart-Sender        | ESP32 + MicroPython    |
| `bridge_v9_main.py`            | Bridge / Empfänger | ESP32 + MicroPython    |
| `RasiCross_Telemetry_v9_6.html`| Web-Dashboard      | Browser (Web Serial)   |

---

## Hardware

**Pro Knoten (Kart und Bridge):**
- ESP32-Devkit (z. B. ESP32-WROOM-32) mit MicroPython 1.21+
- SSD1306 OLED 128 × 64, I²C (Adresse 0x3C)
- Onboard-LED (typisch GPIO 2)

**Nur am Kart:**
- Hall-Sensor (z. B. A3144) am Schwungrad / der Antriebswelle
- MPU-6050 (Beschleunigung & Gyro) auf I²C
- GPS-Modul mit NMEA-Ausgabe (z. B. NEO-6M / NEO-M8N) via UART

**Empfohlen:**
- Stabile 5 V-Versorgung am Kart (Pufferakku gegen Lastspitzen)
- Externe 2,4-GHz-Antenne an beiden ESP32 für maximale Reichweite

---

## Verkabelung & Pinbelegung

Standard-Pins, im `Config`-Block beider Skripte änderbar:

### Kart-Sender

| Funktion        | Pin (GPIO) | Bemerkung                      |
| --------------- | ---------- | ------------------------------ |
| Hall-Sensor     | 34         | Input mit Pull-Up, Falling-IRQ |
| GPS UART2 RX    | 16         | 9600 Baud                      |
| GPS UART2 TX    | 17         |                                |
| I²C SDA         | 21         | gemeinsam für IMU + OLED       |
| I²C SCL         | 22         |                                |
| Status-LED      | 2          | Onboard                        |

### Bridge

| Funktion   | Pin (GPIO) |
| ---------- | ---------- |
| I²C SDA    | 21         |
| I²C SCL    | 22         |
| Status-LED | 2          |

---

## Installation

### MicroPython auf ESP32 flashen

```bash
# Beispiel mit esptool (Firmware vorher von micropython.org laden)
esptool.py --chip esp32 --port /dev/ttyUSB0 erase_flash
esptool.py --chip esp32 --port /dev/ttyUSB0 --baud 460800 \
  write_flash -z 0x1000 esp32-20240602-v1.23.0.bin
```

### Bibliotheken auf den ESP32 spielen

Die nötigen MicroPython-Treiber liegen im Ordner [`esp_libs/`](esp_libs/) — siehe auch [`esp_libs/README.md`](esp_libs/README.md) für Details.

Auf den **Kart-ESP32** ins Wurzelverzeichnis des Filesystems:

- `sender_v9_main.py` (Hauptprogramm) — als `main.py`
- `esp_libs/ssd1306.py`     – OLED-Treiber
- `esp_libs/mpu6050.py`     – IMU-Treiber
- `esp_libs/micropyGPS.py`  – NMEA-Parser

Auf den **Bridge-ESP32**:

- `bridge_v9_main.py` (Hauptprogramm) — als `main.py`
- `esp_libs/ssd1306.py`     – OLED-Treiber

Übertragen z. B. mit [`mpremote`](https://docs.micropython.org/en/latest/reference/mpremote.html) oder [`ampy`](https://github.com/scientifichackers/ampy):

```bash
# Sender flashen
mpremote connect /dev/ttyUSB0 cp esp_libs/ssd1306.py :
mpremote connect /dev/ttyUSB0 cp esp_libs/mpu6050.py :
mpremote connect /dev/ttyUSB0 cp esp_libs/micropyGPS.py :
mpremote connect /dev/ttyUSB0 cp sender_v9_main.py :main.py

# Bridge flashen
mpremote connect /dev/ttyUSB1 cp esp_libs/ssd1306.py :
mpremote connect /dev/ttyUSB1 cp bridge_v9_main.py :main.py
```

Bei OLED-Problemen hilft das Diagnose-Skript [`esp_libs/oled_diagnose.py`](esp_libs/oled_diagnose.py): einfach in Thonny laden und in der REPL ausführen — es prüft I²C, OLED-Adresse und schreibt am Ende ein Test-Bild.

> **Hinweis:** Beide Skripte starten ihre `main()`/`Bridge().run()` automatisch beim Import. Wenn sie als `main.py` auf dem ESP liegen, läuft das System direkt nach dem Boot.

### Dashboard öffnen

Zwei Wege:

1. **Im Browser** — `RasiCross_Telemetry_v9_6.html` direkt öffnen (Chromium-basierter Browser empfohlen, da Web Serial benötigt wird) und in der UI auf "Connect" klicken.
2. **Als Desktop-App** (.exe) — siehe Abschnitt [Dashboard als .exe bauen](#dashboard-als-exe-bauen).

---

## Erste Inbetriebnahme

1. Beide ESP32 mit Strom versorgen.
2. Bridge per USB an den PC stecken und Dashboard mit dem entsprechenden COM-/USB-Port verbinden.
3. Auf dem Kart-OLED erscheint kurz das Boot-Bild, danach beginnt die Page-Rotation.
4. Nach wenigen Sekunden taucht im Dashboard die Bridge-MAC auf.
5. Der Sender lernt die Bridge-MAC automatisch über das `bridge_hello`-Paket. Alternativ kann sie unter `Config.BRIDGE_MAC` im `sender_v9_main.py` hartkodiert werden.
6. GPS-Fix dauert beim Kaltstart oft 30–90 Sekunden (Status-LED blinkt solange).

---

## Konfiguration

Beide Skripte enthalten oben eine `Config`-Klasse. Die wichtigsten Werte:

### Sender (`sender_v9_main.py`)

| Parameter         | Bedeutung                                  | Default                |
| ----------------- | ------------------------------------------ | ---------------------- |
| `BRIDGE_MAC`      | MAC-Adresse der Bridge (Bytes)             | `00:70:07:24:e6:64`    |
| `ESPNOW_CHANNEL`  | Funkkanal — bei Sender und Bridge gleich!  | `1`                    |
| `PULSES_PER_REV`  | Hall-Pulse pro Radumdrehung                | `1`                    |
| `SEND_MS`         | Telemetrie-Intervall in ms                 | `80`                   |
| `MAX_RPM`         | Schwelle für Shift-Light                   | `6000`                 |
| `RPM_WARN`        | Vorwarnung                                 | `5500`                 |
| `RPM_ALPHA` / `G_ALPHA` | Glättungsfaktoren (0 = aus, 1 = fix) | `0.25` / `0.30`        |
| `WATCHDOG_MS`     | Hardware-Watchdog (0 = aus)                | `8000`                 |
| `SEND_RETRY`      | ESP-NOW Sende-Wiederholungen               | `2`                    |
| `WIFI_TX_POWER_DBM` | Sendeleistung in dBm                     | `20` (EU-Max, 100 mW)  |

Viele dieser Werte lassen sich **live vom Dashboard** über ein `config`-Paket setzen (`max_rpm`, `warn_rpm`, `send_ms`, `pulses_per_rev`).

### Bridge (`bridge_v9_main.py`)

| Parameter            | Bedeutung                            | Default |
| -------------------- | ------------------------------------ | ------- |
| `ESPNOW_CHANNEL`     | siehe oben                           | `1`     |
| `HEARTBEAT_MS`       | Status an Dashboard alle …           | `2000`  |
| `HELLO_MS`           | Bridge-Hello an Kart alle …          | `5000`  |
| `OLED_REFRESH_MS`    | Display-Refresh                      | `250`   |
| `PIT_MSG_DURATION_MS`| Anzeigedauer "PIT-CALL TX"           | `3000`  |
| `WIFI_TX_POWER_DBM`  | Sendeleistung in dBm                 | `20`    |

---

## Datenprotokoll

Sämtliche Pakete sind UTF-8 JSON. Auf der ESP-NOW-Strecke werden sie binär verschickt, auf der USB-Seite zwischen Bridge und Dashboard erscheinen sie als JSON-Lines.

### Telemetrie-Paket (Kart → Bridge → Dashboard)

```json
{
  "speed": 42.3,
  "rpm": 4280,
  "gx": 0.12,
  "gy": -0.05,
  "lat": 48.1234567,
  "lon": 11.7654321,
  "gps_fix": 1,
  "pulse_hz": 71.3,
  "seq": 1234
}
```

Die Bridge ergänzt vor dem USB-Versand:

```json
{
  "rssi": -68,
  "source": "espnow_usb",
  "rx_count": 9821,
  "lost": 4,
  "bridge_ms": 1234567,
  "from_mac": "aa:bb:cc:dd:ee:ff"
}
```

### Bridge-Status (Bridge → Dashboard)

Wird beim Boot und alle 2 s gesendet:

```json
{
  "type": "bridge_status",
  "bridge": "alive",
  "mac": "11:22:33:44:55:66",
  "channel": 1,
  "rx_count": 9821,
  "lost": 4,
  "last_seq": 1233,
  "kart_mac": "aa:bb:cc:dd:ee:ff",
  "rate_hz": 12,
  "usb_errors": 0
}
```

### Steuerpakete (Dashboard → Bridge → Kart)

| `type`        | Wirkung am Kart                                                   |
| ------------- | ----------------------------------------------------------------- |
| `display`     | setzt Anzeigeseite (`page`: `auto` / `speed` / `race` / `rpm` / `delta` / `diag`) und liefert Renndaten (Lap, Sektoren, Live-Delta) |
| `config`      | aktualisiert Live-Parameter (`max_rpm`, `warn_rpm`, `send_ms`, `pulses_per_rev`) |
| `pit_call`    | löst Pit-Call-Override am OLED aus; `action: "cancel"` bricht ab; `message`, `duration_ms` optional |

Beispiel Pit-Call:

```json
{ "type": "pit_call", "message": "BOX BOX", "duration_ms": 15000 }
```

Beispiel Bridge → setzen der Kart-MAC vom Dashboard:

```json
{ "type": "set_kart_mac", "mac": "aa:bb:cc:dd:ee:ff" }
```

---

## Display-Seiten am Kart

Das OLED rotiert standardmäßig alle 4 s zwischen den fünf Seiten. Vom Dashboard kann eine Seite fest gewählt werden.

| Name    | Inhalt                                                |
| ------- | ----------------------------------------------------- |
| `speed` | Geschwindigkeit groß zentriert, RPM-Bar unten        |
| `race`  | Sektor-Segmente und aktuelle Rundenzeit               |
| `rpm`   | Drehzahl groß + 8-Segment-Bar + Warnstufe             |
| `delta` | Live-Delta zur Referenzrunde                          |
| `diag`  | Diagnose: GPS-, TX-, Speed-, RPM-Status               |

**Overrides** (höchste Priorität zuerst):
1. **Pit-Call** — blinkende "PIT STOP"-Vollbildanzeige, von außen ausgelöst
2. **Shift-Alarm** — invertiertes "RELEASE THROTTLE" sobald `rpm ≥ MAX_RPM`

---

## Bridge-Display

Layout 128 × 64 px:

```
BRIDGE  CH1     1234   ●
─────────────────────────
 42 km/h   4280 rpm
 12 Hz     L:4
 -68 dBm   GPS:OK
USB ON     KT ee:ff
```

Aktivitätspunkt rechts oben:
- gefüllt → Paket vor < 500 ms
- leerer Rahmen → vor < 2 s
- aus → keine Daten

Beim Pit-Call blendet die Bridge kurz "PIT-CALL TX" ein.

---

## Status-LEDs

### Kart
| Zustand              | LED          |
| -------------------- | ------------ |
| ESP-NOW sendet nicht | aus          |
| TX ok, GPS sucht     | blinkt 500 ms|
| TX ok, GPS-Fix       | dauerhaft an |

### Bridge
| Zustand                       | LED          |
| ----------------------------- | ------------ |
| keine Pakete vom Kart         | aus          |
| Pakete kommen, USB nicht aktiv| blinkt       |
| Pakete + USB verbunden        | dauerhaft an |

---

## Funk: Long-Range-Modus

Beide Knoten setzen `WIFI_PROTOCOL_LR` (Wert `8`) und ESP-NOW PHY-Rate `WIFI_PHY_RATE_LORA_500K`. Effekte:

- Bruttorate ~250 kbit/s, dafür sehr robust
- Reichweite typisch deutlich über klassischem 802.11b/g/n
- Knoten in normalen WLAN-Modi sind **nicht kompatibel** — beide Seiten müssen LR können

Bei Verbindungsproblemen prüfen, ob ein Knoten unbeabsichtigt im Standardmodus startet (siehe Log-Zeile `Long-Range-Modus aktiv (LR-only)` beim Boot).

---

## Fehlersuche

| Symptom                                              | Mögliche Ursache / Maßnahme                                  |
| ---------------------------------------------------- | ------------------------------------------------------------- |
| Bridge-OLED zeigt `USB OFF`                          | Dashboard noch nicht verbunden oder USB getrennt              |
| `RX-Count` bleibt 0                                  | `ESPNOW_CHANNEL` unterschiedlich? Bridge-MAC falsch? Antennen prüfen |
| `lost` zählt schnell hoch                            | Funkstörung, Reichweite überschritten, Antennenausrichtung    |
| Status-LED am Kart blinkt nie                        | LED-Pin korrekt? `LED_PIN` in Config prüfen                   |
| GPS-LED-Blinken hört nie auf                         | freie Sicht zum Himmel? GPS-Pins korrekt? `_HAS_GPS` true?    |
| RPM bleibt 0 obwohl Welle dreht                      | Hall-Sensor verdrahtet? Magnet-Abstand? `PULSES_PER_REV`?     |
| OLED bleibt schwarz                                  | I²C-Adresse 0x3C? SDA/SCL vertauscht? `_HAS_OLED` true?       |
| `bridge_error: invalid_json` im Dashboard            | korrumpierte Pakete — meist Funk-/Spannungsproblem            |
| `bridge_error: no_kart_known`                        | Bridge hat noch nie ein Paket vom Kart bekommen — erst pairen |
| Sender startet alle 8 s neu                          | Watchdog feuert — Endlosschleife/Hänger; `WATCHDOG_MS=0` zum Debug |

**Strukturierte Logs** sind über die `Config.DEBUG`-Schalter beider Skripte aktivierbar. Die Topics `init`, `config`, `pit_call`, `display`, `recv` werden auch ohne globalen Debug-Flag angezeigt.

---

## Dashboard als .exe bauen

Die HTML-Oberfläche kann als eigenständige Windows-Anwendung verpackt werden — mit **Electron**. Vorteil: Web Serial funktioniert ohne Browser-Setup, das Programm läuft per Doppelklick.

### Voraussetzungen

- [Node.js](https://nodejs.org/) ≥ 18 (LTS empfohlen)
- npm (kommt mit Node.js)
- Internetzugang beim ersten `npm install`

### Build-Schritte

**Einfachster Weg unter Windows:** das mitgelieferte PowerShell-Script [`BUILD_EXE.ps1`](BUILD_EXE.ps1) ausführen — es prüft Node.js, lädt fehlende USB-Treiber, ruft `npm install` + `electron-rebuild` und baut beide EXE-Varianten.

```powershell
# Im Repo-Ordner, Rechtsklick → "In Terminal öffnen"
.\BUILD_EXE.ps1
```

Falls Windows blockiert ("Skripte sind deaktiviert"), einmalig:

```powershell
Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
```

**Manueller Weg:**

```bash
# Abhängigkeiten installieren (einmalig, ca. 350 MB)
npm install

# Lokal starten — schnelle Vorschau ohne Build
npm start

# Windows-Builds (Output landet in dist/)
npm run build           # NSIS-Installer + portable EXE
npm run build-portable  # nur die portable EXE
```

Ergebnisse im `dist/`-Ordner:

- `RasiCross Telemetry Setup 9.6.0.exe` — NSIS-Installer mit Desktop-Verknüpfung und automatischer USB-Treiber-Installation
- `RasiCross-Telemetry-Portable.exe` — startet ohne Installation, alles in einer Datei

### Admin-Rechte

- **Installer (Setup.exe):** fragt einmalig beim Installieren nach Admin — nötig für die USB-Treiber (`installer.nsh` ruft `CP210xVCPInstaller_x64.exe` und ggf. CH341)
- **Installierte App:** läuft als normaler Nutzer, kein UAC-Prompt
- **Portable EXE:** läuft als normaler Nutzer, USB-Treiber müssen ggf. separat installiert werden

### Wie es funktioniert

| Datei                       | Zweck                                                                   |
| --------------------------- | ----------------------------------------------------------------------- |
| `package.json`              | Electron- und SerialPort-Abhängigkeiten, electron-builder-Konfiguration |
| `main.js`                   | Electron-Hauptprozess: lädt das HTML, verwaltet den seriellen Port      |
| `preload.js`                | Stellt im Renderer `window.rasiSerial` als sichere IPC-Bridge bereit    |
| `installer.nsh`             | NSIS-Custom-Hook: installiert die USB-Treiber beim Setup                |
| `BUILD_EXE.ps1`             | Komfort-Skript für den lokalen Build unter Windows                      |
| `drivers/`                  | Mitgelieferte USB-Seriell-Treiber (CP210x von Silicon Labs)             |

Datenfluss in der App:

```
HTML (Renderer) ──IPC──► preload.js ──IPC──► main.js ──node-serialport──► COM-Port
                ◄─JSON-Lines────────────────────────────────────────────┘
```

Das Dashboard ruft `window.rasiSerial.list()` auf, um vorhandene COM-Ports im Dropdown anzuzeigen, und `window.rasiSerial.open(path, baud)` zum Verbinden. Empfangene Zeilen werden via Event an die HTML-Logik durchgereicht — exakt wie im Browser, nur über Node `serialport` statt Web Serial.

### Native Module

`serialport` ist ein natives Modul. Beim ersten `npm install` läuft `electron-builder install-app-deps` automatisch und holt sich die zur installierten Electron-Version passende Prebuild-Variante. Auf Windows brauchst du dafür normalerweise nichts extra — falls doch, installiere die [Microsoft C++ Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/).

### Automatischer Windows-Build via GitHub Actions

Im Repo liegt unter `.github/workflows/build-windows.yml` ein Workflow, der die .exe automatisch baut und als GitHub Release veröffentlicht.

**So baust du eine Release-Version:**

```bash
# Versionsnummer in package.json anpassen, dann:
git tag v9.6.0
git push origin v9.6.0
```

Der Workflow läuft automatisch, baut auf einem Windows-Runner und legt einen Release mit beiden EXE-Varianten an.

**Manueller Test ohne Tag:** Auf github.com → Tab `Actions` → `Windows-Build` → `Run workflow`. Die Artefakte landen dann unter dem Workflow-Run und sind 30 Tage abrufbar (kein Release).

**Bei Pull-Requests:** Der Workflow läuft auch automatisch, lädt aber nur Artefakte hoch, ohne ein Release zu erstellen — so bleibt die Build-Pipeline grün-getestet, bevor etwas gemergt wird.

### Icon anpassen (optional)

Lege ein `.ico` (256 × 256, Multi-Resolution) als `icon.ico` direkt im Projekt-Wurzelverzeichnis ab. `package.json` referenziert den Pfad bereits — beim nächsten Build wird es automatisch verwendet, sowohl im Fenster, im Installer als auch im Uninstaller.

Konvertierung von PNG zu ICO z.B. via [convertio.co/png-ico](https://convertio.co/png-ico/) oder [icoconvert.com](https://icoconvert.com/).

### Was Electron NICHT braucht

Die ESP-NOW-Funkstrecke und der ESP32-Code sind unabhängig von der Electron-App. Die .exe ersetzt nur den Browser — die Bridge bleibt am USB.

---

## Versionsstand

- **Sender:** v9.6 (`sender_v9_main.py`)
- **Bridge:** v9.6 (`bridge_v9_main.py`)
- **Dashboard:** v9.6 (`RasiCross_Telemetry_v9_6.html`)
- **Electron-App:** 9.6.0 (`package.json`)

Neuerungen gegenüber v8 (Sender & Bridge):
- Saubere Trennung Sensors / Display / Link / App
- Auto-Pairing über `bridge_hello`
- Robustes Senden mit Retry und Heartbeat-Counter
- Live-Konfiguration vom Dashboard
- Reiner Long-Range-Funkmodus mit max. EU-Sendeleistung
- Strukturiertes Debug-Logging mit Topic-Filter

---

## Lizenz

Dieses Projekt steht unter der [MIT-Lizenz](LICENSE) — kostenlose Nutzung, Modifikation und Verbreitung erlaubt, ohne Gewährleistung.

Treiber und Bibliotheken Dritter haben eigene Lizenzen:

- `drivers/CP210xVCPInstaller_x64.exe` — Silicon Labs (proprietär, frei verteilbar)
- `esp_libs/ssd1306.py` — MicroPython, MIT
- `esp_libs/mpu6050.py` — MIT (Eigenentwicklung)
- `esp_libs/micropyGPS.py` — MIT (kompakter NMEA-Parser, kompatibel zur inmcm/micropyGPS-API)
