# Phase 32 — Multi-Kart Leaderboard-Polish + Pit-Wall-Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Das Leaderboard zeigt zusätzlich das Intervall zum Vordermann und markiert den Halter der schnellsten Runde mit einem lila „⚡FL"-Badge; der OLED-Pit-Wall-Payload zählt die Runden des aktiven Karts statt der Summe aller Karts; zwei Phase-31-Review-Nits werden aufgeräumt.

**Architecture:** Reine Logik (Intervall-Felder in `rankParticipants`, neue `fastestLapHolder`) kommt in das bestehende UMD-Modul `lap-engine.js` und wird per `node:test` TDD'd. Die DOM-Verdrahtung (`kart-overview.js` Gap·Int-Zeile + FL-Badge) und der isolierte OLED-Payload-Fix (`pit-wall.js`) konsumieren diese Funktionen.

**Tech Stack:** Vanilla JS (Browser-Globals / UMD-IIFE), `node:test`, ESLint 9 (Flat-Config), Electron-Builder. Verifikation: `node --check`, `node --test`, `eslint`, Python-Baselines (`py_compile`/`unittest`).

**Spec:** `docs/superpowers/specs/2026-06-24-multi-kart-leaderboard-polish-design.md`

## Global Constraints

- Repo-Root: `C:/Users/jimlu/Documents/RasiCross-Telemetrie-git`. Branch: `feat/multi-kart-leaderboard-polish` (von `main` nach Phase 31/PR #50 abgezweigt).
- **Dateien sind CRLF.** Unmittelbar vor jedem `Edit` die Zielstelle frisch in-session lesen und den Anker aus diesem Read kopieren — Zeilennummern hier sind indikativ, auf Text ankern.
- Verifikation mit dem **Grep-Tool** (nicht Shell-`grep`).
- **Niemals `.claude/` committen**, Plan-/Spec-Doc nur im expliziten Doc-Commit (Task 4).
- Commit-Messages: conventional + kurzer Body + Trailer `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- `__pycache__` vor jedem `git status`/commit löschen.
- **Verhalten unverändert für Single-Kart / <2 Teilnehmer:** Grid ohne Badge/Gap/Int/FL, OLED-Lapcount wie vor Phase 32 (Regression).
- **Ranking/Fastest-Lap sind rein/abgeleitet:** keine Persistenz neuer Felder; pro Render aus `participants` + `k.lapStart` + `participant.bestLapMs` berechnet.
- **`pit-wall.js` hat `RasiLapEngine`/`KartRegistry` bereits als ESLint-Globals** (seit Phase 30) — der OLED-Fix braucht **keine** `eslint.config.js`-Änderung. `fastestLapHolder` ist Methode des bestehenden `RasiLapEngine`-Globals → auch in `kart-overview.js` keine neue Global.
- **`live-ui.js`, `laps-drivers.js`, `races.js`, `package.json`, der `<script src="lap-engine.js">`-Include bleiben unverändert.**
- **Verifikationsrezept (pro Task wo relevant + final):**
  - `node --check <berührte .js>`
  - `node --test` (muss grün bleiben/wachsen; aktuell **147** + 5 neue = **152**)
  - `npx eslint <berührte .js>` → 0 Fehler
  - `python -m py_compile bridge.py` + `python -m unittest discover -s test -p "test_*.py"` → **50 OK** (Python unverändert)
  - Python kann `python` oder `py -3` sein.

---

## File Structure

| Aktion | Datei | Verantwortung |
|--------|-------|---------------|
| Ändern | `lap-engine.js` | `rankParticipants`: `intervalMs`/`intervalLapGap` je Eintrag; neue `fastestLapHolder(race)`; No-op-Nit `cross: c`. `fastestLapHolder` im UMD-Return exportieren. |
| Ändern | `test/lap-engine.test.js` | `node:test`-Fälle für Intervall + Fastest-Lap-Halter; Export-Liste erweitern. |
| Ändern | `kart-overview.js` | Gap·Int-Zeile (`fmtGap`-Refactor + `fmtDelta`); lila „⚡FL"-Chip + lila Bestzeit für den Fastest-Lap-Halter; Gate ≥2 Teilnehmer. |
| Ändern | `RasiCross_Telemetry.html` | CSS `.ko-fl` (lila Chip) + `.ko-v-fl` (lila Bestrunden-Wert). |
| Ändern | `pit-wall.js` | OLED-Payload `lapn` = Runden des aktiven Karts (`_pwPart`-Muster) statt `raceValidLaps`-Summe. |

**Task-Reihenfolge:** 1 (lap-engine Intervall + fastestLapHolder + Tests) → 2 (kart-overview Gap·Int + FL + CSS) → 3 (pit-wall OLED-Fix) → 4 (finale Verifikation + Plan-Doc).

> **Verifikationsstrategie:** Intervall-/Fastest-Lap-Logik wird in `lap-engine.js` per `node:test` TDD'd. DOM-/Payload-Verdrahtung: `node --check` + ESLint + Grep-Asserts + grüne Baselines. Funktionales Zwei-Kart-Verhalten bleibt manuell (Hardware, §8 Spec).

---

## Task 1: `lap-engine.js` — Intervall-Felder + `fastestLapHolder` + Nit (TDD)

**Files:**
- Modify: `lap-engine.js` (`rankParticipants` `out`-Schleife ~Zeile 158–168; `cross:`-Zeile ~146; neue Funktion nach `leaderReachedTarget` ~173; Export-Block ~175–186)
- Modify: `test/lap-engine.test.js` (Export-Liste; neue Tests am Dateiende)

**Interfaces:**
- Consumes: `participantsOf(race)`, `partValidLaps(part)` (bereits in `lap-engine.js`).
- Produces (von Task 2 konsumiert), auf `window.RasiLapEngine`:
  - `rankParticipants(race, lastCrossingByMac)` → Einträge jetzt zusätzlich mit `intervalLapGap` (Runden-Rückstand zum Vordermann, Position n−1) und `intervalMs` (Zeit-Rückstand zum Vordermann bei gleicher Runde, sonst 0). Führender: beide 0.
  - `fastestLapHolder(race)` → `{ mac, ms, num } | null` (Teilnehmer mit kleinstem `bestLapMs`; `null` ohne Bestrunde; Gleichstand → erster Teilnehmer).

- [ ] **Step 1: Export-Liste im Test erweitern (failing)**

Lies `test/lap-engine.test.js` frisch um die Export-Liste (Grep `'rankParticipants','leaderReachedTarget'`). Ersetze:

```js
                      'rankParticipants','leaderReachedTarget']) {
```

durch:

```js
                      'rankParticipants','leaderReachedTarget','fastestLapHolder']) {
```

- [ ] **Step 2: Neue Tests ans Dateiende anhängen (failing)**

Lies das Ende von `test/lap-engine.test.js` frisch (Grep `leaderReachedTarget true once leader reaches target laps`) und füge **nach** dem letzten `test(...)`-Block (am Dateiende) ein:

```js

test('rankParticipants adds interval to the car directly ahead', () => {
  const r = { participants: {
    AA: { mac: 'AA', laps: [{ valid: true }] },
    BB: { mac: 'BB', laps: [{ valid: true }] },
    CC: { mac: 'CC', laps: [{ valid: true }] },
  } };
  const ranked = E.rankParticipants(r, { AA: 1000, BB: 1300, CC: 1500 });
  assert.equal(ranked[0].mac, 'AA');
  assert.equal(ranked[0].intervalMs, 0);
  assert.equal(ranked[0].intervalLapGap, 0);
  assert.equal(ranked[1].mac, 'BB');
  assert.equal(ranked[1].timeGapMs, 300);     // gap to leader
  assert.equal(ranked[1].intervalMs, 300);    // interval to ahead (== leader for P2)
  assert.equal(ranked[2].mac, 'CC');
  assert.equal(ranked[2].timeGapMs, 500);     // gap to leader (1500-1000)
  assert.equal(ranked[2].intervalMs, 200);    // interval to ahead BB (1500-1300)
});

test('rankParticipants interval shows lap gap when car ahead is on another lap', () => {
  const r = { participants: {
    AA: { mac: 'AA', laps: [{ valid: true }, { valid: true }, { valid: true }] },
    BB: { mac: 'BB', laps: [{ valid: true }, { valid: true }] },
    CC: { mac: 'CC', laps: [{ valid: true }] },
  } };
  const ranked = E.rankParticipants(r, { AA: 1000, BB: 1100, CC: 1200 });
  assert.equal(ranked[1].mac, 'BB');
  assert.equal(ranked[1].intervalLapGap, 1);  // 1 lap behind AA
  assert.equal(ranked[1].intervalMs, 0);
  assert.equal(ranked[2].mac, 'CC');
  assert.equal(ranked[2].intervalLapGap, 1);  // 1 lap behind BB
  assert.equal(ranked[2].lapGap, 2);          // 2 laps behind leader
});

test('fastestLapHolder returns participant with smallest bestLapMs', () => {
  const r = { participants: {
    AA: { mac: 'AA', bestLapMs: 30000, bestLapNum: 2 },
    BB: { mac: 'BB', bestLapMs: 28000, bestLapNum: 3 },
    CC: { mac: 'CC', bestLapMs: null, bestLapNum: null },
  } };
  const h = E.fastestLapHolder(r);
  assert.equal(h.mac, 'BB');
  assert.equal(h.ms, 28000);
  assert.equal(h.num, 3);
});

test('fastestLapHolder returns null when no participant has a best lap', () => {
  const r = { participants: {
    AA: { mac: 'AA', bestLapMs: null },
    BB: { mac: 'BB', bestLapMs: null },
  } };
  assert.equal(E.fastestLapHolder(r), null);
});

test('fastestLapHolder tie resolves to first participant', () => {
  const r = { participants: {
    AA: { mac: 'AA', bestLapMs: 25000, bestLapNum: 1 },
    BB: { mac: 'BB', bestLapMs: 25000, bestLapNum: 2 },
  } };
  assert.equal(E.fastestLapHolder(r).mac, 'AA');
});
```

- [ ] **Step 3: Tests laufen lassen — müssen fehlschlagen**

Run: `node --test test/lap-engine.test.js`
Expected: FAIL (`fastestLapHolder` nicht definiert; `intervalMs`/`intervalLapGap` `undefined`).

- [ ] **Step 4: Intervall-Felder in `rankParticipants` ergänzen**

Lies `lap-engine.js` frisch um die `out`-Schleife (Grep `var lapGap = leaderLaps - e.laps;`). Ersetze den Block:

```js
    for (var j = 0; j < list.length; j++) {
      var e = list[j];
      var lapGap = leaderLaps - e.laps;
      var timeGapMs = 0;
      if (j > 0 && lapGap === 0 && e.cross != null && leaderCross != null) {
        timeGapMs = e.cross - leaderCross;
      }
      out.push({ mac: e.mac, pos: j + 1, laps: e.laps, lapGap: lapGap, timeGapMs: timeGapMs });
    }
```

durch:

```js
    for (var j = 0; j < list.length; j++) {
      var e = list[j];
      var lapGap = leaderLaps - e.laps;
      var timeGapMs = 0;
      if (j > 0 && lapGap === 0 && e.cross != null && leaderCross != null) {
        timeGapMs = e.cross - leaderCross;
      }
      // Phase 32: Intervall zum Vordermann (Position n-1), analog zu lapGap/timeGapMs.
      var intervalLapGap = 0, intervalMs = 0;
      if (j > 0) {
        var ahead = list[j - 1];
        intervalLapGap = ahead.laps - e.laps;
        if (intervalLapGap === 0 && e.cross != null && ahead.cross != null) {
          intervalMs = e.cross - ahead.cross;
        }
      }
      out.push({ mac: e.mac, pos: j + 1, laps: e.laps, lapGap: lapGap, timeGapMs: timeGapMs,
                 intervalLapGap: intervalLapGap, intervalMs: intervalMs });
    }
```

- [ ] **Step 5: `cross`-Nit vereinfachen**

Lies frisch um die `cross:`-Zeile (Grep `cross: \(c != null \? c : null\),`). Ersetze:

```js
        cross: (c != null ? c : null),
```

durch:

```js
        cross: c,
```

- [ ] **Step 6: `fastestLapHolder` implementieren**

Lies frisch um `function leaderReachedTarget` (Grep `function leaderReachedTarget`). Füge **direkt nach** dem Ende dieser Funktion (nach ihrer schließenden `}` und vor `return {`) ein:

```js

  // Phase 32: Teilnehmer mit der absolut schnellsten gueltigen Runde im Rennen.
  // Rein abgeleitet aus participant.bestLapMs (von commitLap gepflegt).
  function fastestLapHolder(race) {
    var ps = participantsOf(race), bestMs = null, mac = null, num = null;
    for (var i = 0; i < ps.length; i++) {
      var p = ps[i];
      if (p.bestLapMs == null) continue;
      if (bestMs == null || p.bestLapMs < bestMs) {
        bestMs = p.bestLapMs; mac = p.mac; num = p.bestLapNum != null ? p.bestLapNum : null;
      }
    }
    return bestMs == null ? null : { mac: mac, ms: bestMs, num: num };
  }
```

- [ ] **Step 7: `fastestLapHolder` exportieren**

Lies den Return-Block frisch (Grep `leaderReachedTarget: leaderReachedTarget,`). Ersetze:

```js
    rankParticipants: rankParticipants,
    leaderReachedTarget: leaderReachedTarget,
  };
