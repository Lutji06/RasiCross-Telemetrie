# Audit 2026-09-26 — offene Befunde

Kompletter Fehler-Audit von App und ESP-Firmware am Vortag eines Renntags, an dem nur ein Kart fuhr. Die Befunde, die auch mit einem Kart auftreten, sind in **Phase 70** behoben (`docs/superpowers/plans/2026-09-26-70-renntag-fixes.md`). Hier steht alles, was offen bleibt — mit Messung, Ursache und Lösungsvorschlag, damit die nächste Phase direkt planen kann.

**Wie gemessen wurde:** Firmware unter CPython mit den Stubs aus `test/mpstub.py` (Modelluhr, Fuzzing); App end-to-end über den echten seriellen Eingangspfad mit einer Fake-Bridge (`serial:open`/`serial:write` im Main-Prozess ersetzt, Zeilen im Bridge-Format per `serial:line` eingespeist, 3 Karts auf einer Kreisbahn mit Start/Ziel und zwei Sektoren). Rezepte in den Projekt-Memories `esp-firmware-ohne-hardware-testen` und `app-sim-mit-fake-bridge`.

---

## A. Nur mit mehreren Karts — vor dem nächsten Mehr-Kart-Renntag beheben

### A1 · Umkipp-Warnung kommt bei 2+ Karts Sekunden zu spät — **hoch (Sicherheit)**

- **Messung:** Kart kippt in 0,6 s auf 90°. Warnung nach 0,5 s bei einem Kart; bei 2 Karts nach 4,5 s, bei 3 Karts nach 5,9 s (Modell) bzw. **8,5 s (echte App)**, bei 4 Karts nach 6,4 s. Mit einer Uhr je Kart immer ~0,5 s.
- **Ursache:** `src/telemetry.js` hält `_attLastMs` als *eine* Modulvariable (Deklaration am Dateiende). `_attDt` ist damit die Zeit seit dem letzten Paket *irgendeines* Karts — bei N Karts ~80/N ms statt 80 ms. `RasiAttitude.rollStep` integriert die Roll-Rate mit diesem zu kleinen `dt`; der Winkel wächst nur über den 2-%-Beschleunigungsanteil je Schritt nach.
- **Fix:** `makeKartState()` in `src/kart-registry.js` hat bereits ein Feld `_attLastMs` je Kart — es wird nur nie benutzt. In `processTelemetry` `k._attLastMs` statt der Modulvariable verwenden, Modulvariable löschen.
- **Test:** reines Modell mit verschachtelten Paketen (Warnzeit < 1 s bei 3 Karts) + Fake-Bridge-Sim.

### A2 · Pause verlängert die laufende Runde der nicht ausgewählten Karts

- **Messung:** 3 Karts, 8 s Pause. Ausgewähltes Kart: alle Runden 15,1–15,3 s. Die anderen: die Runde über die Pause **23,4 s bzw. 24,0 s** (Sektor 2 = 13,1 s).
- **Ursache:** `startRace()` in `src/races.js`, Zweig `r.status === 'paused'`: nur `activeKart()` bekommt `lapStart`/`sectorsLive.sectorStart += pausedMs` und den `prevLat`-Reset.
- **Fix:** über `RasiLapEngine.participantsOf(r)` iterieren und für jedes vorhandene `state.karts.get(p.mac)` verschieben bzw. frisch beginnen.

### A3 · USB-Bandbreite der Bridge reicht nicht für 3+ Karts

- **Messung:** eine Telemetriezeile ist **431 Byte** (MicroPython-`json.dumps` setzt `", "` und `": "`). Bei 12,5 Hz sind das 5,4 kB/s je Kart; 115200 Baud (CP210x-DevKit) liefern ~11,5 kB/s: 1 Kart 47 %, 2 Karts 94 %, **3 Karts 140 %**, 4 Karts 187 %. `print()` blockiert ~37 ms je Zeile; der ESP-NOW-Empfangspuffer der Bridge läuft über → Paketverlust, sinkende Hz.
- **Optionen** (kombinierbar):
  1. kompakte Separatoren in `jprint()` (`separators=(',', ':')` — auf der Ziel-MicroPython-Version prüfen) → ~−15 %;
  2. redundante Felder weglassen (`source`, `rx_count`, `bridge_ms`, `imu_cal`/`gps_health` im Normalzustand) oder kurze Schlüssel wie beim `config_ack`;
  3. höhere Baudrate (UART0 der Bridge + Default in der App, z. B. 460800).

