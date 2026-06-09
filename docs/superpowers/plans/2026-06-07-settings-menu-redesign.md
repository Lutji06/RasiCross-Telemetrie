# Einstellungsmenü-Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Den Tab „Einstellungen" von einem flachen 6-Karten-Raster zu einem Sidebar-+-Panel-Layout mit sauberen Zeilen und Auto-Save umbauen.

**Architecture:** Reine, testbare Logik (Sub-Nav-Reducer + Such-Filter) zieht in ein neues UMD-Modul `settings.js` (Muster wie `dom-targets.js`/`drift.js`). Das Markup von `#tab-settings` wird zu Sidebar + 6 Panels umstrukturiert — **alle bestehenden Element-IDs bleiben erhalten**, sodass die vorhandene JS-Verdrahtung weiterläuft. Auto-Save hängt den bereits vollständigen `saveSettingsFromUi()` an delegierte `change`-Events statt an einen Button.

**Tech Stack:** Vanilla JS (UMD-Module, `sourceType: script`), `node:test`, ESLint 9 Flat-Config, Single-File-HTML mit globalen `<script>`-Tags, Electron.

**Bezug:** Spec `docs/superpowers/specs/2026-06-07-settings-menu-redesign-design.md`.

> **CRLF-Hinweis:** Das Repo nutzt CRLF. Zeilennummern unten sind **indikativ** — vor jedem Edit die Zieldatei frisch lesen und auf **Text** ankern, nicht auf Zeilennummern.

> **Reconciliation zur Spec:** Spec §2/§7 notierte „keine neue .js-Datei / Script-Tags unverändert". Da §8 `node --test`-Fälle für `settingsNavReducer`/`settingsFilter` verlangt und testbare reine Logik in diesem Projekt **immer** als eigenes UMD-Modul vorliegt, wird `settings.js` neu angelegt und regulär registriert (HTML-Script-Tag, `package.json`, `eslint.config.js`). Schema `state.settings` bleibt unverändert (nur additiv `uiActiveGroup`).

---

## File Structure

**Neu:**
- `settings.js` — UMD-Modul: `GROUPS`, `settingsNavReducer`, `SETTINGS_INDEX`, `settingsFilter`. Setzt `window.RasiSettings`. Rein, kein DOM, wirft nie.
- `test/settings.test.js` — `node:test`-Suite für die beiden reinen Funktionen.

**Geändert:**
- `RasiCross_Telemetry.html` — (a) `<script src="settings.js">` vor `rasicross.js`; (b) CSS für `.settings-shell`/`-nav`/`-row`; (c) `#tab-settings`-Markup → Sidebar + 6 Panels (IDs erhalten).
- `rasicross.js` — Sub-Nav-Verdrahtung, Such-Verdrahtung, Auto-Save (delegierter Listener + Inline-Indikator), Entfernen der `saveSettingsBtn`-Bindung, `rcToast` → `flashSettingsSaved()`.
- `eslint.config.js` — Block für `settings.js`; `RasiSettings: 'readonly'` zu `rasicross.js`-Globals.
- `package.json` — `"settings.js"` in `build.files`.

---

## Task 1: Pures Modul `settings.js` — Sub-Nav-Reducer

**Files:**
- Create: `settings.js`
- Test: `test/settings.test.js`

- [ ] **Step 1: Failing test schreiben**

Create `test/settings.test.js`:

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { GROUPS, settingsNavReducer } = require('../settings.js');

test('GROUPS: frozen, sechs bekannte Gruppen, dashboard zuerst', () => {
  assert.equal(Object.isFrozen(GROUPS), true);
  assert.deepEqual(GROUPS, ['dashboard', 'sensorik', 'hardware', 'model3d', 'map', 'data']);
});

test('settingsNavReducer: set wechselt auf gueltige Gruppe', () => {
  assert.equal(settingsNavReducer('dashboard', { type: 'set', id: 'hardware' }), 'hardware');
});

test('settingsNavReducer: set auf unbekannte id -> bleibt bei current', () => {
  assert.equal(settingsNavReducer('map', { type: 'set', id: 'nope' }), 'map');
});

test('settingsNavReducer: ungueltige current -> faellt auf dashboard', () => {
  assert.equal(settingsNavReducer('quatsch', { type: 'noop' }), 'dashboard');
  assert.equal(settingsNavReducer(undefined, { type: 'noop' }), 'dashboard');
});

