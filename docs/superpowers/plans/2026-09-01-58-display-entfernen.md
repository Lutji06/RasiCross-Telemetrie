# Phase 58 — ESP-Bildschirm-Funktion entfernen — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Die OLED-Bildschirm-Funktion beider ESPs (Kart-Sender + Bridge) inkl. Boxenruf und aller Software-Einstellmöglichkeiten ersatzlos entfernen.

**Architecture:** Reine Entfernung ohne Ersatz: 3 ESP-Dateien werden gelöscht, sender.py/bridge.py/config_store.py verlieren ihre Display-Zweige, die Electron-App verliert Display-Downlink (`display`/`pit_call`), OLED-Einstellungen und das `display`-Ausstattungsflag (Phase 57 → nur noch `{rpm}`). Uplink-Telemetrie und `config`/`imu_calibrate`/`config_get`-Downlink bleiben unverändert.

**Tech Stack:** MicroPython (ESP32), Electron/Vanilla-ESM, node:test, Python unittest, Playwright (e2e).

**Spec:** `docs/superpowers/specs/2026-09-01-58-display-entfernen-design.md`

## Global Constraints

- Branch: `feat/phase-58-display-entfernen`, abgezweigt von `feat/phase-57-kart-ausstattung` (stacked PR — Merge-Reihenfolge beachten).
- Alle Dateien sind **CRLF**: vor jedem Edit die Zielregion frisch lesen und den Anker aus dem frischen Read kopieren; Zeilennummern in diesem Plan sind indikativ.
- Verifikation mit dem **Grep-Tool** (nicht Shell-grep); `__pycache__` vor jedem `git status` löschen.
- Git: `git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" …`; keine Anführungszeichen in Commit-Messages; Trailer (Co-Authored-By + Claude-Session) ans Ende jedes Commits.
- Nie `.claude/` oder `graphify-out/` committen; Plan-Doc + Spec-Addendum erst im letzten Task.
- Baselines vor Phase 58 (frisch messen in Task 1): `npm test` = 226, Python unittest = 65/OK, `npm run lint` = 0, `npm run lint:css` = OK. Nach Phase 58 sinken die JS/Py-Testzahlen (entfernte Tests) — neue Zahlen im Abschlusstask notieren.
- **Bleibt unangetastet:** `k.display` (UI-Lerp-Zustand, recording.js/facade-free.test.js), `liveDelta`-Berechnung (live-ui.js), REC_VERSION/SAVE_KEY, ESP-NOW-Uplink.

## Spec-Addendum (in Task 9 in die Spec eintragen)

`Config.MAX_RPM`/`Config.RPM_WARN` (+ `BLINK_MS`) auf dem Sender speisen ausschließlich das OLED-Shift-Light (`display_pages.py` L140/294/341/349-351 — einzige Verbraucher). Ohne Display wären „Max RPM (Sender)"/„Warn RPM (Sender)" tote Konfiguration mit irreführender Beschreibung. Sie werden daher mit entfernt: Config-Werte, `max_rpm`/`warn_rpm` im Config-Protokoll (`mr`/`wr`-Ack-Keys), Formularzeilen `espMaxRpm`/`espWarnRpm`. Die App-eigenen Anzeige-Settings `maxRpm`/`rpmWarning` (Gauges) bleiben. Alte Firmware, die `mr`/`wr` weiter ackt, ist harmlos — `applyEspConfigAck` mappt nur bekannte Keys.

## File Structure

