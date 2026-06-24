# Phase 29 — Multi-Kart Live-Seiten + Übersicht Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Auf dem Live-Tab pro Kart eine eigene Einzelansicht (per Chip wählbar) plus einen über einen „⊞ Übersicht"-Button erreichbaren Modus, der alle Karts gleichzeitig mit Renn-/Timing-Infos (Speed, aktuelle/beste Runde, REC) als Grid zeigt.

**Architecture:** Reine Frontend-Erweiterung auf der bestehenden Per-Kart-Pipeline (Registry + Fassade aus Phase 28). Neues Feld `state.liveView` (`'single'`|`'overview'`, Default `'single'`, nicht persistiert) toggelt via `body[data-live-view=…]` zwischen der heutigen Einzelansicht (`.pw-liverow`+`.pw-live-body`) und einem neuen `#liveOverview`-Grid. Ein neues Modul `kart-overview.js` (`window.RasiKartOverview.render`) baut das Grid aus `state.karts.get(mac)` (nicht der nur-aktiven Fassade). `setLiveView` lebt in `live-ui.js`; die Chip-Leiste (`kart-bar.js`) bekommt den Übersicht-Button.

**Tech Stack:** Vanilla JS (Browser-Globals / IIFE), `RasiCross_Telemetry.html` (eine Datei, CRLF), Electron. Verifikation: `node --check`, `node --test`, `eslint`, Python-Baselines (`py_compile`/`unittest`).

**Spec:** `docs/superpowers/specs/2026-06-23-multi-kart-live-pages-design.md`

## Global Constraints

- Repo-Root: `C:/Users/jimlu/Documents/RasiCross-Telemetrie-git`. Branch: `feat/multi-kart-support` (Folge auf Phase 28 / 28b).
- **Dateien sind CRLF.** Unmittelbar vor jedem `Edit` die Zielstelle frisch in-session lesen und den Anker aus diesem Read kopieren — Zeilennummern hier sind indikativ, auf Text ankern.
- Verifikation mit dem **Grep-Tool** (nicht Shell-`grep`).
- **Niemals `.claude/` committen**, Plan-/Spec-Doc nur in den expliziten Doc-Commits.
- Commit-Messages: conventional + kurzer Body + Trailer `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- `__pycache__` vor jedem `git status`/commit löschen.
- **Per-Kart-Daten in der Übersicht über `state.karts.get(mac)`** lesen — NICHT über `state.telemetry`/`state.charts`/… (die Fassade spiegelt nur den aktiven Kart).
- **Single-Kart-Regression:** Bei `state.karts.macs().length <= 1` bleibt die Chip-Leiste (inkl. Übersicht-Button) versteckt und `liveView` ist immer `'single'`.
- **Default beim Start:** `liveView='single'` (Übersicht ist opt-in).
- Build-Bundling: neue JS-Datei muss in `package.json` → `build.files` (sonst fehlt sie im gepackten App-Bundle, wie der letzte Build-Fix-Commit für kart-registry/kart-bar zeigte).
- ESLint: jede neue/konsumierte Global muss im passenden `eslint.config.js`-Block deklariert sein (sonst `no-undef`).
- **Verifikationsrezept (pro Task wo relevant + final):**
  - `node --check <berührte .js>`
  - `node --test` (muss grün bleiben: geo + replay + kart-registry = 126)
  - `npx eslint <berührte .js>` → 0 Fehler
  - `python -m py_compile bridge.py` + `python -m unittest discover -s test -p "test_*.py"` (50 OK, unverändert; nur Smoke, Python unverändert)
  - Python kann `python` oder `py -3` sein.

---

## File Structure

| Aktion | Datei | Verantwortung |
|--------|-------|---------------|
| Neu     | `kart-overview.js` | `window.RasiKartOverview.render(state)` — baut das Übersicht-Grid (eine Karte je MAC), bindet Karten-Klick → aktiv + Einzelansicht. |
| Ändern  | `RasiCross_Telemetry.html` | `#liveOverview`-Container in `#tab-live`; CSS (Overview-Grid/Karten, `.kart-overview-btn`, `body[data-live-view]`-Sichtbarkeit, No-Scroll-Fit); `<script src="kart-overview.js">`. |
| Ändern  | `live-ui.js` | `setLiveView(mode)` + `refreshOverview()`; Overview-Render-Hook im 1-Hz-Loop + 200-ms-Tick; `window.setLiveView`-Export. |
| Ändern  | `rasicross.js` | `state.liveView: 'single'`; Init: `document.body.dataset.liveView` setzen. |
| Ändern  | `kart-bar.js` | Übersicht-Button rendern + Modus-Highlight; Chip-Klick setzt zusätzlich `liveView='single'`; aktiver Chip nur im Single-Modus markiert. |
| Ändern  | `eslint.config.js` | `RasiKartOverview`/`setLiveView`-Globals + neuer Block für `kart-overview.js`. |
| Ändern  | `package.json` | `kart-overview.js` in `build.files`. |

