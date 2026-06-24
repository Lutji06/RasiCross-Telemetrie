# Phase 31 — Multi-Kart Leaderboard + Positions-Ranking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Jeder Teilnehmer-Kart bekommt im laufenden Rennen eine Live-Position (P1, P2, …); das Übersicht-Grid wird nach Position sortiert und zeigt den Abstand zum Führenden, Lap-Rennen enden automatisch sobald der Führende die Zielrundenzahl erreicht, und „Verbleibend" zählt die Rest-Runden des Führenden.

**Architecture:** Die Ranking-Logik wird als reine, dependency-freie Funktion `rankParticipants` (+ `leaderReachedTarget`) in das bestehende UMD-Modul `lap-engine.js` aufgenommen und per `node:test` TDD'd. Die DOM-Konsumenten (`kart-overview.js` sortiert/badged das Grid; `laps-drivers.js` Leader-Auto-Ende; `live-ui.js` Runden-bis-Ziel) nutzen diese Funktion bzw. eine triviale Leader-Runden-Ableitung.

**Tech Stack:** Vanilla JS (Browser-Globals / UMD-IIFE), `node:test`, ESLint 9 (Flat-Config), Electron-Builder. Verifikation: `node --check`, `node --test`, `eslint`, Python-Baselines (`py_compile`/`unittest`).

**Spec:** `docs/superpowers/specs/2026-06-24-multi-kart-leaderboard-design.md`

## Global Constraints

