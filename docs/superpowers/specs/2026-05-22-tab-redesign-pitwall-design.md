# RasiCross — Pit-Wall Redesign of the Live, Rennen & Fahrer Tabs

**Date:** 2026-05-22
**Status:** Approved (design); pending implementation plan
**Author:** Brainstorming session (Claude + user)

---

## 1. Purpose

The Strecken tab (`#tab-track`) was rebuilt with a polished "Pit Wall" design
system (`pw-*` classes): a hero header, a telemetry strip, modules, refined
buttons and empty states. The **Live**, **Rennen** and **Fahrer** tabs still use
the older `card` / `kpi` / `fieldset` styling. This redesign brings all three
tabs onto the Pit-Wall design language for visual and structural consistency.

It is a **presentation change** — no telemetry, race-logic, lap/sector or
protocol behaviour changes. The one structural change: the Rennen and Fahrer
create-forms move out of inline cards into **pop-up modals** opened by a
"+ Neu" button.

## 2. Background / grounding facts

- **Pit-Wall design system** (defined in the `<style>` block, used by
  `#tab-track`): `pw-hero` (`pw-eyebrow` + dot, `pw-hero-title` +
  `pw-hero-accent`, `pw-hero-sub`, `pw-hero-telemetry` of `pw-tel` chips with
  `pw-tel-label` / `pw-tel-value` / `pw-tel-foot` / `pw-tel-bar`), `pw-deck`,
  `pw-module` (`pw-mod-head` / `pw-mod-title` / `pw-mod-tag` / `pw-mod-action`),
  `pw-btn` (`primary` / `ghost` / `block`), `pw-cluster` + `pw-inline-input`,
  `pw-library` (`pw-lib-head` / `pw-lib-title` / `pw-lib-bar` / `pw-lib-count` /
  `pw-lib-empty`). `pw-workflow` / `pw-flow-step` is the recording workflow
  strip — specific to Strecken, **not** reused elsewhere.
- **Existing modal pattern:** `.overlay` (fixed backdrop, shown by adding the
  `.show` class) containing a `.dialog` (with `.dialog-btns`). Used today by
  `#editorOverlay`, `#driverModal`, `#rcAlertOverlay`. The new create-form
  pop-ups reuse this exact pattern.
- **Current tab structure:**
  - `#tab-live`: a race-control bar (`#countdown`, `#raceMeta`, `#startRaceBtn`,
    `#changeDriverBtn`, `#pitCallBtn`, `#oledPageSelect`, `#endRaceBtn`), a KPI
    row (`kpi` cards with value IDs `kSpeed`/`kRpm`/`kG`/`kLap`/`kBatt` and
    sub-IDs `kSpeedMax`, `spdSrcTag`, `kRpmMax`, `kGMax`, `kYaw`, `kMtemp`,
    `yawSparkCanvas`, `kLapBest`, `kBattSub`, `kpiBatt`), `#deltaBanner`,
    `#sectorPanel` (+ sector-card IDs), map/tacho cards (`#trackCanvas`,
    `#heatmapBtn`, tacho SVG, `#gViewToggle`, `#gMeterCanvas`,
    `#gMeter3dCanvas`), chart cards (`#srCanvas`, `#gCanvas`), `#stintsList`,
    `#lapTable`/`#lapTableBody`.
  - `#tab-races`: a "Neues Rennen" form card (`#newRaceName`, `#newRaceTrack`,
    `#newRaceLengthType`, `#newRaceDuration`, `#newRaceLapsField`/`#newRaceLaps`,
    `#newRaceDriver`, `#createRaceBtn`) and an "Alle Rennen" list card
    (`#raceList`, `#raceListCount`).
  - `#tab-drivers`: a `total-hero` block (`#totalDistance`, `#totalStatsGrid`),
    a "Neuer Fahrer" form card (`#newDriverName`, `#newDriverNumber`,
    `#newDriverColor`, `#addDriverBtn`), and a driver-stats list card
    (`#driverStatsList`, `#driverCount`).
- All event handlers are wired in `rasicross.js` via `addEventListener` / `.onclick`
  — the page runs under a strict CSP, so no inline handlers. Render functions
  write into the element IDs above.
- **Critical coupling:** `rasicross.js` reads and writes these tabs by element
  ID. The redesign must preserve every ID that JS touches, or update JS in
  lockstep.

## 3. Scope

### In scope

- Restructure and restyle `#tab-live`, `#tab-races`, `#tab-drivers` onto the
  `pw-*` design system (hero header + telemetry strip + modules/library).
- Move the Rennen and Fahrer create-forms into reusable `.overlay` / `.dialog`
  modals, opened by a "+ Neu" button in the library header.
- Extend the `pw-*` CSS with the few new variants the three tabs need (Live KPI
  cards, the Live race-control cluster, modal-hosted forms).

### Out of scope

- Any change to telemetry handling, race / lap / sector logic, the Strecken /
  Verbindung / Settings tabs, ESP firmware, the bridge, or the data protocol.
