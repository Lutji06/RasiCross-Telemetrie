# Phase 39: Multikart-Verbesserungen — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sechs Multikart-Bugs beheben (Persist-Verlust, Toast-Spam, Phantom-Teilnehmer, Render-Loop-Writes, ungecachtes Ranking, invalides Chip-Markup), Übersicht-Karten + Leaderboard-Strip aufwerten, Demo-Modus auf 3 simulierte Karts erweitern.

**Architecture:** Rein Dashboard-seitig (kein Python-Touch). Neue pure Funktion `RasiLapEngine.partOf` (TDD), neues Browser-Modul `kart-rank.js` (memoisiertes Ranking, konsumiert von map-draw/kart-overview/Leaderboard-Strip), Persist-Map in rasicross.js, Demo-Multikart in serial-demo.js.

**Tech Stack:** Vanilla JS (klassische Scripts, gemeinsamer Global-Scope), UMD-Module für pure Logik, node:test, Electron/Browser.

**Spec:** `docs/superpowers/specs/2026-07-02-multikart-improvements-design.md`

## Global Constraints (Working Directory & Conventions)

- Working Directory: `C:/Users/jimlu/Documents/RasiCross-Telemetrie-git`, Branch `feat/phase-39-multikart` (existiert bereits, Spec-Commit liegt darauf).
- Dateien sind **CRLF**: Ziel-Region immer unmittelbar vor einem Edit frisch lesen und den Anker aus diesem Read kopieren; Zeilennummern sind nur Richtwerte.
- Verifikation ausschließlich mit dem Grep-Tool (nicht Shell-grep), `node --check <datei>` für jede geänderte JS-Datei, `node --test` (ohne Pfad, Auto-Discovery `test/`).
- Niemals `.claude/` oder Plan-Docs committen — außer dem expliziten Plan-Doc-Commit im letzten Task.
- Commits: conventional + Body, Trailer:
  `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`
  `Claude-Session: https://claude.ai/code/session_013JpjGB74UNHRKEF6M5cbGj`
- Save-Format bleibt 9.6 / additiv, keine neuen Top-Level-Keys in localStorage-Payload.
- Alle Render-Loops dürfen nie crashen (try/catch-Muster der Nachbarmodule übernehmen).
- Deutsch für UI-Texte, bestehende CSS-Variablen (`--panel`, `--mut`, `--mono`, …) nutzen.

## Locked Decisions

- `partOf` ist reiner Lookup (`null` wenn kein Teilnehmer) — Teilnehmer entstehen NUR in `startRace()` und im Nachzügler-Pfad von `processTelemetry`.
- Ranking-Memo: 250 ms, Track-Geometrie-Cache invalidiert bei Punkte-Referenz/-Länge- oder Gate-Koordinaten-Änderung.
- Overtake-Erkennung bleibt je Konsument modul-lokal (map-draw und kart-overview behalten eigene prev/at-Maps).
- Demo = fest 3 Karts (kein Umschalter, User-Entscheid). Demo-MACs (`DE:MO:*`) werden NIE in `kartsCal`/`kartsEngine` persistiert und adoptieren NICHT den default-Bucket.
- `resetKarts()` behält Persist-Einträge (Kalibrierung/Motorstunden); nur „Kart vergessen" (✏-Popover) löscht sie.
- Leaderboard-Strip nur in Einzelansicht bei laufendem Rennen mit ≥2 Teilnehmern.

## File Structure

| Action | Path | Responsibility |
|--------|------|----------------|
| Modify | `lap-engine.js` | Neue pure Funktion `partOf(r, mac)` + Export |
| Modify | `test/lap-engine.test.js` | Tests für `partOf` |
| Modify | `races.js` | `activePart()` auf `partOf` |
| Modify | `pit-wall.js` | `updatePitWall`/`buildRaceDataForKart` auf `partOf`; `resetKarts`-Dialogtext |
| Modify | `laps-drivers.js` | `renderLapTable` auf `partOf` |
| Modify | `rasicross.js` | Persist-Map (`_persistedKarts`), Toast-Drossel, `kartFor`-Hydration + Demo-Guard |
| Create | `kart-rank.js` | `window.RasiKartRank.ranking(state, r)` — memoisiertes Ranking |
| Modify | `map-draw.js` | `drawKartMarkersOn` konsumiert `RasiKartRank` |
| Modify | `kart-overview.js` | Konsumiert `RasiKartRank`; Karten: Letzte Runde, Fahrer, Fußzeile, Stale-Alter |
| Modify | `kart-bar.js` | Valides Chip-Markup, Meta-Save nur bei Neuanlage, Focus-Erhalt, Popover-Fix, Persist-Forget |
| Modify | `live-ui.js` | `renderLeaderStrip()` + Loop-Aufrufe |
| Modify | `serial-demo.js` | 3 Demo-Karts (startDemo/demoTick/stopDemo) |
| Modify | `RasiCross_Telemetry.html` | Script-Tag `kart-rank.js`, `#liveLeaderStrip`, CSS (Chip, ko-foot, Strip) |

**Task-Reihenfolge:** 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 → 10 → 11 (strikt sequenziell; 5 liefert das API für 8+9).

---

### Task 1: `RasiLapEngine.partOf` (TDD)

**Files:**
- Modify: `lap-engine.js`
- Test: `test/lap-engine.test.js`

**Interfaces:**
- Produces: `RasiLapEngine.partOf(r, mac)` → Teilnehmer-Objekt oder `null`. Kein Anlegen, keine Mutation.

- [ ] **Step 1: Failing Tests schreiben** — in `test/lap-engine.test.js` ans Dateiende anhängen:

```js
test('partOf returns existing participant without creating', () => {
  const r = { participants: { AA: { mac: 'AA', laps: [] } } };
  assert.equal(E.partOf(r, 'AA'), r.participants.AA);
  assert.equal(E.partOf(r, 'BB'), null, 'must not create BB');
  assert.equal(Object.keys(r.participants).length, 1, 'no new slot');
});

test('partOf tolerates missing race/participants', () => {
  assert.equal(E.partOf(null, 'AA'), null);
  assert.equal(E.partOf({}, 'AA'), null);
  assert.equal(E.partOf({ participants: {} }, null), null);
});
```

Zusätzlich in `test('module exports all helpers', …)` den Namen `'partOf'` in die Liste aufnehmen.

- [ ] **Step 2: Tests laufen lassen — müssen fehlschlagen**

Run: `node --test --test-name-pattern "partOf" test/lap-engine.test.js`
Expected: 2 FAIL (`E.partOf is not a function`), plus FAIL im Export-Test.

- [ ] **Step 3: Implementierung** — in `lap-engine.js` direkt NACH `getOrCreatePart` einfügen:

```js
  // Phase 39: reiner Teilnehmer-Lookup — legt NIE an (Gegenteil von
  // getOrCreatePart). Render-/Lese-Pfade nutzen dies, damit bloßes Anzeigen
  // keine Phantom-Teilnehmer in (auch beendete) Rennen schreibt.
  function partOf(r, mac) {
    if (!r || !r.participants || mac == null) return null;
    return Object.prototype.hasOwnProperty.call(r.participants, mac)
      ? r.participants[mac] : null;
  }
```

