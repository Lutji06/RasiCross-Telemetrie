# Multikart-Verbesserungen — Design (Phase 39)

**Datum:** 2026-07-02
**Status:** Freigegeben (User-Approval im Design-Dialog)
**Umfang:** Bugfixes + UI-Polish + Multikart-Demo (per-Kart-OLED-Routing explizit ausgeklammert)

## Kontext

Die Multikart-Funktion (Phasen 28–36) ist funktional komplett: MAC-Registry
(`kart-registry.js`), Aktiv-Kart-Fassade (`rasicross.js`), per-Kart-Rundenerkennung
(`laps-drivers.js`), Teilnehmer-Modell (`lap-engine.js`), Chip-Leiste (`kart-bar.js`),
Übersicht-Grid (`kart-overview.js`), Karten-Marker (`map-draw.js`), Verbindungs-Liste
(`pit-wall.js`). Eine Überprüfung am 2026-07-02 fand sechs funktionale Bugs, zwei
funktionale Lücken und mehrere UI-Schwächen. Diese Phase behebt die Bugs, wertet die
Oberfläche auf und macht Multikart im Demo-Modus ohne Hardware erlebbar.

## Befunde (verifiziert gegen den Code)

| # | Befund | Ort |
|---|--------|-----|
| B1 | „Karts zurücksetzen" verliert Kalibrierung + Motorstunden: `saveData()` persistiert `kartsCal`/`kartsEngine` nur aus der aktuellen Registry; nach `resetKarts()` ist sie leer → nächster Save überschreibt alles. | rasicross.js `saveData()`, pit-wall.js `resetKarts()` |
| B2 | Dauertoast bei 5. Kart: `processTelemetry` toastet bei vollem Limit pro Paket (~12 Hz); `rcToast` ersetzt Text+Timer → Toast bleibt permanent, überdeckt andere Meldungen. | rasicross.js `processTelemetry` |
| B3 | Phantom-Teilnehmer: `activePart()` (races.js) und Pit-Wall/`buildRaceDataForKart`/`renderLapTable` nutzen `getOrCreatePart` im Lese-/Render-Pfad → bloßes Anzeigen legt leere Teilnehmer-Slots an (auch in beendeten Rennen). | races.js, pit-wall.js, laps-drivers.js |
| B4 | localStorage-Write im Render-Loop: `RasiKartBar.metaFor` ruft bei jedem Aufruf `saveMeta` (Übersicht: pro Kart, bis 5 Hz). | kart-bar.js |
| B5 | Ranking ungecacht im 60fps-Loop: map-draw rechnet `traceDistanceM` + `trackProgressM` über alle Trackpunkte × Karts jeden Frame; kart-overview dupliziert dieselbe Logik. | map-draw.js, kart-overview.js |
| B6 | Verschachtelte `<button>` im Kart-Chip (invalides HTML, Tastatur/Screenreader kaputt). | kart-bar.js |
| L1 | Demo-Modus simuliert nur 1 Kart → Multikart-UI ohne Hardware nicht testbar. | serial-demo.js |
| L2 | (Ausgeklammert) OLED-Updates gehen nur an den aktiven Kart. | pit-wall.js — separater Phase-Kandidat |
| U1 | Übersicht-Karten: keine letzte Runde, kein Fahrername, kein RSSI/Hz/Akku, stale nur gedimmt ohne Alter. | kart-overview.js |
| U2 | Kein Leaderboard in der Einzelansicht (Ranking nur im Übersicht-Grid). | live-ui.js / HTML |
| U3 | Chip-Leiste: sekündlicher Voll-Rebuild (Focus-Verlust); Popover-Outside-Click prüft gegen veralteten Anker. | kart-bar.js |

## Design-Entscheidungen (locked)

### D1 — Persist-Map für Kalibrierung/Motorstunden (B1)
- `loadData()` merkt sich die geladenen `kartsCal`/`kartsEngine` in einer modul-lokalen
  Persist-Map (`_persistedKarts = { cal: {...}, eng: {...} }`).
- `saveData()` schreibt `Object.assign({}, persisted, aktuelleRegistry)` — Registry
  gewinnt bei Konflikt; das Ergebnis wird die neue Persist-Map.