- Repo-Root: `C:/Users/jimlu/Documents/RasiCross-Telemetrie-git`. Branch: `feat/multi-kart-support` (Folge auf Phase 30).
- **Dateien sind CRLF.** Unmittelbar vor jedem `Edit` die Zielstelle frisch in-session lesen und den Anker aus diesem Read kopieren — Zeilennummern hier sind indikativ, auf Text ankern.
- Verifikation mit dem **Grep-Tool** (nicht Shell-`grep`).
- **Niemals `.claude/` committen**, Plan-/Spec-Doc nur im expliziten Doc-Commit (Task 5).
- Commit-Messages: conventional + kurzer Body + Trailer `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- `__pycache__` vor jedem `git status`/commit löschen.
- **Verhalten unverändert für Single-Kart / <2 Teilnehmer:** Grid ohne Badge/Gap, Auto-Ende + Runden-bis-Ziel exakt wie vor Phase 31 (Regression).
- **Ranking ist rein/abgeleitet:** keine Persistenz neuer Felder; Position wird pro Render aus `participants` + `k.lapStart` berechnet.
- **`pit-wall.js`, `package.json`, der `<script src="lap-engine.js">`-Include bleiben unverändert.**
- ESLint: `rankParticipants`/`leaderReachedTarget` sind Methoden des bestehenden `RasiLapEngine`-Globals → **keine** neue Global-Deklaration nötig (in Konsumenten-Blöcken ist `RasiLapEngine` seit Phase 30 vorhanden).
- **Verifikationsrezept (pro Task wo relevant + final):**
  - `node --check <berührte .js>`
  - `node --test` (muss grün bleiben/wachsen; aktuell **140** + neue `rankParticipants`-Tests = **147**)
  - `npx eslint <berührte .js>` → 0 Fehler
  - `python -m py_compile bridge.py` + `python -m unittest discover -s test -p "test_*.py"` → **50 OK** (Python unverändert)
  - Python kann `python` oder `py -3` sein.

---

## File Structure

| Aktion | Datei | Verantwortung |
|--------|-------|---------------|
| Ändern | `lap-engine.js` | Neue Pure-Funktionen `rankParticipants(race, lastCrossingByMac)` + `leaderReachedTarget(ranked, targetLaps)`; im UMD-Return exportieren. |
| Ändern | `test/lap-engine.test.js` | `node:test`-Fälle für Ranking + Leader-Ziel; Export-Liste erweitern. |
| Ändern | `kart-overview.js` | Grid nach Position sortieren; `P{pos}`-Badge + Gap-Zeile bei ≥2 Teilnehmern; sonst unverändert. |
| Ändern | `RasiCross_Telemetry.html` | CSS `.ko-pos` + `.ko-gap` im `kart-overview`-Kartenstil. |
| Ändern | `laps-drivers.js` | `triggerLap`: `participants <= 1`-Beschränkung beim Lap-Auto-Ende entfernen. |
| Ändern | `live-ui.js` | „Verbleibend" (Lap-Rennen) = `targetLaps − leaderLaps` statt Summe `raceValidLaps`. |

**Task-Reihenfolge:** 1 (lap-engine `rankParticipants` + Tests) → 2 (kart-overview Grid + CSS) → 3 (laps-drivers Leader-Auto-Ende) → 4 (live-ui Runden-bis-Ziel) → 5 (finale Verifikation + Plan-Doc).

> **Verifikationsstrategie:** Die Ranking-/Leader-Logik wird in `lap-engine.js` per `node:test` TDD'd. DOM-Verdrahtung: `node --check` + ESLint + Grep-Asserts + grüne Baselines. Funktionales Zwei-Kart-Verhalten bleibt manuell (Hardware, §7 Spec).

---

## Task 1: `lap-engine.js` — `rankParticipants` + `leaderReachedTarget` (Pure-Logik, TDD)

**Files:**
- Modify: `lap-engine.js` (neue Funktionen vor dem `return {…}`-Block ~Zeile 130–132; Export-Einträge im Return ~Zeile 132–144)
- Modify: `test/lap-engine.test.js` (Export-Liste ~Zeile 7–9; neue Tests am Dateiende)

**Interfaces:**
- Consumes: `participantsOf(race)`, `partValidLaps(part)` (beide bereits in `lap-engine.js`).
- Produces (von Tasks 2/3/4 konsumiert), auf `window.RasiLapEngine`:
  - `rankParticipants(race, lastCrossingByMac)` → sortiertes `Array` von `{ mac, pos, laps, lapGap, timeGapMs }`. `pos` 1-basiert, `pos:1` = Führender. Leeres `participants` → `[]`.
  - `leaderReachedTarget(ranked, targetLaps)` → `boolean` (`ranked[0].laps >= targetLaps`).

- [ ] **Step 1: Export-Liste im Test erweitern (failing)**

Lies `test/lap-engine.test.js` frisch um die Export-Liste (Grep `'commitLap','sectorBestUpdate','trackRecordFromKarts'`). Ersetze:

```js
  for (const name of ['migrateRace','participantsOf','getOrCreatePart','flatLaps',
                      'flatValidLaps','flatStints','partValidLaps','bestFromLaps',
                      'commitLap','sectorBestUpdate','trackRecordFromKarts']) {
```

durch:

```js
  for (const name of ['migrateRace','participantsOf','getOrCreatePart','flatLaps',
                      'flatValidLaps','flatStints','partValidLaps','bestFromLaps',
                      'commitLap','sectorBestUpdate','trackRecordFromKarts',
                      'rankParticipants','leaderReachedTarget']) {
```

- [ ] **Step 2: Neue Tests ans Dateiende anhängen (failing)**

Lies das Ende von `test/lap-engine.test.js` frisch (Grep `flatStints merges all participant stints`) und füge **nach** dem letzten `test(...)`-Block (am Dateiende) ein:

```js

test('rankParticipants orders by valid laps desc with positions', () => {
  const r = { participants: {
    AA: { mac: 'AA', laps: [{ valid: true }, { valid: true }] },
    BB: { mac: 'BB', laps: [{ valid: true }, { valid: true }, { valid: true }] },
  } };
  const ranked = E.rankParticipants(r, { AA: 1000, BB: 1200 });
  assert.equal(ranked[0].mac, 'BB');
  assert.equal(ranked[0].pos, 1);
  assert.equal(ranked[0].laps, 3);
  assert.equal(ranked[1].mac, 'AA');
  assert.equal(ranked[1].pos, 2);
  assert.equal(ranked[1].lapGap, 1);
});

test('rankParticipants tiebreak: earliest last crossing leads on equal laps', () => {
  const r = { participants: {
    AA: { mac: 'AA', laps: [{ valid: true }, { valid: true }] },
    BB: { mac: 'BB', laps: [{ valid: true }, { valid: true }] },
  } };
  const ranked = E.rankParticipants(r, { AA: 5200, BB: 5000 });
  assert.equal(ranked[0].mac, 'BB');
  assert.equal(ranked[0].timeGapMs, 0);
  assert.equal(ranked[1].mac, 'AA');
  assert.equal(ranked[1].lapGap, 0);
  assert.equal(ranked[1].timeGapMs, 200);
});

test('rankParticipants unarmed karts sort last, stable order', () => {
  const r = { participants: {
    AA: { mac: 'AA', laps: [] },
    BB: { mac: 'BB', laps: [{ valid: true }] },
    CC: { mac: 'CC', laps: [] },
  } };
  const ranked = E.rankParticipants(r, { BB: 3000 });
  assert.equal(ranked[0].mac, 'BB');
  assert.equal(ranked[1].mac, 'AA');
  assert.equal(ranked[2].mac, 'CC');
});

test('rankParticipants armed-with-zero-laps beats never-crossed', () => {
  const r = { participants: {
    AA: { mac: 'AA', laps: [] },
    BB: { mac: 'BB', laps: [] },
  } };
  const ranked = E.rankParticipants(r, { AA: 8000 });
  assert.equal(ranked[0].mac, 'AA');
  assert.equal(ranked[1].mac, 'BB');
});

test('rankParticipants lapped kart shows lap gap, not time gap', () => {
  const r = { participants: {
    AA: { mac: 'AA', laps: [{ valid: true }, { valid: true }, { valid: true }] },
    BB: { mac: 'BB', laps: [{ valid: true }] },
  } };
  const ranked = E.rankParticipants(r, { AA: 1000, BB: 1500 });
  assert.equal(ranked[0].mac, 'AA');
  assert.equal(ranked[1].lapGap, 2);
  assert.equal(ranked[1].timeGapMs, 0);
});

test('rankParticipants empty participants returns []', () => {
  assert.deepEqual(E.rankParticipants({ participants: {} }, {}), []);
});

test('leaderReachedTarget true once leader reaches target laps', () => {
  const ranked = [{ mac: 'AA', pos: 1, laps: 5 }, { mac: 'BB', pos: 2, laps: 3 }];
  assert.equal(E.leaderReachedTarget(ranked, 5), true);
  assert.equal(E.leaderReachedTarget(ranked, 6), false);
  assert.equal(E.leaderReachedTarget([], 5), false);
});
```

- [ ] **Step 3: Tests laufen lassen — müssen fehlschlagen**

Run: `node --test test/lap-engine.test.js`
Expected: FAIL (`rankParticipants` / `leaderReachedTarget` sind nicht definiert).

- [ ] **Step 4: Funktionen in `lap-engine.js` implementieren**

Lies `lap-engine.js` frisch um `function trackRecordFromKarts` (Grep `function trackRecordFromKarts`). Füge **direkt nach** dem Ende dieser Funktion (nach ihrer schließenden `}` und vor `return {`) ein:

```js

  // Phase 31: Live-Positions-Ranking. lastCrossingByMac[mac] = k.lapStart
  // (Zeitstempel der letzten Linien-Durchfahrt; null/undefined = unarmiert).
  // Sortierung: gueltige Runden absteigend, Tiebreak frueheste Durchfahrt,
  // unarmierte Karts stabil ans Ende.
  function rankParticipants(race, lastCrossingByMac) {
    var ps = participantsOf(race), cross = lastCrossingByMac || {};
    var list = [];
    for (var i = 0; i < ps.length; i++) {
      var p = ps[i];
      var c = cross[p.mac];
      list.push({
        mac: p.mac,
        idx: i,
        laps: partValidLaps(p).length,
        cross: (c != null ? c : null),
      });
    }
    list.sort(function (a, b) {
      var aArmed = a.cross != null, bArmed = b.cross != null;
      if (aArmed !== bArmed) return aArmed ? -1 : 1;   // armierte zuerst
      if (!aArmed) return a.idx - b.idx;               // beide unarmiert: stabil
      if (a.laps !== b.laps) return b.laps - a.laps;   // mehr Runden zuerst
      return a.cross - b.cross;                         // frueher ueberquert zuerst
    });
    var leaderLaps = list.length ? list[0].laps : 0;
    var leaderCross = list.length ? list[0].cross : null;
    var out = [];
    for (var j = 0; j < list.length; j++) {
      var e = list[j];
      var lapGap = leaderLaps - e.laps;
      var timeGapMs = 0;
      if (j > 0 && lapGap === 0 && e.cross != null && leaderCross != null) {
        timeGapMs = e.cross - leaderCross;
      }
      out.push({ mac: e.mac, pos: j + 1, laps: e.laps, lapGap: lapGap, timeGapMs: timeGapMs });
    }
    return out;
  }

  function leaderReachedTarget(ranked, targetLaps) {
    return !!(ranked && ranked.length && ranked[0].laps >= targetLaps);
  }
```

- [ ] **Step 5: Funktionen exportieren**

Lies den Return-Block frisch (Grep `trackRecordFromKarts: trackRecordFromKarts,`). Ersetze:

```js
    sectorBestUpdate: sectorBestUpdate,
    trackRecordFromKarts: trackRecordFromKarts,
  };
```

durch:

```js
    sectorBestUpdate: sectorBestUpdate,
    trackRecordFromKarts: trackRecordFromKarts,
    rankParticipants: rankParticipants,
    leaderReachedTarget: leaderReachedTarget,
  };
