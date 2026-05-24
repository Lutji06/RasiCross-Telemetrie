# RasiCross — Live + Detail Tabs v2 (Visual-First Live, Full-Detail Detail)

**Date:** 2026-05-24
**Status:** Approved (design); pending implementation plan
**Author:** Brainstorming session (Claude + user)
**Supersedes:** `docs/superpowers/specs/2026-05-23-live-tab-no-scroll-detail-design.md`

---

## 1. Purpose

The previous redesign (2026-05-23 spec, plan 15) split `#tab-live` and added
`#tab-detail`, but kept Live "data-dense" — 5 KPI cards, delta banner, the
Tacho/G module — and pushed only the long-history blocks to Detail. After
running it on the pit-wall the user wants a **stronger visual hierarchy**:

- **Live** = only the things that matter at a glance during a stint, shown big:
  Karte, Rundenzeit, Sektorzeiten, Rest-Rennzeit, Speed/RPM, G-Meter or 3D Kart.
- **Detail** = everything else, including raw diagnostics, so the pit crew can
  drill in when needed without crowding Live.

This is a **presentation / restructuring change**. No telemetry, race-logic,
lap/sector, protocol, ESP-firmware or bridge behaviour changes.

## 2. Background / grounding facts

- Current Live (`#tab-live`, HTML `RasiCross_Telemetry.html:2100`) after the
  2026-05-23 implementation already contains: compact hero (`liveHeroTitle`,
  `countdown`, `raceMeta`, `gpsStatus`), Race-Control cluster (`startRaceBtn`,
  `changeDriverBtn`, `pitCallBtn`, `oledPageSelect`, `endRaceBtn`), 5-card KPI
  row (`kSpeed`, `kRpm`, `kG`, `kLap`, `kpiBatt`), `deltaBanner` + `sectorPanel`
  combined strip, a 2:1 grid with `trackCanvas` map and the Tacho/G `pw-module`
  (`speedArc`/`speedDial`/`rpmFill`/`rpmScale`/`gViewToggle`/`gMeterCanvas`/
  `gMeter3dCanvas`/`gxText`/`gyText`).
- Current Detail (`#tab-detail`, HTML line 2278) already exists with its hero
  (`detailHeroLapCurrent`, `detailHeroLapBest`, `detailHeroStintCount`,
  `detailHeroPackets`), the two history charts (`srCanvas`, `gCanvas`), Stints
  (`stintsList`, `currentDriverName`) and the lap table (`lapTable`,
  `lapTableBody`).
- Sidebar navigation already has a `Detail` entry under `Live` in the Cockpit
  group, wired by the existing `data-tab` tab-switcher in `rasicross.js`.
- Pit-Wall design system (`pw-*`) is reused. The 2026-05-23 spec added
  `pw-hero--compact`, `pw-strip-delta-sectors` and `#tab-live`-scoped KPI
  overrides — those continue to be used (kept or repurposed).
- **Critical coupling:** `rasicross.js` reads/writes elements by ID. Every
  existing ID must be preserved when DOM is moved between tabs. IDs duplicated
  across Live and Detail get a suffix to keep them unique (see §4.6).

## 3. Scope

### In scope

- Re-layout `#tab-live` to a fixed-screen (1440×900) two-column body:
  Karte left 2/3, vertical stack right 1/3 (Speed/RPM · Rundenzeit · Sektoren ·
  G/3D-Toggle).
- Move the Speed/RPM/G/Batt KPI cards, `deltaBanner`, and the Speed-Dial /
  RPM-Bar half of the Tacho module out of `#tab-live` into `#tab-detail`.
- Keep `gViewToggle` + `gMeterCanvas` + `gMeter3dCanvas` on Live as their
  own compact card (the 3D Kart visualisation stays on Live).
- Add a **Diagnose** `pw-module` to `#tab-detail` showing the raw values that
  are currently visible on Live (Speed-source, GPS coordinates, packet counts,
  IMU axes, MPU temperature, battery V / SoC, link RSSI if available).