Im `return {…}`-Block nach `getOrCreatePart: getOrCreatePart,` ergänzen: `partOf: partOf,`

- [ ] **Step 4: Tests grün**

Run: `node --test test/lap-engine.test.js`
Expected: alle Tests PASS.

- [ ] **Step 5: Commit**

```bash
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" add lap-engine.js test/lap-engine.test.js
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" commit -m "feat(multikart): RasiLapEngine.partOf pure lookup + tests"
```

(Trailer wie in Global Constraints anhängen — gilt für alle Commits, wird nicht wiederholt.)

---

### Task 2: Lese-/Render-Pfade auf `partOf` umstellen (B3)

**Files:**
- Modify: `races.js` (activePart, ~Zeile 21–25)
- Modify: `pit-wall.js` (updatePitWall ~Zeile 51, buildRaceDataForKart ~Zeile 354)
- Modify: `laps-drivers.js` (renderLapTable ~Zeile 103)

**Interfaces:**
- Consumes: `RasiLapEngine.partOf` aus Task 1.
- Produces: `activePart(r)` kann jetzt `null` liefern, wenn der aktive Kart kein Teilnehmer ist (alle bestehenden Aufrufer haben bereits Null-Guards: `currentStint`, `renderStints`, Hero-Stint-Count).

- [ ] **Step 1: races.js** — `activePart` ersetzen. Alt:

```js
function activePart(r) {
  if (!r) return null;
  const mac = state.activeKartMac || KartRegistry.DEFAULT_MAC;
  return RasiLapEngine.getOrCreatePart(r, mac, r.startDriverId, r.startedAt || Date.now());
}
```

Neu:

```js
function activePart(r) {
  if (!r) return null;
  // Phase 39: reiner Lookup — Rendern darf keine Teilnehmer anlegen.
  const mac = state.activeKartMac || KartRegistry.DEFAULT_MAC;
  return RasiLapEngine.partOf(r, mac);
}
```

- [ ] **Step 2: pit-wall.js updatePitWall** — Zeile mit `_pwPart` ersetzen. Alt:

```js
  const _pwPart = r ? RasiLapEngine.getOrCreatePart(r, state.activeKartMac || KartRegistry.DEFAULT_MAC, r.startDriverId, r.startedAt || Date.now()) : null;
```

Neu:

```js
  const _pwPart = r ? RasiLapEngine.partOf(r, state.activeKartMac || KartRegistry.DEFAULT_MAC) : null;
```

- [ ] **Step 3: pit-wall.js buildRaceDataForKart** — `_oledPart`-Block ersetzen. Alt:

```js
  const _oledPart = RasiLapEngine.getOrCreatePart(
    r, state.activeKartMac || KartRegistry.DEFAULT_MAC, r.startDriverId,
    r.startedAt || Date.now());
  const validLaps = RasiLapEngine.partValidLaps(_oledPart).length;
```

Neu:

```js
  const _oledPart = RasiLapEngine.partOf(r, state.activeKartMac || KartRegistry.DEFAULT_MAC);
  const validLaps = RasiLapEngine.partValidLaps(_oledPart).length;
```

(`partValidLaps(null)` liefert `[]` — kein weiterer Guard nötig.)

- [ ] **Step 4: laps-drivers.js renderLapTable** — `_p`-Zeile ersetzen. Alt:

```js
  const _p = r ? RasiLapEngine.getOrCreatePart(r, state.activeKartMac || KartRegistry.DEFAULT_MAC, r.startDriverId, r.startedAt || Date.now()) : null;
```

Neu:

```js
  const _p = r ? RasiLapEngine.partOf(r, state.activeKartMac || KartRegistry.DEFAULT_MAC) : null;
```

- [ ] **Step 5: Verifizieren — kein getOrCreatePart mehr im Lese-Pfad**

Grep-Tool: pattern `getOrCreatePart`, alle `*.js` im Root. Expected: Treffer NUR noch in `lap-engine.js` (Definition/Export), `rasicross.js` (Nachzügler-Pfad in processTelemetry) und `races.js`/`startRace` (Teilnehmer-Anlage). KEINE Treffer mehr in pit-wall.js, laps-drivers.js, activePart.

Run: `node --check races.js` / `node --check pit-wall.js` / `node --check laps-drivers.js` — Expected: kein Output. `node --test` — Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" add races.js pit-wall.js laps-drivers.js
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" commit -m "fix(multikart): Render-Pfade legen keine Phantom-Teilnehmer mehr an"
```

---

### Task 3: Persist-Map für Kalibrierung/Motorstunden (B1)

**Files:**
- Modify: `rasicross.js` (Modul-Kopf bei Persistenz-Sektion, `saveData`, `loadData`, `kartFor`)
- Modify: `pit-wall.js` (`resetKarts`-Dialogtext)
- Modify: `kart-bar.js` (`forgetKart` löscht Persist-Eintrag)

**Interfaces:**
- Produces: `window.rasiPersistForget(mac)` — entfernt die Persist-Einträge einer MAC (genutzt von kart-bar.js).

- [ ] **Step 1: Persist-Map deklarieren** — in `rasicross.js` in Sektion „3. PERSISTENCE" direkt nach `let _quotaWarned = false;` einfügen:

```js
// Phase 39: zuletzt geladene/gespeicherte per-Kart-Persistenz. saveData()
// merged Registry ueber diese Map, damit "Karts zuruecksetzen" (leere
// Registry) Kalibrierung + Motorstunden NICHT verliert. Nur "Kart
// vergessen" loescht Eintraege (rasiPersistForget). Demo-Karts (DE:MO:*)
// werden nie persistiert.
const _persistedKarts = { cal: {}, eng: {} };
window.rasiPersistForget = function (mac) {
  delete _persistedKarts.cal[mac];
  delete _persistedKarts.eng[mac];
};
```

- [ ] **Step 2: saveData mergen** — den Block

```js
    const _kartsCal = {}, _kartsEngine = {};
    for (const mac of state.karts.macs()) {
      const kk = state.karts.get(mac);
      _kartsCal[mac] = kk.calibration;
      _kartsEngine[mac] = { totalMs: kk.engine.totalMs, lastServiceMs: kk.engine.lastServiceMs, serviceIntervalH: kk.engine.serviceIntervalH };
    }
```

ersetzen durch:

```js
    const _kartsCal = Object.assign({}, _persistedKarts.cal);
    const _kartsEngine = Object.assign({}, _persistedKarts.eng);
    for (const mac of state.karts.macs()) {
      if (mac.indexOf('DE:MO:') === 0) continue;   // Demo-Karts nie persistieren
      const kk = state.karts.get(mac);
      _kartsCal[mac] = kk.calibration;
      _kartsEngine[mac] = { totalMs: kk.engine.totalMs, lastServiceMs: kk.engine.lastServiceMs, serviceIntervalH: kk.engine.serviceIntervalH };
    }
    _persistedKarts.cal = _kartsCal;
    _persistedKarts.eng = _kartsEngine;
```

- [ ] **Step 3: loadData befüllt die Map** — in `loadData`, nach der `for (const mac of new Set(...))`-Schleife (nach deren schließender Klammer, vor `state.activeKartMac = ...`) einfügen:

```js
    Object.assign(_persistedKarts.cal, _cal);
    Object.assign(_persistedKarts.eng, _eng);
