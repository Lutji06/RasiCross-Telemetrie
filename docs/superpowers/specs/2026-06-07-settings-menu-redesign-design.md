# RasiCross — Einstellungsmenü überarbeiten (Sidebar + Zeilen + Auto-Save)

**Datum:** 2026-06-07
**Branch:** `fix/lint-no-useless-assignment` (Redesign bekommt eigenen Feature-Branch bei der Umsetzung)
**Status:** freigegeben (Brainstorming abgeschlossen); Implementierungsplan ausstehend
**Bezug:** baut auf dem bestehenden Tab `#tab-settings` auf; keine Firmware, keine
neuen Build-Abhängigkeiten.

---

## 1. Ziel

Den Tab **Einstellungen** vom flachen 6-Karten-Raster zu einem **Sidebar-+-Panel-
Layout** mit **sauberen Zeilen** und **Auto-Save** umbauen. Vier zusammenhängende
Verbesserungen (entsprechen den vier im Brainstorming gewählten Punkten):

1. **Struktur & Navigation** — 6 thematische Gruppen in einer linken Sub-Sidebar;
   rechts wird nur die aktive Gruppe gezeigt. Kein Scrollen durch Fremdes.
2. **Optik & Hierarchie** — Zeilen-Stil (Label + Kurzbeschreibung links, Control
   rechts, dünne Trenner), Mono-Sektions-Header, echte Palette. Lime-Akzent nur
   dort, wo die App ihn ohnehin nutzt (aktive Gruppe, Fokus).
3. **Bedien-Logik vereinheitlichen** — der einzelne „Übernehmen"-Button entfällt;
   Wertefelder speichern automatisch beim `change`/Blur. Transienter
   „Automatisch gespeichert ✓"-Hinweis statt Toast. **Aktionen bleiben Buttons.**
4. **Inhalte umräumen** — Drift-/Umkipp-Felder wandern thematisch zur Sensorik,
   OLED-Intervall zur Hardware (siehe §4). Keine Funktion wird entfernt.

Bewusst **nicht** in diesem Durchgang: neue Einstellungen erfinden, das
Speicher-Schema (`state.settings`) ändern, Light/Dark-Theming anfassen. Siehe §7.

## 2. Verifizierte Ausgangslage

Geprüft in `RasiCross_Telemetry.html` und `rasicross.js` (Stand HEAD):

- **Markup:** `#tab-settings` (`HTML:3013`) ist ein `div.grid.g2` mit 6 `div.card`:
  *Anzeige & Skalen*, *IMU Kalibrierung*, *Kart-Modell*, *ESP32 Sender*, *Daten*,
  *Karten-Hintergrund*.
- **Tab-Umschaltung:** generisch über `.nav-item[data-tab]` → `.tab`-Sektionen
  (`rasicross.js:218‑`). Der Settings-Tab selbst hat **keine** interne Navigation.
- **Ein Save-Button für (fast) alles:** `$('saveSettingsBtn').onclick =
  saveSettingsFromUi` (`rasicross.js:3932`). `saveSettingsFromUi()` (`:395‑422`)
  liest, **klemmt** (min/max), wendet an, persistiert (`saveData()`) und toastet —
  und zwar **nicht nur Karte 1**, sondern: Dashboard-Skalen, Drift (`tol`,
  `minSpeedKmh`), Rollover (`angleDeg`), OLED-Intervall (mit
  `restartDisplayUpdateInterval()`), IMU-Kalibrier-Toggles (`invertGx/Gy`,
  `swapG`, `invertYaw`) **und** Tiles (`enabled`, `urlTemplate`).
- **Laden:** `loadSettingsToUi()` (`:368‑`) schreibt `state.settings` → UI und
  setzt den Hinweis `settingsHint`.
- **Persistenz:** alles hängt an `state.settings` / `state.calibration`, die via
  `saveData()`/`Object.assign` (`:130`, `:146`) in localStorage round-trippen.
  **Kein** neues Schema nötig.
- **Eigene Sofort-Handler existieren bereits** für das Tiles-Preset-Dropdown
  (`setTilesPreset`, `:311`/`:319`) — Auto-Save ist hier also schon teilweise
  Realität, nur uneinheitlich.
- **Aktionen sind schon eigene Buttons:** `zeroImuBtn`/`resetImuBtn`/`zeroRollBtn`
  (`:3942‑`), `espSendBtn` (`:3997`), `exportAllBtn`/`importAllBtn`/`resetAllBtn`,
  `tilesClearBtn`, `kartModelFile`/`kartModelResetBtn`, `kartModelYawToggle`
  (`:3718`). Die bleiben unverändert.
- **Etablierte Testbarkeits-Muster:** reine Reducer wie `kartModelYawReducer`
  und `gViewReducer` werden mit `node --test` geprüft
  (`test/karts3d.test.js`). DOM-Ziel-Auflösung wird über `dom-targets.js`
  (`targetIdsFor`, getestet in `test/test-dom-targets.js`) entkoppelt.

