# Phase 48: Kart-Einstellungs-Fenster + Lebens-Statistik — Implementierungsplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Jede Kart-Karte bekommt einen ⚙-Button, der ein echtes OS-Fenster mit allen Kart-Einstellungen öffnet (Name, freie Farbe, Kalibrierung, ESP-Konfig, Wartung, Gefahrenzone); die Karte wird Status-Anzeige mit neuer Lebens-Statistik (km, Ø-Tempo, Top-Speed, Fahrzeit). Spec: `docs/superpowers/specs/2026-07-13-48-kart-settings-window-design.md`.

**Architecture:** Kind-Fenster via `window.open('')` aus dem Haupt-Renderer — same-origin, der Haupt-Renderer baut das Kind-DOM und bindet alle Handler selbst (kein IPC, kein State-Sync). Neues Modul `src/kart-settings-window.js` verwaltet `Map<mac, Fenster-Rekord>`; `config_ack` wird per `from_mac` ans passende Fenster zugestellt. Neues pures Modul `src/kart-stats.js` (Muster engine.js) zählt Odometer/Fahrzeit/Top-Speed pro Paket; Persistenz analog Motorstunden. Der Phase-47-Dropdown-Abschnitt wird zurückgebaut.

**Tech Stack:** Vanilla ES-Module (Vite), Electron (eine Main-BrowserWindow + native window.open-Kinder), node:test, Playwright (Electron-Smoke).

## Global Constraints

- Kein Eingriff in sender.py/bridge.py; `SAVE_KEY = 'rasicross_v96_data'` und `REC_VERSION` bleiben unangetastet (neue Payload-Keys sind additiv erlaubt).
- Neue Dateien ≤ 520 Inhaltszeilen, gemessen mit `(Get-Content <f> | Measure-Object -Line).Lines`.
- Alle Repo-Dateien sind **CRLF**: Vor jedem Edit die Zielregion frisch Read-en und den Anker aus diesem Read kopieren; Zeilennummern sind nur Richtwerte. Verifikation mit dem Grep-Tool, nie Shell-grep.
- Git immer als `git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" …`; keine Anführungszeichen in Commit-Messages (PowerShell-5.1-Falle); Commit-Trailer (Co-Authored-By + Claude-Session) gemäß aktueller Harness-Vorgabe als weitere `-m`-Argumente anhängen.
- Nie `.claude/`, `CLAUDE.md` oder `graphify-out/` committen; Plan-Doc nur im expliziten Commit in Task 8.
- CSP der App: `script-src 'self'` (keine Inline-Handler, kein injiziertes Script ins Kind-Fenster), `style-src 'unsafe-inline'` (Style-Klonen + style-Attribute OK).
- Baselines (Stand Branch-Start): `npm test` = **194 pass**; `npm run test:e2e` = **12 passed**; Python-Suite `Ran 65 tests` `OK` (Regressionsgate, wird nicht angefasst); `npm run lint` = 0 Fehler.

## Working Directory & Conventions

- Arbeitsverzeichnis: `C:/Users/jimlu/Documents/RasiCross-Telemetrie-git`.
- Branch: `feat/phase-48-kart-settings-window` — **existiert bereits** (gestackt auf `feat/phase-47-kart-settings`, enthält den Spec-Commit). Kein Branch-Anlegen nötig; vor Task 1 `git status` prüfen (sauber bis auf untracked `.claude/`, `CLAUDE.md`, `graphify-out/`).
- Pro Task: Verifikation (`node --check` betroffener ESM-Dateien, `npm test`), dann Commit.
- Vor jedem `git status`/Commit: `__pycache__` löschen, falls vorhanden.
- Nach Merge von PR #74 (Phase 47) muss der spätere Phase-48-PR auf `main` retargetet werden (Stacked-PR-Lektion Phase 46).

## Locked Decisions (aus der Spec)

1. Echte OS-Fenster via `window.open` + Opener-Scripting (Ansatz A) — kein IPC, kein zweiter Vite-Einstieg.
2. Mehrere Fenster gleichzeitig (eines pro Kart); zweiter ⚙-Klick fokussiert das bestehende Fenster.
3. Karte = Status + ⚙-Button; alle Bearbeitung (Name, Farbe, Kalibrierung, ESP, Wartung, Reset/Vergessen) nur im Fenster.
4. Freie Farbe: `<input type="color">` + 5 Palette-Schnellwahl-Punkte (`RasiKartRoster.PALETTE` hat **5** Einträge).
5. Lebens-Statistik: `{ odoM, moveMs, topKmh }` pro Kart; Bewegungs-Schwelle 3 km/h; dt-Lücken > 5000 ms verworfen; Replay zählt nie; Demo zählt session-only.
6. `config_ack`-Zustellung per `from_mac` ans Fenster dieses Karts; ohne `from_mac` ans zuletzt anfragende Fenster; ohne passendes Fenster verworfen.
7. Alle Sendeaktionen mit explizitem `target_mac` des Fenster-Karts.
8. ESP-Feldwerte werden nie vom Refresh überschrieben (nur `config_ack` füllt sie); Fokus-Schutz pro Fenster.
9. `#kartSettingsSection`, `src/kart-settings.js` und `resolveSelectedMac` entfallen; Settings-Tab-Bereinigung aus Phase 47 bleibt.

## File Structure

| Action | Path | Responsibility |
|---|---|---|
| Create | `src/kart-stats.js` | pure Stats-Logik: statsDefaults/statsStep/avgKmh/kmText/kmhText |
| Create | `test/kart-stats.test.js` | 6 Unit-Tests für kart-stats |
| Modify | `src/kart-registry.js` | `makeKartState()` + `stats`-Objekt |
| Modify | `test/kart-registry.test.js` | +1 Test stats-Defaults |
| Modify | `src/store.js` | `_persistedKarts.stats`, Save/Load/Forget, `kartStatsFor` |
| Modify | `src/rasicross.js` | Facade-Re-Export `kartStatsFor` |
| Modify | `src/telemetry.js` | statsStep-Einbau; später `routeConfigAck` statt Ack-Filter |
| Modify | `main.js` | `setWindowOpenHandler` + `did-create-window` (Kind-Fenster-Optionen) |
| Create | `src/kart-settings-window.js` | Fenster-Map, DOM-Aufbau, Handler, Refresh, Ack-Routing |
| Modify | `src/karts-page.js` | Karte: ⚙-Button, Name statisch, Swatches/Aktionen raus, Stats-Zeile; `forgetKart` exportieren |
| Modify | `src/live-ui.js` | 1-Hz-Hook `refreshKartSettingsWindows()` (tab-unabhängig) |
| Modify | `src/app.js` | Import-Kette: + kart-settings-window, − kart-settings |
| Modify | `src/app-init.js` | `initKartSettingsWindows()` statt `initKartSettings()` |
| Modify | `src/esp-config.js` | `applyEspConfigAck(d, doc)`; `armEspAckTimer`/`_espAckTimer` raus |
| Modify | `src/kart-roster.js` | `resolveSelectedMac` → `ackTargetMac` |
| Modify | `test/kart-roster.test.js` | 3 resolveSelectedMac-Tests → 3 ackTargetMac-Tests |
| Delete | `src/kart-settings.js` | Dropdown-UI ersetzt |
| Modify | `index.html` | `#kartSettingsSection` raus; `.kc-name`-CSS-Regel |
| Modify | `e2e/karts.spec.js` | 2 Dropdown-Tests → 3 Fenster-Tests |

Task-Reihenfolge: 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 (strikt sequenziell). Ab Task 4 existieren Fenster-UI und alter Dropdown parallel (getrennte Dokumente, keine ID-Kollision); ab Task 6 ist der alte Pfad vollständig zurückgebaut.

---

### Task 1: src/kart-stats.js — pure Lebens-Statistik (TDD)

**Files:**
- Create: `src/kart-stats.js`
- Test: `test/kart-stats.test.js`

**Interfaces:**
- Produces: `RasiKartStats` (default export) mit
  `MOVE_KMH_MIN = 3`, `MAX_GAP_MS = 5000`,
  `statsDefaults() -> { odoM: 0, moveMs: 0, topKmh: 0, lastAt: null, _unsavedMs: 0 }`,
  `statsStep(acc, speedKmh, nowMs) -> { odoM, moveMs, topKmh, lastAt, addedMs }` (pur, mutiert nichts),
  `avgKmh(odoM, moveMs) -> number`, `kmText(odoM) -> '148,2 km'`, `kmhText(v) -> '24,3 km/h'`.
  Konsumiert von Task 2 (registry-Test), Task 3 (telemetry), Task 4 (Karten-Stats-Zeile).

- [ ] **Step 1: Failing Tests anlegen** — `test/kart-stats.test.js` komplett neu:

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');

let RasiKartStats;
test.before(async () => {
  ({ default: RasiKartStats } = await import('../src/kart-stats.js'));
});

test('statsStep: integriert Distanz und Fahrzeit (36 km/h, 1 s -> +10 m)', () => {
  const acc = { odoM: 100, moveMs: 5000, topKmh: 30, lastAt: 10000 };
  const r = RasiKartStats.statsStep(acc, 36, 11000);
  assert.ok(Math.abs(r.odoM - 110) < 1e-9);
  assert.equal(r.moveMs, 6000);
  assert.equal(r.topKmh, 36);
  assert.equal(r.lastAt, 11000);
  assert.equal(r.addedMs, 1000);
  assert.equal(acc.odoM, 100);   // pur: Eingabe unveraendert
});

test('statsStep: unter 3 km/h zaehlt nichts, lastAt wird genullt', () => {
  const r = RasiKartStats.statsStep({ odoM: 50, moveMs: 2000, topKmh: 20, lastAt: 10000 }, 2, 11000);
  assert.equal(r.odoM, 50);
  assert.equal(r.moveMs, 2000);
  assert.equal(r.lastAt, null);
  assert.equal(r.addedMs, 0);
});

test('statsStep: Luecke > MAX_GAP_MS wird verworfen, zaehlt ab jetzt weiter', () => {
  const r = RasiKartStats.statsStep({ odoM: 50, moveMs: 2000, topKmh: 20, lastAt: 10000 }, 36, 20000);
  assert.equal(r.odoM, 50);
  assert.equal(r.moveMs, 2000);
  assert.equal(r.addedMs, 0);
  assert.equal(r.lastAt, 20000);
});

test('statsStep: topKmh waechst auch im Stand; erster Tick ohne lastAt addiert nichts', () => {
  const still = RasiKartStats.statsStep({ odoM: 0, moveMs: 0, topKmh: 10, lastAt: null }, 2, 1000);
  assert.equal(still.topKmh, 10);
  const fast = RasiKartStats.statsStep({ odoM: 0, moveMs: 0, topKmh: 10, lastAt: null }, 44, 1000);
  assert.equal(fast.topKmh, 44);
  assert.equal(fast.addedMs, 0);
  assert.equal(fast.lastAt, 1000);
});