| Action | Path | Responsibility |
|---|---|---|
| Delete | `esp_libs/display_pages.py` | OLED-Display + 5 Seiten |
| Delete | `esp_libs/ssd1306.py` | OLED-Treiber |
| Delete | `esp_libs/oled_diagnose.py` | OLED/I2C-Diagnose-Tool |
| Modify | `sender.py` | Display-Import/-Init/-Update, `display`/`pit_call`-Handling raus |
| Modify | `esp_libs/config_store.py` | OLED_MS/PAGE_MS/BLINK_MS/MAX_RPM/RPM_WARN, `page_ms`/`max_rpm`/`warn_rpm` + Ack-Keys raus |
| Modify | `bridge.py` | BridgeDisplay, OLED-Config, Forward-Liste, Stats-Displayfelder raus |
| Modify | `test/test_modular.py` | DisplayPagesModule raus, Orchestrator-Test behalten |
| Modify | `esp_libs/README.md`, `docs/VERKABELUNG.md` | OLED-Doku raus |
| Modify | `src/pit-wall.js` | Display-Downlink + Pit-Call komplett raus |
| Modify | `src/geo.js`, `test/geo.test.js` | `structuralRaceKey` + Tests raus |
| Modify | `src/app.js`, `e2e/demo.spec.js` | RasiTest-Brücke + e2e-Test für `buildRaceDataForKart` raus |
| Modify | `src/app-init.js`, `src/settings-ui.js`, `src/settings.js`, `src/store.js` | OLED-Seitenauswahl, `displayUpdateMs`, `oledPage` raus |
| Modify | `index.html`, `src/styles/components.css`, `src/rasicross.js` | Buttons/Select/Bridge-Sektion, pitcall-CSS, pitCall-Beep raus |
| Modify | `src/kart-roster.js`, `src/kart-equip.js`, `src/kart-settings-window.js`, `src/esp-config.js`, `test/kart-roster.test.js` | Ausstattung → `{rpm}`, espPageMs/espMaxRpm/espWarnRpm raus |
| Modify | `docs/superpowers/specs/2026-09-01-58-display-entfernen-design.md` | Addendum MAX_RPM/RPM_WARN |

Task-Reihenfolge: 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 (strikt sequenziell; ESP zuerst, dann Software, dann Gesamtverifikation).

---

### Task 1: Branch + Baselines

- [ ] **Step 1:** Branch anlegen: `git -C ... checkout -b feat/phase-58-display-entfernen` (von `feat/phase-57-kart-ausstattung`).
- [ ] **Step 2:** Baselines messen und notieren: `npm test` (erwartet 226 pass), `python -m unittest discover -s test -p "test_*.py"` (erwartet `Ran 65 tests` OK; ggf. `py -3`), `npm run lint`, `npm run lint:css`. `__pycache__` danach löschen.
- [ ] **Step 3:** Kein Commit (nur Setup).

### Task 2: sender.py — Display raus

**Files:** Modify: `sender.py`

**Interfaces:** Produces: sender.py ohne jede `display`-Referenz; Top-Level-Namen bleiben exakt `{RPMCounter, Battery, StatusLED, main}` (test_modular.py-Kontrakt).

- [ ] **Step 1:** Header (L4-26) anpassen: In der Sensoren-Zeile `SSD1306 OLED (5 Seiten + Pit-Call Override).` entfernen (Zeile endet nach `GPS (NMEA)`); Pin-Zeile `#    OLED      → I2C  SDA=21  SCL=22  (Adresse 0x3C)` löschen; in „Was ist neu": `Sensors / Display / Link / App` → `Sensors / Link / App` und die Zeile `#    • Display-Pages als Funktionen registriert (statt if/elif)` löschen.
- [ ] **Step 2:** Import löschen (L43-44):
```python
from display_pages import (Display, page_speed, page_race, page_rpm,
                           page_delta, page_diag)
```
- [ ] **Step 3:** In `main()`: Kommentar `# I2C-Bus für IMU + OLED gemeinsam` → `# I2C-Bus für die IMU`; Zeile `display     = Display(i2c)` löschen; den kompletten Block „Display-Pages registrieren" (Kommentar + 5 `display.register_page(...)`-Zeilen, L312-318) löschen; Zeile `race_data = None` und den Kommentarblock dazu prüfen — `race_data` wird nach diesem Task nur noch im gelöschten Code benutzt → Zeile löschen.
- [ ] **Step 4:** Rückkanal-Branches löschen: den ganzen `if kind == "display":`-Block (L353-360, inkl. `race_data = data` … `display.set_forced_page(page_choice)`) und den ganzen `elif kind == "pit_call":`-Block (L367-375). Der erste verbleibende Branch wird `if kind == "config":` (aus `elif` wird `if`).
- [ ] **Step 5:** Display-Update-Block löschen (L443-455): Kommentar `# Display-Update` + kompletter `display.update({...})`-Aufruf. Der `# LED`-Block bleibt.
- [ ] **Step 6:** Verify: Grep-Tool `display|Display|pit_call|race_data` in `sender.py` → 0 Treffer; `python -m py_compile sender.py`.
- [ ] **Step 7:** Commit: `git add sender.py` + `git commit -m "feat(esp): sender ohne OLED-Display und Pit-Call (Phase 58)"` (+ Trailer).