```

- [ ] **Step 6: Tests laufen lassen — müssen bestehen**

Run: `node --test test/lap-engine.test.js`
Expected: PASS (alle neuen Tests grün).

- [ ] **Step 7: Voll-Suite + Lint**

Run: `node --check lap-engine.js` → OK.
Run: `npx eslint lap-engine.js test/lap-engine.test.js` → 0 Fehler.
Run: `node --test` → vorher 140, jetzt **147** PASS, 0 fail.

- [ ] **Step 8: Commit**

```bash
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" add lap-engine.js test/lap-engine.test.js
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" commit -m "feat(multikart-leaderboard): rankParticipants + leaderReachedTarget engine + tests

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: `kart-overview.js` — sortiertes Grid + Positions-Badge + Gap

**Files:**
- Modify: `kart-overview.js` (`render` komplett ~Zeile 22–63; neue Helfer davor)
- Modify: `RasiCross_Telemetry.html` (CSS nach `.ko-card .ko-sub` ~Zeile 1469)

**Interfaces:**
- Consumes: `RasiLapEngine.{participantsOf,partValidLaps,rankParticipants}` (Task 1), `activeRace()`, `state.karts` (`.macs()`, `.get()`, `.has()`, `.setActive()`), `state.activeKartMac`, `RasiKartBar.metaFor`, `lap()`, `esc()`.
- Produces: Übersicht-Grid in Positions-Reihenfolge mit `P{pos}`-Badge + Gap (nur bei ≥2 Teilnehmern eines laufenden Rennens).