```

durch:

```js
    rankParticipants: rankParticipants,
    leaderReachedTarget: leaderReachedTarget,
    fastestLapHolder: fastestLapHolder,
  };
```

- [ ] **Step 8: Tests laufen lassen — müssen bestehen**

Run: `node --test test/lap-engine.test.js`
Expected: PASS (alle neuen Tests grün).

- [ ] **Step 9: Voll-Suite + Lint**

Run: `node --check lap-engine.js` → OK.
Run: `npx eslint lap-engine.js test/lap-engine.test.js` → 0 Fehler.
Run: `node --test` → vorher 147, jetzt **152** PASS, 0 fail.

- [ ] **Step 10: Commit**

```bash
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" add lap-engine.js test/lap-engine.test.js
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" commit -m "feat(leaderboard-polish): interval-to-ahead in rankParticipants + fastestLapHolder + tests

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: `kart-overview.js` — Gap·Int-Zeile + Fastest-Lap-Badge + CSS

**Files:**
- Modify: `kart-overview.js` (`fmtGap` ~Zeile 34–38; `render` ~Zeile 40–88)
- Modify: `RasiCross_Telemetry.html` (CSS nach `.ko-card .ko-gap{` ~Zeile 1472)

**Interfaces:**
- Consumes: `RasiLapEngine.{rankParticipants,fastestLapHolder,participantsOf,partValidLaps}` (Task 1), `activeRace()`, `state.karts`, `RasiKartBar.metaFor`, `lap()`, `esc()`.
- Produces: Übersicht-Grid mit Gap·Int-Zeile + lila „⚡FL"-Chip (nur bei laufendem Rennen mit ≥2 Teilnehmern).

