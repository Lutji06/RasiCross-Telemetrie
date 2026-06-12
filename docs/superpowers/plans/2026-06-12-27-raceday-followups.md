# Phase 27: Race-Day-Followups Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Vier verifizierte Lücken schließen: (1) Config-Bestätigung vom Kart (`config_ack`), (2) Rennen-Replays überleben App-Neustarts (IndexedDB), (3) Hall-Glitch-Zähler in der Telemetrie (Frame v3), (5) Motorlaufzeit-/Wartungszähler.

**Architecture:** ESP-Seite: Binär-Frame v2→v3 (+u16 glitch, 37 B), Sender beantwortet `config`/`config_get` mit einem JSON-`config_ack` (Bridge reicht Kart-JSON unverändert durch). Dashboard-Seite: neues IO-Modul `rec-store.js` (IndexedDB, Promise-API) + neues pures UMD-Modul `engine.js` (Laufzeit-Akkumulation, node-getestet); Integration in `recording.js`/`races.js`/`rasicross.js` nach bestehendem Global-Scope-Muster.

**Tech Stack:** MicroPython (ESP32), Vanilla JS (classic scripts, UMD für pure Logik), node:test, unittest, IndexedDB, ESLint 9 Flat-Config.

---

## Working Directory & Conventions

- Arbeitsverzeichnis: `C:\Users\jimlu\Documents\RasiCross-Telemetrie-git`, Branch `feat/race-day-quickwins`.
- Dateien sind **CRLF**: Vor jedem Edit die Zielregion frisch lesen und den Anker aus diesem Read kopieren; Anker auf Text, Zeilennummern nur indikativ.
- Verifikation mit dem **Grep-Tool** (nicht Shell-grep).
- Niemals `.claude/` oder Plan-Docs committen, außer im expliziten Plan-Doc-Commit (Task 9).
- `__pycache__` vor jedem `git status` löschen.
- Commit-Messages: conventional + Body + Trailer `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- Verifikations-Rezept pro Task (soweit betroffen):
  - `node --check <geänderte .js>`
  - `npm test` (node --test, auto-discovers `test/`)
  - `npm run lint`
  - `python -m py_compile sender.py bridge.py esp_libs/frame.py` (ggf. `py -3`)
  - `python -m unittest discover -s test -p "test_*.py"`

## Locked Decisions

1. **Frame v3 statt Slow-JSON** für den Glitch-Zähler: u16 ans Frame-Ende (`SIZE` 35→37, `FRAME_VER` 3). Beide ESPs müssen neu geflasht werden — steht eh an wegen sender.py/bridge.py (Hardware-Checkliste).
2. **`config_ack` ohne IMU-Offsets und mit kompakten Funk-Keys** (`_ACK_KEYS` in sender.py ↔ `ESP_CFG_FIELDS` in rasicross.js): mit den langen NVS-Keys lag der Worst Case bei 255 B > 250-B-ESP-NOW-Limit; kompakt sind es 164 B. `config_snapshot()` bleibt langkeyig (eine Quelle für NVS-Blob und Ack; NVS-Format unverändert). Zusätzlich bekam `apply_config` Obergrenzen (max_rpm/warn_rpm ≤ 30000, send_ms ≤ 5000, ppr ≤ 99, wheel ≤ 10, gear ≤ 100, cells ≤ 24, ceiling ≤ 60000, page_ms ≤ 60000), die Werte-Explosionen im Ack und Unsinnseingaben zugleich verhindern. *(Abweichung vom ursprünglichen Plan-Text, während Task 3 gemessen und korrigiert.)*
3. **IndexedDB, nicht localStorage** für Renn-Aufnahmen (Größe), Deckel **20 Aufnahmen** (älteste fliegen), Waisen (Rennen gelöscht) werden beim Start aufgeräumt. Kein Export/Import der Aufnahmen über `exportAll` (zu groß; NDJSON-Export existiert separat).
4. **Motorlaufzeit zählt nur bei `connection.source === 'serial'`** (Demo/Replay verfälschen den Wartungszähler nicht). Schwelle `rpm ≥ 500`, Paket-Lücken > 2 s zählen nicht. Persistenz additiv im bestehenden `SAVE_KEY`-Payload (`engine`-Key) — kein Format-Bruch.
5. Neue Dateien müssen in `package.json → build.files` (Whitelist!) eingetragen werden.
6. Bestands-Bug-Fix im Zuge von Task 6: `replayRace` übergibt Pakete ohne `__t`, `RasiReplay.nextIndexFor` vergleicht aber `__t` — Session-Replay eines Rennens spielt deshalb nichts ab. Fix: beim Rebase `__t` mitsetzen.

## File Structure

| Action | Path | Responsibility |
|---|---|---|
| Modify | `esp_libs/frame.py` | Binär-Codec v3: +glitch u16, SIZE 37 |
| Modify | `test/test_frame.py` | Frame-v3-Tests (TDD) |
| Modify | `sender.py` | `glitch` im Paket; `config_snapshot()`; `ESPNowLink.send_json()`; `config_ack` auf `config`/`config_get` |
| Modify | `bridge.py` | `config_get` an Kart weiterleiten |
| Modify | `rasicross.js` | `config_ack`-Handler + Form-Sync; `state.engine` + Akkumulation; `state.raw.glitch`; Init-Bindings; Persistenz |
| Modify | `serial-demo.js` | `config_get` nach Connect anfragen |
| Modify | `replay.js` | CSV-Spalte `glitch` |
| Modify | `live-ui.js` | Diag-Zeile Glitches; `updateEngineUi()`-Aufruf |
| Create | `rec-store.js` | IndexedDB-Wrapper `window.RasiRecStore` (reines IO) |
| Modify | `recording.js` | `initRecStore`/`persistRaceRecording`/`discardRaceRecording`; `raceHasRecording`/`replayRace` auf Store; `resetAll` räumt Store |
| Modify | `races.js` | `endRace` persistiert, `deleteRace` räumt, Button-Tooltip |
| Create | `engine.js` | Pure Laufzeit-/Wartungslogik `window.RasiEngine` (UMD) |
| Create | `test/engine.test.js` | node:test für engine.js |
| Modify | `settings.js` | SETTINGS_INDEX: 3 neue Hardware-Zeilen |
| Modify | `RasiCross_Telemetry.html` | Diag-Zeile, Engine-Settings-Zeilen, 2 Script-Tags |
| Modify | `eslint.config.js` | Globals für neue Module/Funktionen |
| Modify | `package.json` | `build.files` + `engine.js`, `rec-store.js` |

Task-Reihenfolge: 1→2 (Glitch), 3→4 (Config-Ack), 5→6 (RecStore), 7→8 (Engine), 9 (Abschluss). Jeder Task lässt Tests/Lint grün zurück.

---

### Task 1: Frame v3 — Glitch-Feld (TDD)

**Files:** Modify `esp_libs/frame.py`, `test/test_frame.py`

- [ ] **Step 1: Tests auf v3 erweitern.** In `test/test_frame.py`:
  - `_base()` bekommt zusätzlich `"glitch": 17,` (nach `"mtemp": 34,`).
  - `test_size_and_ver`: `SIZE == 37`, `FMT == "<BHHHhhhhhiiHHHBbBBH"`, `FRAME_VER == 3`, `len(b) == 37`.
  - `test_nominal`: zusätzlich `self.assertEqual(out["glitch"], 17)`.
  - `test_overflow_clamps_not_raises`: in `d.update(...)` zusätzlich `glitch=999999`; Assert `self.assertEqual(out["glitch"], 65535)`.
  - Neue Klasse:

```python
class GlitchField(unittest.TestCase):
    def test_glitch_absent_defaults_zero(self):
        d = _base(); d.pop("glitch")
        self.assertEqual(frame.unpack(frame.pack(d, 0))["glitch"], 0)

    def test_v2_frame_rejected_by_length(self):
        # 35-Byte-Frame (altes v2 SIZE) faellt auf Laenge, vor dem Versions-Check.
        self.assertEqual(frame.unpack(b"\x02" * 35)["_err"], "bad_len")
