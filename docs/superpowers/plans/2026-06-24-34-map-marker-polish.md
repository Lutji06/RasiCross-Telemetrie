# Phase 34 — Map-Marker-Polish (Overtake-Ring + Label-Declutter) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Auf der Live-Streckenkarte bekommt ein kurz zuvor aufgestiegener Kart einen goldenen Ring um seinen Marker, und überlappende `P{pos}`-Labels werden vertikal entzerrt (Marker bleiben an ihrer echten GPS-Position).

**Architecture:** Eine reine, TDD'd `declutterLabels`-Funktion kommt in `geo.js`. `map-draw.js` `drawKartMarkersOn` bekommt eigenen modul-lokalen Overtake-State (via Phase-33 `positionGains`), zeichnet den goldenen Ring und nutzt `declutterLabels` zum Entzerren der Labels. Reine Logik per `node:test`, Canvas-Verdrahtung per `node --check` + ESLint + Grep.

**Tech Stack:** Vanilla JS (Browser-Globals / UMD-IIFE), Canvas 2D, `node:test`, ESLint 9 (Flat-Config). Verifikation: `node --check`, `node --test`, `eslint`, Python-Baselines (`py_compile`/`unittest`).

**Spec:** `docs/superpowers/specs/2026-06-24-map-marker-polish-design.md`

## Global Constraints