- [ ] **Step 1: `render` ersetzen (Helfer + Sortierung + Badge/Gap)**

Lies `kart-overview.js` frisch (Grep `function render\(state\) \{`). Ersetze die **komplette** `render`-Funktion (von `function render(state) {` bis zur schließenden `}` direkt vor `window.RasiKartOverview = { render };`) durch:

```js
  // Phase 31: Linien-Durchfahrt-Zeitstempel je Teilnehmer fuer das Ranking.
  function buildCrossings(state, r) {
    const out = {};
    RasiLapEngine.participantsOf(r).forEach(p => {
      const kk = state.karts.has(p.mac) ? state.karts.get(p.mac) : null;
      out[p.mac] = kk ? kk.lapStart : null;
    });
    return out;
  }

  // Phase 31: Gap-Text — Fuehrender "Leader", gleiche Runde "+x.xs",
  // ueberrundet "+N Runde(n)".
  function fmtGap(e) {
    if (!e || e.pos === 1) return 'Leader';
    if (e.lapGap > 0) return '+' + e.lapGap + (e.lapGap === 1 ? ' Runde' : ' Runden');
    return '+' + (e.timeGapMs / 1000).toFixed(1) + 's';
  }

  function render(state) {
    const el = document.getElementById('liveOverview');
    if (!el) return;
    const macs = state.karts.macs();
    const now = Date.now();
    // Phase 31: Positions-Ranking nur bei laufendem Rennen mit >=2 Teilnehmern.
    const r = (typeof activeRace === 'function') ? activeRace() : null;
    const ranking = (r && r.status === 'running'
                     && RasiLapEngine.participantsOf(r).length >= 2)
      ? RasiLapEngine.rankParticipants(r, buildCrossings(state, r))
      : null;
    const posByMac = {};
    let orderedMacs = macs;
    if (ranking) {
      ranking.forEach(e => { posByMac[e.mac] = e; });
      orderedMacs = ranking.map(e => e.mac).filter(m => macs.includes(m))
        .concat(macs.filter(m => !(m in posByMac)));
    }
    el.innerHTML = orderedMacs.map(mac => {
      const k = state.karts.get(mac);
      if (!k) return '';
      const origIdx = macs.indexOf(mac);
      const m = window.RasiKartBar ? RasiKartBar.metaFor(state, mac, origIdx) : { name: mac, color: '#3aa0e8' };
      const age = k.connection.lastPacketAt ? (now - k.connection.lastPacketAt) : 99999;
      const stale = age > 2000;
      const speed = (k.telemetry.speed || 0).toFixed(0);
      const lapCur = k.lapStart ? lap(now - k.lapStart) : '--:--.---';
      const lapBest = lap(k.bestLapMs);
      // Phase 30: Rundenzahl dieses Karts im aktiven Rennen (Teilnehmer-Slot).
      const _part = (r && r.participants) ? r.participants[mac] : null;
      const lapCount = _part ? RasiLapEngine.partValidLaps(_part).length : 0;
      const bestNum = k.bestLapNum
        ? ('Runde ' + lapCount + ' · Best R' + k.bestLapNum)
        : (lapCount ? ('Runde ' + lapCount) : 'Noch keine Rundenzeit');
      const rec = k.recording.armed ? '<span class="ko-rec">●REC</span>' : '';
      // Phase 31: Positions-Badge + Gap (nur wenn Ranking aktiv).
      const pe = posByMac[mac];
      const posBadge = pe ? '<span class="ko-pos">P' + pe.pos + '</span>' : '';
      const gapRow = pe ? '<div class="ko-gap">' + fmtGap(pe) + '</div>' : '';
      const cls = 'ko-card' + (mac === state.activeKartMac ? ' active' : '') + (stale ? ' stale' : '');
      return '<div class="' + cls + '" data-mac="' + mac + '" style="border-color:' + m.color + '">'
        + '<div class="ko-head">' + posBadge + '<span class="ko-dot" style="background:' + m.color + '"></span>'
        +   '<span class="ko-name" style="color:' + m.color + '">' + esc(m.name) + '</span>' + rec + '</div>'
        + '<div class="ko-speed">' + speed + '<small>km/h</small></div>'
        + '<div class="ko-row"><span class="ko-l">Aktuelle Runde</span><span class="ko-v">' + lapCur + '</span></div>'
        + '<div class="ko-row"><span class="ko-l">Beste Runde</span><span class="ko-v">' + lapBest + '</span></div>'
        + '<div class="ko-sub">' + bestNum + '</div>' + gapRow
        + '</div>';
    }).join('');
    el.querySelectorAll('.ko-card').forEach(card => {
      card.onclick = () => {
        const mac = card.getAttribute('data-mac');
        if (state.karts.setActive(mac)) {
          state.activeKartMac = mac;
          if (window.setLiveView) window.setLiveView('single');
        }
      };
    });
  }
```