```

- [ ] **Step 2: Tests laufen lassen → müssen scheitern** (`SIZE` ist noch 35): `python -m unittest discover -s test -p "test_*.py"` → FAIL.
- [ ] **Step 3: `esp_libs/frame.py` auf v3 heben:**
  - Header-Kommentar: `35-Byte` → `37-Byte`, `(v2: +roll Gyro-X)` → `(v3: +glitch Stoerimpuls-Zaehler)`.
  - `FRAME_VER = 3`, `FMT = "<BHHHhhhhhiiHHHBbBBH"` (Kommentar `# 37`).
  - In `pack()` nach `mtemp = ...`: `glitch = _clamp(_i(d.get("glitch")), 0, 65535)`; `struct.pack(...)` bekommt `, glitch` als letztes Argument.
  - In `unpack()`: Tupel-Unpack bekommt `, glitch` als letztes Element; nach dem `out = {...}`-Literal: `out["glitch"] = glitch` (vor den flags2-Blöcken einfügen ist ok — Schlüssel immer vorhanden).
- [ ] **Step 4: Tests grün:** `python -m unittest discover -s test -p "test_*.py"` → OK. `python -m py_compile esp_libs/frame.py`.
- [ ] **Step 5: Commit** `feat(frame): Binaer-Frame v3 -- Hall-Glitch-Zaehler (u16) im Telemetrie-Frame` (nur `esp_libs/frame.py`, `test/test_frame.py`).

### Task 2: Glitch-Zähler senden + im Dashboard anzeigen

**Files:** Modify `sender.py`, `rasicross.js`, `live-ui.js`, `replay.js`, `RasiCross_Telemetry.html`

- [ ] **Step 1: sender.py** — im Telemetrie-`packet`-Dict nach `"imu_cal":`-Zeile:

```python
                "glitch":   rpm_counter.glitches,  # verworfene Stoerflanken (kumulativ)
```

- [ ] **Step 2: rasicross.js** — `state.raw`-Zuweisung in `processTelemetry` (Anker: `state.raw = { speed, rpm, gx: Number(d.gx) || 0`) erweitern um `glitch: d.glitch != null ? (Number(d.glitch) || 0) : null` (vor `pulseHz` einfügen, Komma beachten).
- [ ] **Step 3: live-ui.js** — in `updateDiagnostics()` nach der `diagMpuTemp`-Zeile:

```js
  setText('diagGlitch', (state.raw && state.raw.glitch != null) ? String(state.raw.glitch) : '--');
```

- [ ] **Step 4: HTML** — Diag-Grid (`#detailDiagnoseSlot`), nach der Zeile mit `id="diagMpuTemp"`:

```html
        <div class="pw-diag-row"><span class="pw-diag-label">Hall-Glitches</span> <span class="pw-diag-val" id="diagGlitch">--</span></div>
```

- [ ] **Step 5: replay.js** — `CSV_COLUMNS`: `['glitch', 'glitch'],` zwischen `['mtemp_c', 'mtemp'],` und `['seq', 'seq'],`.
- [ ] **Step 6: Verifikation** — `node --check` (rasicross.js, live-ui.js, replay.js), `npm test`, `npm run lint`, `python -m py_compile sender.py`. Grep-Asserts: `diagGlitch` in HTML+live-ui.js, `glitch` in replay.js.
- [ ] **Step 7: Commit** `feat(telemetry): Hall-Glitch-Zaehler bis ins Dashboard (Diag-Zeile + CSV)`.

### Task 3: Sender beantwortet Config mit `config_ack`

**Files:** Modify `sender.py`, `bridge.py`

- [ ] **Step 1: `ESPNowLink.send_json`** — in sender.py nach der `send()`-Methode:

```python
    def send_json(self, obj):
        """Kleines JSON-Steuerpaket an die Bridge (kein Binaer-Frame).
        Die Bridge reicht JSON vom Kart unveraendert ans Dashboard durch."""
        if not self._bridge_mac:
            return False
        try:
            return bool(self._esp.send(self._bridge_mac, ujson.dumps(obj), True))
        except Exception:
            return False
```

- [ ] **Step 2: `config_snapshot()`** — direkt vor `class ConfigStore`:

```python
def config_snapshot(rpm_counter):
    """Aktuelle Live-Config als dict — eine Quelle fuer den NVS-Blob
    (ConfigStore) und das config_ack ans Dashboard. OHNE IMU-Offsets,
    damit das Ack unter dem 250-B-ESP-NOW-Limit bleibt; ConfigStore.save
    ergaenzt die Offsets selbst."""
    return {
        "max_rpm":        Config.MAX_RPM,
        "warn_rpm":       Config.RPM_WARN,
        "send_ms":        Config.SEND_MS,
        "pulses_per_rev": rpm_counter.ppr,
        "wheel_circ_m":   Config.WHEEL_CIRC_M,
        "gear_ratio":     Config.GEAR_RATIO,
        "batt_cells":     Config.BATT_CELLS,
        "rpm_ceiling":    Config.RPM_CEILING,
        "rpm_alpha":      Config.RPM_ALPHA,
        "batt_warn_v":    Config.BATT_CELL_WARN,
        "batt_crit_v":    Config.BATT_CELL_CRIT,
        "batt_cal":       Config.BATT_CAL,
        "page_ms":        Config.PAGE_MS,
    }
```

- [ ] **Step 3: `ConfigStore.save` entdoppeln** — das literale `data = {...}`-Dict ersetzen durch `data = config_snapshot(rpm_counter)` (der `if imu is not None:`-Block bleibt).
- [ ] **Step 4: Ack senden** — im Main-Loop den `elif kind == "config":`-Zweig ersetzen durch:

```python
            elif kind == "config":
                apply_config(data, rpm_counter, cfg_store, imu)
                ack = config_snapshot(rpm_counter)
                ack["type"] = "config_ack"
                link.send_json(ack)
            elif kind == "config_get":
                # Dashboard will den Ist-Stand lesen (z.B. direkt nach Connect)
                ack = config_snapshot(rpm_counter)
                ack["type"] = "config_ack"
                link.send_json(ack)
```

- [ ] **Step 5: bridge.py** — Forward-Liste erweitern: `if t in ("display", "config", "pit_call", "imu_calibrate"):` → `if t in ("display", "config", "pit_call", "imu_calibrate", "config_get"):`.
- [ ] **Step 6: Payload-Budget prüfen** (worst case < 250 B):

```
python -c "import json; d={'type':'config_ack','max_rpm':65535,'warn_rpm':65535,'send_ms':65535,'pulses_per_rev':32,'wheel_circ_m':9.999,'gear_ratio':99.99,'batt_cells':14,'rpm_ceiling':30000,'rpm_alpha':0.25,'batt_warn_v':4.4,'batt_crit_v':4.4,'batt_cal':1.99,'page_ms':20000}; print(len(json.dumps(d,separators=(',',':'))))"
```

  Erwartet: ≈ 220, jedenfalls < 250.
- [ ] **Step 7: Verifikation** — `python -m py_compile sender.py bridge.py`, unittest grün.
- [ ] **Step 8: Commit** `feat(sender): config_ack -- Kart bestaetigt uebernommene Config, config_get liest sie`.

### Task 4: Dashboard verarbeitet `config_ack`

**Files:** Modify `rasicross.js`, `serial-demo.js`

- [ ] **Step 1: Form-Mapping + Ack-Handler** — in rasicross.js, Sektion 6, direkt vor `function loadSettingsToUi()`:

```js
// ESP-Config-Formular <-> config-Paket: [Input-ID, Paket-Key].
// Wird vom config_ack-Handler genutzt, um das Formular auf die vom Kart
// TATSAECHLICH uebernommenen Werte zu setzen (NVS-Stand nach Reboot kann
// vom Formular abweichen).
// Kompakte Funk-Keys — Gegenstueck: _ACK_KEYS in sender.py (s. Locked Decision 2)
const ESP_CFG_FIELDS = [
  ['espMaxRpm', 'mr'], ['espWarnRpm', 'wr'], ['espSendMs', 'sm'],
  ['espPulses', 'ppr'], ['espWheelCirc', 'wc'], ['espGearRatio', 'gear'],
  ['espBattCells', 'bc'], ['espBattWarnV', 'bwv'], ['espBattCritV', 'bcv'],
  ['espBattCal', 'bcal'], ['espRpmCeiling', 'rcl'], ['espRpmAlpha', 'ra'],
  ['espPageMs', 'pm'],
];
let _espAckTimer = null;
function applyEspConfigAck(d) {
  clearTimeout(_espAckTimer);
  _espAckTimer = null;
  for (const [id, key] of ESP_CFG_FIELDS) {
    const el = $(id);
    if (el && d[key] != null) el.value = d[key];
  }
  if (d.batt_cells != null) state.batt.cells = Number(d.batt_cells) || state.batt.cells;
  setText('espSendStatus', '✓ Vom Kart bestätigt ' + logTime());
}
```

- [ ] **Step 2: processTelemetry-Hook** — direkt nach dem `bridge_status`-Block (`return;` + `}`):

```js
    if (d.type === 'config_ack') { applyEspConfigAck(d); return; }
```

- [ ] **Step 3: Sende-Status ehrlich machen** — im `espSendBtn`-Handler die Zeile `setText('espSendStatus', '✓ Gesendet');` ersetzen durch:

