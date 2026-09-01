# Phase 59 — Multikart-Bugfixes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Vier verifizierte Multikart-Bugs beheben: Dialog hinter dem ⚙-Fenster, gestapelte settings-rows in Standardgröße, default-Geisterkarte auf der Verbindungsseite, NVS-Resurrektion toter Karts.

**Architecture:** Punktuelle Fixes ohne Strukturänderung: Dialog-Funktionen bekommen ein Ziel-Dokument, das ⚙-Fenster wird breiter, `processTelemetry` filtert Bridge-Meta-Typen, und eine pure Adoptions-Regel (`shouldAdoptBridgeKart`, TDD) entscheidet über Karts aus `bridge_status.karts[]`; Forget/Reset-Kommandos bekommen eine Session-Pending-Queue.

**Tech Stack:** Vanilla-ESM (Electron-Renderer), node:test.

**Spec:** `docs/superpowers/specs/2026-09-01-59-multikart-fixes-design.md`

## Global Constraints

- Branch `feat/phase-59-multikart-fixes` (stacked auf `feat/phase-58-display-entfernen`/PR #93). CRLF-Regeln, Grep-Tool, Commit-Trailer, kein `.claude/`/`graphify-out/` — wie Phase 58.
- Statischer `#rcAlertOverlay`-Pfad im Hauptfenster bleibt byte-identisch (Screenshot-Baselines).
- Baselines Stand Phase 58: JS 222, Py 64, eslint 0, CSS-Gate OK — nach Phase 59: JS 222+N (neue Adopt-Tests).

## File Structure

| Action | Path | Responsibility |
|---|---|---|
| Modify | `src/kart-roster.js` | pure `shouldAdoptBridgeKart({known, age})` |
| Modify | `test/kart-roster.test.js` | Tests für die Adoptions-Regel |
| Modify | `src/telemetry.js` | Early-Return bridge_error/info/hello; Adopt-Regel im karts[]-Loop; Pending-Flush-Aufruf |
| Modify | `src/rasicross.js` | `rcAlert`/`rcConfirm` mit optionalem Ziel-`doc` (dynamisches Overlay im Kind-DOM) |
| Modify | `src/kart-settings-window.js` | `window.focus()`-Workarounds raus, `r.doc` an Dialoge; width 460→520 |
| Modify | `src/karts-page.js` | Pending-Queue für `forget_kart_mac`/`reset_karts` + `flushPendingBridge()` |
| Modify | Spec/Plan-Doku | Abschlusstask |

Task-Reihenfolge: 1 → 2 → 3 → 4 → 5 (sequenziell).

### Task 1: Adoptions-Regel (TDD)

- [ ] **Step 1 (Test zuerst):** In `test/kart-roster.test.js` hinter den `needsEquipDialog`-Tests:
```js
test('shouldAdoptBridgeKart: bekannt ODER frisch aktiv, sonst NVS-Altlast', () => {
  assert.equal(shouldAdoptBridgeKart({ known: true, age: 99999 }), true);
  assert.equal(shouldAdoptBridgeKart({ known: false, age: 1200 }), true);
  assert.equal(shouldAdoptBridgeKart({ known: false, age: 99999 }), false);
  assert.equal(shouldAdoptBridgeKart({ known: false, age: null }), false);
  assert.equal(shouldAdoptBridgeKart({ known: false, age: 60000 }), false);
  assert.equal(shouldAdoptBridgeKart(null), false);
});
```
Import oben ergänzen (`shouldAdoptBridgeKart` aus dem Default-Objekt destrukturieren). Lauf: `npm test` → FAIL (nicht definiert).
- [ ] **Step 2 (Implementierung):** In `src/kart-roster.js` vor dem Export:
```js
  // Phase 59: Karts aus bridge_status.karts[] nur uebernehmen, wenn die MAC
  // schon bekannt ist (Registry/Roster) oder laut age kuerzlich gefunkt hat.
  // Die Bridge meldet 99999 fuer "nie seit Boot" — reine NVS-Altlasten
  // erzeugen sonst bei jedem Connect Geister-Eintraege in der App.
  var ADOPT_MAX_AGE_MS = 60000;
  function shouldAdoptBridgeKart(info) {
    if (!info) return false;
    if (info.known) return true;
    return typeof info.age === 'number' && info.age < ADOPT_MAX_AGE_MS;
  }
```
Export-Objekt um `shouldAdoptBridgeKart` ergänzen. `npm test` → PASS.
- [ ] **Step 3:** Commit `fix(kart): Adoptions-Regel fuer bridge_status-Karts (Phase 59)`.

### Task 2: telemetry.js — Geisterkarte + Adopt-Wiring

- [ ] **Step 1:** Early-Return direkt nach dem `config_ack`-Return in `processTelemetry`:
```js
    // Phase 59: Bridge-Meta-Zeilen ohne from_mac duerfen keinem Kart
    // (insb. nicht dem default-Bucket) zugebucht werden — sonst erscheint
    // eine Geisterkarte auf der Verbindungsseite.
    if (d.type === 'bridge_error' || d.type === 'bridge_info' || d.type === 'bridge_hello') return;
```
- [ ] **Step 2:** Im `bridge_status`-Loop (`for (const ks of d.karts)`) vor `kartFor(ks.mac)`:
```js
          const _known = state.karts.has(ks.mac)
            || kartRosterMacs().indexOf(ks.mac) >= 0;
          if (!RasiKartRoster.shouldAdoptBridgeKart({ known: _known, age: ks.age })) continue;
```
Imports prüfen/ergänzen (`kartRosterMacs`, `RasiKartRoster` — vorhandene Importquellen von telemetry.js nutzen; falls `kartRosterMacs` dort nicht importierbar ist ohne Zyklus, Roster-Known über `state`-Zugriff analog bestehender Muster lösen und im Plan-Selbstreview dokumentieren).
- [ ] **Step 3:** `npm run lint`, `npm test`; Commit `fix(conn): keine Geisterkarte durch bridge_error/info, NVS-Altlasten nicht adoptieren (Phase 59)`.

### Task 3: Dialoge im Kindfenster

- [ ] **Step 1:** In `src/rasicross.js` vor `rcAlert` einen dynamischen Overlay-Builder ergänzen und beide Funktionen um den optionalen letzten Parameter `doc` erweitern. Verhalten: `!doc || doc === document` → bisheriger statischer Pfad (unverändert); sonst dynamisches Overlay im `doc`:
```js
function _dialogIn(doc, title, msg, buttons) {
  // Phase 59: Dialoge im aufrufenden Fenster rendern — das statische
  // #rcAlertOverlay existiert nur im Hauptfenster, und window.focus()
  // darf ein Kindfenster unter Electron nicht zuverlaessig ueberdecken.
  return new Promise(resolve => {
    const ov = doc.createElement('div');
    ov.className = 'overlay show';
    const dlg = doc.createElement('div');
    dlg.className = 'dialog';
    const h = doc.createElement('h3'); h.textContent = title;
    const p = doc.createElement('p'); p.textContent = msg;
    const row = doc.createElement('div'); row.className = 'dialog-btns';
    for (const b of buttons) {
      const btn = doc.createElement('button');
      btn.className = b.cls; btn.textContent = b.label;
      btn.onclick = () => { ov.remove(); resolve(b.value); };
      row.appendChild(btn);
    }
    dlg.appendChild(h); dlg.appendChild(p); dlg.appendChild(row);
    ov.appendChild(dlg);
    doc.body.appendChild(ov);
    const last = row.lastChild;
    setTimeout(() => { try { last.focus(); } catch (e) {} }, 50);
  });
}
```
`rcAlert(msg, title = 'Hinweis', doc = null)` → bei fremdem `doc`: `return _dialogIn(doc, title, msg, [{ cls: 'btn primary', label: 'OK', value: undefined }]);`
`rcConfirm(msg, title = 'Bestätigung', confirmLabel = 'OK', danger = false, doc = null)` → bei fremdem `doc`: `return _dialogIn(doc, title, msg, [{ cls: 'btn ghost', label: 'Abbrechen', value: false }, { cls: 'btn ' + (danger ? 'danger' : 'primary'), label: confirmLabel, value: true }]);`
- [ ] **Step 2:** In `src/kart-settings-window.js` alle vier Stellen umbauen — `window.focus();`-Zeile (inkl. Kommentar) löschen und `r.doc` übergeben:
  - Wartung: `rcConfirm('Wartungszähler…', 'Wartung', 'Zurücksetzen', false, r.doc)`
  - Kalibrierung: `…, 'Kalibrierung', 'Zurücksetzen', true, r.doc`
  - Statistik: `…, 'Statistik', 'Zurücksetzen', true, r.doc`
  - Kart vergessen: `…, 'Kart vergessen', 'Vergessen', true, r.doc`
- [ ] **Step 3:** `npm run lint`, `npm test`; Commit `fix(ui): Bestaetigungsdialoge rendern im Kart-Einstellungsfenster selbst (Phase 59)`.

### Task 4: Fensterbreite

- [ ] **Step 1:** `src/kart-settings-window.js`: `window.open('', '_blank', 'width=460,height=720')` → `width=520` (Kommentar: Viewport muss inkl. Rahmen+Scrollbar ueber dem 440-px-Stapel-Breakpoint bleiben).
- [ ] **Step 2:** Commit `fix(ui): Kart-Einstellungsfenster breiter — Stapel-Breakpoint greift nicht mehr in Standardgroesse (Phase 59)`.

### Task 5: Pending-Queue + Gesamtverifikation + Doku

- [ ] **Step 1:** `src/karts-page.js`: Modul-Queue + Sender-Helfer; `forgetKart`/`resetAllKarts` nutzen ihn statt des `if connected`-Blocks:
```js
// Phase 59: Bridge-Kommandos (forget/reset) duerfen nicht verloren gehen,
// wenn die Bridge gerade nicht steckt — Session-Queue, Flush beim naechsten
// bridge_status (Bridge nachweislich erreichbar). Die Adoptions-Regel
// (kart-roster) schuetzt die App-Sicht auch ohne zugestellten Forget.
const _pendingBridge = [];
function _sendBridgeOrQueue(obj) {
  if (state.serial && state.serial.connected && window.rasiSerial && window.rasiSerial.writeLine) {
    try { window.rasiSerial.writeLine(JSON.stringify(obj)); return; } catch (e) {}
  }
  _pendingBridge.push(obj);
}
function flushPendingBridge() {
  if (!(state.serial && state.serial.connected && window.rasiSerial && window.rasiSerial.writeLine)) return;
  while (_pendingBridge.length) {
    const obj = _pendingBridge.shift();
    try { window.rasiSerial.writeLine(JSON.stringify(obj)); } catch (e) { _pendingBridge.unshift(obj); break; }
  }
}
```
Export `flushPendingBridge` ergänzen; Aufruf in `telemetry.js` im `bridge_status`-Zweig (`flushPendingBridge();` vor `RasiKartBar.render(state);`, Import analog `renderKartsTab`-Nutzung — Zyklusfreiheit prüfen).
- [ ] **Step 2:** Volle Verifikation: `npm test` (222+1), `npm run lint`, `npm run lint:css`, `python -m unittest discover -s test -p "test_*.py"` (64), lokale e2e `npx playwright test e2e/demo.spec.js e2e/karts.spec.js`; `__pycache__` löschen.
- [ ] **Step 3:** Commit `fix(conn): forget/reset-Kommandos ueberleben Offline-Phasen (Pending-Queue, Phase 59)`; Abschluss-Commit Doku (Spec + Plan).

## Hardware/Manual Acceptance Checklist (User, deferred)

- [ ] ⚙-Fenster: „Kart vergessen"/Resets zeigen den Dialog IM Fenster.
- [ ] ⚙-Fenster Standardgröße: Label und Eingabefeld nebeneinander.
- [ ] Verbindungsseite: nur echte Karts, keine Geisterkarte (alte Sender-Firmware provozieren, z.B. vor dem Neuflash testen).
- [ ] Kart vergessen ohne USB → verbinden → Kart bleibt verschwunden.

## Self-Review

- [ ] Spec-Coverage: 4 Locked Decisions → Tasks 3/4/2/1+5. ✓
- [ ] Kein Placeholder; Import-Zyklen-Punkte (Task 2/5) sind als Prüfschritte markiert, nicht offen.
- [ ] Statischer Hauptfenster-Dialogpfad unangetastet (Baselines).

## Phase Map

- Phase 58 (Basis, PR #93) → **Phase 59 (dieser Plan)** → PR stacked auf #93; Merge-Reihenfolge 93 → 59.
