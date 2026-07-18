# Phase 56: Verbindungsseite Neuaufbau — Implementierungsplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Der Verbindungs-Tab wird von der Einzel-Kart-Diagnoseseite zur Multi-Kart-Verbindungszentrale: Hero mit Verbinden-Aktion + Demo-Chip, Kart-Karten-Grid mit Ampel-Status und Klartext-Hinweisen, Auto-Connect mit persistiertem Port.

**Architecture:** Pure Ampel-/Aggregat-Logik in `src/conn-health.js` (TDD, wirft nie — Muster `live-view.js`), DOM-Rendering in `src/conn-ui.js` als **einziger Writer** der Verbindungsseiten-IDs im bestehenden 1-Hz-Loop (`live-ui.js`). Altes Markup (`#serialPanel`/`#demoPanel`/Mode-Tabs/Pill-Zeile/Datenfluss-Diagramm) und alle Alt-Writer (`renderConnectionTab` in pit-wall.js, conn-Spiegel in ui-glue.js, reconnectStatus in live-ui.js) entfallen. Auto-Connect persistiert Pfad+Baud in `state.settings` und nutzt den bestehenden `scheduleReconnect()`-Backoff.

**Tech Stack:** Vanilla ESM (Vite/Electron), `node:test` für pure Module, Playwright-e2e (4 Specs + Screenshot-Gate), CSS-Token-Gate (`npm run lint:css`).

**Spec:** `docs/superpowers/specs/2026-07-17-56-verbindungsseite-design.md` (vom User freigegeben 2026-07-17).

## Global Constraints

