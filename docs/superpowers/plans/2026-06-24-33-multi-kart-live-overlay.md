# Phase 33 — Multi-Kart Live-Positions-Overlay + Overtake-Highlight Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Die Live-Streckenkarte zeichnet alle verbundenen Karts als farbige Marker (aktiver größer+Glow, stale gedimmt) mit Positionsnummer `P{pos}` bei laufendem Rennen; steigt ein Kart im Übersicht-Grid auf, pulst seine Karte kurz golden.

**Architecture:** Eine reine, TDD'd `positionGains`-Funktion kommt in `lap-engine.js`. `kart-overview.js` hält Overtake-State und vergibt die Glow-Klasse; `map-draw.js` ersetzt den einzelnen GPS-Punkt durch Per-Kart-Marker + Positionsnummern. Reine Logik per `node:test`, Canvas-/DOM-Verdrahtung per `node --check` + ESLint + Grep.

**Tech Stack:** Vanilla JS (Browser-Globals / UMD-IIFE), Canvas 2D, `node:test`, ESLint 9 (Flat-Config). Verifikation: `node --check`, `node --test`, `eslint`, Python-Baselines (`py_compile`/`unittest`).

**Spec:** `docs/superpowers/specs/2026-06-24-multi-kart-live-overlay-design.md`

## Global Constraints

