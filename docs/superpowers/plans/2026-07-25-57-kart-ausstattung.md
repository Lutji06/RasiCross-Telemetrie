# Phase 57 — Kart-Ausstattung (Display/RPM) + Einstellungsfenster-Layout

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Karts können ohne OLED-Display und/oder RPM-Sensor ausgestattet sein. Beim ersten Serial-Kontakt eines unbekannten Karts fragt ein Modal die Ausstattung ab; sie ist später im Kart-Einstellungsfenster änderbar und blendet RPM-/OLED-UI konsequent aus. Zusätzlich: `.settings-row`-Layout bricht im schmalen Kart-Einstellungsfenster nicht mehr (Stapelung < 440 px).

**Architecture:** Ausstattung lebt als `equip: {rpm, display}` + `equipSet` im Roster-Meta pro MAC (persistiert über bestehendes `kartsMeta`-Feld, kein Formatbruch). Pure Logik (Defaults, Normalisierung Alt-Metas, Dialog-Bedarf) in `kart-roster.js` (node:test). Dialog + Fenster-Sektion + ESP-Zeilen-Ausblendung im neuen Modul `src/kart-equip.js`. Konsumenten (live-ui, kart-overview, kart-settings-window) lesen die Flags pro Render-Tick — kein Push-Refresh nötig.

**Tech Stack:** Vanilla ES-Module, node:test, CSS in `src/styles/pages/pitwall.css`.

**Spec:** `docs/superpowers/specs/2026-07-25-57-kart-ausstattung-design.md`

## Working Directory & Conventions

- Repo: `C:/Users/jimlu/Documents/RasiCross-Telemetrie-git`, Branch `feat/phase-57-kart-ausstattung` (von `feat/phase-56-verbindungsseite`).
- Quell-Dateien sind **CRLF** — Anker unmittelbar vor jedem Edit frisch lesen, auf Text ankern (Zeilennummern nur indikativ). Verifikation mit dem Grep-Tool.
- Nie `.claude/` oder `graphify-out/` committen. Pro Task ein Commit (conventional + Body + Session-Trailer). Keine Anführungszeichen in Commit-Messages (PowerShell-5.1-Falle).
- Verifikations-Rezept pro Task: `node --check` der angefassten JS-Dateien; am Phasenende `npm test`, `python -m unittest discover -s test -p "test_*.py"`, `npm run lint`, `npm run lint:css`; `__pycache__` vor `git status` löschen.
- Zeilen-Gate: neue Datei `kart-equip.js` < 520 Inhaltszeilen (`(Get-Content <f> | Measure-Object -Line).Lines`); `kart-settings-window.js` bleibt unter 520.

## Locked Decisions

1. Genau zwei Flags: `rpm`, `display`. Keine Akku-/GPS-Flags.
2. Speicherung im Roster-Meta (`kartsMeta` im 9.6-Payload); Alt-Metas ohne `equip` = voll ausgestattet, `equipSet` false ⇒ Dialog beim nächsten Serial-Kontakt.
3. Dialog: JS-erzeugtes Modal im Hauptfenster, Toggles vorausgewählt, „Übernehmen", Warteschlange bei mehreren neuen Karts. Kein index.html-Eingriff.
4. Trigger nur bei Quelle `serial`, nie `DE:MO:*`/`default`/Replay, nur solange `equipSet` false.
5. `rpm:false` blendet aus: RPM-KPI (Einzel + Kompakt), Max-RPM, RPM-Chart-Serie, `.ko-rpm` (Übersicht), `rpm-warn`; ESP-Felder espMaxRpm, espWarnRpm, espPulses, espWheelCirc, espGearRatio, espRpmCeiling, espRpmAlpha. Historische Tabellen unangetastet.
6. `display:false` blendet nur espPageMs aus; `page_ms` wird weiter gesendet.
7. Layout: `@media (max-width: 440px)` in pitwall.css — settings-rows stapeln, Inputs volle Breite, `.pw-library .row` darf umbrechen. Kind-Fenster-minWidth 380 bleibt.

## File Structure

