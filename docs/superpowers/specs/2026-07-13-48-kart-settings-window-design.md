# Kart-Einstellungs-Fenster + Lebens-Statistik — Design (Phase 48)

Jede Kart-Karte bekommt einen „⚙ Einstellungen“-Button, der ein **echtes
Betriebssystem-Fenster** mit allen Einstellungen dieses Karts öffnet (Name,
freie Farbe, Kalibrierung, ESP-Konfig, Wartung, Gefahrenzone). Die Karte
selbst wird reine Status-Anzeige und zeigt zusätzlich neue **Lebens-
Statistiken** (gefahrene km, Ø-Geschwindigkeit, Top-Speed, Fahrzeit). Der
Dropdown-Abschnitt „Kart-Einstellungen“ aus Phase 47 entfällt ersatzlos.

Baut auf Phase 47 (PR #74) auf; keine Firmware-Änderung, kein
`SAVE_KEY`/`REC_VERSION`-Bump.

## Ist-Zustand (nach Phase 47)

- Kart-Karte: Inline-Namensfeld, 8 feste Palette-Swatches, Live-Daten,
  Motorstunden + Wartungsaktionen, Kalibrier-Zusammenfassung + Reset,
  „Kart vergessen“.
- Unter den Karten: `#kartSettingsSection` mit Kart-Dropdown + Panels
  (Kalibrierung, ESP32) — Handler in `src/kart-settings.js`.
- Es gibt keine per-Kart-Distanz-/Tempo-Statistik; nur Runden in
  gespeicherten Rennen tragen `distanceM`/`maxSpeed`.
- Electron: eine einzige BrowserWindow; State, Telemetrie und `bridgeSend`
  leben im Haupt-Renderer; `serial:line` geht nur ans Hauptfenster.

## Entscheidungen

- **Echtes OS-Fenster, nicht Modal** — verschiebbar, zweiter Monitor.
- **Ansatz A:** `window.open()` aus dem Haupt-Renderer; das Kind-Fenster ist
  same-origin, der Haupt-Renderer baut dessen DOM auf und bindet alle Handler
  selbst. **Kein IPC, kein State-Sync, kein zweiter Vite-Einstieg.**
- **Mehrere Fenster gleichzeitig** erlaubt (eines pro Kart, `Map<mac, win>`;
  zweiter ⚙-Klick desselben Karts fokussiert das bestehende Fenster).
- **Karte = Status, Fenster = Bearbeiten:** Name-Input, Swatches, Wartungs-
  und Reset-/Vergessen-Aktionen ziehen von der Karte ins Fenster um.
- **Freie Farbe:** `<input type="color">` + die 5 Palette-Farben als
  Schnellwahl. Ablage unverändert `meta.color` (beliebiger Hex-Wert wirkt
  überall via `--kart`).
- **Lebens-Zähler statt Renn-Aggregat:** neues persistentes Stats-Objekt pro
  Kart (wie Motorstunden), zählt jede Fahrt — auch ohne Rennen.
- **Ack-Zustellung statt Ack-Filter:** `config_ack` wird per `from_mac` dem
  passenden offenen Fenster zugestellt (Phase-47-Filter wird zum Router).
- **Dropdown-Abschnitt aus Phase 47 entfällt**; die Settings-Tab-Bereinigung
  (Gruppen `fahrdynamik`/`bridge`) bleibt.

## UI

**Kart-Karte (nur noch Status + Einstieg):**

```
● Kart 2                    [DEMO]   [⚙ Einstellungen]
AA:BB:CC:DD:EE:02
12Hz · -61dBm · Alter 0.3s · Akku 87%
Motorlaufzeit 12,4 h · Seit Wartung 3,1 h      [🔧 Wartung fällig]
Gefahren 148,2 km · Ø 24,3 km/h · Top 61,8 km/h · Fahrzeit 6,1 h
Gx/Gy-Offset 0.12/-0.04 · Roll-Null 1,3° · Achsen: Gx-Inv
```

- Klick auf die Karte wechselt weiter das aktive Kart; der ⚙-Button stoppt
  die Klick-Propagation.
- Kein Input, keine Swatches, keine Aktions-Buttons mehr auf der Karte
  (Wartungs-Warnung 🔧 bleibt als Anzeige).

**Einstellungs-Fenster** (Titel = Kart-Name, ~460×720, scrollbar; Inhalt
v. o. n. u.):

1. **Identität** — Namensfeld (maxlength 20, wirkt live auf Chip-Leiste/
   Karte/Fenstertitel) + Farbwähler (`input type="color"`) + 5 Palette-
   Schnellwahl-Punkte.
2. **Kalibrierung** — Panel-Inhalt aus Phase 47 (Gx/Gy-Offsets, 5 Toggles,
   Nullpunkt setzen / Zurücksetzen / Roll nullen) plus „Kalibrierung auf
   Werkswerte zurücksetzen“ (bisher Karte).
3. **ESP32 / Sender** — 13-Felder-Formular + „An ESP32 senden“ + Status;
   alle Sendungen mit explizitem `target_mac` dieses Karts (Phase-47-Regel).
4. **Wartung** — Intervall (h) + „Wartung erledigt“.
5. **Gefahrenzone** — „Statistik zurücksetzen“ (Odometer/Top-Speed/Fahrzeit
   auf 0, mit Bestätigung) und „Kart vergessen“ (mit Bestätigung; schließt
   das Fenster).

ESP-Feldwerte werden weiterhin **nie vom Refresh überschrieben** (nur
`config_ack` füllt sie); Fokus-Schutz gilt pro Fenster.

## Lebens-Statistik (`src/kart-stats.js`)

- Stats-Objekt pro Kart: `{ odoM, moveMs, topKmh }`; Defaults 0.
- `statsTick(stats, speedKmh, dtMs)` (pur): bei `speedKmh >= 3` wird
  `odoM += speed * dt` integriert und `moveMs += dt`; `topKmh` als Maximum.
  `dtMs > 5000` (Verbindungslücke/Reconnect) wird verworfen — sonst springt
  das Odometer.
- Abgeleitet bei Anzeige: `Ø km/h = (odoM/1000) / (moveMs/3 600 000)`
  (0, solange `moveMs = 0`); Formatierung (`km`, `h`) als pure Helfer.
- Einhängepunkt: `processTelemetry()` (telemetry.js) pro Paket mit dt aus
  `lastPacketAt`.
- Persistenz: neue Ablage `_persistedKarts.stats` in store.js — gleiche
  Mechanik wie `eng` (Motorstunden): Demo-Karts (`DE:MO:*`) session-only,
  `rasiPersistForget` löscht mit, „Karts zurücksetzen“ erhält sie. Alte
  Speicherstände ohne `stats` laden mit Defaults — **kein `SAVE_KEY`-Bump**.
- Accessor `kartStatsFor(mac)` analog `kartEngineFor` (live-Bucket bevorzugt,
  sonst persistierte Ablage).

## Fenster-Verwaltung (`src/kart-settings-window.js`, ersetzt kart-settings.js)

- `openKartSettings(mac)` — `window.open('', …)`; Rückgabe `null` (Popup-
  Blocker im Browser-Dev) → `rcToast`-Hinweis. Sonst: Styles des
  Hauptdokuments ins Kind klonen (`<style>`/`<link>`-Knoten), Body-Klassen
  (Theme) spiegeln, die 5 Blöcke per DOM-API aufbauen (CSP-konform: keine
  Inline-Handler, kein `innerHTML` mit Skripten), Handler binden. Eintrag in
  `Map<mac, win>`; existiert schon ein offenes Fenster → nur `focus()`.
- `refreshKartSettingsWindows()` — vom 1-Hz-Refresh (`renderKartsTab`)
  gerufen: geschlossene Fenster aus der Map räumen, Offsets/Online-Status/
  Disable-Zustände je Fenster aktualisieren; Fokus-Schutz pro Fenster
  (aktives INPUT/SELECT im Kind → dieses Fenster überspringen).
- `routeConfigAck(d)` — ersetzt den Phase-47-Filter: Ack mit `from_mac` →
  Formular des Fensters dieses Karts füllen; ohne `from_mac` (alte Firmware)
  → Fenster, das zuletzt `config_get`/`config` gesendet hat. Kein passendes
  Fenster → Ack verwerfen. `applyEspConfigAck` (esp-config.js) bekommt dafür
  ein Dokument-/Root-Argument statt implizit `document`.
- `closeAllKartSettings()` — bei `beforeunload` des Hauptfensters alle
  Kind-Fenster schließen (sonst bleiben tote Fenster ohne Logik zurück);
  ebenso Fenster schließen, deren Kart aus dem Roster verschwindet.
- Aktionen im Fenster nutzen die bestehenden Muster: `updateKartMeta`
  (Name/Farbe → auch Chip-Leiste + Karte neu rendern), `kartCalFor`,
  `kartEngineFor`, `_sendToSelected`-Äquivalent mit festem `mac` des
  Fensters, Nullpunkt-Sampling wie Phase 47 mit Busy-Flag **pro Fenster**.

## Module & Verdrahtung

| Modul | Änderung |
|---|---|
| `src/kart-stats.js` | **neu**: pure Tick-/Format-Helfer + Defaults |
| `src/kart-settings-window.js` | **neu**: Fenster-Map, DOM-Aufbau, Handler, Ack-Routing |
| `src/kart-settings.js` | **entfällt** (Dropdown-UI ersetzt) |
| `src/kart-roster.js` | `resolveSelectedMac` entfällt (kein Dropdown mehr) |
| `index.html` | `#kartSettingsSection` inkl. Panels raus (IDs leben nur noch in den Kind-Fenstern) |
| `src/karts-page.js` | Karte ohne Inputs/Swatches/Aktionen, + ⚙-Button + Stats-Zeile; ruft `refreshKartSettingsWindows()` statt `renderKartSettings()` |
| `src/store.js` | `_persistedKarts.stats` + `kartStatsFor` + Save/Load/Forget |
| `src/kart-registry.js` | Live-Bucket bekommt `stats`-Objekt (Anlage beim Erstkontakt) |
| `src/telemetry.js` | `statsTick`-Aufruf pro Paket; `config_ack` → `routeConfigAck` |
| `src/esp-config.js` | `applyEspConfigAck(d, root)` — Feld-Lookup im übergebenen Dokument |
| `src/app.js` / `src/app-init.js` | Import-Kette/`initKartSettings` auf das neue Modul umstellen |
| `main.js` | `setWindowOpenHandler`: Kind-Fenster ~460×720, ohne Menüleiste, App-Icon |

**Nicht-Ziele:** kein IPC-/BroadcastChannel-Sync, kein zweiter Vite-
Einstieg, keine Firmware-Änderung, kein `SAVE_KEY`/`REC_VERSION`-Bump,
keine per-Kart-Dashboard-Limits.

## Fehlerfälle

- Fenster vom Nutzer geschlossen → Map-Aufräumen beim nächsten Refresh.
- Hauptfenster schließt/lädt neu → `closeAllKartSettings()`.
- Kart wird vergessen (im Fenster oder anderweitig) / Demo endet → Fenster
  des Karts schließt.
- Offline-Kart: Name/Farbe/Toggles/Wartung nutzbar; Nullpunkt/Roll nullen/
  ESP-Senden deaktiviert mit Hinweis (Phase-47-Verhalten).
- Popup-Blocker (nur Browser-Dev): Toast „Popup erlauben“.
- Zwei Fenster, zwei Nullpunkt-Messungen parallel: erlaubt (Busy/Sampling
  pro Fenster).
- `config_ack` ohne passendes Fenster → verworfen (kein globales Formular
  mehr).
- dt-Lücken > 5 s zählen nicht ins Odometer (Reconnect-Schutz).

## Tests & Gates

**Unit (node:test):**
- `kart-stats.js`: Integration/Schwelle (< 3 km/h zählt nicht), dt-Lücken-
  Verwurf, Top-Speed, Ø-Ableitung, Formatierung.
- Ack-Routing-Entscheidung (welche MAC bekommt den Ack) als pure Funktion.
- store-Persistenz-Erwartungen (stats in Save/Load/Forget) analog eng.

**Smoke (Playwright, `e2e/karts.spec.js` umbauen):**
- ⚙-Klick öffnet Fenster (`context.waitForEvent('page')`); Fenster zeigt
  Namensfeld + Kalibrier-Toggles + ESP-Formular.
- Umbenennen im Fenster wirkt auf Chip-Leiste; Farbwechsel setzt `--kart`
  der Karte.
- Toggle im Fenster von Kart B ändert nur Kart B (aktives Kart unverändert).
- Karte enthält keine Edit-Elemente mehr (kein `.kc-name-input`, keine
  Swatches); Stats-Zeile vorhanden.
- Die zwei Dropdown-Tests aus Phase 47 Task 7 werden durch die Fenster-Tests
  ersetzt.

**Gates:** `npm test` grün, `npm run lint` 0, `npm run test:e2e` grün,
Python-Suite unverändert (`OK`), Sichtprüfung Portable-EXE (Fenster-Layout,
Light/Dark). Hardware-Checkliste: Zwei-Kart-Routing (`target_mac`,
`config_get`-Roundtrip) wie Phase 47, zusätzlich Odometer-Plausibilität nach
einer echten Fahrt.

## Phasen-Einordnung

- Phase 47 (Dropdown-Panels, PR #74, offen): Voraussetzung — Panels/Handler
  ziehen von dort ins Fenster um. Phase 48 als **Stacked Branch** auf
  `feat/phase-47-kart-settings`; nach Merge von #74 Child-PR retargeten
  (Lektion Phase 46).
- **Phase 48 (dieser Entwurf): Einstellungs-Fenster pro Kart + Lebens-
  Statistik.**
- Rein Dashboard-seitig; unabhängig von künftigen Firmware-Phasen.