test('avgKmh: 10 km in 0,5 h -> 20; ohne Fahrzeit -> 0', () => {
  assert.equal(RasiKartStats.avgKmh(10000, 1800000), 20);
  assert.equal(RasiKartStats.avgKmh(10000, 0), 0);
});

test('kmText/kmhText: deutsches Komma, eine Nachkommastelle', () => {
  assert.equal(RasiKartStats.kmText(148234), '148,2 km');
  assert.equal(RasiKartStats.kmhText(24.31), '24,3 km/h');
  assert.equal(RasiKartStats.kmText(0), '0,0 km');
});
```

- [ ] **Step 2: Fehlschlag verifizieren**

Run: `node --test test/kart-stats.test.js`
Expected: FAIL (Cannot find module '../src/kart-stats.js').

- [ ] **Step 3: Implementierung** — `src/kart-stats.js` komplett:

```js
'use strict';
/*!
 * kart-stats.js — Lebens-Statistik pro Kart (Odometer, Fahrzeit, Topspeed),
 * pure Logik (RasiCross, Phase 48). Stil wie engine.js: node:test + Browser.
 * Kein DOM, keine Seiteneffekte, wirft nie.
 */

  // Unterhalb gilt das Kart als stehend (GPS-Rauschen im Stand liegt
  // typisch bei 1-2 km/h und darf keine Kilometer erzeugen).
  const MOVE_KMH_MIN = 3;
  // Groessere Paket-Luecken zaehlen nicht als Fahrt (Funkabriss/Reconnect
  // wuerde sonst Kilometer und Fahrzeit aufblasen).
  const MAX_GAP_MS = 5000;

  // Bewusst dupliziert zu kart-registry.makeKartState().stats —
  // kart-registry bleibt dependency-frei; bei Feldaenderungen BEIDE pflegen.
  function statsDefaults() {
    return { odoM: 0, moveMs: 0, topKmh: 0, lastAt: null, _unsavedMs: 0 };
  }

  // Ein Telemetrie-Tick. acc = { odoM, moveMs, topKmh, lastAt }. Liefert
  // neues { odoM, moveMs, topKmh, lastAt, addedMs } — mutiert nichts.
  function statsStep(acc, speedKmh, nowMs) {
    const odoM = Math.max(0, Number(acc && acc.odoM) || 0);
    const moveMs = Math.max(0, Number(acc && acc.moveMs) || 0);
    const topKmh = Math.max(0, Number(acc && acc.topKmh) || 0);
    const lastAt = (acc && typeof acc.lastAt === 'number') ? acc.lastAt : null;
    const v = Math.max(0, Number(speedKmh) || 0);
    const now = Number(nowMs) || 0;
    const top = Math.max(topKmh, v);
    if (v < MOVE_KMH_MIN) {
      return { odoM: odoM, moveMs: moveMs, topKmh: top, lastAt: null, addedMs: 0 };
    }
    let added = 0;
    if (lastAt != null) {
      const dt = now - lastAt;
      if (dt > 0 && dt <= MAX_GAP_MS) added = dt;
    }
    return { odoM: odoM + (v / 3.6) * (added / 1000), moveMs: moveMs + added,
             topKmh: top, lastAt: now, addedMs: added };
  }

  // Ø nur ueber echte Fahrzeit (Stillstand zaehlt nicht in moveMs).
  function avgKmh(odoM, moveMs) {
    const ms = Number(moveMs) || 0;
    if (ms <= 0) return 0;
    return ((Number(odoM) || 0) / 1000) / (ms / 3600000);
  }

  // 148234 m -> '148,2 km' (deutsches Dezimal-Komma, wie engine.hoursText)
  function kmText(odoM) {
    return (Math.max(0, Number(odoM) || 0) / 1000).toFixed(1).replace('.', ',') + ' km';
  }
  function kmhText(v) {
    return Math.max(0, Number(v) || 0).toFixed(1).replace('.', ',') + ' km/h';
  }

  // ESM-Export (Konvention der Objekt-Module, Phase 42)
  export default { MOVE_KMH_MIN, MAX_GAP_MS, statsDefaults, statsStep,
                   avgKmh, kmText, kmhText };
```

- [ ] **Step 4: Grün verifizieren**

Run: `node --test test/kart-stats.test.js` → alle PASS.
Run: `npm test` → **200 pass** (194 + 6), 0 fail.
Zeilen-Gate: `(Get-Content src/kart-stats.js | Measure-Object -Line).Lines` ≤ 520.

- [ ] **Step 5: Commit**

```bash
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" add src/kart-stats.js test/kart-stats.test.js
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" commit -m "feat(stats): kart-stats.js -- purer Lebens-Zaehler (Phase 48 Task 1)"
```

---

### Task 2: Registry-Bucket + Store-Persistenz + Accessor

**Files:**
- Modify: `src/kart-registry.js` (~Z. 45–49, `makeKartState`)
- Modify: `test/kart-registry.test.js` (ans Dateiende)
- Modify: `src/store.js` (Regionen: `_persistedKarts` ~Z. 97, `rasiPersistForget` ~Z. 100–105, `kartEngineFor` ~Z. 132–135, `saveData` ~Z. 164–191, `loadData` ~Z. 236–250, Export ~Z. 266–270)
- Modify: `src/rasicross.js` (Re-Export-Zeile ~Z. 85)

**Interfaces:**
- Consumes: nichts aus Task 1 zur Laufzeit (Feld-Layout ist dupliziert, s. statsDefaults-Kommentar).
- Produces: `makeKartState().stats = { odoM: 0, moveMs: 0, topKmh: 0, lastAt: null, _unsavedMs: 0 }`; `kartStatsFor(mac) -> statsObjekt|null` (live-Bucket bevorzugt, sonst persistierte Ablage) — exportiert aus store.js **und** re-exportiert aus rasicross.js. Persistenz-Key `kartsStats` im SAVE_KEY-Payload. Konsumiert von Task 3 (telemetry), Task 4 (Karten-Zeile), Task 5 (Stats-Reset).

- [ ] **Step 1: Failing Test anhängen** — `test/kart-registry.test.js` frisch Read-en (Import-Stil des Bestands übernehmen; die Datei lädt `KartRegistry` bereits als Default-Import/`test.before`-Pattern — exakt spiegeln) und ans Dateiende:

```js

test('makeKartState: stats-Defaults (Phase 48)', () => {
  const k = KartRegistry.makeKartState();
  assert.deepEqual(k.stats, { odoM: 0, moveMs: 0, topKmh: 0, lastAt: null, _unsavedMs: 0 });
});
```

Run: `node --test test/kart-registry.test.js` → FAIL (`k.stats` undefined).

- [ ] **Step 2: kart-registry.js** — in `makeKartState()` direkt nach dem `engine:`-Eintrag (Z. 45–46) einfügen:

```js
      stats: { odoM: 0, moveMs: 0, topKmh: 0, lastAt: null, _unsavedMs: 0 },
```

Run: `node --test test/kart-registry.test.js` → PASS.

- [ ] **Step 3: store.js — Ablage + Forget + Accessor**

(a) Zeile 97: `const _persistedKarts = { cal: {}, eng: {}, meta: {} };` → `const _persistedKarts = { cal: {}, eng: {}, meta: {}, stats: {} };`

(b) In `rasiPersistForget(mac)` nach `delete _persistedKarts.eng[mac];` einfügen: `delete _persistedKarts.stats[mac];`

(c) Nach `kartEngineFor` (Z. 132–135) einfügen:

```js
function kartStatsFor(mac) {
  if (state.karts.has(mac)) return state.karts.get(mac).stats;
  return _persistedKarts.stats[mac] || null;
}
```

- [ ] **Step 4: store.js — saveData** (Region frisch Read-en). Nach `const _kartsEngine = Object.assign({}, _persistedKarts.eng);` einfügen:

```js
    const _kartsStats = Object.assign({}, _persistedKarts.stats);
```

In der `for (const mac of state.karts.macs())`-Schleife nach der `_kartsEngine[mac] = …`-Zeile:

```js
      _kartsStats[mac] = { odoM: kk.stats.odoM, moveMs: kk.stats.moveMs, topKmh: kk.stats.topKmh };
```

Nach `_persistedKarts.eng = _kartsEngine;`:

```js
    _persistedKarts.stats = _kartsStats;
```

Im `payload` nach `kartsEngine: _kartsEngine,`:

```js
      kartsStats: _kartsStats,
```

- [ ] **Step 5: store.js — loadData** (Region frisch Read-en). Nach der `_eng`-Zeile (Z. 237) einfügen:

```js
    const _stats = (d.kartsStats && typeof d.kartsStats === 'object') ? d.kartsStats : {};
