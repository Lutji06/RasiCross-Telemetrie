# Kombinierter Multi-Kart-Fahrerdialog — Design (Phase 35)

**Datum:** 2026-06-25
**Branch:** `feat/combined-driver-dialog` (von `main` nach Phase 34/PR #54 abgezweigt)
**Status:** Design genehmigt, bereit für Implementierungsplan

## 1. Ziel

Heute gilt der „Fahrerwechsel"-Dialog für **einen** Kart — den per Chip
gewählten aktiven Kart (Phase 30, bewusst „pro Kart einzeln"). Phase 35 ersetzt
ihn durch einen **kombinierten Dialog**: eine Zeile je Teilnehmer-Kart mit einem
Fahrer-Dropdown (vorbelegt mit dem aktuellen Fahrer). Bestätigen wechselt in
einem Schritt die Fahrer **aller geänderten** Karts; unveränderte Karts bleiben
unberührt.

**Bewusster Schnitt:** Dies ist eine von mehreren verbleibenden Multi-Kart-
Slices. Track-Distance-Gap und synchrones Multi-Kart-Replay bleiben **eigene
spätere Phasen** (siehe §9).

## 2. Ausgangslage (bereits vorhanden)

- `RasiCross_Telemetry.html` (~Zeile 3701): `#driverModal`-Overlay mit Titel
  „Fahrerwechsel", **einem** `<select id="driverModalSelect">` (ein Fahrer) und
  den Buttons `#dmCancelBtn` / `#dmConfirmBtn`.
- `races.js` `openDriverChange()` (~195): nur bei laufendem Rennen; füllt das
  Single-Select via `renderDriverOptions()`, vorselektiert einen Nicht-aktuellen
  Fahrer, zeigt das Modal.
- `races.js` `confirmDriverChange()` (~205): liest den **einen** Select; wenn
  geändert, schließt es den offenen Stint des **aktiven** Teilnehmers
  (`activePart(r)`), setzt `currentDriverId` und pusht einen neuen Stint
  `{ id: uid(), driverId, startAt, endAt: null }`.
- `laps-drivers.js` `renderDriverOptions()` (~355): befüllt `#newRaceDriver`
  **und** `#driverModalSelect` mit `<option>`s aller `state.drivers`.
- `lap-engine.js`: reines UMD `window.RasiLapEngine`, hält das Teilnehmer-/Stint-
  Datenmodell (`participantsOf`, `getOrCreatePart`, `commitLap` …), `node:test`.
- Teilnehmer existieren nur während eines laufenden Rennens
  (`race.participants[mac]`, je mit `currentDriverId` + `stints`-Historie).

## 3. Architektur

Gleiche bewährte Form: reine Stint-Logik in `lap-engine.js` (TDD'd), dünne
DOM-Verdrahtung in `races.js`/HTML.

### 3.1 `applyDriverChange` (rein, TDD)

Neue Funktion in `lap-engine.js` (analog zu `commitLap`):

```js
applyDriverChange(part, newDriverId, now) → stint
```

- Schließt den **offenen** Stint (`part.stints[last].endAt = now`, falls
  vorhanden und noch offen).
- Setzt `part.currentDriverId = newDriverId`.
- Pusht einen neuen Stint `{ driverId: newDriverId, startAt: now, endAt: null }`
  in `part.stints` und gibt ihn zurück.
- **Ohne `id`** — der Aufrufer setzt `stint.id = uid()` (wie `commitLap`
  `res.lap.id = uid()`; `uid` ist eine App-Global, nicht im reinen Modul).
- Idempotent gegen bereits geschlossene Stints: ein letzter Stint mit `endAt`
  wird **nicht** erneut geschlossen.

### 3.2 HTML — Dialog-Körper

Im `#driverModal` wird das einzelne Select-Feld durch einen Container ersetzt:

```html
<div id="driverModalList"></div>
```

Titel („Fahrerwechsel") und Buttons (`#dmCancelBtn`/`#dmConfirmBtn`) bleiben.
`races.js` füllt `#driverModalList` mit einer Zeile je Teilnehmer-Kart. CSS für
die Zeile (Farbpunkt + Name + Select) kommt klein dazu.

### 3.3 `races.js` — Rendern + Bestätigen

- **`openDriverChange()`:** Guard (laufendes Rennen) bleibt. Für jeden
  `RasiLapEngine.participantsOf(r)` eine Zeile rendern:
  - Farbpunkt + Kart-Name aus `state.kartMeta[mac]` (Fallback „Kart");
  - `<select data-mac="…">` mit `<option>`s aller `state.drivers`,
    **vorselektiert auf `part.currentDriverId`**.
  - Zeilen in `#driverModalList` schreiben, Modal zeigen.
- **`confirmDriverChange()`:** über `participantsOf(r)` iterieren; je Zeile den
  Select per `data-mac` lesen; **nur wenn** der Wert gesetzt ist **und** vom
  `part.currentDriverId` abweicht → `applyDriverChange(part, value, now)` +
  `stint.id = uid()`. Anzahl Änderungen zählen. Modal schließen, `renderRaces()`,
  `saveDataDebounced()`, Toast (`N Fahrer gewechselt` bzw. `Keine Änderung`).
- **Helfer `driverOptionsHtml(selectedId)`** (DOM-String): `<option>`-Liste aller
  Fahrer mit dem aktuellen `selected`.
- **Cleanup `renderDriverOptions()`** (`laps-drivers.js`): der `#driverModalSelect`-
  Zweig (`sel2`) entfällt (Element existiert nicht mehr); `#newRaceDriver`
  bleibt unverändert.

### 3.4 Datenfluss

```
„Fahrer wechseln" (laufendes Rennen)
  → openDriverChange: je Teilnehmer eine Zeile (Farbe/Name + Select=currentDriver)
Confirm
  → je Teilnehmer: sel = Zeile[data-mac].value
     wenn sel && sel != part.currentDriverId:
        applyDriverChange(part, sel, now); stint.id = uid()
  → Toast(Anzahl), renderRaces, save
```

## 4. Randfälle

1. **Single-Teilnehmer:** genau eine Zeile → Effekt wie der heutige Einzel-Dialog.
2. **Keine Änderung:** Confirm ohne abweichende Auswahl → keine Stints erzeugt,
   Toast „Keine Änderung".
3. **Rennen nicht laufend:** Dialog öffnet nicht (Guard wie heute).
4. **Mehrere Karts gleichzeitig geändert:** jeder geänderte Kart bekommt seinen
   eigenen neuen Stint; Stint-Historie je Kart bleibt korrekt (Phase-30-Modell).
5. **Kart ohne Meta-Namen (Default-Bucket):** Fallback-Label „Kart"; Funktion
   unverändert.
6. **Keine Fahrer angelegt:** Selects zeigen — wie heute — „Keine Fahrer"; Confirm
   ohne gültige Auswahl wechselt nichts.

## 5. Tests / Verifikation

- **Neue reine Logik wird TDD'd** in `lap-engine.js` (`test/lap-engine.test.js`):
  - `applyDriverChange`: schließt offenen Stint + öffnet neuen (`currentDriverId`,
    `startAt`, `endAt:null`); auf leeren Stints öffnet nur; schließt einen bereits
    geschlossenen letzten Stint **nicht** erneut; erzeugt Stint **ohne** `id`.
  - Baseline `node --test` wächst von **162** um die neuen `applyDriverChange`-Tests.
- **DOM-Verdrahtung** (`races.js`, HTML, `renderDriverOptions`-Cleanup):
  `node --check` + `npx eslint` + Grep-Asserts; bestehende Baselines grün. Die
  Dialog-Interaktion selbst wird **nicht** unit-getestet — manuelle Akzeptanz (§7).
- **Python unverändert:** `py_compile` + `unittest` → **50 OK**.

## 6. Betroffene Dateien

| Aktion | Datei | Verantwortung |
|--------|-------|---------------|
| Ändern | `lap-engine.js` | Neue reine `applyDriverChange(part, newDriverId, now)`; im UMD-Return exportieren. |
| Ändern | `test/lap-engine.test.js` | `node:test`-Fälle für `applyDriverChange`. |
| Ändern | `RasiCross_Telemetry.html` | `#driverModalSelect`-Feld → `#driverModalList`-Container; kleine Zeilen-CSS. |
| Ändern | `races.js` | `openDriverChange` rendert Zeilen je Teilnehmer; `confirmDriverChange` schleift über Teilnehmer mit `applyDriverChange`; Helfer `driverOptionsHtml`. |
| Ändern | `laps-drivers.js` | `renderDriverOptions`: toten `#driverModalSelect`-Zweig entfernen. |

`kart-overview.js`, `map-draw.js`, `geo.js`, `pit-wall.js`, `live-ui.js`,
`package.json`, `eslint.config.js` bleiben **unverändert** (alle benötigten
Globals — `RasiLapEngine`, `uid`, `state`, `esc`, `renderRaces` — sind im
`races.js`-Block bereits deklariert).

## 7. Manuelle Akzeptanz (Nutzer, Hardware/zwei Karts)

1. **Mehrzeiliger Dialog:** „Fahrer wechseln" zeigt eine Zeile je verbundenem
   Teilnehmer-Kart (Farbe/Name + Fahrer-Dropdown, vorbelegt mit aktuellem Fahrer).
2. **Selektives Wechseln:** Ändere zwei Karts, lasse einen unverändert → nur die
   zwei bekommen einen neuen Stint; Toast „2 Fahrer gewechselt".
3. **Keine Änderung:** Confirm ohne Änderung → „Keine Änderung", keine neuen Stints.
4. **Single-Kart-Regression:** mit einem Kart eine Zeile, Wechsel wie vor Phase 35.
5. **Stint-Historie:** Renn-Details zeigen die neuen Stints korrekt je Kart.

## 8. Risiken / offene Punkte

- **Toten Single-Select-Pfad sauber entfernen:** `#driverModalSelect` wird aus
  HTML entfernt; `renderDriverOptions` darf danach nicht ins Leere greifen
  (Zweig entfernen). Andere Aufrufer von `renderDriverOptions` (`#newRaceDriver`)
  bleiben unberührt.
- **Dialoggröße bei vielen Karts:** ≤MAX_KARTS Zeilen passen ins Modal; ggf.
  scrollbarer Container — kleine CSS-Vorsorge.
- **Save-Format unverändert:** nur zusätzliche Stints im bestehenden
  `participant.stints`-Array; keine neuen Felder, kein Migrationsbedarf.

## 9. Bewusst nicht enthalten (spätere Phasen)

- **Momentaner Streckenabstand-Gap** (eigene Spec — Ranking + Geo-Distanz).
- **Synchrones Multi-Kart-Replay** (eigene große Spec — `replay.js` + Aufnahme).
- **Fahrer-Schnellzuweisung / Presets** (über das einfache Dropdown hinaus).

## 10. Phase Map

- **Phase 30:** Per-Kart-Stints + „pro Kart einzeln"-Fahrerwechsel.
- **Phase 31–34:** Leaderboard, Polish, Live-Overlay, Map-Marker-Polish.
- **Phase 35 (dieses Design):** Kombinierter Multi-Kart-Fahrerdialog (eine Zeile
  je Kart, nur Geänderte committen).
- **Phasen 36+ (deferred):** momentaner Streckenabstand-Gap, synchrones Replay.
