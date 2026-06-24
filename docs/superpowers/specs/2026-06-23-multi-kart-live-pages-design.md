# Multi-Kart Live-Seiten + Übersicht — Design

**Datum:** 2026-06-23
**Branch:** `feat/multi-kart-support` (Folge auf Phase 28 / 28b)
**Status:** Design genehmigt, bereit für Implementierungsplan

## 1. Ziel

Das Live-Dashboard auf Multi-Kart erweitern:

1. **Jedes Kart bekommt auf der Live-Seite seine eigene Ansicht**, auswählbar über
   einen Button oben in der Leiste.
2. **Eine Übersichtsseite**, die alle Karts gleichzeitig mit ihren generellen
   (Renn-/Timing-)Informationen zeigt: Speed, aktuelle Rundenzeit, beste Runde,
   REC-Status.

Reine Frontend-Erweiterung. Die Per-Kart-Datenpipeline (Registry, Fassade,
Chip-Leiste, Editor, Connection-Liste) existiert bereits aus Phase 28/28b.

## 2. Ausgangslage (bereits vorhanden)

- `kart-registry.js`: MAC→Kart-State-Registry (`get`/`setActive`/`active`/`macs`/
  `forget`/`reset`, Cap `MAX_KARTS=4`).
- `rasicross.js`: Per-Kart-**Fassade** — `state.telemetry`/`state.charts`/
  `state.batt`/… sind Getter, die auf den **aktiven** Kart delegieren
  (`PER_KART_FIELDS`). Die gesamte Einzel-Live-Ansicht rendert dadurch
  automatisch den aktiven Kart.
- `kart-bar.js`: Chip-Leiste `#kartBar` (eine Chip je Kart, Name/Farbe aus
  `kartMeta`/localStorage). Chip-Klick ruft `state.karts.setActive(mac)` +
  setzt `state.activeKartMac` → ganze Live-Seite stellt auf diesen Kart um.
  Editor-Popover (Name/Farbe/Vergessen) bereits integriert.
- `live-ui.js`: 60-fps-`animLoop`, 200-ms-Backup-Tick, 1-Hz-Loop. Letzterer ruft
  bereits `RasiKartBar.render(state)`.
- Single-Kart-Regression: Chip-Leiste ist bei `macs().length <= 1` versteckt.

**Konsequenz:** „Jedes Kart seine eigene Seite" funktioniert im Kern schon —
ein Chip-Klick schaltet die Einzelansicht auf den jeweiligen Kart um. Net-neu
ist daher (a) ein expliziter **Übersicht/Alle-Modus** und (b) der
**Übersicht-Button** in der Leiste.

## 3. Architektur

### 3.1 Zwei Live-Modi

Neues, **nicht persistiertes** Feld `state.liveView` mit Werten `'single'`
(Default) oder `'overview'`.

- **`single`** — die heutige Einzel-Kart-Ansicht: `.pw-liverow` (Race-Control)
  + `.pw-live-body` (Karte + rechter Stack). Unverändert; rendert via Fassade
  den aktiven Kart.
- **`overview`** — neuer Container `#liveOverview` (Geschwister von
  `.pw-live-body` innerhalb `#tab-live`). Zeigt ein Grid mit einer Karte je Kart.

Der Modus steuert die Sichtbarkeit per Attribut am `<body>`:
`body[data-live-view="overview"]` blendet `.pw-liverow` + `.pw-live-body` aus und
`#liveOverview` ein; Default/`single` umgekehrt. (Konsistent mit dem
vorhandenen `body[data-tab="live"]`-Muster.)

### 3.2 Leiste oben (`#kartBar`-Bereich)

Die bestehende Chip-Leiste bleibt. Davor wird ein **„⊞ Übersicht"-Button**
gerendert (Teil des `kart-bar.js`-Renderings, damit Sichtbarkeitslogik an einer
Stelle bleibt).

- Klick auf **Übersicht** → `setLiveView('overview')`. Button erhält
  `.active`-Markierung; Chips verlieren sie.
