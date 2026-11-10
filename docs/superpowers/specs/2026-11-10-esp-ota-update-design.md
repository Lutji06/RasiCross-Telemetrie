# ESP-Update aus der App (Sender per Funk, Bridge per USB) — Design

Stand: 2026-11-10 · Basis: v2.0.0 · Status: Entwurf, wartet auf Freigabe

## 1. Absicht

Heute braucht jedes Firmware-Update von Sender (Kart-ESP) und Bridge
(Boxen-ESP) einen Laptop mit Python, `mpy-cross`, `mpremote` und ein
USB-Kabel am Kart (Prozedur in `esp_libs/README.md`). Das ist am Renntag
unpraktisch und fehleranfällig.

Ziel: Die App bringt die passende ESP-Software selbst mit und spielt sie
auf Knopfdruck auf — den Sender **über Funk (ESP-NOW, über die Bridge)**,
die Bridge über das ohnehin angeschlossene USB-Kabel.

## 2. Ziele, Nicht-Ziele, Anti-Ziele

**Ziele**

- Sender-Update over the air, **ein Kart nach dem anderen**, vom Nutzer
  einzeln ausgelöst (Nutzer-Entscheid).
- Bridge-Update aus der App über die bestehende serielle Verbindung.
- App zeigt je Gerät die laufende Softwareversion und ob ein Update
  verfügbar ist.
- Die ESP-Software steckt vorkompiliert in jedem App-Release; App und ESP
  passen damit immer zusammen.

**Nicht-Ziele**

- Kein Update der MicroPython-Grundfirmware (bleibt `esptool` + Kabel).
- Keine Erstinstallation auf einem leeren ESP aus der App. Die erste
  update-fähige Version kommt einmalig per Kabel auf jeden ESP (wie
  bisher, README-Prozedur wird angepasst).
- Kein „alle Karts auf einmal“, kein automatisches Update im Hintergrund.
- Kein Download von Firmware aus dem Internet — nur was im Release steckt.

**Anti-Ziele (wäre ein Fehlschlag, auch wenn es „funktioniert“)**

- Ein Kart oder die Bridge ist nach einem abgebrochenen oder fehlerhaften
  Update tot und braucht ein Kabel.
- Ein Update lässt sich während eines laufenden Rennens starten oder
  stört die Telemetrie anderer Karts spürbar.
- Die normale Telemetrie wird langsamer, größer oder instabiler
  (250-B-ESP-NOW-Budget, Heap des Senders — siehe WiFi-OOM-Vorgeschichte).

## 3. Rahmenbedingungen aus dem Bestand

- Downlink App → Kart: JSON-Zeile über USB an die Bridge, die die **rohe
  Zeile** per ESP-NOW weiterreicht; harte Grenze 250 B pro Paket
  (`bridge.py` `_forward_to_kart`). Der Sender liest nur JSON-Objekte
  (`radio.py` `recv`).
- Uplink Kart → App: Binär-Frame für Telemetrie, JSON für Steuerantworten
  (`send_json`), die Bridge reicht JSON unverändert durch.
- Funk läuft im Long-Range-Modus (250 kbit/s).
- Auf dem Gerät: `main.py` (Stub, `import app`) + `app.mpy` + Bibliotheken
  als `.py`. Große `.py` dürfen nicht on-device kompiliert werden
  (WiFi-OOM-Bootloop).
- Beide ESPs haben einen Watchdog; er lässt sich auf dem ESP32 nicht
  abschalten.
- Kart-Versorgung ist brownout-gefährdet.
- Firmware lässt sich über die MicroPython-Stubs in `test/mpstub.py`
  unter CPython testen; die App über die Fake-Bridge.

## 4. Lösung im Überblick

```
App (Electron)                 Bridge (USB)                Sender (Kart)
  Firmware-Paket  ──JSON-Zeilen──▶  ota.py  (eigenes Update)
  im Release      ──JSON-Zeilen──▶  reicht ota_* weiter ──ESP-NOW──▶ ota.py
                  ◀── ota_ack ────  reicht JSON durch   ◀──ESP-NOW── ota_ack
```

Ein gemeinsames Modul `esp_libs/ota.py` läuft auf **beiden** ESPs und
nimmt Dateien stückweise entgegen. Nur der Transportweg unterscheidet
sich: Die Bridge verarbeitet `ota_*`-Zeilen, die an sie selbst gerichtet
sind, direkt; Zeilen mit `target_mac` reicht sie an das Kart weiter.

### 4.1 Firmware-Paket im Release

- Ein Build-Schritt kompiliert `sender.py`, `bridge.py` und alle
  `esp_libs/*.py` mit `mpy-cross` und legt zwei Pakete ab (Sender,
  Bridge), jeweils mit `manifest.json`: Dateiliste, Größe, SHA-256 je
  Datei und eine **Paket-ID** (Hash über das Manifest) plus die
  App-Version als lesbares Etikett.
