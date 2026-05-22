# RasiCross — Live-Tab No-Scroll Layout + neuer Detail-Tab

**Date:** 2026-05-23
**Status:** Approved (design); pending implementation plan
**Author:** Brainstorming session (Claude + user)

---

## 1. Purpose

The **Live** tab (`#tab-live`) was recently rebuilt onto the Pit-Wall design
system (commit `7087a52`). It still contains every Live-related module on a
single long page: Race-Control + KPIs + Delta/Sektor + Map + Tacho + two history
charts + Stints + a lap table. On a 1440×900 pit-wall laptop, the page scrolls.

This redesign **fits all rennrelevant Live data on one screen without scrolling**
on a 1440×900 viewport, and moves the analysis / historical content into a new
**Detail** tab reachable from the sidebar.

It is a **presentation / restructuring change** — no telemetry, race-logic,
lap/sector or protocol behaviour changes.

## 2. Background / grounding facts

- The current `#tab-live` (HTML lines 2057–2263) stacks: compact `pw-hero` (with
  `liveHeroTitle`, `countdown`, `raceMeta`, `gpsStatus`), `pw-livebar`
  race-control cluster (`startRaceBtn`, `changeDriverBtn`, `pitCallBtn`,
  `oledPageSelect`, `endRaceBtn`), a 5-card KPI row
  (`kSpeed`/`kRpm`/`kG`/`kLap`/`kpiBatt`), `deltaBanner`, `sectorPanel`,
  a 2:1 grid with `pw-module` Streckenkarte (`trackCanvas`, `heatmapBtn`,
  `latText`/`lonText`/`trackPoints`/`packetsText`) and `pw-module` Tacho
  (`speedArc`/`speedDial`/`rpmFill`/`rpmScale`/`gViewToggle`/`gMeterCanvas`/
  `gMeter3dCanvas`/`gxText`/`gyText`), a g2-grid with two charts (`srCanvas`,
  `gCanvas`), and a final g2-grid with Stints (`stintsList`,
  `currentDriverName`) and Letzte Runden (`lapTable`/`lapTableBody`).
- Sidebar navigation (HTML lines ~1978–2008) groups tabs as **Cockpit** (Live /
  Rennen / Fahrer) and **Setup** (Strecke / Verbindung / Einstellungen). Each
  nav button has `data-tab="<id>"` and is wired by the tab-switcher in
  `rasicross.js` via `addEventListener` (no inline handlers, strict CSP).
- Pit-Wall design system (`pw-*`) is established and reused — hero, modules,
  buttons, cluster, library. No new design vocabulary is introduced; this work
  adds one **compact** hero variant and one combined delta+sektor strip.
- **Critical coupling:** `rasicross.js` reads/writes the tabs by element ID.
  Every existing ID must be preserved when DOM is moved between tabs.

## 3. Scope

### In scope

- Compact-rebuild `#tab-live` so it fits on a 1440×900 viewport without vertical
  scrolling (Approach A — *Klassischer Stack*).
- Move the two history charts, Stints, and the lap table out of `#tab-live`
  into a new `#tab-detail` section.
- Add a new sidebar entry `Detail` in the Cockpit group, directly under `Live`.
- Add the minimal `pw-*` CSS variants the new layout needs (compact hero,
  combined delta+sektor strip, slimmer KPI sizing scoped to `#tab-live`).
- Wire the new tab into the existing `rasicross.js` tab-switcher; add a few
  IDs/lines to populate the Detail hero telemetry chips.

### Out of scope

- Telemetry pipeline, race / lap / sector logic, ESP firmware, bridge, protocol.
- The Strecke, Verbindung, Einstellungen, Rennen, Fahrer tabs.
- A separate Diagnose-section in the Detail tab (YAGNI — the diagnostic values
  remain visible as KPI/Map subs on Live as today).
- New features. (Pause/Resume etc. live in their own branches.)

## 4. Detailed design

### 4.1 Live tab — vertical budget (1440×900)

Available vertical space: 900px − ~52px topbar − ~48px content padding ≈ 800px.

| Block | Height |
|---|---|
| Compact hero (eyebrow + title inline + 3 telemetry chips right) | ~64px |
| Race-Control cluster (Start · Wechsel · BOX · OLED-Select · Ende) | ~52px |
| KPI row (5 cards: Speed · RPM · G · Runde · Batt) | ~110px |
| Delta + Sektor strip (one row, delta chip left + 3 sector cards right) | ~52px |
| Map (2/3) + Tacho/G-Meter (1/3) row | ~470px |
| Gaps (4 × 12px) | ~48px |
| **Sum** | **~796px** |

### 4.2 Live tab — structural changes

- Hero adopts a new `pw-hero--compact` modifier (Live-only): single-line title,
  no subtitle text node, reduced vertical padding. The three telemetry chips
  (`countdown`, `raceMeta`, `gpsStatus`) stay.
- `delta-banner` (`#deltaBanner`) and `sector-panel` (`#sectorPanel`) are
  wrapped in a new `pw-strip-delta-sectors` flex row. Their inner IDs
  (`deltaTime`, `deltaRef`, `s1Card`/`s1Time`/`s1Delta`, `s2*`, `s3*`) and the
  outer IDs (`deltaBanner`, `sectorPanel`) are preserved — only the surrounding
  layout changes.
