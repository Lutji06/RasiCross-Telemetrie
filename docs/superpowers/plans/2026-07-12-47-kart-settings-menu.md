# Phase 47: Kart-Einstellungen im Karts-Tab — Implementierungsplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** IMU-Kalibrierung und ESP32-Sender-Konfig ziehen aus dem Einstellungen-Tab in einen Dropdown+Panel-Abschnitt im Karts-Tab; der Einstellungen-Tab behält nur App-Einstellungen (Spec: `docs/superpowers/specs/2026-07-12-kart-settings-menu-design.md`).

**Architecture:** Neues ESM-Modul `src/kart-settings.js` (Dropdown, Panels, Handler) mit purem Fallback-Resolver in `kart-roster.js`. HTML-Blöcke ziehen mit unveränderten IDs von `#tab-settings` nach `#tab-karts`. Alle Aktionen adressieren das gewählte Kart explizit per `target_mac`; `config_ack` fremder Karts wird gefiltert. Keine Firmware-, keine `SAVE_KEY`-Änderung.

**Tech Stack:** Vanilla ES-Module (Vite), node:test, Playwright (Electron-Smoke).

## Global Constraints

- Kein Eingriff in sender.py/bridge.py (target_mac-Routing existiert: bridge.py:706ff).
- `SAVE_KEY = 'rasicross_v96_data'` und `REC_VERSION` bleiben unangetastet.
- Neue Datei ≤ 520 Inhaltszeilen, gemessen mit `(Get-Content <f> | Measure-Object -Line).Lines`.
- Alle Repo-Dateien sind **CRLF**: Vor jedem Edit die Zielregion frisch Read-en und den Anker aus diesem Read kopieren; Zeilennummern sind nur Richtwerte. Verifikation mit dem Grep-Tool, nie Shell-grep.
- Git immer als `git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" …`; keine Anführungszeichen in Commit-Messages (PowerShell-5.1-Falle); Commit-Trailer (Co-Authored-By + Claude-Session) gemäß aktueller Harness-Vorgabe anhängen.
- Nie `.claude/` oder Plan-Docs committen — außer dem expliziten Plan-Doc-Commit in Task 8.
- Baselines: `npm test` = **190 pass** (vor diesem Plan); Python-Suite `Ran 17 tests OK` (wird hier nicht angefasst, nur als Regressionsgate).

## Working Directory & Conventions

- Arbeitsverzeichnis: `C:/Users/jimlu/Documents/RasiCross-Telemetrie-git`.
- Branch: `feat/phase-47-kart-settings` (Task 1, Step 1).
- Pro Task: Verifikation (node --check betroffener ESM-Dateien, `npm test`), dann Commit.
- `node --check` funktioniert auf den src-Modulen (package.json hat `"type": "module"`).
- Vor jedem `git status`/Commit: `__pycache__` löschen, falls vorhanden.

## Locked Decisions (aus der Spec)

1. Umfang: **nur** IMU-Kalibrierung + ESP-Sender-Konfig ziehen um. Dashboard-Limits, Drift/Rollover, 3D-Modell, Karten, Daten bleiben App-Einstellungen.
2. UI: **Dropdown + Panel** unter den Kart-Karten; Dropdown vorbelegt mit aktivem Kart, Offline-Karts mit „(offline)“.
3. Alle Sendeaktionen mit **explizitem `target_mac`** des gewählten Karts (Muster: pit-wall.js:376).
4. `applyEspConfigAck` ignoriert Acks, deren `from_mac` nicht zum gewählten Kart passt.
5. ESP-Feldwerte werden **nie vom Render überschrieben** (nur `config_ack` füllt sie) — der 1-Hz-Refresh darf Eingaben nicht verwerfen.
6. Kalibrierungs-Zusammenfassung auf den Kart-Karten (karts-page.js `_calHtml`) bleibt unverändert.
7. Settings-Gruppen danach: `dashboard, fahrdynamik, bridge, model3d, map, data` (sensorik→fahrdynamik gestutzt, hardware→bridge nur noch `setDisplayUpdateMs`).

## File Structure

| Action | Path | Responsibility |
|---|---|---|
| Modify | `src/kart-roster.js` | + `resolveSelectedMac(selected, activeMac, macs)` (pure) |
| Modify | `test/kart-roster.test.js` | + 3 Tests für resolveSelectedMac |
| Modify | `src/settings.js` | GROUPS + SETTINGS_INDEX ohne Kart-Einträge, neue Gruppen-Keys |
| Modify | `test/settings.test.js` | Erwartungen an neue GROUPS/Index |
| Modify | `index.html` | Kalibrier-Block + ESP-Formular → `#tab-karts` (neuer Abschnitt `#kartSettingsSection`); Settings-Nav/Sektionen fahrdynamik/bridge |
| Create | `src/kart-settings.js` | Dropdown + Panels + Handler (Kalibrierung, ESP-Senden, config_get) |
| Modify | `src/karts-page.js` | `renderKartsTab()` ruft `renderKartSettings()` |
| Modify | `src/app.js` | Import `./kart-settings.js`; |
| Modify | `src/app-init.js` | 4 Handler-Blöcke raus, `initKartSettings()` rein, Imports bereinigt |
| Modify | `src/settings-ui.js` | Kalibrier-Anteile aus load/save raus, Imports bereinigt |
| Modify | `src/esp-config.js` | `applyEspConfigAck(d, expectedMac)` mit from_mac-Filter |
| Modify | `src/telemetry.js` | übergibt `selectedKartMac()` an den Ack |
| Modify | `e2e/karts.spec.js` | + 2 Smoke-Tests (Dropdown/Toggle, Settings-Tab bereinigt) |

Task-Reihenfolge: 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 (strikt sequenziell; ab Task 3 ist die App erst nach Task 5 wieder voll konsistent — dazwischen keine manuellen Smoke-Erwartungen).

---

### Task 1: Branch + purer Auswahl-Resolver (TDD)

**Files:**
- Modify: `src/kart-roster.js`
- Test: `test/kart-roster.test.js`

**Interfaces:**
- Produces: `RasiKartRoster.resolveSelectedMac(selected, activeMac, macs) -> string|null` — gewählte MAC, wenn im Roster; sonst aktive MAC, wenn im Roster; sonst erste Roster-MAC; leeres/ungültiges Roster ⇒ `null`. Konsumiert von Task 4.

- [ ] **Step 1: Branch anlegen**

```bash
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" checkout -b feat/phase-47-kart-settings
```

- [ ] **Step 2: Failing Tests anhängen**