- [ ] **Step 2: CSS für Badge + Gap**

Lies `RasiCross_Telemetry.html` frisch um die Zeile `.ko-card .ko-sub{` (Grep `.ko-card .ko-sub\{`). Ersetze:

```css
.ko-card .ko-sub{font-size:11px;color:var(--mut)}
```

durch:

```css
.ko-card .ko-sub{font-size:11px;color:var(--mut)}
.ko-card .ko-pos{font-family:var(--mono);font-weight:800;font-size:13px;color:var(--tx);
  background:rgba(255,255,255,.08);border-radius:6px;padding:1px 6px;flex:0 0 auto}
.ko-card .ko-gap{font-family:var(--mono);font-size:11px;color:var(--mut)}
```

- [ ] **Step 3: Verify**

Run: `node --check kart-overview.js` → OK.
Run: `npx eslint kart-overview.js` → 0 Fehler.
Run: `node --test` → grün (147).
Grep `kart-overview.js` für `rankParticipants`, `buildCrossings`, `fmtGap`, `ko-pos` → vorhanden.
Grep `RasiCross_Telemetry.html` für `.ko-card .ko-pos\{` → vorhanden.

- [ ] **Step 4: Commit**

```bash
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" add kart-overview.js RasiCross_Telemetry.html
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" commit -m "feat(multikart-leaderboard): position-sorted overview grid with P-badge + gap

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: `laps-drivers.js` — Leader-Auto-Ende (Beschränkung entfernen)

**Files:**
- Modify: `laps-drivers.js` (`triggerLap` Auto-Ende-Block ~Zeile 78–83)

**Interfaces:**
- Consumes: `RasiLapEngine.partValidLaps(part)`, `endRace()`, `r.lengthType`, `r.targetLaps`.
- Produces: Auto-Ende, sobald **ein** Kart `targetLaps` erreicht (= Führender).

- [ ] **Step 1: `participants <= 1`-Beschränkung entfernen**

Lies `laps-drivers.js` frisch um den Auto-Ende-Block (Grep `Auto-Ende nur bei Single-Teilnehmer-Rennen`). Ersetze:

```js
      // Auto-Ende nur bei Single-Teilnehmer-Rennen (Multi-Kart -> Phase 31).
      if (r.lengthType === 'laps'
          && RasiLapEngine.participantsOf(r).length <= 1
          && RasiLapEngine.partValidLaps(part).length >= r.targetLaps) {
        endRace(true);
      }
