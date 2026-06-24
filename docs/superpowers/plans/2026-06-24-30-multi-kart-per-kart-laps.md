# Phase 30 — Multi-Kart Per-Kart-Runden + Renn-Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ein Rennen wird ein Event mit Teilnehmern (`race.participants[mac]`); die Runden-/Sektorerkennung läuft pro Kart, jeder Kart bekommt eigene Runden, Bestrunde, Sektor-Bestzeit und Stints im selben Rennen — die Übersicht zeigt damit echte Live-Werte je Kart.

**Architecture:** Neue dependency-freie Pure-Logik (`lap-engine.js`, `node:test`-TDD) kapselt Teilnehmer-Datenmodell, Rundenzuordnung, Bestrunde, Sektor-Best und Migration. Die DOM-/Fassaden-Verdrahtung (`races.js`, `laps-drivers.js`, `track.js`, `rasicross.js`) konsumiert diese Funktionen; `checkLapCrossing`/`triggerLap`/`checkSectorCrossings` werden von der aktiven-Kart-Fassade auf explizite `(kart, mac)`-Parameter umgestellt und in `processTelemetry` für **alle** Teilnehmer-Karts ausgeführt.

**Tech Stack:** Vanilla JS (Browser-Globals / UMD-IIFE), `node:test`, ESLint 9 (Flat-Config), Electron-Builder. Verifikation: `node --check`, `node --test`, `eslint`, Python-Baselines (`py_compile`/`unittest`).

**Spec:** `docs/superpowers/specs/2026-06-24-multi-kart-per-kart-laps-design.md`

## Global Constraints

- Repo-Root: `C:/Users/jimlu/Documents/RasiCross-Telemetrie-git`. Branch: `feat/multi-kart-support` (Folge auf Phase 28/28b/29).
- **Dateien sind CRLF.** Unmittelbar vor jedem `Edit` die Zielstelle frisch in-session lesen und den Anker aus diesem Read kopieren — Zeilennummern hier sind indikativ, auf Text ankern.
- Verifikation mit dem **Grep-Tool** (nicht Shell-`grep`).
- **Niemals `.claude/` committen**, Plan-/Spec-Doc nur im expliziten Doc-Commit (Task 10).
- Commit-Messages: conventional + kurzer Body + Trailer `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- `__pycache__` vor jedem `git status`/commit löschen.
- **Verhalten unverändert für Single-Kart:** Mit ≤1 Teilnehmer müssen Rennen/Runden/Sektoren/Auto-Ende **exakt** wie heute funktionieren (Regression).
- **Save-Format additiv:** Migration ist idempotent; alte Top-Level-Felder (`r.laps`/`r.stints`/`r.kartMac`/`r.speedTrace`) werden **nicht gelöscht**. `SAVE_KEY`/`version: '9.6'` bleiben.
- **Per-Kart-Lese-/Schreibpfad:** Engine-Funktionen bekommen `(kart, mac)` explizit; Fassade (`state.lapStart`, `state.sectorsLive`, `state.sectorsBest`) nur für den aktiven Kart / Panel-Anzeige.
- Build-Bundling: neue `lap-engine.js` muss in `package.json` → `build.files` **und** als `<script>` in der HTML stehen (sonst rot in `test/build-manifest.test.js`).
- ESLint: jede neue/konsumierte Global muss im passenden `eslint.config.js`-Block deklariert sein.
- **Deferred (Phase 31, NICHT hier):** Leaderboard, Positions-Ranking, Multi-Kart-Auto-Ende bei Zielrunden, Live-Position, synchrones Multi-Kart-Replay.
- **Verifikationsrezept (pro Task wo relevant + final):**
  - `node --check <berührte .js>`
  - `node --test` (muss grün bleiben/wachsen; aktuell **127** + neue `lap-engine`-Tests)
  - `npx eslint <berührte .js>` → 0 Fehler
  - `python -m py_compile bridge.py` + `python -m unittest discover -s test -p "test_*.py"` → **50 OK** (Python unverändert)
  - Python kann `python` oder `py -3` sein.

---

## File Structure

| Aktion | Datei | Verantwortung |
|--------|-------|---------------|
| Neu    | `lap-engine.js` | Pure UMD `window.RasiLapEngine`: `migrateRace`, `getOrCreatePart`, `participantsOf`, `flatLaps`, `flatValidLaps`, `flatStints`, `commitLap`, `partValidLaps`, `bestFromLaps`, `sectorBestUpdate`, `trackRecordFromKarts`. Kein DOM, keine Registry. |
| Neu    | `test/lap-engine.test.js` | `node:test`-Suite für `lap-engine.js`. |
| Ändern | `kart-registry.js` | Feld `sectorsBest: [null,null,null]` (pro Kart) in `makeKartState()`. |
| Ändern | `rasicross.js` | `'sectorsBest'` in `PER_KART_FIELDS`; Migration in `loadData`; `processTelemetry` Lap-/Sektor-Erkennung pro Teilnehmer-Kart + Lazy-Join; Script-Load-Reihenfolge unverändert (HTML in Task 9). |
| Ändern | `races.js` | `participants` in `createRace`/`startRace`/`endRace`/`pauseRace`; `raceValidLaps` über Teilnehmer; `currentStint`/`confirmDriverChange`/`openDriverChange` auf aktiven Teilnehmer; `renderRaceDetails` pro Kart gruppiert; `kartBadge` Multi-Kart. |
| Ändern | `laps-drivers.js` | `checkLapCrossing(k,mac,…)`/`triggerLap(k,mac)`; `renderLapTable`/`renderLiveLapList` aktiver Teilnehmer; `getDriverStats`/`getTotalStats` über `flatLaps`/`flatStints`; `theoreticalBestMs` über `state.sectorsBest`. |
| Ändern | `track.js` | `checkSectorCrossings(k,…)` schreibt `k.sectorsBest`; `updateSectorPanel` liest `state.sectorsBest`; `syncSectorBestToTrack` leitet Strecken-Rekord aus allen Karts ab; `loadSavedTrack` setzt aktiven Kart `sectorsBest`. |
| Ändern | `pit-wall.js` | Rundenzahl des aktiven Karts (Teilnehmer). |
| Ändern | `kart-overview.js` | Rundenzähler je Karte aus Teilnehmer. |
| Ändern | `live-ui.js` | `renderStints` über aktiven Teilnehmer; Countdown-Lapcheck unverändert (nutzt `raceValidLaps`). |
| Ändern | `eslint.config.js` | `lapEngineGlobals`; `lap-engine.js` in UMD-Block; `RasiLapEngine`/`activeKart` in Konsumenten-Blöcken. |
| Ändern | `package.json` | `lap-engine.js` in `build.files`. |
| Ändern | `RasiCross_Telemetry.html` | `<script src="lap-engine.js">` vor `rasicross.js`. |

**Task-Reihenfolge:** 1 (lap-engine + Tests) → 2 (kart-registry) → 3 (HTML+package.json+eslint Bundling/Globals, damit Folge-Tasks lintbar/ladbar sind) → 4 (rasicross Migration+Fassade) → 5 (races participants) → 6 (laps-drivers Engine) → 7 (track Sektoren) → 8 (processTelemetry Per-Kart-Loop) → 9 (UI: kart-overview/pit-wall/live-ui) → 10 (finale Verifikation + Plan-Doc).

> **Verifikationsstrategie:** Die Zähl-/Zuordnungs-/Migrations-/Sektor-Logik wird in `lap-engine.js` per `node:test` TDD'd. DOM-/Fassaden-Verdrahtung: `node --check` + ESLint + Grep-Asserts + grüne Baselines. Funktionales Multi-Kart-Verhalten (zwei Karts) bleibt manuell (Hardware).

---

## Task 1: `lap-engine.js` + Tests (Pure-Logik, TDD)

**Files:**
- Create: `lap-engine.js`
- Create: `test/lap-engine.test.js`

**Interfaces:**
- Produces (von Tasks 4–9 konsumiert), alle auf `window.RasiLapEngine`:
  - `migrateRace(r, defaultMac)` → mutiert `r` (idempotent): legt `r.participants` an, falls fehlend, aus `r.laps`/`r.stints`/`r.kartMac`. Gibt `r` zurück.
  - `participantsOf(r)` → `Array` der Teilnehmer-Objekte (leeres Array ohne `participants`).
  - `getOrCreatePart(r, mac, driverId, now)` → Teilnehmer-Slot (legt an, falls neu; setzt `r.participants[mac]`).
  - `flatLaps(r)` → flache `laps` über alle Teilnehmer.
  - `flatValidLaps(r)` → `flatLaps(r).filter(valid)`.
  - `flatStints(r)` → flache `stints` über alle Teilnehmer.
  - `partValidLaps(part)` → gültige Runden eines Teilnehmers.
  - `bestFromLaps(laps)` → `{ ms, num }` (schnellste gültige Runde, `ms=null` wenn keine).
  - `commitLap(part, opts)` → pusht Runde in `part.laps`, aktualisiert `part.bestLapMs/bestLapNum`; gibt `{ lap, isBest }`.
  - `sectorBestUpdate(sectorsBest, i, sectorMs)` → `true` wenn neuer Best (mutiert `sectorsBest[i]`).
  - `trackRecordFromKarts(bestsList)` → `[min s1, min s2, min s3]` über alle Kart-Sektor-Bests (`null` ignoriert).

- [ ] **Step 1: Testdatei schreiben (failing)**

Erstelle `test/lap-engine.test.js` mit exakt diesem Inhalt:

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../lap-engine.js');

test('module exports all helpers', () => {
  for (const name of ['migrateRace','participantsOf','getOrCreatePart','flatLaps',
                      'flatValidLaps','flatStints','partValidLaps','bestFromLaps',
                      'commitLap','sectorBestUpdate','trackRecordFromKarts']) {
    assert.equal(typeof E[name], 'function', `missing ${name}`);
  }
});

test('migrateRace wraps legacy laps/stints into participants[kartMac]', () => {
  const r = { kartMac: 'AA', startDriverId: 'd1', currentDriverId: 'd2',
    laps: [{ number: 1, timeMs: 30000, valid: true }],
    stints: [{ id: 's1', driverId: 'd1', startAt: 1, endAt: 2 }],
    speedTrace: [{ t: 0, speed: 10 }], startedAt: 111 };
  E.migrateRace(r, 'default');
  const p = r.participants.AA;
  assert.equal(p.mac, 'AA');
  assert.equal(p.currentDriverId, 'd2');
  assert.equal(p.laps.length, 1);
  assert.equal(p.stints.length, 1);
  assert.equal(p.speedTrace.length, 1);
  assert.equal(p.joinedAt, 111);
});

test('migrateRace falls back to defaultMac when no kartMac', () => {
  const r = { laps: [], stints: [] };
  E.migrateRace(r, 'default');
  assert.ok(r.participants.default);
});

test('migrateRace is idempotent (no double-wrap)', () => {
  const r = { kartMac: 'AA', laps: [{ number: 1, timeMs: 1, valid: true }], stints: [] };
  E.migrateRace(r, 'default');
  const first = r.participants.AA;
  E.migrateRace(r, 'default');
  assert.equal(r.participants.AA, first, 'participant object replaced on 2nd call');
  assert.equal(r.participants.AA.laps.length, 1);
});

test('getOrCreatePart creates then returns same slot', () => {
  const r = { participants: {} };
  const p1 = E.getOrCreatePart(r, 'BB', 'drv', 500);
  assert.equal(p1.mac, 'BB');
  assert.equal(p1.currentDriverId, 'drv');
  assert.equal(p1.joinedAt, 500);
  const p2 = E.getOrCreatePart(r, 'BB', 'other', 999);
  assert.equal(p2, p1, 'should reuse existing slot');
  assert.equal(p2.currentDriverId, 'drv', 'must not overwrite driver');
});

test('commitLap appends per-participant lap with kartMac + per-kart number', () => {
  const part = { mac: 'AA', laps: [], bestLapMs: null, bestLapNum: null, currentDriverId: 'd1' };
  const res = E.commitLap(part, { now: 40000, lapStart: 10000, minLapMs: 10000,
    driverId: 'd1', kartMac: 'AA', maxSpeed: 55, maxRpm: 8000, distanceM: 400,
    sectors: [10000, 10000, 10000] });
  assert.equal(part.laps.length, 1);
  assert.equal(res.lap.number, 1);
  assert.equal(res.lap.timeMs, 30000);
  assert.equal(res.lap.kartMac, 'AA');
  assert.equal(res.lap.valid, true);
  assert.equal(res.isBest, true);
  assert.equal(part.bestLapMs, 30000);
  assert.equal(part.bestLapNum, 1);
});

test('commitLap second slower lap is not best; number increments', () => {
  const part = { mac: 'AA', laps: [], bestLapMs: null, bestLapNum: null };
  E.commitLap(part, { now: 30000, lapStart: 0, minLapMs: 10000, kartMac: 'AA',
    sectors: [] });
  const res = E.commitLap(part, { now: 70000, lapStart: 30000, minLapMs: 10000,
    kartMac: 'AA', sectors: [] });
  assert.equal(res.lap.number, 2);
  assert.equal(res.isBest, false);
  assert.equal(part.bestLapNum, 1);
});

test('partValidLaps / flatValidLaps count only valid', () => {
  const r = { participants: {
    AA: { mac: 'AA', laps: [{ valid: true }, { valid: false }] },
    BB: { mac: 'BB', laps: [{ valid: true }] },
  } };
  assert.equal(E.partValidLaps(r.participants.AA).length, 1);
  assert.equal(E.flatLaps(r).length, 3);
  assert.equal(E.flatValidLaps(r).length, 2);
});

test('bestFromLaps returns fastest valid lap + number', () => {
  const b = E.bestFromLaps([{ number: 1, timeMs: 30000, valid: true },
                            { number: 2, timeMs: 25000, valid: true },
                            { number: 3, timeMs: 20000, valid: false }]);
  assert.equal(b.ms, 25000);
  assert.equal(b.num, 2);
});

test('sectorBestUpdate returns true and stores on improvement only', () => {
  const sb = [null, null, null];
  assert.equal(E.sectorBestUpdate(sb, 0, 12000), true);
  assert.equal(sb[0], 12000);
  assert.equal(E.sectorBestUpdate(sb, 0, 13000), false);
  assert.equal(sb[0], 12000);
  assert.equal(E.sectorBestUpdate(sb, 0, 11000), true);
  assert.equal(sb[0], 11000);
});

test('trackRecordFromKarts takes min per sector, ignoring null', () => {
  const rec = E.trackRecordFromKarts([[12000, null, 9000], [11000, 8000, null]]);
  assert.deepEqual(rec, [11000, 8000, 9000]);
});

test('flatStints merges all participant stints', () => {
  const r = { participants: {
    AA: { stints: [{ id: 'a' }] }, BB: { stints: [{ id: 'b' }, { id: 'c' }] } } };
  assert.equal(E.flatStints(r).length, 3);
});
```