### Task 3: config_store.py — Display-/Shift-Light-Config raus

**Files:** Modify: `esp_libs/config_store.py`

**Interfaces:** Produces: `config_snapshot`/`_ACK_KEYS`/`apply_config` ohne `page_ms`, `max_rpm`, `warn_rpm`; Config ohne `OLED_MS`, `PAGE_MS`, `BLINK_MS`, `MAX_RPM`, `RPM_WARN`. `LED_BLINK_MS` **bleibt** (Status-LED).

- [ ] **Step 1:** Timing-Block (L61-63): die drei Zeilen `OLED_MS`, `PAGE_MS`, `BLINK_MS` löschen (`LED_BLINK_MS` bleibt).
- [ ] **Step 2:** Block „Drehzahl-Grenzen" (L69-71) komplett löschen (Kommentar + `MAX_RPM` + `RPM_WARN`).
- [ ] **Step 3:** `DEBUG_TOPICS` (L94): `("init", "config", "pit_call", "display", "recv")` → `("init", "config", "recv")`.
- [ ] **Step 4:** `config_snapshot` (L108-122): Einträge `"max_rpm"`, `"warn_rpm"`, `"page_ms"` löschen.
- [ ] **Step 5:** `_ACK_KEYS` (L128-134): Einträge `"max_rpm": "mr"`, `"warn_rpm": "wr"`, `"page_ms": "pm"` löschen.
- [ ] **Step 6:** `apply_config`: die `if "max_rpm" in cfg:`- und `if "warn_rpm" in cfg:`-Blöcke (um L205-213) und den `if "page_ms" in cfg:`-Block (L274-278) löschen.
- [ ] **Step 7:** Verify: Grep `page_ms|OLED_MS|PAGE_MS|BLINK_MS \|MAX_RPM|RPM_WARN|pit_call|"display"` in `esp_libs/config_store.py` → nur noch `LED_BLINK_MS`-Treffer; `python -m py_compile esp_libs/config_store.py`; Grep `Config.MAX_RPM|Config.RPM_WARN|Config.BLINK_MS|Config.PAGE_MS|Config.OLED_MS` über `*.py` → 0 Treffer außerhalb gelöschter Dateien.
- [ ] **Step 8:** Commit: `feat(esp): Display-Timing und Shift-Light-Config entfernt (Phase 58)`.

### Task 4: bridge.py — BridgeDisplay raus

**Files:** Modify: `bridge.py`

