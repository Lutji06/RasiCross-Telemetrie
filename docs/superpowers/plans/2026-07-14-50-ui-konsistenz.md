# Phase 50: UI-Konsistenz-Pass — Implementierungsplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Der gewachsene Werte-Zoo (32 Schriftgrößen, 75 Paddings, 28 Radien, 45 Schatten) wird auf fünf feste Skalen in `tokens.css` gezogen — tab-/dateiweise, jeder sichtbare Diff einzeln vom User freigegeben; dazu Dialog-Screenshots als Netz für modals.css und der `#connOverviewGps`-Dual-Writer-Fix.

**Architecture:** Skalen und Mapping-Regeln sind deterministisch in diesem Plan festgelegt (User-Entscheid „Volles Soll", 2026-07-14). Jeder Datei-Pass folgt demselben Freigabe-Loop: Edits → lokale Gates → Push → CI-smoke wird planmäßig ROT → Diff-Bilder werden dem User gezeigt → nach Freigabe werden die Actuals als neue Baselines committet → CI grün. Die Screenshot-Suite aus Phase 49 ist das Netz; ihre Baselines werden pro Pass bewusst neu eingefroren.

**Tech Stack:** Playwright toHaveScreenshot (11→13 Baselines), Node-Inventur-Skript, bestehendes `scripts/check-css-tokens.js` (wird am Ende zum Skalen-Gate erweitert).

**Spec:** `docs/superpowers/specs/2026-07-14-modernisierung-49-54-design.md` (Abschnitt Phase 50) + Soll-Entscheide vom 2026-07-14 (Locked Decisions unten). Vormerkungen aus dem Phase-49-Final-Review (Plan-Nachtrag 49) sind eingearbeitet: Dialog-Shots VOR modals.css (Task 1), tokens.css-`#000` (Task 3), `on-pr-*` (Task 3), Dual-Writer (Task 2).

## Global Constraints

- **Heutiger Look bleibt erkennbar:** Werte werden auf Skalen gezogen, keine Neu-Gestaltung; kein DOM-Umbau, keine Klassen-Zusammenlegung — nur CSS-Werte + die zwei JS-Ausnahmen (Task 1 Test-Bridge, Task 2 Dual-Writer).
- **Jeder sichtbare Diff ist freigabepflichtig:** Kein Baseline-Freeze ohne User-Sichtung der Diff-Bilder (Pass-Verfahren unten). Ablehnung ⇒ Nacharbeit im selben Task.
- **Masken-Lektion Phase 49:** Masken-/Harness-Änderungen und Baseline-Stände müssen zusammenpassen; neue/entfallende Masken ⇒ betroffene Baselines im selben Schritt regenerieren.
- Alle Repo-Dateien sind **CRLF**: Vor jedem Edit die Zielregion frisch Read-en, Anker aus dem frischen Read; NIEMALS sed/awk. Verifikation mit dem Grep-Tool.
- Nie `git add` auf `.claude/`, `graphify-out/`, `CLAUDE.md`, `docs/superpowers/`, `.superpowers/` — Ausnahme: Plan-Doc-Commit im letzten Task.
- Lokale Gates pro Task: `npm test` (201), `npm run lint` (0), `npm run lint:css` (OK), `npm run test:e2e` (13 passed + N skipped lokal). CI-Warten immer mit Run-ID (`gh run list --branch … --limit 1 --json databaseId --jq '.[0].databaseId'`, dann `gh run watch $run --exit-status`).
- Commit-Trailer (Leerzeile davor): `Co-Authored-By:` + `Claude-Session:` der laufenden Session.

## Working Directory & Conventions

- Branch: `feat/phase-50-ui-konsistenz` ab `main` (08a1d37 oder neuer).
- Einmalskripte unter `.superpowers/phase50/` (gitignored).
- PowerShell 5.1: keine `&&`, keine Anführungszeichen in Commit-Messages.

## Locked Decisions (User, 2026-07-14: „Volles Soll")

**Spacing-Skala** (px): `0, 2, 4, 6, 8, 10, 12, 14, 18, 24` — als Tokens `--sp-2 … --sp-24` (Name = Wert).
**Typo-Skala** (px): `9, 10, 11, 12, 13, 14, 15, 17, 18, 20` — als Tokens `--fs-9 … --fs-20`. **Werte > 20px bleiben unverändert** (Display-/KPI-Größen sind bewusst individuell) und werden nicht tokenisiert.
**Radius:** bestehende `--r-sm/md/lg/xl/2xl` + neu `--r-xs: 6px`, `--r-pill: 999px`. Rohe px-Radien ≥ 6 werden auf Token gezogen; < 6px (Mikro-Radien) bleiben roh; `50%` nur für echte Kreise (width==height), sonst `--r-pill`.
**Glow-/Ring-Skala:** `--glow-sm: 0 0 8px`, `--glow-md: 0 0 12px`, `--glow-lg: 0 4px 18px`, `--ring: 0 0 0 3px` — Nutzung: `box-shadow: var(--glow-md) var(--pr-glow)` (Größe+Farbe komponiert). Bestehende `--sh-*` bleiben.
**Rundungsregel** (deterministisch): auf den nächsten Skalenwert; exakte Mitte ⇒ **abrunden** (10.5→10, 13.5→13, 16→14, 19→18). Gilt für font-size ≤ 20, padding/gap/margin (je Komponente eines Mehrfachwerts, Vorzeichen bleibt), border-radius ≥ 6. `0`, `auto`, `%`, `em`, `calc()`, `fr` bleiben unangetastet.
**`on-pr`-Konsolidierung:** Die 4 Varianten (`#0a0d18/#0a0e0a/#0d1117/#0a0e02` — Text auf Lime-Akzent) werden zu EINEM `--on-pr`; Wert = die häufigste Variante (Zählung bei Ausführung). Sichtbare Änderung, freigabepflichtig.
**tokens.css-`#000`-Regeln** (outdoor-Theme, 2 Stellen): neues Token `--outline-hc: #000` in `:root`, beide Regeln nutzen es. (Nicht screenshot-sichtbar — CI testet dark.)
**Dual-Writer-Fix:** Die vier `connOverview*`-`setText`-Zeilen in `renderConnectionTab()` (pit-wall.js) entfallen; der 200-ms-Spiegel in ui-glue.js ist die einzige Quelle. Danach `'#connOverviewGps'` aus der DYN-Maskenliste entfernen; der `prep()`-Wait bleibt (er wartet auf den Spiegel und funktioniert unverändert).
**Pass-Reihenfolge:** tokens (Definitionen) → base+components (global) → live+live-compact → tables → drivers+races+track → connection+modals → pitwall. Ein Commit + eine Freigabe pro Pass.

## File Structure

| Aktion | Pfad | Verantwortung |
|---|---|---|
| Ändern | `src/app.js` | RasiTest-Bridge: `rcAlert, rcConfirm` ergänzen (Task 1) |
| Ändern | `e2e/screens.spec.js` | +2 Dialog-Tests (Task 1); `#connOverviewGps` aus DYN (Task 2) |
| Neu | `e2e/screens.spec.js-snapshots/dialog-{alert,confirm}-linux.png` | Dialog-Baselines (Task 1) |
| Ändern | `src/pit-wall.js` | 4 `connOverview*`-Zeilen raus (Task 2) |
| Ändern | `src/styles/tokens.css` | Skalen-Tokens, `--on-pr`, `--outline-hc` (Task 3) |
| Ändern | `src/styles/{base,components}.css` | Pass A (Task 4) |
| Ändern | `src/styles/pages/{live,live-compact}.css` | Pass B (Task 5) |
| Ändern | `src/styles/tables.css` | Pass C (Task 6) |
| Ändern | `src/styles/pages/{drivers,races,track}.css` | Pass D (Task 7) |
| Ändern | `src/styles/pages/connection.css`, `src/styles/modals.css` | Pass E (Task 8) |
| Ändern | `src/styles/pages/pitwall.css` | Pass F (Task 9) |
| Ändern | `scripts/check-css-tokens.js` | Skalen-Gate (Task 10) |
| Einmalig | `.superpowers/phase50/inventur.mjs` | Wert-Inventur + Mapping-Vorschlag je Datei (Task 3) |

Task-Reihenfolge: 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 → 10 → 11 (strikt sequenziell; jeder Pass friert Baselines neu ein, auf denen der nächste aufsetzt).

---

## Pass-Verfahren (gilt für Tasks 3–9; „der Loop")

Jeder Pass durchläuft exakt diese Schritte — die Task-Beschreibungen unten nennen nur noch das Task-Spezifische:

1. **Mapping erzeugen:** `node .superpowers/phase50/inventur.mjs <datei …>` (Task 3 legt das Skript an) listet je Fundstelle Ist-Wert → Skalen-/Token-Vorschlag nach den Locked-Decisions-Regeln.
2. **Edits:** Mit dem Edit-Tool je Datei anwenden (Region frisch Read-en). Nur Werte ändern, nie Selektoren/Struktur. Abweichungen vom Skript-Vorschlag (z. B. echte Kreise bei 50%) im Report begründen.
3. **Lokale Gates:** `npm test`, `npm run lint`, `npm run lint:css`, `npm run test:e2e` (Timeout 600000) — alles grün (screens lokal geskippt).
4. **Commit + Push** (nur die Task-Dateien; Message siehe Task). CI-smoke wird planmäßig ROT (beabsichtigte Screenshot-Diffs); js/python müssen grün sein.
5. **Diff-Paket für den User:** `gh run download $run -n playwright-results -D .superpowers/phase50/pass-<X>`; die `*-diff.png`/`*-actual.png` der geänderten Shots sichten. **STOP — Controller legt die Diff-Bilder dem User vor (SendUserFile) und holt die Freigabe ein (AskUserQuestion: freigeben / nacharbeiten).** Kein Weiterarbeiten ohne Antwort.
6. **Nach Freigabe — Baseline-Freeze:** die `*-actual.png` der geänderten Tests als `e2e/screens.spec.js-snapshots/<name>-linux.png` committen (`test(e2e): Baselines nach Pass <X> neu eingefroren -- vom User freigegeben (Phase 50 Task <N>)`), push, CI grün abwarten. Bei Nacharbeit: Änderungen im selben Task, zurück zu Schritt 3.

---

### Task 1: Dialog-Screenshots (VOR jeder modals.css-Änderung)

**Files:**
- Modify: `src/app.js` (RasiTest-Bridge), `e2e/screens.spec.js` (+2 Tests im Ruhezustand-Block)
- Create: `e2e/screens.spec.js-snapshots/dialog-alert-linux.png`, `…/dialog-confirm-linux.png`

**Interfaces:**
- Consumes: `rcAlert(msg, title)`, `rcConfirm(msg, title, confirmLabel, danger)` aus `src/rasicross.js` (Promise-basiert, öffnen `#rcAlertOverlay` mit `.show`); bestehendes `launchApp/prep`-Muster.
- Produces: Screenshot-Namen `dialog-alert.png`, `dialog-confirm.png`; Gesamt-Baseline-Zahl 13 (alle Folge-Tasks rechnen damit).

- [ ] **Step 1: RasiTest-Bridge erweitern.** `src/app.js` frisch Read-en. Prüfen, ob `rcAlert`/`rcConfirm` bereits importiert sind (Grep `rcAlert` in app.js); falls nein, beim bestehenden rasicross-Import ergänzen. Im `window.RasiTest = { … }`-Objekt hinter `RasiReplay, enterReplay, exitReplay,` einfügen:

```js
  // Dialog-Trigger fuer die Screenshot-Suite (Phase 50): oeffnen das
  // echte Overlay deterministisch, ohne UI-Klickpfade zu koppeln.
  rcAlert, rcConfirm,
```

- [ ] **Step 2: Zwei Tests anhängen** — in `e2e/screens.spec.js` (frisch Read-en) ans Ende des `Ruhezustand`-describe-Blocks, nach der Tab-Schleife:

```js
  test('Dialog rcAlert', async () => {
    await ctx.page.evaluate(() => { RasiTest.rcAlert('Aufzeichnung gespeichert.', 'Hinweis'); });
    await ctx.page.waitForSelector('#rcAlertOverlay.show');
    await expect(ctx.page).toHaveScreenshot('dialog-alert.png',
      Object.assign({ mask: masks(ctx.page) }, SHOT));
    await ctx.page.click('#rcAlertBtns .btn.primary');
    await ctx.page.waitForSelector('#rcAlertOverlay:not(.show)');
  });

  test('Dialog rcConfirm (danger)', async () => {
    await ctx.page.evaluate(() => {
      RasiTest.rcConfirm('Diesen Eintrag wirklich loeschen?', 'Bestaetigung', 'Loeschen', true);
    });
    await ctx.page.waitForSelector('#rcAlertOverlay.show');
    await expect(ctx.page).toHaveScreenshot('dialog-confirm.png',
      Object.assign({ mask: masks(ctx.page) }, SHOT));
    await ctx.page.click('#rcAlertBtns .btn.ghost');
    await ctx.page.waitForSelector('#rcAlertOverlay:not(.show)');
  });
```

- [ ] **Step 3: Lokal validieren** — `$env:RASI_SCREENS='1'; npm run test:e2e -- e2e/screens.spec.js --update-snapshots` und danach derselbe Lauf ohne `--update-snapshots`: 13 passed in Folge (Timeout 600000). Die neuen `*-win32.png` bleiben untracked (gitignored).
- [ ] **Step 4: Commit + Push + Linux-Baselines via Missing-Snapshot-Bootstrap.** Commit (`src/app.js`, `e2e/screens.spec.js`): `test(e2e): Dialog-Screenshots rcAlert/rcConfirm -- Netz fuer modals.css (Phase 50 Task 1)`. Push; CI-smoke schlägt planmäßig fehl (NUR die 2 neuen Snapshots fehlen — die 11 alten müssen grün sein, sonst STOPP+Analyse); `gh run download $run -n playwright-results -D .superpowers/phase50/task1`; die zwei `dialog-*-actual.png` als `dialog-*-linux.png` committen (`test(e2e): Dialog-Baselines eingefroren (Phase 50 Task 1)`), push, CI komplett grün abwarten.
- [ ] **Step 5: Gates + Report** — `npm test` (201), `npm run lint` (0). Report nach `.superpowers/sdd/task-1-report.md`.

---

### Task 2: Dual-Writer-Fix `connOverview*`

**Files:**
- Modify: `src/pit-wall.js` (renderConnectionTab), `e2e/screens.spec.js` (DYN), 1–2 Baselines (`tab-connection-linux.png`, ggf. `demo-live-linux.png`)

**Interfaces:**
- Consumes: ui-glue.js-Spiegel (200 ms) schreibt `connOverviewHz/Lost/Gps/State` aus `#connHz/#connLost/#connGpsFix/#topConnText` — wird alleinige Quelle.
- Produces: `#connOverviewGps` ist deterministisch (`kein Fix` offline); DYN ohne `'#connOverviewGps'`.

- [ ] **Step 1: Writer entfernen.** `src/pit-wall.js`, Region `// Overview` in `renderConnectionTab()` frisch Read-en. Die vier Zeilen `setText('connOverviewState', …)`, `setText('connOverviewHz', …)`, `setText('connOverviewLost', …)`, `setText('connOverviewGps', …)` ersetzen durch:

```js
    // Overview-Felder schreibt ausschliesslich der 200-ms-Spiegel in
    // ui-glue.js (Single Source; Phase 50 -- vorher Dual-Writer-Ping-Pong
    // auf connOverviewGps: '--' vs 'kein Fix').
```

  `setText('connOverviewSignal', …)` bleibt (der Spiegel schreibt Signal NICHT — mit Grep `connOverviewSignal` in src/ui-glue.js verifizieren; falls doch, auch diese Zeile entfernen und im Report vermerken).
- [ ] **Step 2: Maske zurückbauen.** In `e2e/screens.spec.js` `'#connOverviewGps'` aus DYN entfernen und den zugehörigen Kommentarblock durch zwei Zeilen ersetzen: `// #connOverviewGps ist seit dem Dual-Writer-Fix (Phase 50) deterministisch` + Verweis auf prep()-Wait. Der prep()-Wait auf `#connOverviewGps !== '--'` bleibt unverändert bestehen.
- [ ] **Step 3: Pass-Verfahren Schritte 3–6** (lokale Gates; Commit `fix(conn): connOverview-Felder nur noch vom ui-glue-Spiegel -- Dual-Writer-Ping-Pong beseitigt (Phase 50 Task 2)`; erwartete Diffs: `tab-connection` (Maske weg ⇒ Region wieder echt, Text `kein Fix`), evtl. `demo-live`; User-Freigabe; Baseline-Freeze).

---

### Task 3: Skalen-Tokens + on-pr + outline-hc (tokens.css) + Inventur-Skript

**Files:**
- Modify: `src/styles/tokens.css`
- Create: `.superpowers/phase50/inventur.mjs`

**Interfaces:**
- Produces: Tokens `--sp-2,--sp-4,--sp-6,--sp-8,--sp-10,--sp-12,--sp-14,--sp-18,--sp-24`, `--fs-9…--fs-15,--fs-17,--fs-18,--fs-20`, `--r-xs,--r-pill`, `--glow-sm,--glow-md,--glow-lg,--ring`, `--on-pr`, `--outline-hc` — exakt diese Namen nutzen alle Pässe.

- [ ] **Step 1: Tokens ergänzen** — in `tokens.css` (frisch Read-en) am Ende des `:root`-Blocks:

```css
  /* Phase 50: Skalen (User-Entscheid Volles Soll, 2026-07-14) */
  /* Spacing */
  --sp-2:2px; --sp-4:4px; --sp-6:6px; --sp-8:8px; --sp-10:10px;
  --sp-12:12px; --sp-14:14px; --sp-18:18px; --sp-24:24px;
  /* Typo (>20px bleibt individuell) */
  --fs-9:9px; --fs-10:10px; --fs-11:11px; --fs-12:12px; --fs-13:13px;
  --fs-14:14px; --fs-15:15px; --fs-17:17px; --fs-18:18px; --fs-20:20px;
  /* Radius-Ergaenzungen */
  --r-xs:6px; --r-pill:999px;
  /* Glow/Ring (Groesse; Farbe wird dahinter komponiert) */
  --glow-sm:0 0 8px; --glow-md:0 0 12px; --glow-lg:0 4px 18px;
  --ring:0 0 0 3px;
  /* Text auf Lime-Akzent (konsolidiert aus 4 Varianten, Task 3) */
  --on-pr:#0a0d18;
  /* High-Contrast-Konturen (outdoor) */
  --outline-hc:#000;
```

  Davor per Grep zählen, welche der 4 `on-pr`-Varianten (`#0a0d18/#0a0e0a/#0d1117/#0a0e02`) am häufigsten referenziert wird — deren Wert in `--on-pr` eintragen (oben ist `#0a0d18` als Platzhalter der erwartete Gewinner; Zählung entscheidet). Die 4 Alt-Token-Definitionen auf `var(--on-pr)`-Alias umstellen ODER (wenn sie nur je 1–2 Nutzer haben) Nutzer direkt auf `--on-pr` ziehen und Alt-Tokens löschen — im Report dokumentieren.
- [ ] **Step 2: `#000`-Regeln** — die zwei Fundstellen (Grep `#000` in tokens.css; outdoor `border:2px solid #000` und `outline-color:#000`) auf `var(--outline-hc)` umstellen.
- [ ] **Step 3: Inventur-Skript anlegen** — `.superpowers/phase50/inventur.mjs` komplett:

```js
// Phase 50: listet je Datei alle normalisierbaren Werte mit
// Skalen-/Token-Vorschlag nach den Locked-Decisions-Regeln.
import { readFileSync } from 'node:fs';

const SP = [2, 4, 6, 8, 10, 12, 14, 18, 24];
const FS = [9, 10, 11, 12, 13, 14, 15, 17, 18, 20];
const R = [[6, '--r-xs'], [8, '--r-sm'], [12, '--r-md'], [16, '--r-lg'], [20, '--r-xl'], [28, '--r-2xl']];
const snap = (v, scale) => scale.reduce((b, s) =>
  Math.abs(s - v) < Math.abs(b - v) || (Math.abs(s - v) === Math.abs(b - v) && s < b) ? s : b);

for (const f of process.argv.slice(2)) {
  console.log('\n### ' + f);
  const lines = readFileSync(f, 'utf8').split('\r\n');
  lines.forEach((line, i) => {
    const n = i + 1;
    for (const m of line.matchAll(/font-size\s*:\s*([\d.]+)px/g)) {
      const v = parseFloat(m[1]);
      if (v <= 20) console.log(`${n}: font-size ${v}px -> var(--fs-${snap(v, FS)})`);
    }
    for (const m of line.matchAll(/(?<![a-z-])(padding|gap|margin)\s*:\s*([^;}]+)/g)) {
      const parts = m[2].trim().split(/\s+/);
      const mapped = parts.map((p) => {
        const px = p.match(/^(-?)([\d.]+)px$/);
        if (!px) return p;
        const v = parseFloat(px[2]);
        if (v === 0 || !SP.length) return p;
        return px[1] + 'var(--sp-' + snap(v, SP) + ')';
      });
      if (mapped.join(' ') !== parts.join(' '))
        console.log(`${n}: ${m[1]} ${m[2].trim()} -> ${mapped.join(' ')}`);
    }
    for (const m of line.matchAll(/border-radius\s*:\s*([\d.]+)px/g)) {
      const v = parseFloat(m[1]);
      if (v >= 90) console.log(`${n}: radius ${v}px -> var(--r-pill)`);
      else if (v >= 6) {
        const best = R.reduce((b, s) =>
          Math.abs(s[0] - v) < Math.abs(b[0] - v) || (Math.abs(s[0] - v) === Math.abs(b[0] - v) && s[0] < b[0]) ? s : b);
        console.log(`${n}: radius ${v}px -> var(${best[1]})`);
      }
    }
    for (const m of line.matchAll(/box-shadow\s*:\s*([^;}]+)/g)) {
      const v = m[1].trim();
      if (v.startsWith('var(')) continue;
      let hint = 'MANUELL';
      if (/^0 0 0 [234]px /.test(v)) hint = 'var(--ring) <farbe>';
      else if (/^0 0 8px /.test(v)) hint = 'var(--glow-sm) <farbe>';
      else if (/^0 0 1[02]px /.test(v)) hint = 'var(--glow-md) <farbe>';
      else if (/^0 [46]px (1[468]|2[04])px /.test(v)) hint = 'var(--glow-lg) <farbe>';
      console.log(`${n}: shadow ${v.slice(0, 60)} -> ${hint}`);
    }
  });
}
```

- [ ] **Step 4: Pass-Verfahren Schritte 3–6.** Commit: `feat(tokens): Skalen sp/fs/r/glow, on-pr konsolidiert, outline-hc (Phase 50 Task 3)`. Erwartete sichtbare Diffs: minimal (nur on-pr-Textfarben auf Lime-Buttons/-Chips, 3 der 4 Varianten ändern sich um wenige Farbstufen). User-Freigabe, Baseline-Freeze (vermutlich wenige/keine Shots betroffen — auch „0 Diffs" ist ein gültiges Ergebnis, dann entfällt der Freeze).

---

### Task 4: Pass A — base.css + components.css (global)

**Files:** Modify `src/styles/base.css`, `src/styles/components.css`
Pass-Verfahren mit `node .superpowers/phase50/inventur.mjs src/styles/base.css src/styles/components.css`. Besonderheiten:
- `.btn` und `.pill` sind die Referenz-Metriken (alle Button-/Pill-artigen Klassen späterer Pässe werden auf DIESELBEN `--sp-*/--fs-*/--r-*`-Stufen gezogen, die hier entstehen — im Report die gewählten Stufen als Tabelle festhalten: btn-padding, btn-fs, btn-radius, pill-padding, pill-fs, pill-radius).
- `50%`-Radien: nur bei echten Kreisen (width==height im selben Block) belassen, sonst `--r-pill`.
- Glow-Zoo in components.css (16/18/24px-Varianten) → `--glow-lg`-Stufe.
Commit: `refactor(css): Pass A base+components auf Skalen -- Referenz-Metriken btn/pill (Phase 50 Task 4)`. Erwartung: ALLE 13 Shots diffen leicht (globale Klassen) — Freigabe als Gesamtbild, Baseline-Freeze aller betroffenen.

### Task 5: Pass B — pages/live.css + pages/live-compact.css

**Files:** Modify `src/styles/pages/live.css`, `src/styles/pages/live-compact.css`
Pass-Verfahren. Besonderheiten: Halb-Pixel-Cluster (10.5/9.5/11.5) ist hier am dichtesten; `.kart-chip`/`.ko-card`/`.ls-item` auf die Task-4-Referenz-Stufen ziehen; Display-Größen (34px KPI) unangetastet. Commit: `refactor(css): Pass B live+live-compact auf Skalen (Phase 50 Task 5)`. Erwartete Diffs: `tab-live`, `demo-live`, `tab-detail` (live-compact wirkt auch dort — bei Ausführung prüfen), Freigabe + Freeze.

### Task 6: Pass C — tables.css

**Files:** Modify `src/styles/tables.css`
Pass-Verfahren. Besonderheiten: größte Datei (432 Zeilen), viele `pw-btn`/`pw-mod-action`/`pw-sec-set` → Task-4-Referenz-Stufen; Tabellen-Zeilen-Paddings (5px/7px-Werte → 4/6er-Stufen) ändern Zeilenhöhen sichtbar — im Freigabe-Schritt explizit auf Tabellen-Dichte hinweisen. Commit: `refactor(css): Pass C tables auf Skalen (Phase 50 Task 6)`. Erwartete Diffs: `tab-live`, `demo-live`, `tab-races`, `tab-detail`.

### Task 7: Pass D — pages/drivers.css + pages/races.css + pages/track.css

**Files:** Modify `src/styles/pages/{drivers,races,track}.css`
Pass-Verfahren. Besonderheiten: `kc-*`-Klassen (Kart-Karten + Kart-Fenster!) liegen in drivers.css — der `demo-kart-fenster`-Shot difft mit; `race-card`-Glows → Glow-Skala. Commit: `refactor(css): Pass D drivers+races+track auf Skalen (Phase 50 Task 7)`. Erwartete Diffs: `tab-drivers`, `tab-karts`, `demo-karts`, `demo-kart-fenster`, `tab-races`, `tab-track`.

### Task 8: Pass E — pages/connection.css + modals.css

**Files:** Modify `src/styles/pages/connection.css`, `src/styles/modals.css`
Pass-Verfahren. Besonderheiten: modals.css erst JETZT (Dialog-Netz aus Task 1 aktiv): 28px-Dialog-Padding → 24 (--sp-24), 13.5px → 13, 19px h3 → 18, gap 10 bleibt (--sp-10); connection: mode-tabs/node-cards auf Referenz-Stufen. Commit: `refactor(css): Pass E connection+modals auf Skalen (Phase 50 Task 8)`. Erwartete Diffs: `tab-connection`, `dialog-alert`, `dialog-confirm`.

### Task 9: Pass F — pages/pitwall.css

**Files:** Modify `src/styles/pages/pitwall.css`
Pass-Verfahren. Besonderheiten: lokale Token-Redeklarationen im `#pitwallOverlay`-Block (die `--dark-*`-Pins aus Phase 49) NICHT anfassen; `settings-nav-item`/`pw-close` auf Referenz-Stufen; negative Margins: Betrag auf Skala. Der Pit-Wall-Overlay ist in keinem Screenshot — sichtbare Diffs unwahrscheinlich; wenn 0 Diffs: Freigabe entfällt, im Report vermerken; manuelle Sichtung durch User nach Merge (Hardware-Checkliste). Commit: `refactor(css): Pass F pitwall auf Skalen (Phase 50 Task 9)`.

---

### Task 10: Skalen-Gate in `scripts/check-css-tokens.js`

**Files:** Modify `scripts/check-css-tokens.js`, ggf. `.github/workflows/check.yml` (Step-Name bleibt)

**Interfaces:** Consumes: normalisierter Endzustand aus Tasks 3–9. Produces: dauerhaftes Gate — Verstöße gegen die Skalen brechen CI.

- [ ] **Step 1: Gate erweitern** — in `scripts/check-css-tokens.js` (frisch Read-en) nach dem Hex-Check im selben Zeilen-Loop ergänzen:

```js
    // Phase 50: Skalen-Gate. font-size <=20px nur als var(--fs-*);
    // padding/gap/margin-px nur auf der sp-Skala; border-radius >=6px
    // nur als var(--r-*) (999px-Pille inklusive).
    const fs = line.match(/font-size\s*:\s*([\d.]+)px/);
    if (fs && parseFloat(fs[1]) <= 20) {
      console.error(p + ':' + (i + 1) + ' font-size ' + fs[1] + 'px roh -- var(--fs-*) nutzen'); bad++;
    }
    const SP = [2, 4, 6, 8, 10, 12, 14, 18, 24];
    const sp = line.match(/(?<![a-z-])(?:padding|gap|margin)\s*:\s*([^;}]+)/);
    if (sp) {
      for (const part of sp[1].trim().split(/\s+/)) {
        const px = part.match(/^-?([\d.]+)px$/);
        if (px && parseFloat(px[1]) !== 0 && !SP.includes(parseFloat(px[1]))) {
          console.error(p + ':' + (i + 1) + ' Abstand ' + part + ' nicht auf sp-Skala'); bad++;
        }
      }
    }
    const br = line.match(/border-radius\s*:\s*([\d.]+)px/);
    if (br && parseFloat(br[1]) >= 6) {
      console.error(p + ':' + (i + 1) + ' radius ' + br[1] + 'px roh -- var(--r-*) nutzen'); bad++;
    }
```

  (tokens.css bleibt komplett ausgenommen wie bisher — dort leben die Definitionen.)
- [ ] **Step 2: Negativ-Proben** — temporär in base.css: `font-size:11px` (roh), `gap:5px`, `border-radius:9px` → drei Fehler mit Fundstellen, Exit 1; zurücksetzen (`git checkout -- src/styles/base.css`), `npm run lint:css` → OK. Outputs in den Report.
- [ ] **Step 3:** `node --check scripts/check-css-tokens.js`, `npm run lint`, Commit `chore(ci): Skalen-Gate -- fs/spacing/radius nur noch ueber Tokens bzw. Skala (Phase 50 Task 10)`, Push, CI grün (Run-ID-Muster).

---

### Task 11: Volle Gates + Graph + Plan-Doc

- [ ] **Step 1:** Komplettes Rezept: `node --check main.js preload.js tiles.js` (einzeln), `npm test` (201), `npm run lint` (0), `npm run lint:css` (OK), `npm run test:e2e` (13 passed + 13 skipped lokal), `python -m py_compile sender.py bridge.py esp_libs/calc.py`, `python -m unittest discover -s test -p "test_*.py"` (65 OK), `__pycache__` löschen.
- [ ] **Step 2:** `graphify update .`
- [ ] **Step 3:** Plan-Doc committen (einzige erlaubte Plan-Doc-Stage): `docs(plan): Phase 50 UI-Konsistenz Implementierungsplan (Phase 50 Task 11)`. Push. Danach Whole-Branch-Final-Review + finishing-a-development-branch (PR gegen main).

---

## Hardware/Manual Acceptance Checklist (User, nach Merge)

- [ ] `npm start`: alle Tabs + Kart-Fenster + ein rcConfirm-Dialog — Look konsistenter, aber erkennbar derselbe.
- [ ] Pit-Wall-Overlay öffnen (nicht screenshot-überwacht): Lesbarkeit/Abstände ok.
- [ ] Light- und Outdoor-Theme stichprobenartig (CI testet nur dark): Buttons, Pillen, Dialog.

## Self-Review

- **Spec-Abdeckung:** Inventur ✔ (2026-07-14 erhoben, Zahlen in Goal/Locked Decisions), Soll als tokens.css-Erweiterung ✔ (Task 3), tab-für-tab mit Commit+Freigabe pro Pass ✔ (Tasks 4–9 + Pass-Verfahren), Baseline-Neu-Einfrieren ✔ (Loop Schritt 6), Phase-49-Vormerkungen ✔ (Tasks 1/2/3), Gate danach ✔ (Task 10).
- **Platzhalter-Scan:** Skripte vollständig; Pass-Tasks referenzieren das einmal definierte Pass-Verfahren (benannter Protokoll-Abschnitt, kein „similar to")... Task-Spezifika je Pass benannt. `--on-pr`-Gewinner wird per definierter Zählregel bei Ausführung bestimmt (deterministisch, kein TBD).
- **Namens-Konsistenz:** Token-Namen in Task 3 == Inventur-Skript-Vorschläge == Gate-Prüfungen (Task 10): `--sp-{2,4,6,8,10,12,14,18,24}`, `--fs-{9..15,17,18,20}`, `--r-xs/--r-pill`, `--glow-sm/md/lg`, `--ring`, `--on-pr`, `--outline-hc` ✔; Screenshot-Namen `dialog-alert/confirm.png` in Task 1 == Task-8-Erwartung ✔.

## Phase Map

- Phase 49: CSS-Fundament — merged (PR #76). **Phase 50 (dieses Dokument):** UI-Konsistenz-Pass.
- Phasen 51–54: Test-Vertiefung, TypeScript ×2, Langzeit-Performance — je eigener Plan (Programm-Spec 49–54).