```

- [ ] **Step 4: kartFor hydratisiert neue Buckets** — in `kartFor`, direkt nach `const k = state.karts.get(key);` einfügen:

```js
  if (k && isNew && _persistedKarts.cal[key]) Object.assign(k.calibration, _persistedKarts.cal[key]);
  if (k && isNew && _persistedKarts.eng[key]) {
    const pe = _persistedKarts.eng[key];
    Object.assign(k.engine, {
      totalMs: Number(pe.totalMs) || 0,
      lastServiceMs: Number(pe.lastServiceMs) || 0,
      serviceIntervalH: pe.serviceIntervalH != null ? (Number(pe.serviceIntervalH) || 10) : 10,
    });
  }
```

- [ ] **Step 5: resetKarts-Dialogtext ehrlich machen** — in `pit-wall.js`:

Alt: `'Alle bekannten Karts vergessen? Namen/Farben bleiben erhalten.'`
Neu: `'Alle bekannten Karts vergessen? Namen/Farben, Kalibrierung und Motorstunden bleiben erhalten.'`

- [ ] **Step 6: forgetKart löscht Persist-Eintrag** — in `kart-bar.js` `forgetKart`, direkt nach `state.karts.forget(mac);` einfügen:

```js
    if (window.rasiPersistForget) window.rasiPersistForget(mac);
```

- [ ] **Step 7: Verifizieren**

Run: `node --check rasicross.js` / `node --check pit-wall.js` / `node --check kart-bar.js` — kein Output. `node --test` — PASS.
Grep-Tool: pattern `_persistedKarts` in `rasicross.js`, Expected ≥5 Treffer (Deklaration, Forget, saveData×2, loadData, kartFor).

- [ ] **Step 8: Commit**

```bash
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" add rasicross.js pit-wall.js kart-bar.js
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" commit -m "fix(multikart): Kalibrierung/Motorstunden ueberleben Karts-Reset (Persist-Map)"
```

---

### Task 4: Toast-Drossel bei Über-Limit-MAC (B2)

**Files:**
- Modify: `rasicross.js` (`processTelemetry`)

- [ ] **Step 1: Drossel einbauen** — vor `function processTelemetry(d) {` einfügen:

```js
// Phase 39: "Max Karts"-Hinweis nur einmal pro unbekannter MAC und Session —
// ohne Drossel wuerde ein 5. Kart bei ~12 Hz den Toast permanent halten.
const _maxKartsToasted = new Set();
```

Dann die Zeile

```js
    if (!k) { rcToast('Max. ' + KartRegistry.MAX_KARTS + ' Karts — ' + _mac + ' ignoriert', 4000); return; }
```

ersetzen durch:

```js
    if (!k) {
      if (!_maxKartsToasted.has(_mac)) {
        _maxKartsToasted.add(_mac);
        rcToast('Max. ' + KartRegistry.MAX_KARTS + ' Karts — ' + _mac + ' ignoriert', 4000);
      }
      return;
    }
```

- [ ] **Step 2: Verifizieren + Commit**

Run: `node --check rasicross.js` — kein Output.

```bash
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" add rasicross.js
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" commit -m "fix(multikart): Max-Karts-Toast nur einmal pro MAC statt pro Paket"
```

---

### Task 5: `kart-rank.js` + Konsumenten-Umstellung (B5)

**Files:**
- Create: `kart-rank.js`
- Modify: `RasiCross_Telemetry.html` (Script-Tag nach `lap-engine.js`)
- Modify: `map-draw.js` (`drawKartMarkersOn`)
- Modify: `kart-overview.js` (`render`, `buildProgress` entfällt)

**Interfaces:**
- Produces: `window.RasiKartRank.ranking(state, r)` → `{ ranked, posByMac, hasTrack }` oder `null` (kein laufendes Rennen / <2 Teilnehmer). `ranked` = Ausgabe von `RasiLapEngine.rankParticipants` (Einträge: `{mac,pos,laps,lapGap,distGapM,intervalLapGap,distIntM}`); `posByMac[mac]` = derselbe Eintrag. 250-ms-Memo; Track-Länge/Gate-Offset gecacht.
- Consumes: globale geo-Helfer `traceDistanceM`, `trackProgressM`, `lapProgressM` (geo.js) und `RasiLapEngine` (beide zur Laufzeit verfügbar).

- [ ] **Step 1: `kart-rank.js` anlegen** (kompletter Dateiinhalt):

```js
// ============================================================
//  RasiCross — kart-rank.js  (memoisiertes Live-Positions-Ranking)
// ============================================================
//  Phase 39: eine gemeinsame, gecachte Ranking-Quelle fuer map-draw
//  (60fps-Marker), kart-overview (Grid) und den Leaderboard-Strip.
//  Vorher rechneten map-draw und kart-overview trackProgressM ueber
//  alle Trackpunkte x Karts pro Frame doppelt. Browser-only.
//  Nutzt geo.js-Globals (traceDistanceM/trackProgressM/lapProgressM)
//  und RasiLapEngine — nur zur Laufzeit, kein Top-Level-Code.
// ============================================================
(function () {
  'use strict';

  const MEMO_MS = 250;
  let _memo = { at: 0, raceId: null, result: null };
  let _geom = { ptsRef: null, ptsLen: 0, gateLat: null, gateLon: null,
                trackLen: 0, gateOff: 0 };

  // Track-Laenge + Gate-Offset cachen — invalidiert bei neuer Punkte-
  // Referenz/-Laenge oder verschobenem Start-Gate.
  function trackGeom(state) {
    const pts = state.track && state.track.points;
    if (!pts || pts.length < 2) return { pts: null, trackLen: 0, gateOff: 0 };
    const g = state.startGate || {};
    if (_geom.ptsRef !== pts || _geom.ptsLen !== pts.length
        || _geom.gateLat !== g.lat || _geom.gateLon !== g.lon) {
      const trackLen = traceDistanceM(pts);
      const gateOff = (trackLen > 0 && g.lat)
        ? trackProgressM({ lat: g.lat, lon: g.lon }, pts) : 0;
      _geom = { ptsRef: pts, ptsLen: pts.length, gateLat: g.lat, gateLon: g.lon,
                trackLen, gateOff };
    }
    return { pts, trackLen: _geom.trackLen, gateOff: _geom.gateOff };
  }

  // Liefert { ranked, posByMac, hasTrack } oder null (kein laufendes Rennen
  // mit >=2 Teilnehmern). ranked/posByMac-Eintraege kommen 1:1 aus
  // RasiLapEngine.rankParticipants.
  function ranking(state, r) {
    try {
      if (!r || r.status !== 'running') return null;
      const parts = RasiLapEngine.participantsOf(r);
      if (parts.length < 2) return null;
      const now = Date.now();
      if (_memo.result && _memo.raceId === r.id && (now - _memo.at) < MEMO_MS) {
        return _memo.result;
      }
      const geom = trackGeom(state);
      const hasTrack = !!(geom.pts && geom.trackLen > 0);
      const prog = {};
      parts.forEach(p => {
        const kk = state.karts.has(p.mac) ? state.karts.get(p.mac) : null;
        const t = kk && kk.telemetry;
        prog[p.mac] = (hasTrack && t && t.lat && t.lon)
          ? lapProgressM(trackProgressM({ lat: t.lat, lon: t.lon }, geom.pts),
                         geom.gateOff, geom.trackLen)
          : null;
      });
      const ranked = RasiLapEngine.rankParticipants(r, prog);
      const posByMac = {};
      ranked.forEach(e => { posByMac[e.mac] = e; });
      const result = { ranked, posByMac, hasTrack };
      _memo = { at: now, raceId: r.id, result };
      return result;
    } catch (e) { console.warn('RasiKartRank.ranking:', e); return null; }
  }

  window.RasiKartRank = { ranking };
})();
```

- [ ] **Step 2: Script-Tag** — in `RasiCross_Telemetry.html` nach `<script src="lap-engine.js"></script>` einfügen:

```html
<script src="kart-rank.js"></script>
```

- [ ] **Step 3: map-draw.js umstellen** — in `drawKartMarkersOn` den Block von

```js
    const r = (typeof activeRace === 'function') ? activeRace() : null;
    let posByMac = null;
```

bis einschließlich

```js
    } else {
      // Kein aktives Ranking -> Overtake-State zuruecksetzen.
      _prevPosByMac = {};
      _overtakeAtByMac = {};
    }
