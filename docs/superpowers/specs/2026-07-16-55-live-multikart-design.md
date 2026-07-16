# Phase 55: Live-Tab Multi-Kart — Design

**Datum:** 2026-07-16 · **Status:** vom User freigegeben (Brainstorming-Session, 2 Abschnitte einzeln bestätigt)
**Basis:** main nach Merge von PR #77 (Phase 50 UI-Konsistenz — Skalen-Tokens und Skalen-Gate sind Voraussetzung für die neuen CSS-Klassen)

## Ziel

Der Live-Tab wird die Multi-Kart-Zentrale: Bei mehreren Karts zeigt er standardmäßig die bestehende Kart-Übersicht (ein Karten-Raster, eine Karte pro Kart) mit den generellen Live-Daten **Speed und RPM groß nebeneinander**. Die Detail-Tiefe pro Kart liefern wie bisher die übrigen Tabs über die Kart-Auswahl — am Klick-Verhalten ändert sich nichts.

## Ist-Zustand (verifiziert 2026-07-16)

- `state.liveView ∈ {'single','overview'}` (store.js:25, nicht persistiert); Umschaltung über `setLiveView()` (live-ui.js:467), Body-Dataset `data-live-view`.
- Übersicht = `kart-overview.js`: rendert `#liveOverview` mit `ko-card` pro Kart — Position, Farb-Dot, Name, REC, ⚡FL, **Speed groß (30px)**, aktuelle/letzte/beste Runde (+Rundenzahl, Fahrer), Gap·Int, Fußzeile RSSI · Hz · Akku bzw. Stale-Marker. Klick: Kart aktiv setzen + `setLiveView('single')`.
- Toggle: `kart-overview-btn` in der Chip-Leiste (kart-bar.js:31), sichtbar ab 2 Karts; Auto-Rückfall auf `single` bei ≤1 Kart (live-ui.js:533) im Render-Pfad `refreshOverview()`.
- **RPM fehlt in den Karten**; die Übersicht ist nie Start-Ansicht.
- RPM-Daten: `k.telemetry.rpm` pro Kart (telemetry.js:156), Warnschwelle `settings.rpmWarning` (Default 9000); die Einzel-Ansicht nutzt sie für die globale Body-Warnung `rpm-warn` (live-ui.js:382) — die bleibt unverändert dem aktiven Kart vorbehalten.
- Settings-Persistenz: `Object.assign(state.settings, d.settings)` beim Laden (store.js:229) → neue Keys sind migrationssicher (fehlender Key = Default).

## Locked Decisions (User, 2026-07-16)

1. **Bestehende Übersicht ist die Basis** — erweitern, nichts Neues bauen.
2. **RPM groß neben Speed** — die zwei generellen Basiswerte pro Karte; übriger Karteninhalt unverändert.
3. **Übersicht wird Standard ab 2 Karts** — plus persistierte Einstellung (Ansatz B).
4. **Karten-Klick unverändert** — Kart aktiv + Live-Einzel-Ansicht; andere Tabs folgen dem aktiven Kart wie bisher.

## Verhalten

### Start-Ansicht (neue Einstellung `liveStartView`)

Werte: `'auto'` (Default) | `'single'` | `'overview'` — Settings-Zeile „Live-Start-Ansicht" in Einstellungen→Dashboard.

| Setting | Verhalten |
|---|---|
| `auto` | Beim Übergang der Kart-Zahl von <2 auf ≥2 automatisch auf Übersicht schalten. |
| `single` | Nie automatisch umschalten; Übersicht nur per Toggle. |
| `overview` | Wie `auto` (Übersicht sobald ≥2 Karts); zusätzlich startet der Tab nach App-Start in der Übersicht, sobald die Bedingung eintritt — auch wenn sie schon beim Laden erfüllt ist. |