- Die Pakete werden mit der App ausgeliefert (`extraResources`), im
  Dev-Betrieb aus dem Build-Ordner gelesen.
- „Update verfügbar“ heißt: Paket-ID auf dem Gerät ≠ Paket-ID im Release.
  Kein Versionsvergleich nach Größer/Kleiner — damit funktioniert auch
  das Zurückgehen auf eine ältere App.
- Die `mpy-cross`-Version wird festgeschrieben und muss zum
  `.mpy`-Format der geflashten MicroPython-Version passen (Stand: 1.28).
  Das Gerät meldet seine MicroPython-Version mit; passt sie nicht zum
  Paket, verweigert die App das Update mit Klartext-Hinweis.

### 4.2 Übertragungsprotokoll

Alle Nachrichten sind kompakte JSON-Objekte ≤ 250 B, kurze Schlüssel.

| Nachricht | Richtung | Inhalt |
|---|---|---|
| `ota_info` (Anfrage) | App → Gerät | — |
| `ota_info` (Antwort) | Gerät → App | Paket-ID, Etikett, MicroPython-Version, freier Flash, Zustand |
| `ota_begin` | App → Gerät | Paket-ID, Anzahl Dateien, Gesamtgröße |
| `ota_file` | App → Gerät | Dateiname, Größe, SHA-256 |
| `ota_data` | App → Gerät | Dateiindex, Offset, Nutzdaten (Base64, ~120 Rohbytes) |
| `ota_end` | App → Gerät | — (Gerät prüft alle Hashes) |
| `ota_abort` | App → Gerät | — |
| `ota_ack` | Gerät → App | bestätigter Schritt/Offset oder Fehlercode |

- **Stop-and-wait:** Die App schickt das nächste Stück erst nach dem
  `ota_ack` des vorigen. Bleibt es aus (Timeout), wiederholt sie; ein
  doppelt empfangenes Stück erkennt das Gerät am Offset und bestätigt es
  nur erneut.
- **Fortsetzen:** Nach Funkabriss fragt die App per `ota_info` den Stand
  ab und macht beim letzten bestätigten Offset weiter. Nach einem
  Neustart des Geräts wird die halbe Übertragung verworfen.
- Größenordnung: ~50–60 KB kompiliert → rund 500 Stücke → etwa eine
  halbe bis ganze Minute pro Kart bei gutem Funk.
- Der Sender meldet `ota_info` zusätzlich einmal von sich aus, sobald er
  nach dem Boot die Bridge kennt — so sieht die App die Version ohne
  Nachfrage. Die Bridge hängt ihre eigene Paket-ID an `bridge_status`.

### 4.3 Verhalten des Geräts während des Updates

- Mit `ota_begin` wechselt der Sender in den **Update-Modus**: keine
  Telemetrie, keine Sensor-Tasks, nur Funk-Empfang, Schreiben in den
  Zwischenordner `/ota_new/` und Watchdog füttern. Das hält Heap und
  Airtime frei.
- Kommt 30 s lang kein gültiges Paket, verlässt er den Update-Modus
  selbstständig und sendet wieder normal (Zwischenordner bleibt für das
  Fortsetzen liegen).
- Die Bridge im Eigen-Update reicht weiter Telemetrie durch, bis der
  Neustart ansteht.
- `ota_end`: Gerät rechnet SHA-256 jeder Datei nach. Nur wenn alles
  stimmt, schreibt es die Marke „Update bereit“ und startet neu. Sonst
  `ota_ack` mit Fehler, altes Programm läuft weiter.

### 4.4 Umschalten und Rückfall (Kern der Ausfallsicherheit)

`main.py` wird vom reinen Stub zu einem **kleinen Bootlader** (bleibt
`.py`, wenige Dutzend Zeilen, wird selbst nie per OTA ersetzt):

1. Marke „Update bereit“ vorhanden → laufende Dateien nach `/ota_old/`
   verschieben, neue aus `/ota_new/` einsetzen, Marke auf „Probe“ setzen.
2. Marke „Probe“ steht beim Boot bereits (der vorige Start hat sie also
   nicht bestätigt) → Rückfall: `/ota_old/` zurückspielen, Marke löschen.
3. `import app`. Wirft der Import, sofort Rückfall wie in 2 und Neustart.

Das Programm **bestätigt** die Probe (löscht die Marke), sobald es stabil
läuft: Sender nach 20 s Laufzeit **und** mindestens einem erfolgreich
quittierten Funkpaket an die Bridge; Bridge nach 20 s Laufzeit und einer
empfangenen USB-Zeile. Eine Version, die abstürzt, in den Watchdog läuft
oder nicht mehr funken kann, wird so beim nächsten Neustart automatisch
zurückgerollt. Kann sich ein Sender in der Probe 60 s lang nicht
bestätigen, startet er selbst neu und löst damit den Rückfall aus.