- [ ] **Step 1:** Header: `Leitet Steuerpakete (Display,\n#            Config, Pit-Call) ...` → `Leitet Steuerpakete (Config, IMU-Kalibrierung) vom Dashboard zurück an den Kart.`; Pin-Zeile `#    OLED      → I2C  SDA=21  SCL=22  (Adresse 0x3C)` löschen; „Was ist neu"-Zeilen zu Pit-Call-Timeout (L15-16) und `OLED zeigt Channel...` (L19) löschen; `Stats / Display / Bridge / I/O` → `Stats / Bridge / I/O`.
- [ ] **Step 2:** `ssd1306`-Import-Block (L49-53, `try: import ssd1306 ... _HAS_OLED = False`) löschen. Danach `from machine import Pin, I2C, WDT` → `from machine import Pin, WDT` und im Fallback `from machine import Pin, I2C` → `from machine import Pin` (I2C wird nur vom OLED benutzt).
- [ ] **Step 3:** Config: OLED-Block (L75-80: `# OLED`, `OLED_ENABLED`, `OLED_SDA`, `OLED_SCL`, `OLED_REFRESH_MS`, `PIT_MSG_DURATION_MS`) löschen.
- [ ] **Step 4:** `Stats.on_packet`: Block `# Live-Werte für Display` — die `if "speed" in data:`-, `if "rpm" in data:`- und `if "gps_fix" in data:`-Zweige löschen (**`if "rssi" in data:` bleibt** — `last_rssi` speist `_send_status`). Init-Zeilen `self.last_speed`, `self.last_rpm`, `self.gps_fix` in `Stats.__init__` löschen.
- [ ] **Step 5:** Komplette Klasse `BridgeDisplay` (L220-326 inkl. Abschnittskommentar `# ── OLED-Display ──…`) löschen.
- [ ] **Step 6:** `Bridge.__init__`: `# Display + LED` → `# Status-LED`; Zeile `self.display = BridgeDisplay()` löschen; im Boot-`jprint` die Zeile `"oled":           self.display._ok,` löschen.
- [ ] **Step 7:** `_update_status`: Zeilen `host_st = self.karts.get(self.kart_host)`, `kart_mac_str = (...)` und `self.display.update(host_st, kart_mac_str, len(self.karts), usb_alive)` löschen; Abschnittskommentar `(Display + LED + Stats-Tick)` → `(LED + Stats-Tick)`. Kommentar bei `self.kart_host = host` (L591) `(Legacy/Display)` → `(Legacy-Felder)` und L423 analog.
- [ ] **Step 8:** Forward-Liste (L706): `if t in ("display", "config", "pit_call", "imu_calibrate", "config_get"):` → `if t in ("config", "imu_calibrate", "config_get"):`.
- [ ] **Step 9:** `_forward_to_kart`: den Kommentar `# Hinweis ans Dashboard ...` + `# Bridge-Display informieren bei Pit-Call` und den ganzen `if kind == "pit_call":`-Block (L744-750) löschen — im `try` bleibt nur `self.esp.send(target, payload, False)`.
- [ ] **Step 10:** Verify: Grep `display|oled|OLED|pit_call|ssd1306|I2C` in `bridge.py` → 0 Treffer; `python -m py_compile bridge.py`.
- [ ] **Step 11:** Commit: `feat(esp): Bridge ohne Status-OLED und Pit-Call-Weiterleitung (Phase 58)`.

### Task 5: ESP-Dateien löschen + test_modular.py + ESP-Doku

**Files:** Delete: `esp_libs/display_pages.py`, `esp_libs/ssd1306.py`, `esp_libs/oled_diagnose.py`; Modify: `test/test_modular.py`, `esp_libs/README.md`, `docs/VERKABELUNG.md`