- [ ] **Step 1: `fmtGap` auf Gap·Int + `fmtDelta`-Helfer umstellen**

Lies `kart-overview.js` frisch um `function fmtGap` (Grep `function fmtGap`). Ersetze die komplette Funktion:

```js
  // Phase 31: Gap-Text — Fuehrender "Leader", gleiche Runde "+x.xs",
  // ueberrundet "+N Runde(n)".
  function fmtGap(e) {
    if (!e || e.pos === 1) return 'Leader';
    if (e.lapGap > 0) return '+' + e.lapGap + (e.lapGap === 1 ? ' Runde' : ' Runden');
    return '+' + (e.timeGapMs / 1000).toFixed(1) + 's';
  }
```

durch:

```js
  // Phase 32: ein Delta formatieren ("+N Runde(n)" bei Runden-Rueckstand,
  // sonst "+x.xs"). Genutzt fuer Gap (zum Fuehrenden) und Int (zum Vordermann).
  function fmtDelta(lapGap, ms) {
    if (lapGap > 0) return '+' + lapGap + (lapGap === 1 ? ' Runde' : ' Runden');
    return '+' + (ms / 1000).toFixed(1) + 's';
  }

  // Phase 32: Gap·Int-Zeile — Fuehrender "Leader", sonst "Gap <zumFuehrenden> ·
  // Int <zumVordermann>". Fuer P2 sind Gap und Int identisch (Vordermann = Fuehrender).
  function fmtGap(e) {
    if (!e || e.pos === 1) return 'Leader';
    return 'Gap ' + fmtDelta(e.lapGap, e.timeGapMs)
         + ' · Int ' + fmtDelta(e.intervalLapGap, e.intervalMs);
  }
```

