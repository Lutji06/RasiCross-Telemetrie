# Phase 40: Per-Kart-OLED-Display-Routing — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Jeder Kart-Fahrer sieht auf seinem OLED die eigenen Rundenzeiten, Sektoren, Fahrer und Delta — nicht mehr die Daten des im Dashboard aktiven Karts.

**Architecture:** Rein Dashboard-seitig (Ansatz A der Spec): `buildRaceDataForKart(mac)` liest Kart-Bucket + Teilnehmer-Slot statt der Aktiv-Fassade; `sendDisplayUpdate()` schleift über alle bekannten Karts mit per-MAC-Dedupe und explizitem `target_mac`; das Live-Delta wird pro Kart berechnet (pure Funktion `nearestTraceDelta` in geo.js, TDD). Bridge (`_forward_to_kart`) und Sender-Firmware bleiben unverändert.

**Tech Stack:** Vanilla JS (klassische Scripts), UMD geo.js, node:test.

**Spec:** `docs/superpowers/specs/2026-07-03-per-kart-oled-design.md`

## Global Constraints (Working Directory & Conventions)

- Working Directory: `C:/Users/jimlu/Documents/RasiCross-Telemetrie-git`, Branch `feat/phase-40-per-kart-oled` (existiert, Spec-Commit liegt darauf).
- Dateien sind **CRLF**: Ziel-Region unmittelbar vor jedem Edit frisch lesen, Anker aus diesem Read kopieren.
- Verifikation: Grep-Tool (nicht Shell-grep), `node --check <datei>` je geänderter JS-Datei, `node --test`, `npm run lint`.
- Keine Änderungen an bridge.py/sender.py; keine neuen Display-Payload-Felder außer dem reinen Routing-Feld `target_mac` (Kart ignoriert es); jedes Paket bleibt < 250 B.
- Niemals `.claude/` oder Plan-Docs committen — außer dem expliziten Plan-Doc-Commit im letzten Task.
- Commits: conventional + Body, Trailer (keine Anführungszeichen in Messages — PowerShell-5.1-Falle):
  `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`
  `Claude-Session: https://claude.ai/code/session_013JpjGB74UNHRKEF6M5cbGj`

## Locked Decisions

- Fahrer im Display-Payload kommt aus `part.currentDriverId` (per Kart, Phase 35), nicht aus `r.currentDriverId`.
- `pit: true` nur für die MAC, an die der letzte Pit-Call ging (`_pitCallMac`); Abbruch/Timeout setzt sie zurück.
- Kart ohne Bucket/Teilnehmer oder ohne laufendes/pausiertes Rennen → Page-Only-Paket (Page-Wahl ist global, geht an alle).
- Per-MAC-Dedupe: `structuralRaceKey` + `RC_DISPLAY_KEEPALIVE_MS` (5 s) je MAC; Demo-MACs (`DE:MO:*`) werden übersprungen; leere Registry → ein Paket ohne `target_mac` (Bridge-Fallback = bisheriges Single-Kart-Verhalten); `KartRegistry.DEFAULT_MAC` bekommt ebenfalls kein `target_mac`.
- Delta-Kernrechnung als pure `nearestTraceDelta(bestTrace, cur)` in geo.js (UMD-Export, node:test); `updateLiveDelta()` berechnet für alle Karts, DOM-Banner weiterhin nur aus dem aktiven Kart (Fassade `state.liveDelta`).

## File Structure

| Action | Path | Responsibility |
|--------|------|----------------|
| Modify | `geo.js` | Neue pure Funktion `nearestTraceDelta` + UMD-Export |
| Modify | `test/geo.test.js` | Tests für `nearestTraceDelta` |
| Modify | `eslint.config.js` | `nearestTraceDelta` in `geoGlobals` |
| Modify | `live-ui.js` | `updateLiveDelta()`: Delta für alle Karts via `nearestTraceDelta` |
| Modify | `pit-wall.js` | `buildRaceDataForKart(mac)`, `_pitCallMac`, `sendDisplayUpdate()`-Schleife |

**Task-Reihenfolge:** 1 → 2 → 3 → 4 → 5 (sequenziell; 1 liefert die Funktion für 2).

---

### Task 1: `nearestTraceDelta` in geo.js (TDD)