- [ ] **Step 1:** `git rm esp_libs/display_pages.py esp_libs/ssd1306.py esp_libs/oled_diagnose.py`
- [ ] **Step 2:** `test/test_modular.py`: Klasse `DisplayPagesModule` ersetzen — `test_display_pages_owns_display_and_pages` löschen, den verbleibenden Orchestrator-Test in eine eigene Klasse heben:
```python
class SenderOrchestrator(unittest.TestCase):
    def test_sender_is_thin_orchestrator(self):
        names = _toplevel_names(_tree(os.path.join(ROOT, "sender.py")))
        self.assertEqual(names, {"RPMCounter", "Battery", "StatusLED", "main"})
```
Prüfen, ob weitere Modul-Listen in der Datei `display_pages`/`ssd1306` erwähnen (Grep in der Datei) und dort entfernen.
- [ ] **Step 3:** `esp_libs/README.md`: Zeilen zu `ssd1306.py` (L9), `display_pages.py` (L20), die `mpremote ... cp ssd1306.py`/`cp display_pages.py`-Zeilen (L69/78/84) und die Lizenzzeile `ssd1306.py — MIT ...` (L116) entfernen; Einleitung `Schnittstellen für Sensoren und Display` → `Schnittstellen für die Sensoren`.
- [ ] **Step 4:** `docs/VERKABELUNG.md`: OLED-Zeilen aus den Pin-Tabellen (Sender L14-15 nur Kommentartext `gemeinsam IMU + OLED` → `IMU`; Bridge-Tabelle L76-79 OLED-Zeilen löschen), OLED-Kästen aus beiden ASCII-Diagrammen (L52, L91), Satz L101 (`braucht nur das OLED ...`) umformulieren (Bridge braucht keine Peripherie außer Status-LED), Troubleshooting-Punkt 2 (`OLED-Diagnose ...`, L146-147) löschen und Punkt 3 (L148, `auf der Sender-OLED`) auf das Dashboard umformulieren.
- [ ] **Step 5:** Verify: `python -m unittest discover -s test -p "test_*.py"` → OK (weniger Tests als Baseline, kein Fehler); Grep `display_pages|ssd1306|oled_diagnose` über Repo (ohne `graphify-out/`, `docs/superpowers/`) → 0 Treffer.
- [ ] **Step 6:** Commit: `feat(esp): OLED-Module geloescht, Doku und Modultests bereinigt (Phase 58)`.

### Task 6: Software — Display-Downlink + Pit-Call raus

**Files:** Modify: `src/pit-wall.js`, `src/geo.js`, `test/geo.test.js`, `src/app.js`, `e2e/demo.spec.js`

**Interfaces:** Consumes: bisherige Exporte von pit-wall.js. Produces: pit-wall.js exportiert nur noch `openPitWall, closePitWall, pwKeyHandler, updatePitWall`; geo.js ohne `structuralRaceKey`.

- [ ] **Step 1:** `src/pit-wall.js`: Import L8 → `import { fmtClock, fmtMs } from './geo.js';`. Header-Kommentar L2-3: `(Pit-Wall + Connection-Tab + Pit-Call +\n//  Kart-Display, Phase 23)` → `(Pit-Wall, Phase 23)`.
- [ ] **Step 2:** `src/pit-wall.js`: Alles von der Zeile `// PIT-CALL — Boxenruf an Sender-ESP` (L140) bis einschließlich Ende `togglePitCall` (L345, schließende `}`) löschen — das umfasst `_pitCallActive/_pitCallTimer/_pitCallMac`, `buildRaceDataForKart`, `structuralRaceKey`-Dedupe (`_lastDisplayKeyByMac`, `_lastDisplayAtByMac`, `RC_DISPLAY_KEEPALIVE_MS`), `sendDisplayUpdate`, `_displayUpdateTimer`, `restartDisplayUpdateInterval`, `sendPitCall`, `cancelPitCall`, `togglePitCall`. Auch den Banner-Kommentar `// Dashboard → Kart: Live Race-Display Update` mitnehmen.
- [ ] **Step 3:** `src/pit-wall.js`: Interface-Marker + Export (L347-358) ersetzen durch:
```js
// Interface-Marker: von rasicross.js (init-Bindings, 1Hz-Loop)/serial-demo.js
// genutzte Funktionen -- verhindert no-unused-vars, dokumentiert das API.
void [openPitWall, closePitWall, pwKeyHandler, updatePitWall];

// ESM-Export (Phase 42): bisherige Interface-Globals von pit-wall.js
export {
  openPitWall, closePitWall, pwKeyHandler, updatePitWall,
};
```
Danach prüfen (Lint), ob die Imports `activeRace, raceElapsedMs, theoreticalBestMs, KartRegistry, RasiLapEngine, rcAlert, rcToast, activeKart, fmtMs, fmtClock` noch Verwender in der Datei haben — nicht mehr genutzte aus den Import-Zeilen entfernen.
- [ ] **Step 4:** `src/geo.js`: Funktion `structuralRaceKey` inkl. Kommentarblock (L109-122) löschen; im Export (L213) `structuralRaceKey, ` entfernen (`ghostPointAt` bleibt).
- [ ] **Step 5:** `test/geo.test.js`: die vier Tests `structuralRaceKey: stable when only the running clock ticks`, `...changes on each structural field`, `...null/undefined/empty are stable`, `...excludes live-ticking + delta fields` (L101-149) komplett löschen.
- [ ] **Step 6:** `src/app.js`: Zeile `import { buildRaceDataForKart } from './pit-wall.js';` löschen; in `window.RasiTest` die Zeile `buildRaceDataForKart, RasiReplay, enterReplay, exitReplay,` → `RasiReplay, enterReplay, exitReplay,`.
- [ ] **Step 7:** `e2e/demo.spec.js`: den Test `test('buildRaceDataForKart liefert pro Kart plausible Payloads', ...)` (ab L73) komplett löschen; Header-Kommentar L3 (`buildRaceDataForKart-Payloads ...`) anpassen (Verweis entfernen).
- [ ] **Step 8:** Verify: `node --check` für `src/pit-wall.js`, `src/geo.js`, `src/app.js` schlägt bei ESM fehl — stattdessen `npm run lint` (0 Fehler) + `npm test` (geo-Tests grün, 4 weniger). Grep `structuralRaceKey|buildRaceDataForKart|sendDisplayUpdate|restartDisplayUpdateInterval|sendPitCall|cancelPitCall|togglePitCall` über `src/`, `test/`, `e2e/` → nur noch Treffer in `src/app-init.js`/`src/settings-ui.js` (werden in Task 7 entfernt).
- [ ] **Step 9:** Commit: `feat(app): Display-Downlink und Boxenruf entfernt (Phase 58)`.