- [ ] **Step 2: Fastest-Lap-Halter in `render` ermitteln**

Lies `render` frisch um die Ranking-Zeile (Grep `: RasiLapEngine.rankParticipants\(r, buildCrossings\(state, r\)\)`). Ersetze:

```js
    const ranking = (r && r.status === 'running'
                     && RasiLapEngine.participantsOf(r).length >= 2)
      ? RasiLapEngine.rankParticipants(r, buildCrossings(state, r))
      : null;
```

durch:

```js
    const ranking = (r && r.status === 'running'
                     && RasiLapEngine.participantsOf(r).length >= 2)
      ? RasiLapEngine.rankParticipants(r, buildCrossings(state, r))
      : null;
    // Phase 32: Halter der schnellsten Runde (lila Markierung), nur bei aktivem Ranking.
    const flHolder = ranking ? RasiLapEngine.fastestLapHolder(r) : null;
```

- [ ] **Step 3: FL-Chip + lila Bestzeit je Karte rendern**

Lies frisch den Karten-Map-Body um `const pe = posByMac[mac];` (Grep `const pe = posByMac\[mac\];`). Ersetze:

```js
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
```

durch:

```js
      // Phase 31: Positions-Badge + Gap. Phase 32: Gap·Int + Fastest-Lap-Markierung.
      const pe = posByMac[mac];
      const posBadge = pe ? '<span class="ko-pos">P' + pe.pos + '</span>' : '';
      const gapRow = pe ? '<div class="ko-gap">' + fmtGap(pe) + '</div>' : '';
      const isFL = !!(flHolder && flHolder.mac === mac);
      const flBadge = isFL ? '<span class="ko-fl">⚡FL</span>' : '';
      const bestCls = 'ko-v' + (isFL ? ' ko-v-fl' : '');
      const cls = 'ko-card' + (mac === state.activeKartMac ? ' active' : '') + (stale ? ' stale' : '');
      return '<div class="' + cls + '" data-mac="' + mac + '" style="border-color:' + m.color + '">'
        + '<div class="ko-head">' + posBadge + '<span class="ko-dot" style="background:' + m.color + '"></span>'
        +   '<span class="ko-name" style="color:' + m.color + '">' + esc(m.name) + '</span>' + rec + flBadge + '</div>'
        + '<div class="ko-speed">' + speed + '<small>km/h</small></div>'
        + '<div class="ko-row"><span class="ko-l">Aktuelle Runde</span><span class="ko-v">' + lapCur + '</span></div>'
        + '<div class="ko-row"><span class="ko-l">Beste Runde</span><span class="' + bestCls + '">' + lapBest + '</span></div>'
        + '<div class="ko-sub">' + bestNum + '</div>' + gapRow
        + '</div>';
```