- Repo-Root: `C:/Users/jimlu/Documents/RasiCross-Telemetrie-git`. Branch: `feat/multi-kart-live-overlay` (auf Phase 32 / PR #51 gestapelt).
- **Dateien sind CRLF.** Unmittelbar vor jedem `Edit` die Zielstelle frisch in-session lesen und den Anker aus diesem Read kopieren — Zeilennummern hier sind indikativ, auf Text ankern.
- Verifikation mit dem **Grep-Tool** (nicht Shell-`grep`).
- **Niemals `.claude/` committen**, Plan-/Spec-Doc nur im expliziten Doc-Commit (Task 4).
- Commit-Messages: conventional + kurzer Body + Trailer `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- `__pycache__` vor jedem `git status`/commit löschen.
- **Verhalten unverändert für Single-Kart / <2 Teilnehmer:** Live-Karte zeigt einen hervorgehobenen Marker wie heute (keine P-Nummern), kein Overtake-Glow (Regression).
- **Overtake-/Overlay-Logik ist abgeleitet:** kein persistierter State; Overtake-Vorpositionen leben nur modul-lokal in `kart-overview.js`.
- **Canvas-Rendering wird nicht unit-getestet** (kein DOM/Canvas in `node:test`) — nur `positionGains` ist getestet; Marker-Zeichnung via `node --check`/ESLint/Grep + manuelle Hardware-Akzeptanz.
- **`pit-wall.js`, `live-ui.js`, `laps-drivers.js`, `races.js`, `package.json`, der `<script>`-Include bleiben unverändert.**
- **Verifikationsrezept (pro Task wo relevant + final):**
  - `node --check <berührte .js>`
  - `node --test` (muss grün bleiben/wachsen; aktuell **152** + 5 neue = **157**)
  - `npx eslint <berührte .js>` → 0 Fehler
  - `python -m py_compile bridge.py` + `python -m unittest discover -s test -p "test_*.py"` → **50 OK** (Python unverändert)
  - Python kann `python` oder `py -3` sein.

---

## File Structure

| Aktion | Datei | Verantwortung |
|--------|-------|---------------|
| Ändern | `lap-engine.js` | Neue reine `positionGains(prevPosByMac, ranked)`; im UMD-Return exportieren. |
| Ändern | `test/lap-engine.test.js` | `node:test`-Fälle für `positionGains`; Export-Liste erweitern. |
| Ändern | `kart-overview.js` | Modul-State `prevPosByMac`/`overtakeAtByMac`; `positionGains`-Aufruf; Klasse `ko-overtake` bei Aufstieg; State-Reset ohne Ranking. |
| Ändern | `RasiCross_Telemetry.html` | CSS `.ko-card.ko-overtake` (gehaltener goldener Glow). |
| Ändern | `map-draw.js` | `drawKartMarkersOn(c, ctx)` ersetzt den Einzel-GPS-Punkt auf `trackCanvas`; Marker je Kart (Farbe, aktiv=Glow, stale=gedimmt) + `P{pos}`-Label bei Rennen ≥2. |
| Ändern | `eslint.config.js` | `racesGlobals`/`lapEngineGlobals`/`kartBarGlobals` im `map-draw.js`-Block. |

**Task-Reihenfolge:** 1 (lap-engine `positionGains` + Tests) → 2 (kart-overview Overtake-Highlight + CSS) → 3 (map-draw Overlay + eslint-Globals) → 4 (finale Verifikation + Plan-Doc).

> **Verifikationsstrategie:** `positionGains` wird per `node:test` TDD'd. Canvas-/DOM-Verdrahtung: `node --check` + ESLint + Grep-Asserts + grüne Baselines. Funktionales Zwei-Kart-Verhalten (Marker, Nummern, Glow) bleibt manuell (Hardware, §8 Spec).

---

## Task 1: `lap-engine.js` — `positionGains` (Pure-Logik, TDD)

**Files:**
- Modify: `lap-engine.js` (neue Funktion nach `fastestLapHolder` ~Zeile 197; Export-Block ~Zeile 199–214)
- Modify: `test/lap-engine.test.js` (Export-Liste; neue Tests am Dateiende)

**Interfaces:**
- Consumes: nichts (rein über Parameter).
- Produces (von Task 2 konsumiert), auf `window.RasiLapEngine`:
  - `positionGains(prevPosByMac, ranked)` → `Array` der `mac`s, deren Position sich verbessert hat (`prevPosByMac[mac]` existiert **und** `e.pos < prevPosByMac[mac]`). Neueinsteiger/Abstiege/unveränderte ignoriert. `ranked` = Ausgabe von `rankParticipants` (Einträge mit `mac`/`pos`).

- [ ] **Step 1: Export-Liste im Test erweitern (failing)**

Lies `test/lap-engine.test.js` frisch um die Export-Liste (Grep `'rankParticipants','leaderReachedTarget','fastestLapHolder'`). Ersetze:

```js
                      'rankParticipants','leaderReachedTarget','fastestLapHolder']) {
```

durch:

```js
                      'rankParticipants','leaderReachedTarget','fastestLapHolder',
                      'positionGains']) {
```

- [ ] **Step 2: Neue Tests ans Dateiende anhängen (failing)**

Lies das Ende von `test/lap-engine.test.js` frisch (Grep `fastestLapHolder tie resolves to first participant`) und füge **nach** dem letzten `test(...)`-Block (am Dateiende) ein:

```js

test('positionGains returns macs that moved up', () => {
  const prev = { AA: 1, BB: 2, CC: 3 };
  const ranked = [{ mac: 'CC', pos: 1 }, { mac: 'AA', pos: 2 }, { mac: 'BB', pos: 3 }];
  assert.deepEqual(E.positionGains(prev, ranked), ['CC']);
});

test('positionGains ignores unchanged positions, detects a swap winner only', () => {
  const prev = { AA: 1, BB: 2 };
  assert.deepEqual(E.positionGains(prev, [{ mac: 'AA', pos: 1 }, { mac: 'BB', pos: 2 }]), []);
  // BB up 2->1, AA down 1->2 (drop ignored)
  assert.deepEqual(E.positionGains(prev, [{ mac: 'BB', pos: 1 }, { mac: 'AA', pos: 2 }]), ['BB']);
});

test('positionGains ignores new entrants without a previous position', () => {
  const prev = { AA: 1 };
  // BB has no prev -> ignored; AA dropped -> ignored
  assert.deepEqual(E.positionGains(prev, [{ mac: 'BB', pos: 1 }, { mac: 'AA', pos: 2 }]), []);
});

test('positionGains detects multiple simultaneous gainers', () => {
  const prev = { AA: 1, BB: 2, CC: 3, DD: 4 };
  const ranked = [{ mac: 'CC', pos: 1 }, { mac: 'DD', pos: 2 },
                  { mac: 'AA', pos: 3 }, { mac: 'BB', pos: 4 }];
  assert.deepEqual(E.positionGains(prev, ranked), ['CC', 'DD']);
});

test('positionGains with empty prev (first ranking) yields no gains', () => {
  assert.deepEqual(E.positionGains({}, [{ mac: 'AA', pos: 1 }, { mac: 'BB', pos: 2 }]), []);
});
```

- [ ] **Step 3: Tests laufen lassen — müssen fehlschlagen**

Run: `node --test test/lap-engine.test.js`
Expected: FAIL (`positionGains` nicht definiert).

- [ ] **Step 4: `positionGains` implementieren**

Lies `lap-engine.js` frisch um `function fastestLapHolder` (Grep `return bestMs == null \? null :`). Füge **direkt nach** dem Ende der `fastestLapHolder`-Funktion (nach ihrer schließenden `}` und vor `return {`) ein:

```js

  // Phase 33: Karts, die gegenueber prevPosByMac aufgestiegen sind (kleinere
  // pos-Zahl = weiter vorn). Neueinsteiger (keine Vorposition) und Abstiege
  // werden ignoriert. Rein, kein DOM, kein State.
  function positionGains(prevPosByMac, ranked) {
    var prev = prevPosByMac || {}, out = [];
    for (var i = 0; i < (ranked || []).length; i++) {
      var e = ranked[i], pv = prev[e.mac];
      if (pv != null && e.pos < pv) out.push(e.mac);
    }
    return out;
  }
```

- [ ] **Step 5: `positionGains` exportieren**

Lies den Return-Block frisch (Grep `fastestLapHolder: fastestLapHolder,`). Ersetze:

```js
    fastestLapHolder: fastestLapHolder,
  };
