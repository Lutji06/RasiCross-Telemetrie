# Phase 28b — Multi-Kart Dashboard-Verwaltung Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dashboard-Bedienoberfläche für die in Phase 28 vorhandene Multi-Kart-Pipeline: Kart umbenennen/färben + vergessen via Popover am Chip, plus eine Per-Kart-Statusliste mit „Alle zurücksetzen" im Connection-Tab.

**Architecture:** Reine Frontend-Erweiterung. `kart-bar.js` bekommt pro Chip ein `✏`, das ein Popover (Name/Farbe/Vergessen) öffnet; `pit-wall.js` rendert eine Per-Kart-Liste im Connection-Tab und einen Reset-Button. Vergessen/Reset wirken lokal auf die Registry **und** senden die bereits in `bridge.py` (Phase 28) implementierten Kommandos `forget_kart_mac`/`reset_karts` direkt (Bridge-Ebene, **nicht** kart-geroutet). Einziges Persistenzfeld bleibt das vorhandene `kartMeta` (`localStorage` `rasi.kartMeta.v1`).

**Tech Stack:** Vanilla JS (UMD/Browser-Globals), `RasiCross_Telemetry.html` (eine Datei, CRLF), Electron-Serial-Bridge (`window.rasiSerial.writeLine`). Verifikation: `node --check`, `node --test`, `python -m py_compile`/`unittest` (Baselines).

**Spec:** `docs/superpowers/specs/2026-06-21-multi-kart-dashboard-management-design.md`

## Global Constraints