**Files:**
- Modify: `geo.js` (Funktion vor dem UMD-Export-IIFE am Dateiende, Export im `api`-Objekt)
- Test: `test/geo.test.js` (ans Dateiende anhängen)
- Modify: `eslint.config.js` (`geoGlobals`)

**Interfaces:**
- Produces: `nearestTraceDelta(bestTrace, cur)` → `number | null`. `bestTrace` = Array `{t, lat, lon}` (Best-Lap-Trace), `cur` = `{t, lat, lon}` (letzter Punkt der aktuellen Runde). Liefert `cur.t - bestT` des räumlich nächsten Trace-Punkts (quadratischer lat/lon-Abstand, exakt die bisherige Inline-Formel aus updateLiveDelta) oder `null` bei `bestTrace.length < 5`, fehlender/ungültiger `cur`-Position oder leerem Ergebnis.

- [ ] **Step 1: Failing Tests schreiben** — ans Ende von `test/geo.test.js`:

```js
test('nearestTraceDelta: Delta zum raeumlich naechsten Best-Trace-Punkt', () => {
  const best = [
    { t: 1000, lat: 49.0000, lon: 6.0000 },
    { t: 2000, lat: 49.0001, lon: 6.0001 },
    { t: 3000, lat: 49.0002, lon: 6.0002 },
    { t: 4000, lat: 49.0003, lon: 6.0003 },
    { t: 5000, lat: 49.0004, lon: 6.0004 },
  ];
  // Aktuelle Position exakt auf Punkt t=3000, aktuelle Rundenzeit 3500 -> +500
  assert.equal(geo.nearestTraceDelta(best, { t: 3500, lat: 49.0002, lon: 6.0002 }), 500);
  // Schneller unterwegs: t=2500 an derselben Stelle -> -500
  assert.equal(geo.nearestTraceDelta(best, { t: 2500, lat: 49.0002, lon: 6.0002 }), -500);
});

test('nearestTraceDelta: null bei kurzer Trace oder fehlender Position', () => {
  const short = [
    { t: 1, lat: 49, lon: 6 }, { t: 2, lat: 49, lon: 6 },
    { t: 3, lat: 49, lon: 6 }, { t: 4, lat: 49, lon: 6 },
  ];
  assert.equal(geo.nearestTraceDelta(short, { t: 5, lat: 49, lon: 6 }), null);
  assert.equal(geo.nearestTraceDelta(null, { t: 5, lat: 49, lon: 6 }), null);
  const ok = short.concat([{ t: 5, lat: 49, lon: 6 }]);
  assert.equal(geo.nearestTraceDelta(ok, null), null);
  assert.equal(geo.nearestTraceDelta(ok, { t: 5, lat: 0, lon: 6 }), null);
  assert.equal(geo.nearestTraceDelta(ok, { lat: 49, lon: 6 }), null);
});
```

(Hinweis: `cur.lat`/`cur.lon` von `0` gelten wie in der bisherigen Inline-Prüfung `!cur.lat || !cur.lon` als ungültig.)

- [ ] **Step 2: Tests laufen lassen — müssen fehlschlagen**

Run: `node --test --test-name-pattern "nearestTraceDelta" test/geo.test.js`
Expected: 2 FAIL (`geo.nearestTraceDelta is not a function`).

- [ ] **Step 3: Implementierung** — in `geo.js` direkt VOR dem UMD-Export-IIFE (`(function () {` / `var api = {`) einfügen:

```js
// Live-Delta-Kern (Phase 40): Zeitdifferenz zum raeumlich naechsten Punkt
// der Best-Lap-Trace (quadratischer lat/lon-Abstand — identisch zur alten
// Inline-Rechnung in updateLiveDelta). Total: null statt Wurf bei kaputten
// Eingaben (<5 Trace-Punkte, fehlende Position/Zeit).
function nearestTraceDelta(bestTrace, cur) {
  if (!Array.isArray(bestTrace) || bestTrace.length < 5) return null;
  if (!cur || !cur.lat || !cur.lon || typeof cur.t !== 'number') return null;
  var bestT = null, minD = Infinity;
  for (var i = 0; i < bestTrace.length; i++) {
    var p = bestTrace[i];
    if (!p) continue;
    var d = (p.lat - cur.lat) * (p.lat - cur.lat)
          + (p.lon - cur.lon) * (p.lon - cur.lon);
    if (d < minD) { minD = d; bestT = p.t; }
  }
  return bestT == null ? null : cur.t - bestT;
}
```