Invarianten (gelten in allen Modi):
- **Manueller Vorrang:** Sobald der Nutzer in dieser Sitzung von Hand umschaltet (Übersicht-Button, Kart-Chip, Karten-Klick), schaltet die Automatik nicht mehr dagegen. Das Flag gilt pro Sitzung (nicht persistiert) und wird zurückgesetzt, wenn die Kart-Zahl unter 2 fällt.
- **≤1 Kart ⇒ Einzel-Ansicht** (bestehender Zwangs-Rückfall bleibt; er zählt nicht als manuelle Wahl).
- Ungültiger persistierter Wert ⇒ wie `auto` behandeln und beim nächsten Speichern geklemmt.

### Karteninhalt

Neue Groß-Wert-Zeile `ko-big` ersetzt die bisherige Solo-Speed-Zeile:
- Links **Speed** (`toFixed(0)` + „km/h"), rechts **RPM** (`Math.round`, fehlend/NaN → 0, + „rpm").
- Beide ~26px (statt bisher 30px Solo), damit die Kartenbreite nicht wächst; Einheiten-Labels klein.
- RPM-Wert bekommt Klasse `warn` (Farbe `var(--red)`), wenn `k.telemetry.rpm >= state.settings.rpmWarning` — pro Karte, unabhängig vom aktiven Kart.
- Alles andere auf der Karte bleibt byte-gleich (Runden-Zeilen, Position, Gap·Int, REC, ⚡FL, Fußzeile, Stale-/Overtake-Verhalten).

## Technik

### Betroffene Dateien

| Datei | Änderung |
|---|---|
| `src/store.js` | Settings-Default `liveStartView: 'auto'` |
| `src/settings.js` | `SETTINGS_INDEX`-Eintrag (Gruppe `dashboard`, rowId `rowLiveStartView`, Keywords: übersicht, overview, multi, kart, start, live) |
| `index.html` | Settings-Zeile `#rowLiveStartView` mit `<select id="setLiveStartView">` (Automatisch/Einzel/Übersicht) in der Dashboard-Gruppe — Namensmuster wie `setRpmWarn` |
| `src/settings-ui.js` | Laden/Speichern des Selects; Klemmen ungültiger Werte auf `auto` |
| `src/live-ui.js` | `setLiveView(mode, manual)` (Default `manual=false`); purer Reducer `liveViewAutoReducer` (siehe unten); Aufruf im bestehenden `refreshOverview()`-Pfad, wo heute schon der ≤1-Kart-Rückfall lebt; Kart-Zahl-Übergang modul-lokal getrackt |
| `src/kart-bar.js` | Toggle-Button und Chip-Klick rufen `setLiveView(…, true)` |
| `src/kart-overview.js` | `ko-big`-Markup (Speed + RPM + warn-Klasse); Karten-Klick ruft `setLiveView('single', true)` |
| `src/styles/pages/live-compact.css` | `.ko-big` (Flex, `gap` auf `--sp-*`), `.ko-speed`/`.ko-rpm` 26px (roh erlaubt: >20px), Einheiten `--fs-13`/`--fs-11`, `.ko-rpm.warn{color:var(--red)}` — muss das Phase-50-Skalen-Gate passieren |
| `e2e/screens.spec.js` | demo-live-Erwartung = Übersicht; neuer Shot Einzel-Ansicht nach Toggle; DYN-Masken für dynamische Kartenwerte |

Keine neuen Module; kein neuer State außer dem Setting und dem Session-Flag.

### Purer Reducer (testbar, Muster `gViewReducer`)

```
liveViewAutoReducer({ view, prevCount, count, setting, manual })
  → 'single' | 'overview' | null   (null = keine Änderung)
```

Regeln in Prioritätsreihenfolge (ungültiges `setting` vorab auf `'auto'` normalisiert):
1. `count <= 1` und `view === 'overview'` → `'single'` (Zwangs-Rückfall, wie heute).
2. `manual === true` → `null` (Hand-Wahl gewinnt).
3. `setting === 'single'` → `null`.
4. `setting === 'auto'`: **flanken-getriggert** — nur beim Übergang `prevCount < 2 ≤ count` → `'overview'`.
5. `setting === 'overview'`: **pegel-getriggert** — immer wenn `count >= 2` und `view === 'single'` → `'overview'` (korrigiert damit auch programmatische Einzel-Zustände ohne Zähl-Flanke, z. B. nach State-Restore).
6. sonst `null`.