`test/kart-roster.test.js` frisch Read-en; `resolveSelectedMac` in die Destrukturierung in Zeile 5–6 aufnehmen (`rosterMacs, clampServiceH, calDefaults, PALETTE` → `rosterMacs, clampServiceH, calDefaults, resolveSelectedMac, PALETTE`) und ans Dateiende anhängen:

```js

test('resolveSelectedMac: gewaehlte MAC gewinnt, solange im Roster', () => {
  assert.equal(resolveSelectedMac('BB:02', 'AA:01', ['AA:01', 'BB:02']), 'BB:02');
});

test('resolveSelectedMac: unbekannte Auswahl -> aktive MAC', () => {
  assert.equal(resolveSelectedMac('XX:99', 'AA:01', ['AA:01', 'BB:02']), 'AA:01');
});

test('resolveSelectedMac: ohne Auswahl/Aktiv -> erste Roster-MAC, leer -> null', () => {
  assert.equal(resolveSelectedMac(null, null, ['AA:01']), 'AA:01');
  assert.equal(resolveSelectedMac(null, 'XX:99', []), null);
  assert.equal(resolveSelectedMac(null, null, null), null);
});
```

- [ ] **Step 3: Fehlschlag verifizieren**

Run: `node --test test/kart-roster.test.js`
Expected: FAIL (`resolveSelectedMac is not a function`).

- [ ] **Step 4: Implementierung**

In `src/kart-roster.js` direkt vor dem `// ESM-Export`-Kommentar einfügen:

```js
  // Dropdown-Auswahl der Kart-Einstellungen (Phase 47): gewaehlte MAC,
  // solange sie im Roster ist; sonst aktive MAC; sonst erste Roster-MAC.
  function resolveSelectedMac(selected, activeMac, macs) {
    const list = Array.isArray(macs) ? macs : [];
    if (selected && list.indexOf(selected) >= 0) return selected;
    if (activeMac && list.indexOf(activeMac) >= 0) return activeMac;
    return list.length ? list[0] : null;
  }
```

Export-Objekt ergänzen (`clampServiceH, calDefaults` → `clampServiceH, calDefaults, resolveSelectedMac`).

- [ ] **Step 5: Grün verifizieren**

Run: `node --test test/kart-roster.test.js` → alle PASS.
Run: `npm test` → **193 pass** (190 + 3), 0 fail.

- [ ] **Step 6: Commit**

```bash
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" add src/kart-roster.js test/kart-roster.test.js
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" commit -m "feat(karts): resolveSelectedMac -- purer Dropdown-Fallback (Phase 47 Task 1)"
```

(Hier und in allen Folge-Commits: die vom Harness vorgegebenen Trailer als weitere `-m`-Argumente anhängen; keine Anführungszeichen im Message-Text.)

---

### Task 2: settings.js — Gruppen + Index ohne Kart-Einträge (TDD)

**Files:**
- Modify: `src/settings.js`
- Test: `test/settings.test.js`

**Interfaces:**
- Produces: `GROUPS = ['dashboard', 'fahrdynamik', 'bridge', 'model3d', 'map', 'data']`; `SETTINGS_INDEX` ohne IMU-/esp*-Einträge; Drift/Rollover unter `fahrdynamik`, `setDisplayUpdateMs` unter `bridge`. Konsumiert von index.html (Task 3, data-sgroup-Werte müssen exakt matchen).

- [ ] **Step 1: Tests anpassen (failing)**

In `test/settings.test.js` (frisch Read-en) vier Stellen ändern:

(a) GROUPS-Test:

```js
test('GROUPS: frozen, sechs bekannte Gruppen, dashboard zuerst', () => {
  assert.equal(Object.isFrozen(GROUPS), true);
  assert.deepEqual(GROUPS, ['dashboard', 'fahrdynamik', 'bridge', 'model3d', 'map', 'data']);
});
```

(b) Reducer-Set-Test: `{ type: 'set', id: 'hardware' }), 'hardware')` → `{ type: 'set', id: 'bridge' }), 'bridge')`.

(c) Reducer-Identity-Test: beide `'sensorik'` → `'fahrdynamik'`.

(d) Keyword-Test (esp-Einträge existieren nicht mehr):

```js
test('settingsFilter: Treffer per Keyword (Synonym)', () => {
  const r = settingsFilter('drift', SETTINGS_INDEX);
  assert.ok(r.rows.has('setDriftTol'));
  assert.ok(r.groups.has('fahrdynamik'));
});
```

Zusätzlich einen Wächter-Test ans Dateiende (Kart-Einträge dürfen nie zurückkommen):

```js

test('SETTINGS_INDEX: keine Kart-spezifischen Eintraege (Phase 47)', () => {
  for (const e of SETTINGS_INDEX) {
    assert.ok(!/^esp/.test(e.rowId), `esp-Eintrag im Index: ${e.rowId}`);
    assert.ok(!/^setInvert|^setSwapG/.test(e.rowId), `IMU-Eintrag im Index: ${e.rowId}`);
  }
});
```

- [ ] **Step 2: Fehlschlag verifizieren**

Run: `node --test test/settings.test.js` → FAIL (GROUPS deepEqual u. a.).

- [ ] **Step 3: settings.js umbauen**

Zeile 9:

```js
  const GROUPS = Object.freeze(['dashboard', 'fahrdynamik', 'bridge', 'model3d', 'map', 'data']);
```

In `SETTINGS_INDEX`: die fünf `setInvert*`/`setSwapG`-Zeilen und **alle** `esp*`-Zeilen (espMaxRpm … espPageMs) ersatzlos löschen; bei `setDriftTol`, `setDriftMinSpeed`, `setRolloverAngle` `group: 'sensorik'` → `group: 'fahrdynamik'`; bei `setDisplayUpdateMs` `group: 'hardware'` → `group: 'bridge'`.

- [ ] **Step 4: Grün verifizieren**

Run: `npm test` → **194 pass** (193 + 1 Wächter), 0 fail.

- [ ] **Step 5: Commit**

```bash
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" add src/settings.js test/settings.test.js
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" commit -m "refactor(settings): Gruppen fahrdynamik/bridge, Index ohne Kart-Eintraege (Phase 47 Task 2)"
```

---

### Task 3: index.html — Blöcke verschieben, Settings-Tab stutzen

**Files:**
- Modify: `index.html` (Regionen: `#tab-karts` ~Z. 3147–3159; Settings-Nav ~Z. 3366–3371; Sensorik-Sektion ~Z. 3406–3439; Hardware-Sektion ~Z. 3442–3506)

