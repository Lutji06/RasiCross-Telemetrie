# Phase 56: Verbindungsseite Neuaufbau — Design

**Datum:** 2026-07-17 · **Status:** vom User freigegeben (Brainstorming-Session mit Visual Companion; Grundlayout, Kopfbereich und Gesamtbild im Browser bestätigt, Verhaltens-Abschnitte 1–6 einzeln im Terminal bestätigt)
**Basis:** main nach Merge von PR #78 (Phase 55 Live-Tab Multi-Kart)

## Ziel

Der Verbindungs-Tab wird von der Einzel-Kart-Diagnoseseite zur Multi-Kart-Verbindungszentrale: ein Hero mit integrierter Verbinden-Aktion und Demo-Chip, darunter ein Kart-Karten-Grid mit Ampel-Status, Klartext-Hinweisen bei Problemen und aufklappbarer Diagnose pro Kart. Verbinden läuft automatisch (persistierter letzter Port), die Demo startet mit einem Klick, und die Seite sagt bei Störungen im Klartext, was zu prüfen ist.

## Ist-Zustand (verifiziert 2026-07-17)

- `#tab-connection` (index.html:784–950): pw-Hero (nur Anzeige: Status/Datenrate/Verloren/GPS/Signal), Pill-Zeile mit Diagnose-Toggle, Mode-Tabs `#modeSerialBtn`/`#modeDemoBtn`, `#serialPanel` (USB-Karte mit Port/Baud/Refresh/Verbinden + Auto-Reconnect-Toggle, RSSI-Qualitätskarte mit Sparkline, Datenfluss-Diagramm Mäher→Bridge→Dashboard, diagnose-only-Karten MAC/Raw-Werte, Paket-Log), `#demoPanel` (Start/Stop + Beschreibung).
- Die Seite ist **Einzel-Kart-orientiert**: ein Mäher-Knoten, eine Kart-MAC (`connRasiMac`), ein Satz Seq/Alter/Speed/RPM — obwohl die Kart-Registry (kart-registry.js:15–21) längst **pro Kart** `connection: { source, packets, lost, rssi, lastPacketAt, seq, errors, degraded }` und `gps: { fix, lastAt }` führt.
- Writer der alten IDs verteilt auf `ui-glue.js` (200-ms-Spiegel) und `pit-wall.js` (1 Hz) — dieselbe Konstellation, die den Dual-Writer-Bug aus Phase 49 (`#connOverviewGps`) produziert hatte (in Phase 50 gefixt).
- Serial (serial-demo.js): `connect()` liest Port/Baud aus dem DOM; `scheduleReconnect()` mit Backoff (1500·1.4^n ms, max 15 s, 30 Versuche) greift nach Verbindungsabriss, wenn `state.serial.autoReconnect` und `state.serial.lastPath` gesetzt sind. `lastPath` ist **nur Laufzeit-State** (store.js:28) — kein Auto-Connect beim App-Start möglich.
- Demo (serial-demo.js): `startDemo()`/`stopDemo()`, exklusiv zu USB; erzeugt 3 Demo-Karts über die Registry.
- Alle vier e2e-Specs starten die Demo über `#modeDemoBtn` + `#demoStartBtn`; Baseline-Bestand 14 Shots, darunter `tab-connection-linux.png`.
- Settings-Persistenz: `Object.assign(state.settings, d.settings)` beim Laden → neue Keys migrationsfrei.

## Locked Decisions (User, 2026-07-17)

