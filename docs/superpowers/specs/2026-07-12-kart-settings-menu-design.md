# Kart-Einstellungen im Karts-Tab — Design (Phase 47)

Kart-spezifische Einstellungen (IMU-Kalibrierung + ESP32-Sender-Konfig) sind
nur noch im Karts-Tab konfigurierbar — über ein Kart-Dropdown mit
Einstellungs-Panel darunter. Der Einstellungen-Tab enthält danach
ausschließlich App-Einstellungen (Anzeige, Fahrdynamik-Tuning, Karten,
Daten/Backup, Bridge).

Baut auf Phase 46 (Karts-Tab) auf; keine Firmware- oder Datenformat-Änderung.

## Ist-Zustand

| Einstellung | Gruppe heute | Gilt für | Ablage |
|---|---|---|---|
| Max Speed, Max RPM, RPM-Warnung, G-Skala, Mindest-Rundenzeit | Dashboard | App (Anzeige) | `state.settings` |
| Gx/Gy-Nullpunkt, Roll-Null, Invert-/Swap-Toggles | Sensorik & Fahrdynamik | **aktives Kart** (implizit) | `kartCalFor(mac)` im `SAVE_KEY` |
| Drift-Empfindlichkeit, Drift Min-Tempo, Umkipp-Schwelle | Sensorik & Fahrdynamik | App (global) | `state.settings` |
| ESP-Sender-Konfig (Max/Warn RPM, Radumfang, Übersetzung, Akku, RPM-Filter, OLED-Seitenwechsel) | ESP32 / Hardware | **verbundenes Kart** | auf dem Kart (NVS); Formular spiegelt via `config_get`/`config_ack` |
| OLED-Update Intervall (Bridge-Display) | ESP32 / Hardware | App/Bridge (global) | `state.settings.displayUpdateMs` |

Problem: Kalibrierung und ESP-Konfig wirken auf das *aktive* Kart, stehen aber
im Einstellungen-Tab zwischen App-Einstellungen — bei mehreren Karts ist
unklar, welches Kart man gerade konfiguriert.

## Entscheidungen

- **Umfang:** Sensorik-Kalibrierung + ESP32-Sender-Konfig ziehen um.
  Dashboard-Limits bleiben App-Anzeige-Einstellungen (bewusst nicht pro Kart).
- **UI-Form:** Dropdown + Panel unter den Kart-Karten (nicht pro Karte
  aufklappbar). Dropdown listet alle Roster-Karts, Offline-Karts mit
  „(offline)“-Suffix; vorbelegt mit dem aktiven Kart.
- **Explizites Ziel-Kart:** alle Aktionen (Nullpunkt, Toggles, „An ESP32
  senden“, `config_get`) wirken auf das **im Dropdown gewählte** Kart — nicht
  mehr implizit auf das aktive. `bridgeSend`-Payloads setzen `target_mac`
  explizit (der Default „aktives Kart“ aus rasicross.js greift sonst).
- **Kalibrierungs-Zusammenfassung auf den Kart-Karten bleibt** (Anzeige +
  Reset); das neue Panel ist der Ort zum Bearbeiten.
- **Keine Persistenz-Änderung:** Kalibrierung bleibt in `kartCalFor(mac)`
  (`SAVE_KEY` unverändert), ESP-Konfig bleibt auf dem Kart gespeichert.

## UI

**Karts-Tab, neuer Abschnitt „Kart-Einstellungen“** unter der Kartenliste:

```
── Kart-Einstellungen ─────────────────────
Kart: [Kart 1 ▾]
▸ Kalibrierung      (Gx/Gy-Offset, Toggles, Nullpunkt/Reset/Roll nullen)
▸ ESP32 / Hardware  (Sender-Formular + „An ESP32 senden“)
```

**Panel Kalibrierung** (zieht 1:1 aus „Sensorik & Fahrdynamik“ um, IDs
bleiben: `gxOffsetText`, `gyOffsetText`, `setInvertGx` … `setInvertRollRate`,
`zeroImuBtn`, `resetImuBtn`, `zeroRollBtn`):

- Liest/schreibt `kartCalFor(mac)` des gewählten Karts (funktioniert auch
  offline — Toggles/Reset sind reine Persistenz).
- „Nullpunkt setzen“ und „Roll nullen“ brauchen Live-Daten: Samples kommen aus
  `state.karts.get(mac).raw` des **gewählten** Karts; Buttons sind deaktiviert
  (mit Hinweis), wenn das Kart nicht online ist. `imu_calibrate` geht mit
  `target_mac` raus.

**Panel ESP32 / Hardware** (Formular zieht 1:1 um, IDs bleiben: `espMaxRpm` …
`espPageMs`, `espSendBtn`, `espSendStatus`):

- Dropdown-Wechsel bei verbundener Bridge → `config_get` mit `target_mac`
  des gewählten Karts; `applyEspConfigAck` füllt das Formular nur noch, wenn
  `from_mac` zum gewählten Kart passt (sonst würde ein Ack eines anderen
  Karts das Formular überschreiben).
