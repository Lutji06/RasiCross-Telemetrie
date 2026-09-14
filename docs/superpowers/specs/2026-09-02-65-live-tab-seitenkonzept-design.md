# Phase 65 — Live-Tab als Seitenkonzept + Multi-Kart-Korrekturen (Design)

**Datum:** 2026-09-02 · **Status:** vom User freigegeben (Brainstorming-Session, fünf Entscheidungen einzeln bestätigt)
**Basis:** `main` nach Merge von PR #97 (Phase 62 Bewegungsschicht) und PR #98 (IMU-Einbaulage)

## Ziel

Der Live-Tab wird ein Blätterwerk statt eines Moduswechsels: **Seite 1 ist die Übersicht** — Streckenkarte mit allen Karts, Leaderboard bei laufendem Rennen, Geschwindigkeit je Kart. **Seite 2..n ist je ein Kart**, inhaltlich unverändert zur heutigen Einzelansicht. Dazu werden zwei Multi-Kart-Fehler behoben, die bei der Prüfung des Ist-Zustands aufgefallen sind.

## Ist-Zustand (verifiziert 2026-09-02, gemessen an der laufenden App)

Gemessen mit einem Wegwerf-Playwright-Lauf gegen den Demo-Modus (drei Karts, 35 s Laufzeit):

```
macs      = ["default","DE:MO:RA:SI:00:01","DE:MO:RA:SI:00:02","DE:MO:RA:SI:00:03"]
karten    = 4          (gerenderte .ko-card)
leader    = "none"     (getComputedStyle #liveLeaderStrip)
karte     = "none"     (getComputedStyle #tab-live .pw-live-body)
speeds    = [0, 47, 51, 65]
defaultHatPakete = false
```

- **Der `default`-Bucket ist ein Phantom-Kart.** `activeKart()` (`store.js:52`) fällt auf `state.karts.get(DEFAULT_MAC)` zurück, und `get()` (`kart-registry.js:64`) legt jede unbekannte MAC an. Der erste Lesezugriff ohne verbundenes Kart erzeugt also einen Eintrag, der nie ein Paket empfängt und dauerhaft in `macs()` bleibt. Folgen: eine tote vierte Kachel mit 0 km/h; bei genau einem echten Kart zwei Chips in der Leiste (`kart-bar.js:23` blendet erst bei `macs.length <= 1` aus); und weil `MAX_KARTS = 4` gilt (`kart-registry.js:10`), **bekommt ein viertes echtes Kart keinen Platz mehr**.
- **Die Übersicht blendet genau das aus, was sie zeigen soll.** `live-compact.css:56` versteckt den Leaderboard-Streifen, `live-compact.css:64-65` die gesamte `.pw-live-body` samt Karte.
- **Karte und Leaderboard existieren bereits vollständig.** `drawKartMarkersOn()` (`map-draw.js:147`) zeichnet Marker für alle `state.karts.macs()` inklusive Positions-Badges und Overtake-Glow. `renderLeaderStrip()` (`live-ui.js:508`) rendert P1..Pn mit Interval und ⚡Fastest-Lap — aber `live-ui.js:513` schaltet es in der Übersicht bewusst ab.
- **Die Seitennavigation existiert bereits.** `kart-bar.js:29-33` rendert einen „⊞ Übersicht"-Knopf als erstes Element, danach einen farbigen Chip je Kart; Klick ruft `setLiveView()` bzw. setzt das aktive Kart.
- **Zustand heute:** `state.liveView ∈ {'single','overview'}` (`store.js:25`, nicht persistiert), gesetzt über `setLiveView()` (`live-ui.js:489`), gespiegelt nach `document.body.dataset.liveView`. Die Automatik sitzt in `liveViewAutoReducer()` (`live-view.js:18`, `node:test`-abgedeckt) und wird aus `live-ui.js:561` mit der Einstellung `state.settings.liveStartView` gefüttert.

## Locked Decisions (User, 2026-09-02)

1. **Kart-Leiste ist die Seitenwahl** — „⊞ Übersicht" plus ein Chip je Kart, Klick blättert. Kein zweites Bedienelement, keine Wischgesten.
2. **Übersichts-Layout:** Karte links, Leaderboard rechts als hohe Liste, Kart-Kacheln unten über die volle Breite.
3. **Kart-Seiten bleiben inhaltlich unverändert** — Tacho, Drehzahl, G-Meter, Karte mit Ghost-Runde, Rundentabelle, Sektor-Panel.
4. **Bei genau einem Kart entfällt die Übersicht** — die App startet direkt auf der Kart-Seite, die Leiste bleibt ausgeblendet.
5. **Die Einstellung „Start-Ansicht" wird entfernt** — Verhalten ist fest.