### Task 7: Software — Einstellungen/Markup/CSS/Sound raus

**Files:** Modify: `src/app-init.js`, `src/settings-ui.js`, `src/settings.js`, `src/store.js`, `index.html`, `src/styles/components.css`, `src/rasicross.js`

- [ ] **Step 1:** `src/app-init.js`: Import L23-24 → `import { closePitWall, openPitWall } from './pit-wall.js';`. Block `// Display-Update an den Kart-ESP ...` + `restartDisplayUpdateInterval();` (L66-67) löschen. Den ganzen Block `// OLED-Seitenauswahl` mit `if ($('oledPageSelect')) { ... }` (L74-83) löschen. Zeile `$('pitCallBtn').onclick = togglePitCall;` (L100) löschen.
- [ ] **Step 2:** `src/settings-ui.js`: Import L8 (`restartDisplayUpdateInterval`) löschen. L105 (`if ($('setDisplayUpdateMs')) ...`) löschen. In `saveSettingsFromUi` den Block L144-148 (`const newInterval ... restartDisplayUpdateInterval(); }`) löschen.
- [ ] **Step 3:** `src/settings.js`: Zeile `{ group: 'bridge', rowId: 'setDisplayUpdateMs', label: 'OLED-Update Intervall', ... }` löschen. Danach Grep `'bridge'` in `src/settings.js` + `index.html`: bleibt die Gruppe leer, auch den Gruppen-Eintrag in settings.js (falls vorhanden) entfernen.
- [ ] **Step 4:** `src/store.js` L30: aus den Defaults ` displayUpdateMs: 500,` und ` oledPage: 'auto',` entfernen (alte Saves mit diesen Keys bleiben ladbar — überzählige Felder stören nicht).
- [ ] **Step 5:** `index.html`: den `pitCallBtn`-Button (L160-163) und das `oledPageSelect`-Select (L164-171) löschen. Die komplette Bridge-Settings-Sektion (L956-966, `<!-- ── Bridge ──... -->` bis `</section>`) löschen und den Nav-Button `data-sgroup="bridge"` (L895) löschen.
- [ ] **Step 6:** `src/styles/components.css`: Regeln `.btn.pitcall{...}`, `.btn.pitcall.active{...}` und `@keyframes pitPulse{...}` (L62-75) löschen.
- [ ] **Step 7:** `src/rasicross.js`: im `rcAudio`-Return die Zeile `pitCall:    () => { beep(660, 200, 0.2); setTimeout(() => beep(880, 200, 0.2), 220); },` löschen (kein Aufrufer — verifiziert).
- [ ] **Step 8:** Verify: Grep `pitCall|pitcall|oledPage|displayUpdateMs|setDisplayUpdateMs` über `src/`, `index.html` → 0 Treffer; `npm run lint`, `npm run lint:css`, `npm test`.
- [ ] **Step 9:** Commit: `feat(app): OLED-Einstellungen, Boxenruf-UI und Bridge-Settings-Sektion entfernt (Phase 58)`.

