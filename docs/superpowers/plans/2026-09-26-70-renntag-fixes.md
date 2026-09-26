# Phase 70 — Renntag-Fixes (unabhängig von der Kart-Zahl)

**Goal:** Die Fehler aus dem Audit vom 2026-09-26 beheben, die auch mit nur einem Kart zuschlagen — am Tag vor einem Renntag mit einem Kart. Die Befunde, die nur mehrere Karts betreffen, plus bewusst zurückgestellte Punkte stehen in `docs/superpowers/specs/2026-09-26-70-audit-offene-befunde.md`.

**Architecture:** Jede Korrektur testgetrieben (rot gesehen, dann grün). Reine Logik in reinen Modulen mit `node:test` (`lap-engine.js`, `conn-health.js`, neues `esp-payload.js`); Firmware über die Stubs in `test/mpstub.py`; DOM-Verdrahtung über die Playwright-Demo-Suite und eine Fake-Bridge-Simulation der echten App.

**Branch:** `fix/phase-70-renntag`, aufgesetzt auf `main` (`3070ce6`).

**Spec:** kein eigenes Design-Dokument — Grundlage ist der Audit vom 2026-09-26 (Befundliste siehe oben).

## Global Constraints

- Nur Fehler, die unabhängig von der Kart-Zahl auftreten. Mehr-Kart-Befunde (Umkipp-Uhr, Pause, USB-Bandbreite, Scan, Export) bleiben unangetastet.
- Telemetrie-Protokoll unverändert; 250-B-ESP-NOW-Budget eingehalten.
- Dateien sind CRLF. Zeilen-Gate: Inhaltszeilen ohne Leerzeilen, harte Grenze 520 für angefasste Dateien (`live-ui.js` ist Altbestand mit 652 und bekommt nur 6 Zeilen dazu).

## Locked Decisions

- **Rückfrage nur an den Knöpfen.** `confirmEndRace()` hängt am „Ende"-Knopf und am „Beenden" der Rennliste. `endRace()` selbst bleibt ohne Dialog — Runden-/Zeitziel und `stopDemo()` beenden weiter direkt.
- **GPS: kein Fix ohne NMEA-Bytes in den letzten 3 s**, in `GPS.fix` (`gps_task.py`) über das schon vorhandene `has_recent_data` — nicht im Parser. Folge: `health` ist 3–10 s nach dem Verstummen `searching`, danach `lost`; `speed`/`lat`/`lon` gehen auf 0, die App zeigt ihre GPS-Warnung.
- **Pairing-Broadcast, solange ein Platz frei ist** (`len(karts) < MAX_KARTS`), im bestehenden `HELLO_MS`-Takt (5 s). Das Kart speichert die Bridge-MAC nicht und sendet ohne sie nie — ein zweites oder getauschtes Kart wurde vorher nur über „Karts zurücksetzen" gelernt.
- **Alt-Schlüssel `kart_mac` wird bei jedem `save_list` gelöscht.** Das Speichern der leeren Liste bleibt wie gehabt.
- **Angezeigter Fahrer = Teilnehmer des ausgewählten Karts** (`RasiLapEngine.currentDriverId`). `r.currentDriverId` bleibt Fallback und Startwert für Nachzügler — unverändert.
- **Reconnect-Kurve unverändert** (2,1 s wachsend bis 15 s), nur das Aufgeben nach 30 Versuchen entfällt.
- **Config-Downlink gerundet auf die Stellen des `config_ack`** (`config_snapshot` in `config_store.py`); Ganzzahlfelder abgeschnitten wie Python-`int()` auf dem ESP.

## File Structure

| Action | Path | Responsibility |
| --- | --- | --- |
| Modify | `esp_libs/gps_task.py` | `fix` verlangt frische NMEA-Bytes |
| Modify | `bridge.py` | Broadcast-Hello bei freiem Platz; Alt-Schlüssel löschen |
| Modify | `test/mpstub.py` | `NVS.erase_key` wie auf dem ESP (wirft bei fehlendem Schlüssel) |
| Modify | `test/test_firmware.py` | `GpsAusfall`, `Pairing`, `PeerStoreAltlast`, `_FrischerNvs` |
| Modify | `src/lap-engine.js` | `currentDriverId(r, mac)` |
| Modify | `src/live-ui.js`, `src/pit-wall.js` | Fahrername über `currentDriverId` |
| Modify | `src/races.js`, `src/app-init.js` | `confirmEndRace()` an beiden Ende-Knöpfen |
| Modify | `src/conn-health.js`, `src/serial-demo.js` | `reconnectDelayMs()`, kein Aufgeben |
| Create | `src/esp-payload.js` | `roundEspConfig()` — reine Rundung des Config-Downlinks |
| Modify | `src/kart-settings-window.js` | Config vor dem Senden runden |
| Create | `test/esp-payload.test.js` | Rundung, 250-B-Grenze, Eingabe unverändert |
| Modify | `test/lap-engine.test.js`, `test/conn-health.test.js` | neue Unit-Tests |
| Modify | `e2e/demo.spec.js` | Ende-Rückfrage; Fahrerwechsel ohne Flackern |

## Tasks