1. **Grundlayout A — Kart-Karten-Grid:** eine Statuskarte pro Kart (Muster Live-Übersicht), keine Tabelle, kein Multi-Kart-Datenfluss-Diagramm.
2. **Kopfbereich B — Verbinden-Aktion im Hero:** pw-Hero-Optik bleibt (Konsistenz mit den anderen Tabs), enthält aber links die Portstatus-Zeile und rechts aggregierte Werte + Demo-Chip + Verbinden/Trennen-Button.
3. **Demo-Chip im Hero:** ein Toggle-Chip startet/stoppt die Demo (ein Klick statt Mode-Tab + Button); `#demoPanel` und die Mode-Tabs entfallen ersatzlos. Demo bleibt exklusiv zu USB.
4. **Auto-Connect:** Beim App-Start automatischer Verbindungsversuch mit dem persistierten letzten Port; Fehlversuche laufen über den **bestehenden** Reconnect-Backoff. Der Auto-Reconnect-Toggle wird zu „Automatisch verbinden" (deckt Start + Reconnect ab) und wandert in den Details-Aufklapper.
5. **Diagnose:** Klartext-Hinweise direkt auf der betroffenen Kart-Karte bzw. im Hero + Diagnose-Aufklapper pro Kart (MAC, Seq, Raw-Werte, Errors). Globale Diagnose (Bridge-MAC, RSSI-Verlauf, Paket-Log) hinter dem Details-Aufklapper im Hero — standardmäßig zu.
6. **Strategie A — Neuaufbau in einer Phase:** neues Markup, neue Module `conn-health.js` (pur, TDD) + `conn-ui.js` (DOM), Rückbau der alten Einzel-Kart-Writer. Kein Zwei-Phasen-Split.
7. **Ampel-Schwellen** (benannte Konstanten in `conn-health.js`): offline > 5 s ohne Paket; gelb ab RSSI < −75 dBm, Rate < 5 Hz, kein GPS-Fix > 30 s oder Paketalter > 2 s; max. 2 Hinweise pro Karte, Priorität offline > Signal > GPS > Rate > Paketalter.

## Verhalten

### Hero (Verbinden + Überblick)

- **Links:** Eyebrow „Verbindung & Diagnose" + Portstatus-Zeile: `COM7 · 115200 ● verbunden (auto)` / „Nicht verbunden" / „Demo-Modus aktiv" / Klartext-Störung („USB getrennt — Kabel prüfen", „Wiederverbinden, Versuch 3…").
- **Rechts:** aggregierte Werte **Karts** (`online/total`, online = grün+gelb, Nenner = alle Session-Karts), **Datenrate** (Summe der Kart-Raten), **GPS** (`n× Fix`); daneben Demo-Chip und der Aktions-Button.
- **Aktions-Button:** „Trennen" wenn verbunden; sonst „Verbinden" — nutzt den letzten Port; ist keiner bekannt, öffnet der Klick den Details-Aufklapper mit der Portliste.
- **Details-Aufklapper** (unterste Hero-Zeile, Session-State, startet zu): Portliste + Baud + Aktualisieren, Toggle „Automatisch verbinden", Bridge-MAC, RSSI-Sparkline (USB/Bridge-Strecke), Live-Paket-Log.

### Kart-Karten-Grid

- Eine Karte pro Session-Kart (Registry-Reihenfolge): Farb-Dot + Name (kartMeta) + Ampel-Badge (`● online` / `● schwach` / `● offline`), darunter die Wertezeile **Signal (dBm) · Rate (Hz) · Verloren · GPS · Alter**.
- Bei gelb/rot: Kartenrand färbt sich (`var(--yellow)`/`var(--red)`-basierte Töne) und eine **Hinweiszeile** erscheint (max. 2 Hinweise, Priorität s. Locked Decision 7).
- **Diagnose-Aufklapper pro Karte** (Session-State): MAC, Seq, RPM-Pulse/s, Pulse Count, Raw-G, Errors.
- Einmal gesehene Karts bleiben bis App-Neustart stehen (rot, „Seit N s keine Pakete…").
- Solange weitere Karts erwartet werden: gestrichelte Platzhalter-Karte „wartet auf weitere Karts…" (immer als letzte Zelle).
- Kart-Karten sind **nicht** klickbar für Tab-Wechsel (kein verstecktes Verhalten) — Diagnose-Aufklapper ist die einzige Interaktion.

### Ampel & Hinweise (pure Logik)

`classifyKart({ now, lastPacketAt, rssi, hz, lost, gpsFix, gpsLastAt })` → `{ level: 'ok'|'warn'|'off', hints: [] }`:

| Bedingung | Level | Hinweis |
|---|---|---|
| kein Paket oder `now - lastPacketAt > 5000` | `off` | „Seit N s keine Pakete — Akku, Reichweite oder Sender prüfen." |
| `rssi < -75` (nur wenn rssi geliefert) | `warn` | „Schwaches Signal — Reichweite/Antenne prüfen." |
| `gpsFix === false` und `now - gpsLastAt > 30000` (bzw. nie Fix) | `warn` | „Kein GPS-Fix — freie Sicht zum Himmel?" |
| `hz < 5` | `warn` | „Datenrate niedrig." |
| `now - lastPacketAt > 2000` | `warn` | „Pakete verzögert." |
| sonst | `ok` | — |

- Fehlende Werte (`rssi: null`, kein `gpsLastAt`) lösen allein kein `warn` aus — bewertet wird nur, was da ist. Junk-Eingaben werfen nie.
- `aggregate(kartResults)` → `{ online, total, hzSum, gpsFixCount }` für den Hero.
- `heroStatus({ connected, demoRunning, reconnecting, attempts, lastPath })` → `{ text, level }` liefert die Klartext-Portstatus-Zeile (testbar, ohne DOM).

### Auto-Connect

- Neue Settings-Keys: `serialAutoConnect: true` (der umbenannte Toggle), `serialLastPath: null`, `serialLastBaud: 115200`. Nach jedem erfolgreichen Verbinden werden Pfad + Baud gespeichert.
- Beim App-Start: wenn `serialAutoConnect` und `serialLastPath` gesetzt, Demo nicht läuft und der Port in der aktuellen Portliste auftaucht → ein Verbindungsversuch. Scheitert er, wird `state.serial.lastPath` vorbelegt und der bestehende `scheduleReconnect()`-Backoff übernimmt.
- Manuelles Trennen stoppt wie heute den Backoff und startet keinen neuen Versuch bis zum nächsten manuellen Verbinden oder App-Neustart.

### Demo

- Demo-Chip (stabile ID `#demoChip`): ▶ Demo → startet; ■ Demo läuft → stoppt. Während die Demo läuft, zeigt die Portstatus-Zeile „Demo-Modus aktiv"; die drei Demo-Karts laufen über denselben Grid-Render-Pfad — kein Sonderfall.
- Auto-Connect wird übersprungen, solange die Demo läuft; „Verbinden" während laufender Demo stoppt sie nicht automatisch, sondern der Chip muss zuerst gestoppt werden (Button ist dann inaktiv mit Tooltip „Demo läuft").