```

durch:

```js
    fastestLapHolder: fastestLapHolder,
    positionGains: positionGains,
  };
```

- [ ] **Step 6: Tests laufen lassen — müssen bestehen**

Run: `node --test test/lap-engine.test.js`
Expected: PASS (alle neuen Tests grün).

- [ ] **Step 7: Voll-Suite + Lint**

Run: `node --check lap-engine.js` → OK.
Run: `npx eslint lap-engine.js test/lap-engine.test.js` → 0 Fehler.
Run: `node --test` → vorher 152, jetzt **157** PASS, 0 fail.

- [ ] **Step 8: Commit**

```bash
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" add lap-engine.js test/lap-engine.test.js
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" commit -m "feat(live-overlay): positionGains engine helper + tests

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: `kart-overview.js` — Overtake-Highlight + CSS

**Files:**
- Modify: `kart-overview.js` (Modul-State vor `function render` ~Zeile 47; Overtake-Detektion nach dem `if (ranking)`-Block ~Zeile 66; `cls`-Zeile ~Zeile 91)
- Modify: `RasiCross_Telemetry.html` (CSS nach `.ko-card .ko-v-fl{` ~Zeile 1475)

**Interfaces:**
- Consumes: `RasiLapEngine.positionGains(prevPosByMac, ranked)` (Task 1), die bestehende `ranking`-Variable in `render`.
- Produces: CSS-Klasse `ko-overtake` auf aufsteigenden Karten für ~1200 ms.

- [ ] **Step 1: Modul-State für Overtake einführen**

Lies `kart-overview.js` frisch um `function render(state) {` (Grep `function render\(state\) \{`). Füge **direkt davor** ein:

```js
  // Phase 33: Overtake-Highlight — vorherige Positionen + Aufstiegs-Zeitstempel
  // je Kart (modul-lokal). Statischer Glow fuer OVERTAKE_MS, rebuild-sicher.
  const OVERTAKE_MS = 1200;
  let prevPosByMac = {};
  let overtakeAtByMac = {};

```

- [ ] **Step 2: Aufsteiger erkennen + Glow-Zeitstempel setzen**

Lies frisch den `posByMac`-Block in `render` (Grep `orderedMacs = ranking.map\(e => e.mac\).filter`). Ersetze:

```js
    const posByMac = {};
    let orderedMacs = macs;
    if (ranking) {
      ranking.forEach(e => { posByMac[e.mac] = e; });
      orderedMacs = ranking.map(e => e.mac).filter(m => macs.includes(m))
        .concat(macs.filter(m => !(m in posByMac)));
    }
```

durch:

```js
    const posByMac = {};
    let orderedMacs = macs;
    if (ranking) {
      ranking.forEach(e => { posByMac[e.mac] = e; });
      orderedMacs = ranking.map(e => e.mac).filter(m => macs.includes(m))
        .concat(macs.filter(m => !(m in posByMac)));
      // Phase 33: Aufsteiger erkennen -> Glow-Zeitstempel; Vorpositionen merken.
      RasiLapEngine.positionGains(prevPosByMac, ranking).forEach(mac => { overtakeAtByMac[mac] = now; });
      const _np = {};
      ranking.forEach(e => { _np[e.mac] = e.pos; });
      prevPosByMac = _np;
    } else {
      // Kein aktives Ranking -> Overtake-State zuruecksetzen (frischer Start).
      prevPosByMac = {};
      overtakeAtByMac = {};
    }
```