test('settingsNavReducer: unbekannte action -> identity (geklemmt)', () => {
  assert.equal(settingsNavReducer('sensorik', { type: 'wat' }), 'sensorik');
  assert.equal(settingsNavReducer('sensorik', null), 'sensorik');
});
```

- [ ] **Step 2: Test laufen lassen, Fehlschlag bestätigen**

Run: `node --test test/settings.test.js`
Expected: FAIL — `Cannot find module '../settings.js'`.

- [ ] **Step 3: Minimale Implementierung**

Create `settings.js`:

```js
'use strict';
/*!
 * settings.js — pure Logik fuer den Einstellungs-Tab:
 *   - settingsNavReducer: aktive Gruppe (Muster wie kartModelYawReducer)
 *   - settingsFilter:     Suche/Filter ueber SETTINGS_INDEX (Task 2)
 * Reines UMD-Modul — kein DOM, keine Seiteneffekte, wirft nie.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.RasiSettings = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {

  const GROUPS = Object.freeze(['dashboard', 'sensorik', 'hardware', 'model3d', 'map', 'data']);

  function settingsNavReducer(current, action) {
    const cur = GROUPS.includes(current) ? current : GROUPS[0];
    if (action && action.type === 'set' && GROUPS.includes(action.id)) {
      return action.id;
    }
    return cur;
  }

  return { GROUPS, settingsNavReducer };
}));
```

- [ ] **Step 4: Test laufen lassen, Erfolg bestätigen**

Run: `node --test test/settings.test.js`
Expected: PASS (5 Tests).

- [ ] **Step 5: Commit**

```bash
git add settings.js test/settings.test.js
git commit -m "feat(settings): pure settingsNavReducer + GROUPS module"
```

---

## Task 2: `settings.js` — Such-Filter + SETTINGS_INDEX

**Files:**
- Modify: `settings.js`
- Test: `test/settings.test.js`

- [ ] **Step 1: Failing tests ergänzen**

In `test/settings.test.js` die Import-Zeile ersetzen und Tests anhängen:

```js
const { GROUPS, settingsNavReducer, SETTINGS_INDEX, settingsFilter } = require('../settings.js');

test('SETTINGS_INDEX: nicht-leer, jede Gruppe gueltig, Felder vorhanden', () => {
  assert.ok(Array.isArray(SETTINGS_INDEX) && SETTINGS_INDEX.length > 0);
  for (const e of SETTINGS_INDEX) {
    assert.ok(GROUPS.includes(e.group), `unbekannte group: ${e.group}`);
    assert.equal(typeof e.rowId, 'string');
    assert.equal(typeof e.label, 'string');
    assert.ok(Array.isArray(e.keywords));
  }
});

test('settingsFilter: leerer Query -> alle Gruppen & Zeilen sichtbar', () => {
  const r = settingsFilter('', SETTINGS_INDEX);
  assert.equal(r.rows.size, SETTINGS_INDEX.length);
  assert.equal(r.groups.size, new Set(SETTINGS_INDEX.map(e => e.group)).size);
});

test('settingsFilter: Treffer per Label', () => {
  const r = settingsFilter('Max Speed', SETTINGS_INDEX);
  assert.ok(r.rows.has('setMaxSpeed'));
  assert.ok(r.groups.has('dashboard'));
});

test('settingsFilter: Treffer per Keyword (Synonym)', () => {
  const r = settingsFilter('akku', SETTINGS_INDEX);
  assert.ok(r.rows.has('espBattCells'));
  assert.ok(r.groups.has('hardware'));
});

test('settingsFilter: case- und diakritik-tolerant', () => {
  const r = settingsFilter('UMKIPP', SETTINGS_INDEX);
  assert.ok(r.rows.has('setRolloverAngle'));
});

test('settingsFilter: kein Treffer -> leere Sets', () => {
  const r = settingsFilter('zzzznix', SETTINGS_INDEX);
  assert.equal(r.rows.size, 0);
  assert.equal(r.groups.size, 0);
});
```

- [ ] **Step 2: Test laufen lassen, Fehlschlag bestätigen**

Run: `node --test test/settings.test.js`
Expected: FAIL — `settingsFilter is not a function` / `SETTINGS_INDEX` undefined.

- [ ] **Step 3: Implementierung ergänzen**

In `settings.js` vor `return { ... }` einfügen und das Return erweitern:

```js
  // rowId == bestehende DOM-Element-ID. keywords: deutsche Synonyme fuer die Suche.
  const SETTINGS_INDEX = Object.freeze([
    { group: 'dashboard', rowId: 'setMaxSpeed',       label: 'Max Speed',            keywords: ['tacho', 'geschwindigkeit', 'kmh', 'speed', 'skala'] },
    { group: 'dashboard', rowId: 'setMaxRpm',         label: 'Max RPM',              keywords: ['drehzahl', 'umdrehung', 'rpm'] },
    { group: 'dashboard', rowId: 'setRpmWarn',        label: 'RPM-Warnung ab',       keywords: ['drehzahl', 'warnung', 'limit', 'rpm'] },
    { group: 'dashboard', rowId: 'setGScale',         label: 'G-Skala',              keywords: ['gmeter', 'beschleunigung', 'g', 'skala'] },
    { group: 'dashboard', rowId: 'setMinLap',         label: 'Mindest-Rundenzeit',   keywords: ['runde', 'lap', 'zeit', 'minimum'] },
    { group: 'sensorik',  rowId: 'setInvertGx',       label: 'Gx invertieren',       keywords: ['imu', 'achse', 'kalibrierung', 'g'] },
    { group: 'sensorik',  rowId: 'setInvertGy',       label: 'Gy invertieren',       keywords: ['imu', 'achse', 'kalibrierung', 'g'] },
    { group: 'sensorik',  rowId: 'setSwapG',          label: 'Gx Gy tauschen',       keywords: ['imu', 'achse', 'swap', 'tauschen'] },
    { group: 'sensorik',  rowId: 'setInvertYaw',      label: 'Gier invertieren',     keywords: ['imu', 'yaw', 'gier', 'drift'] },
    { group: 'sensorik',  rowId: 'setDriftTol',       label: 'Drift-Empfindlichkeit', keywords: ['drift', 'toleranz', 'empfindlichkeit'] },
    { group: 'sensorik',  rowId: 'setDriftMinSpeed',  label: 'Drift Min-Tempo',      keywords: ['drift', 'tempo', 'speed', 'minimum'] },
    { group: 'sensorik',  rowId: 'setRolloverAngle',  label: 'Umkipp-Schwelle',      keywords: ['umkippen', 'rollover', 'rollwinkel', 'grad', 'sicherheit'] },
    { group: 'hardware',  rowId: 'espMaxRpm',         label: 'Max RPM (Sender)',     keywords: ['esp', 'sender', 'drehzahl', 'rpm'] },
    { group: 'hardware',  rowId: 'espWarnRpm',        label: 'Warn RPM (Sender)',    keywords: ['esp', 'sender', 'warnung', 'rpm'] },
    { group: 'hardware',  rowId: 'espSendMs',         label: 'Sende-Intervall',      keywords: ['esp', 'rate', 'intervall', 'ms'] },
    { group: 'hardware',  rowId: 'espPulses',         label: 'Pulses per Revolution', keywords: ['esp', 'puls', 'sensor', 'umdrehung'] },
    { group: 'hardware',  rowId: 'espWheelCirc',      label: 'Radumfang',            keywords: ['esp', 'rad', 'umfang', 'gps', 'meter'] },
    { group: 'hardware',  rowId: 'espGearRatio',      label: 'Uebersetzung',         keywords: ['esp', 'getriebe', 'gear', 'ratio', 'welle'] },
    { group: 'hardware',  rowId: 'espBattCells',      label: 'Akkuzellen in Reihe',  keywords: ['esp', 'akku', 'batterie', 'zellen', 'batt', 'lipo'] },
    { group: 'hardware',  rowId: 'setDisplayUpdateMs', label: 'OLED-Update Intervall', keywords: ['oled', 'display', 'bridge', 'intervall', 'ms'] },
    { group: 'model3d',   rowId: 'kartModelFile',     label: '3D-Modell laden',      keywords: ['kart', 'modell', '3d', 'glb', 'gltf', 'upload'] },
    { group: 'map',       rowId: 'setTilesEnabled',   label: 'OSM-Hintergrund',      keywords: ['karte', 'osm', 'tiles', 'hintergrund'] },
    { group: 'map',       rowId: 'setTilesPreset',    label: 'Karten-Stil',          keywords: ['karte', 'stil', 'preset', 'tiles'] },
    { group: 'map',       rowId: 'setTilesUrl',       label: 'Tile-URL-Template',    keywords: ['karte', 'url', 'tiles', 'eigene'] },
    { group: 'data',      rowId: 'recAutoArmToggle',  label: 'Aufnahme automatisch starten', keywords: ['aufnahme', 'record', 'auto', 'arm'] },
    { group: 'data',      rowId: 'exportAllBtn',      label: 'Alle Daten exportieren', keywords: ['export', 'backup', 'sichern'] },
    { group: 'data',      rowId: 'importAllBtn',      label: 'Daten importieren',    keywords: ['import', 'backup', 'laden'] },
    { group: 'data',      rowId: 'resetAllBtn',       label: 'Alle Daten zuruecksetzen', keywords: ['reset', 'loeschen', 'zuruecksetzen'] },
  ]);

  function _norm(s) {
    return String(s == null ? '' : s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
  }

  function settingsFilter(query, index) {
    const list = Array.isArray(index) ? index : SETTINGS_INDEX;
    const q = _norm(query);
    const rows = new Set();
    const groups = new Set();
    if (q === '') {
      for (const e of list) { rows.add(e.rowId); groups.add(e.group); }
      return { groups, rows, query: '' };
    }
    for (const e of list) {
      const hay = _norm(e.label + ' ' + (e.keywords || []).join(' ') + ' ' + e.group);
      if (hay.indexOf(q) !== -1) { rows.add(e.rowId); groups.add(e.group); }
    }
    return { groups, rows, query: q };
  }
```

Und das Return ersetzen:

```js
  return { GROUPS, settingsNavReducer, SETTINGS_INDEX, settingsFilter };
```

- [ ] **Step 4: Test laufen lassen, Erfolg bestätigen**

Run: `node --test test/settings.test.js`
Expected: PASS (11 Tests gesamt).

- [ ] **Step 5: Commit**

```bash
git add settings.js test/settings.test.js
git commit -m "feat(settings): settingsFilter + SETTINGS_INDEX with German keywords"
```

---

## Task 3: `settings.js` registrieren (ESLint, package.json, Script-Tag)

**Files:**
- Modify: `eslint.config.js`
- Modify: `package.json`
- Modify: `RasiCross_Telemetry.html` (nur Script-Tag)

- [ ] **Step 1: ESLint-Block für `settings.js` ergänzen**

In `eslint.config.js` nach dem `dom-targets.js`-Block (vor `tile-renderer.js`) einfügen:

```js
  // settings.js setzt window.RasiSettings (UMD, Browser + node:test)
  {
    files: ['settings.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: { ...globals.browser, module: 'readonly' },
    },
    rules: bugRules,
  },
```

- [ ] **Step 2: `RasiSettings` zu den `rasicross.js`-Globals**

In `eslint.config.js` im `files: ['rasicross.js']`-Block die Globals-Liste um eine Zeile erweitern (nach `RasiAttitude: 'readonly',`):

```js
        RasiAttitude: 'readonly',
        RasiSettings: 'readonly',
```

- [ ] **Step 3: `package.json` build.files ergänzen**

In `package.json` im Array `build.files` nach `"dom-targets.js",` einfügen:

```json
      "dom-targets.js",
      "settings.js",
```

- [ ] **Step 4: Script-Tag in HTML**

In `RasiCross_Telemetry.html` die Zeile mit `<script src="dom-targets.js"></script>` finden und direkt **danach** einfügen:

```html
<script src="settings.js"></script>
```

(Reihenfolge: nach `dom-targets.js`, vor `rasicross.js` — `RasiSettings` muss vor dem Renderer geladen sein.)

- [ ] **Step 5: Lint + Tests grün**

Run: `npm run lint`
Expected: kein Output, Exit 0.
Run: `node --test`
Expected: alle Suiten PASS (inkl. neuer settings-Tests).

- [ ] **Step 6: Commit**

```bash
git add eslint.config.js package.json RasiCross_Telemetry.html
git commit -m "chore(settings): register settings.js in lint, build, script tags"
```

---

## Task 4: HTML — `#tab-settings` zu Sidebar + 6 Panels umbauen

**Files:**
- Modify: `RasiCross_Telemetry.html` (Block `<section class="tab" id="tab-settings">` … `</section>`)

**Wichtig:** Alle `id="…"`-Attribute bleiben **identisch** zum Ist-Zustand. `data-autosave` kommt an Werte-Controls, die in `saveSettingsFromUi()` gelesen werden (Dashboard, Drift/Rollover, IMU-Toggles, OLED-Intervall, Tiles, recAutoArm). ESP32-Felder bekommen **kein** `data-autosave` (sie gehen per Button an den Kart). Aktions-Buttons bekommen **kein** `data-autosave`.

- [ ] **Step 1: Gesamten `#tab-settings`-Block ersetzen**

Den kompletten Block von `<section class="tab" id="tab-settings">` bis zum zugehörigen schließenden `</section>` (vor `</main>`) durch folgendes ersetzen:

```html
<section class="tab" id="tab-settings">
  <div class="settings-shell">
    <aside class="settings-nav">
      <div class="settings-search">
        <input type="text" id="settingsSearch" placeholder="Einstellung suchen…" autocomplete="off">
      </div>
      <button type="button" class="settings-nav-item active" data-sgroup="dashboard">Dashboard</button>
      <button type="button" class="settings-nav-item" data-sgroup="sensorik">Sensorik &amp; Fahrdynamik</button>
      <button type="button" class="settings-nav-item" data-sgroup="hardware">ESP32 / Hardware</button>
      <button type="button" class="settings-nav-item" data-sgroup="model3d">3D-Modell</button>
      <button type="button" class="settings-nav-item" data-sgroup="map">Karten-Hintergrund</button>
      <button type="button" class="settings-nav-item" data-sgroup="data">Daten &amp; Backup</button>
    </aside>

    <div class="settings-panels">

      <!-- ── Dashboard ─────────────────────────────────────── -->
      <section class="settings-group active" data-sgroup="dashboard">
        <header class="settings-group-head">
          <div><h2 class="settings-group-title">Dashboard</h2><p class="settings-group-sub">Anzeige-Limits &amp; Skalen</p></div>
          <span class="settings-saved" data-savemark>Automatisch gespeichert ✓</span>
        </header>
        <div class="settings-row">
          <div class="settings-row-label"><span class="settings-row-name">Max Speed</span><span class="settings-row-desc">Obergrenze der Tacho-Skala (km/h)</span></div>
          <input type="number" id="setMaxSpeed" value="80" min="20" max="200" data-autosave>
        </div>
        <div class="settings-row">
          <div class="settings-row-label"><span class="settings-row-name">Max RPM</span><span class="settings-row-desc">Vollausschlag des Drehzahlmessers</span></div>
          <input type="number" id="setMaxRpm" value="10000" min="3000" max="20000" step="500" data-autosave>
        </div>
        <div class="settings-row">
          <div class="settings-row-label"><span class="settings-row-name">RPM-Warnung ab</span><span class="settings-row-desc">Schwelle für die Drehzahl-Warnung</span></div>
          <input type="number" id="setRpmWarn" value="9000" min="2000" max="20000" step="500" data-autosave>
        </div>
        <div class="settings-row">
          <div class="settings-row-label"><span class="settings-row-name">G-Skala</span><span class="settings-row-desc">Maximaler Ausschlag des G-Meters</span></div>
          <select id="setGScale" data-autosave><option value="2">±2G</option><option value="3" selected>±3G</option><option value="4">±4G</option><option value="5">±5G</option></select>
        </div>
        <div class="settings-row">
          <div class="settings-row-label"><span class="settings-row-name">Mindest-Rundenzeit</span><span class="settings-row-desc">Kürzere Runden werden ignoriert (s)</span></div>
          <input type="number" id="setMinLap" value="10" min="3" max="300" data-autosave>
        </div>
        <p id="settingsHint" class="settings-foot-hint"></p>
      </section>

      <!-- ── Sensorik & Fahrdynamik ────────────────────────── -->
      <section class="settings-group" data-sgroup="sensorik">
        <header class="settings-group-head">
          <div><h2 class="settings-group-title">Sensorik &amp; Fahrdynamik</h2><p class="settings-group-sub">IMU-Kalibrierung, Drift, Umkippen</p></div>
          <span class="settings-saved" data-savemark>Automatisch gespeichert ✓</span>
        </header>
        <p class="settings-block-note">Mäher auf eine ebene Fläche stellen, dann „Nullpunkt setzen". Achsen-Korrekturen darunter.</p>
        <div class="row" style="margin-bottom:14px">
          <div class="stat"><div class="t">Gx Offset</div><div class="n" id="gxOffsetText">0.00</div></div>
          <div class="stat"><div class="t">Gy Offset</div><div class="n" id="gyOffsetText">0.00</div></div>
        </div>
        <div class="toggle-row"><span class="label-text">Gx invertieren</span><label class="toggle"><input type="checkbox" id="setInvertGx" data-autosave><span class="toggle-knob"></span></label></div>
        <div class="toggle-row"><span class="label-text">Gy invertieren</span><label class="toggle"><input type="checkbox" id="setInvertGy" data-autosave><span class="toggle-knob"></span></label></div>
        <div class="toggle-row"><span class="label-text">Gx ↔ Gy tauschen</span><label class="toggle"><input type="checkbox" id="setSwapG" data-autosave><span class="toggle-knob"></span></label></div>
        <div class="toggle-row"><span class="label-text">Gier invertieren</span><label class="toggle"><input type="checkbox" id="setInvertYaw" data-autosave><span class="toggle-knob"></span></label></div>
        <div class="row" style="gap:8px;margin:14px 0">
          <button class="btn primary" id="zeroImuBtn" style="flex:1">Nullpunkt setzen</button>
          <button class="btn ghost" id="resetImuBtn" style="flex:0 0 auto">Zurücksetzen</button>
          <button class="btn ghost" id="zeroRollBtn" style="flex:0 0 auto" title="Aktuellen Rollwinkel als 0 setzen">Roll nullen</button>
        </div>
        <div class="settings-row">
          <div class="settings-row-label"><span class="settings-row-name">Drift-Empfindlichkeit</span><span class="settings-row-desc">Toleranz des Drift-Index (kleiner = empfindlicher)</span></div>
          <input type="number" id="setDriftTol" value="0.25" min="0.05" max="1" step="0.05" data-autosave>
        </div>
        <div class="settings-row">
          <div class="settings-row-label"><span class="settings-row-name">Drift Min-Tempo</span><span class="settings-row-desc">Unter diesem Tempo keine Drift-Erkennung (km/h)</span></div>
          <input type="number" id="setDriftMinSpeed" value="5" min="1" max="60" step="1" data-autosave>
        </div>
        <div class="settings-row">
          <div class="settings-row-label"><span class="settings-row-name">Umkipp-Schwelle</span><span class="settings-row-desc">Rollwinkel, ab dem die Umkipp-Warnung auslöst (Grad)</span></div>
          <input type="number" id="setRolloverAngle" value="75" min="30" max="90" step="1" data-autosave>
        </div>
      </section>

      <!-- ── ESP32 / Hardware ──────────────────────────────── -->
      <section class="settings-group" data-sgroup="hardware">
        <header class="settings-group-head">
          <div><h2 class="settings-group-title">ESP32 / Hardware</h2><p class="settings-group-sub">Sender-Konfig (USB → Bridge → Kart) &amp; Bridge-Display</p></div>
          <span class="settings-saved" data-savemark>Automatisch gespeichert ✓</span>
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
        <div class="row" style="margin:6px 0 4px"><button class="btn primary" id="espSendBtn" style="flex:1">An ESP32 senden</button></div>
        <p id="espSendStatus" style="font-family:var(--mono);font-size:11px;color:var(--mut);margin-top:6px;text-align:center;min-height:14px"></p>
        <div class="settings-row" style="margin-top:8px">
          <div class="settings-row-label"><span class="settings-row-name">OLED-Update Intervall</span><span class="settings-row-desc">Aktualisierungsrate des Bridge-Displays (ms)</span></div>
          <input type="number" id="setDisplayUpdateMs" value="500" min="100" max="2000" step="50" data-autosave>
        </div>
      </section>

      <!-- ── 3D-Modell ─────────────────────────────────────── -->
      <section class="settings-group" data-sgroup="model3d" id="kartModelCard">
        <header class="settings-group-head">
          <div><h2 class="settings-group-title">3D-Modell</h2><p class="settings-group-sub">Kart-Viewer</p></div>
        </header>
        <p class="settings-block-note">Eigenes 3D-Modell (.glb / .gltf, max 10 MB). Vorderachse → +X, oben → +Y; wird automatisch eingepasst.</p>
        <div class="row" style="margin-bottom:14px">
          <div class="stat"><div class="t">Aktuell</div><div class="n" id="kartModelName">Standard (Primitive)</div></div>
        </div>
        <div class="row" style="gap:8px;margin-bottom:14px">
          <label class="btn primary" style="flex:1;cursor:pointer;text-align:center">
            📂 Datei wählen…
            <input type="file" id="kartModelFile" accept=".glb,.gltf" style="display:none">
          </label>
          <button class="btn ghost" id="kartModelResetBtn" style="flex:0 0 auto">Zurücksetzen</button>
        </div>
        <div class="stat" style="margin-bottom:8px"><div class="t">Ausrichtung (Heading)</div></div>
        <div class="g-view-toggle" id="kartModelYawToggle" style="display:flex;width:100%">
          <button type="button" data-yaw="0" class="active" style="flex:1">0°</button>
          <button type="button" data-yaw="90" style="flex:1">90°</button>
          <button type="button" data-yaw="180" style="flex:1">180°</button>
          <button type="button" data-yaw="270" style="flex:1">270°</button>
        </div>
      </section>

      <!-- ── Karten-Hintergrund ────────────────────────────── -->
      <section class="settings-group" data-sgroup="map">
        <header class="settings-group-head">
          <div><h2 class="settings-group-title">Karten-Hintergrund</h2><p class="settings-group-sub">OSM-Tiles</p></div>
          <span class="settings-saved" data-savemark>Automatisch gespeichert ✓</span>
        </header>
        <div class="toggle-row"><span class="label-text">OSM-Hintergrund anzeigen</span><label class="toggle"><input type="checkbox" id="setTilesEnabled" checked data-autosave><span class="toggle-knob"></span></label></div>
        <div class="field" style="margin-top:10px">
          <label>Karten-Stil</label>
          <select id="setTilesPreset" style="width:100%" data-autosave>
            <option value="">OSM Standard</option>
            <option value="https://basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png">Carto Hell (minimalistisch)</option>
            <option value="https://basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png">Carto Voyager (saubere Karte)</option>
            <option value="https://basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png">Carto Dark</option>
            <option value="https://a.tile.opentopomap.org/{z}/{x}/{y}.png">OpenTopoMap (Topo / Outdoor)</option>
            <option value="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}">Esri Satellit</option>
            <option value="__custom__">Eigene URL …</option>
          </select>
        </div>
        <div class="field" style="margin-top:10px">
          <label>Tile-URL-Template (leer = OSM Standard)</label>
          <input type="text" id="setTilesUrl" placeholder="z.B. https://api.maptiler.com/maps/streets/{z}/{x}/{y}.png?key=…" autocomplete="off" data-autosave>
          <small id="setTilesUrlHint" style="display:block;color:var(--mut);font-size:11px;margin-top:4px">{z}, {x}, {y} sind Pflicht.</small>
        </div>
        <div class="fieldset" style="margin-top:10px">
          <button class="btn ghost" id="tilesClearBtn">Cache leeren</button>
          <span id="tilesCacheInfo" style="display:block;color:var(--mut);font-size:11px;margin-top:6px">—</span>
        </div>
        <p style="color:var(--mut);font-size:12px;margin-top:10px">
          Karten-Tiles © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap-Mitwirkende</a>.
          Eigene Tile-URL nur mit gültiger Lizenz des jeweiligen Anbieters verwenden.
        </p>
      </section>

      <!-- ── Daten & Backup ────────────────────────────────── -->
      <section class="settings-group" data-sgroup="data">
        <header class="settings-group-head">
          <div><h2 class="settings-group-title">Daten &amp; Backup</h2><p class="settings-group-sub">Sichern &amp; Zurücksetzen</p></div>
          <span class="settings-saved" data-savemark>Automatisch gespeichert ✓</span>
        </header>
        <p class="settings-block-note">Alle Einstellungen, Fahrer, Strecken und Rennen werden im Browser gespeichert.</p>
        <div class="toggle-row"><span class="label-text">Aufnahme bei Verbindung automatisch starten</span><label class="toggle"><input type="checkbox" id="recAutoArmToggle" checked data-autosave><span class="toggle-knob"></span></label></div>
        <div class="fieldset" style="margin-top:12px">
          <button class="btn ghost" id="exportAllBtn">📥 Alle Daten exportieren</button>
          <button class="btn ghost" id="importAllBtn">📤 Daten importieren</button>
          <input type="file" id="importAllFile" accept=".json" style="display:none">
          <button class="btn danger" id="resetAllBtn" style="margin-top:8px">🗑 Alle Daten zurücksetzen</button>
        </div>
      </section>

    </div>
  </div>
</section>
```

- [ ] **Step 2: App starten, visuell grob prüfen**

Run: `npm start`
Expected: Tab „Einstellungen" zeigt links 6 Nav-Buttons + Suchfeld, rechts die Dashboard-Gruppe. (Sub-Nav/Suche/Auto-Save sind noch nicht verdrahtet — kommt in Task 6–8. Felder zeigen Defaults.)

- [ ] **Step 3: Lint grün (HTML hat keinen Lint, aber sicherstellen dass nichts an JS kaputt ist)**

Run: `npm run lint && node --test`
Expected: PASS (Markup-Änderung allein bricht keine Tests).

- [ ] **Step 4: Commit**

```bash
git add RasiCross_Telemetry.html
git commit -m "feat(settings): restructure tab into sidebar + 6 panels (rows), IDs preserved"
```

---

## Task 5: CSS — Settings-Layout (Sidebar, Zeilen, Indikator)

**Files:**
- Modify: `RasiCross_Telemetry.html` (CSS im `<style>`-Block)

- [ ] **Step 1: CSS-Regeln ergänzen**

Im `<style>`-Block (z.B. direkt vor dem `@media`-Block, der `#tab-settings` betrifft, oder ans Ende des Block-Bereichs für Tabs) einfügen. Nutzt ausschließlich bestehende `--vars`:

```css
/* ── Einstellungen: Sidebar + Panel + Zeilen ───────────────── */
.settings-shell{display:grid;grid-template-columns:230px 1fr;gap:18px;align-items:start}
.settings-nav{display:flex;flex-direction:column;gap:3px;background:var(--surf);border:1px solid var(--bor);border-radius:var(--r-lg);padding:10px;position:sticky;top:12px}
.settings-search input{width:100%;margin-bottom:8px;background:var(--surf2);border:1px solid var(--bor);border-radius:var(--r-sm);color:var(--tx);padding:8px 10px;font-family:var(--sans);font-size:13px}
.settings-search input::placeholder{color:var(--mut)}
.settings-nav-item{text-align:left;background:transparent;border:0;color:var(--tx-dim);font-family:var(--sans);font-size:13.5px;font-weight:600;padding:9px 11px;border-radius:var(--r-sm);cursor:pointer;transition:var(--t)}
.settings-nav-item:hover{background:var(--soft);color:var(--tx)}
.settings-nav-item.active{background:var(--pr);color:#0a0e02;box-shadow:0 0 20px var(--pr-soft)}
.settings-nav-item.search-hit{box-shadow:inset 2px 0 0 var(--pr)}
.settings-nav-item.search-dim{opacity:.35}

.settings-panels{min-width:0}
.settings-group{display:none;background:var(--surf);border:1px solid var(--bor);border-radius:var(--r-lg);padding:18px 20px}
.settings-group.active{display:block}
.settings-group-head{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;margin-bottom:14px}
.settings-group-title{font-size:17px;font-weight:700;color:var(--tx);margin:0}
.settings-group-sub{font-family:var(--mono);font-size:9px;letter-spacing:.12em;text-transform:uppercase;color:var(--mut);margin:3px 0 0}
.settings-block-note{color:var(--mut);font-size:12.5px;line-height:1.6;margin:0 0 14px}
.settings-foot-hint{font-family:var(--mono);font-size:11px;color:var(--mut);margin-top:10px}

.settings-saved{font-family:var(--mono);font-size:10px;color:var(--green);display:inline-flex;align-items:center;gap:5px;opacity:0;transition:opacity var(--t);white-space:nowrap}
.settings-saved.show{opacity:1}

.settings-row{display:flex;justify-content:space-between;align-items:center;gap:16px;padding:12px 0;border-bottom:1px solid var(--div)}
.settings-row:last-child{border-bottom:0}
.settings-row.row-hidden{display:none}
.settings-row.row-hit{background:var(--pr-soft);margin:0 -10px;padding-left:10px;padding-right:10px;border-radius:var(--r-sm)}
.settings-row-label{display:flex;flex-direction:column;gap:3px;min-width:0}
.settings-row-name{font-size:13.5px;color:var(--tx)}
.settings-row-desc{font-size:11.5px;color:var(--mut);line-height:1.4}
.settings-row input[type=number],.settings-row input[type=text],.settings-row select{flex:0 0 auto;width:130px;background:var(--surf2);border:1px solid var(--bor2);border-radius:var(--r-sm);color:var(--tx);padding:6px 12px;font-family:var(--mono);font-size:14px;text-align:right}
.settings-row input[type=text]{width:100%;max-width:340px;text-align:left}
.settings-row input:focus,.settings-row select:focus{outline:0;border-color:var(--pr);box-shadow:0 0 0 2px var(--pr-soft)}

@media(max-width:900px){
  .settings-shell{grid-template-columns:1fr}
  .settings-nav{flex-direction:row;flex-wrap:wrap;position:static}
  .settings-nav-item{flex:1 1 auto}
  .settings-search{flex:1 1 100%}
}
```

- [ ] **Step 2: Alte, jetzt verwaiste `#tab-settings .grid.g2`-Spezialregeln prüfen**

Run: `grep -n "tab-settings" RasiCross_Telemetry.html`
Falls alte `@media`-Regeln existieren, die `#tab-settings .grid` o.ä. betreffen und nun ins Leere zeigen: entfernen. (Die generischen `.card`/`.field`/`.toggle-row`/`.btn`-Klassen bleiben — sie werden in den Panels weiter genutzt.)

- [ ] **Step 3: App starten, Optik prüfen**

Run: `npm start`
Expected: Saubere Zeilen (Label links, Wert rechts), Lime-aktiver Nav-Button, Fokus-Felder leuchten lime. Responsive: Fenster < 900 px → Nav als Pillen oben.

- [ ] **Step 4: Commit**

```bash
git add RasiCross_Telemetry.html
git commit -m "style(settings): sidebar/rows CSS using existing design tokens"
```

---

## Task 6: rasicross.js — Sub-Navigation verdrahten

**Files:**
- Modify: `rasicross.js` (Init-Block bei den übrigen `$('…').onclick`-Bindungen; `state.settings`-Default; `loadSettingsToUi`)

- [ ] **Step 1: `showSettingsGroup`-Helper + Init einfügen**

In `rasicross.js` im Init-Bereich (nahe den anderen Settings-Bindungen, z.B. direkt vor der bisherigen `saveSettingsBtn`-Zeile) einfügen:

```js
function showSettingsGroup(id) {
  const next = RasiSettings.settingsNavReducer(
    (state.settings && state.settings.uiActiveGroup) || 'dashboard',
    { type: 'set', id }
  );
  state.settings.uiActiveGroup = next;
  document.querySelectorAll('#tab-settings .settings-nav-item').forEach(b =>
    b.classList.toggle('active', b.dataset.sgroup === next));
  document.querySelectorAll('#tab-settings .settings-group').forEach(s =>
    s.classList.toggle('active', s.dataset.sgroup === next));
}
document.querySelectorAll('#tab-settings .settings-nav-item').forEach(btn => {
  btn.onclick = () => showSettingsGroup(btn.dataset.sgroup);
});
```

- [ ] **Step 2: Beim Laden die gespeicherte Gruppe wiederherstellen**

In `loadSettingsToUi()` (am Ende der Funktion) ergänzen:

```js
  if (typeof showSettingsGroup === 'function') {
    showSettingsGroup((state.settings && state.settings.uiActiveGroup) || 'dashboard');
  }
```

- [ ] **Step 3: App testen**

Run: `npm start`
Expected: Klick auf Nav-Buttons wechselt das rechte Panel; nur eine Gruppe sichtbar. Nach App-Neustart ist die zuletzt geöffnete Gruppe wieder aktiv (über `state.settings.uiActiveGroup`, persistiert via `saveData`).

- [ ] **Step 4: Lint + Tests**

Run: `npm run lint && node --test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add rasicross.js
git commit -m "feat(settings): wire sub-nav via settingsNavReducer + restore active group"
```

---

## Task 7: rasicross.js — Suche verdrahten

**Files:**
- Modify: `rasicross.js`

- [ ] **Step 1: Such-Handler einfügen**

Nahe der Sub-Nav-Verdrahtung (Task 6) ergänzen:

```js
const _settingsSearch = $('settingsSearch');
if (_settingsSearch) {
  _settingsSearch.addEventListener('input', () => {
    const res = RasiSettings.settingsFilter(_settingsSearch.value, RasiSettings.SETTINGS_INDEX);
    const active = res.query !== '';

    // Nav: passende Gruppen markieren / Rest dimmen
    document.querySelectorAll('#tab-settings .settings-nav-item').forEach(b => {
      b.classList.toggle('search-hit', active && res.groups.has(b.dataset.sgroup));
      b.classList.toggle('search-dim', active && !res.groups.has(b.dataset.sgroup));
    });

    // Zeilen ein-/ausblenden (Zeilen ohne data-srow bleiben immer sichtbar)
    document.querySelectorAll('#tab-settings .settings-row').forEach(row => {
      const ctrl = row.querySelector('[id]');
      const rowId = ctrl ? ctrl.id : null;
      const known = rowId && RasiSettings.SETTINGS_INDEX.some(e => e.rowId === rowId);
      const hit = !active || !known || res.rows.has(rowId);
      row.classList.toggle('row-hidden', active && known && !res.rows.has(rowId));
      row.classList.toggle('row-hit', active && hit && known);
    });

    // Bei Treffer zur ersten passenden Gruppe springen
    if (active && res.groups.size > 0) {
      const first = RasiSettings.GROUPS.find(g => res.groups.has(g));
      if (first) showSettingsGroup(first);
    }
  });
}
```

- [ ] **Step 2: Such-Reset bei Tab-Wechsel**

Im bestehenden Tab-Wechsel-Handler (`.nav-item[data-tab]`-Schleife, ~`rasicross.js:218`) am Ende des Klick-Handlers ergänzen — damit das Suchfeld geleert wird, wenn man den Settings-Tab verlässt/betritt:

```js
      const _s = document.getElementById('settingsSearch');
      if (_s && _s.value) { _s.value = ''; _s.dispatchEvent(new Event('input')); }
```

- [ ] **Step 3: App testen**

Run: `npm start`
Expected: Tippen im Suchfeld blendet nicht passende Zeilen aus, hebt Treffer (lime) hervor, springt zur ersten passenden Gruppe; nicht passende Nav-Buttons sind gedimmt. Leeren → alles wieder da. Tab wechseln → Suchfeld leer.

- [ ] **Step 4: Lint + Tests**

Run: `npm run lint && node --test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add rasicross.js
git commit -m "feat(settings): wire search filter (settingsFilter) with row/nav highlighting"
```

---

## Task 8: rasicross.js — Auto-Save statt „Übernehmen"-Button

**Files:**
- Modify: `rasicross.js` (`saveSettingsFromUi`, Init-Bindungen)

- [ ] **Step 1: Inline-Indikator-Helper + delegierter Listener**

Nahe der Settings-Verdrahtung einfügen:

```js
let _settingsSaveTimer = null;
function flashSettingsSaved() {
  const active = document.querySelector('#tab-settings .settings-group.active [data-savemark]');
  if (!active) return;
  active.classList.add('show');
  clearTimeout(flashSettingsSaved._t);
  flashSettingsSaved._t = setTimeout(() => active.classList.remove('show'), 1500);
}
function scheduleSettingsSave() {
  clearTimeout(_settingsSaveTimer);
  _settingsSaveTimer = setTimeout(() => { saveSettingsFromUi(); }, 150);
}
const _settingsTab = $('tab-settings');
if (_settingsTab) {
  _settingsTab.addEventListener('change', (e) => {
    if (e.target && e.target.closest && e.target.closest('[data-autosave]')) scheduleSettingsSave();
  });
  // Zahlenfelder zusätzlich bei Blur sofort sichern
  _settingsTab.addEventListener('blur', (e) => {
    if (e.target && e.target.matches && e.target.matches('input[type=number][data-autosave]')) scheduleSettingsSave();
  }, true);
}
```

- [ ] **Step 2: `saveSettingsFromUi()` — Toast durch Indikator ersetzen**

In `saveSettingsFromUi()` (`rasicross.js` ~`:421`) die Zeile

```js
  rcToast('Einstellungen gespeichert');
```

ersetzen durch:

```js
  flashSettingsSaved();
```

- [ ] **Step 3: `saveSettingsBtn`-Bindung entfernen**

In `rasicross.js` (~`:3932`) die Zeile entfernen:

```js
  $('saveSettingsBtn').onclick = saveSettingsFromUi;
```

(Der Button existiert nach Task 4 nicht mehr; die Bindung würde sonst auf `null` zugreifen.)

- [ ] **Step 4: App testen — Auto-Save**

Run: `npm start`
Expected:
- Wert in „Max Speed" ändern + Feld verlassen → „Automatisch gespeichert ✓" blinkt im Gruppen-Header; nach Reload ist der Wert noch da.
- Geklemmter Wert (z.B. RPM-Warnung > Max RPM) wird nach dem Speichern auf das Maximum zurückgespiegelt (via `loadSettingsToUi`).
- Toggle (z.B. „Gx invertieren") → sofort gespeichert.
- OLED-Intervall ändern → Indikator + `restartDisplayUpdateInterval()` greift.
- ESP32-Felder lösen **kein** Auto-Save aus (kein `data-autosave`); „An ESP32 senden" funktioniert unverändert.

- [ ] **Step 5: Lint + komplette Suite**

Run: `npm run lint && node --test`
Expected: PASS (alle Suiten inkl. settings-Tests; 89 JS-Tests gesamt erwartet).

- [ ] **Step 6: Commit**

```bash
git add rasicross.js
git commit -m "feat(settings): auto-save on change/blur, inline saved indicator, drop apply button"
```

---

## Task 9: Abschluss-Verifikation

**Files:** keine (nur Prüfung)

- [ ] **Step 1: Volle Gates**

Run: `npm run lint`
Expected: Exit 0, kein Output.
Run: `node --test`
Expected: alle Tests PASS (83 bestehende + 6 neue settings ⇒ 89).
Run: `python -m unittest discover -s test -p "test_*.py"`
Expected: 38 PASS (Python unverändert).

- [ ] **Step 2: Manuelle DOM-Checkliste (`npm start`)**

- [ ] Jede der 6 Gruppen öffnet ohne Scrollen im Panel.
- [ ] Sub-Nav: aktiver Button lime; nur eine Gruppe sichtbar; aktive Gruppe überlebt Neustart.
- [ ] Suche: Treffer hervorgehoben, Rest ausgeblendet, Sprung zur Gruppe; Leeren stellt alles her.
- [ ] Auto-Save: Werte/Toggles speichern beim Verlassen; „✓"-Indikator; Persistenz über Reload; Klemmung sichtbar.
- [ ] Aktions-Buttons unverändert funktionsfähig: IMU Null/Reset/Roll, ESP32 senden, Export/Import/Reset, Cache leeren, 3D-Upload/Heading, Tiles-Preset/Toggle.
- [ ] Kein toter „Übernehmen"-Button mehr; keine Konsolen-Fehler.
- [ ] Light/Dark-Theme: Settings sehen in beiden Themes korrekt aus.

- [ ] **Step 3: Branch-Abschluss**

Run: `git status`
Expected: clean working tree. Danach Übergabe an `superpowers:finishing-a-development-branch` (PR/Merge) nach Wunsch.

---

## Self-Review (Plan ↔ Spec)

- **Spec-Abdeckung:** §1.1 Struktur → Task 4/6; §1.2 Optik → Task 4/5; §1.3 Auto-Save → Task 8; §1.4 Umräumen → Task 4 (Drift/Rollover→sensorik, OLED→hardware). §4 Tabelle → Task 4 Markup (IDs erhalten). §5.1 Reducer → Task 1; §5.2 Filter → Task 2; §5.3 Auto-Save-Verdrahtung → Task 8; §5.4 Markup/CSS → Task 4/5. §6 Edge-Cases → Task 8 (Clamp-Rückspiegelung, ESP32 ausgenommen) + Task 7 (Such-Reset). §8 Tests → Task 1/2 + Task 9. §9 Risiko (data-autosave-Scope) → Task 4/8.
- **Platzhalter:** keine — jeder Code-Step enthält vollständigen Code; Markup vollständig ausgeschrieben.
- **Typ-/Namens-Konsistenz:** `RasiSettings.{GROUPS, settingsNavReducer, SETTINGS_INDEX, settingsFilter}` einheitlich über Tasks 1/2/6/7; `showSettingsGroup`, `flashSettingsSaved`, `scheduleSettingsSave`, `_settingsSaveTimer` konsistent; `data-sgroup`/`data-autosave`/`data-savemark` konsistent zwischen Markup (Task 4), CSS (Task 5) und JS (Task 6–8).
- **Reconciliation:** Neue Datei `settings.js` (statt „inline" laut Spec) — begründet oben; Schema-Zusatz `uiActiveGroup` ist additiv und in Spec §5.1/§7 vorgesehen.