| Action | Path | Responsibility |
|---|---|---|
| Edit | `src/kart-roster.js` | `metaDefaults` erweitert; neu: `equipDefaults`, `equipFor`, `needsEquipDialog` |
| Edit | `test/kart-roster.test.js` | Tests für die drei Helfer + angepasste `metaDefaults`-Erwartung |
| Add | `src/kart-equip.js` | Erst-Verbindungs-Dialog (Queue), Fenster-Sektion, `applyEquipToEspPanel`, `equipForMac` |
| Edit | `src/telemetry.js` | Ein Hook-Aufruf `maybeShowEquipDialog(_mac)` |
| Edit | `src/kart-settings-window.js` | Sektion „Ausstattung" einhängen, Refresh + ESP-Zeilen anwenden |
| Edit | `src/live-ui.js` | RPM-KPI/Chart/warn nur bei `equip.rpm` |
| Edit | `src/kart-overview.js` | `.ko-rpm` nur bei `equip.rpm` |
| Edit | `src/styles/pages/pitwall.css` | Schmal-Stapelung `.settings-row` |
| Add | `docs/superpowers/specs/2026-07-25-57-kart-ausstattung-design.md` | Spec (dieser Phase) |
| Add | `docs/superpowers/plans/2026-07-25-57-kart-ausstattung.md` | Dieser Plan |

**Task-Order:** 0 (Docs) → 1 (Roster, TDD) → 2 (kart-equip.js) → 3 (telemetry-Hook) → 4 (Einstellungsfenster) → 5 (Live-UI/Übersicht) → 6 (CSS) → 7 (Endverifikation).

---

## Task 0: Spec + Plan committen

- [ ] `git add docs/superpowers/specs/2026-07-25-57-kart-ausstattung-design.md docs/superpowers/plans/2026-07-25-57-kart-ausstattung.md`
- [ ] Commit: `docs(plan): Phase 57 Kart-Ausstattung Design + Implementierungsplan`

## Task 1: Roster-Helfer (TDD)

- [ ] `test/kart-roster.test.js` lesen; bestehende `metaDefaults`-Erwartungen um `equip: {rpm:true, display:true}, equipSet:false` ergänzen.
- [ ] Neue Tests (node:test, describe `equip`):
  - `equipDefaults()` → `{rpm:true, display:true}`.
  - `equipFor(undefined)` und `equipFor({name:'Alt'})` (Alt-Meta ohne equip) → beide Flags true.
  - `equipFor({equip:{rpm:false}})` → `{rpm:false, display:true}` (fehlendes Feld → Default).
  - `needsEquipDialog({equipSet:false}, 'AA:BB')` → true; mit `equipSet:true` → false; für `'DE:MO:01'` und `'default'` → immer false; `needsEquipDialog(null, 'AA:BB')` → false.
- [ ] `node --test` → rot. Dann in `src/kart-roster.js`:

```js
  function metaDefaults(idx) {
    const i = Math.max(0, Number(idx) || 0);
    return { name: 'Kart ' + (i + 1), color: PALETTE[i % PALETTE.length], lastSeenAt: null,
             equip: equipDefaults(), equipSet: false };
  }

  // Ausstattung (Phase 57): Alt-Metas ohne equip-Feld gelten als voll
  // ausgestattet; fehlende Einzel-Flags fallen auf true zurueck.
  function equipDefaults() { return { rpm: true, display: true }; }

  function equipFor(meta) {
    const e = meta && meta.equip;
    return {
      rpm: (e && typeof e.rpm === 'boolean') ? e.rpm : true,
      display: (e && typeof e.display === 'boolean') ? e.display : true,
    };
  }

  // Erst-Verbindungs-Dialog nur fuer echte, unbestaetigte Karts —
  // nie Demo (DE:MO:*), nie der default-Platzhalter-Bucket.
  function needsEquipDialog(meta, mac) {
    if (!meta || meta.equipSet) return false;
    if (isDemoMac(mac) || mac === 'default') return false;
    return true;
  }
```

  Export-Objekt um `equipDefaults, equipFor, needsEquipDialog` ergänzen.
- [ ] `node --test` grün; `node --check src/kart-roster.js`.
- [ ] Commit: `feat(kart): Ausstattungs-Flags (RPM/Display) im Roster-Meta (Phase 57)`

## Task 2: Modul `src/kart-equip.js`

- [ ] Neue Datei mit komplettem Inhalt:

```js
// ============================================================
//  RasiCross — kart-equip.js  (Kart-Ausstattung, Phase 57)
// ============================================================
//  Erst-Verbindungs-Dialog (Modal im Hauptfenster, Warteschlange) und
//  Ausstattungs-Sektion des Kart-Einstellungsfensters. Die Flags leben
//  im Roster-Meta ({equip:{rpm,display}, equipSet}); Konsumenten lesen
//  sie pro Render-Tick — nach Aenderungen ist kein Push-Refresh noetig.
//  Nur Deklarationen auf Top-Level — kein Code laeuft beim Laden.
// ============================================================
import { state, kartMetaFor, updateKartMeta } from './store.js';
import RasiKartRoster from './kart-roster.js';

function _metaIdx(mac) { return Math.max(0, state.karts.macs().indexOf(mac)); }

function _esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Ausstattung eines Karts lesen (normalisiert, nie null).
function equipForMac(mac) {
  return RasiKartRoster.equipFor(kartMetaFor(mac, _metaIdx(mac)));
}

// ---- Erst-Verbindungs-Dialog -------------------------------

let _queue = [];          // MACs, die auf den Dialog warten
let _open = null;         // MAC des gerade offenen Dialogs
const _asked = new Set(); // Session-Gedaechtnis — pro Kart hoechstens einmal

// telemetry.js ruft das pro Paket auf — Set-Lookup zuerst, billig halten.
function maybeShowEquipDialog(mac) {
  if (_asked.has(mac) || _open === mac || _queue.indexOf(mac) >= 0) return;
  const meta = kartMetaFor(mac, _metaIdx(mac));
  if (!RasiKartRoster.needsEquipDialog(meta, mac)) { _asked.add(mac); return; }
  _queue.push(mac);
  _processQueue();
}

function _processQueue() {
  if (_open || !_queue.length) return;
  const mac = _queue.shift();
  _open = mac;
  _buildDialog(mac);
}

function _buildDialog(mac) {
  const meta = kartMetaFor(mac, _metaIdx(mac));
  const ov = document.createElement('div');
  ov.id = 'equipOverlay';
  ov.className = 'overlay show';
  ov.innerHTML = '<div class="dialog">'
    + '<h3>Neues Kart: ' + _esc(meta.name) + '</h3>'
    + '<p>Womit ist dieses Kart ausgestattet? Die Auswahl ist später im ⚙-Einstellungsfenster des Karts änderbar.</p>'
    + '<div class="toggle-row"><span class="label-text">RPM-Sensor</span><label class="toggle"><input type="checkbox" id="equipDlgRpm" checked><span class="toggle-knob"></span></label></div>'
    + '<div class="toggle-row"><span class="label-text">OLED-Display</span><label class="toggle"><input type="checkbox" id="equipDlgDisplay" checked><span class="toggle-knob"></span></label></div>'
    + '<div class="dialog-btns"><button class="btn primary" id="equipDlgSave">Übernehmen</button></div>'
    + '</div>';
  document.body.appendChild(ov);
  ov.querySelector('#equipDlgSave').onclick = () => {
    updateKartMeta(mac, {
      equip: {
        rpm: !!ov.querySelector('#equipDlgRpm').checked,
        display: !!ov.querySelector('#equipDlgDisplay').checked,
      },
      equipSet: true,
    });
    _asked.add(mac);
    ov.remove();
    _open = null;
    _processQueue();
  };
}

// ---- Sektion im Kart-Einstellungsfenster -------------------

function equipSectionMarkup() {
  return '<section class="settings-group active" id="kartEquipPanel" style="margin-top:14px">'
    + '<header class="settings-group-head">'
    +   '<div><h2 class="settings-group-title">Ausstattung</h2><p class="settings-group-sub">Sensoren &amp; Anzeige dieses Karts</p></div>'
    + '</header>'
    + '<div class="toggle-row"><span class="label-text">RPM-Sensor verbaut</span><label class="toggle"><input type="checkbox" id="equipRpm"><span class="toggle-knob"></span></label></div>'
    + '<div class="toggle-row"><span class="label-text">OLED-Display verbaut</span><label class="toggle"><input type="checkbox" id="equipDisplay"><span class="toggle-knob"></span></label></div>'
    + '<p class="settings-block-note">Ohne RPM-Sensor blendet die App alle Drehzahl-Anzeigen und die zugehörigen Sender-Felder aus.</p>'
    + '</section>';
}

const _EQUIP_TOGGLES = [['equipRpm', 'rpm'], ['equipDisplay', 'display']];

function bindEquipSection(r) {
  for (const [id, key] of _EQUIP_TOGGLES) {
    const el = r.doc.getElementById(id);
    if (el) el.onchange = () => {
      const eq = Object.assign({}, equipForMac(r.mac));
      eq[key] = !!el.checked;
      updateKartMeta(r.mac, { equip: eq, equipSet: true });
    };
  }
}

function refreshEquipSection(r) {
  const eq = equipForMac(r.mac);
  for (const [id, key] of _EQUIP_TOGGLES) {
    const el = r.doc.getElementById(id);
    if (el && el.checked !== !!eq[key]) el.checked = !!eq[key];
  }
}

// ---- ESP-Panel: sensorabhaengige Zeilen ein-/ausblenden ----

// Radumfang/Uebersetzung rechnen aus denselben Sensor-Pulsen wie die
// Drehzahl — ohne RPM-Sensor sind alle 7 Felder gegenstandslos.
const _RPM_ESP_IDS = ['espMaxRpm', 'espWarnRpm', 'espPulses', 'espWheelCirc',
                      'espGearRatio', 'espRpmCeiling', 'espRpmAlpha'];

function applyEquipToEspPanel(doc, eq) {
  const rowOf = (id) => {
    const el = doc.getElementById(id);
    return el ? el.closest('.settings-row') : null;
  };
  for (const id of _RPM_ESP_IDS) {
    const row = rowOf(id);
    if (row) row.classList.toggle('row-hidden', !eq.rpm);
  }
  const pm = rowOf('espPageMs');
  if (pm) pm.classList.toggle('row-hidden', !eq.display);
}

// ESM-Export (Phase 57)
export { equipForMac, maybeShowEquipDialog, equipSectionMarkup,
         bindEquipSection, refreshEquipSection, applyEquipToEspPanel };
```