```js
      setText('espSendStatus', '✓ Gesendet — warte auf Bestätigung…');
      clearTimeout(_espAckTimer);
      _espAckTimer = setTimeout(() => {
        setText('espSendStatus', '⚠ Keine Bestätigung vom Kart — Funkverbindung prüfen');
      }, 3000);
```

- [ ] **Step 4: Config nach Connect lesen** — serial-demo.js, in `connectSerial()` nach der `request_status`-setTimeout-Zeile:

```js
      // Ist-Config vom Kart anfragen -> config_ack fuellt das ESP-Formular
      setTimeout(() => { try { window.rasiSerial.writeLine(JSON.stringify({ type: 'config_get' })); } catch {} }, 1600);
```

- [ ] **Step 5: Verifikation** — `node --check rasicross.js serial-demo.js`, `npm test`, `npm run lint`.
- [ ] **Step 6: Commit** `feat(settings): config_ack im Dashboard -- Formular-Sync + ehrlicher Sende-Status`.

### Task 5: `rec-store.js` — IndexedDB-Wrapper

**Files:** Create `rec-store.js`; Modify `RasiCross_Telemetry.html`, `eslint.config.js`, `package.json`

- [ ] **Step 1: Datei anlegen** mit vollständigem Inhalt:

```js
'use strict';
// ============================================================
//  RasiCross -- rec-store.js  (IndexedDB-Ablage fuer Rennen-Aufnahmen)
//  Persistiert den Aufnahme-Ausschnitt eines beendeten Rennens, damit
//  der Replay-Button auch nach einem App-Neustart funktioniert.
//  Reines IO-Modul (window.RasiRecStore), Promise-API: ohne IndexedDB
//  oder bei Fehlern lehnen die Promises ab und die Aufrufer degradieren
//  auf das bisherige Nur-RAM-Verhalten.
// ============================================================
(function () {
  var DB_NAME = 'rasicross_recordings';
  var DB_VERSION = 1;
  var STORE = 'race_recordings';
  var MAX_RECORDINGS = 20;   // Speicher-Deckel: aelteste Aufnahmen fliegen raus

  function available() {
    try { return typeof indexedDB !== 'undefined' && !!indexedDB; }
    catch (e) { return false; }
  }

  function _open() {
    return new Promise(function (resolve, reject) {
      if (!available()) { reject(new Error('IndexedDB nicht verfuegbar')); return; }
      var req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = function () {
        var db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          var os = db.createObjectStore(STORE, { keyPath: 'raceId' });
          os.createIndex('savedAt', 'savedAt');
        }
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error || new Error('IndexedDB open fehlgeschlagen')); };
    });
  }

  function _tx(db, mode, fn) {
    return new Promise(function (resolve, reject) {
      var tx = db.transaction(STORE, mode);
      var out = fn(tx.objectStore(STORE));
      tx.oncomplete = function () { db.close(); resolve(out ? out.result : undefined); };
      tx.onerror = function () { db.close(); reject(tx.error || new Error('IndexedDB Transaktion fehlgeschlagen')); };
      tx.onabort = function () { db.close(); reject(tx.error || new Error('IndexedDB Transaktion abgebrochen')); };
    });
  }

  // Alle gespeicherten Renn-IDs (fuer den Button-Zustand beim Start).
  function keys() {
    return _open().then(function (db) {
      return _tx(db, 'readonly', function (os) { return os.getAllKeys(); });
    });
  }

  // Aufnahme eines Rennens ablegen/ersetzen. Resolved mit der Liste der
  // dabei verdraengten alten Renn-IDs (Deckel MAX_RECORDINGS).
  function put(raceId, packets, meta) {
    meta = meta || {};
    return _open().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(STORE, 'readwrite');
        var os = tx.objectStore(STORE);
        var dropped = [];
        os.put({
          raceId: String(raceId),
          savedAt: Date.now(),
          name: meta.name || '',
          count: packets.length,
          packets: packets
        });
        var cntReq = os.count();
        cntReq.onsuccess = function () {
          var excess = cntReq.result - MAX_RECORDINGS;
          if (excess <= 0) return;
          // savedAt-Index laeuft aufsteigend: aelteste zuerst loeschen.
          var cur = os.index('savedAt').openKeyCursor();
          cur.onsuccess = function () {
            var c = cur.result;
            if (!c || excess <= 0) return;
            if (String(c.primaryKey) !== String(raceId)) {
              dropped.push(String(c.primaryKey));
              os.delete(c.primaryKey);
              excess--;
            }
            c.continue();
          };
        };
        tx.oncomplete = function () { db.close(); resolve(dropped); };
        tx.onerror = function () { db.close(); reject(tx.error || new Error('IndexedDB put fehlgeschlagen')); };
        tx.onabort = function () { db.close(); reject(tx.error || new Error('IndexedDB put abgebrochen')); };
      });
    });
  }

  function get(raceId) {
    return _open().then(function (db) {
      return _tx(db, 'readonly', function (os) { return os.get(String(raceId)); });
    });
  }

  function remove(raceId) {
    return _open().then(function (db) {
      return _tx(db, 'readwrite', function (os) { return os.delete(String(raceId)); });
    });
  }

  function clear() {
    return _open().then(function (db) {
      return _tx(db, 'readwrite', function (os) { return os.clear(); });
    });
  }

  window.RasiRecStore = {
    available: available, keys: keys, put: put, get: get,
    remove: remove, clear: clear, MAX_RECORDINGS: MAX_RECORDINGS
  };
})();
```

- [ ] **Step 2: Script-Tag** — in RasiCross_Telemetry.html nach `<script src="settings.js"></script>`: `<script src="rec-store.js"></script>`.
- [ ] **Step 3: ESLint-Block** — in eslint.config.js nach dem settings.js-Block:

```js
  // rec-store.js — IndexedDB-Wrapper (window.RasiRecStore), reines IO
  {
    files: ['rec-store.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: { ...globals.browser },
    },
    rules: bugRules,
  },
```

