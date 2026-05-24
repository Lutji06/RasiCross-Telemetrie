# Pit-Wall Redesign — Live, Rennen & Fahrer Tabs — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring the Live, Rennen and Fahrer tabs onto the Strecken tab's `pw-*` "Pit Wall" design system (hero header + telemetry strip + modules), and move the Rennen/Fahrer create-forms into pop-up modals.

**Architecture:** HTML restructure of `#tab-races`, `#tab-drivers` and `#tab-live` in `RasiCross_Telemetry.html`, reusing the existing `pw-*` CSS classes; two new `.overlay`/`.dialog` modals; a handful of new CSS rules; small `rasicross.js` wiring for the modals and the Live hero. Every element ID that `rasicross.js` reads or writes is preserved.

**Tech Stack:** Vanilla HTML/CSS/JS — single-file dashboard (`RasiCross_Telemetry.html` + `rasicross.js`), no bundler. ESLint flat config (lint must stay clean). Strict CSP — handlers via `addEventListener`/`.onclick` only, never inline.

---

## Working Directory & Conventions

**Branch `feat/tab-redesign-pitwall`** in `C:/Users/jimlu/Documents/RasiCross-Telemetrie-git`. The design spec is committed (`8cd44c5`).

- **Spec:** `docs/superpowers/specs/2026-05-22-tab-redesign-pitwall-design.md`.
- **CRLF:** both files are CRLF. `Read` the target region in-session immediately before each `Edit`; anchor on the literal text (the `<!-- ... TAB: ... -->` comment markers are stable anchors). Line numbers are indicative.
- **No new tests** — HTML/CSS/DOM-wiring is not unit-tested in this project. The existing 36 JS + 34 Python tests must stay green.
- **Reference template:** the Strecken tab `#tab-track` (HTML ~2277-2478) is the live `pw-*` pattern. `pw-*` CSS is at HTML lines ~913-1270; `.overlay`/`.dialog` CSS at ~1719-1758; `#driverModal` (HTML ~2915-2924) is the modal markup template.
- **ID rule:** never rename or drop an element ID that `rasicross.js` touches. Where this plan moves an element, the ID moves with it.
- Verification recipe (clone root):
  ```
  node --check rasicross.js
  npm run lint
  npm test
  ```

---

## File Structure

| Action | Path | Responsibility |
|--------|------|----------------|
| Modify | `RasiCross_Telemetry.html` | Rewrite `#tab-races`, `#tab-drivers`, `#tab-live`; add `#newRaceModal` + `#newDriverModal`; add the new CSS rules. |
| Modify | `rasicross.js` | Wire the two modals (open/close), close-on-success in `createRace`/`addDriver`, populate the Live hero title. |

**Task order:** Task 1 Rennen → Task 2 Fahrer → Task 3 Live. Each task leaves the app fully working.

---

### Task 1: Rennen tab

**Files:** Modify `RasiCross_Telemetry.html` (`#tab-races` ~2483-2526; new modal inserted after `#driverModal` ~2924; new CSS in the `<style>` block), Modify `rasicross.js` (modal wiring; `createRace`).

- [ ] **Step 1: Add the shared new CSS**

In `RasiCross_Telemetry.html`, find the end of the `pw-*` block — the line `.pw-lib-empty-sub{font-size:12.5px;max-width:360px;line-height:1.55}` (~line 1270). Insert immediately **after** it:

```
/* Redesign: library header as a row (title left, action right) */
.pw-lib-head-row{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}
/* Redesign: create-forms hosted in a .dialog */
.dialog .field{margin-bottom:12px}
.dialog .field:last-of-type{margin-bottom:0}
```

- [ ] **Step 2: Replace the `#tab-races` section**

Replace the entire `<section class="tab" id="tab-races"> … </section>` block (between the `<!-- TAB: RENNEN -->` comment and the `<!-- TAB: FAHRER -->` comment) with:

```
<section class="tab" id="tab-races">

  <div class="pw-hero">
    <div class="pw-hero-bg"></div>
    <div class="pw-hero-grid"></div>
    <div class="pw-hero-content">
      <div class="pw-hero-left">
        <div class="pw-eyebrow">
          <span class="pw-eyebrow-dot"></span>
          <span>RENNVERWALTUNG</span>
        </div>
        <h1 class="pw-hero-title">Rennen<span class="pw-hero-accent">.</span></h1>
        <p class="pw-hero-sub">Anlegen · verwalten · auswählen</p>
      </div>
      <div class="pw-hero-telemetry">
        <div class="pw-tel">
          <div class="pw-tel-label">Aktives Rennen</div>
          <div class="pw-tel-value" id="raceHeroActive">--</div>
          <div class="pw-tel-foot">aktuell geladen</div>
        </div>
        <div class="pw-tel">
          <div class="pw-tel-label">Status</div>
          <div class="pw-tel-value" id="raceHeroStatus">Bereit</div>
        </div>
        <div class="pw-tel">
          <div class="pw-tel-label">Rennen gesamt</div>
          <div class="pw-tel-value mono" id="raceListCount">0</div>
          <div class="pw-tel-foot">in der Bibliothek</div>
        </div>
      </div>
    </div>
  </div>

  <div class="pw-library">
    <div class="pw-lib-head pw-lib-head-row">
      <div class="pw-lib-title">
        <span class="pw-lib-bar"></span>
        <span>Bibliothek</span>
      </div>
      <button class="pw-btn primary" id="openNewRaceBtn">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>
        <span>Neues Rennen</span>
      </button>
    </div>
    <div class="race-list" id="raceList"><div class="muted">Noch keine Rennen.</div></div>
    <div id="racesList" style="display:none"></div>
    <span id="raceCount" style="display:none"></span>
  </div>

</section>
```

Notes: `#raceList`, `#racesList`, `#raceCount`, `#raceListCount` are preserved (read/written by `renderRaces`). `#raceHeroActive` and `#raceHeroStatus` are new — populated in Step 4.

- [ ] **Step 3: Add the `#newRaceModal` create-form modal**

In `RasiCross_Telemetry.html`, find `<!-- Driver Change Modal -->` (the `#driverModal` block ~2914). Insert **before** that comment:

```
<!-- New Race Modal -->
<div id="newRaceModal" class="overlay">
  <div class="dialog" style="max-width:440px">
    <h3>Neues Rennen</h3>
    <div class="field">
      <label>Rennname</label>
      <input id="newRaceName" placeholder="z.B. Sonntag Sprint">
    </div>
    <div class="field">
      <label>Strecke</label>
      <select id="newRaceTrack"><option value="">Keine Strecken gespeichert</option></select>
    </div>
    <div class="field">
      <label>Format</label>
      <select id="newRaceLengthType">
        <option value="time">Zeit (Minuten)</option>
        <option value="laps">Runden</option>
        <option value="free">Frei (kein Limit)</option>
      </select>
    </div>
    <div class="field" id="newRaceDurationField">
      <label>Dauer (min)</label>
      <input id="newRaceDuration" type="number" min="1" value="20">
    </div>
    <div class="field hidden" id="newRaceLapsField">
      <label>Anzahl Runden</label>
      <input id="newRaceLaps" type="number" min="1" value="10">
    </div>
    <div class="field">
      <label>Start-Fahrer</label>
      <select id="newRaceDriver"><option value="">Erst Fahrer anlegen</option></select>
    </div>
    <div class="dialog-btns">
      <button class="btn ghost" id="cancelNewRaceBtn">Abbrechen</button>
      <button class="btn primary" id="createRaceBtn">Rennen erstellen</button>
    </div>
  </div>
</div>
```

This is the current "Neues Rennen" form verbatim — same field IDs, same `#createRaceBtn` — moved into a `.dialog`. Step 2 already removed the old form (it was inside the replaced `#tab-races`).