**Interfaces:**
- Produces: `#kartSettingsSection` mit `#kartSettingsSelect`, `#kartSettingsEmpty`, `#kartSettingsPanels`, `#kartCalPanel` (+ neues `#kartCalHint`), `#kartEspPanel` — alle bisherigen Control-IDs unverändert (setInvertGx…, zeroImuBtn, espMaxRpm…, espSendBtn, espSendStatus). Konsumiert von Task 4.
- WICHTIG: Jede ID existiert danach **genau einmal** im Dokument.

- [ ] **Step 1: Settings-Nav umbenennen** (~Z. 3367–3368, frisch Read-en)

Alt:
```html
      <button type="button" class="settings-nav-item" data-sgroup="sensorik">Sensorik &amp; Fahrdynamik</button>
      <button type="button" class="settings-nav-item" data-sgroup="hardware">ESP32 / Hardware</button>
```
Neu:
```html
      <button type="button" class="settings-nav-item" data-sgroup="fahrdynamik">Fahrdynamik</button>
      <button type="button" class="settings-nav-item" data-sgroup="bridge">Bridge</button>
```

- [ ] **Step 2: Sensorik-Sektion → Fahrdynamik** (~Z. 3406–3439)

Sektions-Kopf ersetzen — alt:
```html
      <section class="settings-group" data-sgroup="sensorik">
        <header class="settings-group-head">
          <div><h2 class="settings-group-title">Sensorik &amp; Fahrdynamik</h2><p class="settings-group-sub">IMU-Kalibrierung, Drift, Umkippen</p></div>
          <span class="settings-saved" data-savemark>Automatisch gespeichert ✓</span>
        </header>
```
neu:
```html
      <section class="settings-group" data-sgroup="fahrdynamik">
        <header class="settings-group-head">
          <div><h2 class="settings-group-title">Fahrdynamik</h2><p class="settings-group-sub">Drift &amp; Umkippen</p></div>
          <span class="settings-saved" data-savemark>Automatisch gespeichert ✓</span>
        </header>
```

Dann den kompletten IMU-Block **löschen** (er zieht in Step 4 um): von `<p class="settings-block-note">Mäher auf eine ebene Fläche stellen…` bis einschließlich der Zeile `<div style="font-size:11px;color:var(--mut);margin:0 0 14px">⚠ Nullen nur auf <b>ebener Fläche</b>…</div>`. Die drei `settings-row` (Drift-Empfindlichkeit, Drift Min-Tempo, Umkipp-Schwelle) bleiben als einziger Sektionsinhalt.

- [ ] **Step 3: Hardware-Sektion → Bridge** (~Z. 3442–3506)

Die **gesamte** Sektion `<section class="settings-group" data-sgroup="hardware">…</section>` ersetzen durch:

```html
      <!-- ── Bridge ────────────────────────────────────────── -->
      <section class="settings-group" data-sgroup="bridge">
        <header class="settings-group-head">
          <div><h2 class="settings-group-title">Bridge</h2><p class="settings-group-sub">Bridge-Display</p></div>
          <span class="settings-saved" data-savemark>Automatisch gespeichert ✓</span>
        </header>
        <div class="settings-row">
          <div class="settings-row-label"><span class="settings-row-name">OLED-Update Intervall</span><span class="settings-row-desc">Aktualisierungsrate des Bridge-Displays (ms)</span></div>
          <input type="number" id="setDisplayUpdateMs" value="500" min="100" max="2000" step="50" data-autosave>
        </div>
      </section>
```

(Die ESP-Zeilen espMaxRpm…espPageMs + Send-Button + Status ziehen in Step 4 um; `setDisplayUpdateMs` behält `data-autosave`, weil es im `#tab-settings`-Listener bleibt.)

- [ ] **Step 4: Kart-Einstellungen-Abschnitt in #tab-karts einfügen** (~Z. 3147–3159)

Nach der Zeile `<div id="kartCardsList">…</div>` und vor dem schließenden `</div>` der `.pw-library` **nichts** einfügen — stattdessen nach dem schließenden `</div>` der ersten `.pw-library`, direkt vor `</section>`, diesen Block einfügen (Kalibrier-HTML = umgezogener Block aus Step 2 **ohne** `data-autosave`-Attribute; ESP-HTML = umgezogene Zeilen aus Step 3):