- [ ] **Step 4: package.json** — in `build.files` nach `"settings.js",`: `"rec-store.js",`.
- [ ] **Step 5: Verifikation** — `node --check rec-store.js`, `npm run lint`.
- [ ] **Step 6: Commit** `feat(recording): rec-store.js -- IndexedDB-Ablage fuer Rennen-Aufnahmen`.

### Task 6: Persistente Rennen-Replays verdrahten

**Files:** Modify `recording.js`, `races.js`, `rasicross.js`, `eslint.config.js`

- [ ] **Step 0: `__t`-Bug bestätigen** — Grep `__t` in replay.js (`nextIndexFor` vergleicht `packets[i].__t`) und in recording.js (`replayRace` setzt nur `t_rel`). Wenn bestätigt: Fix in Step 3 (Map setzt `__t` mit).
- [ ] **Step 1: Store-Integration in recording.js** — vor `function raceHasRecording(r)` einfügen:

```js
// ── Persistente Rennen-Aufnahmen (IndexedDB, Phase 27) ──────
// IDs der Rennen, zu denen eine Aufnahme im RasiRecStore liegt; beim
// App-Start aus der DB geladen, haelt raceHasRecording synchron.
let _recStoreIds = new Set();
function initRecStore() {
  if (!window.RasiRecStore || !RasiRecStore.available()) return;
  RasiRecStore.keys().then(ids => {
    const known = new Set(state.races.map(r => r.id));
    for (const id of ids) {
      if (known.has(String(id))) _recStoreIds.add(String(id));
      else RasiRecStore.remove(id).catch(() => {});   // Waise (Rennen geloescht)
    }
    if (_recStoreIds.size) renderRaces();
  }).catch(() => {});
}
// Beim Rennende den Sitzungs-Ausschnitt dauerhaft ablegen.
function persistRaceRecording(r) {
  if (!window.RasiRecStore || !RasiRecStore.available()) return;
  const pk = raceRecordingSlice(r);
  if (!pk) return;
  RasiRecStore.put(r.id, pk, { name: r.name }).then(dropped => {
    _recStoreIds.add(r.id);
    for (const id of (dropped || [])) _recStoreIds.delete(id);
    renderRaces();
  }).catch(() => rcToast('⚠ Aufnahme konnte nicht dauerhaft gespeichert werden', 3500));
}
function discardRaceRecording(raceId) {
  _recStoreIds.delete(raceId);
  if (window.RasiRecStore && RasiRecStore.available()) {
    RasiRecStore.remove(raceId).catch(() => {});
  }
}
```

- [ ] **Step 2: `raceHasRecording` ersetzen:**

```js
function raceHasRecording(r) {
  if (!r || state.replay.active) return false;
  if (_recStoreIds.has(r.id)) return true;
  if (!r.startedAt) return false;
  const buf = state.recording.buf;
  if (buf.length < 2) return false;
  const end = r.endedAt || Date.now();
  return r.startedAt <= buf[buf.length - 1]._wall && end >= buf[0]._wall;
}
```

- [ ] **Step 3: `replayRace` ersetzen** (async, Store-Fallback, `__t`-Fix):

```js
async function replayRace(raceId) {
  const r = state.races.find(x => x.id === raceId);
  if (!r) return;
  if (r.status === 'running' || r.status === 'paused') {
    rcToast('Rennen läuft noch — erst beenden', 3000);
    return;
  }
  let pk = raceRecordingSlice(r);
  if (!pk && _recStoreIds.has(raceId)) {
    const rec = await RasiRecStore.get(raceId).catch(() => null);
    if (rec && Array.isArray(rec.packets) && rec.packets.length >= 2) pk = rec.packets;
  }
  if (!pk) {
    rcToast('Keine Aufnahme zu diesem Rennen vorhanden', 3000);
    return;
  }
  // t_rel auf den Rennstart rebasen, damit Seek/Dauer bei 0 beginnen.
  // __t mitsetzen: nextIndexFor/fastForwardTo takten ueber __t (bei
  // Datei-Replays setzt parseRecording das Feld; hier muessen wir es tun).
  const t0 = Number(pk[0].t_rel) || 0;
  const packets = pk.map(p => {
    const t = (Number(p.t_rel) || 0) - t0;
    return Object.assign({}, p, { t_rel: t, __t: t });
  });
  enterReplay({ packets, durationMs: packets[packets.length - 1].t_rel });
}
```

- [ ] **Step 4: `resetAll` räumt den Store:** nach `localStorage.removeItem(SAVE_KEY);`:

```js
  if (window.RasiRecStore && RasiRecStore.available()) {
    await RasiRecStore.clear().catch(() => {});
  }
```

- [ ] **Step 5: Interface-Marker** — im `void [...]`-Block von recording.js `initRecStore, persistRaceRecording, discardRaceRecording,` ergänzen (vor `raceHasRecording`).
- [ ] **Step 6: races.js** — in `endRace` nach `saveData();`: `persistRaceRecording(r);` — in `deleteRace` nach der `state.races = state.races.filter(...)`-Zeile: `discardRaceRecording(id);` — Button-Tooltip: `Keine Aufnahme zu diesem Rennen in dieser Sitzung` → `Keine Aufnahme zu diesem Rennen vorhanden`.
- [ ] **Step 7: rasicross.js init()** — nach `restartDisplayUpdateInterval();`: `initRecStore();`.
- [ ] **Step 8: eslint.config.js** — `recordingGlobals` ergänzen um `initRecStore: 'readonly', persistRaceRecording: 'readonly', discardRaceRecording: 'readonly',`; im recording.js-Block `RasiRecStore: 'readonly',` ergänzen; im races.js-Block `persistRaceRecording: 'readonly', discardRaceRecording: 'readonly',` ergänzen.
- [ ] **Step 9: Verifikation** — `node --check recording.js races.js rasicross.js`, `npm test`, `npm run lint`. Grep-Asserts: `_recStoreIds` (recording.js ≥ 5 Treffer), `persistRaceRecording(r)` in races.js, `initRecStore()` in rasicross.js.
- [ ] **Step 10: Commit** `feat(races): Replays ueberleben App-Neustarts -- Aufnahme je Rennen in IndexedDB` (Body erwähnt den `__t`-Fix).