**Task-Reihenfolge:** 1 (HTML/CSS + Script-Include) → 2 (`kart-overview.js`) → 3 (`live-ui.js`+`rasicross.js` View-Wiring) → 4 (`kart-bar.js` Button+Highlight) → 5 (ESLint+Build+Finale Verifikation+Plan-Doc).

> **Verifikationsstrategie:** Die Logik ist DOM-/Loop-gebunden; es gibt keine extrahierbare reine Funktion, die einen eigenen `node:test` rechtfertigt (Registry-Primitive sind in Phase 28 getestet). Daher Verifikation per `node --check` + `eslint` + Grep-Asserts + grüne Baselines; funktionales Multi-Kart-Verhalten bleibt manuell (Hardware), wie in Phase 28/28b.

---

## Task 1: HTML/CSS-Gerüst (#liveOverview, CSS, Script-Include)

**Files:**
- Modify: `RasiCross_Telemetry.html` (CSS nach `.conn-kart-row .ckr-rec`-Block `~1434`; No-Scroll-Media-Query `~1510-1539`; `#tab-live`-Body nach `</div><!-- /pw-live-body -->` `~2575`; Script-Region `~3728`)

**Interfaces:**
- Produces (von Task 2/3/4 konsumiert): DOM `#liveOverview` (`<div>`, initial via CSS versteckt); CSS-Klassen `.ko-card`/`.ko-head`/`.ko-dot`/`.ko-name`/`.ko-rec`/`.ko-speed`/`.ko-row`/`.ko-l`/`.ko-v`/`.ko-sub`, `.kart-overview-btn`; Sichtbarkeitsregeln `body[data-live-view="overview"]`.

- [ ] **Step 1: Overview- + Button-CSS ergänzen**

Lies `RasiCross_Telemetry.html` frisch um den `.conn-kart-row .ckr-rec`-Block (Grep `\.conn-kart-row \.ckr-rec`). Füge **direkt nach** dieser Regel ein:

```css

/* Multi-Kart: Übersicht-Button in der Chip-Leiste */
.kart-overview-btn{display:inline-flex;align-items:center;gap:6px;cursor:pointer;
  background:var(--panel,#161a22);color:var(--fg,#e8edf4);
  border:2px solid #5ad17a;border-radius:999px;padding:5px 12px;
  font-size:12px;line-height:1.2;white-space:nowrap;transition:transform .08s,box-shadow .12s}
.kart-overview-btn:hover{transform:translateY(-1px)}
.kart-overview-btn.active{box-shadow:0 0 0 2px rgba(90,209,122,.35),0 0 12px rgba(90,209,122,.25);
  background:rgba(90,209,122,.12)}

/* Multi-Kart: Live-Übersicht-Grid (alle Karts auf einmal). Sichtbarkeit per
   body[data-live-view]; im Single-Modus versteckt. */
#liveOverview{display:none}
body[data-live-view="overview"] #liveOverview{
  display:grid;gap:12px;align-content:start;overflow:auto;min-height:0;
  grid-template-columns:repeat(auto-fill,minmax(220px,1fr))}
body[data-live-view="overview"] #tab-live .pw-liverow,
body[data-live-view="overview"] #tab-live .pw-live-body{display:none}
.ko-card{cursor:pointer;border:2px solid #3aa0e8;border-radius:14px;padding:12px 14px;
  background:var(--panel,#161a22);display:flex;flex-direction:column;gap:6px;
  transition:transform .08s,box-shadow .12s}
.ko-card:hover{transform:translateY(-1px)}
.ko-card.active{box-shadow:0 0 0 2px rgba(58,160,232,.35),0 0 14px rgba(58,160,232,.25)}
.ko-card.stale{opacity:.45;filter:grayscale(.6)}
.ko-card .ko-head{display:flex;align-items:center;gap:8px}
.ko-card .ko-dot{width:12px;height:12px;border-radius:50%;flex:0 0 auto}
.ko-card .ko-name{font-weight:700;font-size:14px;flex:1;overflow:hidden;
  text-overflow:ellipsis;white-space:nowrap}
.ko-card .ko-rec{color:#e85a7a;font-weight:700;font-size:11px}
.ko-card .ko-speed{font-family:var(--mono);font-size:30px;font-weight:800;line-height:1}
.ko-card .ko-speed small{font-size:13px;opacity:.6;font-weight:600;margin-left:3px}
.ko-card .ko-row{display:flex;justify-content:space-between;align-items:baseline;font-size:12px}
.ko-card .ko-l{color:var(--mut)}
.ko-card .ko-v{font-family:var(--mono);font-size:15px;color:var(--tx)}
.ko-card .ko-sub{font-size:11px;color:var(--mut)}
```