### Task 8: Ausstattung → nur RPM; ESP-Formular bereinigt

**Files:** Modify: `src/kart-roster.js`, `src/kart-equip.js`, `src/kart-settings-window.js`, `src/esp-config.js`, `test/kart-roster.test.js`

**Interfaces:** Produces: `equipDefaults()`/`equipFor()` liefern `{ rpm: boolean }`; `applyEquipToEspPanel(doc, eq)` kennt nur noch RPM-Zeilen; `ESP_CFG_FIELDS` ohne `espMaxRpm`/`espWarnRpm`/`espPageMs`.

- [ ] **Step 1:** `src/kart-roster.js`: `equipDefaults()` → `return { rpm: true };`; `equipFor(meta)` → nur noch `rpm`-Zeile (display-Zeile löschen); Kommentar L20-21 bleibt sinngemäß (Alt-Metas ohne equip = voll ausgestattet).
- [ ] **Step 2:** `src/kart-equip.js`: Im Erst-Dialog die `toggle-row` mit `equipDlgDisplay` (L55) löschen und im Save-Handler `display: !!ov.querySelector('#equipDlgDisplay').checked,` löschen. In `equipSectionMarkup()` die `toggle-row` mit `equipDisplay` (L82) löschen; Untertitel `Sensoren &amp; Anzeige dieses Karts` → `Sensoren dieses Karts`. `_EQUIP_TOGGLES` → `[['equipRpm', 'rpm']]`. In `applyEquipToEspPanel`: den `espPageMs`-Zweig (`const pm = rowOf('espPageMs'); ...`, L124-125) löschen und aus `_RPM_ESP_IDS` die Einträge `'espMaxRpm', 'espWarnRpm'` entfernen (Zeilen existieren nach Task 8 Step 3 nicht mehr). Header-Kommentar `{equip:{rpm,display}, equipSet}` → `{equip:{rpm}, equipSet}`.
- [ ] **Step 3:** `src/kart-settings-window.js`: die Formularzeilen `espMaxRpm` (L101), `espWarnRpm` (L102) und `espPageMs` (L113) löschen; im Config-Payload (L325-339) die Zeilen `max_rpm:`, `warn_rpm:`, `page_ms:` löschen.
- [ ] **Step 4:** `src/esp-config.js`: aus `ESP_CFG_FIELDS` die Einträge `['espMaxRpm', 'mr'], ['espWarnRpm', 'wr'],` und `['espPageMs', 'pm'],` löschen; Array-Format kompakt halten.
- [ ] **Step 5:** `test/kart-roster.test.js`: alle `{ rpm: ..., display: ... }`-Erwartungen auf `{ rpm: ... }` reduzieren (L17, 25, 29-31, 35-37); den Fall `equipFor({ equip: { display: false } })` (L36) ersetzen durch `assert.deepEqual(equipFor({ equip: {} }), { rpm: true });`.
- [ ] **Step 6:** Verify: Grep `equipDisplay|equipDlgDisplay|espPageMs|espMaxRpm|espWarnRpm|'pm'|'mr'|'wr'` über `src/`, `test/`, `e2e/` → 0 Treffer; Grep `display` in `src/kart-roster.js`, `src/kart-equip.js` → 0 Treffer; `npm test`, `npm run lint`.
- [ ] **Step 7:** Commit: `feat(kart): Ausstattung nur noch RPM-Sensor, ESP-Formular ohne Display- und Shift-Light-Felder (Phase 58)`.