```html
  <!-- Kart-Einstellungen (Phase 47): Kalibrierung + ESP-Konfig des im
       Dropdown gewaehlten Karts. IDs unveraendert aus dem Settings-Tab
       umgezogen; kart-settings.js verdrahtet Dropdown + Panels. -->
  <div class="pw-library" id="kartSettingsSection" style="margin-top:16px">
    <div class="pw-lib-head pw-lib-head-row">
      <div class="pw-lib-title">
        <span class="pw-lib-bar"></span>
        <span>Kart-Einstellungen</span>
      </div>
      <select id="kartSettingsSelect" title="Kart wählen"></select>
    </div>
    <div id="kartSettingsEmpty" class="muted" style="display:none">Noch keine Karts — Einstellungen erscheinen mit dem ersten Telemetrie-Paket.</div>
    <div id="kartSettingsPanels">
      <section class="settings-group active" id="kartCalPanel">
        <header class="settings-group-head">
          <div><h2 class="settings-group-title">Kalibrierung</h2><p class="settings-group-sub">IMU · Nullpunkt &amp; Achsen</p></div>
        </header>
        <p class="settings-block-note">Mäher auf eine ebene Fläche stellen, dann „Nullpunkt setzen". Achsen-Korrekturen darunter.</p>
        <div class="row" style="margin-bottom:14px">
          <div class="stat"><div class="t">Gx Offset</div><div class="n" id="gxOffsetText">0.00</div></div>
          <div class="stat"><div class="t">Gy Offset</div><div class="n" id="gyOffsetText">0.00</div></div>
        </div>
        <div class="toggle-row"><span class="label-text">Gx invertieren</span><label class="toggle"><input type="checkbox" id="setInvertGx"><span class="toggle-knob"></span></label></div>
        <div class="toggle-row"><span class="label-text">Gy invertieren</span><label class="toggle"><input type="checkbox" id="setInvertGy"><span class="toggle-knob"></span></label></div>
        <div class="toggle-row"><span class="label-text">Gx ↔ Gy tauschen</span><label class="toggle"><input type="checkbox" id="setSwapG"><span class="toggle-knob"></span></label></div>
        <div class="toggle-row"><span class="label-text">Gier invertieren</span><label class="toggle"><input type="checkbox" id="setInvertYaw"><span class="toggle-knob"></span></label></div>
        <div class="toggle-row"><span class="label-text">Roll-Rate invertieren</span><label class="toggle"><input type="checkbox" id="setInvertRollRate"><span class="toggle-knob"></span></label></div>
        <div class="row" style="gap:8px;margin:14px 0 4px">
          <button class="btn primary" id="zeroImuBtn" style="flex:1">Nullpunkt setzen</button>
          <button class="btn ghost" id="resetImuBtn" style="flex:0 0 auto">Zurücksetzen</button>
          <button class="btn ghost" id="zeroRollBtn" style="flex:0 0 auto" title="Aktuellen Rollwinkel als 0 setzen — Mäher dazu auf ebener Fläche abstellen">Roll nullen</button>
        </div>
        <div style="font-size:11px;color:var(--mut);margin:0 0 4px">⚠ Nullen nur auf <b>ebener Fläche</b> — am Hang genullt wäre jede spätere Messung um die Hangneigung verschoben.</div>
        <p id="kartCalHint" style="font-family:var(--mono);font-size:11px;color:var(--mut);margin-top:6px;min-height:14px"></p>
      </section>
      <section class="settings-group active" id="kartEspPanel" style="margin-top:14px">
        <header class="settings-group-head">
          <div><h2 class="settings-group-title">ESP32 / Hardware</h2><p class="settings-group-sub">Sender-Konfig dieses Karts</p></div>
        </header>
        <p class="settings-block-note">Werte unten gehen erst per „An ESP32 senden" an den Kart und wirken dann sofort.</p>
        <div class="settings-row">
          <div class="settings-row-label"><span class="settings-row-name">Max RPM (Sender)</span><span class="settings-row-desc">Drehzahl-Obergrenze im Sender</span></div>
          <input type="number" id="espMaxRpm" value="6000">
        </div>
        <div class="settings-row">
          <div class="settings-row-label"><span class="settings-row-name">Warn RPM (Sender)</span><span class="settings-row-desc">Warnschwelle im Sender</span></div>
          <input type="number" id="espWarnRpm" value="5500">
        </div>
        <div class="settings-row">
          <div class="settings-row-label"><span class="settings-row-name">Sende-Intervall</span><span class="settings-row-desc">Telemetrie-Rate des Senders (ms)</span></div>
          <input type="number" id="espSendMs" value="80" min="20" max="500">
        </div>
        <div class="settings-row">
          <div class="settings-row-label"><span class="settings-row-name">Pulses per Revolution</span><span class="settings-row-desc">Sensor-Pulse pro Wellenumdrehung</span></div>
          <input type="number" id="espPulses" value="1" min="1" max="32">
        </div>
        <div class="settings-row">
          <div class="settings-row-label"><span class="settings-row-name">Radumfang</span><span class="settings-row-desc">Meter pro Radumdrehung (0 = nur GPS)</span></div>
          <input type="number" id="espWheelCirc" value="0" min="0" step="0.001">
        </div>
        <div class="settings-row">
          <div class="settings-row-label"><span class="settings-row-name">Übersetzung Welle:Rad</span><span class="settings-row-desc">Getriebeverhältnis (1 = 1:1)</span></div>
          <input type="number" id="espGearRatio" value="1" min="0.01" step="0.01">
        </div>
        <div class="settings-row">
          <div class="settings-row-label"><span class="settings-row-name">Akkuzellen in Reihe</span><span class="settings-row-desc">Anzahl LiPo-Zellen (cells in series)</span></div>
          <input type="number" id="espBattCells" value="1" min="1" max="14">
        </div>
        <div class="settings-row">
          <div class="settings-row-label"><span class="settings-row-name">Akku Warn-Schwelle</span><span class="settings-row-desc">Warnung ab dieser Spannung pro Zelle (V)</span></div>
          <input type="number" id="espBattWarnV" value="3.5" min="2.5" max="4.4" step="0.05">
        </div>
        <div class="settings-row">
          <div class="settings-row-label"><span class="settings-row-name">Akku Kritisch-Schwelle</span><span class="settings-row-desc">Kritisch ab dieser Spannung pro Zelle (V)</span></div>
          <input type="number" id="espBattCritV" value="3.3" min="2.0" max="4.4" step="0.05">
        </div>
        <div class="settings-row">
          <div class="settings-row-label"><span class="settings-row-name">Akku Feinkalibrierung</span><span class="settings-row-desc">Multiplikator auf die gemessene Spannung (Abgleich mit Multimeter)</span></div>
          <input type="number" id="espBattCal" value="1.0" min="0.5" max="2.0" step="0.01">
        </div>
        <div class="settings-row">
          <div class="settings-row-label"><span class="settings-row-name">RPM Glitch-Schwelle</span><span class="settings-row-desc">Flanken oberhalb dieser Drehzahl gelten als Störimpuls (Zünd-EMI); 0 = Filter aus</span></div>
          <input type="number" id="espRpmCeiling" value="16000" min="0" max="30000" step="500">
        </div>
        <div class="settings-row">
          <div class="settings-row-label"><span class="settings-row-name">RPM-Glättung</span><span class="settings-row-desc">EMA-Gewicht des neuen Werts: 1 = ungefiltert, klein = träge</span></div>
          <input type="number" id="espRpmAlpha" value="0.25" min="0.05" max="1" step="0.05">
        </div>
        <div class="settings-row">
          <div class="settings-row-label"><span class="settings-row-name">OLED Seitenwechsel</span><span class="settings-row-desc">Auto-Seitenwechsel des Kart-Displays (ms)</span></div>
          <input type="number" id="espPageMs" value="4000" min="1000" max="20000" step="500">
        </div>
        <div class="row" style="margin:6px 0 4px"><button class="btn primary" id="espSendBtn" style="flex:1">An ESP32 senden</button></div>
        <p id="espSendStatus" style="font-family:var(--mono);font-size:11px;color:var(--mut);margin-top:6px;text-align:center;min-height:14px"></p>
      </section>
    </div>
  </div>
```

Hinweis Umlaute/Sonderzeichen: Blöcke exakt aus dem frischen Read übernehmen (Datei ist UTF-8 mit CRLF).

- [ ] **Step 5: Verifikation (Grep-Tool, jeweils output_mode=count auf index.html)**

| Pattern | Erwartung |
|---|---|
| `id="setInvertGx"` | 1 |
| `id="espMaxRpm"` | 1 |
| `id="zeroImuBtn"` | 1 |
| `id="espSendBtn"` | 1 |
| `id="setDisplayUpdateMs"` | 1 |
| `data-sgroup="sensorik"` | 0 |
| `data-sgroup="hardware"` | 0 |
| `data-sgroup="fahrdynamik"` | 2 |
| `data-sgroup="bridge"` | 2 |
| `id="kartSettingsSelect"` | 1 |

Zusätzlich `npm test` → weiterhin 194 pass (HTML beeinflusst Unit-Tests nicht).

- [ ] **Step 6: Commit**