```

Die Set-Zeile erweitern — alt:
```js
    for (const mac of new Set([...Object.keys(_cal), ...Object.keys(_eng)])) {
```
neu:
```js
    for (const mac of new Set([...Object.keys(_cal), ...Object.keys(_eng), ...Object.keys(_stats)])) {
```

In der Schleife nach dem `if (_eng[mac]) …`-Block:

```js
      if (_stats[mac]) Object.assign(kk.stats, {
        odoM: Number(_stats[mac].odoM) || 0,
        moveMs: Number(_stats[mac].moveMs) || 0,
        topKmh: Number(_stats[mac].topKmh) || 0,
      });
```

Nach `Object.assign(_persistedKarts.eng, _eng);`:

```js
    Object.assign(_persistedKarts.stats, _stats);
```

- [ ] **Step 6: Exporte** — store.js-Export: `kartCalFor, kartEngineFor,` → `kartCalFor, kartEngineFor, kartStatsFor,`. rasicross.js Z. 85 (Re-Export-Zeile) identisch ergänzen: `kartEngineFor,` → `kartEngineFor, kartStatsFor,`.

- [ ] **Step 7: Verifikation**

- `node --check src/kart-registry.js && node --check src/store.js && node --check src/rasicross.js` → keine Ausgabe.
- Grep `kartsStats` in `src/store.js` → 4 Treffer (save-Spiegel, payload, load-Parse… mit Grep-Tool zählen, output_mode=count, erwartet ≥ 4).
- `npm test` → **201 pass** (200 + 1), 0 fail.

- [ ] **Step 8: Commit**

```bash
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" add src/kart-registry.js test/kart-registry.test.js src/store.js src/rasicross.js
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" commit -m "feat(stats): stats-Bucket in Registry + Persistenz kartsStats + kartStatsFor (Phase 48 Task 2)"
```

---

### Task 3: statsStep-Einbau in telemetry.js

**Files:**
- Modify: `src/telemetry.js` (Imports ~Z. 6–19; Einbau nach dem Motorlaufzeit-Block ~Z. 157–175)

**Interfaces:**
- Consumes: `RasiKartStats.statsStep` (Task 1), `k.stats` (Task 2).
- Produces: laufende Stats in `state.karts.get(mac).stats` für jedes Live-Paket (Serial + Demo), nie Replay. Konsumiert von Task 4 (Anzeige).

- [ ] **Step 1: Import ergänzen** — bei den bestehenden Imports (nach `import RasiEngine from './engine.js';`):

```js
import RasiKartStats from './kart-stats.js';
```

- [ ] **Step 2: Einbau** — Region ~Z. 155–180 frisch Read-en. Direkt **nach** dem schließenden `}` des Motorlaufzeit-Blocks (`if (k.connection.source === 'serial' && !k.replay.active) { … }`, endet vor `let gx = …`) einfügen:

```js
    // Lebens-Statistik (Phase 48): Odometer/Fahrzeit/Topspeed. Zaehlt jede
    // Live-Quelle (Serial + Demo-Session-Bucket), nie Replay — der wuerde
    // gefahrene Kilometer doppelt zaehlen.
    if (!k.replay.active) {
      const _st = RasiKartStats.statsStep(k.stats, speed, Date.now());
      k.stats.odoM = _st.odoM;
      k.stats.moveMs = _st.moveMs;
      k.stats.topKmh = _st.topKmh;
      k.stats.lastAt = _st.lastAt;
      k.stats._unsavedMs += _st.addedMs;
      if (k.stats._unsavedMs >= 60000) {   // 1x pro Fahr-Minute persistieren
        k.stats._unsavedMs = 0;
        saveDataDebounced();
      }
    }
```

(`speed` ist ab ~Z. 155 definiert; `saveDataDebounced` ist bereits importiert.)

- [ ] **Step 3: Verifikation**

`node --check src/telemetry.js`; `npm test` → 201 pass.

- [ ] **Step 4: Commit**

```bash
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" add src/telemetry.js
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" commit -m "feat(stats): Lebens-Zaehler pro Telemetrie-Paket in processTelemetry (Phase 48 Task 3)"
```

---

### Task 4: Fenster-Grundgerüst + Identität + Karten-Umbau

**Files:**
- Modify: `main.js` (`createWindow()` ~Z. 440–462)
- Create: `src/kart-settings-window.js`
- Modify: `src/karts-page.js` (`_cardHtml` ~Z. 60–84, `bindCardEvents` ~Z. 138–166, Imports)
- Modify: `src/live-ui.js` (~Z. 592 + Imports)
- Modify: `src/app.js` (Import-Kette)
- Modify: `src/app-init.js` (Import + init-Aufruf ~Z. 39/164–166)
- Modify: `index.html` (CSS-Regel `.kc-name`)

**Interfaces:**
- Consumes: `kartStatsFor` (Task 2), `RasiKartStats` (Task 1); aus `./rasicross.js`: `state, $, esc, setText, rcToast, rcConfirm, saveData, saveDataDebounced, kartMetaFor, kartRosterMacs, kartCalFor, kartEngineFor, kartStatsFor, updateKartMeta, bridgeSend`.
- Produces: `openKartSettings(mac)`, `refreshKartSettingsWindows()`, `closeAllKartSettings()`, `initKartSettingsWindows()` aus `src/kart-settings-window.js`. Interner Fenster-Rekord `{ mac, win, doc, ackTimer, zeroBusy, lastEspUsable }` in `Map<mac, rekord>` — Task 5/6 erweitern `_markup()` und `_refreshWin()` genau dort. Konsumiert von Task 5 (Panels), Task 6 (Ack-Routing), Task 7 (E2E).
- Import-Ring-Hinweis: karts-page.js ↔ kart-settings-window.js ist deklarationsrein (nur Funktions-Deklarationen, kein Top-Level-Call) — gleiches dokumentiertes Muster wie rasicross ↔ kart3d-ui.

- [ ] **Step 1: main.js — Kind-Fenster-Optionen.** In `createWindow()` nach `mainWindow.setMenuBarVisibility(false);` einfügen:

```js
  // Phase 48: Kart-Einstellungs-Fenster (window.open aus dem Renderer) --
  // echte BrowserWindows mit App-Optik, ohne Menueleiste.
  mainWindow.webContents.setWindowOpenHandler(() => ({
    action: "allow",
    overrideBrowserWindowOptions: {
      width: 460,
      height: 720,
      minWidth: 380,
      minHeight: 500,
      autoHideMenuBar: true,
      backgroundColor: "#08080a",
      icon: path.join(__dirname, "icon.ico"),
    },
  }));
  mainWindow.webContents.on("did-create-window", (win) => {
    win.setMenuBarVisibility(false);
  });
```

- [ ] **Step 2: src/kart-settings-window.js anlegen** — kompletter Inhalt (Task 5/6 erweitern `_markup`, `_refreshWin`, `_bindHandlers`):

```js
// ============================================================
//  RasiCross — kart-settings-window.js  (Einstellungs-Fenster pro Kart, Phase 48)
// ============================================================
//  Echte OS-Fenster via window.open aus dem Haupt-Renderer: das Kind ist
//  same-origin (about:blank), der Haupt-Renderer baut dessen DOM auf und
//  bindet alle Handler selbst — kein IPC, kein State-Sync. Mehrere Fenster
//  parallel (Map mac -> Rekord); zweiter ⚙-Klick fokussiert nur.
//  ESP-Feldwerte werden NIE vom Refresh ueberschrieben (nur config_ack
//  fuellt sie, Task 6); Fokus-Schutz gilt pro Fenster.
//  Nur Deklarationen auf Top-Level — kein Code laeuft beim Laden.
// ============================================================
import { state, rcToast, rcConfirm, saveData, saveDataDebounced,
         kartMetaFor, kartRosterMacs, kartCalFor, kartEngineFor, kartStatsFor,
         updateKartMeta, bridgeSend } from './rasicross.js';
import { ESP_CFG_FIELDS } from './esp-config.js';
import { drawGMeter } from './gauges.js';
import RasiEngine from './engine.js';
import RasiKartRoster from './kart-roster.js';
import RasiKartBar from './kart-bar.js';
import KartRegistry from './kart-registry.js';
import { renderKartsTab } from './karts-page.js';

// mac -> { mac, win, doc, ackTimer, zeroBusy, lastEspUsable }
const _wins = new Map();

function _el(r, id) { return r.doc.getElementById(id); }

function _kartIdx(mac) { return Math.max(0, state.karts.macs().indexOf(mac)); }

// Live-Bucket NUR lesen, wenn er existiert — state.karts.get() wuerde sonst
// einen leeren Bucket fuer ein offline-Kart anlegen.
function _liveKart(mac) {
  return (mac && state.karts.has(mac)) ? state.karts.get(mac) : null;
}

// target_mac explizit auf das FENSTER-Kart setzen (Muster pit-wall.js) —
// der bridgeSend-Default waere das aktive Kart.
function _sendTo(mac, payload) {
  if (mac && mac !== KartRegistry.DEFAULT_MAC) payload.target_mac = mac;
  return bridgeSend(payload);
}

// Fenster-Markup: statisches HTML ohne Inline-Handler (CSP script-src 'self');
// alle dynamischen Werte setzt _refreshWin per DOM-API.
function _markup() {
  return '<div class="pw-library" style="margin:0">'
    + '<section class="settings-group active" id="kartIdPanel">'
    +   '<header class="settings-group-head">'
    +     '<div><h2 class="settings-group-title">Identität</h2><p class="settings-group-sub">Name &amp; Farbe</p></div>'
    +   '</header>'
    +   '<div class="settings-row">'
    +     '<div class="settings-row-label"><span class="settings-row-name">Name</span><span class="settings-row-desc">Anzeige in Chip-Leiste, Karten und Rennen</span></div>'
    +     '<input type="text" id="kartName" maxlength="20">'
    +   '</div>'
    +   '<div class="settings-row">'
    +     '<div class="settings-row-label"><span class="settings-row-name">Farbe</span><span class="settings-row-desc">Frei wählbar — Schnellwahl darunter</span></div>'
    +     '<input type="color" id="kartColor">'
    +   '</div>'
    +   '<div class="row" id="kartPaletteRow" style="gap:8px;margin:4px 0 8px"></div>'
    +   '<div class="kc-mac" id="kartMacText"></div>'
    + '</section>'
    + '</div>';
}

function openKartSettings(mac) {
  const existing = _wins.get(mac);
  if (existing && existing.win && !existing.win.closed) {
    try { existing.win.focus(); } catch (e) {}
    return;
  }
  const win = window.open('', '_blank', 'width=460,height=720');
  if (!win) {
    rcToast('Popup blockiert — bitte Popups für die App erlauben', 4000);
    return;
  }
  const doc = win.document;
  doc.documentElement.dataset.theme = state.theme;
  // Styles des Hauptfensters klonen: Vite inlined das App-CSS als <style>-
  // Knoten (Dev: von Vite injizierte <style>; Fonts-<link> ist absolut).
  document.querySelectorAll('style, link[rel="stylesheet"]').forEach((n) => {
    doc.head.appendChild(doc.importNode(n, true));
  });
  doc.body.innerHTML = _markup();
  doc.body.style.cssText = 'padding:14px;overflow-y:auto';
  const r = { mac, win, doc, ackTimer: null, zeroBusy: false, lastEspUsable: null };
  _wins.set(mac, r);
  _el(r, 'kartMacText').textContent = mac;
  _bindHandlers(r);
  _refreshWin(r);
}

function _bindHandlers(r) {
  const name = _el(r, 'kartName');
  name.oninput = () => {
    updateKartMeta(r.mac, { name: name.value.trim() || ('Kart ' + (_kartIdx(r.mac) + 1)) });
    RasiKartBar.render(state);
    renderKartsTab();
    r.doc.title = kartMetaFor(r.mac, _kartIdx(r.mac)).name + ' — Einstellungen';
  };
  const col = _el(r, 'kartColor');
  col.oninput = () => {
    updateKartMeta(r.mac, { color: col.value });
    RasiKartBar.render(state);
    renderKartsTab();
    _renderPalette(r);
  };
}

function _renderPalette(r) {
  const row = _el(r, 'kartPaletteRow');
  if (!row) return;
  const cur = kartMetaFor(r.mac, _kartIdx(r.mac)).color;
  row.innerHTML = RasiKartRoster.PALETTE.map((c) =>
    '<span class="kc-sw' + (c === cur ? ' active' : '') + '" data-color="' + c
    + '" style="background:' + c + ';cursor:pointer"></span>').join('');
  row.querySelectorAll('[data-color]').forEach((sw) => {
    sw.onclick = () => {
      const c = sw.getAttribute('data-color');
      updateKartMeta(r.mac, { color: c });
      const colEl = _el(r, 'kartColor');
      if (colEl) colEl.value = c;
      RasiKartBar.render(state);
      renderKartsTab();
      _renderPalette(r);
    };
  });
}

function _refreshWin(r) {
  const m = kartMetaFor(r.mac, _kartIdx(r.mac));
  r.doc.title = m.name + ' — Einstellungen';
  // Fokus-Schutz PRO FENSTER: waehrend der Nutzer in diesem Fenster tippt,
  // keine Eingabefelder ueberschreiben.
  const ae = r.doc.activeElement;
  const typing = !!(ae && (ae.tagName === 'INPUT' || ae.tagName === 'SELECT'));
  if (!typing) {
    const nameEl = _el(r, 'kartName');
    if (nameEl && nameEl.value !== m.name) nameEl.value = m.name;
    const colEl = _el(r, 'kartColor');
    if (colEl && /^#[0-9a-f]{6}$/i.test(m.color) && colEl.value !== m.color.toLowerCase()) {
      colEl.value = m.color.toLowerCase();
    }
    _renderPalette(r);
  }
}

// 1-Hz-Hook (live-ui.js): geschlossene Fenster aufraeumen, verschwundene
// Roster-Karts schliessen (Demo-Ende, Vergessen), Rest aktualisieren.
function refreshKartSettingsWindows() {
  if (!_wins.size) return;
  const roster = kartRosterMacs();
  for (const [mac, r] of _wins) {
    if (!r.win || r.win.closed) { _wins.delete(mac); continue; }
    if (roster.indexOf(mac) === -1) {
      try { r.win.close(); } catch (e) {}
      _wins.delete(mac);
      continue;
    }
    try { _refreshWin(r); } catch (e) { console.warn('kartSettingsRefresh:', e); }
  }
}

function closeAllKartSettings() {
  for (const [, r] of _wins) {
    try { if (r.win && !r.win.closed) r.win.close(); } catch (e) {}
  }
  _wins.clear();
}

function initKartSettingsWindows() {
  // Reload/Schliessen des Hauptfensters: Kinder haetten sonst keine Logik
  // mehr (alle Handler leben hier im Haupt-Renderer).
  window.addEventListener('beforeunload', closeAllKartSettings);
}

// ESM-Export (Phase 48)
export { openKartSettings, refreshKartSettingsWindows, closeAllKartSettings,
         initKartSettingsWindows };
```

Hinweis: `rcConfirm`, `saveData`, `saveDataDebounced`, `kartCalFor`, `kartEngineFor`, `kartStatsFor`, `drawGMeter`, `RasiEngine`, `ESP_CFG_FIELDS`, `_sendTo`, `_liveKart` werden erst in Task 5/6 benutzt — ESLint no-unused-vars über einen Interface-Marker am Dateiende beruhigen (`void [saveData, saveDataDebounced, kartCalFor, kartEngineFor, kartStatsFor, drawGMeter, RasiEngine, ESP_CFG_FIELDS, rcConfirm, _sendTo, _liveKart];` — Muster rasicross.js Z. 245; in Task 5/6 wieder entfernen, sobald benutzt).

- [ ] **Step 3: karts-page.js — Karte umbauen.** Datei frisch Read-en.

(a) Import ergänzen (nach dem kart-settings-Import):

```js
import { openKartSettings } from './kart-settings-window.js';
import RasiKartStats from './kart-stats.js';
```

und im rasicross-Import `kartEngineFor,` → `kartEngineFor, kartStatsFor,`.

(b) Neue Stats-Zeile — direkt vor `_cardHtml` einfügen:

```js
function _statsHtml(mac) {
  const s = kartStatsFor(mac);
  if (!s) return '';
  return '<div class="kc-live"><span>Gefahren ' + RasiKartStats.kmText(s.odoM) + '</span>'
    + '<span>Ø ' + RasiKartStats.kmhText(RasiKartStats.avgKmh(s.odoM, s.moveMs)) + '</span>'
    + '<span>Top ' + RasiKartStats.kmhText(s.topKmh) + '</span>'
    + '<span>Fahrzeit ' + RasiEngine.hoursText(s.moveMs) + '</span></div>';
}
```

(c) In `_cardHtml` den Kopf ersetzen — alt (Swatches-Konstante + kc-head-Block):

```js
  const swatches = RasiKartRoster.PALETTE.map(col =>
    '<span class="kc-sw' + (col === m.color ? ' active' : '') + '" data-action="color" data-mac="' + esc(mac) + '" data-color="' + col + '" style="background:' + col + '"></span>').join('');
  return '<div class="kart-card' + activeCls + offCls + '" data-mac="' + esc(mac) + '" style="--kart:' + esc(m.color) + '">'
    + '<div class="kc-head">'
    +   '<span class="kc-dot"></span>'
    +   '<div><input type="text" class="kc-name-input" data-action="name" data-mac="' + esc(mac) + '" maxlength="20" value="' + esc(m.name) + '">' + badge
    +   '<div class="kc-mac">' + esc(mac) + '</div></div>'
    +   '<div class="kc-swatches">' + swatches + '</div>'
    + '</div>'
    + (online ? _liveHtml(k, now) : seen)
    + _engineHtml(mac) + _calHtml(mac)
    + '</div>';
```

neu:

```js
  return '<div class="kart-card' + activeCls + offCls + '" data-mac="' + esc(mac) + '" style="--kart:' + esc(m.color) + '">'
    + '<div class="kc-head">'
    +   '<span class="kc-dot"></span>'
    +   '<div><span class="kc-name">' + esc(m.name) + '</span>' + badge
    +   '<div class="kc-mac">' + esc(mac) + '</div></div>'
    +   '<button type="button" class="btn ghost" data-action="settings" data-mac="' + esc(mac) + '">⚙ Einstellungen</button>'
    + '</div>'
    + (online ? _liveHtml(k, now) : seen)
    + _statsHtml(mac)
    + _engineHtml(mac) + _calHtml(mac)
    + '</div>';
```

(d) In `bindCardEvents` die beiden Blöcke `list.querySelectorAll('[data-action="name"]')…` und `list.querySelectorAll('[data-action="color"]')…` **komplett ersetzen** durch:

```js
  list.querySelectorAll('[data-action="settings"]').forEach(btn => {
    btn.onclick = () => openKartSettings(btn.getAttribute('data-mac'));
  });
```

(Wartung/Cal-Reset/Forget-Bindings bleiben in diesem Task noch — Umzug in Task 5.)

- [ ] **Step 4: live-ui.js — 1-Hz-Hook.** Region ~Z. 588–595 frisch Read-en. Alt:

```js
  if (document.body.dataset.tab === 'karts') { try { renderKartsTab(); } catch (e) {} }
```

neu:

```js
  if (document.body.dataset.tab === 'karts') { try { renderKartsTab(); } catch (e) {} }
  // Phase 48: offene Kart-Einstellungs-Fenster tab-unabhaengig aktualisieren.
  try { refreshKartSettingsWindows(); } catch (e) {}
```

Import ergänzen (bei den bestehenden Imports, nach dem karts-page-Import):

```js
import { refreshKartSettingsWindows } from './kart-settings-window.js';
```

- [ ] **Step 5: app.js + app-init.js.** In app.js nach `import './kart-settings.js';`:

```js
import './kart-settings-window.js';
```

In app-init.js: Import ergänzen `import { initKartSettingsWindows } from './kart-settings-window.js';` (neben dem kart-settings-Import) und nach dem Aufruf `initKartSettings();` einfügen:

```js
  initKartSettingsWindows();
```

- [ ] **Step 6: index.html — CSS für den statischen Namen.** Mit Grep `\.kc-name-input` in index.html die Stelle im `<style>`-Block finden, Region frisch Read-en und direkt **vor** der `.kc-name-input`-Regel einfügen:

```css
.kart-card .kc-name{font-weight:600;font-size:14px}
```

- [ ] **Step 7: Verifikation**

- `node --check src/kart-settings-window.js && node --check src/karts-page.js && node --check src/live-ui.js && node --check src/app.js && node --check src/app-init.js` → keine Ausgabe.
- `npm test` → 201 pass; `npm run lint` → 0 Fehler.
- Grep `data-action="name"` in `src/karts-page.js` → 0 Treffer; `data-action="settings"` → 2 Treffer.
- Zeilen-Gate kart-settings-window.js ≤ 520.

- [ ] **Step 8: Commit**

```bash
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" add main.js src/kart-settings-window.js src/karts-page.js src/live-ui.js src/app.js src/app-init.js index.html
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" commit -m "feat(karts): Einstellungs-Fenster pro Kart -- Grundgeruest + Identitaet + Karten-Umbau (Phase 48 Task 4)"
```

---

### Task 5: Kalibrierung, Wartung, Gefahrenzone im Fenster; Karten-Aktionen raus

**Files:**
- Modify: `src/kart-settings-window.js` (`_markup`, `_bindHandlers`, `_refreshWin` erweitern)
- Modify: `src/karts-page.js` (`_engineHtml`/`_calHtml` stutzen, `bindCardEvents`-Blöcke raus, `forgetKart` exportieren)

**Interfaces:**
- Consumes: Fenster-Rekord + Helfer aus Task 4; `forgetKart(mac)` **neu exportiert** aus karts-page.js (bestehende Funktion ~Z. 108–122, nur Export ergänzen).
- Produces: Fenster-Panels `#kartCalPanel` (IDs wie Phase 47: `gxOffsetText`, `gyOffsetText`, `setInvertGx…setInvertRollRate`, `zeroImuBtn`, `resetImuBtn`, `zeroRollBtn`, `kartCalHint`), `#kartServicePanel` (`kartServiceStats`, `kartServiceInterval`, `kartServiceBtn`), `#kartDangerPanel` (`kartCalResetBtn`, `kartStatsResetBtn`, `kartForgetBtn`) — alle IDs nur im Kind-Dokument.

- [ ] **Step 1: `_markup()` erweitern** — nach dem schließenden `</section>` von `kartIdPanel`, vor dem finalen `</div>`, anhängen:

```js
    + '<section class="settings-group active" id="kartCalPanel" style="margin-top:14px">'
    +   '<header class="settings-group-head">'
    +     '<div><h2 class="settings-group-title">Kalibrierung</h2><p class="settings-group-sub">IMU · Nullpunkt &amp; Achsen</p></div>'
    +   '</header>'
    +   '<p class="settings-block-note">Mäher auf eine ebene Fläche stellen, dann „Nullpunkt setzen". Achsen-Korrekturen darunter.</p>'
    +   '<div class="row" style="margin-bottom:14px">'
    +     '<div class="stat"><div class="t">Gx Offset</div><div class="n" id="gxOffsetText">0.00</div></div>'
    +     '<div class="stat"><div class="t">Gy Offset</div><div class="n" id="gyOffsetText">0.00</div></div>'
    +   '</div>'
    +   '<div class="toggle-row"><span class="label-text">Gx invertieren</span><label class="toggle"><input type="checkbox" id="setInvertGx"><span class="toggle-knob"></span></label></div>'
    +   '<div class="toggle-row"><span class="label-text">Gy invertieren</span><label class="toggle"><input type="checkbox" id="setInvertGy"><span class="toggle-knob"></span></label></div>'
    +   '<div class="toggle-row"><span class="label-text">Gx ↔ Gy tauschen</span><label class="toggle"><input type="checkbox" id="setSwapG"><span class="toggle-knob"></span></label></div>'
    +   '<div class="toggle-row"><span class="label-text">Gier invertieren</span><label class="toggle"><input type="checkbox" id="setInvertYaw"><span class="toggle-knob"></span></label></div>'
    +   '<div class="toggle-row"><span class="label-text">Roll-Rate invertieren</span><label class="toggle"><input type="checkbox" id="setInvertRollRate"><span class="toggle-knob"></span></label></div>'
    +   '<div class="row" style="gap:8px;margin:14px 0 4px">'
    +     '<button class="btn primary" id="zeroImuBtn" style="flex:1">Nullpunkt setzen</button>'
    +     '<button class="btn ghost" id="resetImuBtn" style="flex:0 0 auto">Zurücksetzen</button>'
    +     '<button class="btn ghost" id="zeroRollBtn" style="flex:0 0 auto" title="Aktuellen Rollwinkel als 0 setzen — Mäher dazu auf ebener Fläche abstellen">Roll nullen</button>'
    +   '</div>'
    +   '<div style="font-size:11px;color:var(--mut);margin:0 0 4px">⚠ Nullen nur auf <b>ebener Fläche</b> — am Hang genullt wäre jede spätere Messung um die Hangneigung verschoben.</div>'
    +   '<p id="kartCalHint" style="font-family:var(--mono);font-size:11px;color:var(--mut);margin-top:6px;min-height:14px"></p>'
    + '</section>'
    + '<section class="settings-group active" id="kartServicePanel" style="margin-top:14px">'
    +   '<header class="settings-group-head">'
    +     '<div><h2 class="settings-group-title">Wartung</h2><p class="settings-group-sub">Motorstunden &amp; Intervall</p></div>'
    +   '</header>'
    +   '<div class="kc-grid" id="kartServiceStats"></div>'
    +   '<div class="settings-row">'
    +     '<div class="settings-row-label"><span class="settings-row-name">Intervall (h)</span><span class="settings-row-desc">0 = Wartungshinweis aus</span></div>'
    +     '<input type="number" id="kartServiceInterval" min="0" max="500" step="0.5">'
    +   '</div>'
    +   '<div class="row" style="margin:6px 0 4px"><button class="btn ghost" id="kartServiceBtn" style="flex:1">Wartung erledigt</button></div>'
    + '</section>'
    + '<section class="settings-group active" id="kartDangerPanel" style="margin-top:14px">'
    +   '<header class="settings-group-head">'
    +     '<div><h2 class="settings-group-title">Gefahrenzone</h2><p class="settings-group-sub">Zurücksetzen &amp; Entfernen</p></div>'
    +   '</header>'
    +   '<div class="row" style="gap:8px;margin:6px 0 4px">'
    +     '<button class="btn ghost" id="kartCalResetBtn" style="flex:1">Kalibrierung zurücksetzen</button>'
    +     '<button class="btn ghost" id="kartStatsResetBtn" style="flex:1">Statistik zurücksetzen</button>'
    +   '</div>'
    +   '<div class="row" style="margin:6px 0 4px"><button class="btn danger" id="kartForgetBtn" style="flex:1">Kart vergessen</button></div>'
    + '</section>'
```

- [ ] **Step 2: Modul-Konstante + Cal-/Service-Handler in `_bindHandlers(r)` anhängen.** Auf Top-Level (nach `_liveKart`) ergänzen:

```js
const CAL_TOGGLES = [
  ['setInvertGx', 'invertGx'], ['setInvertGy', 'invertGy'], ['setSwapG', 'swapG'],
  ['setInvertYaw', 'invertYaw'], ['setInvertRollRate', 'invertRollRate'],
];
```

Ans Ende von `_bindHandlers(r)` (Handler sind 1:1 aus kart-settings.js portiert — statt `selectedKartMac()` gilt fest `r.mac`, statt globalem `_zeroBusy` gilt `r.zeroBusy`, DOM-Zugriff via `_el(r, id)`):

```js
  for (const [id, key] of CAL_TOGGLES) {
    const el = _el(r, id);
    if (el) el.onchange = () => {
      const c = kartCalFor(r.mac);
      if (!c) return;
      c[key] = !!el.checked;
      drawGMeter._trail = [];
      saveData();
      renderKartsTab();
      _refreshWin(r);
    };
  }
  if (_el(r, 'zeroRollBtn')) _el(r, 'zeroRollBtn').onclick = () => {
    const k = _liveKart(r.mac);
    if (!k) return;
    // Aktuellen fusionierten Rollwinkel (inkl. bestehendem Offset) als neue 0 setzen.
    k.calibration.rollZero = k.calibration.rollZero + ((k.attitude && k.attitude.rollDeg) || 0);
    k.attitude.rollDeg = 0;
    k.attitude.overState = { active: false };
    k.attitude.over = false;
    saveData();
    rcToast('Rollwinkel genullt', 1500);
  };
  if (_el(r, 'zeroImuBtn')) _el(r, 'zeroImuBtn').onclick = () => {
    const btn = _el(r, 'zeroImuBtn');
    if (btn.disabled || r.zeroBusy) return;
    if (!_liveKart(r.mac)) return;
    r.zeroBusy = true;
    const original = btn.textContent;
    btn.disabled = true;
    // Sender-seitige Kalibrierung mitstarten (am Fenster-Kart)
    try {
      _sendTo(r.mac, { type: 'imu_calibrate', action: 'auto', duration_ms: 2000 });
    } catch (e) { console.warn('imu_calibrate send:', e); }
    // Client-seitig: 2 Sekunden lang Samples des Fenster-Karts mitteln
    const samples = [];
    const start = Date.now();
    const duration = 2000;
    const tick = setInterval(() => {
      const elapsed = Date.now() - start;
      const k = _liveKart(r.mac);
      if (k) samples.push({ x: k.raw.gx || 0, y: k.raw.gy || 0 });
      const remain = Math.max(0, duration - elapsed) / 1000;
      btn.textContent = `Kart still halten… ${remain.toFixed(1)}s`;
      if (elapsed >= duration) {
        clearInterval(tick);
        const k2 = _liveKart(r.mac);
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
        r.zeroBusy = false;
        renderKartsTab();
        _refreshWin(r);
      }
    }, 50);
  };
  if (_el(r, 'resetImuBtn')) _el(r, 'resetImuBtn').onclick = () => {
    const c = kartCalFor(r.mac);
    if (!c) return;
    c.gxZero = 0;
    c.gyZero = 0;
    saveData();
    // Sender-Offsets ebenfalls zuruecksetzen (am Fenster-Kart)
    try { _sendTo(r.mac, { type: 'imu_calibrate', action: 'reset' }); } catch (e) {}
    rcToast('IMU-Kalibrierung zurückgesetzt');
    renderKartsTab();
    _refreshWin(r);
  };
  const ivEl = _el(r, 'kartServiceInterval');
  if (ivEl) ivEl.onchange = () => {
    const e = kartEngineFor(r.mac);
    if (!e) return;
    e.serviceIntervalH = RasiKartRoster.clampServiceH(ivEl.value);
    ivEl.value = e.serviceIntervalH;
    saveDataDebounced();
    renderKartsTab();
  };
  if (_el(r, 'kartServiceBtn')) _el(r, 'kartServiceBtn').onclick = async () => {
    window.focus();   // rcConfirm rendert im Hauptfenster
    if (!await rcConfirm('Wartungszähler zurücksetzen? Seit-letzter-Wartung beginnt wieder bei 0.', 'Wartung', 'Zurücksetzen')) return;
    const e = kartEngineFor(r.mac);
    if (!e) return;
    e.lastServiceMs = e.totalMs;
    if ('_warned' in e) e._warned = false;
    saveData();
    rcToast('🔧 Wartung vermerkt');
    renderKartsTab();
    _refreshWin(r);
  };
  if (_el(r, 'kartCalResetBtn')) _el(r, 'kartCalResetBtn').onclick = async () => {
    window.focus();
    if (!await rcConfirm('Kalibrierung dieses Karts auf Werkswerte zurücksetzen?', 'Kalibrierung', 'Zurücksetzen', true)) return;
    const c = kartCalFor(r.mac);
    if (!c) return;
    Object.assign(c, RasiKartRoster.calDefaults());
    saveData();
    rcToast('Kalibrierung zurückgesetzt');
    renderKartsTab();
    _refreshWin(r);
  };
  if (_el(r, 'kartStatsResetBtn')) _el(r, 'kartStatsResetBtn').onclick = async () => {
    window.focus();
    if (!await rcConfirm('Statistik (Kilometer, Ø, Top-Speed, Fahrzeit) dieses Karts auf 0 setzen?', 'Statistik', 'Zurücksetzen', true)) return;
    const s = kartStatsFor(r.mac);
    if (!s) return;
    s.odoM = 0;
    s.moveMs = 0;
    s.topKmh = 0;
    if ('lastAt' in s) s.lastAt = null;
    saveData();
    rcToast('Statistik zurückgesetzt');
    renderKartsTab();
  };
  if (_el(r, 'kartForgetBtn')) _el(r, 'kartForgetBtn').onclick = async () => {
    window.focus();
    if (!await rcConfirm('Dieses Kart endgültig vergessen? Name, Farbe, Kalibrierung, Statistik und Motorstunden werden gelöscht.', 'Kart vergessen', 'Vergessen', true)) return;
    forgetKart(r.mac);
    try { r.win.close(); } catch (e) {}
    _wins.delete(r.mac);
  };
```

karts-page-Import erweitern: `import { renderKartsTab } from './karts-page.js';` → `import { renderKartsTab, forgetKart } from './karts-page.js';`

- [ ] **Step 3: `_refreshWin(r)` erweitern** — am Ende der Funktion (nach dem `_renderPalette(r)`-if-Block) anhängen:

```js
  _renderCal(r, typing);
  _renderService(r, typing);
```

und die beiden Renderer auf Top-Level ergänzen (Port aus kart-settings.js `_renderCalPanel` + karts-page `_engineHtml`-Werte):

```js
function _renderCal(r, typing) {
  const c = kartCalFor(r.mac);
  const online = !!_liveKart(r.mac);
  for (const [id] of CAL_TOGGLES) { const el = _el(r, id); if (el) el.disabled = !c; }
  if (c) {
    _el(r, 'gxOffsetText').textContent = (Number(c.gxZero) || 0).toFixed(2);
    _el(r, 'gyOffsetText').textContent = (Number(c.gyZero) || 0).toFixed(2);
    for (const [id, key] of CAL_TOGGLES) { const el = _el(r, id); if (el) el.checked = !!c[key]; }
  } else {
    _el(r, 'gxOffsetText').textContent = '--';
    _el(r, 'gyOffsetText').textContent = '--';
  }
  // Live-Aktionen brauchen Telemetrie des Fenster-Karts.
  if (_el(r, 'zeroImuBtn')) _el(r, 'zeroImuBtn').disabled = !online || r.zeroBusy;
  if (_el(r, 'zeroRollBtn')) _el(r, 'zeroRollBtn').disabled = !online;
  if (_el(r, 'resetImuBtn')) _el(r, 'resetImuBtn').disabled = !c;
  _el(r, 'kartCalHint').textContent = !c ? 'Keine Kalibrierdaten für dieses Kart.'
    : (online ? '' : 'Kart offline — Nullpunkt/Roll nullen erst bei Live-Telemetrie.');
}

function _renderService(r, typing) {
  const e = kartEngineFor(r.mac);
  const grid = _el(r, 'kartServiceStats');
  if (!e) {
    if (grid) grid.innerHTML = '<div class="dstat"><span>Motorstunden</span><b>--</b></div>';
    if (_el(r, 'kartServiceInterval')) _el(r, 'kartServiceInterval').disabled = true;
    if (_el(r, 'kartServiceBtn')) _el(r, 'kartServiceBtn').disabled = true;
    return;
  }
  const due = RasiEngine.serviceDue(e.totalMs, e.lastServiceMs, e.serviceIntervalH);
  if (grid) grid.innerHTML = '<div class="dstat"><span>Motorlaufzeit</span><b>' + RasiEngine.hoursText(e.totalMs) + '</b></div>'
    + '<div class="dstat"><span>Seit Wartung</span><b>' + RasiEngine.hoursText(RasiEngine.sinceServiceMs(e.totalMs, e.lastServiceMs)) + '</b></div>'
    + (due ? '<div class="dstat"><span>Status</span><b class="kc-warn">🔧 fällig</b></div>' : '');
  const ivEl = _el(r, 'kartServiceInterval');
  if (ivEl) {
    ivEl.disabled = false;
    if (!typing) ivEl.value = e.serviceIntervalH;
  }
  if (_el(r, 'kartServiceBtn')) _el(r, 'kartServiceBtn').disabled = false;
}
```

Interface-Marker aus Task 4 um die jetzt benutzten Namen kürzen (nur noch nie benutzte dort lassen: `esc`, `setText`-Äquivalente, `ESP_CFG_FIELDS`, `RasiKartStats` falls unbenutzt — mit ESLint prüfen).

- [ ] **Step 4: karts-page.js — Karten-Aktionen entfernen.** Datei frisch Read-en.

(a) `_engineHtml`: den kompletten `'<div class="kc-actions">…</div>'`-Teil (Intervall-Label + Service-Button) ersetzen durch reine Warn-Anzeige — Funktion neu:

```js
function _engineHtml(mac) {
  const e = kartEngineFor(mac);
  if (!e) return '';
  const due = RasiEngine.serviceDue(e.totalMs, e.lastServiceMs, e.serviceIntervalH);
  return '<div class="kc-grid">'
    + '<div class="dstat"><span>Motorlaufzeit</span><b>' + RasiEngine.hoursText(e.totalMs) + '</b></div>'
    + '<div class="dstat"><span>Seit Wartung</span><b>' + RasiEngine.hoursText(RasiEngine.sinceServiceMs(e.totalMs, e.lastServiceMs)) + '</b></div>'
    + '</div>'
    + (due ? '<div class="kc-actions"><span class="kc-warn">🔧 Wartung fällig</span></div>' : '');
}
```

(b) `_calHtml`: den `'<div class="kc-actions">…</div>'`-Teil (Cal-Reset + Forget-Button) ersatzlos streichen — Funktion endet nach dem `kc-grid`-Div.

(c) In `bindCardEvents` die vier Blöcke `[data-action="interval"]`, `[data-action="service"]`, `[data-action="calreset"]`, `[data-action="forget"]` ersatzlos löschen.

(d) Export ergänzen — alt: `export { renderKartsTab };` neu: `export { renderKartsTab, forgetKart };`

(e) Nicht mehr benutzte Imports prüfen (Grep im File): `rcConfirm`, `saveDataDebounced`, `kartCalFor` etc. nur entfernen, wenn 0 Rest-Treffer (resetAllKarts nutzt rcConfirm weiter!).

- [ ] **Step 5: Verifikation**

- `node --check src/kart-settings-window.js && node --check src/karts-page.js` → keine Ausgabe.
- Grep `data-action="forget"|data-action="service"|data-action="interval"|data-action="calreset"` in `src/karts-page.js` → 0 Treffer.
- `npm test` → 201 pass; `npm run lint` → 0 Fehler.
- Zeilen-Gate kart-settings-window.js ≤ 520.

- [ ] **Step 6: Commit**

```bash
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" add src/kart-settings-window.js src/karts-page.js
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" commit -m "feat(karts): Kalibrierung + Wartung + Gefahrenzone ins Kart-Fenster, Karte nur noch Status (Phase 48 Task 5)"
```

---

### Task 6: ESP-Block + Ack-Routing + kompletter Rückbau des Phase-47-Dropdowns

**Files:**
- Modify: `src/kart-settings-window.js` (ESP-Markup, Handler, `_renderEsp`, `routeConfigAck`)
- Modify: `src/esp-config.js` (`applyEspConfigAck(d, doc)`; `armEspAckTimer`/`_espAckTimer` raus)
- Modify: `src/telemetry.js` (`routeConfigAck` statt Filter)
- Modify: `src/kart-roster.js` (`resolveSelectedMac` → `ackTargetMac`)
- Modify: `test/kart-roster.test.js` (3 Tests tauschen)
- Delete: `src/kart-settings.js`
- Modify: `index.html` (`#kartSettingsSection`-Block ~Z. 3160–3256 komplett raus)
- Modify: `src/app.js`, `src/app-init.js`, `src/karts-page.js` (alte Verdrahtung raus)

**Interfaces:**
- Consumes: Fenster-Map aus Task 4/5.
- Produces: `routeConfigAck(d)` (Export aus kart-settings-window.js) — einziger `config_ack`-Pfad; `applyEspConfigAck(d, doc)` (esp-config.js) füllt Felder im übergebenen Dokument; `RasiKartRoster.ackTargetMac(fromMac, lastMac, openMacs) -> string|null` (pur).

- [ ] **Step 1: kart-roster.js — pure Routing-Entscheidung (TDD).** In `test/kart-roster.test.js` (frisch Read-en) die drei `resolveSelectedMac`-Tests ersetzen durch (und `resolveSelectedMac` in der Destrukturierung durch `ackTargetMac` tauschen):

```js
test('ackTargetMac: from_mac gewinnt, wenn ein Fenster offen ist', () => {
  assert.equal(ackTargetMac('BB:02', 'AA:01', ['AA:01', 'BB:02']), 'BB:02');
});

test('ackTargetMac: ohne from_mac (alte Firmware) -> letztes Anfrage-Ziel', () => {
  assert.equal(ackTargetMac(null, 'AA:01', ['AA:01', 'BB:02']), 'AA:01');
});

test('ackTargetMac: kein passendes offenes Fenster -> null', () => {
  assert.equal(ackTargetMac('CC:03', 'AA:01', ['BB:02']), null);
  assert.equal(ackTargetMac(null, null, ['AA:01']), null);
  assert.equal(ackTargetMac('AA:01', null, null), null);
});
```

Run: `node --test test/kart-roster.test.js` → FAIL. Dann in `src/kart-roster.js` `resolveSelectedMac` (Funktion + Kommentar + Export-Eintrag) ersetzen durch:

```js
  // config_ack-Zustellung (Phase 48): from_mac bestimmt das Fenster; Acks
  // alter Firmware ohne from_mac gehen an das zuletzt anfragende Fenster.
  // Kein passendes offenes Fenster -> null (Ack verwerfen).
  function ackTargetMac(fromMac, lastMac, openMacs) {
    const list = Array.isArray(openMacs) ? openMacs : [];
    const mac = fromMac || lastMac || null;
    return (mac && list.indexOf(mac) >= 0) ? mac : null;
  }
```

Export: `…, clampServiceH, calDefaults, ackTargetMac };`
Run: `node --test test/kart-roster.test.js` → PASS.

- [ ] **Step 2: esp-config.js umbauen** — `applyEspConfigAck` neu (kompletter Ersatz der alten Funktion inkl. der `_espAckTimer`-Zeilen und `armEspAckTimer`; ESP_CFG_FIELDS bleibt):

```js
function applyEspConfigAck(d, doc) {
  // Phase 48: Zieldokument = Einstellungs-Fenster des bestaetigenden Karts
  // (routeConfigAck in kart-settings-window.js waehlt es); ohne doc kein
  // globales Formular mehr -> nichts tun.
  if (!doc) return;
  for (const [id, key] of ESP_CFG_FIELDS) {
    const el = doc.getElementById(id);
    if (el && d[key] != null) el.value = d[key];
  }
  // Akkuzellen-Zahl gehoert zum bestaetigenden Kart (per from_mac), sonst aktiver Kart.
  const _k = kartFor(d.from_mac || KartRegistry.DEFAULT_MAC) || activeKart();
  if (d.bc != null) _k.batt.cells = Number(d.bc) || _k.batt.cells;
  const st = doc.getElementById('espSendStatus');
  if (st) st.textContent = '✓ Vom Kart bestätigt ' + logTime();
}
```

`let _espAckTimer = null;` und die komplette `armEspAckTimer`-Funktion löschen; Export: `export { ESP_CFG_FIELDS, applyEspConfigAck };`
Import-Zeile anpassen: `import { $, setText, logTime } from './rasicross.js';` → `import { logTime } from './rasicross.js';`
Vorher Grep `armEspAckTimer` in `src/` → Treffer nur in esp-config.js + kart-settings.js (wird in Step 5 gelöscht); bei weiteren Treffern: STOPP, Ursache klären.

- [ ] **Step 3: kart-settings-window.js — ESP-Block.** In `_markup()` nach dem `kartCalPanel`-`</section>`, vor `kartServicePanel`, einfügen (IDs identisch zu Phase 47):

```js
    + '<section class="settings-group active" id="kartEspPanel" style="margin-top:14px">'
    +   '<header class="settings-group-head">'
    +     '<div><h2 class="settings-group-title">ESP32 / Sender</h2><p class="settings-group-sub">Sender-Konfig dieses Karts</p></div>'
    +   '</header>'
    +   '<p class="settings-block-note">Werte unten gehen erst per „An ESP32 senden" an den Kart und wirken dann sofort.</p>'
    +   '<div class="settings-row"><div class="settings-row-label"><span class="settings-row-name">Max RPM (Sender)</span><span class="settings-row-desc">Drehzahl-Obergrenze im Sender</span></div><input type="number" id="espMaxRpm" value="6000"></div>'
    +   '<div class="settings-row"><div class="settings-row-label"><span class="settings-row-name">Warn RPM (Sender)</span><span class="settings-row-desc">Warnschwelle im Sender</span></div><input type="number" id="espWarnRpm" value="5500"></div>'
    +   '<div class="settings-row"><div class="settings-row-label"><span class="settings-row-name">Sende-Intervall</span><span class="settings-row-desc">Telemetrie-Rate des Senders (ms)</span></div><input type="number" id="espSendMs" value="80" min="20" max="500"></div>'
    +   '<div class="settings-row"><div class="settings-row-label"><span class="settings-row-name">Pulses per Revolution</span><span class="settings-row-desc">Sensor-Pulse pro Wellenumdrehung</span></div><input type="number" id="espPulses" value="1" min="1" max="32"></div>'
    +   '<div class="settings-row"><div class="settings-row-label"><span class="settings-row-name">Radumfang</span><span class="settings-row-desc">Meter pro Radumdrehung (0 = nur GPS)</span></div><input type="number" id="espWheelCirc" value="0" min="0" step="0.001"></div>'
    +   '<div class="settings-row"><div class="settings-row-label"><span class="settings-row-name">Übersetzung Welle:Rad</span><span class="settings-row-desc">Getriebeverhältnis (1 = 1:1)</span></div><input type="number" id="espGearRatio" value="1" min="0.01" step="0.01"></div>'
    +   '<div class="settings-row"><div class="settings-row-label"><span class="settings-row-name">Akkuzellen in Reihe</span><span class="settings-row-desc">Anzahl LiPo-Zellen (cells in series)</span></div><input type="number" id="espBattCells" value="1" min="1" max="14"></div>'
    +   '<div class="settings-row"><div class="settings-row-label"><span class="settings-row-name">Akku Warn-Schwelle</span><span class="settings-row-desc">Warnung ab dieser Spannung pro Zelle (V)</span></div><input type="number" id="espBattWarnV" value="3.5" min="2.5" max="4.4" step="0.05"></div>'
    +   '<div class="settings-row"><div class="settings-row-label"><span class="settings-row-name">Akku Kritisch-Schwelle</span><span class="settings-row-desc">Kritisch ab dieser Spannung pro Zelle (V)</span></div><input type="number" id="espBattCritV" value="3.3" min="2.0" max="4.4" step="0.05"></div>'
    +   '<div class="settings-row"><div class="settings-row-label"><span class="settings-row-name">Akku Feinkalibrierung</span><span class="settings-row-desc">Multiplikator auf die gemessene Spannung (Abgleich mit Multimeter)</span></div><input type="number" id="espBattCal" value="1.0" min="0.5" max="2.0" step="0.01"></div>'
    +   '<div class="settings-row"><div class="settings-row-label"><span class="settings-row-name">RPM Glitch-Schwelle</span><span class="settings-row-desc">Flanken oberhalb dieser Drehzahl gelten als Störimpuls (Zünd-EMI); 0 = Filter aus</span></div><input type="number" id="espRpmCeiling" value="16000" min="0" max="30000" step="500"></div>'
    +   '<div class="settings-row"><div class="settings-row-label"><span class="settings-row-name">RPM-Glättung</span><span class="settings-row-desc">EMA-Gewicht des neuen Werts: 1 = ungefiltert, klein = träge</span></div><input type="number" id="espRpmAlpha" value="0.25" min="0.05" max="1" step="0.05"></div>'
    +   '<div class="settings-row"><div class="settings-row-label"><span class="settings-row-name">OLED Seitenwechsel</span><span class="settings-row-desc">Auto-Seitenwechsel des Kart-Displays (ms)</span></div><input type="number" id="espPageMs" value="4000" min="1000" max="20000" step="500"></div>'
    +   '<div class="row" style="margin:6px 0 4px"><button class="btn primary" id="espSendBtn" style="flex:1">An ESP32 senden</button></div>'
    +   '<p id="espSendStatus" style="font-family:var(--mono);font-size:11px;color:var(--mut);margin-top:6px;text-align:center;min-height:14px"></p>'
    + '</section>'
```

- [ ] **Step 4: kart-settings-window.js — ESP-Handler, Refresh, Routing.**

(a) Top-Level ergänzen:

```js
// Letztes config/config_get-Ziel — Acks alter Firmware ohne from_mac
// gehen an dieses Fenster.
let _lastCfgMac = null;
```

(b) In `openKartSettings(mac)` nach `_refreshWin(r);` anhängen:

```js
  // Ist-Konfig anfragen — config_ack fuellt das Formular (routeConfigAck).
  if (state.serial && state.serial.connected && _liveKart(mac)) {
    _lastCfgMac = mac;
    try { _sendTo(mac, { type: 'config_get' }); } catch (e) {}
  }
```

(c) Ans Ende von `_bindHandlers(r)`:

```js
  if (_el(r, 'espSendBtn')) _el(r, 'espSendBtn').onclick = () => {
    const k = _liveKart(r.mac);
    const doc = r.doc;
    const num = (id) => Number(doc.getElementById(id).value);
    const cfg = {
      type: 'config',
      max_rpm: num('espMaxRpm') || 6000,
      warn_rpm: num('espWarnRpm') || 5500,
      send_ms: num('espSendMs') || 80,
      pulses_per_rev: num('espPulses') || 1,
      wheel_circ_m: num('espWheelCirc') || 0,
      gear_ratio: num('espGearRatio') || 1,
      batt_cells: num('espBattCells') || 1,
      batt_warn_v: num('espBattWarnV') || 3.5,
      batt_crit_v: num('espBattCritV') || 3.3,
      batt_cal: num('espBattCal') || 1.0,
      rpm_ceiling: Math.max(0, num('espRpmCeiling') || 0),
      rpm_alpha: num('espRpmAlpha') || 0.25,
      page_ms: num('espPageMs') || 4000,
    };
    const stEl = _el(r, 'espSendStatus');
    if (!state.serial.connected || !k) {
      if (stEl) stEl.textContent = !state.serial.connected ? 'Nicht verbunden' : 'Kart nicht verbunden';
      return;
    }
    k.batt.cells = cfg.batt_cells;
    try {
      _lastCfgMac = r.mac;
      _sendTo(r.mac, cfg);
      if (stEl) stEl.textContent = '✓ Gesendet — warte auf Bestätigung…';
      clearTimeout(r.ackTimer);
      r.ackTimer = setTimeout(() => {
        const el = _el(r, 'espSendStatus');
        if (el) el.textContent = '⚠ Keine Bestätigung vom Kart — Funkverbindung prüfen';
      }, 3000);
    } catch (e) {
      if (stEl) stEl.textContent = '✗ Fehler';
    }
  };
```

(d) `_renderEsp` auf Top-Level + Aufruf am Ende von `_refreshWin(r)` (`_renderEsp(r);` nach `_renderService(r, typing);`):

```js
function _renderEsp(r) {
  const online = !!_liveKart(r.mac);
  const usable = online && !!(state.serial && state.serial.connected);
  for (const [id] of ESP_CFG_FIELDS) { const el = _el(r, id); if (el) el.disabled = !usable; }
  if (_el(r, 'espSendBtn')) _el(r, 'espSendBtn').disabled = !usable;
  // Status nur bei ZUSTANDSWECHSEL schreiben — Sende-/Ack-Meldungen sonst
  // nicht bei jedem 1-Hz-Refresh ueberschreiben.
  if (usable !== r.lastEspUsable) {
    r.lastEspUsable = usable;
    const el = _el(r, 'espSendStatus');
    if (el) el.textContent = usable ? ''
      : (online ? 'Bridge nicht verbunden' : 'Kart nicht verbunden — Konfig erscheint bei Live-Telemetrie');
  }
}
```

(e) `routeConfigAck` auf Top-Level + Export ergänzen:

```js
// config_ack-Zustellung: from_mac -> Fenster dieses Karts; ohne from_mac
// (alte Firmware) -> zuletzt anfragendes Fenster; sonst verwerfen.
function routeConfigAck(d) {
  const mac = RasiKartRoster.ackTargetMac(d.from_mac, _lastCfgMac, Array.from(_wins.keys()));
  const r = mac ? _wins.get(mac) : null;
  if (!r || !r.win || r.win.closed) return;
  clearTimeout(r.ackTimer);
  r.ackTimer = null;
  applyEspConfigAck(d, r.doc);
}
```

Import erweitern: `import { ESP_CFG_FIELDS } from './esp-config.js';` → `import { ESP_CFG_FIELDS, applyEspConfigAck } from './esp-config.js';`
Export erweitern: `export { openKartSettings, refreshKartSettingsWindows, closeAllKartSettings, initKartSettingsWindows, routeConfigAck };`
Interface-Marker aus Task 4/5 entfernen, falls jetzt alles benutzt ist.

- [ ] **Step 5: Rückbau.**

(a) `src/telemetry.js`: `import { selectedKartMac } from './kart-settings.js';` → `import { routeConfigAck } from './kart-settings-window.js';` und Z. 113 alt `if (d.type === 'config_ack') { applyEspConfigAck(d, selectedKartMac()); return; }` neu:

```js
    if (d.type === 'config_ack') { routeConfigAck(d); return; }
```

`applyEspConfigAck`-Import aus telemetry.js entfernen (Grep bestätigt: kein weiterer Nutzer in der Datei).

(b) `src/app.js`: Zeile `import './kart-settings.js';` löschen (kart-settings-window-Import aus Task 4 bleibt).

(c) `src/app-init.js`: `import { initKartSettings } from './kart-settings.js';` löschen; den Aufruf `initKartSettings();` löschen (`initKartSettingsWindows();` bleibt).

(d) `src/karts-page.js`: `import { renderKartSettings } from './kart-settings.js';` löschen; in `renderKartsTab()` die Zeilen `// Phase 47: …` + `renderKartSettings();` löschen.

(e) `src/kart-settings.js` löschen: `git -C … rm src/kart-settings.js`

(f) `index.html`: den kompletten Block von `<!-- Kart-Einstellungen (Phase 47): …` bis zum schließenden `</div>` von `#kartSettingsSection` (direkt vor `</section>` von `#tab-karts`, ~Z. 3160–3256) frisch Read-en und ersatzlos löschen.

- [ ] **Step 6: Verifikation**

| Grep-Pattern (Grep-Tool) | Pfad | Erwartung |
|---|---|---|
| `kart-settings\.js` (ohne -window) | `src/` + `index.html` | 0 Treffer |
| `kartSettingsSection|kartSettingsSelect` | gesamtes Repo ohne docs/graphify-out | 0 Treffer in src/index.html/e2e (docs dürfen) |
| `armEspAckTimer` | `src/` | 0 Treffer |
| `resolveSelectedMac` | `src/` + `test/` | 0 Treffer |
| `routeConfigAck` | `src/` | 2 Treffer (Definition + telemetry-Aufruf) + Export-Zeile |

- `node --check src/kart-settings-window.js && node --check src/esp-config.js && node --check src/telemetry.js && node --check src/kart-roster.js && node --check src/app.js && node --check src/app-init.js && node --check src/karts-page.js` → keine Ausgabe.
- `npm test` → **201 pass** (3 getauschte Tests), 0 fail; `npm run lint` → 0 Fehler.
- Zeilen-Gate kart-settings-window.js ≤ 520.

- [ ] **Step 7: Commit**

```bash
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" add -A src/ test/kart-roster.test.js index.html
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" commit -m "feat(esp): ESP-Formular im Kart-Fenster + config_ack-Routing, Phase-47-Dropdown zurueckgebaut (Phase 48 Task 6)"
```

---

### Task 7: Playwright-Smoke umbauen + volle Gates

**Files:**
- Modify: `e2e/karts.spec.js` (die zwei Phase-47-Tests ersetzen, einen dritten ergänzen)

**Interfaces:**
- Consumes: `[data-action="settings"]` auf den Karten (Task 4), Kind-Fenster-IDs `kartName`, `setInvertGx` (Task 4/5), Karten-Klassen `.kc-name`, `.kc-sw`, `.kc-name-input` (Task 4), `RasiTest.state.karts` (bestehende Test-Brücke), `app` aus `launchApp()` (helpers.js).

- [ ] **Step 1: Die zwei Phase-47-Tests ersetzen.** In `e2e/karts.spec.js` (frisch Read-en) die beiden Tests `'Kart-Einstellungen: Toggle wirkt auf das im Dropdown gewaehlte Kart'` und `'Einstellungen-Tab ohne Kart-Einstellungen, Karts-Tab traegt sie'` komplett ersetzen durch:

```js

test('⚙-Button oeffnet Kart-Fenster; Rename im Fenster wirkt auf die Chip-Leiste', async () => {
  await startDemo();
  await page.click('.nav-item[data-tab="karts"]');
  await page.waitForFunction(() => document.querySelectorAll('#kartCardsList [data-action="settings"]').length >= 3);
  const [winPage] = await Promise.all([
    app.waitForEvent('window'),
    page.click('#kartCardsList .kart-card:nth-child(2) [data-action="settings"]'),
  ]);
  await winPage.waitForSelector('#kartName');
  await winPage.fill('#kartName', 'Turbo');
  await winPage.dispatchEvent('#kartName', 'input');
  await page.waitForFunction(() =>
    document.querySelector('#kartBar') && document.querySelector('#kartBar').textContent.includes('Turbo'));
  // Freie Farbe: Palette-Schnellwahl im Fenster setzt --kart der Karte.
  // #b07ae8 ist PALETTE[4] und bei 3 Demo-Karts nie ein Default.
  await winPage.click('#kartPaletteRow [data-color="#b07ae8"]');
  await page.waitForFunction(() => {
    const card = document.querySelector('#kartCardsList .kart-card:nth-child(2)');
    return card && (card.getAttribute('style') || '').includes('#b07ae8');
  });
  expect(errors).toEqual([]);
});

test('Fenster-Toggle wirkt nur auf sein Kart; Karte ist reine Status-Anzeige', async () => {
  await startDemo();
  await page.click('.nav-item[data-tab="karts"]');
  await page.waitForFunction(() => document.querySelectorAll('#kartCardsList [data-action="settings"]').length >= 3);
  const { active, other } = await page.evaluate(() => {
    const a = RasiTest.state.karts.activeMac();
    const demo = RasiTest.state.karts.macs().filter((m) => m.indexOf('DE:MO:') === 0);
    return { active: a, other: demo.find((m) => m !== a) };
  });
  const [winPage] = await Promise.all([
    app.waitForEvent('window'),
    page.click(`#kartCardsList .kart-card[data-mac="${other}"] [data-action="settings"]`),
  ]);
  await winPage.waitForSelector('#setInvertGx');
  // Checkbox sitzt unsichtbar im Toggle-Label -- Change-Event direkt ausloesen.
  await winPage.evaluate(() => {
    const el = document.getElementById('setInvertGx');
    el.checked = true;
    el.dispatchEvent(new Event('change'));
  });
  const probe = await page.evaluate(([a, o]) => ({
    otherInv: RasiTest.state.karts.get(o).calibration.invertGx,
    activeInv: RasiTest.state.karts.get(a).calibration.invertGx,
    nameInputs: document.querySelectorAll('#kartCardsList .kc-name-input').length,
    swatches: document.querySelectorAll('#kartCardsList .kc-sw').length,
    forgetBtns: document.querySelectorAll('#kartCardsList [data-action="forget"]').length,
  }), [active, other]);
  expect(probe.otherInv).toBe(true);
  expect(probe.activeInv).toBe(false);
  expect(probe.nameInputs).toBe(0);
  expect(probe.swatches).toBe(0);
  expect(probe.forgetBtns).toBe(0);
  expect(errors).toEqual([]);
});

