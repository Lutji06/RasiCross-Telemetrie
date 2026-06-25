# Phase 35 — Kombinierter Multi-Kart-Fahrerdialog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Der „Fahrerwechsel"-Dialog zeigt eine Zeile je Teilnehmer-Kart (Farbe/Name + Fahrer-Dropdown, vorbelegt mit dem aktuellen Fahrer); Bestätigen wechselt in einem Schritt alle geänderten Karts, unveränderte bleiben unberührt.

**Architecture:** Eine reine, TDD'd `applyDriverChange`-Funktion (analog `commitLap`) kommt in `lap-engine.js`. Das `#driverModal` wird vom Einzel-Select auf einen Per-Kart-Zeilencontainer umgestellt; `races.js` rendert die Zeilen und committet beim Bestätigen nur die geänderten Karts. Reine Logik per `node:test`, DOM-Verdrahtung per `node --check` + ESLint + Grep.

**Tech Stack:** Vanilla JS (Browser-Globals / UMD-IIFE), `node:test`, ESLint 9 (Flat-Config). Verifikation: `node --check`, `node --test`, `eslint`, Python-Baselines (`py_compile`/`unittest`).

**Spec:** `docs/superpowers/specs/2026-06-25-combined-driver-dialog-design.md`

## Global Constraints