- [x] **1 · GPS-Ausfall bleibt unsichtbar** (`gps_task.py`). Test `GpsAusfall.test_verstummtes_gps_verliert_den_fix`: nach gültigem Fix eine Minute ohne Byte. Rot: `True is not false`. Grün mit `and self.has_recent_data`.
- [x] **2 · Neues Kart wird nie angelernt** (`bridge.py`). Test `Pairing.test_broadcast_auch_wenn_schon_ein_kart_bekannt_ist`. Rot: nur gerichtete Hellos. Gegenprobe `test_kein_broadcast_wenn_alle_plaetze_belegt`. Beim ersten Rotlauf fiel auf, dass der NVS-Stub klassenweit ist und die Bridge Karts aus früheren Tests lud — `_FrischerNvs` isoliert die neuen Testklassen.
- [x] **3 · Alte Kart-MAC kehrt nach „Karts zurücksetzen" zurück** (`bridge.py`). Test `PeerStoreAltlast.test_reset_karts_bleibt_nach_neustart_leer`. Rot: MAC nach Neustart wieder da. Grün mit `erase_key(LEGACY_KEY)` in `save_list`.
- [x] **4 · „Ende" ohne Rückfrage** (`races.js`, `app-init.js`). E2E „Ende-Knopf fragt nach, bevor das Rennen endet". Rot: Overlay nie gezeigt, Rennen sofort beendet.
- [x] **5 · Fahreranzeige nach Wechsel** (`lap-engine.js`, `live-ui.js`, `pit-wall.js`). Unit-Tests `currentDriverId` (rot: keine Funktion). E2E „Fahrerwechsel: Stint-Kopf und Pit Wall zeigen den neuen Fahrer" mit MutationObserver über 3 s (rot: Pit Wall blieb beim Startfahrer). Gegenprobe ohne den `live-ui.js`-Teil: Test meldet `currentDriverName=Demo Driver` — das Flackern.
- [x] **6 · Auto-Reconnect gibt nach ~6,5 min auf** (`conn-health.js`, `serial-demo.js`). Unit-Tests `reconnectDelayMs` (rot: keine Funktion).
- [x] **7 · Config über 250 Byte bei langen Dezimalzahlen** (`esp-payload.js`, `kart-settings-window.js`). Unit-Tests (rot: Modul fehlt). Verdrahtung per Fake-Bridge im echten Kart-Fenster: 228 Byte statt 281, keine Konsolenfehler.

## Verification (gemessen 2026-09-26)

- `npm test`: 258/258 · `npm run lint`: 0 · `npm run lint:css`: OK
- `python -m unittest discover -s test -p "test_*.py"`: 78 Tests OK · `py_compile` sender/bridge/esp_libs: OK · `ruff`: OK
- `npm run test:e2e` (ohne `ELECTRON_RUN_AS_NODE`): 17 bestanden, 15 übersprungen (Screenshot-Suite läuft nur auf CI)
- Firmware-Simulation: GPS nach 60 s Stille `fix=False`, `lost`, Tempo 0; Bridge sendet alle 5 s einen Broadcast trotz bekanntem Kart; ein neues Kart lernt daraus die Bridge-MAC, sendet und wird aufgenommen; Kart-Liste bleibt nach Zurücksetzen über den Neustart leer.

## Hardware/Manual Acceptance Checklist

- [ ] **Bridge neu flashen:** `app.mpy` aus `bridge.py` neu kompilieren und aufspielen (`esp_libs/README.md`, Schritt 3).
- [ ] **Kart:** `gps_task.py` aufspielen. Ist der Kart-ESP älter als Phase 67, die komplette Prozedur aus Schritt 3.
- [ ] Bridge an USB, App verbinden, Kart einschalten → Kart erscheint in der Leiste.
- [ ] GPS-Stecker am Kart ziehen → nach ~3 s GPS-Warnung in der App, Status-LED am Kart blinkt; wieder stecken → Fix kommt zurück.
- [ ] Ein zweites oder getauschtes Kart-ESP einschalten → erscheint nach spätestens ~5 s, ohne „Karts zurücksetzen".
- [ ] Rennen starten, „Ende" drücken → Rückfrage; „Abbrechen" → Rennen läuft weiter.
- [ ] Fahrerwechsel → Pit Wall und Stint-Kopf zeigen den neuen Fahrer, ohne Springen.
- [ ] USB-Kabel der Bridge länger als 7 min ziehen, wieder stecken → App verbindet sich von selbst.
- [ ] Kart-Fenster → Config senden → „Vom Kart bestätigt".

## Self-Review

- Jede Korrektur hat einen Test, der vor der Korrektur rot war. Die Verdrahtung von Task 7 ist nicht in der E2E-Suite (braucht ein live funkendes serielles Kart) — abgedeckt durch die Fake-Bridge-Simulation.
- Screenshot-Suite: die Änderungen zeigen sich erst nach einer Aktion (Dialog, Fahrerwechsel); Wirkung auf die Baselines nicht lokal prüfbar, die Baselines sind ohnehin veraltet (Spec B3).
- Keine Protokolländerung zwischen Kart, Bridge und App — alte und neue Firmware bleiben kompatibel.

## Phase Map

- 68 — Rückbau des Roh-Mitschnitts · 69 — Lesbarkeit
- **70 — Renntag-Fixes (dieses Dokument)**
- danach — Mehr-Kart-Befunde A1–A5 und B1–B5 aus der Audit-Spec
