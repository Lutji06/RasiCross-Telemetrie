# Live-Tab No-Scroll Layout + Detail-Tab Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fit every rennrelevant Live value on one 1440×900 screen without vertical scrolling, and move the analysis/historical content (Verlauf-Charts, Stints, vollständige Rundentabelle) into a new sidebar tab **Detail**.

**Architecture:** Pure dashboard restructure — HTML reordering plus a few scoped CSS additions plus four new `setText` lines in `rasicross.js`. No new design vocabulary (the `pw-*` system is reused). The generic tab-switcher already supports a new `data-tab="detail"` once a `#tab-detail` section exists, so no new JS mechanism is needed. The analysis render functions (`drawLiveCharts`, `renderStints`, `renderLapTable`) already run on tab-independent timers and `drawChart` self-resizes per frame — no special "render-on-hidden" or "resize-on-tab-switch" wiring is required.

**Tech Stack:** Vanilla HTML / CSS / ES2017 JS. `pw-*` Pit-Wall design system already in the page `<style>` block. Strict CSP (no inline handlers, no new `<script>`).

---

## Working Directory & Conventions

- Repo: `C:/Users/jimlu/Documents/RasiCross-Telemetrie-git` — use `git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" …` in tasks that shell out.
- Branch: `feat/tab-redesign-pitwall` (the brainstorm spec and this plan live on this branch). Spec: `docs/superpowers/specs/2026-05-23-live-tab-no-scroll-detail-design.md`.
- Files are **CRLF**. Always **Read the target region in-session immediately before an Edit**, then copy the anchor verbatim from that fresh Read. Line numbers in this plan are indicative only — anchor on text.
- Use the **Grep tool** (not shell `grep`) for verification asserts.
- **Never** `git add` `.claude/`, `node_modules/`, or this plan doc except in the **explicit plan-doc commit in Task 6**.
- Commit messages: conventional + body + trailer `Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>` via HEREDOC.
- Per-task verification recipe (run after each task):
  - `node --check rasicross.js`
  - `node --check main.js && node --check preload.js && node --check geo.js && node --check replay.js && node --check karts3d.js`
  - `node --test` (auto-discovers `test/`)
  - `python -m py_compile bridge.py esp_libs/*.py` (skip silently if `python` is missing — `py -3` may also work)
  - `python -m unittest discover -s test -p "test_*.py"` (likewise optional if no Python in PATH)
  - `npm run lint` (ESLint must stay clean)
  - Delete `__pycache__/` directories before any `git status` check.

## Locked Decisions

- **Layout approach:** A — *Klassischer Stack* (compact hero → race-control → 5 KPIs → delta+sektor strip → map+tacho).
- **Detail entrypoint:** new sidebar nav button `Detail` in the **Cockpit** group, between `Live` and `Rennen` (`data-tab="detail"`).
- **Detail structure:** one long scrolling section with hero + Verlauf (g2 grid of two `pw-module`s) + Stints (full-width module) + Letzte Runden (full-width module). **No Diagnose-Sektion** (YAGNI — diagnostic values stay on Live as KPI/Map subs).
- **ID preservation:** every element ID that `rasicross.js` reads/writes is preserved verbatim — chart/stints/lap-table DOM is **moved**, not duplicated.
- **New IDs introduced:** `detailHeroLapCurrent`, `detailHeroLapBest`, `detailHeroStintCount`, `detailHeroPackets`. None collide with existing IDs (verified by Grep).
- **Compact hero is Live-only:** the modifier class `pw-hero--compact` is applied only to the Live hero. Strecke, Rennen, Fahrer, Detail keep the normal hero.

## File Structure

| Action | Path | Responsibility |
|---|---|---|
| Modify | `RasiCross_Telemetry.html` | Adds CSS for `pw-hero--compact` + `pw-strip-delta-sectors` + scoped Live-only KPI tweaks. Adds Detail sidebar nav entry. Adds `<section id="tab-detail">` with hero + 3 module slots. Moves 3 analysis cards from `#tab-live` → `#tab-detail`. Restructures `#tab-live` hero (compact) and combines delta+sektor into one strip. |
| Modify | `rasicross.js` | Adds 4 `setText` calls inside `updateLiveUi` to populate the Detail-hero chips. No other JS change. |
| Modify | `MEMORY.md` (`memory/`) | (Out of scope of code commits — memory is updated independently if needed.) |

**Task order (each task ends green on the verification recipe):**

1. CSS additions (no DOM yet).
2. Detail-tab shell: sidebar nav entry + empty `#tab-detail` section (hero + 3 module slots).
3. Move the 3 analysis cards (Speed/RPM chart, G-Kraft chart, Stints, Letzte Runden) from `#tab-live` → `#tab-detail`.
4. Restructure `#tab-live`: apply `pw-hero--compact`, drop the subtitle, combine delta+sektor into `pw-strip-delta-sectors`.
5. Wire the 4 Detail-hero chip values in `rasicross.js` (`updateLiveUi`).
6. Final manual acceptance + commit this plan doc.