- [ ] **Step 3: `ko-overtake`-Klasse auf aufsteigende Karten**

Lies frisch die `cls`-Zeile in `render` (Grep `const cls = 'ko-card' \+ \(mac === state.activeKartMac`). Ersetze:

```js
      const cls = 'ko-card' + (mac === state.activeKartMac ? ' active' : '') + (stale ? ' stale' : '');
```

durch:

```js
      const isOvertake = !!(overtakeAtByMac[mac] && (now - overtakeAtByMac[mac] < OVERTAKE_MS));
      const cls = 'ko-card' + (mac === state.activeKartMac ? ' active' : '') + (stale ? ' stale' : '')
        + (isOvertake ? ' ko-overtake' : '');
```

- [ ] **Step 4: CSS für den goldenen Glow**

Lies `RasiCross_Telemetry.html` frisch um `.ko-card .ko-v-fl{` (Grep `.ko-card \.ko-v-fl\{`). Ersetze:

```css
.ko-card .ko-v-fl{color:#b07bff}
```

durch:

```css
.ko-card .ko-v-fl{color:#b07bff}
.ko-card.ko-overtake{box-shadow:0 0 0 2px rgba(255,200,60,.75),0 0 16px rgba(255,200,60,.55)}
```

- [ ] **Step 5: Verify**

Run: `node --check kart-overview.js` → OK.
Run: `npx eslint kart-overview.js` → 0 Fehler.
Run: `node --test` → grün (157).
Grep `kart-overview.js` für `positionGains`, `overtakeAtByMac`, `ko-overtake` → vorhanden.
Grep `RasiCross_Telemetry.html` für `.ko-card.ko-overtake\{` → vorhanden.

- [ ] **Step 6: Commit**

```bash
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" add kart-overview.js RasiCross_Telemetry.html
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" commit -m "feat(live-overlay): overtake highlight (gold glow) on overview cards

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: `map-draw.js` — Live-Positions-Overlay (Per-Kart-Marker)

**Files:**
- Modify: `map-draw.js` (GPS-Punkt-Block in `drawTrackOn` ~Zeile 120–131; neue Funktion `drawKartMarkersOn` vor `function drawLineOn` ~Zeile 143)
- Modify: `eslint.config.js` (`map-draw.js`-Block globals ~Zeile 192–193)

**Interfaces:**
- Consumes: `RasiLapEngine.{participantsOf,rankParticipants}` (Phase 30/31), `RasiKartBar.metaFor(state, mac, idx)` (Phase 28), `activeRace()`, `gpsXYOnCanvas`, `state.karts`, `state.activeKartMac`, `dpr()`.
- Produces: Per-Kart-Marker + `P{pos}`-Labels auf der Live-Karte (`trackCanvas`).

- [ ] **Step 1: ESLint-Globals für `map-draw.js` ergänzen**

Lies `eslint.config.js` frisch um den `map-draw.js`-Block (Grep `RasiTiles: 'readonly', RasiTileRenderer: 'readonly' \},`). Ersetze:

```js
      globals: { ...globals.browser, ...geoGlobals, ...appCoreGlobals,
                 RasiTiles: 'readonly', RasiTileRenderer: 'readonly' },
```

durch:

```js
      globals: { ...globals.browser, ...geoGlobals, ...appCoreGlobals,
                 ...racesGlobals, ...lapEngineGlobals, ...kartBarGlobals,
                 RasiTiles: 'readonly', RasiTileRenderer: 'readonly' },
```

- [ ] **Step 2: Einzel-GPS-Punkt durch Marker-Aufruf ersetzen**

Lies `map-draw.js` frisch um den GPS-Punkt-Block (Grep `// GPS dot`). Ersetze:

```js
  // GPS dot
  const t = state.telemetry;
  if (t.lat && t.lon) {
    const xy = gpsXYOnCanvas(t.lat, t.lon, c);
    ctx.fillStyle = css('--blue');
    ctx.shadowColor = css('--blue');
    ctx.shadowBlur = 16 * dpr();
    ctx.beginPath();
    ctx.arc(xy.x, xy.y, 7 * dpr(), 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
  }
```

