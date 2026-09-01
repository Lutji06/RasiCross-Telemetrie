# Phase 58 — ESP-Bildschirm-Funktion entfernen (Design)

**Datum:** 2026-09-01
**Status:** Freigegeben (User-Entscheid: Kart- UND Bridge-OLED entfernen, Boxenruf mit entfernen)
**Branch:** stacked auf `feat/phase-57-kart-ausstattung`

## Ziel

Die OLED-Bildschirm-Funktion beider ESPs (Kart-Sender und Bridge) wird ersatzlos
entfernt — sie wird nicht genutzt. Mit ihr fallen alle zugehörigen
Einstellmöglichkeiten in der Software sowie der Boxenruf (Pit-Call), der ohne
Kart-Display funktionslos ist.

## Locked Decisions

- **Harte Entfernung**, kein Feature-Flag und kein "OLED optional"-Pfad.
- **Beide OLEDs** fallen: Kart-Sender (5-Seiten-Display) und Bridge (Status-OLED).
  Die Bridge hängt am PC — die Software zeigt denselben Status.
- **Boxenruf komplett raus** (Button, `pit_call`-Downlink, Sender-Handling,
  Beep-Sound-Eintrag). Kein Erhalt "für spätere LED/Buzzer-Signalisierung".
- **Ausstattungs-Flag (Phase 57)** wird auf `{ rpm }` reduziert; der
  Erst-Kontakt-Dialog und die Ausstattungs-Sektion behalten nur den RPM-Toggle.
- Telemetrie-**Uplink bleibt unberührt**; Downlink behält `config`,
  `imu_calibrate`, `config_get`.

## Umfang ESP-Firmware

| Aktion | Datei | Inhalt |
|---|---|---|
| Löschen | `esp_libs/display_pages.py` | Display-Klasse + alle Seiten |
| Löschen | `esp_libs/ssd1306.py` | OLED-Treiber |
| Löschen | `esp_libs/oled_diagnose.py` | OLED-Diagnose-Tool |
| Ändern | `sender.py` | Display-Import/-Init, Seiten-Registrierung, `display`- und `pit_call`-Downlink-Handling, `display.update(...)`-Block raus. I2C bleibt (IMU), Status-LED bleibt. |
| Ändern | `esp_libs/config_store.py` | `OLED_MS`, `PAGE_MS`, Config-Key `page_ms` + Kompakt-Ack-Key `"pm"`, Debug-Topics `pit_call`/`display` raus |
| Ändern | `bridge.py` | `BridgeDisplay`, OLED-Config, `ssd1306`-Import/`_HAS_OLED`, `oled`-Statusfeld, `show_message`-Aufrufe raus; `display`/`pit_call` aus der Weiterleitungsliste |
| Ändern | `esp_libs/README.md`, `docs/VERKABELUNG.md` | OLED-Verkabelung/-Beschreibung raus |

## Umfang Software (Electron)

| Aktion | Datei | Inhalt |
|---|---|---|
| Ändern | `src/pit-wall.js` | `buildRaceDataForKart`, `sendDisplayUpdate`, `restartDisplayUpdateInterval`, Pit-Call-Block (`togglePitCall`/`sendPitCall`/`cancelPitCall`, Timer/Flags) raus |
| Ändern | `src/geo.js` | `structuralRaceKey` raus (einziger Verbraucher war das Display-Downlink-Dedupe) |
| Ändern | `index.html` | `pitCallBtn`, `oledPageSelect`, Settings-Zeile `setDisplayUpdateMs` raus |
| Ändern | `src/app-init.js` | Imports/Bindings für Pit-Call, Display-Intervall, OLED-Seitenauswahl raus |
| Ändern | `src/settings-ui.js`, `src/settings.js` | `displayUpdateMs`-Handling + Suchindex-Zeile „OLED-Update Intervall" raus |
| Ändern | `src/store.js` | Defaults `displayUpdateMs`, `oledPage` raus |
| Ändern | `src/kart-equip.js` | Display-Toggle aus Dialog + Sektion + `_EQUIP_TOGGLES`; `applyEquipToEspPanel` verliert den `espPageMs`-Zweig |
| Ändern | `src/kart-roster.js` | `equipDefaults`/`equipFor` nur noch `{ rpm }` |
| Ändern | `src/kart-settings-window.js` | Zeile „OLED Seitenwechsel" (`espPageMs`) + `page_ms` im Save-Payload raus |
| Ändern | `src/rasicross.js` | `pitCall`-Beep-Eintrag raus |
| Ändern | CSS (`pitwall.css` u.a.) | verwaiste `pitcall`-Styles raus |

**Bleibt unangetastet:** `k.display` (UI-Lerp-Zustand, recording.js —
nichts mit OLED zu tun), `liveDelta`-Berechnung (füttert das Leaderboard),
alle Uplink-Telemetrie und das `config`-Downlink-Protokoll.

## Tests

- `test/geo.test.js`: `structuralRaceKey`-Tests raus.
- `test/kart-roster.test.js`: Equip-Erwartungen auf `{ rpm }` anpassen.
- `test/test_modular.py`: `DisplayPagesModule` raus; Modul-Listen ohne
  `display_pages.py`/`ssd1306.py` prüfen.
- e2e-Specs: Referenzen auf entfernte DOM-Elemente anpassen.
- Baselines (Stand Phase 57: npm 226 / py 65) sinken entsprechend — vor und
  nach der Phase frisch messen.

## Kompatibilität

- **Alte Sender-Firmware + neues Dashboard:** funkt normal weiter; das alte
  OLED bekommt nur keine `display`-Pakete mehr (Anzeige friert ein, bis neu
  geflasht wird). Kein Protokollbruch im Uplink.
- **Roster-Saves:** Alte Metas mit `equip.display` bleiben ladbar — das Feld
  wird beim Lesen ignoriert, `SAVE_KEY`/Format unverändert.
- **Flash-Prozedur:** unverändert per mpy-cross (app.mpy + Stub, siehe
  `esp_libs/README.md`).

## Nicht-Ziele

- Kein Ersatz-Signalweg ans Kart (LED/Buzzer) — bei Bedarf eigene Phase.
- Keine Umbauten an `liveDelta`/Leaderboard.
- Keine Änderung an Datenformat-Versionen (REC_VERSION, SAVE_KEY).