### Task 9: Gesamtverifikation + Spec-Addendum + Plan-Doc

- [ ] **Step 1:** Voller Lauf: `npm test`, `npm run lint`, `npm run lint:css`, `python -m py_compile sender.py bridge.py esp_libs/config_store.py esp_libs/imu_task.py esp_libs/gps_task.py esp_libs/radio.py esp_libs/calc.py`, `python -m unittest discover -s test -p "test_*.py"`; e2e lokal: `npx playwright test e2e/demo.spec.js e2e/karts.spec.js` (Screenshot-Suite bleibt CI-only). Neue Testzahlen notieren. `__pycache__` löschen.
- [ ] **Step 2:** Restsuche: Grep `oled|OLED` über Repo ohne `graphify-out/`, `docs/superpowers/`, `node_modules/` → erwartet 0 Treffer in Code/Markup (README/VERKABELUNG bereits bereinigt); Grep `pit_call|pitCall|pitcall` ebenso → 0.
- [ ] **Step 3:** Spec-Addendum: in `docs/superpowers/specs/2026-09-01-58-display-entfernen-design.md` unter „Locked Decisions" den Punkt ergänzen: `MAX_RPM/RPM_WARN/BLINK_MS (Sender-Shift-Light) werden mit entfernt — einzige Verbraucher lagen in display_pages.py; die Formularfelder espMaxRpm/espWarnRpm entfallen.` und in der Umfang-Tabelle config_store/kart-settings entsprechend erweitern.
- [ ] **Step 4:** `graphify update .` ausführen (AST-only) — `graphify-out/` NICHT committen.
- [ ] **Step 5:** Abschluss-Commit (einziger Commit mit Doku): `git add docs/superpowers/plans/2026-09-01-58-display-entfernen.md docs/superpowers/specs/2026-09-01-58-display-entfernen-design.md` + `docs(phase-58): Plan und Spec-Addendum Display-Entfernung`.

## Hardware/Manual Acceptance Checklist (User, deferred)

- [ ] Sender-Firmware per mpy-cross-Prozedur (esp_libs/README.md) neu flashen — App bootet ohne display_pages/ssd1306.
- [ ] Bridge-Firmware neu flashen — Boot-`bridge_status` kommt ohne `oled`-Feld, Telemetrie läuft.
- [ ] Dashboard: Live-Tab ohne BOX-Button/OLED-Select; Kart-Einstellungsfenster ohne OLED-Seitenwechsel/Max-RPM/Warn-RPM; Einstellungen ohne Bridge-Sektion.
- [ ] Erst-Kontakt-Dialog eines neuen Karts zeigt nur noch den RPM-Toggle.
- [ ] Config-Roundtrip: „An ESP32 senden" → Bestätigung kommt, Werte stimmen.

## Self-Review

- [ ] Spec-Coverage: jede Zeile der Spec-Umfangstabellen ist einem Task zugeordnet (ESP: Tasks 2-5; Software: Tasks 6-8; Kompat/Tests: Tasks 5/6/8/9). Addendum MAX_RPM/RPM_WARN in Tasks 3/8/9.
- [ ] Platzhalter-Scan: keine TBD/TODO; alle Edits mit konkretem Anker oder Literalcode.
- [ ] Namens-Konsistenz: `equipFor` → `{rpm}` überall (kart-roster, kart-equip, Tests); Export-Listen pit-wall/geo konsistent mit Verbrauchern (app-init/app/settings-ui in Tasks 6/7 vor Lint-Lauf bereinigt).

## Phase Map

- Phase 57 (Basis-Branch): Kart-Ausstattung — wird hier auf `{rpm}` reduziert.
- **Phase 58 (dieser Plan): ESP-Bildschirm-Funktion entfernen.**
- Danach: PR `feat/phase-58-display-entfernen` → stacked auf Phase-57-PR; Merge-Reihenfolge 57 → 58 (Memory: Stacked-PR-Merge-Reihenfolge).