- Repo-Root: `C:/Users/jimlu/Documents/RasiCross-Telemetrie-git`. Branch: `feat/map-marker-polish` (auf Phase 33 / PR #52 gestapelt).
- **Dateien sind CRLF.** Unmittelbar vor jedem `Edit` die Zielstelle frisch in-session lesen und den Anker aus diesem Read kopieren — Zeilennummern hier sind indikativ, auf Text ankern.
- Verifikation mit dem **Grep-Tool** (nicht Shell-`grep`).
- **Niemals `.claude/` committen**, Plan-/Spec-Doc nur im expliziten Doc-Commit (Task 3).
- Commit-Messages: conventional + kurzer Body + Trailer `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- `__pycache__` vor jedem `git status`/commit löschen.
- **Verhalten unverändert für Single-Kart / <2 Teilnehmer / kein Rennen:** keine Ringe, keine Labels, kein Declutter — Marker exakt wie Phase 33 (Regression).
- **Overtake-/Declutter-Logik ist abgeleitet/rein:** kein persistierter State; map-draw-Overtake-State ist modul-lokal.
- **Marker bleiben an echter GPS-Position** — nur P-Label-Text wird vertikal verschoben.
- **`lap-engine.js`, `kart-overview.js`, `RasiCross_Telemetry.html` und alle übrigen Dateien bleiben unverändert** (außer `geo.js`/`test/geo.test.js`/`map-draw.js`/`eslint.config.js`).
- **Verifikationsrezept (pro Task wo relevant + final):**
  - `node --check <berührte .js>`
  - `node --test` (muss grün bleiben/wachsen; aktuell **157** + 5 neue = **162**)
  - `npx eslint <berührte .js>` → 0 Fehler
  - `python -m py_compile bridge.py` + `python -m unittest discover -s test -p "test_*.py"` → **50 OK** (Python unverändert)
  - Python kann `python` oder `py -3` sein.

---

## File Structure

| Aktion | Datei | Verantwortung |
|--------|-------|---------------|
| Ändern | `geo.js` | Neue reine `declutterLabels(points, minGapY, minGapX)`; im UMD-`api`-Export aufnehmen. |
| Ändern | `test/geo.test.js` | `node:test`-Fälle für `declutterLabels`; Export-Liste erweitern. |
| Ändern | `eslint.config.js` | `declutterLabels: 'readonly'` in `geoGlobals`. |
| Ändern | `map-draw.js` | Modul-State `_prevPosByMac`/`_overtakeAtByMac`/`MARKER_OVERTAKE_MS`; goldener Overtake-Ring je Marker; Label-Anker sammeln + via `declutterLabels` entzerrt zeichnen. |

**Task-Reihenfolge:** 1 (geo `declutterLabels` + Tests + geoGlobals) → 2 (map-draw Overtake-Ring + Label-Declutter) → 3 (finale Verifikation + Plan-Doc).

> **Verifikationsstrategie:** `declutterLabels` wird per `node:test` TDD'd. Canvas-Verdrahtung (Ring/Label): `node --check` + ESLint + Grep-Asserts + grüne Baselines. Funktionales Zwei-Kart-Verhalten bleibt manuell (Hardware, §7 Spec).

---

## Task 1: `geo.js` — `declutterLabels` (Pure-Logik, TDD)

**Files:**
- Modify: `geo.js` (neue Funktion vor dem UMD-Export ~Zeile 123; `api`-Objekt ~Zeile 126–132)
- Modify: `test/geo.test.js` (Export-Liste ~Zeile 9–11; neue Tests am Dateiende)
- Modify: `eslint.config.js` (`geoGlobals` ~Zeile 16)

**Interfaces:**
- Consumes: nichts (rein über Parameter).
- Produces (von Task 2 konsumiert), als Browser-Global + `module.exports`:
  - `declutterLabels(points, minGapY, minGapX)` → `Array` angepasster y-Werte (gleiche Länge/Reihenfolge wie `points = [{x,y}]`), sodass keine zwei Labels mit x-Abstand `< minGapX` einen y-Abstand `< minGapY` haben (greedy von oben, nur nach unten geschoben).

- [ ] **Step 1: Export-Liste im Test erweitern (failing)**

Lies `test/geo.test.js` frisch um die Export-Liste (Grep `module exports all 9 helpers`). Ersetze:

```js
test('module exports all 9 helpers', () => {
  for (const name of ['fmtMs','fmtClock','fmtDelta','traceDistanceM','gpsDist',
                       'headingFromPoints','segmentsCross','crossingDirectionOk',
                       'lineEndpointsFromGate']) {
```

durch:

```js
test('module exports all 10 helpers', () => {
  for (const name of ['fmtMs','fmtClock','fmtDelta','traceDistanceM','gpsDist',
                       'headingFromPoints','segmentsCross','crossingDirectionOk',
                       'lineEndpointsFromGate','declutterLabels']) {
```

- [ ] **Step 2: Neue Tests ans Dateiende anhängen (failing)**

Lies das Ende von `test/geo.test.js` frisch und füge **nach** dem letzten `test(...)`-Block (am Dateiende) ein:

```js

test('declutterLabels leaves non-colliding labels unchanged', () => {
  const pts = [{ x: 0, y: 0 }, { x: 0, y: 100 }];
  assert.deepEqual(geo.declutterLabels(pts, 12, 20), [0, 100]);
});

test('declutterLabels pushes y-near, x-near labels apart by minGapY', () => {
  const pts = [{ x: 0, y: 0 }, { x: 5, y: 4 }];   // dx=5<20, dy=4<12 -> collide
  assert.deepEqual(geo.declutterLabels(pts, 12, 20), [0, 12]);
});

test('declutterLabels does not move x-far labels even if y is near', () => {
  const pts = [{ x: 0, y: 0 }, { x: 100, y: 4 }]; // dx=100>=20 -> no collision
  assert.deepEqual(geo.declutterLabels(pts, 12, 20), [0, 4]);
});

test('declutterLabels stacks three near labels in y-order', () => {
  const pts = [{ x: 0, y: 0 }, { x: 2, y: 3 }, { x: 1, y: 6 }];
  assert.deepEqual(geo.declutterLabels(pts, 12, 20), [0, 12, 24]);
});

test('declutterLabels returns results in input order', () => {
  const pts = [{ x: 0, y: 10 }, { x: 1, y: 0 }]; // 2nd label is higher (y=0)
  const out = geo.declutterLabels(pts, 12, 20);
  assert.equal(out[1], 0);   // input index 1 (y=0) unchanged
  assert.equal(out[0], 12);  // input index 0 (y=10) pushed to 12
});
```

- [ ] **Step 3: Tests laufen lassen — müssen fehlschlagen**

Run: `node --test test/geo.test.js`
Expected: FAIL (`declutterLabels` nicht definiert / `typeof geo.declutterLabels` ≠ function).

- [ ] **Step 4: `declutterLabels` implementieren**

Lies `geo.js` frisch um den UMD-Export (Grep `// ── UMD-style export`). Füge **direkt vor** der Zeile `// ── UMD-style export ────────────────────────────────────────` ein:

```js
// Phase 34: Vertikales Label-Declutter. points=[{x,y}] (Canvas-Pixel). Liefert
// angepasste y-Werte (Eingabe-Reihenfolge), sodass zwei Labels mit x-Abstand
// < minGapX nicht naeher als minGapY in y stehen. Greedy von oben, nur nach
// unten geschoben; stabile Sortierung -> kein Frame-zu-Frame-Springen.
function declutterLabels(points, minGapY, minGapX) {
  var n = points.length;
  var order = [];
  for (var i = 0; i < n; i++) order.push(i);
  order.sort(function (a, b) { return (points[a].y - points[b].y) || (a - b); });
  var outY = new Array(n);
  var placed = [];
  for (var k = 0; k < n; k++) {
    var idx = order[k];
    var px = points[idx].x, py = points[idx].y;
    var moved = true;
    while (moved) {
      moved = false;
      for (var j = 0; j < placed.length; j++) {
        if (Math.abs(placed[j].x - px) < minGapX && Math.abs(placed[j].y - py) < minGapY) {
          py = placed[j].y + minGapY;
          moved = true;
        }
      }
    }
    placed.push({ x: px, y: py });
    outY[idx] = py;
  }
  return outY;
}
```

- [ ] **Step 5: `declutterLabels` exportieren**

Lies das `api`-Objekt frisch (Grep `structuralRaceKey: structuralRaceKey, ghostPointAt: ghostPointAt`). Ersetze:

```js
    structuralRaceKey: structuralRaceKey, ghostPointAt: ghostPointAt
  };
```

durch:

```js
    structuralRaceKey: structuralRaceKey, ghostPointAt: ghostPointAt,
    declutterLabels: declutterLabels
  };
```

- [ ] **Step 6: `geoGlobals` für ESLint ergänzen**

Lies `eslint.config.js` frisch um `geoGlobals` (Grep `structuralRaceKey: 'readonly', ghostPointAt: 'readonly',`). Ersetze:

```js
  structuralRaceKey: 'readonly', ghostPointAt: 'readonly',
};
```

durch:

```js
  structuralRaceKey: 'readonly', ghostPointAt: 'readonly',
  declutterLabels: 'readonly',
};
```

- [ ] **Step 7: Tests laufen lassen — müssen bestehen**

Run: `node --test test/geo.test.js`
Expected: PASS (alle neuen Tests grün).

- [ ] **Step 8: Voll-Suite + Lint**

Run: `node --check geo.js` → OK.
Run: `npx eslint geo.js test/geo.test.js eslint.config.js` → 0 Fehler.
Run: `node --test` → vorher 157, jetzt **162** PASS, 0 fail.

- [ ] **Step 9: Commit**

```bash
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" add geo.js test/geo.test.js eslint.config.js
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" commit -m "feat(marker-polish): declutterLabels geo helper + tests

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: `map-draw.js` — Overtake-Ring + Label-Declutter

**Files:**
- Modify: `map-draw.js` (Modul-State vor `function drawKartMarkersOn` ~Zeile 134; komplette Funktion `drawKartMarkersOn` ~Zeile 137–186)

**Interfaces:**
- Consumes: `RasiLapEngine.{participantsOf,rankParticipants,positionGains}` (Phase 31/33), `declutterLabels` (Task 1), `activeRace()`, `gpsXYOnCanvas`, `state.karts`, `state.kartMeta`, `state.activeKartMac`, `dpr()`.
- Produces: goldener Overtake-Ring + entzerrte P-Labels auf `trackCanvas`.

- [ ] **Step 1: Modul-State für den Overtake-Ring einführen**

Lies `map-draw.js` frisch um den Funktions-Kommentar (Grep `// Phase 33: Live-Positions-Overlay`). Füge **direkt davor** ein:

```js
// Phase 34: Marker-Overtake-Ring — eigener modul-lokaler Overtake-State
// (unabhaengig von kart-overview.js; map-draw rechnet die Rangfolge jeden Frame).
let _prevPosByMac = {};
let _overtakeAtByMac = {};
const MARKER_OVERTAKE_MS = 1200;
```

- [ ] **Step 2: `drawKartMarkersOn` komplett ersetzen (Ring + Declutter)**

Lies `map-draw.js` frisch und ersetze die **komplette** Funktion `drawKartMarkersOn` (von `function drawKartMarkersOn(c, ctx) {` bis zur zugehörigen schließenden `}` direkt vor `function drawLineOn`) durch:

```js
function drawKartMarkersOn(c, ctx) {
  try {
    const now = Date.now();
    const macs = state.karts.macs();
    // Positionsnummern nur bei laufendem Rennen mit >=2 Teilnehmern.
    const r = (typeof activeRace === 'function') ? activeRace() : null;
    let posByMac = null;
    const _parts = (r && r.status === 'running' && typeof RasiLapEngine !== 'undefined')
      ? RasiLapEngine.participantsOf(r) : [];
    if (_parts.length >= 2) {
      const cross = {};
      _parts.forEach(p => {
        const kk = state.karts.has(p.mac) ? state.karts.get(p.mac) : null;
        cross[p.mac] = kk ? kk.lapStart : null;
      });
      const ranked = RasiLapEngine.rankParticipants(r, cross);
      posByMac = {};
      ranked.forEach(e => { posByMac[e.mac] = e.pos; });
      // Phase 34: Aufsteiger -> Overtake-Ring-Zeitstempel; Vorpositionen merken.
      RasiLapEngine.positionGains(_prevPosByMac, ranked).forEach(mac => { _overtakeAtByMac[mac] = now; });
      const _np = {};
      ranked.forEach(e => { _np[e.mac] = e.pos; });
      _prevPosByMac = _np;
    } else {
      // Kein aktives Ranking -> Overtake-State zuruecksetzen.
      _prevPosByMac = {};
      _overtakeAtByMac = {};
    }
    const labels = [];   // Phase 34: Label-Anker sammeln, nach der Schleife entzerren.
    macs.forEach(mac => {
      const k = state.karts.get(mac);
      if (!k) return;
      const t = k.telemetry;
      if (!t.lat || !t.lon) return;        // kein GPS-Fix -> kein Marker
      const xy = gpsXYOnCanvas(t.lat, t.lon, c);
      // Kart-Farbe NUR lesen (state.kartMeta) — kein localStorage-Write im Draw-Loop.
      const meta = state.kartMeta && state.kartMeta[mac];
      const color = (meta && meta.color) || '#3aa0e8';
      const isActive = (mac === state.activeKartMac);
      const stale = k.connection.lastPacketAt ? (now - k.connection.lastPacketAt > 2000) : true;
      const rad = (isActive ? 7 : 5) * dpr();
      ctx.save();
      ctx.globalAlpha = stale ? 0.4 : 1;
      ctx.fillStyle = color;
      if (isActive) { ctx.shadowColor = color; ctx.shadowBlur = 16 * dpr(); }
      ctx.beginPath();
      ctx.arc(xy.x, xy.y, rad, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
      // Phase 34: goldener Overtake-Ring fuer kurz zuvor aufgestiegene Karts.
      const _otAge = _overtakeAtByMac[mac] != null ? (now - _overtakeAtByMac[mac]) : Infinity;
      if (_otAge < MARKER_OVERTAKE_MS) {
        ctx.strokeStyle = 'rgba(255,200,60,.9)';
        ctx.lineWidth = 2 * dpr();
        ctx.beginPath();
        ctx.arc(xy.x, xy.y, rad + 4 * dpr(), 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.restore();
      // Phase 34: Label nicht sofort zeichnen — Anker fuer Declutter sammeln.
      if (posByMac && posByMac[mac] != null) {
        labels.push({ x: xy.x, y: xy.y - (rad + 6 * dpr()), text: 'P' + posByMac[mac], alpha: stale ? 0.4 : 1 });
      }
    });
    // Phase 34: ueberlappende Labels vertikal entzerren, dann zeichnen.
    if (labels.length) {
      const ys = declutterLabels(labels.map(l => ({ x: l.x, y: l.y })), 13 * dpr(), 22 * dpr());
      ctx.save();
      ctx.font = `900 ${11 * dpr()}px monospace`;
      ctx.textAlign = 'center';
      ctx.fillStyle = '#fff';
      for (let i = 0; i < labels.length; i++) {
        ctx.globalAlpha = labels[i].alpha;
        ctx.fillText(labels[i].text, labels[i].x, ys[i]);
      }
      ctx.restore();
    }
  } catch (e) { console.warn('drawKartMarkersOn:', e); }
}
```

- [ ] **Step 3: Verify**

Run: `node --check map-draw.js` → OK.
Run: `npx eslint map-draw.js` → 0 Fehler.
Run: `node --test` → grün (162).
Grep `map-draw.js` für `MARKER_OVERTAKE_MS`, `_overtakeAtByMac`, `positionGains`, `declutterLabels`, `rgba(255,200,60` → vorhanden.
Grep `map-draw.js` für `ctx.fillText('P' + posByMac[mac]` → **nicht mehr** vorhanden (Label-Zeichnung ausgelagert).

- [ ] **Step 4: Commit**

```bash
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" add map-draw.js
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" commit -m "feat(marker-polish): overtake ring + decluttered position labels on live map

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: Finale Verifikation + Plan-Doc

**Files:**
- Modify: (nur Verifikation; Plan-Doc-Commit)

- [ ] **Step 1: Voll-Verifikation (alles grün)**
  - `node --check geo.js map-draw.js`
  - `npx eslint geo.js test/geo.test.js map-draw.js eslint.config.js` → 0 Fehler
  - `node --test` → **162 PASS**, 0 fail (157 alt + 5 neue)
  - `python -m py_compile bridge.py` → kein Fehler (unverändert)
  - `python -m unittest discover -s test -p "test_*.py"` → **50 OK** (unverändert)
  - `__pycache__` löschen, dann `git status` → sauber bis auf `.claude/` und das Plan-Doc.

- [ ] **Step 2: Grep-Gesamtcheck**
  - `geo.js`: `function declutterLabels`, `declutterLabels: declutterLabels`.
  - `test/geo.test.js`: `declutterLabels` (≥5×).
  - `eslint.config.js`: `declutterLabels: 'readonly'` (in `geoGlobals`).
  - `map-draw.js`: `MARKER_OVERTAKE_MS`, `RasiLapEngine.positionGains`, `declutterLabels(`, `rgba(255,200,60`.

- [ ] **Step 3: Plan-Doc committen**

```bash
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" add docs/superpowers/plans/2026-06-24-34-map-marker-polish.md
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" commit -m "docs(plan): Phase 34 map-marker polish (overtake ring + label declutter) implementation plan

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Manuelle Akzeptanz (an Nutzer — Hardware/zwei Karts)

1. **Overtake-Ring:** Überholt Kart B Kart A, bekommt B's Marker auf der Karte kurz (~1,2 s) einen goldenen Ring.
2. **Label-Declutter:** Stehen zwei Karts dicht beieinander, überlappen ihre `P{pos}`-Labels nicht mehr — sie stapeln sich vertikal.
3. **Marker-Treue:** Marker-Punkte bleiben exakt an der GPS-Position; nur die Zahlen-Labels wandern.
4. **Single-Kart-Regression:** ein Marker, kein Ring, kein Label — wie Phase 33.
5. **Rennende:** kein hängender Overtake-Ring im nächsten Rennen.

## Self-Review

- **Spec-Coverage:** §3.1 Marker-Overtake-Ring → Task 2 (Modul-State + `positionGains` + goldener Ring + Reset). §3.2 Label-Declutter → Task 1 (`declutterLabels`) + Task 2 (Anker sammeln + entzerrt zeichnen, Marker bleiben fix). §5 Tests → Task 1 (5 neue). §6 Dateien → File-Structure-Tabelle (lap-engine/kart-overview/HTML unverändert). §4 Randfälle: Single/<2 (Task 2 `>=2`-Gate + Reset-Zweig), keine Überholung (Task 1 `positionGains` leer), Labels weit (Task 1 No-Op-Test), stale (Task 2 `alpha`/`globalAlpha`), Rennende-Reset (Task 2 else-Zweig), ≥3 nahe Labels (Task 1 Stapel-Test), kein Fix (Task 2 `!t.lat||!t.lon` skip).
- **Placeholder-Scan:** Jeder Code-Schritt zeigt vollständigen Code; keine TBD/TODO.
- **Typ-/Namens-Konsistenz:** `declutterLabels(points, minGapY, minGapX)` → `[y…]` (Task 1 def; Task 2 ruft `declutterLabels(…, 13*dpr(), 22*dpr())`). `positionGains(prevPosByMac, ranked)` (Phase 33, Task 2 nutzt `_prevPosByMac`). `_overtakeAtByMac`/`_prevPosByMac`/`MARKER_OVERTAKE_MS` (Task 2 modul-lokal). `geoGlobals.declutterLabels` (Task 1 eslint; Task 2 nutzt die Global). `RasiLapEngine`/`activeRace`/`gpsXYOnCanvas`/`dpr` (bestehende map-draw-Globals).

## Phase Map

- **Phase 33:** Live-Positions-Overlay (Marker + P-Nummern) + Overtake-Highlight (Übersicht-Karten).
- **Phase 34 (dieser Plan):** Map-Marker-Polish — Marker-Overtake-Ring + Label-Kollisionsauflösung.
- **Phasen 35+ (deferred):** synchrones Replay, kombinierter Fahrerdialog, momentaner Streckenabstand-Gap.
