# Phase 3 — A5: Content-Security-Policy + De-inline All Event Handlers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a restrictive `<meta>` Content-Security-Policy to the dashboard and remove every inline `onclick` so the app runs with **zero CSP violations** and identical behaviour.

**Architecture:** Two classes of inline handlers exist: **7 static** `onclick="window.x()"` on fixed modal buttons in `RasiCross_Telemetry.html`, and **9 dynamic** `onclick` emitted inside `innerHTML` template strings in `rasicross.js` (saved-tracks, drivers, races lists). `script-src 'self'` blocks *both*. The 7 static buttons get stable `id`s + `addEventListener` in `init()`. The 9 dynamic ones are replaced by `data-action`/`data-id` attributes plus **one delegated click listener per list container** (`closest('[data-action]')` — the innermost match wins, which naturally reproduces the existing `event.stopPropagation()` race-card behaviour). The now-dead `window.*` export block is deleted. Only after *all* inline handlers are gone is the CSP meta added.

**Tech Stack:** Vanilla DOM (`addEventListener`, event delegation, `dataset`), HTML `<meta http-equiv>` CSP. Node ≥18 `node --check` + `node:test` (regression only — no new test blocks). No new deps.

---

## Working Directory & Conventions

**All work happens in the git clone:** `C:/Users/jimlu/Documents/RasiCross-Telemetrie-git` (branch `docs/telemetry-improvements-spec`, Phases 1–2 already committed/pushed).

- Paths relative to the clone root unless absolute. Files use **CRLF**; always `Read` the target file in-session immediately before an `Edit` and copy the `old_string` anchor from that fresh Read (line numbers below are indicative — anchor on the text, not the number).
- Git: `git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" …`.
- Windows: Node v24 local; CI Node 20. No Python changes in this phase.
- **Spec:** `docs/superpowers/specs/2026-05-17-rasicross-telemetry-improvements-design.md` §5 A5, §7. **Carried-forward correction** (Phase-1 plan Self-Review item 4): the spec CSP omits the Google Fonts + icon origins — this plan uses the corrected CSP (decision below).
- **Decisions locked with the user (2026-05-18):** (1) **Full CSP-correct scope** — de-inline *all 16* handlers (7 static + 9 dynamic), not just the spec's literal 7. (2) **Allow Google font origins** in CSP (no self-hosting; zero behaviour/asset change).