- Repo-Root: `C:/Users/jimlu/Documents/RasiCross-Telemetrie-git`. Branch: `feat/combined-driver-dialog` (von `main` nach Phase 34/PR #54).
- **Dateien sind CRLF.** Unmittelbar vor jedem `Edit` die Zielstelle frisch in-session lesen und den Anker aus diesem Read kopieren — Zeilennummern hier sind indikativ, auf Text ankern.
- Verifikation mit dem **Grep-Tool** (nicht Shell-`grep`).
- **Niemals `.claude/` committen**, Plan-/Spec-Doc nur im expliziten Doc-Commit (Task 3).
- Commit-Messages: conventional + kurzer Body + Trailer `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- `__pycache__` vor jedem `git status`/commit löschen.
- **Verhalten unverändert für Single-Kart:** mit einem Teilnehmer zeigt der Dialog genau eine Zeile (Wechsel wie vor Phase 35). **Nur geänderte Karts** werden committet (kein leerer Stint).
- **Save-Format additiv:** nur zusätzliche Stints im bestehenden `participant.stints`; keine neuen Felder, keine Migration.
- **`kart-overview.js`, `map-draw.js`, `geo.js`, `pit-wall.js`, `live-ui.js`, `package.json`, `eslint.config.js` bleiben unverändert** (alle nötigen Globals — `RasiLapEngine`, `uid`, `state`, `esc`, `renderRaces`, `saveDataDebounced`, `rcToast`, `document` — sind im `races.js`-Block bereits vorhanden).
- **Verifikationsrezept (pro Task wo relevant + final):**
  - `node --check <berührte .js>`
  - `node --test` (muss grün bleiben/wachsen; aktuell **162** + 4 neue = **166**)
  - `npx eslint <berührte .js>` → 0 Fehler
  - `python -m py_compile bridge.py` + `python -m unittest discover -s test -p "test_*.py"` → **50 OK** (Python unverändert)
  - Python kann `python` oder `py -3` sein.

---

## File Structure

| Aktion | Datei | Verantwortung |
|--------|-------|---------------|
| Ändern | `lap-engine.js` | Neue reine `applyDriverChange(part, newDriverId, now)`; im UMD-Return exportieren. |
| Ändern | `test/lap-engine.test.js` | `node:test`-Fälle für `applyDriverChange`; Export-Liste erweitern. |
| Ändern | `RasiCross_Telemetry.html` | `#driverModalSelect`-Feld → `#driverModalList`-Container; CSS für die Zeilen. |
| Ändern | `races.js` | `openDriverChange` rendert Zeilen je Teilnehmer; `confirmDriverChange` schleift über Teilnehmer mit `applyDriverChange`; Helfer `driverOptionsHtml`. |
| Ändern | `laps-drivers.js` | `renderDriverOptions`: toten `#driverModalSelect`-Zweig (`sel2`) entfernen. |

**Task-Reihenfolge:** 1 (lap-engine `applyDriverChange` + Tests) → 2 (Dialog: HTML + races.js + laps-drivers-Cleanup) → 3 (finale Verifikation + Plan-Doc).

> **Verifikationsstrategie:** `applyDriverChange` wird per `node:test` TDD'd. Dialog-Verdrahtung: `node --check` + ESLint + Grep-Asserts + grüne Baselines. Funktionales Multi-Kart-Verhalten bleibt manuell (Hardware, §7 Spec).

---

## Task 1: `lap-engine.js` — `applyDriverChange` (Pure-Logik, TDD)

**Files:**
- Modify: `lap-engine.js` (neue Funktion nach `positionGains` ~Zeile 209; Export-Block ~Zeile 226)
- Modify: `test/lap-engine.test.js` (Export-Liste ~Zeile 11; neue Tests am Dateiende)

**Interfaces:**
- Consumes: nichts (rein über Parameter).
- Produces (von Task 2 konsumiert), auf `window.RasiLapEngine`:
  - `applyDriverChange(part, newDriverId, now)` → schließt offenen Stint (`endAt=now`), setzt `part.currentDriverId`, pusht + returnt neuen Stint `{ driverId, startAt: now, endAt: null }` **ohne `id`** (Aufrufer setzt `stint.id = uid()`). Idempotent gegen bereits geschlossene Stints.

- [ ] **Step 1: Export-Liste im Test erweitern (failing)**

Lies `test/lap-engine.test.js` frisch um die Export-Liste (Grep `'rankParticipants','leaderReachedTarget','fastestLapHolder',`). Ersetze:

```js
                      'rankParticipants','leaderReachedTarget','fastestLapHolder',
                      'positionGains']) {
```

durch:

```js
                      'rankParticipants','leaderReachedTarget','fastestLapHolder',
                      'positionGains','applyDriverChange']) {
```

- [ ] **Step 2: Neue Tests ans Dateiende anhängen (failing)**

Lies das Ende von `test/lap-engine.test.js` frisch und füge **nach** dem letzten `test(...)`-Block ein:

```js

test('applyDriverChange closes open stint and opens a new one', () => {
  const part = { currentDriverId: 'd1',
    stints: [{ id: 's1', driverId: 'd1', startAt: 100, endAt: null }] };
  const st = E.applyDriverChange(part, 'd2', 500);
  assert.equal(part.stints[0].endAt, 500);
  assert.equal(part.currentDriverId, 'd2');
  assert.equal(part.stints.length, 2);
  assert.equal(st.driverId, 'd2');
  assert.equal(st.startAt, 500);
  assert.equal(st.endAt, null);
  assert.equal(part.stints[1], st);
});

test('applyDriverChange on empty stints just opens a stint', () => {
  const part = { currentDriverId: null, stints: [] };
  const st = E.applyDriverChange(part, 'd1', 200);
  assert.equal(part.stints.length, 1);
  assert.equal(part.currentDriverId, 'd1');
  assert.equal(st.driverId, 'd1');
});

test('applyDriverChange does not re-close an already closed last stint', () => {
  const part = { currentDriverId: 'd1',
    stints: [{ id: 's1', driverId: 'd1', startAt: 100, endAt: 300 }] };
  E.applyDriverChange(part, 'd2', 500);
  assert.equal(part.stints[0].endAt, 300);
  assert.equal(part.stints.length, 2);
});

test('applyDriverChange creates a stint without an id (caller assigns)', () => {
  const part = { currentDriverId: 'd1', stints: [] };
  const st = E.applyDriverChange(part, 'd2', 10);
  assert.equal(st.id, undefined);
});
```

- [ ] **Step 3: Tests laufen lassen — müssen fehlschlagen**

Run: `node --test test/lap-engine.test.js`
Expected: FAIL (`applyDriverChange` nicht definiert).

- [ ] **Step 4: `applyDriverChange` implementieren**

Lies `lap-engine.js` frisch um `function positionGains` (Grep `if (pv != null && e.pos < pv) out.push(e.mac);`). Füge **direkt nach** dem Ende der `positionGains`-Funktion (nach ihrer schließenden `}` und vor `return {`) ein:

```js

  // Phase 35: Fahrerwechsel auf einen Teilnehmer anwenden (analog commitLap):
  // offenen Stint schliessen, currentDriverId setzen, neuen Stint oeffnen.
  // Stint ohne id -> Aufrufer setzt stint.id = uid(). Idempotent gegen bereits
  // geschlossene Stints.
  function applyDriverChange(part, newDriverId, now) {
    if (!part.stints) part.stints = [];
    var open = part.stints.length ? part.stints[part.stints.length - 1] : null;
    if (open && !open.endAt) open.endAt = now;
    part.currentDriverId = newDriverId;
    var stint = { driverId: newDriverId, startAt: now, endAt: null };
    part.stints.push(stint);
    return stint;
  }
```

- [ ] **Step 5: `applyDriverChange` exportieren**

Lies den Return-Block frisch (Grep `positionGains: positionGains,`). Ersetze:

```js
    positionGains: positionGains,
  };
```

durch:

```js
    positionGains: positionGains,
    applyDriverChange: applyDriverChange,
  };
```

- [ ] **Step 6: Tests laufen lassen — müssen bestehen**

Run: `node --test test/lap-engine.test.js`
Expected: PASS (alle neuen Tests grün).

- [ ] **Step 7: Voll-Suite + Lint**

Run: `node --check lap-engine.js` → OK.
Run: `npx eslint lap-engine.js test/lap-engine.test.js` → 0 Fehler.
Run: `node --test` → vorher 162, jetzt **166** PASS, 0 fail.

- [ ] **Step 8: Commit**

```bash
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" add lap-engine.js test/lap-engine.test.js
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" commit -m "feat(driver-dialog): applyDriverChange engine helper + tests

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: Kombinierter Dialog (HTML + `races.js` + `laps-drivers.js`-Cleanup)

**Files:**
- Modify: `RasiCross_Telemetry.html` (Modal-Feld ~Zeile 3704; CSS nach `.dialog .field:last-of-type` ~Zeile 1349)
- Modify: `races.js` (`openDriverChange` ~195–203; `confirmDriverChange` ~205–224; neuer Helfer `driverOptionsHtml`)
- Modify: `laps-drivers.js` (`renderDriverOptions` ~355–366)

**Interfaces:**
- Consumes: `RasiLapEngine.{participantsOf,applyDriverChange}` (Task 1), `activeRace()`, `state.kartMeta`, `state.drivers`, `uid()`, `esc()`, `renderRaces()`, `saveDataDebounced()`, `rcToast()`, `document`.
- Produces: Per-Kart-Fahrerdialog im `#driverModalList`.

- [ ] **Step 1: Modal-Feld → Zeilencontainer (HTML)**

Lies `RasiCross_Telemetry.html` frisch um das Select-Feld (Grep `<select id="driverModalSelect">`). Ersetze:

```html
    <div class="field"><label>Nächster Fahrer</label><select id="driverModalSelect"></select></div>
```

durch:

```html
    <div id="driverModalList" class="driver-change-list"></div>
```

- [ ] **Step 2: CSS für die Zeilen**

Lies `RasiCross_Telemetry.html` frisch um `.dialog .field:last-of-type` (Grep `.dialog .field:last-of-type\{margin-bottom:0\}`). Ersetze:

```css
.dialog .field:last-of-type{margin-bottom:0}
```

durch:

```css
.dialog .field:last-of-type{margin-bottom:0}
.driver-change-list{display:flex;flex-direction:column;gap:8px;max-height:300px;overflow-y:auto}
.driver-change-list .dc-row{display:flex;align-items:center;gap:8px}
.driver-change-list .dc-dot{width:12px;height:12px;border-radius:50%;flex:0 0 auto}
.driver-change-list .dc-name{flex:0 0 90px;font-weight:600;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.driver-change-list .dc-sel{flex:1}
```

- [ ] **Step 3: `openDriverChange` rendert Zeilen + `driverOptionsHtml`-Helfer (races.js)**

Lies `races.js` frisch um `function openDriverChange` (Grep `function openDriverChange\(\) \{`). Ersetze die komplette Funktion:

```js
function openDriverChange() {
  const r = activeRace();
  if (!r || r.status !== 'running') return;
  renderDriverOptions();
  // Pre-select non-current driver if possible
  const sel = $('driverModalSelect');
  const others = state.drivers.filter(d => d.id !== r.currentDriverId);
  if (others.length && sel) sel.value = others[0].id;
  $('driverModal').classList.add('show');
}
```

durch:

```js
// Phase 35: <option>-Liste aller Fahrer; selectedId markiert den aktuellen.
function driverOptionsHtml(selectedId) {
  if (!state.drivers.length) return '<option value="">Keine Fahrer</option>';
  return state.drivers.map(d =>
    `<option value="${esc(d.id)}"${d.id === selectedId ? ' selected' : ''}>${esc(d.name)}${d.number ? ' #' + esc(d.number) : ''}</option>`
  ).join('');
}
function openDriverChange() {
  const r = activeRace();
  if (!r || r.status !== 'running') return;
  // Phase 35: eine Zeile je Teilnehmer-Kart (Farbe/Name + Fahrer-Dropdown,
  // vorbelegt mit dem aktuellen Fahrer).
  const list = $('driverModalList');
  if (list) {
    list.innerHTML = RasiLapEngine.participantsOf(r).map(p => {
      const meta = state.kartMeta && state.kartMeta[p.mac];
      const color = (meta && meta.color) || '#3aa0e8';
      const name = (meta && meta.name) || 'Kart';
      return `<div class="dc-row">
        <span class="dc-dot" style="background:${esc(color)}"></span>
        <span class="dc-name">${esc(name)}</span>
        <select class="dc-sel" data-mac="${esc(p.mac)}">${driverOptionsHtml(p.currentDriverId)}</select>
      </div>`;
    }).join('');
  }
  $('driverModal').classList.add('show');
}
```

- [ ] **Step 4: `confirmDriverChange` schleift über Teilnehmer (races.js)**

Lies `races.js` frisch um `function confirmDriverChange` (Grep `function confirmDriverChange\(\) \{`). Ersetze die komplette Funktion:

```js
function confirmDriverChange() {
  const r = activeRace();
  if (!r) return;
  const newId = $('driverModalSelect').value;
  if (!newId || newId === r.currentDriverId) {
    $('driverModal').classList.remove('show');
    return;
  }
  const now = Date.now();
  // Phase 30: Fahrerwechsel gilt fuer den aktuell per Chip gewaehlten Kart.
  const p = activePart(r);
  const old = p.stints && p.stints.length ? p.stints[p.stints.length - 1] : null;
  if (old && !old.endAt) old.endAt = now;
  p.currentDriverId = newId;
  p.stints.push({ id: uid(), driverId: newId, startAt: now, endAt: null });
  $('driverModal').classList.remove('show');
  renderRaces();
  saveDataDebounced();
  rcToast('Fahrer gewechselt');
}
```

durch:

```js
function confirmDriverChange() {
  const r = activeRace();
  if (!r) return;
  const now = Date.now();
  // Phase 35: nur Teilnehmer mit abweichender Auswahl bekommen einen neuen Stint.
  let changed = 0;
  const list = $('driverModalList');
  const sels = list ? list.querySelectorAll('.dc-sel') : [];
  sels.forEach(sel => {
    const mac = sel.getAttribute('data-mac');
    const p = r.participants && r.participants[mac];
    if (!p) return;
    const newId = sel.value;
    if (!newId || newId === p.currentDriverId) return;
    const stint = RasiLapEngine.applyDriverChange(p, newId, now);
    stint.id = uid();
    changed++;
  });
  $('driverModal').classList.remove('show');
  if (changed) {
    renderRaces();
    saveDataDebounced();
    rcToast(changed === 1 ? 'Fahrer gewechselt' : changed + ' Fahrer gewechselt');
  } else {
    rcToast('Keine Änderung');
  }
}
```

- [ ] **Step 5: `renderDriverOptions` toten Select-Zweig entfernen (laps-drivers.js)**

Lies `laps-drivers.js` frisch um `function renderDriverOptions` (Grep `function renderDriverOptions\(\) \{`). Ersetze die komplette Funktion:

```js
function renderDriverOptions() {
  const sel1 = $('newRaceDriver');
  const sel2 = $('driverModalSelect');
  if (!state.drivers.length) {
    if (sel1) sel1.innerHTML = '<option value="">Bitte zuerst Fahrer anlegen</option>';
    if (sel2) sel2.innerHTML = '<option value="">Keine Fahrer</option>';
    return;
  }
  const opts = state.drivers.map(d => `<option value="${d.id}">${esc(d.name)} ${d.number ? '#' + esc(d.number) : ''}</option>`).join('');
  if (sel1) sel1.innerHTML = opts;
  if (sel2) sel2.innerHTML = opts;
}
```

durch:

```js
function renderDriverOptions() {
  // Phase 35: #driverModalSelect entfiel mit dem kombinierten Dialog; nur noch
  // das Neues-Rennen-Formular (#newRaceDriver) wird hier befuellt.
  const sel1 = $('newRaceDriver');
  if (!state.drivers.length) {
    if (sel1) sel1.innerHTML = '<option value="">Bitte zuerst Fahrer anlegen</option>';
    return;
  }
  const opts = state.drivers.map(d => `<option value="${d.id}">${esc(d.name)} ${d.number ? '#' + esc(d.number) : ''}</option>`).join('');
  if (sel1) sel1.innerHTML = opts;
}
```

- [ ] **Step 6: Verify**

Run: `node --check races.js laps-drivers.js` → OK.
Run: `npx eslint races.js laps-drivers.js` → 0 Fehler.
Run: `node --test` → grün (166).
Grep `races.js` für `driverOptionsHtml`, `RasiLapEngine.applyDriverChange`, `dc-sel`, `Keine Änderung` → vorhanden; für `$('driverModalSelect')` → **nicht mehr** vorhanden.
Grep `laps-drivers.js` für `driverModalSelect` → **nicht mehr** vorhanden.
Grep `RasiCross_Telemetry.html` für `id="driverModalList"`, `.driver-change-list\{` → vorhanden; für `id="driverModalSelect"` → **nicht mehr** vorhanden.

- [ ] **Step 7: Commit**

```bash
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" add RasiCross_Telemetry.html races.js laps-drivers.js
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" commit -m "feat(driver-dialog): combined per-kart driver change dialog (commit only changed)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: Finale Verifikation + Plan-Doc

**Files:**
- Modify: (nur Verifikation; Plan-Doc-Commit)

- [ ] **Step 1: Voll-Verifikation (alles grün)**
  - `node --check lap-engine.js races.js laps-drivers.js`
  - `npx eslint lap-engine.js test/lap-engine.test.js races.js laps-drivers.js` → 0 Fehler
  - `node --test` → **166 PASS**, 0 fail (162 alt + 4 neue)
  - `python -m py_compile bridge.py` → kein Fehler (unverändert)
  - `python -m unittest discover -s test -p "test_*.py"` → **50 OK** (unverändert)
  - `__pycache__` löschen, dann `git status` → sauber bis auf `.claude/` und das Plan-Doc.

- [ ] **Step 2: Grep-Gesamtcheck**
  - `lap-engine.js`: `function applyDriverChange`, `applyDriverChange: applyDriverChange`.
  - `races.js`: `function driverOptionsHtml`, `RasiLapEngine.applyDriverChange`, `Keine Änderung`; **kein** `$('driverModalSelect')`.
  - `laps-drivers.js`: **kein** `driverModalSelect`.
  - `RasiCross_Telemetry.html`: `id="driverModalList"`, `.driver-change-list{`; **kein** `id="driverModalSelect"`.

- [ ] **Step 3: Plan-Doc committen**

```bash
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" add docs/superpowers/plans/2026-06-25-35-combined-driver-dialog.md
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" commit -m "docs(plan): Phase 35 combined multi-kart driver dialog implementation plan

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Manuelle Akzeptanz (an Nutzer — Hardware/zwei Karts)

1. **Mehrzeiliger Dialog:** „Fahrer wechseln" zeigt eine Zeile je Teilnehmer-Kart (Farbe/Name + Fahrer-Dropdown, vorbelegt mit aktuellem Fahrer).
2. **Selektives Wechseln:** Zwei Karts ändern, einen lassen → nur die zwei bekommen einen neuen Stint; Toast „2 Fahrer gewechselt".
3. **Keine Änderung:** Confirm ohne Änderung → „Keine Änderung", keine neuen Stints.
4. **Single-Kart-Regression:** mit einem Kart eine Zeile; Wechsel wie vor Phase 35.
5. **Stint-Historie:** Renn-Details zeigen die neuen Stints korrekt je Kart.

## Self-Review

- **Spec-Coverage:** §3.1 `applyDriverChange` → Task 1. §3.2 HTML-Container → Task 2 Step 1–2. §3.3 `openDriverChange`/`confirmDriverChange`/`driverOptionsHtml` → Task 2 Step 3–4; `renderDriverOptions`-Cleanup → Task 2 Step 5. §5 Tests → Task 1 (4 neue). §6 Dateien → File-Structure-Tabelle. §4 Randfälle: Single-Teilnehmer (eine Zeile), keine Änderung (Task 2 `changed`-Zähler + „Keine Änderung"), Rennen nicht laufend (Guard in `openDriverChange`), mehrere gleichzeitig (Schleife), Default-Bucket („Kart"-Fallback), keine Fahrer (`driverOptionsHtml` „Keine Fahrer").
- **Placeholder-Scan:** Jeder Code-Schritt zeigt vollständigen Code; keine TBD/TODO.
- **Typ-/Namens-Konsistenz:** `applyDriverChange(part, newDriverId, now)` → Stint (Task 1 def; Task 2 `RasiLapEngine.applyDriverChange(p, newId, now)` + `stint.id = uid()`). `driverOptionsHtml(selectedId)` (Task 2 def + Nutzung in `openDriverChange`). `#driverModalList`/`.dc-sel`/`data-mac` (Task 2 HTML def + races.js-Nutzung). `participantsOf`/`r.participants` (Phase 30). Entfernte Symbole `#driverModalSelect`/`sel2`/`activePart`-Nutzung im Confirm konsistent ersetzt.

## Phase Map

- **Phase 30:** Per-Kart-Stints + „pro Kart einzeln"-Fahrerwechsel.
- **Phase 31–34:** Leaderboard, Polish, Live-Overlay, Map-Marker-Polish.
- **Phase 35 (dieser Plan):** Kombinierter Multi-Kart-Fahrerdialog.
- **Phasen 36+ (deferred):** momentaner Streckenabstand-Gap, synchrones Replay.