```bash
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" add index.html
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" commit -m "refactor(ui): Kalibrierung + ESP-Formular in den Karts-Tab, Settings-Gruppen fahrdynamik/bridge (Phase 47 Task 3)"
```

---

### Task 4: Neues Modul src/kart-settings.js + Verdrahtung

**Files:**
- Create: `src/kart-settings.js`
- Modify: `src/karts-page.js` (Import + Aufruf in `renderKartsTab()`)
- Modify: `src/app.js` (Import-Kette)

**Interfaces:**
- Consumes: `RasiKartRoster.resolveSelectedMac` (Task 1); IDs aus Task 3; aus `./rasicross.js`: `state, $, esc, setText, rcToast, saveData, kartMetaFor, kartRosterMacs, kartCalFor, bridgeSend`; aus `./esp-config.js`: `ESP_CFG_FIELDS, armEspAckTimer`; aus `./gauges.js`: `drawGMeter`.
- Produces: `renderKartSettings()` (idempotent, eigener Fokus-Schutz), `selectedKartMac() -> string|null`, `initKartSettings()` (einmalige Handler-Bindung). Konsumiert von Task 5 (app-init) und Task 6 (telemetry).
- Import-Ring-Hinweis: rasicross.js → karts-page.js → kart-settings.js → rasicross.js ist deklarationsrein (nur Funktions-Deklarationen, kein Top-Level-Call) — gleiches Muster wie der dokumentierte Ring rasicross ↔ kart3d-ui.

- [ ] **Step 1: Datei anlegen** — kompletter Inhalt:

```js
// ============================================================
//  RasiCross — kart-settings.js  (Kart-Einstellungen im Karts-Tab, Phase 47)
// ============================================================
//  Dropdown + Panels (Kalibrierung, ESP32-Sender) fuer das im Dropdown
//  gewaehlte Kart. Alle Aktionen zielen explizit per target_mac auf dieses
//  Kart — nie implizit auf das aktive. ESP-Feldwerte werden NIE vom Render
//  ueberschrieben (nur config_ack fuellt sie), sonst wuerde der 1-Hz-
//  Refresh des Karts-Tabs Eingaben verwerfen.
//  Nur Deklarationen auf Top-Level — kein Code laeuft beim Laden.
// ============================================================
import { state, $, esc, setText, rcToast, saveData,
         kartMetaFor, kartRosterMacs, kartCalFor, bridgeSend } from './rasicross.js';
import { ESP_CFG_FIELDS, armEspAckTimer } from './esp-config.js';
import { drawGMeter } from './gauges.js';
import RasiKartRoster from './kart-roster.js';
import KartRegistry from './kart-registry.js';

let _selectedMac = null;
let _zeroBusy = false;
let _lastEspUsable = null;

function selectedKartMac() {
  return RasiKartRoster.resolveSelectedMac(_selectedMac, state.activeKartMac, kartRosterMacs());
}

// Live-Bucket NUR lesen, wenn er existiert — state.karts.get() wuerde sonst
// einen leeren Bucket fuer ein offline-Kart anlegen.
function _liveKart(mac) {
  return (mac && state.karts.has(mac)) ? state.karts.get(mac) : null;
}

// target_mac explizit setzen (Muster pit-wall.js) — der bridgeSend-Default
// waere das AKTIVE Kart, hier zielt alles auf das GEWAEHLTE.
function _sendToSelected(payload) {
  const mac = selectedKartMac();
  if (mac && mac !== KartRegistry.DEFAULT_MAC) payload.target_mac = mac;
  return bridgeSend(payload);
}

const CAL_TOGGLES = [
  ['setInvertGx', 'invertGx'], ['setInvertGy', 'invertGy'], ['setSwapG', 'swapG'],
  ['setInvertYaw', 'invertYaw'], ['setInvertRollRate', 'invertRollRate'],
];

function renderKartSettings() {
  const sect = $('kartSettingsSection');
  if (!sect) return;
  // Fokus-Schutz wie renderKartsTab: offenes Dropdown / fokussierte
  // Panel-Inputs nicht per 1-Hz-Refresh zerstoeren.
  const ae = document.activeElement;
  if (ae && sect.contains(ae) && (ae.tagName === 'INPUT' || ae.tagName === 'SELECT')) return;
  const macs = kartRosterMacs();
  const empty = $('kartSettingsEmpty'), panels = $('kartSettingsPanels'), sel = $('kartSettingsSelect');
  const has = macs.length > 0;
  if (empty) empty.style.display = has ? 'none' : '';
  if (panels) panels.style.display = has ? '' : 'none';
  if (sel) sel.style.display = has ? '' : 'none';
  if (!has || !sel) return;
  const mac = selectedKartMac();
  sel.innerHTML = macs.map((m, i) => {
    const name = kartMetaFor(m, i).name;
    const off = state.karts.has(m) ? '' : ' (offline)';
    return '<option value="' + esc(m) + '"' + (m === mac ? ' selected' : '') + '>'
      + esc(name) + off + '</option>';
  }).join('');
  _renderCalPanel(mac);
  _renderEspPanel(mac);
}

function _renderCalPanel(mac) {
  const c = kartCalFor(mac);
  const online = !!_liveKart(mac);
  for (const [id] of CAL_TOGGLES) { const el = $(id); if (el) el.disabled = !c; }
  if (c) {
    setText('gxOffsetText', (Number(c.gxZero) || 0).toFixed(2));
    setText('gyOffsetText', (Number(c.gyZero) || 0).toFixed(2));
    for (const [id, key] of CAL_TOGGLES) { const el = $(id); if (el) el.checked = !!c[key]; }
  } else {
    setText('gxOffsetText', '--');
    setText('gyOffsetText', '--');
  }
  // Live-Aktionen brauchen Telemetrie des gewaehlten Karts.
  if ($('zeroImuBtn')) $('zeroImuBtn').disabled = !online || _zeroBusy;
  if ($('zeroRollBtn')) $('zeroRollBtn').disabled = !online;
  if ($('resetImuBtn')) $('resetImuBtn').disabled = !c;
  setText('kartCalHint', !c ? 'Keine Kalibrierdaten für dieses Kart.'
    : (online ? '' : 'Kart offline — Nullpunkt/Roll nullen erst bei Live-Telemetrie.'));
}

function _renderEspPanel(mac) {
  const online = !!_liveKart(mac);
  const usable = online && !!(state.serial && state.serial.connected);
  for (const [id] of ESP_CFG_FIELDS) { const el = $(id); if (el) el.disabled = !usable; }
  if ($('espSendBtn')) $('espSendBtn').disabled = !usable;
  // Status nur bei ZUSTANDSWECHSEL schreiben — Sende-/Ack-Meldungen
  // (espSendStatus) sonst nicht bei jedem 1-Hz-Render ueberschreiben.
  if (usable !== _lastEspUsable) {
    _lastEspUsable = usable;
    setText('espSendStatus', usable ? ''
      : (online ? 'Bridge nicht verbunden' : 'Kart nicht verbunden — Konfig erscheint bei Live-Telemetrie'));
  }
}

function initKartSettings() {
  const sel = $('kartSettingsSelect');
  if (sel) sel.onchange = () => {
    _selectedMac = sel.value || null;
    sel.blur();   // Fokus-Schutz freigeben, sonst friert der 1-Hz-Refresh ein
    renderKartSettings();
    // Ist-Konfig des neu gewaehlten Karts anfragen — config_ack fuellt das
    // Formular (Filter in applyEspConfigAck laesst nur dieses Kart durch).
    if (state.serial && state.serial.connected && _liveKart(selectedKartMac())) {
      _sendToSelected({ type: 'config_get' });
    }
  };
  for (const [id, key] of CAL_TOGGLES) {
    const el = $(id);
    if (el) el.onchange = () => {
      const c = kartCalFor(selectedKartMac());
      if (!c) return;
      c[key] = !!el.checked;
      drawGMeter._trail = [];
      saveData();
      renderKartSettings();
    };
  }
  if ($('zeroRollBtn')) $('zeroRollBtn').onclick = () => {
    const k = _liveKart(selectedKartMac());
    if (!k) return;
    // Aktuellen fusionierten Rollwinkel (inkl. bestehendem Offset) als neue 0 setzen.
    k.calibration.rollZero = k.calibration.rollZero + ((k.attitude && k.attitude.rollDeg) || 0);
    k.attitude.rollDeg = 0;
    k.attitude.overState = { active: false };
    k.attitude.over = false;
    saveData();
    rcToast('Rollwinkel genullt', 1500);
  };
  if ($('zeroImuBtn')) $('zeroImuBtn').onclick = () => {
    const btn = $('zeroImuBtn');
    if (btn.disabled || _zeroBusy) return;
    const mac = selectedKartMac();
    if (!_liveKart(mac)) return;
    _zeroBusy = true;
    const original = btn.textContent;
    btn.disabled = true;
    // Sender-seitige Kalibrierung mitstarten (am gewaehlten Kart)
    try {
      _sendToSelected({ type: 'imu_calibrate', action: 'auto', duration_ms: 2000 });
    } catch (e) { console.warn('imu_calibrate send:', e); }
    // Client-seitig: 2 Sekunden lang Samples des gewaehlten Karts mitteln
    const samples = [];
    const start = Date.now();
    const duration = 2000;
    const tick = setInterval(() => {
      const elapsed = Date.now() - start;
      const k = _liveKart(mac);
      if (k) samples.push({ x: k.raw.gx || 0, y: k.raw.gy || 0 });
      const remain = Math.max(0, duration - elapsed) / 1000;
      btn.textContent = `Kart still halten… ${remain.toFixed(1)}s`;
      if (elapsed >= duration) {
        clearInterval(tick);
        const k2 = _liveKart(mac);
        if (k2 && samples.length >= 5) {
          const avgX = samples.reduce((s, p) => s + p.x, 0) / samples.length;
          const avgY = samples.reduce((s, p) => s + p.y, 0) / samples.length;
          k2.calibration.gxZero = avgX;
          k2.calibration.gyZero = avgY;
          saveData();
          rcToast(`Nullpunkt gesetzt (${samples.length} Samples)`);
        } else {
          rcToast('Zu wenige Samples — kommen Telemetrie-Daten an?');
        }
        btn.textContent = original;
        btn.disabled = false;
        _zeroBusy = false;
        renderKartSettings();
      }
    }, 50);
  };
  if ($('resetImuBtn')) $('resetImuBtn').onclick = () => {
    const c = kartCalFor(selectedKartMac());
    if (!c) return;
    c.gxZero = 0;
    c.gyZero = 0;
    saveData();
    // Sender-Offsets ebenfalls zuruecksetzen (am gewaehlten Kart)
    try { _sendToSelected({ type: 'imu_calibrate', action: 'reset' }); } catch (e) {}
    rcToast('IMU-Kalibrierung zurückgesetzt');
    renderKartSettings();
  };
  if ($('espSendBtn')) $('espSendBtn').onclick = () => {
    const mac = selectedKartMac();
    const k = _liveKart(mac);
    const cfg = {
      type: 'config',
      max_rpm: Number($('espMaxRpm').value) || 6000,
      warn_rpm: Number($('espWarnRpm').value) || 5500,
      send_ms: Number($('espSendMs').value) || 80,
      pulses_per_rev: Number($('espPulses').value) || 1,
      wheel_circ_m: Number($('espWheelCirc').value) || 0,
      gear_ratio: Number($('espGearRatio').value) || 1,
      batt_cells: Number($('espBattCells').value) || 1,
      batt_warn_v: Number($('espBattWarnV').value) || 3.5,
      batt_crit_v: Number($('espBattCritV').value) || 3.3,
      batt_cal: Number($('espBattCal').value) || 1.0,
      rpm_ceiling: Math.max(0, Number($('espRpmCeiling').value) || 0),
      rpm_alpha: Number($('espRpmAlpha').value) || 0.25,
      page_ms: Number($('espPageMs').value) || 4000,
    };
    if (!state.serial.connected || !k) {
      setText('espSendStatus', !state.serial.connected ? 'Nicht verbunden' : 'Kart nicht verbunden');
      return;
    }
    k.batt.cells = cfg.batt_cells;
    try {
      _sendToSelected(cfg);
      setText('espSendStatus', '✓ Gesendet — warte auf Bestätigung…');
      armEspAckTimer(3000, () => {
        setText('espSendStatus', '⚠ Keine Bestätigung vom Kart — Funkverbindung prüfen');
      });
    } catch (e) {
      setText('espSendStatus', '✗ Fehler');
    }
  };
}

// ESM-Export (Phase 47)
export { renderKartSettings, selectedKartMac, initKartSettings };
```

- [ ] **Step 2: karts-page.js verdrahten**

Import ergänzen (nach dem RasiKartBar-Import):

```js
import { renderKartSettings } from './kart-settings.js';
```

In `renderKartsTab()` direkt nach `if (!list) return;` einfügen:

```js
  // Phase 47: Dropdown+Panels der Kart-Einstellungen (eigener Fokus-Schutz).
  renderKartSettings();
```

- [ ] **Step 3: app.js Import-Kette**

Nach `import './karts-page.js';` einfügen:

```js
import './kart-settings.js';
```

- [ ] **Step 4: Verifikation**