- New features. (The Start/Pause toggle is separate work on branch
  `feat/race-run-toggle`.)

## 4. Detailed design

### 4.1 Shared — hero header + create-form modal

- Each tab gains a `pw-hero` header: eyebrow + dot, big title with the `.`
  accent, a subtitle, and a `pw-hero-telemetry` strip of `pw-tel` chips. No
  `pw-workflow` strip (that is Strecken-specific).
- The Rennen/Fahrer create-forms use new `.overlay` + `.dialog` modals
  (`#newRaceModal`, `#newDriverModal`). A `pw-btn primary` "+ Neu…" button opens
  the modal (adds `.show`); an X, a Cancel button and a backdrop click close it
  — mirroring the existing `#driverModal` wiring. **Form fields keep their
  current IDs**, so the existing create/validation JS is unchanged; only the
  modal open/close handlers are new.

### 4.2 Rennen (`#tab-races`)

- Hero: eyebrow "RENNVERWALTUNG", title "Rennen.", telemetry strip — Aktives
  Rennen / Rennen gesamt / Status.
- A full-width `pw-library`: `pw-lib-head` with "Bibliothek", a count, and a
  right-aligned "+ Neues Rennen" `pw-btn primary`. Body = the existing race list
  (`#raceList`), with a `pw-lib-empty` empty state when there are no races.
- The "Neues Rennen" form moves verbatim (same fields and IDs, same
  `#createRaceBtn`) into `#newRaceModal`.

### 4.3 Fahrer (`#tab-drivers`)

- Hero: eyebrow "FAHRER & STATISTIK", title "Fahrer.", telemetry strip — Strecke
  gesamt (the current `#totalDistance`), Fahrer-Anzahl, Rennen gesamt, beste
  Runde. The old `total-hero` block is removed: `#totalDistance` becomes the
  value of the first `pw-tel` chip, and `#totalStatsGrid` is kept (ID preserved)
  and relocated as a restyled secondary stat row directly under the hero — so
  the existing totals JS keeps working unchanged.
- A full-width `pw-library` with a "+ Neuer Fahrer" button; body =
  `#driverStatsList` with a `pw-lib-empty` empty state.
- The "Neuer Fahrer" form moves into `#newDriverModal` (same fields/IDs,
  same `#addDriverBtn`).

### 4.4 Live (`#tab-live`)

- Hero: eyebrow "LIVE-TELEMETRIE", title = the active race name (JS-set; a
  neutral "Live." when no race is active), subtitle = driver / format.
  Telemetry strip — Countdown (`#countdown`), Status (`#raceMeta`), GPS, Funk
  (RSSI).
- A race-control **cluster** below the hero (a `pw-cluster`-style strip) holding
  the existing controls — `#startRaceBtn`, `#changeDriverBtn`, `#pitCallBtn`,
  `#oledPageSelect`, `#endRaceBtn` — restyled as `pw-btn`s. All IDs and
  behaviour unchanged.
- The KPI row (Speed / RPM / G-Kraft / Aktuelle Runde / Batterie) is restyled to
  the pw aesthetic; every value ID is kept.
- `#deltaBanner` and `#sectorPanel` are restyled, IDs kept.
- The content cards (Streckenkarte, Tacho, the two Verlauf charts, Stints,
  Letzte Runden) become `pw-module`s; every canvas / table / list ID is kept.

## 5. Backward compatibility / risks

- Pure dashboard presentation change; no protocol / ESP / bridge impact;
  `localStorage` schema unchanged.
- **Main risk — JS / ID coupling.** Mitigation: preserve every element ID that
  `rasicross.js` reads or writes. New JS is limited to (a) the modal open/close
  wiring for the two create-forms, and (b) populating the Live hero — setting
  its title to the active race name and filling the telemetry chips — hooked
  into the existing render/update cycle. Each tab's implementation task ends by
  confirming its render path still works.
- **CSP:** no inline handlers or `<script>` are introduced; new CSS is allowed
  (the CSP permits inline styles).
- **Sequencing:** the redesign overlaps the Live tab and `rasicross.js` with the
  `feat/race-run-toggle` branch. Implement this redesign after that branch
  merges, or branch from it, to avoid a `rasicross.js` conflict.

## 6. Testing strategy

- **No new unit tests** — HTML/CSS and DOM-wiring code is not unit-tested in
  this project (only the pure `geo.js` / `replay.js` / `karts3d.js` cores are).
  The existing 36 JS + 34 Python tests must stay green.
- Static checks: `node --check rasicross.js`, `npm run lint` (ESLint clean),
  `npm test`.
- Manual visual acceptance, per tab: the hero + telemetry strip render; "+ Neu"
  opens and closes the modal; creating from the modal still creates a
  race/driver; the library list and its empty state render; the Live KPIs,
  charts, map and tables still update live; no CSP violations in the devtools
  console.

## 7. Sequencing

One spec, one implementation plan with a task per tab — **Rennen**, then
**Fahrer**, then **Live** (increasing complexity) — plus the shared CSS
additions. Each task is independently shippable and ends green on the checks
above.