**Behavioural invariant:** Every button does exactly what it did before. The race-card "click card = select race, click inner button = button action only" behaviour is preserved (delegation `closest` returns the innermost `[data-action]`, so a button click never also selects the card — same as the old `event.stopPropagation()`). No feature added or removed. `disabled` "Aktivieren" buttons stay inert (browsers don't dispatch `click` on disabled buttons).

**Why CSP only after all handlers are gone:** the CSP (`script-src 'self'`) is what *blocks* inline handlers. Adding it before de-inlining would break the app between commits. Order is mandatory: T1 static → T2 dynamic → T3 CSP+cleanup.

---

## File Structure

| Action | Path | Responsibility |
|--------|------|----------------|
| Modify | `RasiCross_Telemetry.html` | Add `id`s to 7 static buttons + remove their `onclick`; add CSP `<meta>` in `<head>`. |
| Modify | `rasicross.js` | Wire 7 static buttons via `addEventListener` in `init()`; replace 9 dynamic `onclick` with `data-action`/`data-id`; add `ACTION_MAP` + delegated `handleActionClick` on the 3 list containers; delete the dead `window.*` export block. |

**Containers for delegation (verified to exist as stable static elements):** `#savedTracksList` (HTML ~2427), `#raceList` (HTML ~2481), `#driverStatsList` (HTML ~2511). `renderRaceDetails` emits no handlers (safe).

**Task order (each commit independently sound — app fully works after each):** T1 static de-inline → T2 dynamic de-inline (delegation) → T3 remove dead exports + add CSP → T4 phase verify/commit/push.

---

### Task 1: De-inline the 7 static modal handlers

**Files:**
- Modify: `RasiCross_Telemetry.html` (add `id`s, remove `onclick` on 7 buttons)
- Modify: `rasicross.js` (`init()` — add 7 `addEventListener` calls)

Context: 7 fixed buttons in the Track-Editor dialog (3× "Auf Karte klicken", Abbrechen, Speichern) and Driver-Change modal (Abbrechen, Wechseln). `window.closeEditor` maps to the function `closeTrackEditor`; the other names are functions of the same name. The `window.*` export block stays in place this task (the 9 dynamic handlers still need it until Task 2) — do **not** add the CSP yet.

- [ ] **Step 1: Read** `RasiCross_Telemetry.html` lines ~2796–2842 to anchor the 7 button edits exactly (copy CRLF-safe anchors from the Read).

- [ ] **Step 2: Add `id`s and remove `onclick` — Track-Editor "Auf Karte klicken" buttons**

Edit `RasiCross_Telemetry.html` — replace exactly:

```
          <button class="btn ghost" onclick="window.editorClickTarget('start')">Auf Karte klicken</button>
```

with:

```
          <button class="btn ghost" id="edPickStart">Auf Karte klicken</button>
```

Replace exactly:

```
          <button class="btn ghost" onclick="window.editorClickTarget('s2')">Auf Karte klicken</button>
```

with:

```
          <button class="btn ghost" id="edPickS2">Auf Karte klicken</button>
```

Replace exactly:

```
          <button class="btn ghost" onclick="window.editorClickTarget('s3')">Auf Karte klicken</button>
```

with:

```
          <button class="btn ghost" id="edPickS3">Auf Karte klicken</button>
```

- [ ] **Step 3: Add `id`s and remove `onclick` — Track-Editor dialog buttons**

Edit `RasiCross_Telemetry.html` — replace exactly:

```
      <button class="btn ghost" onclick="window.closeEditor()">Abbrechen</button>
      <button class="btn primary" onclick="window.saveEditor()">Speichern</button>
```

with:

```
      <button class="btn ghost" id="edCancelBtn">Abbrechen</button>
      <button class="btn primary" id="edSaveBtn">Speichern</button>
```

- [ ] **Step 4: Add `id`s and remove `onclick` — Driver-Change modal buttons**

Edit `RasiCross_Telemetry.html` — replace exactly:

```
      <button class="btn ghost" onclick="window.closeDriverModal()">Abbrechen</button>
      <button class="btn primary" onclick="window.confirmDriverChange()">Wechseln</button>
```

with:

```
      <button class="btn ghost" id="dmCancelBtn">Abbrechen</button>
      <button class="btn primary" id="dmConfirmBtn">Wechseln</button>
```

- [ ] **Step 5: Read** `rasicross.js` around the `window.*` export block (the comment `// Window exports for inline onclick handlers` through `window.deleteRace = deleteRace;`, then the closing `}` of `init()` and the `init();` call ~lines 3013–3030). Copy the anchor from the Read.

- [ ] **Step 6: Wire the 7 static buttons in `init()`**

Edit `rasicross.js` — replace exactly:

```
  // Window exports for inline onclick handlers
  window.loadSavedTrack = loadSavedTrack;
```

with:

```
  // Statische Modal-Buttons CSP-konform verdrahten (kein inline onclick)
  const _bind = (elId, fn) => { const el = $(elId); if (el) el.addEventListener('click', fn); };
  _bind('edPickStart', () => editorClickTarget('start'));
  _bind('edPickS2',    () => editorClickTarget('s2'));
  _bind('edPickS3',    () => editorClickTarget('s3'));
  _bind('edCancelBtn', closeTrackEditor);
  _bind('edSaveBtn',   saveEditor);
  _bind('dmCancelBtn', closeDriverModal);
  _bind('dmConfirmBtn', confirmDriverChange);
  // Window exports for inline onclick handlers
  window.loadSavedTrack = loadSavedTrack;
```

- [ ] **Step 7: Verify (syntax + regression + static)**

Run: `node --check rasicross.js` → expected exit 0.
Run: `node --test` (no path) → expected `tests 10` … `pass 10` … `fail 0` (geo.js suite unaffected — proves no JS breakage; no test blocks added).
Run (Grep tool) on `RasiCross_Telemetry.html` for `onclick=` → expected **0 matches** (all 7 static handlers removed).
Run (Grep tool) on `rasicross.js` for `_bind\('` → expected 7 matches; for `id="edPickStart"|id="edSaveBtn"|id="dmConfirmBtn"` on `RasiCross_Telemetry.html` → expected the 3 ids present.
Confirm `git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" status --short` shows only `RasiCross_Telemetry.html` and `rasicross.js` modified (plus pre-existing untracked `.claude/` and this plan doc).

- [ ] **Step 8: Commit**

```bash
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" add RasiCross_Telemetry.html rasicross.js
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" commit -m "refactor(dashboard): de-inline 7 static modal handlers (CSP prep)

Stable ids + addEventListener in init() replace onclick=\"window.x()\" on
the Track-Editor and Driver-Change modal buttons. Behaviour identical.
Dynamic list handlers + CSP follow in the next commits.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 2: De-inline the 9 dynamic list handlers via event delegation

**Files:**
- Modify: `rasicross.js` (markup in `renderSavedTracks`/`renderDrivers`/`renderRaces`; add `ACTION_MAP` + `handleActionClick`; attach delegated listeners in `init()`)

Context: 9 `onclick` strings emitted inside `innerHTML`: saved-tracks list (`loadSavedTrack`/`openTrackEditor`/`deleteSavedTrack`, arg `t.id`), drivers list (`deleteDriver`, arg `d.id`), races list (the `.race-card` itself = `selectRace` arg `r.id`; inner buttons `setActiveRace`/`endRace(false)`/`toggleRaceExpand`/`deleteRace` with `event.stopPropagation()`). Replace each with `data-action="<fn>"` + (where an id is passed) `data-id="<id>"`. One delegated `click` listener per container dispatches via `closest('[data-action]')`; the innermost `[data-action]` wins, so clicking an inner race button runs only that action (never also `selectRace`) — exactly the old `stopPropagation` semantics. `endRace` takes literal `false` and no id.

- [ ] **Step 1: Read** `rasicross.js` lines ~784–795 (`renderSavedTracks` `.map`), ~1490–1499 (`renderDrivers` delete button), ~1762–1785 (`renderRaces` card + actions). Copy anchors from the Read.

- [ ] **Step 2: Saved-tracks list — replace the 3 button lines**

Edit `rasicross.js` — replace exactly:

```
      <button class="btn primary" onclick="window.loadSavedTrack('${t.id}')">Laden</button>
      <button class="btn ghost" onclick="window.openTrackEditor('${t.id}')">✎</button>
      <button class="btn danger" onclick="window.deleteSavedTrack('${t.id}')">✕</button>
```

with:

```
      <button class="btn primary" data-action="loadSavedTrack" data-id="${t.id}">Laden</button>
      <button class="btn ghost" data-action="openTrackEditor" data-id="${t.id}">✎</button>
      <button class="btn danger" data-action="deleteSavedTrack" data-id="${t.id}">✕</button>
```

- [ ] **Step 3: Drivers list — replace the delete button**

Edit `rasicross.js` — replace exactly:

```
        <button class="btn danger" onclick="window.deleteDriver('${d.id}')" title="Fahrer löschen">✕</button>
```

with:

```
        <button class="btn danger" data-action="deleteDriver" data-id="${d.id}" title="Fahrer löschen">✕</button>
```

- [ ] **Step 4: Races list — replace the card `onclick` and the 4 action buttons**

Edit `rasicross.js` — replace exactly:

```
      <div class="race-card ${isSelected ? 'selected' : ''} ${isExpanded ? 'expanded' : ''}" onclick="window.selectRace('${r.id}')">
```

with:

```
      <div class="race-card ${isSelected ? 'selected' : ''} ${isExpanded ? 'expanded' : ''}" data-action="selectRace" data-id="${r.id}">
```

Replace exactly:

```
          ${!isActive ? `<button class="btn primary" onclick="event.stopPropagation();window.setActiveRace('${r.id}')" ${anotherRunning ? 'disabled title="Anderes Rennen läuft noch"' : ''}>Aktivieren</button>` : ''}
          ${(r.status === 'running' || r.status === 'paused') && isActive ? `<button class="btn danger" onclick="event.stopPropagation();window.endRace(false)">Beenden</button>` : ''}
          <button class="btn ghost expand-btn" onclick="event.stopPropagation();window.toggleRaceExpand('${r.id}')">
            ${isExpanded ? '▲ Weniger' : '▼ Details'}
          </button>
          <button class="btn ghost" onclick="event.stopPropagation();window.deleteRace('${r.id}')" title="Rennen löschen">✕</button>
```

with:

```
          ${!isActive ? `<button class="btn primary" data-action="setActiveRace" data-id="${r.id}" ${anotherRunning ? 'disabled title="Anderes Rennen läuft noch"' : ''}>Aktivieren</button>` : ''}
          ${(r.status === 'running' || r.status === 'paused') && isActive ? `<button class="btn danger" data-action="endRace">Beenden</button>` : ''}
          <button class="btn ghost expand-btn" data-action="toggleRaceExpand" data-id="${r.id}">
            ${isExpanded ? '▲ Weniger' : '▼ Details'}
          </button>
          <button class="btn ghost" data-action="deleteRace" data-id="${r.id}" title="Rennen löschen">✕</button>
```

- [ ] **Step 5: Read** `rasicross.js` at the `_bind('dmConfirmBtn', confirmDriverChange);` line added in Task 1 (just before the `// Window exports` comment). Copy the anchor from the Read.

- [ ] **Step 6: Add the delegated dispatcher and attach it in `init()`**

Edit `rasicross.js` — replace exactly:

```
  _bind('dmConfirmBtn', confirmDriverChange);
  // Window exports for inline onclick handlers
```

with:

```
  _bind('dmConfirmBtn', confirmDriverChange);
  // Dynamische Listen-Buttons per Event-Delegation (CSP-konform):
  // innerstes [data-action] gewinnt -> Klick auf einen Karten-Button
  // loest NUR dessen Aktion aus, nie zusaetzlich selectRace (ersetzt
  // das fruehere event.stopPropagation()).
  const ACTION_MAP = {
    loadSavedTrack:   id => loadSavedTrack(id),
    openTrackEditor:  id => openTrackEditor(id),
    deleteSavedTrack: id => deleteSavedTrack(id),
    deleteDriver:     id => deleteDriver(id),
    selectRace:       id => selectRace(id),
    setActiveRace:    id => setActiveRace(id),
    endRace:          () => endRace(false),
    toggleRaceExpand: id => toggleRaceExpand(id),
    deleteRace:       id => deleteRace(id),
  };
  const handleActionClick = (e) => {
    const el = e.target.closest('[data-action]');
    if (!el) return;
    const fn = ACTION_MAP[el.dataset.action];
    if (fn) fn(el.dataset.id);
  };
  ['savedTracksList', 'driverStatsList', 'raceList'].forEach((cid) => {
    const c = $(cid);
    if (c) c.addEventListener('click', handleActionClick);
  });
  // Window exports for inline onclick handlers
```

- [ ] **Step 7: Verify (syntax + regression + static)**

Run: `node --check rasicross.js` → exit 0.
Run: `node --test` (no path) → `tests 10` … `pass 10` … `fail 0`.
Run (Grep tool) on `rasicross.js` for `onclick=` → expected **0 matches** (all 9 dynamic handlers removed).
Run (Grep tool) on `rasicross.js` for `data-action="` → expected ≥ 9 matches; for `ACTION_MAP` → expected ≥ 2; for `handleActionClick` → expected 2; for `stopPropagation` → expected 0.
Confirm git status shows only `rasicross.js` modified.

- [ ] **Step 8: Commit**

```bash
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" add rasicross.js
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" commit -m "refactor(dashboard): de-inline 9 dynamic list handlers via delegation

data-action/data-id + one delegated click listener per list container
(savedTracksList/driverStatsList/raceList). closest('[data-action]')
returns the innermost match, preserving the old race-card
stopPropagation behaviour. Behaviour identical.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 3: Remove the dead `window.*` export block + add the CSP meta

**Files:**
- Modify: `rasicross.js` (delete the now-unused `window.*` export block)
- Modify: `RasiCross_Telemetry.html` (add CSP `<meta>` in `<head>`)

Context: after T1+T2 no inline handler references `window.*` — the whole export block is dead. Removing it is the cleanest way to *prove* nothing relies on global exports. Then add the corrected CSP (allow Google font origins per the locked decision; keep `'unsafe-inline'` for **style only** — de-inlining CSS is explicitly out of scope per spec §5 A5).

- [ ] **Step 1: Read** `rasicross.js` from the `// Window exports for inline onclick handlers` comment through `window.deleteRace = deleteRace;` and the following `}` (end of `init()`). Copy the exact block from the Read.

- [ ] **Step 2: Delete the dead `window.*` export block**

Edit `rasicross.js` — replace exactly:

```
  // Window exports for inline onclick handlers
  window.loadSavedTrack = loadSavedTrack;
  window.deleteSavedTrack = deleteSavedTrack;
  window.openTrackEditor = openTrackEditor;
  window.closeEditor = closeTrackEditor;
  window.saveEditor = saveEditor;
  window.editorClickTarget = editorClickTarget;
  window.deleteDriver = deleteDriver;
  window.selectRace = selectRace;
  window.setActiveRace = setActiveRace;
  window.endRace = endRace;
  window.closeDriverModal = closeDriverModal;
  window.confirmDriverChange = confirmDriverChange;
  window.toggleRaceExpand = toggleRaceExpand;
  window.deleteRace = deleteRace;
}
```

with:

```
}
```

> If the fresh Read shows the block bracketed by extra blank lines or a trailing comment, include exactly what the Read shows in `old_string` and keep the single closing `}` (the end of `init()`); do not alter the `init();` call on the next line.

- [ ] **Step 3: Read** `RasiCross_Telemetry.html` lines 1–12 to anchor the CSP insertion (the `<meta charset="UTF-8">` line).

- [ ] **Step 4: Add the corrected CSP `<meta>` as the first directive after charset**

Edit `RasiCross_Telemetry.html` — replace exactly:

```
<meta charset="UTF-8">
```

with:

```
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'">
```

Rationale per directive (every resource the page loads is covered): `script-src 'self'` → `geo.js`, `rasicross.js` (same-origin; no inline scripts; no inline handlers after T1/T2). `style-src 'self' 'unsafe-inline' https://fonts.googleapis.com` → the Google Fonts stylesheet (line ~11) + the in-page `<style>` block + pervasive `style=` attrs (de-inlining CSS is out of scope). `font-src https://fonts.gstatic.com` → DM Sans / JetBrains Mono woff2. `img-src 'self' data:` → `assets/icon.svg` (icon + apple-touch-icon) and any `data:` images. `connect-src 'none'` → safe: no `fetch`/XHR/WebSocket; `navigator.serial` is **not** governed by `connect-src`; `<link rel=preconnect>` is a resource hint, not blocked. `object-src/base-uri/form-action 'none'` → hardening. `default-src 'none'` → deny-by-default for anything unlisted.

- [ ] **Step 5: Verify (syntax + regression + exhaustive static CSP audit)**

Run: `node --check rasicross.js` → exit 0.
Run: `node --test` (no path) → `tests 10` … `pass 10` … `fail 0`.
Run (Grep tool) on `rasicross.js` for `window\.(loadSavedTrack|deleteSavedTrack|openTrackEditor|closeEditor|saveEditor|editorClickTarget|deleteDriver|selectRace|setActiveRace|endRace|closeDriverModal|confirmDriverChange|toggleRaceExpand|deleteRace)` → expected **0 matches** (export block fully removed; nothing else depended on it).
Run (Grep tool) on `RasiCross_Telemetry.html` AND `rasicross.js` for the inline-handler attribute pattern `on(click|change|input|submit|load|mouse[a-z]+|key[a-z]+|focus|blur|dblclick|contextmenu)=` → expected **0 matches in each** (no inline event handler of any kind remains).
Run (Grep tool) on `RasiCross_Telemetry.html` AND `rasicross.js` for `javascript:` → expected **0 matches** (no `javascript:` URLs that `script-src` would block).
Run (Grep tool) on `RasiCross_Telemetry.html` for `<script` → expected exactly 2 (`geo.js`, `rasicross.js`, both `src=` same-origin; no inline script).
Run (Grep tool) on `RasiCross_Telemetry.html` for `Content-Security-Policy` → expected 1; and `https://fonts.googleapis.com` present in `style-src`, `https://fonts.gstatic.com` in `font-src`.
Confirm git status shows only `RasiCross_Telemetry.html` and `rasicross.js` modified.

- [ ] **Step 6: Commit**

```bash
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" add RasiCross_Telemetry.html rasicross.js
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" commit -m "feat(dashboard): add Content-Security-Policy; drop dead window exports

script-src 'self' (no inline scripts/handlers remain), style-src keeps
'unsafe-inline' for the in-page CSS only plus the Google Fonts origin,
font-src gstatic, img-src 'self' data:, everything else locked down.
The window.* export block is now unreferenced and removed.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 4: Phase verification, plan commit & push

**Files:** none (verification + push); commits the Phase 3 plan doc.

- [ ] **Step 1: Full local CI dry-run** (from clone root):
```
node --check geo.js
node --check rasicross.js
node --check main.js
node --check preload.js
npm test
python -m py_compile sender.py bridge.py esp_libs/micropyGPS.py esp_libs/mpu6050.py esp_libs/oled_diagnose.py esp_libs/ssd1306.py esp_libs/calc.py
python -m unittest discover -s test -p "test_*.py" -v
```
(If `python` is missing, use `py -3 …`.) Expected: all exit 0; `npm test` = `tests 10 | pass 10 | fail 0`; unittest `Ran 6 tests` `OK`. Then delete any `__pycache__`; confirm `git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" status --short` shows no pyc/pycache (only the untracked plan doc until Step 3, plus the pre-existing untracked `.claude/`).

- [ ] **Step 2: Behaviour-invariant + CSP completeness spot-check**
- Grep `rasicross.js`: `data-action="` count == number of distinct action sites (≥ 9: 3 saved-track + 1 driver + 1 card + 4 race-action; the race "endRace" has no `data-id`). Confirm `ACTION_MAP` keys are exactly `{loadSavedTrack, openTrackEditor, deleteSavedTrack, deleteDriver, selectRace, setActiveRace, endRace, toggleRaceExpand, deleteRace}` and each maps to the identically-named function (DRY/type-consistency: `data-action` value === `ACTION_MAP` key === function name).
- Confirm `endRace` entry is `() => endRace(false)` (literal `false` preserved; no id used) and the "Beenden" button has `data-action="endRace"` with **no** `data-id`.
- Confirm the 7 `_bind(...)` ids (`edPickStart/edPickS2/edPickS3/edCancelBtn/edSaveBtn/dmCancelBtn/dmConfirmBtn`) each match exactly one `id="…"` in `RasiCross_Telemetry.html`.
- Re-confirm zero inline handlers / zero `window.*` exports / CSP present (the Task 3 Step 5 greps) on the final tree.

- [ ] **Step 3: Commit the plan document**
```bash
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" add docs/superpowers/plans/2026-05-18-03-csp-deinline-handlers.md
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" commit -m "docs: phase 3 implementation plan (CSP + de-inline all handlers)

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

- [ ] **Step 4: Push**
```bash
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" push
```
Credentials cached this session — should be silent. If it hangs >30s on auth, report BLOCKED (do not loop).

- [ ] **Step 5: Deferred to user (do NOT attempt here — no GUI/Electron/browser runtime):** the spec §7 live acceptance — load the dashboard in **Electron** *and* a **Chromium browser**, open devtools console, confirm **zero CSP violations** and full functionality (checklist below). The in-plan static audit (Task 3 Step 5) is the exhaustive proxy; the live console check is the user sign-off gate. Note as pending in the report.

---

## CSP Acceptance Checklist (user-run — needs a GUI runtime, not testable here)

Open `RasiCross_Telemetry.html` in **(a) Electron** (the app) and **(b) a Chromium browser**; in each, open DevTools → Console and verify **no `Content-Security-Policy` / "Refused to …" messages**, then exercise:

1. **Fonts/icon:** UI renders in DM Sans / JetBrains Mono (online) and the tab/app icon shows — no `style-src`/`font-src`/`img-src` refusals. Offline (no internet) it falls back to system fonts with no CSP error (unchanged from before).
2. **Static modals:** Track-Editor → each "Auf Karte klicken" (start/S2/S3) arms map-pick; Abbrechen closes; Speichern saves. Driver-Change modal → Abbrechen / Wechseln work.
3. **Saved tracks list:** Laden / ✎ (edit) / ✕ (delete) each work on the right track.
4. **Drivers list:** ✕ deletes the right driver.
5. **Races list:** clicking a card selects it; "Aktivieren" / "Beenden" / "▼ Details▲" / "✕" act on that race only and do **not** also re-select via the card (stopPropagation behaviour preserved); a `disabled` "Aktivieren" does nothing.
6. **No regressions:** Demo mode + live telemetry still update; no console errors.

---

## Self-Review

**1. Spec coverage:**
- §5 A5 "give the 7 inline-handler buttons stable ids; remove onclick; wire addEventListener in init(); behaviour identical" → Task 1. ✅
- §5 A5 CSP `<meta>` in `<head>` → Task 3 Step 4, **corrected** per the Phase-1 carried-forward note (adds `https://fonts.googleapis.com` to style-src, `font-src https://fonts.gstatic.com`, `img-src 'self' data:`) and the locked user decision (allow Google origins, no self-host). ✅
- §5 A5 "'unsafe-inline' retained only for styles" → CSP has `'unsafe-inline'` solely in `style-src`; `script-src` is `'self'` only. ✅
- §5 A5 "zero CSP violations + fully functional" — the spec under-counts handlers (only static). Discovered 9 dynamic `innerHTML` `onclick` that `script-src 'self'` also blocks → Task 2 (delegation) closes the gap; without it the criterion is unmet. Locked with user as in-scope. ✅
- §7 "CSP verified in Electron + a Chromium browser" — no GUI runtime here; exhaustive static audit (Task 3 Step 5) + user checklist (deferred, like Phase 2's hardware gate). ✅
- Phase-2 Phase-Map item "Phase 3 = A5 with the corrected CSP that allows fonts.googleapis.com/style, fonts.gstatic.com/font, img-src 'self' data:" → exactly the CSP in Task 3 Step 4. ✅

**2. Placeholder scan:** No TBD/TODO; every code step has complete literal code; every command has an expected result. The one conditional note (Task 3 Step 2) instructs copying the exact fresh-Read anchor — not a placeholder, a CRLF-safety instruction. ✅

**3. Type/name consistency:** `data-action` values, `ACTION_MAP` keys, and the dispatched function names are the same 9 identifiers everywhere (`loadSavedTrack/openTrackEditor/deleteSavedTrack/deleteDriver/selectRace/setActiveRace/endRace/toggleRaceExpand/deleteRace`). `endRace` uniquely takes no id (`() => endRace(false)`) and its button uniquely omits `data-id`. The 7 static ids (`edPickStart/edPickS2/edPickS3/edCancelBtn/edSaveBtn/dmCancelBtn/dmConfirmBtn`) are introduced in Task 1 HTML and consumed by the matching `_bind(...)` calls in Task 1 JS. `closeEditor` correctly maps to the function `closeTrackEditor` (per the original `window.closeEditor = closeTrackEditor`). Container ids `savedTracksList/driverStatsList/raceList` match the verified static elements. `node --test` baseline stays **`tests 10 | pass 10`** (no JS test blocks added — DOM wiring isn't unit-tested in this project; regression-only, consistent with Phases 1–2). ✅

**4. Notes:** Order is load-bearing — CSP (which blocks inline handlers) is added **only** in Task 3, after T1+T2 remove every inline handler, so each commit yields a fully working app. Event delegation on the persistent container survives `innerHTML` re-renders (listener attached once in `init()`). `closest('[data-action]')` returning the innermost match is what makes the race-card "button vs card" split work without `stopPropagation`.

---

## Phase Map

Phase **3 of 6**. Done so far: Phase 1 (test/CI foundation, `geo.js`), Phase 2 (A1 RPM IRQ fix + A2 wheel-speed fallback, `calc.py`). Next: Phase 4 = A3 LiPo/Li-ion battery telemetry (extends `esp_libs/calc.py` + `test/test_calc.py`, `sender.py`, dashboard, kart OLED). Phase 5 = A4 IMU expansion (accel-Z + yaw rate + MPU temp; `mpu6050.py`, `sender.py`, dashboard). Phase 6 = C1 recording + in-app replay (largest JS feature; pure `replay.js` + tests).