Run: `node --check src/kart-settings.js && node --check src/karts-page.js && node --check src/app.js` → keine Ausgabe.
Run: `npm test` → 194 pass.
Zeilen-Gate: `(Get-Content src/kart-settings.js | Measure-Object -Line).Lines` ≤ 520.

- [ ] **Step 5: Commit**

```bash
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" add src/kart-settings.js src/karts-page.js src/app.js
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" commit -m "feat(karts): kart-settings.js -- Dropdown + Kalibrier-/ESP-Panels im Karts-Tab (Phase 47 Task 4)"
```

---

### Task 5: Rückbau app-init.js + settings-ui.js

**Files:**
- Modify: `src/app-init.js` (Handler-Blöcke ~Z. 165–254, Imports ~Z. 32–38, init-Aufruf)
- Modify: `src/settings-ui.js` (loadSettingsToUi ~Z. 94–123, saveSettingsFromUi ~Z. 137–166, Imports)

**Interfaces:**
- Consumes: `initKartSettings` aus `./kart-settings.js` (Task 4).
- Produces: `loadSettingsToUi()`/`saveSettingsFromUi()` ohne jeden Kalibrierungs-/`activeKart()`-Zugriff.

- [ ] **Step 1: app-init.js — Handler entfernen, initKartSettings einhängen**

Region ~Z. 164–254 frisch Read-en. Die vier Blöcke `if ($('zeroRollBtn')) …`, `$('zeroImuBtn').onclick = …`, `$('resetImuBtn').onclick = …`, `$('espSendBtn').onclick = async () => { … }` (vom Kommentar `// Settings tab` bis vor `$('exportAllBtn').onclick = exportAll;`) ersetzen durch:

```js
  // Settings tab
  // Kalibrier-/ESP-Handler leben seit Phase 47 in kart-settings.js
  initKartSettings();
```

- [ ] **Step 2: app-init.js — Imports bereinigen**

- `import { armEspAckTimer } from './esp-config.js';` (Z. 33) löschen.
- Im rasicross-Import (Z. 37–38) `bridgeSend, ` entfernen — vorher mit Grep bestätigen, dass `bridgeSend` in app-init.js nur noch in der Import-Zeile vorkommt.
- Import ergänzen: `import { initKartSettings } from './kart-settings.js';`
- Mit Grep prüfen, ob `activeKart` in app-init.js außerhalb der Import-Zeile noch vorkommt (z. B. Demo-/Recording-Pfade): **nur wenn 0 Treffer**, aus dem store-Import entfernen; sonst stehen lassen.

- [ ] **Step 3: settings-ui.js — Kalibrier-Anteile entfernen**

In `loadSettingsToUi()`: die Zeile `const k = activeKart();` sowie die 7 Zeilen `$('gxOffsetText')…`/`$('gyOffsetText')…`/`if ($('setInvertGx'))…` bis `…invertRollRate;` löschen.

In `saveSettingsFromUi()`: die Zeile `const k = activeKart();`, die 5 Zeilen `k.calibration.invertGx = …` bis `k.calibration.invertRollRate = …` und die Zeile `drawGMeter._trail = [];` löschen.

Imports anpassen: `drawGMeter` aus dem gauges-Import und `activeKart` aus dem store-Import entfernen (vorher per Grep bestätigen, dass beide in settings-ui.js sonst nirgends vorkommen).

- [ ] **Step 4: Verifikation**

- `node --check src/app-init.js && node --check src/settings-ui.js` → keine Ausgabe.
- Grep `zeroImuBtn|espSendBtn|zeroRollBtn|resetImuBtn` in `src/app-init.js` → 0 Treffer.
- Grep `calibration` in `src/settings-ui.js` → 0 Treffer.
- Grep `initKartSettings` in `src/app-init.js` → 2 Treffer (Import + Aufruf).
- `npm test` → 194 pass.

- [ ] **Step 5: Commit**

```bash
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" add src/app-init.js src/settings-ui.js
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" commit -m "refactor(settings): Kalibrier-/ESP-Handler aus app-init/settings-ui in kart-settings verlagert (Phase 47 Task 5)"
```

---

### Task 6: config_ack-Filter (esp-config.js + telemetry.js)

**Files:**
- Modify: `src/esp-config.js` (~Z. 22)
- Modify: `src/telemetry.js` (~Z. 17 + ~Z. 112)

**Interfaces:**
- Consumes: `selectedKartMac` aus `./kart-settings.js` (Task 4).
- Produces: `applyEspConfigAck(d, expectedMac)` — verwirft Acks mit gesetztem `from_mac`, das nicht `expectedMac` ist; ohne `expectedMac` oder ohne `from_mac` bleibt das bisherige Verhalten (Abwärtskompatibilität zu alter Firmware ohne from_mac).

- [ ] **Step 1: esp-config.js**

Funktionskopf ersetzen — alt: `function applyEspConfigAck(d) {` neu:

```js
function applyEspConfigAck(d, expectedMac) {
  // Phase 47: Das Formular zeigt das im Karts-Tab GEWAEHLTE Kart — Acks
  // fremder Karts nicht uebernehmen. Ohne from_mac (alte Firmware) oder
  // ohne Erwartung: Verhalten wie bisher.
  if (expectedMac && d.from_mac && d.from_mac !== expectedMac) return;
```

- [ ] **Step 2: telemetry.js**

Import ergänzen (bei den bestehenden Imports):

```js
import { selectedKartMac } from './kart-settings.js';
```

Aufruf ersetzen — alt: `if (d.type === 'config_ack') { applyEspConfigAck(d); return; }` neu:

```js
    if (d.type === 'config_ack') { applyEspConfigAck(d, selectedKartMac()); return; }
```

(Kein Zyklusproblem: kart-settings.js importiert telemetry.js nicht.)

- [ ] **Step 3: Verifikation**

`node --check src/esp-config.js && node --check src/telemetry.js`; `npm test` → 194 pass.

- [ ] **Step 4: Commit**

```bash
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" add src/esp-config.js src/telemetry.js
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" commit -m "feat(esp): config_ack nur vom gewaehlten Kart ins Formular uebernehmen (Phase 47 Task 6)"
```

---

### Task 7: Playwright-Smoke + volle Gates

**Files:**
- Modify: `e2e/karts.spec.js` (ans Dateiende anhängen)

**Interfaces:**
- Consumes: `#kartSettingsSelect`, `#setInvertGx` in `#tab-karts` (Task 3/4); `RasiTest.state.karts` (bestehende Test-Brücke).

- [ ] **Step 1: Zwei Tests anhängen**

