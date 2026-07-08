# Karts-Tab — Design (Phase 46)

Eigene Seite für die Karts, analog zum Fahrer-Tab: eine Karte pro Kart mit
Identität, Live-Status, Motorstunden/Service und Kalibrierung. Die heute
dreigeteilte Kart-Verwaltung (✏-Popover der Chip-Leiste, Kart-Liste im
Verbindungs-Tab, per-Kart-Zeilen in den Einstellungen) zieht vollständig um —
eine Quelle der Wahrheit im UI und in der Persistenz.

Baut auf Phase 42 (Vite + ESM) auf; unabhängig von Phase 43–45, kann vor oder
nach ihnen laufen (kein Eingriff in Fassade/Registry-Interna).

## Ist-Zustand

| Daten | Ablage | UI heute |
|---|---|---|
| Name, Farbe | `rasi.kartMeta.v1` (eigener localStorage-Key, kart-bar.js) | ✏-Popover in der Chip-Leiste |
| Kalibrierung | `_persistedKarts.cal[mac]` im `SAVE_KEY` (rasicross.js) | Einstellungen („Sensorik & Fahrdynamik“, per-Kart-Anteile) |
| Motorstunden/Service | `_persistedKarts.eng[mac]` im `SAVE_KEY` | Einstellungen (Motorlaufzeit, Service-Intervall) |
| Live-Zustand (Hz, RSSI, Alter, Batterie, REC) | Registry (nur Session) | Kart-Liste im Verbindungs-Tab |

Die Kart-Liste existiert nur in der Session: nach App-Neustart ist sie leer,
bis Telemetrie eintrifft. „Kart vergessen“ muss heute mehrere Stellen anfassen.

## Entscheidungen

- **Persistent wie Fahrer:** Einmal gesehene Karts bleiben auf der Seite (auch
  offline und nach Neustart, mit Offline-Markierung). „Vergessen“ entfernt
  endgültig.
- **Altstellen entfallen:** ✏-Popover (inkl. `#kartEditPopover`-Block),
  Verbindungs-Tab-Kartliste (`renderConnKartList`, „Alle Karts zurücksetzen“)
  und die per-Kart-Zeilen der Einstellungen ziehen in den Karts-Tab um. Die
  Chip-Leiste bleibt für die schnelle Aktiv-Wahl, verliert nur den ✏-Button.
- **Kart-Stammdaten vereinheitlicht:** ein persistiertes Roster im `SAVE_KEY`
  als einzige Quelle (siehe Datenmodell). `rasi.kartMeta.v1` wird einmalig
  migriert.
- **Demo-Karts** (`DE:MO:*`) erscheinen nur, solange die Demo läuft
  (Demo-Badge) und werden wie bisher nie persistiert.

## UI

**Navigation:** neuer Tab „Karts“ nach „Fahrer“ (Live, Detail, Rennen, Fahrer,
**Karts**, Strecke, Verbindung, Einstellungen).

**Seitenkopf:** Kart-Zähler + Button „Alle Karts zurücksetzen“ (zieht aus dem
Verbindungs-Tab um; Semantik unverändert: Registry leeren, Kalibrierung +
Motorstunden bleiben).

**Kart-Karte** (Layout angelehnt an `.driver-stat-card`):

- **Kopf:** Farbpunkt + Name (inline editierbar), MAC als Untertitel,
  Farbwahl (5-Farben-Palette wie bisher), Button „Vergessen“ (mit rcConfirm,
  Semantik wie heute: löscht auch Kalibrierung/Motorstunden der MAC).
- **Live-Zeile** (nur wenn das Kart in der Session ist): Hz, RSSI, Paketalter,
  Batterie-%, REC-Indikator, „Aktiv“-Markierung. Klick auf die Karte wählt das
  Kart als aktives (wie Chip-Klick). Offline-Karts zeigen stattdessen
  „Offline, zuletzt gesehen …“ (aus `lastSeenAt`).
- **Motor-Block:** Motorlaufzeit (`RasiEngine.hoursText`), Service-Intervall
  (editierbar, pro Kart, Klemmen 0–500 h wie bisher), Service-fällig-Hinweis,
  Button „Service durchgeführt“ (setzt `lastServiceMs`).
- **Kalibrierungs-Block:** per-Kart-Kalibrierwerte (`k.calibration`) anzeigen
  und zurücksetzen. Nur die per-Kart-Werte — globale Sensorik-Regler
  (Drift-Tuning, Rollover-Schwelle, …) bleiben im Einstellungen-Tab.

**Sortierung:** aktive/verbundene Karts zuerst, dann offline nach `lastSeenAt`
absteigend.

## Datenmodell & Migration

`_persistedKarts` in rasicross.js wird zum Roster erweitert:

```js
_persistedKarts = {
  cal:  { [mac]: { /* wie bisher */ } },
  eng:  { [mac]: { totalMs, lastServiceMs, serviceIntervalH } },
  meta: { [mac]: { name, color, lastSeenAt } },   // NEU
};
```

- `meta` übernimmt Name/Farbe aus `rasi.kartMeta.v1`; `lastSeenAt` wird im
  Telemetrie-Pfad bei jedem Paket des Karts aktualisiert.