Im `api`-Objekt des Export-IIFE nach `trackProgressM: trackProgressM, lapProgressM: lapProgressM` ergänzen: `,
    nearestTraceDelta: nearestTraceDelta`

In `eslint.config.js` in `geoGlobals` nach `trackProgressM: 'readonly', lapProgressM: 'readonly',` ergänzen: `nearestTraceDelta: 'readonly',`

- [ ] **Step 4: Tests grün**

Run: `node --test test/geo.test.js`
Expected: alle PASS.

- [ ] **Step 5: Commit**

```bash
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" add geo.js test/geo.test.js eslint.config.js
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" commit -m "feat(oled): nearestTraceDelta pure Delta-Kernrechnung in geo.js + Tests"
```

(Trailer wie in Global Constraints — gilt für alle Commits.)

---

### Task 2: Per-Kart-Live-Delta in `updateLiveDelta`

**Files:**
- Modify: `live-ui.js` (`updateLiveDelta`, ~Zeile 158–186)

**Interfaces:**
- Consumes: `nearestTraceDelta` (Task 1, geo.js-Global).
- Produces: `k.liveDelta` ist für JEDEN Kart mit laufender Runde + Best-Trace aktuell (500-ms-Throttle); `state.liveDelta` (Fassade, aktiver Kart) speist wie bisher Banner/Pit-Wall.

- [ ] **Step 1: Funktion ersetzen** — komplette `updateLiveDelta` ersetzen. Alt (Kern): Facade-only-Berechnung mit Inline-Nearest-Loop. Neu:

```js
let _lastDeltaUpdate = 0;
function updateLiveDelta() {
  if (Date.now() - _lastDeltaUpdate < 500) return;
  _lastDeltaUpdate = Date.now();
  // Phase 40: Delta fuer ALLE Karts (per-Kart-OLED). Kernrechnung ist
  // nearestTraceDelta (geo.js, getestet); DOM-Banner speist weiterhin
  // nur der aktive Kart (Fassade state.liveDelta).
  for (const mac of state.karts.macs()) {
    const k = state.karts.get(mac);
    if (!k) continue;
    if (!k.lapStart || !k.bestLapTrace || !k.currentLapTrace.length) {
      k.liveDelta = null;
      continue;
    }
    const cur = k.currentLapTrace[k.currentLapTrace.length - 1];
    const d = nearestTraceDelta(k.bestLapTrace, cur);
    if (d != null) k.liveDelta = d;
  }
  const banner = $('deltaBanner');
  if (state.liveDelta == null) {
    if (banner) banner.classList.add('hidden');
    return;
  }
  const delta = state.liveDelta;
  if (banner) banner.classList.remove('hidden');
  const tEl = $('deltaTime');
  if (tEl) {
    tEl.textContent = (delta >= 0 ? '+' : '') + (delta / 1000).toFixed(3) + 's';
    tEl.className = 'delta-time ' + (Math.abs(delta) < 50 ? 'same' : delta < 0 ? 'faster' : 'slower');
  }
  setText('deltaRef', `vs. Runde ${state.bestLapNum} (${fmtMs(state.bestLapMs)})`);
}
```

(Semantik-Erhalt: `d != null` überschreibt nur bei gültiger Messung — wie vorher, wo ein ungültiger `cur` die Funktion vor dem Setzen verließ; Reset auf `null` weiterhin nur ohne laufende Runde/Trace.)

- [ ] **Step 2: Verifizieren**

Run: `node --check live-ui.js` — kein Output. `node --test` — PASS.
Grep-Tool: pattern `nearestTraceDelta` in live-ui.js — 1 Treffer.

- [ ] **Step 3: Commit**

```bash
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" add live-ui.js
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" commit -m "feat(oled): Live-Delta pro Kart berechnen (Banner weiter nur aktiver Kart)"
```

---

### Task 3: `buildRaceDataForKart(mac)` + Pit-Call-Ziel-MAC

**Files:**
- Modify: `pit-wall.js` (`_pitCallActive`-Block ~Zeile 311, `buildRaceDataForKart` ~Zeile 317–389, `togglePitCall` ~Zeile 446–486)