- KPI cards keep all IDs; padding and `kpi-v` font are tightened **only via
  `#tab-live .kpi`** selectors so other tabs are unaffected. `yawSparkCanvas`
  height drops 28 → 22px.
- Map + Tacho `pw-module`s are unchanged in markup; the grid stays `g-2-1`.
- The following blocks are **removed** from `#tab-live` and added to
  `#tab-detail` with their IDs intact:
  - Charts: the two `pw-module` cards containing `srCanvas` and `gCanvas`.
  - Stints: the `pw-module` containing `stintsList` and `currentDriverName`.
  - Letzte Runden: the `pw-module` containing `lapTable` / `lapTableBody`.

### 4.3 Detail tab — new section

- New `<section class="tab" id="tab-detail">` inserted directly after
  `#tab-live` in the HTML.
- New sidebar nav button in the **Cockpit** group, between `Live` and `Rennen`:
  `<button class="nav-item" data-tab="detail">…Detail</button>`. Chart-/Graph-
  style SVG icon. Wired by the existing `data-tab` tab-switcher.
- Layout (vertical scroll, normal `pw-hero` — not the compact variant):
  1. **Hero**: eyebrow `LIVE-DETAIL`, title `Detail.`, subtitle „Verlauf,
     Stints und Rundentabelle des aktiven Rennens", telemetry chips: Aktive
     Runde, Beste Runde, Stints-Anzahl, Pakete. New IDs for these chips:
     `detailHeroLapCurrent`, `detailHeroLapBest`, `detailHeroStintCount`,
     `detailHeroPackets`.
  2. **Verlauf**: g2 grid of two `pw-module`s, hosts the moved `srCanvas` and
     `gCanvas` cards verbatim.
  3. **Stints**: full-width `pw-module`, hosts the moved `stintsList` card.
  4. **Letzte Runden**: full-width `pw-module`, hosts the moved `lapTable`
     card (same column schema as today).

### 4.4 `rasicross.js` changes

- Tab-switcher gains a `detail` branch — same pattern as the existing entries
  (toggle `.tab` sections + `.nav-item` `active` class). No new mechanism.
- The render functions for `srCanvas`, `gCanvas`, `stintsList`, and
  `lapTableBody` must continue running on every update tick, even while
  `#tab-detail` is not the active tab — otherwise their content goes stale and
  the tab switch shows yesterday's data. (Today they already run unconditionally
  in the update loop; this is to be **verified** in the implementation plan, not
  assumed.)
- On the first tab-switch to `#tab-detail`, any canvas that depends on a
  `resize` measurement (chart canvases, possibly the G-meter previews if added
  later) must trigger a one-shot resize. Most likely the existing global resize
  hook handles this — to be verified.
- Detail hero chips are filled by the existing live-update loop using the four
  new IDs above (Aktive Runde from current lap timer, Beste Runde from
  `kLapBest` source, Stints-Anzahl from the stints array length, Pakete from
  the same source as `packetsText`).

### 4.5 CSS additions

Scoped, minimal:

- `pw-hero--compact` — reduces hero vertical padding, removes subtitle margin,
  single-line title.
- `pw-strip-delta-sectors` — flex row, gap, wraps `#deltaBanner` and
  `#sectorPanel` into one strip. Existing inner styling for `.delta-banner` /
  `.sector-card` is reused.
- `#tab-live .kpi { ... }` overrides — tighter padding, slightly smaller
  `kpi-v` and `kpi-sub`. `#tab-live #yawSparkCanvas { height: 22px; }`.

No new design tokens; uses existing CSS variables.

## 5. Backward compatibility / risks

- Pure dashboard presentation/restructuring change; no protocol / ESP / bridge
  impact; `localStorage` schema unchanged.
- **Main risk — ID coupling.** Mitigation: every ID that `rasicross.js` reads
  or writes is preserved; charts/stints/laps DOM is **moved**, not duplicated.
  Each task ends by confirming its render path still works.
- **Render-on-hidden risk** (4.4): verified in the plan, not assumed. If a
  render function only runs while its tab is visible, the plan adds a one-shot
  refresh on tab-switch to `#tab-detail`.
- **First-paint canvas sizing** in the Detail tab: addressed by the existing
  resize hook or a one-shot resize trigger on the first tab-switch.
- **CSP:** no inline handlers, no new `<script>`; only DOM reordering, new CSS,
  added event-listener branch in `rasicross.js`.
- **Sequencing:** branch sits on top of `feat/tab-redesign-pitwall` (already
  merged into this branch). One implementation plan, three tasks: (1) add
  `#tab-detail` section + sidebar nav entry + DOM move; (2) compact-rebuild
  `#tab-live` + new CSS; (3) JS wiring (tab-switcher branch + Detail hero chip
  fill + render-on-hidden verification).

## 6. Testing strategy

- **No new unit tests** — HTML/CSS and DOM-wiring code is not unit-tested in
  this project. The existing JS + Python test suites must stay green.
- Static checks: `node --check rasicross.js`, `npm run lint`, `npm test`,
  `pytest`.
- Manual visual acceptance:
  - Live tab on a 1440×900 viewport shows no vertical scrollbar; all five KPIs
    update live; delta + sektor strip renders and updates; map and tacho/G-meter
    update live.
  - Detail tab nav entry appears under Live; clicking it switches tabs; the two
    history charts, stints list, and lap table render and update; hero chips
    show current lap, best lap, stints count, packet count.
  - No CSP violations or console errors during a full race cycle (start →
    laps → end).