- „An ESP32 senden“ sendet mit `target_mac`; Offline/nicht verbunden →
  Felder ausgegraut + Hinweis „Kart nicht verbunden“.
- `batt_cells`-Übernahme (`k.batt.cells`) gilt dem gewählten Kart.

**Einstellungen-Tab danach:**

| Gruppe | Änderung |
|---|---|
| Dashboard | unverändert |
| Sensorik & Fahrdynamik → **„Fahrdynamik“** | nur noch Drift-Empfindlichkeit, Drift Min-Tempo, Umkipp-Schwelle |
| ESP32 / Hardware → **„Bridge“** | nur noch OLED-Update Intervall (`setDisplayUpdateMs`) |
| 3D-Modell, Karten-Hintergrund, Daten & Backup | unverändert |

## Module & Verdrahtung

**Neu: `src/kart-settings.js`** (ESM, nur Deklarationen auf Top-Level; eigenes
Modul statt Anbau an karts-page.js — Zeilen-Gate):

- `renderKartSettings()` — Dropdown aus `kartRosterMacs()` + Panels füllen;
  gerufen von `renderKartsTab()` und bei Dropdown-Wechsel. Tipp-Schutz wie in
  karts-page.js (kein Rebuild, solange ein Panel-Input Fokus hat).
- `selectedKartMac()` — Accessor für Handler (Fallback: aktives Kart).
- Handler: Kalibrier-Toggles, Nullpunkt/Reset/Roll-Null, ESP-Senden,
  `config_get`-Trigger. Ziehen aus app-init.js/settings-ui.js um.

**Bestandsmodule:**

| Modul | Änderung |
|---|---|
| `index.html` | Kalibrier-Block + ESP-Formular aus den Settings-Gruppen in `#tab-karts` verschieben (IDs unverändert); Gruppen „Fahrdynamik“/„Bridge“ übrig; Nav-Beschriftungen anpassen |
| `app-init.js` | `zeroImuBtn`/`resetImuBtn`/`zeroRollBtn`/`espSendBtn`-Handler raus (→ kart-settings.js) |
| `settings-ui.js` | Kalibrier-Anteile aus `loadSettingsToUi()`/`saveSettingsFromUi()` raus (kein `activeKart()`-Zugriff mehr) |
| `esp-config.js` | `applyEspConfigAck` prüft `from_mac` gegen `selectedKartMac()` |
| `karts-page.js` | ruft `renderKartSettings()` mit auf |
| `settings.js` | `SETTINGS_INDEX`: verschobene Einträge raus; Gruppen-Keys `sensorik`→`fahrdynamik`, `hardware`→`bridge` |
| `src/app.js` | `import './kart-settings.js'` in der Import-Kette |

**Nicht-Ziele:** keine Firmware-Änderung (target_mac-Routing existiert),
keine per-Kart-Dashboard-Limits, kein Umbau der Kart-Karten, keine
`SAVE_KEY`/`REC_VERSION`-Änderung.

## Fehlerfälle

- Gewähltes Kart geht offline → Live-Buttons deaktivieren beim nächsten
  Render (1-Hz-Refresh des Karts-Tabs), Persistenz-Felder bleiben nutzbar.
- Gewähltes Kart wird vergessen → Dropdown fällt auf das aktive Kart zurück.
- `config_ack` eines fremden Karts → ignoriert (from_mac-Prüfung).
- Leeres Roster → Abschnitt zeigt „Noch keine Karts“ statt Dropdown.

## Tests & Gates

**Unit (node:test):** falls Auswahl-/Fallback-Logik als pure Funktion
extrahiert wird (Dropdown-Fallback aktiv/erstes Kart, offline-Erkennung) —
sonst entfällt Unit, Verhalten läuft über Smoke.

**Smoke (Playwright, `e2e/karts.spec.js` erweitern):**
- Demo starten → Karts-Tab: Dropdown listet Demo-Karts, vorbelegt aktives.
- Kalibrier-Toggle bei gewähltem Nicht-aktiv-Kart ändert dessen Flags
  (Karten-Zusammenfassung zeigt es), aktives Kart unverändert.
- Einstellungen-Tab: kein IMU-Block, keine ESP-Gruppe mehr; „Fahrdynamik“
  und „Bridge“ vorhanden; Settings-Suche findet verschobene Felder nicht mehr.
- Bestehende Smoke-Tests bleiben grün.

**Gates:** `npm test` grün, `npm run lint` 0, `npm run test:e2e` grün,
Sichtprüfung Portable-EXE. Hardware-Test (echtes `config_get`-Routing an
zweites Kart) → User-Checkliste.

## Phasen-Einordnung

- Phase 46 (Karts-Tab): Voraussetzung, gemerged (PR #67/#68).
- **Phase 47 (dieser Entwurf): Kart-Einstellungen im Karts-Tab.**
- Unabhängig von künftigen Firmware-Phasen; rein Dashboard-seitig.