---

## Tasks

### Task 1: Add scoped CSS for the compact hero, delta+sektor strip, and Live KPI tweaks

**Files:**
- Modify: `RasiCross_Telemetry.html` (CSS block — anchor inside the `.pw-livebar` rule region near line 1278–1280; we insert a new comment-block right after the existing `.pw-livebar` rules).

- [ ] **Step 1: Read the anchor region**

Read `RasiCross_Telemetry.html` lines ~1275–1290 to confirm the `.pw-livebar` block ends with `.pw-livebar select+.btn{margin-left:0}` and that the next non-blank line starts a new section. Copy the post-`.pw-livebar` anchor verbatim from the fresh Read.

- [ ] **Step 2: Insert the new CSS block**

Edit `RasiCross_Telemetry.html` — `old_string` is the last `.pw-livebar` rule line. `new_string` is that same line followed by the new CSS:

```css
.pw-livebar select+.btn{margin-left:0}

/* ============================================================
   LIVE-TAB COMPACT VARIANTS  (no-scroll on 1440x900)
   ============================================================ */
.pw-hero--compact{margin-bottom:12px}
.pw-hero--compact .pw-hero-content{
  flex-direction:row;align-items:center;justify-content:space-between;
  gap:18px;padding:14px 22px;
}
.pw-hero--compact .pw-eyebrow{margin-bottom:6px}
.pw-hero--compact .pw-hero-title{font-size:26px;margin-bottom:0;line-height:1}
.pw-hero--compact .pw-hero-sub{display:none}
.pw-hero--compact .pw-hero-telemetry{
  grid-template-columns:repeat(3,minmax(120px,auto));gap:10px;
}
.pw-hero--compact .pw-tel{padding:8px 12px}
.pw-hero--compact .pw-tel-label{margin-bottom:3px}
.pw-hero--compact .pw-tel-value{font-size:15px}
.pw-hero--compact .pw-tel-value.mono{font-size:17px}
@media (max-width:900px){
  .pw-hero--compact .pw-hero-content{flex-direction:column;align-items:stretch}
}

.pw-strip-delta-sectors{
  display:grid;grid-template-columns:minmax(220px,1fr) 3fr;
  gap:12px;margin-bottom:14px;align-items:stretch;
}
.pw-strip-delta-sectors > .delta-banner{margin-bottom:0;padding:10px 18px}
.pw-strip-delta-sectors > .delta-banner .delta-time{font-size:24px}
.pw-strip-delta-sectors > .sector-panel{margin-bottom:0}
.pw-strip-delta-sectors > .sector-panel .sector-card{padding:10px 14px}
.pw-strip-delta-sectors > .sector-panel .sector-time{font-size:18px}
@media (max-width:900px){
  .pw-strip-delta-sectors{grid-template-columns:1fr}
}

/* Live-only KPI tightening — keeps other tabs' KPI sizing intact */
#tab-live .kpi{padding:12px 14px}
#tab-live .kpi-v{font-size:clamp(24px,3vw,32px);margin-top:2px}
#tab-live .kpi-sub{font-size:10.5px;margin-top:4px}
#tab-live #yawSparkCanvas{height:22px}
#tab-live .kpi-row{margin-bottom:12px !important}
```

- [ ] **Step 3: Verify the CSS is present and well-formed**

Run Grep `pw-hero--compact` in `RasiCross_Telemetry.html` — must return ≥ 9 matches (one selector + 8 child rules).
Run Grep `pw-strip-delta-sectors` in `RasiCross_Telemetry.html` — must return ≥ 5 matches.
Run Grep `#tab-live .kpi` in `RasiCross_Telemetry.html` — must return ≥ 1 match.

- [ ] **Step 4: Run the verification recipe**

```bash
node --check rasicross.js
node --check main.js && node --check preload.js && node --check geo.js && node --check replay.js && node --check karts3d.js
node --test
npm run lint
```