```js

test('Kart-Einstellungen: Toggle wirkt auf das im Dropdown gewaehlte Kart', async () => {
  await startDemo();
  await page.click('.nav-item[data-tab="karts"]');
  await page.waitForFunction(() => document.querySelectorAll('#kartSettingsSelect option').length >= 3);
  const { active, other } = await page.evaluate(() => {
    const a = RasiTest.state.karts.activeMac();
    const demo = RasiTest.state.karts.macs().filter((m) => m.indexOf('DE:MO:') === 0);
    return { active: a, other: demo.find((m) => m !== a) };
  });
  await page.selectOption('#kartSettingsSelect', other);
  // Checkbox sitzt unsichtbar im Toggle-Label -- Change-Event direkt ausloesen.
  await page.evaluate(() => {
    const el = document.getElementById('setInvertGx');
    el.checked = true;
    el.dispatchEvent(new Event('change'));
  });
  const probe = await page.evaluate(([a, o]) => ({
    otherInv: RasiTest.state.karts.get(o).calibration.invertGx,
    activeInv: RasiTest.state.karts.get(a).calibration.invertGx,
  }), [active, other]);
  expect(probe.otherInv).toBe(true);
  expect(probe.activeInv).toBe(false);
  expect(errors).toEqual([]);
});

test('Einstellungen-Tab ohne Kart-Einstellungen, Karts-Tab traegt sie', async () => {
  await page.click('.nav-item[data-tab="settings"]');
  const probe = await page.evaluate(() => ({
    imuInSettings: !!document.querySelector('#tab-settings #setInvertGx'),
    espInSettings: !!document.querySelector('#tab-settings #espMaxRpm'),
    navFahrdynamik: !!document.querySelector('#tab-settings .settings-nav-item[data-sgroup="fahrdynamik"]'),
    navBridge: !!document.querySelector('#tab-settings .settings-nav-item[data-sgroup="bridge"]'),
    navSensorik: !!document.querySelector('#tab-settings .settings-nav-item[data-sgroup="sensorik"]'),
    imuInKarts: !!document.querySelector('#tab-karts #setInvertGx'),
    espInKarts: !!document.querySelector('#tab-karts #espMaxRpm'),
    displayMsInSettings: !!document.querySelector('#tab-settings #setDisplayUpdateMs'),
  }));
  expect(probe.imuInSettings).toBe(false);
  expect(probe.espInSettings).toBe(false);
  expect(probe.navFahrdynamik).toBe(true);
  expect(probe.navBridge).toBe(true);
  expect(probe.navSensorik).toBe(false);
  expect(probe.imuInKarts).toBe(true);
  expect(probe.espInKarts).toBe(true);
  expect(probe.displayMsInSettings).toBe(true);
  expect(errors).toEqual([]);
});
```

- [ ] **Step 2: Volle Gates**

- `npm test` → 194 pass, 0 fail.
- `npm run lint` → 0 Fehler.
- `npm run test:e2e` → alle Specs grün (bestehende + 2 neue; falls ein Bestandstest durch den Umbau bricht, Ursache fixen — nicht den Test).
- Python-Regressionsgate (unverändert erwartete Baseline): `python -m unittest discover -s test -p "test_*.py"` → `Ran 17 tests` `OK` (ggf. `py -3`).
- `__pycache__` löschen, falls entstanden.

- [ ] **Step 3: Commit**

```bash
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" add e2e/karts.spec.js
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" commit -m "test(e2e): Kart-Einstellungen-Dropdown + bereinigter Settings-Tab (Phase 47 Task 7)"
```

---

### Task 8: Graph aktualisieren + Plan-Doc committen

- [ ] **Step 1:** `graphify update .` (AST-only, hält graphify-out/ aktuell).
- [ ] **Step 2:** Plan-Doc committen (einzige erlaubte Plan-Doc-Stage):

```bash
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" add docs/superpowers/plans/2026-07-12-47-kart-settings-menu.md
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" commit -m "docs(plan): Phase 47 Kart-Einstellungen im Karts-Tab Implementierungsplan"
```

- [ ] **Step 3:** `git status` sauber (keine `.claude/`-, keine `graphify-out/`-Stages, außer graphify-out ist bereits untracked-ignoriert — im Zweifel NICHT staggen).

---

## Hardware/Manual Acceptance Checklist (User, nach Merge)

- [ ] Zwei echte Karts online: Dropdown zeigt beide; Kart B wählen → „An ESP32 senden" ändert **nur** Kart B (OLED/Verhalten), Kart A unverändert.
- [ ] Kart B wählen + `config_get`-Roundtrip: Formular zeigt die auf Kart B gespeicherten Werte (nicht die von A).
- [ ] „Nullpunkt setzen" mit gewähltem Kart B, während A aktiv ist: Offsets landen bei B (Karts-Tab-Karte von B zeigt neue Gx/Gy-Offsets).
- [ ] Offline-Kart im Dropdown: Toggles änderbar, Nullpunkt/ESP deaktiviert mit Hinweis.
- [ ] Einstellungen-Tab: Suche nach „esp"/„invertieren" liefert keine Treffer mehr; Fahrdynamik + Bridge vorhanden.
- [ ] Sichtprüfung Portable-EXE (Layout des neuen Abschnitts, Light/Dark).

## Self-Review

- **Spec-Abdeckung:** Dropdown+Panel (T3/T4), explizites target_mac (T4 `_sendToSelected`), config_get bei Auswahlwechsel (T4), from_mac-Filter (T6), Offline-Verhalten (T4 Render + Disable), Settings-Tab fahrdynamik/bridge (T2/T3), SETTINGS_INDEX bereinigt (T2), Karten-Zusammenfassung unangetastet (kein Task ändert `_calHtml`), Tests (T1/T2/T7). `state.settings.uiActiveGroup` mit Alt-Wert `sensorik`/`hardware` fällt via settingsNavReducer auf `dashboard` — kein Migrationscode nötig.
- **Platzhalter-Scan:** keine TBD/TODO; jeder Code-Step trägt vollständigen Code.
- **Typ-/Namens-Konsistenz:** `renderKartSettings`/`selectedKartMac`/`initKartSettings` (T4) = Verbraucher in T5 (app-init) und T6 (telemetry); `resolveSelectedMac(selected, activeMac, macs)` (T1) = Aufruf in T4; `applyEspConfigAck(d, expectedMac)` (T6) = einziger Aufrufer telemetry.js.

## Phasen-Karte

- Phase 46 (Karts-Tab, PR #67/#68): Voraussetzung — Roster-Accessoren, karts-page.js.
- **Phase 47 (dieser Plan): Kart-Einstellungen im Karts-Tab.**
- Spec: `docs/superpowers/specs/2026-07-12-kart-settings-menu-design.md`.