### Task 7: `engine.js` — pure Laufzeit-/Wartungslogik (TDD)

**Files:** Create `engine.js`, `test/engine.test.js`; Modify `eslint.config.js`, `RasiCross_Telemetry.html`, `package.json`

- [ ] **Step 1: Test schreiben** — `test/engine.test.js`:

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../engine.js');

test('engineStep: erster laufender Tick setzt nur den Anker, zaehlt nichts', () => {
  const r = E.engineStep({ totalMs: 0, lastAt: null }, 1800, 1000);
  assert.equal(r.totalMs, 0);
  assert.equal(r.lastAt, 1000);
  assert.equal(r.addedMs, 0);
});

test('engineStep: laufender Motor akkumuliert die Paket-Luecke', () => {
  let acc = { totalMs: 0, lastAt: null };
  acc = E.engineStep(acc, 1800, 1000);
  acc = E.engineStep(acc, 2500, 1080);
  assert.equal(acc.totalMs, 80);
  assert.equal(acc.lastAt, 1080);
});

test('engineStep: unter RUN_RPM_MIN -> Anker weg, nichts gezaehlt', () => {
  const r = E.engineStep({ totalMs: 500, lastAt: 1000 }, 0, 2000);
  assert.equal(r.totalMs, 500);
  assert.equal(r.lastAt, null);
  assert.equal(r.addedMs, 0);
});

test('engineStep: Luecke > MAX_GAP_MS wird gedeckelt', () => {
  const r = E.engineStep({ totalMs: 0, lastAt: 1000 }, 3000, 61000);
  assert.equal(r.totalMs, E.MAX_GAP_MS);
});

test('engineStep: rueckwaerts laufende Uhr zaehlt nicht negativ', () => {
  const r = E.engineStep({ totalMs: 100, lastAt: 5000 }, 3000, 4000);
  assert.equal(r.totalMs, 100);
  assert.equal(r.lastAt, 4000);
});

test('engineStep: kaputte Eingaben -> wirft nie, liefert Zahlen', () => {
  const r = E.engineStep(null, NaN, NaN);
  assert.equal(r.totalMs, 0);
  assert.equal(r.lastAt, null);
});

test('hoursText: formatiert mit Dezimal-Komma', () => {
  assert.equal(E.hoursText(0), '0,0 h');
  assert.equal(E.hoursText(4530000), '1,3 h');
  assert.equal(E.hoursText(-5), '0,0 h');
});

test('serviceDue: faellig ab Intervall, 0 = aus', () => {
  assert.equal(E.serviceDue(10 * 3600000, 0, 10), true);
  assert.equal(E.serviceDue(9.9 * 3600000, 0, 10), false);
  assert.equal(E.serviceDue(999 * 3600000, 0, 0), false);
  assert.equal(E.serviceDue(12 * 3600000, 5 * 3600000, 10), false);
});