All must pass. (HTML CSS changes don't affect JS, but the lint pass catches accidental edits.)

- [ ] **Step 5: Commit**

```bash
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" add RasiCross_Telemetry.html
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" commit -m "$(cat <<'EOF'
style(dashboard): add pw-hero--compact + pw-strip-delta-sectors + Live KPI scoping

Adds the Live-only compact-hero variant, the combined delta+sektor strip,
and scoped #tab-live KPI/yawSparkCanvas tweaks. No DOM uses these classes
yet (Task 4 applies them). Other tabs unaffected.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Add the Detail sidebar nav entry + empty `#tab-detail` shell

**Files:**
- Modify: `RasiCross_Telemetry.html` (sidebar nav around line 1980–1992; add new `<section>` immediately after `#tab-live` which ends near line 2263).

- [ ] **Step 1: Read the sidebar Cockpit-group anchor**

Read `RasiCross_Telemetry.html` lines ~1978–1992 to confirm the Cockpit group's last button is the `data-tab="drivers"` Fahrer entry. Copy the anchor verbatim.

- [ ] **Step 2: Insert the Detail nav button between `Live` and `Rennen`**

Edit `RasiCross_Telemetry.html`. `old_string` is the closing `</button>` of the `data-tab="live"` entry plus the line break preceding `<button class="nav-item" data-tab="races">`. Replace with the same content **plus** the new button between them:

```html
    <button class="nav-item active" data-tab="live">
      <span class="nav-icon"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/></svg></span>
      Live
    </button>
    <button class="nav-item" data-tab="detail">
      <span class="nav-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v18h18"/><path d="M7 14l4-4 3 3 5-6"/></svg></span>
      Detail
    </button>
    <button class="nav-item" data-tab="races">
```

Anchor the edit on the exact whitespace and SVG markup of the existing Live + Rennen buttons (use the fresh Read).

- [ ] **Step 3: Read the `#tab-live` closing anchor**

Read `RasiCross_Telemetry.html` lines ~2260–2270 to confirm `#tab-live` closes with `</section>` and the next line is the `<!-- TAB: STRECKE …` comment introducing `#tab-track`.

- [ ] **Step 4: Insert the empty `#tab-detail` section right after `#tab-live`**

Edit `RasiCross_Telemetry.html`. `old_string` is the `</section>` that closes `#tab-live` followed by the `<!-- TAB: STRECKE` comment line. Replace with the same closing tag + the new section + the same comment:

```html
</section>

<!-- ============================================================
     TAB: DETAIL
     ============================================================ -->
<section class="tab" id="tab-detail">

  <!-- Hero -->
  <div class="pw-hero">
    <div class="pw-hero-bg"></div>
    <div class="pw-hero-grid"></div>
    <div class="pw-hero-content">
      <div class="pw-hero-left">
        <div class="pw-eyebrow">
          <span class="pw-eyebrow-dot"></span>
          <span>LIVE-DETAIL</span>
        </div>
        <h1 class="pw-hero-title">Detail<span class="pw-hero-accent">.</span></h1>
        <p class="pw-hero-sub">Verlauf, Stints und Rundentabelle des aktiven Rennens</p>
      </div>
      <div class="pw-hero-telemetry">
        <div class="pw-tel">
          <div class="pw-tel-label">Aktive Runde</div>
          <div class="pw-tel-value mono" id="detailHeroLapCurrent">--:--.---</div>
        </div>
        <div class="pw-tel">
          <div class="pw-tel-label">Beste Runde</div>
          <div class="pw-tel-value mono" id="detailHeroLapBest">--:--.---</div>
        </div>
        <div class="pw-tel">
          <div class="pw-tel-label">Stints</div>
          <div class="pw-tel-value mono" id="detailHeroStintCount">0</div>
        </div>
        <div class="pw-tel">
          <div class="pw-tel-label">Pakete</div>
          <div class="pw-tel-value mono" id="detailHeroPackets">0</div>
        </div>
      </div>
    </div>
  </div>

  <!-- Verlauf (Speed/RPM + G-Kraft) -->
  <div class="grid g2" id="detailVerlaufSlot" style="margin-bottom:18px">
    <!-- Task 3 moves the srCanvas + gCanvas pw-modules here -->
  </div>

  <!-- Stints -->
  <div id="detailStintsSlot" style="margin-bottom:18px">
    <!-- Task 3 moves the Stints pw-module here -->
  </div>

  <!-- Letzte Runden -->
  <div id="detailLapsSlot">
    <!-- Task 3 moves the lapTable pw-module here -->
  </div>
</section>

<!-- ============================================================
     TAB: STRECKE — PIT-WALL Redesign v3
     ============================================================ -->
```

- [ ] **Step 5: Verify the new nav button and section exist, and no ID collisions**

Run Grep `data-tab="detail"` in `RasiCross_Telemetry.html` — must return exactly 1 match.
Run Grep `id="tab-detail"` in `RasiCross_Telemetry.html` — must return exactly 1 match.
Run Grep `detailHeroLapCurrent` in `RasiCross_Telemetry.html` — must return exactly 1 match.
Run Grep `detailHeroLapBest` in `RasiCross_Telemetry.html` — must return exactly 1 match.
Run Grep `detailHeroStintCount` in `RasiCross_Telemetry.html` — must return exactly 1 match.
Run Grep `detailHeroPackets` in `RasiCross_Telemetry.html` — must return exactly 1 match.
Run Grep `id="detailVerlaufSlot"` and `id="detailStintsSlot"` and `id="detailLapsSlot"` in `RasiCross_Telemetry.html` — each must return exactly 1 match.

- [ ] **Step 6: Run the verification recipe**

Same commands as Task 1 Step 4. All must pass.

- [ ] **Step 7: Commit**

```bash
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" add RasiCross_Telemetry.html
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" commit -m "$(cat <<'EOF'
feat(dashboard): add Detail sidebar entry and empty #tab-detail shell

Adds a new Cockpit nav button "Detail" (data-tab="detail") between Live and
Rennen, plus an empty #tab-detail section with hero + three empty module
slots. The existing generic tab-switcher (setupTabs) handles the new tab
without any JS change. Task 3 moves content into the slots; Task 5 wires
the hero chips.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Move the 3 analysis cards from `#tab-live` into `#tab-detail`

**Files:**
- Modify: `RasiCross_Telemetry.html` — cut the chart grid, the Stints + Letzte Runden grid out of `#tab-live`, paste into the corresponding `#tab-detail` slots.

The three blocks to move (every ID is preserved verbatim):

1. **Chart grid** — the `<div class="grid g2" style="margin-bottom:18px">` that wraps the two `pw-module`s containing `srCanvas` and `gCanvas`.
2. **Stints module** — the first `pw-module` inside the final `<div class="grid g2">` (contains `stintsList`, `currentDriverName`).
3. **Letzte Runden module** — the second `pw-module` inside the final `<div class="grid g2">` (contains `lapTable`, `lapTableBody`).

- [ ] **Step 1: Read the source region in `#tab-live`**

Read `RasiCross_Telemetry.html` lines ~2230–2265 to capture both the chart grid and the final g2 grid (Stints + Letzte Runden) plus the `</section>` close of `#tab-live`. Copy the entire block verbatim from the fresh Read.

- [ ] **Step 2: Read the Detail slots**

Read `RasiCross_Telemetry.html` to locate `id="detailVerlaufSlot"`, `id="detailStintsSlot"`, `id="detailLapsSlot"`. Capture the anchor lines.

- [ ] **Step 3: Cut the chart grid out of `#tab-live`**

Edit `RasiCross_Telemetry.html`. `old_string` is the chart grid block — the opening `<!-- Charts -->` comment through the closing `</div>` of `<div class="grid g2" style="margin-bottom:18px">` that contains `srCanvas` + `gCanvas`. `new_string` is empty (the block is removed from Live).

The block to remove (verify with the fresh Read; this is the expected literal content):

```html
  <!-- Charts -->
  <div class="grid g2" style="margin-bottom:18px">
    <div class="pw-module">
      <div class="pw-mod-head"><div class="pw-mod-title">Speed & RPM Verlauf</div><span class="card-sub">Live</span></div>
      <div style="position:relative;aspect-ratio:2.4;background:var(--soft);border:1px solid var(--bor);border-radius:var(--r-md)">
        <canvas id="srCanvas" style="width:100%;height:100%;display:block"></canvas>
      </div>
    </div>
    <div class="pw-module">
      <div class="pw-mod-head"><div class="pw-mod-title">G-Kraft Verlauf</div><span class="card-sub">Live</span></div>
      <div style="position:relative;aspect-ratio:2.4;background:var(--soft);border:1px solid var(--bor);border-radius:var(--r-md)">
        <canvas id="gCanvas" style="width:100%;height:100%;display:block"></canvas>
      </div>
    </div>
  </div>
```

- [ ] **Step 4: Paste the chart grid into `#detailVerlaufSlot`**

Edit `RasiCross_Telemetry.html`. `old_string` is the slot's opening line + the placeholder comment + the slot close:

```html
  <!-- Verlauf (Speed/RPM + G-Kraft) -->
  <div class="grid g2" id="detailVerlaufSlot" style="margin-bottom:18px">
    <!-- Task 3 moves the srCanvas + gCanvas pw-modules here -->
  </div>
```

`new_string` is the slot with the two `pw-module`s inside (the wrapping grid is the slot itself, so insert only the two modules):

```html
  <!-- Verlauf (Speed/RPM + G-Kraft) -->
  <div class="grid g2" id="detailVerlaufSlot" style="margin-bottom:18px">
    <div class="pw-module">
      <div class="pw-mod-head"><div class="pw-mod-title">Speed & RPM Verlauf</div><span class="card-sub">Live</span></div>
      <div style="position:relative;aspect-ratio:2.4;background:var(--soft);border:1px solid var(--bor);border-radius:var(--r-md)">
        <canvas id="srCanvas" style="width:100%;height:100%;display:block"></canvas>
      </div>
    </div>
    <div class="pw-module">
      <div class="pw-mod-head"><div class="pw-mod-title">G-Kraft Verlauf</div><span class="card-sub">Live</span></div>
      <div style="position:relative;aspect-ratio:2.4;background:var(--soft);border:1px solid var(--bor);border-radius:var(--r-md)">
        <canvas id="gCanvas" style="width:100%;height:100%;display:block"></canvas>
      </div>
    </div>
  </div>
```

- [ ] **Step 5: Cut the Stints + Letzte Runden grid out of `#tab-live`**

Edit `RasiCross_Telemetry.html`. `old_string` is the final-grid block in `#tab-live`:

```html
  <!-- Stints + lap table -->
  <div class="grid g2">
    <div class="pw-module">
      <div class="pw-mod-head"><div class="pw-mod-title">Stints</div><span class="card-sub" id="currentDriverName">--</span></div>
      <div id="stintsList"><div class="muted">Noch kein Stint.</div></div>
    </div>
    <div class="pw-module">
      <div class="pw-mod-head"><div class="pw-mod-title">Letzte Runden</div><span class="card-sub">aktives Rennen</span></div>
      <div class="tbl-wrap">
        <table id="lapTable">
          <thead><tr><th>#</th><th>Zeit</th><th>Fahrer</th><th>Max km/h</th><th>Max RPM</th></tr></thead>
          <tbody id="lapTableBody"><tr><td colspan="5" class="muted">Noch keine Runden</td></tr></tbody>
        </table>
      </div>
    </div>
  </div>
```

`new_string` is empty.

- [ ] **Step 6: Paste the Stints module into `#detailStintsSlot`**

Edit `RasiCross_Telemetry.html`. `old_string`:

```html
  <!-- Stints -->
  <div id="detailStintsSlot" style="margin-bottom:18px">
    <!-- Task 3 moves the Stints pw-module here -->
  </div>
```

`new_string`:

```html
  <!-- Stints -->
  <div id="detailStintsSlot" style="margin-bottom:18px">
    <div class="pw-module">
      <div class="pw-mod-head"><div class="pw-mod-title">Stints</div><span class="card-sub" id="currentDriverName">--</span></div>
      <div id="stintsList"><div class="muted">Noch kein Stint.</div></div>
    </div>
  </div>
```

- [ ] **Step 7: Paste the Letzte Runden module into `#detailLapsSlot`**

Edit `RasiCross_Telemetry.html`. `old_string`:

```html
  <!-- Letzte Runden -->
  <div id="detailLapsSlot">
    <!-- Task 3 moves the lapTable pw-module here -->
  </div>
```

`new_string`:

```html
  <!-- Letzte Runden -->
  <div id="detailLapsSlot">
    <div class="pw-module">
      <div class="pw-mod-head"><div class="pw-mod-title">Letzte Runden</div><span class="card-sub">aktives Rennen</span></div>
      <div class="tbl-wrap">
        <table id="lapTable">
          <thead><tr><th>#</th><th>Zeit</th><th>Fahrer</th><th>Max km/h</th><th>Max RPM</th></tr></thead>
          <tbody id="lapTableBody"><tr><td colspan="5" class="muted">Noch keine Runden</td></tr></tbody>
        </table>
      </div>
    </div>
  </div>
```

- [ ] **Step 8: Verify ID uniqueness — each moved ID must appear exactly once in the HTML**

Run Grep (each must return exactly **1** match):
- `id="srCanvas"`
- `id="gCanvas"`
- `id="stintsList"`
- `id="currentDriverName"`
- `id="lapTable"`
- `id="lapTableBody"`

Run Grep `<!-- Task 3 moves` in `RasiCross_Telemetry.html` — must return **0** matches (no leftover placeholders).

- [ ] **Step 9: Run the verification recipe**

Same as Task 1 Step 4. All must pass.

- [ ] **Step 10: Commit**

```bash
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" add RasiCross_Telemetry.html
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" commit -m "$(cat <<'EOF'
feat(dashboard): move charts, Stints, lap table from Live to Detail

Cuts the Speed/RPM and G-Kraft chart modules, the Stints module, and the
Letzte-Runden lap table out of #tab-live and pastes them verbatim into the
#tab-detail Verlauf/Stints/Laps slots. Every element ID (srCanvas, gCanvas,
stintsList, currentDriverName, lapTable, lapTableBody) is preserved exactly
once. The existing tab-independent render loops (animLoop, updateLiveUi,
renderLapTable) keep these elements populated regardless of which tab is
active; drawChart self-resizes per frame so no resize hook is needed.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Restructure `#tab-live` — compact hero + combined delta+sektor strip

**Files:**
- Modify: `RasiCross_Telemetry.html` — apply `pw-hero--compact` to the Live hero, drop the subtitle paragraph, and wrap `#deltaBanner` + `#sectorPanel` in a `pw-strip-delta-sectors` flex grid.

- [ ] **Step 1: Read the Live hero region**

Read `RasiCross_Telemetry.html` lines ~2057–2090 to capture the Live hero literal markup.

- [ ] **Step 2: Apply the compact modifier and remove the subtitle**

Edit `RasiCross_Telemetry.html`. `old_string` is the Live hero opening + the subtitle paragraph. The current literal is:

```html
<section class="tab active" id="tab-live">

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
```

`new_string` adds the modifier class and drops the subtitle:

```html
<section class="tab active" id="tab-live">

  <!-- Hero (compact) -->
  <div class="pw-hero pw-hero--compact">
    <div class="pw-hero-bg"></div>
    <div class="pw-hero-grid"></div>
    <div class="pw-hero-content">
      <div class="pw-hero-left">
        <div class="pw-eyebrow">
          <span class="pw-eyebrow-dot"></span>
          <span>LIVE-TELEMETRIE</span>
        </div>
        <h1 class="pw-hero-title"><span id="liveHeroTitle">Live</span><span class="pw-hero-accent">.</span></h1>
      </div>
```

- [ ] **Step 3: Read the Delta + Sektor region**

Read `RasiCross_Telemetry.html` lines ~2159–2172 to capture the current `<!-- Live delta -->` and `<!-- Sectors -->` blocks verbatim.

- [ ] **Step 4: Wrap deltaBanner + sectorPanel in a single strip**

Edit `RasiCross_Telemetry.html`. `old_string`:

```html
  <!-- Live delta -->
  <div class="delta-banner hidden" id="deltaBanner">
    <span class="delta-label">Δ Live-Delta</span>
    <span class="delta-time same" id="deltaTime">+0.000s</span>
    <span class="delta-ref" id="deltaRef">vs. beste Runde</span>
  </div>

  <!-- Sectors -->
  <div class="sector-panel" id="sectorPanel" style="display:none">
    <div class="sector-card" id="s1Card"><div class="sector-label">Sektor 1</div><div class="sector-time" id="s1Time">--:--.---</div><div class="sector-delta same" id="s1Delta">--</div></div>
    <div class="sector-card" id="s2Card"><div class="sector-label">Sektor 2</div><div class="sector-time" id="s2Time">--:--.---</div><div class="sector-delta same" id="s2Delta">--</div></div>
    <div class="sector-card" id="s3Card"><div class="sector-label">Sektor 3</div><div class="sector-time" id="s3Time">--:--.---</div><div class="sector-delta same" id="s3Delta">--</div></div>
  </div>
```

`new_string` wraps both in `pw-strip-delta-sectors` (IDs and inner classes preserved exactly):

```html
  <!-- Delta + Sektor strip -->
  <div class="pw-strip-delta-sectors">
    <div class="delta-banner hidden" id="deltaBanner">
      <span class="delta-label">Δ Live-Delta</span>
      <span class="delta-time same" id="deltaTime">+0.000s</span>
      <span class="delta-ref" id="deltaRef">vs. beste Runde</span>
    </div>
    <div class="sector-panel" id="sectorPanel" style="display:none">
      <div class="sector-card" id="s1Card"><div class="sector-label">Sektor 1</div><div class="sector-time" id="s1Time">--:--.---</div><div class="sector-delta same" id="s1Delta">--</div></div>
      <div class="sector-card" id="s2Card"><div class="sector-label">Sektor 2</div><div class="sector-time" id="s2Time">--:--.---</div><div class="sector-delta same" id="s2Delta">--</div></div>
      <div class="sector-card" id="s3Card"><div class="sector-label">Sektor 3</div><div class="sector-time" id="s3Time">--:--.---</div><div class="sector-delta same" id="s3Delta">--</div></div>
    </div>
  </div>
```

- [ ] **Step 5: Verify the restructure**

Run Grep `pw-hero pw-hero--compact` in `RasiCross_Telemetry.html` — exactly **1** match.
Run Grep `pw-strip-delta-sectors` in `RasiCross_Telemetry.html` — at least **6** matches (5 CSS rules + 1 DOM use).
Run Grep `id="deltaBanner"`, `id="sectorPanel"`, `id="s1Card"`, `id="s2Card"`, `id="s3Card"` — each exactly **1** match.
Run Grep `Echtzeit-Telemetrie vom Kart` in `RasiCross_Telemetry.html` — exactly **0** matches (subtitle was removed).

- [ ] **Step 6: Run the verification recipe**

Same as Task 1 Step 4. All must pass.

- [ ] **Step 7: Commit**

```bash
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" add RasiCross_Telemetry.html
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" commit -m "$(cat <<'EOF'
feat(dashboard): compact Live hero + combined delta/sektor strip

Applies pw-hero--compact to the Live hero (single-line title, no subtitle,
tight padding) and wraps deltaBanner + sectorPanel in pw-strip-delta-sectors
so they occupy one row instead of two. All element IDs (deltaBanner,
deltaTime, deltaRef, sectorPanel, s1Card/Time/Delta, s2*, s3*) preserved.
Together with Task 3 this brings the Live tab to ~796px height — fits on
1440x900 without vertical scrolling.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Wire the Detail-hero chip values in `rasicross.js`

**Files:**
- Modify: `rasicross.js` — add four `setText` calls inside `updateLiveUi` (function starts near line 2272 and ends near line 2321).

Source values:
- `detailHeroLapCurrent` ← the same value the existing `kLap` KPI shows. Look for where `kLap` is updated; reuse the same source. Likely inside `updateLiveKPIs` or `updateLiveUi` — read the function to confirm.
- `detailHeroLapBest` ← same source as `kLapBest`.
- `detailHeroStintCount` ← `r && r.stints ? r.stints.length : 0` (where `r` is the active race already in scope inside `updateLiveUi`).
- `detailHeroPackets` ← same source as `packetsText`: `state.connection.packets`.

- [ ] **Step 1: Read the `updateLiveUi` body to find the safe insertion point**

Read `rasicross.js` around line 2270–2325. The function ends with `// Pit-wall` / `updatePitWall();` followed by a `} catch (e) { console.warn('updateLiveUi:', e); }`. Locate the existing line `setText('packetsText', state.connection.packets);` — we will append the four new chip updates immediately after it (still inside the `try` block).

- [ ] **Step 2: Also locate where `kLap` and `kLapBest` are set**

Run Grep `setText\('kLap'` and Grep `setText\('kLapBest'` in `rasicross.js`. Capture the exact source expressions used. Use the identical expressions for the Detail chips so the two views never drift.

If `kLap`/`kLapBest` are set elsewhere (e.g. in `updateLiveKPIs`), copy the source expressions and reuse them in the new `setText` calls below.

- [ ] **Step 3: Insert the 4 new setText calls inside `updateLiveUi`**

Edit `rasicross.js`. `old_string`:

```javascript
    setText('packetsText', state.connection.packets);
    // Live delta
    updateLiveDelta();
```

`new_string` (replace `<SAME_EXPR_AS_kLap>` and `<SAME_EXPR_AS_kLapBest>` with the literal expressions captured in Step 2; do not invent new logic):

```javascript
    setText('packetsText', state.connection.packets);
    // Detail-tab hero chips (mirrors Live values)
    setText('detailHeroLapCurrent', <SAME_EXPR_AS_kLap>);
    setText('detailHeroLapBest', <SAME_EXPR_AS_kLapBest>);
    setText('detailHeroStintCount', String(r && r.stints ? r.stints.length : 0));
    setText('detailHeroPackets', state.connection.packets);
    // Live delta
    updateLiveDelta();
```

**Important:** if `kLap`/`kLapBest` are not set inside `updateLiveUi`'s scope (i.e. the variable `r` is not relevant for them), then read their source function directly and mirror the same `setText` calls there too — placing each Detail chip update immediately after the corresponding Live KPI `setText`. The principle: every Detail chip is updated wherever its Live source is updated, with the exact same value expression.

- [ ] **Step 4: Verify**

Run Grep `detailHeroLapCurrent` in `rasicross.js` — at least **1** match.
Run Grep `detailHeroLapBest` in `rasicross.js` — at least **1** match.
Run Grep `detailHeroStintCount` in `rasicross.js` — exactly **1** match.
Run Grep `detailHeroPackets` in `rasicross.js` — exactly **1** match.
Run Grep `<SAME_EXPR_AS_` in `rasicross.js` — exactly **0** matches (no leftover placeholders).

- [ ] **Step 5: Run the verification recipe**

```bash
node --check rasicross.js
node --check main.js && node --check preload.js && node --check geo.js && node --check replay.js && node --check karts3d.js
node --test
npm run lint
```

All must pass.

- [ ] **Step 6: Commit**

```bash
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" add rasicross.js
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" commit -m "$(cat <<'EOF'
feat(dashboard): populate Detail-tab hero chips from Live update path

Adds four setText calls so the Detail-tab hero shows Aktive Runde, Beste
Runde, Stints-Anzahl, Pakete — each mirrored from the existing Live source
expressions (no new logic, no new computation). Renders correctly even when
Detail is not the active tab, since updateLiveUi runs on a 1s setInterval
independent of which tab is visible.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Manual acceptance + plan-doc commit

**Files:**
- Add: `docs/superpowers/plans/2026-05-23-15-live-tab-no-scroll-detail.md` (this file).

- [ ] **Step 1: Run the full verification recipe one last time**

```bash
node --check rasicross.js
node --check main.js && node --check preload.js && node --check geo.js && node --check replay.js && node --check karts3d.js
node --test
npm run lint
```

Optional (skip if Python is not in PATH):

```bash
python -m py_compile bridge.py esp_libs/calc.py esp_libs/frame.py esp_libs/micropyGPS.py esp_libs/oled_diagnose.py esp_libs/ssd1306.py
python -m unittest discover -s test -p "test_*.py"
```

Delete any `__pycache__/` directories before `git status`.

- [ ] **Step 2: Manual dashboard smoke** (defer to user; see Manual Acceptance Checklist below). Document the smoke result in the commit body if there were any issues.

- [ ] **Step 3: Commit the plan doc**

```bash
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" add docs/superpowers/plans/2026-05-23-15-live-tab-no-scroll-detail.md
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" commit -m "$(cat <<'EOF'
docs: Live-tab no-scroll + Detail-tab implementation plan

Captures the 6-task plan (CSS, Detail shell, content move, Live restructure,
JS wiring, acceptance) that implements the design spec at
docs/superpowers/specs/2026-05-23-live-tab-no-scroll-detail-design.md.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Manual Acceptance Checklist (defer to user)

- [ ] On 1440×900, the **Live** tab shows the full page (hero, race-control bar, 5 KPIs, delta+sektor strip, map+tacho row) **without any vertical scrollbar**.
- [ ] The 5 KPIs (`kSpeed`, `kRpm`, `kG`, `kLap`, `kBatt` — Batt only when the battery card is unhidden) update live during a session.
- [ ] The delta banner and the 3 sektor cards sit in **one row** and update correctly when crossing sector gates.
- [ ] The Streckenkarte and Tacho/G-Meter render and update live; the 2D/3D toggle still works.
- [ ] The sidebar shows a new **Detail** button in the Cockpit group, between Live and Rennen, with the chart icon.
- [ ] Clicking **Detail** switches to the Detail tab; clicking **Live** switches back. No console errors.
- [ ] The Detail tab shows: hero (with Aktive Runde / Beste Runde / Stints / Pakete chips), the two history charts (Speed/RPM and G-Kraft), the Stints list, and the Letzte-Runden table — all updating live.
- [ ] Switching to Detail mid-race shows the current (not stale) values for charts, stints, and laps.
- [ ] No CSP violations or other console errors during a full race cycle (start → laps → end → reset).
- [ ] Strecke, Rennen, Fahrer, Verbindung, Einstellungen tabs are visually **unchanged** (the new CSS is scoped or namespaced).

---

## Self-Review

**Spec coverage** (cross-reference `docs/superpowers/specs/2026-05-23-live-tab-no-scroll-detail-design.md`):

| Spec section | Covered by |
|---|---|
| §3 In scope — compact rebuild of `#tab-live` | Task 1 (CSS) + Task 4 (DOM) |
| §3 In scope — move charts/Stints/Lap-table to Detail | Task 3 |
| §3 In scope — new sidebar `Detail` entry | Task 2 |
| §3 In scope — minimal `pw-*` CSS additions | Task 1 |
| §3 In scope — JS wiring (tab-switcher + Detail hero chips) | Task 5 (chips); tab-switcher needs **no change** per pre-plan verification, called out in Architecture section above |
| §3 Out of scope — Diagnose section | Not built (YAGNI honored) |
| §4.1 Vertical budget — compact hero ≤64px, KPI ≤110px, etc. | Task 1 CSS (`pw-hero--compact`, scoped `#tab-live .kpi`) + Task 4 (subtitle dropped) |
| §4.2 Hero compact, delta+sektor combined, KPI tightening | Tasks 1 + 4 |
| §4.2 Charts/Stints/Laps removed from Live | Task 3 |
| §4.3 New `<section id="tab-detail">` + sidebar nav | Task 2 |
| §4.3 Detail layout: hero + Verlauf + Stints + Letzte Runden | Tasks 2 (slots) + 3 (content) |
| §4.4 4 new Detail-hero IDs populated by `updateLiveUi` | Task 5 |
| §4.4 Render-on-hidden risk | Resolved by pre-plan verification (animLoop + setInterval are tab-independent; drawChart self-resizes per frame) — no code change needed; documented in Architecture |
| §4.5 CSS additions: `pw-hero--compact`, `pw-strip-delta-sectors`, scoped `#tab-live` overrides | Task 1 |
| §5 ID preservation | Tasks 2–5 all assert exact-count Grep on every moved ID |
| §6 Static checks + tests stay green | Verification recipe at end of every task |
| §6 Manual acceptance | Checklist above (deferred to user, Task 6) |

**Placeholder scan:** Searched for `TBD`, `TODO`, `placeholder`, `implement later`, `appropriate`. The only "placeholders" are the two `<SAME_EXPR_AS_kLap>` / `<SAME_EXPR_AS_kLapBest>` strings in Task 5 Step 3 — these are explicitly defined by Step 2 of the same task (read the existing source expressions and copy them verbatim), and Step 4 includes a Grep assertion that no `<SAME_EXPR_AS_` substring remains in the committed file. This is a "read first, then copy" instruction, not a hand-wave.

**Type / name consistency:**
- `pw-hero--compact` — used identically in Task 1 (CSS definition) and Task 4 (DOM application).
- `pw-strip-delta-sectors` — used identically in Task 1 and Task 4.
- `detailHeroLapCurrent`, `detailHeroLapBest`, `detailHeroStintCount`, `detailHeroPackets` — defined in Task 2 (DOM IDs) and consumed in Task 5 (setText keys). Spelled the same in both places.
- `detailVerlaufSlot`, `detailStintsSlot`, `detailLapsSlot` — defined in Task 2 (DOM IDs) and replaced in Task 3 (Edit anchors). Spelled the same.
- `srCanvas`, `gCanvas`, `stintsList`, `currentDriverName`, `lapTable`, `lapTableBody` — moved verbatim in Task 3; the moved blocks are identical character-for-character to the originals captured in Steps 1 / 3.

Plan is internally consistent and the spec is fully covered.