```

durch:

```js
      // Phase 31: Auto-Ende, sobald EIN Kart targetLaps erreicht. Der erste Kart,
      // der das schafft, ist definitionsgemaess der Fuehrende (Leader-Auto-Ende).
      // Single-Kart-Rennen verhalten sich dabei exakt wie bisher.
      if (r.lengthType === 'laps'
          && RasiLapEngine.partValidLaps(part).length >= r.targetLaps) {
        endRace(true);
      }
```

- [ ] **Step 2: Verify**

Run: `node --check laps-drivers.js` → OK.
Run: `npx eslint laps-drivers.js` → 0 Fehler.
Run: `node --test` → grün (147).
Grep `laps-drivers.js` für `Leader-Auto-Ende` → vorhanden; für `participantsOf(r).length <= 1` → **nicht mehr** vorhanden.

- [ ] **Step 3: Commit**

```bash
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" add laps-drivers.js
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" commit -m "feat(multikart-leaderboard): leader-based auto-end at target laps (multi-kart)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: `live-ui.js` — „Verbleibend" = Rest-Runden des Führenden

**Files:**
- Modify: `live-ui.js` (Lap-Rennen-Countdown ~Zeile 379–382)

**Interfaces:**
- Consumes: `RasiLapEngine.{participantsOf,partValidLaps}`, `r.targetLaps`, `setText`.
- Produces: korrekter Rest-Runden-Countdown (Führender) statt Summe aller Karts.