- **Migration einmalig in `loadData()`:** existiert `rasi.kartMeta.v1` und
  `meta` ist leer → Einträge übernehmen, alten Key löschen. Korrupter alter
  Key wird ignoriert (try/catch). Idempotent.
- **`SAVE_KEY` bleibt kompatibel:** `meta` ist additiv im bestehenden
  Karts-Block; alte Speicherstände laden unverändert (fehlendes `meta` ⇒
  leeres Objekt). `REC_VERSION` 9.6 unangetastet.
- **kart-bar.js verliert den eigenen localStorage-Zugriff:** Chip-Namen/-Farben
  kommen über Roster-Accessoren aus rasicross (`kartMetaFor(mac, idx)` mit der
  bisherigen Default-Logik: Palette-Farbe nach Index, Name „Kart N“).
- **„Kart vergessen“** = erweitertes `rasiPersistForget` (löscht cal + eng +
  meta) + Registry-Forget wie bisher — genau eine Stelle.
- **Roster-Rendering:** Kartenliste = Union aus `meta`-Keys (persistent) und
  Registry-MACs (Session/Demo).

## Module & Verdrahtung

**Neu: `src/karts-page.js`** (ESM, nur Deklarationen auf Top-Level):

- `renderKartsTab()` — Kartenliste aus Roster + Registry; von `init()` einmal
  gerufen, danach ereignisgesteuert (Kart-Wechsel; 1-Hz-Refresh nur bei
  aktivem Karts-Tab, Muster wie `refreshOverview`).
- Karten-Aktionen: Name-Edit, Farbwahl, Vergessen, Service-Reset,
  Service-Intervall, Kalibrierung zurücksetzen, Karten-Klick = Aktiv-Wahl,
  „Alle Karts zurücksetzen“ (zieht aus pit-wall.js um).
- Imports aus rasicross (Roster-Accessoren, `state`, Dialoge, `RasiEngine`);
  bewusst rennen-frei (keine races-/kart-rank-Imports).

**Bestandsmodule:**

| Modul | Änderung |
|---|---|
| `rasicross.js` | Roster-Accessoren (`kartMetaFor`, `kartRosterMacs`, `updateKartMeta`, erweitertes `rasiPersistForget`), `lastSeenAt`-Pflege im Telemetrie-Pfad, Migration in `loadData()`, Tab-Verdrahtung in `init()` |
| `kart-bar.js` | `loadMeta`/`saveMeta`/`openEditor`/`forgetKart`/`LS_KEY` raus; `metaFor` delegiert an Roster; ✏-Button entfällt |
| `pit-wall.js` | `renderConnKartList` + `resetKarts` raus |
| `kart-overview.js`, `live-ui.js` | `RasiKartBar.metaFor`-Aufrufe laufen über die Roster-Accessoren (Signatur bleibt) |
| `index.html` | Nav-Item + `<section id="tab-karts">`; `#kartEditPopover` raus; Verbindungs-Tab-Kartliste raus; Settings-Zeilen Motorlaufzeit/Service-Intervall raus; CSS `.kart-card` angelehnt an `.driver-stat-card` |
| `settings.js` | Suchindex: verschobene Einträge (Motorlaufzeit, Service) werden entfernt (die Settings-Suche deckt nur den Einstellungen-Tab ab) |
| `src/app.js` | `import './karts-page.js'` in der Import-Kette |

**Nicht-Ziele:** kein Eingriff in Registry-Interna, Aktiv-Kart-Fassade oder
Telemetrie-Pipeline (Phase 43); keine Protokoll-Änderungen; kein Umbau der
globalen Sensorik-Einstellungen.

## Fehlerfälle

- Roster-Eintrag ohne Registry-Kart (offline) → Karte ohne Live-Zeile.
- Registry-Kart ohne Roster-Eintrag (erstes Paket) → `meta` wird beim ersten
  Rendern angelegt.
- Korruptes `rasi.kartMeta.v1` → Migration ignoriert es (try/catch), App
  startet normal.

## Tests & Gates

**Unit (node:test):** Roster-Migration (alter Key → meta, idempotent, korrupt
tolerant), `kartMetaFor`-Default-Logik, Forget löscht cal+eng+meta,
Service-Reset/Intervall-Klemmen, Sortierung (verbunden vor offline).

**Smoke (Playwright, neuer Spec `e2e/karts.spec.js`):**
- Demo starten → Karts-Tab: 3 Demo-Karten mit Demo-Badge sichtbar.
- Umbenennen auf der Karte wirkt sofort in der Chip-Leiste.
- Karten-Klick wechselt das aktive Kart.
- Persistenz-Fall: Roster-Seed via localStorage/RasiTest → offline-Karte nach
  Neustart sichtbar.
- Bestehende 6 Smoke-Tests bleiben grün (Verbindungs-Tab rendert weiter, nur
  ohne Kartliste).

**Gates:** `npm test` grün, `npm run lint` 0, `npm run test:e2e` grün
(6 + neue Karts-Tests), Sichtprüfung in der Portable-EXE.

## Phasen-Einordnung

- Phase 42 (Vite + ESM): Voraussetzung, PR #66.
- **Phase 46 (dieser Entwurf): Karts-Tab.** Unabhängig von 43–45.
- Phase 43 (State-Redesign) profitiert: karts-page liest Registry nur über
  `state.karts.get(mac)` — keine Fassaden-Abhängigkeit.