- [ ] `node --check src/kart-equip.js`; Zeilen-Gate messen (< 520).
- [ ] Commit: `feat(kart): kart-equip.js -- Erst-Verbindungs-Dialog + Ausstattungs-Sektion (Phase 57)`

## Task 3: telemetry.js-Hook

- [ ] Import ergänzen (bei den übrigen `./`-Imports): `import { maybeShowEquipDialog } from './kart-equip.js';`
- [ ] Anker (frisch lesen): Zeile `kartMetaFor(_mac, Math.max(0, state.karts.macs().indexOf(_mac))).lastSeenAt = Date.now();` — direkt danach einfügen:

```js
    // Phase 57: unbekannte echte Karts einmalig nach Ausstattung fragen.
    if (k.connection.source === 'serial' && !k.replay.active) maybeShowEquipDialog(_mac);
```

- [ ] `node --check src/telemetry.js`; Grep-Assert: `maybeShowEquipDialog` in `src/telemetry.js` = 2 Treffer (Import + Aufruf).
- [ ] Commit: `feat(conn): Ausstattungs-Dialog beim ersten Serial-Kontakt eines Karts (Phase 57)`

## Task 4: Kart-Einstellungsfenster

- [ ] Import in `src/kart-settings-window.js`: `import { equipSectionMarkup, bindEquipSection, refreshEquipSection, applyEquipToEspPanel, equipForMac } from './kart-equip.js';`
- [ ] `_markup()`: nach dem `</section>`-Ende des `kartIdPanel` (Anker: `+ '<div class="kc-mac" id="kartMacText"></div>'` + folgendes `+ '</section>'`) einfügen: `+ equipSectionMarkup()`.
- [ ] `openKartSettings()`: nach `_bindHandlers(r);` → `bindEquipSection(r);`
- [ ] `_refreshWin()`: nach `_renderCal(r, typing);`-Block-Beginn passend `refreshEquipSection(r);` vor `_renderEsp(r);` einfügen.
- [ ] `_renderEsp()`: nach der `disabled`-Schleife (`for (const [id] of ESP_CFG_FIELDS) …`) einfügen: `applyEquipToEspPanel(r.doc, equipForMac(r.mac));`
- [ ] `node --check src/kart-settings-window.js`; Zeilen-Gate < 520; Grep-Asserts: `kartEquipPanel` in kart-equip.js, `bindEquipSection(r)` in kart-settings-window.js.
- [ ] Commit: `feat(kart): Ausstattungs-Sektion im Einstellungsfenster + ESP-Felder folgen Flags (Phase 57)`

## Task 5: Live-UI + Übersicht

- [ ] `src/live-ui.js` — Import `equipForMac` aus `./kart-equip.js` ergänzen.
- [ ] KPI-Bereich (Anker frisch lesen, um `setTextShared('rpm', …)`/`rpmMax`): RPM-Karten cachen und pro Tick schalten:

```js
let _rpmKpiNodes = null;
function _rpmKpiEls() {
  if (!_rpmKpiNodes) {
    const a = document.getElementById('kRpm');
    const b = document.getElementById('kRpmLive');
    _rpmKpiNodes = [a && a.closest('.kpi'), b && b.closest('.pw-kpi-cell')].filter(Boolean);
  }
  return _rpmKpiNodes;
}
```

  Im KPI-Update: `const _eqRpm = equipForMac(state.karts.activeMac() || 'default').rpm;` — Karten `style.display = _eqRpm ? '' : 'none'`; RPM-/Max-RPM-Text-Updates nur bei `_eqRpm`.