> Der Führende hat per Definition die meisten gültigen Runden; `leaderLaps` ist daher das Maximum über alle Teilnehmer und braucht **keine** Durchfahrt-Zeitstempel — `rankParticipants` ist hier nicht nötig.

- [ ] **Step 1: Leader-Runden statt Summe**

Lies `live-ui.js` frisch um den Lap-Rennen-Zweig (Grep `const left = Math.max\(0, r.targetLaps - raceValidLaps\(r\).length\);`). Ersetze:

```js
      } else if (r.lengthType === 'laps') {
        const left = Math.max(0, r.targetLaps - raceValidLaps(r).length);
        setText('countdown', `${left} LAPS`);
      }
```

durch:

```js
      } else if (r.lengthType === 'laps') {
        // Phase 31: Rest-Runden des FUEHRENDEN (meiste gueltige Runden),
        // nicht die Summe aller Karts (raceValidLaps aggregiert seit Phase 30).
        const _leaderLaps = RasiLapEngine.participantsOf(r)
          .reduce((mx, p) => Math.max(mx, RasiLapEngine.partValidLaps(p).length), 0);
        const left = Math.max(0, r.targetLaps - _leaderLaps);
        setText('countdown', `${left} LAPS`);
      }
```

- [ ] **Step 2: Verify**

Run: `node --check live-ui.js` → OK.
Run: `npx eslint live-ui.js` → 0 Fehler (RasiLapEngine ist seit Phase 30 im `live-ui.js`-Block deklariert).
Run: `node --test` → grün (147).
Grep `live-ui.js` für `_leaderLaps` → vorhanden.

- [ ] **Step 3: Commit**