- Klick auf einen **Chip** → `state.karts.setActive(mac)` + `activeKartMac` +
  `setLiveView('single')`. Aktiver Chip `.active`; Übersicht-Button nicht.
- **Single-Kart-Regression:** Die gesamte Leiste (Chips **und**
  Übersicht-Button) bleibt versteckt, solange `state.karts.macs().length <= 1`.
  In diesem Fall ist immer `liveView='single'`.

### 3.3 Übersichtskarte je Kart (Renn-/Timing-Fokus)

Neues Modul **`kart-overview.js`** (Browser-Global `window.RasiKartOverview`,
Aufbau analog `kart-bar.js`). Funktion `render(state)`:

- Liest pro MAC **direkt** `state.karts.get(mac)` (NICHT die Fassade — die zeigt
  nur den aktiven Kart).
- Rendert je Kart eine Karte mit:
  - **Name** in Kart-Farbe (`RasiKartBar.metaFor(state, mac, idx)`).
  - **Speed** groß, km/h (`k.telemetry.speed`).
  - **Aktuelle Rundenzeit** live (`k.lapStart ? now - k.lapStart : --`).
  - **Beste Runde** (`k.bestLapMs`), mit Rundennummer der Bestzeit
    (`k.bestLapNum`) als Sub-Label.
  - **REC**-Indikator (`k.recording.armed`).
  - **Verbindungs-Punkt** + Ausgrauen bei `stale` (>2 s kein Paket via
    `k.connection.lastPacketAt`), damit tote Karts erkennbar sind. Sonst keine
    weiteren Health-Details (Renn-Fokus).
- **Klick auf eine Karte** → `state.karts.setActive(mac)` + `activeKartMac` +
  `setLiveView('single')` (Wechsel auf Einzel-Live des Karts).
- Aktive-Kart-Karte optisch hervorgehoben (wie aktiver Chip).

### 3.4 Render-Anbindung

- `setLiveView(mode)` lebt in `live-ui.js`: setzt `state.liveView`, das
  `data-live-view`-Attribut am `<body>`, ruft `RasiKartOverview.render(state)`
  bei `overview` bzw. löst ein Single-Refresh aus, und aktualisiert die
  Aktiv-Markierung in der Leiste (`RasiKartBar.render(state)`).
- Das Overview-Grid wird im **1-Hz-Loop** und im **200-ms-Backup-Tick**
  aufgefrischt, aber **nur wenn `state.liveView === 'overview'`** (sonst no-op,
  kein Overhead in der häufigsten Single-Ansicht).
- Die 60-fps-`animLoop` (Gauges/Charts/Track) bleibt unberührt; im
  Overview-Modus sind ihre Canvas-Ziele schlicht ausgeblendet.

## 4. Datenfluss

```
Chip-Klick / Karten-Klick
  → state.karts.setActive(mac); state.activeKartMac = mac
  → setLiveView('single')  → body[data-live-view=single], Fassade zeigt mac
Übersicht-Button
  → setLiveView('overview') → body[data-live-view=overview]
  → RasiKartOverview.render(state) liest je MAC state.karts.get(mac)
1-Hz-Loop / 200ms-Tick
  → if liveView==='overview': RasiKartOverview.render(state)
```

## 5. Randfälle

1. **≤1 Kart:** Leiste (Chips + Übersicht-Button) versteckt; immer `single`.
   Verhalten identisch zur heutigen Einzelansicht.
2. **Default beim Start:** `liveView='single'` auf den aktiven Kart. Übersicht
   ist opt-in.
3. **Aktiven Kart vergessen während Overview:** bleibt `overview`; Grid rendert
   neu (eine Karte weniger); `activeKartMac` zeigt auf neuen aktiven Kart.
4. **Letzten/vorletzten Kart vergessen → ≤1 Kart:** Leiste verschwindet,
   `setLiveView('single')` erzwungen, falls vorher `overview`.