```

ersetzen durch:

```js
    const r = (typeof activeRace === 'function') ? activeRace() : null;
    // Phase 39: gemeinsames, memoisiertes Ranking (kart-rank.js) statt
    // eigener trackProgressM-Rechnung pro Frame.
    const rr = window.RasiKartRank ? RasiKartRank.ranking(state, r) : null;
    let posByMac = null;
    if (rr) {
      posByMac = {};
      rr.ranked.forEach(e => { posByMac[e.mac] = e.pos; });
      // Phase 34: Aufsteiger -> Overtake-Ring-Zeitstempel; Vorpositionen merken.
      RasiLapEngine.positionGains(_prevPosByMac, rr.ranked).forEach(mac => { _overtakeAtByMac[mac] = now; });
      const _np = {};
      rr.ranked.forEach(e => { _np[e.mac] = e.pos; });
      _prevPosByMac = _np;
    } else {
      // Kein aktives Ranking -> Overtake-State zuruecksetzen.
      _prevPosByMac = {};
      _overtakeAtByMac = {};
    }
```

(Die Marker-Schleife darunter nutzt `posByMac[mac]` weiter als Positions-ZAHL — unverändert lassen.)

- [ ] **Step 4: kart-overview.js umstellen** — die Funktion `buildProgress` KOMPLETT löschen. In `render` den Block von

```js
    const r = (typeof activeRace === 'function') ? activeRace() : null;
```

bis einschließlich

```js
    } else {
      // Kein aktives Ranking -> Overtake-State zuruecksetzen (frischer Start).
      prevPosByMac = {};
      overtakeAtByMac = {};
    }
```

ersetzen durch:

```js
    const r = (typeof activeRace === 'function') ? activeRace() : null;
    // Phase 39: gemeinsames, memoisiertes Ranking aus kart-rank.js.
    const rr = window.RasiKartRank ? RasiKartRank.ranking(state, r) : null;
    const hasTrack = !!(rr && rr.hasTrack);
    // Phase 32: Halter der schnellsten Runde (lila Markierung), nur bei aktivem Ranking.
    const flHolder = rr ? RasiLapEngine.fastestLapHolder(r) : null;
    const posByMac = rr ? rr.posByMac : {};
    let orderedMacs = macs;
    if (rr) {
      orderedMacs = rr.ranked.map(e => e.mac).filter(m => macs.includes(m))
        .concat(macs.filter(m => !(m in posByMac)));
      // Phase 33: Aufsteiger erkennen -> Glow-Zeitstempel; Vorpositionen merken.
      RasiLapEngine.positionGains(prevPosByMac, rr.ranked).forEach(mac => { overtakeAtByMac[mac] = now; });
      const _np = {};
      rr.ranked.forEach(e => { _np[e.mac] = e.pos; });
      prevPosByMac = _np;
    } else {
      // Kein aktives Ranking -> Overtake-State zuruecksetzen (frischer Start).
      prevPosByMac = {};
      overtakeAtByMac = {};
    }
```

Achtung: die alte `const hasTrack = …track.points…`-Zeile und `const ranking = …`/`const flHolder = …`/`const posByMac = {}`-Deklarationen liegen innerhalb des ersetzten Blocks — nach dem Edit per Grep prüfen, dass `buildProgress` und `rankParticipants` in kart-overview.js nicht mehr vorkommen.

- [ ] **Step 5: Verifizieren**

Run: `node --check kart-rank.js` / `node --check map-draw.js` / `node --check kart-overview.js` — kein Output.
Grep-Tool: pattern `rankParticipants|buildProgress` in `map-draw.js` + `kart-overview.js` — Expected: 0 Treffer. Pattern `RasiKartRank` — Expected: Treffer in kart-rank.js, map-draw.js, kart-overview.js, RasiCross_Telemetry.html.

- [ ] **Step 6: Commit**

```bash
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" add kart-rank.js map-draw.js kart-overview.js RasiCross_Telemetry.html
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" commit -m "perf(multikart): memoisiertes Ranking-Modul kart-rank.js statt 60fps-Doppelrechnung"
```

---

### Task 6: `metaFor` schreibt localStorage nur bei Neuanlage (B4)

**Files:**
- Modify: `kart-bar.js`

- [ ] **Step 1: Dirty-Flag einführen** — `metaFor` ersetzen. Alt:

```js
  function metaFor(meta, mac, idx) {
    if (!meta[mac]) meta[mac] = { name: 'Kart ' + (idx + 1), color: PALETTE[idx % PALETTE.length] };
    return meta[mac];
  }
```

Neu:

```js
  // Phase 39: nur bei tatsaechlicher Neuanlage dirty markieren — vorher
  // schrieb jeder Render-Aufruf (Grid bis 5 Hz) in localStorage.
  let _metaDirty = false;
  function metaFor(meta, mac, idx) {
    if (!meta[mac]) {
      meta[mac] = { name: 'Kart ' + (idx + 1), color: PALETTE[idx % PALETTE.length] };
      _metaDirty = true;
    }
    return meta[mac];
  }
  function saveMetaIfDirty(meta) {
    if (_metaDirty) { saveMeta(meta); _metaDirty = false; }
  }
