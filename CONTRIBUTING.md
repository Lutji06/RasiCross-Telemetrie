# Mitmachen bei RasiCross-Telemetrie

Schön, dass du etwas beitragen willst! Hier ein paar Hinweise, damit der Beitrag rund wird.

## Bug melden

Eröffne ein [Issue](https://github.com/Lutji06/RasiCross-Telemetrie/issues/new) mit:

- **Was passiert?** Konkrete Symptome
- **Was sollte passieren?** Erwartetes Verhalten
- **Wie reproduzierbar?** Schritte vom Boot bis zum Fehler
- **Umgebung:** ESP32-Board, MicroPython-Version, Bridge oder Sender, OS des Dashboards
- **Logs:** Output aus der seriellen Konsole hilft enorm (mit `Config.DEBUG = True`)

## Feature vorschlagen

Erst ein Issue eröffnen und beschreiben, was und warum. Bevor du Code schreibst, kurz Feedback abwarten — spart Frust, falls die Idee nicht passt.

## Pull-Request einreichen

1. Repo forken
2. Branch von `main` abzweigen — sprechender Name, z.B. `fix-rpm-overflow` oder `feature-imu-calibration`
3. Änderungen committen mit klaren Commit-Messages (wir mögen den Stil "imperativ, kurz, was und warum")
4. PR gegen `main` öffnen, Beschreibung erläutert die Änderung

Die GitHub-Action baut deinen PR automatisch — bitte schauen, dass der Build durchläuft, bevor du Review anforderst.

## Code-Stil

### Python (Sender, Bridge)

- MicroPython-kompatibel bleiben (kein `f-string` mit `=`, kein Walrus, etc.)
- Klassen für jede Aufgabe — siehe `RPMCounter`, `IMU`, `GPS`, `Display`, `ESPNowLink` als Vorlage
- Docstrings für öffentliche Methoden
- `log(topic, ...)` statt `print()` — Topic in `Config.DEBUG_TOPICS` aufnehmen, wenn er immer sichtbar sein soll
- Keine `time.sleep()` in Hauptschleifen länger als 5 ms — Telemetrie-Timing geht sonst kaputt

### JavaScript (Electron)

- Vanilla JS, keine Frameworks
- IPC-Channels mit Prefix: `serial:*`, `app:*`, `config:*`
- Keine Node-APIs direkt im Renderer — alles über `preload.js` und `contextBridge`

### Allgemein

- Keine Abhängigkeiten ohne triftigen Grund — wir wollen klein bleiben
- Kommentare nur bei nicht-offensichtlichen Stellen
- Englisch oder Deutsch ist beides OK, aber innerhalb einer Datei konsistent

## Hardware testen

Hast du keinen ESP32 zur Hand? Der **Demo-Modus** im Dashboard (Button unten links) erzeugt simulierte Telemetrie — reicht für UI-Änderungen.

## Lizenz

Indem du beiträgst, stimmst du zu, dass dein Beitrag unter der [MIT-Lizenz](LICENSE) veröffentlicht wird.