- [ ] **Step 4: CSS für FL-Chip + lila Bestzeit**

Lies `RasiCross_Telemetry.html` frisch um die `.ko-card .ko-gap{`-Zeile (Grep `.ko-card .ko-gap\{`). Ersetze:

```css
.ko-card .ko-gap{font-family:var(--mono);font-size:11px;color:var(--mut)}
```

durch:

```css
.ko-card .ko-gap{font-family:var(--mono);font-size:11px;color:var(--mut)}
.ko-card .ko-fl{font-family:var(--mono);font-weight:800;font-size:11px;color:#b07bff;
  background:rgba(176,123,255,.14);border-radius:6px;padding:1px 5px;flex:0 0 auto;margin-left:4px}
.ko-card .ko-v-fl{color:#b07bff}
```

- [ ] **Step 5: Verify**

Run: `node --check kart-overview.js` → OK.
Run: `npx eslint kart-overview.js` → 0 Fehler.
Run: `node --test` → grün (152).
Grep `kart-overview.js` für `fmtDelta`, `fastestLapHolder`, `ko-fl`, `Gap ` → vorhanden.
Grep `RasiCross_Telemetry.html` für `.ko-card .ko-fl\{` und `.ko-card .ko-v-fl\{` → vorhanden.

- [ ] **Step 6: Commit**