test('Stats-Zeile auf der Karte; Dropdown-Abschnitt existiert nicht mehr', async () => {
  await startDemo();
  // Demo-Karts fahren -> Odometer waechst binnen Sekunden.
  await page.waitForFunction(() => {
    const macs = RasiTest.state.karts.macs().filter((m) => m.indexOf('DE:MO:') === 0);
    return macs.length && RasiTest.state.karts.get(macs[0]).stats.odoM > 0;
  });
  await page.click('.nav-item[data-tab="karts"]');
  await page.waitForFunction(() =>
    document.querySelector('#kartCardsList') && document.querySelector('#kartCardsList').textContent.includes('Gefahren'));
  const probe = await page.evaluate(() => ({
    hasSection: !!document.getElementById('kartSettingsSection'),
    hasSelect: !!document.getElementById('kartSettingsSelect'),
    hasTop: document.querySelector('#kartCardsList').textContent.includes('Top '),
    navSensorik: !!document.querySelector('#tab-settings .settings-nav-item[data-sgroup="sensorik"]'),
    navFahrdynamik: !!document.querySelector('#tab-settings .settings-nav-item[data-sgroup="fahrdynamik"]'),
  }));
  expect(probe.hasSection).toBe(false);
  expect(probe.hasSelect).toBe(false);
  expect(probe.hasTop).toBe(true);
  expect(probe.navSensorik).toBe(false);
  expect(probe.navFahrdynamik).toBe(true);
  expect(errors).toEqual([]);
});
```

- [ ] **Step 2: Volle Gates**

- `npm test` → 201 pass, 0 fail.
- `npm run lint` → 0 Fehler.
- `npm run test:e2e` → **13 passed** (12 − 2 + 3; falls ein Bestandstest durch den Umbau bricht — z. B. der Rename-Test aus Phase 46, der `.kc-name-input` nutzt: dessen Rename-Weg läuft jetzt über das Fenster; den Bestandstest entsprechend auf den neuen Weg umbauen, Ursache dokumentieren — nie blind den Test löschen). **Hinweis:** Der Phase-46-Test `'Karts-Tab zeigt 3 Demo-Karten, Rename wirkt in der Chip-Leiste'` nutzt `.kc-name-input` und WIRD brechen — beim Umbau seinen Rename-Teil streichen (Rename ist jetzt durch den neuen Fenster-Test abgedeckt) und nur die 3-Karten-Assertion behalten.
- Python-Regressionsgate: `python -m unittest discover -s test -p "test_*.py"` → `Ran 65 tests` `OK`.
- `__pycache__` löschen, falls entstanden.

- [ ] **Step 3: Commit**

```bash
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" add e2e/karts.spec.js
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" commit -m "test(e2e): Kart-Fenster-Smoke (oeffnen, Rename, Toggle-Isolation, Stats-Zeile) (Phase 48 Task 7)"
```

---

### Task 8: Graph aktualisieren + Plan-Doc committen

- [ ] **Step 1:** `graphify update .` (AST-only).
- [ ] **Step 2:** Plan-Doc committen (einzige erlaubte Plan-Doc-Stage):

```bash
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" add docs/superpowers/plans/2026-07-13-48-kart-settings-window.md docs/superpowers/specs/2026-07-13-48-kart-settings-window-design.md
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" commit -m "docs(plan): Phase 48 Kart-Einstellungs-Fenster Implementierungsplan + Spec-Korrektur Palette"
```

(Die Spec-Datei trägt eine nachträgliche Korrektur „5 statt 8 Palette-Farben" — mit committen, falls `git status` sie als modified zeigt; sonst nur den Plan.)

- [ ] **Step 3:** `git status` sauber (keine `.claude/`-, `CLAUDE.md`- oder `graphify-out/`-Stages).

---

## Hardware/Manual Acceptance Checklist (User, nach Merge)

- [ ] Zwei echte Karts online: je ⚙ → zwei Fenster parallel; „An ESP32 senden" in Fenster B ändert **nur** Kart B; `config_get`-Roundtrip füllt Fenster B mit den Werten von B (nicht A).
- [ ] Ack alter Firmware (ohne from_mac): landet im zuletzt anfragenden Fenster.
- [ ] Fenster auf zweiten Monitor ziehen, Theme Light/Dark/Outdoor prüfen (Fenster erbt Theme beim Öffnen).
- [ ] Odometer-Plausibilität nach echter Fahrt (km/Ø/Top/Fahrzeit auf der Karte; Reconnect erzeugt keine Sprünge).
- [ ] Offline-Kart: Fenster öffnet, Name/Farbe/Toggles/Wartung nutzbar, Nullpunkt/ESP deaktiviert mit Hinweis.
- [ ] „Kart vergessen" im Fenster schließt das Fenster; App-Neustart: Statistik bleibt erhalten (Persistenz).
- [ ] Sichtprüfung Portable-EXE (Fenster-Layout, kein Menü im Kind-Fenster).

## Self-Review

- **Spec-Abdeckung:** Lebens-Zähler (T1–T3), Stats-Zeile Karte (T4), ⚙-Button + echtes Fenster + Mehrfach-Fenster + Fokus-per-Klick (T4), Name/freie Farbe + 5er-Palette (T4), Kalibrierung/Wartung/Gefahrenzone inkl. Stats-Reset + Vergessen-schließt-Fenster (T5), ESP mit target_mac + config_get beim Öffnen + Ack-Routing per from_mac/lastCfg (T6), Rückbau Dropdown/kart-settings.js/resolveSelectedMac (T6), Fenster-Aufräumen (closed/Roster/beforeunload, T4), Popup-Blocker-Toast (T4), dt-Lücken-Schutz (T1), kein SAVE_KEY-Bump (T2 additiv), Tests (T1/T2/T6/T7).
- **Platzhalter-Scan:** keine TBD/TODO; jeder Code-Step trägt vollständigen Code.
- **Typ-/Namens-Konsistenz:** `openKartSettings/refreshKartSettingsWindows/closeAllKartSettings/initKartSettingsWindows/routeConfigAck` (T4/T6) = Verbraucher karts-page/live-ui/app-init/telemetry; `kartStatsFor` (T2) = karts-page/kart-settings-window; `ackTargetMac(fromMac, lastMac, openMacs)` (T6) = Aufruf in routeConfigAck; `applyEspConfigAck(d, doc)` (T6) = einziger Aufrufer routeConfigAck; Fenster-Rekord-Felder `{ mac, win, doc, ackTimer, zeroBusy, lastEspUsable }` konsistent in T4/T5/T6.

## Phasen-Karte

- Phase 46 (Karts-Tab, PR #67/#68): gemergt.
- Phase 47 (Dropdown-Panels, PR #74): Basis dieses Branches — nach Merge PR retargeten.
- **Phase 48 (dieser Plan): Einstellungs-Fenster pro Kart + Lebens-Statistik.**
- Spec: `docs/superpowers/specs/2026-07-13-48-kart-settings-window-design.md`.
