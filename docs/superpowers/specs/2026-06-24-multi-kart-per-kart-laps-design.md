# Multi-Kart Per-Kart-Runden + Renn-Engine — Design (Phase 30)

**Datum:** 2026-06-24
**Branch:** `feat/multi-kart-support` (Folge auf Phase 28 / 28b / 29)
**Status:** Design genehmigt, bereit für Implementierungsplan

## 1. Ziel

Ein Rennen wird vom „Eigentum genau eines Karts" zu einem **Event mit
Teilnehmern**. Die Live-Rundenerkennung läuft für **alle** verbundenen Karts –
nicht mehr nur den aktiven. Jeder Kart bekommt im selben Rennen seine eigenen
Runden, Bestrunde und Stints (Fahrerwechsel). Damit zeigt das Übersicht-Grid aus
Phase 29 endlich echte Live-Rundenzeiten je Kart statt leerer Werte.

**Bewusster Schnitt:** Phase 30 liefert die **Engine + das Teilnehmer-Datenmodell
+ Stints + minimale UI**. Leaderboard, Positions-Ranking, Auto-Ende bei
Zielrunden im Multi-Kart-Fall und synchrones Replay aller Karts sind **Phase 31 /
deferred** (siehe §10).

## 2. Ausgangslage (bereits vorhanden)

- `kart-registry.js`: jeder Kart hat **schon** eigenen Live-Lap-State —
  `lapStart`, `currentLapMax`, `currentLapTrace`, `bestLapMs`, `bestLapNum`,
  `bestLapTrace`, `autoLap`, `sectorsLive` und einen `activeRaceId`-Zeiger
  (`makeKartState()`, Zeilen 36–49).
- `rasicross.js`: Per-Kart-**Fassade** (`PER_KART_FIELDS`) – `state.lapStart`,
  `state.autoLap`, `state.sectorsLive`, `state.currentLapMax` etc. sind Getter,
  die auf den **aktiven** Kart delegieren (`activeKart()`).
- `rasicross.js` `processTelemetry`: Lap-/Sektorerkennung läuft heute **nur** für
  den aktiven Kart (`if (isActive) { checkLapCrossing(); checkSectorCrossings(); }`,
  ~Zeile 855); Hintergrund-Karts pflegen nur ihren `autoLap.prevLat/prevLon`.
- `laps-drivers.js` `triggerLap()`: schreibt Runden über die Fassade in
  `activeRace().laps`. **Jede Runde trägt bereits ein `kartMac`-Feld** (Zeile 41)
  – ein Teil des Fundaments existiert also schon. Lap-basiertes Auto-Ende sitzt
  hier (Zeile 82: `r.laps.filter(valid).length >= r.targetLaps → endRace(true)`).
- `races.js`: Rennen hat heute Top-Level `laps`, `stints`, `speedTrace`,
  `kartMac`, `startDriverId`, `currentDriverId`. Fahrerwechsel = `openDriverChange`
  / `confirmDriverChange` (ein Stint-Stack auf `r`).
- `track` + `startGate` sind **geteilt** (global, nicht in `PER_KART_FIELDS`) –
  alle Karts fahren dieselbe physische Strecke mit demselben Start-Ziel.
- `state.sectors` ist geteilte **Konfiguration**; `state.sectorsLive` ist
  **pro Kart** (Fassade).

## 3. Architektur

### 3.1 Teilnehmer-Datenmodell

Das `race`-Objekt bekommt eine **`participants`-Map** (key = `kartMac`). Die
*committeten* Renndaten wandern vom Top-Level in den Teilnehmer-Slot:

```js
race.participants[mac] = {
  mac,
  startDriverId,            // Fahrer beim Beitritt dieses Karts
  currentDriverId,          // aktueller Fahrer (für neue Runden/Stints)
  laps: [],                 // {id, number, timeMs, driverId, kartMac, maxSpeed,
                            //  maxRpm, distanceM, valid, sectors}
  stints: [],               // {id, driverId, startAt, endAt}  — volle Stint-Historie
  speedTrace: [],           // downsampled, pro Kart
  bestLapMs: null,
  bestLapNum: null,
  joinedAt: null,           // wann dieser Kart dem Rennen beitrat
}
```