```bash
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" add kart-overview.js RasiCross_Telemetry.html
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" commit -m "feat(leaderboard-polish): Gap·Int line + fastest-lap purple badge in overview

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: `pit-wall.js` — OLED-Lapcount auf aktiven Kart

**Files:**
- Modify: `pit-wall.js` (OLED-Payload-Builder, `const validLaps = raceValidLaps(r).length;` ~Zeile 353)

**Interfaces:**
- Consumes: `RasiLapEngine.{getOrCreatePart,partValidLaps}` (bereits Globals in `pit-wall.js` seit Phase 30), `KartRegistry.DEFAULT_MAC`, `state.activeKartMac`.
- Produces: OLED-Payload `lapn` = Runde des aktiven Karts.

> Dies ist der OLED-Display-Payload-Builder (Funktion mit `type: "display"`, `lapn`, `live_delta` …), **nicht** `updatePitWall` (On-Screen-Panel, nutzt bereits `_pwPart`). Anker auf die `raceValidLaps`-Zeile in DIESER Funktion.

- [ ] **Step 1: Runden-Quelle auf aktiven Teilnehmer umstellen**

Lies `pit-wall.js` frisch um die Zeile (Grep `const validLaps = raceValidLaps\(r\).length;`). Ersetze:

```js
  // Runden-Counter
  const validLaps = raceValidLaps(r).length;
```

durch:

```js
  // Runden-Counter — Phase 32: Runden des AKTIVEN Karts (Teilnehmer-Slot),
  // nicht die Summe aller Karts (raceValidLaps aggregiert seit Phase 30).
  const _oledPart = RasiLapEngine.getOrCreatePart(
    r, state.activeKartMac || KartRegistry.DEFAULT_MAC, r.startDriverId,
    r.startedAt || Date.now());
  const validLaps = RasiLapEngine.partValidLaps(_oledPart).length;
```

- [ ] **Step 2: Verify**

Run: `node --check pit-wall.js` → OK.
Run: `npx eslint pit-wall.js` → 0 Fehler (RasiLapEngine/KartRegistry sind seit Phase 30 im `pit-wall.js`-Block deklariert).
Run: `node --test` → grün (152).
Grep `pit-wall.js` für `_oledPart` → vorhanden; für `const validLaps = raceValidLaps(r).length;` → **nicht mehr** vorhanden.

- [ ] **Step 3: Commit**

```bash
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" add pit-wall.js
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" commit -m "fix(leaderboard-polish): OLED lapn counts active kart laps, not sum of all karts

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: Finale Verifikation + Plan-Doc

**Files:**
- Modify: (nur Verifikation; Plan-Doc-Commit)

- [ ] **Step 1: Voll-Verifikation (alles grün)**
  - `node --check lap-engine.js kart-overview.js pit-wall.js`
  - `npx eslint lap-engine.js test/lap-engine.test.js kart-overview.js pit-wall.js` → 0 Fehler
  - `node --test` → **152 PASS**, 0 fail (147 alt + 5 neue)
  - `python -m py_compile bridge.py` → kein Fehler (unverändert)
  - `python -m unittest discover -s test -p "test_*.py"` → **50 OK** (unverändert)
  - `__pycache__` löschen, dann `git status` → sauber bis auf `.claude/` und das Plan-Doc.

- [ ] **Step 2: Grep-Gesamtcheck**
  - `lap-engine.js`: `intervalLapGap`, `intervalMs`, `function fastestLapHolder`, `fastestLapHolder: fastestLapHolder`; **kein** `cross: (c != null`.
  - `kart-overview.js`: `function fmtDelta`, `RasiLapEngine.fastestLapHolder`, `ko-fl`, `ko-v-fl`.
  - `RasiCross_Telemetry.html`: `.ko-card .ko-fl{`, `.ko-card .ko-v-fl{`.
  - `pit-wall.js`: `_oledPart`; **kein** `raceValidLaps(r).length` im Payload-Builder.