- Basis: `main` nach Merge PR #78; Arbeit auf Feature-Branch `feat/phase-56-verbindungsseite` (abgezweigt von `docs/spec-56-verbindungsseite`, das die Spec trägt).
- Baselines grün halten: `npm test` = **210 → ≈222** (nur `test/conn-health.test.js` kommt dazu); `npm run lint` = 0 Fehler; `npm run lint:css` = OK; Python `python -m unittest discover -s test -p "test_*.py"` = **65 OK** (unangetastet).
- Ampel-Schwellen (Locked Decision 7, eingefroren in `THRESHOLDS`): offline > 5000 ms; warn ab RSSI < −75 dBm, Rate < 5 Hz, kein GPS-Fix > 30000 ms (bzw. nie Fix), Paketalter > 2000 ms; **max. 2 Hinweise**, Priorität offline > Signal > GPS > Rate > Paketalter. Fehlende Werte (rssi null, hz null, gpsFix undefined) lösen allein kein warn aus; Junk wirft nie.
- Neue Settings-Keys (migrationsfrei via `Object.assign`): `serialAutoConnect: true`, `serialLastPath: null`, `serialLastBaud: 115200`.
- Stabile neue IDs: `#demoChip`, `#connActionBtn`, `#connDetailsBtn`, `#connDetails`, `#connPortLine`, `#heroKarts`, `#heroRate`, `#heroGps`, `#connGrid`; **unverändert weiterleben:** `#serialPortSelect`, `#serialBaud`, `#serialRefreshBtn`, `#serialConnectBtn`, `#autoConnectToggle` (umbenannt aus `autoReconnectToggle`), `#connBridgeMac`, `#rssiSpark`, `#packetLog`.
- Nicht-Ziele: Sidebar (`#connectBtn`, `#sideConnCard`), Top-Pill (`#topConnPill`), ESP-/Python-Seite, Recording/Replay, Alarm-/Sound-Logik, Persistieren von Aufklapper-Zuständen.
- CSS nur über Tokens/Skalen (Hex- + Skalen-Gate). **Es gibt kein `--yellow`-Token** — die Warn-Farbe der Spec („gelb") ist app-weit `var(--orange)`/`var(--orange-glow)`, rot ist `var(--red)`/`var(--red-glow)` (tokens.css:36–39).
- Ein Writer pro Ziel-ID — keine 200-ms/1-Hz-Doppelschreiber (Lektion Phase 49/50).

## Working Directory & Conventions

- Arbeitsverzeichnis: `C:/Users/jimlu/Documents/RasiCross-Telemetrie-git`; Git immer als `git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" …`.
- Dateien sind **CRLF**: vor jedem Edit die Zielregion frisch Readen und den Anker aus diesem Read kopieren; Anker sind Text, Zeilennummern nur Orientierung. Verifikation mit dem **Grep-Tool** (nicht Shell-grep).
- Niemals `.claude/`, `graphify-out/` oder Plan-/Spec-Docs committen — außer dem expliziten Plan-Doc-Commit in Task 7.
- Commit-Messages: conventional + Body, **keine Anführungszeichen** in der Message (PowerShell-5.1-Falle), Trailer:
  `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>` und `Claude-Session: https://claude.ai/code/session_01HxeZiHkjGii8N5pWAXWFfS`.
- Verifikations-Rezept pro Task: `node --check` auf jede angefasste JS-Datei, `npm test` (auto-discovers `test/`), bei CSS/HTML zusätzlich `npm run lint` + `npm run lint:css`. `__pycache__` vor `git status` löschen. Nach Code-Änderungen `graphify update .` laufen lassen.
- e2e lokal: `npm run test:e2e` (Screenshot-Spec skippt außerhalb Linux ohne `RASI_SCREENS=1`); Baseline-Einfrieren läuft über den CI-Freigabe-Loop mit dem User (deferred, wie Phase 49/55).

## Locked Decisions (User, 2026-07-17)

1. Grundlayout A — Kart-Karten-Grid (Muster Live-Übersicht), keine Tabelle, kein Multi-Kart-Datenfluss-Diagramm.
2. Kopfbereich B — Verbinden-Aktion im pw-Hero (Portstatus links; Aggregate + Demo-Chip + Aktions-Button rechts).
3. Demo-Chip `#demoChip` im Hero (ein Klick); `#demoPanel` + Mode-Tabs entfallen ersatzlos; Demo exklusiv zu USB.
4. Auto-Connect beim App-Start mit persistiertem Port; Fehlversuche über den bestehenden Backoff; Toggle heißt „Automatisch verbinden" und wandert in den Details-Aufklapper.
5. Klartext-Hinweise auf der Kart-Karte bzw. im Hero; Diagnose-Aufklapper pro Kart; globale Diagnose (Bridge-MAC, RSSI-Verlauf, Paket-Log) im Details-Aufklapper (Standard: zu).
6. Strategie A — Neuaufbau in einer Phase; neue Module `conn-health.js` (pur, TDD) + `conn-ui.js` (DOM); Rückbau der alten Writer.
7. Ampel-Schwellen wie unter Global Constraints (benannte Konstanten `THRESHOLDS`).

## File Structure

| Action | Path | Responsibility |
|---|---|---|
| Create | `src/conn-health.js` | Pur, kein DOM, wirft nie: `classifyKart`, `aggregate`, `heroStatus`, `THRESHOLDS` (Default-Export-Objekt) |
| Create | `test/conn-health.test.js` | node:test-Suite (≈12 Tests): Grenzwerte, Priorität/Max-2, fehlende Werte, Junk, aggregate, heroStatus |
| Create | `src/conn-ui.js` | DOM-Renderer (1 Hz): Hero-Werte/Portstatus/Aktions-Button, Kart-Grid + Aufklapper, Platzhalter, Hz aus Paketzähler-Deltas; übernimmt `pushPacketLog` + RSSI-Sparkline aus pit-wall.js |
| Modify | `src/store.js` | Settings-Defaults `serialAutoConnect/serialLastPath/serialLastBaud`; `state.serial` + `dropped`/`autoConnected` |
| Modify | `src/serial-demo.js` | `connectSerial({auto})` (persistiert Pfad+Baud, still bei Auto-Fehlversuch), `autoConnect()`, Demo-Chip-Updates, Verbinden-Sperre bei laufender Demo |
| Modify | `index.html` | `#tab-connection` neu: Hero + `#connDetails` + `#connGrid`; alte Struktur raus (Pill-Zeile, Mode-Tabs, `#serialPanel`, `#demoPanel`, Diagramm, diagnose-only) |
| Modify | `src/app-init.js` | Neue Event-Verdrahtung (Chip/Aktion/Details/Toggle), alte Bindings raus, `autoConnect()` nach `listSerialPorts()` |
| Modify | `src/pit-wall.js` | Rückbau: `renderConnectionTab`, `pushPacketLog`, `toggleDiagnose`, Sparkline + `_packetLog`/`_rssiHist` raus (Log/Sparkline ziehen nach conn-ui.js) |
| Modify | `src/ui-glue.js` | conn-Spiegel (Z. 50–54) raus; Footer-Hz aus `state._lastHz` statt `#connHz`-DOM |
| Modify | `src/live-ui.js` | 1-Hz-Loop ruft `ConnUi.render()` statt `renderConnectionTab()`; reconnectStatus-Writer raus |
| Modify | `src/styles/pages/connection.css` | Neuaufbau: Portstatus-Zeile, Chip, Details, Grid/Karten/Hinweise; `.serial-form`/`.mono-box`/`.packet-log` bleiben; Rest der Alt-Selektoren raus |
| Modify | `e2e/demo.spec.js`, `e2e/karts.spec.js`, `e2e/replay.spec.js`, `e2e/screens.spec.js` | Demo-Start = 1 Klick auf `#demoChip`; `prep()`-Wait auf `#heroGps`; neuer Shot `demo-connection` (14 → 15 Baselines) |

**Task-Reihenfolge:** 1 → 2 → 3 → 4 → 5 → 6 → 7 (strikt sequenziell; Task 3 lässt die Alt-Writer bewusst noch stehen — sie sind alle null-sicher gegen fehlende IDs —, Task 4 baut sie zurück).

---

### Task 1: `conn-health.js` — pure Ampel-/Aggregat-/Portstatus-Logik (TDD)

**Files:**
- Create: `test/conn-health.test.js`
- Create: `src/conn-health.js`

**Interfaces:**
- Consumes: nichts (dependency-frei).
- Produces (Default-Export-Objekt `{ classifyKart, aggregate, heroStatus, THRESHOLDS }`):
  - `classifyKart({ now, lastPacketAt, rssi, hz, gpsFix, gpsLastAt })` → `{ level: 'ok'|'warn'|'off', hints: [String] }`
  - `aggregate([{ level, hz, gpsFix }])` → `{ online, total, hzSum, gpsFixCount }`
  - `heroStatus({ connected, portName, baud, auto, demoRunning, reconnecting, attempts, dropped })` → `{ text, level: 'ok'|'demo'|'warn'|'err'|'idle' }`
  - `THRESHOLDS` (frozen): `OFFLINE_MS: 5000, RSSI_WARN_DBM: -75, GPS_STALE_MS: 30000, RATE_WARN_HZ: 5, AGE_WARN_MS: 2000, MAX_HINTS: 2`

- [ ] **Step 1: Failing Tests schreiben** — `test/conn-health.test.js` mit exakt diesem Inhalt:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import CH from '../src/conn-health.js';

const C = (o) => CH.classifyKart(o);
const NOW = 1000000;
// Gesunder Kart als Basis; Tests ueberschreiben gezielt einzelne Felder.
const OK = { now: NOW, lastPacketAt: NOW - 100, rssi: -60, hz: 12, gpsFix: true, gpsLastAt: NOW - 100 };

test('exports the pure api + frozen thresholds', () => {
  assert.equal(typeof CH.classifyKart, 'function');
  assert.equal(typeof CH.aggregate, 'function');
  assert.equal(typeof CH.heroStatus, 'function');
  assert.ok(Object.isFrozen(CH.THRESHOLDS));
  assert.deepEqual(CH.THRESHOLDS, {
    OFFLINE_MS: 5000, RSSI_WARN_DBM: -75, GPS_STALE_MS: 30000,
    RATE_WARN_HZ: 5, AGE_WARN_MS: 2000, MAX_HINTS: 2,
  });
});

test('classifyKart: gesunder Kart -> ok ohne Hinweise', () => {
  assert.deepEqual(C(OK), { level: 'ok', hints: [] });
});

test('offline: Grenze 5000 ms strikt (> off, == noch nicht), N s im Hinweis', () => {
  assert.equal(C({ ...OK, lastPacketAt: NOW - 5000 }).level, 'warn'); // 5000 ms Alter: nicht off, aber > 2 s -> verzoegert
  const off = C({ ...OK, lastPacketAt: NOW - 5001 });
  assert.equal(off.level, 'off');
  assert.equal(off.hints.length, 1);
  assert.match(off.hints[0], /^Seit 5 s keine Pakete/);
  assert.match(off.hints[0], /Akku, Reichweite oder Sender/);
});

test('offline: nie ein Paket (lastPacketAt null/fehlend) -> off, wirft nie', () => {
  const r = C({ now: NOW });
  assert.equal(r.level, 'off');
  assert.match(r.hints[0], /Keine Pakete empfangen/);
});

test('rssi: -75 ist noch ok, < -75 warn; rssi null bewertet nicht', () => {
  assert.equal(C({ ...OK, rssi: -75 }).level, 'ok');
  const w = C({ ...OK, rssi: -76 });
  assert.equal(w.level, 'warn');
  assert.deepEqual(w.hints, ['Schwaches Signal — Reichweite/Antenne prüfen.']);
  assert.equal(C({ ...OK, rssi: null }).level, 'ok');
});

test('gps: fix=false + Alter > 30 s oder nie Fix -> warn; frischer fix=false nicht; gpsFix undefined nicht', () => {
  assert.equal(C({ ...OK, gpsFix: false, gpsLastAt: NOW - 30000 }).level, 'ok');
  const w = C({ ...OK, gpsFix: false, gpsLastAt: NOW - 30001 });
  assert.deepEqual(w.hints, ['Kein GPS-Fix — freie Sicht zum Himmel?']);
  const nie = C({ ...OK, gpsFix: false, gpsLastAt: null });
  assert.equal(nie.level, 'warn');
  const ohne = { ...OK };
  delete ohne.gpsFix;
  assert.equal(C(ohne).level, 'ok');
});

test('rate: 5 Hz ok, < 5 warn; hz null bewertet nicht', () => {
  assert.equal(C({ ...OK, hz: 5 }).level, 'ok');
  assert.deepEqual(C({ ...OK, hz: 4 }).hints, ['Datenrate niedrig.']);
  assert.equal(C({ ...OK, hz: null }).level, 'ok');
});

test('alter: > 2000 ms -> Pakete verzoegert (2000 selbst noch nicht)', () => {
  assert.equal(C({ ...OK, lastPacketAt: NOW - 2000 }).level, 'ok');
  assert.deepEqual(C({ ...OK, lastPacketAt: NOW - 2001 }).hints, ['Pakete verzögert.']);
});

test('prioritaet + max 2: Signal vor GPS vor Rate; dritter Hinweis faellt weg', () => {
  const r = C({ ...OK, rssi: -90, gpsFix: false, gpsLastAt: null, hz: 1 });
  assert.equal(r.level, 'warn');
  assert.deepEqual(r.hints, [
    'Schwaches Signal — Reichweite/Antenne prüfen.',
    'Kein GPS-Fix — freie Sicht zum Himmel?',
  ]);
});

test('junk wirft nie', () => {
  assert.equal(C().level, 'off');
  assert.equal(C(null).level, 'off');
  assert.equal(C({ now: 'x', lastPacketAt: 'y', rssi: NaN, hz: 'z', gpsFix: 42 }).level, 'off');
});

test('aggregate: online = ok+warn, hzSum, gpsFixCount; Junk zaehlt nur in total', () => {
  assert.deepEqual(CH.aggregate([
    { level: 'ok', hz: 12, gpsFix: true },
    { level: 'warn', hz: 9, gpsFix: false },
    { level: 'off', hz: 0, gpsFix: false },
    null,
  ]), { online: 2, total: 4, hzSum: 21, gpsFixCount: 1 });
  assert.deepEqual(CH.aggregate([]), { online: 0, total: 0, hzSum: 0, gpsFixCount: 0 });
  assert.deepEqual(CH.aggregate('junk'), { online: 0, total: 0, hzSum: 0, gpsFixCount: 0 });
});

test('heroStatus: Demo > verbunden > Reconnect > getrennt > idle', () => {
  assert.deepEqual(CH.heroStatus({ demoRunning: true, connected: true }),
    { text: 'Demo-Modus aktiv', level: 'demo' });
  assert.deepEqual(CH.heroStatus({ connected: true, portName: 'COM7', baud: 115200, auto: true }),
    { text: 'COM7 · 115200 ● verbunden (auto)', level: 'ok' });
  assert.deepEqual(CH.heroStatus({ connected: true, portName: 'COM7', baud: 115200 }),
    { text: 'COM7 · 115200 ● verbunden', level: 'ok' });
  assert.deepEqual(CH.heroStatus({ reconnecting: true, attempts: 3 }),
    { text: 'Wiederverbinden, Versuch 3…', level: 'warn' });
  assert.deepEqual(CH.heroStatus({ dropped: true }),
    { text: 'USB getrennt — Kabel prüfen', level: 'err' });
  assert.deepEqual(CH.heroStatus({}), { text: 'Nicht verbunden', level: 'idle' });
  assert.deepEqual(CH.heroStatus(), { text: 'Nicht verbunden', level: 'idle' });
});
```

- [ ] **Step 2: Fehlschlag verifizieren** — Run: `npm test`
  Expected: FAIL (Cannot find module …conn-health.js), Rest der 210 grün.

- [ ] **Step 3: Implementierung** — `src/conn-health.js` mit exakt diesem Inhalt:

```js
'use strict';
/*!
 * conn-health.js — pure Ampel-/Aggregations-Logik der Verbindungsseite
 * (Phase 56): classifyKart (Ampel + Klartext-Hinweise), aggregate
 * (Hero-Zahlen), heroStatus (Portstatus-Zeile).
 * Reines Modul — kein DOM, keine Seiteneffekte, wirft nie (Muster live-view.js).
 */

const THRESHOLDS = Object.freeze({
  OFFLINE_MS: 5000,     // > 5 s ohne Paket -> offline
  RSSI_WARN_DBM: -75,   // < -75 dBm -> Schwaches Signal
  GPS_STALE_MS: 30000,  // fix=false laenger als 30 s (oder nie Fix) -> GPS-Hinweis
  RATE_WARN_HZ: 5,      // < 5 Hz -> Datenrate niedrig
  AGE_WARN_MS: 2000,    // > 2 s Paketalter -> Pakete verzoegert
  MAX_HINTS: 2,
});

function _num(v) { return (typeof v === 'number' && isFinite(v)) ? v : null; }

// classifyKart({ now, lastPacketAt, rssi, hz, gpsFix, gpsLastAt })
//   -> { level: 'ok'|'warn'|'off', hints: [String] }
// Prioritaet: offline > Signal > GPS > Rate > Paketalter; max. MAX_HINTS.
// Fehlende Werte (rssi null, hz null, gpsFix undefined) werden nicht bewertet.
function classifyKart(a) {
  const o = a || {};
  const now = _num(o.now) !== null ? _num(o.now) : 0;
  const last = _num(o.lastPacketAt);
  if (last === null || now - last > THRESHOLDS.OFFLINE_MS) {
    const hint = last === null
      ? 'Keine Pakete empfangen — Akku, Reichweite oder Sender prüfen.'
      : 'Seit ' + Math.round((now - last) / 1000) + ' s keine Pakete — Akku, Reichweite oder Sender prüfen.';
    return { level: 'off', hints: [hint] };
  }
  const hints = [];
  const rssi = _num(o.rssi);
  if (rssi !== null && rssi < THRESHOLDS.RSSI_WARN_DBM) {
    hints.push('Schwaches Signal — Reichweite/Antenne prüfen.');
  }
  const gpsLastAt = _num(o.gpsLastAt);
  if (o.gpsFix === false && (gpsLastAt === null || now - gpsLastAt > THRESHOLDS.GPS_STALE_MS)) {
    hints.push('Kein GPS-Fix — freie Sicht zum Himmel?');
  }
  const hz = _num(o.hz);
  if (hz !== null && hz < THRESHOLDS.RATE_WARN_HZ) hints.push('Datenrate niedrig.');
  if (now - last > THRESHOLDS.AGE_WARN_MS) hints.push('Pakete verzögert.');
  const capped = hints.slice(0, THRESHOLDS.MAX_HINTS);
  return { level: capped.length ? 'warn' : 'ok', hints: capped };
}

// aggregate([{ level, hz, gpsFix }, ...]) -> { online, total, hzSum, gpsFixCount }
// online = ok + warn (gruen+gelb); Junk-Eintraege zaehlen nur in total.
function aggregate(kartResults) {
  const list = Array.isArray(kartResults) ? kartResults : [];
  let online = 0, hzSum = 0, gpsFixCount = 0;
  for (const e of list) {
    const o = e || {};
    if (o.level === 'ok' || o.level === 'warn') online++;
    const hz = _num(o.hz);
    if (hz !== null) hzSum += hz;
    if (o.gpsFix === true) gpsFixCount++;
  }
  return { online: online, total: list.length, hzSum: hzSum, gpsFixCount: gpsFixCount };
}

// heroStatus({ connected, portName, baud, auto, demoRunning, reconnecting,
//              attempts, dropped }) -> { text, level }
// level ist zugleich CSS-Klasse der Portstatus-Zeile: ok|demo|warn|err|idle.
function heroStatus(a) {
  const o = a || {};
  if (o.demoRunning === true) return { text: 'Demo-Modus aktiv', level: 'demo' };
  if (o.connected === true) {
    const port = (typeof o.portName === 'string' && o.portName && o.portName !== '--') ? o.portName : '?';
    const baud = _num(o.baud) !== null ? _num(o.baud) : 115200;
    return {
      text: port + ' · ' + baud + ' ● verbunden' + (o.auto === true ? ' (auto)' : ''),
      level: 'ok',
    };
  }
  if (o.reconnecting === true) {
    const n = _num(o.attempts) !== null ? Math.max(1, Math.round(_num(o.attempts))) : 1;
    return { text: 'Wiederverbinden, Versuch ' + n + '…', level: 'warn' };
  }
  if (o.dropped === true) return { text: 'USB getrennt — Kabel prüfen', level: 'err' };
  return { text: 'Nicht verbunden', level: 'idle' };
}

export default { classifyKart, aggregate, heroStatus, THRESHOLDS };
```

- [ ] **Step 4: Grün verifizieren** — Run: `npm test`
  Expected: `tests 222` `pass 222` `fail 0` (210 + 12 neue).

- [ ] **Step 5: Syntax + Lint** — Run: `node --check src/conn-health.js` und `npm run lint`
  Expected: kein Output bzw. 0 Fehler.

- [ ] **Step 6: Commit**

```
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" add src/conn-health.js test/conn-health.test.js
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" commit -m "feat(conn): conn-health.js -- Ampel-, Aggregat- und Portstatus-Logik, TDD (Phase 56 Task 1)" ...(+ Trailer)
```

---

### Task 2: Settings-Persistenz + Auto-Connect-Logik (store.js, serial-demo.js)

**Files:**
- Modify: `src/store.js:28-30`
- Modify: `src/serial-demo.js:40-113,145-173,184-187,360-364`

**Interfaces:**
- Consumes: `saveDataDebounced` (bereits in serial-demo.js importiert), `scheduleReconnect()` (bestehend).
- Produces: `connectSerial(opts)` mit `opts.auto: boolean` (Default false); `autoConnect(): Promise<void>` (neuer Export aus serial-demo.js); Laufzeit-Flags `state.serial.dropped`/`state.serial.autoConnected`; persistierte Keys `state.settings.serialAutoConnect/serialLastPath/serialLastBaud`. Task 3/4 verlassen sich auf exakt diese Namen.

- [ ] **Step 1: store.js — Settings-Defaults + serial-Flags.** Region um Zeile 28–30 frisch Readen. In der `serial:`-Zeile `lastPath: null }` ersetzen durch `lastPath: null, dropped: false, autoConnected: false }`. In der `settings:`-Zeile nach `recordAutoArm: true,` einfügen: `serialAutoConnect: true, serialLastPath: null, serialLastBaud: 115200,`

- [ ] **Step 2: serial-demo.js — connectSerial auf `opts.auto` umstellen.** Signatur `async function connectSerial() {` → `async function connectSerial(opts) {` und direkt danach als erste Zeile `const _auto = !!(opts && opts.auto);`. Die Zeile `if (state.demo.running) stopDemo();` ersetzen durch (Spec: Verbinden stoppt die Demo nie automatisch):

```js
  if (state.demo.running) { rcToast('Demo läuft — zuerst Demo stoppen'); return; }
```

  Die Zeile `state.serial.autoReconnect = $('autoReconnectToggle').checked;` ersetzen durch:

```js
  state.serial.autoReconnect = state.settings.serialAutoConnect !== false;
```

- [ ] **Step 3: serial-demo.js — Erfolg persistiert Pfad+Baud.** Im rasiSerial-Zweig direkt nach `state.serial.lastPath = path;` einfügen:

```js
      state.serial.dropped = false;
      state.serial.autoConnected = _auto;
      // Phase 56: letzten Port + Baud persistieren -> Auto-Connect beim Start
      state.settings.serialLastPath = path;
      state.settings.serialLastBaud = state.serial.baud;
      saveDataDebounced();
```

  Im WebSerial-Zweig nach `state.serial.portName = 'WebSerial';` einfügen: `state.serial.dropped = false; state.serial.autoConnected = false;` (WebSerial hat keinen persistierbaren Pfad).

- [ ] **Step 4: serial-demo.js — Auto-Fehlversuch still an den Backoff übergeben.** Den catch-Block von connectSerial ersetzen durch:

```js
  } catch (e) {
    activeKart().connection.errors++;
    state.serial.connected = false;
    if (_auto) {
      // Auto-Versuch scheitert leise -- der bestehende Backoff uebernimmt
      // (Spec Auto-Connect); kein rcAlert-Spam beim App-Start.
      state.serial.lastPath = state.serial.lastPath || state.settings.serialLastPath;
      scheduleReconnect();
    } else {
      rcAlert('Verbindung fehlgeschlagen:\n' + (e?.message || e), 'Fehler');
    }
  }
```

- [ ] **Step 5: serial-demo.js — dropped-Flag pflegen.** In `onSerialClose()` nach `state.serial.connected = false;` einfügen: `state.serial.dropped = true;`. In `disconnectSerial()` nach `state.serial.autoReconnect = false;` einfügen: `state.serial.dropped = false; state.serial.autoConnected = false;` (manuelles Trennen = gewollt, kein Störungstext). Im Erfolgspfad von `scheduleReconnect()` nach `state.serial.reconnectAttempts = 0;` einfügen: `state.serial.dropped = false; state.serial.autoConnected = true;`

- [ ] **Step 6: serial-demo.js — autoConnect() neu** (direkt nach `stopReconnect()` einfügen):

```js
// Phase 56: Auto-Connect beim App-Start -- genau ein Versuch mit dem
// persistierten Port, nur wenn er in der aktuellen Portliste auftaucht
// (sonst: kein Versuch, kein Fehler-Spam). Fehlversuche laufen ueber den
// bestehenden scheduleReconnect()-Backoff. Aufrufer hat listSerialPorts()
// bereits ausgefuehrt (app-init.js).
async function autoConnect() {
  if (state.settings.serialAutoConnect === false) return;
  const path = state.settings.serialLastPath;
  if (!path || state.demo.running || state.serial.connected) return;
  if (!window.rasiSerial) return;   // WebSerial braucht eine User-Geste
  const sel = $('serialPortSelect');
  if (!sel || !Array.from(sel.options).some(o => o.value === path)) return;
  sel.value = path;
  const baudSel = $('serialBaud');
  if (baudSel) baudSel.value = String(state.settings.serialLastBaud || 115200);
  await connectSerial({ auto: true });
}
```

  Export-Block am Dateiende: `autoConnect,` in die Liste aufnehmen.

- [ ] **Step 7: Verifizieren** — Run: `node --check src/store.js`, `node --check src/serial-demo.js`, `npm test`, `npm run lint`
  Expected: Checks still, 222 Tests grün, Lint 0.
  Grep-Asserts (Grep-Tool): Pattern `serialAutoConnect: true, serialLastPath: null, serialLastBaud: 115200` in `src/store.js` = 1 Treffer; Pattern `autoReconnectToggle` in `src/serial-demo.js` = 0 Treffer.

- [ ] **Step 8: Commit** — `feat(conn): Auto-Connect-Grundlage -- persistierter Port/Baud, stiller Auto-Versuch, dropped-Flag (Phase 56 Task 2)`

---

### Task 3: index.html-Neuaufbau + Event-Verdrahtung (app-init.js, serial-demo.js)

Alt-Writer (pit-wall/ui-glue/live-ui) bleiben in diesem Task bewusst stehen: `setText`/`txt` sind null-sicher und `renderConnectionTab` ist try/catch-gekapselt — die App bootet zwischen Task 3 und 4 fehlerfrei. `#serialConnectBtn`, `#packetLog`, `#rssiSpark`, `#connBridgeMac` leben im neuen Details-Aufklapper mit unveränderten IDs weiter.

**Files:**
- Modify: `index.html:786-946` (Hero bis einschließlich `#demoPanel`; die Aufnahme-&-Replay-Karte ab `<div class="card" style="margin-top:18px">` bleibt)
- Modify: `src/app-init.js:12-13,23-24,120-136,162-163,232`
- Modify: `src/serial-demo.js:214-218,250-260`

**Interfaces:**
- Consumes: `autoConnect`, `startDemo`, `stopDemo`, `listSerialPorts`, `connectSerial`, `disconnectSerial` (serial-demo.js), `saveData` (bereits importiert).
- Produces: DOM-IDs `#demoChip` (Toggle-Chip, Klasse `on` bei laufender Demo), `#connActionBtn`, `#connDetailsBtn`, `#connDetails`, `#connPortLine`, `#heroKarts`/`#heroRate`/`#heroGps` (Initialtext `--` — der erste conn-ui-Render aus Task 4 ist damit e2e-detektierbar), `#connGrid`, `#autoConnectToggle`.

- [ ] **Step 1: index.html-Region ersetzen.** `index.html` ab `<section class="tab" id="tab-connection">` bis vor `  <div class="card" style="margin-top:18px">` (Aufnahme & Replay) frisch Readen und den Block ersetzen durch:

```html
<section class="tab" id="tab-connection">

  <!-- HERO: Verbindungszentrale (Phase 56) -- Portstatus links,
       Aggregat-Werte + Demo-Chip + Verbinden-Aktion rechts -->
  <div class="pw-hero">
    <div class="pw-hero-bg"></div>
    <div class="pw-hero-grid"></div>
    <div class="pw-hero-content">
      <div class="pw-hero-left">
        <div class="pw-eyebrow">
          <span class="pw-eyebrow-dot"></span>
          <span>VERBINDUNG &amp; DIAGNOSE</span>
        </div>
        <div class="conn-port-line idle" id="connPortLine">Nicht verbunden</div>
      </div>
      <div class="pw-hero-telemetry">
        <div class="pw-tel">
          <div class="pw-tel-label">Karts</div>
          <div class="pw-tel-value mono" id="heroKarts">--</div>
        </div>
        <div class="pw-tel">
          <div class="pw-tel-label">Datenrate</div>
          <div class="pw-tel-value mono" id="heroRate">--</div>
        </div>
        <div class="pw-tel">
          <div class="pw-tel-label">GPS</div>
          <div class="pw-tel-value mono" id="heroGps">--</div>
        </div>
        <div class="conn-hero-actions">
          <button class="conn-chip" id="demoChip">▶ Demo</button>
          <button class="btn primary" id="connActionBtn">Verbinden</button>
          <button class="btn ghost" id="connDetailsBtn">Details</button>
        </div>
      </div>
    </div>
  </div>

  <!-- Details-Aufklapper (Session-State, startet zu): Portwahl,
       Auto-Verbinden, Bridge-MAC, RSSI-Verlauf, Paket-Log -->
  <div class="card conn-details hidden" id="connDetails">
    <div class="card-head"><span class="card-title">Verbindungs-Details</span><span class="card-sub">Port &amp; Diagnose</span></div>
    <div class="serial-form" style="margin-bottom:14px">
      <div class="field"><label>Port</label><select id="serialPortSelect"></select></div>
      <div class="field"><label>Baudrate</label>
        <select id="serialBaud">
          <option value="115200" selected>115200</option>
          <option value="921600">921600</option>
          <option value="500000">500000</option>
          <option value="230400">230400</option>
          <option value="57600">57600</option>
        </select>
      </div>
      <button class="btn ghost" id="serialRefreshBtn">↻</button>
      <button class="btn primary" id="serialConnectBtn">Verbinden</button>
    </div>
    <div class="toggle-row">
      <span class="label-text">Automatisch verbinden</span>
      <label class="toggle"><input type="checkbox" id="autoConnectToggle" checked><span class="toggle-knob"></span></label>
    </div>
    <div class="mono-box" style="margin-top:14px">
      Bridge: <b id="connBridgeMac">--</b>
    </div>
    <canvas id="rssiSpark" width="320" height="36" style="width:100%;height:36px;margin-top:10px;display:block" title="RSSI-Verlauf (letzte 3 Minuten, USB/Bridge-Strecke)"></canvas>
    <div class="packet-log" id="packetLog" style="margin-top:10px">
      <div><b>--:--:--</b><span>Warte auf Daten…</span></div>
    </div>
  </div>

  <!-- Kart-Karten-Grid: eine Statuskarte pro Session-Kart (conn-ui.js) -->
  <div class="conn-grid" id="connGrid"></div>

```

- [ ] **Step 2: app-init.js — alte Connection-Bindings ersetzen.** Den Block von `// Connection tab` + `$('modeSerialBtn').onclick = …` bis einschließlich `$('autoReconnectToggle').onchange = …;` ersetzen durch:

```js
  // Connection tab (Phase 56): Demo-Chip, Hero-Aktion, Details-Aufklapper
  $('demoChip').onclick = () => state.demo.running ? stopDemo() : startDemo();
  $('connActionBtn').onclick = async () => {
    if (state.demo.running) return;   // Button ist disabled (conn-ui) -- Gurt + Hosentraeger
    if (state.serial.connected) { disconnectSerial(); return; }
    const last = state.settings.serialLastPath;
    await listSerialPorts();
    const sel = $('serialPortSelect');
    if (last && Array.from(sel.options).some(o => o.value === last)) {
      sel.value = last;
      if ($('serialBaud')) $('serialBaud').value = String(state.settings.serialLastBaud || 115200);
      connectSerial();
    } else {
      // Kein (auffindbarer) letzter Port -> Aufklapper mit Portliste zeigen
      $('connDetails').classList.remove('hidden');
    }
  };
  $('connDetailsBtn').onclick = () => $('connDetails').classList.toggle('hidden');
  $('serialRefreshBtn').onclick = listSerialPorts;
  $('serialConnectBtn').onclick = () => state.serial.connected ? disconnectSerial() : connectSerial();
  $('autoConnectToggle').checked = state.settings.serialAutoConnect !== false;
  $('autoConnectToggle').onchange = () => {
    state.settings.serialAutoConnect = $('autoConnectToggle').checked;
    state.serial.autoReconnect = $('autoConnectToggle').checked;
    saveData();
  };
```

  Zusätzlich: die zwei Zeilen `$('demoStartBtn').onclick = startDemo;` / `$('demoStopBtn').onclick = stopDemo;` ersatzlos löschen. Import-Zeile 12–13 um `autoConnect` erweitern; in der pit-wall-Import-Zeile `toggleDiagnose,` entfernen. Die Zeile `listSerialPorts();` (unter `// Auto-list ports`) ersetzen durch:

```js
  // Ports listen, dann Auto-Connect-Versuch mit dem persistierten Port (Phase 56)
  listSerialPorts().then(autoConnect).catch(() => {});
```

- [ ] **Step 3: serial-demo.js — Demo-Chip statt Panel-Buttons.** In `startDemo()` die drei Zeilen `$('demoStartBtn').classList.add('hidden');` / `$('demoStopBtn').classList.remove('hidden');` / `setText('demoModeText', 'Läuft');` ersetzen durch:

```js
  const chip = $('demoChip');
  if (chip) { chip.classList.add('on'); chip.textContent = '■ Demo läuft'; }
```

  In `stopDemo()` die drei Zeilen `$('demoStartBtn').classList.remove('hidden');` / `$('demoStopBtn').classList.add('hidden');` / `setText('demoModeText', 'Bereit');` ersetzen durch:

```js
  const chip = $('demoChip');
  if (chip) { chip.classList.remove('on'); chip.textContent = '▶ Demo'; }
```

  Am Ende von `stopDemo()` die Zeile `renderConnectionTab();` löschen und `renderConnectionTab` aus dem pit-wall-Import (Zeile 14) entfernen (der 1-Hz-Renderer übernimmt ab Task 4; `pushPacketLog` bleibt vorerst pit-wall-Import).

- [ ] **Step 4: Verifizieren** — Run: `node --check src/app-init.js`, `node --check src/serial-demo.js`, `npm test`, `npm run lint`, `npm run lint:css`
  Expected: alles grün (CSS-Gate meckert nicht — Markup hat keinen `<style>`-Block).
  Grep-Asserts: `modeSerialBtn|modeDemoBtn|demoPanel|serialPanel|demoStartBtn|demoStopBtn|diagToggleBtn|connModePill|connDetailTitle|autoReconnectToggle` in `index.html` **und** `src/app-init.js` = 0 Treffer; `id="demoChip"` in `index.html` = 1 Treffer.
  Kurzer Smoke: `npm start` (Electron) — App bootet, Verbindungs-Tab zeigt Hero + leeres Grid, Demo-Chip startet/stoppt die Demo (Live-Tab zeigt 3 Karts), Details-Button klappt die Portliste auf. Konsole ohne Uncaught Errors.

- [ ] **Step 5: Commit** — `feat(conn): Verbindungsseite Neuaufbau -- Hero mit Verbinden-Aktion, Demo-Chip, Details-Aufklapper (Phase 56 Task 3)`

---

### Task 4: `conn-ui.js` — Grid-Renderer + Rückbau der Alt-Writer

**Files:**
- Create: `src/conn-ui.js`
- Modify: `src/pit-wall.js:8-15,138-256,465-478` (Connection-Block raus)
- Modify: `src/ui-glue.js:22-23,50-54`
- Modify: `src/live-ui.js:13,594-602`
- Modify: `src/serial-demo.js:14` (pushPacketLog-Import auf conn-ui)
- Modify: `src/app.js` (Import-Liste: conn-ui aufnehmen — analog kart-overview)

**Interfaces:**
- Consumes: `ConnHealth.classifyKart/aggregate/heroStatus` (Task 1), `RasiKartBar.metaFor(state, mac, idx)` → `{ name, color }`, `KartRegistry.MAX_KARTS/DEFAULT_MAC`, `state.karts`-Registry (`connection`/`gps`/`raw` je Kart), `$`/`css`/`esc`/`setText`/`logTime` aus rasicross.js.
- Produces: Default-Export `{ render, pushPacketLog, openDetails }` — `render()` wird vom 1-Hz-Loop gerufen; `pushPacketLog(line)` von `handleSerialLine` (serial-demo.js).

- [ ] **Step 1: `src/conn-ui.js` anlegen** mit exakt diesem Inhalt:

```js
// ============================================================
//  RasiCross — conn-ui.js  (Verbindungsseite: Hero + Kart-Grid, Phase 56)
//  EINZIGER Writer der Verbindungsseiten-IDs, laeuft im 1-Hz-Loop
//  (live-ui.js). Pure Ampel-/Aggregat-Logik liegt in conn-health.js.
//  Aufklapper-Zustaende sind Session-State (nie persistiert).
// ============================================================
import ConnHealth from './conn-health.js';
import KartRegistry from './kart-registry.js';
import RasiKartBar from './kart-bar.js';
import { state, $, css, esc, setText, logTime } from './rasicross.js';

// Diagnose-Aufklapper pro Kart + Hz-Fenster (Paketzaehler-Deltas, 1 s)
const _diagOpen = {};   // mac -> bool
const _hzWin = {};      // mac -> { packets, at, hz }

// Paket-Log (aus pit-wall.js umgezogen, Phase 56)
let _packetLog = [];
function pushPacketLog(line) {
  _packetLog.unshift({ t: logTime(), line: line });
  _packetLog = _packetLog.slice(0, 20);
}

// RSSI-Sparkline (aus pit-wall.js umgezogen): 1-Hz-Historie, max 3 min.
const RSSI_HIST_MAX = 180;
let _rssiHist = [];
function drawRssiSparkline() {
  const cv = $('rssiSpark');
  if (!cv) return;
  const ctx = cv.getContext('2d');
  if (!ctx) return;
  const w = cv.width, h = cv.height;
  ctx.clearRect(0, 0, w, h);
  if (_rssiHist.length < 2) return;
  const MIN = -100, MAX = -30;            // dBm-Skala
  const y = v => h - 2 - ((Math.max(MIN, Math.min(MAX, v)) - MIN) / (MAX - MIN)) * (h - 4);
  // Schwellen-Linie (-85 dBm = Schwach)
  ctx.strokeStyle = 'rgba(255,255,255,0.10)';
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(0, y(-85)); ctx.lineTo(w, y(-85)); ctx.stroke();
  const last = _rssiHist[_rssiHist.length - 1];
  const color = last > -70 ? (css('--green') || '#5ad17a')
              : last > -85 ? (css('--orange') || '#f0a050')
              : (css('--red') || '#e05555');
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  for (let i = 0; i < _rssiHist.length; i++) {
    const x = (i / (RSSI_HIST_MAX - 1)) * w;
    if (i === 0) ctx.moveTo(x, y(_rssiHist[i])); else ctx.lineTo(x, y(_rssiHist[i]));
  }
  ctx.stroke();
  const xe = ((_rssiHist.length - 1) / (RSSI_HIST_MAX - 1)) * w;
  ctx.fillStyle = color;
  ctx.beginPath(); ctx.arc(xe, y(last), 2.4, 0, Math.PI * 2); ctx.fill();
}

function _kartHz(mac, k, now) {
  const w = _hzWin[mac] || (_hzWin[mac] = { packets: k.connection.packets, at: now, hz: 0 });
  const dt = now - w.at;
  if (dt >= 1000) {
    w.hz = Math.max(0, Math.round((k.connection.packets - w.packets) / (dt / 1000)));
    w.packets = k.connection.packets;
    w.at = now;
  }
  return w.hz;
}

function _fmtAge(lastAt, now) {
  return lastAt ? ((now - lastAt) / 1000).toFixed(1) + ' s' : '--';
}

const _BADGE = { ok: '● online', warn: '● schwach', off: '● offline' };

function _kartCard(r, meta, now) {
  const c = r.k.connection;
  const open = !!_diagOpen[r.mac];
  const vals = '<div class="cc-vals">'
    + '<span><i>Signal</i><b>' + (c.rssi != null ? c.rssi + ' dBm' : '—') + '</b></span>'
    + '<span><i>Rate</i><b>' + r.hz + ' Hz</b></span>'
    + '<span><i>Verloren</i><b>' + c.lost + '</b></span>'
    + '<span><i>GPS</i><b>' + (r.k.gps.fix ? 'Fix' : 'kein Fix') + '</b></span>'
    + '<span><i>Alter</i><b>' + _fmtAge(c.lastPacketAt, now) + '</b></span>'
    + '</div>';
  const hints = r.res.hints.length
    ? '<div class="cc-hints">' + r.res.hints.map(h => '<div>' + esc(h) + '</div>').join('') + '</div>'
    : '';
  const diag = open
    ? '<div class="cc-diag mono-box">'
      + 'MAC: <b>' + esc(c.kartMac !== '--' ? c.kartMac : r.mac) + '</b><br>'
      + 'Seq: <b>' + (c.seq != null ? c.seq : '--') + '</b><br>'
      + 'RPM Pulse/s: <b>' + (r.k.raw.pulseHz != null ? r.k.raw.pulseHz.toFixed(1) : '--') + '</b><br>'
      + 'Pulse Count: <b>' + (r.k.raw.pulseCount || '--') + '</b><br>'
      + 'Raw-G: <b>' + r.k.raw.gx.toFixed(2) + ' / ' + r.k.raw.gy.toFixed(2) + '</b><br>'
      + 'Errors: <b>' + c.errors + '</b>'
      + '</div>'
    : '';
  return '<div class="conn-card ' + r.res.level + '" data-mac="' + r.mac + '">'
    + '<div class="cc-head">'
    +   '<span class="cc-dot" style="background:' + meta.color + '"></span>'
    +   '<span class="cc-name">' + esc(meta.name) + '</span>'
    +   '<span class="cc-badge ' + r.res.level + '">' + _BADGE[r.res.level] + '</span>'
    + '</div>'
    + vals + hints
    + '<button class="cc-diag-btn" data-mac="' + r.mac + '">Diagnose ' + (open ? '▾' : '▸') + '</button>'
    + diag
    + '</div>';
}

function render() {
  try {
    const now = Date.now();
    const macs = state.karts.macs();
    // Der lazy angelegte default-Bucket ist erst ein Kart, wenn er je ein
    // Paket empfangen hat -- sonst zeigt eine frische App eine Geisterkarte
    // statt nur des Platzhalters (Spec: leere Registry -> Karts 0/0).
    const shown = macs.filter(m => m !== KartRegistry.DEFAULT_MAC
      || (state.karts.get(m) && state.karts.get(m).connection.lastPacketAt != null));
    // 1) Ampel je Kart (pure Logik)
    const results = shown.map((mac) => {
      const k = state.karts.get(mac);
      const hz = _kartHz(mac, k, now);
      const res = ConnHealth.classifyKart({
        now: now, lastPacketAt: k.connection.lastPacketAt, rssi: k.connection.rssi,
        hz: hz, gpsFix: k.gps.fix, gpsLastAt: k.gps.lastAt,
      });
      return { mac: mac, k: k, hz: hz, res: res };
    });
    // 2) Hero: Aggregate + Portstatus-Zeile
    const agg = ConnHealth.aggregate(results.map(r => ({ level: r.res.level, hz: r.hz, gpsFix: r.k.gps.fix })));
    setText('heroKarts', agg.online + '/' + agg.total);
    setText('heroRate', agg.hzSum + ' Hz');
    setText('heroGps', agg.gpsFixCount + '× Fix');
    const hs = ConnHealth.heroStatus({
      connected: state.serial.connected,
      portName: state.serial.portName,
      baud: state.serial.baud,
      auto: state.serial.autoConnected,
      demoRunning: state.demo.running,
      reconnecting: !!state.serial.reconnectTimer,
      attempts: state.serial.reconnectAttempts,
      dropped: state.serial.dropped,
    });
    const pl = $('connPortLine');
    if (pl) { pl.textContent = hs.text; pl.className = 'conn-port-line ' + hs.level; }
    // 3) Aktions-Button (waehrend Demo inaktiv, Locked Decision + Spec Demo)
    const btn = $('connActionBtn');
    if (btn) {
      btn.disabled = state.demo.running;
      btn.title = state.demo.running ? 'Demo läuft' : '';
      btn.textContent = state.serial.connected ? 'Trennen' : 'Verbinden';
      btn.className = state.serial.connected ? 'btn danger' : 'btn primary';
    }
    // 4) Details-Werte (Struktur ist statisches Markup -- Selects bleiben stehen)
    const ak = state.karts.active();
    setText('connBridgeMac', (ak && ak.connection.bridgeMac) || '--');
    if (ak && ak.connection.rssi != null
        && (ak.connection.source === 'serial' || ak.connection.source === 'demo')) {
      _rssiHist.push(ak.connection.rssi);
      if (_rssiHist.length > RSSI_HIST_MAX) _rssiHist.shift();
    }
    drawRssiSparkline();
    const log = $('packetLog');
    if (log && _packetLog.length) {
      log.innerHTML = _packetLog.slice(0, 8).map(p =>
        '<div><b>' + p.t + '</b><span>' + esc(p.line.slice(0, 200)) + '</span></div>').join('');
    }
    // 5) Kart-Grid in Registry-Reihenfolge + gestrichelter Platzhalter
    const grid = $('connGrid');
    if (grid) {
      const cards = results.map(r => _kartCard(r, RasiKartBar.metaFor(state, r.mac, macs.indexOf(r.mac)), now));
      if (macs.length < KartRegistry.MAX_KARTS) {
        cards.push('<div class="conn-card conn-wait">wartet auf weitere Karts…</div>');
      }
      grid.innerHTML = cards.join('');
      grid.querySelectorAll('.cc-diag-btn').forEach((b) => {
        b.onclick = () => {
          const m = b.getAttribute('data-mac');
          _diagOpen[m] = !_diagOpen[m];
          render();
        };
      });
    }
  } catch (e) { console.warn('conn-ui render:', e); }
}

function openDetails() {
  const d = $('connDetails');
  if (d) d.classList.remove('hidden');
}

export default { render, pushPacketLog, openDetails };
```

- [ ] **Step 2: pit-wall.js — Connection-Block ausbauen.** Den kompletten Abschnitt von `// CONNECTION TAB Updates` (inkl. der drei `// ===`-Trennzeilen davor) bis einschließlich `function toggleDiagnose() { … }` löschen (`_packetLog`, `RSSI_HIST_MAX`, `_rssiHist`, `drawRssiSparkline`, `renderConnectionTab`, `pushPacketLog`, `toggleDiagnose`). Import-Zeile 8–10 bereinigen: `css`, `esc`, `logTime` entfernen → `import { state, $, setText, rcAlert, rcToast, activeKart } from './rasicross.js';` (`fmtClock, fmtMs, structuralRaceKey` aus geo.js bleiben). Im `void [...]`-Interface-Marker und im `export { ... }` die drei Namen `renderConnectionTab, pushPacketLog, toggleDiagnose,` entfernen.

- [ ] **Step 3: serial-demo.js — Import umziehen.** Zeile `import { pushPacketLog } from './pit-wall.js';` (nach Task 3 ohne renderConnectionTab) ersetzen durch `import ConnUi from './conn-ui.js';` und den Aufruf in `handleSerialLine` von `pushPacketLog(line);` auf `ConnUi.pushPacketLog(line);` ändern.

- [ ] **Step 4: live-ui.js — Loop-Hook + reconnectStatus-Rückbau.** Import-Zeile 13 → `import { updatePitWall } from './pit-wall.js';` plus neue Zeile `import ConnUi from './conn-ui.js';`. Im 1-Hz-Loop den Block

```js
  // Connection-Tab (das hat vorher gefehlt!)
  renderConnectionTab();

  // Reconnect-Status
  if (state.serial.reconnectTimer) {
    setText('reconnectStatus', `Reconnect-Versuch ${state.serial.reconnectAttempts}...`);
  } else {
    setText('reconnectStatus', state.serial.connected ? '--' : 'Inaktiv');
  }
```

  ersetzen durch:

```js
  // Verbindungsseite (Phase 56): conn-ui.js ist der einzige Writer;
  // Reconnect-Status steckt jetzt in der Portstatus-Zeile (heroStatus).
  ConnUi.render();
```

- [ ] **Step 5: ui-glue.js — conn-Spiegel raus.** Die zwei Zeilen `const hz = $$('connHz')?.textContent || '0';` + `txt('hzText', hz);` ersetzen durch `txt('hzText', String(state._lastHz || 0));` (der DOM-Umweg über das entfallene `#connHz` würde die Footer-Hz-Pille einfrieren). Den Block `// Conn-overview Hz / Lost / GPS` mit den vier `txt('connOverview…')`-Zeilen ersatzlos löschen.

- [ ] **Step 6: app.js — conn-ui in die Import-Liste.** Nach `import './kart-overview.js';` einfügen: `import './conn-ui.js';` (conn-ui wird zwar über live-ui/serial-demo gezogen, die explizite Zeile hält die Modul-Liste vollständig — Muster der Datei).

- [ ] **Step 7: Verifizieren** — Run: `node --check` auf `src/conn-ui.js src/pit-wall.js src/live-ui.js src/ui-glue.js src/serial-demo.js src/app.js`, dann `npm test`, `npm run lint`.
  Expected: 222 grün, Lint 0 (keine unused imports).
  Grep-Asserts: `renderConnectionTab|toggleDiagnose` in `src/` = 0 Treffer; `connOverview` in `src/` = 0 Treffer; `reconnectStatus` in `src/` = 0 Treffer; `pushPacketLog` nur noch in `src/conn-ui.js` + `src/serial-demo.js`.
  Zeilen-Gate: `(Get-Content src/conn-ui.js | Measure-Object -Line).Lines` < 520.
  Smoke: `npm start` — Demo per Chip starten: Grid zeigt 3 grüne Demo-Karten (Name/Farbe aus kartMeta, Signal/Rate/Verloren/GPS/Alter), Platzhalter-Karte fehlt erst ab 4 Karts; Diagnose-Aufklapper pro Karte öffnet/schließt; Hero zeigt `3/3`, Summen-Hz (~36), `3× Fix`, Portstatus „Demo-Modus aktiv"; Verbinden-Button inaktiv mit Tooltip. Demo stoppen: Karten verschwinden (Registry-forget), Hero `0/0`, „Nicht verbunden".

- [ ] **Step 8: Commit** — `feat(conn): conn-ui.js Kart-Karten-Grid als einziger 1-Hz-Writer + Rueckbau der Einzel-Kart-Writer (Phase 56 Task 4)`

---

### Task 5: connection.css — Neuaufbau (Tokens/Skalen)

**Files:**
- Modify: `src/styles/pages/connection.css` (komplett ersetzen)

**Interfaces:**
- Consumes: Klassen aus Task 3/4-Markup: `.conn-port-line (+ .ok/.demo/.warn/.err/.idle)`, `.conn-hero-actions`, `.conn-chip (+ .on)`, `.conn-details`, `.conn-grid`, `.conn-card (+ .warn/.off/.conn-wait)`, `.cc-head/.cc-dot/.cc-name/.cc-badge/.cc-vals/.cc-hints/.cc-diag-btn/.cc-diag`; Bestand `.serial-form`, `.mono-box`, `.packet-log`.
- Produces: nichts für spätere Tasks.

- [ ] **Step 1: Datei ersetzen** — kompletter neuer Inhalt (nur Tokens/Skalen; `--orange` = Warn-„Gelb", s. Global Constraints):

```css
/* ============================================================
   CONNECTION (Phase 56: Hero-Aktion + Kart-Karten-Grid)
   ============================================================ */

/* Portstatus-Zeile im Hero */
.conn-port-line{
  margin-top:10px;
  font-family:var(--mono);font-size:var(--fs-13);
  color:var(--mut);
}
.conn-port-line.ok{color:var(--green)}
.conn-port-line.demo{color:var(--blue)}
.conn-port-line.warn{color:var(--orange)}
.conn-port-line.err{color:var(--red)}

.conn-hero-actions{
  display:flex;align-items:center;gap:var(--sp-8);
}
.conn-chip{
  padding:var(--sp-6) var(--sp-12);border-radius:var(--r-pill);
  background:var(--soft);border:1px solid var(--bor);
  color:var(--tx);font-family:var(--sans);
  font-size:var(--fs-12);font-weight:600;
  cursor:pointer;transition:var(--t);white-space:nowrap;
}
.conn-chip:hover{border-color:var(--blue)}
.conn-chip.on{
  background:var(--blue);border-color:var(--blue);color:var(--on-pr);
  box-shadow:var(--glow-sm) var(--blue-glow);
}

/* Details-Aufklapper */
.conn-details{margin-bottom:18px}

.serial-form{
  display:grid;
  grid-template-columns:2fr 1fr auto auto;
  gap:var(--sp-10);align-items:end;
}
@media(max-width:900px){
  .serial-form{grid-template-columns:1fr 1fr}
}

.mono-box{
  padding:var(--sp-14);
  background:var(--soft);
  border:1px solid var(--bor);
  border-radius:var(--r-md);
  font-family:var(--mono);font-size:var(--fs-12);
  color:var(--mut);line-height:1.55;
}
.mono-box b{color:var(--tx);font-weight:600}

.packet-log{
  max-height:240px;overflow:auto;
  padding:var(--sp-8);
  background:var(--soft);
  border:1px solid var(--bor);
  border-radius:var(--r-md);
  font-family:var(--mono);font-size:var(--fs-11);
}
.packet-log > div{
  display:grid;
  grid-template-columns:auto 1fr;
  gap:var(--sp-10);padding:var(--sp-6) var(--sp-8);
  border-bottom:1px solid var(--div);
}
.packet-log > div:last-child{border-bottom:none}
.packet-log b{color:var(--mut);font-weight:600;white-space:nowrap}
.packet-log span{color:var(--tx);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}

/* Kart-Karten-Grid */
.conn-grid{
  display:grid;
  grid-template-columns:repeat(auto-fill,minmax(280px,1fr));
  gap:var(--sp-14);
}
.conn-card{
  padding:var(--sp-14);
  background:var(--surf);
  border:1px solid var(--bor);
  border-radius:var(--r-xl);
}
.conn-card.warn{border-color:var(--orange);box-shadow:var(--glow-sm) var(--orange-glow)}
.conn-card.off{border-color:var(--red);box-shadow:var(--glow-sm) var(--red-glow)}
.conn-card.conn-wait{
  border-style:dashed;color:var(--mut);
  display:grid;place-items:center;
  font-size:var(--fs-12);min-height:96px;
}
.cc-head{display:flex;align-items:center;gap:var(--sp-8);margin-bottom:10px}
.cc-dot{width:10px;height:10px;border-radius:50%;flex:none}
.cc-name{
  font-family:var(--sans);font-size:var(--fs-14);
  font-weight:700;color:var(--tx);flex:1;
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
}
.cc-badge{font-family:var(--mono);font-size:var(--fs-10);font-weight:700;white-space:nowrap}
.cc-badge.ok{color:var(--green)}
.cc-badge.warn{color:var(--orange)}
.cc-badge.off{color:var(--red)}
.cc-vals{
  display:flex;flex-wrap:wrap;gap:var(--sp-8) var(--sp-14);
}
.cc-vals i{
  display:block;font-style:normal;
  font-family:var(--mono);font-size:var(--fs-9);
  color:var(--mut);text-transform:uppercase;
  letter-spacing:.09em;font-weight:700;
  margin-bottom:2px;
}
.cc-vals b{
  font-family:var(--mono);font-size:var(--fs-13);
  font-weight:700;color:var(--tx);
  font-variant-numeric:tabular-nums;
}
.cc-hints{
  margin-top:10px;padding:var(--sp-8) var(--sp-10);
  background:var(--soft);border-radius:var(--r-sm);
  font-size:var(--fs-12);color:var(--orange);line-height:1.5;
}
.conn-card.off .cc-hints{color:var(--red)}
.cc-diag-btn{
  margin-top:10px;padding:var(--sp-4) var(--sp-8);
  background:transparent;border:0;color:var(--mut);
  font-family:var(--mono);font-size:var(--fs-11);cursor:pointer;
}
.cc-diag-btn:hover{color:var(--tx)}
.cc-diag{margin-top:var(--sp-8)}
```

- [ ] **Step 2: Verifizieren** — Run: `npm run lint:css`
  Expected: `CSS-Token-Gate: OK` (kein rohes Hex, Abstände auf sp-Skala, Radius/Fonts über Tokens).
  Grep-Asserts: `mode-tab|conn-diagram|node-card|link-dot|signal-bars|diagnose-only` in `src/styles/` = 0 Treffer.
  Smoke: `npm start` — Ruhezustand (Hero + gestrichelter Platzhalter), Demo an (3 Karten, Chip blau „■ Demo läuft"), Light-Theme kurz gegenprüfen (`#themeBtn`).

- [ ] **Step 3: Commit** — `style(conn): connection.css Neuaufbau fuer Hero, Kart-Grid und Aufklapper (Phase 56 Task 5)`

---

### Task 6: e2e-Umstellung + neuer Screenshot `demo-connection`

**Files:**
- Modify: `e2e/demo.spec.js:14-16`, `e2e/karts.spec.js:18-20`, `e2e/replay.spec.js:19-21`
- Modify: `e2e/screens.spec.js:30-60,111-133` (+ neuer Test)

**Interfaces:**
- Consumes: `#demoChip` (Task 3), `#heroGps` mit Initialtext `--` → erster conn-ui-Render schreibt `0× Fix` (Task 4), `#connGrid .conn-card[data-mac]` (Task 4).
- Produces: Baseline-Satz 14 → 15 (`demo-connection.png` neu, `tab-connection.png` neu eingefroren).

- [ ] **Step 1: Demo-Start-Helper in den drei Funktions-Specs.** In `demo.spec.js`, `karts.spec.js`, `replay.spec.js` jeweils die zwei Zeilen `await page.click('#modeDemoBtn');` + `await page.click('#demoStartBtn');` ersetzen durch:

```js
  await page.click('#demoChip');
```

  (den Kommentar davor auf `// Demo starten: Verbindungs-Tab -> Demo-Chip (Phase 56).` anpassen).

- [ ] **Step 2: screens.spec.js — Demo-Start + prep()-Wait.** Im `Demo-Zustand`-beforeAll dieselbe Zwei-Zeilen-Ersetzung (`ctx.page.click('#demoChip')`). In `prep()` den `#connOverviewGps`-waitForFunction-Block (inkl. des zugehörigen Kommentars „#connOverviewGps wird als LETZTES Glied…") ersetzen durch:

```js
  // Erster 1-Hz-Tick muss durch sein: conn-ui.render() schreibt #heroGps
  // vom Markup-Initial '--' auf 'N× Fix' (letztes Glied der Boot-Kette).
  await page.waitForFunction(() => {
    const el = document.querySelector('#heroGps');
    return !!el && el.textContent.trim() !== '--';
  });
```

  Im DYN-Kommentarblock den veralteten `#connOverviewGps`-Absatz (Zeilen 33–34) durch einen Satz zur neuen Wartebedingung ersetzen.

- [ ] **Step 3: Neuer Shot `demo-connection`** — im `Demo-Zustand`-describe nach dem Test `Karts-Tab mit 3 Demo-Karts` einfügen:

```js
  test('Verbindungsseite mit laufender Demo', async () => {
    await ctx.page.click('.nav-item[data-tab="connection"]');
    // Grid gefuellt: 3 Demo-Kart-Karten vom 1-Hz-Renderer.
    await ctx.page.waitForFunction(() =>
      document.querySelectorAll('#connGrid .conn-card[data-mac]').length >= 3);
    // Dynamische Wertefelder maskieren (RSSI-Jitter, Paketalter, Summen-Hz).
    // Maske und Baseline entstehen im selben Schritt (Lektion Phase 49).
    // Portstatus (Demo-Modus aktiv), Karts 3/3 und GPS 3x Fix sind statisch.
    const dyn = masks(ctx.page).concat([
      ctx.page.locator('#connGrid .cc-vals'),
      ctx.page.locator('#heroRate'),
    ]);
    await expect(ctx.page).toHaveScreenshot('demo-connection.png',
      Object.assign({ mask: dyn }, SHOT));
  });
```

- [ ] **Step 4: Lokale Verifikation** — Run: `npm run test:e2e`
  Expected: `demo.spec` / `karts.spec` / `replay.spec` / `app.spec` grün; `screens.spec` wird lokal geskippt (Windows ohne `RASI_SCREENS=1`). `npm run lint` = 0.
  Grep-Asserts: `modeDemoBtn|demoStartBtn` in `e2e/` = 0 Treffer; `connOverviewGps` in `e2e/` = 0 Treffer.

- [ ] **Step 5: Baseline-Einfrieren (CI, User-gated).** Push + PR-CI: `tab-connection.png` und `demo-connection.png` schlagen als neue/abweichende Baselines an → Freigabe-Loop mit dem User (Diff-Bilder zeigen, `--update-snapshots`-Lauf in der CI wie Phase 49/55). Die übrigen 13 Shots müssen **unverändert** grün bleiben (Demo-Shots anderer Tabs ändern nur den Startweg). **Nicht** ohne User-Freigabe einfrieren.

- [ ] **Step 6: Commit** — `test(e2e): Demo-Start via demoChip, prep-Wait auf heroGps, neuer Shot demo-connection (Phase 56 Task 6)`

---

### Task 7: Finale Verifikation + Plan-Doc-Commit

- [ ] **Step 1: Voll-Verifikation** (alles muss grün sein):
  - `node --check` auf alle angefassten JS-Dateien (conn-health, conn-ui, store, serial-demo, app-init, pit-wall, ui-glue, live-ui, app)
  - `npm test` → `tests 222` `fail 0`
  - `npm run lint` → 0; `npm run lint:css` → OK
  - `python -m unittest discover -s test -p "test_*.py"` → `Ran 65` `OK` (unangetastet); `__pycache__` danach löschen
  - `npm run test:e2e` → Funktions-Specs grün
  - `graphify update .`
- [ ] **Step 2: Selbstprüfung Spec-Abdeckung** (Abschnitt Self-Review unten abarbeiten).
- [ ] **Step 3: Plan-Doc committen** — einziger Task, der Docs anfasst:

```
git add docs/superpowers/plans/2026-07-18-56-verbindungsseite-neuaufbau.md
git commit -m "docs(plan): Phase 56 Verbindungsseite Implementierungsplan (Phase 56 Task 7)" ...(+ Trailer)
```

- [ ] **Step 4: PR** via `gh pr create` (Base `main`), Titel `Phase 56: Verbindungsseite Neuaufbau — Multi-Kart-Verbindungszentrale`; CI-Check-Bestätigung + Screenshot-Freigabe + Hardware-Abnahme sind **User-Sache**.

---

## Hardware/Manual Acceptance Checklist (nach Merge, mit Hardware — User)

- [ ] App-Start mit angeschlossener Bridge: verbindet automatisch mit dem letzten Port; Hero zeigt „(auto)".
- [ ] USB-Kabel ziehen: Klartext-Störung im Hero („USB getrennt…" / „Wiederverbinden, Versuch N…"); Kabel wieder rein → verbindet selbst.
- [ ] 2+ Karts: jede Karte zeigt plausible Signal/Rate/GPS-Werte; Sender eines Karts aus → Karte nach ~5 s rot mit Klartext-Hinweis.
- [ ] Kart außer Reichweite tragen → gelber Hinweis „Schwaches Signal".
- [ ] Demo-Chip: startet/stoppt mit je einem Klick; 3 Demo-Karts im Grid; „Verbinden" während Demo inaktiv (Tooltip „Demo läuft").
- [ ] Details-Aufklapper: Portwechsel funktioniert; Paket-Log läuft; Light-/Outdoor-Theme lesbar (CI testet nur dark).

## Self-Review

**Spec-Abdeckung:** Hero links/rechts + Aktions-Button + Details-Aufklapper → Task 3/4; Kart-Grid mit Ampel/Hinweisen/Diagnose-Aufklapper/Platzhalter → Task 4; Ampel-Tabelle + aggregate + heroStatus → Task 1; Auto-Connect + Persistenz + Backoff-Übergabe + manuelles Trennen → Task 2; Demo-Chip + Exklusivität + inaktiver Verbinden-Button → Task 2/3/4; Rückbau Alt-Writer (pit-wall/ui-glue/live-ui) + Ein-Writer-Regel → Task 4; CSS-Neuaufbau über Tokens → Task 5; e2e-Helper + prep-Wait + demo-connection-Shot 14→15 → Task 6; Fehlerbehandlung (Junk, kein RSSI, leere Registry, Port weg, USB-Abriss) → Task 1/2/4; Nicht-Ziele respektiert (Sidebar/Top-Pill/ESP/Recording unangetastet — kein Task fasst sie an).

**Bewusste Interpretationen gegenüber der Spec** (bei Ausführung nicht „korrigieren"):
1. Warn-Farbe: Spec sagt `var(--yellow)` — Token existiert nicht; `var(--orange)` ist die app-weite Warn-Farbe (tokens.css:36).
2. `classifyKart` ohne jemals ein Paket: Hinweis „Keine Pakete empfangen — …" statt „Seit ? s…" (Spec nennt nur den N-s-Fall).
3. Der lazy angelegte `default`-Registry-Bucket wird im Grid erst gezeigt, wenn er Pakete empfangen hat (sonst widerspräche er „leere Registry → nur Platzhalter, Karts 0/0").
4. RSSI-Sparkline speist sich wie bisher aus dem RSSI des aktiven Karts (an der Bridge gemessene Funkstrecke) — die Spec-Beschriftung „USB/Bridge-Strecke" bleibt als Titel erhalten.
5. `lost`-Feld wird in `classifyKart` entgegen der Spec-Signatur nicht bewertet (die Ampel-Tabelle definiert keine Verloren-Schwelle); es wird nur in der Wertezeile angezeigt.

**Platzhalter-Scan:** keine TBD/TODO; jeder Code-Step enthält vollständigen Code; Anker-Texte stammen aus dem Ist-Stand vom 2026-07-18 (vor Edit frisch Readen — CRLF-Regel).

**Typ-/Namens-Konsistenz:** `classifyKart/aggregate/heroStatus/THRESHOLDS` (T1) = Verwendung in conn-ui (T4) = Testnamen (T1); `autoConnect/connectSerial({auto})/dropped/autoConnected` (T2) = app-init (T3) = conn-ui heroStatus-Inputs (T4); IDs aus T3-Markup = Selektoren in T4/T6.

## Phase Map

- **Phase 55** (merged, PR #78): Live-Tab Multi-Kart-Übersicht — Muster für Grid-Karten + pure Reducer.
- **Phase 56 (dieser Plan):** Verbindungsseite Neuaufbau — Multi-Kart-Verbindungszentrale mit Auto-Connect.
- Danach (offen, nicht Teil dieses Plans): Hardware-Abnahme-Checkliste durch den User; ggf. Nacharbeit aus dem Freigabe-Loop der Screenshot-Baselines.