```bash
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" add live-ui.js
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" commit -m "feat(multikart-leaderboard): laps-remaining counts leader laps, not sum

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: Finale Verifikation + Plan-Doc

**Files:**
- Modify: (nur Verifikation; Plan-Doc-Commit)

- [ ] **Step 1: Voll-Verifikation (alles grün)**
  - `node --check lap-engine.js kart-overview.js laps-drivers.js live-ui.js`
  - `npx eslint lap-engine.js test/lap-engine.test.js kart-overview.js laps-drivers.js live-ui.js` → 0 Fehler
  - `node --test` → **147 PASS**, 0 fail (140 alt + 7 neue Ranking-Tests)
  - `python -m py_compile bridge.py` → kein Fehler (unverändert)
  - `python -m unittest discover -s test -p "test_*.py"` → **50 OK** (unverändert)
  - `__pycache__` löschen, dann `git status` → sauber bis auf `.claude/` und das Plan-Doc.

- [ ] **Step 2: Grep-Gesamtcheck**
  - `lap-engine.js`: `function rankParticipants`, `function leaderReachedTarget`, `rankParticipants: rankParticipants`.
  - `kart-overview.js`: `RasiLapEngine.rankParticipants`, `ko-pos`, `fmtGap`.
  - `RasiCross_Telemetry.html`: `.ko-card .ko-pos{`.
  - `laps-drivers.js`: `Leader-Auto-Ende`; **kein** `participantsOf(r).length <= 1`.
  - `live-ui.js`: `_leaderLaps`.
  - Unverändert: Grep `pit-wall.js` für `_pwPart` (bleibt da), `package.json` für `"lap-engine.js"` (bleibt da).

- [ ] **Step 3: Plan-Doc committen**

```bash
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" add docs/superpowers/plans/2026-06-24-31-multi-kart-leaderboard.md
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" commit -m "docs(plan): Phase 31 multi-kart leaderboard + position ranking implementation plan

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Manuelle Akzeptanz (an Nutzer — Hardware/zwei Karts)

1. **Positions-Ranking:** Rennen mit zwei Karts starten → Übersicht sortiert nach Position; P1/P2-Badges erscheinen, sobald Runden gezählt werden.
2. **Gap:** Kart auf gleicher Runde zeigt `+x.xs` zum Führenden; überrundeter Kart zeigt `+1 Runde`.
3. **Tiebreak:** Karts mit gleicher Rundenzahl ordnen sich nach Linien-Durchfahrt (früher überquert = weiter vorn).
4. **Leader-Auto-Ende:** Lap-Rennen (z. B. 5 Runden) endet automatisch, sobald der Führende Runde 5 abschließt; „Verbleibend" zählt die Rest-Runden des Führenden.
5. **Single-Kart-Regression:** mit einem Kart Grid/Anzeige/Auto-Ende exakt wie vor Phase 31 (keine Badges/Gaps).
6. **Zeit-/Frei-Rennen:** Ranking sichtbar, aber kein Lap-Auto-Ende.

## Self-Review

- **Spec-Coverage:** §3.1 Ranking-Regel → Task 1 (`rankParticipants`). §3.2 Gap-Format → Task 2 (`fmtGap`). §3.3 sortiertes Grid + Badge → Task 2 (`render` + CSS). §3.4 Leader-Auto-Ende → Task 3; Runden-bis-Ziel → Task 4. §5 Tests → Task 1 (7 neue `node:test`-Fälle). §6 betroffene Dateien → File-Structure-Tabelle (pit-wall/package.json/HTML-Include bewusst unverändert). §4 Randfälle: Single-Teilnehmer (Task 2 `>= 2`-Gate + Task 3 unveränderter Single-Pfad), Rolling Start / unarmiert (Task 1 Test „unarmed last"), Tiebreak (Task 1 Test), überrundet (Task 1 Test „lapped"), Zeit-/Frei-Rennen (Task 3 `lengthType === 'laps'`-Gate, Task 4 nur Lap-Zweig).
- **Placeholder-Scan:** Jeder Code-Schritt zeigt vollständigen Code; keine TBD/TODO. Test-Anhang + Funktions-Einschub mit frischen Grep-Ankern konkretisiert.
- **Typ-/Namens-Konsistenz:** `rankParticipants(race, lastCrossingByMac)` → `{mac,pos,laps,lapGap,timeGapMs}` (Task 1 def; Task 2 nutzt `pos`/`lapGap`/`timeGapMs`/`mac` in `fmtGap`/Badge). `leaderReachedTarget(ranked, targetLaps)` (Task 1 def; in Phase 31 nicht zwingend von Konsumenten genutzt — Task 3 nutzt den vorhandenen Per-Kart-Check, Task 4 das Teilnehmer-Maximum; `leaderReachedTarget` bleibt als getestete Engine-API für Phase 32). `buildCrossings(state, r)`/`fmtGap(e)` (Task 2 lokal). `k.lapStart` (Registry, Phase 28) als Durchfahrt-Zeitstempel.

## Phase Map

- **Phase 30:** Ein Rennen / mehrere Karts — Per-Kart-Runden/Bestrunde/Sektor-Best/Stints, rolling start, Migration, minimale UI.
- **Phase 31 (dieser Plan):** Leaderboard + Positions-Ranking — sortiertes Grid mit P-Badge + Gap, Leader-Auto-Ende bei Zielrunden, Runden-bis-Ziel des Führenden.
- **Phase 32 (deferred):** Live-Positions-Overlay (Strecke/3D), synchrones Multi-Kart-Replay, kombinierter Fahrerdialog, momentaner Streckenabstand-Gap.