### A4 · Strecken-Scan nimmt die GPS-Punkte aller Karts

- **Ursache:** `handleSerialLine()` in `src/serial-demo.js` ruft `onGpsUpdate(d.lat, d.lon)` für jede Zeile, egal von welchem Kart. Der Demo-Pfad füttert nur das ausgewählte Kart. Mit mehreren Karts auf der Strecke springt der Scan zwischen den Karts hin und her.
- **Workaround:** Strecke mit nur einem Kart auf der Bahn scannen.
- **Fix:** nur Zeilen mit `from_mac === state.activeKartMac` an `onGpsUpdate` geben.

### A5 · Export/Import sichert nur das ausgewählte Kart

- **Ursache:** `exportAll()` in `src/data-backup.js` schreibt `calibration`/`engine` nur von `activeKart()`. `kartsCal`, `kartsEngine`, `kartsStats`, `kartsMeta` (Namen, Farben, Ausstattung, Kilometerstand) fehlen; `importAll()` stellt entsprechend nur ein Kart her.
- **Fix:** dieselben Felder exportieren, die `saveData()` in `src/store.js` persistiert, und beim Import in die Persist-Map zurückschreiben.

---

## B. Unabhängig von der Kart-Zahl, bewusst nicht in Phase 70

### B1 · Tote Anzeige-Ziele in `src/ui-glue.js`

- `trackPointsValue`, `trackLengthValue`, `trackSectorsValue`, `trackClosedValue`, `gateBreiteDisplay`, `gateHeadingDisplay` haben seit dem Strecken-Redesign kein Element mehr. Punktzahl und Gate-Breite stehen anderswo; **Streckenlänge, Sektoranzahl, Streckenstatus und Gate-Richtung werden berechnet, aber nirgends angezeigt.**
- **Entscheidung nötig:** im Strecke-Tab anzeigen oder den Spiegel-Code löschen.
- Detektor (IDs aus Markup + JS-Templates gegen `$`/`getElementById`/`setText`/`txt`/`_el`/`querySelector('#')`) wurde gegen `9430725~1` validiert und fand dort die fünf bekannten Phase-67-Fälle.

### B2 · Bridge-Fehlermeldungen erreichen den Nutzer nie

- `processTelemetry()` in `src/telemetry.js` verwirft `bridge_error` und `bridge_info` stumm. `payload_too_long`, `no_target`, `send_failed` und `kart_limit` sieht niemand; das Kart-Fenster meldet nur „Keine Bestätigung vom Kart — Funkverbindung prüfen".
- **Fix:** Fehler mit Bezug zum Config-Downlink an das Kart-Fenster routen, `kart_limit` als Toast.

### B3 · CI rot: Screenshot-Baselines veraltet

- Seit 2026-09-02 scheitert auf `main` nur `e2e/screens.spec.js` (1–2 % Pixelabweichung) nach den gewollten UI-Umbauten der Phasen 65–69; die Jobs `js` und `python` sind grün. Baselines neu erzeugen, mit Abnahme.

### B4 · Kein Release vom aktuellen Stand

- Letztes Release v1.0.7 vom 2026-06-12; `package.json` steht noch auf `1.0.7`. Die lokale Portable-exe in `release/` ist vom 2026-07-07.

### B5 · `set_kart_mac` ohne Oberfläche

- Das README listet das Kommando, die App bietet es nirgends an. Seit dem Pairing-Broadcast aus Phase 70 kaum noch nötig.

---

## C. Beobachtungen ohne bekannten Auslöser

- **C1** `animLoop()` in `src/live-ui.js` hat kein `try/catch`: eine einzige Ausnahme beendet die 60-fps-Schleife dauerhaft (der 200-ms-Tick läuft weiter, die Anzeige wird dann nur ruckeliger).
- **C2** Die Hauptschleife in `sender.py` hat kein `try/except`: eine unerwartete Ausnahme führt zum Watchdog-Neustart (8 s + Boot), danach pairt das Kart neu. Fuzzing mit `inf`/`nan`/kaputtem NMEA fand keinen Auslöser.
- **C3** `animLoop` (rAF) und der 200-ms-Tick rufen dieselben Render-Funktionen — doppelte Arbeit auf schwachen Laptops.