**Interfaces:**
- Consumes: `RasiLapEngine.partOf`, `RasiLapEngine.partValidLaps`, `KartRegistry.DEFAULT_MAC`.
- Produces: `buildRaceDataForKart(mac)` — ohne Argument identisches Verhalten wie bisher (aktiver Kart); mit MAC per-Kart-Payload. Modul-Variable `_pitCallMac` (MAC des letzten Pit-Call-Ziels oder `null`).

- [ ] **Step 1: `_pitCallMac` deklarieren** — Block

```js
let _pitCallActive = false;
let _pitCallTimer = null;
```

ersetzen durch:

```js
let _pitCallActive = false;
let _pitCallTimer = null;
// Phase 40: Ziel-Kart des laufenden Pit-Calls — nur dessen Display-Payload
// bekommt pit:true.
let _pitCallMac = null;
```

- [ ] **Step 2: `buildRaceDataForKart` parametrisieren** — komplette Funktion ersetzen durch:

```js
function buildRaceDataForKart(mac) {
  // Phase 40: Payload fuer EINEN Kart (Bucket + Teilnehmer-Slot). Ohne
  // Argument: aktiver Kart (bisheriges Verhalten der Aufrufer).
  mac = mac || state.activeKartMac || KartRegistry.DEFAULT_MAC;
  const r = activeRace();
  const k = state.karts.has(mac) ? state.karts.get(mac) : null;
  const part = r ? RasiLapEngine.partOf(r, mac) : null;
  // Ohne Race/Bucket/Teilnahme wird nur die page-Auswahl uebermittelt
  // (kleines Paket; die OLED-Page-Wahl ist global).
  if (!r || (r.status !== 'running' && r.status !== 'paused') || !k || !part) {
    return {
      type: 'display',
      page: state.settings.oledPage || 'auto',
      // Race-Felder bleiben leer/default
      sectors: ['open', 'open', 'open'],
    };
  }
  // Phase 40: Fahrer DIESES Karts (Teilnehmer-Slot, per-Kart seit Phase 35).
  const drv = state.drivers.find(d => d.id === part.currentDriverId);
  // Sektor-States: 'done' bei abgeschlossenen, 'current' beim aktiven, 'open' sonst
  const cur = k.sectorsLive.cur || 0;
  const lapSec = k.sectorsLive.lapSectors || [null, null, null];
  const sectorStates = ["open", "open", "open"];
  for (let i = 0; i < 3; i++) {
    if (lapSec[i] != null) sectorStates[i] = "done";
    else if (i === cur && k.lapStart) sectorStates[i] = "current";
  }
  // Aktuelle Rundenzeit (mm:ss.SSS)
  const lapMs = k.lapStart ? Date.now() - k.lapStart : 0;
  const lapStr = k.lapStart ? fmtMs(lapMs) : "--:--.---";
  // Delta vs Bestzeit dieses Karts (per-Kart-liveDelta, Phase 40/Task 2)
  let deltaStr = "--";
  let liveDeltaStr = "--";
  let liveDeltaMs = null;
  if (k.liveDelta != null) {
    const sign = k.liveDelta >= 0 ? "+" : "";
    liveDeltaStr = sign + (k.liveDelta / 1000).toFixed(3);
    liveDeltaMs = k.liveDelta;
    deltaStr = liveDeltaStr;
  }
  // Bestzeit dieses Karts (Teilnehmer-Slot, Fallback Registry-Bucket)
  const bestMs = part.bestLapMs != null ? part.bestLapMs : k.bestLapMs;
  const bestNum = part.bestLapNum != null ? part.bestLapNum : k.bestLapNum;
  const bestStr = bestMs ? fmtMs(bestMs) : "--";
  const validLaps = RasiLapEngine.partValidLaps(part).length;
  let target = "--";
  if (r.lengthType === 'laps') target = r.targetLaps;
  else if (r.lengthType === 'time') target = "T";
  // Restzeit (nur bei Time-Races) und gefahrene Zeit
  let remainingMs = null;
  let elapsedMs = raceElapsedMs(r);
  if (r.lengthType === 'time' && r.durationMs > 0) {
    remainingMs = Math.max(0, r.durationMs - elapsedMs);
  }
  // Driver-Name max 8 Zeichen, Nummer max 3
  const driverName = drv ? drv.name.slice(0, 8) : "--";
  const driverNum = drv ? String(drv.number || "").slice(0, 3) : "";
  return {
    type:           "display",
    driver:         driverName,
    num:            driverNum,
    lap:            lapStr,
    lap_ms:         k.lapStart ? lapMs : null,    // Kart-seitiger Anker
    lapn:           validLaps + 1,
    target:         target,
    delta:          deltaStr,
    live_delta:     liveDeltaStr,
    live_delta_ms:  liveDeltaMs,
    live_delta_ref: bestNum || null,
    best_lap:       bestStr,
    sectors:        sectorStates,
    elapsed_ms:     elapsedMs,
    remaining_ms:   remainingMs,
    length_type:    r.lengthType,
    page:           state.settings.oledPage || 'auto',
    running:        r.status === 'running' && !!k.lapStart,
    pit:            !!(_pitCallActive && _pitCallMac === mac),
  };
}
```