durch:

```js
  // Phase 33: Live-Positions-Overlay statt einzelnem GPS-Punkt. Nur auf der
  // Live-Karte; scanCanvas/editorCanvas bekommen keine Kart-Marker.
  if (c.id === 'trackCanvas') drawKartMarkersOn(c, ctx);
```

- [ ] **Step 3: `drawKartMarkersOn` implementieren**

Lies `map-draw.js` frisch um `function drawLineOn` (Grep `function drawLineOn\(ctx, c, ep, color, label, flash\) \{`). Füge **direkt davor** ein:

```js
// Phase 33: Live-Positions-Overlay — jeder verbundene Kart als farbiger Marker
// an seiner GPS-Position. Aktiver Kart groesser+Glow, stale gedimmt; P-Nummer
// oberhalb des Markers nur bei laufendem Rennen mit >=2 Teilnehmern.
function drawKartMarkersOn(c, ctx) {
  try {
    const now = Date.now();
    const macs = state.karts.macs();
    // Positionsnummern nur bei laufendem Rennen mit >=2 Teilnehmern.
    const r = (typeof activeRace === 'function') ? activeRace() : null;
    let posByMac = null;
    if (r && r.status === 'running' && RasiLapEngine.participantsOf(r).length >= 2) {
      const cross = {};
      RasiLapEngine.participantsOf(r).forEach(p => {
        const kk = state.karts.has(p.mac) ? state.karts.get(p.mac) : null;
        cross[p.mac] = kk ? kk.lapStart : null;
      });
      posByMac = {};
      RasiLapEngine.rankParticipants(r, cross).forEach(e => { posByMac[e.mac] = e.pos; });
    }
    macs.forEach((mac, i) => {
      const k = state.karts.get(mac);
      if (!k) return;
      const t = k.telemetry;
      if (!t.lat || !t.lon) return;        // kein GPS-Fix -> kein Marker
      const xy = gpsXYOnCanvas(t.lat, t.lon, c);
      const meta = (typeof RasiKartBar !== 'undefined') ? RasiKartBar.metaFor(state, mac, i) : { color: '#3aa0e8' };
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
      if (posByMac && posByMac[mac] != null) {
        ctx.fillStyle = '#fff';
        ctx.font = `900 ${11 * dpr()}px monospace`;
        ctx.textAlign = 'center';
        ctx.fillText('P' + posByMac[mac], xy.x, xy.y - (rad + 6 * dpr()));
      }
      ctx.restore();
    });
  } catch (e) { console.warn('drawKartMarkersOn:', e); }
}
```

- [ ] **Step 4: Verify**

Run: `node --check map-draw.js` → OK.
Run: `npx eslint map-draw.js eslint.config.js` → 0 Fehler.
Run: `node --test` → grün (157).
Grep `map-draw.js` für `function drawKartMarkersOn`, `drawKartMarkersOn(c, ctx)`, `RasiLapEngine.rankParticipants` → vorhanden; für `const t = state.telemetry;` → **nicht mehr** vorhanden (Einzel-Punkt ersetzt).
Grep `eslint.config.js` für `...racesGlobals, ...lapEngineGlobals, ...kartBarGlobals,` → vorhanden (im map-draw-Block).

- [ ] **Step 5: Commit**