## Technik

### Neue Module

| Modul | Verantwortung |
|---|---|
| `src/conn-health.js` | Pur, kein DOM, wirft nie (Muster `live-view.js`): `classifyKart`, `aggregate`, `heroStatus`, eingefrorene Schwellen-Konstanten `THRESHOLDS`. Default-Export `{ classifyKart, aggregate, heroStatus, THRESHOLDS }`. |
| `src/conn-ui.js` | DOM-Renderer: Hero-Werte, Kart-Karten-Grid, Aufklapper-Zustände (Map mac→bool, Session), Platzhalter-Karte; berechnet die Hz-Rate pro Kart aus Paketzähler-Deltas (1-s-Fenster); hängt sich in den bestehenden 1-Hz-Render-Pfad. |

### Betroffene bestehende Dateien

| Datei | Änderung |
|---|---|
| `index.html` | `#tab-connection`-Markup komplett neu: Hero mit Portstatus/Aggregaten/`#demoChip`/Aktions-Button/Details-Aufklapper, `#connGrid` für die Kart-Karten. Alte Struktur (Pill-Zeile, Mode-Tabs, `#serialPanel`, `#demoPanel`, Datenfluss-Diagramm, diagnose-only-Karten) entfällt; Portliste/Baud/Paket-Log/Sparkline ziehen in den Details-Aufklapper um. |
| `src/ui-glue.js` / `src/pit-wall.js` | Rückbau aller Writer auf entfallene IDs (`connOverview*`, `connSeq/Age/Speed/Rpm`, `kartStatePill`/`pitStatePill`, `connUsbState` …). |
| `src/serial-demo.js` | Auto-Connect beim Start; Persistieren von Pfad+Baud nach Erfolg; Demo-Chip-Toggle statt Panel-Buttons; Verbinden-Button-Logik (letzter Port / Aufklapper öffnen). |
| `src/store.js` | Settings-Defaults `serialAutoConnect: true`, `serialLastPath: null`, `serialLastBaud: 115200`. |
| `src/app-init.js` | Auto-Connect-Aufruf nach Init; Event-Verdrahtung der neuen Controls. |
| `src/styles/pages/connection.css` | Weitgehend neu: Styles für Hero-Erweiterung, Kart-Karten, Hinweiszeilen, Aufklapper — ausschließlich über Tokens/Skalen (Hex- und Skalen-Gate); verwaiste Selektoren der alten Struktur entfallen. |
| `e2e/*.spec.js` (alle 4) | Demo-Start-Helper: ein Klick auf `#demoChip` statt `#modeDemoBtn`+`#demoStartBtn`. |
| `e2e/screens.spec.js` | `tab-connection`-Baseline neu; neuer Shot `demo-connection` (Verbindungsseite mit laufender Demo, Grid gefüllt, dynamische Werte maskiert) ⇒ 14 → 15 Baselines. |