- [ ] **Step 2: Test laufen lassen — muss fehlschlagen**

Run: `node --test test/lap-engine.test.js`
Expected: FAIL (`Cannot find module '../lap-engine.js'`).

- [ ] **Step 3: `lap-engine.js` implementieren**

Erstelle `lap-engine.js` mit exakt diesem Inhalt:

```js
// ============================================================
//  RasiCross — lap-engine.js  (pure per-kart race/lap logic)
// ============================================================
//  Dependency-free UMD: runs under node:test (CI) and in the
//  browser as window.RasiLapEngine. No DOM, no registry, no
//  globals. Holds the participant data model + lap/sector/best
//  computations used by races.js / laps-drivers.js / track.js.
// ============================================================
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.RasiLapEngine = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function bestFromLaps(laps) {
    var ms = null, num = null;
    for (var i = 0; i < (laps || []).length; i++) {
      var l = laps[i];
      if (!l.valid) continue;
      if (ms == null || l.timeMs < ms) { ms = l.timeMs; num = l.number; }
    }
    return { ms: ms, num: num };
  }

  function makePart(mac, driverId, now) {
    return {
      mac: mac,
      startDriverId: driverId || null,
      currentDriverId: driverId || null,
      laps: [],
      stints: [],
      speedTrace: [],
      bestLapMs: null,
      bestLapNum: null,
      joinedAt: now != null ? now : null,
    };
  }

  // Idempotent: only wraps legacy top-level laps/stints once.
  function migrateRace(r, defaultMac) {
    if (!r || r.participants) return r;
    var mac = r.kartMac || defaultMac;
    var p = makePart(mac, r.currentDriverId || r.startDriverId || null, r.startedAt || null);
    p.startDriverId = r.startDriverId || null;
    p.laps = Array.isArray(r.laps) ? r.laps : [];
    p.stints = Array.isArray(r.stints) ? r.stints : [];
    p.speedTrace = Array.isArray(r.speedTrace) ? r.speedTrace : [];
    var b = bestFromLaps(p.laps);
    p.bestLapMs = b.ms; p.bestLapNum = b.num;
    r.participants = {};
    r.participants[mac] = p;
    return r;
  }

  function participantsOf(r) {
    if (!r || !r.participants) return [];
    var out = [], keys = Object.keys(r.participants);
    for (var i = 0; i < keys.length; i++) out.push(r.participants[keys[i]]);
    return out;
  }

  function getOrCreatePart(r, mac, driverId, now) {
    if (!r.participants) r.participants = {};
    if (!r.participants[mac]) r.participants[mac] = makePart(mac, driverId, now);
    return r.participants[mac];
  }

  function flatLaps(r) {
    var ps = participantsOf(r), out = [];
    for (var i = 0; i < ps.length; i++) {
      var laps = ps[i].laps || [];
      for (var j = 0; j < laps.length; j++) out.push(laps[j]);
    }
    return out;
  }

  function flatValidLaps(r) { return flatLaps(r).filter(function (l) { return l.valid; }); }

  function flatStints(r) {
    var ps = participantsOf(r), out = [];
    for (var i = 0; i < ps.length; i++) {
      var st = ps[i].stints || [];
      for (var j = 0; j < st.length; j++) out.push(st[j]);
    }
    return out;
  }

  function partValidLaps(part) {
    return ((part && part.laps) || []).filter(function (l) { return l.valid; });
  }

  // Pushes a completed lap into part.laps. Per-kart lap number = count+1.
  function commitLap(part, o) {
    var lap = {
      number: (part.laps ? part.laps.length : 0) + 1,
      timeMs: o.now - o.lapStart,
      driverId: o.driverId != null ? o.driverId : part.currentDriverId,
      kartMac: o.kartMac,
      maxSpeed: o.maxSpeed || 0,
      maxRpm: o.maxRpm || 0,
      distanceM: o.distanceM || 0,
      sectors: Array.isArray(o.sectors) ? o.sectors.slice(0, 3) : [null, null, null],
      valid: true,
    };
    if (!part.laps) part.laps = [];
    part.laps.push(lap);
    var isBest = part.bestLapMs == null || lap.timeMs < part.bestLapMs;
    if (isBest) { part.bestLapMs = lap.timeMs; part.bestLapNum = lap.number; }
    return { lap: lap, isBest: isBest };
  }

  function sectorBestUpdate(sectorsBest, i, sectorMs) {
    if (sectorsBest[i] == null || sectorMs < sectorsBest[i]) {
      sectorsBest[i] = sectorMs;
      return true;
    }
    return false;
  }

  function trackRecordFromKarts(bestsList) {
    var rec = [null, null, null];
    for (var i = 0; i < bestsList.length; i++) {
      var b = bestsList[i] || [];
      for (var s = 0; s < 3; s++) {
        if (b[s] == null) continue;
        if (rec[s] == null || b[s] < rec[s]) rec[s] = b[s];
      }
    }
    return rec;
  }

  return {
    migrateRace: migrateRace,
    participantsOf: participantsOf,
    getOrCreatePart: getOrCreatePart,
    flatLaps: flatLaps,
    flatValidLaps: flatValidLaps,
    flatStints: flatStints,
    partValidLaps: partValidLaps,
    bestFromLaps: bestFromLaps,
    commitLap: commitLap,
    sectorBestUpdate: sectorBestUpdate,
    trackRecordFromKarts: trackRecordFromKarts,
  };
}));
```

- [ ] **Step 4: Test laufen lassen — muss bestehen**

Run: `node --test test/lap-engine.test.js`
Expected: PASS (alle Tests grün).

- [ ] **Step 5: Voll-Suite + Lint**

Run: `node --check lap-engine.js` → OK.
Run: `node --test` → vorher 127, jetzt +13 neue (= 140) PASS, 0 fail.

- [ ] **Step 6: Commit**

