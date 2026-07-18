# Phase 56b: Verbindungsseite Feinschliff — Implementierungsplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Die Phase-56-Verbindungsseite optisch fertigstellen: Verbinden-Cockpit links im Hero (behebt Clipping + Überlauf strukturell), kompakte 5-Spalten-Kart-Karten, Empty-State-Panel, Disabled-Optik, sekundäre Aufnahme-Karte.

**Architecture:** Reines UI-Refinement auf `feat/phase-56-verbindungsseite` (PR #79, Baselines noch nicht eingefroren). Keine Logik-Änderung: `conn-health.js` und alle Tests bleiben unangetastet; `conn-ui.js` ändert nur Markup-Erzeugung, `connection.css` die Optik.

**Tech Stack:** wie Phase 56. **Spec:** `docs/superpowers/specs/2026-07-18-56b-verbindungsseite-feinschliff-design.md`.

## Global Constraints

- Root-Cause Überlauf/Clipping (verifiziert): `.pw-hero-telemetry` ist ein `auto-fit`-Grid (tables.css:95–99); die Aktions-Buttons steckten als Grid-Zelle darin und sprengten ihre `1fr`-Spur, `.pw-hero{overflow:hidden}` schnitt ab. Fix = Struktur (Aktionen raus aus dem Grid), **nicht** `overflow` aufweichen und **kein** Eingriff in tables.css (pw-Hero ist tab-übergreifend).
- Stabile IDs bleiben: `#demoChip`, `#connActionBtn`, `#connDetailsBtn`, `#connPortLine`, `#heroKarts/Rate/Gps`, `#connGrid`, `#connDetails`. Neu: `#emptyDemoBtn` (nur im Empty-State-Panel, per Delegation verdrahtet).
- Baselines: `npm test` 222, Lint 0, CSS-Token-Gate OK, 13 e2e-Funktions-Tests. Keine neuen Farben außerhalb der Tokens (Warn = `--orange`, Off = `--red`); getönte Hinweis-Hintergründe über `var(--soft)`, nicht über neue rgba-Farben.
- e2e-Selektoren aus Phase 56 (`#heroGps`-Wait, `#connGrid .conn-card[data-mac]`, Maske `#connGrid .cc-vals`) müssen gültig bleiben.
- Conventions wie Phase-56-Plan (CRLF-Anker frisch Readen, Grep-Tool-Asserts, Commits ohne Anführungszeichen + Trailer, kein `.claude/`/Plan-Doc-Commit außer im Schlusstask).

## File Structure

| Action | Path | Responsibility |
|---|---|---|
| Modify | `index.html` | Aktions-Zeile in die linke Hero-Spalte; Details-Button als Text-Link-Klasse; `#recLoadBtn` → ghost |
| Modify | `src/styles/pages/connection.css` | Cockpit-Zeile, Details-Link, Disabled-Optik, Karten-5er-Grid, Hinweis-Balken, Diagnose-Fußzeile, Warn/Off-Ränder ohne Glow, `.conn-empty`-Panel |
| Modify | `src/conn-ui.js` | Karten-Markup Variante B (Fußzeilen-Diagnose, `Verl.`-Label), Empty-State-Panel bei 0 sichtbaren Karts |
| Modify | `src/app-init.js` | `#emptyDemoBtn` per Event-Delegation auf `#connGrid` |

**Task-Reihenfolge:** 1 → 2 → 3.

---

### Task 1: Hero-Cockpit + sekundäre Aufnahme-Karte (index.html, connection.css)

**Interfaces:** Produces: `.conn-hero-actions` lebt in `.pw-hero-left` (Task 2 unverändert); `#connDetailsBtn` trägt Klasse `conn-details-link`.

- [ ] **Step 1: index.html — Aktions-Zeile umziehen.** Im `#tab-connection`-Hero den Block

```html
        <div class="conn-hero-actions">
          <button class="conn-chip" id="demoChip">▶ Demo</button>
          <button class="btn primary" id="connActionBtn">Verbinden</button>
          <button class="btn ghost" id="connDetailsBtn">Details</button>
        </div>
```

aus `.pw-hero-telemetry` löschen und in `.pw-hero-left` direkt nach der `#connPortLine`-Zeile einfügen als:

```html
        <div class="conn-hero-actions">
          <button class="btn primary" id="connActionBtn">Verbinden</button>
          <button class="conn-chip" id="demoChip">▶ Demo</button>
          <button class="conn-details-link" id="connDetailsBtn">Details</button>
        </div>
```

- [ ] **Step 2: index.html — Aufnahme-Karte entschärfen.** `#recLoadBtn`: Klasse `btn primary` → `btn ghost`.

- [ ] **Step 3: connection.css — Cockpit-Styles** (nach dem `.conn-port-line`-Block einfügen; `.conn-hero-actions`-Regel ersetzen):

```css
#tab-connection .pw-hero-content{align-items:flex-start}
.conn-hero-actions{
  display:flex;align-items:center;gap:var(--sp-10);
  margin-top:12px;
}
.conn-details-link{
  background:transparent;border:0;cursor:pointer;
  color:var(--mut);font-size:var(--fs-12);font-weight:600;
  text-decoration:underline dotted;padding:var(--sp-4) var(--sp-2);
  transition:var(--t);
}
.conn-details-link:hover{color:var(--tx)}
#connActionBtn:disabled{
  background:var(--soft);color:var(--mut);
  border:1px solid var(--bor);box-shadow:none;
  cursor:default;transform:none;
}
```

- [ ] **Step 4: Verifizieren** — `npm run lint:css` OK, `npx vite build` grün; Grep: `conn-hero-actions` in `index.html` = 1 Treffer (in `.pw-hero-left`), `btn primary` im Aufnahme-Karten-Block = 0.
- [ ] **Step 5: Commit** — `style(conn): Verbinden-Cockpit links im Hero, Details als Text-Link, Aufnahme-Karte sekundaer (Phase 56b Task 1)`

---

### Task 2: Kart-Karten Variante B + Empty-State-Panel (conn-ui.js, connection.css, app-init.js)

**Interfaces:** Produces: `.conn-empty` + `#emptyDemoBtn` im `#connGrid`; `.cc-vals` bleibt (e2e-Maske), Label „Verloren" → „Verl.".

- [ ] **Step 1: conn-ui.js — Karten-Markup.** In `_kartCard`: Label `<i>Verloren</i>` → `<i>Verl.</i>`; Diagnose-Button-Text `'Diagnose ' + (open ? '▾' : '▸')` bleibt. In `render()` Schritt 5 ersetzen: bei `shown.length === 0` statt Karten+Platzhalter das Panel rendern:

```js
      if (results.length === 0) {
        grid.innerHTML = '<div class="conn-empty">'
          + '<div class="ce-icon">📡</div>'
          + '<div class="ce-title">Warte auf Karts…</div>'
          + '<div class="ce-sub">Bridge per USB anschließen und <b>Verbinden</b> drücken —<br>oder ohne Hardware ausprobieren:</div>'
          + '<button class="conn-chip" id="emptyDemoBtn">▶ Demo starten</button>'
          + '</div>';
        return;
      }
```

  (vor dem bestehenden `cards`-Aufbau; Platzhalter-Logik für 1–3 Karts bleibt unverändert.)

- [ ] **Step 2: connection.css — Karten + Panel.** `.cc-vals` von Flex auf Grid, Badge uppercase, Hinweis-Balken, Fußzeilen-Diagnose, Warn/Off ohne Glow, `.conn-empty`:

```css
.cc-badge{text-transform:uppercase;letter-spacing:.06em}
.cc-vals{display:grid;grid-template-columns:repeat(5,1fr);gap:var(--sp-8)}
.cc-hints{border-left:3px solid var(--orange)}
.conn-card.off .cc-hints{border-left-color:var(--red)}
.conn-card.warn{border-left:3px solid var(--orange);box-shadow:none}
.conn-card.off{border-left:3px solid var(--red);box-shadow:none}
.cc-diag-btn{display:block;width:100%;text-align:left;border-top:1px solid var(--div);margin-top:12px;padding:var(--sp-8) 0 0}
.conn-empty{ ... volle Panel-Styles (gestrichelt, zentriert, Icon/Titel/Sub) ... }
```

  (vollständige Regeln beim Edit ausschreiben; bestehende `.conn-card.warn/.off`- und `.cc-diag-btn`-Regeln ersetzen statt doppeln.)

- [ ] **Step 3: app-init.js — Delegation.** Nach dem `#connDetailsBtn`-Binding:

```js
  // Empty-State-Demo-Chip: lebt im 1-Hz-gerenderten Grid -> Delegation
  $('connGrid').addEventListener('click', (e) => {
    if (e.target.closest('#emptyDemoBtn') && !state.demo.running) startDemo();
  });
```

- [ ] **Step 4: Verifizieren** — `node --check` (conn-ui, app-init), `npm test` 222, `npm run lint`, `npm run lint:css`, `npx vite build`.
- [ ] **Step 5: Commit** — `style(conn): Kart-Karten im 5-Spalten-Raster, Hinweis-Balken, Empty-State-Panel mit Demo-Einstieg (Phase 56b Task 2)`

---

### Task 3: Sicht-Verifikation + e2e + Push

- [ ] **Step 1:** Screenshot-Skript aus der Design-Session erneut laufen lassen (Ruhe/Details/Demo/Diagnose); Bilder selbst prüfen (kein Clipping, kein Überlauf, Raster sauber) und dem User als Vorher/Nachher schicken.
- [ ] **Step 2:** `npm run test:e2e` — 13 Funktions-Tests grün (Screens lokal geskippt).
- [ ] **Step 3:** Plan-Doc committen (`docs(plan): Phase 56b …`), Push → aktualisiert PR #79; Hinweis im PR-Kommentar auf 56b-Spec + neue Optik (Baselines wie gehabt im CI-Loop einfrieren).

## Self-Review

Spec-Abdeckung: Locked 1 → Task 1; Locked 2 → Task 2 (Badge-Uppercase per CSS, Strings bleiben deutsch); Locked 3 → Task 2 (Panel bei `results.length === 0`, Platzhalter ab 1 Kart unverändert); Locked 4 → Task 1 (`:disabled`); Locked 5 → Task 1 (`btn ghost`). e2e-Verträge unberührt (`.cc-vals`-Maske bleibt, `#demoChip` eindeutig). Kein Eingriff in conn-health/Tests/tables.css.

## Phase Map

Phase 56 (PR #79, offen) → **56b Feinschliff (dieser Plan, gleicher Branch/PR)** → CI-Baseline-Freigabe + Hardware-Abnahme (User).