- [ ] **Step 2: No-Scroll-Fit für #liveOverview in die Live-Media-Query ergänzen**

Lies den No-Scroll-Block frisch (Grep `\.pw-live-laps \.pw-laplist\{flex`). Füge **direkt vor** der schließenden `}` dieser `@media (min-height:760px) and (min-width:1100px){`-Regel (die letzte Zeile im Block ist `…pw-laplist{flex:1 1 auto;min-height:0;max-height:none}`) ein:

```css
  /* Übersicht-Grid füllt im No-Scroll-Layout den Live-Raum (eigenes Scrolling). */
  body[data-tab="live"][data-live-view="overview"] #tab-live #liveOverview{
    flex:1 1 auto;min-height:0}
```

- [ ] **Step 3: `#liveOverview`-Container in `#tab-live` einfügen**

Lies das Ende des `#tab-live`-Abschnitts frisch (Grep `/pw-live-body`). Füge **direkt nach** der Zeile `</div><!-- /pw-live-body -->` und **vor** `</section>` ein:

```html

  <!-- Multi-Kart: Übersicht aller Karts (Renn-/Timing-Fokus). Sichtbar bei
       liveView=overview; per JS aus kart-overview.js befüllt. -->
  <div id="liveOverview"></div>
```

- [ ] **Step 4: Script-Include ergänzen**

Lies die Script-Region am Dateiende (Grep `<script src="kart-bar.js">`). Füge **direkt nach** `<script src="kart-bar.js"></script>` ein:

```html
<script src="kart-overview.js"></script>
```

- [ ] **Step 5: Verify**

Grep `RasiCross_Telemetry.html` für: `id="liveOverview"`, `\.ko-card\{`, `\.kart-overview-btn\{`, `data-live-view="overview"`, `src="kart-overview.js"` → alle vorhanden. (Kein `node --check` für HTML; Anker visuell prüfen.)

- [ ] **Step 6: Commit**

```bash
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" add RasiCross_Telemetry.html
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" commit -m "feat(multikart-ui): live overview grid markup/CSS + script include

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: `kart-overview.js` — Übersicht-Grid-Renderer (neues Modul)

**Files:**
- Create: `kart-overview.js`

**Interfaces:**
- Consumes: `state.karts` (Registry: `.macs()`, `.get(mac)`, `.setActive(mac)`), `state.activeKartMac`, `window.RasiKartBar.metaFor(state, mac, idx)` (Phase 28b), `window.setLiveView(mode)` (Task 3), globales `fmtMs(ms)` (geo.js). Liest je MAC `k.telemetry.speed`, `k.lapStart`, `k.bestLapMs`, `k.bestLapNum`, `k.recording.armed`, `k.connection.lastPacketAt`.
- Produces: `window.RasiKartOverview = { render }`; `render(state)` befüllt `#liveOverview`.

- [ ] **Step 1: Modul anlegen**

Erstelle `kart-overview.js` mit exakt diesem Inhalt:

```js
// ============================================================
//  RasiCross — kart-overview.js  (all-karts live overview grid)
// ============================================================
//  Renders one card per known kart on the Live tab when
//  state.liveView === 'overview'. Racing/timing focus: Speed,
//  current lap, best lap (+best-lap number), REC, plus a stale
//  marker. Reads each kart via state.karts.get(mac) — NOT the
//  active-only facade. Clicking a card selects that kart and
//  switches back to the single-kart Live view. Browser-only.
// ============================================================
(function () {
  'use strict';

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g,
      c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function lap(ms) {
    return (ms && typeof fmtMs === 'function') ? fmtMs(ms) : '--:--.---';
  }

  function render(state) {
    const el = document.getElementById('liveOverview');
    if (!el) return;
    const macs = state.karts.macs();
    const now = Date.now();
    el.innerHTML = macs.map((mac, i) => {
      const k = state.karts.get(mac);
      if (!k) return '';
      const m = window.RasiKartBar ? RasiKartBar.metaFor(state, mac, i) : { name: mac, color: '#3aa0e8' };
      const age = k.connection.lastPacketAt ? (now - k.connection.lastPacketAt) : 99999;
      const stale = age > 2000;
      const speed = (k.telemetry.speed || 0).toFixed(0);
      const lapCur = k.lapStart ? lap(now - k.lapStart) : '--:--.---';
      const lapBest = lap(k.bestLapMs);
      const bestNum = k.bestLapNum ? ('Bestrunde · Runde ' + k.bestLapNum) : 'Noch keine Rundenzeit';
      const rec = k.recording.armed ? '<span class="ko-rec">●REC</span>' : '';
      const cls = 'ko-card' + (mac === state.activeKartMac ? ' active' : '') + (stale ? ' stale' : '');
      return '<div class="' + cls + '" data-mac="' + mac + '" style="border-color:' + m.color + '">'
        + '<div class="ko-head"><span class="ko-dot" style="background:' + m.color + '"></span>'
        +   '<span class="ko-name" style="color:' + m.color + '">' + esc(m.name) + '</span>' + rec + '</div>'
        + '<div class="ko-speed">' + speed + '<small>km/h</small></div>'
        + '<div class="ko-row"><span class="ko-l">Aktuelle Runde</span><span class="ko-v">' + lapCur + '</span></div>'
        + '<div class="ko-row"><span class="ko-l">Beste Runde</span><span class="ko-v">' + lapBest + '</span></div>'
        + '<div class="ko-sub">' + bestNum + '</div>'
        + '</div>';
    }).join('');
    el.querySelectorAll('.ko-card').forEach(card => {
      card.onclick = () => {
        const mac = card.getAttribute('data-mac');
        if (state.karts.setActive(mac)) {
          state.activeKartMac = mac;
          if (window.setLiveView) window.setLiveView('single');
        }
      };
    });
  }

  window.RasiKartOverview = { render };
})();
```

- [ ] **Step 2: Verify**

`node --check kart-overview.js` → OK. Grep `kart-overview.js` für `function render`, `window.RasiKartOverview`, `setLiveView`, `state.karts.get`, `ko-card` → alle vorhanden.

- [ ] **Step 3: Commit**

```bash
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" add kart-overview.js
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" commit -m "feat(multikart-ui): kart-overview.js all-karts overview grid renderer

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: View-Wiring — `setLiveView`/`refreshOverview` (`live-ui.js`) + State-Init (`rasicross.js`)

**Files:**
- Modify: `live-ui.js` (neue Funktionen vor `initLiveUiLoops` bzw. nach `updateLiveUi`; Loop-Hooks in `initLiveUiLoops` `~436-485`; Interface-Marker `void [...]` `~489`)
- Modify: `rasicross.js` (`state`-Literal nahe `activeKartMac:` `~47`; Init nahe `document.body.dataset.tab` `~296-298`)

**Interfaces:**
- Consumes: `state.karts.macs()`, `state.liveView`, `window.RasiKartBar.render(state)`, `window.RasiKartOverview.render(state)`, `resizeCanvases()` (map-draw.js).
- Produces: `setLiveView(mode)` (global + `window.setLiveView`), `refreshOverview()`; `state.liveView` (`'single'`|`'overview'`).

- [ ] **Step 1: `state.liveView` im State-Literal ergänzen**

Lies `rasicross.js` frisch um `activeKartMac:` (Grep `activeKartMac: null,`). Ersetze die Zeile

```js
  activeKartMac: null,
