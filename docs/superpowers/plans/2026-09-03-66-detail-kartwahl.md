# Phase 66 — Detail-Tab wählt sein Kart per Chip-Leiste

**Goal:** Der Detail-Tab zeigte stumm das aktive Kart — ohne Wahl und ohne Hinweis, welches Kart die Kurven gerade zeichnen. Die Bedienung nachreichen, ohne einen zweiten Auswahl-Zustand neben `state.activeKartMac` einzuführen.

**Architecture:** Die Werte des Detail-Tabs hängen seit Phase 39/46 ohnehin am aktiven Kart — `live-ui.js` schreibt sie über die gemeinsamen Ziele aus `dom-targets.js`. Es fehlte nur der Bedienweg. `kart-bar.render()` zeichnet deshalb ohne Ziel-Id jetzt **beide** Leisten (`#kartBar` im Live-Tab, `#kartBarDetail` im Detail-Tab); die sieben bestehenden Aufrufer bleiben unverändert und die Leisten können nicht auseinanderlaufen.

**Branch:** `feat/phase-65-live-tab-seitenkonzept` (Phase 66 sitzt auf dem Seitenkonzept aus Phase 65 auf — die Chip-Leiste ist dessen Bedienelement).

## Locked Decisions

- **Ein Zustand, nicht zwei.** Die Detail-Leiste wählt das aktive Kart (`state.karts.setActive` + `state.activeKartMac`), sie blättert keine eigene Seite. Eine eigene Detail-Auswahl hätte einen zweiten Zustand neben dem aktiven Kart gebraucht — mit der Folge, dass Detail- und Live-Tab verschiedene Karts zeigen.
- **Abweichung vom Entwurf, bewusst:** der Live-Tab folgt der Wahl, wenn er auf einer Kart-Seite steht (`refreshOverview` löst mit `state.activeKartMac` auf). Auf der Übersichtsseite bleibt er stehen — dort gibt es kein Bezugs-Kart.
- **Kein Übersicht-Chip in der Detail-Leiste.** Der Tab zeigt immer genau ein Kart; ein Übersicht-Chip hätte dort kein Ziel.
- **`render(state, targetId)` bleibt rückwärtskompatibel.** Ohne `targetId` werden beide Anker gezeichnet, mit `targetId` genau einer — kein Aufrufer musste angefasst werden.
- **Der `default`-Platzhalter zählt bei der Namensvergabe nicht mit.** Sein Meta-Eintrag „Kart 1" hätte die Demo-Karts sonst bei „Kart 2" anfangen lassen (Anschlussbefund zu Phase 65, Fix-Runde 4).

## File Structure

| Action | Path | Responsibility |
|---|---|---|
| Modify | `index.html` | zweiter Leisten-Anker `#kartBarDetail` + Eyebrow im Detail-Tab |
| Modify | `src/kart-bar.js` | `render(state, targetId)`, `renderInto`, `selectKart`, `renderDetailName` |
| Modify | `src/kart-roster.js` | `default`-Platzhalter zählt bei der Namensvergabe nicht mit |
| Modify | `src/styles/tables.css` | Abstände der zweiten Leiste |
| Modify | `test/kart-roster.test.js` | Regression zur Namensvergabe |
| Modify | `e2e/karts.spec.js` | Chip-Klick im Detail-Tab wechselt das Kart |

Reihenfolge: 1 → 2 (ein Commit, weil der Roster-Befund erst beim Testen der Leiste sichtbar wurde).

## Task 1 — Zweite Leiste und Auswahl

- [x] `index.html`: Anker `#kartBarDetail` und Eyebrow (Name + Farbe des gezeigten Karts) im Detail-Tab ergänzen.
- [x] `src/kart-bar.js`: `render` auf `(state, targetId)` heben; `renderInto(state, id)` als gemeinsamen Zeichner; ohne Ziel beide Leisten plus `renderDetailName`.
- [x] `selectKart(state, mac)`: setzt das aktive Kart und zeichnet neu — kein Seitenwechsel.
- [x] `src/styles/tables.css`: Abstände für die Leiste im Detail-Tab.
- [x] `e2e/karts.spec.js`: Klick auf einen Detail-Chip wechselt das gezeigte Kart (fällt gegen den alten Stand).
- [x] Verify: `npm test`, `npm run lint`, `npm run lint:css`.

## Task 2 — Namensvergabe ohne Platzhalter

- [x] `src/kart-roster.js`: der `default`-Bucket zählt bei der Nummernvergabe nicht mit, sonst startet das erste echte Kart bei „Kart 2".
- [x] `test/kart-roster.test.js`: Regression dazu.
- [x] Commit: `feat(detail): Detail-Tab waehlt sein Kart per Chip-Leiste (Phase 66)` (`258b6db`)

## Manuelle Abnahme (User, deferred)

- [ ] Mit mehreren Karts: Die Chip-Leiste im Detail-Tab wechselt das Kart, die Kurven folgen.
- [ ] Der Eyebrow nennt Name und Farbe des gezeigten Karts.
- [ ] Mit genau einem Kart: keine Leiste, wie bisher.
- [ ] Rückweg: Ein Wechsel im Detail-Tab schlägt auf den Live-Tab durch, solange der auf einer Kart-Seite steht — auf der Übersichtsseite nicht.

## Self-Review

- [x] Kein zweiter Auswahl-Zustand: Detail- und Live-Tab teilen sich `state.activeKartMac`.
- [x] Alle sieben bestehenden `kart-bar.render`-Aufrufer unverändert (Default-Pfad zeichnet beide Leisten).
- [x] Der Detail-Chip ruft nicht `setLivePage` — sonst würde der Detail-Tab den Live-Tab blättern.
- [x] Namensvergabe gegen ein echtes Alt-Profil geprüft (Anschluss an Phase 65, Fix-Runde 4).

## Phase Map

- Phase 65 → Live-Tab als Seitenkonzept, vier Fix-Runden (dieser Branch)
- **Phase 66 → Kart-Wahl im Detail-Tab**
- Phase 67 → Anzeigefehler-Audit, Firmware-Absturzpfad, Config-Fehlermeldung