- Repo-Root: `C:/Users/jimlu/Documents/RasiCross-Telemetrie-git`. Branch: `feat/multi-kart-support` (Folge auf Phase 28 / PR #46).
- **Dateien sind CRLF.** Unmittelbar vor jedem `Edit` die Zielstelle frisch in-session lesen und den Anker aus diesem Read kopieren — Zeilennummern hier sind indikativ, auf Text ankern.
- Verifikation mit dem **Grep-Tool** (nicht Shell-`grep`).
- **Niemals `.claude/` committen**, und den Plan-/Spec-Doc nur in den expliziten Doc-Commits.
- Commit-Messages: conventional + kurzer Body + Trailer `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- `__pycache__` vor jedem `git status`/commit löschen.
- **Bridge-Kommandos sind Bridge-Ebene:** `forget_kart_mac`/`reset_karts` gehen direkt über `window.rasiSerial.writeLine(JSON.stringify(...))` — **nicht** über `bridgeSend()` (kein `target_mac`).
- **`kartMeta` (Name/Farbe je MAC) bleibt nach Vergessen/Reset erhalten** (Re-Pairing stellt es wieder her).
- **Single-Kart-Regression:** Chip-Leiste **und** Karts-Liste bleiben versteckt, solange `state.karts.macs().length <= 1`.
- **Verifikationsrezept (pro Task wo relevant + final):**
  - `node --check kart-bar.js pit-wall.js live-ui.js rasicross.js` (berührte Dateien)
  - `node --test` (muss grün bleiben: geo + replay + kart-registry = 126)
  - `python -m py_compile bridge.py` (unverändert; nur Smoke) und `python -m unittest discover -s test -p "test_*.py"` (50 OK, unverändert)
  - Python kann `python` oder `py -3` sein.

---

## File Structure

| Aktion | Datei | Verantwortung |
|--------|-------|---------------|
| Ändern | `RasiCross_Telemetry.html` | Popover-Markup (`#kartEditPopover`), Connection-Karts-Liste (`#connKartList`), `#resetKartsBtn`, `#connDetailTitle`; CSS für Popover/Listenzeilen/Swatches/Edit-Icon. |
| Ändern | `kart-bar.js` | `✏`-Edit-Icon pro Chip; Popover öffnen/schließen (Name/Farbe/Vergessen); `forgetKart(mac)`; Export `metaFor`/`openEditor` auf `window.RasiKartBar`. |
| Ändern | `pit-wall.js` | `renderConnKartList()` (+ Aufruf aus `renderConnectionTab()`), Detail-Titel, `resetKarts()`-Handler-Bindung. |
| Unverändert | `bridge.py`, `kart-registry.js` | Kommandos + Registry existieren bereits (Phase 28). |

**Task-Reihenfolge:** 1 (HTML/CSS-Gerüst) → 2 (kart-bar Popover + Vergessen) → 3 (Connection-Liste + Reset) → 4 (Finale Verifikation + Plan-Doc-Commit).

> **Verifikationsstrategie:** Die Logik ist DOM-gebunden; es gibt keine extrahierbare reine Funktion, die einen eigenen `node:test` rechtfertigt (Registry-Primitive sind in Phase 28 bereits getestet). Daher Verifikation per `node --check` + Grep-Asserts + grüne Baselines; funktionales Multi-Kart-Verhalten bleibt manuell (Hardware), wie in Phase 28.

---

## Task 1: HTML/CSS-Gerüst (Popover, Connection-Karts-Liste, CSS)

**Files:**
- Modify: `RasiCross_Telemetry.html` (Connection-Tab `~3058-3064`; Live-/Multi-Kart-CSS-Block bei `.kart-badge` `~1402`; Script-Region nicht betroffen)

**Interfaces:**
- Produces (DOM-IDs, von Task 2/3 konsumiert): `#kartEditPopover` (Overlay, initial `hidden`) mit Kindern `#kartEditName` (`<input>`), `#kartEditSwatches` (`<div>`-Container), `#kartEditForget` (`<button>`); `#connKartList` (`<div>`), `#resetKartsBtn` (`<button>`), `#connDetailTitle` (`<div>`).

- [ ] **Step 1: CSS für Popover + Listenzeilen + Edit-Icon ergänzen**

Lies `RasiCross_Telemetry.html` frisch um den `.kart-badge`-Block (Grep `\.kart-badge\{`). Füge **direkt nach** der `.kart-badge`-Regel ein:

```css
/* Multi-Kart Verwaltung: Edit-Icon am Chip */
.kart-chip .kart-edit{cursor:pointer;opacity:.6;margin-left:2px;font-size:11px;
  background:none;border:none;color:inherit;padding:0 2px;line-height:1}
.kart-chip .kart-edit:hover{opacity:1}

/* Kart-Editor-Popover */
#kartEditPopover{position:fixed;z-index:1200;min-width:200px;padding:12px;
  background:var(--panel,#161a22);border:1px solid #2a3140;border-radius:12px;
  box-shadow:0 12px 32px rgba(0,0,0,.5)}
#kartEditPopover.hidden{display:none}
#kartEditPopover .ke-row{margin-bottom:10px}
#kartEditPopover label{display:block;font-size:11px;opacity:.7;margin-bottom:4px}
#kartEditName{width:100%;box-sizing:border-box;padding:6px 8px;border-radius:8px;
  border:1px solid #2a3140;background:#0e1117;color:var(--fg,#e8edf4);font-size:13px}
#kartEditSwatches{display:flex;gap:8px}
#kartEditSwatches .sw{width:22px;height:22px;border-radius:50%;cursor:pointer;
  border:2px solid transparent}
#kartEditSwatches .sw.active{border-color:var(--fg,#e8edf4)}

/* Connection-Tab: Per-Kart-Liste */
#connKartList{display:none;flex-direction:column;gap:6px;margin:0 0 14px}
.conn-kart-row{display:grid;grid-template-columns:14px 1fr auto;align-items:center;
  gap:10px;cursor:pointer;padding:8px 12px;border:1px solid #2a3140;border-radius:10px;
  background:var(--panel,#161a22)}
.conn-kart-row.active{box-shadow:0 0 0 2px rgba(58,160,232,.35);border-color:#3aa0e8}
.conn-kart-row.stale{opacity:.5}
.conn-kart-row .ckr-dot{width:12px;height:12px;border-radius:50%}
.conn-kart-row .ckr-name{font-weight:600;font-size:13px}
.conn-kart-row .ckr-stats{font-size:11px;opacity:.8;font-variant-numeric:tabular-nums;
  display:flex;gap:10px;white-space:nowrap}
.conn-kart-row .ckr-rec{color:#e85a7a;font-weight:700}
```

- [ ] **Step 2: Popover-Markup vor `</body>` einfügen**

Lies die Script-Region am Dateiende (Grep `<script src="kart-bar.js">`). Füge **unmittelbar vor** der Zeile `<script src="kart-registry.js"></script>` (also vor allen Telemetrie-Scripts, im Body) das Overlay ein:

```html
<div id="kartEditPopover" class="hidden">
  <div class="ke-row">
    <label for="kartEditName">Name</label>
    <input id="kartEditName" type="text" maxlength="20" autocomplete="off">
  </div>
  <div class="ke-row">
    <label>Farbe</label>
    <div id="kartEditSwatches"></div>
  </div>
  <button id="kartEditForget" class="btn danger w100">Kart vergessen</button>
</div>
```

- [ ] **Step 3: Connection-Karts-Liste + Reset + Detail-Titel einfügen**

Lies den Connection-Tab um den `#diagToggleBtn`-Row (Grep `id="diagToggleBtn"`). Füge **direkt nach** dem schließenden `</div>` dieser `row` (Zeile mit `</button>` gefolgt von `</div>`, `~3063`) ein:

```html
  <!-- Multi-Kart: Per-Kart-Statusliste + Reset (nur sichtbar bei >1 Kart) -->
  <div id="connKartList"></div>
  <button class="btn ghost" id="resetKartsBtn" style="display:none;margin:0 0 14px">
    Alle Karts zurücksetzen
  </button>
  <div id="connDetailTitle" class="muted" style="margin:0 0 8px;font-size:12px"></div>
```

- [ ] **Step 4: Verify**

Grep `RasiCross_Telemetry.html` für `id="kartEditPopover"`, `id="kartEditSwatches"`, `id="connKartList"`, `id="resetKartsBtn"`, `id="connDetailTitle"`, `\.conn-kart-row\{` → alle vorhanden. Datei bleibt valides HTML (kein `node --check` für HTML; visuelle Kontrolle der Anker).

- [ ] **Step 5: Commit**

```bash
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" add RasiCross_Telemetry.html
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" commit -m "feat(multikart-ui): popover + connection kart list markup/CSS

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: `kart-bar.js` — Edit-Icon, Popover, Vergessen

**Files:**
- Modify: `kart-bar.js` (gesamte IIFE; `render` `~25-62`, `window.RasiKartBar` `~64`)

**Interfaces:**
- Consumes: `state.karts` (KartRegistry-Instanz: `.macs()`, `.get(mac)`, `.setActive(mac)`, `.forget(mac)`, `.activeMac()`), `state.kartMeta`, `state._kartHz`, `state.activeKartMac`, `state.serial`, globale `window.rasiSerial`, `rcToast` (global aus `rasicross.js`).
- Produces: `window.RasiKartBar = { render, metaFor, openEditor, forgetKart }` — `metaFor(state, mac, idx) -> {name,color}` (von `pit-wall.js` konsumiert); `render(state)`.

- [ ] **Step 1: `metaFor` auf Modul-Ebene parametrisieren + exportieren**

Lies `kart-bar.js` frisch. Die bestehende innere `metaFor(meta, mac, idx)` bleibt; ergänze einen exportierten Wrapper, der `state` nimmt. Ersetze den Export `window.RasiKartBar = { render };` durch:

```js
  // state-basierter Wrapper, damit pit-wall.js dieselbe Meta-Quelle nutzt.
  function metaForState(state, mac, idx) {
    const meta = state.kartMeta && Object.keys(state.kartMeta).length ? state.kartMeta : loadMeta();
    state.kartMeta = meta;
    const m = metaFor(meta, mac, idx);
    saveMeta(meta);
    return m;
  }

  window.RasiKartBar = { render, metaFor: metaForState, openEditor, forgetKart };
```

- [ ] **Step 2: `✏`-Icon je Chip rendern (Auswahl vs. Edit trennen)**

Im `render(state)` (Grep `chip.onclick = `) ersetze den Block, der `chip.innerHTML` setzt und `chip.onclick` bindet, durch eine Variante mit separatem Edit-Button. Ersetze:

```js
      chip.innerHTML = '<b style="color:' + m.color + '">' + escHtml(m.name) + '</b>'
        + ' <span>' + hz + 'Hz</span> <span>' + rssi + '</span>'
        + (k.batt && k.batt.present ? ' <span>' + (k.batt.soc | 0) + '%</span>' : '')
        + rec;
      chip.onclick = () => {
        if (state.karts.setActive(mac)) {
          state.activeKartMac = mac;
          render(state);
        }
      };
      el.appendChild(chip);
```

durch:

```js
      chip.innerHTML = '<b style="color:' + m.color + '">' + escHtml(m.name) + '</b>'
        + ' <span>' + hz + 'Hz</span> <span>' + rssi + '</span>'
        + (k.batt && k.batt.present ? ' <span>' + (k.batt.soc | 0) + '%</span>' : '')
        + rec
        + ' <button class="kart-edit" title="Umbenennen / Farbe / Vergessen" data-mac="' + mac + '">✏</button>';
      chip.onclick = (ev) => {
        if (ev.target && ev.target.classList.contains('kart-edit')) {
          ev.stopPropagation();
          openEditor(state, mac, ev.target);
          return;
        }
        if (state.karts.setActive(mac)) {
          state.activeKartMac = mac;
          render(state);
        }
      };
      el.appendChild(chip);
```

- [ ] **Step 3: `openEditor` + `closeEditor` implementieren**

Füge **vor** `window.RasiKartBar = …` (also im IIFE-Scope) ein:

```js
  let _editState = null, _editMac = null, _onDocClick = null;

  function closeEditor() {
    const pop = document.getElementById('kartEditPopover');
    if (pop) pop.classList.add('hidden');
    if (_onDocClick) { document.removeEventListener('mousedown', _onDocClick, true);
      document.removeEventListener('keydown', _onEditKey, true); _onDocClick = null; }
    _editState = null; _editMac = null;
  }

  function _onEditKey(ev) { if (ev.key === 'Escape') closeEditor(); }

  function openEditor(state, mac, anchorEl) {
    const pop = document.getElementById('kartEditPopover');
    if (!pop) return;
    _editState = state; _editMac = mac;
    const macs = state.karts.macs();
    const idx = Math.max(0, macs.indexOf(mac));
    const m = metaForState(state, mac, idx);

    const nameEl = document.getElementById('kartEditName');
    nameEl.value = m.name || '';
    nameEl.oninput = () => {
      m.name = nameEl.value.trim() || ('Kart ' + (idx + 1));
      state.kartMeta[mac] = m; saveMeta(state.kartMeta);
      render(state);
      if (window.renderConnectionTab) window.renderConnectionTab();
    };

    const sw = document.getElementById('kartEditSwatches');
    sw.innerHTML = '';
    PALETTE.forEach(col => {
      const b = document.createElement('div');
      b.className = 'sw' + (col === m.color ? ' active' : '');
      b.style.background = col;
      b.onclick = () => {
        m.color = col; state.kartMeta[mac] = m; saveMeta(state.kartMeta);
        sw.querySelectorAll('.sw').forEach(s => s.classList.remove('active'));
        b.classList.add('active');
        render(state);
        if (window.renderConnectionTab) window.renderConnectionTab();
      };
      sw.appendChild(b);
    });

    const fb = document.getElementById('kartEditForget');
    fb.onclick = () => { forgetKart(state, mac); closeEditor(); };

    // Positionieren unter dem Anker
    const r = anchorEl.getBoundingClientRect();
    pop.style.left = Math.min(r.left, window.innerWidth - 220) + 'px';
    pop.style.top = (r.bottom + 6) + 'px';
    pop.classList.remove('hidden');

    _onDocClick = (ev) => { if (!pop.contains(ev.target) && ev.target !== anchorEl) closeEditor(); };
    document.addEventListener('mousedown', _onDocClick, true);
    document.addEventListener('keydown', _onEditKey, true);
  }
```

- [ ] **Step 4: `forgetKart` implementieren**

Füge direkt nach `openEditor` ein:

```js
  function forgetKart(state, mac) {
    state.karts.forget(mac);
    if (state._kartHz) delete state._kartHz[mac];
    // Bridge-Kommando (Bridge-Ebene, nicht kart-geroutet) — nur falls verbunden.
    if (state.serial && state.serial.connected && window.rasiSerial && window.rasiSerial.writeLine) {
      try { window.rasiSerial.writeLine(JSON.stringify({ type: 'forget_kart_mac', mac })); } catch (e) {}
    }
    state.activeKartMac = state.karts.activeMac();   // Registry hat ggf. umgepointet
    if (typeof rcToast === 'function') rcToast('Kart vergessen');
    render(state);
    if (window.renderConnectionTab) window.renderConnectionTab();
  }
```

- [ ] **Step 5: Verify**

`node --check kart-bar.js` → OK. Grep `kart-bar.js` für `function openEditor`, `function forgetKart`, `function closeEditor`, `metaFor: metaForState`, `forget_kart_mac`, `class="kart-edit"` → alle vorhanden. `node --test` → 126 grün.

- [ ] **Step 6: Commit**

```bash
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" add kart-bar.js
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" commit -m "feat(multikart-ui): chip editor popover (name/colour) + forget kart

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: `pit-wall.js` — Connection-Karts-Liste + Detail-Titel + Reset

**Files:**
- Modify: `pit-wall.js` (`renderConnectionTab` `~171-216`; neue Funktionen direkt davor/danach)

**Interfaces:**
- Consumes: `window.RasiKartBar.metaFor(state, mac, idx)` (aus Task 2), `state.karts`, `state._kartHz`, `state.activeKartMac`, `state.serial`, `window.rasiSerial`, `rcToast`, `rcConfirm` (global), `setText`/`$`/`esc` (global aus `rasicross.js`).
- Produces: `window.renderConnectionTab` (für `kart-bar.js`-Re-Render genutzt), `renderConnKartList()`, `resetKarts()`.

- [ ] **Step 1: `renderConnKartList()` implementieren**

Füge **direkt vor** `function renderConnectionTab()` (Grep `function renderConnectionTab`) ein:

```js
function renderConnKartList() {
  const list = $('connKartList');
  const resetBtn = $('resetKartsBtn');
  if (!list) return;
  const macs = state.karts.macs();
  const multi = macs.length > 1;
  list.style.display = multi ? 'flex' : 'none';
  if (resetBtn) resetBtn.style.display = multi ? 'inline-flex' : 'none';
  if (!multi) { list.innerHTML = ''; return; }
  const now = Date.now();
  list.innerHTML = macs.map((mac, i) => {
    const k = state.karts.get(mac);
    if (!k) return '';
    const m = window.RasiKartBar ? RasiKartBar.metaFor(state, mac, i) : { name: mac, color: '#3aa0e8' };
    const age = k.connection.lastPacketAt ? (now - k.connection.lastPacketAt) : 99999;
    const hz = (state._kartHz && state._kartHz[mac] != null) ? state._kartHz[mac] : '--';
    const rssi = (k.connection.rssi != null) ? (k.connection.rssi + 'dBm') : '--';
    const batt = (k.batt && k.batt.present) ? ((k.batt.soc | 0) + '%') : '--';
    const rec = k.recording.armed ? '<span class="ckr-rec">●REC</span>' : '';
    const ageStr = age < 99999 ? (age / 1000).toFixed(1) + 's' : '--';
    const cls = 'conn-kart-row' + (mac === state.activeKartMac ? ' active' : '') + (age > 2000 ? ' stale' : '');
    return '<div class="' + cls + '" data-mac="' + mac + '">'
      + '<span class="ckr-dot" style="background:' + m.color + '"></span>'
      + '<span class="ckr-name">' + esc(m.name) + '</span>'
      + '<span class="ckr-stats">'
      +   '<span>' + hz + 'Hz</span><span>' + rssi + '</span>'
      +   '<span>L:' + (k.connection.lost || 0) + '</span><span>' + ageStr + '</span>'
      +   '<span>' + batt + '</span>' + rec
      + '</span></div>';
  }).join('');
  list.querySelectorAll('.conn-kart-row').forEach(row => {
    row.onclick = () => {
      const mac = row.getAttribute('data-mac');
      if (state.karts.setActive(mac)) {
        state.activeKartMac = mac;
        renderConnKartList();
        if (window.RasiKartBar) RasiKartBar.render(state);
      }
    };
  });
}
```

- [ ] **Step 2: `resetKarts()` implementieren**

Füge direkt nach `renderConnKartList` ein:

```js
async function resetKarts() {
  if (!await rcConfirm('Alle bekannten Karts vergessen? Namen/Farben bleiben erhalten.',
      'Karts zurücksetzen', 'Zurücksetzen', true)) return;
  state.karts.reset();
  state._kartHz = {};
  state.activeKartMac = null;
  if (state.serial && state.serial.connected && window.rasiSerial && window.rasiSerial.writeLine) {
    try { window.rasiSerial.writeLine(JSON.stringify({ type: 'reset_karts' })); } catch (e) {}
  }
  if (typeof rcToast === 'function') rcToast('Alle Karts zurückgesetzt');
  renderConnKartList();
  if (window.RasiKartBar) RasiKartBar.render(state);
}
```

- [ ] **Step 3: In `renderConnectionTab()` Liste + Detail-Titel einhängen + global exportieren**

Lies `renderConnectionTab` frisch (Grep `function renderConnectionTab`). Direkt nach `const c = state.connection;` (`~173`) ergänze:

```js
    renderConnKartList();
    const _am = state.activeKartMac;
    const _meta = (window.RasiKartBar && _am) ? RasiKartBar.metaFor(state, _am, 0) : null;
    setText('connDetailTitle', _meta ? ('Detail: ' + _meta.name) : '');
```

Und am Dateiende (oder bei den übrigen `window.`-Exports in `pit-wall.js`, Grep `window\.` in pit-wall.js) exportiere:

```js
window.renderConnectionTab = renderConnectionTab;
```

Binde den Reset-Button. Suche die Init-/Binding-Stelle, an der andere Connection-Tab-Buttons gebunden werden (Grep `diagToggleBtn` in `pit-wall.js`); falls dort eine `onclick`-Bindung existiert, ergänze daneben:

```js
  { const b = document.getElementById('resetKartsBtn'); if (b) b.onclick = resetKarts; }
```

Falls in `pit-wall.js` keine solche Init-Funktion existiert, binde stattdessen am Ende von `renderConnKartList()` defensiv (idempotent):

```js
  if (resetBtn && !resetBtn._bound) { resetBtn._bound = true; resetBtn.onclick = resetKarts; }
```

(Wähle **eine** der beiden Bindungsvarianten — die idempotente in `renderConnKartList` ist robust und benötigt keine separate Init-Stelle.)

- [ ] **Step 4: Verify**

`node --check pit-wall.js` → OK. Grep `pit-wall.js` für `function renderConnKartList`, `async function resetKarts`, `reset_karts`, `window.renderConnectionTab`, `connDetailTitle` → alle vorhanden. `node --test` → 126 grün.

- [ ] **Step 5: Commit**

```bash
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" add pit-wall.js
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" commit -m "feat(multikart-ui): connection-tab per-kart list + reset-all

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: Finale Verifikation + Plan-Doc-Commit

- [ ] **Step 1: Volle Verifikation (alles grün)**
  - `node --check kart-bar.js pit-wall.js live-ui.js rasicross.js geo.js replay.js kart-registry.js`
  - `node --test` → geo + replay + kart-registry = **126 PASS**.
  - `python -m py_compile bridge.py` → kein Fehler (unverändert).
  - `python -m unittest discover -s test -p "test_*.py"` → **50 OK** (unverändert).
  - `__pycache__` löschen, dann `git status` → sauber bis auf gewollte Dateien.

- [ ] **Step 2: Grep-Gesamtcheck**
  - `kart-bar.js`: `openEditor`, `forgetKart`, `forget_kart_mac`, `metaFor: metaForState`.
  - `pit-wall.js`: `renderConnKartList`, `resetKarts`, `reset_karts`, `window.renderConnectionTab`.
  - `RasiCross_Telemetry.html`: `kartEditPopover`, `connKartList`, `resetKartsBtn`, `connDetailTitle`.

- [ ] **Step 3: Plan-Doc committen**

```bash
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" add docs/superpowers/plans/2026-06-21-28b-multi-kart-dashboard-management.md
git -C "C:/Users/jimlu/Documents/RasiCross-Telemetrie-git" commit -m "docs(plan): Phase 28b multi-kart dashboard management implementation plan

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Manuelle Akzeptanz (an Nutzer — Hardware/zwei Karts)

1. **Umbenennen/Farbe:** Chip-`✏` → Popover; Name/Farbe ändern wirkt sofort auf Chip **und** Connection-Listenzeile; übersteht App-Neustart (`kartMeta`/localStorage).
2. **Vergessen:** Popover → „Kart vergessen" entfernt den Kart lokal; bei verbundener Bridge sinkt der OLED-Kart-Zähler (`x{n}`); Name/Farbe bleiben für Re-Pairing erhalten.
3. **Connection-Liste:** zeigt pro Kart Hz/RSSI/Lost/Alter/Akku/REC; Klick auf Zeile schaltet die Rich-View + den Detail-Titel um; aktive Zeile hervorgehoben; Stale-Zeile grau.
4. **Alle zurücksetzen:** Bestätigungsdialog → leert Liste + Chips; bei verbundener Bridge `reset_karts` (OLED `x0`).
5. **Offline:** Vergessen/Reset wirken trotzdem lokal (kein `writeLine`-Fehler).
6. **Single-Kart-Regression:** mit einem Kart bleiben Chip-Leiste **und** Connection-Liste versteckt; Verhalten identisch zu Phase 28.

## Self-Review

- **Spec-Coverage:** §3.1 Popover/Umbenennen/Farbe/Vergessen → Task 2; §3.2 Connection-Liste/Detail-Titel/Reset → Task 3; §3.1+§3.2 Markup/CSS → Task 1; §4 Datenfluss → Tasks 2–3; §5 Randfälle (offline, aktiven Kart vergessen, Popover-Persistenz, stale) → Task-Code (forgetKart re-point, Popover als eigenes Overlay außerhalb der Chip-`innerHTML`, Stale-Klassen); §6 Tests → Verifikationsrezept + Task 4; §7 Dateien → File-Structure-Tabelle. Alle Spec-Abschnitte abgebildet.
- **Placeholder-Scan:** Jeder Code-Schritt zeigt konkreten Code; keine TBD/TODO.
- **Typ-/Namens-Konsistenz:** `window.RasiKartBar.metaFor(state, mac, idx)` (Task 2 produziert, Task 3 konsumiert), `forgetKart(state, mac)`, `openEditor(state, mac, anchorEl)`, `renderConnKartList()`, `resetKarts()`, `window.renderConnectionTab`, DOM-IDs `kartEditPopover/kartEditName/kartEditSwatches/kartEditForget/connKartList/resetKartsBtn/connDetailTitle` — Task-übergreifend identisch verwendet.

## Phase Map

- **Phase 28:** volle Per-Kart-Pipeline (geliefert, PR #46).
- **Phase 28b (dieser Plan):** Dashboard-Verwaltung (Popover + Connection-Liste).
- **Deferred (29-Kandidat):** Cross-Kart-Leaderboard; freier Farbwähler; Chip-Sortierung.