```

durch:

```js
  activeKartMac: null,
  // Live-Tab-Ansicht: 'single' (aktiver Kart) oder 'overview' (alle Karts).
  // Nicht persistiert; per setLiveView() in live-ui.js umgeschaltet.
  liveView: 'single',
```

- [ ] **Step 2: `data-live-view` beim Init am body setzen**

Lies `rasicross.js` frisch um die data-tab-Init (Grep `document.body.dataset.tab = _active.dataset.tab;`). Füge **direkt nach** der Zeile

```js
  if (_active) document.body.dataset.tab = _active.dataset.tab;
```

ein:

```js
  document.body.dataset.liveView = state.liveView || 'single';
```

- [ ] **Step 3: `setLiveView` + `refreshOverview` in `live-ui.js` definieren**

Lies `live-ui.js` frisch um die `initLiveUiLoops`-Deklaration (Grep `function initLiveUiLoops`). Füge **direkt vor** `function initLiveUiLoops() {` ein:

```js
// ============================================================
// LIVE-VIEW-MODUS (Einzel-Kart vs. Übersicht aller Karts)
// ============================================================
// Schaltet den Live-Tab zwischen 'single' (aktiver Kart, klassische
// Ansicht) und 'overview' (Grid aller Karts) um. Bei <=1 Kart immer
// 'single' (Single-Kart-Regression). Steuert die Sichtbarkeit per
// body[data-live-view]; CSS blendet .pw-liverow/.pw-live-body bzw.
// #liveOverview entsprechend ein/aus.
function setLiveView(mode) {
  if (mode === 'overview' && state.karts.macs().length <= 1) mode = 'single';
  state.liveView = mode;
  document.body.dataset.liveView = mode;
  if (window.RasiKartBar) RasiKartBar.render(state);
  if (mode === 'overview') {
    if (window.RasiKartOverview) RasiKartOverview.render(state);
  } else {
    // Zurück zur Einzelansicht: Canvas-Größen neu messen (waren ggf. hidden).
    setTimeout(() => { try { resizeCanvases(); } catch (e) {} }, 50);
  }
}
window.setLiveView = setLiveView;

// Im 1-Hz-/200-ms-Loop aufgerufen: hält das Übersicht-Grid aktuell und
// erzwingt bei auf <=1 gesunkener Kartzahl die Einzelansicht.
function refreshOverview() {
  if (state.liveView !== 'overview') return;
  if (state.karts.macs().length <= 1) { setLiveView('single'); return; }
  if (window.RasiKartOverview) RasiKartOverview.render(state);
}
```

- [ ] **Step 4: Overview-Render-Hook im 200-ms-Backup-Tick**

Lies `live-ui.js` frisch um den 200-ms-`setInterval` (Grep `}, 200\);`). Ersetze die Tick-Zeile

```js
  try { renderGauges(); drawTrack(); drawLiveCharts(); updateLiveKPIs(); updatePitWall(); } catch(e){}
```

durch:

```js
  try { renderGauges(); drawTrack(); drawLiveCharts(); updateLiveKPIs(); updatePitWall(); refreshOverview(); } catch(e){}
```

- [ ] **Step 5: Overview-Render-Hook im 1-Hz-Loop**

Lies `live-ui.js` frisch um den `RasiKartBar.render(state)`-Aufruf im 1-Hz-Loop (Grep `if \(window.RasiKartBar\) RasiKartBar.render\(state\);`). Füge **direkt nach** dieser Zeile ein:

```js
  // Übersicht-Grid (falls aktiv) auffrischen; erzwingt single bei <=1 Kart.
  refreshOverview();
```

- [ ] **Step 6: Interface-Marker erweitern**

Lies `live-ui.js` frisch um den `void [...]`-Marker (Grep `void \[initLiveCharts`). Ergänze `setLiveView, refreshOverview` in der Liste — ersetze:

```js
      updateLiveUi, renderStints, animLoop, initLiveUiLoops];
```

durch:

```js
      updateLiveUi, renderStints, animLoop, initLiveUiLoops,
      setLiveView, refreshOverview];