**Live-State bleibt in der Registry** (`lapStart`, `autoLap`, `sectorsLive`,
`currentLapMax`, `currentLapTrace`, `bestLapTrace`). Der Teilnehmer-Slot hält nur
das, was persistiert/angezeigt wird (abgeschlossene Runden, Stints, Bestrunde,
Speed-Trace). `bestLapMs`/`bestLapNum` werden sowohl in der Registry (für das
Übersicht-Grid, das `k.bestLapMs` liest) **als auch** im Teilnehmer-Slot (für
Persistenz/Renn-Details) geführt und synchron gehalten.

Top-Level bleiben am `race`: `id, name, trackId, lengthType, durationMs,
targetLaps, status, createdAt, startedAt, endedAt, pausedAt, totalPausedMs`.
`name`/Format/Status gelten fürs **ganze Event**.

### 3.2 Migration (lazy, additiv)

Beim Laden gespeicherter Daten werden Alt-Rennen erkannt (`!r.participants &&
Array.isArray(r.laps)`) und transparent migriert:

```
participants[r.kartMac || DEFAULT_MAC] = {
  mac, startDriverId: r.startDriverId, currentDriverId: r.currentDriverId,
  laps: r.laps, stints: r.stints || [], speedTrace: r.speedTrace || [],
  bestLapMs: <aus laps berechnet>, bestLapNum: <dito>, joinedAt: r.startedAt
}
```

Die alten Top-Level-Felder bleiben unangetastet liegen (additiv, keine
Löschung), sodass ältere App-Versionen die Datei weiterhin lesen können. Das
Save-Format (`SAVE_KEY`) bleibt damit rückwärtskompatibel; `REC_VERSION` (Replay)
ist unberührt. Migration ist **idempotent** und läuft genau einmal pro
Alt-Rennen.

### 3.3 Lap-Engine pro Kart

`checkLapCrossing`, `triggerLap`, `checkSectorCrossings` werden von der
„aktiven-Kart-Fassade" auf **explizite `(kart, mac)`-Parameter** umgestellt:

- `checkLapCrossing(k, mac, lat, lon)` nutzt das **geteilte** `state.startGate`
  (Geometrie/Heading) + `state.settings.minLapSeconds`, aber **`k`s eigenen**
  `lapStart`/`autoLap`.
- `triggerLap(k, mac)`:
  - liest `activeRace()`; wenn `running` und `mac` Teilnehmer → committet die
    Runde in `race.participants[mac].laps` (Nummer = teilnehmer-lokal), mit
    `driverId = participant.currentDriverId`, `kartMac = mac`.
  - aktualisiert `participant.bestLapMs/bestLapNum` **und** `k.bestLapMs/bestLapNum`
    (Registry) synchron; setzt `k.bestLapTrace`.
  - Sektor-Bestzeiten: `state.sectors.best` bleibt **geteilt** (eine Streckenbest-
    zeit über alle Karts – Strecke ist geteilt); `k.sectorsLive` ist pro Kart.
  - resettet `k`s Live-Lap-Accumulatoren (`lapStart=now`, `currentLapMax`,
    `currentLapTrace`, `sectorsLive`).
- In `processTelemetry` fällt das `if (isActive)`-Gate für die Lap-Erkennung
  weg. Stattdessen: für **jeden** Kart `k`/`mac`, der Teilnehmer des laufenden
  Rennens ist, `checkLapCrossing(k, mac, …)` + `checkSectorCrossings(k, …)`
  ausführen und `k.autoLap.prev*` pflegen. Der **aktive** Kart treibt zusätzlich
  weiterhin die fassadengebundenen Panels (Sektor-Panel, Lap-Tabelle) – das
  passiert automatisch, weil die Fassade auf den aktiven Kart zeigt.

> Die heutigen fassadenbasierten Aufrufer (`startRace`/`endRace`/`pauseRace` in
> `races.js`, die `state.lapStart` etc. setzen) bleiben für den **aktiven** Kart
> gültig; zusätzlich müssen sie den Live-State **aller** Teilnehmer
> initialisieren/zurücksetzen (siehe §3.4), nicht nur den aktiven.

### 3.4 Renn-Lebenszyklus

- **Erstellen:** wie heute. Kein Vorab-Teilnehmer; `participants = {}`.
- **Start (rolling):** Teilnehmer = **alle aktuell verbundenen Karts**
  (`state.karts.macs()`). Für jeden wird ein Teilnehmer-Slot angelegt
  (`currentDriverId = race.startDriverId` als Default, pro Kart später änderbar)
  und der Registry-Live-State zurückgesetzt mit **`lapStart = null`**
  (Armierung steht aus). Die **erste** Linien-Durchfahrt eines Karts setzt
  `lapStart = now` + `joinedAt = now` (keine gezählte Runde); die **nächste**
  Durchfahrt zählt Runde 1.