```

- [ ] **Step 2: Aufrufer umstellen** — in `render(state)` die letzte Zeile `saveMeta(meta);` ersetzen durch `saveMetaIfDirty(meta);`. In `metaForState` die Zeile `saveMeta(meta);` ersetzen durch `saveMetaIfDirty(meta);`.

(Die expliziten `saveMeta(state.kartMeta)`-Aufrufe im Editor — Name/Farbe geändert — bleiben unverändert, das sind echte Writes.)

- [ ] **Step 3: Verifizieren + Commit**

Run: `node --check kart-bar.js` — kein Output.
Grep-Tool: pattern `saveMetaIfDirty` in kart-bar.js — Expected: 3 Treffer (Definition + 2 Aufrufer).

```bash
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" add kart-bar.js
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" commit -m "perf(multikart): kart-meta localStorage-Write nur noch bei Neuanlage"
```

---

### Task 7: Valides Chip-Markup + Focus-Erhalt + Popover-Fix (B6, U3)

**Files:**
- Modify: `kart-bar.js` (`render`, `openEditor`-Outside-Click)
- Modify: `RasiCross_Telemetry.html` (CSS `.kart-chip` / neu `.kart-chip-main`)

- [ ] **Step 1: Chip-Markup umbauen** — in `render(state)` den `macs.forEach`-Body ersetzen. Alt (Kern):

```js
      const chip = document.createElement('button');
      let cls = 'kart-chip' + (mac === state.activeKartMac && state.liveView !== 'overview' ? ' active' : '');
      chip.style.borderColor = m.color;
      const age = k.connection.lastPacketAt ? (Date.now() - k.connection.lastPacketAt) : 99999;
      const rec = k.recording.armed ? ' ●REC' : '';
      const rssi = (k.connection.rssi != null) ? (k.connection.rssi + 'dBm') : '--';
      const hz = (state._kartHz && state._kartHz[mac] != null) ? state._kartHz[mac] : '--';
      if (age > 2000) cls += ' stale';
      chip.className = cls;
      chip.title = mac;
      chip.innerHTML = '<b style="color:' + m.color + '">' + escHtml(m.name) + '</b>'
        + ' <span>' + hz + 'Hz</span> <span>' + rssi + '</span>'
        + (k.batt && k.batt.present ? ' <span>' + (k.batt.soc | 0) + '%</span>' : '')
        + rec
        + ' <button class="kart-edit" title="Umbenennen / Farbe / Vergessen" data-mac="' + mac + '">✏</button>';
      chip.onclick = (ev) => {
        if (ev.target && ev.target.classList.contains('kart-edit')) {
          ev.stopPropagation();
          openEditor(state, mac, ev.target);
          return;
        }
        if (state.karts.setActive(mac)) {
          state.activeKartMac = mac;
          // Chip-Klick wählt immer die Einzelansicht dieses Karts.
          if (window.setLiveView) window.setLiveView('single'); else render(state);
        }
      };
      el.appendChild(chip);
```

Neu (valide: `div`-Container mit zwei Geschwister-Buttons — kein Button-in-Button mehr):

```js
      const chip = document.createElement('div');
      let cls = 'kart-chip' + (mac === state.activeKartMac && state.liveView !== 'overview' ? ' active' : '');
      chip.style.borderColor = m.color;
      const age = k.connection.lastPacketAt ? (Date.now() - k.connection.lastPacketAt) : 99999;
      const rec = k.recording.armed ? ' ●REC' : '';
      const rssi = (k.connection.rssi != null) ? (k.connection.rssi + 'dBm') : '--';
      const hz = (state._kartHz && state._kartHz[mac] != null) ? state._kartHz[mac] : '--';
      if (age > 2000) cls += ' stale';
      chip.className = cls;
      chip.title = mac;
      chip.innerHTML = '<button type="button" class="kart-chip-main" data-mac="' + mac + '">'
        + '<b style="color:' + m.color + '">' + escHtml(m.name) + '</b>'
        + ' <span>' + hz + 'Hz</span> <span>' + rssi + '</span>'
        + (k.batt && k.batt.present ? ' <span>' + (k.batt.soc | 0) + '%</span>' : '')
        + rec + '</button>'
        + '<button type="button" class="kart-edit" title="Umbenennen / Farbe / Vergessen" data-mac="' + mac + '">✏</button>';
      chip.querySelector('.kart-chip-main').onclick = () => {
        if (state.karts.setActive(mac)) {
          state.activeKartMac = mac;
          // Chip-Klick wählt immer die Einzelansicht dieses Karts.
          if (window.setLiveView) window.setLiveView('single'); else render(state);
        }
      };
      chip.querySelector('.kart-edit').onclick = (ev) => {
        ev.stopPropagation();
        openEditor(state, mac, ev.target);
      };
      el.appendChild(chip);
```

- [ ] **Step 2: Focus-Erhalt beim Rebuild** — in `render(state)` direkt VOR `el.innerHTML = '';` einfügen:

```js
    // Focus ueber den 1-Hz-Rebuild retten (Tastatur-Nutzer, Phase 38-Linie).
    const _fe = document.activeElement;
    const _feMac = _fe && el.contains(_fe) ? _fe.getAttribute('data-mac') : null;
    const _feEdit = !!(_feMac && _fe.classList.contains('kart-edit'));
```

und am Ende von `render` (nach der `macs.forEach`-Schleife, vor `saveMetaIfDirty(meta);`) einfügen:

```js
    if (_feMac) {
      const _sel = _feEdit ? '.kart-edit[data-mac="' + _feMac + '"]'
                           : '.kart-chip-main[data-mac="' + _feMac + '"]';
      const _re = el.querySelector(_sel);
      if (_re) _re.focus();
    }
```

- [ ] **Step 3: Popover-Outside-Click anker-unabhängig** — in `openEditor` die Zeile

```js
    _onDocClick = (ev) => { if (!pop.contains(ev.target) && ev.target !== anchorEl) closeEditor(); };
```

ersetzen durch:

```js
    // Anker-Element wird beim 1-Hz-Rebuild ersetzt -> gegen Klasse statt
    // Identitaet pruefen, sonst schliesst der Klick aufs (neue) ✏ sofort wieder.
    _onDocClick = (ev) => {
      if (!pop.contains(ev.target)
          && !(ev.target.closest && ev.target.closest('.kart-edit'))) closeEditor();
    };
```

- [ ] **Step 4: CSS** — in `RasiCross_Telemetry.html` den Block

```css
/* Multi-Kart Verwaltung: Edit-Icon am Chip */
.kart-chip .kart-edit{cursor:pointer;opacity:.6;margin-left:2px;font-size:11px;
  background:none;border:none;color:inherit;padding:0 2px;line-height:1}
.kart-chip .kart-edit:hover{opacity:1}
```

ersetzen durch:

```css
/* Multi-Kart Verwaltung: Haupt-Button + Edit-Icon als Geschwister im Chip
   (Phase 39: kein Button-in-Button mehr — valides HTML, Tastatur-bedienbar) */
.kart-chip .kart-chip-main{display:inline-flex;align-items:center;gap:6px;
  background:none;border:none;color:inherit;font:inherit;padding:0;
  cursor:pointer;white-space:nowrap}
.kart-chip .kart-edit{cursor:pointer;opacity:.6;margin-left:2px;font-size:11px;
  background:none;border:none;color:inherit;padding:0 2px;line-height:1}