- [ ] `rpm-warn`-Zeile (Anker `document.body.classList.toggle('rpm-warn', …)`): Bedingung um `_eqRpm &&` ergänzen.
- [ ] `drawLiveCharts()`: Serien-Array bedingt bauen — RPM-Objekt nur pushen, wenn `equipForMac(state.karts.activeMac() || 'default').rpm`; `right`/`maxRight`-Optionen bei fehlender Serie weglassen.
- [ ] `src/kart-overview.js` — Import `RasiKartRoster from './kart-roster.js'` (falls nicht da); vor dem Karten-Markup `const eq = RasiKartRoster.equipFor(m);`; die `.ko-rpm`-Zeile nur bei `eq.rpm` einfügen (sonst leerer String).
- [ ] `node --check src/live-ui.js src/kart-overview.js`; Grep-Asserts: `equipForMac` ≥ 3 in live-ui.js, `equipFor(m)` in kart-overview.js.
- [ ] Commit: `feat(live): RPM-Anzeigen folgen der Kart-Ausstattung (Phase 57)`

## Task 6: CSS Schmal-Stapelung

- [ ] `src/styles/pages/pitwall.css`, Anker: Block `.settings-row input:focus…` (Ende der settings-row-Regeln) — danach einfügen:

```css
/* Phase 57: schmale Fenster (Kart-Einstellungsfenster, minWidth 380) —
   Label und Feld stapeln statt quetschen. Hauptfenster: minWidth 900,
   die Query greift dort nie. */
@media (max-width: 440px){
  .settings-row{flex-direction:column;align-items:stretch;gap:var(--sp-6)}
  .settings-row input[type=number],.settings-row input[type=text],.settings-row select{width:100%;max-width:none;text-align:left}
  .pw-library .row{flex-wrap:wrap}
}
```

- [ ] `npm run lint:css` OK.
- [ ] Commit: `fix(css): Kart-Einstellungsfenster stapelt settings-rows unter 440px (Phase 57)`

## Task 7: Endverifikation + Graph

- [ ] `node --check` aller angefassten JS; `npm test` (erwartet: 222 + neue Roster-Tests, frisch zählen); `python -m unittest discover -s test -p "test_*.py"` (`Ran 65 tests OK`); `npm run lint` (0); `npm run lint:css` (OK); `npx playwright test` lokal (13 Funktions-Tests grün; Screenshot-Suite ist CI-only).
- [ ] `__pycache__` löschen, `git status` sauber (nur `.claude/`, `CLAUDE.md`, `graphify-out/` untracked).
- [ ] `graphify update .`
- [ ] Push + PR gegen `feat/phase-56-verbindungsseite` (stacked; nach Merge von 56 retargeten — Stacked-PR-Memory beachten).

## Hardware/Manual Acceptance Checklist (User, deferred)

- [ ] Unbekanntes echtes Kart verbinden ⇒ Modal „Neues Kart" erscheint einmalig; Auswahl wird gespeichert (App-Neustart: kein zweiter Dialog).
- [ ] Kart ohne RPM-Sensor: Live-Einzel/Kompakt ohne RPM-Karte, Chart ohne rote Serie, Übersicht ohne rpm-Zelle, ESP-Panel ohne die 7 RPM-Felder.
- [ ] Ausstattung im ⚙-Fenster umschalten ⇒ Live-UI folgt binnen ~1 s.
- [ ] Kart-Einstellungsfenster auf minimale Breite ziehen ⇒ keine Text-Überlappung.
- [ ] Zwei neue Karts gleichzeitig ⇒ Dialoge nacheinander.

## Self-Review

- Spec-Abdeckung: alle Locked Decisions haben genau einen Task (1–6); „page_ms weiter senden" = bewusst kein Code-Change.
- Platzhalter-Scan: keine TBD/TODO im Plan; Code-Blöcke vollständig.
- Namens-Konsistenz: `equip`/`equipSet`/`equipFor`/`equipForMac`/`needsEquipDialog` durchgängig; ESP-Feld-IDs stimmen mit `ESP_CFG_FIELDS` überein.

## Phase Map

- Phase 56/56b: Verbindungsseite (abgeschlossen, Basis-Branch).
- **Phase 57 (diese): Kart-Ausstattung + Fenster-Layout.**
- Später (vorgemerkt): Ausstattungs-Badges Karts-Seite, RPM-Ausblendung in Historie — nur bei Bedarf.