- **Nachzügler:** Sendet ein Kart erstmals Pakete, während das Rennen `running`
  ist, und ist noch kein Teilnehmer → automatisch Teilnehmer-Slot anlegen
  (`lapStart=null`), Armierung bei erster Linie. (Erkennung an der Stelle, an der
  `processTelemetry` `kartFor(mac)` neu erzeugt.)
- **Fahrerwechsel (pro Kart einzeln):** Der bestehende „Fahrer wechseln"-Dialog
  gilt für den **aktuell per Chip gewählten** Kart. Titel zeigt dessen Namen.
  `confirmDriverChange` schließt den offenen Stint des **aktiven** Teilnehmers,
  setzt dessen `currentDriverId` und pusht einen neuen Stint in
  `participant.stints`. Jeder Kart ist erreichbar, indem man seinen Chip wählt
  und dann „Fahrer wechseln" klickt. (Volle Stint-Historie pro Kart.)
- **Pause/Fortsetzen:** gilt fürs **ganze Rennen**. Die Pausen-Korrektur der
  Lauf-/Sektoruhr (heute auf `state.lapStart`/`state.sectorsLive.sectorStart`)
  wird auf **alle** Teilnehmer-Karts angewandt (jeweils `k.lapStart += pausedMs`
  bzw. Neustart der aktuellen Runde nach App-Neustart).
