# Phase 36 — Momentaner Streckenabstand-Gap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Gap/Intervall im Leaderboard wird der momentane Streckenabstand in Metern (Projektion der Live-GPS-Position auf die Strecke, ab Start/Ziel verankert); bei gleicher Rundenzahl bestimmt der Streckenfortschritt die Position.

**Architecture:** Zwei reine, TDD'd Geo-Funktionen (`trackProgressM` Projektion, `lapProgressM` Start/Ziel-Normalisierung) kommen in `geo.js`. `rankParticipants` (`lap-engine.js`) wird von Durchfahrt-Zeitstempeln auf Fortschritt-in-Metern umgestellt (Sortier-Tiebreak + `distGapM`/`distIntM`). `kart-overview.js`/`map-draw.js` bauen die Fortschritts-Map und zeigen Meter-Gaps.

**Tech Stack:** Vanilla JS (Browser-Globals / UMD-IIFE), `node:test`, ESLint 9 (Flat-Config). Verifikation: `node --check`, `node --test`, `eslint`, Python-Baselines (`py_compile`/`unittest`).

**Spec:** `docs/superpowers/specs/2026-06-25-track-distance-gap-design.md`

## Global Constraints

- Repo-Root: `C:/Users/jimlu/Documents/RasiCross-Telemetrie-git`. Branch: `feat/track-distance-gap` (von `main` nach Phase 35).
- **Dateien sind CRLF.** Unmittelbar vor jedem `Edit` die Zielstelle frisch in-session lesen und den Anker aus diesem Read kopieren — Zeilennummern hier sind indikativ, auf Text ankern.
- Verifikation mit dem **Grep-Tool** (nicht Shell-`grep`).
- **Niemals `.claude/` committen**, Plan-/Spec-Doc nur im expliziten Doc-Commit (Task 4).
- Commit-Messages: conventional + kurzer Body + Trailer `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- `__pycache__` vor jedem `git status`/commit löschen.
- **Verhalten unverändert für Single-Kart / <2 Teilnehmer / kein Rennen:** kein Ranking, keine Gap-Anzeige.
- **Ohne aufgezeichnete Strecke** (`track.points<2`): Fortschritt `null` → Position nach Runden (stabil), Gap zeigt `--`; kein Crash.
- **Marker/Position bleiben datengetrieben** — `rankParticipants` rein; Fortschritt pro Render aus `k.telemetry` + `state.track`/`state.startGate` berechnet (kein persistierter State).
- **`pit-wall.js`, `live-ui.js`, `laps-drivers.js`, `races.js`, `package.json` bleiben unverändert** (sie lesen `participantsOf`/`partValidLaps`, nicht die Gap-Felder).
- **Verifikationsrezept (pro Task wo relevant + final):**
  - `node --check <berührte .js>`
  - `node --test` (muss grün bleiben/wachsen; aktuell **166**; +7 neue Geo-Tests, `rankParticipants`-Tests umgeschrieben = **173**)
  - `npx eslint <berührte .js>` → 0 Fehler
  - `python -m py_compile bridge.py` + `python -m unittest discover -s test -p "test_*.py"` → **50 OK** (Python unverändert)
  - Python kann `python` oder `py -3` sein.

---

## File Structure

| Aktion | Datei | Verantwortung |
|--------|-------|---------------|
| Ändern | `geo.js` | Neue reine `trackProgressM(point, trackPoints)` + `lapProgressM(rawProgress, gateOff, trackLen)`; im UMD-`api`-Export aufnehmen. |
| Ändern | `test/geo.test.js` | `node:test`-Fälle für beide. |
| Ändern | `eslint.config.js` | `trackProgressM`/`lapProgressM` in `geoGlobals`. |
| Ändern | `lap-engine.js` | `rankParticipants`: Eingabe `progressByMac`, Tiebreak Fortschritt, Ausgabe `distGapM`/`distIntM`. |
| Ändern | `test/lap-engine.test.js` | `rankParticipants`-Tests auf Fortschritt/Meter umschreiben. |
| Ändern | `kart-overview.js` | `buildProgress` statt `buildCrossings`; `fmtDelta`/`fmtGap` in Metern; `hasTrack`-Gate für `--`. |
| Ändern | `map-draw.js` | Inline-Crossing-Map → Inline-Fortschritts-Map. |

**Task-Reihenfolge:** 1 (geo `trackProgressM`+`lapProgressM` + Tests + geoGlobals) → 2 (lap-engine `rankParticipants` umstellen + Tests umschreiben) → 3 (Konsumenten kart-overview + map-draw) → 4 (finale Verifikation + Plan-Doc).

> **Verifikationsstrategie:** Projektion/Normalisierung + Ranking sind rein und per `node:test` TDD'd. DOM-/Canvas-Verdrahtung: `node --check` + ESLint + Grep-Asserts + grüne Baselines. Meter-Gaps/Tiebreak auf zwei Karts bleiben manuell (Hardware, §7 Spec).

---

## Task 1: `geo.js` — `trackProgressM` + `lapProgressM` (Pure-Logik, TDD)

**Files:**
- Modify: `geo.js` (neue Funktionen vor dem UMD-Export ~Zeile 124; `api`-Objekt ~Zeile 126–132)
- Modify: `test/geo.test.js` (Export-Liste ~Zeile 9–11; neue Tests am Dateiende)
- Modify: `eslint.config.js` (`geoGlobals` ~Zeile 16)

**Interfaces:**
- Consumes: `gpsDist` (bereits in `geo.js`).
- Produces (von Task 3 konsumiert), als Browser-Global + `module.exports`:
  - `trackProgressM(point, trackPoints)` → Meter vom Strecken-Anfang (`trackPoints[0]`) bis zur nächstgelegenen Projektion von `point={lat,lon}`; `0` wenn `<2` Punkte.
  - `lapProgressM(rawProgress, gateOff, trackLen)` → `((rawProgress - gateOff) % trackLen + trackLen) % trackLen`; `null` wenn `trackLen<=0`.

- [ ] **Step 1: Export-Liste im Test erweitern (failing)**

Lies `test/geo.test.js` frisch um die Export-Liste (Grep `'lineEndpointsFromGate','declutterLabels'`). Ersetze:

```js
                       'lineEndpointsFromGate','declutterLabels']) {
```

durch:

```js
                       'lineEndpointsFromGate','declutterLabels',
                       'trackProgressM','lapProgressM']) {
```

> Hinweis: Falls die Titelzeile „all 10 helpers" lautet, auf „all 12 helpers" anpassen (Grep `module exports all 10 helpers`).

- [ ] **Step 2: Neue Tests ans Dateiende anhängen (failing)**

Lies das Ende von `test/geo.test.js` frisch und füge **nach** dem letzten `test(...)`-Block ein (die Datei hat oben einen `approx(a,b,tol)`-Helfer):

```js

test('trackProgressM: midpoint of a straight segment is about half the length', () => {
  const track = [{ lat: 0, lon: 0 }, { lat: 0, lon: 0.01 }];
  const total = geo.traceDistanceM(track);
  approx(geo.trackProgressM({ lat: 0, lon: 0.005 }, track), total / 2, total * 0.02);
});

test('trackProgressM: a point before the start projects to ~0', () => {
  const track = [{ lat: 0, lon: 0 }, { lat: 0, lon: 0.01 }];
  approx(geo.trackProgressM({ lat: 0, lon: -0.005 }, track), 0, 1);
});

test('trackProgressM: a point past the end projects to ~full length', () => {
  const track = [{ lat: 0, lon: 0 }, { lat: 0, lon: 0.01 }];
  const total = geo.traceDistanceM(track);
  approx(geo.trackProgressM({ lat: 0, lon: 0.015 }, track), total, 1);
});

test('trackProgressM: picks the nearest of multiple segments', () => {
  // L-shape: east along lon, then north along lat. Point near the 2nd segment.
  const track = [{ lat: 0, lon: 0 }, { lat: 0, lon: 0.01 }, { lat: 0.01, lon: 0.01 }];
  const seg1 = geo.gpsDist(0, 0, 0, 0.01);
  assert.ok(geo.trackProgressM({ lat: 0.005, lon: 0.0101 }, track) > seg1);
});

test('trackProgressM: fewer than two points returns 0', () => {
  assert.equal(geo.trackProgressM({ lat: 0, lon: 0 }, [{ lat: 0, lon: 0 }]), 0);
  assert.equal(geo.trackProgressM({ lat: 0, lon: 0 }, []), 0);
});

test('lapProgressM: normalizes raw progress relative to the gate, modulo length', () => {
  assert.equal(geo.lapProgressM(250, 200, 1000), 50);
  assert.equal(geo.lapProgressM(150, 200, 1000), 950);   // wraps: 150-200 -> 950
  assert.equal(geo.lapProgressM(200, 200, 1000), 0);      // at the gate
});

test('lapProgressM: returns null when track length is non-positive', () => {
  assert.equal(geo.lapProgressM(100, 0, 0), null);
});
```

- [ ] **Step 3: Tests laufen lassen — müssen fehlschlagen**

Run: `node --test test/geo.test.js`
Expected: FAIL (`trackProgressM`/`lapProgressM` nicht definiert).

- [ ] **Step 4: Funktionen implementieren**

Lies `geo.js` frisch um den UMD-Export (Grep `// ── UMD-style export`). Füge **direkt vor** der Zeile `// ── UMD-style export ────────────────────────────────────────` ein:

```js
// Phase 36: Projiziert point={lat,lon} auf die Polyline trackPoints und liefert
// die aufsummierte Distanz (Meter) vom Strecken-Anfang bis zur naechstgelegenen
// Projektion. Lokale equirektangulaere Meter-Naeherung je Segment. 0 bei <2 Pkt.
function trackProgressM(point, trackPoints) {
  if (!point || !trackPoints || trackPoints.length < 2) return 0;
  var best = Infinity, bestDist = 0, cum = 0;
  for (var i = 1; i < trackPoints.length; i++) {
    var a = trackPoints[i - 1], b = trackPoints[i];
    var segLen = gpsDist(a.lat, a.lon, b.lat, b.lon);
    var t = 0;
    if (segLen > 0) {
      var mLat = 111320, mLon = 111320 * Math.cos(a.lat * Math.PI / 180);
      var bx = (b.lon - a.lon) * mLon, by = (b.lat - a.lat) * mLat;
      var px = (point.lon - a.lon) * mLon, py = (point.lat - a.lat) * mLat;
      var len2 = bx * bx + by * by;
      t = len2 > 0 ? (px * bx + py * by) / len2 : 0;
      if (t < 0) t = 0; else if (t > 1) t = 1;
    }
    var projLat = a.lat + (b.lat - a.lat) * t;
    var projLon = a.lon + (b.lon - a.lon) * t;
    var d = gpsDist(point.lat, point.lon, projLat, projLon);
    if (d < best) { best = d; bestDist = cum + segLen * t; }
    cum += segLen;
  }
  return bestDist;
}

// Phase 36: runden-lokaler Fortschritt ab Start/Ziel — verschiebt den
// Roh-Fortschritt um die Gate-Projektion und nimmt modulo Streckenlaenge.
// null wenn keine Strecke (trackLen<=0).
function lapProgressM(rawProgress, gateOff, trackLen) {
  if (!(trackLen > 0)) return null;
  return ((rawProgress - gateOff) % trackLen + trackLen) % trackLen;
}
```

- [ ] **Step 5: Funktionen exportieren**

Lies das `api`-Objekt frisch (Grep `structuralRaceKey: structuralRaceKey, ghostPointAt: ghostPointAt,`). Ersetze:

```js
    structuralRaceKey: structuralRaceKey, ghostPointAt: ghostPointAt,
    declutterLabels: declutterLabels
  };
```

durch:

```js
    structuralRaceKey: structuralRaceKey, ghostPointAt: ghostPointAt,
    declutterLabels: declutterLabels,
    trackProgressM: trackProgressM, lapProgressM: lapProgressM
  };
```

- [ ] **Step 6: `geoGlobals` für ESLint ergänzen**

Lies `eslint.config.js` frisch um `geoGlobals` (Grep `declutterLabels: 'readonly',`). Ersetze:

```js
  declutterLabels: 'readonly',
};
```

durch:

```js
  declutterLabels: 'readonly',
  trackProgressM: 'readonly', lapProgressM: 'readonly',
};
```

- [ ] **Step 7: Tests + Lint**

Run: `node --test test/geo.test.js` → PASS.
Run: `node --check geo.js` → OK.
Run: `npx eslint geo.js test/geo.test.js eslint.config.js` → 0 Fehler.
Run: `node --test` → vorher 166, jetzt **173** PASS, 0 fail.

- [ ] **Step 8: Commit**

```bash
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" add geo.js test/geo.test.js eslint.config.js
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" commit -m "feat(track-gap): trackProgressM + lapProgressM geo helpers + tests

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: `lap-engine.js` — `rankParticipants` auf Fortschritt umstellen (TDD)

**Files:**
- Modify: `lap-engine.js` (`rankParticipants` ~Zeile 132–179)
- Modify: `test/lap-engine.test.js` (die `rankParticipants`-Tests ~Zeile 129–231)

**Interfaces:**
- Consumes: `participantsOf`, `partValidLaps` (bereits in `lap-engine.js`).
- Produces (von Task 3 konsumiert): `rankParticipants(race, progressByMac)` → `[{ mac, pos, laps, lapGap, distGapM, intervalLapGap, distIntM }]`. `progressByMac[mac]` = runden-lokaler Fortschritt in Metern (größer = vorn; `null` = kein Fortschritt). Sortierung: Runden desc, dann Fortschritt desc; Karts ohne Fortschritt stabil ans Ende.

- [ ] **Step 1: `rankParticipants`-Tests auf Fortschritt umschreiben (failing)**

Lies `test/lap-engine.test.js` frisch und ersetze die **acht** `rankParticipants`-Tests. Ersetze den Block von `test('rankParticipants orders by valid laps desc with positions'` bis zum Ende von `test('rankParticipants interval shows lap gap when car ahead is on another lap'` (Grep den Start `rankParticipants orders by valid laps desc with positions` und das Ende `rankParticipants interval shows lap gap when car ahead is on another lap`).

> **Wichtig:** Der `leaderReachedTarget`-Test (zwischen den `rankParticipants`-Tests) bleibt erhalten — ihn beim Ersetzen mit-einschließen und **unverändert** wieder einsetzen (siehe unten).

Ersetze den gesamten Bereich (die acht rankParticipants-Tests **inklusive** des dazwischenliegenden `leaderReachedTarget`-Tests) durch:

```js
test('rankParticipants orders by valid laps desc with positions', () => {
  const r = { participants: {
    AA: { mac: 'AA', laps: [{ valid: true }, { valid: true }] },
    BB: { mac: 'BB', laps: [{ valid: true }, { valid: true }, { valid: true }] },
  } };
  const ranked = E.rankParticipants(r, { AA: 100, BB: 50 });
  assert.equal(ranked[0].mac, 'BB');
  assert.equal(ranked[0].pos, 1);
  assert.equal(ranked[0].laps, 3);
  assert.equal(ranked[1].mac, 'AA');
  assert.equal(ranked[1].pos, 2);
  assert.equal(ranked[1].lapGap, 1);
});

test('rankParticipants tiebreak: more track progress leads on equal laps', () => {
  const r = { participants: {
    AA: { mac: 'AA', laps: [{ valid: true }, { valid: true }] },
    BB: { mac: 'BB', laps: [{ valid: true }, { valid: true }] },
  } };
  const ranked = E.rankParticipants(r, { AA: 100, BB: 300 });
  assert.equal(ranked[0].mac, 'BB');
  assert.equal(ranked[0].distGapM, 0);
  assert.equal(ranked[1].mac, 'AA');
  assert.equal(ranked[1].lapGap, 0);
  assert.equal(ranked[1].distGapM, 200);   // 300 - 100
});

test('rankParticipants karts without progress sort last, stable order', () => {
  const r = { participants: {
    AA: { mac: 'AA', laps: [] },
    BB: { mac: 'BB', laps: [{ valid: true }] },
    CC: { mac: 'CC', laps: [] },
  } };
  const ranked = E.rankParticipants(r, { BB: 100 });
  assert.equal(ranked[0].mac, 'BB');
  assert.equal(ranked[1].mac, 'AA');
  assert.equal(ranked[2].mac, 'CC');
});

test('rankParticipants kart with progress beats one without (equal laps)', () => {
  const r = { participants: {
    AA: { mac: 'AA', laps: [] },
    BB: { mac: 'BB', laps: [] },
  } };
  const ranked = E.rankParticipants(r, { AA: 0 });
  assert.equal(ranked[0].mac, 'AA');
  assert.equal(ranked[1].mac, 'BB');
});

test('rankParticipants lapped kart shows lap gap, not distance gap', () => {
  const r = { participants: {
    AA: { mac: 'AA', laps: [{ valid: true }, { valid: true }, { valid: true }] },
    BB: { mac: 'BB', laps: [{ valid: true }] },
  } };
  const ranked = E.rankParticipants(r, { AA: 100, BB: 500 });
  assert.equal(ranked[0].mac, 'AA');
  assert.equal(ranked[1].lapGap, 2);
  assert.equal(ranked[1].distGapM, 0);
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

test('rankParticipants adds interval (meters) to the car directly ahead', () => {
  const r = { participants: {
    AA: { mac: 'AA', laps: [{ valid: true }] },
    BB: { mac: 'BB', laps: [{ valid: true }] },
    CC: { mac: 'CC', laps: [{ valid: true }] },
  } };
  const ranked = E.rankParticipants(r, { AA: 1500, BB: 1300, CC: 1000 });
  assert.equal(ranked[0].mac, 'AA');
  assert.equal(ranked[0].distIntM, 0);
  assert.equal(ranked[0].intervalLapGap, 0);
  assert.equal(ranked[1].mac, 'BB');
  assert.equal(ranked[1].distGapM, 200);   // 1500 - 1300 to leader
  assert.equal(ranked[1].distIntM, 200);   // to ahead (== leader for P2)
  assert.equal(ranked[2].mac, 'CC');
  assert.equal(ranked[2].distGapM, 500);   // 1500 - 1000 to leader
  assert.equal(ranked[2].distIntM, 300);   // 1300 - 1000 to ahead BB
});

test('rankParticipants interval shows lap gap when car ahead is on another lap', () => {
  const r = { participants: {
    AA: { mac: 'AA', laps: [{ valid: true }, { valid: true }, { valid: true }] },
    BB: { mac: 'BB', laps: [{ valid: true }, { valid: true }] },
    CC: { mac: 'CC', laps: [{ valid: true }] },
  } };
  const ranked = E.rankParticipants(r, { AA: 100, BB: 200, CC: 300 });
  assert.equal(ranked[1].mac, 'BB');
  assert.equal(ranked[1].intervalLapGap, 1);
  assert.equal(ranked[1].distIntM, 0);
  assert.equal(ranked[2].mac, 'CC');
  assert.equal(ranked[2].intervalLapGap, 1);
  assert.equal(ranked[2].lapGap, 2);
});
```

- [ ] **Step 2: Tests laufen lassen — müssen fehlschlagen**

Run: `node --test test/lap-engine.test.js`
Expected: FAIL (alte `rankParticipants` liefert `timeGapMs`/`intervalMs`, nicht `distGapM`/`distIntM`; Tiebreak per Zeitstempel).

- [ ] **Step 3: `rankParticipants` umstellen**

Lies `lap-engine.js` frisch und ersetze die **komplette** Funktion `rankParticipants` (von `// Phase 31: Live-Positions-Ranking.` bzw. `function rankParticipants(race, lastCrossingByMac) {` bis zur schließenden `}` direkt vor `function leaderReachedTarget`) durch:

```js
  // Phase 36: Live-Positions-Ranking ueber den momentanen Streckenfortschritt.
  // progressByMac[mac] = runden-lokaler Streckenfortschritt in Metern ab
  // Start/Ziel (groesser = weiter vorn; null/undefined = kein Fortschritt).
  // Sortierung: gueltige Runden desc, dann Fortschritt desc; Karts ohne
  // Fortschritt stabil ans Ende. Gaps in Metern (distGapM/distIntM).
  function rankParticipants(race, progressByMac) {
    var ps = participantsOf(race), prog = progressByMac || {};
    var list = [];
    for (var i = 0; i < ps.length; i++) {
      var p = ps[i];
      var pr = prog[p.mac];
      list.push({ mac: p.mac, idx: i, laps: partValidLaps(p).length, prog: pr });
    }
    list.sort(function (a, b) {
      if (a.laps !== b.laps) return b.laps - a.laps;       // mehr Runden zuerst
      var aHas = a.prog != null, bHas = b.prog != null;
      if (aHas !== bHas) return aHas ? -1 : 1;             // mit Fortschritt vor ohne
      if (aHas && b.prog !== a.prog) return b.prog - a.prog; // mehr Fortschritt zuerst
      return a.idx - b.idx;                                // stabil
    });
    var leaderLaps = list.length ? list[0].laps : 0;
    var leaderProg = list.length ? list[0].prog : null;
    var out = [];
    for (var j = 0; j < list.length; j++) {
      var e = list[j];
      var lapGap = leaderLaps - e.laps;
      var distGapM = 0;
      if (j > 0 && lapGap === 0 && e.prog != null && leaderProg != null) {
        distGapM = leaderProg - e.prog;
      }
      var intervalLapGap = 0, distIntM = 0;
      if (j > 0) {
        var ahead = list[j - 1];
        intervalLapGap = ahead.laps - e.laps;
        if (intervalLapGap === 0 && e.prog != null && ahead.prog != null) {
          distIntM = ahead.prog - e.prog;
        }
      }
      out.push({ mac: e.mac, pos: j + 1, laps: e.laps, lapGap: lapGap, distGapM: distGapM,
                 intervalLapGap: intervalLapGap, distIntM: distIntM });
    }
    return out;
  }
```

- [ ] **Step 4: Tests laufen lassen — müssen bestehen**

Run: `node --test test/lap-engine.test.js` → PASS.

- [ ] **Step 5: Voll-Suite + Lint**

Run: `node --check lap-engine.js` → OK.
Run: `npx eslint lap-engine.js test/lap-engine.test.js` → 0 Fehler.
Run: `node --test` → grün (**173**).

- [ ] **Step 6: Commit**

```bash
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" add lap-engine.js test/lap-engine.test.js
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" commit -m "feat(track-gap): rankParticipants ranks by track progress, meters gaps

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: Konsumenten — `kart-overview.js` + `map-draw.js`

**Files:**
- Modify: `kart-overview.js` (`buildCrossings` ~22–30; `fmtDelta` ~32–37; `fmtGap` ~39–45; `render` ranking-Aufruf ~62; `hasTrack` + gap-Zeile)
- Modify: `map-draw.js` (Inline-Crossing-Block in `drawKartMarkersOn` ~152–157)

**Interfaces:**
- Consumes: `RasiLapEngine.{participantsOf,rankParticipants,positionGains,fastestLapHolder,partValidLaps}`, `trackProgressM`/`lapProgressM`/`traceDistanceM` (geo), `state.track`/`state.startGate`/`state.karts`, `dpr`.
- Produces: Meter-Gaps in der Übersicht; fortschrittsbasierte `P{pos}`-Reihenfolge auf der Karte.

- [ ] **Step 1: `buildCrossings` → `buildProgress` (kart-overview.js)**

Lies `kart-overview.js` frisch um `function buildCrossings` (Grep `function buildCrossings\(state, r\) \{`). Ersetze:

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
```

durch:

```js
  // Phase 36: runden-lokaler Streckenfortschritt je Teilnehmer-Kart (Meter ab
  // Start/Ziel). Ohne Strecke -> null fuer alle (Ranking faellt auf Runden
  // zurueck, Gap zeigt "--").
  function buildProgress(state, r) {
    const out = {};
    const pts = state.track && state.track.points;
    const trackLen = (pts && pts.length > 1) ? traceDistanceM(pts) : 0;
    const gateOff = (trackLen > 0 && state.startGate && state.startGate.lat)
      ? trackProgressM({ lat: state.startGate.lat, lon: state.startGate.lon }, pts) : 0;
    RasiLapEngine.participantsOf(r).forEach(p => {
      const kk = state.karts.has(p.mac) ? state.karts.get(p.mac) : null;
      const t = kk && kk.telemetry;
      out[p.mac] = (t && t.lat && t.lon)
        ? lapProgressM(trackProgressM({ lat: t.lat, lon: t.lon }, pts), gateOff, trackLen)
        : null;
    });
    return out;
  }
```

- [ ] **Step 2: `fmtDelta`/`fmtGap` auf Meter (kart-overview.js)**

Lies frisch `function fmtDelta` (Grep `function fmtDelta\(lapGap, ms\) \{`). Ersetze:

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

durch:

```js
  // Phase 36: ein Delta formatieren ("+N Runde(n)" bei Runden-Rueckstand,
  // sonst "+N m" Streckenabstand). Fuer Gap (zum Fuehrenden) + Int (zum Vordermann).
  function fmtDelta(lapGap, distM) {
    if (lapGap > 0) return '+' + lapGap + (lapGap === 1 ? ' Runde' : ' Runden');
    return '+' + Math.round(distM) + ' m';
  }

  // Phase 36: Gap·Int-Zeile in Metern — Fuehrender "Leader", sonst "Gap <Meter zum
  // Fuehrenden> · Int <Meter zum Vordermann>". P2: Gap == Int (Vordermann = Fuehrender).
  function fmtGap(e) {
    if (!e || e.pos === 1) return 'Leader';
    return 'Gap ' + fmtDelta(e.lapGap, e.distGapM)
         + ' · Int ' + fmtDelta(e.intervalLapGap, e.distIntM);
  }
```

- [ ] **Step 3: Ranking-Aufruf auf `buildProgress` + `hasTrack` (kart-overview.js)**

Lies frisch den Ranking-Aufruf in `render` (Grep `: RasiLapEngine.rankParticipants\(r, buildCrossings\(state, r\)\)`). Ersetze:

```js
    const ranking = (r && r.status === 'running'
                     && RasiLapEngine.participantsOf(r).length >= 2)
      ? RasiLapEngine.rankParticipants(r, buildCrossings(state, r))
      : null;
```

durch:

```js
    // Phase 36: Strecke vorhanden? -> sonst Gap "--" (Ranking nach Runden).
    const hasTrack = !!(state.track && state.track.points && state.track.points.length > 1);
    const ranking = (r && r.status === 'running'
                     && RasiLapEngine.participantsOf(r).length >= 2)
      ? RasiLapEngine.rankParticipants(r, buildProgress(state, r))
      : null;
```

- [ ] **Step 4: Gap-Zeile mit `hasTrack`-Gate (kart-overview.js)**

Lies frisch die Gap-Zeile in `render` (Grep `const gapRow = pe \? '<div class="ko-gap">' \+ fmtGap\(pe\)`). Ersetze:

```js
      const gapRow = pe ? '<div class="ko-gap">' + fmtGap(pe) + '</div>' : '';
```

durch:

```js
      const gapRow = pe ? '<div class="ko-gap">' + (hasTrack ? fmtGap(pe) : '--') + '</div>' : '';
```

- [ ] **Step 5: Inline-Fortschritts-Map in `map-draw.js`**

Lies `map-draw.js` frisch um den Inline-Crossing-Block in `drawKartMarkersOn` (Grep `const cross = \{\};`). Ersetze:

```js
      const cross = {};
      _parts.forEach(p => {
        const kk = state.karts.has(p.mac) ? state.karts.get(p.mac) : null;
        cross[p.mac] = kk ? kk.lapStart : null;
      });
      const ranked = RasiLapEngine.rankParticipants(r, cross);
```

durch:

```js
      // Phase 36: Reihenfolge nach Streckenfortschritt (Meter ab Start/Ziel).
      const pts = state.track && state.track.points;
      const trackLen = (pts && pts.length > 1) ? traceDistanceM(pts) : 0;
      const gateOff = (trackLen > 0 && state.startGate && state.startGate.lat)
        ? trackProgressM({ lat: state.startGate.lat, lon: state.startGate.lon }, pts) : 0;
      const prog = {};
      _parts.forEach(p => {
        const kk = state.karts.has(p.mac) ? state.karts.get(p.mac) : null;
        const tl = kk && kk.telemetry;
        prog[p.mac] = (tl && tl.lat && tl.lon)
          ? lapProgressM(trackProgressM({ lat: tl.lat, lon: tl.lon }, pts), gateOff, trackLen)
          : null;
      });
      const ranked = RasiLapEngine.rankParticipants(r, prog);
```

- [ ] **Step 6: Verify**

Run: `node --check kart-overview.js map-draw.js` → OK.
Run: `npx eslint kart-overview.js map-draw.js` → 0 Fehler.
Run: `node --test` → grün (173).
Grep `kart-overview.js` für `function buildProgress`, `lapProgressM`, `' m'`, `hasTrack` → vorhanden; für `buildCrossings`, `timeGapMs`, `intervalMs` → **nicht mehr** vorhanden.
Grep `map-draw.js` für `lapProgressM`, `trackProgressM`; für `const cross = {}` → **nicht mehr** vorhanden.

- [ ] **Step 7: Commit**

```bash
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" add kart-overview.js map-draw.js
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" commit -m "feat(track-gap): overview meter gaps + progress-based map order

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: Finale Verifikation + Plan-Doc

**Files:**
- Modify: (nur Verifikation; Plan-Doc-Commit)

- [ ] **Step 1: Voll-Verifikation (alles grün)**
  - `node --check geo.js lap-engine.js kart-overview.js map-draw.js`
  - `npx eslint geo.js test/geo.test.js lap-engine.js test/lap-engine.test.js kart-overview.js map-draw.js eslint.config.js` → 0 Fehler
  - `node --test` → **173 PASS**, 0 fail
  - `python -m py_compile bridge.py` → kein Fehler (unverändert)
  - `python -m unittest discover -s test -p "test_*.py"` → **50 OK** (unverändert)
  - `__pycache__` löschen, dann `git status` → sauber bis auf `.claude/` und das Plan-Doc.

- [ ] **Step 2: Grep-Gesamtcheck**
  - `geo.js`: `function trackProgressM`, `function lapProgressM`, `trackProgressM: trackProgressM`.
  - `eslint.config.js`: `trackProgressM: 'readonly'`.
  - `lap-engine.js`: `function rankParticipants(race, progressByMac)`, `distGapM`, `distIntM`; **kein** `lastCrossingByMac`, **kein** `timeGapMs`.
  - `kart-overview.js`: `buildProgress`, `' m'`, `hasTrack`; **kein** `buildCrossings`.
  - `map-draw.js`: `lapProgressM`; **kein** `const cross = {}`.

- [ ] **Step 3: Plan-Doc committen**

```bash
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" add docs/superpowers/plans/2026-06-25-36-track-distance-gap.md
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" commit -m "docs(plan): Phase 36 momentary track-distance gap implementation plan

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Manuelle Akzeptanz (an Nutzer — Hardware/zwei Karts, mit Strecke)

1. **Meter-Gap:** zwei Karts auf gleicher Runde → Übersicht zeigt `Gap +N m` (zum Führenden) und `Int +M m` (zum Vordermann); Werte ändern sich live mit dem realen Abstand.
2. **Tiebreak:** bei gleicher Rundenzahl liegt der weiter vorn befindliche Kart vorn — auch direkt nach der Start/Ziel-Linie korrekt.
3. **Überrundet:** ein überrundeter Kart zeigt `+1 Runde`.
4. **Ohne Strecke:** ohne aufgezeichnete Strecke Gap `--`, Position nach Runden.
5. **Single-Kart-Regression:** keine Gap-Anzeige; wie vor Phase 36.

## Self-Review

- **Spec-Coverage:** §3.1 `trackProgressM` → Task 1. §3.2 Builder (Gate-Anker) → Task 1 (`lapProgressM`) + Task 3 (`buildProgress`/Inline). §3.3 `rankParticipants` Umstellung → Task 2. §3.4 Konsumenten → Task 3 (kart-overview Meter + `hasTrack`; map-draw Reihenfolge). §5 Tests → Task 1 (7) + Task 2 (umgeschrieben). §6 Dateien → File-Structure-Tabelle. §4 Randfälle: keine Strecke (Task 1 `lapProgressM` null + Task 3 `hasTrack` "--"), Naht (Task 1 `lapProgressM` modulo), kein Fix (Task 3 `null`), single/<2 (Render-Gate), überrundet (Task 2 `lapGap`).
- **Placeholder-Scan:** Jeder Code-Schritt zeigt vollständigen Code; keine TBD/TODO.
- **Typ-/Namens-Konsistenz:** `trackProgressM(point, trackPoints)` / `lapProgressM(rawProgress, gateOff, trackLen)` (Task 1 def; Task 3 Nutzung). `rankParticipants(race, progressByMac)` → `{…, distGapM, distIntM}` (Task 2 def; Task 3 `fmtGap` nutzt `distGapM`/`distIntM`). `buildProgress` (Task 3 kart-overview). geoGlobals `trackProgressM`/`lapProgressM` (Task 1; map-draw/kart-overview nutzen sie — `geoGlobals` ist in beiden Blöcken). `positionGains`/`fastestLapHolder` unverändert (lesen `pos`/`laps`/`mac`, nicht die Gap-Felder).

## Phase Map

- **Phase 31–35:** Leaderboard → Polish → Live-Overlay → Map-Marker-Polish → kombinierter Fahrerdialog.
- **Phase 36 (dieser Plan):** Momentaner Streckenabstand-Gap (Meter) + fortschrittsbasierter Positions-Tiebreak.
- **Phasen 37+ (deferred):** synchrones Multi-Kart-Replay, Pit-Wall-Fahrername-Fix.