.kart-chip .kart-edit:hover{opacity:1}
```

- [ ] **Step 5: Verifizieren + Commit**

Run: `node --check kart-bar.js` — kein Output.
Grep-Tool: pattern `kart-chip-main` — Expected: Treffer in kart-bar.js (Markup+Focus) und RasiCross_Telemetry.html (CSS).

```bash
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" add kart-bar.js RasiCross_Telemetry.html
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" commit -m "fix(multikart): valides Chip-Markup, Focus-Erhalt, Popover-Outside-Click"
```

---

### Task 8: Übersicht-Karten aufwerten (U1)

**Files:**
- Modify: `kart-overview.js` (`render`-Kartenaufbau)
- Modify: `RasiCross_Telemetry.html` (CSS `.ko-foot`)

**Interfaces:**
- Consumes: `rr`/`posByMac` aus Task 5 (bereits in `render` vorhanden), `RasiLapEngine.partOf` aus Task 1.

- [ ] **Step 1: Kartenaufbau erweitern** — in `render` innerhalb `el.innerHTML = orderedMacs.map(mac => {…})` den Abschnitt ab `const lapCur = …` bis zum `return`-Template ersetzen. Alt:

```js
      const lapCur = k.lapStart ? lap(now - k.lapStart) : '--:--.---';
      const lapBest = lap(k.bestLapMs);
      // Phase 30: Rundenzahl dieses Karts im aktiven Rennen (Teilnehmer-Slot).
      const _part = (r && r.participants) ? r.participants[mac] : null;
      const lapCount = _part ? RasiLapEngine.partValidLaps(_part).length : 0;
      const bestNum = k.bestLapNum
        ? ('Runde ' + lapCount + ' · Best R' + k.bestLapNum)
        : (lapCount ? ('Runde ' + lapCount) : 'Noch keine Rundenzeit');
```

Neu:

```js
      const lapCur = k.lapStart ? lap(now - k.lapStart) : '--:--.---';
      const lapBest = lap(k.bestLapMs);
      // Phase 30: Rundenzahl dieses Karts im aktiven Rennen (Teilnehmer-Slot).
      const _part = RasiLapEngine.partOf(r, mac);
      const lapCount = _part ? RasiLapEngine.partValidLaps(_part).length : 0;
      // Phase 39: letzte Runde + aktueller Fahrer dieses Karts.
      const _lastLap = _part && _part.laps.length ? _part.laps[_part.laps.length - 1] : null;
      const lapLast = _lastLap ? lap(_lastLap.timeMs) : '--:--.---';
      const _drv = (_part && _part.currentDriverId)
        ? state.drivers.find(d => d.id === _part.currentDriverId) : null;
      const bestNum = (k.bestLapNum
        ? ('Runde ' + lapCount + ' · Best R' + k.bestLapNum)
        : (lapCount ? ('Runde ' + lapCount) : 'Noch keine Rundenzeit'))
        + (_drv ? ' · ' + esc(_drv.name) : '');
```

und im `return`-Template die Zeilen

```js
        + '<div class="ko-row"><span class="ko-l">Aktuelle Runde</span><span class="ko-v">' + lapCur + '</span></div>'
        + '<div class="ko-row"><span class="ko-l">Beste Runde</span><span class="' + bestCls + '">' + lapBest + '</span></div>'
        + '<div class="ko-sub">' + bestNum + '</div>' + gapRow
        + '</div>';
```

ersetzen durch:

```js
        + '<div class="ko-row"><span class="ko-l">Aktuelle Runde</span><span class="ko-v">' + lapCur + '</span></div>'
        + '<div class="ko-row"><span class="ko-l">Letzte Runde</span><span class="ko-v">' + lapLast + '</span></div>'
        + '<div class="ko-row"><span class="ko-l">Beste Runde</span><span class="' + bestCls + '">' + lapBest + '</span></div>'
        + '<div class="ko-sub">' + bestNum + '</div>' + gapRow
        + '<div class="ko-foot">' + foot + '</div>'
        + '</div>';
```

und direkt vor dem `return`-Template die Fußzeile berechnen:

```js
      // Phase 39: Verbindungs-Fusszeile; bei stale stattdessen Paket-Alter.
      const _hz = (state._kartHz && state._kartHz[mac] != null) ? state._kartHz[mac] : '--';
      const _rssi = (k.connection.rssi != null) ? (k.connection.rssi + ' dBm') : '--';
      const _batt = (k.batt && k.batt.present) ? ' · ' + (k.batt.soc | 0) + '%' : '';
      const foot = stale
        ? ('⚠ vor ' + Math.round(age / 1000) + ' s')
        : (_rssi + ' · ' + _hz + ' Hz' + _batt);