- Add the minimal `pw-*` CSS variants the new Live layout needs (right-column
  stack, big Rundenzeit card, horizontal-3-card Sektoren strip, small Speed/RPM
  combo card).
- Wire the rendered values for the duplicated DOM IDs in `rasicross.js` —
  every existing setter writes to both the Live and the Detail copy.

### Out of scope

- Telemetry pipeline, race / lap / sector logic, ESP firmware, bridge, protocol.
- The Strecke, Verbindung, Einstellungen, Rennen, Fahrer tabs.
- New features (Pause/Resume, replay, etc. live in their own branches).
- Removing the old 2026-05-23 spec file (it stays in git history as the prior
  step; this spec supersedes it).

## 4. Detailed design

### 4.1 Live tab — vertical budget (1440×900)

Available vertical space: 900px − ~52px topbar − ~48px content padding ≈ 800px.

| Block | Height |
|---|---|
| Compact hero (eyebrow + title inline + 3 chips right) | ~60px |
| Race-Control cluster | ~46px |
| Hauptbereich (Karte left + right stack) | ~660px |
| Gaps (3 × ~12px) | ~36px |
| **Sum** | **~802px** |

Right-column vertical sub-budget inside the 660px Hauptbereich:

| Right-column block | Height |
|---|---|
| Speed + RPM combo card (single `pw-module` with 2 KPI values side-by-side) | ~80px |
| Rundenzeit card (big digital time + best-lap sub) | ~100px |
| Sektoren strip (3 horizontal `sector-card`s inside one `pw-module`) | ~80px |
| G-Meter / 3D Kart card (toggle + canvas) | ~380px |
| Gaps (3 × ~12px = 36px reserved within the parent grid) | — |
| **Sum** | **~640px** (fits inside 660 with ~20px slack for borders) |

### 4.2 Live tab — structural changes

The 2026-05-23 layout (hero → race-control → KPI row → delta+sektor strip →
g-2-1 with Map and Tacho) is replaced by:

1. **Hero** — unchanged (`pw-hero--compact`, chips `countdown` `raceMeta`
   `gpsStatus`).
2. **Race-Control cluster** — unchanged (existing IDs).
3. **`pw-live-body`** — new flex/grid wrapper, two children:
   - `pw-live-map` (2/3 width): existing `pw-module` containing `trackCanvas`
     and its subs (`latText`, `lonText`, `trackPoints`, `packetsText`,
     `heatmapBtn`). Module height fills the row (~660px).
   - `pw-live-side` (1/3 width): vertical stack of four `pw-module`s in this
     order:
     1. **Speed/RPM combo** — single `pw-module` with title "Speed · RPM",
        two `kpi-v` side-by-side: `#kSpeed` (km/h) and `#kRpm` (with
        `kSpeedMax`/`kRpmMax`/`spdSrcTag` kept as sub-text below).
     2. **Rundenzeit** — `pw-module` with a single very-large lap-time
        readout. Reuses the existing `kLap` source. New IDs:
        `#liveLapBig` (current), `#liveLapBest` (sub).
     3. **Sektoren** — existing `#sectorPanel` (its 3 `sector-card`s
        unchanged, just inside a new flex row that places them horizontally).
     4. **G-Meter / 3D Kart** — existing `gViewToggle`/`gMeterCanvas`/
        `gMeter3dCanvas` block (kept; `gxText`/`gyText` sub stays).

### 4.3 Elements removed from Live

- **Tacho half** of the existing Tacho/G module — `speedArc`, `speedDial`,
  `rpmFill`, `rpmScale` are **deleted entirely**. They are pure visualisations
  of `kSpeed`/`kRpm`, which Detail already shows numerically in the KPI-Strip
  and Live shows numerically in the new combo card; the SVG dial adds no
  information. (The G/3D toggle and `gMeterCanvas`/`gMeter3dCanvas` stay on
  Live as their own card.)