Hinweis: Da Kart-Buckets erst mit dem ersten Paket entstehen (`state.karts.get()` on first sight), startet `count` nach App-Start praktisch immer bei 0 — `auto` feuert also auch beim Start zuverlässig über die Flanke, sobald das zweite Kart sendet.

### Datenfluss

Unverändert: Telemetrie-Pakete → `state.karts` → Render-Loop (`live-ui.js:542`) → `refreshOverview()` → `kart-overview.render(state)`. Der Reducer hängt im selben Pfad; das Setting wird direkt aus `state.settings` gelesen.

### Fehlerbehandlung

- `k.telemetry.rpm` fehlend/NaN → 0 (bestehendes `|| 0`-Muster; Karte zeigt „0 rpm", kein Wurf).
- Ungültiges `liveStartView` aus altem/korruptem JSON → Reducer behandelt es als `auto`, `settings-ui.js` klemmt beim nächsten Speichern.
- Kart-Registry leer/Übersicht ohne Element (`#liveOverview` fehlt) → bestehende Guards bleiben.

## Tests

- **Unit (node --test):** `liveViewAutoReducer` vollständig — Übergang <2→≥2 je Setting; manueller Vorrang; Zwangs-Rückfall ≤1; `overview`-Start nach App-Start; ungültiges Setting → auto-Semantik; Flag-Reset bei Count-Abfall. Der neue `SETTINGS_INDEX`-Eintrag läuft automatisch durch die bestehenden Index-Validitäts- und Filter-Tests.
- **E2E/Screenshots:** `demo-live` zeigt künftig die Übersicht (3 Demo-Karts ⇒ Auto-Umschaltung) — Baseline wird mit User-Freigabe neu eingefroren. Neuer Test „Live-Einzel nach Toggle" (expliziter Klick auf ein `ko-card`, dann Shot) ⇒ 13 → 14 Baselines. Dynamische Kartenwerte (Speed, RPM, Rundenzeiten) werden maskiert; **Maske und Baseline im selben Schritt** (Lektion Phase 49, Memory screenshot-gate-mechanik). `tab-settings`-Shot difft durch die neue Zeile ⇒ Neu-Freeze mit Freigabe.
- **Bestehende Suiten:** karts.spec/demo.spec unberührt (Karts-Tab und Demo-Logik unverändert); `npm test`-Zähler steigt um die Reducer-Tests.

## Nicht-Ziele / Abgrenzung

- Kein Redesign der Karten (Ansatz C verworfen) — Kartengröße und übriger Inhalt bleiben.
- Keine Änderung der übrigen Tabs: Detail-Tiefe pro Kart kommt weiterhin über die Kart-Auswahl (`activeKartMac`).
- Die globale `rpm-warn`-Vollbild-Warnung bleibt Einzel-Ansicht/aktives Kart; keine Mehr-Kart-Alarm-Logik (vgl. Memory: keine Lift/Lean-Alarme, Rollover-Schwelle unangetastet).
- Kein Pit-Wall-/OLED-Umbau.

## Manuelle Abnahme (nach Merge)

- [ ] Demo starten (3 Karts): Live-Tab springt automatisch in die Übersicht; Speed+RPM pro Karte plausibel.
- [ ] RPM über Warnschwelle drehen (Demo/echt): Wert auf der Karte wird rot, Vollbild-Warnung weiterhin nur beim aktiven Kart in Einzel-Ansicht.
- [ ] Manuell auf Einzel toggeln → Automatik schaltet in dieser Sitzung nicht zurück; App-Neustart → Automatik greift wieder.
- [ ] Einstellung „Einzel" setzen → keine Auto-Übersicht mehr; „Übersicht" → Start direkt in der Übersicht.
- [ ] Light-/Outdoor-Theme: ko-big-Zeile lesbar (CI testet nur dark).