```

- [ ] **Step 2: CSS** — in `RasiCross_Telemetry.html` nach der Zeile `.ko-card .ko-sub{font-size:11px;color:var(--mut)}` einfügen:

```css
.ko-card .ko-foot{font-family:var(--mono);font-size:10.5px;color:var(--mut);
  border-top:1px solid var(--bor,#2a3140);padding-top:5px;margin-top:2px;
  font-variant-numeric:tabular-nums}
.ko-card.stale .ko-foot{color:var(--orange,#f0a050)}
```

- [ ] **Step 3: Verifizieren + Commit**

Run: `node --check kart-overview.js` — kein Output.
Grep-Tool: pattern `ko-foot` — Treffer in kart-overview.js + HTML; pattern `Letzte Runde` in kart-overview.js — 1 Treffer.

```bash
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" add kart-overview.js RasiCross_Telemetry.html
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" commit -m "feat(multikart): Uebersicht-Karten mit letzter Runde, Fahrer, RSSI/Hz/Akku, Stale-Alter"
```

---

### Task 9: Leaderboard-Strip in der Einzelansicht (U2)

**Files:**
- Modify: `RasiCross_Telemetry.html` (Element nach `#kartBar` + CSS)
- Modify: `live-ui.js` (`renderLeaderStrip` + Loop-Aufrufe + Interface-Marker)

**Interfaces:**
- Consumes: `RasiKartRank.ranking` (Task 5), `RasiLapEngine.fastestLapHolder`, `RasiKartBar.metaFor`, globales `esc`, `$`.

- [ ] **Step 1: HTML-Element** — nach `<div id="kartBar" class="kart-bar"></div>` einfügen:

```html
  <!-- Phase 39: Leaderboard-Strip (Einzelansicht, laufendes Rennen, >=2 Teilnehmer) -->
  <div id="liveLeaderStrip" class="leader-strip"></div>
```

- [ ] **Step 2: CSS** — nach dem `.kart-overview-btn.active{…}`-Block einfügen:

```css
/* Phase 39: Leaderboard-Strip unter der Chip-Leiste (nur Einzelansicht) */
.leader-strip{display:none;gap:8px;flex-wrap:wrap;margin:0 0 10px}
.ls-item{display:inline-flex;align-items:center;gap:6px;cursor:pointer;
  background:var(--panel,#161a22);color:var(--fg,#e8edf4);
  border:1px solid var(--bor,#2a3140);border-radius:999px;padding:4px 10px;
  font-size:12px;font-family:var(--mono);line-height:1.2;white-space:nowrap;
  font-variant-numeric:tabular-nums}
.ls-item.active{border-color:#3aa0e8;box-shadow:0 0 0 1px rgba(58,160,232,.35)}
.ls-item .ls-dot{width:9px;height:9px;border-radius:50%;flex:0 0 auto}
.ls-item .ls-gap{opacity:.7}
body[data-live-view="overview"] #liveLeaderStrip{display:none !important}
```

- [ ] **Step 3: renderLeaderStrip** — in `live-ui.js` direkt VOR `function refreshOverview()` einfügen:

```js
// Phase 39: Leaderboard-Strip (Einzelansicht). Zeigt P1..Pn mit Interval zum
// Vordermann; Klick waehlt den Kart. Versteckt ohne laufendes Rennen/<2
// Teilnehmern oder in der Uebersicht. HTML-Diff vermeidet Rebuild-Flackern.
let _lastLeaderStripHtml = '';
function renderLeaderStrip() {
  try {
    const el = $('liveLeaderStrip');
    if (!el) return;
    const r = (typeof activeRace === 'function') ? activeRace() : null;
    const rr = (state.liveView !== 'overview' && window.RasiKartRank)
      ? RasiKartRank.ranking(state, r) : null;
    if (!rr) {
      if (el.style.display !== 'none') { el.style.display = 'none'; _lastLeaderStripHtml = ''; }
      return;
    }
    const fl = RasiLapEngine.fastestLapHolder(r);
    const macs = state.karts.macs();
    const html = rr.ranked.map(e => {
      const idx = Math.max(0, macs.indexOf(e.mac));
      const m = window.RasiKartBar ? RasiKartBar.metaFor(state, e.mac, idx)
                                   : { name: e.mac, color: '#3aa0e8' };
      const gap = e.pos === 1 ? ''
        : (rr.hasTrack
            ? (e.intervalLapGap > 0 ? '+' + e.intervalLapGap + ' Rd.' : '+' + Math.round(e.distIntM) + ' m')
            : '--');
      const flMark = (fl && fl.mac === e.mac) ? ' ⚡' : '';
      const act = e.mac === state.activeKartMac ? ' active' : '';
      return '<button type="button" class="ls-item' + act + '" data-mac="' + e.mac + '">'
        + '<b>P' + e.pos + '</b>'
        + '<span class="ls-dot" style="background:' + m.color + '"></span>'
        + '<span class="ls-name" style="color:' + m.color + '">' + esc(m.name) + flMark + '</span>'
        + (gap ? '<span class="ls-gap">' + gap + '</span>' : '')
        + '</button>';
    }).join('');
    el.style.display = 'flex';
    if (html === _lastLeaderStripHtml) return;
    _lastLeaderStripHtml = html;
    el.innerHTML = html;
    el.querySelectorAll('.ls-item').forEach(b => {
      b.onclick = () => {
        const mac = b.getAttribute('data-mac');
        if (state.karts.setActive(mac)) {
          state.activeKartMac = mac;
          if (window.setLiveView) setLiveView('single');
        }
      };
    });
  } catch (e) { console.warn('renderLeaderStrip:', e); }
}
```

- [ ] **Step 4: Loop-Aufrufe** — in `initLiveUiLoops`:
  - Im 200-ms-Tick `refreshOverview();` ersetzen durch `refreshOverview(); renderLeaderStrip();`
  - Im 1-Hz-Loop nach `refreshOverview();` eine Zeile `renderLeaderStrip();` einfügen.
  - Im Interface-Marker-Array am Dateiende `renderLeaderStrip` mit aufnehmen (nach `refreshOverview`).

- [ ] **Step 5: Verifizieren + Commit**

Run: `node --check live-ui.js` — kein Output.
Grep-Tool: pattern `renderLeaderStrip` in live-ui.js — Expected: 4 Treffer (Definition, 2 Loop-Aufrufe, Interface-Marker).

```bash
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" add live-ui.js RasiCross_Telemetry.html
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" commit -m "feat(multikart): Leaderboard-Strip in der Einzelansicht"
```

---

### Task 10: Multikart-Demo — 3 simulierte Karts (L1)

**Files:**
- Modify: `serial-demo.js` (`startDemo`, `stopDemo`, `demoTick`)
- Modify: `rasicross.js` (`kartFor`: Demo-MACs adoptieren default-Bucket nicht)

**Interfaces:**
- Consumes: `kartFor(mac)` (rasicross.js, global), `processTelemetry`, `onGpsUpdate`.

- [ ] **Step 1: Demo-Kart-Definitionen** — in `serial-demo.js` direkt VOR `function startDemo()` einfügen:

```js
// Phase 39: 3 simulierte Karts — unterschiedliche Pace (~2-3 % Spreizung)
// erzeugt Ueberholvorgaenge und plausible Gaps; Phasenversatz trennt sie
// auf der Strecke. RSSI/SoC je Kart verschieden fuer realistische Chips.
const DEMO_KART_DEFS = [
  { mac: 'DE:MO:RA:SI:00:01', name: 'Demo 1', color: '#3aa0e8', pace: 1.000, phase: 0.0, rssi: -52, soc0: 92 },
  { mac: 'DE:MO:RA:SI:00:02', name: 'Demo 2', color: '#e8a13a', pace: 0.985, phase: 1.6, rssi: -63, soc0: 74 },
  { mac: 'DE:MO:RA:SI:00:03', name: 'Demo 3', color: '#5ad17a', pace: 0.968, phase: 3.2, rssi: -71, soc0: 55 },
];
```

- [ ] **Step 2: startDemo erweitert** — nach `state.connection.kartMac = 'DE:MO:00:00:00:02';` einfügen:

```js
  // Phase 39: Demo-Karts VOR dem Auto-Race registrieren, damit startRace()
  // alle drei als Teilnehmer aufnimmt (kein Nachzuegler-/default-Slot).
  state.demo.karts = DEMO_KART_DEFS.map(def => ({
    mac: def.mac, pace: def.pace, rssi: def.rssi,
    angle: -Math.PI / 2 - def.phase, seq: 0, soc: def.soc0,
  }));
  state.kartMeta = state.kartMeta || {};
  DEMO_KART_DEFS.forEach(def => {
    kartFor(def.mac);
    if (!state.kartMeta[def.mac]) state.kartMeta[def.mac] = { name: def.name, color: def.color };
  });
  state.karts.setActive(DEMO_KART_DEFS[0].mac);
  state.activeKartMac = DEMO_KART_DEFS[0].mac;
  if (window.RasiKartBar) RasiKartBar.render(state);
```

- [ ] **Step 3: demoTick multi-kart** — die komplette Funktion `demoTick` ersetzen durch:

```js
function demoTick() {
  try {
    state.demo.t += 0.08;
    const C = { lat: 49.6, lon: 6.12 };
    const RAD = 0.00033, WOB = 0.000028;
    const tt = state.demo.t;
    state._kartHz = state._kartHz || {};
    for (const dk of (state.demo.karts || [])) {
      dk.angle += ((Math.PI * 2) / 1038) * dk.pace;   // ~83 s/Runde x Pace
      const a = dk.angle;
      const wob = WOB * Math.sin(a * 4.5 + 0.3);
      const lat = C.lat + Math.sin(a) * RAD * 0.62 + wob;
      const lon = C.lon + Math.cos(a) * RAD + wob;
      const curvature = Math.abs(Math.cos(a * 2));
      const speed = Math.max(0, (72 - 40 * curvature + 6 * Math.sin(tt * 0.3 + a) + Math.random() * 4) * dk.pace);
      const rpm = Math.max(800, 4500 + 4200 * Math.abs(Math.sin(tt * 0.45 + a)) - 3000 * curvature + 300 * Math.sin(tt * 2.1));
      const gx = 0.6 * Math.sin(tt * 1.9 + a) + 0.08 * (Math.random() - 0.5);
      const gy = (2.1 - 1.2 * curvature) * Math.sin(a * 2 + 0.2) + 0.15 * (Math.random() - 0.5);
      dk.seq = (dk.seq + 1) % 65536;
      dk.soc = Math.max(5, dk.soc - 0.0009);          // langsam fallender Akku
      const pkt = {
        speed, rpm, gx, gy, lat, lon,
        gps_fix: 1, fix: 1,
        seq: dk.seq, from_mac: dk.mac,
        rssi: dk.rssi + Math.round(Math.random() * 6 - 3),
      };
      if (dk.seq % 25 === 0) {                         // Batterie ~alle 2 s
        pkt.soc = Math.round(dk.soc);
        pkt.vbat = +(10.5 + 2.1 * (dk.soc / 100)).toFixed(2);
      }
      state._kartHz[dk.mac] = 12;                      // 80-ms-Tick ≈ 12 Hz
      processTelemetry(pkt);
      if (dk.mac === state.activeKartMac) onGpsUpdate(lat, lon);
    }
  } catch (e) { console.warn('demoTick:', e); }
}
```

- [ ] **Step 4: stopDemo räumt Demo-Karts auf** — in `stopDemo` NACH dem Demo-Race-Aufräum-Block (nach `state.demo.autoRaceId = null;`) einfügen:

```js
  // Phase 39: Demo-Karts aus Registry + Hz-Liste entfernen (Meta/Namen
  // bleiben in localStorage erhalten; DE:MO:* wird nie persistiert).
  (state.demo.karts || []).forEach(dk => {
    state.karts.forget(dk.mac);
    if (state._kartHz) delete state._kartHz[dk.mac];
  });
  state.demo.karts = [];
  state.activeKartMac = state.karts.activeMac();
  if (window.RasiKartBar) RasiKartBar.render(state);
  if (window.renderConnectionTab) renderConnectionTab();
```

- [ ] **Step 5: kartFor-Demo-Guard** — in `rasicross.js` `kartFor` die Adoptions-Bedingung erweitern. Alt:

```js
  if (k && isNew && key !== KartRegistry.DEFAULT_MAC && state.karts.has(KartRegistry.DEFAULT_MAC)) {
```

Neu (Demo-Karts adoptieren die Kalibrierung/Motorstunden des default-Buckets NICHT):

```js
  if (k && isNew && key !== KartRegistry.DEFAULT_MAC && key.indexOf('DE:MO:') !== 0
      && state.karts.has(KartRegistry.DEFAULT_MAC)) {
```

- [ ] **Step 6: Verifizieren + Commit**

Run: `node --check serial-demo.js` / `node --check rasicross.js` — kein Output. `node --test` — PASS.
Grep-Tool: pattern `DEMO_KART_DEFS` in serial-demo.js — Expected: 3 Treffer (Definition + startDemo×2).

```bash
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" add serial-demo.js rasicross.js
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" commit -m "feat(multikart): Demo-Modus simuliert 3 Karts (Chips/Ranking/Marker ohne Hardware)"
```

---

### Task 11: Gesamtverifikation + Plan-Doc-Commit

- [ ] **Step 1: Voll-Verifikation**

```bash
node --check geo.js; node --check lap-engine.js; node --check kart-rank.js; node --check kart-registry.js; node --check kart-bar.js; node --check kart-overview.js; node --check map-draw.js; node --check races.js; node --check pit-wall.js; node --check laps-drivers.js; node --check live-ui.js; node --check serial-demo.js; node --check rasicross.js
node --test
```

Expected: keine Syntax-Fehler; alle Tests PASS (bestehende Baseline + 2 neue partOf-Tests).

- [ ] **Step 2: Grep-Statik-Checks** (Grep-Tool):
  - `getOrCreatePart` → nur lap-engine.js, rasicross.js (Nachzügler), races.js (startRace).
  - `RasiKartRank` → kart-rank.js, map-draw.js, kart-overview.js, live-ui.js, HTML.
  - `saveMeta\(` in kart-bar.js → nur noch Editor-Handler + saveMetaIfDirty-Definition.

- [ ] **Step 3: Plan- + Spec-Doc committen**

```bash
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" add docs/superpowers/plans/2026-07-02-39-multikart-improvements.md
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" commit -m "docs(plan): Phase 39 Multikart-Verbesserungen Implementierungsplan"
```

---

## Manual Acceptance Checklist (Demo-Modus, ohne Hardware — durch den User)

1. App starten → Verbindung-Tab → Demo starten: **3 Chips** („Demo 1/2/3", Farben blau/orange/grün) + Übersicht-Button erscheinen; Chips zeigen Hz/RSSI.
2. Live-Tab: **Leaderboard-Strip** unter der Chip-Leiste (P1/P2/P3 mit Meter-Gaps); nach einigen Minuten Überholvorgänge (Pace-Spreizung) → Gold-Glow im Grid + Ring auf der Karte.
3. Übersicht-Button: Grid mit 3 Karten — Speed, **Aktuelle/Letzte/Beste Runde**, Fahrer im Sub-Text, Fußzeile RSSI/Hz/Akku; ⚡FL beim Schnellsten.
4. Karte (Einzelansicht): 3 farbige Marker mit P-Nummern.
5. Kart-Chip ✏ → Umbenennen/Farbe: Popover bleibt beim Tippen offen, Chip-Leiste aktualisiert live; Escape/Outside-Click schließt.
6. Verbindung-Tab → „Karts zurücksetzen" → Demo neu starten → Einstellungen: Motorstunden/Kalibrierung unverändert (Persist-Map). 
7. Demo stoppen: Chips verschwinden, Demo-Race ohne gültige Runden wird entfernt, kein Demo-Kart im Verbindung-Tab.
8. Tastatur: Tab-Fokus erreicht Chip UND ✏ getrennt; Fokus überlebt den Sekunden-Refresh.

## Self-Review

- **Spec-Abdeckung:** D1→Task 3, D2→Task 4, D3→Tasks 1+2, D4→Task 5, D5→Task 6, D6→Task 7, D7→Task 8, D8→Task 9, D9→Task 10. Nicht-Ziele (per-Kart-OLED, Python) unberührt. ✔
- **Platzhalter-Scan:** alle Steps enthalten vollständigen Code/exakte Anker. ✔
- **Typ-/Namens-Konsistenz:** `partOf(r, mac)` (Tasks 1/2/8), `RasiKartRank.ranking(state, r)` → `{ranked, posByMac, hasTrack}` (Tasks 5/9), `saveMetaIfDirty` (Tasks 6/7-Anker), `rasiPersistForget` (Tasks 3/3.6), `DEMO_KART_DEFS`/`state.demo.karts` (Task 10). ✔

## Phase Map

- Phase 28–36: Multikart-Grundgerüst (Registry, Fassade, per-Kart-Laps, Leaderboard, Overlay, Gaps) — merged.
- Phase 37: MPU-9250 + GPS 5 Hz — merged. Phase 38: UX-Polish — merged.
- **Phase 39 (dieser Plan): Multikart-Bugfixes + UI + Demo.**
- Kandidat Phase 40: per-Kart-OLED-Display-Routing (aus Spec-Nicht-Zielen).