- [ ] **Step 3: Pit-Call-Ziel setzen/zurücksetzen** — in `togglePitCall`:
  - Im Abbruch-Zweig nach `_pitCallActive = false;` einfügen: `_pitCallMac = null;`
  - Im Demo-Zweig nach `_pitCallActive = true;` einfügen: `_pitCallMac = state.activeKartMac || KartRegistry.DEFAULT_MAC;` und im Demo-Timeout-Callback nach `_pitCallActive = false;` einfügen: `_pitCallMac = null;`
  - Im Serial-Zweig (`if (sendPitCall(...))`) nach `_pitCallActive = true;` einfügen: `_pitCallMac = state.activeKartMac || KartRegistry.DEFAULT_MAC;` und im Timeout-Callback nach `_pitCallActive = false;` einfügen: `_pitCallMac = null;`

- [ ] **Step 4: Verifizieren**

Run: `node --check pit-wall.js` — kein Output. `node --test` — PASS.
Grep-Tool: pattern `_pitCallMac` in pit-wall.js — Expected 7 Treffer (Deklaration + pit-Flag + 5 Zuweisungen).

- [ ] **Step 5: Commit**

```bash
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" add pit-wall.js
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" commit -m "feat(oled): buildRaceDataForKart(mac) liest Kart-Bucket + Teilnehmer-Slot"
```

---

### Task 4: `sendDisplayUpdate()`-Schleife mit per-MAC-Dedupe

**Files:**
- Modify: `pit-wall.js` (`_lastDisplayKey`-Block + `sendDisplayUpdate`, ~Zeile 390–411)

**Interfaces:**
- Consumes: `buildRaceDataForKart(mac)` (Task 3), `structuralRaceKey` (geo.js), `window.rasiBridgeSend`, `KartRegistry.DEFAULT_MAC`.

- [ ] **Step 1: Dedupe-State + Schleife** — den Block von

```js
let _lastDisplayKey = '';
let _lastDisplayAt = 0;
const RC_DISPLAY_KEEPALIVE_MS = 5000;
function sendDisplayUpdate() {
```

bis zum Ende der Funktion (`}` nach dem `catch`-Block) ersetzen durch:

```js
// Phase 40: Dedupe pro Ziel-MAC — jedes Kart bekommt SEINE Daten.
let _lastDisplayKeyByMac = {};
let _lastDisplayAtByMac = {};
const RC_DISPLAY_KEEPALIVE_MS = 5000;
function sendDisplayUpdate() {
  if (state.connection.source !== 'serial' || !state.serial.connected) return;
  if (!window.rasiSerial?.writeLine) return;
  const now = Date.now();
  // Leere Registry -> ein Paket ohne target_mac (Bridge-Fallback = zuletzt
  // gehoerter Kart, bisheriges Single-Kart-Verhalten).
  const macs = state.karts.macs();
  const targets = macs.length ? macs : [null];
  for (const mac of targets) {
    // Demo-Karts sind keine Funk-Ziele (Mischfall Serial + Demo-Reste).
    if (mac && mac.indexOf('DE:MO:') === 0) continue;
    const payload = buildRaceDataForKart(mac || undefined);
    if (!payload) continue;
    const dedupeKey = mac || '_single';
    const key = structuralRaceKey(payload);
    if (key === _lastDisplayKeyByMac[dedupeKey]
        && (now - (_lastDisplayAtByMac[dedupeKey] || 0)) < RC_DISPLAY_KEEPALIVE_MS) continue;
    // target_mac explizit setzen — der rasiBridgeSend-Default wuerde sonst
    // immer den AKTIVEN Kart adressieren. default-Bucket: Bridge-Fallback.
    if (mac && mac !== KartRegistry.DEFAULT_MAC) payload.target_mac = mac;
    try {
      window.rasiBridgeSend(payload);
      _lastDisplayKeyByMac[dedupeKey] = key;
      _lastDisplayAtByMac[dedupeKey] = now;
    } catch (e) {
      // stumm - keine Hupe wenn der Sender mal nicht erreichbar ist
    }
  }
}
```