```bash
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" add lap-engine.js test/lap-engine.test.js
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" commit -m "feat(multikart-laps): pure lap-engine (participants/laps/best/sectors/migration) + tests

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: `kart-registry.js` — Per-Kart-Sektor-Best-Feld

**Files:**
- Modify: `kart-registry.js` (`makeKartState()`, nahe `sectorsLive:` ~Zeile 41)

**Interfaces:**
- Produces: `k.sectorsBest` (Array `[null,null,null]`) pro Kart, konsumiert von Task 7 (`checkSectorCrossings`/`updateSectorPanel`).

- [ ] **Step 1: Feld ergänzen**

Lies `kart-registry.js` frisch um `sectorsLive:` (Grep `sectorsLive: \{ cur: 0`). Ersetze die Zeile

```js
      sectorsLive: { cur: 0, sectorStart: null, lapSectors: [null, null, null], lastLapSectors: null },
```

durch:

```js
      sectorsLive: { cur: 0, sectorStart: null, lapSectors: [null, null, null], lastLapSectors: null },
      // Sektor-Bestzeiten pro Kart (Phase 30). Strecken-Geometrie/Grenzen
      // bleiben global in state.sectors.boundaries; nur die Bests sind je Kart.
      sectorsBest: [null, null, null],
```

- [ ] **Step 2: Verify**

Run: `node --check kart-registry.js` → OK.
Run: `node --test test/kart-registry.test.js` → bestehende Suite grün (Feld ist additiv).
Grep `kart-registry.js` für `sectorsBest: \[null, null, null\]` → vorhanden.

- [ ] **Step 3: Commit**

```bash
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" add kart-registry.js
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" commit -m "feat(multikart-laps): per-kart sectorsBest field in kart registry

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: Bundling + ESLint-Globals (HTML, package.json, eslint.config.js)

Vorgezogen, damit die Folge-Tasks `RasiLapEngine` lintbar/ladbar konsumieren.

**Files:**
- Modify: `RasiCross_Telemetry.html` (Script-Region — `geo.js`/`replay.js`-Includes vor `rasicross.js`)
- Modify: `package.json` (`build.files`)
- Modify: `eslint.config.js` (Globals-Const + UMD-Block + Konsumenten-Blöcke)

**Interfaces:**
- Produces: `RasiLapEngine` global im Browser + lintbar; `lap-engine.js` im Build-Bundle.

- [ ] **Step 1: Script-Include in HTML (vor rasicross.js)**

Lies die Script-Region frisch (Grep `<script src="replay.js">`). Füge **direkt nach** der `replay.js`-Zeile ein:

```html
<script src="lap-engine.js"></script>
```

> Falls die Reihenfolge anders ist: `lap-engine.js` muss **vor** `rasicross.js`, `races.js`, `laps-drivers.js`, `track.js` geladen werden. `replay.js` liegt dort bereits davor — daher der Anker.

- [ ] **Step 2: `lap-engine.js` ins Build-Bundle**

Lies `package.json` frisch um `"replay.js",` (Grep `"replay.js",`). Ersetze:

```json
      "geo.js",
      "replay.js",
```

durch:

```json
      "geo.js",
      "replay.js",
      "lap-engine.js",
```

- [ ] **Step 3: `RasiLapEngine` in den UMD-Modul-Block aufnehmen**

Lies `eslint.config.js` frisch um den UMD-Block (Grep `files: \['geo.js', 'replay.js'`). Ersetze:

```js
    files: ['geo.js', 'replay.js', 'karts3d.js', 'kart-registry.js'],
```

durch:

```js
    files: ['geo.js', 'replay.js', 'lap-engine.js', 'karts3d.js', 'kart-registry.js'],
```

- [ ] **Step 4: `lapEngineGlobals`-Const deklarieren**

Lies frisch um `const kartOverviewGlobals` (Grep `const kartOverviewGlobals`). Füge **direkt nach** dieser Zeile ein:

```js
// Schnittstelle lap-engine.js -> Nutzer (window.RasiLapEngine)
const lapEngineGlobals = { RasiLapEngine: 'readonly' };
```

- [ ] **Step 5: `RasiLapEngine` in `races.js`-Block**

Lies frisch um den `races.js`-Block (Grep `files: \['races.js'\]`). Ersetze die globals-Zeile mit `...kartRegistryGlobals, activeKart: 'readonly',`:

```js
      globals: { ...globals.browser, ...geoGlobals, ...appCoreGlobals,
                 ...kartRegistryGlobals, activeKart: 'readonly',
```

durch:

```js
      globals: { ...globals.browser, ...geoGlobals, ...appCoreGlobals,
                 ...kartRegistryGlobals, ...lapEngineGlobals, activeKart: 'readonly',
```

- [ ] **Step 6: `RasiLapEngine` + `activeKart` in `laps-drivers.js`-Block**

Lies frisch um den `laps-drivers.js`-Block (Grep `files: \['laps-drivers.js'\]`). Lies die globals-Zeilen dieses Blocks (beginnen mit `globals: { ...globals.browser, ...geoGlobals, ...appCoreGlobals,`). Ergänze in der globals-Map dieses Blocks `...lapEngineGlobals, ...kartRegistryGlobals, activeKart: 'readonly'` (falls noch nicht vorhanden). Konkret die erste globals-Zeile dieses Blocks:

```js
      globals: { ...globals.browser, ...geoGlobals, ...appCoreGlobals,
```

ersetzen durch:

```js
      globals: { ...globals.browser, ...geoGlobals, ...appCoreGlobals,
                 ...lapEngineGlobals, ...kartRegistryGlobals, activeKart: 'readonly',
```

- [ ] **Step 7: `RasiLapEngine` in `track.js`-Block**

Lies frisch um den `track.js`-Block (Grep `files: \['track.js'\]`). Ersetze dessen erste globals-Zeile:

```js
      globals: { ...globals.browser, ...geoGlobals, ...appCoreGlobals,
```

durch:

```js
      globals: { ...globals.browser, ...geoGlobals, ...appCoreGlobals,
                 ...lapEngineGlobals, ...kartRegistryGlobals,
```

- [ ] **Step 8: `RasiLapEngine` in `rasicross.js`-Block**

Lies frisch um den `rasicross.js`-Block (Grep `files: \['rasicross.js'\]`). Ersetze in dessen globals-Map die Zeile

```js
        ...geoGlobals,
```

durch:

```js
        ...geoGlobals, ...lapEngineGlobals,
```

- [ ] **Step 9: Verify**

Run: `npx eslint eslint.config.js` → 0 Fehler.
Run: `node --test test/build-manifest.test.js` → PASS (lap-engine.js jetzt gewhitelistet).
Grep `package.json` für `"lap-engine.js"` → vorhanden. Grep `RasiCross_Telemetry.html` für `src="lap-engine.js"` → vorhanden. Grep `eslint.config.js` für `lapEngineGlobals` → vorhanden (≥5×).

- [ ] **Step 10: Commit**

```bash
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" add RasiCross_Telemetry.html package.json eslint.config.js
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" commit -m "chore(multikart-laps): bundle + lint globals for lap-engine.js

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: `rasicross.js` — Fassade `sectorsBest` + Migration beim Laden

**Files:**
- Modify: `rasicross.js` (`PER_KART_FIELDS` ~Zeile 79–82; `loadData` Race-Zweig ~Zeile 218–222)

**Interfaces:**
- Consumes: `RasiLapEngine.migrateRace` (Task 1), `KartRegistry.DEFAULT_MAC`.
- Produces: `state.sectorsBest` (Per-Kart-Fassade) für Task 7; migrierte `state.races` mit `participants`.

- [ ] **Step 1: `'sectorsBest'` in `PER_KART_FIELDS`**

Lies frisch um `PER_KART_FIELDS` (Grep `'autoLap','sectorsLive','recording'`). Ersetze:

```js
  'autoLap','sectorsLive','recording','replay','calibration','engine'];
```

durch:

```js
  'autoLap','sectorsLive','sectorsBest','recording','replay','calibration','engine'];
```

- [ ] **Step 2: Migration beim Laden anwenden**

Lies `loadData` frisch um den Race-Zweig (Grep `state.races = d.races;`). Ersetze:

```js
    if (Array.isArray(d.races)) {
      state.races = d.races;
      // Pause running races on reload
      state.races.forEach(r => { if (r.status === 'running') { r.status = 'paused'; r.pausedAt = Date.now(); } });
    }
```

durch:

```js
    if (Array.isArray(d.races)) {
      state.races = d.races;
      // Phase 30: Alt-Rennen (ohne participants) in Teilnehmer-Modell migrieren
      // (idempotent, additiv — Top-Level laps/stints bleiben erhalten).
      state.races.forEach(r => RasiLapEngine.migrateRace(r, KartRegistry.DEFAULT_MAC));
      // Pause running races on reload
      state.races.forEach(r => { if (r.status === 'running') { r.status = 'paused'; r.pausedAt = Date.now(); } });
    }
```

- [ ] **Step 3: Verify**

Run: `node --check rasicross.js` → OK.
Run: `npx eslint rasicross.js` → 0 Fehler.
Grep `rasicross.js` für `'sectorsBest'` und `RasiLapEngine.migrateRace` → beide vorhanden.

- [ ] **Step 4: Commit**

```bash
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" add rasicross.js
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" commit -m "feat(multikart-laps): sectorsBest facade field + race migration on load

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: `races.js` — Teilnehmer-Modell (Erstellen/Start/Ende/Pause/Fahrerwechsel/Details)

**Files:**
- Modify: `races.js` (`currentStint` ~15; `raceValidLaps` ~16; `createRace` ~31–41; `startRace` ~52–115; `endRace` ~116–147; `confirmDriverChange` ~173–190; `renderRaces` validLaps ~291; `renderRaceDetails` ~325–379; `kartBadge` ~264–271)

**Interfaces:**
- Consumes: `RasiLapEngine.{migrateRace,getOrCreatePart,participantsOf,flatValidLaps,partValidLaps,bestFromLaps}`, `activeKart()`, `state.activeKartMac`, `state.karts`.
- Produces: `r.participants[mac]` befüllt; `raceValidLaps(r)` aggregiert über Teilnehmer; `activePart(r)`-Helfer (neu) für aktiven Kart.

- [ ] **Step 1: `raceValidLaps` auf Teilnehmer + `activePart`-Helfer**

Lies frisch um `function raceValidLaps` (Grep `function raceValidLaps`). Ersetze:

```js
function raceValidLaps(r) { return r ? r.laps.filter(l => l.valid) : []; }
```

durch:

```js
function raceValidLaps(r) { return r ? RasiLapEngine.flatValidLaps(r) : []; }
// Teilnehmer-Slot des aktuell aktiven Karts (legt bei Bedarf an).
function activePart(r) {
  if (!r) return null;
  const mac = state.activeKartMac || KartRegistry.DEFAULT_MAC;
  return RasiLapEngine.getOrCreatePart(r, mac, r.startDriverId, r.startedAt || Date.now());
}
```

- [ ] **Step 2: `currentStint` auf aktiven Teilnehmer**

Lies frisch um `function currentStint` (Grep `function currentStint`). Ersetze:

```js
function currentStint(r) { return r && r.stints && r.stints.length ? r.stints[r.stints.length - 1] : null; }
```

durch:

```js
function currentStint(r) {
  const p = r ? activePart(r) : null;
  return p && p.stints && p.stints.length ? p.stints[p.stints.length - 1] : null;
}
```

- [ ] **Step 3: `createRace` mit leerer `participants`-Map**

Lies frisch um das `race`-Literal in `createRace` (Grep `kartMac: state.activeKartMac \|\| KartRegistry.DEFAULT_MAC,`). Ersetze:

```js
    status: 'created', createdAt: Date.now(),
    startedAt: null, endedAt: null, pausedAt: null, totalPausedMs: 0,
    laps: [], stints: [], speedTrace: []
  };
```

durch:

```js
    status: 'created', createdAt: Date.now(),
    startedAt: null, endedAt: null, pausedAt: null, totalPausedMs: 0,
    // Phase 30: Teilnehmer je kartMac (laps/stints/speedTrace/best pro Kart).
    // Top-Level laps/stints/speedTrace bleiben leer (Migrations-/Downgrade-Gnade).
    participants: {}, laps: [], stints: [], speedTrace: []
  };
```