```

- [ ] **Step 7: Verify**

`node --check live-ui.js rasicross.js` → OK. Grep `live-ui.js` für `function setLiveView`, `function refreshOverview`, `window.setLiveView`, `refreshOverview\(\)` (mind. 3× — Definition + 2 Loop-Aufrufe). Grep `rasicross.js` für `liveView: 'single'`, `dataset.liveView`. `node --test` → 126 grün. (ESLint folgt in Task 5, da Globals dort ergänzt werden.)

- [ ] **Step 8: Commit**

```bash
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" add live-ui.js rasicross.js
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" commit -m "feat(multikart-ui): setLiveView + overview refresh hooks + liveView state

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: `kart-bar.js` — Übersicht-Button + Modus-Highlight

**Files:**
- Modify: `kart-bar.js` (`render(state)` `~24-66`)

**Interfaces:**
- Consumes: `window.setLiveView(mode)` (Task 3), `state.liveView`, `state.activeKartMac`, `state.karts`.
- Produces: rendert `.kart-overview-btn` als erstes Kind von `#kartBar`; Chip-`active`-Klasse nur im Single-Modus.

- [ ] **Step 1: Übersicht-Button vor den Chips rendern**

Lies `kart-bar.js` frisch um den `el.innerHTML = '';`-Anfang von `render` (Grep `el.innerHTML = '';`). Ersetze:

```js
    el.style.display = macs.length <= 1 ? 'none' : 'flex';
    el.innerHTML = '';
    macs.forEach((mac, i) => {
```

durch:

```js
    el.style.display = macs.length <= 1 ? 'none' : 'flex';
    el.innerHTML = '';
    // Übersicht-Button (alle Karts auf einmal) — erstes Element in der Leiste.
    const ovBtn = document.createElement('button');
    ovBtn.type = 'button';
    ovBtn.className = 'kart-overview-btn' + (state.liveView === 'overview' ? ' active' : '');
    ovBtn.innerHTML = '⊞ Übersicht';
    ovBtn.onclick = () => { if (window.setLiveView) window.setLiveView('overview'); };
    el.appendChild(ovBtn);
    macs.forEach((mac, i) => {
```

- [ ] **Step 2: Chip-`active`-Klasse nur im Single-Modus + Chip-Klick wechselt auf Single**

Lies `kart-bar.js` frisch um die Chip-`cls`-Zuweisung (Grep `let cls = 'kart-chip'`). Ersetze:

```js
      let cls = 'kart-chip' + (mac === state.activeKartMac ? ' active' : '');
```

durch:

```js
      let cls = 'kart-chip' + (mac === state.activeKartMac && state.liveView !== 'overview' ? ' active' : '');
```

Lies dann frisch um den Chip-`onclick`-`setActive`-Block (Grep `if \(state.karts.setActive\(mac\)\) {` — die Stelle **innerhalb von `render`**, nicht im Editor). Ersetze:

```js
        if (state.karts.setActive(mac)) {
          state.activeKartMac = mac;
          render(state);
        }
      };
      el.appendChild(chip);
```

durch:

```js
        if (state.karts.setActive(mac)) {
          state.activeKartMac = mac;
          // Chip-Klick wählt immer die Einzelansicht dieses Karts.
          if (window.setLiveView) window.setLiveView('single'); else render(state);
        }
      };
      el.appendChild(chip);
```

> Hinweis: `setLiveView('single')` ruft selbst `RasiKartBar.render(state)` auf — daher der `else render(state)`-Fallback nur, falls `setLiveView` (noch) nicht geladen ist.

- [ ] **Step 3: Verify**

`node --check kart-bar.js` → OK. Grep `kart-bar.js` für `kart-overview-btn`, `setLiveView\('overview'\)`, `setLiveView\('single'\)`, `state.liveView !== 'overview'` → alle vorhanden. `node --test` → 126 grün.

- [ ] **Step 4: Commit**