- [ ] **Step 4: Wire the modal in `rasicross.js`**

Context: `init()` already binds `$('createRaceBtn').onclick = createRace` (the button kept its ID, so that binding still resolves). `createRace` ends with `rcToast(...)` after a successful create.

(a) **Close the modal after a successful create.** Read `createRace` (~line 1616). Replace its last two lines exactly:

```
  saveData();
  rcToast(`Rennen "${name}" erstellt — jetzt aktivieren um zu starten`);
}
```

with:

```
  saveData();
  $('newRaceModal').classList.remove('show');
  rcToast(`Rennen "${name}" erstellt — jetzt aktivieren um zu starten`);
}
```

(b) **Populate the two new hero chips.** Read `renderRaces` (~line 1848). After its existing `setText('raceListCount', state.races.length);` line, add:

```
  const _ar = activeRace();
  setText('raceHeroActive', _ar ? _ar.name : '--');
  setText('raceHeroStatus', _ar
    ? ({ created: 'Bereit', running: 'Läuft', paused: 'Pausiert', finished: 'Beendet', finished_auto: 'Auto-Ende' }[_ar.status] || _ar.status)
    : 'Bereit');
```

(c) **Open/close wiring.** In `init()`, find the block that binds the Live-tab buttons (near `$('startRaceBtn').onclick = …`). Add these lines in that block:

```
  $('openNewRaceBtn').onclick = () => $('newRaceModal').classList.add('show');
  $('cancelNewRaceBtn').onclick = () => $('newRaceModal').classList.remove('show');
  $('newRaceModal').onclick = (e) => { if (e.target.id === 'newRaceModal') $('newRaceModal').classList.remove('show'); };
```

- [ ] **Step 5: Verify**

Run: `node --check rasicross.js` → exit 0.
Run: `npm run lint` → no problems (exit 0).
Run: `npm test` → `tests 36` `pass 36` `fail 0`.
Manual (open `RasiCross_Telemetry.html`): the Rennen tab shows the hero + a full-width Bibliothek; "+ Neues Rennen" opens the modal; creating a race closes the modal and the race appears in the list; the count chip and `raceHeroActive`/`raceHeroStatus` update; Abbrechen and a backdrop click close the modal; no CSP errors in the devtools console.
`git status --short` shows only `RasiCross_Telemetry.html` and `rasicross.js` modified.

- [ ] **Step 6: Commit**

```bash
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" add RasiCross_Telemetry.html rasicross.js
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" commit -m "feat(dashboard): Pit-Wall redesign of the Rennen tab

Hero header + telemetry strip + full-width library. The create-race
form moves into a reusable .overlay/.dialog modal opened by a
'+ Neues Rennen' button. All race-list element IDs preserved.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 2: Fahrer tab

**Files:** Modify `RasiCross_Telemetry.html` (`#tab-drivers` ~2531-2555; new modal after `#newRaceModal`), Modify `rasicross.js` (`addDriver`; modal wiring).

Context: `renderTotalHero` (`rasicross.js` ~1539) already computes seven totals and `setText`s them — `totalDistance`, `totalTime`, `totalLaps`, `totalRaces`, `totalMaxSpeed`, `totalBestLap`, `totalTracks`. Only `#totalDistance` currently has a DOM element; the other six `setText` calls silently no-op. `#totalStatsGrid` and `#totalKm` are **not** referenced anywhere in `rasicross.js` — they are dead and are dropped. The new hero gives DOM homes to four of the totals, so `renderTotalHero` lights them up with no JS change.

- [ ] **Step 1: Replace the `#tab-drivers` section**

Replace the entire `<section class="tab" id="tab-drivers"> … </section>` block (between the `<!-- TAB: FAHRER -->` and `<!-- TAB: VERBINDUNG -->` comments) with:

```
<section class="tab" id="tab-drivers">

  <div class="pw-hero">
    <div class="pw-hero-bg"></div>
    <div class="pw-hero-grid"></div>
    <div class="pw-hero-content">
      <div class="pw-hero-left">
        <div class="pw-eyebrow">
          <span class="pw-eyebrow-dot"></span>
          <span>FAHRER &amp; STATISTIK</span>
        </div>
        <h1 class="pw-hero-title">Fahrer<span class="pw-hero-accent">.</span></h1>
        <p class="pw-hero-sub">Gefahrene Strecke aller Rennen</p>
      </div>
      <div class="pw-hero-telemetry">
        <div class="pw-tel">
          <div class="pw-tel-label">Strecke gesamt</div>
          <div class="pw-tel-value" id="totalDistance">0<small>km</small></div>
        </div>
        <div class="pw-tel">
          <div class="pw-tel-label">Runden</div>
          <div class="pw-tel-value mono" id="totalLaps">0</div>
        </div>
        <div class="pw-tel">
          <div class="pw-tel-label">Rennen</div>
          <div class="pw-tel-value mono" id="totalRaces">0</div>
        </div>
        <div class="pw-tel">
          <div class="pw-tel-label">Beste Runde</div>
          <div class="pw-tel-value" id="totalBestLap">--</div>
        </div>
      </div>
    </div>
  </div>

  <div class="pw-library">
    <div class="pw-lib-head pw-lib-head-row">
      <div class="pw-lib-title">
        <span class="pw-lib-bar"></span>
        <span>Bibliothek</span>
        <span class="pw-lib-count"><span id="driverCount">0</span> · Fahrer</span>
      </div>
      <button class="pw-btn primary" id="openNewDriverBtn">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>
        <span>Neuer Fahrer</span>
      </button>
    </div>
    <div id="driverStatsList"><div class="muted">Noch keine Fahrer.</div></div>
    <div id="driversList" style="display:none"></div>
  </div>

</section>
```

Notes: `#totalDistance`, `#driverStatsList`, `#driversList`, `#driverCount` are preserved. `#totalLaps`/`#totalRaces`/`#totalBestLap` are existing `renderTotalHero` `setText` targets that now gain DOM elements. The dead `total-hero` wrapper, `#totalStatsGrid` and `#totalKm` are dropped.

- [ ] **Step 2: Add the `#newDriverModal` create-form modal**