> Zeilennummern sind **indikativ** (CRLF-Repo); bei der Umsetzung pro Edit frisch
> lesen und auf Text ankern. Single-File-HTML + globale Skripte ⇒
> `package.json`/`eslint.config.js`/Script-Tags bleiben unverändert.

## 3. Locked decisions

Im Brainstorming bestätigt:

1. **Layout = Sidebar + Panel** (Variante A). Nicht: Top-Tabs, nicht: Single-Page
   mit Anker-Rail.
2. **Speicher-Modell = Live/Auto-Save** (Variante A). Wertefelder speichern beim
   `change`/Blur; kein „Übernehmen". Aktionen bleiben explizite Buttons.
3. **Optik = saubere Zeilen** (Variante B). Label + Kurzbeschreibung links, Control
   rechts, dünne Trenner. Kein Lime-Akzentstreifen pro Sektion (das war Variante
   C); Lime nur als bestehender Fokus-/Aktiv-Akzent.
4. **Gruppierung = 6 Gruppen** wie in §4, inkl. der dort genannten Umzüge.
5. **Element-IDs bleiben identisch.** Nur DOM-Position/Container und Trigger ändern
   sich; `state.settings`-Schema unverändert.

## 4. Gruppen-Struktur (Soll)

| # | Gruppe (Sidebar)            | Inhalt (bestehende IDs)                                                                 | Umzug |
|---|-----------------------------|----------------------------------------------------------------------------------------|-------|
| 1 | **Dashboard**               | `setMaxSpeed`, `setMaxRpm`, `setRpmWarn`, `setGScale`, `setMinLap`                      | —     |
| 2 | **Sensorik & Fahrdynamik**  | IMU: `gxOffsetText`/`gyOffsetText`, `setInvertGx/Gy`, `setSwapG`, `setInvertYaw`, Buttons `zeroImuBtn`/`resetImuBtn`/`zeroRollBtn`; **+ `setDriftTol`, `setDriftMinSpeed`, `setRolloverAngle`** | Drift/Rollover aus „Anzeige & Skalen" hierher |
| 3 | **ESP32 / Hardware**        | `espMaxRpm`, `espWarnRpm`, `espSendMs`, `espPulses`, `espWheelCirc`, `espGearRatio`, `espBattCells`, Button `espSendBtn`; **+ `setDisplayUpdateMs`** | OLED-Intervall aus „Anzeige & Skalen" hierher |
| 4 | **3D-Modell**               | `kartModelFile`, `kartModelResetBtn`, `kartModelName`, `kartModelYawToggle`             | —     |
| 5 | **Karten-Hintergrund**      | `setTilesEnabled`, `setTilesPreset`, `setTilesUrl`, `tilesClearBtn`, `tilesCacheInfo`   | —     |
| 6 | **Daten & Backup**          | `recAutoArmToggle`, `exportAllBtn`, `importAllBtn`, `importAllFile`, `resetAllBtn`      | —     |

Die Umzüge sind reine DOM-Verschiebungen — die JS-Verdrahtung greift weiter über
die unveränderten IDs.

## 5. Architektur & Komponenten

Single-File-HTML + `rasicross.js`. Drei reine, testbare Funktionen kapseln die
neue Logik; der Rest ist DOM-Verdrahtung im bestehenden Init-Block.

### 5.1 Sub-Navigation (rein, testbar)
`settingsNavReducer(current, action)` → neue aktive Gruppen-ID.
- Actions: `{type:'set', id}` (Klick in Sidebar), unbekannt/ungültig ⇒ identity,
  ungültige `current` ⇒ Fallback auf erste Gruppe (`'dashboard'`).
- Spiegelt `kartModelYawReducer`-Muster. Persistiert die zuletzt aktive Gruppe in
  `state.settings.uiActiveGroup` (rein additiv im Schema, optional).

### 5.2 Suche/Filter (rein, testbar)
`settingsFilter(query, index)` → `{groups:Set, rows:Set}` der Treffer.
- `index` ist eine statische, im Code definierte Liste `{group, rowId, label,
  keywords}` pro Einstellung (deutsch + Synonyme, z.B. „Tacho/Speed", „Akku/Batt").
- Leerer Query ⇒ alles sichtbar. Treffer in einer Gruppe ⇒ Gruppe bleibt in der
  Sidebar hervorgehoben; Klick springt zur ersten passenden Zeile.
- Reiner String-Match (case-insensitive, diakritik-tolerant), wirft nie.

### 5.3 Auto-Save-Verdrahtung (DOM)
- **Trigger umstellen:** statt `saveSettingsBtn.onclick` ein delegierter
  `change`-Listener am Settings-Container, der `saveSettingsFromUi()` aufruft.
  Zahlenfelder zusätzlich auf `blur` (fängt Tipp-Zwischenstände ab); kurzes
  Debounce (~150 ms) gegen Mehrfach-Speichern.