```bash
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" add kart-bar.js
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" commit -m "feat(multikart-ui): overview button in kart bar + single-view on chip click

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: ESLint-Globals + Build-Bundling + Finale Verifikation + Plan-Doc

**Files:**
- Modify: `eslint.config.js` (Globals-Definitionen `~113-116`; `kart-bar.js`-Block `~157-165`; `live-ui.js`-Block `~256-274`; neuer `kart-overview.js`-Block)
- Modify: `package.json` (`build.files` `~50-51`)

**Interfaces:**
- Consumes: alle vorherigen Tasks.
- Produces: lintbare/bündelbare neue Datei.

- [ ] **Step 1: `RasiKartOverview`-Global + neuen Lint-Block ergänzen**

Lies `eslint.config.js` frisch um `kartBarGlobals` (Grep `const kartBarGlobals`). Füge **direkt nach** der Zeile

```js
const kartBarGlobals = { RasiKartBar: 'readonly' };
```

ein:

```js
// Schnittstelle kart-overview.js -> Nutzer (window.RasiKartOverview)
const kartOverviewGlobals = { RasiKartOverview: 'readonly' };
```

- [ ] **Step 2: `setLiveView` im `kart-bar.js`-Block deklarieren**

Lies frisch um den `kart-bar.js`-Block (Grep `files: \['kart-bar.js'\]`). Ersetze die globals-Zeile dieses Blocks:

```js
      globals: { ...globals.browser, ...appCoreGlobals, ...kartRegistryGlobals },
```

durch:

```js
      globals: { ...globals.browser, ...appCoreGlobals, ...kartRegistryGlobals,
                 setLiveView: 'readonly' },
```

- [ ] **Step 3: Neuen `kart-overview.js`-Block einfügen**

Füge **direkt nach** dem schließenden `},` des `kart-bar.js`-Blocks (Grep den `kart-bar.js`-Block; er endet mit `rules: bugRules,` gefolgt von `},`) und **vor** dem `map-draw.js`-Kommentar (`// map-draw.js — klassisches App-Script`) ein:

```js
  // kart-overview.js — Live-Übersicht-Grid (Browser-Script, window.RasiKartOverview)
  {
    files: ['kart-overview.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: { ...globals.browser, ...geoGlobals, ...appCoreGlobals,
                 ...kartRegistryGlobals, ...kartBarGlobals,
                 setLiveView: 'readonly' },
    },
    rules: bugRules,
  },
```

- [ ] **Step 4: `RasiKartOverview` im `live-ui.js`-Block deklarieren**

Lies frisch um den `live-ui.js`-Block (Grep `files: \['live-ui.js'\]`). Ersetze die Endzeile der globals dieses Blocks:

```js
                 RasiEngine: 'readonly', updateEngineUi: 'readonly',
                 ...kartBarGlobals },
```

durch:

```js
                 RasiEngine: 'readonly', updateEngineUi: 'readonly',
                 ...kartBarGlobals, ...kartOverviewGlobals },
```

- [ ] **Step 5: `kart-overview.js` ins Build-Bundle aufnehmen**

Lies `package.json` frisch um `"kart-bar.js",` (Grep `"kart-bar.js",`). Ersetze:

```json
      "kart-registry.js",
      "kart-bar.js",
```

durch:

```json
      "kart-registry.js",
      "kart-bar.js",
      "kart-overview.js",
```

- [ ] **Step 6: Volle Verifikation (alles grün)**
  - `node --check kart-overview.js kart-bar.js live-ui.js rasicross.js`
  - `npx eslint kart-overview.js kart-bar.js live-ui.js rasicross.js eslint.config.js` → 0 Fehler
  - `node --test` → geo + replay + kart-registry = **126 PASS**
  - `python -m py_compile bridge.py` → kein Fehler (unverändert)
  - `python -m unittest discover -s test -p "test_*.py"` → **50 OK** (unverändert)
  - `__pycache__` löschen, dann `git status` → sauber bis auf gewollte Dateien.

- [ ] **Step 7: Grep-Gesamtcheck**
  - `package.json`: `"kart-overview.js"`.
  - `eslint.config.js`: `kartOverviewGlobals`, `files: ['kart-overview.js']`.
  - `kart-overview.js`: `window.RasiKartOverview`.
  - `live-ui.js`: `function setLiveView`, `refreshOverview`.
  - `kart-bar.js`: `kart-overview-btn`.
  - `RasiCross_Telemetry.html`: `id="liveOverview"`, `src="kart-overview.js"`.

- [ ] **Step 8: ESLint-/Build-Commit**