Hinweis: `rasiBridgeSend` setzt `target_mac` nur, wenn es noch fehlt — durch das explizite Setzen pro Kart greift der Aktiv-Kart-Default hier nie. Für `mac === KartRegistry.DEFAULT_MAC` kann der Default kurzzeitig greifen, solange Registry default + echte Karts gemischt enthält; dieser Zustand endet mit der Bucket-Adoption beim ersten echten Paket (bestehendes Verhalten, akzeptiert).

- [ ] **Step 2: Verifizieren**

Run: `node --check pit-wall.js` — kein Output. `node --test` — PASS. `npm run lint` — sauber.
Grep-Tool: pattern `_lastDisplayKey\b` in pit-wall.js — Expected: 0 Treffer (alte Singles ersetzt); pattern `_lastDisplayKeyByMac` — Expected: 3 Treffer.

- [ ] **Step 3: Commit**

```bash
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" add pit-wall.js
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" commit -m "feat(oled): Display-Updates an alle Karts mit per-MAC-Dedupe routen"
```

---

### Task 5: Gesamtverifikation + Plan-Doc-Commit

- [ ] **Step 1: Voll-Verifikation**

```bash
node --check geo.js; node --check live-ui.js; node --check pit-wall.js
node --test
npm run lint
```

Expected: keine Syntaxfehler, alle Tests PASS (Baseline + neue nearestTraceDelta-Tests), Lint sauber.

- [ ] **Step 2: Grep-Statik-Checks** (Grep-Tool):
  - `state\.liveDelta` in pit-wall.js → nur noch in `updatePitWall` (Pit-Wall zeigt aktiven Kart — korrekt), nicht mehr in `buildRaceDataForKart`.
  - `state\.sectorsLive|state\.lapStart|state\.bestLapMs` in `buildRaceDataForKart` → 0 Treffer (alles über `k`/`part`).
  - `target_mac` in pit-wall.js → 1 Treffer (sendDisplayUpdate).

- [ ] **Step 3: Plan-Doc committen**

```bash
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" add docs/superpowers/plans/2026-07-03-40-per-kart-oled.md
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" commit -m "docs(plan): Phase 40 per-Kart-OLED Implementierungsplan"
```

---

## Hardware/Manual Acceptance Checklist (User, 2+ echte Karts)

1. Rennen mit 2 Karts + verschiedenen Fahrern (Phase-35-Dialog) starten: jedes OLED zeigt SEINEN Fahrernamen und SEINE laufende Rundenzeit; nach Runden-Ende weichen `lapn`/Bestzeit der beiden Displays voneinander ab.
2. Delta-Page am Hintergrund-Kart: zeigt nach der 2. Runde ein eigenes Delta (nicht "--", nicht das Delta des aktiven Karts).
3. Pit-Call an Kart A: nur Kart A zeigt das Pit-Flag/Override; Kart B unbeeinflusst.
4. Single-Kart-Betrieb: Verhalten unverändert (Bridge-Fallback ohne target_mac).
5. OLED-Page-Wechsel in den Einstellungen wirkt auf beide Karts.

## Self-Review

- **Spec-Abdeckung:** D1→Task 3, D2→Task 4, D3→Task 3 (Step 1+3), D4→Tasks 1+2; Nicht-Ziele (Python, Demo-Downlink, Payload-Format) unberührt. ✔
- **Platzhalter-Scan:** alle Code-Steps vollständig. ✔
- **Namens-Konsistenz:** `nearestTraceDelta(bestTrace, cur)` (Tasks 1/2), `buildRaceDataForKart(mac)` (Tasks 3/4), `_pitCallMac` (Task 3), `_lastDisplayKeyByMac`/`_lastDisplayAtByMac` (Task 4). ✔

## Phase Map

- Phase 35: per-Kart-Fahrerwechsel; Phase 39: Multikart-Bugfixes + UI + Demo — merged.
- **Phase 40 (dieser Plan): per-Kart-OLED-Display-Routing.**