Sidebar (`#connectBtn`, `#sideConnCard`) und Top-Pill (`#topConnPill`) bleiben unverändert (Nicht-Ziel).

### Datenfluss

Telemetrie → `state.karts` (Registry, pro Kart `connection`/`gps`) → 1-Hz-Render-Pfad → `conn-ui.render(state)`: pro Kart `classifyKart(…)`, einmal `aggregate(…)` + `heroStatus(…)` → DOM. Serial-/Demo-Zustand kommt aus `state.serial`/`state.demo`. Ein Writer pro Ziel-ID — keine 200-ms/1-Hz-Doppelschreiber mehr.

### Fehlerbehandlung

- `classifyKart`/`aggregate`/`heroStatus` normalisieren Junk (fehlende Felder, NaN, null) auf neutrale Defaults und werfen nie.
- Kein RSSI (`null`) → Anzeige „—", keine Gelb-Wertung allein deswegen.
- Leere Registry → nur Platzhalter-Karte, Hero „Karts 0/0".
- Persistierter Port existiert nicht mehr in der Portliste → kein Auto-Versuch, Hero „Nicht verbunden", kein Fehler-Spam.
- USB-Abriss → bestehender Backoff, sichtbar in der Portstatus-Zeile; Karten kippen über die 5-s-Regel auf offline.

## Tests

- **Unit (node --test):** `conn-health.js` vollständig per TDD — jede Schwelle einzeln (Grenzwerte), Hinweis-Priorisierung und Max-2-Regel, fehlende Werte lösen kein warn aus, Junk wirft nie, `aggregate`-Zählung (online = ok+warn), `heroStatus`-Zustände (verbunden/getrennt/Demo/Reconnect). `npm test` 210 → ≈ 222.
- **E2E:** Demo-Start-Helper in allen vier Specs auf `#demoChip` umgestellt; bestehende demo.spec/karts.spec/replay.spec-Flows müssen unverändert grün bleiben.
- **Screenshots:** `tab-connection` neu eingefroren (Freigabe-Loop mit Diff-Bildern); neuer Shot `demo-connection` mit maskierten dynamischen Wertefeldern — **Maske und Baseline im selben Schritt** (Lektion Phase 49). Die übrigen 13 Shots müssen unverändert grün bleiben; die Demo-Shots anderer Tabs ändern nur ihren Startweg.
- **Gates:** `npm run lint` (0), `npm run lint:css` (Hex- + Skalen-Gate), Python 65 OK (unangetastet).

## Nicht-Ziele / Abgrenzung

- Keine Änderung an Sidebar-Verbinden-Button, Top-Pill oder anderen Tabs.
- Kein Umbau der ESP-/Python-Seite (sender.py, bridge.py) — es werden nur Daten angezeigt, die die Bridge heute schon liefert.
- Keine Alarm-/Sound-Logik, keine Push-Warnungen (vgl. Memory: keine Lift/Lean-Alarme).
- Kein Persistieren von Aufklapper-Zuständen.
- Recording/Replay unberührt.

## Manuelle Abnahme (nach Merge, mit Hardware)

- [ ] App-Start mit angeschlossener Bridge: verbindet automatisch mit dem letzten Port; Hero zeigt „(auto)".
- [ ] USB-Kabel ziehen: Klartext-Störung im Hero, Reconnect-Zähler läuft; Kabel wieder rein → verbindet selbst.
- [ ] 2+ Karts: jede Karte zeigt plausible Signal/Rate/GPS-Werte; Sender eines Karts ausschalten → Karte wird nach ~5 s rot mit Klartext-Hinweis.
- [ ] Kart außer Reichweite tragen → gelber Hinweis „Schwaches Signal".
- [ ] Demo-Chip: startet/stoppt mit je einem Klick; Karten zeigen die 3 Demo-Karts; „Verbinden" ist während der Demo inaktiv.
- [ ] Details-Aufklapper: Portwechsel funktioniert; Paket-Log läuft; Light-/Outdoor-Theme lesbar (CI testet nur dark).