- [ ] **Step 4: `startRace` — alle verbundenen Karts armieren (rolling start)**

Lies frisch den frischen-Start-Zweig in `startRace` (Grep `r.stints = \[\{ id: uid\(\), driverId: r.currentDriverId, startAt: now, endAt: null \}\];`). Ersetze den Block

```js
      // Frischer Start: kompletter Reset wie bisher.
      r.status = 'running';
      r.startedAt = now;
      r.endedAt = null;
      r.totalPausedMs = 0;
      r.stints = [{ id: uid(), driverId: r.currentDriverId, startAt: now, endAt: null }];
      r.laps = [];
      r.speedTrace = [];
      state.lapStart = now;
      state.currentLapMax = { speed: 0, rpm: 0 };
      state.currentLapTrace = [];
      state.bestLapMs = null;
      state.bestLapNum = null;
      state.bestLapTrace = null;
      state.heatmap.lapMaxSpeed = 0;
      state.sectorsLive.cur = 0;
      state.sectorsLive.sectorStart = now;
      state.sectorsLive.lapSectors = [null, null, null];
      state.sectorsLive.lastLapSectors = null;
      state.autoLap.prevLat = null;
      state.autoLap.prevLon = null;
    }
```

durch:

```js
      // Frischer Start: kompletter Reset. Phase 30: alle aktuell verbundenen
      // Karts werden Teilnehmer; jeder startet UNarmiert (lapStart=null) und
      // armiert bei seiner ersten Linien-Durchfahrt (rolling start).
      r.status = 'running';
      r.startedAt = now;
      r.endedAt = null;
      r.totalPausedMs = 0;
      r.participants = {};
      r.laps = [];
      r.speedTrace = [];
      const _macs = state.karts.macs();
      const _list = _macs.length ? _macs : [state.activeKartMac || KartRegistry.DEFAULT_MAC];
      _list.forEach(mac => {
        const p = RasiLapEngine.getOrCreatePart(r, mac, r.currentDriverId, null);
        p.startDriverId = r.currentDriverId;
        p.currentDriverId = r.currentDriverId;
        p.stints = [{ id: uid(), driverId: r.currentDriverId, startAt: now, endAt: null }];
        p.laps = [];
        p.speedTrace = [];
        p.bestLapMs = null; p.bestLapNum = null; p.joinedAt = null;
        const k = state.karts.get(mac);
        if (k) {
          k.lapStart = null;                 // UNarmiert -> erste Linie armiert
          k.currentLapMax = { speed: 0, rpm: 0 };
          k.currentLapTrace = [];
          k.bestLapMs = null; k.bestLapNum = null; k.bestLapTrace = null;
          k.heatmap.lapMaxSpeed = 0;
          k.sectorsBest = [null, null, null];
          k.sectorsLive.cur = 0;
          k.sectorsLive.sectorStart = null;
          k.sectorsLive.lapSectors = [null, null, null];
          k.sectorsLive.lastLapSectors = null;
          k.autoLap.prevLat = null;
          k.autoLap.prevLon = null;
        }
      });
    }
```

- [ ] **Step 5: `endRace` — offene Stints aller Teilnehmer schließen + Live-State je Kart reset**

Lies frisch um den State-Reset in `endRace` (Grep `const st = currentStint\(r\);`). Ersetze:

```js
    r.status = auto ? 'finished_auto' : 'finished';
    r.endedAt = now;
    const st = currentStint(r);
    if (st && !st.endAt) st.endAt = now;
    state.lapStart = null;
    state.currentLapMax = { speed: 0, rpm: 0 };
    state.sectorsLive.cur = 0;
    state.sectorsLive.sectorStart = null;
    state.sectorsLive.lapSectors = [null, null, null];
```

durch:

```js
    r.status = auto ? 'finished_auto' : 'finished';
    r.endedAt = now;
    // Phase 30: offene Stints ALLER Teilnehmer schließen + Live-State je Kart reset.
    RasiLapEngine.participantsOf(r).forEach(p => {
      const open = p.stints && p.stints.length ? p.stints[p.stints.length - 1] : null;
      if (open && !open.endAt) open.endAt = now;
      const k = state.karts.has(p.mac) ? state.karts.get(p.mac) : null;
      if (k) {
        k.lapStart = null;
        k.currentLapMax = { speed: 0, rpm: 0 };
        k.sectorsLive.cur = 0;
        k.sectorsLive.sectorStart = null;
        k.sectorsLive.lapSectors = [null, null, null];
      }
    });
```

- [ ] **Step 6: `confirmDriverChange` auf aktiven Teilnehmer**

Lies frisch `confirmDriverChange` (Grep `function confirmDriverChange`). Ersetze:

```js
  const now = Date.now();
  const old = currentStint(r);
  if (old && !old.endAt) old.endAt = now;
  r.currentDriverId = newId;
  r.stints.push({ id: uid(), driverId: newId, startAt: now, endAt: null });
```

durch:

```js
  const now = Date.now();
  // Phase 30: Fahrerwechsel gilt fuer den aktuell per Chip gewaehlten Kart.
  const p = activePart(r);
  const old = p.stints && p.stints.length ? p.stints[p.stints.length - 1] : null;
  if (old && !old.endAt) old.endAt = now;
  p.currentDriverId = newId;
  p.stints.push({ id: uid(), driverId: newId, startAt: now, endAt: null });
```

- [ ] **Step 7: `renderRaces` validLaps-Quelle**

Lies frisch um die validLaps-Zeile in `renderRaces` (Grep `const validLaps = raceValidLaps\(r\);`). Diese nutzt bereits `raceValidLaps(r)` — nach Step 1 aggregiert sie über Teilnehmer. **Keine Änderung nötig**; nur verifizieren, dass die Zeile existiert.

- [ ] **Step 8: `kartBadge` Multi-Kart**

Lies frisch `function kartBadge` (Grep `function kartBadge`). Ersetze die komplette Funktion:

```js
function kartBadge(r) {
  const mac = r && r.kartMac;
  if (!mac || mac === (window.KartRegistry && KartRegistry.DEFAULT_MAC)) return '';
  const meta = state.kartMeta && state.kartMeta[mac];
  if (!meta) return '';
  const color = meta.color || '#3aa0e8';
  return ` <span class="kart-badge" style="border-color:${esc(color)};color:${esc(color)}">${esc(meta.name || 'Kart')}</span>`;
}
```

durch:

```js
function kartBadge(r) {
  // Phase 30: ein Badge je Teilnehmer-Kart (Default-Bucket ohne Badge).
  const parts = RasiLapEngine.participantsOf(r)
    .filter(p => p.mac && p.mac !== (window.KartRegistry && KartRegistry.DEFAULT_MAC));
  if (!parts.length) return '';
  return parts.map(p => {
    const meta = state.kartMeta && state.kartMeta[p.mac];
    const color = (meta && meta.color) || '#3aa0e8';
    const name = (meta && meta.name) || 'Kart';
    return ` <span class="kart-badge" style="border-color:${esc(color)};color:${esc(color)}">${esc(name)}</span>`;
  }).join('');
}
```

- [ ] **Step 9: `renderRaceDetails` — Runden/Stints pro Kart gruppiert**

Lies frisch `function renderRaceDetails` (Grep `function renderRaceDetails`). Ersetze den **Runden-Block** (von `const lapsHtml = r.laps.length` bis zu seinem `: '<tr>…</tr>';`) — Grep `const lapsHtml = r.laps.length`. Ersetze:

```js
  const lapsHtml = r.laps.length
    ? r.laps.map(l => {
        const d = state.drivers.find(x => x.id === l.driverId);
        const isBest = best && l.timeMs === best;
        return `<tr class="${!l.valid ? 'invalid' : (isBest ? 'best' : '')}">
          <td>${l.number}</td>
          <td>${fmtMs(l.timeMs)}</td>
          <td>${esc(d?.name || '--')}</td>
          <td>${(l.maxSpeed||0).toFixed(1)}</td>
          <td>${Math.round(l.maxRpm||0)}</td>
        </tr>`;
      }).join('')
    : '<tr><td colspan="5" class="muted">Keine Runden</td></tr>';
```

durch:

```js
  // Phase 30: Runden pro Teilnehmer-Kart gruppiert. Bei einem Teilnehmer wie bisher.
  const _parts = RasiLapEngine.participantsOf(r);
  const lapsHtml = RasiLapEngine.flatLaps(r).length
    ? _parts.map(p => {
        if (!p.laps.length) return '';
        const meta = state.kartMeta && state.kartMeta[p.mac];
        const color = (meta && meta.color) || '#3aa0e8';
        const kname = (meta && meta.name) || (p.mac === KartRegistry.DEFAULT_MAC ? 'Kart' : p.mac);
        const pv = RasiLapEngine.partValidLaps(p);
        const pBest = pv.length ? Math.min(...pv.map(l => l.timeMs)) : null;
        const head = _parts.length > 1
          ? `<tr class="kart-group"><td colspan="5" style="color:${esc(color)};font-weight:700">${esc(kname)} — ${pv.length} Runden</td></tr>`
          : '';
        const rows = p.laps.map(l => {
          const d = state.drivers.find(x => x.id === l.driverId);
          const isBest = pBest && l.timeMs === pBest;
          return `<tr class="${!l.valid ? 'invalid' : (isBest ? 'best' : '')}">
            <td>${l.number}</td>
            <td>${fmtMs(l.timeMs)}</td>
            <td>${esc(d?.name || '--')}</td>
            <td>${(l.maxSpeed||0).toFixed(1)}</td>
            <td>${Math.round(l.maxRpm||0)}</td>
          </tr>`;
        }).join('');
        return head + rows;
      }).join('')
    : '<tr><td colspan="5" class="muted">Keine Runden</td></tr>';
```

Dann den **Stints-Block** ersetzen — Grep `const stintsHtml = \(r.stints \|\| \[\]\).map`. Ersetze:

```js
  const stintsHtml = (r.stints || []).map((st, i) => {
    const d = state.drivers.find(x => x.id === st.driverId);
    const dur = (st.endAt || Date.now()) - st.startAt;
    return `<div class="stint-row">
      <span class="stint-num">#${i+1}</span>
      <span class="stint-name">${esc(d?.name || '--')}</span>
      <span class="stint-dur">${fmtClock(dur)}</span>
    </div>`;
  }).join('');
```

durch:

```js
  // Phase 30: Stints aller Teilnehmer (mit Kart-Praefix bei >1 Kart).
  const _multi = RasiLapEngine.participantsOf(r).length > 1;
  const stintsHtml = RasiLapEngine.participantsOf(r).map(p => {
    const meta = state.kartMeta && state.kartMeta[p.mac];
    const kname = (meta && meta.name) || (p.mac === KartRegistry.DEFAULT_MAC ? '' : p.mac);
    return (p.stints || []).map((st, i) => {
      const d = state.drivers.find(x => x.id === st.driverId);
      const dur = (st.endAt || Date.now()) - st.startAt;
      const tag = _multi && kname ? `${esc(kname)} · ` : '';
      return `<div class="stint-row">
        <span class="stint-num">#${i+1}</span>
        <span class="stint-name">${tag}${esc(d?.name || '--')}</span>
        <span class="stint-dur">${fmtClock(dur)}</span>
      </div>`;
    }).join('');
  }).join('');
```