5. **Live-Tab „no-scroll"-Layout:** `#liveOverview` muss in den
   `body[data-tab="live"]`-Flexraum passen; Grid ist im verfügbaren Raum
   **scrollbar** (eigener Scrollcontainer), bricht das No-Scroll der
   Einzelansicht nicht.
6. **Tab-Wechsel weg von Live und zurück:** `liveView` bleibt erhalten
   (kein Reset); beim Re-Eintritt rendert der Loop den korrekten Modus.

## 6. Tests / Verifikation

- Logik ist DOM-gebunden; kein eigener `node:test` (Registry-Primitive sind in
  Phase 28 getestet). Verifikation per:
  - `node --check kart-overview.js kart-bar.js live-ui.js rasicross.js`
  - `node --test` → bestehende Suite bleibt grün (126).
  - `python -m py_compile bridge.py` + `python -m unittest …` → unverändert (50 OK).
  - Grep-Asserts auf neue Symbole/IDs.
- Funktionales Multi-Kart-Verhalten (zwei Karts, Hardware) bleibt **manuell**,
  wie in Phase 28/28b.

## 7. Betroffene Dateien

| Aktion | Datei | Verantwortung |
|--------|-------|---------------|
| Neu     | `kart-overview.js` | `window.RasiKartOverview.render(state)` — Overview-Grid je MAC. |
| Ändern  | `RasiCross_Telemetry.html` | Übersicht-Button-Verankerung in der Leiste; `#liveOverview`-Container in `#tab-live`; CSS (Grid/Karten/aktiv/stale, `body[data-live-view]`-Sichtbarkeit); `<script src="kart-overview.js">`-Einbindung. |
| Ändern  | `live-ui.js` | `setLiveView(mode)`; Overview-Render-Hook im 1-Hz-Loop + 200-ms-Tick (nur bei `overview`). |
| Ändern  | `kart-bar.js` | Übersicht-Button rendern + Modus-Highlight; Chip-Klick setzt zusätzlich `liveView='single'`. |
| Ändern  | Build (`main.js`/`package.json` `files`) | `kart-overview.js` ins gepackte App-Bundle aufnehmen (analog letzter Build-Fix für kart-registry/kart-bar). |

## 8. Manuelle Akzeptanz (Nutzer, Hardware/zwei Karts)

1. Mit zwei Karts erscheint die Leiste mit Chips **und** „⊞ Übersicht"-Button.
2. Übersicht-Button → Grid mit je einer Karte pro Kart (Speed/aktuelle Runde/
   beste Runde/REC, Stale-Ausgrauen bei totem Kart).
3. Klick auf eine Karte → wechselt zur Einzel-Live-Ansicht dieses Karts (volle
   Gauges/Karte/Charts), Chip aktiv markiert.
4. Chip-Klick wechselt zwischen Einzel-Ansichten der Karts.
5. Werte in der Übersicht aktualisieren sich live (1 Hz).
6. Single-Kart-Regression: mit einem Kart keine Leiste, nur die bekannte
   Einzelansicht.

## 9. Bewusst nicht enthalten (YAGNI / spätere Phase)

- Akku/RSSI/verlorene Pakete auf der Übersichtskarte (Renn-Fokus; Health-Details
  bleiben in der Connection-Liste aus Phase 28b).
- **Per-Kart-Rundenzahl auf der Übersicht.** Rennen/Runden (`state.races`) sind
  derzeit global/geteilt (nicht in `PER_KART_FIELDS`), daher gibt es noch keine
  saubere kart-spezifische Rundenzahl. Die Übersicht nutzt stattdessen
  `bestLapNum` als Sub-Label. Echte Per-Kart-Runden = spätere Phase.
- Cross-Kart-Leaderboard / Sortierung / Gegenüberstellung von Rundenzeiten.
- Persistenz von `liveView`.
- Dedizierte Tab-Leiste statt Chip-Leiste (verworfen zugunsten minimalem Eingriff).