> **Diese Spec hebt Locked Decision 3 aus Phase 55 auf** („Übersicht wird Standard ab 2 Karts — plus persistierte Einstellung"). Die Einstellung `liveStartView` mit ihren drei Modi und dem Sitzungs-Flag „manueller Vorrang" war nötig, solange Übersicht und Einzelansicht gleichrangige Modi waren. Als Seite 1 eines Blätterwerks braucht die Übersicht keine Automatik mehr: Sie ist der Startpunkt, und der Nutzer blättert weiter. Der Wegfall ist damit kein Rückschritt, sondern die Folge des neuen Modells.

## Verhalten

### Seitenmodell

| Seite | Inhalt |
|---|---|
| 0 | Übersicht: Karte (alle Karts), Leaderboard (nur bei laufendem Rennen mit ≥2 Teilnehmern), Kacheln mit Geschwindigkeit und Rundenzeiten |
| 1..n | je ein Kart in der Reihenfolge der Leiste, Inhalt wie die heutige Einzelansicht |

Regeln der reinen Logik:

- **≤ 1 Kart:** Es gibt keine Seite 0. Die einzige Seite ist das Kart selbst.
- **Klemmen:** Eine Seitenzahl außerhalb des gültigen Bereichs wird auf den nächstgelegenen gültigen Wert gezogen.
- **Verschwundenes Kart:** Steht der Nutzer auf der Seite eines Karts, das aus der Liste fällt, landet er auf der Übersicht (bzw. auf dem verbleibenden Kart, wenn nur noch eines übrig ist).
- **Neues Kart:** Ändert die aktuelle Seite nicht. Wer auf Kart 2 steht, bleibt auf Kart 2.
- **Start:** immer Seite 0, sofern es sie gibt.

Die Funktion wirft nie und ist ohne DOM testbar.

### Schnittstelle nach außen bleibt

`state.liveView` (`'overview'` / `'single'`) und `document.body.dataset.liveView` bleiben bestehen, werden aber aus der Seite *abgeleitet*: Seite 0 → `'overview'`, sonst `'single'`. Damit funktionieren die bestehenden CSS-Regeln, `kart-overview.js`, `kart-bar.js` und die Screenshot-Tests unverändert weiter. Ausgetauscht wird die Herleitung, nicht die Schnittstelle.

### Übersichts-Layout

Kein Ausblenden mehr, sondern Umordnen. `.pw-live-body` ist bereits ein Raster und bekommt in der Übersicht ein anderes Grid:

Mit laufendem Rennen (Leaderboard rechts):

```
[ ⊞ Übersicht ] [ ● Kart 1 ] [ ● Kart 2 ] [ ● Kart 3 ]
+---------------------------------+---------------------+
|                                 |  P1  Kart 2   +12 m |
|          KARTE                  |  P2  Kart 1   +40 m |
|   alle Karts als Marker         |  P3  Kart 3   +1 Rd |
|                                 |                     |
+---------------------------------+---------------------+
|  [ Kart1  47 km/h ] [ Kart2  51 ] [ Kart3  65 ]       |
+-------------------------------------------------------+
```

Ohne laufendes Rennen entfällt die rechte Spalte, die Karte nimmt die volle Breite:

```
[ ⊞ Übersicht ] [ ● Kart 1 ] [ ● Kart 2 ] [ ● Kart 3 ]
+-------------------------------------------------------+
|                                                       |
|                      KARTE                            |
|              alle Karts als Marker                    |
|                                                       |
+-------------------------------------------------------+
|  [ Kart1  47 km/h ] [ Kart2  51 ] [ Kart3  65 ]       |
+-------------------------------------------------------+
```

- Die Karte bleibt physisch, wo sie ist (`.pw-live-map`) — **ein Canvas, keine zweite Zeichnung, kein DOM-Verschieben.**
- `.pw-live-laps` (Rundentabelle) und `.pw-live-side` (KPI/Sektor/G-Meter) sind auf Seite 0 ausgeblendet.
- **Der Leaderboard erscheint auf Seite 0 nur rechts, nicht zusätzlich als Streifen oben.** Dasselbe Element `#liveLeaderStrip` trägt auf Seite 0 eine Klasse für das hohe Listen-Layout und behält auf den Kart-Seiten den flachen Streifen — ein Renderer, zwei Darstellungen, unterschieden per CSS.
- Die Bedingung fürs Erscheinen bleibt unverändert die heutige (`renderLeaderStrip`: laufendes Rennen mit verwertbarem Ranking). Fällt sie weg, kollabiert die rechte Spalte und das Raster wird einspaltig — die Karte wächst, es entsteht kein Loch.
- `#liveOverview` (die Kacheln) rutscht unter das Raster über die volle Breite.

### `default`-Korrektur

**Lesen legt nichts an, Schreiben schon.**

- `kart-registry.js` bekommt einen Lesezugriff, der einen fehlenden Bucket **nicht** registriert.
- `activeKart()` nutzt diesen Lesezugriff und fällt auf einen nicht registrierten Leerzustand zurück, wenn noch kein Kart bekannt ist. Die Oberfläche kann damit weiter gefahrlos Felder lesen.
- `kartFor()` (der Paketpfad) registriert unverändert. **Wichtig:** Pakete ohne `from_mac` laufen legitim auf `DEFAULT_MAC` — ein solches Kart muss weiterhin entstehen können. Der Fehler ist nur das Anlegen *ohne* Daten.

Folge: keine tote Kachel, kein doppelter Chip bei einem Kart, und der vierte Slot ist wieder frei.

## Nicht-Ziele

- Keine Änderung an Inhalt oder Layout der Kart-Seiten.
- Keine Wischgesten, kein Pfeil-Pager, keine Tastaturnavigation zwischen Seiten.
- `MAX_KARTS` bleibt bei 4.
- Keine Änderung am Ranking (`kart-rank.js`), an der Rundenlogik oder an der Kartenzeichnung selbst.
- Die Kacheln behalten ihren Inhalt; sie wandern nur an eine andere Stelle.

## Technik

| Datei | Änderung |
|---|---|
| `src/live-view.js` | `liveViewAutoReducer` entfällt; neue reine Funktion für das Seitenmodell (Seite → `{page, view, mac}`) |
| `test/live-view.test.js` | auf das Seitenmodell umgeschrieben |
| `src/live-ui.js` | `setLiveView` wird zum Seitenwechsel; Automatik-Block (`live-ui.js:556-566`) entfällt; Leaderboard auch auf Seite 0 |
| `src/kart-bar.js` | Chips als Seitenwahl, aktiver Zustand aus der Seite abgeleitet |
| `src/kart-registry.js` | Lesezugriff ohne Registrierung |
| `src/store.js` | `activeKart()` nutzt den Lesezugriff; Settings-Default `liveStartView` entfällt |
| `src/styles/pages/live-compact.css` | Ausblendregeln → Umordnung; Listen-Layout für den Leaderboard |
| `index.html` | Settings-Zeile `#setLiveStartView` entfernt |
| `src/settings.js`, `src/settings-ui.js` | Index-Eintrag und Laden/Speichern der Einstellung entfernt |

## Verifikation

- **Reine Logik:** `node:test` für das Seitenmodell — ≤1 Kart, Klemmen, verschwundenes Kart, neues Kart ändert die Seite nicht, Start auf Seite 0, Junk-Eingaben werfen nicht.
- **Registry:** `node:test` dafür, dass ein Lesezugriff die Kart-Liste nicht verändert und der Schreibpfad weiterhin registriert.
- **Gates:** `npm test`, `npm run lint`, `npm run lint:css`, Python-Tests, `npm run test:e2e`.
- **Funktionsnachweis:** Der Diagnose-Lauf aus dem Ist-Zustand wird wiederholt; erwartet werden `macs.length === 3` (kein `default`), `karten === 3`, sowie `leader` und `karte` **sichtbar** auf Seite 0.

### Offene Konsequenz: Screenshot-Baselines

Die Baselines `demo-live` und `demo-live-single` ändern sich zwangsläufig — das Übersichtslayout ist neu. Das ist ein **bewusster Baseline-Regen mit Nutzer-Abnahme**, kein Anpassen zum Grün-Machen. Die Ursache jeder Abweichung wird vorher benannt; unerwartete Abweichungen auf anderen Bildern gelten als Fehler, nicht als neue Wahrheit.

### Manuelle Abnahme (Nutzer, nicht automatisierbar)

- Mit mehreren Karts: Seite 1 zeigt Karte, Leaderboard und alle Geschwindigkeiten ohne Scrollen.
- Blättern über die Leiste fühlt sich wie Seiten an, nicht wie ein Moduswechsel.
- Mit genau einem Kart: keine Übersicht, keine Leiste — wie heute.
- Ein viertes echtes Kart bekommt einen Platz.

## Phasenschnitt

Phase 65 steht unabhängig neben den noch offenen Phasen 63 (Material & Tiefe) und 64 (Typografie) aus der Apple-Politur-Spec. Berührungspunkt ist allein `live-compact.css`; wird Phase 63 vorher umgesetzt, ist die Reihenfolge trotzdem konfliktfrei, weil dort Material-Tokens und hier Raster-Regeln geändert werden.