```bash
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" add map-draw.js eslint.config.js
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" commit -m "feat(live-overlay): per-kart position markers + numbers on live track map

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: Finale Verifikation + Plan-Doc

**Files:**
- Modify: (nur Verifikation; Plan-Doc-Commit)

- [ ] **Step 1: Voll-Verifikation (alles grün)**
  - `node --check lap-engine.js kart-overview.js map-draw.js`
  - `npx eslint lap-engine.js test/lap-engine.test.js kart-overview.js map-draw.js eslint.config.js` → 0 Fehler
  - `node --test` → **157 PASS**, 0 fail (152 alt + 5 neue)
  - `python -m py_compile bridge.py` → kein Fehler (unverändert)
  - `python -m unittest discover -s test -p "test_*.py"` → **50 OK** (unverändert)
  - `__pycache__` löschen, dann `git status` → sauber bis auf `.claude/` und das Plan-Doc.

- [ ] **Step 2: Grep-Gesamtcheck**
  - `lap-engine.js`: `function positionGains`, `positionGains: positionGains`.
  - `kart-overview.js`: `RasiLapEngine.positionGains`, `overtakeAtByMac`, `ko-overtake`.
  - `RasiCross_Telemetry.html`: `.ko-card.ko-overtake{`.
  - `map-draw.js`: `function drawKartMarkersOn`, `if (c.id === 'trackCanvas') drawKartMarkersOn`; **kein** `const t = state.telemetry;`.
  - `eslint.config.js`: `...racesGlobals, ...lapEngineGlobals, ...kartBarGlobals,` (map-draw-Block).

- [ ] **Step 3: Plan-Doc committen**

```bash
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" add docs/superpowers/plans/2026-06-24-33-multi-kart-live-overlay.md
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" commit -m "docs(plan): Phase 33 multi-kart live-position overlay + overtake highlight implementation plan

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Manuelle Akzeptanz (an Nutzer — Hardware/zwei Karts)

1. **Marker:** Live-Karte zeigt für jeden verbundenen Kart einen Marker in Kart-Farbe; der aktive Kart ist größer/mit Glow.
2. **Positionsnummern:** Im laufenden Rennen (≥2) trägt jeder Marker `P{pos}`, passend zum Leaderboard.
3. **Stale:** Ein Kart ohne aktuelle Pakete bleibt an letzter Position, gedimmt.
4. **Overtake:** Überholt Kart B Kart A, pulst B's Übersicht-Karte kurz golden (~1,2 s).
5. **Single-Kart-Regression:** mit einem Kart ein hervorgehobener Marker wie vor Phase 33; kein Overtake-Glow; keine P-Nummer.
6. **Rennende:** P-Nummern verschwinden von der Karte; Overtake-State zurückgesetzt.

## Self-Review

- **Spec-Coverage:** §3.1 `positionGains` → Task 1. §3.2 Overtake-Highlight → Task 2 (State + `positionGains` + `ko-overtake` + Reset) + CSS. §3.3 Live-Overlay → Task 3 (`drawKartMarkersOn`: Marker/Farbe/aktiv-Glow/stale-dim/P-Label). §3.4 ESLint → Task 3 Step 1. §6 Tests → Task 1 (5 neue). §7 Dateien → File-Structure-Tabelle (pit-wall/live-ui/laps-drivers/races/package.json unverändert). §5 Randfälle: Single/<2 (Task 2 Reset-Zweig, Task 3 ein Marker ohne Nummer), Rolling Start (Task 1 positionGains feuert nur bei echtem Wechsel), kein GPS-Fix (Task 3 `!t.lat || !t.lon` skip), stale (Task 3 `globalAlpha 0.4`), Rennende-Reset (Task 2 else-Zweig), Glow-Rebuild (Task 2 statischer Glow + zeitbasierte Klasse).
- **Placeholder-Scan:** Jeder Code-Schritt zeigt vollständigen Code; keine TBD/TODO.
- **Typ-/Namens-Konsistenz:** `positionGains(prevPosByMac, ranked)` → `[mac,…]` (Task 1 def; Task 2 nutzt es mit `ranking` + `prevPosByMac`). `overtakeAtByMac`/`prevPosByMac`/`OVERTAKE_MS` (Task 2 modul-lokal). `drawKartMarkersOn(c, ctx)` (Task 3 def + Aufruf in `drawTrackOn`). `RasiKartBar.metaFor(state, mac, i)` / `RasiLapEngine.rankParticipants(r, cross)` (bestehende Signaturen). ESLint-Const-Namen `racesGlobals`/`lapEngineGlobals`/`kartBarGlobals` (in `eslint.config.js` definiert, Zeilen 38/115/117/121).

## Phase Map

- **Phase 31:** Leaderboard + Positions-Ranking.
- **Phase 32:** Leaderboard-Polish (Intervall, Fastest-Lap) + Pit-Wall-OLED-Fix.
- **Phase 33 (dieser Plan):** Live-Positions-Overlay (Marker + P-Nummern auf der Strecke) + Overtake-Highlight (Übersicht-Karten, Gewinn).
- **Phase 34 (deferred):** synchrones Replay, kombinierter Fahrerdialog, momentaner Streckenabstand-Gap, Marker-Overtake-Highlight, Marker-Kollisionsauflösung.