- **Existing 5-KPI row** — its DOM is removed from `#tab-live` and reinstated
  on `#tab-detail` as the **KPI-Strip** (§4.4). IDs `kSpeed` / `kRpm` cannot be
  duplicated, so the Live combo card uses suffixed IDs (`kSpeedLive`,
  `kRpmLive`) and `rasicross.js` writes to both. See §4.6.
- **`deltaBanner`** — moved to Detail's KPI-Strip area as a wide chip.

### 4.4 Detail tab — additions

The current `#tab-detail` (hero + history charts + stints + lap table) gets
**three new blocks** prepended/appended around the existing content:

1. **KPI-Strip** (inserted directly after the Detail hero):
   - The full 5-KPI row that previously lived on Live: `kSpeed`, `kRpm`, `kG`,
     `kLap`, `kpiBatt` (with all subs).
   - The wide `deltaBanner` strip immediately below the KPI row (same DOM as
     today, just relocated).
2. **Verlauf** — unchanged (existing `srCanvas` + `gCanvas` 2-col grid).
3. **Stints** — unchanged.
4. **Letzte Runden** — unchanged (`lapTable`/`lapTableBody`).
5. **Diagnose** (new `pw-module`, appended after Letzte Runden):
   - GPS: lat, lon, satellites, fix health (reuses `latText`, `lonText`,
     `gpsStatus`-source via new spans `diagGpsLat`, `diagGpsLon`, `diagGpsSat`,
     `diagGpsHealth`).
   - Pakete: total received, lost count, packet rate (reuses `trackPoints`/
     `packetsText` source via new IDs `diagPackets`, `diagLost`, `diagRate`).
   - IMU: `gxText`/`gyText` source, plus `az`, `yaw` and `mpu_temp` from
     telemetry (`diagGx`, `diagGy`, `diagAz`, `diagYaw`, `diagMpuTemp`).
   - Akku: vbat, SoC, batt_warn (reuses `kpiBatt` source via `diagVbat`,
     `diagSoc`, `diagBattWarn`).
   - Sender-Status: `send_ms`, `spd_src`, `imu_cal`, plus link RSSI from
     the bridge JSON (bridge adds `rssi` from ESP-NOW `recv()` metadata —
     see `docs/superpowers/specs/2026-05-19-binary-protocol-design.md`):
     `diagSendMs`, `diagSpdSrc`, `diagImuCal`, `diagRssi`.
   - Layout: 2-column grid of small label/value rows. No live charts.

### 4.5 `rasicross.js` changes

- All existing `getElementById` reads stay valid (IDs unchanged for the moved
  DOM).
- **Setter fan-out:** the small number of values shown on BOTH tabs (Speed,
  RPM, lap time, best lap, sectors implicit via shared `sectorPanel`) get a
  helper that writes to all known DOM IDs. Pattern: a small map of
  `{logicalKey: [domId1, domId2]}` resolved once at startup.
- **New Diagnose-setters:** one `updateDiagnostics(packet)` call inside the
  existing per-packet update path that writes the new `diag*` spans. Reads
  only fields already in the telemetry packet — no new packet fields, no
  new bridge logic.
- **Render-on-hidden:** verified by 2026-05-23 plan that chart/stints/lap-
  table renderers run unconditional in the update loop. The new Detail
  KPI-Strip and Diagnose block follow the same pattern — they update every
  tick, not on tab-switch.
- **First-paint canvas sizing:** the existing one-shot resize hook on
  tab-switch to `#tab-detail` continues to handle `srCanvas`/`gCanvas`. No
  new resize logic — Live's `trackCanvas` and G-canvases already resize via
  the global resize hook, and the deleted `speedArc` was SVG (auto-scales).

### 4.6 ID-duplication policy

DOM IDs are unique per document. Where a value must appear on both Live and
Detail, the Live copy gets a `Live` suffix:

| Logical value | Detail (original) | Live (new) |
|---|---|---|
| Speed value | `kSpeed` | `kSpeedLive` |
| Speed max sub | `kSpeedMax` | `kSpeedMaxLive` |
| Speed source tag | `spdSrcTag` | `spdSrcTagLive` |
| RPM value | `kRpm` | `kRpmLive` |
| RPM max sub | `kRpmMax` | `kRpmMaxLive` |
| Current lap time (big) | `kLap` | `liveLapBig` |
| Best lap (sub) | `kLapBest` | `liveLapBest` |

`#sectorPanel` and its inner `s1Card`/`s1Time`/… stay unique (only on Live).
`#deltaBanner` stays unique (only on Detail after the move).
`#trackCanvas` and the G/3D canvases stay unique (only on Live).

### 4.7 CSS additions

Scoped, minimal:

- `.pw-live-body` — CSS grid `grid-template-columns: 2fr 1fr; gap: 12px;`
  occupying the remaining vertical space inside `#tab-live`.
- `.pw-live-side` — flex column with `gap: 12px`, child modules sized to
  their content; G/3D module gets `flex: 1 1 auto` to absorb leftover height.
- `.pw-kpi-combo` — inside Speed/RPM combo `pw-module`, two-column grid for
  the two `kpi-v`s side-by-side.
- `.pw-lap-big .kpi-v` — larger digital lap-time font (clamp 40–56px) for
  the Live Rundenzeit card.
- `#sectorPanel.pw-strip-horizontal` — `display: flex; gap: 8px;` for the
  three sector cards in a row inside the right column.
- `#tab-live .kpi` overrides from 2026-05-23 stay where still used; obsolete
  selectors (e.g., the old KPI row inside Live) are removed.
- `#tab-detail` Diagnose block — `pw-diag-grid` 2-col label/value layout.

No new design tokens; uses existing CSS variables.

## 5. Backward compatibility / risks

- Pure dashboard presentation/restructuring change; no protocol / ESP /
  bridge impact; `localStorage` schema unchanged.
- **Main risk — ID coupling.** Mitigation: every ID that `rasicross.js`
  reads/writes is preserved at its original location (now in Detail for the
  moved ones). Live copies use suffixed IDs and a setter fan-out helper.
  Each task ends by confirming the affected render paths still update.
- **Render-on-hidden risk:** the new Diagnose block follows the existing
  unconditional-update pattern (same as charts/stints/lap table).
- **Setter fan-out correctness:** unit-tested via a small pure helper that
  takes `{logicalKey: value}` and returns the set of DOM IDs it would write
  to — testable in `node:test` without a DOM.
- **CSP:** no inline handlers, no new `<script>` tags. DOM reorder + new CSS
  + JS additions inside existing modules only.
- **Sequencing:** branch sits on top of `feat/tab-redesign-pitwall` (already
  has the 2026-05-23 implementation). One implementation plan, ~4 tasks:
  (1) Detail-side moves + ID-suffix groundwork; (2) Live re-layout with new
  right-column stack; (3) Diagnose block; (4) JS setter fan-out + smoke.

## 6. Testing strategy

- **No new DOM unit tests** — HTML/CSS and DOM wiring stay manual-acceptance
  per project convention.
- **One new pure unit test** for the setter fan-out helper (input: logical
  key + value; output: list of IDs it would write to). Tests against the
  static ID map.
- Static checks: `node --check rasicross.js`, `npm run lint`, `npm test`,
  `pytest`/`python -m unittest`. Existing baselines stay green
  (`npm test` = 22; unittest = 17 OK).
- Manual visual acceptance:
  - Live tab on a 1440×900 viewport shows no vertical scrollbar; Speed/RPM
    combo updates live; big Rundenzeit + best-lap update; 3 horizontal
    sector cards update; G/3D toggle works and the chosen canvas updates;
    map renders and updates.
  - Detail tab still renders; KPI-Strip (Speed/RPM/G/Lap/Batt) shows live
    values; `deltaBanner` shows current delta; charts/stints/lap-table
    unchanged; Diagnose block shows all listed raw values and updates per
    packet.
  - No CSP violations or console errors during a full race cycle.
  - Tab-switch Live ↔ Detail produces no canvas-resize glitches.