- `kartFor()` hydratisiert neu angelegte Buckets bekannter MACs aus der Persist-Map
  (Kalibrierung + Motorstunden), bevor der Default-Bucket-Adoptions-Pfad läuft.
- `forgetKart()` (✏ → Vergessen) löscht den Persist-Eintrag der MAC mit (bewusstes
  Vergessen). `resetKarts()` löscht NICHT (Dialogtext wird ergänzt: „Namen/Farben,
  Kalibrierung und Motorstunden bleiben erhalten.").
- Save-Format bleibt 9.6 / additiv — keine neuen Top-Level-Keys.

### D2 — Toast einmal pro MAC (B2)
Modul-lokales Set `_maxKartsToasted`; Toast „Max. 4 Karts — <mac> ignoriert" nur beim
ersten Paket einer unbekannten Über-Limit-MAC pro Session.

### D3 — `RasiLapEngine.partOf(r, mac)` (B3)
Neue pure Lookup-Funktion (kein Anlegen, `null` wenn nicht Teilnehmer), TDD via
node:test. Umstellung aller Lese-/Render-Pfade:
- `activePart()` (races.js) → `partOf` + Null-Guards bei Aufrufern (`currentStint`,
  `renderStints`, Hero-Stint-Count).
- Pit-Wall `_pwPart` → `partOf` (Anzeige `0` Runden wenn kein Teilnehmer).
- `buildRaceDataForKart` `_oledPart` → `partOf` (validLaps=0-Fallback).
- `renderLapTable` `_p` → `partOf` (leere Tabelle wenn kein Teilnehmer).
Teilnehmer entstehen nur noch in `startRace()` und im Nachzügler-Pfad von
`processTelemetry` (laufendes Rennen).

### D4 — Gemeinsames Ranking-Modul `kart-rank.js` (B5, konsumiert von U2)
Neues Browser-Modul `window.RasiKartRank`:
- `ranking(state, r)` → `{ ranked, posByMac, hasTrack }` oder `null` (kein laufendes
  Rennen / <2 Teilnehmer).
- Intern: 250-ms-Memo auf das Gesamtergebnis; Track-Länge (`traceDistanceM`) und
  Gate-Offset gecacht, invalidiert wenn `state.track.points`-Referenz/-Länge oder
  Gate-Koordinaten sich ändern.
- map-draw.js und kart-overview.js ersetzen ihre duplizierte `buildProgress`-Logik
  durch `RasiKartRank.ranking()`. Overtake-Erkennung (positionGains + Timestamps)
  bleibt je Konsument modul-lokal (eigene visuelle Zustände).
- Script-Ladereihenfolge: nach geo.js/lap-engine.js, vor map-draw.js/kart-overview.js.

### D5 — `metaFor` schreibt nur bei Neuanlage (B4)
`metaFor(meta, mac, idx)` liefert zusätzlich, ob ein Eintrag neu angelegt wurde;
`saveMeta` läuft nur dann. `render()` speichert einmal am Ende nur bei Änderungen.

### D6 — Chip-Markup valide (B6, U3)
- Chip wird `<div class="kart-chip">` mit zwei Geschwister-Buttons:
  `<button class="kart-chip-main">` (Name + Stats, wählt Kart) und
  `<button class="kart-edit">` (öffnet Popover). CSS so angepasst, dass die Optik
  unverändert bleibt (Chip-Rahmen/Hover auf dem div, Buttons unsichtbar gerahmt).
- Popover-Outside-Click: statt Element-Identität (`ev.target !== anchorEl`) prüft der
  Handler `ev.target.closest('.kart-edit')` — überlebt Chip-Rebuilds.
- Focus-Erhalt beim Rebuild: vor `innerHTML=''` merken, welche MAC/Rolle den Fokus
  hat (`document.activeElement`), danach wiederherstellen.

### D7 — Übersicht-Karten (U1)
Je Karte zusätzlich (kompakt, bestehende Kartengröße bleibt):
- Zeile **Letzte Runde** (letzter Lap des Teilnehmer-Slots, `--:--.---` ohne).
- Fahrername im Sub-Text: `Runde N · Best RN · <Fahrer>` (aus
  `part.currentDriverId` → `state.drivers`; entfällt ohne Rennen).
- Fußzeile `<RSSI> dBm · <Hz> Hz · <Akku-%>` (Akku nur wenn `batt.present`).
- Stale: zusätzlich zum Dimmen Alterstext „vor Ns" statt der Fußzeilen-Werte.

### D8 — Leaderboard-Strip in der Einzelansicht (U2)
Neues Element `#liveLeaderStrip` direkt unter `#kartBar` (nur Live-Tab, Einzelansicht,
laufendes Rennen mit ≥2 Teilnehmern — sonst `display:none`):
- Eine Zeile: `P1 <Name>` (Leader) dann `P2 <Name> +12 m` … (Interval zum Vordermann,
  `+N Rd.` bei Rundenrückstand, `--` ohne Strecke). Kart-Farbpunkt je Eintrag,
  aktiver Kart hervorgehoben, ⚡ beim Fastest-Lap-Halter.
- Klick auf Eintrag wählt den Kart (wie Chip-Klick).
- Render im 1-Hz-Loop + `refreshOverview`-Pfad; konsumiert `RasiKartRank.ranking()`.

### D9 — Multikart-Demo (L1)
`serial-demo.js` simuliert **3 Karts** (`DE:MO:RA:SI:00:01/02/03`):
- Gemeinsame Demo-Strecke; Karts starten mit Phasenversatz und leicht
  unterschiedlichen Grundgeschwindigkeiten (≈2–4 % Spreizung) → Überholvorgänge,
  unterschiedliche Rundenzeiten, plausible Gaps.
- Jeder Tick sendet pro Kart ein Paket mit eigener `from_mac`, RSSI-Jitter
  (−55…−75 dBm), Akku-Werten (unterschiedliche SoC-Startwerte, langsam fallend).
- `state._kartHz[mac]` wird sekündlich aus der Paketrate gesetzt (Chips zeigen Hz).
- Demo-Race: `startDemo` legt wie bisher automatisch ein Rennen an; `startRace`
  nimmt alle registrierten Karts als Teilnehmer auf (bestehender Pfad).
- Kein Umschalter (User-Entscheid): Demo ist immer 3 Karts; Einzelansicht eines
  Karts bleibt per Chip-Klick erreichbar.

## Fehlerbehandlung
- `partOf`-Umstellung: alle Aufrufer haben explizite Null-Pfade (leere Tabelle,
  0-Werte, `--`), keine Exceptions im Render-Loop.
- `kart-rank.js` kapselt alles in try/catch analog map-draw (Render-Loops dürfen
  nie crashen); Memo-Fehler → Neuberechnung.
- Persist-Map-Merge ist rein additiv; kaputte/fehlende localStorage-Einträge fallen
  auf `{}` zurück (bestehendes Muster in `loadData`).

## Tests
- **node:test (neu):** `lap-engine`: `partOf` (existiert/existiert nicht/kein
  participants-Objekt). Reine Ranking-Memo-Hilfslogik nur, falls als pure Funktion
  extrahierbar ohne DOM/state — sonst grep-static + Demo-Smoke.
- **Bestehende Baselines bleiben grün:** `node --test` (Auto-Discovery `test/`),
  `node --check` auf allen geänderten JS-Dateien, `python -m unittest` unverändert
  (kein Python-Touch in dieser Phase).
- **Manuelle Abnahme (Demo-Modus, ohne Hardware):** 3 Chips + Übersicht + Ranking +
  Karten-Marker + Leaderboard-Strip sichtbar; Karts zurücksetzen → Motorstunden
  bleiben nach Reconnect erhalten; Rennen mit 3 Demo-Karts läuft inkl. Überholungen.

## Nicht-Ziele
- Per-Kart-OLED-Display-Routing (L2) — eigener Phase-Kandidat (berührt Sendepfad,
  RF-Budget, Firmware-Verhalten).
- Änderungen an sender.py/bridge.py — diese Phase ist rein Dashboard-seitig.
- Persistenz-Versionssprung — 9.6-Format bleibt (siehe Memory „Versioning").