- **Ende:** vorerst **manuell** („Beenden") und über das bestehende
  **Zeitlimit** fürs Gesamtrennen (`live-ui.js`: `rem <= 0 → endRace(true)`).
  Beim Ende werden offene Stints aller Teilnehmer geschlossen und der Live-State
  aller Karts zurückgesetzt. **Multi-Kart-Auto-Ende bei Zielrunden = Phase 31**
  (siehe §3.5).

### 3.5 Auto-Ende bei Zielrunden (Regression vs. Phase 31)

Das bestehende Lap-Auto-Ende (`triggerLap`, Zeile 82) zählt heute `r.laps`. Nach
der Migration gilt:

- **Single-Teilnehmer-Rennen** (Single-Kart-Regression): Auto-Ende feuert wie
  heute, sobald der eine Teilnehmer `targetLaps` gültige Runden erreicht.
  Verhalten 1:1 identisch zur aktuellen App.
- **Multi-Kart-Rennen (≥2 Teilnehmer):** in Phase 30 **kein** Lap-Auto-Ende
  (Rennen endet manuell oder per Zeitlimit). Das positions-/führungsbasierte
  Auto-Ende („Leader erreicht Zielrunden") + Live-„Runden bis Ziel" ist
  **Phase 31**.

### 3.6 Minimale UI (Phase 30)

- **Übersicht-Grid (`kart-overview.js`):** liest bereits `k.lapStart`,
  `k.bestLapMs`, `k.bestLapNum` pro Kart – funktioniert automatisch, sobald die
  Per-Kart-Engine läuft. Ergänzung: **Rundenzähler** je Karte (Anzahl gültiger
  Runden des Karts im aktiven Rennen, aus `participant.laps`).
- **Renn-Details (`races.js` `renderRaceDetails`):** Runden-Tabelle + Stints
  **pro Kart gruppiert** (Abschnitt je Teilnehmer mit Kart-Name/Farbe, eigener
  Rundenzahl und Bestzeit). Bei Single-Teilnehmer optisch wie heute.
- **Live-Lap-Listen (`laps-drivers.js` `renderLapTable`/`renderLiveLapList`):**
  zeigen die Runden des **aktiven** Karts (lesen `participant.laps` des aktiven
  Karts statt `r.laps`).
- **Renn-Karten-Badge (`kartBadge`):** bei Multi-Kart-Rennen die teilnehmenden
  Karts andeuten (Anzahl/Namen) statt nur `r.kartMac`.
- **Pit-Wall (`pit-wall.js`):** zeigt Runden/Best des **aktiven** Karts
  (Teilnehmer-Slot) – minimaler Umbau, Pit-Wall bleibt single-kart-fokussiert.

## 4. Datenfluss

```
Rennstart (running)
  → participants[mac] = {…} für jeden state.karts.macs(); k.lapStart = null
Telemetrie-Paket (mac)
  → processTelemetry: für jeden Teilnehmer-Kart
       checkLapCrossing(k, mac, lat, lon) gegen geteiltes startGate
       erste Linie:  k.lapStart = now, participant.joinedAt = now
       weitere Linie: triggerLap(k, mac)
         → participant.laps.push({…, kartMac:mac, driverId:participant.currentDriverId})
         → participant.bestLap* + k.bestLap* synchron
  → neuer Kart mitten im Rennen → participants[mac] anlegen (lazy join)
Fahrerwechsel (aktiver Kart)
  → participant(aktiv).stints schließen/öffnen; currentDriverId setzen
Übersicht-Grid / Renn-Details
  → lesen participant.laps / k.bestLap* je Kart
```

## 5. Randfälle

1. **Single-Kart (≤1 verbundener Kart):** ein Teilnehmer; Engine/Anzeige/
   Auto-Ende identisch zur heutigen App. Keine sichtbare Änderung.
2. **Kart verbindet sich mitten im Rennen:** Lazy-Join, armiert bei erster Linie;
   `joinedAt` markiert späten Einstieg.
3. **Kart fällt mitten im Rennen aus (kein Paket mehr):** Teilnehmer-Slot +
   bisherige Runden bleiben erhalten; keine neuen Runden bis Wiederverbindung.
   `lapStart` friert ein (offene Runde wird verworfen, kein „Geister-Lap").
4. **Aktiver Kart wird gewechselt (Chip):** Lap-Tabelle/Sektor-Panel/Pit-Wall
   stellen via Fassade auf den neuen aktiven Kart um; alle anderen zählen im
   Hintergrund weiter.
5. **Pause während Multi-Kart-Rennen:** Lauf-/Sektoruhr aller Teilnehmer wird um
   die Pausendauer korrigiert; nach App-Neustart frische aktuelle Runde je Kart.
6. **`minLapSeconds`-Cooldown:** weiterhin pro Kart gegen dessen `lapStart`
   geprüft (kein Cross-Kart-Effekt).
7. **Alt-Rennen aus Vor-Phase-30-Speicher:** Migration verpackt sie in einen
   Teilnehmer; Anzeige/Replay unverändert.
8. **Sektor-Bestzeit:** bleibt geteilt pro Strecke (schnellster Sektor über alle
   Karts), da Strecke geteilt ist.

## 6. Tests / Verifikation

- **Neue reine Logik wird TDD'd** in einem dependency-freien UMD-Modul (im Stil
  von `geo.js`/`replay.js`), unter `node:test`:
  - `lap-engine.js` (Arbeitstitel): teilnehmer-lokale Rundenzuordnung
    (`commitLap(participant, {now, lapStart, …})` → korrekte `number`/`timeMs`/
    `valid`/`kartMac`), Bestrunden-Update, Armierungs-Logik (erste Durchfahrt
    zählt nicht), `minLapSeconds`-Cooldown, sowie die **Migration** alter Rennen
    (`migrateRace(r)` → `participants`-Map, idempotent).
  - Ziel: die Zähl-/Zuordnungs-/Migrations-Logik ist ohne DOM testbar; die
    DOM-/Fassaden-Verdrahtung in `rasicross.js`/`races.js`/`laps-drivers.js`
    konsumiert diese reinen Funktionen.
- **DOM/Renn-UI-Verdrahtung:** `node --check` + ESLint + Grep-Asserts +
  bestehende Baselines bleiben grün.
- **Baselines (müssen grün bleiben + neue Tests dazu):** `node --test`
  (aktuell 127) steigt um die neuen `lap-engine`-Tests; `python -m py_compile`
  (unverändert) + `python -m unittest …` (50 OK, Python unberührt).
- **Funktionales Multi-Kart-Verhalten (zwei Karts, Hardware) bleibt manuell** –
  Akzeptanzliste §8.

## 7. Betroffene Dateien

| Aktion | Datei | Verantwortung |
|--------|-------|---------------|
| Neu     | `lap-engine.js` | Dependency-freies UMD: teilnehmer-lokale `commitLap`/Bestrunde/Armierung + `migrateRace`. `node:test`-getestet, im Browser `window.RasiLapEngine`. |
| Neu     | `test/lap-engine.test.js` | `node:test`-Suite für `lap-engine.js`. |
| Ändern  | `kart-registry.js` | (ggf.) Hilfsfeld für „armiert/Teilnehmer"-Markierung, falls nötig; Live-Lap-State existiert bereits. |
| Ändern  | `races.js` | `createRace`/`startRace`/`endRace`/`pauseRace`: `participants`-Map; Start armiert alle verbundenen Karts; Pause/Ende über alle Teilnehmer; `renderRaceDetails` pro Kart gruppiert; `kartBadge` Multi-Kart; `confirmDriverChange` auf aktiven Teilnehmer. Migration beim Rendern/Laden anwenden. |
| Ändern  | `laps-drivers.js` | `checkLapCrossing(k,mac,…)`/`triggerLap(k,mac)`/`checkSectorCrossings(k,…)` auf explizite Kart-Parameter; `renderLapTable`/`renderLiveLapList` lesen Teilnehmer-Slot des aktiven Karts; Auto-Ende nur bei Single-Teilnehmer. |
| Ändern  | `rasicross.js` | `processTelemetry`: Lap-/Sektor-Erkennung für **alle** Teilnehmer-Karts; Lazy-Join neuer Karts ins laufende Rennen; Migration beim Laden gespeicherter Rennen. |
| Ändern  | `kart-overview.js` | Rundenzähler je Karte aus Teilnehmer-Slot. |
| Ändern  | `pit-wall.js` | Runden/Best des aktiven Karts aus Teilnehmer-Slot. |
| Ändern  | `eslint.config.js` | `RasiLapEngine`-Global; neue `lap-engine.js`-Konfig; ggf. neue Globals in Konsumenten-Blöcken. |
| Ändern  | `package.json` | `lap-engine.js` ins `build.files`-Bundle (analog kart-registry/kart-bar/kart-overview). |

## 8. Manuelle Akzeptanz (Nutzer, Hardware/zwei Karts)

1. **Rolling Start:** Rennen starten mit zwei verbundenen Karts; Übersicht zeigt
   für beide „--" bis zur ersten Linien-Durchfahrt, danach läuft die jeweilige
   Rundenuhr.
2. **Per-Kart-Runden:** Jeder Kart zählt seine eigenen Runden/Bestrunde im
   selben Rennen; beide Werte aktualisieren sich live im Übersicht-Grid.
3. **Nachzügler:** Dritter Kart verbindet sich mitten im Rennen → erscheint als
   Teilnehmer, armiert bei erster Linie.
4. **Fahrerwechsel pro Kart:** Chip Kart A → „Fahrer wechseln" → neuer Stint nur
   für Kart A; Chip Kart B → eigener Fahrerwechsel, unabhängig.
5. **Renn-Details:** zeigen Runden + Stints pro Kart gruppiert mit korrekter
   Bestzeit/Rundenzahl je Kart.
6. **Pause/Fortsetzen:** beide Rundenuhren laufen nach Pause nahtlos weiter.
7. **Single-Kart-Regression:** mit einem Kart ist Rennen/Runden/Auto-Ende
   exakt wie vor Phase 30.
8. **Persistenz:** Alt-Rennen (vor Phase 30) öffnen weiterhin korrekt; neues
   Multi-Kart-Rennen übersteht App-Neustart.

## 9. Risiken / offene Punkte

- **Fassaden-Doppelpfad:** Lap-Erkennung läuft künftig pro Kart explizit, die
  Panel-Anzeige weiter über die aktive-Kart-Fassade. Sorgfalt nötig, dass aktiver
  Kart nicht doppelt verarbeitet wird (genau ein Erkennungspfad pro Paket).
- **Save-Format:** Migration muss idempotent + additiv sein (keine Löschung alter
  Felder), damit ältere App-Versionen die Datei lesen können (`SAVE_KEY` stabil).
- **Pause-Korrektur über alle Karts:** muss konsistent angewandt werden, sonst
  Zeitdrift zwischen Karts nach Pause.

## 10. Bewusst nicht enthalten (Phase 31 / deferred)

- **Leaderboard + Positions-Ranking** (meiste Runden, dann zuletzt-Linie-zuerst).
- **Multi-Kart-Auto-Ende bei Zielrunden** (Leader erreicht `targetLaps`) +
  Live-„Runden bis Ziel".
- **Live-Position** in der Übersicht.
- **Synchrones Replay aller Karts** (Replay zeigt weiter nur den aktiven Kart;
  Replay-Engine unverändert).
- **Kombinierter Mehr-Kart-Fahrerdialog** (verworfen zugunsten „pro Kart
  einzeln" via Chip).