test('sinceServiceMs: nie negativ', () => {
  assert.equal(E.sinceServiceMs(5, 10), 0);
  assert.equal(E.sinceServiceMs(20, 5), 15);
});
```

- [ ] **Step 2: `npm test` → FAIL** (Cannot find module '../engine.js').
- [ ] **Step 3: engine.js anlegen:**

```js
'use strict';
/*!
 * engine.js — Motorlaufzeit & Wartung, pure Logik (RasiCross).
 * UMD wie settings.js: Browser (window.RasiEngine) + node:test.
 * Kein DOM, keine Seiteneffekte, wirft nie.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.RasiEngine = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {

  // Ab dieser Drehzahl gilt der Motor als laufend (Leerlauf liegt beim
  // Maeher um 1800 U/min, Sensor-Rauschen im Stand weit darunter).
  const RUN_RPM_MIN = 500;
  // Groessere Luecken zwischen zwei Paketen zaehlen nicht als Laufzeit
  // (Funkabriss/Disconnect soll den Zaehler nicht aufblasen).
  const MAX_GAP_MS = 2000;

  // Ein Telemetrie-Tick. acc = { totalMs, lastAt }. Liefert neues
  // { totalMs, lastAt, addedMs } — mutiert nichts.
  function engineStep(acc, rpm, nowMs) {
    const totalMs = Math.max(0, Number(acc && acc.totalMs) || 0);
    const lastAt = (acc && typeof acc.lastAt === 'number') ? acc.lastAt : null;
    const r = Number(rpm) || 0;
    const now = Number(nowMs) || 0;
    if (r < RUN_RPM_MIN) {
      return { totalMs: totalMs, lastAt: null, addedMs: 0 };
    }
    let added = 0;
    if (lastAt != null) {
      const dt = now - lastAt;
      if (dt > 0) added = Math.min(dt, MAX_GAP_MS);
    }
    return { totalMs: totalMs + added, lastAt: now, addedMs: added };
  }

  // 4530000 -> '1,3 h' (deutsches Dezimal-Komma)
  function hoursText(ms) {
    const h = Math.max(0, Number(ms) || 0) / 3600000;
    return h.toFixed(1).replace('.', ',') + ' h';
  }

  function sinceServiceMs(totalMs, lastServiceMs) {
    return Math.max(0, (Number(totalMs) || 0) - (Number(lastServiceMs) || 0));
  }

  // intervalH <= 0 = Wartungshinweis aus.
  function serviceDue(totalMs, lastServiceMs, intervalH) {
    const iv = Number(intervalH) || 0;
    if (iv <= 0) return false;
    return sinceServiceMs(totalMs, lastServiceMs) >= iv * 3600000;
  }

  return { RUN_RPM_MIN: RUN_RPM_MIN, MAX_GAP_MS: MAX_GAP_MS,
           engineStep: engineStep, hoursText: hoursText,
           sinceServiceMs: sinceServiceMs, serviceDue: serviceDue };
}));
```

- [ ] **Step 4: `npm test` → PASS.**
- [ ] **Step 5: ESLint-Block** (nach settings.js-Block):

```js
  // engine.js setzt window.RasiEngine (UMD, Browser + node:test)
  {
    files: ['engine.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: { ...globals.browser, module: 'readonly' },
    },
    rules: bugRules,
  },
```

- [ ] **Step 6: Script-Tag** nach settings.js: `<script src="engine.js"></script>` (vor rec-store.js). **package.json** `build.files`: `"engine.js",` ergänzen.
- [ ] **Step 7: `npm run lint`**, `node --check engine.js`.
- [ ] **Step 8: Commit** `feat(engine): Motorlaufzeit-Logik als pures UMD-Modul (TDD)`.

### Task 8: Motorlaufzeit/Wartung im Dashboard verdrahten

**Files:** Modify `rasicross.js`, `live-ui.js`, `recording.js`, `settings.js`, `RasiCross_Telemetry.html`, `eslint.config.js`

- [ ] **Step 1: State** — in rasicross.js nach `gateFlashUntil: 0,`:

```js
  // Motorlaufzeit/Wartung (Phase 27): totalMs/lastServiceMs/serviceIntervalH
  // werden persistiert; lastAt/_unsavedMs/_warned sind Session-Zustand.
  engine: { totalMs: 0, lastServiceMs: 0, serviceIntervalH: 10, lastAt: null, _unsavedMs: 0, _warned: false },
```

- [ ] **Step 2: Persistenz** — `saveData()`-Payload nach der `sectors:`-Zeile: `engine: { totalMs: state.engine.totalMs, lastServiceMs: state.engine.lastServiceMs, serviceIntervalH: state.engine.serviceIntervalH },` — `loadData()` nach dem `sectors`-Block:

```js
    if (d.engine) {
      state.engine.totalMs = Number(d.engine.totalMs) || 0;
      state.engine.lastServiceMs = Number(d.engine.lastServiceMs) || 0;
      if (d.engine.serviceIntervalH != null) state.engine.serviceIntervalH = Number(d.engine.serviceIntervalH) || 0;
    }
```

- [ ] **Step 3: Export/Import** — recording.js `exportAll()`-Payload: `engine`-Objekt wie in saveData ergänzen; `importAll()`: gleicher Restore-Block wie loadData (vor `saveData();`).
- [ ] **Step 4: Akkumulation** — rasicross.js `processTelemetry`, direkt nach der Zeile `const rpm = Math.max(0, Number(d.rpm) || 0);`:

```js
    // Motorlaufzeit (Phase 27): nur echte Hardware-Pakete zaehlen --
    // Demo/Replay wuerden den Wartungszaehler verfaelschen.
    if (state.connection.source === 'serial' && !state.replay.active) {
      const _eng = RasiEngine.engineStep(state.engine, rpm, Date.now());
      state.engine.totalMs = _eng.totalMs;
      state.engine.lastAt = _eng.lastAt;
      state.engine._unsavedMs += _eng.addedMs;
      if (state.engine._unsavedMs >= 60000) {   // 1x pro Motor-Minute persistieren
        state.engine._unsavedMs = 0;
        saveDataDebounced();
      }
      if (!state.engine._warned
          && RasiEngine.serviceDue(state.engine.totalMs, state.engine.lastServiceMs, state.engine.serviceIntervalH)) {
        state.engine._warned = true;
        rcToast('🔧 Wartung fällig — '
          + RasiEngine.hoursText(RasiEngine.sinceServiceMs(state.engine.totalMs, state.engine.lastServiceMs))
          + ' seit letzter Wartung', 6000);
      }
    }
```

- [ ] **Step 5: UI-Funktion** — rasicross.js vor `loadSettingsToUi()`:

```js
function updateEngineUi() {
  setText('engineHoursText', RasiEngine.hoursText(state.engine.totalMs));
  setText('engineSinceServiceText',
    RasiEngine.hoursText(RasiEngine.sinceServiceMs(state.engine.totalMs, state.engine.lastServiceMs)));
}
```

  In `loadSettingsToUi()` (vor dem `showSettingsGroup`-Block): `if ($('setServiceIntervalH')) $('setServiceIntervalH').value = state.engine.serviceIntervalH;` + `updateEngineUi();` — in `saveSettingsFromUi()` (vor `loadSettingsToUi();`): `state.engine.serviceIntervalH = Math.max(0, Math.min(500, Number($('setServiceIntervalH')?.value) || 0));`
- [ ] **Step 6: Button-Binding** — in `init()` nach dem `espSendBtn`-Handler:

```js
  $('serviceDoneBtn').onclick = async () => {
    if (!await rcConfirm('Wartungszähler zurücksetzen? „Seit letzter Wartung" beginnt wieder bei 0.', 'Wartung', 'Zurücksetzen')) return;
    state.engine.lastServiceMs = state.engine.totalMs;
    state.engine._warned = false;
    saveData();
    updateEngineUi();
    rcToast('🔧 Wartung vermerkt');
  };
```

- [ ] **Step 7: Live-Refresh** — live-ui.js, in `updateLiveUi()` nach `updateLiveDelta();`: `updateEngineUi();`
- [ ] **Step 8: HTML** — Hardware-Settings-Gruppe, nach der `setDisplayUpdateMs`-Row (vor `</section>`):

```html
        <div class="settings-row">
          <div class="settings-row-label"><span class="settings-row-name">Motorlaufzeit</span><span class="settings-row-desc">Kumulierte Motorstunden (zählt bei USB-Verbindung und Drehzahl &gt; 500)</span></div>
          <div class="n" id="engineHoursText" style="font-family:var(--mono)">0,0 h</div>
        </div>
        <div class="settings-row">
          <div class="settings-row-label"><span class="settings-row-name">Wartungsintervall</span><span class="settings-row-desc">Hinweis nach so vielen Motorstunden seit letzter Wartung (0 = aus)</span></div>
          <input type="number" id="setServiceIntervalH" value="10" min="0" max="500" step="0.5" data-autosave>
        </div>
        <div class="settings-row">
          <div class="settings-row-label"><span class="settings-row-name">Seit letzter Wartung</span><span class="settings-row-desc">Motorstunden seit dem letzten Wartungs-Reset</span></div>
          <div class="n" id="engineSinceServiceText" style="font-family:var(--mono)">0,0 h</div>
        </div>
        <div class="row" style="margin:6px 0 4px"><button class="btn ghost" id="serviceDoneBtn" style="flex:1">Wartung erledigt — Zähler nullen</button></div>
```

- [ ] **Step 9: settings.js Index** — nach dem `setDisplayUpdateMs`-Eintrag:

```js
    { group: 'hardware',  rowId: 'engineHoursText',   label: 'Motorlaufzeit',        keywords: ['motor', 'laufzeit', 'betriebsstunden', 'stunden', 'wartung'] },
    { group: 'hardware',  rowId: 'setServiceIntervalH', label: 'Wartungsintervall',  keywords: ['wartung', 'service', 'intervall', 'oel', 'stunden'] },
    { group: 'hardware',  rowId: 'serviceDoneBtn',    label: 'Wartung erledigt',     keywords: ['wartung', 'service', 'reset', 'zuruecksetzen'] },
```

- [ ] **Step 10: eslint.config.js** — rasicross.js-Block: `RasiEngine: 'readonly',` ergänzen; live-ui.js-Block: `RasiEngine: 'readonly', updateEngineUi: 'readonly',` ergänzen.
- [ ] **Step 11: Verifikation** — `node --check rasicross.js live-ui.js recording.js settings.js`, `npm test`, `npm run lint`. Grep-Asserts: `engineHoursText` (HTML + rasicross.js), `RasiEngine.engineStep` in rasicross.js, `updateEngineUi()` in live-ui.js.
- [ ] **Step 12: Commit** `feat(engine): Betriebsstunden + Wartungshinweis im Dashboard`.

### Task 9: Abschluss-Verifikation + Plan-Doc

- [ ] **Step 1: Voller Durchlauf:** `npm test` (alle Suiten grün, inkl. neuer engine-Tests), `npm run lint` (0 Fehler), `node --check` über alle geänderten JS, `python -m py_compile sender.py bridge.py esp_libs/frame.py esp_libs/calc.py`, `python -m unittest discover -s test -p "test_*.py"` (alle grün, inkl. Frame-v3).
- [ ] **Step 2:** `__pycache__` löschen, `git status` prüfen — nur erwartete Dateien.
- [ ] **Step 3: Plan-Doc-Commit:** `docs(plan): Phase-27-Plan -- Race-Day-Followups` (nur diese Datei).

---

## Hardware/Manual Acceptance Checklist (User, am Gerät)

- [ ] **Beide ESPs flashen:** `esp_libs/frame.py` auf Kart **und** Bridge (`mpremote connect <port> cp esp_libs/frame.py :`), dazu `sender.py` auf den Kart und `bridge.py` auf die Bridge. v2/v3 sind nicht mischbar (Bridge meldet sonst `frame_bad_len`).
- [ ] **Config-Ack:** Einstellungen → ESP32 → „An ESP32 senden" → Status wechselt auf „✓ Vom Kart bestätigt HH:MM:SS". Kart stromlos machen → erneut senden → nach 3 s „⚠ Keine Bestätigung".
- [ ] **Form-Sync:** Wert am Formular ändern, senden, App neu starten, USB verbinden → Formular zeigt nach ~2 s die Kart-Werte (NVS).
- [ ] **Glitch-Zähler:** Detail-Tab → Diagnose → „Hall-Glitches" zählt bei laufendem Motor (Zündung) sichtbar oder bleibt 0.
- [ ] **Replay nach Neustart:** Rennen mit Aufnahme beenden → App neu starten → Rennen-Tab → Replay-Button aktiv und spielt ab.
- [ ] **Replay in Session:** Rennen beenden und sofort Replay klicken → spielt ab (vorher Bestands-Bug).
- [ ] **Motorstunden:** Mit USB verbunden Motor laufen lassen → Einstellungen → ESP32 → „Motorlaufzeit" zählt; App-Neustart behält den Wert; „Wartung erledigt" nullt „Seit letzter Wartung".

## Self-Review

- **Spec-Abdeckung:** Vorschlag 1 → Tasks 3+4; Vorschlag 2 → Tasks 5+6; Vorschlag 3 → Tasks 1+2; Vorschlag 5 → Tasks 7+8. Vorschlag 4 (TTS) bewusst ausgelassen (User-Entscheidung).
- **Platzhalter-Scan:** alle Code-Schritte enthalten vollständigen Code; keine TBDs.
- **Typ-/Namens-Konsistenz:** `RasiRecStore.{available,keys,put,get,remove,clear}` konsistent zwischen Task 5 und 6; `RasiEngine.{engineStep,hoursText,sinceServiceMs,serviceDue,RUN_RPM_MIN,MAX_GAP_MS}` konsistent zwischen Task 7 und 8; `config_snapshot`/`send_json`/`config_get`/`config_ack` konsistent zwischen Task 3 und 4; `glitch`-Key konsistent Frame↔Sender↔Dashboard↔CSV.

## Phase Map

- Phase 27 (dieser Plan): Race-Day-Followups — Config-Ack, persistente Replays, Glitch-Telemetrie, Betriebsstunden.
- Vorgänger: Phase 22–26 (Modul-Splits, Crash-Sicherung, Auto-Update, GPS-Bounds-Healing) — alle auf `main` bzw. `feat/race-day-quickwins`.