In `RasiCross_Telemetry.html`, find the `<!-- New Race Modal -->` block added in Task 1. Insert **after** its closing `</div>` (the modal's outer close):

```
<!-- New Driver Modal -->
<div id="newDriverModal" class="overlay">
  <div class="dialog" style="max-width:400px">
    <h3>Neuer Fahrer</h3>
    <div class="field"><label>Name</label><input id="newDriverName" placeholder="z.B. Jim"></div>
    <div class="field"><label>Startnummer</label><input id="newDriverNumber" placeholder="1"></div>
    <div class="field"><label>Farbe</label><input id="newDriverColor" type="color" value="#c8ff3d"></div>
    <div class="dialog-btns">
      <button class="btn ghost" id="cancelNewDriverBtn">Abbrechen</button>
      <button class="btn primary" id="addDriverBtn">Fahrer hinzufügen</button>
    </div>
  </div>
</div>
```

Current "Neuer Fahrer" form verbatim — same field IDs, same `#addDriverBtn` — in a `.dialog`. Step 1 already removed the old form.

- [ ] **Step 3: Wire the modal in `rasicross.js`**

Context: `init()` already binds `$('addDriverBtn').onclick = addDriver`. `addDriver` (~line 1516) `return rcAlert(...)`s on a missing name and otherwise ends with `rcToast(...)`.

(a) **Close the modal after a successful add.** Read `addDriver`. Replace its last two lines exactly:

```
  saveData();
  rcToast(`Fahrer "${name}" hinzugefügt`);
}
```

with:

```
  saveData();
  $('newDriverModal').classList.remove('show');
  rcToast(`Fahrer "${name}" hinzugefügt`);
}
```

(b) **Open/close wiring.** In `init()`, next to the Task 1 modal wiring, add:

```
  $('openNewDriverBtn').onclick = () => $('newDriverModal').classList.add('show');
  $('cancelNewDriverBtn').onclick = () => $('newDriverModal').classList.remove('show');
  $('newDriverModal').onclick = (e) => { if (e.target.id === 'newDriverModal') $('newDriverModal').classList.remove('show'); };
```

- [ ] **Step 4: Verify**

Run: `node --check rasicross.js` → exit 0.
Run: `npm run lint` → no problems (exit 0).
Run: `npm test` → `tests 36` `pass 36` `fail 0`.
Manual: the Fahrer tab shows the hero (Strecke gesamt / Runden / Rennen / Beste Runde populated by `renderTotalHero`) + a full-width Bibliothek; "+ Neuer Fahrer" opens the modal; adding a driver closes it and the driver appears; `#driverCount` updates; Abbrechen / backdrop close the modal; no CSP errors.
`git status --short` shows only the two files modified.

- [ ] **Step 5: Commit**

```bash
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" add RasiCross_Telemetry.html rasicross.js
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" commit -m "feat(dashboard): Pit-Wall redesign of the Fahrer tab

Hero header (the total-distance block becomes the telemetry strip,
giving DOM homes to renderTotalHero's existing stats) + full-width
library. The create-driver form moves into a modal. Dead #totalStatsGrid
and #totalKm dropped. All driver-list element IDs preserved.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 3: Live tab

**Files:** Modify `RasiCross_Telemetry.html` (`#tab-live` ~2084-2272; new CSS), Modify `rasicross.js` (Live hero title).

The Live tab keeps **all** its content. Three changes: (A) the race-control bar becomes a `pw-hero` + a race-control cluster; (B) the six content cards (`.card`) become `pw-module`s; (C) the KPI row, delta banner and sector panel are kept as-is (they already read well under the hero — no markup change). Only the Live tab's `.card` blocks are touched; `.card` elsewhere (Verbindung/Settings) is untouched.

- [ ] **Step 1: Add the Live CSS**

In `RasiCross_Telemetry.html`, after the `.dialog .field:last-of-type{…}` rule added in Task 1 Step 1, insert:

```
/* Redesign: Live race-control cluster */
.pw-livebar{display:flex;align-items:center;gap:8px;flex-wrap:wrap;background:var(--card);border:1px solid var(--bor);border-radius:var(--r-md);padding:10px 12px;margin-bottom:18px}
.pw-livebar select{margin-left:auto}
.pw-livebar select+.btn{margin-left:0}
```

(If `--card`, `--bor`, `--r-md` are not the exact token names in this file, use the ones the existing `.card` rule at ~line 432 uses — read it first and match.)

- [ ] **Step 2: Replace the race-control bar with hero + cluster**

In `#tab-live`, replace the entire `<!-- Race control bar --> <div class="race-bar"> … </div>` block (ends just before `<!-- KPIs -->`) with:

```
  <!-- Hero -->
  <div class="pw-hero">
    <div class="pw-hero-bg"></div>
    <div class="pw-hero-grid"></div>
    <div class="pw-hero-content">
      <div class="pw-hero-left">
        <div class="pw-eyebrow">
          <span class="pw-eyebrow-dot"></span>
          <span>LIVE-TELEMETRIE</span>
        </div>
        <h1 class="pw-hero-title"><span id="liveHeroTitle">Live</span><span class="pw-hero-accent">.</span></h1>
        <p class="pw-hero-sub">Echtzeit-Telemetrie vom Kart</p>
      </div>
      <div class="pw-hero-telemetry">
        <div class="pw-tel">
          <div class="pw-tel-label">Countdown</div>
          <div class="pw-tel-value mono" id="countdown">--:--</div>
        </div>
        <div class="pw-tel">
          <div class="pw-tel-label">Status</div>
          <div class="pw-tel-value" id="raceMeta">Bereit</div>
        </div>
        <div class="pw-tel">
          <div class="pw-tel-label">GPS</div>
          <div class="pw-tel-value" id="gpsStatus">--</div>
        </div>
      </div>
    </div>
  </div>

  <!-- Race-control cluster -->
  <div class="pw-livebar">
    <button class="btn good" id="startRaceBtn" disabled>
      <svg viewBox="0 0 24 24"><path d="M5 3l14 9-14 9z"/></svg>
      Start
    </button>
    <button class="btn blue" id="changeDriverBtn" disabled>
      <svg viewBox="0 0 24 24"><path d="M16 3l4 4-4 4M20 7H8M8 21l-4-4 4-4M4 17h12"/></svg>
      Wechsel
    </button>
    <button class="btn pitcall" id="pitCallBtn" title="Boxenruf">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11l18-8-3 18-7-7z"/></svg>
      BOX
    </button>
    <select id="oledPageSelect" title="OLED-Seite">
      <option value="auto">⟳ Auto</option>
      <option value="speed">1 · Speed</option>
      <option value="race">2 · Rennen</option>
      <option value="rpm">3 · RPM</option>
      <option value="delta">4 · Delta</option>
      <option value="diag">5 · Diagnose</option>
    </select>
    <button class="btn danger" id="endRaceBtn" disabled>Ende</button>
  </div>
```

Notes: `#countdown`, `#raceMeta`, `#startRaceBtn`, `#changeDriverBtn`, `#pitCallBtn`, `#oledPageSelect`, `#endRaceBtn` keep their IDs and existing handlers/behaviour. `#gpsStatus` is **moved here** from the map-card stat row (see Step 4). `#liveHeroTitle` is new (populated in Step 5). The old `race-bar-cd`/`race-bar-meta` wrapper text ("Erstelle ein Rennen…") is dropped; `#raceMeta` keeps its ID and is now a hero chip.

- [ ] **Step 3: Convert the six Live content cards to `pw-module`**

The Live tab has six `<div class="card">` blocks — Streckenkarte, Tacho, Speed & RPM Verlauf, G-Kraft Verlauf, Stints, Letzte Runden. For **each** of the six, within `#tab-live` only:
- change the wrapper `<div class="card">` → `<div class="pw-module">`,
- change its `<div class="card-head">` → `<div class="pw-mod-head">`,
- change `<span class="card-title">…</span>` → `<div class="pw-mod-title">…</div>`,
- leave `<span class="card-sub">…</span>` as-is (it still styles fine) and leave **all inner content unchanged** — every `canvas`, the tacho `<svg>`, `#trackCanvas`, `#heatmapBtn`, `#gViewToggle`, `#gMeterCanvas`, `#gMeter3dCanvas`, `#srCanvas`, `#gCanvas`, `#stintsList`, `#lapTable`/`#lapTableBody`, the `.stat` row, etc. keep their IDs and markup.

Do not touch `.card` blocks outside `#tab-live`. The `kpi-row`, `#deltaBanner` and `#sectorPanel` blocks are left exactly as they are.

- [ ] **Step 4: Relocate the GPS stat**

In the Streckenkarte module (formerly card), the `.row` of `.stat` items contains `<div class="stat"><div class="t">GPS</div><div class="n" id="gpsStatus">--</div></div>`. Remove that one `.stat` (GPS) — its `#gpsStatus` element now lives in the hero (Step 2). Leave the other stats (`#latText`, `#lonText`, `#trackPoints`, `#packetsText`) in place.

- [ ] **Step 5: Populate the Live hero title**

In `rasicross.js`, read `updateRaceControls` (~line 1932). Immediately after its `const r = activeRace();` line, add:

```
  setText('liveHeroTitle', r ? r.name : 'Live');
```

`setText` updates only the `#liveHeroTitle` span, so the `pw-hero-accent` "." is preserved. `#countdown`, `#raceMeta`, `#gpsStatus` are written by existing JS via their IDs and keep working unchanged in their new location.

- [ ] **Step 6: Verify**

Run: `node --check rasicross.js` → exit 0.
Run: `npm run lint` → no problems (exit 0).
Run: `npm test` → `tests 36` `pass 36` `fail 0`.
Manual: the Live tab shows the hero (title = race name or "Live", chips Countdown/Status/GPS) + the race-control cluster + the KPI row + the six modules; start/end/pause, driver change, BOX and the OLED select still work; the map, tacho, charts, stints and lap table still render and update live; delta banner and sector panel still appear during a race; no CSP errors.
`git status --short` shows only the two files modified.

- [ ] **Step 7: Commit**

```bash
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" add RasiCross_Telemetry.html rasicross.js
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" commit -m "feat(dashboard): Pit-Wall redesign of the Live tab

Race-control bar becomes a pw-hero (title = race name; Countdown /
Status / GPS telemetry strip) plus a race-control cluster. The six
content cards become pw-modules. KPI row, delta banner and sector
panel kept. All element IDs and handlers preserved.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 4: Commit the plan document

- [ ] **Step 1:** Full verification dry-run (`node --check rasicross.js`, `npm run lint`, `npm test` — all green) and a manual click-through of all three redesigned tabs.
- [ ] **Step 2:** Commit this plan:
```bash
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" add docs/superpowers/plans/2026-05-22-14-tab-redesign-pitwall.md
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" commit -m "docs: Pit-Wall tab-redesign implementation plan

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Self-Review

**1. Spec coverage:**
- §4.1 shared hero + reuse of the `.overlay`/`.dialog` modal pattern → every task builds a `pw-hero`; Tasks 1–2 add `.overlay`/`.dialog` modals. ✅
- §4.2 Rennen (hero, full-width library, "+ Neues Rennen" modal) → Task 1. ✅
- §4.3 Fahrer (hero absorbs the total-distance block, full-width library, "+ Neuer Fahrer" modal) → Task 2. ✅
- §4.4 Live (hero, race-control cluster, KPI row, modules) → Task 3. ✅
- §6 no new tests; existing suites green; static checks → every task's verify step. ✅
- **Spec refinement:** §4.3 said keep `#totalStatsGrid` as a secondary stat row "so the totals JS keeps working." Planning found `#totalStatsGrid` and `#totalKm` are **not referenced by `rasicross.js`** — they are dead. The plan drops them; the Fahrer hero strip instead gives DOM homes to four totals that `renderTotalHero` already `setText`s, so the totals JS works without change. This is simpler than the spec and loses nothing.
- **Spec note:** §5 scoped new JS to "modal wiring + Live hero." The plan also adds two `setText` calls to `renderRaces` (Task 1 Step 4b) for the Rennen hero's Aktives-Rennen/Status chips — same trivial pattern, low risk.

**2. Placeholder scan:** No TBD/TODO. New HTML is written out in full; the Live card→module change is a precise, enumerated class swap with "inner content unchanged"; every JS edit shows literal old/new text or an exact line to add. ✅

**3. Type/name consistency:** New IDs are introduced and consumed consistently — `openNewRaceBtn`/`cancelNewRaceBtn`/`newRaceModal`/`raceHeroActive`/`raceHeroStatus` (Task 1), `openNewDriverBtn`/`cancelNewDriverBtn`/`newDriverModal` (Task 2), `liveHeroTitle`/`pw-livebar` (Task 3). Preserved IDs (`raceList`, `raceListCount`, `createRaceBtn`, `driverStatsList`, `driverCount`, `addDriverBtn`, `totalDistance`, `countdown`, `raceMeta`, `gpsStatus`, `startRaceBtn` …) match what `rasicross.js` reads/writes today. `npm test` stays at 36 (no test changes). ✅