> `renderRaceDetails` bekommt `r.laps.length` an weiteren Stellen (Überschrift „Runden (N)"). Lies frisch um `<h4>Runden (${r.laps.length})</h4>` (Grep `Runden \(\$\{r.laps.length\}\)`) und ersetze `${r.laps.length}` durch `${RasiLapEngine.flatLaps(r).length}`.

- [ ] **Step 10: Verify**

Run: `node --check races.js` → OK.
Run: `npx eslint races.js` → 0 Fehler.
Run: `node --test` → grün (140).
Grep `races.js` für `RasiLapEngine`, `activePart`, `r.participants = {}`, `getOrCreatePart` → vorhanden.

- [ ] **Step 11: Commit**

```bash
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" add races.js
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" commit -m "feat(multikart-laps): participant model in race lifecycle + per-kart details

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 6: `laps-drivers.js` — Lap-Engine pro Kart + Stats über Teilnehmer

**Files:**
- Modify: `laps-drivers.js` (`checkLapCrossing` ~12–27; `triggerLap` ~28–98; `renderLapTable` ~99–125; `renderLiveLapList` ~129–162; `getDriverStats` ~169–230; `getTotalStats` ~232–266; `theoreticalBestMs` ~368–371)

**Interfaces:**
- Consumes: `RasiLapEngine.{getOrCreatePart,commitLap,flatLaps,flatStints,partValidLaps}`, `activeKart()`, `state.activeKartMac`, `state.karts`, `state.sectorsBest` (Fassade), `traceDistanceM`.
- Produces: `checkLapCrossing(k, mac, lat, lon)`, `triggerLap(k, mac)` (neue Signaturen, von Task 8 aufgerufen).

- [ ] **Step 1: `checkLapCrossing` auf `(k, mac, lat, lon)`**

Lies frisch `function checkLapCrossing` (Grep `function checkLapCrossing`). Ersetze die komplette Funktion:

```js
function checkLapCrossing(lat, lon) {
  try {
    if (!state.startGate.enabled) return;
    if (!state.autoLap.prevLat) return;
    const ep = lineEndpointsFromGate(state.startGate);
    if (!ep) return;
    const now = Date.now();
    // Cooldown: at least minLapSeconds
    if (state.lapStart && (now - state.lapStart) < state.settings.minLapSeconds * 1000) return;
    const A = { lat: state.autoLap.prevLat, lon: state.autoLap.prevLon };
    const B = { lat, lon };
    if (segmentsCross(A, B, ep.p1, ep.p2) && crossingDirectionOk(A.lat, A.lon, lat, lon, state.startGate.heading)) {
      triggerLap();
    }
  } catch (e) { console.warn('checkLapCrossing:', e); }
}
```

durch:

```js
// Phase 30: pro Kart aufgerufen. Geometrie (startGate) ist geteilt; Lap-State
// (lapStart/autoLap) kommt vom uebergebenen Kart k, nicht von der Fassade.
function checkLapCrossing(k, mac, lat, lon) {
  try {
    if (!state.startGate.enabled) return;
    if (!k.autoLap.prevLat) return;
    const ep = lineEndpointsFromGate(state.startGate);
    if (!ep) return;
    const now = Date.now();
    // Cooldown: at least minLapSeconds (gegen k.lapStart dieses Karts)
    if (k.lapStart && (now - k.lapStart) < state.settings.minLapSeconds * 1000) return;
    const A = { lat: k.autoLap.prevLat, lon: k.autoLap.prevLon };
    const B = { lat, lon };
    if (segmentsCross(A, B, ep.p1, ep.p2) && crossingDirectionOk(A.lat, A.lon, lat, lon, state.startGate.heading)) {
      triggerLap(k, mac);
    }
  } catch (e) { console.warn('checkLapCrossing:', e); }
}
```

- [ ] **Step 2: `triggerLap` auf `(k, mac)` + Teilnehmer-Commit**

Lies frisch `function triggerLap` (Grep `function triggerLap`). Ersetze die komplette Funktion:

```js
function triggerLap() {
  try {
    const r = activeRace();
    if (!r || r.status !== 'running') return;
    const now = Date.now();
    if (state.lapStart) {
      const lapMs = now - state.lapStart;
      if (lapMs < state.settings.minLapSeconds * 1000) return;
      const lap = {
        id: uid(),
        number: r.laps.length + 1,
        timeMs: lapMs,
        driverId: r.currentDriverId,
        kartMac: r.kartMac || state.activeKartMac || KartRegistry.DEFAULT_MAC,
        maxSpeed: state.currentLapMax.speed,
        maxRpm: state.currentLapMax.rpm,
        distanceM: traceDistanceM(state.currentLapTrace),
        valid: true
      };
      r.laps.push(lap);
      // Update sector best for last sector
      const s = state.sectors;            // Konfiguration (global)
      const sl = state.sectorsLive;       // Live-Sektorzeiten (pro Kart)
      if (s.boundaries[0] && s.boundaries[1] && sl.cur === 2 && sl.sectorStart) {
        const s3Ms = now - sl.sectorStart;
        sl.lapSectors[2] = s3Ms;
        if (s.best[2] == null || s3Ms < s.best[2]) {
          s.best[2] = s3Ms;
          rcAudio.sectorBest();
          syncSectorBestToTrack();
        }
      }
      lap.sectors = sl.lapSectors.slice(0, 3);    // [s1,s2,s3] ms (null ohne Sektorgrenzen)
      // Update best lap
      if (state.bestLapMs == null || lapMs < state.bestLapMs) {
        state.bestLapMs = lapMs;
        state.bestLapNum = lap.number;
        state.bestLapTrace = [...state.currentLapTrace];
        rcAudio.lapBest();
      }
      // Save sector times for display
      if (sl.lapSectors.some(x => x)) {
        sl.lastLapSectors = [...sl.lapSectors];
        setTimeout(() => {
          const sl2 = state.sectorsLive;
          if (sl2.lastLapSectors && !sl2.lapSectors.some(x => x)) {
            sl2.lastLapSectors = null;
            updateSectorPanel();
          }
        }, 7000);
      }
      // Flash gate
      state.gateFlashUntil = now + 1500;
      // Auto-end if lap-based race
      if (r.lengthType === 'laps' && r.laps.filter(l => l.valid).length >= r.targetLaps) {
        endRace(true);
      }
      saveDataDebounced();
    }
    // Start new lap
    state.lapStart = now;
    state.currentLapMax = { speed: 0, rpm: 0 };
    state.currentLapTrace = [];
    state.heatmap.lapMaxSpeed = 0;
    state.sectorsLive.cur = 0;
    state.sectorsLive.sectorStart = now;
    state.sectorsLive.lapSectors = [null, null, null];
    updateSectorPanel();
    renderLapTable();
  } catch (e) { console.warn('triggerLap:', e); }
}
```

durch:

```js
// Phase 30: pro Kart. Erste Durchfahrt (k.lapStart==null) armiert nur; weitere
// Durchfahrten committen eine Runde in den Teilnehmer-Slot dieses Karts.
function triggerLap(k, mac) {
  try {
    const r = activeRace();
    if (!r || r.status !== 'running') return;
    const now = Date.now();
    const isAct = (k === activeKart());
    if (k.lapStart) {
      const minMs = state.settings.minLapSeconds * 1000;
      if (now - k.lapStart < minMs) return;
      const part = RasiLapEngine.getOrCreatePart(r, mac, r.currentDriverId, now);
      const sl = k.sectorsLive;           // Live-Sektorzeiten (pro Kart)
      const s = state.sectors;            // Sektor-Konfiguration (global)
      // Letzten Sektor (S3) abschliessen + Per-Kart-Best (k.sectorsBest).
      if (s.boundaries[0] && s.boundaries[1] && sl.cur === 2 && sl.sectorStart) {
        const s3Ms = now - sl.sectorStart;
        sl.lapSectors[2] = s3Ms;
        if (RasiLapEngine.sectorBestUpdate(k.sectorsBest, 2, s3Ms)) {
          if (isAct) rcAudio.sectorBest();
          syncSectorBestToTrack();
        }
      }
      const res = RasiLapEngine.commitLap(part, {
        now, lapStart: k.lapStart, driverId: part.currentDriverId, kartMac: mac,
        maxSpeed: k.currentLapMax.speed, maxRpm: k.currentLapMax.rpm,
        distanceM: traceDistanceM(k.currentLapTrace),
        sectors: sl.lapSectors.slice(0, 3),
      });
      res.lap.id = uid();
      // Registry-Best (fuer Uebersicht-Grid) mit Teilnehmer-Best synchron halten.
      k.bestLapMs = part.bestLapMs;
      k.bestLapNum = part.bestLapNum;
      if (res.isBest) {
        k.bestLapTrace = [...k.currentLapTrace];
        if (isAct) rcAudio.lapBest();
      }
      // Sektorzeiten fuers Display merken (nur aktiver Kart treibt das Panel).
      if (sl.lapSectors.some(x => x)) {
        sl.lastLapSectors = [...sl.lapSectors];
        setTimeout(() => {
          if (k.sectorsLive.lastLapSectors && !k.sectorsLive.lapSectors.some(x => x)) {
            k.sectorsLive.lastLapSectors = null;
            if (k === activeKart()) updateSectorPanel();
          }
        }, 7000);
      }
      if (isAct) state.gateFlashUntil = now + 1500;
      // Auto-Ende nur bei Single-Teilnehmer-Rennen (Multi-Kart -> Phase 31).
      if (r.lengthType === 'laps'
          && RasiLapEngine.participantsOf(r).length <= 1
          && RasiLapEngine.partValidLaps(part).length >= r.targetLaps) {
        endRace(true);
      }
      saveDataDebounced();
    }
    // Neue Runde dieses Karts starten.
    k.lapStart = now;
    k.currentLapMax = { speed: 0, rpm: 0 };
    k.currentLapTrace = [];
    k.heatmap.lapMaxSpeed = 0;
    k.sectorsLive.cur = 0;
    k.sectorsLive.sectorStart = now;
    k.sectorsLive.lapSectors = [null, null, null];
    if (isAct) { updateSectorPanel(); renderLapTable(); }
  } catch (e) { console.warn('triggerLap:', e); }
}
```

- [ ] **Step 3: `renderLapTable` — aktiver Teilnehmer**

Lies frisch `function renderLapTable` (Grep `function renderLapTable`). Ersetze:

```js
function renderLapTable() {
  renderLiveLapList();
  const r = activeRace();
  const tbody = $('lapTable');
  if (!r || !r.laps.length) {
```

durch:

```js
function renderLapTable() {
  renderLiveLapList();
  const r = activeRace();
  const tbody = $('lapTable');
  // Phase 30: Runden des aktiven Karts (Teilnehmer-Slot).
  const _p = r ? RasiLapEngine.getOrCreatePart(r, state.activeKartMac || KartRegistry.DEFAULT_MAC, r.startDriverId, r.startedAt || Date.now()) : null;
  if (!r || !_p || !_p.laps.length) {
```

Dann im selben `renderLapTable` jede Referenz auf `r.laps` durch `_p.laps` ersetzen. Lies frisch und ersetze:

```js
  const valid = r.laps.filter(l => l.valid);
  const best = valid.length ? Math.min(...valid.map(l => l.timeMs)) : null;
  setText('lapCountText', `${valid.length} Runden`);
  tbody.innerHTML = [...r.laps].reverse().map(l => {
    const idx = l.number - 1;
    const prev = idx > 0 ? r.laps[idx - 1].timeMs : null;
```

durch:

```js
  const valid = _p.laps.filter(l => l.valid);
  const best = valid.length ? Math.min(...valid.map(l => l.timeMs)) : null;
  setText('lapCountText', `${valid.length} Runden`);
  tbody.innerHTML = [..._p.laps].reverse().map(l => {
    const idx = l.number - 1;
    const prev = idx > 0 ? _p.laps[idx - 1].timeMs : null;
```

- [ ] **Step 4: `renderLiveLapList` — aktiver Teilnehmer**

Lies frisch `function renderLiveLapList` (Grep `function renderLiveLapList`). Ersetze:

```js
  const tbody = $('liveLapList');
  if (!tbody) return;
  const r = activeRace();
  if (!r || !r.laps.length) {
    tbody.innerHTML = '<tr><td colspan="9" class="muted">Noch keine Runden.</td></tr>';
    setText('liveLapCount', '0 Runden');
    return;
  }
  const fmtS = ms => (ms == null ? '--' : (ms / 1000).toFixed(2));
  const valid = r.laps.filter(l => l.valid);
  const best = valid.length ? Math.min(...valid.map(l => l.timeMs)) : null;
  setText('liveLapCount', `${valid.length} Runden`);
  tbody.innerHTML = [...r.laps].reverse().map(l => {
    const idx = l.number - 1;
    const prev = idx > 0 ? r.laps[idx - 1].timeMs : null;
```

durch:

```js
  const tbody = $('liveLapList');
  if (!tbody) return;
  const r = activeRace();
  const _p = r ? RasiLapEngine.getOrCreatePart(r, state.activeKartMac || KartRegistry.DEFAULT_MAC, r.startDriverId, r.startedAt || Date.now()) : null;
  if (!r || !_p || !_p.laps.length) {
    tbody.innerHTML = '<tr><td colspan="9" class="muted">Noch keine Runden.</td></tr>';
    setText('liveLapCount', '0 Runden');
    return;
  }
  const fmtS = ms => (ms == null ? '--' : (ms / 1000).toFixed(2));
  const valid = _p.laps.filter(l => l.valid);
  const best = valid.length ? Math.min(...valid.map(l => l.timeMs)) : null;
  setText('liveLapCount', `${valid.length} Runden`);
  tbody.innerHTML = [..._p.laps].reverse().map(l => {
    const idx = l.number - 1;
    const prev = idx > 0 ? _p.laps[idx - 1].timeMs : null;
```

- [ ] **Step 5: `getDriverStats` über alle Teilnehmer-Runden/-Stints**

Lies frisch in `getDriverStats` die Schleifenkörper (Grep `r.laps.forEach\(l => \{` — die Stelle in `getDriverStats`). Ersetze:

```js
    // Laps pro Driver
    r.laps.forEach(l => {
```

durch:

```js
    // Laps pro Driver (Phase 30: ueber alle Teilnehmer-Karts)
    RasiLapEngine.flatLaps(r).forEach(l => {
```

Dann den Stint-Block — Grep `(r.stints || []).forEach(st => {` (die Stelle in `getDriverStats`). Ersetze:

```js
    // Stints des Fahrers
    (r.stints || []).forEach(st => {
```

durch:

```js
    // Stints des Fahrers (Phase 30: ueber alle Teilnehmer-Karts)
    RasiLapEngine.flatStints(r).forEach(st => {
```

- [ ] **Step 6: `getTotalStats` über alle Teilnehmer-Runden**

Lies frisch in `getTotalStats` (Grep `r.laps.forEach\(l => \{` — die Stelle in `getTotalStats`, die zweite im File). Ersetze:

```js
    r.laps.forEach(l => {
      if (!l.valid) return;
      totalLaps++;
```

durch:

```js
    RasiLapEngine.flatLaps(r).forEach(l => {
      if (!l.valid) return;
      totalLaps++;
```

- [ ] **Step 7: `theoreticalBestMs` über aktiven Kart**

Lies frisch `function theoreticalBestMs` (Grep `function theoreticalBestMs`). Ersetze:

```js
function theoreticalBestMs() {
  const b = (state.sectors && state.sectors.best) || [];
  return (b[0] && b[1] && b[2]) ? b[0] + b[1] + b[2] : null;
}
```

durch:

```js
function theoreticalBestMs() {
  // Phase 30: Sektor-Bests sind pro Kart -> aktiver Kart (Fassade state.sectorsBest).
  const b = state.sectorsBest || [];
  return (b[0] && b[1] && b[2]) ? b[0] + b[1] + b[2] : null;
}
```

- [ ] **Step 8: Verify**

Run: `node --check laps-drivers.js` → OK.
Run: `npx eslint laps-drivers.js` → 0 Fehler.
Run: `node --test` → grün (140).
Grep `laps-drivers.js` für `function triggerLap\(k, mac\)`, `function checkLapCrossing\(k, mac`, `RasiLapEngine.commitLap`, `k.sectorsBest`, `state.sectorsBest` → vorhanden.

- [ ] **Step 9: Commit**

```bash
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" add laps-drivers.js
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" commit -m "feat(multikart-laps): per-kart lap engine + stats over participants

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 7: `track.js` — Per-Kart-Sektor-Erkennung + Strecken-Rekord-Ableitung

**Files:**
- Modify: `track.js` (`syncSectorBestToTrack` ~175–178; `loadSavedTrack` ~193; `checkSectorCrossings` ~686–721; `updateSectorPanel` ~722–741)

**Interfaces:**
- Consumes: `RasiLapEngine.{sectorBestUpdate,trackRecordFromKarts}`, `state.karts`, `state.sectorsBest` (Fassade aktiver Kart), `activeKart()`.
- Produces: `checkSectorCrossings(k, lat, lon)` (neue Signatur, von Task 8 aufgerufen).

- [ ] **Step 1: `checkSectorCrossings` auf `(k, lat, lon)` + `k.sectorsBest`**

Lies frisch `function checkSectorCrossings` (Grep `function checkSectorCrossings`). Ersetze die komplette Funktion:

```js
function checkSectorCrossings(lat, lon) {
  try {
    const r = activeRace();
    if (!r || r.status !== 'running' || !state.lapStart) return;
    const s = state.sectors;          // Konfiguration (global)
    const sl = state.sectorsLive;     // Live-Sektorzeiten (pro Kart)
    const bs = s.boundaries;
    if (!bs[0] && !bs[1]) return;
    if (!state.autoLap.prevLat) return; // wait for prev
    const A = { lat: state.autoLap.prevLat, lon: state.autoLap.prevLon };
    const B = { lat, lon };
    const now = Date.now();
    // Cooldown (avoid double trigger)
    if (sl.sectorStart && (now - sl.sectorStart) < 2000) return;
    for (let i = 0; i < 2; i++) {
      if (sl.cur !== i) continue;
      const ep = lineEndpointsFromGate(bs[i]);
      if (!ep) continue;
      if (segmentsCross(A, B, ep.p1, ep.p2) && crossingDirectionOk(A.lat, A.lon, lat, lon, bs[i].heading)) {
        const sectorMs = now - (sl.sectorStart || state.lapStart);
        sl.lapSectors[i] = sectorMs;
        sl.sectorStart = now;
        sl.cur = i + 1;
        // Update best
        if (s.best[i] == null || sectorMs < s.best[i]) {
          s.best[i] = sectorMs;
          rcAudio.sectorBest();
          syncSectorBestToTrack();
          saveDataDebounced();
        }
        updateSectorPanel();
        break;
      }
    }
  } catch (e) { console.warn('checkSectorCrossings:', e); }
}
```

durch:

```js
// Phase 30: pro Kart. Grenzen (boundaries) sind geteilt; Live-Sektorzeiten +
// Sektor-Bestzeiten kommen vom uebergebenen Kart k.
function checkSectorCrossings(k, lat, lon) {
  try {
    const r = activeRace();
    if (!r || r.status !== 'running' || !k.lapStart) return;
    const s = state.sectors;          // Konfiguration (global)
    const sl = k.sectorsLive;         // Live-Sektorzeiten dieses Karts
    const bs = s.boundaries;
    if (!bs[0] && !bs[1]) return;
    if (!k.autoLap.prevLat) return;   // wait for prev
    const A = { lat: k.autoLap.prevLat, lon: k.autoLap.prevLon };
    const B = { lat, lon };
    const now = Date.now();
    const isAct = (k === activeKart());
    // Cooldown (avoid double trigger)
    if (sl.sectorStart && (now - sl.sectorStart) < 2000) return;
    for (let i = 0; i < 2; i++) {
      if (sl.cur !== i) continue;
      const ep = lineEndpointsFromGate(bs[i]);
      if (!ep) continue;
      if (segmentsCross(A, B, ep.p1, ep.p2) && crossingDirectionOk(A.lat, A.lon, lat, lon, bs[i].heading)) {
        const sectorMs = now - (sl.sectorStart || k.lapStart);
        sl.lapSectors[i] = sectorMs;
        sl.sectorStart = now;
        sl.cur = i + 1;
        // Update per-kart best
        if (RasiLapEngine.sectorBestUpdate(k.sectorsBest, i, sectorMs)) {
          if (isAct) rcAudio.sectorBest();
          syncSectorBestToTrack();
          saveDataDebounced();
        }
        if (isAct) updateSectorPanel();
        break;
      }
    }
  } catch (e) { console.warn('checkSectorCrossings:', e); }
}
```

- [ ] **Step 2: `updateSectorPanel` liest `state.sectorsBest`**

Lies frisch `function updateSectorPanel` (Grep `function updateSectorPanel`). Ersetze die zwei Kopfzeilen + die `best`-Quelle:

```js
function updateSectorPanel() {
  const s = state.sectors;          // Konfiguration (global)
  const sl = state.sectorsLive;     // Live-Sektorzeiten (pro Kart)
  const has = s.boundaries[0] || s.boundaries[1];
```

durch:

```js
function updateSectorPanel() {
  const s = state.sectors;          // Konfiguration (global)
  const sl = state.sectorsLive;     // Live-Sektorzeiten (aktiver Kart, Fassade)
  const sb = state.sectorsBest || [null, null, null];  // Sektor-Bests aktiver Kart
  const has = s.boundaries[0] || s.boundaries[1];
```

Dann im selben `updateSectorPanel` die Best-Quelle. Lies frisch und ersetze:

```js
    const best = s.best[i];
```

durch:

```js
    const best = sb[i];
```

- [ ] **Step 3: `syncSectorBestToTrack` leitet Rekord aus allen Karts ab**

Lies frisch `function syncSectorBestToTrack` (Grep `function syncSectorBestToTrack`). Ersetze:

```js
function syncSectorBestToTrack() {
  const t = state.savedTracks.find(x => x.id === state.activeTrackId);
  if (t) t.sectorBest = [...state.sectors.best];
}
```

durch:

```js
function syncSectorBestToTrack() {
  // Phase 30: Strecken-Rekord = bestes Ergebnis ueber alle Karts (min je Sektor).
  const t = state.savedTracks.find(x => x.id === state.activeTrackId);
  if (!t) return;
  const bests = state.karts.macs().map(mac => state.karts.get(mac).sectorsBest || [null, null, null]);
  t.sectorBest = RasiLapEngine.trackRecordFromKarts(bests);
}
```

- [ ] **Step 4: `loadSavedTrack` setzt aktiven Kart-`sectorsBest`**

Lies frisch um die `sectors.best`-Zeile in `loadSavedTrack` (Grep `state.sectors.best = Array.isArray\(t.sectorBest\)`). Ersetze:

```js
  // Sektor-Bests (und damit die theoretische Bestrunde) gelten pro Strecke
  state.sectors.best = Array.isArray(t.sectorBest) ? [...t.sectorBest] : [null, null, null];
```

durch:

```js
  // Phase 30: Strecken-Rekord in den aktiven Kart laden (Per-Kart-Sektor-Bests).
  state.sectorsBest = Array.isArray(t.sectorBest) ? [...t.sectorBest] : [null, null, null];
```

- [ ] **Step 5: Verify**

Run: `node --check track.js` → OK.
Run: `npx eslint track.js` → 0 Fehler.
Run: `node --test` → grün (140).
Grep `track.js` für `function checkSectorCrossings\(k, lat, lon\)`, `k.sectorsBest`, `trackRecordFromKarts`, `state.sectorsBest` → vorhanden.

- [ ] **Step 6: Commit**

```bash
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" add track.js
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" commit -m "feat(multikart-laps): per-kart sector detection + track record from all karts

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 8: `rasicross.js` `processTelemetry` — Per-Kart-Erkennung + Lazy-Join

**Files:**
- Modify: `rasicross.js` (`processTelemetry` Lap-/Sektor-Block ~847–879; Kart-Auflösung ~712–714)

**Interfaces:**
- Consumes: `checkLapCrossing(k, mac, lat, lon)` (Task 6), `checkSectorCrossings(k, lat, lon)` (Task 7), `RasiLapEngine.getOrCreatePart`, `activeRace()`.
- Produces: laufende Per-Kart-Rundenerkennung; Nachzügler-Lazy-Join.

- [ ] **Step 1: Lazy-Join neuer Karts ins laufende Rennen**

Lies frisch um die Kart-Auflösung (Grep `const k = kartFor\(_mac\);`). Ersetze:

```js
    const k = kartFor(_mac);
    if (!k) { rcToast('Max. ' + KartRegistry.MAX_KARTS + ' Karts — ' + _mac + ' ignoriert', 4000); return; }
    const isActive = (k === activeKart());
```

durch:

```js
    const k = kartFor(_mac);
    if (!k) { rcToast('Max. ' + KartRegistry.MAX_KARTS + ' Karts — ' + _mac + ' ignoriert', 4000); return; }
    const isActive = (k === activeKart());
    // Phase 30: Nachzuegler — sendet ein Kart waehrend eines laufenden Rennens
    // erstmals und ist noch kein Teilnehmer, lege seinen Slot an (armiert bei
    // erster Linie, da k.lapStart noch null ist).
    {
      const _r = activeRace();
      if (_r && _r.status === 'running' && !(_r.participants && _r.participants[_mac])) {
        RasiLapEngine.getOrCreatePart(_r, _mac, _r.currentDriverId, null);
      }
    }
```

- [ ] **Step 2: Lap-/Sektor-Erkennung pro Kart (kein `isActive`-Gate mehr)**

Lies frisch den Lap-Block (Grep `// Lap-/Sektorerkennung \+ Renn-Trace nutzen die aktive-Kart-Proxy-Helfer`). Ersetze:

```js
    // Lap-/Sektorerkennung + Renn-Trace nutzen die aktive-Kart-Proxy-Helfer
    // (state.lapStart/autoLap). Nur fuer den aktiven Kart ausfuehren, damit
    // Hintergrund-Karts den Lap-Zustand des sichtbaren Karts nicht verfaelschen.
    if (isActive) {
      // Lap detection (only if track has start gate)
      if (lat && lon && state.startGate.enabled && state.lapStart) {
        checkLapCrossing(lat, lon);
        checkSectorCrossings(lat, lon);
      }
      // Update prev for direction check
      if (lat && lon) {
        state.autoLap.prevLat = lat;
        state.autoLap.prevLon = lon;
      }
      // Race speed trace (downsampled)
      const r = activeRace();
      if (r && r.status === 'running') {
        r.speedTrace = r.speedTrace || [];
        if (k.connection.packets % 5 === 0) {
          r.speedTrace.push({ t: Date.now() - (r.startedAt || Date.now()), speed, rpm });
          if (r.speedTrace.length > 4000) r.speedTrace.shift();
        }
      }
    } else if (lat && lon) {
      // Hintergrund-Kart: nur eigenen Vorgaenger-GPS-Punkt pflegen.
      k.autoLap.prevLat = lat;
      k.autoLap.prevLon = lon;
    }
```

durch:

```js
    // Phase 30: Lap-/Sektorerkennung laeuft PRO KART (k/mac explizit), nicht mehr
    // nur fuer den aktiven. Geometrie (startGate/boundaries) ist geteilt.
    const _r = activeRace();
    const _isPart = !!(_r && _r.status === 'running' && _r.participants && _r.participants[_mac]);
    if (_isPart && lat && lon && state.startGate.enabled) {
      // Erste Durchfahrt armiert (k.lapStart==null -> checkLapCrossing setzt sie
      // via triggerLap auf now, ohne Runde zu zaehlen). checkLapCrossing/-Sectors
      // pruefen k.lapStart selbst.
      checkLapCrossing(k, _mac, lat, lon);
      checkSectorCrossings(k, lat, lon);
      // Armierung: solange noch keine Runde laeuft, erste gueltige Linie startet
      // die Uhr. triggerLap handhabt das (k.lapStart null -> nur Start-Zweig).
    }
    // Vorgaenger-GPS-Punkt dieses Karts immer pflegen (Richtungscheck).
    if (lat && lon) {
      k.autoLap.prevLat = lat;
      k.autoLap.prevLon = lon;
    }
    // Renn-Speed-Trace pro Teilnehmer (downsampled).
    if (_isPart) {
      const part = _r.participants[_mac];
      part.speedTrace = part.speedTrace || [];
      if (k.connection.packets % 5 === 0) {
        part.speedTrace.push({ t: Date.now() - (_r.startedAt || Date.now()), speed, rpm });
        if (part.speedTrace.length > 4000) part.speedTrace.shift();
      }
    }
```

> **Armierungs-Hinweis für den Implementierer:** `triggerLap(k, mac)` zählt nur dann eine Runde, wenn `k.lapStart` gesetzt ist; im Start-Zweig setzt es `k.lapStart = now`. Beim Rennstart (Task 5) wurde `k.lapStart = null` gesetzt. Die **erste** Linien-Durchfahrt ruft `checkLapCrossing` → `triggerLap` auf: `k.lapStart` ist `null` → kein Lap-Commit, nur `k.lapStart = now` (Armierung). Die **zweite** Durchfahrt committet Runde 1. Das ist exakt das gewünschte Rolling-Start-Verhalten — keine Zusatzlogik nötig.

- [ ] **Step 3: Verify**

Run: `node --check rasicross.js` → OK.
Run: `npx eslint rasicross.js` → 0 Fehler.
Run: `node --test` → grün (140).
Grep `rasicross.js` für `checkLapCrossing(k, _mac`, `checkSectorCrossings(k, lat`, `_isPart`, `part.speedTrace` → vorhanden. Grep für `if (isActive) {` im Lap-Kontext → **nicht mehr** vorhanden (alte Stelle ersetzt).

- [ ] **Step 4: Commit**

```bash
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" add rasicross.js
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" commit -m "feat(multikart-laps): per-kart lap/sector detection in processTelemetry + lazy join

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 9: UI — `kart-overview.js`, `pit-wall.js`, `live-ui.js`

**Files:**
- Modify: `kart-overview.js` (`render` Karten-Template ~199–206)
- Modify: `pit-wall.js` (`updatePitWall` Lapcount ~50–52)
- Modify: `live-ui.js` (`renderStints` ~404)

**Interfaces:**
- Consumes: `RasiLapEngine.{getOrCreatePart,partValidLaps,participantsOf}`, `activeRace()`, `state.activeKartMac`.

- [ ] **Step 1: `kart-overview.js` — Rundenzähler je Karte**

Lies frisch die Karten-Template-Zeile mit `lapBest` (Grep `const lapBest = lap\(k.bestLapMs\);`). Ersetze:

```js
      const lapBest = lap(k.bestLapMs);
      const bestNum = k.bestLapNum ? ('Bestrunde · Runde ' + k.bestLapNum) : 'Noch keine Rundenzeit';
```

durch:

```js
      const lapBest = lap(k.bestLapMs);
      // Phase 30: Rundenzahl dieses Karts im aktiven Rennen (Teilnehmer-Slot).
      const _r = (typeof activeRace === 'function') ? activeRace() : null;
      const _part = (_r && _r.participants) ? _r.participants[mac] : null;
      const lapCount = _part ? RasiLapEngine.partValidLaps(_part).length : 0;
      const bestNum = k.bestLapNum
        ? ('Runde ' + lapCount + ' · Best R' + k.bestLapNum)
        : (lapCount ? ('Runde ' + lapCount) : 'Noch keine Rundenzeit');
```

> `activeRace` und `RasiLapEngine` müssen im `kart-overview.js`-ESLint-Block deklariert sein. Lies frisch den `kart-overview.js`-Block in `eslint.config.js` (Grep `files: \['kart-overview.js'\]`) und ergänze in dessen globals `...racesGlobals, ...lapEngineGlobals` — ersetze die globals-Zeile:

```js
      globals: { ...globals.browser, ...geoGlobals, ...appCoreGlobals,
                 ...kartRegistryGlobals, ...kartBarGlobals,
                 setLiveView: 'readonly' },
```

durch:

```js
      globals: { ...globals.browser, ...geoGlobals, ...appCoreGlobals,
                 ...kartRegistryGlobals, ...kartBarGlobals, ...racesGlobals,
                 ...lapEngineGlobals, setLiveView: 'readonly' },
```

- [ ] **Step 2: `pit-wall.js` — Rundenzahl des aktiven Karts**

Lies frisch `updatePitWall` um `const validLaps = r ? raceValidLaps(r).length : 0;` (Grep `const validLaps = r \? raceValidLaps\(r\).length : 0;`). Ersetze:

```js
  const r = activeRace();
  const validLaps = r ? raceValidLaps(r).length : 0;
```

durch:

```js
  const r = activeRace();
  // Phase 30: Pit-Wall zeigt Runden des aktiven Karts (Teilnehmer-Slot).
  const _pwPart = r ? RasiLapEngine.getOrCreatePart(r, state.activeKartMac || KartRegistry.DEFAULT_MAC, r.startDriverId, r.startedAt || Date.now()) : null;
  const validLaps = _pwPart ? RasiLapEngine.partValidLaps(_pwPart).length : 0;
```

> Ergänze `RasiLapEngine`/`KartRegistry` im `pit-wall.js`-ESLint-Block. Lies frisch (Grep `files: \['pit-wall.js'\]`) und ersetze dessen globals-Zeile:

```js
      globals: { ...globals.browser, ...geoGlobals, ...appCoreGlobals,
                 ...racesGlobals, ...lapsDriversGlobals, ...liveUiGlobals,
                 ...kartBarGlobals },
```

durch:

```js
      globals: { ...globals.browser, ...geoGlobals, ...appCoreGlobals,
                 ...racesGlobals, ...lapsDriversGlobals, ...liveUiGlobals,
                 ...kartBarGlobals, ...kartRegistryGlobals, ...lapEngineGlobals },
```

- [ ] **Step 3: `live-ui.js` — `renderStints` über aktiven Teilnehmer**

Lies frisch `function renderStints` (Grep `function renderStints`). Lies die Funktion vollständig in-session und ersetze jede Referenz auf `r.stints` durch die Stints des aktiven Teilnehmers. Konkret die Quelle der Stint-Liste:

```js
function renderStints(r) {
```

direkt darunter (erste Verwendung von `r.stints`) den Zugriff auf die Stint-Liste durch eine lokale Variable ersetzen. Füge **direkt nach** der Funktions-Öffnungszeile `function renderStints(r) {` ein:

```js
  // Phase 30: Stints des aktiven Karts (Teilnehmer-Slot).
  const _sp = (r && typeof activePart === 'function') ? activePart(r) : null;
  const _stints = _sp ? _sp.stints : (r && r.stints) || [];
```

und ersetze danach im Funktionskörper die Vorkommen von `r.stints` durch `_stints`. (Lies die Funktion frisch; typischerweise `(r.stints || [])` → `(_stints || [])` und `r.stints.length` → `_stints.length`.)

> `activePart` ist in `races.js` definiert (Task 5, Step 1). Ergänze es im `live-ui.js`-ESLint-Block + `racesGlobals` deckt es nicht ab → füge `activePart: 'readonly'` hinzu. Lies frisch den `live-ui.js`-Block (Grep `files: \['live-ui.js'\]`) und ergänze in dessen globals `activePart: 'readonly', ...lapEngineGlobals`. Außerdem `activePart` zu `racesGlobals` aufnehmen wäre sauberer — ergänze in `racesGlobals` (Grep `renderTrackOptions: 'readonly', updateRaceControls: 'readonly',`) die Zeile davor um `activePart: 'readonly',`:

```js
  drawRaceHistoryChart: 'readonly', renderRaces: 'readonly',
  renderTrackOptions: 'readonly', updateRaceControls: 'readonly',
```

ersetzen durch:

```js
  drawRaceHistoryChart: 'readonly', renderRaces: 'readonly',
  renderTrackOptions: 'readonly', updateRaceControls: 'readonly',
  activePart: 'readonly',
```

Und in `races.js` `activePart` als exportierte Funktion am Interface-Marker führen — lies frisch den `void [...]`-Marker in `races.js` (Grep `void \[activeRace, currentStint, raceValidLaps`) und ergänze `activePart,` in der Liste.

- [ ] **Step 4: Verify**

Run: `node --check kart-overview.js pit-wall.js live-ui.js` → OK.
Run: `npx eslint kart-overview.js pit-wall.js live-ui.js races.js eslint.config.js` → 0 Fehler.
Run: `node --test` → grün (140).
Grep `kart-overview.js` für `partValidLaps`; `pit-wall.js` für `_pwPart`; `live-ui.js` für `_stints` → vorhanden.

- [ ] **Step 5: Commit**

```bash
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" add kart-overview.js pit-wall.js live-ui.js races.js eslint.config.js
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" commit -m "feat(multikart-laps): per-kart lap counts in overview/pit-wall/stints

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 10: Finale Verifikation + Plan-Doc

**Files:**
- Modify: (nur Verifikation; Plan-Doc-Commit)

- [ ] **Step 1: Voll-Verifikation (alles grün)**
  - `node --check lap-engine.js kart-registry.js rasicross.js races.js laps-drivers.js track.js pit-wall.js kart-overview.js live-ui.js`
  - `npx eslint lap-engine.js kart-registry.js rasicross.js races.js laps-drivers.js track.js pit-wall.js kart-overview.js live-ui.js eslint.config.js` → 0 Fehler
  - `node --test` → **140 PASS**, 0 fail (127 alt + 13 lap-engine)
  - `python -m py_compile bridge.py` → kein Fehler (unverändert)
  - `python -m unittest discover -s test -p "test_*.py"` → **50 OK** (unverändert)
  - `__pycache__` löschen, dann `git status` → sauber bis auf gewollte Dateien.

- [ ] **Step 2: Grep-Gesamtcheck**
  - `lap-engine.js`: `window.RasiLapEngine` (via Factory-Return), `commitLap`, `migrateRace`.
  - `kart-registry.js`: `sectorsBest: [null, null, null]`.
  - `rasicross.js`: `'sectorsBest'`, `RasiLapEngine.migrateRace`, `checkLapCrossing(k, _mac`.
  - `races.js`: `r.participants = {}`, `activePart`, `getOrCreatePart`.
  - `laps-drivers.js`: `function triggerLap(k, mac)`, `RasiLapEngine.commitLap`.
  - `track.js`: `function checkSectorCrossings(k, lat, lon)`, `trackRecordFromKarts`.
  - `package.json`: `"lap-engine.js"`; `RasiCross_Telemetry.html`: `src="lap-engine.js"`.

- [ ] **Step 3: Plan-Doc committen**

```bash
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" add docs/superpowers/plans/2026-06-24-30-multi-kart-per-kart-laps.md
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" commit -m "docs(plan): Phase 30 multi-kart per-kart laps + race engine implementation plan

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Manuelle Akzeptanz (an Nutzer — Hardware/zwei Karts)

1. **Rolling Start:** Rennen mit zwei verbundenen Karts starten → Übersicht zeigt für beide „--" bis zur ersten Linien-Durchfahrt, danach läuft je Kart die Rundenuhr.
2. **Per-Kart-Runden:** Jeder Kart zählt eigene Runden/Bestrunde im selben Rennen; Werte aktualisieren sich live im Übersicht-Grid (Rundenzahl + Bestrunde).
3. **Nachzügler:** Dritter Kart verbindet sich mitten im Rennen → erscheint als Teilnehmer, armiert bei erster Linie.
4. **Fahrerwechsel pro Kart:** Chip Kart A → „Fahrer wechseln" → neuer Stint nur für A; Chip Kart B → eigener Wechsel, unabhängig.
5. **Renn-Details:** Runden + Stints pro Kart gruppiert mit korrekter Bestzeit/Rundenzahl.
6. **Sektor-Bestzeit pro Kart:** Sektor-Panel zeigt Bests des aktiven Karts; Chip-Wechsel zeigt die des anderen Karts.
7. **Pause/Fortsetzen:** beide Rundenuhren laufen nahtlos weiter.
8. **Single-Kart-Regression:** mit einem Kart Rennen/Runden/Sektoren/Auto-Ende exakt wie vor Phase 30.
9. **Persistenz:** Alt-Rennen (vor Phase 30) öffnen korrekt; neues Multi-Kart-Rennen übersteht App-Neustart.

## Self-Review

- **Spec-Coverage:** §3.1 Teilnehmer-Modell → Task 1 (`migrateRace`/`getOrCreatePart`) + Task 5 (createRace/startRace). §3.2 Migration → Task 1 + Task 4 (loadData). §3.3 Lap-Engine pro Kart → Task 6 (`checkLapCrossing`/`triggerLap`) + Task 8 (processTelemetry); Sektor-Best pro Kart → Task 2 (Feld) + Task 7 (`checkSectorCrossings`/`syncSectorBestToTrack`/`updateSectorPanel`) + Task 6 (S3 in triggerLap). §3.4 Lebenszyklus (rolling start/lazy join/Pause/Ende/Fahrerwechsel) → Task 5 + Task 8. §3.5 Auto-Ende nur Single-Teilnehmer → Task 6 (Step 2). §3.6 UI → Task 5 (Details) + Task 9 (overview/pit-wall/stints). §6 Tests → Task 1. §7 Dateien → File-Structure-Tabelle. Build/Bundling/ESLint (Global Constraints) → Task 3.
- **Placeholder-Scan:** Jeder Code-Schritt zeigt vollständigen Code; keine TBD/TODO. Die zwei „lies die Funktion frisch und ersetze Vorkommen"-Hinweise (renderLapTable r.laps→_p.laps; renderStints r.stints→_stints) sind durch explizite Vorher/Nachher-Blöcke konkretisiert.
- **Typ-/Namens-Konsistenz:** `RasiLapEngine.getOrCreatePart(r, mac, driverId, now)` / `commitLap(part, opts)` / `participantsOf` / `flatLaps` / `flatValidLaps` / `flatStints` / `partValidLaps` / `sectorBestUpdate` / `trackRecordFromKarts` — in Task 1 definiert, in Tasks 4–9 identisch verwendet. `checkLapCrossing(k, mac, lat, lon)` (Task 6 def, Task 8 call), `triggerLap(k, mac)` (Task 6 def, Task 6/8 call), `checkSectorCrossings(k, lat, lon)` (Task 7 def, Task 8 call), `activePart(r)` (Task 5 def, Task 9 call), `k.sectorsBest` (Task 2 Feld, Task 6/7 Nutzung), Fassade `state.sectorsBest` (Task 4, Task 6/7 Nutzung).

## Phase Map

- **Phase 28/28b/29:** Per-Kart-Pipeline, Dashboard-Verwaltung, Live-Seiten + Übersicht-Grid.
- **Phase 30 (dieser Plan):** Ein Rennen / mehrere Karts — Per-Kart-Runden/Bestrunde/Sektor-Best/Stints, rolling start, Migration, minimale UI.
- **Phase 31 (deferred):** Leaderboard + Positions-Ranking, Multi-Kart-Auto-Ende bei Zielrunden, Live-Position, synchrones Multi-Kart-Replay.