```bash
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" add eslint.config.js package.json
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" commit -m "chore(multikart-ui): lint globals + bundle kart-overview.js

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

- [ ] **Step 9: Plan-Doc committen**

```bash
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" add docs/superpowers/plans/2026-06-23-29-multi-kart-live-pages.md
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" commit -m "docs(plan): Phase 29 multi-kart live pages + overview implementation plan

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Manuelle Akzeptanz (an Nutzer — Hardware/zwei Karts)

1. **Leiste:** Mit zwei Karts erscheint die Chip-Leiste mit „⊞ Übersicht"-Button links und je einem Chip pro Kart.
2. **Übersicht:** Klick auf „⊞ Übersicht" → Grid mit je einer Karte pro Kart (Speed groß, aktuelle Runde, beste Runde + Bestrunden-Nr., REC). Button hervorgehoben, Chips nicht aktiv markiert.
3. **Live-Werte:** Übersichtskarten aktualisieren sich (Speed/aktuelle Runde) im 1-Hz-Takt; tote Karts (>2 s kein Paket) werden ausgegraut.
4. **Karten-Klick:** Klick auf eine Übersichtskarte → wechselt zur Einzel-Live-Ansicht dieses Karts (volle Gauges/Karte/Charts), Chip aktiv markiert, Übersicht-Button nicht.
5. **Chip-Wechsel:** Chip-Klick wechselt zwischen den Einzel-Ansichten der Karts (bleibt im Single-Modus).
6. **Vergessen in Übersicht:** Aktiven Kart vergessen während Übersicht → bleibt Übersicht (eine Karte weniger). Auf 1 Kart gesunken → Leiste verschwindet, Ansicht fällt automatisch auf Einzelansicht zurück.
7. **Single-Kart-Regression:** Mit einem Kart keine Leiste, kein Übersicht-Button; identisch zur bekannten Einzelansicht.

## Self-Review

- **Spec-Coverage:** §3.1 zwei Modi/`liveView`/`body[data-live-view]` → Task 1 (CSS) + Task 3 (State/Toggle); §3.2 Leiste + Übersicht-Button + Single-Kart-Regression + Chip-Klick → Task 1 (Button-CSS) + Task 4; §3.3 Übersichtskarte (Speed/aktuelle Runde/beste Runde+Nr./REC/Stale/Klick→single) → Task 1 (CSS) + Task 2; §3.4 Render-Anbindung (1-Hz + 200-ms, nur overview) → Task 3 (Hooks); §4 Datenfluss → Tasks 2–4; §5 Randfälle (≤1 Kart, Default single, Vergessen in Overview, letzter Kart, No-Scroll-Fit, Tab-Wechsel) → `refreshOverview`-Clamp (Task 3) + Sichtbarkeits-CSS (Task 1); §6 Tests → Verifikationsrezept + Task 5; §7 Dateien → File-Structure-Tabelle. Build-Bundling (Global Constraints) → Task 5.
- **Placeholder-Scan:** Jeder Code-Schritt zeigt konkreten Code; keine TBD/TODO.
- **Typ-/Namens-Konsistenz:** `setLiveView(mode)` / `window.setLiveView` (Task 3 produziert; Task 2/4 konsumieren), `refreshOverview()` (Task 3 intern), `window.RasiKartOverview.render(state)` (Task 2 produziert; Task 3 konsumiert), `state.liveView` (`'single'`|`'overview'`, Task 3 produziert; Tasks 1-CSS/2/4 konsumieren), `RasiKartBar.metaFor(state, mac, idx)` (Phase 28b, Task 2 konsumiert), DOM-ID `liveOverview` + Klassen `ko-*`/`kart-overview-btn` (Task 1 produziert; Task 2/CSS konsumieren) — Task-übergreifend identisch verwendet. ESLint-Globals `RasiKartOverview`/`setLiveView` in allen konsumierenden Blöcken (Task 5).

## Phase Map

- **Phase 28:** volle Per-Kart-Pipeline (Registry/Fassade/Routing).
- **Phase 28b:** Dashboard-Verwaltung (Chip-Editor + Connection-Liste).
- **Phase 29 (dieser Plan):** Live-Seiten je Kart (Chip-Auswahl, vorhanden) + Übersicht-Modus aller Karts.
- **Deferred:** Echte Per-Kart-Rundenzahl (Rennen/Runden derzeit global); Akku/RSSI auf Übersichtskarte; Cross-Kart-Leaderboard/Sortierung; `liveView`-Persistenz.