Nach Rückfall meldet `ota_info` den Zustand „zurückgerollt“; die App
zeigt das dem Nutzer.

### 4.5 App-Seite

- **Main-Prozess:** liest die Pakete, liefert Manifest und Stücke an den
  Renderer (neuer IPC-Kanal). Die Übertragungslogik (Zustandsautomat mit
  Timeout, Wiederholung, Fortsetzen) ist ein abhängigkeitsfreies
  UMD-Modul und wird mit `node:test` getestet.
- **Kart-Fenster (Einstellungen je Kart):** Zeile „Kart-Software“ mit
  Etikett, Zustand (aktuell / Update verfügbar / zurückgerollt) und Knopf
  „Aktualisieren“. Während des Updates: Fortschrittsbalken, Abbrechen.
- **Verbindungsseite:** dieselbe Zeile für die Bridge.
- **Sperren:** kein Start, solange ein Rennen läuft oder pausiert ist,
  ein anderes Update läuft, das Kart nicht verbunden ist oder die
  Bridge-Software zu alt ist, um `ota_*` weiterzureichen (dann Hinweis
  „erst Bridge aktualisieren“). Warnung mit Rückfrage bei
  Akku-Warnstufe oder wenn das Kart fährt (Geschwindigkeit > 0).
- Während des Updates gilt das Kart in der App als „wird aktualisiert“,
  nicht als „Verbindung verloren“. Andere Karts laufen normal weiter.
- Nach dem Neustart wartet die App auf die neue `ota_info` und meldet
  Erfolg oder Rückfall.

## 5. Vom Nutzer entschieden

- Sender-Update läuft over the air.
- Karts werden einzeln aktualisiert.
- Es geht um beide Geräte, Sender und Bridge.

## 6. Annahmen des Entwurfs (meine Festlegungen, bitte prüfen)

1. Bridge-Update über USB mit demselben Stück-Protokoll statt über den
   MicroPython-REPL — einheitlicher Code, gleicher Rückfall-Schutz, kein
   Kampf mit dem Watchdog.
2. Alle Bibliotheken gehen künftig als `.mpy` aufs Gerät (kleiner,
   weniger RAM beim Laden). Der Bootlader entfernt beim Umschalten
   gleichnamige `.py`, weil die sonst Vorrang hätten.
3. Der Bootlader `main.py` und der NVS-Speicher (Kart-Config,
   IMU-Offsets, Peer-Liste) werden vom Update nie angefasst.
4. Kein Passwort/keine Signatur: Wer in Funkreichweite ist und das
   Protokoll kennt, könnte ein Update einspielen — dasselbe Niveau wie
   der heutige Config-Downlink. Für den Einsatzzweck akzeptiert.
5. Update nur gegen das im Release enthaltene Paket; keine Dateiauswahl.
6. Die Demo (ohne Hardware) zeigt die Update-Zeile als „nicht verfügbar“.

## 7. Test und Abnahme

- **Firmware (CPython + Stubs):** `ota.py` und Bootlader — vollständige
  Übertragung, doppelte/fehlende Stücke, falscher Hash, Abbruch,
  Timeout aus dem Update-Modus, Umschalten, Rückfall bei Import-Fehler
  und bei unbestätigter Probe.
- **App (`node:test`):** Übertragungsautomat gegen ein simuliertes Gerät
  mit Paketverlust; Manifest-Erzeugung.
- **App-Sim mit Fake-Bridge:** kompletter Ablauf inkl. Sperren und
  Anzeige.
- **Hardware-Checkliste (durch den Nutzer):** Update bei gutem und
  schlechtem Funk, Stecker ziehen mitten im Update, absichtlich kaputtes
  Paket → Rückfall, Bridge-Update, zweites Kart sendet währenddessen
  ungestört, Heap-Messwert nach Boot gegen Baseline.

## 8. Dem Bauenden überlassen

- Genaue Schlüssel-Kürzel, Stückgröße, Timeouts und Wiederholungszahl
  (innerhalb des 250-B-Budgets, mit Messung am Gerät).
- Dateilayout der Pakete und des Build-Skripts, Einbindung in
  `build.yml`.
- Aufteilung in Phasen. Vorschlag: (a) `ota.py` + Bootlader + Tests,
  (b) Versionsmeldung + Bridge-Weiterleitung, (c) Paket-Build,
  (d) App-Übertragung + Oberfläche, (e) README/Erstinstallation.
- Optik der Update-Zeile im Rahmen des bestehenden Designs.