- [ ] **Step 3: Plan-Doc committen**

```bash
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" add docs/superpowers/plans/2026-06-24-32-multi-kart-leaderboard-polish.md
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" commit -m "docs(plan): Phase 32 multi-kart leaderboard polish + pit-wall fix implementation plan

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Manuelle Akzeptanz (an Nutzer — Hardware/zwei Karts)

1. **Intervall:** Bei ≥3 Karts zeigt jede Karte `Gap` (zum Führenden) **und** `Int` (zum Vordermann); für P2 sind beide gleich.
2. **Fastest Lap:** Der Kart mit der absolut schnellsten Runde trägt ein lila „⚡FL"-Chip und eine lila „Beste Runde"; wechselt der Rekord, wandert die Markierung.
3. **Pit-Wall-OLED:** Der OLED-Rundenzähler zeigt die Runde des **aktiven** Karts (Chip-Wechsel ändert ihn), nicht mehr die Summe aller Karts.
4. **Single-Kart-Regression:** mit einem Kart Grid + OLED exakt wie vor Phase 32 (keine Badges/Int/FL).
5. **Rolling Start:** kein FL-Chip, bis die erste Runde gezählt ist.

## Self-Review

- **Spec-Coverage:** §3.1 Intervall → Task 1 (`rankParticipants` `intervalMs`/`intervalLapGap`) + Task 2 (Gap·Int-Zeile). §3.2 Fastest-Lap-Halter → Task 1 (`fastestLapHolder`) + Task 2 (FL-Chip/lila Bestzeit). §3.3 UI → Task 2 (+CSS). §3.4 Pit-Wall-OLED-Fix → Task 3. §3.5 Review-Nits → Task 1 Step 5 (`cross: c`) + Task 2 (Leader geht in Gap·Int-Zeile auf). §6 Tests → Task 1 (5 neue). §7 Dateien → File-Structure-Tabelle (live-ui/laps-drivers/races/package.json/Include unverändert). §5 Randfälle: Single/<2 (Task 2 `>= 2`-Gate, Task 3 aktiver=einziger Kart), Rolling Start/kein FL (Task 1 `fastestLapHolder` null), P2 Int==Gap (Task 1 Intervall-Test), überrundet (Task 1 Lap-Gap-Test).
- **Placeholder-Scan:** Jeder Code-Schritt zeigt vollständigen Code; keine TBD/TODO. Test-Anhang + Funktions-Einschub mit frischen Grep-Ankern.
- **Typ-/Namens-Konsistenz:** `rankParticipants`-Einträge `{mac,pos,laps,lapGap,timeGapMs,intervalLapGap,intervalMs}` (Task 1 def; Task 2 `fmtGap` nutzt `lapGap`/`timeGapMs`/`intervalLapGap`/`intervalMs`). `fastestLapHolder(race)` → `{mac,ms,num}` (Task 1 def; Task 2 nutzt `.mac`). `fmtDelta(lapGap, ms)`/`fmtGap(e)` (Task 2 lokal). `_oledPart` (Task 3 lokal). `participant.bestLapMs`/`bestLapNum` (seit Phase 30 von `commitLap` gepflegt).

## Phase Map

- **Phase 30:** Per-Kart-Runden/Bestrunde/Sektor-Best/Stints, rolling start, Migration.
- **Phase 31:** Leaderboard + Positions-Ranking — sortiertes Grid, P-Badge, Gap zum Führenden, Leader-Auto-Ende, Runden-bis-Ziel.
- **Phase 32 (dieser Plan):** Leaderboard-Polish (Intervall zum Vordermann, Fastest-Lap-Badge, Review-Nits) + Pit-Wall-OLED-Fix.
- **Phase 33 (deferred):** Overtake-Highlight, Live-Positions-Overlay, synchrones Replay, kombinierter Fahrerdialog, momentaner Streckenabstand-Gap.