- **`saveSettingsFromUi()` bleibt inhaltlich gleich** (klemmt schon alles, ruft
  `saveData()`), nur:
  - der abschließende `rcToast('Einstellungen gespeichert')` wird durch einen
    **transienten Inline-Indikator** ersetzt („Automatisch gespeichert ✓", grün,
    ~1,5 s sichtbar, pro Panel-Header).
  - `loadSettingsToUi()` am Ende schreibt geklemmte Werte zurück (z.B. wenn
    `rpmWarning` an `maxRpm` gedeckelt wird) — visuelles Feedback der Klemmung.
- **`saveSettingsBtn` entfällt** aus dem Markup; Binding wird entfernt.

### 5.4 Markup/CSS
- `#tab-settings` → `div.settings-shell` mit `aside.settings-nav` (Suchfeld + 6
  Buttons `[data-sgroup]`) und `div.settings-panels` (6 `section.settings-group
  [data-sgroup]`, nur die aktive sichtbar).
- Neue CSS-Klassen (`.settings-row`, `.settings-row-label`, `.settings-row-desc`,
  `.settings-group-head`, aktive Nav via `.settings-nav button.active`) nutzen
  ausschließlich bestehende `--vars` (Lime `--pr`, `--surf*`, `--tx`, `--mut`,
  `--bor`). CSP bleibt eingehalten (keine Inline-Skripte, keine neuen externen
  Quellen).
- Responsiv: unter ~900 px klappt die Sidebar über den Panels zu horizontalen
  Pillen (Fenster-`minWidth` ist 900, daher Randfall).

## 6. Daten-Fluss, Fehler, Edge-Cases

- **Fluss:** Feld-`change` → Debounce → `saveSettingsFromUi()` → Clamp →
  `state.settings`/`state.calibration` → Live-Effekt (Gauges, `drawGMeter._trail`
  Reset, ggf. `restartDisplayUpdateInterval()`) → `saveData()` → Indikator.
- **Ungültige Eingaben:** vorhandene `min`/`max`-Clamps greifen; `loadSettingsToUi()`
  spiegelt den korrigierten Wert sofort zurück.
- **Persistenz-Fehler:** `saveData()` ist bereits gekapselt; bei Fehlschlag kein
  Indikator-„✓", sondern stiller Fallback (kein Crash).
- **ESP32-Werte:** werden wie heute lokal in der UI gehalten und gehen erst per
  `espSendBtn` an den Kart — Auto-Save betrifft sie **nicht** (sie hängen nicht an
  `state.settings`). Das bleibt bewusst ein Aktions-Button.
- **Such-Reset:** Tab-Wechsel weg/zurück leert das Suchfeld und stellt alle Zeilen
  sichtbar.

## 7. Bewusst nicht in diesem Durchgang (YAGNI)

- Keine neuen Einstellungen, kein Entfernen von Funktionen.
- Keine Änderung am `state.settings`-Schema außer optional additivem
  `uiActiveGroup`.
- Kein „Verwerfen/Undo" pro Sektion (folgt aus Auto-Save-Entscheidung).
- Kein Theming-Umbau; Light/Dark bleibt wie es ist.
- Kein Export der Such-Keywords in eine separate Datei (bleibt inline, solange
  überschaubar).

## 8. Tests & Verifikation

- **Neu, `node --test`** (passt in `.github/workflows/check.yml`):
  - `settingsNavReducer`: set/identity/Fallback bei ungültiger current & action.
  - `settingsFilter`: leerer Query → alles; Treffer (Label + Keyword); kein
    Treffer → leere Sets; Case-/Diakritik-Toleranz; wirft nie.
- **Bestehende Suites** müssen grün bleiben (83 JS + 38 Python).
- **Lint:** `npm run lint` + `ruff` sauber.
- **Manuell (DOM):** jede Gruppe öffnet ohne Scrollen; Wert ändern → „✓" +
  Persistenz über Reload; geklemmter Wert wird zurückgespiegelt; alle Aktions-
  Buttons funktionieren unverändert; Suche springt zur Zeile; OLED-Intervall-
  Änderung startet `restartDisplayUpdateInterval()`.

## 9. Risiko / Rollback

- **Risiko niedrig:** IDs unverändert, `saveSettingsFromUi()` inhaltlich
  unverändert, kein Schema-Bruch ⇒ Persistenz alter Nutzer bleibt kompatibel.
- **Größtes Restrisiko:** delegierter `change`-Listener feuert für Felder, die
  nicht in `saveSettingsFromUi()` gelesen werden (z.B. ESP32) — dann unnötiger,
  aber harmloser Save. Mitigation: Listener nur auf Wertefelder mit
  `data-autosave` scope-en.
- **Rollback:** rein im Frontend; ein Revert des Feature-Branches stellt das alte
  Menü her.
